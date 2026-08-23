---
status: accepted
---

# External Assessment Failure is terminal indeterminate assurance

An exact Provider that cannot return a sealed Submission returns the strict
provider-neutral `ExternalAssessmentFailureV1` value. The Control Plane
revalidates and detaches that value, then durably settles the begun Invocation
as `external_failed`. The Provider's `blocked`, `canceled`, and `failed`
reasons all derive an immutable `indeterminate` Assurance Assessment and
Result, import no Provider Evidence, and block the Quality Gate. The bounded
Provider code is retained only as audit detail; it cannot select Gate policy.
An external failure is neither a failed security finding nor proof of safety,
so it cannot become Rework or approval. Malformed failure values are rejected
before the begun Invocation is mutated. Explicit Mission cancellation reserves
terminal settlement before aborting process-local execution; an `assess()`
failure produced by that abort cannot race the Provider's separate `cancel()`
quiescence proof or replace the durable `terminated` outcome.
