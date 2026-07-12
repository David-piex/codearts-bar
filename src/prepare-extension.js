const fs = require("node:fs");
const path = require("node:path");
function readJsonNoBom(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}
function asciiJson(obj) {
  return (
    JSON.stringify(obj, null, 2).replace(
      /[\u007f-\uffff]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    ) + "\n"
  );
}
const root = path.resolve(__dirname, "..");
require(path.join(root, "src", "build-chart-axis.js")).buildChartAxisBrowser();
const srcPkg = readJsonNoBom(path.join(root, "package.json"));
const sourceExtDir = path.join(root, "extension");
const extDir = path.join(root, ".cache", "extension-staging");
fs.rmSync(extDir, { recursive: true, force: true });
fs.cpSync(sourceExtDir, extDir, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
const extPkgPath = path.join(extDir, "package.json");
const extPkg = readJsonNoBom(extPkgPath);
extPkg.version = srcPkg.version;
extPkg.displayName = "\u7801\u9053 \u00b7 \u4f7f\u7528\u5206\u6790";
extPkg.description =
  "\u5728 VS Code / CodeArts Agent \u4e2d\u53ef\u89c6\u5316\u672c\u5730 token \u7528\u91cf\u3001\u8d8b\u52bf\u3001\u6a21\u578b\u3001\u6570\u636e\u6e90\u4e0e\u6700\u8fd1\u4f1a\u8bdd\u3002";
const titles = {
  "codeartsBar.refresh":
    "\u7801\u9053\uff1a\u5237\u65b0\u4f7f\u7528\u6570\u636e",
  "codeartsBar.showDetails":
    "\u7801\u9053\uff1a\u6253\u5f00\u5b8c\u6574\u4f7f\u7528\u5206\u6790",
  "codeartsBar.openDashboard":
    "\u7801\u9053\uff1a\u6253\u5f00\u5b8c\u6574\u4f7f\u7528\u5206\u6790",
  "codeartsBar.openOverview":
    "\u7801\u9053\uff1a\u6253\u5f00\u6982\u89c8\u4fa7\u8fb9\u680f",
  "codeartsBar.openDataFolder":
    "\u7801\u9053\uff1a\u6253\u5f00\u672c\u5730\u6570\u636e\u76ee\u5f55",
};
for (const c of extPkg.contributes.commands || [])
  if (titles[c.command]) c.title = titles[c.command];
extPkg.contributes.configuration.title =
  "\u7801\u9053 \u00b7 \u4f7f\u7528\u5206\u6790";
const props = extPkg.contributes.configuration.properties;
props["codeartsBar.dbPath"].description =
  "CodeArts opencode.db \u8def\u5f84\u3002\u4e3a\u7a7a\u65f6\u4f7f\u7528 ~/.codeartsdoer/codearts-data/opencode.db\u3002";
props["codeartsBar.dailyLimit"].description =
  "\u72b6\u6001\u680f\u767e\u5206\u6bd4\u4f7f\u7528\u7684\u6bcf\u65e5 token \u663e\u793a\u8f6f\u4e0a\u9650\u3002";
props["codeartsBar.windowHours"].description =
  "\u6eda\u52a8\u7a97\u53e3\u7edf\u8ba1\u5c0f\u65f6\u6570\u3002";
props["codeartsBar.refreshMs"].description =
  "\u81ea\u52a8\u5237\u65b0\u95f4\u9694\uff0c\u6beb\u79d2\u3002";
const runtimeFiles = [
  ...fs
    .readdirSync(path.join(root, "src", "core"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js") && entry.name !== "chart-axis.js")
    .map((entry) => `core/${entry.name}`)
    .sort(),
  "health.js",
  "quota.js",
  "extension-data.js",
  "providers/index.js",
  "providers/codeartsLocal.js",
  "providers/codeartsOfficial.js",
  "providers/codeartsDesktop.js",
  ...fs
    .readdirSync(path.join(root, "src", "providers", "codearts"), {
      withFileTypes: true,
    })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => `providers/codearts/${entry.name}`)
    .sort(),
];
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
for (const legacy of ["media/dashboard.css", "media/dashboard.js"])
  extPkg.files = extPkg.files.filter((file) => file !== legacy);
for (const file of [...runtimeFiles, ...uiFiles])
  if (!extPkg.files.includes(file)) extPkg.files.push(file);
fs.writeFileSync(extPkgPath, asciiJson(extPkg), "utf8");
for (const file of [
  "codeartsData.js",
  "officialStats.js",
  "authStatus.js",
  "settings.js",
  "quota.js",
  "health.js",
  "extension-data.js",
])
  fs.copyFileSync(path.join(root, "src", file), path.join(extDir, file));
fs.cpSync(path.join(root, "src", "providers"), path.join(extDir, "providers"), {
  recursive: true,
});
fs.cpSync(path.join(root, "src", "core"), path.join(extDir, "core"), {
  recursive: true,
});
fs.rmSync(path.join(extDir, "core", "chart-axis.js"), { force: true });
const wasmDir = path.join(extDir, "node_modules", "sql.js", "dist");
fs.mkdirSync(wasmDir, { recursive: true });
for (const file of ["sql-wasm.js", "sql-wasm.wasm"])
  fs.copyFileSync(
    path.join(root, "node_modules", "sql.js", "dist", file),
    path.join(wasmDir, file),
  );
console.log(`Prepared extension staging ${extPkg.name}@${extPkg.version} -> ${path.relative(root, extDir)}`);
