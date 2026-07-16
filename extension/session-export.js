"use strict";

const path = require("node:path");

const FORMAT_LABELS = Object.freeze({
  json: "JSON",
  md: "Markdown",
  xlsx: "Excel",
});

const PRIVACY_OPTIONS = Object.freeze([
  Object.freeze({
    privacyKey: "includeContent",
    label: "$(comment-discussion) \u5305\u542b\u4f1a\u8bdd\u6b63\u6587",
    description: "\u9ed8\u8ba4\u9009\u4e2d",
    picked: true,
  }),
  Object.freeze({
    privacyKey: "redactPaths",
    label: "$(shield) \u8131\u654f\u672c\u673a\u8def\u5f84",
    description: "\u9ed8\u8ba4\u9009\u4e2d",
    picked: true,
  }),
  Object.freeze({
    privacyKey: "includeToolIO",
    label: "$(tools) \u5305\u542b\u5de5\u5177\u8f93\u5165\u548c\u8f93\u51fa",
    description: "\u9ed8\u8ba4\u4e0d\u9009",
    picked: false,
  }),
  Object.freeze({
    privacyKey: "includeReasoning",
    label: "$(lightbulb) \u5305\u542b\u63a8\u7406\u5185\u5bb9",
    description: "\u9ed8\u8ba4\u4e0d\u9009",
    picked: false,
  }),
  Object.freeze({
    privacyKey: "includeErrors",
    label: "$(warning) \u5305\u542b\u9519\u8bef\u8be6\u60c5\uff08\u8131\u654f\u6458\u8981\uff09",
    description: "\u9ed8\u8ba4\u9009\u4e2d",
    picked: true,
  }),
]);

function normalizeFormat(format) {
  const normalized = String(format || "json").toLowerCase();
  return Object.prototype.hasOwnProperty.call(FORMAT_LABELS, normalized)
    ? normalized
    : "json";
}

function selectedPrivacyOptions(items) {
  const selected = new Set(items.map((item) => item.privacyKey));
  return {
    includeContent: selected.has("includeContent"),
    includeReasoning: selected.has("includeReasoning"),
    includeToolIO: selected.has("includeToolIO"),
    redactPaths: selected.has("redactPaths"),
    includeErrors: selected.has("includeErrors"),
  };
}

async function exportSessionWithPrivacy(options = {}) {
  const { session } = options;
  return exportWithPrivacy({ ...options, sessions: [session], batch: false });
}

async function exportSessionsWithPrivacy(options = {}) {
  const sessions = Array.isArray(options.sessions) ? options.sessions.filter((item) => item?.id) : [];
  if (!sessions.length) return { ok: false, canceled: true, stage: "selection" };
  return exportWithPrivacy({ ...options, sessions, batch: true });
}

async function exportWithPrivacy(options = {}) {
  const { vscode, localProvider, sessions, batch } = options;
  const format = normalizeFormat(options.format);
  const privacyItems = PRIVACY_OPTIONS.map((item) => ({ ...item }));
  const selection = await vscode.window.showQuickPick(privacyItems, {
    canPickMany: true,
    ignoreFocusOut: true,
    title: `${batch ? `\u6279\u91cf\u5bfc\u51fa ${sessions.length} \u4e2a\u4f1a\u8bdd` : "\u5bfc\u51fa\u4f1a\u8bdd"}\u4e3a ${FORMAT_LABELS[format]}`,
    placeHolder:
      "\u9009\u62e9\u5bfc\u51fa\u5185\u5bb9\uff1b\u8bbf\u95ee\u4ee4\u724c\u3001\u5bc6\u94a5\u7b49\u51ed\u636e\u59cb\u7ec8\u8131\u654f",
  });
  if (!selection) return { ok: false, canceled: true, stage: "privacy" };

  const extension = format === "xlsx" ? "xlsx" : format;
  const uri = await vscode.window.showSaveDialog({
    title: `${batch ? `\u6279\u91cf\u5bfc\u51fa ${sessions.length} \u4e2a\u4f1a\u8bdd` : "\u5bfc\u51fa\u4f1a\u8bdd"}\u4e3a ${FORMAT_LABELS[format]}`,
    defaultUri: vscode.Uri.file(
      `${batch ? "codearts-sessions" : localProvider.safeFileStem(sessions[0]?.title || sessions[0]?.id || "codearts-session")}.${extension}`,
    ),
    filters: { [FORMAT_LABELS[format]]: [extension] },
    saveLabel: "\u5bfc\u51fa",
  });
  if (!uri) return { ok: false, canceled: true, stage: "save" };

  const exportOptions = {
    ...(options.providerOptions || {}), format, outputPath: uri.fsPath, ...selectedPrivacyOptions(selection),
  };
  const result = batch
    ? await localProvider.exportSessionsToFile({ ...exportOptions, sessions })
    : await localProvider.exportSessionToFile({ ...exportOptions, sessionId: sessions[0]?.id, source: sessions[0]?.source });
  vscode.window.showInformationMessage(
    `${batch ? `${result.model?.sessions?.length || sessions.length} \u4e2a\u4f1a\u8bdd\u5df2\u5bfc\u51fa` : "\u4f1a\u8bdd\u5df2\u5bfc\u51fa"}\uff1a${path.basename(result.path)}`,
  );
  return {
    ok: true,
    path: result.path,
    format: result.format,
    bytes: result.bytes,
    sessions: batch ? Number(result.model?.sessions?.length || sessions.length) : 1,
  };
}

module.exports = {
  FORMAT_LABELS,
  PRIVACY_OPTIONS,
  normalizeFormat,
  selectedPrivacyOptions,
  exportSessionWithPrivacy,
  exportSessionsWithPrivacy,
};
