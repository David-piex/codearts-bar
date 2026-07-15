(() => {
  const f = window.CodeArtsFormat;
  const element = (selector) => document.querySelector(selector);
  function metrics(snapshot, range, rangeLabel) {
    const usage = snapshot.selectedRange ? snapshot.usage.range : snapshot.usage[range] || snapshot.usage.today;
    element("#metricTotal").textContent = f.token(usage.total);
    element("#metricDelta").textContent =
      snapshot.selectedRange
        ? `${rangeLabel} · 本地统计`
        : range === "window"
        ? `${snapshot.config.windowHours} \u5c0f\u65f6\u6eda\u52a8\u7a97\u53e3`
        : range === "week"
          ? "\u6700\u8fd1 7 \u5929"
          : range === "all"
            ? "\u5168\u90e8\u672c\u5730\u8bb0\u5f55"
            : `\u4eca\u65e5\u8f6f\u4e0a\u9650 ${snapshot.status.label || ""}`;
    element("#metricMessages").textContent = f.exact.format(
      f.number(usage.messages),
    );
    element("#metricInput").textContent = f.token(usage.input);
    element("#metricOutput").textContent = f.token(usage.output);
    element("#metricCacheWrite").textContent = f.token(usage.cacheWrite);
    element("#metricCacheRead").textContent = f.token(usage.cacheRead);
    element("#metricReusable").textContent = f.token(f.number(usage.input) + f.number(usage.cacheRead));
    const cacheRate = usage.cacheHitRate;
    const cacheHasData = cacheRate !== null && cacheRate !== undefined;
    element("#metricCache").textContent = f.percent(cacheRate);
    if (cacheHasData) {
      element("#metricCacheTokens").textContent = `${f.token(usage.cacheRead)} token \u547d\u4e2d`;
    } else {
      if (snapshot.selectedRange) {
        element("#metricCacheTokens").textContent = "当前范围暂无缓存数据";
      } else {
      const fallback = snapshot.usage.week || snapshot.usage.all || {};
      const fallbackRate = fallback.cacheHitRate;
      element("#metricCacheTokens").textContent =
        fallbackRate !== null && fallbackRate !== undefined
          ? `\u5f53\u524d\u8303\u56f4\u65e0\u8bf7\u6c42 \u00b7 \u8fd1 7 \u5929 ${f.percent(fallbackRate)}`
          : "\u5f53\u524d\u8303\u56f4\u6682\u65e0\u7f13\u5b58\u6570\u636e";
      }
    }
    const hasRequests = f.number(usage.messages) > 0;
    const rate = hasRequests
      ? (f.number(usage.errors) / f.number(usage.messages)) * 100
      : null;
    element("#metricErrors").textContent = f.percent(rate);
    element("#metricErrorCount").textContent = hasRequests
      ? `${f.exact.format(f.number(usage.errors))} \u4e2a\u9519\u8bef`
      : "\u5f53\u524d\u8303\u56f4\u65e0\u8bf7\u6c42";
  }
  function models(snapshot) {
    const rows = snapshot.models || [],
      max = Math.max(1, ...rows.map((item) => f.number(item.total)));
    element("#models").innerHTML = rows.length
      ? rows
          .map(
            (item) =>
              `<div class="rank-row"><span class="rank-name" title="${f.html([item.name, item.provider].filter(Boolean).join(" ? "))}">${f.html(item.name)}</span><progress class="rank-track" max="100" value="${Math.max(2, (f.number(item.total) / max) * 100)}"></progress><span class="rank-value">${f.token(item.total)}</span></div>`,
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
  function compactDirectory(value) {
    const directory = String(value || "");
    const parts = directory.split(/[\\/]+/).filter(Boolean);
    return parts.length > 2 ? `\u2026\\${parts.slice(-2).join("\\")}` : directory;
  }
  function sessions(snapshot) {
    const rows = snapshot.sessions || [];
    sessionRows(rows);
  }
  function providers(snapshot) {
    const rows = snapshot.providers || [], max = Math.max(1, ...rows.map((item) => f.number(item.total)));
    element("#providers").innerHTML = rows.length
      ? rows.map((item) => `<div class="rank-row"><span class="rank-name" title="${f.html((item.models || []).join(", "))}">${f.html(item.name)}</span><progress class="rank-track" max="100" value="${Math.max(2, (f.number(item.total) / max) * 100)}"></progress><span class="rank-value">${f.token(item.total)}</span></div>`).join("")
      : '<p class="empty-copy">暂无 Provider 调用记录</p>';
  }
  function sessionRows(rows, page = null) {
    element("#sessions").innerHTML = rows.length
      ? rows
          .map(
            (item) =>
              `<div class="session-row" data-session-id="${f.html(item.id)}"><div class="session-main"><b>${f.html(item.title)}</b><span title="${f.html(item.directory || "")}">${f.html(compactDirectory(item.directory) || item.sourceLabel || "\u672c\u5730\u4f1a\u8bdd")}</span></div><span class="session-meta">${f.html(item.model || item.sourceLabel)}</span><span class="session-total">${f.token(item.total)}${item.age == null ? "" : ` \u00b7 ${f.age(item.age)}`}</span><div class="session-export-actions"><button data-session-export="xlsx" title="\u5bfc\u51fa Excel">XLSX</button><button data-session-export="md" title="\u5bfc\u51fa Markdown">MD</button><button data-session-export="json" title="\u5bfc\u51fa JSON">JSON</button></div></div>`,
          )
          .join("")
      : '<p class="empty-copy">\u6682\u65e0\u6700\u8fd1\u4f1a\u8bdd</p>';
    if (page) {
      element("#sessionCount").textContent = `${f.exact.format(page.total || 0)} \u6761`;
      element("#sessionPageLabel").textContent = `${page.page || 1} / ${page.pageCount || 1}`;
      element("#sessionPrevious").disabled = Number(page.page || 1) <= 1;
      element("#sessionNext").disabled = Number(page.page || 1) >= Number(page.pageCount || 1);
    }
  }
  function requests(snapshot) {
    const rows = snapshot.requests || [];
    requestRows(rows, { page: 1, pageCount: 1, total: Math.max(rows.length, f.number(snapshot.requestTotal)) });
  }
  function requestRows(rows, page = null) {
    const total = Math.max(rows.length, f.number(page?.total));
    element("#requestCount").textContent = `${f.exact.format(total)} 条`;
    element("#requests").innerHTML = rows.length ? rows.map((item) => {
      const when = item.time ? new Date(item.time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
      const latency = Number.isFinite(Number(item.latencyMs)) ? f.milliseconds(item.latencyMs) : "—";
      return `<tr data-request-id="${f.html(item.id)}" tabindex="0"><td>${f.html(when)}</td><td>${f.html(item.sourceLabel || item.source || "—")}</td><td><b>${f.html(item.model || "—")}</b><small>${f.html(item.provider || "")}</small></td><td>${f.token(item.input)}</td><td>${f.token(item.output)}</td><td>${f.token(item.cacheWrite)}</td><td>${f.token(item.cacheRead)}</td><td><b>${f.token(item.total)}</b></td><td>${latency}</td><td><span class="request-status ${item.ok ? "ok" : "bad"}">${f.html(String(item.status || (item.ok ? 200 : "错误")))}</span></td><td class="request-session" title="${f.html(item.sessionTitle)}">${f.html(item.sessionTitle)}</td></tr>`;
    }).join("") : '<tr><td colspan="11" class="empty-copy">当前筛选范围暂无请求</td></tr>';
    if (page) {
      element("#requestPageLabel").textContent = `${page.page || 1} / ${page.pageCount || 1}`;
      element("#requestPrevious").disabled = Number(page.page || 1) <= 1;
      element("#requestNext").disabled = Number(page.page || 1) >= Number(page.pageCount || 1);
    }
  }
  function requestDetail(item) {
    const detail = element("#requestDetail");
    if (!item) { detail.hidden = true; detail.innerHTML = ""; return; }
    const metric = (label, value) => `<div><span>${f.html(label)}</span><b>${f.html(value)}</b></div>`;
    detail.innerHTML = `<div class="surface-header"><div><span class="section-label">\u8bf7\u6c42\u8be6\u60c5</span><h3>${f.html(item.model || "\u672a\u77e5\u6a21\u578b")}</h3></div><button data-request-detail-close title="\u5173\u95ed">\u00d7</button></div><div class="request-detail-grid">${metric("\u603b Token", f.token(item.total))}${metric("\u63a8\u7406", f.token(item.reasoning))}${metric("\u5ef6\u8fdf", f.milliseconds(item.latencyMs))}${metric("TTFT", f.milliseconds(item.ttftMs))}${metric("\u9996\u5185\u5bb9", f.milliseconds(item.firstContentMs))}${metric("\u8f93\u51fa\u901f\u5ea6", Number.isFinite(Number(item.outputTokensPerSec)) ? `${Number(item.outputTokensPerSec).toFixed(2)} token/s` : "\u2014")}</div>${item.error ? `<p class="request-detail-error">${f.html(item.error)}</p>` : ""}`;
    detail.hidden = false;
  }
  function performance(snapshot) {
    const performance = snapshot.performance || {};
    element("#latencyAvg").textContent = f.milliseconds(performance.latencyAvg);
    element("#latencyP95").textContent = f.milliseconds(performance.latencyP95);
    element("#performanceErrors").textContent = f.exact.format(f.number((snapshot.usage?.range || {}).errors));
    element("#providerCount").textContent = f.exact.format((snapshot.providers || []).length);
    const completeness = snapshot.completeness || {};
    const metrics = completeness.metrics || performance.metrics || {};
    const overall = completeness.sampled ? "抽样" : completeness.complete === false ? "部分" : "完整";
    element("#performanceComplete").textContent = `${overall} · 延迟 ${metrics.latency === false ? "部分" : "完整"} · 首内容 ${metrics.firstContentApprox ? "完整" : "部分"} · 速度 ${metrics.outputTokensPerSec ? "完整" : "部分"} · TTFT ${metrics.ttft ? "完整" : "不可用"}`;
    element("#dataAdapter").textContent = snapshot.adapter || "\u672a\u77e5";
    element("#dataSources").textContent = f.exact.format((snapshot.sources || []).length);
    element("#dataRequests").textContent = f.exact.format(Math.max((snapshot.requests || []).length, f.number(snapshot.requestTotal)));
    element("#dataSessions").textContent = f.exact.format(Math.max((snapshot.sessions || []).length, f.number(snapshot.sessionTotal)));
    element("#dbSize").textContent = f.bytes(snapshot.dbSize);
    const errors = [...(snapshot.sourceErrors || []), ...(snapshot.diagnostics?.sourceErrors || [])];
    const checks = snapshot.diagnostics?.items || [];
    const sourceCoverage = completeness.sources || {};
    element("#dataHealth").textContent = completeness.complete === false
      ? `部分数据 · ${f.exact.format(f.number(sourceCoverage.failed) + f.number(sourceCoverage.missing))} 个来源异常`
      : errors.length ? `${errors.length} \u4e2a\u6570\u636e\u6e90\u5f02\u5e38` : checks.every((item) => item.ok && item.quickCheck === "ok") ? "\u6570\u636e\u5e93\u68c0\u67e5\u6b63\u5e38" : "\u8bfb\u53d6\u6b63\u5e38";
    element("#diagnosticDetail").textContent = errors.length
      ? errors.map((item) => `${item.source || "local"}: ${item.message}`).join("\n")
      : checks.map((item) => `${item.label || item.source}: ${item.quickCheck || "ok"} · ${f.exact.format(item.sessions)} 会话 · ${f.exact.format(item.messages)} 消息`).join("\n");
  }
  window.CodeArtsViews = Object.freeze({
    metrics,
    models,
    providers,
    sources,
    sessions,
    sessionRows,
    requests,
    requestRows,
    requestDetail,
    performance,
  });
})();
