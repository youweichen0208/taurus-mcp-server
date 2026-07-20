# TaurusDB MCP 领导演示指南

本指南用于在 disposable TaurusDB 实例上演示 `taurusdb-mcp@0.5.0-rc.10`。
主线不是逐个展示 Tool，而是展示一个受治理的数据库诊断闭环：

> 客户遇到数据库问题 → MCP 绑定指定 TaurusDB → 用户在本机页面登录 → 自动收集证据并定位问题 → 给出 SQL/索引 Advice → 不越权执行普通写操作 → 全过程留审计记录。

一句话定位：

> `mysql -h` 或 SSH 提供数据库操作通道；TaurusDB MCP 提供带实例识别、安全边界、诊断编排、数据脱敏和审计能力的数据库 Harness。

## 为什么它是 Harness，而不只是数据库连接工具

Harness 是包在 Agent 与数据库之间的工程化运行边界。Agent 擅长理解自然语言、组织步骤
和解释结果，但不能仅靠 Prompt 保证每一次访问都选对实例、限制结果、隐藏凭据、阻止
越权写入并留下统一审计。TaurusDB MCP 把这些要求固化在 Tool、会话和执行器中。

| 客户任务 | 只有 SSH / `mysql -h` 或通用数据库 Tool | TaurusDB MCP Harness |
| --- | --- | --- |
| 找到目标实例 | 人工复制地址并自行确认环境 | 从云实例发现开始，绑定 region、instance、datasource 和 database |
| 登录 | 密码容易进入命令、历史记录或 Agent 上下文 | 本机 loopback 页面提交，Agent Tool 参数不接收账号密码 |
| 排查慢 SQL | DBA 手工拼接 Schema、EXPLAIN 和运行状态 | Agent 用自然语言触发标准证据链，并区分证据、推断和限制 |
| 生成变更建议 | SQL 文本与真实表结构可能脱节 | Advice 结合当前 Schema、执行计划和影响行数，始终标记未执行 |
| 控制风险 | 依赖操作者或 Agent 自觉 | 通用 DML/DDL 执行 Tool 不存在，大结果、超时和并发由代码限制 |
| 保护数据 | 每个脚本自行决定是否脱敏 | 返回结果统一经过字段脱敏和行数、字段、字节边界 |
| 追溯问题 | 命令散落在终端、聊天和个人记录中 | 每次 Tool 调用生成 task ID，并记录目标、决策、结果和耗时 |
| 复用经验 | 高度依赖资深 DBA 临场操作 | 把诊断步骤产品化，让一线人员获得稳定、可解释的排查路径 |

在 Agent 时代，它给客户带来的便利不是“让 AI 随意操作数据库”，而是：客户只需描述
症状或业务目标，Agent 负责调用标准化能力收集证据，Harness 负责守住凭据、目标、资源
和写入边界。这样既降低工具使用门槛，也减少分析错库、遗漏证据、结果过大和不可审计等
风险。它不会替代 DBA 对业务语义、变更窗口和最终处置的判断。

## 1. 演示前准备

- 只使用 disposable TaurusDB 实例，不要在生产实例构造故障数据。
- MCP 配置固定使用 `taurusdb-mcp@0.5.0-rc.10`，避免 `latest` 缓存造成版本不一致。
- 实例必须具有公网 IP，安全组入方向只放行演示电脑的公网出口 IP 和数据库端口。
- 当前 rc.10 默认不启用数据库 TLS；演示环境不需要配置 TLS。生产环境若启用 TLS，需另行配置 `TAURUSDB_REQUIRE_TLS=true`、可信 CA 和证书域名。
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

#### 如何证明凭据只进入 MCP 内存

现场不要通过进程转储、调试器、`strings` 或打印运行时对象来“查看内存中的密码”。这些
方法本身会复制或暴露秘密，不能作为安全演示。正确做法是展示一条可复核的非暴露证据链：

1. **入口证据**：账号密码只在 `http://127.0.0.1:...` 本机页面输入；Agent 对话中没有
   密码，`begin_sql_login` 的 Tool 输入也没有 username/password 字段。
2. **会话证据**：登录前后分别调用 `get_session_binding`。登录后只应看到
   `has_sql_credentials_override: true` 和脱敏后的 `username_masked`，永远没有 password。
3. **日志证据**：查看 Agent 调用记录、stderr 和 `audit.jsonl`。可以看到 task ID、Tool、
   datasource 和执行结果，但不应出现登录账号明文或密码字段。
4. **易失性证据**：调用 `clear_sql_credentials` 后再次执行只读查询，应要求重新登录；重启
   MCP 进程也会得到相同结果。这证明交互式凭据没有被 MCP 写入可恢复的持久配置。
5. **时限证据**：页面和配置显示空闲 30 分钟清除、登录后最长 8 小时；成功使用数据库
   Tool 只刷新空闲时间，不延长 8 小时绝对上限。
6. **源码证据**：`packages/mcp/src/tools/taurus/sql-login.ts` 把验证成功的凭据交给
   `RuntimeOverrideProfileLoader.setRuntimeTarget`；后者只保存在进程内的 `Map` 中。
   `SessionCredentialManager` 到期时调用 `clearRuntimeUser` 并重建连接引擎，路径中没有把
   交互式凭据写入 profile、审计文件或其他持久存储的操作。

建议现场 Prompt：

```text
请显示当前会话绑定，只说明是否存在内存凭据覆盖以及脱敏用户名；不要输出任何凭据。
```

可选的强证明应在彩排或录屏中完成，避免现场重启打断主线：登录并成功查询后重启 MCP，
再次查询会要求生成新的登录链接。需要准确表述为：

> 我们证明的是凭据入口不经过 Agent、输出接口不可读取密码、MCP 不持久化交互式凭据，
> 且进程重启或会话过期后凭据失效；不是把密码从内存中打印出来给大家看。

需要诚实说明边界：Node.js 字符串和数据库驱动连接位于进程内存中，清除会话会删除运行时
引用并关闭连接池，但 JavaScript 运行时不承诺立即对旧内存做密码学意义的覆写。因此生产
部署仍应禁止 core dump、限制本机调试权限，并用独立进程和操作系统账号隔离客户会话。

### 第二幕：诊断具有扩展风险的报表 SQL（4 分钟）

#### 先向领导解释业务目的

这条 SQL 对应一个常见的经营看板接口：统计最近 90 天已支付订单，按客户所在城市汇总
订单数和销售额，再返回销售额最高的 10 个城市。它同时包含时间范围过滤、状态过滤、
订单与客户关联、聚合和排序，适合作为数据库诊断 Harness 的演示用例。

建议话术：

> 这不是为了故意执行一条复杂 SQL，而是在模拟一个随着订单量增长逐渐变慢的经营报表。
> 我们先让 MCP 读取当前真实 Schema 和执行计划，再区分过滤、关联、聚合和排序分别带来
> 的成本，最后只生成索引 Advice，不直接改数据库。

#### 为什么它存在慢查询风险

- `orders` 当前只有主键和订单号唯一索引，没有覆盖 `status`、`created_at` 的过滤索引；
- 数据库可能需要扫描大量订单后，才能排除非 `PAID` 或超过 90 天的数据；
- 每个候选订单需要通过 `customer_id` 关联 `customers`。客户主键关联通常很快，主要
  风险仍在订单侧候选集过大；
- `GROUP BY c.city` 需要聚合中间结果；
- `ORDER BY SUM(o.amount) DESC` 通常需要额外排序，`LIMIT 10` 不能避免排序前的聚合；
- `orders` 含有较宽的 `payload_json`，大范围扫描在数据继续增长时会放大 I/O 成本；
- 5 万行在演示实例上可能仍能很快返回，因此应表述为“执行计划已暴露扩展风险”，不要
  把一次毫秒级结果宣称为已经发生严重性能故障。真实耗时还受缓存、并发、实例规格和
  数据分布影响。

#### 推荐的确定性 Prompt

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

逐步讲解每个 Tool 的意义：

| Tool | 现场回答的问题 |
| --- | --- |
| `get_session_binding` | 证据来自哪个实例、datasource 和 database，避免分析错库 |
| `describe_table` | 表有哪些列和现有索引，证明建议不是凭空生成 |
| `explain_sql_enhanced` | 优化器计划扫描多少行、是否命中索引、是否有临时结构或排序 |
| `diagnose_slow_query` | 将计划信号整理成根因候选、置信度、建议和明确限制 |

预期但不应硬编码的信号包括：订单表访问类型接近全表扫描、扫描行数接近表规模、索引
利用不足，以及 temporary/filesort 信号。TaurusDB 版本、统计信息和优化器选择不同，
具体字段可能变化；演示结论必须以现场 EXPLAIN 为准。

#### 可以完全用自然语言吗

可以。自然语言是 Agent 的意图入口，MCP Tools 负责真实证据和安全边界。纯自然语言
版本可输入：

```text
最近 90 天已支付订单按客户城市汇总的经营看板变慢了。请只使用只读能力：
先确认当前实例和数据库，检查订单与客户表结构，根据业务描述生成候选查询，
再用增强 EXPLAIN 和慢查询诊断判断过滤、关联、聚合和排序中哪一步最可能成为瓶颈。
请区分数据库证据、推断和未验证项，不要执行任何数据库变更。
```

Agent 可以根据 Schema 生成查询并调用诊断 Tool。但是领导现场建议使用上面的“业务描述
加明确 SQL”混合方式：纯自然语言生成的字段名、状态值和时间口径可能有差异，混合方式
既展示自然语言编排，又保证每次彩排使用同一条 SQL，便于比较前后执行计划。

#### 为什么建议这个联合索引

然后输入：

```text
请分析下面的索引变更是否与当前表结构和执行计划匹配，只生成 Advice，不要执行：

CREATE INDEX idx_orders_status_created_customer
ON orders(status, created_at, customer_id);
```

确认结果包含 `execution_status: not_executed` 和 `human_review_required: true`。

索引列顺序的解释：

1. `status` 是等值条件，放在前面用于定位 `PAID` 范围；
2. `created_at` 是时间范围条件，放在等值列之后缩小到最近 90 天；
3. `customer_id` 是后续关联列，可减少候选订单进入关联阶段的成本，并为查询提供更多
   索引内信息；
4. 这个索引主要优化订单侧过滤和关联，不保证消除按 `city` 聚合与按 `SUM(amount)` 排序；
5. `status` 只有少量取值，单列索引选择性较弱，因此不建议只创建 `status` 索引；
6. 是否把 `amount` 加入覆盖索引，需要结合写放大、索引体积和真实读频率评估，Demo
   不应直接给出更宽索引并宣称一定更优。

需要向领导明确：`analyze_mutation_sql` 对 `CREATE INDEX` 会核对目标表、当前 Schema 和
重复索引，并返回 copy-ready Advice；执行计划证据来自前一步增强 EXPLAIN/诊断，两者由
Agent 汇总成建议。MCP 不会自己提交 DDL。

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

## 5. 备用 Demo：锁等待与 Flashback Query

这两套用例适合在主线提前结束、领导追问“线上故障还能做什么”时展示。都必须提前彩排；
锁等待具有强实时性，Flashback 依赖实例版本、参数和历史保留窗口。

### 5.1 锁等待诊断

#### 业务故事

模拟“订单详情更新一直超时，但 CPU 和普通查询正常”。价值不在于 MCP 自动结束事务，
而在于它能把等待会话、阻塞会话、锁对象、事务年龄和建议处置步骤组织成证据链，同时
保持只读，不替客户执行 `KILL`、`COMMIT` 或 `ROLLBACK`。

#### 构造实时锁等待

使用两个外部数据库客户端连接 disposable 实例。会话 A 执行后保持窗口不要关闭：

```sql
USE taurus_mcp_demo;
SET SESSION innodb_lock_wait_timeout = 120;
START TRANSACTION;
SELECT id, status
FROM orders
WHERE id = 1
FOR UPDATE;
```

会话 B 执行相同语句，它应该停在等待状态：

```sql
USE taurus_mcp_demo;
SET SESSION innodb_lock_wait_timeout = 120;
START TRANSACTION;
SELECT id, status
FROM orders
WHERE id = 1
FOR UPDATE;
```

立即在 Agent 输入：

```text
订单详情操作正在等待。请针对 taurus_mcp_demo.orders 收集当前锁等待证据，
识别等待会话和阻塞会话、锁对象、锁模式、等待时长和阻塞事务年龄，
给出根因候选与安全处置建议。只诊断，不要结束会话或修改数据。
```

预期调用 `diagnose_lock_contention`，重点展示：

- waiting / blocking session ID；
- `orders` 表及可能的 `PRIMARY` 索引锁；
- 等待与阻塞锁类型、锁模式和事务年龄；
- 根因候选、严重度、证据与限制；
- 建议先定位事务所有者和业务请求，再由客户决定提交、回滚或终止会话；
- 默认不返回阻塞 SQL 原文，避免扩大敏感信息暴露。

如果结果为 `no_matching_evidence`，先确认会话 B 仍在等待，并检查诊断账号是否有读取
`performance_schema`、`information_schema.INNODB_TRX` 和 InnoDB 状态所需权限。实时
等待可能在采集前结束，因此这是点时证据，不应把空结果解释成“从未发生锁问题”。

清理顺序：先在会话 A 执行 `ROLLBACK;`，等待会话 B 返回后再在会话 B 执行
`ROLLBACK;`。不要直接关闭两个终端而不确认事务已经释放。

### 5.2 Flashback Query 历史只读查询

#### 前提检查

先让 Agent 调用 `list_taurus_features`，确认：

- 当前内核支持 Flashback Query；
- `innodb_rds_backquery_enable=ON`；
- 演示时间点位于实例允许的 backquery window 内。

#### 构造当前值与历史值

在外部数据库客户端执行，记录返回的 `flashback_point`：

```sql
USE taurus_mcp_demo;

DROP TABLE IF EXISTS flashback_demo;
CREATE TABLE flashback_demo (
  id BIGINT PRIMARY KEY,
  order_status VARCHAR(20) NOT NULL,
  note VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

INSERT INTO flashback_demo VALUES (1, 'PENDING', 'before accidental change');
SELECT NOW(6) AS flashback_point;
SELECT SLEEP(2);
UPDATE flashback_demo
SET order_status = 'EXPIRED', note = 'current value'
WHERE id = 1;
```

先让 MCP 查询当前值，再输入：

```text
刚才 flashback_demo 中 id=1 的状态被改动了。请使用只读 Flashback Query 查询
<flashback_point> 时刻的 id、order_status 和 note，并与当前值对比。
不要执行恢复或任何数据库变更。
```

预期 `flashback_query` 使用精确时间点、`where: id = 1`、显式列和小 `limit`，展示：

- 当前值为 `EXPIRED / current value`；
- 历史值为 `PENDING / before accidental change`；
- 历史查询仍走普通只读结果限制和脱敏路径；
- Tool 只提供历史证据，不会把历史值自动写回当前表。

自然语言也可以表达“查询 5 分钟前”，Tool 会基于数据库当前时间解析相对时间。但现场
推荐使用刚才记录的精确数据库时间，避免本机与数据库时钟差异，也避免相对时间落在建表
之前。如果历史版本已经被清理，MCP 会返回请求时间、数据库当前时间、保留窗口和建议
时间点等诊断；这不是连接失败。Flashback Query 不是备份，也不保证窗口之外的数据可见。

演示结束后在外部客户端清理：

```sql
DROP TABLE IF EXISTS taurus_mcp_demo.flashback_demo;
```

## 6. 可选压轴：受控回收站恢复

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
请把该回收站对象恢复为 taurus_mcp_demo.recovery_demo_restored。
```

MCP 会核对精确对象和目标冲突，预检通过后直接恢复。确认：

- `execution_status = executed`；
- `verified = true`；
- 目标表存在且包含测试记录；
- 审计日志记录请求目标和执行结果；
- 仍然不存在任意 SQL 写入 Tool。

## 7. 现场验收表

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
| 锁等待诊断 | 识别等待者、阻塞者和锁对象，但不自动结束客户事务 |
| 历史查询 | Flashback 返回指定时刻的只读证据，不自动回写当前数据 |
| 受控恢复 | 仅精确回收站对象可直接恢复；目标冲突时阻断并在恢复后验证 |

## 8. 失败兜底与清理

- 彩排所有 Prompt，并保存关键输出截图。
- 准备 2 分钟录屏，避免现场公网、安全组或云 API 波动中断主线。
- 回收站恢复未完整彩排时，只讲机制，不现场执行。
- 锁等待 Demo 结束后确认两个外部事务都已回滚；Flashback 不可用时展示结构化能力或
  保留窗口提示，不要临时修改生产参数。
- 如需完全重置演示环境，在外部数据库客户端执行：

```sql
DROP DATABASE IF EXISTS taurus_mcp_demo;
```

最值得展示的主线是：安全登录 → 慢 SQL 根因诊断 → UPDATE Advice 但不执行 → 危险 SQL 阻断 → 脱敏与审计。回收站恢复作为已彩排的加分项。
