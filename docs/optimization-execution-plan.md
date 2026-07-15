# CodeArts Bar 优化执行计划

最后更新：2026-07-15

执行基线：`1.16.34`

## 本轮完成状态

| 工作项 | 状态 | 验证重点 |
|---|---|---|
| 完整聚合口径 | 完成 | 完整历史与 request snapshot 样本不混用 |
| Placeholder 识别 | 完成 | 零 Token 空占位排除，错误/`step-finish` 保留 |
| P95 修正 | 完成 | bucket、模型、多源使用真实 percentile |
| Canonical quota | 完成 | 筛选仅改变分析数据，不改变当前本地状态 |
| 四端筛选协议 | 完成 | Electron、VS Code、JetBrains、CLI 使用相同范围语义 |
| JetBrains 请求契约 | 完成 | `cacheWrite` 保留，非数字 status 不显示“错误 0” |
| JetBrains bundle | 完成 | `<125000` 字节门禁，native/sql.js 与脱敏失败路径均验证 |
| 跨平台 CI | 已配置 | macOS/Linux 测试、构建、资源 smoke、artifact 上传 |
| 真实库对账 | 完成 | all/30d、桌面/CLI、native/sql.js、rollup/no-rollup 数字一致 |
| 100k 性能基线 | 完成 | 热路径 native/sql.js 最大值 140.2ms/165.2ms，冷路径单独记录 |

## 下一轮执行顺序

### 阶段 1：真实数据对账

1. 收集并脱敏多版本数据库样本。
2. 固化 placeholder、缓存字段、错误、旧 usage 字段和中断回复 fixture。
3. 用同一范围/来源/模型查询 Electron、CLI、VS Code、JetBrains。
4. 将差异归因到数据源字段、归一化规则或客户端展示，不以手工调 UI 数字掩盖。

完成条件：四端输出一致，fixture 可重复运行。

### 阶段 2：冷路径体验

1. 以已记录的 10k/50k/100k 基线继续降低首次聚合耗时。
2. 为 rollup 首次构建补充阶段、行数、耗时和失败诊断。
3. 验证 fallback 不阻塞 UI，后台重建不会覆盖新筛选 generation。
4. 只有新基线稳定后，才调整性能预算。

完成条件：首开状态可解释、失败可恢复、热路径门禁不回退。

### 阶段 3：平台发布

1. 手动触发 macOS/Linux workflow 并保存首个绿灯证据。
2. 检查 artifact、asar 资源和 CLI runtime。
3. 在真实平台验证托盘、窗口、数据库发现和 sql.js fallback。
4. 再评估签名、公证和自动更新。

完成条件：Windows、macOS、Linux 的支持范围有明确证据和已知限制。

## 变更门禁

### 数据层

```powershell
npm test
npm run stress:pagination
npm run stress:aggregation
```

必须覆盖：placeholder、P95、scope、完整性字段、native/sql.js 一致性和隐私。

### Electron / VS Code

```powershell
npm run e2e:electron
npm run e2e:vscode
```

必须覆盖：筛选稳定、实时刷新不动界面、canonical quota、分页和日期边界。

### JetBrains

```powershell
node tests/jetbrains-payload-smoke.js
node tests/jetbrains-cli-runtime-smoke.js
npm run build:jetbrains
```

必须覆盖：协议等价、bundle 门禁、native/sql.js、缓存字段、status 和脱敏失败路径。

### 发布

```powershell
npm run smoke:release
npm run smoke:package-resources
git diff --check
```

## 暂不进入主线

- 账号、付费、云同步和服务端遥测。
- 在真实数据对账前继续堆复杂图表。
- 未完成 macOS/Linux 实机验证前宣称完整跨平台支持。
- 用提高体积门禁代替 bundle 减重。
