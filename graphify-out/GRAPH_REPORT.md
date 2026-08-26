# Graph Report - DSH Engineering Control Plane  (2026-08-26)

## Corpus Check
- 160 files · ~82,903 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 989 nodes · 2262 edges · 57 communities (53 shown, 4 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 81 edges (avg confidence: 0.84)
- Token cost: at least 142,588 input · at least 28,372 output; chunk 20 usage was not exposed by the agent runtime

## Community Hubs (Navigation)
- Action Gate
- Filesystem Store
- Repository Identity
- Sqlite Mission Store
- Policy Module
- Submission Module
- Action Gate Effective Policy
- Quality Gate
- Confirmed Testing Seams
- Mission Authority
- Types Module
- Kernel Index
- Client Module
- Mission Snapshot
- Contracts Module
- Tools Module
- Mission Runner
- Dev Dependencies
- Node Module
- Assurance Provider Descriptor V1
- Tsconfig Module
- Engineering Control Plane
- Role Contracts
- Deepseek Ai Cordis
- Assurance Provider Composition Spec
- Package Module
- Create Control Plane Kernel
- Mission Receipt
- Role Name
- Exports Module
- Src Index
- Evidence Record
- Mission Id
- Assurance Provider Submission Spec
- Parse Assurance Provider Descriptor V1
- Mission Runner Happy Path Spec
- Effective Policy
- Loader Lifecycle Spec
- Mission Runner Execute Role
- Invocation Coordinator
- Mission Runner Assurance Gate Spec
- Mission Runner Rework Context Spec
- Scripts Module
- Mission Runner Cancellation Spec
- Mission Phase
- Kernel Gate Spec
- Kernel Lifecycle Spec
- Cordis Patch
- Control Plane Kernel
- Kernel Cancel Spec
- Deepseek Ai Dsh Subagent
- Deepseek Ai Schemastery
- Frozen Mission Branch And HEAD
- ADR 0004 Cancellation Never Rewrites
- ADR 0007 Mission State Uses
- Workspace Drift Is Not Auto

## God Nodes (most connected - your core abstractions)
1. `MissionSnapshot` - 55 edges
2. `MissionAuthority` - 52 edges
3. `AssuranceProviderInvocationCoordinator` - 29 edges
4. `MissionId` - 28 edges
5. `EffectivePolicy` - 25 edges
6. `EngineeringControlPlane` - 22 edges
7. `RepositoryIdentity` - 22 edges
8. `MissionRunner` - 22 edges
9. `parseAssuranceProviderDescriptorV1()` - 21 edges
10. `createControlPlaneKernel()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `satisfiedSubmissionFor()` --calls--> `sealAssuranceSubmissionV1()`  [EXTRACTED]
  tests/assurance-provider-composition.spec.ts → src/assurance-provider/submission.ts
- `assess()` --calls--> `sealAssuranceSubmissionV1()`  [EXTRACTED]
  tests/assurance-provider-invocation-coordinator.spec.ts → src/assurance-provider/submission.ts
- `submissionFor()` --calls--> `sealAssuranceSubmissionV1()`  [EXTRACTED]
  tests/assurance-provider-submission.spec.ts → src/assurance-provider/submission.ts
- `User action authorization adapts Harness ApprovalService` --implements--> `Action Gate`  [INFERRED]
  docs/adr/0024-user-action-authorization-adapts-harness-approval.md → CONTEXT.md
- `User decisions require host-derived provenance` --references--> `Design Ledger`  [INFERRED]
  docs/adr/0022-user-decisions-require-host-derived-provenance.md → control-plane-kernel-architecture-v0.2.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Gate Evaluation Boundary** — attempt_seal, quality_gate, evidence_manifest, action_ledger [EXTRACTED 1.00]
- **Mission Design Decision Protocol** — docs_adr_0013_mission_owned_design_frontier_mission_owned_design_ledger, docs_adr_0013_mission_owned_design_frontier_design_frontier, docs_adr_0013_mission_owned_design_frontier_user_decision_resolution, docs_adr_0017_design_decisions_use_a_dedicated_mission_tool_mission_decide [EXTRACTED 1.00]
- **Mission Authority and Recovery Boundary** — docs_adr_0006_mission_runtime_is_not_a_harness_job_mission_runtime, docs_adr_0008_mission_authority_is_host_derived_host_derived_mission_authority, docs_adr_0009_git_history_remains_user_owned_user_owned_git_history, docs_testing_seams_control_plane_kernel_seam [INFERRED 0.75]
- **Action Authorization Boundary** — docs_adr_0050_principal_resolver, docs_adr_0057_action_gate, docs_adr_0053_action_capability_registry, docs_adr_0052_network_authorization, docs_adr_0054_filesystem_actions [INFERRED 0.85]
- **Assurance Evidence and Gate Pipeline** — docs_adr_0016_stable_roles_carry_assurance_requirements_assurance_requirements, docs_adr_0012_gate_distinguishes_failure_from_indeterminacy_quality_gate_decision_model, docs_testing_seams_assurance_provider_composition_seam, docs_testing_seams_tracer_bullet_flow [INFERRED 0.85]
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

## Communities (57 total, 4 thin omitted)

### Community 0 - "Action Gate"
Cohesion: 0.05
Nodes (62): Action Gate, Action Ledger, ADR-0001: Control Plane Kernel Owns Governance, ADR-0002: Quality Gate Defines Approved, ADR-0003: Role Runs Are One-Shot Per Attempt, ADR-0005: Canonical Evidence Is Structured, ADR-0010: Verification Policy Is Host-Owned and Frozen, ADR-0011: Effective Policy Is Frozen Per Mission (+54 more)

### Community 1 - "Filesystem Store"
Cohesion: 0.06
Nodes (43): MissionStoreFormatError, main(), parseArguments(), usageError(), ControlPlaneDoctorReport, databaseIssue(), DoctorIssue, inspectControlPlane() (+35 more)

### Community 2 - "Repository Identity"
Cohesion: 0.08
Nodes (29): assertInside(), firstLine(), GitRepositoryAdapter, GitRepositoryAdapterOptions, redactPotentialSecrets(), sha256(), UntrackedEvidence, CommandExecutionResult (+21 more)

### Community 3 - "Sqlite Mission Store"
Cohesion: 0.12
Nodes (29): backupPath(), beginImmediate(), createDatabaseFile(), decodeSnapshot(), expectedSchema(), initializeFreshDatabase(), inspectSqliteMissionStore(), integerField() (+21 more)

### Community 4 - "Policy Module"
Cohesion: 0.10
Nodes (33): HarnessRolePolicy, validateVerificationProfile(), assuranceProviderActivation, AssuranceProviderActivationConfig, DatabaseConfig, DEFAULT_ARTIFACT_BUDGETS, RepositoryMappingConfig, rolePolicy (+25 more)

### Community 5 - "Submission Module"
Cohesion: 0.19
Nodes (34): artifactBase(), artifactValue(), assertNoSubmissionSecrets(), canonicalString(), deepFreeze(), digestEnvelope(), exactKeys(), invalid() (+26 more)

### Community 6 - "Action Gate Effective Policy"
Cohesion: 0.08
Nodes (35): Execution Lease, Repository Write Lease, Execution Admission, Cancellation Protocol, Workspace Fingerprint, Effective Policy, Policy Layering, Product Ceilings (+27 more)

### Community 7 - "Quality Gate"
Cohesion: 0.08
Nodes (34): Assurance Execution Context, Assurance Provider, Assurance Submission, Control Plane Kernel, Evidence Store, Mission, Plugin Boundary, Provider Invocation (+26 more)

### Community 8 - "Confirmed Testing Seams"
Cohesion: 0.08
Nodes (32): DSH Engineering Control Plane Plugin Composition, Engineering Control Plane Invariant Plugin, Engineering Control Plane Service, Engineering Control Plane Tools Plugin, ctx.subagents Execution Adapter, Harness Jobs, Plugin-Owned Mission Runtime, Plugin-Owned Mission Runner (+24 more)

### Community 9 - "Mission Authority"
Cohesion: 0.18
Nodes (6): AssuranceExecutionContext, AssuranceProviderCancellationOutcomeV1, AssuranceProviderInvocationCoordinator, receipt(), issueAssuranceProviderInvocationV1(), MissionAuthority

### Community 10 - "Types Module"
Cohesion: 0.09
Nodes (23): AssuranceClaimedOutcomeV1, AssuranceSubmissionBindingV1, FrozenAssuranceProviderSelectionV1, ValidatedAssuranceSubmissionV1, AssuranceAssessmentReasonCode, AssuranceAssessmentV1, AssuranceEligibilityFailureCode, AssuranceProviderInvocationBaseV1 (+15 more)

### Community 11 - "Kernel Index"
Cohesion: 0.11
Nodes (14): activateWriteLease(), ASSURANCE_ELIGIBILITY_FAILURE_CODES, ASSURANCE_PROVIDER_UNAVAILABLE_CODES, ASSURANCE_SUBMISSION_REJECTION_CODES, begunAssuranceProviderInvocationIndex(), currentAssuranceSubject(), leaseError(), mayExecuteAssurance() (+6 more)

### Community 12 - "Client Module"
Cohesion: 0.12
Nodes (11): Context, @deepseek-ai/cordis, freezeSnapshot(), MissionProjectionApplyResult, MissionProjectionEvent, MissionProjectionListener, MissionProjectionSnapshot, MissionProjectionStore (+3 more)

### Community 13 - "Mission Snapshot"
Cohesion: 0.17
Nodes (6): SqliteMissionStoreInspection, ControlPlaneKernelOptions, InMemoryMissionStore, MissionStore, MissionSnapshot, MissionExecutionHost

### Community 14 - "Contracts Module"
Cohesion: 0.20
Nodes (18): AssuranceExecutionSubjectV1, AssuranceProviderActivation, AssuranceProviderActivationPolicyV1, AssuranceProviderConfigurationV1, AssuranceProviderOutcomeV1, AssuranceSubmissionArtifactDraftV1, AssuranceSubmissionArtifactV1, AssuranceSubmissionDigestV1 (+10 more)

### Community 15 - "Tools Module"
Cohesion: 0.13
Nodes (17): activeAssuranceProviderInvocations(), retryableExternalAssuranceInvocations(), AssuranceProviderInvocationRecordV1, AssuranceResultV1, apply(), boundedText(), inject, legalNextActions() (+9 more)

### Community 16 - "Mission Runner"
Cohesion: 0.13
Nodes (16): latestAssuranceResults(), evaluateGate(), AssuranceProviderEligibilityV1, GateInput, CANCELLATION_QUIESCENCE, hasSelectedAssuranceProviders(), isRecord(), MissionRunHandle (+8 more)

### Community 17 - "Dev Dependencies"
Cohesion: 0.11
Nodes (18): @deepseek-ai/cordis-plugin-loader, @deepseek-ai/dsh-home-paths, @deepseek-ai/dsh-subprocess-local, @deepseek-ai/dsh-system-prompt, oxlint, devDependencies, @deepseek-ai/cordis-plugin-loader, @deepseek-ai/dsh-home-paths (+10 more)

### Community 18 - "Node Module"
Cohesion: 0.11
Nodes (17): node, vitest.config.ts, vitest/globals, compilerOptions, allowImportingTsExtensions, exactOptionalPropertyTypes, module, moduleResolution (+9 more)

### Community 19 - "Assurance Provider Descriptor V1"
Cohesion: 0.20
Nodes (8): AssuranceProviderDescriptorV1, AssuranceProviderDisposer, AssuranceProviderFactoryV1, AssuranceProviderV1, AssuranceProviderInvocationCoordinatorOptions, AssuranceProviderEntry, AssuranceProviderRegistry, descriptorKey()

### Community 20 - "Tsconfig Module"
Cohesion: 0.12
Nodes (16): ./tsconfig.json, compilerOptions, allowImportingTsExtensions, declaration, declarationDir, declarationMap, noEmit, outDir (+8 more)

### Community 21 - "Engineering Control Plane"
Cohesion: 0.28
Nodes (5): authority(), callingCwd(), EngineeringControlPlane, scopedRepository(), MissionAction

### Community 22 - "Role Contracts"
Cohesion: 0.20
Nodes (16): AssessmentOutput, DeveloperOutput, exactKeys(), findings(), findingSchema, nonemptyString(), object(), optionalQuestion() (+8 more)

### Community 23 - "Deepseek Ai Cordis"
Cohesion: 0.12
Nodes (16): @deepseek-ai/cordis, @deepseek-ai/dsh-agent, @deepseek-ai/dsh-invariants, @deepseek-ai/dsh-subprocess, @deepseek-ai/dsh-tools, @deepseek-ai/cordis, @deepseek-ai/dsh-agent, @deepseek-ai/dsh-invariants (+8 more)

### Community 24 - "Assurance Provider Composition Spec"
Cohesion: 0.14
Nodes (7): ADR-0067, cleanRepository(), run, satisfiedSubmissionFor(), temporaryRoots, outputs, registerScriptedEngineeringProvider()

### Community 25 - "Package Module"
Cohesion: 0.12
Nodes (15): bin, dsh-control-plane, patch, description, dsh, bundle, engines, node (+7 more)

### Community 26 - "Create Control Plane Kernel"
Cohesion: 0.16
Nodes (12): createControlPlaneKernel(), createInMemoryMissionStore(), authority, descriptor, policy, repository, authority, effectivePolicy (+4 more)

### Community 27 - "Mission Receipt"
Cohesion: 0.17
Nodes (6): missionId(), MissionReceipt, agent, missionId, snapshot(), StubControlPlane

### Community 28 - "Role Name"
Cohesion: 0.20
Nodes (9): HarnessRoleExecutor, HarnessRoleExecutorOptions, policyViolations(), RepositoryObserver, RoleName, RoleRunTrace, RoleExecutionHandle, RoleExecutionRequest (+1 more)

### Community 29 - "Exports Module"
Cohesion: 0.14
Nodes (14): default, types, default, types, exports, ./assurance-provider, ./client, ./invariant (+6 more)

### Community 30 - "Src Index"
Cohesion: 0.19
Nodes (11): Config, assertExpectedRevision(), Config, Context, @deepseek-ai/cordis, errorMessage(), MissionStartRequest, RepositoryPolicyBinding (+3 more)

### Community 31 - "Evidence Record"
Cohesion: 0.23
Nodes (7): EvidenceEnvelope, EvidenceJson, PublishEvidenceInput, EvidenceRecord, latestRecord(), latestRecordForAttempt(), RunnerEvidenceStore

### Community 32 - "Mission Id"
Cohesion: 0.22
Nodes (8): MissionCancelRequest, MissionResumeRequest, MissionReworkRequest, MissionError, MissionErrorCode, MissionId, MissionStatus, RestartRecoveryResult

### Community 33 - "Assurance Provider Submission Spec"
Cohesion: 0.16
Nodes (7): cleanRepository(), config(), configForDescriptors(), rejectionCases, run, submissionFor(), temporaryRoots

### Community 34 - "Parse Assurance Provider Descriptor V1"
Cohesion: 0.27
Nodes (11): boundedCanonicalString(), exactDescriptorKeys(), parseAssuranceProviderDescriptorV1(), EligibilityWithoutInvocation, evaluateAssuranceSubmissionEligibilityV1(), indeterminate(), nonEmpty(), record() (+3 more)

### Community 35 - "Mission Runner Happy Path Spec"
Cohesion: 0.17
Nodes (9): createMissionRunner(), authority, policy, repository, roleOutputs, temporaryRoots, authority, policy (+1 more)

### Community 36 - "Effective Policy"
Cohesion: 0.20
Nodes (7): EffectivePolicy, authority, policy, repository, authority, policy, repository

### Community 37 - "Loader Lifecycle Spec"
Cohesion: 0.20
Nodes (7): inject, install, name, cleanRepository(), run, temporaryRoots, waitForBlocked()

### Community 38 - "Mission Runner Execute Role"
Cohesion: 0.25
Nodes (5): boundedDiagnostic(), errorMessage(), MissionRunner, needsInput(), reportKind()

### Community 39 - "Invocation Coordinator"
Cohesion: 0.29
Nodes (6): AssuranceProviderUnavailableCode, AssuranceRequestV1, AssuranceSubmissionRejectionCode, AssuranceProviderResolutionError, AssuranceSubmissionValidationError, IssuedAssuranceProviderInvocationV1

### Community 40 - "Mission Runner Assurance Gate Spec"
Cohesion: 0.22
Nodes (8): assess(), authority, descriptor, policy, repository, roleOutputs, submissionFor(), temporaryRoots

### Community 41 - "Mission Runner Rework Context Spec"
Cohesion: 0.25
Nodes (5): authority, failedGateInput, policy, repository, temporaryRoots

### Community 42 - "Scripts Module"
Cohesion: 0.29
Nodes (7): scripts, build, lint, prepack, test, test:watch, typecheck

### Community 43 - "Mission Runner Cancellation Spec"
Cohesion: 0.29
Nodes (4): authority, policy, repository, temporaryRoots

### Community 44 - "Mission Phase"
Cohesion: 0.33
Nodes (4): isMissionPhase(), mayAdvance(), NEXT_PHASE, MissionPhase

### Community 45 - "Kernel Gate Spec"
Cohesion: 0.33
Nodes (5): authority, passingInput, phases, policy, repository

### Community 46 - "Kernel Lifecycle Spec"
Cohesion: 0.33
Nodes (5): authority, failedGateInput, phasesToReview, policy, repository

### Community 47 - "Cordis Patch"
Cohesion: 0.40
Nodes (5): files, cordis.patch.yml, lib/**/*.js, lib/types/**/*.d.ts, README.md

### Community 48 - "Control Plane Kernel"
Cohesion: 0.50
Nodes (3): ControlPlaneKernel, MissionRunnerOptions, freezePostImplementationSubject()

### Community 49 - "Kernel Cancel Spec"
Cohesion: 0.40
Nodes (3): authority, policy, repository

### Community 50 - "Deepseek Ai Dsh Subagent"
Cohesion: 0.67
Nodes (3): @deepseek-ai/dsh-subagent, @deepseek-ai/dsh-subagent, @deepseek-ai/dsh-subagent

### Community 51 - "Deepseek Ai Schemastery"
Cohesion: 0.67
Nodes (3): @deepseek-ai/schemastery, @deepseek-ai/schemastery, @deepseek-ai/schemastery

## Knowledge Gaps
- **258 isolated node(s):** `name`, `version`, `private`, `description`, `type` (+253 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MissionSnapshot` connect `Mission Snapshot` to `Filesystem Store`, `Sqlite Mission Store`, `Mission Runner Execute Role`, `Invocation Coordinator`, `Mission Authority`, `Types Module`, `Kernel Index`, `Mission Runner Cancellation Spec`, `Mission Runner Rework Context Spec`, `Tools Module`, `Mission Runner`, `Control Plane Kernel`, `Engineering Control Plane`, `Mission Receipt`, `Role Name`, `Src Index`, `Evidence Record`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `MissionAuthority` connect `Mission Authority` to `Filesystem Store`, `Repository Identity`, `Sqlite Mission Store`, `Types Module`, `Kernel Index`, `Mission Snapshot`, `Mission Runner`, `Engineering Control Plane`, `Create Control Plane Kernel`, `Src Index`, `Evidence Record`, `Mission Id`, `Mission Runner Happy Path Spec`, `Effective Policy`, `Mission Runner Execute Role`, `Invocation Coordinator`, `Mission Runner Assurance Gate Spec`, `Mission Runner Rework Context Spec`, `Mission Runner Cancellation Spec`, `Kernel Gate Spec`, `Kernel Lifecycle Spec`, `Control Plane Kernel`, `Kernel Cancel Spec`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `RepositoryIdentity` connect `Repository Identity` to `Filesystem Store`, `Mission Runner Happy Path Spec`, `Effective Policy`, `Sqlite Mission Store`, `Mission Runner Assurance Gate Spec`, `Mission Runner Rework Context Spec`, `Types Module`, `Mission Runner Cancellation Spec`, `Kernel Gate Spec`, `Kernel Lifecycle Spec`, `Kernel Cancel Spec`, `Create Control Plane Kernel`, `Src Index`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _258 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Action Gate` be split into smaller, more focused modules?**
  _Cohesion score 0.05182443151771549 - nodes in this community are weakly interconnected._
- **Should `Filesystem Store` be split into smaller, more focused modules?**
  _Cohesion score 0.055191256830601096 - nodes in this community are weakly interconnected._
- **Should `Repository Identity` be split into smaller, more focused modules?**
  _Cohesion score 0.07890070921985816 - nodes in this community are weakly interconnected._