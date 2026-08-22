import { describe, expect, it } from 'vitest'
import {
  createControlPlaneKernel,
  createInMemoryMissionStore,
  type EvidenceRecord,
  type EffectivePolicy,
  type MissionAuthority,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/cancel-fixture',
  branch: 'main',
  head: '2222222222222222222222222222222222222222',
  workspaceFingerprint: 'sha256:cancel-baseline',
}

const authority: MissionAuthority = {
  principalId: 'agent:parent',
  repository,
  actions: ['start', 'read', 'cancel', 'orchestrate'],
  leaseHolderId: 'cancel-fixture-host',
  writeLease: { holderId: 'cancel-fixture-host', fencingToken: 1 },
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: 'sha256:cancel-policy',
  verificationProfile: 'fixture',
}

function finalRepositoryEvidence(
  missionId: string,
  recordId = 'cancel-final-repository',
): EvidenceRecord {
  return {
    recordId,
    missionId,
    attempt: 1,
    kind: 'cancellation-repository-state',
    schemaVersion: 1,
    digest: 'sha256:cancel-final-repository',
    byteLength: 128,
    relativePath: `${missionId}/attempt-0001/records/${recordId}.json`,
    redacted: false,
    createdAt: '2026-08-22T13:00:00.000Z',
  }
}

describe('ControlPlaneKernel cancellation', () => {
  it('cancels a non-terminal Mission at the expected revision', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-cancel',
      now: () => '2026-08-22T13:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'cancel-start',
      input: { objective: 'Stop safely' },
    }, authority)

    const cancelled = await kernel.dispatch({
      kind: 'cancel',
      missionId: started.missionId,
      expectedRevision: 1,
      reason: 'User changed direction',
      finalRepositoryEvidence: finalRepositoryEvidence(started.missionId),
    }, authority)

    expect(cancelled).toMatchObject({
      missionId: 'mission-cancel',
      revision: 2,
      status: 'CANCELLED',
      attempt: 1,
    })
    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      revision: 2,
      status: 'CANCELLED',
      cancellation: {
        reason: 'User changed direction',
        requestedBy: 'agent:parent',
        requestedAt: '2026-08-22T13:00:00.000Z',
        repositoryEvidenceRecordId: 'cancel-final-repository',
      },
      evidence: { records: [{ kind: 'cancellation-repository-state' }] },
    })
  })

  it('treats Cancelled as terminal instead of accepting another cancellation', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-terminal',
      now: () => '2026-08-22T13:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'terminal-start',
      input: { objective: 'Cancel once' },
    }, authority)
    await kernel.dispatch({
      kind: 'cancel',
      missionId: started.missionId,
      expectedRevision: 1,
      finalRepositoryEvidence: finalRepositoryEvidence(started.missionId, 'terminal-final'),
    }, authority)

    await expect(kernel.dispatch({
      kind: 'cancel',
      missionId: started.missionId,
      expectedRevision: 2,
      finalRepositoryEvidence: finalRepositoryEvidence(started.missionId, 'terminal-second-final'),
    }, authority)).rejects.toMatchObject({
      code: 'illegal_transition',
      missionId: 'mission-terminal',
      status: 'CANCELLED',
      currentRevision: 2,
    })
  })

  it('rejects a stale revision without applying the mutation', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-stale-cancel',
      now: () => '2026-08-22T13:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'stale-cancel-start',
      input: { objective: 'Reject stale control intent' },
    }, authority)

    await expect(kernel.dispatch({
      kind: 'cancel',
      missionId: started.missionId,
      expectedRevision: 0,
      finalRepositoryEvidence: finalRepositoryEvidence(started.missionId, 'stale-final'),
    }, authority)).rejects.toMatchObject({
      code: 'revision_conflict',
      missionId: 'mission-stale-cancel',
      status: 'CREATED',
      currentRevision: 1,
    })
    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      revision: 1,
      status: 'CREATED',
    })
  })

  it('atomically seals a live Role Run in the cancellation revision', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-live-cancel',
      now: () => '2026-08-22T13:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'live-cancel-start',
      input: { objective: 'Cancel a live child without losing audit history' },
    }, authority)
    const analyzing = await kernel.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: started.revision,
      to: 'ANALYZING',
    }, authority)
    const planning = await kernel.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: analyzing.revision,
      to: 'PLANNING',
    }, authority)
    const prepared = await kernel.dispatch({
      kind: 'prepare_role_run',
      missionId: started.missionId,
      expectedRevision: planning.revision,
      runId: 'planner-live-at-cancel',
      role: 'planner',
    }, authority)
    const published = await kernel.dispatch({
      kind: 'publish_role_run',
      missionId: started.missionId,
      expectedRevision: prepared.revision,
      runId: 'planner-live-at-cancel',
      trace: { provider: 'spawn', providerRunId: 'child-live-at-cancel' },
    }, authority)

    const cancelled = await kernel.dispatch({
      kind: 'cancel',
      missionId: started.missionId,
      expectedRevision: published.revision,
      reason: 'Stop now',
      finalRepositoryEvidence: finalRepositoryEvidence(started.missionId, 'live-final'),
    }, authority)

    expect(cancelled).toMatchObject({ revision: published.revision + 1, status: 'CANCELLED' })
    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      revision: published.revision + 1,
      status: 'CANCELLED',
      roleRuns: [{
        runId: 'planner-live-at-cancel',
        state: 'aborted',
        settledAt: '2026-08-22T13:00:00.000Z',
        stopReason: 'mission-cancelled',
        evidenceRecordIds: [],
      }],
    })
  })
})
