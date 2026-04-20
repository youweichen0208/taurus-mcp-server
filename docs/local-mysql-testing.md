# 华为云 TaurusDB MCP — 本地 MySQL 测试指南

> 本文档聚焦一件事：先用本地 MySQL 把当前 `@huaweicloud/taurusdb-mcp` 的主链路测稳，再进入云端 TaurusDB 验证。

配套阅读：

- [`requirements.md`](./requirements.md)
- [`architecture.md`](./architecture.md)
- [`taurusdb-mcp-implementation-plan.md`](./taurusdb-mcp-implementation-plan.md)
- [`mcp-plan.md`](./mcp-plan.md)

---

## 1. 文档定位

这份文档回答 4 个问题：

- 为什么当前阶段应该优先用本地 MySQL 测 MCP
- 本地 MySQL 可以覆盖当前 MCP 的哪些功能和能力
- 本地测试环境应该如何准备
- 本地测完之后，如何再切换到云端 TaurusDB

它不是架构文档，也不是实施计划文档，而是一份**面向联调和验收的测试文档**。

---

## 2. 为什么先测本地 MySQL

当前 MCP 已经具备以下结构：

- `packages/core`：承载 `TaurusDBEngine`、schema、guardrail、executor、confirmation、query tracker
- `packages/mcp`：承载 MCP `stdio` server、tool registry、response envelope、`init`

在这个阶段，先用本地 MySQL 做测试有三个明显好处：

### 2.1 先把代码问题和云环境问题拆开

如果一上来就直接测云端 TaurusDB，任何失败都可能来自：

- 本地代码逻辑
- MCP 协议适配
- 凭证配置
- 网络可达性
- 白名单 / 安全组
- TLS / 证书
- 云端权限模型
- TaurusDB 内核差异

这会导致排障信号非常混乱。

本地 MySQL 可以先把下面这些链路独立验证掉：

- `stdio` 启动是否正常
- tools 注册是否正确
- datasource/profile/context 解析是否正确
- schema introspection 是否正确
- readonly / explain / mutation 执行链路是否正确
- confirmation token 是否正确
- query status / cancel 是否正确
- envelope / error mapping / stderr 边界是否正确

### 2.2 调试成本低、反馈快

本地 MySQL 有这些优势：

- 可直接 reset 数据
- 可快速重建 schema 和 seed 数据
- 可模拟错误输入
- 可方便制造慢查询和超时场景
- 不依赖云网络和实例状态

### 2.3 更适合先建立稳定测试基线

建议把本地 MySQL 作为第一阶段基线：

1. 先测本地 MySQL，证明 MCP 主链路正确
2. 再测云端 TaurusDB，识别 Taurus 专属差异
3. 最后补 TaurusDB 定制测试项

---

## 3. 本地 MySQL 能覆盖哪些 MCP 能力

### 3.1 可完整覆盖的能力

下表中的能力，原则上都可以在本地 MySQL 下完成主功能验证。

| MCP Tool | 本地 MySQL 是否可测 | 说明 |
| --- | --- | --- |
| `ping` | 是 | 不依赖数据库，验证 server 存活与 MCP 调用链路 |
| `list_data_sources` | 是 | 验证 profile 加载、默认 datasource、MCP 返回结构 |
| `list_databases` | 是 | 验证 schema introspector 与 datasource context |
| `list_tables` | 是 | 验证数据库级表发现 |
| `describe_table` | 是 | 验证列、索引、主键、engine hints |
| `sample_rows` | 是 | 验证 sample、脱敏、裁剪、输出格式 |
| `execute_readonly_sql` | 是 | 验证只读 SQL 执行、guardrail、结果裁剪、错误映射 |
| `explain_sql` | 是 | 验证 explain 结果、风险摘要、metadata |
| `get_query_status` | 是 | 验证 query tracker 与 `query_id` 生命周期 |
| `cancel_query` | 是 | 验证 cancel path、running/completed/not_found 行为 |
| `execute_sql` | 是 | 验证 mutation 开关、确认流、写入执行、受影响行数 |
| `init` | 是 | 不依赖数据库，可本地直接测试客户端配置写入 |

### 3.2 可部分覆盖的能力

这些能力可以在本地 MySQL 下验证主逻辑，但不能完全替代 TaurusDB 验证。

| 能力 | 本地可覆盖部分 | 仍需云端补测部分 |
| --- | --- | --- |
| 权限模型 | readonly / mutation 用户分离 | TaurusDB 实例真实账号权限与授权细节 |
| explain 风险判断 | explain 主流程、risk summary | TaurusDB 内核计划输出差异 |
| schema introspection | `information_schema` 查询主链路 | TaurusDB 特定元数据差异 |
| timeout / cancel | 主逻辑、query tracker、cancel path | 云环境下真实网络延迟和内核中断语义 |
| 大结果集裁剪 | row/column/field truncation | 云端真实大表与慢查询行为 |

### 3.3 本地 MySQL 不能替代的能力

下列能力必须在云端 TaurusDB 做最终验证：

- 云网络可达性
- 安全组 / 白名单 / VPC / 跳板机链路
- TLS / 证书配置
- TaurusDB 内核特定行为
- 云端真实账号权限边界
- 真实实例参数与资源限制
- 云侧慢查询、锁等待、异常恢复语义

结论：**本地 MySQL 可以完成当前 MCP 的功能性主验证，但不能替代 TaurusDB 的环境验证和兼容性验证。**

---

## 4. 推荐的本地测试范围

建议把本地测试拆成 5 组。

### 4.1 A 组：Server 启动与 MCP 协议层

目标：确认 MCP 形态本身工作正常。

覆盖项：

- server 能通过 `stdio` 启动
- `tools/list` 返回完整 tool 集合
- `tools/call` 正常返回 structured content
- 日志走 stderr，不污染 stdout
- `enableMutations=false/true` 下 tool 暴露行为正确

### 4.2 B 组：Schema 探查能力

目标：确认 schema 相关能力正确。

覆盖项：

- `list_data_sources`
- `list_databases`
- `list_tables`
- `describe_table`
- `sample_rows`

重点看：

- datasource / database 上下文是否正确
- 表字段、索引、主键是否返回正确
- sample 是否有截断和脱敏行为
- 错误输入是否映射到正确错误码

### 4.3 C 组：只读 SQL 能力

目标：确认只读 SQL 主路径正确。

覆盖项：

- `execute_readonly_sql`
- `explain_sql`
- readonly guardrail
- 结果裁剪
- metadata 返回

重点看：

- `query_id`、`task_id`、`sql_hash` 是否返回
- `SELECT` / `SHOW` / `DESCRIBE` 是否能执行
- 非只读 SQL 是否被 `execute_readonly_sql` 阻断
- explain 返回的 risk summary 是否完整

### 4.4 D 组：写 SQL 与确认流

目标：确认 mutation 主路径正确。

覆盖项：

- `execute_sql` 默认不暴露
- `enableMutations=true` 后才暴露
- `UPDATE/DELETE` 的确认流
- `confirmation_token` 的签发、校验、一次性使用
- mutation 结果与 `affected_rows`

重点看：

- 不带 token 时是否返回 `CONFIRMATION_REQUIRED`
- 带错误 token 时是否返回 `CONFIRMATION_INVALID`
- 带正确 token 时是否执行成功
- 同一 token 是否不可重复使用

### 4.5 E 组：查询状态、取消与异常路径

目标：确认运行时行为不是 demo 级别，而是可观测、可追踪。

覆盖项：

- `get_query_status`
- `cancel_query`
- timeout path
- connection failure path
- datasource not found path
- invalid input path

重点看：

- running / completed / cancelled / failed / not_found 是否正确
- 取消后的状态是否稳定
- 超时是否映射为 `QUERY_TIMEOUT`
- datasource 缺失是否映射为 `DATASOURCE_NOT_FOUND`

---

## 5. 本地 MySQL 测试环境建议

### 5.1 最小环境

建议的本地环境：

- Node.js `>= 20`
- npm
- 一套本地 MySQL 8.x
- 当前仓库已执行 `npm install`

MySQL 可以来自：

- 本机安装的 MySQL
- Docker 启动的 MySQL
- 本地开发机已存在的测试实例

### 5.2 推荐测试库

建议准备一个独立测试库，例如：

- 数据库名：`taurus_mcp_test`

建议至少有以下表：

- `orders`
- `users`
- `payments`
- `audit_events`

仓库里已经提供了对应测试资产：

- [local-mysql-schema.sql](/Users/youweichen/projects/taurus-mcp-server/testdata/mysql/local-mysql-schema.sql)
- [local-mysql-seed.sql](/Users/youweichen/projects/taurus-mcp-server/testdata/mysql/local-mysql-seed.sql)
- [local-mysql-profiles.example.json](/Users/youweichen/projects/taurus-mcp-server/testdata/mysql/local-mysql-profiles.example.json)
- [README.md](/Users/youweichen/projects/taurus-mcp-server/testdata/mysql/README.md)

建议导入：

```bash
mysql -uroot -p < testdata/mysql/local-mysql-schema.sql
mysql -uroot -p < testdata/mysql/local-mysql-seed.sql
```

### 5.3 推荐样例字段

建议字段覆盖这些类型：

- 主键：`id`
- 时间列：`created_at`, `updated_at`
- 过滤列：`status`, `user_id`, `order_no`
- 敏感列：`email`, `phone`, `id_card`
- 大字段：`remark`, `payload_json`

这样更容易验证：

- `engineHints`
- sensitive column 处理
- sample rows 的裁剪行为
- explain 与 where/filter 场景

---

## 6. 本地配置建议

### 6.1 推荐先走 datasource profile

不要一开始把本地测试写死在代码里，建议直接按产品真实方式配置 datasource profile。

建议准备一个本地 datasource，例如：

- datasource: `local_mysql`
- engine: `mysql`
- host: `127.0.0.1`
- port: `3306`
- database: `taurus_mcp_test`

如果你想直接复用仓库内示例，可参考：

- [local-mysql-profiles.example.json](/Users/youweichen/projects/taurus-mcp-server/testdata/mysql/local-mysql-profiles.example.json)

### 6.2 建议同时准备两类账号

如果本地环境允许，建议准备：

- readonly 用户：用于 `execute_readonly_sql`
- mutation 用户：用于 `execute_sql`

这样可以更贴近真实 TaurusDB 场景，也能提前发现：

- readonly session 是否错误拿到写权限
- mutation 模式下账号是否缺失
- pool / credential resolver 是否正确

### 6.3 本地阶段建议的开关策略

建议分两轮：

**第一轮：默认只读**

- `enableMutations=false`
- 重点测 schema、readonly、explain、status、cancel

**第二轮：开启 mutation**

- `enableMutations=true`
- 重点测 confirmation token 和写 SQL

### 6.4 本地环境变量配置步骤

下面给一套可直接照着做的步骤。

**步骤 1：复制 profile 示例**

```bash
cp testdata/mysql/local-mysql-profiles.example.json /tmp/taurusdb-local-profiles.json
```

**步骤 2：设置 profile 中引用的密码环境变量**

```bash
export TAURUSDB_LOCAL_MYSQL_RO_PASSWORD='your_ro_password'
export TAURUSDB_LOCAL_MYSQL_RW_PASSWORD='your_rw_password'
```

**步骤 3：设置 MCP 启动环境变量**

```bash
export TAURUSDB_SQL_PROFILES=/tmp/taurusdb-local-profiles.json
export TAURUSDB_DEFAULT_DATASOURCE=local_mysql
export TAURUSDB_MCP_LOG_LEVEL=info
```

如果你要测试写 SQL，再加：

```bash
export TAURUSDB_MCP_ENABLE_MUTATIONS=true
```

**步骤 4：如果你要跑本地 MySQL 自动化集成测试，再额外设置测试环境变量**

```bash
export TAURUSDB_RUN_LOCAL_MYSQL_TESTS=true
export TAURUSDB_TEST_MYSQL_HOST=127.0.0.1
export TAURUSDB_TEST_MYSQL_PORT=3306
export TAURUSDB_TEST_MYSQL_DATABASE=taurus_mcp_test
export TAURUSDB_TEST_MYSQL_USER=taurus_ro
export TAURUSDB_TEST_MYSQL_PASSWORD='your_ro_password'
export TAURUSDB_TEST_MYSQL_MUTATION_USER=taurus_rw
export TAURUSDB_TEST_MYSQL_MUTATION_PASSWORD='your_rw_password'
```

如果你还想让测试自动重建测试库，再补：

```bash
export TAURUSDB_TEST_MYSQL_BOOTSTRAP_DSN='mysql://root:root@127.0.0.1:3306/mysql'
```

### 6.5 可选：直接走环境变量单 datasource 模式

如果你不想先写 profile，也可以直接用环境变量跑一个 datasource：

```bash
export TAURUSDB_SQL_DATASOURCE=local_mysql
export TAURUSDB_SQL_ENGINE=mysql
export TAURUSDB_SQL_HOST=127.0.0.1
export TAURUSDB_SQL_PORT=3306
export TAURUSDB_SQL_DATABASE=taurus_mcp_test
export TAURUSDB_SQL_USER=taurus_ro
export TAURUSDB_SQL_PASSWORD='your_ro_password'
export TAURUSDB_SQL_MUTATION_USER=taurus_rw
export TAURUSDB_SQL_MUTATION_PASSWORD='your_rw_password'
export TAURUSDB_DEFAULT_DATASOURCE=local_mysql
export TAURUSDB_MCP_ENABLE_MUTATIONS=true
```

推荐仍然优先使用 profile 文件，因为更接近真实交付方式。

---

## 7. 本地 MySQL 下建议执行的测试清单

### 7.1 基础 smoke

- `ping`
- `list_data_sources`
- `list_databases`
- `list_tables`
- `describe_table`
- `sample_rows`

### 7.2 只读 SQL

建议至少覆盖以下 SQL：

```sql
SELECT 1;
SHOW TABLES;
SELECT id, status, created_at FROM orders ORDER BY created_at DESC LIMIT 5;
SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY status;
SELECT o.id, u.email FROM orders o JOIN users u ON u.id = o.user_id LIMIT 10;
```

### 7.3 Explain

建议至少覆盖以下 SQL：

```sql
SELECT id, status FROM orders WHERE created_at >= NOW() - INTERVAL 7 DAY ORDER BY created_at DESC LIMIT 20;
SELECT * FROM orders WHERE status = 'paid';
UPDATE orders SET status = 'cancelled' WHERE id = 1;
```

### 7.4 Mutation + confirmation

建议至少覆盖以下 SQL：

```sql
UPDATE orders SET status = 'cancelled' WHERE id = 1;
DELETE FROM audit_events WHERE id = 1;
```

同时验证：

- 第一次调用返回 `CONFIRMATION_REQUIRED`
- 第二次带 token 才真正执行
- token 重复使用会失败

### 7.5 阻断与错误场景

建议覆盖：

```sql
UPDATE orders SET status = 'cancelled';
DELETE FROM orders;
SELECT * FROM missing_table;
SELECT * FROM orders; DELETE FROM orders WHERE id = 1;
```

要重点确认：

- `BLOCKED_SQL`
- `SQL_SYNTAX_ERROR`
- `DATASOURCE_NOT_FOUND`
- `CONNECTION_FAILED`

### 7.6 状态与取消

建议制造一条慢查询，再测：

- `get_query_status`
- `cancel_query`

如果本地不好构造长查询，也至少要测：

- 已完成 query 的 status
- 不存在 query 的 status / cancel

当前 MCP 还有一个现实边界：

- `query_id` 目前是在执行完成后随结果返回
- 因此纯 MCP 客户端侧很难在“查询仍在运行时”拿到 `query_id` 并发起取消

所以当前本地 MySQL 自动化集成测试里，`cancel_query` 主要验证：

- 已完成 query 的 `completed` 路径
- 不存在 query 的 `not_found` 路径

如果要完整覆盖“运行中查询取消”，更适合后续补：

- 异步 query 模式
- task/streaming tool 模式
- 或 CLI / core 直连层面的长查询测试

---

## 8. 本地测试的完成标准

满足以下条件，说明本地 MySQL 基线已经够稳，可以开始切云端 TaurusDB：

- MCP server 能稳定通过 `stdio` 启动
- 默认 tool 集合完整，开关行为正确
- schema 探查 5 个 tool 都能正确返回
- readonly / explain 主链路稳定
- mutation + confirmation token 主链路稳定
- query status / cancel 至少有一条稳定用例
- 常见错误码映射正确
- 日志不污染 stdout 协议流
- `init` 命令可正确 merge 客户端配置

---

## 9. 本地 MySQL 测完后，如何进入云端 TaurusDB

建议按这个顺序切换：

### 9.1 第一步：保持同样的测试用例，不改用例结构

只替换 datasource，不先改测试内容。

这样可以直接看出：

- 是环境问题
- 还是内核 / 元数据 / 权限差异问题

### 9.2 第二步：优先验证连通与权限

先验证：

- datasource profile
- host / port / network reachability
- readonly 用户
- mutation 用户
- 默认 database

### 9.3 第三步：重跑本地同一批核心测试

先重跑：

- schema 探查
- readonly SQL
- explain
- mutation + confirmation

### 9.4 第四步：补 TaurusDB 专属差异验证

重点补这些：

- explain 输出差异
- `information_schema` 差异
- 锁等待 / 超时 / cancel 表现
- 真实权限边界
- 云环境下的网络与稳定性

---

## 10. 推荐的测试推进顺序

建议按下面的顺序推进：

1. 先完成本地 MySQL 的自动化集成测试
2. 再补一轮本地人工 smoke
3. 再切换到云端 TaurusDB 复跑同一套核心场景
4. 最后补 TaurusDB 专属差异项

这条路径的目标不是“先随便测一下本地”，而是把**本地 MySQL 作为当前 MCP 的第一阶段验收基线**。

