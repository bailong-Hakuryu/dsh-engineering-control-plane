---
status: accepted
---

# Mission authority is host-derived

Cordis `EngineeringControlPlane` Service Capability and Kernel `MissionAuthority` authorization are separate concepts. The Harness Adapter derives repository- and action-scoped Mission Authority from the caller and host policy, while the model supplies only ordinary tool inputs such as an objective or Mission id; no bearer capability is returned to or trusted from model text. The Kernel checks both authority and Repository Identity so a new authorized Session can recover work without granting cross-repository control.
