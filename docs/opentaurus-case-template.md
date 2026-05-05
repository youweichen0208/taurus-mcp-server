# OpenTaurus 验证案例模板

> 用法：每完成一次本地或云端验证，就复制一份这个模板。
>
> 目标不是记流水账，而是把验证结果直接沉淀成网站案例、文档案例和演示素材。

---

## 1. 基本信息

- Case 名称：
- 日期：
- 环境：
  - `local mysql` / `cloud taurusdb`
- datasource / profile：
- 相关实例：
- 验证人：

## 2. 场景与症状

- 用户看到的问题是什么：
- 影响是什么：
- 是否为真实线上现象 / 测试复现：
- 触发时间窗口：

网站短句模板：

```text
<一句话描述问题场景>
```

示例：

```text
早高峰接口超时，但 QPS 没明显上涨。
```

## 3. OpenTaurus 调用链

按顺序记录你实际调用的 MCP Tool 或 CLI 命令。

```text
1.
2.
3.
4.
```

示例：

```text
1. taurusdb mcp smoke --profile prod-ro
2. taurusdb runbook latency --since 15m --report latency.md
3. taurusdb mcp call diagnose_slow_query --input slow-query.json
4. taurusdb mcp call show_processlist --input processlist.json
```

## 4. 关键证据

至少写 3 条。

- 证据 1：
- 证据 2：
- 证据 3：

示例：

- `diagnose_service_latency` 返回 slow SQL + connection buildup
- `diagnose_slow_query` 命中 scan-heavy digest，rows_examined 明显偏高
- `show_processlist` 显示 app_user idle/active session 堆积

## 5. 诊断结论

- 根因候选：
- 最终判断：
- 置信度：
- 还有哪些限制：

## 6. 修复动作

- 执行了什么修复：
- 修复是否回滚友好：
- 是否涉及 schema / 参数 / 权限 / 云配置：

## 7. 修复后验证

- 再次执行的命令：
- 修复后恢复了什么：
- 还有什么残留问题：

## 8. 截图清单

每个案例尽量留 5 张图。

### S1 症状截图

- 文件名：
- 内容：

### S2 OpenTaurus 主结论截图

- 文件名：
- 内容：

### S3 深入证据截图

- 文件名：
- 内容：

### S4 修复动作截图

- 文件名：
- 内容：

### S5 修复后验证截图

- 文件名：
- 内容：

建议命名：

```text
website-assets/cases/<case-slug>/01-symptom.png
website-assets/cases/<case-slug>/02-main-diagnosis.png
website-assets/cases/<case-slug>/03-evidence.png
website-assets/cases/<case-slug>/04-fix-action.png
website-assets/cases/<case-slug>/05-post-verify.png
```

## 9. 脱敏检查

截图前检查：

- host
- IP
- instance id
- project id
- node id
- access key / token
- 业务库名 / 表名是否需要脱敏
- SQL 字面量是否含敏感值
- 用户名是否含真实业务身份

## 10. 网站摘要

### 首页 1 句话版本

```text
<25 字以内>
```

### 首页 2-3 行版本

```text
<60-90 字>
```

### 案例页完整版

```text
<120-180 字，讲清楚症状 -> 证据 -> 修复 -> 验证>
```

## 11. 页面映射

这一条案例最后打算放在哪里：

- 首页 feature band：
- 首页 cases 区：
- 独立案例页：
- 文档页：

## 12. 推荐优先级

优先先做这几类案例：

1. `mcp smoke` 成功
2. `cloud validate` 成功
3. `list_taurus_features` / `explain_sql_enhanced`
4. `diagnose_service_latency`
5. `diagnose_slow_query`
6. `diagnose_lock_contention`

等你开始真实验证后，把第一组截图和命令结果填进这个模板，我就可以继续帮你把它们收进网站。 
