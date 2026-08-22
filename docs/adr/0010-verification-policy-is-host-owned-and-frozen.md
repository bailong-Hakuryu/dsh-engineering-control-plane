---
status: accepted
---

# Verification policy is host-owned and frozen

v0.1 resolves a named Verification Profile from host-owned Cordis configuration and canonical-repository mapping, never from model input or automatic repository discovery. The effective profile is validated, digest-bound, and frozen for the full Mission including Rework Attempts; an unmapped repository cannot start. This adds deployment setup but prevents a Developer from weakening the checks that will judge its own changes.
