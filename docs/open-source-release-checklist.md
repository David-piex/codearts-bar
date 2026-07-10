# CodeArts Bar 开源发布检查清单

最后更新：2026-07-10  
定位：本地开源开发者工具，类似 CodexBar。优先保障本地体验、性能、诊断、可维护和可发布；商业化能力后置。

---

## 1. 开源首发必须做

### 1.1 性能和交互

- 最大化 / resize 不明显卡顿。
- 桌面端 / CLI source 切换只局部刷新。
- 日期筛选输入不闪、不丢焦点，错误范围不触发 DB 查询。
- Request / Session 分页支持 `20 / 50 / 100`、跳页、越界修正、空页回退。
- 图表 hover / tooltip 不触发整页更新。
- 会话点击只刷新右侧详情。

建议验收命令：

```powershell
npm run e2e:electron
npm run stress:pagination
```

### 1.2 大数据稳定性

- 1k / 10k / 50k / 100k requests 压测。
- 1k / 10k sessions 压测。
- 分别记录 `node:sqlite` 和 `sql.js` 路径。
- 慢聚合超过 300ms 打日志。
- sidecar / rollup 命中后 dashboard 热路径稳定在性能预算内。

建议验收命令：

```powershell
npm run stress:aggregation
npm run stress:aggregation:full
```

### 1.3 诊断中心

必须覆盖：

- CodeArts 未安装。
- 数据库不存在。
- 数据库损坏。
- 权限不足。
- CLI 数据源为空。
- 桌面端数据源为空。
- `node:sqlite` 不可用并 fallback `sql.js`。
- `sql-wasm.wasm` 缺失。
- sidecar 损坏、过期、构建中。
- 最近 crash / error log。

诊断报告要求：

- 可复制。
- 路径脱敏。
- 不包含 prompt 内容。
- 给出用户下一步操作。

### 1.4 发布产物

必须生成：

```text
release/CodeArts-Bar-Setup-<version>-x64.exe
release/CodeArts-Bar-Portable-<version>-x64.exe
release/codearts-bar-cli.zip
release/codearts-bar-status.vsix
release/latest.json
release/SHA256SUMS.txt
release/RELEASE_NOTES.md
```

建议验收命令：

```powershell
npm run build:app
npm run smoke:release
npm run smoke:package-resources
```

### 1.5 README 和用户引导

README 需要写清楚：

- 这是本地工具，不上传 CodeArts 数据。
- App 内优先 `node:sqlite`。
- CLI 使用当前 Node 的 `node:sqlite`，不支持时 fallback `sql.js`。
- 如何打开 Dashboard、设置和诊断。
- 没有数据时如何产生数据。
- 如何提交 issue，最好附诊断报告。

---

## 2. 开源首发不必做

这些不是当前主线：

- 账号体系。
- 付费授权。
- 云同步。
- 服务端遥测。
- 自动更新。
- 强制代码签名。
- 企业级安装策略。

说明：

- 自动更新和签名对商业分发有价值，但开源首发可以先通过 GitHub/Gitee Release、hash 校验和清晰 release notes 解决。
- 账号、付费、云同步会改变产品边界，不适合当前本地开发者工具定位。

---

## 3. 推荐发布门槛

开源首发前至少满足：

```powershell
npm test
npm run e2e:electron
npm run stress:pagination
npm run stress:aggregation
npm run smoke:release
npm run smoke:package-resources
git diff --check
```

如果涉及安装包或 CLI runtime，额外跑：

```powershell
npm run build:app
```

---

## 4. Issue 模板建议字段

建议让用户反馈时提供：

- 操作系统版本。
- CodeArts Bar 版本。
- 使用 App 还是 CLI。
- 当前 sqlite adapter：`node:sqlite` / `sql.js`。
- 是否有 CodeArts 数据。
- 问题截图。
- 脱敏诊断报告。

不要要求用户上传原始数据库或 prompt 内容。
