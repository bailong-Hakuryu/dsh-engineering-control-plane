---
status: accepted
---

# User action authorization adapts Harness ApprovalService

When an Action Reviewer requires a user decision for a reviewable Action Request, the Harness Adapter uses `ApprovalService` rather than exposing another model-facing Mission tool or building a competing interaction system. Its audited one-shot outcome is bound to the exact request digest, Mission Revision, and Role Run, then committed as a Kernel Action Decision; unavailable interaction fails closed, and Harness Session events remain trace rather than Mission authority.

`allowed-once` grants only the exact request, `rejected` and `cancelled` deny it without cancelling the Mission, and unavailable interaction or timeout blocks as authorization indeterminacy. A Role Run may pursue a materially safer alternative after rejection, but user grants are never promoted into command-prefix or Session-wide policy.

The Approval request is made inside the requesting Role Agent's open turn. Its interaction is only an Action Authorization Attempt: cancellation, host restart, plugin unload, or Role Run termination before a completed outcome is durably converted into an Action Decision abandons the attempt before dispatch. No pending prompt or late answer may be resurrected in a later Role Run.
