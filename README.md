# TaurusDB Data Tools

华为云 TaurusDB 数据面工具仓库。

目标是交付两种前端形态，共享同一套数据面能力内核：

- `@huaweicloud/taurusdb-mcp`: 面向 Claude Desktop、Cursor、VS Code 等 AI 客户端的 MCP Server
- `@huaweicloud/taurusdb-cli`: 面向 DBA、开发者、支持人员的 CLI / REPL / AI Agent

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

当前仓库已经完成了第一轮 workspace 拆分，现状是：

- `packages/core` 已承接共享的数据面能力与 `TaurusDBEngine`
- `packages/mcp` 已承接 MCP Server 入口、Tool 注册和 `init` 命令
- `packages/cli` 仍未落地，当前还处于文档设计阶段

当前对外可运行的是基于 workspace 的 MCP 形态；CLI 仍是下一阶段工作。

现阶段的工作重点是：

1. 继续稳固 `core` 和 `mcp` 的包边界
2. 把剩余 MCP 特有逻辑继续压薄到协议层
3. 在 shared `core` 之上新增 `packages/cli`

换句话说，这个仓库当前是“`core + mcp` 已落地，CLI 待接入”的状态。

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

目标结构见 [architecture.md](./docs/architecture.md)，下一步会继续补齐：

```text
packages/cli
```

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
   需求背景、产品定位、首版范围和验收边界
2. [docs/architecture.md](./docs/architecture.md)
   目标架构、包边界、核心抽象、能力映射
3. [docs/taurusdb-mcp-implementation-plan.md](./docs/taurusdb-mcp-implementation-plan.md)
   如何从当前单包实现抽出 `core + mcp`
4. [docs/taurusdb-cli-implementation.md](./docs/taurusdb-cli-implementation.md)
   如何在 shared `core` 上新增 CLI 前端
5. [docs/local-mysql-testing.md](./docs/local-mysql-testing.md)
   本地 MySQL 如何验证当前 MCP，以及之后如何切到云端 TaurusDB

## Design Principles

- 数据面优先，不把首版做成云控制台
- 默认最小权限，写操作必须显式开启
- schema 先于 SQL，先给上下文再执行
- 审计、脱敏、超时和取消能力属于主链路，不是附属能力
- `core` 只提供业务能力，不感知 MCP 协议或 CLI 命令格式

## Near-Term Roadmap

- 继续清理 `core` 中仍偏向 MCP 的边界设计
- 增加更多 MCP Tool，逐步从 `ping` 扩展到 schema/query 链路
- 新建 `packages/cli`，补齐命令模式、REPL、ask、agent

## Notes

- 根目录 `package.json` 现在是 workspace 根配置，不再代表单包 MCP 包
- `packages/core` 与 `packages/mcp` 已拆出，但 CLI 还未实现
- 文档里仍有部分“从单包迁移”的描述，后续会继续收敛到当前状态
