import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it } from 'vitest'
import EngineeringControlPlane from '../src/index.ts'
import {
  sealAssuranceSubmissionV1,
  type AssuranceClaimedOutcomeV1,
  type AssuranceExecutionContext,
  type AssuranceProviderDescriptorV1,
  type AssuranceProviderOutcomeV1,
  type AssuranceSubmissionRejectionCode,
  type AssuranceSubmissionV1,
} from '../src/assurance-provider.ts'
import type { Config } from '../src/config.ts'
import { registerScriptedEngineeringProvider } from './fixtures/scripted-engineering-provider.ts'

const run = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function cleanRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-control-plane-submission-repo-'))
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
  descriptor: AssuranceProviderDescriptorV1,
  maxRecordBytes?: number,
): Config {
  return configForDescriptors(repository, home, [descriptor], maxRecordBytes)
}

function configForDescriptors(
  repository: string,
  home: string,
  descriptors: readonly AssuranceProviderDescriptorV1[],
  maxRecordBytes?: number,
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
      verificationProfile: 'submission-fixture',
      assuranceProviders: descriptors.map(descriptor => ({
        providerId: descriptor.providerId,
        providerVersion: descriptor.providerVersion,
        activation: 'required',
      })),
    }],
    verificationProfiles: [{
      name: 'submission-fixture',
      categories: {
        functional: notApplicable,
        negative: notApplicable,
        regression: notApplicable,
        security: notApplicable,
      },
    }],
    ...maxRecordBytes === undefined ? {} : { artifactBudgets: { maxRecordBytes } },
  }
}

function submissionFor(
  context: AssuranceExecutionContext,
  descriptor: AssuranceProviderDescriptorV1,
  claimedOutcome: AssuranceClaimedOutcomeV1 = 'satisfied',
): AssuranceSubmissionV1 {
  const evidence = [{
    artifactId: 'fixture-evidence-1',
    schemaId: 'fixture/provider-evidence',
    schemaVersion: 1 as const,
    value: { check: 'fixture/check', outcome: 'passed' },
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
      assessmentId: 'fixture-assessment-1',
      claimedOutcome,
    },
    providerComposition: {
      artifactId: 'fixture-composition-1',
      schemaId: 'dsh/assurance-provider-composition',
      schemaVersion: 1,
      value: {
        schemaVersion: 1,
        provider: descriptor,
        components: [{ componentId: 'fixture/reference-fake', componentVersion: '1.0.0-fixture.1' }],
      },
    },
    providerPolicy: {
      artifactId: 'fixture-policy-1',
      schemaId: 'dsh/assurance-provider-policy',
      schemaVersion: 1,
      value: { schemaVersion: 1, effectivePolicyDigest: context.effectivePolicyDigest },
    },
    coverage: {
      artifactId: 'fixture-coverage-1',
      schemaId: 'dsh/assurance-provider-coverage',
      schemaVersion: 1,
      value: {
        schemaVersion: 1,
        status: 'complete',
        dimensions: [{ dimensionId: 'fixture/check', status: 'covered' }],
      },
    },
    provenance: {
      artifactId: 'fixture-provenance-1',
      schemaId: 'dsh/assurance-provider-provenance',
      schemaVersion: 1,
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
      artifactId: 'fixture-source-seal-1',
      schemaId: 'dsh/assurance-provider-source-seal',
      schemaVersion: 1,
      value: {
        schemaVersion: 1,
        state: 'sealed',
        subject: context.subject,
        evidenceDigests: [],
      },
    },
  })
  return sealAssuranceSubmissionV1({
    ...draft,
    sourceSeal: {
      artifactId: 'fixture-source-seal-1',
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

async function waitForTerminalInvocation(
  ctx: Context,
  agent: Agent,
  missionId: string,
) {
  const deadline = Date.now() + 15_000
  let lastStates: readonly string[] = []
  while (Date.now() < deadline) {
    const snapshot = await ctx.engineeringControlPlane.status(
      agent,
      missionId,
      new AbortController().signal,
    )
    const state = snapshot.assuranceProviderInvocations?.[0]?.state
    lastStates = state === undefined ? [] : [state]
    if (state === 'settled' || state === 'rejected' || state === 'import_failed') return snapshot
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Assurance Provider invocation did not reach a durable terminal state: ${lastStates.join(',')}`)
}

async function waitForAllTerminalInvocations(
  ctx: Context,
  agent: Agent,
  missionId: string,
) {
  const deadline = Date.now() + 15_000
  let lastStates: readonly string[] = []
  while (Date.now() < deadline) {
    const snapshot = await ctx.engineeringControlPlane.status(
      agent,
      missionId,
      new AbortController().signal,
    )
    const invocations = snapshot.assuranceProviderInvocations ?? []
    lastStates = invocations.map(record => record.state)
    if (
      invocations.length > 0
      && invocations.every(record => (
        record.state === 'settled'
        || record.state === 'rejected'
        || record.state === 'import_failed'
      ))
    ) return snapshot
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Assurance Provider invocations did not all reach durable terminal states: ${lastStates.join(',')}`)
}

async function waitForBlockedMission(
  ctx: Context,
  agent: Agent,
  missionId: string,
) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const snapshot = await ctx.engineeringControlPlane.status(
      agent,
      missionId,
      new AbortController().signal,
    )
    if (snapshot.status === 'BLOCKED') return snapshot
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Mission did not reach BLOCKED')
}

async function waitForGateDecision(
  ctx: Context,
  agent: Agent,
  missionId: string,
) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const snapshot = await ctx.engineeringControlPlane.status(
      agent,
      missionId,
      new AbortController().signal,
    )
    if (snapshot.gate !== undefined) return snapshot
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Mission did not persist a Gate decision')
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Fixture expected an object')
  }
  return value as Record<string, unknown>
}

const rejectionCases: readonly {
  readonly name: string
  readonly failureCode: AssuranceSubmissionRejectionCode
  readonly mutate: (candidate: Record<string, unknown>) => void
  readonly outcomeKind?: string
  readonly maxRecordBytes?: number
}[] = [
  {
    name: 'an unknown Provider outcome kind',
    failureCode: 'malformed_submission',
    mutate: () => {},
    outcomeKind: 'fixture_unknown_outcome',
  },
  {
    name: 'a Submission that exceeds its frozen byte budget',
    failureCode: 'submission_too_large',
    mutate: candidate => { candidate.oversizePadding = 'x'.repeat(32 * 1024) },
    maxRecordBytes: 16 * 1024,
  },
  {
    name: 'an unknown field',
    failureCode: 'malformed_submission',
    mutate: candidate => { candidate.kernelWriter = true },
  },
  {
    name: 'a missing transport seal',
    failureCode: 'unsealed_submission',
    mutate: candidate => { delete candidate.digest },
  },
  {
    name: 'an unsupported Submission schema',
    failureCode: 'unsupported_schema',
    mutate: candidate => { candidate.schemaVersion = 2 },
  },
  {
    name: 'an Invocation mismatch',
    failureCode: 'invocation_mismatch',
    mutate: candidate => {
      object(object(candidate.payload).binding).invocationId = 'other-invocation'
    },
  },
  {
    name: 'a Mission mismatch',
    failureCode: 'mission_mismatch',
    mutate: candidate => {
      object(object(candidate.payload).binding).missionId = 'mission-other'
    },
  },
  {
    name: 'an Attempt mismatch',
    failureCode: 'attempt_mismatch',
    mutate: candidate => { object(object(candidate.payload).binding).attempt = 2 },
  },
  {
    name: 'a Provider mismatch',
    failureCode: 'provider_mismatch',
    mutate: candidate => {
      object(object(object(candidate.payload).binding).provider).providerId = 'fixture/other-provider'
    },
  },
  {
    name: 'a Subject mismatch',
    failureCode: 'subject_mismatch',
    mutate: candidate => {
      object(object(object(candidate.payload).binding).subject).head = 'f'.repeat(40)
    },
  },
  {
    name: 'an Effective Policy mismatch',
    failureCode: 'policy_mismatch',
    mutate: candidate => {
      object(object(candidate.payload).binding).effectivePolicyDigest = 'sha256:' + '0'.repeat(64)
    },
  },
  {
    name: 'a sensitive field that would change during import',
    failureCode: 'redacted_submission',
    mutate: candidate => {
      const evidence = object(candidate.payload).evidence
      if (!Array.isArray(evidence)) throw new TypeError('Fixture Evidence must be an array')
      object(object(evidence[0]).value).password = 'must-not-persist'
    },
  },
  {
    name: 'a credential field outside the legacy denylist',
    failureCode: 'redacted_submission',
    mutate: candidate => {
      const evidence = object(candidate.payload).evidence
      if (!Array.isArray(evidence)) throw new TypeError('Fixture Evidence must be an array')
      object(object(evidence[0]).value).credential = 'must-not-persist'
    },
  },
  {
    name: 'a private key hidden under a generic field',
    failureCode: 'redacted_submission',
    mutate: candidate => {
      const evidence = object(candidate.payload).evidence
      if (!Array.isArray(evidence)) throw new TypeError('Fixture Evidence must be an array')
      object(object(evidence[0]).value).data = [
        '-----BEGIN PRIVATE KEY-----',
        'fixture-private-material',
        '-----END PRIVATE KEY-----',
      ].join('\n')
    },
  },
  {
    name: 'a bare high-entropy credential candidate',
    failureCode: 'redacted_submission',
    mutate: candidate => {
      const evidence = object(candidate.payload).evidence
      if (!Array.isArray(evidence)) throw new TypeError('Fixture Evidence must be an array')
      object(object(evidence[0]).value).data = 'aB3dE5fG7hI9jK1mN2pQ4rS6tU8vW0xYz-_+='
    },
  },
  {
    name: 'a credential encoded as an artifact property name',
    failureCode: 'redacted_submission',
    mutate: candidate => {
      const evidence = object(candidate.payload).evidence
      if (!Array.isArray(evidence)) throw new TypeError('Fixture Evidence must be an array')
      object(object(evidence[0]).value)['sk-aB3dE5fG7hI9jK1mN2pQ4rS6'] = true
    },
  },
  {
    name: 'a credential encoded as the Provider assessment id',
    failureCode: 'redacted_submission',
    mutate: candidate => {
      object(object(candidate.payload).externalAssessment).assessmentId = 'sk-abcdefghijklmnopqrst'
    },
  },
  {
    name: 'a credential encoded as an artifact id',
    failureCode: 'redacted_submission',
    mutate: candidate => {
      const evidence = object(candidate.payload).evidence
      if (!Array.isArray(evidence)) throw new TypeError('Fixture Evidence must be an array')
      object(evidence[0]).artifactId = 'sk-abcdefghijklmnopqrst'
    },
  },
  {
    name: 'a JWT-shaped credential under a generic field',
    failureCode: 'redacted_submission',
    mutate: candidate => {
      const evidence = object(candidate.payload).evidence
      if (!Array.isArray(evidence)) throw new TypeError('Fixture Evidence must be an array')
      object(object(evidence[0]).value).data = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJlLWZpeHR1cmU'
    },
  },
  {
    name: 'a JWT-shaped credential disguised as an Evidence signature',
    failureCode: 'redacted_submission',
    mutate: candidate => {
      const evidence = object(candidate.payload).evidence
      if (!Array.isArray(evidence)) throw new TypeError('Fixture Evidence must be an array')
      object(object(evidence[0]).value).signature = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJlLWZpeHR1cmU'
    },
  },
  {
    name: 'hexadecimal credential material under a generic field',
    failureCode: 'redacted_submission',
    mutate: candidate => {
      const evidence = object(candidate.payload).evidence
      if (!Array.isArray(evidence)) throw new TypeError('Fixture Evidence must be an array')
      object(object(evidence[0]).value).data = '0123456789abcdef'.repeat(4)
    },
  },
  {
    name: 'an embedded Evidence digest mismatch',
    failureCode: 'digest_mismatch',
    mutate: candidate => {
      const evidence = object(candidate.payload).evidence
      if (!Array.isArray(evidence)) throw new TypeError('Fixture Evidence must be an array')
      object(evidence[0]).value = { check: 'fixture/check', outcome: 'caller-mutated' }
    },
  },
  {
    name: 'an outer payload digest mismatch',
    failureCode: 'digest_mismatch',
    mutate: candidate => {
      object(object(candidate.payload).externalAssessment).claimedOutcome = 'failed'
    },
  },
]

describe('Assurance Provider Submission import', { timeout: 45_000 }, () => {
  it('imports one valid sealed Reference Fake Submission before Kernel-owned Gate evaluation', async () => {
    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-submission-home-'))
    temporaryRoots.push(home)
    const descriptor: AssuranceProviderDescriptorV1 = {
      schemaVersion: 1,
      providerId: 'fixture/submission-provider',
      providerVersion: '1.0.0-fixture.1',
    }
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    registerScriptedEngineeringProvider(ctx.subagents)
    const serviceFiber = await ctx.plugin(EngineeringControlPlane, config(repository, home, descriptor))
    await ctx.engineeringControlPlane.whenReady()

    let returnedSubmission: Record<string, unknown> | undefined
    const contributorFiber = await ctx.plugin({
      name: 'sealed-submission-reference-provider',
      inject: ['engineeringControlPlane'],
      apply(contributorContext: Context) {
        return contributorContext.engineeringControlPlane.registerAssuranceProvider(
          descriptor,
          normalizedDescriptor => ({
            descriptor: normalizedDescriptor,
            async assess(context): Promise<AssuranceProviderOutcomeV1> {
              const detached = JSON.parse(JSON.stringify(
                submissionFor(context, normalizedDescriptor),
              )) as Record<string, unknown>
              returnedSubmission = detached
              return {
                kind: 'sealed_submission',
                submission: detached as unknown as AssuranceSubmissionV1,
              }
            },
          }),
        )
      },
    })

    try {
      const agent = {
        id: 'agent-submission-fixture',
        session: { header: { cwd: repository } },
      } as unknown as Agent
      const receipt = await ctx.engineeringControlPlane.start(agent, {
        idempotencyKey: 'submission:start:1',
        objective: 'Import a sealed Reference Fake Submission by value',
      }, new AbortController().signal)
      const imported = await waitForTerminalInvocation(ctx, agent, receipt.missionId)
      const invocation = imported.assuranceProviderInvocations?.[0]

      expect(invocation).toMatchObject({
        schemaVersion: 1,
        attempt: 1,
        descriptor,
        state: 'settled',
        settledAt: expect.any(String),
        outcome: {
          kind: 'sealed_submission',
          claimedOutcome: 'satisfied',
          submissionDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
          evidenceRecordId: expect.any(String),
        },
      })
      expect(imported.evidence.records).toContainEqual(expect.objectContaining({
        recordId: invocation?.state === 'settled'
          ? invocation.outcome.evidenceRecordId
          : 'unreachable',
        missionId: receipt.missionId,
        attempt: 1,
        kind: 'assurance-provider-submission',
        schemaVersion: 1,
        digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        redacted: false,
      }))
      if (invocation?.state !== 'settled') throw new Error('Fixture invocation did not settle')
      expect(invocation.outcome.submissionDigest).toBe(
        object(returnedSubmission?.digest).value,
      )
      const evidenceRecord = imported.evidence.records.find(record => (
        record.recordId === invocation.outcome.evidenceRecordId
      ))
      if (evidenceRecord === undefined) throw new Error('Fixture Submission Evidence is missing')
      const evidencePath = join(
        home,
        'control-plane',
        'missions',
        ...evidenceRecord.relativePath.split('/'),
      )
      const importedEnvelopeText = await readFile(evidencePath, 'utf8')
      const importedSubmission = object(object(JSON.parse(importedEnvelopeText)).payload)
      expect(object(object(importedSubmission.payload).externalAssessment)).toMatchObject({
        state: 'sealed',
        claimedOutcome: 'satisfied',
      })
      expect(object(object(importedSubmission.payload).providerComposition).value).toEqual({
        schemaVersion: 1,
        provider: descriptor,
        components: [{ componentId: 'fixture/reference-fake', componentVersion: '1.0.0-fixture.1' }],
      })
      expect(object(importedSubmission.digest).value).toBe(invocation.outcome.submissionDigest)

      const durableInvocation = structuredClone(invocation)
      const durableEvidenceRecord = structuredClone(evidenceRecord)
      const payload = returnedSubmission?.payload as Record<string, unknown>
      const externalAssessment = payload.externalAssessment as Record<string, unknown>
      externalAssessment.claimedOutcome = 'failed'
      payload.providerComposition = { callerMutation: true }

      const afterCallerMutation = await ctx.engineeringControlPlane.status(
        agent,
        receipt.missionId,
        new AbortController().signal,
      )
      expect(afterCallerMutation.assuranceProviderInvocations?.[0]).toEqual(durableInvocation)
      expect(afterCallerMutation.evidence.records).toContainEqual(durableEvidenceRecord)
      expect(JSON.stringify(afterCallerMutation)).not.toContain('callerMutation')
      expect(await readFile(evidencePath, 'utf8')).toBe(importedEnvelopeText)
      const decided = await waitForGateDecision(ctx, agent, receipt.missionId)
      expect(decided).toMatchObject({
        status: 'APPROVED',
        assuranceResults: [{ outcome: 'satisfied' }],
        gate: { kind: 'approved', reasons: [] },
      })
    } finally {
      await contributorFiber.dispose()
      await serviceFiber.dispose()
      await subagentFiber.dispose()
      await subprocessFiber.dispose()
    }
  })

  it('binds import to the frozen Invocation descriptor after the Provider mutates its runtime object', async () => {
    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-mutated-provider-home-'))
    temporaryRoots.push(home)
    const descriptor: AssuranceProviderDescriptorV1 = {
      schemaVersion: 1,
      providerId: 'fixture/mutable-runtime-provider',
      providerVersion: '1.0.0-fixture.1',
    }
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    registerScriptedEngineeringProvider(ctx.subagents)
    const serviceFiber = await ctx.plugin(EngineeringControlPlane, config(repository, home, descriptor))
    await ctx.engineeringControlPlane.whenReady()
    const contributorFiber = await ctx.plugin({
      name: 'mutable-runtime-reference-provider',
      inject: ['engineeringControlPlane'],
      apply(contributorContext: Context) {
        return contributorContext.engineeringControlPlane.registerAssuranceProvider(
          descriptor,
          normalizedDescriptor => {
            const runtimeDescriptor = { ...normalizedDescriptor }
            return {
              descriptor: runtimeDescriptor,
              async assess(context): Promise<AssuranceProviderOutcomeV1> {
                const submission = submissionFor(context, normalizedDescriptor)
                runtimeDescriptor.providerId = 'fixture/mutated-after-resolution'
                return { kind: 'sealed_submission', submission }
              },
            }
          },
        )
      },
    })

    try {
      const agent = {
        id: 'agent-mutable-runtime-provider-fixture',
        session: { header: { cwd: repository } },
      } as unknown as Agent
      const receipt = await ctx.engineeringControlPlane.start(agent, {
        idempotencyKey: 'mutable-runtime-provider:start:1',
        objective: 'Never trust a Provider descriptor again after exact resolution',
      }, new AbortController().signal)
      const imported = await waitForTerminalInvocation(ctx, agent, receipt.missionId)

      expect(imported.assuranceProviderInvocations).toEqual([expect.objectContaining({
        descriptor,
        state: 'settled',
        outcome: {
          kind: 'sealed_submission',
          claimedOutcome: 'satisfied',
          submissionDigest: expect.any(String),
          evidenceRecordId: expect.any(String),
        },
      })])
      expect(imported.evidence.records.filter(record => (
        record.kind === 'assurance-provider-submission'
      ))).toHaveLength(1)
      expect(JSON.stringify(imported)).not.toContain('mutated-after-resolution')
    } finally {
      await contributorFiber.dispose()
      await serviceFiber.dispose()
      await subagentFiber.dispose()
      await subprocessFiber.dispose()
    }
  })

  it('does not invoke a Provider before implementation Evidence can be published', async () => {
    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-publication-failure-home-'))
    temporaryRoots.push(home)
    await mkdir(join(home, 'control-plane'), { recursive: true })
    await writeFile(join(home, 'control-plane', 'missions'), 'not-a-directory', 'utf8')
    const descriptor: AssuranceProviderDescriptorV1 = {
      schemaVersion: 1,
      providerId: 'fixture/publication-failure-provider',
      providerVersion: '1.0.0-fixture.1',
    }
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    registerScriptedEngineeringProvider(ctx.subagents)
    const serviceFiber = await ctx.plugin(EngineeringControlPlane, config(repository, home, descriptor))
    await ctx.engineeringControlPlane.whenReady()
    const contributorFiber = await ctx.plugin({
      name: 'publication-failure-reference-provider',
      inject: ['engineeringControlPlane'],
      apply(contributorContext: Context) {
        return contributorContext.engineeringControlPlane.registerAssuranceProvider(
          descriptor,
          normalizedDescriptor => ({
            descriptor: normalizedDescriptor,
            async assess(context): Promise<AssuranceProviderOutcomeV1> {
              return {
                kind: 'sealed_submission',
                submission: submissionFor(context, normalizedDescriptor),
              }
            },
          }),
        )
      },
    })

    try {
      const agent = {
        id: 'agent-publication-failure-fixture',
        session: { header: { cwd: repository } },
      } as unknown as Agent
      const receipt = await ctx.engineeringControlPlane.start(agent, {
        idempotencyKey: 'publication-failure:start:1',
        objective: 'Preserve operational indeterminacy when local Evidence publication fails',
      }, new AbortController().signal)
      const failed = await waitForBlockedMission(ctx, agent, receipt.missionId)

      expect(failed.assuranceProviderInvocations).toEqual([expect.objectContaining({
        descriptor,
        state: 'prepared',
      })])
      expect(failed.evidence.records.some(record => (
        record.kind === 'assurance-provider-submission'
      ))).toBe(false)
      expect(failed.status).toBe('BLOCKED')
      expect(failed.assuranceSubjects ?? []).toEqual([])
    } finally {
      await contributorFiber.dispose()
      await serviceFiber.dispose()
      await subagentFiber.dispose()
      await subprocessFiber.dispose()
    }
  }, 10_000)

  it('settles two immediately fulfilled Providers without losing an admission revision race', async () => {
    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-concurrent-submission-home-'))
    temporaryRoots.push(home)
    const descriptors: readonly AssuranceProviderDescriptorV1[] = [
      {
        schemaVersion: 1,
        providerId: 'fixture/concurrent-provider-a',
        providerVersion: '1.0.0-fixture.1',
      },
      {
        schemaVersion: 1,
        providerId: 'fixture/concurrent-provider-b',
        providerVersion: '1.0.0-fixture.1',
      },
    ]
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    registerScriptedEngineeringProvider(ctx.subagents)
    const serviceFiber = await ctx.plugin(
      EngineeringControlPlane,
      configForDescriptors(repository, home, descriptors),
    )
    await ctx.engineeringControlPlane.whenReady()
    const contributorFiber = await ctx.plugin({
      name: 'concurrent-submission-reference-providers',
      inject: ['engineeringControlPlane'],
      apply(contributorContext: Context) {
        const disposers = descriptors.map(descriptor => (
          contributorContext.engineeringControlPlane.registerAssuranceProvider(
            descriptor,
            normalizedDescriptor => ({
              descriptor: normalizedDescriptor,
              async assess(context): Promise<AssuranceProviderOutcomeV1> {
                return {
                  kind: 'sealed_submission',
                  submission: submissionFor(
                    context,
                    normalizedDescriptor,
                    normalizedDescriptor.providerId.endsWith('-a') ? 'failed' : 'indeterminate',
                  ),
                }
              },
            }),
          )
        ))
        return () => { for (const dispose of disposers) dispose() }
      },
    })

    try {
      const agent = {
        id: 'agent-concurrent-submission-fixture',
        session: { header: { cwd: repository } },
      } as unknown as Agent
      const receipt = await ctx.engineeringControlPlane.start(agent, {
        idempotencyKey: 'concurrent-submission:start:1',
        objective: 'Settle every exact frozen Provider despite concurrent revision changes',
      }, new AbortController().signal)
      const settled = await waitForAllTerminalInvocations(ctx, agent, receipt.missionId)

      expect(settled.assuranceProviderInvocations).toHaveLength(2)
      expect(settled.assuranceProviderInvocations?.map(record => record.state)).toEqual([
        'settled',
        'settled',
      ])
      expect(settled.assuranceProviderInvocations?.map(record => (
        record.state === 'settled' ? record.outcome.claimedOutcome : 'not-settled'
      ))).toEqual(['failed', 'indeterminate'])
      const imported = settled.evidence.records.filter(record => (
        record.kind === 'assurance-provider-submission'
      ))
      expect(imported).toHaveLength(2)
      expect(new Set(imported.map(record => record.recordId)).size).toBe(2)
    } finally {
      await contributorFiber.dispose()
      await serviceFiber.dispose()
      await subagentFiber.dispose()
      await subprocessFiber.dispose()
    }
  })

  it('restores the imported Evidence reference and terminal Invocation from SQLite without replay', async () => {
    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-persisted-submission-home-'))
    temporaryRoots.push(home)
    const descriptor: AssuranceProviderDescriptorV1 = {
      schemaVersion: 1,
      providerId: 'fixture/persisted-submission-provider',
      providerVersion: '1.0.0-fixture.1',
    }
    const agent = {
      id: 'agent-persisted-submission-fixture',
      session: { header: { cwd: repository } },
    } as unknown as Agent

    const firstContext = new Context()
    const firstSubprocessFiber = await firstContext.plugin(LocalSubprocessRuntime)
    const firstSubagentFiber = await firstContext.plugin(SubagentRuntime)
    registerScriptedEngineeringProvider(firstContext.subagents)
    const firstServiceFiber = await firstContext.plugin(
      EngineeringControlPlane,
      config(repository, home, descriptor),
    )
    await firstContext.engineeringControlPlane.whenReady()
    let assessCalls = 0
    const contributorFiber = await firstContext.plugin({
      name: 'persisted-submission-reference-provider',
      inject: ['engineeringControlPlane'],
      apply(contributorContext: Context) {
        return contributorContext.engineeringControlPlane.registerAssuranceProvider(
          descriptor,
          normalizedDescriptor => ({
            descriptor: normalizedDescriptor,
            async assess(context): Promise<AssuranceProviderOutcomeV1> {
              assessCalls++
              return {
                kind: 'sealed_submission',
                submission: submissionFor(context, normalizedDescriptor),
              }
            },
          }),
        )
      },
    })

    let persisted!: {
      readonly missionId: string
      readonly revision: number
      readonly invocation: unknown
      readonly evidence: unknown
    }
    try {
      const receipt = await firstContext.engineeringControlPlane.start(agent, {
        idempotencyKey: 'persisted-submission:start:1',
        objective: 'Persist one imported Submission without retaining its Provider runtime',
      }, new AbortController().signal)
      await waitForTerminalInvocation(firstContext, agent, receipt.missionId)
      const snapshot = await waitForGateDecision(firstContext, agent, receipt.missionId)
      persisted = {
        missionId: receipt.missionId,
        revision: snapshot.revision,
        invocation: structuredClone(snapshot.assuranceProviderInvocations?.[0]),
        evidence: structuredClone(snapshot.evidence),
      }
      expect(assessCalls).toBe(1)
    } finally {
      await contributorFiber.dispose()
      await firstServiceFiber.dispose()
      await firstSubagentFiber.dispose()
      await firstSubprocessFiber.dispose()
    }

    const secondContext = new Context()
    const secondSubprocessFiber = await secondContext.plugin(LocalSubprocessRuntime)
    const secondSubagentFiber = await secondContext.plugin(SubagentRuntime)
    const secondServiceFiber = await secondContext.plugin(
      EngineeringControlPlane,
      config(repository, home, descriptor),
    )
    await secondContext.engineeringControlPlane.whenReady()
    try {
      const restored = await secondContext.engineeringControlPlane.status(
        agent,
        persisted.missionId,
        new AbortController().signal,
      )
      expect(restored.revision).toBe(persisted.revision)
      expect(restored.assuranceProviderInvocations?.[0]).toEqual(persisted.invocation)
      expect(restored.evidence).toEqual(persisted.evidence)
      expect(restored.status).toBe('APPROVED')
      expect(restored.gate).toEqual({ kind: 'approved', reasons: [] })
      expect(assessCalls).toBe(1)
    } finally {
      await secondServiceFiber.dispose()
      await secondSubagentFiber.dispose()
      await secondSubprocessFiber.dispose()
    }
  })

  it.each(rejectionCases)('fails closed for $name', async ({
    name,
    failureCode,
    mutate,
    outcomeKind,
    maxRecordBytes,
  }) => {
    const repository = await cleanRepository()
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-rejected-submission-home-'))
    temporaryRoots.push(home)
    const descriptor: AssuranceProviderDescriptorV1 = {
      schemaVersion: 1,
      providerId: 'fixture/rejected-submission-provider',
      providerVersion: '1.0.0-fixture.1',
    }
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    registerScriptedEngineeringProvider(ctx.subagents)
    const serviceFiber = await ctx.plugin(
      EngineeringControlPlane,
      config(repository, home, descriptor, maxRecordBytes),
    )
    await ctx.engineeringControlPlane.whenReady()
    const contributorFiber = await ctx.plugin({
      name: 'rejected-submission-reference-provider',
      inject: ['engineeringControlPlane'],
      apply(contributorContext: Context) {
        return contributorContext.engineeringControlPlane.registerAssuranceProvider(
          descriptor,
          normalizedDescriptor => ({
            descriptor: normalizedDescriptor,
            async assess(context): Promise<AssuranceProviderOutcomeV1> {
              const candidate = JSON.parse(JSON.stringify(
                submissionFor(context, normalizedDescriptor),
              )) as Record<string, unknown>
              mutate(candidate)
              if (outcomeKind !== undefined) {
                return { kind: outcomeKind } as unknown as AssuranceProviderOutcomeV1
              }
              return {
                kind: 'sealed_submission',
                submission: candidate as unknown as AssuranceSubmissionV1,
              }
            },
          }),
        )
      },
    })

    try {
      const agent = {
        id: 'agent-rejected-submission-fixture',
        session: { header: { cwd: repository } },
      } as unknown as Agent
      const receipt = await ctx.engineeringControlPlane.start(agent, {
        idempotencyKey: `rejected-submission:${name}`,
        objective: 'Reject one ineligible Reference Fake Submission without importing Evidence',
      }, new AbortController().signal)
      const rejected = await waitForTerminalInvocation(ctx, agent, receipt.missionId)

      expect(rejected.assuranceProviderInvocations).toEqual([expect.objectContaining({
        schemaVersion: 1,
        attempt: 1,
        descriptor,
        state: 'rejected',
        begunAt: expect.any(String),
        rejectedAt: expect.any(String),
        failureCode,
      })])
      expect(rejected.evidence.records.some(record => (
        record.kind === 'assurance-provider-submission'
      ))).toBe(false)
    } finally {
      await contributorFiber.dispose()
      await serviceFiber.dispose()
      await subagentFiber.dispose()
      await subprocessFiber.dispose()
    }
  }, 45_000)
})
