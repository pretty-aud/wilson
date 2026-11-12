// =============================================================================
// dropGuard — a file dropped where nothing takes it does nothing (D2, night 6
// of docs/sessions/PLAN_TO_1_0.md, 2026-10-29; docs/design/RECONNECT_DESIGN.md
// §13.2; OUTSTANDING D1-01).
//
// A file drop nothing handled is the browser's to finish, and a browser's way
// is to open the file in place of the page: WILSON's page gone, in a browser
// tab, or in the desktop window were Electron's own `navigateOnDragDrop` ever
// turned on (measured on a control build: the file became the page and was
// handed the saved sign-in and the local server's key). The main process
// refuses that navigation as well (electron/windowGuard.cjs); this is the
// page's half, on both builds.
//
// One listener pair on the WINDOW, bubble phase, installed once by main.jsx:
// it runs after every listener on the document and below it — Bins' own
// drop-anywhere-on-this-tab (BinsView.jsx, at the document, which reads
// `defaultPrevented` as "a zone took it") included, whatever was registered
// first — and it never stops an event or touches one a zone handled. It acts
// on drags that carry files only, as Bins' listener does (review round, F1):
// a text or link drag, the app's own drag-and-drop and a text field's own
// drop are the browser's and the app's as before. The cursor says the file is
// not taken.
// =============================================================================

/** Does this drag carry files from the computer? */
export function carriesFiles(e) {
  try { return Array.from(e?.dataTransfer?.types || []).includes('Files') } catch { return false }
}

/** True when the guard takes this event: a file drag nothing handled. */
export function guardsThisDrag(e) {
  return !!e && !e.defaultPrevented && carriesFiles(e)
}

/**
 * Install the guard on `target` (the window). Returns the detach function.
 */
export function installDropGuard(target = typeof window !== 'undefined' ? window : null) {
  if (!target || typeof target.addEventListener !== 'function') return () => {}
  const over = (e) => {
    if (!guardsThisDrag(e)) return
    e.preventDefault()
    try { e.dataTransfer.dropEffect = 'none' } catch { /* not settable on this event */ }
  }
  const drop = (e) => {
    if (!guardsThisDrag(e)) return
    e.preventDefault()
  }
  target.addEventListener('dragover', over)
  target.addEventListener('drop', drop)
  return () => {
    target.removeEventListener('dragover', over)
    target.removeEventListener('drop', drop)
  }
}
