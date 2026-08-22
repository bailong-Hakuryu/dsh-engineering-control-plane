import { describe, expect, it } from 'vitest'
import {
  createControlPlaneKernel,
  createInMemoryMissionStore,
  type EffectivePolicy,
  type MissionAuthority,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/write-lease-fixture',
  branch: 'main',
  head: '8888888888888888888888888888888888888888',
  workspaceFingerprint: 'sha256:write-lease-baseline',
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: 'sha256:write-lease-policy',
  verificationProfile: 'fixture',
}

function authority(
  holderId: string,
  fencingToken: number,
  actions: MissionAuthority['actions'] = ['start', 'read', 'resume', 'orchestrate'],
): MissionAuthority {
  return {
    principalId: `host:${holderId}`,
    repository,
    actions,
    leaseHolderId: holderId,
    writeLease: { holderId, fencingToken },
  }
}

function kernel() {
  return createControlPlaneKernel({
    store: createInMemoryMissionStore(),
    nextMissionId: () => 'mission-write-lease',
    now: () => '2026-08-22T20:00:00.000Z',
    resolveEffectivePolicy: () => policy,
  })
}

describe('ControlPlaneKernel fenced Write Lease', () => {
  it('releases on Block and rotates only through explicit Resume', async () => {
    const controlPlane = kernel()
    const firstHolder = authority('holder-a', 1)
    const started = await controlPlane.dispatch({
      kind: 'start',
      idempotencyKey: 'lease-start',
      input: { objective: 'Fence repository mutation across host processes' },
    }, firstHolder)
    await expect(controlPlane.snapshot(started.missionId, firstHolder)).resolves.toMatchObject({
      writeLease: {
        fencingToken: 1,
        holderId: 'holder-a',
        acquiredAt: '2026-08-22T20:00:00.000Z',
      },
    })

    const competingHolder = authority('holder-b', 1, ['read', 'orchestrate'])
    await expect(controlPlane.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: started.revision,
      to: 'ANALYZING',
    }, competingHolder)).rejects.toMatchObject({ code: 'write_lease_denied' })

    const analyzing = await controlPlane.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: started.revision,
      to: 'ANALYZING',
    }, firstHolder)
    const blocked = await controlPlane.dispatch({
      kind: 'block',
      missionId: started.missionId,
      expectedRevision: analyzing.revision,
      reason: { code: 'needs_input' },
    }, firstHolder)
    await expect(controlPlane.snapshot(started.missionId, firstHolder)).resolves.toMatchObject({
      status: 'BLOCKED',
      writeLease: {
        fencingToken: 1,
        releasedAt: '2026-08-22T20:00:00.000Z',
      },
    })

    const secondHolder = authority('holder-b', 2)
    const resumed = await controlPlane.dispatch({
      kind: 'resume',
      missionId: started.missionId,
      expectedRevision: blocked.revision,
      supplementalContext: 'The operator explicitly resumed on a new host.',
    }, secondHolder)
    await expect(controlPlane.snapshot(started.missionId, secondHolder)).resolves.toMatchObject({
      status: 'ANALYZING',
      writeLease: {
        fencingToken: 2,
        holderId: 'holder-b',
        acquiredAt: '2026-08-22T20:00:00.000Z',
      },
    })

    await expect(controlPlane.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: resumed.revision,
      to: 'PLANNING',
    }, { ...firstHolder, writeLease: { holderId: 'holder-a', fencingToken: 1 } }))
      .rejects.toMatchObject({ code: 'write_lease_denied', currentRevision: resumed.revision })

    await expect(controlPlane.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: resumed.revision,
      to: 'PLANNING',
    }, secondHolder)).resolves.toMatchObject({ status: 'PLANNING' })
  })

  it('lets restart recovery fence and seal an interrupted Role Run without taking the lease', async () => {
    const controlPlane = kernel()
    const holder = authority('holder-before-crash', 1)
    const started = await controlPlane.dispatch({
      kind: 'start',
      idempotencyKey: 'lease-recovery-start',
      input: { objective: 'Fence an interrupted host' },
    }, holder)
    const analyzing = await controlPlane.dispatch({
      kind: 'advance', missionId: started.missionId, expectedRevision: 1, to: 'ANALYZING',
    }, holder)
    const planning = await controlPlane.dispatch({
      kind: 'advance', missionId: started.missionId, expectedRevision: analyzing.revision, to: 'PLANNING',
    }, holder)
    const prepared = await controlPlane.dispatch({
      kind: 'prepare_role_run',
      missionId: started.missionId,
      expectedRevision: planning.revision,
      runId: 'planner-interrupted',
      role: 'planner',
    }, holder)
    const published = await controlPlane.dispatch({
      kind: 'publish_role_run',
      missionId: started.missionId,
      expectedRevision: prepared.revision,
      runId: 'planner-interrupted',
      trace: { provider: 'spawn', providerRunId: 'child-interrupted' },
    }, holder)

    const recoveryAuthority: MissionAuthority = {
      principalId: 'service:restart-recovery',
      repository,
      actions: ['read', 'recover'],
    }
    await controlPlane.dispatch({
      kind: 'block',
      missionId: started.missionId,
      expectedRevision: published.revision,
      reason: { code: 'host_restarted' },
    }, recoveryAuthority)

    await expect(controlPlane.snapshot(started.missionId, recoveryAuthority)).resolves.toMatchObject({
      status: 'BLOCKED',
      writeLease: { fencingToken: 1, releasedAt: '2026-08-22T20:00:00.000Z' },
      roleRuns: [{
        runId: 'planner-interrupted',
        state: 'aborted',
        stopReason: 'host-restarted',
      }],
    })
  })
})
