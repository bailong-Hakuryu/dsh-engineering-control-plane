# DSH Engineering Control Plane

`dsh-engineering-control-plane` is an evidence-backed Mission governance plugin
for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Harness
provides replaceable subagent and subprocess capabilities; this package owns the
authoritative Mission lifecycle, policy snapshot, Evidence manifest and Quality
Gate.

The v0.1 package exposes four entry points:

- `dsh-engineering-control-plane` — the host-side Cordis Service and portable
  Control Plane Kernel contracts.
- `dsh-engineering-control-plane/tools` — five strict model tools.
- `dsh-engineering-control-plane/client` — a browser-safe, revision-aware
  projection store. It is a cache, never Mission authority.
- `dsh-engineering-control-plane/invariant` — startup readiness diagnostics.

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
- Cancellation first quiesces child execution, captures final Git/index/worktree
  state, then atomically indexes that Evidence and marks the Mission cancelled.

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
pnpm pack
```

## Install the packed bundle

The shipped bundle rows are deliberately disabled because repository authority
and verification policy cannot have safe universal defaults.

The normal Harness base bundle already loads the `subagents` registry, the
`@deepseek-ai/dsh-subagent-spawn-in-process` backend as provider `spawn`, and a
`subprocess` implementation. A custom host composition must load those three
capabilities before enabling this plugin; their absence is treated as an
operational failure and can never be converted into approval.

```sh
dsh plugin --profile engineering add ./dsh-engineering-control-plane-0.1.0.tgz
```

Add the following later-layer rows to the profile's `cordis.patch.yml`. Replace
the repository root and commands with deployment-owned values. A later row
replaces the complete earlier row, so keep `id`, `name` and the full `config`.

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

        rolePolicies:
          planner:
            allowTools: [read, glob, grep, lsp]
            denyTools: [write, edit, str_replace_editor, bash, pwsh, terminal_send, subagent]
          developer:
            allowTools: [read, write, edit, str_replace_editor, glob, grep, lsp]
            denyTools: [bash, pwsh, terminal_send, subagent]
          tester:
            allowTools: [read, glob, grep]
            denyTools: [write, edit, str_replace_editor, bash, pwsh, terminal_send, subagent]
          reviewer:
            allowTools: [read, glob, grep]
            denyTools: [write, edit, str_replace_editor, bash, pwsh, terminal_send, subagent]

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

## Read-only doctor

The package installs a diagnostic command that validates the SQLite identity and
schema, Mission lease invariants, Evidence references and Evidence digests. It
never creates, migrates, repairs, clears or deletes state.

```sh
dsh-control-plane doctor --pretty
dsh-control-plane doctor --dsh-home 'D:/custom/dsh-home' --pretty
```

Exit code `0` means every inspected invariant passed, `1` means the report found
an integrity or availability issue, and `2` means invocation failed.

## Model tool surface

- `mission_start` atomically accepts one Mission for the calling Agent's cwd.
- `mission_status` returns a bounded authoritative snapshot and current revision.
- `mission_resume` resumes only `BLOCKED`, in the same Attempt.
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
