# DSH Engineering Control Plane Kernel Architecture

> Status: v0.1 architecture baseline
>
> Product position: DSH Engineering Control Plane is the engineering-governance kernel above DeepSeek Harness. Harness supplies execution and presentation adapters; it does not own Mission semantics.
>
> Successor: [v0.2 architecture](control-plane-kernel-architecture-v0.2.md). This file remains the `control-plane/1` compatibility baseline.

## 1. Positioning

The Control Plane Kernel is the product. Its purpose is not to make subagents easier to launch. Its purpose is to turn an engineering objective into an auditable, recoverable decision:

```text
Mission accepted
  -> implementation performed
  -> real-world verification captured
  -> risks reviewed
  -> evidence evaluated
  -> APPROVED or REWORK_REQUIRED
```

DeepSeek Harness is the first host runtime. Its subagents, subprocess runner, Jobs, Session log and Web client are valuable existing Modules, but they remain replaceable execution and presentation mechanisms below the kernel.

The ownership direction is fixed:

```text
User / model / Web
        |
        v
EngineeringControlPlane Interface
        |
        v
Control Plane Kernel
  Mission aggregate
  State machine
  Orchestrator
  Verification policy
  Evidence ledger
  Quality Gate
  Recovery rules
        |
        v
Internal seams
  RoleExecutor  CommandExecutor  MissionStore  EvidenceStore  ProjectionSink  AuthorityPolicy
        |
        v
DeepSeek Harness adapters
  ctx.subagents  ctx.subprocess  ToolRunContext  Session events  Web UI
```

The arrows never reverse. A subagent result, Session state or UI action may provide an observation or request, but none of them may directly mutate Mission truth. Mission execution is hosted by the plugin-owned Mission Runner rather than delegated to the process-local Harness Job registry.

## 2. Kernel invariants

These are product invariants, not implementation advice:

1. **Mission state is authoritative.** Only the Kernel transition table can change Mission status.
2. **Completed is not Approved.** A Developer child ending normally can only complete a role run; it cannot advance the Mission past verification or set the gate result.
3. **Evidence precedes decisions.** A required artifact or verification result must be durably published and indexed before a transition that depends on it is committed.
4. **Agents report; the Kernel decides.** Planner, Developer, Tester and Reviewer outputs are untrusted reports. They never become world facts without host observation or evidence validation.
5. **The Gate fails closed.** Missing, corrupt, truncated, stale or contradictory required evidence cannot produce `APPROVED`.
6. **Persistence precedes projection.** Commit Mission revision first; publish Session/Web observations afterward. A projection failure may make the UI stale but cannot rewrite Mission truth.
7. **Every attempt is immutable history.** Rework creates a new attempt and new role runs; it never edits the evidence or transcript of an earlier attempt.
8. **Recovery is deterministic.** After restart, the same durable Mission revision and evidence index must yield the same next legal action and gate decision.
9. **Execution identity is not domain identity.** A child Session id, provider run id or Job id is trace metadata attached to a `RoleRun`; none is the Mission id or the source of role outcome semantics.
10. **UI is observe/control only.** Role cards, child transcripts and side panels may request Kernel commands or navigate trace data; they never implement transitions or gate logic.
11. **One active Mission owns one worktree.** v0.1 rejects a second non-terminal Mission for the same Repository Identity, preventing plans and baselines from becoming stale behind another Mission's changes.
12. **Git history remains user-owned.** The Kernel freezes branch and HEAD; Role Runs may change worktree and index content but cannot change history or branch identity.

## 3. The deep Kernel Module

The Kernel should expose one small command Interface and one query:

```ts
interface ControlPlaneKernel {
  dispatch(command: MissionCommand, authority: MissionAuthority): Promise<MissionReceipt>
  snapshot(missionId: MissionId, authority: MissionAuthority): Promise<MissionSnapshot>
}
```

`MissionCommand` is a closed v0.1 union such as:

```ts
interface StartMissionInput {
  objective: string
  context?: string
  acceptanceCriteria?: readonly string[]
  constraints?: readonly string[]
}

type MissionCommand =
  | { kind: 'start'; idempotencyKey: string; input: StartMissionInput }
  | { kind: 'resume'; missionId: MissionId; expectedRevision: number; input: SupplementalInput }
  | { kind: 'cancel'; missionId: MissionId; expectedRevision: number; reason?: string }
  | { kind: 'rework'; missionId: MissionId; expectedRevision: number; instructions?: string }
```

The first model-facing Adapter uses five explicit tools — `mission_start`, `mission_status`, `mission_resume`, `mission_cancel`, and `mission_rework` — rather than exposing `dispatch` or a conditional action schema. `mission_start` is atomic create-and-start; there is no model-facing draft Mission. Resume preserves the Attempt and adds a replacement Role Run; rework creates a new Attempt.

Their strict model inputs are:

```ts
mission_start({ objective, context?, acceptanceCriteria?, constraints? })
mission_status({ missionId })
mission_resume({ missionId, expectedRevision, supplementalContext? })
mission_cancel({ missionId, expectedRevision, reason? })
mission_rework({ missionId, expectedRevision, instructions? })
```

Unknown fields are rejected. Start accepts no repository path, model, provider, command or Verification Profile and does not automatically copy a parent transcript. Status returns a bounded snapshot containing revision, status, attempt, blocked reason, Role Run summaries, Evidence references, Gate result and legal next actions. Supplemental and Rework input append immutable Input Records; they never overwrite Mission intent.

The revision precondition prevents two callers, stale Web state or a retried tool invocation from racing a transition. `MissionReceipt` reports acceptance, resulting revision and current status; long-running work continues under Kernel ownership and is observed through `snapshot` and projections. The Harness tool Adapter derives `MissionAuthority` from its caller, canonical repository and host policy; neither a Mission id nor model-supplied text is itself authorization.

For `mission_start`, the Adapter validates authority, repository identity, clean-worktree policy and configuration, acquires the Write Lease, and commits the accepted Mission before returning a receipt. Harness `ToolRunContext.callId` is persisted as the idempotency key. Cancellation before that commit leaves no Mission; after acceptance, the Mission Runner is independent of the initiating tool signal and only `mission_cancel` requests cancellation.

Everything else stays in the Implementation: state transitions, role ordering, provider policy, role prompts, tool restrictions, output schemas, subprocess plans, evidence publication, retries, disposal, recovery and gate evaluation. `EngineeringControlPlane` is the Cordis-facing Adapter around this Interface, not the domain itself.

Deletion test: deleting the Kernel would force every caller to reimplement Mission transitions, evidence ordering, recovery and gate policy. Deleting the Web face or the Harness subagent Adapter would remove one way to observe or execute work, but the Mission model and gate rules would remain intact.

## 4. Kernel-owned domain model

The minimum aggregate is:

```ts
interface MissionSnapshot {
  missionId: MissionId
  revision: number
  repository: RepositoryIdentity
  objective: string
  context?: string
  acceptanceCriteria: readonly string[]
  constraints: readonly string[]
  effectivePolicyDigest: string
  status: MissionStatus
  attempt: number
  roleRuns: readonly RoleRunRecord[]
  evidence: EvidenceManifest
  gate?: GateDecision
  createdAt: string
  updatedAt: string
}
```

The accepted v0.1 lifecycle extends the specification with operational states that do not masquerade as engineering-quality outcomes:

```text
CREATED -> ANALYZING -> PLANNING -> IMPLEMENTING
        -> VERIFYING -> REVIEWING -> APPROVED
                                  -> REWORK_REQUIRED

REWORK_REQUIRED -> PLANNING      (attempt + 1, incremental Plan)

any active phase -> BLOCKED       (recoverable operational condition)
any non-terminal state -> CANCELLED
```

Infrastructure failure and cancellation are recorded separately from engineering quality. They must not be disguised as `REWORK_REQUIRED`: a command timeout or provider outage moves the Mission to recoverable `BLOCKED`, while explicit user cancellation produces terminal `CANCELLED`. v0.1 has no catch-all `FAILED` state. `mission_resume` keeps the current Attempt and resumes the recorded interrupted phase; when a Role Run was interrupted, the Kernel appends a replacement Role Run and preserves the prior run as immutable history.

Every mutating command requires `expectedRevision`, except atomic Start which has no pre-existing Mission. A mismatch returns a structured `revision_conflict` carrying the current revision and status; the Kernel never retries or applies stale intent. Start uses its Adapter-supplied tool-call idempotency key to return the existing receipt when the same accepted invocation is replayed.

The Git Baseline freezes canonical worktree root, branch and HEAD. Developer may change worktree and index content, including staging, but commit, branch switch, merge, rebase, reset, stash and worktree creation are forbidden. A changed branch or HEAD blocks the Mission without rollback; the plugin never commits on the user's behalf.

Each role run belongs to a Mission attempt:

```ts
interface RoleRunRecord {
  roleRunId: RoleRunId
  missionId: MissionId
  attempt: number
  role: 'planner' | 'developer' | 'tester' | 'reviewer'
  state: 'queued' | 'starting' | 'running' | 'completed' | 'failed' | 'aborted'
  outcome?: RoleExecutionOutcome
  executionRef?: {
    adapter: 'deepseek-harness'
    parentSessionId: string
    childSessionId?: string
    provider?: string
  }
  artifactIds: readonly ArtifactId[]
  startedAt?: string
  finishedAt?: string
}
```

`executionRef` exists for trace navigation and diagnostics. The Kernel never infers a role outcome from whether that Session is `running`, `inactive`, open, selected or visible.

## 5. Internal seams and adapters

These seams are private to the Kernel package. They are not exposed as a plugin ecosystem in v0.1.

### RoleExecutor

```ts
interface RoleExecutor {
  execute(request: RoleExecutionRequest, signal: AbortSignal): Promise<RoleExecutionOutcome>
}
```

The DeepSeek Harness Adapter maps this to `ctx.subagents.start()` and normalizes `SubagentResult`. The scripted test Adapter returns deterministic results and failure modes. v0.1 uses session-backed in-process `spawn` runs so every role has a durable child transcript and one-shot `outputSchema` validation.

The Kernel supplies the role, attempt, evidence inputs, persona policy, tool policy and expected result shape. The Adapter returns normalized output plus trace metadata; it does not choose the next Mission state.

### Mission Runner

The Mission Runner is transient process-local execution owned by the Control Plane service. It owns each accepted Mission's AbortController, advances phases through Kernel commands, and reaches quiescence before cancellation releases a Write Lease. It is deliberately not registered in `ctx.jobs`: owned Jobs end with their Agent lifecycle, unowned Jobs have unsuitable shared access, and neither survives process restart.

On service startup, every persisted Mission left in an active phase is atomically moved to `BLOCKED` with reason `HOST_RESTARTED`; no work is auto-resumed. An explicit `mission_resume` must reacquire authority and the repository lease, then verify the recorded Workspace Fingerprint before the interrupted phase can continue in the same Attempt.

### CommandExecutor

```ts
interface CommandExecutor {
  execute(spec: VerificationCommand, signal: AbortSignal): Promise<CommandEvidence>
}
```

The Harness Adapter uses `ctx.subprocess` with an argv array. The test Adapter scripts exit code, signal, timeout, stdout/stderr and truncation. The Kernel owns which configured checks are required and how their normalized evidence affects the Gate.

### MissionStore and EvidenceStore

These are real seams because production and tests need different adapters:

- production Mission state: plugin-owned `node:sqlite` at `$DSH_HOME/control-plane/control-plane.sqlite`, using transactions, expected revisions and repository-scoped lease records;
- production Evidence: digest-bound files rooted at `$DSH_HOME/control-plane/missions/<missionId>`, written through temporary files and atomic replacement before a SQLite transaction publishes their references;
- tests: in-memory adapters that preserve revision, atomicity and failure behavior.

The Kernel controls ordering across them. An Adapter cannot publish an artifact directly into the Mission index without the Kernel validating its kind, size, digest, redaction status and attempt ownership. A crash may leave an unreferenced completed file, but no durable Mission revision may reference a partial or missing artifact. The store does not depend on optional `storageDomain` wiring and promises process-crash consistency; sudden-power-loss durability is documented as best-effort in v0.1.

Artifact Budgets are hard policy. The initial configurable defaults are 1 MiB per Role output, 4 MiB for each stdout or stderr stream, 16 MiB per artifact, 256 MiB per Mission, and at most 256 untracked files totaling 32 MiB. Exceeding a structural artifact budget blocks progress; capped command output is recorded as truncated and required truncated Evidence cannot pass the Gate. v0.1 never silently clips a decision-bearing artifact or automatically deletes audit Evidence.

Sensitive values are removed before persistence. Evidence records environment reference names, never environment values, credentials or authorization headers. A secret detected in Implementation Evidence is a blocking security finding; redaction that makes required command Evidence incomplete blocks the Mission. No hidden raw copy is retained by the plugin.

### ProjectionSink

Projection is best-effort observation after a durable commit:

- parent Session `control-plane/*` events for replayable Mission cards;
- Host/Web live updates;
- logs and metrics.

Its failure is reported and retried where practical, but never rolls back or fabricates a Mission transition. A no-op test Adapter proves that the Kernel can run headless without any UI.

Every projection carries the committed Mission Revision. A Web client first obtains a snapshot at revision N and then accepts contiguous events from N+1; stale events are ignored, while disconnects, reordering or a revision gap trigger a fresh snapshot. React state is therefore a recoverable cache, not a second Mission store.

## 6. Role protocol

The role protocol belongs to the Kernel, even though Harness executes it.

### Planner

- Input: frozen Mission context, repository facts and constraints.
- Authority: read-only.
- Output: structured plan plus `plan.md` candidate.
- Kernel validation: schema, artifact limits and repository/attempt binding; a valid Plan is frozen and automatically advances without human confirmation.

### Developer

- Input: accepted plan, current attempt and repository baseline.
- Authority: the only role allowed to mutate the target workspace, confined to the complete canonical worktree with no path escape.
- Output: implementation report, not `implementation.diff` authority.
- Kernel validation: after the child settles, inspect the workspace and capture the actual diff independently.

### Tester

- Input: host-captured command evidence and implementation evidence.
- Authority: read-only and receives no command-execution capability; all authoritative commands remain in `CommandExecutor`.
- Output: structured interpretation and `test-report.md` candidate.
- Kernel validation: the report cannot turn a failed, missing or truncated required command into success.

### Reviewer

- Input: Mission context, plan, actual diff, normalized verification evidence and known limitations.
- Authority: read-only through actual tool restriction and host permissions, not persona text alone.
- Output: structured findings and `review-report.md` candidate.
- Kernel validation: blocking findings remain blocking even if prose recommends approval.

Planner, Tester, and Reviewer are protected twice: their Harness tool policy denies writing capabilities, and the Kernel compares repository state before and after each Role Run. Any observed mutation blocks the Mission, preserves the scene for inspection, and never auto-reverts files.

A Role Agent that lacks required information returns the structured `needs_input` outcome. It never opens a direct user-question channel. The Kernel records the Role Run, moves the Mission to `BLOCKED`, and waits for an explicit Resume carrying supplemental input.

All Role outputs use strict, versioned schemas with common `schemaVersion`, `outcome`, `summary`, and optional `needsInput` fields. Planner adds steps, risks, assumptions and verification intent; Developer adds advisory change summaries, touched areas and known limitations; Tester adds Evidence-id assessments and failure analysis; Reviewer adds findings with severity, category, Evidence references and remediation plus residual risks. Unknown fields are rejected, and no schema contains an authoritative `approved` field.

## 7. Verification and Quality Gate

Verification is a Kernel Module, not a Tester behavior. It plans and normalizes configured functional, negative, regression and security commands through `CommandExecutor`. Tester interpretation is an artifact layered on those facts.

Each Verification Profile must explicitly classify every category as either commands-required or `not-applicable` with a durable reason. An omitted category is incomplete policy and blocks approval. A Tester cannot add an authoritative command at runtime.

v0.1 resolves named Verification Profiles only from host-owned Cordis configuration and canonical-repository mappings. There is no repository-local discovery and no model-selected profile. An unmapped repository cannot start. The validated profile is part of the redacted Effective Policy snapshot and remains frozen for the Mission's entire lifetime, including Rework Attempts.

Evidence Records are schema-validated JSON and form the only Gate input. The required `context.md`, `plan.md`, `implementation.diff`, `test-report.md`, `review-report.md`, and `final-report.md` are Evidence Views for people; the Kernel never reparses their prose to recover decision facts.

Implementation Evidence starts from a frozen repository baseline covering HEAD, branch, index and worktree state. The post-run capture accounts for staged, unstaged, deleted, renamed and bounded untracked content; `git diff` alone is not complete enough.

Quality Gate is a pure Kernel function:

```ts
function evaluateGate(input: GateInput): GateDecision
```

`GateInput` contains only normalized, digest-bound evidence for one Mission revision and attempt. It does not contain live Agent objects, Session snapshots, UI state or raw promises. The decision includes machine-readable reasons so `final-report.md`, Web presentation and tests all project the same result.

The Gate distinguishes three outcomes:

- complete passing Evidence produces `APPROVED`;
- definite engineering failure such as a non-zero verification result, blocking Reviewer finding, or secret in Implementation Evidence produces `REWORK_REQUIRED`;
- missing, corrupt, timed-out, truncated, decision-obscuring redacted, provider-failed, or policy-violating Evidence is indeterminate and produces recoverable `BLOCKED`.

Only a passing Gate transition may produce `APPROVED`. A model-facing tool named `approve`, a generic Harness approval response or a Reviewer sentence cannot bypass this function. Tester interpretation cannot convert host Evidence between the failure and indeterminate classes.

Every Mission command and query requires host-derived `MissionAuthority` for its specific action. Existing-Mission tools also require an explicit Mission id and a caller whose canonical worktree matches the Mission Repository Identity, allowing recovery from a newly authorized Session without granting cross-repository control. `EngineeringControlPlane` remains the separate Cordis Service Capability used for dependency injection; no model-visible bearer token substitutes for either check.

## 8. Harness and Web positioning

Harness Modules remain important, but each has a subordinate role:

| Harness Module | Kernel Adapter responsibility | Explicitly not authoritative for |
|---|---|---|
| `ctx.subagents` | execute isolated role work and retain transcript | Mission status, evidence validity, approval |
| `ctx.subprocess` | execute configured commands and capture process facts | deciding which checks pass the Gate |
| Session log | replayable observations and child transcript | sole Mission persistence |
| `ui-subagent` | navigate and inspect child Sessions | role outcome or Gate state |
| Mission Web face | project snapshots and dispatch commands | implementing transitions in React state |
| addressed side panel | improve simultaneous parent/child inspection | any domain semantics |

`ctx.jobs` is intentionally absent from the execution path. Its Agent-owned and unowned lifecycles do not satisfy durable Mission authority, so generic Job controls cannot kill, resume or redefine Mission work.

The Codex-like role card therefore projects Kernel-owned `RoleRunRecord` state. Clicking it follows `executionRef` into the Harness transcript. If a transcript is unavailable, the card still shows the authoritative role outcome and artifact references; UI capability loss must not erase Mission truth.

The proposed Addressed Side Session Module remains optional Harness infrastructure. The Kernel neither imports it nor changes behavior when it is absent.

## 9. Package locality

Keep one npm package for v0.1, but make the ownership visible in the directory structure:

```text
src/
  kernel/
    index.ts                 # ControlPlaneKernel Interface
    mission.ts               # aggregate and revision rules
    commands.ts              # closed MissionCommand union
    orchestrator.ts          # role and verification sequencing
    state-machine.ts         # legal transitions
    verification.ts          # normalized verification policy
    evidence.ts              # manifest and publication rules
    gate.ts                  # pure fail-closed decision
    ports.ts                 # internal seams only
  adapters/
    dsh-role-executor.ts     # ctx.subagents
    dsh-command-executor.ts  # ctx.subprocess
    mission-runner.ts        # accepted Mission background execution
    session-projection.ts    # parent Session observations
    sqlite-mission-store.ts
    filesystem-evidence-store.ts
  plugin/
    service.ts               # Cordis-facing Adapter/facade
    tools.ts                 # model-facing command Adapter
    authority.ts             # ToolRunContext -> MissionAuthority
    config.ts
  client/
    index.ts
    mission-definition.ts
    MissionRunPanel.tsx
    locales.ts
```

Imports point inward: `client` and `plugin` consume Kernel contracts; `adapters` satisfy Kernel seams; `kernel` imports no Cordis, Harness, React or browser types. This is grep-verifiable and keeps the product portable without prematurely splitting packages.

The Cordis Config resolves role model overrides, named Verification Profiles and repository mappings, timeouts, Artifact Budgets, secret environment names, redaction patterns, lease timing and the Web projection switch. Storage locations and the fixed `spawn` provider are not model inputs. At Start, the service validates and redacts this data into an Effective Policy snapshot and digest; live config changes affect only newly accepted Missions.

SQLite schema changes are versioned, forward-only and transactional, with a backup before migration. A corrupt database or one with a newer unknown version is preserved byte-for-byte and causes fail-closed startup. The package supplies a read-only `dsh-control-plane doctor`; v0.1 never automatically repairs the database, clears a lease, or deletes Evidence.

## 10. Implementation order

1. Implement the pure Mission aggregate, transition table, evidence manifest and Gate.
2. Test the Kernel through `dispatch` and `snapshot` with in-memory/scripted adapters, including crash points and stale revisions.
3. Add SQLite Mission state, filesystem Evidence, fenced leases and restart recovery.
4. Add Harness role and command adapters plus the plugin-owned Mission Runner.
5. Add the Cordis-facing entry and minimal model tools.
6. Add parent Session projections and the Mission Web face.
7. Add optional addressed side-session support only after the Kernel path is complete.

This order keeps the Control Plane usable and testable before any subagent UI exists, which is the practical proof that the kernel has not been reduced to presentation around Harness.

Tests use only the four accepted seams recorded in [Confirmed testing seams](docs/testing-seams.md): the Kernel Interface, five model tools, real Loader composition, and revisioned projection. The first TDD tracer bullet crosses atomic Start through Status; each later behavior is added as one red-green vertical slice.

## 11. Accepted v0.1 product decisions

1. The first write path is model-facing Mission tools invoked from an ordinary chat; Web observes Mission state and opens Role Run traces.
2. `BLOCKED` represents recoverable operational failure, `CANCELLED` is terminal, and `REWORK_REQUIRED` is reserved for Quality Gate failure.
3. Planner is a first-class read-only Role Agent that proposes a Plan; the Kernel validates and freezes it. Developer is the only role allowed to mutate the target workspace.
4. Every gate-bearing role is an immutable one-shot, session-backed in-process child per Attempt.
5. A passing Quality Gate directly produces `APPROVED`; human acceptance is outside v0.1 and must use a different term if added.
6. Rework is explicit, creates a new Attempt, and never automatically loops.
7. A Mission requires a clean Git worktree and obtains the single write lease for its canonical worktree. The plugin never stashes, resets, or silently absorbs pre-existing changes.
8. Evidence lives outside the target repository under `$DSH_HOME/control-plane/missions/<missionId>` and is indexed by digest.
9. Verification profiles declare explicit argv arrays, categories, timeouts, and output limits. Missing required checks block approval; neither auto-detection nor a Tester chooses commands.
10. v0.1 is implemented entirely as the `DSH Engineering Control Plane` plugin against public Harness seams. It does not modify `deepseek-harness-master`; exact side-by-side child rendering remains an optional future Harness capability.
11. The model-facing Adapter uses five separate tools, adding `mission_resume` to start/status/cancel/rework. Resume and rework remain distinct Kernel commands.
12. `mission_start` accepts no repository path. Repository Identity is derived from the calling Agent's cwd and frozen as the canonical Git worktree root.
13. A valid Planner result is automatically frozen and advanced to implementation; v0.1 has no human Plan-approval state.
14. Role Runs use the in-process `spawn` provider. Models inherit the parent by default, deployment configuration may override by role, the resolved policy is recorded, and model-facing inputs cannot choose it.
15. Missing human information is a structured `needs_input` outcome that blocks the Mission; children never ask the user directly.
16. Operational Resume remains in the same Attempt and appends a replacement Role Run. Quality rework alone increments Attempt.
17. Cancellation waits for quiescence, records final repository state, preserves all files, marks `CANCELLED`, and only then releases the Write Lease.
18. Rework starts from the existing worktree, increments Attempt, transitions `REWORK_REQUIRED -> PLANNING`, and supplies prior Gate findings, Plan, and Evidence to a new incremental Plan.
19. Read-only Role Runs are enforced by both Harness tool policy and before/after repository inspection. Unexpected mutation produces `BLOCKED` without automatic rollback.
20. Mission control uses the five-tool surface; `mission_resume` preserves Attempt and appends a replacement Role Run.
21. Rework always re-enters PLANNING for the new Attempt.
22. Existing-Mission tools require an explicit Mission id and matching Repository Identity; every command and query also requires host-derived, action-scoped Mission Authority.
23. Canonical Evidence is schema-validated JSON; Markdown artifacts are human-readable projections and never Gate inputs.
24. Every Verification Profile explicitly marks each category as commands-required or reasoned `not-applicable`; omission blocks approval.
25. Tester interprets host-captured Evidence and cannot execute commands.
26. Developer may modify the complete canonical worktree but cannot write outside it.
27. Implementation Evidence covers the frozen Git/index/worktree baseline and all bounded tracked and untracked changes, not only `git diff`.
28. Cordis Service Capability and Kernel Mission Authority are separate; Mission Authority is host-derived and never a model-visible bearer token.
29. Accepted Missions run under a plugin-owned Mission Runner, not `ctx.jobs`; Role Runs still use `ctx.subagents`.
30. `mission_start` returns only after durable acceptance and lease acquisition, uses the Harness tool call id for idempotency, and then detaches execution from the initiating tool signal.
31. Host restart converts persisted active Missions to `BLOCKED(HOST_RESTARTED)`; only explicit Resume after lease and Workspace Fingerprint validation may continue them.
32. Mission state uses plugin-owned `node:sqlite`, while digest-bound Evidence files remain in per-Mission directories; v0.1 guarantees process-crash consistency and only best-effort sudden-power-loss durability.
33. Multiple readers are allowed, but repository mutation uses a fenced cross-process Write Lease with no automatic stale takeover.
34. Artifact Budgets are configurable, hard and fail-closed; v0.1 performs no silent decision-bearing truncation or automatic Evidence deletion.
35. Sensitive values are removed before persistence, no raw secret copy is retained, and secret or decision-obscuring redaction prevents approval.
36. Delivery is one standalone `dsh-engineering-control-plane` npm package with root Service plus `./tools`, `./client`, and `./invariant`; packed local installation, overlay and custom Agent preset are the first delivery path.
37. Web projection uses Mission revisions and snapshot resynchronization after gaps; UI state remains non-authoritative.
38. The first E2E vertical slice proves both a clean-repository path to `APPROVED` and a required-Evidence fail-closed path using Git, SQLite, Evidence, trace references and restart-readable facts.
39. v0.1 allows only one non-terminal Mission for each canonical worktree.
40. Branch and HEAD are frozen; Developer may edit and stage but cannot commit or perform branch/history/worktree operations, and the plugin never commits for the user.
41. `mission_start` is atomic create-and-start with explicit objective/context/criteria/constraints and no path, execution-policy or transcript-import inputs.
42. The five model tools use strict schemas; all existing-Mission mutations require expected revision while Status returns a bounded snapshot.
43. Initial, Resume and Rework context are immutable Input Records; Resume is legal only from Blocked and Rework only from Rework Required.
44. Stale mutations return structured revision conflict and are never automatically retried or overwritten.
45. Verification Profiles are host-owned, repository-mapped and frozen for the full Mission; no model or repository-local discovery selects them in v0.1.
46. Role outputs use strict versioned schemas with role-specific facts and no authoritative approval field.
47. The Gate distinguishes complete approval, definite engineering rework, and operational/integrity indeterminacy that blocks recovery.
48. A redacted Effective Policy snapshot and digest are frozen at Start; live configuration changes affect only new Missions.
49. SQLite migration is forward-only, transactional and backed up; corrupt or newer stores fail closed, and the v0.1 doctor is read-only.
50. v0.1 completion requires packed standalone installation plus build, typecheck, lint, unit, integration, Loader, lifecycle, recovery, safety, Gate and minimal Web projection verification without changing Harness source.
