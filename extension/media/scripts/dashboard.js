(() => {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  let snapshot = null;
  let range = saved.range || "today";
  let customStart = Number(saved.customStart || 0);
  let customEnd = Number(saved.customEnd || 0);
  let sourceFilter = saved.sourceFilter || "all";
  let modelFilter = saved.modelFilter || "all";
  const knownSources = new Map();
  const knownModels = new Set();
  let openMenu = "";
  let latestGeneration = 0;
  let customDraftDirty = false;
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
  function rangeState() { return { range, customStart, customEnd, sourceFilter, modelFilter }; }
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
    for (const menuName of ["range", "source", "model"]) {
      const expanded = menuName === name && next;
      element(`#${menuName}Menu`).hidden = !expanded;
      element(menuName === "range" ? "#rangeMenuButton" : `#${menuName}Filter`).setAttribute("aria-expanded", String(expanded));
    }
    openMenu = next ? name : "";
  }
  function requestRange() {
    document.body.classList.add("refreshing");
    vscode.postMessage({ type: "range", preset: range, range: range === "custom" ? { start: customStart, end: customEnd } : undefined });
  }
  function menuOptionHtml(kind, value, label, selected) { return `<button data-menu-option="${kind}" data-value="${window.CodeArtsFormat.html(value)}" role="option" aria-selected="${selected}" class="${selected ? "selected" : ""}">${window.CodeArtsFormat.html(label)}</button>`; }
  function syncScopeChrome() {
    for (const item of snapshot?.sources || []) knownSources.set(item.id, item.label);
    for (const item of snapshot?.models || []) knownModels.add(item.name);
    const sources = [...knownSources].map(([id, label]) => ({ id, label }));
    const models = [...knownModels].map((name) => ({ name }));
    const sourceLabel = sourceFilter === "all" ? "全部来源" : sources.find((item) => item.id === sourceFilter)?.label || sourceFilter;
    const modelLabel = modelFilter === "all" ? "全部模型" : modelFilter;
    element("#sourceMenu").innerHTML = menuOptionHtml("source", "all", "全部来源", sourceFilter === "all") + sources.map((item) => menuOptionHtml("source", item.id, item.label, sourceFilter === item.id)).join("");
    element("#modelMenu").innerHTML = menuOptionHtml("model", "all", "全部模型", modelFilter === "all") + models.map((item) => menuOptionHtml("model", item.name, item.name, modelFilter === item.name)).join("");
    element("#sourceFilterValue").textContent = sourceLabel;
    element("#modelFilterValue").textContent = modelLabel;
    element("#filterContext").textContent = `${dataRangeText()} · ${sourceLabel} · ${modelLabel}`;
  }
  function requestScope() {
    document.body.classList.add("refreshing");
    vscode.setState(rangeState());
    vscode.postMessage({ type: "filter", source: sourceFilter, model: modelFilter });
  }
  function selectRange(next) {
    range = next;
    customDraftDirty = false;
    syncRangeChrome();
    vscode.setState(rangeState());
    syncScopeChrome();
    if (range !== "custom") requestRange();
  }
  function render() {
    if (!snapshot?.ok) return;
    syncRangeChrome();
    syncScopeChrome();
    element("#updated").textContent =
      `${snapshot.stale ? "\u7f13\u5b58\u6570\u636e \u00b7 " : ""}${snapshot.updatedAt || "\u521a\u521a\u66f4\u65b0"}${snapshot.adapter ? ` \u00b7 ${snapshot.adapter}` : ""}`;
    const views = window.CodeArtsViews;
    views.metrics(snapshot, snapshot.selectedRange?.preset || range, dataRangeText());
    views.models(snapshot);
    views.sources(snapshot);
    views.sessions(snapshot);
    views.requests(snapshot);
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
      setMenuOpen(kind, false);
      if (kind === "range") selectRange(value);
      if (kind === "source") { sourceFilter = value; syncScopeChrome(); requestScope(); }
      if (kind === "model") { modelFilter = value; syncScopeChrome(); requestScope(); }
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
    if (openMenu && !event.target.closest(".menu-control")) setMenuOpen(openMenu, false);
  });
  document.addEventListener("input", (event) => {
    if (event.target === element("#rangeStart") || event.target === element("#rangeEnd"))
      customDraftDirty = true;
  });
  document.addEventListener("keydown", (event) => {
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
      const trigger = openMenu === "range" ? element("#rangeMenuButton") : element(`#${openMenu}Filter`);
      setMenuOpen(openMenu, false);
      trigger.focus();
    }
  });
  window.addEventListener("message", (event) => {
    const message = event.data || {};
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
        sourceFilter = message.payload.selectedScope.source || "all";
        modelFilter = message.payload.selectedScope.model || "all";
      }
      receive(message.payload);
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
  vscode.postMessage({ type: "ready", state: rangeState() });
})();
