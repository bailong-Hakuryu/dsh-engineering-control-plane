---
status: accepted
---

# Policy layering has hard Product Ceilings

Deployment configuration resolves from host global defaults through a named Policy Profile selected by canonical Repository Mapping; each layer may select or narrow behavior only within compiled Product Ceilings. Repository documents may contribute Standards Baseline, Observed Facts, or explicitly designated specification Evidence but never execution permission, and model inputs cannot select policy. The validated, redacted result and definition digests freeze into Effective Policy, so live changes affect only new Missions.

v0.2 defaults and Product Ceilings are: User Decisions 128/512, Frontier Rounds 24/64, dependency depth 12/32, Plan Candidates 3/8, reviewable Actions per Role Run 32/128, equivalent variants 3/5, User Authorization prompts per Role Run 8/16, Assurance Assignments per Attempt 12/32, replacement runs per Assignment 1/3, and concurrent Assurance runs per Mission 3/8. Host configuration may lower defaults or raise them only to the corresponding ceiling; an out-of-range deployment fails startup validation.
