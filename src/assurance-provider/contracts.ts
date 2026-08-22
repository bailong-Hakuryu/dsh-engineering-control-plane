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

/** Opaque until the Submission-validation slice publishes its strict parser. */
export interface AssuranceSubmissionV1 {
  readonly schemaVersion: 1
  readonly [assuranceSubmissionBrand]: true
}

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
