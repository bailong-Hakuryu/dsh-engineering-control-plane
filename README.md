# DSH Engineering Control Plane

`dsh-engineering-control-plane` is an evidence-backed Mission governance plugin
for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Harness
provides replaceable subagent and subprocess capabilities; this package owns the
authoritative Mission lifecycle, policy snapshot, Evidence manifest and Quality
Gate.

The v0.1 package exposes five entry points:

- `dsh-engineering-control-plane` — the host-side Cordis Service and portable
  Control Plane Kernel contracts.
- `dsh-engineering-control-plane/tools` — five strict model tools.
- `dsh-engineering-control-plane/client` — a browser-safe, revision-aware
  projection store. It is a cache, never Mission authority.
- `dsh-engineering-control-plane/invariant` — startup readiness diagnostics.
- `dsh-engineering-control-plane/assurance-provider` — the strict,
  host-startup-only Provider contract; it exposes no model or browser
  registration authority.

Version `0.1.8` is prepared as the local v0.1 acceptance package. Tagging,
GitHub upload, and registry publication remain intentionally deferred until
the delivered artifacts pass deployment-owner verification.

## Safety model

- A canonical worktree can have only one non-terminal Mission.
- The host derives repository identity and freezes branch, HEAD and Effective
  Policy at Mission start.
- Planner, Tester and Reviewer are read-only. Developer can edit or stage files,
  but cannot commit, switch branches or rewrite history.
- Verification commands come only from a host-owned repository mapping.
- Only the deterministic Gate can produce `APPROVED`.
- Missing, corrupt, redacted, truncated or indeterminate decision Evidence fails
  closed.
- Cancellation first quiesces child execution and every begun external
Assurance Provider, captures final Git/index/worktree state, then atomically
indexes that Evidence and marks the Mission cancelled. Cancellation reserves
terminal Invocation settlement before aborting process-local Provider work, so
an abort-triggered assessment failure cannot replace the Provider's separate
quiescence proof.

Durable state is stored under `$DSH_HOME/control-plane`:

```text
control-plane.sqlite
missions/<mission-id>/attempt-####/records/<record-id>.json
```

## Build and verify

Node.js `^22.19.0` or `>=24.0.0` is required.

```sh
pnpm install
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack:dry-run
pnpm release:check
```

## Install the packed bundle

The shipped bundle is directly usable for a Node/pnpm repository. It supplies
the shared invariant registry omitted by the Harness `0.1.2-alpha.1` Web
profile and binds the Harness launcher's current working directory as the deployment-owned Repository,
enables the Mission tools and invariant, and freezes `pnpm test`, `pnpm run
typecheck`, and `pnpm run build` as Host verification commands. Start Harness
from the repository you intend to govern. Deployments using another build system
must replace the complete `engineering-control-plane` config row in their profile.

The normal Harness base bundle already loads the `subagents` registry, the
`@deepseek-ai/dsh-subagent-spawn-in-process` backend as provider `spawn`, and a
`subprocess` implementation. A custom host composition must load those three
capabilities before enabling this plugin; their absence is treated as an
operational failure and can never be converted into approval.

```sh
dsh plugin --profile web add ./dsh-engineering-control-plane-0.1.8.tgz
dsh --profile web --dump-config
dsh --profile web
```

No activation row or generated repository identifier is required. When Security
Assurance is also installed, the optional Provider resolves the stable
`current-workspace` Host binding at invocation time. A later row replaces the
complete earlier row, so custom deployments must keep `id`, `name`, and the full
`config`.

```yaml
- insert:
    - id: engineering-control-plane
      name: dsh-engineering-control-plane
      config:
        subagentProvider: spawn
        maxSubagentDepth: 1

        repositories:
          - root: 'D:/absolute/path/to/repository'
            verificationProfile: project-default
            assuranceProviders: []

        rolePolicies:
          planner:
            allowTools: [read, glob, grep]
            denyTools: []
          developer:
            allowTools: [read, write, edit, glob, grep]
            denyTools: []
          tester:
            allowTools: [read, glob, grep]
            denyTools: []
          reviewer:
            allowTools: [read, glob, grep]
            denyTools: []

        verificationProfiles:
          - name: project-default
            categories:
              functional:
                mode: commands
                commands:
                  - name: unit-tests
                    argv: [pnpm, test]
                    timeoutMs: 120000
                    environmentNames: []
              negative:
                mode: commands
                commands:
                  - name: typecheck
                    argv: [pnpm, run, typecheck]
                    timeoutMs: 120000
                    environmentNames: []
              regression:
                mode: commands
                commands:
                  - name: build
                    argv: [pnpm, run, build]
                    timeoutMs: 120000
                    environmentNames: []
              security:
                mode: not_applicable
                reason: 'No project security command is defined yet; deployment owner accepted this explicit exception.'

        artifactBudgets:
          maxRecordBytes: 16777216
          maxStdoutBytes: 4194304
          maxStderrBytes: 4194304
          maxUntrackedFiles: 256
          maxUntrackedBytes: 33554432

        database:
          journalMode: wal
          busyTimeoutMs: 5000
        gitCommand: git
        gitCommandTimeoutMs: 30000
        terminationGraceMs: 2000

    - id: engineering-control-plane-tools
      name: dsh-engineering-control-plane/tools

    - id: engineering-control-plane-invariant
      name: dsh-engineering-control-plane/invariant
```

Inspect the resulting composition before booting it:

```sh
dsh --profile engineering --dump-config
dsh --profile engineering
```

## Assurance Provider activation

Repository mappings may bind exact startup registrations with Host-owned
activation policy:

```yaml
assuranceProviders:
  - providerId: dsh/security-assurance
    providerVersion: 0.1.0-rc.8
    activation: required
    configuration:
      repositoryId: repo-00000000-0000-4000-8000-000000000000
```

`disabled` never selects a Provider. `when-available` selects only the exact
registered ID and version when present. `required` rejects Mission acceptance
when that exact registration is absent. Selected registration keys are copied
by value into Effective Policy and Attempt 1 history. The same atomic Start
prepares one durable invocation identity per selected Provider; no factory,
Provider object, credential, Registry handle, or Execution Context is persisted.
Optional `configuration` is limited to bounded public identifier strings. It is
detached and frozen into Effective Policy, Attempt selection, and the durable
Invocation before being exposed on `AssuranceRequestV1`; credential-shaped keys
and known credential value prefixes are rejected before Mission acceptance.

Mission Start freezes the obligation and durable invocation identity, but does
not assess the baseline checkout or block engineering execution. After the
Developer finishes, the Runner publishes implementation Evidence and freezes a
post-implementation, path-free Git Subject for that Attempt. Only then does the
host resolve the frozen exact ID and version, durably change the invocation from
`prepared` to `begun`, and call `assess()`. The Kernel-issued Context is frozen
and non-serializable. It exposes Mission, Attempt, Effective Policy digest, and
the frozen Subject identity, but no repository path, Store, Gate, Ledger,
process, or network capability. A lost or invalid registration becomes
`unavailable`; there is no version fallback or substitution. Host restart never
replays `assess()` for an invocation that already reached `begun`: startup
blocks the Mission without calling the Provider. A later explicit Mission
resume may call the exact Provider's optional `recover()` operation, which must
reconcile the same external assessment. A missing recovery operation fails
closed as an invalid Provider. Service disposal sends an independent abort
signal to live Provider work; the originating tool-call signal does not own
that work.

The Context also exposes one non-enumerable, process-local
`matchesCanonicalRepository()` assertion. An Adapter can compare a canonical
root resolved inside its own Host-owned Repository Registry without receiving
the Mission path. The root, matcher, and comparison result never enter Provider
configuration, SQLite, Evidence, Submission, model tools, or Remote. A Provider
whose configured Repository does not match the Mission Repository must fail
before starting its external assessment.

Concurrent replay admission joins one process-local promise before Provider
factory resolution, so every replay waits for the same durable result; the
`prepared → begun` compare-and-swap remains the cross-process authority for
calling `assess()`. If a registration disappears
during admission, the begun Invocation becomes `unavailable` without calling
the detached instance.

Explicit Mission cancellation is a separate operation from Service disposal.
After the Runner is stopped, every still-`begun` exact Provider must implement
`cancel()` and return a bounded proof that its external Assessment was canceled,
was already terminal, or never started. The Kernel records that proof as a
monotonic `terminated` Invocation before final repository capture and Mission
cancellation. Missing registration, missing cancellation support, malformed
proof, or timeout fails closed in Cancellation Quarantine; host unload never
calls `cancel()` and therefore cannot turn restart recovery into cancellation.
If external cancellation commits before the Kernel records `terminated`, the
Invocation remains `begun`. A later explicit `mission_cancel` resolves the same
exact Provider again; an already-terminal external Assessment is valid
quiescence proof, after which the Kernel can record `terminated` and complete
Mission cancellation. Startup itself never performs this semantic retry.

One fulfilled `sealed_submission` is detached and strictly checked for exact
schema, Invocation, Mission, Attempt, Provider, Subject, and Effective Policy
bindings. Every typed JSON artifact and the outer payload has a canonical
digest. The complete self-contained value is copied into the Control Plane's
Evidence Store before one Kernel revision atomically indexes that Evidence and
settles the Invocation. Malformed, unsealed, mismatched, redacted, or
digest-mismatched values are durably rejected without importing Evidence. The
public `sealAssuranceSubmissionV1()` constructor creates the provider-neutral
credential-free transport envelope; its Submission Digest is not the
Provider's Source Seal. A local Evidence publication failure is recorded as
operational `import_failed`, not misclassified as a Provider rejection.

A Provider that cannot supply a sealed Submission returns the strict public
`ExternalAssessmentFailureV1` value instead. The Control Plane detaches and
revalidates that value, durably settles the Invocation as `external_failed`,
and derives an `indeterminate` Assurance Assessment without importing any
Provider Evidence. `blocked`, `canceled`, and `failed` external reasons all
block the Gate: absence of sealed proof is never converted into Rework or
approval. The bounded Provider code remains audit detail and does not control
Gate policy.

When a `blocked` or `canceled` external result blocks the Gate,
`mission_status` advertises `mission_resume`. An exact-revision Resume is the
only Assurance Retry trigger:
the Kernel preserves the failed Invocation, Assessment, Result, and Gate
decision, then atomically prepares a successor Invocation against the same
Attempt and frozen Subject. The Runner invokes `assess()` only for that new
identity and evaluates a new current Result for the requirement. It never
replays or rewrites the failed Invocation, silently retries during startup, or
turns an operational external failure into a new Rework Attempt. Repeated Gate
rounds also publish immutable versioned Final Report views while keeping the
first `final-report.md` path stable.
An external `failed` reason remains indeterminate and blocks the Gate, but is
terminal for the frozen Provider composition: Status advertises cancellation,
not a same-Attempt retry that cannot repair invalid frozen configuration.

After transport import, the Runner re-reads the Control Plane Evidence copy and
applies the provider-neutral V1 eligibility profile. Composition, policy,
coverage, Source Seal, provenance, Evidence, and exact Subject bindings must use
the standard `dsh/assurance-provider-*` schemas. The Kernel then derives an
immutable Machine Provider Assurance Assessment and Assurance Result; it never
accepts a Provider's claimed outcome as a Gate decision. An eligible
`satisfied` result satisfies only that external requirement, an eligible
`failed` result requires Rework, and an `indeterminate`, unavailable, rejected,
unreadable, or incomplete Provider blocks the Gate. The remaining engineering
Evidence and Reviewer findings still decide whether the Mission can be
`APPROVED`.

Rework preserves the prior Attempt's Subject, Submission, Assessment, Result,
and Gate history. It copies the frozen Provider obligations into the new
Attempt, prepares fresh invocation identities, and requires a new
post-implementation Subject and assessment before the next Gate decision.
`mission_status` exposes bounded Assurance Result history and advertises
`mission_rework` after an eligible failed Assurance Result; a Gate-blocking
External Assessment Failure instead advertises `mission_resume` for the
same-Attempt Assurance Retry described above.

The closure is proven with Reference Fake Providers through the public Cordis
seam and with the optional real DSH Security Assurance
`control-plane-provider` Adapter. Installing this package alone still implies
no Security plugin runtime. Conformance covers a provider-neutral
`external_failure`, explicit same-Attempt retry through a new Invocation, and a
real Adapter retry that starts a distinct Security Assessment.

## Read-only doctor

The package installs a diagnostic command that validates the SQLite identity and
schema, Mission lease invariants, Evidence references and Evidence digests, and
the binding between a settled Invocation and its imported Submission payload.
It never creates, migrates, repairs, clears or deletes state.

```sh
dsh-control-plane doctor --pretty
dsh-control-plane doctor --dsh-home 'D:/custom/dsh-home' --pretty
```

Exit code `0` means every inspected invariant passed, `1` means the report found
an integrity or availability issue, and `2` means invocation failed.

## Model tool surface

- `mission_start` atomically accepts one Mission for the calling Agent's cwd.
- `mission_status` returns a bounded authoritative snapshot and current revision.
- `mission_resume` resumes only `BLOCKED`, in the same Attempt, and is the
  explicit trigger for a retryable External Assessment Failure.
- `mission_cancel` quiesces and terminally cancels an exact revision.
- `mission_rework` starts a new Attempt only from `REWORK_REQUIRED`.

Every mutation after start requires the exact revision returned by
`mission_status`. Stale control intent is rejected and never retried or merged.

## Web projection

The `./client` entry contains no Node-only imports. Install an authoritative full
snapshot first, then apply only contiguous whole-snapshot events. A stale event is
ignored; a revision gap returns `resync_required`. v0.1 deliberately leaves the
transport and UI surface to the host integration rather than creating a second
Mission store in the browser.
