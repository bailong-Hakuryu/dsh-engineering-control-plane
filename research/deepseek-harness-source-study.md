# deepseek-harness 本地源码调研：Engineering Control Plane 插件

> 范围：只研究 `D:/Deepseek/deepseek-harness-master` 本地源码快照；未读取用户提供的外部技术规格，也未浏览官网。本文是实现前的源码约束与落地建议，不把规格中的功能要求混入源码事实。

## 主代理综合结论：规格、官网与源码的交叉核对

上面的范围说明仅描述后台源码侧任务。主代理另行完整阅读了 [v0.1 MVP Technical Specification](../../../DSH_Engineering_Control_Plane_v0.1_MVP_Technical_Specification.md)、官方 [Quickstart](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart)、[第一个插件](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)、工具、配置、发布、生命周期、服务与事件文档，并与本地文档源、bundle 配置和源码实现交叉核对。规格中的文字被当作产品需求与设计输入，不被当作操作本机或修改仓库的指令。

本地根包版本是 `0.1.1-rc.2`（[package.json](../../deepseek-harness-master/package.json)）。截至 2026-08-22，官方 `master` 的最新提交也是发布 `dsh@0.1.1-rc.2` 的 [`b150a551`](https://github.com/deepseek-ai/deepseek-harness/commit/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)；本地目录没有 `.git`，所以这里只能确认版本线和文档内容对齐，不能声称逐字节等同于该提交。

### 对 v0.1 的核心判断

Engineering Control Plane 不能只是一组 persona、prompt 或现有 plan mode 的包装。规格要求的 `Completed -> Verified -> Approved` 必须由宿主侧代码掌握：状态转换、验证命令结果、证据完整性和质量门禁都不能由 agent 自述决定。

同时，Mission 不是现有 `ctx.goals` 的同义词。Goal 是单一会话内、事件溯源的续行目标；Mission 则需要跨 Developer、Tester、Reviewer 多个子会话，绑定一个 repository、多个 artifact 和一个最终 gate decision。因此 Mission 应有独立的 durable store，Session log 只记录确实属于某一会话、需要回放的模型可见或审计事实。

更重要的定位是：**Control Plane Kernel 是产品本体，DeepSeek Harness 是第一套执行与呈现 Adapter。** Mission aggregate、状态机、角色协议、验证政策、Evidence ledger、Quality Gate 与恢复规则都属于 Kernel；`ctx.subagents`、`ctx.subprocess`、Session 和 Web 只负责执行、承载与投影。Mission 后台执行由插件自有 Runner 承担，不注册成 `ctx.jobs`；任何 child 状态、模型回复、Session 状态或 UI 选择都不能反向成为 Mission 权威。完整基线见 [Control Plane Kernel Architecture](../control-plane-kernel-architecture.md)。

### 规格到 Harness 扩展点的映射

| 规格能力 | 建议 Harness 机制 | v0.1 责任边界 |
|---|---|---|
| Mission System | `EngineeringControlPlane` 宿主服务 + 独立 Mission store | 拥有 Mission id、revision、repository、attempt、status、artifact index 和 gate decision |
| Mission State Machine | 纯 transition table + SQLite transaction/revision CAS + fenced repository lease | 只有 Kernel 可迁移状态；工具和 agent 都不能直接写 `APPROVED` |
| Planning Engine | 受限工具集的结构化 subagent run | 产出 `plan.md`；plan mode 只能作为软性提示，不能作为写保护 |
| Developer Agent | `ctx.subagents.start()`，部署固定 provider/persona/toolFilter | 依据已冻结计划修改共享 workspace；结果是工作报告，不是完成证明 |
| Verification Engine | `ctx.subprocess`，命令配置采用 `argv[]` 而不是 shell 字符串 | 采集真实 exit code、signal、timeout、stdout/stderr 与截断事实 |
| Tester Agent | 读取 host-captured verification evidence 的结构化 subagent run | 解释 functional/negative/regression 结果并产出 `test-report.md`，不替代真实命令结果 |
| Reviewer Agent | 只读 toolFilter + 结构化输出 schema | 评估 correctness、maintainability、security、risk，产出 `review-report.md` |
| Mission/Evidence Store | 插件自有 `node:sqlite` 状态库 + `$DSH_HOME` 下 digest-bound 文件；原子发布、hash/size/redaction 元数据 | 不依赖可选 `storageDomain`，也不把 evidence 写进目标 repository |
| Quality Gate | 无 I/O 的纯 evaluator | 任一必需检查失败、缺证据、输出截断或 reviewer blocking finding 都 fail closed |
| Approval Result | Mission 自有 gate decision | 不复用 `ctx.approval`；后者只回答一次具体工具操作是否允许 |

### 推荐的插件形态

最终实现不建议局限为一个 function plugin。更稳妥的是**一个 npm bundle、两个宿主 Cordis 入口，再加同包浏览器 face**：

- 包根默认导出 `EngineeringControlPlane` Service 类，提供 Mission API、状态机、编排、Evidence Store 与 Quality Gate；
- `./tools` 作为 function plugin，命名导出 `name/inject/Config/apply`，把少量模型工具注册到 `ctx.tools`；
- 包根通过 `package.json#dsh.client` 暴露 `./client`，注册 Mission 运行节点与角色子会话入口；浏览器 face 不是第三个宿主入口。
- 两个宿主入口由同一个 `cordis.patch.yml` 插入。这样既遵守“service 默认导出、function plugin 不得默认导出”的 Loader 约束，又不为 MVP 预先拆成多个 npm 包。

建议初始结构以 Kernel 为中心，宿主和浏览器都放在外围 Adapter：

```text
DSH Engineering Control Plane/
├─ package.json
├─ tsconfig.json
├─ cordis.patch.yml
├─ README.md
├─ src/
│  ├─ kernel/               # 不导入 Cordis/Harness/React/browser
│  │  ├─ index.ts           # dispatch + snapshot 的小 Interface
│  │  ├─ mission.ts         # aggregate、revision、attempt
│  │  ├─ commands.ts        # MissionCommand 封闭联合
│  │  ├─ orchestrator.ts    # 角色与验证编排 Implementation
│  │  ├─ state-machine.ts   # 纯转换规则和不变量
│  │  ├─ verification.ts    # 验证政策与证据归一化
│  │  ├─ evidence.ts        # manifest、digest、发布顺序
│  │  ├─ gate.ts            # 纯、fail-closed evaluator
│  │  └─ ports.ts           # Kernel 私有 seams
│  ├─ adapters/
│  │  ├─ dsh-role-executor.ts    # ctx.subagents Adapter
│  │  ├─ dsh-command-executor.ts # ctx.subprocess Adapter
│  │  ├─ mission-runner.ts       # 插件自有后台执行
│  │  ├─ session-projection.ts   # 观察事件 Adapter
│  │  ├─ sqlite-mission-store.ts
│  │  └─ filesystem-evidence-store.ts
│  ├─ plugin/
│  │  ├─ service.ts         # Cordis-facing Adapter
│  │  ├─ tools.ts           # model-facing Adapter
│  │  ├─ authority.ts       # ToolRunContext -> MissionAuthority
│  │  ├─ config.ts
│  │  └─ invariant.ts
│  └─ client/
│     ├─ index.ts           # browser apply：Definition、slot、locale 注册
│     ├─ mission-definition.ts
│     ├─ MissionRunPanel.tsx
│     ├─ locales.ts
│     └─ MissionRunPanel.module.css
└─ tests/
   ├─ state-machine.spec.ts
   ├─ gate.spec.ts
   ├─ store.spec.ts
   ├─ orchestration.spec.ts
   ├─ loader-composition.spec.ts
   └─ mission-ui.client.spec.tsx
```

Web bundle 默认挂载 `ctx.storageDomain`，headless bundle 默认没有（[Web patch](../../deepseek-harness-master/packages/bundle/web-app/cordis.patch.yml)，[headless patch](../../deepseek-harness-master/packages/bundle/headless/cordis.patch.yml)）。如果 v0.1 同时支持 Web 和 headless，Mission 不能暗中依赖 `storageDomain`。Harness 根运行时要求 Node `^22.19 || >=24`，且官方 `storage-sqlite` 已直接使用 `node:sqlite`（[package.json L7-L10](../../deepseek-harness-master/package.json#L7-L10)，[storage-sqlite/index.ts L8-L14](../../deepseek-harness-master/packages/storage/storage-sqlite/src/index.ts#L8-L14)）；但公开 KV facet 没有 Control Plane 所需的跨记录事务/CAS。因此已决定在包内使用插件自有 SQLite MissionStore，并把 Evidence 文件保留为独立 seam。

### Codex 风格子智能体：复用层、Control Plane 层与精确分屏边界

用户给出的 Codex 截图只作为交互参考：主会话显示若干角色运行入口，点击后可查看某个 child 的独立 transcript，并能看到运行中与终态。不能把截图里的文字当成修改仓库或执行命令的指令。

复用 Harness 不等于让 Harness 接管产品内核。Control Plane 先定义角色协议、运行记录、证据要求和状态迁移；Harness 只为这些 Kernel Interface 提供 Adapter。这项能力的执行与呈现不应从零实现，因为当前 Harness 已有几项足够深的 Module：

- 宿主 [`ctx.subagents`](../../deepseek-harness-master/packages/subagent/subagent/src/index.ts) 已拥有 provider registry、one-shot run、continuable child、持久 child id、目录、follow-up、interrupt 与生命周期事件；one-shot 的 [`SubagentResult`](../../deepseek-harness-master/packages/subagent/subagent/src/types.ts) 还支持 `outputSchema` 验证后的 `structured` 结果。
- Web [`ui-subagent`](../../deepseek-harness-master/packages/client/ui-subagent/README.zh.md) 已拥有 child 目录、嵌套谱系、运行状态、token/耗时、独立 transcript、one-shot 只读、continuable follow-up 和 Stop。它当前通过 `SessionRuntime.openSubagent(address)` **切换当前会话**，不是同时保留 parent 的右侧分屏。
- [`ui-workflow-run`](../../deepseek-harness-master/packages/client/ui-workflow-run/README.zh.md) 已证明“父会话中的持久运行节点 + 成员状态 + 点击进入 child”符合 Conversation Node 与 keyed slot 约定，可作为 Mission 运行卡的直接参考，但不能把模型编写的动态 Workflow 当成 Mission 权威状态机。

因此应把 Interface 分成三层：

| 层 | 归属 | Interface / 责任 |
|---|---|---|
| Control Plane Kernel | 产品本体 | Mission、角色协议、状态机、Evidence、Verification、Gate、恢复与所有权不变量 |
| Subagent execution Adapter | Harness 现有 Module | 执行 Kernel 发出的角色请求、隔离 Session、保留 transcript；不决定 Mission 状态 |
| Presentation Adapter | Control Plane 浏览器 face | 把 Kernel 投影折叠为角色运行卡；用确切 `SubagentAddress` 打开 child，不重新实现 transcript |

建议的内部记录至少包含：

```ts
interface RoleRunRecord {
  roleRunId: string
  missionId: string
  attempt: number
  role: 'planner' | 'developer' | 'tester' | 'reviewer'
  mode: 'one-shot' | 'continuable'
  state: 'queued' | 'starting' | 'running' | 'completed' | 'failed' | 'aborted'
  parentSessionId: SessionId
  childSessionId?: SessionId
  stopReason?: SubagentStopReason
  startedAt?: string
  finishedAt?: string
  artifactIds: string[]
  diagnosticRef?: string
}
```

这里的 `state/stopReason` 必须来自 Mission store 与 `SubagentRun.result`，不能从目录的 `running/inactive` 猜测。Harness 明确规定目录 activity 不是成功、失败、取消或完成结果；如果直接拿它驱动 Quality Gate，重启后的 inactive child 会被错误解释为成功。

编排数据流应保持单向：

```text
ControlPlaneKernel
  -> internal RoleExecutor seam
  -> DeepSeek Harness Adapter: ctx.subagents.start(...)
  -> durable Mission store（权威）
  -> parent Session 的 control-plane/* 观察事件
  -> Mission Conversation Node（角色状态卡）
  -> 点击角色 -> ctx.sessions.openSubagent(exact address)
  -> 复用 ui-subagent + 普通 conversation transcript
```

`ControlPlaneKernel` 应是深 Module：外部 Interface 收敛为 `dispatch(command)` 与 `snapshot(missionId)`；`create/start/cancel/rework` 是封闭的 `MissionCommand` 变体。provider 选择、role persona、tool restriction、output schema、dispose、artifact 发布和状态迁移都留在 Implementation 内。删除 Web face 或 `ui-subagent` 只影响观察与 child 浏览，不得破坏 Mission 执行、恢复和 gate；这是“内核没有丢”的删除测试。

v0.1 的具体策略：

1. **Planner、Developer、Tester、Reviewer 默认都是每 attempt 一个 one-shot child。** one-shot 支持强制 `outputSchema`，结算后 transcript 天然只读，最适合审计；v0.1 固定使用 session-backed 的 in-process `spawn` provider，以保证 Web 能打开 child transcript，不能把无本地 Session 的远程 provider 静默降级成“有子会话”；`REWORK_REQUIRED` 创建新的 Developer/Tester/Reviewer child，而不是改写旧会话。
2. **continuable 只作为后续交互增强。** [`ContinuableStartSpec`](../../deepseek-harness-master/packages/subagent/subagent/src/continuation.ts) 明确排除了 `outputSchema`，其 `report` 又是提示引导而非强制，所以 continuable child 的自述不能成为 Gate 权威输入。
3. **角色卡显示两类状态。** role run 状态来自 Mission；child 活动点、token 和耗时可复用现有目录投影。前者回答“结果是什么”，后者回答“现在是否仍在工作”，不能合并成一个枚举。
4. **角色卡只导航，不授予权限。** 点击必须携带 `{ parentSessionId, childSessionId, mode }`；不得只凭 `origin: 'subagent'`、label 或谱系推断 mode/继续执行授权。
5. **Reviewer 的只读不能只靠提示词。** in-process provider 的 `toolFilter` 同时隐藏并拒绝执行被限制工具，可作为实际工具能力围栏；宿主级 workspace 权限与 Quality Gate 仍需独立验证。
6. **子智能体输出不是世界状态。** Developer 的“已实现”、Tester 的“测试通过”和 Reviewer 的“可批准”都只是报告；Git diff、命令退出状态、证据完整性和最终 `APPROVED` 仍由宿主决定。

精确复刻截图中的左右分屏，当前公开插件 seam 还差一层。现有 [`AppFrame`](../../deepseek-harness-master/packages/client/ui-layout/src/client/AppFrame.tsx) 的右列是绑定**当前 Session** 的 `details` slot，现有 [`DetailsPanel`](../../deepseek-harness-master/packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx) 又专门拥有当前会话的 Tool 详情；`ui-subagent` 只能把 child 选为新的当前会话。Control Plane 插件如果直接占用整个 `details` slot，会替换 Tool 详情并重复实现 conversation presentation，违反深 Module 和跨包 slot 组合约定。

如果必须交付真正的 Codex 式并排查看，应先给 Harness 核心增加一个通用的 **Addressed Side Session Module**，而不是写 Control Plane 私有副本。建议 Interface 是 `ctx.layout.openSideSession(address)` / `closeSideSession()`，Implementation 由 ui-layout 保存右栏选择，由 ui-renderer 提供按指定 `sessionId` 绑定的 scope provider，由 ui-conversation 在该 scope 中复用完整会话呈现。随后 `ui-subagent` 和 Control Plane 角色卡都只作为 Adapter 调用这个 Interface。这个 seam 至少会有两个真实消费方，因此值得进入核心。

分阶段交付建议：

- **v0.1（插件内完成）**：父会话 Mission 运行卡、Developer/Tester/Reviewer 状态、点击后切换到独立 child transcript、面包屑返回 parent、终态只读、Mission/Gate 权威状态。
- **v0.1.x（需 Harness 核心改动）**：Addressed Side Session Module、右栏 child transcript、parent 与 child 同时可见、面板 resize/close、对 continuable child 的独立 Send/Stop。

### 建议的执行链

1. `mission_create` 校验当前 agent 的 `session.header.cwd`，要求 Git repository 满足配置的基线政策，生成 Mission 和 `context.md`。
2. `ANALYZING` 采集 repository、HEAD、dirty status、配置与约束；所有事实由宿主工具读取。
3. `PLANNING` 启动只读 Planner subagent，使用结构化输出生成 `plan.md`。
4. `IMPLEMENTING` 启动 developer subagent；结束后由宿主重新读取 Git 状态并生成 `implementation.diff`。
5. `VERIFYING` 由宿主执行配置化 functional、negative、regression、security 命令，再由 Tester 解释已捕获结果，生成 `test-report.md`。
6. `REVIEWING` 启动只读 Reviewer，输入 plan、diff、verification facts 与已知限制，生成结构化 finding 和 `review-report.md`。
7. Quality Gate 只读取规范化证据，生成 `final-report.md`；全通过才迁移到 `APPROVED`，否则迁移到 `REWORK_REQUIRED`。

每个 subagent run 必须传播 Mission Runner 的取消信号并在 `finally` 中等待 `run.dispose()`。每个 repository 在同一时刻只允许一个带 fencing token 的写租约。状态发布发生在持久写入成功之后，artifact 先写临时文件、校验 digest 并原子替换，再由 SQLite transaction 发布引用。

### 已确认的 v0.1 产品决定

1. **状态语义。** `BLOCKED` 表示可恢复的运行/基础设施阻碍，`CANCELLED` 是显式终态；`REWORK_REQUIRED` 只表示 Quality Gate 失败，并通过显式 `rework` 创建新 Attempt 后回到 `PLANNING`，生成增量 Plan。
2. **角色与计划。** Planner 是只读 Role Agent，提出候选 Plan，由 Kernel 校验并冻结；Developer 是唯一可写角色；所有 gate-bearing Role Run 都是每 Attempt 一个 session-backed one-shot child。
3. **工作区政策。** v0.1 要求 clean Git worktree，并对规范化 worktree 实施单写 Mission 租约；插件不 stash、不 reset，也不吸收用户既有改动。
4. **验证纪律。** functional/negative/regression/security 使用配置化 argv、超时和输出上限；缺少必需类别时不能批准，不做 package-manager 自动探测，也不允许 Tester 自选权威命令。
5. **Approval。** `APPROVED` 表示 Kernel Quality Gate 通过；人工签字若将来加入，必须使用不同术语。
6. **Evidence 位置。** Evidence 位于仓库外的 `$DSH_HOME/control-plane/missions/<missionId>`，Mission index 保存 digest 与元数据。
7. **交付范围。** 首个写入口是聊天中的 Mission 工具，Web 观察并导航 Role Run；v0.1 只开发本插件，不修改 `deepseek-harness-master`，真正分屏等待未来公开 Harness seam。
8. **模型工具与仓库绑定。** 模型看到 `mission_start`、`mission_status`、`mission_resume`、`mission_cancel`、`mission_rework` 五个独立工具而不是通用 action dispatcher；`mission_start` 不接受路径，从调用 Agent cwd 冻结 canonical Git worktree root。
9. **Plan 与 Role policy。** Planner 的有效 Plan 由 Kernel 自动冻结，无人工确认状态；Role Runs 固定 in-process `spawn`，默认继承父模型、允许部署按角色覆盖并记录解析结果，模型输入不能选择执行政策。
10. **输入、恢复与取消。** Role 缺信息返回 `needs_input` 并使 Mission `BLOCKED`；恢复在同一 Attempt 新建替代 Role Run。取消等待静止、记录最终 diff/status、保留文件并释放写租约，绝不 reset/stash/delete。
11. **Rework。** 新 Attempt 保留当前 worktree，并将旧 Gate findings、Plan 与 Evidence 输入增量规划；状态固定走 `REWORK_REQUIRED -> PLANNING`，不跳过新 Plan。
12. **只读角色。** Planner、Tester、Reviewer 同时受工具能力限制与前后 Git 检查；任何意外修改都 `BLOCKED`、保留现场、不自动回滚。
13. **Resume 与 Rework。** 工具面增加 `mission_resume`；Resume 保留 Attempt 并追加替代 Role Run，Rework 递增 Attempt 并走 `REWORK_REQUIRED -> PLANNING` 生成增量 Plan。
14. **Mission 控制权。** 已有 Mission 的工具要求显式 Mission id，调用 Agent 的 canonical worktree 必须匹配 Repository Identity；所有命令与查询还需要 Adapter 从 caller、repository 和 host policy 派生的 action-scoped `MissionAuthority`，模型不持有 bearer token。Cordis `EngineeringControlPlane` Service capability 是另一概念。
15. **Evidence 格式。** schema-validated JSON 是 Kernel/Gate 的规范 Evidence Record；规格要求的 Markdown 是 Evidence View，不能被 Gate 反向解析为事实。
16. **Verification Profile。** 四类检查必须分别声明 required commands 或带理由的 `not-applicable`；遗漏会阻断。Tester 没有命令执行能力，只解释宿主 Evidence。
17. **写入与 diff 范围。** Developer 可写整个 canonical worktree 但不能逃逸；Implementation Evidence 冻结 HEAD/branch/index/worktree 基线，并覆盖 staged、unstaged、delete、rename 与 bounded untracked 内容。
18. **后台所有权。** Mission 使用插件自有 Runner，durable acceptance 后与发起工具/Agent 生命周期脱钩；`ctx.jobs` 不拥有 Mission 或取消权，Role Run 继续复用 `ctx.subagents`。
19. **Start 回执。** `mission_start` 在 authority/repository/config/lease 校验和 SQLite commit 后返回 receipt，并把 `ToolRunContext.callId` 作为幂等键；commit 后只允许 `mission_cancel` 请求停止。
20. **重启。** 启动时把遗留 active Mission 迁移为 `BLOCKED(HOST_RESTARTED)`，禁止自动续跑；显式 Resume 必须重获租约并校验 Workspace Fingerprint。
21. **持久化。** `$DSH_HOME/control-plane/control-plane.sqlite` 保存 Mission、Attempt、Role Run、revision、lease 和 Evidence index；每 Mission 目录保存 digest-bound Evidence 文件。v0.1 保证 process-crash consistency，对 sudden power loss 只承诺 best-effort。
22. **多进程。** 多宿主可读；每 repository 只有一个 fenced mutation lease，过期租约不自动接管，不确定性一律 `BLOCKED`。
23. **Artifact 与 secret。** Artifact Budgets 是 configurable hard limits；required truncation fail-closed，不自动删 Evidence。敏感值落盘前脱敏且不保留 raw copy，diff secret 或 required Evidence 不完整都不能批准。
24. **交付。** 独立 `dsh-engineering-control-plane` 包导出根 Service、`./tools`、`./client`、`./invariant`，先以 packed local install + overlay + custom Agent preset 验收，不复制进 Harness 源码。
25. **Web 同步。** snapshot revision 后只接收连续事件，gap/disconnect 重新取 snapshot；Web 只是可恢复 cache。
26. **首条 E2E。** 同一纵向切片同时证明 clean fixture 到 `APPROVED` 和 required Evidence 缺失/截断的 fail-closed 路径，并从 Git、SQLite、Evidence、trace 和 restart-readable 状态断言。
27. **Repository 并发。** 每个 canonical worktree 仅允许一个非终态 Mission；branch 与 HEAD 冻结，Developer 可编辑和 stage，但不能 commit、切分支或执行 history/worktree 操作。
28. **工具契约。** `mission_start` 是 atomic create+start，只接收 objective、显式 context、acceptance criteria 与 constraints；其余四工具使用 strict schema，所有 mutation 带 expectedRevision，冲突不自动重试。
29. **输入历史。** 初始输入、Resume supplemental context 和 Rework instructions 都是 immutable Input Records；Resume 仅从 `BLOCKED`，Rework 仅从 `REWORK_REQUIRED`。
30. **Profile authority。** Verification Profile 只来自 host Cordis config 的 named profile/repository mapping，不做 repo-local discovery 或 model selection；Effective Policy 对整个 Mission（含 Rework）冻结并记录 digest。
31. **Role contracts。** Planner、Developer、Tester、Reviewer 使用 strict versioned schemas，各自只报告 role facts，不存在 authoritative `approved` 字段。
32. **Gate 三分法。** complete pass -> `APPROVED`；definite engineering failure -> `REWORK_REQUIRED`；missing/corrupt/timeout/truncated/redacted/provider/policy indeterminacy -> `BLOCKED`。
33. **迁移与运维。** SQLite migration forward-only、transactional、先备份；corrupt/newer store fail closed，v0.1 doctor 只读，不自动修复、解锁或删除 Evidence。
34. **完成定义。** packed standalone package 必须通过 Kernel/tool/Loader/projection 四个已确认 seam 的 build、typecheck、lint、unit、integration、E2E、restart、cancel、rework、security 与 HMR disposal 验证。

### 设计 frontier 状态

Q1–Q50 已全部确认，产品与架构 frontier 关闭。后续不再把可从源码、测试或构建结果确定的实现事实回抛给用户；若公共 Harness seam 与已确认设计发生真实冲突，则记录证据并重新提出最小决策。

### 测试门槛

除状态机、store、gate 的单元测试外，至少要有：真实 `cordis.yml` 经 Loader 启动的组合测试；Fiber dispose 后 service/tool/listener 全部消失的 HMR 测试；脚本化 mock LLM + 真实 subagent/runtime 的编排测试；真实 subprocess 退出码/超时/截断测试；崩溃后读取 Mission snapshot 的恢复测试；以及一条 keyless 组装快照。E2E 必须从文件系统、Git diff 和命令退出状态验证世界，而不是断言 agent 回复中出现“tests passed”。

## 结论摘要

源码侧的一般最小模板是独立 ESM function plugin：命名导出 `name`、`inject`、`Config`、`apply`，不要同时提供 `default`。插件通过 `ctx.tools.register()`、`ctx.on()`、`ctx.effect()` 和可选的 `ctx.inject()` 接入；与某一会话绑定、需要回放的持久事实可写成 `SessionEventMap` 事件，再用 session projection 构建查询视图。对本项目而言，跨多个 agent/session 的 Mission 不能把 Session log 或 `ctx.jobs` 当作 store/runtime authority；应采用上文的 Service + SQLite MissionStore + plugin-owned Runner + function-plugin Consumer。只有出现第二个真实 Provider 时，才拆成多个 npm 包。

## 1. 插件导出、Config 与生命周期

Cordis 接受三种插件形态：函数、可构造类、带 `apply` 的对象；插件元数据包括 `name`、`Config`、`inject`、`provide` 和 `intercept`。函数插件调用 `apply(ctx, config)`，类插件则构造 `new Plugin(ctx, config)`（[registry.ts L91-L145](../../deepseek-harness-master/vendor/cordis/src/registry.ts#L91-L145)）。仓库进一步规定：

- function plugin 只做命名导出 `name / inject / Config / apply`，不得有默认导出；
- service package 默认导出 Service 类；
- 两种形式混用会让 Loader 取到 `default` 后丢弃函数插件命名空间（[packages/AGENTS.md L3-L7](../../deepseek-harness-master/packages/AGENTS.md#L3-L7)，[loader/index.ts L191-L199](../../deepseek-harness-master/vendor/loader/src/index.ts#L191-L199)）。

`Config` 是 Standard Schema。Fiber 在启动前同步执行 `~standard.validate`，返回 Promise 会直接报“不支持异步 schema”，校验失败抛出 `ValidationError`，成功值可以是 schema 归一化后的新配置（[fiber.ts L43-L62](../../deepseek-harness-master/vendor/cordis/src/fiber.ts#L43-L62)）。因此可以用仓库常见的 `@deepseek-ai/schemastery`/Zod 风格 schema 提供默认值，但不要在 Config 校验里做异步 I/O。

`inject` 可写成字符串数组，也可写成服务名到注入选项的对象；`ctx.inject(deps, callback)` 是一个随服务拓扑变化而重载的子插件快捷方式（[registry.ts L12-L24](../../deepseek-harness-master/vendor/cordis/src/registry.ts#L12-L24)，[registry.ts L164-L186](../../deepseek-harness-master/vendor/cordis/src/registry.ts#L164-L186)）。仓库约定：声明过的必需依赖可用 `ctx.<service>`，可选依赖应用 `ctx.get(name)`；例如可选 projection 更适合放进 `ctx.inject(['sessionProjections'], ...)`，使无该服务的 headless 组合仍能启动（[packages/AGENTS.md L5-L7](../../deepseek-harness-master/packages/AGENTS.md#L5-L7)，[session-projection/index.ts L163-L178](../../deepseek-harness-master/packages/session/session-projection/src/index.ts#L163-L178)）。

生命周期要点：

- `ctx.effect(setup)` 立即安装副作用，setup 返回或 yield 的 disposer 由 Fiber 收集，卸载时逆序清理；支持异步 setup/teardown（[fiber.ts L405-L560](../../deepseek-harness-master/vendor/cordis/src/fiber.ts#L405-L560)）。
- `ctx.on()`/`ctx.once()` 返回 disposer，而且监听器归当前 Fiber 所有（[events.ts L90-L106](../../deepseek-harness-master/vendor/cordis/src/events.ts#L90-L106)，[events.ts L249-L301](../../deepseek-harness-master/vendor/cordis/src/events.ts#L249-L301)）。
- `emit/parallel/serial/bail/waterfall` 语义不同；waterfall 监听器必须调用 `next()` 才会继续，省略即形成拦截/否决（[events.ts L25-L32](../../deepseek-harness-master/vendor/cordis/src/events.ts#L25-L32)，[events.ts L77-L88](../../deepseek-harness-master/vendor/cordis/src/events.ts#L77-L88)）。
- 当前快照没有可据以使用的 `ctx.using` API；可用 API 是 `ctx.inject`、`ctx.plugin` 与 `ctx.effect`。源码里的 `using d = deadline(...)` 是 JavaScript Explicit Resource Management，不是 Cordis 生命周期 API（[registry.ts L164-L186](../../deepseek-harness-master/vendor/cordis/src/registry.ts#L164-L186)，[timeout-policy/index.ts L55-L80](../../deepseek-harness-master/packages/guard/timeout-policy/src/index.ts#L55-L80)）。

## 2. Loader、cordis.yml 与 bundle/产物

`cordis.yml` 顶层是 entry 数组。每项的核心字段为 `id`、`name`、`config`、`group`、`disabled`、`inject`（[config/entry.ts L8-L22](../../deepseek-harness-master/vendor/loader/src/config/entry.ts#L8-L22)）。Include 用扩展 YAML schema 读取配置，顶层不是数组会失败；示例中的动态值使用 `!!js`（[include/index.ts L9-L25](../../deepseek-harness-master/vendor/include/src/index.ts#L9-L25)，[include/index.ts L240-L264](../../deepseek-harness-master/vendor/include/src/index.ts#L240-L264)）。

解析规则：

- `cordis:` 名称走内建模块；以 `.` 开头的名称相对当前配置文件的 `baseUrl` 解析；其余名称按 bare package import（[config/tree.ts L144-L162](../../deepseek-harness-master/vendor/loader/src/config/tree.ts#L144-L162)）。
- App boot 对绝对路径转成 `file:` URL，并可用 `bareModuleBaseUrl` 让宿主侧解析 bare package；相对插件仍与配置文件同目录（[app-boot/index.ts L476-L527](../../deepseek-harness-master/packages/boot/app-boot/src/index.ts#L476-L527)）。
- `disabled` 会继承祖先 group 的禁用状态；禁用 entry 不启动。更新只有 config 时可走 runtime update，改 `name/inject/group` 则替换插件并在失败时回滚（[config/entry.ts L83-L121](../../deepseek-harness-master/vendor/loader/src/config/entry.ts#L83-L121)，[config/entry.ts L141-L245](../../deepseek-harness-master/vendor/loader/src/config/entry.ts#L141-L245)）。
- enabled entry 如果没有成功激活 Fiber，boot 会失败；缺失注入导致 pending 也不会被当作成功启动（[app-boot/index.ts L648-L725](../../deepseek-harness-master/packages/boot/app-boot/src/index.ts#L648-L725)）。

对目标目录最稳妥的本地开发形式是先构建到 `lib/index.js`，然后在同目录 `cordis.yml` 写相对路径，例如：

```yaml
- name: './lib/index.js'
  config:
    enabled: true
```

不要让源码入口与构建入口含混。真实包的 manifest 以 ESM `lib/index.js` 为 `main`/export，以 `lib/types/index.d.ts` 为类型入口；TS 源码从 `src` 输出到 `lib/types`（[tool-todo/package.json L1-L36](../../deepseek-harness-master/packages/todo/tool-todo/package.json#L1-L36)，[tool-todo/tsconfig.json L1-L32](../../deepseek-harness-master/packages/todo/tool-todo/tsconfig.json#L1-L32)）。仓库 workspace 会把官方包链接到本地源码依赖，但目标插件目录不在现有 workspace glob 中，不能直接假设 `workspace:*` 在独立项目可用（[pnpm-workspace.yaml L1-L18](../../deepseek-harness-master/pnpm-workspace.yaml#L1-L18)）。

## 3. 与工程控制平面相关的扩展点

### 工具、审批与 guard

`ToolRuntime` 是默认导出的 Service，静态声明依赖和 Config，并提供 `register()`；注册会校验输出 schema、超时和保留名称，返回与 Fiber 绑定的精确 disposer（[tools/index.ts L787-L837](../../deepseek-harness-master/packages/core/tools/src/index.ts#L787-L837)，[tools/index.ts L1031-L1062](../../deepseek-harness-master/packages/core/tools/src/index.ts#L1031-L1062)）。工具定义包含参数/输出 schema、execute、timeout/concurrency/presentation 等契约（[tools/index.ts L212-L288](../../deepseek-harness-master/packages/core/tools/src/index.ts#L212-L288)，[tools/schema.ts L482-L588](../../deepseek-harness-master/packages/core/tools/src/schema.ts#L482-L588)）。

执行链提供 `tools/pre-execute`、`tools/execute`、`tools/post-execute` 三个 waterfall：前置可 allow/deny/ask，中间可包装执行，后置可接受/替换/block；guard 是 pre-execute 之后的单调收紧层，不能把已拒绝结果改成允许（[tools/index.ts L137-L175](../../deepseek-harness-master/packages/core/tools/src/index.ts#L137-L175)，[tools/index.ts L650-L711](../../deepseek-harness-master/packages/core/tools/src/index.ts#L650-L711)）。控制平面的权限、策略、审计和超时应分别挂在这些明确边界，不要只靠隐藏 prompt 或过滤 UI。

### Service Definition / Provider / Consumer

标准拆分可直接参考 shell：Definition 声明 `Context.shell` 与抽象 `ShellExecutor`，构造时 `super(ctx, 'shell')` 注册 capability（[shell/index.ts L40-L68](../../deepseek-harness-master/packages/shell/shell/src/index.ts#L40-L68)）；`pwsh-local` 是具体 Provider（[pwsh-local/index.ts L118-L181](../../deepseek-harness-master/packages/shell/pwsh-local/src/index.ts#L118-L181)）；`tool-pwsh` 是模型工具 Consumer，通过注入 capability 暴露工具（[tool-pwsh/index.ts L180-L285](../../deepseek-harness-master/packages/shell/tool-pwsh/src/index.ts#L180-L285)）。只有出现多个 Provider 或多个独立 Consumer 时才值得照此拆包。

### 会话事件、持久化与查询视图

会话是 append-only event log；插件通过 declaration merging 扩展 `SessionEventMap`，事件带 `seq/time/data`，格式版本当前为 0，源码明确没有迁移实现（[session/types.ts L33-L56](../../deepseek-harness-master/packages/core/session/src/types.ts#L33-L56)，[session/types.ts L230-L350](../../deepseek-harness-master/packages/core/session/src/types.ts#L230-L350)）。`session/event` 是提交后的通知；`session/flush` 是可等待的并行 flush 边界（[session/index.ts L45-L85](../../deepseek-harness-master/packages/core/session/src/index.ts#L45-L85)）。持久化通过抽象 `SessionPersistence` seam 与 coordinator 监听 created/event/flush/disposed 完成（[session-persistence/index.ts L78-L143](../../deepseek-harness-master/packages/session/session-persistence/src/index.ts#L78-L143)，[coordinator.ts L1084-L1137](../../deepseek-harness-master/packages/session/session-persistence/src/coordinator.ts#L1084-L1137)）。

控制平面的 durable 决策、审批和策略变更应先 append 领域事件，再由 `SessionProjectionRegistry` 纯折叠为状态；projection 注册自身是 effect，卸载后 key 与缓存一起消失（[session-projection/index.ts L180-L203](../../deepseek-harness-master/packages/session/session-projection/src/index.ts#L180-L203)，[session-projection/index.ts L223-L262](../../deepseek-harness-master/packages/session/session-projection/src/index.ts#L223-L262)）。不要把 projection 或 `session/event` 监听器当成事务提交点：仓库要求状态只在真实操作成功后发布（[packages/AGENTS.md L14-L17](../../deepseek-harness-master/packages/AGENTS.md#L14-L17)）。

### hooks / interaction

`hooks-codex` 展示了如何把外部 hook 协议映射到 harness 生命周期：函数插件导出 Config/apply，`ctx.effect` 排空 detached 任务，并监听 session-start、pre-step、tools pre/post、turn-stopping（[hooks-codex/index.ts L60-L105](../../deepseek-harness-master/packages/hooks/hooks-codex/src/index.ts#L60-L105)，[hooks-codex/index.ts L185-L270](../../deepseek-harness-master/packages/hooks/hooks-codex/src/index.ts#L185-L270)）。其中 pre/post waterfall 明确调用 `next()` 并折叠下游决定，是控制平面拦截器的重要范式。

交互审批不是默认可用：工具执行只在存在 `approval` 服务时走 ask，缺失时必须按失败关闭设计，不能假设始终有人机 UI（[tools/index.ts L1678-L1728](../../deepseek-harness-master/packages/core/tools/src/index.ts#L1678-L1728)）。

## 4. 最值得仿照的源码

1. **`packages/todo/tool-todo`：最小而完整的领域插件。** 入口 [src/index.ts L22-L41](../../deepseek-harness-master/packages/todo/tool-todo/src/index.ts#L22-L41) 展示 function plugin 元数据；[L113-L225](../../deepseek-harness-master/packages/todo/tool-todo/src/index.ts#L113-L225) 同时展示 projection、工具注册、事件 append 与 presenter。真实 Loader 组合测试会生成 `cordis.yml`、boot Loader 并覆盖坏配置（[loader-composition.spec.ts L54-L138](../../deepseek-harness-master/packages/todo/tool-todo/tests/loader-composition.spec.ts#L54-L138)）；integration 测试验证模型工具调用、结果和 durable event（[integration.spec.ts L49-L100](../../deepseek-harness-master/packages/todo/tool-todo/tests/integration.spec.ts#L49-L100)）。这是 MVP 首选模板。
2. **`packages/interaction/permission-presets`：控制平面状态/权限范式。** 它把 SessionEventMap、配置 schema、Service、projection、可选 command 和持久化写入集中在一处（[index.ts L36-L51](../../deepseek-harness-master/packages/interaction/permission-presets/src/index.ts#L36-L51)，[index.ts L149-L196](../../deepseek-harness-master/packages/interaction/permission-presets/src/index.ts#L149-L196)，[index.ts L243-L293](../../deepseek-harness-master/packages/interaction/permission-presets/src/index.ts#L243-L293)，[index.ts L385-L445](../../deepseek-harness-master/packages/interaction/permission-presets/src/index.ts#L385-L445)）。适合仿照策略版本、权限 preset 与管理命令。
3. **`packages/plan/plan-mode`：多表面状态机范式。** 同一个 committed log 状态驱动 system prompt、projection、command、tool 和 pre-step 边界（[index.ts L121-L173](../../deepseek-harness-master/packages/plan/plan-mode/src/index.ts#L121-L173)，[index.ts L197-L340](../../deepseek-harness-master/packages/plan/plan-mode/src/index.ts#L197-L340)，[index.ts L462-L497](../../deepseek-harness-master/packages/plan/plan-mode/src/index.ts#L462-L497)）。适合“进入/退出控制模式”一类工作流。
4. **`packages/hooks/hooks-codex`：外部 hook 桥接范式。** 适合研究事件语义转换、拒绝/继续、附加上下文、异步任务 teardown；入口和关键监听见上一节。测试目录已看到 config/bridge/coverage 类测试，但本次收束前未逐个核验其断言细节。
5. **shell Definition + `pwsh-local` Provider + `tool-pwsh` Consumer：capability seam 范式。** 适合未来把执行后端、策略引擎或控制平面 API 做成可替换 Provider；MVP 不必为了形式提前拆成三包。
6. **`session/session-projection`：查询模型基础设施。** 适合控制面板、状态快照和客户端订阅；它不是事件存储本身，不能替代 append/persistence。

## 5. 源码侧最小参考结构与命令

下面是源码侧任务给出的最小 function-plugin 模板；Engineering Control Plane 的最终推荐结构以上文“推荐的插件形态”为准。目标目录仍保持一个 npm package：

```text
DSH Engineering Control Plane/
├─ package.json
├─ tsconfig.json
├─ cordis.yml
├─ README.md
├─ src/
│  ├─ index.ts          # name/inject/Config/apply；唯一插件入口
│  ├─ events.ts         # SessionEventMap 扩展与纯事件构造
│  ├─ projection.ts     # 纯 fold/view
│  ├─ tools.ts          # 工具定义与注册
│  └─ invariant.ts      # 若按官方仓库标准集成时必需
└─ tests/
   ├─ unit.spec.ts
   ├─ integration.spec.ts
   ├─ loader-composition.spec.ts
   └─ fixtures/cordis.yml
```

官方快照要求 Node `^22.19 || >=24`、pnpm 11.7；根脚本提供 build、typecheck、lint、test、coverage、e2e 和 hygiene（[package.json L7-L10](../../deepseek-harness-master/package.json#L7-L10)，[package.json L19-L42](../../deepseek-harness-master/package.json#L19-L42)，[package.json L125-L141](../../deepseek-harness-master/package.json#L125-L141)）。

独立插件的建议验证顺序：

```powershell
pnpm exec tsc -p tsconfig.json
pnpm exec vitest run tests/unit.spec.ts tests/integration.spec.ts
pnpm exec vitest run tests/loader-composition.spec.ts
```

若之后并入官方 monorepo，再从仓库根执行：

```powershell
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run hygiene
```

测试最低要求：schema 默认值/拒绝；真实 `cordis.yml` 经 Loader 启动；工具对模型可见且可执行；durable event 可回放并得到相同 projection；审批/guard 的 allow/ask/deny；Fiber dispose 后工具、监听器、projection 均被移除。仓库明确要求 product-visible 插件有真实组合测试，并要求注册项证明 HMR disposal（[packages/AGENTS.md L7-L7](../../deepseek-harness-master/packages/AGENTS.md#L7-L7)，[packages/AGENTS.md L17-L18](../../deepseek-harness-master/packages/AGENTS.md#L17-L18)）。

## 6. 风险与不可直接假设事项

- 本地目录不是可用的 Git worktree；本次无法确认快照 commit、tag、dirty 状态或它与公开仓库版本是否一致。
- 不可假设快照版本 `0.1.1-rc.2` 的所有包已发布到 npm，也不可在独立目录直接使用 `workspace:*`；依赖版本/本地 link 策略需在真正 scaffold 时单独验证。
- 不可混合默认 Service 导出与 function plugin 命名导出；这是 Loader 解析层面的真实陷阱。
- 不可假设动态修改 config 一定热更新；name/inject/group 变化会替换整个插件，必须验证 teardown、回滚与重复注册。
- 不可假设可选 UI、approval、commands、sessionProjections 或 persistence 一定存在；用明确 inject 或 `ctx.get()`，并定义 headless 行为。
- 不可把 `session/event` 当作写入 API，也不可在 operation 成功前发布派生状态；先 append committed event，再投影。
- Session 格式当前无迁移实现；新增 durable event 要保持 append-only、可回放，并谨慎设计 `ignorable`/版本语义。
- 本次未继续检查 bundle 工具内部实现、发布流水线、所有 hooks/interaction 测试、Windows 下独立包解析实测，也未运行测试；这些均应在开始 scaffold 后作为验证项，而不是当前结论。

## 实际检查范围

已阅读仓库根与 packages/examples/docs 的 `AGENTS.md` 约束，并定点检查 Cordis registry/fiber/events/service、Loader config tree/entry/include、app boot、tools、session/persistence/projection、shell Definition/Provider/Consumer、todo、permission-presets、plan-mode、hooks-codex、timeout-policy，以及 headless/acp 的局部配置与相关测试。按用户收束要求，未继续泛化遍历，未修改 `deepseek-harness-master`，未创建本文件以外的成果文件。
