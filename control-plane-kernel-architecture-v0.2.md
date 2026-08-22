# DSH Engineering Control Plane v0.2 Architecture

> Status: accepted design baseline; implementation has not started.
>
> Target package: `dsh-engineering-control-plane@0.2.0-rc.1`.
>
> Governance protocol: `control-plane/2` for new Missions, with an explicit
> `control-plane/1` adapter retained for migrated v0.1 Missions.
>
> Host boundary: this is an independent DeepSeek Harness plugin. It does not
> modify, patch, vendor, or privately import `deepseek-harness-master`.

## 1. Product position

The Control Plane Kernel is the product. Codex-like child-agent presentation is
an important execution and observation facility, but it does not replace the
Mission aggregate, Evidence authority, Action Gate, Assurance system, or Quality
Gate.

```text
User / root Agent / additive Web UI
                |
                v
  EngineeringControlPlane Service + six Mission tools
                |
                v
        Control Plane Kernel
  Mission revisions          Design Ledger
  Attempts and Plans         Assurance Plans
  Action Ledger              Evidence Manifest
  Leases and recovery        Quality Gate
                |
                v
       Host Adapter boundary
  AgentRegistry.create       ctx.subagents
  ToolRuntime pipeline       ApprovalService
  ctx.subprocess             Session Projection
  public client slots        read-only Remote
```

Only the Kernel commits Mission truth. Agents report, host adapters observe, and
UI surfaces project or request commands. Harness Session logs, child transcripts,
Provider runs, browser state, and model prose are never authority.

## 2. Non-negotiable invariants

1. Only a revision-checked Kernel transaction changes Mission state.
2. A Role Agent completing is not Mission approval.
3. Evidence is published and integrity-checked before a decision depends on it.
4. Required missing, stale, corrupt, truncated, or contradictory Evidence fails
   closed.
5. Attempt, Decision, RoleRun, Action, Assessment, and Gate history is immutable.
6. Action authorization is durable before dispatch; Action Outcome is durable
   after quiescence.
7. Child sessions and Provider references are best-effort traces, not domain ids.
8. One non-terminal Mission excludes another Mission from the same canonical
   worktree.
9. Git history, branch identity, and rollback remain user-owned.
10. Projection follows persistence and may fail without rewriting Mission truth.
11. Every Mission retains its Protocol Version and frozen Effective Policy.
12. Unknown capability, provider, schema, registry, storage, or integrity state
    blocks or denies instead of silently degrading.

## 3. Deep module boundary

The portable Kernel exposes a small command/query interface and imports no
Cordis, Harness, browser, React, Agent, Session, or model-provider types.

```ts
interface ControlPlaneKernel {
  dispatch(
    command: MissionCommand,
    authority: MissionAuthority,
  ): Promise<MissionReceipt>

  snapshot(
    missionId: MissionId,
    authority: MissionAuthority,
  ): Promise<MissionSnapshot>
}
```

The `EngineeringControlPlane` Cordis Service is the only integration facade.
Other plugins do not receive Store, Lease, Ledger-writer, Gate, or aggregate
internals. Startup Registry contributions are separate composition contracts and
are frozen before any Mission begins.

The implementation should preserve inward dependencies:

```text
client / tools / plugin facade
             |
             v
Harness adapters and protocol adapters
             |
             v
Control Plane Kernel and domain contracts
```

Exact source-file layout remains a Planner Choice, but ownership and dependency
direction are normative.

## 4. Public Mission surface

The model-facing surface has exactly six stable tools:

```text
mission_start
mission_status
mission_resume
mission_cancel
mission_rework
mission_decide
```

Inputs are strict and reject unknown fields. The model cannot choose repository,
Protocol Version, Provider, model deployment, verification commands, Action
policy, or authority tokens. Results use one versioned Tool Contract Envelope
containing contract version, protocol version, Mission id, Revision, status,
legal next actions, and a closed success or error result.

Start idempotency is host-derived from Repository Identity, root Session, source
Message id, Tool call id, and canonical input digest. A repeated accepted call
returns the original Receipt. A new call on an occupied repository returns the
authorized active Mission identity rather than creating a duplicate.

Public errors are stable, redacted, and machine-readable. Cross-repository or
unauthorized discovery returns `NOT_FOUND_OR_UNAUTHORIZED`; raw stack traces,
SQL, secrets, storage paths, and unredacted Action parameters are unavailable.

## 5. Mission authority and interaction

Harness exposes Agent, Session, Message, and call identity but no universal
multi-user principal. A Principal Resolver therefore derives an opaque Principal
from trusted host context. Standalone operation uses an installation-scoped
`local-owner`; multi-user hosts must provide a resolver. A Mission Access Policy
is frozen at Start and checked together with Repository Identity and action scope.

Mission Authority applies to every command and query. Decision Authority is
narrower: it binds the current authorized human-source Message, Principal, root
Session, turn and step, message digest, Repository Identity, Mission Revision,
Frontier Digest, and allowed question ids. A Session id, Mission id, child Agent,
plugin message, or model assertion is not authority.

The Web Decision Composer submits an ordinary canonical user-role message. The
root Agent then calls `mission_decide`; the browser has no Kernel mutation RPC.
The deterministic grammar supports explicit mappings such as `Q12=B` and a
single-round `全部接受` / `accept all` alias for every recommended answer in the
exact current Frontier. Ambiguous prose requires clarification. Decision
Authority is single-use and stale answers receive Revision Conflict.

Multiple authorized bound root Sessions may observe and command a Mission. The
first valid compare-and-swap wins; stale calls refresh and never replay against a
new Revision or Frontier. Child Sessions cannot decide or control the Mission.

## 6. Lifecycle and Attempts

The external status vocabulary remains compact:

```text
CREATED -> ANALYZING -> PLANNING -> IMPLEMENTING
        -> VERIFYING -> REVIEWING -> APPROVED
                                  -> REWORK_REQUIRED

active/recoverable phase -> BLOCKED
non-terminal phase       -> CANCELLED (only after quiescence)
```

Design waits are represented by structured Blocked reasons inside the
`ANALYZING` protocol rather than a second Proposal aggregate or a new top-level
status. Resume continues a recoverable Blocked Mission within the same Attempt
and creates replacement one-shot RoleRuns as needed. Quality Rework creates a
new Attempt at Planning. A design change after implementation begins creates a
new `design_change` Attempt and preserves partial work and prior Evidence.

Workspace Drift never becomes an implicit baseline. The plugin preserves files
and remains `BLOCKED(WORKSPACE_CHANGED)`; v0.2 recovery is cancel plus a new
Mission. The plugin never stashes, resets, commits, changes branch, or rewrites
history.

Cancellation is two-phase. The Kernel records intent, aborts execution, waits for
all dispatched work to settle, writes final Outcomes and Workspace Fingerprint,
then commits terminal `CANCELLED` and releases repository exclusion. Failure to
prove quiescence produces `BLOCKED(CANCELLATION_INDETERMINATE)` and retains a
Cancellation Quarantine.

## 7. Mission-owned design protocol

Every Mission owns a Design Ledger, even when its first Frontier is empty.
Questions and resolutions are immutable nodes in a dependency graph.

- User Decisions cover product, scope, acceptance, governance, and hard-to-reverse
  choices.
- Planner Choices are reversible implementation decisions recorded in the Plan.
- Observed Facts come from host observation; decision-bearing facts are canonical
  Evidence.
- Decision Subject Keys prevent duplicate or wording-disguised questions.
- Every Frontier Round contains all currently dependency-ready User Decisions.
- Partial answers commit, recompute the Frontier, and remain Blocked.
- Supersession appends a replacement and transitively invalidates dependants.
- Cycles, missing dependencies, duplicate subjects, or recommendation-free user
  questions reject the proposed Ledger change.

A one-shot Planner Assignment analyzes each Frontier Round from durable Mission
facts. Design Closure requires an empty Frontier, an independent
`design-completeness` Assessment, and—if the Ledger contained User Decisions—a
final user closure decision depending on all active resolutions. Budget
exhaustion blocks rather than accepting recommendations automatically.

Waiting for a human releases the Repository Write Lease and does not consume
Active Execution Budget. Continuation reacquires a new fencing epoch and checks
the Workspace Fingerprint before trusting prior Observed Facts.

## 8. Planning and Assurance

Planner emits a non-authoritative Plan Candidate. An independent
plan-conformance Reviewer evaluates it against Mission Contract, Design Ledger,
Observed Facts, and registered assurance obligations. Corrections are bounded by
Planning Budget. The Kernel atomically freezes the accepted Plan, normalized
Write Scope, and Attempt Assurance Plan before implementation.

The Assurance Plan is the complete proof-obligation model, not a list of child
agents. Every Attempt includes:

- implementation integrity;
- verification integrity;
- specification conformance;
- repository standards;
- design completeness;
- plan conformance;
- Action Ledger integrity.

Policy and risk may activate registered security, migration, compatibility,
performance, or other requirements. Requirement definitions are namespaced,
versioned startup Registry entries with Evidence Contracts, evaluator identity,
independence rules, and budgets. Unknown or unavailable definitions block.

Each required Assessment is `satisfied`, `failed`, or `indeterminate`. Conservative
aggregation means any failed Assessment fails the Requirement; otherwise any
indeterminate Assessment makes it indeterminate; only all required satisfied
Assessments satisfy it. Distinct Independence Groups use separate Agent instances
and host-derived Assessor Identities. Developer cannot review its own work.

Parallel read-only Assurance Assignments all settle unless the Mission is
explicitly cancelled. Operational failures block after siblings finish; explicit
Resume may append bounded replacement RoleRuns. Evidence can cross Attempts only
when its Evidence Contract declares reuse safe and every dependency digest remains
exact, producing an Evidence Derivation record.

## 9. Governed Role Agents

The plugin registers a `governed-spawn` Subagent Provider through public
`ctx.subagents` composition. It constructs each child with public
`AgentRegistry.create({ setup })`, installing Role Binding, static restrictions,
Action Gate mediation, role instructions, structured-result capture, and cleanup
inside the pre-publication transaction. No first prompt or action can race ahead
of governance.

Effective Policy freezes provider name, Protocol Version, and implementation
digest. Every RoleRun checks the exact Governed Provider Identity. Unload cancels
and quiesces owned children; missing or changed identity blocks and never falls
back to an ungated provider.

Stable authority roles remain Planner, Developer, Tester, and Reviewer. Dynamic
Role Assignments carry purpose, inputs, Execution Capabilities, and Assurance
Requirements. Design analysis, plan conformance, Action Review, specification,
standards, security, and other checks are Assignments, not new authority roles.

Each Role receives a Kernel-built Prompt Package. Host and role instructions are
separate from Mission Contract, Plan, canonical Evidence, and labelled untrusted
repository data. Parent chat and child transcripts are not inherited. A Context
Manifest records every included, summarized, retrievable, omitted, or truncated
item; missing required context prevents a valid Assessment.

Role results pass a versioned strict Output Contract before publication. Unknown
fields, invalid identity, or missing Evidence references reject the result, and no
contract includes authoritative `approved`, `blocking`, or policy-override fields.
RoleRun Provenance records provider/model, Prompt and context digests, parameters,
usage, stop reason, output digest, and trace without claiming deterministic model
replay.

Effective Policy freezes an ordered compatible Model Deployment Set. One RoleRun
selects one deployment and never switches in flight. Recovery may create a new
RoleRun using another pre-authorized deployment. Skills are privileged instructions
and must be host-allowlisted by identity, version, and digest; their proposed
actions still pass the Action Gate.

## 10. Complete Action mediation

Every repository read, workspace write, process, Git, network, nested tool,
credential, subagent, and external mutation request is normalized by a frozen
Action Capability Registry before dispatch.

```text
raw host/tool request
  -> registered canonical normalizer
  -> product ceiling and Effective Policy
  -> allow / deny / reviewable
  -> optional tool-less Action Reviewer
  -> optional Harness ApprovalService in the open Role turn
  -> durable Kernel Action Decision
  -> dispatch
  -> ToolRuntime quiescence
  -> durable Action Outcome
```

Unknown or partially normalized actions are denied. An Action Reviewer may decide
one reviewable request or ask for one exact user authorization, but cannot widen
Effective Policy, authorize an always-denied capability, or affect Quality Gate.
Harness `allowed-once`, `rejected`, `cancelled`, and `unavailable` are adapted into
the Mission protocol; no seventh model tool is added.

An unfinished authorization belongs to one exact RoleRun and open turn. Restart,
unload, or termination before a durable Action Decision records
`ABANDONED_BEFORE_DISPATCH`; old prompts and grants never survive. Once an allow
decision is durable, a missing Outcome is possible post-dispatch indeterminacy and
blocks recovery until workspace reconciliation.

Developer writes inside frozen Write Scope may be default-allowed under the
product ceiling. A local reversible out-of-scope write is individually reviewable
and creates a Plan Deviation Record; material Contract, design, risk, or Assurance
change cannot be smuggled through Action Review. Final plan-conformance evaluates
all deviations.

Code Mode's outer `run_code` is a Transport Action. Every nested dispatch remains
independently gated and is correlated by root call and parent token. Transport and
leaf budgets avoid double counting. Nested Role Agent spawn, secret reads, writes
outside the canonical repository, Git history/branch/worktree mutation, and
external mutation remain product-denied.

Network authorization is exact per scheme, host, port, method, purpose, body
digest, resolution, and redirect hop. Private, loopback, link-local, and metadata
destinations are denied unless a specialized product Action Kind exists. Process
execution uses registered structured executable/argv/cwd/environment-name Actions,
not shell strings. Filesystem authorization revalidates handle-derived target and
parent identities at decision, dispatch, and Outcome to prevent symlink, junction,
hard-link, reparse-point, and TOCTOU escape.

## 11. Evidence and Quality Gate

Canonical Evidence is strict, digest-bound JSON. Markdown, reports, cards, and
browser pages are Evidence Views and cannot become Gate inputs. Normative documents
enter through host-resolved Specification References. The original artifact digest
is retained and model-readable Extraction Evidence records extractor identity,
version, source mapping, warnings, and truncation.

Content is deterministically sanitized before persistence or rendering: configured
secret names and patterns, known credential forms, bounded high-entropy candidates,
invalid encodings, terminal controls, hyperlinks, and active content are removed or
neutralized. No hidden raw secret copy is retained. Decision-obscuring Redaction
makes the dependent Assurance Result indeterminate.

After all execution and Assurance work quiesces, the Kernel creates an immutable
Attempt Seal binding Mission Contract, Design Closure, Plan, Assurance Plan,
Registry and Provider digests, Evidence Manifest, Workspace Fingerprint, and Action
Ledger root. Quality Gate evaluates only that seal:

```text
any definite failed required Result       -> REWORK_REQUIRED
otherwise any indeterminate required Result -> BLOCKED
all required Results satisfied            -> APPROVED
```

The authoritative Gate Evaluation Record contains every Result and reason. The
Kernel deterministically materializes `final-report.md` before atomically committing
its reference and the final transition. Materialization failure blocks; later UI
projection failure does not rewrite a committed decision.

## 12. Persistence, integrity, and recovery

The plugin owns SQLite under `$DSH_HOME/control-plane` and Evidence files under
per-Mission directories outside the governed repository. v2 uses an immutable
Revision Journal plus normalized append-only domain records. A small current-head
index and query indexes are rebuildable. One transaction writes the new Revision,
domain rows, head, idempotency facts, and Projection Outbox item.

Every Revision, Ledger, and Attempt Seal participates in canonical SHA-256 chaining.
Default `digest-chain` detects corruption but does not claim protection from an
attacker controlling the host filesystem. Optional `hmac-sha256` uses a host key
reference; loss of a frozen key blocks and never downgrades.

A Mission Execution Lease fences the plugin process permitted to advance one
Runner. A separate Repository Write Lease excludes competing Missions and writers.
Process loss never implies automatic execution takeover: startup blocks active
Missions as `HOST_RESTARTED`, and authorized Resume acquires new epochs only after
identity and fingerprint checks.

Startup composition, Registry, migration, format, or integrity failure enters
read-only Safe Mode. Doctor and safe diagnostics remain; status/detail remain only
when storage can be interpreted read-only. Mutation, execution, and authorization
reject with `CONTROL_PLANE_UNAVAILABLE`. The plugin never auto-repairs, deletes,
or silently runs v1 behavior as fallback.

Schema migration backs up first and commits transactionally. Existing Missions are
marked `control-plane/1` and continue through the retained v1 Protocol Adapter;
they receive no invented Design, Action, or Assurance history. New Missions use
`control-plane/2`. Missing v1 runtime blocks as `LEGACY_RUNTIME_UNAVAILABLE`.

## 13. Additive Web surface

The package supplies a real `dsh.client` entry using public additive seams:

- `conversation.view` for the Mission tab;
- `conversation.chat.node` for milestone and RoleRun cards;
- `conversation.composer` for canonical Decision Messages;
- existing Session/subagent navigation for child traces.

It does not replace conversation, details, or subagent UI. Each bound root Session
receives a bounded allowlisted whole-summary Mission Projection after Kernel commit;
a Projection Outbox supports retry. Immutable Evidence, Finding, and Action Ledger
details are fetched through a plugin-owned paginated read-only Remote that validates
Principal, Session Binding, and Repository Identity. The Remote exposes no mutation.

All Evidence and model text is untrusted UI input. The client permits a sanitized
Markdown subset, disables raw HTML, scripts, frames, remote images, dangerous URIs,
and content-created actions, and revalidates repository-relative paths before
read-only navigation. Trace loss degrades navigation only.

## 14. Configuration and budgets

Host global defaults resolve through a named Policy Profile selected by canonical
Repository Mapping. Repository content may contribute Standards or Evidence but
cannot widen execution. The redacted result and Registry digests freeze into
Effective Policy. Live changes affect only new Missions.

Product defaults and immutable ceilings are:

| Limit | Default | Ceiling |
| --- | ---: | ---: |
| User Decisions / Mission | 128 | 512 |
| Frontier Rounds / Mission | 24 | 64 |
| Design dependency depth | 12 | 32 |
| Plan Candidates / Attempt | 3 | 8 |
| Reviewable Actions / RoleRun | 32 | 128 |
| Equivalent Action variants | 3 | 5 |
| User Authorization prompts / RoleRun | 8 | 16 |
| Assurance Assignments / Attempt | 12 | 32 |
| Replacement runs / Assignment | 1 | 3 |
| Concurrent Assurance runs / Mission | 3 | 8 |

Default scheduling admits two advancing Mission Runners, four total Role Agents,
three Assurance Agents per Mission, one Verification Command per worktree, and one
Action Reviewer per RoleRun using fair FIFO without v0.2 priorities.

Active Agent, tool, Verification, and review runtime and model invocation counts
consume frozen budgets. Human Wait consumes no active budget and holds no Write
Lease. Each RoleRun has its own timeout; canonical provider usage may additionally
enforce token ceilings. Waiting never auto-answers, approves, cancels, or deletes.

## 15. Compatibility and delivery

Initial support is exact for DeepSeek Harness `0.1.1-rc.2` packages and Node
`^22.19.0 || >=24.0.0`, supplemented by public Capability Probes. The release matrix
covers Windows, Linux, and macOS, including platform-specific stable-file-identity
tests. Missing required public behavior or containment enters Safe Mode.

Implementation proceeds in Kernel-first red-green-refactor slices using deterministic
Scripted Providers. Property/model-based state tests, systematic crash injection,
real multi-process SQLite/lease tests, migration fixtures, Web security/resync tests,
and packed standalone installation are blocking. Live-model canaries are optional
and never the correctness oracle.

`npm pack` must install into a clean project and load root Service, `./tools`,
`./client`, and bundle patch using only declared peer dependencies and public
exports. Builds and tests reject workspace links, absolute local paths, private
Harness source imports, or writes to the Harness checkout.

The first artifact is `0.2.0-rc.1`. Promotion of the same code to `0.2.0` requires
all static, unit, property, fault, process, migration, E2E, Web, packed-install,
security, and documentation gates; zero confirmed Critical/High security findings;
explicit treatment of Medium risk; and a manually observed Dogfood Mission against
the plugin repository. Promotion changes version metadata only.

## 16. Explicit non-goals

- No change to `D:\Deepseek\deepseek-harness-master`.
- No Harness Core fork, monkey patch, private source import, or copied runtime.
- No replacement of Harness conversation or subagent UI.
- No use of `ctx.jobs` as Mission authority or persistence.
- No browser mutation endpoint for Mission decisions.
- No automatic policy widening, model/provider fallback, workspace adoption,
  stale-lease takeover, retry loop, rollback, commit, or Evidence deletion.
- No claim that local digest chaining defeats a host-machine owner.
- No claim that model output is deterministic or self-authoritative.

## 17. Decision sources

The normative vocabulary is [CONTEXT.md](CONTEXT.md). Individual trade-offs and
consequences are recorded in accepted ADRs [0001 through 0072](docs/adr). The
original [v0.1 architecture](control-plane-kernel-architecture.md) remains the
baseline for the `control-plane/1` Protocol Adapter and must not override this v0.2
document for new Missions.
