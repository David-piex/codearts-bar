"use strict";

const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const { snapshotToText, errorSnapshot, fmtInt, fmtMs } = require("./codeartsData");
const { getExtensionSummary, getExtensionDetails } = require("./extension-data");
const { DashboardHost, OverviewViewProvider } = require("./dashboard");
const localProvider = require("./providers/codeartsLocal");
const { databaseFingerprint } = require("./core/source-fingerprint");
const { closeSettingsStore } = require("./settings");
const { databasePagePayload } = require("./protocol/query-results");
const { redactSensitiveText } = require("./core/sensitive-text");
const { exportSessionWithPrivacy } = require("./session-export");

let statusItem;
let timer;
let lastSnapshot;
let refreshPromise;
let dashboardHost;
let summaryCache = null;
let summaryCacheKey = "";
let summaryCachedAt = 0;
const SUMMARY_CACHE_TTL_MS = 30000;

const T = {
  app: "\u7801\u9053 Bar",
  loading: "\u6682\u672a\u5237\u65b0",
  updated: "\u66f4\u65b0",
  window: "\u7a97\u53e3",
  reply: "\u56de\u590d",
  error: "\u9519\u8bef",
  today: "\u4eca\u65e5",
  total: "\u603b\u8ba1",
  perf: "\u6027\u80fd",
  totalWait: "\u603b\u7b49\u5f85\u5747\u503c",
  firstToken: "\u9996\u5b57\u65f6\u95f4",
  firstContent: "\u9996\u5185\u5bb9\u8fd1\u4f3c",
  outputSpeed: "\u8f93\u51fa\u901f\u5ea6",
  errorRate: "\u9519\u8bef\u7387",
  noData: "\u65e0\u6570\u636e",
  queue: "\u6392\u961f\u65f6\u95f4",
  avg: "\u5e73\u5747",
  max: "\u6700\u5927",
  times: "\u6b21\u6570",
  trend: "\u8d8b\u52bf",
  lastHour: "\u6700\u8fd1\u4e00\u5c0f\u65f6",
  tools: "\u5de5\u5177\u6392\u884c",
  models: "\u6a21\u578b\u6392\u884c",
  refresh: "\u5237\u65b0",
  details: "\u8be6\u60c5",
  openData: "\u6253\u5f00\u6570\u636e\u76ee\u5f55",
};

function config() {
  const c = vscode.workspace.getConfiguration("codeartsBar");
  return {
    dbPath: c.get("dbPath") || undefined,
    dailyLimit: c.get("dailyLimit") || 200000,
    windowHours: c.get("windowHours") || 24,
    refreshMs: Math.max(10000, c.get("refreshMs") || 60000),
  };
}

function iconFor(level) {
  if (level === "danger") return "$(error)";
  if (level === "warning") return "$(warning)";
  return "$(pulse)";
}

function formatCacheRate(usage = {}) {
  const rate = Number(usage.cacheHitRate);
  return usage.cacheHitRate === null || usage.cacheHitRate === undefined || !Number.isFinite(rate)
    ? T.noData
    : `${rate.toFixed(1)}%`;
}

function markdownDetails(snapshot) {
  if (!snapshot || !snapshot.ok)
    return new vscode.MarkdownString(
      `${T.app}\n\n${snapshot ? snapshot.error : T.loading}`,
    );
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = {
    enabledCommands: [
      "codeartsBar.refresh",
      "codeartsBar.showDetails",
      "codeartsBar.openDataFolder",
    ],
  };
  md.appendMarkdown(`**${T.app} - 今日软上限 ${snapshot.status.label}**\n\n`);
  md.appendMarkdown(`${T.updated}: ${snapshot.updatedAt}\n\n`);
  md.appendMarkdown(
    `| ${T.window} | token | ${T.reply} | ${T.error} | \u7f13\u5b58\u547d\u4e2d |\n|---|---:|---:|---:|---:|\n`,
  );
  md.appendMarkdown(
    `| ${T.today} | ${fmtInt(snapshot.usage.today.total)} | ${snapshot.usage.today.messages} | ${snapshot.usage.today.errors} | ${formatCacheRate(snapshot.usage.today)} |\n`,
  );
  md.appendMarkdown(
    `| ${snapshot.config.windowHours}h | ${fmtInt(snapshot.usage.window.total)} | ${snapshot.usage.window.messages} | ${snapshot.usage.window.errors} | ${formatCacheRate(snapshot.usage.window)} |\n`,
  );
  md.appendMarkdown(
    `| 7d | ${fmtInt(snapshot.usage.week.total)} | ${snapshot.usage.week.messages} | ${snapshot.usage.week.errors} | ${formatCacheRate(snapshot.usage.week)} |\n`,
  );
  md.appendMarkdown(
    `| ${T.total} | ${fmtInt(snapshot.usage.all.total)} | ${snapshot.usage.all.messages} | ${snapshot.usage.all.errors} | ${formatCacheRate(snapshot.usage.all)} |\n\n`,
  );
  if (snapshot.capabilities?.performance !== false && snapshot.performance?.window) {
    const p = snapshot.performance.window;
    md.appendMarkdown(`**${T.perf}**\n\n`);
    md.appendMarkdown(
      `- ${T.totalWait}: \`${fmtMs(p.latency.avg)}\`, P95: \`${fmtMs(p.latency.p95)}\`, P99: \`${fmtMs(p.latency.p99)}\`\n`,
    );
    md.appendMarkdown(
      `- ${T.firstToken}: \`${fmtMs(p.ttft.avg)}\`, P95: \`${fmtMs(p.ttft.p95)}\`, match: \`${snapshot.performance.ttftMatched}/${snapshot.performance.ttftEvents}\`\n`,
    );
    md.appendMarkdown(
      `- ${T.firstContent}: \`${fmtMs(p.firstContentApprox.avg)}\`, P95: \`${fmtMs(p.firstContentApprox.p95)}\`\n`,
    );
    md.appendMarkdown(
      `- ${T.outputSpeed}: \`${Number.isFinite(p.outputTokensPerSec.avg) ? p.outputTokensPerSec.avg.toFixed(2) : T.noData} token/s\`\n`,
    );
    md.appendMarkdown(
      `- ${T.errorRate}: \`${(p.errorRate * 100).toFixed(1)}%\`\n\n`,
    );
  }
  if (snapshot.capabilities?.queue !== false && snapshot.queue?.window) {
    const q = snapshot.queue.window;
    md.appendMarkdown(`**${T.queue}**\n\n`);
    md.appendMarkdown(
      q.samples
        ? `- ${T.avg}: \`${fmtMs(q.avg)}\`, P95: \`${fmtMs(q.p95)}\`, ${T.max}: \`${fmtMs(q.max)}\`, ${T.times}: \`${q.samples}\`\n\n`
        : `- ${T.noData}\n\n`,
    );
  }
  if (
    snapshot.trends &&
    snapshot.trends.hourly24h &&
    snapshot.trends.hourly24h.length
  ) {
    const last =
      snapshot.trends.hourly24h[snapshot.trends.hourly24h.length - 1];
    md.appendMarkdown(
      `**${T.trend}**\n\n- ${T.lastHour}: ${fmtInt(last.total)} token\n\n`,
    );
  }
  if (
    snapshot.tools &&
    snapshot.tools.window &&
    snapshot.tools.window.byName.length
  ) {
    md.appendMarkdown(`**${T.tools}**\n\n`);
    for (const t of snapshot.tools.window.byName.slice(0, 5))
      md.appendMarkdown(
        `- ${t.name}: ${t.calls} calls${t.errors ? `, ${t.errors} errors` : ""}\n`,
      );
    md.appendMarkdown("\n");
  }
  if (snapshot.models.length) {
    md.appendMarkdown(`**${T.models}**\n\n`);
    for (const m of snapshot.models.slice(0, 5))
      md.appendMarkdown(`- ${m.model}: ${fmtInt(m.total)} token\n`);
  }
  md.appendMarkdown(
    `\n[${T.refresh}](command:codeartsBar.refresh) - [${T.details}](command:codeartsBar.showDetails) - [${T.openData}](command:codeartsBar.openDataFolder)`,
  );
  return md;
}

function updateStatus(snapshot) {
  if (!statusItem) return;
  if (snapshot?.ok) {
    statusItem.text = `${iconFor(snapshot.status.level)} CodeArts ${snapshot.status.label}`;
    statusItem.tooltip = markdownDetails(snapshot);
    statusItem.backgroundColor =
      snapshot.status.level === "danger"
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : snapshot.status.level === "warning"
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;
  } else {
    statusItem.text = "$(error) CodeArts";
    statusItem.tooltip = markdownDetails(snapshot);
    statusItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground",
    );
  }
}

async function loadDashboardDetails(options = {}) {
  const requests = dashboardHost?.beginDetails(options) || [];
  if (!requests.length) return lastSnapshot;
  const c = config();
  const groups = new Map();
  for (const request of requests) {
    const key = JSON.stringify(request.scope);
    const group = groups.get(key) || { scope: request.scope, requests: [] };
    group.requests.push(request);
    groups.set(key, group);
  }
  const results = await Promise.all([...groups.values()].map(async (group) => {
    try {
      const details = await getExtensionDetails({ ...c, ...group.scope });
      for (const request of group.requests)
        dashboardHost?.commitDetails(request, details);
      return details;
    } catch (error) {
      for (const request of group.requests)
        dashboardHost?.failDetails(request, error);
      return null;
    }
  }));
  return results.find((result) => result?.ok) || lastSnapshot;
}

async function refresh(options = {}) {
  if (refreshPromise) {
    await refreshPromise;
    return options.details === true || options.target
      ? loadDashboardDetails(options)
      : lastSnapshot;
  }
  const c = config();
  refreshPromise = (async () => {
    try {
      const sources = localProvider.listDataSources({ ...c, useSavedSettings: false });
      const fingerprint = databaseFingerprint(fs, sources);
      const cacheKey = JSON.stringify({ dbPath: c.dbPath || "", dailyLimit: c.dailyLimit, windowHours: c.windowHours, fingerprint });
      if (summaryCache?.ok && cacheKey === summaryCacheKey && Date.now() - summaryCachedAt < SUMMARY_CACHE_TTL_MS) {
        lastSnapshot = summaryCache;
      } else {
        lastSnapshot = await getExtensionSummary(c);
        if (lastSnapshot?.ok) {
          summaryCache = lastSnapshot;
          summaryCacheKey = cacheKey;
          summaryCachedAt = Date.now();
        }
      }
    } catch (error) {
      lastSnapshot = errorSnapshot(error, c.dbPath);
    }
    updateStatus(lastSnapshot);
    if (options.details === true || dashboardHost?.hasTargets()) await loadDashboardDetails(options);
    return lastSnapshot;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function schedule() {
  if (timer) clearTimeout(timer);
  const configured = config().refreshMs;
  const delay = dashboardHost?.hasTargets() ? configured : Math.max(configured, 300000);
  timer = setTimeout(async () => {
    timer = null;
    try { await refresh(); }
    finally { schedule(); }
  }, delay);
  timer.unref?.();
}

async function showDetails() {
  dashboardHost?.openPanel();
  if (!lastSnapshot) await refresh();
}

async function openOverview() {
  await vscode.commands.executeCommand("workbench.view.extension.codeartsBar");
}

async function openDataFolder() {
  if (!lastSnapshot) await refresh();
  const dbPath = (lastSnapshot && lastSnapshot.dbPath) || config().dbPath;
  if (!dbPath) return;
  vscode.env.openExternal(vscode.Uri.file(path.dirname(dbPath)));
}

async function querySessionsPage(options = {}) {
  const c = config();
  const page = Math.max(1, Number(options.page || 1));
  const pageSize = Math.max(1, Math.min(100, Number(options.pageSize || 20)));
  const result = await localProvider.getSessionsPage({
    ...c,
    useSavedSettings: false,
    source: options.source || "all",
    model: options.model || "all",
    project: options.project || "all",
    status: options.status || "active",
    query: options.search || "",
    range: options.range || {},
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return databasePagePayload({ ...result, items: (result.items || []).map((item) => ({
      id: item.id || "",
      title: redactSensitiveText(item.title || "未命名会话"),
      directory: redactSensitiveText(item.directory || ""),
      source: item.source || "",
      sourceLabel: item.sourceLabel || item.source || "",
      archived: Boolean(item.archived),
      updatedAt: Number(item.updatedAt || 0),
      total: Number(item.usage?.total || 0),
      model: item.usage?.topModel?.model || "",
    })) }, { page, pageSize, resource: "sessions", source: options.source, model: options.model, project: options.project, query: options.search, range: options.range });
}

async function queryRequestsPage(options = {}) {
  const c = config();
  const page = Math.max(1, Number(options.page || 1));
  const pageSize = Math.max(1, Math.min(100, Number(options.pageSize || 40)));
  const result = await localProvider.getRequestsPage({
    ...c, useSavedSettings: false, source: options.source || "all", model: options.model || "all",
    query: options.search || "", range: options.range || {}, limit: pageSize, offset: (page - 1) * pageSize,
  });
  return databasePagePayload({ ...result, items: (result.items || []).map((item) => ({
    id: item.id || "", time: item.time || item.createdAt || 0,
    sessionTitle: redactSensitiveText(item.sessionTitle || "未命名会话"), source: item.source || "", sourceLabel: item.sourceLabel || item.source || "",
    provider: item.provider || "", model: item.model || "", status: item.status, ok: item.ok !== false,
    total: Number(item.total || 0), input: Number(item.input || 0), output: Number(item.output || 0), reasoning: Number(item.reasoning || 0),
    cacheRead: Number(item.cacheRead || 0), cacheWrite: Number(item.cacheWrite || 0), latencyMs: item.latencyMs,
    ttftMs: item.ttftMs, firstContentMs: item.firstContentMs, outputTokensPerSec: item.outputTokensPerSec,
    error: redactSensitiveText(item.error || ""),
  })) }, { page, pageSize, resource: "requests", source: options.source, model: options.model, query: options.search, range: options.range });
}

async function exportSession(session, format = "json") {
  return exportSessionWithPrivacy({
    vscode,
    localProvider,
    session,
    format,
    providerOptions: { ...config(), useSavedSettings: false },
  });
}

function activate(context) {
  dashboardHost = new DashboardHost(
    context,
    () => lastSnapshot,
    refresh,
    loadDashboardDetails,
    openDataFolder,
    { querySessionsPage, queryRequestsPage, exportSession, onVisibilityChanged: schedule },
  );
  const overviewProvider = new OverviewViewProvider(dashboardHost);
  statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99,
  );
  statusItem.name = T.app;
  statusItem.command = "codeartsBar.openOverview";
  statusItem.text = "$(sync~spin) CodeArts";
  statusItem.tooltip = "\u6253\u5f00\u7801\u9053\u4f7f\u7528\u5206\u6790";
  statusItem.show();

  context.subscriptions.push(statusItem);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "codeartsBar.overview",
      overviewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("codeartsBar.refresh", refresh),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("codeartsBar.showDetails", showDetails),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("codeartsBar.openDashboard", showDetails),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("codeartsBar.openOverview", openOverview),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codeartsBar.openDataFolder",
      openDataFolder,
    ),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codeartsBar")) {
        schedule();
        refresh();
      }
    }),
  );

  context.subscriptions.push({ dispose: () => { if (timer) clearTimeout(timer); timer = null; } });
  schedule();
  refresh();
  return { querySessionsPage, queryRequestsPage, exportSession };
}

async function deactivate() {
  if (timer) clearTimeout(timer);
  timer = null;
  refreshPromise = null;
  await localProvider.closeSqlJsWorker?.();
  closeSettingsStore?.();
  dashboardHost = null;
  lastSnapshot = null;
  summaryCache = null;
  summaryCacheKey = "";
  summaryCachedAt = 0;
}

module.exports = { activate, deactivate, querySessionsPage, queryRequestsPage, exportSession };
