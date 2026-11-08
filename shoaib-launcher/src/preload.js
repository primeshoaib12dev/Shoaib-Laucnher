'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shoaib', {
  async call(method, ...args) {
    const r = await ipcRenderer.invoke('svc', method, ...args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
  async openInstanceFolder(id, sub) { const r = await ipcRenderer.invoke('open-instance-folder', id, sub); if (!r.ok) throw new Error(r.error); },
  winControl: (a) => ipcRenderer.invoke('win-control', a),
  onWinState: (cb) => ipcRenderer.on('win-state', (_e, v) => cb(v)),
  afterSave: async () => {},
  pickFile: (o) => ipcRenderer.invoke('pick-file', o),
  pickSave: (o) => ipcRenderer.invoke('pick-save', o),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  relaunch: () => ipcRenderer.invoke('relaunch'),
  openExternal: (u) => ipcRenderer.invoke('open-external', u),
  openLauncherFolder: () => ipcRenderer.invoke('open-launcher-folder'),
  pickJava: () => ipcRenderer.invoke('pick-java'),
  onEvent(cb) { ipcRenderer.on('evt', (_e, name, payload) => cb(name, payload)); },
});
