---
status: accepted
---

# Startup failures enter read-only Safe Mode

Failure to validate plugin composition, Registry definitions, storage identity, integrity, or a forward migration prevents all Mission mutation and execution but keeps the plugin available in read-only Safe Mode. Doctor and diagnostic UI remain available; status and detail views remain available only when the store can be opened and interpreted safely. Mutating tools, Mission Runner admission, Role Runs, and authorization interactions reject with `CONTROL_PLANE_UNAVAILABLE`. The plugin preserves every source file and database byte, performs no automatic repair, and never falls back to v1 execution semantics.
