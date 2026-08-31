# DSH Engineering Control Plane

> DeepSeek Harness 的工程任务编排与发布门禁插件 · 中文默认，English below

[![Release](https://img.shields.io/github/v/release/bailong-Hakuryu/dsh-engineering-control-plane?display_name=tag)](https://github.com/bailong-Hakuryu/dsh-engineering-control-plane/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 中文

### 这是什么

<code>dsh-engineering-control-plane</code> 为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供受治理的工程任务执行。它把一次实现、修复、重构或发布验证请求固定为一个可追踪的 Mission，并由宿主负责计划、执行、验证、证据和质量门禁。

它适合希望把“让 Agent 改代码”变成可审计流程的团队：每个 Mission 都有明确的身份、Attempt、策略快照、验证结果和最终状态。

### 主要能力

- 一个工作区同时只允许一个非终态 Mission。
- 在启动时冻结仓库身份、分支、HEAD 和有效策略。
- Planner、Tester、Reviewer 只读；Developer 不能提交、切换分支或改写历史。
- 验证命令来自宿主配置，不由模型临时编造。
- 只有确定性 Quality Gate 可以产生 <code>APPROVED</code>。
- 缺失、损坏、截断或不确定的证据会 fail closed。
- 支持可恢复的 <code>BLOCKED</code>、<code>REWORK_REQUIRED</code>、取消和重启恢复。
- 持久化 SQLite、Evidence 清单和不可变版本化 Receipt/Snapshot。

### 安装（Harness Web）

要求 Node.js <code>^22.19.0 || >=24.0.0</code>，以及可用的 DeepSeek Harness CLI。先安装 Control Plane，再安装可选的 Security Assurance Provider：

~~~powershell
dsh plugin --profile web add D:\Downloads\dsh-engineering-control-plane-0.1.9.tgz
dsh --profile web --dump-config
dsh web
~~~

从 GitHub 下载：[v0.1.9 Release](https://github.com/bailong-Hakuryu/dsh-engineering-control-plane/releases/tag/v0.1.9)。如果两个插件一起使用，Control Plane 必须先安装，因为它提供共享的不变量注册表。

默认配置会把 Harness 启动时的当前工作目录绑定为 <code>current-workspace</code>，并冻结以下默认验证命令：

~~~text
pnpm test
pnpm run typecheck
pnpm run build
~~~

启动 Harness 时，请把终端当前目录设为要治理的 Git 仓库。安装后先执行 <code>dsh --profile web --dump-config</code> 检查最终组合，再执行 <code>dsh web</code>。

### 用户如何调用

插件同时支持被动路由和主动指令：

**被动调用（推荐）**：直接描述工程目标，模型会把实现、修复、迁移和发布验证请求路由到 Mission 工具。

~~~text
请为当前仓库实现这个功能，并在完成后运行完整验证。
请修复这个问题，所有修改必须经过 Mission 发布门禁。
~~~

**主动调用**：在 Harness Web 或 CLI 输入：

~~~text
/mission 为当前仓库执行一次发布前验证，要求测试、类型检查和构建全部通过
~~~

如果确实不需要治理流程，可以明确写出“直接模式，不创建 Mission”。插件不会在委派的 Mission 子角色中创建嵌套 Mission。

### 工具与生命周期

| 工具 | 用途 | 是否改变状态 |
| --- | --- | --- |
| <code>mission_start</code> | 冻结目标、策略和 Attempt，创建 Mission | 是 |
| <code>mission_status</code> | 读取权威快照、Gate 和合法下一步 | 否 |
| <code>mission_resume</code> | 从 <code>BLOCKED</code> 恢复同一 Attempt | 是 |
| <code>mission_cancel</code> | 先停止子任务与外部 Provider，再终态取消 | 是 |
| <code>mission_rework</code> | 从 <code>REWORK_REQUIRED</code> 创建新 Attempt | 是 |

所有变更操作都必须带上 <code>mission_status</code> 返回的精确 <code>revision</code>。过期 revision 会被拒绝，不会自动合并或重试。

典型生命周期：

~~~text
mission_start
    → planner → developer → tester → reviewer
    → evidence capture → quality gate
    → APPROVED / REWORK_REQUIRED / BLOCKED / CANCELLED
~~~

### 只读完整性检查

安装包提供不修改状态的 doctor 命令，用于检查 SQLite 身份、Schema、Lease、Evidence 引用和摘要绑定：

~~~powershell
dsh-control-plane doctor --pretty
dsh-control-plane doctor --dsh-home D:\path\to\dsh-home --pretty
~~~

退出码：<code>0</code> 表示通过，<code>1</code> 表示发现完整性或可用性问题，<code>2</code> 表示命令本身无法执行。doctor 不会创建、迁移、修复、清空或删除数据。

### 持久化与入口

持久化目录默认为：

~~~text
$DSH_HOME/control-plane/
├── control-plane.sqlite
└── missions/<mission-id>/attempt-####/records/<record-id>.json
~~~

公开入口：

| 入口 | 作用 |
| --- | --- |
| <code>dsh-engineering-control-plane</code> | Cordis Service 与 Kernel 契约 |
| <code>dsh-engineering-control-plane/tools</code> | 五个严格模型工具 |
| <code>dsh-engineering-control-plane/client</code> | 浏览器安全的版本化投影缓存，不拥有权威状态 |
| <code>dsh-engineering-control-plane/invariant</code> | 启动就绪与不变量诊断 |
| <code>dsh-engineering-control-plane/assurance-provider</code> | 可选的 Security Assurance Provider 契约 |

### 与 Security Assurance 联用

安装 <code>dsh-security-assurance</code> 后，Control Plane 会按精确的 Provider ID、版本和 <code>current-workspace</code> 绑定调用安全评估。安全评估结果只满足外部安全义务；最终 <code>APPROVED</code> 仍由 Control Plane 根据全部工程证据和 Reviewer 结果计算。

两个插件不共享 SQLite、可写 Evidence 目录、事务句柄或 Kernel 对象。

### v0.1 边界

- 当前发布包面向 Harness <code>0.1.2-alpha.1</code>，Harness 仍处于开发预览阶段。
- 默认验证配置是 pnpm 项目；其他构建系统需要在宿主 Profile 中替换完整的 repository/config 行。
- <code>client</code> 是投影缓存，不是浏览器端 Mission Store；传输和 UI 由宿主集成。
- 该插件负责工程治理，不等同于漏洞扫描器；安全评估由可选的 Security Assurance 插件负责。

### 开发与验证

~~~powershell
pnpm install
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack:dry-run
pnpm release:check
~~~

当前 <code>v0.1.9</code> 发布门禁已通过：33 个测试文件、150 个测试，类型检查、构建和打包检查均通过。

设计依据和完整决策记录见：[CONTEXT.md](CONTEXT.md)、[docs/adr/](docs/adr/)、[docs/implementation-specification.md](docs/implementation-specification.md)。安全问题请参阅 [SECURITY.md](SECURITY.md)。

<details>
<summary>English</summary>

## What it is

<code>dsh-engineering-control-plane</code> is a governed engineering workflow plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It turns an implementation, fix, refactor, migration, or release-validation request into an auditable Mission with explicit policy, attempts, evidence, verification, and a deterministic Quality Gate.

## Highlights

- One non-terminal Mission per canonical worktree.
- Repository identity, branch, HEAD, and Effective Policy are frozen at start.
- Planner, Tester, and Reviewer are read-only; Developer cannot commit, switch branches, or rewrite history.
- Verification commands come from host-owned configuration.
- Only the deterministic Quality Gate can produce <code>APPROVED</code>.
- Missing, corrupt, truncated, or indeterminate evidence fails closed.
- Durable SQLite state, Evidence manifests, immutable Receipts, and versioned Snapshots.

## Install in Harness Web

Requires Node.js <code>^22.19.0 || >=24.0.0</code> and the DeepSeek Harness CLI:

~~~powershell
dsh plugin --profile web add D:\Downloads\dsh-engineering-control-plane-0.1.9.tgz
dsh --profile web --dump-config
dsh web
~~~

Download the package from the [v0.1.9 Release](https://github.com/bailong-Hakuryu/dsh-engineering-control-plane/releases/tag/v0.1.9). Install this plugin before Security Assurance when using both, because it supplies the shared invariant registry. The launcher working directory becomes <code>current-workspace</code>; default checks are <code>pnpm test</code>, <code>pnpm run typecheck</code>, and <code>pnpm run build</code>.

## Invocation

Users can describe an engineering goal in natural language, or explicitly run:

~~~text
/mission Run release validation for the current repository; tests, typecheck, and build must pass.
~~~

Use “direct mode, do not create a Mission” when governance is intentionally not required. Nested Mission creation is rejected inside delegated Mission roles.

The package exposes <code>mission_start</code>, <code>mission_status</code>, <code>mission_resume</code>, <code>mission_cancel</code>, and <code>mission_rework</code>. Every mutation requires the exact revision returned by <code>mission_status</code>; stale control intent is rejected.

## Read-only doctor

~~~powershell
dsh-control-plane doctor --pretty
~~~

The doctor checks SQLite identity, schema, leases, Evidence references, and digest bindings without creating, repairing, migrating, clearing, or deleting state. Exit codes are <code>0</code> (pass), <code>1</code> (issue found), and <code>2</code> (invocation failure).

## Public entries

- <code>dsh-engineering-control-plane</code>: Cordis Service and Kernel contracts
- <code>dsh-engineering-control-plane/tools</code>: strict model tools
- <code>dsh-engineering-control-plane/client</code>: browser-safe projection cache
- <code>dsh-engineering-control-plane/invariant</code>: startup diagnostics
- <code>dsh-engineering-control-plane/assurance-provider</code>: optional Security Assurance contract

## Development

~~~powershell
pnpm install
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack:dry-run
pnpm release:check
~~~

Release <code>v0.1.9</code> passed its gate with 33 test files and 150 tests. See [CONTEXT.md](CONTEXT.md), [docs/adr/](docs/adr/), and [SECURITY.md](SECURITY.md) for the domain model, decisions, and security policy.

</details>

## License

[MIT](LICENSE)
