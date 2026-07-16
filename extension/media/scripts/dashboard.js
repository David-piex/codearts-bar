(() => {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  let snapshot = null;
  let range = saved.range || "today";
  let customStart = Number(saved.customStart || 0);
  let customEnd = Number(saved.customEnd || 0);
  function normalizeSelection(value) {
    const values = Array.isArray(value) ? value : value && value !== "all" ? [value] : [];
    return [...new Set(values.map((item) => String(item || "").trim()).filter((item) => item && item !== "all"))];
  }
  const filterPayload = (values) => values.length ? values : "all";
  let sourceFilter = normalizeSelection(saved.sourceFilter);
  let modelFilter = normalizeSelection(saved.modelFilter);
  let projectFilter = normalizeSelection(saved.projectFilter);
  const knownSources = new Map();
  const knownModels = new Set();
  const knownProjects = new Map();
  let openMenu = "";
  let latestGeneration = 0;
  let customDraftDirty = false;
  let sessionPage = Math.max(1, Number(saved.sessionPage || 1));
  let sessionPageSize = [10, 20, 50, 100].includes(Number(saved.sessionPageSize)) ? Number(saved.sessionPageSize) : 20;
  let sessionPageData = { items: [], total: 0, page: 1, pageCount: 1 };
  let requestPage = Math.max(1, Number(saved.requestPage || 1));
  let requestPageSize = [10, 20, 50, 100].includes(Number(saved.requestPageSize)) ? Number(saved.requestPageSize) : 20;
  let requestPageData = { items: [], total: 0, page: 1, pageCount: 1 };
  const selectedSessions = new Map((Array.isArray(saved.selectedSessions) ? saved.selectedSessions : []).filter((item) => item?.id).map((item) => [`${item.source || ""}:${item.id}`, item]));
  let selectedRequestId = saved.selectedRequestId || "";
  let selectedRequestSource = saved.selectedRequestSource || "";
  let databasePagesLoaded = false;
  const element = (selector) => document.querySelector(selector),
    all = (selector) => [...document.querySelectorAll(selector)];
  function zeroTrendRows() {
    const end = Number(snapshot?.timestamp) || Date.now();
    const dataRange = snapshot?.selectedRange?.preset || range;
    const hourly = snapshot?.selectedRange?.bucketMs === 3600000 || dataRange === "today" || dataRange === "window";
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
    const dataRange = snapshot?.selectedRange?.preset || range;
    const rows = snapshot.trends.range?.length ? snapshot.trends.range : (dataRange === "today" || dataRange === "window" ? snapshot.trends.hourly24h : snapshot.trends.daily14d);
    return Array.isArray(rows) && rows.length ? rows : zeroTrendRows();
  }
  const labels = { today: "今天", window: "24 小时", week: "7 天", "14d": "14 天", "30d": "30 天", all: "全部", custom: "自定义" };
  function localInputValue(timestamp) {
    if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return "";
    const date = new Date(Number(timestamp));
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function parseLocalInputValue(value) {
    const text = String(value || "").trim().replace("T", " ");
    const match = text.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:\s+(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (!match) return NaN;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), 0, 0);
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date.getTime() : NaN;
  }
  function rangeState() {
    return {
      range, customStart, customEnd, sourceFilter, modelFilter, projectFilter,
      sessionPage, requestPage, selectedRequestId, selectedRequestSource,
      sessionPageSize, requestPageSize,
      selectedSessions: [...selectedSessions.values()],
      sessionSearch: element("#sessionSearch")?.value || saved.sessionSearch || "",
      scrollTop: Number(document.scrollingElement?.scrollTop || 0),
    };
  }
  function rangeText(preset = range, start = customStart, end = customEnd) {
    if (preset !== "custom") return labels[preset] || labels.today;
    if (!start || !end) return "自定义";
    const format = (value) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    return `${format(start)} - ${format(end)}`;
  }
  function dataRangeText() {
    const selected = snapshot?.selectedRange;
    return selected?.preset
      ? rangeText(selected.preset, Number(selected.start || 0), Number(selected.end || 0))
      : rangeText();
  }
  function syncRangeChrome() {
    all("[data-range]").forEach((button) => button.classList.toggle("active", button.dataset.range === range));
    element("#rangeMenuValue").textContent = labels[range] || labels.today;
    all('[data-menu-option="range"]').forEach((button) => {
      const selected = button.dataset.value === range;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    if (range === "custom") {
      if (!customStart) customStart = Date.now() - 7 * 86400000;
      if (!customEnd) customEnd = Date.now();
      const active = document.activeElement;
      const editing = customDraftDirty || active === element("#rangeStart") || active === element("#rangeEnd");
      if (!editing) {
        element("#rangeStart").value = localInputValue(customStart);
        element("#rangeEnd").value = localInputValue(customEnd);
      }
    }
    element("#rangeLabel").textContent = rangeText();
    element("#rangeLabel").hidden = range !== "custom";
    element("#customRange").hidden = range !== "custom";
  }
  function setMenuOpen(name, next) {
    for (const menuName of ["range", "source", "model", "project", "sessionSize", "requestSize"]) {
      const expanded = menuName === name && next;
      element(`#${menuName}Menu`).hidden = !expanded;
      const trigger = menuName === "range" ? "#rangeMenuButton" : menuName === "sessionSize" ? "#sessionPageSizeButton" : menuName === "requestSize" ? "#requestPageSizeButton" : `#${menuName}Filter`;
      element(trigger).setAttribute("aria-expanded", String(expanded));
    }
    openMenu = next ? name : "";
  }
  function requestRange() {
    document.body.classList.add("refreshing");
    vscode.postMessage({ type: "range", preset: range, range: range === "custom" ? { start: customStart, end: customEnd } : undefined });
    requestSessionsPage(true);
    requestRequestsPage(true);
  }
  function menuOptionHtml(kind, value, label, selected) { return `<button data-menu-option="${kind}" data-value="${window.CodeArtsFormat.html(value)}" role="option" aria-selected="${selected}" class="${selected ? "selected" : ""}">${window.CodeArtsFormat.html(label)}</button>`; }
  function selectionLabel(values, options, allLabel) {
    if (!values.length) return allLabel;
    if (values.length === 1) return options.find((item) => item.value === values[0])?.label || values[0];
    return `已选 ${values.length} 项`;
  }
  function multiMenuHtml(kind, values, allLabel, options) {
    return menuOptionHtml(kind, "all", allLabel, !values.length)
      + options.map((item) => menuOptionHtml(kind, item.value, item.label, values.includes(item.value))).join("");
  }
  function syncScopeChrome() {
    const previousSelections = [sourceFilter.join("\0"), modelFilter.join("\0"), projectFilter.join("\0")];
    knownSources.clear();
    knownModels.clear();
    knownProjects.clear();
    for (const item of snapshot?.filterSources || snapshot?.sources || []) knownSources.set(item.id, item.label);
    for (const item of snapshot?.filterModels || snapshot?.models || []) knownModels.add(item.name);
    for (const item of snapshot?.filterProjects || snapshot?.projects || []) knownProjects.set(item.directory || item.id, { label: item.label, count: item.count });
    const sources = [...knownSources].map(([value, label]) => ({ value, label }));
    const models = [...knownModels].map((value) => ({ value, label: value }));
    const projects = [...knownProjects].map(([value, item]) => ({ value, label: `${item.label} (${item.count})` }));
    if (snapshot?.filterOptionsComplete) {
      const sourceValues = new Set(sources.map((item) => item.value));
      const modelValues = new Set(models.map((item) => item.value));
      const projectValues = new Set(projects.map((item) => item.value));
      sourceFilter = sourceFilter.filter((value) => sourceValues.has(value));
      modelFilter = modelFilter.filter((value) => modelValues.has(value));
      projectFilter = projectFilter.filter((value) => projectValues.has(value));
    }
    const sourceLabel = selectionLabel(sourceFilter, sources, "全部来源");
    const modelLabel = selectionLabel(modelFilter, models, "全部模型");
    const projectLabel = selectionLabel(projectFilter, projects.map((item) => ({ ...item, label: item.label.replace(/ \(\d+\)$/, "") })), "全部项目");
    element("#sourceMenu").innerHTML = multiMenuHtml("source", sourceFilter, "全部来源", sources);
    element("#modelMenu").innerHTML = multiMenuHtml("model", modelFilter, "全部模型", models);
    element("#projectMenu").innerHTML = multiMenuHtml("project", projectFilter, "全部项目", projects);
    element("#sourceFilterValue").textContent = sourceLabel;
    element("#modelFilterValue").textContent = modelLabel;
    element("#projectFilterValue").textContent = projectLabel;
    element("#filterContext").textContent = `${dataRangeText()} · ${sourceLabel} · ${modelLabel} · ${projectLabel}`;
    return previousSelections.some((value, index) => value !== [sourceFilter, modelFilter, projectFilter][index].join("\0"));
  }
  function requestScope() {
    document.body.classList.add("refreshing");
    vscode.setState(rangeState());
    vscode.postMessage({ type: "filter", source: filterPayload(sourceFilter), model: filterPayload(modelFilter), project: filterPayload(projectFilter) });
    requestSessionsPage(true);
    requestRequestsPage(true);
  }
  function selectedRangePayload() {
    const selected = snapshot?.selectedRange;
    if (selected?.preset === range && selected?.start && selected?.end) return { start: Number(selected.start), end: Number(selected.end) };
    if (range === "custom") return { start: customStart, end: customEnd };
    const now = Date.now();
    const starts = { today: new Date().setHours(0, 0, 0, 0), window: now - 86400000, week: now - 7 * 86400000, "14d": now - 14 * 86400000, "30d": now - 30 * 86400000, all: 0 };
    return { start: starts[range] || 0, end: now };
  }
  function requestSessionsPage(reset = false) {
    if (reset) sessionPage = 1;
    vscode.postMessage({ type: "sessionsPage", page: sessionPage, pageSize: sessionPageSize, search: element("#sessionSearch")?.value || "", source: filterPayload(sourceFilter), model: filterPayload(modelFilter), project: filterPayload(projectFilter), status: "active", range: selectedRangePayload() });
  }
  function requestRequestsPage(reset = false) {
    if (reset) requestPage = 1;
    vscode.postMessage({ type: "requestsPage", page: requestPage, pageSize: requestPageSize, source: filterPayload(sourceFilter), model: filterPayload(modelFilter), project: filterPayload(projectFilter), range: selectedRangePayload() });
  }
  function sourceItem(items, id, source) {
    return (items || []).find((item) => item.id === id && (!source || item.source === source));
  }
  function selectRange(next) {
    range = next;
    customDraftDirty = false;
    syncRangeChrome();
    vscode.setState(rangeState());
    syncScopeChrome();
    if (range !== "custom") requestRange();
  }
  function sessionKey(item) { return `${item?.source || ""}:${item?.id || ""}`; }
  function updateSessionSelectionChrome() {
    const selectedKeys = new Set(selectedSessions.keys());
    const pageItems = sessionPageData.items || [];
    const selectedOnPage = pageItems.filter((item) => selectedKeys.has(sessionKey(item))).length;
    const selectPage = element("#sessionSelectPage");
    if (selectPage) {
      selectPage.checked = pageItems.length > 0 && selectedOnPage === pageItems.length;
      selectPage.indeterminate = selectedOnPage > 0 && selectedOnPage < pageItems.length;
    }
    element("#sessionSelectedCount").textContent = `已选 ${selectedSessions.size}`;
    element("#sessionClearSelection").disabled = selectedSessions.size === 0;
    all("[data-session-bulk-export]").forEach((button) => { button.disabled = selectedSessions.size === 0; });
    vscode.setState(rangeState());
  }
  function renderSessionPage() {
    window.CodeArtsViews.sessionRows(sessionPageData.items || [], sessionPageData, new Set(selectedSessions.keys()));
    updateSessionSelectionChrome();
  }
  function jumpPage(kind) {
    const session = kind === "session";
    const input = element(session ? "#sessionPageJump" : "#requestPageJump");
    const pageCount = Math.max(1, Number((session ? sessionPageData : requestPageData).pageCount || 1));
    const next = Math.max(1, Math.min(pageCount, Math.trunc(Number(input?.value || 1)) || 1));
    if (session) { sessionPage = next; requestSessionsPage(); }
    else { requestPage = next; requestRequestsPage(); }
  }
  function render() {
    if (!snapshot?.ok) return;
    syncRangeChrome();
    const scopeChanged = syncScopeChrome();
    element("#updated").textContent =
      `${snapshot.stale ? "\u7f13\u5b58\u6570\u636e \u00b7 " : ""}${snapshot.updatedAt || "\u521a\u521a\u66f4\u65b0"}${snapshot.adapter ? ` \u00b7 ${snapshot.adapter}` : ""}`;
    const views = window.CodeArtsViews;
    views.metrics(snapshot, snapshot.selectedRange?.preset || range, dataRangeText());
    views.models(snapshot);
    views.providers(snapshot);
    views.sources(snapshot);
    if (!databasePagesLoaded) {
      views.sessions(snapshot);
      views.requests(snapshot);
    }
    views.performance(snapshot);
    window.CodeArtsChart.draw(
      element("#trendChart"),
      trendRows() || [],
      element("#chartEmpty"),
    );
    return scopeChanged;
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
    return render();
  }
  document.addEventListener("click", (event) => {
    const menuToggle = event.target.closest("[data-menu-toggle]");
    if (menuToggle) {
      const name = menuToggle.dataset.menuToggle;
      setMenuOpen(name, openMenu !== name);
      return;
    }
    const menuOption = event.target.closest("[data-menu-option]");
    if (menuOption) {
      const kind = menuOption.dataset.menuOption;
      const value = menuOption.dataset.value;
      if (kind === "range") { setMenuOpen(kind, false); selectRange(value); }
      if (["source", "model", "project"].includes(kind)) {
        const current = kind === "source" ? sourceFilter : kind === "model" ? modelFilter : projectFilter;
        const next = value === "all" ? [] : current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
        if (kind === "source") sourceFilter = next;
        if (kind === "model") modelFilter = next;
        if (kind === "project") projectFilter = next;
        syncScopeChrome();
        requestScope();
      }
      if (kind === "sessionSize") { sessionPageSize = Number(value); sessionPage = 1; setMenuOpen(kind, false); element("#sessionPageSizeValue").textContent = value; vscode.setState(rangeState()); requestSessionsPage(); }
      if (kind === "requestSize") { requestPageSize = Number(value); requestPage = 1; setMenuOpen(kind, false); element("#requestPageSizeValue").textContent = value; vscode.setState(rangeState()); requestRequestsPage(); }
      return;
    }
    const rangeButton = event.target.closest("[data-range]");
    if (rangeButton) {
      selectRange(rangeButton.dataset.range);
      return;
    }
    if (event.target.closest("[data-range-cancel]")) {
      customDraftDirty = false;
      range = snapshot?.selectedRange?.preset || saved.range || "today";
      if (range === "custom") {
        customStart = Number(snapshot?.selectedRange?.start || customStart);
        customEnd = Number(snapshot?.selectedRange?.end || customEnd);
      }
      element("#rangeError").hidden = true;
      syncRangeChrome();
      vscode.setState(rangeState());
      return;
    }
    const dateFocus = event.target.closest("[data-date-focus]");
    if (dateFocus) {
      const target = element(`#${dateFocus.dataset.dateFocus}`);
      target?.focus();
      target?.select?.();
      return;
    }
    if (event.target.closest("[data-range-apply]")) {
      const start = parseLocalInputValue(element("#rangeStart").value);
      const end = parseLocalInputValue(element("#rangeEnd").value);
      const error = !Number.isFinite(start) || !Number.isFinite(end) ? "请选择开始和结束时间" : end <= start ? "结束时间需晚于开始时间" : end > Date.now() + 60000 ? "结束时间不能晚于当前时间" : end - start > 366 * 86400000 ? "时间范围最多支持 366 天" : "";
      element("#rangeError").textContent = error; element("#rangeError").hidden = !error;
      if (!error) { customStart = start; customEnd = end; customDraftDirty = false; vscode.setState(rangeState()); syncRangeChrome(); requestRange(); }
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action) vscode.postMessage({ type: action });
    if (event.target.closest("#sessionSearchButton")) requestSessionsPage(true);
    if (event.target.closest("#sessionClearSelection")) { selectedSessions.clear(); renderSessionPage(); }
    const bulkExportButton = event.target.closest("[data-session-bulk-export]");
    if (bulkExportButton && selectedSessions.size) {
      element("#sessionExportState").textContent = `正在导出 ${selectedSessions.size} 个会话...`;
      vscode.postMessage({ type: "exportSessions", sessions: [...selectedSessions.values()], format: bulkExportButton.dataset.sessionBulkExport });
    }
    if (event.target.closest("#sessionPrevious") && sessionPage > 1) { sessionPage -= 1; requestSessionsPage(); }
    if (event.target.closest("#sessionNext") && sessionPage < Number(sessionPageData.pageCount || 1)) { sessionPage += 1; requestSessionsPage(); }
    if (event.target.closest("#sessionJump")) jumpPage("session");
    if (event.target.closest("#requestPrevious") && requestPage > 1) { requestPage -= 1; requestRequestsPage(); }
    if (event.target.closest("#requestNext") && requestPage < Number(requestPageData.pageCount || 1)) { requestPage += 1; requestRequestsPage(); }
    if (event.target.closest("#requestJump")) jumpPage("request");
    const requestRow = event.target.closest("[data-request-id]");
    if (requestRow) {
      selectedRequestId = requestRow.dataset.requestId || "";
      selectedRequestSource = requestRow.dataset.requestSource || "";
      vscode.setState(rangeState());
      window.CodeArtsViews.requestDetail(sourceItem(requestPageData.items, selectedRequestId, selectedRequestSource) || sourceItem(snapshot?.requests, selectedRequestId, selectedRequestSource));
    }
    if (event.target.closest("[data-request-detail-close]")) { selectedRequestId = ""; selectedRequestSource = ""; vscode.setState(rangeState()); window.CodeArtsViews.requestDetail(null); }
    if (openMenu && !event.target.closest(".menu-control")) setMenuOpen(openMenu, false);
  });
  document.addEventListener("input", (event) => {
    if (event.target === element("#rangeStart") || event.target === element("#rangeEnd"))
      customDraftDirty = true;
    const selection = event.target.closest("[data-session-select]");
    if (selection) {
      const row = selection.closest("[data-session-id]");
      const item = sourceItem(sessionPageData.items, row?.dataset.sessionId, row?.dataset.sessionSource);
      if (item) {
        const key = sessionKey(item);
        if (selection.checked) selectedSessions.set(key, item); else selectedSessions.delete(key);
        updateSessionSelectionChrome();
      }
    }
    if (event.target === element("#sessionSelectPage")) {
      for (const item of sessionPageData.items || []) {
        if (event.target.checked) selectedSessions.set(sessionKey(item), item); else selectedSessions.delete(sessionKey(item));
      }
      renderSessionPage();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.target === element("#sessionSearch") && event.key === "Enter") { event.preventDefault(); requestSessionsPage(true); return; }
    if (event.target === element("#sessionPageJump") && event.key === "Enter") { event.preventDefault(); jumpPage("session"); return; }
    if (event.target === element("#requestPageJump") && event.key === "Enter") { event.preventDefault(); jumpPage("request"); return; }
    const requestRow = event.target.closest("[data-request-id]");
    if (requestRow && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); selectedRequestId = requestRow.dataset.requestId || ""; selectedRequestSource = requestRow.dataset.requestSource || ""; vscode.setState(rangeState()); window.CodeArtsViews.requestDetail(sourceItem(requestPageData.items, selectedRequestId, selectedRequestSource) || sourceItem(snapshot?.requests, selectedRequestId, selectedRequestSource)); return; }
    const toggle = event.target.closest("[data-menu-toggle]");
    if (toggle && event.key === "ArrowDown") {
      event.preventDefault();
      const name = toggle.dataset.menuToggle;
      setMenuOpen(name, true);
      element(`#${name}Menu`).querySelector(".selected, button")?.focus();
      return;
    }
    const option = event.target.closest("[data-menu-option]");
    if (option && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const options = [...option.parentElement.querySelectorAll("button")];
      const index = options.indexOf(option);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[next]?.focus();
      return;
    }
    if (event.key === "Escape" && openMenu) {
      const trigger = openMenu === "range" ? element("#rangeMenuButton") : openMenu === "sessionSize" ? element("#sessionPageSizeButton") : openMenu === "requestSize" ? element("#requestPageSizeButton") : element(`#${openMenu}Filter`);
      setMenuOpen(openMenu, false);
      trigger.focus();
    }
  });
  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "reset") {
      const generation = Number(message.generation || 0);
      if (!Number.isInteger(generation) || generation <= 0 || generation < latestGeneration) return;
      latestGeneration = generation;
      snapshot = null;
      databasePagesLoaded = false;
      sessionPageData = { items: [], total: 0, page: 1, pageCount: 1 };
      requestPageData = { items: [], total: 0, page: 1, pageCount: 1 };
      sessionPage = 1;
      requestPage = 1;
      selectedRequestId = "";
      selectedRequestSource = "";
      selectedSessions.clear();
      document.body.classList.add("refreshing");
      element("#loading").hidden = false;
      element("#dashboard").hidden = true;
      element("#error").hidden = true;
      window.CodeArtsViews.requestDetail(null);
      vscode.setState(rangeState());
      return;
    }
    if (message.type === "snapshot" || message.type === "details") {
      const generation = Number(message.generation || 0);
      if (!Number.isInteger(generation) || generation <= 0 || generation < latestGeneration) return;
      latestGeneration = Math.max(latestGeneration, generation);
      if (message.payload?.selectedRange?.preset && !customDraftDirty) {
        range = message.payload.selectedRange.preset;
        customStart = Number(message.payload.selectedRange.start || customStart);
        customEnd = Number(message.payload.selectedRange.end || customEnd);
        vscode.setState(rangeState());
      }
      if (message.payload?.selectedScope) {
        sourceFilter = normalizeSelection(message.payload.selectedScope.source);
        modelFilter = normalizeSelection(message.payload.selectedScope.model);
        projectFilter = normalizeSelection(message.payload.selectedScope.project);
      }
      const scopeChanged = receive(message.payload);
      if (scopeChanged) requestScope();
      else { requestSessionsPage(); requestRequestsPage(); }
    }
    if (message.type === "refreshing") {
      const generation = Number(message.generation || 0);
      if (generation < latestGeneration) return;
      latestGeneration = Math.max(latestGeneration, generation);
      document.body.classList.toggle("refreshing", Boolean(message.value));
    }
    if (message.type === "detailsError") {
      const generation = Number(message.generation || 0);
      if (generation < latestGeneration) return;
      latestGeneration = Math.max(latestGeneration, generation);
      document.body.classList.remove("refreshing");
      if (!snapshot?.ok) {
        element("#loading").hidden = true;
        element("#dashboard").hidden = true;
        element("#error").hidden = false;
        element("#errorText").textContent = message.payload?.error || "使用分析加载失败，请重试";
      }
    }
    if (message.type === "sessionsPage") {
      if (message.payload?.ok) {
        databasePagesLoaded = true;
        sessionPageData = message.payload.data || {};
        sessionPage = Number(sessionPageData.page || 1);
        vscode.setState(rangeState());
        renderSessionPage();
      } else {
        element("#sessions").innerHTML = `<p class="empty-copy">${window.CodeArtsFormat.html(message.payload?.error || "会话加载失败")}</p>`;
      }
    }
    if (message.type === "requestsPage") {
      if (message.payload?.ok) {
        databasePagesLoaded = true;
        requestPageData = message.payload.data || {};
        requestPage = Number(requestPageData.page || 1);
        vscode.setState(rangeState());
        window.CodeArtsViews.requestRows(requestPageData.items || [], requestPageData);
        if (selectedRequestId) window.CodeArtsViews.requestDetail(sourceItem(requestPageData.items, selectedRequestId, selectedRequestSource) || null);
      } else {
        element("#requests").innerHTML = `<tr><td colspan="11" class="empty-copy">${window.CodeArtsFormat.html(message.payload?.error || "请求加载失败")}</td></tr>`;
      }
    }
    if (message.type === "sessionExported") {
      element("#sessionExportState").textContent = message.payload?.canceled ? "" : message.payload?.ok ? `${message.payload.sessions || 1} 个会话已导出` : message.payload?.error || "会话导出失败";
    }
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
  if (element("#sessionSearch")) element("#sessionSearch").value = saved.sessionSearch || "";
  element("#sessionPageSizeValue").textContent = String(sessionPageSize);
  element("#requestPageSizeValue").textContent = String(requestPageSize);
  vscode.postMessage({ type: "ready", state: rangeState() });
  requestSessionsPage();
  requestRequestsPage();
  requestAnimationFrame(() => { if (saved.scrollTop && document.scrollingElement) document.scrollingElement.scrollTop = Number(saved.scrollTop); });
})();
