/**
 * Pure view models for the Mission tool cards. A model is a function of one
 * Harness tool-call block only — no Service access, clock, or storage — so a
 * live stream and a replayed session render the same card. Fields are read
 * defensively: truncated streams, error results, and unknown shapes degrade
 * to a plainer card instead of throwing.
 */
import type { MissionCardMessageKey } from './locales.js'

/** Tools whose calls render as Mission cards instead of the generic row. */
export const MISSION_TOOL_CARD_NAMES = Object.freeze([
  'mission_start',
  'mission_status',
  'mission_resume',
  'mission_rework',
  'mission_cancel',
] as const)

type MissionToolName = (typeof MISSION_TOOL_CARD_NAMES)[number]

export type ToolCardState = 'running' | 'ok' | 'error'
export type ToolCardTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/**
 * Display text: a localized key whose values may themselves be labels, a
 * canonical identifier shown verbatim, or labels joined by a separator.
 */
export type CardLabel =
  | CardText
  | { readonly literal: string }
  | { readonly join: readonly CardLabel[]; readonly separator?: string }

export interface CardText {
  readonly key: MissionCardMessageKey
  readonly values?: Readonly<Record<string, string | number | CardLabel>>
}

export interface CardChip {
  readonly label: CardLabel
  readonly tone: ToolCardTone
}

export interface CardField {
  readonly label: CardLabel
  readonly value: CardLabel
}

export interface ToolCardModel {
  readonly title: CardText
  readonly state: ToolCardState
  readonly summary: readonly CardLabel[]
  readonly chips: readonly CardChip[]
  readonly fields: readonly CardField[]
  readonly errorText: string | null
  readonly rawInput: string
  readonly rawOutput: string | null
}

type Json = Readonly<Record<string, unknown>>
type Body = Pick<ToolCardModel, 'summary' | 'chips' | 'fields'>

interface ToolCallFacts {
  readonly state: ToolCardState
  readonly argsRaw: string
  readonly args: Json
  readonly outputText: string | null
  readonly output: Json
}

const EMPTY: Json = Object.freeze({})
const NONE: Body = Object.freeze({ summary: [], chips: [], fields: [] })

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : EMPTY
}

function parseRecord(raw: string | null): Json {
  if (raw === null) return EMPTY
  try {
    return record(JSON.parse(raw))
  } catch {
    return EMPTY
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

/** Normalize a running call or a settled result node (same shape in every supported Harness). */
function readToolCall(block: unknown): ToolCallFacts {
  const node = record(block)
  const settled = node['kind'] === 'tool-result'
  const head = settled ? record(node['call']) : node
  const argsRaw = typeof head['argsRaw'] === 'string' ? head['argsRaw'] : ''
  const args = parseRecord(argsRaw)
  if (!settled) return { state: 'running', argsRaw, args, outputText: null, output: EMPTY }
  const outputText = list(node['content'])
    .map(record)
    .filter(item => item['type'] === 'text' && typeof item['text'] === 'string')
    .map(item => item['text'] as string)
    .join('\n')
  const isError = node['isError'] === true
  return {
    state: isError ? 'error' : 'ok',
    argsRaw,
    args,
    outputText,
    output: isError ? EMPTY : parseRecord(outputText),
  }
}

function literal(value: string): CardLabel {
  return { literal: value }
}

function msg(key: MissionCardMessageKey, values?: CardText['values']): CardText {
  return values === undefined ? { key } : { key, values }
}

/** `mission-4f3a9c21-…` → `mission-4f3a9c21`: enough to tell records apart in one line. */
function shortId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return /^([a-z]+-[0-9a-f]{8})-/u.exec(value)?.[1] ?? value
}

/** Map a closed enum value onto its message key and tone, ignoring unknown values. */
function lookup<V extends string, K extends MissionCardMessageKey>(
  value: unknown,
  table: Readonly<Record<V, readonly [K, ToolCardTone]>>,
): readonly [K, ToolCardTone] | undefined {
  return typeof value === 'string' && Object.hasOwn(table, value) ? table[value as V] : undefined
}

const STATUS = {
  CREATED: ['status.CREATED', 'info'],
  ANALYZING: ['status.ANALYZING', 'info'],
  PLANNING: ['status.PLANNING', 'info'],
  IMPLEMENTING: ['status.IMPLEMENTING', 'info'],
  VERIFYING: ['status.VERIFYING', 'info'],
  REVIEWING: ['status.REVIEWING', 'info'],
  APPROVED: ['status.APPROVED', 'success'],
  REWORK_REQUIRED: ['status.REWORK_REQUIRED', 'warning'],
  BLOCKED: ['status.BLOCKED', 'warning'],
  CANCELLED: ['status.CANCELLED', 'neutral'],
} as const
const GATE = {
  approved: ['gate.approved', 'success'],
  rework_required: ['gate.rework_required', 'warning'],
  blocked: ['gate.blocked', 'danger'],
} as const
const BLOCKED = {
  needs_input: ['blocked.needs_input', 'warning'],
  host_restarted: ['blocked.host_restarted', 'warning'],
  assurance_execution_unavailable: ['blocked.assurance_execution_unavailable', 'warning'],
  provider_failure: ['blocked.provider_failure', 'warning'],
  command_timeout: ['blocked.command_timeout', 'warning'],
  evidence_incomplete: ['blocked.evidence_incomplete', 'warning'],
  policy_violation: ['blocked.policy_violation', 'danger'],
} as const
const ROLE = {
  planner: ['role.planner', 'neutral'],
  developer: ['role.developer', 'neutral'],
  tester: ['role.tester', 'neutral'],
  reviewer: ['role.reviewer', 'neutral'],
} as const
const RUN = {
  starting: ['run.starting', 'info'],
  running: ['run.running', 'info'],
  completed: ['run.completed', 'success'],
  failed: ['run.failed', 'danger'],
  aborted: ['run.aborted', 'neutral'],
} as const
const OUTCOME = {
  satisfied: ['outcome.satisfied', 'success'],
  failed: ['outcome.failed', 'danger'],
  indeterminate: ['outcome.indeterminate', 'warning'],
} as const
const ACTION = {
  mission_status: ['action.mission_status', 'neutral'],
  mission_resume: ['action.mission_resume', 'neutral'],
  mission_cancel: ['action.mission_cancel', 'neutral'],
  mission_rework: ['action.mission_rework', 'neutral'],
} as const

type Table = Parameters<typeof lookup>[1]

function chip(value: unknown, table: Table): CardChip[] {
  const entry = lookup(value, table)
  return entry === undefined ? [] : [{ label: msg(entry[0]), tone: entry[1] }]
}

function label(value: unknown, table: Table): CardLabel[] {
  const entry = lookup(value, table)
  return entry === undefined ? [] : [msg(entry[0])]
}

function missionAndRevision(output: Json): CardLabel[] {
  const id = shortId(text(output['missionId']))
  const revision = count(output['revision'])
  return [
    ...id === undefined ? [] : [literal(id)],
    ...revision === undefined ? [] : [msg('summary.revision', { revision })],
  ]
}

function start({ state, args, output }: ToolCallFacts): Body {
  const objective = text(args['objective'])
  const accepted = shortId(text(output['missionId']))
  return {
    summary: [
      ...objective === undefined ? [] : [literal(objective)],
      ...accepted === undefined ? [] : [msg('summary.accepted', { id: accepted })],
    ],
    chips: state === 'ok' ? chip(output['status'], STATUS) : [],
    fields: [],
  }
}

function status({ state, args, output }: ToolCallFacts): Body {
  if (state !== 'ok') {
    const id = shortId(text(args['missionId']))
    return { summary: id === undefined ? [] : [literal(id)], chips: [], fields: [] }
  }
  const repository = record(output['repository'])
  const branch = text(repository['branch'])
  const head = text(repository['head'])
  const attempt = count(output['attempt'])
  const id = text(output['missionId'])
  const revision = count(output['revision'])
  const roles = list(output['roleRuns']).map(record).flatMap((run) => {
    const parts = [...label(run['role'], ROLE), ...label(run['state'], RUN)]
    return parts.length === 2 ? [{ join: parts }] : []
  })
  const assurance = list(output['assuranceResults']).map(record).flatMap((result) => {
    const requirement = text(result['requirementId'])
    const outcome = label(result['outcome'], OUTCOME)
    // The Provider's own assessments (ADR 0095), looked up with that Provider's tools.
    const external = list(result['externalAssessmentIds']).flatMap(id => {
      const value = text(id)
      return value === undefined ? [] : [literal(value)]
    })
    return requirement === undefined || outcome.length === 0
      ? []
      : [{ join: [literal(requirement), ...outcome, ...external] }]
  })
  const actions = list(output['legalNextActions']).flatMap(action => label(action, ACTION))
  return {
    summary: [
      ...branch === undefined ? [] : [literal(branch)],
      ...attempt === undefined ? [] : [msg('summary.attempt', { attempt })],
    ],
    chips: [
      ...chip(output['status'], STATUS),
      ...chip(record(output['gate'])['kind'], GATE),
      ...chip(record(output['blocked'])['code'], BLOCKED),
    ],
    fields: [
      ...id === undefined ? [] : [{ label: msg('field.mission'), value: literal(id) }],
      ...revision === undefined ? [] : [{ label: msg('field.revision'), value: literal(String(revision)) }],
      ...branch === undefined
        ? []
        : [{
            label: msg('field.branch'),
            value: literal(head === undefined ? branch : `${branch} @ ${head.slice(0, 8)}`),
          }],
      ...roles.length === 0 ? [] : [{ label: msg('field.roles'), value: { join: roles, separator: ' / ' } }],
      ...assurance.length === 0 ? [] : [{ label: msg('field.assurance'), value: { join: assurance, separator: ' / ' } }],
      ...actions.length === 0 ? [] : [{ label: msg('field.actions'), value: { join: actions } }],
    ],
  }
}

function receipt({ state, args, output }: ToolCallFacts): Body {
  if (state !== 'ok') {
    const id = shortId(text(args['missionId']))
    return { summary: id === undefined ? [] : [literal(id)], chips: [], fields: [] }
  }
  return { summary: missionAndRevision(output), chips: chip(output['status'], STATUS), fields: [] }
}

const CARDS: Readonly<Record<MissionToolName, readonly [MissionCardMessageKey, (facts: ToolCallFacts) => Body]>> = {
  mission_start: ['title.start', start],
  mission_status: ['title.status', status],
  mission_resume: ['title.resume', receipt],
  mission_rework: ['title.rework', receipt],
  mission_cancel: ['title.cancel', receipt],
}

/** Build the card model for one Mission tool call block. */
export function missionToolCard(toolName: MissionToolName | string, block: unknown): ToolCardModel {
  const facts = readToolCall(block)
  const card = Object.hasOwn(CARDS, toolName) ? CARDS[toolName as MissionToolName] : undefined
  const body = card === undefined ? NONE : card[1](facts)
  return {
    title: msg(card?.[0] ?? 'title.status'),
    state: facts.state,
    summary: body.summary,
    chips: facts.state === 'error' ? [] : body.chips,
    fields: body.fields,
    errorText: facts.state === 'error' ? (facts.outputText ?? '').split('\n')[0] ?? '' : null,
    rawInput: facts.argsRaw,
    rawOutput: facts.outputText,
  }
}
