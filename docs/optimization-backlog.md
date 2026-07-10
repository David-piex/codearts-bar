# CodeArts Bar 优化总清单

最后更新：2026-07-10  
项目路径：`C:\Users\Administrator\Desktop\codearts agent plugin`  
当前版本基线：`1.16.21` / Electron `35.7.5`  
定位：本地开源开发者工具，优先保证稳定、速度、数据准确、可维护、可诊断、可发布；自动更新、签名、账号、付费等商业闭环后置。

> 注意：`src/dashboard-renderer.js` 是构建产物，不要手改。改 `src/dashboard/**`、`src/dashboard-*.js`、`src/styles/**` 后运行 `npm run build:renderer`。

---

## 0. 当前一句话判断

项目已经不是原型阶段：托盘、Dashboard、CLI、本地 SQLite/sql.js、分页、诊断、打包、E2E、release smoke 都有基础。下一步不要继续堆功能，应该把这些主线打扎实：

1. **不卡**：最大化/resize、日期筛选、桌面端/CLI 切换、分页、会话点击都不能整页闪或卡顿。
2. **准**：缓存命中率、时间范围、时区、bucket、不同数据源聚合必须一致。
3. **稳**：数据库缺失/损坏/权限不足、CodeArts 未安装、CLI 无数据、sidecar 损坏都要有产品化诊断。
4. **好维护**：继续控制 JS/CSS/provider/main 文件体积，保持模块边界。
5. **像产品**：视觉继续向 macOS 原生开发者工具靠，信息减法，会话管理保持简单。
6. **能发布**：安装包、portable、CLI runtime、release manifest、日志、崩溃恢复、压测报告完整。

---

## 1. 优先级总览

| 优先级 | 方向 | 核心目标 | 判断标准 |
|---|---|---|---|
| P0 | 交互兜底 | 用户肉眼不闪、不乱、不丢焦点 | 日期/分页/resize/source 切换稳定 |
| P1 | 大数据性能 | 50k/100k 数据不首开卡几秒 | 热路径毫秒级，冷路径有 sidecar/进度/诊断 |
| P2 | 局部渲染 | 常规交互不重建整个 Dashboard | 固定 slot、canvas 复用、table patch |
| P3 | 结构拆分 | 长期维护不失控 | 单业务 JS 尽量 <20KB，CSS 语义化 |
| P4 | 数据准确 | 指标可解释、可复现 | fixture 覆盖缓存/时间/分页/多源 |
| P5 | 诊断中心 | 出问题能自查/复制报告 | DB、adapter、sidecar、资源、日志都有状态 |
| P6 | 视觉统一 | 像 macOS 开发者工具 | 统一 token、减少信息、空/错/加载态精致 |
| P7 | 发布闭环 | 开源用户能下载运行反馈 | build/smoke/release notes/压测报告 |
| P8 | 可选后置 | 非开源首发必需能力 | 自动更新、签名、账号、付费等暂不抢主线 |

---

## 2. 当前结构风险点

### 2.1 大文件清单

生成产物：

| 文件 | 当前体积 | 处理方式 |
|---|---:|---|
| `src/dashboard-renderer.js` | ~335KB | 构建产物，不手改；关注构建稳定与无 runtime eval |

仍需关注的业务文件：

| 文件 | 当前体积 | 优化建议 |
|---|---:|---|
| `src/dashboard.css` | ~24KB | 继续迁移到 `src/styles/*` 语义层 |
| `src/dashboard-components.css` | ~22.7KB | 控件/按钮/输入框/分段控件继续 token 化 |
| `src/dashboard-analytics.css` | ~22.2KB | 拆分析页专属样式，减少重复规则 |
| `src/dashboard-sessions.css` | ~22.1KB | 会话页 Finder/Mail 布局继续独立化 |
| `src/dashboard-compact.css` | ~22.1KB | 卡片/紧凑模式去重，避免两套样式并行膨胀 |
| `src/dashboard-controls.css` | ~22KB | 控件高度、hover、disabled、focus 统一 |
| `src/dashboard-chart.css` | ~22KB | legend/tooltip/hover 继续轻量化 |
| `src/dashboard-analytics.js` | ~21.6KB | 可继续拆 `analytics-summary/cache/source/table` |
| `src/providers/codearts/aggregation.js` | ~19.9KB | 已拆 runtime/workers，继续守住入口文件职责 |
| `src/core/aggregator.js` | ~18.5KB | 后续审计是否可拆出纯计算/格式化 |
| `src/dashboard/renderer-entry.js` | ~18.2KB | 减少全局 wiring，继续抽 bootstrap/state/events |
| `src/providers/codearts/usage-rollup-calc.js` | ~17.9KB | rollup 纯计算可继续按 bucket/model/session 拆 |
| `src/dashboard/chart/chart-canvas.js` | ~17.8KB | 拆 resize/hover/paint/axis，canvas 复用 |
| `src/dashboard/i18n.js` | ~17.2KB | 按 analytics/sessions/diagnostics/settings 拆文案 |
| `src/main.js` | ~16.5KB | 最终只保留 bootstrap，其余进入 services |
| `src/dashboard/events/session-events.js` | ~16.3KB | 会话搜索/选择/批量/动作继续拆 |
| `src/dashboard/slots/session-page-slot.js` | ~15.2KB | 保持分页和列表 patch 职责清晰 |
| `src/providers/codearts/usage-rollup.js` | ~15.2KB | 后续拆 `reader/builder/scheduler/stats` |

### 2.2 已完成但要守住

- Electron 35 接入后，App 内优先使用 `node:sqlite`；CLI 使用当前 Node 的 `node:sqlite`，不支持时 fallback `sql.js`。
- Request / Session 已有 DB 分页与 `20 / 50 / 100` 每页数量。
- 使用分析页已开始固定 slot + 局部 patch。
- `data-page-slots.js` 已拆为 `data-page-core.js`、`request-page-slot.js`、`session-page-slot.js`。
- `aggregation.js`、`aggregation-sql.js`、`usage-rollup.js` 已做过结构拆分。
- main process 已开始拆成 `tray/window/ipc/lifecycle/logger/crash-reporter`。
- 性能面板、聚合 stress、分页 stress、Electron E2E、release smoke 已有基础。
- release manifest、SHA256、RELEASE_NOTES、package resource smoke 已有基础。

---

## 3. P0：交互体验兜底

### P0.1 最大化 / resize 卡顿

涉及：
- `src/dashboard/events/window-events.js`
- `src/dashboard/chart/chart-canvas.js`
- `src/styles/layout.css`
- `src/styles/responsive-states.css`
- `tests/electron-dashboard-e2e-runner.js`

要做：
- resize burst 期间启用轻量交互状态：临时降低 `backdrop-filter`、重阴影、复杂 transition、hover 反馈。
- ResizeObserver 只记录尺寸变化，不在拖动过程中频繁全量 redraw。
- canvas 宽高没变时跳过 redraw。
- resize settle 后只补一次稳定 redraw。
- E2E 记录 `resizeStart / domPatch / chartRedraw / resizeEnd`。

验收：
- 连续 5 次 `npm run e2e:electron`，`resizePerf < 180ms`。
- 最大化/还原/拖动窗口后，布局不乱、日期弹层不溢出、图表不白屏。

### P0.2 桌面端 / CLI 切换卡顿

涉及：
- `src/dashboard/events/analytics-events.js`
- `src/dashboard/slots/analytics-slots.js`
- `src/dashboard/slots/request-page-slot.js`
- `src/dashboard/slots/session-page-slot.js`
- `src/providers/codearts/pagination.js`

要做：
- source filter 变化后只刷新 summary/chart/table/pagination 相关 slot。
- 不重建 dashboard shell，不重建 canvas 节点。
- table 只请求当前页，不回退到完整 snapshot 再前端切。
- 性能面板记录 filter、chart、table、total。

验收：
- `sourceSwitch < 50ms`。
- 切换桌面端/CLI 无整页闪烁，canvas 节点保持复用。

### P0.3 日期筛选稳定性

涉及：
- `src/dashboard-date-range.js`
- `src/dashboard/events/date-events.js`
- `src/dashboard/events/form-events.js`

要做：
- 日期弹层只维护 draft，输入过程中不刷新 dashboard。
- 只有点击“确认”才应用全局 range。
- 开始日期+开始时间、结束日期+结束时间布局固定为一行/两列，不随内容跳动。
- 输入时保留焦点、光标、错误状态。
- `end < start` 只显示轻量错误，不触发 DB 查询，不写 localStorage。
- 最大化后弹层位置仍在 viewport 内。
- 鼠标移出后取消 hover/preview 临时状态。

验收：
- 输入日期/时间不闪、不丢焦点。
- 错误范围不查 DB。
- 最大化后弹层不跑位。

### P0.4 Request / Session 分页产品化

涉及：
- `src/dashboard/slots/data-page-core.js`
- `src/dashboard/slots/request-page-slot.js`
- `src/dashboard/slots/session-page-slot.js`
- `src/providers/codearts/pagination.js`

要做：
- Request / Session 分页结构统一。
- 每页数量只保留 `20 / 50 / 100`。
- 支持跳到第 N 页。
- 页码为空保持当前页；小于 1 回到第一页；超过最大页 clamp 到最后一页并回写。
- 筛选变化自动回第一页。
- 翻页只 patch `tbody` 和 pagination slot。
- 空数据隐藏无意义分页，只显示空状态。
- 空页自动回退最后一页。

验收：
- `requestPage < 80ms`，`sessionPage < 80ms`。
- 两个列表分页行为完全一致。

### P0.5 托盘 / 最小化 / 右键菜单

涉及：
- `src/main/tray.js`
- `src/main/window.js`
- `src/main/lifecycle.js`

要做：
- 明确关闭、最小化、隐藏到托盘三种状态。
- 最小化到托盘后右键菜单始终可用。
- 版本号统一来自 `package.json` 或 version provider。
- 防止重复创建 tray 和重复绑定菜单事件。
- 菜单中文化：打开面板、刷新、诊断、设置、退出。

验收：
- 启动、隐藏、右键、重新打开、退出都稳定。
- 无多个托盘图标，无重复触发。

---

## 4. P1：大数据性能

### P1.1 sidecar / rollup 继续下沉

现状：热路径已经较快，瓶颈是 50k/100k 冷聚合和首次 sidecar 构建。

要做：
- 增加/完善 `daily_usage_rollup`、`model_usage_rollup`、`source_usage_rollup`、`session_usage_rollup`。
- sidecar 构建状态显示到诊断中心：构建中、行数、耗时、失败原因、下次重建原因。
- sidecar invalid/corrupt/rebuilding 时不阻塞 dashboard 打开，后台重建。
- compact JSON 继续减少大 payload 深拷贝。

验收：
- 50k hot dashboard bundle `<300ms`。
- 100k hot dashboard bundle `<500ms`。
- sidecar 损坏时自动忽略并后台重建。

### P1.2 减少重复 `json_extract`

涉及：
- `src/providers/codearts/aggregation-sql.js`
- `src/providers/codearts/aggregation-sql-expressions.js`
- `src/providers/codearts/usage-rollup-calc.js`

要做：
- token rows 展开一次后复用。
- summary/trend/source/model 共享 token CTE 或 rollup 结果。
- native `node:sqlite` 和 `sql.js` 共享 SQL 表达式定义。
- 高频时间范围建立边界缓存。

验收：
- 100k 下 `modelStats` 不再明显拖慢。
- `dashboardBundle` 不明显慢于单项聚合之和。

### P1.3 多数据源分页 k-way merge

涉及：
- `src/providers/codearts/pagination.js`
- `src/providers/codearts/sources.js`

要做：
- 多源分页不要每个源都取 `offset + limit` 后统一切片。
- 按时间排序做 k-way merge。
- 过滤条件先下推到每个源。
- 每个源只读必要窗口。

验收：
- 多源 50k/100k 翻页 `<80ms`。
- 内存不随总记录数线性增长。

### P1.4 SQLite adapter 可观测

要做：
- CLI/App 都记录当前 adapter：`node:sqlite` 或 `sql.js`。
- `src/cli.js self-test` 覆盖 fallback。
- package smoke 确认 `sql-wasm.wasm` 在包内。
- 诊断报告显示 adapter，但不泄露敏感完整路径。

验收：
- Electron 内优先 `node:sqlite`。
- 低版本 Node CLI 自动 fallback `sql.js`。
- 用户能从诊断里看到当前走哪条路径。

---

## 5. P2：局部渲染和交互性能

### P2.1 固定 Dashboard 骨架

目标：常规交互不再重建 `app.innerHTML`。

建议固定 slot：

```text
summarySlot
chartSlot
requestTableSlot
requestPaginationSlot
sessionTableSlot
sessionInspectorSlot
advancedSlot
diagnosticsSlot
```

要做：
- source 切换只刷相关 slot。
- 日期确认只刷受影响 slot。
- 图表 canvas 尽量保留。
- request 翻页只 patch rows。
- session 点击只刷新 inspector。
- 固定/归档只 patch 当前 row。
- 搜索 debounce 后只刷新 table slot，并保持输入框焦点。

### P2.2 图表 hover / tooltip 独立

涉及：
- `src/dashboard/chart/chart-canvas.js`
- `src/dashboard/chart/chart-hover.js`
- `src/dashboard/chart/chart-tooltip.js`
- `src/dashboard/chart/chart-series.js`
- `src/dashboard/chart/chart-legend.js`

要做：
- hover 只更新 overlay/tooltip。
- tooltip 单独 DOM，不触发 dashboard render。
- 图表数据计算和绘制分离。
- resize settle 后再 redraw。
- legend 交互不触发整页更新。

### P2.3 会话管理局部渲染

涉及：
- `src/dashboard/slots/session-slots.js`
- `src/dashboard/sessions/session-table.js`
- `src/dashboard/sessions/session-inspector.js`
- `src/dashboard/events/session-events.js`

要做：
- 点击会话只更新右侧详情。
- 多选只更新 bulk toolbar。
- 固定/归档只 patch 当前行。
- 搜索只刷新 table slot。
- 保持滚动位置和输入框焦点。
- 会话管理只保留：看到、搜索、固定、保存视图、打开、复制、归档/恢复。

---

## 6. P3：结构继续拆分

### P3.1 Provider / 聚合层

当前已拆：

```text
src/providers/codearts/aggregation.js
src/providers/codearts/aggregation-runtime.js
src/providers/codearts/aggregation-workers.js
src/providers/codearts/aggregation-sql.js
src/providers/codearts/aggregation-sql-expressions.js
src/providers/codearts/usage-rollup.js
src/providers/codearts/usage-rollup-calc.js
```

下一步建议：

```text
src/providers/codearts/rollup/
  builder.js
  reader.js
  scheduler.js
  stats.js
  compact.js
  cache-file.js
```

目标：聚合、sidecar、cache、诊断互不混杂，单文件继续保持在 15-20KB 以下。

### P3.2 Renderer / 事件层

下一步建议：

```text
src/dashboard/runtime/
  state.js
  scheduler.js
  perf.js
  slots.js
  bootstrap.js

src/dashboard/events/
  analytics-events.js
  session-events.js
  date-events.js
  form-events.js
  chart-events.js
  window-events.js
```

目标：事件只做分发和轻量协调，业务逻辑回到对应模块。

### P3.3 i18n 拆分

当前 `src/dashboard/i18n.js` 已经接近 17KB，继续增长会难维护。

建议：

```text
src/dashboard/i18n/
  core.js
  analytics.js
  sessions.js
  diagnostics.js
  settings.js
```

目标：所有用户可见文案从 i18n 走；Dashboard/Settings/Tray 无乱码、无不该出现的英文残留。

### P3.4 CSS 语义层继续迁移

已有：

```text
src/styles/tokens.css
src/styles/base.css
src/styles/layout.css
src/styles/controls.css
src/styles/analytics.css
src/styles/sessions.css
src/styles/chart.css
src/styles/tables.css
src/styles/popover.css
src/styles/responsive.css
```

继续做：
- 历史 CSS 的重复规则迁移进语义层。
- 圆角、阴影、颜色、控件高度全部走 token。
- 禁止新增临时魔法值。
- 单个 CSS 文件长期目标 `<15KB`。

### P3.5 main process 服务化

当前 `src/main.js` 已明显收敛，但还可以继续只保留 bootstrap。

建议：

```text
src/main/services/
  refresh-service.js
  db-watch-service.js
  dashboard-snapshot-service.js
  official-stats-service.js
```

目标：窗口、托盘、IPC、生命周期、日志、崩溃恢复、刷新服务职责清晰。

---

## 7. P4：数据准确性

### P4.1 缓存命中率校准

需要用真实匿名 fixture 校验公式：

```text
cacheHitRate = cacheRead / (input + cacheRead)
```

必须确认：
- `input` 是否已经包含 cached input。
- `total` 是否包含 cacheRead/cacheWrite。
- `cacheWrite` 是否应该进入可复用 prompt 基数。
- 不同 provider/model 字段语义是否一致。

如果语义不完全等同“命中率”，UI 应改名为“缓存覆盖率”，并显示计算基数。

### P4.2 时间范围、时区和 bucket

要做：
- 所有 DB 查询统一时间字段。
- 明确 start/end 是否包含边界。
- trend bucket 跨天、跨月、DST 不错位。
- UI 展示和 DB 筛选使用同一时区策略。
- 日期控件、分页、source、chart 的查询参数一致。

验收：
- 有跨天、跨月、空范围、反向范围 fixture。
- 筛选后的 summary/trend/table 数字一致。

### P4.3 多数据源一致性

要做：
- CLI/桌面端字段归一化。
- 同一条请求不要重复计数。
- source 切换、all source、单 source 的 totals 可解释。
- 会话统计和请求统计口径一致。

---

## 8. P5：诊断中心产品化

涉及：
- `src/providers/codearts/diagnostics.js`
- `src/dashboard/dashboard-diagnostics.js`
- `src/main/ipc-dashboard.js`
- `tests/database-diagnostics-smoke.js`

必须覆盖：
- 数据库不存在。
- 数据库损坏。
- 权限不足。
- CodeArts 未安装。
- CLI 数据源为空。
- 桌面端数据源为空。
- sidecar cache 损坏/过期/构建中。
- package resource 缺失，例如 `sql-wasm.wasm`。
- `node:sqlite` 不可用并 fallback `sql.js`。
- crash/logs 路径和最近错误。

建议诊断摘要结构：

```js
{
  status: 'ok' | 'warn' | 'bad',
  adapter: 'node:sqlite' | 'sql.js',
  fallbackActive: false,
  sourceCount: 2,
  readableSources: 2,
  missingSources: [],
  emptySources: [],
  sidecar: {
    enabled: true,
    hitRate: 0.92,
    pendingCount: 0,
    lastBuildMs: 120,
    lastBuildStatus: 'ok'
  },
  resources: {
    sqlWasm: { exists: true }
  }
}
```

要求：
- 不显示普通网页式报错。
- 给用户明确原因和下一步。
- 支持复制诊断报告。
- 复制报告要脱敏，不泄露 prompt、完整数据库路径等敏感内容。

---

## 9. P6：视觉统一和信息减法

### P6.1 首页信息减法

首页只保留：
- 总 Token。
- 缓存命中率/缓存覆盖率。
- Agent idle。
- 趋势图。
- 请求概览。

其他放到高级区域、诊断中心、会话管理页或二级 tab。

### P6.2 会话管理保持简单

核心能力：
- 看到。
- 搜索。
- 固定。
- 保存视图。
- 打开。
- 复制。
- 归档/恢复。

不要塞复杂分析图表，不重复 Dashboard 指标。方向像 Finder/Mail：左列表，右详情。

### P6.3 macOS 原生开发者工具质感

要做：
- 减少大面积蓝色按钮。
- hover 更轻，不用重阴影。
- 表格线更淡，行高更克制。
- 卡片阴影统一。
- toolbar 更像 segmented control。
- 日期弹层、性能面板、诊断面板更像 macOS popover。
- 空状态、错误状态、加载状态产品化。
- 控件高度统一：按钮、输入框、筛选器、分页器。

目标不是更花，而是更轻、更稳、更像系统应用。

---

## 10. P7：开源发布闭环

### P7.1 release 产物

已有基础：
- `electron-builder`。
- NSIS / portable。
- CLI resources 构建。
- release manifest。
- SHA256SUMS。
- RELEASE_NOTES。
- package smoke。

继续做：
- installer / portable 都跑 smoke。
- 版本号来源统一。
- release notes 自动包含重要变更、已知问题、hash。
- README 写清 CLI runtime / `sql.js` fallback。
- README 写清数据只在本地读取，不上传。

### P7.2 崩溃恢复和异常日志

要做：
- 本地日志目录固定。
- Dashboard 能打开/复制最近错误。
- 启动失败显示简洁诊断窗口。
- DB 损坏、权限问题、资源缺失有可读提示。
- 日志脱敏，不记录 prompt 内容。

### P7.3 首次启动引导

要做：
- 首次打开说明数据来源。
- 未检测到 CodeArts/CLI 时给出下一步。
- 数据为空时显示空状态，不展示一堆 0 指标。
- 告诉用户如何打开 Dashboard、设置、导出诊断。

### P7.4 真实用户数据压测报告

标准数据组：

```text
1k requests
10k requests
50k requests
100k requests
1k sessions
10k sessions
```

每组记录：
- 首屏时间。
- source 切换时间。
- 日期筛选时间。
- 翻页时间。
- 最大化/resize 时间。
- 内存占用。
- sqlite adapter。
- sidecar 构建时间和命中状态。

---

## 11. P8：可选后置，不抢开源主线

这些后置，不要影响当前开源本地工具主线：

- 整项目改 SwiftUI。
- 自动更新。
- 代码签名。
- 账号体系。
- 付费授权。
- 服务端崩溃上报。
- 复杂云同步。
- 继续堆新图表。

原因：当前目标是开源给开发者使用，真正影响口碑的是“打开快、数据准、可诊断、好维护、能稳定发布”。自动更新、签名、账号、付费这类能力只有在后续做商业分发或企业环境要求时再补，不应该占用当前性能和稳定性主线。

---

## 12. 推荐执行顺序

### 第一轮：交互兜底

1. 日期筛选最终稳定：不闪、不丢焦点、错误输入不查 DB、最大化不溢出。
2. 最大化/resize 继续优化：compositor 降级、canvas skip redraw、E2E marks。
3. Request/Session 分页体验统一：20/50/100、跳页、clamp、空页回退。
4. 托盘右键、版本显示、最小化恢复。
5. 中文和乱码清理。

### 第二轮：大数据性能

1. daily/model/source/session rollup。
2. sidecar 构建状态可视化。
3. 减少重复 `json_extract`。
4. adapter/fallback 可观测。
5. 多数据源分页 k-way merge。

### 第三轮：结构拆分

1. 诊断中心产品化：adapter、sidecar、DB 健康、资源缺失。
2. chart hover/tooltip/resize 继续拆。
3. i18n 拆分。
4. CSS 语义迁移和 token 化。
5. main process 服务化。

### 第四轮：视觉统一

1. 首页信息减法。
2. 会话管理 Finder/Mail 化。
3. 控件高度、圆角、阴影、hover 统一。
4. 空/错/加载状态产品化。

### 第五轮：发布闭环

1. release smoke 完整化。
2. 崩溃恢复和日志。
3. 首次启动引导。
4. README/release notes/hash。
5. 真实用户数据压测报告。

---

## 13. 性能预算

| 场景 | 预算 |
|---|---:|
| Source 切换 | `<50ms` |
| Request 翻页 | `<80ms` |
| Session 翻页 | `<80ms` |
| Resize / 最大化 | `<180ms` |
| 日期确认应用 | `<120ms` |
| 会话点击详情刷新 | `<80ms` |
| 10k 聚合热路径 | `<180ms` |
| 50k 聚合热路径 | `<300ms` |
| 100k 聚合热路径 | `<500ms` |

先作为 warning，稳定后再变成 CI 失败条件。

---

## 14. 每轮验证命令

普通开发后：

```powershell
npm run build:renderer
npm test
npm run e2e:electron
git diff --check
```

性能相关改动后：

```powershell
npm run stress:pagination
npm run stress:aggregation
npm run stress:aggregation:full
```

发布相关改动后：

```powershell
npm run build:app
npm run smoke:release
npm run smoke:package-resources
```

---

## 15. 最近一轮最短 TODO

如果只安排下一轮，建议就做这 5 件：

1. **日期筛选 E2E 补强**：输入不闪、不丢焦点、错误范围不查 DB、最大化不溢出。
2. **最大化/resize 继续降 jank**：resize burst 降 compositor 成本，canvas 尺寸未变不 redraw。
3. **诊断中心产品化**：adapter、sidecar、DB 健康、缺失资源、日志状态统一展示并可复制脱敏报告。
4. **50k/100k 冷聚合优化**：rollup 进一步下沉，减少重复 `json_extract`，显示 sidecar 构建状态。
5. **视觉减法**：首页只留总 Token、缓存、Agent idle、趋势、请求概览；会话管理只做会话管理。
