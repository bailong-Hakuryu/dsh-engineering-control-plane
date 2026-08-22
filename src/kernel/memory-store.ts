import type { MissionId, MissionSnapshot } from './types.js'

/** Result of the atomic Start persistence operation. */
export type StartAcceptance =
  | { readonly kind: 'accepted' | 'replayed'; readonly snapshot: MissionSnapshot }
  | { readonly kind: 'repository_busy'; readonly snapshot: MissionSnapshot }

/** Result of one expected-revision Mission update. */
export type MissionUpdate =
  | { readonly kind: 'updated'; readonly snapshot: MissionSnapshot }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'revision_conflict'; readonly snapshot: MissionSnapshot }

/** Minimal Mission persistence seam exercised by the Kernel. */
export interface MissionStore {
  /**
   * Atomically accept or replay one Start invocation.
   * @param idempotencyKey - host tool-call identity.
   * @param canonicalRoot - repository uniqueness key.
   * @param createSnapshot - invoked only when the key and repository are available.
   * @returns the accepted, replayed, or conflicting Mission.
   */
  acceptStart(
    idempotencyKey: string,
    canonicalRoot: string,
    createSnapshot: () => MissionSnapshot,
  ): Promise<StartAcceptance>

  /**
   * Read one Mission revision.
   * @param missionId - Mission to read.
   * @returns the snapshot when present.
   */
  get(missionId: MissionId | string): Promise<MissionSnapshot | undefined>

  /** Enumerate durable non-terminal Missions for explicit startup recovery. */
  listNonTerminal(): Promise<readonly MissionSnapshot[]>

  /**
   * Atomically update one Mission when its revision matches.
   * @param missionId - Mission to update.
   * @param expectedRevision - caller-observed revision.
   * @param update - pure replacement function invoked only after the match.
   * @returns update, not-found, or conflict facts.
   */
  update(
    missionId: MissionId,
    expectedRevision: number,
    update: (current: MissionSnapshot) => MissionSnapshot,
  ): Promise<MissionUpdate>
}

class InMemoryMissionStore implements MissionStore {
  private readonly missions = new Map<string, MissionSnapshot>()
  private readonly starts = new Map<string, MissionId>()

  acceptStart(
    idempotencyKey: string,
    canonicalRoot: string,
    createSnapshot: () => MissionSnapshot,
  ): Promise<StartAcceptance> {
    const acceptedId = this.starts.get(idempotencyKey)
    if (acceptedId !== undefined) {
      return Promise.resolve({ kind: 'replayed', snapshot: this.missions.get(acceptedId)! })
    }

    const active = [...this.missions.values()].find(snapshot =>
      snapshot.repository.canonicalRoot === canonicalRoot
      && snapshot.status !== 'APPROVED'
      && snapshot.status !== 'CANCELLED')
    if (active !== undefined) return Promise.resolve({ kind: 'repository_busy', snapshot: active })

    const snapshot = createSnapshot()
    this.missions.set(snapshot.missionId, snapshot)
    this.starts.set(idempotencyKey, snapshot.missionId)
    return Promise.resolve({ kind: 'accepted', snapshot })
  }

  get(missionId: MissionId | string): Promise<MissionSnapshot | undefined> {
    return Promise.resolve(this.missions.get(missionId))
  }

  listNonTerminal(): Promise<readonly MissionSnapshot[]> {
    return Promise.resolve([...this.missions.values()]
      .filter(snapshot => snapshot.status !== 'APPROVED' && snapshot.status !== 'CANCELLED')
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)
        || left.missionId.localeCompare(right.missionId)))
  }

  update(
    missionId: MissionId,
    expectedRevision: number,
    update: (current: MissionSnapshot) => MissionSnapshot,
  ): Promise<MissionUpdate> {
    const current = this.missions.get(missionId)
    if (current === undefined) return Promise.resolve({ kind: 'not_found' })
    if (current.revision !== expectedRevision) {
      return Promise.resolve({ kind: 'revision_conflict', snapshot: current })
    }
    const next = update(current)
    this.missions.set(missionId, next)
    return Promise.resolve({ kind: 'updated', snapshot: next })
  }
}

/**
 * Create the deterministic in-memory MissionStore Adapter used by Kernel tests.
 * @returns an empty MissionStore.
 */
export function createInMemoryMissionStore(): MissionStore {
  return new InMemoryMissionStore()
}
