import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as clientPlugin from '../src/client.ts'
import type { MissionProjectionSnapshot } from '../src/client.ts'

function snapshot(revision: number, status: MissionProjectionSnapshot['status']): MissionProjectionSnapshot {
  return {
    missionId: 'mission-client-fixture',
    revision,
    status,
    attempt: 1,
    writeLease: { fencingToken: 1, active: status !== 'BLOCKED' },
    roleRuns: [{ runId: 'planner-1', role: 'planner', state: 'completed' }],
    evidenceCount: revision,
  }
}

describe('Mission Web projection', () => {
  it('applies contiguous whole snapshots and requests resync across a revision gap', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(clientPlugin)
    const observed: number[] = []
    ctx.engineeringControlPlaneProjection.subscribe(value => observed.push(value.revision))

    ctx.engineeringControlPlaneProjection.installSnapshot(snapshot(4, 'PLANNING'))
    expect(ctx.engineeringControlPlaneProjection.applyEvent({
      missionId: 'mission-client-fixture',
      revision: 5,
      snapshot: snapshot(5, 'IMPLEMENTING'),
    })).toMatchObject({ kind: 'applied', snapshot: { revision: 5, status: 'IMPLEMENTING' } })

    expect(ctx.engineeringControlPlaneProjection.applyEvent({
      missionId: 'mission-client-fixture',
      revision: 5,
      snapshot: snapshot(5, 'IMPLEMENTING'),
    })).toEqual({ kind: 'stale', currentRevision: 5 })
    expect(ctx.engineeringControlPlaneProjection.applyEvent({
      missionId: 'mission-client-fixture',
      revision: 7,
      snapshot: snapshot(7, 'VERIFYING'),
    })).toEqual({
      kind: 'resync_required',
      missionId: 'mission-client-fixture',
      expectedRevision: 6,
      receivedRevision: 7,
    })
    expect(ctx.engineeringControlPlaneProjection.get('mission-client-fixture')?.revision).toBe(5)
    expect(observed).toEqual([4, 5])

    ctx.engineeringControlPlaneProjection.installSnapshot(snapshot(7, 'VERIFYING'))
    expect(ctx.engineeringControlPlaneProjection.get('mission-client-fixture')).toMatchObject({ revision: 7 })
    expect(Object.isFrozen(ctx.engineeringControlPlaneProjection.get('mission-client-fixture'))).toBe(true)

    await fiber.dispose()
    expect(ctx.get('engineeringControlPlaneProjection')).toBeUndefined()
  })

  it('rejects an event whose wrapper and whole snapshot identities diverge', async () => {
    const ctx = new Context()
    await ctx.plugin(clientPlugin)
    ctx.engineeringControlPlaneProjection.installSnapshot(snapshot(1, 'CREATED'))

    expect(() => ctx.engineeringControlPlaneProjection.applyEvent({
      missionId: 'another-mission',
      revision: 2,
      snapshot: snapshot(2, 'ANALYZING'),
    })).toThrow('identity does not match')
  })

  it('has a Loader-safe browser namespace with no Node-root default export', () => {
    expect(clientPlugin.name).toBe('engineering-control-plane-client')
    expect('default' in clientPlugin).toBe(false)
  })
})
