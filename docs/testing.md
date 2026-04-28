# 华为云 TaurusDB MCP 测试指南

> 本文档面向测试同学，目标是把当前 `@huaweicloud/taurusdb-mcp` 项目的测试范围、观测点、测试用例设计、执行步骤和验收出口写清楚。

配套阅读：

- [architecture.md](./architecture.md)
- [manual-smoke-test.md](./manual-smoke-test.md)
- [cloud-taurusdb-testing.md](./cloud-taurusdb-testing.md)
- [taurusdb-ops-playbook.md](./taurusdb-ops-playbook.md)
- [progress.md](../progress.md)

---

## 1. 文档定位

这份文档回答 6 个问题：

- 当前版本到底要测什么，不测什么
- 测这个项目时应该重点观察哪些信号
- 应该分几层环境来测
- 各功能模块应该怎么设计测试用例
- 测试时实际要执行哪些命令和手工步骤
- 测试失败后，应该优先怀疑哪一层

这份文档不是架构设计文档，也不是开发实施计划。它是一份**面向测试执行、联调和阶段验收的测试说明**。

---

## 2. 当前测试范围

根据当前架构和进展，项目已经收口为：

- `packages/core`：共享数据面能力与 `TaurusDBEngine`
- `packages/mcp`：MCP `stdio` server、tool registry、tool handler、`init`
- `packages/cli`：当前只有 scaffold，不属于本轮 MCP 测试主体

当前 MCP 首阶段应纳入测试范围的能力：

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
- TaurusDB 首阶段专属能力：
  - `get_kernel_info`
  - `list_taurus_features`
  - `explain_sql_enhanced`
  - `flashback_query`
  - `list_recycle_bin`
  - `restore_recycle_bin_table`

当前已经实现并默认暴露的 diagnostics 能力：

- `diagnose_service_latency`
- `diagnose_db_hotspot`
- `find_top_slow_sql`
- `diagnose_slow_query`
- `diagnose_connection_spike`
- `diagnose_lock_contention`
- `diagnose_replication_lag`
- `diagnose_storage_pressure`

当前明确不在首阶段范围内：

- SQL history / binlog / preflight
- CLI REPL / ask / agent / doctor
- 云控制面功能本身

补充说明：

- `list_recycle_bin` 和 `restore_recycle_bin_table` 属于 TaurusDB 专属能力，只有在 capability probe 命中 `recycle_bin` 时才会进入工具面
- `restore_recycle_bin_table` 还额外受 `TAURUSDB_MCP_ENABLE_MUTATIONS=true` 控制，并且第一次调用必须走 confirmation token

结论：

- 当前测试重点是 **MCP 协议适配 + 数据面主链路 + minimal guardrail + token confirmation + TaurusDB 首阶段差异化能力**
- CLI 不作为本轮主测试对象
- diagnostics 当前默认暴露；本地阶段重点验收 explain / digest / processlist / lock waits / table storage 这类数据面证据链；CES / Cloud Eye 指标源已有第一版配置与 collector，仍需在云端 TaurusDB 联调阶段验证真实指标返回、维度名、权限与时间窗口；`diagnose_lock_contention` 已补 MDL + latest deadlock collector 第一版，DAS / Top SQL / 全量 SQL 与 OS 级存储指标仍放到后续云侧补齐

---

## 3. 测试目标

本项目测试的核心目标不是“某个接口能返回数据”这么简单，而是要证明下面 5 件事：

1. MCP Server 作为 `stdio` 工具服务可正常启动、注册工具并稳定响应。
2. 数据面主链路正确：schema 探查、只读执行、Explain、写 SQL 与确认流都能工作。
3. 安全边界正确：只读/写入分流、guardrail 阻断/确认逻辑、confirmation token 一次性校验都符合预期。
4. 返回结构可消费：response envelope、metadata、error code、日志边界对 MCP 客户端是稳定的。
5. TaurusDB 差异化能力的门控正确：能力探测决定专属 Tool 是否暴露，Taurus 专属功能在兼容环境下可工作。

---

## 4. 分层测试策略

建议把测试分成 4 层，而不是一口气直接上云测。

### 4.1 L0：静态检查与默认自动化基线

目标：先确认仓库在不依赖真实数据库的情况下是健康的。

执行项：

- `npm run check`
- `npm run build`
- `npm test`

覆盖重点：

- `core` 单元测试
- `mcp` 单元测试
- `stdio` 集成测试
- `init` 行为测试

通过标准：

- 所有默认测试通过
- 本地 MySQL e2e 允许默认跳过

### 4.2 L1：本地 MySQL 集成测试

目标：先把代码问题和云环境问题拆开，确认 MCP 主链路本身正确。

覆盖重点：

- datasource/profile/context 解析
- schema introspection
- readonly / explain / mutation 主链路
- confirmation token
- `show_processlist`
- stdout/stderr 边界

### 4.3 L2：云端 TaurusDB 联调测试

目标：验证 TaurusDB 内核差异化行为和真实环境兼容性。

覆盖重点：

- capability probe
- TaurusDB 专属 Tool 动态暴露
- `explain_sql_enhanced`
- `flashback_query`
- 云端网络、权限、TLS、安全组、白名单

### 4.4 L3：阶段验收测试

目标：基于一套固定测试清单给出“是否达到首阶段可交付状态”的结论。

覆盖重点：

- 主链路是否全部通过
- 高风险路径是否有明确阻断或确认流
- 不支持功能是否被正确隐藏或标注
- 错误定位信息是否足够

---

## 5. 测试观测点

测试这个项目时，不要只看“调用成功/失败”。至少要同时观察下面 7 类信号。

### 5.1 Tool 暴露面

需要观察：

- `tools/list` 是否返回预期工具集合
- `execute_sql` 是否只在 `enableMutations=true` 时暴露
- TaurusDB 专属 Tool 是否仅在 probe 成功且 feature 可用时暴露
- diagnostics Tool 当前是否默认暴露

### 5.2 Response Envelope

每个 Tool 返回时，需要观察：

- 是否存在 `ok`
- `summary` 是否可读
- `metadata.task_id` 是否存在
- 成功时 `data` 是否结构稳定
- 失败时 `error.code`、`error.message`、`error.details` 是否合理

重点字段：

- `metadata.task_id`
- `metadata.sql_hash`
- `metadata.statement_type`
- `metadata.duration_ms`

### 5.3 Guardrail 与确认流

需要观察：

- `execute_readonly_sql` 是否阻断写 SQL
- `execute_sql` 是否阻断只读 SQL
- 高风险 mutation 是否返回 `CONFIRMATION_REQUIRED`
- 错误 token 是否返回 `CONFIRMATION_INVALID`
- 正确 token 是否只能成功使用一次
- 被 block 的 SQL 是否返回明确 reason code 和 risk hint

### 5.4 数据库副作用

需要观察：

- 只读工具不会产生写入副作用
- mutation 成功后数据库数据实际变化与 `affected_rows` 一致
- mutation 失败时是否 rollback
- `flashback_query` 是否只返回历史只读结果，不改变当前数据

### 5.5 结果裁剪与脱敏

需要观察：

- 大结果集是否触发 `truncated`
- `row_truncated` / `column_truncated` / `field_truncated` 是否准确
- `redacted_columns` / `dropped_columns` / `truncated_columns` 是否符合预期

### 5.6 执行结果与异常路径

需要观察：

- `duration_ms` 是否稳定返回
- timeout、连接失败、语法错误时错误码是否一致
- Explain 和 readonly 在成功路径上的 metadata 是否稳定
- mutation 确认前后返回结构是否一致可消费

### 5.7 日志与协议边界

需要观察：

- stdout 不应被日志污染
- 日志应写到 stderr
- 错误时 stderr 应有足够定位信息
- tool 调用开始/结束日志是否包含 tool 名称和耗时

---

## 6. 测试环境矩阵

建议至少准备下面 3 套环境。

| 环境             | 目的                   | 是否必测 | 主要覆盖                                                              |
| ---------------- | ---------------------- | -------- | --------------------------------------------------------------------- |
| 无数据库本地环境 | 跑默认自动化基线       | 是       | 构建、单测、协议层、handler、registry、init                           |
| 本地 MySQL       | 跑主功能集成测试       | 是       | schema、readonly、explain、mutation、confirmation、`show_processlist` |
| 云端 TaurusDB    | 跑兼容性与专属能力验证 | 是       | capability probe、专属 Tool、真实网络/权限/TLS                        |

不建议只测云端。

原因：

- 云端失败时噪音太大，不利于分层定位
- 本地 MySQL 更适合先验证主链路正确性
- TaurusDB 更适合做最终兼容性和差异化能力验收

---

## 7. 自动化测试现状

当前仓库已有自动化测试基础：

- `packages/core/tests/*.test.mjs`
- `packages/mcp/tests/*.test.mjs`
- `packages/mcp/tests/local-mysql.test.mjs`

当前默认自动化已覆盖：

- config / profile loader
- datasource resolver
- connection pool
- schema introspector
- sql parser / classifier / validator
- guardrail
- confirmation store
- sql executor
- query tracker
- redaction
- engine 主方法委托
- mcp tool handler
- tool registry
- `stdio` 集成
- `init` 命令

当前 opt-in 自动化覆盖：

- 本地 MySQL 下的 discovery / readonly / explain / mutation confirmation 主链路
- diagnostics tools 默认暴露
- `find_top_slow_sql` / `diagnose_db_hotspot` / `diagnose_service_latency`
- `diagnose_slow_query` explain + digest 证据链
- `diagnose_connection_spike` idle session buildup
- `diagnose_lock_contention` live blocker chain
- `diagnose_storage_pressure` temporary disk spill workload

当前自动化未完全覆盖或仍需人工补测：

- 真实 TaurusDB 环境行为
- 网络与 TLS
- diagnostics 的云侧 CES / Cloud Eye 真实指标返回、维度名、IAM token、权限与时间窗口
- diagnostics 的云侧 DAS / Top SQL / MDL / deadlock history 联合证据
- 大表/大结果集下的行为
- 能力探测与 Taurus 内核差异

---

## 8. 执行方式

### 8.1 默认基线测试

```bash
npm run check
npm run build
npm test
```

### 8.2 只看 `core`

```bash
npm run check --workspace @huaweicloud/taurusdb-core
npm run test --workspace @huaweicloud/taurusdb-core
```

### 8.3 只看 `mcp`

```bash
npm run check --workspace @huaweicloud/taurusdb-mcp
npm run test --workspace @huaweicloud/taurusdb-mcp
```

### 8.4 开启本地 MySQL e2e

至少需要：

```bash
export TAURUSDB_RUN_LOCAL_MYSQL_TESTS=true
export TAURUSDB_TEST_MYSQL_HOST=127.0.0.1
export TAURUSDB_TEST_MYSQL_PORT=3306
export TAURUSDB_TEST_MYSQL_DATABASE=taurus_mcp_test
export TAURUSDB_TEST_MYSQL_USER=taurus_ro
export TAURUSDB_TEST_MYSQL_PASSWORD=your_password
```

如需覆盖 mutation 和自动重建测试库，再补：

```bash
export TAURUSDB_TEST_MYSQL_MUTATION_USER=taurus_rw
export TAURUSDB_TEST_MYSQL_MUTATION_PASSWORD=your_password
export TAURUSDB_TEST_MYSQL_BOOTSTRAP_DSN='mysql://root:root@127.0.0.1:3306/mysql'
```

执行：

```bash
npm run test --workspace @huaweicloud/taurusdb-mcp
```

本地 MySQL 测试资产见：

- [testdata/mysql/README.md](../testdata/mysql/README.md)
- [local-mysql-schema.sql](../testdata/mysql/local-mysql-schema.sql)
- [local-mysql-seed.sql](../testdata/mysql/local-mysql-seed.sql)
- [local-mysql-profiles.example.json](../testdata/mysql/local-mysql-profiles.example.json)

### 8.5 推荐验证顺序

如果当前目标是把 MCP 从“代码已完成”推进到“真实环境已验证”，建议按下面 4 个阶段执行。

#### 阶段一：本地 MySQL 自动化 e2e

目标：先证明 MCP 主链路在真实数据库上跑通。

执行步骤：

1. 初始化本地测试库：

```bash
mysql -uroot -p < testdata/mysql/local-mysql-schema.sql
mysql -uroot -p < testdata/mysql/local-mysql-seed.sql
```

2. 配置本地测试环境变量：

```bash
export TAURUSDB_RUN_LOCAL_MYSQL_TESTS=true
export TAURUSDB_TEST_MYSQL_HOST=127.0.0.1
export TAURUSDB_TEST_MYSQL_PORT=3306
export TAURUSDB_TEST_MYSQL_DATABASE=taurus_mcp_test
export TAURUSDB_TEST_MYSQL_USER=taurus_ro
export TAURUSDB_TEST_MYSQL_PASSWORD='your_ro_password'
export TAURUSDB_TEST_MYSQL_MUTATION_USER=taurus_rw
export TAURUSDB_TEST_MYSQL_MUTATION_PASSWORD='your_rw_password'
export TAURUSDB_TEST_MYSQL_BOOTSTRAP_DSN='mysql://root:root@127.0.0.1:3306/mysql'
```

3. 构建并执行本地 e2e：

```bash
npm run build
npm run test --workspace @huaweicloud/taurusdb-mcp
```

自动化重点覆盖：

- `list_data_sources`
- `list_databases`
- `list_tables`
- `describe_table`
- `show_processlist`
- `execute_readonly_sql`
- `explain_sql`
- `execute_sql` + confirmation flow

通过标准：

- 本地 MySQL e2e 全绿
- readonly / mutation 账号分离符合预期
- `execute_sql` 只在开启 mutations 时暴露
- confirmation token 主链路稳定

#### 阶段二：本地手工 smoke

目标：确认 MCP 从客户端视角可正常消费，而不只是自动化用例通过。

建议先确保本地测试库是通过 compose 启动的：

```bash
docker compose -f testdata/mysql/compose.yaml up -d
docker compose -f testdata/mysql/compose.yaml ps
```

如果你要彻底重建本地数据：

```bash
docker compose -f testdata/mysql/compose.yaml down -v
docker compose -f testdata/mysql/compose.yaml up -d
```

建议手工验证前先准备这组环境变量：

```bash
export TAURUSDB_SQL_ENGINE=mysql
export TAURUSDB_SQL_DATASOURCE=local_mysql
export TAURUSDB_SQL_HOST=127.0.0.1
export TAURUSDB_SQL_PORT=3306
export TAURUSDB_SQL_DATABASE=taurus_mcp_test
export TAURUSDB_SQL_USER=taurus_ro
export TAURUSDB_SQL_PASSWORD='taurus_ro_password'
export TAURUSDB_SQL_MUTATION_USER=taurus_rw
export TAURUSDB_SQL_MUTATION_PASSWORD='taurus_rw_password'
export TAURUSDB_DEFAULT_DATASOURCE=local_mysql
export TAURUSDB_MCP_ENABLE_MUTATIONS=true
export TAURUSDB_MCP_LOG_LEVEL=info
```

然后构建并启动 MCP：

```bash
npm run build
node packages/mcp/dist/index.js
```

建议按下面顺序验证：

1. `list_data_sources`
2. `list_tables`，目标库为 `taurus_mcp_test`
3. `describe_table`，目标表为 `orders`
4. `execute_readonly_sql`，执行一个简单 `SELECT`
5. `explain_sql`，执行一个带过滤条件的查询
6. `execute_sql`，先不带 `confirmation_token`
7. 使用返回的 `confirmation_token` 重试 `execute_sql`

建议手工输入或发给 MCP client 的测试请求如下：

1. `list_data_sources`
   预期：
   默认 datasource 为 `local_mysql`

2. `list_tables`
   参数：
   `database=taurus_mcp_test`
   预期：
   返回 `orders`、`users`、`payments`、`audit_events`

3. `describe_table`
   参数：
   `database=taurus_mcp_test`
   `table=orders`
   预期：
   有 `primary_key`
   有 `indexes`
   `engine_hints.likely_time_columns` 包含 `created_at`

4. `execute_readonly_sql`
   SQL：
   `SELECT id, email, phone, id_card FROM users ORDER BY id LIMIT 2`
   预期：
   `ok=true`
   `metadata.statement_type=select`
   返回结果可用于人工确认敏感字段呈现方式
   `metadata.task_id`、`metadata.sql_hash` 存在

5. `explain_sql`
   SQL：
   `SELECT id, status FROM orders WHERE status = 'paid' ORDER BY created_at DESC LIMIT 5`
   预期：
   返回 `plan`
   返回 `guardrail`

6. `execute_sql`
   SQL：
   `UPDATE orders SET status = 'paid' WHERE id = 1`
   首次不带 `confirmation_token`
   预期：
   返回 `CONFIRMATION_REQUIRED`

7. 再次执行 `execute_sql`
   SQL 保持完全一致
   携带上一步返回的 `confirmation_token`
   预期：
   返回 mutation 成功
   `affected_rows` 合理

手工 smoke 重点观察：

- 是否返回标准 response envelope：`ok`、`summary`、`metadata`
- `metadata.task_id` 是否存在
- `metadata.sql_hash`、`metadata.statement_type`、`metadata.duration_ms` 是否合理
- 写 SQL 是否先返回 `CONFIRMATION_REQUIRED`
- 错误 token 是否返回 `CONFIRMATION_INVALID`
- stdout 是否只输出协议内容，日志是否只写入 stderr

通过标准：

- discovery / readonly / explain / mutation 全部可手工复现
- 返回结构适合客户端消费
- 没有出现未处理异常或协议污染

#### 阶段三：云端 TaurusDB 验证

目标：把当前 MCP / Taurus 全量能力在真实云环境里跑通，并把“代码未接线”和“云端权限/网络/实例差异”严格分开。

这一阶段不要只测 Taurus 专属 Tool。需要把通用主链路、Taurus 专属能力、DAS / slow SQL source、CES metrics source 和 diagnostics 一起验掉。

##### 8.5.1 云端前置项

至少准备：

- 可直连的 TaurusDB / GaussDB(for MySQL) 实例
- readonly 账号
- mutation 账号
- 目标数据库名
- DAS 可用 token
- CES 可用 token
- `project_id`
- `instance_id`
- `node_id`

至少确认：

- 安全组 / 白名单 / VPC / 跳板机链路已放通
- 数据库 TLS 策略与 profile 配置一致
- readonly 账号至少可执行：
  - `SHOW PROCESSLIST`
  - `SHOW REPLICA STATUS` 或 `SHOW SLAVE STATUS`
  - `SHOW ENGINE INNODB STATUS`
  - `performance_schema` 相关只读查询
- mutation 账号具备受控写权限，可完成 `UPDATE ... WHERE ...` 的最小确认流验证

##### 8.5.2 云端环境变量

先按现有 profile 机制配置 datasource，确保 MCP 能先连上数据库。

推荐优先使用高层 cloud resolver 配置。当前默认主路径已经收敛到 `region + AK/SK`：

```bash
export TAURUSDB_CLOUD_REGION=...
export TAURUSDB_CLOUD_ACCESS_KEY_ID=...
export TAURUSDB_CLOUD_SECRET_ACCESS_KEY=...
export TAURUSDB_CLOUD_ENABLE_EVIDENCE=true
```

说明：

- `project_id` 不是首选手工输入项。配置了 region + AK/SK 后，会先尝试自动解析项目。
- `instance_id` 不是首选手工输入项。`npm run cloud:validate` 会优先使用显式 `instance_id`，否则尝试根据 datasource `host/port` 自动解析唯一实例。
- 如果自动解析失败或出现多实例歧义，先调用 `list_cloud_taurus_instances`，再通过 `select_cloud_taurus_instance` 固定当前会话的默认 `instance_id`。
- `instance_name` 只用于展示和人工选择，不应作为唯一键。
- `set_cloud_region` 和 `set_cloud_access_keys` 适合在 MCP 会话内切换云侧上下文，避免反复改 `export`。

如果使用临时 AK/SK，再补：

```bash
export TAURUSDB_CLOUD_SECURITY_TOKEN=...
```

如果需要显式启用 Taurus API slow SQL，再补：

```bash
export TAURUSDB_CLOUD_ENABLE_TAURUS_API=true
```

底层 DAS / CES / Taurus API 环境变量仍然支持，但应视为 override / 调试入口，而不是默认配置路径。

Taurus slow SQL source：

```bash
export TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_ENABLED=true
export TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_ENDPOINT=...
export TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_PROJECT_ID=...
export TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_INSTANCE_ID=...
export TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_NODE_ID=...
export TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_AUTH_TOKEN=...
```

DAS slow SQL / full SQL source：

```bash
export TAURUSDB_SLOW_SQL_SOURCE_DAS_ENABLED=true
export TAURUSDB_SLOW_SQL_SOURCE_DAS_ENDPOINT=...
export TAURUSDB_SLOW_SQL_SOURCE_DAS_PROJECT_ID=...
export TAURUSDB_SLOW_SQL_SOURCE_DAS_INSTANCE_ID=...
export TAURUSDB_SLOW_SQL_SOURCE_DAS_AUTH_TOKEN=...
export TAURUSDB_SLOW_SQL_SOURCE_DAS_DATASTORE_TYPE=TaurusDB
```

CES metrics source：

```bash
export TAURUSDB_METRICS_SOURCE_CES_ENABLED=true
export TAURUSDB_METRICS_SOURCE_CES_ENDPOINT=...
export TAURUSDB_METRICS_SOURCE_CES_PROJECT_ID=...
export TAURUSDB_METRICS_SOURCE_CES_INSTANCE_ID=...
export TAURUSDB_METRICS_SOURCE_CES_NODE_ID=...
export TAURUSDB_METRICS_SOURCE_CES_AUTH_TOKEN=...
```

CES 第一版默认假设：

- namespace：`SYS.GAUSSDB`
- instance 维度名：`gaussdb_mysql_instance_id`
- node 维度名：`gaussdb_mysql_node_id`

如果你的云端环境维度名不同，优先判断为配置/接口差异，不要直接判代码错误。

##### 8.5.3 启动前 preflight

先跑本地基线：

```bash
npm run build
npm run test --workspace @huaweicloud/taurusdb-core
npm run test --workspace @huaweicloud/taurusdb-mcp
```

再跑云侧 preflight：

```bash
npm run cloud:validate
```

这个脚本当前会单独检查：

- 当前 datasource 是否能自动解析唯一 `instance_id`
- DAS `sql/switch`
- DAS `top-slow-log`
- CES `batch-query-metric-data`

通过标准：

- 能拿到 2xx/可解析响应，或者明确的权限/配置错误
- 不出现未处理异常
- 返回错误时能区分是 token、endpoint、project、instance、node 还是时间窗口问题

##### 8.5.4 全量验证顺序

不要乱跳。按下面 5 轮走，才能把问题快速收敛。

如果你的 MCP client 需要显式传 tool 调用，一律按下面这个信封结构替换：

```json
{
  "tool": "tool_name",
  "arguments": {
    "...": "..."
  }
}
```

下面每条示例只展开 `arguments`。`datasource` 如果你只有一个默认 datasource，可以先省略；如果你配置了多个 datasource，建议每条都显式传。

第一轮：通用主链路

1. `list_data_sources`
2. `list_databases`
3. `list_tables`
4. `describe_table`
5. `execute_readonly_sql`
6. `explain_sql`
7. `execute_sql` + confirmation token

这一轮目标：

- 先证明 profile / datasource / schema / guardrail / executor / confirmation 主链路正常
- 如果这一轮没过，不要继续测 Taurus 专属 Tool

建议逐条执行：

1. `list_data_sources`

```json
{}
```

预期：

- 返回 `default_datasource`
- `items` 至少包含你的 Taurus datasource

失败先看：

- profile 是否加载成功
- server 启动日志是否有配置错误

2. `list_databases`

```json
{
  "datasource": "your_taurus_datasource"
}
```

预期：

- `ok=true`
- `items` 中能看到目标数据库

失败先看：

- 数据库连接参数
- TLS / 白名单 / 安全组

3. `list_tables`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database"
}
```

预期：

- `items` 中能看到业务表

4. `describe_table`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "table": "your_table"
}
```

预期：

- 有 `columns`
- 有 `indexes`
- 有 `primary_key`
- 有 `engine_hints`

5. `execute_readonly_sql`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "sql": "SELECT * FROM your_table ORDER BY 1 DESC LIMIT 5"
}
```

预期：

- `ok=true`
- `metadata.statement_type=select`
- `metadata.sql_hash` 存在
- `metadata.duration_ms` 存在

失败先看：

- SQL 是否只读
- 账号是否有表访问权限

6. `explain_sql`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "sql": "SELECT * FROM your_table WHERE id = 1"
}
```

预期：

- 返回 `plan`
- 返回 `guardrail`

7. `execute_sql` 第一次，不带确认 token

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "sql": "UPDATE your_table SET updated_at = NOW() WHERE id = 1"
}
```

预期：

- 返回 `CONFIRMATION_REQUIRED`
- 返回 `data.confirmation_token`

8. `execute_sql` 第二次，带确认 token

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "sql": "UPDATE your_table SET updated_at = NOW() WHERE id = 1",
  "confirmation_token": "paste_token_here"
}
```

预期：

- mutation 成功
- `affected_rows` 合理

失败先看：

- SQL 文本是否和第一次完全一致
- mutation 用户是否配置
- guardrail 是否阻断了当前语句

第二轮：Taurus 专属能力

1. `get_kernel_info`
2. `list_taurus_features`
3. `explain_sql_enhanced`
4. `flashback_query`

这一轮目标：

- 验证 capability probe 是否可信
- 验证专属 Tool 是否按 feature gate 暴露
- 验证不支持时是“明确降级”而不是“异常失败”

建议逐条执行：

1. `get_kernel_info`

```json
{
  "datasource": "your_taurus_datasource"
}
```

预期：

- `kernel.is_taurusdb` 为真，或者至少返回可解释的 kernel 信息

2. `list_taurus_features`

```json
{
  "datasource": "your_taurus_datasource"
}
```

预期：

- 返回 `features`
- 每个 feature 都有 `available`
- 不支持的 feature 是显式 unavailable，不是未处理异常

3. `explain_sql_enhanced`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "sql": "SELECT * FROM your_table WHERE id = 1"
}
```

预期：

- 返回增强 explain 结果
- 有 Taurus 特性提示时，应能看到相关 hints / suggestions

失败先看：

- SQL 是否只读
- capability probe 是否确认该 feature 可用

4. `flashback_query`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "table": "your_table",
  "as_of": {
    "relative": "5m"
  },
  "limit": 5
}
```

如果你更想用绝对时间：

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "table": "your_table",
  "as_of": {
    "timestamp": "2026-04-27T13:00:00Z"
  },
  "limit": 5
}
```

预期：

- 返回历史只读结果
- 不对当前表产生写副作用

失败先看：

- 实例是否支持 flashback
- `as_of` 是否只传了 `timestamp` 或 `relative` 其中一个

第三轮：慢 SQL / 全量 SQL 源

1. `find_top_slow_sql`
2. `diagnose_slow_query` with `sql_hash`
3. `diagnose_slow_query` with `digest_text`

这一轮重点观察 `evidence[].source` 是否出现：

- `statement_digest`
- `taurus_api_slow_logs`
- `das_slow_query_logs`
- `das_sql_statements`
- `das_top_slow_log`

通过标准：

- 至少有一个本地或云侧 slow SQL source 成功接线
- 多源缺失时返回 `limitations` 或证据缺失，不出现未处理异常
- `recommended_actions`、`recommended_next_tools`、`next_tool_inputs` 结构稳定

建议逐条执行：

1. `find_top_slow_sql`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "time_range": {
    "relative": "30m"
  },
  "top_n": 5,
  "sort_by": "total_latency",
  "evidence_level": "standard"
}
```

预期：

- 返回 `status`
- 返回 `top_sqls`
- 每条结果尽量带 `sql_hash`、`digest_text` 或 summary 字段

失败先看：

- Taurus slow SQL source 是否配置
- DAS source 是否配置
- 时间窗口内是否真的存在慢 SQL

2. `diagnose_slow_query` 用 `sql_hash`

先从 `find_top_slow_sql` 结果里拿一个 `sql_hash`，再执行：

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "sql_hash": "paste_sql_hash_here",
  "time_range": {
    "relative": "30m"
  },
  "evidence_level": "full",
  "include_raw_evidence": true
}
```

预期：

- 返回 `root_cause_candidates`
- 返回 `evidence`
- 可能出现 `statement_digest`、`taurus_api_slow_logs`、`das_slow_query_logs`、`das_sql_statements`

3. `diagnose_slow_query` 用 `digest_text`

如果没有可用 `sql_hash`，改用上一条结果中的 digest：

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "digest_text": "paste_digest_text_here",
  "time_range": {
    "relative": "30m"
  },
  "evidence_level": "full"
}
```

4. `diagnose_slow_query` 用明确 SQL 文本

如果你知道具体慢 SQL，可以直接传原 SQL：

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "sql": "SELECT * FROM your_table WHERE your_column = 'value'",
  "evidence_level": "full"
}
```

失败先看：

- `sql` / `sql_hash` / `digest_text` 是否至少传了一个
- 外部源没数据时，是否仍有 explain / digest 本地证据

第四轮：锁与并发诊断

1. `show_processlist`
2. `diagnose_lock_contention`

这一轮重点观察 `evidence[].source` 是否出现：

- `lock_waits`
- `metadata_locks`
- `deadlock_history`

通过标准：

- 存在 live wait 时能返回 blocker chain 或 root cause 候选
- 无最近 deadlock 时允许没有 `deadlock_history`
- 无 `SHOW ENGINE INNODB STATUS` 或 `performance_schema.metadata_locks` 权限时，结果应降级为 `limitations` / `inconclusive`

建议逐条执行：

1. `show_processlist`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "include_idle": false,
  "include_system": false,
  "include_info": true,
  "max_rows": 20,
  "min_time_seconds": 1
}
```

预期：

- 返回活跃会话
- `rows` 中能看到当前长查询、锁等待或复制线程线索

2. `diagnose_lock_contention`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "time_range": {
    "relative": "15m"
  },
  "evidence_level": "full",
  "include_raw_evidence": true
}
```

如果你已经知道热点表：

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "table": "your_table",
  "evidence_level": "full"
}
```

如果你已经知道 blocker session：

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "blocker_session_id": "12345",
  "evidence_level": "full"
}
```

预期：

- `evidence` 中尽量能看到 `lock_waits`、`metadata_locks`、`deadlock_history`
- 有等待时返回 blocker / waiting 关系

失败先看：

- 账号是否有 `performance_schema` 相关权限
- 是否有 `SHOW ENGINE INNODB STATUS` 权限
- 当前时刻是否真的有锁等待或最近 deadlock

第五轮：复制 / 存储 / 资源诊断

1. `diagnose_replication_lag`
2. `diagnose_storage_pressure`
3. `diagnose_service_latency`
4. `diagnose_db_hotspot`
5. `diagnose_connection_spike`

这一轮重点观察：

- `evidence[].source` 是否出现 `ces_metrics`
- `diagnose_replication_lag` 是否合并复制状态与 lag 指标
- `diagnose_storage_pressure` 是否出现 IOPS / throughput / storage latency / tmp spill 相关证据
- `recommended_next_tools` / `next_tool_inputs` 是否可直接复用

通过标准：

- CES 配置正确时，至少一个资源型 diagnostics 能返回结构化 `ces_metrics`
- 单机实例上 `diagnose_replication_lag` 返回 `not_applicable` 可接受
- 无指标窗口或权限不足时，应返回可解释的 `inconclusive` / `limitations`

建议逐条执行：

1. `diagnose_replication_lag`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "time_range": {
    "relative": "30m"
  },
  "evidence_level": "full",
  "include_raw_evidence": true
}
```

如果你知道 replica 或 channel：

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "replica_id": "your_replica_id",
  "channel": "your_channel",
  "time_range": {
    "relative": "30m"
  }
}
```

预期：

- 有复制链路时，`evidence` 能看到复制状态与 lag 指标
- 单机实例允许返回 `not_applicable`

2. `diagnose_storage_pressure`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "scope": "instance",
  "time_range": {
    "relative": "30m"
  },
  "evidence_level": "full"
}
```

如果要下钻到表：

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "scope": "table",
  "table": "your_table",
  "time_range": {
    "relative": "30m"
  }
}
```

预期：

- `evidence` 中可能看到 `statement_digest`、`table_storage`、`ces_metrics`
- 有压测或异常时，可能给出 tmp spill / scan-heavy 候选

3. `diagnose_service_latency`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "symptom": "latency",
  "time_range": {
    "relative": "15m"
  },
  "evidence_level": "standard"
}
```

如果你更像在查超时：

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "symptom": "timeout",
  "time_range": {
    "relative": "15m"
  }
}
```

预期：

- 返回 `top_candidates`
- 返回 `recommended_next_tools`
- 返回 `next_tool_inputs`

4. `diagnose_db_hotspot`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "scope": "sql",
  "time_range": {
    "relative": "15m"
  }
}
```

如果你更关心热点表：

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "scope": "table",
  "time_range": {
    "relative": "15m"
  }
}
```

5. `diagnose_connection_spike`

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "time_range": {
    "relative": "15m"
  },
  "compare_baseline": true,
  "evidence_level": "full"
}
```

如果你要聚焦某个用户或来源：

```json
{
  "datasource": "your_taurus_datasource",
  "database": "your_database",
  "user": "your_app_user",
  "client_host": "your_client_ip_prefix",
  "time_range": {
    "relative": "15m"
  }
}
```

预期：

- `evidence` 可能出现 `ces_metrics` 与 processlist 线索
- 返回 idle buildup / session growth 相关候选

失败先看：

- CES token / endpoint / dimensions
- 时间窗口是否过短，导致没有 metric points
- 账号是否有 processlist 权限

##### 8.5.5 云端验证重点记录

每个失败样例至少记录：

- tool 名称
- 输入参数
- 返回的 `status`
- `limitations`
- `evidence[].source`
- 云端接口是否 4xx / 5xx
- 数据库账号是否报权限错误
- 发生时间和实例节点

建议按下面这个模板逐条补：

```text
Validation Record: <tool-name> / <case-id>
Date: 2026-04-27
Env: cloud
Datasource: <datasource>
Database: <database>
Instance: <instance-id or endpoint>
Node / Role: <primary|readonly|unknown>
Time range: <15m|30m|custom|n/a>
Input JSON:
{
  "...": "..."
}
Result status: <ok|inconclusive|not_applicable|error>
Error code: <error-code-or-none>
Limitations: <limitation 1>; <limitation 2>
Evidence sources: <source-1>; <source-2>
Cloud API status: Taurus API=<200|4xx|5xx|n/a>; DAS API=<200|4xx|5xx|n/a>; CES API=<200|4xx|5xx|n/a>
Permission notes: <SHOW ENGINE INNODB STATUS / performance_schema / processlist / none>
Raw symptom summary: <one-line observation>
Conclusion: <product gap | env issue | permission issue | expected downgrade>
Follow-up: <next tool / config / evidence to check>
```

重点建议额外记录这几类“失败归因”，否则后面很难区分是代码问题还是环境问题：

- `feature unavailable`：capability probe 明确判定不支持
- `permission denied`：数据库侧权限不足
- `cloud api auth/config error`：Taurus API / DAS / CES token、endpoint、region、dimension 配置错误
- `no recent data`：时间窗口内没有慢 SQL、deadlock、metric points
- `runtime regression`：以前同环境可用，这次出现结构漂移、协议错误或未处理异常

如果某条调用成功，也建议至少保留一条最小成功记录：

- tool 名称
- 最小输入
- 关键返回字段
- `evidence[].source`
- 是否命中云侧 source
- 是否可直接衔接下一条 recommended tool

##### 8.5.6 这些情况不直接判代码失败

下面这些结果当前都可以接受：

- 单机实例上 `diagnose_replication_lag` 返回 `not_applicable`
- 无慢 SQL 留存窗口时 external slow SQL source 无结果
- 无最近 deadlock 时 `deadlock_history` 缺失
- 账号无 `SHOW ENGINE INNODB STATUS` 权限
- CES 时间窗口无数据
- DAS / CES token 正常但实例本身未开启对应能力

##### 8.5.7 云端阶段最终通过标准

要判“云端 TaurusDB 全量功能验证通过”，至少满足：

- `npm run cloud:validate` 可完成并给出可解释结果
- 通用主链路在云端复跑通过
- capability probe 结果可信
- `get_kernel_info` / `list_taurus_features` 正常
- `explain_sql_enhanced` 在支持环境下可用
- `flashback_query` 在支持环境下可用，或在不支持环境下明确不可用
- `find_top_slow_sql` 与 `diagnose_slow_query` 至少有一条云侧 SQL source 接通
- `diagnose_lock_contention` 至少能返回 lock waits 或 MDL 证据中的一种
- CES 配置正确时，至少一个 diagnostics 返回结构化 `ces_metrics`
- 全流程不出现未处理异常、协议污染或错误 envelope 漂移

#### 阶段四：继续推进 diagnostics

目标：在 MCP 主链路稳定后，把 diagnostics 从 contract 层继续推进到真实能力。

当前已完成：

1. `show_processlist`
2. `diagnose_slow_query` 第一版
3. `diagnose_connection_spike` 第一版 + CES 连接指标第一版
4. `diagnose_lock_contention` 第一版
5. `diagnose_replication_lag` 复制状态 + CES lag 第一版
6. `diagnose_storage_pressure` 本地 SQL/table evidence + CES 存储指标第一版
7. CES / Cloud Eye metrics source 第一版

下一步建议实现顺序：

1. 为 `diagnose_slow_query` 在 Taurus slow-log external source 之外，再补 DAS / Top SQL / 更强的 wait-event / 云侧运行时关联
2. 在云端 TaurusDB 验证 CES / Cloud Eye 指标源、复制状态和只读节点权限
3. 为 `diagnose_lock_contention` 继续补更长 deadlock history archive 与更强的 MDL 根因归并

这一阶段继续关注：

- collector 最小版是否真实接线
- `DiagnosticResult` 输出骨架是否稳定
- 根因候选、证据摘要、推荐动作是否可消费

这一阶段暂时不要做：

- CLI diagnose 命令
- DAS / Top SQL / 全量 SQL 的复杂 merge ranking
- OS 级磁盘指标 collector

---

## 9. 测试用例设计

建议把测试用例按 10 组设计。

### 9.1 A 组：Server 启动与 MCP 协议层

目标：证明 MCP Server 本身可作为 `stdio` 服务稳定工作。

核心用例：

| 编号 | 用例                    | 期望结果               | 关键观测点                                  |
| ---- | ----------------------- | ---------------------- | ------------------------------------------- |
| A-01 | 启动 MCP server         | 进程成功启动并完成握手 | 无异常退出；stdout 可被 MCP client 正常消费 |
| A-02 | `tools/list`            | 返回默认工具集合       | 工具数量和名称正确                          |
| A-03 | `enableMutations=false` | `execute_sql` 不暴露   | tool list 中无 `execute_sql`                |
| A-04 | `enableMutations=true`  | `execute_sql` 暴露     | tool list 中有 `execute_sql`                |
| A-05 | 日志边界                | 日志不污染 stdout      | stderr 有日志，stdout 仅协议输出            |
| A-06 | 异常 handler            | 返回结构化错误         | `ok=false`，`error.code` 合理               |

### 9.2 B 组：配置、Profile 与 Context 解析

目标：确认 datasource/profile/context 解析稳定。

核心用例：

| 编号 | 用例                                | 期望结果                  | 关键观测点                                  |
| ---- | ----------------------------------- | ------------------------- | ------------------------------------------- |
| B-01 | 存在默认 datasource                 | 可正确解析默认 datasource | `list_data_sources.default_datasource` 正确 |
| B-02 | 显式传入 datasource                 | 覆盖默认 datasource       | 返回中的 datasource 正确                    |
| B-03 | 传入 database 覆盖 profile 默认库   | tool 在指定库执行         | `data.database` 正确                        |
| B-04 | datasource 不存在                   | 返回结构化错误            | `DATASOURCE_NOT_FOUND`                      |
| B-05 | timeout 超范围                      | 被服务端限制或报错        | `timeout_ms` 行为符合限制                   |
| B-06 | 缺少 database 且 profile 也无默认库 | 返回输入错误              | 提示需要提供 database                       |

### 9.3 C 组：Schema 探查能力

目标：确认 schema 相关 Tool 适合作为 AI 生成 SQL 前的上下文获取入口。

核心用例：

| 编号 | 用例                | 期望结果                         | 关键观测点                                    |
| ---- | ------------------- | -------------------------------- | --------------------------------------------- |
| C-01 | `list_data_sources` | 返回公开 datasource 元信息       | 不泄露密码；默认标识正确                      |
| C-02 | `list_databases`    | 返回数据库列表                   | 数据库名正确                                  |
| C-03 | `list_tables`       | 返回表/视图列表                  | 表名、类型、行数估计合理                      |
| C-04 | `describe_table`    | 返回列、索引、主键、engine hints | `primary_key`、`indexes`、`engine_hints` 正确 |
| C-05 | 表不存在            | 返回结构化错误                   | 错误信息可定位                                |

### 9.4 D 组：只读 SQL 与 Explain

目标：确认只读执行主路径、Explain 主路径和最小 guardrail 是稳定的。

核心用例：

| 编号 | 用例                                 | 期望结果                                    | 关键观测点                              |
| ---- | ------------------------------------ | ------------------------------------------- | --------------------------------------- |
| D-01 | `SELECT` 聚合查询                    | 成功返回结果                                | `ok=true`，`row_count` 正确             |
| D-02 | `SHOW` 查询                          | 成功返回结果                                | `statement_type` 正确                   |
| D-03 | `DESCRIBE` 查询                      | 成功返回结果                                | 行列结构合理                            |
| D-04 | 只读 SQL 大结果集                    | 正确触发裁剪                                | `truncated=true`                        |
| D-05 | 非只读 SQL 调 `execute_readonly_sql` | 被阻断                                      | `BLOCKED_SQL`                           |
| D-06 | 非法 SQL 调 `execute_readonly_sql`   | 结构化报错                                  | `SQL_SYNTAX_ERROR`                      |
| D-07 | `explain_sql` 正常执行               | 返回 plan 和 guardrail 信息                 | `plan`、`guardrail`、`duration_ms` 正确 |
| D-08 | 高风险 SQL 执行 Explain              | Explain 可出结果，但 guardrail 风险提示存在 | `guardrail.action` 合理                 |

额外重点：

- `metadata.sql_hash` 必须稳定返回
- `metadata.statement_type` 必须符合 SQL 类型
- `metadata.duration_ms` 必须稳定返回

### 9.5 E 组：写 SQL 与 Confirmation Token

目标：确认 mutation 默认关闭，开启后仍必须走确认流。

核心用例：

| 编号 | 用例                              | 期望结果                     | 关键观测点                                     |
| ---- | --------------------------------- | ---------------------------- | ---------------------------------------------- |
| E-01 | 默认配置下查看 tool list          | 无 `execute_sql`             | tool 暴露面正确                                |
| E-02 | 开启 mutation 后查看 tool list    | 有 `execute_sql`             | 开关生效                                       |
| E-03 | `execute_sql` 传只读 SQL          | 被阻断                       | tool scope 正确                                |
| E-04 | `UPDATE ... WHERE ...` 不带 token | 返回 `CONFIRMATION_REQUIRED` | `error.code` 与 `data.confirmation_token` 正确 |
| E-05 | 携带错误 token 重试               | 返回 `CONFIRMATION_INVALID`  | token 校验严格                                 |
| E-06 | 携带正确 token 重试               | 执行成功                     | `affected_rows` 与数据库实际一致               |
| E-07 | 重复使用同一 token                | 校验失败                     | token 一次性使用                               |
| E-08 | 无 WHERE 的高风险 mutation        | 被阻断                       | guardrail 静态规则生效                         |
| E-09 | mutation 执行失败                 | 回滚                         | 数据未脏写                                     |

### 9.6 F 组：Timeout 与异常路径

目标：确认项目不是“只会成功返回”，而是 timeout、连接失败和错误映射都稳定。

核心用例：

| 编号 | 用例         | 期望结果                 | 关键观测点              |
| ---- | ------------ | ------------------------ | ----------------------- |
| F-01 | 制造 timeout | 返回 `QUERY_TIMEOUT`     | 错误码准确              |
| F-02 | 连接失败     | 返回 `CONNECTION_FAILED` | 错误映射稳定            |
| F-03 | 非法 SQL     | 返回结构化错误           | `SQL_SYNTAX_ERROR` 稳定 |

### 9.7 G 组：TaurusDB 能力探测与专属 Tool

目标：确认 TaurusDB 差异化能力不是硬编码暴露，而是由 capability probe 驱动。

核心用例：

| 编号 | 用例                               | 期望结果                   | 关键观测点                                     |
| ---- | ---------------------------------- | -------------------------- | ---------------------------------------------- |
| G-01 | 非 Taurus 环境启动                 | 专属 Tool 按能力缺失隐藏   | tool list 不应错误暴露                         |
| G-02 | Taurus 环境 capability probe 成功  | 返回 kernel / feature 信息 | `get_kernel_info`、`list_taurus_features` 可用 |
| G-03 | `explain_sql_enhanced`             | 返回增强提示               | `taurusHints`、`optimizationSuggestions` 存在  |
| G-04 | `flashback_query` 在支持环境下执行 | 返回历史只读数据           | 当前表数据不被修改                             |
| G-05 | 不支持 flashback 的环境调用        | 返回合理错误或不暴露 tool  | 行为与 feature gate 一致                       |

### 9.8 H 组：Diagnostics

目标：确认 diagnostics 当前默认暴露，同时已落地的诊断链路行为稳定。

核心用例：

| 编号 | 用例                                                                              | 期望结果                                                               | 关键观测点                                                                |
| ---- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| H-01 | 默认 tool list                                                                    | 出现 diagnostics tool                                                  | 当前默认注册行为正确                                                      |
| H-02 | 直接测试 `diagnose_slow_query` handler                                            | 返回 explain-based 结构化结果                                          | `root_cause_candidates`、`evidence`、`recommended_actions` 稳定           |
| H-03 | 直接测试 `find_top_slow_sql` / `diagnose_db_hotspot` / `diagnose_service_latency` | 返回 symptom-entry 结构化结果                                          | `top_sqls`、`hotspots`、`top_candidates`、`recommended_next_tools` 稳定   |
| H-04 | 直接测试 `diagnose_connection_spike` handler                                      | 返回 evidence-backed 结构化结果                                        | `root_cause_candidates`、`evidence`、`recommended_actions` 稳定           |
| H-05 | 直接测试 `diagnose_lock_contention` handler                                       | 返回 evidence-backed 结构化结果                                        | blocker / table / evidence 摘要稳定                                       |
| H-06 | 直接测试 `diagnose_storage_pressure` handler                                      | 返回本地存储压力结构化结果                                             | `statement_digest`、`table_storage`、tmp disk spill / scan-heavy 候选稳定 |
| H-07 | `diagnose_replication_lag` handler                                                | 无复制证据时返回 `not_applicable`，有测试桩时返回 evidence-backed 结果 | 复制状态、CES lag、limitations 字段稳定                                   |
| H-08 | 输入缺失                                                                          | 返回输入校验错误                                                       | 校验提示清晰                                                              |

说明：

- diagnostics 当前默认注册到 MCP tool registry
- 本地可验证 `diagnose_slow_query`、`diagnose_connection_spike`、`diagnose_lock_contention`、`diagnose_storage_pressure` 的主要数据面 evidence chain
- CES / Cloud Eye metrics source 已有第一版自动化单测覆盖，但真实指标返回、IAM token、维度名和时间窗口仍需云端 TaurusDB 验证
- 不应把当前版本当成完整云侧“诊断正确率”验收；DAS / Top SQL / 全量 SQL、长历史 deadlock archive、OS 级存储指标仍需后续补齐

### 9.9 I 组：`init` 命令

目标：确认客户端配置初始化行为稳定。

核心用例：

| 编号 | 用例                     | 期望结果              | 关键观测点         |
| ---- | ------------------------ | --------------------- | ------------------ |
| I-01 | 初始化 Cursor 配置       | 正确写入 server entry | 配置结构正确       |
| I-02 | 目标配置中已有同名 entry | 不覆盖已有配置        | merge 行为符合预期 |
| I-03 | 不同 client 参数         | 输出目标文件正确      | 目标路径和内容合理 |

### 9.10 J 组：回归与非功能性检查

目标：补足功能测试以外的基本质量信号。

核心用例：

| 编号 | 用例                     | 期望结果               | 关键观测点   |
| ---- | ------------------------ | ---------------------- | ------------ |
| J-01 | 连续多次启动/关闭 server | 无明显资源泄漏         | 进程稳定     |
| J-02 | 连续多次执行只读查询     | 返回稳定               | 无随机异常   |
| J-03 | 多次错误输入             | 错误码和 envelope 稳定 | 无未处理异常 |
| J-04 | 敏感配置打印             | 日志不泄露密码         | 配置已脱敏   |

---

## 10. 手工联调建议步骤

建议测试同学按这个顺序执行。

### 10.1 第一步：先过默认自动化

```bash
npm run check
npm run build
npm test
```

目标：

- 先确认仓库自身是绿的
- 如果这一步不过，不要直接进入数据库联调

### 10.2 第二步：准备本地 MySQL

初始化测试库：

```bash
mysql -uroot -p < testdata/mysql/local-mysql-schema.sql
mysql -uroot -p < testdata/mysql/local-mysql-seed.sql
mysql -uroot -p < testdata/mysql/local-mysql-users.sql
```

然后开启本地 MySQL e2e。

目标：

- 跑通 discovery / readonly / explain / mutation confirmation 主链路
- 验证数据库副作用、裁剪、脱敏、timeout 和错误映射

### 10.3 第三步：本地手工走一遍 MCP 调用

建议至少手工验证：

- `tools/list`
- `list_data_sources`
- `list_tables`
- `describe_table`
- `execute_readonly_sql`
- `explain_sql`
- `execute_sql` + confirmation
- `find_top_slow_sql`
- `diagnose_slow_query`
- `diagnose_service_latency`
- `diagnose_db_hotspot`
- `diagnose_connection_spike`
- `diagnose_lock_contention`
- `diagnose_storage_pressure`

手工关注：

- 返回结构是否适合客户端消费
- 错误提示是否足够定位
- 日志是否只在 stderr

### 10.4 第四步：切云端 TaurusDB

目标：

- 验证 capability probe
- 验证 TaurusDB 专属 Tool 是否按能力暴露
- 验证 `explain_sql_enhanced`
- 验证 `flashback_query`
- 验证云侧权限、网络、TLS、白名单、DAS 与 CES collector

执行要求：

- 先完成 `npm run cloud:validate`
- 再按 `8.5.4` 的 5 轮顺序执行
- 每轮至少保留一个成功样例和一个失败/降级样例

手工关注：

- `tools/list` 暴露面是否与 capability probe 一致
- DAS / Taurus API / CES 失败时是否都能收敛到结构化 `limitations` 或可解释错误
- `diagnose_replication_lag`、`diagnose_storage_pressure`、`diagnose_connection_spike` 的 `ces_metrics` evidence 是否真有数据，不只是空壳 source 名
- `recommended_next_tools` / `next_tool_inputs` 是否适合客户端直接串联下钻

---

## 11. 缺陷定位建议

测试失败时，可以按下面的顺序缩小范围。

### 11.1 `tools/list` 就异常

优先怀疑：

- server 启动失败
- MCP SDK 适配问题
- tool registry 注册问题
- 配置加载启动阶段异常

### 11.2 能列工具但 discovery 失败

优先怀疑：

- datasource/profile 解析
- database 上下文缺失
- schema introspector
- 数据库权限不足

### 11.3 discovery 正常但 SQL 执行失败

优先怀疑：

- guardrail 阻断
- SQL parser/classifier
- executor / connection pool
- timeout 或连接参数问题

### 11.4 `execute_sql` 失败

优先怀疑：

- `enableMutations` 配置未开启
- mutation 用户未配置
- confirmation token 不匹配
- guardrail 静态规则阻断
- 数据库写权限不足

### 11.5 Taurus 专属 Tool 异常

优先怀疑：

- capability probe 未成功
- 当前实例不具备对应 feature
- TaurusDB 内核行为与本地 MySQL 不同
- 云端权限/网络/TLS 问题

---

## 12. 阶段验收出口

建议首阶段 MCP 至少满足下面条件，才能判定“测试通过，可进入下一阶段”。

### 12.1 必须通过

- 默认自动化基线全绿
- 本地 MySQL 主链路全通
- discovery 5 个 Tool 可用
- readonly / explain 主链路稳定
- mutation 默认关闭，开启后 confirmation 主链路稳定
- stderr/stdout 边界正确
- 错误码和 response envelope 稳定

### 12.2 Taurus 阶段必须补测

- `npm run cloud:validate` 通过或返回明确可定位的云侧错误
- capability probe 在云端可用
- `get_kernel_info` / `list_taurus_features` 正常
- `explain_sql_enhanced` 在支持环境下可用
- `flashback_query` 在支持环境下可用
- 至少一条 slow SQL 云侧 source 接通
- 至少一条 CES metrics diagnostics 在真实云侧返回结构化 evidence
- 云网络、权限、TLS、白名单验证通过

### 12.3 当前允许未完成

- diagnostics 的云侧完整闭环与长历史补齐
- history/binlog
- CLI 真正落地

---

## 13. 测试结论模板

测试同学输出阶段结论时，建议至少包含下面 5 项：

- 测试环境：本地无库 / 本地 MySQL / 云端 TaurusDB
- 测试范围：本次覆盖了哪些 Tool 和哪些场景
- 结果摘要：通过 / 失败 / 阻塞项
- 关键缺陷：按严重度列出
- 风险备注：哪些功能当前未测、哪些能力仍需云端补验

如果要一句话概括当前项目的测试策略，可以写成：

`先用默认自动化和本地 MySQL 把 MCP 主链路测稳，再用云端 TaurusDB 验证 capability probe 和专属能力，最后按首阶段范围做验收。`
