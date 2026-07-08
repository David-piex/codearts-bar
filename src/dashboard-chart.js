function bucketRows(rows, s){
  let since = sinceForRange(s);
  const until = untilForRange(s);
  const now = Number(until || s.timestamp || Date.now());
  if(rangeFilter === 'all'){
    const times = rows.map((r) => Number(r.time || 0)).filter((t) => validTimestamp(t, s));
    const first = times.length ? Math.min(...times) : now;
    since = Math.max(dayStart(first), now - 365 * 86400000);
  }
  const dayMode = isDayRange();
  const bucketMs = dayMode ? 86400000 : 3600000;
  const start = dayMode ? dayStart(since) : Math.floor(since / bucketMs) * bucketMs;
  const end = dayMode ? dayStart(now) + 86400000 : Math.ceil(now / bucketMs) * bucketMs;
  const buckets = [];
  const bucketMap = new Map();
  for(let t = start; t <= end; t += bucketMs){
    const b = { start: t, end: t + bucketMs, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, errors: 0, waitMs: 0, ttftMs: 0, firstContentMs: 0, queueMs: 0, speeds: [], latencies: [], ttfts: [], firstContents: [] };
    buckets.push(b);
    bucketMap.set(t, b);
  }
  for(const r of rows){
    const rawTime = Number(r.time || 0);
    if(!validTimestamp(rawTime, s)) continue;
    const t = dayMode ? dayStart(rawTime) : Math.floor(rawTime / bucketMs) * bucketMs;
    const b = bucketMap.get(t);
    if(!b) continue;
    b.total += r.total || 0;
    b.input += r.input || 0;
    b.output += r.output || 0;
    b.cacheRead += r.cacheRead || 0;
    b.cacheWrite += r.cacheWrite || 0;
    b.requests += 1;
    if(!r.ok) b.errors += 1;
    if(Number.isFinite(r.latencyMs)) b.latencies.push(r.latencyMs);
    if(Number.isFinite(r.ttftMs)) b.ttfts.push(r.ttftMs);
    if(Number.isFinite(r.firstContentMs)) b.firstContents.push(r.firstContentMs);
    if(Number.isFinite(r.outputTokensPerSec)) b.speeds.push(r.outputTokensPerSec);
  }
  const qList = dayMode ? (s?.queue?.trends?.daily14d || []) : (s?.queue?.trends?.hourly24h || []);
  for(const q of qList){
    const t = Number(q.start || 0);
    const key = dayMode ? dayStart(t) : Math.floor(t / bucketMs) * bucketMs;
    const b = bucketMap.get(key);
    if(b) b.queueMs = Number(q.avgMs || q.queue || 0) || 0;
  }
  for(const b of buckets){
    b.waitMs = avg(b.latencies) || 0;
    b.ttftMs = avg(b.ttfts) || 0;
    b.firstContentMs = avg(b.firstContents) || 0;
    b.speed = avg(b.speeds) || 0;
    b.cacheHitRate = cacheHitRate(b) || 0;
    delete b.latencies; delete b.ttfts; delete b.firstContents; delete b.speeds;
  }
  return buckets;
}
function defaultChartMeta(){ return `${TXT.hoverHint} &#183; ${TXT.pinPoint}`; }
function defaultChartScrubber(){ return `<b>${TXT.chartLegend}</b><span>${TXT.hoverHint}</span><span>${TXT.cacheHeatline}</span><i style="--hit:0%"><em></em></i>`; }
function chartScrubberHtml(title, b, health, hit, pinned = false, focus = null){
  const active = Number(b.requests || 0) > 0;
  const focusText = focus?.label ? `<span class="scrubber-focus">${esc(focus.label)} ${seriesLabel(focus, focus.value)}</span>` : '';
  return `<b>${esc(title)}</b>${pinned ? `<span class="scrubber-pin">${TXT.pinnedPoint}</span>` : ''}<span>${active ? `${TXT.requests} ${n(b.requests || 0)}` : TXT.idleHours}</span><span>${TXT.total} ${compact(b.total || 0)}</span>${focusText}<span class="scrubber-cache ${health.tone}">${TXT.cacheHitRate} ${cacheHitText(b)} &#183; ${health.label}</span><i class="${health.tone}" style="--hit:${hit}%"><em></em></i>`;
}
function chartSeriesMainValue(cfg, values, activeValues){
  const relevant = activeValues.length ? activeValues : values;
  if(cfg.kind === 'token') return seriesLabel(cfg, values.reduce((sum, v) => sum + v, 0));
  return seriesLabel(cfg, avg(relevant) || 0);
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
function seriesLabel(cfg, value){ return cfg.kind === 'ms' ? ms(value) : cfg.kind === 'speed' ? rate(value) : cfg.kind === 'pct' ? percent(value) : n(value); }
function axisLabel(active, value){ if(active.length && active.every((cfg) => cfg.kind === 'ms')) return ms(value); if(active.length && active.every((cfg) => cfg.kind === 'pct')) return percent(value); return compact(value); }

function drawSmooth(ctx, points){ if(!points.length) return; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); for(let i = 1; i < points.length; i++){ const prev = points[i - 1]; const cur = points[i]; const midX = (prev.x + cur.x) / 2; const midY = (prev.y + cur.y) / 2; ctx.quadraticCurveTo(prev.x, prev.y, midX, midY); } const last = points[points.length - 1]; ctx.lineTo(last.x, last.y); }
function drawHoverAperture(ctx, guideX, guideY, bounds, focus, isPinned){
  const tone = focus?.color || COLORS.input;
  const pulse = isPinned ? (Number(chartHover.pulse || 0) % 1) : 0;
  ctx.save();
  const beamW = isPinned ? 42 : 32;
  const guideGrad = ctx.createLinearGradient(guideX - beamW / 2, 0, guideX + beamW / 2, 0);
  guideGrad.addColorStop(0, 'rgba(22,135,245,0)');
  guideGrad.addColorStop(.5, isPinned ? 'rgba(22,135,245,.105)' : 'rgba(22,135,245,.060)');
  guideGrad.addColorStop(1, 'rgba(22,135,245,0)');
  ctx.fillStyle = guideGrad;
  ctx.fillRect(guideX - beamW / 2, bounds.t, beamW, bounds.h);
  ctx.strokeStyle = isPinned ? 'rgba(10,132,255,.52)' : 'rgba(22,135,245,.30)';
  ctx.lineWidth = isPinned ? 1.25 : 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(guideX, bounds.t);
  ctx.lineTo(guideX, bounds.t + bounds.h);
  ctx.stroke();
  ctx.strokeStyle = rgba(tone, isPinned ? .34 : .22);
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(bounds.l, guideY);
  ctx.lineTo(bounds.l + bounds.w, guideY);
  ctx.stroke();
  ctx.setLineDash([]);
  const ring = isPinned ? 14 + Math.sin(pulse * Math.PI * 2) * 1.8 : 10;
  const halo = ctx.createRadialGradient(guideX, guideY, 0, guideX, guideY, isPinned ? 40 : 28);
  halo.addColorStop(0, rgba(tone, isPinned ? .24 : .18));
  halo.addColorStop(.48, rgba(tone, isPinned ? .12 : .08));
  halo.addColorStop(1, rgba(tone, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(guideX, guideY, isPinned ? 40 : 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(tone, isPinned ? .30 : .20);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(guideX, guideY, ring, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
function drawCacheLens(ctx, b, bounds, guideX, isPinned){
  if(!b) return;
  const hitRaw = cacheHitRate(b);
  const hit = Math.max(0, Math.min(100, Number.isFinite(hitRaw) ? hitRaw : 0));
  const tone = cacheToneColor(b);
  const boxW = 164;
  const boxH = 46;
  const x = Math.max(bounds.l + 8, Math.min(bounds.l + bounds.w - boxW - 8, guideX - boxW / 2));
  const y = Math.max(bounds.t + 12, bounds.t + bounds.h - 66);
  const ringX = x + 22;
  const ringY = y + 23;
  const lineW = 86;
  ctx.save();
  ctx.shadowColor = 'rgba(15,23,42,.12)';
  ctx.shadowBlur = isPinned ? 18 : 12;
  ctx.shadowOffsetY = 8;
  const glass = ctx.createLinearGradient(0, y, 0, y + boxH);
  glass.addColorStop(0, isPinned ? 'rgba(255,255,255,.94)' : 'rgba(255,255,255,.86)');
  glass.addColorStop(1, 'rgba(247,251,255,.74)');
  ctx.fillStyle = glass;
  ctx.strokeStyle = isPinned ? 'rgba(10,132,255,.34)' : 'rgba(196,205,218,.62)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 15);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(226,232,240,.92)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(ringX, ringY, 11, -Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();
  ctx.strokeStyle = tone;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(ringX, ringY, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (hit / 100));
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#172033';
  ctx.font = '800 12px Segoe UI, Microsoft YaHei UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(cacheHitText(b), x + 43, y + 18);
  ctx.fillStyle = 'rgba(100,116,139,.88)';
  ctx.font = '10px Segoe UI, Microsoft YaHei UI, sans-serif';
  ctx.fillText(TXT.cacheHitBasis, x + 43, y + 32);
  ctx.fillStyle = 'rgba(226,232,240,.92)';
  ctx.beginPath();
  ctx.roundRect(x + 43, y + 36, lineW, 4, 2);
  ctx.fill();
  ctx.fillStyle = tone;
  ctx.beginPath();
  ctx.roundRect(x + 43, y + 36, Math.max(4, lineW * hit / 100), 4, 2);
  ctx.fill();
  ctx.fillStyle = tone;
  ctx.font = '900 10px Segoe UI, Microsoft YaHei UI, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(cacheHealth(b).label, x + boxW - 12, y + 18);
  ctx.restore();
}
function drawChart(rows, s, hover = -1, progress = 1){
  const chartDrawStartedAt = perfNow();
  ensureVisibleSeries();
  const canvas = document.getElementById('usageChart');
  if(!canvas) return;
  const data = bucketRows(rows, s);
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, rect.width * dpr);
  canvas.height = Math.max(1, rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const pad = { l: 58, r: 28, t: 18, b: 36 };
  const w = Math.max(1, rect.width - pad.l - pad.r);
  const h = Math.max(1, rect.height - pad.t - pad.b);
  const active = SERIES.filter((cfg) => visibleSeries.has(cfg.key));
  const mixedScale = new Set(active.map((cfg) => cfg.kind)).size > 1;
  const globalMax = Math.max(1, ...data.flatMap((b) => active.map((cfg) => b[cfg.key] || 0)));
  const seriesMax = new Map(active.map((cfg) => [cfg.key, Math.max(1, ...data.map((b) => Number(b[cfg.key] || 0)))]));
  const scaleFor = (cfg) => mixedScale ? (seriesMax.get(cfg.key) || 1) : globalMax;
  const plotBg = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
  plotBg.addColorStop(0, 'rgba(22,135,245,.035)');
  plotBg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = plotBg;
  ctx.fillRect(pad.l, pad.t, w, h);
  const idleBandGrad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
  idleBandGrad.addColorStop(0, 'rgba(148,163,184,.075)');
  idleBandGrad.addColorStop(1, 'rgba(148,163,184,.018)');
  data.forEach((b, i) => {
    if(Number(b.requests || 0) !== 0) return;
    const x = pad.l + (data.length <= 1 ? w / 2 : i * w / (data.length - 1));
    const nextX = pad.l + (data.length <= 1 ? w : Math.min(w, (i + .5) * w / Math.max(1, data.length - 1)));
    const prevX = pad.l + (data.length <= 1 ? 0 : Math.max(0, (i - .5) * w / Math.max(1, data.length - 1)));
    ctx.fillStyle = idleBandGrad;
    ctx.fillRect(prevX, pad.t, Math.max(2, nextX - prevX), h);
    ctx.fillStyle = 'rgba(148,163,184,.18)';
    ctx.fillRect(Math.max(prevX, x - .5), pad.t, 1, h);
  });
  ctx.strokeStyle = 'rgba(149,164,184,.18)';
  ctx.fillStyle = '#7b8190';
  ctx.font = '12px Segoe UI, Microsoft YaHei UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;
  for(let i = 0; i <= 4; i++){
    const y = pad.t + h * i / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
    const val = mixedScale ? `${Math.round((1 - i / 4) * 100)}%` : axisLabel(active, globalMax * (1 - i / 4));
    ctx.fillText(val, 8, y + 4);
  }
  const cacheY = pad.t + h - 7;
  const cacheStep = data.length <= 1 ? w : w / Math.max(1, data.length - 1);
  data.forEach((b, i) => {
    const cacheTotal = Number(b.cacheRead || 0) + Number(b.cacheWrite || 0);
    if(!cacheTotal) return;
    const x = pad.l + (data.length <= 1 ? w / 2 : i * w / (data.length - 1));
    const hit = Math.max(0, Math.min(100, cacheHitRate(b) || 0));
    const segW = Math.max(7, Math.min(28, cacheStep * .52));
    const segH = hover === i ? 6 : 4;
    ctx.save();
    ctx.globalAlpha = hover === i ? .96 : .34 + hit / 100 * .34;
    ctx.fillStyle = cacheToneColor(b);
    ctx.beginPath();
    ctx.roundRect(x - segW / 2, cacheY - segH / 2, segW, segH, segH / 2);
    ctx.fill();
    if(hover === i){
      ctx.strokeStyle = 'rgba(255,255,255,.92)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  });
  if(data.some((b) => Number(b.cacheRead || 0) + Number(b.cacheWrite || 0) > 0)){
    ctx.save();
    ctx.fillStyle = 'rgba(100,116,139,.72)';
    ctx.font = '11px Segoe UI, Microsoft YaHei UI, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(TXT.cacheHeatline, pad.l + w, pad.t + h - 13);
    ctx.restore();
  }
  const tokenActive = active.filter((cfg) => cfg.kind === 'token');
  if(tokenActive.length){
    const barValues = data.map((b) => tokenActive.reduce((sum, cfg) => sum + (cfg.key === 'total' ? 0 : Number(b[cfg.key] || 0)), 0) || Number(b.total || 0));
    const barMax = Math.max(1, ...barValues);
    const bw = Math.max(3, Math.min(18, (w / Math.max(1, data.length)) * .56));
    const barGrad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    barGrad.addColorStop(0, 'rgba(10,132,255,.18)');
    barGrad.addColorStop(1, 'rgba(10,132,255,.035)');
    data.forEach((b, i) => {
      const x = pad.l + (data.length <= 1 ? 0 : i * w / (data.length - 1));
      const bh = Math.max(0, (barValues[i] / barMax) * h * progress);
      if(bh < 1) return;
      ctx.fillStyle = hover === i ? 'rgba(10,132,255,.24)' : barGrad;
      ctx.beginPath();
      ctx.roundRect(x - bw / 2, pad.t + h - bh, bw, bh, 5);
      ctx.fill();
    });
  }
  function xy(i, cfg){
    const x = pad.l + (data.length <= 1 ? 0 : i * w / (data.length - 1));
    const target = pad.t + h - (Number(data[i][cfg.key] || 0) / scaleFor(cfg)) * h;
    const y = pad.t + h - (pad.t + h - target) * progress;
    return { x, y };
  }
  function line(cfg){
    const points = data.map((_, i) => xy(i, cfg));
    ctx.save();
    ctx.strokeStyle = rgba(cfg.color, cfg.key === 'total' ? .18 : .12);
    ctx.lineWidth = (cfg.key === 'total' ? 2.35 : 1.85) + 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    drawSmooth(ctx, points);
    ctx.stroke();
    ctx.strokeStyle = cfg.color;
    ctx.lineWidth = cfg.key === 'total' ? 2.35 : 1.85;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = hover >= 0 && cfg.key !== 'total' ? .78 : 1;
    ctx.setLineDash(cfg.dash || []);
    drawSmooth(ctx, points);
    ctx.stroke();
    if(cfg.key === 'total'){
      const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
      grad.addColorStop(0, 'rgba(244,63,94,.15)');
      grad.addColorStop(.62, 'rgba(244,63,94,.045)');
      grad.addColorStop(1, 'rgba(244,63,94,0)');
      ctx.lineTo(points[points.length - 1].x, pad.t + h);
      ctx.lineTo(points[0].x, pad.t + h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.restore();
  }
  active.forEach(line);
  chartPoints = data.map((b, i) => ({
    bucket: b,
    x: pad.l + (data.length <= 1 ? 0 : i * w / (data.length - 1)),
    series: active.map((cfg) => ({ key: cfg.key, label: cfg.label, color: cfg.color, kind: cfg.kind, value: b[cfg.key] || 0, scaleMax: scaleFor(cfg), ...xy(i, cfg) })),
  }));
  if(chartPinnedIndex >= chartPoints.length) chartPinnedIndex = -1;
  ctx.fillStyle = '#8a909c';
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.ceil(data.length / 8));
  data.forEach((b, i) => {
    if(i % step === 0 || i === data.length - 1){
      const label = bucketAxisLabel(b, s);
      ctx.fillText(label, chartPoints[i].x, pad.t + h + 25);
    }
  });
  const hasData = data.some((b) => active.some((cfg) => (b[cfg.key] || 0) > 0));
  if(!hasData){
    ctx.fillStyle = '#9aa0aa';
    ctx.font = '14px Segoe UI, Microsoft YaHei UI, sans-serif';
    ctx.fillText(TXT.emptyHint, pad.l + w / 2, pad.t + h / 2);
  }
  if(hover >= 0 && chartPoints[hover]){
    const point = chartPoints[hover];
    const focus = point.series.find((p) => p.key === chartHover.focusKey) || point.series[0];
    const guideX = Number.isFinite(chartHover.x) ? chartHover.x : point.x;
    const guideY = Number.isFinite(chartHover.y) ? chartHover.y : (focus?.y || pad.t + h / 2);
    const isPinned = chartPinnedIndex === hover;
    ctx.save();
    drawHoverAperture(ctx, guideX, guideY, { l: pad.l, t: pad.t, w, h }, focus, isPinned);
    if(focus){
      ctx.save();
      const axisText = seriesLabel(focus, focus.value);
      ctx.font = '800 11px Segoe UI, Microsoft YaHei UI, sans-serif';
      const axisW = Math.min(86, Math.max(42, ctx.measureText(axisText).width + 18));
      const axisX = Math.max(6, pad.l - axisW - 8);
      const axisY = clamp(guideY - 11, pad.t + 4, pad.t + h - 24);
      ctx.fillStyle = 'rgba(255,255,255,.90)';
      ctx.strokeStyle = rgba(focus.color, .34);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(axisX, axisY, axisW, 22, 9);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = focus.color;
      ctx.textAlign = 'center';
      ctx.fillText(axisText, axisX + axisW / 2, axisY + 15);
      ctx.restore();
    }
    drawCacheLens(ctx, point.bucket, { l: pad.l, t: pad.t, w, h }, guideX, isPinned);
    if(isPinned){
      ctx.fillStyle = 'rgba(10,132,255,.92)';
      ctx.beginPath();
      ctx.roundRect(Math.max(pad.l + 4, Math.min(pad.l + w - 48, guideX - 24)), pad.t + 6, 48, 20, 10);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '11px Segoe UI, Microsoft YaHei UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(TXT.pinned, Math.max(pad.l + 28, Math.min(pad.l + w - 24, guideX)), pad.t + 20);
    }
    for(const p of point.series){
      ctx.fillStyle = rgba(p.color, .13);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if(focus){
      const label = `${focus.label} ${seriesLabel(focus, focus.value)}`;
      ctx.font = '12px Segoe UI, Microsoft YaHei UI, sans-serif';
      const textW = ctx.measureText(label).width;
      const boxW = Math.min(210, textW + 18);
      const boxH = 24;
      const bx = Math.max(pad.l + 4, Math.min(pad.l + w - boxW - 4, focus.x + 12));
      const by = Math.max(pad.t + 4, Math.min(pad.t + h - boxH - 4, focus.y - 32));
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.strokeStyle = rgba(focus.color, .38);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 9);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = focus.color;
      ctx.beginPath();
      ctx.arc(bx + 10, by + boxH / 2, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#18202b';
      ctx.textAlign = 'left';
      ctx.fillText(label, bx + 17, by + 16);
    }
    ctx.restore();
  }
  markPerfStage('chartDrawMs', perfNow() - chartDrawStartedAt);
}
function clamp(nv, min, max){ return Math.max(min, Math.min(max, nv)); }
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
function animateChart(rows, s, instant = false){ if(chartAnimationFrame) cancelAnimationFrame(chartAnimationFrame); if(instant || prefersReducedMotion){ drawChart(rows, s, -1, 1); return; } const started = performance.now(); const duration = 420; const frame = (now) => { const raw = Math.min(1, (now - started) / duration); const eased = 1 - Math.pow(1 - raw, 3); drawChart(rows, s, -1, eased); if(raw < 1) chartAnimationFrame = requestAnimationFrame(frame); else chartAnimationFrame = null; }; chartAnimationFrame = requestAnimationFrame(frame); }
function animatePinnedHover(rows, s){
  if(chartHoverFrame) cancelAnimationFrame(chartHoverFrame);
  if(prefersReducedMotion || chartPinnedIndex < 0 || !chartPoints[chartPinnedIndex]) return;
  const started = performance.now();
  const pulseFrame = (now) => {
    if(chartPinnedIndex < 0 || !chartPoints[chartPinnedIndex]){ chartHoverFrame = null; return; }
    chartHover.pulse = ((now - started) % 1400) / 1400;
    drawChart(rows, s, chartPinnedIndex, 1);
    chartHoverFrame = requestAnimationFrame(pulseFrame);
  };
  chartHoverFrame = requestAnimationFrame(pulseFrame);
}
function bindChart(rows, s, opts = {}){
  const canvas = document.getElementById('usageChart');
  if(!canvas) return;
  animateChart(rows, s, opts.instant === true);
  const nearest = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if(!chartPoints.length) return null;
    let best = { idx: 0, dist: Infinity, focus: null };
    chartPoints.forEach((p, i) => {
      const series = p.series && p.series.length ? p.series : [{ x: p.x, y: my, key: 'total' }];
      for(const sp of series){
        const d = Math.abs(sp.x - mx) + Math.abs(sp.y - my) * .18;
        if(d < best.dist) best = { idx: i, dist: d, focus: sp };
      }
    });
    if(!Number.isFinite(best.idx) || best.idx < 0 || best.idx >= chartPoints.length) return null;
    return best;
  };
  canvas.onmousemove = (e) => {
    const hit = nearest(e);
    if(!hit) return;
    if(chartAnimationFrame){ cancelAnimationFrame(chartAnimationFrame); chartAnimationFrame = null; }
    const card = canvas.closest('.chart-card');
    card?.classList.add('chart-active');
    card?.classList.toggle('chart-pinned', chartPinnedIndex >= 0);
    const targetPoint = chartPoints[hit.idx];
    if(!targetPoint) return;
    chartHover.idx = hit.idx;
    chartHover.focusKey = hit.focus?.key || '';
    chartHover.x = targetPoint.x;
    chartHover.y = hit.focus?.y ?? (canvas.getBoundingClientRect().height / 2);
    chartHover.pulse = 0;
    if(chartHoverFrame) cancelAnimationFrame(chartHoverFrame);
    chartHoverFrame = requestAnimationFrame(() => {
      chartHoverFrame = null;
      drawChart(rows, s, hit.idx, 1);
    });
    showTip(e, targetPoint.bucket, hit.focus);
  };
  canvas.onclick = (e) => {
    const hit = nearest(e);
    if(!hit) return;
    chartPinnedIndex = chartPinnedIndex === hit.idx ? -1 : hit.idx;
    if(chartPinnedIndex < 0) {
      clearChartHover();
      return;
    }
    chartHover.focusKey = hit.focus?.key || chartHover.focusKey || '';
    chartHover.idx = chartPinnedIndex;
    chartHover.x = chartPoints[chartPinnedIndex]?.x ?? chartHover.x;
    chartHover.y = hit.focus?.y ?? chartHover.y;
    canvas.closest('.chart-card')?.classList.add('chart-active', 'chart-pinned');
    drawChart(rows, s, chartPinnedIndex, 1);
    showTip(e, chartPoints[chartPinnedIndex]?.bucket, hit.focus);
    animatePinnedHover(rows, s);
  };
  canvas.ondblclick = () => clearChartHover();
  canvas.onkeydown = (e) => {
    if(!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    if(!chartPoints.length) return;
    const current = chartPinnedIndex >= 0 ? chartPinnedIndex : Math.max(0, chartHover.idx);
    let next = current;
    if(e.key === 'ArrowLeft') next = Math.max(0, current - 1);
    if(e.key === 'ArrowRight') next = Math.min(chartPoints.length - 1, current + 1);
    if(e.key === 'Home') next = 0;
    if(e.key === 'End') next = chartPoints.length - 1;
    if(e.key === 'Enter' || e.key === ' '){
      chartPinnedIndex = chartPinnedIndex >= 0 ? -1 : Math.max(0, current);
      if(chartPinnedIndex < 0){ clearChartHover(); return; }
      next = chartPinnedIndex;
    } else {
      chartPinnedIndex = next;
    }
    const rect = canvas.getBoundingClientRect();
    const p = chartPoints[next];
    const focus = p.series.find((x) => x.key === chartHover.focusKey) || p.series[0];
    const fakeEvent = { clientX: rect.left + p.x, clientY: rect.top + (focus?.y || rect.height / 2) };
    canvas.closest('.chart-card')?.classList.add('chart-active', 'chart-pinned');
    chartHover.idx = next;
    chartHover.x = p.x;
    chartHover.y = focus?.y || rect.height / 2;
    chartHover.focusKey = focus?.key || chartHover.focusKey || '';
    drawChart(rows, s, next, 1);
    showTip(fakeEvent, p.bucket, focus);
    animatePinnedHover(rows, s);
  };
  canvas.onmouseleave = () => clearChartHover();
}
function emptyRow(colspan){ return `<tr><td colspan="${colspan}" class="empty-cell">${TXT.emptyHint}</td></tr>`; }
function requestKeyFor(r){ return `${sourceKey(r)}:${r.id || ''}:${r.sessionId || ''}:${r.time || ''}`; }
function requestByKey(key){ return (snapshot?.requestLog || []).find((r) => requestKeyFor(r) === key) || null; }
function selectedRequestFrom(list){ if(selectedRequestKey && list.some((r) => requestKeyFor(r) === selectedRequestKey)) return list.find((r) => requestKeyFor(r) === selectedRequestKey); const first = list[0] || null; selectedRequestKey = first ? requestKeyFor(first) : ''; localStorage.setItem('selectedRequestKey', selectedRequestKey); return first; }
function renderRequestInspector(list){
  const r = selectedRequestFrom(list);
  if(!r) return `<aside class="request-inspector empty"><div class="inspector-title">${TXT.requestInspector}</div><p>${TXT.emptyHint}</p></aside>`;
  const key = requestKeyFor(r);
  return `<aside class="request-inspector"><div class="inspector-head"><div><div class="inspector-title">${TXT.requestInspector}</div><h3>${esc(shortModel(r.model))}</h3><p>${esc(r.sessionTitle || r.sessionId || '')}</p></div><span class="session-state ${r.ok ? 'live' : 'archived'}">${esc(r.status)}</span></div><div class="inspector-grid">${sessionStat(TXT.total, compact(r.total || 0))}${sessionStat(TXT.input, compact(r.input || 0))}${sessionStat(TXT.output, compact(r.output || 0))}${sessionStat(TXT.cacheWrite, compact(r.cacheWrite || 0))}${sessionStat(TXT.cacheRead, compact(r.cacheRead || 0))}${sessionStat(TXT.cacheHitRate, cacheHitText(r))}${sessionStat(TXT.ttft, ms(r.ttftMs))}${sessionStat(TXT.firstContent, ms(r.firstContentMs))}${sessionStat(TXT.wait, ms(r.latencyMs))}${sessionStat(TXT.speed, rate(r.outputTokensPerSec))}${sessionStat(TXT.source, sourceName(r))}</div><div class="inspector-block"><span>${TXT.provider} / ${TXT.model}</span><code>${esc(r.provider || 'unknown')} / ${esc(r.model || 'unknown')}</code></div><div class="inspector-block cache-inspector-block"><span>${TXT.cacheEfficiency}</span>${cacheEfficiencyPanel(r, 'inspector-cache')}</div><div class="inspector-block"><span>${TXT.tokenInputOutput}</span><div class="token-stack"><i style="--w:${Math.max(2, Math.min(100, ((r.input || 0) / Math.max(1, r.total || 1)) * 100))}%; --c:${COLORS.input}"></i><i style="--w:${Math.max(2, Math.min(100, ((r.output || 0) / Math.max(1, r.total || 1)) * 100))}%; --c:${COLORS.output}"></i><i style="--w:${Math.max(2, Math.min(100, ((r.cacheWrite || 0) / Math.max(1, r.total || 1)) * 100))}%; --c:${COLORS.cacheWrite}"></i><i style="--w:${Math.max(2, Math.min(100, ((r.cacheRead || 0) / Math.max(1, r.total || 1)) * 100))}%; --c:${COLORS.cacheRead}"></i></div></div><div class="inspector-block"><span>${TXT.session}</span><code>${esc(r.sessionId || 'N/A')}</code></div>${r.error ? `<div class="inspector-block"><span>Error</span><code>${esc(r.error)}</code></div>` : ''}<div class="inspector-actions"><button class="primary-action" data-request-action="view-session" data-request-key="${esc(key)}">${TXT.viewSession}</button><button data-request-action="copy-json" data-request-key="${esc(key)}">${TXT.copyRequestJson}</button><button data-request-action="copy-session" data-request-key="${esc(key)}">${TXT.copyId}</button></div></aside>`;
}

function requestRowHtml(r){
  const key = requestKeyFor(r);
  const selected = key === selectedRequestKey;
  return `<tr class="request-row ${selected ? 'selected' : ''}" data-request-select="${esc(key)}"><td>${esc(dateLabel(r.time))}</td><td><span class="source-pill">${esc(sourceName(r))}</span></td><td>${esc(r.provider)}</td><td><code>${esc(shortModel(r.model))}</code></td><td>${n(r.input)}</td><td>${n(r.output)}</td><td>${n(r.cacheWrite || 0)}</td><td>${n(r.cacheRead || 0)}</td><td class="cache-cell">${cachePillHtml(r)}</td><td><b>${n(r.total)}</b></td><td>${ms(r.ttftMs)}</td><td>${ms(r.latencyMs)}</td><td>${rate(r.outputTokensPerSec)}</td><td class="${r.ok ? 'ok' : 'bad'}">${esc(r.status)}</td><td><div>${esc(r.sessionTitle)}</div><div class="muted">${esc(r.sessionId)}</div></td></tr>`;
}
function requestLimitNote(rendered, total){
  return rendered < total ? `<div class="table-limit-note" data-table-limit="requests" data-rendered="${rendered}" data-total="${total}">\u5df2\u5148\u6e32\u67d3 ${n(rendered)} / ${n(total)} \u884c\uff0c\u6eda\u52a8\u5230\u5e95\u90e8\u7ee7\u7eed\u52a0\u8f7d\uff0c\u6216\u7ee7\u7eed\u641c\u7d22\u7f29\u5c0f\u8303\u56f4\u3002</div>` : '';
}
function tableRows(rows){
  const tableStartedAt = perfNow();
  const matched = applyTableSearch(rows);
  const limit = Math.max(100, Number(requestTableRenderLimit || 100));
  const list = matched.slice(0, limit);
  selectedRequestFrom(list);
  const body = list.length ? list.map(requestRowHtml).join('') : emptyRow(15);
  const clipped = requestLimitNote(list.length, matched.length);
  const html = `<div class="request-manager"><div class="request-main"><div class="table-scroll"><table><thead><tr><th>${TXT.time}</th><th>${TXT.source}</th><th>${TXT.provider}</th><th>${TXT.model}</th><th>${TXT.input}</th><th>${TXT.output}</th><th>${TXT.cacheWrite}</th><th>${TXT.cacheRead}</th><th>${TXT.cacheHitRate}</th><th>${TXT.total}</th><th>${TXT.ttft}</th><th>${TXT.wait}</th><th>${TXT.speed}</th><th>${TXT.status}</th><th>${TXT.session}</th></tr></thead><tbody>${body}</tbody></table></div>${clipped}</div>${renderRequestInspector(list)}</div>`;
  markPerfStage('tableRenderMs', perfNow() - tableStartedAt);
  return html;
}

function statTable(groups, label){ const list = groups.slice(0, 160); return `<div class="table-scroll"><table><thead><tr><th>${label}</th><th>${TXT.requests}</th><th>${TXT.input}</th><th>${TXT.output}</th><th>${TXT.cacheWrite}</th><th>${TXT.cacheRead}</th><th>${TXT.cacheHitRate}</th><th>${TXT.total}</th><th>${TXT.ttft}</th><th>${TXT.wait}</th><th>${TXT.status}</th></tr></thead><tbody>${list.length ? list.map((g) => `<tr><td><b>${esc(label === TXT.model ? shortModel(g.key) : g.key)}</b></td><td>${n(g.stats.requests)}</td><td>${n(g.stats.input)}</td><td>${n(g.stats.output)}</td><td>${n(g.stats.cacheWrite)}</td><td>${n(g.stats.cacheRead)}</td><td class="cache-cell">${cachePillHtml(g.stats)}</td><td><b>${n(g.stats.total)}</b></td><td>${ms(avg(g.stats.ttfts))}</td><td>${ms(avg(g.stats.latencies))}</td><td class="${g.stats.errors ? 'bad' : 'ok'}">${g.stats.errors ? `${n(g.stats.errors)} error` : '200'}</td></tr>`).join('') : emptyRow(11)}</tbody></table></div>`; }
