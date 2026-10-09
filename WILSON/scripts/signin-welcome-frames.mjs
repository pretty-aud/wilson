#!/usr/bin/env node
/**
 * The sign-in's hand-off to the welcome, frame by frame — post-overhaul S6a
 * (2026-10-09). Audrey: after the password is accepted the light-orange band
 * "expands and becomes taller and then goes to the welcome"; it should go
 * straight from its size around the password form to its size when the
 * WELCOME title is on screen, in one motion.
 *
 *   node scripts/signin-welcome-frames.mjs <port> [--size 1440x900] [--reduced]
 *        [--resumed] [--json out.json] [--strip out.png [--frames dir]]
 *        [--chart out.svg] [--check]
 *   node scripts/signin-welcome-frames.mjs --recheck saved.json --check
 *
 * Two starting points. By default a FRESH device: nothing stored, so App's
 * chrome mounts only at the hand-over. --resumed (S6a review round 1, R1-01)
 * is the other one: a stored session is resumed at boot on a recovery link
 * (`#/recovery`), so App's chrome is ALREADY mounted, at Home's resting bars,
 * under the reset wizard; "Back to login" puts the sign-in screen over it and
 * the form is driven from there. The fix's first draft passed the fresh path
 * and regressed this one (the mounted bars tweened 540 → 40 after the reveal
 * had already landed on 40).
 *
 * Drives the REAL sign-in form (company, username, password) of a dev server
 * started WITHOUT the dev auto sign-in. The password step runs for real in the
 * page; what is stubbed is the network: every request to a *.supabase.co host
 * is answered here (resolve-login, the password grant, the workspace list, the
 * membership row) and its websockets are mocked, so nothing leaves the
 * machine. The password typed is a value made up below, never a real one — the
 * smoke account's password is deliberately not in this repo (authFlow.ts).
 * Any other non-localhost request is aborted.
 *
 * From the sign-in click until the welcome has finished, every animation frame
 * records: both AuthShell orange panels' rectangles, the centre slot's opacity,
 * App's two chrome bars' rectangles, the transition title's opacity, and the
 * light-orange BAND between whichever pair of bars is on top. "Accepted" is
 * the first frame on which the panels carry the reveal's transition; "title on
 * screen" is the first frame on which App's title overlay is fully opaque with
 * the WELCOME text.
 *
 * --check exits 1 unless, from accepted to title on screen, the band never
 * grows (0.75px of rounding) and moves in one run: no frame where it holds
 * still between two moves (a second tween). With --reduced (prefers-reduced-
 * motion: reduce) it instead requires a CUT: every band value in that window
 * is the start value or the end value, nothing between.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const has = (name) => args.includes(name);
const PORT = args.find((a, i) => /^\d+$/.test(a) && !String(args[i - 1] || '').startsWith('--')) || '5288';
// --recheck <saved.json> re-runs the analysis and --check on a capture saved
// with --json, without a browser — how the check is proved against the
// pre-fix sequence once the code has moved on.
const RECHECK = flag('--recheck');
const SAVED = RECHECK ? JSON.parse(readFileSync(RECHECK, 'utf8')) : null;
const [W, H] = (SAVED?.summary.size || flag('--size') || '1440x900').split('x').map(Number);
const REDUCED = SAVED ? SAVED.summary.reducedMotion : has('--reduced');
const CHECK = has('--check');
const RESUMED = SAVED ? !!SAVED.summary.resumed : has('--resumed');
const TOL = 0.75;

// ── The stubbed account. Test values made up here; none is a credential. ───
const EMAIL = 'smoke_admin@s6a.invalid';
const PASSWORD = 's6a-made-up-password';
const USER_ID = '5a6a0000-0000-4000-8000-000000000001';
const WS_ID = '5a6a0000-0000-4000-8000-0000000000aa';
const now = Math.floor(Date.now() / 1000);
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const appMetadata = { provider: 'email', workspace_id: WS_ID, workspace_ids: [WS_ID], app_role: 'user' };
const claims = {
  sub: USER_ID, aud: 'authenticated', role: 'authenticated', email: EMAIL,
  exp: now + 3600, iat: now, session_id: '5a6a0000-0000-4000-8000-00000000005e',
  aal: 'aal1', amr: [{ method: 'password', timestamp: now }],
  app_metadata: appMetadata, user_metadata: {},
};
const ACCESS = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.not-a-signature`;
const USER = {
  id: USER_ID, aud: 'authenticated', role: 'authenticated', email: EMAIL,
  app_metadata: appMetadata, user_metadata: {}, factors: [],
  created_at: '2026-01-01T00:00:00Z',
};
const SESSION = {
  access_token: ACCESS, token_type: 'bearer', expires_in: 3600,
  expires_at: now + 3600, refresh_token: 's6a-refresh', user: USER,
};
const MEMBER = {
  workspace_id: WS_ID, user_id: USER_ID, display_name: 'Smoke Admin',
  onboarded_at: '2026-01-01T00:00:00Z',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stubNetwork(context, log) {
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (!url.hostname.endsWith('.supabase.co')) return route.abort();
    const p = url.pathname;
    log.push(`${req.method()} ${p}`);
    const json = (body, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
      headers: { 'access-control-allow-origin': '*' },
    });
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*',
      } });
    }
    if (p.endsWith('/functions/v1/resolve-login')) {
      const body = req.postDataJSON() || {};
      await sleep(180); // the function's constant-time floor
      return body.company ? json({ v: 2, exists: true, slug: 'smoke' }) : json({ exists: true, email: EMAIL });
    }
    if (p.endsWith('/auth/v1/token')) { await sleep(250); return json(SESSION); }
    if (p.endsWith('/auth/v1/user')) return json(USER);
    if (p.endsWith('/auth/v1/logout')) return route.fulfill({ status: 204 });
    if (p.includes('/auth/v1/')) return json({});
    if (p.endsWith('/rest/v1/workspaces')) return json([{ id: WS_ID, name: 'Smoke Workspace', slug: 'smoke' }]);
    if (p.endsWith('/rest/v1/workspace_members')) {
      const accept = req.headers().accept || '';
      return json(accept.includes('vnd.pgrst.object') ? MEMBER : [MEMBER]);
    }
    if (p.includes('/rest/v1/rpc/')) return json(null);
    if (p.includes('/rest/v1/')) return json([], req.method() === 'GET' || req.method() === 'HEAD' ? 200 : 201);
    return json({});
  });
  // Realtime: mocked, never connected. Vite's own HMR socket is localhost and
  // is left alone.
  await context.routeWebSocket((u) => u.hostname.endsWith('.supabase.co'), () => {});
}

// ── The in-page sampler ─────────────────────────────────────────────────────
function installSampler() {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2), height: +r.height.toFixed(2) };
  };
  const s = { frames: [], t0: null, running: false, auth: null, slot: null };
  window.__s6a = s;
  // The submit is the zero point: a capture listener sees it before React.
  document.addEventListener('submit', () => { if (s.t0 == null) s.t0 = performance.now(); }, true);
  const findAuth = () => {
    const fixed = [...document.querySelectorAll('body div')].filter((d) => d.style.position === 'fixed');
    const panels = fixed.filter((d) => d.style.zIndex === '52');
    const top = panels.find((d) => d.style.top === '0px');
    const bottom = panels.find((d) => d.style.bottom === '0px');
    const slot = fixed.find((d) => d.style.zIndex === '53');
    return top && bottom ? { top, bottom, slot } : null;
  };
  s.start = () => {
    s.auth = findAuth();
    s.running = true;
    const tick = () => {
      if (!s.running) return;
      const t = s.t0 == null ? null : +(performance.now() - s.t0).toFixed(1);
      const f = { t };
      const a = s.auth;
      if (a && a.top.isConnected) {
        f.auth = {
          top: rect(a.top), bottom: rect(a.bottom),
          target: a.top.style.height,
          transition: a.top.style.transition,
          slot: a.slot ? +getComputedStyle(a.slot).opacity : null,
        };
      }
      const bars = document.querySelectorAll('.wilson-chrome');
      if (bars.length >= 2) {
        const top = bars[0];
        const nav = bars.length > 2 ? bars[1] : null;
        const bottom = bars[bars.length - 1];
        f.app = { top: rect(top), bottom: rect(bottom), nav: nav ? +nav.getBoundingClientRect().height.toFixed(2) : 0, target: top.style.height };
        const overlay = [...document.querySelectorAll('div[style*="z-index: 5;"]')]
          .find((d) => d.style.position === 'absolute' && d.textContent.length < 40);
        if (overlay) {
          const span = overlay.querySelector('span');
          f.title = { text: overlay.textContent, overlay: +getComputedStyle(overlay).opacity, span: span ? +getComputedStyle(span).opacity : null };
        }
      }
      if (f.auth) f.band = +(f.auth.bottom.top - f.auth.top.bottom).toFixed(2);
      else if (f.app) f.band = +(f.app.bottom.top - Math.max(f.app.top.bottom, f.app.top.bottom + f.app.nav)).toFixed(2);
      f.on = f.auth ? 'auth' : (f.app ? 'app' : 'none');
      // What is on top at the band's centre: the topmost element there and its
      // nearest painted background. A band the rectangles measure is not a
      // band anyone sees if something covers it. ⚠️ elementFromPoint skips
      // `pointer-events: none`, which is every AuthShell layer but the
      // background — so this reads the app UNDER the shell until the hand-over
      // and is only meaningful after it. The frame strip is the pixel truth.
      if (f.band != null) {
        const top = f.auth ? f.auth.top.bottom : f.app.top.bottom;
        const el = document.elementFromPoint(innerWidth / 2, top + f.band / 2);
        let bg = null; let n = el;
        while (n && n.nodeType === 1) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break; }
          n = n.parentElement;
        }
        f.paint = { el: el ? `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : ''} z=${el.style?.zIndex || ''}` : null, bg };
      }
      s.frames.push(f);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  s.stop = () => { s.running = false; };
}

// ── Run ─────────────────────────────────────────────────────────────────────
let frames; let t0; let origin; let browser = null;
const stubbed = [];
const shots = [];
if (SAVED) {
  frames = SAVED.frames;
} else {
browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  reducedMotion: REDUCED ? 'reduce' : 'no-preference',
});
await stubNetwork(context, stubbed);
const page = await context.newPage();
page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
await page.addInitScript(installSampler);
await page.addInitScript((seed) => {
  // A clean device: no remembered company, no stored session — or, for
  // --resumed, the stubbed session stored under the web build's key
  // (src/cloud/auth/sessionStorage.js) so the boot resumes it.
  try {
    if (!sessionStorage.getItem('s6a-cleared')) {
      localStorage.clear();
      if (seed) localStorage.setItem('wilson.dev.session', JSON.stringify(seed));
      sessionStorage.setItem('s6a-cleared', '1');
    }
  } catch { /* none */ }
}, RESUMED ? SESSION : null);

// `?fixtures=member` (the fixtures' own S4b variant) seats the reviewer as a
// plain member. The default fixtures reviewer is an ADMIN, and an admin with
// no verified TOTP factor gets the MFA enrolment gate ~180ms after the
// hand-over — an idle AuthShell whose two 50vh panels paint the whole window
// orange over the welcome (measured: the first S6a run's strips). Audrey's
// own sign-in reaches the welcome, so the gate is not her path.
// The fields by their autocomplete role: with App's chrome mounted (--resumed)
// Settings' own inputs share the labels, so a label locator is ambiguous.
const field = (role) => page.locator(`input[autocomplete=${role}]`);
let chromeUnderLogin = 0;
if (RESUMED) {
  await page.goto(`http://localhost:${PORT}/?fixtures=member#/recovery`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /back to login/i }).waitFor({ timeout: 30_000 });
  await sleep(300);
  await page.getByRole('button', { name: /back to login/i }).click();
} else {
  await page.goto(`http://localhost:${PORT}/?fixtures=member`, { waitUntil: 'domcontentloaded' });
}
await field('organization').waitFor({ timeout: 30_000 });
chromeUnderLogin = await page.evaluate(() => document.querySelectorAll('.wilson-chrome').length);
if (RESUMED && chromeUnderLogin < 2) throw new Error('--resumed: App\'s chrome is not mounted under the sign-in screen');
await sleep(1800); // the split's hold ends before the form is live
await field('organization').fill('smoke');
await page.getByRole('button', { name: /^continue$/i }).click();
await field('username').waitFor({ timeout: 10_000 });
await field('username').fill('smoke_admin');
await field('current-password').fill(PASSWORD);
await sleep(400);

// The screencast for the frame strip: every frame the compositor produces,
// stamped in wall-clock seconds; aligned to the page's clock below.
const cdp = await context.newCDPSession(page);
if (flag('--strip')) {
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    shots.push({ epoch: metadata.timestamp * 1000, data });
    try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch { /* closed */ }
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
}

await page.evaluate(() => window.__s6a.start());
await sleep(150);
await page.getByRole('button', { name: /^sign in$/i }).click();
// A click that never submits is a DRIVING failure, not a motion result: say
// so rather than letting --check report "never reached accepted" as if the
// welcome had failed (seen once, a --resumed run at 1280x700 in S6a's
// round-1 matrix; the same case passed three re-runs in a row).
// `node --check` this file after editing: the run exits 2 on this path.
try {
  await page.waitForFunction(() => window.__s6a.t0 != null, null, { timeout: 3000 });
} catch {
  console.error('DRIVER: the Sign in click did not submit the form — re-run; this is not a measurement');
  await browser.close();
  process.exit(2);
}

// Until the welcome has run its course: the title came and went and the bars
// have been still for 400ms — or 9s, whichever is first.
const deadline = Date.now() + 9000;
for (;;) {
  await sleep(100);
  const done = await page.evaluate(() => {
    const fr = window.__s6a.frames;
    const sawTitle = fr.some((f) => f.title && f.title.span === 1);
    const last = fr[fr.length - 1];
    if (!sawTitle || !last || last.title) return false;
    const recent = fr.filter((f) => f.t != null && f.t > last.t - 400);
    return recent.length > 5 && recent.every((f) => Math.abs(f.band - last.band) < 0.01);
  });
  if (done || Date.now() > deadline) break;
}
await page.evaluate(() => window.__s6a.stop());
if (flag('--strip')) await cdp.send('Page.stopScreencast');
({ frames, t0, origin } = await page.evaluate(() => ({ frames: window.__s6a.frames, t0: window.__s6a.t0, origin: performance.timeOrigin })));
}

// ── Analysis ────────────────────────────────────────────────────────────────
const timed = frames.filter((f) => f.t != null);
// Accepted: the panels are handed a new target or a new transition (the
// reveal), whichever shows first — under reduced motion only the target moves.
const first = timed.find((f) => f.auth)?.auth;
const iAccept = timed.findIndex((f) => f.auth && first && (f.auth.transition !== first.transition || f.auth.target !== first.target));
const iTitle = timed.findIndex((f) => f.title && /welcome/i.test(f.title.text) && f.title.overlay === 1 && f.title.span === 1);
const accepted = iAccept >= 0 ? timed[iAccept] : null;
const titled = iTitle >= 0 ? timed[iTitle] : null;
const window_ = iAccept >= 0 && iTitle >= 0 ? timed.slice(Math.max(0, iAccept - 1), iTitle + 1) : [];
const bandStart = timed[0]?.band;

// Segments: runs of growing / shrinking / still.
const segs = [];
for (let i = 1; i < timed.length; i++) {
  const d = timed[i].band - timed[i - 1].band;
  const dir = d > TOL / 3 ? 'grow' : d < -TOL / 3 ? 'shrink' : 'still';
  const last = segs[segs.length - 1];
  if (last && last.dir === dir) { last.to = timed[i].t; last.bandTo = timed[i].band; last.on = timed[i].on; }
  else segs.push({ dir, from: timed[i - 1].t, to: timed[i].t, bandFrom: timed[i - 1].band, bandTo: timed[i].band, on: timed[i].on });
}
const moving = segs.filter((s) => s.dir !== 'still' && Math.abs(s.bandTo - s.bandFrom) > TOL);

const summary = {
  size: `${W}x${H}`, reducedMotion: REDUCED, resumed: RESUMED, frames: timed.length,
  submitToAccepted: accepted ? accepted.t : null,
  acceptedToTitle: accepted && titled ? +(titled.t - accepted.t).toFixed(1) : null,
  bandAtSubmit: bandStart,
  bandAtTitle: titled ? titled.band : null,
  bandMax: Math.max(...timed.map((f) => f.band ?? -Infinity)),
  bandMinBeforeTitle: window_.length ? Math.min(...window_.map((f) => f.band)) : null,
  bandMaxAfterAccept: window_.length ? Math.max(...window_.map((f) => f.band)) : null,
  handoverAt: (timed.find((f) => f.on === 'app') || {}).t ?? null,
  segments: moving.map((s) => `${s.dir} ${s.bandFrom}→${s.bandTo}px  t ${s.from}→${s.to}ms (${s.on})`),
};

let failures = [];
if (CHECK) {
  if (!accepted || !titled) failures.push('never reached accepted and title-on-screen');
  // Against the lowest value so far, not the previous frame: a slow growth
  // (a few px over a second) never moves 0.75px between two frames.
  const grew = [];
  let low = window_[0]?.band ?? Infinity;
  for (const f of window_) {
    if (f.band > low + TOL) grew.push(`t=${f.t} ${low}→${f.band}`);
    low = Math.min(low, f.band);
  }
  if (grew.length) failures.push(`band GREW between accepted and title: ${grew.slice(0, 4).join('; ')}`);
  const a = window_[0]?.band; const z = titled?.band;
  if (REDUCED) {
    const mid = window_.filter((f) => Math.abs(f.band - a) > TOL && Math.abs(f.band - z) > TOL);
    if (mid.length) failures.push(`reduced motion: ${mid.length} frame(s) between ${a} and ${z} (first t=${mid[0].t} band ${mid[0].band})`);
  } else {
    // One run: once the band has started moving it keeps moving until it
    // lands. Measured in MILLISECONDS, not frames: App's mount is a long task
    // that produces no frames at all, so a frame count reads a 320ms pause as
    // three frames (measured at 1280x700 before the fix).
    // Judged until the band LANDS (within 0.75px of the title's band): the
    // reveal's ease tail can still read 40.1px when App mounts at exactly
    // 40, and a 0.1px snap after the landing is not a second tween (measured
    // at 1920x1200 after the fix).
    const landed = window_.findIndex((f) => Math.abs(f.band - z) <= TOL);
    const run = landed >= 0 ? window_.slice(0, landed + 1) : window_;
    const moved = run.filter((f, i) => i && Math.abs(f.band - run[i - 1].band) > 0.01);
    let longest = 0; let at = null;
    for (let i = 1; i < moved.length; i++) {
      const gap = moved[i].t - moved[i - 1].t;
      if (gap > longest) { longest = gap; at = moved[i - 1].t; }
    }
    // 100ms is six frames at 60Hz: no single tween on an ease curve holds still
    // that long mid-move, and every two-tween sequence measured paused longer.
    if (longest > 100) failures.push(`the band held still for ${Math.round(longest)}ms mid-move (from t=${at}): two tweens, not one`);
  }
}

console.log(JSON.stringify(summary, null, 2));
if (stubbed.length) console.log(`  stubbed ${stubbed.length} request(s), e.g. ${[...new Set(stubbed)].slice(0, 6).join(', ')}`);

if (flag('--json')) {
  mkdirSync(dirname(flag('--json')), { recursive: true });
  writeFileSync(flag('--json'), JSON.stringify({ summary, frames: timed }, null, 1));
}

// ── The band over time, as an SVG chart ─────────────────────────────────────
if (flag('--chart')) {
  const pts = timed.filter((f) => f.band != null);
  const tMax = Math.max(...pts.map((f) => f.t)); const bMax = H;
  const cw = 720; const ch = 260; const pad = 40;
  const x = (t) => pad + (t / tMax) * (cw - 2 * pad);
  const y = (b) => ch - pad - (b / bMax) * (ch - 2 * pad);
  const path = pts.map((f, i) => `${i ? 'L' : 'M'}${x(f.t).toFixed(1)},${y(f.band).toFixed(1)}`).join(' ');
  const mark = (t, label) => (t == null ? '' : `<line x1="${x(t)}" x2="${x(t)}" y1="${pad / 2}" y2="${ch - pad}" stroke="#78716c" stroke-dasharray="3 3"/><text x="${x(t) + 4}" y="${pad / 2 + 10}" font-size="11" fill="#1c1917">${label}</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" font-family="sans-serif">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="${pad}" y="14" font-size="12" fill="#1c1917">Light-orange band height (px) from the sign-in click, ${W}x${H}${REDUCED ? ', reduced motion' : ''}</text>
<line x1="${pad}" x2="${cw - pad}" y1="${ch - pad}" y2="${ch - pad}" stroke="#1c1917"/>
<line x1="${pad}" x2="${pad}" y1="${pad / 2}" y2="${ch - pad}" stroke="#1c1917"/>
${[0, 0.25, 0.5, 0.75, 1].map((k) => `<text x="${pad - 4}" y="${y(k * bMax) + 4}" font-size="10" text-anchor="end" fill="#1c1917">${Math.round(k * bMax)}</text>`).join('')}
${[0, 0.25, 0.5, 0.75, 1].map((k) => `<text x="${x(k * tMax)}" y="${ch - pad + 14}" font-size="10" text-anchor="middle" fill="#1c1917">${Math.round(k * tMax)}ms</text>`).join('')}
${mark(accepted?.t, 'accepted')}${mark(summary.handoverAt, 'app')}${mark(titled?.t, 'WELCOME')}
<path d="${path}" fill="none" stroke="#c2410c" stroke-width="2"/>
</svg>`;
  mkdirSync(dirname(flag('--chart')), { recursive: true });
  writeFileSync(flag('--chart'), svg);
}

// ── The frame strip ─────────────────────────────────────────────────────────
if (flag('--strip') && !SAVED) {
  const sharp = (await import('sharp')).default;
  const base = origin + t0;
  const all = shots.map((s) => ({ ...s, t: s.epoch - base })).filter((s) => s.t >= -200);
  const end = titled ? titled.t + 120 : (all.at(-1)?.t ?? 0);
  // Ten moments: the form, then evenly from accepted to just past the title.
  const startT = accepted ? accepted.t : 0;
  const wants = [-100, ...Array.from({ length: 9 }, (_, i) => startT + (i / 8) * (end - startT))];
  const pick = wants.map((w) => all.reduce((b, s) => (Math.abs(s.t - w) < Math.abs(b.t - w) ? s : b), all[0])).filter(Boolean);
  const bandAt = (t) => { let best = timed[0]; for (const f of timed) if (Math.abs(f.t - t) < Math.abs(best.t - t)) best = f; return best?.band; };
  const tw = 200; const th = Math.round((H / W) * tw); const cap = 30; const gap = 6;
  const tiles = await Promise.all(pick.map(async (s) => sharp(Buffer.from(s.data, 'base64')).resize(tw, th).png().toBuffer()));
  const width = pick.length * (tw + gap) + gap; const height = th + cap + gap * 2;
  const comps = [];
  pick.forEach((s, i) => {
    const left = gap + i * (tw + gap);
    comps.push({ input: tiles[i], left, top: gap });
    const label = `${s.t < 0 ? 'form' : `+${Math.round(s.t)}ms`} · band ${Math.round(bandAt(s.t))}`;
    comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${cap}"><text x="${tw / 2}" y="18" font-family="sans-serif" font-size="13" text-anchor="middle" fill="#1c1917">${label}</text></svg>`), left, top: gap + th + 2 });
  });
  if (flag('--frames')) {
    mkdirSync(flag('--frames'), { recursive: true });
    pick.forEach((f, i) => writeFileSync(`${flag('--frames')}/${String(i).padStart(2, '0')}_${Math.round(f.t)}ms.png`, Buffer.from(f.data, 'base64')));
  }
  mkdirSync(dirname(flag('--strip')), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).composite(comps).png().toFile(flag('--strip'));
}

if (browser) await browser.close();
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
if (CHECK) console.log('PASS');
