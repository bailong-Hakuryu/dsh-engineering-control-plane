---
status: accepted
---

# Bound root Sessions use revision CAS

More than one authorized root Harness Session may observe and act on the same Mission through durable, audited Mission Session Bindings, but a Session never owns Mission truth. Start binds its initiating root Session; a successful authorized root Mission command or status query may establish or restore another binding after Repository Identity validation. Child Sessions remain Execution Traces and cannot acquire Decision Authority, while closing, archiving, or hiding a bound Session affects presentation only and never cancels the Mission.

Concurrent mutations use expected Mission Revision and, for design answers, the exact Frontier Digest. The first valid compare-and-swap commit wins; stale submissions return a structured Revision Conflict, refresh to current truth, and are never automatically replayed or interpreted against a later Frontier. This permits multi-surface operation without adopting last-write-wins behavior.
