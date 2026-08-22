import { describe, expect, it } from 'vitest'
import {
  createControlPlaneKernel,
  createInMemoryMissionStore,
  type EffectivePolicy,
  type MissionAuthority,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'
import { createMissionRunner } from '../src/runner/mission-runner.ts'

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/runner-recovery-fixture',
  branch: 'main',
  head: '8888888888888888888888888888888888888888',
  workspaceFingerprint: 'sha256:runner-recovery-baseline',
}

const authority: MissionAuthority = {
  principalId: 'plugin:recovery',
  repository,
  actions: ['start', 'read', 'orchestrate', 'resume'],
  leaseHolderId: 'runner-recovery-fixture-host',
  writeLease: { holderId: 'runner-recovery-fixture-host', fencingToken: 1 },
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: 'sha256:runner-recovery-policy',
  verificationProfile: 'fixture',
}

describe('MissionRunner restart recovery', () => {
  it('blocks every persisted active phase and never auto-resumes it', async () => {
    const store = createInMemoryMissionStore()
    const kernel = createControlPlaneKernel({
      store,
      nextMissionId: () => 'mission-host-restarted',
      now: () => '2026-08-22T18:30:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'runner-recovery-start',
      input: { objective: 'Require explicit recovery after restart' },
    }, authority)
    await kernel.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: 1,
      to: 'ANALYZING',
    }, authority)
    const runner = createMissionRunner({
      kernel,
      store,
      authorityFor: snapshot => ({
        principalId: 'service:restart-recovery',
        repository: snapshot.repository,
        actions: ['read', 'recover'],
      }),
      observeWorkspaceForRecovery: () => Promise.resolve({
        workspaceFingerprint: 'sha256:recovery-observation',
      }),
    })

    await expect(runner.recoverAfterRestart()).resolves.toEqual({ blockedMissionIds: ['mission-host-restarted'] })
    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      revision: 3,
      status: 'BLOCKED',
      attempt: 1,
      blocked: {
        reason: { code: 'host_restarted' },
        resumeStatus: 'ANALYZING',
        workspaceFingerprint: 'sha256:recovery-observation',
      },
    })
    await expect(runner.recoverAfterRestart()).resolves.toEqual({ blockedMissionIds: [] })
  })
})
