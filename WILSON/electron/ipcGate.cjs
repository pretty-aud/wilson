// =============================================================================
// ipcGate.cjs — every channel the preload bridges answers WILSON's own page
// and nobody else (D3, night 7 of docs/sessions/PLAN_TO_1_0.md, 2026-10-29;
// docs/design/RECONNECT_DESIGN.md §14; OUTSTANDING D2-02).
//
// The preload hands whatever page runs it the saved sign-in (`wilsonSession`),
// the local server's key (`electronAPI.localServerToken`) and fifty channels
// into this process. MEASURED on the tip (bb14b169, a development build, a
// scratch userData): a page that held the preload but was not WILSON's — the
// main window's top frame showing another page, another window given the
// preload, a frame given it — was handed the key, the session and every
// channel but D1's storage and D2's download, the only four that asked who
// was calling. D2's window lock keeps every other page out of the main window,
// and the windows it opens never get the preload (measured): this is the
// second lock behind it. Every channel now asks, with D1's rule
// (rendererStorage.cjs's `acceptsSender` through main.cjs's
// `fromThisLaunchsPage`: the main window's own webContents, its top frame,
// this launch's origin, read at each call), through one registration.
//
// main.cjs makes ONE gate and binds the name `ipcMain` to it, so every
// `ipcMain.handle(` and `ipcMain.on(` there is registered through it, and
// updater.cjs is handed the same gate. Electron's own ipcMain is named once,
// in main.cjs, and handed to the gate. src/lib/ipcGate.test.js proves, by a
// parse, that no file in electron/ registers past it.
//
// An accepted call gets exactly what it got before. A refused one gets
// nothing and is never left waiting: an invoke resolves null, a synchronous
// message is answered null (its page would otherwise block) and an
// asynchronous one is dropped; the handler never runs. The answer comes
// first; then one line, the channel and the asking frame's scheme — never its
// address (an address can carry a file's name, and a file's name is content),
// never a value — once per channel and scheme, so a page that asks in a loop
// cannot fill the log.
//
// Plain functions, no Electron: a test reaches every rule (main.cjs requires
// Electron at load and cannot be loaded by one).
// =============================================================================

'use strict';

/** The asking frame's scheme for the log line ('file:'), never its address; 'unknown' for a frame that is gone. */
function schemeOf(event) {
  try {
    return new URL(String(event.senderFrame.url)).protocol;
  } catch {
    return 'unknown';
  }
}

/**
 * The gate: Electron's ipcMain, with every channel asking the sender rule first.
 * @param {object} opts
 * @param {{ handle: Function, on: Function }} opts.ipcMain  Electron's, or a stand-in
 * @param {(event: object) => boolean} opts.accepts         the sender rule, read at each call, never at registration
 * @param {(line: string) => void} [opts.log]
 * @returns {{ handle: Function, on: Function, isGate: true }}
 */
function createIpcGate({ ipcMain, accepts, log = () => {} } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.on !== 'function') {
    throw new TypeError("createIpcGate: Electron's ipcMain is needed");
  }
  if (typeof accepts !== 'function') throw new TypeError('createIpcGate: the sender rule is needed');
  const said = new Set();
  const listened = new Set();

  const allows = (event) => {
    try { return accepts(event) === true; } catch { return false; }
  };
  const tell = (channel, event) => {
    const scheme = schemeOf(event);
    const key = `${channel} ${scheme}`;
    if (said.has(key)) return;
    said.add(key);
    try {
      log(`[wilson] the bridge answers WILSON's page only: ${channel} was refused (the asking page's scheme: ${scheme})`);
    } catch { /* a log that throws never reaches the caller */ }
  };

  return Object.freeze({
    isGate: true,
    /** ipcMain.handle, gated: a refused invoke resolves null and its handler never runs. */
    handle(channel, handler) {
      if (typeof handler !== 'function') throw new TypeError(`ipcGate: ${channel} needs a handler`);
      ipcMain.handle(channel, (event, ...args) => {
        if (allows(event)) return handler(event, ...args);
        tell(channel, event);
        return null;
      });
    },
    /**
     * ipcMain.on, gated: a refused message is answered null (a synchronous
     * one would leave its page blocked) or dropped, and its listener never
     * runs. One listener per channel, so a synchronous one is answered once.
     */
    on(channel, listener) {
      if (typeof listener !== 'function') throw new TypeError(`ipcGate: ${channel} needs a listener`);
      if (listened.has(channel)) throw new Error(`ipcGate: ${channel} already has its listener`);
      listened.add(channel);
      ipcMain.on(channel, (event, ...args) => {
        if (allows(event)) {
          listener(event, ...args);
          return;
        }
        // The answer first: nothing after it may leave a refused page waiting.
        try { event.returnValue = null; } catch { /* an asynchronous message has no answer to set */ }
        tell(channel, event);
      });
    },
  });
}

module.exports = { createIpcGate };
