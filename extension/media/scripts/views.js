(() => {
  const f = window.CodeArtsFormat;
  const element = (selector) => document.querySelector(selector);
  function metrics(snapshot, range) {
    const usage = snapshot.usage[range] || snapshot.usage.today;
    element("#metricTotal").textContent = f.token(usage.total);
    element("#metricDelta").textContent =
      range === "window"
        ? `${snapshot.config.windowHours} \u5c0f\u65f6\u6eda\u52a8\u7a97\u53e3`
        : range === "week"
          ? "\u6700\u8fd1 7 \u5929"
          : range === "all"
            ? "\u5168\u90e8\u672c\u5730\u8bb0\u5f55"
            : `\u4eca\u65e5\u8f6f\u4e0a\u9650 ${snapshot.status.label || ""}`;
    element("#metricMessages").textContent = f.exact.format(
      f.number(usage.messages),
    );
    element("#metricCache").textContent = f.percent(usage.cacheHitRate);
    element("#metricCacheTokens").textContent =
      `${f.token(usage.cacheRead)} cache token`;
    const rate = usage.messages
      ? (f.number(usage.errors) / f.number(usage.messages)) * 100
      : 0;
    element("#metricErrors").textContent = f.percent(rate);
    element("#metricErrorCount").textContent =
      `${f.exact.format(f.number(usage.errors))} \u4e2a\u9519\u8bef`;
  }
  function models(snapshot) {
    const rows = snapshot.models || [],
      max = Math.max(1, ...rows.map((item) => f.number(item.total)));
    element("#models").innerHTML = rows.length
      ? rows
          .map(
            (item) =>
              `<div class="rank-row"><span class="rank-name" title="${f.html(item.provider)}">${f.html(item.name)}</span><progress class="rank-track" max="100" value="${Math.max(2, (f.number(item.total) / max) * 100)}"></progress><span class="rank-value">${f.token(item.total)}</span></div>`,
          )
          .join("")
      : '<p class="empty-copy">\u6682\u65e0\u6a21\u578b\u8c03\u7528\u8bb0\u5f55</p>';
  }
  function sources(snapshot) {
    const rows = snapshot.sources || [],
      total = rows.reduce((sum, item) => sum + f.number(item.total), 0),
      lead = rows[0] ? f.number(rows[0].total) / (total || 1) : 0;
    element("#sourceCount").textContent = f.exact.format(rows.length);
    element("#sourceRing").className =
      `source-ring share-${Math.max(0, Math.min(10, Math.round(lead * 10)))}`;
    element("#sources").innerHTML = rows.length
      ? rows
          .map(
            (item) =>
              `<div class="source-item"><i></i><div><b>${f.html(item.label)}</b><span>${f.exact.format(f.number(item.messages))} \u6b21\u8c03\u7528</span></div><em>${total ? f.percent((f.number(item.total) / total) * 100) : "\u2014"}</em></div>`,
          )
          .join("")
      : '<p class="empty-copy">\u672a\u53d1\u73b0\u6570\u636e\u6e90</p>';
  }
  function sessions(snapshot) {
    const rows = snapshot.sessions || [];
    element("#sessions").innerHTML = rows.length
      ? rows
          .map(
            (item) =>
              `<div class="session-row"><div class="session-main"><b>${f.html(item.title)}</b><span>${f.html(item.directory || item.sourceLabel || "\u672c\u5730\u4f1a\u8bdd")}</span></div><span class="session-meta">${f.html(item.model || item.sourceLabel)}</span><span class="session-total">${f.token(item.total)} \u00b7 ${f.age(item.age)}</span></div>`,
          )
          .join("")
      : '<p class="empty-copy">\u6682\u65e0\u6700\u8fd1\u4f1a\u8bdd</p>';
  }
  function performance(snapshot) {
    const available = snapshot.capabilities?.performance !== false;
    const surface = element(".performance-surface");
    surface.classList.toggle("performance-unavailable", !available);
    document.querySelectorAll("[data-performance-only]").forEach((item) => { item.hidden = !available; });
    element("#performanceKicker").textContent = available ? "RESPONSE HEALTH" : "LOCAL STORAGE";
    element("#performanceTitle").textContent = available ? "\u54cd\u5e94\u6027\u80fd" : "\u672c\u5730\u6570\u636e";
    element("#dbSize").textContent = f.bytes(snapshot.dbSize);
    if (!available) return;
    const p = snapshot.performance || {};
    element("#perfLatency").textContent = f.milliseconds(p.latencyAvg);
    element("#perfP95").textContent = f.milliseconds(p.latencyP95);
    element("#perfFirst").textContent = f.milliseconds(p.firstContentAvg);
    element("#perfSpeed").textContent = Number.isFinite(Number(p.outputSpeed))
      ? `${Number(p.outputSpeed).toFixed(1)} t/s`
      : "\u2014";
    element("#perfQueue").textContent = f.milliseconds(p.queueAvg);
  }
  window.CodeArtsViews = Object.freeze({
    metrics,
    models,
    sources,
    sessions,
    performance,
  });
})();
