import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
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
  | {
    /**
     * Run one `package.json` script through the repository's own package
     * manager, never letting that manager install first (ADR 0094).
     */
    readonly mode: 'package_script'
    readonly script: string
    readonly timeoutMs: number
    /** Outcome when the repository defines no such script. */
    readonly missing: 'failed' | 'not_applicable'
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
const PACKAGE_SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

/** Lockfiles in precedence order when `packageManager` does not decide. */
const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
]
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
    if (policy.mode === 'package_script') {
      if (typeof policy.script !== 'string' || !PACKAGE_SCRIPT_NAME.test(policy.script)) {
        throw new Error(`${category} package_script requires a plain script name`)
      }
      if (!Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs < 1) {
        throw new Error(`${category} package_script has an invalid timeoutMs`)
      }
      if (policy.missing !== 'failed' && policy.missing !== 'not_applicable') {
        throw new Error(`${category} package_script missing must be failed or not_applicable`)
      }
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

interface PackageManifest {
  readonly scripts: Readonly<Record<string, unknown>>
  readonly packageManager: unknown
}

/** Read the repository's own manifest; an absent or unreadable one declares no scripts. */
async function readPackageManifest(root: string): Promise<PackageManifest | undefined> {
  try {
    const bytes = await readFile(join(root, 'package.json'))
    if (bytes.byteLength > MAX_PACKAGE_MANIFEST_BYTES) return undefined
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    const scripts = record['scripts']
    return {
      scripts: typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts)
        ? scripts as Record<string, unknown>
        : {},
      packageManager: record['packageManager'],
    }
  } catch {
    return undefined
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false)
}

/** The manager the repository declares: `packageManager` first, then its lockfile, else npm. */
async function resolvePackageManager(root: string, manifest: PackageManifest): Promise<PackageManager> {
  const declared = typeof manifest.packageManager === 'string'
    ? /^(npm|pnpm|yarn|bun)@/u.exec(manifest.packageManager)?.[1]
    : undefined
  if (declared !== undefined) return declared as PackageManager
  for (const [lockfile, manager] of LOCKFILES) {
    if (await exists(join(root, lockfile))) return manager
  }
  return 'npm'
}

/**
 * Run a script without installing. pnpm verifies dependencies before `run`
 * and installs when they look stale, which also runs the root package's
 * install lifecycle scripts; the other managers never install on `run`.
 */
function packageScriptArgv(manager: PackageManager, script: string): string[] {
  return manager === 'pnpm'
    ? ['pnpm', '--config.verify-deps-before-run=false', 'run', script]
    : [manager, 'run', script]
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
      let commands: readonly VerificationCommandConfig[] = policy.mode === 'commands' ? policy.commands : []
      let packageManager: PackageManager | undefined
      if (policy.mode === 'package_script') {
        const manifest = await readPackageManifest(repository.canonicalRoot)
        const body = manifest?.scripts[policy.script]
        if (manifest === undefined || typeof body !== 'string' || body.trim().length === 0) {
          const reason = manifest === undefined
            ? `The repository has no readable package.json, so it defines no '${policy.script}' script.`
            : `package.json defines no '${policy.script}' script.`
          outcomes.push({ category, outcome: policy.missing })
          categories.push({ category, mode: 'package_script', script: policy.script, outcome: policy.missing, reason })
          continue
        }
        packageManager = await resolvePackageManager(repository.canonicalRoot, manifest)
        commands = [{
          name: policy.script,
          argv: packageScriptArgv(packageManager, policy.script),
          timeoutMs: policy.timeoutMs,
          environmentNames: [],
        }]
      }
      const results: CommandEvidence[] = []
      for (const command of commands) {
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
      categories.push(policy.mode === 'package_script'
        ? { category, mode: 'package_script', script: policy.script, packageManager, outcome, commands: results }
        : { category, mode: 'commands', outcome, commands: results })
    }
    return {
      payload: { schemaVersion: 1, profile: profile.name, categories },
      outcomes,
    }
  }
}
