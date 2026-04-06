const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  forceClose: () => ipcRenderer.invoke('window-force-close'),
  zoomIn: () => ipcRenderer.invoke('zoom-in'),
  zoomOut: () => ipcRenderer.invoke('zoom-out'),
  zoomReset: () => ipcRenderer.invoke('zoom-reset'),
  zoomGet: () => ipcRenderer.invoke('zoom-get'),
  onCloseRequested: (callback) => {
    ipcRenderer.on('close-requested', callback);
    return () => ipcRenderer.removeListener('close-requested', callback);
  },
  onZoomReset: (callback) => {
    const handler = (_event, level) => callback(level);
    ipcRenderer.on('zoom-reset-notify', handler);
    return () => ipcRenderer.removeListener('zoom-reset-notify', handler);
  },

  // ── RABBIT config bridge ──
  // Used by the Supabase adapter to read/write credentials stored
  // at {userData}/rabbit-data/supabase.json.
  rabbit: {
    readSupabaseConfig:  ()    => ipcRenderer.invoke('rabbit:read-supabase-config'),
    writeSupabaseConfig: (cfg) => ipcRenderer.invoke('rabbit:write-supabase-config', cfg),
    clearSupabaseConfig: ()    => ipcRenderer.invoke('rabbit:clear-supabase-config'),
    readGdriveConfig:    ()    => ipcRenderer.invoke('rabbit:read-gdrive-config'),
    writeGdriveConfig:   (cfg) => ipcRenderer.invoke('rabbit:write-gdrive-config', cfg),
    readGdriveTokens:    ()    => ipcRenderer.invoke('rabbit:read-gdrive-tokens'),
    writeGdriveTokens:   (tk)  => ipcRenderer.invoke('rabbit:write-gdrive-tokens', tk),
    clearGdrive:         ()    => ipcRenderer.invoke('rabbit:clear-gdrive'),
  },
});
