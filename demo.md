# TaurusDB MCP Demo Runbook

这份文档用于明天的现场演示，目标是用最短路径展示 TaurusDB MCP 的 4 个核心价值：

- 会话式接入，不改静态配置文件
- 数据库结构探索
- 只读 SQL 与 Explain 分析
- TaurusDB 专属能力：Recycle Bin 受控恢复

---

## 1. 演示前准备

建议今晚先确认下面几项。

### 1.1 MCP 版本

确认线上最新版本：

```bash
npm view taurusdb-mcp version
```

当前预期：

```text
0.2.0
```

如果 agent 配置里写的是固定版本，建议显式使用：

```bash
npx -y taurusdb-mcp@0.2.0
```

### 1.2 基础连通性

需要保证：

- 云上实例能正常列出
- 数据库网络已打通
- 演示账号密码可登录
- 演示数据库已准备好业务表，例如 `orders`

### 1.3 Recycle Bin 演示对象

建议提前准备一张专用测试表，并确保它已经进入回收站。

示例：

```sql
CREATE TABLE demo_restore_me (
  id BIGINT PRIMARY KEY,
  name VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO demo_restore_me (id, name) VALUES (1, 'demo');

DROP TABLE demo_restore_me;
```

### 1.4 TaurusDB 特性确认

建议提前至少试一遍：

- `list_taurus_features`
- `list_recycle_bin`

确保 recycle bin 功能可用。

### 1.5 Taurus 专属能力前置参数清单

如果你明天要演示 TaurusDB 专属能力，建议提前确认下面这些条件。

#### Recycle Bin

对应 tools：

- `list_recycle_bin`
- `restore_recycle_bin_table`

前置条件：

- 实例必须是 TaurusDB
- 内核版本至少 `2.0.57.240900`
- 系统参数开启：
  - `rds_recycle_bin_mode=ON`

#### Flashback Query

对应 tool：

- `flashback_query`

前置条件：

- 实例必须是 TaurusDB
- 内核版本至少 `2.0.69.250900`
- 系统参数开启：
  - `innodb_rds_backquery_enable=ON`

#### Parallel Query

主要影响：

- `explain_sql_enhanced`
- `list_taurus_features`

推荐条件：

- `force_parallel_execute=ON`

#### NDP Pushdown

主要影响：

- `explain_sql_enhanced`
- `list_taurus_features`

常见参数名可能是以下之一：

- `ndp_mode`
- `rds_ndp_mode`
- `taurus_ndp_mode`
- `ndp_pushdown_mode`
- `ndp_pushdown`

推荐目标值：

- `ON`
- 或 `REPLICA_ON`

#### Offset Pushdown

主要影响：

- `explain_sql_enhanced`
- `list_taurus_features`

推荐条件：

- `optimizer_switch` 中包含 `offset_pushdown=on`

### 1.6 最稳的能力检查方式

演示前不要靠记忆去判断参数是否开启，直接让 agent 调：

- `get_kernel_info`
- `list_taurus_features`

如果 feature 返回中显示：

- `available=true`
- `enabled=true`

那说明这项能力已经具备演示条件。

推荐自然语言检查模板：

```text
请先检查当前实例的 TaurusDB capability，重点告诉我以下能力是否可用以及是否已启用：
1. flashback_query
2. recycle_bin
3. parallel_query
4. ndp_pushdown
5. offset_pushdown

如果某项能力未启用，请把对应的内核参数提示也一起返回。
```

---

## 2. 演示总顺序

推荐按下面 5 段演示：

1. 会话式接入
2. 数据结构探索
3. 只读 SQL 查询
4. Explain 分析
5. Recycle Bin 压轴演示

如果时间只有 10 分钟，压缩成这 4 段即可：

1. `select_cloud_taurus_instance`
2. `set_sql_credentials` + `set_default_database` + `get_session_binding`
3. `describe_table` + `execute_readonly_sql` + `explain_sql`
4. `list_recycle_bin` + `restore_recycle_bin_table`

---

## 3. 如何构造演示场景

这一节用于回答“明天演示的数据和 SQL 该怎么提前准备”。

## 3.1 结构探索场景

目标：让 `describe_table` 看起来有业务语义，而不是空表或测试表。

建议准备一张有代表性的业务表，例如：

- `orders`
- `users`
- `payments`

这张表最好满足：

- 字段不少于 5 个
- 至少有一个主键
- 至少有一个二级索引
- 至少有一个时间列，例如 `created_at`
- 至少有一个状态列，例如 `status`

这样演示 `describe_table` 时，结果会更完整，能看到字段、索引和时间列提示。

## 3.2 只读查询场景

目标：让 `execute_readonly_sql` 能稳定返回几条“看起来真实”的结果。

推荐准备：

- 最近 5 到 20 条订单数据
- `status` 字段中至少有 2 到 3 种值，例如：
  - `paid`
  - `pending`
  - `cancelled`

推荐演示 SQL：

```sql
SELECT id, status, created_at
FROM orders
ORDER BY created_at DESC
LIMIT 5;
```

为什么选这条：

- 足够简单，现场不容易出错
- 返回结果直观
- 能自然引出 explain 场景

如果你担心现场数据不够新，可以提前插入几条最近时间的数据。

## 3.3 Explain 场景

目标：让 `explain_sql` 看起来像一个真实的分析动作，而不是无意义 explain。

推荐准备：

- `orders.status` 上可以有索引，也可以没有索引
- `orders.created_at` 最好存在

推荐演示 SQL：

```sql
SELECT id, status
FROM orders
WHERE status = 'paid'
ORDER BY created_at DESC
LIMIT 20;
```

为什么选这条：

- 业务语义强，容易讲
- 有过滤、有排序、有 limit
- explain 输出通常比 `SELECT *` 更有内容

如果你想让 explain 更容易“有可讲内容”，可以故意选择一个：

- 过滤列不够理想
- 排序列和过滤列组合不够理想

但不要把 SQL 造得太复杂，现场越复杂越容易失控。

## 3.4 Recycle Bin 场景

目标：让 `list_recycle_bin` 和 `restore_recycle_bin_table` 能一气呵成。

这是最需要提前准备的场景。

### 推荐表名

建议使用一个非常明确的演示表名：

- `demo_restore_me`

不要使用业务真实表名，避免现场紧张或误解。

### 推荐建表 SQL

```sql
CREATE TABLE demo_restore_me (
  id BIGINT PRIMARY KEY,
  name VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 推荐插入 SQL

```sql
INSERT INTO demo_restore_me (id, name) VALUES
  (1, 'demo-row-1'),
  (2, 'demo-row-2');
```

### 让它进入 Recycle Bin

```sql
DROP TABLE demo_restore_me;
```

### 为什么这样构造

- 表结构简单，恢复后容易验证
- 数据行数少，恢复后查询结果一眼能看懂
- 表名本身就像演示对象，现场不需要额外解释

### 现场完整演法

先调用：

- `list_recycle_bin`

确认回收站中能看到 `demo_restore_me`。

然后第一次调用：

- `restore_recycle_bin_table`

预期返回：

- `confirmation_token`

第二次再带 token 调一次，正式恢复。

恢复完成后，再补一条：

```sql
SELECT * FROM demo_restore_me ORDER BY id;
```

这样你可以把“删除前有数据 -> 回收站可见 -> 确认恢复 -> 恢复后数据还在”这条故事讲完整。

## 3.5 如果 recycle bin 现场失败，如何兜底

如果明天现场出现下面任一情况：

- 回收站参数没开
- 实例当前不支持 recycle bin
- 回收站里没有目标表

兜底策略是：

1. 先调 `list_taurus_features`
2. 展示 feature 状态或 parameter hint
3. 把压轴改成：
   - `get_kernel_info`
   - `list_taurus_features`
   - `explain_sql_enhanced`

这样即使 recycle bin 现场不能恢复，也不会整段垮掉。

---

## 4. Demo 详细步骤

### 4.1 会话式接入

目标：证明不需要预先写死 host、database、user。

### Step 1: 列出实例

Tool：

- `list_cloud_taurus_instances`

自然语言触发：

- “列出我当前 region 下的 TaurusDB 实例。”
- “帮我看看当前账号在这个 region 下有哪些 TaurusDB 实例。”

讲解词：

- “我先不改本地配置，直接在会话里看云上实例列表。”

### Step 2: 选择实例

Tool：

- `select_cloud_taurus_instance`

典型入参：

```json
{
  "instance_id": "c7f6c1d8-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

自然语言触发：

- “选择这个 TaurusDB 实例作为当前会话目标实例。”
- “帮我切到实例 `c7f6c1d8-xxxx-xxxx-xxxx-xxxxxxxxxxxx`。”

讲解词：

- “实例选中后，host 和 port 会按会话绑定进去。”

### Step 3: 输入数据库账号密码

Tool：

- `set_sql_credentials`

典型入参：

```json
{
  "username": "demo_app",
  "password": "******"
}
```

自然语言触发：

- “用这个数据库账号登录当前实例。”
- “把当前会话的数据库账号切换成 `demo_app`。”

讲解词：

- “账号密码不需要预先写死在环境变量里，只影响当前 session，不落盘。”

### Step 4: 选择默认数据库

Tool：

- `list_databases`
- `set_default_database`

典型入参：

```json
{
  "database": "orders"
}
```

自然语言触发：

- “列出当前实例里的数据库，然后把默认库切到 `orders`。”
- “选择 `orders` 作为当前会话默认数据库。”

讲解词：

- “选完实例和账号以后，再选默认库，后面就不用每次重复写 database。”

### Step 5: 显示当前会话绑定

Tool：

- `get_session_binding`

典型入参：

```json
{}
```

自然语言触发：

- “展示当前会话绑定状态。”
- “告诉我现在连的是哪个实例、哪个库、哪个账号。”

讲解词：

- “这一步是为了让当前上下文可见，避免用户不知道自己到底连到了哪里。”

---

### 4.2 数据结构探索

目标：证明 agent 能快速理解 schema。

### Step 1: 列出表

Tool：

- `list_tables`

自然语言触发：

- “列出当前默认库里的表。”
- “帮我看看这个库里有哪些核心业务表。”

### Step 2: 描述表结构

Tool：

- `describe_table`

典型入参：

```json
{
  "table": "orders"
}
```

自然语言触发：

- “帮我看一下 `orders` 表结构。”
- “描述一下 `orders` 的字段和索引。”

讲解词：

- “这里不需要额外给 schema 文档，MCP 可以直接从数据库里拿表结构和索引信息。”

---

### 4.3 只读 SQL 查询

目标：证明它不只是能连上数据库，还能安全做只读查询。

Tool：

- `execute_readonly_sql`

典型入参：

```json
{
  "sql": "SELECT id, status, created_at FROM orders ORDER BY created_at DESC LIMIT 5;"
}
```

自然语言触发：

- “查询最近 5 条订单记录。”
- “帮我看一下最近创建的 5 条订单，返回 id、状态和创建时间。”

讲解词：

- “这里走的是只读入口，和写操作入口是分开的。”
- “即使底层账号有写权限，这个入口也只允许只读 SQL。”

---

### 4.4 Explain 分析

目标：证明它不只是能查，还能做 SQL 分析。

### Step 1: 普通 Explain

Tool：

- `explain_sql`

典型入参：

```json
{
  "sql": "SELECT id, status FROM orders WHERE status = 'paid' ORDER BY created_at DESC LIMIT 20;"
}
```

自然语言触发：

- “帮我分析这条 SQL 的执行计划。”
- “Explain 一下这条按状态过滤并按时间倒序的查询。”

讲解词：

- “它不只是能执行查询，还能做 explain 分析。”
- “适合给开发和 DBA 做第一轮 SQL 体检。”

### Step 2: 可选的 Taurus 能力说明

如果现场时间允许，可以补两步：

- `get_kernel_info`
- `list_taurus_features`

自然语言触发：

- “告诉我当前实例是不是 TaurusDB，以及支持哪些 Taurus 能力。”

如果你想继续强化 Taurus 差异化，也可以补：

- `explain_sql_enhanced`

---

### 4.5 Recycle Bin 压轴演示

目标：展示 TaurusDB 专属能力和受控恢复。

建议把这段放在最后。

### Step 1: 查看回收站

Tool：

- `list_recycle_bin`

典型入参：

```json
{}
```

自然语言触发：

- “列出当前实例回收站里的对象。”
- “帮我看看 recycle bin 里有没有 `demo_restore_me`。”

讲解词：

- “这是 TaurusDB 专属能力之一，不是普通 MySQL 通用能力。”

### Step 2: 第一次恢复请求

Tool：

- `restore_recycle_bin_table`

典型入参：

```json
{
  "table_name": "demo_restore_me",
  "restore_mode": "native_restore"
}
```

自然语言触发：

- “帮我恢复回收站里的 `demo_restore_me` 表。”
- “尝试恢复这张演示表。”

预期效果：

- 不会直接恢复
- 返回 `confirmation_token`

讲解词：

- “恢复不是直接执行，而是先进入 confirmation 流。”

### Step 3: 确认恢复

Tool：

- `restore_recycle_bin_table`

典型入参：

```json
{
  "table_name": "demo_restore_me",
  "restore_mode": "native_restore",
  "confirmation_token": "上一步返回的token"
}
```

自然语言触发：

- “使用刚才返回的 confirmation token 确认恢复。”
- “继续执行回收站恢复。”

预期效果：

- 正式恢复成功

讲解词：

- “这说明写操作和恢复操作都带有明确的安全边界。”

### Step 4: 恢复后确认

建议补一条：

- `list_tables`
  或
- `execute_readonly_sql`

例如：

```json
{
  "sql": "SELECT * FROM demo_restore_me LIMIT 5;"
}
```

自然语言触发：

- “确认这张表已经恢复。”
- “查一下恢复后的 `demo_restore_me` 表数据。”

---

## 5. 逐句台词速查版

下面这版是明天现场可以直接照着说的最短讲稿。

### 5.1 开场

- “今天演示的重点不是单纯连数据库，而是展示一个面向 TaurusDB 的会话式 MCP。”
- “我会用四段来演示：接入、结构探索、只读查询与分析、以及 TaurusDB 专属恢复能力。”

### 5.2 选实例

- “第一步我先不改本地配置，直接在会话里列出云上 TaurusDB 实例。”
- “然后我选中这台实例，当前会话的 host 和 port 就会自动绑定过去。”

### 5.3 输账号、选库、看绑定

- “接下来我在当前会话里输入数据库账号密码，这一步不会改磁盘配置。”
- “然后我把默认数据库切到 `orders`。”
- “最后我用 `get_session_binding` 明确展示当前到底连到了哪个实例、哪个库、哪个账号。”

### 5.4 看表结构

- “这里我直接查看 `orders` 表结构，不需要额外准备 schema 文档。”
- “MCP 会直接从数据库里拿字段、索引和结构信息。”

### 5.5 跑只读查询

- “下一步做一个只读查询，看最近几条订单记录。”
- “这里走的是专门的只读入口，和写操作入口是分开的。”

### 5.6 Explain 分析

- “然后我对一条典型查询做 explain 分析。”
- “这说明它不只是能执行 SQL，还能帮助理解 SQL 风险和执行计划。”

### 5.7 Recycle Bin 压轴

- “最后演示一个 TaurusDB 专属能力：Recycle Bin 恢复。”
- “我先看回收站里有没有刚才准备好的演示表。”
- “第一次恢复请求不会直接执行，而是返回 confirmation token。”
- “确认之后，再正式执行恢复。”
- “最后我再查一次表，确认数据已经恢复回来。”

### 5.8 如果现场异常

- “如果回收站当前不可用，我会立刻切到 capability 展示和 enhanced explain，这样仍然可以把 TaurusDB 差异化能力讲清楚。”

---

## 6. 明天建议台词

如果你要讲得很利落，可以用下面这版。

### 开场

- “今天演示的重点不是单纯连数据库，而是展示一个面向 TaurusDB 的会话式 MCP。”

### 会话绑定阶段

- “我先选云上实例，不需要回头改配置文件。”
- “然后在当前会话里输入数据库账号，再选默认库。”
- “最后用 `get_session_binding` 明确展示当前到底连到了哪个实例、哪个库、哪个账号。”

### 结构探索阶段

- “接下来直接从数据面拿表结构和索引，不需要额外准备 schema 文档。”

### 查询和分析阶段

- “这里先做只读查询，再做 explain 分析，证明它不只是能执行 SQL，还能帮助理解 SQL 风险和计划。”

### Taurus 专属压轴阶段

- “最后演示一个 TaurusDB 专属能力：Recycle Bin 恢复。”
- “第一次不会直接恢复，而是返回 confirmation token；第二次确认后才真正执行。”

---

## 7. 现场最容易翻车的点

明天重点提前确认这几项：

- `list_cloud_taurus_instances` 能正常返回
- `set_sql_credentials` 的账号确实能登录
- `set_default_database` 选的库存在
- `list_recycle_bin` 中确实能看到 `demo_restore_me`
- recycle bin 所需参数已经开启
- 演示表名提前确认，不要现场临时猜字段名或对象名

---

## 8. 最短演示版

如果时间只有 10 分钟，按下面顺序即可：

1. `select_cloud_taurus_instance`
2. `set_sql_credentials`
3. `set_default_database`
4. `get_session_binding`
5. `describe_table`
6. `execute_readonly_sql`
7. `explain_sql`
8. `list_recycle_bin`
9. `restore_recycle_bin_table`

这条链已经足够把这次 `0.2.0` 的核心价值讲清楚。

---

## 9. 自然语言输入模板

下面这些模板可以在明天现场直接复制给 agent，用来尽量稳定地触发对应 tools。

### 9.1 会话式接入

```text
请先列出当前 region 下的 TaurusDB 实例，然后选择实例 <instance_id> 作为当前会话目标实例。接着使用数据库账号 <username> 登录当前实例，列出数据库，并把默认数据库切换到 <database>。最后展示当前会话绑定状态，明确告诉我现在连接的是哪个实例、哪个库、哪个账号。
```

如果你想分步演，可以拆成：

```text
列出当前 region 下的 TaurusDB 实例，并选择实例 <instance_id> 作为当前会话目标实例。
```

```text
使用数据库账号 <username> 和提供的密码登录当前实例。
```

```text
列出数据库，并把默认数据库切换到 <database>，然后展示当前会话绑定状态。
```

### 9.2 结构探索

```text
请查看当前默认数据库中的表，并重点分析 `orders` 表。先描述 `orders` 表结构，包括字段、索引和任何有助于理解这张表的数据结构信息。
```

更短版本：

```text
帮我看一下 `orders` 表结构，重点展示字段和索引。
```

### 9.3 只读查询

```text
请查询 `orders` 表最近 5 条记录，返回 id、status 和 created_at，按 created_at 倒序排列。
```

如果你想明确告诉 agent 使用只读入口：

```text
请通过只读 SQL 查询 `orders` 表最近 5 条记录，返回 id、status 和 created_at，按 created_at 倒序排列。
```

### 9.4 Explain 分析

```text
请分析这条 SQL 的执行计划，并给出结果摘要和风险提示：

SELECT id, status
FROM orders
WHERE status = 'paid'
ORDER BY created_at DESC
LIMIT 20;
```

如果你想强调 TaurusDB 差异化能力：

```text
请先告诉我当前实例是不是 TaurusDB、支持哪些 Taurus 能力，然后对下面这条 SQL 做 explain 分析；如果支持增强分析，请优先展示 TaurusDB 相关提示：

SELECT id, status
FROM orders
WHERE status = 'paid'
ORDER BY created_at DESC
LIMIT 20;
```

### 9.5 Recycle Bin 查看

```text
请查看当前实例的 recycle bin，确认里面是否存在 `demo_restore_me` 这张演示表。
```

### 9.6 Recycle Bin 恢复

第一次触发：

```text
请尝试恢复 recycle bin 里的 `demo_restore_me` 表。如果恢复操作需要确认，请先返回 confirmation token，不要直接执行。
```

第二次确认触发：

```text
请使用刚才返回的 confirmation token，继续恢复 `demo_restore_me` 表。恢复完成后，再帮我确认这张表已经恢复回来。
```

### 9.7 Recycle Bin 失败时的兜底模板

```text
如果当前实例不支持 recycle bin，或者相关能力未开启，请直接展示当前实例的 TaurusDB capability 信息和参数提示，并改为对一条典型查询做增强 explain 分析。
```

### 9.8 一次性完整演示模板

如果你想一次性把整条链交给 agent，可以用这版：

```text
请按下面顺序完成一次 TaurusDB MCP 演示：

1. 列出当前 region 下的 TaurusDB 实例，并选择实例 <instance_id>。
2. 使用数据库账号 <username> 登录当前实例。
3. 列出数据库，并把默认数据库切换到 <database>。
4. 展示当前会话绑定状态。
5. 描述 `orders` 表结构。
6. 查询 `orders` 表最近 5 条记录，返回 id、status 和 created_at。
7. 对下面这条 SQL 做 explain 分析：
   SELECT id, status
   FROM orders
   WHERE status = 'paid'
   ORDER BY created_at DESC
   LIMIT 20;
8. 查看 recycle bin 中是否存在 `demo_restore_me`。
9. 尝试恢复 `demo_restore_me`；如果需要 confirmation token，先返回 token，不要直接执行。
```
