# Progress

## 1. 当前状态

当前仓库已经从“单包 MCP 原型”推进到“`core + mcp` 可运行、CLI 待接入”的状态。

当前可运行的主链路是：

- `packages/core`: 共享数据面能力与 `TaurusDBEngine`
- `packages/mcp`: MCP `stdio` server、tool registry、`init`
- `packages/cli`: 只有 scaffold，还未进入真实实现阶段

当前首阶段范围已经收敛为：

- 通用 MySQL 数据面 Tool
- minimal guardrail + token confirmation
- TaurusDB capability probe
- TaurusDB 首阶段 Tool：
  - `get_kernel_info`
  - `list_taurus_features`
  - `explain_sql_enhanced`
  - `flashback_query`
  - `list_recycle_bin`
  - `restore_recycle_bin_table`

当前明确不在首阶段范围内：

- SQL history / Binlog / preflight
- CLI REPL / ask / agent / doctor

当前已经接上的 diagnostics 能力：

- diagnostics shared types / result contract
- `TaurusDBEngine` 的 5 个诊断入口方法
- 5 个诊断 MCP Tool handler
- `show_processlist` 底层证据采集 Tool
- evidence-backed 的：
  - `diagnose_connection_spike`
  - `diagnose_lock_contention`

当前 diagnostics Tool 注册策略：

- 默认注册

下一阶段优先候选：

- `diagnose_slow_query`
- `diagnose_connection_spike`
- `diagnose_lock_contention`
- `diagnose_replication_lag`
- `diagnose_storage_pressure`

---

## 2. 已完成事项

### 2.1 文档与方案层

已完成：

- 重构仓库主文档与设计文档边界
- 明确 `core / mcp / cli` 三包定位
- 新增本地 MySQL 测试文档
- 修正部分旧引用和单包时代残留叙述

主要文件：

- `README.md`
- `docs/architecture.md`
- `docs/taurusdb-mcp-implementation-plan.md`
- `docs/taurusdb-cli-implementation.md`
- `docs/testing.md`
- `docs/manual-smoke-test.md`
- `docs/cloud-taurusdb-testing.md`

### 2.2 工程结构重构

已完成：

- 根目录改成 workspace 结构
- 新建 `packages/core`
- 新建 `packages/mcp`
- 新建 `packages/cli` scaffold
- 根 `package.json`、`tsconfig`、workspace 脚本已收口

### 2.3 Shared Core 收口

已完成：

- 引入 `TaurusDBEngine`
- server/tool 层不再直接拼装散装模块
- schema / guardrail / executor / confirmation / query tracker / capability probe 已统一从 engine 暴露
- `core` 不依赖 MCP SDK
- guardrail 已收敛为 minimal 模型
- 移除了重型 schema-aware 校验、EXPLAIN 预检查和复杂缓存依赖

### 2.4 TaurusDB 首阶段能力

已完成：

- `capability/` 模块
- TaurusDB kernel / feature probe
- 启动时 capability probe
- 动态 Tool 注册
- `get_kernel_info`
- `list_taurus_features`
- `explain_sql_enhanced`
- `flashback_query`

### 2.5 MCP 主功能

已完成：

- `ping`
- `list_data_sources`
- `list_databases`
- `list_tables`
- `describe_table`
- `show_processlist`
- `execute_readonly_sql`
- `explain_sql`
- `execute_sql`
- `init`

已完成的 MCP 行为：

- 统一 response envelope
- guardrail block / confirm / allow 主路径
- confirmation token 签发与校验
- `enableMutations` 开关控制 `execute_sql` 暴露
- stderr 日志边界
- `stdio` 集成测试
- `init` merge 行为测试

### 2.6 本地 MySQL 测试基础设施

已完成：

- 增加真实 MySQL driver adapter
- 增加本地 MySQL schema / seed / profile 示例
- 增加 opt-in 本地 MySQL MCP 集成测试
- 本地 MySQL 测试账号已补齐 diagnostics 所需最小权限：
  - `PROCESS`
  - `SELECT ON performance_schema.*`
- 增加 diagnostics opt-in 本地 MySQL e2e：
  - `diagnose_service_latency`
  - `diagnose_db_hotspot`
  - `diagnose_slow_query`
  - `diagnose_connection_spike`
  - `diagnose_lock_contention`
- 默认测试基线不依赖本地 MySQL

主要文件：

- `packages/core/src/executor/adapters/mysql.ts`
- `testdata/mysql/local-mysql-schema.sql`
- `testdata/mysql/local-mysql-seed.sql`
- `testdata/mysql/local-mysql-profiles.example.json`
- `packages/mcp/tests/local-mysql.test.mjs`

### 2.7 Diagnostics 进展

已完成：

- 在 `packages/core` 新增 diagnostics 类型层与统一结果 contract
- 在 `TaurusDBEngine` 新增 `diagnoseServiceLatency` 症状入口方法
- 在 `TaurusDBEngine` 新增 `diagnoseDbHotspot` 症状入口方法
- 在 `TaurusDBEngine` 新增 `findTopSlowSql` 发现层方法
- 在 `TaurusDBEngine` 新增 5 个诊断入口方法：
  - `diagnoseSlowQuery`
  - `diagnoseConnectionSpike`
  - `diagnoseLockContention`
  - `diagnoseReplicationLag`
  - `diagnoseStoragePressure`
- 在 `packages/mcp` 新增 `diagnose_service_latency`
- 在 `packages/mcp` 新增 `diagnose_db_hotspot`
- 在 `packages/mcp` 新增 `find_top_slow_sql`
- 在 `packages/mcp` 新增 5 个诊断 Tool handler 与输入校验
- diagnostics Tool 已改为默认注册，并直接纳入默认工具面
- 统一了诊断结果的 public mapping，MCP/CLI 后续可复用同一套返回骨架
- 增加了 `core` / `mcp` 侧测试
- 新增 `show_processlist` MCP Tool，作为连接与锁排查的底层 evidence collector
- `diagnose_slow_query` 已接入 explain-based 诊断，并支持通过 `digest_text` 从 `performance_schema` 解析 sample SQL
- `diagnose_slow_query` 已补充 digest 级运行时指标，包括 `avg_lock_time_ms`、临时表落盘与 no-index/scan 摘要
- `diagnose_slow_query` 已接入 TaurusDB slow-log external source 第一版，可通过外部 API 解析 sample SQL 与基础运行时摘要
- `diagnose_slow_query` 已补 DAS slow-query/full-SQL fallback 第一版，可在云侧更长保留期源上继续解析 sample SQL
- 云侧 evidence source 已支持高层 cloud resolver：
  - `TAURUSDB_CLOUD_REGION`
  - `TAURUSDB_CLOUD_ACCESS_KEY_ID`
  - `TAURUSDB_CLOUD_SECRET_ACCESS_KEY`
  - `TAURUSDB_CLOUD_ENABLE_EVIDENCE`
- 已新增会话级 cloud context Tool：
  - `set_cloud_region`
  - `set_cloud_access_keys`
  - `list_cloud_taurus_instances`
  - `select_cloud_taurus_instance`
- `list_cloud_taurus_instances` 可列出当前云账号下的实例 `name/id/host/port/default_node_id`
- `npm run cloud:validate` 已支持优先使用显式 `instance_id`，否则按 datasource `host/port` 自动解析唯一实例，并尽量自动回填 `project_id/node_id`
- `diagnose_slow_query` 在直接传入 SQL 文本时，已可自动匹配 `performance_schema` digest sample，并吸收 wait-event / lock-time / rows-examined 运行时证据
- `diagnose_connection_spike` 已接入 live `processlist` 采集与最小启发式根因分析
- `diagnose_lock_contention` 已接入 `performance_schema.data_lock_waits` + `INNODB_TRX` 的 InnoDB 锁等待诊断
- `diagnose_lock_contention` 已补 metadata lock 与 latest deadlock collector 第一版：
  - 基于 `performance_schema.metadata_locks` 识别 MDL blocker / hot object
  - 基于 `SHOW ENGINE INNODB STATUS` 解析 latest deadlock 摘要
- `diagnose_service_latency` 已接入 symptom-entry 路由，能够聚合 slow SQL、锁等待、连接堆积证据并给出 next-tool 建议
- `diagnose_db_hotspot` 已接入热点对象聚合，能够按 `scope=sql|table|session` 汇总 SQL、锁等待、processlist 热点
- `find_top_slow_sql` 已接入 `performance_schema.events_statements_summary_by_digest` 的 digest ranking 第一版
- `find_top_slow_sql` 已补 Taurus external slow SQL ranking merge 第一版：
  - 当配置 Taurus slow-log external source 时，可直接吸收外部 Top SQL 候选
  - 会与本地 digest ranking 去重合并，而不是只依赖 `performance_schema`
- `find_top_slow_sql` 已补 DAS Top SQL merge 第一版：
  - 当配置 DAS source 时，可吸收 `top-slow-log` 候选
  - 可与 digest ranking、Taurus slow-log external ranking 做去重合并
- `diagnose_service_latency` / `diagnose_db_hotspot` 已补充 `next_tool_inputs`，SQL、锁等待、连接堆积候选可直接产出可复用的下钻入参模板：
  - `diagnose_slow_query`
  - `diagnose_lock_contention`
  - `diagnose_connection_spike`
  - `show_processlist`
- `diagnose_replication_lag` / `diagnose_storage_pressure` 已补充跨工具下钻建议，诊断结果可直接产出可复用的 `recommended_next_tools` / `next_tool_inputs`：
  - `show_processlist`
  - `diagnose_db_hotspot`
  - `find_top_slow_sql`
  - `diagnose_slow_query`
- `diagnose_slow_query` 已增强“直接传 SQL”时的 SQL -> digest 匹配：
  - 保留 `QUERY_SAMPLE_TEXT` 精确 hash 命中
  - 增加基于 digest shape 的字面量归一化匹配
  - 当全库 Top digest 没命中时，会基于 SQL 中的表名 hint 二次查询 digest 候选
  - 支持样例 SQL 与传入 SQL 参数值不同、反引号差异、空白/操作符格式差异
- `diagnose_slow_query` 已补稳定根因排序，不再依赖启发式追加顺序；当前排序为 root-cause base priority + confidence rank，使强运行时证据可超过较弱的派生 plan 信号
- `diagnose_slow_query` 默认单测已覆盖本地可模拟的：
  - I/O wait
  - 同步竞争
  - tmp disk spill
- `diagnose_storage_pressure` 已从 scaffold 推进到本地可验证实现：
  - 基于 `performance_schema.events_statements_summary_by_digest` 识别 tmp disk spill、scan-heavy SQL、sort/tmp-table workload
  - 基于 `information_schema.TABLES` 补充 table storage footprint 证据
  - table scope 会直接按表名过滤 digest，避免全库 Top digest 把目标 workload 挤出候选集
- 新增 CES / Cloud Eye 指标源第一版：
  - `packages/core/src/diagnostics/metrics-source.ts`
- 通过高层 cloud resolver 启用；底层 `TAURUSDB_METRICS_SOURCE_CES_*` 仍保留为 override
  - 支持 TaurusDB `SYS.GAUSSDB` 指标别名到 CES metric name 的映射
  - 已接入 CPU、内存、连接数、连接使用率、QPS、慢查询、复制延迟、长事务、存储读写延迟、IOPS、吞吐、临时表等指标
- `diagnose_connection_spike` 已接入 CES 连接指标，可把 live processlist 与连接数 / 活跃连接数 / 连接使用率 / QPS 时间序列合并分析
- `diagnose_replication_lag` 已从 scaffold 推进到可联调实现：
  - 尝试读取 `SHOW REPLICA STATUS` / `SHOW SLAVE STATUS`
  - 合并 CES replication delay、long transaction、write IOPS、write throughput 指标
  - 无复制状态与无 CES 指标时返回 `not_applicable` 而不是假装有结论
- `diagnose_storage_pressure` 已接入 CES 存储指标，包括存储用量、读写延迟、IOPS、吞吐、临时表指标
- `diagnose_service_latency` 已接入 CES 资源指标，可把 CPU / 内存 / 连接使用率 / 慢查询 / 存储延迟 / 复制延迟纳入症状入口层路由

当前刻意未做：

- 仍未实现 DAS / 全量 SQL 等更高保留期 collector
- 仍未实现更完整的 DAS / 全量 SQL 多源复杂 merge ranking 与更深云侧 runtime correlation
- `diagnose_lock_contention` 当前只接 latest deadlock section，尚未接更长 deadlock history archive
- `diagnose_storage_pressure` 仍未接入 OS 级磁盘、IOPS、吞吐指标，只接了 CES 时间序列第一版
- `diagnose_slow_query` 已接入基于 `events_statements_history_long` + `events_waits_history_long` 的 digest/history 级 wait-event 关联
- `diagnose_slow_query` / `find_top_slow_sql` 已接 Taurus slow-log external source 与 DAS 第一版，但仍未接更完整的全量 SQL 历史回溯与更强的云侧运行时关联

`diagnose_slow_query` 后续可继续增强：

- 如需继续提高置信度，可再补真实 MySQL I/O wait、同步竞争 workload；tmp disk spill 已有 opt-in e2e 真实复现
- 继续细化 `next_tool_inputs` 的跨工具链路覆盖，例如复制延迟、存储压力和云侧 CES / DAS 证据链
- 接入 DAS / Top SQL / 全量 SQL 等更高保留期的外部慢 SQL 源，并和本地 digest 证据合并排序

主要文件：

- `packages/core/src/diagnostics/types.ts`
- `packages/core/src/engine.ts`
- `packages/core/src/index.ts`
- `packages/mcp/src/tools/taurus/diagnostics.ts`
- `packages/mcp/src/tools/common.ts`
- `packages/core/tests/engine.test.mjs`
- `packages/mcp/tests/tool-handlers.test.mjs`

---

## 3. 当前测试状态

已完成并通过：

- 根级 `npm run check`
- 根级 `npm run build`
- `packages/core` 单元测试
- `packages/mcp` 单元测试
- `packages/mcp` `stdio` 集成测试
- `packages/mcp` `init` 命令测试
- CES / Cloud Eye 指标源配置解析与脱敏测试
- `TaurusDBEngine` 合并 CES 指标到 diagnostics 的单元测试：
  - `diagnose_service_latency`
  - `diagnose_connection_spike`
  - `diagnose_replication_lag`
  - `diagnose_storage_pressure`

当前默认 `npm test` 结果：

- `packages/core`: 通过
- `packages/mcp`: 通过
- 本地 MySQL e2e: 默认跳过，需显式开启环境变量
- 最近一次默认完整测试：`npm test` 通过，`core` 101/101 通过，`mcp` 33/33 通过，其中本地 MySQL opt-in 用例默认 skip 10 个

显式开启本地 MySQL e2e 后，当前已验证通过：

- discovery / readonly / explain
- mutation confirmation flow
- diagnostics tools 默认暴露
- `diagnose_db_hotspot` 的本地 SQL hotspot 场景
- `diagnose_service_latency` 的 3 条本地症状路由：
  - `latency -> slow_sql`
  - `timeout -> lock_contention`
  - `connection_growth -> connection_spike`
- `diagnose_slow_query` 的 explain-based 本地场景
- `diagnose_storage_pressure` 的真实 MySQL storage pressure 场景：
  - 创建 `storage_pressure_events` 压力表
  - 通过小 `tmp_table_size` / `max_heap_table_size` + TEXT group/order workload 真实制造 temporary disk table
  - 验证 `diagnose_storage_pressure` 与 `diagnose_slow_query` 都能吸收对应 digest 证据
- `diagnose_connection_spike` 的 idle session 堆积场景
- `diagnose_lock_contention` 的 live blocker chain 场景
- 最近一次已使用本地 `taurus-mysql-e2e` 容器完整跑通 opt-in MCP 测试：33/33 通过，0 skipped

---

## 4. MCP 还差哪些

### 4.1 本地联调阶段仍待完成

当前本地、不依赖云端的 MCP 主链路与 diagnostics 第一版已经完成自动化验证：

- 只读 / 写入分离、confirmation、schema、readonly、explain、mutation 主链路已由 opt-in local MySQL e2e 覆盖
- 连接堆积、锁等待、SQL hotspot、service latency 路由、slow query、storage pressure 已有本地 e2e
- tmp disk spill 已有真实 MySQL workload 复现

仍可选增强但不阻塞本地闭环：

- 继续补真实 MySQL I/O wait、同步竞争 workload
- 继续补更多 diagnostics 边界场景

### 4.2 云端 TaurusDB 阶段仍待完成

待完成：

- 用云端 TaurusDB 复跑 schema / readonly / explain / mutation 主链路
- 用云端 TaurusDB 验证 capability probe / enhanced explain / flashback_query
- 验证网络、白名单、安全组、TLS 等环境因素
- 验证 TaurusDB 内核与本地 MySQL 的 explain / 元数据差异
- 验证云端真实账号权限与 timeout 行为
- 在云端 TaurusDB 上验证 CES / Cloud Eye 指标源：
  - endpoint / project / instance / node / token 是否正确
  - `SYS.GAUSSDB` namespace 与 `gaussdb_mysql_instance_id` / `gaussdb_mysql_node_id` 维度是否符合实例
  - CPU、连接、复制延迟、存储延迟、IOPS、吞吐、临时表等指标是否能真实返回
- 在云端 TaurusDB 上继续补齐 MDL / 死锁历史 / DAS / Top SQL 等联合证据验证

### 4.3 MCP 工程层可能继续收口的点

可继续做：

- 补更多真实数据库 e2e 场景
- 继续同步 `docs/taurusdb-mcp-implementation-plan.md` 的“当前完成度”
- 继续把剩余 diagnostics 从 contract 层推进到 collector / analyzer 层
- 后续阶段再评估 history/binlog 类能力

---

## 5. CLI 还差哪些

CLI 当前仍未开始真实实现，第一阶段目标应控制在命令模式。

待完成：

- 命令模式
- token-based 终端确认包装
- 输出格式化（table / json / csv）
- TaurusDB 专属命令：
  - `features`
  - `explain+`
  - `flashback`

当前状态：

- 只有 `packages/cli` 包骨架
- 设计文档已按首阶段范围收口
- 代码未落地

后续阶段再考虑：

- REPL
- `ask`
- `agent`
- `doctor`

---

## 6. 下一步建议顺序

建议按这个顺序继续：

1. 先保留当前默认自动化基线：
   - 每次关键变更继续跑 `npm run check`
   - 继续跑 `npm run build`
   - 继续跑默认 `npm test`
   - 本地 MySQL opt-in e2e 作为联调前回归项，不必每次默认运行

2. 准备云端 TaurusDB 联调环境：
   - 准备可连通的 TaurusDB 测试实例
   - 准备 readonly / mutation 两类测试账号
   - 确认安全组、白名单、VPC / 跳板机网络、TLS 策略
   - 准备测试库、测试表和可回滚的 mutation 数据
   - 准备 IAM token、project_id、instance_id、node_id

3. 在云端 TaurusDB 复跑 MCP 通用主链路：
   - `list_data_sources`
   - `list_databases`
   - `list_tables`
   - `describe_table`
   - `execute_readonly_sql`
   - `explain_sql`
   - `execute_sql` + confirmation token
   - `show_processlist`
   - 重点记录权限、timeout、metadata / explain 与本地 MySQL 的差异

4. 在云端 TaurusDB 验证 Taurus 专属 Tool：
   - `get_kernel_info`
   - `list_taurus_features`
   - `explain_sql_enhanced`
   - `flashback_query`
   - 重点确认 capability probe 是否正确控制 Tool 暴露，以及低版本 / 不支持特性时是否正确降级

5. 在云端 TaurusDB 验证 CES / Cloud Eye 指标源第一版：
   - 配置 `TAURUSDB_METRICS_SOURCE_CES_*`
   - 验证 `SYS.GAUSSDB` namespace
   - 验证 `gaussdb_mysql_instance_id` / `gaussdb_mysql_node_id` 维度
   - 验证 CPU、内存、连接数、连接使用率、QPS、慢查询、复制延迟、存储读写延迟、IOPS、吞吐、临时表等指标是否能真实返回
   - 验证 token 过期、权限不足、时间窗口无数据时是否稳定降级而不是抛未处理异常

6. 在云端 TaurusDB 验证 diagnostics 联合证据链：
   - `diagnose_service_latency` 是否能合并 SQL / 锁 / 连接 / CES 资源指标
   - `diagnose_connection_spike` 是否能合并 processlist 与 CES 连接指标
   - `diagnose_replication_lag` 是否能在只读节点或复制链路上合并复制状态与 CES lag 指标
   - `diagnose_storage_pressure` 是否能合并 digest / table storage 与 CES 存储指标
   - `diagnose_lock_contention` 继续验证 InnoDB lock wait evidence，并记录 MDL / deadlock history 缺口

7. 云端联调后，优先补剩余云侧 collector：
   - DAS / Top SQL / 全量 SQL，用于增强 `find_top_slow_sql` 与 `diagnose_slow_query`
   - MDL / deadlock history，用于增强 `diagnose_lock_contention`
   - OS 级磁盘 / IOPS / throughput 指标，用于增强 `diagnose_storage_pressure`
   - 更完整的复制拓扑 / 只读节点信息，用于增强 `diagnose_replication_lag`

8. 云端 MCP 主链路和 diagnostics 第一版稳定后，再开始 CLI 命令模式：
   - 先做只读命令：`sources`、`databases`、`tables`、`describe`、`query`、`explain`
   - 再做 `exec` + token-based terminal confirmation
   - 再做 Taurus 专属命令：`features`、`explain+`、`flashback`
   - 最后再考虑 CLI diagnose 命令

9. history/binlog、CLI REPL / ask / agent / doctor 继续放到后续阶段，不进入当前云端联调闭环
