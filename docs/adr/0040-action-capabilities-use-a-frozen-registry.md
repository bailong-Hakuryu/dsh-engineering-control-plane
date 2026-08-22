---
status: accepted
---

# Action Capabilities use a frozen Registry

The host composes a versioned Action Capability Registry at startup. Each Action Kind registers a strict normalizer, product safety ceiling, redaction contract, deterministic fingerprint and equivalence rules, and Action Outcome contract. Registration identity or version conflicts fail startup; unknown or partially normalized actions are denied. Extensions may narrow behavior or expose an action as host-reviewable but cannot override product-level always-denied classes, and every Mission freezes the exact definitions and digests it may use.
