---
status: accepted
---

# Provider availability fails closed without silent substitution

An unavailable unselected `when-available` Provider is diagnostic only, while a missing required or structurally invalid Provider keeps the Control Plane in read-only Safe Mode. Once a Provider Composition is frozen into an Attempt, later loss blocks its Requirement and cannot be skipped, retried silently, or replaced by a different Provider.

