import { describe, expect, it } from 'vitest'
import {
  createControlPlaneKernel,
  createInMemoryMissionStore,
  type ControlPlaneKernel,
  type EffectivePolicy,
  type MissionAuthority,
  type MissionCommand,
  type MissionReceipt,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'
import { parseExternalAssessmentFailureV1 } from '../src/assurance-provider.ts'

const descriptor = {
  schemaVersion: 1 as const,
  providerId: 'fixture/kernel-terminal-provider',
  providerVersion: '1.0.0-fixture.1',
}

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/kernel-terminal-fixture',
  branch: 'main',
  head: '1'.repeat(40),
  workspaceFingerprint: `sha256:${'2'.repeat(64)}`,
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: `sha256:${'3'.repeat(64)}`,
  verificationProfile: 'fixture',
  assuranceProviderActivations: [{
    schemaVersion: 1,
    descriptor,
    activation: 'required',
  }],
  selectedAssuranceProviders: [{
    schemaVersion: 1,
    descriptor,
    activation: 'required',
  }],
}

const authority: MissionAuthority = {
  principalId: 'host:kernel-terminal-fixture',
  repository,
  actions: ['start', 'read', 'orchestrate'],
  leaseHolderId: 'kernel-terminal-fixture-host',
  writeLease: { holderId: 'kernel-terminal-fixture-host', fencingToken: 1 },
}

async function freezePostImplementationSubject(
  kernel: ControlPlaneKernel,
  started: MissionReceipt,
) {
  let revision = started.revision
  for (const to of ['ANALYZING', 'PLANNING', 'IMPLEMENTING'] as const) {
    revision = (await kernel.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: revision,
      to,
    }, authority)).revision
  }
  const implementationEvidence = {
    recordId: `${started.missionId}:implementation`,
    missionId: started.missionId,
    attempt: 1,
    kind: 'implementation',
    schemaVersion: 1,
    digest: `sha256:${'4'.repeat(64)}`,
    byteLength: 1,
    relativePath: `${started.missionId}/attempt-0001/implementation.json`,
    redacted: false,
    createdAt: '2026-08-23T03:45:00.000Z',
  }
  revision = (await kernel.dispatch({
    kind: 'record_evidence',
    missionId: started.missionId,
    expectedRevision: revision,
    record: implementationEvidence,
  }, authority)).revision
  await kernel.dispatch({
    kind: 'freeze_assurance_subject',
    missionId: started.missionId,
    expectedRevision: revision,
    implementationEvidenceRecordId: implementationEvidence.recordId,
    subject: {
      kind: 'git_worktree',
      branch: repository.branch,
      head: repository.head,
      workspaceFingerprint: `sha256:${'5'.repeat(64)}`,
    },
  }, authority)
  return kernel.snapshot(started.missionId, authority)
}

describe('ControlPlaneKernel Assurance Provider terminal outcomes', () => {
  it('freezes Provider obligations without blocking engineering execution at Mission Start', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-kernel-provider-obligation',
      now: () => '2026-08-23T03:45:00.000Z',
      resolveEffectivePolicy: () => policy,
    })

    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'kernel-provider-obligation',
      input: { objective: 'Freeze assurance without assessing the baseline Subject' },
    }, authority)

    expect(started).toMatchObject({ revision: 1, status: 'CREATED', attempt: 1 })
    const snapshot = await kernel.snapshot(started.missionId, authority)
    expect(snapshot).toMatchObject({
      status: 'CREATED',
      writeLease: {
        fencingToken: 1,
        holderId: 'kernel-terminal-fixture-host',
        acquiredAt: '2026-08-23T03:45:00.000Z',
      },
      assuranceProviderInvocations: [{ state: 'prepared' }],
    })
    expect(snapshot.blocked).toBeUndefined()
  })

  it('records registration loss that occurs after durable begin admission', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-kernel-unavailable-after-begin',
      now: () => '2026-08-23T03:45:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'kernel-unavailable-after-begin',
      input: { objective: 'Persist registration loss after admission' },
    }, authority)
    const prepared = await freezePostImplementationSubject(kernel, started)
    const invocationId = prepared.assuranceProviderInvocations?.[0]?.invocationId
    if (invocationId === undefined) throw new Error('Fixture Invocation is missing')
    const begun = await kernel.dispatch({
      kind: 'begin_assurance_provider_invocation',
      missionId: prepared.missionId,
      expectedRevision: prepared.revision,
      invocationId,
    }, authority)

    await kernel.dispatch({
      kind: 'mark_assurance_provider_invocation_unavailable',
      missionId: begun.missionId,
      expectedRevision: begun.revision,
      invocationId,
      expectedState: 'begun',
      failureCode: 'registration_missing',
    }, authority)

    await expect(kernel.snapshot(begun.missionId, authority)).resolves.toMatchObject({
      assuranceProviderInvocations: [{
        invocationId,
        state: 'unavailable',
        begunAt: '2026-08-23T03:45:00.000Z',
        unavailableAt: '2026-08-23T03:45:00.000Z',
        failureCode: 'registration_missing',
      }],
    })
  })

  it("does not let a pre-resolution failure overwrite another owner's begun admission", async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-kernel-stale-unavailable',
      now: () => '2026-08-23T03:45:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'kernel-stale-unavailable',
      input: { objective: 'Reject stale prepared-state failure ownership' },
    }, authority)
    const prepared = await freezePostImplementationSubject(kernel, started)
    const invocationId = prepared.assuranceProviderInvocations?.[0]?.invocationId
    if (invocationId === undefined) throw new Error('Fixture Invocation is missing')
    const begun = await kernel.dispatch({
      kind: 'begin_assurance_provider_invocation',
      missionId: prepared.missionId,
      expectedRevision: prepared.revision,
      invocationId,
    }, authority)

    await expect(kernel.dispatch({
      kind: 'mark_assurance_provider_invocation_unavailable',
      missionId: begun.missionId,
      expectedRevision: begun.revision,
      invocationId,
      expectedState: 'prepared',
      failureCode: 'registration_missing',
    }, authority)).rejects.toMatchObject({ code: 'illegal_transition' })
    await expect(kernel.snapshot(begun.missionId, authority)).resolves.toMatchObject({
      revision: begun.revision,
      assuranceProviderInvocations: [{ invocationId, state: 'begun' }],
    })
  })

  it('derives a Kernel-owned Assessment and Result from one eligible settled invocation', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-kernel-assurance-result',
      now: () => '2026-08-23T03:45:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'kernel-assurance-result',
      input: { objective: 'Derive Control Plane assurance truth' },
    }, authority)
    let snapshot = await freezePostImplementationSubject(kernel, started)
    const invocationId = snapshot.assuranceProviderInvocations?.[0]?.invocationId
    const subject = snapshot.assuranceSubjects?.[0]?.subject
    if (invocationId === undefined || subject === undefined) throw new Error('Fixture assurance identity is missing')
    await kernel.dispatch({
      kind: 'begin_assurance_provider_invocation',
      missionId: snapshot.missionId,
      expectedRevision: snapshot.revision,
      invocationId,
    }, authority)
    snapshot = await kernel.snapshot(snapshot.missionId, authority)
    const submissionEvidence = {
      recordId: 'submission-evidence-1',
      missionId: snapshot.missionId,
      attempt: 1,
      kind: 'assurance-provider-submission',
      schemaVersion: 1,
      digest: `sha256:${'6'.repeat(64)}`,
      byteLength: 1,
      relativePath: `${snapshot.missionId}/attempt-0001/submission.json`,
      redacted: false,
      createdAt: '2026-08-23T03:45:00.000Z',
    }
    await kernel.dispatch({
      kind: 'settle_assurance_provider_invocation',
      missionId: snapshot.missionId,
      expectedRevision: snapshot.revision,
      invocationId,
      outcome: {
        kind: 'sealed_submission',
        binding: {
          invocationId,
          missionId: snapshot.missionId,
          attempt: 1,
          provider: descriptor,
          subject,
          effectivePolicyDigest: snapshot.effectivePolicyDigest,
        },
        submissionDigest: `sha256:${'7'.repeat(64)}`,
        claimedOutcome: 'satisfied',
        evidenceRecord: submissionEvidence,
      },
    }, authority)
    snapshot = await kernel.snapshot(snapshot.missionId, authority)
    for (const to of ['VERIFYING', 'REVIEWING'] as const) {
      await kernel.dispatch({
        kind: 'advance',
        missionId: snapshot.missionId,
        expectedRevision: snapshot.revision,
        to,
      }, authority)
      snapshot = await kernel.snapshot(snapshot.missionId, authority)
    }

    await kernel.dispatch({
      kind: 'evaluate_assurance_provider_invocations',
      missionId: snapshot.missionId,
      expectedRevision: snapshot.revision,
      eligibilities: [{ invocationId, kind: 'eligible' }],
    } as MissionCommand, authority)

    await expect(kernel.snapshot(snapshot.missionId, authority)).resolves.toMatchObject({
      assuranceAssessments: [{
        schemaVersion: 1,
        assessmentId: `${invocationId}:assessment:1`,
        invocationId,
        attempt: 1,
        assessor: { kind: 'machine_provider', provider: descriptor },
        outcome: 'satisfied',
        reasonCodes: ['eligible_submission'],
        evidenceRecordIds: ['submission-evidence-1'],
      }],
      assuranceResults: [{
        schemaVersion: 1,
        requirementId: 'external-provider:fixture/kernel-terminal-provider@1.0.0-fixture.1',
        attempt: 1,
        outcome: 'satisfied',
        assessmentIds: [`${invocationId}:assessment:1`],
      }],
    })
  })

  it.each([
    { reason: 'blocked' as const, reasonCode: 'external_assessment_blocked' },
    { reason: 'canceled' as const, reasonCode: 'external_assessment_canceled' },
    { reason: 'failed' as const, reasonCode: 'external_assessment_failed' },
  ])('derives indeterminate assurance from an external $reason failure', async ({ reason, reasonCode }) => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => `mission-kernel-external-${reason}`,
      now: () => '2026-08-23T03:45:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: `kernel-external-${reason}`,
      input: { objective: `Derive indeterminate assurance from external ${reason}` },
    }, authority)
    let snapshot = await freezePostImplementationSubject(kernel, started)
    const invocationId = snapshot.assuranceProviderInvocations?.[0]?.invocationId
    if (invocationId === undefined) throw new Error('Fixture Invocation is missing')
    await kernel.dispatch({
      kind: 'begin_assurance_provider_invocation',
      missionId: snapshot.missionId,
      expectedRevision: snapshot.revision,
      invocationId,
    }, authority)
    snapshot = await kernel.snapshot(snapshot.missionId, authority)
    await kernel.dispatch({
      kind: 'settle_assurance_provider_invocation',
      missionId: snapshot.missionId,
      expectedRevision: snapshot.revision,
      invocationId,
      outcome: {
        kind: 'external_failure',
        failure: parseExternalAssessmentFailureV1({
          schemaVersion: 1,
          reason,
          code: `fixture_${reason}`,
        }),
      },
    }, authority)
    snapshot = await kernel.snapshot(snapshot.missionId, authority)
    for (const to of ['VERIFYING', 'REVIEWING'] as const) {
      await kernel.dispatch({
        kind: 'advance',
        missionId: snapshot.missionId,
        expectedRevision: snapshot.revision,
        to,
      }, authority)
      snapshot = await kernel.snapshot(snapshot.missionId, authority)
    }
    await kernel.dispatch({
      kind: 'evaluate_assurance_provider_invocations',
      missionId: snapshot.missionId,
      expectedRevision: snapshot.revision,
      eligibilities: [],
    }, authority)

    await expect(kernel.snapshot(snapshot.missionId, authority)).resolves.toMatchObject({
      assuranceProviderInvocations: [{
        state: 'external_failed',
        failure: { schemaVersion: 1, reason, code: `fixture_${reason}` },
      }],
      assuranceAssessments: [{
        outcome: 'indeterminate',
        reasonCodes: [reasonCode],
        evidenceRecordIds: [],
      }],
      assuranceResults: [{
        outcome: 'indeterminate',
        reasonCodes: [reasonCode],
      }],
    })
  })

  it.each([
    {
      name: 'an unknown terminal kind',
      outcome: { kind: 'unknown_terminal', failureCode: 'malformed_submission' },
      message: 'Assurance Provider terminal outcome kind is invalid',
    },
    {
      name: 'an unknown import failure code',
      outcome: { kind: 'import_failed', failureCode: 'provider_claimed_failure' },
      message: 'Assurance Submission import failureCode is invalid',
    },
    {
      name: 'a malformed external assessment failure',
      outcome: {
        kind: 'external_failure',
        failure: { schemaVersion: 1, reason: 'blocked', code: 'INVALID_CODE' },
      },
      message: 'External Assessment Failure code is invalid',
    },
  ])('rejects $name before mutating the begun Invocation', async ({ outcome, message }) => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-kernel-terminal',
      now: () => '2026-08-23T03:45:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: `kernel-terminal:${outcome.kind}`,
      input: { objective: 'Reject forged terminal Provider outcomes' },
    }, authority)
    const prepared = await freezePostImplementationSubject(kernel, started)
    const invocationId = prepared.assuranceProviderInvocations?.[0]?.invocationId
    if (invocationId === undefined) throw new Error('Fixture Invocation is missing')
    const begun = await kernel.dispatch({
      kind: 'begin_assurance_provider_invocation',
      missionId: prepared.missionId,
      expectedRevision: prepared.revision,
      invocationId,
    }, authority)
    const forged = {
      kind: 'settle_assurance_provider_invocation',
      missionId: begun.missionId,
      expectedRevision: begun.revision,
      invocationId,
      outcome,
    } as unknown as MissionCommand

    await expect(kernel.dispatch(forged, authority)).rejects.toThrow(message)
    await expect(kernel.snapshot(begun.missionId, authority)).resolves.toMatchObject({
      revision: begun.revision,
      assuranceProviderInvocations: [{ state: 'begun' }],
    })
  })
})
