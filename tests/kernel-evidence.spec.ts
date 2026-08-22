import { describe, expect, it } from 'vitest'
import {
  createControlPlaneKernel,
  createInMemoryMissionStore,
  type EffectivePolicy,
  type EvidenceRecord,
  type MissionAuthority,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/evidence-kernel-fixture',
  branch: 'main',
  head: '6666666666666666666666666666666666666666',
  workspaceFingerprint: 'sha256:evidence-kernel-baseline',
}

const authority: MissionAuthority = {
  principalId: 'host:evidence-indexer',
  repository,
  actions: ['start', 'read', 'orchestrate'],
  leaseHolderId: 'evidence-fixture-host',
  writeLease: { holderId: 'evidence-fixture-host', fencingToken: 1 },
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: 'sha256:evidence-index-policy',
  verificationProfile: 'fixture',
}

describe('ControlPlaneKernel Evidence manifest', () => {
  it('indexes only an Attempt-bound published Evidence Record through a revisioned command', async () => {
    const kernel = createControlPlaneKernel({
      store: createInMemoryMissionStore(),
      nextMissionId: () => 'mission-index-evidence',
      now: () => '2026-08-22T17:30:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'evidence-index-start',
      input: { objective: 'Index Evidence only after complete publication' },
    }, authority)
    const analyzing = await kernel.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: 1,
      to: 'ANALYZING',
    }, authority)
    const record: EvidenceRecord = {
      recordId: 'record-context-1',
      missionId: started.missionId,
      attempt: 1,
      kind: 'context',
      schemaVersion: 1,
      digest: `sha256:${'1'.repeat(64)}`,
      byteLength: 128,
      relativePath: 'mission-index-evidence/attempt-0001/records/record-context-1.json',
      redacted: false,
      createdAt: '2026-08-22T17:29:59.000Z',
    }

    const indexed = await kernel.dispatch({
      kind: 'record_evidence',
      missionId: started.missionId,
      expectedRevision: analyzing.revision,
      record,
    }, authority)

    expect(indexed).toMatchObject({ revision: 3, status: 'ANALYZING', attempt: 1 })
    await expect(kernel.snapshot(started.missionId, authority)).resolves.toMatchObject({
      evidence: { records: [record] },
    })
  })
})
