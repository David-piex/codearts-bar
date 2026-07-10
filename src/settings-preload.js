'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invokeChannels = new Set(['settings:get', 'settings:set', 'diagnose:get']);
contextBridge.exposeInMainWorld('codeartsApi', Object.freeze({
  invoke(channel, ...args) {
    if (!invokeChannels.has(channel)) return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
}));
