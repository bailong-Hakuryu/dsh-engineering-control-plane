---
status: accepted
---

# Workspace Drift is not auto-adopted

When the live repository no longer matches the Workspace Fingerprint required at a recovery or Gate boundary, the Mission remains `BLOCKED(WORKSPACE_CHANGED)`. The plugin preserves the scene, never reverts files, and never guesses whether the change belongs to the user, another process, or the Mission. v0.2 does not overload Resume with baseline adoption or add an implicit reconciliation transition: recovery requires cancelling the old Mission and explicitly starting a new one against the current workspace. This keeps Resume within the same Attempt and preserves the six-tool protocol.
