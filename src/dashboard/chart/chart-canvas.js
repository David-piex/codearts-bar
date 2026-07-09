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

function chartLightMode(hover = -1){
  try {
    const body = document.body;
    const interactionLight = chartInteractionLightMode();
    const restingChart = Number(hover || -1) < 0 && Number(chartPinnedIndex || -1) < 0;
    return Boolean(interactionLight || restingChart);
  } catch { return false; }
}

function chartInteractionLightMode(){
  try {
    const body = document.body;
    const app = document.getElementById('app');
    const now = Date.now();
    return now < Number(zoomInteractionUntil || 0)
      || now < Number(chartResizeQuietUntil || 0)
      || body?.classList?.contains('is-resizing')
      || body?.classList?.contains('is-zooming')
      || body?.classList?.contains('view-switching')
      || app?.classList?.contains('is-resizing')
      || app?.classList?.contains('is-zooming')
      || app?.classList?.contains('view-switching');
  } catch { return false; }
}

function rememberChartCanvasBox(canvas, width, height, dpr, source = 'draw'){
  const w = Math.max(1, Number(width || 0));
  const h = Math.max(1, Number(height || 0));
  const ratio = Number(dpr || window.devicePixelRatio || 1) || 1;
  const key = `${Math.round(w)}x${Math.round(h)}@${ratio}`;
  chartCanvasBoxCache = { width: w, height: h, dpr: ratio, key, timestamp: Date.now(), source };
  try {
    if(canvas?.dataset){
      canvas.dataset.cssW = String(w);
      canvas.dataset.cssH = String(h);
      canvas.dataset.dpr = String(ratio);
      canvas.dataset.sizeKey = key;
    }
  } catch {}
  return chartCanvasBoxCache;
}

function invalidateChartCanvasBox(){
  chartCanvasBoxCache = { width: 0, height: 0, dpr: 0, key: '', timestamp: 0, source: '' };
}

function estimateChartCanvasBox(){
  const viewportW = Number(window.innerWidth || 1280);
  const viewportH = Number(window.innerHeight || 860);
  const width = Math.max(520, Math.min(2600, viewportW - 136));
  const fluidHeight = viewportH * 0.29;
  const height = Math.max(252, Math.min(286, fluidHeight));
  return { width, height };
}

function chartCanvasBox(canvas, opts = {}){
  const dpr = window.devicePixelRatio || 1;
  const force = opts.force === true;
  const cachedW = Number(canvas?.dataset?.cssW || chartCanvasBoxCache?.width || 0);
  const cachedH = Number(canvas?.dataset?.cssH || chartCanvasBoxCache?.height || 0);
  const cachedDpr = Number(canvas?.dataset?.dpr || chartCanvasBoxCache?.dpr || 0);
  const canUseCached = !force
    && cachedW > 0
    && cachedH > 0
    && Math.abs(cachedDpr - dpr) < 0.001
    && canvas?.width > 0
    && canvas?.height > 0;
  if(canUseCached){
    return { width: cachedW, height: cachedH, dpr, cached: true };
  }
  if(!force && opts.allowEstimate !== false){
    const estimated = estimateChartCanvasBox();
    rememberChartCanvasBox(canvas, estimated.width, estimated.height, dpr, opts.source || 'estimate');
    return { width: estimated.width, height: estimated.height, dpr, cached: false, estimated: true };
  }
  const layoutStarted = perfNow();
  const rect = canvas.getBoundingClientRect();
  markPerfStage('chartLayoutReadMs', perfNow() - layoutStarted);
  const width = Math.max(1, Number(rect.width || cachedW || 0));
  const height = Math.max(1, Number(rect.height || cachedH || 0));
  rememberChartCanvasBox(canvas, width, height, dpr, opts.source || 'layout');
  return { width, height, dpr, cached: false };
}

function chartDrawSignature(data, active, box, hover = -1, progress = 1){
  try {
    const last = data[data.length - 1] || {};
    const first = data[0] || {};
    const sum = data.reduce((acc, b) => {
      acc.total += Number(b.total || 0);
      acc.input += Number(b.input || 0);
      acc.output += Number(b.output || 0);
      acc.cacheRead += Number(b.cacheRead || 0);
      acc.requests += Number(b.requests || 0);
      return acc;
    }, { total: 0, input: 0, output: 0, cacheRead: 0, requests: 0 });
    return [
      Math.round(Number(box.width || 0)),
      Math.round(Number(box.height || 0)),
      Number(box.dpr || 1),
      rangeFilter || '',
      sourceFilter || '',
      modelFilter || '',
      customDateStart || 0,
      customDateEnd || 0,
      active.map((cfg) => cfg.key).join(','),
      Number(hover || -1),
      Number(chartPinnedIndex || -1),
      chartHover.focusKey || '',
      Math.round(Number(progress || 1) * 1000),
      data.length,
      Number(first.start || 0),
      Number(last.start || 0),
      sum.total,
      sum.input,
      sum.output,
      sum.cacheRead,
      sum.requests,
    ].join('|');
  } catch { return ''; }
}

function drawChart(rows, s, hover = -1, progress = 1){
  const chartDrawStartedAt = perfNow();
  const ownPerfBucket = !currentRenderPerf;
  const light = chartLightMode(hover);
  if(ownPerfBucket) perfBucket(light ? 'chart:light-redraw' : (hover >= 0 ? 'chart:hover' : 'chart:redraw'));
  ensureVisibleSeries();
  const canvas = document.getElementById('usageChart');
  if(!canvas){
    if(ownPerfBucket){ finishPerfBucket(0); try { updatePerfPanel(); } catch {} }
    return;
  }
  const bucketStartedAt = perfNow();
  const data = bucketRows(rows, s);
  markPerfStage('chartBucketMs', perfNow() - bucketStartedAt);
  const canvasStartedAt = perfNow();
  const app = document.getElementById('app');
  const zoomSettling = Date.now() < Number(zoomInteractionUntil || 0) || Boolean(document.body?.classList?.contains?.('is-zooming')) || Boolean(app?.classList?.contains?.('is-zooming'));
  const resizeSettling = Date.now() < Number(chartResizeQuietUntil || 0) || Boolean(document.body?.classList?.contains?.('is-resizing')) || Boolean(app?.classList?.contains?.('is-resizing'));
  const canReuseExistingBitmap = chartPoints.length && canvas.width > 0 && canvas.height > 0 && hover < 0 && Number(chartPinnedIndex || -1) < 0;
  if(light && (zoomSettling || resizeSettling) && canReuseExistingBitmap){
    markPerfStage('chartCanvasMs', perfNow() - canvasStartedAt);
    markPerfStage('chartDrawMs', perfNow() - chartDrawStartedAt);
    if(ownPerfBucket){
      finishPerfBucket(data.length);
      try { updatePerfPanel(); } catch {}
    }
    return;
  }
  const box = chartCanvasBox(canvas, { source: light ? 'light-redraw' : 'draw', allowEstimate: chartInteractionLightMode() });
  const rect = { width: box.width, height: box.height };
  const dpr = box.dpr || window.devicePixelRatio || 1;
  const nextWidth = Math.max(1, Math.round(box.width * dpr));
  const nextHeight = Math.max(1, Math.round(box.height * dpr));
  const canvasDpr = canvas.dataset ? canvas.dataset.dpr : canvas.__dashboardDpr;
  const active = SERIES.filter((cfg) => visibleSeries.has(cfg.key));
  const drawSig = chartDrawSignature(data, active, box, hover, progress);
  if(drawSig && drawSig === lastChartDrawSignature && canvas.width === nextWidth && canvas.height === nextHeight && String(canvasDpr || '') === String(dpr)){
    markPerfStage('chartCanvasMs', perfNow() - canvasStartedAt);
    markPerfStage('chartDrawMs', perfNow() - chartDrawStartedAt);
    if(ownPerfBucket){
      finishPerfBucket(data.length);
      try { updatePerfPanel(); } catch {}
    }
    return;
  }
  const resizeStartedAt = perfNow();
  let resizedCanvas = false;
  if(canvas.width !== nextWidth || canvas.height !== nextHeight || canvasDpr !== String(dpr)){
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    resizedCanvas = true;
    if(canvas.dataset) canvas.dataset.dpr = String(dpr);
    else canvas.__dashboardDpr = String(dpr);
  }
  rememberChartCanvasBox(canvas, box.width, box.height, dpr, resizedCanvas ? 'resize' : (box.cached ? 'cached' : 'draw'));
  if(resizedCanvas) markPerfStage('chartResizeMs', perfNow() - resizeStartedAt);
  const paintStartedAt = perfNow();
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if(ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  else {
    if(ctx.resetTransform) ctx.resetTransform();
    ctx.scale(dpr, dpr);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, rect.width, rect.height);
  const pad = { l: 58, r: 28, t: 18, b: 36 };
  const w = Math.max(1, rect.width - pad.l - pad.r);
  const h = Math.max(1, rect.height - pad.t - pad.b);
  const mixedScale = new Set(active.map((cfg) => cfg.kind)).size > 1;
  const globalMax = Math.max(1, ...data.flatMap((b) => active.map((cfg) => b[cfg.key] || 0)));
  const seriesMax = new Map(active.map((cfg) => [cfg.key, Math.max(1, ...data.map((b) => Number(b[cfg.key] || 0)))]));
  const scaleFor = (cfg) => mixedScale ? (seriesMax.get(cfg.key) || 1) : globalMax;
  const plotBg = light ? null : ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
  if(plotBg){
    plotBg.addColorStop(0, 'rgba(22,135,245,.035)');
    plotBg.addColorStop(1, 'rgba(255,255,255,0)');
  }
  ctx.fillStyle = plotBg || 'rgba(22,135,245,.018)';
  ctx.fillRect(pad.l, pad.t, w, h);
  if(!light){
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
  }
  ctx.strokeStyle = 'rgba(149,164,184,.18)';
  ctx.fillStyle = '#7b8190';
  ctx.font = '12px Segoe UI, Microsoft YaHei UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;
  const gridSteps = light ? 3 : 4;
  for(let i = 0; i <= gridSteps; i++){
    const y = pad.t + h * i / gridSteps;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
    if(!light){
      const val = mixedScale ? `${Math.round((1 - i / gridSteps) * 100)}%` : axisLabel(active, globalMax * (1 - i / gridSteps));
      ctx.fillText(val, 8, y + 4);
    }
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
    if(!light){
      ctx.strokeStyle = rgba(cfg.color, cfg.key === 'total' ? .18 : .12);
      ctx.lineWidth = (cfg.key === 'total' ? 2.35 : 1.85) + 3;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash([]);
      drawSmooth(ctx, points);
      ctx.stroke();
    }
    ctx.strokeStyle = cfg.color;
    ctx.lineWidth = cfg.key === 'total' ? 2.35 : 1.85;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = hover >= 0 && cfg.key !== 'total' ? .78 : 1;
    ctx.setLineDash(cfg.dash || []);
    drawSmooth(ctx, points);
    ctx.stroke();
    if(!light && cfg.key === 'total'){
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
  if(!light) data.forEach((b, i) => {
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
  if(!light && hover >= 0 && chartPoints[hover]){
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
  markPerfStage('chartPaintMs', perfNow() - paintStartedAt);
  markPerfStage('chartCanvasMs', perfNow() - canvasStartedAt);
  markPerfStage('chartDrawMs', perfNow() - chartDrawStartedAt);
  lastChartDrawSignature = drawSig;
  chartGeometryDirty = false;
  if(ownPerfBucket){
    finishPerfBucket(data.length);
    try { updatePerfPanel(); } catch {}
  }
}
