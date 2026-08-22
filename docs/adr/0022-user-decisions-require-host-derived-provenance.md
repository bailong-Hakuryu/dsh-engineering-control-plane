---
status: accepted
---

# User decisions require host-derived provenance

`mission_decide` accepts model-supplied structured mappings only when the Harness Adapter also derives Decision Authority from the current authorized user interaction, binding principal, Session, turn, source-message digest, Repository Identity, and allowed decision ids. Child agents, plugin-injected messages, and model turns without fresh user input cannot close User Decisions; a future direct UI uses the same authority contract. This preserves chat ergonomics without treating a model tool call as proof that the user chose its arguments.

The Web Decision Composer therefore does not invoke the Kernel directly. It submits the user's selected Frontier answers as a canonical ordinary user-role Decision Message, after which the root Agent may call `mission_decide`; the Adapter binds that call to the exact message provenance and rejects altered, stale, unlisted, delegated, or model-only resolutions. Headless clients use the same message-plus-tool path.

Decision Messages use a host-owned deterministic grammar. A UI envelope or explicit headless mapping such as `Q101=B` can resolve listed questions, while `全部接受` or `accept all` means only the recommended answer for every question in the exact current Frontier Round. Arbitrary prose that cannot be mapped without model judgment requires clarification rather than authorization. Decision Authority is single-use and binds Message id and digest, Mission Revision, and Frontier Digest, so an answer cannot be replayed after the Frontier changes.
