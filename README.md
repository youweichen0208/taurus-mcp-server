# TaurusDB MCP Server

[![npm](https://img.shields.io/npm/v/taurusdb-mcp?label=taurusdb-mcp)](https://www.npmjs.com/package/taurusdb-mcp)
[![CI](https://github.com/youweichen0208/taurus-mcp-server/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/youweichen0208/taurus-mcp-server/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

让 AI 助手（Claude、Cursor、VS Code Copilot、Codex 等）用自然语言帮你**查看、诊断和优化华为云
TaurusDB 数据库**，同时保证 AI **不能随意改动你的数据**。

> 例如你可以直接说：“列出我在华为云上的 TaurusDB 实例”、“这个库里最慢的 SQL 是哪几条？”、
> “帮我看看这条 UPDATE 会影响多少行，但不要执行”。

---

## 目录

- [这是什么](#这是什么)
- [能做什么](#能做什么)
- [安全边界：AI 能做什么、不能做什么](#安全边界ai-能做什么不能做什么)
- [开始之前：准备清单](#开始之前准备清单)
- [一步一步安装](#一步一步安装)
- [开始使用](#开始使用)
- [工具清单](#工具清单)
- [生产环境配置](#生产环境配置)
- [常见问题](#常见问题)
- [更多文档](#更多文档)

---

## 这是什么

**MCP（Model Context Protocol）** 是一种让 AI 助手调用外部工具的开放标准。安装本项目后，
你的 AI 助手就多了一组“TaurusDB 工具”：它可以查询华为云上的实例列表、连接数据库、
执行只读查询、分析慢 SQL、诊断锁等待等问题，再用自然语言把结果解释给你。

本项目以 npm 包形式发布：

| 包名 | 用途 |
| --- | --- |
| [`taurusdb-mcp`](https://www.npmjs.com/package/taurusdb-mcp) | MCP 服务本体，**你只需要安装这个** |
| [`taurusdb-core`](https://www.npmjs.com/package/taurusdb-core) | 内部引擎，会被自动安装，无需单独处理 |

它在**你自己的电脑上**运行，由 AI 客户端在需要时自动启动；不需要部署服务器。

---

## 能做什么

| 场景 | 你可以这样说 | 背后的工具 |
| --- | --- | --- |
| 找到并连接实例 | “列出我的 TaurusDB 实例，选择 xxx” | `list_cloud_taurus_instances`、`select_cloud_taurus_instance` |
| 浏览库表结构 | “这个实例有哪些库？orders 表有哪些字段和索引？” | `list_databases`、`list_tables`、`describe_table` |
| 只读查询 | “统计一下各状态的订单数量” | `execute_readonly_sql` |
| 看执行计划 | “这条 SQL 为什么慢？会不会全表扫描？” | `explain_sql`、`explain_sql_enhanced` |
| 变更前评估 | “这条 UPDATE 会影响多少行？有没有风险？先别执行” | `analyze_mutation_sql` |
| 慢 SQL 分析 | “最近 1 小时最慢的 SQL 有哪些？” | `find_top_slow_sql`、`diagnose_slow_query` |
| 性能问题定位 | “接口变慢了，帮我查是不是数据库的问题” | `diagnose_service_latency`、`diagnose_db_hotspot` |
| 连接数 / 锁 / 存储 | “连接数突然暴涨”“有锁等待”“磁盘快满了” | `diagnose_connection_spike`、`diagnose_lock_contention`、`diagnose_storage_pressure` |
| 主从延迟 | “只读节点延迟高是什么原因？” | `diagnose_replication_lag` |
| 查看历史数据 | “看看这张表 10 分钟前的数据” | `flashback_query`（TaurusDB 闪回查询） |
| 误删表找回 | “回收站里有哪些表？把 xxx 恢复成 orders_restored” | `list_recycle_bin`、`restore_recycle_bin_table` |
| 实例能力 | “这个实例的内核版本是多少？开了哪些特性？” | `get_kernel_info`、`list_taurus_features` |

完整列表见 [工具清单](#工具清单)。

---

## 安全边界：AI 能做什么、不能做什么

这是本项目最核心的设计，请花一分钟了解：

- ✅ **可以**：查询实例、读取表结构、执行只读 SQL（SELECT / SHOW / EXPLAIN / DESCRIBE）、做各种诊断。
- ✅ **可以**：对你想执行的 INSERT / UPDATE / DELETE / DDL 给出“SQL 建议”和影响评估。
  `analyze_mutation_sql` 的结果始终标记 `not_executed` 和 `human_review_required`，
  **由你自己复核后**在 MCP 之外执行。
- ❌ **不可以**：执行任何修改数据或结构的 SQL。无论数据库账号权限多大、怎么配置，
  都没有“开启写入”的开关。
- ❌ **不可以**：调用自定义函数或 `SLEEP`、`GET_LOCK` 这类可能锁表、等待或写入的函数。
- 🔐 **数据库密码不经过 AI**：密码在本机浏览器页面输入，直接交给本机的 MCP 进程，
  不会出现在对话里，也不会被保存到磁盘。
- ♻️ **唯一受控例外：回收站恢复**。只能把回收站中一个**精确指定**的表恢复为一个
  **尚不存在**的新表，不会覆盖已有表，并且会完整记录审计日志。不需要此功能的部署可以关闭
  （设置 `TAURUSDB_ENABLE_RECYCLE_BIN_RESTORE=false`）。
- 📝 **全程审计**：每次工具调用都会写入本机审计日志（默认只记录 SQL 的哈希值）。

---

## 开始之前：准备清单

请先逐项确认，缺任何一项都可能导致后面某一步失败：

| # | 需要准备 | 说明 |
| --- | --- | --- |
| 1 | 一台电脑 | macOS、Windows 或 Linux 均可 |
| 2 | **Node.js 20 或更高版本** | 安装方法见步骤 1 |
| 3 | 一个支持 MCP 的 AI 客户端 | Claude Code、Claude Desktop、Cursor、VS Code（Copilot Agent 模式）、Codex 任选其一 |
| 4 | **华为云 AK/SK**（访问密钥） | 获取方法见步骤 3；建议使用只读权限的 IAM 子用户 |
| 5 | 实例所在的**区域 ID** | 例如 `cn-north-4`（华北-北京四）、`cn-east-3`（华东-上海一） |
| 6 | 一个 TaurusDB 实例，且已**开通读写公网地址** | 本机通过公网连接数据库 |
| 7 | 实例安全组已**放通你电脑的公网 IP** | 方法见步骤 5 |
| 8 | 一个数据库账号和密码 | 建议使用**只读账号** |

---

## 一步一步安装

### 步骤 1：安装 Node.js

前往 <https://nodejs.org/> 下载并安装 **LTS 版本**（20 或更高）。安装完成后，打开终端
（macOS 的“终端”、Windows 的 “PowerShell”）执行：

```bash
node -v
```

看到 `v20.x.x` 或更高版本号即可。

### 步骤 2：确认能运行 taurusdb-mcp

```bash
npx -y taurusdb-mcp@1.0.0 --version
```

第一次运行会自动下载，稍等片刻，看到 `1.0.0` 说明一切正常。

> 💡 所有命令都写成了 `taurusdb-mcp@1.0.0`，固定版本可以避免不同时间拿到不同版本。

### 步骤 3：获取华为云 AK/SK 和区域

1. 登录 [华为云控制台](https://console.huaweicloud.com/)。
2. 右上角点击用户名 → **我的凭证** → **访问密钥** → **新增访问密钥**，下载保存好
   `credentials.csv`（里面有 Access Key ID 和 Secret Access Key）。
3. 在控制台顶部的区域选择器中确认实例所在区域，并记下区域 ID（例如 `cn-north-4`）。

> 🔒 建议在 IAM 中创建一个专用子用户，只授予查看 TaurusDB 实例的只读权限
> （以控制台中 TaurusDB / GaussDB 相关的只读系统策略为准）；如需慢 SQL、监控类诊断，
> 再加上 DAS、CES 的只读权限。不要使用主账号的 AK/SK。

### 步骤 4：把 AK/SK 安全地保存到系统凭据库

AK/SK **不要**写进配置文件。运行下面的命令，按提示依次输入 Access Key ID 和
Secret Access Key：

```bash
npx -y taurusdb-mcp@1.0.0 credentials configure
```

它会保存到操作系统自带的安全存储中：

- **macOS**：钥匙串（Keychain），会弹出系统输入框
- **Windows**：凭据管理器（Credential Manager）
- **Linux**：Secret Service，需要先安装 `secret-tool`（如 `sudo apt install libsecret-tools`）

> 使用的是临时 AK/SK？在命令后加 `--with-security-token`，一并保存 Security Token。

保存后检查一下（把 `cn-north-4` 换成你的区域）：

**macOS / Linux：**

```bash
TAURUSDB_CLOUD_REGION=cn-north-4 \
TAURUSDB_CLOUD_KEYCHAIN_SERVICE=taurusdb-mcp/huaweicloud \
  npx -y taurusdb-mcp@1.0.0 credentials check
```

**Windows PowerShell：**

```powershell
$env:TAURUSDB_CLOUD_REGION="cn-north-4"
$env:TAURUSDB_CLOUD_KEYCHAIN_SERVICE="taurusdb-mcp/huaweicloud"
npx -y taurusdb-mcp@1.0.0 credentials check
```

检查不会打印任何密钥内容，也不会连接数据库。

### 步骤 5：让你的电脑能连上数据库

MCP 运行在你的电脑上，通过数据库的**公网地址**连接实例：

1. 在 TaurusDB 控制台打开实例 → **基本信息**，确认已开通**读写公网地址**（没有就先开通）。
2. 查询你电脑当前的公网出口 IP：

   ```bash
   curl ifconfig.me
   ```

   Windows 也可以直接在浏览器打开 <https://ifconfig.me>。
3. 打开实例关联的**安全组** → **入方向规则** → **添加规则**：
   - 协议端口：TCP `3306`（以实例实际端口为准）
   - 源地址：`你的公网IP/32`，例如 `203.0.113.10/32`

   ![TaurusDB 安全组放通本机公网 IP 的示例](image-1.png)

> ⚠️ 不要把源地址设成 `0.0.0.0/0`。你的公网 IP 变化后（换网络、重新拨号），需要同步更新规则。
> 生产环境或长期使用，更推荐在同 VPC 的云服务器上运行，见
> [进阶配置：连接方式](docs/advanced-configuration.md#连接方式)。

### 步骤 6：把 MCP 添加到你的 AI 客户端

下面按客户端分别说明，**只需要做你正在使用的那一个**。所有示例中：

- 把 `cn-north-4` 换成你的区域 ID；
- `TAURUSDB_CLOUD_KEYCHAIN_SERVICE` 保持 `taurusdb-mcp/huaweicloud` 不变（与步骤 4 对应）；
- **不需要**填写数据库地址、账号或密码，这些在使用时再登录。

<details open>
<summary><b>Claude Code（命令行）</b></summary>

```bash
claude mcp add huaweicloud-taurusdb \
  --transport stdio \
  -s user \
  -e TAURUSDB_CLOUD_REGION=cn-north-4 \
  -e TAURUSDB_CLOUD_KEYCHAIN_SERVICE=taurusdb-mcp/huaweicloud \
  -- npx -y taurusdb-mcp@1.0.0
```

验证：

```bash
claude mcp get huaweicloud-taurusdb
```

能看到 `command`、`args` 和 `env` 即配置成功。`-s user` 表示所有项目都可用；只想在当前目录
使用可改为 `-s local`。

</details>

<details>
<summary><b>Claude Desktop</b></summary>

1. 打开 Claude Desktop → **Settings（设置）** → **Developer（开发者）** → **Edit Config（编辑配置）**，
   会打开 `claude_desktop_config.json`：
   - macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows：`%APPDATA%\Claude\claude_desktop_config.json`
2. 写入以下内容（如果文件里已有其他 `mcpServers`，把 `huaweicloud-taurusdb` 这一段加进去即可）：

```json
{
  "mcpServers": {
    "huaweicloud-taurusdb": {
      "command": "npx",
      "args": ["-y", "taurusdb-mcp@1.0.0"],
      "env": {
        "TAURUSDB_CLOUD_REGION": "cn-north-4",
        "TAURUSDB_CLOUD_KEYCHAIN_SERVICE": "taurusdb-mcp/huaweicloud"
      }
    }
  }
}
```

3. **完全退出**并重新打开 Claude Desktop，在输入框的工具图标里能看到 `huaweicloud-taurusdb` 即成功。

</details>

<details>
<summary><b>Cursor</b></summary>

1. 创建或编辑 `~/.cursor/mcp.json`（Windows 为 `%USERPROFILE%\.cursor\mcp.json`），
   也可以在 Cursor **Settings → MCP → Add new MCP server** 中打开它。
2. 写入：

```json
{
  "mcpServers": {
    "huaweicloud-taurusdb": {
      "command": "npx",
      "args": ["-y", "taurusdb-mcp@1.0.0"],
      "env": {
        "TAURUSDB_CLOUD_REGION": "cn-north-4",
        "TAURUSDB_CLOUD_KEYCHAIN_SERVICE": "taurusdb-mcp/huaweicloud"
      }
    }
  }
}
```

3. 重启 Cursor，在 **Settings → MCP** 中看到 `huaweicloud-taurusdb` 显示为绿色即可。
   使用时请切换到 **Agent** 模式。

</details>

<details>
<summary><b>VS Code（GitHub Copilot Agent 模式）</b></summary>

1. 打开命令面板（`Cmd/Ctrl + Shift + P`）→ **MCP: Open User Configuration**，会打开用户级 `mcp.json`。
2. 写入：

```json
{
  "servers": {
    "huaweicloud-taurusdb": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "taurusdb-mcp@1.0.0"],
      "env": {
        "TAURUSDB_CLOUD_REGION": "cn-north-4",
        "TAURUSDB_CLOUD_KEYCHAIN_SERVICE": "taurusdb-mcp/huaweicloud"
      }
    }
  }
}
```

3. 保存后点击配置上方出现的 **Start**，在 Copilot Chat 中切换到 **Agent** 模式使用。

</details>

<details>
<summary><b>Codex</b></summary>

```bash
codex mcp add huaweicloud-taurusdb \
  --env TAURUSDB_CLOUD_REGION=cn-north-4 \
  --env TAURUSDB_CLOUD_KEYCHAIN_SERVICE=taurusdb-mcp/huaweicloud \
  -- npx -y taurusdb-mcp@1.0.0
```

或直接编辑 `~/.codex/config.toml`（CLI 和 IDE 插件共用）：

```toml
[mcp_servers.huaweicloud-taurusdb]
command = "npx"
args = ["-y", "taurusdb-mcp@1.0.0"]
enabled = true

[mcp_servers.huaweicloud-taurusdb.env]
TAURUSDB_CLOUD_REGION = "cn-north-4"
TAURUSDB_CLOUD_KEYCHAIN_SERVICE = "taurusdb-mcp/huaweicloud"
```

验证：`codex mcp list`。

</details>

> 💡 快捷方式：`npx -y taurusdb-mcp@1.0.0 init --client claude`（或 `cursor`、`vscode`）
> 可以自动写入基础配置，但**不包含**上面的 `env`，写入后仍需手动补上两行环境变量。

### 步骤 7：（可选）运行自检

在终端运行验收命令，确认安装和配置都正常：

```bash
TAURUSDB_CLOUD_REGION=cn-north-4 \
TAURUSDB_CLOUD_KEYCHAIN_SERVICE=taurusdb-mcp/huaweicloud \
  npx -y taurusdb-mcp@1.0.0 acceptance --instance-id <你的实例ID> --report acceptance.json
```

命令会在终端打印一个本机登录链接，在浏览器打开并登录数据库后自动继续。结果中
`[pass]` 为通过，`[pending]` 为未配置或未执行的项（不算失败，也不算通过），`[fail]` 为失败。
完整参数见 [TaurusDB 云端验收](docs/cloud-taurusdb-testing.md)。

---

## 开始使用

配置完成后，在 AI 客户端里**用自然语言**对话即可，AI 会自己选择合适的工具。

### 第一次连接：四句话

1. **“列出我的 TaurusDB 实例”**
   AI 会调用 `list_cloud_taurus_instances`，列出当前区域的实例。
2. **“选择实例 `<实例ID>`”**
   AI 会调用 `select_cloud_taurus_instance`，并返回一个本机登录链接
   （形如 `http://127.0.0.1:xxxxx/sql-login/...`）。
3. **在浏览器打开这个链接，输入数据库账号和密码**，看到“账号验证成功”即可回到对话。
   - 链接 **5 分钟内有效**、只能使用一次，最多尝试 3 次；
   - 密码只交给本机 MCP，**不会**出现在对话里；
   - 登录状态空闲 30 分钟或累计 8 小时后自动清除，届时重新选择实例即可。
4. **“列出所有数据库，并把默认库设为 `<库名>`”**，然后就可以开始提问了。

下图是在 Claude Code 中实际调用的效果：

![Claude Code 中的 TaurusDB MCP 调用示例](image.png)

### 常用提问示例

```text
orders 表有哪些字段和索引？
统计最近 7 天每天的订单数量
这条 SQL 为什么慢：SELECT * FROM orders WHERE user_id = 123 ORDER BY created_at DESC
帮我评估这条 UPDATE 的影响，先不要执行：UPDATE orders SET status = 'closed' WHERE created_at < '2026-01-01'
最近 1 小时最慢的 10 条 SQL 是哪些？给出优化建议
现在有没有锁等待？是谁阻塞了谁？
连接数突然升高，帮我看看原因
磁盘空间增长很快，哪些表最大？
看看 orders 表 10 分钟前 id = 100 的数据
回收站里有哪些被删除的表？
```

### 关于“改数据”的请求

如果你让 AI 执行 UPDATE / DELETE / ALTER 等语句，它**不会执行**，而是返回：

- `advised_sql`：建议执行的 SQL（只有在表结构、条件、范围都核实过时才会给出）
- 影响评估：匹配行数、执行计划、是否可能全表扫描
- 风险提示与需要人工确认的业务规则

请你自行复核后，通过自己的数据库客户端或变更流程执行。

### 误删表恢复

TaurusDB 开启回收站后，被 DROP 的表会暂存在回收站中。你可以说：

```text
回收站里有哪些表？
把回收站中的 <回收站对象名> 恢复到 app 库，新表名叫 orders_restored
```

AI 会调用 `restore_recycle_bin_table`：先确认该回收站对象存在、目标表不存在，再执行恢复并验证。
**这是会写入数据库的操作**，请确认对象名和目标表名无误；当前登录的数据库账号需要具备回收站恢复权限。

---

## 工具清单

<details>
<summary>点击展开全部工具（共 30 个）</summary>

**实例与连接**

| 工具 | 作用 |
| --- | --- |
| `list_cloud_taurus_instances` | 列出当前区域的 TaurusDB 实例 |
| `select_cloud_taurus_instance` | 选择实例并返回本机数据库登录链接 |
| `begin_sql_login` | 重新生成本机数据库登录链接 |
| `get_session_binding` | 查看当前绑定的实例、库和登录状态 |
| `set_default_database` | 设置当前会话的默认库 |
| `set_cloud_region` | 切换华为云区域 |
| `clear_sql_credentials` | 清除当前会话中的数据库登录 |
| `list_data_sources` | 列出已配置的数据源 |
| `ping` | 检查 MCP 服务是否在线 |

**浏览与查询（只读）**

| 工具 | 作用 |
| --- | --- |
| `list_databases` / `list_tables` / `describe_table` | 查看库、表、字段和索引 |
| `execute_readonly_sql` | 执行只读 SQL（SELECT / SHOW / EXPLAIN / DESCRIBE） |
| `explain_sql` | 查看执行计划和风险提示 |
| `explain_sql_enhanced` | TaurusDB 增强执行计划分析 |
| `show_processlist` | 查看当前会话和正在执行的 SQL |
| `analyze_mutation_sql` | 为变更 SQL 生成建议和影响评估，**不执行** |

**TaurusDB 特性**

| 工具 | 作用 |
| --- | --- |
| `get_kernel_info` / `list_taurus_features` | 内核版本与特性开关 |
| `flashback_query` | 闪回查询：查看表在过去某一时间点的数据 |
| `list_recycle_bin` | 查看回收站中的表 |
| `restore_recycle_bin_table` | 将一个精确的回收站对象恢复为新表（唯一写操作，可关闭） |

**诊断**

| 工具 | 作用 |
| --- | --- |
| `find_top_slow_sql` | 找出最慢 / 最耗资源的 SQL |
| `diagnose_slow_query` | 分析单条慢 SQL 的原因 |
| `diagnose_service_latency` | 从“接口变慢”出发判断瓶颈类型 |
| `diagnose_db_hotspot` | 找出数据库热点 |
| `diagnose_connection_spike` | 分析连接数暴涨 |
| `diagnose_lock_contention` | 分析锁等待和阻塞链 |
| `diagnose_replication_lag` | 分析主从复制延迟 |
| `diagnose_storage_pressure` | 分析存储空间和临时表压力 |

如果实例不支持某项 TaurusDB 特性（或特性未开启），工具会返回明确的“不支持”错误和开启提示，而不是静默失败。

</details>

---

## 生产环境配置

个人试用按上面的步骤即可。在生产或团队环境中使用前，请评估以下默认值：

| 默认值 | 说明 | 生产建议 |
| --- | --- | --- |
| 数据库连接**未启用 TLS** | 为兼容公网 IP 直连 | 设置 `TAURUSDB_REQUIRE_TLS=true`，并配置可信 CA 与证书校验 |
| 回收站恢复**默认开启** | 无单独审批步骤 | 需要独立审批时设置 `TAURUSDB_ENABLE_RECYCLE_BIN_RESTORE=false` |
| 审计日志写在本机 | 文件权限 `0600`，默认只记录 SQL 哈希 | 指定日志路径并接入集中采集 |

推荐的生产环境变量（加到 MCP 客户端配置的 `env` 中）：

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

<details>
<summary>完整的安全机制说明</summary>

- INSERT、UPDATE、DELETE、DDL、DCL 和管理语句只会进入 SQL 建议（`analyze_mutation_sql`），
  结果始终为 `not_executed`、`human_review_required`，必须由客户在 MCP 之外人工复核和执行。
  本产品没有“开启通用写能力”的配置。
- 查询绑定到当前选择的 datasource/database，跨库 SQL 会被阻断。
- SQL 只能调用白名单内无副作用的内置函数；自定义函数、带库名限定的函数以及 `GET_LOCK`、
  `SLEEP` 等会被阻断（`R010`）。`analyze_mutation_sql` 派生的 `COUNT`/`EXPLAIN` 同样受此约束，
  被拒绝时在 `impact_analysis.evidence_gaps` 中说明原因。
- 只读查询和查询语句的 `EXPLAIN` 在 `START TRANSACTION READ ONLY` 中执行，作为数据库侧兜底；
  MySQL 不允许在只读事务中 `EXPLAIN` DML，因此 DML 的 `EXPLAIN` 在事务外执行，它不会执行 DML 本身。
- 本机登录链接绑定签发时的实例、地址和区域；切换实例或区域、清除登录、重新签发都会让旧链接失效。
- 回收站恢复是唯一受控例外：`restore_recycle_bin_table` 要求当前所选实例上存在未过期的本机登录会话
  （静态配置账号返回 `SQL_SESSION_REQUIRED`），只把一个精确的回收站对象恢复到不存在的目标表；
  恢复前固定审计目标，请求、完成、失败和未验证结果都记录同一实例、对象、目标库表和 SQL 哈希。
  请求审计写入失败时不会开始恢复；执行后状态无法确认时返回 `RECOVERY_STATE_UNCERTAIN`，
  请先核对数据库状态，不要盲目重试。当前仅支持原生恢复，不覆盖已有表。
- 云 API 只允许 HTTPS 和华为云域名。
- 查询受超时、并发、排队、行列数、字段长度、BLOB 和总返回字节数限制。

单进程部署边界、集中审计接入和容量预算见 [客户部署与运行边界](docs/customer-deployment.md)。

</details>

---

## 常见问题

<details>
<summary><b>AI 说找不到 TaurusDB 工具 / MCP 没有启动</b></summary>

- 修改配置后需要**完全重启** AI 客户端（Claude Desktop 需要从菜单栏/托盘退出）。
- 确认 `node -v` ≥ 20，并且 `npx -y taurusdb-mcp@1.0.0 --version` 能输出版本号。
- **Windows** 上如果客户端无法启动 `npx`，把配置改为：

  ```json
  "command": "cmd",
  "args": ["/c", "npx", "-y", "taurusdb-mcp@1.0.0"]
  ```

- Claude Code 可执行 `claude mcp get huaweicloud-taurusdb` 检查配置。

</details>

<details>
<summary><b><code>list_cloud_taurus_instances</code> 返回 <code>INVALID_INPUT</code> 或提示未配置区域/凭证</b></summary>

![Missing env screenshot](docs/assets/readme/claude-mcp-missing-env.png)

说明 MCP 进程没有拿到区域或凭证：

- 检查 MCP 配置中是否有 `TAURUSDB_CLOUD_REGION` 和 `TAURUSDB_CLOUD_KEYCHAIN_SERVICE`。
  在另一个终端执行 `export` **不会**传给 AI 客户端启动的 MCP 进程。
- 确认步骤 4 的 `credentials check` 通过。
- 修改配置后重启客户端。

配置正确时，`claude mcp get huaweicloud-taurusdb` 能看到带 `env` 的配置：

![Configured env screenshot](docs/assets/readme/claude-mcp-env-configured.png)

</details>

<details>
<summary><b>返回 <code>401 verify ak sk signature failed</code></b></summary>

- AK/SK 输入错误、已禁用或已删除：重新执行 `credentials configure`。
- 使用的是临时 AK/SK，但没有保存 Security Token：加 `--with-security-token` 重新配置。

</details>

<details>
<summary><b>选择实例时提示 <code>DB_ENDPOINT_UNREACHABLE</code> 或没有公网地址</b></summary>

- 实例没有开通读写公网地址：先在控制台开通。
- 安全组没有放通你当前的公网 IP，或 IP 已变化：重新执行 `curl ifconfig.me`，更新入方向规则（步骤 5）。
- 公司网络、VPN 或本机防火墙拦截了出方向 3306 端口。
- 提示 `DB_CONNECTION_REFUSED`：地址可达但端口拒绝，检查实例状态和端口号。

</details>

<details>
<summary><b>登录页面显示“登录链接已失效”</b></summary>

链接 5 分钟内有效、只能用一次；切换实例、切换区域或清除登录后，旧链接也会失效。
回到对话说“重新生成数据库登录链接”（`begin_sql_login`）或重新选择实例即可。

</details>

<details>
<summary><b>提示账号验证失败 / 尝试次数已用完</b></summary>

- 检查数据库账号和密码（这里是**数据库**账号，不是华为云登录账号）。
- 连续 3 次失败后链接失效，需要重新生成。
- 页面上会显示具体错误码（如 `DB_AUTH_FAILED`、`DB_VALIDATION_TIMEOUT`）及处理建议。

</details>

<details>
<summary><b>过一段时间后提示需要重新登录 / <code>SQL_SESSION_REQUIRED</code></b></summary>

数据库登录在空闲 30 分钟或累计 8 小时后自动清除（安全设计）。重新选择实例并登录即可。
回收站恢复必须使用本机页面登录的会话，静态配置的账号不能执行恢复。

</details>

<details>
<summary><b>提示某个功能不支持（<code>UNSUPPORTED_FEATURE</code>）</b></summary>

实例内核版本过低或对应特性未开启（例如回收站、闪回查询）。错误信息中会给出所需版本和需要开启的参数，
请在 TaurusDB 控制台的参数设置中开启后再试。

</details>

<details>
<summary><b>Linux 上 <code>credentials configure</code> 失败</b></summary>

需要安装 `secret-tool` 并有可用的 Secret Service（桌面环境通常自带）：

```bash
sudo apt install libsecret-tools   # Debian / Ubuntu
sudo dnf install libsecret         # Fedora / RHEL
```

无桌面的服务器环境，可改用容器 secret 注入等方式，见 [进阶配置](docs/advanced-configuration.md)。

</details>

---

## 更多文档

| 文档 | 内容 |
| --- | --- |
| [进阶配置](docs/advanced-configuration.md) | 无人值守部署、DEW CSMS / KMS 托管数据库密码、私网连接、会话模型 |
| [客户部署与运行边界](docs/customer-deployment.md) | 部署形态、最小权限、审计采集 |
| [TaurusDB 云端验收](docs/cloud-taurusdb-testing.md) | 安装后验收步骤 |
| [架构说明](docs/architecture.md) | 内部设计 |
| [开发与发布](docs/development.md) | 从源码构建、测试与发布（维护者） |
| [发布就绪门禁](docs/release-readiness.md) | 发布标准与流程 |
| [更新日志](CHANGELOG.md) | 版本变更 |

问题反馈与建议：[GitHub Issues](https://github.com/youweichen0208/taurus-mcp-server/issues)

## License

[MIT](LICENSE)
