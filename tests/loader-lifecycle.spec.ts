import { execFile } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it } from 'vitest'
import EngineeringControlPlane from '../src/index.ts'
import * as assuranceProviderPlugin from '../src/assurance-provider.ts'
import type { Config } from '../src/config.ts'
import * as rootPlugin from '../src/index.ts'
import * as toolsPlugin from '../src/tools.ts'
import * as clientPlugin from '../src/client.ts'
import * as invariantPlugin from '../src/invariant.ts'

const run = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function cleanRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-control-plane-repo-'))
  temporaryRoots.push(root)
  await run('git', ['init', '-b', 'main'], { cwd: root })
  await run('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root })
  await run('git', ['config', 'user.name', 'Fixture'], { cwd: root })
  await writeFile(join(root, 'README.md'), '# fixture\n', 'utf8')
  await run('git', ['add', 'README.md'], { cwd: root })
  await run('git', ['commit', '-m', 'fixture baseline'], { cwd: root })
  return root
}

function config(repository: string, home: string): Config {
  const notApplicable = { mode: 'not_applicable' as const, reason: 'Not required by the Loader fixture.' }
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
    repositories: [{ root: repository, verificationProfile: 'loader-fixture' }],
    verificationProfiles: [{
      name: 'loader-fixture',
      categories: {
        functional: notApplicable,
        negative: notApplicable,
        regression: notApplicable,
        security: notApplicable,
      },
    }],
  }
}

async function waitForBlocked(
  service: EngineeringControlPlane,
  agent: Agent,
  missionId: string,
): Promise<Awaited<ReturnType<EngineeringControlPlane['status']>>> {
  for (let index = 0; index < 100; index += 1) {
    const current = await service.status(agent, missionId, new AbortController().signal)
    if (current.status === 'BLOCKED') return current
    await new Promise<void>(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Mission did not reach its expected provider-failure Blocked state')
}

describe('source plugin Loader contracts', () => {
  it('exposes one default root Service and namespace companion entrypoints', () => {
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(rootPlugin)).toBe(EngineeringControlPlane)
    expect(loader.unwrapExports(toolsPlugin)).toBe(toolsPlugin)
    expect(loader.unwrapExports(clientPlugin)).toBe(clientPlugin)
    expect(loader.unwrapExports(invariantPlugin)).toBe(invariantPlugin)
    expect(loader.unwrapExports(assuranceProviderPlugin)).toBe(assuranceProviderPlugin)
    expect('default' in toolsPlugin).toBe(false)
    expect('default' in clientPlugin).toBe(false)
    expect('default' in invariantPlugin).toBe(false)
    expect('default' in assuranceProviderPlugin).toBe(false)
    expect(Object.keys(assuranceProviderPlugin)).toEqual([
      'parseAssuranceProviderConfigurationV1',
      'parseAssuranceProviderDescriptorV1',
      'sealAssuranceSubmissionV1',
    ])
  })

  it('loads, recovers, runs through public Harness seams, and tears down its SQLite owner', async () => {
    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-home-'))
    temporaryRoots.push(home)
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    const invariantRegistryFiber = await ctx.plugin(InvariantRegistry)
    const serviceFiber = await ctx.plugin(EngineeringControlPlane, config(repository, home))
    const invariantFiber = await ctx.plugin(invariantPlugin)
    const service = ctx.engineeringControlPlane
    await service.whenReady()

    const agent = {
      id: 'agent-loader-fixture',
      session: { header: { cwd: repository } },
    } as unknown as Agent
    const started = await service.start(agent, {
      idempotencyKey: 'loader-fixture:start:1',
      objective: 'Prove real Loader and service composition',
    }, new AbortController().signal)
    const blocked = await waitForBlocked(service, agent, started.missionId)

    expect(blocked).toMatchObject({
      missionId: started.missionId,
      status: 'BLOCKED',
      attempt: 1,
      blocked: { reason: { code: 'provider_failure' }, resumeStatus: 'PLANNING' },
      roleRuns: [{ role: 'planner', state: 'failed' }],
      evidence: { records: [{ kind: 'context' }] },
    })
    await expect(stat(join(home, 'control-plane', 'control-plane.sqlite'))).resolves.toBeDefined()

    const cancelled = await service.cancel(agent, {
      missionId: started.missionId,
      expectedRevision: blocked.revision,
      reason: 'Loader fixture complete',
    }, new AbortController().signal)
    expect(cancelled.status).toBe('CANCELLED')
    const cancelledSnapshot = await service.status(
      agent,
      started.missionId,
      new AbortController().signal,
    )
    const cancellationEvidence = cancelledSnapshot.evidence.records
      .find(record => record.kind === 'cancellation-repository-state')
    expect(cancellationEvidence).toBeDefined()
    if (cancellationEvidence === undefined) throw new Error('missing cancellation repository Evidence')
    expect(cancelledSnapshot.cancellation?.repositoryEvidenceRecordId).toBe(cancellationEvidence.recordId)
    await expect(stat(join(
      home,
      'control-plane',
      'missions',
      ...cancellationEvidence.relativePath.split('/'),
    ))).resolves.toBeDefined()

    await invariantFiber.dispose()
    await serviceFiber.dispose()
    expect(ctx.get('engineeringControlPlane')).toBeUndefined()
    await invariantRegistryFiber.dispose()
    await subagentFiber.dispose()
    await subprocessFiber.dispose()
  })
})
