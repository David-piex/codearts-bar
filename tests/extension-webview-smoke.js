"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const extensionDir = path.join(root, "extension");
const pkg = JSON.parse(
  fs
    .readFileSync(path.join(extensionDir, "package.json"), "utf8")
    .replace(/^\uFEFF/, ""),
);
const extensionSource = fs.readFileSync(
  path.join(extensionDir, "extension.js"),
  "utf8",
);
const dashboardSource = fs.readFileSync(
  path.join(extensionDir, "dashboard.js"),
  "utf8",
);
const sessionExportSource = fs.readFileSync(
  path.join(extensionDir, "session-export.js"),
  "utf8",
);
const modelSource = fs.readFileSync(
  path.join(extensionDir, "webview", "model.js"),
  "utf8",
);
const htmlSource = fs.readFileSync(
  path.join(extensionDir, "webview", "html.js"),
  "utf8",
);
const clientSource = fs.readFileSync(
  path.join(extensionDir, "media", "scripts", "dashboard.js"),
  "utf8",
);
const chartAxisSource = fs.readFileSync(
  path.join(extensionDir, "media", "scripts", "chart-axis.js"),
  "utf8",
);
const chartSource = fs.readFileSync(
  path.join(extensionDir, "media", "scripts", "chart.js"),
  "utf8",
);
const viewsSource = fs.readFileSync(
  path.join(extensionDir, "media", "scripts", "views.js"),
  "utf8",
);
const tokenCss = fs.readFileSync(
  path.join(extensionDir, "media", "styles", "tokens.css"),
  "utf8",
);
const foundationCss = fs.readFileSync(
  path.join(extensionDir, "media", "styles", "foundation.css"),
  "utf8",
);
const componentCss = fs.readFileSync(
  path.join(extensionDir, "media", "styles", "components.css"),
  "utf8",
);
const responsiveCss = fs.readFileSync(
  path.join(extensionDir, "media", "styles", "responsive.css"),
  "utf8",
);

assert.ok(pkg.activationEvents.includes("onView:codeartsBar.overview"));
assert.equal(pkg.contributes.viewsContainers.activitybar[0].id, "codeartsBar");
assert.equal(pkg.contributes.views.codeartsBar[0].type, "webview");
assert.equal(pkg.contributes.views.codeartsBar[0].id, "codeartsBar.overview");
const uiFiles = [
  "dashboard.js",
  "webview/html.js",
  "webview/model.js",
  "media/codearts.svg",
  "media/styles/tokens.css",
  "media/styles/foundation.css",
  "media/styles/components.css",
  "media/styles/responsive.css",
  "media/scripts/format.js",
  "media/scripts/chart-axis.js",
  "media/scripts/chart.js",
  "media/scripts/views.js",
  "media/scripts/dashboard.js",
];
for (const file of uiFiles) {
  assert.ok(
    pkg.files.includes(file),
    `extension whitelist should contain ${file}`,
  );
  assert.ok(
    fs.existsSync(path.join(extensionDir, file)),
    `extension resource should exist: ${file}`,
  );
}
assert.equal(
  pkg.files.includes("media/dashboard.css"),
  false,
  "legacy monolithic CSS should be removed",
);
assert.equal(
  pkg.files.includes("media/dashboard.js"),
  false,
  "legacy monolithic client should be removed",
);

for (const command of [
  "codeartsBar.openDashboard",
  "codeartsBar.openOverview",
  "codeartsBar.refresh",
  "codeartsBar.openDataFolder",
]) {
  assert.ok(
    pkg.contributes.commands.some((item) => item.command === command),
    `missing command ${command}`,
  );
}
assert.match(
  extensionSource,
  /registerWebviewViewProvider\([\s\S]*?"codeartsBar\.overview"/,
);
assert.match(
  extensionSource,
  /statusItem\.command = "codeartsBar\.openOverview"/,
);
assert.doesNotMatch(extensionSource, /getSnapshotWithCache/);
assert.match(extensionSource, /getExtensionSummary/);
assert.match(extensionSource, /getExtensionDetails/);
assert.match(extensionSource, /hasTargets/);
assert.match(htmlSource, /Content-Security-Policy/);
assert.match(dashboardSource, /retainContextWhenHidden/);
assert.match(dashboardSource, /postDetails/);
assert.doesNotMatch(dashboardSource, /\bbroadcast\s*\(/, "unscoped summary broadcasts must not bypass target generations");
assert.match(dashboardSource, /webview-ready/);
assert.match(dashboardSource, /message\?\.type === "range"/);
assert.match(dashboardSource, /message\?\.type === "sessionsPage"/);
assert.match(dashboardSource, /message\?\.type === "exportSession"/);
assert.match(extensionSource, /async function querySessionsPage\(options = \{\}\)/);
assert.match(extensionSource, /async function exportSession\(session, format = "json"\)/);
assert.match(extensionSource, /exportSessionWithPrivacy/);
assert.match(sessionExportSource, /showQuickPick/);
assert.match(sessionExportSource, /canPickMany:\s*true/);
assert.match(clientSource, /type: "sessionsPage"/);
assert.match(clientSource, /type: "exportSession"/);
for (const format of ['xlsx', 'md', 'json']) assert.match(viewsSource, new RegExp(`data-session-export="${format}"`));
assert.match(dashboardSource, /onDidChangeVisibility/, "sidebar visibility must control heavy detail aggregation");
assert.match(dashboardSource, /onDidChangeViewState/, "panel visibility must control heavy detail aggregation");
assert.match(dashboardSource, /some\(\(target\) => target\.visible\)/, "hidden retained webviews must not keep detail refresh active");
assert.match(extensionSource, /Math\.max\(configured, 300000\)/, "hidden VS Code webviews must reduce summary polling to at least five minutes");
assert.match(dashboardSource, /if \(!target\.visible\) target\.generation \+= 1/, "hiding a VS Code target must invalidate its in-flight detail generation");
assert.match(dashboardSource, /!target\?\.visible \|\| !this\.targets\.has\(target\) \|\| target\.generation !== generation/, "detail payloads must only target the current visible webview generation");
assert.match(dashboardSource, /visibleTargets\(\)/, "details must be scheduled per visible webview");
assert.match(dashboardSource, /target\.generation === request\.generation/, "stale detail requests must not commit");
assert.doesNotMatch(extensionSource, /dashboardHost\?\.broadcast\(lastSnapshot\)/, "summary refresh must not trigger an intermediate full render");
assert.match(extensionSource, /formatCacheRate/, "status tooltip must expose cache-hit semantics");
assert.match(extensionSource, /enabledCommands:\s*\[/, "trusted status tooltip links must use an explicit command allowlist");
assert.doesNotMatch(extensionSource, /md\.isTrusted\s*=\s*true/, "status tooltip must not trust arbitrary command links");
assert.match(extensionSource, /capabilities\?\.performance !== false/, "unsupported performance fields must stay out of the status tooltip");
assert.match(extensionSource, /capabilities\?\.queue !== false/, "unsupported queue fields must stay out of the status tooltip");
assert.match(dashboardSource, /require\("\.\/webview\/model"\)/);
assert.match(dashboardSource, /safeIdeText\(error\?\.message/, "VS Code operation failures must use the IDE-safe summary boundary");
assert.match(clientSource, /vscode\.getState\(\)/);
assert.match(clientSource, /vscode\.setState/);
assert.match(clientSource, /message\.type === "snapshot" \|\| message\.type === "details"/);
assert.match(clientSource, /generation <= 0 \|\| generation < latestGeneration/, "data payloads must always carry a current positive generation");
assert.match(chartSource, /requestAnimationFrame/);
assert.match(chartSource, /staticCanvas/, "chart hover should reuse a cached static pixel layer");
assert.match(chartSource, /drawImage\(state\.staticCanvas/, "chart hover should blit the cached layer before drawing interaction chrome");
assert.match(chartAxisSource, /niceChartScale|niceChartScale:/);
assert.match(chartSource, /CodeArtsChartAxis/);
assert.match(chartSource, /yAxisTicks/);
assert.match(chartSource, /pointermove/);
assert.match(chartSource, /data-chart-tooltip|chart-tooltip/);
assert.match(chartSource, /zeroState/);
assert.match(chartSource, /compactAxisValue/);
assert.match(chartSource, /Token/);
assert.match(chartSource, /path\("cacheRead"\)/, "trend chart must draw cache-read tokens");
assert.match(chartSource, /\u7f13\u5b58\u8bfb\u53d6/, "trend tooltip must disclose cache-read tokens");
assert.match(htmlSource, /\\u7f13\\u5b58\\u8bfb\\u53d6/, "trend legend must include cache read");
assert.match(viewsSource, /CodeArtsViews/);
assert.doesNotMatch(
  clientSource,
  /innerHTML\s*=\s*[^;]*snapshot\./,
  "snapshot values must be escaped before HTML insertion",
);
assert.doesNotMatch(tokenCss, /--vscode-/, "webview palette must stay aligned with Desktop instead of inheriting the editor theme");
assert.match(tokenCss, /color-scheme:\s*light/);
assert.match(tokenCss, /--page:\s*#f5f6f8/);
assert.match(tokenCss, /--accent:\s*#0a84ff/);
assert.match(tokenCss, /SF Pro/);
assert.match(
  foundationCss,
  /\[hidden\]\s*\{\s*display:\s*none\s*!important/,
  "hidden webview states must override component display rules",
);
assert.match(
  componentCss,
  /\.surface,\s*\r?\n\.metric-card,\s*\r?\n\.state-card\s*\{[\s\S]*?background:\s*var\(--surface-solid\)/,
  "full analysis should use quiet opaque work surfaces",
);
assert.match(responsiveCss, /prefers-reduced-motion/);
assert.match(responsiveCss, /body\[data-mode="sidebar"\]/);
for (const id of ["latencyAvg", "latencyP95", "performanceErrors", "providerCount", "dataAdapter", "dataSources", "dataRequests", "dataSessions", "dbSize", "performanceComplete", "diagnosticDetail"]) assert.match(htmlSource, new RegExp(`id="${id}"`), `missing performance or data-health field ${id}`);
assert.ok((htmlSource.match(/\\u5f53\\u524d\\u8303\\u56f4/g) || []).length >= 2, "model, source and request sections must disclose the selected scope");
for (const id of ["sourceFilter", "modelFilter", "projectFilter", "metricInput", "metricOutput", "metricCacheWrite", "metricCacheRead", "requests", "providers", "requestPrevious", "requestNext"]) assert.match(htmlSource, new RegExp(`id="${id}"`), `missing full-analysis control ${id}`);
assert.match(htmlSource, /Desktop/, "unsupported VS Code session writes must be explained instead of exposing broken controls");
assert.match(clientSource, /type: "filter"/);
assert.match(clientSource, /type: "requestsPage"/);
assert.match(clientSource, /project: projectFilter/);
assert.match(viewsSource, /function requests\(snapshot\)/);
assert.match(viewsSource, /snapshot\.requestTotal/);
const { viewModel: directViewModel } = require('../extension/webview/model');
const counted = directViewModel({ ok: true, requests: [{ id: 'one' }], requestTotal: 41, sessions: [{ id: 'session-one' }], sessionTotal: 12, sessionTotalExact: true });
assert.equal(counted.requestTotal, 41);
assert.equal(counted.sessionTotal, 12);
assert.match(responsiveCss, /\.request-surface \{ display:none; \}/, "sidebar must not render the full request workbench");
for (const range of ["today", "window", "week", "14d", "30d", "all", "custom"]) assert.match(htmlSource, new RegExp(`data-range="${range}"`), `missing range option ${range}`);
assert.doesNotMatch(htmlSource, /<select/, "native selects must not leak platform menus into the macOS-style workbench");
for (const menu of ["range", "source", "model"]) assert.match(htmlSource, new RegExp(`data-menu-toggle="${menu}"`), `missing controlled ${menu} menu`);
assert.match(clientSource, /function setMenuOpen\(name, next\)/);
assert.match(clientSource, /event\.key === "Escape"/);
assert.match(clientSource, /generation < latestGeneration/, "webview must ignore stale detail messages");
assert.match(clientSource, /customDraftDirty/, "realtime refresh must preserve active custom date input");
assert.match(clientSource, /if \(!databasePagesLoaded\) \{[\s\S]*?views\.sessions\(snapshot\);[\s\S]*?views\.requests\(snapshot\);[\s\S]*?\}/, "detail refreshes must not replace database-backed pages with snapshot samples");
assert.match(clientSource, /sessionPage, requestPage, selectedRequestId/, "persisted state must include both pages and the selected request");
assert.match(clientSource, /sessionSearch: element\("#sessionSearch"\)/, "persisted state must include the session search");
assert.match(clientSource, /scrollTop: Number\(document\.scrollingElement\?\.scrollTop/, "persisted state must include scroll position");
assert.match(clientSource, /function dataRangeText\(\)/, "unapplied custom date drafts must not relabel committed data");
assert.match(foundationCss, /\.control-menu\s*\{[\s\S]*?position:\s*absolute/, "controlled menus must overlay instead of resizing the workbench");
assert.match(htmlSource, /id="rangeStart" type="text" inputmode="numeric"/);
assert.match(htmlSource, /data-date-focus="rangeStart"/);
assert.match(clientSource, /type: "range"/);
assert.match(clientSource, /rangeEnd/);
assert.match(clientSource, /366 \* 86400000/);
assert.match(responsiveCss, /\.range-menu-control \{ display: block/);
assert.match(viewsSource, /\\u5f53\\u524d\\u8303\\u56f4\\u65e0\\u8bf7\\u6c42/, "empty current range must disclose the seven-day cache fallback");
assert.match(viewsSource, /cacheRate !== null && cacheRate !== undefined/, "zero and missing cache rates must remain distinct");
assert.match(clientSource, /function zeroTrendRows\(\)/, "empty real ranges must synthesize zero buckets so axes remain visible");
assert.match(clientSource, /rows\.length \? rows : zeroTrendRows\(\)/, "empty trend ranges must use the zero-axis fallback");
assert.match(viewsSource, /sourceErrors/);

const dashboardModule = { exports: {} };
const dashboardFakeVscode = {
  Uri: { joinPath: (...parts) => parts.map((part) => String(part)).join("/") },
  ViewColumn: { One: 1 },
  window: {},
  commands: {},
};
vm.runInNewContext(
  dashboardSource,
  {
    require: (name) => {
      if (name === "vscode") return dashboardFakeVscode;
      if (name === "./webview/html") return { dashboardHtml: () => "" };
      if (name === "./webview/model") return { viewModel: (value) => value };
      if (name === "./protocol/query-results") return require("../src/protocol/query-results");
      return require(name);
    },
    module: dashboardModule,
    exports: dashboardModule.exports,
    console,
    Set,
  },
  { filename: "dashboard.js" },
);
const { DashboardHost } = dashboardModule.exports;
const posted = [];
const webview = {
  options: {},
  html: "",
  asWebviewUri: (value) => value,
  onDidReceiveMessage(handler) { this.receive = handler; },
  postMessage(message) { posted.push(message); },
};
const detailCalls = [];
const host = new DashboardHost(
  { extensionUri: "extension" },
  () => ({ ok: true, summaryOnly: true }),
  () => undefined,
  (options) => detailCalls.push(options),
  () => undefined,
);
const target = host.attach(webview, "dashboard");
host.handleMessage({
  type: "ready",
  state: { range: "custom", customStart: 10, customEnd: 20, sourceFilter: "cli", modelFilter: "gpt-5" },
}, target);
assert.equal(detailCalls.length, 1);
assert.equal(detailCalls[0].rangePreset, "custom");
assert.equal(detailCalls[0].range.start, 10);
assert.equal(detailCalls[0].range.end, 20);
assert.equal(posted.length, 0, "summary-only startup payload must stay behind the loading surface");

const oldRequest = host.beginDetails({ target, rangePreset: "week" })[0];
const newRequest = host.beginDetails({ target, rangePreset: "30d", source: "desktop" })[0];
assert.equal(host.commitDetails(oldRequest, { ok: true, marker: "old" }), false, "old generation must not commit");
assert.equal(host.commitDetails(newRequest, { ok: true, marker: "new" }), true, "latest generation should commit");
assert.equal(target.snapshot.marker, "new");
assert.equal(posted.filter((message) => message.type === "details").length, 1, "only one committed payload should render");
assert.equal(posted.find((message) => message.type === "details").generation, newRequest.generation);
assert.equal(posted.at(-1).type, "refreshing");
assert.equal(posted.at(-1).value, false);
assert.equal(posted.at(-1).generation, newRequest.generation);

const postedSecond = [];
const secondWebview = {
  options: {},
  html: "",
  asWebviewUri: (value) => value,
  onDidReceiveMessage(handler) { this.receive = handler; },
  postMessage(message) { postedSecond.push(message); },
};
const secondTarget = host.attach(secondWebview, "sidebar");
host.beginDetails({ target: secondTarget, rangePreset: "week", source: "cli", model: "gpt-5" });
const refreshRequests = host.beginDetails();
assert.equal(refreshRequests.length, 2, "background refresh should retain both visible webview scopes");
const firstRefresh = refreshRequests.find((request) => request.target === target);
const secondRefresh = refreshRequests.find((request) => request.target === secondTarget);
assert.equal(firstRefresh.scope.rangePreset, "30d");
assert.equal(firstRefresh.scope.source, "desktop");
assert.equal(secondRefresh.scope.rangePreset, "week");
assert.equal(secondRefresh.scope.source, "cli");
host.commitDetails(firstRefresh, { ok: true, marker: "panel-30d" });
host.commitDetails(secondRefresh, { ok: true, marker: "sidebar-week" });
assert.equal(posted.findLast((message) => message.type === "details").payload.marker, "panel-30d");
assert.equal(postedSecond.findLast((message) => message.type === "details").payload.marker, "sidebar-week");

const fakeVscode = {
  Uri: { joinPath: (...parts) => parts.map((part) => String(part)).join("/") },
  ViewColumn: { One: 1 },
  window: {},
  commands: {},
};
const moduleValue = { exports: {} };
vm.runInNewContext(
  modelSource,
  {
    require: (name) => name === "vscode"
      ? fakeVscode
      : name === "../protocol/query-results"
        ? require("../src/protocol/query-results")
        : require(name),
    module: moduleValue,
    exports: moduleValue.exports,
    __dirname: path.join(extensionDir, "webview"),
    console,
    Date,
    Math,
    Set,
  },
  { filename: "model.js" },
);
const { viewModel } = moduleValue.exports;
const view = viewModel({
  ok: true,
  timestamp: 1,
  updatedAt: "now",
  adapter: "node:sqlite",
  capabilities: { performance: false, queue: false },
  status: { label: "12%" },
  config: { windowHours: 24 },
  usage: {
    today: { total: 1234, messages: 2, cacheHitRate: 50 },
    window: {},
    week: {},
    all: {},
    range: { total: 1234, messages: 2, cacheHitRate: 50 },
  },
  trends: { hourly24h: [{ start: 1, total: 1234 }], daily14d: [] },
  selectedRange: { preset: "week", start: 1, end: 2, bucketMs: 86400000 },
  models: [{ model: "GLM", total: 1234 }],
  sourceStats: [{ source: "desktop", sourceLabel: "桌面端", total: 1234 }],
  sessions: [
    { id: "s", title: "会话", archived: false, usage: { total: 1234 } },
  ],
  performance: { window: {} },
  queue: { window: {} },
  tools: { window: { byName: [] } },
  completeness: { complete: false, sampled: false, reasons: ["source-read-failed"], sources: { expected: 2, read: 1, failed: 1, missing: 0 }, metrics: { latency: true } },
});
assert.equal(view.ok, true);
assert.equal(view.capabilities.performance, false);
assert.equal(view.usage.today.total, 1234);
assert.equal(view.usage.today.cacheHitRate, 50);
assert.equal(view.usage.range.total, 1234);
assert.equal(view.selectedRange.preset, "week");
const missingCacheView = viewModel({ ok:true, usage:{ today:{ cacheHitRate:null }, window:{}, week:{ cacheHitRate:45.7 }, all:{} }, trends:{}, models:[], sourceStats:[], sessions:[], capabilities:{}, performance:{window:{}}, queue:{window:{}} });
assert.equal(missingCacheView.usage.today.cacheHitRate, null, "missing cache rate must not collapse to zero");
assert.equal(missingCacheView.usage.week.cacheHitRate, 45.7);
assert.equal(view.models[0].name, "GLM");
assert.equal(view.sources[0].label, "桌面端");
assert.equal(view.sessions.length, 1);
assert.equal(view.completeness.complete, false);
assert.deepEqual(view.completeness.reasons, ["source-read-failed"]);
assert.equal(view.completeness.sources.failed, 1);
assert.equal(
  Object.prototype.hasOwnProperty.call(view.sources[0], "dbPath"),
  false,
  "webview payload must not expose local DB paths",
);

assert.match(extensionSource, /async function deactivate/);
assert.match(extensionSource, /closeSqlJsWorker/);
assert.match(extensionSource, /closeSettingsStore/);
assert.equal((extensionSource.match(/context\.subscriptions\.push\(\{ dispose:/g) || []).length, 1, "refresh rescheduling should not accumulate disposables");

const { exportSessionWithPrivacy } = require("../extension/session-export");

function exportHarness({ choose, saveUri }) {
  const calls = { quickPick: [], save: [], export: [], info: [] };
  const vscode = {
    Uri: { file: (value) => ({ fsPath: value }) },
    window: {
      async showQuickPick(items, options) {
        calls.quickPick.push({ items, options });
        return choose(items);
      },
      async showSaveDialog(options) {
        calls.save.push(options);
        return saveUri;
      },
      showInformationMessage(message) { calls.info.push(message); },
    },
  };
  const localProvider = {
    safeFileStem: (value) => `safe-${value}`,
    async exportSessionToFile(options) {
      calls.export.push(options);
      return { path: options.outputPath, format: options.format, bytes: 321 };
    },
  };
  return { calls, vscode, localProvider };
}

(async () => {
  const defaults = exportHarness({
    choose: (items) => items.filter((item) => item.picked),
    saveUri: { fsPath: "C:\\exports\\session.xlsx" },
  });
  const defaultResult = await exportSessionWithPrivacy({
    vscode: defaults.vscode,
    localProvider: defaults.localProvider,
    providerOptions: { dbPath: "fixture.db", useSavedSettings: false },
    session: { id: "session-1", title: "demo", source: "desktop" },
    format: "xlsx",
  });
  assert.equal(defaultResult.ok, true);
  assert.equal(defaults.calls.quickPick.length, 1);
  assert.equal(defaults.calls.quickPick[0].options.canPickMany, true);
  assert.match(defaults.calls.quickPick[0].options.placeHolder, /\u51ed\u636e\u59cb\u7ec8\u8131\u654f/);
  assert.deepEqual(
    defaults.calls.quickPick[0].items.map((item) => [item.privacyKey, item.picked]),
    [
      ["includeContent", true],
      ["redactPaths", true],
      ["includeToolIO", false],
      ["includeReasoning", false],
      ["includeErrors", true],
    ],
  );
  assert.equal(
    defaults.calls.quickPick[0].items.some((item) => /credential|secret|\u51ed\u636e|\u5bc6\u94a5/i.test(item.privacyKey)),
    false,
    "credential redaction must not have a disable option",
  );
  assert.deepEqual(defaults.calls.export, [{
    dbPath: "fixture.db",
    useSavedSettings: false,
    sessionId: "session-1",
    source: "desktop",
    format: "xlsx",
    outputPath: "C:\\exports\\session.xlsx",
    includeContent: true,
    includeReasoning: false,
    includeToolIO: false,
    redactPaths: true,
    includeErrors: true,
  }]);
  assert.equal(defaults.calls.info.length, 1);

  const custom = exportHarness({
    choose: (items) => items.filter((item) => ["includeReasoning", "includeToolIO"].includes(item.privacyKey)),
    saveUri: { fsPath: "C:\\exports\\session.md" },
  });
  await exportSessionWithPrivacy({
    vscode: custom.vscode,
    localProvider: custom.localProvider,
    session: { id: "session-2", source: "cli" },
    format: "md",
  });
  assert.deepEqual(
    {
      includeContent: custom.calls.export[0].includeContent,
      includeReasoning: custom.calls.export[0].includeReasoning,
      includeToolIO: custom.calls.export[0].includeToolIO,
      redactPaths: custom.calls.export[0].redactPaths,
      includeErrors: custom.calls.export[0].includeErrors,
    },
    { includeContent: false, includeReasoning: true, includeToolIO: true, redactPaths: false, includeErrors: false },
  );

  const privacyCanceled = exportHarness({ choose: () => undefined, saveUri: { fsPath: "unused.json" } });
  const privacyCanceledResult = await exportSessionWithPrivacy({
    vscode: privacyCanceled.vscode,
    localProvider: privacyCanceled.localProvider,
    session: { id: "session-3" },
    format: "json",
  });
  assert.deepEqual(privacyCanceledResult, { ok: false, canceled: true, stage: "privacy" });
  assert.equal(privacyCanceled.calls.save.length, 0, "privacy cancellation must not open the save dialog");
  assert.equal(privacyCanceled.calls.export.length, 0, "privacy cancellation must not write a file");

  const saveCanceled = exportHarness({
    choose: (items) => items.filter((item) => item.picked),
    saveUri: undefined,
  });
  const saveCanceledResult = await exportSessionWithPrivacy({
    vscode: saveCanceled.vscode,
    localProvider: saveCanceled.localProvider,
    session: { id: "session-4" },
    format: "json",
  });
  assert.deepEqual(saveCanceledResult, { ok: false, canceled: true, stage: "save" });
  assert.equal(saveCanceled.calls.export.length, 0, "save cancellation must not write a file");
  assert.equal(saveCanceled.calls.info.length, 0);

  console.log("ok - extension webview and export privacy smoke");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
