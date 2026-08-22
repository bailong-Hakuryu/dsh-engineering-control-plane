import { parseAssuranceProviderDescriptorV1 } from './contracts.js'
import type {
  AssuranceProviderDescriptorV1,
  AssuranceSubmissionArtifactV1,
  AssuranceSubmissionV1,
} from './contracts.js'
import type { AssuranceEligibilityFailureCode } from '../kernel/types.js'

type EligibilityWithoutInvocation =
  | { readonly kind: 'eligible' }
  | {
    readonly kind: 'indeterminate'
    readonly failureCode: AssuranceEligibilityFailureCode
  }

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).length !== keys.length || keys.some(key => !Object.hasOwn(candidate, key))) {
    throw new Error()
  }
  return candidate
}

function nonEmpty(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) throw new Error()
  return value
}

function sameProvider(left: AssuranceProviderDescriptorV1, right: AssuranceProviderDescriptorV1): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.providerId === right.providerId
    && left.providerVersion === right.providerVersion
}

function sameSubject(left: Record<string, unknown>, right: AssuranceSubmissionV1['payload']['binding']['subject']): boolean {
  return left.kind === right.kind
    && left.branch === right.branch
    && left.head === right.head
    && left.workspaceFingerprint === right.workspaceFingerprint
}

function standardArtifact(artifact: AssuranceSubmissionArtifactV1, schemaId: string): Record<string, unknown> {
  if (artifact.schemaId !== schemaId || artifact.schemaVersion !== 1) throw new Error()
  return artifact.value as Record<string, unknown>
}

function indeterminate(failureCode: AssuranceEligibilityFailureCode): EligibilityWithoutInvocation {
  return { kind: 'indeterminate', failureCode }
}

/**
 * Validate the provider-neutral V1 eligibility profile after transport validation.
 * This produces facts only; the Kernel still derives the Assessment, Result, and Gate meaning.
 */
export function evaluateAssuranceSubmissionEligibilityV1(
  submission: AssuranceSubmissionV1,
): EligibilityWithoutInvocation {
  const payload = submission.payload
  if (payload.evidence.length === 0) return indeterminate('evidence_missing')

  try {
    const value = record(
      standardArtifact(payload.providerComposition, 'dsh/assurance-provider-composition'),
      ['schemaVersion', 'provider', 'components'],
    )
    if (value.schemaVersion !== 1) throw new Error()
    const provider = parseAssuranceProviderDescriptorV1(value.provider)
    if (!sameProvider(provider, payload.binding.provider) || !Array.isArray(value.components) || value.components.length === 0) {
      throw new Error()
    }
    for (const component of value.components) {
      const item = record(component, ['componentId', 'componentVersion'])
      nonEmpty(item.componentId)
      nonEmpty(item.componentVersion)
    }
  } catch {
    return indeterminate('provider_composition_invalid')
  }

  try {
    const value = record(
      standardArtifact(payload.providerPolicy, 'dsh/assurance-provider-policy'),
      ['schemaVersion', 'effectivePolicyDigest'],
    )
    if (value.schemaVersion !== 1 || value.effectivePolicyDigest !== payload.binding.effectivePolicyDigest) {
      throw new Error()
    }
  } catch {
    return indeterminate('provider_policy_invalid')
  }

  try {
    const value = record(
      standardArtifact(payload.coverage, 'dsh/assurance-provider-coverage'),
      ['schemaVersion', 'status', 'dimensions'],
    )
    if (
      value.schemaVersion !== 1
      || (value.status !== 'complete' && value.status !== 'incomplete')
      || !Array.isArray(value.dimensions)
      || value.dimensions.length === 0
    ) throw new Error()
    let complete = value.status === 'complete'
    for (const dimension of value.dimensions) {
      const item = record(dimension, ['dimensionId', 'status'])
      nonEmpty(item.dimensionId)
      if (item.status !== 'covered' && item.status !== 'not_covered') throw new Error()
      if (item.status !== 'covered') complete = false
    }
    if (payload.externalAssessment.claimedOutcome === 'satisfied' && !complete) throw new Error()
  } catch {
    return indeterminate('coverage_invalid')
  }

  try {
    const value = record(
      standardArtifact(payload.sourceSeal, 'dsh/assurance-provider-source-seal'),
      ['schemaVersion', 'state', 'subject', 'evidenceDigests'],
    )
    const subject = record(value.subject, ['kind', 'branch', 'head', 'workspaceFingerprint'])
    const evidenceDigests = payload.evidence.map(artifact => artifact.digest.value)
    if (
      value.schemaVersion !== 1
      || value.state !== 'sealed'
      || !sameSubject(subject, payload.binding.subject)
      || !Array.isArray(value.evidenceDigests)
      || value.evidenceDigests.length !== evidenceDigests.length
      || value.evidenceDigests.some((digest, index) => digest !== evidenceDigests[index])
    ) throw new Error()
  } catch {
    return indeterminate('source_seal_invalid')
  }

  try {
    const value = record(
      standardArtifact(payload.provenance, 'dsh/assurance-provider-provenance'),
      ['schemaVersion', 'assessor'],
    )
    const assessor = record(value.assessor, ['kind', 'provider'])
    const provider = parseAssuranceProviderDescriptorV1(assessor.provider)
    if (
      value.schemaVersion !== 1
      || assessor.kind !== 'machine_provider'
      || !sameProvider(provider, payload.binding.provider)
    ) throw new Error()
  } catch {
    return indeterminate('provenance_invalid')
  }

  return { kind: 'eligible' }
}
