import { describe, expect, it } from 'vitest'
import { sealAssuranceSubmissionV1 } from '../src/assurance-provider.ts'

function goldenDraft() {
  return {
    schemaVersion: 1 as const,
    binding: {
      invocationId: 'mission-01234567-89ab-4cde-8f01-23456789abcd:assurance:1:1',
      missionId: 'mission-01234567-89ab-4cde-8f01-23456789abcd',
      attempt: 1,
      provider: {
        schemaVersion: 1 as const,
        providerId: 'fixture/golden',
        providerVersion: '1.0.0',
      },
      subject: {
        kind: 'git_worktree' as const,
        branch: 'main',
        head: '0123456789abcdef0123456789abcdef01234567',
        workspaceFingerprint: `sha256:${'1'.repeat(64)}`,
      },
      effectivePolicyDigest: `sha256:${'2'.repeat(64)}`,
    },
    externalAssessment: {
      state: 'sealed' as const,
      assessmentId: 'assessment-1',
      claimedOutcome: 'failed' as const,
    },
    providerComposition: {
      artifactId: 'composition-1',
      schemaId: 'fixture/provider-composition',
      schemaVersion: 1,
      value: { b: 2, a: '雪' },
    },
    providerPolicy: {
      artifactId: 'policy-1',
      schemaId: 'fixture/provider-policy',
      schemaVersion: 1,
      value: { profile: 'strict' },
    },
    coverage: {
      artifactId: 'coverage-1',
      schemaId: 'fixture/provider-coverage',
      schemaVersion: 1,
      value: { checks: ['b', 'a'], complete: true },
    },
    sourceSeal: {
      artifactId: 'source-seal-1',
      schemaId: 'fixture/provider-source-seal',
      schemaVersion: 1,
      value: { algorithm: 'fixture', digest: `sha256:${'3'.repeat(64)}` },
    },
    provenance: {
      artifactId: 'provenance-1',
      schemaId: 'fixture/provider-provenance',
      schemaVersion: 1,
      value: { assessor: 'fixture/assessor', run: 1 },
    },
    evidence: [{
      artifactId: 'evidence-1',
      schemaId: 'fixture/provider-evidence',
      schemaVersion: 1,
      value: { findingCount: 1, outcome: 'failed' },
    }],
  }
}

describe('Assurance Submission digest contract', () => {
  it('matches the fixed cross-plugin digest vector', () => {
    const submission = sealAssuranceSubmissionV1(goldenDraft())

    expect({
      providerComposition: submission.payload.providerComposition.digest,
      providerPolicy: submission.payload.providerPolicy.digest,
      coverage: submission.payload.coverage.digest,
      sourceSeal: submission.payload.sourceSeal.digest,
      provenance: submission.payload.provenance.digest,
      evidence: submission.payload.evidence[0]?.digest,
      submission: submission.digest,
    }).toEqual({
      providerComposition: {
        schemaVersion: 1,
        algorithm: 'sha256',
        mediaType: 'application/json',
        byteLength: 116,
        canonicalization: 'dsh-canonical-json-v1',
        value: 'sha256:5fe481f0b61c0e8d4c86fee390e60dcfc91959dca803404b7de70b1b3d7f1269',
      },
      providerPolicy: {
        schemaVersion: 1,
        algorithm: 'sha256',
        mediaType: 'application/json',
        byteLength: 109,
        canonicalization: 'dsh-canonical-json-v1',
        value: 'sha256:bce56ad55fe4a807b64b8690397c1ac4011cbcbdfe4c26e5418b06c585f0aca0',
      },
      coverage: {
        schemaVersion: 1,
        algorithm: 'sha256',
        mediaType: 'application/json',
        byteLength: 129,
        canonicalization: 'dsh-canonical-json-v1',
        value: 'sha256:4c1f0bbb0bc6316bf783178407c36fd8c000b74b44d9ca00bc462665d1931b2f',
      },
      sourceSeal: {
        schemaVersion: 1,
        algorithm: 'sha256',
        mediaType: 'application/json',
        byteLength: 205,
        canonicalization: 'dsh-canonical-json-v1',
        value: 'sha256:ceff9892db5b501da7ca475d556686e51c95d597ec9c4b7eed1ca437e543f317',
      },
      provenance: {
        schemaVersion: 1,
        algorithm: 'sha256',
        mediaType: 'application/json',
        byteLength: 136,
        canonicalization: 'dsh-canonical-json-v1',
        value: 'sha256:05ffec20af0591ed68fb8937f679a46a28a66750a30d384b65ca0089b0873f02',
      },
      evidence: {
        schemaVersion: 1,
        algorithm: 'sha256',
        mediaType: 'application/json',
        byteLength: 130,
        canonicalization: 'dsh-canonical-json-v1',
        value: 'sha256:7d3e3283108bbd4b62f7aed68869dbf4f7194e2cb4dd6b3cf64304fbf9e5dacc',
      },
      submission: {
        schemaVersion: 1,
        algorithm: 'sha256',
        mediaType: 'application/vnd.dsh.assurance-submission-payload+json',
        byteLength: 2896,
        canonicalization: 'dsh-canonical-json-v1',
        value: 'sha256:32843bbfd5ce26584b1a19a655ce01c9866c1df2c938e1981baf8b0762effce9',
      },
    })
  })

  it('does not interpret a high-entropy structural binding identifier as a credential', () => {
    const draft = goldenDraft()
    const missionId = 'mission-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-'

    const submission = sealAssuranceSubmissionV1({
      ...draft,
      binding: { ...draft.binding, missionId },
    })

    expect(submission.payload.binding.missionId).toBe(missionId)
  })

  it('permits cryptographic material under an explicit source-seal signature field', () => {
    const draft = goldenDraft()
    const signature = 'eyJhbGciOiJFZERTQSJ9.eyJkaWdlc3QiOiJmaXh0dXJlIn0.c2lnbmF0dXJlLWZpeHR1cmU'

    const submission = sealAssuranceSubmissionV1({
      ...draft,
      sourceSeal: {
        ...draft.sourceSeal,
        value: { ...draft.sourceSeal.value, signature },
      },
    })

    expect(submission.payload.sourceSeal.value).toMatchObject({ signature })
  })

  it('permits explicit non-secret authentication and signing-key references', () => {
    const draft = goldenDraft()

    const submission = sealAssuranceSubmissionV1({
      ...draft,
      providerComposition: {
        ...draft.providerComposition,
        value: {
          ...draft.providerComposition.value,
          authentication: 'none',
          signingKey: 'host-key-ref',
        },
      },
    })

    expect(submission.payload.providerComposition.value).toMatchObject({
      authentication: 'none',
      signingKey: 'host-key-ref',
    })
  })
})
