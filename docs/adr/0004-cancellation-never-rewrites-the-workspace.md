---
status: accepted
---

# Cancellation never rewrites the workspace

Cancelling a Mission signals active work, waits for Role Runs to become quiescent, records the final repository state, and releases the Write Lease, but never resets, stashes, deletes, or otherwise rewrites workspace files. Partial implementation remains visible for human disposition because an automatic rollback could destroy concurrent or unattributed work and would make cancellation a destructive operation.
