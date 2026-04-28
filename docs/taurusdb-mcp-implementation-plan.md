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
- TaurusDB 首阶段 Tool：
  - `get_kernel_info`
  - `list_taurus_features`
  - `explain_sql_enhanced`
  - `flashback_query`
  - `list_recycle_bin`
  - `restore_recycle_bin_table`
- 第一版 diagnostics Tool 面：
  - `show_processlist`
  - `find_top_slow_sql`
  - `diagnose_service_latency`
  - `diagnose_db_hotspot`
  - `diagnose_slow_query`
  - `diagnose_connection_spike`
  - `diagnose_lock_contention`
  - `diagnose_replication_lag`
  - `diagnose_storage_pressure`

下一阶段最值得继续增强的不是更多执行型 Tool，而是把**场景化诊断 Tool** 的云侧证据、长历史和 merge 质量补齐。

## 3. 第一阶段范围

第一阶段只保留三类能力：

1. 通用数据面能力
   `list_*`、`describe_table`、`show_processlist`、`execute_readonly_sql`、`execute_sql`、`explain_sql`

2. 最小安全模型
   AST 分类、tool scope 校验、静态阻断规则、token confirmation、结果裁剪/脱敏

3. TaurusDB 差异化能力
   capability discovery、enhanced explain、flashback query、recycle bin

4. 场景化 diagnostics 能力
   slow SQL 发现、服务延迟入口、热点定位、慢查询根因、连接暴涨、锁竞争、复制延迟、存储压力

第一阶段明确不做：

- `ConfirmationStrategy` 抽象
- schema cache / capability cache
- SQL history / Binlog / preflight / safety posture
- 更高保留期的全量 SQL / Binlog / deadlock archive 深度编排

diagnostics 产品线已经落地第一版，并按两层组织：

1. 症状入口层
   先回答“当前是谁在影响业务或实例”
2. 根因分析层
   再分析 suspect SQL / session / table 的具体根因

当前已默认暴露：

- `find_top_slow_sql`
- `diagnose_service_latency`
- `diagnose_db_hotspot`
- `diagnose_slow_query`
- `diagnose_connection_spike`
- `diagnose_lock_contention`
- `diagnose_replication_lag`
- `diagnose_storage_pressure`

这些 Tool 的验证边界如下：

| Tool | 层级 | 验证级别 | 说明 |
| --- | --- | --- |
| `find_top_slow_sql` | 症状入口层 | `local-partial` | 本地可先基于 digest ranking / Top SQL 样本返回 suspect SQL；更强排序需云侧慢 SQL 源 |
| `diagnose_service_latency` | 症状入口层 | `local-partial` | 本地可拼出 slow SQL / 锁 / 连接嫌疑；已接 CES CPU / 内存 / 连接 / 存储 / 复制指标第一版，仍需云端验证 |
| `diagnose_db_hotspot` | 症状入口层 | `local-partial` | 本地可先输出热点 SQL / 表 / 会话；更高保真度依赖云侧指标 |
| `diagnose_slow_query` | 根因分析层 | `local-verifiable` | 本地 MySQL 可验证 explain、慢 SQL、索引失配、临时表/排序等主要逻辑 |
| `diagnose_connection_spike` | 根因分析层 | `local-partial` | 本地可验证 `processlist`、线程/连接状态；已接 CES 连接指标第一版，云实例异常模式需上云 |
| `diagnose_lock_contention` | 根因分析层 | `local-verifiable` | 本地多会话即可复现锁等待、长事务、DDL 阻塞、死锁链路 |
| `diagnose_replication_lag` | 根因分析层 | `cloud-required` | 已接复制状态命令与 CES lag / long transaction / write pressure 指标第一版；需要托管复制链路或只读节点完整验证 |
| `diagnose_storage_pressure` | 根因分析层 | `local-partial` | 本地已基于 digest counters + table metadata 验证临时表落盘、filesort、扫描型 SQL；已接 CES 存储延迟 / IOPS / 吞吐指标第一版，仍需云端验证 |

建议把验证策略分成两段：

1. 先在本地把 `local-verifiable` 和 `local-partial` 的数据面诊断逻辑跑通
2. 再在云端 TaurusDB 上验证 CES、只读节点、复制链路和 TaurusDB 特性相关证据，尤其是 Cloud Eye 维度名、IAM token、指标时间窗口和真实权限差异

## 4. 包边界

### 4.1 `packages/core`

`core` 负责所有真正的数据面语义：

- profile / secret / datasource resolution
- schema introspection
- guardrail 与 confirmation store
- query execution
- TaurusDB capability probe
- enhanced explain 与 flashback query

`core` 已新增 `diagnostics/`，并保持不污染当前执行主链。当前边界按下面三类继续维护：

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

### 4.3 诊断 Tool 的协议收敛建议

建议先明确“发现层”和“分析层”不是同一种工具：

- 发现层负责输出 suspect SQL / session / table
- 分析层负责解释 suspect object 为什么会造成问题

推荐调用链：

1. 用户说“接口变慢了”
2. 先调 `diagnose_service_latency`
3. 若返回 suspect SQL，再调 `find_top_slow_sql` 或直接调 `diagnose_slow_query`
4. 若返回 blocker / waiter，再调 `diagnose_lock_contention`
5. 若返回连接堆积，再调 `diagnose_connection_spike`

建议不要为 5 个诊断 Tool 分别发明完全不同的 schema，而是统一成：

- 一套 `DiagnosticBaseInput`
- 一套 `DiagnosticResult`
- 每个 Tool 只补少量场景专属字段

建议的基础输入字段：

```typescript
type DiagnosticBaseInput = {
  datasource?: string;
  database?: string;
  time_range?: {
    from?: string;
    to?: string;
    relative?: string;
  };
  evidence_level?: "basic" | "standard" | "full";
  include_raw_evidence?: boolean;
  max_candidates?: number;
};
```

建议的统一输出字段：

```typescript
type DiagnosticResult = {
  tool: string;
  status: "ok" | "inconclusive" | "not_applicable";
  severity: "info" | "warning" | "high" | "critical";
  summary: string;
  diagnosis_window: {
    from?: string;
    to?: string;
    relative?: string;
  };
  root_cause_candidates: Array<{
    code: string;
    title: string;
    confidence: "low" | "medium" | "high";
    rationale: string;
  }>;
  key_findings: string[];
  suspicious_entities?: object;
  evidence: Array<{
    source: string;
    title: string;
    summary: string;
    raw_ref?: string;
  }>;
  recommended_actions: string[];
  limitations?: string[];
};
```

这样做的目的很简单：

- MCP 和 CLI 共用同一份结果 contract
- 前端可以稳定渲染 `summary / candidates / actions / evidence`
- 后续新增 `diagnose_high_cpu` 一类 Tool 时不用重做结果协议

症状入口层建议先定义单独契约：

```typescript
type FindTopSlowSqlInput = DiagnosticBaseInput & {
  top_n?: number;
  sort_by?: "avg_latency" | "total_latency" | "exec_count" | "lock_time";
};

type DiagnoseServiceLatencyInput = DiagnosticBaseInput & {
  user?: string;
  client_host?: string;
  symptom?: "latency" | "timeout" | "cpu" | "connection_growth";
};

type DiagnoseDbHotspotInput = DiagnosticBaseInput & {
  scope?: "sql" | "table" | "session";
};
```

推荐的 `find_top_slow_sql` 最小输出：

```typescript
type TopSlowSqlItem = {
  sql_hash?: string;
  digest_text?: string;
  sample_sql?: string;
  avg_latency_ms?: number;
  total_latency_ms?: number;
  exec_count?: number;
  avg_lock_time_ms?: number;
  avg_rows_examined?: number;
  evidence_sources: string[];
  recommendation?: string;
};
```

推荐的 `diagnose_service_latency` 最小输出：

```typescript
type ServiceLatencyDiagnosis = {
  status: "ok" | "inconclusive";
  suspected_category:
    | "slow_sql"
    | "lock_contention"
    | "connection_spike"
    | "resource_pressure"
    | "mixed";
  top_candidates: Array<{
    type: "sql" | "session" | "table";
    title: string;
    confidence: "low" | "medium" | "high";
    sql_hash?: string;
    digest_text?: string;
    session_id?: string;
    table?: string;
    rationale: string;
  }>;
  recommended_next_tools: string[];
};
```

根因分析层每个 Tool 再补这些专属输入即可：

| Tool | 专属输入 |
| --- | --- |
| `diagnose_slow_query` | `sql` / `sql_hash` / `digest_text` |
| `diagnose_connection_spike` | `user` / `client_host` / `compare_baseline` |
| `diagnose_lock_contention` | `table` / `blocker_session_id` |
| `diagnose_replication_lag` | `replica_id` / `channel` |
| `diagnose_storage_pressure` | `scope` / `table` |

实现约束建议：

- `diagnose_slow_query` 没有 `sql`、`sql_hash`、`digest_text` 时直接报输入不足
- `diagnose_replication_lag` 在无复制链路场景返回 `not_applicable`
- 缺 CES、缺 TaurusDB 特性、缺慢 SQL 源时，不要 silent degrade，要写进 `limitations`

### 4.4 `find_top_slow_sql` 的具体设计建议

这个 Tool 应该是下一阶段最先落地的入口层能力，因为它最接近客户真实问题：

- “哪条 SQL 最值得看”
- “现在最影响实例的是谁”

推荐输入：

```typescript
type FindTopSlowSqlInput = {
  datasource?: string;
  database?: string;
  time_range?: {
    from?: string;
    to?: string;
    relative?: string;
  };
  top_n?: number;
  sort_by?: "avg_latency" | "total_latency" | "exec_count" | "lock_time";
  evidence_level?: "basic" | "standard" | "full";
};
```

推荐 engine 接口：

```typescript
interface FindTopSlowSqlItem {
  sqlHash?: string;
  digestText?: string;
  sampleSql?: string;
  avgLatencyMs?: number;
  totalLatencyMs?: number;
  execCount?: number;
  avgLockTimeMs?: number;
  avgRowsExamined?: number;
  evidenceSources: string[];
  recommendation?: string;
}

interface FindTopSlowSqlResult {
  status: "ok" | "inconclusive";
  topSqls: FindTopSlowSqlItem[];
  limitations?: string[];
}
```

推荐实现策略：

1. 本地阶段先基于 `performance_schema.events_statements_summary_by_digest`
2. 若存在外部 Taurus slow-log source，再把 sample SQL 与额外 runtime metrics 拼进来
3. 对每条返回项给出“是否值得继续调用 `diagnose_slow_query`”的 recommendation

排序建议：

- `avg_latency`: 适合定位单次最慢
- `total_latency`: 适合定位整体影响最大
- `exec_count`: 适合定位高频热点
- `lock_time`: 适合定位锁等待型 slow SQL

### 4.5 `diagnose_service_latency` 的具体设计建议

这个 Tool 应该承担“症状到嫌疑对象”的路由职责，而不是直接 pretend 自己知道根因。

推荐判断顺序：

1. 先看是否存在明显的连接堆积模式
2. 再看是否存在明显锁等待 / blocker 链
3. 再看是否存在 top slow SQL / digest hotspot
4. 若都不充分，则返回 `resource_pressure` 或 `mixed`

输出的 `recommended_next_tools` 建议只返回：

- `find_top_slow_sql`
- `diagnose_slow_query`
- `diagnose_connection_spike`
- `diagnose_lock_contention`
- `diagnose_db_hotspot`

### 4.6 现有 Tool 的产品定位调整建议

为了避免工具命名和客户预期错位，建议直接把文案改成：

- `diagnose_slow_query`
  `Analyze the root cause of a known suspicious SQL.`
- `diagnose_connection_spike`
  强调它是“分析连接增长症状背后的 live session pattern”，而不是单纯 processlist heuristic
- `diagnose_lock_contention`
  强调它是“分析 blocker / waiter chain”的二级分析器

### 4.7 `find_top_slow_sql` 的第一版实现设计

这一节只回答一个问题：如果下一步就开始写代码，第一版应该怎么落。

#### 4.7.1 代码范围

第一版建议只动这几个位置：

- `packages/core/src/diagnostics/types.ts`
- `packages/core/src/engine.ts`
- `packages/core/src/index.ts`
- `packages/mcp/src/tools/taurus/diagnostics.ts`
- `packages/core/tests/engine.test.mjs`
- `packages/mcp/tests/tool-handlers.test.mjs`
- `packages/mcp/tests/local-mysql.test.mjs`

第一版不建议新建过多文件，先复用现有 diagnostics 入口和 `engine.ts` 内部 helper，等 `find_top_slow_sql` 与 `diagnose_service_latency` 都稳定后，再考虑把 digest collector 拆到 `diagnostics/collectors/`。

#### 4.7.2 `packages/core/src/diagnostics/types.ts`

建议新增：

```typescript
export type SymptomDiagnosticToolName =
  | "find_top_slow_sql"
  | "diagnose_service_latency"
  | "diagnose_db_hotspot";

export type DiagnosticToolName =
  | SymptomDiagnosticToolName
  | "diagnose_slow_query"
  | "diagnose_connection_spike"
  | "diagnose_lock_contention"
  | "diagnose_replication_lag"
  | "diagnose_storage_pressure";

export interface FindTopSlowSqlInput extends DiagnosticBaseInput {
  topN?: number;
  sortBy?: "avg_latency" | "total_latency" | "exec_count" | "lock_time";
}

export interface TopSlowSqlItem {
  sqlHash?: string;
  digestText?: string;
  sampleSql?: string;
  avgLatencyMs?: number;
  totalLatencyMs?: number;
  execCount?: number;
  avgLockTimeMs?: number;
  avgRowsExamined?: number;
  evidenceSources: string[];
  recommendation?: string;
}

export interface FindTopSlowSqlResult {
  tool: "find_top_slow_sql";
  status: DiagnosticStatus;
  summary: string;
  diagnosisWindow: DiagnosisWindow;
  topSqls: TopSlowSqlItem[];
  evidence: DiagnosticEvidenceItem[];
  limitations?: string[];
}
```

设计原则：

- `FindTopSlowSqlResult` 不要复用 `DiagnosticResult`
  原因：
  `find_top_slow_sql` 是入口层“发现工具”，核心结构是 `topSqls[]`，不是 `rootCauseCandidates[]`
- 先把 `SymptomDiagnosticToolName` 独立出来，给后面的 `diagnose_service_latency`、`diagnose_db_hotspot` 预留位置

#### 4.7.3 `packages/core/src/engine.ts`

第一版建议在 `engine.ts` 里新增 3 个内部 helper 和 1 个 public method。

新增内部 row type：

```typescript
type RankedStatementDigestRow = StatementDigestRow & {
  totalLatencyMs?: number;
};
```

新增 helper：

```typescript
async findTopStatementDigests(
  input: FindTopSlowSqlInput,
  ctx: SessionContext,
): Promise<RankedStatementDigestRow[]>
```

职责：

- 查询 `performance_schema.events_statements_summary_by_digest`
- 支持 `database` 过滤
- 支持 `topN`
- 支持 `sortBy`
- 返回 digest ranking rows

推荐 SQL 形态：

```sql
SELECT
  SCHEMA_NAME AS schema_name,
  DIGEST AS digest,
  DIGEST_TEXT AS digest_text,
  QUERY_SAMPLE_TEXT AS query_sample_text,
  COUNT_STAR AS exec_count,
  ROUND(AVG_TIMER_WAIT / 1000000000, 3) AS avg_latency_ms,
  ROUND(SUM_TIMER_WAIT / 1000000000, 3) AS total_latency_ms,
  ROUND(MAX_TIMER_WAIT / 1000000000, 3) AS max_latency_ms,
  ROUND(SUM_LOCK_TIME / 1000000000 / NULLIF(COUNT_STAR, 0), 3) AS avg_lock_time_ms,
  ROUND(SUM_ROWS_EXAMINED / NULLIF(COUNT_STAR, 0), 3) AS avg_rows_examined,
  ROUND(SUM_SORT_ROWS / NULLIF(COUNT_STAR, 0), 3) AS avg_sort_rows,
  ROUND(SUM_CREATED_TMP_TABLES / NULLIF(COUNT_STAR, 0), 3) AS avg_tmp_tables,
  ROUND(SUM_CREATED_TMP_DISK_TABLES / NULLIF(COUNT_STAR, 0), 3) AS avg_tmp_disk_tables,
  SUM_SELECT_SCAN AS select_scan_count,
  SUM_NO_INDEX_USED AS no_index_used_count
FROM performance_schema.events_statements_summary_by_digest
WHERE ...
ORDER BY ...
LIMIT ...
```

新增 parse helper：

```typescript
function parseRankedStatementDigestRows(result: QueryResult): RankedStatementDigestRow[]
```

复用现有 `parseStatementDigestRows` 的映射方式，只额外补 `totalLatencyMs`。

新增 public method：

```typescript
async findTopSlowSql(
  input: FindTopSlowSqlInput,
  ctx: SessionContext,
): Promise<FindTopSlowSqlResult>
```

第一版逻辑建议：

1. 调 `findTopStatementDigests`
2. 若为空，返回 `inconclusive`
3. 对每个 digest row 映射为 `TopSlowSqlItem`
4. 若配置了 Taurus slow-log external source，可尝试为前 1-3 个 digest 补 `sampleSql`
   第一版可以先不做“逐个外部补样本”，只在已有 `query_sample_text` 缺失时再考虑
5. 返回 `topSqls[]`

`recommendation` 生成建议：

- 有 `digestText` 或 `sampleSql` 时：
  `Run diagnose_slow_query with digest_text or sql to explain the dominant bottleneck.`
- `avg_lock_time_ms` 显著时：
  `Correlate with diagnose_lock_contention if lock time remains elevated.`
- `exec_count` 很高但单次不高时：
  `Review high-frequency workload shape before focusing only on single-query latency.`

`summary` 生成建议：

- 成功：
  `Top slow SQL ranking collected N suspect statements on datasource X.`
- 空结果：
  `No statement digest ranking evidence was available for the selected window on datasource X.`

#### 4.7.4 `packages/core/src/index.ts`

需要导出：

```typescript
export type {
  FindTopSlowSqlInput,
  FindTopSlowSqlResult,
  TopSlowSqlItem,
} from "./diagnostics/types.js";
```

这样 MCP handler 可以直接从 `@huaweicloud/taurusdb-core` 拿类型。

#### 4.7.5 `packages/mcp/src/tools/taurus/diagnostics.ts`

建议新增 `findTopSlowSqlTool`，不要单独建新文件，先继续跟 diagnostics handler 放在一起。

推荐 schema：

```typescript
export const findTopSlowSqlTool: ToolDefinition = {
  name: "find_top_slow_sql",
  description:
    "Find the most suspicious slow SQL statements for the selected datasource, database, and time window.",
  inputSchema: {
    ...diagnosticBaseInputShape,
    top_n: z.number().int().positive().max(20).optional(),
    sort_by: z.enum(["avg_latency", "total_latency", "exec_count", "lock_time"]).optional(),
  },
  async handler(...) { ... }
}
```

handler 只做三件事：

1. 解析 `top_n` / `sort_by`
2. `resolveContext(..., true)`
3. 调 `deps.engine.findTopSlowSql(...)`

MCP summary 建议：

- `Top slow SQL discovery returned ok.`
- 不要在 summary 里塞太多排名细节，细节放到 `data.top_sqls`

`diagnosticToolDefinitions` 注册顺序建议改成：

1. `find_top_slow_sql`
2. `diagnose_slow_query`
3. `diagnose_connection_spike`
4. `diagnose_lock_contention`
5. `diagnose_replication_lag`
6. `diagnose_storage_pressure`

等 `diagnose_service_latency` 和 `diagnose_db_hotspot` 实现后，再把它们插到入口层最前面。

#### 4.7.6 测试设计

`packages/core/tests/engine.test.mjs`

新增一组 `findTopSlowSql` 测试：

- `executeReadonly` 命中 `events_statements_summary_by_digest` 时返回 2-3 条排序结果
- 断言：
  - `tool = find_top_slow_sql`
  - `status = ok`
  - `topSqls.length > 0`
  - `topSqls[0].digestText` 存在
  - `topSqls[0].evidenceSources` 包含 `statement_digest`

- 再补一组空结果测试：
  - digest query 返回 0 行
  - 断言 `status = inconclusive`

`packages/mcp/tests/tool-handlers.test.mjs`

新增 handler stub：

```javascript
findTopSlowSql: async () => ({
  tool: "find_top_slow_sql",
  status: "ok",
  summary: "top slow sql found",
  diagnosisWindow: { relative: "15m" },
  topSqls: [...],
  evidence: [...],
})
```

断言点：

- handler 能正确解析 `top_n` / `sort_by`
- 结构化返回里 `tool=find_top_slow_sql`
- 输入校验生效

`packages/mcp/tests/local-mysql.test.mjs`

第一版建议只补最小 e2e：

- 调 `find_top_slow_sql`
- 断言：
  - `status=ok` 或 `inconclusive`
  - 不抛异常
  - `data.top_sqls` 字段稳定

不要在第一版 local MySQL e2e 里硬断言排序名次，因为样例库太小，digest 统计稳定性会受运行时样本影响。

#### 4.7.7 第一版刻意不做

这一节是早期 `find_top_slow_sql` 第一版的约束，当前已部分过期。现在实际状态是：

- `diagnose_service_latency` / `diagnose_db_hotspot` 已落本地第一版
- `diagnose_service_latency` 已接入 CES / Cloud Eye 指标源第一版
- `diagnose_connection_spike` 已接入 CES 连接指标第一版
- `diagnose_replication_lag` 已从 scaffold 推进到复制状态 + CES lag 的可联调第一版
- `diagnose_storage_pressure` 已接入本地 digest / table storage 证据与 CES 存储指标第一版

当前仍刻意不做：

- 不做跨多个外部慢 SQL 源的复杂 merge ranking
- 不做 DAS / 全量 SQL 等高保留期 SQL 源的复杂 merge ranking；当前已接 Taurus slow-log external source / external ranking merge 第一版，CES / Cloud Eye 指标源已有第一版，但仍需云端真实验证
- 不做 sample SQL 缺失时的复杂回填策略
- 不做更长 deadlock history archive 与更复杂的 MDL 根因归并
- 不做 OS 级磁盘指标 collector

先把“本地 digest ranking -> 返回 suspect SQL -> 可以继续调 `diagnose_slow_query`”这条链路做通，再扩外围。

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

当前 diagnostics Tool 已改为默认注册，并直接纳入默认工具面。

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
- TaurusDB 首阶段 Tool 行为稳定，包括 capability、enhanced explain、flashback query 和 recycle bin
- token confirmation 链路稳定
- 文档不再把 history / doctor 写成已交付能力

## 9. 后续阶段

后续优先级建议如下：

1. 场景化诊断 Tool
   当前已经完成第一刀：

   - `show_processlist`
   - `diagnose_slow_query`
   - `diagnose_connection_spike`
   - `diagnose_lock_contention`
   - `diagnose_replication_lag`
   - `diagnose_storage_pressure`
   - CES / Cloud Eye metrics source 第一版

   下一步继续推进：

   - 云端 TaurusDB 真实实例验证 CES 指标源、复制状态命令与权限边界
   - DAS / Top SQL / 全量 SQL 证据源
   - 更长 deadlock history archive 与更复杂的 MDL 根因归并
   - OS 级磁盘 / IOPS / 吞吐指标

   它们共同依赖：

   - TaurusDB capability probe
   - 数据面内核视图与运行时状态
   - 控制面的 CES / 实例指标
   - 统一的诊断结果 schema

   验证顺序建议：

   - 先在 Taurus slow-log external source 的基础上，继续补齐 DAS / Top SQL 与更强的 wait-event / 云侧运行时关联
   - 先在云端 TaurusDB 完整验证 CES / Cloud Eye 指标源、`diagnose_replication_lag` 和存储指标链路
   - 再补更长 deadlock history archive 与更强的 MDL 根因归并
   - 最后接入 DAS / Top SQL / 全量 SQL，并和本地 digest / slow-log source 合并排序

   首批 schema 设计建议：

   - 先冻结 `DiagnosticBaseInput`
   - 再冻结 `DiagnosticResult`
   - 最后为 5 个 Tool 逐个补专属输入和 evidence collector 列表

2. history / binlog / audit 闭环
   前提是确认 DAS / 全量 SQL / SQL 审计 / Binlog 的真实接入面。

3. 更丰富的 TaurusDB 专属观测
   如分区、Statement Outline、长事务、只读节点状态。
