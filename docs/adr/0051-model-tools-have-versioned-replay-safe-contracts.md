---
status: accepted
---

# Model tools have versioned replay-safe contracts

The public model surface retains the six stable names `mission_start`, `mission_status`, `mission_resume`, `mission_cancel`, `mission_rework`, and `mission_decide`. Their schemas reject unknown fields and never let the model select Protocol Version. Every result uses a strict Tool Contract Envelope containing contract and protocol versions, Mission identity, revision, status, legal next actions, and a closed success or Public Error Contract; a breaking shape requires a new major contract or tool identifier rather than silent reinterpretation.

Start idempotency uses host-derived Invocation Identity binding Repository Identity, root Session, source Message id, Tool call id, and canonical input digest. Replaying the same accepted Harness call returns its original Receipt, while a genuinely new call against a repository with an existing non-terminal Mission returns the authorized `MISSION_ALREADY_ACTIVE` identity. Objective text and model-supplied keys never establish equivalence.

Public failures are categorized as validation, conflict, blocked, unauthorized, forbidden, unavailable, integrity, budget, or not-found and include only safe current-state hints and a Diagnostic Reference. Unauthorized or cross-repository lookup returns `NOT_FOUND_OR_UNAUTHORIZED`; raw exceptions, storage paths, SQL, secrets, and unredacted Action arguments are excluded.
