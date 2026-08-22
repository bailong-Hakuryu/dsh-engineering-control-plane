import { describe, expect, it } from 'vitest'
import {
  createControlPlaneKernel,
  createInMemoryMissionStore,
  type EffectivePolicy,
  type EvidenceRecord,
  type MissionAuthority,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/role-run-fixture',
  branch: 'main',
  head: '7777777777777777777777777777777777777777',
  workspaceFingerprint: 'sha256:role-run-baseline',
}

const authority: MissionAuthority = {
  principalId: 'plugin:mission-runner',
  repository,
  actions: ['start', 'read', 'orchestrate'],
  leaseHolderId: 'role-run-fixture-host',
  writeLease: { holderId: 'role-run-fixture-host', fencingToken: 1 },
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: 'sha256:role-run-policy',
  verificationProfile: 'fixture',
}

describe('ControlPlaneKernel Role Runs', () => {
  it('records a one-shot Planner run and its indexed output without delegating transitions', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-role-run',
      now: () => '2026-08-22T18:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'role-run-start',
      input: { objective: 'Keep child execution subordinate to the Kernel' },
    }, authority)
    const analyzing = await kernel.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: 1,
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
      runId: 'role-run-planner-1',
      role: 'planner',
    }, authority)
    const published = await kernel.dispatch({
      kind: 'publish_role_run',
      missionId: started.missionId,
      expectedRevision: prepared.revision,
      runId: 'role-run-planner-1',
      trace: {
        provider: 'spawn',
        providerRunId: 'child-session-1',
        sessionId: 'child-session-1',
      },
    }, authority)
    const record: EvidenceRecord = {
      recordId: 'record-plan-1',
      missionId: started.missionId,
      attempt: 1,
      kind: 'plan',
      schemaVersion: 1,
      digest: `sha256:${'2'.repeat(64)}`,
      byteLength: 256,
      relativePath: 'mission-role-run/attempt-0001/records/record-plan-1.json',
      redacted: false,
      createdAt: '2026-08-22T18:00:00.000Z',
    }
    const indexed = await kernel.dispatch({
      kind: 'record_evidence',
      missionId: started.missionId,
      expectedRevision: published.revision,
      record,
    }, authority)
    const settled = await kernel.dispatch({
      kind: 'settle_role_run',
      missionId: started.missionId,
      expectedRevision: indexed.revision,
      runId: 'role-run-planner-1',
      outcome: 'completed',
      evidenceRecordIds: ['record-plan-1'],
    }, authority)

    expect(settled).toMatchObject({ revision: 7, status: 'PLANNING', attempt: 1 })
    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      roleRuns: [{
        runId: 'role-run-planner-1',
        attempt: 1,
        role: 'planner',
        state: 'completed',
        trace: {
          provider: 'spawn',
          providerRunId: 'child-session-1',
          sessionId: 'child-session-1',
        },
        evidenceRecordIds: ['record-plan-1'],
      }],
      status: 'PLANNING',
    })
  })
})
