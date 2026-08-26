# Graph Report - DSH Engineering Control Plane  (2026-08-26)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 955 nodes · 2219 edges · 58 communities (53 shown, 5 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 74 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5f39165e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Action Gate
- filesystem-store.ts
- MissionAuthority
- sqlite-mission-store.ts
- submission.ts
- Action Gate
- Quality Gate
- RepositoryIdentity
- policy.ts
- e2e-approved.spec.ts
- contracts.ts
- types.ts
- client.ts
- git-repository.ts
- kernel/index.ts
- MissionSnapshot
- mission-runner.ts
- mission-runner-happy-path.spec.ts
- devDependencies
- compilerOptions
- parseAssuranceProviderDescriptorV1
- EngineeringControlPlane
- compilerOptions
- role-contracts.ts
- peerDependencies
- assurance-provider-composition.spec.ts
- package.json
- MissionReceipt
- tools.ts
- exports
- MissionRunner
- assurance-provider-submission.spec.ts
- RoleName
- config.ts
- .runMission
- invocation-coordinator.ts
- src/index.ts
- loader-lifecycle.spec.ts
- eligibility.ts
- mission-runner-assurance-gate.spec.ts
- .readRoleOutput
- harness-command-executor.ts
- state-machine.ts
- mission-runner-rework-context.spec.ts
- scripts
- currentAssuranceSubject
- kernel-lifecycle.spec.ts
- files
- assurance-retry.ts
- restart-fingerprint.spec.ts
- AssuranceProviderV1
- @deepseek-ai/dsh-subagent
- @deepseek-ai/schemastery
- ADR-0004: Cancellation Never Rewrites Workspace
- ADR-0007: Mission State Uses Plugin-Owned SQLite
- Workspace Drift is not auto-adopted
- .initialize

## God Nodes (most connected - your core abstractions)
1. `MissionSnapshot` - 55 edges
2. `MissionAuthority` - 52 edges
3. `AssuranceProviderInvocationCoordinator` - 29 edges
4. `MissionId` - 28 edges
5. `EffectivePolicy` - 25 edges
6. `EngineeringControlPlane` - 22 edges
7. `MissionRunner` - 22 edges
8. `RepositoryIdentity` - 22 edges
9. `parseAssuranceProviderDescriptorV1()` - 21 edges
10. `createControlPlaneKernel()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `assess()` --calls--> `sealAssuranceSubmissionV1()`  [EXTRACTED]
  tests/assurance-provider-invocation-coordinator.spec.ts → src/assurance-provider/submission.ts
- `satisfiedSubmissionFor()` --calls--> `sealAssuranceSubmissionV1()`  [EXTRACTED]
  tests/assurance-provider-composition.spec.ts → src/assurance-provider/submission.ts
- `submissionFor()` --calls--> `sealAssuranceSubmissionV1()`  [EXTRACTED]
  tests/assurance-provider-submission.spec.ts → src/assurance-provider/submission.ts
- `submissionFor()` --calls--> `sealAssuranceSubmissionV1()`  [EXTRACTED]
  tests/mission-runner-assurance-gate.spec.ts → src/assurance-provider/submission.ts
- `AttemptAssuranceSubjectV1` --references--> `AssuranceSubmissionBindingV1`  [EXTRACTED]
  src/kernel/types.ts → src/assurance-provider/contracts.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Gate Evaluation Boundary** — attempt_seal, quality_gate, evidence_manifest, action_ledger [EXTRACTED 1.00]
- **Action Authorization Boundary** — docs_adr_0050_principal_resolver, docs_adr_0057_action_gate, docs_adr_0053_action_capability_registry, docs_adr_0052_network_authorization, docs_adr_0054_filesystem_actions [INFERRED 0.85]
- **Release Qualification Loop** — docs_adr_0069_web_release_proof, docs_adr_0070_migration_proof, docs_adr_0071_packed_installation, docs_adr_0072_release_promotion [INFERRED 0.85]
- **Testing Strategy** — docs_adr_0066_tdd_implementation, docs_adr_0067_scripted_providers, docs_adr_0068_property_tests, docs_adr_0065_platform_support [INFERRED 0.85]
- **Versioned Contracts Pattern** — docs_adr_0051_model_tool_contracts, docs_adr_0059_role_output_contracts, docs_adr_0058_prompt_packages, docs_adr_0048_effective_policy [INFERRED 0.85]
- **Evidence Integrity Chain** — canonical_evidence, attempt_seal, quality_gate, mission_contract [INFERRED 0.95]
- **External Provider Integration Pattern** — docs_adr_0073_security_assurance_external, docs_adr_0074_external_assurance_by_value, docs_adr_0075_host_policy_activation, docs_adr_0077_kernel_issued_context, docs_adr_0078_provider_fail_closed [INFERRED 0.95]
- **Governance Boundary Enforcement** — action_gate, quality_gate, governed_provider, effective_policy [INFERRED 0.95]
- **Immutable Audit Trail** — mission_revision_journal, action_ledger, design_ledger, attempt_seal [INFERRED 0.95]
- **Lease Coordination System** — write_lease, mission_execution_lease, repository_identity [INFERRED 0.95]
- **Mission Governance Triad** — control_plane_kernel, mission, effective_policy [INFERRED 0.95]
- **Provider Lifecycle Management** — docs_adr_0086_mission_cancellation_quiescence, docs_adr_0087_cancellation_retry, docs_adr_0088_external_failure_indeterminate, docs_adr_0089_assurance_retry [INFERRED 0.95]

## Communities (58 total, 5 thin omitted)

### Community 0 - "Action Gate"
Cohesion: 0.05
Nodes (62): Action Gate, Action Ledger, ADR-0001: Control Plane Kernel Owns Governance, ADR-0002: Quality Gate Defines Approved, ADR-0003: Role Runs Are One-Shot Per Attempt, ADR-0005: Canonical Evidence Is Structured, ADR-0010: Verification Policy Is Host-Owned and Frozen, ADR-0011: Effective Policy Is Frozen Per Mission (+54 more)

### Community 1 - "filesystem-store.ts"
Cohesion: 0.06
Nodes (40): MissionStoreFormatError, main(), parseArguments(), usageError(), ControlPlaneDoctorReport, databaseIssue(), DoctorIssue, inspectControlPlane() (+32 more)

### Community 2 - "MissionAuthority"
Cohesion: 0.10
Nodes (14): AssuranceProviderInvocationCoordinator, AssuranceProviderInvocationCoordinatorOptions, receipt(), ControlPlaneRuntime, issueAssuranceProviderInvocationV1(), ControlPlaneKernel, MissionAuthority, MissionCommand (+6 more)

### Community 3 - "sqlite-mission-store.ts"
Cohesion: 0.12
Nodes (29): backupPath(), beginImmediate(), createDatabaseFile(), decodeSnapshot(), expectedSchema(), initializeFreshDatabase(), inspectSqliteMissionStore(), integerField() (+21 more)

### Community 4 - "submission.ts"
Cohesion: 0.19
Nodes (34): artifactBase(), artifactValue(), assertNoSubmissionSecrets(), canonicalString(), deepFreeze(), digestEnvelope(), exactKeys(), invalid() (+26 more)

### Community 5 - "Action Gate"
Cohesion: 0.08
Nodes (35): Execution Lease, Repository Write Lease, Execution Admission, Cancellation Protocol, Workspace Fingerprint, Effective Policy, Policy Layering, Product Ceilings (+27 more)

### Community 6 - "Quality Gate"
Cohesion: 0.08
Nodes (34): Assurance Execution Context, Assurance Provider, Assurance Submission, Control Plane Kernel, Evidence Store, Mission, Plugin Boundary, Provider Invocation (+26 more)

### Community 7 - "RepositoryIdentity"
Cohesion: 0.09
Nodes (23): createControlPlaneKernel(), createInMemoryMissionStore(), RepositoryIdentity, authority, policy, repository, authority, policy (+15 more)

### Community 8 - "policy.ts"
Cohesion: 0.17
Nodes (20): HarnessRolePolicy, AssuranceProviderActivationConfig, EffectiveArtifactBudgets, EffectiveRolePolicy, EffectiveVerificationProfile, activationKey(), ASSURANCE_PROVIDER_ACTIVATION_KEYS, createEffectivePolicy() (+12 more)

### Community 9 - "e2e-approved.spec.ts"
Cohesion: 0.13
Nodes (16): GitRepositoryAdapterOptions, HarnessCommandExecutor, CATEGORIES, categoryOutcome(), CommandEvidence, validateVerificationProfile(), VerificationAdapter, VerificationCategoryConfig (+8 more)

### Community 10 - "contracts.ts"
Cohesion: 0.18
Nodes (20): AssuranceClaimedOutcomeV1, AssuranceExecutionSubjectV1, AssuranceProviderActivation, AssuranceProviderCancellationOutcomeV1, AssuranceProviderConfigurationV1, AssuranceProviderOutcomeV1, AssuranceSubmissionArtifactDraftV1, AssuranceSubmissionArtifactV1 (+12 more)

### Community 11 - "types.ts"
Cohesion: 0.12
Nodes (19): FrozenAssuranceProviderSelectionV1, evaluateGate(), AssuranceAssessmentReasonCode, AssuranceAssessmentV1, AssuranceProviderInvocationBaseV1, AttemptAssuranceProviderSelectionV1, AttemptAssuranceSubjectV1, BlockedReason (+11 more)

### Community 12 - "client.ts"
Cohesion: 0.12
Nodes (11): Context, @deepseek-ai/cordis, freezeSnapshot(), MissionProjectionApplyResult, MissionProjectionEvent, MissionProjectionListener, MissionProjectionSnapshot, MissionProjectionStore (+3 more)

### Community 13 - "git-repository.ts"
Cohesion: 0.21
Nodes (10): assertInside(), firstLine(), GitRepositoryAdapter, redactPotentialSecrets(), sha256(), UntrackedEvidence, CommandExecutionResult, RepositoryObservation (+2 more)

### Community 14 - "kernel/index.ts"
Cohesion: 0.12
Nodes (7): activateWriteLease(), ASSURANCE_ELIGIBILITY_FAILURE_CODES, ASSURANCE_PROVIDER_UNAVAILABLE_CODES, ASSURANCE_SUBMISSION_REJECTION_CODES, leaseError(), requireLeaseHolderId(), requireWriteLease()

### Community 15 - "MissionSnapshot"
Cohesion: 0.17
Nodes (11): SqliteMissionStoreInspection, MissionCancelRequest, MissionResumeRequest, MissionReworkRequest, ControlPlaneKernelOptions, InMemoryMissionStore, MissionStore, MissionId (+3 more)

### Community 16 - "mission-runner.ts"
Cohesion: 0.12
Nodes (14): PublishEvidenceInput, AssuranceProviderEligibilityV1, RequiredEvidenceState, boundedDiagnostic(), CANCELLATION_QUIESCENCE, errorMessage(), MissionRunHandle, needsInput() (+6 more)

### Community 17 - "mission-runner-happy-path.spec.ts"
Cohesion: 0.11
Nodes (13): createMissionRunner(), authority, policy, repository, temporaryRoots, authority, policy, repository (+5 more)

### Community 18 - "devDependencies"
Cohesion: 0.11
Nodes (18): @deepseek-ai/cordis-plugin-loader, @deepseek-ai/dsh-home-paths, @deepseek-ai/dsh-subprocess-local, @deepseek-ai/dsh-system-prompt, oxlint, devDependencies, @deepseek-ai/cordis-plugin-loader, @deepseek-ai/dsh-home-paths (+10 more)

### Community 19 - "compilerOptions"
Cohesion: 0.11
Nodes (17): node, vitest.config.ts, vitest/globals, compilerOptions, allowImportingTsExtensions, exactOptionalPropertyTypes, module, moduleResolution (+9 more)

### Community 20 - "parseAssuranceProviderDescriptorV1"
Cohesion: 0.23
Nodes (10): AssuranceProviderDescriptorV1, AssuranceProviderDisposer, AssuranceProviderFactoryV1, boundedCanonicalString(), exactDescriptorKeys(), parseAssuranceProviderConfigurationV1(), parseAssuranceProviderDescriptorV1(), AssuranceProviderEntry (+2 more)

### Community 21 - "EngineeringControlPlane"
Cohesion: 0.30
Nodes (3): authority(), callingCwd(), EngineeringControlPlane

### Community 22 - "compilerOptions"
Cohesion: 0.12
Nodes (16): ./tsconfig.json, compilerOptions, allowImportingTsExtensions, declaration, declarationDir, declarationMap, noEmit, outDir (+8 more)

### Community 23 - "role-contracts.ts"
Cohesion: 0.20
Nodes (16): AssessmentOutput, DeveloperOutput, exactKeys(), findings(), findingSchema, nonemptyString(), object(), optionalQuestion() (+8 more)

### Community 24 - "peerDependencies"
Cohesion: 0.12
Nodes (16): @deepseek-ai/cordis, @deepseek-ai/dsh-agent, @deepseek-ai/dsh-invariants, @deepseek-ai/dsh-subprocess, @deepseek-ai/dsh-tools, @deepseek-ai/cordis, @deepseek-ai/dsh-agent, @deepseek-ai/dsh-invariants (+8 more)

### Community 25 - "assurance-provider-composition.spec.ts"
Cohesion: 0.14
Nodes (7): ADR-0067, cleanRepository(), run, satisfiedSubmissionFor(), temporaryRoots, outputs, registerScriptedEngineeringProvider()

### Community 26 - "package.json"
Cohesion: 0.12
Nodes (15): bin, dsh-control-plane, patch, description, dsh, bundle, engines, node (+7 more)

### Community 27 - "MissionReceipt"
Cohesion: 0.17
Nodes (6): missionId(), MissionReceipt, agent, missionId, snapshot(), StubControlPlane

### Community 28 - "tools.ts"
Cohesion: 0.16
Nodes (13): apply(), boundedText(), inject, legalNextActions(), MISSION_STATUSES, name, RECEIPT_OUTPUT, RECEIPT_SCHEMA (+5 more)

### Community 29 - "exports"
Cohesion: 0.14
Nodes (14): default, types, default, types, exports, ./assurance-provider, ./client, ./invariant (+6 more)

### Community 31 - "assurance-provider-submission.spec.ts"
Cohesion: 0.16
Nodes (7): cleanRepository(), config(), configForDescriptors(), rejectionCases, run, submissionFor(), temporaryRoots

### Community 32 - "RoleName"
Cohesion: 0.23
Nodes (8): HarnessRoleExecutor, HarnessRoleExecutorOptions, policyViolations(), RoleName, RoleRunTrace, RoleExecutionHandle, RoleExecutionRequest, RoleExecutor

### Community 33 - "config.ts"
Cohesion: 0.15
Nodes (12): assuranceProviderActivation, DatabaseConfig, DEFAULT_ARTIFACT_BUDGETS, RepositoryMappingConfig, rolePolicy, RolePolicyConfig, stringArray, verificationCategory (+4 more)

### Community 34 - ".runMission"
Cohesion: 0.21
Nodes (7): latestAssuranceResults(), MissionPhase, hasSelectedAssuranceProviders(), isRecord(), MissionExecutionHost, needsFinalReport(), normalizeVerificationOutcomes()

### Community 35 - "invocation-coordinator.ts"
Cohesion: 0.29
Nodes (7): AssuranceExecutionContext, AssuranceProviderUnavailableCode, AssuranceRequestV1, AssuranceSubmissionRejectionCode, AssuranceProviderResolutionError, AssuranceSubmissionValidationError, IssuedAssuranceProviderInvocationV1

### Community 36 - "src/index.ts"
Cohesion: 0.21
Nodes (11): AssuranceProviderActivationPolicyV1, assertExpectedRevision(), Context, @deepseek-ai/cordis, MissionStartRequest, RepositoryPolicyBinding, ROLE_NAMES, rolePoliciesFromEffective() (+3 more)

### Community 37 - "loader-lifecycle.spec.ts"
Cohesion: 0.20
Nodes (7): inject, install, name, cleanRepository(), run, temporaryRoots, waitForBlocked()

### Community 38 - "eligibility.ts"
Cohesion: 0.33
Nodes (9): EligibilityWithoutInvocation, evaluateAssuranceSubmissionEligibilityV1(), indeterminate(), nonEmpty(), record(), sameProvider(), sameSubject(), standardArtifact() (+1 more)

### Community 39 - "mission-runner-assurance-gate.spec.ts"
Cohesion: 0.22
Nodes (8): assess(), authority, descriptor, policy, repository, roleOutputs, submissionFor(), temporaryRoots

### Community 40 - ".readRoleOutput"
Cohesion: 0.33
Nodes (5): EvidenceJson, latestRecord(), latestRecordForAttempt(), RoleStepResult, RoleOutput

### Community 41 - "harness-command-executor.ts"
Cohesion: 0.25
Nodes (5): CommandExecutionSpec, HarnessCommandExecutorOptions, originalGitConfigEnvironment, run, temporaryRoots

### Community 42 - "state-machine.ts"
Cohesion: 0.32
Nodes (5): MissionError, MissionErrorCode, mayAdvance(), NEXT_PHASE, MissionStatus

### Community 43 - "mission-runner-rework-context.spec.ts"
Cohesion: 0.25
Nodes (5): authority, failedGateInput, policy, repository, temporaryRoots

### Community 44 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, build, lint, prepack, test, test:watch, typecheck

### Community 45 - "currentAssuranceSubject"
Cohesion: 0.43
Nodes (7): begunAssuranceProviderInvocationIndex(), currentAssuranceSubject(), mayExecuteAssurance(), preparedAssuranceProviderInvocationIndex(), sameSubmissionBinding(), terminableAssuranceProviderInvocationIndex(), unavailableAssuranceProviderInvocationIndex()

### Community 46 - "kernel-lifecycle.spec.ts"
Cohesion: 0.33
Nodes (5): authority, failedGateInput, phasesToReview, policy, repository

### Community 47 - "files"
Cohesion: 0.40
Nodes (5): files, cordis.patch.yml, lib/**/*.js, lib/types/**/*.d.ts, README.md

### Community 48 - "assurance-retry.ts"
Cohesion: 0.50
Nodes (4): activeAssuranceProviderInvocations(), retryableExternalAssuranceInvocations(), AssuranceProviderInvocationRecordV1, AssuranceResultV1

### Community 49 - "restart-fingerprint.spec.ts"
Cohesion: 0.50
Nodes (3): repository(), run, temporaryRoots

### Community 51 - "@deepseek-ai/dsh-subagent"
Cohesion: 0.67
Nodes (3): @deepseek-ai/dsh-subagent, @deepseek-ai/dsh-subagent, @deepseek-ai/dsh-subagent

### Community 52 - "@deepseek-ai/schemastery"
Cohesion: 0.67
Nodes (3): @deepseek-ai/schemastery, @deepseek-ai/schemastery, @deepseek-ai/schemastery

### Community 57 - ".initialize"
Cohesion: 0.50
Nodes (3): Config, Config, errorMessage()

## Knowledge Gaps
- **250 isolated node(s):** `ControlPlaneDoctorReport`, `DoctorIssue`, `InspectControlPlaneOptions`, `CanonicalByteBudget`, `CanonicalizeEvidenceOptions` (+245 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MissionSnapshot` connect `MissionSnapshot` to `RoleName`, `filesystem-store.ts`, `MissionAuthority`, `invocation-coordinator.ts`, `sqlite-mission-store.ts`, `src/index.ts`, `.runMission`, `.readRoleOutput`, `types.ts`, `mission-runner-rework-context.spec.ts`, `kernel/index.ts`, `assurance-retry.ts`, `mission-runner.ts`, `mission-runner-happy-path.spec.ts`, `EngineeringControlPlane`, `MissionReceipt`, `tools.ts`, `MissionRunner`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `MissionAuthority` connect `MissionAuthority` to `filesystem-store.ts`, `.runMission`, `invocation-coordinator.ts`, `src/index.ts`, `sqlite-mission-store.ts`, `RepositoryIdentity`, `mission-runner-assurance-gate.spec.ts`, `e2e-approved.spec.ts`, `types.ts`, `mission-runner-rework-context.spec.ts`, `kernel/index.ts`, `MissionSnapshot`, `mission-runner.ts`, `kernel-lifecycle.spec.ts`, `mission-runner-happy-path.spec.ts`, `restart-fingerprint.spec.ts`, `EngineeringControlPlane`, `MissionRunner`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `RepositoryIdentity` connect `RepositoryIdentity` to `filesystem-store.ts`, `MissionAuthority`, `sqlite-mission-store.ts`, `src/index.ts`, `mission-runner-assurance-gate.spec.ts`, `e2e-approved.spec.ts`, `types.ts`, `mission-runner-rework-context.spec.ts`, `git-repository.ts`, `kernel-lifecycle.spec.ts`, `mission-runner-happy-path.spec.ts`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `ControlPlaneDoctorReport`, `DoctorIssue`, `InspectControlPlaneOptions` to the rest of the system?**
  _250 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Action Gate` be split into smaller, more focused modules?**
  _Cohesion score 0.05182443151771549 - nodes in this community are weakly interconnected._
- **Should `filesystem-store.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06298701298701298 - nodes in this community are weakly interconnected._
- **Should `MissionAuthority` be split into smaller, more focused modules?**
  _Cohesion score 0.09595959595959595 - nodes in this community are weakly interconnected._