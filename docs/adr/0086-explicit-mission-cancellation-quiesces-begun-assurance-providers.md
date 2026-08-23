---
status: accepted
---

# Explicit Mission cancellation quiesces begun Assurance Providers

Service disposal and host restart may abort process-local Provider calls, but
they never assert that external work was canceled. Explicit Mission
cancellation separately resolves every exact frozen Provider Invocation still
in `begun`, calls its bounded `cancel()` operation, and records a provider-
neutral terminal proof before committing the Mission cancellation. The proof
states that the external Assessment was canceled, was already terminal, or was
never started; it grants no Verdict or Gate authority. Missing registration,
missing cancellation support, malformed proof, or timeout fails closed in
Cancellation Quarantine rather than leaving unproven external work behind a
`CANCELLED` Mission.
