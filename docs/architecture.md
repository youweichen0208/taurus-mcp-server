# TaurusDB MCP 只读 Harness 架构

本文件描述 0.5.x 的当前产品边界。此前支持数据库写入的方案已归档到
[`archive/pre-readonly-architecture.md`](./archive/pre-readonly-architecture.md)，不得用于当前部署。

## 不可绕过的日常操作边界

TaurusDB MCP 的 Agent 日常操作面永不执行任意 DML、DDL、DCL 或管理命令。该边界
不依赖账号权限、旧 mutation 环境变量、审批 token 或 Agent 行为：注册表中不存在
通用数据库 mutation tool；唯一直接写入工具是精确目标绑定的回收站恢复。

```text
Agent / MCP client
        |
        +--> discovery / diagnostics / readonly query --> guardrail --> RO connection
        |
        +--> analyze_mutation_sql --> parser --> schema / EXPLAIN / safe COUNT
                                      |
                                      +--> SQL Advice (not_executed)
                                                   |
                                                   +--> human review and external execution

        +--> restore_recycle_bin_table --> readonly preflight --> native restore
                                                               |
                                                   readonly destination verification
```

`select_cloud_taurus_instance` 绑定实例后立即返回本机登录链接；`begin_sql_login` 仍可用于
重新登录。凭据通过 loopback 页面直达 MCP 进程，对 Agent 不可见，
仅保存在内存中，并受空闲与绝对 TTL 限制。连接验证只使用只读会话。

## SQL Advice 合约

`analyze_mutation_sql` 接受待评审 SQL，但绝不提交事务。它返回：

- `execution_status: not_executed`；
- 原始 SQL，以及仅对受支持、边界明确语句给出的 `advised_sql`；
- schema、EXPLAIN、索引与风险发现；
- 对简单单表 UPDATE/DELETE 安全派生的只读 `COUNT(*)`；
- `sample_rows_read: false`、假设和未验证业务规则；
- `human_review_required: true`。

初始 copy-ready 建议范围是 INSERT、有 WHERE 的单表 UPDATE/DELETE 和 CREATE
INDEX。无 WHERE 的 UPDATE/DELETE、多语句、解析失败、权限变更、全局配置和破坏性
DDL 不返回 copy-ready SQL，只返回风险说明。Advice 不是正确性保证。

## 执行与隔离

- transport 为 stdio；每个客户或会话信任边界运行独立进程；
- datasource 使用本机登录建立的短期会话账号，TLS 默认强制；
- 受控恢复工具默认可见，使用当前会话账号，只允许目标绑定的原生回收站恢复；
- 恢复前检查对象存在性和目标冲突，恢复后进行只读验证；没有有效会话凭据、审计能力
  或数据库恢复权限时 fail closed；
- 动态目标与本机登录工具默认可见，选择实例后直接签发登录链接；固定静态部署可显式
  关闭这些工具，会话目标绑定本身不授予写能力；
- 查询受超时、并发、队列、结果行列/字段/BLOB/总字节限制；
- 每次 tool 调用同步写入私有、可轮转 JSONL 审计日志；
- stdout 只承载 MCP JSON-RPC，日志进入 stderr。

历史只读决策见 [ADR-0001](./adr/0001-customer-harness-never-executes-mutation-sql.md)；
登录边界见 [ADR-0002](./adr/0002-local-credential-validation-and-expiry.md)；受控恢复
例外的原始设计见 [ADR-0003](./adr/0003-recycle-bin-restore-is-a-human-gated-exception.md)；
登录与旧恢复身份决策见 [ADR-0004](./adr/0004-instance-selection-starts-session-login.md)；
当前直接恢复决策见 [ADR-0005](./adr/0005-target-bound-direct-recycle-bin-restore.md)。
