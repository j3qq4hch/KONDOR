import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('kondor', {
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
});
