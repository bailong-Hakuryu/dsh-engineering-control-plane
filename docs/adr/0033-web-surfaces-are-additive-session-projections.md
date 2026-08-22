---
status: accepted
---

# Web surfaces are additive Session projections

The plugin ships a real `dsh.client` Web entry and composes only public additive seams: a `conversation.view` Mission tab, durable `conversation.chat.node` milestone cards, a `conversation.composer` Decision Composer, and existing Sessions/Subagent navigation for available child traces. It does not replace Harness conversation, details, or subagent UI and requires no Harness source modification.

After a Kernel commit, every bound root Session may receive a bounded whole Mission Projection; a newly bound Session receives the current whole snapshot. Harness Session Projection transport and `useProjection()` own browser delivery and recovery, but the Session log remains a presentation mirror rather than Mission authority. Projection or Execution Trace unavailability degrades presentation only: canonical Mission state and Evidence remain in plugin-owned stores, with model-facing status as the fallback.

The projection is an allowlisted summary rather than an unbounded copy of Mission storage. The Mission tab obtains immutable Evidence Views, Findings, and Action Ledger pages through a plugin-owned read-only Remote that verifies the bound root Session and Repository Identity. That Remote exposes no transition or decision method; secrets, Decision Authority material, raw prompts, unredacted tool data, and unnecessary absolute paths are excluded from both projection and detail views.
