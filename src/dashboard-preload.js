'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invokeChannels = new Set([
  'dashboard:getRuntimeInfo',
  'dashboard:getInitialSummary',
  'dashboard:getSnapshot',
  'dashboard:getRequestsPage',
  'dashboard:getSessionRequestsPage',
  'dashboard:getSessionsPage',
  'dashboard:getAggregates',
  'dashboard:refreshLight',
  'dashboard:refreshFull',
  'dashboard:settings',
  'dashboard:setLayoutMode',
  'dashboard:setPinned',
  'dashboard:setRefreshInterval',
  'dashboard:log',
  'dashboard:rendererError',
  'dashboard:getDiagnostics',
  'dashboard:openSession',
  'dashboard:openCodeArtsSession',
  'dashboard:copySession',
  'dashboard:exportSession',
  'dashboard:exportSessions',
  'dashboard:openLogs',
  'dashboard:archiveSession',
  'dashboard:renameSession',
]);
const eventChannels = new Set(['dashboard:snapshot', 'dashboard:rollupState']);

contextBridge.exposeInMainWorld('codeartsApi', Object.freeze({
  invoke(channel, ...args) {
    if (!invokeChannels.has(channel)) return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, listener) {
    if (!eventChannels.has(channel) || typeof listener !== 'function') return () => {};
    const wrapped = (_event, ...args) => listener(Object.freeze({ sender: 'main' }), ...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
}));
