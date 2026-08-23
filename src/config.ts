import z from '@deepseek-ai/schemastery'
import type { AssuranceProviderActivation } from './assurance-provider/contracts.js'
import type {
  EffectiveArtifactBudgets,
  RoleName,
} from './kernel/types.js'

export interface RepositoryMappingConfig {
  root: string
  verificationProfile: string
  assuranceProviders?: AssuranceProviderActivationConfig[]
}

export interface AssuranceProviderActivationConfig {
  providerId: string
  providerVersion: string
  activation: AssuranceProviderActivation
  configuration?: Record<string, string>
}

export interface DatabaseConfig {
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'
  busyTimeoutMs?: number
}

export interface RolePolicyConfig {
  allowTools: string[]
  denyTools: string[]
  agentProvider?: string
  model?: string
  maxTokens?: number
}

export interface VerificationCommandConfig {
  name: string
  argv: string[]
  timeoutMs: number
  environmentNames: string[]
}

export type VerificationCategoryConfig =
  | { mode: 'commands'; commands: VerificationCommandConfig[] }
  | { mode: 'not_applicable'; reason: string }

export interface VerificationProfileConfig {
  name: string
  categories: Record<'functional' | 'negative' | 'regression' | 'security', VerificationCategoryConfig>
}

export interface Config {
  dshHome?: string
  subagentProvider: 'spawn'
  maxSubagentDepth?: number
  rolePolicies: Record<RoleName, RolePolicyConfig>
  repositories: RepositoryMappingConfig[]
  verificationProfiles: VerificationProfileConfig[]
  artifactBudgets?: Partial<EffectiveArtifactBudgets>
  database?: DatabaseConfig
  gitCommand?: string
  gitCommandTimeoutMs?: number
  terminationGraceMs?: number
}

const stringArray = z.array(z.string())
const verificationCommand = z.object({
  name: z.string().required(),
  argv: stringArray.required(),
  timeoutMs: z.number().required(),
  environmentNames: stringArray,
})
const verificationCategory = z.union([
  z.object({
    mode: z.const('commands').required(),
    commands: z.array(verificationCommand).required(),
  }),
  z.object({
    mode: z.const('not_applicable').required(),
    reason: z.string().required(),
  }),
])
const rolePolicy = z.object({
  allowTools: stringArray.required(),
  denyTools: stringArray.default([]),
  agentProvider: z.string(),
  model: z.string(),
  maxTokens: z.number(),
})
const assuranceProviderActivation = z.object({
  providerId: z.string().required(),
  providerVersion: z.string().required(),
  activation: z.union(['disabled', 'when-available', 'required'] as const).required(),
  configuration: z.dict(z.string()),
})

/** Schemastery configuration surface; every execution/gate choice is host-owned. */
export const Config = z.object({
  dshHome: z.string(),
  subagentProvider: z.const('spawn').required(),
  maxSubagentDepth: z.number().default(1),
  rolePolicies: z.object({
    planner: rolePolicy.required(),
    developer: rolePolicy.required(),
    tester: rolePolicy.required(),
    reviewer: rolePolicy.required(),
  }).required(),
  repositories: z.array(z.object({
    root: z.string().required(),
    verificationProfile: z.string().required(),
    assuranceProviders: z.array(assuranceProviderActivation).default([]),
  })).required(),
  verificationProfiles: z.array(z.object({
    name: z.string().required(),
    categories: z.object({
      functional: verificationCategory.required(),
      negative: verificationCategory.required(),
      regression: verificationCategory.required(),
      security: verificationCategory.required(),
    }).required(),
  })).required(),
  artifactBudgets: z.object({
    maxRecordBytes: z.number().default(16 * 1024 * 1024),
    maxStdoutBytes: z.number().default(4 * 1024 * 1024),
    maxStderrBytes: z.number().default(4 * 1024 * 1024),
    maxUntrackedFiles: z.number().default(256),
    maxUntrackedBytes: z.number().default(32 * 1024 * 1024),
  }),
  database: z.object({
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    busyTimeoutMs: z.number().default(5_000),
  }),
  gitCommand: z.string().default('git'),
  gitCommandTimeoutMs: z.number().default(30_000),
  terminationGraceMs: z.number().default(2_000),
})

export const DEFAULT_ARTIFACT_BUDGETS: EffectiveArtifactBudgets = {
  maxRecordBytes: 16 * 1024 * 1024,
  maxStdoutBytes: 4 * 1024 * 1024,
  maxStderrBytes: 4 * 1024 * 1024,
  maxUntrackedFiles: 256,
  maxUntrackedBytes: 32 * 1024 * 1024,
}
