import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  defineTool,
  ToolArgsError,
  type ToolDefinition,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import type {
  MissionReceipt,
  MissionSnapshot,
  MissionStatus,
} from './kernel/index.js'
import type {} from './index.js'

export const name = 'engineering-control-plane-tools'
export const inject = ['tools', 'engineeringControlPlane']

const MISSION_STATUSES = [
  'CREATED',
  'ANALYZING',
  'PLANNING',
  'IMPLEMENTING',
  'VERIFYING',
  'REVIEWING',
  'APPROVED',
  'REWORK_REQUIRED',
  'BLOCKED',
  'CANCELLED',
] as const satisfies readonly MissionStatus[]

const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    missionId: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    status: { type: 'string', required: true, enum: MISSION_STATUSES },
    attempt: { type: 'integer', required: true },
    acceptedAt: { type: 'string', required: true },
  },
} as const

const STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    missionId: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    status: { type: 'string', required: true, enum: MISSION_STATUSES },
    attempt: { type: 'integer', required: true },
    effectivePolicyDigest: { type: 'string', required: true },
    repository: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        canonicalRoot: { type: 'string', required: true },
        branch: { type: 'string', required: true },
        head: { type: 'string', required: true },
      },
    },
    writeLease: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        fencingToken: { type: 'integer', required: true },
        active: { type: 'boolean', required: true },
      },
    },
    blocked: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: {
              type: 'string',
              required: true,
              enum: [
                'needs_input',
                'host_restarted',
                'assurance_execution_unavailable',
                'provider_failure',
                'command_timeout',
                'evidence_incomplete',
                'policy_violation',
              ],
            },
            detail: { type: 'string' },
            resumeStatus: {
              type: 'string',
              required: true,
              enum: ['CREATED', 'ANALYZING', 'PLANNING', 'IMPLEMENTING', 'VERIFYING', 'REVIEWING'],
            },
            blockedAt: { type: 'string', required: true },
            workspaceFingerprint: { type: 'string' },
          },
        },
      ],
      required: true,
    },
    gate: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: ['approved', 'rework_required', 'blocked'] },
            reasons: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  code: { type: 'string', required: true },
                  source: { type: 'string', required: true },
                },
              },
            },
          },
        },
      ],
      required: true,
    },
    assuranceResults: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requirementId: { type: 'string', required: true },
          attempt: { type: 'integer', required: true },
          outcome: {
            type: 'string',
            required: true,
            enum: ['satisfied', 'failed', 'indeterminate'],
          },
          assessmentIds: { type: 'array', required: true, items: { type: 'string' } },
          reasonCodes: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
    },
    roleRuns: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runId: { type: 'string', required: true },
          attempt: { type: 'integer', required: true },
          role: { type: 'string', required: true, enum: ['planner', 'developer', 'tester', 'reviewer'] },
          state: { type: 'string', required: true, enum: ['starting', 'running', 'completed', 'failed', 'aborted'] },
          provider: { type: 'string' },
          providerRunId: { type: 'string' },
          sessionId: { type: 'string' },
          stopReason: { type: 'string' },
          evidenceRecordIds: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
    },
    evidence: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          recordId: { type: 'string', required: true },
          attempt: { type: 'integer', required: true },
          kind: { type: 'string', required: true },
          digest: { type: 'string', required: true },
          byteLength: { type: 'integer', required: true },
          relativePath: { type: 'string', required: true },
          redacted: { type: 'boolean', required: true },
          createdAt: { type: 'string', required: true },
        },
      },
    },
    roleRunsTruncated: { type: 'boolean', required: true },
    evidenceTruncated: { type: 'boolean', required: true },
    assuranceResultsTruncated: { type: 'boolean', required: true },
    legalNextActions: {
      type: 'array',
      required: true,
      items: {
        type: 'string',
        enum: ['mission_status', 'mission_resume', 'mission_cancel', 'mission_rework'],
      },
    },
  },
} as const

type ReceiptValue = {
  missionId: string
  revision: number
  status: MissionStatus
  attempt: number
  acceptedAt: string
}

type StatusValue = {
  missionId: string
  revision: number
  status: MissionStatus
  attempt: number
  effectivePolicyDigest: string
  repository: { canonicalRoot: string; branch: string; head: string }
  writeLease: { fencingToken: number; active: boolean }
  blocked: null | {
    code: NonNullable<MissionSnapshot['blocked']>['reason']['code']
    detail?: string
    resumeStatus: NonNullable<MissionSnapshot['blocked']>['resumeStatus']
    blockedAt: string
    workspaceFingerprint?: string
  }
  gate: null | {
    kind: 'approved' | 'rework_required' | 'blocked'
    reasons: { code: string; source: string }[]
  }
  assuranceResults: {
    requirementId: string
    attempt: number
    outcome: 'satisfied' | 'failed' | 'indeterminate'
    assessmentIds: string[]
    reasonCodes: string[]
  }[]
  roleRuns: {
    runId: string
    attempt: number
    role: 'planner' | 'developer' | 'tester' | 'reviewer'
    state: 'starting' | 'running' | 'completed' | 'failed' | 'aborted'
    provider?: string
    providerRunId?: string
    sessionId?: string
    stopReason?: string
    evidenceRecordIds: string[]
  }[]
  evidence: {
    recordId: string
    attempt: number
    kind: string
    digest: string
    byteLength: number
    relativePath: string
    redacted: boolean
    createdAt: string
  }[]
  roleRunsTruncated: boolean
  evidenceTruncated: boolean
  assuranceResultsTruncated: boolean
  legalNextActions: ('mission_status' | 'mission_resume' | 'mission_cancel' | 'mission_rework')[]
}

const MAX_STATUS_ROLE_RUNS = 64
const MAX_STATUS_EVIDENCE = 128
const MAX_STATUS_ASSURANCE_RESULTS = 64
const MAX_STATUS_TEXT = 4_096

function requireAgent(exec: ToolRunContext, toolName: string): Agent {
  if (exec.agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return exec.agent
}

/** Close defineTool's intentionally open parameter root for this authority-sensitive surface. */
function strictTool(definition: ToolDefinition): ToolDefinition {
  const parameters = definition.parameters as {
    readonly properties?: Readonly<Record<string, unknown>>
    readonly [key: string]: unknown
  }
  const allowed = new Set(Object.keys(parameters.properties ?? {}))
  const execute = definition.execute.bind(definition)
  return {
    ...definition,
    parameters: { ...parameters, additionalProperties: false },
    async execute(args, exec) {
      if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
        const unknown = Object.keys(args).filter(key => !allowed.has(key))
        if (unknown.length > 0) {
          throw new ToolArgsError(unknown.map(key => `.${key} is not allowed`))
        }
      }
      return execute(args, exec)
    },
  }
}

function boundedText(value: string): string {
  return value.length <= MAX_STATUS_TEXT ? value : `${value.slice(0, MAX_STATUS_TEXT)}…`
}

function receiptValue(receipt: MissionReceipt): ReceiptValue {
  return {
    missionId: receipt.missionId,
    revision: receipt.revision,
    status: receipt.status,
    attempt: receipt.attempt,
    acceptedAt: receipt.acceptedAt,
  }
}

function legalNextActions(snapshot: MissionSnapshot): StatusValue['legalNextActions'] {
  const hasSelectedAssuranceProviders = (snapshot.assuranceProviderSelections
    ?.find(selection => selection.attempt === snapshot.attempt)
    ?.providers.length ?? 0) > 0
  if (snapshot.status === 'BLOCKED') {
    if (
      snapshot.blocked?.reason.code === 'assurance_execution_unavailable'
      || hasSelectedAssuranceProviders
    ) {
      return ['mission_status', 'mission_cancel']
    }
    return ['mission_status', 'mission_resume', 'mission_cancel']
  }
  if (snapshot.status === 'REWORK_REQUIRED') {
    return ['mission_status', 'mission_rework', 'mission_cancel']
  }
  if (snapshot.status === 'APPROVED' || snapshot.status === 'CANCELLED') return ['mission_status']
  return ['mission_status', 'mission_cancel']
}

/** Produce the intentionally bounded model projection; durable truth remains in the Kernel. */
export function statusValue(snapshot: MissionSnapshot): StatusValue {
  const selectedRoleRuns = snapshot.roleRuns.slice(-MAX_STATUS_ROLE_RUNS)
  const selectedEvidence = snapshot.evidence.records.slice(-MAX_STATUS_EVIDENCE)
  const selectedAssuranceResults = (snapshot.assuranceResults ?? [])
    .slice(-MAX_STATUS_ASSURANCE_RESULTS)
  return {
    missionId: snapshot.missionId,
    revision: snapshot.revision,
    status: snapshot.status,
    attempt: snapshot.attempt,
    effectivePolicyDigest: snapshot.effectivePolicyDigest,
    repository: {
      canonicalRoot: boundedText(snapshot.repository.canonicalRoot),
      branch: boundedText(snapshot.repository.branch),
      head: snapshot.repository.head,
    },
    writeLease: {
      fencingToken: snapshot.writeLease.fencingToken,
      active: snapshot.writeLease.holderId !== undefined,
    },
    blocked: snapshot.blocked === undefined
      ? null
      : {
          code: snapshot.blocked.reason.code,
          ...snapshot.blocked.reason.detail === undefined
            ? {}
            : { detail: boundedText(snapshot.blocked.reason.detail) },
          resumeStatus: snapshot.blocked.resumeStatus,
          blockedAt: snapshot.blocked.blockedAt,
          ...snapshot.blocked.workspaceFingerprint === undefined
            ? {}
            : { workspaceFingerprint: snapshot.blocked.workspaceFingerprint },
        },
    gate: snapshot.gate === undefined
      ? null
      : {
          kind: snapshot.gate.kind,
          reasons: snapshot.gate.reasons.slice(0, 32).map(reason => ({
            code: boundedText(reason.code),
            source: boundedText(reason.source),
          })),
        },
    assuranceResults: selectedAssuranceResults.map(result => ({
      requirementId: boundedText(result.requirementId),
      attempt: result.attempt,
      outcome: result.outcome,
      assessmentIds: result.assessmentIds.slice(0, 32),
      reasonCodes: result.reasonCodes.slice(0, 32).map(boundedText),
    })),
    roleRuns: selectedRoleRuns.map(run => ({
      runId: run.runId,
      attempt: run.attempt,
      role: run.role,
      state: run.state,
      ...run.trace === undefined
        ? {}
        : {
            provider: boundedText(run.trace.provider),
            providerRunId: boundedText(run.trace.providerRunId),
            ...run.trace.sessionId === undefined ? {} : { sessionId: boundedText(run.trace.sessionId) },
          },
      ...run.stopReason === undefined ? {} : { stopReason: boundedText(run.stopReason) },
      evidenceRecordIds: run.evidenceRecordIds.slice(0, 32),
    })),
    evidence: selectedEvidence.map(record => ({
      recordId: record.recordId,
      attempt: record.attempt,
      kind: boundedText(record.kind),
      digest: record.digest,
      byteLength: record.byteLength,
      relativePath: boundedText(record.relativePath),
      redacted: record.redacted,
      createdAt: record.createdAt,
    })),
    roleRunsTruncated: snapshot.roleRuns.length > selectedRoleRuns.length,
    evidenceTruncated: snapshot.evidence.records.length > selectedEvidence.length,
    assuranceResultsTruncated: (snapshot.assuranceResults?.length ?? 0) > selectedAssuranceResults.length,
    legalNextActions: legalNextActions(snapshot),
  }
}

const RECEIPT_OUTPUT = {
  schema: RECEIPT_SCHEMA,
  render: (_args: unknown, value: ReceiptValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

const STATUS_OUTPUT = {
  schema: STATUS_SCHEMA,
  render: (_args: unknown, value: StatusValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

/** Register the five explicit Mission controls over the root Service Capability. */
export function apply(ctx: Context): void {
  ctx.tools.register(strictTool(defineTool({
    name: 'mission_start',
    description:
      'Atomically start one evidence-backed engineering Mission in the calling Agent Session cwd. '
      + 'The host selects repository identity, subagents, models, tools and verification policy. '
      + 'Do not call when a Mission is already non-terminal for this worktree.',
    parameters: {
      objective: { type: 'string', required: true, description: 'Concrete engineering outcome to deliver.' },
      context: { type: 'string', description: 'Optional bounded context not already captured by the objective.' },
      acceptanceCriteria: {
        type: 'array',
        items: { type: 'string' },
        description: 'Observable acceptance criteria.',
      },
      constraints: {
        type: 'array',
        items: { type: 'string' },
        description: 'Explicit implementation or safety constraints.',
      },
    },
    output: RECEIPT_OUTPUT,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'mission_start')
      return receiptValue(await ctx.engineeringControlPlane.start(agent, {
        idempotencyKey: `${String(agent.id)}:${String(exec.callId)}`,
        objective: args.objective,
        ...args.context === undefined ? {} : { context: args.context },
        ...args.acceptanceCriteria === undefined ? {} : { acceptanceCriteria: args.acceptanceCriteria },
        ...args.constraints === undefined ? {} : { constraints: args.constraints },
      }, exec.signal))
    },
  })))

  ctx.tools.register(strictTool(defineTool({
    name: 'mission_status',
    description:
      'Read the bounded authoritative snapshot of one Mission. Use its exact revision for any subsequent mutation.',
    parameters: {
      missionId: { type: 'string', required: true, description: 'Exact Mission id returned by mission_start.' },
    },
    output: STATUS_OUTPUT,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'mission_status')
      return statusValue(await ctx.engineeringControlPlane.status(agent, args.missionId, exec.signal))
    },
  })))

  ctx.tools.register(strictTool(defineTool({
    name: 'mission_resume',
    description:
      'Resume an exact BLOCKED Mission revision in the same Attempt. It never starts quality rework and never retries a stale revision.',
    parameters: {
      missionId: { type: 'string', required: true },
      expectedRevision: { type: 'integer', required: true },
      supplementalContext: { type: 'string', description: 'New information addressing the recorded blocker.' },
    },
    output: RECEIPT_OUTPUT,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'mission_resume')
      return receiptValue(await ctx.engineeringControlPlane.resume(agent, {
        missionId: args.missionId,
        expectedRevision: args.expectedRevision,
        ...args.supplementalContext === undefined ? {} : { supplementalContext: args.supplementalContext },
      }, exec.signal))
    },
  })))

  ctx.tools.register(strictTool(defineTool({
    name: 'mission_cancel',
    description:
      'Quiesce execution and terminally cancel an exact non-terminal Mission revision. Files and audit Evidence are preserved.',
    parameters: {
      missionId: { type: 'string', required: true },
      expectedRevision: { type: 'integer', required: true },
      reason: { type: 'string', description: 'Optional human-readable cancellation reason.' },
    },
    output: RECEIPT_OUTPUT,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'mission_cancel')
      return receiptValue(await ctx.engineeringControlPlane.cancel(agent, {
        missionId: args.missionId,
        expectedRevision: args.expectedRevision,
        ...args.reason === undefined ? {} : { reason: args.reason },
      }, exec.signal))
    },
  })))

  ctx.tools.register(strictTool(defineTool({
    name: 'mission_rework',
    description:
      'Start a new incremental Attempt from an exact REWORK_REQUIRED revision. Only the Kernel Gate can create that state.',
    parameters: {
      missionId: { type: 'string', required: true },
      expectedRevision: { type: 'integer', required: true },
      instructions: { type: 'string', description: 'Optional incremental rework direction.' },
    },
    output: RECEIPT_OUTPUT,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'mission_rework')
      return receiptValue(await ctx.engineeringControlPlane.rework(agent, {
        missionId: args.missionId,
        expectedRevision: args.expectedRevision,
        ...args.instructions === undefined ? {} : { instructions: args.instructions },
      }, exec.signal))
    },
  })))
}
