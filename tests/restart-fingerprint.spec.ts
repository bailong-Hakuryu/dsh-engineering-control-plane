import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it } from 'vitest'
import { GitRepositoryAdapter } from '../src/adapters/git-repository.ts'
import { HarnessCommandExecutor } from '../src/adapters/harness-command-executor.ts'
import { openSqliteMissionStore } from '../src/adapters/sqlite-mission-store.ts'
import type { Config } from '../src/config.ts'
import EngineeringControlPlane from '../src/index.ts'
import { createControlPlaneKernel, type MissionAuthority } from '../src/kernel/index.ts'
import { createEffectivePolicy, resolveDeploymentConfig } from '../src/policy.ts'

const run = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-restart-fingerprint-repo-'))
  temporaryRoots.push(root)
  await run('git', ['init', '-b', 'main'], { cwd: root })
  await run('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root })
  await run('git', ['config', 'user.name', 'Fixture'], { cwd: root })
  await writeFile(join(root, 'README.md'), '# restart fixture\n', 'utf8')
  await run('git', ['add', 'README.md'], { cwd: root })
  await run('git', ['commit', '-m', 'fixture baseline'], { cwd: root })
  return root
}

function config(root: string, home: string): Config {
  const notApplicable = { mode: 'not_applicable' as const, reason: 'Restart fixture.' }
  return {
    dshHome: home,
    subagentProvider: 'spawn',
    maxSubagentDepth: 1,
    rolePolicies: {
      planner: { allowTools: [], denyTools: [] },
      developer: { allowTools: [], denyTools: [] },
      tester: { allowTools: [], denyTools: [] },
      reviewer: { allowTools: [], denyTools: [] },
    },
    repositories: [{ root, verificationProfile: 'restart-fixture' }],
    verificationProfiles: [{
      name: 'restart-fixture',
      categories: {
        functional: notApplicable,
        negative: notApplicable,
        regression: notApplicable,
        security: notApplicable,
      },
    }],
  }
}

describe('restart Workspace Fingerprint recovery boundary', () => {
  it('requires explicit Resume against the exact recovery scene', async () => {
    const root = await repository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-restart-fingerprint-home-'))
    temporaryRoots.push(home)
    const deploymentConfig = config(root, home)
    const deployment = resolveDeploymentConfig(deploymentConfig)
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    const commands = new HarnessCommandExecutor({
      subprocess: ctx.subprocess,
      maxStdoutBytes: deployment.artifactBudgets.maxStdoutBytes,
      maxStderrBytes: deployment.artifactBudgets.maxStderrBytes,
      terminationGraceMs: deployment.terminationGraceMs,
    })
    const git = new GitRepositoryAdapter({
      commands,
      gitCommand: deployment.gitCommand,
      commandTimeoutMs: deployment.gitCommandTimeoutMs,
      maxUntrackedFiles: deployment.artifactBudgets.maxUntrackedFiles,
      maxUntrackedBytes: deployment.artifactBudgets.maxUntrackedBytes,
    })
    const repositoryIdentity = await git.deriveStartIdentity(root, new AbortController().signal)
    const policy = createEffectivePolicy(deployment, 'restart-fixture')
    const store = await openSqliteMissionStore({
      path: join(home, 'control-plane', 'control-plane.sqlite'),
    })
    const kernel = createControlPlaneKernel({
      store,
      nextMissionId: () => 'mission-restart-fingerprint',
      now: () => '2026-08-22T23:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const persistedAuthority: MissionAuthority = {
      principalId: 'host:before-restart',
      repository: repositoryIdentity,
      actions: ['start', 'read', 'orchestrate'],
      leaseHolderId: 'host-before-restart',
      writeLease: { holderId: 'host-before-restart', fencingToken: 1 },
    }
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'restart-fingerprint:start:1',
      input: { objective: 'Resume only from the recorded recovery scene' },
    }, persistedAuthority)
    await kernel.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: started.revision,
      to: 'ANALYZING',
    }, persistedAuthority)
    await store.close()

    const serviceFiber = await ctx.plugin(EngineeringControlPlane, deploymentConfig)
    const service = ctx.engineeringControlPlane
    await service.whenReady()
    const agent = {
      id: 'agent-after-restart',
      session: { header: { cwd: root } },
    } as unknown as Agent
    const recovered = await service.status(agent, started.missionId, new AbortController().signal)
    expect(recovered).toMatchObject({
      status: 'BLOCKED',
      blocked: {
        reason: { code: 'host_restarted' },
        resumeStatus: 'ANALYZING',
        workspaceFingerprint: repositoryIdentity.workspaceFingerprint,
      },
      writeLease: { fencingToken: 1, releasedAt: expect.any(String) },
    })

    await writeFile(join(root, 'README.md'), '# changed after recovery\n', 'utf8')
    await expect(service.resume(agent, {
      missionId: started.missionId,
      expectedRevision: recovered.revision,
      supplementalContext: 'Try to continue after an out-of-band workspace edit.',
    }, new AbortController().signal)).rejects.toThrow(
      'workspace changed after restart recovery',
    )
    await expect(service.status(agent, started.missionId, new AbortController().signal)).resolves.toMatchObject({
      revision: recovered.revision,
      status: 'BLOCKED',
      writeLease: { fencingToken: 1, releasedAt: expect.any(String) },
    })

    await serviceFiber.dispose()
    await subagentFiber.dispose()
    await subprocessFiber.dispose()
  })
})
