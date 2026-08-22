---
status: accepted
---

# Quality Gate evaluates an Attempt Seal

After execution and all Assurance Assignments quiesce, the Kernel creates an immutable Attempt Seal binding the exact Mission Contract, Design Closure, Plan, Assurance Plan, Registry and Provider digests, Evidence Manifest, Workspace Fingerprint, and Action Ledger root. The Quality Gate evaluates only this seal rather than a moving Mission snapshot or Reviewer-curated bundle. A relevant change before the final commit invalidates the candidate seal and cannot inherit its decision.

The resulting Gate Evaluation Record is authoritative. The Kernel deterministically materializes `final-report.md` from that record and its referenced Evidence Views before atomically committing the report reference and final Mission transition. Materialization failure is operational indeterminacy and blocks instead of producing `APPROVED`; failures in later Session or Web projection do not rewrite the committed Gate result.
