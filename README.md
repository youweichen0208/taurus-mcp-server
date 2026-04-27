# TaurusDB Data Tools

华为云 TaurusDB 数据面工具仓库。

当前产品边界已经收敛为“两种前端，共享同一套 `core`”：

- `@huaweicloud/taurusdb-mcp`
  面向 Claude Desktop、Cursor、VS Code 等 AI 客户端的 MCP Server
- `@huaweicloud/taurusdb-cli`
  面向 DBA、开发者、支持人员的 CLI。第一阶段只做命令模式，CLI 本体尚未实现完成

核心链路保持一致：

```text
自然语言 / 命令
→ schema 上下文
→ SQL
→ 风险校验
→ 数据面执行
→ 结构化结果
```

## Current Status

当前仓库状态：

- `packages/core` 已承接共享的数据面能力与 `TaurusDBEngine`
- `packages/mcp` 已承接 MCP Server 入口、Tool 注册和 `init` 命令
- `packages/cli` 目前还是脚手架入口，尚未进入真实实现阶段

当前真正可用的是 MCP 形态。CLI 仍属于下一阶段。

当前 MCP 已具备：

- 通用 MySQL 数据面 Tool
- 最小 Guardrail + token confirmation
- TaurusDB capability probe
- 基于 probe 的动态 Tool 注册
- 4 个 TaurusDB 首阶段 Tool：
  - `get_kernel_info`
  - `list_taurus_features`
  - `explain_sql_enhanced`
  - `flashback_query`

当前明确不在首阶段范围内：

- recycle bin Tool
- SQL history / Binlog / preflight / doctor
- CLI REPL / ask / agent

下一阶段建议优先新增的是一组场景化诊断 Tool，而不是单纯继续加执行 SQL 的入口：

- `diagnose_slow_query`
- `diagnose_connection_spike`
- `diagnose_lock_contention`
- `diagnose_replication_lag`
- `diagnose_storage_pressure`

## Repository Layout

当前仓库的真实结构：

```text
.
├── packages/
│   ├── core/
│   └── mcp/
├── docs/               # 需求、架构和实施计划
├── package.json        # workspace 根配置
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

更完整的边界说明见 [docs/architecture.md](./docs/architecture.md)。

## Quick Start

环境要求：

- Node.js `>= 20`
- npm

安装依赖：

```bash
npm install
```

开发模式启动当前 MCP Server：

```bash
npm run dev
```

构建：

```bash
npm run build
```

运行测试：

```bash
npm test
```

只看 MCP 包的检查 / 测试：

```bash
npm run check --workspace @huaweicloud/taurusdb-mcp
npm run test --workspace @huaweicloud/taurusdb-mcp
```

查看版本：

```bash
npx @huaweicloud/taurusdb-mcp --version
```

初始化 MCP 客户端配置：

```bash
npx @huaweicloud/taurusdb-mcp init --client claude
npx @huaweicloud/taurusdb-mcp init --client cursor
npx @huaweicloud/taurusdb-mcp init --client vscode
```

## Documentation

建议按这个顺序阅读：

1. [docs/requirements.md](./docs/requirements.md)
   当前产品范围、首阶段边界、验收标准
2. [docs/architecture.md](./docs/architecture.md)
   架构、包边界、动态 Tool 注册、当前确认模型
3. [docs/taurusdb-mcp-implementation-plan.md](./docs/taurusdb-mcp-implementation-plan.md)
   MCP 第一阶段实施计划
4. [docs/taurusdb-cli-implementation.md](./docs/taurusdb-cli-implementation.md)
   CLI 第一阶段实施计划
5. [docs/local-mysql-testing.md](./docs/local-mysql-testing.md)
   本地 MySQL 如何验证当前 MCP

## Design Principles

- 数据面优先，不把首版做成云控制台
- 默认最小权限，写操作必须显式开启并经过确认
- schema 先于 SQL，先给上下文再执行
- Guardrail 保持最小，不做 schema-aware 校验、cost 预检查和复杂缓存
- `core` 只提供业务能力，不感知 MCP 协议或 CLI 命令格式
- TaurusDB 差异化能力按内核版本探测并动态暴露

## Near-Term Roadmap

- 稳定 `core` / `mcp` 的边界
- 稳定 capability probe 与动态 Tool 注册
- 在云端 TaurusDB 上验证 capability probe、enhanced explain、flashback query
- 在云端 TaurusDB 上验证 CES / Cloud Eye 指标源、复制状态与 diagnostics 联合证据
- 在 `core` 上实现 CLI 命令模式
- 回收站、history/binlog、CLI REPL/AI 属于后续阶段

当前 diagnostics Tool 已直接纳入默认 tool 集合。CES / Cloud Eye 指标源已有第一版，可通过 `TAURUSDB_METRICS_SOURCE_CES_*` 环境变量启用；详见 [docs/mcp-plan.md](./docs/mcp-plan.md)。

## Notes

- 根目录 `package.json` 现在是 workspace 根配置，不再代表单包 MCP 包
- `packages/core` 与 `packages/mcp` 已拆出
- `packages/cli` 目前还是 scaffold
- 产品和架构文档已经统一按“当前首阶段范围”收口
