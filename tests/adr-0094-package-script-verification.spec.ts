import { readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it } from 'vitest'
import type { Config } from '../src/config.ts'
import { HarnessCommandExecutor, type CommandExecutionResult } from '../src/adapters/harness-command-executor.ts'
import {
  validateVerificationProfile,
  VerificationAdapter,
  type VerificationProfile,
} from '../src/adapters/verification.ts'
import type { RepositoryIdentity } from '../src/kernel/types.ts'
import { resolveDeploymentConfig } from '../src/policy.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function nodeScriptsProfile(): VerificationProfile {
  return {
    name: 'node-package-scripts',
    categories: {
      functional: { mode: 'package_script', script: 'test', timeoutMs: 60_000, missing: 'failed' },
      negative: { mode: 'package_script', script: 'typecheck', timeoutMs: 60_000, missing: 'not_applicable' },
      regression: { mode: 'package_script', script: 'build', timeoutMs: 60_000, missing: 'not_applicable' },
      security: { mode: 'not_applicable', reason: 'Security Assurance owns this category.' },
    },
  }
}

async function repository(files: Readonly<Record<string, string>>): Promise<RepositoryIdentity> {
  const root = await mkdtemp(join(tmpdir(), 'dcp-package-script-'))
  roots.push(root)
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content, 'utf8')
  return { canonicalRoot: root } as RepositoryIdentity
}

function packageJson(scripts: Readonly<Record<string, string>>, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ name: 'fixture', private: true, scripts, ...extra }, null, 2)}\n`
}

/** Records every argv it is asked to run and reports success without running anything. */
class RecordingExecutor {
  readonly calls: string[][] = []

  execute(spec: { readonly argv: readonly string[] }): Promise<CommandExecutionResult> {
    this.calls.push([...spec.argv])
    return Promise.resolve({
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      environmentNames: [],
    } as unknown as CommandExecutionResult)
  }
}

async function verify(files: Readonly<Record<string, string>>) {
  const executor = new RecordingExecutor()
  const adapter = new VerificationAdapter(executor as unknown as HarnessCommandExecutor)
  const capture = await adapter.run(nodeScriptsProfile(), await repository(files), new AbortController().signal)
  return { calls: executor.calls, capture }
}

function outcomes(capture: Awaited<ReturnType<typeof verify>>['capture']) {
  return Object.fromEntries(capture.outcomes.map(item => [item.category, item.outcome]))
}

describe('ADR 0094 package-script verification', () => {
  it('runs scripts through the pnpm lockfile without letting pnpm install first', async () => {
    const { calls, capture } = await verify({
      'package.json': packageJson({ test: 'node --test', typecheck: 'tsc --noEmit' }),
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    })

    expect(calls).toEqual([
      ['pnpm', '--config.verify-deps-before-run=false', 'run', 'test'],
      ['pnpm', '--config.verify-deps-before-run=false', 'run', 'typecheck'],
    ])
    expect(outcomes(capture)).toEqual({
      functional: 'passed',
      negative: 'passed',
      regression: 'not_applicable',
      security: 'not_applicable',
    })
    expect(capture.payload).toMatchObject({
      categories: expect.arrayContaining([
        expect.objectContaining({
          category: 'regression',
          mode: 'package_script',
          script: 'build',
          outcome: 'not_applicable',
          reason: expect.stringContaining('build'),
        }),
      ]),
    })
  })

  it.each([
    ['the packageManager field over any lockfile', { packageManager: 'yarn@4.1.0' }, { 'pnpm-lock.yaml': '' }, 'yarn'],
    ['an npm lockfile', {}, { 'package-lock.json': '{}' }, 'npm'],
    ['a Yarn lockfile', {}, { 'yarn.lock': '' }, 'yarn'],
    ['a Bun lockfile', {}, { 'bun.lock': '' }, 'bun'],
    ['npm when nothing declares a manager', {}, {}, 'npm'],
  ] as const)('chooses %s', async (_label, manifest, lockfiles, manager) => {
    const { calls } = await verify({
      'package.json': packageJson({ test: 'node --test' }, manifest),
      ...lockfiles,
    })
    expect(calls[0]?.[0]).toBe(manager)
    expect(calls[0]?.slice(-2)).toEqual(['run', 'test'])
  })

  it('fails a required script the repository does not define, without running anything', async () => {
    const { calls, capture } = await verify({ 'package.json': packageJson({ lint: 'eslint .' }) })

    expect(calls).toEqual([])
    expect(outcomes(capture)).toMatchObject({
      functional: 'failed',
      negative: 'not_applicable',
      regression: 'not_applicable',
    })
    expect(capture.payload).toMatchObject({
      categories: expect.arrayContaining([
        expect.objectContaining({ category: 'functional', outcome: 'failed', reason: expect.stringContaining('test') }),
      ]),
    })
  })

  it('treats a repository without a readable package.json as having no scripts', async () => {
    const { calls, capture } = await verify({ 'README.md': '# not a Node package\n' })
    expect(calls).toEqual([])
    expect(outcomes(capture)).toMatchObject({ functional: 'failed', negative: 'not_applicable' })
  })

  it('rejects unusable package-script policies before they can be frozen', () => {
    const invalid = (category: object) => () => validateVerificationProfile({
      ...nodeScriptsProfile(),
      categories: { ...nodeScriptsProfile().categories, functional: category as never },
    })
    expect(invalid({ mode: 'package_script', script: '', timeoutMs: 1_000, missing: 'failed' })).toThrow(/package_script/)
    expect(invalid({ mode: 'package_script', script: 'test&whoami', timeoutMs: 1_000, missing: 'failed' })).toThrow(/package_script/)
    expect(invalid({ mode: 'package_script', script: 'test', timeoutMs: 0, missing: 'failed' })).toThrow(/package_script/)
    expect(invalid({ mode: 'package_script', script: 'test', timeoutMs: 1_000, missing: 'skip' })).toThrow(/package_script/)
  })

  it('freezes a package-script category into the deployment policy unchanged', () => {
    const config = {
      subagentProvider: 'spawn',
      maxSubagentDepth: 1,
      rolePolicies: {
        planner: { allowTools: ['read'], denyTools: [] },
        developer: { allowTools: ['read', 'edit'], denyTools: [] },
        tester: { allowTools: ['read'], denyTools: [] },
        reviewer: { allowTools: ['read'], denyTools: [] },
      },
      repositories: [{ root: 'D:/fixture', verificationProfile: 'node-package-scripts' }],
      verificationProfiles: [nodeScriptsProfile()],
    } as unknown as Config
    const resolved = resolveDeploymentConfig(config)
    expect(resolved.verificationProfiles.get('node-package-scripts')?.categories.functional).toEqual({
      mode: 'package_script',
      script: 'test',
      timeoutMs: 60_000,
      missing: 'failed',
    })
  })

  it('ships a direct-use profile that resolves scripts instead of assuming pnpm', () => {
    const bundlePatch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(bundlePatch).not.toMatch(/argv: \[pnpm/u)
    expect(bundlePatch).toMatch(/functional:\s+mode: package_script\s+script: test\s+timeoutMs: \d+\s+missing: failed/u)
    expect(bundlePatch).toMatch(/negative:\s+mode: package_script\s+script: typecheck\s+timeoutMs: \d+\s+missing: not_applicable/u)
    expect(bundlePatch).toMatch(/regression:\s+mode: package_script\s+script: build\s+timeoutMs: \d+\s+missing: not_applicable/u)
  })

  it('never runs install lifecycle scripts while verifying a pnpm repository', async () => {
    const repo = await repository({
      'package.json': packageJson({
        test: 'node -e "console.log(\'verified\')"',
        postinstall: 'node -e "require(\'fs\').writeFileSync(\'POSTINSTALL-RAN\', \'x\')"',
      }),
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n",
    })
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      const adapter = new VerificationAdapter(new HarnessCommandExecutor({ subprocess: ctx.subprocess }))
      const capture = await adapter.run(nodeScriptsProfile(), repo, new AbortController().signal)
      expect(outcomes(capture).functional).toBe('passed')
      const entries = await readdir(repo.canonicalRoot)
      expect(entries).not.toContain('POSTINSTALL-RAN')
      expect(entries).not.toContain('node_modules')
    } finally {
      await subprocessFiber.dispose()
    }
  }, 60_000)
})
