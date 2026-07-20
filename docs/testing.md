# TaurusDB MCP 测试指南

当前测试目标是证明“日常只读能力可用，任何配置都不能开启通用写库；唯一恢复例外
必须经过目标绑定的本机人工审批”。旧通用写入流程测试文档
保存在 [`archive/pre-readonly-testing.md`](./archive/pre-readonly-testing.md)，仅供历史审计。

## 自动化门禁

```bash
npm ci
npm run check
npm test
npm audit --omit=dev --audit-level=high
npm run pack:check
```

必须验证：

- 默认 tools/list 包含 `analyze_mutation_sql` 和受控恢复申请/状态工具，不包含通用写入
  或直接恢复工具；
- 设置旧 mutation 环境变量后，工具表保持不变；
- UPDATE Advice 返回 `not_executed`、`human_review_required`，且不会调用 mutation executor；
- 无 WHERE 的 UPDATE/DELETE 不返回 `advised_sql`；
- 简单单表 UPDATE/DELETE 只运行安全派生的 `COUNT(*)`，不读取样本业务行；
- 登录凭据不进入 tool 参数、Agent 输出、日志或审计明文字段；
- 跨 database、解析失败、多语句和带副作用的只读语句 fail closed；
- 并发、队列、结果字节上限和审计轮转满足
  [规模验证](./scale-validation.md)。
- `prepare_recycle_bin_restore` 只做只读预检；缺少登录建立的浏览器会话、错误对象、
  目标冲突、过期/复用链接、错误短语和跨域请求均不执行恢复；成功后
  目标只读验证和操作人审计完整。

## 真实 MySQL / TaurusDB 证明

真实数据库门禁必须记录目标版本、TLS cipher、只读授权和精确构建版本。准备一条状态
已知的测试记录，调用 `analyze_mutation_sql` 分析会改变该记录的 UPDATE，然后在同一
只读会话重新查询：值必须完全不变，Advice 的匹配行数应与只读 COUNT 一致。

随后运行 `npm run cloud:validate` 验证 TaurusDB 身份、发现、只读查询、EXPLAIN、
能力探测与诊断。可选恢复 gate 只能使用 externally-created disposable 表，绝不能对
生产表执行 DROP 或其他 mutation smoke test。
