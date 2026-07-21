# TaurusDB MCP 手工 Smoke Test

1. 构建并启动精确 RC 版本。
2. 默认检查 tool list：有只读、诊断、`analyze_mutation_sql` 和 `restore_recycle_bin_table`，
   没有通用写入工具。
3. 选择实例，打开同一响应返回的 `login_url`，确认页面只显示目标信息，凭据不会回显
   或进入 Agent；`begin_sql_login` 仅用于需要重新登录的场景。
4. 执行 discovery、只读查询和 EXPLAIN。
5. 分析一条有 WHERE 的 UPDATE，确认 `execution_status=not_executed`、
   `human_review_required=true`、`sample_rows_read=false`。
6. 分析无 WHERE UPDATE 和 DROP，确认没有 copy-ready `advised_sql`。
7. 重新查询目标记录，确认数据库未发生变化。
8. 检查审计文件权限、轮转、stdout/stderr 和凭据泄漏。
9. 如本 RC 包含受控恢复验收，只在 disposable 数据库测试；确认错误对象和目标冲突被
   阻断，精确对象恢复后 `execution_status=executed`、`verified=true` 且审计完整。

完整自动化与云端步骤见 [testing.md](./testing.md) 和
[cloud-taurusdb-testing.md](./cloud-taurusdb-testing.md)。旧版 smoke 流程仅保存在
[`archive/pre-readonly-manual-smoke-test.md`](./archive/pre-readonly-manual-smoke-test.md)。
