import type {
  AssuranceClaimedOutcomeV1,
  AssuranceProviderActivationPolicyV1,
  AssuranceProviderCancellationOutcomeV1,
  AssuranceProviderUnavailableCode,
  AssuranceSubmissionBindingV1,
  AssuranceSubmissionRejectionCode,
  ExternalAssessmentFailureV1,
  FrozenAssuranceProviderSelectionV1,
} from '../assurance-provider/contracts.js'

/** Opaque Mission identifier persisted by the Control Plane. */
export type MissionId = string & { readonly __missionId: unique symbol }

/** Canonical Git worktree identity frozen at Mission acceptance. */
export interface RepositoryIdentity {
  readonly canonicalRoot: string
  readonly branch: string
  readonly head: string
  readonly workspaceFingerprint: string
}

/** Host-resolved policy facts needed by the pure Kernel. */
export interface EffectivePolicy {
  readonly schemaVersion: number
  readonly digest: string
  readonly verificationProfile: string
  /** Complete Host activation policy, including disabled and unavailable optional selections. */
  readonly assuranceProviderActivations?: readonly AssuranceProviderActivationPolicyV1[]
  /** Exact registrations available and selected when this Effective Policy was frozen. */
  readonly selectedAssuranceProviders?: readonly FrozenAssuranceProviderSelectionV1[]
  readonly subagentProvider?: 'spawn'
  readonly maxSubagentDepth?: number
  readonly rolePolicies?: Readonly<Record<RoleName, EffectiveRolePolicy>>
  readonly verification?: EffectiveVerificationProfile
  readonly artifactBudgets?: EffectiveArtifactBudgets
  readonly hostExecution?: {
    readonly gitCommand: string
    readonly gitCommandTimeoutMs: number
    readonly terminationGraceMs: number
  }
}

/** Redacted role execution policy frozen without provider credentials. */
export interface EffectiveRolePolicy {
  readonly allowTools: readonly string[]
  readonly denyTools: readonly string[]
  readonly agentProvider?: string
  readonly model?: string
  readonly maxTokens?: number
}

export interface EffectiveVerificationCommand {
  readonly name: string
  readonly argv: readonly string[]
  readonly timeoutMs: number
  readonly environmentNames: readonly string[]
}

export type EffectiveVerificationCategory =
  | { readonly mode: 'commands'; readonly commands: readonly EffectiveVerificationCommand[] }
  | { readonly mode: 'not_applicable'; readonly reason: string }

export interface EffectiveVerificationProfile {
  readonly name: string
  readonly categories: Readonly<Record<VerificationCategory, EffectiveVerificationCategory>>
}

export interface EffectiveArtifactBudgets {
  readonly maxRecordBytes: number
  readonly maxStdoutBytes: number
  readonly maxStderrBytes: number
  readonly maxUntrackedFiles: number
  readonly maxUntrackedBytes: number
}

/** Actions a host principal may perform for one repository. */
export type MissionAction = 'start' | 'read' | 'resume' | 'cancel' | 'rework' | 'orchestrate' | 'recover'

/** Host-process proof required to mutate Mission state under one lease epoch. */
export interface WriteLeaseProof {
  readonly holderId: string
  readonly fencingToken: number
}

/** Durable repository-scoped lease epoch; a released lease has no holder. */
export interface WriteLeaseState {
  readonly fencingToken: number
  readonly holderId?: string
  readonly acquiredAt?: string
  readonly releasedAt?: string
}

/** Host-derived, repository-scoped authority supplied to every Kernel call. */
export interface MissionAuthority {
  readonly principalId: string
  readonly repository: RepositoryIdentity
  readonly actions: readonly MissionAction[]
  /** Host identity used only when Start, Resume, or Rework acquires a lease. */
  readonly leaseHolderId?: string
  /** Fenced proof used by the transient Mission Runner. */
  readonly writeLease?: WriteLeaseProof
}

/** Explicit Mission intent accepted by atomic Start. */
export interface StartMissionInput {
  readonly objective: string
  readonly context?: string
  readonly acceptanceCriteria?: readonly string[]
  readonly constraints?: readonly string[]
}

/** v0.1 Mission lifecycle states. */
export type MissionStatus =
  | 'CREATED'
  | 'ANALYZING'
  | 'PLANNING'
  | 'IMPLEMENTING'
  | 'VERIFYING'
  | 'REVIEWING'
  | 'APPROVED'
  | 'REWORK_REQUIRED'
  | 'BLOCKED'
  | 'CANCELLED'

/** Ordered non-terminal phases advanced by the Mission Runner. */
export type MissionPhase = 'CREATED' | 'ANALYZING' | 'PLANNING' | 'IMPLEMENTING' | 'VERIFYING' | 'REVIEWING'

/** Recoverable reason recorded when progress cannot be judged or continued. */
export interface BlockedReason {
  readonly code:
    | 'needs_input'
    | 'host_restarted'
    | 'assurance_execution_unavailable'
    | 'provider_failure'
    | 'command_timeout'
    | 'evidence_incomplete'
    | 'policy_violation'
  readonly detail?: string
}

/** Immutable Mission input provenance. */
export type MissionInputRecord =
  | {
    readonly sequence: number
    readonly kind: 'initial'
    readonly submittedBy: string
    readonly submittedAt: string
    readonly objective: string
    readonly context?: string
    readonly acceptanceCriteria: readonly string[]
    readonly constraints: readonly string[]
  }

  | {
    readonly sequence: number
    readonly kind: 'resume'
    readonly submittedBy: string
    readonly submittedAt: string
    readonly supplementalContext?: string
  }
  | {
    readonly sequence: number
    readonly kind: 'rework'
    readonly submittedBy: string
    readonly submittedAt: string
    readonly instructions?: string
  }

/** Integrity state of one Gate-required Evidence Record. */
export interface RequiredEvidenceState {
  readonly kind: string
  readonly state: 'valid' | 'missing' | 'corrupt' | 'redacted'
}

/** Normalized outcome of one required verification command. */
export type VerificationCategory = 'functional' | 'negative' | 'regression' | 'security'

/** Normalized outcome of one required verification command. */
export interface VerificationEvidenceState {
  readonly category: VerificationCategory
  readonly outcome:
    | 'passed'
    | 'not_applicable'
    | 'failed'
    | 'missing'
    | 'timed_out'
    | 'truncated'
    | 'redacted'
    | 'provider_failed'
}

/** Deterministic facts consumed by the pure Quality Gate. */
export interface GateInput {
  readonly requiredEvidence: readonly RequiredEvidenceState[]
  readonly verifications: readonly VerificationEvidenceState[]
  /** Kernel-owned required Assurance Results; Provider claims never enter the Gate directly. */
  readonly assuranceResults: readonly {
    readonly requirementId: string
    readonly outcome: 'satisfied' | 'failed' | 'indeterminate'
  }[]
  readonly reviewerFindings: readonly {
    readonly severity: 'blocking' | 'non_blocking'
    readonly code: string
  }[]
  readonly implementationSecretCount: number
  readonly workspacePolicyViolations: readonly string[]
}

/** Machine-readable Gate result persisted with the Mission revision. */
export interface GateDecision {
  readonly kind: 'approved' | 'rework_required' | 'blocked'
  readonly reasons: readonly { readonly code: string; readonly source: string }[]
}

/** Attempt-bound immutable Quality Gate decision history. */
export interface GateDecisionRecord {
  readonly attempt: number
  readonly decidedAt: string
  readonly decision: GateDecision
}

/** Attempt-bound history row containing selection keys only, never live Provider handles. */
export interface AttemptAssuranceProviderSelectionV1 {
  readonly schemaVersion: 1
  readonly attempt: number
  readonly providers: readonly FrozenAssuranceProviderSelectionV1[]
}

/** Post-implementation Git Subject frozen once for one Attempt before external assessment. */
export interface AttemptAssuranceSubjectV1 {
  readonly schemaVersion: 1
  readonly attempt: number
  readonly subject: AssuranceSubmissionBindingV1['subject']
  readonly implementationEvidenceRecordId: string
  readonly frozenAt: string
}

export type AssuranceEligibilityFailureCode =
  | 'submission_unreadable'
  | 'submission_invalid'
  | 'provider_composition_invalid'
  | 'provider_policy_invalid'
  | 'coverage_invalid'
  | 'source_seal_invalid'
  | 'provenance_invalid'
  | 'evidence_missing'

export type AssuranceAssessmentReasonCode =
  | 'eligible_submission'
  | AssuranceEligibilityFailureCode
  | 'provider_unavailable'
  | 'submission_rejected'
  | 'submission_import_failed'
  | 'provider_incomplete'
  | 'external_assessment_blocked'
  | 'external_assessment_canceled'
  | 'external_assessment_failed'

export type AssuranceProviderEligibilityV1 =
  | { readonly invocationId: string; readonly kind: 'eligible' }
  | {
    readonly invocationId: string
    readonly kind: 'indeterminate'
    readonly failureCode: AssuranceEligibilityFailureCode
  }

/** One Kernel-owned evaluation of a frozen external Provider invocation. */
export interface AssuranceAssessmentV1 {
  readonly schemaVersion: 1
  readonly assessmentId: string
  readonly requirementId: string
  readonly invocationId: string
  readonly attempt: number
  readonly assessor: {
    readonly kind: 'machine_provider'
    readonly provider: FrozenAssuranceProviderSelectionV1['descriptor']
  }
  readonly outcome: AssuranceClaimedOutcomeV1
  readonly reasonCodes: readonly AssuranceAssessmentReasonCode[]
  readonly evidenceRecordIds: readonly string[]
  readonly assessedAt: string
}

/** Deterministic aggregate for one external Provider Requirement in one Attempt. */
export interface AssuranceResultV1 {
  readonly schemaVersion: 1
  readonly requirementId: string
  readonly attempt: number
  readonly outcome: AssuranceClaimedOutcomeV1
  readonly assessmentIds: readonly string[]
  readonly reasonCodes: readonly AssuranceAssessmentReasonCode[]
}

interface AssuranceProviderInvocationBaseV1 {
  readonly schemaVersion: 1
  readonly invocationId: string
  readonly attempt: number
  readonly descriptor: FrozenAssuranceProviderSelectionV1['descriptor']
  readonly configuration?: FrozenAssuranceProviderSelectionV1['configuration']
  readonly preparedAt: string
}

/** Durable monotonic fact for one exact Provider invocation; never contains its runtime handle. */
export type AssuranceProviderInvocationRecordV1 =
  | AssuranceProviderInvocationBaseV1 & {
    readonly state: 'prepared'
  }
  | AssuranceProviderInvocationBaseV1 & {
    readonly state: 'begun'
    readonly begunAt: string
  }
  | AssuranceProviderInvocationBaseV1 & {
    readonly state: 'unavailable'
    /** Present when registration disappeared after durable begin admission. */
    readonly begunAt?: string
    readonly unavailableAt: string
    readonly failureCode: AssuranceProviderUnavailableCode
  }
  | AssuranceProviderInvocationBaseV1 & {
    readonly state: 'settled'
    readonly begunAt: string
    readonly settledAt: string
    readonly outcome: {
      readonly kind: 'sealed_submission'
      readonly submissionDigest: string
      readonly evidenceRecordId: string
      /** Provider claim only; no Assurance Result or Gate authority is implied. */
      readonly claimedOutcome: AssuranceClaimedOutcomeV1
    }
  }
  | AssuranceProviderInvocationBaseV1 & {
    readonly state: 'rejected'
    readonly begunAt: string
    readonly rejectedAt: string
    readonly failureCode: AssuranceSubmissionRejectionCode
  }
  | AssuranceProviderInvocationBaseV1 & {
    readonly state: 'import_failed'
    readonly begunAt: string
    readonly failedAt: string
    readonly failureCode: 'evidence_store_failure'
  }
  | AssuranceProviderInvocationBaseV1 & {
    readonly state: 'external_failed'
    readonly begunAt: string
    readonly failedAt: string
    readonly failure: ExternalAssessmentFailureV1
  }
  | AssuranceProviderInvocationBaseV1 & {
    readonly state: 'terminated'
    readonly begunAt: string
    readonly terminatedAt: string
    readonly outcome: AssuranceProviderCancellationOutcomeV1
  }

/** Immutable reference to one completely published canonical Evidence envelope. */
export interface EvidenceRecord {
  readonly recordId: string
  readonly missionId: string
  readonly attempt: number
  readonly kind: string
  readonly schemaVersion: number
  readonly digest: string
  readonly byteLength: number
  readonly relativePath: string
  readonly redacted: boolean
  readonly createdAt: string
}

/** Fixed v0.1 engineering roles; each run is one-shot within one Attempt. */
export type RoleName = 'planner' | 'developer' | 'tester' | 'reviewer'

/** Trace-only identity returned by a Harness subagent provider. */
export interface RoleRunTrace {
  readonly provider: string
  readonly providerRunId: string
  readonly sessionId?: string
}

/** Durable lifecycle record for one bounded Role assignment. */
export interface RoleRunRecord {
  readonly runId: string
  readonly missionId: string
  readonly attempt: number
  readonly role: RoleName
  readonly state: 'starting' | 'running' | 'completed' | 'failed' | 'aborted'
  readonly createdAt: string
  readonly publishedAt?: string
  readonly settledAt?: string
  readonly trace?: RoleRunTrace
  readonly stopReason?: string
  readonly diagnostic?: string
  readonly evidenceRecordIds: readonly string[]
}

/** Closed commands accepted by the Kernel Interface. */
export type MissionCommand =
  | { readonly kind: 'start'; readonly idempotencyKey: string; readonly input: StartMissionInput }
  | {
    readonly kind: 'resume'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly supplementalContext?: string
  }
  | {
    readonly kind: 'cancel'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly finalRepositoryEvidence: EvidenceRecord
    readonly reason?: string
  }
  | {
    readonly kind: 'rework'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly instructions?: string
  }
  | {
    readonly kind: 'advance'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly to: MissionPhase
  }
  | {
    readonly kind: 'block'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly reason: BlockedReason
    readonly workspaceFingerprint?: string
    readonly sealLiveRoleRuns?: {
      readonly stopReason: string
      readonly diagnostic?: string
    }
  }
  | {
    readonly kind: 'decide_gate'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly input: GateInput
  }
  | {
    readonly kind: 'record_evidence'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly record: EvidenceRecord
  }
  | {
    readonly kind: 'evaluate_assurance_provider_invocations'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly eligibilities: readonly AssuranceProviderEligibilityV1[]
  }
  | {
    readonly kind: 'prepare_role_run'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly runId: string
    readonly role: RoleName
  }
  | {
    readonly kind: 'publish_role_run'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly runId: string
    readonly trace: RoleRunTrace
  }
  | {
    readonly kind: 'settle_role_run'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly runId: string
    readonly outcome: 'completed' | 'failed' | 'aborted'
    readonly evidenceRecordIds: readonly string[]
    readonly stopReason?: string
    readonly diagnostic?: string
  }
  | {
    readonly kind: 'freeze_assurance_subject'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly subject: AssuranceSubmissionBindingV1['subject']
    readonly implementationEvidenceRecordId: string
  }
  | {
    readonly kind: 'begin_assurance_provider_invocation'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly invocationId: string
  }
  | {
    readonly kind: 'mark_assurance_provider_invocation_unavailable'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly invocationId: string
    readonly expectedState: 'prepared' | 'begun'
    readonly failureCode: AssuranceProviderUnavailableCode
  }
  | {
    readonly kind: 'settle_assurance_provider_invocation'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly invocationId: string
    readonly outcome:
      | {
        readonly kind: 'sealed_submission'
        readonly binding: AssuranceSubmissionBindingV1
        readonly submissionDigest: string
        readonly claimedOutcome: AssuranceClaimedOutcomeV1
        readonly evidenceRecord: EvidenceRecord
      }
      | {
        readonly kind: 'rejected_submission'
        readonly failureCode: AssuranceSubmissionRejectionCode
      }
      | {
        readonly kind: 'import_failed'
        readonly failureCode: 'evidence_store_failure'
      }
      | {
        readonly kind: 'external_failure'
        readonly failure: ExternalAssessmentFailureV1
      }
  }
  | {
    readonly kind: 'terminate_assurance_provider_invocation'
    readonly missionId: MissionId
    readonly expectedRevision: number
    readonly invocationId: string
    readonly outcome: AssuranceProviderCancellationOutcomeV1
  }

/** Durable acknowledgement of an accepted Mission command. */
export interface MissionReceipt {
  readonly missionId: MissionId
  readonly revision: number
  readonly status: MissionStatus
  readonly attempt: number
  readonly acceptedAt: string
}

/** Durable Mission truth returned through the Kernel query Interface. */
export interface MissionSnapshot {
  readonly missionId: MissionId
  readonly revision: number
  readonly repository: RepositoryIdentity
  readonly writeLease: WriteLeaseState
  readonly objective: string
  readonly context?: string
  readonly acceptanceCriteria: readonly string[]
  readonly constraints: readonly string[]
  readonly effectivePolicy: EffectivePolicy
  readonly effectivePolicyDigest: string
  readonly assuranceProviderSelections?: readonly AttemptAssuranceProviderSelectionV1[]
  readonly assuranceSubjects?: readonly AttemptAssuranceSubjectV1[]
  readonly assuranceProviderInvocations?: readonly AssuranceProviderInvocationRecordV1[]
  readonly assuranceAssessments?: readonly AssuranceAssessmentV1[]
  readonly assuranceResults?: readonly AssuranceResultV1[]
  readonly status: MissionStatus
  readonly attempt: number
  readonly inputRecords: readonly MissionInputRecord[]
  readonly roleRuns: readonly RoleRunRecord[]
  readonly evidence: { readonly records: readonly EvidenceRecord[] }
  readonly gate?: GateDecision
  readonly gateHistory: readonly GateDecisionRecord[]
  readonly blocked?: {
    readonly reason: BlockedReason
    readonly resumeStatus: MissionPhase
    readonly blockedAt: string
    readonly workspaceFingerprint?: string
  }
  readonly cancellation?: {
    readonly reason?: string
    readonly requestedBy: string
    readonly requestedAt: string
    readonly repositoryEvidenceRecordId: string
  }
  readonly createdAt: string
  readonly updatedAt: string
}

/** Small external Kernel Interface shared by production callers and tests. */
export interface ControlPlaneKernel {
  /**
   * Validate and durably apply one Mission command.
   * @param command - closed Mission command.
   * @param authority - host-derived repository/action authority.
   * @returns the durable command receipt.
   */
  dispatch(command: MissionCommand, authority: MissionAuthority): Promise<MissionReceipt>

  /**
   * Read one durable Mission revision.
   * @param missionId - Mission to read.
   * @param authority - host-derived read authority.
   * @returns the current durable snapshot.
   */
  snapshot(missionId: MissionId | string, authority: MissionAuthority): Promise<MissionSnapshot>
}
