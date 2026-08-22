import { describe, expect, it } from 'vitest'
import {
  createControlPlaneKernel,
  createInMemoryMissionStore,
  type EffectivePolicy,
  type MissionAuthority,
  type MissionCommand,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'

const descriptor = {
  schemaVersion: 1 as const,
  providerId: 'fixture/kernel-terminal-provider',
  providerVersion: '1.0.0-fixture.1',
}

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/kernel-terminal-fixture',
  branch: 'main',
  head: '1'.repeat(40),
  workspaceFingerprint: `sha256:${'2'.repeat(64)}`,
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: `sha256:${'3'.repeat(64)}`,
  verificationProfile: 'fixture',
  assuranceProviderActivations: [{
    schemaVersion: 1,
    descriptor,
    activation: 'required',
  }],
  selectedAssuranceProviders: [{
    schemaVersion: 1,
    descriptor,
    activation: 'required',
  }],
}

const authority: MissionAuthority = {
  principalId: 'host:kernel-terminal-fixture',
  repository,
  actions: ['start', 'read', 'orchestrate'],
  leaseHolderId: 'kernel-terminal-fixture-host',
  writeLease: { holderId: 'kernel-terminal-fixture-host', fencingToken: 1 },
}

describe('ControlPlaneKernel Assurance Provider terminal outcomes', () => {
  it('records registration loss that occurs after durable begin admission', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-kernel-unavailable-after-begin',
      now: () => '2026-08-23T03:45:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'kernel-unavailable-after-begin',
      input: { objective: 'Persist registration loss after admission' },
    }, authority)
    const prepared = await kernel.snapshot(started.missionId, authority)
    const invocationId = prepared.assuranceProviderInvocations?.[0]?.invocationId
    if (invocationId === undefined) throw new Error('Fixture Invocation is missing')
    const begun = await kernel.dispatch({
      kind: 'begin_assurance_provider_invocation',
      missionId: prepared.missionId,
      expectedRevision: prepared.revision,
      invocationId,
    }, authority)

    await kernel.dispatch({
      kind: 'mark_assurance_provider_invocation_unavailable',
      missionId: begun.missionId,
      expectedRevision: begun.revision,
      invocationId,
      expectedState: 'begun',
      failureCode: 'registration_missing',
    }, authority)

    await expect(kernel.snapshot(begun.missionId, authority)).resolves.toMatchObject({
      assuranceProviderInvocations: [{
        invocationId,
        state: 'unavailable',
        begunAt: '2026-08-23T03:45:00.000Z',
        unavailableAt: '2026-08-23T03:45:00.000Z',
        failureCode: 'registration_missing',
      }],
    })
  })

  it("does not let a pre-resolution failure overwrite another owner's begun admission", async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-kernel-stale-unavailable',
      now: () => '2026-08-23T03:45:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'kernel-stale-unavailable',
      input: { objective: 'Reject stale prepared-state failure ownership' },
    }, authority)
    const prepared = await kernel.snapshot(started.missionId, authority)
    const invocationId = prepared.assuranceProviderInvocations?.[0]?.invocationId
    if (invocationId === undefined) throw new Error('Fixture Invocation is missing')
    const begun = await kernel.dispatch({
      kind: 'begin_assurance_provider_invocation',
      missionId: prepared.missionId,
      expectedRevision: prepared.revision,
      invocationId,
    }, authority)

    await expect(kernel.dispatch({
      kind: 'mark_assurance_provider_invocation_unavailable',
      missionId: begun.missionId,
      expectedRevision: begun.revision,
      invocationId,
      expectedState: 'prepared',
      failureCode: 'registration_missing',
    }, authority)).rejects.toMatchObject({ code: 'illegal_transition' })
    await expect(kernel.snapshot(begun.missionId, authority)).resolves.toMatchObject({
      revision: begun.revision,
      assuranceProviderInvocations: [{ invocationId, state: 'begun' }],
    })
  })

  it.each([
    {
      name: 'an unknown terminal kind',
      outcome: { kind: 'unknown_terminal', failureCode: 'malformed_submission' },
      message: 'Assurance Provider terminal outcome kind is invalid',
    },
    {
      name: 'an unknown import failure code',
      outcome: { kind: 'import_failed', failureCode: 'provider_claimed_failure' },
      message: 'Assurance Submission import failureCode is invalid',
    },
  ])('rejects $name before mutating the begun Invocation', async ({ outcome, message }) => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-kernel-terminal',
      now: () => '2026-08-23T03:45:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: `kernel-terminal:${outcome.kind}`,
      input: { objective: 'Reject forged terminal Provider outcomes' },
    }, authority)
    const prepared = await kernel.snapshot(started.missionId, authority)
    const invocationId = prepared.assuranceProviderInvocations?.[0]?.invocationId
    if (invocationId === undefined) throw new Error('Fixture Invocation is missing')
    const begun = await kernel.dispatch({
      kind: 'begin_assurance_provider_invocation',
      missionId: prepared.missionId,
      expectedRevision: prepared.revision,
      invocationId,
    }, authority)
    const forged = {
      kind: 'settle_assurance_provider_invocation',
      missionId: begun.missionId,
      expectedRevision: begun.revision,
      invocationId,
      outcome,
    } as unknown as MissionCommand

    await expect(kernel.dispatch(forged, authority)).rejects.toThrow(message)
    await expect(kernel.snapshot(begun.missionId, authority)).resolves.toMatchObject({
      revision: begun.revision,
      assuranceProviderInvocations: [{ state: 'begun' }],
    })
  })
})
