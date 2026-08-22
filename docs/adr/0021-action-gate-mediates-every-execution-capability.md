---
status: accepted
---

# Action Gate mediates every Execution Capability

Every repository read, workspace write, process execution, Git operation, network access, subagent spawn, credential access, or external mutation is normalized as an Action Request and classified by the Action Gate before execution, regardless of originating Harness Provider. Always-allowed low-risk actions may be durably summarized per Role Run, while reviewable, denied, and user-authorized decisions are recorded individually; this keeps complete mediation without allowing routine read audit volume to consume the Evidence budget.

Equivalence and decision reuse rely only on host-owned canonical Action Fingerprints for structured argv, paths, Git operations, network targets, and other registered action kinds. User Decisions similarly use namespaced Decision Subject Keys. Model similarity may flag a suspected collision, but cannot establish semantic identity; an unresolved collision blocks instead of letting wording changes evade budgets or prior decisions.

The v0.2 default ceiling allows repository reads for read-only roles and Plan-scoped worktree writes for Developer, while verification remains host-executed. Git history or branch operations, writes outside the canonical worktree, secret reads, nested Role Agent spawning, and external mutations are always denied; network is denied unless an exact host-owned rule marks a domain and purpose reviewable. Role configuration may narrow these defaults but cannot widen the product ceiling.

Code Mode does not collapse this boundary. The outer `run_code` execution is normalized as a Transport Action and every nested dispatch is independently normalized and decided, with Harness `rootCallId` and `parent` identity preserving the execution tree. Review and equivalence budgets do not double-count a container as its leaf actions, and any tool without a registered host normalizer is denied rather than treated as an opaque capability.
