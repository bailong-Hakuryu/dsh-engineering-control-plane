import { createHash } from 'node:crypto'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { HarnessRolePolicy } from './adapters/harness-role-executor.js'
import {
  validateVerificationProfile,
  type VerificationProfile,
} from './adapters/verification.js'
import type { Config, RolePolicyConfig, VerificationProfileConfig } from './config.js'
import { DEFAULT_ARTIFACT_BUDGETS } from './config.js'
import { canonicalizeEvidence } from './evidence/filesystem-store.js'
import type {
  EffectiveArtifactBudgets,
  EffectivePolicy,
  EffectiveRolePolicy,
  EffectiveVerificationProfile,
  RoleName,
} from './kernel/types.js'

const ROLE_NAMES = ['planner', 'developer', 'tester', 'reviewer'] as const satisfies readonly RoleName[]
const READ_ONLY_ROLE_TOOLS = new Set([
  'read',
  'read_image',
  'glob',
  'grep',
  'lsp',
  'web_search',
  'web_fetch',
  'session_event_read',
  'session_event_search',
  'session_event_trace',
  'session_search',
  'session_trace',
  'skill',
])
const DEVELOPER_ROLE_TOOLS = new Set([
  ...READ_ONLY_ROLE_TOOLS,
  'write',
  'edit',
  'str_replace_editor',
])

export interface ResolvedDeploymentConfig {
  readonly subagentProvider: 'spawn'
  readonly maxSubagentDepth: number
  readonly rolePolicies: Readonly<Record<RoleName, EffectiveRolePolicy>>
  readonly harnessRolePolicies: Readonly<Record<RoleName, HarnessRolePolicy>>
  readonly verificationProfiles: ReadonlyMap<string, EffectiveVerificationProfile>
  readonly artifactBudgets: EffectiveArtifactBudgets
  readonly gitCommand: string
  readonly gitCommandTimeoutMs: number
  readonly terminationGraceMs: number
  readonly database: {
    readonly journalMode: 'wal' | 'delete' | 'truncate' | 'persist'
    readonly busyTimeoutMs: number
  }
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`)
  return value
}

function nonEmpty(name: string, value: string | undefined): string {
  if (value === undefined || value.trim().length === 0 || value !== value.trim()) {
    throw new TypeError(`${name} must be non-empty and have no surrounding whitespace`)
  }
  return value
}

function stringSet(name: string, values: readonly string[] | undefined): string[] {
  const normalized = values ?? []
  const result = normalized.map((value, index) => nonEmpty(`${name}[${index}]`, value))
  if (new Set(result).size !== result.length) throw new TypeError(`${name} must not contain duplicates`)
  return result
}

function resolveRolePolicy(role: RoleName, input: RolePolicyConfig | undefined): {
  readonly effective: EffectiveRolePolicy
  readonly harness: HarnessRolePolicy
} {
  if (input === undefined) throw new TypeError(`rolePolicies.${role} is required`)
  const allowTools = stringSet(`rolePolicies.${role}.allowTools`, input.allowTools)
  const denyTools = stringSet(`rolePolicies.${role}.denyTools`, input.denyTools)
  if (denyTools.includes('run_code')) {
    throw new TypeError(`rolePolicies.${role}.denyTools cannot name reserved transport 'run_code'`)
  }
  const permitted = role === 'developer' ? DEVELOPER_ROLE_TOOLS : READ_ONLY_ROLE_TOOLS
  const unsafeTool = allowTools.find(tool => !permitted.has(tool))
  if (unsafeTool !== undefined) {
    throw new TypeError(
      `rolePolicies.${role} cannot allow authority-sensitive or unknown tool '${unsafeTool}' in v0.1`,
    )
  }
  const overlap = allowTools.find(tool => denyTools.includes(tool))
  if (overlap !== undefined) throw new TypeError(`rolePolicies.${role} both allows and denies '${overlap}'`)
  const agentProvider = input.agentProvider === undefined
    ? undefined
    : nonEmpty(`rolePolicies.${role}.agentProvider`, input.agentProvider)
  const model = input.model === undefined ? undefined : nonEmpty(`rolePolicies.${role}.model`, input.model)
  const maxTokens = input.maxTokens === undefined
    ? undefined
    : positiveInteger(`rolePolicies.${role}.maxTokens`, input.maxTokens)
  const effective: EffectiveRolePolicy = {
    allowTools,
    denyTools,
    ...agentProvider === undefined ? {} : { agentProvider },
    ...model === undefined ? {} : { model },
    ...maxTokens === undefined ? {} : { maxTokens },
  }
  const agentOptions: AgentOptions = {
    ...agentProvider === undefined ? {} : { provider: agentProvider },
    ...model === undefined ? {} : { model },
    ...maxTokens === undefined ? {} : { maxTokens },
  }
  return {
    effective,
    harness: {
      toolFilter: { allow: [...allowTools], deny: [...denyTools] },
      ...Object.keys(agentOptions).length === 0 ? {} : { agentOptions },
    },
  }
}

function resolveProfile(config: VerificationProfileConfig): EffectiveVerificationProfile {
  const name = nonEmpty('verificationProfiles[].name', config.name)
  const profile: VerificationProfile = {
    name,
    categories: {
      functional: config.categories.functional,
      negative: config.categories.negative,
      regression: config.categories.regression,
      security: config.categories.security,
    },
  }
  validateVerificationProfile(profile)
  return {
    name,
    categories: {
      functional: profile.categories.functional.mode === 'commands'
        ? {
            mode: 'commands',
            commands: profile.categories.functional.commands.map(command => ({
              ...command,
              environmentNames: [...command.environmentNames ?? []],
            })),
          }
        : { ...profile.categories.functional },
      negative: profile.categories.negative.mode === 'commands'
        ? {
            mode: 'commands',
            commands: profile.categories.negative.commands.map(command => ({
              ...command,
              environmentNames: [...command.environmentNames ?? []],
            })),
          }
        : { ...profile.categories.negative },
      regression: profile.categories.regression.mode === 'commands'
        ? {
            mode: 'commands',
            commands: profile.categories.regression.commands.map(command => ({
              ...command,
              environmentNames: [...command.environmentNames ?? []],
            })),
          }
        : { ...profile.categories.regression },
      security: profile.categories.security.mode === 'commands'
        ? {
            mode: 'commands',
            commands: profile.categories.security.commands.map(command => ({
              ...command,
              environmentNames: [...command.environmentNames ?? []],
            })),
          }
        : { ...profile.categories.security },
    },
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

/** Validate direct plugin application as strictly as Loader-normalized configuration. */
export function resolveDeploymentConfig(config: Config): ResolvedDeploymentConfig {
  const subagentProvider = nonEmpty('subagentProvider', config.subagentProvider)
  if (subagentProvider !== 'spawn') {
    throw new TypeError("subagentProvider must be the fixed in-process 'spawn' provider")
  }
  const maxSubagentDepth = positiveInteger('maxSubagentDepth', config.maxSubagentDepth ?? 1)
  const effectivePolicies = {} as Record<RoleName, EffectiveRolePolicy>
  const harnessPolicies = {} as Record<RoleName, HarnessRolePolicy>
  for (const role of ROLE_NAMES) {
    const resolved = resolveRolePolicy(role, config.rolePolicies?.[role])
    effectivePolicies[role] = resolved.effective
    harnessPolicies[role] = resolved.harness
  }

  const verificationProfiles = new Map<string, EffectiveVerificationProfile>()
  for (const configured of config.verificationProfiles ?? []) {
    const profile = resolveProfile(configured)
    if (verificationProfiles.has(profile.name)) {
      throw new TypeError(`Verification Profile '${profile.name}' is duplicated`)
    }
    verificationProfiles.set(profile.name, deepFreeze(profile))
  }
  if (verificationProfiles.size === 0) throw new TypeError('At least one Verification Profile is required')

  const artifactBudgets: EffectiveArtifactBudgets = {
    maxRecordBytes: positiveInteger(
      'artifactBudgets.maxRecordBytes',
      config.artifactBudgets?.maxRecordBytes ?? DEFAULT_ARTIFACT_BUDGETS.maxRecordBytes,
    ),
    maxStdoutBytes: positiveInteger(
      'artifactBudgets.maxStdoutBytes',
      config.artifactBudgets?.maxStdoutBytes ?? DEFAULT_ARTIFACT_BUDGETS.maxStdoutBytes,
    ),
    maxStderrBytes: positiveInteger(
      'artifactBudgets.maxStderrBytes',
      config.artifactBudgets?.maxStderrBytes ?? DEFAULT_ARTIFACT_BUDGETS.maxStderrBytes,
    ),
    maxUntrackedFiles: positiveInteger(
      'artifactBudgets.maxUntrackedFiles',
      config.artifactBudgets?.maxUntrackedFiles ?? DEFAULT_ARTIFACT_BUDGETS.maxUntrackedFiles,
    ),
    maxUntrackedBytes: positiveInteger(
      'artifactBudgets.maxUntrackedBytes',
      config.artifactBudgets?.maxUntrackedBytes ?? DEFAULT_ARTIFACT_BUDGETS.maxUntrackedBytes,
    ),
  }

  return deepFreeze({
    subagentProvider,
    maxSubagentDepth,
    rolePolicies: effectivePolicies,
    harnessRolePolicies: harnessPolicies,
    verificationProfiles,
    artifactBudgets,
    gitCommand: nonEmpty('gitCommand', config.gitCommand ?? 'git'),
    gitCommandTimeoutMs: positiveInteger('gitCommandTimeoutMs', config.gitCommandTimeoutMs ?? 30_000),
    terminationGraceMs: positiveInteger('terminationGraceMs', config.terminationGraceMs ?? 2_000),
    database: {
      journalMode: config.database?.journalMode ?? 'wal',
      busyTimeoutMs: positiveInteger('database.busyTimeoutMs', config.database?.busyTimeoutMs ?? 5_000),
    },
  })
}

/** Freeze one complete redacted Effective Policy and bind its canonical digest. */
export function createEffectivePolicy(
  deployment: ResolvedDeploymentConfig,
  verificationProfileName: string,
): EffectivePolicy {
  const verification = deployment.verificationProfiles.get(verificationProfileName)
  if (verification === undefined) {
    throw new TypeError(`Unknown Verification Profile '${verificationProfileName}'`)
  }
  const unsigned = {
    schemaVersion: 1,
    verificationProfile: verification.name,
    subagentProvider: deployment.subagentProvider,
    maxSubagentDepth: deployment.maxSubagentDepth,
    rolePolicies: deployment.rolePolicies,
    verification,
    artifactBudgets: deployment.artifactBudgets,
    hostExecution: {
      gitCommand: deployment.gitCommand,
      gitCommandTimeoutMs: deployment.gitCommandTimeoutMs,
      terminationGraceMs: deployment.terminationGraceMs,
    },
  }
  const canonical = canonicalizeEvidence(unsigned)
  if (canonical.redacted) throw new Error('Effective Policy unexpectedly contained a sensitive value')
  const digest = `sha256:${createHash('sha256').update(canonical.json).digest('hex')}`
  return deepFreeze({ ...unsigned, digest })
}
