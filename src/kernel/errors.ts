import type { MissionId, MissionStatus } from './types.js'

/** Stable Kernel error codes exposed across Adapter seams. */
export type MissionErrorCode =
  | 'repository_busy'
  | 'mission_not_found'
  | 'authority_denied'
  | 'invalid_evidence'
  | 'invalid_role_run'
  | 'write_lease_denied'
  | 'revision_conflict'
  | 'illegal_transition'

/** Structured rejection carrying facts callers need for a legal next action. */
export class MissionError extends Error {
  readonly code: MissionErrorCode
  readonly missionId?: MissionId
  readonly status?: MissionStatus
  readonly currentRevision?: number

  /**
   * @param code - stable rejection category.
   * @param message - human-readable diagnostic.
   * @param facts - current Mission facts safe to return to a caller.
   */
  constructor(
    code: MissionErrorCode,
    message: string,
    facts: { readonly missionId?: MissionId; readonly status?: MissionStatus; readonly currentRevision?: number } = {},
  ) {
    super(message)
    this.name = 'MissionError'
    this.code = code
    if (facts.missionId !== undefined) this.missionId = facts.missionId
    if (facts.status !== undefined) this.status = facts.status
    if (facts.currentRevision !== undefined) this.currentRevision = facts.currentRevision
  }
}
