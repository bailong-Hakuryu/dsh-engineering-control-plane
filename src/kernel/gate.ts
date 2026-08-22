import type { GateDecision, GateInput } from './types.js'

/**
 * Evaluate normalized, digest-bound facts without performing I/O.
 * @param _input - Evidence facts for one Mission Attempt.
 * @returns the deterministic Gate decision.
 */
export function evaluateGate(input: GateInput): GateDecision {
  const unavailableEvidence = input.requiredEvidence
    .filter(item => item.state !== 'valid')
    .map(item => ({ code: `evidence_${item.state}`, source: item.kind }))
  const indeterminateVerifications = input.verifications
    .filter(item => item.outcome !== 'passed' && item.outcome !== 'not_applicable' && item.outcome !== 'failed')
    .map(item => ({ code: `verification_${item.outcome}`, source: item.category }))
  const workspaceViolations = input.workspacePolicyViolations
    .map(source => ({ code: 'workspace_policy_violation', source }))
  const indeterminate = [
    ...unavailableEvidence,
    ...indeterminateVerifications,
    ...workspaceViolations,
  ]
  if (indeterminate.length > 0) return { kind: 'blocked', reasons: indeterminate }

  const verificationFailures = input.verifications
    .filter(item => item.outcome === 'failed')
    .map(item => ({ code: 'verification_failed', source: item.category }))
  const reviewFailures = input.reviewerFindings
    .filter(item => item.severity === 'blocking')
    .map(item => ({ code: 'reviewer_blocking_finding', source: item.code }))
  const implementationFailures = input.implementationSecretCount > 0
    ? [{ code: 'implementation_secret', source: 'implementation' }]
    : []
  const failed = [...verificationFailures, ...reviewFailures, ...implementationFailures]
  if (failed.length > 0) return { kind: 'rework_required', reasons: failed }
  return { kind: 'approved', reasons: [] }
}
