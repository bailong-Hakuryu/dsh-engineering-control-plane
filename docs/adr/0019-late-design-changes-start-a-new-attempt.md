---
status: accepted
---

# Late design changes start a new Attempt

Before implementation, a Decision Supersession recomputes the Design Frontier and invalidates dependent design conclusions in place. Once an Attempt reaches `IMPLEMENTING`, any new or superseded User Decision blocks the Mission; resolving it with `mission_decide` starts a new `design_change` Attempt in `PLANNING`, preserving the prior Plan, partial workspace changes, Evidence, and Role Runs instead of mutating a frozen execution history or misclassifying the change as quality rework.
