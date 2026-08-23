---
status: accepted
---

# Assurance Retry creates a successor Provider Invocation

When a current-attempt External Assessment Failure derives an indeterminate
Assurance Result that blocks the Quality Gate, an exact-revision Mission Resume
may continue the same Attempt. The Resume transaction preserves the failed
Provider Invocation, Assurance Assessment, Assurance Result, and Gate decision,
and prepares one successor Invocation linked by
`replacementForInvocationId`. The successor retains the exact frozen Provider
descriptor, public configuration, Attempt, and Assurance Subject, but receives
a new Invocation identity. Only the active successor is executed and evaluated;
the latest Result per requirement is authoritative for the next Gate decision,
while all earlier records remain immutable history.

Only `blocked` and `canceled` External Assessment Failures are retryable;
`failed` is terminal for the frozen Provider composition and does not advertise
Mission Resume. Assurance Retry is explicit and never runs during startup. It
does not replay `assess()` on a settled identity, invoke `recover()` for a
different identity, or create a Rework Attempt. Rework remains reserved for an
eligible failed Assurance Result that requires implementation changes.
Repeated Gate rounds publish distinct immutable Final Report records and
versioned human views.
