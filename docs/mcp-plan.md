# MCP Plan

> 这份文档是 `@huaweicloud/taurusdb-mcp` 的本地运行与接入手册。
>
> 更完整的实施路线见：
>
> - [`taurusdb-mcp-implementation-plan.md`](./taurusdb-mcp-implementation-plan.md)
> - [`local-mysql-testing.md`](./local-mysql-testing.md)
>
> 本文档解决两个问题：
>
> - 如何在本地启动当前 MCP Server
> - 如何把本地构建出来的 MCP Server 配到本地 agent / MCP client 中

---

## 1. 当前可用能力

当前本地构建出来的 MCP Server 已支持：

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
- `get_kernel_info`
- `list_taurus_features`
- `explain_sql_enhanced`
- `flashback_query`
- `init`

其中：

- `execute_sql` 默认不暴露
- 启用写操作后仍需要 confirmation token
- TaurusDB 专属 Tool 会按启动时 capability probe 动态注册，非 TaurusDB 实例不会暴露它们

---

## 2. 本地启动前提

需要：

- Node.js `>= 20`
- npm
- 已执行 `npm install`
- 如果要联调数据库，需要准备 datasource profile 或环境变量

推荐先构建一次：

```bash
npm run build
```

---

## 3. 本地 MySQL 的环境变量配置步骤

如果你要在本地 agent 中接入当前 MCP，并让它连你的本地 MySQL，建议按下面步骤配置。

### 3.1 准备本地测试库

仓库已提供测试 SQL：

- [`local-mysql-schema.sql`](/Users/youweichen/projects/taurus-mcp-server/testdata/mysql/local-mysql-schema.sql)
- [`local-mysql-seed.sql`](/Users/youweichen/projects/taurus-mcp-server/testdata/mysql/local-mysql-seed.sql)

导入示例：

```bash
mysql -uroot -p < testdata/mysql/local-mysql-schema.sql
mysql -uroot -p < testdata/mysql/local-mysql-seed.sql
```

### 3.2 准备 datasource profile

仓库已提供 profile 示例：

- [`local-mysql-profiles.example.json`](/Users/youweichen/projects/taurus-mcp-server/testdata/mysql/local-mysql-profiles.example.json)

建议复制成你自己的本地文件，例如：

```bash
cp testdata/mysql/local-mysql-profiles.example.json /tmp/taurusdb-local-profiles.json
```

### 3.3 配置 profile 中引用的密码环境变量

如果你沿用示例 profile，需要提供：

```bash
export TAURUSDB_LOCAL_MYSQL_RO_PASSWORD='your_ro_password'
export TAURUSDB_LOCAL_MYSQL_RW_PASSWORD='your_rw_password'
```

### 3.4 配置 MCP 启动所需环境变量

最小推荐：

```bash
export TAURUSDB_SQL_PROFILES=/tmp/taurusdb-local-profiles.json
export TAURUSDB_DEFAULT_DATASOURCE=local_mysql
export TAURUSDB_MCP_LOG_LEVEL=info
```

如果你要暴露 `execute_sql`：

```bash
export TAURUSDB_MCP_ENABLE_MUTATIONS=true
```

### 3.5 可选：直接走环境变量单 datasource 模式

如果你不想先写 profile，也可以直接用环境变量跑一个 datasource：

```bash
export TAURUSDB_SQL_DATASOURCE=local_mysql
export TAURUSDB_SQL_ENGINE=mysql
export TAURUSDB_SQL_HOST=127.0.0.1
export TAURUSDB_SQL_PORT=3306
export TAURUSDB_SQL_DATABASE=taurus_mcp_test
export TAURUSDB_SQL_USER=taurus_ro
export TAURUSDB_SQL_PASSWORD='your_ro_password'
export TAURUSDB_SQL_MUTATION_USER=taurus_rw
export TAURUSDB_SQL_MUTATION_PASSWORD='your_rw_password'
export TAURUSDB_DEFAULT_DATASOURCE=local_mysql
export TAURUSDB_MCP_ENABLE_MUTATIONS=true
```

推荐仍然优先使用 profile 文件，因为更接近真实交付方式。

---

## 4. 本地启动 MCP 的步骤

### 4.1 开发模式启动

```bash
npm run dev --workspace @huaweicloud/taurusdb-mcp
```

这个模式适合你本地调试代码。

### 4.2 构建后启动

```bash
npm run build
node packages/mcp/dist/index.js
```

如果你已经配好了上面的环境变量，server 会：

- 加载 datasource
- 启动 MCP `stdio` server
- 等待 MCP client 通过 stdin/stdout 连接

### 4.3 手工检查版本

```bash
node packages/mcp/dist/index.js --version
```

---

## 5. 如何在本地 agent / MCP client 里配置这个 MCP

对于本地开发场景，不建议直接用已发布 npm 包，建议直接把 client 指向你当前仓库里的本地构建产物：

- `command`: `node`
- `args`: `[/绝对路径/packages/mcp/dist/index.js]`
- `env`: 传入你的 datasource / profile / mutation 开关

下面给四个常见客户端示例。

### 5.1 Claude Code

对于当前仓库，本地开发联调时我更推荐先接 Claude Code。

原因：

- 可以直接用 `claude mcp add --transport stdio` 注册本地 MCP
- 不需要手工改 GUI 客户端配置文件
- 更适合本地 profile 和密码环境变量的临时联调

建议按下面步骤操作。

**步骤 1：先构建 MCP**

```bash
npm run build
```

当前推荐的可执行入口是：

- `node /Users/youweichen/projects/taurus-mcp-server/packages/mcp/dist/index.js`

如果你的仓库不在这个路径，替换成你自己的绝对路径。

**步骤 2：准备 profile 文件**

```bash
cp testdata/mysql/local-mysql-profiles.example.json /tmp/taurusdb-local-profiles.json
```

如果你的 MySQL Docker 不是 `3306`，记得同步修改 `/tmp/taurusdb-local-profiles.json` 里的 `port`。

**步骤 3：准备密码环境变量**

```bash
export TAURUSDB_LOCAL_MYSQL_RO_PASSWORD='your_ro_password'
export TAURUSDB_LOCAL_MYSQL_RW_PASSWORD='your_rw_password'
```

**步骤 4：把本地 MCP 注册到 Claude Code**

建议使用 `local` scope：

- 本地生效
- 不写入项目共享配置
- 更适合带密码的本地联调

```bash
claude mcp add --transport stdio --scope local \
  --env TAURUSDB_SQL_PROFILES=/tmp/taurusdb-local-profiles.json \
  --env TAURUSDB_DEFAULT_DATASOURCE=local_mysql \
  --env TAURUSDB_MCP_LOG_LEVEL=info \
  --env TAURUSDB_MCP_ENABLE_MUTATIONS=true \
  --env TAURUSDB_LOCAL_MYSQL_RO_PASSWORD="$TAURUSDB_LOCAL_MYSQL_RO_PASSWORD" \
  --env TAURUSDB_LOCAL_MYSQL_RW_PASSWORD="$TAURUSDB_LOCAL_MYSQL_RW_PASSWORD" \
  huaweicloud-taurusdb-local -- \
  node /Users/youweichen/projects/taurus-mcp-server/packages/mcp/dist/index.js
```

如果你当前只想测只读能力，删除这行即可：

```bash
--env TAURUSDB_MCP_ENABLE_MUTATIONS=true \
```

**步骤 5：检查 Claude Code 配置是否生效**

```bash
claude mcp list
claude mcp get huaweicloud-taurusdb-local
```

进入 Claude Code 后，还可以执行：

```text
/mcp
```

**步骤 6：建议先做最小 smoke**

先从这些请求开始：

```text
调用 list_data_sources，确认当前 datasource
```

```text
列出 taurus_mcp_test 里的所有表
```

```text
查询 orders 表最近 5 条数据
```

如果需要移除：

```bash
claude mcp remove huaweicloud-taurusdb-local
```

### 5.2 Claude Desktop

配置文件通常是：

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

示例：

```json
{
  "mcpServers": {
    "huaweicloud-taurusdb-local": {
      "command": "node",
      "args": [
        "/Users/youweichen/projects/taurus-mcp-server/packages/mcp/dist/index.js"
      ],
      "env": {
        "TAURUSDB_SQL_PROFILES": "/tmp/taurusdb-local-profiles.json",
        "TAURUSDB_DEFAULT_DATASOURCE": "local_mysql",
        "TAURUSDB_MCP_ENABLE_MUTATIONS": "true",
        "TAURUSDB_MCP_LOG_LEVEL": "info",
        "TAURUSDB_LOCAL_MYSQL_RO_PASSWORD": "your_ro_password",
        "TAURUSDB_LOCAL_MYSQL_RW_PASSWORD": "your_rw_password"
      }
    }
  }
}
```

修改后重启 Claude Desktop。

### 5.3 Cursor

配置文件通常是：

- `~/.cursor/mcp.json`

示例：

```json
{
  "mcpServers": {
    "huaweicloud-taurusdb-local": {
      "command": "node",
      "args": [
        "/Users/youweichen/projects/taurus-mcp-server/packages/mcp/dist/index.js"
      ],
      "env": {
        "TAURUSDB_SQL_PROFILES": "/tmp/taurusdb-local-profiles.json",
        "TAURUSDB_DEFAULT_DATASOURCE": "local_mysql",
        "TAURUSDB_MCP_ENABLE_MUTATIONS": "true",
        "TAURUSDB_MCP_LOG_LEVEL": "info",
        "TAURUSDB_LOCAL_MYSQL_RO_PASSWORD": "your_ro_password",
        "TAURUSDB_LOCAL_MYSQL_RW_PASSWORD": "your_rw_password"
      }
    }
  }
}
```

修改后重启 Cursor。

### 5.4 VS Code

配置文件通常是：

- macOS: `~/Library/Application Support/Code/User/mcp.json`
- Linux: `~/.config/Code/User/mcp.json`
- Windows: `%APPDATA%\Code\User\mcp.json`

示例：

```json
{
  "servers": {
    "huaweicloud-taurusdb-local": {
      "command": "node",
      "args": [
        "/Users/youweichen/projects/taurus-mcp-server/packages/mcp/dist/index.js"
      ],
      "env": {
        "TAURUSDB_SQL_PROFILES": "/tmp/taurusdb-local-profiles.json",
        "TAURUSDB_DEFAULT_DATASOURCE": "local_mysql",
        "TAURUSDB_MCP_ENABLE_MUTATIONS": "true",
        "TAURUSDB_MCP_LOG_LEVEL": "info",
        "TAURUSDB_LOCAL_MYSQL_RO_PASSWORD": "your_ro_password",
        "TAURUSDB_LOCAL_MYSQL_RW_PASSWORD": "your_rw_password"
      }
    }
  }
}
```

修改后重启 VS Code。

---

## 6. 如果你想用 init 命令

如果你不是要接本地仓库，而是要接 npm 发布形态，可以用：

```bash
npx @huaweicloud/taurusdb-mcp init --client claude
npx @huaweicloud/taurusdb-mcp init --client cursor
npx @huaweicloud/taurusdb-mcp init --client vscode
```

但这条路径更适合“发布包接入”，不适合“当前本地代码开发联调”。

本地开发联调建议优先使用手工 JSON 配置，因为你需要控制：

- 本地构建产物路径
- datasource profile 路径
- 本地数据库密码环境变量
- mutation 开关

---

## 7. 推荐的本地联调顺序

建议按下面顺序来：

1. 先导入本地 MySQL schema 和 seed 数据
2. 配好 profile 文件和密码环境变量
3. 先手工本地启动 `node packages/mcp/dist/index.js`
4. 再把 MCP 配到 Claude / Cursor / VS Code 中
5. 先测 `ping`、`list_data_sources`、`list_tables`、`describe_table`
6. 再测 `execute_readonly_sql`、`explain_sql`
7. 最后再开启 mutation，测 `execute_sql` + confirmation token

---

## 8. 当前剩余事项

MCP 当前还剩这些工作：

- 在你的真实本地 MySQL 上实际跑通 e2e
- 再把同样的核心场景切到云端 TaurusDB
- 根据 TaurusDB 的真实行为补差异项
