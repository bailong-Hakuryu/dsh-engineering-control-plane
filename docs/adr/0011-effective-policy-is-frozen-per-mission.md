---
status: accepted
---

# Effective policy is frozen per Mission

Role model overrides, Verification Profile, timeouts, Artifact Budgets, redaction rules, lease timing, and projection settings are resolved into a redacted Effective Policy snapshot when a Mission is accepted. Its digest is durable and later configuration changes apply only to new Missions, not Resume or Rework. Stable policy makes Evidence comparable across Attempts and prevents a live deployment update from silently changing an active Mission's authority or Quality Gate.
