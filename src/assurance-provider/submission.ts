import { createHash } from 'node:crypto'
import {
  canonicalizeEvidence,
  EvidenceStoreError,
} from '../evidence/filesystem-store.js'
import {
  parseAssuranceProviderDescriptorV1,
  type AssuranceClaimedOutcomeV1,
  type AssuranceProviderDescriptorV1,
  type AssuranceSubmissionArtifactV1,
  type AssuranceSubmissionBindingV1,
  type AssuranceSubmissionDigestV1,
  type AssuranceSubmissionDraftV1,
  type AssuranceSubmissionExternalAssessmentV1,
  type AssuranceSubmissionJsonV1,
  type AssuranceSubmissionPayloadV1,
  type AssuranceSubmissionRejectionCode,
  type AssuranceSubmissionV1,
} from './contracts.js'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SCHEMA_ID = /^[a-z0-9](?:[a-z0-9._-]{0,62})(?:\/[a-z0-9](?:[a-z0-9._-]{0,62})){1,7}$/u
const SHA256 = /^sha256:[0-9a-f]{64}$/u
const ARTIFACT_MEDIA_TYPE = 'application/json'
const SUBMISSION_MEDIA_TYPE = 'application/vnd.dsh.assurance-submission-payload+json'
const CANONICALIZATION = 'dsh-canonical-json-v1'
const DEFAULT_MAX_SUBMISSION_BYTES = 16 * 1024 * 1024
const SUBMISSION_SENSITIVE_KEY = /^(?:access_key|access_token|api_key|apikey|api_token|auth|authentication|authorization|auth_header|bearer|client_secret|cookie|credential|credentials|password|passwd|private_key|refresh_token|secret|secret_key|session_key|signing_key|ssh_key|token)$/u
const OPTIONAL_CREDENTIAL_METADATA_KEY = /^(?:auth|authentication|signing_key)$/u
const HIGH_ENTROPY_SAFE_KEY = /^(?:checksum|commit|digest|fingerprint|hash|head|public_key|root|signature)$/u
const KNOWN_CREDENTIAL_VALUES = [
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
  /\b(?:rk|sk|xox[baprs])-[A-Za-z0-9_-]{16,}\b/u,
  /\bBearer[\t ]+[A-Za-z0-9._~+/-]{16,}=*/iu,
] as const
const COMPACT_JOSE = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u

/** Package-private validation result safe to publish without retaining Provider object identity. */
export interface ValidatedAssuranceSubmissionV1 {
  readonly submission: AssuranceSubmissionV1
  readonly binding: AssuranceSubmissionBindingV1
  readonly claimedOutcome: AssuranceClaimedOutcomeV1
  readonly submissionDigest: string
}

/** Stable validation error persisted only as a safe rejection code. */
export class AssuranceSubmissionValidationError extends TypeError {
  constructor(
    readonly code: AssuranceSubmissionRejectionCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'AssuranceSubmissionValidationError'
  }
}

function invalid(
  code: AssuranceSubmissionRejectionCode,
  message: string,
  options?: ErrorOptions,
): AssuranceSubmissionValidationError {
  return new AssuranceSubmissionValidationError(code, message, options)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid('malformed_submission', `${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  missingCode: AssuranceSubmissionRejectionCode = 'malformed_submission',
): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).find(key => !allowedSet.has(key))
  if (unknown !== undefined) {
    throw invalid('malformed_submission', `${label} contains unknown field '${unknown}'`)
  }
  const missing = allowed.find(key => !Object.hasOwn(value, key))
  if (missing !== undefined) {
    throw invalid(missingCode, `${label} is missing '${missing}'`)
  }
}

function canonicalString(value: unknown, label: string, pattern: RegExp = SAFE_ID): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value !== value.trim()
    || !pattern.test(value)
  ) {
    throw invalid('malformed_submission', `${label} is not canonical`)
  }
  return value
}

function providerMetadataString(value: unknown, label: string, pattern: RegExp = SAFE_ID): string {
  const canonical = canonicalString(value, label, pattern)
  if (
    canonical === '[REDACTED]'
    || KNOWN_CREDENTIAL_VALUES.some(credentialPattern => credentialPattern.test(canonical))
    || COMPACT_JOSE.test(canonical)
  ) throw invalid('redacted_submission', `${label} contains credential-shaped material`)
  return canonical
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalid('malformed_submission', `${label} must be a positive integer`)
  }
  return value as number
}

function jsonClone(
  value: unknown,
  label: string,
  maxBytes = DEFAULT_MAX_SUBMISSION_BYTES,
): AssuranceSubmissionJsonV1 {
  let canonical: ReturnType<typeof canonicalizeEvidence>
  try {
    canonical = canonicalizeEvidence(value, { maxBytes })
  } catch (error) {
    if (error instanceof EvidenceStoreError && error.code === 'artifact_too_large') {
      throw invalid('submission_too_large', `${label} exceeds its byte budget`, { cause: error })
    }
    throw invalid('malformed_submission', `${label} is not canonical JSON`, { cause: error })
  }
  if (canonical.redacted) {
    throw invalid('redacted_submission', `${label} contains a sensitive field that would be redacted`)
  }
  return JSON.parse(canonical.json) as AssuranceSubmissionJsonV1
}

function normalizedKey(key: string): string {
  return key
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replaceAll('-', '_')
    .toLowerCase()
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>()
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const probability = count / value.length
    entropy -= probability * Math.log2(probability)
  }
  return entropy
}

function isHighEntropyCredentialCandidate(value: string, key?: string): boolean {
  if (
    value.length < 32
    || value.length > 4_096
    || !/^[A-Za-z0-9+/_=-]+$/u.test(value)
    || /^sha256:[0-9a-f]{64}$/u.test(value)
    || /^[0-9a-f]{40,128}$/iu.test(value)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    || (key !== undefined && HIGH_ENTROPY_SAFE_KEY.test(normalizedKey(key)))
  ) return false
  return shannonEntropy(value) >= 4.2
}

function isCredentialShapedString(
  value: string,
  key?: string,
  allowCompactJose = false,
): boolean {
  const safeSemanticKey = key !== undefined && HIGH_ENTROPY_SAFE_KEY.test(normalizedKey(key))
  return value === '[REDACTED]'
    || KNOWN_CREDENTIAL_VALUES.some(pattern => pattern.test(value))
    || (!(allowCompactJose && safeSemanticKey) && COMPACT_JOSE.test(value))
    || (!safeSemanticKey && /^[0-9a-f]{40,128}$/iu.test(value))
    || isHighEntropyCredentialCandidate(value, key)
}

function isBenignCredentialMetadata(value: AssuranceSubmissionJsonV1): boolean {
  if (value === null || value === false) return true
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'none'
    || normalized === 'disabled'
    || normalized === 'not_applicable'
    || normalized === 'not-applicable'
    || /^[a-z0-9][a-z0-9._:/-]{0,119}(?:-ref|:ref)$/u.test(value)
}

function assertNoSubmissionSecrets(
  value: AssuranceSubmissionJsonV1,
  label: string,
  inheritedKey?: string,
  allowCompactJose = false,
): void {
  if (typeof value === 'string') {
    if (isCredentialShapedString(value, inheritedKey, allowCompactJose)) {
      throw invalid('redacted_submission', `${label} contains credential-shaped material`)
    }
    return
  }
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const child of value) {
      assertNoSubmissionSecrets(child, label, inheritedKey, allowCompactJose)
    }
    return
  }
  for (const [key, child] of Object.entries(value)) {
    const canonicalKey = normalizedKey(key)
    if (
      (SUBMISSION_SENSITIVE_KEY.test(canonicalKey)
        && !(OPTIONAL_CREDENTIAL_METADATA_KEY.test(canonicalKey) && isBenignCredentialMetadata(child)))
      || isCredentialShapedString(key)
    ) {
      throw invalid('redacted_submission', `${label} contains sensitive field '${key}'`)
    }
    assertNoSubmissionSecrets(child, label, key, allowCompactJose)
  }
}

function artifactValue(
  candidate: unknown,
  label: string,
  allowCompactJose = false,
): AssuranceSubmissionJsonV1 {
  const value = jsonClone(candidate, label)
  assertNoSubmissionSecrets(value, label, undefined, allowCompactJose)
  return value
}

function digestEnvelope(json: string, mediaType: string): AssuranceSubmissionDigestV1 {
  return {
    schemaVersion: 1,
    algorithm: 'sha256',
    mediaType,
    byteLength: Buffer.byteLength(json, 'utf8'),
    canonicalization: CANONICALIZATION,
    value: `sha256:${createHash('sha256').update(json, 'utf8').digest('hex')}`,
  }
}

function sameDigest(left: AssuranceSubmissionDigestV1, right: AssuranceSubmissionDigestV1): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.algorithm === right.algorithm
    && left.mediaType === right.mediaType
    && left.byteLength === right.byteLength
    && left.canonicalization === right.canonicalization
    && left.value === right.value
}

function parseDigest(
  candidate: unknown,
  label: string,
  mediaType: string,
): AssuranceSubmissionDigestV1 {
  const value = record(candidate, label)
  exactKeys(
    value,
    ['schemaVersion', 'algorithm', 'mediaType', 'byteLength', 'canonicalization', 'value'],
    label,
    'unsealed_submission',
  )
  if (
    value.schemaVersion !== 1
    || value.algorithm !== 'sha256'
    || value.mediaType !== mediaType
    || value.canonicalization !== CANONICALIZATION
  ) {
    throw invalid('unsupported_schema', `${label} uses an unsupported digest format`)
  }
  if (!Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 0) {
    throw invalid('malformed_submission', `${label}.byteLength is invalid`)
  }
  return {
    schemaVersion: 1,
    algorithm: 'sha256',
    mediaType,
    byteLength: value.byteLength as number,
    canonicalization: CANONICALIZATION,
    value: canonicalString(value.value, `${label}.value`, SHA256),
  }
}

function parseSubject(candidate: unknown) {
  const value = record(candidate, 'Submission Subject')
  exactKeys(value, ['kind', 'branch', 'head', 'workspaceFingerprint'], 'Submission Subject')
  if (value.kind !== 'git_worktree') {
    throw invalid('malformed_submission', "Submission Subject kind must be 'git_worktree'")
  }
  if (typeof value.branch !== 'string' || value.branch.length === 0 || value.branch.length > 1_024) {
    throw invalid('malformed_submission', 'Submission Subject branch is invalid')
  }
  if (typeof value.head !== 'string' || value.head.length === 0 || value.head.length > 256) {
    throw invalid('malformed_submission', 'Submission Subject head is invalid')
  }
  return {
    kind: 'git_worktree' as const,
    branch: value.branch,
    head: value.head,
    workspaceFingerprint: canonicalString(
      value.workspaceFingerprint,
      'Submission Subject workspaceFingerprint',
      SHA256,
    ),
  }
}

function parseBinding(candidate: unknown): AssuranceSubmissionBindingV1 {
  const value = record(candidate, 'Submission binding')
  exactKeys(
    value,
    ['invocationId', 'missionId', 'attempt', 'provider', 'subject', 'effectivePolicyDigest'],
    'Submission binding',
  )
  let provider: AssuranceProviderDescriptorV1
  try {
    provider = parseAssuranceProviderDescriptorV1(value.provider)
  } catch (error) {
    throw invalid('malformed_submission', 'Submission Provider descriptor is invalid', { cause: error })
  }
  return {
    invocationId: canonicalString(value.invocationId, 'Submission invocationId'),
    missionId: canonicalString(value.missionId, 'Submission missionId'),
    attempt: positiveInteger(value.attempt, 'Submission attempt'),
    provider,
    subject: parseSubject(value.subject),
    effectivePolicyDigest: canonicalString(
      value.effectivePolicyDigest,
      'Submission effectivePolicyDigest',
      SHA256,
    ),
  }
}

function parseExternalAssessment(candidate: unknown): AssuranceSubmissionExternalAssessmentV1 {
  const value = record(candidate, 'External Assessment')
  exactKeys(value, ['state', 'assessmentId', 'claimedOutcome'], 'External Assessment', 'unsealed_submission')
  if (value.state !== 'sealed') {
    throw invalid('unsealed_submission', "External Assessment state must be 'sealed'")
  }
  if (value.claimedOutcome !== 'satisfied'
    && value.claimedOutcome !== 'failed'
    && value.claimedOutcome !== 'indeterminate') {
    throw invalid('malformed_submission', 'External Assessment claimedOutcome is invalid')
  }
  return {
    state: 'sealed',
    assessmentId: providerMetadataString(value.assessmentId, 'External Assessment assessmentId'),
    claimedOutcome: value.claimedOutcome,
  }
}

function artifactBase(
  artifactId: string,
  schemaId: string,
  schemaVersion: number,
  value: AssuranceSubmissionJsonV1,
) {
  return { artifactId, schemaId, schemaVersion, value }
}

function parseArtifactDraft(candidate: unknown, label: string): AssuranceSubmissionArtifactV1 {
  const value = record(candidate, label)
  exactKeys(value, ['artifactId', 'schemaId', 'schemaVersion', 'value'], label)
  const base = artifactBase(
    providerMetadataString(value.artifactId, `${label}.artifactId`),
    providerMetadataString(value.schemaId, `${label}.schemaId`, SCHEMA_ID),
    positiveInteger(value.schemaVersion, `${label}.schemaVersion`),
    artifactValue(value.value, `${label}.value`, label === 'Source Seal'),
  )
  const canonical = canonicalizeEvidence(base)
  return { ...base, digest: digestEnvelope(canonical.json, ARTIFACT_MEDIA_TYPE) }
}

function parseArtifact(candidate: unknown, label: string): AssuranceSubmissionArtifactV1 {
  const value = record(candidate, label)
  exactKeys(value, ['artifactId', 'schemaId', 'schemaVersion', 'digest', 'value'], label, 'unsealed_submission')
  const base = artifactBase(
    providerMetadataString(value.artifactId, `${label}.artifactId`),
    providerMetadataString(value.schemaId, `${label}.schemaId`, SCHEMA_ID),
    positiveInteger(value.schemaVersion, `${label}.schemaVersion`),
    artifactValue(value.value, `${label}.value`, label === 'Source Seal'),
  )
  const supplied = parseDigest(value.digest, `${label}.digest`, ARTIFACT_MEDIA_TYPE)
  const canonical = canonicalizeEvidence(base)
  const expected = digestEnvelope(canonical.json, ARTIFACT_MEDIA_TYPE)
  if (!sameDigest(supplied, expected)) {
    throw invalid('digest_mismatch', `${label} digest does not match its value`)
  }
  return { ...base, digest: supplied }
}

function parseDraft(candidate: unknown): AssuranceSubmissionPayloadV1 {
  const value = record(candidate, 'Assurance Submission draft')
  exactKeys(value, [
    'schemaVersion',
    'binding',
    'externalAssessment',
    'providerComposition',
    'providerPolicy',
    'coverage',
    'sourceSeal',
    'provenance',
    'evidence',
  ], 'Assurance Submission draft')
  if (value.schemaVersion !== 1) {
    throw invalid('unsupported_schema', 'Assurance Submission schemaVersion must be 1')
  }
  if (!Array.isArray(value.evidence) || value.evidence.length === 0 || value.evidence.length > 256) {
    throw invalid('malformed_submission', 'Assurance Submission evidence must contain 1 to 256 artifacts')
  }
  const payload: AssuranceSubmissionPayloadV1 = {
    binding: parseBinding(value.binding),
    externalAssessment: parseExternalAssessment(value.externalAssessment),
    providerComposition: parseArtifactDraft(value.providerComposition, 'Provider Composition'),
    providerPolicy: parseArtifactDraft(value.providerPolicy, 'Provider Policy'),
    coverage: parseArtifactDraft(value.coverage, 'Coverage'),
    sourceSeal: parseArtifactDraft(value.sourceSeal, 'Source Seal'),
    provenance: parseArtifactDraft(value.provenance, 'Provenance'),
    evidence: value.evidence.map((artifact, index) => parseArtifactDraft(
      artifact,
      `Evidence artifact ${index}`,
    )),
  }
  requireUniqueArtifactIds(payload)
  return payload
}

function parsePayload(candidate: unknown): AssuranceSubmissionPayloadV1 {
  const value = record(candidate, 'Assurance Submission payload')
  exactKeys(value, [
    'binding',
    'externalAssessment',
    'providerComposition',
    'providerPolicy',
    'coverage',
    'sourceSeal',
    'provenance',
    'evidence',
  ], 'Assurance Submission payload', 'unsealed_submission')
  if (!Array.isArray(value.evidence) || value.evidence.length === 0 || value.evidence.length > 256) {
    throw invalid('malformed_submission', 'Assurance Submission evidence must contain 1 to 256 artifacts')
  }
  const payload: AssuranceSubmissionPayloadV1 = {
    binding: parseBinding(value.binding),
    externalAssessment: parseExternalAssessment(value.externalAssessment),
    providerComposition: parseArtifact(value.providerComposition, 'Provider Composition'),
    providerPolicy: parseArtifact(value.providerPolicy, 'Provider Policy'),
    coverage: parseArtifact(value.coverage, 'Coverage'),
    sourceSeal: parseArtifact(value.sourceSeal, 'Source Seal'),
    provenance: parseArtifact(value.provenance, 'Provenance'),
    evidence: value.evidence.map((artifact, index) => parseArtifact(
      artifact,
      `Evidence artifact ${index}`,
    )),
  }
  requireUniqueArtifactIds(payload)
  return payload
}

function requireUniqueArtifactIds(payload: AssuranceSubmissionPayloadV1): void {
  const artifacts = [
    payload.providerComposition,
    payload.providerPolicy,
    payload.coverage,
    payload.sourceSeal,
    payload.provenance,
    ...payload.evidence,
  ]
  const ids = new Set(artifacts.map(artifact => artifact.artifactId))
  if (ids.size !== artifacts.length) {
    throw invalid('malformed_submission', 'Assurance Submission artifactId values must be unique')
  }
}

function sameDescriptor(
  left: AssuranceProviderDescriptorV1,
  right: AssuranceProviderDescriptorV1,
): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.providerId === right.providerId
    && left.providerVersion === right.providerVersion
}

function sameSubject(
  left: AssuranceSubmissionBindingV1['subject'],
  right: AssuranceSubmissionBindingV1['subject'],
): boolean {
  return left.kind === right.kind
    && left.branch === right.branch
    && left.head === right.head
    && left.workspaceFingerprint === right.workspaceFingerprint
}

function requireExpectedBinding(
  actual: AssuranceSubmissionBindingV1,
  expected: AssuranceSubmissionBindingV1,
): void {
  if (actual.invocationId !== expected.invocationId) {
    throw invalid('invocation_mismatch', 'Submission invocationId does not match the begun invocation')
  }
  if (actual.missionId !== expected.missionId) {
    throw invalid('mission_mismatch', 'Submission missionId does not match the begun invocation')
  }
  if (actual.attempt !== expected.attempt) {
    throw invalid('attempt_mismatch', 'Submission attempt does not match the begun invocation')
  }
  if (!sameDescriptor(actual.provider, expected.provider)) {
    throw invalid('provider_mismatch', 'Submission Provider does not match the frozen descriptor')
  }
  if (!sameSubject(actual.subject, expected.subject)) {
    throw invalid('subject_mismatch', 'Submission Subject does not match the frozen Subject')
  }
  if (actual.effectivePolicyDigest !== expected.effectivePolicyDigest) {
    throw invalid('policy_mismatch', 'Submission policy does not match the frozen Effective Policy')
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

/**
 * Construct one self-contained, canonically digested transport Submission.
 * The embedded sourceSeal remains Provider-domain data and grants no Gate authority.
 */
export function sealAssuranceSubmissionV1(draft: AssuranceSubmissionDraftV1): AssuranceSubmissionV1 {
  const detachedDraft = jsonClone(draft, 'Assurance Submission draft')
  const payload = parseDraft(detachedDraft)
  const canonicalPayload = canonicalizeEvidence(payload)
  const candidate = {
    schemaVersion: 1 as const,
    payload,
    digest: digestEnvelope(canonicalPayload.json, SUBMISSION_MEDIA_TYPE),
  }
  return validateAssuranceSubmissionV1(candidate, payload.binding).submission
}

/** Strictly detach and validate one fulfilled Provider Submission against exact frozen facts. */
export function validateAssuranceSubmissionV1(
  candidate: unknown,
  expectedBinding: AssuranceSubmissionBindingV1,
  maxBytes = DEFAULT_MAX_SUBMISSION_BYTES,
): ValidatedAssuranceSubmissionV1 {
  const detached = jsonClone(candidate, 'Assurance Submission', maxBytes)
  const value = record(detached, 'Assurance Submission')
  if (!Object.hasOwn(value, 'digest')) {
    throw invalid('unsealed_submission', "Assurance Submission is missing 'digest'")
  }
  exactKeys(value, ['schemaVersion', 'payload', 'digest'], 'Assurance Submission')
  if (value.schemaVersion !== 1) {
    throw invalid('unsupported_schema', 'Assurance Submission schemaVersion must be 1')
  }
  const payload = parsePayload(value.payload)
  requireExpectedBinding(payload.binding, expectedBinding)
  const suppliedDigest = parseDigest(value.digest, 'Assurance Submission digest', SUBMISSION_MEDIA_TYPE)
  const canonicalPayload = canonicalizeEvidence(payload)
  const expectedDigest = digestEnvelope(canonicalPayload.json, SUBMISSION_MEDIA_TYPE)
  if (!sameDigest(suppliedDigest, expectedDigest)) {
    throw invalid('digest_mismatch', 'Assurance Submission digest does not match its payload')
  }
  const normalized = jsonClone(
    { schemaVersion: 1, payload, digest: suppliedDigest },
    'Assurance Submission',
    maxBytes,
  )
  return deepFreeze({
    submission: normalized as unknown as AssuranceSubmissionV1,
    binding: (normalized as unknown as AssuranceSubmissionV1).payload.binding,
    claimedOutcome: payload.externalAssessment.claimedOutcome,
    submissionDigest: suppliedDigest.value,
  })
}
