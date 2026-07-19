# 客户部署与运行边界

本文定义 TaurusDB MCP 0.4.x 的受支持生产部署形态。客户验收和安全评审应以
这里的边界为准，而不是把本地开发模式扩展成共享服务。

## 支持的生产形态

- MCP transport 为 `stdio`。
- 每个客户、客户端或会话信任边界运行独立 MCP 进程。
- 进程使用独立的操作系统身份、datasource profile、审计目录和 secret mount。
- MCP 与 TaurusDB 位于同 VPC 或通过受控 VPN/专线访问，默认使用私网地址和
  验证服务端证书的 TLS。
- 默认只配置数据库只读账号；mutation 账号、工具开关和外部审批密钥按需独立
  提供。

这种形态适用于单团队、单客户或单自动化会话的企业 Harness。进程隔离就是租户
隔离边界，不能在多个互不信任的用户之间复用同一个进程。

## 不属于 0.4.x 的形态

以下能力需要独立的服务端产品层，不能通过给 stdio 进程增加反向代理获得：

- 共享的远程 HTTP / Streamable HTTP endpoint；
- 多租户身份认证、服务端 RBAC 和租户级配额；
- 跨客户的连接池、凭据或会话复用；
- 控制面管理 API、高可用编排和水平扩缩容。

客户若要求上述能力，应作为后续集中式服务版本立项。0.4.x 不应宣称支持集中式
多租户部署。

## 凭据与最小权限

1. 使用 `taurusdb-mcp credentials configure` 将云身份保存到系统凭据库，或由
   容器 secret injection 提供短期凭据。
2. 数据库密码使用 `hw-csms:`、`hw-kms-file:`、系统 secret store 或只读
   secret file 引用；不得写入 Git、MCP tool 参数或 Agent 对话。
3. datasource `user` 只授予查询和所需诊断权限。
4. 只有启用 mutation 时才配置 `mutationUser`，并把权限限定到 disposable 或
   明确批准的目标库。
5. mutation approval secret 至少 32 bytes、权限为 `0600`，审批 operator 与
   发起 MCP 调用的 Agent 分离。

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
- 对 `AUDIT_FAILED`、approval denial、`SERVER_BUSY`、TLS 失败、磁盘空间不足和
  采集延迟建立告警。

审计写入失败时，MCP 返回 `AUDIT_FAILED`，调用方必须先核对数据库状态，不能盲目
重试 mutation。

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
