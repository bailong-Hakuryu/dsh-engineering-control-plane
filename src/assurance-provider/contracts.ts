declare const assuranceExecutionContextBrand: unique symbol
declare const assuranceRequestBrand: unique symbol
declare const assuranceSubmissionBrand: unique symbol
declare const externalAssessmentFailureBrand: unique symbol

const PROVIDER_ID = /^[a-z0-9](?:[a-z0-9._-]{0,62})(?:\/[a-z0-9](?:[a-z0-9._-]{0,62})){1,7}$/
const PROVIDER_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,127}$/

/** Namespaced and versioned registration/selection key; not executable identity. */
export interface AssuranceProviderDescriptorV1 {
  readonly schemaVersion: 1
  readonly providerId: string
  readonly providerVersion: string
}

/** Host-owned activation choice; registration or installation grants no authority. */
export type AssuranceProviderActivation = 'disabled' | 'when-available' | 'required'

/** Exact Host Policy selection key frozen into Effective Policy. */
export interface AssuranceProviderActivationPolicyV1 {
  readonly schemaVersion: 1
  readonly descriptor: AssuranceProviderDescriptorV1
  readonly activation: AssuranceProviderActivation
}

/**
 * Attempt-frozen registration selection. This is not a Capability declaration,
 * complete Provider Composition, Assessor Identity, or Gate eligibility proof.
 */
export interface FrozenAssuranceProviderSelectionV1 {
  readonly schemaVersion: 1
  readonly descriptor: AssuranceProviderDescriptorV1
  readonly activation: Exclude<AssuranceProviderActivation, 'disabled'>
}

/** Stable fail-closed classifications for exact runtime Provider resolution. */
export type AssuranceProviderUnavailableCode =
  | 'registration_missing'
  | 'factory_failed'
  | 'invalid_provider'
  | 'descriptor_mismatch'

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactDescriptorKeys(value: Record<string, unknown>): void {
  const allowed = ['schemaVersion', 'providerId', 'providerVersion'] as const
  const allowedSet = new Set<string>(allowed)
  const unknown = Object.keys(value).find(key => !allowedSet.has(key))
  if (unknown !== undefined) {
    throw new TypeError(`Assurance Provider descriptor contains unknown field '${unknown}'`)
  }
  const missing = allowed.find(key => !Object.hasOwn(value, key))
  if (missing !== undefined) {
    throw new TypeError(`Assurance Provider descriptor is missing '${missing}'`)
  }
}

function boundedCanonicalString(value: unknown, label: string, pattern: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || !pattern.test(value)) {
    throw new TypeError(`${label} is not canonical`)
  }
  return value
}

/** Strictly validate, detach, and freeze one startup contribution descriptor. */
export function parseAssuranceProviderDescriptorV1(candidate: unknown): AssuranceProviderDescriptorV1 {
  const value = record(candidate, 'Assurance Provider descriptor')
  exactDescriptorKeys(value)
  if (value.schemaVersion !== 1) {
    throw new TypeError('Assurance Provider descriptor schemaVersion must be 1')
  }
  return Object.freeze({
    schemaVersion: 1,
    providerId: boundedCanonicalString(value.providerId, 'providerId', PROVIDER_ID),
    providerVersion: boundedCanonicalString(value.providerVersion, 'providerVersion', PROVIDER_VERSION),
  })
}

/** Frozen Git Subject metadata exposed without a host filesystem path. */
export interface AssuranceExecutionSubjectV1 {
  readonly kind: 'git_worktree'
  readonly branch: string
  readonly head: string
  readonly workspaceFingerprint: string
}

/** Kernel-issued, non-serializable capability supplied only during assessment. */
export interface AssuranceExecutionContext {
  readonly schemaVersion: 1
  readonly invocationId: string
  readonly missionId: string
  readonly attempt: number
  readonly effectivePolicyDigest: string
  readonly subject: AssuranceExecutionSubjectV1
  readonly [assuranceExecutionContextBrand]: true
}

/** Opaque until the Kernel execution-context slice publishes its strict constructor. */
export interface AssuranceRequestV1 {
  readonly schemaVersion: 1
  readonly [assuranceRequestBrand]: true
}

/** Provider claim carried by a Submission; it is never a Mission Gate decision. */
export type AssuranceClaimedOutcomeV1 = 'satisfied' | 'failed' | 'indeterminate'

/** Credential-free JSON value detached at the Provider boundary. */
export type AssuranceSubmissionJsonV1 =
  | null
  | boolean
  | number
  | string
  | readonly AssuranceSubmissionJsonV1[]
  | { readonly [key: string]: AssuranceSubmissionJsonV1 }

/** Canonical digest envelope used for transport integrity, not assessor eligibility. */
export interface AssuranceSubmissionDigestV1 {
  readonly schemaVersion: 1
  readonly algorithm: 'sha256'
  readonly mediaType: string
  readonly byteLength: number
  readonly canonicalization: 'dsh-canonical-json-v1'
  readonly value: string
}

/** Provider-neutral, credential-free typed JSON artifact embedded by value in one Submission. */
export interface AssuranceSubmissionArtifactV1 {
  readonly artifactId: string
  readonly schemaId: string
  readonly schemaVersion: number
  readonly digest: AssuranceSubmissionDigestV1
  readonly value: AssuranceSubmissionJsonV1
}

/** Artifact draft accepted by the public strict Submission constructor. */
export interface AssuranceSubmissionArtifactDraftV1 {
  readonly artifactId: string
  readonly schemaId: string
  readonly schemaVersion: number
  readonly value: unknown
}

/** Exact invocation facts that prevent cross-Mission, Attempt, Provider, or Subject replay. */
export interface AssuranceSubmissionBindingV1 {
  readonly invocationId: string
  readonly missionId: string
  readonly attempt: number
  readonly provider: AssuranceProviderDescriptorV1
  readonly subject: AssuranceExecutionSubjectV1
  readonly effectivePolicyDigest: string
}

export interface AssuranceSubmissionExternalAssessmentV1 {
  readonly state: 'sealed'
  readonly assessmentId: string
  readonly claimedOutcome: AssuranceClaimedOutcomeV1
}

export interface AssuranceSubmissionPayloadV1 {
  readonly binding: AssuranceSubmissionBindingV1
  readonly externalAssessment: AssuranceSubmissionExternalAssessmentV1
  readonly providerComposition: AssuranceSubmissionArtifactV1
  readonly providerPolicy: AssuranceSubmissionArtifactV1
  readonly coverage: AssuranceSubmissionArtifactV1
  /** Provider-owned domain seal represented as an opaque typed artifact. */
  readonly sourceSeal: AssuranceSubmissionArtifactV1
  readonly provenance: AssuranceSubmissionArtifactV1
  readonly evidence: readonly AssuranceSubmissionArtifactV1[]
}

/** Input whose embedded artifacts and outer payload are canonically digested by the constructor. */
export interface AssuranceSubmissionDraftV1 {
  readonly schemaVersion: 1
  readonly binding: AssuranceSubmissionBindingV1
  readonly externalAssessment: AssuranceSubmissionExternalAssessmentV1
  readonly providerComposition: AssuranceSubmissionArtifactDraftV1
  readonly providerPolicy: AssuranceSubmissionArtifactDraftV1
  readonly coverage: AssuranceSubmissionArtifactDraftV1
  readonly sourceSeal: AssuranceSubmissionArtifactDraftV1
  readonly provenance: AssuranceSubmissionArtifactDraftV1
  readonly evidence: readonly AssuranceSubmissionArtifactDraftV1[]
}

/** Self-contained transport-sealed Provider value; Control Plane still evaluates eligibility. */
export interface AssuranceSubmissionV1 {
  readonly schemaVersion: 1
  readonly payload: AssuranceSubmissionPayloadV1
  readonly digest: AssuranceSubmissionDigestV1
  readonly [assuranceSubmissionBrand]: true
}

/** Stable fail-closed classifications for a fulfilled but ineligible Submission. */
export type AssuranceSubmissionRejectionCode =
  | 'malformed_submission'
  | 'unsupported_schema'
  | 'unsealed_submission'
  | 'invocation_mismatch'
  | 'mission_mismatch'
  | 'attempt_mismatch'
  | 'provider_mismatch'
  | 'subject_mismatch'
  | 'policy_mismatch'
  | 'digest_mismatch'
  | 'redacted_submission'
  | 'submission_too_large'

/** Opaque until the Provider-invocation slice publishes its strict failure parser. */
export interface ExternalAssessmentFailureV1 {
  readonly schemaVersion: 1
  readonly reason: 'blocked' | 'canceled' | 'failed'
  readonly code: string
  readonly [externalAssessmentFailureBrand]: true
}

export interface ProviderInvocationOptions {
  readonly signal?: AbortSignal
}

export type AssuranceProviderOutcomeV1 =
  | {
    readonly kind: 'sealed_submission'
    readonly submission: AssuranceSubmissionV1
  }
  | {
    readonly kind: 'external_failure'
    readonly failure: ExternalAssessmentFailureV1
  }

/** Deep Provider Interface hiding its private assessment lifecycle behind one operation. */
export interface AssuranceProviderV1 {
  readonly descriptor: AssuranceProviderDescriptorV1

  assess(
    context: AssuranceExecutionContext,
    request: AssuranceRequestV1,
    options?: ProviderInvocationOptions,
  ): Promise<AssuranceProviderOutcomeV1>
}

export type AssuranceProviderFactoryV1 = (
  descriptor: AssuranceProviderDescriptorV1,
) => AssuranceProviderV1

export type AssuranceProviderDisposer = () => void
