---
status: accepted
---

# Design Ledger is mission-owned and universal

Every accepted Mission carries a durable Design Ledger, including when its computed Design Frontier is initially empty. Unresolved product and governance choices remain User Decisions, reversible implementation details may be Planner Choices, and repository or environment truths are Observed Facts; only an empty Design Frontier permits the design protocol to finish.

This keeps design provenance inside Mission history and avoids both an unaudited pre-Mission chat and a second Proposal aggregate with competing identity and recovery rules. Simple Missions pay only the cost of an empty Frontier, while complex Missions may block for explicit user decisions.

The Design Ledger is governed inside `ANALYZING`, not by new `DESIGNING` or `AWAITING_DECISION` statuses. An unresolved User Decision produces a structured Blocked condition that resumes into `ANALYZING`; questions and Decision Resolutions are immutable revision-bound records, so resolving a decision never rewrites what was originally asked or recommended. Each Frontier Round presents every dependency-ready decision rather than allowing a Planner to hide or serialise eligible questions.

A changed answer is appended as a Decision Supersession and transitively invalidates dependent resolutions instead of editing history. Effective Policy freezes Design Budgets for question count, rounds, dependency depth, time, and model usage; exhaustion blocks the Mission, and neither Planner nor Kernel silently accepts recommended answers. Cycles, missing dependencies, duplicate questions, and recommendation-free User Decisions are invalid Ledger updates.
