# TaurusDB MCP 只读运维 Playbook

当前 MCP 日常用于证据收集、诊断和 SQL Advice，不负责普通修复执行。回收站恢复是
唯一人工审批例外；申请工具默认可见，恢复确认必须来自完成数据库登录的同一浏览器。旧版通用写入文档
已归档到 [`archive/pre-readonly-taurusdb-ops-playbook.md`](./archive/pre-readonly-taurusdb-ops-playbook.md)。

## 标准处理路径

1. 用 `get_session_binding` 确认 datasource、database 和实例目标。
2. 用发现、processlist、capability 和 diagnostics tools 收集证据。
3. 用 `explain_sql` / `explain_sql_enhanced` 验证查询计划。
4. 如需变更，调用 `analyze_mutation_sql` 生成标记为 `not_executed` 的 SQL Advice。
5. 人工复核业务规则、备份、锁影响、回滚方案和变更窗口。
6. 在客户自己的数据库变更系统中审批和执行；不要把执行凭据交给 MCP。
7. 执行后再用 MCP 的只读工具验证结果并留存审计证据。

## 常见场景

- 慢 SQL：`find_top_slow_sql` → `diagnose_slow_query` → enhanced EXPLAIN → 索引 Advice。
- 连接突增：`show_processlist` → `diagnose_connection_spike` → 客户外部限流/连接池变更。
- 锁等待：`diagnose_lock_contention` → 识别 blocker → 客户人工决定会话或事务处置。
- 复制延迟：`diagnose_replication_lag` → 判断 channel 状态 → 云控制面或人工处理。
- 误删表：先用 `list_recycle_bin` 核对精确对象，再调用 `prepare_recycle_bin_restore`，
  由完成数据库登录的同一浏览器中的本机操作人核对明确目标并
  确认，再用状态工具验证结果。Agent 不能直接恢复或覆盖现有表。
- 存储压力：`diagnose_storage_pressure` → 核实增长对象与窗口 → 外部容量或数据治理流程。

所有建议都必须明确证据、假设和未验证项；不得把 Advice 表述为“保证正确”。
