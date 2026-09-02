---
type: "query"
date: "2026-09-02T09:29:05.687381+00:00"
question: "修复 dsh-engineering-control-plane 的 Verify (windows-latest) CI 失败"
contributor: "graphify"
outcome: "useful"
source_nodes: ["assurance-provider-composition.spec.ts", "assurance-provider-submission.spec.ts", "Mission Cancellation Quiescence", "External Assessment Failure", "AssuranceProviderInvocationCoordinator", "sqlite-mission-store.ts"]
---

# Q: 修复 dsh-engineering-control-plane 的 Verify (windows-latest) CI 失败

## Answer

Expanded from original query via vocab: [assurance, provider, invocation, cancellation, quiescence, failure, prepared, terminal, submission, sqlite, credential, mission]. The Provider state machine reaches the correct durable terminal states; Windows CI exhausted test-only 5-second case limits and a 4-second polling deadline under fork contention. Timeout interruption then caused secondary SQLite EBUSY cleanup errors. Use explicit 15-second budgets for the two integration cases and the rejection matrix, and an 8-second terminal polling deadline; do not change production cancellation or submission logic.

## Outcome

- Signal: useful

## Source Nodes

- assurance-provider-composition.spec.ts
- assurance-provider-submission.spec.ts
- Mission Cancellation Quiescence
- External Assessment Failure
- AssuranceProviderInvocationCoordinator
- sqlite-mission-store.ts