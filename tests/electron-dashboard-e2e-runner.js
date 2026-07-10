"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const root = path.join(__dirname, "..");
const now = Date.UTC(2026, 6, 9, 12, 0, 0);
const H = 3600000;
const ipcCalls = [];
const resizeLogs = [];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

function req(id, sessionId, source, model, ago, input, output, cacheRead, cacheWrite) {
  const time = now - ago * H;
  return {
    id,
    sessionId,
    sessionTitle: `${source === "cli" ? "CLI" : "桌面端"} 会话 ${sessionId}`,
    source,
    sourceLabel: source === "cli" ? "CLI" : "桌面端",
    provider: "codearts",
    model,
    time,
    createdAt: time,
    updatedAt: time + 1200,
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
    ok: true,
    status: "200",
    latencyMs: 900 + ago * 30,
    ttftMs: 180 + ago * 8,
    firstContentMs: 260 + ago * 8,
    outputTokensPerSec: 18 + (ago % 12),
  };
}

const requestLog = Array.from({ length: 72 }, (_, i) => {
  const source = i % 2 === 0 ? "desktop" : "cli";
  return req(
    `r-${i}`,
    `s-${i}`,
    source,
    i % 3 === 0 ? "GLM-5.1" : i % 3 === 1 ? "gpt-5.5" : "deepseek-v4-flash",
    i % 30,
    600 + i * 7,
    240 + i * 5,
    source === "desktop" ? 1400 + i * 11 : 120 + i,
    40 + (i % 7) * 9
  );
});
let requestPageTotalOverride = null;
let sessionPageTotalOverride = null;

function usageForRows(rows) {
  const out = rows.reduce((acc, row) => {
    acc.total += row.total || 0;
    acc.input += row.input || 0;
    acc.output += row.output || 0;
    acc.cacheRead += row.cacheRead || 0;
    acc.cacheWrite += row.cacheWrite || 0;
    acc.messages += 1;
    acc.requests += 1;
    return acc;
  }, { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, requests: 0, errors: 0 });
  const denom = out.input + out.cacheRead;
  out.cacheHitRate = denom ? out.cacheRead / denom : 0;
  out.cacheHitPercent = Math.round(out.cacheHitRate * 100);
  return out;
}

function sessionsForRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.source}:${row.sessionId}`;
    const prev = map.get(key) || {
      id: row.sessionId,
      title: row.sessionTitle,
      directory: `C:/e2e/${row.source}/${row.sessionId}`,
      version: "1",
      createdAt: row.time - H,
      updatedAt: row.time,
      archived: false,
      archivedAt: null,
      source: row.source,
      sourceLabel: row.sourceLabel,
      dbPath: "e2e",
      usage: { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, userTurns: 0, modelCalls: 0, errors: 0, models: [] },
    };
    prev.updatedAt = Math.max(prev.updatedAt, row.time);
    prev.usage.total += row.total;
    prev.usage.input += row.input;
    prev.usage.output += row.output;
    prev.usage.cacheRead += row.cacheRead;
    prev.usage.cacheWrite += row.cacheWrite;
    prev.usage.modelCalls += 1;
    prev.usage.userTurns += 1;
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function filterRows(payload = {}) {
  const source = payload.source || "all";
  const range = payload.range || {};
  const start = Number(range.start || 0);
  const end = Number(range.end || 0);
  const model = payload.model || "all";
  const query = String(payload.query || "").toLowerCase();
  return requestLog.filter((row) => {
    if (source !== "all" && row.source !== source) return false;
    if (model !== "all" && row.model !== model) return false;
    if (start && row.time < start) return false;
    if (end && row.time > end) return false;
    if (query && !`${row.sessionId} ${row.sessionTitle} ${row.model}`.toLowerCase().includes(query)) return false;
    return true;
  }).sort((a, b) => b.time - a.time);
}

function snapshotFor(payload = {}) {
  const rows = filterRows(payload);
  const usage = usageForRows(rows);
  const sessions = sessionsForRows(requestLog);
  return {
    ok: true,
    timestamp: now,
    updatedAt: "2026/07/09 20:00",
    dbPath: "e2e",
    sources: [{ id: "desktop", source: "desktop", label: "桌面端" }, { id: "cli", source: "cli", label: "CLI" }],
    usage: { today: usage, window: usage, week: usage, all: usage },
    queue: { window: { samples: 8, avg: 1200, max: 4200 }, trends: { hourly24h: [] } },
    requestLog: rows,
    sessions,
    status: { usagePercent: 35, level: "ok", label: "35%" },
  };
}

function aggregatesFor(payload = {}) {
  const rows = filterRows(payload);
  const usage = usageForRows(rows);
  const bySource = new Map();
  const byModel = new Map();
  const buckets = new Map();
  const bucketMs = Number(payload.bucketMs || H) || H;
  for (const row of rows) {
    const source = bySource.get(row.source) || { key: row.source, source: row.source, label: row.sourceLabel, requests: 0, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0 };
    Object.assign(source, usageForRows(filterRows({ ...payload, source: row.source })));
    bySource.set(row.source, source);
    const modelKey = `${row.provider} / ${row.model}`;
    const model = byModel.get(modelKey) || { name: modelKey, provider: row.provider, model: row.model, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0, sources: [] };
    model.total += row.total; model.input += row.input; model.output += row.output; model.cacheRead += row.cacheRead; model.cacheWrite += row.cacheWrite; model.messages += 1; model.sources.push(row.source);
    byModel.set(modelKey, model);
    const start = Math.floor(row.time / bucketMs) * bucketMs;
    const b = buckets.get(start) || { start, end: start + bucketMs, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0 };
    b.total += row.total; b.input += row.input; b.output += row.output; b.cacheRead += row.cacheRead; b.cacheWrite += row.cacheWrite; b.messages += 1;
    buckets.set(start, b);
  }
  const sessions = sessionsForRows(requestLog);
  return {
    ok: true,
    timestamp: now,
    usage: { today: usage, window: usage, week: usage, all: usage },
    sources: snapshotFor(payload).sources,
    buckets: [...buckets.values()].sort((a, b) => a.start - b.start),
    sourceStats: [...bySource.values()].sort((a, b) => b.total - a.total),
    modelStats: [...byModel.values()].sort((a, b) => b.total - a.total),
    sessionSummary: { ok: true, timestamp: now, total: sessions.length, active: sessions.length, archived: 0, recent7d: sessions.length, bySource: [], projects: [] },
  };
}

function page(items, payload, fallbackLimit) {
  const limit = Math.max(1, Number(payload.limit || fallbackLimit));
  const offset = Math.max(0, Number(payload.offset || 0));
  return { ok: true, limit, offset, total: items.length, hasMore: offset + limit < items.length, items: items.slice(offset, offset + limit) };
}

function registerIpc() {
  ipcMain.handle("dashboard:getRuntimeInfo", () => ({ preferred: "node:sqlite", native: { available: true, adapter: "node:sqlite" } }));
  ipcMain.handle("dashboard:getInitialSummary", (_event, payload) => { ipcCalls.push({ channel: "dashboard:getInitialSummary", payload }); return snapshotFor(payload); });
  ipcMain.handle("dashboard:getSnapshot", (_event, payload) => { ipcCalls.push({ channel: "dashboard:getSnapshot", payload }); return snapshotFor(payload); });
  ipcMain.handle("dashboard:refreshLight", (_event, payload) => { ipcCalls.push({ channel: "dashboard:refreshLight", payload }); return snapshotFor(payload); });
  ipcMain.handle("dashboard:refreshFull", (_event, payload) => { ipcCalls.push({ channel: "dashboard:refreshFull", payload }); return snapshotFor(payload); });
  ipcMain.handle("dashboard:getAggregates", (_event, payload) => { ipcCalls.push({ channel: "dashboard:getAggregates", payload }); return aggregatesFor(payload); });
  ipcMain.handle("dashboard:getRequestsPage", (_event, payload) => {
    ipcCalls.push({ channel: "dashboard:getRequestsPage", payload });
    const rows = filterRows(payload);
    return page(Number.isFinite(requestPageTotalOverride) ? rows.slice(0, requestPageTotalOverride) : rows, payload, 20);
  });
  ipcMain.handle("dashboard:getSessionsPage", (_event, payload) => {
    ipcCalls.push({ channel: "dashboard:getSessionsPage", payload });
    const source = payload?.source || "all";
    const query = String(payload?.query || "").toLowerCase();
    const rows = sessionsForRows(requestLog).filter((s) => (source === "all" || s.source === source) && (!query || `${s.id} ${s.title} ${s.directory}`.toLowerCase().includes(query)));
    return page(Number.isFinite(sessionPageTotalOverride) ? rows.slice(0, sessionPageTotalOverride) : rows, payload, 20);
  });
  ipcMain.handle("dashboard:getSessionRequestsPage", (_event, payload) => {
    ipcCalls.push({ channel: "dashboard:getSessionRequestsPage", payload });
    return page(filterRows(payload).filter((row) => row.sessionId === payload.sessionId), payload, 20);
  });
  ipcMain.handle("dashboard:getDiagnostics", () => {
    ipcCalls.push({ channel: "dashboard:getDiagnostics" });
    return {
      ok: true,
      version: "e2e",
      performance: {
        aggregateCache: { hits: 3, misses: 1, reads: 4, hitRate: 0.75, size: 2, limit: 64, ttlMs: 120000 },
        usageRollup: { compactHits: 2, tokenHits: 1, misses: 1, invalid: 0, pendingCount: 0, hitRate: 0.75, buildCompleted: 1, buildFailed: 0 },
      },
    };
  });
  ipcMain.handle("dashboard:e2eSetPageTotalOverride", (_event, payload = {}) => {
    requestPageTotalOverride = Number.isFinite(Number(payload.requests)) ? Number(payload.requests) : null;
    sessionPageTotalOverride = Number.isFinite(Number(payload.sessions)) ? Number(payload.sessions) : null;
    ipcCalls.push({ channel: "dashboard:e2eSetPageTotalOverride", payload });
    return { ok: true, requestPageTotalOverride, sessionPageTotalOverride };
  });
  ipcMain.handle("dashboard:log", (_event, payload) => { ipcCalls.push({ channel: "dashboard:log", payload }); if (payload?.scope === "renderer-resize-perf") resizeLogs.push(payload); return { ok: true }; });
  ipcMain.handle("dashboard:rendererError", (_event, payload) => { ipcCalls.push({ channel: "dashboard:rendererError", payload }); return { ok: true }; });
  for (const channel of ["dashboard:settings", "dashboard:openLogs", "dashboard:copySession", "dashboard:openSession", "dashboard:openCodeArtsSession", "dashboard:archiveSession", "dashboard:renameSession", "dashboard:setPinned", "dashboard:setLayoutMode"]) {
    ipcMain.handle(channel, (_event, payload) => { ipcCalls.push({ channel, payload }); return { ok: true }; });
  }
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function evalIn(win, fn, ...args) {
  const js = `(${fn.toString()})(...${JSON.stringify(args)})`;
  return win.webContents.executeJavaScript(js, true);
}

async function waitFor(win, fn, timeoutMs = 6000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await evalIn(win, fn);
      if (value) return value;
      last = value;
    } catch (error) {
      last = error.message;
    }
    await delay(80);
  }
  throw new Error(`waitFor timed out: ${fn.toString()} last=${last}`);
}

async function click(win, selector) {
  return evalIn(win, (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing selector ${sel}`);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  }, selector);
}

async function changeValue(win, selector, value) {
  return evalIn(win, (sel, next) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing selector ${sel}`);
    el.value = String(next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, selector, value);
}

async function setPageTotalOverride(win, payload) {
  return evalIn(win, (next) => window.codeartsApi.invoke("dashboard:e2eSetPageTotalOverride", next), payload);
}

function paginationGeometry(kind){
  const prefix = kind === 'sessions' ? 'session' : 'request';
  const note = document.querySelector(`[data-table-limit="${kind}"]`);
  const sizeField = note?.querySelector('.table-page-size');
  const sizeSelect = note?.querySelector(`[data-${prefix}-page-size]`);
  const jumpField = note?.querySelector('.table-page-jump');
  const jumpInput = note?.querySelector(`[data-${prefix}-page-input]`);
  const sizeUnits = sizeField ? [...sizeField.querySelectorAll('span')].map((node) => node.getBoundingClientRect()) : [];
  const jumpUnits = jumpField ? [...jumpField.querySelectorAll('span')].map((node) => node.getBoundingClientRect()) : [];
  const selectRect = sizeSelect?.getBoundingClientRect();
  const inputRect = jumpInput?.getBoundingClientRect();
  return {
    present: Boolean(note && sizeField && sizeSelect && jumpField && jumpInput),
    controlsSameHeight: Boolean(sizeField && jumpField && Math.round(sizeField.getBoundingClientRect().height) === Math.round(jumpField.getBoundingClientRect().height)),
    sizeSeparated: Boolean(selectRect && sizeUnits.length === 2 && sizeUnits[0].right <= selectRect.left && selectRect.right <= sizeUnits[1].left),
    jumpSeparated: Boolean(inputRect && jumpUnits.length === 2 && jumpUnits[0].right <= inputRect.left && inputRect.right <= jumpUnits[1].left),
  };
}

async function main() {
  registerIpc();
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 680,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: "#f7f8fb",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, "electron-dashboard-preload.js"),
      partition: `e2e-${Date.now()}`,
    },
  });
  win.setMenuBarVisibility(false);
  await win.loadFile(path.join(root, "src", "dashboard.html"));
  await waitFor(win, () => Boolean(document.querySelector(".usage-total-board") && document.querySelector("#usageChart") && document.querySelector(".table-card")));

  const initial = await evalIn(win, () => {
    window.__e2eCanvas = document.querySelector("#usageChart");
    return {
      title: document.querySelector(".page-title")?.textContent || "",
      hasTable: Boolean(document.querySelector(".table-card")),
      hasBackControl: Boolean(document.querySelector(".back, [data-back]")),
      nodeRequireType: typeof window.require,
      preloadApi: Boolean(window.codeartsApi && typeof window.codeartsApi.invoke === "function"),
      canvasSize: document.querySelector("#usageChart")?.dataset?.sizeKey || "",
    };
  });
  assert.match(initial.title, /Bar/);
  assert.equal(initial.hasTable, true);
  assert.equal(initial.hasBackControl, false, "dashboard should not show a non-functional back control");
  assert.equal(initial.nodeRequireType, "undefined", "dashboard renderer should not expose Node require");
  assert.equal(initial.preloadApi, true, "dashboard should use the isolated preload API");
  const requestPaginationGeometry = await evalIn(win, (kind) => {
    const prefix = kind === 'sessions' ? 'session' : 'request';
    const note = document.querySelector(`[data-table-limit="${kind}"]`);
    const sizeField = note?.querySelector('.table-page-size');
    const sizeSelect = note?.querySelector(`[data-${prefix}-page-size]`);
    const jumpField = note?.querySelector('.table-page-jump');
    const jumpInput = note?.querySelector(`[data-${prefix}-page-input]`);
    const sizeUnits = sizeField ? [...sizeField.querySelectorAll('span')].map((node) => node.getBoundingClientRect()) : [];
    const jumpUnits = jumpField ? [...jumpField.querySelectorAll('span')].map((node) => node.getBoundingClientRect()) : [];
    const selectRect = sizeSelect?.getBoundingClientRect();
    const inputRect = jumpInput?.getBoundingClientRect();
    return {
      present: Boolean(note && sizeField && sizeSelect && jumpField && jumpInput),
      controlsSameHeight: Boolean(sizeField && jumpField && Math.round(sizeField.getBoundingClientRect().height) === Math.round(jumpField.getBoundingClientRect().height)),
      sizeSeparated: Boolean(selectRect && sizeUnits.length === 2 && sizeUnits[0].right <= selectRect.left && selectRect.right <= sizeUnits[1].left),
      jumpSeparated: Boolean(inputRect && jumpUnits.length === 2 && jumpUnits[0].right <= inputRect.left && inputRect.right <= jumpUnits[1].left),
    };
  }, 'requests');
  assert.deepEqual(requestPaginationGeometry, { present: true, controlsSameHeight: true, sizeSeparated: true, jumpSeparated: true }, `request pagination controls should not overlap their labels: ${JSON.stringify(requestPaginationGeometry)}`);
  const collapsedAdvancedGeometry = await evalIn(win, () => {
    const content = document.querySelector('.content');
    const shell = document.querySelector('.analytics-advanced-shell.collapsed');
    if(content && shell) content.scrollTop = Math.max(0, shell.offsetTop - content.clientHeight + shell.offsetHeight + 18);
    const rect = shell?.getBoundingClientRect();
    const style = shell ? getComputedStyle(shell) : null;
    return {
      present: Boolean(shell),
      height: Math.round(rect?.height || 0),
      contentVisibility: style?.contentVisibility || '',
      intrinsicSize: style?.containIntrinsicSize || '',
      withinViewport: Boolean(rect && rect.top < window.innerHeight && rect.bottom > 0),
    };
  });
  assert.equal(collapsedAdvancedGeometry.present, true, 'collapsed advanced analytics should render in the normal window');
  assert.ok(collapsedAdvancedGeometry.height >= 60 && collapsedAdvancedGeometry.height <= 100, `collapsed advanced analytics should use its real compact height: ${JSON.stringify(collapsedAdvancedGeometry)}`);
  assert.equal(collapsedAdvancedGeometry.contentVisibility, 'visible', `collapsed advanced analytics should not defer its header: ${JSON.stringify(collapsedAdvancedGeometry)}`);
  assert.equal(collapsedAdvancedGeometry.withinViewport, true, `collapsed advanced analytics header should be scrollable into the normal viewport: ${JSON.stringify(collapsedAdvancedGeometry)}`);
  await evalIn(win, () => { const content = document.querySelector('.content'); if(content) content.scrollTop = 0; });

  await click(win, '[data-date-range-toggle]');
  const normalWindowDatePopover = await waitFor(win, () => {
    const popover = document.querySelector('.date-range-popover');
    const filters = document.querySelector('.analytics-page-head .filters');
    if(!popover || !filters) return null;
    const rect = popover.getBoundingClientRect();
    const probeX = Math.max(1, Math.min(window.innerWidth - 2, Math.round(rect.left + rect.width / 2)));
    const probeY = Math.max(1, Math.min(window.innerHeight - 2, Math.round(rect.top + 30)));
    return {
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      overflow: getComputedStyle(filters).overflow,
      hit: Boolean(document.elementFromPoint(probeX, probeY)?.closest('.date-range-popover')),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  assert.equal(normalWindowDatePopover.overflow, 'visible', `normal-window date popover must escape the filter row: ${JSON.stringify(normalWindowDatePopover)}`);
  assert.equal(normalWindowDatePopover.hit, true, `normal-window date popover should be visible and interactive: ${JSON.stringify(normalWindowDatePopover)}`);
  assert.ok(normalWindowDatePopover.rect.width > 500 && normalWindowDatePopover.rect.height > 300, `normal-window date popover should render at usable size: ${JSON.stringify(normalWindowDatePopover)}`);
  await click(win, '[data-date-range-toggle]');
  await waitFor(win, () => !document.querySelector('.date-range-popover'));

  win.setSize(1040, 720, false);
  await delay(120);
  win.maximize();
  await delay(700);
  const resizeState = await evalIn(win, () => ({
    isMaxViewport: window.innerWidth >= 1040 && window.innerHeight >= 700,
    perf: window.__dashboardResizePerf || [],
    bodyResizing: document.body.classList.contains("is-resizing"),
    appHtml: document.getElementById("app")?.innerHTML?.length || 0,
  }));
  assert.equal(resizeState.isMaxViewport, true);
  const maximizedLayout = await evalIn(win, () => {
    const content = document.querySelector('.content')?.getBoundingClientRect();
    const header = document.querySelector('.app-header')?.getBoundingClientRect();
    const brand = document.querySelector('.app-brand')?.getBoundingClientRect();
    const headerNav = document.querySelector('.app-header-nav')?.getBoundingClientRect();
    const pageHead = document.querySelector('.analytics-page-head')?.getBoundingClientRect();
    const filters = document.querySelector('.analytics-page-head .filters')?.getBoundingClientRect();
    const summary = document.querySelector('#analyticsSummarySlot')?.getBoundingClientRect();
    const diagnostics = document.querySelector('#analyticsDiagnosticsSlot')?.getBoundingClientRect();
    const advanced = document.querySelector('#analyticsAdvancedSlot')?.getBoundingClientRect();
    const seriesPanel = document.querySelector('.series-panel-lean')?.getBoundingClientRect();
    const series = [...document.querySelectorAll('.series-panel-lean .series-chip')].map((chip) => ({
      color: getComputedStyle(chip).color,
      background: getComputedStyle(chip).backgroundColor,
      right: chip.getBoundingClientRect().right,
      panelRight: seriesPanel?.right || 0,
    }));
    return {
      viewport: window.innerWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      contentWidth: content?.width || 0,
      headerContainsNav: Boolean(header && headerNav && headerNav.left >= header.left && headerNav.right <= header.right),
      headerDoesNotOverlap: Boolean(brand && headerNav && brand.right <= headerNav.left),
      filtersInsidePage: Boolean(pageHead && filters && filters.left >= pageHead.left && filters.right <= pageHead.right + 1),
      summaryWidth: summary?.width || 0,
      diagnosticsWidth: diagnostics?.width || 0,
      diagnosticsAfterAdvanced: Boolean(diagnostics && advanced && diagnostics.top >= advanced.bottom),
      filterHeights: ['.source-switch', '.select-model', '.select-refresh', '.date-range-control'].map((selector) => Math.round(document.querySelector(`.analytics-page-head ${selector}`)?.getBoundingClientRect().height || 0)),
      refreshPartsSeparated: (() => {
        const glyph = document.querySelector('.analytics-page-head .refresh-glyph')?.getBoundingClientRect();
        const select = document.querySelector('.analytics-page-head .select-refresh select')?.getBoundingClientRect();
        return Boolean(glyph && select && glyph.right <= select.left);
      })(),
      seriesReadable: series.every((chip) => chip.color !== 'rgb(255, 255, 255)' && chip.right <= chip.panelRight + 1),
    };
  });
  assert.ok(maximizedLayout.contentWidth >= Math.min(maximizedLayout.viewport - 100, 1400), "maximized dashboard should use the available desktop width");
  assert.ok(maximizedLayout.summaryWidth >= maximizedLayout.contentWidth - 80, `summary should align to the maximized content width: ${JSON.stringify(maximizedLayout)}`);
  assert.ok(maximizedLayout.diagnosticsWidth >= maximizedLayout.contentWidth - 80, `diagnostics should align to the content width: ${JSON.stringify(maximizedLayout)}`);
  assert.equal(maximizedLayout.diagnosticsAfterAdvanced, true, "diagnostics center should render after the analytics content");
  assert.ok(maximizedLayout.documentScrollWidth <= maximizedLayout.documentClientWidth, `maximized dashboard should not overflow horizontally: ${JSON.stringify(maximizedLayout)}`);
  assert.equal(maximizedLayout.headerContainsNav, true, `workspace navigation should remain inside the application header: ${JSON.stringify(maximizedLayout)}`);
  assert.equal(maximizedLayout.headerDoesNotOverlap, true, `application identity and navigation must not overlap: ${JSON.stringify(maximizedLayout)}`);
  assert.equal(maximizedLayout.filtersInsidePage, true, `analytics filters should stay inside the page heading: ${JSON.stringify(maximizedLayout)}`);
  assert.equal(maximizedLayout.seriesReadable, true, `chart series controls should retain readable text and fit their panel: ${JSON.stringify(maximizedLayout)}`);
  assert.deepEqual(maximizedLayout.filterHeights, [42, 42, 42, 42], `analytics filter controls should share one height: ${JSON.stringify(maximizedLayout)}`);
  assert.equal(maximizedLayout.refreshPartsSeparated, true, `refresh glyph and value should not collide: ${JSON.stringify(maximizedLayout)}`);
  assert.ok(resizeState.appHtml > 1000, "dashboard should remain rendered after maximize");
  assert.equal(resizeState.bodyResizing, false, "resize class should settle after maximize");
  assert.ok(resizeState.perf.length >= 1, "resize perf session should be recorded");
  const lastResize = resizeState.perf.at(-1);
  if (lastResize?.totalMs > 180) {
    console.log(`resize slow detail ${JSON.stringify(lastResize.marks)}`);
  }
  const stages = lastResize.marks.map((m) => m.stage);
  assert.ok(stages.includes("resizeStart"), "resize perf should include resizeStart");
  assert.ok(stages.includes("domPatch"), "resize perf should include domPatch");
  assert.ok(stages.includes("chartRedraw") || stages.includes("sameSizeSkip"), "resize perf should include chart redraw or an explicit same-size skip");
  assert.ok(stages.includes("resizeEnd"), "resize perf should include resizeEnd");
  const sameSizeResize = await evalIn(win, () => {
    window.__e2eResizePerfStart = (window.__dashboardResizePerf || []).length;
    window.__e2eResizeCanvas = document.querySelector("#usageChart");
    window.dispatchEvent(new Event("resize"));
    return { before: window.__e2eResizePerfStart, sizeKey: document.querySelector("#usageChart")?.dataset?.sizeKey || "" };
  });
  await waitFor(win, () => (window.__dashboardResizePerf || []).length > (window.__e2eResizePerfStart || 0));
  const sameSizeResizeState = await evalIn(win, () => {
    const entry = (window.__dashboardResizePerf || [])[window.__e2eResizePerfStart || 0] || {};
    return {
      canvasStable: window.__e2eResizeCanvas === document.querySelector("#usageChart"),
      stages: (entry.marks || []).map((m) => m.stage),
      sizeKey: document.querySelector("#usageChart")?.dataset?.sizeKey || "",
      totalMs: entry.totalMs || 0,
    };
  });
  assert.equal(sameSizeResizeState.canvasStable, true, "same-size resize should preserve chart canvas node");
  assert.equal(sameSizeResizeState.sizeKey, sameSizeResize.sizeKey, "same-size resize should keep the chart canvas size key");
  assert.ok(sameSizeResizeState.stages.includes("sameSizeSkip"), "same-size resize should skip chart redraw explicitly");
  assert.equal(sameSizeResizeState.stages.includes("chartRedraw"), false, "same-size resize should not redraw chart");

  await evalIn(win, () => {
    window.__e2eSummarySlot = document.querySelector("#analyticsSummarySlot");
    window.__e2eChartSlot = document.querySelector("#analyticsChartSlot");
    window.__e2eTableSlot = document.querySelector("#analyticsTableSlot");
  });
  const sourceStarted = Date.now();
  await click(win, '[data-source="cli"]');
  await waitFor(win, () => localStorage.getItem("statsSource") === "cli" && document.querySelector('[data-source="cli"]')?.classList.contains("active"));
  const sourceSwitchMs = Date.now() - sourceStarted;
  await delay(140);
  const sourceState = await evalIn(win, () => ({
    source: localStorage.getItem("statsSource"),
    canvasStable: window.__e2eCanvas === document.querySelector("#usageChart"),
    summarySlotStable: window.__e2eSummarySlot === document.querySelector("#analyticsSummarySlot"),
    chartSlotStable: window.__e2eChartSlot === document.querySelector("#analyticsChartSlot"),
    tableSlotStable: window.__e2eTableSlot === document.querySelector("#analyticsTableSlot"),
    sourcePatchRecorded: (window.__dashboardPerf || []).some((entry) => entry?.label === "analytics:source-switch-patch"),
    html: document.getElementById("app")?.innerHTML || "",
  }));
  assert.equal(sourceState.source, "cli");
  assert.equal(sourceState.canvasStable, true, "source switch should preserve chart canvas node");
  assert.equal(sourceState.summarySlotStable, true, "source switch should patch summary slot without rebuilding shell");
  assert.equal(sourceState.chartSlotStable, true, "source switch should patch chart chrome without replacing chart slot");
  assert.equal(sourceState.tableSlotStable, true, "source switch should patch table slot without rebuilding shell");
  assert.equal(sourceState.sourcePatchRecorded, true, "source switch should record a dedicated local patch perf entry");
  assert.match(sourceState.html, /CLI/);
  assert.ok(sourceSwitchMs < 220, `source switch should activate immediately, got ${sourceSwitchMs}ms`);
  assert.ok(ipcCalls.some((x) => x.channel === "dashboard:getRequestsPage" && x.payload?.source === "cli"), "source switch should request DB page for cli");

  await changeValue(win, "[data-request-page-size]", "20");
  await waitFor(win, () => localStorage.getItem("requestPageSize") === "20" && document.querySelector('[data-table-limit="requests"]')?.dataset?.pageSize === "20");
  const requestPagerOptions = await evalIn(win, () => [...document.querySelectorAll("[data-request-page-size] option")].map((x) => Number(x.value)));
  assert.deepEqual(requestPagerOptions, [20, 50, 100], "request page size options should be 20/50/100");
  await evalIn(win, () => {
    const scroller = document.querySelector(".request-main .table-scroll");
    if (scroller) scroller.scrollTop = 9999;
  });
  const requestPageStarted = Date.now();
  await click(win, '[data-request-page="next"]');
  await waitFor(win, () => localStorage.getItem("requestTablePage") === "1" && document.querySelector('[data-table-limit="requests"]')?.dataset?.page === "1");
  const requestPageMs = Date.now() - requestPageStarted;
  const requestPageState = await evalIn(win, () => {
    const note = document.querySelector('[data-table-limit="requests"]');
    const scroller = document.querySelector(".request-main .table-scroll");
    return {
      page: Number(note?.dataset?.page || 0),
      pageSize: Number(note?.dataset?.pageSize || 0),
      total: Number(note?.dataset?.total || 0),
      rows: document.querySelectorAll(".request-main tbody tr").length,
      scrollTop: scroller?.scrollTop || 0,
    };
  });
  assert.equal(requestPageState.page, 1);
  assert.equal(requestPageState.pageSize, 20);
  assert.equal(requestPageState.scrollTop, 0, "request page change should reset table scroll");
  assert.ok(requestPageState.rows <= 20, "request page should render only current page");
  assert.ok(requestPageMs < 1800, `request page switch should stay responsive, got ${requestPageMs}ms`);
  assert.ok(ipcCalls.some((x) => x.channel === "dashboard:getRequestsPage" && x.payload?.source === "cli" && x.payload?.limit === 20 && x.payload?.offset === 20), "request next page should request DB offset=20");

  await changeValue(win, "[data-request-page-input]", "999");
  await click(win, "[data-request-page-go]");
  await waitFor(win, () => document.querySelector('[data-table-limit="requests"]')?.dataset?.page === "1");
  const requestClamp = await evalIn(win, () => Number(document.querySelector('[data-table-limit="requests"]')?.dataset?.page || 0));
  assert.equal(requestClamp, 1, "request page input beyond max should clamp to last page");
  await changeValue(win, "[data-request-page-input]", "0");
  await click(win, "[data-request-page-go]");
  await waitFor(win, () => document.querySelector('[data-table-limit="requests"]')?.dataset?.page === "0");
  const requestMinClamp = await evalIn(win, () => ({
    page: Number(document.querySelector('[data-table-limit="requests"]')?.dataset?.page || 0),
    input: document.querySelector("[data-request-page-input]")?.value || "",
  }));
  assert.equal(requestMinClamp.page, 0, "request page input below 1 should clamp to first page");
  assert.equal(requestMinClamp.input, "1", "request page input should be rewritten to first page after min clamp");
  await setPageTotalOverride(win, { requests: 8 });
  await click(win, '[data-request-page="next"]');
  await waitFor(win, () => {
    const note = document.querySelector('[data-table-limit="requests"]');
    return note?.dataset?.page === "0" && note?.dataset?.total === "8";
  });
  const requestEmptyFallback = await evalIn(win, () => ({
    page: Number(document.querySelector('[data-table-limit="requests"]')?.dataset?.page || 0),
    total: Number(document.querySelector('[data-table-limit="requests"]')?.dataset?.total || 0),
    rows: document.querySelectorAll(".request-main tbody tr").length,
    input: document.querySelector("[data-request-page-input]")?.value || "",
    nextDisabled: Boolean(document.querySelector('[data-request-page="next"]')?.disabled),
  }));
  assert.deepEqual(requestEmptyFallback, { page: 0, total: 8, rows: 8, input: "1", nextDisabled: true }, "request empty page should fall back to first/last valid page");
  await setPageTotalOverride(win, {});

  await click(win, '[data-source="all"]');
  await waitFor(win, () => localStorage.getItem("statsSource") === "all" && document.querySelector('[data-source="all"]')?.classList.contains("active"));
  await changeValue(win, "[data-request-page-size]", "50");
  await waitFor(win, () => localStorage.getItem("requestPageSize") === "50" && document.querySelector('[data-table-limit="requests"]')?.dataset?.pageSize === "50" && document.querySelector('[data-table-limit="requests"]')?.dataset?.page === "0");
  const requestSize50 = await evalIn(win, () => ({
    page: Number(document.querySelector('[data-table-limit="requests"]')?.dataset?.page || 0),
    rows: document.querySelectorAll(".request-main tbody tr").length,
    nextDisabled: Boolean(document.querySelector('[data-request-page="next"]')?.disabled),
  }));
  assert.equal(requestSize50.page, 0, "request page size change should reset to first page");
  assert.ok(requestSize50.rows <= 50, "request page size 50 should render at most 50 rows");
  assert.equal(requestSize50.nextDisabled, false, "request page size 50 should still allow next page for 72 rows");
  await click(win, '[data-request-page="next"]');
  await waitFor(win, () => localStorage.getItem("requestTablePage") === "1" && document.querySelector('[data-table-limit="requests"]')?.dataset?.page === "1");
  assert.ok(ipcCalls.some((x) => x.channel === "dashboard:getRequestsPage" && x.payload?.source === "all" && x.payload?.limit === 50 && x.payload?.offset === 50), "request page size 50 should request DB offset=50");
  await changeValue(win, "[data-request-page-size]", "100");
  await waitFor(win, () => localStorage.getItem("requestPageSize") === "100" && document.querySelector('[data-table-limit="requests"]')?.dataset?.pageSize === "100" && document.querySelector('[data-table-limit="requests"]')?.dataset?.page === "0");
  const requestSize100 = await evalIn(win, () => ({
    rows: document.querySelectorAll(".request-main tbody tr").length,
    nextDisabled: Boolean(document.querySelector('[data-request-page="next"]')?.disabled),
  }));
  assert.ok(requestSize100.rows <= 100, "request page size 100 should render at most 100 rows");
  assert.equal(requestSize100.nextDisabled, true, "request page size 100 should disable next page for 72 rows");
  await click(win, '[data-workspace="sessions"]');
  await waitFor(win, () => localStorage.getItem("workspaceMode") === "sessions" && Boolean(document.querySelector(".session-manager")));
  await changeValue(win, "[data-session-page-size]", "20");
  await waitFor(win, () => localStorage.getItem("sessionPageSize") === "20" && document.querySelector('[data-table-limit="sessions"]')?.dataset?.pageSize === "20");
  const sessionPagerOptions = await evalIn(win, () => [...document.querySelectorAll("[data-session-page-size] option")].map((x) => Number(x.value)));
  assert.deepEqual(sessionPagerOptions, [20, 50, 100], "session page size options should be 20/50/100");
  await waitFor(win, () => document.querySelectorAll(".session-scroll tbody tr.session-row").length >= 2);
  const sessionLocalInitial = await evalIn(win, () => {
    const rows = [...document.querySelectorAll(".session-scroll tbody tr.session-row")];
    window.__e2eSessionTableSlot = document.querySelector("#sessionTableSlot");
    window.__e2eSessionTbody = document.querySelector(".session-scroll tbody");
    window.__e2eSessionInspectorSlot = document.querySelector("#sessionInspectorSlot");
    window.__e2eSessionFirstRow = rows[0] || null;
    window.__e2eSessionSecondRow = rows[1] || null;
    window.__e2eSessionSecondKey = rows[1]?.dataset?.sessionSelect || "";
    window.__e2eSessionPerfStart = (window.__dashboardPerf || []).length;
    return { rows: rows.length, secondKey: window.__e2eSessionSecondKey };
  });
  assert.ok(sessionLocalInitial.rows >= 2, "session local render test needs at least two rows");
  assert.ok(sessionLocalInitial.secondKey, "second session row should expose a stable key");
  await click(win, ".session-scroll tbody tr.session-row:nth-child(2) td:nth-child(5)");
  await waitFor(win, () => document.querySelector(".session-scroll tbody tr.session-row:nth-child(2)")?.classList.contains("selected")
    && (window.__dashboardPerf || []).slice(window.__e2eSessionPerfStart || 0).some((entry) => entry?.label === "sessions:inspector-patch"));
  const sessionSelectPatch = await evalIn(win, () => ({
    tableSlotStable: window.__e2eSessionTableSlot === document.querySelector("#sessionTableSlot"),
    tbodyStable: window.__e2eSessionTbody === document.querySelector(".session-scroll tbody"),
    inspectorSlotStable: window.__e2eSessionInspectorSlot === document.querySelector("#sessionInspectorSlot"),
    firstRowStable: window.__e2eSessionFirstRow === document.querySelector(".session-scroll tbody tr.session-row:nth-child(1)"),
    secondRowStable: window.__e2eSessionSecondRow === document.querySelector(".session-scroll tbody tr.session-row:nth-child(2)"),
    selectedKey: localStorage.getItem("selectedSessionId"),
    perfLabels: (window.__dashboardPerf || []).slice(window.__e2eSessionPerfStart || 0).map((entry) => entry?.label),
  }));
  assert.equal(sessionSelectPatch.tableSlotStable, true, "session selection should not rebuild table slot");
  assert.equal(sessionSelectPatch.tbodyStable, true, "session selection should not rebuild tbody");
  assert.equal(sessionSelectPatch.inspectorSlotStable, true, "session selection should keep inspector slot node stable");
  assert.equal(sessionSelectPatch.firstRowStable, true, "session selection should not replace non-selected rows");
  assert.equal(sessionSelectPatch.secondRowStable, true, "session selection should not replace selected row");
  assert.equal(sessionSelectPatch.selectedKey, sessionLocalInitial.secondKey, "session selection should update selected session key");
  assert.ok(sessionSelectPatch.perfLabels.includes("sessions:inspector-patch"), "session selection should record inspector local patch perf");
  await evalIn(win, () => {
    window.__e2eSessionPinnedRow = document.querySelector(".session-scroll tbody tr.session-row.selected");
    window.__e2eSessionPinPerfStart = (window.__dashboardPerf || []).length;
    return true;
  });
  await click(win, ".session-scroll tbody tr.session-row.selected [data-session-pin]");
  await waitFor(win, () => document.querySelector(".session-scroll tbody tr.session-row.selected")?.classList.contains("pinned")
    && (window.__dashboardPerf || []).slice(window.__e2eSessionPinPerfStart || 0).some((entry) => entry?.label === "sessions:local-mutation-patch"));
  const sessionPinPatch = await evalIn(win, () => ({
    tableSlotStable: window.__e2eSessionTableSlot === document.querySelector("#sessionTableSlot"),
    tbodyStable: window.__e2eSessionTbody === document.querySelector(".session-scroll tbody"),
    inspectorSlotStable: window.__e2eSessionInspectorSlot === document.querySelector("#sessionInspectorSlot"),
    rowStable: window.__e2eSessionPinnedRow === document.querySelector(".session-scroll tbody tr.session-row.selected"),
    rowPinned: document.querySelector(".session-scroll tbody tr.session-row.selected")?.classList.contains("pinned") || false,
    inspectorPinned: Boolean(document.querySelector("#sessionInspectorSlot .pinned-state")),
    perfLabels: (window.__dashboardPerf || []).slice(window.__e2eSessionPinPerfStart || 0).map((entry) => entry?.label),
  }));
  assert.equal(sessionPinPatch.tableSlotStable, true, "session pin should not rebuild table slot");
  assert.equal(sessionPinPatch.tbodyStable, true, "session pin should not rebuild tbody");
  assert.equal(sessionPinPatch.inspectorSlotStable, true, "session pin should keep inspector slot node stable");
  assert.equal(sessionPinPatch.rowStable, true, "session pin should patch the current row in place");
  assert.equal(sessionPinPatch.rowPinned, true, "session pin should update the current row state");
  assert.equal(sessionPinPatch.inspectorPinned, true, "session pin should update inspector state");
  assert.ok(sessionPinPatch.perfLabels.includes("sessions:local-mutation-patch"), "session pin should record local mutation patch perf");
  await evalIn(win, () => {
    const scroller = document.querySelector(".session-scroll");
    if (scroller) scroller.scrollTop = 9999;
  });
  const sessionPageStarted = Date.now();
  await click(win, '[data-session-page="next"]');
  await waitFor(win, () => localStorage.getItem("sessionTablePage") === "1" && document.querySelector('[data-table-limit="sessions"]')?.dataset?.page === "1");
  const sessionPageMs = Date.now() - sessionPageStarted;
  const sessionPageState = await evalIn(win, () => {
    const note = document.querySelector('[data-table-limit="sessions"]');
    const scroller = document.querySelector(".session-scroll");
    return {
      page: Number(note?.dataset?.page || 0),
      pageSize: Number(note?.dataset?.pageSize || 0),
      total: Number(note?.dataset?.total || 0),
      rows: document.querySelectorAll(".session-scroll tbody tr").length,
      scrollTop: scroller?.scrollTop || 0,
    };
  });
  assert.equal(sessionPageState.page, 1);
  assert.equal(sessionPageState.pageSize, 20);
  assert.equal(sessionPageState.scrollTop, 0, "session page change should reset table scroll");
  assert.ok(sessionPageState.rows <= 20, "session page should render only current page");
  assert.ok(sessionPageMs < 1800, `session page switch should stay responsive, got ${sessionPageMs}ms`);
  const sessionPaginationGeometry = await evalIn(win, (kind) => {
    const prefix = kind === 'sessions' ? 'session' : 'request';
    const note = document.querySelector(`[data-table-limit="${kind}"]`);
    const sizeField = note?.querySelector('.table-page-size');
    const sizeSelect = note?.querySelector(`[data-${prefix}-page-size]`);
    const jumpField = note?.querySelector('.table-page-jump');
    const jumpInput = note?.querySelector(`[data-${prefix}-page-input]`);
    const sizeUnits = sizeField ? [...sizeField.querySelectorAll('span')].map((node) => node.getBoundingClientRect()) : [];
    const jumpUnits = jumpField ? [...jumpField.querySelectorAll('span')].map((node) => node.getBoundingClientRect()) : [];
    const selectRect = sizeSelect?.getBoundingClientRect();
    const inputRect = jumpInput?.getBoundingClientRect();
    return {
      present: Boolean(note && sizeField && sizeSelect && jumpField && jumpInput),
      controlsSameHeight: Boolean(sizeField && jumpField && Math.round(sizeField.getBoundingClientRect().height) === Math.round(jumpField.getBoundingClientRect().height)),
      sizeSeparated: Boolean(selectRect && sizeUnits.length === 2 && sizeUnits[0].right <= selectRect.left && selectRect.right <= sizeUnits[1].left),
      jumpSeparated: Boolean(inputRect && jumpUnits.length === 2 && jumpUnits[0].right <= inputRect.left && inputRect.right <= jumpUnits[1].left),
    };
  }, 'sessions');
  assert.deepEqual(sessionPaginationGeometry, { present: true, controlsSameHeight: true, sizeSeparated: true, jumpSeparated: true }, `session pagination controls should not overlap their labels: ${JSON.stringify(sessionPaginationGeometry)}`);
  assert.ok(ipcCalls.some((x) => x.channel === "dashboard:getSessionsPage" && x.payload?.source === "all" && x.payload?.limit === 20 && x.payload?.offset === 20), "session next page should request DB offset=20");
  await changeValue(win, "[data-session-page-input]", "999");
  await click(win, "[data-session-page-go]");
  await waitFor(win, () => {
    const note = document.querySelector('[data-table-limit="sessions"]');
    if (!note) return false;
    const total = Number(note.dataset.total || 0);
    const pageSize = Number(note.dataset.pageSize || 20);
    const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
    return Number(note.dataset.page || 0) === maxPage;
  });
  const sessionClamp = await evalIn(win, () => {
    const note = document.querySelector('[data-table-limit="sessions"]');
    const total = Number(note?.dataset?.total || 0);
    const pageSize = Number(note?.dataset?.pageSize || 20);
    return { page: Number(note?.dataset?.page || 0), maxPage: Math.max(0, Math.ceil(total / pageSize) - 1) };
  });
  assert.equal(sessionClamp.page, sessionClamp.maxPage, "session page input beyond max should clamp to last page");
  await changeValue(win, "[data-session-page-input]", "-1");
  await click(win, "[data-session-page-go]");
  await waitFor(win, () => document.querySelector('[data-table-limit="sessions"]')?.dataset?.page === "0");
  const sessionMinClamp = await evalIn(win, () => ({
    page: Number(document.querySelector('[data-table-limit="sessions"]')?.dataset?.page || 0),
    input: document.querySelector("[data-session-page-input]")?.value || "",
  }));
  assert.equal(sessionMinClamp.page, 0, "session page input below 1 should clamp to first page");
  assert.equal(sessionMinClamp.input, "1", "session page input should be rewritten to first page after min clamp");
  await setPageTotalOverride(win, { sessions: 8 });
  await click(win, '[data-session-page="next"]');
  await waitFor(win, () => {
    const note = document.querySelector('[data-table-limit="sessions"]');
    return note?.dataset?.page === "0"
      && note?.dataset?.total === "8"
      && document.querySelectorAll(".session-scroll tbody tr").length === 8
      && !document.querySelector(".session-scroll tbody .empty-cell");
  });
  const sessionEmptyFallback = await evalIn(win, () => ({
    page: Number(document.querySelector('[data-table-limit="sessions"]')?.dataset?.page || 0),
    total: Number(document.querySelector('[data-table-limit="sessions"]')?.dataset?.total || 0),
    rows: document.querySelectorAll(".session-scroll tbody tr").length,
    input: document.querySelector("[data-session-page-input]")?.value || "",
    nextDisabled: Boolean(document.querySelector('[data-session-page="next"]')?.disabled),
  }));
  assert.deepEqual(sessionEmptyFallback, { page: 0, total: 8, rows: 8, input: "1", nextDisabled: true }, "session empty page should fall back to first/last valid page");
  await setPageTotalOverride(win, {});
  await changeValue(win, "[data-session-page-size]", "50");
  await waitFor(win, () => localStorage.getItem("sessionPageSize") === "50" && document.querySelector('[data-table-limit="sessions"]')?.dataset?.pageSize === "50" && document.querySelector('[data-table-limit="sessions"]')?.dataset?.page === "0");
  const sessionSize50 = await evalIn(win, () => ({
    page: Number(document.querySelector('[data-table-limit="sessions"]')?.dataset?.page || 0),
    rows: document.querySelectorAll(".session-scroll tbody tr").length,
    nextDisabled: Boolean(document.querySelector('[data-session-page="next"]')?.disabled),
  }));
  assert.equal(sessionSize50.page, 0, "session page size change should reset to first page");
  assert.ok(sessionSize50.rows <= 50, "session page size 50 should render at most 50 rows");
  assert.equal(sessionSize50.nextDisabled, false, "session page size 50 should still allow next page for 72 rows");
  await click(win, '[data-session-page="next"]');
  await waitFor(win, () => localStorage.getItem("sessionTablePage") === "1" && document.querySelector('[data-table-limit="sessions"]')?.dataset?.page === "1");
  assert.ok(ipcCalls.some((x) => x.channel === "dashboard:getSessionsPage" && x.payload?.source === "all" && x.payload?.limit === 50 && x.payload?.offset === 50), "session page size 50 should request DB offset=50");
  await changeValue(win, "[data-session-page-size]", "100");
  await waitFor(win, () => localStorage.getItem("sessionPageSize") === "100" && document.querySelector('[data-table-limit="sessions"]')?.dataset?.pageSize === "100" && document.querySelector('[data-table-limit="sessions"]')?.dataset?.page === "0");
  const sessionSize100 = await evalIn(win, () => ({
    rows: document.querySelectorAll(".session-scroll tbody tr").length,
    nextDisabled: Boolean(document.querySelector('[data-session-page="next"]')?.disabled),
  }));
  assert.ok(sessionSize100.rows <= 100, "session page size 100 should render at most 100 rows");
  assert.equal(sessionSize100.nextDisabled, true, "session page size 100 should disable next page for 72 rows");

  await click(win, '[data-workspace="analytics"]');
  await waitFor(win, () => localStorage.getItem("workspaceMode") === "analytics" && Boolean(document.querySelector("#usageChart")));

  await click(win, "[data-date-range-toggle]");
  await waitFor(win, () => Boolean(document.querySelector(".date-range-popover")));
  const dateOpen = await evalIn(win, () => ({
    dateInputs: document.querySelectorAll('[data-date-range-date]').length,
    timeInputs: document.querySelectorAll('[data-date-range-time]').length,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    popoverRect: (() => {
      const rect = document.querySelector(".date-range-popover")?.getBoundingClientRect();
      return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    })(),
  }));
  assert.equal(dateOpen.dateInputs, 2);
  assert.equal(dateOpen.timeInputs, 2);
  assert.ok(dateOpen.popoverRect, "date range popover should have a layout rect");
  assert.ok(dateOpen.popoverRect.left >= 8, `date range popover should not overflow left after maximize: ${JSON.stringify(dateOpen.popoverRect)}`);
  assert.ok(dateOpen.popoverRect.right <= dateOpen.viewport.width - 8, `date range popover should not overflow right after maximize: ${JSON.stringify(dateOpen.popoverRect)}`);
  assert.ok(dateOpen.popoverRect.bottom <= dateOpen.viewport.height - 8, `date range popover should fit vertically after maximize: ${JSON.stringify(dateOpen.popoverRect)}`);
  const invalidDateState = await evalIn(win, () => {
    const beforeStart = localStorage.getItem("customDateStart");
    const beforeEnd = localStorage.getItem("customDateEnd");
    const popover = document.querySelector(".date-range-popover");
    if (popover) popover.dataset.e2eStable = "1";
    const values = [
      ['[data-date-range-date="start"]', "2026-07-10"],
      ['[data-date-range-time="start"]', "12:00"],
      ['[data-date-range-date="end"]', "2026-07-09"],
      ['[data-date-range-time="end"]', "10:00"],
    ];
    for (const [selector, value] of values) {
      const el = document.querySelector(selector);
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const active = document.activeElement;
    return {
      open: Boolean(document.querySelector(".date-range-popover")),
      error: document.querySelector("[data-date-range-error]")?.textContent || "",
      disabled: Boolean(document.querySelector("[data-date-range-confirm]")?.disabled),
      activeName: active?.dataset?.dateRangeTime || active?.dataset?.dateRangeDate || "",
      beforeStart,
      beforeEnd,
      afterStart: localStorage.getItem("customDateStart"),
      afterEnd: localStorage.getItem("customDateEnd"),
      draftStart: Number(dateRangeDraftStart || 0),
      draftEnd: Number(dateRangeDraftEnd || 0),
      popoverStable: document.querySelector(".date-range-popover")?.dataset?.e2eStable === "1",
    };
  });
  assert.equal(invalidDateState.open, true, "invalid date input should keep popover open");
  assert.match(invalidDateState.error, /结束时间|End time/);
  assert.equal(invalidDateState.disabled, true, "invalid date range should disable confirm");
  assert.equal(invalidDateState.activeName, "end", "date input should keep focus while showing error");
  assert.equal(invalidDateState.popoverStable, true, "date draft input should patch fields without rebuilding popover");
  assert.equal(invalidDateState.afterStart, invalidDateState.beforeStart, "invalid draft must not write start to storage");
  assert.equal(invalidDateState.afterEnd, invalidDateState.beforeEnd, "invalid draft must not write end to storage");
  assert.equal(ipcCalls.some((x) => (x.channel === "dashboard:getRequestsPage" || x.channel === "dashboard:getSessionsPage") && Number(x.payload?.range?.start || 0) === invalidDateState.draftStart && Number(x.payload?.range?.end || 0) === invalidDateState.draftEnd), false, "invalid date draft must not request DB pages with the invalid range");
  await evalIn(win, () => {
    const values = [
      ['[data-date-range-date="start"]', "2026-07-08"],
      ['[data-date-range-time="start"]', "09:30"],
      ['[data-date-range-date="end"]', "2026-07-09"],
      ['[data-date-range-time="end"]', "10:45"],
    ];
    for (const [selector, value] of values) {
      const el = document.querySelector(selector);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await waitFor(win, () => !document.querySelector("[data-date-range-confirm]")?.disabled);
  await click(win, "[data-date-range-confirm]");
  await waitFor(win, () => !document.querySelector(".date-range-popover") && localStorage.getItem("statsRange") === "customTime" && localStorage.getItem("requestTablePage") === "0");
  const dateState = await evalIn(win, () => ({
    range: localStorage.getItem("statsRange"),
    requestPage: localStorage.getItem("requestTablePage"),
    start: Number(localStorage.getItem("customDateStart") || 0),
    end: Number(localStorage.getItem("customDateEnd") || 0),
    summary: document.querySelector(".date-range-trigger b")?.textContent || "",
  }));
  assert.equal(dateState.range, "customTime");
  assert.equal(dateState.requestPage, "0", "date range apply should reset request table to first page");
  assert.ok(dateState.start > 0 && dateState.end > dateState.start, "custom date range should be saved");
  assert.match(dateState.summary, /2026\/07\/08|07\/08/);
  assert.ok(ipcCalls.some((x) => x.channel === "dashboard:getRequestsPage" && x.payload?.offset === 0 && Number(x.payload?.range?.start || 0) === dateState.start && Number(x.payload?.range?.end || 0) === dateState.end), "date range apply should request the first DB page with the confirmed range");

  await evalIn(win, () => {
    window.__copiedPerfReport = "";
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text) => { window.__copiedPerfReport = String(text || ""); } },
      });
    } catch {
      navigator.clipboard = { writeText: async (text) => { window.__copiedPerfReport = String(text || ""); } };
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    return true;
  });
  await waitFor(win, () => Boolean(document.querySelector("#perfPanel.show") && document.querySelector("[data-copy-perf-report]")));
  const perfPanelState = await evalIn(win, () => ({
    text: document.querySelector("#perfPanel")?.textContent || "",
    hasCopy: Boolean(document.querySelector("[data-copy-perf-report]")),
  }));
  assert.equal(perfPanelState.hasCopy, true, "perf panel should expose copy report action");
  assert.match(perfPanelState.text, /聚合缓存|rollup|resize/, "perf panel should show render/data/resize sections");
  await click(win, "[data-copy-perf-report]");
  const copiedPerfReport = await waitFor(win, () => {
    try {
      const raw = window.__copiedPerfReport || "";
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });
  assert.equal(copiedPerfReport.report, "dashboard-performance");
  assert.equal(copiedPerfReport.dataLayer.aggregateCache.hits, 3);
  assert.equal(copiedPerfReport.dataLayer.usageRollup.compactHits, 2);
  assert.ok(Array.isArray(copiedPerfReport.renderHistory), "performance report should include render history");
  assert.ok(Array.isArray(copiedPerfReport.resizeHistory), "performance report should include resize history");
  assert.equal(Object.prototype.hasOwnProperty.call(copiedPerfReport.snapshot.sources[0] || {}, "dbPath"), false, "performance report should not expose dbPath in source summary");
  assert.ok(ipcCalls.some((x) => x.channel === "dashboard:getDiagnostics"), "copy performance report should read diagnostics");

  console.log(`ok - electron dashboard e2e resizePerf=${lastResize.totalMs}ms sourceSwitch=${sourceSwitchMs}ms requestPage=${requestPageMs}ms sessionPage=${sessionPageMs}ms ipcCalls=${ipcCalls.length} resizeLogs=${resizeLogs.length}`);
  win.destroy();
  app.exit(0);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
