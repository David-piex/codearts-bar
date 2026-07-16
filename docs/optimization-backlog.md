# CodeArts Bar 优化 Backlog

最后更新：2026-07-15

当前版本：`1.16.34`

本清单只保留尚未完成或需要长期守护的事项。已经落地的统计、筛选和稳定性修复不再重复列为“下一步”。

## 已完成并转为回归门禁

- [x] 完整聚合与 snapshot 样本语义分离。
- [x] assistant placeholder 排除，错误行和 `step-finish` 请求保留。
- [x] message/part Token 字段归一化，保留缓存读写。
- [x] 趋势、模型和多源合并使用真实 P95。
- [x] `[start, endExclusive)`、本地时区和 DST 筛选契约。
- [x] canonical `status`/`quota` 不受历史、来源和模型筛选覆盖。
- [x] Request/Session 数据库分页与多源 k-way merge。
- [x] Electron、VS Code、JetBrains、CLI 查询协议对齐。
- [x] JetBrains runtime `<127000` 字节质量门禁（多选筛选后实测 126090 字节）。
- [x] macOS/Linux 无签名构建 workflow、资源 smoke 和 artifact 上传配置。

## P0：数据准确性

### DATA-1 真实数据库 fixture

状态：部分完成。

- 覆盖旧版 message usage、`part.step-finish`、缓存读写、错误和中断回复。
- 覆盖零 Token placeholder 与零 Token 错误请求。
- fixture 必须脱敏并能在 native/sql.js 下复现。
- 当前真实数据库已完成 all/30d、桌面/CLI、native/sql.js、rollup/no-rollup 对账；仍需固化多版本脱敏 fixture。

验收：四端在相同 scope 下的总量、请求数、模型、来源和时间 bucket 一致。

### DATA-2 官方额度与本地统计边界

状态：持续优化。

- UI 和诊断中继续明确 `dailyLimit` 仅为本地显示软上限。
- 官方数据缺失时不得把本地 Token 标成官方计费或额度。

### DATA-3 完整性元数据

状态：已实现，持续守护。

- 新协议字段必须区分 sampled/complete 和历史总数。
- 新客户端不得用 snapshot 页数承诺完整历史。

## P1：冷路径和可观测性

### PERF-1 首次 rollup 构建

状态：待优化。

- 展示构建中、扫描行数、阶段、耗时和失败原因。
- 构建失败时保留直接 SQL fallback，并允许后台重试。
- 避免首次构建阻塞 Electron 窗口交互或 IDE UI 线程。

### PERF-2 当前版本重新基线

状态：已执行，持续回归。

- 使用 10k/50k/100k 合成数据和脱敏真实样本重新采样。
- 分开记录 native/sql.js、冷路径、sidecar 构建和热路径。
- `1.16.33` 的 10k/50k/100k 冷/热结果已记录在性能文档；后续硬件或口径变化必须重新采样。

### PERF-3 Bundle 余量

状态：持续守护。

- renderer、CSS 和 JetBrains CLI 保持现有门禁。
- JetBrains 专用瘦身不得削弱脱敏、native/sql.js fallback 或协议字段。

## P2：发布与平台

### REL-1 跨平台 CI 绿灯

状态：workflow 已配置，持续验证。

- macOS/Linux 执行 `npm test`、构建、asar/resource smoke 和 artifact 上传。
- 记录首次稳定绿灯；平台失败必须作为发布阻塞项处理。
- Windows release 验证不能替代 macOS/Linux 实际运行结果。

### REL-2 macOS/Linux 实机回归

状态：待完成。

- 验证数据库发现、托盘、窗口生命周期、sql.js fallback 和 portable artifact。
- 签名、公证、自动更新后置，不抢占数据准确性主线。

## P3：维护与体验

### MAINT-1 共享数据契约

状态：持续进行。

- 统计规则只保留一个权威实现；客户端只负责展示和交互。
- scope、时间边界、完整性和 canonical/filtered 语义必须进入测试。

### UX-1 冷启动和零数据表达

状态：部分完成。

- 区分“当前范围无数据”“数据库无数据”“正在生成”“统计不可用”。
- 首次 rollup 期间显示进度，不让用户误以为数字丢失。
- 已区分完整总量、完整记录、当前页样本和聚合中；下一步补充扫描行数与阶段进度。

### UX-2 原生工具感

状态：持续打磨。

- 保持紧凑层级、稳定尺寸、轻分隔线和局部更新。
- 不以增加装饰、卡片或图表数量作为优化指标。

## 验收顺序

1. 数据 fixture 与四端对账。
2. 冷路径基线和首次构建体验。
3. 跨平台 CI/实机验证。
4. 结构和视觉收敛。

性能预算是目标，不是已测结果；实际结果统一记录在 `performance-stress-results.md`。
