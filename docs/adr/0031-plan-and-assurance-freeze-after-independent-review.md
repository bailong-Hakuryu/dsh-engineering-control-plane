---
status: accepted
---

# Plan and Assurance freeze after independent review

Planner produces a non-authoritative Plan Candidate, and an independent plan-conformance Reviewer evaluates it against Mission Contract, Design Ledger, Observed Facts, and proposed registered assurance obligations. Failed candidates may be regenerated only within a frozen Planning Budget, indeterminacy blocks, and newly exposed User Decisions return to analysis; once satisfied, Kernel atomically freezes Plan and Assurance Plan before implementation. This adds bounded pre-execution review without requiring the user to approve reversible implementation details again.
