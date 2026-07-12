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
  const scripts = ["format.js", "chart-axis.js", "chart.js", "views.js", "dashboard.js"]
    .map(
      (name) =>
        `<script nonce="${token}" src="${resource(webview, extensionUri, "media", "scripts", name)}"></script>`,
    )
    .join("");
  const title =
    mode === "sidebar"
      ? "\u7801\u9053\u6982\u89c8"
      : "\u7801\u9053 \u00b7 \u4f7f\u7528\u5206\u6790";
  const fullAnalysisAction = mode === "sidebar" ? '<button class="accent-button" data-action="openDashboard">\u5b8c\u6574\u5206\u6790</button>' : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${token}'; img-src ${webview.cspSource} data:;">${styles}<title>${title}</title></head>
<body data-mode="${mode}"><div class="desktop-backdrop"></div><main class="app-shell">
<header class="app-header"><div class="app-identity"><div class="app-icon" aria-hidden="true"><i></i><i></i><i></i></div><div><span class="app-kicker">\u672c\u5730\u7528\u91cf</span><h1>${title}</h1><p id="updated">\u6b63\u5728\u8fde\u63a5\u672c\u5730\u6570\u636e\u2026</p></div></div><div class="header-actions"><button class="icon-button" data-action="refresh" title="\u5237\u65b0" aria-label="\u5237\u65b0"><span class="refresh-glyph"></span></button>${fullAnalysisAction}</div></header>
<section class="range-filter" aria-label="\u7edf\u8ba1\u65f6\u95f4\u8303\u56f4"><div class="segmented-control"><button data-range="today">\u4eca\u5929</button><button data-range="window">24 \u5c0f\u65f6</button><button data-range="week">7 \u5929</button><button data-range="14d">14 \u5929</button><button data-range="30d">30 \u5929</button><button data-range="all">\u5168\u90e8</button><button data-range="custom">\u81ea\u5b9a\u4e49</button></div><div class="menu-control range-menu-control"><button id="rangeMenuButton" class="menu-trigger" data-menu-toggle="range" aria-haspopup="listbox" aria-expanded="false"><span id="rangeMenuValue">\u4eca\u5929</span><i aria-hidden="true"></i></button><div id="rangeMenu" class="control-menu" role="listbox" aria-label="\u9009\u62e9\u65f6\u95f4\u8303\u56f4" hidden><button data-menu-option="range" data-value="today" role="option">\u4eca\u5929</button><button data-menu-option="range" data-value="window" role="option">24 \u5c0f\u65f6</button><button data-menu-option="range" data-value="week" role="option">7 \u5929</button><button data-menu-option="range" data-value="14d" role="option">14 \u5929</button><button data-menu-option="range" data-value="30d" role="option">30 \u5929</button><button data-menu-option="range" data-value="all" role="option">\u5168\u90e8</button><button data-menu-option="range" data-value="custom" role="option">\u81ea\u5b9a\u4e49\u2026</button></div></div><span id="rangeLabel" class="range-label">\u4eca\u5929</span></section>
<section id="customRange" class="custom-range" hidden><label><span>\u5f00\u59cb\u65f6\u95f4</span><input id="rangeStart" type="datetime-local"></label><span class="range-arrow" aria-hidden="true">\u2192</span><label><span>\u7ed3\u675f\u65f6\u95f4</span><input id="rangeEnd" type="datetime-local"></label><p id="rangeError" role="alert" hidden></p><div><button data-range-cancel>\u53d6\u6d88</button><button class="accent-button" data-range-apply>\u5e94\u7528</button></div></section>
<section class="scope-filter" aria-label="\u7edf\u8ba1\u7ef4\u5ea6"><div class="scope-field"><span>\u6570\u636e\u6765\u6e90</span><div class="menu-control"><button id="sourceFilter" class="menu-trigger" data-menu-toggle="source" aria-haspopup="listbox" aria-expanded="false"><span id="sourceFilterValue">\u5168\u90e8\u6765\u6e90</span><i aria-hidden="true"></i></button><div id="sourceMenu" class="control-menu" role="listbox" aria-label="\u9009\u62e9\u6570\u636e\u6765\u6e90" hidden></div></div></div><div class="scope-field"><span>\u6a21\u578b</span><div class="menu-control"><button id="modelFilter" class="menu-trigger" data-menu-toggle="model" aria-haspopup="listbox" aria-expanded="false"><span id="modelFilterValue">\u5168\u90e8\u6a21\u578b</span><i aria-hidden="true"></i></button><div id="modelMenu" class="control-menu" role="listbox" aria-label="\u9009\u62e9\u6a21\u578b" hidden></div></div></div><p id="filterContext">\u4eca\u5929 \u00b7 \u5168\u90e8\u6765\u6e90 \u00b7 \u5168\u90e8\u6a21\u578b</p></section>
<section id="loading" class="loading-state"><div class="skeleton hero-skeleton"></div><div class="skeleton-grid"><i></i><i></i><i></i><i></i></div><p>\u6b63\u5728\u8bfb\u53d6\u672c\u5730 CodeArts \u6570\u636e</p></section>
<section id="error" class="state-card error-state" hidden><span>!</span><h2>\u6570\u636e\u6682\u65f6\u6ca1\u6709\u5c31\u7eea</h2><p id="errorText"></p><div><button class="accent-button" data-action="refresh">\u91cd\u65b0\u8bfb\u53d6</button><button data-action="openData">\u6570\u636e\u76ee\u5f55</button></div></section>
<div id="dashboard" hidden>
<section class="metric-grid"><article class="metric-card metric-primary"><span>Token \u7528\u91cf</span><strong id="metricTotal">0</strong><small id="metricDelta">\u672c\u5730\u7edf\u8ba1</small></article><article class="metric-card"><span>\u6a21\u578b\u8c03\u7528</span><strong id="metricMessages">0</strong><small>\u6b21\u8bf7\u6c42</small></article><article class="metric-card"><span>\u7f13\u5b58\u547d\u4e2d</span><strong id="metricCache">\u2014</strong><small id="metricCacheTokens">0 cache token</small></article><article class="metric-card"><span>\u9519\u8bef\u7387</span><strong id="metricErrors">0%</strong><small id="metricErrorCount">0 \u4e2a\u9519\u8bef</small></article></section>
<section class="token-strip" aria-label="Token \u62c6\u5206"><div><span>\u65b0\u589e\u8f93\u5165</span><strong id="metricInput">0</strong></div><div><span>\u8f93\u51fa</span><strong id="metricOutput">0</strong></div><div><span>\u7f13\u5b58\u521b\u5efa</span><strong id="metricCacheWrite">0</strong></div><div><span>\u7f13\u5b58\u547d\u4e2d</span><strong id="metricCacheRead">0</strong></div><div><span>\u53ef\u590d\u7528\u63d0\u793a\u8bcd</span><strong id="metricReusable">0</strong></div></section>
<section class="surface trend-surface"><div class="surface-header"><div><span class="section-label">\u5f53\u524d\u8303\u56f4</span><h2>Token \u8d8b\u52bf</h2></div><div class="chart-legend"><span><i class="total"></i>\u603b\u91cf</span><span><i class="output"></i>\u8f93\u51fa</span><span><i class="cache"></i>\u7f13\u5b58\u8bfb\u53d6</span></div></div><div class="chart-area"><canvas id="trendChart" aria-label="Token \u4f7f\u7528\u8d8b\u52bf\u56fe"></canvas><div class="chart-tooltip" data-chart-tooltip hidden></div><div id="chartEmpty" class="empty-state" hidden>\u5f53\u524d\u8303\u56f4\u6682\u65e0\u8d8b\u52bf\u6570\u636e</div></div></section>
<div class="content-grid"><section class="surface"><div class="surface-header"><div><span class="section-label">\u5f53\u524d\u8303\u56f4</span><h2>\u6a21\u578b\u6392\u884c</h2></div></div><div id="models" class="rank-list"></div></section><section class="surface source-surface"><div class="surface-header"><div><span class="section-label">\u5f53\u524d\u8303\u56f4</span><h2>\u6570\u636e\u6e90\u5206\u5e03</h2></div></div><div class="source-layout"><div id="sourceRing" class="source-ring share-0"><div><strong id="sourceCount">0</strong><span>\u6570\u636e\u6e90</span></div></div><div id="sources" class="source-list"></div></div></section></div>
<section class="surface session-surface"><div class="surface-header"><div><span class="section-label">\u5f53\u524d\u8303\u56f4</span><h2>\u6700\u8fd1\u4f1a\u8bdd</h2></div><button class="link-button session-full-link" data-action="openDashboard">\u67e5\u770b\u5b8c\u6574\u5206\u6790</button></div><div id="sessions" class="session-list"></div></section>
<section class="surface request-surface"><div class="surface-header"><div><span class="section-label">\u7b5b\u9009\u7ed3\u679c</span><h2>\u8bf7\u6c42\u65e5\u5fd7</h2></div><span id="requestCount" class="surface-meta">0 \u6761</span></div><div class="request-table-wrap"><table class="request-table"><thead><tr><th>\u65f6\u95f4</th><th>\u6765\u6e90</th><th>\u6a21\u578b</th><th>\u8f93\u5165</th><th>\u8f93\u51fa</th><th>\u521b\u5efa</th><th>\u547d\u4e2d</th><th>\u603b Token</th><th>\u8017\u65f6</th><th>\u72b6\u6001</th><th>\u4f1a\u8bdd</th></tr></thead><tbody id="requests"></tbody></table></div></section>
<section class="surface performance-surface"><div class="surface-header"><div><span id="performanceKicker" class="section-label">\u6570\u636e\u72b6\u6001</span><h2 id="performanceTitle">\u672c\u5730\u6570\u636e</h2></div><span id="dataHealth" class="surface-meta">\u8bfb\u53d6\u6b63\u5e38</span></div><div class="performance-grid"><div><span>SQLite \u9002\u914d\u5668</span><strong id="dataAdapter">\u2014</strong></div><div><span>\u6570\u636e\u6e90</span><strong id="dataSources">0</strong></div><div><span>\u5f53\u524d\u8bf7\u6c42\u6837\u672c</span><strong id="dataRequests">0</strong></div><div><span>\u5f53\u524d\u4f1a\u8bdd\u6837\u672c</span><strong id="dataSessions">0</strong></div><div><span>\u672c\u5730\u6570\u636e\u5e93</span><strong id="dbSize">\u2014</strong></div></div></section>
<footer class="privacy-footer"><span><i></i>\u6240\u6709\u6570\u636e\u4ec5\u5728\u672c\u673a\u8bfb\u53d6\uff0c\u4e0d\u4e0a\u4f20</span><div><button data-action="openData">\u6570\u636e\u76ee\u5f55</button><button data-action="settings">\u8bbe\u7f6e</button></div></footer>
</div></main>${scripts}</body></html>`;
}

module.exports = { dashboardHtml, nonce };
