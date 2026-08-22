---
status: accepted
---

# Cancellation is a two-phase quiescence protocol

The Kernel first persists a cancellation request, then the Runner aborts active work and waits for every dispatched action and Role Run to settle, writes their final Outcomes, and captures the final Workspace Fingerprint. Only then may one atomic transition commit terminal `CANCELLED` and release repository exclusion. Exceeding the termination grace period produces `BLOCKED(CANCELLATION_INDETERMINATE)` and a Cancellation Quarantine rather than claiming success, releasing the lease, or reverting files. A later authorized `mission_cancel` may complete the protocol after the host proves no execution remains active.
