import type {
  AssuranceProviderV1,
  AssuranceRequestV1,
  AssuranceExecutionContext,
} from './contracts.js'
import {
  AssuranceProviderRegistry,
  AssuranceProviderResolutionError,
} from './registry.js'
import { issueAssuranceProviderInvocationV1 } from '../kernel/assurance-execution-context.js'
import type {
  ControlPlaneKernel,
  MissionAuthority,
  MissionReceipt,
  MissionSnapshot,
} from '../kernel/types.js'

export interface AssuranceProviderInvocationCoordinatorOptions {
  readonly kernel: ControlPlaneKernel
  readonly registry: AssuranceProviderRegistry
  readonly onError: (message: string) => void
}

function receipt(snapshot: MissionSnapshot): MissionReceipt {
  return {
    missionId: snapshot.missionId,
    revision: snapshot.revision,
    status: snapshot.status,
    attempt: snapshot.attempt,
    acceptedAt: snapshot.updatedAt,
  }
}

/** Process-local execution owner; durable identity and state remain exclusively in the Kernel. */
export class AssuranceProviderInvocationCoordinator {
  private readonly active = new Map<string, AbortController>()
  private disposed = false

  constructor(private readonly options: AssuranceProviderInvocationCoordinatorOptions) {}

  /** Persist admission before calling each exact frozen Provider, then detach its promise. */
  async launch(
    initial: MissionSnapshot,
    authority: MissionAuthority,
  ): Promise<MissionReceipt> {
    if (this.disposed) throw new Error('Assurance Provider invocation coordinator is disposing')
    let current = initial
    const invocationIds = (initial.assuranceProviderInvocations ?? [])
      .filter(record => record.attempt === initial.attempt && record.state === 'prepared')
      .map(record => record.invocationId)

    for (const invocationId of invocationIds) {
      current = await this.options.kernel.snapshot(initial.missionId, authority)
      const invocation = current.assuranceProviderInvocations?.find(record => (
        record.invocationId === invocationId
      ))
      if (invocation === undefined || invocation.state !== 'prepared') continue

      let provider: AssuranceProviderV1
      try {
        provider = this.options.registry.resolveExact(invocation.descriptor)
      } catch (error) {
        const failureCode = error instanceof AssuranceProviderResolutionError
          ? error.code
          : 'factory_failed'
        this.report(
          `Assurance Provider invocation '${invocation.invocationId}' is unavailable (${failureCode})`,
        )
        await this.options.kernel.dispatch({
          kind: 'mark_assurance_provider_invocation_unavailable',
          missionId: current.missionId,
          expectedRevision: current.revision,
          invocationId: invocation.invocationId,
          failureCode,
        }, authority)
        continue
      }

      await this.options.kernel.dispatch({
        kind: 'begin_assurance_provider_invocation',
        missionId: current.missionId,
        expectedRevision: current.revision,
        invocationId: invocation.invocationId,
      }, authority)
      current = await this.options.kernel.snapshot(current.missionId, authority)
      const issued = issueAssuranceProviderInvocationV1(current, invocation.invocationId)
      this.invoke(invocation.invocationId, provider, issued.context, issued.request)
    }

    current = await this.options.kernel.snapshot(initial.missionId, authority)
    return receipt(current)
  }

  /** Abort process-local work without treating a tool-call signal as Mission ownership. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.active.values()) {
      controller.abort(new Error('Engineering Control Plane disposed'))
    }
    this.active.clear()
  }

  private invoke(
    invocationId: string,
    provider: AssuranceProviderV1,
    context: AssuranceExecutionContext,
    request: AssuranceRequestV1,
  ): void {
    const controller = new AbortController()
    this.active.set(invocationId, controller)
    let outcome: Promise<unknown>
    try {
      outcome = Promise.resolve(provider.assess(context, request, { signal: controller.signal }))
    } catch {
      this.active.delete(invocationId)
      this.report(`Assurance Provider invocation '${invocationId}' failed after it began`)
      return
    }
    void outcome.then(
      () => {
        this.active.delete(invocationId)
      },
      () => {
        this.active.delete(invocationId)
        this.report(`Assurance Provider invocation '${invocationId}' failed after it began`)
      },
    )
  }

  private report(message: string): void {
    try {
      this.options.onError(message)
    } catch {
      // Diagnostics cannot become Provider execution authority or block durable state changes.
    }
  }
}
