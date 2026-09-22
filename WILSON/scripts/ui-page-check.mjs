#!/usr/bin/env node
/**
 * UI overhaul — walk every page and measure what the BROWSER actually renders.
 *
 *   node scripts/ui-page-check.mjs [port]
 *
 * The grep audit proves what the source says. This proves what the app does,
 * which is the claim C7 actually makes: "A session may not introduce a size
 * that is not a scale step." A computed `font-size` of 10.5px cannot hide from
 * this the way a class inside a template literal can hide from a regex.
 *
 * For every page it reports console errors, horizontal overflow, and the count
 * of visible text nodes rendering at a size that is NOT one of the seven steps
 * (11, 12, 13, 14, 16, 20 — and h3/body share 14).
 *
 * Plan §7 says "never claim 'looks right' from getComputedStyle (an
 * undisplayed pane freezes style recalc)" — which is why this drives a real
 * headless browser with the page displayed, not the Browser pane's DOM.
 *
 * Needs the worktree's own dev server with fixtures on. T0 measured, at
 * 1280x700 on all twelve pages: 0 errors, 0 overflow, 0 off-scale.
 *
 * 🚨 TWELVE URLs IS NOT TWELVE SCREENS, AND T2 FOUND THE GAP THE HARD WAY.
 * `/rabbit` without a project selected renders the project LIST — 33 text
 * nodes — and every one of R.A.B.B.I.T.'s eleven tabs lives behind a project
 * choice. So the strongest evidence in the bundle was measuring a screen that
 * held none of T2's work: Intake, Team and Timeline were never visited. The
 * same shape as trap 16, which caught the screenshots and not this.
 *
 * `--tabs` adds a second pass that opens the "Salt Hours" fixture project and
 * walks each tab by name. It is opt-in so the twelve-page number stays
 * comparable between sessions.
 *
 *   node scripts/ui-page-check.mjs 5243 1280 700 --tabs
 */
import { chromium } from '@playwright/test';

const PORT = process.argv[2] || '5241';
const BASE = `http://localhost:${PORT}`;
const PAGES = ['/', '/dog', '/otter', '/rabbit', '/settings', '/project-manager',
  '/rate-card', '/team-members', '/project-files', '/dashboard', '/admin-terminal', '/help'];
const TABS = ['Intake', 'Summary', 'Team', 'Tasks', 'Timeline', 'Budget', 'Assets', 'Scenes', 'Bins'];
const WITH_TABS = process.argv.includes('--tabs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(process.argv[3] || 1280), height: Number(process.argv[4] || 700) } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 110)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 110)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await sleep(12000);

/** One measurement of whatever is on screen right now. */
async function measure(label) {
  const info = await page.evaluate(() => {
    const seen = {};
    let offScale = 0;
    for (const el of document.querySelectorAll('*')) {
      if (el.offsetParent === null && el.tagName !== 'BODY') continue;
      if (!el.textContent || !el.textContent.trim()) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const px = Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10;
      seen[px] = (seen[px] || 0) + 1;
      if (![11, 12, 13, 14, 16, 20].includes(px)) offScale++;
    }
    return { sizes: seen, offScale, overflow: document.documentElement.scrollWidth > window.innerWidth + 2 };
  });
  const sizes = Object.entries(info.sizes).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([px, n]) => `${px}px:${n}`).join('  ');
  console.log(`${label.padEnd(20)} err=${errors.length}  hOverflow=${info.overflow}  offScale=${info.offScale}   ${sizes}`);
  for (const e of errors.slice(0, 2)) console.log(`      ! ${e}`);
  return info;
}

/** Click a VISIBLE button by its exact text, in the page's own DOM.
 *  `page.locator` would resolve a twin on a page nobody is looking at —
 *  App.jsx renders every page at once and hides the inactive ones. */
async function clickButton(text) {
  return page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => (x.textContent || '').trim() === t && x.offsetParent !== null);
    if (b) { b.click(); return true; }
    return false;
  }, text);
}

for (const p of PAGES) {
  errors.length = 0;
  await page.goto(BASE + p, { waitUntil: 'domcontentloaded' });
  await sleep(5000);
  await measure(p);
}

if (WITH_TABS) {
  console.log('\n— R.A.B.B.I.T. tabs, with the fixture project open —');
  await page.goto(BASE + '/rabbit', { waitUntil: 'domcontentloaded' });
  await sleep(6000);
  const picked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => (x.textContent || '').includes('Salt Hours') && x.offsetParent !== null);
    if (b) { b.click(); return true; }
    return false;
  });
  await sleep(4000);
  if (!picked) console.log('  ! could not open the fixture project — every row below is an empty state');
  for (const t of TABS) {
    errors.length = 0;
    const ok = await clickButton(t);
    await sleep(3500);
    await measure(`  ${t}${ok ? '' : ' (NOT OPENED)'}`);
  }
}

await browser.close();
