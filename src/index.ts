import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import { GitRepositoryAdapter } from './adapters/git-repository.js'
import { HarnessCommandExecutor } from './adapters/harness-command-executor.js'
import { HarnessRoleExecutor, type HarnessRolePolicy } from './adapters/harness-role-executor.js'
import { openSqliteMissionStore, type SqliteMissionStore } from './adapters/sqlite-mission-store.js'
import { VerificationAdapter, type VerificationProfile } from './adapters/verification.js'
import { AssuranceProviderRegistry } from './assurance-provider/registry.js'
import { AssuranceProviderInvocationCoordinator } from './assurance-provider/invocation-coordinator.js'
import type {
  AssuranceProviderActivationPolicyV1,
  AssuranceProviderDescriptorV1,
  AssuranceProviderDisposer,
  AssuranceProviderFactoryV1,
} from './assurance-provider/contracts.js'
import { Config as ConfigSchema, type Config as PluginConfig } from './config.js'
import {
  createFilesystemEvidenceStore,
  type FilesystemEvidenceStore,
} from './evidence/filesystem-store.js'
import { createControlPlaneKernel, MissionError } from './kernel/index.js'
import type {
  ControlPlaneKernel,
  EffectivePolicy,
  EvidenceRecord,
  MissionAction,
  MissionAuthority,
  MissionId,
  MissionReceipt,
  MissionSnapshot,
  RepositoryIdentity,
  RoleName,
  StartMissionInput,
} from './kernel/index.js'
import { isMissionPhase } from './kernel/state-machine.js'
import {
  createEffectivePolicy,
  resolveAssuranceProviderActivations,
  resolveDeploymentConfig,
} from './policy.js'
import {
  createMissionRunner,
  type MissionExecutionHost,
  type MissionRunner,
} from './runner/mission-runner.js'

export interface Config extends PluginConfig {}
export const Config = ConfigSchema
export * from './kernel/index.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    engineeringControlPlane: EngineeringControlPlane
  }
}

interface ControlPlaneRuntime {
  readonly home: string
  readonly store: SqliteMissionStore
  readonly evidenceStore: FilesystemEvidenceStore
  readonly kernel: ControlPlaneKernel
  readonly runner: MissionRunner
  readonly assuranceInvocations: AssuranceProviderInvocationCoordinator
  readonly git: GitRepositoryAdapter
}

interface RepositoryPolicyBinding {
  readonly verificationProfileName: string
  readonly assuranceProviderActivations: readonly AssuranceProviderActivationPolicyV1[]
}

export interface MissionStartRequest extends StartMissionInput {
  readonly idempotencyKey: string
}

export interface MissionResumeRequest {
  readonly missionId: MissionId | string
  readonly expectedRevision: number
  readonly supplementalContext?: string
}

export interface MissionCancelRequest {
  readonly missionId: MissionId | string
  readonly expectedRevision: number
  readonly reason?: string
}

export interface MissionReworkRequest {
  readonly missionId: MissionId | string
  readonly expectedRevision: number
  readonly instructions?: string
}

const ROLE_NAMES = ['planner', 'developer', 'tester', 'reviewer'] as const satisfies readonly RoleName[]
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function callingCwd(agent: Agent): string {
  const cwd = agent.session.header.cwd
  if (cwd === undefined) throw new Error('Mission tools require a calling Agent Session with an absolute cwd')
  return cwd
}

function scopedRepository(canonicalRoot: string): RepositoryIdentity {
  return {
    canonicalRoot,
    branch: '__authority_scope__',
    head: '0'.repeat(40),
    workspaceFingerprint: 'sha256:' + '0'.repeat(64),
  }
}

function authority(
  principalId: string,
  repository: RepositoryIdentity,
  actions: readonly MissionAction[],
  lease?: Pick<MissionAuthority, 'leaseHolderId' | 'writeLease'>,
): MissionAuthority {
  return { principalId, repository, actions, ...lease }
}

function rolePoliciesFromEffective(
  policy: EffectivePolicy,
): Readonly<Record<RoleName, HarnessRolePolicy>> {
  if (policy.rolePolicies === undefined) throw new Error('Mission Effective Policy omitted Role policies')
  const result = {} as Record<RoleName, HarnessRolePolicy>
  for (const role of ROLE_NAMES) {
    const configured = policy.rolePolicies[role]
    const agentOptions: AgentOptions = {
      ...configured.agentProvider === undefined ? {} : { provider: configured.agentProvider },
      ...configured.model === undefined ? {} : { model: configured.model },
      ...configured.maxTokens === undefined ? {} : { maxTokens: configured.maxTokens },
    }
    const toolFilter: ToolRestriction = {
      allow: [...configured.allowTools],
      deny: [...configured.denyTools],
    }
    result[role] = {
      toolFilter,
      ...Object.keys(agentOptions).length === 0 ? {} : { agentOptions },
    }
  }
  return result
}

function assertExpectedRevision(snapshot: MissionSnapshot, expectedRevision: number): void {
  if (snapshot.revision !== expectedRevision) {
    throw new MissionError(
      'revision_conflict',
      `Mission '${snapshot.missionId}' is at revision ${snapshot.revision}`,
      {
        missionId: snapshot.missionId,
        status: snapshot.status,
        currentRevision: snapshot.revision,
      },
    )
  }
}

/** Cordis Service Capability adapting Harness execution seams to the Control Plane Kernel. */
export class EngineeringControlPlane extends Service {
  static inject = ['subagents', 'subprocess']
  static Config = ConfigSchema

  private readonly ready: Promise<ControlPlaneRuntime>
  private readonly assuranceProviders = new AssuranceProviderRegistry()
  private readonly leaseHolderId = `host-${randomUUID()}`
  private disposed = false

  constructor(ctx: Context, config: PluginConfig) {
    super(ctx, 'engineeringControlPlane')
    this.ready = this.initialize(config)
    void this.ready.catch(() => {})
    ctx.effect(async () => {
      const runtime = await this.ready
      return async () => {
        this.disposed = true
        runtime.assuranceInvocations.dispose()
        this.assuranceProviders.clear()
        await runtime.runner.dispose()
        await runtime.store.close()
      }
    }, 'engineering control plane teardown')
  }

  /** Join durable-store validation and startup recovery. */
  async whenReady(): Promise<void> {
    await this.runtime()
  }

  /** Register one startup-composed Provider; the contributing Fiber owns the returned disposer. */
  registerAssuranceProvider(
    descriptor: AssuranceProviderDescriptorV1,
    factory: AssuranceProviderFactoryV1,
  ): AssuranceProviderDisposer {
    if (this.disposed) throw new Error('Engineering Control Plane is disposing')
    return this.assuranceProviders.register(descriptor, factory)
  }

  /** Atomically accept one clean-repository Mission, then detach its Runner from the tool signal. */
  async start(agent: Agent, request: MissionStartRequest, signal: AbortSignal): Promise<MissionReceipt> {
    this.assuranceProviders.closeRegistration()
    const runtime = await this.runtime()
    if (request.idempotencyKey.trim().length === 0) throw new TypeError('idempotencyKey must not be empty')
    const repository = await runtime.git.deriveStartIdentity(callingCwd(agent), signal)
    const missionAuthority = authority(
      `agent:${String(agent.id)}`,
      repository,
      ['start', 'read', 'orchestrate'],
      {
        leaseHolderId: this.leaseHolderId,
        writeLease: { holderId: this.leaseHolderId, fencingToken: 1 },
      },
    )
    const receipt = await runtime.kernel.dispatch({
      kind: 'start',
      idempotencyKey: request.idempotencyKey,
      input: {
        objective: request.objective,
        ...request.context === undefined ? {} : { context: request.context },
        ...request.acceptanceCriteria === undefined
          ? {}
          : { acceptanceCriteria: [...request.acceptanceCriteria] },
        ...request.constraints === undefined ? {} : { constraints: [...request.constraints] },
      },
    }, missionAuthority)
    const snapshot = await runtime.kernel.snapshot(receipt.missionId, missionAuthority)
    if (snapshot.writeLease.holderId === this.leaseHolderId) {
      const executionAuthority = this.executionAuthority(missionAuthority, snapshot)
      runtime.runner.launch(snapshot.missionId, executionAuthority, this.host(runtime, agent, snapshot))
    }
    return receipt
  }

  /** Read bounded-tool source data through repository-scoped Kernel authority. */
  async status(agent: Agent, missionId: MissionId | string, signal: AbortSignal): Promise<MissionSnapshot> {
    this.assuranceProviders.closeRegistration()
    const runtime = await this.runtime()
    const missionAuthority = await this.controlAuthority(runtime, agent, ['read'], signal)
    return runtime.kernel.snapshot(missionId, missionAuthority)
  }

  /** Resume the recorded blocked phase in the same Attempt and launch a replacement Role Run if needed. */
  async resume(agent: Agent, request: MissionResumeRequest, signal: AbortSignal): Promise<MissionReceipt> {
    this.assuranceProviders.closeRegistration()
    const runtime = await this.runtime()
    const missionAuthority = await this.controlAuthority(runtime, agent, ['read', 'resume', 'orchestrate'], signal)
    const before = await runtime.kernel.snapshot(request.missionId, missionAuthority)
    await this.assertFrozenHistory(before, signal)
    const acquiringAuthority = { ...missionAuthority, leaseHolderId: this.leaseHolderId }
    const receipt = await runtime.kernel.dispatch({
      kind: 'resume',
      missionId: before.missionId,
      expectedRevision: request.expectedRevision,
      ...request.supplementalContext === undefined ? {} : { supplementalContext: request.supplementalContext },
    }, acquiringAuthority)
    const snapshot = await runtime.kernel.snapshot(receipt.missionId, acquiringAuthority)
    const executionAuthority = this.executionAuthority(acquiringAuthority, snapshot)
    runtime.runner.launch(snapshot.missionId, executionAuthority, this.host(runtime, agent, snapshot))
    return receipt
  }

  /** Quiesce process-local execution, then atomically cancel and seal any live Role Run. */
  async cancel(agent: Agent, request: MissionCancelRequest, signal: AbortSignal): Promise<MissionReceipt> {
    this.assuranceProviders.closeRegistration()
    const runtime = await this.runtime()
    const missionAuthority = await this.controlAuthority(runtime, agent, ['read', 'cancel', 'orchestrate'], signal)
    const before = await runtime.kernel.snapshot(request.missionId, missionAuthority)
    assertExpectedRevision(before, request.expectedRevision)
    runtime.assuranceInvocations.reserveCancellation(before)
    await runtime.runner.quiesceForCancellation(before.missionId)
    let cancellationSnapshot: MissionSnapshot
    try {
      cancellationSnapshot = await runtime.assuranceInvocations.cancel(before, missionAuthority, signal)
    } catch (error) {
      await this.blockAfterCancellationFailure(runtime, missionAuthority, before.missionId, error)
      throw error
    }
    const host = this.host(runtime, agent, cancellationSnapshot)
    let finalRepositoryEvidence: EvidenceRecord
    try {
      const capture = await host.captureImplementation(cancellationSnapshot, signal)
      if (!Number.isSafeInteger(capture.implementationSecretCount) || capture.implementationSecretCount < 0) {
        throw new Error('Cancellation repository capture secret count is invalid')
      }
      finalRepositoryEvidence = await host.evidenceStore.publish({
        missionId: cancellationSnapshot.missionId,
        attempt: cancellationSnapshot.attempt,
        kind: 'cancellation-repository-state',
        schemaVersion: 1,
        payload: {
          schemaVersion: 1,
          capturedAfterQuiescence: true,
          capture: capture.payload,
          integrityFacts: {
            implementationSecretCount: capture.implementationSecretCount,
            workspacePolicyViolations: [...capture.workspacePolicyViolations],
          },
        },
      })
    } catch (error) {
      await this.blockAfterCancellationFailure(runtime, missionAuthority, before.missionId, error)
      throw error
    }
    try {
      return await runtime.kernel.dispatch({
        kind: 'cancel',
        missionId: cancellationSnapshot.missionId,
        expectedRevision: cancellationSnapshot.revision,
        finalRepositoryEvidence,
        ...request.reason === undefined ? {} : { reason: request.reason },
      }, missionAuthority)
    } catch (error) {
      await this.blockAfterCancellationFailure(runtime, missionAuthority, before.missionId, error)
      throw error
    }
  }

  /** Start a new incremental Attempt from a deterministic engineering Gate failure. */
  async rework(agent: Agent, request: MissionReworkRequest, signal: AbortSignal): Promise<MissionReceipt> {
    this.assuranceProviders.closeRegistration()
    const runtime = await this.runtime()
    const missionAuthority = await this.controlAuthority(runtime, agent, ['read', 'rework', 'orchestrate'], signal)
    const before = await runtime.kernel.snapshot(request.missionId, missionAuthority)
    await this.assertFrozenHistory(before, signal)
    const acquiringAuthority = { ...missionAuthority, leaseHolderId: this.leaseHolderId }
    const receipt = await runtime.kernel.dispatch({
      kind: 'rework',
      missionId: before.missionId,
      expectedRevision: request.expectedRevision,
      ...request.instructions === undefined ? {} : { instructions: request.instructions },
    }, acquiringAuthority)
    const snapshot = await runtime.kernel.snapshot(receipt.missionId, acquiringAuthority)
    const executionAuthority = this.executionAuthority(acquiringAuthority, snapshot)
    runtime.runner.launch(snapshot.missionId, executionAuthority, this.host(runtime, agent, snapshot))
    return receipt
  }

  private async initialize(config: PluginConfig): Promise<ControlPlaneRuntime> {
    const deployment = resolveDeploymentConfig(config)
    const commands = new HarnessCommandExecutor({
      subprocess: this.ctx.subprocess,
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
    const policyBindingsByRepository = new Map<string, RepositoryPolicyBinding>()
    for (const mapping of config.repositories ?? []) {
      const profileName = mapping.verificationProfile
      if (!deployment.verificationProfiles.has(profileName)) {
        throw new TypeError(`Repository mapping references unknown Verification Profile '${profileName}'`)
      }
      const canonicalRoot = await git.canonicalRoot(
        mapping.root,
        AbortSignal.timeout(deployment.gitCommandTimeoutMs),
      )
      if (policyBindingsByRepository.has(canonicalRoot)) {
        throw new TypeError(`Canonical repository '${canonicalRoot}' is mapped more than once`)
      }
      policyBindingsByRepository.set(canonicalRoot, {
        verificationProfileName: profileName,
        assuranceProviderActivations: resolveAssuranceProviderActivations(mapping.assuranceProviders),
      })
    }
    if (policyBindingsByRepository.size === 0) {
      throw new TypeError('At least one repository mapping is required')
    }

    const home = resolveDshHome(config.dshHome)
    const evidenceStore = createFilesystemEvidenceStore({
      root: join(home, 'control-plane', 'missions'),
      maxRecordBytes: deployment.artifactBudgets.maxRecordBytes,
    })
    let store: SqliteMissionStore | undefined
    try {
      store = await openSqliteMissionStore({
        path: join(home, 'control-plane', 'control-plane.sqlite'),
        journalMode: deployment.database.journalMode,
        busyTimeoutMs: deployment.database.busyTimeoutMs,
      })
      const kernel = createControlPlaneKernel({
        store,
        nextMissionId: () => `mission-${randomUUID()}`,
        now: () => new Date().toISOString(),
        resolveEffectivePolicy: missionAuthority => {
          const binding = policyBindingsByRepository.get(missionAuthority.repository.canonicalRoot)
          if (binding === undefined) {
            throw new Error('The canonical repository has no host-owned policy mapping')
          }
          const selected = this.assuranceProviders.freezeSelections(
            binding.assuranceProviderActivations,
          )
          return createEffectivePolicy(
            deployment,
            binding.verificationProfileName,
            binding.assuranceProviderActivations,
            selected,
          )
        },
      })
      const runner = createMissionRunner({
        kernel,
        store,
        authorityFor: snapshot => authority(
          'service:restart-recovery',
          snapshot.repository,
          ['read', 'recover'],
        ),
        observeWorkspaceForRecovery: snapshot => this.gitForPolicy(snapshot.effectivePolicy).observe(
          snapshot.repository.canonicalRoot,
          AbortSignal.timeout(
            snapshot.effectivePolicy.hostExecution?.gitCommandTimeoutMs ?? deployment.gitCommandTimeoutMs,
          ),
        ),
        onError: error => this.ctx.logger.warn(
          `engineering control plane runner: ${errorMessage(error)}`,
        ),
      })
      const assuranceInvocations = new AssuranceProviderInvocationCoordinator({
        kernel,
        registry: this.assuranceProviders,
        evidenceStore,
        maxSubmissionBytes: deployment.artifactBudgets.maxRecordBytes,
        cancellationTimeoutMs: deployment.terminationGraceMs,
        onError: message => this.ctx.logger.warn(`engineering control plane assurance: ${message}`),
      })
      await runner.recoverAfterRestart()
      return { home, store, evidenceStore, kernel, runner, assuranceInvocations, git }
    } catch (error) {
      await store?.close()
      throw error
    }
  }

  private async runtime(): Promise<ControlPlaneRuntime> {
    if (this.disposed) throw new Error('Engineering Control Plane is disposing')
    const runtime = await this.ready
    if (this.disposed) throw new Error('Engineering Control Plane is disposing')
    return runtime
  }

  private async controlAuthority(
    runtime: ControlPlaneRuntime,
    agent: Agent,
    actions: readonly MissionAction[],
    signal: AbortSignal,
  ): Promise<MissionAuthority> {
    const canonicalRoot = await runtime.git.canonicalRoot(callingCwd(agent), signal)
    return authority(`agent:${String(agent.id)}`, scopedRepository(canonicalRoot), actions)
  }

  private async assertFrozenHistory(
    snapshot: MissionSnapshot,
    signal: AbortSignal,
  ): Promise<void> {
    const observed = await this.gitForPolicy(snapshot.effectivePolicy).observe(
      snapshot.repository.canonicalRoot,
      signal,
    )
    if (observed.branch !== snapshot.repository.branch || observed.head !== snapshot.repository.head) {
      throw new Error('Mission cannot continue because its frozen Git branch or HEAD changed')
    }
    if (snapshot.blocked?.reason.code === 'host_restarted') {
      const expected = snapshot.blocked.workspaceFingerprint
      if (expected === undefined) {
        throw new Error('Mission cannot resume because restart recovery did not capture a Workspace Fingerprint')
      }
      if (observed.workspaceFingerprint !== expected) {
        throw new Error('Mission cannot resume because the workspace changed after restart recovery')
      }
    }
  }

  /** Fail closed if external quiescence or final cancellation Evidence cannot be committed. */
  private async blockAfterCancellationFailure(
    runtime: ControlPlaneRuntime,
    missionAuthority: MissionAuthority,
    missionId: MissionId | string,
    failure: unknown,
  ): Promise<void> {
    try {
      const current = await runtime.kernel.snapshot(missionId, missionAuthority)
      if (!isMissionPhase(current.status)) return
      await runtime.kernel.dispatch({
        kind: 'block',
        missionId: current.missionId,
        expectedRevision: current.revision,
        reason: {
          code: 'evidence_incomplete',
          detail: `Cancellation could not prove quiescence and record final Evidence: ${errorMessage(failure)}`.slice(0, 4_096),
        },
        sealLiveRoleRuns: {
          stopReason: 'cancellation-evidence-failed',
          diagnostic: errorMessage(failure).slice(0, 4_096),
        },
      }, missionAuthority)
    } catch (cleanupError) {
      this.ctx.logger.warn(`engineering control plane cancellation cleanup: ${errorMessage(cleanupError)}`)
    }
  }

  private executionAuthority(
    base: MissionAuthority,
    snapshot: MissionSnapshot,
  ): MissionAuthority {
    if (snapshot.writeLease.holderId !== this.leaseHolderId) {
      throw new MissionError(
        'write_lease_denied',
        `Mission '${snapshot.missionId}' is held by another host process`,
        {
          missionId: snapshot.missionId,
          status: snapshot.status,
          currentRevision: snapshot.revision,
        },
      )
    }
    return {
      ...base,
      leaseHolderId: this.leaseHolderId,
      writeLease: {
        holderId: this.leaseHolderId,
        fencingToken: snapshot.writeLease.fencingToken,
      },
    }
  }

  private host(runtime: ControlPlaneRuntime, agent: Agent, snapshot: MissionSnapshot): MissionExecutionHost {
    const policy = snapshot.effectivePolicy
    if (policy.subagentProvider === undefined || policy.verification === undefined
      || policy.artifactBudgets === undefined || policy.hostExecution === undefined) {
      throw new Error('Mission Effective Policy is incomplete')
    }
    const missionCommands = this.commandsForPolicy(policy)
    const missionGit = new GitRepositoryAdapter({
      commands: missionCommands,
      gitCommand: policy.hostExecution.gitCommand,
      commandTimeoutMs: policy.hostExecution.gitCommandTimeoutMs,
      maxUntrackedFiles: policy.artifactBudgets.maxUntrackedFiles,
      maxUntrackedBytes: policy.artifactBudgets.maxUntrackedBytes,
    })
    const roleExecutor = new HarnessRoleExecutor({
      subagents: this.ctx.subagents,
      parent: agent,
      provider: policy.subagentProvider,
      ...policy.maxSubagentDepth === undefined ? {} : { maxDepth: policy.maxSubagentDepth },
      policies: rolePoliciesFromEffective(policy),
      repository: missionGit,
    })
    const verification = new VerificationAdapter(missionCommands)
    return {
      evidenceStore: runtime.evidenceStore,
      roleExecutor,
      captureImplementation: (current, signal) => missionGit.captureImplementation(current.repository, signal),
      runVerifications: (current, signal) => verification.run(
        policy.verification as VerificationProfile,
        current.repository,
        signal,
      ),
      runAssuranceProviders: (current, currentAuthority, signal) => (
        runtime.assuranceInvocations.execute(current, currentAuthority, signal)
      ),
    }
  }

  private commandsForPolicy(policy: EffectivePolicy): HarnessCommandExecutor {
    if (policy.artifactBudgets === undefined || policy.hostExecution === undefined) {
      throw new Error('Mission Effective Policy omitted host execution settings')
    }
    return new HarnessCommandExecutor({
      subprocess: this.ctx.subprocess,
      maxStdoutBytes: policy.artifactBudgets.maxStdoutBytes,
      maxStderrBytes: policy.artifactBudgets.maxStderrBytes,
      terminationGraceMs: policy.hostExecution.terminationGraceMs,
    })
  }

  private gitForPolicy(policy: EffectivePolicy): GitRepositoryAdapter {
    if (policy.artifactBudgets === undefined || policy.hostExecution === undefined) {
      throw new Error('Mission Effective Policy omitted Git execution settings')
    }
    return new GitRepositoryAdapter({
      commands: this.commandsForPolicy(policy),
      gitCommand: policy.hostExecution.gitCommand,
      commandTimeoutMs: policy.hostExecution.gitCommandTimeoutMs,
      maxUntrackedFiles: policy.artifactBudgets.maxUntrackedFiles,
      maxUntrackedBytes: policy.artifactBudgets.maxUntrackedBytes,
    })
  }
}

export default EngineeringControlPlane
