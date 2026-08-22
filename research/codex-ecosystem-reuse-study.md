# Codex ecosystem reuse study

Date: 2026-08-23

Scope: patterns useful to DSH Engineering Control Plane and its future Security Assurance Provider integration

Decision: adapt verified mechanisms; do not embed another control plane or copy unpinned source

## Executive conclusion

The official Codex repository is the strongest source for runtime ownership,
cancellation, approval, and subagent lifecycle mechanics. Two external projects
are useful as corroborating implementations:

- `agentclientprotocol/codex-acp` for typed App Server translation,
  cancellation propagation, and fail-closed permission handling;
- `aresyn/codex-control-plane-mcp` for durable asynchronous operations,
  idempotency, restart recovery, and explicit unknown states.

Neither project is a seam-compatible dependency for a DeepSeek Harness plugin.
They speak ACP or MCP to Codex App Server and own process/runtime concerns that
the DSH Kernel and Cordis Service already own. Importing either would duplicate
authority, state, and lifecycle boundaries. The current implementation therefore
uses independently written TypeScript shaped by the verified invariants below.
No third-party source text was copied and no new runtime dependency was added.

## Provenance and trust limits

### Local official snapshot

`D:\Deepseek\codex-main` is a ZIP extraction without `.git`. Its exact upstream
commit cannot be proven from local metadata. It contains the Apache-2.0 license;
the local `LICENSE` SHA-256 is
`d17f227e4df5da1600391338865ce0f3055211760a36688f816941d58232d8dc`.
It remains read-only and is used only to inspect architecture and names.

For reproducible online references, this study pins OpenAI Codex `main` as
observed on 2026-08-23:

- repository: [openai/codex](https://github.com/openai/codex)
- commit: [`343074d4207d572809bd8cea15f4be1d09d98e0b`](https://github.com/openai/codex/tree/343074d4207d572809bd8cea15f4be1d09d98e0b)
- license: Apache-2.0
- version orientation: `rust-v0.98.0` pointed to
  `b8562c11613a2e89ccc1c2e19e90815850bc8fca` when queried

The local ZIP was not asserted to equal that online commit. Any future direct
source reuse must first replace the ZIP with a commit-pinned checkout and record
the required Apache NOTICE attribution.

### Research method

Only project-owned repositories, licenses, release/tag references, and official
OpenAI documentation were treated as evidence. Commit IDs were read with
`git ls-remote`; popularity and third-party summaries were not used to decide
correctness.

## Official Codex mechanisms worth adapting

Pinned source locations:

- [`agent/control.rs`](https://github.com/openai/codex/blob/343074d4207d572809bd8cea15f4be1d09d98e0b/codex-rs/core/src/agent/control.rs)
- [`agent/control/execution.rs`](https://github.com/openai/codex/blob/343074d4207d572809bd8cea15f4be1d09d98e0b/codex-rs/core/src/agent/control/execution.rs)
- [`agent/control/spawn.rs`](https://github.com/openai/codex/blob/343074d4207d572809bd8cea15f4be1d09d98e0b/codex-rs/core/src/agent/control/spawn.rs)
- [`agent/registry.rs`](https://github.com/openai/codex/blob/343074d4207d572809bd8cea15f4be1d09d98e0b/codex-rs/core/src/agent/registry.rs)
- [`agent/status.rs`](https://github.com/openai/codex/blob/343074d4207d572809bd8cea15f4be1d09d98e0b/codex-rs/core/src/agent/status.rs)
- [App Server protocol](https://developers.openai.com/codex/app-server)
- [Subagents](https://developers.openai.com/codex/subagents)

Useful invariants:

1. A root-scoped control object owns process-local runtime handles; descendants
   do not serialize or independently reconstruct those handles.
2. Capacity and spawn admission use guards/reservations whose cleanup rolls back
   uncommitted runtime state.
3. A durable identity exists before externally observable execution begins.
4. Interrupt, shutdown, and terminal status are separate concepts.
5. Approval is a request/decision lifecycle and an unavailable approval path
   fails instead of granting authority implicitly.
6. A lost channel or process produces an explicit unknown/failed/interrupted
   condition, never synthetic success.

Applied in this slice:

- `AssuranceProviderInvocationRecordV1` is durable and stores only invocation
  identity, exact Provider descriptor, Attempt, timestamps, state, and a bounded
  failure code.
- Provider factories, Provider objects, AbortControllers, credentials, Registry
  handles, and Execution Contexts remain process-local.
- `prepared -> begun` is persisted before `assess()` is called.
- `begun` is not silently retried after replay or host restart.
- the provider receives an invocation-owned abort signal rather than the
  originating tool-call signal.

## External projects

### agentclientprotocol/codex-acp

- repository: [agentclientprotocol/codex-acp](https://github.com/agentclientprotocol/codex-acp)
- observed `main`: [`ba5bcc3d7759250dde9d4d2286a1bec11b363208`](https://github.com/agentclientprotocol/codex-acp/tree/ba5bcc3d7759250dde9d4d2286a1bec11b363208)
- observed release orientation: `v1.6.2` at
  `9780d314d34616b476b1ae451ad31089b3dce49a`
- license: Apache-2.0
- activity: maintained successor to the archived Zed-owned adapter; the source
  exposed 481 commits and active issues/pull requests when inspected

Exact useful files:

- [`src/CodexAppServerClient.ts`](https://github.com/agentclientprotocol/codex-acp/blob/ba5bcc3d7759250dde9d4d2286a1bec11b363208/src/CodexAppServerClient.ts)
- [`src/CodexApprovalHandler.ts`](https://github.com/agentclientprotocol/codex-acp/blob/ba5bcc3d7759250dde9d4d2286a1bec11b363208/src/CodexApprovalHandler.ts)
- [`src/CodexEventHandler.ts`](https://github.com/agentclientprotocol/codex-acp/blob/ba5bcc3d7759250dde9d4d2286a1bec11b363208/src/CodexEventHandler.ts)
- [`src/app-server`](https://github.com/agentclientprotocol/codex-acp/tree/ba5bcc3d7759250dde9d4d2286a1bec11b363208/src/app-server)

What is reusable: explicit translation at the protocol boundary, per-request
cancellation propagation, fail-closed approval conversion, and typed terminal
event handling.

What is incompatible: ACP session identity is not Mission identity; Codex App
Server permission is not DSH Action Gate authority; Codex thread persistence is
not the Assessment Store. Recommendation: use as a future adapter test oracle,
not as a Control Plane dependency. If a Codex-backed assessor is ever added, it
must remain behind the existing Provider Interface and Kernel-issued Context.

### aresyn/codex-control-plane-mcp

- repository: [aresyn/codex-control-plane-mcp](https://github.com/aresyn/codex-control-plane-mcp)
- observed `main`: [`d395c478f86cc3cc0f932f4810a62ef5632f204e`](https://github.com/aresyn/codex-control-plane-mcp/tree/d395c478f86cc3cc0f932f4810a62ef5632f204e)
- observed release orientation: annotated `v0.2.1`, dereferenced commit
  `c4954b276f5623ed195a08fafc27d65e1b56c5ba`
- license: Apache-2.0
- activity: 44 commits and a recent release line when inspected

Exact useful files and tests:

- [`codex_control_plane_mcp/server.py`](https://github.com/aresyn/codex-control-plane-mcp/blob/d395c478f86cc3cc0f932f4810a62ef5632f204e/codex_control_plane_mcp/server.py)
- [`codex_control_plane_mcp/worker.py`](https://github.com/aresyn/codex-control-plane-mcp/blob/d395c478f86cc3cc0f932f4810a62ef5632f204e/codex_control_plane_mcp/worker.py)
- [`tests/test_operations.py`](https://github.com/aresyn/codex-control-plane-mcp/blob/d395c478f86cc3cc0f932f4810a62ef5632f204e/tests/test_operations.py)
- [`tests/test_storage.py`](https://github.com/aresyn/codex-control-plane-mcp/blob/d395c478f86cc3cc0f932f4810a62ef5632f204e/tests/test_storage.py)
- [`tests/test_worker_architecture.py`](https://github.com/aresyn/codex-control-plane-mcp/blob/d395c478f86cc3cc0f932f4810a62ef5632f204e/tests/test_worker_architecture.py)

What is reusable: return a durable operation identity promptly, make client
retries idempotent, persist enough state for restart recovery, separate workers
from clients, and keep `unknown_after_app_server_exit` distinct from success.

What is incompatible: it is a Python MCP control plane for Codex Desktop and
App Server. Importing it would create a second state machine, SQLite authority,
lease system, and approval model beside the DSH Kernel. Recommendation: reuse its
failure scenarios in product tests, not its runtime package.

### zed-industries/codex-acp

- repository: [zed-industries/codex-acp](https://github.com/zed-industries/codex-acp)
- license: Apache-2.0
- status: archived on 2026-07-22 and explicitly superseded by
  `agentclientprotocol/codex-acp`

Recommendation: do not adopt. Historical behavior is relevant only when testing
compatibility with old clients.

### circlemouth/Codex-Wrapper

- repository: [circlemouth/Codex-Wrapper](https://github.com/circlemouth/Codex-Wrapper)
- observed `main`: [`e9353b8d29db0c00057f6c4f88e9d06fb27c61a6`](https://github.com/circlemouth/Codex-Wrapper/tree/e9353b8d29db0c00057f6c4f88e9d06fb27c61a6)
- license: MIT

It demonstrates subprocess concurrency limits, server-side timeouts, and a thin
OpenAI-compatible facade. It also deliberately exposes a different product and
trust boundary and warns that it is experimental. Recommendation: do not reuse
its API or authentication shape; DSH must not turn a Provider into a shared
credential proxy.

## Resulting DSH design boundary

The resulting integration remains:

```text
Mission Kernel
  -> durable exact Provider invocation record
  -> process-local Provider coordinator
  -> Kernel-issued non-serializable Context
  -> AssuranceProviderV1.assess()
  -> later: validate/import a sealed Submission by value
```

It does not become:

```text
Mission Kernel -> embedded Codex/ACP/MCP control plane -> shared foreign store
```

Current source mapping:

- `src/kernel/types.ts`: durable invocation vocabulary;
- `src/kernel/index.ts`: atomic preparation and monotonic state changes;
- `src/kernel/assurance-execution-context.ts`: private Context issuer;
- `src/assurance-provider/registry.ts`: exact runtime resolution;
- `src/assurance-provider/invocation-coordinator.ts`: process-local execution;
- `tests/assurance-provider-composition.spec.ts`: public Cordis proof.

## Next recommendation

Proceed to the already accepted next vertical slice: validate and import a
sealed Reference Fake Submission by value. Keep the real Security Adapter out of
that slice. Before any Codex-backed Provider is considered, add conformance tests
for cancellation during approval, host exit after durable begin, malformed event
ordering, and unknown terminal state. Those tests can borrow scenarios from the
two external projects without importing their authority or persistence models.
