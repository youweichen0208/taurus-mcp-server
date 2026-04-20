# Progress

## 1. 当前状态

当前仓库已经从“单包 MCP 原型”推进到“`core + mcp` 可运行、CLI 待接入”的状态。

当前可运行的主链路是：

- `packages/core`: 共享数据面能力与 `TaurusDBEngine`
- `packages/mcp`: MCP `stdio` server、tool registry、`init`
- `packages/cli`: 只有骨架，还未实现真实 CLI 功能

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
- schema / guardrail / executor / confirmation / query tracker 已统一从 engine 暴露
- `core` 不依赖 MCP SDK

### 2.4 MCP 主功能

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

### 2.5 本地 MySQL 测试基础设施

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

---

## 3. 当前测试状态

已完成并通过：

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
- 验证网络、白名单、安全组、TLS 等环境因素
- 验证 TaurusDB 内核与本地 MySQL 的 explain / 元数据差异
- 验证云端真实账号权限与 timeout / cancel 行为

### 4.3 MCP 工程层可能继续收口的点

可继续做：

- 补更多真实数据库 e2e 场景
- 补更完整的长查询取消测试
- 继续同步 `docs/taurusdb-mcp-implementation-plan.md` 的“当前完成度”
- 如果需要，增加 `doctor` 类诊断能力到后续 CLI

---

## 5. CLI 还差哪些

CLI 当前仍未开始真实实现。

待完成：

- 命令模式
- REPL
- `ask`
- `agent`
- 终端确认流
- 输出格式化（table / json / csv）
- LLM provider 接入

当前状态：

- 只有 `packages/cli` 包骨架
- 设计文档已写，但代码未落地

---

## 6. 下一步建议顺序

建议按这个顺序继续：

1. 先把本地 MySQL 环境变量配好，跑通本地 MCP e2e
2. 再把同一批核心场景切换到云端 TaurusDB
3. 云端稳定后，再决定是否继续做 CLI，还是继续补 MCP 诊断与测试能力

