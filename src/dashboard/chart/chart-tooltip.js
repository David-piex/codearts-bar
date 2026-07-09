function showTip(event, b, focus){
  const tip = document.getElementById('chartTip');
  if(!tip || !b || !validTimestamp(b.start)) return;
  const title = bucketTitle(b);
  const row = (cfg, hot = false) => `<div class="tip-row ${hot ? 'hot' : ''}"><span style="--c:${cfg.color}">${esc(cfg.label)}</span><strong>${seriesLabel(cfg, b[cfg.key])}</strong></div>`;
  const active = SERIES.filter((cfg) => visibleSeries.has(cfg.key));
  const metrics = active.length ? active : SERIES;
  const focusKey = focus?.key || '';
  const pinned = chartPinnedIndex >= 0 ? `<div class="tip-pin">${TXT.pinnedPoint} &#183; ${TXT.unpinPoint}</div>` : '';
  const tipKey = `${b.start || ''}|${focusKey}|${chartPinnedIndex}|${[...visibleSeries].join(',')}|${b.total || 0}|${b.input || 0}|${b.output || 0}|${b.cacheRead || 0}`;
  const contentChanged = tipKey !== lastChartTipKey;
  if(contentChanged){
    lastChartTipKey = tipKey;
    tip.innerHTML = `<b>${esc(title)}</b>${pinned}${metrics.map((cfg) => row(cfg, cfg.key === focusKey)).join('')}`;
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
}

function clearChartHover({ redraw = true, clearPinned = true } = {}){
  if(clearPinned) chartPinnedIndex = -1;
  const tip = document.getElementById('chartTip');
  lastChartTipKey = '';
  lastChartHoverKey = '';
  if(tip){ tip.classList.remove('show', 'flip-x'); tip.style.transform = 'translate3d(-999px,-999px,0) scale(.98)'; }
  document.querySelectorAll('.chart-card.chart-active, .chart-card.chart-pinned').forEach((card) => card.classList.remove('chart-active', 'chart-pinned'));
  chartHover.idx = -1;
  chartHover.x = NaN;
  chartHover.y = NaN;
  chartHover.tx = NaN;
  chartHover.ty = NaN;
  chartHover.focusKey = '';
  chartHover.pulse = 0;
  if(chartHoverFrame) cancelAnimationFrame(chartHoverFrame);
  chartHoverFrame = null;
  if(redraw && snapshot?.ok){
    const rows = getFilteredRowsForView(snapshot);
    drawChart(rows, snapshot, -1, 1);
  }
}

function hideTip(){ clearChartHover({ clearPinned: false }); }
