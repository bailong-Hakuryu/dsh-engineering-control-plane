import { describe, expect, it } from 'vitest'
import {
  createControlPlaneKernel,
  createInMemoryMissionStore,
  type EffectivePolicy,
  type GateInput,
  type MissionAuthority,
  type MissionPhase,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/lifecycle-fixture',
  branch: 'main',
  head: '3333333333333333333333333333333333333333',
  workspaceFingerprint: 'sha256:lifecycle-baseline',
}

const authority: MissionAuthority = {
  principalId: 'host:runner',
  repository,
  actions: ['start', 'read', 'orchestrate', 'resume', 'rework'],
  leaseHolderId: 'lifecycle-fixture-host',
  writeLease: { holderId: 'lifecycle-fixture-host', fencingToken: 1 },
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: 'sha256:lifecycle-policy',
  verificationProfile: 'fixture',
}

const phasesToReview: readonly MissionPhase[] = [
  'ANALYZING',
  'PLANNING',
  'IMPLEMENTING',
  'VERIFYING',
  'REVIEWING',
]

const failedGateInput: GateInput = {
  requiredEvidence: ['context', 'plan', 'implementation', 'test-report', 'review-report']
    .map(kind => ({ kind, state: 'valid' as const })),
  verifications: [
    { category: 'functional', outcome: 'failed' },
    { category: 'negative', outcome: 'passed' },
    { category: 'regression', outcome: 'passed' },
    { category: 'security', outcome: 'passed' },
  ],
  reviewerFindings: [],
  implementationSecretCount: 0,
  workspacePolicyViolations: [],
}

describe('ControlPlaneKernel lifecycle', () => {
  it('advances the accepted Mission from Created to Analyzing', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-lifecycle',
      now: () => '2026-08-22T14:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'lifecycle-start',
      input: { objective: 'Advance deterministically' },
    }, authority)

    const analyzing = await kernel.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: 1,
      to: 'ANALYZING',
    }, authority)

    expect(analyzing).toMatchObject({ revision: 2, status: 'ANALYZING', attempt: 1 })
  })

  it('rejects skipping ordered lifecycle phases', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-no-skip',
      now: () => '2026-08-22T14:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'no-skip-start',
      input: { objective: 'Keep lifecycle ordered' },
    }, authority)

    await expect(kernel.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: 1,
      to: 'IMPLEMENTING',
    }, authority)).rejects.toMatchObject({
      code: 'illegal_transition',
      missionId: 'mission-no-skip',
      status: 'CREATED',
      currentRevision: 1,
    })
  })

  it('resumes a Blocked Mission in the same Attempt with immutable supplemental input', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-resume',
      now: () => '2026-08-22T14:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'resume-start',
      input: { objective: 'Resume without rewriting history' },
    }, authority)
    await kernel.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: 1,
      to: 'ANALYZING',
    }, authority)
    const blocked = await kernel.dispatch({
      kind: 'block',
      missionId: started.missionId,
      expectedRevision: 2,
      reason: { code: 'needs_input', detail: 'Which timeout is authoritative?' },
    }, authority)

    expect(blocked).toMatchObject({ revision: 3, status: 'BLOCKED', attempt: 1 })
    const resumed = await kernel.dispatch({
      kind: 'resume',
      missionId: started.missionId,
      expectedRevision: 3,
      supplementalContext: 'Use the gateway timeout as authoritative.',
    }, authority)

    expect(resumed).toMatchObject({ revision: 4, status: 'ANALYZING', attempt: 1 })
    const snapshot = await kernel.snapshot(started.missionId, authority)
    expect(snapshot).not.toHaveProperty('blocked')
    expect(snapshot).toMatchObject({
      inputRecords: [
        { sequence: 1, kind: 'initial', objective: 'Resume without rewriting history' },
        {
          sequence: 2,
          kind: 'resume',
          supplementalContext: 'Use the gateway timeout as authoritative.',
          submittedBy: 'host:runner',
        },
      ],
    })
  })

  it('atomically blocks and refuses Resume while frozen Assurance execution is unavailable', async () => {
    const selectedPolicy: EffectivePolicy = {
      ...policy,
      selectedAssuranceProviders: [{
        schemaVersion: 1,
        descriptor: {
          schemaVersion: 1,
          providerId: 'fixture/kernel-selection-provider',
          providerVersion: '1.0.0-fixture.1',
        },
        activation: 'required',
      }],
    }
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-assurance-unavailable',
      now: () => '2026-08-22T14:00:00.000Z',
      resolveEffectivePolicy: () => selectedPolicy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'assurance-unavailable-start',
      input: { objective: 'Preserve the unavailable Assurance boundary' },
    }, authority)

    expect(started).toMatchObject({ revision: 1, status: 'BLOCKED', attempt: 1 })
    await expect(kernel.dispatch({
      kind: 'resume',
      missionId: started.missionId,
      expectedRevision: 1,
    }, authority)).rejects.toMatchObject({
      code: 'illegal_transition',
      status: 'BLOCKED',
      currentRevision: 1,
    })
    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      revision: 1,
      status: 'BLOCKED',
      writeLease: {
        fencingToken: 1,
        releasedAt: '2026-08-22T14:00:00.000Z',
      },
      blocked: {
        reason: { code: 'assurance_execution_unavailable' },
        resumeStatus: 'CREATED',
      },
    })
  })

  it('starts Rework as a new Planning Attempt without rewriting the prior Gate decision', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-new-attempt',
      now: () => '2026-08-22T14:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'new-attempt-start',
      input: { objective: 'Preserve failed Attempt history' },
    }, authority)
    let revision = started.revision
    for (const phase of phasesToReview) {
      revision = (await kernel.dispatch({
        kind: 'advance',
        missionId: started.missionId,
        expectedRevision: revision,
        to: phase,
      }, authority)).revision
    }
    revision = (await kernel.dispatch({
      kind: 'decide_gate',
      missionId: started.missionId,
      expectedRevision: revision,
      input: failedGateInput,
    }, authority)).revision

    const reworked = await kernel.dispatch({
      kind: 'rework',
      missionId: started.missionId,
      expectedRevision: revision,
      instructions: 'Address the functional regression without weakening checks.',
    }, authority)

    expect(reworked).toMatchObject({ revision: 8, status: 'PLANNING', attempt: 2 })
    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      inputRecords: [
        { sequence: 1, kind: 'initial' },
        {
          sequence: 2,
          kind: 'rework',
          submittedBy: 'host:runner',
          instructions: 'Address the functional regression without weakening checks.',
        },
      ],
      gateHistory: [{ attempt: 1, decision: { kind: 'rework_required' } }],
    })
  })

  it('rejects Resume and Rework outside their dedicated source states', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-command-boundaries',
      now: () => '2026-08-22T14:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'command-boundaries-start',
      input: { objective: 'Keep Resume and Rework distinct' },
    }, authority)

    await expect(kernel.dispatch({
      kind: 'resume',
      missionId: started.missionId,
      expectedRevision: 1,
    }, authority)).rejects.toMatchObject({
      code: 'illegal_transition',
      status: 'CREATED',
      currentRevision: 1,
    })
    await expect(kernel.dispatch({
      kind: 'rework',
      missionId: started.missionId,
      expectedRevision: 1,
    }, authority)).rejects.toMatchObject({
      code: 'illegal_transition',
      status: 'CREATED',
      currentRevision: 1,
    })
  })
})
