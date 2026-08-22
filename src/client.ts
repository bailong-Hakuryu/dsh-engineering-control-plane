import { Context, Service } from '@deepseek-ai/cordis'

export const name = 'engineering-control-plane-client'

export type ProjectedMissionStatus =
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

/** Browser-safe whole-value Mission projection; it is never domain authority. */
export interface MissionProjectionSnapshot {
  readonly missionId: string
  readonly revision: number
  readonly status: ProjectedMissionStatus
  readonly attempt: number
  readonly writeLease: {
    readonly fencingToken: number
    readonly active: boolean
  }
  readonly blockedCode?: string
  readonly roleRuns: readonly {
    readonly runId: string
    readonly role: 'planner' | 'developer' | 'tester' | 'reviewer'
    readonly state: 'starting' | 'running' | 'completed' | 'failed' | 'aborted'
  }[]
  readonly evidenceCount: number
  readonly gate?: 'approved' | 'rework_required' | 'blocked'
}

/** One contiguous whole-snapshot event emitted only after the Kernel commit. */
export interface MissionProjectionEvent {
  readonly missionId: string
  readonly revision: number
  readonly snapshot: MissionProjectionSnapshot
}

export type MissionProjectionApplyResult =
  | { readonly kind: 'applied'; readonly snapshot: MissionProjectionSnapshot }
  | { readonly kind: 'stale'; readonly currentRevision: number }
  | {
    readonly kind: 'resync_required'
    readonly missionId: string
    readonly expectedRevision: number
    readonly receivedRevision: number
  }

export type MissionProjectionListener = (snapshot: MissionProjectionSnapshot) => void

declare module '@deepseek-ai/cordis' {
  interface Context {
    engineeringControlPlaneProjection: MissionProjectionStore
  }
}

function validateSnapshot(snapshot: MissionProjectionSnapshot): void {
  if (snapshot.missionId.trim().length === 0) throw new TypeError('Mission projection id must not be empty')
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) {
    throw new TypeError('Mission projection revision must be a positive safe integer')
  }
  if (!Number.isSafeInteger(snapshot.attempt) || snapshot.attempt < 1) {
    throw new TypeError('Mission projection attempt must be a positive safe integer')
  }
  if (!Number.isSafeInteger(snapshot.evidenceCount) || snapshot.evidenceCount < 0) {
    throw new TypeError('Mission projection evidenceCount must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(snapshot.writeLease.fencingToken) || snapshot.writeLease.fencingToken < 0) {
    throw new TypeError('Mission projection fencing token must be a non-negative safe integer')
  }
}

function freezeSnapshot(snapshot: MissionProjectionSnapshot): MissionProjectionSnapshot {
  validateSnapshot(snapshot)
  const roleRuns = snapshot.roleRuns.map(run => Object.freeze({ ...run }))
  return Object.freeze({
    ...snapshot,
    writeLease: Object.freeze({ ...snapshot.writeLease }),
    roleRuns: Object.freeze(roleRuns),
  })
}

/** Revision-aware browser store that detects gaps and requires authoritative snapshot resynchronization. */
export class MissionProjectionStore extends Service {
  private readonly snapshots = new Map<string, MissionProjectionSnapshot>()
  private readonly listeners = new Set<MissionProjectionListener>()

  constructor(ctx: Context) {
    super(ctx, 'engineeringControlPlaneProjection')
  }

  get(missionId: string): MissionProjectionSnapshot | undefined {
    return this.snapshots.get(missionId)
  }

  /** Install an authoritative full snapshot after initial load or gap recovery. */
  installSnapshot(snapshot: MissionProjectionSnapshot): MissionProjectionSnapshot {
    const frozen = freezeSnapshot(snapshot)
    const current = this.snapshots.get(frozen.missionId)
    if (current !== undefined && frozen.revision < current.revision) return current
    this.snapshots.set(frozen.missionId, frozen)
    this.publish(frozen)
    return frozen
  }

  /** Apply only the next contiguous revision; stale events are ignored and gaps never guessed across. */
  applyEvent(event: MissionProjectionEvent): MissionProjectionApplyResult {
    if (event.missionId !== event.snapshot.missionId || event.revision !== event.snapshot.revision) {
      throw new TypeError('Mission projection event identity does not match its whole snapshot')
    }
    const current = this.snapshots.get(event.missionId)
    if (current === undefined) {
      return {
        kind: 'resync_required',
        missionId: event.missionId,
        expectedRevision: 1,
        receivedRevision: event.revision,
      }
    }
    if (event.revision <= current.revision) return { kind: 'stale', currentRevision: current.revision }
    if (event.revision !== current.revision + 1) {
      return {
        kind: 'resync_required',
        missionId: event.missionId,
        expectedRevision: current.revision + 1,
        receivedRevision: event.revision,
      }
    }
    const snapshot = freezeSnapshot(event.snapshot)
    this.snapshots.set(snapshot.missionId, snapshot)
    this.publish(snapshot)
    return { kind: 'applied', snapshot }
  }

  subscribe(listener: MissionProjectionListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(snapshot: MissionProjectionSnapshot): void {
    for (const listener of this.listeners) listener(snapshot)
  }
}

/** Install the browser-safe projection capability without importing any Node-only root code. */
export function apply(ctx: Context): void {
  new MissionProjectionStore(ctx)
}
