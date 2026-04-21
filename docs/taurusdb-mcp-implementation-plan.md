# 华为云 TaurusDB 数据面 MCP Server — 实施计划

> 本文档聚焦 `@huaweicloud/taurusdb-mcp` 的当前实现方向与第一阶段范围。
>
> 配套阅读：
>
> - [`architecture.md`](./architecture.md)
> - [`taurusdb-cli-implementation.md`](./taurusdb-cli-implementation.md)

---

## 1. 文档定位

这份计划只回答三件事：

- `core` 和 `mcp` 的边界怎么收敛
- MCP 第一阶段到底交付什么
- 哪些设计明确延后，不再混进首版

它不是一份“大而全路线图”，而是一份围绕当前代码状态整理后的收敛版计划。

## 2. 当前状态

仓库已经完成 `core + mcp + cli` 的 package 切分，其中：

- `packages/core` 已承载共享数据面能力
- `packages/mcp` 已承载 MCP 协议层与动态 Tool 注册
- `packages/cli` 目前仍是脚手架入口，尚未进入真实实现阶段

MCP 当前已经具备：

- 通用 MySQL Tool 集合
- 最小 Guardrail + token confirmation
- TaurusDB capability probe
- 基于 probe 的动态 Tool 注册
- 4 个 TaurusDB 首阶段 Tool：
  - `get_kernel_info`
  - `list_taurus_features`
  - `explain_sql_enhanced`
  - `flashback_query`

下一阶段最值得新增的不是更多执行型 Tool，而是一组**场景化诊断 Tool**。

## 3. 第一阶段范围

第一阶段只保留三类能力：

1. 通用数据面能力
   `list_*`、`describe_table`、`sample_rows`、`execute_readonly_sql`、`execute_sql`、`explain_sql`、`status`、`cancel`

2. 最小安全模型
   AST 分类、tool scope 校验、静态阻断规则、token confirmation、结果裁剪/脱敏

3. TaurusDB 差异化能力
   capability discovery、enhanced explain、flashback query

第一阶段明确不做：

- `ConfirmationStrategy` 抽象
- schema cache / capability cache
- recycle bin Tool
- SQL history / Binlog / preflight / safety posture
- doctor 类诊断编排

但下一阶段建议正式引入一条 diagnostics 产品线，优先做：

- `diagnose_slow_query`
- `diagnose_connection_spike`
- `diagnose_lock_contention`
- `diagnose_replication_lag`
- `diagnose_storage_pressure`

这些 Tool 的验证边界建议在立项时就写清楚：

| Tool | 验证级别 | 说明 |
| --- | --- | --- |
| `diagnose_slow_query` | `local-verifiable` | 本地 MySQL 可验证 explain、慢 SQL、索引失配、临时表/排序等主要逻辑 |
| `diagnose_connection_spike` | `local-partial` | 本地可验证 `processlist`、线程/连接状态；CES 指标和云实例侧异常模式需上云 |
| `diagnose_lock_contention` | `local-verifiable` | 本地多会话即可复现锁等待、长事务、DDL 阻塞、死锁链路 |
| `diagnose_replication_lag` | `cloud-required` | 需要托管复制链路、只读节点或控制面延迟指标才能完整验证 |
| `diagnose_storage_pressure` | `local-partial` | 本地可验证临时表、filesort、扫描型 SQL；磁盘/IOPS/吞吐压力仍需 CES |

建议把验证策略分成两段：

1. 先在本地把 `local-verifiable` 和 `local-partial` 的数据面诊断逻辑跑通
2. 再在云端 TaurusDB 上补齐 CES、只读节点、复制链路和 TaurusDB 特性相关证据

## 4. 包边界

### 4.1 `packages/core`

`core` 负责所有真正的数据面语义：

- profile / secret / datasource resolution
- schema introspection
- guardrail 与 confirmation store
- query execution / status / cancel
- TaurusDB capability probe
- enhanced explain 与 flashback query

下一阶段建议在 `core` 内新增 `diagnostics/`，但不要污染当前执行主链。推荐拆分为：

- `diagnostics/orchestrator`
- `diagnostics/control-plane-adapters`
- `diagnostics/data-plane-collectors`

`core` 对外统一暴露 `TaurusDBEngine`，当前 MCP 不应再直接拼装零散模块。

### 4.2 `packages/mcp`

`mcp` 只保留协议层职责：

- stdio server 生命周期
- Tool schema 与 handler
- envelope / error mapping
- 启动时默认数据源 probe
- 动态 Tool 注册
- `init` 命令

简单说，`mcp` 是薄壳，不是第二个业务层。

诊断 Tool 也应遵守同样原则：MCP 只包装 schema、输入输出和 envelope，真正的联合诊断逻辑放在 `core`。

## 5. 当前文件布局

当前与 MCP 直接相关的关键路径如下：

```text
packages/core/src/
├── engine.ts
├── capability/
├── executor/
├── safety/
├── schema/
└── taurus/flashback.ts

packages/mcp/src/
├── index.ts
├── server.ts
├── commands/init.ts
├── tools/
│   ├── registry.ts
│   ├── discovery.ts
│   ├── query.ts
│   ├── common.ts
│   ├── error-handling.ts
│   ├── ping.ts
│   └── taurus/
│       ├── capability.ts
│       ├── explain.ts
│       └── flashback.ts
└── utils/
    ├── formatter.ts
    └── version.ts
```

## 6. 启动与注册模型

MCP 启动流程当前应保持如下简单链路：

1. 读取配置并创建 `TaurusDBEngine`
2. 读取默认数据源
3. 若默认数据源存在，对其做一次 capability probe
4. 通用 Tool 常驻注册
5. capability Tool 常驻注册
6. 若 probe 结果表明具备对应特性，再注册：
   - `explain_sql_enhanced`
   - `flashback_query`

不要再引入额外的注册状态机、缓存刷新参数或复杂 guardrail 编排。

## 7. 分阶段实施

### M0

- 保持 `core -> mcp` 单向依赖
- 保持 Tool 层只依赖 `engine`

### M1

- 稳定通用 Tool
- 稳定 token confirmation 流
- 稳定 stdio / envelope / error mapping

### M2

- 稳定 capability probe
- 稳定动态 Tool 注册
- 稳定 `get_kernel_info` / `list_taurus_features`

### M3

- 稳定 `explain_sql_enhanced`
- 稳定 `flashback_query`
- 对真实 TaurusDB 实例完成验证

## 8. 完成标准

满足以下条件，可认为 MCP 第一阶段完成：

- MCP Tool 全部通过 `TaurusDBEngine` 调用，不再绕过 `core`
- 启动时 capability probe 与动态 Tool 注册稳定可用
- 4 个 TaurusDB 首阶段 Tool 行为稳定
- token confirmation 链路稳定
- 文档不再把 recycle bin / history / doctor 写成已交付能力

## 9. 后续阶段

后续优先级建议如下：

1. 场景化诊断 Tool
   建议优先做 5 个：

   - `diagnose_slow_query`
   - `diagnose_connection_spike`
   - `diagnose_lock_contention`
   - `diagnose_replication_lag`
   - `diagnose_storage_pressure`

   它们共同依赖：

   - TaurusDB capability probe
   - 数据面内核视图与运行时状态
   - 控制面的 CES / 实例指标
   - 统一的诊断结果 schema

   验证顺序建议：

   - 先实现并本地验证 `diagnose_slow_query`、`diagnose_lock_contention`
   - 再实现 `diagnose_connection_spike`、`diagnose_storage_pressure` 的本地半闭环
   - 最后在云端 TaurusDB 完整验证 `diagnose_replication_lag`，并补齐前两类 Tool 的 CES / TaurusDB 证据

2. recycle bin Tool
   前提是补齐权威 SQL / CALL 语法与元数据视图。

3. history / binlog / audit 闭环
   前提是确认 DAS / 全量 SQL / SQL 审计 / Binlog 的真实接入面。

4. 更丰富的 TaurusDB 专属观测
   如分区、Statement Outline、长事务、只读节点状态。
