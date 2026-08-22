import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it } from 'vitest'
import { GitRepositoryAdapter } from '../src/adapters/git-repository.ts'
import { HarnessCommandExecutor } from '../src/adapters/harness-command-executor.ts'

const run = promisify(execFile)
const temporaryRoots: string[] = []
const originalGitConfigEnvironment = new Map(
  Object.entries(process.env).filter(([name]) => name.startsWith('GIT_CONFIG_')),
)

function clearGitConfigEnvironment(): void {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('GIT_CONFIG_')) delete process.env[name]
  }
}

afterEach(async () => {
  clearGitConfigEnvironment()
  for (const [name, value] of originalGitConfigEnvironment) process.env[name] = value
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Git repository execution environment', () => {
  it('keeps ambient counted Git config atomic when credential-shaped names are scrubbed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-control-plane-git-environment-'))
    temporaryRoots.push(root)
    await run('git', ['init', '-b', 'main'], { cwd: root })
    await run('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root })
    await run('git', ['config', 'user.name', 'Fixture'], { cwd: root })
    await writeFile(join(root, 'README.md'), '# fixture\n', 'utf8')
    await run('git', ['add', 'README.md'], { cwd: root })
    await run('git', ['commit', '-m', 'fixture baseline'], { cwd: root })

    clearGitConfigEnvironment()
    process.env.GIT_CONFIG_COUNT = '1'
    process.env.GIT_CONFIG_KEY_0 = 'core.abbrev'
    process.env.GIT_CONFIG_VALUE_0 = '12'

    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      const commands = new HarnessCommandExecutor({ subprocess: ctx.subprocess })
      const repository = new GitRepositoryAdapter({ commands })

      await expect(repository.canonicalRoot(
        root,
        new AbortController().signal,
      )).resolves.toBe(await realpath(root))
    } finally {
      await subprocessFiber.dispose()
    }
  })
})
