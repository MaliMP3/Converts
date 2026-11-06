const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('converts', {
  onOpen(callback) {
    ipcRenderer.on('wheel-open', (_event, payload) => callback(payload));
  },
  onSource(callback) {
    ipcRenderer.on('wheel-source', (_event, source) => callback(source));
  },
  pick(lane) {
    return ipcRenderer.invoke('pick-file', lane || 'file');
  },
  convert(formatId) {
    return ipcRenderer.invoke('convert', formatId);
  },
  beginConvert(formatId, lane) {
    return ipcRenderer.invoke('begin-convert', { formatId, lane: lane || 'file' });
  },
  close() {
    return ipcRenderer.invoke('close-wheel');
  },
  onCard(callback) {
    ipcRenderer.on('card-state', (_event, state) => callback(state));
  },
  dismissCard() {
    return ipcRenderer.invoke('dismiss-card');
  },
  openResult() {
    return ipcRenderer.invoke('open-result');
  },
  openFile() {
    return ipcRenderer.invoke('open-file');
  },
  getShortcuts() {
    return ipcRenderer.invoke('get-shortcuts');
  },
  saveShortcuts(custom, keepDefault) {
    return ipcRenderer.invoke('save-shortcuts', { custom, keepDefault });
  },
  resetShortcuts() {
    return ipcRenderer.invoke('reset-shortcuts');
  },
});
