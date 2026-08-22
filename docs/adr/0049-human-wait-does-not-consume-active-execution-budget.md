---
status: accepted
---

# Human Wait does not consume Active Execution Budget

Effective Policy separates Active Execution Budget from Human Wait. Agent, tool, Verification, and Action Review runtime plus model invocation counts are charged while active; each Role Run retains an independent timeout, and canonical provider usage may additionally enforce a cumulative token ceiling. Waiting for a Decision Message or User Authorization consumes no active budget and holds no Repository Write Lease. Retention or reminder settings may observe Mission age, but v0.2 never answers, approves, cancels, or deletes Evidence merely because a person took too long.
