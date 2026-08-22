---
status: accepted
---

# Plan Write Scope is gated and visible

An accepted Plan freezes a host-normalized Write Scope of repository-relative paths and action intents. Developer writes inside that scope still pass the Action Gate but may use the default allowed class; a worktree-local write outside it is reviewable rather than implicitly allowed. An Action Reviewer may authorize only one exact local, reversible deviation that leaves Mission Contract and Assurance obligations unchanged, producing a Plan Deviation Record without amending the Plan or Effective Policy.

A material deviation that changes design, risk, proof obligations, or external behavior is denied and surfaced as a new User Decision or blocking need rather than smuggled through action authorization. Final plan-conformance assurance evaluates every deviation independently, so execution permission never becomes proof that the implementation still conforms.
