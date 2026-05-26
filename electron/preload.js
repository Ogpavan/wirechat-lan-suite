const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
});

contextBridge.exposeInMainWorld('lanChat', {
  startHost: (options) => ipcRenderer.invoke('chat:start-host', options),
  getDeviceId: () => ipcRenderer.invoke('chat:get-device-id'),
});

contextBridge.exposeInMainWorld('wirechatNotifications', {
  show: (options) => ipcRenderer.invoke('notification:show', options),
});
