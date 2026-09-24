#!/usr/bin/env node
/**
 * The Timeline minimap's gestures, measured — UI overhaul B3b (2026-09-24).
 *
 *   node scripts/timeline-minimap-gestures.mjs <port> [--size 1440x900] [--add N] [--json <file>]
 *
 * Review risk 5 (docs/design/review/r-a-b-b-i-t-part-2.md): the minimap's
 * hit-testing rests on a hand-set stack — the frame at zIndex 5, the bars at
 * 6, `data-minimap-nojump` walked up the DOM — so restyling the frame can make
 * bars unclickable or let the background swallow a bar's press. "Verify all
 * four gestures — click to jump, drag frame, drag bar, Ctrl+wheel zoom — after
 * any change to that stack." This does, in the running app (C1: they must do
 * exactly what they did).
 *
 * It finds everything the way timeline-minimap-count.mjs does — the bars by
 * their title, the frame by its title, the body as the bars' clipping
 * ancestor, the span by the zoom slider's value, the detail pane as the widest
 * horizontal scroller — so the SAME instrument reads the code before and after
 * a change (check the old files out, run it, check them back; B3 §5 trap 3).
 *
 *   jump          a click on empty minimap: the frame re-centres on that x
 *   frame         a 120px drag of the frame: the frame moves 120px, no bar moves
 *   bar           a 40px drag of a bar the frame does not cover: the bar moves
 *                 40px, the frame does not, no editor opens
 *   bar-in-frame  the same on a bar UNDER the frame: the bar still wins
 *   wheel         Ctrl + wheel over the body: the span grows 1.15x
 *   click-bar     a press without a move on a bar: its phase editor opens
 *   hover         a bar under the pointer shows the hover card with its name
 *   edges         (B3b) at a six-month span panned past every phase, each row
 *                 says which way its phase went (0 on the old code: empty rows);
 *                 a drag that starts on a marker pans the minimap as the empty
 *                 row always did
 * Every distance is allowed one day of rounding (the gestures snap to days).
 * It exits 1 if any gesture misbehaves. Needs the worktree's own dev server
 * with VITE_DEV_AUTOLOGIN=tester and VITE_DEV_FIXTURES=1. Nothing is saved
 * anywhere but the fixture's in-memory store, which a reload wipes.
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--size', '--json', '--add'].includes(args[i - 1])) || '5258';
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const ADD = Number(flag('--add') || 0);
const JSON_OUT = flag('--json');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.clock.setFixedTime(new Date('2026-09-24T09:00:00'));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
const sleep = (ms) => page.waitForTimeout(ms);
const byTitle = (t) => page.locator(`[title="${t}"]`).first();

for (let i = 0; i < 20; i++) {
  const open = await page.evaluate(() => {
    const vis = (b) => b.offsetParent !== null && !b.closest('.wilson-chrome, [data-testid="dev-fixtures-badge"]');
    const buttons = [...document.querySelectorAll('button')].filter(vis);
    if (buttons.some((b) => ['Control Panel', 'Switch'].includes((b.textContent || '').trim()))) return true;
    buttons.find((b) => (b.textContent || '').includes('Salt Hours'))?.click();
    return false;
  });
  if (open) break;
  await sleep(500);
}
await page.getByRole('tab', { name: 'Timeline', exact: true }).first().click();
await byTitle('Center the detail timeline on today').waitFor({ timeout: 20000 });
await sleep(800);

for (let k = 0; k < ADD; k++) {
  await page.getByRole('button', { name: 'Phase', exact: true }).first().click();
  const form = page.locator('.fixed').filter({ has: page.getByPlaceholder('e.g. Pre-production') }).last();
  await form.getByPlaceholder('e.g. Pre-production').fill(`Probe phase ${k + 1}`);
  const dates = form.locator('input[type="date"]');
  const s = new Date(2026, 9, 1 + 21 * k), e = new Date(2026, 9, 1 + 21 * k + 28);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await dates.nth(0).fill(iso(s));
  await dates.nth(1).fill(iso(e));
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await sleep(500);
}

/** The minimap as it stands: bars (by title), body, frame, span, detail scroll, editor. */
const state = () => page.evaluate(() => {
  const isMini = (t) => / · (drag to move · drag edges to resize|click to view · )/.test(t) && !/ · \d+(\.\d+)?d · /.test(t);
  const bars = [...document.querySelectorAll('[title]')].filter((e) => isMini(e.getAttribute('title')) && e.getBoundingClientRect().height > 0);
  const clip = (e) => { for (let n = e?.parentElement; n; n = n.parentElement) if (getComputedStyle(n).overflow === 'hidden' || getComputedStyle(n).overflowY === 'hidden') return n; return null; };
  const frame = document.querySelector('[title="Drag to scroll the detail pane"]');
  // With every phase off the window there is no bar: the body is then the
  // clipping ancestor of an edge marker, or of the frame.
  const body = clip(bars[0] || document.querySelector('[data-minimap-edge]') || frame);
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
  const scrollers = [...document.querySelectorAll('div')].filter((d) => ['auto', 'scroll'].includes(getComputedStyle(d).overflowX) && d.scrollWidth > d.clientWidth * 2);
  const detail = scrollers.sort((a, b) => b.scrollWidth - a.scrollWidth)[0];
  const slider = document.querySelector('input[type="range"]');
  const header = body?.previousElementSibling;
  const phasesText = [...document.querySelectorAll('span, div')].find((e) => /^phases$/i.test((e.textContent || '').trim()) && e.children.length === 0);
  const phases = Number((phasesText?.previousElementSibling?.textContent || phasesText?.parentElement?.textContent || '').match(/\d+/)?.[0] ?? NaN);
  return {
    phases,
    ticks: header ? [...header.children].map((c) => c.getBoundingClientRect().left).sort((a, b) => a - b) : [],
    bars: bars.map((b) => ({ name: b.getAttribute('title').split(' · ')[0], ...box(b) })),
    body: box(body),
    frame: box(frame),
    span: slider ? Number(slider.value) : null,
    detail: detail ? detail.scrollLeft : null,
    editor: !!document.querySelector('input[placeholder="e.g. Pre-production"]'),
    edges: [...document.querySelectorAll('[data-minimap-edge]')].map((e) => ({ side: e.getAttribute('data-minimap-edge'), ...box(e) })),
  };
});
/** What is under a point, as the gesture code decides it. */
const hitAt = (x, y) => page.evaluate(([px, py]) => {
  const el = document.elementFromPoint(px, py);
  const t = el?.closest('[title]')?.getAttribute('title') || '';
  if (/ · (drag to move|click to view) /.test(t) && !/ · \d+(\.\d+)?d · /.test(t)) return 'bar';
  if (t === 'Drag to scroll the detail pane') return 'frame';
  if (el?.closest('[data-minimap-nojump]')) return 'nojump';
  return 'background';
}, [x, y]);
const setSpan = async (days) => {
  await page.locator('input[type="range"]').first().evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, days);
  await sleep(300);
};
const drag = async (x, y, dx) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) { await page.mouse.move(x + (dx * k) / 8, y); await sleep(16); }
  await page.mouse.up();
  await sleep(400);
};
const closeEditor = async () => {
  for (const name of ['Cancel', 'Close']) {
    const b = page.getByRole('button', { name, exact: true }).last();
    if (await b.count()) { await b.click().catch(() => {}); await sleep(200); }
    if (!(await state()).editor) return;
  }
  await page.keyboard.press('Escape'); await sleep(200);
};

const results = [];
const check = (gesture, ok, measured) => { results.push({ gesture, ok, ...measured }); };

/* KNOWN — found by this tool's first run (B3b), present on the code BEFORE
   B3b's change as on the code after, and not B3b's to change (C1: a fix
   changes what a drag does). Keyed on the exact signature, so a new defect of
   the same gesture still fails, and a fixed one passes and should be deleted:
   - a minimap bar's drag never commits. OverviewBar's move handler writes
     `e.currentTarget._draftStart` on the mousedown's synthetic event, whose
     currentTarget React has nulled by then (TypeError on every move); the
     release then saves the ORIGINAL dates. The press does land on the bar
     (the stack is right), and the release, off the bar, clicks the row under
     it, which re-centres the frame there (click-to-jump). */
const KNOWN_DRAG = /Cannot set properties of null \(setting '_draftStart'\)/;
const knownBar = (r) => (r.gesture === 'bar' || r.gesture === 'bar-in-frame')
  && r.pressed === 'bar' && Math.abs(r.barDx) <= tol && errors.some((e) => KNOWN_DRAG.test(e));

// A fixed span so a moved phase cannot rescale the minimap under the measurement.
await setSpan(730);
let s = await state();
const dayPx = s.body.w / s.span;
const tol = Math.max(2, dayPx * 1.01);

// ── jump ───────────────────────────────────────────────────────────────────
{
  const y = s.body.y + 6;
  let x = s.body.x + s.body.w * 0.8;
  while ((await hitAt(x, y)) !== 'background' && x > s.body.x + 40) x -= 17;
  const before = s;
  await page.mouse.click(x, y);
  await sleep(500);
  s = await state();
  const off = s.frame.cx - x;
  check('jump', Math.abs(off) <= s.frame.w / 2 * 0.1 + tol && s.detail !== before.detail && !s.editor, { clickX: Math.round(x), frameCentreMinusClick: +off.toFixed(1), detailMoved: s.detail - before.detail });
}

// ── frame ──────────────────────────────────────────────────────────────────
{
  const before = s;
  await drag(before.frame.cx, before.frame.y + 4, -120);
  s = await state();
  const moved = s.frame.x - before.frame.x;
  const barsMoved = s.bars.filter((b, i) => Math.abs(b.x - before.bars[i].x) > 0.5).length;
  check('frame', Math.abs(moved + 120) <= tol && barsMoved === 0 && !s.editor, { frameDx: +moved.toFixed(1), expected: -120, barsMoved });
}

// ── bar (outside the frame) and bar-in-frame ──────────────────────────────
const barDrag = async (label, pick) => {
  const before = await state();
  const i = pick(before);
  if (i < 0) { check(label, false, { reason: 'no bar to drag' }); return; }
  const b = before.bars[i];
  // Press away from the resize edges (6px) and, for bar-in-frame, inside the frame.
  const x = label === 'bar-in-frame' ? Math.max(b.x + 8, Math.min(b.x + b.w - 8, before.frame.cx)) : b.cx;
  const under = await hitAt(x, b.cy);
  await drag(x, b.cy, 40);
  const after = await state();
  const j = after.bars.findIndex((q) => q.name === b.name);
  const ref = before.bars.findIndex((q, k) => k !== i);
  const refAfter = after.bars.findIndex((q) => q.name === before.bars[ref].name);
  const moved = (after.bars[j].x - after.bars[refAfter].x) - (b.x - before.bars[ref].x);
  const frameMoved = after.frame.x - before.frame.x;
  check(label, under === 'bar' && Math.abs(moved - 40) <= tol && Math.abs(frameMoved) <= 0.5 && !after.editor,
    { bar: b.name, pressed: under, barDx: +moved.toFixed(1), expected: 40, frameDx: +frameMoved.toFixed(1), editor: after.editor });
  if (after.editor) await closeEditor();
};
const overlapsFrame = (st, b) => b.x < st.frame.x + st.frame.w && b.x + b.w > st.frame.x;
await barDrag('bar', (st) => st.bars.findIndex((b) => b.w >= 20 && !overlapsFrame(st, b) && b.x > st.body.x + 30 && b.x + b.w < st.body.x + st.body.w - 60));
// Put the frame over a bar: click empty space in another row at that bar's x.
{
  const st = await state();
  const target = st.bars.find((b) => b.w >= 24 && b.x > st.body.x + 60 && b.x + b.w < st.body.x + st.body.w - 60);
  if (target) {
    for (const r of st.bars) {
      if (r.name === target.name) continue;
      if ((await hitAt(target.cx, r.cy)) === 'background') { await page.mouse.click(target.cx, r.cy); await sleep(500); break; }
    }
  }
}
await barDrag('bar-in-frame', (st) => st.bars.findIndex((b) => b.w >= 24 && overlapsFrame(st, b) && st.frame.cx > b.x + 8 && st.frame.cx < b.x + b.w - 8));

// ── wheel ──────────────────────────────────────────────────────────────────
{
  const before = await state();
  let x = before.body.x + before.body.w * 0.9;
  const y = before.body.y + before.body.h - 4;
  while ((await hitAt(x, y)) !== 'background' && x > before.body.x + 40) x -= 17;
  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Control');
  await sleep(400);
  s = await state();
  check('wheel', s.span === Math.round(before.span * 1.15), { spanBefore: before.span, spanAfter: s.span, expected: Math.round(before.span * 1.15) });
}

// ── click-bar ──────────────────────────────────────────────────────────────
{
  const st = await state();
  const b = st.bars.find((q) => q.w >= 20 && q.x > st.body.x + 10 && q.x + q.w < st.body.x + st.body.w - 10);
  const under = await hitAt(b.cx, b.cy);
  await page.mouse.click(b.cx, b.cy);
  await sleep(500);
  const after = await state();
  check('click-bar', under === 'bar' && after.editor && after.detail === st.detail, { bar: b.name, pressed: under, editor: after.editor, detailMoved: after.detail - st.detail });
  if (after.editor) await closeEditor();
}

// ── hover ──────────────────────────────────────────────────────────────────
{
  const st = await state();
  const b = st.bars.find((q) => q.w >= 12);
  await page.mouse.move(b.cx, b.cy);
  await sleep(300);
  const card = await page.evaluate((name) => {
    const c = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).position === 'fixed' && getComputedStyle(d).pointerEvents === 'none' && (d.textContent || '').includes(name) && /task/.test(d.textContent || ''));
    if (!c) return null;
    const cs = getComputedStyle(c);
    return { text: c.textContent.slice(0, 60), ground: cs.backgroundColor, border: cs.borderTopColor, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow !== 'none' };
  }, b.name);
  check('hover', !!card, { bar: b.name, card });
  await page.mouse.move(5, 5);
  await sleep(200);
}

// ── edges ──────────────────────────────────────────────────────────────────
{
  await setSpan(183);
  const st0 = await state();
  const y = st0.body.y + st0.body.h - 3;
  const x = st0.body.x + st0.body.w / 2;
  const pan = async (px) => { await page.mouse.move(x, y); for (let k = 0; k < 10; k++) { await page.mouse.wheel(px / 10, 0); await sleep(30); } await sleep(300); };
  // Forward a year and a half: every phase is behind the window.
  await pan(Math.round(st0.body.w * 3));
  const ahead = await state();
  // Back three years: every phase is ahead of it.
  await pan(-Math.round(st0.body.w * 6));
  const behind = await state();
  // A drag that starts on a marker pans, as the empty row under it did: a
  // month tick 150px or more in moves 100px left (months are ~240px apart
  // here, so the one tick in that 100px window is the same tick).
  const m = behind.edges[0];
  let panned = null;
  if (m) {
    const t0 = behind.ticks.find((l) => l > behind.body.x + 150);
    await drag(m.x + Math.min(m.w, 40) / 2, m.cy, -100);
    const after = await state();
    const t1 = after.ticks.find((l) => l > t0 - 150 && l < t0 - 50);
    panned = { tickDx: t1 != null ? +(t1 - t0).toFixed(1) : null, editor: after.editor };
  }
  const n = ahead.phases;
  const allBefore = ahead.edges.length === n && ahead.edges.every((e) => e.side === 'before');
  const allAfter = behind.edges.length === n && behind.edges.every((e) => e.side === 'after');
  // The background pan rounds EACH move event to whole days (panMinimap), so
  // eight 12.5px steps move the window 8 × round(12.5 / dayPx) days.
  const px183 = st0.body.w / 183;
  const expectDx = -8 * Math.round(12.5 / px183) * px183;
  check('edges', n > 0 && allBefore && allAfter && !!panned && panned.tickDx != null && Math.abs(panned.tickDx - expectDx) <= 1.5 && !panned.editor,
    { phases: n, markedAhead: ahead.edges.length, markedBehind: behind.edges.length, markerDrag: { ...panned, expected: +expectDx.toFixed(1) } });
}

await browser.close();
console.log(`\nminimap gestures at ${W}x${H}${ADD ? `, ${ADD} phases added` : ''} (dayPx ${dayPx.toFixed(2)} at 2 yr, tolerance ${tol.toFixed(1)}px)\n`);
for (const r of results) {
  r.known = !r.ok && knownBar(r);
  const { gesture, ok, known, ...m } = r;
  console.log(`${ok ? 'ok   ' : known ? 'known' : 'FAIL '} ${gesture.padEnd(13)} ${JSON.stringify(m)}`);
}
const newErrors = [...new Set(errors)].filter((e) => !KNOWN_DRAG.test(e));
const knownErrors = errors.length - errors.filter((e) => !KNOWN_DRAG.test(e)).length;
if (knownErrors) console.log(`\n(${knownErrors} known page error${knownErrors === 1 ? '' : 's'}: the bar drag's _draftStart, see KNOWN)`);
if (newErrors.length) console.log(`\npage errors:\n  ${newErrors.join('\n  ')}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ size: `${W}x${H}`, added: ADD, results, errors }, null, 2));
process.exit(results.every((r) => r.ok || r.known) && !newErrors.length ? 0 : 1);
