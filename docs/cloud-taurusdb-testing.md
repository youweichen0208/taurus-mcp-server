# TaurusDB 云端 RC 验证

本指南适用于 0.5.x 只读 Harness。旧版 mutation 验证流程已归档到
[`archive/pre-readonly-cloud-taurusdb-testing.md`](./archive/pre-readonly-cloud-taurusdb-testing.md)。

## 前提

- disposable 或经过授权的 TaurusDB 验证实例；
- 私网地址和可验证的 TLS 证书；
- 只读数据库账号，不配置写账号；
- 最小权限华为云身份与明确的 project/region/instance/node；
- 私有审计目录和集中采集测试目标。

## 步骤

1. 对精确 RC commit 执行 `npm ci && npm run build && npm test`。
2. 设置只读 datasource 与云上下文，执行 `npm run cloud:validate`。
3. 检查 `tools/list`：必须存在 `analyze_mutation_sql`，且没有数据库写入或回收站恢复工具。
4. 对测试表的有界 UPDATE 调用 `analyze_mutation_sql`，记录 schema、EXPLAIN 和匹配
   行数证据；确认 `execution_status: not_executed`、`human_review_required: true`，
   再次只读查询并证明记录未变化。
5. 对无 WHERE UPDATE、DROP、GRANT 和多语句输入验证 `advised_sql` 为空并返回风险。
6. 验证 stdout/stderr、审计日志和 Agent 可见结果均不含凭据。
7. 按 [规模验证](./scale-validation.md) 执行并发、队列、大结果与审计轮转门禁。

## 通过标准

RC 记录必须包含精确包版本、完整性摘要、TaurusDB 版本、TLS cipher、自动化结果、
SQL Advice 未改变数据的前后证据、审计轮转结果和已知限制。任一写入工具出现、任一
Advice 导致数据库变化或凭据泄漏都必须阻断发布。
