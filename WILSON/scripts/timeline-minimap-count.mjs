#!/usr/bin/env node
/**
 * The Timeline minimap, counted — UI overhaul B3 (2026-09-24), Audrey's Q22.
 *
 *   node scripts/timeline-minimap-count.mjs <port> [--add N] [--size 1440x900] [--shots <dir>] [--json <file>]
 *
 * Q22: the minimap must draw every phase, never truncate silently, and carry
 * legible labels. This counts, in the running app, at every zoom the minimap
 * offers (its default span, Fit, the slider's 6 months / 1 / 2 / 5 years) and
 * at each of the detail pane's four zooms:
 *
 *   phases     how many phases the project has (the summary band's count)
 *   rows       minimap bars in the DOM
 *   drawn      bars wholly inside the minimap body, top to bottom
 *   cut        bars the body clips vertically (partly or wholly below it) —
 *              the silent truncation this bundle removes
 *   off        bars wholly outside the window sideways (panned or zoomed away)
 *   marked     rows that SAY where an off-window phase went (the edge marker
 *              B3 adds; 0 before)
 *   axis       the axis labels: how many, the smallest font size, and how many
 *              neighbouring pairs overprint (V1-07)
 *
 * --add N creates N extra phases through the app's own "Phase" form, in the
 * fixture's in-memory store (a reload wipes them), so the case the fixture
 * lacks — more than five phases — is measured in the real component, not
 * simulated. Nothing is saved anywhere else. Needs the worktree's own dev
 * server with VITE_DEV_AUTOLOGIN=tester and VITE_DEV_FIXTURES=1.
 *
 * It finds the minimap by its bars' titles ("<name> · drag to move · drag
 * edges to resize" — the detail pane's carry a length, "· 12.0d ·") and the
 * body as the bars' nearest `overflow: hidden` ancestor, so the same
 * instrument reads the component before and after the restyle.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--add', '--size', '--shots', '--json'].includes(args[i - 1])) || '5257';
const ADD = Number(flag('--add') || 0);
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const SHOTS = flag('--shots');
const JSON_OUT = flag('--json');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.clock.setFixedTime(new Date('2026-09-24T09:00:00'));
page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
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

// ── --add: extra phases through the app's own form ─────────────────────────
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

/** One measurement of the minimap as it stands. */
const measure = () => page.evaluate(() => {
  const phasesText = [...document.querySelectorAll('span, div')].find((e) => /^phases$/i.test((e.textContent || '').trim()) && e.children.length === 0);
  const phases = Number((phasesText?.previousElementSibling?.textContent || phasesText?.parentElement?.textContent || '').match(/\d+/)?.[0] ?? NaN);
  const isMini = (t) => / · (drag to move · drag edges to resize|click to view · )/.test(t) && !/ · \d+(\.\d+)?d · /.test(t);
  const bars = [...document.querySelectorAll('[title]')].filter((e) => isMini(e.getAttribute('title')) && e.getBoundingClientRect().height > 0);
  const hidden = (e) => { for (let n = e.parentElement; n; n = n.parentElement) if (getComputedStyle(n).overflow === 'hidden' || getComputedStyle(n).overflowY === 'hidden') return n; return null; };
  const body = bars.length ? hidden(bars[0]) : null;
  const b = body?.getBoundingClientRect();
  let drawn = 0, cut = 0, off = 0;
  for (const bar of bars) {
    const r = bar.getBoundingClientRect();
    const inV = r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;
    const overlapH = Math.min(r.right, b.right) - Math.max(r.left, b.left);
    if (!inV) cut++;
    else if (overlapH <= 0) off++;
    else drawn++;
  }
  const marked = document.querySelectorAll('[data-minimap-edge]').length;
  // The axis: the body's previous sibling holds the tick labels.
  const header = body?.previousElementSibling;
  const labels = header ? [...header.querySelectorAll('span')].filter((s) => (s.textContent || '').trim() && s.getBoundingClientRect().width > 0) : [];
  const rects = labels.map((s) => s.getBoundingClientRect()).sort((p, q) => p.left - q.left);
  let overprint = 0;
  for (let k = 1; k < rects.length; k++) if (rects[k].left < rects[k - 1].right) overprint++;
  const sizes = labels.map((s) => parseFloat(getComputedStyle(s).fontSize));
  const minFont = sizes.length ? Math.min(...sizes) : null;
  return { phases, rows: bars.length, drawn, cut, off, marked, bodyH: b ? Math.round(b.height) : null, axis: { labels: labels.length, minFont, overprint } };
});
const setSpan = async (days) => {
  const slider = page.locator('input[type="range"]').first();
  await slider.evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, days);
  await sleep(300);
};
const minimapShot = async (name) => {
  if (!SHOTS) return;
  const box = await page.evaluate(() => {
    const t = [...document.querySelectorAll('[title]')].find((e) => / · drag to move · drag edges to resize$/.test(e.getAttribute('title') || '') || / · click to view · /.test(e.getAttribute('title') || ''));
    let n = t; for (; n; n = n.parentElement) if (getComputedStyle(n).overflow === 'hidden') break;
    const pane = n?.parentElement?.getBoundingClientRect();
    return pane ? { x: pane.left, y: Math.max(0, pane.top - 60), width: pane.width, height: pane.height + 60 } : null;
  });
  if (box) await page.screenshot({ path: join(SHOTS, `${name}.png`), clip: box });
};

const rows = [];
const record = async (zoom) => {
  const m = await measure();
  rows.push({ zoom, ...m });
  await minimapShot(`minimap-${ADD ? `plus${ADD}-` : ''}${zoom.replace(/[^a-z0-9]+/gi, '-')}`);
};
await record('default span');
await byTitle('Fit minimap to project start/end').click(); await sleep(300);
await record('Fit');
for (const [days, name] of [[183, '6 months'], [365, '1 year'], [730, '2 years'], [1825, '5 years']]) {
  await setSpan(days);
  await record(name);
}
await setSpan(730);
for (const z of ['Day', 'Month', 'Quarter', 'Week']) {
  await byTitle(`Switch the detail gantt to ${z} zoom`).click(); await sleep(300);
  await record(`detail ${z}`);
}

await browser.close();
console.log(`\nminimap at ${W}x${H}${ADD ? `, ${ADD} phases added` : ''}\n`);
console.log('zoom           | phases | rows | drawn | cut | off | marked | body | axis labels / min px / overprint');
for (const r of rows) {
  console.log(`${r.zoom.padEnd(14)} | ${String(r.phases).padStart(6)} | ${String(r.rows).padStart(4)} | ${String(r.drawn).padStart(5)} | ${String(r.cut).padStart(3)} | ${String(r.off).padStart(3)} | ${String(r.marked).padStart(6)} | ${String(r.bodyH).padStart(4)} | ${r.axis.labels} / ${r.axis.minFont} / ${r.axis.overprint}`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ size: `${W}x${H}`, added: ADD, rows }, null, 2));
