# 华为云 TaurusDB 数据面 MCP Server — 实施计划

> 本文档聚焦 `@huaweicloud/taurusdb-mcp` 的实施路线。
>
> 配套阅读：
>
> - [`architecture.md`](./architecture.md) — 目标架构、包边界、核心抽象
> - [`taurusdb-cli-implementation.md`](./taurusdb-cli-implementation.md) — CLI 前端实施计划

---

## 1. 文档定位

这份计划解决两个问题：

- 如何把当前单包仓库中的共享逻辑沉淀为 `core`
- 如何在不打断现有 MCP 交付的前提下，把 MCP 壳层收敛到 `packages/mcp`

因此它不是一份“从零开始”的 greenfield 计划，而是一份**以重构为主、以兼容交付为约束**的迁移计划。

### 1.1 范围

本计划覆盖：

- 从当前 `src/` 中抽取共享数据面能力到 `packages/core`
- 建立 `packages/mcp`，承接 MCP 启动、Tool 注册、响应封装、客户端 `init`
- 保持 MCP Server 的能力集合与对外契约稳定
- 为 CLI 复用预留稳定 SDK 边界

本计划不覆盖：

- CLI 的 REPL、AI Agent、终端 UI 细节
- 管控面 OpenAPI 编排
- 多数据库引擎的二期扩展实现细节

### 1.2 当前基线

当前仓库已经具备单包 MCP Server 的雏形，结构大致如下：

| 当前路径 | 当前职责 | 目标归属 |
| --- | --- | --- |
| `src/index.ts` | MCP 入口 | `packages/mcp` |
| `src/server.ts` | 启动、依赖装配、stdio 连接 | `packages/mcp` |
| `src/tools/*` | Tool 注册与协议层 | `packages/mcp` |
| `src/commands/init.ts` | MCP 客户端配置写入 | `packages/mcp` |
| `src/auth/*` | profile / secret 解析 | `packages/core` |
| `src/config/*` | 配置读取 | `packages/core` |
| `src/context/*` | datasource / session context | `packages/core` |
| `src/schema/*` | schema 探查与缓存 | `packages/core` |
| `src/safety/*` | guardrail / confirmation / redaction | `packages/core` |
| `src/executor/*` | explain / execute / tracker / pool | `packages/core` |
| `src/utils/*` | logger / id / hash 等 | `packages/core` |

结论：当前代码已经隐含了 `core + mcp` 的边界，但还没有被显式建模。

### 1.3 实施原则

- 先稳定 API，再移动文件。否则只是把耦合搬家。
- 先抽 `core`，再瘦 `mcp`。CLI 以后复用的是抽象，不是目录名。
- MCP 行为要持续可用。任何阶段都要能跑出可用的 `taurusdb-mcp`。
- Tool 层不再承载业务决策。业务逻辑统一收敛到 `core`。

---

## 2. 目标产物

目标是形成如下 monorepo 结构：

```text
repo/
├── packages/
│   ├── core/         # @huaweicloud/taurusdb-core
│   ├── mcp/          # @huaweicloud/taurusdb-mcp
│   └── cli/          # @huaweicloud/taurusdb-cli
├── docs/
└── package.json
```

对 MCP 而言，最终职责收敛如下：

### `packages/core`

- `TaurusDBEngine` 作为统一入口
- schema / guardrail / executor / audit / context / auth
- `ConfirmationStrategy`、typed errors、结构化结果类型

### `packages/mcp`

- `stdio` transport
- MCP Tool schema 与 handler
- envelope 和错误映射
- `taurusdb-mcp init` 与客户端适配
- 仅 MCP 特有的配置、日志和发布打包

---

## 3. 目标边界

### 3.1 Core 对 MCP 暴露的最小 API

MCP 最终只依赖这一层 SDK，而不是散落的模块：

```ts
interface TaurusDBEngine {
  listDataSources(): Promise<DataSourceInfo[]>;
  listDatabases(ctx: SessionContext): Promise<DatabaseInfo[]>;
  listTables(ctx: SessionContext, database: string): Promise<TableInfo[]>;
  describeTable(ctx: SessionContext, database: string, table: string): Promise<TableSchema>;
  sampleRows(ctx: SessionContext, database: string, table: string, n: number): Promise<SampleResult>;
  resolveContext(input: ResolveInput): Promise<SessionContext>;
  inspectSql(input: InspectInput): Promise<GuardrailDecision>;
  explain(sql: string, ctx: SessionContext): Promise<ExplainResult>;
  executeReadonly(sql: string, ctx: SessionContext, opts?: ReadonlyOptions): Promise<QueryResult>;
  executeMutation(sql: string, ctx: SessionContext, opts: MutationOptions): Promise<MutationResult>;
  getQueryStatus(queryId: string): Promise<QueryStatus>;
  cancelQuery(queryId: string): Promise<CancelResult>;
  handleConfirmation(decision: GuardrailDecision, ctx: SessionContext): Promise<ConfirmationOutcome>;
  close(): Promise<void>;
}
```

### 3.2 MCP 保留的专属责任

以下内容不应回流到 `core`：

- Tool 名称、描述、输入 schema
- JSON-RPC / MCP envelope
- `init --client claude|cursor|vscode`
- `stdio` 生命周期管理
- 针对 MCP Client 的错误文案和提示语

---

## 4. 工作流拆分

### 4.1 工作流 A：Shared Core 抽取

目标：把当前根 `src/` 中能复用的模块收敛成 `packages/core`。

交付物：

- `TaurusDBEngine` 主入口
- 类型、错误、配置、日志、context、schema、guardrail、executor
- `TokenConfirmationStrategy` 与内存 `ConfirmationStore`
- 不感知 MCP/CLI 的纯业务层单测

### 4.2 工作流 B：MCP 壳层收敛

目标：把当前 MCP 入口与 Tool 层迁移到 `packages/mcp`，只保留协议适配。

交付物：

- `index.ts` / `server.ts` / `bootstrap.ts`
- Tool registry 与 envelope
- `init` 客户端适配器
- MCP 包自己的集成测试和发布脚本

### 4.3 工作流 C：兼容迁移与发布

目标：让迁移过程中的安装方式、命令入口、测试链路都可持续工作。

交付物：

- 根脚本到 workspace 脚本的迁移方案
- `taurusdb-mcp` 二进制保持可用
- 文档、示例、README 的同步更新

---

## 5. 分阶段实施

## Phase 0 — 基线冻结与重构约束

**目标**：在开始搬迁之前，先把当前单包实现的真实边界冻结下来。

**做什么**

- 盘点 `src/` 目录中的业务模块、协议模块、通用工具模块
- 明确哪些导出未来属于 `core`，哪些属于 `mcp`
- 为当前 MCP 入口、Tool registry、关键执行链路补 smoke test
- 修正文档中的旧引用和错误命名，统一到 `core / mcp / cli`

**验收**

- 当前单包 MCP Server 能稳定启动
- 关键 Tool 至少有最小 smoke test
- 文档不再把 CLI 文档写成 MCP 文档副本

## Phase 1 — Workspace 与包骨架落地

**目标**：建立 monorepo 外壳，但不立即大规模迁移逻辑。

**做什么**

- 引入 `pnpm workspace`
- 新建 `packages/core` 与 `packages/mcp`
- 搭好根 `tsconfig`、构建脚本、测试脚本
- 让 `packages/mcp` 先以桥接方式调用现有实现，保证命令可运行

**验收**

- `pnpm build` 能同时构建 `core` 和 `mcp`
- `taurusdb-mcp` 仍可作为可执行命令启动
- 根目录和 package 级脚本职责清晰

## Phase 2 — Core API 收口

**目标**：先把共享逻辑从“模块拼装”提升为“显式引擎接口”。

**做什么**

- 定义 `TaurusDBEngine`、`EngineConfig`、`SessionContext`、typed errors
- 把 config、profile、secret、context 的组合逻辑收进 engine factory
- 把 schema、guardrail、executor 暴露为 engine 方法，而不是让前端直接调用底层模块
- 把 `task_id`、日志上下文、confirmation 抽象收口到 core

**验收**

- MCP Tool handler 只依赖 `engine`，不再拼装零散依赖
- `core` 不引用 `@modelcontextprotocol/sdk`
- 类型命名在三份文档中保持一致

## Phase 3 — 模块迁移到 `packages/core`

**目标**：把已收口的共享能力迁移到独立包，同时保持行为一致。

**优先迁移顺序**

1. `utils/`、`config/`、`auth/`
2. `context/`、`schema/`
3. `safety/`
4. `executor/`

**迁移映射**

| 当前路径 | 迁移后路径 |
| --- | --- |
| `src/auth/*` | `packages/core/src/auth/*` |
| `src/config/*` | `packages/core/src/config/*` |
| `src/context/*` | `packages/core/src/context/*` |
| `src/schema/*` | `packages/core/src/schema/*` |
| `src/safety/*` | `packages/core/src/safety/*` |
| `src/executor/*` | `packages/core/src/executor/*` |
| `src/utils/*` | `packages/core/src/utils/*` |

**验收**

- `packages/core` 能独立通过单元测试
- `packages/mcp` 只通过 `workspace:*` 依赖 `core`
- 迁移后 import 方向单向：`mcp -> core`

## Phase 4 — MCP 协议层重建

**目标**：把 MCP 层整理成真正的协议壳，而不是业务容器。

**做什么**

- 重写 `packages/mcp/src/bootstrap.ts`，负责创建 `engine`
- 重写 `packages/mcp/src/server.ts`，负责 server 初始化和 transport 连接
- 统一 Tool registry、error boundary、response envelope
- 为每个 Tool 补足精确描述、输入 schema 和 guardrail 入口策略
- 把 `init` 命令迁移到 `packages/mcp/src/commands/init.ts`

**推荐 Tool 集合**

| Tool | 说明 |
| --- | --- |
| `list_data_sources` | 查看可用数据源 |
| `list_databases` | 查看数据库列表 |
| `list_tables` | 查看表列表 |
| `describe_table` | 查看字段、索引、主键、注释 |
| `sample_rows` | 拉取脱敏样本 |
| `execute_readonly_sql` | 只读执行入口 |
| `explain_sql` | explain 与风险解释 |
| `get_query_status` | 查询状态 |
| `cancel_query` | 取消查询 |
| `execute_sql` | 写 SQL 入口，默认关闭 |

**验收**

- 每个 Tool 都通过统一 envelope 输出
- `execute_sql` 只在 `enableMutations=true` 时暴露
- MCP 日志全部走 stderr，不污染 stdout 协议流

## Phase 5 — 审计、可观测性与运行时打磨

**目标**：把 MCP 形态作为稳定交付物，而不是 demo server。

**做什么**

- 打通 audit log、query tracker、cancel path、timeout path
- 确认 confirmation token 的签发、校验、过期、一次性使用语义
- 梳理配置诊断日志与 redaction
- 补全客户端 `init` 的跨平台路径适配

**验收**

- 长查询可查询状态、可取消
- token 模式具备完整测试覆盖
- `init` 不会覆盖用户已有配置，而是合并写入

## Phase 6 — 测试、发布与迁移收尾

**目标**：完成从单包到 `core + mcp` 的对外交付切换。

**做什么**

- 补齐 `core` 单测、`mcp` 集成测试、端到端 smoke test
- 更新 README、examples、客户端接入文档
- 确认 npm 包名、bin 名、版本策略
- 移除临时桥接代码

**验收**

- 新结构下 `npx @huaweicloud/taurusdb-mcp` 可直接运行
- 文档中的目录结构、命令、文件名全部与仓库一致
- 不再依赖根 `src/` 的兼容路径

---

## 6. 关键设计决策

### 6.1 先抽 `engine`，再谈多前端

如果没有统一的 `TaurusDBEngine`，CLI 接入只会复制 MCP 现有拼装逻辑。那不是复用，而是第二份技术债。

### 6.2 `ConfirmationStrategy` 必须在 core 层抽象

这是 MCP 和 CLI 最大的交互差异点：

- MCP 需要 token 两阶段确认
- CLI 需要终端交互确认

但两者依赖的是同一份风险判定。因此策略接口必须在 core，具体实现可以分属不同前端。

### 6.3 Tool 层只做协议映射

MCP 不应再直接关心：

- SQL 分类规则
- schema 感知校验
- 结果裁剪
- 审计事件内容

这些都属于 `core`，否则 CLI 无法真正共享。

### 6.4 迁移期间允许桥接，不允许双写业务逻辑

短期内可以接受 `packages/mcp` 对旧模块做桥接引用；不能接受的是新旧各维护一套 guardrail / executor / schema 逻辑。

---

## 7. 测试策略

### 7.1 Core 层

- SQL normalizer / parser / classifier / validator
- confirmation store 与 token 生命周期
- datasource resolver、profile loader、secret resolver
- schema cache、schema introspector、result redaction
- query tracker、executor、cancel path、timeout path

### 7.2 MCP 层

- Tool schema 与注册行为
- envelope 稳定性
- MCP 错误映射
- `init` 的客户端配置合并逻辑
- stdout/stderr 边界

### 7.3 集成链路

- 真实 MySQL 或 testcontainer 的 schema 探查链路
- 只读 SQL 执行链路
- 写 SQL 的 token 确认链路
- 查询状态与取消链路

---

## 8. 完成标准

满足以下条件，MCP 计划视为完成：

- 仓库中已形成清晰的 `core` 与 `mcp` 包边界
- MCP Tool 不再直接依赖底层业务模块，而是只依赖 `TaurusDBEngine`
- 现有 MCP 入口、安装方式和主要 Tool 行为保持稳定
- 文档、示例、测试、发布脚本都已切换到新结构
- CLI 可以在不复制 MCP 逻辑的前提下开始接入

---

## 9. 与 CLI 计划的衔接点

CLI 可以在以下里程碑之后启动：

- Phase 2 完成后，可以开始依赖 `TaurusDBEngine` 设计 CLI 命令面
- Phase 3 完成后，可以开始真正依赖 `packages/core`
- Phase 4 完成后，可以复用成熟的 guardrail / executor / context 契约

因此，MCP 计划的本质不是“先做 MCP 再做 CLI”，而是**先把共享内核从 MCP 代码里抽出来，再让两个前端各自变薄**。
