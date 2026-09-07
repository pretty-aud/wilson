// =============================================================================
// electron/localToken.cjs — Bundle B3 (Track B): the per-launch token that
// every request to the desktop loopback API must carry.
//
// ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
//
// `startLocalServer` did `expressApp.listen(0, '127.0.0.1')` behind
// `expressApp.use(cors())`: no token, no origin allowlist, no session check,
// `Access-Control-Allow-Origin: *` on 94 routes. Since S40
// `managed-files/:id/stream` returns ORIGINAL full-resolution media bytes with
// Range support, and `GET /api/rabbit/projects` + `.../managed-files` hand out
// the ids needed to reach them. Any process on the machine that could reach the
// ephemeral port could enumerate and stream pre-release footage while WILSON was
// open (OUTSTANDING.md MEASURED S40; TPN-NET).
//
// Audrey, decision 21: *"a per-launch token that every desktop request must
// carry."*
//
// ── THE TWO WAYS IN, AND WHY BOTH EXIST ─────────────────────────────────────
//
// 🚨 MEASURED, 2026-09-07, and it is the fact the whole design rests on: the
// renderer is served BY THIS SERVER. `main.cjs` does
// `mainWindow.loadURL('http://127.0.0.1:' + port)` with no `app.isPackaged`
// branch, and `electron:dev` is `vite build --mode development && electron .`
// — it builds to `dist/` and loads the same way. Vite's dev server (:5203) is
// the WEB path, which has no Express server at all. So the renderer's origin is
// the server's own origin in BOTH packaged and dev modes; the brief's
// "measure both; they differ" was a hypothesis, and the measured answer is that
// they do not. There is exactly one allowed origin and it is computed at listen
// time.
//
// Every renderer request is therefore SAME-ORIGIN, which is what makes a cookie
// sufficient and a header cheap:
//
//   * Cookie — httpOnly, set on the loopback origin from main before the window
//     loads. Measured in Chromium (scratch probe, 2026-09-07): it is sent on a
//     same-origin `fetch()`, on `fetch(mode:'cors')`, on a plain `<img>`, on
//     `<img crossOrigin="anonymous">`, on `<video crossOrigin="anonymous">` and
//     on the document itself. This is the arm that carries `FileThumbnail`'s
//     `<img src>` and `VideoPreview`'s `<video src>`, which cannot set a header.
//   * Header — attached by `src/lib/localServerFetch.js` from the token the
//     preload bridge hands the renderer. Belt to the cookie's braces: a fetch
//     keeps working if the cookie jar is ever emptied under us, and it is the
//     arm a non-browser caller (the harness) uses.
//
// The middleware accepts EITHER. `scripts/local-server-lock-harness.mjs` proves
// all four cases — no token 401, header 200, cookie 200, wrong token 401 — and
// carries a control that flips one expectation to show the assertions can fail.
//
// ── WHAT IS NOT GUARDED, AND WHY ────────────────────────────────────────────
//
// The guard runs ahead of every route but only REFUSES under `/api`. The static
// bundle (`express.static(distPath)`) and the SPA fallback are let through on
// purpose:
//
//   * they serve `dist/` — the app's own built shell, byte-identical on every
//     machine and already sitting in the installer on disk. It is not content;
//     TPN-NET is about the footage, and the footage is all under `/api`.
//   * guarding them would make a failed `cookies.set()` a WHITE WINDOW rather
//     than a degraded feature. Trading the whole app against a leak of our own
//     public JS is not a trade worth making.
//
// A local process that loads the shell gets a UI whose every call answers 401.
//
// 🚨 The guard is mounted BEFORE `express.json({limit:'50mb'})`, so an
// unauthenticated caller cannot make the main process buffer 50 MB before being
// refused.
// =============================================================================

const crypto = require('crypto');

/** Header the renderer attaches (see src/lib/localServerFetch.js). */
const TOKEN_HEADER = 'x-wilson-local-token';

/** Cookie main sets on the loopback origin before the window loads. */
const TOKEN_COOKIE = 'wilson_local_token';

/** 32 random bytes, hex. New on every launch; never written to disk. */
function mintLaunchToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Only `/api` is refused. See the header comment for why the static shell is
 * not. `/apiary` must not match, hence the explicit two-branch test.
 */
function isGuardedPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/** `req.url` without its query string. */
function pathnameOf(req) {
  const raw = String(req?.url ?? '');
  const cut = raw.indexOf('?');
  return cut === -1 ? raw : raw.slice(0, cut);
}

/**
 * Minimal Cookie-header parser. `cookie-parser` would be a new dependency for
 * one lookup on one header, and the value is a 64-char hex string that needs no
 * decoding rules.
 */
function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of String(cookieHeader).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Constant-time equality. The length check in front leaks only the token's
 * length, which is a compile-time constant and public.
 */
function tokensMatch(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  if (candidate.length === 0 || candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(expected, 'utf8'));
}

/**
 * The ONE middleware. `getToken` is a function, not a value, so the guard can
 * be mounted before the token is minted and so a test can rotate it.
 *
 * 🚨 Refuses with a bare 401 and NO body. Saying "missing token" vs "wrong
 * token" tells a prober which half it got right; saying nothing tells it
 * nothing. Callers that read `body.error` (localServerAdapter's jfetch) already
 * fall back to `HTTP 401` when the body will not parse.
 */
function createLocalTokenGuard(getToken) {
  return function localTokenGuard(req, res, next) {
    if (!isGuardedPath(pathnameOf(req))) return next();

    const expected = typeof getToken === 'function' ? getToken() : getToken;
    // No token minted yet means the server is not ready to serve data. Fail
    // closed: a guard that opens when it cannot find its own secret is not a
    // guard.
    if (typeof expected !== 'string' || expected.length === 0) {
      res.status(401).end();
      return;
    }

    const header = req.headers?.[TOKEN_HEADER];
    const cookie = readCookie(req.headers?.cookie, TOKEN_COOKIE);
    if (tokensMatch(typeof header === 'string' ? header : null, expected)) return next();
    if (tokensMatch(cookie, expected)) return next();

    res.status(401).end();
  };
}

/**
 * CORS, narrowed from `*` to the renderer's own origin.
 *
 * 🚨 CORS IS NOT THE GATE — the token is (auto-memory: "CORS is NOT
 * browser-only"; a non-browser caller ignores every one of these headers). This
 * is defence in depth: it stops a drive-by page in the user's ordinary browser
 * from READING a response it managed to provoke.
 *
 * 🚨 A missing `Origin` is allowed. Measured: a same-origin `fetch`, a plain
 * `<img>` and a `<video crossOrigin="anonymous">` all send NO Origin header,
 * while `<img crossOrigin="anonymous">` DOES send one — and the entity
 * thumbnails in ScenesView / ProjectAssetsView / LevelsView / ExperiencesView
 * are exactly that shape. Refusing the header-less case would break the first
 * three; refusing the renderer's own origin would break the fourth. Both are
 * behind the token either way.
 *
 * `getOrigin` is a function because the origin contains the port, and the port
 * is only known once `listen(0)` has bound.
 */
function localCorsOptions(getOrigin) {
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const allowed = typeof getOrigin === 'function' ? getOrigin() : getOrigin;
      // `false` here is not an error — the cors package simply omits
      // Access-Control-Allow-Origin, and the browser refuses the read.
      return callback(null, Boolean(allowed) && origin === allowed);
    },
  };
}

/**
 * Lock an Express app. main.cjs and the harness call THIS, so the harness
 * exercises the real mounting order and the real guard rather than a copy.
 *
 * Mount before any body parser and before any route.
 */
function applyLocalServerLock(expressApp, { cors, getToken, getOrigin }) {
  expressApp.use(cors(localCorsOptions(getOrigin)));
  expressApp.use(createLocalTokenGuard(getToken));
  return expressApp;
}

module.exports = {
  TOKEN_HEADER,
  TOKEN_COOKIE,
  mintLaunchToken,
  isGuardedPath,
  readCookie,
  tokensMatch,
  createLocalTokenGuard,
  localCorsOptions,
  applyLocalServerLock,
};
