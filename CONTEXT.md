# DSH Engineering Control Plane

DSH Engineering Control Plane governs AI-assisted engineering work from an accepted objective to an evidence-backed decision. Its language separates durable engineering truth from the agents and interfaces used to perform or observe work.

## Mission governance

**Control Plane Kernel**:
The authority that owns Mission lifecycle, role protocol, evidence acceptance, verification policy, quality decisions, and recovery.
_Avoid_: Subagent manager, workflow UI, agent wrapper

**Mission**:
A durable engineering objective governed from creation through approval or rework, including its repository identity, attempts, evidence, and decision history.
_Avoid_: Goal, task, chat, session

**Mission Contract**:
The revisioned normative intent of a Mission, composed from its objective, acceptance criteria, constraints, active User Decisions, and explicitly designated specification Evidence.
_Avoid_: Plan, context, transcript, repository documentation by default

**Specification Reference**:
A host-resolved opaque reference proving that the user explicitly designated one authorized, digest-bound document as normative Mission Contract Evidence.
_Avoid_: Model-supplied path, arbitrary URL, ordinary attachment

**Protocol Version**:
The immutable version of governance semantics under which a Mission is created and must continue throughout its lifecycle.
_Avoid_: Database schema version, plugin version, Mission Revision

**Protocol Adapter**:
The version-specific runtime implementation that advances a Mission strictly under its frozen Protocol Version after storage schema migration.
_Avoid_: Database migrator, compatibility guess, in-place semantic upgrade

**Design Ledger**:
The durable dependency graph of immutable design questions and Decision Resolutions owned by a Mission.
_Avoid_: Design Frontier, transcript, editable questionnaire

**Design Frontier**:
The current subset of unresolved User Decisions in a Design Ledger whose prerequisites are already settled.
_Avoid_: Design Ledger, all open questions, Plan

**Frontier Round**:
One presentation of every User Decision in the current Design Frontier, allowing any subset to be resolved before the Frontier is recomputed.
_Avoid_: Single question, Planner-selected sample, chat turn

**Design Closure**:
The Kernel-recognized completion of design after the Frontier is empty, independent completeness assessment passes, and any required user confirmation is resolved.
_Avoid_: Planner completion, empty response, Plan approval

**User Decision**:
A product, scope, acceptance, governance, or hard-to-reverse design choice whose authority remains with the user.
_Avoid_: Planner assumption, recommendation, User Authorization

**Decision Resolution**:
An immutable user-authored answer that closes one User Decision at a specific Mission Revision without rewriting the original question.
_Avoid_: Edited question, chat reply, Planner Choice

**Decision Message**:
A canonical user-role message that deterministically states one or more answers from exactly one current Design Frontier and supplies the source provenance from which `mission_decide` derives single-use Decision Authority.
_Avoid_: Direct browser mutation, model-authored answer, Decision Resolution

**Decision Grammar**:
The host-owned canonical syntax that maps a Decision Message to explicit question answers, including a deterministic accept-all alias for the recommended answers of one exact Frontier Round.
_Avoid_: Model interpretation of arbitrary prose, browser RPC mutation, fuzzy question matching

**Frontier Digest**:
The canonical digest of one presented Frontier Round, including its Mission Revision, question identities, options, recommendations, and dependencies, used to reject stale Decision Messages.
_Avoid_: UI cache key, Mission Revision alone, question text hash

**Decision Subject Key**:
A namespaced, host-normalized identity for one decision dimension used to prevent duplicate or disguised-equivalent User Decisions.
_Avoid_: Question text, decision id, model similarity score

**Decision Supersession**:
An immutable replacement for a prior Decision Resolution that preserves the old answer and invalidates every dependent design conclusion until resolved again.
_Avoid_: Edit, deletion, silent override

**Planner Choice**:
A local, reversible implementation choice delegated to the Planner and recorded in the Plan without becoming a User Decision.
_Avoid_: User Decision, observed fact

**Observed Fact**:
A repository, environment, dependency, or execution truth established through observation rather than supplied as a design decision; a fact that bears decision authority must be canonical Evidence.
_Avoid_: Assumption, user preference, Planner Choice

**Design Budget**:
The Effective Policy limits on design questions, Frontier Rounds, dependency depth, time, and model usage beyond which the Mission must block rather than assume answers.
_Avoid_: Token suggestion, automatic default, Artifact Budget

**Product Ceiling**:
The compiled upper bound that no host Profile, Repository Mapping, extension, or model input may exceed even when a lower Effective Policy value is configurable.
_Avoid_: Default value, repository preference, Action Reviewer exception

**Mission Revision**:
The monotonically increasing version of durable Mission truth used to reject stale commands and order projections.
_Avoid_: UI version, database row version

**Revision Journal**:
The append-only canonical sequence of immutable Mission Revisions and their integrity links, with a separately rebuildable current-head index.
_Avoid_: Mutable snapshot blob, Session event log, Event Sourcing claim

**Mission Receipt**:
The durable acknowledgement that a Mission command was accepted, identifying the Mission Revision and resulting status without implying that background execution has completed.
_Avoid_: Completion result, Job result

**Tool Contract Envelope**:
The strict versioned public result shape shared by the six model-facing Mission tools, carrying protocol identity, Mission revision and status, legal next actions, and a closed success or error result.
_Avoid_: Raw Kernel object, model-selected version, free-form error string

**Invocation Identity**:
The host-derived Repository, root Session, source Message, tool call, and canonical-input identity used to make one Mission command replay-safe without accepting a model-supplied idempotency key.
_Avoid_: Objective-text hash, caller-provided UUID, Mission id

**Input Record**:
An immutable addition to Mission intent, such as initial context, supplemental Resume context, or Rework instructions.
_Avoid_: Editable prompt, replacement objective

**Repository Identity**:
The canonical Git worktree root frozen into a Mission and used to attribute changes and enforce exclusive writing.
_Avoid_: Current directory, workspace label, path argument

**Workspace Fingerprint**:
A digest-bound observation of the repository and worktree state expected at a recovery boundary.
_Avoid_: Git diff, clean flag

**Produced Change Fingerprint**:
A path-free digest binding one Git Baseline to the raw tracked patch and every admitted untracked file byte produced by an Attempt.
_Avoid_: Workspace Fingerprint, Git status, Developer report

**Workspace Drift**:
An externally caused mismatch between the live repository and the Workspace Fingerprint governing the active Mission boundary; v0.2 preserves and blocks on it rather than adopting or reverting it.
_Avoid_: Developer implementation, automatic new baseline, engineering failure

**Git Baseline**:
The frozen branch and HEAD identity whose history remains user-owned while a Mission may change worktree and index content.
_Avoid_: Implementation Evidence, commit target

**Attempt**:
An immutable execution cycle of a Mission; quality rework or a post-implementation design change starts a new Attempt without rewriting prior results.
_Avoid_: Retry, rerun, Resume

**Attempt Seal**:
The immutable Gate input boundary binding one Attempt's Mission Contract, Design Closure, Plan, Assurance Plan, frozen registries, Evidence Manifest, Workspace Fingerprint, and Action Ledger root after execution has quiesced.
_Avoid_: Live Mission snapshot, Reviewer summary, final report

**Plan**:
The implementation intent accepted and frozen by the Kernel for one Mission Attempt; a Planner may propose it but cannot accept it.
_Avoid_: Planner response, todo list

**Plan Candidate**:
A non-authoritative implementation proposal awaiting independent plan-conformance assessment and Kernel acceptance.
_Avoid_: Plan, execution instruction, User Decision

**Write Scope**:
The host-normalized repository-relative paths and action intents frozen with a Plan that distinguish expected Developer writes from reviewable Plan deviations without weakening the product capability ceiling.
_Avoid_: Filesystem sandbox alone, arbitrary worktree access, path text in a prompt

**Plan Deviation Record**:
An immutable record of one Action-Gate-authorized, local and reversible departure from Write Scope that remains subject to final plan-conformance assurance.
_Avoid_: Plan amendment, policy expansion, implicit approval

**Planning Budget**:
The Effective Policy limits on Plan Candidate correction rounds, time, and model usage beyond which the Mission blocks rather than accepting an unreviewed Plan.
_Avoid_: Design Budget, automatic retry, Artifact Budget

**Role Run**:
The bounded execution of one Role Assignment by a Planner, Developer, Tester, or Reviewer within a specific Mission Attempt.
_Avoid_: Agent, child session, job

**Blocked**:
A recoverable Mission condition in which an operational prerequisite or infrastructure problem prevents progress without judging engineering quality.
_Avoid_: Failed review, rework required

**Cancelled**:
A terminal Mission condition recording an explicit decision to stop before approval.
_Avoid_: Failed, blocked

**Cancellation Quarantine**:
The fail-closed condition in which cancellation was requested but execution quiescence or final workspace capture cannot be proven, retaining repository exclusion until cancellation is safely completed.
_Avoid_: Cancelled, released lease, forced rollback

**Mission Store**:
The durable authority for Mission revisions, attempts, role runs, leases, and Evidence references across process restarts.
_Avoid_: Session log, Job registry, UI cache

**Safe Mode**:
The read-only plugin operating mode entered when startup composition, migration, registry, integrity, or storage validation cannot safely permit Mission mutation or execution.
_Avoid_: Best-effort execution, v1 fallback, automatic repair

## Authority

**Principal**:
An opaque host identity representing the human or trusted operator on whose behalf a root Session acts; it is never inferred from a Session id alone.
_Avoid_: Session, Agent, Message source, model identity

**Principal Resolver**:
The host Adapter that derives a Principal from trusted runtime context, using an installation-scoped local owner in standalone mode and requiring an explicit resolver in multi-user deployments.
_Avoid_: Model tool argument, browser claim, Session id alias

**Mission Access Policy**:
The Mission-frozen rules mapping Principals to read, decide, mutate, recover, or cancel actions in addition to Repository Identity and action-scoped authority checks.
_Avoid_: Session Binding, repository path possession, bearer token

**Service Capability**:
The Cordis dependency-injection contract through which host plugins consume the Engineering Control Plane service.
_Avoid_: Execution Capability, Assurance Requirement, permission, bearer token

**Mission Authority**:
A host-derived, repository- and action-scoped authorization value presented to the Kernel for every Mission command or query.
_Avoid_: Model-supplied token, Mission id, Service Capability, Decision Authority

**Decision Authority**:
Host-derived provenance binding a Decision Resolution to the current user principal, interaction turn, source-message digest, Repository Identity, and allowed decision identifiers.
_Avoid_: Mission Authority, model assertion, bearer token

**Revision Conflict**:
The structured rejection of a mutating command whose expected Mission Revision is stale.
_Avoid_: Automatic retry, last-write-wins

**Public Error Contract**:
The closed, redacted machine-readable failure taxonomy returned across tools, Service, Projection details, and UI without exposing resource existence, secrets, raw exceptions, or storage internals.
_Avoid_: Stack trace, arbitrary string, database error

**Diagnostic Reference**:
An opaque correlation identifier linking a safe public error to allowlisted local operational records without embedding sensitive diagnostic content in the response.
_Avoid_: Error details, filesystem path, Evidence id

**Action Gate**:
The authority that decides whether one requested Role Run action is allowed, reviewable, or forbidden within the Mission's Effective Policy.
_Avoid_: Quality Gate, tool filter, model permission

**Action Reviewer**:
An independent assessor that may authorize one reviewable action but cannot expand Effective Policy or decide engineering quality.
_Avoid_: Quality Gate, policy administrator, Reviewer

**Action Request**:
A normalized request to exercise one Execution Capability, independent of the Harness tool or Provider that originated it.
_Avoid_: Tool call, shell string, permission prompt

**Transport Action**:
An Action Request, such as `code.execute`, that hosts nested tool dispatch while leaving every nested capability independently mediated and correlated in the same execution tree.
_Avoid_: Approval for all nested actions, opaque `run_code`, leaf action

**Action Fingerprint**:
The deterministic host-normalized identity of an Action Request used for decision reuse, equivalence counting, and audit.
_Avoid_: Raw arguments, model-generated key, Action Request id

**Action Decision**:
The Action Gate's result for an Action Request, recording whether it is allowed, denied, or requires user authorization within Effective Policy.
_Avoid_: Quality decision, Reviewer report, model consent

**Action Outcome**:
The immutable post-quiescence record of whether a previously decided Action Request succeeded, failed, never dispatched, aborted before or after dispatch, or became operationally indeterminate.
_Avoid_: Action Decision, raw tool output, chat transcript

**User Authorization**:
A one-shot user outcome for one exact reviewable Action Request; it cannot alter Effective Policy or authorize an always-denied action.
_Avoid_: User Decision, policy exception, reusable grant

**Action Authorization Attempt**:
An ephemeral Harness Approval interaction for one Action Request within one open Role Agent turn; it has no authority unless its completed outcome is committed as a Kernel Action Decision and it never survives Role Run termination.
_Avoid_: Action Decision, resumable prompt, cached grant

**Action Review Budget**:
The Effective Policy limits on repeated or semantically equivalent Action Requests, review time, and review model usage beyond which the Mission blocks.
_Avoid_: Infinite retry, rate limit, Artifact Budget

**Action Capability Registry**:
The startup-composed, versioned registry of host-owned Action normalizers, product ceilings, redaction, equivalence, and outcome contracts whose resolved definitions are frozen for a Mission.
_Avoid_: Harness tool list, model-defined normalizer, live mutable policy

**Action Ledger**:
The Kernel-owned append-only sequence of durable Action Decisions and Action Outcomes whose integrity range is anchored to the governing Role Run.
_Avoid_: Session tool log, Mission Snapshot, approval UI history

## Assurance

**Assurance Requirement**:
A named proof obligation that a Mission must satisfy through validated Evidence, independently of which Role Agent performs the supporting work.
_Avoid_: Role, Execution Capability, generic capability

**Assurance Policy**:
The host-owned minimum set of Assurance Requirements that applies for a Mission and cannot be weakened by a Role Agent or later Attempt.
_Avoid_: Assurance Plan, Verification Profile, Reviewer checklist

**Assurance Requirement Registry**:
The versioned host registry of known Assurance Requirement kinds, their Evidence Contracts, evaluators, independence rules, and budgets.
_Avoid_: Planner-generated checklist, Assurance Plan, role catalog

**Assurance Provider**:
A host extension that implements a registered Assurance Requirement evaluator without owning its Result or Quality Gate meaning.
_Avoid_: Reviewer, Assurance Requirement Registry, Gate

**Assurance Provider Capability**:
A versioned, non-authorizing declaration of the Assurance Requirements, Evidence contracts, coverage dimensions, resource needs, and backend conditions an Assurance Provider supports.
_Avoid_: Execution Capability, Service Capability, permission

**Provider Availability**:
The startup-observed usable, unavailable, or invalid condition of an Assurance Provider, interpreted against host activation policy and any Provider Composition already frozen into an Attempt.
_Avoid_: Assurance Result, installation presence, automatic fallback

**Assurance Submission**:
An immutable, digest-bound Provider export that binds an external assessment to its subject, policy, coverage, outcome, Evidence, and provenance for validation and import into the Mission Evidence Store.
_Avoid_: Shared database row, report path, Provider-owned Gate decision

**Attempt Assurance Subject**:
The immutable, path-free Git branch, HEAD, Workspace Fingerprint, and Produced Change Fingerprint frozen only after one Attempt's implementation Evidence is published and used to bind every external assessment for that Attempt.
_Avoid_: Mission baseline, repository path, mutable checkout, Provider-selected subject

**Submission Digest**:
The canonical transport-integrity binding over an Assurance Submission payload; it proves that the transported value is unchanged but not that the source assessment is eligible or correct.
_Avoid_: Assessment Seal, Provider eligibility proof, Assurance Result

**Source Seal**:
The Provider-domain sealing artifact embedded by value in an Assurance Submission for later validation by a compatible Requirement evaluator.
_Avoid_: Submission Digest, Quality Gate decision, opaque Provider path

**Assurance Plan**:
The immutable set of host-observed, verification, and independent-review Assurance Requirements frozen for one Mission Attempt; later Attempts may add requirements but cannot remove inherited ones.
_Avoid_: Assurance Policy, Plan, role list

**Assurance Result**:
The deterministic aggregate satisfied, failed, or indeterminate outcome of every required Assurance Assessment for one Assurance Requirement.
_Avoid_: Reviewer opinion, finding severity, Quality Gate decision

**Assurance Assessment**:
One eligible assessor's Evidence-backed satisfied, failed, or indeterminate evaluation of an Assurance Requirement.
_Avoid_: Assurance Result, Reviewer prose, vote

**Assessor Identity**:
The host-derived identity of an Agent Assessor or Machine Provider Assessor binding all applicable Role Run, Agent, Provider, backend, rule, model, prompt, and execution lineage for eligibility and independence validation.
_Avoid_: Persona name, role label, tool name, model self-claim

**Machine Provider Assessor**:
A non-Agent Assessor whose frozen Provider Composition may satisfy only the machine assessment and independence obligations explicitly assigned to it by Assurance Policy.
_Avoid_: Reviewer Role Run, anonymous scanner, human review

**External Assessment Failure**:
A strict provider-neutral outcome showing that no sealed Assurance Submission was produced because external assessment remained blocked, was canceled, or failed, carrying no claimed Assurance outcome or Evidence.
_Avoid_: Assurance Submission, Security Verdict, failed Assurance Result, free-form Provider error

**Assurance Retry**:
An explicit Resume continuation that replaces a Gate-blocking `blocked` or `canceled` External Assessment Failure with a successor Provider Invocation against the same frozen Attempt Assurance Subject while preserving the failed Invocation and Result as history.
_Avoid_: Automatic retry, reusing an Invocation, Rework Attempt

**Assurance Execution Context**:
The Kernel-issued bounded environment through which an external Provider receives the frozen Attempt Assurance Subject and its exact Mission, Attempt, Provider, and Effective Policy bindings without repository paths or Kernel capabilities.
_Avoid_: Evidence Store writer, arbitrary repository access, Provider-owned permission

**Repository Binding Assertion**:
A process-local equality proof that one Provider-resolved canonical repository is the Mission Repository Identity without returning, serializing, or persisting either repository path.
_Avoid_: Repository ID alone, path hash, Subject claim

**Assurance Execution Budget**:
The frozen limits on Assurance Role Runs, replacement Assignments, concurrency, time, and model usage; exhaustion blocks rather than silently dropping a proof obligation.
_Avoid_: Assurance Plan, Action Review Budget, automatic retry policy

**Active Execution Budget**:
The frozen limits charged only while Agents, tools, verification, or action review actively execute, kept separate from time spent awaiting a human decision or authorization.
_Avoid_: Mission age, retention period, Human Wait

**Human Wait**:
A durable pause awaiting a Decision Message or User Authorization that consumes no Active Execution Budget and holds no Repository Write Lease.
_Avoid_: Active execution, automatic timeout answer, Mission cancellation

**Review Finding**:
A structured Reviewer observation whose category, severity, impact, Evidence references, remediation, and confidence are mapped to Gate significance by the Assurance Requirement Registry.
_Avoid_: Approval, free-form comment, self-declared blocker

**Standards Baseline**:
The digest-bound Evidence defining the repository-specific engineering standards against which repository-standards assurance is evaluated.
_Avoid_: Reviewer preference, README alone, generic best practices

**Independence Group**:
A policy-defined separation boundary whose Assurance Requirements must be assessed by distinct eligible Role Runs.
_Avoid_: Role name, parallelism group, model persona

**Evidence**:
A durable, integrity-bound observation accepted by the Kernel as support for an engineering decision.
_Avoid_: Agent claim, chat response, raw UI state

**Evidence Record**:
The schema-validated machine representation of Evidence consumed by the Kernel and Quality Gate.
_Avoid_: Markdown report, transcript

**Evidence View**:
A human-readable projection of one or more Evidence Records that carries no independent decision authority.
_Avoid_: Evidence Record, source of truth

**Safe Evidence Rendering**:
The allowlisted, sanitized presentation of untrusted Evidence Views that cannot execute HTML, scripts, remote content, dangerous URIs, commands, or unverified repository navigation.
_Avoid_: Raw Markdown rendering, trusted Reviewer prose, executable artifact

**Evidence Derivation**:
An integrity-bound record proving that Evidence reused across Attempts remains valid under its declared Evidence Contract and exact dependency digests.
_Avoid_: Copying an artifact id, digest equality alone, assumed stability

**Extraction Evidence**:
The versioned, location-mapped transformation of a digest-bound source artifact into model-readable content, recording extractor identity, media type, warnings, and truncation without replacing the original specification identity.
_Avoid_: Uploaded text alone, model vision claim, unlinked conversion

**Integrity Mode**:
The Mission-frozen audit-chain protection level: mandatory canonical SHA-256 consistency chaining and, when host-configured, HMAC-SHA-256 authenticity using a non-persisted key reference.
_Avoid_: Encryption, proof against the machine owner in digest-only mode, silent downgrade

**Artifact Budget**:
The configured hard limits on Evidence size, command streams, Mission storage, and bounded untracked content.
_Avoid_: Best-effort truncation, retention policy

**Redaction**:
The irreversible removal of prohibited sensitive values before Evidence is persisted, with the fact of removal itself recorded.
_Avoid_: Encryption, hidden raw copy

**Content Sanitization**:
The deterministic removal or neutralization of credentials, high-risk secret candidates, invalid encodings, terminal control sequences, active links, and other executable presentation content before persistence or rendering.
_Avoid_: Reviewer judgment, UI escaping alone, raw debug mode

**Implementation Evidence**:
The Kernel-observed change set between a Mission Attempt's frozen repository baseline and its post-implementation state, including tracked and bounded untracked changes.
_Avoid_: Developer file list, git diff alone

**Verification**:
The Kernel-governed evaluation of implementation behavior against configured functional, negative, regression, and security checks.
_Avoid_: Testing, Tester report

**Verification Profile**:
An explicit declaration of which verification categories require commands and which are not applicable with an auditable reason.
_Avoid_: Auto-detected tests, Tester-selected commands

**Effective Policy**:
The validated, redacted and digest-bound configuration frozen for the lifetime of a Mission.
_Avoid_: Live Cordis config, model-selected policy

**Policy Profile**:
A host-owned named configuration selected by canonical Repository Mapping, constrained by Product Ceilings, and frozen into Effective Policy without granting repository documents authority to widen execution.
_Avoid_: Verification Profile, repository-local permission file, model option

**Quality Gate**:
The deterministic, fail-closed decision over required Evidence that distinguishes approval, engineering rework, and operational indeterminacy.
_Avoid_: Action Gate, Reviewer opinion, tool approval, model approval

**Gate Evaluation Record**:
The authoritative immutable result of evaluating one Attempt Seal, including every Assurance Result, precedence reason, and resulting Mission disposition.
_Avoid_: Reviewer recommendation, final report, UI card

**Final Report**:
The deterministic human-readable Evidence View materialized by the Kernel from a Gate Evaluation Record and its referenced Evidence before the final transition is committed.
_Avoid_: Gate input, free-form Reviewer output, source of approval authority

**Approved**:
The Mission condition produced when the Quality Gate passes; it does not mean a separate human acceptance occurred.
_Avoid_: Completed, reviewed, human-approved

**Rework Required**:
The Mission condition produced when engineering Evidence fails the Quality Gate and a new Attempt may be requested explicitly.
_Avoid_: Infrastructure failure, automatic retry

**Resume**:
The explicit continuation of a Blocked Mission within the same Attempt, using a new Role Run while preserving the blocked execution record.
_Avoid_: Rework, retrying the same child

## Execution

**Role Assignment**:
The explicit purpose, inputs, Execution Capabilities, and optional Assurance Requirements given to one Role Run without changing its stable authority role.
_Avoid_: Role, prompt, child session

**Prompt Package**:
The Kernel-built, digest-bound, authority-layered input for one Role Assignment, separating host instructions from Mission Contract, Plan, canonical Evidence, and explicitly labelled untrusted repository content.
_Avoid_: Parent transcript, concatenated prompt, Role Agent memory

**Context Manifest**:
The deterministic inventory of every Prompt Package item that was included, summarized, retrievable, omitted, or truncated under the frozen context budget.
_Avoid_: Token count alone, invisible truncation, model-selected context

**Role Output Contract**:
The versioned Registry definition that validates one Assignment's structured result, identity binding, Evidence references, enums, and allowed fields before it may be published as canonical Evidence.
_Avoid_: Markdown parser, raw model response, authoritative approved field

**Role Run Provenance**:
The immutable record of Provider, model deployment, parameters digest, Prompt Package, Context Manifest, Output Contract, usage, stop reason, structured result digest, and trace references for one Role Run without promising deterministic replay.
_Avoid_: Transcript alone, model name, reproducibility proof

**Model Deployment Set**:
The ordered, Mission-frozen set of host-approved compatible model deployments from which a new Role Run may select exactly one without performing an in-run or ad hoc fallback.
_Avoid_: Any available model, Provider identity, model supplied by user text

**Governed Skill Definition**:
The host-allowlisted Skill identity, version, and digest treated as privileged Role instruction and frozen into the Prompt Package provenance for an eligible Assignment.
_Avoid_: Arbitrary installed Skill, model-selected instruction source, Execution Capability

**Execution Capability**:
A bounded class of actions that host policy permits a Role Run to perform while pursuing its assignment.
_Avoid_: Assurance Requirement, Service Capability, role persona

**Network Action**:
A per-hop normalized request binding scheme, host, port, method, purpose, body digest, resolution, and redirect state so approval of one endpoint cannot authorize another.
_Avoid_: URL string, domain suffix permission, Session-wide network grant

**Command Action**:
A registered structured process request binding resolved executable identity, argv, canonical cwd, environment-name set, timeout, and purpose without treating shell text as an executable policy object.
_Avoid_: Shell command string, prompt instruction, Verification result

**Stable File Identity**:
The handle-derived file and parent identity revalidated at decision, dispatch, and outcome boundaries to prevent path, symlink, junction, hard-link, reparse-point, or time-of-check/time-of-use escape.
_Avoid_: Normalized path string alone, file name, model assertion

**Mission Runner**:
The transient Control Plane executor that advances an already accepted Mission independently of the initiating tool call or Agent lifecycle.
_Avoid_: Mission, Job, Role Agent

**Execution Admission**:
The fair, bounded plugin scheduler decision that permits a Mission Runner or Role Run to start without changing Mission authority or bypassing repository and execution leases.
_Avoid_: Mission approval, priority promise, unbounded spawn

**Role Agent**:
A replaceable worker that performs a Role Run and reports observations without owning Mission state or approval authority.
_Avoid_: Control Plane, orchestrator

**Governed Role Provider**:
A Gate-Compatible subagent Provider that installs Role Binding, tool restrictions, Action Gate mediation, structured-result capture, and role instructions inside the Agent publication transaction before any Role Agent can run.
_Avoid_: Generic Subagent Provider, post-publication listener, Harness Core patch

**Governed Provider Identity**:
The frozen Provider name, Protocol Version, and implementation digest that must match before each Role Run and prevents a same-named replacement from silently assuming authority over an existing Mission.
_Avoid_: Provider name alone, package version alone, live registry entry

**Role Binding**:
The host-owned association of one unpublished or live Role Agent with its Mission, Attempt, Role Run, authority role, and Fencing Token, established before publication and unavailable to model input.
_Avoid_: Child label, prompt metadata, Session title

**Needs Input**:
A Role Run outcome stating that required human information is absent; it blocks the Mission without judging engineering quality.
_Avoid_: Failure, question dialog, refusal

**Write Lease**:
The Control Plane's exclusive, repository-scoped right to run a writing Role Run, guarded across host processes by a Fencing Token.
_Avoid_: Filesystem lock, Git lock, ownership claim without fencing

**Mission Execution Lease**:
The separately fenced, process-scoped right for exactly one plugin instance to advance one Mission Runner, independent of the repository-scoped Write Lease and unnecessary for read-only queries.
_Avoid_: Write Lease, Session ownership, automatic crash takeover

**Fencing Token**:
The lease epoch that prevents a former Write Lease holder from committing new Mission state after ownership changes.
_Avoid_: Mission id, process id, timeout alone

**Execution Trace**:
A best-effort navigable record of how a Role Run was carried out, such as a child Session or Provider run reference; absence or later loss never changes the Role Run outcome or replaces canonical Evidence.
_Avoid_: Evidence, Mission state

**Mission Session Binding**:
A durable, audited but non-authoritative association that lets one authorized root Harness Session receive Mission projections, submit Decision Messages, and navigate available Execution Traces without making that Session the Mission owner.
_Avoid_: Mission ownership, Write Lease, Session as Mission identity

**Mission Projection**:
A bounded, allowlisted whole-summary mirror emitted after Kernel commits into bound root Sessions for chat or UI surfaces; it has no independent transition or decision authority.
_Avoid_: Mission Store, UI state machine, source of truth

**Projection Outbox**:
The transactional, replayable queue written with a Mission Revision and acknowledged only after best-effort delivery to bound Session projections.
_Avoid_: Mission history, browser cache, transition trigger

**Mission Detail View**:
A redacted, immutable, paginated read-only view of Evidence, Findings, and Action Ledger entries fetched for an authorized bound root Session without exposing a state-changing browser endpoint.
_Avoid_: Mission Projection, raw Evidence payload, browser command API

**Operational Telemetry**:
The local-by-default allowlisted logs and metrics containing identifiers, states, error codes, digests, and durations but no raw prompts, answers, Evidence payloads, command output, or secret-bearing action arguments.
_Avoid_: External analytics by default, full debug capture, Evidence Store

## Delivery assurance

**Harness Compatibility Matrix**:
The explicit set of DeepSeek Harness package and Node versions, public capabilities, and operating systems against which one plugin release is built and proven.
_Avoid_: Broad RC compatibility assumption, local source layout, latest version

**Capability Probe**:
The read-only startup validation that required public Harness services and semantics are present before execution is enabled, supplementing rather than replacing the Compatibility Matrix.
_Avoid_: Private-source inspection, version bypass, feature polyfill

**Scripted Provider**:
The deterministic test implementation of Governed Role execution that controls structured outputs, usage, cancellation, timing, malicious behavior, and failures without calling a live model.
_Avoid_: Production Provider, mock Kernel, live-model oracle

**Fault Injection Matrix**:
The enumerated crash, cancellation, corruption, race, and partial-write boundaries that must preserve Kernel invariants under deterministic tests.
_Avoid_: Random flaky testing, happy path suite, production experiment

**Migration Fixture**:
A versioned byte-level legacy Mission Store and Evidence corpus used to prove backup, transactional migration, Protocol Adapter retention, and fail-closed handling without inventing history.
_Avoid_: Hand-created current schema, empty database, mutable test setup

**Packed Installation**:
A clean-project installation of the produced npm tarball using only declared public exports and peer dependencies, proving that workspace links and Harness source access are unnecessary.
_Avoid_: Monorepo link test, source execution, copied Harness code

**Release Gate**:
The complete blocking set of static, unit, property, fault, multi-process, migration, integration, Web, security, documentation, and packed-install checks required to promote an exact build.
_Avoid_: Build success alone, live-model anecdote, manual checklist without evidence

**Dogfood Mission**:
A manually observed Mission governed by the release candidate against the plugin's own repository after deterministic gates pass, used as product feedback rather than the sole correctness oracle.
_Avoid_: CI replacement, self-approval proof, unrecorded demo
