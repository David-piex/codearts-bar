"use strict";

const vscode = require("vscode");
const { dashboardHtml } = require("./webview/html");
const { viewModel } = require("./webview/model");

class DashboardHost {
  constructor(context, getSnapshot, refreshSnapshot, openDataFolder) {
    this.context = context;
    this.getSnapshot = getSnapshot;
    this.refreshSnapshot = refreshSnapshot;
    this.openDataFolder = openDataFolder;
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
    const target = { webview, mode };
    this.targets.add(target);
    webview.onDidReceiveMessage((message) =>
      this.handleMessage(message, target),
    );
    return target;
  }

  async handleMessage(message, target) {
    if (message?.type === "ready") return this.postSnapshot(target);
    if (message?.type === "refresh") return this.refreshSnapshot();
    if (message?.type === "openDashboard") return this.openPanel();
    if (message?.type === "openData") return this.openDataFolder();
    if (message?.type === "settings")
      return vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:local-codearts.codearts-bar-status",
      );
  }

  remove(target) {
    this.targets.delete(target);
  }
  postSnapshot(target) {
    const snapshot = this.getSnapshot();
    if (snapshot)
      target.webview.postMessage({
        type: "snapshot",
        payload: viewModel(snapshot),
      });
  }
  broadcast(snapshot) {
    const payload = viewModel(snapshot);
    for (const target of this.targets)
      target.webview.postMessage({ type: "snapshot", payload });
  }
  setRefreshing(value) {
    for (const target of this.targets)
      target.webview.postMessage({ type: "refreshing", value: Boolean(value) });
  }

  openPanel() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.postSnapshot(this.panel.__target);
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
    this.target = this.host.attach(view.webview, "sidebar");
    view.onDidDispose(() => this.host.remove(this.target));
  }
}

module.exports = { DashboardHost, OverviewViewProvider };
