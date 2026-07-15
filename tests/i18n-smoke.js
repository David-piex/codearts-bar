"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const badVisibleText = /\?{3,}|�|鐮|侀|鈥|鏇|鎵|鍒锋|璁剧疆|閫|灏|浠婃棩|鍘嗗彶|鏃ュ織|闈㈡澘|妫€|瀹夎/;

function assertCleanVisibleText(value, label) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCleanVisibleText(item, `${label}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertCleanVisibleText(item, `${label}.${key}`);
    return;
  }
  if (typeof value !== "string") return;
  assert.doesNotMatch(value, badVisibleText, `${label} contains broken visible text: ${value}`);
}

function loadDashboardI18n() {
  const file = path.join(root, "src", "dashboard", "i18n.js");
  const source = fs.readFileSync(file, "utf8");
  const context = vm.createContext({ Intl });
  vm.runInContext(source, context, { filename: file });
  return context.TXT;
}

function loadTrayModule() {
  const file = path.join(root, "src", "main", "tray.js");
  const source = fs.readFileSync(file, "utf8");
  const module = { exports: {} };
  const context = vm.createContext({
    Buffer,
    module,
    exports: module.exports,
    process,
    require(name) {
      if (name === "electron") {
        return {
          Menu: { buildFromTemplate: (template) => ({ template }) },
          nativeImage: {
            createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }),
            createFromDataURL: () => ({}),
          },
        };
      }
      return require(name);
    },
    __dirname: path.dirname(file),
    __filename: file,
  });
  vm.runInContext(source, context, { filename: file });
  return module.exports;
}

function collectMenuLabels(items, out = []) {
  for (const item of items || []) {
    if (item.label) out.push(item.label);
    if (item.submenu) collectMenuLabels(item.submenu, out);
  }
  return out;
}

function testDashboardI18n() {
  const txt = loadDashboardI18n();
  assert.equal(txt.emptyAnalyticsTitle, "暂无使用数据");
  assert.equal(txt.diagnosticsCenter, "诊断中心");
  assert.equal(txt.copyDiagnostics, "复制诊断");
  assertCleanVisibleText(txt, "TXT");
}

function testTrayI18n() {
  const tray = loadTrayModule();
  const fmtInt = (value) => Number(value || 0).toLocaleString("zh-CN");
  const snapshot = {
    ok: true,
    updatedAt: "2026-07-09 18:00",
    status: { usagePercent: 42, level: "ok", label: "42%" },
    usage: {
      today: { total: 12345, messages: 6, errors: 0 },
      window: { total: 23456 },
      week: { total: 34567 },
      all: { total: 45678 },
    },
  };
  const summary = tray.traySummaryText(snapshot, fmtInt);
  assert.match(summary, /码道 Bar · 今日软上限 42%/);
  assert.match(summary, /更新：2026-07-09 18:00/);
  assert.match(summary, /今日：12,345 token/);
  assertCleanVisibleText(summary, "traySummaryText");

  const labels = collectMenuLabels(tray.buildTrayMenu(snapshot, { fmtInt }).template);
  for (const expected of ["码道 Bar", "打开面板", "刷新", "设置", "打开日志", "检查更新 / 安装包", "打开码道", "退出"]) {
    assert.ok(labels.includes(expected), `missing tray label: ${expected}`);
  }
  assertCleanVisibleText(labels, "trayMenu");

  const errorLabels = collectMenuLabels(tray.buildTrayMenu(null, { fmtInt }).template);
  for (const expected of ["码道 Bar", "尚未刷新", "打开面板", "刷新", "打开日志", "退出"]) {
    assert.ok(errorLabels.includes(expected), `missing tray empty label: ${expected}`);
  }
  assertCleanVisibleText(errorLabels, "trayEmptyMenu");

  const mainSource = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
  assert.doesNotMatch(mainSource, /setToolTip\(['"]\?\?/);
}

testDashboardI18n();
testTrayI18n();

console.log("ok - i18n smoke");

