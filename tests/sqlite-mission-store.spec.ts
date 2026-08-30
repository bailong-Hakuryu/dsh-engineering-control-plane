import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MISSION_STORE_APPLICATION_ID,
  MISSION_STORE_SCHEMA_VERSION,
  openSqliteMissionStore,
} from '../src/adapters/sqlite-mission-store.ts'
import {
  createControlPlaneKernel,
  type EvidenceRecord,
  type EffectivePolicy,
  type MissionAuthority,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporaryDatabase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-control-plane-'))
  temporaryRoots.push(root)
  return join(root, 'control-plane.sqlite')
}

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/sqlite-fixture',
  branch: 'main',
  head: '5555555555555555555555555555555555555555',
  workspaceFingerprint: 'sha256:sqlite-baseline',
}

const authority: MissionAuthority = {
  principalId: 'host:sqlite-test',
  repository,
  actions: ['start', 'read', 'orchestrate', 'cancel'],
  leaseHolderId: 'sqlite-fixture-host',
  writeLease: { holderId: 'sqlite-fixture-host', fencingToken: 1 },
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: 'sha256:sqlite-policy',
  verificationProfile: 'fixture',
}

function cancellationEvidence(missionId: string, recordId: string): EvidenceRecord {
  return {
    recordId,
    missionId,
    attempt: 1,
    kind: 'cancellation-repository-state',
    schemaVersion: 1,
    digest: `sha256:${recordId}`,
    byteLength: 64,
    relativePath: `${missionId}/attempt-0001/records/${recordId}.json`,
    redacted: false,
    createdAt: '2026-08-22T16:00:00.000Z',
  }
}

describe('SqliteMissionStore', () => {
  it('preserves the accepted Mission revision across close and reopen', async () => {
    const path = await temporaryDatabase()
    const firstStore = await openSqliteMissionStore({ path })
    const firstKernel = createControlPlaneKernel({
      store: firstStore,
      nextMissionId: () => 'mission-persisted',
      now: () => '2026-08-22T16:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await firstKernel.dispatch({
      kind: 'start',
      idempotencyKey: 'persisted-start',
      input: { objective: 'Survive a host process restart' },
    }, authority)
    await firstKernel.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: 1,
      to: 'ANALYZING',
    }, authority)
    await firstStore.close()

    const reopenedStore = await openSqliteMissionStore({ path })
    const reopenedKernel = createControlPlaneKernel({
      store: reopenedStore,
      nextMissionId: () => 'unused',
      now: () => '2026-08-22T16:01:00.000Z',
      resolveEffectivePolicy: () => policy,
    })

    await expect(reopenedKernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      missionId: 'mission-persisted',
      revision: 2,
      status: 'ANALYZING',
      objective: 'Survive a host process restart',
      effectivePolicyDigest: 'sha256:sqlite-policy',
    })
    await reopenedStore.close()
  })

  it('persists Start idempotency across a process restart', async () => {
    const path = await temporaryDatabase()
    const firstStore = await openSqliteMissionStore({ path })
    const firstKernel = createControlPlaneKernel({
      store: firstStore,
      nextMissionId: () => 'mission-original',
      now: () => '2026-08-22T16:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const original = await firstKernel.dispatch({
      kind: 'start',
      idempotencyKey: 'durable-idempotency-key',
      input: { objective: 'Accept exactly once' },
    }, authority)
    await firstStore.close()

    const reopenedStore = await openSqliteMissionStore({ path })
    const reopenedKernel = createControlPlaneKernel({
      store: reopenedStore,
      nextMissionId: () => 'mission-must-not-be-created',
      now: () => '2026-08-22T16:01:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const replay = await reopenedKernel.dispatch({
      kind: 'start',
      idempotencyKey: 'durable-idempotency-key',
      input: { objective: 'A retried payload cannot replace accepted intent' },
    }, authority)

    expect(replay).toEqual(original)
    await expect(reopenedKernel.snapshot(replay.missionId, authority)).resolves.toMatchObject({
      objective: 'Accept exactly once',
    })
    await reopenedStore.close()
  })

  it('allows only one connection to mutate an expected revision', async () => {
    const path = await temporaryDatabase()
    const firstStore = await openSqliteMissionStore({ path })
    const secondStore = await openSqliteMissionStore({ path })
    const firstKernel = createControlPlaneKernel({
      store: firstStore,
      nextMissionId: () => 'mission-cas',
      now: () => '2026-08-22T16:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const secondKernel = createControlPlaneKernel({
      store: secondStore,
      nextMissionId: () => 'unused',
      now: () => '2026-08-22T16:00:01.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await firstKernel.dispatch({
      kind: 'start',
      idempotencyKey: 'cas-start',
      input: { objective: 'Serialize competing control commands' },
    }, authority)

    const outcomes = await Promise.allSettled([
      firstKernel.dispatch({
        kind: 'cancel',
        missionId: started.missionId,
        expectedRevision: 1,
        reason: 'first caller',
        finalRepositoryEvidence: cancellationEvidence(started.missionId, 'first-final'),
      }, authority),
      secondKernel.dispatch({
        kind: 'cancel',
        missionId: started.missionId,
        expectedRevision: 1,
        reason: 'second caller',
        finalRepositoryEvidence: cancellationEvidence(started.missionId, 'second-final'),
      }, authority),
    ])

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(outcome => outcome.status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'revision_conflict', currentRevision: 2, status: 'CANCELLED' },
    })
    await firstStore.close()
    await secondStore.close()
  })

  it('fails closed for newer or foreign current-version stores', async () => {
    const newerPath = await temporaryDatabase()
    const newer = new DatabaseSync(newerPath)
    newer.exec(`PRAGMA application_id = ${MISSION_STORE_APPLICATION_ID}`)
    newer.exec(`PRAGMA user_version = ${MISSION_STORE_SCHEMA_VERSION + 1}`)
    newer.close()

    await expect(openSqliteMissionStore({ path: newerPath })).rejects.toMatchObject({
      code: 'unsupported_format',
    })

    const foreignPath = await temporaryDatabase()
    const foreign = new DatabaseSync(foreignPath)
    foreign.exec(`PRAGMA application_id = ${MISSION_STORE_APPLICATION_ID}`)
    foreign.exec(`PRAGMA user_version = ${MISSION_STORE_SCHEMA_VERSION}`)
    foreign.close()

    await expect(openSqliteMissionStore({ path: foreignPath })).rejects.toMatchObject({
      code: 'corrupt_store',
    })
  })

  it('backs up and transactionally migrates a v1 snapshot to the released lease epoch', async () => {
    const path = await temporaryDatabase()
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE missions (
        mission_id TEXT PRIMARY KEY,
        canonical_root TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        status TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX missions_one_active_per_repository
        ON missions (canonical_root)
        WHERE status NOT IN ('APPROVED', 'CANCELLED');
      CREATE TABLE starts (
        idempotency_key TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL REFERENCES missions(mission_id)
      ) STRICT;
    `)
    const legacySnapshot = {
      missionId: 'mission-v1-migration',
      revision: 7,
      repository,
      objective: 'Migrate without inventing an active lease holder',
      acceptanceCriteria: [],
      constraints: [],
      effectivePolicy: policy,
      effectivePolicyDigest: policy.digest,
      status: 'BLOCKED',
      attempt: 1,
      inputRecords: [],
      roleRuns: [],
      evidence: { records: [] },
      gateHistory: [],
      blocked: {
        reason: { code: 'host_restarted' },
        resumeStatus: 'ANALYZING',
        blockedAt: '2026-08-22T15:59:59.000Z',
      },
      createdAt: '2026-08-22T15:00:00.000Z',
      updatedAt: '2026-08-22T15:59:59.000Z',
    }
    legacy.prepare(`
      INSERT INTO missions (
        mission_id, canonical_root, revision, status, snapshot_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      legacySnapshot.missionId,
      repository.canonicalRoot,
      legacySnapshot.revision,
      legacySnapshot.status,
      JSON.stringify(legacySnapshot),
      legacySnapshot.updatedAt,
    )
    legacy.exec(`PRAGMA application_id = ${MISSION_STORE_APPLICATION_ID}`)
    legacy.exec('PRAGMA user_version = 1')
    legacy.close()

    const migrated = await openSqliteMissionStore({ path })
    await expect(migrated.get('mission-v1-migration')).resolves.toMatchObject({
      revision: 7,
      writeLease: {
        fencingToken: 0,
        releasedAt: '2026-08-22T15:59:59.000Z',
      },
    })
    await migrated.close()

    const files = await readdir(dirname(path))
    expect(files.some(file => file.startsWith('control-plane.sqlite.v1.backup-'))).toBe(true)
    const reopened = new DatabaseSync(path, { readOnly: true })
    expect(reopened.prepare('PRAGMA user_version').get()).toMatchObject({
      user_version: MISSION_STORE_SCHEMA_VERSION,
    })
    reopened.close()
  })

  it.each([
    ['status', "UPDATE missions SET status = 'ANALYZING' WHERE mission_id = 'mission-projection'"],
    ['canonical root', "UPDATE missions SET canonical_root = 'D:/tampered-root' WHERE mission_id = 'mission-projection'"],
  ])('rejects a database whose %s projection disagrees with its snapshot', async (_field, update) => {
    const path = await temporaryDatabase()
    const store = await openSqliteMissionStore({ path })
    const kernel = createControlPlaneKernel({
      store,
      nextMissionId: () => 'mission-projection',
      now: () => '2026-08-22T16:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'projection-start',
      input: { objective: 'Keep SQLite projections bound to their snapshot' },
    }, authority)
    await store.close()

    const tamper = new DatabaseSync(path)
    tamper.exec(update)
    tamper.close()

    try {
      const reopened = await openSqliteMissionStore({ path })
      await reopened.close()
      throw new Error('Expected a corrupt Store projection to be rejected')
    } catch (error) {
      expect(error).toMatchObject({ code: 'corrupt_store' })
    }
  })
})
