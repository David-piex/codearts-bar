(() => {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  let snapshot = null;
  let range = saved.range || "today";
  const element = (selector) => document.querySelector(selector),
    all = (selector) => [...document.querySelectorAll(selector)];
  function zeroTrendRows() {
    const end = Number(snapshot?.timestamp) || Date.now();
    const hourly = range === "today" || range === "window";
    const count = hourly ? 24 : 14;
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
    const rows = range === "today" || range === "window"
      ? snapshot.trends.hourly24h
      : snapshot.trends.daily14d;
    return Array.isArray(rows) && rows.length ? rows : zeroTrendRows();
  }
  function render() {
    if (!snapshot?.ok) return;
    all("[data-range]").forEach((button) =>
      button.classList.toggle("active", button.dataset.range === range),
    );
    element("#updated").textContent =
      `${snapshot.stale ? "\u7f13\u5b58\u6570\u636e \u00b7 " : ""}${snapshot.updatedAt || "\u521a\u521a\u66f4\u65b0"}${snapshot.adapter ? ` \u00b7 ${snapshot.adapter}` : ""}`;
    const views = window.CodeArtsViews;
    views.metrics(snapshot, range);
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
      range = rangeButton.dataset.range;
      vscode.setState({ ...saved, range });
      render();
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action) vscode.postMessage({ type: action });
  });
  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "snapshot" || message.type === "details") receive(message.payload);
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
