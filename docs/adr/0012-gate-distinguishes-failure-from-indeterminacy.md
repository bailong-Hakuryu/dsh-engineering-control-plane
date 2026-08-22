---
status: accepted
---

# Quality Gate distinguishes failure from indeterminacy

The Quality Gate produces `APPROVED` only from complete passing Evidence, `REWORK_REQUIRED` from definite engineering failure, and `BLOCKED` when operational or integrity problems prevent a trustworthy judgment. Non-zero verification results, blocking review findings, and secrets in the implementation are engineering failures; missing, corrupt, timed-out, truncated, decision-obscuring redacted, or policy-violating Evidence is indeterminate. This preserves the rule that Rework judges engineering quality while Blocked remains recoverable infrastructure or governance state.
