# 华为云 TaurusDB 数据面 CLI — 实施计划

> 本文档聚焦 `@huaweicloud/taurusdb-cli` 的实施路线。
>
> 配套阅读：
>
> - [`architecture.md`](./architecture.md) — 目标架构、包边界、能力映射
> - [`taurusdb-mcp-implementation-plan.md`](./taurusdb-mcp-implementation-plan.md) — `core + mcp` 的重构计划

---

## 1. 文档定位

CLI 不是把 MCP Server 再套一层壳，而是一个**面向人类终端操作**的新前端。它和 MCP 的共享点在 `core`，不在协议层。

这份计划解决三个问题：

- CLI 依赖 `core` 的哪些能力才能成立
- CLI 自己独有的命令面、交互面、AI 面如何设计
- 如何避免为了做 CLI 再复制一套 schema / guardrail / executor 逻辑

### 1.1 范围

本计划覆盖：

- `packages/cli` 的包结构和命令面设计
- 命令模式、REPL、AI ask、AI agent、doctor、init
- 终端输出、交互确认、LLM provider 抽象
- CLI 与 `core` 的依赖边界

本计划不覆盖：

- MCP Tool 层实现细节
- 云管控面实例发现的二期设计
- Web UI 或长期驻留 daemon

### 1.2 CLI 的目标定位

CLI 面向三类用户：

- DBA / 运维：需要可控执行、清晰输出、可脚本化
- 开发者：需要快速查表、执行 explain、查看 schema
- AI 辅助用户：希望在终端里直接 ask / agent，而不是先开 MCP 客户端

它需要同时支持三种工作模式：

| 模式 | 主体 | 典型场景 |
| --- | --- | --- |
| 命令模式 | 人 | `query`、`describe`、`explain`、`exec` |
| REPL 模式 | 人 | 长会话、反复探索、上下文切换 |
| Agent 模式 | 人 + LLM | 自然语言问答、逐步生成并执行 SQL |

---

## 2. 对 Shared Core 的依赖

CLI 必须建立在 MCP 计划中抽出的 `TaurusDBEngine` 之上。没有这一步，CLI 只会把当前单包实现复制一份。

### 2.1 CLI 需要的核心能力

| Core 能力 | CLI 用途 |
| --- | --- |
| `listDataSources` | `sources`、`doctor` |
| `resolveContext` | 所有命令的上下文解析 |
| `listDatabases` / `listTables` | `databases`、`tables` |
| `describeTable` / `sampleRows` | `describe`、`sample`、AI schema 上下文 |
| `inspectSql` | `query`、`exec`、`ask`、`agent` 的安全入口 |
| `explain` | `explain`、AI 风险解释 |
| `executeReadonly` | `query`、REPL 读操作 |
| `executeMutation` | `exec`、Agent 写操作 |
| `getQueryStatus` / `cancelQuery` | `status`、`cancel` |
| `ConfirmationStrategy` | 终端交互确认 |

### 2.2 CLI 需要但不属于 Core 的能力

这些能力必须放在 `packages/cli`，不能塞回 `core`：

- 终端 prompt、spinner、表格、颜色、高亮
- 参数解析与命令分发
- REPL 历史、补全、会话状态
- LLM provider 抽象与多轮 agent loop
- 人类可读输出、JSON/CSV 输出、退出码规范

### 2.3 前置里程碑

CLI 开发至少依赖 MCP 计划中的以下里程碑：

- `Phase 2`：`TaurusDBEngine` API 收口完成
- `Phase 3`：共享模块已迁移到 `packages/core`
- `Phase 4`：guardrail / confirmation / executor 的契约稳定

在这之前，可以先做 CLI 原型；不建议进入大规模实现。

---

## 3. 目标产物

CLI 最终交付为 `@huaweicloud/taurusdb-cli` 包，二进制名建议为 `taurusdb`。

建议目录结构如下：

```text
packages/cli/
├── src/
│   ├── index.ts
│   ├── bootstrap.ts
│   ├── commands/
│   ├── agent/
│   ├── repl/
│   ├── ui/
│   └── formatter/
├── tests/
└── package.json
```

### 3.1 建议命令面

| 命令 | 作用 |
| --- | --- |
| `taurusdb sources` | 查看可用数据源 |
| `taurusdb databases` | 查看数据库列表 |
| `taurusdb tables` | 查看表列表 |
| `taurusdb describe <table>` | 查看表结构 |
| `taurusdb sample <table>` | 查看脱敏样本 |
| `taurusdb query "<sql>"` | 执行只读 SQL |
| `taurusdb exec "<sql>"` | 执行写 SQL |
| `taurusdb explain "<sql>"` | 查看执行计划与风险 |
| `taurusdb status <query_id>` | 查看查询状态 |
| `taurusdb cancel <query_id>` | 取消运行中查询 |
| `taurusdb repl` | 打开交互式 REPL |
| `taurusdb ask "<question>"` | 单次 AI 辅助 |
| `taurusdb agent` | 多轮 AI Agent 会话 |
| `taurusdb doctor` | 环境、配置、连接诊断 |
| `taurusdb init` | 初始化本地配置 |

### 3.2 统一 flags

建议所有命令尽量复用统一参数：

```text
--datasource <name>
--database <name>
--schema <name>
--format <table|json|csv>
--max-rows <n>
--timeout <ms>
--config <path>
--no-color
--quiet
```

---

## 4. CLI 特有设计

### 4.1 命令模式

命令模式的设计目标是“稳”和“可脚本化”。

约束：

- 默认输出对人类友好
- `--format json` 必须稳定，便于管道消费
- 失败时退出码可预测，不用解析文案判断
- 命令本身不直接处理底层模块，只调用 `engine`

### 4.2 REPL 模式

REPL 的设计目标是“长会话效率”，而不是模拟完整数据库客户端。

首版建议支持：

- 当前 datasource/database 提示
- `\use <database>` 切换上下文
- `\tables`、`\describe <table>` 这种快捷元命令
- 历史记录与 tab 补全
- 多行 SQL 输入
- 只读与写操作共用同一套 guardrail

不建议首版支持：

- 复杂宏系统
- 脚本语言扩展
- 远程会话共享

### 4.3 AI Ask / Agent 模式

CLI 的 AI 能力是它相对 MCP 的新增价值，但必须建立在明确边界上：

- LLM 负责自然语言理解和工具编排
- `core` 负责 schema、guardrail、execution
- CLI 负责会话循环、输出、确认和 provider 适配

首版建议拆成两个入口：

| 入口 | 定位 |
| --- | --- |
| `ask` | 单轮任务，适合快速问答 |
| `agent` | 多轮会话，适合逐步探索或执行复杂任务 |

### 4.4 交互确认

CLI 与 MCP 最大差异在确认模式：

- MCP：token 二阶段确认
- CLI：终端 prompt `[y/N]`

但风控规则必须一致。因此 CLI 应在 `packages/cli` 提供 `InteractiveConfirmationStrategy`，并注入给 `core` 使用。

### 4.5 输出格式

建议提供三类 formatter：

| 输出格式 | 用途 |
| --- | --- |
| `table` | 默认人类可读输出 |
| `json` | 机器消费 / 调试 |
| `csv` | 导出和简单分析 |

约束：

- `table` 输出允许裁剪，但必须显式提示截断
- `json` 输出字段名和结构要稳定
- `csv` 只适合结果集型命令，不适合错误 envelope

---

## 5. 分阶段实施

## Phase C0 — CLI 包脚手架与依赖准备

**目标**：让 CLI 作为独立包存在，但先不追求功能完整。

**做什么**

- 创建 `packages/cli/package.json`、`src/index.ts`、`src/bootstrap.ts`
- 选定命令框架和终端交互库
- 明确 `cli -> core` 的依赖方式
- 定义统一配置读取与 logger 注入方式

**验收**

- `taurusdb --version` 可执行
- CLI 可以创建 `engine` 并完成一次最小 health check

## Phase C1 — 只读命令面落地

**目标**：先完成无需 AI、无需复杂状态的命令面。

**做什么**

- 实现 `sources`、`databases`、`tables`、`describe`、`sample`
- 实现 `query`、`explain`
- 实现 table/json/csv formatter
- 为 `resolveContext`、输出格式、错误展示补测试

**验收**

- 常见查表链路可用
- `query` 只允许只读 SQL
- `--format json` 结果稳定

## Phase C2 — 写操作与查询生命周期命令

**目标**：补齐受控写操作和长查询控制。

**做什么**

- 实现 `exec` 命令
- 实现 `status`、`cancel`
- 落地 `InteractiveConfirmationStrategy`
- 统一 `exec` 与 `query` 的 guardrail 文案展示

**验收**

- `exec` 在高风险写操作前会展示 SQL、风险与确认提示
- `status` 和 `cancel` 可复用 core 的 query tracker
- 用户拒绝确认时退出码清晰

## Phase C3 — REPL 会话层

**目标**：提供高频探索场景下的会话式终端体验。

**做什么**

- 实现 REPL session、history、completer
- 加入元命令，如 `\use`、`\tables`、`\describe`
- 支持多行 SQL 和上下文提示
- 在 REPL 中复用命令模式的 formatter 和 guardrail

**验收**

- 用户可以在一个会话里持续切库、查表、执行 SQL
- 历史和补全可用，不破坏普通命令模式

## Phase C4 — AI Ask 模式

**目标**：提供最小可用的单次 AI 辅助能力。

**做什么**

- 定义 `LlmClient` 抽象
- 落地至少一个 provider 适配器
- 实现 `ask` 单轮 tool-calling 流程
- 在 ask 模式中把 schema / query / explain / exec 统一暴露为本地工具

**验收**

- `taurusdb ask "最近 7 天订单趋势"` 能走完整工具链路
- 涉及写 SQL 时仍走 CLI 确认流程
- LLM 错误、超时、配置缺失有可解释提示

## Phase C5 — AI Agent 模式

**目标**：在 ask 之上扩展为多轮会话与上下文保留。

**做什么**

- 实现 agent loop、会话历史、工具调用上限
- 支持用户中途打断、继续、退出
- 明确 prompt 策略和系统约束
- 控制结果回灌和敏感信息暴露边界

**验收**

- `taurusdb agent` 可进行多轮探索
- 工具调用可追踪，执行风险可见
- 不因长会话破坏 guardrail 和确认语义

## Phase C6 — Doctor / Init / 发布收尾

**目标**：把 CLI 从可用原型打磨为可交付工具。

**做什么**

- 实现 `doctor`：检查配置、profile、连接、LLM provider 配置
- 实现 `init`：写本地配置模板，可选初始化 MCP 客户端配置
- 梳理退出码、帮助文案、examples、README
- 完成 npm 包发布与安装验证

**验收**

- CLI 能独立安装和运行
- `doctor` 能定位最常见的环境问题
- 文档中的命令与真实行为一致

---

## 6. 包结构建议

```text
packages/cli/src/
├── index.ts
├── bootstrap.ts
├── commands/
│   ├── sources.ts
│   ├── databases.ts
│   ├── tables.ts
│   ├── describe.ts
│   ├── sample.ts
│   ├── query.ts
│   ├── exec.ts
│   ├── explain.ts
│   ├── status.ts
│   ├── cancel.ts
│   ├── repl.ts
│   ├── ask.ts
│   ├── agent.ts
│   ├── doctor.ts
│   └── init.ts
├── agent/
│   ├── llm-client.ts
│   ├── agent-loop.ts
│   ├── tool-schema.ts
│   └── providers/
├── repl/
│   ├── session.ts
│   ├── completer.ts
│   └── history.ts
├── ui/
│   ├── prompt.ts
│   ├── table.ts
│   ├── spinner.ts
│   └── highlight.ts
└── formatter/
    ├── human.ts
    ├── json.ts
    └── csv.ts
```

原则：

- `commands/` 只做入口分发和参数整合
- `agent/` 只做 LLM 编排
- `ui/` 只做终端呈现
- 所有真正的业务执行都回到 `core`

---

## 7. 关键设计决策

### 7.1 CLI 不通过本地 MCP Server 自己调用自己

CLI 已经和 `core` 同仓，直接依赖 SDK 更简单、可测试、延迟更低。再起一个本地 MCP Server 只会增加一层协议复杂度。

### 7.2 交互体验优先，但不能牺牲脚本化

这意味着：

- 默认输出可以友好
- 但必须始终存在稳定的 `--format json`
- 交互行为不能污染非交互模式

### 7.3 LLM Provider 抽象必须足够薄

CLI 需要支持多 provider，但不要把 provider SDK 的差异扩散到命令层。命令层只应知道：

- 如何发送消息
- 如何声明工具
- 如何处理 tool call / final answer

### 7.4 Ask 与 Agent 共享工具集，不共享所有会话策略

二者底层都应复用相同的本地工具定义；区别在于：

- `ask` 偏一次性完成
- `agent` 偏多轮和状态保留

---

## 8. 测试策略

### 8.1 命令层

- 参数解析
- 退出码
- formatter 输出
- 错误展示

### 8.2 REPL 层

- history 持久化
- 补全行为
- 元命令解析
- 多行输入处理

### 8.3 AI 层

- provider mock
- tool-calling loop
- guardrail / confirmation 协同
- LLM 超时、空响应、非法 tool call

### 8.4 集成层

- 与 `core` 的 query / exec / explain 联调
- `doctor` 的配置探测
- `init` 的配置落盘

---

## 9. 完成标准

满足以下条件，CLI 计划视为完成：

- `packages/cli` 已作为独立包存在并可发布
- 主要命令面、REPL、ask、agent 都建立在同一份 `core` 能力上
- CLI 不复制 MCP 的业务逻辑，只复用 `TaurusDBEngine`
- 交互确认、输出格式、退出码、诊断体验都已收敛
- 文档、示例、测试覆盖与命令面保持一致

---

## 10. 与 MCP 计划的关系

这两份计划不是并列重复，而是前后衔接：

- MCP 计划负责把共享能力从当前单包仓库里抽出来
- CLI 计划负责在共享能力之上新增一个人类终端前端

如果 MCP 计划没有先完成 `core` 收口，CLI 的实现成本会显著升高，并且最终会形成第二套拼装逻辑。这是需要明确避免的。
