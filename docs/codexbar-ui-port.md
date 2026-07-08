# CodexBar UI Port Notes

本项目的 Dashboard v1.10.0 按 CodexBar 的菜单卡片结构做了前端映射，重点参考：

- `upstream-CodexBar/Sources/CodexBar/MenuCardView.swift`
  - Provider header：provider name / subtitle / plan/status 右侧文本
  - `MetricRow`：标题、进度条、百分比/重置/详情行
  - section spacing、divider、紧凑菜单卡片密度
- `upstream-CodexBar/Sources/CodexBar/InlineUsageDashboardContent.swift`
  - 2 列 KPI grid
  - `MiniUsageBars` 58px 高度、底部 baseline、紧凑柱状图
  - detail lines 小字号说明

CodeArts Bar 没有照搬 SwiftUI 源码，而是在 Electron HTML/CSS/Canvas 中做等价 UI 结构：

1. 顶部 Provider Header
   - 左侧 `CA` brand icon
   - 中间 `CodeArts` + 实时/缓存、TTFT、等待、更新时间
   - 右侧状态：正常 / 接近上限 / 高用量

2. 主 Usage Metric
   - 今日 Token 标题
   - used percentage
   - progress bar
   - 今日 token / daily limit
   - reset countdown、remaining、top model

3. Inline Dashboard
   - 今日 / 24h / 7 天 / 历史总量
   - TTFT avg / 等待首内容 / 总等待 / 输出速度
   - 24h hourly token mini bars
   - 回复次数、错误次数、TTFT 样本和峰值小时

4. Compact Lists
   - 模型维度：model、tokens、调用次数、input/output、TTFT、等待
   - 最近会话：标题、目录、更新时间

上游 CodexBar 使用 MIT License，本项目保留 MIT License，并在 README 中说明 UI 结构参考来源。
