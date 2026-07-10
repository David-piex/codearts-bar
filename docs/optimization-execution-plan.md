# CodeArts Bar 优化执行总表

最后更新：2026-07-10  
定位：本地开源开发者工具。当前优化主线不是继续堆功能，而是把“不卡、数据准、结构稳、诊断完整、可发布”打扎实。

开源主线说明：下一阶段默认不做账号、付费、云同步、强制自动更新、安装包签名这类商业闭环；这些只保留为后置 backlog。现在优先服务开发者本地使用体验，类似 CodexBar 的轻量可靠工具。

> 关联文档：
> - 完整 backlog：`docs/optimization-backlog.md`
> - 开源发布清单：`docs/open-source-release-checklist.md`
> - 性能架构说明：`docs/performance-architecture.md`
>
> 重要约定：`src/dashboard-renderer.js` 是构建产物，不手改；改源文件后运行 `npm run build:renderer`。

---

## 1. 当前项目判断

项目已经进入“开源发布前打磨阶段”：托盘、Dashboard、CLI、SQLite/sql.js、分页、诊断、打包、E2E、release smoke 都有基础。现在最需要优化的是体验兜底和大数据稳定性，而不是新增复杂功能。

当前最明显风险：

1. **放大/最大化还是可能卡一下**：resize、canvas 重绘、backdrop-filter/阴影/transition 可能一起触发 jank。
2. **日期筛选仍是高风险交互**：输入闪烁、弹层跑位、错误时间范围触发查询，都会影响体感。
3. **聚合和分页要继续下沉到 DB/sidecar**：真实用户 50k/100k 数据时，不能靠 renderer 前端兜底。
4. **文件体积虽然已经拆了，但还要继续守住边界**：CSS 多个 22KB 左右文件，JS 还有 15-22KB 的核心业务文件。
5. **诊断中心要产品化**：用户遇到无数据、DB 损坏、权限不足、fallback 时，要能看懂并复制脱敏报告。
6. **视觉要继续减法**：首页只保留核心指标，会话管理只做会话，整体靠近 macOS 原生开发者工具。

---

## 2. 优先级路线图

| 优先级 | 优化方向 | 目标 | 状态 | 验收标准 |
|---|---|---|---|---|
| P0 | 日期筛选稳定 | 不闪、不丢焦点、不误查 DB | 待继续打磨 | 输入/确认/错误/最大化场景 E2E 通过 |
| P0 | 最大化/resize 降 jank | 放大不卡一会 | 待继续打磨 | 连续 E2E `resizePerf < 180ms` |
| P0 | 桌面端/CLI 切换 | 只局部刷新 | 已有基础，继续守住 | `sourceSwitch < 50ms`，无整页闪 |
| P0 | Request/Session 分页 | 20/50/100、跳页、越界修正 | 已有基础，继续统一 | `requestPage/sessionPage < 80ms` |
| P0 | 托盘右键/最小化 | 托盘状态稳定 | 待复查 | 最小化后右键菜单始终可用 |
| P1 | DB 聚合/sidecar | 50k/100k 热路径稳定 | 已有基础，继续下沉 | 100k hot `<500ms` |
| P1 | 多源分页 k-way merge | 多数据源不全量拉取 | 待优化 | 多源翻页 `<80ms` |
| P1 | 慢聚合可观测 | 卡在哪里能看到 | 正在完善 | 诊断/性能面板显示慢聚合历史 |
| P2 | 局部渲染 | 常规交互不重建整页 | 已有基础，继续细化 | 固定 slot、canvas 复用、table patch |
| P2 | 会话管理局部刷新 | 点击/固定/归档不卡 | 待继续优化 | 点击只刷 inspector，动作只 patch 当前行 |
| P3 | JS/CSS 结构拆分 | 长期维护不失控 | 已拆一轮，继续整理 | 单业务文件尽量 `<20KB`，CSS 语义化 |
| P4 | 数据准确性 | 指标可解释、可复现 | 待补 fixture | 缓存、时间、source、分页测试一致 |
| P5 | 诊断中心 | 问题可自查 | 已有基础，继续产品化 | DB/adapter/sidecar/log/resource 都有状态 |
| P6 | 视觉统一 | 像 macOS 工具 | 待继续打磨 | 信息减法、控件统一、空错加载状态完整 |
| P7 | 开源发布闭环 | 能稳定发版 | 已有基础，继续完善 | build/smoke/hash/release notes/压测报告完整 |

---

## 3. 下一轮最应该做的 8 件事

### 3.1 日期筛选彻底稳定

涉及文件：

- `src/dashboard-date-range.js`
- `src/dashboard/events/date-events.js`
- `src/dashboard/events/form-events.js`
- `src/dashboard/slots/analytics-slots.js`

要做：

- 日期弹层内部只维护 draft，不在输入过程中刷新 Dashboard。
- 只有点击“确认”才应用全局 range。
- `end < start` 时只显示轻量错误，不触发 DB 查询、不写缓存。
- 输入时保持焦点、光标、错误状态。
- 最大化/resize 后弹层重新 clamp 到 viewport 内。
- 开始日期/时间、结束日期/时间布局固定，不再抖动。

验收：

```powershell
npm run e2e:electron
```

重点看：输入不闪、错误范围不查 DB、最大化后不跑位。

### 3.2 最大化/resize 继续降 jank

涉及文件：

- `src/dashboard/events/window-events.js`
- `src/dashboard/chart/chart-canvas.js`
- `src/styles/layout.css`
- `src/styles/responsive-states.css`

要做：

- resize burst 期间临时降低 `backdrop-filter`、重阴影、复杂 transition、hover 效果。
- ResizeObserver 只记录尺寸，不频繁触发全量 redraw。
- canvas 尺寸没变时跳过 redraw。
- resize settle 后只补一次稳定重绘。
- 性能面板继续记录 resize marks。

验收预算：

| 场景 | 预算 |
|---|---:|
| 最大化/还原 | `<180ms` |
| resize settle 后图表重绘 | `<80ms` |
| 页面布局恢复 | 不白屏、不错位 |

### 3.3 聚合性能继续下沉

涉及文件：

- `src/providers/codearts/aggregation.js`
- `src/providers/codearts/aggregation-runtime.js`
- `src/providers/codearts/aggregation-sql.js`
- `src/providers/codearts/usage-rollup.js`
- `src/providers/codearts/usage-rollup-calc.js`
- `src/providers/codearts/rollup-cache.js`
- `src/providers/codearts/aggregate-cache.js`

要做：

- summary/trend/source/model/session 都优先走 DB 聚合或 rollup。
- 减少重复 `json_extract`，token row 展开一次后复用。
- sidecar 构建状态进入诊断中心：构建中、耗时、行数、失败原因、下次重建原因。
- 慢聚合历史进入诊断和性能面板，且脱敏。
- sidecar 损坏时不阻塞 Dashboard，后台重建。

验收：

```powershell
npm run stress:aggregation
npm run stress:aggregation:full
```

预算：

| 数据量 | 热路径预算 |
|---|---:|
| 10k | `<180ms` |
| 50k | `<300ms` |
| 100k | `<500ms` |

### 3.4 多数据源分页 k-way merge

涉及文件：

- `src/providers/codearts/pagination.js`
- `src/providers/codearts/sources.js`
- `src/main/ipc-dashboard.js`

要做：

- 多源分页不要每个源都取 `offset + limit` 再统一切片。
- 过滤条件先下推到每个源。
- 按时间排序做 k-way merge。
- 每个源只读必要窗口，避免内存随总数据量线性增长。

验收：

```powershell
npm run stress:pagination
```

预算：多源 50k/100k 翻页 `<80ms`。

### 3.5 会话管理继续局部渲染

涉及文件：

- `src/dashboard/slots/session-slots.js`
- `src/dashboard/slots/session-page-slot.js`
- `src/dashboard/sessions/session-table.js`
- `src/dashboard/sessions/session-inspector.js`
- `src/dashboard/events/session-events.js`

要做：

- 页面骨架固定。
- 点击会话只更新右侧 inspector。
- 固定/归档只 patch 当前 row。
- 搜索 debounce 后只刷新 table slot。
- 多选只刷新 bulk toolbar。
- 保持滚动位置和输入框焦点。
- 会话管理坚持简单：看到、搜索、固定、保存视图、打开、复制、归档/恢复。

验收：点击、搜索、固定、归档无整页闪烁。

### 3.6 CSS 和视觉继续统一

当前仍需关注的大 CSS：

| 文件 | 体积 |
|---|---:|
| `src/dashboard.css` | ~24KB |
| `src/dashboard-components.css` | ~22.7KB |
| `src/dashboard-analytics.css` | ~22.2KB |
| `src/dashboard-compact.css` | ~22.1KB |
| `src/dashboard-sessions.css` | ~22.1KB |
| `src/dashboard-controls.css` | ~22KB |
| `src/dashboard-chart.css` | ~22KB |

要做：

- 把历史样式继续迁到 `src/styles/*` 语义层。
- 圆角、阴影、颜色、控件高度全部走 token。
- 首页信息减法：总 Token、缓存命中/覆盖、Agent idle、趋势、请求概览。
- 会话管理 Finder/Mail 化：左列表，右详情。
- 减少大面积蓝色按钮，hover 更轻，表格线更淡，行高更克制。
- 空状态、错误状态、加载状态全部产品化。

目标：不是更花，而是更轻、更稳、更像系统应用。

### 3.7 数据准确性补 fixture

重点校准：

- 缓存命中率公式：`cacheRead / (input + cacheRead)` 是否符合当前数据字段语义。
- 如果真实含义不是命中率，UI 改成“缓存覆盖率”。
- 时间范围 start/end 是否包含边界。
- UI 时区、DB 查询时区、trend bucket 时区是否一致。
- CLI/桌面端字段归一化，避免同一请求重复计数。
- summary/trend/table 在同一筛选条件下数字一致。

建议新增 fixture：

```text
跨天
跨月
空范围
反向范围
只有 CLI
只有桌面端
同一会话多请求
包含 cacheRead/cacheWrite/input/output 的请求
```

### 3.8 开源发布闭环补齐

涉及文件：

- `src/release.js`
- `src/release-manifest.js`
- `tests/release-package-smoke.js`
- `tests/package-resource-smoke.js`
- `README.md`

要做：

- installer / portable 都跑 smoke。
- release notes 自动包含版本、重要变更、已知问题、hash。
- README 写清：本地读取、不上传数据；App 内优先 `node:sqlite`；CLI 不支持时 fallback `sql.js`。
- 诊断报告支持 issue 反馈，但要脱敏。
- 真实用户数据压测结果沉淀到文档。

验收：

```powershell
npm run build:app
npm run smoke:release
npm run smoke:package-resources
```

---

## 4. 文件级拆分建议

### 4.1 JS 下一步拆分

```text
src/dashboard/runtime/
  state.js
  scheduler.js
  perf.js
  slots.js
  bootstrap.js

src/dashboard/chart/
  chart-canvas.js
  chart-series.js
  chart-hover.js
  chart-tooltip.js
  chart-legend.js
  chart-resize.js

src/dashboard/i18n/
  core.js
  analytics.js
  sessions.js
  diagnostics.js
  settings.js

src/providers/codearts/rollup/
  builder.js
  reader.js
  scheduler.js
  stats.js
  compact.js
  cache-file.js

src/main/services/
  refresh-service.js
  dashboard-snapshot-service.js
  db-watch-service.js
  official-stats-service.js
```

### 4.2 CSS 下一步拆分

```text
src/styles/
  tokens.css
  base.css
  layout.css
  controls.css
  segmented-control.css
  tables.css
  chart.css
  analytics.css
  sessions.css
  popover.css
  diagnostics.css
  empty-states.css
  responsive.css
  performance-mode.css
```

控制目标：

- 单业务 JS 尽量 `<20KB`。
- 单 CSS 长期 `<15KB`。
- 新样式必须优先复用 token，不再新增临时魔法值。

---

## 5. 统一性能预算

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

先作为 warning；稳定后再升级为 CI 失败条件。

---

## 6. 每轮必跑命令

普通改动：

```powershell
npm run build:renderer
npm test
npm run e2e:electron
git diff --check
```

性能/数据层改动：

```powershell
npm run stress:pagination
npm run stress:aggregation
npm run stress:aggregation:full
```

发布相关改动：

```powershell
npm run build:app
npm run smoke:release
npm run smoke:package-resources
```

---

## 7. 暂时不要抢主线的事情

这些可以后置：

- 整项目改 SwiftUI。
- 自动更新。
- 代码签名。
- 账号体系。
- 付费授权。
- 云同步。
- 服务端遥测。
- 继续堆复杂图表。

原因：当前定位是开源本地开发者工具，最影响用户口碑的是打开快、数据准、可诊断、不卡、能稳定发布。商业分发能力等后面真的需要再补，不进入当前 P0/P1 主线。
