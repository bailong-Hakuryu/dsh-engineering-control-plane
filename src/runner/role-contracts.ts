import type { RoleName } from '../kernel/types.js'

export interface PlannerOutput {
  readonly schemaVersion: 1
  readonly outcome: 'planned' | 'needs_input'
  readonly summary: string
  readonly steps: readonly {
    readonly id: string
    readonly objective: string
    readonly acceptanceSignals: readonly string[]
  }[]
  readonly risks: readonly string[]
  readonly verificationFocus: readonly string[]
  readonly question?: string
}

export interface DeveloperOutput {
  readonly schemaVersion: 1
  readonly outcome: 'implemented' | 'needs_input'
  readonly summary: string
  readonly changedAreas: readonly string[]
  readonly notes: readonly string[]
  readonly question?: string
}

export interface RoleFinding {
  readonly code: string
  readonly severity: 'blocking' | 'non_blocking'
  readonly evidence?: string
}

export interface AssessmentOutput {
  readonly schemaVersion: 1
  readonly outcome: 'assessed' | 'reviewed' | 'needs_input'
  readonly summary: string
  readonly findings: readonly RoleFinding[]
  readonly question?: string
}

export type RoleOutput = PlannerOutput | DeveloperOutput | AssessmentOutput

const stringSchema = { type: 'string' } as const
const stringArraySchema = { type: 'array', items: stringSchema } as const
const findingSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: stringSchema,
    severity: { type: 'string', enum: ['blocking', 'non_blocking'] },
    evidence: stringSchema,
  },
  required: ['code', 'severity'],
} as const

/** Strict Harness-compatible object schemas; no role can author an approval field. */
export const ROLE_OUTPUT_SCHEMAS: Readonly<Record<RoleName, Readonly<Record<string, unknown>>>> = {
  planner: {
    type: 'object',
    additionalProperties: false,
    properties: {
      schemaVersion: { type: 'integer', const: 1 },
      outcome: { type: 'string', enum: ['planned', 'needs_input'] },
      summary: stringSchema,
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: stringSchema,
            objective: stringSchema,
            acceptanceSignals: stringArraySchema,
          },
          required: ['id', 'objective', 'acceptanceSignals'],
        },
      },
      risks: stringArraySchema,
      verificationFocus: stringArraySchema,
      question: stringSchema,
    },
    required: ['schemaVersion', 'outcome', 'summary', 'steps', 'risks', 'verificationFocus'],
  },
  developer: {
    type: 'object',
    additionalProperties: false,
    properties: {
      schemaVersion: { type: 'integer', const: 1 },
      outcome: { type: 'string', enum: ['implemented', 'needs_input'] },
      summary: stringSchema,
      changedAreas: stringArraySchema,
      notes: stringArraySchema,
      question: stringSchema,
    },
    required: ['schemaVersion', 'outcome', 'summary', 'changedAreas', 'notes'],
  },
  tester: {
    type: 'object',
    additionalProperties: false,
    properties: {
      schemaVersion: { type: 'integer', const: 1 },
      outcome: { type: 'string', enum: ['assessed', 'needs_input'] },
      summary: stringSchema,
      findings: { type: 'array', items: findingSchema },
      question: stringSchema,
    },
    required: ['schemaVersion', 'outcome', 'summary', 'findings'],
  },
  reviewer: {
    type: 'object',
    additionalProperties: false,
    properties: {
      schemaVersion: { type: 'integer', const: 1 },
      outcome: { type: 'string', enum: ['reviewed', 'needs_input'] },
      summary: stringSchema,
      findings: { type: 'array', items: findingSchema },
      question: stringSchema,
    },
    required: ['schemaVersion', 'outcome', 'summary', 'findings'],
  },
}

const ROLE_KEYS: Readonly<Record<RoleName, readonly string[]>> = {
  planner: ['outcome', 'question', 'risks', 'schemaVersion', 'steps', 'summary', 'verificationFocus'],
  developer: ['changedAreas', 'notes', 'outcome', 'question', 'schemaVersion', 'summary'],
  tester: ['findings', 'outcome', 'question', 'schemaVersion', 'summary'],
  reviewer: ['findings', 'outcome', 'question', 'schemaVersion', 'summary'],
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).find(key => !allowedSet.has(key))
  if (unknown !== undefined) throw new Error(`role output contains unknown field '${unknown}'`)
  const missing = required.find(key => !Object.hasOwn(value, key))
  if (missing !== undefined) throw new Error(`role output is missing '${missing}'`)
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function optionalQuestion(value: Record<string, unknown>, needsInput: boolean): string | undefined {
  const question = value.question
  if (question === undefined) {
    if (needsInput) throw new Error('needs_input role output requires question')
    return undefined
  }
  return nonemptyString(question, 'question')
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((item, index) => nonemptyString(item, `${label}[${index}]`))
}

function findings(value: unknown): readonly RoleFinding[] {
  if (!Array.isArray(value)) throw new Error('findings must be an array')
  return value.map((item, index) => {
    const row = object(item, `findings[${index}]`)
    exactKeys(row, ['code', 'evidence', 'severity'], ['code', 'severity'])
    const severity = row.severity
    if (severity !== 'blocking' && severity !== 'non_blocking') throw new Error(`findings[${index}].severity is invalid`)
    return {
      code: nonemptyString(row.code, `findings[${index}].code`),
      severity,
      ...row.evidence === undefined ? {} : { evidence: nonemptyString(row.evidence, `findings[${index}].evidence`) },
    }
  })
}

/** Validate even provider-validated structured output at the Kernel Adapter boundary. */
export function validateRoleOutput(role: RoleName, candidate: unknown): RoleOutput {
  const value = object(candidate, `${role} output`)
  if (value.schemaVersion !== 1) throw new Error(`${role} output schemaVersion must be 1`)
  if (role === 'planner') {
    exactKeys(value, ROLE_KEYS.planner, ['schemaVersion', 'outcome', 'summary', 'steps', 'risks', 'verificationFocus'])
    if (value.outcome !== 'planned' && value.outcome !== 'needs_input') throw new Error('planner outcome is invalid')
    if (!Array.isArray(value.steps)) throw new Error('planner steps must be an array')
    const steps = value.steps.map((item, index) => {
      const step = object(item, `steps[${index}]`)
      exactKeys(step, ['acceptanceSignals', 'id', 'objective'], ['acceptanceSignals', 'id', 'objective'])
      return {
        id: nonemptyString(step.id, `steps[${index}].id`),
        objective: nonemptyString(step.objective, `steps[${index}].objective`),
        acceptanceSignals: stringArray(step.acceptanceSignals, `steps[${index}].acceptanceSignals`),
      }
    })
    if (value.outcome === 'planned' && steps.length === 0) throw new Error('planned output requires at least one step')
    const question = optionalQuestion(value, value.outcome === 'needs_input')
    return {
      schemaVersion: 1,
      outcome: value.outcome,
      summary: nonemptyString(value.summary, 'summary'),
      steps,
      risks: stringArray(value.risks, 'risks'),
      verificationFocus: stringArray(value.verificationFocus, 'verificationFocus'),
      ...question === undefined ? {} : { question },
    }
  }
  if (role === 'developer') {
    exactKeys(value, ROLE_KEYS.developer, ['schemaVersion', 'outcome', 'summary', 'changedAreas', 'notes'])
    if (value.outcome !== 'implemented' && value.outcome !== 'needs_input') throw new Error('developer outcome is invalid')
    const question = optionalQuestion(value, value.outcome === 'needs_input')
    return {
      schemaVersion: 1,
      outcome: value.outcome,
      summary: nonemptyString(value.summary, 'summary'),
      changedAreas: stringArray(value.changedAreas, 'changedAreas'),
      notes: stringArray(value.notes, 'notes'),
      ...question === undefined ? {} : { question },
    }
  }
  exactKeys(value, ROLE_KEYS[role], ['schemaVersion', 'outcome', 'summary', 'findings'])
  const expected = role === 'tester' ? 'assessed' : 'reviewed'
  if (value.outcome !== expected && value.outcome !== 'needs_input') throw new Error(`${role} outcome is invalid`)
  const outcome = value.outcome as 'assessed' | 'reviewed' | 'needs_input'
  const question = optionalQuestion(value, value.outcome === 'needs_input')
  return {
    schemaVersion: 1,
    outcome,
    summary: nonemptyString(value.summary, 'summary'),
    findings: findings(value.findings),
    ...question === undefined ? {} : { question },
  }
}
