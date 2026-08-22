import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { openSqliteMissionStore } from '../src/adapters/sqlite-mission-store.ts'
import { sealAssuranceSubmissionV1 } from '../src/assurance-provider.ts'
import { inspectControlPlane } from '../src/doctor.ts'
import { createFilesystemEvidenceStore } from '../src/evidence/filesystem-store.ts'
import {
  createControlPlaneKernel,
  type EffectivePolicy,
  type MissionAuthority,
  type RepositoryIdentity,
} from '../src/kernel/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporaryHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-control-plane-doctor-'))
  temporaryRoots.push(home)
  return home
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const repository: RepositoryIdentity = {
  canonicalRoot: 'D:/doctor-fixture',
  branch: 'main',
  head: '9999999999999999999999999999999999999999',
  workspaceFingerprint: `sha256:${'9'.repeat(64)}`,
}

const authority: MissionAuthority = {
  principalId: 'host:doctor-fixture',
  repository,
  actions: ['start', 'read', 'orchestrate'],
  leaseHolderId: 'doctor-fixture-host',
  writeLease: { holderId: 'doctor-fixture-host', fencingToken: 1 },
}

const policy: EffectivePolicy = {
  schemaVersion: 1,
  digest: `sha256:${'8'.repeat(64)}`,
  verificationProfile: 'fixture',
}

describe('read-only control-plane doctor', () => {
  it('reports a missing store without creating the control-plane directory', async () => {
    const home = await temporaryHome()
    const report = await inspectControlPlane({ dshHome: home })

    expect(report).toMatchObject({
      ok: false,
      database: { exists: false },
      issues: [{ code: 'missing_database' }],
    })
    await expect(stat(join(home, 'control-plane'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('validates a current store without changing bytes or directory entries', async () => {
    const home = await temporaryHome()
    const path = join(home, 'control-plane', 'control-plane.sqlite')
    const store = await openSqliteMissionStore({ path })
    const kernel = createControlPlaneKernel({
      store,
      nextMissionId: () => 'mission-doctor-healthy',
      now: () => '2026-08-22T21:00:00.000Z',
      resolveEffectivePolicy: () => policy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'doctor-healthy-start',
      input: { objective: 'Remain inspectable without repair' },
    }, authority)
    const analyzing = await kernel.dispatch({
      kind: 'advance',
      missionId: started.missionId,
      expectedRevision: started.revision,
      to: 'ANALYZING',
    }, authority)
    await kernel.dispatch({
      kind: 'block',
      missionId: started.missionId,
      expectedRevision: analyzing.revision,
      reason: { code: 'needs_input' },
    }, authority)
    await store.close()

    const beforeBytes = await readFile(path)
    const beforeEntries = await readdir(join(home, 'control-plane'))
    const report = await inspectControlPlane({ dshHome: home })
    const afterBytes = await readFile(path)
    const afterEntries = await readdir(join(home, 'control-plane'))

    expect(report).toMatchObject({
      ok: true,
      database: { exists: true, schemaVersion: 2, quickCheck: 'ok' },
      missions: { total: 1, nonTerminal: 1, activeWriteLeases: 0 },
      evidence: { indexed: 0, valid: 0, missing: 0, corrupt: 0 },
      issues: [],
    })
    expect(digest(afterBytes)).toBe(digest(beforeBytes))
    expect(afterEntries.sort()).toEqual(beforeEntries.sort())
  })

  it('reports a settled Provider outcome whose imported Evidence reference is missing', async () => {
    const home = await temporaryHome()
    const path = join(home, 'control-plane', 'control-plane.sqlite')
    const descriptor = {
      schemaVersion: 1 as const,
      providerId: 'fixture/doctor-provider',
      providerVersion: '1.0.0-fixture.1',
    }
    const assurancePolicy: EffectivePolicy = {
      ...policy,
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
    const store = await openSqliteMissionStore({ path })
    const kernel = createControlPlaneKernel({
      store,
      nextMissionId: () => 'mission-doctor-assurance-reference',
      now: () => '2026-08-22T21:30:00.000Z',
      resolveEffectivePolicy: () => assurancePolicy,
    })
    const started = await kernel.dispatch({
      kind: 'start',
      idempotencyKey: 'doctor-assurance-reference-start',
      input: { objective: 'Detect a corrupt imported Submission reference' },
    }, authority)
    const prepared = await kernel.snapshot(started.missionId, authority)
    const invocationId = prepared.assuranceProviderInvocations?.[0]?.invocationId
    if (invocationId === undefined) throw new Error('Fixture Provider invocation is missing')
    const begun = await kernel.dispatch({
      kind: 'begin_assurance_provider_invocation',
      missionId: started.missionId,
      expectedRevision: prepared.revision,
      invocationId,
    }, authority)
    const evidenceStore = createFilesystemEvidenceStore({
      root: join(home, 'control-plane', 'missions'),
      nextRecordId: () => 'doctor-assurance-submission-record',
      now: () => '2026-08-22T21:30:00.000Z',
    })
    const submission = sealAssuranceSubmissionV1({
      schemaVersion: 1,
      binding: {
        invocationId,
        missionId: started.missionId,
        attempt: 1,
        provider: descriptor,
        subject: {
          kind: 'git_worktree',
          branch: repository.branch,
          head: repository.head,
          workspaceFingerprint: repository.workspaceFingerprint,
        },
        effectivePolicyDigest: assurancePolicy.digest,
      },
      externalAssessment: {
        state: 'sealed',
        assessmentId: 'doctor-assessment-1',
        claimedOutcome: 'satisfied',
      },
      providerComposition: {
        artifactId: 'doctor-composition-1',
        schemaId: 'fixture/provider-composition',
        schemaVersion: 1,
        value: { engine: 'doctor-fixture' },
      },
      providerPolicy: {
        artifactId: 'doctor-policy-1',
        schemaId: 'fixture/provider-policy',
        schemaVersion: 1,
        value: { profile: 'doctor-fixture' },
      },
      coverage: {
        artifactId: 'doctor-coverage-1',
        schemaId: 'fixture/provider-coverage',
        schemaVersion: 1,
        value: { checks: ['doctor/check'] },
      },
      sourceSeal: {
        artifactId: 'doctor-source-seal-1',
        schemaId: 'fixture/provider-source-seal',
        schemaVersion: 1,
        value: { root: `sha256:${'7'.repeat(64)}` },
      },
      provenance: {
        artifactId: 'doctor-provenance-1',
        schemaId: 'fixture/provider-provenance',
        schemaVersion: 1,
        value: { assessor: 'doctor-fixture' },
      },
      evidence: [{
        artifactId: 'doctor-evidence-1',
        schemaId: 'fixture/provider-evidence',
        schemaVersion: 1,
        value: { outcome: 'passed' },
      }],
    })
    const evidenceRecord = await evidenceStore.publish({
      missionId: started.missionId,
      attempt: 1,
      kind: 'assurance-provider-submission',
      schemaVersion: 1,
      payload: submission,
    })
    const settled = await kernel.dispatch({
      kind: 'settle_assurance_provider_invocation',
      missionId: started.missionId,
      expectedRevision: begun.revision,
      invocationId,
      outcome: {
        kind: 'sealed_submission',
        binding: {
          invocationId,
          missionId: started.missionId,
          attempt: 1,
          provider: descriptor,
          subject: {
            kind: 'git_worktree',
            branch: repository.branch,
            head: repository.head,
            workspaceFingerprint: repository.workspaceFingerprint,
          },
          effectivePolicyDigest: assurancePolicy.digest,
        },
        submissionDigest: submission.digest.value,
        claimedOutcome: 'satisfied',
        evidenceRecord,
      },
    }, authority)
    await store.close()

    const healthySubmissionReport = await inspectControlPlane({ dshHome: home })
    expect(healthySubmissionReport).toMatchObject({
      ok: true,
      evidence: { indexed: 1, valid: 1, missing: 0, corrupt: 0 },
      issues: [],
    })

    const tamperStore = await openSqliteMissionStore({ path })
    await tamperStore.update(settled.missionId, settled.revision, current => ({
      ...current,
      revision: current.revision + 1,
      assuranceProviderInvocations: current.assuranceProviderInvocations!.map(invocation => (
        invocation.state === 'settled'
          ? {
              ...invocation,
              outcome: {
                ...invocation.outcome,
                submissionDigest: `sha256:${'b'.repeat(64)}`,
              },
            }
          : invocation
      )),
    }))
    await tamperStore.close()

    const invalidPayloadReport = await inspectControlPlane({ dshHome: home })
    expect(invalidPayloadReport).toMatchObject({
      ok: false,
      evidence: { indexed: 1, valid: 1, missing: 0, corrupt: 0 },
      issues: [expect.objectContaining({
        code: 'invalid_assurance_submission_evidence_payload',
        missionId: started.missionId,
        recordId: evidenceRecord.recordId,
      })],
    })

    const reopenedStore = await openSqliteMissionStore({ path })
    await reopenedStore.update(settled.missionId, settled.revision + 1, current => ({
      ...current,
      revision: current.revision + 1,
      assuranceProviderInvocations: current.assuranceProviderInvocations!.map(invocation => (
        invocation.state === 'settled'
          ? {
              ...invocation,
              outcome: {
                ...invocation.outcome,
                evidenceRecordId: 'missing-assurance-submission-record',
              },
            }
          : invocation
      )),
    }))
    await reopenedStore.close()

    const report = await inspectControlPlane({ dshHome: home })

    expect(report).toMatchObject({
      ok: false,
      evidence: { indexed: 1, valid: 1, missing: 0, corrupt: 0 },
      issues: [expect.objectContaining({
        code: 'missing_assurance_submission_evidence_reference',
        missionId: started.missionId,
        recordId: 'missing-assurance-submission-record',
      })],
    })
  })
})
