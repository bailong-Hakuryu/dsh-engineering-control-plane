---
status: accepted
---

# Gate-bearing Role Runs are one-shot per Attempt

Planner, Developer, Tester, and Reviewer each execute as an immutable one-shot Role Run for a specific Mission Attempt, using a session-backed in-process Harness provider. Rework creates new Role Runs in a new Attempt rather than continuing old children; this preserves structured-output validation and audit history, while continuable children remain a possible future diagnostic facility with no Quality Gate authority.
