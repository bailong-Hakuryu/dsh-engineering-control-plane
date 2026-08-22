import { createInMemoryMissionStore } from './memory-store.js'
import type { MissionStore } from './memory-store.js'
import { MissionError } from './errors.js'
import { isMissionPhase, mayAdvance } from './state-machine.js'
import { evaluateGate } from './gate.js'
import type {
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

        const policy = options.resolveEffectivePolicy(authority)
        const holderId = requireLeaseHolderId(authority)
        const acceptance = await options.store.acceptStart(
          command.idempotencyKey,
          authority.repository.canonicalRoot,
          () => {
            const acceptedAt = options.now()
            return {
              missionId: missionId(options.nextMissionId()),
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
          const submittedAt = options.now()
          return {
            ...current,
            revision: current.revision + 1,
            status: 'PLANNING',
            attempt: current.attempt + 1,
            writeLease: activateWriteLease(current, authority, submittedAt),
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
