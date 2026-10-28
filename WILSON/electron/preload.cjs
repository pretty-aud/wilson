const { contextBridge, ipcRenderer, webUtils } = require('electron');

// ── Cloud session bridge ──
// Persists the Supabase session via main process safeStorage (Electron's
// OS-native keychain wrapper). Renderer never sees the encryption key.
contextBridge.exposeInMainWorld('wilsonSession', {
  save:  (session) => ipcRenderer.invoke('wilson:session-save', session),
  load:  ()        => ipcRenderer.invoke('wilson:session-load'),
  clear: ()        => ipcRenderer.invoke('wilson:session-clear'),
});

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Bundle B3: the per-launch loopback token ──────────────────────────────
  // Every /api request the desktop server answers must carry this in the
  // `x-wilson-local-token` header or in the httpOnly cookie main sets.
  // src/lib/localServerFetch.js reads it here and attaches the header — and
  // attaches it ONLY to same-origin URLs, so the launch secret can never leave
  // the machine on a call that was widened later.
  //
  // Behind the contextBridge on purpose: the web build has no `electronAPI` at
  // all, so nothing there can see this, and no page loaded outside the preload
  // can reach it either. Read synchronously at preload time (see main.cjs) so
  // the renderer's first fetch already has it.
  localServerToken: ipcRenderer.sendSync('wilson:local-server-token'),
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
    reset:          ()     => ipcRenderer.invoke('local-demo:reset'),
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
    // Post-overhaul S4a (E9): open a desktop row in its default app, or reveal
    // it — the row is named ({ source, projectId, fileId } or { source:
    // 'media', mediaKey }), main resolves the path. → { ok, error? }
    openPath:             (opts) => ipcRenderer.invoke('rabbit:open-path', opts),
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
    // Bins (demo 2026-09-11): the absolute path of a File the user DROPPED on
    // the window. Electron 33 removed the nonstandard `File.path`; this is the
    // supported way, and it only exists in the preload. Returns '' when the
    // File did not come from disk (a paste, a fetch).
    getPathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  },
});

// ── D1 (night 4, 2026-10-28): the renderer's storage, kept across a relaunch ──
// docs/design/RECONNECT_DESIGN.md §12 and electron/rendererStorage.cjs. Every
// launch is a new origin (listen(0)'s port), so Chromium's localStorage starts
// empty; the main process keeps the keys in a userData file instead. Inline,
// because a sandboxed preload loads only Electron's own modules, and AFTER both
// bridges, wrapped whole, so nothing here can keep `wilsonSession` or
// `electronAPI` from existing (design review, F1).
//
// At every load the kept pairs are the baseline the page's storage is compared
// with, so a reload after a renderer crash sends what never reached the main
// process (F6); at the launch's first load the origin is made exactly those
// pairs before the page's first script. What changed goes back once a second,
// when the window is hidden (its timers are throttled: F7) and at pagehide,
// synchronously there. A refused sender gets no seed and sends nothing.
try {
  const store = window.localStorage;
  const seed = ipcRenderer.sendSync('wilson:renderer-storage-seed');
  if (store && seed && Array.isArray(seed.pairs)) {
    if (seed.first) {
      store.clear();
      for (const [key, value] of seed.pairs) {
        try { store.setItem(key, value); } catch { /* quota: the page starts with what fitted */ }
      }
    }
    const read = () => {
      const now = new Map();
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key !== null) now.set(key, store.getItem(key));
      }
      return now;
    };
    let last = new Map(seed.pairs);
    const flush = (sync) => {
      try {
        const now = read();
        const set = [];
        const removed = [];
        for (const [key, value] of now) if (last.get(key) !== value) set.push([key, value]);
        for (const key of last.keys()) if (!now.has(key)) removed.push(key);
        if (set.length || removed.length) {
          if (sync) ipcRenderer.sendSync('wilson:renderer-storage-changes-sync', { set, removed });
          else ipcRenderer.send('wilson:renderer-storage-changes', { set, removed });
        }
        // Only once the change set has left (build review, F3): a send that
        // threw leaves the baseline where it was, so the next flush sends it.
        last = now;
      } catch { /* the baseline did not move: the next flush sends it again */ }
    };
    setInterval(() => flush(false), 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(false); });
    window.addEventListener('pagehide', () => flush(true));
  }
} catch { /* the page keeps Chromium's own storage for this launch */ }
