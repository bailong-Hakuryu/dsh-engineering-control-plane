import type { MissionPhase, MissionStatus } from './types.js'

const NEXT_PHASE: Readonly<Record<MissionPhase, MissionPhase | undefined>> = {
  CREATED: 'ANALYZING',
  ANALYZING: 'PLANNING',
  PLANNING: 'IMPLEMENTING',
  IMPLEMENTING: 'VERIFYING',
  VERIFYING: 'REVIEWING',
  REVIEWING: undefined,
}

/**
 * Test whether a Runner phase transition is the single ordered next step.
 * @param from - current Mission status.
 * @param to - requested phase.
 * @returns true only for the next legal phase.
 */
export function mayAdvance(from: MissionStatus, to: MissionPhase): boolean {
  return from in NEXT_PHASE && NEXT_PHASE[from as MissionPhase] === to
}

/**
 * Test whether a status is an interruptible Runner phase.
 * @param status - Mission status to classify.
 * @returns true for an ordered active phase.
 */
export function isMissionPhase(status: MissionStatus): status is MissionPhase {
  return status in NEXT_PHASE
}
