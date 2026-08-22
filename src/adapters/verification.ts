import type { RepositoryIdentity, VerificationEvidenceState } from '../kernel/types.js'
import type { VerificationCapture } from '../runner/mission-runner.js'
import { HarnessCommandExecutor, type CommandExecutionResult } from './harness-command-executor.js'

export interface VerificationCommandConfig {
  readonly name: string
  readonly argv: readonly string[]
  readonly timeoutMs: number
  readonly environmentNames?: readonly string[]
}

export type VerificationCategoryConfig =
  | {
    readonly mode: 'commands'
    readonly commands: readonly VerificationCommandConfig[]
  }
  | {
    readonly mode: 'not_applicable'
    readonly reason: string
  }

export interface VerificationProfile {
  readonly name: string
  readonly categories: Readonly<Record<VerificationEvidenceState['category'], VerificationCategoryConfig>>
}

interface CommandEvidence {
  readonly name: string
  readonly argv: readonly string[]
  readonly environmentNames: readonly string[]
  readonly exitCode?: number | null
  readonly signal?: NodeJS.Signals | null
  readonly timedOut?: boolean
  readonly stdout?: string
  readonly stderr?: string
  readonly stdoutTruncated?: boolean
  readonly stderrTruncated?: boolean
  readonly providerFailed?: boolean
}

const CATEGORIES = ['functional', 'negative', 'regression', 'security'] as const
const CREDENTIAL_ARGUMENT = /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key)\s*[:=]/iu

/** Validate a host-owned Verification Profile before it can be frozen into Effective Policy. */
export function validateVerificationProfile(profile: VerificationProfile): VerificationProfile {
  if (profile.name.trim().length === 0) throw new Error('Verification Profile name must not be empty')
  const commandNames = new Set<string>()
  for (const category of CATEGORIES) {
    const policy = profile.categories[category]
    if (policy === undefined) throw new Error(`Verification Profile omitted ${category}`)
    if (policy.mode === 'not_applicable') {
      if (policy.reason.trim().length === 0) throw new Error(`${category} not_applicable requires a reason`)
      continue
    }
    if (policy.commands.length === 0) throw new Error(`${category} commands policy requires at least one command`)
    for (const command of policy.commands) {
      if (command.name.trim().length === 0 || commandNames.has(command.name)) {
        throw new Error(`Verification command name '${command.name}' is empty or duplicated`)
      }
      commandNames.add(command.name)
      if (command.argv.length === 0 || command.argv.some(argument => argument.length === 0)) {
        throw new Error(`Verification command '${command.name}' has an invalid argv`)
      }
      if (command.argv.some(argument => CREDENTIAL_ARGUMENT.test(argument))) {
        throw new Error(`Verification command '${command.name}' embeds a credential-shaped argument; use environmentNames`)
      }
      if (!Number.isSafeInteger(command.timeoutMs) || command.timeoutMs < 1) {
        throw new Error(`Verification command '${command.name}' has an invalid timeoutMs`)
      }
    }
  }
  return profile
}

function commandEvidence(config: VerificationCommandConfig, result: CommandExecutionResult): CommandEvidence {
  return {
    name: config.name,
    argv: [...config.argv],
    environmentNames: result.environmentNames,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  }
}

function categoryOutcome(results: readonly CommandEvidence[]): VerificationEvidenceState['outcome'] {
  if (results.some(result => result.providerFailed === true)) return 'provider_failed'
  if (results.some(result => result.timedOut === true)) return 'timed_out'
  if (results.some(result => result.stdoutTruncated === true || result.stderrTruncated === true)) return 'truncated'
  if (results.some(result => result.exitCode !== 0)) return 'failed'
  return 'passed'
}

/** Execute a frozen Verification Profile through the managed argv-only command seam. */
export class VerificationAdapter {
  constructor(private readonly commands: HarnessCommandExecutor) {}

  async run(
    configured: VerificationProfile,
    repository: RepositoryIdentity,
    signal: AbortSignal,
  ): Promise<VerificationCapture> {
    const profile = validateVerificationProfile(configured)
    const outcomes: VerificationEvidenceState[] = []
    const categories: unknown[] = []
    for (const category of CATEGORIES) {
      const policy = profile.categories[category]
      if (policy.mode === 'not_applicable') {
        outcomes.push({ category, outcome: 'not_applicable' })
        categories.push({ category, mode: 'not_applicable', reason: policy.reason })
        continue
      }
      const results: CommandEvidence[] = []
      for (const command of policy.commands) {
        if (signal.aborted) throw new Error('Verification was aborted')
        try {
          const result = await this.commands.execute({
            argv: command.argv,
            cwd: repository.canonicalRoot,
            timeoutMs: command.timeoutMs,
            signal,
            ...command.environmentNames === undefined ? {} : { environmentNames: command.environmentNames },
          })
          if (result.aborted && signal.aborted) throw new Error('Verification was aborted')
          results.push(commandEvidence(command, result))
        } catch (error) {
          if (signal.aborted) throw error
          results.push({
            name: command.name,
            argv: [...command.argv],
            environmentNames: [...command.environmentNames ?? []],
            providerFailed: true,
          })
        }
      }
      const outcome = categoryOutcome(results)
      outcomes.push({ category, outcome })
      categories.push({ category, mode: 'commands', outcome, commands: results })
    }
    return {
      payload: { schemaVersion: 1, profile: profile.name, categories },
      outcomes,
    }
  }
}
