"use strict";

const vscode = require("vscode");

function nonce() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 32 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

function resource(webview, extensionUri, ...parts) {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...parts));
}

function dashboardHtml(webview, extensionUri, mode) {
  const token = nonce();
  const styles = [
    "tokens.css",
    "foundation.css",
    "components.css",
    "responsive.css",
  ]
    .map(
      (name) =>
        `<link rel="stylesheet" href="${resource(webview, extensionUri, "media", "styles", name)}">`,
    )
    .join("");
  const scripts = ["format.js", "chart.js", "views.js", "dashboard.js"]
    .map(
      (name) =>
        `<script nonce="${token}" src="${resource(webview, extensionUri, "media", "scripts", name)}"></script>`,
    )
    .join("");
  const title =
    mode === "sidebar"
      ? "\u7801\u9053\u6982\u89c8"
      : "\u7801\u9053 \u00b7 \u4f7f\u7528\u5206\u6790";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${token}'; img-src ${webview.cspSource} data:;">${styles}<title>${title}</title></head>
<body data-mode="${mode}"><div class="desktop-backdrop"></div><main class="app-shell">
<header class="app-header"><div class="app-identity"><div class="app-icon" aria-hidden="true"><i></i><i></i><i></i></div><div><span class="app-kicker">LOCAL USAGE</span><h1>${title}</h1><p id="updated">\u6b63\u5728\u8fde\u63a5\u672c\u5730\u6570\u636e\u2026</p></div></div><div class="header-actions"><button class="icon-button" data-action="refresh" title="\u5237\u65b0" aria-label="\u5237\u65b0"><span class="refresh-glyph"></span></button><button class="accent-button" data-action="openDashboard">\u5b8c\u6574\u5206\u6790</button></div></header>
<nav class="segmented-control" aria-label="\u7edf\u8ba1\u8303\u56f4"><button data-range="today">\u4eca\u65e5</button><button data-range="window">24 \u5c0f\u65f6</button><button data-range="week">7 \u5929</button><button data-range="all">\u5168\u90e8</button></nav>
<section id="loading" class="loading-state"><div class="skeleton hero-skeleton"></div><div class="skeleton-grid"><i></i><i></i><i></i><i></i></div><p>\u6b63\u5728\u8bfb\u53d6\u672c\u5730 CodeArts \u6570\u636e</p></section>
<section id="error" class="state-card error-state" hidden><span>!</span><h2>\u6570\u636e\u6682\u65f6\u6ca1\u6709\u5c31\u7eea</h2><p id="errorText"></p><div><button class="accent-button" data-action="refresh">\u91cd\u65b0\u8bfb\u53d6</button><button data-action="openData">\u6570\u636e\u76ee\u5f55</button></div></section>
<div id="dashboard" hidden>
<section class="metric-grid"><article class="metric-card metric-primary"><span>Token \u7528\u91cf</span><strong id="metricTotal">0</strong><small id="metricDelta">\u672c\u5730\u7edf\u8ba1</small></article><article class="metric-card"><span>\u6a21\u578b\u8c03\u7528</span><strong id="metricMessages">0</strong><small>\u6b21\u8bf7\u6c42</small></article><article class="metric-card"><span>\u7f13\u5b58\u547d\u4e2d</span><strong id="metricCache">\u2014</strong><small id="metricCacheTokens">0 cache token</small></article><article class="metric-card"><span>\u9519\u8bef\u7387</span><strong id="metricErrors">0%</strong><small id="metricErrorCount">0 \u4e2a\u9519\u8bef</small></article></section>
<section class="surface trend-surface"><div class="surface-header"><div><span class="section-label">TOKEN FLOW</span><h2>\u4f7f\u7528\u8d8b\u52bf</h2></div><div class="chart-legend"><span><i class="total"></i>\u603b\u91cf</span><span><i class="output"></i>\u8f93\u51fa</span></div></div><div class="chart-area"><canvas id="trendChart" aria-label="Token \u4f7f\u7528\u8d8b\u52bf\u56fe"></canvas><div id="chartEmpty" class="empty-state" hidden>\u5f53\u524d\u8303\u56f4\u6682\u65e0\u8d8b\u52bf\u6570\u636e</div></div></section>
<div class="content-grid"><section class="surface"><div class="surface-header"><div><span class="section-label">MODEL MIX</span><h2>\u6a21\u578b\u6392\u884c</h2></div></div><div id="models" class="rank-list"></div></section><section class="surface source-surface"><div class="surface-header"><div><span class="section-label">LOCAL SOURCES</span><h2>\u6570\u636e\u6e90\u5206\u5e03</h2></div></div><div class="source-layout"><div id="sourceRing" class="source-ring share-0"><div><strong id="sourceCount">0</strong><span>\u6570\u636e\u6e90</span></div></div><div id="sources" class="source-list"></div></div></section></div>
<section class="surface session-surface"><div class="surface-header"><div><span class="section-label">RECENT WORK</span><h2>\u6700\u8fd1\u4f1a\u8bdd</h2></div><button class="link-button" data-action="openDashboard">\u67e5\u770b\u5b8c\u6574\u5206\u6790</button></div><div id="sessions" class="session-list"></div></section>
<section class="surface performance-surface"><div class="surface-header"><div><span class="section-label">RESPONSE HEALTH</span><h2>\u54cd\u5e94\u6027\u80fd</h2></div></div><div class="performance-grid"><div><span>\u5e73\u5747\u7b49\u5f85</span><strong id="perfLatency">\u2014</strong></div><div><span>P95 \u7b49\u5f85</span><strong id="perfP95">\u2014</strong></div><div><span>\u9996\u5185\u5bb9\u8fd1\u4f3c</span><strong id="perfFirst">\u2014</strong></div><div><span>\u8f93\u51fa\u901f\u5ea6</span><strong id="perfSpeed">\u2014</strong></div><div><span>\u6392\u961f\u5747\u503c</span><strong id="perfQueue">\u2014</strong></div><div><span>\u672c\u5730\u6570\u636e\u5e93</span><strong id="dbSize">\u2014</strong></div></div></section>
<footer class="privacy-footer"><span><i></i>\u6240\u6709\u6570\u636e\u4ec5\u5728\u672c\u673a\u8bfb\u53d6\uff0c\u4e0d\u4e0a\u4f20</span><div><button data-action="openData">\u6570\u636e\u76ee\u5f55</button><button data-action="settings">\u8bbe\u7f6e</button></div></footer>
</div></main>${scripts}</body></html>`;
}

module.exports = { dashboardHtml, nonce };
