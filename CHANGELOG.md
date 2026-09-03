# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

- Declare compatibility with DeepSeek Harness `0.1.2-alpha.2` through
  `0.1.2-rc.1` alongside the primary `0.1.2-alpha.1` target as an exact,
  explicit set in the peer dependency ranges; the set is verified daily by
  the Security Assurance-owned Harness Compatibility dual-plugin matrix
  (ADR 0092).
- Annotate the exported configuration schema constants with their schemastery
  type so declaration emit stays portable against the cosmokit `Dict`
  reference surfaced by Harness `0.1.2-alpha.2` and later.
- Keep the command-routing test fixture's session header compatible across
  the supported Harness window; `0.1.2-alpha.4` added a required `isSeeded`
  header flag.
- Publish versioned, path-free Git workspace and byte-exact produced-change
  fingerprint algorithms, and bind both into Assurance Execution Subjects so
  Providers can independently verify the exact Mission output they assess.
- Add public Linux, macOS, and Windows CI against the qualified Harness
  `0.1.2-alpha.1` source layout, including a fresh packed-profile installation
  and live Web probe.
- Bind the direct-use Security Assurance provider to `0.1.0-rc.10`.

## [0.1.9] - 2026-08-31

- Route top-level natural-language implementation requests through the
  `mission_start` tool while preserving an explicit direct-mode opt-out.
- Add the `/mission <objective>` Web/CLI command, which submits a normalized
  Mission request without exposing the command to delegated Mission roles.
- Bind the direct-use Security Assurance provider to `0.1.0-rc.9`.

## [0.1.8] - 2026-08-31

- Execute resolved Windows `.cmd` and `.bat` package-manager shims through a
  metacharacter-restricted `cmd.exe` compatibility path, allowing the shipped
  `pnpm` verification profile to collect real exit codes on Windows.
- Normalize an empty optional Role Output `question` to omission when the role
  has completed, matching the Harness schema while retaining strict non-empty
  questions for `needs_input` outcomes.
- Add live Windows shim and captured reviewer-output regression coverage.

## [0.1.7] - 2026-08-30

- Keep `mission_resume` legal for REVIEWING input blocks when the block reason
  is `needs_input`, so operators can provide the requested information.
- Bind the direct-use Security Assurance provider to `0.1.0-rc.8`.

## [0.1.6] - 2026-08-30

- Redact and count sensitive assignments even when their values are shorter
  than eight characters before Implementation Evidence is persisted.
- Bind the direct-use Security Assurance provider to `0.1.0-rc.7`.

## [0.1.5] - 2026-08-30

- Durably settle synchronous and asynchronous Assurance Provider execution
  failures as redacted `external_failed` outcomes instead of leaving `begun`
  invocations behind.
- Reject SQLite stores whose indexed Repository root or Mission status
  disagrees with the authoritative snapshot JSON.
- Bind the direct-use Security Assurance provider to `0.1.0-rc.6`.

## [0.1.4] - 2026-08-30

- Bind Assurance evidence validation to the frozen subject of the matching
  attempt, avoiding false positives after repository edits.
- Keep `mission_resume` legal for REVIEWING input blocks unless the Assurance
  Quality Gate itself is blocked.
- Bind the direct-use Security Assurance provider to `0.1.0-rc.5`.

## [0.1.3] - 2026-08-30

- Remove legacy `lsp` and `str_replace_editor` names from the direct-use role
  policies so Harness `0.1.2-alpha.1` can construct Planner and Developer tool
  restrictions.
- Bind the optional Security Assurance policy to `0.1.0-rc.4`.

## [0.1.2] - 2026-08-30

- Bind the direct-use optional Security Assurance policy to
  `dsh/security-assurance@0.1.0-rc.3`, whose startup now fences repository
  registration before invariant admission.

## [0.1.1] - 2026-08-30

- Enable a Node/pnpm direct-use Harness bundle rooted at the launcher cwd.
- Mount the shared invariant registry required by both plugin companions in a
  fresh Harness `0.1.2-alpha.1` Web profile.
- Make Host verification ownership explicit in Planner and Developer contracts.
- Restore `mission_resume` as a legal action for pre-assurance role input blocks.
- Bind optional Security Assurance through a stable Host repository binding ID.
- Qualify the package against DeepSeek Harness `0.1.2-alpha.1`.

## [0.1.0] - 2026-08-29

### Added

- Durable Mission governance with revisioned contracts, design closure,
  fenced execution and repository leases, evidence-backed Quality Gates,
  retry, cancellation, restart recovery, and SQLite migration support.
- Strict model tools, browser-safe projection client, startup invariant, CLI,
  repository adapters, and deterministic scripted-provider release tests.
- Host-startup-only Assurance Provider composition, invocation settlement,
  submission validation, repository binding, and optional Security Assurance
  integration.
- Publishable package metadata, deterministic prepack build, and v0.1 release
  verification command.
