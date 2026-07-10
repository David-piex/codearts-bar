(() => {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  let snapshot = null;
  let range = saved.range || "today";
  const element = (selector) => document.querySelector(selector),
    all = (selector) => [...document.querySelectorAll(selector)];
  function trendRows() {
    return range === "today" || range === "window"
      ? snapshot.trends.hourly24h
      : snapshot.trends.daily14d;
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
    if (message.type === "snapshot") receive(message.payload);
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
