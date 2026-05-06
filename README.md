# TaurusDB Data Tools

华为云 TaurusDB 数据面工具仓库。

当前产品边界已经收敛为“一个数据面 MCP Server + 一个 companion CLI”：

- `@huaweicloud/taurusdb-mcp`
  面向 Claude Desktop、Cursor、VS Code 等 AI 客户端的 MCP Server
- `@huaweicloud/taurusdb-cli`
  面向开发者、测试、DBA、运维和 CI 的 MCP companion。第一阶段用于安装、配置、验证、调试、runbook 和 context export，CLI 本体尚未实现完成

核心链路以 MCP 为主入口：

```text
自然语言 / MCP Tool 调用
→ schema 上下文
→ SQL
→ 风险校验
→ 数据面执行
→ 结构化结果

CLI
→ init / config doctor / mcp smoke / mcp call / runbook / context export
→ 调用或验证真实 MCP 行为
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
- TaurusDB 首阶段 Tool：
  - `get_kernel_info`
  - `list_taurus_features`
  - `explain_sql_enhanced`
  - `flashback_query`
  - `list_recycle_bin`
  - `restore_recycle_bin_table`
- 场景化 diagnostics Tool：
  - `find_top_slow_sql`
  - `diagnose_service_latency`
  - `diagnose_db_hotspot`
  - `diagnose_slow_query`
  - `diagnose_connection_spike`
  - `diagnose_lock_contention`
  - `diagnose_replication_lag`
  - `diagnose_storage_pressure`

当前明确不在首阶段范围内：

- SQL history / Binlog / preflight / doctor
- CLI REPL / ask / agent

## Repository Layout

当前仓库的真实结构：

```text
.
├── packages/
│   ├── core/
│   ├── cli/
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

1. [docs/architecture.md](./docs/architecture.md)
   架构、包边界、动态 Tool 注册、当前确认模型
2. [docs/taurusdb-mcp-implementation-plan.md](./docs/taurusdb-mcp-implementation-plan.md)
   MCP 第一阶段实施计划
3. [docs/testing.md](./docs/testing.md)
   MCP 测试策略、验收口径和完整测试矩阵
4. [docs/manual-smoke-test.md](./docs/manual-smoke-test.md)
   本地 MCP Inspector / 客户端手工 smoke
5. [docs/cloud-taurusdb-testing.md](./docs/cloud-taurusdb-testing.md)
   云端 TaurusDB 联调和 `npm run cloud:validate` 使用说明
6. [docs/taurusdb-ops-playbook.md](./docs/taurusdb-ops-playbook.md)
   5 类高频运维问题的 MCP 诊断和 TaurusDB 特性使用路径
7. [docs/taurusdb-cli-implementation.md](./docs/taurusdb-cli-implementation.md)
   CLI 第一阶段实施计划

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
- 实现 MCP companion CLI：`config doctor`、`mcp tools`、`mcp call`、`mcp smoke`、`cloud validate`、`runbook`、`context export`
- history/binlog、远程 MCP 调试、CLI TUI/AI 属于后续阶段

当前 diagnostics Tool 已直接纳入默认 tool 集合。云侧 evidence source 现已支持以 `region + AK/SK` 为主路径的高层 cloud resolver，以及 `set_cloud_region`、`set_cloud_access_keys`、`list_cloud_taurus_instances`、`select_cloud_taurus_instance` 这组会话级 Tool；底层 `TAURUSDB_SLOW_SQL_SOURCE_DAS_*` / `TAURUSDB_METRICS_SOURCE_CES_*` 仍可作为 override 使用。详见 [docs/cloud-taurusdb-testing.md](./docs/cloud-taurusdb-testing.md) 和 [docs/taurusdb-mcp-implementation-plan.md](./docs/taurusdb-mcp-implementation-plan.md)。

## Notes

- 根目录 `package.json` 现在是 workspace 根配置，不再代表单包 MCP 包
- `packages/core` 与 `packages/mcp` 已拆出
- `packages/cli` 目前还是 scaffold，目标已调整为 MCP companion 而不是第二套数据面客户端
- 产品和架构文档已经统一按“当前首阶段范围”收口

## Claude Code Setup

下面是一条最短可走通的 Claude Code 接入路径。

### 1. Build

```bash
cd /Users/youweichen/projects/taurus-mcp-server
npm run build
```

### 2. Add The Local MCP Server

如果你只想先验证本地 MCP 能否启动：

```bash
claude mcp add huaweicloud-taurusdb \
  --transport stdio \
  -- node /Users/youweichen/projects/taurus-mcp-server/packages/mcp/dist/index.js
```

如果你希望 Claude Code 直接带着华为云控制面配置启动，推荐一次性把 `region + AK/SK` 写进 MCP 配置，而不是依赖外部 shell 的 `export`：

```bash
claude mcp add huaweicloud-taurusdb \
  --transport stdio \
  -e TAURUSDB_CLOUD_REGION=<your-region> \
  -e TAURUSDB_CLOUD_ACCESS_KEY_ID=<your-ak> \
  -e TAURUSDB_CLOUD_SECRET_ACCESS_KEY=<your-sk> \
  -- node /Users/youweichen/projects/taurus-mcp-server/packages/mcp/dist/index.js
```

如果你使用的是临时凭证，再补：

```bash
-e TAURUSDB_CLOUD_SECURITY_TOKEN=<your-session-token>
```

### 3. Verify The MCP Registration

```bash
claude mcp list
claude mcp get huaweicloud-taurusdb
```

检查重点：

- `huaweicloud-taurusdb` 已出现在 `claude mcp list`
- `claude mcp get huaweicloud-taurusdb` 能看到正确的 `command`
- 如果你通过 `-e` 写入了云配置，`env` 不应为空

### 4. Verify Cloud Control Plane

在 Claude Code 里直接调用：

- `list_cloud_taurus_instances`

如果返回成功，并且结果中有：

- `cloud.region`
- `cloud.project_id`
- `items`

说明当前 MCP 会话已经能使用这组凭证访问华为云控制面，并且能看见实例列表。

### 5. Verify Database Data Plane

控制面通过后，再补 datasource 相关配置，然后在 Claude Code 里调用：

- `list_data_sources`
- `execute_readonly_sql` with `SELECT 1 AS ok`

如果 `SELECT 1` 成功，说明数据库数据面也已连通。

## Common Issues

### `list_cloud_taurus_instances` returns `INVALID_INPUT`

如果你在 Claude Code 中看到类似错误：

![Missing env screenshot](docs/assets/readme/claude-mcp-missing-env.png)

这通常说明当前 MCP 进程没有拿到：

- `TAURUSDB_CLOUD_REGION`
- `TAURUSDB_CLOUD_ACCESS_KEY_ID`
- `TAURUSDB_CLOUD_SECRET_ACCESS_KEY`

最常见原因不是变量没配，而是：

- 你在外部 shell 里执行了 `export`，但 Claude Code 的 MCP 进程早已启动
- 你修改了环境变量，但没有重启 Claude Code 会话
- `claude mcp add` 时没有把 `-e` 写进 MCP 配置

### How To Fix Missing Cloud Env

先检查当前配置：

```bash
claude mcp get huaweicloud-taurusdb
```

如果 `env` 为空，直接重配：

```bash
claude mcp remove huaweicloud-taurusdb

claude mcp add huaweicloud-taurusdb \
  --transport stdio \
  -e TAURUSDB_CLOUD_REGION=<your-region> \
  -e TAURUSDB_CLOUD_ACCESS_KEY_ID=<your-ak> \
  -e TAURUSDB_CLOUD_SECRET_ACCESS_KEY=<your-sk> \
  -- node /Users/youweichen/projects/taurus-mcp-server/packages/mcp/dist/index.js
```

如果是临时凭证，再补：

```bash
-e TAURUSDB_CLOUD_SECURITY_TOKEN=<your-session-token>
```

重配后再次执行：

```bash
claude mcp get huaweicloud-taurusdb
```

如果能看到类似下面这样带 `env` 的配置，就说明 Claude Code 的 MCP 启动环境已经写对了：

![Configured env screenshot](docs/assets/readme/claude-mcp-env-configured.png)

### `401 verify ak sk signature failed`

如果 `list_cloud_taurus_instances` 返回 `401`，通常说明：

- `AK/SK` 填错
- 使用的是临时凭证但缺少 `TAURUSDB_CLOUD_SECURITY_TOKEN`
- `AK/SK` 已禁用或已重置

当前仓库已经修复了华为云 IAM 签名中的 canonical URI 尾斜杠问题。如果你仍然收到 `401`，优先检查凭证本身，而不是 `project_id`。
