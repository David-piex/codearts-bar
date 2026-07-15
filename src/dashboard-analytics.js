const analyticsMemo = new WeakMap();
function periodCard(label, stat, tone){ return `<div class="period-card ${tone}"><div class="period-label">${esc(label)}</div><div class="period-value">${compact(stat.total || 0)}</div><div class="period-sub">${n(stat.messages || stat.requests || 0)} ${TXT.requests}</div></div>`; }
function renderPeriodGrid(s){
  const stats = [periodTotal(s, 'today'), periodTotal(s, 'window'), periodTotal(s, 'week'), periodTotal(s, 'all')];
  if(stats.some((item) => item?.unavailable)) return '';
  return `<div class="period-grid">${periodCard(TXT.todayToken, stats[0], 'blue')}${periodCard(TXT.windowToken, stats[1], 'violet')}${periodCard(TXT.weekToken, stats[2], 'green')}${periodCard(TXT.allToken, stats[3], 'slate')}</div>`;
}
function mini(label, value, color){ return `<div class="mini"><div class="label"><span class="dot" style="background:${color}"></span>${esc(label)}</div><div class="value">${esc(value)}</div></div>`; }
function usageProgress(st){ const total = Math.max(1, st.total || 0); const seg = (value, color) => `<i style="--w:${Math.max(0, Math.min(100, (Number(value || 0) / total) * 100))}%; --c:${color}"></i>`; return `<div class="usage-progress"><div class="progress-meta"><span>${TXT.tokenBreakdown} &#183; ${TXT.cacheHitRate} ${cacheHitText(st)} &#183; ${TXT.cacheHitBasis} ${cacheHitBasis(st)}</span><b>${compact(st.total)}</b></div><div class="progress-track">${seg(st.input, COLORS.input)}${seg(st.output, COLORS.output)}${seg(st.cacheWrite, COLORS.cacheWrite)}${seg(st.cacheRead, COLORS.cacheRead)}</div></div>`; }
function aggregateSourceStatsMap(s){
  if(typeof analyticsAggregateReady === 'function' && !analyticsAggregateReady(s)) return null;
  const items = Array.isArray(s?.sourceStats) ? s.sourceStats : [];
  if(!items.length) return null;
  try {
    const scope = currentTrendScopeKey(s, isDayRange());
    if(s?.aggregateScope && s.aggregateScope !== scope) return null;
  } catch {}
  const map = new Map();
  for(const item of items){
    const key = sourceKey(item);
    if(!key || key === 'unknown') continue;
    map.set(key, normalizeUsageMetric(item));
  }
  return map.size ? map : null;
}
function sourceSplitMini(s){
  const opts = sourceOptions(s).filter(([k]) => k === 'desktop' || k === 'cli');
  if(!opts.length) return '';
  const sourceStats = aggregateSourceStatsMap(s);
  if(!sourceStats && !requestRowsAreComplete(s)) return '<div class="cc-source-split"><div class="cc-source-split-head"><span>来源对比</span><em>正在读取完整来源聚合，当前请求列表仅为样本</em></div></div>';
  const allStat = sourceStats ? [...sourceStats.values()].reduce((a, item) => {
    a.total += item.total || 0; a.input += item.input || 0; a.output += item.output || 0; a.cacheRead += item.cacheRead || 0; a.cacheWrite += item.cacheWrite || 0; a.requests += item.requests || 0; return a;
  }, { total:0, input:0, output:0, cacheRead:0, cacheWrite:0, requests:0 }) : sumReq(filterRows(s, { source: 'all' }));
  const all = Math.max(1, allStat.total || 0);
  const cards = opts.map(([k, label]) => {
    const st = sourceStats?.get(k) || sumReq(filterRows(s, { source: k }));
    const pct = Math.max(0, Math.min(100, ((st.total || 0) / all) * 100));
    const active = sourceFilter === k ? 'active' : '';
    return `<button class="cc-source-mini ${active}" data-source="${esc(k)}" aria-pressed="${sourceFilter === k ? 'true' : 'false'}"><span class="source-icon" style="background:${sourceColor(k)}">${sourceIcon(k)}</span><span><b>${esc(label)}</b><em>${n(st.requests)} ${TXT.requests} / ${sourceSessions(s, k)} ${TXT.session} / ${TXT.cacheHitRate} ${cacheHitText(st)}</em></span><strong>${compact(st.total)}</strong><i style="--w:${pct}%"></i></button>`;
  }).join('');
  return `<div class="cc-source-split"><div class="cc-source-split-head"><span>${TXT.sourceCompare}</span><em>${TXT.sourceCompareHint}</em></div><div class="cc-source-split-grid">${cards}</div></div>`;
}
function compactStat(label, value, sub, color){ return `<div class="compact-stat"><div><span class="dot" style="background:${color}"></span>${esc(label)}</div><strong>${esc(value)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`; }
function compactModelRows(rows, limit = 5){
  const aggregateGroups = typeof aggregateModelStatsForView === 'function' ? aggregateModelStatsForView(snapshot) : null;
  if(!aggregateGroups && typeof requestRowsAreComplete === 'function' && !requestRowsAreComplete(snapshot)) return '<div class="compact-empty">正在读取完整模型聚合，当前请求列表仅为样本</div>';
  const groups = (aggregateGroups || groupBy(rows, (r) => r.model)).slice(0, limit);
  const max = Math.max(1, ...groups.map((g) => g.stats.total || 0));
  if(!groups.length) return `<div class="compact-empty">${TXT.emptyHint}</div>`;
  return `<div class="compact-list">${groups.map((g) => `<div class="compact-row"><div><b>${esc(shortModel(g.key))}</b><span>${n(g.stats.requests)} ${TXT.requests} · ${TXT.ttft} ${ms(avg(g.stats.ttfts))}</span></div><strong>${compact(g.stats.total)}</strong><i style="--w:${Math.max(4, Math.min(100, ((g.stats.total || 0) / max) * 100))}%"></i></div>`).join('')}</div>`;
}
function compactSourcePill(s){
  const st = summaryUsageForView(filterRows(s), s);
  const sample = sumReq(filterRows(s));
  const source = sourceFilter === 'all' ? TXT.allSource : sourceLabelFor(s, sourceFilter);
  const model = modelFilter === 'all' ? TXT.allModel : shortModel(modelFilter);
  const note = analyticsAggregateReady(s) && Number(st.requests || 0) > Number(sample.requests || 0) ? ` · 当前页样本 ${n(sample.requests || 0)}` : (!requestRowsAreComplete(s) ? ` · 当前页样本 ${n(sample.requests || 0)}` : '');
  return `<div class="compact-filter-pill"><span>${rangeLabel()}</span><span>${esc(source)}</span><span>${esc(model)}</span><b>${n(st.requests)} ${TXT.requests}${note}</b><b>${TXT.cacheHitRate} ${cacheHitText(st)}</b></div>`;
}
function compactPaneTabs(){
  if(compactPane === 'sessions') compactPane = 'overview';
  const panes = [['overview', '\u6982\u89c8'], ['sources', '\u6765\u6e90']];
  return `<div class="compact-pane-tabs" role="group" aria-label="\u5361\u7247\u89c6\u56fe">${panes.map(([key, label]) => `<button data-compact-pane="${key}" class="${compactPane === key ? 'active' : ''}" aria-pressed="${compactPane === key ? 'true' : 'false'}">${label}</button>`).join('')}</div>`;
}
function compactControlsHtml(){
  return `<div class="compact-controls compact-controls-simple"><button data-compact-pin="1" class="${compactPinned ? 'active' : ''}" aria-pressed="${compactPinned ? 'true' : 'false'}">${compactPinned ? '\u5df2\u56fa\u5b9a' : '\u56fa\u5b9a\u5728\u6700\u524d'}</button><span>${compactPinned ? '\u7a97\u53e3\u5c06\u4fdd\u6301\u524d\u7f6e' : '\u9700\u8981\u76ef\u76d8\u65f6\u6253\u5f00'}</span></div>`;
}
function renderCompactMenu(s, rows){
  const st = sumReq(rows);
  const q = queueForRange(s);
  const todayStat = periodTotal(s, 'today');
  const windowStat = periodTotal(s, 'window');
  const modelRows = rows.length ? rows : filterRows(s, { range: '1d' });
  const modelScope = rows.length ? rangeLabel() : '24h';
  const hourly = compactHourlyBuckets(s);
  const peak = hourly.reduce((best, b) => (b.total || 0) > (best.total || 0) ? b : best, hourly[0] || { total: 0, start: Date.now() });
  const peakLabel = new Date(peak.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const selectedSource = sourceLabelFor(s, sourceFilter);
  const hero = `<div class="compact-hero"><div><span>${TXT.realTokens}</span><strong>${n(st.total)}</strong><em>${compact(st.total)} &#183; ${sourceFilter === 'all' ? TXT.all : esc(selectedSource)}</em></div>${cacheRingHtml(st, 'compact-ring')}</div><div class="compact-progress"><i style="--w:${Math.max(0, Math.min(100, ((st.input || 0) / Math.max(1, st.total || 1)) * 100))}%; --c:${COLORS.input}"></i><i style="--w:${Math.max(0, Math.min(100, ((st.output || 0) / Math.max(1, st.total || 1)) * 100))}%; --c:${COLORS.output}"></i><i style="--w:${Math.max(0, Math.min(100, ((st.cacheWrite || 0) / Math.max(1, st.total || 1)) * 100))}%; --c:${COLORS.cacheWrite}"></i><i style="--w:${Math.max(0, Math.min(100, ((st.cacheRead || 0) / Math.max(1, st.total || 1)) * 100))}%; --c:${COLORS.cacheRead}"></i></div>`;
  const overviewPane = `${hero}<div class="compact-stat-grid">${compactStat(TXT.todayToken, compact(todayStat.total || 0), `${n(todayStat.requests || todayStat.messages || 0)} ${TXT.requests}`, COLORS.input)}${compactStat(TXT.windowToken, compact(windowStat.total || 0), `${n(windowStat.requests || windowStat.messages || 0)} ${TXT.requests}`, COLORS.cacheRead)}${compactStat(TXT.cacheEfficiency, cacheHitText(st), `${TXT.cacheHitBasis} ${cacheHitBasis(st)}`, COLORS.purple)}${compactStat(TXT.ttft, ms(avg(st.ttfts)), `${TXT.avg} TTFT`, COLORS.wait)}${compactStat(TXT.wait, ms(avg(st.latencies)), `${TXT.queue} ${q.samples ? ms(q.avg) : emptyMetric()}`, COLORS.queue)}${compactStat(TXT.peakHour, `${peakLabel} &#183; ${compact(peak.total)}`, '24h', COLORS.total)}</div><div class="compact-section"><div class="compact-section-head"><b>${TXT.windowToken}</b><span>${TXT.hoverHint}</span></div>${compactBars(s)}</div><div class="compact-section"><div class="compact-section-head"><b>${TXT.modelStats}</b><span>${esc(modelScope)} &#183; ${n(groupBy(modelRows, (r) => r.model).length)} ${TXT.model}</span></div>${compactModelRows(modelRows, 3)}</div>`;
  const sourcePane = `<div class="compact-panel-head"><b>${TXT.sourceCompare}</b><span>${TXT.currentFilter}</span></div>${sourceSplitMini(s)}<div class="compact-section"><div class="compact-section-head"><b>${TXT.cacheInsights}</b><span>${TXT.cacheHitRate} ${cacheHitText(st)}</span></div>${cacheEfficiencyPanel(st, 'summary-cache')}</div>`;
  const panes = { overview: overviewPane, sources: sourcePane };
  return `<div class="compact-stage single"><section class="codex-compact-card compact-single-card"><div class="compact-provider"><div class="logo compact-logo"><img src="../assets/codearts-logo.png" width="29" height="29" decoding="async" draggable="false" /></div><div><h2>${TXT.compactTitle}</h2><p>${TXT.compactHint}</p></div><span>${TXT.realtime}</span></div>${compactSourcePill(s)}${compactControlsHtml()}${compactPaneTabs()}<div class="compact-pane">${panes[compactPane] || panes.overview}</div></section></div>`;
}

function sourceSessions(s, key){
  const summary = s?.sessionSummary || {};
  if(key === 'all') return Number(summary.total ?? summary.active ?? s?.sessionTotal ?? (s.sessions || []).length);
  const bySource = Array.isArray(summary.bySource) ? summary.bySource : [];
  const hit = bySource.find((item) => sourceKey(item) === key || String(item.source || '') === key);
  if(hit) return Number(hit.total ?? hit.active ?? 0);
  if(Number(s?.sessionTotal || 0) > (s.sessions || []).length) return 0;
  return (s.sessions || []).filter((item) => sourceKey(item) === key).length;
}
function sourceBars(rows, s){ const data = bucketRows(rows, s).slice(-24); const max = Math.max(1, ...data.map((b) => b.total || 0)); return `<div class="source-bars">${data.map((b) => { const h = Math.max(2, Math.round(((b.total || 0) / max) * 34)); const d = new Date(b.start); const label = isDayRange() ? d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); return `<span style="height:${h}px" title="${esc(label)} \u00b7 ${n(b.total || 0)} token"></span>`; }).join('')}</div>`; }
function sourceFacts(st, sessions){ return `<div class="source-facts"><span>${n(st.requests)} ${TXT.requests}</span><span>${sessions} ${TXT.session}</span><span>${TXT.cacheHitRate} ${cacheHitText(st)}</span><span>${TXT.cacheRead} ${compact(st.cacheRead || 0)}</span><span>${TXT.wait} ${ms(avg(st.latencies))}</span></div>`; }
function usageTotalTile(label, value, tone, sub = ''){
  return `<div class="usage-total-tile ${tone || ''}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub ? `<em>${esc(sub)}</em>` : ''}</div>`;
}
function usageTotalProvenance(s, st){
  if(st?.incomplete) return '\u672c\u5730\u6570\u636e\u5e93 \u00b7 \u805a\u5408\u4e2d';
  const range = normalizeRangeFilter(rangeFilter);
  const exactSnapshotRange = sourceFilter === 'all'
    && modelFilter === 'all'
    && ['today', '1d', '7d', 'all'].includes(range);
  if(analyticsAggregateReady(s) || summaryOnlyUsageForView(s) || exactSnapshotRange){
    return '\u672c\u5730\u6570\u636e\u5e93 \u00b7 \u5b8c\u6574\u603b\u91cf';
  }
  if(requestRowsAreComplete(s)) return '\u672c\u5730\u6570\u636e\u5e93 \u00b7 \u5b8c\u6574\u8bb0\u5f55';
  return '\u672c\u5730\u6570\u636e\u5e93 \u00b7 \u5f53\u524d\u9875\u6837\u672c';
}
function renderUsageTotalBoard(st, selectedSource, selectedModel, s){
  const hit = cacheHitRate(st);
  const hitW = Math.max(0, Math.min(100, Number.isFinite(hit) ? hit : 0));
  const health = cacheHealth(st);
  const reuse = multipleUi(cacheReuseValue(st));
  const total = Math.max(1, Number(st.total || 0));
  const pct = (value) => percent((Number(value || 0) / total) * 100);
  return `<div class="usage-total-board cache-${health.tone}" style="--cache-hit:${hitW}%"><div class="usage-total-hero"><div class="usage-total-main"><div class="usage-total-icon" aria-hidden="true"><span></span></div><div><div class="usage-total-label">${TXT.realTokens}<small class="usage-total-provenance">${usageTotalProvenance(s, st)}</small></div><div class="usage-total-value">${n(st.total)}<span>&#8776; ${compact(st.total)}</span></div></div></div><div class="usage-total-request"><span>\u603b\u8bf7\u6c42\u6570</span><strong>${n(st.requests)}</strong><em>${rangeLabel()} / ${esc(selectedSource)} / ${esc(selectedModel)}</em><i class="usage-total-request-spark" aria-hidden="true"><small></small><small></small><small></small><small></small></i></div></div><div class="usage-total-strip">${usageTotalTile('\u65b0\u589e\u8f93\u5165', compact(st.input || 0), 'input', pct(st.input))}${usageTotalTile(TXT.output, compact(st.output || 0), 'output', pct(st.output))}${usageTotalTile('\u521b\u5efa', compact(st.cacheWrite || 0), 'create', pct(st.cacheWrite))}${usageTotalTile('\u547d\u4e2d', compact(st.cacheRead || 0), 'hit', pct(st.cacheRead))}<div class="usage-total-tile usage-total-cache"><div><span>${TXT.cacheHitRate}</span><b>${cacheHitText(st)}</b></div><i><em></em></i><small>${TXT.cacheHitBasis} ${cacheHitBasis(st)} &#183; ${health.label}${reuse !== emptyMetric() ? ` &#183; ${reuse}` : ''}</small></div></div></div>`;
}
function renderSummary(rows, s){
  const st = summaryUsageForView(rows, s);
  const selectedSource = sourceLabelFor(s, sourceFilter);
  const selectedModel = modelFilter === 'all' ? TXT.allModel : shortModel(modelFilter);
  return `<section class="summary-card usage-summary cc-usage-summary">${renderUsageTotalBoard(st, selectedSource, selectedModel, s)}</section>`;
}
function renderUsageDetails(rows, s){
  const st = summaryUsageForView(rows, s);
  const sample = sumReq(rows);
  const sampleCount = Number(sample.requests || rows.length || 0);
  const sampleNote = analyticsAggregateReady(s) && Number(st.requests || 0) > sampleCount
    ? ` · 当前页样本 ${n(sampleCount)}`
    : (!requestRowsAreComplete(s) ? ` · 当前页样本 ${n(sampleCount)}` : '');
  const incompleteNote = st.incomplete ? '<div class="filter-note"><b>正在读取完整聚合</b><span>当前请求列表仅显示最近样本，暂不计算高级明细。</span></div>' : '';
  const q = queueForRange(s);
  const status = st.errors ? `${n(st.errors)} ${TXT.errorCount || '错误'}` : '200';
  const selectedSource = sourceLabelFor(s, sourceFilter);
  const selectedModel = modelFilter === 'all' ? TXT.allModel : shortModel(modelFilter);
  return `<section class="usage-detail-stack usage-detail-section">${incompleteNote}<div class="summary-top usage-detail-head"><div class="filter-note"><b>${TXT.currentFilter}</b><span>${rangeLabel()} / ${esc(selectedSource)} / ${esc(selectedModel)}</span><em>${TXT.liveAfterReply}${sampleNote}</em></div></div><div class="summary-kpi-row cc-kpi-row">${mini(TXT.input, compact(st.input), COLORS.input)}${mini(TXT.output, compact(st.output), COLORS.output)}${mini(TXT.cacheWrite, compact(st.cacheWrite), COLORS.cacheWrite)}${mini(TXT.cacheRead, compact(st.cacheRead), COLORS.cacheRead)}${mini(TXT.cacheHitRate, cacheHitText(st), COLORS.purple)}</div>${cacheEfficiencyPanel(st, 'summary-cache')}${idleTimelineHtml(s)}${usageProgress(st)}${sourceSplitMini(s)}${renderPeriodGrid(s)}<div class="mini-grid perf-grid">${mini(TXT.requests, n(st.requests), COLORS.total)}${mini(TXT.ttft, ms(avg(sample.ttfts)), COLORS.cacheRead)}${mini(TXT.firstContent, ms(avg(sample.firstContents)), COLORS.wait)}${mini(TXT.wait, ms(avg(sample.latencies)), COLORS.queue)}${mini(TXT.speed, rate(avg(sample.speeds)), COLORS.output)}${mini(TXT.queue, q.samples ? ms(q.avg) : emptyMetric(), COLORS.queue)}${mini(TXT.status, status, st.errors ? COLORS.red : COLORS.green)}${mini(TXT.source, sourceFilter === 'all' ? TXT.all : selectedSource, COLORS.muted)}</div></section>`;
}
function renderAnalyticsAdvanced(rows, s){
  if(!analyticsAdvancedOpen){
    return `<section class="analytics-advanced-shell collapsed"><div class="analytics-advanced-head"><div class="analytics-advanced-copy"><b>${TXT.advancedAnalytics}</b><span>${TXT.advancedAnalyticsHint}</span></div><button data-analytics-advanced-toggle="1" aria-expanded="false">${TXT.showAdvanced}</button></div></section>`;
  }
  return `<section class="analytics-advanced-shell"><div class="analytics-advanced-head"><div class="analytics-advanced-copy"><b>${TXT.advancedAnalytics}</b><span>${TXT.advancedAnalyticsHint}</span></div><button data-analytics-advanced-toggle="1" aria-expanded="true">${TXT.hideAdvanced}</button></div>${renderUsageDetails(rows, s)}${renderSourceOverview(s)}${renderCacheInsights(rows, s)}</section>`;
}

function renderSourceOverview(s){
  const aggregate = analyticsAggregateReady(s) ? aggregateSourceStatsMap(s) : null;
  const base = filterRows(s, { source: 'all' });
  const opts = [['all', TXT.allSource], ...sourceOptions(s)];
  const unique = [...new Map(opts).entries()];
  const cards = unique.map(([k, label]) => {
    const rows = k === 'all' ? base : base.filter((r) => sourceKey(r) === k);
    const st = aggregate
      ? (k === 'all'
        ? [...aggregate.values()].reduce((acc, item) => {
          for(const key of ['total','input','output','reasoning','cacheRead','cacheWrite','requests','errors']) acc[key] += Number(item[key] || 0);
          return acc;
        }, { total:0,input:0,output:0,reasoning:0,cacheRead:0,cacheWrite:0,requests:0,errors:0 })
        : aggregate.get(k) || normalizeUsageMetric({}))
      : requestRowsAreComplete(s) ? sumReq(rows) : normalizeUsageMetric({});
    const sessions = sourceSessions(s, k);
    const active = sourceFilter === k ? 'active' : '';
    const sampleHint = aggregate ? '' : (requestRowsAreComplete(s) ? '' : ' · 样本');
    return `<button class="source-card ${active}" data-source="${esc(k)}" aria-pressed="${sourceFilter === k ? 'true' : 'false'}"><span class="source-mark" style="background:${sourceColor(k)}">${sourceIcon(k)}</span><span class="source-name">${esc(label)}</span><strong>${aggregate || requestRowsAreComplete(s) ? compact(st.total) : '--'}</strong><small>${rangeLabel()} token${sampleHint}</small>${requestRowsAreComplete(s) ? sourceBars(rows, s) : ''}${sourceFacts(st, sessions)}</button>`;
  }).join('');
  const note = aggregate ? '' : (requestRowsAreComplete(s) ? '' : '<span class="muted">正在读取完整来源聚合，当前请求列表仅为样本</span>');
  return `<section class="source-overview cc-source-overview"><div class="section-head"><div><div class="section-title">${TXT.sourceOverview}</div><p>${TXT.sourceHint}</p></div><span>${rangeLabel()} ${note}</span></div><div class="source-grid">${cards}</div></section>`;
}
function cacheInsightAction(st){
  const hit = cacheHitRate(st);
  if(hit == null) return TXT.cacheActionNone;
  if(hit < 25) return TXT.cacheActionLow;
  if(hit < 60) return TXT.cacheActionMid;
  return TXT.cacheActionHigh;
}
function cacheOpportunityScore(st){
  const total = Number(st?.total || 0);
  const hit = cacheHitRate(st);
  const miss = hit == null ? .72 : Math.max(.08, (100 - hit) / 100);
  const inputWeight = Number(st?.input || 0) / Math.max(1, total);
  return Math.round(total * miss * (1 + Math.min(.65, inputWeight)));
}
function cacheInsightRow(item, maxScore){
  const st = item.stats || {};
  const health = cacheHealth(st);
  const hit = cacheHitRate(st);
  const score = cacheOpportunityScore(st);
  const scoreW = Math.max(5, Math.min(100, (score / Math.max(1, maxScore)) * 100));
  const hitW = Math.max(0, Math.min(100, hit || 0));
  const attrs = item.model ? `data-cache-model="${esc(item.model)}"` : item.source ? `data-source="${esc(item.source)}"` : item.project ? `data-cache-project="${esc(item.project)}"` : '';
  return `<button class="cache-insight-row ${health.tone}" ${attrs}><span class="cache-insight-main"><b>${esc(item.label)}</b><em>${n(st.requests || 0)} ${TXT.requests} / ${TXT.cacheHitRate} ${cacheHitText(st)} / ${health.label}</em></span><span class="cache-insight-metrics"><strong>${compact(st.total || 0)}</strong><small>${TXT.cacheReadShort} ${compact(st.cacheRead || 0)} / ${TXT.cacheCreateShort} ${compact(st.cacheWrite || 0)}</small></span><span class="cache-insight-score"><i style="--score:${scoreW}%; --hit:${hitW}%"></i><em>${TXT.cacheOpportunityScore} ${compact(score)}</em></span><span class="cache-insight-action">${esc(cacheInsightAction(st))}</span></button>`;
}
function projectRowsForCacheInsights(rows, s){
  const bySession = new Map((s.sessions || []).map((item) => [String(item.id || ''), item]));
  const map = new Map();
  for(const r of rows){
    const session = bySession.get(String(r.sessionId || ''));
    const project = session ? sessionProjectKey(session) : (r.directory ? String(r.directory) : '__none');
    const label = session ? sessionProjectName(session) : (r.directory ? String(r.directory).split(/[\\/]/).filter(Boolean).pop() : TXT.noProject);
    const bucket = map.get(project) || { key: project, label, rows: [] };
    bucket.rows.push(r);
    map.set(project, bucket);
  }
  return [...map.values()].map((x) => ({ project: x.key, label: x.label, stats: sumReq(x.rows) })).sort((a, b) => cacheOpportunityScore(b.stats) - cacheOpportunityScore(a.stats));
}
function renderCacheInsights(rows, s){
  if(analyticsAggregateReady(s) && Array.isArray(s?.models) && Array.isArray(s?.sourceStats)){
    const sourceStats = aggregateSourceStatsMap(s);
    const modelItems = (s.models || []).slice(0, 4).map((m) => ({ model: m.model || m.name || m.key, label: shortModel(m.model || m.name || m.key), stats: normalizeUsageMetric(m) }));
    const sourceItems = sourceStats ? [...sourceStats.entries()].map(([key, stats]) => ({ source:key, label:sourceDisplayLabel(key), stats })).slice(0, 3) : [];
    const allItems = [...modelItems, ...sourceItems];
    const maxScore = Math.max(1, ...allItems.map((x) => cacheOpportunityScore(x.stats || {})));
    const panel = (title, items) => `<div class="cache-insight-panel"><div class="cache-insight-panel-head"><b>${esc(title)}</b><span>${n(items.length)} ${TXT.rows}</span></div><div class="cache-insight-list">${items.length ? items.map((item) => cacheInsightRow(item, maxScore)).join('') : `<div class="compact-empty">${TXT.emptyHint}</div>`}</div></div>`;
    return `<section class="cache-insights"><div class="section-head"><div><div class="section-title">${TXT.cacheInsights}</div><p>${TXT.cacheInsightsHint}</p></div><span>${rangeLabel()} · ${TXT.page || '分页'}聚合</span></div><div class="cache-insight-grid">${panel(TXT.cacheInsightModel, modelItems)}${panel(TXT.cacheInsightSource, sourceItems)}</div></section>`;
  }
  if(!analyticsAggregateReady(s) && !requestRowsAreComplete(s)) return '<section class="cache-insights"><div class="section-head"><div><div class="section-title">缓存命中中心</div><p>正在读取完整模型与来源聚合，当前请求列表仅为样本</p></div></div></section>';
  const scoped = applyTableSearch(rows);
  const base = scoped.length ? scoped : rows;
  if(!base.length) return '';
  const modelItems = groupBy(base, (r) => r.model).map((g) => ({ model: g.key, label: shortModel(g.key), stats: g.stats })).sort((a, b) => cacheOpportunityScore(b.stats) - cacheOpportunityScore(a.stats)).slice(0, 4);
  const projectItems = projectRowsForCacheInsights(base, s).slice(0, 4);
  const sourceItems = groupBy(base, (r) => sourceKey(r)).map((g) => ({ source: g.key, label: sourceDisplayLabel(g.key), stats: g.stats })).sort((a, b) => cacheOpportunityScore(b.stats) - cacheOpportunityScore(a.stats)).slice(0, 3);
  const allItems = [...modelItems, ...projectItems, ...sourceItems];
  const maxScore = Math.max(1, ...allItems.map((x) => cacheOpportunityScore(x.stats || {})));
  const panel = (title, items) => `<div class="cache-insight-panel"><div class="cache-insight-panel-head"><b>${esc(title)}</b><span>${n(items.length)} ${TXT.rows}</span></div><div class="cache-insight-list">${items.length ? items.map((item) => cacheInsightRow(item, maxScore)).join('') : `<div class="compact-empty">${TXT.emptyHint}</div>`}</div></div>`;
  return `<section class="cache-insights"><div class="section-head"><div><div class="section-title">${TXT.cacheInsights}</div><p>${TXT.cacheInsightsHint}</p></div><span>${rangeLabel()}</span></div><div class="cache-insight-grid">${panel(TXT.cacheInsightModel, modelItems)}${panel(TXT.cacheInsightProject, projectItems)}${panel(TXT.cacheInsightSource, sourceItems)}</div></section>`;
}
