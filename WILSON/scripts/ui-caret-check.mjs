#!/usr/bin/env node
/**
 * UI overhaul — re-prove AuthPasswordInput's caret alignment in a real browser.
 *
 *   node scripts/ui-caret-check.mjs [port] [width] [height]
 *
 * Plan §5 names this as T3's, and plan §8 risk 8 says why: "`AuthPasswordInput`'s
 * 0.00px caret drift depends on font metrics; T3 re-proves it."
 *
 * ── What is actually at stake ───────────────────────────────────────────────
 * The password field is TWO layers in one grid cell. The real `<input
 * type="password">` lays out and measures N bullets but paints them
 * transparent, so the browser puts the caret after the Nth bullet. A sibling
 * `<span aria-hidden>` paints N asterisks. If the two layers resolve even
 * slightly different font metrics, the asterisks and the caret separate, and
 * the failure mode is a person who cannot tell how much of their password
 * they have typed — on the gate every admin passes at every sign-in.
 *
 * The monospace requirement is load-bearing: in a proportional face `•` and
 * `*` have different advances and the drift compounds per character.
 *
 * ── Why a script and not a console snippet ──────────────────────────────────
 * D2 measured this and wrote the numbers into AuthShell.jsx. The overhaul then
 * changed the face to Geist and the size to the 14px step, which is exactly
 * the kind of change that can move font metrics under a claim nobody re-runs.
 * A number in a comment is a number someone has to trust; this is a number
 * anyone can reproduce, and it exits non-zero when the claim stops being true.
 *
 * 🚨 DEVICE PIXEL RATIO CHANGES THE ROW HEIGHT AND NOTHING ELSE THAT MATTERS.
 * Playwright's default `deviceScaleFactor` is 1, which is the condition D2
 * measured under, and there a 1px border is 1 CSS px: the row is 16.8 + 4 + 6
 * + 1 = 27.80px. In a browser pane at DPR 1.5 the same border snaps to one
 * DEVICE pixel, 0.667 CSS px, and the row measures 27.46. That is a rendering
 * difference in the BORDER, not a drift between the layers — every difference
 * below still measures 0.00 there. Compare row heights only at a stated DPR.
 *
 * ── Reaching the screen ─────────────────────────────────────────────────────
 * The form only exists when the dev sign-in bypass is OFF. Comment
 * `VITE_DEV_AUTOLOGIN=tester` out of the worktree's `.env.local`, restart the
 * dev server so Vite re-reads it, then run this. The script says plainly when
 * it lands on a signed-in app instead of the form rather than reporting a
 * measurement it did not take.
 *
 * Step 1 asks for a company before the password field exists. The company is
 * verified by the `resolve-login` Edge Function, which degrades to the derived
 * slug when it is not deployed, so any plausible name gets to step 2 without a
 * real account — and step 2 is never SUBMITTED here. Nothing is signed in and
 * no credential is typed.
 */
import { chromium } from '@playwright/test';

const PORT = process.argv[2] || '5244';
const W = Number(process.argv[3] || 1440);
const H = Number(process.argv[4] || 900);
const COMPANY = 'petal';
const N = 25;                       // the same N D2 measured at
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
// deviceScaleFactor is EXPLICIT, not defaulted — see the note above. A future
// reader comparing row heights has to know which one produced the number.
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
// The shell plays a logo intro before it reveals the child slot: 1200ms in,
// up to 3800ms held, 500ms out, 1000ms idle, then the step appears.
await page.waitForSelector('input[aria-label="Company"], input[aria-label="Password"]', { timeout: 30000 })
  .catch(() => {});

if (await page.locator('input[aria-label="Company"]').count()) {
  await page.fill('input[aria-label="Company"]', COMPANY);
  await page.click('button[type="submit"]');
  await page.waitForSelector('input[aria-label="Password"]', { timeout: 20000 }).catch(() => {});
}

if (!(await page.locator('input[aria-label="Password"]').count())) {
  console.error(
    'No password field. The sign-in screen is not on screen — most likely\n'
    + 'VITE_DEV_AUTOLOGIN=tester is still set in .env.local, or the dev server\n'
    + 'was not restarted after it was commented out. Nothing was measured.',
  );
  await browser.close();
  process.exit(2);
}

const result = await page.evaluate(async (n) => {
  await document.fonts.ready;
  const pw = document.querySelector('input[aria-label="Password"]');
  const user = document.querySelector('input[aria-label="Username"]');
  // React owns the value, so set it through the native setter and fire the
  // event React listens for — assigning `.value` directly would move the caret
  // without the mask ever hearing about it, and the mask is the thing under test.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(pw, 'x'.repeat(n));
  pw.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));

  const mask = pw.parentElement.querySelector('span[aria-hidden="true"]');
  if (!mask || mask.textContent.length !== n) {
    return { error: `mask did not follow the value (${mask ? mask.textContent.length : 'absent'} of ${n})` };
  }

  const box = (el) => el.getBoundingClientRect();
  const si = getComputedStyle(pw);
  const sm = getComputedStyle(mask);

  // The eight properties both layers must agree on. `metrics` in AuthShell.jsx
  // is one object spread into both precisely so this list cannot diverge.
  const EIGHT = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing',
    'textAlign', 'lineHeight', 'padding', 'fontStretch'];
  const disagreements = EIGHT.filter((k) => si[k] !== sm[k]).map((k) => `${k}: ${si[k]} vs ${sm[k]}`);

  // Advance width of N bullets against N asterisks, each measured in its OWN
  // layer's resolved font. canvas `measureText` does not apply letter-spacing,
  // so it is added back per character — the same tracking the caret walks over.
  const ctx2d = document.createElement('canvas').getContext('2d');
  const fontOf = (s) => `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  const trackOf = (s) => (s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing));
  const advance = (str, s) => { ctx2d.font = fontOf(s); return ctx2d.measureText(str).width + trackOf(s) * str.length; };

  const bi = box(pw); const bm = box(mask); const bu = box(user);
  const round = (x) => Number(x.toFixed(2));
  return {
    n,
    fieldWidthDrift: round(bu.width - bi.width),
    layerDrift: {
      left: round(bi.left - bm.left),
      width: round(bi.width - bm.width),
      top: round(bi.top - bm.top),
      height: round(bi.height - bm.height),
    },
    glyphDrift: round(advance('•'.repeat(n), si) - advance('*'.repeat(n), sm)),
    rows: { username: round(bu.height), password: round(bi.height) },
    resolved: {
      input: `${si.fontFamily.split(',')[0].replace(/"/g, '')} ${si.fontSize}`,
      mask: `${sm.fontFamily.split(',')[0].replace(/"/g, '')} ${sm.fontSize}`,
    },
    disagreements,
    borderBottomWidth: si.borderBottomWidth,
    devicePixelRatio: window.devicePixelRatio,
  };
}, N);

await browser.close();

if (result.error) { console.error(result.error); process.exit(1); }

const { layerDrift: d } = result;
console.log(`# AuthPasswordInput caret alignment — ${W}x${H}, DPR ${result.devicePixelRatio}, N=${result.n}\n`);
console.log(`  the text field's width minus the password field's   ${result.fieldWidthDrift.toFixed(2)}px`);
console.log(`  the input's left minus the mask's                   ${d.left.toFixed(2)}px`);
console.log(`  the input's width minus the mask's                  ${d.width.toFixed(2)}px`);
console.log(`  the input's top minus the mask's                    ${d.top.toFixed(2)}px`);
console.log(`  the input's height minus the mask's                 ${d.height.toFixed(2)}px`);
console.log(`  ${result.n} bullets minus ${result.n} asterisks, in each layer's own font   ${result.glyphDrift.toFixed(2)}px`);
console.log(`\n  both rows                    ${result.rows.username.toFixed(2)}px / ${result.rows.password.toFixed(2)}px  (border ${result.borderBottomWidth})`);
console.log(`  both layers resolve          ${result.resolved.input}  /  ${result.resolved.mask}`);
console.log(`  eight metrics disagreeing    ${result.disagreements.length ? result.disagreements.join('; ') : 'none'}`);
if (errors.length) console.log(`\n  page errors: ${errors.join(' | ')}`);

const drifts = [result.fieldWidthDrift, d.left, d.width, d.top, d.height, result.glyphDrift];
const bad = drifts.some((x) => Math.abs(x) > 0.005)
  || result.disagreements.length > 0
  || result.rows.username !== result.rows.password
  || result.resolved.input !== result.resolved.mask;
console.log(`\n${bad ? '🚨 DRIFT' : '✓ 0.00px on every axis'}`);
process.exit(bad ? 1 : 0);
