# CodeArts Bar

> 本地优先的 CodeArts Agent 用量分析与会话工作台。

CodeArts Bar 在本机读取 CodeArts Agent 生成的 SQLite 数据，提供 **Windows 桌面端、VS Code / CodeArts 扩展、JetBrains 插件和 CLI**。它用于查看 token 用量、缓存命中、模型与来源趋势、性能指标和最近会话；原始数据库、日志和 prompt 不会上传。

当前版本：**1.16.35**。

[下载 Windows 版本](https://gitee.com/dtse01/codearts-bar/releases) · [安装 VS Code 扩展](#vs-code--codearts-扩展) · [使用 CLI](#cli) · [从源码运行](#从源码运行)

![CodeArts Bar 使用分析宽屏](docs/screenshots/dashboard-wide.png)

## 选择适合你的入口

| 入口 | 适合场景 | 提供内容 |
| --- | --- | --- |
| **Windows Desktop** | 完整分析和会话管理 | 托盘应用、使用分析、日期/来源/模型筛选、诊断中心、会话固定/重命名/归档 |
| **VS Code / CodeArts 扩展** | 编码时查看与导出 | 使用分析、日期/来源/模型筛选、会话与请求数据库分页、搜索、详情、诊断和单会话导出 |
| **JetBrains 插件** | 在 IDEA、PyCharm、WebStorm、GoLand 中查看与导出 | 使用分析、完整筛选、数据库分页、请求详情、数据源诊断和单会话导出 |
| **CLI / npm 包** | 终端、脚本和诊断 | 文本统计、JSON 快照、运行时检查、数据源诊断、配置和单会话导出 |

## 主要能力

- **使用分析**：总 token、输入、输出、缓存创建/命中、缓存命中率、请求数和时间趋势。
- **双数据源**：自动发现桌面端与 CLI 数据库，可合并查看，也可单独筛选。
- **模型与性能**：模型排行、等待时间、P95/P99、首内容时间、输出速度和错误率。
- **会话管理**：搜索、筛选、固定、重命名、复制摘要、打开目录、归档和恢复。
- **真实数据库分页**：请求、会话和详情按需读取，不把全部记录一次性塞进界面。
- **完整统计口径**：总量、趋势、模型和来源来自完整数据库聚合；当前页只作为明细样本，并在界面明确标注。
- **本地诊断**：检查数据库路径、SQLite adapter、缓存、日志和上次异常退出状态。
- **会话导出**：Desktop、VS Code、JetBrains 和 CLI 支持 JSON、Markdown、真实 XLSX；Desktop 额外支持批量导出。
- **导出隐私**：默认脱敏凭据、用户名和本机路径，不包含推理及工具输入输出；可在导出前调整内容范围。
- **平滑冷启动**：先显示 Summary Skeleton 和核心指标，再在后台补趋势、模型及会话聚合。

## 1.16.35 更新

- VS Code 与 JetBrains 的核心只读能力已对齐 Desktop 的数据语义：共享日期、来源、模型、Provider、项目、性能、缓存、错误和完整性口径。
- VS Code 已补齐会话/请求数据库分页、会话搜索与项目筛选、请求详情和数据库健康诊断；插件隐藏后会降低或取消后台查询。
- JetBrains 已补齐筛选、Provider、完整性、数据库健康诊断和导出隐私选项；Tool Window 隐藏后会取消分析、分页和诊断任务。
- 三端会话支持 JSON、Markdown、Excel 导出；Excel 为真正的 `.xlsx`，并通过 Microsoft Excel 与 LibreOffice 往返验证。
- 导出直接读取完整会话，不受界面分页或 2000 条 Snapshot 样本上限影响；JSON、Markdown、XLSX 使用同一规范化数据模型。
- JetBrains 安装用户无需另装 JDK；插件支持 JetBrains IDE 2024.2 至 2026.1。运行内嵌查询和导出仍需要 Node.js 18+，低版本会得到明确提示。
- Windows Desktop 已规避虚拟机/远程桌面软件渲染路径的间歇性白屏；Renderer 异常时会进行一次受限恢复，正式包需稳定运行 5 秒才通过发布门禁。

## 界面预览

| 使用分析 | 会话管理 |
| --- | --- |
| ![桌面端使用分析](docs/screenshots/dashboard-wide.png) | ![桌面端会话管理](docs/screenshots/session-management.png) |

| 普通窗口 | 日期范围 |
| --- | --- |
| ![桌面端普通窗口](docs/screenshots/dashboard-maximized.png) | ![桌面端日期选择器](docs/screenshots/date-picker.png) |

| VS Code 趋势 Tooltip | 全零数据空态 |
| --- | --- |
| ![VS Code 趋势 Hover Tooltip](docs/screenshots/vscode-tooltip.png) | ![VS Code 全零数据空态](docs/screenshots/vscode-empty-state.png) |

| JetBrains 使用分析 | JetBrains Token 时间筛选 |
| --- | --- |
| ![JetBrains 使用分析总览](docs/screenshots/jetbrains-usage-overview.png) | ![JetBrains Token 时间范围下拉](docs/screenshots/jetbrains-token-time-range.png) |

| JetBrains 自定义时间范围 | JetBrains 会话管理 |
| --- | --- |
| ![JetBrains 自定义 Token 时间范围](docs/screenshots/jetbrains-token-custom-range.png) | ![JetBrains 会话管理](docs/screenshots/jetbrains-session-management.png) |

更多回归截图：[`docs/screenshots`](docs/screenshots)。

## 安装

### Windows 安装版与便携版

打开 [Gitee Releases](https://gitee.com/dtse01/codearts-bar/releases)，按需要下载：

- `CodeArts-Bar-Setup-<version>-x64.exe`：带安装向导、开始菜单与卸载入口。
- `CodeArts-Bar-Portable-<version>-x64.exe`：免安装，适合 U 盘或临时使用。

首次运行后应用会驻留托盘，默认打开“使用分析”。如果 Windows 显示未知发布者提示，请先核对 Release 中的 `SHA256SUMS.txt`，确认文件来自本仓库且校验值一致。

> 当前桌面发布目标为 Windows x64。macOS / Linux 尚未提供经过实机验证的安装包。

### VS Code / CodeArts 扩展

1. 从 Release 下载 `codearts-bar-status.vsix`。
2. 在 VS Code / CodeArts 中打开“扩展”。
3. 选择右上角 `...` → **从 VSIX 安装...**。
4. 安装后点击活动栏中的“码道”，或在命令面板执行 `码道：打开概览侧边栏`。

扩展默认读取桌面端数据库。自定义路径可在设置中填写：

```text
codeartsBar.dbPath
```

扩展先加载 Summary，面板可见后再补齐趋势、模型、会话与请求数据。它支持只读搜索、筛选、数据库分页、请求详情、诊断和单会话 JSON/Markdown/XLSX 导出；重命名、固定和归档等写操作仍由桌面端承担。

### JetBrains 插件

1. 从 Release 下载 `codearts-bar-jetbrains-<version>.zip`。
2. 在 IntelliJ IDEA、PyCharm、WebStorm 或 GoLand 中打开 **Settings | Plugins**。
3. 点击齿轮菜单，选择 **Install Plugin from Disk...**，然后选择下载的 ZIP。
4. 安装并重启 IDE 后，打开右侧 **CodeArts Bar** 工具窗口。

插件工具窗口使用 **使用分析 / 会话管理 / 诊断** 三项主导航。使用分析包含 Token、缓存、软上限、趋势、模型、Provider 和来源视图；会话管理支持搜索、项目/来源筛选、数据库分页、请求明细和单会话 JSON/Markdown/XLSX 导出；诊断页读取真实数据库健康状态，并支持重试、打开设置或数据目录及复制脱敏报告。会话重命名、固定和归档仍在桌面端完成。

当前插件支持 JetBrains IDE 2024.2 至 2026.1（build `242` 至 `261.*`）。安装和使用插件**不需要单独安装 JDK**，它运行在 IDE 自带的 Java Runtime 上。插件内置共享 CLI 资源，但读取本地数据仍需要系统可执行的 Node.js 18 或更高版本；自动发现失败时，可在 **Settings | Tools | CodeArts Bar** 中配置 Node.js、CLI 或 `opencode.db` 路径。会话搜索和分页直接查询本地数据库，不受概览快照条数限制。

从源码构建需要带 `javac` 的 Java 21 或更高版本。Windows 构建脚本会自动发现独立安装或 Toolbox 安装的 IDEA JBR 21+；macOS 和 Linux 需通过 `CODEARTS_BAR_JAVA_HOME`、`JAVA_HOME` 或 `PATH` 提供 Java 21+ 编译器。

### CLI

Release 提供两种压缩包：

- `codearts-bar-cli.zip`：体积较小，需要系统已安装 Node.js 18 或更高版本。
- `codearts-bar-cli-standalone.zip`：内置 Node.js，Windows 上解压即可运行。

也可以安装 npm 包：

```powershell
npm install -g codearts-bar
codearts-bar stats
```

常用命令：

```powershell
codearts-bar stats                 # 文本统计
codearts-bar snapshot              # JSON 快照
codearts-bar runtime               # Node / SQLite 运行时
codearts-bar diagnose              # 数据源、日志和缓存诊断
codearts-bar export-session --session-id <id> --format xlsx --output <path>
codearts-bar config show           # 查看配置与配置文件位置
codearts-bar config set --db "D:\path\to\opencode.db"
```

未全局安装时，可在源码目录使用 `node src/cli.js <command>`。

`self-test` 只用于发布和 CI 的隔离 fixture 验证，必须显式传入测试数据库、临时配置目录和固定时间；它会拒绝读取真实用户数据库。查看当前机器的真实统计请使用 `codearts-bar stats`，排查数据源请使用 `codearts-bar diagnose`。

### 从源码运行

要求：

- Node.js 22 或 24
- npm
- Windows 10/11（构建 Windows 安装包时）

```powershell
git clone https://gitee.com/dtse01/codearts-bar.git
cd codearts-bar
npm ci
npm start
```

开发模式：

```powershell
npm run dev
```

## 数据源

默认自动发现两个只读数据源：

| 显示名称 | 默认路径 | 产生者 |
| --- | --- | --- |
| 桌面端 | `~/.codeartsdoer/codearts-data/opencode.db` | CodeArts Agent 桌面应用 |
| CLI | `~/.codeartsdoer/cli-data/opencode.db` | CodeArts Agent CLI |

两类数据可以合并统计，也可以在 Dashboard 中单独选择。需要覆盖默认路径时，可以使用：

- 桌面端设置中的数据库路径。
- VS Code 设置 `codeartsBar.dbPath`。
- CLI：`codearts-bar config set --db <path>`。
- 环境变量：`CODEARTS_BAR_DB=<path>`。

运行 `codearts-bar diagnose` 可以检查实际发现的数据源、文件可读性与 SQLite adapter。

## 统计口径

CodeArts Bar 不估算或反向推测 token。它读取本地 `opencode.db` 中 assistant 消息及其 `step-finish` part 的 `tokens` / `usage` 字段；同一条消息有 `step-finish` 明细时优先汇总明细，否则使用消息自身的 usage。字段名同时兼容嵌套或顶层字段、camelCase、snake_case、OpenAI 与 Anthropic 风格命名。

正在生成但尚未写完的 assistant 占位记录不会计入请求数：只有当 token 全为 0、没有错误、没有显式完成时间且没有 `step-finish` 时才排除。零 token 的错误请求、已经完成的响应和带 `step-finish` 的有效请求仍会保留。

| 指标 | 统计方式 |
| --- | --- |
| **输入 token** | 请求中未由缓存复用的新输入，读取 `input`、`inputTokens`、`prompt_tokens` 等字段。 |
| **输出 token** | 模型生成内容，读取 `output`、`outputTokens`、`completion_tokens` 等字段。 |
| **推理 token** | 数据源单独提供 reasoning 时独立累计；它计入总 token，但当前主面板不单独占一张卡。 |
| **缓存创建** | 为后续请求写入缓存的提示词 token，读取 `cache.write`、`cacheWrite`、`cache_creation_input_tokens` 等字段。 |
| **缓存命中** | 本次请求直接从缓存复用的提示词 token，读取 `cache.read`、`cacheRead`、`cached_tokens` 等字段。 |
| **总 token** | 优先使用数据源给出的 `total`；没有 total 时按 `输入 + 输出 + 推理 + 缓存创建 + 缓存命中` 计算。它表示记录中的完整 token 用量，不等同于“输入 + 输出”。 |
| **请求数** | 每条有意义的 assistant 模型响应计为一次请求；用户消息和未完成的空占位记录不计入。 |
| **会话数** | 按数据源和 session ID 去重。桌面端与 CLI 即使 ID 相同也视为不同来源的会话。 |
| **错误数 / 错误率** | assistant 响应含 error 时记一次错误；错误率为 `错误请求数 / 请求数`。 |

缓存命中率采用提示词复用口径：

```text
缓存命中率 = 缓存命中 token / (新增输入 token + 缓存命中 token) x 100%
```

分母只统计本次请求可复用的提示词输入，不包含输出、推理和缓存创建。因此它反映“输入上下文中有多少直接来自缓存”，不是 `缓存命中 / 总 token`。当分母为 0 时显示无数据，而不是 0%。

界面中的“今日软上限”由本机 `dailyLimit` 配置计算，只用于本地提醒，不是 CodeArts 官方额度、账单或计费上限。历史、来源和模型筛选不会改变这个当前状态指标。

时间、来源和模型筛选会共同限定统计范围：当天按本机时区的 00:00 开始；`1d` 至 `365d` 是相对当前时间的滚动窗口；自定义范围精确到开始和结束时间；“全部”不设开始时间。区间采用请求时间筛选，并同步重算总量、请求、缓存、趋势、模型与来源数据。趋势按本机时区分桶，短区间通常按小时，长区间按天；没有请求的桶补 0，避免折线跨过空闲时段。

完整总量与明细列表是两条数据路径：总量、模型、来源和趋势由数据库完整聚合；请求/会话列表使用真实数据库分页。界面会显示“完整总量”“完整记录”“当前页样本”或“聚合中”，不会用最多 2000 条的快照样本冒充完整历史。

性能指标只使用存在相应时间记录的请求，所以样本数可能小于请求数：

- **总等待 / 延迟**：assistant 响应创建到完成的时间；P50、P95、P99 从有效原始样本排序后取对应百分位，多数据源合并后重新计算，不用最大值代替 P95。
- **TTFT**：优先来自 CodeArts kernel 日志中的首 token 事件；没有日志事件时不伪造数值。
- **等待首内容**：assistant 消息创建到第一个非 `step-start` / `step-finish` 内容 part 的时间，是本地记录推导的近似值。
- **输出速度**：`输出 token / 完成耗时（秒）`，只统计完成时间有效且大于 0 的请求。
- **排队时间**：来自本地队列事件；没有队列事件时显示无数据。

数据库可能在对话结束后才写入完整 usage，因此正在生成的回复不会按字符实时估算；写入完成并刷新后才进入统计。双数据源合并时各来源先独立聚合，再按相同口径求和，读取失败的来源会在诊断中单独标记，不会用 0 静默替代。

## 隐私与本地数据

- 数据库和日志仅从本机文件系统读取。
- Dashboard、托盘、VS Code Webview 与 CLI 的聚合均在本地完成。
- 应用不会上传原始数据库、会话、日志、prompt 或本地统计结果。
- 默认以只读方式打开数据库；会话重命名、固定和归档仅在用户主动操作时写回对应本地数据库。
- 缓存和设置存放在本机 `CodeArtsBar` 配置目录，可通过 `codearts-bar config show` 查看实际位置。
- 诊断信息会对路径做脱敏。提交 Issue 时仍不要附加原始 `opencode.db` 或包含 prompt 的日志。

## 首次打开、缓存与刷新

首次打开时不会等待全部聚合完成：

1. 立即展示 Summary Skeleton。
2. 核心 token 与缓存指标先显示。
3. 趋势、模型、来源和会话统计在后台补齐。
4. `sql.js + wasm` 冷路径超过 300ms 时显示“正在建立缓存...”。

数据库监听覆盖主数据库、WAL、SHM、touch 文件与相关目录。Dashboard 可见时默认每 4 秒兜底检查，隐藏到托盘后降为 15 秒，以减少后台占用。

## 已知限制

- 大型数据库第一次聚合可能较慢，缓存建立后会明显加快。
- 优先使用 `node:sqlite`；运行环境不支持时自动回退到 `sql.js + wasm`，功能保持可用，但冷启动成本更高。
- 极大的历史数据库可能需要等待后台 rollup / sidecar 缓存完成。
- 数据准确性取决于本地数据库结构以及 CodeArts Agent 已写入记录的完整性。
- 当前正式桌面产物为 Windows x64；macOS / Linux 需要额外实机回归与打包适配。
- VS Code 与 JetBrains 提供只读查看、筛选、分页、诊断和导出，不包含桌面端的会话重命名、固定、归档与恢复等写能力。

## 开发与验证

```powershell
npm test                     # 单元、Smoke、跨平台 CLI 和流水线契约测试
npm run verify               # 完整本地验证，包含 Electron 与 VS Code E2E
npm run verify:ci            # Windows CI：验证、压力测试和视觉回归
npm run test:visual          # 七场景像素回归
npm run build:extension      # 生成 release/codearts-bar-status.vsix
npm run build:jetbrains      # 生成 JetBrains 插件 ZIP（需要 JDK 21+ 或带 javac 的 IDEA JBR 21+）
npm run build:app            # 生成 Windows 安装版与便携版
npm run pack:npm             # 生成精简 npm 包
node src/cli.js self-test --fixture-db tests/fixtures/opencode-fixture.db --config-dir .cache/self-test-config --now-ms 1783512000000
```

Gitee Go 在分支、PR 和 `master` 上使用 Node.js 22 执行可跨平台的测试、压力测试、VSIX 与 npm 包构建。Windows 安装包由 Windows CI 构建并执行 ASAR/资源校验。

更新 README 截图：

```powershell
npm run update:readme-screenshots
```

## 项目结构

```text
src/                 Electron、CLI、聚合与共享业务源码
extension/           VS Code / CodeArts 扩展运行时和 Webview
jetbrains-plugin/    IntelliJ Platform 插件、工具窗口和状态栏组件
tests/               单测、E2E、压力测试与视觉回归
.workflow/           Gitee Go 流水线
.github/workflows/   Windows CI
docs/screenshots/    README 与视觉回归截图
```

## License

[MIT](LICENSE)
