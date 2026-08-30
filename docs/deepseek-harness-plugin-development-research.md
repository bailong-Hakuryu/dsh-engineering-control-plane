# DeepSeek Harness plugin development research

Research date: 2026-08-30
Official runtime inspected locally: DeepSeek Harness `0.1.2-alpha.1`
(`D:\Deepseek\deepseek-harness-latest\package.json`), Node
`^22.19.0 || >=24.0.0`.

## Outcome

For Engineering Control Plane and Security Assurance to be installable and
usable directly, each distributable must be a real Harness **bundle**, not only
an npm library. The bundle must install its Host services and model-facing tool
consumers into an ordinary profile, validate all deployment configuration at
load time, and boot without machine-specific paths or a manual repository-ID
handshake. A Web-specific client plugin is optional for v0.1: registered tools
already work in the Web UI and receive a generic card when they do not provide a
custom presentation.

The blocked validation-only Mission exposed a product bug, not a reason to give
role agents shell access. Host-owned verification commands must remain in the
orchestration/verification runtime. Planner and Developer contracts must not
assign those commands to a role whose policy deliberately denies shell tools.

## Harness contracts that implementation must satisfy

### 1. Plugin and lifecycle shape

- A Harness plugin is a TypeScript/ESM module with `apply(ctx, config?)`; function,
  object, and `Service` class forms are supported. Use a `Service` when the plugin
  provides a named capability to other plugins. [Your first plugin](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)
- Declare every required Cordis service in `inject`. Cordis waits while a required
  service is absent, unloads the dependent plugin if it disappears, and reloads it
  if it returns. Optional integrations should omit `inject` and query `ctx.get()`
  at the use site. [Services and dependencies](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/service)
- Registrations made through `ctx` are lifecycle effects. Database connections,
  child processes, timers, and other external resources need one `ctx.effect()`
  disposer; order-dependent shutdown belongs in a single serial disposer.
  [Plugins and lifecycle](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/)
- A swappable integration should expose a stable Service Definition, one or more
  Service Providers, and a Consumer (often a tool). Provider and consumer depend
  on the definition, not on each other. Do not split a simple capability merely
  for ceremony. [Three-role capability design](https://deepseek-harness.github.io/deepseek-harness/en/develop/practice/)

Application to these plugins:

- Engineering Control Plane is the Host orchestration service; its Mission tools
  are consumers of that service.
- Security Assurance should expose a stable assurance-provider definition and a
  Host provider implementation. Control Plane consumes the definition rather
  than importing Security implementation details.
- Tool, invariant, provider, and optional client entries may be separate Loader
  rows, but their dependencies must make unsupported rows remain clearly pending
  or fail with an actionable load error—not silently disappear.

### 2. Configuration is a public contract

- Export both a TypeScript `Config` type and a same-named Schemastery schema.
  Defaults belong on schema fields. A plain object is not a valid Cordis config
  schema. Invalid config must fail during plugin load with an actionable error.
  [Plugin configuration](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/config)
- Anything two deployments may tune must be configuration, not a hard-coded
  constant. Cross-field or service-backed validation can run after schema
  validation when the injected dependency is ready.
- HMR replaces the complete plugin instance. Reconfiguration must not retain old
  registrations, leases, timers, or database handles.
- Later configuration layers replace a Loader row's **whole `config` value**;
  they do not deep-merge keys. Therefore defaults must live in the schema, and
  documentation/examples must show a complete user override when a row needs
  multiple required keys. [Package and install](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)

For direct use, neither bundle may ship a local development path, a generated
repository UUID, or a developer's `DSH_HOME`. The minimum user-supplied value
should be a repository/workspace root. Cross-plugin binding must resolve from a
stable public key (for example repository root plus provider/binding ID), rather
than asking the user to inspect Security's SQLite database and paste an internal
ID into Control Plane configuration.

### 3. Model-facing tools

- Register tools through `ctx.tools.register(defineTool(...))` and declare
  `inject = ['tools', ...]`. The parameter schema is validated before `execute`;
  cross-field constraints still require explicit checks. [Build a tool](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool)
- Return one canonical JSON value matching `output.schema`; keep model-facing prose
  in `output.render`. Do not make callers parse prose for `missionId`, revisions,
  repository IDs, statuses, or legal next actions. Honor `exec.signal` for
  cancellation. [Tool authoring reference](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool)
- Treat arguments and execution identity as readonly. Throw for infrastructure
  failures; represent successful domain outcomes, including non-ideal terminal
  states, in the canonical typed result.
- Deployment policy belongs in the tool pipeline (`tools/pre-execute`, a monotonic
  guard, dispatch wrappers, or result observers), not as ad hoc policy inside
  every tool executor.
- Registered visible tools automatically work in Code Mode and in the Web agent
  surface. A tool without `presentCall`/`presentResult` receives the generic card,
  so custom browser code is not required for v0.1 usability.

The Mission API should therefore keep structured receipts and snapshots as its
canonical values. `mission_status` must surface exact block reasons and legal
actions; `mission_start` must not degrade into a prose-only or alternate
`create_goal` path.

### 4. Host plane versus agent plane

Harness is a Cordis composition: services and execution backends live in the
Host process, while model-visible capabilities are registered into `ctx.tools`
and enter the guarded tool pipeline. Each model step receives the currently
assembled tool schemas. [Architecture](https://deepseek-harness.github.io/deepseek-harness/en/reference/)

For these plugins, this creates a hard ownership boundary:

| Responsibility | Owner |
| --- | --- |
| Mission state machine, leases, persistence, Git snapshots | Control Plane Host service |
| Test/typecheck/build command execution and evidence capture | Host verification runner |
| Security assessment execution and typed gate decision | Security Assurance Host provider |
| Planning code work and returning a typed role result | Planner/Developer/Tester/Reviewer agents |
| Starting/querying/canceling/reworking a Mission | Model-facing Mission tools |

Consequences for the current defect:

1. Do not grant shell to Planner/Developer merely so they can run release gates.
2. Planner must mark acceptance commands as Host verification, not Developer work.
3. A validation-only Mission with no source change must allow Developer to return
   a valid no-change/implemented outcome and then advance to Host verification.
4. Security Assurance must be invoked by the Host gate and commit a typed result;
   an agent's narrative is not assurance evidence.
5. A role `needs_input` caused only by a command it was forbidden to execute is a
   contract/configuration defect and must not strand the Mission without a legal
   recovery action.

This section is an implementation inference from the official service/tool
architecture and the observed Mission failure; the ownership table is specific
to these two plugins.

### 5. Bundle, profile, and patch semantics

- A distributable plugin package declares `dsh.bundle.patch` in `package.json`.
  Its patch inserts/overrides Loader rows and references installed package exports
  by package name, not source-relative or machine-absolute paths. A package without
  `dsh.bundle` installs only as a dependency and activates no layer.
- A profile is a user-owned runnable composition under `$DSH_HOME/profiles/<name>`.
  It lists bundles in order and owns its final `cordis.patch.yml`. A package is a
  bundle or a profile, never both.
- Layer order is: profile bundle patches, profile patch, home patch, then CLI
  `--patch` overlays. Later rows win; each replacement must restate the full config.
- Validate composition without booting with
  `dsh --profile <name> --dump-config`, then boot the same profile.
  [Package and install](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)

Recommended bundle behavior:

- `dsh-engineering-control-plane` installs its Host service and Mission tool row
  enabled by default. Optional invariant/client rows must not block core tools.
- `dsh-security-assurance` installs its Host service, repository binding/provider,
  assessment tools, and Control Plane assurance provider in a dependency-safe
  composition. It should discover or create its repository binding idempotently.
- Installing both bundles into `web` must require no hand-edited activation rows.
  Only deployment data (repository roots, policy/profile choices, credentials) may
  remain user configuration.
- Removal or HMR must unregister all tools/providers and close persistent resources.

### 6. Packaging, installation, and compatibility

The normal user path is:

```sh
dsh plugin --profile web add ./dsh-engineering-control-plane-<version>.tgz
dsh plugin --profile web add ./dsh-security-assurance-<version>.tgz
dsh --profile web --dump-config
dsh --profile web
```

Tarballs are the safest initial delivery format because they include built output
and need no install-time build permission. Installing from GitHub fetches source;
TypeScript packages then require a self-contained `prepare` build and, with pnpm
10+, an explicit `allowBuilds` grant. Git installs should be commit-pinned.
[Package and install](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)

Compatibility requirements for the current delivery:

- Publish ESM and built `lib` entry points; include every runtime subpath referenced
  by the bundle patch and the patch itself in `files`.
- Declare Cordis and consumed DSH contracts as peer dependencies, with matching
  development dependencies. The official package checklist requires matching
  peer/dev ranges and treats Schemastery as a runtime dependency.
  [Adding a package](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-package)
- Do not publish `workspace:` ranges as the external compatibility promise. Pack
  output must contain resolvable registry versions/ranges.
- For v0.1, pin the tested compatibility claim to Harness `0.1.2-alpha.1` and its
  Node engine. Broaden the range only after an installed-artifact matrix proves it;
  pre-1.0 service/tool/client contracts should not be assumed compatible.
- The bundle version and provider protocol version are different contracts. Persist
  an explicit provider protocol version and reject incompatible peers with a clear
  load/start error.

### 7. Web/client surfaces

Host tools are already usable from Web through the normal tool registry and generic
tool cards. A richer browser surface is a separate client plugin:

- A settings card requires a Host settings namespace and a client export declared
  through `dsh.client`; the namespace is the join key. The Host serves enabled
  namespaces and the Web page pairs registered cards automatically.
  [Adding a settings card](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-settings-card)
- A durable Mission/assessment timeline should be modeled as replayable Session
  events with stable business IDs, then rendered by a keyed Conversation Node; it
  must not infer identity from "the latest unfinished" item.
  [Adding a Conversation Node](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-conversation-node)
- Presenter functions run during live streaming and replay, so they must be pure:
  no I/O, clock, random, or live session reads. Durable result metadata carries
  facts needed for replay.

The official settings-card guide notes that the shared client bundling preset is
not currently published for out-of-tree packages. Therefore v0.1 direct usability
should not depend on a custom client module. Ship correct tools and generic cards
first; add client UI only with a separately verified browser artifact.

## Required release verification for both plugins

Harness testing policy distinguishes green unit tests from proof that the shipped
product works. The local official policy is
`D:\Deepseek\deepseek-harness-latest\docs\testing.md`; the official package and
tool guides require behavior-specific and assembled coverage.

Minimum release matrix:

1. **Unit/contract** — all state transitions, cancellation, retries, idempotency,
   invalid config, dependency loss/reload, and error redaction. Every registry has
   an HMR disposal test proving registrations disappear.
2. **Role-contract regression** — a validation-only Mission proves Planner does not
   allocate Host gates to Developer and Developer can return no-change success.
3. **Real Loader composition** — boot a test `cordis.yml` through Loader rather than
   only calling `ctx.plugin()` manually. Assert every intended row becomes ACTIVE
   and missing dependencies are diagnosable.
4. **Published-artifact smoke** — install each packed tarball into a fresh profile
   and fresh `DSH_HOME`; run `--dump-config`, boot under plain Node, enumerate tools,
   and invoke their canonical entry paths.
5. **Two-bundle integration** — start a Mission in a clean temporary Git repo;
   reach Host test/typecheck/build; invoke Security Assurance; persist its typed
   decision; reach an approved/rejected terminal Gate with legal recovery actions.
6. **World-state assertions** — independently inspect Git state, command exit codes,
   receipts, evidence files/database rows, and cleanup. Do not accept the agent's
   prose as proof.
7. **Web smoke** — start the installed `web` profile, open a new session, call
   `mission_start` (not `create_goal`), query status, and verify generic/custom cards
   can replay without errors.
8. **Platform/compatibility** — run the installed-artifact flow on Windows and at
   least one POSIX host, on the declared Node range. Include paths with spaces and
   sandbox-denied writes/spawns.
9. **Pack hygiene** — inspect tarball contents and ensure every manifest export and
   patch reference resolves; run typecheck, lint, build, package tests, and the
   repository's release check.

The official Harness policy specifically requires a non-unit real-composition test
for product-visible plugins, tests the built/published entry path under plain Node,
and requires user-visible changes to have assembled recorded-session coverage.
[Adding a package](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-package)

## Definition of “users can directly use it”

Release is ready only when a new user can:

1. install the two prebuilt tarballs with `dsh plugin --profile web add ...`;
2. supply only honest deployment values—normally a repository root and selected
   policy/profile—without editing generated IDs or plugin activation rows;
3. boot `web` without pending/failed required rows;
4. open a new session and see/call Mission and Security tools immediately;
5. run a validation-only Mission through Host verification and Security gate to a
   terminal result; and
6. remove the bundles without leaving registered tools, providers, handles, or
   background work behind.

Anything less is a developer integration, not a directly usable plugin release.

## Primary sources

- [Your first plugin](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)
- [Build a tool](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool)
- [Plugin configuration](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/config)
- [Package and install](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)
- [Plugins and lifecycle](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/)
- [Services and dependencies](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/service)
- [Three-role capability design](https://deepseek-harness.github.io/deepseek-harness/en/develop/practice/)
- [Architecture](https://deepseek-harness.github.io/deepseek-harness/en/reference/)
- [Adding a package](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-package)
- [Tool authoring reference](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool)
- [Adding a settings card](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-settings-card)
- [Adding a Conversation Node](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-conversation-node)
