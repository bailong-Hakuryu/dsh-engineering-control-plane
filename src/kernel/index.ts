import { createInMemoryMissionStore } from './memory-store.js'
import type { MissionStore } from './memory-store.js'
import { MissionError } from './errors.js'
import { isMissionPhase, mayAdvance } from './state-machine.js'
import { evaluateGate } from './gate.js'
import type {
  AssuranceProviderCancellationOutcomeV1,
  AssuranceProviderUnavailableCode,
  AssuranceSubmissionBindingV1,
  AssuranceSubmissionRejectionCode,
} from '../assurance-provider/contracts.js'
import type {
  AssuranceAssessmentReasonCode,
  AssuranceEligibilityFailureCode,
  AssuranceProviderInvocationRecordV1,
  ControlPlaneKernel,
  EffectivePolicy,
  EvidenceRecord,
  MissionAuthority,
  MissionCommand,
  MissionId,
  MissionReceipt,
  MissionSnapshot,
  RoleName,
  WriteLeaseState,
} from './types.js'

const ASSURANCE_PROVIDER_UNAVAILABLE_CODES = new Set<AssuranceProviderUnavailableCode>([
  'registration_missing',
  'factory_failed',
  'invalid_provider',
  'descriptor_mismatch',
])

const ASSURANCE_SUBMISSION_REJECTION_CODES = new Set<AssuranceSubmissionRejectionCode>([
  'malformed_submission',
  'unsupported_schema',
  'unsealed_submission',
  'invocation_mismatch',
  'mission_mismatch',
  'attempt_mismatch',
  'provider_mismatch',
  'subject_mismatch',
  'policy_mismatch',
  'digest_mismatch',
  'redacted_submission',
  'submission_too_large',
])

const SHA256 = /^sha256:[0-9a-f]{64}$/u
const EXTERNAL_ASSESSMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u

function validProviderCancellationOutcome(
  outcome: AssuranceProviderCancellationOutcomeV1,
): boolean {
  if (outcome.kind === 'external_assessment_not_started') {
    return Object.keys(outcome).length === 1
  }
  if (!EXTERNAL_ASSESSMENT_ID.test(outcome.externalAssessmentId)) return false
  if (outcome.kind === 'external_assessment_canceled') {
    return Object.keys(outcome).length === 2
  }
  return outcome.kind === 'external_assessment_terminal'
    && (outcome.terminalState === 'sealed' || outcome.terminalState === 'canceled')
    && Object.keys(outcome).length === 3
}

const ASSURANCE_ELIGIBILITY_FAILURE_CODES = new Set<AssuranceEligibilityFailureCode>([
  'submission_unreadable',
  'submission_invalid',
  'provider_composition_invalid',
  'provider_policy_invalid',
  'coverage_invalid',
  'source_seal_invalid',
  'provenance_invalid',
  'evidence_missing',
])

export { createInMemoryMissionStore }
export { MissionError }
export type * from './types.js'
export type { MissionStore } from './memory-store.js'

/** Construction dependencies hidden behind the ControlPlaneKernel Interface. */
export interface ControlPlaneKernelOptions {
  readonly store: MissionStore
  readonly nextMissionId: () => string
  readonly now: () => string
  readonly resolveEffectivePolicy: (authority: MissionAuthority) => EffectivePolicy
}

function missionId(value: string): MissionId {
  return value as MissionId
}

function roleForStatus(status: MissionSnapshot['status']): RoleName | undefined {
  switch (status) {
    case 'PLANNING': return 'planner'
    case 'IMPLEMENTING': return 'developer'
    case 'VERIFYING': return 'tester'
    case 'REVIEWING': return 'reviewer'
    default: return undefined
  }
}

function hasSelectedAssuranceProviders(snapshot: MissionSnapshot): boolean {
  return (snapshot.assuranceProviderSelections
    ?.find(selection => selection.attempt === snapshot.attempt)
    ?.providers.length ?? 0) > 0
}

function assuranceExecutionUnavailable(snapshot: MissionSnapshot): boolean {
  return snapshot.blocked?.reason.code === 'assurance_execution_unavailable'
}

function currentAssuranceSubject(snapshot: MissionSnapshot) {
  return snapshot.assuranceSubjects?.find(subject => subject.attempt === snapshot.attempt)
}

function externalAssuranceRequirementId(
  descriptor: AssuranceProviderInvocationRecordV1['descriptor'],
): string {
  return `external-provider:${descriptor.providerId}@${descriptor.providerVersion}`
}

function mayExecuteAssurance(snapshot: MissionSnapshot): boolean {
  return snapshot.status === 'IMPLEMENTING'
    || snapshot.status === 'VERIFYING'
    || snapshot.status === 'REVIEWING'
}

function preparedAssuranceProviderInvocationIndex(
  snapshot: MissionSnapshot,
  invocationId: string,
): number {
  const index = snapshot.assuranceProviderInvocations?.findIndex(record => (
    record.invocationId === invocationId
  )) ?? -1
  const invocation = snapshot.assuranceProviderInvocations?.[index]
  if (
    !mayExecuteAssurance(snapshot)
    || currentAssuranceSubject(snapshot) === undefined
    || invocation === undefined
    || invocation.attempt !== snapshot.attempt
    || invocation.state !== 'prepared'
    || invocationId.trim().length === 0
  ) {
    throw new MissionError(
      'illegal_transition',
      `Mission '${snapshot.missionId}' cannot begin Assurance Provider invocation '${invocationId}'`,
      {
        missionId: snapshot.missionId,
        status: snapshot.status,
        currentRevision: snapshot.revision,
      },
    )
  }
  return index
}

function begunAssuranceProviderInvocationIndex(
  snapshot: MissionSnapshot,
  invocationId: string,
): number {
  const index = snapshot.assuranceProviderInvocations?.findIndex(record => (
    record.invocationId === invocationId
  )) ?? -1
  const invocation = snapshot.assuranceProviderInvocations?.[index]
  if (
    !mayExecuteAssurance(snapshot)
    || currentAssuranceSubject(snapshot) === undefined
    || invocation === undefined
    || invocation.attempt !== snapshot.attempt
    || invocation.state !== 'begun'
    || invocationId.trim().length === 0
  ) {
    throw new MissionError(
      'illegal_transition',
      `Mission '${snapshot.missionId}' cannot settle Assurance Provider invocation '${invocationId}'`,
      {
        missionId: snapshot.missionId,
        status: snapshot.status,
        currentRevision: snapshot.revision,
      },
    )
  }
  return index
}

function terminableAssuranceProviderInvocationIndex(
  snapshot: MissionSnapshot,
  invocationId: string,
): number {
  const index = snapshot.assuranceProviderInvocations?.findIndex(record => (
    record.invocationId === invocationId
  )) ?? -1
  const invocation = snapshot.assuranceProviderInvocations?.[index]
  if (
    (!mayExecuteAssurance(snapshot) && snapshot.status !== 'BLOCKED')
    || currentAssuranceSubject(snapshot) === undefined
    || invocation === undefined
    || invocation.attempt !== snapshot.attempt
    || invocation.state !== 'begun'
    || invocationId.trim().length === 0
  ) {
    throw new MissionError(
      'illegal_transition',
      `Mission '${snapshot.missionId}' cannot terminate Assurance Provider invocation '${invocationId}'`,
      {
        missionId: snapshot.missionId,
        status: snapshot.status,
        currentRevision: snapshot.revision,
      },
    )
  }
  return index
}

function unavailableAssuranceProviderInvocationIndex(
  snapshot: MissionSnapshot,
  invocationId: string,
  expectedState: 'prepared' | 'begun',
): number {
  const index = snapshot.assuranceProviderInvocations?.findIndex(record => (
    record.invocationId === invocationId
  )) ?? -1
  const invocation = snapshot.assuranceProviderInvocations?.[index]
  if (
    !mayExecuteAssurance(snapshot)
    || currentAssuranceSubject(snapshot) === undefined
    || invocation === undefined
    || invocation.attempt !== snapshot.attempt
    || invocation.state !== expectedState
    || invocationId.trim().length === 0
  ) {
    throw new MissionError(
      'illegal_transition',
      `Mission '${snapshot.missionId}' cannot mark Assurance Provider invocation '${invocationId}' unavailable`,
      {
        missionId: snapshot.missionId,
        status: snapshot.status,
        currentRevision: snapshot.revision,
      },
    )
  }
  return index
}

function sameSubmissionBinding(
  snapshot: MissionSnapshot,
  invocationId: string,
  binding: AssuranceSubmissionBindingV1,
): boolean {
  const invocation = snapshot.assuranceProviderInvocations?.find(record => (
    record.invocationId === invocationId
  ))
  const frozenSubject = currentAssuranceSubject(snapshot)?.subject
  return invocation !== undefined
    && frozenSubject !== undefined
    && binding.invocationId === invocationId
    && binding.missionId === snapshot.missionId
    && binding.attempt === snapshot.attempt
    && binding.provider.schemaVersion === invocation.descriptor.schemaVersion
    && binding.provider.providerId === invocation.descriptor.providerId
    && binding.provider.providerVersion === invocation.descriptor.providerVersion
    && binding.subject.kind === 'git_worktree'
    && binding.subject.branch === frozenSubject.branch
    && binding.subject.head === frozenSubject.head
    && binding.subject.workspaceFingerprint === frozenSubject.workspaceFingerprint
    && binding.effectivePolicyDigest === snapshot.effectivePolicyDigest
}

function unavailableAssuranceExecutionError(snapshot: MissionSnapshot): MissionError {
  return new MissionError(
    'illegal_transition',
    'Assurance Provider execution is unavailable in this Control Plane build',
    {
      missionId: snapshot.missionId,
      status: snapshot.status,
      currentRevision: snapshot.revision,
    },
  )
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

function requireAction(authority: MissionAuthority, action: MissionAuthority['actions'][number]): void {
  if (!authority.actions.includes(action)) {
    throw new MissionError('authority_denied', `Mission authority does not grant '${action}'`)
  }
}

function requireRepository(snapshot: MissionSnapshot, authority: MissionAuthority): void {
  if (snapshot.repository.canonicalRoot !== authority.repository.canonicalRoot) {
    throw new MissionError('authority_denied', 'Mission authority belongs to another repository')
  }
}

function leaseError(snapshot: MissionSnapshot, message: string): MissionError {
  return new MissionError('write_lease_denied', message, {
    missionId: snapshot.missionId,
    status: snapshot.status,
    currentRevision: snapshot.revision,
  })
}

function requireLeaseHolderId(authority: MissionAuthority, snapshot?: MissionSnapshot): string {
  const holderId = authority.leaseHolderId
  if (holderId === undefined || holderId.trim().length === 0) {
    if (snapshot !== undefined) throw leaseError(snapshot, 'Mission authority has no Write Lease holder identity')
    throw new MissionError('write_lease_denied', 'Mission authority has no Write Lease holder identity')
  }
  return holderId
}

function requireWriteLease(snapshot: MissionSnapshot, authority: MissionAuthority): void {
  const proof = authority.writeLease
  if (
    proof === undefined
    || proof.holderId.trim().length === 0
    || snapshot.writeLease.holderId !== proof.holderId
    || snapshot.writeLease.fencingToken !== proof.fencingToken
  ) {
    throw leaseError(snapshot, 'Mission authority is not the current fenced Write Lease holder')
  }
}

function activateWriteLease(
  snapshot: MissionSnapshot,
  authority: MissionAuthority,
  acquiredAt: string,
): WriteLeaseState {
  if (snapshot.writeLease.holderId !== undefined) {
    throw leaseError(snapshot, 'Mission Write Lease is still held and cannot be taken over automatically')
  }
  return {
    fencingToken: snapshot.writeLease.fencingToken + 1,
    holderId: requireLeaseHolderId(authority, snapshot),
    acquiredAt,
  }
}

function releaseWriteLease(snapshot: MissionSnapshot, releasedAt: string): WriteLeaseState {
  return {
    fencingToken: snapshot.writeLease.fencingToken,
    releasedAt,
  }
}

function requireIndexableEvidence(
  snapshot: MissionSnapshot,
  record: EvidenceRecord,
  expectedKind?: string,
): void {
  const belongsToAttempt = record.missionId === snapshot.missionId && record.attempt === snapshot.attempt
  const hasExpectedKind = expectedKind === undefined || record.kind === expectedKind
  const duplicate = snapshot.evidence.records.some(current => current.recordId === record.recordId)
  if (!belongsToAttempt || !hasExpectedKind || duplicate) {
    throw new MissionError(
      'invalid_evidence',
      `Evidence Record '${record.recordId}' cannot be indexed for this Mission Attempt`,
      {
        missionId: snapshot.missionId,
        status: snapshot.status,
        currentRevision: snapshot.revision,
      },
    )
  }
}

function updateError(
  result: Exclude<Awaited<ReturnType<MissionStore['update']>>, { readonly kind: 'updated' }>,
  missionId: MissionId,
): never {
  if (result.kind === 'not_found') {
    throw new MissionError('mission_not_found', `Mission '${missionId}' was not found`)
  }
  throw new MissionError(
    'revision_conflict',
    `Mission '${missionId}' is at revision ${result.snapshot.revision}`,
    {
      missionId: result.snapshot.missionId,
      status: result.snapshot.status,
      currentRevision: result.snapshot.revision,
    },
  )
}

/**
 * Create the deep Kernel Module over explicit persistence, identity, clock and policy dependencies.
 * @param options - construction dependencies owned by the host Adapter.
 * @returns the ControlPlaneKernel Interface.
 */
export function createControlPlaneKernel(options: ControlPlaneKernelOptions): ControlPlaneKernel {
  return {
    async dispatch(command: MissionCommand, authority: MissionAuthority): Promise<MissionReceipt> {
      if (command.kind === 'start') {
        requireAction(authority, 'start')

        const holderId = requireLeaseHolderId(authority)
        const acceptance = await options.store.acceptStart(
          command.idempotencyKey,
          authority.repository.canonicalRoot,
          () => {
            const acceptedAt = options.now()
            const policy = options.resolveEffectivePolicy(authority)
            const acceptedMissionId = missionId(options.nextMissionId())
            const providerSelections = (policy.selectedAssuranceProviders ?? []).map(selection => ({
              schemaVersion: 1 as const,
              descriptor: { ...selection.descriptor },
              activation: selection.activation,
              ...selection.configuration === undefined
                ? {}
                : { configuration: { ...selection.configuration } },
            }))
            return {
              missionId: acceptedMissionId,
              revision: 1,
              repository: authority.repository,
              writeLease: {
                fencingToken: 1,
                holderId,
                acquiredAt: acceptedAt,
              },
              objective: command.input.objective,
              ...command.input.context === undefined ? {} : { context: command.input.context },
              acceptanceCriteria: command.input.acceptanceCriteria ?? [],
              constraints: command.input.constraints ?? [],
              effectivePolicy: policy,
              effectivePolicyDigest: policy.digest,
              assuranceProviderSelections: [{
                schemaVersion: 1,
                attempt: 1,
                providers: providerSelections,
              }],
              assuranceProviderInvocations: providerSelections.map((selection, index) => ({
                schemaVersion: 1,
                invocationId: `${acceptedMissionId}:assurance:1:${index + 1}`,
                attempt: 1,
                descriptor: { ...selection.descriptor },
                ...selection.configuration === undefined
                  ? {}
                  : { configuration: { ...selection.configuration } },
                state: 'prepared' as const,
                preparedAt: acceptedAt,
              })),
              status: 'CREATED',
              attempt: 1,
              inputRecords: [{
                sequence: 1,
                kind: 'initial',
                submittedBy: authority.principalId,
                submittedAt: acceptedAt,
                objective: command.input.objective,
                ...command.input.context === undefined ? {} : { context: command.input.context },
                acceptanceCriteria: command.input.acceptanceCriteria ?? [],
                constraints: command.input.constraints ?? [],
              }],
              roleRuns: [],
              evidence: { records: [] },
              gateHistory: [],
              createdAt: acceptedAt,
              updatedAt: acceptedAt,
            } satisfies MissionSnapshot
          },
        )
        if (acceptance.kind === 'repository_busy') {
          throw new MissionError(
            'repository_busy',
            `Repository '${authority.repository.canonicalRoot}' already has a non-terminal Mission`,
            {
              missionId: acceptance.snapshot.missionId,
              status: acceptance.snapshot.status,
              currentRevision: acceptance.snapshot.revision,
            },
          )
        }
        return receipt(acceptance.snapshot)
      }

      if (command.kind === 'cancel') {
        requireAction(authority, 'cancel')
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          if (current.status === 'APPROVED' || current.status === 'CANCELLED') {
            throw new MissionError(
              'illegal_transition',
              `Mission '${current.missionId}' cannot be cancelled from ${current.status}`,
              {
                missionId: current.missionId,
                status: current.status,
                currentRevision: current.revision,
              },
            )
          }
          requireIndexableEvidence(
            current,
            command.finalRepositoryEvidence,
            'cancellation-repository-state',
          )
          const requestedAt = options.now()
          return {
            ...current,
            revision: current.revision + 1,
            status: 'CANCELLED',
            roleRuns: current.roleRuns.map(run => (
              run.state === 'starting' || run.state === 'running'
                ? {
                    ...run,
                    state: 'aborted' as const,
                    settledAt: requestedAt,
                    stopReason: 'mission-cancelled',
                  }
                : run
            )),
            cancellation: {
              ...command.reason === undefined ? {} : { reason: command.reason },
              requestedBy: authority.principalId,
              requestedAt,
              repositoryEvidenceRecordId: command.finalRepositoryEvidence.recordId,
            },
            evidence: {
              records: [...current.evidence.records, command.finalRepositoryEvidence],
            },
            writeLease: releaseWriteLease(current, requestedAt),
            updatedAt: requestedAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'advance') {
        requireAction(authority, 'orchestrate')
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          requireWriteLease(current, authority)
          if (!mayAdvance(current.status, command.to)) {
            throw new MissionError(
              'illegal_transition',
              `Mission '${current.missionId}' cannot advance from ${current.status} to ${command.to}`,
              {
                missionId: current.missionId,
                status: current.status,
                currentRevision: current.revision,
              },
            )
          }
          return {
            ...current,
            revision: current.revision + 1,
            status: command.to,
            updatedAt: options.now(),
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'block') {
        const restartRecovery = command.reason.code === 'host_restarted' && authority.actions.includes('recover')
        const cancellationRecovery = command.sealLiveRoleRuns !== undefined && authority.actions.includes('cancel')
        if (!restartRecovery && !cancellationRecovery) requireAction(authority, 'orchestrate')
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          if (!restartRecovery && !cancellationRecovery) requireWriteLease(current, authority)
          if (!isMissionPhase(current.status)) {
            throw new MissionError(
              'illegal_transition',
              `Mission '${current.missionId}' cannot be blocked from ${current.status}`,
              {
                missionId: current.missionId,
                status: current.status,
                currentRevision: current.revision,
              },
            )
          }
          const blockedAt = options.now()
          if (command.workspaceFingerprint !== undefined && command.workspaceFingerprint.trim().length === 0) {
            throw new TypeError('Blocked Workspace Fingerprint must not be empty')
          }
          const seal = restartRecovery
            ? {
                stopReason: 'host-restarted',
                diagnostic: 'Host process restarted before the Role Run settled.',
              }
            : command.sealLiveRoleRuns
          return {
            ...current,
            revision: current.revision + 1,
            status: 'BLOCKED',
            blocked: {
              reason: command.reason,
              resumeStatus: current.status,
              blockedAt,
              ...command.workspaceFingerprint === undefined
                ? {}
                : { workspaceFingerprint: command.workspaceFingerprint },
            },
            roleRuns: seal === undefined
              ? current.roleRuns
              : current.roleRuns.map(run => (
                  run.state === 'starting' || run.state === 'running'
                    ? {
                        ...run,
                        state: 'aborted' as const,
                        settledAt: blockedAt,
                        stopReason: seal.stopReason,
                        ...seal.diagnostic === undefined ? {} : { diagnostic: seal.diagnostic },
                      }
                    : run
                )),
            writeLease: releaseWriteLease(current, blockedAt),
            updatedAt: blockedAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'resume') {
        requireAction(authority, 'resume')
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          if (current.status !== 'BLOCKED' || current.blocked === undefined) {
            throw new MissionError(
              'illegal_transition',
              `Mission '${current.missionId}' cannot resume from ${current.status}`,
              {
                missionId: current.missionId,
                status: current.status,
                currentRevision: current.revision,
              },
            )
          }
          if (assuranceExecutionUnavailable(current)) {
            throw unavailableAssuranceExecutionError(current)
          }
          const resumedAt = options.now()
          const { blocked, ...unblocked } = current
          return {
            ...unblocked,
            revision: current.revision + 1,
            status: blocked.resumeStatus,
            writeLease: activateWriteLease(current, authority, resumedAt),
            inputRecords: [
              ...current.inputRecords,
              {
                sequence: current.inputRecords.length + 1,
                kind: 'resume',
                submittedBy: authority.principalId,
                submittedAt: resumedAt,
                ...command.supplementalContext === undefined
                  ? {}
                  : { supplementalContext: command.supplementalContext },
              },
            ],
            updatedAt: resumedAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'rework') {
        requireAction(authority, 'rework')
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          if (current.status !== 'REWORK_REQUIRED') {
            throw new MissionError(
              'illegal_transition',
              `Mission '${current.missionId}' cannot start Rework from ${current.status}`,
              {
                missionId: current.missionId,
                status: current.status,
                currentRevision: current.revision,
              },
            )
          }
          if (assuranceExecutionUnavailable(current)) {
            throw unavailableAssuranceExecutionError(current)
          }
          const submittedAt = options.now()
          const nextAttempt = current.attempt + 1
          const priorSelection = current.assuranceProviderSelections
            ?.find(selection => selection.attempt === current.attempt)
          const providers = (priorSelection?.providers
            ?? current.effectivePolicy.selectedAssuranceProviders
            ?? []).map(provider => ({
            schemaVersion: 1 as const,
            descriptor: { ...provider.descriptor },
            activation: provider.activation,
            ...provider.configuration === undefined
              ? {}
              : { configuration: { ...provider.configuration } },
          }))
          return {
            ...current,
            revision: current.revision + 1,
            status: 'PLANNING',
            attempt: nextAttempt,
            writeLease: activateWriteLease(current, authority, submittedAt),
            assuranceProviderSelections: [
              ...(current.assuranceProviderSelections ?? []),
              { schemaVersion: 1, attempt: nextAttempt, providers },
            ],
            assuranceProviderInvocations: [
              ...(current.assuranceProviderInvocations ?? []),
              ...providers.map((provider, index) => ({
                schemaVersion: 1 as const,
                invocationId: `${current.missionId}:assurance:${nextAttempt}:${index + 1}`,
                attempt: nextAttempt,
                descriptor: { ...provider.descriptor },
                ...provider.configuration === undefined
                  ? {}
                  : { configuration: { ...provider.configuration } },
                state: 'prepared' as const,
                preparedAt: submittedAt,
              })),
            ],
            inputRecords: [
              ...current.inputRecords,
              {
                sequence: current.inputRecords.length + 1,
                kind: 'rework',
                submittedBy: authority.principalId,
                submittedAt,
                ...command.instructions === undefined ? {} : { instructions: command.instructions },
              },
            ],
            updatedAt: submittedAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'freeze_assurance_subject') {
        requireAction(authority, 'orchestrate')
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          requireWriteLease(current, authority)
          const implementationEvidence = current.evidence.records.find(record => (
            record.recordId === command.implementationEvidenceRecordId
            && record.attempt === current.attempt
            && record.kind === 'implementation'
            && !record.redacted
          ))
          const alreadyFrozen = currentAssuranceSubject(current) !== undefined
          const selectedProviders = current.assuranceProviderSelections
            ?.find(selection => selection.attempt === current.attempt)
            ?.providers ?? []
          const currentInvocations = (current.assuranceProviderInvocations ?? [])
            .filter(invocation => invocation.attempt === current.attempt)
          const allPrepared = currentInvocations.length === selectedProviders.length
            && currentInvocations.every((invocation, index) => {
              const selected = selectedProviders[index]
              return selected !== undefined
                && invocation.state === 'prepared'
                && invocation.descriptor.schemaVersion === selected.descriptor.schemaVersion
                && invocation.descriptor.providerId === selected.descriptor.providerId
                && invocation.descriptor.providerVersion === selected.descriptor.providerVersion
            })
          if (
            current.status !== 'IMPLEMENTING'
            || !hasSelectedAssuranceProviders(current)
            || implementationEvidence === undefined
            || alreadyFrozen
            || !allPrepared
            || command.subject.kind !== 'git_worktree'
            || command.subject.branch !== current.repository.branch
            || command.subject.head !== current.repository.head
            || !SHA256.test(command.subject.workspaceFingerprint)
          ) {
            throw new MissionError(
              'illegal_transition',
              `Mission '${current.missionId}' cannot freeze its Assurance Subject`,
              {
                missionId: current.missionId,
                status: current.status,
                currentRevision: current.revision,
              },
            )
          }
          const frozenAt = options.now()
          return {
            ...current,
            revision: current.revision + 1,
            assuranceSubjects: [
              ...(current.assuranceSubjects ?? []),
              {
                schemaVersion: 1 as const,
                attempt: current.attempt,
                subject: {
                  kind: 'git_worktree' as const,
                  branch: command.subject.branch,
                  head: command.subject.head,
                  workspaceFingerprint: command.subject.workspaceFingerprint,
                },
                implementationEvidenceRecordId: implementationEvidence.recordId,
                frozenAt,
              },
            ],
            updatedAt: frozenAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'begin_assurance_provider_invocation') {
        requireAction(authority, 'orchestrate')
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          const invocationIndex = preparedAssuranceProviderInvocationIndex(current, command.invocationId)
          const begunAt = options.now()
          return {
            ...current,
            revision: current.revision + 1,
            assuranceProviderInvocations: current.assuranceProviderInvocations!.map((record, index) => (
              index === invocationIndex
                ? { ...record, state: 'begun' as const, begunAt }
                : record
            )),
            updatedAt: begunAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'mark_assurance_provider_invocation_unavailable') {
        requireAction(authority, 'orchestrate')
        if (command.expectedState !== 'prepared' && command.expectedState !== 'begun') {
          throw new TypeError('Assurance Provider unavailable expectedState is invalid')
        }
        if (!ASSURANCE_PROVIDER_UNAVAILABLE_CODES.has(command.failureCode)) {
          throw new TypeError('Assurance Provider unavailable failureCode is invalid')
        }
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          const invocationIndex = unavailableAssuranceProviderInvocationIndex(
            current,
            command.invocationId,
            command.expectedState,
          )
          const unavailableAt = options.now()
          return {
            ...current,
            revision: current.revision + 1,
            assuranceProviderInvocations: current.assuranceProviderInvocations!.map((record, index) => (
              index === invocationIndex
                ? {
                    ...record,
                    state: 'unavailable' as const,
                    unavailableAt,
                    failureCode: command.failureCode,
                  }
                : record
            )),
            updatedAt: unavailableAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'settle_assurance_provider_invocation') {
        requireAction(authority, 'orchestrate')
        const terminalOutcome = command.outcome
        if (
          terminalOutcome.kind !== 'sealed_submission'
          && terminalOutcome.kind !== 'rejected_submission'
          && terminalOutcome.kind !== 'import_failed'
        ) throw new TypeError('Assurance Provider terminal outcome kind is invalid')
        if (
          terminalOutcome.kind === 'rejected_submission'
          && !ASSURANCE_SUBMISSION_REJECTION_CODES.has(terminalOutcome.failureCode)
        ) {
          throw new TypeError('Assurance Submission rejection failureCode is invalid')
        }
        if (
          terminalOutcome.kind === 'import_failed'
          && terminalOutcome.failureCode !== 'evidence_store_failure'
        ) throw new TypeError('Assurance Submission import failureCode is invalid')
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          const invocationIndex = begunAssuranceProviderInvocationIndex(current, command.invocationId)
          const begunInvocation = current.assuranceProviderInvocations?.[invocationIndex]
          if (begunInvocation?.state !== 'begun') throw new Error('Unreachable begun invocation')
          const terminalAt = options.now()
          if (terminalOutcome.kind === 'sealed_submission') {
            if (
              !sameSubmissionBinding(current, command.invocationId, terminalOutcome.binding)
              || !SHA256.test(terminalOutcome.submissionDigest)
              || (terminalOutcome.claimedOutcome !== 'satisfied'
                && terminalOutcome.claimedOutcome !== 'failed'
                && terminalOutcome.claimedOutcome !== 'indeterminate')
              || terminalOutcome.evidenceRecord.redacted
            ) {
              throw new MissionError(
                'invalid_evidence',
                `Submission Evidence for invocation '${command.invocationId}' is not bound to this Mission Attempt`,
                {
                  missionId: current.missionId,
                  status: current.status,
                  currentRevision: current.revision,
                },
              )
            }
            requireIndexableEvidence(
              current,
              terminalOutcome.evidenceRecord,
              'assurance-provider-submission',
            )
            return {
              ...current,
              revision: current.revision + 1,
              assuranceProviderInvocations: current.assuranceProviderInvocations!.map((record, index) => (
                index === invocationIndex
                  ? {
                      ...begunInvocation,
                      state: 'settled' as const,
                      settledAt: terminalAt,
                      outcome: {
                        kind: 'sealed_submission' as const,
                        submissionDigest: terminalOutcome.submissionDigest,
                        evidenceRecordId: terminalOutcome.evidenceRecord.recordId,
                        claimedOutcome: terminalOutcome.claimedOutcome,
                      },
                    }
                  : record
              )),
              evidence: {
                records: [...current.evidence.records, terminalOutcome.evidenceRecord],
              },
              updatedAt: terminalAt,
            }
          }
          if (terminalOutcome.kind === 'import_failed') {
            return {
              ...current,
              revision: current.revision + 1,
              assuranceProviderInvocations: current.assuranceProviderInvocations!.map((record, index) => (
                index === invocationIndex
                  ? {
                      ...begunInvocation,
                      state: 'import_failed' as const,
                      failedAt: terminalAt,
                      failureCode: terminalOutcome.failureCode,
                    }
                  : record
              )),
              updatedAt: terminalAt,
            }
          }
          return {
            ...current,
            revision: current.revision + 1,
            assuranceProviderInvocations: current.assuranceProviderInvocations!.map((record, index) => (
              index === invocationIndex
                ? {
                    ...begunInvocation,
                    state: 'rejected' as const,
                    rejectedAt: terminalAt,
                    failureCode: terminalOutcome.failureCode,
                  }
                : record
            )),
            updatedAt: terminalAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'terminate_assurance_provider_invocation') {
        requireAction(authority, 'orchestrate')
        if (!validProviderCancellationOutcome(command.outcome)) {
          throw new TypeError('Assurance Provider cancellation outcome is invalid')
        }
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          const invocationIndex = terminableAssuranceProviderInvocationIndex(current, command.invocationId)
          const begunInvocation = current.assuranceProviderInvocations?.[invocationIndex]
          if (begunInvocation?.state !== 'begun') throw new Error('Unreachable begun invocation')
          const terminatedAt = options.now()
          return {
            ...current,
            revision: current.revision + 1,
            assuranceProviderInvocations: current.assuranceProviderInvocations!.map((record, index) => (
              index === invocationIndex
                ? {
                    ...begunInvocation,
                    state: 'terminated' as const,
                    terminatedAt,
                    outcome: { ...command.outcome },
                  }
                : record
            )),
            updatedAt: terminatedAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'evaluate_assurance_provider_invocations') {
        requireAction(authority, 'orchestrate')
        const eligibilityByInvocation = new Map<string, (typeof command.eligibilities)[number]>()
        for (const eligibility of command.eligibilities) {
          if (
            typeof eligibility !== 'object'
            || eligibility === null
            || typeof eligibility.invocationId !== 'string'
            || eligibility.invocationId.trim().length === 0
            || (eligibility.kind !== 'eligible' && eligibility.kind !== 'indeterminate')
            || (eligibility.kind === 'indeterminate'
              && !ASSURANCE_ELIGIBILITY_FAILURE_CODES.has(eligibility.failureCode))
            || eligibilityByInvocation.has(eligibility.invocationId)
          ) throw new TypeError('Assurance Provider eligibility is invalid')
          eligibilityByInvocation.set(eligibility.invocationId, eligibility)
        }
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          requireWriteLease(current, authority)
          const invocations = (current.assuranceProviderInvocations ?? [])
            .filter(invocation => invocation.attempt === current.attempt)
          const settledIds = new Set(invocations
            .filter(invocation => invocation.state === 'settled')
            .map(invocation => invocation.invocationId))
          const alreadyEvaluated = (current.assuranceAssessments ?? [])
            .some(assessment => assessment.attempt === current.attempt)
            || (current.assuranceResults ?? []).some(item => item.attempt === current.attempt)
          const completeEligibility = eligibilityByInvocation.size === settledIds.size
            && [...eligibilityByInvocation.keys()].every(id => settledIds.has(id))
          if (
            current.status !== 'REVIEWING'
            || !hasSelectedAssuranceProviders(current)
            || currentAssuranceSubject(current) === undefined
            || invocations.length === 0
            || alreadyEvaluated
            || !completeEligibility
          ) {
            throw new MissionError(
              'illegal_transition',
              `Mission '${current.missionId}' cannot evaluate Assurance Provider invocations`,
              {
                missionId: current.missionId,
                status: current.status,
                currentRevision: current.revision,
              },
            )
          }
          const assessedAt = options.now()
          const assessments = invocations.map((invocation) => {
            const requirementId = externalAssuranceRequirementId(invocation.descriptor)
            const assessmentId = `${invocation.invocationId}:assessment:1`
            let outcome: 'satisfied' | 'failed' | 'indeterminate' = 'indeterminate'
            let reasonCodes: AssuranceAssessmentReasonCode[]
            let evidenceRecordIds: string[] = []
            if (invocation.state === 'settled') {
              const eligibility = eligibilityByInvocation.get(invocation.invocationId)
              if (eligibility === undefined) throw new Error('Unreachable settled eligibility')
              evidenceRecordIds = [invocation.outcome.evidenceRecordId]
              if (eligibility.kind === 'eligible') {
                outcome = invocation.outcome.claimedOutcome
                reasonCodes = ['eligible_submission']
              } else {
                reasonCodes = [eligibility.failureCode]
              }
            } else if (invocation.state === 'unavailable') {
              reasonCodes = ['provider_unavailable']
            } else if (invocation.state === 'rejected') {
              reasonCodes = ['submission_rejected']
            } else if (invocation.state === 'import_failed') {
              reasonCodes = ['submission_import_failed']
            } else {
              reasonCodes = ['provider_incomplete']
            }
            return {
              schemaVersion: 1 as const,
              assessmentId,
              requirementId,
              invocationId: invocation.invocationId,
              attempt: current.attempt,
              assessor: {
                kind: 'machine_provider' as const,
                provider: { ...invocation.descriptor },
              },
              outcome,
              reasonCodes,
              evidenceRecordIds,
              assessedAt,
            }
          })
          const assuranceResults = assessments.map(assessment => ({
            schemaVersion: 1 as const,
            requirementId: assessment.requirementId,
            attempt: current.attempt,
            outcome: assessment.outcome,
            assessmentIds: [assessment.assessmentId],
            reasonCodes: [...assessment.reasonCodes],
          }))
          return {
            ...current,
            revision: current.revision + 1,
            assuranceAssessments: [...(current.assuranceAssessments ?? []), ...assessments],
            assuranceResults: [...(current.assuranceResults ?? []), ...assuranceResults],
            updatedAt: assessedAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'prepare_role_run') {
        requireAction(authority, 'orchestrate')
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          requireWriteLease(current, authority)
          const expectedRole = roleForStatus(current.status)
          const hasLiveRun = current.roleRuns.some(run => run.state === 'starting' || run.state === 'running')
          const duplicateId = current.roleRuns.some(run => run.runId === command.runId)
          if (expectedRole !== command.role || hasLiveRun || duplicateId || command.runId.trim().length === 0) {
            throw new MissionError(
              'invalid_role_run',
              `Mission '${current.missionId}' cannot prepare ${command.role} Role Run '${command.runId}' from ${current.status}`,
              {
                missionId: current.missionId,
                status: current.status,
                currentRevision: current.revision,
              },
            )
          }
          const createdAt = options.now()
          return {
            ...current,
            revision: current.revision + 1,
            roleRuns: [
              ...current.roleRuns,
              {
                runId: command.runId,
                missionId: current.missionId,
                attempt: current.attempt,
                role: command.role,
                state: 'starting',
                createdAt,
                evidenceRecordIds: [],
              },
            ],
            updatedAt: createdAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'publish_role_run') {
        requireAction(authority, 'orchestrate')
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          requireWriteLease(current, authority)
          const runIndex = current.roleRuns.findIndex(run => run.runId === command.runId)
          const run = current.roleRuns[runIndex]
          if (
            run === undefined
            || run.attempt !== current.attempt
            || run.state !== 'starting'
            || roleForStatus(current.status) !== run.role
            || command.trace.provider.trim().length === 0
            || command.trace.providerRunId.trim().length === 0
          ) {
            throw new MissionError(
              'invalid_role_run',
              `Mission '${current.missionId}' cannot publish Role Run '${command.runId}'`,
              {
                missionId: current.missionId,
                status: current.status,
                currentRevision: current.revision,
              },
            )
          }
          const publishedAt = options.now()
          return {
            ...current,
            revision: current.revision + 1,
            roleRuns: current.roleRuns.map((record, index) => index === runIndex
              ? { ...record, state: 'running', trace: command.trace, publishedAt }
              : record),
            updatedAt: publishedAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'settle_role_run') {
        requireAction(authority, 'orchestrate')
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          requireWriteLease(current, authority)
          const runIndex = current.roleRuns.findIndex(run => run.runId === command.runId)
          const run = current.roleRuns[runIndex]
          const evidenceIds = new Set(command.evidenceRecordIds)
          const indexedEvidence = new Set(current.evidence.records
            .filter(record => record.attempt === current.attempt)
            .map(record => record.recordId))
          const invalidEvidence = evidenceIds.size !== command.evidenceRecordIds.length
            || [...evidenceIds].some(id => !indexedEvidence.has(id))
          const missingCompletedOutput = command.outcome === 'completed' && evidenceIds.size === 0
          const diagnosticTooLarge = command.diagnostic !== undefined
            && Buffer.byteLength(command.diagnostic, 'utf8') > 4_096
          if (
            run === undefined
            || run.attempt !== current.attempt
            || (run.state !== 'starting' && run.state !== 'running')
            || roleForStatus(current.status) !== run.role
            || invalidEvidence
            || missingCompletedOutput
            || diagnosticTooLarge
          ) {
            throw new MissionError(
              'invalid_role_run',
              `Mission '${current.missionId}' cannot settle Role Run '${command.runId}'`,
              {
                missionId: current.missionId,
                status: current.status,
                currentRevision: current.revision,
              },
            )
          }
          const settledAt = options.now()
          return {
            ...current,
            revision: current.revision + 1,
            roleRuns: current.roleRuns.map((record, index) => index === runIndex
              ? {
                  ...record,
                  state: command.outcome,
                  settledAt,
                  evidenceRecordIds: [...command.evidenceRecordIds],
                  ...command.stopReason === undefined ? {} : { stopReason: command.stopReason },
                  ...command.diagnostic === undefined ? {} : { diagnostic: command.diagnostic },
                }
              : record),
            updatedAt: settledAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'decide_gate') {
        requireAction(authority, 'orchestrate')
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          requireWriteLease(current, authority)
          if (current.status !== 'REVIEWING') {
            throw new MissionError(
              'illegal_transition',
              `Mission '${current.missionId}' cannot decide its Gate from ${current.status}`,
              {
                missionId: current.missionId,
                status: current.status,
                currentRevision: current.revision,
              },
            )
          }
          const persistedAssurance = (current.assuranceResults ?? [])
            .filter(item => item.attempt === current.attempt)
          const gateAssurance = new Map(command.input.assuranceResults.map(item => [item.requirementId, item]))
          const exactAssuranceResults = gateAssurance.size === command.input.assuranceResults.length
            && persistedAssurance.length === command.input.assuranceResults.length
            && persistedAssurance.every(item => (
              gateAssurance.get(item.requirementId)?.outcome === item.outcome
            ))
          if (!exactAssuranceResults || (hasSelectedAssuranceProviders(current) && persistedAssurance.length === 0)) {
            throw new MissionError(
              'invalid_evidence',
              `Mission '${current.missionId}' Gate input does not match its Kernel-owned Assurance Results`,
              {
                missionId: current.missionId,
                status: current.status,
                currentRevision: current.revision,
              },
            )
          }
          const gate = evaluateGate(command.input)
          const decidedAt = options.now()
          return {
            ...current,
            revision: current.revision + 1,
            status: gate.kind === 'approved'
              ? 'APPROVED'
              : gate.kind === 'rework_required'
                ? 'REWORK_REQUIRED'
                : 'BLOCKED',
            gate,
            gateHistory: [
              ...current.gateHistory,
              { attempt: current.attempt, decidedAt, decision: gate },
            ],
            ...gate.kind === 'blocked'
              ? {
                  blocked: {
                    reason: {
                      code: 'evidence_incomplete' as const,
                      detail: gate.reasons.map(reason => `${reason.source}:${reason.code}`).join(', '),
                    },
                    resumeStatus: 'REVIEWING' as const,
                    blockedAt: decidedAt,
                  },
                }
              : {},
            writeLease: releaseWriteLease(current, decidedAt),
            updatedAt: decidedAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      if (command.kind === 'record_evidence') {
        requireAction(authority, 'orchestrate')
        const result = await options.store.update(command.missionId, command.expectedRevision, current => {
          requireRepository(current, authority)
          requireWriteLease(current, authority)
          if (!isMissionPhase(current.status)) {
            throw new MissionError(
              'illegal_transition',
              `Mission '${current.missionId}' cannot index Evidence from ${current.status}`,
              {
                missionId: current.missionId,
                status: current.status,
                currentRevision: current.revision,
              },
            )
          }
          requireIndexableEvidence(current, command.record)
          const indexedAt = options.now()
          return {
            ...current,
            revision: current.revision + 1,
            evidence: { records: [...current.evidence.records, command.record] },
            updatedAt: indexedAt,
          }
        })
        if (result.kind !== 'updated') return updateError(result, command.missionId)
        return receipt(result.snapshot)
      }

      throw new Error('Unreachable Mission command')
    },

    async snapshot(id: MissionId | string, authority: MissionAuthority): Promise<MissionSnapshot> {
      requireAction(authority, 'read')
      const snapshot = await options.store.get(id)
      if (snapshot === undefined) throw new MissionError('mission_not_found', `Mission '${id}' was not found`)
      requireRepository(snapshot, authority)
      return snapshot
    },
  }
}
