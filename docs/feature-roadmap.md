# CodeArts Bar 功能路线图

最后更新：2026-07-16

适用版本：`1.16.37`

分析依据：CodeArts Agent Desktop `26.6.0`、CodeArts CLI `26.6.2`、本机只读 SQLite 数据、桌面端编译产物与现有 CodeArts Bar 实现。

## 1. 结论

CodeArts Bar 下一阶段不继续扩充普通 Token 图表，也不复制码道已有的 Agent、MCP、Skill、Rule、CodeBase 和 Checkpoint 管理能力。

产品方向收敛为：

> 面向 CodeArts Agent 的本地历史执行分析与效率诊断工具。

按以下顺序推进：

1. 恢复现有质量门禁，确保 `npm test` 全绿。该项已完成。
2. 让 VS Code 与 JetBrains 插件的数据能力和核心工作流对齐桌面端。该阶段已完成。
3. 为会话提供 Excel、Markdown、JSON 三种导出格式。该阶段已完成。
4. 建设历史工具执行分析。
5. 建设项目效率画像与历史失败诊断。

插件对齐优先于继续增加桌面端独占功能。新增数据能力必须先进入共享 Query Protocol 和公共数据层，再由三个客户端分别呈现，避免桌面端继续扩大领先范围。

## 2. 逆向验证范围

本路线图不是根据功能名称推测，而是基于以下本机证据。

### 2.1 已检查内容

- CodeArts Agent 桌面安装目录与内置扩展。
- `vscode-codebot/out/extension.js` 编译代码。
- CodeArts Agent Webview 前端模块。
- Desktop 和 CLI 两套 `opencode.db` 的表结构与聚合结果。
- CodeArts CLI 命令及实际执行结果。
- CodeArts Bar 当前工具、会话、项目、聚合与诊断实现。

### 2.2 已确认的码道原生能力

码道桌面端已经包含以下完整或主要功能：

- Agent 创建与配置。
- Agent Team 和 SubAgent 关系。
- MCP 安装、状态与市场页面。
- Skill 绑定与技能市场。
- Rule 管理。
- CodeBase 索引管理。
- 历史会话筛选。
- Checkpoint 创建、Diff 与恢复。

CodeArts Bar 不应再建设这些能力的平行管理界面。

### 2.3 已确认的运行事件

码道编译产物中存在以下事件：

```text
agentToolCall.agent
agentToolCallError.agent
agentTokenUsage.agent
compaction.agent
createSubAgentRelation.agent
updateSessionStatus.agent
```

其中 `session.created` 会在存在 `parentID` 时发送 SubAgent 关系事件。普通父子会话关系图已经属于码道自身交互的一部分，CodeArts Bar 只适合做历史聚合和结果比较。

### 2.4 已确认的持久化数据

工具类型的 `part` 记录包含：

```text
tool
state.status
state.input
state.output
state.error
state.time.start
state.time.end
state.title
state.metadata
```

真实样本已经出现 `read`、`grep`、`glob`、`task` 和 `CodeSemanticSearch` 等工具，并包含成功、失败与起止时间。因此工具调用次数、错误率和耗时统计可以从本地数据直接计算，不需要推测。

## 3. P0：恢复质量门禁

### 状态

已完成。

`src/styles/domain-workbench.css` 原本比 14KB 域预算多 21 字节。当前已压缩重复注释，同时保留样式回归测试要求的语义标记，没有改变渲染行为。

验证结果：

- CSS 域预算测试通过。
- Dashboard 样式 Smoke 通过。
- 完整 `npm test` 通过。

后续每个功能阶段都必须从全绿状态开始，并以全绿状态结束。

## 4. P1：插件能力对齐桌面端

### 4.1 对齐原则

对齐的是数据含义、筛选能力和核心工作流，不是像素级复制桌面界面。

- Electron 保留最完整、最高密度的工作台。
- VS Code 使用 Activity Bar、Webview 和命令面板适配 IDE 工作流。
- JetBrains 使用 Tool Window 和原生列表适配 IDE 工作流。
- 三端共享 Query Protocol、时间范围、分页、完整性和脱敏语义。
- 不能在插件中用截断 Snapshot 重新计算桌面端的完整统计。

### 4.2 目标能力矩阵

| 能力 | Desktop | VS Code 目标 | JetBrains 目标 |
| --- | --- | --- | --- |
| 使用摘要与趋势 | 完整 | 对齐 | 对齐 |
| 日期、来源、模型筛选 | 完整 | 对齐 | 对齐 |
| 模型、来源、Provider 统计 | 完整 | 对齐 | 对齐 |
| 性能、错误、缓存指标 | 完整 | 对齐 | 对齐 |
| 请求数据库分页 | 完整 | 补齐 | 对齐 |
| 会话数据库分页 | 完整 | 补齐 | 对齐 |
| 会话搜索与项目筛选 | 完整 | 补齐 | 对齐 |
| 每页条数与页码跳转 | 完整 | 对齐 | 对齐 |
| 会话多选与跨页选择 | 完整 | 对齐 | 对齐 |
| 请求详情与脱敏错误 | 完整 | 补齐 | 对齐 |
| 诊断与数据源健康 | 完整 | 补齐 | 对齐 |
| 单会话与批量导出 | 完整 | 对齐 | 对齐 |

### 4.3 第一阶段范围

先补 VS Code，因为它当前是最轻量的客户端：

- 请求分页与详情。
- 会话分页、搜索、来源和项目筛选。
- 性能、错误和缓存指标。
- 数据库与数据源诊断摘要。
- 会话导出入口。

JetBrains 第一阶段以协议对账和缺口补齐为主，不重写已经存在的分页与详情界面。

### 4.4 实现要求

- Desktop、VS Code、JetBrains 不各自实现 SQL。
- 所有新查询先加入 `src/protocol/query.js` 和 provider 公共层。
- VS Code 继续使用 staged extension 资源，不复制桌面 Renderer bundle。
- JetBrains 继续通过精简 CLI runtime 消费相同协议。
- 写操作必须显式区分支持能力，客户端不支持时禁用入口并解释原因。
- 插件刷新必须保留当前筛选、滚动位置和选中记录。

### 4.5 验收条件

- 同一 fixture、范围、来源和模型下，三端总量一致。
- 三端请求与会话 total、分页边界和排序一致。
- 三端对 sampled/complete、历史总量和 canonical 状态解释一致。
- 插件端不暴露数据库路径、Prompt、工具输入输出和原始异常。
- VS Code Extension Host E2E 与 JetBrains Plugin Verifier 通过。
- 插件不可见时停止高频刷新和重型详情查询。

### 4.6 实施状态（2026-07-16）

- P1 已完成。VS Code 已接入数据库会话/请求分页、会话搜索、项目/来源/模型筛选、请求详情、性能与诊断，以及 JSON、Markdown、Excel 导出。
- JetBrains 已通过共享查询协议提供相同范围、筛选、Provider、性能、完整性、会话和请求详情，并新增原生隐私选项与三格式导出菜单。
- JetBrains 查询 bundle 与导出 bundle 分离，日常查询 bundle（含数据库健康、失败脱敏和多选筛选）由小于 127000 字节的门禁约束，当前为 126090 字节。多选来源、模型和项目的重复参数解析及数组 SQL 条件增加 1149 字节，未引入新依赖。
- VS Code Extension Host 已实际验证第 2 页会话/请求的 total、边界、排序和 ID 与共享 provider 一致，并验证模型/项目筛选和三格式文件生成。
- VS Code Webview 行为测试已验证详情刷新后保留第 N 页会话/请求、搜索词、选中请求和滚动位置，不会被 Snapshot 首屏样本覆盖。
- VS Code Webview 全部隐藏后，摘要轮询自动降到至少 5 分钟一次，详情 generation 立即失效；JetBrains Tool Window 隐藏后取消分析、分页、筛选和诊断任务。
- JetBrains 61 项 Java 单测及最终 ZIP Plugin Verifier 已通过 IDEA 2024.2、2024.3、2025.1、2025.2、2025.3.6 和 2026.1.4；2025.3.6 精确 build `IU-253.33813.25` 的兼容问题、警告和缺失依赖均为 0。
- 三端已对账全部 Token、缓存、错误、Provider、性能和完整性字段，并覆盖非 `all/all` 来源/模型筛选；`__none` 项目筛选会正确匹配 NULL、空和纯空白目录。
- VS Code 初始 Snapshot、分页/导出失败和 JetBrains CLI/Java 失败边界均使用首行限长的 IDE 安全摘要；IDE 协议会递归删除数据库路径、Prompt 和工具输入输出，并对 JSON 凭据、Bearer、Windows/Linux 路径及堆栈做隐私回归。
- JetBrains 诊断页通过共享 `diagnostics` 查询显示 SQLite `quick_check`、表、会话和消息统计；导出已存在文件前使用原生确认框。
- VS Code 与 JetBrains 的会话区明确标注为只读查看/导出入口；重命名、归档等 Desktop 写能力不会以失效按钮冒充支持。
- Desktop、VS Code 和 JetBrains 的会话/请求分页已统一为每页 `10 / 20 / 50 / 100` 条，支持指定页码跳转并显示当前范围、总数、当前页和总页数。
- VS Code 与 JetBrains 已增加会话复选框、选择本页、清空和跨页选择；跨数据源选择使用 `source:id`，切换数据库后清空选择。

### 4.7 JetBrains 运行时与版本范围

- 插件用户不需要安装 JDK 21，插件由 JetBrains IDE 自带的 JBR 运行；最终产物固定为 Java 21 字节码。
- 从源码构建需要带 `javac` 的 Java 21 或更高版本。脚本优先使用 `CODEARTS_BAR_JAVA_HOME`、`JAVA_HOME`；Windows 也会自动发现独立安装或 Toolbox 安装的 IDEA JBR 21+，macOS/Linux 可通过 `PATH` 提供编译器。无合格编译器时会在执行 Gradle 前给出明确错误。
- 查询和导出使用内嵌 JavaScript CLI，客户机器仍需 Node.js 18 或更高版本；自动发现失败时可在插件设置中指定 Node.js 路径，低版本会在执行查询前得到明确提示。最终内嵌查询和 XLSX 导出已使用 Node.js 18.20.8 实测通过。
- 当前发布范围是 `sinceBuild=242`、`untilBuild=261.*`，即 IDEA 2024.2 至 2026.1。
- IDEA 2023.x 低于 Java 21/平台 API 基线，不在本发布线内；IDEA 2026.2 及以后需针对 build 262 重新验证后再提高上限。

## 5. P2：会话导出

### 5.1 目标

桌面端、VS Code 和 JetBrains 都能从会话列表或会话详情导出单个会话，并能通过跨页选择批量导出多个会话。

支持格式：

- Excel：适合筛选、统计和审计。
- Markdown：适合阅读、归档和版本管理。
- JSON：适合完整备份、脚本处理和后续导入兼容。

### 5.2 共享导出模型

三个格式必须来自同一个规范化模型，不能分别拼装数据：

```text
schemaVersion
exportedAt
source
session
usage
messages
requests
tools
completeness
redaction
```

导出查询直接读取完整会话，不受当前 UI 页大小和 Snapshot 样本上限影响。

### 5.3 JSON 格式

- 使用版本化 schema。
- 保留稳定 ID、时间、模型、Token、工具和错误元数据。
- 明确标记数据完整性和脱敏策略。
- 默认不包含账号信息和认证字段。
- 为未来受控导入保留向后兼容空间，但本阶段不实现导入。

### 5.4 Markdown 格式

建议结构：

```text
# 会话标题

## 元数据
## 使用摘要
## 对话记录
## 工具调用摘要
## 错误与诊断
```

- 使用可阅读的角色标题和本地时间。
- 代码块保持原有语言标记。
- 工具调用默认只展示名称、状态和耗时。
- 原始工具 input/output 必须由用户显式选择后才可包含。

### 5.5 Excel 格式

使用真正的 `.xlsx` 文件，不以 CSV 冒充 Excel。

单会话工作簿包含：

| Sheet | 内容 |
| --- | --- |
| Summary | 会话元数据、Token、模型、来源、时间和完整性 |
| Messages | 时间、角色、模型、正文或脱敏摘要 |
| Requests | 请求状态、Token、延迟、TTFT 和错误类型 |
| Tools | 工具名称、状态、开始时间、结束时间和耗时 |

批量导出增加 `Sessions` 汇总 Sheet，各会话明细保持稳定 session ID 关联。

Excel 生成库只进入共享 Node/CLI runtime，不打入 VS Code Webview 或 JetBrains UI bundle。插件通过共享导出命令生成文件，避免三端各自实现 XLSX。

### 5.6 导出隐私

导出前提供明确选项：

- 包含对话正文，默认开启。
- 包含工具输入输出，默认关闭。
- 脱敏本机路径与用户名，默认开启。
- 包含错误详情，默认使用脱敏摘要。

任何格式都禁止包含 access token、refresh token、AK、SK 和账号凭据。

### 5.7 验收条件

- 三种格式来自同一个规范化会话模型。
- 导出内容不受 UI 分页和 Snapshot 截断影响。
- JSON 能通过 schema 校验并保持确定性字段结构。
- Markdown 在常见编辑器中层级和代码块正确。
- Excel 可被 Microsoft Excel 和 LibreOffice 正常打开。
- 中文、Emoji、长文本和多行代码不会乱码或破坏单元格。
- 文件名清理 Windows 非法字符并处理重名。
- 取消、磁盘写入失败和会话被删除时给出可恢复错误。
- 隐私 Smoke 确认所有格式不包含凭据。

### 5.8 实施状态（2026-07-16）

- 三种格式已统一使用 `src/providers/codearts/session-export.js` 的规范化模型。
- 默认包含对话正文，排除推理和工具输入输出，并脱敏凭据、本机用户名和路径。
- Excel 使用真实 `.xlsx` 工作簿，对公式注入进行防护，并将超过 32767 UTF-16 单元的长文本拆为稳定续行且不截断 Emoji。
- Desktop、VS Code 和 JetBrains 均已接入单会话和批量导出，CLI 支持单会话导出；批量 Requests 明细包含错误类型。
- VS Code 与 JetBrains 支持跨页保留选择；批量导出仅确认一次隐私选项、选择一次保存位置，并过滤 CodeArts 内置子任务。
- 缺少 `part` 表、消息/Part JSON 损坏或必填字段缺失时，导出会标记 `complete=false` 并给出稳定原因、能力和失败计数，不再误报完整。
- JSON schema 已增加负向结构校验；Markdown 使用动态围栏；凭据脱敏覆盖嵌入普通文本的 JSON 片段和结构化工具输入输出。
- Native SQLite 与 SQL.js 一致性、中文、Emoji、长文本、隐私、打包后 CLI、三端入口和可恢复错误均已有回归测试。
- Native SQLite 与 SQL.js 会深比较完整规范化模型；超过 Snapshot 2000 条样本上限的 2001 请求会话仍完整导出，且 `sampled=false`。
- 错误字段默认只导出首行、最多 500 个 Unicode 码点的脱敏摘要，`redaction.errorMode=redacted-summary`；关闭错误时标记为 `omitted`。单会话和批量 JSON、Markdown、Excel 都扫描同一组凭据夹具。
- Microsoft Excel COM 已直接打开生成文件并确认 `Summary`、`Messages`、`Requests`、`Tools` 四个 Sheet。
- 官方 LibreOffice 26.2.4 已通过无界面真实打开与重存验收；单会话和批量工作簿重存后仍保留 Sheet、中文、Emoji、错误类型列和稳定 session ID 关联。验收命令为 `npm run test:libreoffice`。

## 6. P3：历史工具执行分析

### 6.1 目标

回答当前 CodeArts Agent 界面难以跨会话回答的问题：

- 最近一段时间主要使用了哪些工具？
- 时间消耗集中在哪些工具和项目？
- 哪些工具经常失败或重试？
- 单次会话为什么慢？
- 是否存在重复读取、重复搜索或长时间 Task？

### 6.2 MVP 范围

第一版只在 Electron 桌面端提供完整界面，CLI 输出结构化摘要，VS Code 与 JetBrains 暂时只显示简要统计。

MVP 包含：

- 工具调用总数、成功数、错误数和错误率。
- 工具耗时 P50、P95、平均值和最大值。
- 按日期、数据源、项目、模型和工具筛选。
- 单会话工具执行时间线。
- 工具错误摘要，默认脱敏。
- 长时间调用识别。
- 重复工具调用识别。
- 数据完整性与样本范围标识。

单会话时间线示例：

```text
09:31:04  read                 243ms   成功
09:31:05  grep                 612ms   成功
09:31:07  CodeSemanticSearch  1.8s    成功
09:31:11  task                38.2s    失败
09:31:52  task                21.4s    成功
```

### 6.3 不进入 MVP

- 不展示完整工具输入和输出。
- 不展示原始 Prompt。
- 不执行、重放或修改工具调用。
- 不自动判断任务是否完成。
- 不在四个客户端同时建设完整交互。
- 不从工具名称推断不存在的业务语义。

### 6.4 验收条件

- Native SQLite 与 SQL.js 对同一 fixture 返回相同聚合结果。
- 工具调用次数与直接 SQL 对账一致。
- P50、P95 和错误率使用完整筛选范围计算，不从当前页反推。
- 单会话时间线按真实起止时间排序。
- 字段缺失、旧版本记录和正在运行的工具不会导致查询失败。
- 错误信息、文件路径和工具参数经过统一脱敏。
- 100k 工具记录热查询目标低于 500ms。
- Electron 首屏不等待完整工具聚合。

## 7. P4：项目效率画像

### 7.1 目标

把全局用量转化为可行动的项目级信息：

- 哪些项目消耗最多？
- 哪些项目工具等待时间最长？
- 哪些项目错误率或缓存利用率异常？
- 哪些项目存在高消耗、低有效产出的会话？

### 7.2 数据原则

- 新版本优先使用 `project` 表和 `session.project_id`。
- `directory` 只作为旧版本兼容回退。
- worktree、项目改名和多数据源需要稳定身份映射。
- 不把本地 Token 标记为官方费用或额度。

### 7.3 MVP 范围

- 项目列表与最近活跃时间。
- Token、请求数和会话数。
- 工具调用数、错误率和工具等待时间。
- 模型与数据源分布。
- 缓存命中率。
- 高消耗会话列表。
- Desktop 与 CLI 数据占比。
- 项目详情页复用工具执行分析。

### 7.4 验收条件

- 项目聚合与同范围会话、请求聚合可对账。
- 项目改名不会制造重复历史项目。
- Desktop 与 CLI 同名目录不会被错误合并。
- 项目筛选不改变 canonical 当前状态和 quota 语义。
- 旧数据库没有 `project` 信息时明确显示兼容模式。

## 8. P5：历史失败与低效模式诊断

### 8.1 目标

基于可验证规则发现需要用户关注的历史执行问题，不生成不可解释的综合评分。

### 8.2 第一批规则

- 工具调用失败。
- 同一工具短时间重复调用。
- 同一资源被重复读取或搜索。
- Task 或 SubAgent 调用持续时间异常。
- 失败后多次重试。
- 会话发生 compaction。
- Token 很高但有效工具调用很少。
- 工具等待时间占会话总耗时比例过高。

### 8.3 展示原则

每条诊断必须包含：

- 触发规则。
- 时间范围。
- 证据数值。
- 涉及的会话或项目。
- 数据是否完整。
- 可执行但不过度承诺的建议。

禁止只显示“健康分 63”而不解释扣分原因。

### 8.4 验收条件

- 每条规则都有独立 fixture。
- 所有规则能够说明输入数据和判断阈值。
- 用户可以关闭单条规则。
- 诊断不读取账号凭据，不输出原始 Prompt。
- 数据不足时显示“无法判断”，不显示正常或异常结论。

## 9. 并行工程线

以下工作不是新产品功能，但必须和 P0 同步完成。

### 9.1 质量门禁

质量门禁已恢复全绿。后续新增协议、插件能力和导出格式都必须增加对应回归测试；预算调整必须记录明确的产物归因，且不能放宽无关热路径门禁。P2 因独立 XLSX 引擎将 JetBrains 发布 ZIP 上限从 550000 调整为 950000 字节，`1.16.36` 基线产物为 893334 字节；查询 bundle 因加入 diagnostics 数据库统计与递归脱敏，将上限从 125000 调整为 126000 字节，后续因多选来源、模型和项目的重复参数解析与数组 SQL 条件调整为 127000 字节，当前为 126090 字节。Renderer 的 330000 字节上限保持不变。

### 9.2 工具数据 fixture

新增脱敏 fixture，至少覆盖：

- completed 工具。
- error 工具。
- 缺少 end time 的运行中工具。
- 空 output。
- 大体积 input/output。
- Task/SubAgent 工具。
- MCP 工具名。
- 旧版本字段缺失。
- Desktop 与 CLI 混合数据源。

### 9.3 查询与缓存

- 工具聚合走数据库 SQL，不扫描完整 Snapshot 列表。
- 单会话时间线按需分页或分段读取。
- Native SQLite 与 SQL.js 保持一致协议。
- 工具查询进入现有 single-flight、worker 和缓存治理体系。
- 数据库指纹变化时正确失效。

## 10. 明确不做

### 10.1 不复制码道原生管理页面

暂不建设：

- MCP 管理或市场。
- Agent 创建与配置。
- Skill 市场与绑定。
- Rule 管理。
- CodeBase 索引管理。
- Checkpoint 恢复操作。

诊断页可以只读显示这些子系统是否可用，但不接管配置和写操作。

### 10.2 不做成本预测

官方 `codearts stats` 依赖 AK/SK。缺少认证时无法获得官方统计，本地 Token 也没有稳定、完整的价格语义。

在没有官方结构化成本接口前：

- 不预测费用。
- 不把本地 Token 换算为官方费用。
- 不把 `dailyLimit` 标记为官方额度。

### 10.3 不做远程协作平台

暂不建设：

- 团队账号体系。
- 云端同步。
- Webhook 告警。
- 共享仪表盘。
- 插件市场。

这些能力会改变本地优先和隐私边界，需要独立产品论证。

## 11. 建议实施顺序

| 阶段 | 内容 | 建议周期 | 启动条件 |
| --- | --- | ---: | --- |
| P0 | 修复 CSS 门禁 | 已完成 | `npm test` 全绿 |
| P1-A | 共享协议缺口审计与 VS Code 分页 | 已完成 | 三端 fixture 已对账 |
| P1-B | VS Code 详情、诊断与 JetBrains 缺口补齐 | 已完成 | Extension Host 与 Plugin Verifier 已通过 |
| P2-A | 共享会话导出模型、JSON 与 Markdown | 已完成 | schema 与隐私测试已通过 |
| P2-B | Excel 导出与三端入口 | 已完成 | Excel 与 LibreOffice 已验证 |
| P3 | 历史工具执行分析 | 1-2 周 | Native/SQL.js 对账 |
| P4 | 项目效率画像 | 1-2 周 | 项目身份规则稳定 |
| P5 | 失败与低效模式诊断 | 1-2 周 | 工具历史数据稳定 |

周期用于控制范围，不作为发布日期承诺。

## 12. 隐私与安全边界

- SQLite 继续默认只读。
- 不读取或展示 `account`、`control_account` 中的凭据。
- 不展示 access token、refresh token、AK、SK。
- 工具 input/output 默认不进入界面和诊断报告。
- 文件路径、用户名、命令参数和错误详情统一脱敏。
- 导出内容必须显式说明包含哪些字段。
- 任何写操作都不属于本路线图前三阶段。

## 13. 完成定义

一项功能只有同时满足以下条件才算完成：

- 统计口径在 Native SQLite 与 SQL.js 下相同。
- Electron、CLI、VS Code、JetBrains 使用同一个协议语义。
- 数据完整性、筛选范围和采样状态明确。
- 大数据库不会阻塞首屏交互。
- 诊断内容默认脱敏。
- 有正常、空数据、字段缺失、数据库错误和运行中状态。
- 单元、Smoke、E2E、压力和隐私测试通过。
- 文档更新且 `npm test` 全绿。

## 14. 最终优先级

| 方向 | 用户价值 | 数据成熟度 | 与码道差异 | 决策 |
| --- | ---: | ---: | ---: | --- |
| 插件能力对齐桌面端 | 高 | 高 | 产品基础 | P1 |
| 会话 Excel/Markdown/JSON 导出 | 高 | 高 | 中高 | P2 |
| 历史工具执行分析 | 高 | 高 | 高 | P3 |
| 项目效率画像 | 高 | 高 | 中高 | P4 |
| 历史失败与低效诊断 | 高 | 中高 | 高 | P5 |
| 子系统只读健康状态 | 中 | 中 | 中 | 并入诊断页 |
| 会话备份与恢复 | 中 | 中 | 低 | 后置 |
| 普通会话关系图 | 中 | 高 | 低 | 不单独建设 |
| MCP/Agent/Skill 管理 | 中 | 高 | 低 | 不建设 |
| 成本预测 | 低 | 低 | 低 | 不建设 |
| 团队协作与插件生态 | 不确定 | 低 | 不确定 | 暂不进入路线图 |
