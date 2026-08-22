import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import type { RepositoryIdentity } from '../kernel/types.js'
import type { ImplementationCapture } from '../runner/mission-runner.js'
import type { RepositoryObservation, RepositoryObserver } from './harness-role-executor.js'
import { HarnessCommandExecutor, type CommandExecutionResult } from './harness-command-executor.js'

export interface GitRepositoryAdapterOptions {
  readonly commands: HarnessCommandExecutor
  readonly gitCommand?: string
  readonly commandTimeoutMs?: number
  readonly maxUntrackedFiles?: number
  readonly maxUntrackedBytes?: number
}

interface UntrackedEvidence {
  readonly path: string
  readonly byteLength: number
  readonly digest: string
  readonly content?: string
  readonly binary: boolean
}

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000
const DEFAULT_MAX_UNTRACKED_FILES = 256
const DEFAULT_MAX_UNTRACKED_BYTES = 32 * 1024 * 1024

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function firstLine(value: string): string {
  return value.replaceAll('\r', '').split('\n')[0]?.trim() ?? ''
}

function assertInside(root: string, candidate: string): void {
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error('Git reported a path outside the canonical worktree')
  }
}

/** Redact common assignment, bearer-token, and private-key forms before Evidence persistence. */
export function redactPotentialSecrets(text: string): { readonly text: string; readonly count: number } {
  let count = 0
  const replace = (_match: string, prefix = ''): string => {
    count += 1
    return `${prefix}[REDACTED]`
  }
  let redacted = text.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu,
    match => replace(match),
  )
  redacted = redacted.replace(
    /(Bearer\s+)[A-Za-z0-9._~+/-]{8,}={0,2}/giu,
    (match, prefix: string) => replace(match, prefix),
  )
  redacted = redacted.replace(
    /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|token)\s*[:=]\s*["']?)([^\s"'\\]{8,})/giu,
    (match, prefix: string) => replace(match, prefix),
  )
  return { text: redacted, count }
}

/** Git-backed Repository Identity, workspace inspection, and Implementation Evidence Adapter. */
export class GitRepositoryAdapter implements RepositoryObserver {
  private readonly gitCommand: string
  private readonly commandTimeoutMs: number
  private readonly maxUntrackedFiles: number
  private readonly maxUntrackedBytes: number

  constructor(private readonly options: GitRepositoryAdapterOptions) {
    this.gitCommand = options.gitCommand ?? 'git'
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    this.maxUntrackedFiles = options.maxUntrackedFiles ?? DEFAULT_MAX_UNTRACKED_FILES
    this.maxUntrackedBytes = options.maxUntrackedBytes ?? DEFAULT_MAX_UNTRACKED_BYTES
    for (const [name, value] of Object.entries({
      commandTimeoutMs: this.commandTimeoutMs,
      maxUntrackedFiles: this.maxUntrackedFiles,
      maxUntrackedBytes: this.maxUntrackedBytes,
    })) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`)
    }
  }

  /** Derive and freeze a clean canonical worktree identity from the calling Session cwd. */
  async deriveStartIdentity(cwd: string, signal: AbortSignal): Promise<RepositoryIdentity> {
    const canonicalRoot = await this.canonicalRoot(cwd, signal)
    const observation = await this.observe(canonicalRoot, signal)
    const status = await this.status(canonicalRoot, signal)
    if (status.length > 0) throw new Error('mission_start requires a clean Git worktree and index')
    return { canonicalRoot, ...observation }
  }

  /** Resolve only canonical worktree ownership for Status/control calls, even when the worktree is dirty. */
  async canonicalRoot(cwd: string, signal: AbortSignal): Promise<string> {
    if (!isAbsolute(cwd)) throw new Error('Calling Session cwd must be absolute')
    const canonicalCwd = await realpath(cwd)
    const rootResult = await this.git(['rev-parse', '--show-toplevel'], canonicalCwd, signal)
    return realpath(firstLine(rootResult.stdout))
  }

  async observe(canonicalRoot: string, signal: AbortSignal): Promise<RepositoryObservation> {
    const branch = firstLine((await this.git(
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      canonicalRoot,
      signal,
    )).stdout)
    if (branch.length === 0) throw new Error('Detached HEAD is not supported for a Mission')
    const head = firstLine((await this.git(['rev-parse', 'HEAD'], canonicalRoot, signal)).stdout)
    if (!/^[0-9a-f]{40,64}$/u.test(head)) throw new Error('Git returned an invalid HEAD object id')
    const status = await this.status(canonicalRoot, signal)
    return {
      branch,
      head,
      workspaceFingerprint: sha256(`${branch}\0${head}\0${status}`),
    }
  }

  /** Capture complete bounded change facts relative to the frozen HEAD without modifying the worktree. */
  async captureImplementation(
    repository: RepositoryIdentity,
    signal: AbortSignal,
  ): Promise<ImplementationCapture> {
    const current = await this.observe(repository.canonicalRoot, signal)
    const workspacePolicyViolations: string[] = []
    if (current.branch !== repository.branch) workspacePolicyViolations.push('git_branch_changed')
    if (current.head !== repository.head) workspacePolicyViolations.push('git_head_changed')

    const diffResult = await this.options.commands.execute({
      argv: [this.gitCommand, 'diff', '--binary', '--no-ext-diff', 'HEAD', '--'],
      cwd: repository.canonicalRoot,
      timeoutMs: this.commandTimeoutMs,
      signal,
    })
    this.requireGitExit(diffResult, 'capture tracked implementation diff')
    if (diffResult.stdoutTruncated || diffResult.stderrTruncated) {
      workspacePolicyViolations.push('implementation_diff_truncated')
    }
    const redactedDiff = redactPotentialSecrets(diffResult.stdout)

    const untrackedResult = await this.options.commands.execute({
      argv: [this.gitCommand, 'ls-files', '--others', '--exclude-standard', '-z'],
      cwd: repository.canonicalRoot,
      timeoutMs: this.commandTimeoutMs,
      signal,
    })
    this.requireGitExit(untrackedResult, 'enumerate untracked implementation files')
    if (untrackedResult.stdoutTruncated || untrackedResult.stderrTruncated) {
      workspacePolicyViolations.push('untracked_listing_truncated')
    }
    const paths = untrackedResult.stdout.split('\0').filter(Boolean)
    if (paths.length > this.maxUntrackedFiles) workspacePolicyViolations.push('untracked_file_count_exceeded')

    const untracked: UntrackedEvidence[] = []
    let untrackedBytes = 0
    let secretCount = redactedDiff.count
    for (const path of paths.slice(0, this.maxUntrackedFiles)) {
      const absolute = resolve(repository.canonicalRoot, ...path.split('/'))
      try {
        assertInside(repository.canonicalRoot, absolute)
        const before = await lstat(absolute)
        if (!before.isFile()) {
          workspacePolicyViolations.push(`untracked_non_regular:${path}`)
          continue
        }
        if (untrackedBytes + before.size > this.maxUntrackedBytes) {
          workspacePolicyViolations.push('untracked_byte_budget_exceeded')
          break
        }
        const bytes = await readFile(absolute)
        const after = await lstat(absolute)
        if (
          before.size !== after.size
          || before.mtimeMs !== after.mtimeMs
          || (before.ino !== 0 && after.ino !== 0 && before.ino !== after.ino)
        ) {
          workspacePolicyViolations.push(`untracked_file_changed_during_capture:${path}`)
          continue
        }
        untrackedBytes += bytes.byteLength
        const binary = bytes.includes(0)
        if (binary) {
          workspacePolicyViolations.push(`untracked_binary_content_opaque:${path}`)
          untracked.push({
            path,
            byteLength: bytes.byteLength,
            digest: sha256(bytes),
            binary: true,
          })
          continue
        }
        const redacted = redactPotentialSecrets(bytes.toString('utf8'))
        secretCount += redacted.count
        untracked.push({
          path,
          byteLength: bytes.byteLength,
          digest: sha256(bytes),
          content: redacted.text,
          binary: false,
        })
      } catch {
        workspacePolicyViolations.push(`untracked_capture_failed:${path}`)
      }
    }

    return {
      payload: {
        schemaVersion: 1,
        baseline: repository,
        observed: current,
        trackedDiff: redactedDiff.text,
        trackedDiffTruncated: diffResult.stdoutTruncated,
        untracked,
      },
      subject: {
        kind: 'git_worktree',
        branch: current.branch,
        head: current.head,
        workspaceFingerprint: current.workspaceFingerprint,
      },
      implementationSecretCount: secretCount,
      workspacePolicyViolations: [...new Set(workspacePolicyViolations)],
    }
  }

  private async status(root: string, signal: AbortSignal): Promise<string> {
    return (await this.git(
      ['status', '--porcelain=v2', '-z', '--untracked-files=all'],
      root,
      signal,
    )).stdout
  }

  private async git(args: readonly string[], cwd: string, signal: AbortSignal): Promise<CommandExecutionResult> {
    const result = await this.options.commands.execute({
      argv: [this.gitCommand, ...args],
      cwd,
      timeoutMs: this.commandTimeoutMs,
      signal,
    })
    this.requireGitExit(result, args[0] ?? 'Git operation')
    if (result.stdoutTruncated || result.stderrTruncated) throw new Error(`Git ${args[0] ?? 'operation'} output was truncated`)
    return result
  }

  private requireGitExit(result: CommandExecutionResult, operation: string): void {
    if (result.timedOut) throw new Error(`Git timed out while attempting to ${operation}`)
    if (result.aborted) throw new Error(`Git was aborted while attempting to ${operation}`)
    if (result.exitCode !== 0) throw new Error(`Git could not ${operation} (exit ${result.exitCode ?? 'signal'})`)
  }
}
