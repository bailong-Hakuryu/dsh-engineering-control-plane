---
status: accepted
---

# Audit chains have explicit Integrity Modes

Every Mission Revision, append-only Ledger, and Attempt Seal participates in canonical SHA-256 chaining. The default `digest-chain` mode detects corruption and internal inconsistency but is explicitly not advertised as tamper-proof against an actor who controls the host filesystem. A high-assurance Profile may freeze `hmac-sha256`, deriving authentication from a host-managed key reference whose secret value is never persisted in Mission or Evidence data. Loss of that key blocks the Mission and never permits downgrade to digest-only verification.
