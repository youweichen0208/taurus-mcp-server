# TaurusDB 云端全量测试执行手册

> 这份文档是把现有 `cloud-taurusdb-testing.md`、`taurusdb-ops-playbook.md`、`manual-smoke-test.md` 和案例模板收口成一条可执行主线。
>
> 目标：
>
> - 你可以按顺序一步一步执行
> - 每一步都知道要截图什么
> - 最后能直接整理出一份完整测试报告

配套阅读：

- [cloud-taurusdb-testing.md](./cloud-taurusdb-testing.md)
- [taurusdb-ops-playbook.md](./taurusdb-ops-playbook.md)
- [manual-smoke-test.md](./manual-smoke-test.md)
- [opentaurus-case-template.md](./opentaurus-case-template.md)

---

## 1. 测试目标与范围

这次云端测试建议覆盖 6 个层次：

1. 控制面连通
2. 数据面连通
3. 通用只读工具
4. diagnostics 诊断链路
5. TaurusDB 专属能力
6. 异常场景与降级行为

建议分成两类结果：

- `PASS`
- `PASS WITH SKIP`
  - 例如当前实例不是 TaurusDB、未开启 recycle bin、未配置 CES、无复制链路

不建议为了追求全绿而在生产实例上做高风险造数或破坏性验证。

---

## 2. 测试前准备

### 2.1 环境准备

在测试终端确认：

```bash
node -v
npm -v
npm install
npm run build
```

### 2.2 环境变量准备

最小数据面配置：

```bash
export TAURUSDB_SQL_ENGINE=mysql
export TAURUSDB_SQL_DATASOURCE=taurus_mcp
export TAURUSDB_SQL_HOST='<taurusdb-public-or-private-host>'
export TAURUSDB_SQL_PORT=3306
export TAURUSDB_SQL_DATABASE='taurusdb_test'
export TAURUSDB_SQL_USER='<readonly-user>'
export TAURUSDB_SQL_PASSWORD='<readonly-password>'
export TAURUSDB_DEFAULT_DATASOURCE=taurus_mcp
```

云控制面配置：

```bash
export TAURUSDB_CLOUD_REGION='cn-east-3'
export TAURUSDB_CLOUD_ACCESS_KEY_ID='<ak>'
export TAURUSDB_CLOUD_SECRET_ACCESS_KEY='<sk>'
```

如果当前阶段先跳过 CES：

```bash
export TAURUSDB_CLOUD_ENABLE_CES=false
```

如果要验证回收站恢复或其他确认流：

```bash
export TAURUSDB_MCP_ENABLE_MUTATIONS=true
export TAURUSDB_SQL_MUTATION_USER='<mutation-user>'
export TAURUSDB_SQL_MUTATION_PASSWORD='<mutation-password>'
```

### 2.3 测试前截图

至少保留 3 张环境截图：

1. TaurusDB 实例控制台总览
2. 安全组规则
3. 当前 `npm run cloud:validate` 成功结果

建议文件名：

```text
test-assets/cloud-taurusdb/00-instance-overview.png
test-assets/cloud-taurusdb/01-security-group.png
test-assets/cloud-taurusdb/02-cloud-validate.png
```

---

## 3. 测试基线

先记录这次测试的真实环境：

- 日期：
- 测试人：
- region：
- 实例名称：
- 实例 ID：
- 节点 ID：
- 连接方式：
  - `公网地址`
  - `ECS 同 VPC 内网地址`
- CES：
  - `启用`
  - `跳过`
- DAS：
  - `已启用`
  - `部分可用`
- `performance_schema`：
  - `ON`
  - `OFF`
- 实例识别结果：
  - `is_taurusdb=true`
  - `is_taurusdb=false`

建议把这部分直接写进最终报告开头。

---

## 4. 数据场景构造

下面的造数建议优先使用独立测试库和 disposable table，不要在真实业务表上操作。

### 4.1 建测试表

如果你有写权限，建议先准备 4 张表：

```sql
CREATE TABLE IF NOT EXISTS t_orders_test (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at DATETIME NOT NULL,
  note VARCHAR(255) DEFAULT ''
);

CREATE TABLE IF NOT EXISTS t_hot_counter_test (
  counter_key VARCHAR(64) PRIMARY KEY,
  counter_value BIGINT NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS t_storage_test (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  category VARCHAR(32) NOT NULL,
  payload LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS t_recycle_bin_test (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  value_text VARCHAR(255) NOT NULL
);
```

初始化热点计数器：

```sql
INSERT INTO t_hot_counter_test (counter_key, counter_value, updated_at)
VALUES ('global', 0, NOW())
ON DUPLICATE KEY UPDATE updated_at = NOW();
```

### 4.2 造慢查询样本

目标：让 `find_top_slow_sql` 和 `diagnose_slow_query` 有真实样本可看。

这一组验证建议拆成 3 段：

1. 前置造数
2. 场景 1：模糊匹配 + 排序 + 大 offset
3. 场景 2：无索引排序 + 长字段返回

#### 4.2.1 前置造数

先重建测试表，确保没有额外索引，并把 `note` 直接定义为足够长，避免后续扩长时再次遇到 `Data too long for column 'note'`：

```sql
DROP TABLE IF EXISTS t_orders_test;

CREATE TABLE t_orders_test (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at DATETIME NOT NULL,
  note VARCHAR(1024) DEFAULT ''
);
```

![前置造数：t_orders_test 建表结果](../test-assets/cloud-taurusdb/image-1.png)

把递归深度调大：

```sql
SET SESSION cte_max_recursion_depth = 220000;
```

一次性插入 200000 行测试数据：

```sql
INSERT INTO t_orders_test (user_id, status, amount, created_at, note)
WITH RECURSIVE seq AS (
  SELECT 1 AS n
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 200000
)
SELECT
  FLOOR(1 + RAND() * 20000) AS user_id,
  ELT(1 + FLOOR(RAND() * 4), 'PENDING', 'PAID', 'CANCELLED', 'REFUNDED') AS status,
  ROUND(10 + RAND() * 20000, 2) AS amount,
  NOW() - INTERVAL FLOOR(RAND() * 365) DAY AS created_at,
  CONCAT(
    'note_',
    FLOOR(RAND() * 1000000),
    '_',
    RPAD('', 300, 'x')
  ) AS note
FROM seq;
```

确认数据量：

```sql
SELECT COUNT(*) AS total_rows FROM t_orders_test;
```

![前置造数：t_orders_test 记录数确认](../test-assets/cloud-taurusdb/image-3.png)

再把一部分 `note` 扩长一轮，增加文本扫描和排序代价：

```sql
UPDATE t_orders_test
SET note = CONCAT(note, '_', RPAD('', 300, 'y'))
WHERE id % 2 = 0;
```

![前置造数：长 note 更新执行结果](../test-assets/cloud-taurusdb/image-4.png)

验证长 `note` 更新成功：

```sql
SELECT
  id,
  status,
  LENGTH(note) AS note_len,
  LEFT(note, 200) AS note_preview
FROM t_orders_test
WHERE id % 2 = 0
LIMIT 10;
```

前置造数阶段建议保留 4 张图：

- 造数前表结构
- 造数后记录数
- 长 `note` 更新后的样本行
- 基础造数脚本执行成功

#### 4.2.2 performance_schema 前置限制

如果要使用 `find_top_slow_sql` 或 `diagnose_slow_query` 做本地慢 SQL 分析，请先确认实例已开启 `performance_schema`。如果该参数为 `OFF`，本地 `statement digest` 证据不可用，结果通常会返回 `inconclusive` 或明确提示 `performance_schema` 未开启。

![performance_schema 未开启时的慢 SQL 分析提示](../test-assets/cloud-taurusdb/image-7.png)

如果当前实例未开启 `performance_schema`，建议按以下步骤处理：

1. 进入华为云 TaurusDB 实例控制台
2. 打开实例参数配置页面
3. 将参数 `performance_schema` 修改为 `ON`
4. 保存参数变更
5. 重启实例，使参数生效
6. 重启后重新执行测试查询，再调用 `find_top_slow_sql` 或 `diagnose_slow_query`

#### 4.2.3 场景 1：模糊匹配 + 排序 + 大 offset

目标：

- 验证 `LIKE '%999%'` 导致的全表扫描
- 验证排序 + offset 对慢 SQL 排名的影响
- 验证 `find_top_slow_sql` 和 `diagnose_slow_query` 能否识别该场景

```sql
SELECT
  id,
  user_id,
  status,
  amount,
  created_at
FROM t_orders_test
WHERE note LIKE '%999%'
ORDER BY created_at DESC
LIMIT 100 OFFSET 500;
```

建议连续执行这条 SQL `5-10` 次，再立刻调用 `find_top_slow_sql`。

![场景 1：LIKE 模糊匹配慢 SQL 执行结果](../test-assets/cloud-taurusdb/image-13.png)

![场景 1：find_top_slow_sql 命中 LIKE 模糊匹配 SQL](../test-assets/cloud-taurusdb/image-15.png)

场景 1 根因分析结果：
![场景 1：diagnose_slow_query 根因分析结果](../test-assets/cloud-taurusdb/image-16.png)

场景 1 结论：`find_top_slow_sql` 已识别 `LIKE '%999%'` 查询，`diagnose_slow_query` 已给出全表扫描、模糊匹配和排序相关根因。

场景 1 需要至少 3 张图：

1. 场景 1 SQL 执行截图
2. `find_top_slow_sql` 命中场景 1 SQL 的截图
3. `diagnose_slow_query` 返回场景 1 根因分析的截图

场景 1 验收点：

- `find_top_slow_sql` 中能看到 `WHERE note LIKE '%999%'`
- `diagnose_slow_query` 能指出全表扫描、模糊匹配或排序相关问题
- 返回里最好包含 `rows_examined`、`avg_latency_ms` 或 explain 证据

#### 4.2.4 场景 2：按无索引列排序并返回长字段

目标：

- 验证长字段返回和无索引排序的慢 SQL 场景
- 验证大 offset 和 `ORDER BY note DESC` 是否能进入慢 SQL 排名
- 验证根因分析能否指出 `ORDER BY note DESC` 的问题

```sql
SELECT
  id,
  user_id,
  status,
  amount,
  created_at,
  note
FROM t_orders_test
WHERE status IN ('PENDING', 'PAID', 'CANCELLED', 'REFUNDED')
ORDER BY note DESC
LIMIT 200 OFFSET 20000;
```

建议连续执行这条 SQL `5-10` 次，再立刻调用 `find_top_slow_sql`。

![场景 2：ORDER BY note DESC 慢 SQL 执行结果](../test-assets/cloud-taurusdb/image-17.png)
![场景 2：find_top_slow_sql 命中 ORDER BY note DESC SQL](../test-assets/cloud-taurusdb/image-18.png)

场景 2 根因分析结果：
![场景 2：diagnose_slow_query 根因分析结果](../test-assets/cloud-taurusdb/image-19.png)

场景 2 结论：`find_top_slow_sql` 已识别 `ORDER BY note DESC` 查询，`diagnose_slow_query` 已给出无索引排序、长字段返回和大 offset 相关根因。

场景 2 需要至少 3 张图：

1. 场景 2 SQL 执行截图
2. `find_top_slow_sql` 命中场景 2 SQL 的截图
3. `diagnose_slow_query` 返回场景 2 根因分析的截图

场景 2 验收点：

- `find_top_slow_sql` 中能看到 `ORDER BY note DESC`
- `diagnose_slow_query` 能指出无索引排序、长字段返回、大 offset 或排序代价问题
- 返回里最好包含 `rows_examined`、`avg_latency_ms` 或 explain 证据

#### 4.2.5 慢 SQL 场景统一执行顺序

推荐顺序：

1. 先插入 200000 行
2. 截图 `COUNT(*)`
3. 截图长 `note` 样本行
4. 连续执行场景 1 SQL
5. 立刻调用 `find_top_slow_sql`
6. 对场景 1 SQL 调用 `diagnose_slow_query`
7. 连续执行场景 2 SQL
8. 再次调用 `find_top_slow_sql`
9. 对场景 2 SQL 调用 `diagnose_slow_query`

慢 SQL 场景统一截图点：

- 造数前表为空
- 造数后记录数
- 长 note 更新成功后的样本行
- 场景 1 SQL 执行结果
- 场景 1 的 `find_top_slow_sql`
- 场景 1 的 `diagnose_slow_query`
- 场景 2 SQL 执行结果
- 场景 2 的 `find_top_slow_sql`
- 场景 2 的 `diagnose_slow_query`

### 4.3 造连接压力样本

目标：验证 `diagnose_connection_spike` / `show_processlist`。

#### 4.3.1 场景目标

- 验证工具是否能识别 `Sleep` 会话堆积
- 验证工具是否能识别活跃会话和连接增长
- 验证 `show_processlist` 与 `diagnose_connection_spike` 的联合证据链

#### 4.3.2 场景准备

建议至少准备 3 个数据库会话：

1. 会话 A：保持空闲，制造 `Sleep`
2. 会话 B：保持空闲，制造 `Sleep`
3. 会话 C：执行较慢 SQL，制造活跃连接

如果希望连接特征更明显，可以再加 1 到 2 个会话。

#### 4.3.3 触发步骤

会话 A：

```sql
SELECT 1;
```

执行后保持连接不断开，让它进入 `Sleep`。

会话 B：

```sql
SELECT 1;
```

执行后保持连接不断开，让它进入 `Sleep`。

会话 C：

```sql
SELECT
  id,
  user_id,
  status,
  amount,
  created_at,
  note
FROM t_orders_test
WHERE status IN ('PENDING', 'PAID', 'CANCELLED', 'REFUNDED')
ORDER BY note DESC
LIMIT 200 OFFSET 20000;
```

如果需要更多活跃连接，再额外开会话 D、E 执行同类慢 SQL。

#### 4.3.4 MCP 调用

先调用：

```json
{
  "datasource": "taurus_mcp",
  "database": "taurusdb_test",
  "include_idle": true,
  "include_info": true,
  "max_rows": 20
}
```

对应工具：

- `show_processlist`

然后调用：

```json
{
  "datasource": "taurus_mcp",
  "database": "taurusdb_test",
  "time_range": { "relative": "15m" },
  "compare_baseline": true,
  "evidence_level": "full"
}
```

对应工具：

- `diagnose_connection_spike`

#### 4.3.5 需要截图的结果

连接压力场景至少保留 3 张图：

1. 会话 C 的慢 SQL 执行截图
2. `show_processlist` 结果截图
3. `diagnose_connection_spike` 结果截图

#### 4.3.6 验收点

- `show_processlist` 中能看到 `Sleep` 会话
- `show_processlist` 中能看到至少一条活跃 SQL
- `diagnose_connection_spike` 返回 `evidence`
- `diagnose_connection_spike` 最好能指出连接堆积、可疑 user、client host 或会话状态

#### 4.3.7 场景结论模板

连接压力场景结论：`show_processlist` 已捕获空闲和活跃会话，`diagnose_connection_spike` 已返回连接增长相关证据，并能继续下钻到慢 SQL 或锁竞争方向。

### 4.4 造锁竞争样本

目标：验证 `diagnose_lock_contention`。

#### 4.4.1 场景目标

- 验证工具是否能识别 blocker / waiter
- 验证工具是否能识别行锁竞争
- 验证 `diagnose_lock_contention` 是否返回结构化证据和根因方向

#### 4.4.2 前置准备

确保热点表和测试数据已存在：

```sql
INSERT INTO t_hot_counter_test (counter_key, counter_value, updated_at)
VALUES ('global', 0, NOW())
ON DUPLICATE KEY UPDATE updated_at = NOW();
```

#### 4.4.3 触发步骤

1. 会话 A：

```sql
BEGIN;
UPDATE t_hot_counter_test
SET counter_value = counter_value + 1, updated_at = NOW()
WHERE counter_key = 'global';
```

2. 不提交会话 A
3. 会话 B 对同一行执行相同 `UPDATE`
4. 保持会话 B 挂起，制造锁等待窗口
5. 在阻塞窗口内调用 `show_processlist`
6. 再调用 `diagnose_lock_contention`

会话 B：

```sql
UPDATE t_hot_counter_test
SET counter_value = counter_value + 1, updated_at = NOW()
WHERE counter_key = 'global';
```

#### 4.4.4 MCP 调用

先调用：

```json
{
  "datasource": "taurus_mcp",
  "database": "taurusdb_test",
  "include_idle": true,
  "include_info": true,
  "max_rows": 20
}
```

对应工具：

- `show_processlist`

再调用：

```json
{
  "datasource": "taurus_mcp",
  "database": "taurusdb_test",
  "time_range": { "relative": "15m" },
  "evidence_level": "full",
  "include_raw_evidence": true
}
```

对应工具：

- `diagnose_lock_contention`

#### 4.4.5 需要截图的结果

锁竞争场景至少保留 4 张图：

1. 会话 A 持锁 SQL 截图
2. 会话 B 阻塞 SQL 截图
3. `show_processlist` 截图
4. `diagnose_lock_contention` 结果截图

#### 4.4.6 验收点

- 会话 A 未提交事务并持有目标行锁
- 会话 B 对同一行的 `UPDATE` 出现等待
- `show_processlist` 能看到阻塞会话
- `diagnose_lock_contention` 能返回 blocker / waiter 或锁等待证据

#### 4.4.7 场景结论模板

锁竞争场景结论：会话 A 持有热点行锁，会话 B 进入等待，`show_processlist` 已捕获阻塞窗口，`diagnose_lock_contention` 已返回锁等待相关证据和 blocker 方向。

### 4.5 造存储压力样本

目标：验证 `diagnose_storage_pressure`。

方案：

1. 往 `t_storage_test` 插入大量大字段文本
2. 执行较重排序或聚合

示例：

```sql
SELECT category, COUNT(*)
FROM t_storage_test
GROUP BY category
ORDER BY COUNT(*) DESC;
```

截图点：

- 表数据量
- `diagnose_storage_pressure` 的 `evidence`

### 4.6 回收站验证样本

前提：

- 当前实例支持 recycle bin
- tools 已暴露 `list_recycle_bin` / `restore_recycle_bin_table`
- mutation 已启用

方案：

1. 往 `t_recycle_bin_test` 插入少量数据
2. `DROP TABLE t_recycle_bin_test`
3. 调用 `list_recycle_bin`
4. 第一次调用 `restore_recycle_bin_table`，确认返回 `CONFIRMATION_REQUIRED`
5. 第二次带 `confirmation_token` 执行恢复

如果当前实例 `is_taurusdb=false` 或 feature 不支持，这一组直接记为 `SKIP`。

---

## 5. 执行步骤

下面按推荐顺序执行。

### 5.1 Preflight

执行：

```bash
npm run cloud:validate
```

验收：

- `MCP readonly SQL` 为 `ok`
- `Cloud instance resolution` 为 `ok`
- `DAS top-slow-log` 为 `ok` 或可接受跳过
- `CES validation` 为 `ok` 或显式跳过

截图：

- 整页 `cloud:validate` 结果

### 5.2 控制面验证

调用：

1. `list_cloud_taurus_instances`
2. `select_cloud_taurus_instance`

验收：

- 返回实例列表
- 选中实例后有 `instance_id` / `default_node_id`

截图：

- 实例列表
- 选中实例结果

### 5.3 通用只读工具

调用：

1. `execute_readonly_sql`
2. `list_databases`
3. `list_tables`
4. `describe_table`

推荐输入：

```json
{ "sql": "SELECT 1 AS ok" }
```

验收：

- 工具返回结构化成功结果
- 没有未处理异常

截图：

- `SELECT 1 AS ok`
- 库列表
- 表结构

### 5.4 能力发现

调用：

1. `get_kernel_info`
2. `list_taurus_features`

验收：

- 当前实例是否被识别成 TaurusDB
- 可用 feature 是否符合预期

如果返回 `is_taurusdb=false`：

- 不阻塞后续通用 diagnostics
- 但 TaurusDB 专属能力测试要转成 `SKIP`

截图：

- `get_kernel_info`
- `list_taurus_features`

### 5.5 Enhanced Explain

调用：

1. `explain_sql`
2. `explain_sql_enhanced`

建议输入：

- `SELECT 1`
- 一条真实业务只读 SQL
- 一条故意构造的排序/分页 SQL

验收：

- 能返回计划
- 如果专属增强能力可用，应返回 `taurusHints`、`optimizationSuggestions`
- 如果不可用，要能给出可接受降级

截图：

- 简单 SQL explain
- 业务 SQL explain
- 增强 explain 输出

### 5.6 慢 SQL / 延迟诊断

调用顺序：

1. `diagnose_service_latency`
2. `find_top_slow_sql`
3. `diagnose_slow_query`
4. 必要时 `explain_sql_enhanced`

建议输入：

```json
{
  "datasource": "taurus_mcp",
  "database": "taurusdb_test",
  "symptom": "latency",
  "time_range": { "relative": "30m" },
  "evidence_level": "standard"
}
```

```json
{
  "datasource": "taurus_mcp",
  "database": "taurusdb_test",
  "time_range": { "relative": "30m" },
  "top_n": 5,
  "sort_by": "total_latency"
}
```

验收：

- `diagnose_service_latency` 返回 `status`
- `find_top_slow_sql` 至少能返回 `status` 和 `evidence`
- 有样本时 `top_sqls` 不为空
- 无样本时 `inconclusive` 可接受，但要记录原因

截图：

- latency 诊断结果
- top slow sql 结果
- slow query 根因结果

### 5.7 连接暴涨诊断

调用：

1. `show_processlist`
2. `diagnose_connection_spike`

建议输入：

```json
{
  "datasource": "taurus_mcp",
  "database": "taurusdb_test",
  "time_range": { "relative": "15m" },
  "compare_baseline": true,
  "evidence_level": "full"
}
```

验收：

- 能识别 idle / active session 特征
- `evidence[].source` 至少包含 `processlist`
- 如果 CES 跳过，不要求 `ces_metrics`

截图：

- `show_processlist`
- `diagnose_connection_spike`

### 5.8 锁竞争诊断

调用：

1. `diagnose_lock_contention`
2. 可辅助 `show_processlist`

建议输入：

```json
{
  "datasource": "taurus_mcp",
  "database": "taurusdb_test",
  "time_range": { "relative": "15m" },
  "evidence_level": "full",
  "include_raw_evidence": true
}
```

验收：

- 能返回 blocker / waiter 或锁等待证据
- 没有未处理异常

截图：

- 阻塞窗口中的 `show_processlist`
- `diagnose_lock_contention` 结果

### 5.9 存储压力诊断

调用：

1. `diagnose_storage_pressure`

建议输入：

```json
{
  "datasource": "taurus_mcp",
  "database": "taurusdb_test",
  "scope": "database",
  "time_range": { "relative": "30m" },
  "evidence_level": "full"
}
```

验收：

- 能返回 `table_storage` 或本地 SQL 证据
- 若 CES 关闭，不要求云指标证据

截图：

- `diagnose_storage_pressure`

### 5.10 复制延迟诊断

调用：

1. `diagnose_replication_lag`

验收：

- 有复制链路时，应返回复制相关证据
- 单实例或无复制链路时，`not_applicable` 可接受

截图：

- `diagnose_replication_lag`

### 5.11 回收站恢复

只在支持时执行：

1. `list_recycle_bin`
2. `restore_recycle_bin_table`

验收：

- 第一次 restore 返回 `CONFIRMATION_REQUIRED`
- 第二次带 token 才真正执行

截图：

- 回收站列表
- 第一次 restore 返回 confirmation
- 第二次 restore 成功

---

## 6. 可接受跳过条件

出现下面情况时，不要硬测，直接在报告里记 `SKIP`：

- `is_taurusdb=false`
  - 跳过 TaurusDB 专属能力验证
- `list_taurus_features` 不暴露 `recycle_bin`
  - 跳过 recycle bin 恢复
- 无复制链路
  - `diagnose_replication_lag` 记 `not_applicable`
- 未配置或暂时关闭 `CES`
  - 云指标类 evidence 记 `SKIP`
- `performance_schema=OFF`
  - 依赖运行时 statement/waits 的深度诊断可能降级

---

## 7. 截图清单

建议至少收集下面这些图：

1. 实例控制台总览
2. 安全组配置
3. `cloud:validate`
4. `list_cloud_taurus_instances`
5. `select_cloud_taurus_instance`
6. `SELECT 1 AS ok`
7. `list_taurus_features`
8. `explain_sql_enhanced`
9. `find_top_slow_sql`
10. `diagnose_service_latency`
11. `show_processlist`
12. `diagnose_connection_spike`
13. `diagnose_lock_contention`
14. `diagnose_storage_pressure`
15. `diagnose_replication_lag`
16. `list_recycle_bin` / `restore_recycle_bin_table`

建议命名：

```text
test-assets/cloud-taurusdb/03-list-instances.png
test-assets/cloud-taurusdb/04-select-instance.png
test-assets/cloud-taurusdb/05-select-1.png
test-assets/cloud-taurusdb/06-features.png
test-assets/cloud-taurusdb/07-explain-enhanced.png
test-assets/cloud-taurusdb/08-find-top-slow-sql.png
test-assets/cloud-taurusdb/09-diagnose-service-latency.png
test-assets/cloud-taurusdb/10-show-processlist.png
test-assets/cloud-taurusdb/11-diagnose-connection-spike.png
test-assets/cloud-taurusdb/12-diagnose-lock-contention.png
test-assets/cloud-taurusdb/13-diagnose-storage-pressure.png
test-assets/cloud-taurusdb/14-diagnose-replication-lag.png
test-assets/cloud-taurusdb/15-recycle-bin.png
```

---

## 8. 最终测试报告模板

下面这份可以直接复制到最终报告。

### 8.1 基本信息

- 测试日期：
- 测试人：
- 实例名称：
- 实例 ID：
- region：
- project_id：
- datasource：
- 连接方式：
- 是否启用 CES：
- 是否启用 mutations：

### 8.2 测试环境结论

- `cloud:validate`：
- `is_taurusdb`：
- `performance_schema`：
- DAS：
- CES：

### 8.3 分项结果

| 模块                    | 结果 | 说明 |
| ----------------------- | ---- | ---- |
| 控制面连通              |      |      |
| 数据面连通              |      |      |
| 通用只读工具            |      |      |
| capability probe        |      |      |
| enhanced explain        |      |      |
| slow SQL diagnostics    |      |      |
| connection diagnostics  |      |      |
| lock diagnostics        |      |      |
| storage diagnostics     |      |      |
| replication diagnostics |      |      |
| recycle bin             |      |      |
| DAS evidence            |      |      |
| CES evidence            |      |      |

### 8.4 关键截图索引

- S1：
- S2：
- S3：
- S4：
- S5：

### 8.5 关键发现

- 发现 1：
- 发现 2：
- 发现 3：

### 8.6 已知限制

- 限制 1：
- 限制 2：
- 限制 3：

### 8.7 后续建议

- 建议 1：
- 建议 2：
- 建议 3：

---

## 9. 这次你当前环境的执行建议

结合你现在已经验证过的结果，建议按下面顺序继续：

1. 保持 `TAURUSDB_CLOUD_ENABLE_CES=false`
2. 保存当前 `cloud:validate` 成功截图
3. 做控制面和只读工具截图
4. 造慢 SQL 样本并跑 `find_top_slow_sql`
5. 造连接堆积和锁等待样本
6. 跑 `diagnose_connection_spike`、`diagnose_lock_contention`
7. 如果 feature 支持，再做 recycle bin 验证
8. 最后把 `CES` 问题作为单独“已知限制”写进报告

你可以把这份文档当成主 checklist，用 [opentaurus-case-template.md](./opentaurus-case-template.md) 组织最后的案例式总结。
