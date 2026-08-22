import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it } from 'vitest'
import { GitRepositoryAdapter } from '../src/adapters/git-repository.ts'
import { HarnessCommandExecutor } from '../src/adapters/harness-command-executor.ts'
import { openSqliteMissionStore } from '../src/adapters/sqlite-mission-store.ts'
import { VerificationAdapter, type VerificationProfile } from '../src/adapters/verification.ts'
import { inspectControlPlane } from '../src/doctor.ts'
import { createFilesystemEvidenceStore } from '../src/evidence/filesystem-store.ts'
import {
  createControlPlaneKernel,
  type EffectivePolicy,
  type MissionAuthority,
  type RoleName,
} from '../src/kernel/index.ts'
import {
  createMissionRunner,
  type MissionExecutionHost,
  type RoleExecutionRequest,
} from '../src/runner/mission-runner.ts'

const run = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function cleanRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-control-plane-approved-repo-'))
  temporaryRoots.push(root)
  await run('git', ['init', '-b', 'main'], { cwd: root })
  await run('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root })
  await run('git', ['config', 'user.name', 'Fixture'], { cwd: root })
  await writeFile(join(root, 'README.md'), '# approved fixture\n', 'utf8')
  await run('git', ['add', 'README.md'], { cwd: root })
  await run('git', ['commit', '-m', 'fixture baseline'], { cwd: root })
  return root
}

const roleOutputs: Readonly<Record<RoleName, unknown>> = {
  planner: {
    schemaVersion: 1,
    outcome: 'planned',
    summary: 'Create one bounded implementation and verify it.',
    steps: [{ id: 'step-1', objective: 'Create feature.ts', acceptanceSignals: ['host check passes'] }],
    risks: ['regression'],
    verificationFocus: ['functional', 'negative', 'regression', 'security'],
  },
  developer: {
    schemaVersion: 1,
    outcome: 'implemented',
    summary: 'Created the planned implementation without changing Git history.',
    changedAreas: ['feature.ts'],
    notes: [],
  },
  tester: {
    schemaVersion: 1,
    outcome: 'assessed',
    summary: 'The host-captured functional command passed.',
    findings: [],
  },
  reviewer: {
    schemaVersion: 1,
    outcome: 'reviewed',
    summary: 'No blocking finding remains in the Evidence.',
    findings: [],
  },
}

describe('approved packed-MVP vertical slice', () => {
  it('proves APPROVED through real Git, SQLite, subprocess, Evidence and restart-readable facts', async () => {
    const repositoryRoot = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-approved-home-'))
    temporaryRoots.push(home)
    const databasePath = join(home, 'control-plane', 'control-plane.sqlite')
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const commands = new HarnessCommandExecutor({
      subprocess: ctx.subprocess,
      maxStdoutBytes: 64 * 1024,
      maxStderrBytes: 64 * 1024,
      terminationGraceMs: 1_000,
    })
    const git = new GitRepositoryAdapter({
      commands,
      gitCommand: 'git',
      commandTimeoutMs: 30_000,
      maxUntrackedFiles: 32,
      maxUntrackedBytes: 1024 * 1024,
    })
    const signal = new AbortController().signal
    const repository = await git.deriveStartIdentity(repositoryRoot, signal)
    const holderId = 'approved-e2e-host'
    const authority: MissionAuthority = {
      principalId: 'host:approved-e2e',
      repository,
      actions: ['start', 'read', 'orchestrate'],
      leaseHolderId: holderId,
      writeLease: { holderId, fencingToken: 1 },
    }
    const policy: EffectivePolicy = {
      schemaVersion: 1,
      digest: 'sha256:approved-e2e-policy',
      verificationProfile: 'approved-e2e',
    }
    let store = await openSqliteMissionStore({ path: databasePath })
    const kernel = createControlPlaneKernel({
      store,
      nextMissionId: () => 'mission-approved-e2e',
      now: () => '2026-08-22T22:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'approved-e2e:start:1',
      input: {
        objective: 'Create a restart-readable evidence-backed implementation',
        acceptanceCriteria: ['Configured functional verification passes'],
      },
    }, authority)

    let evidenceSequence = 0
    const evidenceStore = createFilesystemEvidenceStore({
      root: join(home, 'control-plane', 'missions'),
      nextRecordId: () => `approved-record-${++evidenceSequence}`,
      now: () => '2026-08-22T22:00:00.000Z',
    })
    const profile: VerificationProfile = {
      name: 'approved-e2e',
      categories: {
        functional: {
          mode: 'commands',
          commands: [{
            name: 'node-success',
            argv: [process.execPath, '-e', 'process.exit(0)'],
            timeoutMs: 30_000,
            environmentNames: [],
          }],
        },
        negative: { mode: 'not_applicable', reason: 'Fixture has no input boundary.' },
        regression: { mode: 'not_applicable', reason: 'Fixture is an isolated new file.' },
        security: { mode: 'not_applicable', reason: 'Fixture has no security boundary.' },
      },
    }
    const requestedRoles: RoleName[] = []
    const host: MissionExecutionHost = {
      evidenceStore,
      roleExecutor: {
        async start(request: RoleExecutionRequest) {
          requestedRoles.push(request.role)
          if (request.role === 'developer') {
            await writeFile(
              join(repositoryRoot, 'feature.ts'),
              'export const answer = 42\n',
              'utf8',
            )
          }
          return {
            trace: {
              provider: 'scripted-e2e',
              providerRunId: `provider-run-${request.role}`,
              sessionId: `session-${request.role}`,
            },
            result: Promise.resolve({
              stopReason: 'completed',
              structured: roleOutputs[request.role],
              workspacePolicyViolations: [],
            }),
            dispose: () => Promise.resolve(),
          }
        },
      },
      captureImplementation: (snapshot, captureSignal) =>
        git.captureImplementation(snapshot.repository, captureSignal),
      runVerifications: (snapshot, verificationSignal) =>
        new VerificationAdapter(commands).run(profile, snapshot.repository, verificationSignal),
    }
    const runner = createMissionRunner({
      kernel,
      store,
      authorityFor: snapshot => ({ ...authority, repository: snapshot.repository }),
      nextRoleRunId: (() => {
        let sequence = 0
        return () => `approved-role-${++sequence}`
      })(),
    })

    try {
      const handle = runner.launch(started.missionId, authority, host)
      await handle.settled
      const approved = await kernel.snapshot(started.missionId, authority)
      expect(approved).toMatchObject({
        status: 'APPROVED',
        attempt: 1,
        gate: { kind: 'approved' },
        writeLease: { fencingToken: 1, releasedAt: '2026-08-22T22:00:00.000Z' },
      })
      expect(requestedRoles).toEqual(['planner', 'developer', 'tester', 'reviewer'])
      expect(approved.roleRuns).toHaveLength(4)
      expect(approved.roleRuns.every(role => role.trace?.provider === 'scripted-e2e')).toBe(true)
      expect(approved.evidence.records.map(record => record.kind)).toEqual([
        'context',
        'plan',
        'developer-report',
        'implementation',
        'verification',
        'test-report',
        'review-report',
        'final-report',
      ])

      await store.close()
      store = await openSqliteMissionStore({ path: databasePath })
      const reopenedKernel = createControlPlaneKernel({
        store,
        nextMissionId: () => 'unused',
        now: () => '2026-08-22T22:01:00.000Z',
        resolveEffectivePolicy: () => policy,
      })
      await expect(reopenedKernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
        revision: approved.revision,
        status: 'APPROVED',
        gate: { kind: 'approved' },
      })
      await store.close()

      for (const view of [
        'context.md',
        'plan.md',
        'implementation.diff',
        'test-report.md',
        'review-report.md',
        'final-report.md',
      ]) {
        await expect(stat(join(
          home,
          'control-plane',
          'missions',
          started.missionId,
          'attempt-0001',
          view,
        ))).resolves.toBeDefined()
      }
      expect(await readFile(join(
        home,
        'control-plane',
        'missions',
        started.missionId,
        'attempt-0001',
        'implementation.diff',
      ), 'utf8')).toContain('feature.ts')

      await expect(inspectControlPlane({ dshHome: home })).resolves.toMatchObject({
        ok: true,
        missions: { total: 1, nonTerminal: 0, activeWriteLeases: 0 },
        evidence: { indexed: 8, valid: 8, missing: 0, corrupt: 0 },
      })
    } finally {
      await runner.dispose()
      await store.close()
      await subprocessFiber.dispose()
    }
  })
})
