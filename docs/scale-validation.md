# 审计与规模边界验证手册

本文说明如何验证 TaurusDB MCP 0.5.x 的生产保护能力：

1. 审计日志容量限制、安全轮转、私有文件权限和并发写入完整性；
2. 查询并发、等待队列、大结果集字节限制和 MySQL 真实协议链路。

这些检查证明配置的安全边界能够生效，但不等同于特定客户实例的吞吐容量承诺。
正式发布仍需在真实 TaurusDB 上执行 `docs/release-readiness.md` 中的 RC gate。

## 1. 验证环境

- Node.js 20 或 22；
- 使用锁文件安装依赖：`npm ci`；
- MySQL 集成验证需要 Docker 或可丢弃的 MySQL 8.0 实例；
- 从仓库根目录运行下列命令。

先记录待验收版本：

```bash
git rev-parse HEAD
node --version
npm --version
```

验收记录必须保存 commit SHA、运行时间、操作系统、Node.js 版本和完整命令输出。

## 2. 一键发布门禁

```bash
npm ci
npm run release:check
```

通过标准：

- TypeScript 构建和类型检查成功；
- Core 和 MCP 自动化测试没有失败；
- production dependency audit 没有达到阻断级别的漏洞；
- `taurusdb-core`、`taurusdb-mcp` 均可生成发布包。

`release:check` 不会自动创建 MySQL 容器。MySQL 集成场景由 GitHub Actions 的
`local-mysql` job 执行，也可以按本文第 5 节在本地运行。

## 3. 审计日志验证

### 3.1 自动化验证

```bash
npm run build --workspace taurusdb-core
node --test packages/core/tests/audit-writer.test.mjs
node --test packages/core/tests/config.test.mjs
```

测试覆盖：

- 新建审计文件权限为 `0600`；
- 拒绝把符号链接作为审计目标；
- `TAURUSDB_MCP_AUDIT_MAX_BYTES` 和
  `TAURUSDB_MCP_AUDIT_MAX_FILES` 能正确进入运行时配置；
- 200 个并发事件触发多次轮转后，每一行仍是合法 JSON；
- 事件 `task_id` 没有重复或丢失；
- 活动文件和所有轮转文件都保持私有权限。

命令退出码必须为 `0`，输出中不得出现 `fail`、`cancelled` 或未预期的 `skipped`。

### 3.2 运行时人工验证

在隔离的验收进程中使用较小阈值，便于快速触发轮转：

```bash
export TAURUSDB_MCP_AUDIT_LOG_PATH=/tmp/taurusdb-mcp-validation/audit.jsonl
export TAURUSDB_MCP_AUDIT_MAX_BYTES=4096
export TAURUSDB_MCP_AUDIT_MAX_FILES=3
export TAURUSDB_MCP_AUDIT_INCLUDE_RAW_SQL=false
```

启动 MCP 后连续调用 `ping`、`list_data_sources` 或只读查询，直到产生
`audit.jsonl.1`。随后检查：

```bash
ls -la /tmp/taurusdb-mcp-validation
wc -l /tmp/taurusdb-mcp-validation/audit.jsonl*
```

Linux 权限检查：

```bash
stat -c '%a %n' /tmp/taurusdb-mcp-validation/audit.jsonl*
```

macOS 权限检查：

```bash
stat -f '%Lp %N' /tmp/taurusdb-mcp-validation/audit.jsonl*
```

通过标准：

- 存在活动文件 `audit.jsonl` 和至少一个轮转文件 `audit.jsonl.1`；
- 最多保留一个活动文件和 3 个轮转文件；
- 所有文件权限均为 `600`；
- 每一行都可以独立解析为 JSON；
- 默认记录 `sql_hash`，不记录 `raw_sql`；
- 每条调用包含 `timestamp`、`task_id`、`tool`、`actor`、`decision`、
  `outcome` 和 `duration_ms`。

生产验收还必须验证日志采集器同时采集活动文件和轮转文件，并在采集端断网恢复后
没有事件丢失。轮转文件是本地磁盘保护，不替代集中式 append-only/WORM 留存。

## 4. 并发、队列与大结果验证

### 4.1 确定性自动化验证

```bash
npm run build --workspace taurusdb-core
node --test packages/core/tests/concurrency-limiter.test.mjs
node --test packages/core/tests/redaction.test.mjs
```

测试覆盖及通过标准：

| 场景 | 输入 | 通过标准 |
| --- | --- | --- |
| 并发上限 | 200 个任务、并发上限 8 | 峰值活动任务严格等于 8，全部任务最终释放 |
| 队列容量 | 并发 1、队列 1，再提交第 3 个任务 | 第 3 个任务返回 `QueryConcurrencyError`，错误码为 `SERVER_BUSY` |
| 排队超时 | 活动任务不释放，队列超时 5 ms | 排队任务返回 `SERVER_BUSY`，不会无限等待 |
| 大结果集 | 10,000 行、每行约 4 KiB、预算 64 KiB | `byteTruncated=true`、`rowTruncated=true`，返回字节数不超过 64 KiB |
| 大字段/BLOB | 字段和 BLOB 超过各自预算 | 字段被截断或脱敏，响应不突破总字节预算 |

这里验证的是内存中的确定性保护逻辑。它不能证明某个 TaurusDB 规格能够承受固定
QPS，也不能替代真实网络、连接池和慢 SQL 场景的容量测试。

### 4.2 推荐生产配置检查

```bash
TAURUSDB_MCP_MAX_CONCURRENT_QUERIES=8
TAURUSDB_MCP_MAX_QUEUED_QUERIES=32
TAURUSDB_MCP_QUEUE_TIMEOUT_MS=5000
TAURUSDB_MCP_MAX_STATEMENT_MS=15000
TAURUSDB_MCP_MAX_ROWS=200
TAURUSDB_MCP_MAX_RESULT_BYTES=1048576
TAURUSDB_MCP_MAX_BLOB_BYTES=65536
```

对验收环境施加持续负载和突发负载，至少记录：

- MCP P50、P95、P99 延迟和错误码分布；
- `SERVER_BUSY` 数量与比例；
- MCP 进程 CPU、RSS、事件循环延迟；
- TaurusDB 活动连接数和 `max_connections` 余量；
- 查询超时后的连接回收情况；
- 审计磁盘增长速度和集中采集延迟。

队列饱和时允许出现受控的 `SERVER_BUSY`；不允许出现无限排队、进程失去响应、
结果字节数突破配置或数据库连接持续泄漏。

## 5. MySQL 8 集成验证

最可靠的执行方式是推送分支或创建 PR，确认 GitHub Actions 中的 `local-mysql` job
通过。该 job 会创建独立只读/写入账号并运行：

```bash
node --test packages/mcp/tests/local-mysql.test.mjs
```

本地使用可丢弃 MySQL 8.0 时，先按 `.github/workflows/ci.yml` 创建数据库及
最小权限测试账号，再提供以下变量：

```bash
export TAURUSDB_RUN_LOCAL_MYSQL_TESTS=1
export TAURUSDB_TEST_MYSQL_BOOTSTRAP_DSN='mysql://root:<root-password>@127.0.0.1:3306/taurus_mcp_test'
export TAURUSDB_TEST_MYSQL_HOST=127.0.0.1
export TAURUSDB_TEST_MYSQL_PORT=3306
export TAURUSDB_TEST_MYSQL_DATABASE=taurus_mcp_test
export TAURUSDB_TEST_MYSQL_USER=taurus_ro
export TAURUSDB_TEST_MYSQL_PASSWORD='<readonly-test-password>'
export TAURUSDB_TEST_MYSQL_MUTATION_USER=taurus_rw
export TAURUSDB_TEST_MYSQL_MUTATION_PASSWORD='<mutation-test-password>'

npm run build
node --test packages/mcp/tests/local-mysql.test.mjs
```

通过标准：

- 输出中的 MySQL 用例实际执行，不能显示 `SKIP`；
- 数百行、每行约 4 KiB 的查询结果在配置为 8192 bytes 时，MCP 返回
  `byte_truncated=true`、`row_truncated=true` 且 `returned_bytes <= 8192`；
- discovery、只读查询、EXPLAIN、SQL Advice 和诊断链路均通过；
- 测试完成后大结果临时表被清理。

仅看到 `local-mysql` job 为绿色还不够；验收人应展开日志，确认测试汇总中的
`skipped` 为 `0`。

## 6. 真实 TaurusDB 容量验收

在与生产一致的网络路径和 TaurusDB 规格上验证：

1. 只读查询持续负载、突发负载和队列饱和；
2. 小结果、高行数、大字段/BLOB 和敏感字段脱敏；
3. 慢查询超过 MCP timeout 后的连接回收；
4. 连接池上限、数据库连接余量和多 MCP 进程叠加；
5. 审计轮转、采集断网恢复、集中保留和磁盘告警；
6. 主节点、只读节点以及故障切换后的诊断降级行为。

验收报告必须注明版本 SHA、npm integrity、实例规格、数据量、SQL 形态、并发模型、
限额配置、持续时间和原始指标位置。没有这些证据时，只能声明安全边界经过验证，
不能声明达到某个吞吐或并发容量。

## 7. 验收结论模板

```text
Commit SHA:
Node.js / OS:
release:check: PASS / FAIL
Audit rotation tests: PASS / FAIL
Concurrency and result-bound tests: PASS / FAIL
MySQL integration (skipped must be 0): PASS / FAIL
Real TaurusDB RC: PASS / FAIL / NOT RUN
Central audit collector recovery: PASS / FAIL / NOT RUN
Evidence location:
Reviewer:
Date:
```

只有自动化门禁、MySQL 集成、真实 TaurusDB RC 和客户侧审计采集验收均通过时，
才能对对应部署边界给出生产发布结论。
