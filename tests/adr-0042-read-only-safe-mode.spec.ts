import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MISSION_STORE_APPLICATION_ID,
  MISSION_STORE_SCHEMA_VERSION,
} from '../src/adapters/sqlite-mission-store.ts'
import { inspectControlPlane } from '../src/doctor.ts'
import EngineeringControlPlane from '../src/index.ts'
import type { Config } from '../src/config.ts'

const run = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function cleanRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-control-plane-adr-0042-repo-'))
  temporaryRoots.push(root)
  await run('git', ['init', '-b', 'main'], { cwd: root })
  await run('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root })
  await run('git', ['config', 'user.name', 'Fixture'], { cwd: root })
  await writeFile(join(root, 'README.md'), '# ADR 0042 fixture\n', 'utf8')
  await run('git', ['add', 'README.md'], { cwd: root })
  await run('git', ['commit', '-m', 'fixture baseline'], { cwd: root })
  return root
}

function config(repository: string, dshHome: string): Config {
  const notApplicable = { mode: 'not_applicable' as const, reason: 'Not required by the Safe Mode fixture.' }
  return {
    dshHome,
    subagentProvider: 'spawn',
    maxSubagentDepth: 1,
    rolePolicies: {
      planner: { allowTools: [], denyTools: [] },
      developer: { allowTools: [], denyTools: [] },
      tester: { allowTools: [], denyTools: [] },
      reviewer: { allowTools: [], denyTools: [] },
    },
    repositories: [{ root: repository, verificationProfile: 'safe-mode-fixture' }],
    verificationProfiles: [{
      name: 'safe-mode-fixture',
      categories: {
        functional: notApplicable,
        negative: notApplicable,
        regression: notApplicable,
        security: notApplicable,
      },
    }],
  }
}

describe('ADR 0042: startup failures enter read-only Safe Mode', () => {
  it('keeps the Service and doctor available while every Mission operation fails closed', async () => {
    const repository = await cleanRepository()
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-control-plane-adr-0042-home-'))
    temporaryRoots.push(dshHome)
    const stateRoot = join(dshHome, 'control-plane')
    const databasePath = join(stateRoot, 'control-plane.sqlite')
    await mkdir(stateRoot, { recursive: true })
    const foreign = new DatabaseSync(databasePath)
    foreign.exec(`PRAGMA application_id = ${MISSION_STORE_APPLICATION_ID}`)
    foreign.exec(`PRAGMA user_version = ${MISSION_STORE_SCHEMA_VERSION}`)
    foreign.close()
    const originalDatabase = await readFile(databasePath)
    const originalEntries = (await readdir(stateRoot)).sort()
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const subagentFiber = await ctx.plugin(SubagentRuntime)
    let serviceFiber: Awaited<ReturnType<Context['plugin']>> | undefined

    try {
      serviceFiber = await ctx.plugin(EngineeringControlPlane, config(repository, dshHome))
      const service = ctx.engineeringControlPlane
      const unavailable = { code: 'CONTROL_PLANE_UNAVAILABLE' }
      await expect(service.whenReady()).rejects.toMatchObject(unavailable)

      const agent = {
        id: 'agent-safe-mode-fixture',
        session: { header: { cwd: repository } },
      } as unknown as Agent
      const signal = new AbortController().signal
      await expect(service.start(agent, {
        idempotencyKey: 'safe-mode-start-1',
        objective: 'This Mission must not be admitted.',
      }, signal)).rejects.toMatchObject(unavailable)
      await expect(service.status(agent, 'mission-safe-mode-fixture', signal)).rejects.toMatchObject(unavailable)
      await expect(service.resume(agent, {
        missionId: 'mission-safe-mode-fixture',
        expectedRevision: 1,
      }, signal)).rejects.toMatchObject(unavailable)
      await expect(service.cancel(agent, {
        missionId: 'mission-safe-mode-fixture',
        expectedRevision: 1,
      }, signal)).rejects.toMatchObject(unavailable)
      await expect(service.rework(agent, {
        missionId: 'mission-safe-mode-fixture',
        expectedRevision: 1,
      }, signal)).rejects.toMatchObject(unavailable)

      await expect(inspectControlPlane({ dshHome })).resolves.toMatchObject({
        ok: false,
        issues: [expect.objectContaining({ code: 'corrupt_database' })],
      })
      expect(await readFile(databasePath)).toEqual(originalDatabase)
      expect((await readdir(stateRoot)).sort()).toEqual(originalEntries)
    } finally {
      await serviceFiber?.dispose()
      await subagentFiber.dispose()
      await subprocessFiber.dispose()
    }
  })
})
