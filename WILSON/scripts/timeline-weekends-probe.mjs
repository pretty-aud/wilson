#!/usr/bin/env node
/**
 * The Timeline with weekends hidden, measured — post-overhaul S5p (P1-32b),
 * 2026-10-05.
 *
 *   node scripts/timeline-weekends-probe.mjs <port> [--size 1440x900] [--shots <dir> --tag before|after] [--json <file>]
 *
 * P1-32b (S1's review round 2, measured 2026-09-30): with "Show weekends" off,
 * only DetailPane knew which day columns are hidden, and TimelineView turned
 * the gantt's scroll into days as `scrollLeft / DAY_PX` — so Week → Day threw
 * the gantt months ahead, the minimap's window sat on the wrong weeks, Today
 * landed past today and the switch did not keep your place. This reads what
 * the user SEES, never the code's own arithmetic:
 *
 *   - the gantt's dates come off its own header (each tick's left and its
 *     printed label; the year from the month's top label), so a day at the
 *     gantt's left edge is the date printed over that column;
 *   - the minimap window's dates come off the minimap's own Today line and
 *     month lines (its scale is the month that holds today).
 *
 * The checks (each prints its numbers; any failure exits 1):
 *
 *   zoom         Week → Day → Week from where the Timeline opens: the left
 *                date kept (a hidden day: the next shown day)
 *   window       at Day zoom: the minimap window's first and last day against
 *                the gantt's (one day of rounding at each end)
 *   today        the Today button at Day zoom: today's line on screen and
 *                today the date at the centre
 *   toggle       "Show weekends" on, then off, at Day zoom: the left date kept
 *   jump         a click on empty minimap at Day zoom, weekends hidden and
 *                shown: the gantt's left date is the one the click asks for —
 *                the clicked day less half the days the gantt shows, read off
 *                its header (never off the box the code drew)
 *   weekend      a Saturday at Week's left edge → Day (hidden) → Week: Monday,
 *                then Monday (a hidden day maps to the next shown one, and the
 *                anchor follows what is shown)
 *   transitions  the 12 ordered zoom changes from three left dates (36), with
 *                weekends shown and with weekends hidden: the left date kept
 *
 * The clock is fixed at Thursday 24 Sep 2026, 09:00 (the other Timeline
 * scripts' clock), so the Timeline opens where theirs does. "Show weekends"
 * starts OFF (this page's localStorage only). Transitions are switched off in
 * this page (end states are measured, not the minimap window's slide — S1
 * trap 2: compare the END state with the expected date). Needs the
 * worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1. Nothing is saved: zoom tabs, scrolls, the settings
 * drawer's two switches (this browser context's localStorage) and one
 * minimap click.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--size', '--shots', '--tag', '--json'].includes(args[i - 1])) || '5282';
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const SHOTS = flag('--shots');
const TAG = flag('--tag') || 'run';
const JSON_OUT = flag('--json');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const DAY_PX = { day: 56, week: 22, month: 8, quarter: 4 };
const ZOOM_NAME = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' };
const TODAY = [2026, 8, 24];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.clock.setFixedTime(new Date('2026-09-24T09:00:00'));
page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
await page.addInitScript(() => {
  try {
    const k = 'rabbit-timeline-settings-v1';
    if (!sessionStorage.getItem('s5p-seeded')) {
      const s = JSON.parse(localStorage.getItem(k) || '{}');
      localStorage.setItem(k, JSON.stringify({ ...s, showWeekends: false }));
      sessionStorage.setItem('s5p-seeded', '1');
    }
  } catch { /* a page without storage starts with weekends shown */ }
});
await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
const sleep = (ms) => page.waitForTimeout(ms);

for (let i = 0; i < 20; i++) {
  const open = await page.evaluate(() => {
    const vis = (b) => b.offsetParent !== null && !b.closest('.wilson-chrome, [data-testid="dev-fixtures-badge"]');
    const buttons = [...document.querySelectorAll('button')].filter(vis);
    if (buttons.some((b) => ['Control panel', 'Switch'].includes((b.textContent || '').trim()))) return true;
    buttons.find((b) => (b.textContent || '').includes('Salt Hours'))?.click();
    return false;
  });
  if (open) break;
  await sleep(500);
}
await page.getByRole('tab', { name: 'Timeline', exact: true }).first().click();
await page.locator('[title="Center the detail timeline on today"]').first().waitFor({ timeout: 20000 });
await sleep(800);

// ── The reading instruments, in the page ──────────────────────────────────
await page.evaluate(([ty, tm, td]) => {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LABEL_W = 240;
  const TODAY = new Date(ty, tm, td);
  const DAY_MS = 864e5;
  const ymd = (d) => (d ? [d.getFullYear(), d.getMonth(), d.getDate()] : null);
  const scroller = () => document.querySelector('.rb-tl-gantt');
  /** The header's ticks that print a date, left to right: { x, date }. */
  function datedTicks() {
    let year = null;
    const out = [];
    for (const el of scroller().querySelectorAll('.rb-tl-axis-tick')) {
      const x = parseFloat(el.style.left);
      const top = el.querySelector('.rb-tl-axis-top')?.textContent?.trim() || '';
      const label = el.querySelector('.rb-tl-axis-label')?.textContent?.trim() || '';
      let m;
      if ((m = /^[A-Z][a-z]{2} (\d{4})$/.exec(top)) || (m = /^Q\d (\d{4})$/.exec(top))) year = Number(m[1]);
      let date = null;
      if ((m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(label))) { year = Number(m[2]); date = new Date(year, MONTHS.indexOf(m[1]), 1); }
      else if ((m = /^([A-Z][a-z]{2}) (\d{1,2})$/.exec(label)) && year != null) date = new Date(year, MONTHS.indexOf(m[1]), Number(m[2]));
      else if ((m = /^([A-Z][a-z]{2})$/.exec(label)) && year != null) date = new Date(year, MONTHS.indexOf(m[1]), 1);
      if (date) out.push({ x, date });
    }
    return out;
  }
  /** The date printed over chart x: the last dated tick at or before it, plus whole columns. */
  function dateAtX(x, dayPx) {
    let best = null;
    for (const t of datedTicks()) { if (t.x <= x) best = t; else break; }
    if (!best) return null;
    const d = new Date(best.date);
    d.setDate(d.getDate() + Math.floor((x - best.x) / dayPx));
    return d;
  }
  /** Where chart x falls, in days from today, with the fraction into its
      column — off the header, as the date printed over that column. */
  function posAtX(x, dayPx) {
    let best = null;
    for (const t of datedTicks()) { if (t.x <= x) best = t; else break; }
    if (!best) return null;
    const whole = Math.floor((x - best.x) / dayPx);
    return Math.round((best.date - TODAY) / DAY_MS) + whole + (x - best.x - whole * dayPx) / dayPx;
  }
  function gantt(dayPx) {
    const sc = scroller();
    const s = sc.scrollLeft;
    const w = sc.clientWidth - LABEL_W;
    const todayEl = sc.querySelector('.rb-tl-today');
    const tx = todayEl ? parseFloat(todayEl.style.left) : null;
    return {
      scrollLeft: s,
      viewW: w,
      scrollMax: sc.scrollWidth - sc.clientWidth,
      left: ymd(dateAtX(s, dayPx)),
      centre: ymd(dateAtX(s + w / 2, dayPx)),
      right: ymd(dateAtX(s + w - 1, dayPx)),
      leftPos: posAtX(s, dayPx),
      rightPos: posAtX(s + w, dayPx),
      todayLine: tx == null ? 'not drawn' : (tx >= s && tx < s + w ? 'on screen' : (tx < s ? 'off screen, left' : 'off screen, right')),
    };
  }
  /** The minimap window's first and last day, read against the minimap's Today line and month lines. */
  function minimap() {
    const frame = document.querySelector('.rb-tl-ov-frame');
    const todayEl = document.querySelector('.rb-tl-ov-today');
    if (!frame || !todayEl) return null;
    const lines = [...document.querySelectorAll('.rb-tl-ov-grid')].map((e) => parseFloat(e.style.left)).sort((a, b) => a - b);
    const tx = parseFloat(todayEl.style.left);
    const before = lines.filter((x) => x <= tx).pop();
    const after = lines.find((x) => x > tx);
    const first = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    const next = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 1);
    const dayPx = (after - before) / Math.round((next - first) / DAY_MS);
    const fl = parseFloat(frame.style.left);
    const fw = parseFloat(frame.style.width);
    const at = (x) => { const d = new Date(TODAY); d.setDate(d.getDate() + Math.round((x - tx) / dayPx)); return d; };
    return { start: ymd(at(fl)), end: ymd(at(fl + fw)), dayPx, todayX: tx };
  }
  /** Chart x of a date's column at this zoom, from the header (null when it has no printed tick to stand on). */
  function xOfDate(y, mo, d, dayPx, ownTick) {
    const target = new Date(y, mo, d);
    let best = null;
    for (const t of datedTicks()) { if (t.date <= target) best = t; else break; }
    if (!best) return null;
    const days = Math.round((target - best.date) / DAY_MS);
    if (ownTick && days !== 0) return null;
    return best.x + days * dayPx;
  }
  function setScroll(x) { scroller().scrollLeft = x; return scroller().scrollLeft; }
  /** A point on EMPTY minimap body over a date's column (nothing marked no-jump under it). */
  function minimapPoint(y, mo, d) {
    const body = document.querySelector('[data-minimap-body]');
    const mm = minimap();
    if (!body || !mm) return null;
    const r = body.getBoundingClientRect();
    const days = Math.round((new Date(y, mo, d) - TODAY) / DAY_MS);
    const cx = Math.round(r.left + mm.todayX + days * mm.dayPx);
    for (let cy = Math.round(r.top) + 3; cy < r.bottom - 3; cy += 2) {
      let n = document.elementFromPoint(cx, cy);
      let free = !!n && body.contains(n);
      while (free && n && n !== body) { if (n.dataset?.minimapNojump) free = false; n = n.parentNode; }
      if (free) {
        // The date the click itself names: the code's own reading of the
        // pointer, Math.round(x / dayPx) from the span's start.
        const clicked = new Date(TODAY);
        clicked.setDate(clicked.getDate() + Math.round((cx - r.left - mm.todayX) / mm.dayPx));
        return { cx, cy, clicked: ymd(clicked) };
      }
    }
    return null;
  }
  window.__s5p = { gantt, minimap, xOfDate, setScroll, minimapPoint };
}, TODAY);

// ── Node-side helpers ──────────────────────────────────────────────────────
const asDate = (a) => (a ? new Date(a[0], a[1], a[2]) : null);
const fmt = (a) => { const d = asDate(a); return d ? `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` : '—'; };
const dayDiff = (a, b) => (a && b ? Math.round((asDate(b) - asDate(a)) / 864e5) : null);
const isWeekend = (a) => { const d = asDate(a); return d.getDay() === 0 || d.getDay() === 6; };
const nextShown = (a) => { const d = asDate(a); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); return [d.getFullYear(), d.getMonth(), d.getDate()]; };
let zoom = 'week';
let weekendsShown = false;
const hidden = () => zoom === 'day' && !weekendsShown;
const gantt = () => page.evaluate((px) => window.__s5p.gantt(px), DAY_PX[zoom]);
const minimap = () => page.evaluate(() => window.__s5p.minimap());
async function setZoom(z) {
  await page.locator(`[title="Switch the detail gantt to ${ZOOM_NAME[z]} zoom"]`).first().click();
  zoom = z;
  await page.mouse.move(W - 70, 12);
  await sleep(250);
}
async function shot(name) {
  if (!SHOTS) return;
  await sleep(150);
  await page.evaluate(() => document.querySelectorAll('animate, animateMotion, animateTransform, set').forEach((a) => a.remove()));
  await page.screenshot({ path: join(SHOTS, `po-s5p-${TAG}-${W}x${H}-${name}.png`) });
}
async function setWeekendsShown(on) {
  if (weekendsShown === on) return;
  await page.locator('button[aria-label="R.A.B.B.I.T. settings"], button[aria-label="RABBIT settings"]').first().click();
  await sleep(300);
  const editable = page.locator('[role="switch"][aria-label="Editable"]').first();
  if ((await editable.getAttribute('aria-checked')) !== 'true') { await editable.click(); await sleep(150); }
  await page.locator('[role="switch"][aria-label="Show weekends"]').first().click();
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(300);
  if (await page.locator('[title="Close settings"]').first().isVisible().catch(() => false)) {
    await page.locator('[title="Close settings"]').first().click();
    await sleep(300);
  }
  weekendsShown = on;
  await page.mouse.move(W - 70, 12);
  await sleep(250);
}
/** Put a date's column at the gantt's left edge, half a column in (a position exact at every zoom). */
async function leftOn(a) {
  const x = await page.evaluate(([y, m, d, px, own]) => window.__s5p.xOfDate(y, m, d, px, own), [a[0], a[1], a[2], DAY_PX[zoom], hidden()]);
  if (x == null) return null;
  await page.evaluate((v) => window.__s5p.setScroll(v), x + DAY_PX[zoom] / 2);
  await sleep(150);
  return (await gantt()).left;
}

const results = { size: `${W}x${H}`, tag: TAG, checks: [] };
let failed = 0;
function check(name, ok, detail) {
  results.checks.push({ name, ok, ...detail });
  if (!ok) failed++;
  return ok;
}
const expectKept = (before, after, toHidden) => {
  const want = toHidden && isWeekend(before) ? nextShown(before) : before;
  return { want, ok: dayDiff(want, after) === 0 };
};

console.log(`Timeline, weekends hidden — ${W}x${H}, clock Thu 24 Sep 2026 (port ${PORT})\n`);

// ── 1. Week → Day → Week from where the Timeline opens ─────────────────────
{
  const w0 = await gantt();
  await shot('1-week-as-opened');
  await setZoom('day');
  const d1 = await gantt();
  const mm = await minimap();
  await shot('1-2-after-week-to-day');
  await setZoom('week');
  const w2 = await gantt();
  const a = expectKept(w0.left, d1.left, true);
  const b = expectKept(d1.left, w2.left, false);
  console.log('1  zoom (weekends hidden at Day)');
  console.log(`   Week, as opened      left ${fmt(w0.left)}   scrollLeft ${w0.scrollLeft}`);
  console.log(`   → Day                left ${fmt(d1.left)}   (${dayDiff(w0.left, d1.left) >= 0 ? '+' : ''}${dayDiff(w0.left, d1.left)} days)   scrollLeft ${d1.scrollLeft}`);
  console.log(`   → Week               left ${fmt(w2.left)}   (${dayDiff(d1.left, w2.left) >= 0 ? '+' : ''}${dayDiff(d1.left, w2.left)} days)`);
  check('zoom week→day keeps the left date', a.ok, { before: fmt(w0.left), after: fmt(d1.left), want: fmt(a.want) });
  check('zoom day→week keeps the left date', b.ok, { before: fmt(d1.left), after: fmt(w2.left), want: fmt(b.want) });

  // ── 2. At Day zoom: the minimap window against the gantt ─────────────────
  const startOff = mm ? dayDiff(d1.left, mm.start) : null;
  const endOff = mm ? dayDiff(d1.right, mm.end) : null;
  console.log('\n2  window (Day zoom, weekends hidden)');
  console.log(`   gantt shows          ${fmt(d1.left)} – ${fmt(d1.right)}`);
  console.log(`   minimap window       ${mm ? `${fmt(mm.start)} – ${fmt(mm.end)}` : 'not found'}   (start ${startOff}, end ${endOff} days from the gantt's)`);
  check('window brackets the gantt at Day zoom', mm != null && startOff >= 0 && startOff <= 1 && endOff >= 0 && endOff <= 1,
    { gantt: `${fmt(d1.left)} – ${fmt(d1.right)}`, window: mm ? `${fmt(mm.start)} – ${fmt(mm.end)}` : null, startOff, endOff });
}

// ── 3. Today at Day zoom ───────────────────────────────────────────────────
{
  await setZoom('day');
  await page.locator('[title="Center the detail timeline on today"]').first().click();
  await page.mouse.move(W - 70, 12);
  await sleep(250);
  const g = await gantt();
  await shot('3-today-at-day');
  console.log('\n3  Today (Day zoom, weekends hidden)');
  console.log(`   gantt shows          ${fmt(g.left)} – ${fmt(g.right)}   centre ${fmt(g.centre)}   today's line ${g.todayLine}`);
  check('Today puts today on screen, at the centre', g.todayLine === 'on screen' && dayDiff(TODAY, g.centre) === 0,
    { left: fmt(g.left), centre: fmt(g.centre), right: fmt(g.right), todayLine: g.todayLine });
}

// ── 4. "Show weekends" on and off at Day zoom ──────────────────────────────
{
  const at = await leftOn([2026, 11, 11]); // Fri 11 Dec 2026
  const t0 = await gantt();
  await shot('4-day-weekends-hidden');
  await setWeekendsShown(true);
  const t1 = await gantt();
  await shot('4-day-weekends-shown');
  await setWeekendsShown(false);
  const t2 = await gantt();
  const a = expectKept(t0.left, t1.left, false);
  const b = expectKept(t1.left, t2.left, true);
  console.log('\n4  toggle (Day zoom)');
  console.log(`   weekends hidden      left ${fmt(t0.left)}   scrollLeft ${t0.scrollLeft}${at ? '' : '   (could not place Fri 11 Dec)'}`);
  console.log(`   → shown              left ${fmt(t1.left)}   (${dayDiff(t0.left, t1.left)} days)   scrollLeft ${t1.scrollLeft}`);
  console.log(`   → hidden             left ${fmt(t2.left)}   (${dayDiff(t1.left, t2.left)} days)   scrollLeft ${t2.scrollLeft}`);
  check('toggle to shown keeps the left date', a.ok, { before: fmt(t0.left), after: fmt(t1.left), want: fmt(a.want) });
  check('toggle to hidden keeps the left date', b.ok, { before: fmt(t1.left), after: fmt(t2.left), want: fmt(b.want) });
}

// ── 5. A click on empty minimap at Day zoom ────────────────────────────────
for (const shown of [false, true]) {
  await setWeekendsShown(shown);
  await setZoom('day');
  // Park the window at today first: a jump that worked leaves the window over
  // the date it was sent to, where a second click would find no empty
  // minimap (where the window sits does not change what a click asks for).
  await page.locator('[title="Center the detail timeline on today"]').first().click();
  await page.mouse.move(W - 70, 12);
  await sleep(250);
  const target = [2027, 0, 20]; // Wed 20 Jan 2027
  const pt = await page.evaluate(([y, m, d]) => window.__s5p.minimapPoint(y, m, d), target);
  if (!pt) { check(`jump at Day zoom, weekends ${shown ? 'shown' : 'hidden'}`, false, { error: 'no empty minimap under the date' }); continue; }
  // The days the window spans, from the gantt's own header (review round 1,
  // R1-05: not from the box the code drew): the dates at the gantt's two
  // edges, each rounded to a date as the window rounds them.
  const g0 = await gantt();
  const endPos = hidden() ? Math.max(g0.leftPos + 1, g0.rightPos) : g0.leftPos + Math.max(1, g0.viewW / DAY_PX[zoom]);
  const visibleDays = Math.max(1, Math.round(endPos) - Math.round(g0.leftPos));
  const mmBefore = await minimap();
  await page.mouse.click(pt.cx, pt.cy);
  await page.mouse.move(W - 70, 12);
  await sleep(250);
  const g = await gantt();
  const wantLeft = (() => { const d = asDate(pt.clicked); d.setDate(d.getDate() - Math.floor(visibleDays / 2)); return [d.getFullYear(), d.getMonth(), d.getDate()]; })();
  const k = expectKept(wantLeft, g.left, !shown);
  console.log(`\n5  jump (Day zoom, weekends ${shown ? 'shown' : 'hidden'}): a click on the minimap at ${fmt(pt.clicked)}`);
  console.log(`   the gantt shows ${visibleDays} days (the minimap's box: ${dayDiff(mmBefore.start, mmBefore.end)}), so it should start ${fmt(k.want)}`);
  console.log(`   gantt shows          ${fmt(g.left)} – ${fmt(g.right)}   centre ${fmt(g.centre)}   (${dayDiff(k.want, g.left)} days off)`);
  check(`jump at Day zoom, weekends ${shown ? 'shown' : 'hidden'}`, k.ok, { clicked: fmt(pt.clicked), want: fmt(k.want), left: fmt(g.left), centre: fmt(g.centre) });
}

// ── 6. A Saturday at Week's left edge → Day (hidden) → Week ────────────────
{
  await setWeekendsShown(false);
  await setZoom('week');
  const sat = await leftOn([2026, 9, 10]); // Sat 10 Oct 2026
  await setZoom('day');
  const d = await gantt();
  await setZoom('week');
  const w = await gantt();
  const mon = [2026, 9, 12];
  console.log('\n6  weekend anchor: Week at Sat 10 Oct → Day (hidden) → Week');
  console.log(`   Week                 left ${fmt(sat)}`);
  console.log(`   → Day                left ${fmt(d.left)}`);
  console.log(`   → Week               left ${fmt(w.left)}`);
  check('a hidden Saturday lands on the next shown day', dayDiff(mon, d.left) === 0 && dayDiff(mon, w.left) === 0,
    { week: fmt(sat), day: fmt(d.left), weekAgain: fmt(w.left), want: fmt(mon) });
}

// ── 7. The 36 transitions, weekends shown and hidden ───────────────────────
const ZOOMS = ['day', 'week', 'month', 'quarter'];
const ANCHORS = [[2026, 7, 3], [2026, 8, 24], [2026, 11, 11]]; // Mon 3 Aug, Thu 24 Sep, Fri 11 Dec 2026
for (const shown of [true, false]) {
  await setWeekendsShown(shown);
  let kept = 0;
  const moved = [];
  for (const a of ANCHORS) {
    for (const from of ZOOMS) {
      for (const to of ZOOMS) {
        if (from === to) continue;
        await setZoom(from);
        const l0 = await leftOn(a);
        if (!l0) { moved.push(`${from}→${to} from ${fmt(a)}: could not place`); continue; }
        await setZoom(to);
        const l1 = (await gantt()).left;
        const k = expectKept(l0, l1, to === 'day' && !shown);
        if (k.ok) kept++;
        else moved.push(`${from}→${to} from ${fmt(l0)}: ${fmt(l1)} (${dayDiff(k.want, l1) > 0 ? '+' : ''}${dayDiff(k.want, l1)} days)`);
      }
    }
  }
  const total = ANCHORS.length * 12;
  console.log(`\n7  transitions, weekends ${shown ? 'shown' : 'hidden'}: the left date kept ${kept} of ${total}`);
  for (const m of moved) console.log(`   moved: ${m}`);
  check(`transitions keep their date, weekends ${shown ? 'shown' : 'hidden'}`, kept === total, { kept, total, moved });
}

await browser.close();
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ every check: the gantt, the minimap window, Today and the switch keep the date');
process.exit(failed ? 1 : 0);
