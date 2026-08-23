---
status: accepted
---

# Repository binding is a process-local assertion

The Kernel-issued Assurance Execution Context exposes a non-serializable
equality assertion over the Mission's canonical Repository Identity. An
Adapter may present a canonical root resolved by its own Host-owned registry,
but the Context never returns the Mission root and neither path enters a DTO,
Store, Evidence record, Submission, model tool, or Remote surface. This proves
same-repository configuration without shared storage, a path-derived public
digest, or coupling the Control Plane to a Provider's Subject Manifest.
