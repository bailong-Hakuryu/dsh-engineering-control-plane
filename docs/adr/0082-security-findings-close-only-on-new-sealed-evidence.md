---
status: accepted
---

# Security Findings close only on new sealed Evidence

Patch application or a successful Developer Role does not close an imported Security Finding. The resulting repository state becomes a new immutable Subject and requires a new eligible sealed Security Assessment whose Fix Verification supports resolved Finding Lineage; otherwise the Finding remains open and any required security Assurance Result remains failed or indeterminate under Policy.
