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

    // ── File management ──
    readFilesConfig:      ()    => ipcRenderer.invoke('rabbit:read-files-config'),
    writeFilesConfig:     (cfg) => ipcRenderer.invoke('rabbit:write-files-config', cfg),
    pickDirectory:        ()    => ipcRenderer.invoke('rabbit:pick-directory'),
    pickFiles:            ()    => ipcRenderer.invoke('rabbit:pick-files'),
    copyFile:             (opts) => ipcRenderer.invoke('rabbit:copy-file', opts),
    getFileStats:         (opts) => ipcRenderer.invoke('rabbit:get-file-stats', opts),
    openInExplorer:       (opts) => ipcRenderer.invoke('rabbit:open-in-explorer', opts),
    ensureProjectFolder:  (opts) => ipcRenderer.invoke('rabbit:ensure-project-folder', opts),
    pickImage:            ()     => ipcRenderer.invoke('rabbit:pick-image'),
    generateAssetThumbnail: (opts) => ipcRenderer.invoke('rabbit:generate-asset-thumbnail', opts),
    clearAssetThumbnail:  (opts) => ipcRenderer.invoke('rabbit:clear-asset-thumbnail', opts),
    generateEntityThumbnail: (opts) => ipcRenderer.invoke('rabbit:generate-entity-thumbnail', opts),
    clearEntityThumbnail:    (opts) => ipcRenderer.invoke('rabbit:clear-entity-thumbnail', opts),
    onCopyProgress: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('rabbit:copy-progress', handler);
      return () => ipcRenderer.removeListener('rabbit:copy-progress', handler);
    },
  },
});
