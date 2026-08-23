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
  AssuranceExecutionContext,
  AssuranceProviderDescriptorV1,
  AssuranceProviderFactoryV1,
  AssuranceRequestV1,
  AssuranceSubmissionArtifactDraftV1,
  ProviderInvocationOptions,
} from '../src/assurance-provider.ts'
import { parseAssuranceProviderDescriptorV1, sealAssuranceSubmissionV1 } from '../src/assurance-provider.ts'
import type { AssuranceProviderActivationConfig, Config } from '../src/config.ts'
import * as clientPlugin from '../src/client.ts'
import * as toolsPlugin from '../src/tools.ts'
import { registerScriptedEngineeringProvider } from './fixtures/scripted-engineering-provider.ts'

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

async function waitForInvocationState(
  ctx: Context,
  agent: Agent,
  missionId: string,
  expected: readonly string[],
) {
  const deadline = Date.now() + 4_000
  let lastState: string | undefined
  while (Date.now() < deadline) {
    const snapshot = await ctx.engineeringControlPlane.status(
      agent,
      missionId,
      new AbortController().signal,
    )
    lastState = snapshot.assuranceProviderInvocations?.[0]?.state
    if (lastState !== undefined && expected.includes(lastState)) return snapshot
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Provider invocation did not reach ${expected.join('/')} (last state: ${lastState ?? 'missing'})`)
}

async function waitForMissionStatus(
  ctx: Context,
  agent: Agent,
  missionId: string,
  expected: readonly string[],
) {
  const deadline = Date.now() + 6_000
  let lastStatus: string | undefined
  let lastInvocationState: string | undefined
  let lastDetails: unknown
  while (Date.now() < deadline) {
    const snapshot = await ctx.engineeringControlPlane.status(
      agent,
      missionId,
      new AbortController().signal,
    )
    lastStatus = snapshot.status
    lastInvocationState = snapshot.assuranceProviderInvocations?.[0]?.state
    lastDetails = { blocked: snapshot.blocked, assuranceResults: snapshot.assuranceResults }
    if (expected.includes(lastStatus)) return snapshot
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(
    `Mission did not reach ${expected.join('/')} (last status: ${lastStatus ?? 'missing'}, Provider: ${lastInvocationState ?? 'missing'}, details: ${JSON.stringify(lastDetails)})`,
  )
}

function satisfiedSubmissionFor(
  context: AssuranceExecutionContext,
  descriptor: AssuranceProviderDescriptorV1,
) {
  const evidence: readonly AssuranceSubmissionArtifactDraftV1[] = [{
    artifactId: 'restart-fixture-evidence-1',
    schemaId: 'fixture/security-evidence',
    schemaVersion: 1,
    value: { check: 'fixture/security-check', outcome: 'satisfied' },
  }]
  const draft = {
    schemaVersion: 1 as const,
    binding: {
      invocationId: context.invocationId,
      missionId: context.missionId,
      attempt: context.attempt,
      provider: descriptor,
      subject: context.subject,
      effectivePolicyDigest: context.effectivePolicyDigest,
    },
    externalAssessment: {
      state: 'sealed' as const,
      assessmentId: 'restart-fixture-assessment-1',
      claimedOutcome: 'satisfied' as const,
    },
    providerComposition: {
      artifactId: 'restart-fixture-composition-1',
      schemaId: 'dsh/assurance-provider-composition',
      schemaVersion: 1 as const,
      value: {
        schemaVersion: 1,
        provider: descriptor,
        components: [{ componentId: 'fixture/recovery-engine', componentVersion: '1.0.0' }],
      },
    },
    providerPolicy: {
      artifactId: 'restart-fixture-policy-1',
      schemaId: 'dsh/assurance-provider-policy',
      schemaVersion: 1 as const,
      value: { schemaVersion: 1, effectivePolicyDigest: context.effectivePolicyDigest },
    },
    coverage: {
      artifactId: 'restart-fixture-coverage-1',
      schemaId: 'dsh/assurance-provider-coverage',
      schemaVersion: 1 as const,
      value: {
        schemaVersion: 1,
        status: 'complete',
        dimensions: [{ dimensionId: 'fixture/security-check', status: 'covered' }],
      },
    },
    provenance: {
      artifactId: 'restart-fixture-provenance-1',
      schemaId: 'dsh/assurance-provider-provenance',
      schemaVersion: 1 as const,
      value: {
        schemaVersion: 1,
        assessor: { kind: 'machine_provider', provider: descriptor },
      },
    },
    evidence,
  }
  const provisional = sealAssuranceSubmissionV1({
    ...draft,
    sourceSeal: {
      artifactId: 'restart-fixture-source-seal-1',
      schemaId: 'dsh/assurance-provider-source-seal',
      schemaVersion: 1,
      value: { schemaVersion: 1, state: 'sealed', subject: context.subject, evidenceDigests: [] },
    },
  })
  return sealAssuranceSubmissionV1({
    ...draft,
    sourceSeal: {
      artifactId: 'restart-fixture-source-seal-1',
      schemaId: 'dsh/assurance-provider-source-seal',
      schemaVersion: 1,
      value: {
        schemaVersion: 1,
        state: 'sealed',
        subject: context.subject,
        evidenceDigests: provisional.payload.evidence.map(item => item.digest.value),
      },
    },
  })
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

function invokingReferenceProviderContributor(
  descriptor: AssuranceProviderDescriptorV1,
  assess: (
    context: AssuranceExecutionContext,
    request: AssuranceRequestV1,
    options?: ProviderInvocationOptions,
  ) => Promise<never>,
) {
  const factory: AssuranceProviderFactoryV1 = normalizedDescriptor => ({
    descriptor: normalizedDescriptor,
    assess,
  })
  return {
    name: 'invoking-reference-assurance-provider',
    inject: ['engineeringControlPlane'],
    apply(ctx: Context) {
      return ctx.engineeringControlPlane.registerAssuranceProvider(descriptor, factory)
    },
  }
}

describe('Assurance Provider startup registration and selection', () => {
  it('admits detached frozen descriptors only during pre-Mission contributor composition', async () => {
    expect(Object.keys(assuranceProviderEntry)).toEqual([
      'parseAssuranceProviderConfigurationV1',
      'parseAssuranceProviderDescriptorV1',
      'sealAssuranceSubmissionV1',
    ])
    expect('registerAssuranceProvider' in toolsPlugin).toBe(false)
    expect('registerAssuranceProvider' in clientPlugin).toBe(false)

    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-provider-home-'))
    temporaryRoots.push(home)
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    registerScriptedEngineeringProvider(ctx.subagents)
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
    registerScriptedEngineeringProvider(ctx.subagents)
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
      expect(receipt).toMatchObject({ revision: 1, status: 'CREATED' })
      expect(frozen).toMatchObject({
        writeLease: {
          fencingToken: 1,
          holderId: expect.any(String),
          acquiredAt: frozen.createdAt,
        },
      })
      expect(frozen.assuranceProviderInvocations).toEqual([
        expect.objectContaining({
          schemaVersion: 1,
          invocationId: expect.any(String),
          attempt: 1,
          descriptor: descriptors.required,
          state: 'prepared',
          preparedAt: frozen.createdAt,
        }),
        expect.objectContaining({
          schemaVersion: 1,
          invocationId: expect.any(String),
          attempt: 1,
          descriptor: descriptors.whenAvailable,
          state: 'prepared',
          preparedAt: frozen.createdAt,
        }),
      ])

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
    registerScriptedEngineeringProvider(ctx.subagents)
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

  it('durably begins an exact Provider with a Kernel-issued non-serializable execution context', async () => {
    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-provider-invocation-home-'))
    temporaryRoots.push(home)
    const descriptor: AssuranceProviderDescriptorV1 = {
      schemaVersion: 1,
      providerId: 'fixture/invoked-provider',
      providerVersion: '1.0.0-fixture.1',
    }
    const providerConfiguration = {
      repositoryId: 'repo-11111111-1111-4111-8111-111111111111',
    }
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    registerScriptedEngineeringProvider(ctx.subagents)
    const serviceFiber = await ctx.plugin(EngineeringControlPlane, config(repository, home, [{
      providerId: descriptor.providerId,
      providerVersion: descriptor.providerVersion,
      activation: 'required',
      configuration: providerConfiguration,
    }]))
    await ctx.engineeringControlPlane.whenReady()

    let observed: {
      readonly context: AssuranceExecutionContext
      readonly request: AssuranceRequestV1
      readonly signal?: AbortSignal
    } | undefined
    let reportInvoked!: () => void
    const invoked = new Promise<void>(resolve => { reportInvoked = resolve })
    const contributorFiber = await ctx.plugin(invokingReferenceProviderContributor(
      descriptor,
      async (context, request, options) => {
        observed = { context, request, ...options?.signal === undefined ? {} : { signal: options.signal } }
        reportInvoked()
        return new Promise<never>((_resolve, reject) => {
          const signal = options?.signal
          if (signal === undefined) return
          const rejectAbort = () => reject(signal.reason ?? new Error('Provider invocation aborted'))
          if (signal.aborted) rejectAbort()
          else signal.addEventListener('abort', rejectAbort, { once: true })
        })
      },
    ))

    try {
      const agent = {
        id: 'agent-provider-invocation-fixture',
        session: { header: { cwd: repository } },
      } as unknown as Agent
      const toolController = new AbortController()
      const receipt = await ctx.engineeringControlPlane.start(agent, {
        idempotencyKey: 'provider-invocation:start:1',
        objective: 'Invoke the exact frozen Assurance Provider through a Kernel-issued context',
      }, toolController.signal)
      await Promise.race([
        invoked,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('Reference Provider was not invoked')), 750)
        }),
      ])
      toolController.abort('tool call ended')

      const snapshot = await ctx.engineeringControlPlane.status(
        agent,
        receipt.missionId,
        new AbortController().signal,
      )
      expect(snapshot.assuranceProviderInvocations).toEqual([expect.objectContaining({
        schemaVersion: 1,
        attempt: 1,
        descriptor,
        state: 'begun',
        preparedAt: snapshot.createdAt,
        begunAt: expect.any(String),
        invocationId: expect.any(String),
      })])
      expect(snapshot).toMatchObject({
        status: 'IMPLEMENTING',
      })
      expect(snapshot.roleRuns.map(run => run.role)).toEqual(['planner', 'developer'])
      expect(snapshot.assuranceSubjects).toHaveLength(1)

      const invocation = observed
      expect(invocation).toBeDefined()
      const context = invocation!.context as AssuranceExecutionContext & Record<string, unknown>
      expect(context).toMatchObject({
        schemaVersion: 1,
        invocationId: snapshot.assuranceProviderInvocations![0]!.invocationId,
        missionId: receipt.missionId,
        attempt: 1,
        effectivePolicyDigest: snapshot.effectivePolicyDigest,
        subject: {
          kind: 'git_worktree',
          branch: snapshot.repository.branch,
          head: snapshot.repository.head,
          workspaceFingerprint: snapshot.repository.workspaceFingerprint,
        },
      })
      expect('canonicalRoot' in context).toBe(false)
      expect('store' in context).toBe(false)
      expect('gate' in context).toBe(false)
      expect('ledger' in context).toBe(false)
      expect(Object.isFrozen(context)).toBe(true)
      expect(Object.isFrozen(context.subject)).toBe(true)
      expect(() => JSON.stringify(context)).toThrow('Assurance Execution Context cannot be serialized')
      expect(() => structuredClone(context)).toThrow()
      expect(invocation!.request).toEqual({
        schemaVersion: 1,
        configuration: providerConfiguration,
      })
      expect(Object.isFrozen(invocation!.request)).toBe(true)
      expect(Object.isFrozen(invocation!.request.configuration)).toBe(true)
      expect(invocation!.signal).toBeInstanceOf(AbortSignal)
      expect(invocation!.signal).not.toBe(toolController.signal)
      expect(invocation!.signal?.aborted).toBe(false)
    } finally {
      await contributorFiber.dispose()
      await serviceFiber.dispose()
      await subagentFiber.dispose()
      await subprocessFiber.dispose()
    }
  })

  it('marks a frozen Provider unavailable without calling or silently retrying it after registration loss', async () => {
    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-provider-loss-home-'))
    temporaryRoots.push(home)
    const descriptor: AssuranceProviderDescriptorV1 = {
      schemaVersion: 1,
      providerId: 'fixture/disappearing-provider',
      providerVersion: '1.0.0-fixture.1',
    }
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    registerScriptedEngineeringProvider(ctx.subagents)
    const serviceFiber = await ctx.plugin(EngineeringControlPlane, config(repository, home, [{
      providerId: descriptor.providerId,
      providerVersion: descriptor.providerVersion,
      activation: 'required',
    }]))
    await ctx.engineeringControlPlane.whenReady()

    let disposeRegistration: (() => void) | undefined
    let factoryCalls = 0
    let assessCalls = 0
    const contributorFiber = await ctx.plugin({
      name: 'disappearing-reference-assurance-provider',
      inject: ['engineeringControlPlane'],
      apply(contributorContext: Context) {
        disposeRegistration = contributorContext.engineeringControlPlane.registerAssuranceProvider(
          descriptor,
          normalizedDescriptor => {
            factoryCalls++
            disposeRegistration?.()
            return {
              descriptor: normalizedDescriptor,
              assess() {
                assessCalls++
                return new Promise<never>(() => {})
              },
            }
          },
        )
        return () => disposeRegistration?.()
      },
    })

    try {
      const agent = {
        id: 'agent-provider-loss-fixture',
        session: { header: { cwd: repository } },
      } as unknown as Agent
      const request = {
        idempotencyKey: 'provider-loss:start:1',
        objective: 'Fail closed when the exact frozen Provider disappears before invocation',
      }
      const receipt = await ctx.engineeringControlPlane.start(
        agent,
        request,
        new AbortController().signal,
      )
      const snapshot = await waitForInvocationState(
        ctx,
        agent,
        receipt.missionId,
        ['unavailable'],
      )

      expect(snapshot.assuranceProviderInvocations).toEqual([expect.objectContaining({
        schemaVersion: 1,
        invocationId: expect.any(String),
        attempt: 1,
        descriptor,
        state: 'unavailable',
        failureCode: 'registration_missing',
        unavailableAt: expect.any(String),
      })])
      expect(snapshot.roleRuns.map(run => run.role)).toEqual(
        expect.arrayContaining(['planner', 'developer']),
      )
      expect(factoryCalls).toBe(1)
      expect(assessCalls).toBe(0)

      const replay = await ctx.engineeringControlPlane.start(
        agent,
        request,
        new AbortController().signal,
      )
      expect(replay).toMatchObject({ missionId: receipt.missionId, attempt: 1 })
      expect(factoryCalls).toBe(1)
      expect(assessCalls).toBe(0)
    } finally {
      await contributorFiber.dispose()
      await serviceFiber.dispose()
      await subagentFiber.dispose()
      await subprocessFiber.dispose()
    }
  })

  it('recovers a begun Provider invocation only after an explicit Mission resume without replaying assess', async () => {
    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-provider-restart-home-'))
    temporaryRoots.push(home)
    const descriptor: AssuranceProviderDescriptorV1 = {
      schemaVersion: 1,
      providerId: 'fixture/restart-provider',
      providerVersion: '1.0.0-fixture.1',
    }
    const activation: AssuranceProviderActivationConfig = {
      providerId: descriptor.providerId,
      providerVersion: descriptor.providerVersion,
      activation: 'required',
    }
    const request = {
      idempotencyKey: 'provider-restart:start:1',
      objective: 'Never silently replay a Provider invocation that durably began',
    }
    const agent = {
      id: 'agent-provider-restart-fixture',
      session: { header: { cwd: repository } },
    } as unknown as Agent

    const firstContext = new Context()
    const firstSubprocessFiber = await firstContext.plugin(LocalSubprocessRuntime)
    const firstSubagentFiber = await firstContext.plugin(SubagentRuntime)
    registerScriptedEngineeringProvider(firstContext.subagents)
    const firstServiceFiber = await firstContext.plugin(
      EngineeringControlPlane,
      config(repository, home, [activation]),
    )
    await firstContext.engineeringControlPlane.whenReady()
    let firstAssessCalls = 0
    const firstContributorFiber = await firstContext.plugin(invokingReferenceProviderContributor(
      descriptor,
      async (_context, _request, options) => {
        firstAssessCalls++
        return new Promise<never>((_resolve, reject) => {
          const signal = options?.signal
          if (signal === undefined) return
          const rejectAbort = () => reject(signal.reason ?? new Error('Provider invocation aborted'))
          if (signal.aborted) rejectAbort()
          else signal.addEventListener('abort', rejectAbort, { once: true })
        })
      },
    ))

    let firstReceipt
    try {
      firstReceipt = await firstContext.engineeringControlPlane.start(
        agent,
        request,
        new AbortController().signal,
      )
      await waitForInvocationState(
        firstContext,
        agent,
        firstReceipt.missionId,
        ['begun'],
      )
      expect(firstAssessCalls).toBe(1)
    } finally {
      await firstContributorFiber.dispose()
      await firstServiceFiber.dispose()
      await firstSubagentFiber.dispose()
      await firstSubprocessFiber.dispose()
    }

    const secondContext = new Context()
    const secondSubprocessFiber = await secondContext.plugin(LocalSubprocessRuntime)
    const secondSubagentFiber = await secondContext.plugin(SubagentRuntime)
    registerScriptedEngineeringProvider(secondContext.subagents)
    const secondServiceFiber = await secondContext.plugin(
      EngineeringControlPlane,
      config(repository, home, [activation]),
    )
    await secondContext.engineeringControlPlane.whenReady()
    let secondFactoryCalls = 0
    let secondAssessCalls = 0
    let secondRecoverCalls = 0
    const secondContributorFiber = await secondContext.plugin({
      name: 'restart-reference-assurance-provider',
      inject: ['engineeringControlPlane'],
      apply(contributorContext: Context) {
        return contributorContext.engineeringControlPlane.registerAssuranceProvider(
          descriptor,
          normalizedDescriptor => {
            secondFactoryCalls++
            return {
              descriptor: normalizedDescriptor,
              assess() {
                secondAssessCalls++
                return new Promise<never>(() => {})
              },
              async recover(context: AssuranceExecutionContext) {
                secondRecoverCalls++
                return {
                  kind: 'sealed_submission' as const,
                  submission: satisfiedSubmissionFor(context, normalizedDescriptor),
                }
              },
            }
          },
        )
      },
    })

    try {
      const replay = await secondContext.engineeringControlPlane.start(
        agent,
        request,
        new AbortController().signal,
      )
      const snapshot = await secondContext.engineeringControlPlane.status(
        agent,
        replay.missionId,
        new AbortController().signal,
      )

      expect(replay).toMatchObject({ missionId: firstReceipt.missionId, attempt: 1 })
      expect(secondFactoryCalls).toBe(0)
      expect(secondAssessCalls).toBe(0)
      expect(snapshot.assuranceProviderInvocations).toEqual([expect.objectContaining({
        schemaVersion: 1,
        invocationId: expect.any(String),
        attempt: 1,
        descriptor,
        state: 'begun',
        begunAt: expect.any(String),
      })])
      expect(snapshot.status).toBe('BLOCKED')
      expect(snapshot.roleRuns.map(run => run.role)).toEqual(['planner', 'developer'])

      await secondContext.engineeringControlPlane.resume(agent, {
        missionId: snapshot.missionId,
        expectedRevision: snapshot.revision,
        supplementalContext: 'Explicitly reconcile the durable Provider invocation after restart.',
      }, new AbortController().signal)
      const recovered = await waitForMissionStatus(
        secondContext,
        agent,
        snapshot.missionId,
        ['APPROVED', 'REWORK_REQUIRED'],
      )

      expect(secondFactoryCalls).toBe(1)
      expect(secondAssessCalls).toBe(0)
      expect(secondRecoverCalls).toBe(1)
      expect(recovered.status).toBe('APPROVED')
      expect(recovered.assuranceProviderInvocations).toEqual([expect.objectContaining({
        state: 'settled',
        outcome: expect.objectContaining({
          kind: 'sealed_submission',
          claimedOutcome: 'satisfied',
        }),
      })])
    } finally {
      await secondContributorFiber.dispose()
      await secondServiceFiber.dispose()
      await secondSubagentFiber.dispose()
      await secondSubprocessFiber.dispose()
    }
  }, 10_000)

  it('records external Provider quiescence before committing explicit Mission cancellation', async () => {
    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-provider-cancel-home-'))
    temporaryRoots.push(home)
    const descriptor: AssuranceProviderDescriptorV1 = {
      schemaVersion: 1,
      providerId: 'fixture/cancel-provider',
      providerVersion: '1.0.0-fixture.1',
    }
    const activation: AssuranceProviderActivationConfig = {
      providerId: descriptor.providerId,
      providerVersion: descriptor.providerVersion,
      activation: 'required',
    }
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    registerScriptedEngineeringProvider(ctx.subagents)
    const serviceFiber = await ctx.plugin(
      EngineeringControlPlane,
      config(repository, home, [activation]),
    )
    await ctx.engineeringControlPlane.whenReady()
    const contributorFiber = await ctx.plugin({
      name: 'cancel-reference-assurance-provider',
      inject: ['engineeringControlPlane'],
      apply(contributorContext: Context) {
        return contributorContext.engineeringControlPlane.registerAssuranceProvider(
          descriptor,
          normalizedDescriptor => ({
            descriptor: normalizedDescriptor,
            assess(_context, _request, options) {
              return new Promise<never>((_resolve, reject) => {
                const signal = options?.signal
                if (signal === undefined) return
                const rejectAbort = () => reject(signal.reason ?? new Error('Provider invocation aborted'))
                if (signal.aborted) rejectAbort()
                else signal.addEventListener('abort', rejectAbort, { once: true })
              })
            },
            async cancel() {
              return {
                kind: 'external_assessment_canceled' as const,
                externalAssessmentId: 'fixture-canceled-assessment-1',
              }
            },
          }),
        )
      },
    })

    try {
      const agent = {
        id: 'agent-provider-cancel-fixture',
        session: { header: { cwd: repository } },
      } as unknown as Agent
      const receipt = await ctx.engineeringControlPlane.start(agent, {
        idempotencyKey: 'provider-cancel:start:1',
        objective: 'Prove external Provider quiescence before Mission cancellation',
      }, new AbortController().signal)
      const begun = await waitForInvocationState(ctx, agent, receipt.missionId, ['begun'])

      await ctx.engineeringControlPlane.cancel(agent, {
        missionId: begun.missionId,
        expectedRevision: begun.revision,
        reason: 'The operator explicitly canceled this governed Mission.',
      }, new AbortController().signal)
      const canceled = await ctx.engineeringControlPlane.status(
        agent,
        begun.missionId,
        new AbortController().signal,
      )

      expect(canceled.status).toBe('CANCELLED')
      expect(canceled.assuranceProviderInvocations).toEqual([expect.objectContaining({
        descriptor,
        state: 'terminated',
        terminatedAt: expect.any(String),
        outcome: {
          kind: 'external_assessment_canceled',
          externalAssessmentId: 'fixture-canceled-assessment-1',
        },
      })])
    } finally {
      await contributorFiber.dispose()
      await serviceFiber.dispose()
      await subagentFiber.dispose()
      await subprocessFiber.dispose()
    }
  })
})
