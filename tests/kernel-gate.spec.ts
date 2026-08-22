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
  canonicalRoot: 'D:/gate-fixture',
  branch: 'main',
  head: '4444444444444444444444444444444444444444',
  workspaceFingerprint: 'sha256:gate-baseline',
}

const authority: MissionAuthority = {
  principalId: 'host:runner',
  repository,
  actions: ['start', 'read', 'orchestrate', 'rework'],
  leaseHolderId: 'gate-fixture-host',
  writeLease: { holderId: 'gate-fixture-host', fencingToken: 1 },
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: 'sha256:gate-policy',
  verificationProfile: 'fixture',
}

const passingInput: GateInput = {
  requiredEvidence: [
    'context',
    'plan',
    'implementation',
    'test-report',
    'review-report',
  ].map(kind => ({ kind, state: 'valid' as const })),
  verifications: ['functional', 'negative', 'regression', 'security'].map(category => ({
    category: category as 'functional' | 'negative' | 'regression' | 'security',
    outcome: 'passed' as const,
  })),
  assuranceResults: [],
  reviewerFindings: [],
  implementationSecretCount: 0,
  workspacePolicyViolations: [],
}

const phases: readonly MissionPhase[] = [
  'ANALYZING',
  'PLANNING',
  'IMPLEMENTING',
  'VERIFYING',
  'REVIEWING',
]

describe('ControlPlaneKernel Quality Gate', () => {
  it('approves a Reviewing Mission only when all required Evidence passes', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-approved',
      now: () => '2026-08-22T15:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'gate-start',
      input: { objective: 'Reach approval through evidence' },
    }, authority)
    let revision = started.revision
    for (const phase of phases) {
      const receipt = await kernel.dispatch({
        kind: 'advance',
        missionId: started.missionId,
        expectedRevision: revision,
        to: phase,
      }, authority)
      revision = receipt.revision
    }

    const decision = await kernel.dispatch({
      kind: 'decide_gate',
      missionId: started.missionId,
      expectedRevision: revision,
      input: passingInput,
    }, authority)

    expect(decision).toMatchObject({ revision: 7, status: 'APPROVED', attempt: 1 })
    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      gate: { kind: 'approved', reasons: [] },
    })
  })

  it('treats a host-reasoned not-applicable verification category as complete', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-not-applicable',
      now: () => '2026-08-22T15:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'gate-not-applicable-start',
      input: { objective: 'Honor explicit host verification policy' },
    }, authority)
    let revision = started.revision
    for (const phase of phases) {
      revision = (await kernel.dispatch({
        kind: 'advance',
        missionId: started.missionId,
        expectedRevision: revision,
        to: phase,
      }, authority)).revision
    }

    const decision = await kernel.dispatch({
      kind: 'decide_gate',
      missionId: started.missionId,
      expectedRevision: revision,
      input: {
        ...passingInput,
        verifications: passingInput.verifications.map(item => item.category === 'security'
          ? { ...item, outcome: 'not_applicable' as const }
          : item),
      },
    }, authority)

    expect(decision).toMatchObject({ status: 'APPROVED' })
  })

  it('requires Rework for a definite verification failure', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-rework',
      now: () => '2026-08-22T15:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'gate-rework-start',
      input: { objective: 'Classify engineering failure' },
    }, authority)
    let revision = started.revision
    for (const phase of phases) {
      revision = (await kernel.dispatch({
        kind: 'advance',
        missionId: started.missionId,
        expectedRevision: revision,
        to: phase,
      }, authority)).revision
    }

    const decision = await kernel.dispatch({
      kind: 'decide_gate',
      missionId: started.missionId,
      expectedRevision: revision,
      input: {
        ...passingInput,
        verifications: passingInput.verifications.map(item => item.category === 'functional'
          ? { ...item, outcome: 'failed' as const }
          : item),
      },
    }, authority)

    expect(decision).toMatchObject({ revision: 7, status: 'REWORK_REQUIRED' })
    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      gate: {
        kind: 'rework_required',
        reasons: [{ code: 'verification_failed', source: 'functional' }],
      },
    })
  })

  it('blocks instead of judging quality when required output is truncated', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-indeterminate',
      now: () => '2026-08-22T15:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'gate-blocked-start',
      input: { objective: 'Do not approve incomplete evidence' },
    }, authority)
    let revision = started.revision
    for (const phase of phases) {
      revision = (await kernel.dispatch({
        kind: 'advance',
        missionId: started.missionId,
        expectedRevision: revision,
        to: phase,
      }, authority)).revision
    }

    const decision = await kernel.dispatch({
      kind: 'decide_gate',
      missionId: started.missionId,
      expectedRevision: revision,
      input: {
        ...passingInput,
        verifications: passingInput.verifications.map(item => item.category === 'security'
          ? { ...item, outcome: 'truncated' as const }
          : item),
      },
    }, authority)

    expect(decision).toMatchObject({ revision: 7, status: 'BLOCKED' })
    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      gate: {
        kind: 'blocked',
        reasons: [{ code: 'verification_truncated', source: 'security' }],
      },
      blocked: {
        reason: { code: 'evidence_incomplete' },
        resumeStatus: 'REVIEWING',
      },
    })
  })

  it('blocks when required Evidence is unavailable or workspace policy is violated', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-invalid-evidence',
      now: () => '2026-08-22T15:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'gate-invalid-evidence-start',
      input: { objective: 'Fail closed on untrustworthy evidence' },
    }, authority)
    let revision = started.revision
    for (const phase of phases) {
      revision = (await kernel.dispatch({
        kind: 'advance',
        missionId: started.missionId,
        expectedRevision: revision,
        to: phase,
      }, authority)).revision
    }

    await kernel.dispatch({
      kind: 'decide_gate',
      missionId: started.missionId,
      expectedRevision: revision,
      input: {
        ...passingInput,
        requiredEvidence: passingInput.requiredEvidence.map(item => {
          if (item.kind === 'context') return { ...item, state: 'missing' as const }
          if (item.kind === 'plan') return { ...item, state: 'corrupt' as const }
          return item
        }),
        workspacePolicyViolations: ['git_history_changed'],
      },
    }, authority)

    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      status: 'BLOCKED',
      gate: {
        kind: 'blocked',
        reasons: [
          { code: 'evidence_missing', source: 'context' },
          { code: 'evidence_corrupt', source: 'plan' },
          { code: 'workspace_policy_violation', source: 'git_history_changed' },
        ],
      },
    })
  })

  it('requires Rework for blocking review findings and implementation secrets', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-review-failed',
      now: () => '2026-08-22T15:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'gate-review-start',
      input: { objective: 'Respect review and security findings' },
    }, authority)
    let revision = started.revision
    for (const phase of phases) {
      revision = (await kernel.dispatch({
        kind: 'advance',
        missionId: started.missionId,
        expectedRevision: revision,
        to: phase,
      }, authority)).revision
    }

    await kernel.dispatch({
      kind: 'decide_gate',
      missionId: started.missionId,
      expectedRevision: revision,
      input: {
        ...passingInput,
        reviewerFindings: [{ severity: 'blocking', code: 'unsafe-default' }],
        implementationSecretCount: 1,
      },
    }, authority)

    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      status: 'REWORK_REQUIRED',
      gate: {
        kind: 'rework_required',
        reasons: [
          { code: 'reviewer_blocking_finding', source: 'unsafe-default' },
          { code: 'implementation_secret', source: 'implementation' },
        ],
      },
    })
  })

})
