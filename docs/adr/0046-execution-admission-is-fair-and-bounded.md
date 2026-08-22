---
status: accepted
---

# Execution Admission is fair and bounded

The plugin owns a fair FIFO scheduler across repositories rather than spawning unbounded Agents or adding user-visible priority semantics in v0.2. Defaults admit two advancing Mission Runners, four total Role Agents, three concurrent Assurance Agents per Mission, one Verification Command per worktree, and one Action Reviewer per Role Run. Product Ceilings cap these at host-validated values, while the single Developer and repository writer invariants remain independent hard constraints. Queue position is projected for observation but carries no Mission authority.
