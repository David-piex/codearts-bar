function defaultChartMeta(){ return `${TXT.hoverHint} · ${TXT.pinPoint}`; }

function chartTokenTrendMeta(){ return `${TXT.total} &#183; ${TXT.input} &#183; ${TXT.output} &#183; ${TXT.cacheRead}`; }

function defaultChartScrubber(){ return `<b>${TXT.trend}</b><span>${chartTokenTrendMeta()}</span>`; }

function chartScrubberHtml(title, b, health, hit, pinned = false, focus = null){
  const active = Number(b.requests || 0) > 0;
  return `<b>${esc(title)}</b>${pinned ? `<span class="scrubber-pin">${TXT.pinnedPoint}</span>` : ''}<span>${active ? `${TXT.requests} ${n(b.requests || 0)}` : TXT.idleHours}</span><span>${TXT.total} ${n(b.total || 0)}</span><span>${TXT.input} ${n(b.input || 0)}</span><span>${TXT.output} ${n(b.output || 0)}</span><span>${TXT.cacheRead} ${n(b.cacheRead || 0)}</span>`;
}

function renderChart(rows, s){
  ensureVisibleSeries();
  const primaryKeys = new Set(['total', 'input', 'output', 'cacheRead']);
  const seriesButtons = SERIES
    .filter((cfg) => primaryKeys.has(cfg.key))
    .map((cfg) => `<button class="series-chip ${visibleSeries.has(cfg.key) ? 'active' : ''}" data-series="${cfg.key}" aria-pressed="${visibleSeries.has(cfg.key) ? 'true' : 'false'}"><i style="--series-color:${cfg.color}"></i>${esc(cfg.label)}</button>`).join('');
  const projectLabel = analyticsProjectFilter === 'all' ? TXT.allProjects : analyticsProjectOptions(s).find((item) => item.key === analyticsProjectFilter)?.label || TXT.noProject;
  return `<section class="chart-card chart-card-lean"><div class="card-head"><div><div class="card-title">${TXT.trend}</div><div class="card-desc">${rangeLabel()} &#183; ${sourceFilter === 'all' ? TXT.allSource : esc(sourceOptions(s).find((x) => x[0] === sourceFilter)?.[1] || sourceFilter)} &#183; ${modelFilter === 'all' ? TXT.allModel : esc(shortModel(modelFilter))} &#183; ${esc(projectLabel)}</div></div><div class="series-panel series-panel-lean" role="group" aria-label="${TXT.chartSeries}">${seriesButtons}</div></div><div class="chart-wrap"><canvas id="usageChart" tabindex="0" role="img" aria-label="${TXT.trend} ${TXT.chartSeries}"></canvas></div></section>`;
}
