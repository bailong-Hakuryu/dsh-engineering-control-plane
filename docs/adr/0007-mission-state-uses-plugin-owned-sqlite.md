---
status: accepted
---

# Mission state uses plugin-owned SQLite

The authoritative Mission Store is a plugin-owned `node:sqlite` database at `$DSH_HOME/control-plane/control-plane.sqlite`, independent of optional Harness storage-domain wiring. Transactions and expected revisions protect Mission state, leases, and Evidence references, while digest-bound Evidence files remain under per-Mission directories and are published before their database references. v0.1 guarantees process-crash consistency and records sudden-power-loss durability as best-effort rather than claiming an unverified platform guarantee.
