---
status: accepted
---

# Migration proof uses versioned legacy fixtures

The repository retains byte-level v0.1 schema-2 Mission Store and Evidence Migration Fixtures spanning terminal and non-terminal Missions. Tests verify backup identity, transactional forward migration, v1 Protocol Adapter continuation, v2-only new Missions, rollback on every migration fault, Safe Mode for newer or corrupt stores, missing HMAC keys and Evidence, and the absence of fabricated Design, Action, or Assurance history. Empty-database and hand-built current-schema tests are insufficient migration proof.
