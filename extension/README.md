# CodeArts Bar Status

在 VS Code / CodeArts Agent 状态栏显示本地 CodeArts token 用量。

功能：

- 状态栏显示今日 token 用量百分比
- Hover 显示今日、24h、7d、总计、余额线索
- 命令面板支持刷新、显示详情、打开数据目录

默认读取：`~/.codeartsdoer/codearts-data/opencode.db`。

配置项：

- `codeartsBar.dbPath`
- `codeartsBar.dailyLimit`
- `codeartsBar.windowHours`
- `codeartsBar.refreshMs`
