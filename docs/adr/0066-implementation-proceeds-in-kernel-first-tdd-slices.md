---
status: accepted
---

# Implementation proceeds in Kernel-first TDD slices

v0.2 is implemented as red-green-refactor vertical slices: pure Kernel revision and state; Design Ledger and `mission_decide`; Plan and Assurance freeze; Action Gate and two-phase Action Ledger; Governed Provider; SQLite, Evidence and recovery; six Harness tools and Loader; projections, read-only Remote and Web; dual Protocol migration; then full Gate E2E. Each slice begins with a failing behavior test through the narrowest authoritative seam and reaches real adapters before the next layer, keeping the governance Kernel independently usable from UI and child transcripts.
