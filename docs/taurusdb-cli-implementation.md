# 华为云 TaurusDB 数据面 CLI — 实施计划

> 本文档聚焦 `@huaweicloud/taurusdb-cli` 的第一阶段目标，而不是完整的长期形态。
>
> 配套阅读：
>
> - [`architecture.md`](./architecture.md)
> - [`taurusdb-mcp-implementation-plan.md`](./taurusdb-mcp-implementation-plan.md)

---

## 1. 文档定位

CLI 不是“把 MCP 再包一层”，而是一个直接复用 `core` 的人类终端前端。

当前这份计划只保留三个问题：

- CLI 第一阶段先做什么
- CLI 和 `core` 的边界是什么
- 哪些交互形态延后，不再混进首版

## 2. 当前状态

当前 `packages/cli` 还没有进入真实实现阶段，只有一个脚手架入口：

```text
packages/cli/src/index.ts
```

当前行为是直接输出 “scaffolded but not implemented yet” 并退出。

所以这份文档描述的是**第一阶段目标命令面**，不是现有完成度的夸大描述。

## 3. 第一阶段范围

CLI 第一阶段只做命令模式，不做 REPL / AI / doctor。

### 3.1 通用命令

- `taurusdb sources`
- `taurusdb databases`
- `taurusdb tables`
- `taurusdb describe`
- `taurusdb sample`
- `taurusdb query`
- `taurusdb exec`
- `taurusdb explain`
- `taurusdb status`
- `taurusdb cancel`
- `taurusdb init`

### 3.2 TaurusDB 专属命令

- `taurusdb features`
- `taurusdb explain+`
- `taurusdb flashback`

### 3.3 第一阶段明确不做

- `taurusdb repl`
- `taurusdb ask`
- `taurusdb agent`
- `taurusdb doctor`
- recycle bin 命令
- history / binlog / preflight 命令

## 4. 对 `core` 的依赖边界

CLI 第一阶段必须完全建立在 `TaurusDBEngine` 之上。

CLI 需要的 core 能力：

- `listDataSources`
- `resolveContext`
- `listDatabases`
- `listTables`
- `describeTable`
- `sampleRows`
- `inspectSql`
- `explain`
- `explainEnhanced`
- `executeReadonly`
- `executeMutation`
- `getQueryStatus`
- `cancelQuery`
- `getKernelInfo`
- `listFeatures`
- `flashbackQuery`
- `issueConfirmation`
- `validateConfirmation`
- `handleConfirmation`

CLI 不应该自己复制：

- SQL 分类规则
- Guardrail 逻辑
- capability probe
- execution / tracker / cancel path

## 5. CLI 自己负责什么

这些能力必须留在 `packages/cli`：

- 参数解析与命令分发
- 人类可读输出
- `json/csv` 格式输出
- terminal confirmation 提示
- 退出码约定
- 本地命令帮助文案

关键点是：如果未来要做交互式确认，CLI 也应该是**包装 token confirmation**，而不是重新把终端交互逻辑注入 `core`。

## 6. 建议目录结构

第一阶段建议从最小结构开始，不要一开始就铺开 REPL / AI / provider：

```text
packages/cli/src/
├── index.ts
├── bootstrap.ts
├── commands/
│   ├── sources.ts
│   ├── databases.ts
│   ├── tables.ts
│   ├── describe.ts
│   ├── sample.ts
│   ├── query.ts
│   ├── exec.ts
│   ├── explain.ts
│   ├── status.ts
│   ├── cancel.ts
│   ├── init.ts
│   └── taurus/
│       ├── features.ts
│       ├── explain-plus.ts
│       └── flashback.ts
└── formatter/
    ├── human.ts
    ├── json.ts
    └── csv.ts
```

等命令模式稳定后，再决定是否需要：

- `repl/`
- `agent/`
- `ui/`

## 7. 分阶段实施

### C0

- 建立 `package.json`
- 建立 `index.ts`
- 建立 `bootstrap.ts`
- 打通 `cli -> core`

### C1

- 落地只读命令：
  - `sources`
  - `databases`
  - `tables`
  - `describe`
  - `sample`
  - `query`
  - `explain`

### C2

- 落地写命令与生命周期命令：
  - `exec`
  - `status`
  - `cancel`
- 落地 token-based terminal confirmation

### C3

- 落地 TaurusDB 专属命令：
  - `features`
  - `explain+`
  - `flashback`

## 8. 完成标准

满足以下条件，可认为 CLI 第一阶段完成：

- 命令模式建立在同一份 `TaurusDBEngine` 上
- 不复制 MCP 或 core 的业务逻辑
- 只读命令、写命令、status/cancel 命令可用
- TaurusDB 三个专属命令可用
- 文档不再把 REPL / AI / doctor 写成首阶段已交付能力

## 9. 后续阶段

后续再考虑：

1. REPL
2. AI ask / agent
3. doctor
4. recycle bin / history / binlog 类命令

顺序建议是先把命令模式打稳，再考虑会话模式和 AI 编排。
