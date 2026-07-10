# CodeArts Bar 性能压测结果

最后更新：2026-07-10  
定位：开源开发者工具基线压测，不包含账号、付费、云同步等商业闭环。

---

## 1. 聚合压测

命令：

```powershell
npm run stress:aggregation:full
```

覆盖：

- 10k messages / 1,250 sessions
- 50k messages / 6,250 sessions
- 100k messages / 12,500 sessions
- `node:sqlite` 冷路径
- `sql.js` 冷路径
- sidecar / usage rollup 热路径
- 慢聚合日志阈值：300ms

| 数据量 | node:sqlite 冷路径最大耗时 | sql.js 冷路径最大耗时 | sidecar build | node:sqlite 热路径最大耗时 | sql.js 热路径最大耗时 |
|---:|---:|---:|---:|---:|---:|
| 10k messages | 313.0ms | 423.2ms | 268.5ms | 21.4ms | 17.3ms |
| 50k messages | 1568.2ms | 1978.6ms | 1371.0ms | 31.2ms | 25.6ms |
| 100k messages | 2921.4ms | 4033.9ms | 3030.2ms | 46.6ms | 33.2ms |

结论：

- 热路径已经足够开源首发：100k 数据下 sidecar 命中后仍在几十毫秒级。
- 冷路径会明显变慢，尤其是 `sql.js` 100k 首次聚合超过 4s。
- 因此开源版应优先保证：
  - 首屏先用轻量 snapshot / DB page 渲染。
  - 聚合请求避开 resize、source 切换、日期筛选等交互高峰。
  - 诊断中心展示 sidecar / rollup 状态和慢聚合记录。

---

## 2. Electron 真实窗口交互基线

命令：

```powershell
npm run e2e:electron
```

最近一次结果：

```text
resizePerf=116ms
sourceSwitch=8ms
requestPage=2ms
sessionPage=2ms
```

覆盖：

- 最大化 / resize 后页面仍可用。
- resize 性能记录包含 `resizeStart`、`domPatch`、`chartRedraw` 或 `sameSizeSkip`、`resizeEnd`。
- 同尺寸 resize 保留 canvas 节点并跳过 chart redraw。
- 桌面端 / CLI source 切换保留 summary / chart / table slot。
- 请求表、会话表分页只渲染当前页。
- 日期范围弹层在最大化后不越界，非法时间不触发 DB page 查询。

---

## 3. 当前优化策略

已落地：

- resize 期间降低阴影、blur、动画和 hover 成本。
- chart canvas 尺寸没变时跳过 redraw。
- resize 静默期未结束时推迟稳定绘制，记录 `resizeQuietWait`。
- source 切换只局部刷新 summary / chart / table。
- request / session 分页支持 `20 / 50 / 100`、跳页、越界修正、空页回退。
- 大数据 `range=all` chart bucket 计算避免 `Math.min(...largeArray)`。
- 聚合请求在 renderer 侧避开 resize / zoom / view-switching 交互高峰。

后续优先级：

1. 继续优化冷路径 SQL / rollup 构建时间。
2. 对 50k / 100k 真实用户数据库补充端到端首屏压测。
3. 把慢聚合、rollup miss、sidecar rebuild 做成更清晰的诊断提示。
4. 继续减少主进程同步聚合对窗口交互的影响。

