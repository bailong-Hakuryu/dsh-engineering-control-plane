import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema, ToolRestriction } from '@deepseek-ai/dsh-tools'
import type { RoleName } from '../kernel/types.js'
import type {
  RoleExecutionHandle,
  RoleExecutionRequest,
  RoleExecutor,
} from '../runner/mission-runner.js'

/** Current repository facts used to enforce read-only roles and frozen Git history. */
export interface RepositoryObservation {
  readonly branch: string
  readonly head: string
  readonly workspaceFingerprint: string
}

/** Read-only repository observer implemented by the Harness subprocess Adapter. */
export interface RepositoryObserver {
  observe(canonicalRoot: string, signal: AbortSignal): Promise<RepositoryObservation>
}

export interface HarnessRolePolicy {
  readonly toolFilter: ToolRestriction
  readonly agentOptions?: AgentOptions
}

/** Host-owned subagent provider and per-role authority policy. */
export interface HarnessRoleExecutorOptions {
  readonly subagents: Pick<SubagentRuntime, 'start'>
  readonly parent: Agent
  readonly provider: string
  readonly maxDepth?: number
  readonly policies: Readonly<Record<RoleName, HarnessRolePolicy>>
  readonly repository: RepositoryObserver
}

function policyViolations(
  request: RoleExecutionRequest,
  before: RepositoryObservation,
  after: RepositoryObservation,
): string[] {
  const violations: string[] = []
  if (before.branch !== request.repository.branch || after.branch !== request.repository.branch) {
    violations.push('git_branch_changed')
  }
  if (before.head !== request.repository.head || after.head !== request.repository.head) {
    violations.push('git_head_changed')
  }
  if (request.toolAccess === 'read_only' && before.workspaceFingerprint !== after.workspaceFingerprint) {
    violations.push('read_only_role_modified_workspace')
  }
  return [...new Set(violations)]
}

/** Harness `ctx.subagents` Adapter; child completion remains a Role result, never a Mission transition. */
export class HarnessRoleExecutor implements RoleExecutor {
  constructor(private readonly options: HarnessRoleExecutorOptions) {}

  async start(request: RoleExecutionRequest): Promise<RoleExecutionHandle> {
    const before = await this.options.repository.observe(request.repository.canonicalRoot, request.signal)
    const policy = this.options.policies[request.role]
    const run = await this.options.subagents.start(this.options.provider, {
      label: `${request.role} · ${request.missionId} · attempt ${request.attempt}`,
      prompt: [{ type: 'text', text: request.prompt }],
      parent: this.options.parent,
      signal: request.signal,
      outputSchema: request.outputSchema as unknown as ObjectJsonSchema,
      toolFilter: policy.toolFilter,
      persona: request.persona,
      ...this.options.maxDepth === undefined ? {} : { maxDepth: this.options.maxDepth },
      ...policy.agentOptions === undefined ? {} : { agentOptions: policy.agentOptions },
    })

    return {
      trace: {
        provider: this.options.provider,
        providerRunId: String(run.id),
        ...run.localAgent === undefined ? {} : { sessionId: String(run.localAgent.id) },
      },
      result: run.result.then(async result => ({
        stopReason: result.stopReason,
        ...result.structured === undefined ? {} : { structured: result.structured },
        ...result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic },
        workspacePolicyViolations: policyViolations(
          request,
          before,
          await this.options.repository.observe(request.repository.canonicalRoot, request.signal),
        ),
      })),
      dispose: () => run.dispose(),
    }
  }
}
