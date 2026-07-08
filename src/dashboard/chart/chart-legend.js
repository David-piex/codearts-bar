function defaultChartMeta(){ return `${TXT.hoverHint} &#183; ${TXT.pinPoint}`; }

function defaultChartScrubber(){ return `<b>${TXT.chartLegend}</b><span>${TXT.hoverHint}</span><span>${TXT.cacheHeatline}</span><i style="--hit:0%"><em></em></i>`; }

function chartScrubberHtml(title, b, health, hit, pinned = false, focus = null){
  const active = Number(b.requests || 0) > 0;
  const focusText = focus?.label ? `<span class="scrubber-focus">${esc(focus.label)} ${seriesLabel(focus, focus.value)}</span>` : '';
  return `<b>${esc(title)}</b>${pinned ? `<span class="scrubber-pin">${TXT.pinnedPoint}</span>` : ''}<span>${active ? `${TXT.requests} ${n(b.requests || 0)}` : TXT.idleHours}</span><span>${TXT.total} ${compact(b.total || 0)}</span>${focusText}<span class="scrubber-cache ${health.tone}">${TXT.cacheHitRate} ${cacheHitText(b)} &#183; ${health.label}</span><i class="${health.tone}" style="--hit:${hit}%"><em></em></i>`;
}

function chartSnapshotHtml(rows, s){
  const data = bucketRows(rows, s);
  const cards = SERIES.map((cfg) => {
    const values = data.map((b) => Number(b[cfg.key] || 0));
    const activeValues = data.filter((b) => Number(b.requests || 0) > 0).map((b) => Number(b[cfg.key] || 0));
    const relevant = activeValues.length ? activeValues : values;
    const peak = Math.max(0, ...values);
    const average = avg(relevant) || 0;
    const selected = visibleSeries.has(cfg.key);
    return `<button class="chart-snapshot-card ${selected ? 'active' : ''}" data-series="${cfg.key}" aria-pressed="${selected ? 'true' : 'false'}" style="--series:${cfg.color}"><span><i></i>${esc(cfg.label)}</span><strong>${chartSeriesMainValue(cfg, values, activeValues)}</strong><em>${TXT.chartPeak} ${seriesLabel(cfg, peak)} / ${TXT.chartAvg} ${seriesLabel(cfg, average)}</em></button>`;
  }).join('');
  return `<div class="chart-snapshot"><div class="chart-snapshot-head"><b>${TXT.chartSnapshot}</b><span>${TXT.chartSnapshotHint}</span></div><div class="chart-snapshot-grid">${cards}</div></div>`;
}

function renderChart(rows, s){
  const activeCfgs = SERIES.filter((cfg) => visibleSeries.has(cfg.key));
  const mixedScale = new Set(activeCfgs.map((cfg) => cfg.kind)).size > 1;
  const idleInfo = idleSummary(s);
  const idleText = `${TXT.idleHours} ${shortDuration(idleInfo.idleMs)}`;
  const stateText = idleInfo.currentIdle ? TXT.idleNow : TXT.activeHour;
  const seriesButtons = SERIES.map((cfg) => `<button class="series-chip ${visibleSeries.has(cfg.key) ? 'active' : ''}" data-series="${cfg.key}" aria-pressed="${visibleSeries.has(cfg.key) ? 'true' : 'false'}"><i style="background:${cfg.color}"></i>${esc(cfg.label)}</button>`).join('');
  const legend = `<div class="chart-legend" aria-label="${TXT.chartLegend}"><span>${TXT.chartLegend}</span><b class="legend-item active"><i></i>${TXT.activeBand}</b><b class="legend-item idle"><i></i>${TXT.idleBand}</b><b class="legend-item cache"><i></i>${TXT.cacheHeatline}</b><b class="legend-item pinned"><i></i>${TXT.pinnedPoint}</b><em>${esc(idleText)} &#183; ${esc(stateText)}</em></div>`;
  return `<section class="chart-card"><div class="card-head"><div><div class="card-title">${TXT.trend}</div><div class="card-desc">${rangeLabel()} &#183; ${sourceFilter === 'all' ? TXT.allSource : esc(sourceOptions(s).find((x) => x[0] === sourceFilter)?.[1] || sourceFilter)} &#183; ${modelFilter === 'all' ? TXT.allModel : esc(shortModel(modelFilter))}${mixedScale ? ` &#183; ${TXT.relativeScale}` : ''}</div></div><div class="series-panel" role="group" aria-label="${TXT.chartSeries}"><span>${TXT.chartSeries}</span>${seriesButtons}</div></div><div class="chart-wrap"><canvas id="usageChart" tabindex="0" role="img" aria-label="${TXT.trend} ${TXT.chartSeries}"></canvas></div><div id="chartHoverScrubber" class="chart-hover-scrubber">${defaultChartScrubber()}</div><div class="chart-underbar"><div id="chartHoverMeta" class="chart-hover-meta">${defaultChartMeta()}</div>${legend}</div></section>`;
}
