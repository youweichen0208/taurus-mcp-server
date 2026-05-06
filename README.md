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

查询成功时，通常会看到类似下面这样的结果：

![Successful instance list screenshot](docs/assets/readme/claude-instance-list-success.png)

说明当前 MCP 会话已经能使用这组凭证访问华为云控制面，并且能看见实例列表。

### 5. Verify Database Data Plane

控制面通过后，再补 datasource 相关配置，然后在 Claude Code 里调用：

- `list_data_sources`
- `execute_readonly_sql` with `SELECT 1 AS ok`

如果 `SELECT 1` 成功，说明数据库数据面也已连通。

## Cloud Datasource Template

当前版本已经支持一种更适合云上多实例切换的用法：

- 只把 datasource 当作模板
- 不要求模板里预先写死 `host`
- 通过 `select_cloud_taurus_instance` 在运行时把当前实例的 `host/port` 绑定到这个模板

这意味着客户不需要每切一个实例就重新改一遍：

- `TAURUSDB_SQL_HOST`
- `TAURUSDB_SQL_PORT`
- `TAURUSDB_SQL_ENGINE`
- `TAURUSDB_SQL_DATASOURCE`

更推荐的方式是：

1. 先配一次云控制面凭证
2. 再配一次数据面模板
3. 后续切实例时只调用：
   - `list_cloud_taurus_instances`
   - `select_cloud_taurus_instance`

### Minimal Template

如果你使用环境变量，可以只保留模板字段：

```bash
export TAURUSDB_SQL_ENGINE=mysql
export TAURUSDB_SQL_DATASOURCE=cloud_taurus
export TAURUSDB_SQL_DATABASE=<default-database>
export TAURUSDB_SQL_USER=<readonly-user>
export TAURUSDB_SQL_PASSWORD=<readonly-password>
export TAURUSDB_DEFAULT_DATASOURCE=cloud_taurus
```

这里的关键点是：

- `database / user / password` 来自模板
- `host / port` 来自当前选中的云实例

### Recommended Flow

推荐的实际使用顺序：

1. 在 Claude Code 里调用 `list_cloud_taurus_instances`
2. 调用 `select_cloud_taurus_instance`
3. 再调用 `list_data_sources`
4. 再调用 `execute_readonly_sql`，例如：

```json
{
  "sql": "SELECT 1 AS ok"
}
```

### What `select_cloud_taurus_instance` Does Now

除了设置当前会话的：

- `project_id`
- `instance_id`
- `node_id`

它现在还会尝试把当前实例的：

- `private_ips[0]`
- 或 `hostnames[0]`
- 以及 `port`

绑定到当前 datasource 模板，然后重建 engine，避免连接池继续复用旧实例。

### DBA-Friendly Model

这套模型更适合 DBA 统一兜底：

- DBA 维护模板中的 `database / readonly user / password / tls`
- 用户只需要选实例
- MCP 自动把实例地址绑定到模板

如果不同实例共用同一套只读账号和默认库名，这种方式会明显比“每次切实例都重新 export 一组 SQL env”更顺畅。

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
