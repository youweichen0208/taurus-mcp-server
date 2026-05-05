# 华为云 TaurusDB CLI — MCP 协同型实施计划

> 本文档聚焦 `@huaweicloud/taurusdb-cli` 如何与 `@huaweicloud/taurusdb-mcp` 协同，而不是重复实现一套数据库命令行客户端。
>
> 配套阅读：
>
> - [`architecture.md`](./architecture.md)
> - [`taurusdb-mcp-implementation-plan.md`](./taurusdb-mcp-implementation-plan.md)

---

## 1. 新定位

CLI 不做第二套 MCP Tool，不做第二套数据库客户端。

更合理的定位是：

```text
CLI = MCP companion
```

也就是：

- 帮用户安装、配置、验证 MCP Server
- 帮开发者调试 MCP Tool 输入输出
- 帮测试和 CI 复跑 MCP smoke / cloud validate
- 帮运维把常见 MCP 调用链包装成 runbook
- 帮 AI 客户端准备 profile、schema context、诊断证据包

数据面事实仍由 `core` 和 `mcp` 产生。CLI 负责本地操作体验和工程化闭环。

## 2. 为什么改方向

上一版 CLI 设计已经避免了直接复刻 MCP Tool 名称，但仍然会逐步变成第二个数据面前端：

- `taurusdb sql run`
- `taurusdb sql explain`
- `taurusdb diagnose latency`
- `taurusdb taurus flashback`

这些命令虽然更适合人类，但会带来三个问题：

- 行为重复：同一件事 MCP 能做，CLI 也能做，测试矩阵变大。
- 入口竞争：用户不知道该用 AI 客户端还是 CLI 做诊断。
- 演进分叉：MCP Tool 增强后，CLI 还要同步包装和输出。

协同型 CLI 的目标是避免这些问题：CLI 不再抢 MCP 的数据面入口，而是让 MCP 更容易被安装、验证、调试、复用和自动化。

## 3. 三层边界

| 层 | 责任 | 不做什么 |
| --- | --- | --- |
| `core` | 数据面能力、guardrail、执行、diagnostics、capability probe | 不感知 MCP/CLI |
| `mcp` | AI 客户端可调用的 Tool 面、schema、envelope、stdio server | 不做终端交互和本地配置向导 |
| `cli` | MCP companion：配置、验证、启动、调试、runbook、CI | 不重新实现一套 SQL/diagnose 命令 |

关键原则：

- 数据面行为以 MCP Tool 为主入口。
- CLI 若需要执行数据面动作，应优先通过 MCP 协议调用本地 MCP Server，而不是直接调用 `TaurusDBEngine`。
- CLI 可以直接读写本地配置、检查文件、检查环境变量、校验云凭证，因为这些不是数据面业务逻辑。

## 4. 推荐命令树

```text
taurusdb
├── init
├── config
│   ├── doctor
│   ├── show
│   ├── profiles
│   └── write-profile
├── mcp
│   ├── serve
│   ├── inspect
│   ├── tools
│   ├── call
│   └── smoke
├── cloud
│   ├── validate
│   └── instances
├── runbook
│   ├── latency
│   ├── locks
│   ├── connections
│   ├── slow-query
│   ├── storage
│   └── replication
└── context
    ├── snapshot
    ├── schema
    └── export
```

### 4.1 `init`

`init` 是面向首次使用者的入口，不只是写 MCP client config。

建议能力：

- 选择 AI 客户端：Claude / Cursor / VS Code
- 写入 MCP client 配置
- 生成 datasource profile 模板
- 提示需要的只读账号、mutation 账号、Cloud Eye / DAS evidence 配置
- 可选执行一次 `mcp smoke`

示例：

```text
taurusdb init --client cursor
taurusdb init --client claude --profile prod-ro
```

与现有 MCP 包关系：

- `@huaweicloud/taurusdb-mcp init` 可以保留为最小 init。
- `@huaweicloud/taurusdb-cli init` 做更完整的交互式/脚本式 onboarding。

### 4.2 `config`

`config` 管理本地配置和环境自检，不触发真实业务查询。

| 命令 | 作用 |
| --- | --- |
| `taurusdb config doctor` | 检查 Node 版本、MCP 包、profile 文件、环境变量、权限提示 |
| `taurusdb config show` | 打印脱敏后的有效配置 |
| `taurusdb config profiles` | 列出 datasource profiles |
| `taurusdb config write-profile` | 写入或更新 datasource profile |

这里的 `doctor` 是配置/环境 doctor，不是数据库故障诊断 doctor。

### 4.3 `mcp`

`mcp` 分组是 CLI 与 MCP 协同的核心。

| 命令 | 作用 |
| --- | --- |
| `taurusdb mcp serve` | 启动 MCP Server，等价于当前 MCP 包主入口 |
| `taurusdb mcp inspect` | 打印 server 版本、配置摘要、默认 datasource、capability probe 摘要 |
| `taurusdb mcp tools` | 列出当前实际注册的 MCP Tools |
| `taurusdb mcp call TOOL --input file.json` | 通过 MCP 协议调用一个 Tool，用于调试和 CI |
| `taurusdb mcp smoke` | 跑最小 MCP smoke：启动、tools/list、ping、可选 datasource probe |

重要点：

- `mcp call` 是调试入口，不是推荐给 DBA 的日常 SQL 命令。
- 它应该复用 MCP Tool schema 和 response envelope，避免 CLI 重新定义一套输入输出。
- 这能让“命令行自动化”也验证真实 MCP 行为，而不是绕过 MCP 只测 core。

示例：

```text
taurusdb mcp tools --json
taurusdb mcp call diagnose_service_latency --input latency.json
taurusdb mcp smoke --profile prod-ro
```

### 4.4 `cloud`

`cloud` 只处理云侧证据源连通性，不做完整云资源管理。

| 命令 | 作用 |
| --- | --- |
| `taurusdb cloud validate` | 复用现有 `scripts/cloud-taurusdb-validate.mjs` 的能力 |
| `taurusdb cloud instances` | 列出可解析的 TaurusDB 实例，用于绑定 datasource 与 instance_id |

边界：

- 可以验证 IAM / project / instance / node / CES 指标源。
- 不做创建实例、修改参数、备份恢复等控制面操作。

### 4.5 `runbook`

`runbook` 是“人类任务入口”，但它通过 MCP Tool 编排完成，而不是直接调用 core。

| 命令 | 背后 MCP 调用链 |
| --- | --- |
| `taurusdb runbook latency` | `diagnose_service_latency` -> next tool inputs |
| `taurusdb runbook locks` | `diagnose_lock_contention` + `show_processlist` |
| `taurusdb runbook connections` | `diagnose_connection_spike` + `show_processlist` |
| `taurusdb runbook slow-query` | `find_top_slow_sql` / `diagnose_slow_query` |
| `taurusdb runbook storage` | `diagnose_storage_pressure` |
| `taurusdb runbook replication` | `diagnose_replication_lag` |

runbook 的价值不是新能力，而是：

- 固定排障顺序
- 合并 MCP Tool 输出
- 翻译 `next_tool_inputs` 为后续 MCP call 或 AI 客户端提示
- 生成一份可分享的诊断报告

示例：

```text
taurusdb runbook latency --since 15m --profile prod-ro --report latency.md
```

默认输出建议包含：

- 本次调用了哪些 MCP Tool
- 每个 Tool 的 status / severity
- 关键证据摘要
- 建议下一步
- 可粘贴给 AI 客户端继续分析的上下文片段

### 4.6 `context`

`context` 用于把数据库现场整理成 AI 客户端可消费的上下文，而不是直接执行诊断。

| 命令 | 作用 |
| --- | --- |
| `taurusdb context snapshot` | 生成 datasource、实例、capability、schema 摘要 |
| `taurusdb context schema` | 导出指定库/表的 schema context |
| `taurusdb context export` | 导出最近一次 runbook / smoke / cloud validate 的证据包 |

用途：

- 给 Cursor / Claude 一个干净的上下文包
- 给测试报告附加环境摘要
- 给 issue / 工单附加脱敏诊断证据

## 5. MCP 调用策略

CLI 与 MCP 协同有两种实现方式。

### 5.1 首选：嵌入式 stdio MCP client

CLI 启动本地 MCP Server 子进程，通过 MCP stdio 协议调用 tools。

优点：

- 测到真实 MCP 注册、schema、handler、envelope
- 不需要用户提前启动服务
- 命令行和 AI 客户端看到的行为一致

适用命令：

- `mcp tools`
- `mcp call`
- `mcp smoke`
- `runbook *`
- `context snapshot`

### 5.2 备选：直连 core

只在明确不属于 MCP 数据面时直连本地模块，例如：

- 读取配置
- 写 profile 模板
- 检查文件路径
- 检查 Node/npm 包版本

不建议直连 core 执行：

- SQL
- explain
- flashback
- diagnose
- mutation

这些应通过 MCP Tool 走同一条路径。

## 6. 与 MCP 的包关系

推荐两种发布方式二选一。

### 方案 A：独立 CLI 包

```text
@huaweicloud/taurusdb-mcp
@huaweicloud/taurusdb-cli
```

优点：

- 包边界清晰
- AI 客户端只安装 MCP 包也能工作
- CLI 可以有更多本地交互依赖

### 方案 B：MCP 包内置 companion CLI

```text
npx @huaweicloud/taurusdb-mcp serve
npx @huaweicloud/taurusdb-mcp init
npx @huaweicloud/taurusdb-mcp smoke
npx @huaweicloud/taurusdb-mcp call ...
```

优点：

- 用户只装一个包
- 版本天然一致
- 初期实现和发布成本低

当前仓库已经有 `packages/cli` scaffold，因此建议保留独立 CLI 包，但让它依赖并驱动 MCP 包，而不是复制 MCP 业务逻辑。

## 7. 输出设计

CLI 输出分三类。

### 7.1 Human

默认输出给人看：

- 配置检查结果
- smoke 步骤
- runbook 摘要
- 下一步建议

### 7.2 JSON

`--json` 输出稳定结构，适合 CI。

```typescript
type CliEnvelope<T> = {
  ok: boolean;
  command: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  mcp?: {
    server_version?: string;
    tools_called?: string[];
  };
};
```

### 7.3 Report

runbook 和 context 命令可以输出 Markdown 报告：

```text
--report latency.md
--report-format markdown
```

报告必须默认脱敏，并标注证据来源。

## 8. Exit Code

| Code | 含义 |
| --- | --- |
| `0` | 命令执行成功 |
| `1` | 一般错误 |
| `2` | 参数错误 |
| `3` | 配置缺失或无效 |
| `4` | MCP Server 启动失败 |
| `5` | MCP Tool 调用失败 |
| `6` | 云侧证据源验证失败 |
| `7` | smoke / runbook 发现阻塞性环境问题 |

runbook 发现数据库风险时不一定返回非零；非零应表示命令或环境失败。

## 9. 建议目录结构

```text
packages/cli/src/
├── index.ts
├── args/
│   ├── parse.ts
│   └── usage.ts
├── commands/
│   ├── init.ts
│   ├── config.ts
│   ├── mcp.ts
│   ├── cloud.ts
│   ├── runbook.ts
│   └── context.ts
├── mcp-client/
│   ├── stdio.ts
│   ├── tools.ts
│   └── call.ts
├── reports/
│   ├── markdown.ts
│   └── redaction.ts
├── formatters/
│   ├── human.ts
│   └── json.ts
├── errors.ts
└── exit-codes.ts
```

目录上不再出现 `sql.ts`、`diagnose.ts`、`taurus.ts` 这类第二数据面前端文件；这些能力通过 `mcp call` 和 `runbook` 间接使用。

## 10. 分阶段实施

### C0: Companion 骨架

- CLI 参数解析与 help
- `config show`
- `config doctor`
- `mcp serve`
- `mcp tools`

### C1: MCP 调试闭环

- 嵌入式 stdio MCP client
- `mcp call`
- `mcp smoke`
- JSON 输出
- CI 可用 exit code

### C2: Cloud / Evidence 验证

- `cloud validate`
- `cloud instances`
- 与现有 `npm run cloud:validate` 能力收口

### C3: Runbook

- `runbook latency`
- `runbook locks`
- `runbook connections`
- Markdown report
- 将 MCP `next_tool_inputs` 转成后续 `mcp call` 或 AI 客户端提示

### C4: Context Export

- `context snapshot`
- `context schema`
- `context export`
- 脱敏报告与工单附件

## 11. 第一阶段明确不做

- 独立 SQL 客户端：`taurusdb sql run`
- 独立诊断客户端：`taurusdb diagnose latency`
- 独立 TaurusDB 功能客户端：`taurusdb taurus flashback`
- REPL
- AI `ask` / `agent`
- 完整云控制面资源管理
- history / binlog / audit 闭环

这些能力都应优先沉淀在 MCP Tool 或 runbook 编排里。

## 12. 完成标准

满足以下条件，可认为 CLI 第一阶段成立：

- CLI 能初始化和验证 MCP 使用环境
- CLI 能列出真实 MCP Tool，而不是维护自己的工具清单
- CLI 能通过 MCP 协议调用 Tool，用于调试和 CI
- CLI smoke 覆盖 MCP 启动、tools/list、ping、可选 datasource probe
- runbook 能编排 MCP Tool 并输出人类可读报告
- 文档不再把 CLI 描述成第二套 SQL / diagnose / TaurusDB 命令客户端

## 13. 后续阶段

后续再考虑：

1. 与 AI 客户端的更深集成，例如生成可粘贴 prompt / context bundle
2. 远程 MCP Server 调试
3. runbook 模板扩展
4. 交互式 TUI
5. AI `ask` / `agent`
