"use strict";

try {
  localStorage.clear();
  localStorage.setItem("workspaceMode", "analytics");
  localStorage.setItem("statsTableTab", "requests");
  localStorage.setItem("statsSource", "all");
  localStorage.setItem("statsRange", "all");
  localStorage.setItem("statsModel", "all");
  localStorage.setItem("layoutMode", "dashboard");
  localStorage.setItem("uiZoom", "1");
  localStorage.setItem("chartSeries", "total,input,output,cacheRead");
  localStorage.setItem("requestPageSize", "20");
  localStorage.setItem("sessionPageSize", "20");
} catch {}


const { contextBridge, ipcRenderer } = require('electron');
const invokeChannels = new Set([
  'dashboard:getRuntimeInfo', 'dashboard:getInitialSummary', 'dashboard:getSnapshot',
  'dashboard:getRequestsPage', 'dashboard:getSessionRequestsPage', 'dashboard:getSessionsPage',
  'dashboard:getAggregates', 'dashboard:refreshLight', 'dashboard:refreshFull', 'dashboard:settings', 'dashboard:setLayoutMode', 'dashboard:setPinned',
  'dashboard:log', 'dashboard:rendererError', 'dashboard:getDiagnostics', 'dashboard:openSession',
  'dashboard:openCodeArtsSession', 'dashboard:copySession', 'dashboard:openLogs',
  'dashboard:archiveSession', 'dashboard:renameSession', 'dashboard:e2eSetPageTotalOverride', 'dashboard:e2eSetRefreshDelay',
]);
contextBridge.exposeInMainWorld('codeartsApi', Object.freeze({
  invoke(channel, ...args) {
    if (!invokeChannels.has(channel)) return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, listener) {
    if (channel !== 'dashboard:snapshot' || typeof listener !== 'function') return () => {};
    const wrapped = (_event, ...args) => listener(Object.freeze({ sender: 'main' }), ...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
}));
