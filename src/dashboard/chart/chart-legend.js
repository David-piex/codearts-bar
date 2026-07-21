function renderChart(rows, s){
  ensureVisibleSeries();
  const primaryKeys = new Set(['total', 'input', 'output', 'cacheRead']);
  const seriesButtons = SERIES
    .filter((cfg) => primaryKeys.has(cfg.key))
    .map((cfg) => `<button class="series-chip ${visibleSeries.has(cfg.key) ? 'active' : ''}" data-series="${cfg.key}" aria-pressed="${visibleSeries.has(cfg.key) ? 'true' : 'false'}"><i style="--series-color:${cfg.color}"></i>${esc(cfg.label)}</button>`).join('');
  const projectLabel = analyticsProjectFilter === 'all' ? TXT.allProjects : analyticsProjectOptions(s).find((item) => item.key === analyticsProjectFilter)?.label || TXT.noProject;
  return `<section class="chart-card chart-card-lean"><div class="card-head"><div><div class="card-title">${TXT.trend}</div><div class="card-desc">${rangeLabel()} &#183; ${sourceFilter === 'all' ? TXT.allSource : esc(sourceOptions(s).find((x) => x[0] === sourceFilter)?.[1] || sourceFilter)} &#183; ${modelFilter === 'all' ? TXT.allModel : esc(shortModel(modelFilter))} &#183; ${esc(projectLabel)}</div></div><div class="series-panel series-panel-lean" role="group" aria-label="${TXT.chartSeries}">${seriesButtons}</div></div><div class="chart-wrap"><canvas id="usageChart" tabindex="0" role="img" aria-label="${TXT.trend} ${TXT.chartSeries}"></canvas></div></section>`;
}
