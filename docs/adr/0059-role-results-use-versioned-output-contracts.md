---
status: accepted
---

# Role results use versioned Output Contracts

Role results are accepted only through Registry-owned, versioned Role Output Contracts binding schema, Assignment, Assurance Requirement, Mission Revision, Attempt, identity, and eligible Evidence references. Unknown fields, missing references, invalid enums, or identity mismatch reject publication. Contracts expose no authoritative `approved`, `blocking`, or policy-override field; human Markdown is deterministically materialized from accepted structured records. The resolved Contract and parser digests freeze into Effective Policy, so a live schema update cannot reinterpret an existing Mission.
