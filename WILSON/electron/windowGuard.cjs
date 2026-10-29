// =============================================================================
// windowGuard.cjs — the main window loads WILSON's own page and nothing else
// (D2, night 6 of docs/sessions/PLAN_TO_1_0.md, 2026-10-29;
// docs/design/RECONNECT_DESIGN.md §13.2; OUTSTANDING D1-01).
//
// The preload hands whatever page the main window shows the saved sign-in
// (`wilsonSession`) and the local server's key (`electronAPI`). MEASURED on
// the tip (4728a92d): a page that sends itself to another site lands there
// with both. So the window refuses every navigation that fetches, and every
// server redirect of its top frame, whose destination is not this launch's own
// page (a renderer's navigation to about:blank commits without a fetch and so
// without `will-navigate`; it stays the page's own origin and hands nothing to
// anyone: build review round 1, F2):
// an http address at this launch's origin (http://127.0.0.1:<port>, new at
// every launch, read from the main process at the moment, never a fixed
// string). A refused http(s) address goes to the system browser, as
// window.open's always did, and a mailto: one to the mail app (a link in the
// pet's or O.T.T.E.R.'s answers is a plain anchor: build review round 2, F1);
// nothing else is opened.
//
// window.open: http(s) goes to the system browser (mailto: to the mail app),
// as before; the print
// window (about:blank) and the page's own blob: addresses (receipts,
// invoices) open, measured without bridges; anything else (file:, data:,
// javascript:, any other scheme) is refused and handed to nothing. Each
// window the page opens is guarded the same way (review round, F2): its own
// page is its two starting points or the launch's origin, and it opens no
// window of its own.
//
// A cloud download used to be a navigation of this window to its signed
// address (Chromium turned the attachment into a download and the page
// stayed). Refused now, it would go to the system browser, token and all
// (build review round 1, F1, HIGH), so the page asks the main process
// instead (`wilson:download-url`): only an http(s) address is downloaded,
// in the app, with the same save dialog (`isDownloadAddress`).
//
// Only the top frame: the preload runs there alone (`nodeIntegrationInSubFrames`
// is not set), so a frame inside the page holds no bridge.
//
// Plain functions, and one that wires them to a webContents, so a test can
// reach every rule: main.cjs requires Electron at load and cannot be loaded
// by one. A refusal is logged by its scheme only: an address can carry a
// file's name, and a file's name is content.
// =============================================================================

'use strict';

function parse(url) {
  try { return new URL(String(url)); } catch { return null; }
}

const isWeb = (u) => u.protocol === 'http:' || u.protocol === 'https:';
// What the system may open for the page, as before D2: a web address in the
// system browser, and an email address in the mail app (a link in the pet's
// or O.T.T.E.R.'s answers: build review round 2, F1). Never a file, a
// settings page or any other scheme.
const isForTheSystem = (u) => isWeb(u) || u.protocol === 'mailto:';

/**
 * Is `url` this launch's own page? An http(s) address whose origin is exactly
 * `origin`; for a window the page opened (`child`), also its two starting
 * points, about:blank and a blob: address of `origin`. A blob: reports its
 * inner origin, so the scheme is checked first. Anything unreadable, an
 * origin of 'null' and an origin not yet known are refusals.
 */
function staysOnOwnPage(url, origin, { child = false } = {}) {
  if (typeof origin !== 'string' || !origin || origin === 'null') return false;
  const u = parse(url);
  if (!u) return false;
  if (isWeb(u)) return u.origin === origin;
  if (!child) return false;
  if (u.href === 'about:blank') return true;
  return u.protocol === 'blob:' && u.origin === origin;
}

/**
 * What window.open gets: `{ action: 'allow' | 'deny', external: boolean }`;
 * `external` sends the address to the system browser. A window the page
 * opened (`child`) opens none of its own.
 */
function openDecision(url, origin, { child = false } = {}) {
  const u = parse(url);
  if (!u) return { action: 'deny', external: false };
  if (isForTheSystem(u)) return { action: 'deny', external: true };
  if (child) return { action: 'deny', external: false };
  if (u.href === 'about:blank') return { action: 'allow', external: false };
  if (u.protocol === 'blob:' && typeof origin === 'string' && origin && origin !== 'null' && u.origin === origin) {
    return { action: 'allow', external: false };
  }
  return { action: 'deny', external: false };
}

/** An address's scheme for a log line ("file:"), never the address itself. */
function schemeOf(url) {
  const u = parse(url);
  return u ? u.protocol : 'an unreadable';
}

/**
 * Wire the rules to a window's webContents.
 * @param {object} webContents  Electron's, or a stand-in with on() and setWindowOpenHandler()
 * @param {object} opts
 * @param {() => string|null} opts.origin      this launch's origin, read at the moment
 * @param {(url: string) => void} opts.openExternal
 * @param {(line: string) => void} [opts.log]
 * @param {boolean} [opts.child]               a window the page opened
 */
function guardWindow(webContents, { origin, openExternal, log = () => {}, child = false }) {
  const toBrowser = (url) => {
    try {
      const done = openExternal(url);
      if (done && typeof done.catch === 'function') done.catch(() => {});
    } catch { /* the system browser refused: nothing opens here either */ }
  };
  // Electron 33 hands the event first (its `url`, `isMainFrame`) and the old
  // positional arguments after it; the event is read first.
  webContents.on('will-navigate', (event, legacyUrl) => {
    const url = event?.url ?? legacyUrl;
    if (staysOnOwnPage(url, origin(), { child })) return;
    event.preventDefault();
    const u = parse(url);
    if (u && isForTheSystem(u)) toBrowser(u.href);
    log(`[wilson] the window stays on WILSON's page: a navigation to ${schemeOf(url)} address was refused`);
  });
  webContents.on('will-redirect', (event, legacyUrl, _isInPlace, legacyIsMainFrame) => {
    const isMainFrame = event?.isMainFrame ?? legacyIsMainFrame;
    if (isMainFrame === false) return;
    const url = event?.url ?? legacyUrl;
    if (staysOnOwnPage(url, origin(), { child })) return;
    event.preventDefault();
    log(`[wilson] the window stays on WILSON's page: a redirect to ${schemeOf(url)} address was refused`);
  });
  webContents.setWindowOpenHandler(({ url }) => {
    const d = openDecision(url, origin(), { child });
    if (d.external) toBrowser(url);
    else if (d.action === 'deny') log(`[wilson] a window for ${schemeOf(url)} address was refused`);
    return { action: d.action };
  });
}

/** May the page's download channel download this address in the app? http(s) only. */
function isDownloadAddress(url) {
  const u = parse(url);
  return !!u && isWeb(u);
}

module.exports = { staysOnOwnPage, openDecision, guardWindow, isDownloadAddress };
