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
 */
import { chromium } from '@playwright/test';

const PORT = process.argv[2] || '5241';
const BASE = `http://localhost:${PORT}`;
const PAGES = ['/', '/dog', '/otter', '/rabbit', '/settings', '/project-manager',
  '/rate-card', '/team-members', '/project-files', '/dashboard', '/admin-terminal', '/help'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 700 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 110)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 110)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await sleep(12000);

for (const p of PAGES) {
  errors.length = 0;
  await page.goto(BASE + p, { waitUntil: 'domcontentloaded' });
  await sleep(5000);
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
  console.log(`${p.padEnd(17)} err=${errors.length}  hOverflow=${info.overflow}  offScale=${info.offScale}   ${sizes}`);
  for (const e of errors.slice(0, 2)) console.log(`      ! ${e}`);
}
await browser.close();
