import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AssuranceProviderInvocationCoordinator } from '../src/assurance-provider/invocation-coordinator.ts'
import { AssuranceProviderRegistry } from '../src/assurance-provider/registry.ts'
import { sealAssuranceSubmissionV1 } from '../src/assurance-provider/submission.ts'
import type {
  AssuranceClaimedOutcomeV1,
  AssuranceExecutionContext,
  AssuranceProviderDescriptorV1,
  AssuranceSubmissionArtifactDraftV1,
} from '../src/assurance-provider/contracts.ts'
import { createFilesystemEvidenceStore } from '../src/evidence/filesystem-store.ts'
import {
  createControlPlaneKernel,
  createInMemoryMissionStore,
  type EffectivePolicy,
  type MissionAuthority,
  type RepositoryIdentity,
  type RoleName,
} from '../src/kernel/index.ts'
import {
  createMissionRunner,
  type MissionExecutionHost,
} from '../src/runner/mission-runner.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const descriptor: AssuranceProviderDescriptorV1 = {
  schemaVersion: 1,
  providerId: 'fixture/gate-provider',
  providerVersion: '1.0.0-fixture.1',
}

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/assurance-gate-fixture',
  branch: 'main',
  head: '1'.repeat(40),
  workspaceFingerprint: `sha256:${'2'.repeat(64)}`,
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: `sha256:${'3'.repeat(64)}`,
  verificationProfile: 'fixture',
  assuranceProviderActivations: [{ schemaVersion: 1, descriptor, activation: 'required' }],
  selectedAssuranceProviders: [{ schemaVersion: 1, descriptor, activation: 'required' }],
  artifactBudgets: {
    maxRecordBytes: 1024 * 1024,
    maxStdoutBytes: 1024 * 1024,
    maxStderrBytes: 1024 * 1024,
    maxUntrackedFiles: 16,
    maxUntrackedBytes: 1024 * 1024,
  },
}

const authority: MissionAuthority = {
  principalId: 'host:assurance-gate-fixture',
  repository,
  actions: ['start', 'read', 'orchestrate', 'rework'],
  leaseHolderId: 'assurance-gate-fixture-host',
  writeLease: { holderId: 'assurance-gate-fixture-host', fencingToken: 1 },
}

const roleOutputs: Readonly<Record<RoleName, unknown>> = {
  planner: {
    schemaVersion: 1,
    outcome: 'planned',
    summary: 'Implement one bounded change and evaluate it.',
    steps: [{ id: 'step-1', objective: 'Implement the change', acceptanceSignals: ['all checks pass'] }],
    risks: ['security'],
    verificationFocus: ['functional', 'negative', 'regression', 'security'],
  },
  developer: {
    schemaVersion: 1,
    outcome: 'implemented',
    summary: 'Implemented the bounded change.',
    changedAreas: ['src/feature.ts'],
    notes: [],
  },
  tester: {
    schemaVersion: 1,
    outcome: 'assessed',
    summary: 'All host checks passed.',
    findings: [],
  },
  reviewer: {
    schemaVersion: 1,
    outcome: 'reviewed',
    summary: 'No blocking engineering finding remains.',
    findings: [],
  },
}

function submissionFor(
  context: AssuranceExecutionContext,
  claimedOutcome: AssuranceClaimedOutcomeV1,
  completeCoverage = true,
) {
  const evidence: readonly AssuranceSubmissionArtifactDraftV1[] = [{
    artifactId: 'fixture-evidence-1',
    schemaId: 'fixture/security-evidence',
    schemaVersion: 1,
    value: { check: 'fixture/security-check', outcome: claimedOutcome },
  }]
  const draft = {
    schemaVersion: 1 as const,
    binding: {
      invocationId: context.invocationId,
      missionId: context.missionId,
      attempt: context.attempt,
      provider: descriptor,
      subject: context.subject,
      effectivePolicyDigest: context.effectivePolicyDigest,
    },
    externalAssessment: {
      state: 'sealed' as const,
      assessmentId: 'fixture-external-assessment-1',
      claimedOutcome,
    },
    providerComposition: {
      artifactId: 'fixture-composition-1',
      schemaId: 'dsh/assurance-provider-composition',
      schemaVersion: 1,
      value: {
        schemaVersion: 1,
        provider: descriptor,
        components: [{ componentId: 'fixture/reference-engine', componentVersion: '1.0.0' }],
      },
    },
    providerPolicy: {
      artifactId: 'fixture-policy-1',
      schemaId: 'dsh/assurance-provider-policy',
      schemaVersion: 1,
      value: { schemaVersion: 1, effectivePolicyDigest: context.effectivePolicyDigest },
    },
    coverage: {
      artifactId: 'fixture-coverage-1',
      schemaId: 'dsh/assurance-provider-coverage',
      schemaVersion: 1,
      value: {
        schemaVersion: 1,
        status: completeCoverage ? 'complete' : 'incomplete',
        dimensions: [{
          dimensionId: 'fixture/security-check',
          status: completeCoverage ? 'covered' : 'not_covered',
        }],
      },
    },
    provenance: {
      artifactId: 'fixture-provenance-1',
      schemaId: 'dsh/assurance-provider-provenance',
      schemaVersion: 1,
      value: {
        schemaVersion: 1,
        assessor: { kind: 'machine_provider', provider: descriptor },
      },
    },
    evidence,
  }
  const provisional = sealAssuranceSubmissionV1({
    ...draft,
    sourceSeal: {
      artifactId: 'fixture-source-seal-1',
      schemaId: 'dsh/assurance-provider-source-seal',
      schemaVersion: 1,
      value: { schemaVersion: 1, state: 'sealed', subject: context.subject, evidenceDigests: [] },
    },
  })
  return sealAssuranceSubmissionV1({
    ...draft,
    sourceSeal: {
      artifactId: 'fixture-source-seal-1',
      schemaId: 'dsh/assurance-provider-source-seal',
      schemaVersion: 1,
      value: {
        schemaVersion: 1,
        state: 'sealed',
        subject: context.subject,
        evidenceDigests: provisional.payload.evidence.map(item => item.digest.value),
      },
    },
  })
}

describe('MissionRunner external Assurance Gate closure', () => {
  it.each([
    {
      caseName: 'eligible satisfied',
      claimedOutcome: 'satisfied' as const,
      completeCoverage: true,
      expectedAssuranceOutcome: 'satisfied' as const,
      expectedReasonCodes: ['eligible_submission'],
      expectedStatus: 'APPROVED' as const,
      expectedGate: { kind: 'approved', reasons: [] },
    },
    {
      caseName: 'eligible failed',
      claimedOutcome: 'failed' as const,
      completeCoverage: true,
      expectedAssuranceOutcome: 'failed' as const,
      expectedReasonCodes: ['eligible_submission'],
      expectedStatus: 'REWORK_REQUIRED' as const,
      expectedGate: {
        kind: 'rework_required',
        reasons: [{
          code: 'assurance_failed',
          source: 'external-provider:fixture/gate-provider@1.0.0-fixture.1',
        }],
      },
    },
    {
      caseName: 'eligible indeterminate',
      claimedOutcome: 'indeterminate' as const,
      completeCoverage: true,
      expectedAssuranceOutcome: 'indeterminate' as const,
      expectedReasonCodes: ['eligible_submission'],
      expectedStatus: 'BLOCKED' as const,
      expectedGate: {
        kind: 'blocked',
        reasons: [{
          code: 'assurance_indeterminate',
          source: 'external-provider:fixture/gate-provider@1.0.0-fixture.1',
        }],
      },
    },
    {
      caseName: 'satisfied claim with incomplete coverage',
      claimedOutcome: 'satisfied' as const,
      completeCoverage: false,
      expectedAssuranceOutcome: 'indeterminate' as const,
      expectedReasonCodes: ['coverage_invalid'],
      expectedStatus: 'BLOCKED' as const,
      expectedGate: {
        kind: 'blocked',
        reasons: [{
          code: 'assurance_indeterminate',
          source: 'external-provider:fixture/gate-provider@1.0.0-fixture.1',
        }],
      },
    },
  ])('maps $caseName through Kernel-owned Assessment, Result, and Gate', async ({
    caseName,
    claimedOutcome,
    completeCoverage,
    expectedAssuranceOutcome,
    expectedReasonCodes,
    expectedStatus,
    expectedGate,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-control-plane-assurance-gate-'))
    temporaryRoots.push(root)
    const store = createInMemoryMissionStore()
    const kernel = createControlPlaneKernel({
      store,
      nextMissionId: () => `mission-assurance-gate-${caseName.replaceAll(' ', '-')}`,
      now: () => '2026-08-23T04:45:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const evidenceStore = createFilesystemEvidenceStore({
      root,
      nextRecordId: (() => {
        let sequence = 0
        return () => `assurance-gate-record-${++sequence}`
      })(),
      now: () => '2026-08-23T04:45:00.000Z',
    })
    const registry = new AssuranceProviderRegistry()
    let observedContext: AssuranceExecutionContext | undefined
    registry.register(descriptor, normalizedDescriptor => ({
      descriptor: normalizedDescriptor,
      async assess(context) {
        observedContext = context
        return {
          kind: 'sealed_submission',
          submission: submissionFor(context, claimedOutcome, completeCoverage),
        }
      },
    }))
    registry.closeRegistration()
    const coordinator = new AssuranceProviderInvocationCoordinator({
      kernel,
      registry,
      evidenceStore,
      maxSubmissionBytes: 1024 * 1024,
      onError: () => {},
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: `assurance-gate-${caseName}`,
      input: { objective: 'Decide Gate only through Kernel-owned assurance truth' },
    }, authority)
    const postImplementationFingerprint = `sha256:${'9'.repeat(64)}`
    const host: MissionExecutionHost = {
      evidenceStore,
      roleExecutor: {
        start(request) {
          return Promise.resolve({
            trace: { provider: 'scripted', providerRunId: `scripted-${request.role}` },
            result: Promise.resolve({
              stopReason: 'completed',
              structured: roleOutputs[request.role],
              workspacePolicyViolations: [],
            }),
            dispose: () => Promise.resolve(),
          })
        },
      },
      captureImplementation: () => Promise.resolve({
        payload: { schemaVersion: 1, changedFiles: ['src/feature.ts'] },
        subject: {
          kind: 'git_worktree',
          branch: repository.branch,
          head: repository.head,
          workspaceFingerprint: postImplementationFingerprint,
          producedChangeFingerprint: `sha256:${'3'.repeat(64)}`,
        },
        implementationSecretCount: 0,
        workspacePolicyViolations: [],
      }),
      runVerifications: () => Promise.resolve({
        payload: { schemaVersion: 1, profile: 'fixture' },
        outcomes: [
          { category: 'functional', outcome: 'passed' },
          { category: 'negative', outcome: 'passed' },
          { category: 'regression', outcome: 'passed' },
          { category: 'security', outcome: 'passed' },
        ],
      }),
      runAssuranceProviders: (snapshot, currentAuthority, signal) => (
        coordinator.execute(snapshot, currentAuthority, signal)
      ),
    }
    const runner = createMissionRunner({ kernel, store, authorityFor: () => authority })

    try {
      await runner.launch(started.missionId, authority, host).settled
      const snapshot = await kernel.snapshot(started.missionId, authority)

      expect(observedContext?.subject.workspaceFingerprint).toBe(postImplementationFingerprint)
      expect(snapshot).toMatchObject({
        status: expectedStatus,
        assuranceAssessments: [{
          assessor: { kind: 'machine_provider', provider: descriptor },
          outcome: expectedAssuranceOutcome,
          reasonCodes: expectedReasonCodes,
        }],
        assuranceResults: [{
          requirementId: 'external-provider:fixture/gate-provider@1.0.0-fixture.1',
          outcome: expectedAssuranceOutcome,
        }],
        gate: expectedGate,
      })
      if (claimedOutcome === 'failed') {
        const reworked = await kernel.dispatch({
          kind: 'rework',
          missionId: snapshot.missionId,
          expectedRevision: snapshot.revision,
          instructions: 'Address the failed external assurance requirement.',
        }, authority)
        expect(reworked).toMatchObject({ status: 'PLANNING', attempt: 2 })
        const attempt2 = await kernel.snapshot(snapshot.missionId, authority)
        expect(attempt2.assuranceProviderSelections).toEqual([
          expect.objectContaining({ attempt: 1 }),
          expect.objectContaining({
            attempt: 2,
            providers: [{ schemaVersion: 1, descriptor, activation: 'required' }],
          }),
        ])
        expect(attempt2.assuranceProviderInvocations).toEqual([
          expect.objectContaining({ attempt: 1, state: 'settled' }),
          expect.objectContaining({ attempt: 2, state: 'prepared' }),
        ])
        expect(attempt2.assuranceSubjects).toEqual([expect.objectContaining({ attempt: 1 })])
        expect(attempt2.assuranceResults).toEqual([expect.objectContaining({ attempt: 1 })])
      }
    } finally {
      await runner.dispose()
      coordinator.dispose()
    }
  })
})
