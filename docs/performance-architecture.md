# Performance Architecture

本文档记录 CodeArts Bar 当前的性能策略和后续优化方向。

## 当前性能路径

### 启动和刷新

Dashboard 首屏优先使用轻量路径：

- `dashboard:getAggregates`：summary、trend、source stats、model stats、session summary。
- `dashboard:getRequestsPage`：请求表分页。
- `dashboard:getSessionsPage`：会话列表分页。
- `dashboard:getSessionRequestsPage`：按 `sessionId + source + limit + offset` 读取当前会话请求明细。

完整 snapshot 仍保留给 CLI `snapshot`、诊断和显式 full refresh，避免托盘启动时一次性构建 requestLog / sessions / trends / tools。

### Renderer 局部渲染

- 使用分析页通过固定 slot 更新 summary、filters、chart、table、advanced。
- 来源 / 模型 / 日期切换优先 patch slot，不重建整个 `app.innerHTML`。
- 日期时间输入只更新弹层草稿，不替换输入框节点，避免闪烁和焦点丢失。
- 会话页点击会话优先 patch inspector，勾选只 patch bulk toolbar。
- 选中会话只轻量预取请求页，不阻塞 inspector；复制摘要、Markdown 或请求 JSON 前会确保请求页已加载。
- snapshot 时间戳变化时清空会话请求页缓存，避免旧请求明细污染新数据。

### CSS Compositor Budget

窗口 resize、zoom、视图切换期间，`body.is-resizing`、`body.is-zooming`、`body.view-switching` 会降低渲染成本：

- 临时关闭高成本 `backdrop-filter`。
- 降低深阴影。
- 禁用过渡和入场动画。
- 对表格、详情和高级区域应用 `contain` / `content-visibility`。

这保证 macOS 原生质感和 Electron 性能之间有明确预算，而不是每个卡片都无限堆玻璃和阴影。

## 性能验证命令

```powershell
npm test
npm run stress:dashboard
.\node_modules\.bin\electron.cmd .cache\electron-layout-probe.js
.\node_modules\.bin\electron.cmd .cache\electron-deep-performance-probe.js
.\node_modules\.bin\electron.cmd .cache\electron-zoom-settle-probe.js
```

日期筛选闪烁探针：

```powershell
.\node_modules\.bin\electron.cmd .cache\electron-date-flicker-probe.js
```

期望结果：

```json
{
  "afterTime": {
    "sameControl": true,
    "samePopover": true,
    "sameInput": true,
    "value": "09:00",
    "open": true
  },
  "afterQuick": {
    "samePopover": true,
    "sameEndInput": true,
    "activeQuick": true
  }
}
```

## Slot Module Split

`src/dashboard/dashboard-slots.js` is now a compatibility anchor. Runtime slot logic is split into smaller modules:

- `src/dashboard/slots/slot-core.js`: shared slot HTML cache and base patch helpers.
- `src/dashboard/slots/analytics-slots.js`: analytics summary, filters, chart, table and advanced slot patching.
- `src/dashboard/slots/data-page-core.js`: shared pagination UI, page notes, loading state and range payload helpers.
- `src/dashboard/slots/request-page-slot.js`: request DB page cache, table row patching and incremental request append.
- `src/dashboard/slots/session-page-slot.js`: session DB page cache, table row patching and chunked session hydration.
- `src/dashboard/slots/session-slots.js`: session overview, toolbar, table, inspector and modal patching.
- `src/dashboard/slots/perf-panel-slot.js`: developer performance panel.

The old `data-page-slots.js` monolith is now a small compatibility note. Request and session pagination can evolve independently without growing one large renderer slot file again.

## Event Module Split

`src/dashboard/dashboard-events.js` is now a small dispatcher. Runtime event logic is split into smaller modules:

- `src/dashboard/events/chrome-events.js`: refresh, logs, layout mode, compact pane and workspace switching.
- `src/dashboard/events/session-events.js`: saved views, filters, bulk actions, pin/archive/open/copy and session selection.
- `src/dashboard/events/analytics-events.js`: request selection/actions, chart series, cache drill-down, source and table switching.
- `src/dashboard/events/form-events.js`: select/change/input handling and debounced query rendering.
- `src/dashboard/events/date-events.js`: date range popover and no-flicker draft editing.
- `src/dashboard/events/window-events.js`: resize, zoom and window interaction state.

The dispatcher keeps one click listener and executes handlers in a stable order, so split modules do not compete for the same DOM event.

## Aggregation Module Split

`src/providers/codearts/aggregation.js` is now focused on public aggregation entrypoints. Shared runtime and DB worker logic is split out:

- `src/providers/codearts/aggregation-runtime.js`: aggregate cache timing, 300ms slow aggregate logging, source selection, trend range normalization, and merge helpers.
- `src/providers/codearts/aggregation-workers.js`: native/sql.js DB adapter loops plus fallback workers for summary, model stats and session summary.
- `src/providers/codearts/aggregation-sql-expressions.js`: token JSON path expressions, assistant token CTEs, usage select columns and row-to-usage helpers.
- `src/providers/codearts/aggregation.js`: summary, trend, source stats, model stats, session summary, dashboard bundle and database health entrypoints.
- `src/providers/codearts/aggregation-sql.js`: SQL query functions for summary, trend, source stats, model stats, session summary, aggregate bundle and token rows.

This keeps the hot-path behavior unchanged while making future cold-path optimization easier to test. Full aggregation stress currently covers 10k / 50k / 100k messages for both `node:sqlite` and `sql.js`, and slow cold queries continue to print `[codearts-bar] slow aggregate ...` logs above the 300ms threshold.

## Usage Rollup Module Split

`src/providers/codearts/usage-rollup.js` is now focused on sidecar cache reads/writes, build scheduling and diagnostics stats. Pure row math moved out:

- `src/providers/codearts/usage-rollup-calc.js`: token/session row normalization, compact hourly buckets, range filtering, trend/model/session rollup summaries, and dashboard bundle parts.
- `src/providers/codearts/usage-rollup.js`: read/write compact/token/session sidecars, schedule background builds, expose hit/build stats and preserve public exports.

The split keeps the 100k hot dashboard bundle path in the tens of milliseconds while making future cold-path rollup work easier to isolate.

## Next Optimization

1. Productize diagnostics for sqlite adapter, sidecar state, DB health and missing resources.
2. Continue optimizing 50k / 100k cold aggregation and first sidecar build.
3. Continue polishing resize / maximize compositor cost with real Electron probes.
4. Add optional native-probe baselines for packaged builds and large real-world databases.
5. Prepare packaged-build smoke checks for diagnostics, tray menu and installer update flow.
