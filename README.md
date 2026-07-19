# TaurusDB MCP Server

本仓库发布两个 npm 包：

- `taurusdb-core`
- `taurusdb-mcp`

环境要求：

- Node.js `>= 20`
- npm

## 从 npm 使用

普通用户不需要 clone 或 build 当前仓库，直接通过 npm 启动 MCP server：

```bash
npx -y taurusdb-mcp --version
```

也可以先安装到项目里：

```bash
npm install taurusdb-mcp
npx taurusdb-mcp --version
```

MCP 客户端里的启动命令统一使用：

```json
{
  "command": "npx",
  "args": ["-y", "taurusdb-mcp"]
}
```

生产环境推荐先通过安全输入把华为云身份保存到操作系统凭据库：

```bash
npx -y taurusdb-mcp credentials configure
TAURUSDB_CLOUD_KEYCHAIN_SERVICE=taurusdb-mcp/huaweicloud \
  npx -y taurusdb-mcp credentials check
```

AK/SK 不会进入命令参数、shell history 或 MCP 客户端配置。只有在容器 secret
injection 等受控部署中，才使用下面的环境变量方式：

```bash
TAURUSDB_CLOUD_REGION=<your-region>
TAURUSDB_CLOUD_ACCESS_KEY_ID=<your-ak>
TAURUSDB_CLOUD_SECRET_ACCESS_KEY=<your-sk>
```

如果使用华为云临时凭证，再补：

```bash
TAURUSDB_CLOUD_SECURITY_TOKEN=<your-session-token>
```

## MCP 客户端配置

### Claude Code

先完成上面的系统凭据库配置，再把非敏感的 region 和功能开关写入 MCP 配置：

```bash
claude mcp add huaweicloud-taurusdb \
  --transport stdio \
  -s local \
  -e TAURUSDB_CLOUD_REGION=<your-region> \
  -e TAURUSDB_CLOUD_KEYCHAIN_SERVICE=taurusdb-mcp/huaweicloud \
  -e TAURUSDB_ENABLE_DYNAMIC_TARGETS=true \
  -- npx -y taurusdb-mcp
```

验证：

```bash
claude mcp list
claude mcp get huaweicloud-taurusdb
```

### Codex

Codex 支持通过 CLI 添加 stdio MCP server，也可以直接写 `~/.codex/config.toml`。CLI 和 IDE extension 共享这份配置。

```bash
codex mcp add huaweicloud-taurusdb \
  --env TAURUSDB_CLOUD_REGION=<your-region> \
  --env TAURUSDB_CLOUD_KEYCHAIN_SERVICE=taurusdb-mcp/huaweicloud \
  --env TAURUSDB_ENABLE_DYNAMIC_TARGETS=true \
  -- npx -y taurusdb-mcp
```

验证：

```bash
codex mcp list
```

等价的 `~/.codex/config.toml`：

```toml
[mcp_servers.huaweicloud-taurusdb]
command = "npx"
args = ["-y", "taurusdb-mcp"]
enabled = true

[mcp_servers.huaweicloud-taurusdb.env]
TAURUSDB_CLOUD_REGION = "<your-region>"
TAURUSDB_CLOUD_KEYCHAIN_SERVICE = "taurusdb-mcp/huaweicloud"
TAURUSDB_ENABLE_DYNAMIC_TARGETS = "true"
```

### Cursor

创建或编辑 `~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "huaweicloud-taurusdb": {
      "command": "npx",
      "args": ["-y", "taurusdb-mcp"],
      "env": {
        "TAURUSDB_CLOUD_REGION": "<your-region>",
        "TAURUSDB_CLOUD_KEYCHAIN_SERVICE": "taurusdb-mcp/huaweicloud",
        "TAURUSDB_ENABLE_DYNAMIC_TARGETS": "true"
      }
    }
  }
}
```

重启 Cursor 后，在 Agent 模式里让它按下面顺序调用：

- `list_cloud_taurus_instances`
- `select_cloud_taurus_instance`
- `list_databases`
- `set_default_database`
- `get_session_binding`
- `execute_readonly_sql` with `SELECT 1 AS ok`

### 生成客户端配置

`taurusdb-mcp` 也提供初始化命令，可生成 Claude Desktop、Cursor、VS Code 的基础 MCP 配置：

```bash
npx -y taurusdb-mcp init --client claude
npx -y taurusdb-mcp init --client cursor
npx -y taurusdb-mcp init --client vscode
```

生成后按需把上面的 `env` 补进对应配置文件。

## 可用工具

当前 `0.5.0-rc.3` 默认只注册只读、发现、能力探测和诊断 tools。

### 通用工具

- `ping`
- `list_data_sources`
- `list_databases`
- `list_tables`
- `describe_table`
- `show_processlist`
- `execute_readonly_sql`
- `explain_sql`
- `analyze_mutation_sql`（只返回 SQL Advice，不执行状态变更）

### 云会话与能力工具

- `get_kernel_info`
- `list_taurus_features`
- `list_cloud_taurus_instances`
- `get_session_binding`

### TaurusDB 专属工具

- `explain_sql_enhanced`
- `flashback_query`
- `list_recycle_bin`

### 诊断工具

- `find_top_slow_sql`
- `diagnose_service_latency`
- `diagnose_db_hotspot`
- `diagnose_slow_query`
- `diagnose_connection_spike`
- `diagnose_lock_contention`
- `diagnose_replication_lag`
- `diagnose_storage_pressure`

说明：

- TaurusDB 专属 tools 在 `tools/list` 中默认可见。
- 如果当前实例不是 TaurusDB，或者某项能力未开启，调用时会返回结构化 unsupported-feature 错误，而不是直接把 tool 隐藏掉。
- MCP 永不注册数据库写入或回收站恢复工具；账号权限、环境变量和审批 token
  都不能改变这条边界。
- `set_cloud_region`、`select_cloud_taurus_instance`、
  `set_default_database`、`begin_sql_login` 和
  `clear_sql_credentials` 默认隐藏；只有
  `TAURUSDB_ENABLE_DYNAMIC_TARGETS=true` 时才注册。
- `analyze_mutation_sql` 可以使用只读元数据、`EXPLAIN` 和安全派生的
  `COUNT(*)` 生成 SQL Advice；返回结果始终标记 `not_executed` 和
  `human_review_required`。

## 生产安全基线

生产环境默认开启并强制执行以下边界：

- SQL 连接启用 TLS 并验证服务端证书；仅本地 disposable harness 可显式设置
  `TAURUSDB_REQUIRE_TLS=false`。
- datasource 只配置最小权限只读账号；即使误配为可写账号，MCP 也没有数据库
  状态变更工具。
- INSERT、UPDATE、DELETE、DDL、DCL 和管理语句只可进入 SQL Advice，必须由客户
  在 MCP 之外人工复核和执行。
- datasource/database 会绑定到实际连接池，跨数据库 SQL 会被阻断。
- 云 API 只允许 HTTPS 和华为云域名；私有 endpoint 必须由 operator
  在静态配置中显式列出。
- 查询受超时、并发、有界队列、行列数、字段、BLOB 和总返回字节限制。
- 每次 tool 调用都会写入权限为 `0600` 的 JSONL 审计日志；默认只记录
  SQL hash，不记录原始 SQL。

推荐的生产环境变量：

```bash
TAURUSDB_REQUIRE_TLS=true
TAURUSDB_MCP_AUDIT_LOG_PATH=/var/log/taurusdb-mcp/audit.jsonl
TAURUSDB_MCP_AUDIT_INCLUDE_RAW_SQL=false
TAURUSDB_MCP_AUDIT_MAX_BYTES=104857600
TAURUSDB_MCP_AUDIT_MAX_FILES=10
TAURUSDB_MCP_MAX_CONCURRENT_QUERIES=8
TAURUSDB_MCP_MAX_QUEUED_QUERIES=32
TAURUSDB_MCP_QUEUE_TIMEOUT_MS=5000
TAURUSDB_MCP_MAX_RESULT_BYTES=1048576
TAURUSDB_MCP_MAX_BLOB_BYTES=65536
TAURUSDB_SQL_CREDENTIAL_IDLE_TTL_MINUTES=30
TAURUSDB_SQL_CREDENTIAL_MAX_TTL_MINUTES=480
```

通过 `begin_sql_login` 绑定的数据库凭据在空闲 30 分钟后自动清除，且无论是否活跃都不会超过 8 小时。管理员可以缩短这两个值，但不能超过默认安全上限。

本产品没有“开启写能力”的配置。客户需要落库时，应复制经过人工复核的
`advised_sql`，在其受控数据库变更流程中自行执行；MCP 不参与执行或授权。

正式发版前必须完成 [release readiness](docs/release-readiness.md) 中的自动化
门禁和真实 TaurusDB release-candidate 验证。

支持的单会话部署边界、集中审计接入和容量预算见
[客户部署与运行边界](docs/customer-deployment.md)。

## 本地开发

如果你要开发当前仓库，再使用下面的本地流程。

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
npm run check --workspace taurusdb-mcp
npm run test --workspace taurusdb-mcp
```

查看本地 workspace 版本：

```bash
npx taurusdb-mcp --version
```

## npm 发布

维护者先在本地执行完整发布检查：

```bash
npm run release:check
```

真实 TaurusDB RC 门禁通过后，从已验收的 `main` SHA 创建受保护的
`v<version>` tag。GitHub release workflow 会重新执行门禁、生成 SBOM，并按
`taurusdb-core` → `taurusdb-mcp` 的顺序使用 npm provenance 发布。不要从开发机
手工执行 `npm publish`。

发布配置和回滚要求见 [发布就绪门禁](docs/release-readiness.md)。

安装和运行已发布包：

```bash
npm install taurusdb-mcp
npx taurusdb-mcp --version
```

## 从源码配置 Claude Code

下面是从本地源码构建并接入 Claude Code 的开发路径。普通用户优先使用上面的 npm 配置。

### 1. 构建

```bash
cd /path/to/taurus-mcp-server
npm run build
```

### 2. 添加本地 MCP Server

如果你只想先验证本地 MCP 能否启动：

```bash
claude mcp add huaweicloud-taurusdb \
  --transport stdio \
  -- node "$(pwd)/packages/mcp/dist/index.js"
```

如果希望 Claude Code 带着云控制面配置启动，先用 `credentials configure`
保存身份，再只传入非敏感配置：

```bash
claude mcp add huaweicloud-taurusdb \
  --transport stdio \
  -e TAURUSDB_CLOUD_REGION=<your-region> \
  -e TAURUSDB_CLOUD_KEYCHAIN_SERVICE=taurusdb-mcp/huaweicloud \
  -- node "$(pwd)/packages/mcp/dist/index.js"
```

如果使用临时凭证，在 `credentials configure` 的安全输入流程中同时保存
Security Token。

### 3. 验证 MCP 注册

```bash
claude mcp list
claude mcp get huaweicloud-taurusdb
```

检查重点：

- `huaweicloud-taurusdb` 已出现在 `claude mcp list`
- `claude mcp get huaweicloud-taurusdb` 能看到正确的 `command`
- 如果你通过 `-e` 写入了云配置，`env` 不应为空

### 4. 验证云控制面

在 Claude Code 里直接调用：

- `list_cloud_taurus_instances`

查询成功时，通常会看到类似下面这样的结果：

![Successful instance list screenshot](docs/assets/readme/claude-instance-list-success.png)

说明当前 MCP 会话已经能使用这组凭证访问华为云控制面，并且能看见实例列表。

### 5. 验证数据库数据面

控制面通过后，先确保 datasource 已配置数据库密码引用，再验证数据面：

1. `select_cloud_taurus_instance`
2. `list_databases`
3. `set_default_database`
4. `get_session_binding`
5. `execute_readonly_sql` with `SELECT 1 AS ok`

如果 `SELECT 1` 成功，说明数据库数据面也已连通。

## 云数据源模板

当前版本已经支持一种更适合云上多实例切换的用法：

- 只把 datasource 当作模板
- 不要求模板里预先写死 `host`
- 不要求模板里预先写死 `database`
- 模板必须预先配置数据库用户名和密码引用
- 通过 `select_cloud_taurus_instance` 在运行时把当前实例的 `host/port` 绑定到这个模板
- 通过 `set_default_database` 在运行时把默认库绑定到当前会话

这意味着客户不需要每切一个实例就重新改一遍：

- `TAURUSDB_SQL_HOST`
- `TAURUSDB_SQL_PORT`
- `TAURUSDB_SQL_ENGINE`
- `TAURUSDB_SQL_DATASOURCE`
- `TAURUSDB_SQL_DATABASE`
- `TAURUSDB_SQL_USER`
- `TAURUSDB_SQL_PASSWORD`

更推荐的方式是：

1. 先配一次云控制面凭证
2. 保留一个最小 datasource template
3. 每次会话内按顺序调用：
   - `list_cloud_taurus_instances`
   - `select_cloud_taurus_instance`
   - `list_databases`
   - `set_default_database`
   - `get_session_binding`

### 最小模板

当前版本已经把这几个默认值内置好了：

- 默认 `engine = mysql`
- 默认 `datasource = taurus_mcp`
- 只要检测到最小 SQL 模板输入，就会自动把 `taurus_mcp` 作为默认 datasource

所以如果你希望预置一个长期可复用的 SQL 模板，环境变量最小只需要：

```bash
export TAURUSDB_SQL_USER=<database-user>
export TAURUSDB_SQL_PASSWORD='hw-kms-file:~/.taurusdb-mcp/production-password.ciphertext'
```

MCP 不提供本地页面或 Tool 参数输入数据库密码的入口。密码可以使用 `env:`、`file:`、`hw-csms:`、`hw-kms:` 或 `hw-kms-file:` 引用；正式环境优先推荐 DEW CSMS。

### 凭据模式

| 模式 | 推荐场景 | 本地保存内容 |
| --- | --- | --- |
| `env:` / `file:` | 本地开发、快速体验、已有企业密钥注入系统 | 数据库密码或其文件 |
| `hw-csms:` | 客户电脑或云端长期运行，推荐正式环境使用 | CSMS 凭据名称，以及调用 CSMS 所需的云身份 |
| `hw-kms:` / `hw-kms-file:` | 需要华为云 KMS 访问控制和审计 | KMS 密文，以及调用 KMS 所需的云身份 |
| 系统凭据库 + DEW CSMS | macOS/Linux/Windows 客户电脑长期运行，推荐 | 系统凭据库中的云身份；数据库密码由 CSMS 管理 |
| IAM 委托 + DEW CSMS | ECS/CCE 企业部署，规划接入 | 无长期本地敏感凭据 |

推荐按部署环境选择模式，而不是强制所有客户使用 KMS。无论选择哪种模式，数据库密码都不会作为 MCP Tool 参数进入 Agent 对话。

## 系统凭据库存储云身份

在客户电脑上，可以将调用华为云 API 所需的 AK/SK 保存到系统凭据库。MCP 配置中只保留非敏感的 service/account 名称，不再保存 AK/SK。

当前支持：

- macOS Keychain，通过系统自带的 `security` 命令访问
- Linux Secret Service，通过 `secret-tool` 访问；通常需要安装 `libsecret-tools`，并运行可用的 Secret Service 服务
- Windows Credential Manager，通过 Windows PowerShell 调用系统 `CredReadW` / `CredWriteW` API

一次性写入系统凭据库：

```bash
npx taurusdb-mcp credentials configure
```

在源码仓库内也可以使用：

```bash
npm run credentials:configure
```

该命令会依次使用当前系统凭据库的安全输入流程。输入内容不会作为命令参数传递，也不会写入 shell history。旧命令 `npm run keychain:configure` 继续作为兼容别名。

macOS 默认写入以下记录：

```text
service: taurusdb-mcp/huaweicloud/access-key-id
service: taurusdb-mcp/huaweicloud/secret-access-key
account: default
```

Windows 使用以下 Generic Credential Target：

```text
taurusdb-mcp/huaweicloud/default/access-key-id
taurusdb-mcp/huaweicloud/default/secret-access-key
```

如果使用临时 AK/SK，可以同时保存 Security Token：

```bash
npm run credentials:configure -- --with-security-token
```

随后 MCP 只需要配置：

```bash
export TAURUSDB_CLOUD_REGION='cn-north-4'
export TAURUSDB_CLOUD_PROJECT_ID='<project-id>'
export TAURUSDB_CLOUD_KEYCHAIN_SERVICE='taurusdb-mcp/huaweicloud'
export TAURUSDB_CLOUD_KEYCHAIN_ACCOUNT='default'
```

`TAURUSDB_CLOUD_KEYCHAIN_ACCOUNT` 可省略，默认值为 `default`。变量名为兼容已有版本而保留；在 Linux 上它同样表示系统凭据库配置。如果同时配置环境变量 AK/SK 和系统凭据库，环境变量优先。

系统凭据库身份适用于 CSMS、KMS、TaurusDB 实例发现、DAS 和 CES 请求。凭据在首次请求时读取并缓存在当前 MCP 进程内存中。

### 验证凭据链

配置完成后运行：

```bash
npx taurusdb-mcp credentials check
```

在源码仓库内也可以使用：

```bash
npm run credentials:check
```

该命令会分层验证：

- IAM Token、环境变量 AK/SK 或系统凭据库是否可用
- Project ID 是否已配置或能通过 IAM 解析
- datasource 中的 `hw-csms:` / `hw-kms:` / `hw-kms-file:` 密码引用是否可读取

检查过程不会连接数据库，也不会打印 AK/SK、Token、数据库密码、CSMS 凭据名称或 KMS 密文。

## 使用华为云 DEW CSMS 保存数据库密码

DEW CSMS 直接保存并返回数据库密码，适合作为正式环境的默认模式。MCP 只保存凭据名称，不在本地保存数据库密码或 KMS 密文。

在华为云 DEW 凭据管理服务中创建一个通用凭据，将 `secret_string` 设置为数据库密码。然后配置：

```bash
export TAURUSDB_CLOUD_REGION='cn-north-4'
export TAURUSDB_CLOUD_PROJECT_ID='<project-id>'
export TAURUSDB_SQL_USER='taurus_readonly'
export TAURUSDB_SQL_PASSWORD='hw-csms:production-taurusdb-password'
```

名称包含 `/` 等特殊字符时需要 URL 编码，例如：

```bash
export TAURUSDB_SQL_PASSWORD='hw-csms:production%2Ftaurusdb-password'
```

MCP 使用华为云 CSMS 官方接口读取凭据的 `latest` 版本：

```text
GET /v1/{project_id}/secrets/{secret_name}/versions/latest
```

默认 endpoint 为 `https://csms.<region>.myhuaweicloud.com`，也可以通过 `TAURUSDB_CLOUD_CSMS_ENDPOINT` 覆盖。运行身份需要读取目标凭据版本的最小权限。

当前 CSMS 调用复用现有华为云身份配置：

- `TAURUSDB_CLOUD_AUTH_TOKEN`
- 或 `TAURUSDB_CLOUD_ACCESS_KEY_ID` + `TAURUSDB_CLOUD_SECRET_ACCESS_KEY`
- 或 `TAURUSDB_CLOUD_KEYCHAIN_SERVICE` 指向系统凭据库中的 AK/SK
- 使用临时 AK/SK 时额外配置 `TAURUSDB_CLOUD_SECURITY_TOKEN`

数据库密码只会短暂进入 MCP 进程内存，并用于创建数据库连接。CSMS 凭据更新后，重启 MCP 或重建连接池即可读取最新版本。

## 使用华为云 DEW/KMS 保存数据库密码

华为云 DEW/KMS 是正式环境的推荐选项，但不是 MCP 的强制要求。开发和简单部署可使用 `env:` 或 `file:`；需要云端访问控制和审计时使用 `hw-kms:` 或 `hw-kms-file:`。

数据流如下：

```text
客户数据库密码
  -> 使用客户华为云账号下的 KMS 用户主密钥加密
  -> 本地或配置系统只保存 cipher_text
  -> MCP 使用客户授权的 IAM Token 或 AK/SK 调用 KMS decrypt-data
  -> 明文密码短暂进入 MCP 进程内存
  -> MCP 通过 MySQL/TLS 连接 TaurusDB
```

KMS 负责加密、解密和访问控制，不负责创建、修改或自动轮换 TaurusDB 数据库账号密码。

### 1. 前置条件

准备以下信息：

- 华为云区域，例如 `cn-north-4`
- 对应区域的 Project ID
- 一个 DEW/KMS 用户主密钥
- TaurusDB 数据库用户名和密码
- 用于运行 MCP 的 IAM 身份
- `curl` 和 `jq`，仅在使用下面的 API 示例生成密文时需要

KMS 密钥、Project ID 和 MCP 配置的 region 必须属于同一区域。默认 KMS endpoint 为：

```text
https://kms.<region>.myhuaweicloud.com
```

例如：

```text
https://kms.cn-north-4.myhuaweicloud.com
```

### 2. 创建 KMS 密钥

在华为云控制台进入：

```text
数据加密服务 DEW -> 密钥管理 KMS -> 用户主密钥 -> 创建密钥
```

推荐配置：

- 密钥类型：对称密钥
- 密钥规格：`AES_256`
- 密钥用途：`ENCRYPT_DECRYPT`
- 密钥别名：例如 `taurusdb-mcp-production`
- 密钥描述：明确对应的环境和数据库用途

创建后记录密钥 ID。不要把密钥 ID 和数据库实例 ID 混淆。

### 3. 配置 IAM 权限

建议使用两个不同的 IAM 身份：

- 凭据管理员：仅在生成或轮换密文时使用，需要调用 KMS `encrypt-data`
- MCP 运行身份：日常运行使用，只需要调用 KMS `decrypt-data`

生产环境不要给 MCP 运行身份授予创建密钥、删除密钥、禁用密钥或生成新密文等权限。权限策略应限制到目标区域、Project 和目标 KMS 密钥；实际策略动作名称请在华为云 IAM 策略编辑器或 API Explorer 中选择对应的 KMS 加密/解密操作。

MCP 运行身份通常还需要：

- 查看目标 TaurusDB 实例的权限
- 使用指定 KMS 密钥执行解密的权限
- 如启用 DAS/CES 诊断，对应的只读查询权限

优先使用 IAM 委托或临时凭证；如果使用长期 AK/SK，应由客户自行保管并定期轮换。

### 4. 生成密文

生成密文属于部署或密码轮换操作，不应由日常运行的 MCP 自动完成。

仓库提供 `npm run kms:encrypt` 工具。它会：

- 在终端中隐藏输入数据库密码
- 调用 KMS `encrypt-data`
- 默认立即调用 `decrypt-data` 回验
- 仅在回验成功后写入密文文件
- 使用原子替换更新目标密文文件
- 将密文文件权限设置为 `0600`
- 不打印数据库密码或 `cipher_text`

先配置 region、Project ID、KMS key ID 和具备加密、解密权限的临时 IAM Token：

```bash
export TAURUSDB_CLOUD_REGION='cn-north-4'
export TAURUSDB_CLOUD_PROJECT_ID='<project-id>'
export HUAWEICLOUD_KMS_KEY_ID='<kms-key-id>'
export TAURUSDB_CLOUD_AUTH_TOKEN='<temporary-iam-token>'
```

生成并验证密文：

```bash
npm run kms:encrypt -- \
  --output ~/.taurusdb-mcp/production-password.ciphertext
```

也可以使用 AK/SK 或临时 AK/SK 运行该工具，认证变量与 MCP 运行身份配置相同。`--no-verify` 可以跳过解密回验，但不推荐在生产环境使用。

如果不使用仓库工具，也可以直接调用 API。下面的示例使用临时 IAM Token，密码不会写入 shell history，也不会作为命令行参数出现：

```bash
export HUAWEICLOUD_KMS_ENDPOINT="https://kms.${TAURUSDB_CLOUD_REGION}.myhuaweicloud.com"
read -r -s -p 'TaurusDB password: ' TAURUSDB_PASSWORD
printf '\n'
printf '%s' "$TAURUSDB_PASSWORD" \
  | jq -Rs --arg key_id "$HUAWEICLOUD_KMS_KEY_ID" \
      '{key_id: $key_id, plain_text: .}' \
  | curl -fsS \
      -X POST \
      -H "X-Auth-Token: ${TAURUSDB_CLOUD_AUTH_TOKEN}" \
      -H 'Content-Type: application/json' \
      --data-binary @- \
      "${HUAWEICLOUD_KMS_ENDPOINT}/v1.0/${TAURUSDB_CLOUD_PROJECT_ID}/kms/encrypt-data" \
  | jq -er '.cipher_text' \
  > ~/.taurusdb-mcp/production-password.ciphertext

unset TAURUSDB_PASSWORD
chmod 600 ~/.taurusdb-mcp/production-password.ciphertext
```

检查文件存在且非空，不要打印文件内容：

```bash
test -s ~/.taurusdb-mcp/production-password.ciphertext
stat -f '%Sp %N' ~/.taurusdb-mcp/production-password.ciphertext 2>/dev/null \
  || stat -c '%A %n' ~/.taurusdb-mcp/production-password.ciphertext
```

密文文件中只保存 KMS 返回的 `cipher_text`。它不是明文密码，但仍应按敏感配置管理。

### 5. 配置数据源

推荐使用 profile 文件保存 datasource，并通过 `hw-kms-file:` 引用密文：

```json
{
  "defaultDatasource": "production",
  "dataSources": {
    "production": {
      "engine": "mysql",
      "host": "<taurusdb-host>",
      "port": 3306,
      "database": "<optional-default-database>",
      "user": {
        "username": "taurus_readonly",
        "password": "hw-kms-file:~/.taurusdb-mcp/production-password.ciphertext"
      },
      "tls": {
        "enabled": true,
        "rejectUnauthorized": true,
        "servername": "<taurusdb-host>",
        "ca": "file:/path/to/ca.pem"
      }
    }
  }
}
```

启用 profile：

```bash
export TAURUSDB_SQL_PROFILES='~/.taurusdb-mcp/profiles.json'
export TAURUSDB_DEFAULT_DATASOURCE='production'
```

也可以通过环境变量配置最小模板：

```bash
export TAURUSDB_SQL_USER='taurus_readonly'
export TAURUSDB_SQL_PASSWORD='hw-kms-file:~/.taurusdb-mcp/production-password.ciphertext'
```

支持的 KMS 密码引用：

- `hw-kms-file:<path>`：从文件读取 `cipher_text`，推荐用于生产环境
- `hw-kms:<cipher_text>`：直接在配置中保存密文，不推荐用于较长密文

### 6. 配置 MCP 运行身份

MCP 使用下面两种方式之一调用 KMS `decrypt-data` API。

使用 AK/SK：

```bash
export TAURUSDB_CLOUD_REGION='cn-north-4'
export TAURUSDB_CLOUD_PROJECT_ID='<project-id>'
export TAURUSDB_CLOUD_ACCESS_KEY_ID='<access-key-id>'
export TAURUSDB_CLOUD_SECRET_ACCESS_KEY='<secret-access-key>'
```

使用临时 AK/SK 时还需要：

```bash
export TAURUSDB_CLOUD_SECURITY_TOKEN='<session-token>'
```

或者使用 IAM Token：

```bash
export TAURUSDB_CLOUD_REGION='cn-north-4'
export TAURUSDB_CLOUD_PROJECT_ID='<project-id>'
export TAURUSDB_CLOUD_AUTH_TOKEN='<iam-token>'
```

如需覆盖默认 endpoint：

```bash
export TAURUSDB_CLOUD_KMS_ENDPOINT='https://kms.cn-north-4.myhuaweicloud.com'
```

如果 MCP 由 Claude Code、Codex、Cursor 或其他客户端作为 stdio 子进程启动，需要把这些变量写入客户端的 MCP 配置，而不是只在另一个终端中执行 `export`。

Claude Code 完整示例：

```bash
claude mcp add huaweicloud-taurusdb \
  --transport stdio \
  -s local \
  -e TAURUSDB_CLOUD_REGION='<region>' \
  -e TAURUSDB_CLOUD_PROJECT_ID='<project-id>' \
  -e TAURUSDB_CLOUD_ACCESS_KEY_ID='<access-key-id>' \
  -e TAURUSDB_CLOUD_SECRET_ACCESS_KEY='<secret-access-key>' \
  -e TAURUSDB_SQL_PROFILES='~/.taurusdb-mcp/profiles.json' \
  -e TAURUSDB_DEFAULT_DATASOURCE='production' \
  -- npx -y taurusdb-mcp
```

Codex `~/.codex/config.toml` 完整示例：

```toml
[mcp_servers.huaweicloud-taurusdb]
command = "npx"
args = ["-y", "taurusdb-mcp"]
enabled = true

[mcp_servers.huaweicloud-taurusdb.env]
TAURUSDB_CLOUD_REGION = "<region>"
TAURUSDB_CLOUD_PROJECT_ID = "<project-id>"
TAURUSDB_CLOUD_ACCESS_KEY_ID = "<access-key-id>"
TAURUSDB_CLOUD_SECRET_ACCESS_KEY = "<secret-access-key>"
TAURUSDB_SQL_PROFILES = "~/.taurusdb-mcp/profiles.json"
TAURUSDB_DEFAULT_DATASOURCE = "production"
```

如果使用临时 AK/SK，还必须把 `TAURUSDB_CLOUD_SECURITY_TOKEN` 加入同一份 MCP 客户端配置。

### 7. 启动并验证

启动 MCP 后，按顺序验证：

1. `list_cloud_taurus_instances`
2. `select_cloud_taurus_instance`
3. `list_databases`
4. `set_default_database`
5. `execute_readonly_sql`，执行 `SELECT 1 AS ok`

首次建立数据库连接时，MCP 会读取密文并调用：

```text
POST /v1.0/{project_id}/kms/decrypt-data
```

如果 `SELECT 1` 成功，说明以下链路均已通过：

- MCP 的 IAM 身份有效
- MCP 有权使用指定 KMS 密文
- KMS 解密成功
- 数据库账号密码正确
- MCP 到 TaurusDB 的网络和 TLS 连接正常

### 8. 轮换数据库密码

推荐轮换流程：

1. 在 TaurusDB 中修改数据库账号密码。
2. 使用新密码重新调用 KMS `encrypt-data`。
3. 将新的 `cipher_text` 写入临时文件。
4. 使用原子替换方式更新正式密文文件。
5. 重启 MCP，使现有连接池全部使用新密码。
6. 执行 `SELECT 1 AS ok` 验证。

不要在确认新密文可用前删除或禁用旧 KMS 密钥。如果需要轮换 KMS 主密钥，应先使用 KMS 重加密能力生成新密文，再更新 MCP 配置。

### 9. 故障排查

| Error or symptom | Check |
| --- | --- |
| `Huawei KMS endpoint is not configured` | 配置 `TAURUSDB_CLOUD_REGION` 或 `TAURUSDB_CLOUD_KMS_ENDPOINT` |
| 无法解析 Project ID | 配置 `TAURUSDB_CLOUD_PROJECT_ID`，并确认与 KMS 密钥区域一致 |
| KMS 返回 `401` | 检查 IAM Token、AK/SK，以及临时凭证的 Security Token |
| KMS 返回 `403` | MCP 运行身份缺少目标密钥的解密权限 |
| KMS 返回 `404` | 检查 region、Project ID、endpoint 和密文所属密钥 |
| KMS 解密成功但数据库登录失败 | 检查数据库用户名、密码轮换状态、账号锁定和数据库权限 |
| 密文文件读取失败 | 检查路径、文件权限和 MCP 运行用户 |
| 修改密文后仍使用旧密码 | 重启 MCP，清理旧数据库连接池 |

### 10. 安全边界

- 数据库明文密码不会进入 Agent 对话或 MCP Tool 参数。
- 密文文件只包含 `cipher_text`，不包含数据库明文密码。
- KMS 解密后的密码会短暂存在于 MCP 进程内存，并被数据库驱动用于建立连接。
- `begin_sql_login` 通过本机页面完成凭据验证；凭据不进入 Agent 对话或 MCP Tool 参数，不由 MCP 持久化保存。
- 会话式数据库凭据空闲 30 分钟或绑定满 8 小时后自动清除，并关闭关联连接池。
- 不要在日志、错误信息、审计记录或命令输出中打印明文密码、密文、AK/SK 或 IAM Token。
- 推荐在客户 VPC 内运行 MCP，并通过私网和 TLS 访问 TaurusDB。
- 推荐使用专用只读数据库账号、最小 IAM 权限和短期云凭证。

## 连接与会话流程

这里的关键点是：

- `host / port` 来自当前选中的云实例
- `user / password` 必须来自模板，正式环境优先建议密码使用 DEW CSMS 引用
- `database` 可以来自模板，也可以来自 `set_default_database`
- `engine` 默认按 `mysql` 处理，因为 TaurusDB for MySQL 走的是 MySQL 协议
- `datasource` 默认使用 `taurus_mcp`

### 连接方式

在执行下面的推荐流程之前，先确认你的客户端是通过公网还是私网访问 TaurusDB。

#### 方式 A：无同 VPC ECS

如果本机不在和 TaurusDB 相同的 VPC 内，也没有可用的 ECS / VPN / 专线中转，通常需要通过数据库的读写公网地址访问实例。

建议配置：

- 为 TaurusDB 实例开通读写公网地址
- 在实例对应的安全组里只放通当前公网出口 IP，例如
  `<your-public-egress-ip>/32`
- 优先只放通数据库端口 `3306`

可以先在本机终端获取当前公网出口 IP：

```bash
curl ifconfig.me; echo
```

例如返回 `<your-public-egress-ip>`，对应安全组 CIDR 为
`<your-public-egress-ip>/32`。不要把个人或办公网络的真实公网 IP 提交到仓库。

下图展示了一个将本机公网 IP 加入安全组规则的示例：

![TaurusDB 安全组放通本机公网 IP 的示例](image-1.png)

说明：

- 常见情况下，安全组重点是入方向规则；如果你的环境对出方向也做了限制，再补充对应的出方向规则
- 本机公网 IP 变化后，需要同步更新安全组规则
- 这种方式适合本地开发、临时调试或从办公室网络直连云上数据库

#### 方式 B：使用同 VPC ECS

如果你有和 TaurusDB 位于同一 VPC 内的 ECS，或已经通过 VPN / 专线打通到该私网，优先使用读写内网地址连接实例，不必依赖公网地址。

建议配置：

- 在 ECS 或已打通私网的运行环境中部署 Claude Code / MCP Server / 业务程序
- 使用 TaurusDB 的读写内网地址，例如 `192.168.x.x:3306`
- 在安全组里只放通 ECS 所在网段、ECS 安全组，或最小必要来源

说明：

- 这是更推荐的长期方案，安全性和稳定性通常都更好
- 一般不需要为数据库额外购买读写公网地址
- 适合生产环境、固定云上开发机和长期运行的自动化任务

### 推荐流程

完成上面的网络打通后，推荐的实际使用顺序：

1. 在 Claude Code 里调用 `list_cloud_taurus_instances`
2. 调用 `select_cloud_taurus_instance`
3. 调用 `list_databases`
4. 调用 `set_default_database`
5. 调用 `get_session_binding`
6. 再调用 `execute_readonly_sql`，例如：

```json
{
  "sql": "SELECT 1 AS ok"
}
```

下图展示了按上述顺序执行后的实际调用效果：

![Claude Code 中的 TaurusDB MCP 调用示例](image.png)

### 会话绑定模型

当前版本里，实例和默认库可以按会话维度绑定；数据库账号和密码引用由 datasource 配置统一管理。

相关 tool：

- `select_cloud_taurus_instance`
- `set_default_database`
- `get_session_binding`

其中：

- `select_cloud_taurus_instance` 负责绑定实例地址
- `set_default_database` 负责绑定默认库
- `get_session_binding` 负责把当前绑定状态显式返回出来

`select_cloud_taurus_instance` 除了设置当前会话的：

- `project_id`
- `instance_id`
- `node_id`

它现在还会尝试把当前实例的：

- `private_ips[0]`
- 或 `hostnames[0]`
- 以及 `port`

绑定到当前 datasource 模板，然后重建 engine，避免连接池继续复用旧实例。

### DBA 友好模型

这套模型更适合 DBA 统一兜底：

- DBA 维护模板中的 `tls / datasource / engine / 数据库账号 / 密码引用`
- 用户在会话里选择实例和数据库
- MCP 自动把实例地址和默认库绑定到当前会话

如果不同实例共用同一套数据库账号和默认库名，可以统一预写 `TAURUSDB_SQL_USER`、密码引用格式的 `TAURUSDB_SQL_PASSWORD` 和默认库名。

如果你需要覆盖默认值，仍然可以显式设置：

- `TAURUSDB_SQL_ENGINE`
- `TAURUSDB_SQL_DATASOURCE`
- `TAURUSDB_DEFAULT_DATASOURCE`

## 常见问题

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

### 修复缺失的云配置

先检查当前配置：

```bash
claude mcp get huaweicloud-taurusdb
```

如果 `env` 为空，直接重配：

```bash
claude mcp add "huaweicloud-taurusdb" \
  --transport stdio \
  -s local \
  -e TAURUSDB_CLOUD_REGION=cn-east-3 \
  -e TAURUSDB_CLOUD_ACCESS_KEY_ID=<your-ak> \
  -e TAURUSDB_CLOUD_SECRET_ACCESS_KEY=<your-sk> \
  -- npx -y taurusdb-mcp
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
