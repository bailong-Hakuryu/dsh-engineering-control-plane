import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFilesystemEvidenceStore } from '../src/evidence/filesystem-store.ts'
import {
  createControlPlaneKernel,
  createInMemoryMissionStore,
  type EffectivePolicy,
  type MissionAuthority,
  type RepositoryIdentity,
  type RoleName,
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
  canonicalRoot: 'D:/runner-happy-fixture',
  branch: 'main',
  head: '9999999999999999999999999999999999999999',
  workspaceFingerprint: 'sha256:runner-happy-baseline',
}

const authority: MissionAuthority = {
  principalId: 'agent:mission-owner',
  repository,
  actions: ['start', 'read', 'orchestrate', 'resume', 'cancel', 'rework'],
  leaseHolderId: 'runner-happy-fixture-host',
  writeLease: { holderId: 'runner-happy-fixture-host', fencingToken: 1 },
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: 'sha256:runner-happy-policy',
  verificationProfile: 'full-fixture',
}

const roleOutputs: Readonly<Record<RoleName, unknown>> = {
  planner: {
    schemaVersion: 1,
    outcome: 'planned',
    summary: 'Implement one bounded change and verify it.',
    steps: [{ id: 'step-1', objective: 'Implement the requested behavior', acceptanceSignals: ['tests pass'] }],
    risks: ['regression'],
    verificationFocus: ['functional', 'negative', 'regression', 'security'],
  },
  developer: {
    schemaVersion: 1,
    outcome: 'implemented',
    summary: 'Implemented the accepted Plan.',
    changedAreas: ['src/feature.ts'],
    notes: ['No Git history operation was used.'],
  },
  tester: {
    schemaVersion: 1,
    outcome: 'assessed',
    summary: 'All host-captured checks passed.',
    findings: [],
  },
  reviewer: {
    schemaVersion: 1,
    outcome: 'reviewed',
    summary: 'No blocking engineering finding remains.',
    findings: [],
  },
}

describe('MissionRunner happy path', () => {
  it('orchestrates four subordinate roles and lets only the Gate approve', async () => {
    const evidenceRoot = await mkdtemp(join(tmpdir(), 'dsh-runner-evidence-'))
    temporaryRoots.push(evidenceRoot)
    let evidenceSequence = 0
    const evidenceStore = createFilesystemEvidenceStore({
      root: evidenceRoot,
      nextRecordId: () => `record-${++evidenceSequence}`,
      now: () => '2026-08-22T19:00:00.000Z',
    })
    const store = createInMemoryMissionStore()
    const kernel = createControlPlaneKernel({
      store,
      nextMissionId: () => 'mission-runner-happy',
      now: () => '2026-08-22T19:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'runner-happy-start',
      input: {
        objective: 'Deliver an evidence-backed engineering change',
        acceptanceCriteria: ['All configured checks pass'],
        constraints: ['Do not change Git history'],
      },
    }, authority)
    const requestedRoles: RoleName[] = []
    const rolePrompts = new Map<RoleName, string>()
    const host: MissionExecutionHost = {
      evidenceStore,
      roleExecutor: {
        async start(request: RoleExecutionRequest) {
          requestedRoles.push(request.role)
          rolePrompts.set(request.role, request.prompt)
          return {
            trace: {
              provider: 'scripted',
              providerRunId: `session-${request.role}-1`,
              sessionId: `session-${request.role}-1`,
            },
            result: Promise.resolve({
              stopReason: 'completed',
              structured: roleOutputs[request.role],
            }),
            dispose: () => Promise.resolve(),
          }
        },
      },
      captureImplementation: () => Promise.resolve({
        payload: { files: ['src/feature.ts'], patchDigest: 'sha256:implementation-fixture' },
        subject: {
          kind: 'git_worktree',
          branch: repository.branch,
          head: repository.head,
          workspaceFingerprint: `sha256:${'a'.repeat(64)}`,
        },
        implementationSecretCount: 0,
        workspacePolicyViolations: [],
      }),
      runVerifications: () => Promise.resolve({
        payload: { profile: 'full-fixture', commands: 4 },
        outcomes: [
          { category: 'functional', outcome: 'passed' },
          { category: 'negative', outcome: 'passed' },
          { category: 'regression', outcome: 'passed' },
          { category: 'security', outcome: 'passed' },
        ],
      }),
    }
    const runner = createMissionRunner({
      kernel,
      store,
      authorityFor: snapshot => ({ ...authority, repository: snapshot.repository }),
    })

    await runner.launch(started.missionId, authority, host).settled

    expect(requestedRoles).toEqual(['planner', 'developer', 'tester', 'reviewer'])
    const plannerPrompt = JSON.parse(rolePrompts.get('planner') ?? '{}') as {
      executionContract?: string[]
    }
    const developerPrompt = JSON.parse(rolePrompts.get('developer') ?? '{}') as {
      executionContract?: string[]
    }
    expect(plannerPrompt.executionContract?.join(' ')).toContain('Host verification')
    expect(plannerPrompt.executionContract?.join(' ')).toContain('validation-only Mission')
    expect(developerPrompt.executionContract?.join(' ')).toContain('after outcome implemented')
    expect(developerPrompt.executionContract?.join(' ')).toContain('empty changedAreas')
    expect(developerPrompt.executionContract?.join(' ')).toContain('Do not return needs_input')
    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      status: 'APPROVED',
      attempt: 1,
      roleRuns: [
        { role: 'planner', state: 'completed' },
        { role: 'developer', state: 'completed' },
        { role: 'tester', state: 'completed' },
        { role: 'reviewer', state: 'completed' },
      ],
      evidence: {
        records: [
          { kind: 'context' },
          { kind: 'plan' },
          { kind: 'developer-report' },
          { kind: 'implementation' },
          { kind: 'verification' },
          { kind: 'test-report' },
          { kind: 'review-report' },
          { kind: 'final-report' },
        ],
      },
      gate: { kind: 'approved', reasons: [] },
    })
  })
})
