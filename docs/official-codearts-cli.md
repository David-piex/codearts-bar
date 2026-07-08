# CodeArts 官方 CLI 文档核对

核对日期：2026-07-07

官方页面：

- https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0034.html

## 已核对内容

华为云 CodeArts Agent CLI 用户指南的“命令”页列出了 `codearts stats`：

- `codearts stats`：显示 Token 使用量和成本统计信息。
- `codearts stats --days`：显示最近 N 天的统计信息。
- `codearts stats --tools`：显示工具维度的统计数据。
- `codearts stats --models`：显示所有模型用量明细。
- `codearts stats --project`：显示项目的统计数据。

## 对 CodeArts Bar 的实现约束

1. `officialUsage` 只把 `codearts stats` 输出当作官方统计来源。
2. 官方文档没有在 `stats` 参数表里暴露明确 quota reset 时间字段。
3. CodeArts Bar 中的 `quota.resetAt` / `resetInMs` / countdown 因此标记为 `local-inferred`，用于本地软上限和规划，不伪装成官方 quota reset。
4. 如果后续 CodeArts CLI 增加官方 reset 字段，应新增 parser fixture 并把 `quota.source` 从 `local-inferred` 升级为官方来源。

## 相关文件

- `src/officialStats.js`：解析和缓存 `codearts stats`。
- `src/quota.js`：本地推算 quota/reset。
- `tests/fixtures/codearts-stats.txt`：官方 stats 输出格式 fixture。
