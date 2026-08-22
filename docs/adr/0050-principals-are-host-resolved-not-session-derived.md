---
status: accepted
---

# Principals are host-resolved, not Session-derived

DeepSeek Harness exposes Agent, Session, Message, and tool-call identity but no universal multi-user principal, so the plugin introduces a Principal Resolver Adapter rather than equating a Session id with a person. Standalone local deployment resolves an installation-scoped `local-owner`; a multi-user host must supply a trusted resolver. Mission Start freezes a Mission Access Policy and creator Principal, and every read, decision, mutation, recovery, or cancellation checks Principal permission, Repository Identity, and action scope independently.

A new root Session may bind only after those checks. Other Principals receive only permissions granted by host policy, all privileged actions are audited, and knowledge of a Mission id or access to a child Session never conveys Mission authority.
