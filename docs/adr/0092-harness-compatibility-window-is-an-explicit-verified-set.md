---
status: accepted
---

# Harness compatibility window is an explicit verified set

Extending ADR 0064, the supported Harness window is no longer a single exact release candidate: peer dependency ranges name the exact verified versions `0.1.2-alpha.1` (primary qualification target) through `0.1.2-alpha.4` as a closed disjunction, never an open range that would claim unbuilt future versions. The Security Assurance repository owns the scheduled Harness Compatibility matrix that verifies this set for both plugins — packed fresh-profile installation, live Web probe, and the dual-plugin Mission-to-Gate joint E2E on Node 22 and 24 — while this repository keeps its own independent CI on the primary target. A newly published Harness tag enters that matrix automatically and fails closed until a reviewed change, verified locally against the real tag, admits it into the set by updating the peer disjunctions and README together.
