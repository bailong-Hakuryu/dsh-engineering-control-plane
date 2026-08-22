import type {
  AssuranceExecutionContext,
  AssuranceRequestV1,
} from '../assurance-provider/contracts.js'
import type { MissionSnapshot } from './types.js'

export interface IssuedAssuranceProviderInvocationV1 {
  readonly context: AssuranceExecutionContext
  readonly request: AssuranceRequestV1
}

/**
 * Issue the process-local Provider capability only after its durable invocation fact exists.
 * This constructor is intentionally package-private and absent from every plugin export.
 */
export function issueAssuranceProviderInvocationV1(
  snapshot: MissionSnapshot,
  invocationId: string,
): IssuedAssuranceProviderInvocationV1 {
  const invocation = snapshot.assuranceProviderInvocations?.find(record => (
    record.invocationId === invocationId
  ))
  if (
    invocation === undefined
    || invocation.state !== 'begun'
    || invocation.attempt !== snapshot.attempt
  ) {
    throw new Error('Assurance Execution Context requires a begun invocation in the current Attempt')
  }

  const subject = Object.freeze({
    kind: 'git_worktree' as const,
    branch: snapshot.repository.branch,
    head: snapshot.repository.head,
    workspaceFingerprint: snapshot.repository.workspaceFingerprint,
  })
  const context = {
    schemaVersion: 1 as const,
    invocationId: invocation.invocationId,
    missionId: snapshot.missionId,
    attempt: snapshot.attempt,
    effectivePolicyDigest: snapshot.effectivePolicyDigest,
    subject,
  }
  Object.defineProperty(context, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: () => {
      throw new TypeError('Assurance Execution Context cannot be serialized')
    },
  })

  const frozenContext = Object.freeze(context)
  return {
    context: new Proxy(frozenContext, {}) as unknown as AssuranceExecutionContext,
    request: Object.freeze({ schemaVersion: 1 }) as AssuranceRequestV1,
  }
}
