# CodeArts Bar 优化路线图

最后更新：2026-07-15

适用版本：`1.16.34`

项目定位：本地优先的开发者使用分析工具，覆盖 Electron、VS Code、JetBrains 和 CLI。

> `src/dashboard-renderer.js` 与 `src/dashboard-bundle.css` 是构建产物。界面改动应修改源模块后执行 `npm run build:renderer`。

## 当前判断

项目已经进入可发布、可维护阶段。当前最重要的资产不是单个界面，而是四端共享的数据契约：数据源发现、请求归一化、Token 聚合、时间筛选、分页、缓存和诊断必须给出同一组含义。

下一阶段不优先增加图表或管理功能，重点是：

1. 用真实数据库持续对账统计口径。
2. 改善大数据库首次 rollup 构建体验。
3. 守住跨端筛选、刷新稳定性和隐私边界。
4. 让跨平台构建从“配置可用”走向“持续绿灯”。

## 1.16.33 已落地的基线

| 方向 | 当前状态 | 必须守住的契约 |
|---|---|---|
| 完整聚合 | 已完成 | 模型、来源、趋势和总量来自完整合格请求集合，不从截断的 `requestLog` 反推 |
| Placeholder | 已完成 | 无 Token、无错误、无完成时间且无 `step-finish` 的 assistant 占位行不计请求；错误行和有效 part 仍保留 |
| Token 归一化 | 已完成 | 支持 message/part、嵌套/顶层、camelCase、snake_case、OpenAI/Anthropic usage 别名，保留 `cacheRead`/`cacheWrite` |
| P95 | 已完成 | 趋势和模型使用真实第 95 百分位，不再以最大值代替；多源合并按样本计算 |
| 时间范围 | 已完成 | 统一使用 `[start, endExclusive)`，本地日历日和 DST 由统一范围逻辑处理 |
| Canonical quota | 已完成 | 顶层 `status`/`quota` 始终描述当前全来源、全模型本地视图，不随历史/来源/模型筛选变化 |
| 跨端筛选 | 已完成 | Electron、VS Code、JetBrains 和 CLI 分离“当前状态”与“筛选区间统计” |
| 请求/会话分页 | 已完成 | 数据库分页为历史明细主路径；多源使用 k-way merge，只 hydrate 当前页 |
| Snapshot 语义 | 已完成 | 截断列表显式携带 complete/sampled、历史总数和 scope，不能冒充完整历史 |
| 隐私与只读 | 已完成 | SQL.js 只读、诊断脱敏、协议不暴露数据库路径或原始异常 |
| JetBrains runtime | 已完成 | native/sql.js 查询契约一致，bundle 由 `<127000` 字节门禁约束 |
| 跨平台 CI | 已配置 | macOS/Linux 执行测试、无签名构建、资源 smoke 和 artifact 上传；仍需持续获得真实绿灯 |
| 100k 热路径 | 已完成 | sidecar 解析与规范化进程内复用，native/sql.js 热路径最大值分别为 140.2ms/165.2ms |

## 数据边界

```text
本地 SQLite / 日志
        ↓
source discovery + meaningful assistant filtering
        ↓
message / part Token 归一化
        ↓
SQL 聚合 / usage rollup / P95 / k-way pagination
        ↓
query protocol
        ↓
Electron / VS Code / JetBrains / CLI
```

- `usage.range`、趋势、模型和来源统计跟随用户筛选。
- `status`、`quota` 和当前健康状态来自 canonical 当前摘要。
- `requestLog` 可以是样本；完整历史必须走数据库分页。
- 本地 `dailyLimit` 是显示软上限，不是 CodeArts 官方计费或额度。

## 下一阶段

### P0：真实数据对账

- 建立脱敏真实样本，覆盖 message usage、`step-finish`、缓存字段、错误、旧字段和正在生成的回复。
- 对 Electron、CLI、VS Code、JetBrains 的同范围总量、请求数、模型和来源做自动对账。
- 对零 Token assistant、错误请求和 placeholder 给出可解释的诊断计数。

验收：同一 fixture、同一筛选、同一时区下四端数字一致。

### P1：首次聚合体验

- 为首次 rollup 构建提供明确状态、耗时阶段和失败原因。
- 保证冷路径不会阻塞窗口交互；失败后可退回直接 SQL 并后台重建。
- 继续缩短 50k/100k 首次聚合；当前合成数据基线已记录，脱敏多版本真实样本仍需扩充。

验收：热路径继续受门禁保护；冷路径有进度、有诊断、可恢复。

### P2：发布与平台

- 让 macOS/Linux workflow 在手动触发和 tag 场景持续通过。
- 补真实平台 artifact smoke；签名、公证和自动更新仍作为后置能力。
- 继续守住 renderer、CSS 和 JetBrains bundle 体积门禁。

### P3：维护成本

- 避免在 snapshot、聚合、分页和客户端各自复制统计规则。
- 将 scope、完整性和 canonical/filtered 区别保留在协议中。
- 删除已完成的旧任务，不以继续拆文件代替真实复杂度下降。

## 每轮验证

```powershell
npm test
npm run e2e:electron
npm run e2e:vscode
npm run stress:pagination
npm run stress:aggregation
git diff --check
```

JetBrains 相关改动额外运行：

```powershell
node tests/jetbrains-payload-smoke.js
node tests/jetbrains-cli-runtime-smoke.js
npm run build:jetbrains
```

跨平台状态以 CI 的 macOS/Linux 实际结果为准，不能用 Windows 本机构建替代。
