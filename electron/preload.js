const { contextBridge, ipcRenderer } = require('electron');
const { shell } = require('electron');

contextBridge.exposeInMainWorld('electronWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
});

contextBridge.exposeInMainWorld('wirechatApp', {
  getInfo: () => ipcRenderer.invoke('app:get-info'),
  configureUpdates: (options) => ipcRenderer.invoke('app:configure-updates', options),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onUpdateStatus: (callback) => {
    const listener = (_, status) => callback?.(status);
    ipcRenderer.on('app:update-status', listener);
    return () => ipcRenderer.removeListener('app:update-status', listener);
  },
});

contextBridge.exposeInMainWorld('lanChat', {
  startHost: (options) => ipcRenderer.invoke('chat:start-host', options),
  getDeviceId: () => ipcRenderer.invoke('chat:get-device-id'),
  getServiceStatus: () => ipcRenderer.invoke('chat:get-service-status'),
});

contextBridge.exposeInMainWorld('wirechatNotifications', {
  show: (options) => ipcRenderer.invoke('notification:show', options),
  onOpenChat: (callback) => {
    const listener = (_, target) => callback?.(target);
    ipcRenderer.on('notification:open-chat', listener);
    return () => ipcRenderer.removeListener('notification:open-chat', listener);
  },
});

contextBridge.exposeInMainWorld('wirechatRemoteControl', {
  start: () => ipcRenderer.invoke('remote-control:start'),
  stop: () => ipcRenderer.invoke('remote-control:stop'),
  input: (input) => ipcRenderer.invoke('remote-control:input', input),
});

contextBridge.exposeInMainWorld('wirechatShell', {
  openExternal: (url) => shell.openExternal(url),
});
