function animateChart(rows, s, instant = false){
  if(chartAnimationFrame){
    cancelAnimationFrame(chartAnimationFrame);
    chartAnimationFrame = null;
  }
  if(instant || prefersReducedMotion){
    drawChart(rows, s, -1, 1);
    return;
  }
  const started = performance.now();
  const duration = 420;
  const frame = (now) => {
    const raw = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - raw, 3);
    drawChart(rows, s, -1, eased);
    if(raw < 1) chartAnimationFrame = requestAnimationFrame(frame);
    else chartAnimationFrame = null;
  };
  chartAnimationFrame = requestAnimationFrame(frame);
}

function animatePinnedHover(rows, s){
  if(chartHoverFrame){
    cancelAnimationFrame(chartHoverFrame);
    chartHoverFrame = null;
  }
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
    if(chartGeometryDirty){
      drawChart(rows, s, -1, 1);
    }
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
    const nextHoverKey = `${hit.idx}:${hit.focus?.key || ''}:${chartPinnedIndex}`;
    chartHover.idx = hit.idx;
    chartHover.focusKey = hit.focus?.key || '';
    chartHover.x = targetPoint.x;
    chartHover.y = hit.focus?.y ?? (canvas.getBoundingClientRect().height / 2);
    chartHover.pulse = 0;
    if(nextHoverKey !== lastChartHoverKey){
      lastChartHoverKey = nextHoverKey;
      if(chartHoverFrame) cancelAnimationFrame(chartHoverFrame);
      chartHoverFrame = requestAnimationFrame(() => {
        chartHoverFrame = null;
        drawChart(rows, s, hit.idx, 1);
      });
    }
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
  canvas.onmouseleave = () => { lastChartHoverKey = ''; clearChartHover(); };
}
