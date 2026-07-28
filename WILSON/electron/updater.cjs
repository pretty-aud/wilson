// =============================================================================
// updater.cjs — Session 9 auto-update (locked decisions #10/#15:
// electron-updater + Backblaze B2 generic hosting).
//
// Feed URL comes from WILSON_UPDATE_URL (env.json in packaged builds, so
// operators can repoint without a rebuild; electron-builder's publish.url
// is only the baked-in default). The auto-updatable artifact is the NSIS
// build (`npm run dist` → electron-builder); Squirrel/Forge builds carry no
// app-update.yml, so initUpdater degrades to state 'unsupported' instead of
// throwing — Settings shows "manual update required" and the login prompt
// stays silent.
//
// autoDownload=false: the renderer owns the Update / Skip decision (login
// prompt + Settings panel). All state flows to the renderer as
// 'wilson:update-status' push events: { state, info?, progress?, error? }
// with state ∈ checking | available | not-available | downloading |
// downloaded | error | unsupported | disabled.
// =============================================================================

const { ipcMain } = require('electron');

let autoUpdater = null;
let statusSink = null;      // BrowserWindow.webContents getter
let lastStatus = { state: 'disabled' };
let downloadStarted = false;

function send(status) {
  lastStatus = status;
  try {
    const wc = statusSink?.();
    if (wc && !wc.isDestroyed()) wc.send('wilson:update-status', status);
  } catch { /* window gone — state is re-queried via wilson:update-state */ }
}

function initUpdater({ app, getWebContents, getMainWindow }) {
  statusSink = getWebContents;

  // Renderer can always ask for the latest state (mount-time sync).
  ipcMain.handle('wilson:update-state', () => lastStatus);

  const feedUrl = process.env.WILSON_UPDATE_URL || null;
  const devOverride = process.env.WILSON_UPDATE_DEV === '1';
  if (!app.isPackaged && !devOverride) {
    lastStatus = { state: 'disabled', reason: 'dev' };
    registerNoopHandlers();
    return;
  }

  try {
    // Lazy require: keeps startup resilient if the dependency is missing
    // (e.g. a stripped build).
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    lastStatus = { state: 'unsupported', reason: 'module-missing' };
    registerNoopHandlers();
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  if (feedUrl) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    } catch (err) {
      lastStatus = { state: 'unsupported', reason: `bad-feed: ${err.message}` };
      registerNoopHandlers();
      return;
    }
  }

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    // A fresh offer re-arms the download latch (a prior success would
    // otherwise brick every later prompt at 'downloading 0%').
    downloadStarted = false;
    send({
      state: 'available',
      info: { version: info?.version ?? null, releaseDate: info?.releaseDate ?? null },
    });
  });
  autoUpdater.on('update-not-available', () => { downloadStarted = false; send({ state: 'not-available' }); });
  autoUpdater.on('download-progress', (p) => {
    send({ state: 'downloading', progress: { percent: Math.round(p?.percent ?? 0) } });
  });
  autoUpdater.on('update-downloaded', (info) => send({
    state: 'downloaded',
    info: { version: info?.version ?? null },
  }));
  autoUpdater.on('error', (err) => {
    downloadStarted = false;
    // Missing app-update.yml (non-NSIS build) surfaces here on first check.
    const msg = err?.message ?? String(err);
    if (/app-update\.yml/i.test(msg)) {
      send({ state: 'unsupported', reason: 'no-app-update-yml' });
    } else {
      send({ state: 'error', error: msg });
    }
  });

  ipcMain.handle('wilson:update-check', async () => {
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('wilson:update-download', async () => {
    if (downloadStarted) {
      // Re-broadcast the current state so a UI that missed the events
      // (e.g. prompt reopened) can resync instead of spinning forever.
      send(lastStatus);
      return { ok: true, already: true };
    }
    downloadStarted = true;
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      downloadStarted = false;
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('wilson:update-install', () => {
    // The close intercept (main.cjs) refuses to quit unless _forceClose is
    // set — without this line quitAndInstall silently no-ops.
    const win = getMainWindow?.();
    if (win) win._forceClose = true;
    try { autoUpdater.quitAndInstall(); } catch { /* app quits via installer */ }
    return { ok: true };
  });

  lastStatus = { state: 'idle' };
}

function registerNoopHandlers() {
  ipcMain.handle('wilson:update-check', () => ({ ok: false, error: lastStatus.reason ?? lastStatus.state }));
  ipcMain.handle('wilson:update-download', () => ({ ok: false, error: lastStatus.reason ?? lastStatus.state }));
  ipcMain.handle('wilson:update-install', () => ({ ok: false, error: lastStatus.reason ?? lastStatus.state }));
}

module.exports = { initUpdater };
