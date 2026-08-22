---
status: accepted
---

# Git history remains user-owned

The Control Plane freezes branch and HEAD at Mission start and permits the Developer to change worktree and index content, but never to commit, switch branches, merge, rebase, reset, stash, or create worktrees. A changed branch or HEAD blocks the Mission and preserves the scene. This keeps reviewable implementation changes available without allowing an autonomous Role Run to rewrite history or make an attribution-bearing commit on the user's behalf.
