# ADR 0042 Compliance Report

## Decision

ADR 0042 requires startup validation failures to preserve the Engineering Control Plane plugin in read-only Safe Mode. Mission mutation and execution must fail closed with `CONTROL_PLANE_UNAVAILABLE`; the read-only doctor must remain usable; source files and database bytes must not be repaired or modified automatically.

## Requirement mapping

| Requirement | Public implementation seam | Verification |
| --- | --- | --- |
| Plugin remains mounted | Startup resolves to an internal `READY | READ_ONLY_SAFE` state rather than exposing the initialization rejection | Public Cordis activation succeeds against a foreign current-version Mission database |
| Stable fail-closed operations | `whenReady`, `start`, `status`, `resume`, `cancel`, and `rework` resolve runtime through the same Safe Mode gate | Every public Mission operation rejects with `ControlPlaneUnavailableError.code === CONTROL_PLANE_UNAVAILABLE` |
| No Mission execution | Safe Mode contains no Kernel, Runner, Assurance Invocation Coordinator, or writable Store | No Mission operation reaches Git derivation, Kernel dispatch, Role Run, or recovery |
| Doctor remains available | `inspectControlPlane` uses the immutable read-only SQLite inspection path independently of the Service runtime | Doctor returns a bounded `corrupt_database` issue while the Service is in Safe Mode |
| No automatic repair or mutation | Existing databases are preflighted through an immutable read-only connection before journal mode, migration, or writable validation | Test compares the complete database bytes and directory entry set before and after activation and doctor inspection |
| Safe teardown | Cordis cleanup handles both `READY` and `READ_ONLY_SAFE` startup results | Safe Mode fiber disposal completes without constructing or closing absent runtime owners |

## Genuine implementation gaps fixed

### Raw startup failures escaped the public Service

The Service object remained registered, but `whenReady` and every operation exposed the original `MissionStoreFormatError`, including internal format detail and a non-contract error code. Startup now settles into an explicit `READ_ONLY_SAFE` state, and public work is rejected with one redacted `CONTROL_PLANE_UNAVAILABLE` error.

### Validation modified an untrusted database before rejecting it

The writable SQLite path applied `journal_mode` before proving database identity and schema. A foreign database therefore entered Safe Mode only after its file header had changed. Existing stores are now preflighted with an immutable read-only connection for quick-check, version, application identity, exact schema, snapshot JSON identity, and legacy migration eligibility before any writable connection is allowed.

## Verification

- ADR 0042 dedicated Safe Mode suite: 1 end-to-end test covering activation, six public rejection paths, doctor access, byte identity, and directory identity.
- SQLite Store, Loader lifecycle, and doctor suites: 10 passing tests.
- Engineering Control Plane full suite: 28 files, 131 passing tests.
- Typecheck, lint, and build: passing.
- Diff whitespace validation: passing.

## Assessment

ADR 0042 is now implemented for startup failures that prevent construction of a trustworthy runtime. The plugin stays mounted for diagnostics, admits no Mission work, exposes one stable redacted failure, and does not mutate an untrusted current or future Store before rejecting it.
