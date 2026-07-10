# CodeArts Bar

CodeArts Bar 是面向 CodeArts Agent / 码道用户的本地用量与会话工作台。它由 Electron 托盘应用、Dashboard、CLI、VS Code/CodeArts 扩展和安装包组成，目标是在不上传用户数据的前提下，提供 Token 用量、缓存命中、Agent idle、性能趋势和会话管理能力。

## 核心能力

- **托盘状态**：今日、24h、7d、历史 Token 摘要，右键菜单可打开面板、刷新、设置、日志和安装包目录。
- **使用分析**：总 Token、缓存命中率、Agent idle、趋势图、请求概览、模型/来源筛选。
- **会话管理**：查看、搜索、固定、保存视图、打开目录、复制摘要、归档/恢复。
- **真实分页**：请求、会话列表和会话详情请求明细都走 DB 分页，首屏限制数据量，滚动/按需再加载。
- **CLI**：安装版优先使用 Electron 自带 Node；独立 CLI zip 优先使用包内 Node；SQLite 优先 `node:sqlite`，不支持时回退 `sql.js + wasm`。
- **诊断与日志**：内置日志入口、数据库健康检查和基础诊断命令。

## 设计目标

当前版本的方向是“像一个 macOS 开发者工具”，不是普通 Web 管理后台：

- 信息减法：首页优先展示总 Token、缓存命中率、Agent idle、趋势图和请求概览。
- 原生质感：统一圆角、阴影、控件高度、表格密度和轻量 hover。
- 性能优先：切换桌面端 / CLI、窗口放大、日期筛选和图表 hover 都避免整页重绘。
- 本地优先：读取本机 CodeArts 数据库和日志，不依赖云端服务。

## 本地数据与隐私

CodeArts Bar 按开源本地开发者工具定位设计：

- 默认只读取本机 CodeArts Agent / CLI 产生的 `opencode.db` 和本地日志。
- Dashboard、托盘和 CLI 的统计都在本机完成，不上传原始数据库、日志或 prompt 内容。
- 诊断报告会对路径做脱敏，只保留文件名、hash、存在性、可读性、adapter、缓存状态和错误码等排查信息。
- 提 issue 时建议附上“复制诊断报告”的内容，不建议上传原始 `opencode.db` 或包含 prompt 的日志。

## 没有数据时怎么办

如果首页为空或诊断中心提示数据源为空，通常是下面几种情况：

1. 还没有运行过 CodeArts Agent / CLI。先产生一次会话，再刷新 CodeArts Bar。
2. 只使用了桌面端或只使用了 CLI。可以在来源筛选里切换“桌面端 / CLI / 全部”。
3. `opencode.db` 路径不在默认位置。打开设置选择正确数据库路径。
4. 当前 Node 不支持 `node:sqlite`。App / CLI 会自动回退到 `sql.js + wasm`，功能可用，但大数据冷聚合可能更慢。
5. 数据库损坏、权限不足或被占用。打开诊断中心查看 `nextActions`，或复制脱敏诊断报告反馈。

常用排查命令：

```powershell
node src/cli.js runtime
node src/cli.js diagnose
node src/cli.js stats
```

## 架构概览

```text
src/
  main.js                         Electron 主进程、托盘、IPC、窗口管理
  codeartsData.js                  全量 snapshot，用于 CLI snapshot / 诊断 / 导出
  providers/codearts/              DB 源、SQLite、分页、聚合、日志扫描
  dashboard-renderer.js            Dashboard 引导入口
  dashboard/                       渲染调度、slot 局部更新、事件、图表、会话组件
  dashboard-*.css                  Dashboard 样式模块
  cli.js                           命令行入口
extension/                         VS Code / CodeArts 状态扩展
release/                           发布产物输出目录
```

### 数据读取策略

默认 Dashboard 不再依赖全量 snapshot 首屏渲染，而是走轻量数据路径：

1. `dashboard:getAggregates` 读取 summary / trend / source / model / session summary。
2. `dashboard:getRequestsPage` 读取请求首屏分页。
3. `dashboard:getSessionsPage` 读取会话首屏分页。
4. `dashboard:getSessionRequestsPage` 在选中会话/复制详情时按需读取该会话请求明细。
5. 只有 CLI `snapshot`、诊断和显式 full refresh 才走完整 `getSnapshotWithCache`。

这样大数据用户打开托盘和 Dashboard 时，不需要先把 requestLog / sessions 全量加载到 renderer。

## 日期筛选

Dashboard 使用固定的“开始日期 + 时间 / 结束日期 + 时间”筛选。输入日期或时间时只更新当前弹层草稿，不重建整个筛选栏，避免输入框闪烁和焦点丢失。点击“确认”后才应用范围并刷新图表/表格。

## 性能策略

- 请求表首屏 100 条，滚动追加。
- 会话列表分页加载，点击会话只刷新右侧详情，并按需预取该会话请求页。
- 图表 hover 只更新 canvas/tooltip，不触发整页 render。
- resize / zoom / 视图切换期间临时关闭高成本 blur、深阴影和动画。
- 聚合结果回来后优先 patch summary / chart / source / model slot。
- 隐藏性能面板：Dashboard 内按 `Ctrl + Shift + P` 可查看 filter、chart、DOM、table、total 耗时。

## 开发命令

```powershell
npm install
npm start
npm test
npm run stress:dashboard
npm run release
```

常用 CLI：

```powershell
node src/cli.js stats
node src/cli.js snapshot
node src/cli.js runtime
node src/cli.js diagnose
node src/cli.js config show
```

安装版 / 独立 CLI zip：

```powershell
codearts-bar.cmd stats
codearts-bar.cmd snapshot
codearts-bar.cmd runtime
```

## 发布产物

运行：

```powershell
npm run release
```

输出：

```text
release/CodeArts-Bar-Setup-<version>-x64.exe
release/CodeArts-Bar-Portable-<version>-x64.exe
release/codearts-bar-cli.zip
release/codearts-bar-status.vsix
release/latest.json
```

## 开源发布前检查清单

CodeArts Bar 当前按“本地开源开发者工具”定位推进，类似 CodexBar 的轻量桌面工具，不把账号、付费、云同步作为主线。

开源版优先补齐：

- 性能预算：最大化 / resize、桌面端 / CLI 切换、日期筛选、分页都要有 E2E 或 stress 结果。
- 诊断中心：数据库不存在、损坏、权限不足、数据源为空、`node:sqlite` fallback `sql.js` 都要有可读状态。
- 崩溃恢复和异常日志：本地日志可复制 / 打开目录，不记录 prompt 内容。
- Release 产物：安装包、portable、CLI zip、VSIX、`latest.json`、`SHA256SUMS.txt`、`RELEASE_NOTES.md`。
- README 和首次启动引导：说明数据只在本地读取、CLI runtime 行为、没有数据时如何产生数据。
- 真实数据压测：1k / 10k / 50k / 100k requests，1k / 10k sessions。

可选后置，不影响开源首发：

- 自动更新。
- 安装包代码签名。
- 账号体系。
- 付费授权。
- 云同步或服务端上报。

## 参考文档

- `docs/codexbar-ui-port.md`：CodexBar UI 迁移说明。
- `docs/official-codearts-cli.md`：CodeArts CLI stats 命令核对。
- `docs/performance-architecture.md`：当前性能架构和优化策略。
- `docs/performance-stress-results.md`：聚合、分页、Electron 真实窗口交互压测结果。
- `docs/optimization-backlog.md`：性能、结构、视觉、诊断和发布优化总清单。
- `docs/open-source-release-checklist.md`：开源首发前的发布、诊断、压测检查清单。
