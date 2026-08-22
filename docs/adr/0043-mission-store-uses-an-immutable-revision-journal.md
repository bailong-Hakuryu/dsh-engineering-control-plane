---
status: accepted
---

# Mission Store uses an immutable Revision Journal

The v2 SQLite store uses an immutable Mission Revision Journal plus normalized append-only Design, Decision, Attempt, Role Run, Evidence, Action, and Assurance records. A small Mission head table points to the current Revision and rebuildable indexes serve queries; Session events and mutable JSON snapshots are not authority. One transaction appends the new Revision and domain records, advances the head, and appends a Projection Outbox item, preserving expected-revision semantics and making projection retry independent of Kernel commitment.

The design deliberately stops short of requiring every aggregate fact to be reconstructed from generic events: versioned canonical Revisions remain the authoritative state boundary, while normalized ledgers provide integrity, query, and audit structure. A mismatch between journal, records, head, or indexes fails closed rather than selecting whichever copy is convenient.
