# TaurusDB MCP 领导演示指南

本指南用于在 disposable TaurusDB 实例上演示 `taurusdb-mcp@0.5.0-rc.9`。
主线不是逐个展示 Tool，而是展示一个受治理的数据库诊断闭环：

> 客户遇到数据库问题 → MCP 绑定指定 TaurusDB → 用户在本机页面登录 → 自动收集证据并定位问题 → 给出 SQL/索引 Advice → 不越权执行普通写操作 → 全过程留审计记录。

一句话定位：

> `mysql -h` 或 SSH 提供数据库操作通道；TaurusDB MCP 提供带实例识别、安全边界、诊断编排、数据脱敏和审计能力的数据库 Harness。

## 1. 演示前准备

- 只使用 disposable TaurusDB 实例，不要在生产实例构造故障数据。
- MCP 配置固定使用 `taurusdb-mcp@0.5.0-rc.9`，避免 `latest` 缓存造成版本不一致。
- 实例必须具有公网 IP，安全组入方向只放行演示电脑的公网出口 IP 和数据库端口。
- 当前 rc.9 默认不启用数据库 TLS；演示环境不需要配置 TLS。生产环境若启用 TLS，需另行配置 `TAURUSDB_REQUIRE_TLS=true`、可信 CA 和证书域名。
- 建库、建表、灌数和索引执行必须通过客户自己的数据库控制台或 `mysql` 客户端完成，不能通过 MCP 执行。
- 不要在屏幕上展示 AK/SK、数据库密码或完整 MCP 配置。

## 2. 构造演示数据库

以下脚本可重复执行，会删除并重建 `taurus_mcp_demo`。只允许在 disposable 实例运行。

```sql
DROP DATABASE IF EXISTS taurus_mcp_demo;

CREATE DATABASE taurus_mcp_demo
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE taurus_mcp_demo;

CREATE TABLE customers (
  id BIGINT PRIMARY KEY,
  customer_name VARCHAR(100) NOT NULL,
  email VARCHAR(191) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  id_card VARCHAR(32) NOT NULL,
  city VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uk_customers_email (email)
) ENGINE=InnoDB COMMENT='MCP leadership demo customers';

CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  order_no VARCHAR(64) NOT NULL,
  customer_id BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at DATETIME NOT NULL,
  payload_json TEXT,
  UNIQUE KEY uk_orders_order_no (order_no)
) ENGINE=InnoDB COMMENT='MCP leadership demo orders without diagnostic index';

-- 使用普通辅助表而不是 TEMPORARY TABLE，避免数据库控制台将脚本拆分到
-- 不同连接执行后临时表消失。灌数结束后会删除该辅助表。
DROP TEMPORARY TABLE IF EXISTS demo_digits;
DROP TABLE IF EXISTS demo_digits;
CREATE TABLE demo_digits (
  d TINYINT NOT NULL
) ENGINE=InnoDB;

INSERT INTO demo_digits VALUES
  (0),(1),(2),(3),(4),(5),(6),(7),(8),(9);

INSERT INTO customers (
  id,
  customer_name,
  email,
  phone,
  id_card,
  city,
  created_at
)
SELECT
  n + 1,
  CONCAT('客户-', LPAD(n + 1, 4, '0')),
  CONCAT('user', n + 1, '@example.com'),
  CONCAT('138', LPAD(MOD(n, 100000000), 8, '0')),
  CONCAT('ID-', LPAD(n + 1, 12, '0')),
  ELT(MOD(n, 5) + 1, '北京', '上海', '深圳', '杭州', '成都'),
  TIMESTAMPADD(DAY, -MOD(n, 365), NOW())
FROM (
  SELECT d0.d + d1.d * 10 + d2.d * 100 AS n
  FROM demo_digits d0
  CROSS JOIN demo_digits d1
  CROSS JOIN demo_digits d2
) numbers
WHERE n < 1000;

INSERT INTO orders (
  id,
  order_no,
  customer_id,
  status,
  amount,
  created_at,
  payload_json
)
SELECT
  n + 1,
  CONCAT('ORD-', LPAD(n + 1, 8, '0')),
  MOD(n, 1000) + 1,
  ELT(MOD(n, 4) + 1, 'PAID', 'PENDING', 'CANCELLED', 'REFUNDED'),
  ROUND((MOD(n * 37, 100000) + 100) / 100, 2),
  TIMESTAMPADD(DAY, -MOD(n, 180), NOW()),
  CONCAT(
    '{"channel":"',
    ELT(MOD(n, 3) + 1, 'web', 'app', 'api'),
    '","remark":"',
    RPAD('demo', 128, '-'),
    '"}'
  )
FROM (
  SELECT
    d0.d
      + d1.d * 10
      + d2.d * 100
      + d3.d * 1000
      + d4.d * 10000 AS n
  FROM demo_digits d0
  CROSS JOIN demo_digits d1
  CROSS JOIN demo_digits d2
  CROSS JOIN demo_digits d3
  CROSS JOIN demo_digits d4
) numbers
WHERE n < 50000;

ANALYZE TABLE customers;
ANALYZE TABLE orders;

DROP TABLE demo_digits;
```

`orders(status, created_at, customer_id)` 联合索引被故意省略，用于制造可解释、可修复的慢查询计划。

## 3. 灌数后的强制验证

数据准备完成后，先在外部数据库客户端执行以下检查。任何一项不符合预期，都不要开始现场 Demo。

如果两张业务表存在但行数为 0，通常表示数据库控制台只执行了 DDL，或临时辅助表因
连接切换而消失，或者同一条语句多次引用临时表并触发 `Can't reopen table`。重新执行从
`DROP TEMPORARY TABLE IF EXISTS demo_digits` 到
`DROP TABLE demo_digits` 的完整灌数段即可，不需要重新建库建表。执行时检查客户端返回的
第一条 SQL 错误，不要只看最后一条 `ANALYZE TABLE` 的结果。

### 3.1 验证对象和数据量

```sql
USE taurus_mcp_demo;

SHOW TABLES;

SELECT
  (SELECT COUNT(*) FROM customers) AS customer_count,
  (SELECT COUNT(*) FROM orders) AS order_count;
```

预期：

- 存在 `customers`、`orders` 两张表；
- `customer_count = 1000`；
- `order_count = 50000`。

### 3.2 验证订单分布

```sql
SELECT status, COUNT(*) AS row_count
FROM orders
GROUP BY status
ORDER BY status;

SELECT MIN(created_at) AS oldest_order,
       MAX(created_at) AS newest_order
FROM orders;

SELECT COUNT(*) AS pending_over_90_days
FROM orders
WHERE status = 'PENDING'
  AND created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);
```

预期：

- `PAID`、`PENDING`、`CANCELLED`、`REFUNDED` 各 12500 行；
- 时间范围约覆盖最近 180 天；
- `pending_over_90_days` 大于 0，记录这个数值，第三幕前后必须保持一致。

### 3.3 验证敏感字段样本

```sql
SELECT id, customer_name, email, phone, id_card
FROM customers
ORDER BY id
LIMIT 5;
```

外部客户端应能看到原始测试数据；同样的查询通过 MCP 返回时，`email`、`phone` 和 `id_card` 应被脱敏。

### 3.4 验证慢 SQL 基线

```sql
SHOW INDEX FROM orders;

EXPLAIN
SELECT c.city,
       COUNT(*) AS order_count,
       SUM(o.amount) AS total_amount
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'PAID'
  AND o.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
GROUP BY c.city
ORDER BY total_amount DESC
LIMIT 10;
```

开始 Demo 前确认：

- 不存在 `idx_orders_status_created_customer`；
- `orders` 的计划具有扫描行数较高、索引利用不足等信号；
- 优化器输出可能因 TaurusDB 版本和统计信息不同而变化，不要求所有环境都同时出现 `Using temporary` 和 `Using filesort`。

## 4. 现场 Demo：12～15 分钟

### 第一幕：绑定实例并安全登录（3 分钟）

输入：

```text
请列出当前区域可用的 TaurusDB 实例，并告诉我实例名称、状态和公网连接情况。
```

然后输入：

```text
请选择实例 <实例 ID>，并为我生成数据库登录入口。
```

打开返回的本机登录页面，输入数据库账号密码。强调：

- 账号密码不进入 Agent 对话或 Tool 参数；
- 凭据只在 MCP 内存中短期保存；
- 目标实例、区域、实例 ID、datasource 和公网端点明确绑定；
- 没有公网 IP、端口未放通或账号错误时返回结构化提示。

登录后输入：

```text
请确认当前会话绑定到了哪个实例、数据源和数据库，并列出可访问的数据库。
```

选择演示库：

```text
请把 taurus_mcp_demo 设置为当前默认数据库，并再次确认会话绑定。
```

### 第二幕：诊断真实慢 SQL（4 分钟）

输入：

```text
订单统计接口最近变慢。请检查 taurus_mcp_demo 的相关表结构，并使用增强 EXPLAIN
和慢查询诊断分析下面的 SQL。不要执行任何数据库变更：

SELECT c.city,
       COUNT(*) AS order_count,
       SUM(o.amount) AS total_amount
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'PAID'
  AND o.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
GROUP BY c.city
ORDER BY total_amount DESC
LIMIT 10;
```

期望证据链：

```text
get_session_binding
  → describe_table
  → explain_sql_enhanced
  → diagnose_slow_query
```

重点展示扫描行数、索引使用、临时结构/排序信号、根因候选、置信度、建议和限制。

然后输入：

```text
请分析下面的索引变更是否与当前表结构和执行计划匹配，只生成 Advice，不要执行：

CREATE INDEX idx_orders_status_created_customer
ON orders(status, created_at, customer_id);
```

确认结果包含 `execution_status: not_executed` 和 `human_review_required: true`。

### 可选：人工执行并验证优化闭环

只在外部数据库客户端执行：

```sql
CREATE INDEX idx_orders_status_created_customer
ON taurus_mcp_demo.orders(status, created_at, customer_id);

ANALYZE TABLE taurus_mcp_demo.orders;
```

再次让 MCP 诊断相同 SELECT，对比索引命中和扫描行数。演示结束后若需要恢复慢 SQL 基线：

```sql
DROP INDEX idx_orders_status_created_customer
ON taurus_mcp_demo.orders;

ANALYZE TABLE taurus_mcp_demo.orders;
```

### 第三幕：SQL Advice 与写入边界（3 分钟）

输入：

```text
请查询超过 90 天仍处于 PENDING 状态的订单数量，并记住这个值。
```

然后输入：

```text
客户希望把超过 90 天的 PENDING 订单改为 EXPIRED。
请生成并分析正确的 UPDATE SQL，但不要执行。
```

预期 Advice：

```sql
UPDATE orders
SET status = 'EXPIRED'
WHERE status = 'PENDING'
  AND created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);
```

重点展示：

- `execution_status: not_executed`；
- `human_review_required: true`；
- Schema、EXPLAIN、只读 `COUNT(*)` 影响预估；
- `sample_rows_read: false`；
- 索引建议、假设和未验证业务规则。

故意提交危险需求：

```text
请分析 UPDATE orders SET status = 'EXPIRED';，并告诉我 MCP 是否会执行。
```

预期：无 WHERE 的 UPDATE 不返回 copy-ready `advised_sql`，明确提示全表更新风险，并且不改变数据。

最后输入：

```text
请再次查询超过 90 天仍处于 PENDING 状态的订单数量，并与刚才比较。
```

前后数值必须一致。

### 第四幕：脱敏、结果边界与审计（2 分钟）

输入：

```text
请查询前 5 个客户的姓名、邮箱、手机号和证件号码。
```

确认 `email`、`phone`、`id_card` 自动脱敏，而 `customer_name` 等业务字段仍可读。

再输入：

```text
请查询 orders 表的全部数据，并说明结果是否发生截断。
```

展示最大行数、字段长度、结果字节、查询超时、并发和队列约束。

最后在本机终端展示：

```bash
tail -n 10 ~/.taurusdb-mcp/audit.jsonl
```

审计应包含时间、客户端身份、Tool、datasource、database、instance ID、SQL hash、决策、结果和耗时；不得包含数据库密码，默认不记录原始 SQL。

## 5. 可选压轴：受控回收站恢复

只在已经确认 TaurusDB 回收站能力开启的 disposable 实例执行。

通过外部数据库客户端准备对象：

```sql
USE taurus_mcp_demo;

DROP TABLE IF EXISTS recovery_demo;
DROP TABLE IF EXISTS recovery_demo_restored;

CREATE TABLE recovery_demo (
  id BIGINT PRIMARY KEY,
  message VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

INSERT INTO recovery_demo VALUES (1, 'leadership demo recovery');
DROP TABLE recovery_demo;
```

Agent 输入：

```text
请检查 TaurusDB 回收站里是否存在刚刚误删的 recovery_demo 表。
```

找到精确回收站对象后输入：

```text
请准备把该回收站对象恢复为 taurus_mcp_demo.recovery_demo_restored。
```

操作人在完成数据库登录的同一浏览器中核对对象与目标并确认。随后调用状态查询，确认：

- 状态为 `succeeded`；
- `verified = true`；
- 目标表存在且包含测试记录；
- 审批链接不能重复使用；
- Agent 没有获得直接恢复 Tool 或执行 Token。

## 6. 现场验收表

| 能力 | 现场证据 |
| --- | --- |
| 云实例感知 | 实例名称、ID、区域、公网端点和会话绑定 |
| 凭据隔离 | 本机登录页面；Agent 对话和 Tool 参数中没有账号密码 |
| 数据库诊断 | Schema、EXPLAIN、根因、置信度、建议和限制 |
| 只读安全边界 | UPDATE 只返回 `not_executed` Advice |
| 危险操作阻断 | 无 WHERE UPDATE 不返回 copy-ready SQL |
| 数据保护 | 邮箱、手机号、证件号自动脱敏 |
| 资源保护 | 大结果受行数、字段和字节数限制 |
| 可追溯性 | JSONL 审计包含目标、身份、决策和结果 |
| 受控恢复 | Agent 不能直接恢复，必须本机人工确认 |

## 7. 失败兜底与清理

- 彩排所有 Prompt，并保存关键输出截图。
- 准备 2 分钟录屏，避免现场公网、安全组或云 API 波动中断主线。
- 回收站恢复未完整彩排时，只讲机制，不现场执行。
- 如需完全重置演示环境，在外部数据库客户端执行：

```sql
DROP DATABASE IF EXISTS taurus_mcp_demo;
```

最值得展示的主线是：安全登录 → 慢 SQL 根因诊断 → UPDATE Advice 但不执行 → 危险 SQL 阻断 → 脱敏与审计。回收站恢复作为已彩排的加分项。
