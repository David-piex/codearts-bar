# 码道 · 使用分析

在 VS Code / CodeArts Agent 内直接查看本机 CodeArts 使用数据。所有统计均从本地数据库读取，不上传。

## 可视化界面

- 左侧活动栏提供常驻“码道”使用概览
- 状态栏点击直接打开概览侧边栏
- 完整分析面板展示今日、24 小时、7 天和全部范围
- Token 趋势、模型排行、数据源分布和最近会话
- 响应等待、P95、首内容、输出速度、排队时间等性能指标
- 刷新时保留现有内容，后台读取完成后增量更新
- 自动适配 VS Code 浅色、深色和高对比度主题

## 命令

- `码道：打开概览侧边栏`
- `码道：打开完整使用分析`
- `码道：刷新使用数据`
- `码道：打开本地数据目录`

## 数据与隐私

默认读取：`~/.codeartsdoer/codearts-data/opencode.db`。

扩展只读取本地数据，不会上传会话、路径或使用统计。

## 配置

- `codeartsBar.dbPath`
- `codeartsBar.dailyLimit`
- `codeartsBar.windowHours`
- `codeartsBar.refreshMs`
