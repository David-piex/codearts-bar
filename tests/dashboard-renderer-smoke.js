"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function makeElement(id) {
  const ctx = {
    scale(){},
    clearRect(){},
    fillRect(){},
    beginPath(){},
    moveTo(){},
    lineTo(){},
    quadraticCurveTo(){},
    stroke(){},
    fill(){},
    fillText(){},
    closePath(){},
    save(){},
    restore(){},
    setLineDash(){},
    arc(){},
    roundRect(){},
    measureText(text){ return { width: String(text || "").length * 7 }; },
    createLinearGradient(){ return { addColorStop(){} }; },
    createRadialGradient(){ return { addColorStop(){} }; },
  };
  return {
    id,
    innerHTML: "",
    textContent: "",
    style: {},
    classList: { add(){}, remove(){}, toggle(){} },
    closest(){ return null; },
    focus(){},
    select(){},
    setSelectionRange(){},
    getBoundingClientRect(){ return id === "usageChart" ? { left: 0, top: 0, width: 960, height: 306 } : { left: 0, top: 0, width: 248, height: 220 }; },
    getContext(){ return ctx; },
  };
}

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key){ return data.has(key) ? data.get(key) : null; },
    setItem(key, value){ data.set(key, String(value)); },
    removeItem(key){ data.delete(key); },
    dump(){ return Object.fromEntries(data.entries()); },
  };
}

// Keep both fixture requests on the same local calendar day in every CI timezone.
const now = Date.UTC(2026, 6, 8, 12, 0, 0);
class FixedDate extends Date {
  constructor(...args){ super(...(args.length ? args : [now])); }
  static now(){ return now; }
}
const snapshot = {
  ok: true,
  timestamp: now,
  updatedAt: "2026/07/08 12:00",
  dbPath: "C:/tmp/opencode.db",
  sources: [
    { id: "desktop", source: "desktop", label: "\u684c\u9762\u7aef" },
    { id: "cli", source: "cli", label: "CLI" },
  ],
  usage: {
    today: { total: 4200, input: 1200, output: 900, cacheRead: 1100, cacheWrite: 500, requests: 3 },
    window: { total: 4200, input: 1200, output: 900, cacheRead: 1600, cacheWrite: 500, requests: 3 },
    week: { total: 4200, input: 1200, output: 900, cacheRead: 1600, cacheWrite: 500, requests: 3 },
    all: { total: 4200, input: 1200, output: 900, cacheRead: 1600, cacheWrite: 500, requests: 3 },
  },
  queue: { window: {}, trends: { hourly24h: [] } },
  requestLog: [
    { id: "r1", sessionId: "s1", sessionTitle: "Build landing", directory: "C:/work/alpha", source: "desktop", sourceLabel: "\u684c\u9762\u7aef", provider: "p", model: "m1", time: now - 3600000, input: 500, output: 300, cacheRead: 1000, cacheWrite: 200, total: 2000, ok: true, status: "200", latencyMs: 1200, ttftMs: 300, firstContentMs: 350, outputTokensPerSec: 12 },
    { id: "r2", sessionId: "s2", sessionTitle: "Audit cache", directory: "C:/work/beta", source: "cli", sourceLabel: "CLI", provider: "p", model: "m2", time: now - 7200000, input: 700, output: 600, cacheRead: 100, cacheWrite: 300, total: 2200, ok: true, status: "200", latencyMs: 1800, ttftMs: 450, firstContentMs: 500, outputTokensPerSec: 9 },
  ],
  sessions: [
    { id: "s1", title: "Build landing", directory: "C:/work/alpha", version: "1", createdAt: now - 9000000, updatedAt: now - 1000000, archivedAt: null, archived: false, source: "desktop", sourceLabel: "\u684c\u9762\u7aef", dbPath: "db", usage: { total: 2000, input: 500, output: 300, cacheRead: 1000, cacheWrite: 200, userTurns: 3, modelCalls: 2, models: [{ provider: "p", model: "m1", calls: 2, total: 2000, input: 500, output: 300, cacheRead: 1000, cacheWrite: 200 }], topModel: { provider: "p", model: "m1" } } },
    { id: "s2", title: "Audit cache", directory: "C:/work/beta", version: "1", createdAt: now - 8000000, updatedAt: now - 2000000, archivedAt: null, archived: false, source: "cli", sourceLabel: "CLI", dbPath: "db", usage: { total: 2200, input: 700, output: 600, cacheRead: 100, cacheWrite: 300, userTurns: 2, modelCalls: 1, models: [{ provider: "p", model: "m2", calls: 1, total: 2200, input: 700, output: 600, cacheRead: 100, cacheWrite: 300 }], topModel: { provider: "p", model: "m2" } } },
  ],
};

async function main() {
  const elements = new Map();
  for (const id of ["app", "refresh", "settings", "layoutMode", "zoomIn", "zoomOut", "copy", "refreshState", "chartTip"]) elements.set(id, makeElement(id));

  const listeners = {};
  const document = {
    body: { style: {} },
    getElementById(id){ if(!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); },
    addEventListener(type, handler){ listeners[type] = handler; },
    querySelector(){ return null; },
  };
  const storage = makeStorage({ workspaceMode: "sessions", sessionQuickFilter: "all", sessionProjectFilter: "all", statsTableTab: "sessions" });
  const calls = [];
  const clipboardWrites = [];
  let rafNow = 0;
  const ipcRenderer = {
    async invoke(channel, ...args){
      calls.push([channel, ...args]);
      if(channel === "dashboard:getSnapshot" || channel === "dashboard:refresh") return snapshot;
      if(channel === "dashboard:getDiagnostics") return { ok: true, performance: { aggregateCache: { hits: 2, misses: 1, reads: 3, hitRate: 2 / 3, size: 2, limit: 64 }, usageRollup: { compactHits: 1, tokenHits: 0, misses: 1, invalid: 0, pendingCount: 0, hitRate: 0.5, buildCompleted: 1, buildFailed: 0 } } };
      if(channel === "dashboard:getSessionRequestsPage") return { ok: true, limit: 12, offset: 0, total: 1, hasMore: false, items: [{ id: "db-only-request", sessionId: "s1", sessionTitle: "Build landing", source: "desktop", sourceLabel: "\u684c\u9762\u7aef", provider: "p", model: "db-only-model", time: now - 1234, input: 1, output: 2, cacheRead: 3, cacheWrite: 0, total: 6, ok: true, status: "200", latencyMs: 11, ttftMs: 7, outputTokensPerSec: 4 }] };
      return null;
    },
    on(){},
  };
  const context = {
    console,
    require(name){ if(name === "electron") return { ipcRenderer }; if(name === "node:fs") return require("node:fs"); if(name === "node:path") return require("node:path"); throw new Error(`Unexpected require: ${name}`); },
    window: { codeartsApi: ipcRenderer, matchMedia: () => ({ matches: false }), devicePixelRatio: 1, innerWidth: 1280, innerHeight: 860, addEventListener(){} },
    document,
    localStorage: storage,
    navigator: { clipboard: { writeText: async (text) => { clipboardWrites.push(String(text)); } } },
    setInterval(){ return 1; },
    clearInterval(){},
    setTimeout(fn){ if(typeof fn === "function") fn(); return 1; },
    clearTimeout(){},
    requestAnimationFrame(fn){ rafNow += 240; if(typeof fn === "function") fn(rafNow); return rafNow; },
    cancelAnimationFrame(){},
    performance: { now: () => 0 },
    Date: FixedDate,
    Intl,
    Math,
    Number,
    String,
    Boolean,
    JSON,
    Map,
    Set,
    Array,
    Object,
    RegExp,
    Error,
    Promise,
    testSnapshot: snapshot,
  };
  context.globalThis = context;
  vm.createContext(context);
  const code = fs.readFileSync(path.join(__dirname, "..", "src", "dashboard-renderer.js"), "utf8");
  vm.runInContext(code, context, { filename: "dashboard-renderer.js" });
  const rollingBuckets = vm.runInContext('(() => { const previousRange = rangeFilter; rangeFilter = "30d"; try { return bucketRows([], testSnapshot); } finally { rangeFilter = previousRange; } })()', context);
  const rollingEndExclusive = vm.runInContext('(() => { const previousRange = rangeFilter; rangeFilter = "30d"; try { return untilForRange(testSnapshot); } finally { rangeFilter = previousRange; } })()', context);
  assert.ok(rollingBuckets.length > 0);
  assert.ok(rollingBuckets.every((bucket) => bucket.start < rollingEndExclusive), 'trend buckets must not begin at or after the exclusive range end');
  assert.equal(vm.runInContext('avg(undefined)', context), null, 'analytics averages must tolerate missing metric arrays');
  assert.equal(vm.runInContext('avg(null)', context), null, 'analytics averages must tolerate null metric arrays');
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve));

  const html = elements.get("app").innerHTML;
  if(!html) console.error("empty renderer html", calls);
  assert.match(html, /workspace-tabs/);
  assert.match(html, /analytics-page-head/);
  assert.match(html, /data-select="project"/);
  assert.match(html, /C:\/work\/alpha/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "dashboard", "slots", "data-page-core.js"), "utf8"), /overflowAnchor = 'none'[\s\S]*setTimeout\(\(\) =>/);
  vm.runInContext(`
    analyticsProjectFilter = 'C:/work/alpha';
    snapshot.requestPage = { items: snapshot.requestLog, payload: { source: 'all', model: 'all', project: 'C:/work/beta', query: '', limit: REQUEST_PAGE_SIZE, offset: 0, range: currentPageRangePayload() } };
    globalThis.__projectPageMatches = requestPageMatchesTable(snapshot);
  `, context);
  assert.equal(context.__projectPageMatches, false, 'request page cache must include the analytics project scope');
  vm.runInContext(`analyticsProjectFilter = 'all';`, context);
  assert.equal(storage.getItem("workspaceMode"), "analytics", "dashboard should start in analytics even when the previous workspace was sessions");
  await listeners.click({
    target: {
      closest(selector){ return selector === '[data-workspace]' ? { dataset: { workspace: 'sessions' } } : null; },
    },
  });
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve));
  const sessionHtml = elements.get("app").innerHTML;
  assert.match(sessionHtml, /session-overview/);
  assert.match(sessionHtml, /session-simple-shell/);
  assert.doesNotMatch(sessionHtml, /session-intent-row/);
  assert.match(sessionHtml, /session-primary-filters/);
  assert.match(sessionHtml, /session-saved-inline/);
  assert.doesNotMatch(sessionHtml, /session-library-status/);
  assert.doesNotMatch(sessionHtml, /idle-card compact-idle/);
  assert.doesNotMatch(sessionHtml, /global-cache-pill/);
  assert.doesNotMatch(sessionHtml, /data-global-cache-action/);
  assert.match(sessionHtml, /session-table simple/);
  assert.match(sessionHtml, /data-table-limit="sessions"/);
  assert.match(sessionHtml, /data-session-page-size/);
  assert.match(sessionHtml, /<option value="10"/);
  assert.match(sessionHtml, /<option value="20"/);
  assert.match(sessionHtml, /<option value="50"/);
  assert.match(sessionHtml, /<option value="100"/);
  assert.match(sessionHtml, /data-session-page-input/);
  assert.match(sessionHtml, /data-session-page-go/);
  assert.doesNotMatch(sessionHtml, /session-table detailed/);
  assert.match(sessionHtml, /session-row-actions/);
  assert.match(sessionHtml, /session-actions-cell/);
  assert.doesNotMatch(sessionHtml, /cache-pill hot/);
  assert.doesNotMatch(sessionHtml, /style="--hit:/);
  assert.match(sessionHtml, /data-session-action="copy-summary"/);
  assert.match(sessionHtml, /data-session-action="open"/);
  assert.match(sessionHtml, /data-session-action="archive"/);
  assert.match(sessionHtml, /saved-view-composer/);
  assert.match(sessionHtml, /data-saved-session-save/);
  assert.match(sessionHtml, /data-session-primary-filter="recent"/);
  assert.match(sessionHtml, /data-session-primary-filter="pinned"/);
  assert.doesNotMatch(sessionHtml, /data-session-primary-filter="cacheLow"/);
  assert.match(sessionHtml, /data-session-primary-filter="archived"/);
  assert.doesNotMatch(sessionHtml, /session-filter-context/);
  assert.doesNotMatch(sessionHtml, /data-session-reset-filters/);
  assert.doesNotMatch(sessionHtml, /session-advanced-shell collapsed/);
  assert.doesNotMatch(sessionHtml, /data-session-advanced-toggle/);
  assert.doesNotMatch(sessionHtml, /session-smart-views/);
  assert.doesNotMatch(sessionHtml, /cache-governance-kpis/);
  assert.doesNotMatch(sessionHtml, /session-cache-opportunities/);
  assert.doesNotMatch(sessionHtml, /session-project-rail/);
  assert.match(sessionHtml, /project-chip/);
  assert.match(sessionHtml, /session-essential-inspector/);
  assert.match(sessionHtml, /session-essential-actions/);
  assert.match(sessionHtml, /session-essential-save/);
  assert.match(sessionHtml, /session-essential-summary/);
  assert.match(sessionHtml, /session-essential-meta/);
  assert.match(sessionHtml, /data-session-tags/);
  assert.match(sessionHtml, /data-session-note/);
  assert.match(sessionHtml, /data-session-action="rename"/);
  assert.match(sessionHtml, /data-session-pin="desktop:s1"/);
  assert.doesNotMatch(sessionHtml, /session-advanced-inspector/);
  assert.doesNotMatch(sessionHtml, /session-efficiency/);
  assert.doesNotMatch(sessionHtml, /cache-eff-panel/);
  assert.doesNotMatch(sessionHtml, /model-breakdown/);
  assert.doesNotMatch(sessionHtml, /request-list/);
  assert.doesNotMatch(sessionHtml, /data-session-action="copy-markdown"/);
  assert.doesNotMatch(sessionHtml, /data-session-action="copy-requests-json"/);
  assert.doesNotMatch(sessionHtml, /data-session-action="copy-json"/);
  assert.ok(calls.some((call) => call[0] === "dashboard:getSnapshot"));

  assert.equal(typeof listeners.click, "function");
  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        if(selector === "[data-session-action]") return { dataset: { sessionAction: "copy-summary", sessionKey: "desktop:s1" } };
        if(selector === "[data-session-select]") return { dataset: { sessionSelect: "desktop:s2" } };
        return null;
      },
    },
  });
  assert.ok(clipboardWrites.some((text) => text.includes("Build landing")));
  assert.ok(clipboardWrites.some((text) => text.includes("db-only-model")));
  assert.ok(calls.some((call) => call[0] === "dashboard:getSessionRequestsPage" && call[1].sessionId === "s1"));
  assert.notEqual(storage.getItem("selectedSessionId"), "desktop:s2");

  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        return selector === "[data-session-pin]" ? { dataset: { sessionPin: "desktop:s1" } } : null;
      },
    },
  });
  assert.equal(storage.getItem("pinnedSessionKeys"), "desktop:s1");
  assert.match(elements.get("app").innerHTML, /pinned-state/);

  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        return selector === "[data-session-action]" ? { dataset: { sessionAction: "rename", sessionKey: "desktop:s1" } } : null;
      },
    },
  });
  assert.match(elements.get("app").innerHTML, /rename-sheet/);
  assert.match(elements.get("app").innerHTML, /data-rename-input/);

  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        return selector === "[data-rename-cancel]" ? { dataset: { renameCancel: "1" } } : null;
      },
    },
  });
  assert.doesNotMatch(elements.get("app").innerHTML, /rename-sheet/);

  const invokeBeforeExportFailure = ipcRenderer.invoke;
  ipcRenderer.invoke = async (channel, ...args) => {
    if(channel === "dashboard:exportSession") throw new Error("disk full");
    return invokeBeforeExportFailure(channel, ...args);
  };
  await vm.runInContext(`(() => {
    exportDialog = { items: [snapshot.sessions[0]], format: 'json', bulk: false };
    return confirmExportSheet();
  })()`, context);
  assert.equal(vm.runInContext("exportDialog", context), null);
  assert.equal(elements.get("refreshState").textContent, "disk full");
  ipcRenderer.invoke = invokeBeforeExportFailure;

  ipcRenderer.invoke = async (channel, ...args) => {
    if(channel === "dashboard:exportSession") return { ok: false, code: "SESSION_EXPORT_NOT_FOUND", message: "会话已被删除，请刷新会话列表后重试", retryable: false };
    return invokeBeforeExportFailure(channel, ...args);
  };
  await vm.runInContext(`(() => {
    exportDialog = { items: [snapshot.sessions[0]], format: 'json', bulk: false };
    return confirmExportSheet();
  })()`, context);
  assert.equal(elements.get("refreshState").textContent, "会话已被删除，请刷新会话列表后重试");
  ipcRenderer.invoke = invokeBeforeExportFailure;

  const simpleHtml = elements.get("app").innerHTML;
  assert.doesNotMatch(simpleHtml, /session-advanced-shell/);
  assert.doesNotMatch(simpleHtml, /session-saved-views/);
  assert.doesNotMatch(simpleHtml, /session-project-select/);
  assert.doesNotMatch(simpleHtml, /session-tag-select/);
  assert.match(simpleHtml, /session-bulk simple/);
  assert.doesNotMatch(simpleHtml, /session-smart-views/);
  assert.doesNotMatch(simpleHtml, /data-session-smart-view="cacheWaste"/);
  assert.doesNotMatch(simpleHtml, /session-project-rail/);
  assert.doesNotMatch(simpleHtml, /session-cache-opportunities/);
  assert.doesNotMatch(simpleHtml, /cache-governance/);
  assert.doesNotMatch(simpleHtml, /data-session-cache-governance="focus"/);
  assert.doesNotMatch(simpleHtml, /value="opportunity"/);
  assert.match(simpleHtml, /session-essential-inspector/);
  assert.doesNotMatch(simpleHtml, /session-advanced-inspector/);
  assert.doesNotMatch(simpleHtml, /session-efficiency/);
  assert.doesNotMatch(simpleHtml, /cache-eff-panel/);
  assert.doesNotMatch(simpleHtml, /model-breakdown/);
  assert.doesNotMatch(simpleHtml, /request-list/);
  assert.doesNotMatch(simpleHtml, /data-session-action="copy-markdown"/);

  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        return selector === "[data-session-reset-filters]" ? { dataset: { sessionResetFilters: "1" } } : null;
      },
    },
  });
  assert.equal(storage.getItem("sessionQuickFilter"), "all");
  assert.equal(storage.getItem("sessionProjectFilter"), "all");
  assert.equal(storage.getItem("sessionStatusFilter"), "active");
  assert.equal(storage.getItem("sessionTagFilter"), "all");
  assert.equal(storage.getItem("sessionSort"), "updated");
  assert.equal(storage.getItem("statsSessionQuery"), "");

  assert.equal(typeof listeners.input, "function");
  await listeners.input({
    target: {
      value: "\u5ba2\u6237A",
      closest(selector){
        return selector === "[data-saved-session-name]" ? { value: "\u5ba2\u6237A" } : null;
      },
    },
  });
  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        return selector === "[data-saved-session-save]" ? { dataset: { savedSessionSave: "1" } } : null;
      },
    },
  });
  let savedViews = JSON.parse(storage.getItem("savedSessionViews") || "[]");
  assert.equal(savedViews.length, 1);
  assert.equal(savedViews[0].name, "\u5ba2\u6237A");
  assert.match(elements.get("app").innerHTML, /saved-view-row/);

  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        return selector === "[data-session-smart-view]" ? { dataset: { sessionSmartView: "cacheWaste" } } : null;
      },
    },
  });
  assert.equal(storage.getItem("sessionQuickFilter"), "cacheLow");
  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        return selector === "[data-saved-session-apply]" ? { dataset: { savedSessionApply: savedViews[0].id } } : null;
      },
    },
  });
  assert.equal(storage.getItem("sessionQuickFilter"), "all");

  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        return selector === "[data-saved-session-delete]" ? { dataset: { savedSessionDelete: savedViews[0].id } } : null;
      },
    },
  });
  savedViews = JSON.parse(storage.getItem("savedSessionViews") || "[]");
  assert.equal(savedViews.length, 0);

  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        return selector === "[data-workspace]" ? { dataset: { workspace: "analytics" } } : null;
      },
    },
  });
  const analyticsHtml = elements.get("app").innerHTML;
  assert.match(analyticsHtml, /usage-total-board/);
  assert.match(analyticsHtml, /usage-total-hero/);
  assert.match(analyticsHtml, /usage-total-strip/);
  assert.match(analyticsHtml, /usage-total-cache/);
  assert.match(analyticsHtml, /usage-total-request-spark/);
  assert.doesNotMatch(analyticsHtml, /global-cache-pill/);
  assert.doesNotMatch(analyticsHtml, /data-global-cache-action/);
  assert.doesNotMatch(analyticsHtml, /diagnostics-notice/);
  const diagnosticsHtml = context.renderDiagnosticsNotice({ ...snapshot, sourceErrors: [{ source: "cli", message: "missing db" }], health: { issues: [{ level: "warning", message: "TTFT high" }] } });
  assert.match(diagnosticsHtml, /diagnostics-notice/);
  assert.match(diagnosticsHtml, /data-copy-diagnostics/);
  assert.match(diagnosticsHtml, /missing db/);
  const perfPanelHtml = context.perfPanelHtml();
  assert.match(perfPanelHtml, /渲染性能/);
  assert.match(perfPanelHtml, /数据层/);
  assert.match(perfPanelHtml, /聚合缓存/);
  assert.match(perfPanelHtml, /冷聚合/);
  assert.match(perfPanelHtml, /rollup/);
  assert.match(perfPanelHtml, /resize/);
  assert.match(perfPanelHtml, /data-copy-perf-report/);
  await context.copyPerformanceReport();
  const perfReport = JSON.parse(clipboardWrites[clipboardWrites.length - 1]);
  assert.equal(perfReport.report, "dashboard-performance");
  assert.equal(perfReport.dataLayer.aggregateCache.hits, 2);
  assert.equal(perfReport.dataLayer.usageRollup.compactHits, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(perfReport.snapshot.sources[0] || {}, "dbPath"), false);
  assert.match(analyticsHtml, /cache-warm/);
  assert.match(analyticsHtml, /--cache-hit:/);
  assert.match(analyticsHtml, /1,100 \/ 2,300/);
  assert.match(analyticsHtml, /48%/);
  // Regression: cache hit rate must be cacheRead / (input + cacheRead),
  // not cacheRead / (cacheRead + cacheWrite). When cacheWrite is 0 this must not show 100%.
  assert.equal(context.cacheHitText({ input: 842000, output: 26000, cacheRead: 509000, cacheWrite: 0 }), "38%");
  assert.equal(context.cacheHitBasis({ input: 842000, output: 26000, cacheRead: 509000, cacheWrite: 0 }), "50.9\u4e07 / 135.1\u4e07");
  assert.equal(context.cacheHitText({ input: 100, output: 10, cacheRead: 100, cacheWrite: 100 }), "50%");
  assert.equal(context.cacheHitBasis({ input: 100, output: 10, cacheRead: 100, cacheWrite: 100 }), "100 / 200");
  assert.match(analyticsHtml, /agent-rhythm-card/);
  assert.match(analyticsHtml, /agent-rhythm-rail/);
  assert.match(analyticsHtml, /agent-rhythm-lists/);
  assert.match(analyticsHtml, /rhythm-hero/);
  assert.match(analyticsHtml, /Agent \u7a7a\u95f2/);
  assert.match(analyticsHtml, /analytics-advanced-shell collapsed/);
  assert.doesNotMatch(analyticsHtml, /cache-insights/);
  assert.doesNotMatch(analyticsHtml, /cache-insight-panel/);
  assert.doesNotMatch(analyticsHtml, /chart-snapshot/);
  assert.doesNotMatch(analyticsHtml, /chart-underbar/);
  assert.doesNotMatch(analyticsHtml, /chart-hover-scrubber/);
  assert.doesNotMatch(analyticsHtml, /chart-underbar-minimal/);
  assert.doesNotMatch(analyticsHtml, /chart-legend/);
  assert.doesNotMatch(analyticsHtml, /legend-item active/);
  assert.doesNotMatch(analyticsHtml, /legend-item idle/);
  assert.doesNotMatch(analyticsHtml, /legend-item cache/);
  assert.doesNotMatch(analyticsHtml, /legend-item pinned/);
  assert.doesNotMatch(analyticsHtml, /chart-hover-meta/);
  assert.match(analyticsHtml, /id="usageChart"/);
  assert.match(analyticsHtml, /series-panel/);
  assert.match(analyticsHtml, /app-header/);
  assert.match(analyticsHtml, /analytics-page-head/);
  assert.match(analyticsHtml, /--series-color:/);
  const seriesPanelHtml = analyticsHtml.match(/<div class="series-panel[^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
  assert.match(seriesPanelHtml, /data-series="total"/);
  assert.match(seriesPanelHtml, /data-series="input"/);
  assert.match(seriesPanelHtml, /data-series="output"/);
  assert.match(seriesPanelHtml, /data-series="cacheRead"/);
  assert.doesNotMatch(seriesPanelHtml, /data-series="cacheHitRate"/);
  assert.doesNotMatch(analyticsHtml, /scrubber-cache/);
  assert.doesNotMatch(analyticsHtml, /data-table="sessions"/);
  assert.match(analyticsHtml, /date-range-control/);
  assert.match(analyticsHtml, /data-table-limit="requests"/);
  assert.match(analyticsHtml, /data-request-page-size/);
  assert.match(analyticsHtml, /<option value="10"/);
  assert.match(analyticsHtml, /data-request-page-input/);
  assert.match(analyticsHtml, /data-request-page-go/);
  assert.match(analyticsHtml, /data-date-range-toggle/);
  assert.match(analyticsHtml, /\u65e5\u671f\u8303\u56f4/);
  assert.doesNotMatch(analyticsHtml, /\u73b0\u5728/);
  assert.doesNotMatch(analyticsHtml, /data-date-range-follow/);
  assert.doesNotMatch(analyticsHtml, /data-select="rangeCustom"/);

  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        return selector === "[data-settings]" ? { dataset: { settings: "1" } } : null;
      },
    },
  });
  assert.ok(calls.some((call) => call[0] === "dashboard:settings"));

  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        return selector === "[data-analytics-advanced-toggle]" ? { dataset: { analyticsAdvancedToggle: "1" } } : null;
      },
    },
  });
  assert.equal(storage.getItem("analyticsAdvancedOpen"), "1");
  const analyticsAdvancedHtml = elements.get("app").innerHTML;
  assert.match(analyticsAdvancedHtml, /cache-insights/);
  assert.match(analyticsAdvancedHtml, /cache-insight-panel/);
  assert.match(analyticsAdvancedHtml, /cache-insight-row/);
  assert.match(analyticsAdvancedHtml, /data-cache-model="m2"/);
  assert.match(analyticsAdvancedHtml, /data-cache-project="C:\/work\/beta"/);

  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        return selector === "[data-cache-model]" ? { dataset: { cacheModel: "m2" } } : null;
      },
    },
  });
  assert.equal(storage.getItem("statsModel"), "m2");

  await listeners.click({
    target: {
      dataset: {},
      closest(selector){
        return selector === "[data-cache-project]" ? { dataset: { cacheProject: "C:/work/beta" } } : null;
      },
    },
  });
  assert.equal(storage.getItem("workspaceMode"), "sessions");
  assert.equal(storage.getItem("sessionProjectFilter"), "C:/work/beta");
  assert.equal(storage.getItem("sessionQuickFilter"), "cacheLow");

  vm.runInContext(`
    rangeFilter = 'customTime';
    sourceFilter = 'all';
    modelFilter = 'all';
    customDateStart = ${now - 2 * 86400000};
    customDateEnd = ${now - 86400000};
    dashboardScopeTimestamp = ${now};
    snapshot = {
      ...snapshot,
      summaryOnly: true,
      summaryFilter: { source: 'all', model: 'all', rangeKey: 'customTime', start: ${now - 2 * 86400000 + 1}, end: ${now - 86400000}, endExclusive: ${now - 86400000} },
      usage: { ...snapshot.usage, all: { total: 999999 } }
    };
    globalThis.__wrongCustomSummary = summaryOnlyUsageForView(snapshot);
  `, context);
  assert.equal(context.__wrongCustomSummary, null, "customTime summary must match exact start/end bounds");

  const timestampBeforeStaleRefresh = vm.runInContext("Number(snapshot.timestamp || 0)", context);
  let resolveDelayedRefresh;
  const originalInvoke = ipcRenderer.invoke;
  ipcRenderer.invoke = async (channel, ...args) => {
    if(channel === "dashboard:refreshLight") return new Promise((resolve) => { resolveDelayedRefresh = resolve; });
    return originalInvoke(channel, ...args);
  };
  const staleRefresh = vm.runInContext("refreshNow()", context);
  await new Promise((resolve) => setImmediate(resolve));
  vm.runInContext("rangeFilter = '30d'; beginDashboardRequestGeneration();", context);
  resolveDelayedRefresh({ ...snapshot, timestamp: now + 60000, lightRefresh: true });
  await staleRefresh;
  assert.equal(vm.runInContext("Number(snapshot.timestamp || 0)", context), timestampBeforeStaleRefresh, "a response from an older filter generation must not commit");
  ipcRenderer.invoke = originalInvoke;
  console.log("ok - dashboard renderer smoke");
}

main().catch((error) => { console.error(error); process.exit(1); });


