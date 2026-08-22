---
status: accepted
---

# Model fallback is pre-authorized and RoleRun-scoped

Effective Policy freezes an ordered Model Deployment Set and compatibility requirements while retaining the exact Governed Provider Identity. Each Role Run selects and records one deployment before starting and never switches in flight. If it fails, explicit recovery creates a new Role Run that may select another deployment from the frozen set, producing a new Assessor Identity; no currently available or model-requested deployment becomes an ad hoc fallback.

Role Run Provenance records Provider and deployment identity, parameters digest, Prompt Package and Context Manifest digests, Output Contract, timings, canonical usage when available, stop reason, structured-result digest, and best-effort trace references. This supports audit and comparison without claiming that a nondeterministic model call can reproduce an identical answer.
