# TaurusDB MCP 手工 Smoke Test

1. 构建并启动精确 RC 版本。
2. 检查 tool list：有只读、诊断和 `analyze_mutation_sql`，没有数据库状态变更工具。
3. 完成 `begin_sql_login`，确认页面只显示目标信息，凭据不会回显或进入 Agent。
4. 执行 discovery、只读查询和 EXPLAIN。
5. 分析一条有 WHERE 的 UPDATE，确认 `execution_status=not_executed`、
   `human_review_required=true`、`sample_rows_read=false`。
6. 分析无 WHERE UPDATE 和 DROP，确认没有 copy-ready `advised_sql`。
7. 重新查询目标记录，确认数据库未发生变化。
8. 检查审计文件权限、轮转、stdout/stderr 和凭据泄漏。

完整自动化与云端步骤见 [testing.md](./testing.md) 和
[cloud-taurusdb-testing.md](./cloud-taurusdb-testing.md)。旧版 smoke 流程仅保存在
[`archive/pre-readonly-manual-smoke-test.md`](./archive/pre-readonly-manual-smoke-test.md)。
