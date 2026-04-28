# TaurusDB MCP 高频运维问题 Playbook

> 本文档面向上云验证和真实值班场景，围绕 5 类高频数据库运维问题，把当前 MCP Tool、TaurusDB 独特能力和诊断下钻路径串成可执行方案。

配套阅读：

- [cloud-taurusdb-testing.md](./cloud-taurusdb-testing.md)
- [testing.md](./testing.md)
- [architecture.md](./architecture.md)

---

## 1. 当前可用的 TaurusDB 特性入口

当前 MCP 保留的是已实现、可验证、风险可控的 TaurusDB 能力：

| 能力 | MCP Tool | 用途 | 风险 |
| --- | --- | --- | --- |
| 能力发现 | `get_kernel_info` / `list_taurus_features` | 判断当前实例是不是 TaurusDB、支持哪些内核能力 | 只读 |
| Enhanced Explain | `explain_sql_enhanced` | 分析 NDP / PQ / offset pushdown 是否可用、是否被 SQL 形态阻断 | 只读 |
| Flashback Query | `flashback_query` | 查询历史时刻数据，辅助误改排查和恢复前对账 | 只读 |
| Recycle Bin | `list_recycle_bin` / `restore_recycle_bin_table` | 排查误删表、恢复回收站表 | list 只读；restore 需要 confirmation |
| Diagnostics | `diagnose_*` / `find_top_slow_sql` / `show_processlist` | 面向运维问题的证据采集和根因排序 | 只读为主 |

回收站恢复策略：

- `list_recycle_bin` 用于确认可恢复对象。
- `restore_recycle_bin_table` 的 `native_restore` 调用 TaurusDB 原生回收站恢复能力。
- `restore_recycle_bin_table` 的 `insert_select` 适合需要保留 Binlog / DRS 链路可见性的恢复，但要求先建好兼容结构的目标表。
- `restore_recycle_bin_table` 只有在 mutations 开启且 capability probe 命中 `recycle_bin` 时才会暴露。
- 不提供 purge 类 Tool，因为 purge 是不可恢复删除，不适合作为 MCP 默认能力。

---

## 2. 问题一：慢查询 / 接口变慢

典型症状：

- 某个业务接口 P95 / P99 延迟升高。
- 数据库 CPU 或 I/O 看起来正常，但单条 SQL 明显慢。
- 应用超时日志集中在少数 SQL 模板。

推荐 Tool 顺序：

1. `diagnose_service_latency`
2. `find_top_slow_sql`
3. `diagnose_slow_query`
4. `explain_sql_enhanced`
5. 必要时 `flashback_query`

最小调用：

```json
{
  "datasource": "cloud_taurus",
  "database": "app",
  "symptom": "latency",
  "time_range": { "relative": "30m" },
  "evidence_level": "standard"
}
```

下钻慢 SQL：

```json
{
  "datasource": "cloud_taurus",
  "database": "app",
  "time_range": { "relative": "30m" },
  "top_n": 5,
  "sort_by": "total_latency"
}
```

根因分析：

```json
{
  "datasource": "cloud_taurus",
  "database": "app",
  "sql": "SELECT ...",
  "time_range": { "relative": "30m" },
  "evidence_level": "full"
}
```

TaurusDB 特性怎么参与：

- `explain_sql_enhanced` 会输出 NDP / Parallel Query / offset pushdown 相关 hints。
- 如果 SQL 是大扫描、聚合、排序、LIMIT/OFFSET 场景，优先看 `taurus_hints.ndp_pushdown`、`taurus_hints.parallel_query`、`taurus_hints.offset_pushdown`。
- 如果 `parallel_query.available=true` 但 `enabled=false`，不要直接让 MCP 改全局参数；先记录建议，由 DBA 评估参数策略。
- 如果慢查询来自误改后数据分布异常，用 `flashback_query` 对比历史时刻样本，避免先盲目改索引。

解决建议：

- 有索引失配：优先补合适索引或重写条件，避免只依赖 PQ 抗住全表扫。
- 有临时表 / filesort：优化排序列、分页方式或覆盖索引。
- NDP/PQ 可用但没命中：检查 SQL 形态是否阻断 pushdown，例如函数包列、隐式转换、复杂表达式。
- 慢 SQL 源缺数据：确认 DAS / Top SQL / performance_schema retention 和时间窗口。

验收信号：

- `root_cause_candidates` 有明确排序。
- `evidence[].source` 至少包含 `explain`、`statement_digest` 或 DAS / CES 证据。
- `recommended_next_tools` 能把问题继续导向锁、连接、存储或热点诊断。

---

## 3. 问题二：连接数暴涨 / 连接池打满

典型症状：

- 应用报 too many connections。
- CES 连接使用率上升。
- `PROCESSLIST` 中大量 idle / sleep / long-running sessions。

推荐 Tool 顺序：

1. `diagnose_connection_spike`
2. `show_processlist`
3. `diagnose_service_latency`
4. `diagnose_lock_contention`
5. `find_top_slow_sql`

最小调用：

```json
{
  "datasource": "cloud_taurus",
  "database": "app",
  "time_range": { "relative": "15m" },
  "compare_baseline": true,
  "evidence_level": "full"
}
```

聚焦应用来源：

```json
{
  "datasource": "cloud_taurus",
  "database": "app",
  "user": "app_user",
  "client_host": "10.0.",
  "time_range": { "relative": "15m" }
}
```

TaurusDB 特性怎么参与：

- CES 连接数、活跃连接数、连接使用率、QPS 会和 live `processlist` 合并分析。
- 如果连接暴涨是慢 SQL 引起的排队，继续用 `find_top_slow_sql` 和 `explain_sql_enhanced` 判断是否可用 NDP/PQ 降低单 SQL 占用时间。
- 如果连接暴涨是锁等待引起的堆积，继续用 `diagnose_lock_contention`。

解决建议：

- idle 连接堆积：优先调整应用连接池 idle timeout、max pool size、泄漏检测。
- active 连接堆积：查 Top SQL、锁等待、存储压力，不要只调大 max_connections。
- 单一 client_host 暴涨：优先定位应用发布、重试风暴、连接池配置漂移。
- CES 有高连接但当前 processlist 空：说明异常窗口已过，保留时间窗口和应用日志做关联。

验收信号：

- `evidence[].source` 包含 `processlist` 或 `ces_metrics`。
- `suspicious_entities.users` / `sessions` 能指出来源用户、主机或状态。
- 结果能给出 `show_processlist` 或慢 SQL / 锁等待的下钻输入。

---

## 4. 问题三：锁竞争 / 死锁 / DDL 阻塞

典型症状：

- SQL 卡住但 CPU 不高。
- 应用报 lock wait timeout 或 deadlock。
- DDL 长时间不返回。

推荐 Tool 顺序：

1. `diagnose_lock_contention`
2. `show_processlist`
3. `diagnose_slow_query`
4. 必要时 `flashback_query`

最小调用：

```json
{
  "datasource": "cloud_taurus",
  "database": "app",
  "time_range": { "relative": "15m" },
  "evidence_level": "full",
  "include_raw_evidence": true
}
```

聚焦热点表：

```json
{
  "datasource": "cloud_taurus",
  "database": "app",
  "table": "orders",
  "evidence_level": "full"
}
```

TaurusDB 特性怎么参与：

- `diagnose_lock_contention` 已采集 InnoDB lock waits、metadata locks 和 latest deadlock 摘要。
- TaurusDB 的 partition MDL / nonblocking DDL 属于能力发现项，当前 MCP 不自动执行 DDL 测试，但会在 `list_taurus_features` 中暴露可用性。
- 如果锁问题来自误改或批量更新，`flashback_query` 可用于恢复前历史对账。

解决建议：

- 有 blocker session：优先定位 blocker SQL、事务开始时间、应用来源，再由 DBA 决定 kill / rollback。
- 有 MDL 阻塞：先找未提交事务或长查询，不要盲目重复执行 DDL。
- 有死锁：结合 latest deadlock 的两条事务 SQL，调整访问顺序、索引和事务粒度。
- 高并发更新热点行：缩短事务、减少批量范围、避免热点计数器行。

验收信号：

- `evidence[].source` 包含 `lock_waits`、`metadata_locks` 或 `deadlock_history`。
- `root_cause_candidates` 能区分 row lock、MDL、deadlock 或长事务。
- `recommended_actions` 不直接建议危险操作，而是先给定位和隔离策略。

---

## 5. 问题四：复制延迟 / 只读节点落后

典型症状：

- 读写分离场景读到旧数据。
- 只读节点 lag 指标升高。
- 大事务、DDL 或写入压力后延迟明显。

推荐 Tool 顺序：

1. `diagnose_replication_lag`
2. `diagnose_service_latency`
3. `find_top_slow_sql`
4. `diagnose_storage_pressure`
5. 必要时 `flashback_query`

最小调用：

```json
{
  "datasource": "cloud_taurus",
  "database": "app",
  "time_range": { "relative": "30m" },
  "evidence_level": "full",
  "include_raw_evidence": true
}
```

TaurusDB 特性怎么参与：

- Tool 会尝试读取复制状态，并合并 CES replication delay、long transaction、write IOPS、write throughput。
- 如果延迟来自大事务，结果会把问题导向写压力和长事务，而不是只看 replica 本身。
- Flashback Query 可用于判断业务读到旧数据时，主库历史状态和只读节点观察是否一致。

解决建议：

- 单机或无只读节点：`not_applicable` 是合理结果。
- 有 long transaction：拆小事务，避免长时间持锁和一次性大提交。
- 写 IOPS / throughput 高：先关联业务批任务、导入任务和热点表。
- SHOW REPLICA STATUS 不可用但 CES lag 高：优先在只读节点或云控制台补验证。

验收信号：

- 有复制链路时，`evidence` 应包含复制状态或 `ces_metrics`。
- 单机实例应明确 `not_applicable`，不能假装有复制结论。
- 推荐下钻应指向慢 SQL、存储压力或热点写入。

---

## 6. 问题五：存储压力 / IOPS / 临时表落盘

典型症状：

- 磁盘使用率、读写延迟、IOPS 或吞吐异常。
- 慢 SQL 中出现大量临时表、filesort、扫描。
- 报表或批处理期间数据库整体抖动。

推荐 Tool 顺序：

1. `diagnose_storage_pressure`
2. `diagnose_db_hotspot`
3. `find_top_slow_sql`
4. `diagnose_slow_query`
5. `explain_sql_enhanced`

实例级调用：

```json
{
  "datasource": "cloud_taurus",
  "database": "app",
  "scope": "instance",
  "time_range": { "relative": "30m" },
  "evidence_level": "full"
}
```

表级下钻：

```json
{
  "datasource": "cloud_taurus",
  "database": "app",
  "scope": "table",
  "table": "orders",
  "time_range": { "relative": "30m" }
}
```

TaurusDB 特性怎么参与：

- CES 存储用量、读写延迟、IOPS、吞吐、临时表指标会和 SQL digest / table metadata 合并。
- `explain_sql_enhanced` 用于判断扫描、排序、聚合场景是否可由 NDP / PQ / offset pushdown 缓解。
- column compression 是能力发现项，当前 MCP 不自动执行压缩 DDL，但可作为后续容量治理建议。

解决建议：

- tmp disk spill：优化排序/分组 SQL、增加合适索引、减少 SELECT *。
- scan-heavy SQL：优先修 SQL 和索引，再考虑实例规格或并行能力。
- table footprint 异常：查增长最快表、归档策略、历史数据保留策略。
- CES 存储延迟高但 SQL 证据弱：补查云侧事件、备份任务、批处理和底层 I/O 指标。

验收信号：

- `evidence[].source` 包含 `statement_digest`、`table_storage` 或 `ces_metrics`。
- `root_cause_candidates` 能区分 SQL 临时表、扫描型 SQL、表容量和云侧 I/O 压力。
- `recommended_next_tools` 能导向具体 SQL 或热点表。

---

## 7. 上云验证建议

建议按下面顺序验证：

1. 先跑 `npm run cloud:validate`，确认 datasource、readonly SQL、capability probe、DAS/CES 基本连通。
2. 先调用 `list_cloud_taurus_instances`，确认当前账号和 project 下有哪些实例；必要时手动选定 `instance_id`。
3. 用 `list_taurus_features` 确认 `flashback_query`、`recycle_bin`、`parallel_query`、`ndp_pushdown` 是否可用。
4. 用业务只读 SQL 验证 `explain_sql_enhanced`，不要先改参数。
5. 用 disposable test table 验证 `list_recycle_bin` 和 `restore_recycle_bin_table`，不要对生产表做 drop smoke。
6. 按上面 5 个问题分别跑一条最小诊断，并记录 `status`、`evidence[].source`、`limitations` 和 `recommended_next_tools`。

可接受降级：

- 非 TaurusDB 或低版本实例上，Taurus 专属 Tool 不暴露或返回 `UNSUPPORTED_FEATURE`。
- 未配置 DAS / CES 时，diagnostics 仍可返回本地数据面证据，但云侧 evidence 缺失。
- 没有复制链路时，`diagnose_replication_lag` 返回 `not_applicable`。
- 没有近期慢 SQL / deadlock / metric points 时，结果返回 `inconclusive` 并说明限制。
