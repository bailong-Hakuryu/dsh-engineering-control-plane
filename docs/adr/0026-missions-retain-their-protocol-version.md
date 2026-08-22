---
status: accepted
---

# Missions retain their Protocol Version

Every Mission persists the governance Protocol Version accepted at Start. Forward SQLite migration marks existing Missions as v1 and new Missions use v2; v1 Resume and Rework continue under their frozen v1 policy rather than receiving newly invented Design Ledger or Assurance obligations, while adopting v2 requires a new Mission. This accepts temporary dual-protocol runtime cost to prevent an upgrade from silently changing the meaning of durable history.

The v0.2 installer takes a recoverable database backup before a transactional schema migration and retains explicit v1 and v2 Protocol Adapters behind the same Kernel. Legacy records are never backfilled with invented Design Ledgers, Action Ledgers, or Assurance facts. If the exact v1 runtime is unavailable, a non-terminal legacy Mission blocks with `LEGACY_RUNTIME_UNAVAILABLE`; it is never reinterpreted by v2, and the upgraded store does not promise reverse-write compatibility.
