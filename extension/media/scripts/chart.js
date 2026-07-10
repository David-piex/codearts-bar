(() => {
  const { niceChartScale, chartAxisIndices } = window.CodeArtsChartAxis || {};
  if (typeof niceChartScale !== "function" || typeof chartAxisIndices !== "function") {
    throw new Error("CodeArts chart axis module unavailable");
  }

  const states = new WeakMap();

  function compactAxisValue(value) {
    const number = Number(value) || 0;
    const abs = Math.abs(number);
    const format = (divisor, suffix) => `${(number / divisor).toFixed(abs >= divisor * 10 ? 0 : 1).replace(/\.0$/, "")}${suffix}`;
    if (abs >= 1e9) return format(1e9, "B");
    if (abs >= 1e6) return format(1e6, "M");
    if (abs >= 1e3) return format(1e3, "K");
    return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "");
  }

  function fullValue(value) {
    return new Intl.NumberFormat("zh-CN").format(Math.round(Number(value) || 0));
  }

  function dateAxisLabel(row, hourly) {
    const date = new Date(row?.start || Date.now());
    return hourly ? `${String(date.getHours()).padStart(2, "0")}:00` : `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function tooltipTime(row, hourly) {
    const date = new Date(row?.start || Date.now());
    const dateText = `${date.getMonth() + 1}月${date.getDate()}日`;
    return hourly ? `${dateText} ${String(date.getHours()).padStart(2, "0")}:00` : dateText;
  }

  function stateFor(canvas, empty) {
    let state = states.get(canvas);
    if (state) {
      state.empty = empty;
      return state;
    }
    state = {
      canvas,
      empty,
      tooltip: canvas.parentElement?.querySelector("[data-chart-tooltip]") || null,
      rows: [],
      hover: -1,
      frame: 0,
      geometry: null,
    };
    const pointIndex = (event) => {
      if (!state.rows.length || !state.geometry) return -1;
      const rect = canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const { left, plotWidth } = state.geometry;
      const ratio = Math.max(0, Math.min(1, (localX - left) / Math.max(1, plotWidth)));
      return state.rows.length === 1 ? 0 : Math.round(ratio * (state.rows.length - 1));
    };
    canvas.addEventListener("pointermove", (event) => {
      const next = pointIndex(event);
      if (next < 0) return;
      state.hover = next;
      paint(state);
    });
    canvas.addEventListener("pointerleave", () => {
      state.hover = -1;
      if (state.tooltip) state.tooltip.hidden = true;
      paint(state);
    });
    canvas.addEventListener("pointerdown", (event) => {
      const next = pointIndex(event);
      if (next >= 0) {
        state.hover = next;
        paint(state);
      }
    });
    states.set(canvas, state);
    return state;
  }

  function showTooltip(state, row, index, hourly, px, totalY, outputY) {
    const tooltip = state.tooltip;
    if (!tooltip) return;
    tooltip.innerHTML = `<strong>${tooltipTime(row, hourly)}</strong><span><i class="total"></i>总量 <b>${fullValue(row.total)}</b></span><span><i class="output"></i>输出 <b>${fullValue(row.output)}</b></span>`;
    tooltip.hidden = false;
    const canvasRect = state.canvas.getBoundingClientRect();
    const areaRect = state.canvas.parentElement?.getBoundingClientRect() || canvasRect;
    const tooltipWidth = Math.max(126, tooltip.offsetWidth || 126);
    const localX = canvasRect.left - areaRect.left + px;
    const anchorY = canvasRect.top - areaRect.top + Math.min(totalY, outputY);
    const left = localX + tooltipWidth + 22 > areaRect.width ? localX - tooltipWidth - 12 : localX + 12;
    tooltip.style.left = `${Math.max(4, left)}px`;
    tooltip.style.top = `${Math.max(4, Math.min(areaRect.height - (tooltip.offsetHeight || 78) - 4, anchorY - 30))}px`;
    tooltip.dataset.index = String(index);
  }

  function paint(state) {
    cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(() => {
      const { canvas, empty, rows } = state;
      const hasRows = rows.length > 0;
      const hasValues = rows.some((row) => Number(row.total) > 0 || Number(row.output) > 0);
      empty.hidden = hasRows && hasValues;
      empty.classList.toggle("zero-state", hasRows && !hasValues);
      empty.textContent = hasRows ? "当前范围暂无 Token 使用" : "当前范围暂无趋势数据";
      canvas.hidden = !hasRows;
      if (!hasRows) {
        if (state.tooltip) state.tooltip.hidden = true;
        delete canvas.dataset.yAxisTicks;
        delete canvas.dataset.yAxisMax;
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const width = rect.width, height = rect.height;
      const pad = { left: width < 360 ? 40 : 48, right: 10, top: 22, bottom: 24 };
      const rawMax = Math.max(0, ...rows.map((item) => Number(item.total) || 0), ...rows.map((item) => Number(item.output) || 0));
      const scale = niceChartScale(rawMax);
      const plotWidth = Math.max(1, width - pad.left - pad.right);
      const plotHeight = Math.max(1, height - pad.top - pad.bottom);
      const x = (index) => pad.left + (rows.length === 1 ? plotWidth / 2 : index / (rows.length - 1) * plotWidth);
      const y = (value) => pad.top + (1 - (Number(value) || 0) / scale.max) * plotHeight;
      state.geometry = { left: pad.left, plotWidth };
      const style = getComputedStyle(document.documentElement);
      const line = style.getPropertyValue("--line-strong").trim();
      const accent = style.getPropertyValue("--accent").trim();
      const cyan = style.getPropertyValue("--cyan").trim();
      const muted = style.getPropertyValue("--muted").trim();
      ctx.clearRect(0, 0, width, height);
      ctx.font = "10px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif";
      ctx.fillStyle = muted;
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      scale.ticks.forEach((tick) => {
        const gridY = y(tick);
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, gridY);
        ctx.lineTo(width - pad.right, gridY);
        ctx.stroke();
        ctx.fillText(compactAxisValue(tick), pad.left - 7, gridY);
      });
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.font = "600 9px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif";
      ctx.fillText("Token", 4, 11);

      const path = (key) => {
        ctx.beginPath();
        rows.forEach((item, index) => {
          const px = x(index), py = y(item[key]);
          index ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
      };
      if (hasValues) {
        const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
        gradient.addColorStop(0, accent);
        gradient.addColorStop(1, "transparent");
        path("total");
        ctx.lineTo(x(rows.length - 1), height - pad.bottom);
        ctx.lineTo(x(0), height - pad.bottom);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.globalAlpha = 0.13;
        ctx.fill();
        ctx.globalAlpha = 1;
        path("total");
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
        path("output");
        ctx.strokeStyle = cyan;
        ctx.lineWidth = 1.35;
        ctx.stroke();
      }

      const hourly = rows.length > 2 && Number(rows.at(-1)?.start || 0) - Number(rows[0]?.start || 0) <= 48 * 3600000;
      ctx.fillStyle = muted;
      ctx.font = "9px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif";
      const xIndices = chartAxisIndices(rows.length, plotWidth, width < 420 ? 92 : 78);
      xIndices.forEach((index, position) => {
        ctx.textAlign = position === 0 ? "left" : position === xIndices.length - 1 ? "right" : "center";
        ctx.fillText(dateAxisLabel(rows[index], hourly), x(index), height - 5);
      });

      if (hasValues && state.hover >= 0 && rows[state.hover]) {
        const index = Math.min(rows.length - 1, state.hover);
        const row = rows[index];
        const px = x(index), totalY = y(row.total), outputY = y(row.output);
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, pad.top);
        ctx.lineTo(px, pad.top + plotHeight);
        ctx.stroke();
        for (const [py, color] of [[totalY, accent], [outputY, cyan]]) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = style.getPropertyValue("--surface-solid").trim() || "#fff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        showTooltip(state, row, index, hourly, px, totalY, outputY);
      } else if (state.tooltip) {
        state.tooltip.hidden = true;
      }

      canvas.dataset.yAxisTicks = JSON.stringify(scale.ticks);
      canvas.dataset.yAxisMax = String(scale.max);
      canvas.dataset.yAxisUnit = "token";
      canvas.dataset.xAxisLabels = JSON.stringify(xIndices.map((index) => dateAxisLabel(rows[index], hourly)));
      canvas.dataset.zeroState = String(!hasValues);
      canvas.setAttribute("aria-label", `Token 使用趋势图，纵轴 0 到 ${compactAxisValue(scale.max)}，${rows.length} 个时间点`);
    });
  }

  function draw(canvas, rows, empty) {
    const state = stateFor(canvas, empty);
    state.rows = Array.isArray(rows) ? rows : [];
    if (state.hover >= state.rows.length) state.hover = -1;
    paint(state);
  }

  window.CodeArtsChart = Object.freeze({ draw, compactAxisValue });
})();
