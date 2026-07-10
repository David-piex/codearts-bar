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
assert.match(extensionSource, /getSnapshotWithCache/);
assert.match(htmlSource, /Content-Security-Policy/);
assert.match(dashboardSource, /retainContextWhenHidden/);
assert.match(dashboardSource, /require\("\.\/webview\/model"\)/);
assert.match(clientSource, /vscode\.getState\(\)/);
assert.match(clientSource, /vscode\.setState/);
assert.match(chartSource, /requestAnimationFrame/);
assert.match(viewsSource, /CodeArtsViews/);
assert.doesNotMatch(
  clientSource,
  /innerHTML\s*=\s*[^;]*snapshot\./,
  "snapshot values must be escaped before HTML insertion",
);
assert.match(tokenCss, /--vscode-/);
assert.match(tokenCss, /SF Pro/);
assert.match(
  foundationCss,
  /\[hidden\]\s*\{\s*display:\s*none\s*!important/,
  "hidden webview states must override component display rules",
);
assert.match(componentCss, /backdrop-filter/);
assert.match(responsiveCss, /prefers-reduced-motion/);
assert.match(responsiveCss, /body\[data-mode="sidebar"\]/);

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
  status: { label: "12%" },
  config: { windowHours: 24 },
  usage: {
    today: { total: 1234, messages: 2, cacheHitRate: 50 },
    window: {},
    week: {},
    all: {},
  },
  trends: { hourly24h: [{ start: 1, total: 1234 }], daily14d: [] },
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
assert.equal(view.usage.today.total, 1234);
assert.equal(view.models[0].name, "GLM");
assert.equal(view.sources[0].label, "桌面端");
assert.equal(view.sessions.length, 1);
assert.equal(
  Object.prototype.hasOwnProperty.call(view.sources[0], "dbPath"),
  false,
  "webview payload must not expose local DB paths",
);

console.log("ok - extension webview smoke");
