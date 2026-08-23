---
status: accepted
---

# Provider cancellation retry reconciles terminal external state

External cancellation and Control Plane Invocation termination cannot share one
transaction. If a Provider commits its external cancellation but the host stops
before the Kernel records `terminated`, the durable Invocation therefore
remains `begun` and the Mission remains non-terminal. Startup does not infer or
repeat the cancellation. A later authorized `mission_cancel` calls the exact
frozen Provider's idempotent `cancel()` operation again. Proof that the same
external Assessment is already terminal is accepted as quiescence, recorded as
the monotonic Invocation outcome, and only then may final Evidence capture and
Mission cancellation complete. Missing or inconsistent reconciliation remains
in Cancellation Quarantine.
