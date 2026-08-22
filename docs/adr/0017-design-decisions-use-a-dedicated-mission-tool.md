---
status: accepted
---

# Design decisions use a dedicated Mission tool

The public control surface adds `mission_decide` for revision-checked, structured Decision Resolutions instead of parsing user choices from `mission_resume` supplemental prose. Partial resolutions durably update the Design Ledger while the Mission remains Blocked, and resolving the whole Design Frontier returns control to `ANALYZING`; `mission_resume` retains its narrower operational-recovery meaning despite the cost of expanding the model-facing surface from five tools to six.
