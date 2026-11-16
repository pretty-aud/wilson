// =============================================================================
// spaFallback.cjs — the Local Server's SPA fallback: an in-app address that no
// route and no static file answered gets the app's index.html.
//
// 🚨 ROOT-RELATIVE, never an absolute path. `send` (under res.sendFile)
// refuses a path with a dot-directory segment while `dotfiles` is 'ignore',
// its default, and with an absolute path it checks EVERY segment. A dist under
// a dot-folder — a session's worktree, `…\WILSON\.claude\worktrees\…`, or any
// install path with one — answered `/rabbit`, a reload on a client route and
// every goto with a 404 that localServerErrorHandler turns into
// "500 internal error", while `/` still worked (express.static is
// root-relative). With `{ root }` the check sees only 'index.html'. Measured
// by the controller session with an Express repro and by post-overhaul S4a in
// Electron (2026-10-01); spaFallback.test.js plants the absolute form.
// =============================================================================

/** The fallback handler for `expressApp.get('/{*splat}', …)`. */
function sendSpaIndex(distPath) {
  return (req, res) => {
    res.sendFile('index.html', { root: distPath });
  };
}

module.exports = { sendSpaIndex };
