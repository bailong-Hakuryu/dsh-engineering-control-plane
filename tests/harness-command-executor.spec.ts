import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it } from 'vitest'
import { HarnessCommandExecutor } from '../src/adapters/harness-command-executor.ts'

describe('HarnessCommandExecutor', () => {
  const itOnWindows = process.platform === 'win32' ? it : it.skip

  itOnWindows('executes a Windows package-manager command shim without spawn EINVAL', async () => {
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      const commands = new HarnessCommandExecutor({ subprocess: ctx.subprocess })
      const result = await commands.execute({
        argv: ['pnpm', '--version'],
        cwd: process.cwd(),
        timeoutMs: 30_000,
        signal: new AbortController().signal,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/u)
    } finally {
      await subprocessFiber.dispose()
    }
  })

  itOnWindows('rejects command-interpreter metacharacters before dispatching a Windows shim', async () => {
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      const commands = new HarnessCommandExecutor({ subprocess: ctx.subprocess })
      await expect(commands.execute({
        argv: ['pnpm', '--filter=package&whoami', 'test'],
        cwd: process.cwd(),
        timeoutMs: 30_000,
        signal: new AbortController().signal,
      })).rejects.toThrow('contains unsupported command-interpreter metacharacters')
    } finally {
      await subprocessFiber.dispose()
    }
  })
})
