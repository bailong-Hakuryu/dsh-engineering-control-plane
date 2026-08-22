import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFilesystemEvidenceStore } from '../src/evidence/filesystem-store.ts'
import {
  createControlPlaneKernel,
  createInMemoryMissionStore,
  type EffectivePolicy,
  type GateInput,
  type MissionAuthority,
  type MissionSnapshot,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'
import {
  createMissionRunner,
  type MissionExecutionHost,
  type RoleExecutionRequest,
} from '../src/runner/mission-runner.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/runner-rework-fixture',
  branch: 'main',
  head: '8888888888888888888888888888888888888888',
  workspaceFingerprint: 'sha256:runner-rework-baseline',
}

const holderId = 'runner-rework-fixture-host'
const authority: MissionAuthority = {
  principalId: 'agent:mission-owner',
  repository,
  actions: ['start', 'read', 'orchestrate', 'rework'],
  leaseHolderId: holderId,
  writeLease: { holderId, fencingToken: 1 },
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: 'sha256:runner-rework-policy',
  verificationProfile: 'full-fixture',
}

const failedGateInput: GateInput = {
  requiredEvidence: [],
  verifications: [
    { category: 'functional', outcome: 'failed' },
    { category: 'negative', outcome: 'passed' },
    { category: 'regression', outcome: 'passed' },
    { category: 'security', outcome: 'passed' },
  ],
  reviewerFindings: [],
  implementationSecretCount: 0,
  workspacePolicyViolations: [],
}

function executionAuthority(snapshot: MissionSnapshot): MissionAuthority {
  if (snapshot.writeLease.holderId === undefined) {
    throw new Error('fixture expected an active Write Lease')
  }
  return {
    ...authority,
    repository: snapshot.repository,
    writeLease: {
      holderId: snapshot.writeLease.holderId,
      fencingToken: snapshot.writeLease.fencingToken,
    },
  }
}

describe('MissionRunner Rework context', () => {
  it('supplies the prior Gate, Plan, and indexed Evidence to the incremental Planner', async () => {
    const evidenceRoot = await mkdtemp(join(tmpdir(), 'dsh-runner-rework-evidence-'))
    temporaryRoots.push(evidenceRoot)
    let evidenceSequence = 0
    const evidenceStore = createFilesystemEvidenceStore({
      root: evidenceRoot,
      nextRecordId: () => `record-${++evidenceSequence}`,
      now: () => '2026-08-22T20:00:00.000Z',
    })
    const missionStore = createInMemoryMissionStore()
    const kernel = createControlPlaneKernel({
      store: missionStore,
      nextMissionId: () => 'mission-runner-rework-context',
      now: () => '2026-08-22T20:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'runner-rework-context-start',
      input: { objective: 'Repair the failed verification without weakening policy' },
    }, authority)

    let snapshot = await kernel.snapshot(started.missionId, authority)
    for (const phase of ['ANALYZING', 'PLANNING', 'IMPLEMENTING', 'VERIFYING', 'REVIEWING'] as const) {
      const advanced = await kernel.dispatch({
        kind: 'advance',
        missionId: snapshot.missionId,
        expectedRevision: snapshot.revision,
        to: phase,
      }, executionAuthority(snapshot))
      snapshot = await kernel.snapshot(advanced.missionId, authority)
    }

    const priorEvidence = [
      { kind: 'plan', payload: { summary: 'Original plan', steps: ['change parser'] } },
      { kind: 'implementation', payload: { marker: 'prior implementation evidence' } },
      { kind: 'review-report', payload: { marker: 'prior review evidence' } },
    ] as const
    for (const item of priorEvidence) {
      const record = await evidenceStore.publish({
        missionId: snapshot.missionId,
        attempt: 1,
        kind: item.kind,
        schemaVersion: 1,
        payload: item.payload,
      })
      const indexed = await kernel.dispatch({
        kind: 'record_evidence',
        missionId: snapshot.missionId,
        expectedRevision: snapshot.revision,
        record,
      }, executionAuthority(snapshot))
      snapshot = await kernel.snapshot(indexed.missionId, authority)
    }

    const decided = await kernel.dispatch({
      kind: 'decide_gate',
      missionId: snapshot.missionId,
      expectedRevision: snapshot.revision,
      input: failedGateInput,
    }, executionAuthority(snapshot))
    const reworked = await kernel.dispatch({
      kind: 'rework',
      missionId: snapshot.missionId,
      expectedRevision: decided.revision,
      instructions: 'Fix the functional failure and retain all checks.',
    }, authority)
    snapshot = await kernel.snapshot(reworked.missionId, authority)

    let plannerPrompt: string | undefined
    const host: MissionExecutionHost = {
      evidenceStore,
      roleExecutor: {
        start(request: RoleExecutionRequest) {
          if (request.role !== 'planner') throw new Error('fixture only expects the incremental Planner')
          plannerPrompt = request.prompt
          return Promise.resolve({
            trace: { provider: 'scripted', providerRunId: 'incremental-planner-1' },
            result: Promise.resolve({
              stopReason: 'needs-input',
              structured: {
                schemaVersion: 1,
                outcome: 'needs_input',
                summary: 'Need one explicit product choice.',
                steps: [],
                risks: [],
                verificationFocus: [],
                question: 'Which compatibility behavior is required?',
              },
            }),
            dispose: () => Promise.resolve(),
          })
        },
      },
      captureImplementation: () => Promise.reject(new Error('fixture must not implement')),
      runVerifications: () => Promise.reject(new Error('fixture must not verify')),
    }
    const runner = createMissionRunner({
      kernel,
      store: missionStore,
      authorityFor: executionAuthority,
    })

    await runner.launch(snapshot.missionId, executionAuthority(snapshot), host).settled

    const prompt = JSON.parse(plannerPrompt ?? 'null') as {
      mission: { attempt: number; previousGate: unknown }
      priorAttempt: {
        attempt: number
        gate: unknown
        plan: unknown
        evidence: Array<{ record: { kind: string }; payload: unknown }>
      }
    }
    expect(prompt.mission).toMatchObject({
      attempt: 2,
      previousGate: {
        kind: 'rework_required',
        reasons: [{ code: 'verification_failed', source: 'functional' }],
      },
    })
    expect(prompt.priorAttempt).toMatchObject({
      attempt: 1,
      gate: {
        attempt: 1,
        decision: {
          kind: 'rework_required',
          reasons: [{ code: 'verification_failed', source: 'functional' }],
        },
      },
      plan: { summary: 'Original plan', steps: ['change parser'] },
    })
    expect(prompt.priorAttempt.evidence.map(item => item.record.kind)).toEqual([
      'plan',
      'implementation',
      'review-report',
    ])
    expect(prompt.priorAttempt.evidence[1]?.payload).toEqual({ marker: 'prior implementation evidence' })
  })
})
