---
status: accepted
---

# Mission runtime is not a Harness Job

An accepted Mission continues under a plugin-owned Mission Runner rather than being registered as authoritative `ctx.jobs` work. Harness Jobs are process-local and either inherit an Agent owner's disposal and session-scoped access or become shared unowned work; neither lifecycle matches a durable, repository-authorized Mission. The Control Plane therefore owns cancellation and recovery while `ctx.subagents` remains the execution Adapter for individual Role Runs, accepting the cost of a dedicated Mission projection instead of reusing generic Job controls.
