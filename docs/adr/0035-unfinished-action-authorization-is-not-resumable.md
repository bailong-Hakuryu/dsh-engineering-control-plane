---
status: accepted
---

# Unfinished Action Authorization is not resumable

An Action Authorization Attempt belongs to one exact Action Fingerprint, Mission Revision, Role Run, and open Role Agent turn. If cancellation, restart, unload, or turn termination occurs before its completed outcome becomes a durable Kernel Action Decision, the Adapter records `ABANDONED_BEFORE_DISPATCH`, terminates the Role Run, and blocks the Mission; because the Action Gate never returned allow, the action was not plugin-dispatched. Resume creates a new Role Run and may issue a fresh exact request within budget, but no old prompt, answer, or one-shot grant survives.

This boundary ends once an allow decision is durably written. A missing Action Outcome after that point is handled as possible post-dispatch indeterminacy under the Action Ledger protocol, not downgraded to an abandoned authorization.
