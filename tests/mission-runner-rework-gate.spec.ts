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
  type MissionSnapshot,
  type RepositoryIdentity,
  type RoleName,
} from '../src/kernel/index.ts'
import { createMissionRunner, type MissionExecutionHost } from '../src/runner/mission-runner.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/runner-rework-gate-fixture',
  branch: 'main',
  head: '7'.repeat(40),
  workspaceFingerprint: `sha256:${'6'.repeat(64)}`,
}

const holderId = 'runner-rework-gate-fixture-host'
const authority: MissionAuthority = {
  principalId: 'host:runner-rework-gate-fixture',
  repository,
  actions: ['start', 'read', 'orchestrate', 'rework'],
  leaseHolderId: holderId,
  writeLease: { holderId, fencingToken: 1 },
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: `sha256:${'5'.repeat(64)}`,
  verificationProfile: 'fixture',
}

const roleOutputs: Readonly<Record<RoleName, unknown>> = {
  planner: {
    schemaVersion: 1,
    outcome: 'planned',
    summary: 'Change the parser and cover it.',
    steps: [{ id: 'step-1', objective: 'Change the parser', acceptanceSignals: ['all checks pass'] }],
    risks: [],
    verificationFocus: ['functional'],
  },
  developer: {
    schemaVersion: 1,
    outcome: 'implemented',
    summary: 'Changed the parser.',
    changedAreas: ['src/parser.ts'],
    notes: [],
  },
  tester: { schemaVersion: 1, outcome: 'assessed', summary: 'Checks assessed.', findings: [] },
  reviewer: { schemaVersion: 1, outcome: 'reviewed', summary: 'No blocking finding.', findings: [] },
}

function executionAuthority(snapshot: MissionSnapshot): MissionAuthority {
  if (snapshot.writeLease.holderId === undefined) throw new Error('fixture expected an active Write Lease')
  return {
    ...authority,
    repository: snapshot.repository,
    writeLease: { holderId: snapshot.writeLease.holderId, fencingToken: snapshot.writeLease.fencingToken },
  }
}

describe('MissionRunner Rework to Gate', () => {
  it('re-establishes attempt context so a repaired Rework attempt can be approved', async () => {
    const evidenceRoot = await mkdtemp(join(tmpdir(), 'dsh-runner-rework-gate-'))
    temporaryRoots.push(evidenceRoot)
    let evidenceSequence = 0
    const evidenceStore = createFilesystemEvidenceStore({
      root: evidenceRoot,
      nextRecordId: () => `rework-gate-record-${++evidenceSequence}`,
      now: () => '2026-09-27T06:30:00.000Z',
    })
    const store = createInMemoryMissionStore()
    const kernel = createControlPlaneKernel({
      store,
      nextMissionId: () => 'mission-runner-rework-gate',
      now: () => '2026-09-27T06:30:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const host: MissionExecutionHost = {
      evidenceStore,
      roleExecutor: {
        start(request) {
          return Promise.resolve({
            trace: { provider: 'scripted', providerRunId: `scripted-${request.role}` },
            result: Promise.resolve({
              stopReason: 'completed',
              structured: roleOutputs[request.role],
              workspacePolicyViolations: [],
            }),
            dispose: () => Promise.resolve(),
          })
        },
      },
      captureImplementation: snapshot => Promise.resolve({
        payload: { schemaVersion: 1, changedFiles: ['src/parser.ts'] },
        subject: {
          kind: 'git_worktree',
          branch: repository.branch,
          head: repository.head,
          workspaceFingerprint: `sha256:${String(snapshot.attempt).repeat(64)}`,
          producedChangeFingerprint: `sha256:${'4'.repeat(64)}`,
        },
        implementationSecretCount: 0,
        workspacePolicyViolations: [],
      }),
      // The first attempt fails its functional check; the Rework attempt repairs it.
      runVerifications: snapshot => Promise.resolve({
        payload: { schemaVersion: 1, profile: 'fixture' },
        outcomes: [
          { category: 'functional', outcome: snapshot.attempt === 1 ? 'failed' : 'passed' },
          { category: 'negative', outcome: 'passed' },
          { category: 'regression', outcome: 'passed' },
          { category: 'security', outcome: 'passed' },
        ],
      }),
    }
    const runner = createMissionRunner({ kernel, store, authorityFor: executionAuthority })

    try {
      const started = await kernel.dispatch({
        kind: 'start',
        idempotencyKey: 'runner-rework-gate-start',
        input: { objective: 'Repair the parser through one Rework attempt' },
      }, authority)
      await runner.launch(started.missionId, authority, host).settled
      const failed = await kernel.snapshot(started.missionId, authority)
      expect(failed).toMatchObject({
        status: 'REWORK_REQUIRED',
        attempt: 1,
        gate: { kind: 'rework_required', reasons: [{ code: 'verification_failed', source: 'functional' }] },
      })

      const reworked = await kernel.dispatch({
        kind: 'rework',
        missionId: failed.missionId,
        expectedRevision: failed.revision,
        instructions: 'Repair the functional failure.',
      }, authority)
      const attempt2 = await kernel.snapshot(reworked.missionId, authority)
      await runner.launch(attempt2.missionId, executionAuthority(attempt2), host).settled

      const approved = await kernel.snapshot(started.missionId, authority)
      expect(approved).toMatchObject({ status: 'APPROVED', attempt: 2, gate: { kind: 'approved', reasons: [] } })
      expect(approved.evidence.records.filter(record => record.kind === 'context').map(record => record.attempt))
        .toEqual([1, 2])
    } finally {
      await runner.dispose()
    }
  })
})
