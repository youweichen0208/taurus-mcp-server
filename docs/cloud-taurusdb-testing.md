# TaurusDB 云端验收

本指南适用于 `1.0.x` 只读操作面及默认开启的受控回收站恢复例外。`1.0.0` 起的本地与 CI
验收已作为发布门禁完成；真实 TaurusDB 验收在发布后，用 npm 上的固定版本执行，
结果单独记录，发现的问题以补丁版本修复。旧版通用 mutation 验证流程已归档到
[`archive/pre-readonly-cloud-taurusdb-testing.md`](./archive/pre-readonly-cloud-taurusdb-testing.md)。

## 前提

- disposable 或经过授权的 TaurusDB 验证实例；
- 仅向验证机出口 IP 放行的公网地址（`1.0.x` 默认不启用数据库 TLS；如需验证 TLS，
  另设 `TAURUSDB_REQUIRE_TLS=true` 并配置可信 CA）；
- 本机页面登录的数据库会话账号；如验证恢复，该账号需具有原生恢复权限；
- 最小权限华为云身份与明确的 region（保存在凭据库或以环境变量注入）；
- 私有审计目录。

## 安装固定版本

```bash
npm install -g taurusdb-mcp@1.0.2
taurusdb-mcp --version
```

或在 MCP 客户端配置中固定 `npx -y taurusdb-mcp@1.0.2`。不要使用未固定的 `latest`。

## 运行验收

验收命令通过 MCP stdio 驱动已安装的 server，使用与 MCP 客户端相同的 `TAURUSDB_*`
环境变量：

```bash
taurusdb-mcp acceptance \
  --instance-id <instance-id> \
  --database <database> \
  --advice-sql "UPDATE <table> SET <column> = <value> WHERE <key> = <id>" \
  --advice-snapshot-sql "SELECT <column> FROM <table> WHERE <key> = <id>" \
  --report acceptance.json
```

- 使用 `--instance-id` 时，命令会在终端打印本机登录链接；在同一台机器的浏览器中打开
  并登录。登录链接只输出到终端，不写入报告。
- `--advice-sql` 不会被执行；`--advice-snapshot-sql` 在调用前后各执行一次只读查询，
  证明数据库状态未变化。
- 不传 `--instance-id` 时使用已配置的静态 datasource。

退出码：`0` 全部通过；`1` 存在失败；`3` 无失败但仍有 `pending`（未配置或未执行）。
`pending` 不是通过。

覆盖的检查：

| 检查 | 通过条件 |
| --- | --- |
| MCP initialize | server 版本与已安装 CLI 一致 |
| MCP tools/list | 包含只读、诊断、回收站工具；不存在通用写工具 |
| MCP ping | 成功 |
| 云实例选择与本机登录 | 超时前完成浏览器登录 |
| 只读查询 | `SELECT 1` 成功 |
| SQL Advice 不写库 | `analyze_mutation_sql` 返回 `execution_status: not_executed` 和 `human_review_required: true`，且快照前后一致（记录未变化） |
| 诊断 | `get_kernel_info`、`list_taurus_features`、`find_top_slow_sql`、`diagnose_db_hotspot` 均返回结构化结果 |
| 回收站恢复 | 仅在显式指定可丢弃对象时执行，见下文 |

## 手工补充：SQL Advice 边界

验收命令之外，在 MCP 客户端中再确认：

1. 对测试表的有界 UPDATE 调用 `analyze_mutation_sql`，记录 schema、EXPLAIN 和匹配
   行数证据；确认 `execution_status: not_executed`、`human_review_required: true`，
   再次只读查询并证明记录未变化。
2. 对无 WHERE UPDATE、DROP、GRANT 和多语句输入验证 `advised_sql` 为空并返回风险。
3. 对含 `GET_LOCK`、`SLEEP` 或自定义函数的 WHERE 条件，确认 `matched_row_count` 为
   `null`，`impact_analysis.evidence_gaps` 说明原因，且没有执行派生 `COUNT`。
4. 验证 stdout/stderr、审计日志和 Agent 可见结果均不含凭据。
5. 按 [规模验证](./scale-validation.md) 执行并发、队列、大结果与审计轮转门禁。

## 可选：回收站恢复验收

只在 disposable 数据库上、对外部创建并 DROP 的测试表执行。恢复会**写入数据库**，必须
显式确认：

```bash
taurusdb-mcp acceptance --instance-id <instance-id> \
  --restore-recycle-table <回收站对象名> \
  --restore-destination-database <库> \
  --restore-destination-table <不存在的目标表> \
  --confirm-disposable-restore \
  --report acceptance-restore.json
```

先用 `list_recycle_bin` 取得精确对象名。恢复要求当前所选实例上存在未过期的本机登录
会话；静态配置账号会返回 `SQL_SESSION_REQUIRED`。通过条件为 `verified=true` 且目标表
可见；审计日志中 `restore_recycle_bin_table_requested` 与 `_completed` 两条记录的实例、
回收站对象、目标库表和 SQL hash 一致。错误对象、目标冲突必须 fail closed。不得对生产表
执行 DROP smoke test。

**需在真实 TaurusDB 上确认的假设**：回收站预检只按对象标识列匹配
（`TABLE`、`TABLE_NAME`、`RECYCLE_TABLE`、`RECYCLED_TABLE`、`RECYCLE_NAME`、
`RECYCLED_NAME`、`RECYCLEBIN_NAME`，不区分大小写），不会按原库名/原表名列匹配。如果
`dbms_recyclebin.show_tables()` 返回的列名不在此列表中，恢复会以“无法识别的结果结构”
明确失败而不会执行；请记录 `list_recycle_bin` 返回的列名并反馈，以补丁版本适配。

## 通过标准与记录

验收记录必须包含：精确包版本与 npm 完整性摘要、TaurusDB 内核版本、`acceptance.json`、
SQL Advice 前后快照结论、恢复验收（如执行）的审计记录摘要和已知限制。

任一通用写工具出现、任一 Advice 导致数据库变化、或报告/stdout/审计中出现凭据，都视为
阻断性问题，需发布补丁版本并对出问题的版本执行 `npm deprecate`。

## 故障回退

- MCP 客户端改回上一个已知可用的固定版本并重启 MCP 进程。
- 发现问题的版本只做 `npm deprecate`，不 unpublish、不覆盖。
- 仓库内的 `npm run cloud:validate`（基于源码的 engine 级检查）仍可用于开发排查，
  但不能替代对已安装包的验收。
