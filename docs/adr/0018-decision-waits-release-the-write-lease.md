---
status: accepted
---

# Decision waits release the Write Lease

Mission Start retains v0.1 atomic lease acquisition, but entering `BLOCKED` for unresolved User Decisions atomically releases the Write Lease. After the Design Frontier closes, continuation must reacquire a new fenced lease and validate the Workspace Fingerprint; changes invalidate stale Observed Facts and keep the Mission Blocked rather than allowing a long human decision interval to monopolize or silently stale the workspace.
