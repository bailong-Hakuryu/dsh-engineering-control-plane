---
status: accepted
---

# Control Plane Kernel owns engineering governance

DSH Engineering Control Plane is a governance Kernel above DeepSeek Harness, not a subagent-management extension inside it. The Kernel owns Mission lifecycle, role protocol, verification policy, Evidence, Quality Gate, and recovery, while Harness supplies replaceable execution and presentation Adapters; this preserves the product rule that an agent completing work never has authority to approve it.

The v0.2 Codex-like experience remains a plugin-owned Mission Projection: Design Frontier, Role Run cards, independent assurance lanes, Action Decisions, Evidence links, and Gate state can render in any host surface, with chat/status fallback when richer panels are unavailable. Exact split-pane child navigation may evolve in Harness later, but the Control Plane neither forks Harness nor moves domain behavior into its UI.
