import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { openSqliteMissionStore } from '../src/adapters/sqlite-mission-store.ts'
import { inspectControlPlane } from '../src/doctor.ts'
import {
  createControlPlaneKernel,
  type EffectivePolicy,
  type MissionAuthority,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporaryHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-doctor-'))
  temporaryRoots.push(home)
  return home
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/doctor-fixture',
  branch: 'main',
  head: '9999999999999999999999999999999999999999',
  workspaceFingerprint: 'sha256:doctor-baseline',
}

const authority: MissionAuthority = {
  principalId: 'host:doctor-fixture',
  repository,
  actions: ['start', 'read', 'orchestrate'],
  leaseHolderId: 'doctor-fixture-host',
  writeLease: { holderId: 'doctor-fixture-host', fencingToken: 1 },
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: 'sha256:doctor-policy',
  verificationProfile: 'fixture',
}

describe('read-only control-plane doctor', () => {
  it('reports a missing store without creating the control-plane directory', async () => {
    const home = await temporaryHome()
    const report = await inspectControlPlane({ dshHome: home })

    expect(report).toMatchObject({
      ok: false,
      database: { exists: false },
      issues: [{ code: 'missing_database' }],
    })
    await expect(stat(join(home, 'control-plane'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('validates a current store without changing bytes or directory entries', async () => {
    const home = await temporaryHome()
    const path = join(home, 'control-plane', 'control-plane.sqlite')
    const store = await openSqliteMissionStore({ path })
    const kernel = createControlPlaneKernel({
      store,
      nextMissionId: () => 'mission-doctor-healthy',
      now: () => '2026-08-22T21:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'doctor-healthy-start',
      input: { objective: 'Remain inspectable without repair' },
    }, authority)
    const analyzing = await kernel.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: started.revision,
      to: 'ANALYZING',
    }, authority)
    await kernel.dispatch({
      kind: 'block',
      missionId: started.missionId,
      expectedRevision: analyzing.revision,
      reason: { code: 'needs_input' },
    }, authority)
    await store.close()

    const beforeBytes = await readFile(path)
    const beforeEntries = await readdir(join(home, 'control-plane'))
    const report = await inspectControlPlane({ dshHome: home })
    const afterBytes = await readFile(path)
    const afterEntries = await readdir(join(home, 'control-plane'))

    expect(report).toMatchObject({
      ok: true,
      database: { exists: true, schemaVersion: 2, quickCheck: 'ok' },
      missions: { total: 1, nonTerminal: 1, activeWriteLeases: 0 },
      evidence: { indexed: 0, valid: 0, missing: 0, corrupt: 0 },
      issues: [],
    })
    expect(digest(afterBytes)).toBe(digest(beforeBytes))
    expect(afterEntries.sort()).toEqual(beforeEntries.sort())
  })
})
