const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  testVdoUrl: (url) => ipcRenderer.invoke('test-vdo-url', url),
  generateQr: (text) => ipcRenderer.invoke('generate-qr', text),
  isFirstRun: () => ipcRenderer.invoke('is-first-run'),
  getBuildMeta: () => ipcRenderer.invoke('get-build-meta'),
  listAudioDevices: () => ipcRenderer.invoke('list-audio-devices'),
  startAudioCapture: (uid, nCh) => ipcRenderer.invoke('start-audio-capture', uid, nCh),
  stopAudioCapture: () => ipcRenderer.invoke('stop-audio-capture'),
  connectLine: (id, url, channelId) => ipcRenderer.invoke('connect-line', { id, url, channelId }),
  disconnectLine: (id) => ipcRenderer.invoke('disconnect-line', id),
});
