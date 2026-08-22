---
status: accepted
---

# Release promotion requires complete evidence

Implementation first produces `0.2.0-rc.1`. Promotion of the same code to `0.2.0` requires passing build, typecheck, lint, unit, property, fault, multi-process, migration, E2E, Web, and Packed Installation gates; a maintained `SECURITY.md` and threat model; zero confirmed Critical or High findings and an explicit ADR for any accepted Medium risk; and completed README, configuration, migration, recovery, limitations, and Registry extension documentation. After deterministic gates pass, one manually observed Dogfood Mission runs against the plugin repository as product feedback. RC-to-stable changes only version metadata, never untested code.
