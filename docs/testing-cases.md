# 华为云 TaurusDB MCP 测试用例清单

> 本文档面向测试执行和测试平台录入。建议与 [testing.md](./testing.md) 配合使用：`testing.md` 负责解释测试策略和观测点，本文件负责给出可直接执行的测试用例。

配套文档：

- [testing.md](./testing.md)
- [architecture.md](./architecture.md)
- [progress.md](../progress.md)
- [local-mysql-testing.md](./local-mysql-testing.md)

---

## 1. 使用说明

建议每条用例至少记录以下字段：

- 用例编号
- 用例名称
- 优先级
- 测试层级
- 测试环境
- 前置条件
- 测试步骤
- 预期结果
- 实际结果
- 缺陷编号

本文中的优先级定义：

- `P0`：首阶段发布阻断项，必须通过
- `P1`：高价值主链路，建议本轮全部通过
- `P2`：补充项、健壮性项、回归项

本文中的测试层级定义：

- `L0`：默认自动化基线
- `L1`：本地 MySQL 集成测试
- `L2`：云端 TaurusDB 联调/验收

---

## 2. 环境准备

### 2.1 L0 默认环境

前置：

- 已执行 `npm install`
- 本机 Node.js 版本满足 `>=20`

执行命令：

```bash
npm run check
npm run build
npm test
```

### 2.2 L1 本地 MySQL 环境

前置：

- 有本地 MySQL 8.x
- 已导入测试库和样例数据

初始化：

```bash
mysql -uroot -p < testdata/mysql/local-mysql-schema.sql
mysql -uroot -p < testdata/mysql/local-mysql-seed.sql
```

环境变量：

```bash
export TAURUSDB_RUN_LOCAL_MYSQL_TESTS=true
export TAURUSDB_TEST_MYSQL_HOST=127.0.0.1
export TAURUSDB_TEST_MYSQL_PORT=3306
export TAURUSDB_TEST_MYSQL_DATABASE=taurus_mcp_test
export TAURUSDB_TEST_MYSQL_USER=taurus_ro
export TAURUSDB_TEST_MYSQL_PASSWORD=your_password
export TAURUSDB_TEST_MYSQL_MUTATION_USER=taurus_rw
export TAURUSDB_TEST_MYSQL_MUTATION_PASSWORD=your_password
export TAURUSDB_TEST_MYSQL_BOOTSTRAP_DSN='mysql://root:root@127.0.0.1:3306/mysql'
```

### 2.3 L2 云端 TaurusDB 环境

前置：

- 已有可连通的 TaurusDB 测试实例
- 已配置只读/写入账号
- 已确认安全组、白名单、网络、TLS 策略
- 已准备支持 flashback 和增强 explain 的实例时，再执行 Taurus 专属用例

---

## 3. 用例清单

## 3.1 A 组：默认自动化与工程基线

### TC-L0-001 默认类型检查通过

- 优先级：`P0`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：依赖已安装
- 测试步骤：
  1. 执行 `npm run check`
- 预期结果：
  1. 命令退出码为 0
  2. `core` 与 `mcp` 均通过类型检查
  3. 无新增类型错误

### TC-L0-002 默认构建通过

- 优先级：`P0`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：依赖已安装
- 测试步骤：
  1. 执行 `npm run build`
- 预期结果：
  1. 命令退出码为 0
  2. `packages/core/dist` 与 `packages/mcp/dist` 成功生成
  3. 无构建错误

### TC-L0-003 默认测试基线通过

- 优先级：`P0`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：已完成构建
- 测试步骤：
  1. 执行 `npm test`
- 预期结果：
  1. 命令退出码为 0
  2. `packages/core` 默认测试通过
  3. `packages/mcp` 默认测试通过
  4. 本地 MySQL e2e 允许为 skip，不应导致失败

### TC-L0-004 核心包单测独立通过

- 优先级：`P1`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：已安装依赖
- 测试步骤：
  1. 执行 `npm run test --workspace @huaweicloud/taurusdb-core`
- 预期结果：
  1. 命令退出码为 0
  2. parser、guardrail、confirmation、executor、engine 等测试通过

### TC-L0-005 MCP 包单测独立通过

- 优先级：`P1`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：已安装依赖
- 测试步骤：
  1. 执行 `npm run test --workspace @huaweicloud/taurusdb-mcp`
- 预期结果：
  1. 命令退出码为 0
  2. tool handler、tool registry、stdio、init 相关测试通过

## 3.2 B 组：Server 启动与 Tool 暴露面

### TC-L0-006 MCP Server 可正常启动

- 优先级：`P0`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：已构建 `mcp`
- 测试步骤：
  1. 启动 MCP client 对接 `packages/mcp/dist/index.js`
  2. 执行初始化握手
- 预期结果：
  1. server 启动成功
  2. 握手成功
  3. 无未处理异常退出

### TC-L0-007 默认工具集合正确

- 优先级：`P0`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：server 已启动
- 测试步骤：
  1. 执行 `tools/list`
- 预期结果：
  1. 返回默认 Tool 集合
  2. 至少包含 `ping`、discovery、readonly、explain、status、cancel、init 对应能力
  3. 未开启 mutation 时不暴露 `execute_sql`

### TC-L0-008 enableMutations=false 时隐藏 execute_sql

- 优先级：`P0`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：`TAURUSDB_MCP_ENABLE_MUTATIONS=false`
- 测试步骤：
  1. 启动 server
  2. 执行 `tools/list`
- 预期结果：
  1. 工具列表中没有 `execute_sql`

### TC-L0-009 enableMutations=true 时暴露 execute_sql

- 优先级：`P0`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：`TAURUSDB_MCP_ENABLE_MUTATIONS=true`
- 测试步骤：
  1. 启动 server
  2. 执行 `tools/list`
- 预期结果：
  1. 工具列表中有 `execute_sql`

### TC-L0-010 diagnostics Tool 默认不暴露

- 优先级：`P1`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：server 已启动
- 测试步骤：
  1. 执行 `tools/list`
- 预期结果：
  1. 工具列表中不出现 5 个 diagnostics tool

### TC-L0-011 日志只输出到 stderr

- 优先级：`P0`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：server 已启动，client 可采集 stdout/stderr
- 测试步骤：
  1. 调用一个简单 tool，例如 `ping`
  2. 分别观察 stdout 和 stderr
- 预期结果：
  1. stdout 中只有 MCP 协议数据
  2. stderr 中有日志
  3. stdout 不被日志污染

## 3.3 C 组：Response Envelope 与通用返回结构

### TC-L0-012 成功响应包含标准 envelope

- 优先级：`P0`
- 测试层级：`L0`
- 测试环境：无数据库本地环境或本地 MySQL
- 前置条件：server 已启动
- 测试步骤：
  1. 调用 `ping`
- 预期结果：
  1. 响应包含 `ok`
  2. 响应包含 `summary`
  3. 响应包含 `metadata.task_id`
  4. 成功时 `ok=true`

### TC-L0-013 失败响应包含标准错误结构

- 优先级：`P0`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：server 已启动
- 测试步骤：
  1. 构造一个参数错误的 tool 调用，例如空字符串参数
- 预期结果：
  1. 响应包含 `ok=false`
  2. 响应包含 `error.code`
  3. 响应包含 `error.message`
  4. 响应包含 `metadata.task_id`

### TC-L0-014 未处理异常被包成结构化错误

- 优先级：`P1`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：通过现有测试桩或异常注入触发 handler 抛错
- 测试步骤：
  1. 调用触发未处理异常的 tool
- 预期结果：
  1. client 收到结构化错误响应
  2. 不出现进程崩溃
  3. stderr 有错误日志

## 3.4 D 组：Datasource、Profile 与 Context

### TC-L1-001 list_data_sources 返回公开 datasource 信息

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：profile 已配置
- 测试步骤：
  1. 调用 `list_data_sources`
- 预期结果：
  1. 返回 datasource 列表
  2. 返回 `default_datasource`
  3. 不泄露密码等敏感信息

### TC-L1-002 未显式传 datasource 时使用默认 datasource

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：profile 中配置了默认 datasource
- 测试步骤：
  1. 不传 `datasource` 调用 `list_databases`
- 预期结果：
  1. 使用默认 datasource 成功返回结果

### TC-L1-003 显式 datasource 可覆盖默认 datasource

- 优先级：`P1`
- 测试层级：`L1`
- 测试环境：本地 MySQL 或多 datasource 环境
- 前置条件：至少有两个 datasource
- 测试步骤：
  1. 传入非默认 datasource 调用 `list_databases`
- 预期结果：
  1. 返回结果来自显式指定的 datasource

### TC-L1-004 显式 database 可覆盖 profile 默认库

- 优先级：`P1`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：profile 配置默认库，且实例存在其他库
- 测试步骤：
  1. 传入 `database` 调用 `list_tables`
- 预期结果：
  1. 返回指定库中的表

### TC-L1-005 datasource 不存在时报错

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：server 已启动
- 测试步骤：
  1. 传不存在的 `datasource` 调用任意需要 context 的 tool
- 预期结果：
  1. 返回结构化错误
  2. `error.code` 为 `DATASOURCE_NOT_FOUND` 或等价错误

### TC-L1-006 缺少 database 时返回明确错误

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：profile 中未设置默认库
- 测试步骤：
  1. 不传 `database` 调用 `list_tables` 或 `describe_table`
- 预期结果：
  1. 返回结构化错误
  2. 错误提示要求提供 `database`

## 3.5 E 组：Schema 探查能力

### TC-L1-007 list_databases 返回数据库列表

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：测试库已创建
- 测试步骤：
  1. 调用 `list_databases`
- 预期结果：
  1. 返回数据库列表
  2. 包含 `taurus_mcp_test`

### TC-L1-008 list_tables 返回目标库下的表列表

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：测试库已导入 schema
- 测试步骤：
  1. 调用 `list_tables`
  2. `database=taurus_mcp_test`
- 预期结果：
  1. 返回 `orders`、`users`、`payments`、`audit_events`

### TC-L1-009 describe_table 返回列、索引、主键信息

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：`orders` 表存在
- 测试步骤：
  1. 调用 `describe_table`
  2. `database=taurus_mcp_test`
  3. `table=orders`
- 预期结果：
  1. 返回列定义
  2. 返回索引信息
  3. 返回 `primary_key`
  4. 返回 `engine_hints`

### TC-L1-010 sample_rows 默认返回小样本

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：`users` 表有数据
- 测试步骤：
  1. 调用 `sample_rows`
  2. 不传 `n`
- 预期结果：
  1. 返回默认 sample size
  2. 返回 `columns` 和 `rows`
  3. 返回 `sample_size`

### TC-L1-011 sample_rows 指定 n 生效

- 优先级：`P1`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：目标表有足够数据
- 测试步骤：
  1. 调用 `sample_rows`
  2. 指定 `n=2`
- 预期结果：
  1. `sample_size=2`
  2. 返回 2 行或不超过 2 行

### TC-L1-012 sample_rows 对敏感列脱敏

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：`users` 表含 `email`、`phone`、`id_card` 等敏感字段
- 测试步骤：
  1. 调用 `sample_rows`
  2. 观察返回数据和 `redacted_columns`
- 预期结果：
  1. 敏感字段不以原文暴露
  2. `redacted_columns` 包含预期字段

### TC-L1-013 describe_table 请求不存在表时报错

- 优先级：`P1`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：server 已启动
- 测试步骤：
  1. 调用 `describe_table`
  2. `table=not_exists`
- 预期结果：
  1. 返回结构化错误
  2. 错误信息可定位目标表不存在

## 3.6 F 组：只读 SQL 与 Explain

### TC-L1-014 execute_readonly_sql 执行 SELECT 聚合查询成功

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：`orders` 表有样例数据
- 测试步骤：
  1. 调用 `execute_readonly_sql`
  2. SQL 为 `SELECT status, COUNT(*) AS order_count FROM orders GROUP BY status ORDER BY status`
- 预期结果：
  1. `ok=true`
  2. 返回 `columns`、`rows`
  3. `metadata.query_id` 存在
  4. `metadata.sql_hash` 存在
  5. `metadata.statement_type=select`

### TC-L1-015 execute_readonly_sql 执行 SHOW 成功

- 优先级：`P1`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：数据库可连通
- 测试步骤：
  1. 调用 `execute_readonly_sql`
  2. SQL 为 `SHOW TABLES`
- 预期结果：
  1. 成功返回结果
  2. `statement_type=show`

### TC-L1-016 execute_readonly_sql 执行 DESCRIBE 成功

- 优先级：`P1`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：目标表存在
- 测试步骤：
  1. 调用 `execute_readonly_sql`
  2. SQL 为 `DESCRIBE orders`
- 预期结果：
  1. 成功返回结果
  2. `statement_type=describe`

### TC-L1-017 execute_readonly_sql 对写 SQL 进行阻断

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：server 已启动
- 测试步骤：
  1. 调用 `execute_readonly_sql`
  2. SQL 为 `UPDATE orders SET status='paid' WHERE id=1`
- 预期结果：
  1. 返回 `ok=false`
  2. `error.code=BLOCKED_SQL`
  3. 返回 reason code 与 risk hint

### TC-L1-018 execute_readonly_sql 对非法 SQL 返回语法错误

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：server 已启动
- 测试步骤：
  1. 调用 `execute_readonly_sql`
  2. SQL 为明显非法语句，如 `SELEC FROM`
- 预期结果：
  1. 返回结构化错误
  2. `error.code=SQL_SYNTAX_ERROR` 或等价错误

### TC-L1-019 explain_sql 返回执行计划和 guardrail 信息

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：目标表存在
- 测试步骤：
  1. 调用 `explain_sql`
  2. SQL 为 `SELECT id, status FROM orders WHERE status='paid' ORDER BY created_at DESC LIMIT 5`
- 预期结果：
  1. 返回 `plan`
  2. 返回 `guardrail`
  3. 返回 `metadata.query_id`
  4. `summary` 可读

### TC-L1-020 只读大结果集触发裁剪

- 优先级：`P1`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：准备足够多的测试数据，或调小返回上限
- 测试步骤：
  1. 调用 `execute_readonly_sql`
  2. 执行会返回大结果集的 SQL
- 预期结果：
  1. `truncated=true`
  2. `row_truncated`、`column_truncated` 或 `field_truncated` 至少一项符合预期

### TC-L1-021 只读结果含敏感字段时返回脱敏/裁剪标记

- 优先级：`P1`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：目标表中包含敏感字段
- 测试步骤：
  1. 调用 `execute_readonly_sql`
  2. 查询敏感列
- 预期结果：
  1. 返回 `redacted_columns` 或等价字段
  2. 敏感信息不以原文完全暴露

## 3.7 G 组：写 SQL 与 Confirmation Token

### TC-L1-022 execute_sql 默认不暴露

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：`TAURUSDB_MCP_ENABLE_MUTATIONS=false`
- 测试步骤：
  1. 启动 server
  2. 调用 `tools/list`
- 预期结果：
  1. 不出现 `execute_sql`

### TC-L1-023 execute_sql 开启后可见

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：`TAURUSDB_MCP_ENABLE_MUTATIONS=true`
- 测试步骤：
  1. 启动 server
  2. 调用 `tools/list`
- 预期结果：
  1. 出现 `execute_sql`

### TC-L1-024 execute_sql 对只读 SQL 阻断

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：mutation 已开启
- 测试步骤：
  1. 调用 `execute_sql`
  2. SQL 为 `SELECT * FROM orders LIMIT 1`
- 预期结果：
  1. 返回 `BLOCKED_SQL`
  2. 数据库不发生写入

### TC-L1-025 UPDATE 带 WHERE 但不带 token 时返回 confirmation required

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：mutation 已开启，写账号可用
- 测试步骤：
  1. 调用 `execute_sql`
  2. SQL 为 `UPDATE orders SET status='paid' WHERE id=1`
  3. 不传 `confirmation_token`
- 预期结果：
  1. 返回 `ok=false`
  2. `error.code=CONFIRMATION_REQUIRED`
  3. `data.confirmation_token` 存在
  4. 数据库此时未发生变更

### TC-L1-026 使用错误 token 重试返回 confirmation invalid

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：已取得合法 token，或手工构造错误 token
- 测试步骤：
  1. 调用 `execute_sql`
  2. SQL 为同一条 UPDATE
  3. 传入错误的 `confirmation_token`
- 预期结果：
  1. 返回 `CONFIRMATION_INVALID`
  2. 数据库未发生变更

### TC-L1-027 使用正确 token 重试执行成功

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：已通过上一轮调用获得正确 token
- 测试步骤：
  1. 使用完全相同的 SQL
  2. 携带正确 `confirmation_token` 再次调用 `execute_sql`
- 预期结果：
  1. 执行成功
  2. 返回 `affected_rows`
  3. 数据库中目标记录实际被修改

### TC-L1-028 同一 token 不可重复使用

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：已有一个已成功使用过的 token
- 测试步骤：
  1. 继续用同一 token 和相同 SQL 再执行一次
- 预期结果：
  1. 返回 `CONFIRMATION_INVALID` 或等价失败
  2. token 一次性语义成立

### TC-L1-029 无 WHERE 的高风险 UPDATE 被阻断

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：mutation 已开启
- 测试步骤：
  1. 调用 `execute_sql`
  2. SQL 为 `UPDATE orders SET status='paid'`
- 预期结果：
  1. 返回 `BLOCKED_SQL`
  2. 数据库无变更

### TC-L1-030 mutation 执行失败时回滚

- 优先级：`P1`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：mutation 已开启
- 测试步骤：
  1. 准备一条会在事务中失败的 mutation
  2. 按确认流执行
  3. 检查数据库数据
- 预期结果：
  1. 返回错误
  2. 未产生部分提交
  3. 数据保持失败前状态

## 3.8 H 组：Query Status、Cancel、Timeout

### TC-L1-031 只读执行后可通过 query_id 查询状态

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：已成功执行一条 readonly SQL
- 测试步骤：
  1. 取返回的 `metadata.query_id`
  2. 调用 `get_query_status`
- 预期结果：
  1. 返回 `completed`
  2. 返回相同 `query_id`

### TC-L1-032 查询不存在的 query_id 返回 not_found

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：server 已启动
- 测试步骤：
  1. 调用 `get_query_status`
  2. `query_id=qry_missing_local_mysql`
- 预期结果：
  1. 返回 `status=not_found`
  2. 无未处理异常

### TC-L1-033 取消已完成查询返回 completed

- 优先级：`P1`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：已有一条已完成查询
- 测试步骤：
  1. 调用 `cancel_query`
  2. 使用已完成查询的 `query_id`
- 预期结果：
  1. 返回 `status=completed` 或约定的稳定结果

### TC-L1-034 取消不存在查询返回 not_found

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：server 已启动
- 测试步骤：
  1. 调用 `cancel_query`
  2. `query_id=qry_missing_local_mysql`
- 预期结果：
  1. 返回 `status=not_found`

### TC-L1-035 长查询取消路径可工作

- 优先级：`P1`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：可制造慢查询
- 测试步骤：
  1. 发起一条可持续执行的查询
  2. 在运行中调用 `cancel_query`
  3. 再调用 `get_query_status`
- 预期结果：
  1. 取消请求成功
  2. 最终状态为 `cancelled` 或等价结果
  3. 无进程异常

### TC-L1-036 timeout 路径返回结构化错误

- 优先级：`P1`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：可制造超时查询
- 测试步骤：
  1. 执行一条慢查询
  2. 设置很小的 `timeout_ms`
- 预期结果：
  1. 返回 `QUERY_TIMEOUT`
  2. 错误结构完整

## 3.9 I 组：连接失败与配置异常

### TC-L1-037 凭证错误时返回连接失败

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：故意配置错误密码
- 测试步骤：
  1. 调用需要连接数据库的 tool
- 预期结果：
  1. 返回 `CONNECTION_FAILED` 或等价错误
  2. 不出现未处理异常

### TC-L1-038 mutation 用户缺失时 execute_sql 失败

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：开启 mutation，但不配置 mutation 用户
- 测试步骤：
  1. 调用 `execute_sql`
  2. 按确认流重试
- 预期结果：
  1. 返回配置或连接相关错误
  2. 不执行实际写入

### TC-L1-039 profile 配置缺失时无法解析 datasource

- 优先级：`P0`
- 测试层级：`L1`
- 测试环境：本地 MySQL 或本地环境
- 前置条件：不提供有效 profiles
- 测试步骤：
  1. 启动 server
  2. 调用依赖 datasource 的 tool
- 预期结果：
  1. 返回 datasource 解析失败错误

## 3.10 J 组：TaurusDB 能力探测与专属 Tool

### TC-L2-001 非 Taurus 环境下不错误暴露专属 Tool

- 优先级：`P1`
- 测试层级：`L2`
- 测试环境：非 Taurus 的 MySQL 环境
- 前置条件：server 可正常启动
- 测试步骤：
  1. 执行 `tools/list`
- 预期结果：
  1. 不应错误暴露依赖 Taurus feature 的 tool
  2. 若仅 capability 基础 tool 暴露，应符合实现门控规则

### TC-L2-002 Taurus 环境下 capability probe 成功

- 优先级：`P0`
- 测试层级：`L2`
- 测试环境：云端 TaurusDB
- 前置条件：实例可连通，账号有必要权限
- 测试步骤：
  1. 启动 server
  2. 调用 `get_kernel_info`
  3. 调用 `list_taurus_features`
- 预期结果：
  1. 成功返回 kernel 信息
  2. 成功返回 feature matrix
  3. 返回内容与实例实际能力基本一致

### TC-L2-003 explain_sql_enhanced 在支持环境下可用

- 优先级：`P0`
- 测试层级：`L2`
- 测试环境：支持增强 explain 的 TaurusDB
- 前置条件：feature probe 表明相关功能可用
- 测试步骤：
  1. 调用 `explain_sql_enhanced`
- 预期结果：
  1. 成功返回增强计划信息
  2. 返回 `taurusHints`
  3. 返回 `optimizationSuggestions`

### TC-L2-004 flashback_query 在支持环境下可用

- 优先级：`P0`
- 测试层级：`L2`
- 测试环境：支持 flashback 的 TaurusDB
- 前置条件：目标表存在可追溯数据，实例支持 flashback
- 测试步骤：
  1. 调用 `flashback_query`
  2. 传入合法历史时间点
- 预期结果：
  1. 成功返回历史只读数据
  2. 不修改当前数据

### TC-L2-005 不支持 flashback 的环境不应误通过

- 优先级：`P1`
- 测试层级：`L2`
- 测试环境：不支持 flashback 的环境
- 前置条件：已确认 feature 不支持
- 测试步骤：
  1. 观察 `tools/list` 或直接调用 `flashback_query`
- 预期结果：
  1. 要么 tool 不暴露
  2. 要么返回明确的 `UNSUPPORTED_FEATURE` 或等价错误

## 3.11 K 组：Diagnostics Scaffold

### TC-L0-015 diagnostics tool 默认不注册

- 优先级：`P1`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：server 已启动
- 测试步骤：
  1. 执行 `tools/list`
- 预期结果：
  1. 默认工具集中不出现 diagnostics tool

### TC-L0-016 diagnostics handler contract 稳定

- 优先级：`P2`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：通过现有测试桩直接调用 handler
- 测试步骤：
  1. 调用任意 diagnostics handler
- 预期结果：
  1. 返回结构化 scaffold 结果
  2. 字段名稳定
  3. 明确标记当前仍是 scaffold

### TC-L0-017 diagnostics 输入校验生效

- 优先级：`P2`
- 测试层级：`L0`
- 测试环境：无数据库本地环境
- 前置条件：可直接调用 handler
- 测试步骤：
  1. 缺少必填字段调用 diagnostics handler
- 预期结果：
  1. 返回输入校验错误

## 3.12 L 组：init 命令

### TC-L0-018 init 可写入 Cursor 配置

- 优先级：`P1`
- 测试层级：`L0`
- 测试环境：本地文件系统
- 前置条件：准备临时配置目录
- 测试步骤：
  1. 执行 `init --client cursor`
- 预期结果：
  1. 正确写入 server entry
  2. JSON 结构有效

### TC-L0-019 init 遇到已有 entry 时不覆盖

- 优先级：`P1`
- 测试层级：`L0`
- 测试环境：本地文件系统
- 前置条件：目标配置文件中已有同名 server entry
- 测试步骤：
  1. 再次执行 `init --client cursor`
- 预期结果：
  1. 不破坏已有 entry
  2. merge 行为符合预期

### TC-L0-020 init 对不同 client 生成正确配置

- 优先级：`P2`
- 测试层级：`L0`
- 测试环境：本地文件系统
- 前置条件：支持多个 client 参数
- 测试步骤：
  1. 分别执行 `init --client claude`
  2. 执行 `init --client cursor`
  3. 执行 `init --client vscode`
- 预期结果：
  1. 各目标客户端配置文件写入正确

## 3.13 M 组：回归与非功能性检查

### TC-L1-040 连续多次调用简单 tool 稳定

- 优先级：`P2`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：server 已启动
- 测试步骤：
  1. 连续多次调用 `ping`
  2. 连续多次调用 `list_tables`
- 预期结果：
  1. 无随机失败
  2. 无明显状态污染

### TC-L1-041 连续多次执行 readonly 查询稳定

- 优先级：`P2`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：目标表存在
- 测试步骤：
  1. 重复执行同一条 readonly SQL 多次
- 预期结果：
  1. 返回结构稳定
  2. 无随机异常

### TC-L1-042 日志不泄露敏感配置

- 优先级：`P1`
- 测试层级：`L1`
- 测试环境：本地 MySQL
- 前置条件：启动 server 并采集 stderr
- 测试步骤：
  1. 启动 server
  2. 调用若干 tool
  3. 检查 stderr
- 预期结果：
  1. 日志中不出现数据库密码明文
  2. 配置输出为脱敏结果

### TC-L2-006 云端环境网络/权限/TLS 验证通过

- 优先级：`P0`
- 测试层级：`L2`
- 测试环境：云端 TaurusDB
- 前置条件：准备目标实例和账号
- 测试步骤：
  1. 执行 discovery
  2. 执行 readonly
  3. 执行 explain
  4. 执行 mutation confirmation
- 预期结果：
  1. 无网络不可达问题
  2. 无白名单/安全组阻断
  3. TLS 或安全策略符合预期
  4. 账号权限符合只读/写入分离设计

---

## 4. 建议执行顺序

建议测试团队按下面顺序执行：

1. 先执行 `TC-L0-001` 到 `TC-L0-020`
2. 再执行 `TC-L1-001` 到 `TC-L1-042`
3. 最后执行 `TC-L2-001` 到 `TC-L2-006`

如果 `L0` 不通过，不建议直接进入 `L1/L2`。

如果 `L1` 不通过，不建议直接把问题归因到 TaurusDB。

---

## 5. 首阶段建议必过用例

建议以下用例作为首阶段提测/验收阻断项：

- `TC-L0-001`
- `TC-L0-002`
- `TC-L0-003`
- `TC-L0-006`
- `TC-L0-007`
- `TC-L0-008`
- `TC-L0-009`
- `TC-L0-011`
- `TC-L0-012`
- `TC-L0-013`
- `TC-L1-001`
- `TC-L1-005`
- `TC-L1-006`
- `TC-L1-007`
- `TC-L1-008`
- `TC-L1-009`
- `TC-L1-010`
- `TC-L1-012`
- `TC-L1-014`
- `TC-L1-017`
- `TC-L1-018`
- `TC-L1-019`
- `TC-L1-022`
- `TC-L1-023`
- `TC-L1-024`
- `TC-L1-025`
- `TC-L1-026`
- `TC-L1-027`
- `TC-L1-028`
- `TC-L1-029`
- `TC-L1-031`
- `TC-L1-032`
- `TC-L1-034`
- `TC-L1-037`
- `TC-L1-038`
- `TC-L2-002`
- `TC-L2-003`
- `TC-L2-004`
- `TC-L2-006`

---

## 6. 当前允许不作为阻断项的用例

以下用例当前更适合作为增强项、补充项或回归项：

- 长查询取消稳定性
- 大结果集极限行为
- diagnostics scaffold contract
- 多 datasource 覆盖验证
- `init` 的所有客户端分支
- 高强度重复调用稳定性

---

## 7. 记录建议

测试执行时，建议每条缺陷至少记录：

- 对应用例编号
- 实际输入参数
- 返回的完整 `summary`、`error.code`、`metadata`
- stdout/stderr 关键片段
- 数据库前后状态对比
- 是否可稳定复现

如果缺陷发生在云端 TaurusDB，额外记录：

- 实例类型与版本
- 网络位置
- 账号权限模型
- 是否开启 TLS
- feature probe 结果
