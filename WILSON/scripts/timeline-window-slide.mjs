#!/usr/bin/env node
/**
 * The minimap window's slide on a zoom-tab change, frame by frame —
 * post-overhaul S5p (2026-10-05), committed by its review round 1 (R1-06):
 * the claim "every zoom-tab change slides from the old box to the new, no
 * wrong box" had no instrument a later session could re-run.
 *
 *   node scripts/timeline-window-slide.mjs <port> [--size 1440x900]
 *
 * S1's ruling B7: the minimap's outlined window slides to its new box when the
 * gantt's zoom tab changes (`data-animate`, the outline's transition), and is
 * never drawn in a wrong box on the way — S1 trap 2: a check that only
 * watches the motion passes a bug, so each change is judged on its FRAMES
 * against its own two ends. The pixel harness (timeline-state-shots.mjs)
 * switches transitions off and cannot see any of this; here they are ON.
 *
 * For each change: the outline's box is read, the tab is clicked inside the
 * page, and the outline is sampled every animation frame for 700ms — its
 * drawn box (getBoundingClientRect) and its committed box (its inline
 * left / width, the transition's target). It passes when (review round 2,
 * R2-01: the first version passed an outline that jumped, one re-created on
 * the change, and a committed box off the minimap):
 *
 *   - the outline is the SAME element throughout (a re-created one has
 *     nothing to animate from);
 *   - its committed box is the final box from the first frame on (no wrong
 *     box is ever committed — S1's original bug was the new scale with the
 *     old scroll for one render);
 *   - every drawn frame's left edge, right edge and width lie between the old
 *     box's and the final box's (0.75px of rounding);
 *   - where the two ends differ, some frame lies clearly between them (it
 *     SLID: a jump has no frame in between);
 *   - the outline was marked to animate (data-animate) and came to rest (the
 *     last two frames agree);
 *   - and a frame with no outline at all fails rather than stalls.
 *
 * Cases, with "Show weekends" on and off:
 *
 *   - the 12 ordered zoom changes, chained from where the Timeline opens;
 *   - Sat 10 Oct at Week's left edge → Day (with weekends hidden its first
 *     commit's box and its final box differ: the anchor moves to Monday);
 *   - Day scrolled to the chart's end → Quarter (the browser clamps the
 *     scroll), and Quarter at the end → Day;
 *   - Day with Fri 9 Oct a column's width less one pixel in → Week.
 *
 * The clock is fixed at Thursday 24 Sep 2026, 09:00 (the other Timeline
 * scripts' clock). Needs the worktree's own dev server with
 * VITE_DEV_AUTOLOGIN=tester and VITE_DEV_FIXTURES=1. Nothing is saved: zoom
 * tabs and scrolls only; "Show weekends" is set in this page's localStorage.
 * Exits 1 if any change fails any of the checks above.
 */
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '--size') || '5282';
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const ZOOMS = ['day', 'week', 'month', 'quarter'];
const NAME = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' };
const DAY_PX = { day: 56, week: 22, month: 8, quarter: 4 };
const TOL = 0.75;

const browser = await chromium.launch();
let failed = 0;

async function openTimeline(weekendsShown) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.clock.setFixedTime(new Date('2026-09-24T09:00:00'));
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  await page.addInitScript((shown) => {
    try {
      if (!sessionStorage.getItem('slide-seeded')) {
        const k = 'rabbit-timeline-settings-v1';
        const s = JSON.parse(localStorage.getItem(k) || '{}');
        localStorage.setItem(k, JSON.stringify({ ...s, showWeekends: shown }));
        sessionStorage.setItem('slide-seeded', '1');
      }
    } catch { /* no storage: weekends shown */ }
  }, weekendsShown);
  await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
  for (let i = 0; i < 20; i++) {
    const open = await page.evaluate(() => {
      const vis = (b) => b.offsetParent !== null && !b.closest('.wilson-chrome, [data-testid="dev-fixtures-badge"]');
      const buttons = [...document.querySelectorAll('button')].filter(vis);
      if (buttons.some((b) => ['Control panel', 'Switch'].includes((b.textContent || '').trim()))) return true;
      buttons.find((b) => (b.textContent || '').includes('Salt Hours'))?.click();
      return false;
    });
    if (open) break;
    await page.waitForTimeout(500);
  }
  await page.getByRole('tab', { name: 'Timeline', exact: true }).first().click();
  await page.locator('[title="Center the detail timeline on today"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  return page;
}

/** Click a zoom tab and let any slide finish. */
async function settleOn(page, z) {
  await page.locator(`[title="Switch the detail gantt to ${NAME[z]} zoom"]`).first().click();
  await page.mouse.move(W - 70, 12);
  await page.waitForTimeout(800);
}

/** Chart x of a date's column at a zoom, off the gantt's header (null when no printed tick stands under it). */
const xOfDate = (page, [y, mo, d], dayPx) => page.evaluate(([y, mo, d, dayPx]) => {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let year = null;
  let best = null;
  const target = new Date(y, mo, d);
  for (const el of document.querySelectorAll('.rb-tl-gantt .rb-tl-axis-tick')) {
    const x = parseFloat(el.style.left);
    const top = el.querySelector('.rb-tl-axis-top')?.textContent?.trim() || '';
    const label = el.querySelector('.rb-tl-axis-label')?.textContent?.trim() || '';
    let m;
    if ((m = /^[A-Z][a-z]{2} (\d{4})$/.exec(top)) || (m = /^Q\d (\d{4})$/.exec(top))) year = Number(m[1]);
    let date = null;
    if ((m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(label))) { year = Number(m[2]); date = new Date(year, MONTHS.indexOf(m[1]), 1); }
    else if ((m = /^([A-Z][a-z]{2}) (\d{1,2})$/.exec(label)) && year != null) date = new Date(year, MONTHS.indexOf(m[1]), Number(m[2]));
    else if ((m = /^([A-Z][a-z]{2})$/.exec(label)) && year != null) date = new Date(year, MONTHS.indexOf(m[1]), 1);
    if (!date) continue;
    if (date <= target) best = { x, date }; else break;
  }
  if (!best) return null;
  return best.x + Math.round((target - best.date) / 864e5) * dayPx;
}, [y, mo, d, dayPx]);

const setScroll = (page, x) => page.evaluate((v) => {
  const sc = document.querySelector('.rb-tl-gantt');
  sc.scrollLeft = v === 'end' ? sc.scrollWidth : v;
  return sc.scrollLeft;
}, x);

/** One zoom change, frame by frame: the verdict and a line to print. */
async function slide(page, label, to) {
  const sample = await page.evaluate(async (title) => {
    const node = document.querySelector('.rb-tl-ov-frame-edge');
    if (!node) return { error: 'no outline before the click' };
    const r0 = node.getBoundingClientRect();
    const before = { l: r0.left, r: r0.right, w: r0.width };
    const frames = [];
    document.querySelector(`[title="${title}"]`).click();
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const e = document.querySelector('.rb-tl-ov-frame-edge');
        if (!e) frames.push({ t: Math.round(performance.now() - t0), missing: true });
        else {
          const r = e.getBoundingClientRect();
          frames.push({
            t: Math.round(performance.now() - t0), l: r.left, r: r.right, w: r.width,
            sl: parseFloat(e.style.left), sw: parseFloat(e.style.width),
            same: e === node, anim: e.getAttribute('data-animate'),
          });
        }
        if (performance.now() - t0 < 700) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    return { before, frames };
  }, `Switch the detail gantt to ${NAME[to]} zoom`);
  await page.mouse.move(W - 70, 12);
  const fail = (why) => { failed++; console.log(`  ✗ ${label.padEnd(34)} ${why}`); return false; };
  if (sample.error) return fail(sample.error);
  const { before, frames } = sample;
  if (frames.some((f) => f.missing)) return fail(`NO OUTLINE in ${frames.filter((f) => f.missing).length} frame(s)`);
  const end = frames[frames.length - 1];
  const prev = frames[frames.length - 2] || end;
  const between = (v, a, b) => v >= Math.min(a, b) - TOL && v <= Math.max(a, b) + TOL;
  const strictly = (v, a, b) => v > Math.min(a, b) + TOL && v < Math.max(a, b) - TOL;
  const problems = [];
  if (!frames.every((f) => f.same)) problems.push('RE-CREATED (a new outline has nothing to slide from)');
  const committed = frames.filter((f) => Math.abs(f.sl - end.sl) > 0.01 || Math.abs(f.sw - end.sw) > 0.01);
  if (committed.length) problems.push(`WRONG BOX COMMITTED: ${committed.slice(0, 3).map((f) => `${f.t}ms ${f.sl.toFixed(1)}+${f.sw.toFixed(1)}`).join(', ')} (final ${end.sl.toFixed(1)}+${end.sw.toFixed(1)})`);
  const outside = frames.filter((f) => !between(f.l, before.l, end.l) || !between(f.r, before.r, end.r) || !between(f.w, before.w, end.w));
  if (outside.length) problems.push(`WRONG BOX DRAWN: ${outside.slice(0, 3).map((f) => `${f.t}ms ${f.l.toFixed(1)}..${f.r.toFixed(1)}`).join(', ')}`);
  const differs = Math.abs(end.l - before.l) > 2 * TOL || Math.abs(end.w - before.w) > 2 * TOL;
  const slid = frames.some((f) => (Math.abs(end.l - before.l) > 2 * TOL && strictly(f.l, before.l, end.l)) || (Math.abs(end.w - before.w) > 2 * TOL && strictly(f.w, before.w, end.w)));
  if (differs && !slid) problems.push('JUMPED (no frame between the two boxes)');
  if (!frames.some((f) => f.anim === 'true')) problems.push('NOT MARKED TO ANIMATE');
  if (Math.abs(end.l - prev.l) > 0.01 || Math.abs(end.w - prev.w) > 0.01) problems.push('NOT AT REST');
  const moving = frames.filter((f, k) => k > 0 && (Math.abs(f.l - frames[k - 1].l) > 0.01 || Math.abs(f.w - frames[k - 1].w) > 0.01)).length;
  if (problems.length) return fail(`${before.l.toFixed(1)}+${before.w.toFixed(1)} → ${end.l.toFixed(1)}+${end.w.toFixed(1)}   ${problems.join('; ')}`);
  console.log(`  ✓ ${label.padEnd(34)} ${before.l.toFixed(1)}+${before.w.toFixed(1)} → ${end.l.toFixed(1)}+${end.w.toFixed(1)}   ${frames.length} frames, ${moving} moving`);
  return true;
}

for (const shown of [true, false]) {
  console.log(`\nweekends ${shown ? 'shown' : 'hidden'} — ${W}x${H}, port ${PORT}`);
  const page = await openTimeline(shown);
  let ok = 0;
  let n = 0;
  for (const from of ZOOMS) {
    for (const to of ZOOMS) {
      if (from === to) continue;
      await settleOn(page, from);
      n++; if (await slide(page, `${from} → ${to}`, to)) ok++;
    }
  }
  // The edges review round 1 named.
  await settleOn(page, 'week');
  const sat = await xOfDate(page, [2026, 9, 10], DAY_PX.week);
  if (sat != null) { await setScroll(page, sat + DAY_PX.week / 2); await page.waitForTimeout(300); n++; if (await slide(page, 'week, Sat 10 Oct at the left → day', 'day')) ok++; }
  await page.waitForTimeout(800);
  await setScroll(page, 'end'); await page.waitForTimeout(300);
  n++; if (await slide(page, 'day, at the chart\'s end → quarter', 'quarter')) ok++;
  await page.waitForTimeout(800);
  await setScroll(page, 'end'); await page.waitForTimeout(300);
  n++; if (await slide(page, 'quarter, at the chart\'s end → day', 'day')) ok++;
  await page.waitForTimeout(800);
  const fri = await xOfDate(page, [2026, 9, 9], DAY_PX.day);
  if (fri != null) { await setScroll(page, fri + DAY_PX.day - 1); await page.waitForTimeout(300); n++; if (await slide(page, 'day, Fri 9 Oct + 55px → week', 'week')) ok++; }
  console.log(`  ${ok} of ${n} slide from the old box to the new with no wrong box`);
  await page.close();
}

await browser.close();
console.log(failed ? `\n✗ ${failed} zoom change(s) failed: see the lines marked ✗` : '\n✓ every zoom-tab change slides, on one outline, from the old box to the new; no wrong box committed or drawn; both settings');
process.exit(failed ? 1 : 0);
