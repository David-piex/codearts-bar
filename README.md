# CodeArts Bar

CodeArts Bar 是给 CodeArts Agent / 码道用的本地 Token Bar：托盘打开后直接看到 token、模型、TTFT、等待时长和最近会话。

## 当前方向

Dashboard 已收敛为 CodexBar 风格的简洁菜单卡片：

- 今日 token 总量
- 最近 24h token 总量
- 最近 7 天 token 总量
- 历史总 token 总量
- 今日进度条、剩余 token、重置倒计时
- 模型维度：tokens、调用次数、input/output、TTFT、等待
- 性能：TTFT avg、等待首内容、总等待、输出速度
- 24h token mini bars
- 最近会话

UI 结构参考了上游 CodexBar 的 SwiftUI 前端：

- `MenuCardView.swift`：Provider header、MetricRow、progress/detail rows、divider/spacing
- `InlineUsageDashboardContent.swift`：2 列 KPI、58px mini bars、detail lines

说明见：`docs/codexbar-ui-port.md`

## 实时更新

- 默认每 15 秒刷新一次。
- 监听 `opencode.db` / `opencode.db-wal` / `opencode.db-shm`。
- 对话结束写库后，Dashboard 会在 debounce 后自动刷新。

## 统计能力

- Token：今日、24h、7d、总计；input/output/reasoning/cache read/cache write
- 性能：latency avg/P50/P90/P95/P99、TTFT、first event/content approx、tokens/s、错误率
- TTFT：解析 kernel 日志里的 `Infer stream first token generated in ...ms`，并保留 part 表近似 first event/content
- 模型：token、调用、错误、性能
- 趋势：24h hourly、14d daily buckets
- 会话：最近会话、目录、版本、更新时间
- 官方统计：配置 `CODEARTS_CLI_AK` / `CODEARTS_CLI_SK` 后读取 `codearts stats`

## 官方文档核对

已按华为云 CodeArts Agent CLI 用户指南核对 `stats` 命令。官方说明 `codearts stats` 用于 Token 使用量和成本统计，并支持 `--days`、`--project`、`--models`、`--tools` 等参数。文档未暴露明确的额度 reset 时间字段，所以当前 reset/countdown 是本地推算，标记为 `local-inferred`。

详见：`docs/official-codearts-cli.md`

## CLI

??????

```powershell
node src/cli.js stats
node src/cli.js snapshot
node src/cli.js auth
node src/cli.js providers
node src/cli.js runtime
node src/cli.js official-cache
node src/cli.js diagnose
node src/cli.js config show
```

??????????/ ?? CLI zip?

```powershell
codearts-bar.cmd stats
codearts-bar.cmd snapshot
codearts-bar.cmd runtime
```

??????

- ??? CLI ?? Electron ?? Node ?????????? Node?
- ?? CLI zip ?????? `node.exe`????????? `node`?
- SQLite ???? `node:sqlite`?????????????? `sql.js + wasm`?
- `runtime` ??????? `process.execPath`?Node ??? SQLite adapter?

## 生成版本

```powershell
npm run release
```

产物：

```text
release/codearts-bar-status.vsix
release/CodeArts-Bar-<version>-x64.exe
release/codearts-bar-cli.zip
```
