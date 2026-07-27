# CodeArts Bar 性能架构

最后更新：2026-07-27

适用版本：`1.16.43`

## 目标

性能架构同时解决三个问题：统计必须完整、交互必须稳定、客户端不能因为完整历史而加载无限列表。任何优化都不能改变数据含义或隐私边界。

## 数据路径

```text
SQLite / WAL snapshot / usage logs
        ↓
source discovery + readonly adapter
        ↓
meaningful assistant filtering
        ↓
message/part Token normalization
        ↓
SQL aggregate / usage rollup / worker pagination
        ↓
QueryService / Query Protocol v1
        ↓
Electron / VS Code / JetBrains / CLI
```

### 合格请求

统计对象是有意义的 assistant 请求。以下条件同时成立时视为 placeholder 并排除：

- Token 为 0；
- 没有错误；
- 没有完成时间；
- 没有 `step-finish` part。

错误请求和只有 part usage 的有效请求必须保留。JS 聚合、native SQL、sql.js、分页和 rollup 使用同一口径。

### 完整聚合与列表样本

- summary、trend、model、source 和 provider 统计来自完整合格请求集合。
- Dashboard 请求/会话历史走数据库分页。
- snapshot 的 `requestLog` 允许截断，但必须带 `historicalRequestTotal`、complete/sampled 和 scope 元数据。
- 客户端不得用截断列表重新计算完整模型或来源统计。

### P95

- P95 使用真实第 95 百分位，不以最大值代替。
- 模型和趋势跨数据源合并时保留内部 latency 样本，再计算合并后的 percentile。
- 内部样本不进入客户端 payload。

## Canonical 与筛选视图

性能路径明确分开两类数据：

| 数据 | 来源 | 是否跟随历史/来源/模型筛选 |
|---|---|---|
| `status` / `quota` / 当前 health | canonical 当前全来源摘要 | 否 |
| `usage.range` / trend / model / source | 当前查询 scope | 是 |
| 请求/会话页 | 数据库分页 scope | 是 |

这样刷新历史范围时不会把过去某天的 Token 当成“今日软上限”，也不会让实时刷新覆盖用户当前筛选。

## 聚合和缓存

- `node:sqlite` 是可用时的首选只读 adapter，`sql.js` 是兼容 fallback。
- SQL 路径负责 summary、趋势、模型、来源和 session summary。
- 无 rollup 的冷路径在聚合 Worker 中执行 SQL 汇总，只返回合并统计与 latency/首内容/输出速度所需样本，不再构造完整 `performanceRows` 对象集合。
- usage rollup 保存完整 Token/session 汇总和紧凑小时 bucket。
- rollup miss 可直查 SQL，并在后台重建；缓存命中不能改变 scope 或完整性。
- sidecar 文件按文件签名在进程内复用解析结果；数据库指纹或 sidecar 变化会立即使缓存失效。
- 纯 token 摘要不复制延迟样本；趋势与模型仍保留原始样本并计算精确 P95。
- 慢查询和 fallback 只记录脱敏诊断。
- 首次全库统计仍需要 O(N) 扫描；当前优化目标是隔离调用线程、降低对象化和复用 sidecar，而不是声称消除必要扫描。

## 分页

- public Request、Session 和单会话 Request 分页统一进入 native/sql.js Worker Pool，调用线程不直接执行同步 SQLite 查询。
- 单源分页在 Worker 内执行 `limit/offset`；direct native API 仅供 Worker 与一次性 CLI 调用。
- 多源分页使用 k-way merge，每个源分批读取，跳过 offset 后只 hydrate 当前页，不把超大 session 全部加载到调用进程。
- Request 和 Session 都返回 total、hasMore、strategy 和必要诊断。
- 完整历史分页不依赖 snapshot 列表长度。

## Renderer 与刷新

- 首屏先加载轻量摘要，再异步补趋势、模型和分页内容。
- 固定 slot 局部更新，避免筛选或实时刷新重建整个界面。
- generation/scope key 阻止旧请求覆盖新筛选。
- resize、zoom 和视图切换期间降低 blur、阴影和动画成本，canvas 尺寸不变时跳过重绘。
- 开发构建使用 ESM 与外部 Source Map，筛选、分页和图表状态位于独立源模块；生产构建保持单文件资源，避免 Electron/VS Code 运行时增加模块加载请求。

## IDE 与 CLI runtime

- VS Code 详情查询同时保留 canonical 当前摘要和 filtered range。
- JetBrains 将 dashboard 当前状态与 analytics 历史查询分开。
- `QueryService` 统一聚合、诊断和分页方法映射，客户端不直接绑定具体 SQLite adapter。
- JetBrains 内嵌 CLI runtime 由 7 个 manifest 校验的 JavaScript 文件组成；查询入口受 `138000` 字节门禁、runtime JS 总量受 `1275000` 字节门禁保护。
- Query Protocol v1 是跨端稳定边界；客户端应忽略新增字段，但不能忽略 scope 和完整性语义。

## 跨平台构建

macOS/Linux workflow 当前包含：

1. `npm ci` 与 `npm test`；
2. renderer、CLI、app resources 构建；
3. 无签名 Electron artifact；
4. asar/resource smoke；
5. artifact 上传。

该 workflow 证明构建就绪度，不等同于签名、公证或完整实机回归。

## 验证入口

```powershell
npm test
npm run stress:pagination
npm run stress:aggregation
npm run e2e:electron
npm run e2e:vscode
node tests/jetbrains-cli-runtime-smoke.js
```

当前剩余的主要性能风险是无 rollup 时首次 O(N) 数据库扫描和 SQL.js 冷启动，而不是同步分页、热路径或局部渲染。历史与 `1.16.43` 增量基线见 `performance-stress-results.md`；比较结果时必须区分版本、adapter、冷热状态和硬件环境。
