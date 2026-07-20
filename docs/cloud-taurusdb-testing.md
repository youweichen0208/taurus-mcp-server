# TaurusDB 云端 RC 验证

本指南适用于 0.5.x 只读操作面及可选受控恢复例外。旧版通用 mutation 验证流程已归档到
[`archive/pre-readonly-cloud-taurusdb-testing.md`](./archive/pre-readonly-cloud-taurusdb-testing.md)。

## 前提

- disposable 或经过授权的 TaurusDB 验证实例；
- 仅向验证机出口 IP 放行的读写公网地址和可验证的 TLS 证书；
- 本机页面登录的数据库会话账号；如验证恢复，该账号需具有原生恢复权限；
- 最小权限华为云身份与明确的 project/region/instance/node；
- 私有审计目录和集中采集测试目标。

## 步骤

1. 对精确 RC commit 执行 `npm ci && npm run build && npm test`。
2. 设置只读 datasource 与云上下文，执行 `npm run cloud:validate`。
3. 默认检查 `tools/list`：必须存在 `analyze_mutation_sql` 和受控恢复申请/状态工具，
   且没有通用写工具或直接恢复工具。
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

## 可选恢复 RC gate

仅在 disposable 数据库和外部创建并 DROP 的测试表上执行：使用具有原生回收站恢复权限
的会话登录账号，并在完成登录的同一浏览器中确认；确认默认工具面包含
`prepare_recycle_bin_restore` 与 `get_recycle_bin_restore_status`。使用
`list_recycle_bin` 取得精确对象，准备恢复到一个明确且不存在的目标表，在本机页面由
操作人输入身份和精确短语确认，然后验证状态为 `succeeded`、`verified=true`、目标表可见且审批链接不能
复用。审计必须包含操作人、目标、批准和执行结果。目标冲突、过期链接、错误确认短语
和跨域 POST 必须 fail closed。不得对生产表执行 DROP smoke test。
