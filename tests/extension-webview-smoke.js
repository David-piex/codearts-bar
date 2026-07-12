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
assert.match(dashboardSource, /broadcastDetails/);
assert.match(dashboardSource, /webview-ready/);
assert.match(dashboardSource, /message\?\.type === "range"/);
assert.match(dashboardSource, /onDidChangeVisibility/, "sidebar visibility must control heavy detail aggregation");
assert.match(dashboardSource, /onDidChangeViewState/, "panel visibility must control heavy detail aggregation");
assert.match(dashboardSource, /some\(\(target\) => target\.visible\)/, "hidden retained webviews must not keep detail refresh active");
assert.match(dashboardSource, /if \(target\.visible\) target\.webview\.postMessage/, "detail payloads must only target visible webviews");
assert.ok((dashboardSource.match(/if \(target\.visible\)/g) || []).length >= 3, "summary, details and refresh messages must skip hidden retained webviews");
assert.match(extensionSource, /formatCacheRate/, "status tooltip must expose cache-hit semantics");
assert.match(extensionSource, /capabilities\?\.performance !== false/, "unsupported performance fields must stay out of the status tooltip");
assert.match(extensionSource, /capabilities\?\.queue !== false/, "unsupported queue fields must stay out of the status tooltip");
assert.match(dashboardSource, /require\("\.\/webview\/model"\)/);
assert.match(clientSource, /vscode\.getState\(\)/);
assert.match(clientSource, /vscode\.setState/);
assert.match(clientSource, /message\.type === "snapshot" \|\| message\.type === "details"/);
assert.match(chartSource, /requestAnimationFrame/);
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
assert.match(tokenCss, /--page:\s*#f7f8fb/);
assert.match(tokenCss, /--accent:\s*#1687f5/);
assert.match(tokenCss, /SF Pro/);
assert.match(
  foundationCss,
  /\[hidden\]\s*\{\s*display:\s*none\s*!important/,
  "hidden webview states must override component display rules",
);
assert.match(componentCss, /backdrop-filter/);
assert.match(responsiveCss, /prefers-reduced-motion/);
assert.match(responsiveCss, /body\[data-mode="sidebar"\]/);
assert.match(htmlSource, /data-performance-only/);
assert.match(htmlSource, /MODEL MIX \/ FILTERED/, "model ranking must follow the selected range");
assert.match(htmlSource, /LOCAL SOURCES \/ FILTERED/, "source distribution must follow the selected range");
for (const range of ["today", "window", "week", "14d", "30d", "all", "custom"]) assert.match(htmlSource, new RegExp(`data-range="${range}"`), `missing range option ${range}`);
assert.match(htmlSource, /type="datetime-local"/);
assert.match(clientSource, /type: "range"/);
assert.match(clientSource, /rangeEnd/);
assert.match(clientSource, /366 \* 86400000/);
assert.match(responsiveCss, /\.range-select \{ display: block/);
assert.match(viewsSource, /capabilities\?\.performance !== false/);
assert.match(viewsSource, /\\u5f53\\u524d\\u8303\\u56f4\\u65e0\\u8bf7\\u6c42/, "empty current range must disclose the seven-day cache fallback");
assert.match(viewsSource, /cacheRate !== null && cacheRate !== undefined/, "zero and missing cache rates must remain distinct");
assert.match(clientSource, /function zeroTrendRows\(\)/, "empty real ranges must synthesize zero buckets so axes remain visible");
assert.match(clientSource, /rows\.length \? rows : zeroTrendRows\(\)/, "empty trend ranges must use the zero-axis fallback");
assert.match(componentCss, /performance-unavailable/);

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
    require: (name) => (name === "vscode" ? fakeVscode : require(name)),
    module: moduleValue,
    exports: moduleValue.exports,
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
assert.equal(
  Object.prototype.hasOwnProperty.call(view.sources[0], "dbPath"),
  false,
  "webview payload must not expose local DB paths",
);

assert.match(extensionSource, /async function deactivate/);
assert.match(extensionSource, /closeSqlJsWorker/);
assert.match(extensionSource, /closeSettingsStore/);
assert.equal((extensionSource.match(/context\.subscriptions\.push\(\{ dispose:/g) || []).length, 1, "refresh rescheduling should not accumulate disposables");
console.log("ok - extension webview smoke");
