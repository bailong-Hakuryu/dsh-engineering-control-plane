---
status: accepted
---

# Invariants are proven with property, fault, and process tests

Property and model-based tests generate command sequences, stale Revisions, budget boundaries, ledger histories, and cancellation interleavings to prove that no invalid sequence reaches `APPROVED`, no history is rewritten, and no pre-dispatch durability rule is bypassed. A deterministic Fault Injection Matrix covers filesystem publication, SQLite transactions, Projection Outbox, Approval, action dispatch and Outcome, RoleRun settlement, leases, cancellation, and Gate materialization.

Lease and concurrency tests use independent Node processes sharing a real SQLite database rather than Promise-only simulation. Synchronization barriers and controllable clocks prove fencing, busy handling, crash recovery, and the absence of automatic stale takeover on Windows and POSIX without sleep-based timing guesses.
