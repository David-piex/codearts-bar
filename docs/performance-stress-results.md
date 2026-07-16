# CodeArts Bar 性能压测结果

文档更新：2026-07-16

历史性能基线版本：`1.16.33`

下列聚合耗时和交互数字采自 `1.16.33`，保留作为历史基线；`1.16.36` 只补充与本次功能变更直接相关的增量验证，不用新功能验证结果覆盖旧性能采样。

## 采样环境

- Windows 11 Pro `10.0.26200`
- Intel Core i7-1165G7，4 核 8 线程
- 16 GB RAM
- Node.js `24.17.0`，Electron `43.1.0`
- Windows x64，Asia/Shanghai
- 单次本地采样；冷路径会受磁盘、杀毒软件、系统负载和 JIT 影响

## 聚合压力测试

命令：

```powershell
npm run stress:aggregation:full
```

测试覆盖 10k/50k/100k assistant messages、1250/6250/12500 sessions、native 与 SQL.js、冷查询、dashboard 聚合包、sidecar 构建和热命中。P95 使用原始延迟样本，不以最大值代替。

| 数据量 | native 冷路径最大值 | SQL.js 冷路径最大值 | dashboard 首次 native / SQL.js | sidecar build | native 热路径最大值 | SQL.js 热路径最大值 |
|---:|---:|---:|---:|---:|---:|---:|
| 10k | 572.1ms | 2549.4ms | 332.5ms / 858.1ms | 512.5ms | 39.1ms | 58.5ms |
| 50k | 4025.3ms | 9870.8ms | 1542.1ms / 3146.3ms | 1638.6ms | 50.1ms | 87.1ms |
| 100k | 6331.0ms | 17963.9ms | 4668.4ms / 7968.5ms | 4693.7ms | 140.2ms | 165.2ms |

“冷路径最大值”是 summary、trend、model、session summary、dashboard bundle 五项中的最大值，不等于用户每次打开窗口都要等待该时长。Electron 首屏先读摘要，完整聚合和 sidecar 在后台完成。100k 热路径仍低于测试规定的 500ms 门禁。

当前主要成本：

1. 首次 SQL.js 需要读取 SQLite/WAL 快照并执行 JSON 提取。
2. 精确模型与趋势 P95 必须读取有效延迟样本。
3. sidecar 首次生成需要扫描完整合格请求集合。

本轮已经移除的重复成本：

- dashboard bundle 只读取一次规范化 token rows；
- 纯 token 摘要不再复制或排序延迟样本；
- 单数据源不再二次合并已经精确计算的 P95；
- sidecar JSON 与规范化 rows 在文件签名不变时进程内复用；
- 数据库指纹、sidecar mtime/ctime/size 变化或损坏会使缓存失效。

## Electron 交互

命令：

```powershell
npm run e2e:electron
npm run screenshot:electron
```

本轮自动化覆盖标准/窄/宽窗口、会话管理、日期弹层、30 天快捷范围、自定义日期、分页、来源切换、实时刷新和滚动保持。

```text
resizePerf=92ms
sourceSwitch=18ms
requestPage=2ms
sessionPage=2ms
```

另外，5,200 请求与 900 会话的 renderer 压力场景为 `276.3ms`；双来源 k-way 深分页测试通过。

## 跨端与体积

- VS Code 1.128.1 扩展宿主：激活 `326ms`，刷新 `1ms`。
- JetBrains CLI bundle：`124,392B`，低于 `125,000B` 门禁。
- JetBrains Plugin Verifier：IntelliJ 2024.2、2024.3、2025.1、2025.2 均为 Compatible。

## 正确性门禁

- placeholder 在 JS、SQL、rollup 和分页路径中一致排除；
- 零 token 错误、显式完成和 `step-finish` 请求保留；
- nested/top-level、camelCase/snake_case、OpenAI/Anthropic token aliases 对齐；
- trend/model/multi-source P95 使用真实 percentile；
- snapshot 样本与完整历史总数、scope 明确分离；
- canonical quota 不被历史筛选覆盖；
- native、SQL.js、rollup 与非 rollup 的真实数据库结果一致。

## 1.16.36 增量验证

- Electron E2E 通过，Desktop 会话与请求分页已覆盖 `10 / 20 / 50 / 100`、页码跳转和范围摘要。
- VS Code 1.129.0 隔离安装与扩展激活通过，会话跨页选择及批量 Excel/Markdown/JSON 导出通过。
- JetBrains Node 侧 runtime contract 通过，覆盖 native/sql.js 查询、筛选、分页、诊断和单个/批量导出。
- JetBrains 查询 bundle 为 `126958` 字节，低于 `127000` 字节门禁；runtime JS 总体积约 `1236288` 字节，低于 `1240000` 字节门禁。
- 使用 `D:\Develop\Java\jdk-21.0.10` 完成 Gradle 单元测试、构建、发布 ZIP smoke 和 Plugin Verifier；IntelliJ IDEA 2024.2、2024.3、2025.1、2025.2 均为 Compatible。
- 当前发布 ZIP 为 `892415` 字节，低于 `950000` 字节门禁；旧版本 ZIP 不作为本轮验收证据。
- 会话与请求分页压力测试通过；不同数据源的同名会话使用 `source:id` 区分。
- LibreOffice 批量 XLSX 无界面打开、重存和再次解析通过，内置子任务过滤与统一隐私规则通过。

## 1.16.36 质量稳定化重采样

2026-07-16 在同一台 Windows 11 / Node.js 24 环境重新运行 `npm run stress:aggregation:full`。本次结果用于验证统一后的声明式热路径门禁，不替换上方 `1.16.33` 历史基线。

| 数据量 | native 冷路径最大值 | SQL.js 冷路径最大值 | sidecar build | native 热路径最大值 | SQL.js 热路径最大值 |
|---:|---:|---:|---:|---:|---:|
| 10k | 1182.4ms | 1741.8ms | 545.0ms | 39.2ms | 57.4ms |
| 50k | 3317.9ms | 13258.3ms | 3785.8ms | 61.1ms | 86.7ms |
| 100k | 7232.4ms | 21117.3ms | 4890.0ms | 100.6ms | 126.4ms |

`quality-baseline.json` 现在是 10k/50k/100k 热路径预算的单一数值来源：小规模 `250ms`，50k 及以上 `500ms`。本次 100k native/sql.js 热路径均保留明显余量。冷路径继续作为可观测性和体验优化对象，不作为跨硬件统一硬失败门禁。

同轮质量结果：renderer `295981` 字节、CSS `205702` 字节、warm snapshot 中位数 `11.4ms`；覆盖率 lines/functions/branches 为 `83.84% / 81.55% / 68.2%`。质量结果同时记录 package 版本、Git commit、质量基线 SHA256 和 renderer/CSS SHA256，旧缓存不能作为当前产物的验收证据。

首次 rollup 进度、直接 SQL 回退和跨进程后台恢复加入后，JetBrains 查询 bundle 为 `135187` 字节，三份 runtime JS 合计 `1244611` 字节。对应门禁调整为 `136000` / `1250000` 字节；ZIP `950000` 字节总门禁不变。新增体积用于排队/扫描/写入阶段状态、脱敏状态文件、失败退避和独立后台恢复任务，不用于界面装饰。

后续重新采样必须同时记录环境、版本、冷热状态和正确性断言；不能只比较一个更快但统计口径不同的数字。
