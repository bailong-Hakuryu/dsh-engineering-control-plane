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
import type { AssuranceProviderActivationConfig, Config } from '../src/config.ts'
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

function config(
  repository: string,
  home: string,
  assuranceProviders: readonly AssuranceProviderActivationConfig[] = [],
): Config {
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
    repositories: [{
      root: repository,
      verificationProfile: 'provider-fixture',
      assuranceProviders: assuranceProviders.map(provider => ({ ...provider })),
    }],
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

describe('Assurance Provider startup registration and selection', () => {
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
      providerId: 'fixture/registration-provider',
      providerVersion: '1.0.0-fixture.1',
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
        providerId: 'fixture/registration-provider',
        providerVersion: '1.0.0-fixture.1',
      }
      await expect(ctx.plugin(referenceProviderContributor(
        registeredIdentity,
        normalized => observed.push(normalized),
        'duplicate-reference-assurance-provider',
      ))).rejects.toThrow("Assurance Provider 'fixture/registration-provider' version '1.0.0-fixture.1' is already registered")
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

  it('freezes Host-selected exact Provider registrations into Attempt 1 before execution', async () => {
    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-provider-selection-home-'))
    temporaryRoots.push(home)
    const activations: AssuranceProviderActivationConfig[] = [
      {
        providerId: 'fixture/disabled-provider',
        providerVersion: '1.0.0-fixture.1',
        activation: 'disabled',
      },
      {
        providerId: 'fixture/missing-provider',
        providerVersion: '1.0.0-fixture.1',
        activation: 'when-available',
      },
      {
        providerId: 'fixture/required-provider',
        providerVersion: '1.0.0-fixture.1',
        activation: 'required',
      },
      {
        providerId: 'fixture/when-available-provider',
        providerVersion: '1.0.0-fixture.1',
        activation: 'when-available',
      },
    ]
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    const serviceFiber = await ctx.plugin(EngineeringControlPlane, config(repository, home, activations))
    await ctx.engineeringControlPlane.whenReady()

    const descriptors = {
      disabled: {
        schemaVersion: 1,
        providerId: 'fixture/disabled-provider',
        providerVersion: '1.0.0-fixture.1',
      },
      required: {
        schemaVersion: 1,
        providerId: 'fixture/required-provider',
        providerVersion: '1.0.0-fixture.1',
      },
      whenAvailable: {
        schemaVersion: 1,
        providerId: 'fixture/when-available-provider',
        providerVersion: '1.0.0-fixture.1',
      },
    } as const satisfies Record<string, AssuranceProviderDescriptorV1>

    try {
      const disabledFiber = await ctx.plugin(referenceProviderContributor(
        descriptors.disabled,
        () => {},
        'disabled-reference-assurance-provider',
      ))
      const requiredFiber = await ctx.plugin(referenceProviderContributor(
        descriptors.required,
        () => {},
        'required-reference-assurance-provider',
      ))
      const whenAvailableFiber = await ctx.plugin(referenceProviderContributor(
        descriptors.whenAvailable,
        () => {},
        'when-available-reference-assurance-provider',
      ))

      const agent = {
        id: 'agent-provider-selection-fixture',
        session: { header: { cwd: repository } },
      } as unknown as Agent
      const receipt = await ctx.engineeringControlPlane.start(agent, {
        idempotencyKey: 'provider-selection:start:1',
        objective: 'Freeze exact Host-selected Assurance Providers for Attempt 1',
      }, new AbortController().signal)
      const frozen = await ctx.engineeringControlPlane.status(
        agent,
        receipt.missionId,
        new AbortController().signal,
      )

      expect(frozen.effectivePolicy).toMatchObject({
        assuranceProviderActivations: [
          { schemaVersion: 1, descriptor: descriptors.disabled, activation: 'disabled' },
          {
            schemaVersion: 1,
            descriptor: {
              schemaVersion: 1,
              providerId: 'fixture/missing-provider',
              providerVersion: '1.0.0-fixture.1',
            },
            activation: 'when-available',
          },
          { schemaVersion: 1, descriptor: descriptors.required, activation: 'required' },
          {
            schemaVersion: 1,
            descriptor: descriptors.whenAvailable,
            activation: 'when-available',
          },
        ],
      })
      expect(frozen.assuranceProviderSelections).toEqual([{
        schemaVersion: 1,
        attempt: 1,
        providers: [
          { schemaVersion: 1, descriptor: descriptors.required, activation: 'required' },
          {
            schemaVersion: 1,
            descriptor: descriptors.whenAvailable,
            activation: 'when-available',
          },
        ],
      }])
      expect(receipt).toMatchObject({ revision: 1, status: 'BLOCKED' })
      expect(frozen).toMatchObject({
        revision: 1,
        status: 'BLOCKED',
        writeLease: {
          fencingToken: 1,
          releasedAt: frozen.createdAt,
        },
        blocked: {
          reason: { code: 'assurance_execution_unavailable' },
          resumeStatus: 'CREATED',
        },
        roleRuns: [],
      })

      activations[2]!.providerId = 'caller/mutated-after-start'
      await disabledFiber.dispose()
      await requiredFiber.dispose()
      await whenAvailableFiber.dispose()

      const afterDisposal = await ctx.engineeringControlPlane.status(
        agent,
        receipt.missionId,
        new AbortController().signal,
      )
      expect(afterDisposal.effectivePolicy).toEqual(frozen.effectivePolicy)
      expect(afterDisposal.assuranceProviderSelections).toEqual(frozen.assuranceProviderSelections)

      const replay = await ctx.engineeringControlPlane.start(agent, {
        idempotencyKey: 'provider-selection:start:1',
        objective: 'Freeze exact Host-selected Assurance Providers for Attempt 1',
      }, new AbortController().signal)
      expect(replay).toEqual(receipt)
      await expect(ctx.engineeringControlPlane.resume(agent, {
        missionId: receipt.missionId,
        expectedRevision: receipt.revision,
      }, new AbortController().signal)).rejects.toThrow(
        'Assurance Provider execution is unavailable in this Control Plane build',
      )
    } finally {
      await serviceFiber.dispose()
      await subagentFiber.dispose()
      await subprocessFiber.dispose()
    }
  })

  it('fails closed before Mission acceptance when an exact required Provider is absent', async () => {
    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-required-provider-home-'))
    temporaryRoots.push(home)
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    const serviceFiber = await ctx.plugin(EngineeringControlPlane, config(repository, home, [{
      providerId: 'fixture/missing-required-provider',
      providerVersion: '1.0.0-fixture.1',
      activation: 'required',
    }]))
    await ctx.engineeringControlPlane.whenReady()

    try {
      const agent = {
        id: 'agent-missing-required-provider-fixture',
        session: { header: { cwd: repository } },
      } as unknown as Agent
      await expect(ctx.engineeringControlPlane.start(agent, {
        idempotencyKey: 'missing-required-provider:start:1',
        objective: 'Reject a Mission whose required Assurance Provider is absent',
      }, new AbortController().signal)).rejects.toThrow(
        "Required Assurance Provider 'fixture/missing-required-provider' version '1.0.0-fixture.1' is not registered",
      )
    } finally {
      await serviceFiber.dispose()
      await subagentFiber.dispose()
      await subprocessFiber.dispose()
    }
  })
})
