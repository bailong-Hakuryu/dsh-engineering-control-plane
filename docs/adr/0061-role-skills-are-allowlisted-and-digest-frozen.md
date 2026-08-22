---
status: accepted
---

# Role Skills are allowlisted and digest-frozen

A Role Assignment may load only Governed Skill Definitions explicitly allowed by its Policy Profile and frozen by identity, version, and content digest. Skill text is treated as privileged Role instruction and included in Prompt Package provenance, so a same-named changed or missing Skill blocks the Role Run rather than being substituted. The model cannot search installed Skills to enlarge its instruction set, and every action suggested by an allowed Skill remains independently subject to the Action Gate.
