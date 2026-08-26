import { describe, expect, it } from 'vitest'
import {
  sealAssuranceSubmissionV1,
  validateAssuranceSubmissionV1,
  type AssuranceSubmissionBindingV1,
} from '../src/assurance-provider.ts'

const binding: AssuranceSubmissionBindingV1 = {
  invocationId: 'invocation-public-contract-1',
  missionId: 'mission-public-contract-1',
  attempt: 1,
  provider: {
    schemaVersion: 1,
    providerId: 'fixture/public-contract-provider',
    providerVersion: '1.0.0',
  },
  subject: {
    kind: 'git_worktree',
    branch: 'main',
    head: 'a'.repeat(40),
    workspaceFingerprint: `sha256:${'b'.repeat(64)}`,
  },
  effectivePolicyDigest: `sha256:${'c'.repeat(64)}`,
}

function submission() {
  const evidence = [{
    artifactId: 'public-contract-evidence-1',
    schemaId: 'fixture/public-contract-evidence',
    schemaVersion: 1,
    value: { outcome: 'satisfied' },
  }] as const
  const common = {
    schemaVersion: 1 as const,
    binding,
    externalAssessment: {
      state: 'sealed' as const,
      assessmentId: 'public-contract-assessment-1',
      claimedOutcome: 'satisfied' as const,
    },
    providerComposition: {
      artifactId: 'public-contract-composition-1',
      schemaId: 'dsh/assurance-provider-composition',
      schemaVersion: 1,
      value: { provider: binding.provider },
    },
    providerPolicy: {
      artifactId: 'public-contract-policy-1',
      schemaId: 'dsh/assurance-provider-policy',
      schemaVersion: 1,
      value: { effectivePolicyDigest: binding.effectivePolicyDigest },
    },
    coverage: {
      artifactId: 'public-contract-coverage-1',
      schemaId: 'dsh/assurance-provider-coverage',
      schemaVersion: 1,
      value: { status: 'complete' },
    },
    provenance: {
      artifactId: 'public-contract-provenance-1',
      schemaId: 'dsh/assurance-provider-provenance',
      schemaVersion: 1,
      value: { assessor: binding.provider },
    },
    evidence,
  }
  const provisional = sealAssuranceSubmissionV1({
    ...common,
    sourceSeal: {
      artifactId: 'public-contract-source-seal-1',
      schemaId: 'dsh/assurance-provider-source-seal',
      schemaVersion: 1,
      value: { evidenceDigests: [] },
    },
  })
  return sealAssuranceSubmissionV1({
    ...common,
    sourceSeal: {
      artifactId: 'public-contract-source-seal-1',
      schemaId: 'dsh/assurance-provider-source-seal',
      schemaVersion: 1,
      value: { evidenceDigests: provisional.payload.evidence.map(item => item.digest.value) },
    },
  })
}

describe('public Assurance Provider contract', () => {
  it('validates a sealed Provider result against exact Kernel-issued binding facts', () => {
    const candidate = submission()
    const validated = validateAssuranceSubmissionV1(candidate, binding)

    expect(validated).toMatchObject({
      binding,
      claimedOutcome: 'satisfied',
      submissionDigest: candidate.digest.value,
    })
    expect(Object.isFrozen(validated)).toBe(true)
    expect(() => validateAssuranceSubmissionV1(candidate, {
      ...binding,
      missionId: 'mission-replay-target',
    })).toThrow('missionId does not match')
  })
})
