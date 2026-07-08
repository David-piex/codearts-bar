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
