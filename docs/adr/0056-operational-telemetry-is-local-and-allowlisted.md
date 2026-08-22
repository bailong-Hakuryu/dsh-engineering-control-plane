---
status: accepted
---

# Operational Telemetry is local and allowlisted

v0.2 sends no external telemetry by default. Local logs and metrics use a field allowlist limited to Mission, Attempt, Role Run, Action and diagnostic identities, states, error codes, digests, counts, and durations; prompts, user answers, Evidence payloads, command output, and secret-bearing arguments are excluded. Debug mode remains redacted and cannot become a capture-everything bypass. Any future remote telemetry requires explicit host configuration and a separate architecture decision.
