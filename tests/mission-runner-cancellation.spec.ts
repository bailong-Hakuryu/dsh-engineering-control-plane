import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFilesystemEvidenceStore } from '../src/evidence/filesystem-store.ts'
import {
  createControlPlaneKernel,
  createInMemoryMissionStore,
  type EffectivePolicy,
  type MissionAuthority,
  type MissionSnapshot,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'
import {
  createMissionRunner,
  type MissionExecutionHost,
} from '../src/runner/mission-runner.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/runner-cancel-fixture',
  branch: 'main',
  head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  workspaceFingerprint: 'sha256:runner-cancel-baseline',
}

const authority: MissionAuthority = {
  principalId: 'agent:mission-owner',
  repository,
  actions: ['start', 'read', 'orchestrate', 'cancel'],
  leaseHolderId: 'runner-cancel-fixture-host',
  writeLease: { holderId: 'runner-cancel-fixture-host', fencingToken: 1 },
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: 'sha256:runner-cancel-policy',
  verificationProfile: 'fixture',
}

async function waitForLiveRole(
  read: () => Promise<MissionSnapshot>,
): Promise<MissionSnapshot> {
  let latest: MissionSnapshot | undefined
  for (let index = 0; index < 100; index += 1) {
    const snapshot = await read()
    latest = snapshot
    if (snapshot.roleRuns.some(run => run.state === 'running')) return snapshot
    await new Promise<void>(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`Runner did not publish a live Role Run: ${JSON.stringify(latest)}`)
}

describe('MissionRunner cancellation quiescence', () => {
  it('stops the child without consuming the cancellation revision', async () => {
    const evidenceRoot = await mkdtemp(join(tmpdir(), 'dsh-runner-cancel-'))
    temporaryRoots.push(evidenceRoot)
    const evidenceStore = createFilesystemEvidenceStore({ root: evidenceRoot })
    const store = createInMemoryMissionStore()
    const kernel = createControlPlaneKernel({
      store,
      nextMissionId: () => 'mission-runner-cancel',
      now: () => '2026-08-22T19:30:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'runner-cancel-start',
      input: { objective: 'Quiesce before durable cancellation' },
    }, authority)
    const host: MissionExecutionHost = {
      evidenceStore,
      roleExecutor: {
        async start(request) {
          return {
            trace: { provider: 'scripted', providerRunId: 'pending-planner' },
            result: new Promise(resolve => request.signal.addEventListener('abort', () => {
              resolve({ stopReason: 'aborted' })
            }, { once: true })),
            dispose: () => Promise.resolve(),
          }
        },
      },
      captureImplementation: () => Promise.reject(new Error('not reached')),
      runVerifications: () => Promise.reject(new Error('not reached')),
    }
    const runner = createMissionRunner({
      kernel,
      store,
      authorityFor: snapshot => ({ ...authority, repository: snapshot.repository }),
    })

    runner.launch(started.missionId, authority, host)
    const live = await waitForLiveRole(() => kernel.snapshot(started.missionId, authority))

    await runner.quiesceForCancellation(started.missionId)

    const quiescent = await kernel.snapshot(started.missionId, authority)
    expect(quiescent.revision).toBe(live.revision)
    expect(quiescent.roleRuns.at(-1)).toMatchObject({ state: 'running' })

    const finalRepositoryEvidence = await evidenceStore.publish({
      missionId: started.missionId,
      attempt: 1,
      kind: 'cancellation-repository-state',
      schemaVersion: 1,
      payload: { capturedAfterQuiescence: true, files: [] },
    })

    await kernel.dispatch({
      kind: 'cancel',
      missionId: started.missionId,
      expectedRevision: live.revision,
      finalRepositoryEvidence,
    }, authority)
    const cancelled = await kernel.snapshot(started.missionId, authority)
    expect(cancelled).toMatchObject({
      revision: live.revision + 1,
      status: 'CANCELLED',
      roleRuns: [{ state: 'aborted', stopReason: 'mission-cancelled' }],
    })
    expect(cancelled.evidence.records.at(-1)).toMatchObject({ kind: 'cancellation-repository-state' })
  })
})
