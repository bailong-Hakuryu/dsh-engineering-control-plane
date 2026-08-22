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
import EngineeringControlPlane from '../src/index.ts'
import * as assuranceProviderEntry from '../src/assurance-provider.ts'
import type {
  AssuranceProviderDescriptorV1,
  AssuranceProviderFactoryV1,
} from '../src/assurance-provider.ts'
import { parseAssuranceProviderDescriptorV1 } from '../src/assurance-provider.ts'
import type { Config } from '../src/config.ts'
import * as clientPlugin from '../src/client.ts'
import * as toolsPlugin from '../src/tools.ts'

const run = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function cleanRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-control-plane-provider-repo-'))
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
  const notApplicable = { mode: 'not_applicable' as const, reason: 'Not required by this fixture.' }
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
    repositories: [{ root: repository, verificationProfile: 'provider-fixture' }],
    verificationProfiles: [{
      name: 'provider-fixture',
      categories: {
        functional: notApplicable,
        negative: notApplicable,
        regression: notApplicable,
        security: notApplicable,
      },
    }],
  }
}

function referenceProviderContributor(
  descriptor: AssuranceProviderDescriptorV1,
  observeDescriptor: (descriptor: AssuranceProviderDescriptorV1) => void,
  name = 'reference-assurance-provider',
) {
    const factory: AssuranceProviderFactoryV1 = normalizedDescriptor => {
      observeDescriptor(normalizedDescriptor)
      return {
        descriptor: normalizedDescriptor,
        async assess() {
          throw new Error('Reference Fake assessment is outside the registration lifecycle slice')
        },
      }
  }
  return {
    name,
    inject: ['engineeringControlPlane'],
    apply(ctx: Context) {
      return ctx.engineeringControlPlane.registerAssuranceProvider(descriptor, factory)
    },
  }
}

describe('Assurance Provider startup composition', () => {
  it('admits detached frozen descriptors only during pre-Mission contributor composition', async () => {
    expect(Object.keys(assuranceProviderEntry)).toEqual(['parseAssuranceProviderDescriptorV1'])
    expect('registerAssuranceProvider' in toolsPlugin).toBe(false)
    expect('registerAssuranceProvider' in clientPlugin).toBe(false)

    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-provider-home-'))
    temporaryRoots.push(home)
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    const serviceFiber = await ctx.plugin(EngineeringControlPlane, config(repository, home))
    await ctx.engineeringControlPlane.whenReady()

    const descriptor: AssuranceProviderDescriptorV1 = {
      schemaVersion: 1,
      providerId: 'dsh/security-assurance',
      providerVersion: '0.1.0-rc.1',
    }
    const observed: AssuranceProviderDescriptorV1[] = []
    const normalized = parseAssuranceProviderDescriptorV1(descriptor)
    expect(normalized).not.toBe(descriptor)
    expect(normalized).toEqual(descriptor)
    expect(Object.isFrozen(normalized)).toBe(true)

    try {
      const contributorFiber = await ctx.plugin(referenceProviderContributor(
        descriptor,
        normalized => observed.push(normalized),
      ))
      expect(observed).toHaveLength(0)

      ;(descriptor as { providerId: string }).providerId = 'caller/mutated'
      const registeredIdentity: AssuranceProviderDescriptorV1 = {
        schemaVersion: 1,
        providerId: 'dsh/security-assurance',
        providerVersion: '0.1.0-rc.1',
      }
      await expect(ctx.plugin(referenceProviderContributor(
        registeredIdentity,
        normalized => observed.push(normalized),
        'duplicate-reference-assurance-provider',
      ))).rejects.toThrow("Assurance Provider 'dsh/security-assurance' version '0.1.0-rc.1' is already registered")
      expect(observed).toHaveLength(0)

      const invalidDescriptor = {
        schemaVersion: 1,
        providerId: 'dsh/invalid-provider',
        providerVersion: '1.0.0',
        registryWriter: true,
      } as unknown as AssuranceProviderDescriptorV1
      await expect(ctx.plugin(referenceProviderContributor(
        invalidDescriptor,
        normalized => observed.push(normalized),
        'invalid-reference-assurance-provider',
      ))).rejects.toThrow("Assurance Provider descriptor contains unknown field 'registryWriter'")
      expect(observed).toHaveLength(0)

      await contributorFiber.dispose()

      const replacementFiber = await ctx.plugin(referenceProviderContributor(
        registeredIdentity,
        normalized => observed.push(normalized),
        'replacement-reference-assurance-provider',
      ))
      expect(observed).toHaveLength(0)
      await replacementFiber.dispose()

      const agent = {
        id: 'agent-provider-fixture',
        session: { header: { cwd: repository } },
      } as unknown as Agent
      await ctx.engineeringControlPlane.start(agent, {
        idempotencyKey: 'provider-fixture:start:1',
        objective: 'Close the Provider registration window at the first Mission operation',
      }, new AbortController().signal)
      await expect(ctx.plugin(referenceProviderContributor(
        registeredIdentity,
        normalizedDescriptor => observed.push(normalizedDescriptor),
        'late-reference-assurance-provider',
      ))).rejects.toThrow('Assurance Provider registration is closed after Mission operation began')
      expect(observed).toHaveLength(0)
    } finally {
      await serviceFiber.dispose()
      await subagentFiber.dispose()
      await subprocessFiber.dispose()
    }
  })
})
