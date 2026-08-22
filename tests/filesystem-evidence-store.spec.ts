import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFilesystemEvidenceStore } from '../src/evidence/filesystem-store.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporaryEvidenceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evidence-'))
  temporaryRoots.push(root)
  return root
}

describe('FilesystemEvidenceStore', () => {
  it('publishes canonical, redacted Evidence and verifies it by digest', async () => {
    const root = await temporaryEvidenceRoot()
    const store = createFilesystemEvidenceStore({
      root,
      maxRecordBytes: 16_384,
      nextRecordId: () => 'record-context-1',
      now: () => '2026-08-22T17:00:00.000Z',
    })

    const record = await store.publish({
      missionId: 'mission-evidence',
      attempt: 1,
      kind: 'context',
      schemaVersion: 1,
      payload: {
        objective: 'Persist governed facts',
        nested: { z: true, a: 1 },
        apiToken: 'must-never-reach-disk',
      },
    })

    expect(record).toMatchObject({
      recordId: 'record-context-1',
      missionId: 'mission-evidence',
      attempt: 1,
      kind: 'context',
      schemaVersion: 1,
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      redacted: true,
      createdAt: '2026-08-22T17:00:00.000Z',
    })
    await expect(store.read(record)).resolves.toEqual({
      apiToken: '[REDACTED]',
      nested: { a: 1, z: true },
      objective: 'Persist governed facts',
    })
    await expect(store.inspect(record)).resolves.toEqual({ state: 'valid' })

    const absolutePath = resolve(root, ...record.relativePath.split('/'))
    expect(absolutePath.startsWith(resolve(root))).toBe(true)
    expect(await readFile(absolutePath, 'utf8')).not.toContain('must-never-reach-disk')
    const contextView = await readFile(
      join(root, 'mission-evidence', 'attempt-0001', 'context.md'),
      'utf8',
    )
    expect(contextView).toContain('Non-authoritative Evidence View')
    expect(contextView).toContain('[REDACTED]')
    expect(contextView).not.toContain('must-never-reach-disk')
  })

  it('projects implementation Evidence to the required non-authoritative diff view', async () => {
    const root = await temporaryEvidenceRoot()
    const store = createFilesystemEvidenceStore({
      root,
      nextRecordId: () => 'record-implementation-1',
      now: () => '2026-08-22T17:00:00.000Z',
    })
    await store.publish({
      missionId: 'mission-view',
      attempt: 2,
      kind: 'implementation',
      schemaVersion: 1,
      payload: {
        capture: {
          trackedDiff: 'diff --git a/a.ts b/a.ts\n+export const answer = 42\n',
          untracked: [{ path: 'new.ts', digest: 'sha256:new-file' }],
        },
      },
    })

    const view = await readFile(
      join(root, 'mission-view', 'attempt-0002', 'implementation.diff'),
      'utf8',
    )
    expect(view).toContain('diff --git a/a.ts b/a.ts')
    expect(view).toContain('+export const answer = 42')
    expect(view).toContain('new.ts')
    expect(view).toContain('Non-authoritative Evidence View')
  })

  it('reports corrupt when a published Evidence envelope is changed', async () => {
    const root = await temporaryEvidenceRoot()
    const store = createFilesystemEvidenceStore({
      root,
      maxRecordBytes: 16_384,
      nextRecordId: () => 'record-plan-1',
      now: () => '2026-08-22T17:00:00.000Z',
    })
    const record = await store.publish({
      missionId: 'mission-tamper',
      attempt: 1,
      kind: 'plan',
      schemaVersion: 1,
      payload: { steps: ['test', 'implement'] },
    })
    const absolutePath = resolve(root, ...record.relativePath.split('/'))
    await writeFile(absolutePath, '{"payload":{"steps":[]}}', 'utf8')

    await expect(store.inspect(record)).resolves.toEqual({ state: 'corrupt' })
    await expect(store.read(record)).rejects.toMatchObject({ code: 'corrupt_evidence' })
  })

  it('rejects an artifact that exceeds its hard byte budget', async () => {
    const root = await temporaryEvidenceRoot()
    const store = createFilesystemEvidenceStore({
      root,
      maxRecordBytes: 256,
      nextRecordId: () => 'record-too-large',
      now: () => '2026-08-22T17:00:00.000Z',
    })

    await expect(store.publish({
      missionId: 'mission-budget',
      attempt: 1,
      kind: 'implementation',
      schemaVersion: 1,
      payload: { diff: 'x'.repeat(2_048) },
    })).rejects.toMatchObject({ code: 'artifact_too_large' })
  })
})
