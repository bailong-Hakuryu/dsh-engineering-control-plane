import { describe, expect, it } from 'vitest'
import {
  createControlPlaneKernel,
  createInMemoryMissionStore,
  type EffectivePolicy,
  type MissionAuthority,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/fixture-repository',
  branch: 'main',
  head: '1111111111111111111111111111111111111111',
  workspaceFingerprint: 'sha256:baseline',
}

const effectivePolicy: EffectivePolicy = {
  schemaVersion: 1,
  digest: 'sha256:policy',
  verificationProfile: 'fixture',
}

const authority: MissionAuthority = {
  principalId: 'agent:parent',
  repository,
  actions: ['start', 'read'],
  leaseHolderId: 'start-status-fixture-host',
  writeLease: { holderId: 'start-status-fixture-host', fencingToken: 1 },
}

describe('ControlPlaneKernel atomic Start through Status seam', () => {
  it('durably accepts explicit Mission intent and publishes revision 1', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-1',
      now: () => '2026-08-22T12:00:00.000Z',
      resolveEffectivePolicy: () => effectivePolicy,
    })

    const receipt = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'tool-call-1',
      input: {
        objective: 'Fix the authentication timeout',
        context: 'Timeout occurs after token refresh.',
        acceptanceCriteria: ['Requests survive one token refresh.'],
        constraints: ['Do not change the public authentication API.'],
      },
    }, authority)

    expect(receipt).toEqual({
      missionId: 'mission-1',
      revision: 1,
      status: 'CREATED',
      attempt: 1,
      acceptedAt: '2026-08-22T12:00:00.000Z',
    })

    await expect(kernel.snapshot('mission-1', authority)).resolves.toMatchObject({
      missionId: 'mission-1',
      revision: 1,
      repository,
      objective: 'Fix the authentication timeout',
      context: 'Timeout occurs after token refresh.',
      acceptanceCriteria: ['Requests survive one token refresh.'],
      constraints: ['Do not change the public authentication API.'],
      effectivePolicyDigest: 'sha256:policy',
      status: 'CREATED',
      attempt: 1,
      roleRuns: [],
      createdAt: '2026-08-22T12:00:00.000Z',
      updatedAt: '2026-08-22T12:00:00.000Z',
    })
  })

  it('replays the original receipt for an already accepted tool call', async () => {
    let issuedIds = 0
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => `mission-${++issuedIds}`,
      now: () => '2026-08-22T12:00:00.000Z',
      resolveEffectivePolicy: () => effectivePolicy,
    })
    const command = {
      kind: 'start' as const,
      idempotencyKey: 'tool-call-replayed',
      input: { objective: 'Make Start idempotent' },
    }

    const first = await kernel.dispatch(command, authority)
    const replay = await kernel.dispatch(command, authority)

    expect(replay).toEqual(first)
    expect(issuedIds).toBe(1)
  })

  it('rejects a second non-terminal Mission for the same canonical worktree', async () => {
    let issuedIds = 0
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => `mission-${++issuedIds}`,
      now: () => '2026-08-22T12:00:00.000Z',
      resolveEffectivePolicy: () => effectivePolicy,
    })
    await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'tool-call-first',
      input: { objective: 'First Mission' },
    }, authority)

    await expect(kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'tool-call-second',
      input: { objective: 'Conflicting Mission' },
    }, authority)).rejects.toMatchObject({
      code: 'repository_busy',
      missionId: 'mission-1',
      status: 'CREATED',
    })
    expect(issuedIds).toBe(1)
  })

  it('rejects Start before persistence when host authority lacks the action', async () => {
    let issuedIds = 0
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => `mission-${++issuedIds}`,
      now: () => '2026-08-22T12:00:00.000Z',
      resolveEffectivePolicy: () => effectivePolicy,
    })

    await expect(kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'unauthorized-start',
      input: { objective: 'Must not persist' },
    }, { ...authority, actions: ['read'] })).rejects.toMatchObject({
      code: 'authority_denied',
    })
    expect(issuedIds).toBe(0)
  })

  it('does not expose a Mission snapshot to authority for another repository', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-private',
      now: () => '2026-08-22T12:00:00.000Z',
      resolveEffectivePolicy: () => effectivePolicy,
    })
    await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'private-start',
      input: { objective: 'Repository-scoped Mission' },
    }, authority)

    await expect(kernel.snapshot('mission-private', {
      ...authority,
      repository: { ...repository, canonicalRoot: 'D:/other-repository' },
    })).rejects.toMatchObject({ code: 'authority_denied' })
  })
})
