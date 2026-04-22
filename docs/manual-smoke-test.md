# 华为云 TaurusDB MCP 手工 Smoke Test 指南

> 本文档面向开发联调和本地自测，目标是让你从 0 开始，在本机把 `@huaweicloud/taurusdb-mcp` 的 MySQL 手工 smoke test 跑通。

配套文档：

- [testing.md](/Users/youweichen/projects/taurus-mcp-server/docs/testing.md)
- [testing-cases.md](/Users/youweichen/projects/taurus-mcp-server/docs/testing-cases.md)
- [testdata/mysql/README.md](/Users/youweichen/projects/taurus-mcp-server/testdata/mysql/README.md)

---

## 1. 目标

完成本文后，你应该能在本机完成下面这些事：

- 用 Docker Compose 启一个标准本地 MySQL 测试库
- 给 MCP 配好本地环境变量
- 启动本地 MCP server
- 手工验证 discovery / readonly / explain / mutation / status / cancel 主链路

---

## 2. 前置条件

开始前先确认：

- 你当前在仓库根目录：
  `/Users/youweichen/projects/taurus-mcp-server`
- 本机已安装 Docker
- 本机可执行 `docker compose`
- 本机已执行过依赖安装：

```bash
npm install
```

如果你还没装依赖，先做这一步。

---

## 3. 第一步：启动本地 MySQL 测试库

仓库已经提供了本地测试用的 compose 文件：

- [testdata/mysql/compose.yaml](/Users/youweichen/projects/taurus-mcp-server/testdata/mysql/compose.yaml)

它会自动完成：

- 启动 MySQL 8
- 初始化数据库 `taurus_mcp_test`
- 导入 schema 和 seed 数据
- 创建只读 / 写入测试账号

### 3.1 启动 MySQL

在仓库根目录执行：

```bash
docker compose -f testdata/mysql/compose.yaml up -d
```

### 3.2 查看状态

```bash
docker compose -f testdata/mysql/compose.yaml ps
```

预期结果：

- 服务名是 `taurus-mysql-e2e`
- 状态是 `Up`
- 最好显示 `(healthy)`
- 端口映射是 `3306 -> 3306`

### 3.3 默认连接信息

这套本地测试库默认信息如下：

- host: `127.0.0.1`
- port: `3306`
- database: `taurus_mcp_test`
- root: `root / root`
- readonly user: `taurus_ro / taurus_ro_password`
- mutation user: `taurus_rw / taurus_rw_password`

### 3.4 如果要彻底重建本地数据

```bash
docker compose -f testdata/mysql/compose.yaml down -v
docker compose -f testdata/mysql/compose.yaml up -d
```

这会删除 volume 并重新初始化数据库。

---

## 4. 第二步：配置 MCP 环境变量

这些环境变量建议直接在你**当前终端会话**里执行。

注意：

- 只在当前 shell 生效
- 关闭终端后会失效
- 这是最适合临时联调的方式

在仓库根目录执行：

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

### 4.1 可选：检查环境变量是否生效

```bash
env | rg '^TAURUSDB_' | sed 's/=.*$/=<set>/'
```

预期结果：

- 上面这些变量都能看到
- 不需要在输出中显示明文密码

---

## 5. 第三步：构建并启动 MCP

### 5.1 构建

```bash
npm run build
```

预期结果：

- `packages/core/dist` 和 `packages/mcp/dist` 构建成功

### 5.2 启动 MCP

```bash
node packages/mcp/dist/index.js
```

预期结果：

- 进程保持运行
- stderr 能看到启动日志
- 不应立即异常退出

说明：

- 这个命令启动的是 `stdio` MCP server
- 它不会像 HTTP 服务那样打印访问地址
- 启动后需要由 MCP client 来调它

---

## 6. 第四步：选择一种手工验证方式

你可以选下面任意一种。

### 方式 A：先用 MCP Inspector

这是**最推荐的第一轮手工 smoke 方式**。

原因：

- 它更适合验证 MCP 协议本身
- 你可以直接看到 tool 列表、入参、原始返回
- 更容易检查 `ok`、`summary`、`metadata`、`error.code`
- 更适合验证 confirmation token 主链路

建议优先用它做：

- discovery
- readonly
- explain
- mutation confirmation
- query status
- cancel

### 方式 B：再用 Claude Code / MCP 客户端调

这是**第二轮真实使用体验验证**，不建议跳过 Inspector 直接上。

原因：

- Claude 更适合验证真实使用体验
- 但不如 Inspector 适合定位底层协议和返回结构问题

建议在 Inspector 验证通过后，再用 Claude 验证：

- MCP 是否能被客户端识别
- 自然语言场景下是否能顺利调用正确 Tool
- 返回体验是否合理

### 方式 C：先跑自动化 e2e，当作 smoke baseline

如果你只是想先确认环境没问题，可以执行：

```bash
env TAURUSDB_RUN_LOCAL_MYSQL_TESTS=true \
TAURUSDB_TEST_MYSQL_HOST=127.0.0.1 \
TAURUSDB_TEST_MYSQL_PORT=3306 \
TAURUSDB_TEST_MYSQL_DATABASE=taurus_mcp_test \
TAURUSDB_TEST_MYSQL_USER=taurus_ro \
TAURUSDB_TEST_MYSQL_PASSWORD=taurus_ro_password \
TAURUSDB_TEST_MYSQL_MUTATION_USER=taurus_rw \
TAURUSDB_TEST_MYSQL_MUTATION_PASSWORD=taurus_rw_password \
TAURUSDB_TEST_MYSQL_BOOTSTRAP_DSN=mysql://root:root@127.0.0.1:3306/mysql \
npm run test --workspace @huaweicloud/taurusdb-mcp
```

如果这一步全绿，再做下面的手工 smoke。

---

## 7. 第五步：用 MCP Inspector 做第一轮手工 Smoke

### 7.1 为什么先用 Inspector

推荐顺序是：

1. 先用 Inspector 做 MCP 协议级 smoke
2. 再用 Claude Code 做真实使用体验验证

这样做的原因是：

- Inspector 更适合确认 MCP Server 本身有没有问题
- Claude 更适合确认“作为 AI 客户端接入后好不好用”

如果一上来就直接用 Claude，出现问题时不容易区分是：

- MCP server 配置问题
- tool 返回结构问题
- client 接入问题
- 模型选择 tool 的行为问题

所以建议先把底层链路在 Inspector 里测干净。

### 7.2 启动 Inspector

先确认当前终端里已经有第 4 步的环境变量。

然后在仓库根目录执行：

```bash
npx @modelcontextprotocol/inspector \
  node packages/mcp/dist/index.js
```

如果 Inspector 启动成功，通常会输出本地访问地址，随后在浏览器里打开。

如果你更习惯把环境变量和命令写在一起，也可以用这种方式：

```bash
env TAURUSDB_SQL_ENGINE=mysql \
TAURUSDB_SQL_DATASOURCE=local_mysql \
TAURUSDB_SQL_HOST=127.0.0.1 \
TAURUSDB_SQL_PORT=3306 \
TAURUSDB_SQL_DATABASE=taurus_mcp_test \
TAURUSDB_SQL_USER=taurus_ro \
TAURUSDB_SQL_PASSWORD=taurus_ro_password \
TAURUSDB_SQL_MUTATION_USER=taurus_rw \
TAURUSDB_SQL_MUTATION_PASSWORD=taurus_rw_password \
TAURUSDB_DEFAULT_DATASOURCE=local_mysql \
TAURUSDB_MCP_ENABLE_MUTATIONS=true \
TAURUSDB_MCP_LOG_LEVEL=info \
npx @modelcontextprotocol/inspector \
  node packages/mcp/dist/index.js
```

### 7.3 用 Inspector 时重点看什么

重点看：

- 是否成功列出 Tool
- 每个 Tool 的输入 schema 是否合理
- 调用后返回的原始响应结构是否完整
- `ok`、`summary`、`metadata` 是否稳定
- 失败时 `error.code` 是否明确
- confirmation token 是否能完整看到和复用

### 7.4 Inspector 推荐验证顺序

下面按推荐顺序一条条测。

### 7.4.1 `list_data_sources`

目标：

- 确认 datasource 解析正常

预期结果：

- 默认 datasource 是 `local_mysql`
- 返回 host / port / engine 等公开信息
- 不泄露密码

### 7.4.2 `list_tables`

参数：

- `database=taurus_mcp_test`

目标：

- 确认 schema 探查主链路正常

预期结果：

- 返回以下表：
  - `orders`
  - `users`
  - `payments`
  - `audit_events`

### 7.4.3 `describe_table`

参数：

- `database=taurus_mcp_test`
- `table=orders`

目标：

- 确认表结构、索引、主键和 engine hints 正常

预期结果：

- 返回 `primary_key`
- 返回 `indexes`
- `engine_hints.likely_time_columns` 包含 `created_at`

### 7.4.4 `execute_readonly_sql`

SQL：

```sql
SELECT status, COUNT(*) AS order_count
FROM orders
GROUP BY status
ORDER BY status
```

目标：

- 确认只读执行主链路正常

预期结果：

- `ok=true`
- `metadata.statement_type=select`
- `metadata.task_id`、`metadata.sql_hash` 存在
- 返回聚合结果

### 7.4.5 `explain_sql`

SQL：

```sql
SELECT id, status
FROM orders
WHERE status = 'paid'
ORDER BY created_at DESC
LIMIT 5
```

目标：

- 确认 explain 主链路和 guardrail 信息正常

预期结果：

- 返回 `plan`
- 返回 `guardrail`
- 返回 `duration_ms`

### 7.4.7 `execute_sql` 第一次调用

SQL：

```sql
UPDATE orders
SET status = 'paid'
WHERE id = 1
```

首次调用时：

- 不带 `confirmation_token`

目标：

- 确认 mutation 默认走确认流

预期结果：

- 返回 `ok=false`
- `error.code=CONFIRMATION_REQUIRED`
- 返回 `confirmation_token`
- 数据库此时还没实际变更

### 7.4.8 `execute_sql` 第二次调用

SQL：

- 必须与上一步完全一致

参数：

- 携带上一步返回的 `confirmation_token`

目标：

- 确认 token 校验通过后 mutation 能执行

预期结果：

- 返回 mutation 成功
- `affected_rows` 合理
- 数据库里对应记录已变更

---

## 8. 第六步：再用 Claude Code 做第二轮验证

在 Inspector 验证通过后，再做这一轮。

### 8.1 为什么还要再测 Claude

因为 Inspector 只能证明：

- MCP 协议是通的
- Tool 可调用
- 返回结构是对的

但 Claude 这一轮要验证的是：

- Claude Code 能不能识别并连接这个 MCP
- Tool 在自然语言场景下是否容易被正确选择
- 整体交互体验是否合理

### 8.2 在 Claude Code 中接入本地 MCP

如果你已经在当前 shell 配好了环境变量，可以直接执行：

```bash
claude mcp add --transport stdio --scope local \
  --env TAURUSDB_SQL_ENGINE="$TAURUSDB_SQL_ENGINE" \
  --env TAURUSDB_SQL_DATASOURCE="$TAURUSDB_SQL_DATASOURCE" \
  --env TAURUSDB_SQL_HOST="$TAURUSDB_SQL_HOST" \
  --env TAURUSDB_SQL_PORT="$TAURUSDB_SQL_PORT" \
  --env TAURUSDB_SQL_DATABASE="$TAURUSDB_SQL_DATABASE" \
  --env TAURUSDB_SQL_USER="$TAURUSDB_SQL_USER" \
  --env TAURUSDB_SQL_PASSWORD="$TAURUSDB_SQL_PASSWORD" \
  --env TAURUSDB_SQL_MUTATION_USER="$TAURUSDB_SQL_MUTATION_USER" \
  --env TAURUSDB_SQL_MUTATION_PASSWORD="$TAURUSDB_SQL_MUTATION_PASSWORD" \
  --env TAURUSDB_DEFAULT_DATASOURCE="$TAURUSDB_DEFAULT_DATASOURCE" \
  --env TAURUSDB_MCP_ENABLE_MUTATIONS="$TAURUSDB_MCP_ENABLE_MUTATIONS" \
  --env TAURUSDB_MCP_LOG_LEVEL="$TAURUSDB_MCP_LOG_LEVEL" \
  huaweicloud-taurusdb-local -- \
  node /Users/youweichen/projects/taurus-mcp-server/packages/mcp/dist/index.js
```

然后检查：

```bash
claude mcp list
claude mcp get huaweicloud-taurusdb-local
```

### 8.3 Claude Code 推荐验证内容

建议至少测这些自然语言请求：

1. “调用 `list_data_sources`，确认当前 datasource”
2. “列出 `taurus_mcp_test` 里的所有表”
3. “帮我看一下 `orders` 表结构”
4. “帮我抽样看看 `users` 表前 2 行”
5. “查询 `orders` 表按 `status` 分组的数量”
6. “帮我 explain 一下查询 `orders` 最近 5 条 paid 订单的 SQL”
7. “把 `orders` 表 `id=1` 的状态改成 `paid`”

重点看：

- Claude 是否能正确选到对应 Tool
- Tool 返回后 Claude 是否能组织出合理结论
- mutation 场景下是否能处理 confirmation token 过程

---

## 9. 手工验证时重点观察什么

不要只看“能不能返回数据”，同时看下面这些点。

### 9.1 Response Envelope

每次响应都看：

- 是否有 `ok`
- 是否有 `summary`
- 是否有 `metadata.task_id`
- 失败时是否有 `error.code`

### 9.2 Query Metadata

执行 SQL 时重点看：

- `metadata.task_id`
- `metadata.sql_hash`
- `metadata.statement_type`
- `metadata.duration_ms`

### 9.3 Guardrail 与确认流

重点看：

- 写 SQL 是否先走 `CONFIRMATION_REQUIRED`
- 错 token 是否会 `CONFIRMATION_INVALID`
- 正确 token 是否能执行

### 9.4 日志边界

重点看：

- stdout 不应被日志污染
- 日志应在 stderr

---

## 10. 常见问题

### 10.1 `docker compose up -d` 失败

先看：

- `3306` 是否已被占用
- Docker Desktop 是否正常运行
- `docker compose ps` 是否显示容器反复重启

### 10.2 MCP 启动后立刻退出

优先检查：

- 环境变量是否在当前 shell 生效
- MySQL 是否已启动
- `TAURUSDB_SQL_HOST/PORT/USER/PASSWORD` 是否正确

### 10.3 `execute_sql` 没暴露

检查：

```bash
echo $TAURUSDB_MCP_ENABLE_MUTATIONS
```

它应该是：

```bash
true
```

### 10.4 `npx @modelcontextprotocol/inspector` 启动失败

优先检查：

- 当前终端是否已执行 `npm install`
- 是否已经先 `npm run build`
- `node packages/mcp/dist/index.js` 单独运行是否正常

### 10.5 本地数据和预期不一致

直接重建：

```bash
docker compose -f testdata/mysql/compose.yaml down -v
docker compose -f testdata/mysql/compose.yaml up -d
```

---

## 11. 收尾

如果这轮只是临时验证，结束后可以停掉本地 MySQL：

```bash
docker compose -f testdata/mysql/compose.yaml down
```

如果下次还要继续测，保留容器和 volume 也没问题。
