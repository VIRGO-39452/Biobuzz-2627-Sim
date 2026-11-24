// Exposes the one desktop-only capability the dashboard needs: a native folder picker.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ftcsim', { desktop: true, pickFolder: () => ipcRenderer.invoke('pick-folder') });
