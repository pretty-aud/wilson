#!/usr/bin/env node
/**
 * The R.A.B.B.I.T. gantt's rows, measured — UI overhaul B3c (2026-09-24).
 *
 *   node scripts/timeline-rows-probe.mjs <port> [--size 1440x900] [--shots <dir>] [--group phase|team|asset|scene]
 *
 * TL-03 says a gantt row is ONE row across the label gutter and the chart;
 * TL-02 says a task's name is readable. This reads both in the running app,
 * at each of the detail pane's four zooms:
 *
 *   rows      label rows and chart rows drawn (the same list, by index)
 *   height    rows whose two halves differ in height or top (px, must be 0)
 *   centre    rows with a bar whose bar label's vertical centre is off the
 *             gutter label's by more than 1px (the "same baseline")
 *   hover     pointer on a label row lights its chart twin, and pointer on a
 *             chart row lights its label twin — the same painted background
 *             on both halves (must be yes / yes)
 *   rule      the row's bottom edge on each half (must match)
 *   edge      the gutter's right edge colour and its contrast on paper
 *   ink       a task name's and a phase name's colour, weight, family and
 *             contrast on the row's painted ground (4.5:1 is the floor)
 *
 * The detail pane is scrolled so the first bar sits in view (the fixture's
 * dates are before the fixed clock's today, where the pane opens). Nothing is
 * saved: hovers only. Needs the worktree's own dev server with
 * VITE_DEV_AUTOLOGIN=tester and VITE_DEV_FIXTURES=1.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--size', '--shots', '--group'].includes(args[i - 1])) || '5259';
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const SHOTS = flag('--shots');
const GROUP = flag('--group') || 'phase';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.clock.setFixedTime(new Date('2026-09-24T09:00:00'));
page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
const sleep = (ms) => page.waitForTimeout(ms);

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
await page.locator('[title="Center the detail timeline on today"]').first().waitFor({ timeout: 20000 });
await sleep(800);

const GROUP_TITLE = { team: 'Group by team member', asset: 'Group by asset', scene: 'Group by scene', phase: 'Group by phase' };
if (GROUP !== 'phase') {
  const b = page.locator(`[title="${GROUP_TITLE[GROUP]}"]`).first();
  if (await b.count()) { await b.click(); await sleep(500); } else console.log(`  (no ${GROUP} grouping control)`);
}

/* Contrast, WCAG 2 — composited over the paper when the ground is translucent. */
const measure = () => page.evaluate(() => {
  const parse = (c) => {
    // color-mix() computes to `color(srgb r g b / a)` with 0–1 channels.
    const s = c.match(/color\(srgb ([^)]+)\)/);
    if (s) { const p = s[1].split(/[ /]+/).filter(Boolean).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 }; }
    const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const PAPER = { r: 28, g: 25, b: 23, a: 1 };
  const ground = (el) => { const bg = parse(getComputedStyle(el).backgroundColor); return bg && bg.a > 0 ? over(bg, PAPER) : PAPER; };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const labels = [...document.querySelectorAll('.rb-tl-gutter > .rb-tl-row, .rb-tl-gutter > .rb-tl-dz')];
  const charts = [...document.querySelectorAll('[data-chart-body] > .rb-tl-chart-row, [data-chart-body] > .rb-tl-chart-dz')];
  const off = [];
  const centres = [];
  labels.forEach((l, i) => {
    const c = charts[i];
    if (!c) { off.push(`row ${i}: no chart twin`); return; }
    const a = l.getBoundingClientRect(); const b = c.getBoundingClientRect();
    if (Math.abs(a.top - b.top) > 0.5 || Math.abs(a.height - b.height) > 0.5) off.push(`row ${i}: label ${a.top.toFixed(1)}+${a.height} chart ${b.top.toFixed(1)}+${b.height}`);
    const name = l.querySelector('.rb-tl-row-label');
    const barLabel = c.querySelector('.rb-tl-bar-label');
    if (name && barLabel) {
      const r1 = document.createRange(); r1.selectNodeContents(name); const t1 = r1.getBoundingClientRect();
      const r2 = document.createRange(); r2.selectNodeContents(barLabel); const t2 = r2.getBoundingClientRect();
      centres.push(Math.abs((t1.top + t1.height / 2) - (t2.top + t2.height / 2)));
    }
  });
  const rule = (el) => el ? `${getComputedStyle(el).borderBottomWidth} ${getComputedStyle(el).borderBottomStyle} ${getComputedStyle(el).borderBottomColor}` : '-';
  const task = labels.find((l) => l.dataset.shape === 'task');
  const phase = labels.find((l) => l.dataset.shape === 'phase' || l.dataset.shape === 'subgroup');
  const ink = (row) => {
    if (!row) return '-';
    const n = row.querySelector('.rb-tl-row-label'); const cs = getComputedStyle(n);
    const fg = parse(cs.color); const g = ground(row);
    return `${hex(fg)} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily.split(',')[0]} on ${hex(g)} ${ratio(fg, g).toFixed(2)}:1`;
  };
  const gutter = document.querySelector('.rb-tl-gutter');
  const edge = parse(getComputedStyle(gutter).borderRightColor);
  return {
    rows: labels.length, charts: charts.length, off, centres,
    ruleLabel: rule(task), ruleChart: rule(charts[labels.indexOf(task)]),
    edge: `${getComputedStyle(gutter).borderRightWidth} ${hex(over(edge, PAPER))} ${ratio(over(edge, PAPER), PAPER).toFixed(2)}:1`,
    taskInk: ink(task), phaseInk: ink(phase),
    phaseBandLabel: phase ? hex(ground(phase)) : '-', phaseBandChart: phase ? getComputedStyle(charts[labels.indexOf(phase)]).backgroundColor : '-',
  };
});

/* Hover one half, read both halves' painted grounds. */
async function hoverPair(shape, which) {
  const idx = await page.evaluate((s) => [...document.querySelectorAll('.rb-tl-gutter > .rb-tl-row, .rb-tl-gutter > .rb-tl-dz')].findIndex((l) => l.dataset.shape === s), shape);
  if (idx < 0) return '-';
  const label = page.locator('.rb-tl-gutter > .rb-tl-row, .rb-tl-gutter > .rb-tl-dz').nth(idx);
  const chart = page.locator('[data-chart-body] > .rb-tl-chart-row, [data-chart-body] > .rb-tl-chart-dz').nth(idx);
  const target = which === 'label' ? label : chart;
  const box = await target.boundingBox();
  const y = box.y + box.height / 2;
  // A chart row: a point where the row ITSELF is what the pointer hits —
  // not a bar, a link, the pet's corner or the pane's scrollbar.
  const x = which === 'label'
    ? box.x + box.width - 20
    : await target.evaluate((el, yy) => {
        for (let px = window.innerWidth - 120; px > 260; px -= 16) if (document.elementFromPoint(px, yy) === el) return px;
        return null;
      }, y);
  if (x == null) return 'NO (no bare point on the chart row)';
  await page.mouse.move(x, y);
  await sleep(120);
  const read = (el) => el.evaluate((e) => `${e.dataset.hover}:${getComputedStyle(e).backgroundColor}`);
  const [a, b] = [await read(label), await read(chart)];
  await page.mouse.move(W - 70, 12);
  await sleep(80);
  const [ra, rb] = [await read(label), await read(chart)];
  const lit = a.startsWith('true') && b.startsWith('true') && a.split(':')[1] === b.split(':')[1];
  const rest = ra.startsWith('false') && rb.startsWith('false');
  return `${lit && rest ? 'yes' : 'NO'} (${a} | ${b})`;
}

console.log(`\ngantt rows at ${W}x${H}, grouped by ${GROUP}\n`);
const ZOOMS = ['Day', 'Week', 'Month', 'Quarter'];
let failed = false;
for (const z of ZOOMS) {
  const t = page.getByRole('tab', { name: z, exact: true }).first();
  if (await t.count()) { await t.click(); await sleep(400); }
  // Bring the first bar into view.
  await page.evaluate(() => {
    const pane = document.getElementById('rb-tl-detail');
    const bar = document.querySelector('[data-chart-body] .rb-tl-bar');
    if (pane && bar) pane.scrollLeft = Math.max(0, bar.getBoundingClientRect().left - pane.getBoundingClientRect().left + pane.scrollLeft - 320);
  });
  await sleep(300);
  const m = await measure();
  const worst = m.centres.length ? Math.max(...m.centres) : null;
  const hLabel = await hoverPair('task', 'label');
  const hChart = await hoverPair('task', 'chart');
  const pLabel = await hoverPair(GROUP === 'phase' ? 'phase' : 'subgroup', 'label');
  const badCentre = m.centres.filter((c) => c > 1).length;
  console.log(`${z.padEnd(8)} rows ${m.rows}/${m.charts}  height off ${m.off.length}  centre: ${m.centres.length} with a bar, worst ${worst == null ? '-' : worst.toFixed(2)}px, ${badCentre} over 1px`);
  console.log(`         hover task from label ${hLabel}`);
  console.log(`         hover task from chart ${hChart}`);
  console.log(`         hover group from label ${pLabel}`);
  console.log(`         rule label "${m.ruleLabel}"  chart "${m.ruleChart}"`);
  console.log(`         edge ${m.edge}   band label ${m.phaseBandLabel} chart ${m.phaseBandChart}`);
  console.log(`         task ${m.taskInk}`);
  console.log(`         group ${m.phaseInk}`);
  if (m.off.length) { console.log(`         ${m.off.slice(0, 5).join('\n         ')}`); failed = true; }
  if (badCentre || !hLabel.startsWith('yes') || !hChart.startsWith('yes') || !pLabel.startsWith('yes') || m.ruleLabel !== m.ruleChart) failed = true;
  if (SHOTS) {
    await page.evaluate(() => document.querySelectorAll('animate, animateMotion, animateTransform, set').forEach((a) => a.remove()));
    await page.screenshot({ path: join(SHOTS, `rows-${GROUP}-${z.toLowerCase()}-${W}x${H}.png`) });
  }
}
await browser.close();
console.log(failed ? '\n✗ a row contract failed' : '\n✓ every zoom: one row, one hover, one rule');
process.exit(failed ? 1 : 0);
