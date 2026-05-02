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

  // Connection Butler
  openConBut:          (boards, layout) => ipcRenderer.invoke('conbut:open', { boards, layout }),
  showInModel:         (conId)          => ipcRenderer.invoke('conbut:show-in-model', conId),
  openPinout:          (data)           => ipcRenderer.invoke('conbut:open-pinout', data),
  setConId:            (brdPath, refDes, value) => ipcRenderer.invoke('brd:set-conid', { brdPath, refDes, value }),
  updateConButLayout:  (layout)         => ipcRenderer.invoke('conbut:update-layout', layout),
  getConButLayout:     ()               => ipcRenderer.invoke('conbut:get-layout'),
  onConButInit:        (cb) => ipcRenderer.on('conbut:init',      (_e, data) => cb(data)),
  onPinoutInit:        (cb) => ipcRenderer.on('pinout:init',      (_e, data) => cb(data)),
  onShowConId:         (cb) => ipcRenderer.on('conbut:show-conid',(_e, conId) => cb(conId)),
  showBoardInModel:    (entityId) => ipcRenderer.invoke('conbut:show-board', entityId),
  onShowBoard:         (cb) => ipcRenderer.on('conbut:show-board', (_e, entityId) => cb(entityId)),

  // Notes (sidecar .md files)
  openNote:  (conId) => ipcRenderer.invoke('notes:open', conId),
  readNote:  (conId) => ipcRenderer.invoke('notes:read', conId),
  listNotes: ()      => ipcRenderer.invoke('notes:list'),
});
