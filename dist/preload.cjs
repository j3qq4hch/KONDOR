const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kondor', {
  // GLB import
  openFile:       () => ipcRenderer.invoke('dialog:openFile'),

  // BRD import
  openBrd:        () => ipcRenderer.invoke('dialog:openBrd'),
  loadBrd:        (p) => ipcRenderer.invoke('board:loadBrd', p),
  getMtime:       (p) => ipcRenderer.invoke('board:getMtime', p),
  updateBoard:    (p) => ipcRenderer.invoke('board:update', p),
  openInEagle:    (p) => ipcRenderer.invoke('board:openInEagle', p),
  unwatchBoard:   (p) => ipcRenderer.invoke('board:unwatch', p),

  // Device file (.kdev)
  saveDevice:     (data, filePath) => ipcRenderer.invoke('device:save', { data, filePath }),
  loadDevice:     () => ipcRenderer.invoke('device:load'),
  loadDeviceFile: (p) => ipcRenderer.invoke('device:loadFile', p),

  // Settings
  getSettings:    () => ipcRenderer.invoke('settings:get'),
  setSettings:    (d) => ipcRenderer.invoke('settings:set', d),

  // Export
  exportScene:    (buf) => ipcRenderer.invoke('scene:export', buf),

  // GLB file watching
  watchGlb:       (p) => ipcRenderer.invoke('glb:watch', p),
  unwatchGlb:     (p) => ipcRenderer.invoke('glb:unwatch', p),

  // Events from main → renderer
  onBrdModified:  (cb) => ipcRenderer.on('brd:modified', (_e, path) => cb(path)),
  onGlbModified:  (cb) => ipcRenderer.on('glb:modified', (_e, path) => cb(path)),
});
