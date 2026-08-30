import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  inspectSqliteMissionStore,
  MissionStoreFormatError,
} from './adapters/sqlite-mission-store.js'
import {
  createFilesystemEvidenceStore,
  EvidenceStoreError,
} from './evidence/filesystem-store.js'
import { validateAssuranceSubmissionV1 } from './assurance-provider/submission.js'
import type { MissionSnapshot } from './kernel/types.js'

export interface DoctorIssue {
  readonly code: string
  readonly detail: string
  readonly missionId?: string
  readonly recordId?: string
}

export interface ControlPlaneDoctorReport {
  readonly ok: boolean
  readonly home: string
  readonly database: {
    readonly path: string
    readonly exists: boolean
    readonly schemaVersion?: number
    readonly applicationId?: number
    readonly quickCheck?: string
  }
  readonly missions: {
    readonly total: number
    readonly nonTerminal: number
    readonly activeWriteLeases: number
  }
  readonly evidence: {
    readonly indexed: number
    readonly valid: number
    readonly missing: number
    readonly corrupt: number
  }
  readonly issues: readonly DoctorIssue[]
}

export interface InspectControlPlaneOptions {
  readonly dshHome?: string
}

function terminal(snapshot: MissionSnapshot): boolean {
  return snapshot.status === 'APPROVED' || snapshot.status === 'CANCELLED'
}

function databaseIssue(error: unknown): DoctorIssue {
  if (error instanceof MissionStoreFormatError) {
    return {
      code: error.code === 'unsupported_format'
        ? 'unsupported_database_format'
        : 'corrupt_database',
      detail: error.message,
    }
  }
  return {
    code: 'unreadable_database',
    detail: error instanceof Error ? error.message : String(error),
  }
}

/** Inspect durable Mission and Evidence integrity without creating, migrating, or repairing anything. */
export async function inspectControlPlane(
  options: InspectControlPlaneOptions = {},
): Promise<ControlPlaneDoctorReport> {
  const home = resolve(resolveDshHome(options.dshHome))
  const databasePath = join(home, 'control-plane', 'control-plane.sqlite')
  try {
    const metadata = await stat(databasePath)
    if (!metadata.isFile()) throw new Error('Mission database path is not a regular file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        ok: false,
        home,
        database: { path: databasePath, exists: false },
        missions: { total: 0, nonTerminal: 0, activeWriteLeases: 0 },
        evidence: { indexed: 0, valid: 0, missing: 0, corrupt: 0 },
        issues: [{ code: 'missing_database', detail: `No Mission database exists at "${databasePath}"` }],
      }
    }
    return {
      ok: false,
      home,
      database: { path: databasePath, exists: true },
      missions: { total: 0, nonTerminal: 0, activeWriteLeases: 0 },
      evidence: { indexed: 0, valid: 0, missing: 0, corrupt: 0 },
      issues: [databaseIssue(error)],
    }
  }

  let inspection: ReturnType<typeof inspectSqliteMissionStore>
  try {
    inspection = inspectSqliteMissionStore(databasePath)
  } catch (error) {
    return {
      ok: false,
      home,
      database: { path: databasePath, exists: true },
      missions: { total: 0, nonTerminal: 0, activeWriteLeases: 0 },
      evidence: { indexed: 0, valid: 0, missing: 0, corrupt: 0 },
      issues: [databaseIssue(error)],
    }
  }

  const issues: DoctorIssue[] = []
  let activeWriteLeases = 0
  let indexed = 0
  let valid = 0
  let missing = 0
  let corrupt = 0
  const evidenceStore = createFilesystemEvidenceStore({
    root: join(home, 'control-plane', 'missions'),
  })

  for (const snapshot of inspection.snapshots) {
    if (snapshot.effectivePolicy.digest !== snapshot.effectivePolicyDigest) {
      issues.push({
        code: 'effective_policy_digest_mismatch',
        detail: 'Effective Policy digest fields disagree.',
        missionId: snapshot.missionId,
      })
    }
    if (
      !Number.isSafeInteger(snapshot.writeLease.fencingToken)
      || snapshot.writeLease.fencingToken < 0
    ) {
      issues.push({
        code: 'invalid_fencing_token',
        detail: 'Write Lease fencing token is not a non-negative safe integer.',
        missionId: snapshot.missionId,
      })
    }
    if (snapshot.writeLease.holderId !== undefined) {
      activeWriteLeases += 1
      if (terminal(snapshot) || snapshot.status === 'BLOCKED' || snapshot.status === 'REWORK_REQUIRED') {
        issues.push({
          code: 'lease_held_outside_active_phase',
          detail: `Write Lease remains held while Mission status is ${snapshot.status}.`,
          missionId: snapshot.missionId,
        })
      }
    }
    if (
      snapshot.cancellation !== undefined
      && !snapshot.evidence.records.some(
        record => record.recordId === snapshot.cancellation?.repositoryEvidenceRecordId,
      )
    ) {
      issues.push({
        code: 'missing_cancellation_evidence_reference',
        detail: 'Cancellation metadata points to no indexed Evidence Record.',
        missionId: snapshot.missionId,
      })
    }
    for (const invocation of snapshot.assuranceProviderInvocations ?? []) {
      if (invocation.state !== 'settled') continue
      const referenced = snapshot.evidence.records.find(record => (
        record.recordId === invocation.outcome.evidenceRecordId
      ))
      if (referenced === undefined) {
        issues.push({
          code: 'missing_assurance_submission_evidence_reference',
          detail: 'A settled Assurance Provider Invocation points to no indexed Evidence Record.',
          missionId: snapshot.missionId,
          recordId: invocation.outcome.evidenceRecordId,
        })
      } else if (
        referenced.missionId !== snapshot.missionId
        || referenced.attempt !== invocation.attempt
        || referenced.kind !== 'assurance-provider-submission'
        || referenced.redacted
      ) {
        issues.push({
          code: 'invalid_assurance_submission_evidence_reference',
          detail: 'A settled Assurance Provider Invocation points to ineligible Submission Evidence.',
          missionId: snapshot.missionId,
          recordId: referenced.recordId,
        })
      } else {
        try {
          const attemptSubject = snapshot.assuranceSubjects?.find(item => item.attempt === invocation.attempt)?.subject
          if (attemptSubject === undefined) {
            throw new TypeError('Invocation has no frozen Attempt Subject')
          }
          const payload = await evidenceStore.read(referenced)
          const validated = validateAssuranceSubmissionV1(payload, {
            invocationId: invocation.invocationId,
            missionId: snapshot.missionId,
            attempt: invocation.attempt,
            provider: invocation.descriptor,
            subject: attemptSubject,
            effectivePolicyDigest: snapshot.effectivePolicyDigest,
          }, snapshot.effectivePolicy.artifactBudgets?.maxRecordBytes)
          if (
            validated.submissionDigest !== invocation.outcome.submissionDigest
            || validated.claimedOutcome !== invocation.outcome.claimedOutcome
          ) throw new TypeError('Invocation outcome disagrees with imported Submission')
        } catch (error) {
          if (!(error instanceof EvidenceStoreError)) {
            issues.push({
              code: 'invalid_assurance_submission_evidence_payload',
              detail: 'Imported Submission Evidence disagrees with its settled Provider Invocation.',
              missionId: snapshot.missionId,
              recordId: referenced.recordId,
            })
          }
        }
      }
    }

    const recordIds = new Set<string>()
    for (const record of snapshot.evidence.records) {
      indexed += 1
      if (recordIds.has(record.recordId)) {
        issues.push({
          code: 'duplicate_evidence_record',
          detail: 'Evidence Record id appears more than once in the Mission manifest.',
          missionId: snapshot.missionId,
          recordId: record.recordId,
        })
      }
      recordIds.add(record.recordId)
      const integrity = await evidenceStore.inspect(record)
      if (integrity.state === 'valid') {
        valid += 1
      } else if (integrity.state === 'missing') {
        missing += 1
        issues.push({
          code: 'missing_evidence',
          detail: 'Indexed Evidence envelope is absent.',
          missionId: snapshot.missionId,
          recordId: record.recordId,
        })
      } else {
        corrupt += 1
        issues.push({
          code: 'corrupt_evidence',
          detail: 'Indexed Evidence envelope failed identity or digest validation.',
          missionId: snapshot.missionId,
          recordId: record.recordId,
        })
      }
    }
  }

  return {
    ok: issues.length === 0,
    home,
    database: {
      path: inspection.path,
      exists: true,
      schemaVersion: inspection.schemaVersion,
      applicationId: inspection.applicationId,
      quickCheck: inspection.quickCheck,
    },
    missions: {
      total: inspection.snapshots.length,
      nonTerminal: inspection.snapshots.filter(snapshot => !terminal(snapshot)).length,
      activeWriteLeases,
    },
    evidence: { indexed, valid, missing, corrupt },
    issues,
  }
}
