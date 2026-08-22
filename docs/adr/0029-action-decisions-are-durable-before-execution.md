---
status: accepted
---

# Action Decisions are durable before execution

The Kernel persists each decision-bearing action to an append-only Action Ledger before the Adapter executes it; a persistence failure prevents execution. Entries bind Mission, Attempt, Role Run, Fencing Token, Action Fingerprint, and sequence in an integrity chain, while Role Run settlement anchors the final range and digest into Mission truth. Low-risk allowed reads may be summarized, avoiding per-read Mission Revision churn without demoting Harness Session logs into authority.

Execution is completed by a second immutable Action Outcome written only after ToolRuntime reaches quiescence. Outcomes distinguish success, failure, no dispatch, abort before dispatch, abort after dispatch, and indeterminacy while retaining only bounded redacted summaries and digests. A crash after dispatch but before Outcome persistence is operationally indeterminate: the Role Run cannot settle, the Mission blocks, and recovery must reconcile the workspace rather than infer success from a transcript.
