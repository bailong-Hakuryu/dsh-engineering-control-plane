import { extname } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

export interface CommandExecutionSpec {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
  readonly signal: AbortSignal
  readonly environmentNames?: readonly string[]
}

/** Complete bounded command facts consumed by repository inspection and Verification. */
export interface CommandExecutionResult {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly environmentNames: readonly string[]
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly timedOut: boolean
  readonly aborted: boolean
  readonly stdout: string
  readonly stderr: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
}

export interface HarnessCommandExecutorOptions {
  readonly subprocess: Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>
  readonly maxStdoutBytes?: number
  readonly maxStderrBytes?: number
  readonly terminationGraceMs?: number
  readonly platform?: NodeJS.Platform
  readonly windowsCommandInterpreter?: string
}

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u
const COUNTED_GIT_CONFIG_ENVIRONMENT = /^GIT_CONFIG_(?:COUNT|KEY_[0-9]+|VALUE_[0-9]+)$/iu
const WINDOWS_COMMAND_SHIM_EXTENSION = /^\.(?:bat|cmd)$/iu
const WINDOWS_COMMAND_META = /[\r\n"&|<>()^%!]/u

/**
 * Managed argv-only command executor over `ctx.subprocess`. Windows batch
 * shims require `cmd.exe`; that compatibility path accepts only arguments
 * without command-interpreter metacharacters and keeps the original argv in
 * Evidence.
 */
export class HarnessCommandExecutor {
  private readonly maxStdoutBytes: number
  private readonly maxStderrBytes: number
  private readonly terminationGraceMs: number
  private readonly platform: NodeJS.Platform
  private readonly windowsCommandInterpreter: string

  constructor(private readonly options: HarnessCommandExecutorOptions) {
    this.maxStdoutBytes = options.maxStdoutBytes ?? 4 * 1024 * 1024
    this.maxStderrBytes = options.maxStderrBytes ?? 4 * 1024 * 1024
    this.terminationGraceMs = options.terminationGraceMs ?? 2_000
    this.platform = options.platform ?? process.platform
    this.windowsCommandInterpreter = options.windowsCommandInterpreter ?? process.env.ComSpec ?? 'cmd.exe'
    for (const [name, value] of Object.entries({
      maxStdoutBytes: this.maxStdoutBytes,
      maxStderrBytes: this.maxStderrBytes,
      terminationGraceMs: this.terminationGraceMs,
    })) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`)
    }
  }

  async execute(spec: CommandExecutionSpec): Promise<CommandExecutionResult> {
    if (spec.argv.length === 0 || spec.argv.some(argument => typeof argument !== 'string')) {
      throw new TypeError('Command argv must contain at least one string')
    }
    if (!Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs < 1 || spec.timeoutMs > 2_147_483_647) {
      throw new RangeError('Command timeoutMs must be a positive signed 32-bit integer')
    }
    const environmentNames = [...new Set(spec.environmentNames ?? [])]
    const env: NodeJS.ProcessEnv = {}
    // Harness scrubs credential-shaped names such as GIT_CONFIG_KEY_0. A
    // surviving COUNT/VALUE without its KEY makes every child Git invocation
    // fail, so remove the whole ambient counted-config group atomically. Host
    // policy can still restore an explicitly named complete group below.
    for (const name of Object.keys(process.env)) {
      if (COUNTED_GIT_CONFIG_ENVIRONMENT.test(name)) env[name] = undefined
    }
    for (const name of environmentNames) {
      if (!ENVIRONMENT_NAME.test(name)) throw new TypeError(`Invalid environment reference '${name}'`)
      const value = process.env[name]
      if (value === undefined) throw new Error(`Required environment reference '${name}' is not set`)
      env[name] = value
    }

    const controller = new AbortController()
    let timedOut = false
    const abortFromCaller = (): void => controller.abort(spec.signal.reason)
    spec.signal.addEventListener('abort', abortFromCaller, { once: true })
    if (spec.signal.aborted) abortFromCaller()
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('command timeout'))
    }, spec.timeoutMs)

    try {
      const resolvedEnvironment = Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      )
      const executable = await this.options.subprocess.resolveExecutable(
        spec.argv[0]!,
        resolvedEnvironment,
        controller.signal,
      )
      let spawnArgv = [executable, ...spec.argv.slice(1)]
      if (this.platform === 'win32' && WINDOWS_COMMAND_SHIM_EXTENSION.test(extname(executable))) {
        const unsafeIndex = spawnArgv.findIndex(argument => WINDOWS_COMMAND_META.test(argument))
        if (unsafeIndex !== -1) {
          throw new Error(`Windows command shim argv[${unsafeIndex}] contains unsupported command-interpreter metacharacters`)
        }
        const commandInterpreter = await this.options.subprocess.resolveExecutable(
          this.windowsCommandInterpreter,
          resolvedEnvironment,
          controller.signal,
        )
        spawnArgv = [commandInterpreter, '/d', '/s', '/v:off', '/c', 'call', ...spawnArgv]
      }
      const handle = this.options.subprocess.spawn({
        argv: spawnArgv,
        cwd: spec.cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: this.maxStdoutBytes },
          stderr: { maxBytes: this.maxStderrBytes },
        },
        graceMs: this.terminationGraceMs,
        signal: controller.signal,
        env,
      })
      const outcome = await handle.done
      await handle.waitForExit()
      const stdout = handle.collected.stdout?.readFrom(0)
      const stderr = handle.collected.stderr?.readFrom(0)
      return {
        argv: [...spec.argv],
        cwd: spec.cwd,
        environmentNames,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        timedOut,
        aborted: spec.signal.aborted,
        stdout: stdout?.text ?? '',
        stderr: stderr?.text ?? '',
        stdoutTruncated: stdout?.lossy ?? false,
        stderrTruncated: stderr?.lossy ?? false,
      }
    } finally {
      clearTimeout(timer)
      spec.signal.removeEventListener('abort', abortFromCaller)
    }
  }
}
