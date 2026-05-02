import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kondor', {
  openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
});
