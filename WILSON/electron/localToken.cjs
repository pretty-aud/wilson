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
 *
 * 🚨 THE INVARIANT: this must guard everything Express ROUTES, and Express does
 * not route the way a naive `startsWith` reads. Two complete authentication
 * bypasses were found by probing it with a raw socket during B3's own review
 * round (`fetch` normalises the request target before it leaves the process and
 * hides both):
 *
 *   1. **Case.** Express's router is case-INSENSITIVE by default
 *      (`caseSensitive: false`), so `GET /API/RABBIT/PROJECTS` matched
 *      `/api/rabbit/projects` and returned the project list while a
 *      case-sensitive prefix test said "not an /api path". Hence `.toLowerCase()`
 *      — and note the direction is safe if `caseSensitive` is ever turned on,
 *      because guarding case-insensitively guards a superset.
 *   2. **Slashes.** `/api//rabbit` and `//api/rabbit` are different strings and
 *      the same intent; collapsed before testing so neither can drift from what
 *      the router does.
 *
 * The absolute-form request target (`GET http://host/api/... HTTP/1.1`, legal
 * per RFC 9112 §3.2.2 and accepted by Node) is the third, and it is handled in
 * `requestPathCandidates` rather than here.
 */
function isGuardedPath(pathname) {
  const p = String(pathname ?? '').replace(/\/{2,}/g, '/').toLowerCase();
  return p === '/api' || p.startsWith('/api/');
}

/**
 * Every reading of `req.url` that Express might route on. The guard refuses if
 * ANY of them is an `/api` path — fail closed, because the cost of guarding one
 * static asset too many is a 401 on a file nothing requests that way, and the
 * cost of guarding one too few is the project list.
 */
function requestPathCandidates(rawUrl) {
  const raw = String(rawUrl ?? '');
  const cut = raw.search(/[?#]/);
  const target = cut === -1 ? raw : raw.slice(0, cut);
  const candidates = [target];
  // Absolute-form: `req.url` is the whole URL, so the prefix test would miss it
  // while the router matched the path. The base is only there to satisfy the
  // parser for the ordinary origin-form case.
  try {
    candidates.push(new URL(raw, 'http://wilson.invalid').pathname);
  } catch { /* unparseable: the raw target above still stands */ }
  return candidates;
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
  // 🚨 BYTE length, not string length — R2's finding. `crypto.timingSafeEqual`
  // throws `RangeError: Input buffers must have the same byte length`, and 64
  // characters of `é` is 64 JS chars but 128 UTF-8 bytes. The old check
  // compared `.length`, so a non-ASCII token of the right CHARACTER count sailed
  // past it and threw inside the guard — which express handed to finalhandler,
  // which (Electron never sets NODE_ENV, so it is in its development branch)
  // answered an unauthenticated caller with a 500 and a 1.8 KB stack trace
  // naming this file, its line, and the absolute path of the developer's tree.
  // A bundle whose whole point is a bare 401 must not answer anything else.
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
    // 🚨 THE WHOLE BODY IS WRAPPED. A guard that can THROW answers with
    // whatever the framework's error handler decides — for express that is
    // finalhandler, which prints a stack. The only two answers this middleware
    // may ever give are `next()` and a bare 401, so anything unexpected becomes
    // the 401. Fail closed, and say nothing.
    try {
      if (!requestPathCandidates(req?.url).some(isGuardedPath)) return next();

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
    } catch {
      if (!res.headersSent) res.status(401).end();
    }
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
 * 🚨 A missing `Origin` is allowed, and THAT is the arm this codebase actually
 * depends on. Measured in Chromium: a same-origin `fetch()`, a plain `<img>`
 * and a `<video crossOrigin="anonymous">` all send NO Origin header, while
 * `<img crossOrigin="anonymous">` DOES send one.
 *
 * ⚠️ Corrected by review round R2, because the first version of this comment
 * got the codebase wrong in a way worth remembering: it claimed the entity
 * thumbnails in ScenesView / ProjectAssetsView / LevelsView / ExperiencesView
 * were `<img crossOrigin="anonymous">`. They are not. `grep -rn crossOrigin
 * src/` returns exactly two files, both `<video>` (`VideoPreview.jsx`,
 * `videoThumbnails.js`); all eight thumbnail `<img>` tags are plain. So
 * **nothing in `src/` sends an Origin to this server today**, and the
 * header-less allow is what keeps every one of them working.
 *
 * The renderer-origin arm is therefore insurance, not load-bearing: it is here
 * so that adding a `crossOrigin` attribute — or any future caller that does
 * send an Origin — is not silently refused, while every other origin still is.
 * Recorded as insurance rather than dressed up as a requirement, because a
 * comment that overstates its own necessity is how the next person justifies
 * keeping something they should have questioned.
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
 *
 * ⚠️ ONE EXCEPTION to "ahead of every route", found by R2 and left alone
 * deliberately: `cors@2.8.6` defaults to `preflightContinue: false`, so it
 * ANSWERS an `OPTIONS` preflight itself (204) before the guard sees it. Measured
 * — an unauthenticated `OPTIONS /api/anything` gets 204 whether the path exists
 * or not, and a FOREIGN origin gets 401 because cors calls `next()` when its
 * origin callback returns false. A uniform 204 with no body is not a route
 * oracle and carries no data, and making preflight require the token would
 * break any future cross-origin caller for no gain. Recorded so the next reader
 * does not mistake it for an oversight.
 */
function applyLocalServerLock(expressApp, { cors, getToken, getOrigin }) {
  expressApp.use(cors(localCorsOptions(getOrigin)));
  expressApp.use(createLocalTokenGuard(getToken));
  return expressApp;
}

/**
 * The terminal error handler. Mount LAST, after every route.
 *
 * 🚨 Express's default is `finalhandler`, which prints the stack when
 * `NODE_ENV` is not 'production' — and Electron never sets `NODE_ENV`, so the
 * PACKAGED app is in the stack-printing branch. Any route that throws
 * therefore hands a local caller ~2 KB naming source files, line numbers and
 * the absolute path of the user's own home directory. Four express routes in
 * this server already leak `err.message` deliberately (TPN-LOG); this stops the
 * unhandled ones leaking considerably more, and it is what makes B3's
 * "residual reachability is nil for an outside caller" annotation true rather
 * than nearly true.
 *
 * Four arguments, and the unused `next` is load-bearing: express identifies an
 * error handler by arity, and a three-argument function is silently treated as
 * ordinary middleware that never runs.
 */
// eslint-disable-next-line no-unused-vars
function localServerErrorHandler(err, req, res, next) {
  console.error('[wilson] local server route failed:', err?.stack ?? err);
  if (res.headersSent) return res.end();
  res.status(500).type('text/plain').send('internal error');
}

module.exports = {
  TOKEN_HEADER,
  TOKEN_COOKIE,
  mintLaunchToken,
  isGuardedPath,
  requestPathCandidates,
  readCookie,
  tokensMatch,
  createLocalTokenGuard,
  localCorsOptions,
  applyLocalServerLock,
  localServerErrorHandler,
};
