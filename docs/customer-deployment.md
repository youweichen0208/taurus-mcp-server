# 客户部署与运行边界

本文定义 TaurusDB MCP 0.5.x 的受支持生产部署形态。客户验收和安全评审应以
这里的边界为准，而不是把本地开发模式扩展成共享服务。

## 支持的生产形态

- MCP transport 为 `stdio`。
- 每个客户、客户端或会话信任边界运行独立 MCP 进程。
- 进程使用独立的操作系统身份、datasource profile、审计目录和 secret mount。
- 标准交互式 MCP 运行在客户本机，通过仅向客户出口 IP 放行的 TaurusDB 读写公网
  地址连接数据库。实例选择不会回退到本机不可达的私网地址。SQL 传输默认不启用 TLS，
  该默认值仅适合演示或可信隔离网络；生产部署必须设置 `TAURUSDB_REQUIRE_TLS=true`，
  并通过 datasource profile 配置可信 CA、证书域名和 `rejectUnauthorized: true`。
- 实例选择在展示登录链接前执行无凭据 TCP 预检；不可达时应先修复实例安全组入方向
  规则、网络 ACL、VPN 或客户出口防火墙，不应让用户反复提交数据库密码。
- 日常工具优先使用数据库最小权限只读账号。不存在可重新开启通用写工具的环境变量或
  Agent 审批 token；回收站恢复是使用当前会话账号、独立人工审批的唯一例外。

这种形态适用于单团队、单客户或单自动化会话的企业 Harness。进程隔离就是租户
隔离边界，不能在多个互不信任的用户之间复用同一个进程。

## 不属于 0.5.x 的形态

以下能力需要独立的服务端产品层，不能通过给 stdio 进程增加反向代理获得：

- 共享的远程 HTTP / Streamable HTTP endpoint；
- 多租户身份认证、服务端 RBAC 和租户级配额；
- 跨客户的连接池、凭据或会话复用；
- 控制面管理 API、高可用编排和水平扩缩容。

客户若要求上述能力，应作为后续集中式服务版本立项。0.5.x 不应宣称支持集中式
多租户部署。

## 凭据与最小权限

1. 使用 `taurusdb-mcp credentials configure` 将云身份保存到系统凭据库，或由
   容器 secret injection 提供短期凭据。
2. 选择实例后打开返回的本机 `login_url` 输入数据库账号密码；凭据只进入 MCP 内存，
   不得写入 Git、MCP tool 参数或 Agent 对话。
3. 不需要配置第二组恢复账号和密码。如果客户需要回收站恢复，由数据库管理员决定是否
   为会话登录账号授予原生恢复权限。
4. 需要普通变更时，使用 `analyze_mutation_sql` 获取 SQL Advice，
   由客户在 MCP 外部的变更审批、备份与执行流程中操作。
5. SQL Advice 不是正确性保证；业务规则、权限语义和应用副作用必须人工验证。

## 可选的受控回收站恢复

恢复申请和状态工具默认可见，不需要审批密钥文件。如客户完全不需要该工具，可设置
  `TAURUSDB_ENABLE_RECYCLE_BIN_RESTORE=false` 隐藏申请和状态工具。
- 当前会话账号需要具备 TaurusDB 原生回收站恢复权限；MCP 仍不向 Agent 开放其他写入。
- `prepare_recycle_bin_restore` 只做回收站对象存在性和目标冲突预检，不执行恢复。
- 数据库登录成功会为同一浏览器建立短期 HttpOnly 操作员会话；操作人在该浏览器的
  loopback 页面核对对象与目标并输入身份和精确确认短语。
- 审批链接短时有效、一次性使用。
- 只允许恢复到明确且不存在的目标表，不允许覆盖，也不提供任意 SQL 输入。
- 恢复后执行只读目标验证；批准、成功或失败均记录操作人和目标绑定审计证据。
- 当前本机页面记录的是操作人声明身份。需要强身份认证、双人复核或集中 RBAC 的客户，
  应保持该功能关闭，等待集中式控制面版本，或在外部受控渠道恢复。
- Agent 获得恢复 URL，但不获得浏览器操作员会话 Cookie；应继续禁止 Agent 接管用户
  浏览器配置目录或复用已认证的浏览器自动化会话。

## 审计采集与保留

MCP 将每个 Tool 调用同步写入本地 JSONL。stdout 专用于 MCP JSON-RPC，不能用作
审计输出；stderr 也不构成耐久审计。

生产配置至少包括：

```bash
TAURUSDB_MCP_AUDIT_LOG_PATH=/var/log/taurusdb-mcp/audit.jsonl
TAURUSDB_MCP_AUDIT_INCLUDE_RAW_SQL=false
TAURUSDB_MCP_AUDIT_MAX_BYTES=104857600
TAURUSDB_MCP_AUDIT_MAX_FILES=10
```

- 将审计目录挂载到持久卷，并限制为 MCP 运行身份可写、采集器只读。
- 使用客户现有的 Fluent Bit、Vector、Filebeat 或主机日志 Agent 采集活动文件和
  轮转文件，发送到具有 WORM/对象锁/append-only 策略的集中存储。
- 集中存储负责合规保留期；本地轮转仅用于限制磁盘占用，不能作为最终留存。
- 在投产前验证断网重传、采集 checkpoint、重复事件处理和时钟同步。
- 对 `AUDIT_FAILED`、`SERVER_BUSY`、TLS 失败、磁盘空间不足和
  采集延迟建立告警。

审计写入失败时，MCP 返回 `AUDIT_FAILED`；调用方应先恢复审计持久化，再重试只读
操作。

## 容量与资源预算

每个进程应显式配置查询并发、等待队列、超时和结果预算：

```bash
TAURUSDB_MCP_MAX_CONCURRENT_QUERIES=8
TAURUSDB_MCP_MAX_QUEUED_QUERIES=32
TAURUSDB_MCP_QUEUE_TIMEOUT_MS=5000
TAURUSDB_MCP_MAX_STATEMENT_MS=15000
TAURUSDB_MCP_MAX_ROWS=200
TAURUSDB_MCP_MAX_RESULT_BYTES=1048576
TAURUSDB_MCP_MAX_BLOB_BYTES=65536
```

这些默认值是安全上限，不是容量承诺。客户需要根据实例规格和并发模型完成压测，
并记录持续吞吐、P95/P99、`SERVER_BUSY` 比例、数据库连接数、进程 RSS、审计磁盘
增长和集中采集延迟。仓库提供的确定性规模门禁见
[规模验证](./scale-validation.md)。

## 上线与回滚

- 只部署通过真实 TaurusDB RC gate 的精确 npm 版本和完整性摘要。
- 保留 profile、IAM/数据库授权、审计采集和告警配置的变更记录。
- 回滚时固定到上一已知良好 npm 版本并重启 MCP 进程；不得复用旧进程生成的
  pending approval request。
- 发布和 RC 证据要求见 [发布就绪门禁](./release-readiness.md)。
