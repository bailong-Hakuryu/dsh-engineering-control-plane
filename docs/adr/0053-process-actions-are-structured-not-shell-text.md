---
status: accepted
---

# Process Actions are structured, not shell text

The Action Capability Registry accepts local process execution only through registered Command Actions whose Fingerprints bind resolved executable identity, structured argv, canonical cwd, environment-variable names, timeout, and purpose. Shell concatenation, pipes, redirection, substitution, and opaque command strings are not ordinary executable actions. A host that needs a shell or composite transport must register a dedicated Transport Action whose nested capabilities remain independently mediated; environment values are never persisted in the Action Ledger.
