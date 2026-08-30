import { randomUUID } from 'node:crypto'
import type { EvidenceJson, PublishEvidenceInput } from '../evidence/filesystem-store.js'
import type { AssuranceExecutionSubjectV1 } from '../assurance-provider/contracts.js'
import { evaluateAssuranceSubmissionEligibilityV1 } from '../assurance-provider/eligibility.js'
import { validateAssuranceSubmissionV1 } from '../assurance-provider/submission.js'
import type { EvidenceRecord } from '../kernel/types.js'
import type { MissionStore } from '../kernel/memory-store.js'
import { MissionError } from '../kernel/errors.js'
import { evaluateGate } from '../kernel/gate.js'
import { isMissionPhase } from '../kernel/state-machine.js'
import {
  activeAssuranceProviderInvocations,
  latestAssuranceResults,
} from '../kernel/assurance-retry.js'
import type {
  AssuranceProviderEligibilityV1,
  ControlPlaneKernel,
  GateInput,
  MissionAuthority,
  MissionId,
  MissionPhase,
  MissionSnapshot,
  RequiredEvidenceState,
  RoleName,
  RoleRunTrace,
  VerificationEvidenceState,
} from '../kernel/types.js'
import {
  ROLE_OUTPUT_SCHEMAS,
  validateRoleOutput,
  type RoleOutput,
} from './role-contracts.js'

/** Narrow Evidence operations used by the Runner; the filesystem implementation remains replaceable in tests. */
export interface RunnerEvidenceStore {
  publish(input: PublishEvidenceInput): Promise<EvidenceRecord>
  read(record: EvidenceRecord): Promise<EvidenceJson>
  inspect(record: EvidenceRecord): Promise<{ readonly state: 'valid' | 'missing' | 'corrupt' }>
}

/** One role assignment sent to a Harness-specific executor Adapter. */
export interface RoleExecutionRequest {
  readonly missionId: MissionId
  readonly attempt: number
  readonly role: RoleName
  readonly repository: MissionSnapshot['repository']
  readonly prompt: string
  readonly persona: string
  readonly toolAccess: 'read_only' | 'workspace_write'
  readonly outputSchema: Readonly<Record<string, unknown>>
  readonly signal: AbortSignal
}

/** Normalized terminal result returned by a role executor. */
export interface RoleExecutionResult {
  readonly stopReason: string
  readonly structured?: unknown
  readonly diagnostic?: string
  readonly workspacePolicyViolations?: readonly string[]
}

/** Published one-shot child owned by the Mission Runner until quiescent disposal. */
export interface RoleExecutionHandle {
  readonly trace: RoleRunTrace
  readonly result: Promise<RoleExecutionResult>
  dispose(): Promise<void>
}

/** Replaceable Harness subagent execution port. */
export interface RoleExecutor {
  start(request: RoleExecutionRequest): Promise<RoleExecutionHandle>
}

/** Host-observed implementation facts; Developer prose is never authoritative for these fields. */
export interface ImplementationCapture {
  readonly payload: unknown
  readonly subject: AssuranceExecutionSubjectV1
  readonly implementationSecretCount: number
  readonly workspacePolicyViolations: readonly string[]
}

/** Host-executed verification facts; Tester only interprets this record. */
export interface VerificationCapture {
  readonly payload: unknown
  readonly outcomes: readonly VerificationEvidenceState[]
}

/** Process-local capabilities retained for one launched Mission. */
export interface MissionExecutionHost {
  readonly evidenceStore: RunnerEvidenceStore
  readonly roleExecutor: RoleExecutor
  captureImplementation(snapshot: MissionSnapshot, signal: AbortSignal): Promise<ImplementationCapture>
  runVerifications(snapshot: MissionSnapshot, signal: AbortSignal): Promise<VerificationCapture>
  runAssuranceProviders?(
    snapshot: MissionSnapshot,
    authority: MissionAuthority,
    signal: AbortSignal,
  ): Promise<MissionSnapshot>
}

/** Construction dependencies for the plugin-owned Mission execution runtime. */
export interface MissionRunnerOptions {
  readonly kernel: ControlPlaneKernel
  readonly store: MissionStore
  readonly authorityFor: (snapshot: MissionSnapshot) => MissionAuthority
  readonly observeWorkspaceForRecovery?: (
    snapshot: MissionSnapshot,
  ) => Promise<{ readonly workspaceFingerprint: string }>
  readonly nextRoleRunId?: () => string
  readonly onError?: (error: unknown) => void
}

/** Result of the deterministic startup recovery sweep. */
export interface RestartRecoveryResult {
  readonly blockedMissionIds: readonly MissionId[]
}

/** Process-local handle; Mission state remains in the Kernel, not this object. */
export interface MissionRunHandle {
  readonly settled: Promise<void>
  abort(reason?: unknown): void
}

interface RunningMission {
  readonly controller: AbortController
  readonly handle: MissionRunHandle
}

interface RoleStepResult {
  readonly snapshot: MissionSnapshot
  readonly output?: RoleOutput
  readonly paused: boolean
}

const ROLE_PERSONAS: Readonly<Record<RoleName, string>> = {
  planner: 'You are the Planner. Produce an incremental, testable plan. Host verification owns every configured command; do not assign those commands to a Role. Report facts only; you cannot approve the Mission.',
  developer: 'You are the Developer. Implement only the accepted Plan. Host verification runs automatically after you return implemented; do not request shell access to run verification. Do not commit, switch branches, or rewrite Git history.',
  tester: 'You are the Tester. Interpret only host-captured verification Evidence. Do not execute commands or claim approval.',
  reviewer: 'You are the Reviewer. Identify blocking and non-blocking findings from Evidence. You cannot approve the Mission.',
}

const ROLE_EXECUTION_CONTRACTS: Readonly<Record<RoleName, readonly string[]>> = {
  planner: [
    'Plan repository work only. Treat configured test, typecheck, build, lint, audit, and pack commands as Host verification acceptance signals, never as Planner or Developer actions.',
    'For a validation-only Mission, plan inspection and a no-change Developer handoff; do not require repository mutation merely to reach verification.',
  ],
  developer: [
    'Use only the supplied workspace tools to implement the accepted Plan. The Host owns command execution and will run the frozen verification profile after outcome implemented.',
    'Do not return needs_input merely because shell, test, typecheck, build, lint, audit, or pack commands are unavailable to this Role.',
    'If inspection proves no repository change is required, return implemented with an empty changedAreas array and explain the no-change result in summary or notes.',
  ],
  tester: [
    'Assess only the Host-published verification Evidence. Never request tools to rerun a command.',
  ],
  reviewer: [
    'Review only the published Mission Evidence and report findings. The deterministic Gate owns approval.',
  ],
}

const VERIFICATION_CATEGORIES = ['functional', 'negative', 'regression', 'security'] as const
const CANCELLATION_QUIESCENCE = Symbol('dsh-control-plane-cancellation-quiescence')

function latestRecord(snapshot: MissionSnapshot, kind: string): EvidenceRecord | undefined {
  return latestRecordForAttempt(snapshot, snapshot.attempt, kind)
}

function latestRecordForAttempt(
  snapshot: MissionSnapshot,
  attempt: number,
  kind: string,
): EvidenceRecord | undefined {
  return [...snapshot.evidence.records]
    .reverse()
    .find(record => record.attempt === attempt && record.kind === kind)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function boundedDiagnostic(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.byteLength <= 4_096) return value
  return bytes.subarray(0, 4_096).toString('utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeVerificationOutcomes(value: readonly VerificationEvidenceState[]): readonly VerificationEvidenceState[] {
  const byCategory = new Map(value.map(item => [item.category, item]))
  if (byCategory.size !== VERIFICATION_CATEGORIES.length || value.length !== VERIFICATION_CATEGORIES.length) {
    throw new Error('Verification Capture must contain each required category exactly once')
  }
  return VERIFICATION_CATEGORIES.map((category) => {
    const item = byCategory.get(category)
    if (item === undefined) throw new Error(`Verification Capture omitted ${category}`)
    return { category, outcome: item.outcome }
  })
}

function reportKind(role: RoleName, output: RoleOutput): string {
  if (role === 'planner') return output.outcome === 'planned' ? 'plan' : 'planner-report'
  if (role === 'developer') return 'developer-report'
  if (role === 'tester') return 'test-report'
  return 'review-report'
}

function needsInput(output: RoleOutput): output is RoleOutput & { readonly outcome: 'needs_input'; readonly question: string } {
  return output.outcome === 'needs_input'
}

function hasSelectedAssuranceProviders(snapshot: MissionSnapshot): boolean {
  return (snapshot.assuranceProviderSelections
    ?.find(selection => selection.attempt === snapshot.attempt)
    ?.providers.length ?? 0) > 0
}

function needsFinalReport(snapshot: MissionSnapshot): boolean {
  const reportCount = snapshot.evidence.records.filter(record => (
    record.attempt === snapshot.attempt && record.kind === 'final-report'
  )).length
  const gateDecisionCount = snapshot.gateHistory.filter(record => record.attempt === snapshot.attempt).length
  return reportCount <= gateDecisionCount
}

/** Process-local execution owner over durable Kernel state; deliberately not a Harness Job. */
export class MissionRunner {
  private readonly running = new Map<string, RunningMission>()
  private readonly nextRoleRunId: () => string

  constructor(private readonly options: MissionRunnerOptions) {
    this.nextRoleRunId = options.nextRoleRunId ?? randomUUID
  }

  /** Launch or return the existing process-local owner for one Mission. */
  launch(missionId: MissionId | string, authority: MissionAuthority, host: MissionExecutionHost): MissionRunHandle {
    const key = String(missionId)
    const existing = this.running.get(key)
    if (existing !== undefined) return existing.handle

    const controller = new AbortController()
    const handle: MissionRunHandle = {
      settled: Promise.resolve(),
      abort: reason => controller.abort(reason),
    }
    const settled = Promise.resolve()
      .then(() => this.runSafely(missionId, authority, host, controller.signal))
      .finally(() => this.running.delete(key))
    const published: MissionRunHandle = { settled, abort: handle.abort }
    this.running.set(key, { controller, handle: published })
    return published
  }

  /** Abort one live execution owner and wait for its child/process cleanup. */
  async abort(missionId: MissionId | string, reason?: unknown): Promise<void> {
    const running = this.running.get(String(missionId))
    if (running === undefined) return
    running.controller.abort(reason)
    await running.handle.settled
  }

  /**
   * Stop the process-local child owner without consuming a durable revision.
   * The following Kernel Cancel command atomically seals any persisted live Role Run.
   */
  async quiesceForCancellation(missionId: MissionId | string): Promise<void> {
    const running = this.running.get(String(missionId))
    if (running === undefined) return
    running.controller.abort(CANCELLATION_QUIESCENCE)
    await running.handle.settled
  }

  /** Quiesce every process-local Mission owner. Durable recovery occurs on the next startup. */
  async dispose(): Promise<void> {
    const active = [...this.running.values()]
    for (const item of active) item.controller.abort(new Error('Mission Runner disposed'))
    await Promise.allSettled(active.map(item => item.handle.settled))
  }

  /**
   * Convert every persisted active phase into recoverable Blocked state.
   * Any interrupted Role Run is first sealed as aborted history. No work auto-resumes.
   */
  async recoverAfterRestart(): Promise<RestartRecoveryResult> {
    const blockedMissionIds: MissionId[] = []
    for (const listed of await this.options.store.listNonTerminal()) {
      let current = listed
      while (isMissionPhase(current.status)) {
        const authority = this.options.authorityFor(current)
        try {
          let workspaceFingerprint: string | undefined
          try {
            workspaceFingerprint = (await this.options.observeWorkspaceForRecovery?.(current))
              ?.workspaceFingerprint
          } catch (error) {
            this.options.onError?.(error)
          }
          await this.options.kernel.dispatch({
            kind: 'block',
            missionId: current.missionId,
            expectedRevision: current.revision,
            reason: { code: 'host_restarted' },
            ...workspaceFingerprint === undefined ? {} : { workspaceFingerprint },
          }, authority)
          blockedMissionIds.push(current.missionId)
          break
        } catch (error) {
          if (!(error instanceof MissionError) || error.code !== 'revision_conflict') throw error
          current = await this.options.kernel.snapshot(current.missionId, authority)
        }
      }
    }
    return { blockedMissionIds }
  }

  private async runSafely(
    missionId: MissionId | string,
    authority: MissionAuthority,
    host: MissionExecutionHost,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await this.runMission(missionId, authority, host, signal)
    } catch (error) {
      this.options.onError?.(error)
      if (signal.aborted) return
      try {
        const snapshot = await this.options.kernel.snapshot(missionId, authority)
        if (isMissionPhase(snapshot.status)) {
          await this.options.kernel.dispatch({
            kind: 'block',
            missionId: snapshot.missionId,
            expectedRevision: snapshot.revision,
            reason: {
              code: 'evidence_incomplete',
              detail: 'Mission Runner could not complete the current phase safely.',
            },
          }, authority)
        }
      } catch (blockingError) {
        this.options.onError?.(blockingError)
      }
    }
  }

  private async runMission(
    missionId: MissionId | string,
    authority: MissionAuthority,
    host: MissionExecutionHost,
    signal: AbortSignal,
  ): Promise<void> {
    let snapshot = await this.options.kernel.snapshot(missionId, authority)
    if (snapshot.status === 'CREATED') snapshot = await this.advance(snapshot, authority, 'ANALYZING')

    if (snapshot.status === 'ANALYZING') {
      if (latestRecord(snapshot, 'context') === undefined) {
        snapshot = (await this.publishEvidence(snapshot, authority, host.evidenceStore, 'context', {
          schemaVersion: 1,
          missionId: snapshot.missionId,
          attempt: snapshot.attempt,
          repository: snapshot.repository,
          intent: {
            objective: snapshot.objective,
            ...snapshot.context === undefined ? {} : { context: snapshot.context },
            acceptanceCriteria: snapshot.acceptanceCriteria,
            constraints: snapshot.constraints,
          },
          inputRecords: snapshot.inputRecords,
          effectivePolicyDigest: snapshot.effectivePolicyDigest,
        })).snapshot
      }
      snapshot = await this.advance(snapshot, authority, 'PLANNING')
    }

    if (snapshot.status === 'PLANNING') {
      if (latestRecord(snapshot, 'plan') === undefined) {
        const planner = await this.executeRole(snapshot, authority, host, 'planner', signal)
        snapshot = planner.snapshot
        if (planner.paused) return
      }
      snapshot = await this.advance(snapshot, authority, 'IMPLEMENTING')
    }

    if (snapshot.status === 'IMPLEMENTING') {
      if (latestRecord(snapshot, 'implementation') === undefined) {
        const priorDeveloper = await this.readRoleOutput(snapshot, host.evidenceStore, 'developer-report', 'developer')
        if (priorDeveloper?.outcome !== 'implemented') {
          const developer = await this.executeRole(snapshot, authority, host, 'developer', signal)
          snapshot = developer.snapshot
          if (developer.paused) return
        }
        const capture = await host.captureImplementation(snapshot, signal)
        if (!Number.isSafeInteger(capture.implementationSecretCount) || capture.implementationSecretCount < 0) {
          throw new Error('Implementation Capture secret count is invalid')
        }
        const publishedImplementation = await this.publishEvidence(
          snapshot,
          authority,
          host.evidenceStore,
          'implementation',
          {
          schemaVersion: 1,
          capture: capture.payload,
          gateFacts: {
            implementationSecretCount: capture.implementationSecretCount,
            workspacePolicyViolations: [...capture.workspacePolicyViolations],
          },
          },
        )
        snapshot = publishedImplementation.snapshot
        if (capture.workspacePolicyViolations.length > 0) {
          await this.block(snapshot, authority, 'policy_violation', capture.workspacePolicyViolations.join(', '))
          return
        }
        if (hasSelectedAssuranceProviders(snapshot)) {
          const frozen = await this.options.kernel.dispatch({
            kind: 'freeze_assurance_subject',
            missionId: snapshot.missionId,
            expectedRevision: snapshot.revision,
            subject: capture.subject,
            implementationEvidenceRecordId: publishedImplementation.record.recordId,
          }, authority)
          snapshot = await this.options.kernel.snapshot(frozen.missionId, authority)
          if (host.runAssuranceProviders === undefined) {
            throw new Error('Mission host omitted Assurance Provider execution')
          }
          snapshot = await host.runAssuranceProviders(snapshot, authority, signal)
        }
      }
      const pendingProviderInvocation = (snapshot.assuranceProviderInvocations ?? []).some(record => (
        record.attempt === snapshot.attempt
        && (record.state === 'prepared' || record.state === 'begun')
      ))
      if (pendingProviderInvocation) {
        if (host.runAssuranceProviders === undefined) {
          throw new Error('Mission host omitted Assurance Provider execution')
        }
        snapshot = await host.runAssuranceProviders(snapshot, authority, signal)
      }
      snapshot = await this.advance(snapshot, authority, 'VERIFYING')
    }

    if (snapshot.status === 'VERIFYING') {
      if (latestRecord(snapshot, 'verification') === undefined) {
        const verification = await host.runVerifications(snapshot, signal)
        const outcomes = normalizeVerificationOutcomes(verification.outcomes)
        snapshot = (await this.publishEvidence(snapshot, authority, host.evidenceStore, 'verification', {
          schemaVersion: 1,
          capture: verification.payload,
          outcomes,
        })).snapshot
      }
      const priorTester = await this.readRoleOutput(snapshot, host.evidenceStore, 'test-report', 'tester')
      if (priorTester?.outcome !== 'assessed') {
        const tester = await this.executeRole(snapshot, authority, host, 'tester', signal)
        snapshot = tester.snapshot
        if (tester.paused) return
      }
      snapshot = await this.advance(snapshot, authority, 'REVIEWING')
    }

    if (snapshot.status === 'REVIEWING') {
      const pendingProviderInvocation = activeAssuranceProviderInvocations(snapshot).some(record => (
        record.state === 'prepared' || record.state === 'begun'
      ))
      if (pendingProviderInvocation) {
        if (host.runAssuranceProviders === undefined) {
          throw new Error('Mission host omitted Assurance Provider execution')
        }
        snapshot = await host.runAssuranceProviders(snapshot, authority, signal)
      }
      const priorReviewer = await this.readRoleOutput(snapshot, host.evidenceStore, 'review-report', 'reviewer')
      if (priorReviewer?.outcome !== 'reviewed') {
        const reviewer = await this.executeRole(snapshot, authority, host, 'reviewer', signal)
        snapshot = reviewer.snapshot
        if (reviewer.paused) return
      }
      if (
        hasSelectedAssuranceProviders(snapshot)
        && activeAssuranceProviderInvocations(snapshot).some(invocation => (
          !(snapshot.assuranceAssessments ?? []).some(assessment => (
            assessment.attempt === snapshot.attempt
            && assessment.invocationId === invocation.invocationId
          ))
        ))
      ) {
        const evaluated = await this.options.kernel.dispatch({
          kind: 'evaluate_assurance_provider_invocations',
          missionId: snapshot.missionId,
          expectedRevision: snapshot.revision,
          eligibilities: await this.assuranceEligibilities(snapshot, host.evidenceStore),
        }, authority)
        snapshot = await this.options.kernel.snapshot(evaluated.missionId, authority)
      }
      if (needsFinalReport(snapshot)) {
        const preliminaryInput = await this.buildGateInput(snapshot, host.evidenceStore, false)
        const preliminaryDecision = evaluateGate(preliminaryInput)
        const currentResults = latestAssuranceResults(snapshot)
        const currentAssessmentIds = new Set(currentResults.flatMap(result => result.assessmentIds))
        snapshot = (await this.publishEvidence(snapshot, authority, host.evidenceStore, 'final-report', {
          schemaVersion: 1,
          missionId: snapshot.missionId,
          attempt: snapshot.attempt,
          decision: preliminaryDecision,
          assuranceAssessments: (snapshot.assuranceAssessments ?? [])
            .filter(assessment => currentAssessmentIds.has(assessment.assessmentId)),
          assuranceResults: currentResults,
          evidenceRecordIds: snapshot.evidence.records
            .filter(record => record.attempt === snapshot.attempt)
            .map(record => record.recordId),
        }, {
          viewOrdinal: snapshot.gateHistory.filter(record => record.attempt === snapshot.attempt).length + 1,
        })).snapshot
      }
      const input = await this.buildGateInput(snapshot, host.evidenceStore, true)
      await this.options.kernel.dispatch({
        kind: 'decide_gate',
        missionId: snapshot.missionId,
        expectedRevision: snapshot.revision,
        input,
      }, authority)
    }
  }

  private async executeRole(
    initial: MissionSnapshot,
    authority: MissionAuthority,
    host: MissionExecutionHost,
    role: RoleName,
    signal: AbortSignal,
  ): Promise<RoleStepResult> {
    const runId = this.nextRoleRunId()
    const prepared = await this.options.kernel.dispatch({
      kind: 'prepare_role_run',
      missionId: initial.missionId,
      expectedRevision: initial.revision,
      runId,
      role,
    }, authority)
    let snapshot = await this.options.kernel.snapshot(prepared.missionId, authority)
    let handle: RoleExecutionHandle | undefined
    try {
      handle = await host.roleExecutor.start({
        missionId: snapshot.missionId,
        attempt: snapshot.attempt,
        role,
        repository: snapshot.repository,
        prompt: await this.rolePrompt(snapshot, role, host.evidenceStore),
        persona: ROLE_PERSONAS[role],
        toolAccess: role === 'developer' ? 'workspace_write' : 'read_only',
        outputSchema: ROLE_OUTPUT_SCHEMAS[role],
        signal,
      })
      const published = await this.options.kernel.dispatch({
        kind: 'publish_role_run',
        missionId: snapshot.missionId,
        expectedRevision: snapshot.revision,
        runId,
        trace: handle.trace,
      }, authority)
      snapshot = await this.options.kernel.snapshot(published.missionId, authority)
      const result = await handle.result
      if (signal.aborted) {
        if (signal.reason !== CANCELLATION_QUIESCENCE) {
          await this.trySettleAbortedRole(snapshot, authority, runId)
        }
        return { snapshot: await this.options.kernel.snapshot(snapshot.missionId, authority), paused: true }
      }
      if (result.stopReason !== 'completed' || result.structured === undefined) {
        snapshot = await this.settleFailedRole(snapshot, authority, runId, result.stopReason, result.diagnostic)
        snapshot = await this.block(snapshot, authority, 'provider_failure', `Role ${role} ended with ${result.stopReason}`)
        return { snapshot, paused: true }
      }

      let output: RoleOutput
      try {
        output = validateRoleOutput(role, result.structured)
      } catch (error) {
        snapshot = await this.settleFailedRole(snapshot, authority, runId, 'invalid-structured-output', errorMessage(error))
        snapshot = await this.block(snapshot, authority, 'evidence_incomplete', `Role ${role} returned invalid structured output`)
        return { snapshot, paused: true }
      }
      const publishedEvidence = await this.publishEvidence(
        snapshot,
        authority,
        host.evidenceStore,
        reportKind(role, output),
        output,
      )
      snapshot = publishedEvidence.snapshot
      const settled = await this.options.kernel.dispatch({
        kind: 'settle_role_run',
        missionId: snapshot.missionId,
        expectedRevision: snapshot.revision,
        runId,
        outcome: 'completed',
        evidenceRecordIds: [publishedEvidence.record.recordId],
        stopReason: result.stopReason,
      }, authority)
      snapshot = await this.options.kernel.snapshot(settled.missionId, authority)

      if ((result.workspacePolicyViolations?.length ?? 0) > 0) {
        snapshot = await this.block(
          snapshot,
          authority,
          'policy_violation',
          result.workspacePolicyViolations!.join(', '),
        )
        return { snapshot, output, paused: true }
      }
      if (needsInput(output)) {
        snapshot = await this.block(snapshot, authority, 'needs_input', output.question)
        return { snapshot, output, paused: true }
      }
      return { snapshot, output, paused: false }
    } catch (error) {
      if (signal.aborted) {
        if (signal.reason !== CANCELLATION_QUIESCENCE) {
          await this.trySettleAbortedRole(snapshot, authority, runId)
        }
        return { snapshot: await this.options.kernel.snapshot(snapshot.missionId, authority), paused: true }
      }
      snapshot = await this.settleFailedRole(snapshot, authority, runId, 'executor-error', errorMessage(error))
      snapshot = await this.block(snapshot, authority, 'provider_failure', `Role ${role} could not be executed`)
      return { snapshot, paused: true }
    } finally {
      if (handle !== undefined) {
        try {
          await handle.dispose()
        } catch (error) {
          this.options.onError?.(error)
        }
      }
    }
  }

  private async publishEvidence(
    snapshot: MissionSnapshot,
    authority: MissionAuthority,
    store: RunnerEvidenceStore,
    kind: string,
    payload: unknown,
    options: { readonly viewOrdinal?: number } = {},
  ): Promise<{ readonly snapshot: MissionSnapshot; readonly record: EvidenceRecord }> {
    const record = await store.publish({
      missionId: snapshot.missionId,
      attempt: snapshot.attempt,
      kind,
      schemaVersion: 1,
      payload,
      ...options.viewOrdinal === undefined ? {} : { viewOrdinal: options.viewOrdinal },
    })
    const indexed = await this.options.kernel.dispatch({
      kind: 'record_evidence',
      missionId: snapshot.missionId,
      expectedRevision: snapshot.revision,
      record,
    }, authority)
    return {
      snapshot: await this.options.kernel.snapshot(indexed.missionId, authority),
      record,
    }
  }

  private async advance(
    snapshot: MissionSnapshot,
    authority: MissionAuthority,
    to: MissionPhase,
  ): Promise<MissionSnapshot> {
    const receipt = await this.options.kernel.dispatch({
      kind: 'advance',
      missionId: snapshot.missionId,
      expectedRevision: snapshot.revision,
      to,
    }, authority)
    return this.options.kernel.snapshot(receipt.missionId, authority)
  }

  private async block(
    snapshot: MissionSnapshot,
    authority: MissionAuthority,
    code: 'needs_input' | 'provider_failure' | 'evidence_incomplete' | 'policy_violation',
    detail?: string,
  ): Promise<MissionSnapshot> {
    const receipt = await this.options.kernel.dispatch({
      kind: 'block',
      missionId: snapshot.missionId,
      expectedRevision: snapshot.revision,
      reason: { code, ...detail === undefined ? {} : { detail } },
    }, authority)
    return this.options.kernel.snapshot(receipt.missionId, authority)
  }

  private async settleFailedRole(
    snapshot: MissionSnapshot,
    authority: MissionAuthority,
    runId: string,
    stopReason: string,
    diagnostic?: string,
  ): Promise<MissionSnapshot> {
    const safeDiagnostic = boundedDiagnostic(diagnostic)
    const receipt = await this.options.kernel.dispatch({
      kind: 'settle_role_run',
      missionId: snapshot.missionId,
      expectedRevision: snapshot.revision,
      runId,
      outcome: 'failed',
      evidenceRecordIds: [],
      stopReason,
      ...safeDiagnostic === undefined ? {} : { diagnostic: safeDiagnostic },
    }, authority)
    return this.options.kernel.snapshot(receipt.missionId, authority)
  }

  private async trySettleAbortedRole(
    snapshot: MissionSnapshot,
    authority: MissionAuthority,
    runId: string,
  ): Promise<void> {
    try {
      await this.options.kernel.dispatch({
        kind: 'settle_role_run',
        missionId: snapshot.missionId,
        expectedRevision: snapshot.revision,
        runId,
        outcome: 'aborted',
        evidenceRecordIds: [],
        stopReason: 'aborted',
      }, authority)
    } catch (error) {
      this.options.onError?.(error)
    }
  }

  private async rolePrompt(
    snapshot: MissionSnapshot,
    role: RoleName,
    store: RunnerEvidenceStore,
  ): Promise<string> {
    const evidence: Record<string, unknown> = {}
    const relevantKinds: Readonly<Record<RoleName, readonly string[]>> = {
      planner: ['context'],
      developer: ['context', 'plan'],
      tester: ['context', 'plan', 'implementation', 'verification'],
      reviewer: ['context', 'plan', 'implementation', 'verification', 'test-report'],
    }
    for (const kind of relevantKinds[role]) {
      const record = latestRecord(snapshot, kind)
      if (record !== undefined) evidence[kind] = await store.read(record)
    }
    const priorAttempt = role === 'planner'
      ? await this.reworkPlannerContext(snapshot, store)
      : undefined
    return JSON.stringify({
      mission: {
        missionId: snapshot.missionId,
        attempt: snapshot.attempt,
        objective: snapshot.objective,
        acceptanceCriteria: snapshot.acceptanceCriteria,
        constraints: snapshot.constraints,
        latestInput: snapshot.inputRecords.at(-1),
        previousGate: snapshot.gate,
      },
      executionContract: ROLE_EXECUTION_CONTRACTS[role],
      evidence,
      ...priorAttempt === undefined ? {} : { priorAttempt },
    })
  }

  private async reworkPlannerContext(
    snapshot: MissionSnapshot,
    store: RunnerEvidenceStore,
  ): Promise<{
    readonly attempt: number
    readonly gate: MissionSnapshot['gateHistory'][number]
    readonly plan: EvidenceJson
    readonly evidence: readonly {
      readonly record: EvidenceRecord
      readonly payload: EvidenceJson
    }[]
  } | undefined> {
    if (snapshot.attempt <= 1) return undefined
    const attempt = snapshot.attempt - 1
    const gate = [...snapshot.gateHistory].reverse().find(item => item.attempt === attempt)
    if (gate === undefined) throw new Error(`Prior Attempt ${attempt} Gate decision is missing`)
    const records = snapshot.evidence.records.filter(record => record.attempt === attempt)
    const planRecord = latestRecordForAttempt(snapshot, attempt, 'plan')
    if (planRecord === undefined) throw new Error(`Prior Attempt ${attempt} Plan Evidence is missing`)
    const evidence = await Promise.all(records.map(async record => ({
      record,
      payload: await store.read(record),
    })))
    const indexedPlan = evidence.find(item => item.record.recordId === planRecord.recordId)
    if (indexedPlan === undefined) throw new Error(`Prior Attempt ${attempt} Plan Evidence is not indexed`)
    return {
      attempt,
      gate,
      plan: indexedPlan.payload,
      evidence,
    }
  }

  private async readRoleOutput(
    snapshot: MissionSnapshot,
    store: RunnerEvidenceStore,
    kind: string,
    role: RoleName,
  ): Promise<RoleOutput | undefined> {
    const record = latestRecord(snapshot, kind)
    if (record === undefined) return undefined
    try {
      return validateRoleOutput(role, await store.read(record))
    } catch {
      return undefined
    }
  }

  private async buildGateInput(
    snapshot: MissionSnapshot,
    store: RunnerEvidenceStore,
    includeFinal: boolean,
  ): Promise<GateInput> {
    const kinds = [
      'context',
      'plan',
      'implementation',
      'verification',
      'test-report',
      'review-report',
      ...includeFinal ? ['final-report'] : [],
    ]
    const states = new Map<string, RequiredEvidenceState>()
    const payloads = new Map<string, EvidenceJson>()
    for (const kind of kinds) {
      const record = latestRecord(snapshot, kind)
      if (record === undefined) {
        states.set(kind, { kind, state: 'missing' })
        continue
      }
      const inspection = await store.inspect(record)
      if (inspection.state !== 'valid') {
        states.set(kind, { kind, state: inspection.state })
        continue
      }
      if (record.redacted) {
        states.set(kind, { kind, state: 'redacted' })
      } else {
        states.set(kind, { kind, state: 'valid' })
      }
      try {
        payloads.set(kind, await store.read(record))
      } catch {
        states.set(kind, { kind, state: 'corrupt' })
      }
    }

    let implementationSecretCount = 0
    let workspacePolicyViolations: readonly string[] = []
    const implementation = payloads.get('implementation')
    if (implementation !== undefined) {
      try {
        const envelope = isRecord(implementation) ? implementation : undefined
        const gateFacts = envelope !== undefined && isRecord(envelope.gateFacts) ? envelope.gateFacts : undefined
        if (gateFacts === undefined || !Number.isSafeInteger(gateFacts.implementationSecretCount)) throw new Error()
        const count = gateFacts.implementationSecretCount as number
        if (count < 0 || !Array.isArray(gateFacts.workspacePolicyViolations)
          || gateFacts.workspacePolicyViolations.some(item => typeof item !== 'string')) throw new Error()
        implementationSecretCount = count
        workspacePolicyViolations = gateFacts.workspacePolicyViolations as string[]
      } catch {
        states.set('implementation', { kind: 'implementation', state: 'corrupt' })
      }
    }

    let verifications: readonly VerificationEvidenceState[] = VERIFICATION_CATEGORIES
      .map(category => ({ category, outcome: 'missing' as const }))
    const verification = payloads.get('verification')
    if (verification !== undefined) {
      try {
        if (!isRecord(verification) || !Array.isArray(verification.outcomes)) throw new Error()
        verifications = normalizeVerificationOutcomes(verification.outcomes as unknown as VerificationEvidenceState[])
      } catch {
        states.set('verification', { kind: 'verification', state: 'corrupt' })
      }
    }

    let reviewerFindings: GateInput['reviewerFindings'] = []
    const review = payloads.get('review-report')
    if (review !== undefined) {
      try {
        const output = validateRoleOutput('reviewer', review)
        if (!('findings' in output)) throw new Error()
        reviewerFindings = output.findings.map(finding => ({ severity: finding.severity, code: finding.code }))
      } catch {
        states.set('review-report', { kind: 'review-report', state: 'corrupt' })
      }
    }

    return {
      requiredEvidence: kinds.map(kind => states.get(kind) ?? { kind, state: 'missing' }),
      verifications,
      assuranceResults: latestAssuranceResults(snapshot)
        .map(result => ({ requirementId: result.requirementId, outcome: result.outcome })),
      reviewerFindings,
      implementationSecretCount,
      workspacePolicyViolations,
    }
  }

  private async assuranceEligibilities(
    snapshot: MissionSnapshot,
    store: RunnerEvidenceStore,
  ): Promise<AssuranceProviderEligibilityV1[]> {
    const subject = snapshot.assuranceSubjects?.find(item => item.attempt === snapshot.attempt)?.subject
    if (subject === undefined) throw new Error('Assurance evaluation requires a frozen Subject')
    const maxSubmissionBytes = snapshot.effectivePolicy.artifactBudgets?.maxRecordBytes
      ?? 16 * 1024 * 1024
    const eligibilities: AssuranceProviderEligibilityV1[] = []
    const assessedInvocationIds = new Set((snapshot.assuranceAssessments ?? [])
      .filter(assessment => assessment.attempt === snapshot.attempt)
      .map(assessment => assessment.invocationId))
    for (const invocation of activeAssuranceProviderInvocations(snapshot)) {
      if (invocation.state !== 'settled' || assessedInvocationIds.has(invocation.invocationId)) continue
      const evidence = snapshot.evidence.records.find(record => (
        record.recordId === invocation.outcome.evidenceRecordId
        && record.attempt === snapshot.attempt
        && record.kind === 'assurance-provider-submission'
      ))
      if (evidence === undefined || evidence.redacted) {
        eligibilities.push({
          invocationId: invocation.invocationId,
          kind: 'indeterminate' as const,
          failureCode: 'submission_unreadable' as const,
        })
        continue
      }
      try {
        if ((await store.inspect(evidence)).state !== 'valid') throw new Error()
        const validated = validateAssuranceSubmissionV1(
          await store.read(evidence),
          {
            invocationId: invocation.invocationId,
            missionId: snapshot.missionId,
            attempt: snapshot.attempt,
            provider: invocation.descriptor,
            subject,
            effectivePolicyDigest: snapshot.effectivePolicyDigest,
          },
          maxSubmissionBytes,
        )
        if (
          validated.submissionDigest !== invocation.outcome.submissionDigest
          || validated.claimedOutcome !== invocation.outcome.claimedOutcome
        ) throw new Error()
        const eligibility = evaluateAssuranceSubmissionEligibilityV1(validated.submission)
        eligibilities.push(eligibility.kind === 'eligible'
          ? { invocationId: invocation.invocationId, kind: 'eligible' }
          : {
              invocationId: invocation.invocationId,
              kind: 'indeterminate',
              failureCode: eligibility.failureCode,
            })
      } catch {
        eligibilities.push({
          invocationId: invocation.invocationId,
          kind: 'indeterminate' as const,
          failureCode: 'submission_invalid' as const,
        })
      }
    }
    return eligibilities
  }
}

/** Create the process-local Mission Runner over one durable store and Kernel. */
export function createMissionRunner(options: MissionRunnerOptions): MissionRunner {
  return new MissionRunner(options)
}
