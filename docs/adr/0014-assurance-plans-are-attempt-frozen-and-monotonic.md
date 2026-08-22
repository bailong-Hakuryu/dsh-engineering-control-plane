---
status: accepted
---

# Assurance Plans are Attempt-frozen and monotonic

Host-owned Assurance Policy supplies the minimum proof obligations for a Mission, while repository facts and resolved design decisions produce an immutable Assurance Plan before each Attempt enters implementation. A Rework Attempt may add requirements revealed by new risks or prior Gate findings but cannot remove inherited requirements, preserving stable governance without pretending that assurance needs are always knowable at Mission Start.

The Assurance Plan is the complete Gate obligation model rather than a list of child reviews. Every Mission includes implementation integrity, verification integrity, specification conformance, and repository standards; policy or design facts may add security, migration, compatibility, performance, or other requirements. Requirements may be fulfilled by host-observed facts or independent Role Runs, but all reach the Quality Gate through canonical Evidence.

Each Assurance Requirement produces exactly one Evidence-backed result: satisfied, failed, or indeterminate. Failed is definite engineering evidence and contributes to Rework Required; indeterminate means trustworthy judgment is impossible and contributes to Blocked. Advisory findings remain outside the Assurance Plan so a supposedly required obligation can never be silently non-blocking.

When a Requirement needs multiple assessors, the Kernel aggregates conservatively rather than voting: any failed Assessment makes the Result failed; otherwise any indeterminate Assessment makes it indeterminate; only all required satisfied Assessments produce satisfied. Reviewers emit structured findings, while the frozen Registry maps category, severity, and confidence to blocking significance; no Reviewer supplies an authoritative `blocking` or `approved` field.

Independent read-only Assurance Assignments run concurrently within frozen concurrency, time, and model budgets, and all are allowed to settle before aggregation even when one has already failed or become indeterminate. Their diagnostic Evidence remains useful for the next Attempt; only explicit Mission cancellation stops sibling reviews early.

Kernel freezes the accepted Plan and the Attempt Assurance Plan atomically in the revision that enters implementation, after validating inherited and host-minimum requirements plus registered requirements activated by design or Plan risk. The final Quality Gate also requires valid design-completeness, plan-conformance, and Action Ledger integrity Results; a later Decision Supersession, workspace change, or ledger corruption makes stale pre-implementation assurance indeterminate rather than grandfathered.
