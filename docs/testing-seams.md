# Confirmed testing seams

The Q39–Q50 design acceptance fixes five v0.1 testing seams. Tests exercise behavior only through these Interfaces and do not mock or assert private Kernel Implementation details.

1. **Control Plane Kernel** — `dispatch(command, authority)` and `snapshot(missionId, authority)` cover Mission lifecycle, revisions, immutable Attempts, Evidence ordering, recovery, and Gate decisions through in-memory and production Adapters.
2. **Model tools** — `mission_start`, `mission_status`, `mission_resume`, `mission_cancel`, and `mission_rework` cover strict schemas, authority derivation, Repository Identity, bounded outputs, idempotency, and revision conflicts.
3. **Loader composition** — the package root Service plus `./tools`, `./client`, `./invariant`, and `./assurance-provider` are loaded from real Cordis configuration in disposable headless and Web profiles, including teardown.
4. **Revisioned projection** — snapshot followed by contiguous revision events, stale-event rejection, and gap resynchronization cover the Web-facing observation contract without treating React state as Mission truth.
5. **Assurance Provider composition** — a real Cordis contributor registers a Reference Fake through the Service Capability, while Mission Start proves exact runtime binding, durable invocation identity, Kernel-issued non-serializable Context, registration-loss failure, restart non-replay, strict sealed Submission rejection, by-value Evidence import, and SQLite restoration without exposing the Registry or Store.

The current tracer bullet crosses the Kernel seam from atomic Start through fulfilled Submission import and Status. Later vertical slices add External Assessment Failure settlement, post-implementation Subject freezing, Requirement evaluation, definite Gate failure, indeterminate Evidence, Rework propagation, and full packed two-plugin integration behavior.
