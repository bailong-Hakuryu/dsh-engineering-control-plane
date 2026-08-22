import { describe, expect, it } from 'vitest'
import { AssuranceProviderInvocationCoordinator } from '../src/assurance-provider/invocation-coordinator.ts'
import { AssuranceProviderRegistry } from '../src/assurance-provider/registry.ts'
import type {
  ControlPlaneKernel,
  MissionCommand,
  MissionAuthority,
  MissionSnapshot,
} from '../src/kernel/types.ts'

describe('AssuranceProviderInvocationCoordinator process lifecycle', () => {
  it('does not assess a Provider unregistered while durable begin is awaiting admission', async () => {
    const descriptor = {
      schemaVersion: 1 as const,
      providerId: 'fixture/unregistered-during-admission-provider',
      providerVersion: '1.0.0-fixture.1',
    }
    const repository = {
      canonicalRoot: 'D:/unregistered-during-admission-fixture',
      branch: 'main',
      head: '1'.repeat(40),
      workspaceFingerprint: 'sha256:' + '2'.repeat(64),
    }
    const invocationId = 'mission-unregistered-during-admission:assurance:1:1'
    let snapshot = {
      missionId: 'mission-unregistered-during-admission',
      revision: 1,
      repository,
      effectivePolicyDigest: 'sha256:' + '3'.repeat(64),
      status: 'BLOCKED',
      attempt: 1,
      updatedAt: '2026-08-23T03:30:00.000Z',
      assuranceProviderInvocations: [{
        schemaVersion: 1,
        invocationId,
        attempt: 1,
        descriptor,
        state: 'prepared',
        preparedAt: '2026-08-23T03:30:00.000Z',
      }],
    } as unknown as MissionSnapshot
    const authority = {
      principalId: 'service:unregistered-during-admission',
      repository,
      actions: ['read', 'orchestrate'],
    } satisfies MissionAuthority
    let reportBeginEntered!: () => void
    let releaseBegin!: () => void
    const beginEntered = new Promise<void>(resolve => { reportBeginEntered = resolve })
    const beginGate = new Promise<void>(resolve => { releaseBegin = resolve })
    const kernel: ControlPlaneKernel = {
      async snapshot() {
        return structuredClone(snapshot)
      },
      async dispatch(command: MissionCommand) {
        if (command.kind === 'begin_assurance_provider_invocation') {
          reportBeginEntered()
          await beginGate
          snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            assuranceProviderInvocations: snapshot.assuranceProviderInvocations!.map(record => (
              record.invocationId === invocationId && record.state === 'prepared'
                ? { ...record, state: 'begun' as const, begunAt: snapshot.updatedAt }
                : record
            )),
          }
        } else if (command.kind === 'mark_assurance_provider_invocation_unavailable') {
          snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            assuranceProviderInvocations: snapshot.assuranceProviderInvocations!.map(record => (
              record.invocationId === invocationId && record.state === 'begun'
                ? {
                    ...record,
                    state: 'unavailable' as const,
                    unavailableAt: snapshot.updatedAt,
                    failureCode: command.failureCode,
                  }
                : record
            )),
          }
        } else {
          throw new Error('Fixture received an unexpected command')
        }
        return {
          missionId: snapshot.missionId,
          revision: snapshot.revision,
          status: snapshot.status,
          attempt: snapshot.attempt,
          acceptedAt: snapshot.updatedAt,
        }
      },
    }
    const registry = new AssuranceProviderRegistry()
    let assessCalls = 0
    const unregister = registry.register(descriptor, normalizedDescriptor => ({
      descriptor: normalizedDescriptor,
      async assess() {
        assessCalls++
        return new Promise<never>(() => {})
      },
    }))
    registry.closeRegistration()
    const coordinator = new AssuranceProviderInvocationCoordinator({
      kernel,
      registry,
      evidenceStore: {
        async publish() {
          throw new Error('Unreachable unregistered Provider result')
        },
      },
      maxSubmissionBytes: 16_384,
      onError: () => {},
    })

    try {
      const launching = coordinator.launch(snapshot, authority)
      await beginEntered
      unregister()
      releaseBegin()
      await launching

      expect(assessCalls).toBe(0)
      expect(snapshot.assuranceProviderInvocations).toEqual([
        expect.objectContaining({
          invocationId,
          state: 'unavailable',
          failureCode: 'registration_missing',
        }),
      ])
    } finally {
      coordinator.dispose()
    }
  })

  it('single-flights Provider factory resolution across concurrent launch replays', async () => {
    const descriptor = {
      schemaVersion: 1 as const,
      providerId: 'fixture/concurrent-admission-provider',
      providerVersion: '1.0.0-fixture.1',
    }
    const repository = {
      canonicalRoot: 'D:/concurrent-admission-fixture',
      branch: 'main',
      head: '1'.repeat(40),
      workspaceFingerprint: 'sha256:' + '2'.repeat(64),
    }
    const invocationId = 'mission-concurrent-admission:assurance:1:1'
    let snapshot = {
      missionId: 'mission-concurrent-admission',
      revision: 1,
      repository,
      effectivePolicyDigest: 'sha256:' + '3'.repeat(64),
      status: 'BLOCKED',
      attempt: 1,
      updatedAt: '2026-08-23T03:30:00.000Z',
      assuranceProviderInvocations: [{
        schemaVersion: 1,
        invocationId,
        attempt: 1,
        descriptor,
        state: 'prepared',
        preparedAt: '2026-08-23T03:30:00.000Z',
      }],
    } as unknown as MissionSnapshot
    const authority = {
      principalId: 'service:concurrent-admission',
      repository,
      actions: ['read', 'orchestrate'],
    } satisfies MissionAuthority
    const kernel: ControlPlaneKernel = {
      async snapshot() {
        return structuredClone(snapshot)
      },
      async dispatch(command: MissionCommand) {
        if (command.kind !== 'begin_assurance_provider_invocation') {
          throw new Error('Fixture accepts only begin commands')
        }
        snapshot = {
          ...snapshot,
          revision: snapshot.revision + 1,
          assuranceProviderInvocations: snapshot.assuranceProviderInvocations!.map(record => (
            record.invocationId === invocationId && record.state === 'prepared'
              ? { ...record, state: 'begun' as const, begunAt: snapshot.updatedAt }
              : record
          )),
        }
        return {
          missionId: snapshot.missionId,
          revision: snapshot.revision,
          status: snapshot.status,
          attempt: snapshot.attempt,
          acceptedAt: snapshot.updatedAt,
        }
      },
    }
    const registry = new AssuranceProviderRegistry()
    let factoryCalls = 0
    let assessCalls = 0
    registry.register(descriptor, normalizedDescriptor => {
      factoryCalls++
      return {
        descriptor: normalizedDescriptor,
        async assess() {
          assessCalls++
          return new Promise<never>(() => {})
        },
      }
    })
    registry.closeRegistration()
    const coordinator = new AssuranceProviderInvocationCoordinator({
      kernel,
      registry,
      evidenceStore: {
        async publish() {
          throw new Error('Unreachable pending Provider result')
        },
      },
      maxSubmissionBytes: 16_384,
      onError: () => {},
    })

    try {
      const receipts = await Promise.all([
        coordinator.launch(snapshot, authority),
        coordinator.launch(snapshot, authority),
      ])
      expect(factoryCalls).toBe(1)
      expect(assessCalls).toBe(1)
      expect(receipts).toEqual([
        expect.objectContaining({ revision: 2 }),
        expect.objectContaining({ revision: 2 }),
      ])
    } finally {
      coordinator.dispose()
    }
  })

  it('does not create or invoke a Provider after disposal wins an admission await', async () => {
    const descriptor = {
      schemaVersion: 1 as const,
      providerId: 'fixture/dispose-race-provider',
      providerVersion: '1.0.0-fixture.1',
    }
    const repository = {
      canonicalRoot: 'D:/dispose-race-fixture',
      branch: 'main',
      head: '1'.repeat(40),
      workspaceFingerprint: 'sha256:' + '2'.repeat(64),
    }
    const snapshot = {
      missionId: 'mission-dispose-race',
      revision: 1,
      repository,
      status: 'BLOCKED',
      attempt: 1,
      updatedAt: '2026-08-23T03:30:00.000Z',
      assuranceProviderInvocations: [{
        schemaVersion: 1,
        invocationId: 'mission-dispose-race:assurance:1:1',
        attempt: 1,
        descriptor,
        state: 'prepared',
        preparedAt: '2026-08-23T03:30:00.000Z',
      }],
    } as unknown as MissionSnapshot
    const authority = {
      principalId: 'service:dispose-race',
      repository,
      actions: ['read', 'orchestrate'],
    } satisfies MissionAuthority

    let releaseSnapshot!: (snapshot: MissionSnapshot) => void
    let reportSnapshotEntered!: () => void
    const snapshotEntered = new Promise<void>(resolve => { reportSnapshotEntered = resolve })
    const pendingSnapshot = new Promise<MissionSnapshot>(resolve => { releaseSnapshot = resolve })
    let dispatchCalls = 0
    const kernel: ControlPlaneKernel = {
      async dispatch() {
        dispatchCalls++
        throw new Error('Dispatch must not run after coordinator disposal')
      },
      snapshot() {
        reportSnapshotEntered()
        return pendingSnapshot
      },
    }
    const registry = new AssuranceProviderRegistry()
    let factoryCalls = 0
    let assessCalls = 0
    registry.register(descriptor, normalizedDescriptor => {
      factoryCalls++
      return {
        descriptor: normalizedDescriptor,
        async assess() {
          assessCalls++
          return new Promise<never>(() => {})
        },
      }
    })
    registry.closeRegistration()
    const coordinator = new AssuranceProviderInvocationCoordinator({
      kernel,
      registry,
      evidenceStore: {
        async publish() {
          throw new Error('Evidence publication must not run after coordinator disposal')
        },
      },
      maxSubmissionBytes: 16_384,
      onError: () => {},
    })

    const launching = coordinator.launch(snapshot, authority)
    await snapshotEntered
    coordinator.dispose()
    releaseSnapshot(snapshot)
    await expect(launching).resolves.toMatchObject({
      missionId: snapshot.missionId,
      revision: 1,
      status: 'BLOCKED',
    })
    expect(dispatchCalls).toBe(0)
    expect(factoryCalls).toBe(0)
    expect(assessCalls).toBe(0)
  })
})
