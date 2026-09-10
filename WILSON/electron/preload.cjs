const { contextBridge, ipcRenderer } = require('electron');

// ── Cloud session bridge ──
// Persists the Supabase session via main process safeStorage (Electron's
// OS-native keychain wrapper). Renderer never sees the encryption key.
contextBridge.exposeInMainWorld('wilsonSession', {
  save:  (session) => ipcRenderer.invoke('wilson:session-save', session),
  load:  ()        => ipcRenderer.invoke('wilson:session-load'),
  clear: ()        => ipcRenderer.invoke('wilson:session-clear'),
});

contextBridge.exposeInMainWorld('electronAPI', {
  sentryTest: () => ipcRenderer.invoke('wilson:sentry-test'),
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
  // Session 9 auto-update (electron/updater.cjs). Status events:
  // { state, info?, progress?, error? } — see updater.cjs header.
  updates: {
    getState: () => ipcRenderer.invoke('wilson:update-state'),
    check: () => ipcRenderer.invoke('wilson:update-check'),
    download: () => ipcRenderer.invoke('wilson:update-download'),
    install: () => ipcRenderer.invoke('wilson:update-install'),
    onStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('wilson:update-status', handler);
      return () => ipcRenderer.removeListener('wilson:update-status', handler);
    },
  },

  // ── Demo sprint (2026-09-10): the local demo folder ──
  // One user-chosen folder holds the whole signed-out demo
  // (electron/localDemoRoot.cjs). `pick` runs the OS dialog; `open`
  // re-opens a remembered folder from the recent list (or confirms a
  // just-picked one that holds other files); `close` returns to app data.
  localDemo: {
    getState:       ()     => ipcRenderer.invoke('local-demo:get-state'),
    pick:           ()     => ipcRenderer.invoke('local-demo:pick'),
    open:           (opts) => ipcRenderer.invoke('local-demo:open', opts),
    close:          ()     => ipcRenderer.invoke('local-demo:close'),
    forget:         (opts) => ipcRenderer.invoke('local-demo:forget', opts),
    openInExplorer: ()     => ipcRenderer.invoke('local-demo:open-in-explorer'),
  },

  // ── RABBIT config bridge ──
  // Supabase credentials are centralised: the shared client in
  // src/cloud/auth/supabaseClient.js is configured by VITE_SUPABASE_URL
  // + VITE_SUPABASE_ANON_KEY at build time, and receives its session via
  // the safeStorage-backed session IPC (contextBridge `wilsonSession`).
  // The Session 1 per-project supabase.json fallback was removed in
  // Session 2; the read/write/clear handlers were deleted from main.cjs.
  rabbit: {
    readGdriveConfig:    ()    => ipcRenderer.invoke('rabbit:read-gdrive-config'),
    writeGdriveConfig:   (cfg) => ipcRenderer.invoke('rabbit:write-gdrive-config', cfg),
    readGdriveTokens:    ()    => ipcRenderer.invoke('rabbit:read-gdrive-tokens'),
    writeGdriveTokens:   (tk)  => ipcRenderer.invoke('rabbit:write-gdrive-tokens', tk),
    clearGdrive:         ()    => ipcRenderer.invoke('rabbit:clear-gdrive'),

    // ── File management ──
    archiveLocalData:     ()    => ipcRenderer.invoke('rabbit:archive-local-data'),
    readFilesConfig:      ()    => ipcRenderer.invoke('rabbit:read-files-config'),
    writeFilesConfig:     (cfg) => ipcRenderer.invoke('rabbit:write-files-config', cfg),
    // Session 34: the workspace storage root. App.jsx pushes the byos root
    // after loading workspace_storage (and null on sign-out); the Admin
    // Terminal's Storage section probes a candidate before saving it.
    setWorkspaceRoot:     (opts) => ipcRenderer.invoke('rabbit:set-workspace-root', opts),
    probeStorageRoot:     (opts) => ipcRenderer.invoke('rabbit:probe-storage-root', opts),
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
