import { parseAssuranceProviderDescriptorV1 } from './contracts.js'
import type {
  AssuranceProviderDescriptorV1,
  AssuranceProviderOutcomeV1,
  AssuranceProviderUnavailableCode,
  AssuranceProviderV1,
  AssuranceRequestV1,
  AssuranceExecutionContext,
  AssuranceSubmissionBindingV1,
  AssuranceSubmissionRejectionCode,
} from './contracts.js'
import {
  AssuranceSubmissionValidationError,
  validateAssuranceSubmissionV1,
  type ValidatedAssuranceSubmissionV1,
} from './submission.js'
import {
  AssuranceProviderRegistry,
  AssuranceProviderResolutionError,
} from './registry.js'
import {
  EvidenceStoreError,
  type FilesystemEvidenceStore,
} from '../evidence/filesystem-store.js'
import { issueAssuranceProviderInvocationV1 } from '../kernel/assurance-execution-context.js'
import { MissionError } from '../kernel/errors.js'
import type {
  ControlPlaneKernel,
  MissionAuthority,
  MissionReceipt,
  MissionSnapshot,
} from '../kernel/types.js'

export interface AssuranceProviderInvocationCoordinatorOptions {
  readonly kernel: ControlPlaneKernel
  readonly registry: AssuranceProviderRegistry
  readonly evidenceStore: Pick<FilesystemEvidenceStore, 'publish'>
  readonly maxSubmissionBytes: number
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
  private readonly admissions = new Map<string, Promise<void>>()
  private readonly executions = new Map<string, Promise<void>>()
  private disposed = false

  constructor(private readonly options: AssuranceProviderInvocationCoordinatorOptions) {}

  /** Persist admission before calling each exact frozen Provider, then detach its promise. */
  async launch(
    initial: MissionSnapshot,
    authority: MissionAuthority,
  ): Promise<MissionReceipt> {
    if (this.disposed) throw new Error('Assurance Provider invocation coordinator is disposing')
    const invocationIds = (initial.assuranceProviderInvocations ?? [])
      .filter(record => record.attempt === initial.attempt && record.state === 'prepared')
      .map(record => record.invocationId)

    for (const invocationId of invocationIds) {
      if (this.disposed) break
      if (this.active.has(invocationId)) continue
      let admission = this.admissions.get(invocationId)
      const ownsAdmission = admission === undefined
      if (admission === undefined) {
        admission = this.admit(initial.missionId, invocationId, authority)
        this.admissions.set(invocationId, admission)
      }
      try {
        await admission
      } finally {
        if (ownsAdmission && this.admissions.get(invocationId) === admission) {
          this.admissions.delete(invocationId)
        }
      }
    }

    if (this.disposed) return receipt(initial)
    return receipt(await this.options.kernel.snapshot(initial.missionId, authority))
  }

  /** Run every prepared invocation for the frozen post-implementation Subject to a stable local point. */
  async execute(
    initial: MissionSnapshot,
    authority: MissionAuthority,
    signal: AbortSignal,
  ): Promise<MissionSnapshot> {
    const invocationIds = (initial.assuranceProviderInvocations ?? [])
      .filter(record => record.attempt === initial.attempt && record.state === 'prepared')
      .map(record => record.invocationId)
    await this.launch(initial, authority)

    while (!this.disposed) {
      const current = await this.options.kernel.snapshot(initial.missionId, authority)
      const pending = (current.assuranceProviderInvocations ?? []).filter(record => (
        record.attempt === current.attempt
        && invocationIds.includes(record.invocationId)
        && (record.state === 'prepared' || record.state === 'begun')
      ))
      if (pending.length === 0) return current
      const owned = pending
        .map(record => this.executions.get(record.invocationId))
        .filter((execution): execution is Promise<void> => execution !== undefined)
      if (owned.length === 0) return current
      await this.waitForOwnedExecutions(invocationIds, owned, signal)
    }
    return this.options.kernel.snapshot(initial.missionId, authority)
  }

  private async admit(
    missionId: string,
    invocationId: string,
    authority: MissionAuthority,
  ): Promise<void> {
    let current = await this.options.kernel.snapshot(missionId, authority)
    if (this.disposed) return
    const invocation = current.assuranceProviderInvocations?.find(record => (
      record.invocationId === invocationId
    ))
    if (invocation === undefined || invocation.state !== 'prepared') return

    let provider: AssuranceProviderV1
    const invocationDescriptor = parseAssuranceProviderDescriptorV1(invocation.descriptor)
    try {
      provider = this.options.registry.resolveExact(invocationDescriptor)
    } catch (error) {
      const failureCode = error instanceof AssuranceProviderResolutionError
        ? error.code
        : 'factory_failed'
      this.report(
        `Assurance Provider invocation '${invocation.invocationId}' is unavailable (${failureCode})`,
      )
      await this.markUnavailableWithRetry(
        current.missionId,
        invocation.invocationId,
        'prepared',
        failureCode,
        authority,
      )
      return
    }

    const begun = await this.beginWithRetry(current.missionId, invocation.invocationId, authority)
    if (begun === undefined || this.disposed) return
    current = begun
    if (!this.options.registry.isRegisteredExact(invocationDescriptor)) {
      this.report(
        `Assurance Provider invocation '${invocation.invocationId}' lost registration during admission`,
      )
      await this.markUnavailableWithRetry(
        current.missionId,
        invocation.invocationId,
        'begun',
        'registration_missing',
        authority,
      )
      return
    }
    const issued = issueAssuranceProviderInvocationV1(current, invocation.invocationId)
    this.invoke(
      invocation.invocationId,
      invocationDescriptor,
      provider,
      issued.context,
      issued.request,
      authority,
    )
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
    descriptor: AssuranceProviderDescriptorV1,
    provider: AssuranceProviderV1,
    context: AssuranceExecutionContext,
    request: AssuranceRequestV1,
    authority: MissionAuthority,
  ): void {
    if (this.disposed) return
    const controller = new AbortController()
    this.active.set(invocationId, controller)
    let outcome: Promise<AssuranceProviderOutcomeV1>
    try {
      outcome = Promise.resolve(provider.assess(context, request, { signal: controller.signal }))
    } catch {
      this.active.delete(invocationId)
      this.report(`Assurance Provider invocation '${invocationId}' failed after it began`)
      return
    }
    let execution!: Promise<void>
    execution = outcome.then(
      result => this.acceptOutcome(
        invocationId,
        descriptor,
        context,
        result,
        authority,
        controller,
      ),
      () => {
        this.report(`Assurance Provider invocation '${invocationId}' failed after it began`)
      },
    ).catch(() => {
      this.report(`Assurance Provider invocation '${invocationId}' outcome could not be imported`)
    }).finally(() => {
      if (this.active.get(invocationId) === controller) this.active.delete(invocationId)
      if (this.executions.get(invocationId) === execution) this.executions.delete(invocationId)
    })
    this.executions.set(invocationId, execution)
  }

  private async beginWithRetry(
    missionId: string,
    invocationId: string,
    authority: MissionAuthority,
  ): Promise<MissionSnapshot | undefined> {
    while (!this.disposed) {
      const current = await this.options.kernel.snapshot(missionId, authority)
      if (this.disposed) return undefined
      const invocation = current.assuranceProviderInvocations?.find(record => (
        record.invocationId === invocationId
      ))
      if (invocation?.state !== 'prepared') return undefined
      try {
        await this.options.kernel.dispatch({
          kind: 'begin_assurance_provider_invocation',
          missionId: current.missionId,
          expectedRevision: current.revision,
          invocationId,
        }, authority)
        if (this.disposed) return undefined
        return await this.options.kernel.snapshot(current.missionId, authority)
      } catch (error) {
        if (error instanceof MissionError && error.code === 'revision_conflict') continue
        throw error
      }
    }
    return undefined
  }

  private async markUnavailableWithRetry(
    missionId: string,
    invocationId: string,
    expectedState: 'prepared' | 'begun',
    failureCode: AssuranceProviderUnavailableCode,
    authority: MissionAuthority,
  ): Promise<void> {
    while (!this.disposed) {
      const current = await this.options.kernel.snapshot(missionId, authority)
      if (this.disposed) return
      const invocation = current.assuranceProviderInvocations?.find(record => (
        record.invocationId === invocationId
      ))
      if (invocation?.state !== expectedState) return
      try {
        await this.options.kernel.dispatch({
          kind: 'mark_assurance_provider_invocation_unavailable',
          missionId: current.missionId,
          expectedRevision: current.revision,
          invocationId,
          expectedState,
          failureCode,
        }, authority)
        return
      } catch (error) {
        if (error instanceof MissionError && error.code === 'revision_conflict') continue
        throw error
      }
    }
  }

  private async acceptOutcome(
    invocationId: string,
    descriptor: AssuranceProviderDescriptorV1,
    context: AssuranceExecutionContext,
    outcome: AssuranceProviderOutcomeV1,
    authority: MissionAuthority,
    controller: AbortController,
  ): Promise<void> {
    if (!this.owns(invocationId, controller)) return
    let submission: unknown
    try {
      if (typeof outcome !== 'object' || outcome === null || Array.isArray(outcome)) {
        throw new TypeError('Provider outcome must be an object')
      }
      const kind = Reflect.get(outcome, 'kind')
      if (kind === 'external_failure') {
        this.report(`Assurance Provider invocation '${invocationId}' returned no sealed Submission`)
        return
      }
      if (kind !== 'sealed_submission') throw new TypeError('Provider outcome kind is invalid')
      const keys = Object.keys(outcome)
      if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('submission')) {
        throw new TypeError('Sealed Submission outcome contains unknown or missing fields')
      }
      submission = Reflect.get(outcome, 'submission')
    } catch {
      this.report(`Assurance Provider invocation '${invocationId}' returned a malformed outcome`)
      await this.settleRejected(
        invocationId,
        context,
        'malformed_submission',
        authority,
        controller,
      )
      return
    }
    if (submission === undefined) {
      this.report(`Assurance Provider invocation '${invocationId}' returned no sealed Submission`)
      await this.settleRejected(
        invocationId,
        context,
        'malformed_submission',
        authority,
        controller,
      )
      return
    }

    const expectedBinding: AssuranceSubmissionBindingV1 = {
      invocationId: context.invocationId,
      missionId: context.missionId,
      attempt: context.attempt,
      provider: descriptor,
      subject: context.subject,
      effectivePolicyDigest: context.effectivePolicyDigest,
    }
    let validated: ValidatedAssuranceSubmissionV1
    try {
      validated = validateAssuranceSubmissionV1(
        submission,
        expectedBinding,
        this.options.maxSubmissionBytes,
      )
    } catch (error) {
      const failureCode = error instanceof AssuranceSubmissionValidationError
        ? error.code
        : 'malformed_submission'
      this.report(`Assurance Provider invocation '${invocationId}' Submission was rejected (${failureCode})`)
      await this.settleRejected(invocationId, context, failureCode, authority, controller)
      return
    }
    if (!this.owns(invocationId, controller)) return

    let evidenceRecord: Awaited<ReturnType<FilesystemEvidenceStore['publish']>>
    try {
      evidenceRecord = await this.options.evidenceStore.publish({
        missionId: context.missionId,
        attempt: context.attempt,
        kind: 'assurance-provider-submission',
        schemaVersion: 1,
        payload: validated.submission,
      })
    } catch (error) {
      if (!this.owns(invocationId, controller)) return
      this.report(`Assurance Provider invocation '${invocationId}' Submission Evidence could not be published`)
      if (error instanceof EvidenceStoreError && error.code === 'artifact_too_large') {
        await this.settleRejected(
          invocationId,
          context,
          'submission_too_large',
          authority,
          controller,
        )
      } else {
        await this.settleImportFailed(invocationId, context, authority, controller)
      }
      return
    }
    if (!this.owns(invocationId, controller)) return

    await this.settleWithRetry(
      invocationId,
      context,
      {
        kind: 'sealed_submission',
        binding: validated.binding,
        submissionDigest: validated.submissionDigest,
        claimedOutcome: validated.claimedOutcome,
        evidenceRecord,
      },
      authority,
      controller,
    )
  }

  private async settleRejected(
    invocationId: string,
    context: AssuranceExecutionContext,
    failureCode: AssuranceSubmissionRejectionCode,
    authority: MissionAuthority,
    controller: AbortController,
  ): Promise<void> {
    await this.settleWithRetry(
      invocationId,
      context,
      { kind: 'rejected_submission', failureCode },
      authority,
      controller,
    )
  }

  private async settleImportFailed(
    invocationId: string,
    context: AssuranceExecutionContext,
    authority: MissionAuthority,
    controller: AbortController,
  ): Promise<void> {
    await this.settleWithRetry(
      invocationId,
      context,
      { kind: 'import_failed', failureCode: 'evidence_store_failure' },
      authority,
      controller,
    )
  }

  private async settleWithRetry(
    invocationId: string,
    context: AssuranceExecutionContext,
    outcome: Extract<
      Parameters<ControlPlaneKernel['dispatch']>[0],
      { readonly kind: 'settle_assurance_provider_invocation' }
    >['outcome'],
    authority: MissionAuthority,
    controller: AbortController,
  ): Promise<void> {
    while (this.owns(invocationId, controller)) {
      const current = await this.options.kernel.snapshot(context.missionId, authority)
      if (!this.owns(invocationId, controller)) return
      const invocation = current.assuranceProviderInvocations?.find(record => (
        record.invocationId === invocationId
      ))
      if (invocation === undefined || invocation.state !== 'begun') return
      try {
        await this.options.kernel.dispatch({
          kind: 'settle_assurance_provider_invocation',
          missionId: current.missionId,
          expectedRevision: current.revision,
          invocationId,
          outcome,
        }, authority)
        return
      } catch (error) {
        if (error instanceof MissionError && error.code === 'revision_conflict') continue
        throw error
      }
    }
  }

  private owns(invocationId: string, controller: AbortController): boolean {
    return !this.disposed && this.active.get(invocationId) === controller
  }

  private async waitForOwnedExecutions(
    invocationIds: readonly string[],
    executions: readonly Promise<void>[],
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) {
      this.abortInvocations(invocationIds, signal.reason)
      throw signal.reason instanceof Error ? signal.reason : new Error('Assurance Provider execution aborted')
    }
    let rejectAbort!: (reason: unknown) => void
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    const onAbort = () => {
      this.abortInvocations(invocationIds, signal.reason)
      rejectAbort(signal.reason instanceof Error ? signal.reason : new Error('Assurance Provider execution aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      await Promise.race([Promise.allSettled(executions).then(() => {}), aborted])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private abortInvocations(invocationIds: readonly string[], reason: unknown): void {
    for (const invocationId of invocationIds) {
      this.active.get(invocationId)?.abort(reason)
    }
  }

  private report(message: string): void {
    try {
      this.options.onError(message)
    } catch {
      // Diagnostics cannot become Provider execution authority or block durable state changes.
    }
  }
}
