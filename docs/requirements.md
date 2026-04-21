# 华为云 TaurusDB 数据面工具 — 需求背景与范围定义

本文档聚焦 4 件事：需求背景、产品定位、当前首阶段范围、验收边界。

更细的包边界、模块职责和实施路线，继续参考：

- [`architecture.md`](./architecture.md)
- [`taurusdb-mcp-implementation-plan.md`](./taurusdb-mcp-implementation-plan.md)
- [`taurusdb-cli-implementation.md`](./taurusdb-cli-implementation.md)

---

## 1. 需求背景

### 1.1 为什么首版必须优先做数据面

TaurusDB 的传统能力更容易先联想到管控面：

- 查实例状态
- 查备份和参数
- 看日志和告警
- 触发运维动作

但这次产品方向不是“再做一个数据库版云控制台”，而是让 AI 和终端用户可以在**受控边界内真正进入数据库会话**，围绕业务数据完成：

- schema 探查
- 只读查询
- explain 分析
- 受控 SQL 执行

原因很直接：

- 用户的高频问题通常是业务数据问题，不是资源元数据问题
- 管控面 API 无法回答“昨天支付成功订单多少”这类问题
- 仅暴露 OpenAPI 不能覆盖“看 schema -> 生成 SQL -> 校验风险 -> 执行 -> 返回结果”的完整链路
- 完全开放自由 SQL 又会带来误改数据、慢查询、敏感数据暴露和审计缺失的风险

结论：首版需要的是一个**以 SQL 为中心、以安全闸门为边界、以自然语言或命令为入口**的数据面工具体系。

但从客户高频场景看，光“能执行 SQL”还不够。下一阶段需要新增一条 **诊断线**，让系统可以围绕高频故障场景做联合分析：

- CPU 打满
- 连接数暴涨
- 锁等待 / 死锁 / DDL 卡住
- 主从延迟
- 存储 / IOPS / 吞吐压力

这类问题天然需要 **管控面指标 + TaurusDB 内核状态 + SQL 现场** 一起看，单靠执行 SQL 解决不了。

### 1.2 要解决的核心问题

| 问题                     | 现状痛点               | 首版解法                                   |
| ------------------------ | ---------------------- | ------------------------------------------ |
| AI 不知道库里有什么      | 缺少稳定 schema 上下文 | 提供结构化 schema / sample 工具            |
| 自然语言不能稳定落到 SQL | 只会停留在解释层       | 让 AI 或 CLI 先拿 schema，再生成 SQL       |
| SQL 执行风险过高         | 自由执行容易误写或慢扫 | 引入 guardrail、确认流、超时、结果裁剪     |
| 长查询无法追踪           | 执行后不透明           | 提供 `query_id`、状态查询、取消能力        |
| 数据访问不可审计         | 缺少统一链路标识       | 统一记录 `task_id`、`query_id`、`sql_hash` |

---

## 2. 产品定位

### 2.1 产品形态

本项目不是单一 MCP Server，而是一套围绕 TaurusDB 数据面的工具体系，分两种交付形态：

| 形态 | 面向对象 | 主交互方式 | 主要价值 |
| --- | --- | --- | --- |
| MCP Server | Claude Desktop、Cursor、VS Code 等 AI 客户端 | MCP Tool 调用 | 让外部模型安全访问 TaurusDB 数据面 |
| CLI | DBA、开发者、支持、运维 | 第一阶段先做命令模式 | 让人直接在终端上完成同类数据面操作 |

两种形态共享同一套 `core` 业务能力，只在协议层和交互层不同。当前真正已落地的是 `core + mcp`，CLI 仍处于待实现阶段。

### 2.2 首版产品定义

当前首阶段将项目定义为：

- 一个 TaurusDB 数据面的安全执行与治理层
- 一个面向 AI 客户端和终端用户的 schema + SQL 能力层
- 一个围绕 shared `core` 组织的多前端工具项目
- 一套优先暴露 TaurusDB 差异化能力的数据面 Tool，而不是泛化的“数据库 AI 平台”

### 2.3 当前仓库状态

当前仓库已经完成了 `core + mcp` 的第一轮拆分，当前状态是：

- `packages/core` 已承接共享模块与 `TaurusDBEngine`
- `packages/mcp` 已承接 MCP 启动、Tool 注册和 `init`
- `packages/cli` 仍未实现，属于下一阶段工作

因此当前阶段的真实工程目标是：

1. 继续压实 `core` 与 `mcp` 的包边界
2. 在不复制业务逻辑的前提下实现 `packages/cli`

---

## 3. 目标用户

| 用户角色              | 主要诉求                             | 典型问题                             |
| --------------------- | ------------------------------------ | ------------------------------------ |
| 开发者                | 快速拿到业务数据，不想反复手写 SQL   | “查最近 1 小时创建失败的订单”        |
| 数据分析 / 产品       | 用自然语言拿到结果、结构和样本       | “按城市统计本周新增用户”             |
| DBA                   | 在安全边界内 explain、审核、执行 SQL | “先 explain，再确认执行 update”      |
| 支持 / 售前           | 快速验证现场数据                     | “这个商户今天还有未结算记录吗”       |
| 运维 / 堡垒机场景用户 | 在受控环境执行数据库操作             | “我需要一个可审计、可取消的终端工具” |
| 一线支持 / 内核定位用户 | 快速判断故障根因并给出下一步动作     | “CPU 满了怎么定位？”“为什么主从延迟？” |

---

## 4. 设计目标与非目标

### 4.1 设计目标

| 目标           | 说明                                        |
| -------------- | ------------------------------------------- |
| 数据面优先     | 主链路围绕 schema、query、explain、受控执行 |
| 双前端共享内核 | MCP 和 CLI 共享 `core`，不复制业务逻辑      |
| 默认安全       | 默认只读，写 SQL 需显式开启与确认           |
| 结果可解释     | 除结果外，还要返回执行摘要、风险、截断信息  |
| 可审计         | 统一关联 `task_id`、`query_id`、`sql_hash`  |
| 部署可控       | 推荐靠近 TaurusDB 数据面的安全网络环境部署  |
| 诊断可落地     | 下一阶段支持高频故障的场景化联合诊断        |

### 4.2 非目标

首版不做以下内容：

- 不做“华为云全产品通用 MCP Server”
- 不做 BI 平台替代品，不负责复杂建模和可视化
- 不默认开放任意 DDL、权限类 SQL、破坏性 SQL
- 不把管控面运维动作放在主路径
- 不在首版强依赖跨数据源联邦查询
- 不要求 CLI 必须通过本地 MCP Server 才能工作
- 不在首版把“联合诊断层”一并做完

---

## 5. 功能范围

### 5.1 当前首阶段用户可见能力

| 编号 | 能力 | MCP | CLI | 优先级 |
| --- | --- | --- | --- | --- |
| F-01 | 数据源初始化与配置 | 是 | 目标支持 | P0 |
| F-02 | 数据源 / 数据库 / 表发现 | 是 | 目标支持 | P0 |
| F-03 | 表结构查看 | 是 | 目标支持 | P0 |
| F-04 | 样本数据预览 | 是 | 目标支持 | P0 |
| F-05 | 只读 SQL 执行 | 是 | 目标支持 | P0 |
| F-06 | SQL explain 与风险解释 | 是 | 目标支持 | P0 |
| F-07 | 查询状态跟踪与取消 | 是 | 目标支持 | P0 |
| F-08 | 受控写 SQL 执行 | 是 | 目标支持 | P0 |
| F-09 | TaurusDB 内核能力发现 | 是 | 目标支持 | P0 |
| F-10 | TaurusDB 增强 explain | 是 | 目标支持 | P0 |
| F-11 | TaurusDB flashback query | 是 | 目标支持 | P0 |

### 5.1.1 下一阶段诊断能力

| 编号 | 能力 | MCP | CLI | 优先级 |
| --- | --- | --- | --- | --- |
| D-01 | `diagnose_slow_query` | 规划 | 规划 | P1 |
| D-02 | `diagnose_connection_spike` | 规划 | 规划 | P1 |
| D-03 | `diagnose_lock_contention` | 规划 | 规划 | P1 |
| D-04 | `diagnose_replication_lag` | 规划 | 规划 | P1 |
| D-05 | `diagnose_storage_pressure` | 规划 | 规划 | P1 |

这 5 个能力建议统一满足：

- 默认只读
- 输出根因候选而不是原始指标堆砌
- 同时消费管控面指标、内核证据、SQL 现场
- 能给出下一步建议动作

### 5.2 Shared Core 能力

| 编号 | 模块 | 责任 |
| --- | --- | --- |
| S-01 | Config / Profile Loader | 多来源读取配置、数据源和凭证 |
| S-02 | Secret Resolver | 统一解析 secret 来源 |
| S-03 | Session Context Resolver | 解析 datasource / database / schema / limits |
| S-04 | Schema Introspector | 探查数据库、表、列、索引、样本 |
| S-05 | Minimal SQL Guardrail | SQL 解析、分类、最小规则校验、风险判定 |
| S-06 | Confirmation Store | token 签发与校验 |
| S-07 | SQL Executor | explain、执行、超时、状态追踪、取消 |
| S-08 | Result Redaction | 对敏感字段和大结果集做裁剪与脱敏 |
| S-09 | Capability Probe | TaurusDB 内核版本与 feature matrix |
| S-10 | Typed Errors / Result Types | 给 MCP 和 CLI 提供稳定业务契约 |

下一阶段建议新增：

| 编号 | 模块 | 责任 |
| --- | --- | --- |
| S-11 | Diagnostics Orchestrator | 场景化诊断编排、证据聚合、根因候选输出 |
| S-12 | Control-plane Adapter | CES / 实例元数据等指标接入 |
| S-13 | Data-plane Collectors | `processlist`、锁等待、复制状态、慢 SQL 等证据采集 |

### 5.3 前端专属能力

#### MCP 专属

- Tool schema 与描述文案
- MCP envelope
- `stdio` transport
- Claude / Cursor / VS Code 客户端 `init`

#### CLI 专属

- 命令解析与退出码
- 表格 / JSON / CSV 输出
- 终端确认包装
- 后续阶段再考虑 REPL / AI / doctor

---

## 6. 关键交互链路

### 6.1 MCP 主链路

```text
用户自然语言
→ AI 客户端选择 MCP Tool
→ 获取 schema / sample 上下文
→ 生成 SQL
→ core.guardrail 校验
→ 必要时签发 confirmation token
→ core.executor 在数据面执行
→ 返回结构化结果给模型
```

### 6.2 CLI 主链路（第一阶段目标）

```text
用户命令 / SQL
→ CLI 解析上下文
→ core.guardrail 校验
→ 必要时返回 confirmation token 并要求重试
→ core.executor 在数据面执行
→ CLI 格式化输出为 table / json / csv
```

---

## 7. 安全与约束

### 7.1 默认策略

| 场景 | 默认策略 |
| --- | --- |
| 只读 SQL | 允许，但受行数、列数、超时、敏感字段策略限制 |
| 写 SQL | 默认关闭，显式开启后仍需确认 |
| 多语句 | 阻断 |
| 权限类 SQL | 阻断 |
| `TRUNCATE` / `DROP DATABASE` | 阻断 |
| 无 `WHERE` 的 `UPDATE/DELETE` | 阻断 |
| `SELECT *` / 无 `LIMIT` 明细查询 | 中风险提示 + 结果截断 |

### 7.2 审计要求

每次关键调用至少应可关联：

- `task_id`
- `query_id`
- `sql_hash`
- datasource / database
- statement type
- guardrail decision
- execution outcome

### 7.3 数据暴露要求

无论 MCP 还是未来的 CLI AI 形态，结果都有可能流向 LLM，因此必须统一控制：

- 行数截断
- 列数截断
- 大字段截断
- 敏感字段脱敏
- 审计默认记录 hash，不强制记录原始 SQL

---

## 8. 当前阶段的工程约束

### 8.1 必须承认的现状

当前仓库已经存在 `packages/core` 和 `packages/mcp`，但 `packages/cli` 仍然只是脚手架入口。

### 8.2 当前阶段最重要的工作顺序

1. 稳定 `TaurusDBEngine` API
2. 稳定 minimal guardrail + token confirmation
3. 稳定 capability probe + 动态 Tool 注册
4. 再开始 CLI 命令模式实现

如果跳过这些步骤直接做 CLI 高阶形态，结果只会是复制一套 MCP 现有逻辑。

但在首阶段稳定之后，优先级最高的新增方向不应只是“多几个执行 SQL 的 Tool”，而应该是引入场景化诊断能力。

---

## 9. 验收边界

### 9.1 首版验收标准

首版发布前至少满足：

- schema 探查、只读查询、explain、状态查询和取消构成完整主链路
- 写 SQL 默认关闭，开启后必须经过 guardrail 和确认流程
- TaurusDB capability discovery、enhanced explain、flashback query 已落地
- MCP 与 CLI 的业务逻辑统一落在 shared `core`
- 至少 MCP 形态已能感知统一的 `task_id / query_id / sql_hash`
- 结果截断、敏感字段脱敏、超时和取消能力都已落地
- 文档清楚区分 README、requirements、architecture 和 implementation plan 的职责

### 9.2 测试重点

| 维度 | 核心验证点 |
| --- | --- |
| Core | SQL classifier、validator、executor、confirmation、redaction、capability probe |
| MCP | Tool schema、envelope、stdio 边界、`init` 配置写入、动态 Tool 注册 |
| CLI | 第一阶段只要求命令模式设计收口，不要求 REPL / AI 已实现 |
| Integration | schema 探查、只读执行、写 SQL 确认、查询取消、TaurusDB capability probe |

---

## 10. 文档分工

为了避免内容重复和边界混乱，文档职责固定如下：

- [`../README.md`](../README.md)：仓库入口、当前状态、快速开始、文档索引
- [`requirements.md`](./requirements.md)：需求背景、产品范围、验收边界
- [`architecture.md`](./architecture.md)：目标架构、包边界、核心抽象
- [`taurusdb-mcp-implementation-plan.md`](./taurusdb-mcp-implementation-plan.md)：`core + mcp` 重构路线
- [`taurusdb-cli-implementation.md`](./taurusdb-cli-implementation.md)：CLI 新前端落地路线
