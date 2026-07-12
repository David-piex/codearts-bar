(() => {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  let snapshot = null;
  let range = saved.range || "today";
  let customStart = Number(saved.customStart || 0);
  let customEnd = Number(saved.customEnd || 0);
  const element = (selector) => document.querySelector(selector),
    all = (selector) => [...document.querySelectorAll(selector)];
  function zeroTrendRows() {
    const end = Number(snapshot?.timestamp) || Date.now();
    const hourly = snapshot?.selectedRange?.bucketMs === 3600000 || range === "today" || range === "window";
    const count = hourly ? 24 : Math.min(31, Math.max(7, Math.ceil(((snapshot?.selectedRange?.end || Date.now()) - (snapshot?.selectedRange?.start || Date.now() - 14 * 86400000)) / 86400000)));
    const bucketMs = hourly ? 3600000 : 86400000;
    const alignedEnd = Math.floor(end / bucketMs) * bucketMs;
    return Array.from({ length: count }, (_, index) => ({
      start: alignedEnd - (count - 1 - index) * bucketMs,
      total: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
    }));
  }
  function trendRows() {
    const rows = snapshot.trends.range?.length ? snapshot.trends.range : (range === "today" || range === "window" ? snapshot.trends.hourly24h : snapshot.trends.daily14d);
    return Array.isArray(rows) && rows.length ? rows : zeroTrendRows();
  }
  const labels = { today: "今天", window: "24 小时", week: "7 天", "14d": "14 天", "30d": "30 天", all: "全部", custom: "自定义" };
  function localInputValue(timestamp) {
    if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return "";
    const date = new Date(Number(timestamp) - new Date(Number(timestamp)).getTimezoneOffset() * 60000);
    return date.toISOString().slice(0, 16);
  }
  function rangeState() { return { range, customStart, customEnd }; }
  function rangeText() {
    if (range !== "custom") return labels[range] || labels.today;
    if (!customStart || !customEnd) return "自定义";
    const format = (value) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    return `${format(customStart)} - ${format(customEnd)}`;
  }
  function syncRangeChrome() {
    all("[data-range]").forEach((button) => button.classList.toggle("active", button.dataset.range === range));
    element("#rangeSelect").value = range;
    if (range === "custom") {
      if (!customStart) customStart = Date.now() - 7 * 86400000;
      if (!customEnd) customEnd = Date.now();
      element("#rangeStart").value = localInputValue(customStart);
      element("#rangeEnd").value = localInputValue(customEnd);
    }
    element("#rangeLabel").textContent = rangeText();
    element("#rangeLabel").hidden = range !== "custom";
    element("#customRange").hidden = range !== "custom";
  }
  function requestRange() {
    document.body.classList.add("refreshing");
    vscode.postMessage({ type: "range", preset: range, range: range === "custom" ? { start: customStart, end: customEnd } : undefined });
  }
  function selectRange(next) {
    range = next;
    vscode.setState(rangeState());
    syncRangeChrome();
    if (range !== "custom") requestRange();
  }
  function render() {
    if (!snapshot?.ok) return;
    syncRangeChrome();
    element("#updated").textContent =
      `${snapshot.stale ? "\u7f13\u5b58\u6570\u636e \u00b7 " : ""}${snapshot.updatedAt || "\u521a\u521a\u66f4\u65b0"}${snapshot.adapter ? ` \u00b7 ${snapshot.adapter}` : ""}`;
    const views = window.CodeArtsViews;
    views.metrics(snapshot, range, rangeText());
    views.models(snapshot);
    views.sources(snapshot);
    views.sessions(snapshot);
    views.performance(snapshot);
    window.CodeArtsChart.draw(
      element("#trendChart"),
      trendRows() || [],
      element("#chartEmpty"),
    );
  }
  function receive(payload) {
    snapshot = payload;
    element("#loading").hidden = true;
    if (!payload?.ok) {
      element("#dashboard").hidden = true;
      element("#error").hidden = false;
      element("#errorText").textContent =
        payload?.error || "\u672a\u77e5\u9519\u8bef";
      return;
    }
    element("#error").hidden = true;
    element("#dashboard").hidden = false;
    render();
  }
  document.addEventListener("click", (event) => {
    const rangeButton = event.target.closest("[data-range]");
    if (rangeButton) {
      selectRange(rangeButton.dataset.range);
      return;
    }
    if (event.target.closest("[data-range-cancel]")) { range = snapshot?.selectedRange?.preset || saved.range || "today"; syncRangeChrome(); return; }
    if (event.target.closest("[data-range-apply]")) {
      const start = new Date(element("#rangeStart").value).getTime();
      const end = new Date(element("#rangeEnd").value).getTime();
      const error = !Number.isFinite(start) || !Number.isFinite(end) ? "请选择开始和结束时间" : end <= start ? "结束时间需晚于开始时间" : end > Date.now() + 60000 ? "结束时间不能晚于当前时间" : end - start > 366 * 86400000 ? "时间范围最多支持 366 天" : "";
      element("#rangeError").textContent = error; element("#rangeError").hidden = !error;
      if (!error) { customStart = start; customEnd = end; vscode.setState(rangeState()); syncRangeChrome(); requestRange(); }
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action) vscode.postMessage({ type: action });
  });
  element("#rangeSelect").addEventListener("change", (event) => selectRange(event.target.value));
  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "snapshot" || message.type === "details") {
      if (message.payload?.selectedRange?.preset) {
        range = message.payload.selectedRange.preset;
        customStart = Number(message.payload.selectedRange.start || customStart);
        customEnd = Number(message.payload.selectedRange.end || customEnd);
        vscode.setState(rangeState());
      }
      receive(message.payload);
    }
    if (message.type === "refreshing")
      document.body.classList.toggle("refreshing", Boolean(message.value));
  });
  window.addEventListener(
    "resize",
    () =>
      snapshot?.ok &&
      window.CodeArtsChart.draw(
        element("#trendChart"),
        trendRows() || [],
        element("#chartEmpty"),
      ),
  );
  vscode.postMessage({ type: "ready" });
})();
