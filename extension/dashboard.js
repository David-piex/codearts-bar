"use strict";

const vscode = require("vscode");
const { dashboardHtml } = require("./webview/html");
const { viewModel } = require("./webview/model");
const { safeIdeText } = require("./protocol/query-results");

class DashboardHost {
  constructor(context, getSnapshot, refreshSnapshot, loadDetails, openDataFolder, operations = {}) {
    this.context = context;
    this.getSnapshot = getSnapshot;
    this.refreshSnapshot = refreshSnapshot;
    this.loadDetails = loadDetails;
    this.openDataFolder = openDataFolder;
    this.operations = operations;
    this.targets = new Set();
    this.panel = null;
  }

  attach(webview, mode) {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };
    webview.html = dashboardHtml(webview, this.context.extensionUri, mode);
    const target = {
      webview,
      mode,
      visible: true,
      generation: 0,
      asyncGeneration: { sessions: 0, requests: 0, export: 0 },
      snapshot: null,
      needsReset: false,
      scope: { rangePreset: "today", source: "all", model: "all", project: "all" },
    };
    this.targets.add(target);
    webview.onDidReceiveMessage((message) =>
      this.handleMessage(message, target),
    );
    return target;
  }

  async handleMessage(message, target) {
    if (message?.type === "ready") {
      this.postSnapshot(target);
      const state = message.state || {};
      if (target.visible)
        return this.loadDetails?.({
          reason: "webview-ready",
          target,
          rangePreset: state.range,
          range:
            state.range === "custom"
              ? { start: state.customStart, end: state.customEnd }
              : undefined,
          source: state.sourceFilter,
          model: state.modelFilter,
          project: state.projectFilter,
        });
      return undefined;
    }
    if (message?.type === "refresh") return this.refreshSnapshot({ details: true, reason: "webview-refresh", target });
    if (message?.type === "range") return this.loadDetails?.({ reason: "webview-range", rangePreset: message.preset, range: message.range, target });
    if (message?.type === "filter") return this.loadDetails?.({ reason: "webview-filter", source: message.source, model: message.model, project: message.project, target });
    if (message?.type === "sessionsPage") {
      const generation = ++target.asyncGeneration.sessions;
      try {
        const result = await this.operations.querySessionsPage?.(message);
        if (this.isAsyncCurrent(target, "sessions", generation)) target.webview.postMessage({ type: "sessionsPage", payload: result });
      } catch (error) {
        if (this.isAsyncCurrent(target, "sessions", generation)) target.webview.postMessage({ type: "sessionsPage", payload: { ok: false, error: safeIdeText(error?.message || "会话加载失败") } });
      }
      return undefined;
    }
    if (message?.type === "requestsPage") {
      const generation = ++target.asyncGeneration.requests;
      try {
        const result = await this.operations.queryRequestsPage?.(message);
        if (this.isAsyncCurrent(target, "requests", generation)) target.webview.postMessage({ type: "requestsPage", payload: result });
      } catch (error) {
        if (this.isAsyncCurrent(target, "requests", generation)) target.webview.postMessage({ type: "requestsPage", payload: { ok: false, error: safeIdeText(error?.message || "请求加载失败") } });
      }
      return undefined;
    }
    if (message?.type === "exportSession") {
      const generation = ++target.asyncGeneration.export;
      try {
        const result = await this.operations.exportSession?.(message.session, message.format);
        if (this.isAsyncCurrent(target, "export", generation, false)) target.webview.postMessage({ type: "sessionExported", payload: result });
      } catch (error) {
        if (this.isAsyncCurrent(target, "export", generation, false)) target.webview.postMessage({ type: "sessionExported", payload: { ok: false, error: safeIdeText(error?.message || "会话导出失败") } });
      }
      return undefined;
    }
    if (message?.type === "exportSessions") {
      const generation = ++target.asyncGeneration.export;
      try {
        const result = await this.operations.exportSessions?.(message.sessions, message.format);
        if (this.isAsyncCurrent(target, "export", generation, false)) target.webview.postMessage({ type: "sessionExported", payload: result });
      } catch (error) {
        if (this.isAsyncCurrent(target, "export", generation, false)) target.webview.postMessage({ type: "sessionExported", payload: { ok: false, error: safeIdeText(error?.message || "批量导出失败") } });
      }
      return undefined;
    }
    if (message?.type === "openDashboard") return this.openPanel();
    if (message?.type === "openData") return this.openDataFolder();
    if (message?.type === "settings")
      return vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:local-codearts.codearts-bar-status",
      );
  }

  remove(target) {
    this.invalidateAsync(target);
    this.targets.delete(target);
    this.operations.onVisibilityChanged?.(this.hasTargets());
  }
  setVisible(target, visible, reason = "visibility") {
    if (!target) return;
    const becameVisible = !target.visible && Boolean(visible);
    target.visible = Boolean(visible);
    if (!target.visible) {
      target.generation += 1;
      this.invalidateAsync(target, ["sessions", "requests"]);
    }
    this.operations.onVisibilityChanged?.(this.hasTargets());
    if (!becameVisible) return;
    if (target.needsReset) {
      target.needsReset = false;
      target.webview.postMessage({ type: "reset", generation: target.generation });
    }
    this.postSnapshot(target);
    this.loadDetails?.({ reason, target });
  }
  postSnapshot(target) {
    const snapshot = target?.snapshot;
    if (snapshot)
      target.webview.postMessage({
        type: "snapshot",
        payload: viewModel(snapshot),
        generation: target.generation,
      });
  }
  postDetails(snapshot, target, generation) {
    if (!target?.visible || !this.targets.has(target) || target.generation !== generation)
      return false;
    target.webview.postMessage({
      type: "details",
      payload: viewModel(snapshot),
      generation,
    });
    return true;
  }
  hasTargets() { return [...this.targets].some((target) => target.visible); }
  visibleTargets() { return [...this.targets].filter((target) => target.visible); }
  resetTargets() {
    for (const target of this.targets) {
      target.snapshot = null;
      target.generation += 1;
      this.invalidateAsync(target, ["sessions", "requests"]);
      if (target.visible) target.webview.postMessage({ type: "reset", generation: target.generation });
      else target.needsReset = true;
    }
  }
  invalidateAsync(target, keys) {
    if (!target?.asyncGeneration) return;
    for (const key of keys || Object.keys(target.asyncGeneration)) {
      if (key in target.asyncGeneration) target.asyncGeneration[key] += 1;
    }
  }
  isAsyncCurrent(target, key, generation, requireVisible = true) {
    return Boolean((!requireVisible || target?.visible) && this.targets.has(target) && target.asyncGeneration?.[key] === generation);
  }
  setRefreshing(value, target, generation) {
    if (!target?.visible || !this.targets.has(target) || target.generation !== generation)
      return false;
    target.webview.postMessage({ type: "refreshing", value: Boolean(value), generation });
    return true;
  }

  beginDetails(options = {}) {
    const targets = options.target ? [options.target] : this.visibleTargets();
    const requests = [];
    for (const target of targets) {
      if (!target?.visible || !this.targets.has(target)) continue;
      const scope = { ...target.scope };
      if (options.rangePreset) {
        scope.rangePreset = options.rangePreset;
        scope.range = options.range;
      }
      if (options.source) scope.source = options.source;
      if (options.model) scope.model = options.model;
      if (options.project) scope.project = options.project;
      target.scope = scope;
      this.invalidateAsync(target, ["sessions", "requests"]);
      const generation = ++target.generation;
      this.setRefreshing(true, target, generation);
      requests.push({ target, generation, scope: { ...scope } });
    }
    return requests;
  }

  isCurrent(request) {
    return Boolean(
      request?.target?.visible &&
      this.targets.has(request.target) &&
      request.target.generation === request.generation,
    );
  }

  commitDetails(request, snapshot) {
    if (!this.isCurrent(request)) return false;
    request.target.snapshot = snapshot;
    this.postDetails(snapshot, request.target, request.generation);
    this.setRefreshing(false, request.target, request.generation);
    return true;
  }

  failDetails(request, error) {
    if (!this.isCurrent(request)) return false;
    request.target.webview.postMessage({
      type: "detailsError",
      generation: request.generation,
      payload: { error: safeIdeText(error?.message || "使用分析加载失败，请重试") },
    });
    this.setRefreshing(false, request.target, request.generation);
    return true;
  }

  openPanel() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.postSnapshot(this.panel.__target);
      this.loadDetails?.({ reason: "panel-reveal", target: this.panel.__target });
      return this.panel;
    }
    const panel = vscode.window.createWebviewPanel(
      "codeartsBar.dashboard",
      "\u7801\u9053 \u00b7 \u4f7f\u7528\u5206\u6790",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      "media",
      "codearts.svg",
    );
    panel.__target = this.attach(panel.webview, "dashboard");
    panel.__target.visible = panel.visible;
    this.operations.onVisibilityChanged?.(this.hasTargets());
    panel.onDidChangeViewState((event) =>
      this.setVisible(panel.__target, event.webviewPanel.visible, "panel-visible"),
    );
    panel.onDidDispose(() => {
      this.remove(panel.__target);
      this.panel = null;
    });
    return panel;
  }
}

class OverviewViewProvider {
  constructor(host) {
    this.host = host;
    this.target = null;
  }
  resolveWebviewView(view) {
    const target = this.host.attach(view.webview, "sidebar");
    this.target = target;
    target.visible = view.visible;
    this.host.operations.onVisibilityChanged?.(this.host.hasTargets());
    view.onDidChangeVisibility(() =>
      this.host.setVisible(target, view.visible, "sidebar-visible"),
    );
    view.onDidDispose(() => this.host.remove(target));
  }
}

module.exports = { DashboardHost, OverviewViewProvider };
