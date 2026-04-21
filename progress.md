# Progress

## 1. 当前状态

当前仓库已经从“单包 MCP 原型”推进到“`core + mcp` 可运行、CLI 待接入”的状态。

当前可运行的主链路是：

- `packages/core`: 共享数据面能力与 `TaurusDBEngine`
- `packages/mcp`: MCP `stdio` server、tool registry、`init`
- `packages/cli`: 只有 scaffold，还未进入真实实现阶段

当前首阶段范围已经收敛为：

- 通用 MySQL 数据面 Tool
- minimal guardrail + token confirmation
- TaurusDB capability probe
- 4 个 TaurusDB 首阶段 Tool：
  - `get_kernel_info`
  - `list_taurus_features`
  - `explain_sql_enhanced`
  - `flashback_query`

当前明确不在首阶段范围内：

- recycle bin
- SQL history / Binlog / preflight
- CLI REPL / ask / agent / doctor

当前已经接上但尚未默认暴露的下一阶段 scaffold：

- diagnostics shared types / result contract
- `TaurusDBEngine` 的 5 个诊断入口方法
- 5 个诊断 MCP Tool handler

下一阶段优先候选：

- `diagnose_slow_query`
- `diagnose_connection_spike`
- `diagnose_lock_contention`
- `diagnose_replication_lag`
- `diagnose_storage_pressure`

---

## 2. 已完成事项

### 2.1 文档与方案层

已完成：

- 重构仓库主文档与设计文档边界
- 明确 `core / mcp / cli` 三包定位
- 新增本地 MySQL 测试文档
- 修正部分旧引用和单包时代残留叙述

主要文件：

- `README.md`
- `docs/requirements.md`
- `docs/architecture.md`
- `docs/taurusdb-mcp-implementation-plan.md`
- `docs/taurusdb-cli-implementation.md`
- `docs/local-mysql-testing.md`

### 2.2 工程结构重构

已完成：

- 根目录改成 workspace 结构
- 新建 `packages/core`
- 新建 `packages/mcp`
- 新建 `packages/cli` scaffold
- 根 `package.json`、`tsconfig`、workspace 脚本已收口

### 2.3 Shared Core 收口

已完成：

- 引入 `TaurusDBEngine`
- server/tool 层不再直接拼装散装模块
- schema / guardrail / executor / confirmation / query tracker / capability probe 已统一从 engine 暴露
- `core` 不依赖 MCP SDK
- guardrail 已收敛为 minimal 模型
- 移除了重型 schema-aware 校验、EXPLAIN 预检查和复杂缓存依赖

### 2.4 TaurusDB 首阶段能力

已完成：

- `capability/` 模块
- TaurusDB kernel / feature probe
- 启动时 capability probe
- 动态 Tool 注册
- `get_kernel_info`
- `list_taurus_features`
- `explain_sql_enhanced`
- `flashback_query`

### 2.5 MCP 主功能

已完成：

- `ping`
- `list_data_sources`
- `list_databases`
- `list_tables`
- `describe_table`
- `sample_rows`
- `execute_readonly_sql`
- `explain_sql`
- `get_query_status`
- `cancel_query`
- `execute_sql`
- `init`

已完成的 MCP 行为：

- 统一 response envelope
- guardrail block / confirm / allow 主路径
- confirmation token 签发与校验
- `enableMutations` 开关控制 `execute_sql` 暴露
- stderr 日志边界
- `stdio` 集成测试
- `init` merge 行为测试

### 2.6 本地 MySQL 测试基础设施

已完成：

- 增加真实 MySQL driver adapter
- 增加本地 MySQL schema / seed / profile 示例
- 增加 opt-in 本地 MySQL MCP 集成测试
- 默认测试基线不依赖本地 MySQL

主要文件：

- `packages/core/src/executor/adapters/mysql.ts`
- `testdata/mysql/local-mysql-schema.sql`
- `testdata/mysql/local-mysql-seed.sql`
- `testdata/mysql/local-mysql-profiles.example.json`
- `packages/mcp/tests/local-mysql.test.mjs`

### 2.7 Diagnostics Scaffold

已完成：

- 在 `packages/core` 新增 diagnostics 类型层与统一结果 contract
- 在 `TaurusDBEngine` 新增 5 个诊断入口方法：
  - `diagnoseSlowQuery`
  - `diagnoseConnectionSpike`
  - `diagnoseLockContention`
  - `diagnoseReplicationLag`
  - `diagnoseStoragePressure`
- 在 `packages/mcp` 新增 5 个诊断 Tool handler 与输入校验
- 统一了诊断结果的 public mapping，MCP/CLI 后续可复用同一套返回骨架
- 增加了 `core` / `mcp` 侧的 scaffold 测试

当前刻意未做：

- 未把 5 个诊断 Tool 接入默认 `registerTools`
- 未实现 CES / processlist / 锁等待 / 复制状态 / 慢 SQL collector
- 未实现真正的根因分析逻辑，当前返回的是结构化 scaffold 结果

主要文件：

- `packages/core/src/diagnostics/types.ts`
- `packages/core/src/engine.ts`
- `packages/core/src/index.ts`
- `packages/mcp/src/tools/taurus/diagnostics.ts`
- `packages/mcp/src/tools/common.ts`
- `packages/core/tests/engine.test.mjs`
- `packages/mcp/tests/tool-handlers.test.mjs`

---

## 3. 当前测试状态

已完成并通过：

- 根级 `npm run check`
- 根级 `npm run build`
- `packages/core` 单元测试
- `packages/mcp` 单元测试
- `packages/mcp` `stdio` 集成测试
- `packages/mcp` `init` 命令测试

当前默认 `npm test` 结果：

- `packages/core`: 通过
- `packages/mcp`: 通过
- 本地 MySQL e2e: 默认跳过，需显式开启环境变量

---

## 4. MCP 还差哪些

### 4.1 本地联调阶段仍待完成

待完成：

- 用真实本地 MySQL 跑通新增的 opt-in e2e
- 验证本地账号权限模型是否符合只读 / 写入分离预期
- 验证样例库上的 explain / sample / mutation 行为是否符合预期

说明：

- 代码、SQL 资产、测试文件已经准备好
- 但还没有在你的本地 MySQL 实例上实际跑过，因为当前没有你的本地连接环境变量

### 4.2 云端 TaurusDB 阶段仍待完成

待完成：

- 用云端 TaurusDB 复跑 schema / readonly / explain / mutation 主链路
- 用云端 TaurusDB 验证 capability probe / enhanced explain / flashback_query
- 验证网络、白名单、安全组、TLS 等环境因素
- 验证 TaurusDB 内核与本地 MySQL 的 explain / 元数据差异
- 验证云端真实账号权限与 timeout / cancel 行为
- 后续在云端 TaurusDB 上补齐 diagnostics 的 CES / 内核联合证据验证

### 4.3 MCP 工程层可能继续收口的点

可继续做：

- 补更多真实数据库 e2e 场景
- 补更完整的长查询取消测试
- 继续同步 `docs/taurusdb-mcp-implementation-plan.md` 的“当前完成度”
- 继续把 diagnostics scaffold 从 contract 层推进到 collector / analyzer 层
- diagnostics 完成真实 collector 前，不要默认注册到 MCP tool registry
- 后续阶段再评估 recycle bin 与 history/binlog 类能力

---

## 5. CLI 还差哪些

CLI 当前仍未开始真实实现，第一阶段目标应控制在命令模式。

待完成：

- 命令模式
- token-based 终端确认包装
- 输出格式化（table / json / csv）
- TaurusDB 专属命令：
  - `features`
  - `explain+`
  - `flashback`

当前状态：

- 只有 `packages/cli` 包骨架
- 设计文档已按首阶段范围收口
- 代码未落地

后续阶段再考虑：

- REPL
- `ask`
- `agent`
- `doctor`

---

## 6. 下一步建议顺序

建议按这个顺序继续：

1. 先把本地 MySQL 环境变量配好，跑通本地 MCP e2e
2. 再把 capability probe / enhanced explain / flashback 切到云端 TaurusDB 验证
3. 先把 `diagnose_slow_query`、`diagnose_lock_contention` 的 collector 和最小分析逻辑落地
4. 再把 diagnostics 补到云端 TaurusDB 的 CES + 内核联合验证
5. 云端稳定后，开始 CLI 命令模式
6. recycle bin、history/binlog、CLI 高阶交互全部放到后续阶段再决定
