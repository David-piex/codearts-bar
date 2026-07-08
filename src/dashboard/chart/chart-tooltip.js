function showTip(event, b, focus){
  const tip = document.getElementById('chartTip');
  if(!tip || !b || !validTimestamp(b.start)) return;
  const title = bucketTitle(b);
  const row = (cfg, hot = false) => `<div class="tip-row ${hot ? 'hot' : ''}"><span style="--c:${cfg.color}">${esc(cfg.label)}</span><strong>${seriesLabel(cfg, b[cfg.key])}</strong></div>`;
  const metricRow = (label, value, cls = '') => `<div class="tip-row tip-metric ${cls}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const active = SERIES.filter((cfg) => visibleSeries.has(cfg.key));
  const mixedScale = new Set(active.map((cfg) => cfg.kind)).size > 1;
  const focusKey = focus?.key || '';
  const state = Number(b.requests || 0) ? TXT.activeBand : TXT.idleHours;
  const pinned = chartPinnedIndex >= 0 ? `<div class="tip-pin">${TXT.pinnedPoint} &#183; ${TXT.unpinPoint}</div>` : '';
  const hit = Math.max(0, Math.min(100, cacheHitRate(b) || 0));
  const health = cacheHealth(b);
  const tipKey = `${b.start || ''}|${focusKey}|${chartPinnedIndex}|${[...visibleSeries].join(',')}`;
  const contentChanged = tipKey !== lastChartTipKey;
  if(contentChanged){
    lastChartTipKey = tipKey;
    tip.innerHTML = `<b>${esc(title)}</b><div class="tip-row tip-state"><span>${esc(state)}</span><strong>${n(b.requests || 0)} ${TXT.requests}</strong></div>${pinned}${mixedScale ? `<div class="tip-row tip-note"><span>${TXT.relativeScale}</span><strong>${TXT.eachPeak100}</strong></div>` : ''}${active.map((cfg) => row(cfg, cfg.key === focusKey)).join('')}<div class="tip-divider"></div>${metricRow(TXT.cacheHitRate, cacheHitText(b), 'cache')}<div class="tip-cache-bar" style="--hit:${hit}%"><i></i></div>${metricRow(TXT.cacheHealth, health.label, `cache-health ${health.tone}`)}${metricRow(`${TXT.cacheReadShort} / ${TXT.cacheCreateShort}`, `${compact(b.cacheRead || 0)} / ${compact(b.cacheWrite || 0)}`)}${metricRow(TXT.ttft, ms(b.ttftMs))}${metricRow(TXT.wait, ms(b.waitMs))}${metricRow(TXT.queue, ms(b.queueMs))}`;
  }
  tip.classList.add('show');
  const box = tip.getBoundingClientRect ? tip.getBoundingClientRect() : { width: 248, height: 260 };
  const width = Math.max(224, Number(box.width || 248));
  const height = Math.max(160, Number(box.height || 260));
  const preferLeft = event.clientX + width + 18 > window.innerWidth;
  const rawLeft = preferLeft ? event.clientX - width - 16 : event.clientX + 16;
  const rawTop = event.clientY + height + 18 > window.innerHeight ? event.clientY - height - 14 : event.clientY - 34;
  const left = clamp(rawLeft, 8, Math.max(8, window.innerWidth - width - 8));
  const top = clamp(rawTop, 8, Math.max(8, window.innerHeight - height - 8));
  tip.classList.toggle('flip-x', preferLeft);
  tip.style.transform = `translate3d(${left}px, ${top}px, 0) scale(1)`;
  if(contentChanged){
    const meta = document.getElementById('chartHoverMeta');
    if(meta) meta.innerHTML = `<b>${esc(title)}</b>${chartPinnedIndex >= 0 ? `<span>${TXT.pinnedPoint}</span>` : ''}${mixedScale ? `<span>${TXT.relativeScale}</span>` : ''}<span>${Number(b.requests || 0) ? `${TXT.requests} ${n(b.requests)}` : TXT.idleHours}</span><span>${TXT.total} ${n(b.total || 0)}</span><span class="cache-meta">${TXT.cacheHitRate} ${cacheHitText(b)}</span><span class="cache-health-meta ${health.tone}">${TXT.cacheHealth} ${health.label}</span><span>${TXT.ttft} ${ms(b.ttftMs)}</span><span>${TXT.wait} ${ms(b.waitMs)}</span><span>${TXT.queue} ${ms(b.queueMs)}</span>`;
    const scrubber = document.getElementById('chartHoverScrubber');
    if(scrubber){
      scrubber.classList.add('active');
      scrubber.classList.toggle('pinned', chartPinnedIndex >= 0);
      scrubber.innerHTML = chartScrubberHtml(title, b, health, hit, chartPinnedIndex >= 0, focus);
    }
  }
}

function clearChartHover({ redraw = true, clearPinned = true } = {}){
  if(clearPinned) chartPinnedIndex = -1;
  const tip = document.getElementById('chartTip');
  lastChartTipKey = '';
  if(tip){ tip.classList.remove('show', 'flip-x'); tip.style.transform = 'translate3d(-999px,-999px,0) scale(.98)'; }
  document.querySelectorAll('.chart-card.chart-active, .chart-card.chart-pinned').forEach((card) => card.classList.remove('chart-active', 'chart-pinned'));
  const meta = document.getElementById('chartHoverMeta');
  if(meta) meta.innerHTML = defaultChartMeta();
  const scrubber = document.getElementById('chartHoverScrubber');
  if(scrubber){
    scrubber.classList.remove('active', 'pinned');
    scrubber.innerHTML = defaultChartScrubber();
  }
  chartHover.idx = -1;
  chartHover.x = NaN;
  chartHover.y = NaN;
  chartHover.tx = NaN;
  chartHover.ty = NaN;
  chartHover.focusKey = '';
  chartHover.pulse = 0;
  if(chartHoverFrame) cancelAnimationFrame(chartHoverFrame);
  chartHoverFrame = null;
  if(redraw && snapshot?.ok) drawChart(filterRows(snapshot), snapshot, -1, 1);
}

function hideTip(){ clearChartHover({ clearPinned: false }); }
