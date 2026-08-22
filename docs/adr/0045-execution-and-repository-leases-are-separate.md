---
status: accepted
---

# Execution and repository leases are separate

One fenced Mission Execution Lease identifies the plugin instance permitted to advance a Mission Runner, while the separately fenced Repository Write Lease excludes competing Missions and writers for the canonical worktree. Read-only status and detail queries require neither execution ownership nor write ownership. Human decision waits release the Write Lease; process loss does not authorize another Runner to infer takeover. Startup blocks active Missions as `HOST_RESTARTED`, and only explicit Resume may acquire new epochs after Repository Identity and Workspace Fingerprint validation.
