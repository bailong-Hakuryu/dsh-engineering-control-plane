---
status: accepted
---

# Action review cannot expand Effective Policy

Effective Policy divides Role Run actions into always-allowed, reviewable, and always-denied classes. An independent Action Reviewer may authorize one concrete reviewable action, or require user authorization, but can never authorize an always-denied action, enlarge a Role Run's Execution Capabilities, or influence the Quality Gate; this gains contextual review without turning model judgment into the security boundary.

Action review executes as a one-shot, tool-less Reviewer Role Assignment over a normalized action description that excludes secret values. Its report is only an input to the Action Gate, which remains the authority that emits the durable allow, deny, or user-authorization-required decision.

Effective Policy also freezes an Action Review Budget. Exact repeated requests reuse their prior Action Decision, semantically equivalent variants share a counter, and exceeding request, time, or model limits blocks the Mission as an action-review loop. A user rejection cannot be re-prompted for the same semantic action, while a Role Run may still pursue a materially safer alternative.
