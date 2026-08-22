---
status: accepted
---

# Integrations cross only the Service Capability

Other Harness plugins integrate through the versioned `EngineeringControlPlane` Service Capability, whose typed command and query operations always enforce host-derived Mission Authority. Mission Store, Kernel implementation, Lease writers, Gate evaluators, and Ledger mutation are not exported, and the Service accepts no model-visible bearer token or caller assertion as authority. Registry contribution occurs only during startup composition. This preserves useful host extensibility without giving another plugin a path around Action Gate, Quality Gate, Principal checks, or Mission Session Binding.
