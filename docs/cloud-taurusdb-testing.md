# 华为云 TaurusDB MCP 云端测试指南

> 本文档是上云联调入口。目标是在真实 TaurusDB / GaussDB(for MySQL) 环境里，把 MCP 数据源、通用 Tool、Taurus 专属 Tool、diagnostics 和云侧指标源一次性验清楚。

配套阅读：

- [testing.md](./testing.md)
- [manual-smoke-test.md](./manual-smoke-test.md)
- [taurusdb-mcp-implementation-plan.md](./taurusdb-mcp-implementation-plan.md)
- [taurusdb-ops-playbook.md](./taurusdb-ops-playbook.md)

---

## 1. 上云前置条件

至少准备：

- 一台能访问 TaurusDB 内网地址的机器，推荐和实例同 VPC，或在跳板机 / ECS / Sidecar 上运行 MCP。
- Node.js `>=20`，并已在仓库根目录执行 `npm install`。
- TaurusDB 数据库连接信息：host、port、database、readonly user、可选 mutation user。
- 如果要测 diagnostics 云侧证据，推荐至少准备华为云 `region + AK/SK`；底层 DAS / CES endpoint、project_id、instance_id、node_id、IAM token 现在都可以作为 override 或联调兜底，而不是默认必填。

数据库账号建议权限：

- readonly user：目标库 `SELECT`，`SHOW PROCESSLIST`，`SHOW REPLICA STATUS` 或 `SHOW SLAVE STATUS`，`SHOW ENGINE INNODB STATUS`，以及 `performance_schema` 相关只读权限。
- mutation user：只给测试表或最小业务表的受控写权限，用于验证 confirmation token，不建议一开始给全库写权限。

---

## 2. 配置数据库 Datasource

最简单方式是直接用环境变量：

```bash
export TAURUSDB_SQL_ENGINE=mysql
export TAURUSDB_SQL_DATASOURCE=cloud_taurus
export TAURUSDB_SQL_HOST='<taurusdb-private-host>'
export TAURUSDB_SQL_PORT=3306
export TAURUSDB_SQL_DATABASE='<database>'
export TAURUSDB_SQL_USER='<readonly-user>'
export TAURUSDB_SQL_PASSWORD='<readonly-password>'
export TAURUSDB_DEFAULT_DATASOURCE=cloud_taurus
```

如果要验证写操作确认流，再补：

```bash
export TAURUSDB_MCP_ENABLE_MUTATIONS=true
export TAURUSDB_SQL_MUTATION_USER='<mutation-user>'
export TAURUSDB_SQL_MUTATION_PASSWORD='<mutation-password>'
```

注意：

- `restore_recycle_bin_table` 只有在 `TAURUSDB_MCP_ENABLE_MUTATIONS=true` 时才会暴露。
- 该 Tool 的第一次调用不会直接执行恢复，而是先返回 `confirmation_token`。

如果你的云端连接需要 TLS，建议用 profile 文件，而不是把所有配置塞进环境变量：

```json
{
  "defaultDatasource": "cloud_taurus",
  "dataSources": {
    "cloud_taurus": {
      "engine": "mysql",
      "host": "<taurusdb-private-host>",
      "port": 3306,
      "database": "<database>",
      "readonlyUser": {
        "username": "<readonly-user>",
        "password": "env:TAURUSDB_SQL_PASSWORD"
      },
      "mutationUser": {
        "username": "<mutation-user>",
        "password": "env:TAURUSDB_SQL_MUTATION_PASSWORD"
      },
      "tls": {
        "enabled": true,
        "rejectUnauthorized": true,
        "servername": "<taurusdb-private-host>",
        "ca": "file:/path/to/ca.pem"
      }
    }
  }
}
```

启用 profile 文件：

```bash
export TAURUSDB_SQL_PROFILES=/path/to/profiles.json
export TAURUSDB_DEFAULT_DATASOURCE=cloud_taurus
```

---

## 3. 配置云侧 Evidence Source

这些配置不是启动 MCP 的必需项，但会影响 `find_top_slow_sql`、`diagnose_slow_query`、`diagnose_service_latency`、`diagnose_connection_spike`、`diagnose_replication_lag`、`diagnose_storage_pressure` 的云侧证据质量。

优先使用高层 cloud resolver 配置，而不是直接手填 DAS / CES 全量字段。当前默认主路径已经收敛到 `region + AK/SK`：

```bash
export TAURUSDB_CLOUD_REGION='<region>'
export TAURUSDB_CLOUD_ACCESS_KEY_ID='<access-key-id>'
export TAURUSDB_CLOUD_SECRET_ACCESS_KEY='<secret-access-key>'
```

可选补充：

```bash
export TAURUSDB_CLOUD_SECURITY_TOKEN='<session-token>'
export TAURUSDB_CLOUD_ENABLE_TAURUS_API=true
```

这组高层参数会自动推导：

- DAS endpoint：`https://das.<region>.myhuaweicloud.com`
- CES endpoint：`https://ces.<region>.myhuaweicloud.com`
- Taurus API endpoint：`https://gaussdb.<region>.myhuaweicloud.com`
- IAM endpoint：`https://iam.<region>.myhuaweicloud.com`
- `project_id` 会优先自动解析
- `instance_id` 可通过 `list_cloud_taurus_instances` 查询，或由 `cloud:validate` 按 datasource `host/port` 自动解析
- `node_id` 会在 `select_cloud_taurus_instance` 或 `cloud:validate` 成功解析实例后尽量自动补齐默认节点

如果你已经有老的底层环境变量，仍然可以继续使用；显式传入的底层值优先级更高。也就是说，底层 `*_PROJECT_ID` / `*_INSTANCE_ID` / `*_AUTH_TOKEN` 现在主要用于 override、联调和排障，不再是推荐起步方式。

DAS slow SQL / Top SQL：

```bash
export TAURUSDB_SLOW_SQL_SOURCE_DAS_ENABLED=true
export TAURUSDB_SLOW_SQL_SOURCE_DAS_ENDPOINT='<das-endpoint>'
export TAURUSDB_SLOW_SQL_SOURCE_DAS_PROJECT_ID='<project-id>'
export TAURUSDB_SLOW_SQL_SOURCE_DAS_INSTANCE_ID='<instance-id>'
export TAURUSDB_SLOW_SQL_SOURCE_DAS_AUTH_TOKEN='<iam-token>'
export TAURUSDB_SLOW_SQL_SOURCE_DAS_DATASTORE_TYPE=TaurusDB
```

CES / Cloud Eye metrics：

```bash
export TAURUSDB_METRICS_SOURCE_CES_ENABLED=true
export TAURUSDB_METRICS_SOURCE_CES_ENDPOINT='<ces-endpoint>'
export TAURUSDB_METRICS_SOURCE_CES_PROJECT_ID='<project-id>'
export TAURUSDB_METRICS_SOURCE_CES_INSTANCE_ID='<instance-id>'
export TAURUSDB_METRICS_SOURCE_CES_NODE_ID='<node-id>'
export TAURUSDB_METRICS_SOURCE_CES_AUTH_TOKEN='<iam-token>'
```

默认 CES 假设：

- `TAURUSDB_METRICS_SOURCE_CES_NAMESPACE=SYS.GAUSSDB`
- `TAURUSDB_METRICS_SOURCE_CES_INSTANCE_DIMENSION=gaussdb_mysql_instance_id`
- `TAURUSDB_METRICS_SOURCE_CES_NODE_DIMENSION=gaussdb_mysql_node_id`
- `TAURUSDB_METRICS_SOURCE_CES_PERIOD=60`
- `TAURUSDB_METRICS_SOURCE_CES_FILTER=average`

如果云端返回空数据，优先排查 endpoint、region、project_id、instance_id、node_id、dimension name 和时间窗口，不要直接判定 MCP 代码失败。

### 3.1 推荐控制面配置方式

默认推荐先在启动 MCP Server 的进程环境里通过 `export` 注入 `region + AK/SK`，再在 MCP 客户端里调用 `list_cloud_taurus_instances` 验证控制面是否连通。这样更符合最终用户的实际使用方式，也避免把会话内临时调试配置当成默认主路径。

最小控制面配置：

```bash
export TAURUSDB_CLOUD_REGION='<region>'
export TAURUSDB_CLOUD_ACCESS_KEY_ID='<access-key-id>'
export TAURUSDB_CLOUD_SECRET_ACCESS_KEY='<secret-access-key>'
```

如果使用临时 AK/SK，再补：

```bash
export TAURUSDB_CLOUD_SECURITY_TOKEN='<session-token>'
```

然后在 MCP 客户端里调用：

1. `list_cloud_taurus_instances`
2. 可选：`select_cloud_taurus_instance`

`list_cloud_taurus_instances` 成功时，说明当前 MCP 会话已经拿着环境变量中的凭证成功访问华为云控制面。重点观察：

- 返回成功
- `cloud.region` 有值
- `cloud.project_id` 有值
- `items` 返回当前账号在该 region / project 下可见的 TaurusDB 实例列表

注意：

- 该 Tool 不会回显 `AK/SK` 原文，也不会返回完整凭证信息。
- 如果 `AK/SK` 缺失、错误、过期或权限不足，通常会返回明确的鉴权或 project lookup 错误。
- 云侧 evidence 默认启用；如果只想单独关闭某一类云源，优先使用 `TAURUSDB_CLOUD_ENABLE_DAS=false` 或 `TAURUSDB_CLOUD_ENABLE_CES=false` 这类更细粒度开关。

如果你需要在不重启 server 的情况下临时切换 region 或凭证，再使用下面这组会话级 Tool：

1. `set_cloud_region`
2. `set_cloud_access_keys`
3. `list_cloud_taurus_instances`
4. `select_cloud_taurus_instance`

这组 Tool 会在当前 MCP 会话里更新 region、AK/SK、默认 `project_id`、默认 `instance_id` 和默认 `node_id`。切换 region 或 AK/SK 后，server 会重建 cloud-aware engine，后续 diagnostics 会自动沿用新的会话上下文。

---

## 4. 上云 Preflight

先构建：

```bash
npm run build
```

再跑云端验证脚本：

```bash
npm run cloud:validate
```

建议先按“控制面 -> 数据面”的顺序做最小验证，不要一开始就把云账号鉴权、数据库连通性、DAS/CES 证据源混在一步里。

### 4.1 最小验证顺序

第一步：只验证控制面。

先通过环境变量配置 `TAURUSDB_CLOUD_REGION`、`TAURUSDB_CLOUD_ACCESS_KEY_ID`、`TAURUSDB_CLOUD_SECRET_ACCESS_KEY`，然后在 MCP 客户端里调用：

1. `list_cloud_taurus_instances`
2. 可选：`select_cloud_taurus_instance`

通过标准：

- `list_cloud_taurus_instances` 返回成功
- 返回结果里的 `cloud.project_id` 有值
- `items` 返回实例列表

这一步通过，说明当前 MCP 会话已经连上目标华为云账号，并且至少具备实例查看能力。

第二步：再验证数据面。

先配置 datasource，然后在 MCP 客户端里调用：

1. `list_data_sources`
2. `execute_readonly_sql`，执行 `SELECT 1 AS ok`

通过标准：

- `list_data_sources` 能看到目标 datasource
- `execute_readonly_sql` 成功返回
- 查询结果中返回 `1`

第三步：可选增强。

在上面两步都通过后，再执行：

```bash
npm run cloud:validate
```

这个脚本适合做整体验证，因为它会同时检查 datasource、readonly SQL、capability probe、实例自动解析，以及启用时的 DAS / CES 连通性。

默认检查：

- datasource profile 是否能加载
- readonly context 是否能解析
- `SELECT 1` 是否能执行
- `list_databases` 是否可用
- 默认数据库存在时，`list_tables` 是否可用
- `explain_sql` 底层链路是否可用
- capability probe 是否能返回 kernel / feature 信息
- 如果启用了 cloud evidence，但没显式给 `project_id` / `instance_id` / `node_id`，会尝试自动解析
- DAS / CES 如果启用，则检查对应云接口可访问性

可选增强项：

```bash
export TAURUSDB_CLOUD_VALIDATE_DATASOURCE=cloud_taurus
export TAURUSDB_CLOUD_VALIDATE_DATABASE='<database>'
export TAURUSDB_CLOUD_VALIDATE_TABLE='<table>'
export TAURUSDB_CLOUD_VALIDATE_EXPLAIN_SQL='SELECT * FROM <table> WHERE id = 1'
export TAURUSDB_CLOUD_VALIDATE_DIAGNOSTICS=true
export TAURUSDB_CLOUD_VALIDATE_TIME_RANGE=30m
npm run cloud:validate
```

通过标准：

- 通用数据面检查全部 `[ok]`
- 脚本任一启用项失败时，退出码为非 0
- capability probe 有可解释输出
- DAS / CES 启用时返回 2xx 或明确的权限/配置错误
- diagnostics 开启时不出现未处理异常，缺证据时通过 `status` / `limitations` 表达

---

## 5. MCP 客户端接入

先在当前机器确认 server 可启动：

```bash
node packages/mcp/dist/index.js
```

stdio server 正常时会保持运行，不会打印 HTTP 地址。真实客户端接入建议用 `init`：

```bash
npx @huaweicloud/taurusdb-mcp init --client claude
npx @huaweicloud/taurusdb-mcp init --client cursor
npx @huaweicloud/taurusdb-mcp init --client vscode
```

如果你在仓库源码里联调，也可以让客户端直接指向：

```bash
node /path/to/taurus-mcp-server/packages/mcp/dist/index.js
```

注意：

- 日志写 stderr，stdout 只保留 MCP JSON-RPC。
- 客户端进程必须能继承上面配置好的环境变量，或在客户端 MCP 配置里显式写入 env。
- 云端首轮不要直接让模型执行写 SQL；先用 Inspector 或明确 tool call 验证 confirmation token。

---

## 6. 推荐 Tool 验证顺序

第一轮：通用主链路。

1. `list_data_sources`
2. `list_databases`
3. `list_tables`
4. `describe_table`
5. `execute_readonly_sql`
6. `explain_sql`
7. `execute_sql` 首次返回 `CONFIRMATION_REQUIRED`，第二次带 `confirmation_token` 执行

第二轮：Taurus 专属能力。

1. `get_kernel_info`
2. `list_taurus_features`
3. `list_cloud_taurus_instances`，确认当前云账号和 project 下的实例 `name/id/default_node_id`
4. `select_cloud_taurus_instance`，把当前会话默认 `instance_id/node_id` 固定下来
5. 如果需要临时切换 region 或凭证，再调用 `set_cloud_region` / `set_cloud_access_keys`
6. `explain_sql_enhanced`，仅在 capability probe 暴露该 Tool 时验证
7. `flashback_query`，仅在 capability probe 暴露该 Tool 时验证
8. `list_recycle_bin`，仅在 capability probe 暴露该 Tool 时验证
9. `restore_recycle_bin_table`，只在 disposable test table 上验证，且必须经过 confirmation token

`restore_recycle_bin_table` 的最小确认流是：

1. 第一次调用不带 `confirmation_token`
2. 记录返回的 `confirmation_token`
3. 使用完全相同的 `recycle_table`、`method`、`destination_database`、`destination_table` 重试

第三轮：diagnostics。

1. `find_top_slow_sql`
2. `diagnose_slow_query`
3. `show_processlist`
4. `diagnose_lock_contention`
5. `diagnose_connection_spike`
6. `diagnose_replication_lag`
7. `diagnose_storage_pressure`
8. `diagnose_service_latency`
9. `diagnose_db_hotspot`

验收重点：

- 每个 Tool 都返回标准 envelope：`ok`、`summary`、`metadata.task_id`。
- 失败时有稳定 `error.code`，不是未处理异常。
- diagnostics 结果有 `status`、`evidence`、`limitations`、`recommended_actions` 或 `recommended_next_tools`。
- 云侧证据接通时，`evidence[].source` 能看到 `ces_metrics`、`das_top_slow_log`、`das_slow_query_logs` 等来源。

---

## 7. 常见失败归因

| 现象 | 优先排查 |
| --- | --- |
| datasource 不存在 | `TAURUSDB_SQL_DATASOURCE`、`TAURUSDB_DEFAULT_DATASOURCE`、`TAURUSDB_SQL_PROFILES` |
| 连接失败 | VPC、白名单、安全组、host、port、TLS、账号密码 |
| `list_tables` 失败 | 默认 database 缺失或账号无目标库权限 |
| Taurus 专属 Tool 不暴露 | capability probe 判定 feature unavailable，或当前实例不是 TaurusDB 内核 |
| `execute_sql` 不暴露 | `TAURUSDB_MCP_ENABLE_MUTATIONS` 未启用 |
| confirmation token 无效 | 第二次 SQL 文本、datasource、database 与第一次不一致，或 token 已使用 |
| diagnostics 没有云侧 evidence | DAS / CES 未启用，token / endpoint / dimension 错误，或时间窗口无数据 |
| `diagnose_replication_lag` 返回 `not_applicable` | 单机实例、无只读节点、复制状态命令不可用，属于可接受降级 |

---

## 8. 云端通过标准

可以判定 MCP 部分具备上云测试完成条件时，至少满足：

- `npm run build` 通过。
- `npm run cloud:validate` 的数据面检查全部通过。
- MCP client 能列出通用 Tool 和 diagnostics Tool。
- 通用主链路 discovery / readonly / explain / confirmation 全部通过。
- `get_kernel_info` / `list_taurus_features` 可用，并且 feature gate 行为清晰。
- `explain_sql_enhanced` / `flashback_query` 在支持实例上可用，在不支持实例上不误暴露或明确降级。
- `list_recycle_bin` 在支持实例上可用；`restore_recycle_bin_table` 只对测试对象验证 confirmation 流和恢复结果。
- 至少一条 diagnostics 能返回真实数据面 evidence。
- 如果配置了 CES / DAS，至少一条 diagnostics 能看到云侧 evidence，或者返回明确配置/权限/无数据原因。
