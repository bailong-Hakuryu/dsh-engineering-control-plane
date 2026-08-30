# Changelog

All notable changes to this project are documented in this file.

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
