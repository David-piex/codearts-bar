"use strict";

const vscode = require("vscode");
const path = require("node:path");
const { getSnapshotAsync, snapshotToText, errorSnapshot, fmtInt, fmtMs } = require("./codeartsData");

let statusItem;
let timer;
let lastSnapshot;

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

function markdownDetails(snapshot) {
  if (!snapshot || !snapshot.ok) return new vscode.MarkdownString(`${T.app}\n\n${snapshot ? snapshot.error : T.loading}`);
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.appendMarkdown(`**${T.app} - ${T.today} ${snapshot.status.label}**\n\n`);
  md.appendMarkdown(`${T.updated}: ${snapshot.updatedAt}\n\n`);
  md.appendMarkdown(`| ${T.window} | token | ${T.reply} | ${T.error} |\n|---|---:|---:|---:|\n`);
  md.appendMarkdown(`| ${T.today} | ${fmtInt(snapshot.usage.today.total)} | ${snapshot.usage.today.messages} | ${snapshot.usage.today.errors} |\n`);
  md.appendMarkdown(`| ${snapshot.config.windowHours}h | ${fmtInt(snapshot.usage.window.total)} | ${snapshot.usage.window.messages} | ${snapshot.usage.window.errors} |\n`);
  md.appendMarkdown(`| 7d | ${fmtInt(snapshot.usage.week.total)} | ${snapshot.usage.week.messages} | ${snapshot.usage.week.errors} |\n`);
  md.appendMarkdown(`| ${T.total} | ${fmtInt(snapshot.usage.all.total)} | ${snapshot.usage.all.messages} | ${snapshot.usage.all.errors} |\n\n`);
  if (snapshot.performance && snapshot.performance.window) {
    const p = snapshot.performance.window;
    md.appendMarkdown(`**${T.perf}**\n\n`);
    md.appendMarkdown(`- ${T.totalWait}: \`${fmtMs(p.latency.avg)}\`, P95: \`${fmtMs(p.latency.p95)}\`, P99: \`${fmtMs(p.latency.p99)}\`\n`);
    md.appendMarkdown(`- ${T.firstToken}: \`${fmtMs(p.ttft.avg)}\`, P95: \`${fmtMs(p.ttft.p95)}\`, match: \`${snapshot.performance.ttftMatched}/${snapshot.performance.ttftEvents}\`\n`);
    md.appendMarkdown(`- ${T.firstContent}: \`${fmtMs(p.firstContentApprox.avg)}\`, P95: \`${fmtMs(p.firstContentApprox.p95)}\`\n`);
    md.appendMarkdown(`- ${T.outputSpeed}: \`${Number.isFinite(p.outputTokensPerSec.avg) ? p.outputTokensPerSec.avg.toFixed(2) : T.noData} token/s\`\n`);
    md.appendMarkdown(`- ${T.errorRate}: \`${(p.errorRate * 100).toFixed(1)}%\`\n\n`);
  }
  if (snapshot.queue && snapshot.queue.window) {
    const q = snapshot.queue.window;
    md.appendMarkdown(`**${T.queue}**\n\n`);
    md.appendMarkdown(q.samples ? `- ${T.avg}: \`${fmtMs(q.avg)}\`, P95: \`${fmtMs(q.p95)}\`, ${T.max}: \`${fmtMs(q.max)}\`, ${T.times}: \`${q.samples}\`\n\n` : `- ${T.noData}\n\n`);
  }
  if (snapshot.trends && snapshot.trends.hourly24h && snapshot.trends.hourly24h.length) {
    const last = snapshot.trends.hourly24h[snapshot.trends.hourly24h.length - 1];
    md.appendMarkdown(`**${T.trend}**\n\n- ${T.lastHour}: ${fmtInt(last.total)} token\n\n`);
  }
  if (snapshot.tools && snapshot.tools.window && snapshot.tools.window.byName.length) {
    md.appendMarkdown(`**${T.tools}**\n\n`);
    for (const t of snapshot.tools.window.byName.slice(0, 5)) md.appendMarkdown(`- ${t.name}: ${t.calls} calls${t.errors ? `, ${t.errors} errors` : ""}\n`);
    md.appendMarkdown("\n");
  }
  if (snapshot.models.length) {
    md.appendMarkdown(`**${T.models}**\n\n`);
    for (const m of snapshot.models.slice(0, 5)) md.appendMarkdown(`- ${m.model}: ${fmtInt(m.total)} token\n`);
  }
  md.appendMarkdown(`\n[${T.refresh}](command:codeartsBar.refresh) - [${T.details}](command:codeartsBar.showDetails) - [${T.openData}](command:codeartsBar.openDataFolder)`);
  return md;
}

async function refresh() {
  const c = config();
  try {
    lastSnapshot = await getSnapshotAsync(c);
  } catch (error) {
    lastSnapshot = errorSnapshot(error, c.dbPath);
  }
  if (!statusItem) return;
  if (lastSnapshot.ok) {
    statusItem.text = `${iconFor(lastSnapshot.status.level)} CodeArts ${lastSnapshot.status.label}`;
    statusItem.tooltip = markdownDetails(lastSnapshot);
    statusItem.backgroundColor = lastSnapshot.status.level === "danger" ? new vscode.ThemeColor("statusBarItem.errorBackground") : lastSnapshot.status.level === "warning" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
  } else {
    statusItem.text = "$(error) CodeArts";
    statusItem.tooltip = markdownDetails(lastSnapshot);
    statusItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  }
}

function schedule(context) {
  if (timer) clearInterval(timer);
  timer = setInterval(refresh, config().refreshMs);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

async function showDetails() {
  if (!lastSnapshot) await refresh();
  const text = lastSnapshot && lastSnapshot.ok ? snapshotToText(lastSnapshot) : (lastSnapshot ? lastSnapshot.error : T.noData);
  vscode.window.showInformationMessage(text, { modal: true });
}

async function openDataFolder() {
  if (!lastSnapshot) await refresh();
  const dbPath = (lastSnapshot && lastSnapshot.dbPath) || config().dbPath;
  if (!dbPath) return;
  vscode.env.openExternal(vscode.Uri.file(path.dirname(dbPath)));
}

function activate(context) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  statusItem.name = T.app;
  statusItem.command = "codeartsBar.showDetails";
  statusItem.text = "$(sync~spin) CodeArts";
  statusItem.show();

  context.subscriptions.push(statusItem);
  context.subscriptions.push(vscode.commands.registerCommand("codeartsBar.refresh", refresh));
  context.subscriptions.push(vscode.commands.registerCommand("codeartsBar.showDetails", showDetails));
  context.subscriptions.push(vscode.commands.registerCommand("codeartsBar.openDataFolder", openDataFolder));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("codeartsBar")) {
      schedule(context);
      refresh();
    }
  }));

  schedule(context);
  refresh();
}

function deactivate() {
  if (timer) clearInterval(timer);
}

module.exports = { activate, deactivate };
