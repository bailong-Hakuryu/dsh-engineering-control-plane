import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { parseExternalAssessmentFailureV1 } from '../src/assurance-provider.ts'
import type {
  MissionId,
  MissionReceipt,
  MissionSnapshot,
  RoleName,
} from '../src/kernel/index.ts'
import * as missionTools from '../src/tools.ts'

const signal = new AbortController().signal
const missionId = 'mission-tools-fixture' as MissionId

function snapshot(): MissionSnapshot {
  const roleNames: RoleName[] = ['planner', 'developer', 'tester', 'reviewer']
  return {
    missionId,
    revision: 211,
  repository: {
      canonicalRoot: 'D:/fixture',
      branch: 'main',
      head: 'a'.repeat(40),
      workspaceFingerprint: 'sha256:' + 'b'.repeat(64),
  },
  writeLease: {
    fencingToken: 1,
    holderId: 'tools-fixture-host',
    acquiredAt: '2026-08-22T18:00:00.000Z',
  },
    objective: 'Exercise the tool projection',
    acceptanceCriteria: [],
    constraints: [],
    effectivePolicy: {
      schemaVersion: 1,
      digest: 'sha256:' + 'c'.repeat(64),
      verificationProfile: 'fixture',
    },
    effectivePolicyDigest: 'sha256:' + 'c'.repeat(64),
    status: 'REVIEWING',
    attempt: 2,
    inputRecords: [{
      sequence: 1,
      kind: 'initial',
      submittedBy: 'agent:fixture',
      submittedAt: '2026-08-22T20:00:00.000Z',
      objective: 'Exercise the tool projection',
      acceptanceCriteria: [],
      constraints: [],
    }],
    roleRuns: Array.from({ length: 70 }, (_, index) => ({
      runId: `run-${index}`,
      missionId,
      attempt: index < 4 ? 1 : 2,
      role: roleNames[index % roleNames.length]!,
      state: 'completed' as const,
      createdAt: '2026-08-22T20:00:00.000Z',
      settledAt: '2026-08-22T20:00:01.000Z',
      evidenceRecordIds: [`record-${index}`],
    })),
    evidence: {
      records: Array.from({ length: 140 }, (_, index) => ({
        recordId: `record-${index}`,
        missionId,
        attempt: index < 70 ? 1 : 2,
        kind: `kind-${index}`,
        schemaVersion: 1,
        digest: `sha256:${index.toString(16).padStart(64, '0')}`,
        byteLength: index + 1,
        relativePath: `mission-tools-fixture/attempt-0002/records/record-${index}.json`,
        redacted: false,
        createdAt: '2026-08-22T20:00:00.000Z',
      })),
    },
    gate: {
      kind: 'blocked',
      reasons: [{ code: 'evidence_incomplete', source: 'evidence' }],
    },
    assuranceResults: [{
      schemaVersion: 1,
      requirementId: 'external-provider:fixture/security@1.0.0',
      attempt: 2,
      outcome: 'indeterminate',
      assessmentIds: ['assessment-2'],
      reasonCodes: ['coverage_invalid'],
    }],
    gateHistory: [],
    createdAt: '2026-08-22T20:00:00.000Z',
    updatedAt: '2026-08-22T20:00:02.000Z',
  }
}

class StubControlPlane extends Service {
  readonly starts: unknown[] = []
  readonly resumes: unknown[] = []
  readonly cancels: unknown[] = []
  readonly reworks: unknown[] = []

  constructor(ctx: Context) {
    super(ctx, 'engineeringControlPlane')
  }

  start(_agent: Agent, request: unknown): Promise<MissionReceipt> {
    this.starts.push(request)
    return Promise.resolve({
      missionId,
      revision: 1,
      status: 'CREATED',
      attempt: 1,
      acceptedAt: '2026-08-22T20:00:00.000Z',
    })
  }

  status(): Promise<MissionSnapshot> {
    return Promise.resolve(snapshot())
  }

  resume(_agent: Agent, request: unknown): Promise<MissionReceipt> {
    this.resumes.push(request)
    return Promise.resolve({ missionId, revision: 212, status: 'PLANNING', attempt: 2, acceptedAt: 'now' })
  }

  cancel(_agent: Agent, request: unknown): Promise<MissionReceipt> {
    this.cancels.push(request)
    return Promise.resolve({ missionId, revision: 212, status: 'CANCELLED', attempt: 2, acceptedAt: 'now' })
  }

  rework(_agent: Agent, request: unknown): Promise<MissionReceipt> {
    this.reworks.push(request)
    return Promise.resolve({ missionId, revision: 212, status: 'PLANNING', attempt: 3, acceptedAt: 'now' })
  }
}

async function harness(): Promise<{ readonly ctx: Context; readonly service: StubControlPlane }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(StubControlPlane)
  await ctx.plugin(missionTools)
  return { ctx, service: ctx.engineeringControlPlane as unknown as StubControlPlane }
}

const agent = { id: 'agent-tools-fixture' } as unknown as Agent

function execute(ctx: Context, name: string, args: unknown): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal,
    callId: `call-${name}` as never,
    name,
    arguments: args,
    agent,
  })
}

function resultValue(result: ToolExecutionResult): Record<string, unknown> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected successful tool result')
  return result.value as Record<string, unknown>
}

describe('Mission tool Adapter', () => {
  it('registers exactly five closed-schema tools', async () => {
    const { ctx } = await harness()
    const names = ['mission_start', 'mission_status', 'mission_resume', 'mission_cancel', 'mission_rework']
    expect(names.map(name => ctx.tools.get(name)?.name)).toEqual(names)
    for (const name of names) {
      expect(ctx.tools.get(name)?.parameters).toMatchObject({ additionalProperties: false })
    }
    expect('default' in missionTools).toBe(false)
  })

  it('derives Start idempotency from the Agent and Harness call id', async () => {
    const { ctx, service } = await harness()
    const result = await execute(ctx, 'mission_start', {
      objective: 'Ship the change',
      acceptanceCriteria: ['tests pass'],
    })

    expect(resultValue(result)).toMatchObject({ missionId, revision: 1, status: 'CREATED', attempt: 1 })
    expect(service.starts).toEqual([{
      idempotencyKey: 'agent-tools-fixture:call-mission_start',
      objective: 'Ship the change',
      acceptanceCriteria: ['tests pass'],
    }])
  })

  it('rejects unknown fields before invoking the Service Capability', async () => {
    const { ctx, service } = await harness()
    const result = await execute(ctx, 'mission_start', {
      objective: 'Ship the change',
      repositoryPath: 'D:/forged',
    })

    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('INVALID_ARGS')
    expect(service.starts).toEqual([])
  })

  it('returns a bounded Status projection with legal next actions', async () => {
    const { ctx } = await harness()
    const result = await execute(ctx, 'mission_status', { missionId })
    const value = resultValue(result)

    expect(value).toMatchObject({
      missionId,
      revision: 211,
      status: 'REVIEWING',
      roleRunsTruncated: true,
      evidenceTruncated: true,
      legalNextActions: ['mission_status', 'mission_cancel'],
      gate: {
        kind: 'blocked',
        reasons: [{ code: 'evidence_incomplete', source: 'evidence' }],
      },
      assuranceResults: [{
        requirementId: 'external-provider:fixture/security@1.0.0',
        attempt: 2,
        outcome: 'indeterminate',
        assessmentIds: ['assessment-2'],
        reasonCodes: ['coverage_invalid'],
      }],
    })
    expect(value['roleRuns']).toHaveLength(64)
    expect(value['evidence']).toHaveLength(128)
  })

  it('does not advertise Resume while frozen Assurance execution is unavailable', () => {
    const blocked: MissionSnapshot = {
      ...snapshot(),
      status: 'BLOCKED',
      blocked: {
        reason: { code: 'assurance_execution_unavailable' },
        resumeStatus: 'CREATED',
        blockedAt: '2026-08-22T20:00:03.000Z',
      },
      writeLease: { fencingToken: 1, releasedAt: '2026-08-22T20:00:03.000Z' },
    }

    expect(missionTools.statusValue(blocked).legalNextActions).toEqual([
      'mission_status',
      'mission_cancel',
    ])
  })

  it('advertises Resume only for a retryable Gate-blocking External Assessment Failure', () => {
    const descriptor = {
      schemaVersion: 1 as const,
      providerId: 'fixture/security',
      providerVersion: '1.0.0',
    }
    const requirementId = 'external-provider:fixture/security@1.0.0'
    const blocked: MissionSnapshot = {
      ...snapshot(),
      status: 'BLOCKED',
      assuranceProviderSelections: [{
        schemaVersion: 1,
        attempt: 2,
        providers: [{ schemaVersion: 1, descriptor, activation: 'required' }],
      }],
      assuranceProviderInvocations: [{
        schemaVersion: 1,
        invocationId: 'invocation-external-failed-1',
        attempt: 2,
        descriptor,
        state: 'external_failed',
        preparedAt: '2026-08-22T20:00:00.000Z',
        begunAt: '2026-08-22T20:00:01.000Z',
        failedAt: '2026-08-22T20:00:02.000Z',
        failure: parseExternalAssessmentFailureV1({
          schemaVersion: 1,
          reason: 'blocked',
          code: 'backend_unavailable',
        }),
      }],
      assuranceAssessments: [{
        schemaVersion: 1,
        assessmentId: 'assessment-external-failed-1',
        requirementId,
        invocationId: 'invocation-external-failed-1',
        attempt: 2,
        assessor: { kind: 'machine_provider', provider: descriptor },
        outcome: 'indeterminate',
        reasonCodes: ['external_assessment_blocked'],
        evidenceRecordIds: [],
        assessedAt: '2026-08-22T20:00:02.000Z',
      }],
      gate: {
        kind: 'blocked',
        reasons: [{ code: 'assurance_indeterminate', source: requirementId }],
      },
      blocked: {
        reason: { code: 'evidence_incomplete' },
        resumeStatus: 'REVIEWING',
        blockedAt: '2026-08-22T20:00:03.000Z',
      },
      writeLease: { fencingToken: 1, releasedAt: '2026-08-22T20:00:03.000Z' },
    }

    expect(missionTools.statusValue(blocked).legalNextActions).toEqual([
      'mission_status',
      'mission_resume',
      'mission_cancel',
    ])

    const terminalFailure = {
      ...blocked,
      assuranceProviderInvocations: [{
        ...blocked.assuranceProviderInvocations![0]!,
        failure: parseExternalAssessmentFailureV1({
          schemaVersion: 1,
          reason: 'failed',
          code: 'repository_binding_mismatch',
        }),
      }],
    } as MissionSnapshot
    expect(missionTools.statusValue(terminalFailure).legalNextActions).toEqual([
      'mission_status',
      'mission_cancel',
    ])
  })

  it('keeps Resume legal when REVIEWING needs input outside a blocked Assurance Gate', () => {
    const blocked: MissionSnapshot = {
      ...snapshot(),
      status: 'BLOCKED',
      blocked: {
        reason: { code: 'needs_input', detail: 'Clarify the implementation requirement.' },
        resumeStatus: 'REVIEWING',
        blockedAt: '2026-08-30T00:00:00.000Z',
      },
      assuranceProviderSelections: [{
        schemaVersion: 1,
        attempt: 1,
        providers: [{
          schemaVersion: 1,
          descriptor: {
            schemaVersion: 1,
            providerId: 'dsh/security-assurance',
            providerVersion: '0.1.0-rc.2',
          },
          activation: 'required',
        }],
      }],
      assuranceProviderInvocations: [],
      writeLease: { fencingToken: 1, releasedAt: '2026-08-30T00:00:00.000Z' },
    }

    expect(missionTools.statusValue(blocked).legalNextActions).toEqual([
      'mission_status',
      'mission_resume',
      'mission_cancel',
    ])
  })

  it('advertises Rework after a failed external Assurance Gate', () => {
    const reworkRequired: MissionSnapshot = {
      ...snapshot(),
      status: 'REWORK_REQUIRED',
      assuranceProviderSelections: [{
        schemaVersion: 1,
        attempt: 2,
        providers: [{
          schemaVersion: 1,
          descriptor: {
            schemaVersion: 1,
            providerId: 'fixture/security',
            providerVersion: '1.0.0',
          },
          activation: 'required',
        }],
      }],
      writeLease: { fencingToken: 1, releasedAt: '2026-08-22T20:00:03.000Z' },
    }

    expect(missionTools.statusValue(reworkRequired).legalNextActions).toEqual([
      'mission_status',
      'mission_rework',
      'mission_cancel',
    ])
  })

  it('passes explicit revisions through each existing-Mission mutation without retrying', async () => {
    const { ctx, service } = await harness()
    await execute(ctx, 'mission_resume', { missionId, expectedRevision: 7, supplementalContext: 'answer' })
    await execute(ctx, 'mission_cancel', { missionId, expectedRevision: 8, reason: 'stop' })
    await execute(ctx, 'mission_rework', { missionId, expectedRevision: 9, instructions: 'fix finding' })

    expect(service.resumes).toEqual([{ missionId, expectedRevision: 7, supplementalContext: 'answer' }])
    expect(service.cancels).toEqual([{ missionId, expectedRevision: 8, reason: 'stop' }])
    expect(service.reworks).toEqual([{ missionId, expectedRevision: 9, instructions: 'fix finding' }])
  })
})
