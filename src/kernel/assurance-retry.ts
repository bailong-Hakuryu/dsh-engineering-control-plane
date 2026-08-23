import type {
  AssuranceProviderInvocationRecordV1,
  AssuranceResultV1,
  MissionSnapshot,
} from './types.js'

/** Return the unreplaced invocation leaf for each current-attempt retry chain. */
export function activeAssuranceProviderInvocations(
  snapshot: MissionSnapshot,
): readonly AssuranceProviderInvocationRecordV1[] {
  const invocations = (snapshot.assuranceProviderInvocations ?? [])
    .filter(invocation => invocation.attempt === snapshot.attempt)
  const replaced = new Set(invocations
    .map(invocation => invocation.replacementForInvocationId)
    .filter((id): id is string => id !== undefined))
  return invocations.filter(invocation => !replaced.has(invocation.invocationId))
}

/** Return the current result for each current-attempt Assurance Requirement. */
export function latestAssuranceResults(snapshot: MissionSnapshot): readonly AssuranceResultV1[] {
  const latest = new Map<string, AssuranceResultV1>()
  for (const result of snapshot.assuranceResults ?? []) {
    if (result.attempt === snapshot.attempt) latest.set(result.requirementId, result)
  }
  return [...latest.values()]
}

/** Select only active failures that the current blocked Gate authorizes Resume to replace. */
export function retryableExternalAssuranceInvocations(
  snapshot: MissionSnapshot,
): readonly Extract<AssuranceProviderInvocationRecordV1, { readonly state: 'external_failed' }>[] {
  if (snapshot.gate?.kind !== 'blocked' || snapshot.blocked?.resumeStatus !== 'REVIEWING') return []
  const assessmentRequirements = new Map((snapshot.assuranceAssessments ?? [])
    .filter(assessment => assessment.attempt === snapshot.attempt)
    .map(assessment => [assessment.invocationId, assessment.requirementId]))
  const indeterminateRequirements = new Set(snapshot.gate.reasons
    .filter(reason => reason.code === 'assurance_indeterminate')
    .map(reason => reason.source))
  return activeAssuranceProviderInvocations(snapshot).filter(
    (invocation): invocation is Extract<
      AssuranceProviderInvocationRecordV1,
      { readonly state: 'external_failed' }
    > => invocation.state === 'external_failed'
      && indeterminateRequirements.has(assessmentRequirements.get(invocation.invocationId) ?? ''),
  )
}
