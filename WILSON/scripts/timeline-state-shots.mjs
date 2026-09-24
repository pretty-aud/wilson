#!/usr/bin/env node
/**
 * The R.A.B.B.I.T. Timeline's states, photographed — UI overhaul B3 (2026-09-24).
 *
 *   node scripts/timeline-state-shots.mjs <port> --out <dir> [--size 1440x900]
 *   node scripts/dog-state-shots.mjs --compare <dirA> <dirB>      (the comparison)
 *
 * The state extraction (plan §5) promises NO VISUAL CHANGE, and almost every
 * state it moves is one a URL does not show: a hovered label row, a hovered
 * bar, the drop zone under the pointer, a zoom or group-by or sort selected,
 * the minimap panned until its frame leaves the view, the settings panel
 * unlocked, a help page, the edit-history drawer. ui-walk.mjs photographs the
 * Timeline at rest; this drives it through each of those states so a run
 * before a change and a run after can be compared pixel by pixel with A1's
 * `dog-state-shots.mjs --compare`, which is generic (it decodes both PNGs in
 * a headless page and excludes the pet's corner, C5's and moving).
 *
 * Deterministic by construction: the clock is fixed (the Timeline's TODAY is
 * read once, at module load), animations and transitions are off and the
 * caret is transparent — injected into this page only, never the app.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1. Changes nothing that outlives the page: the fixture
 * store is in memory, the settings panel's toggles write this browser
 * context's localStorage (a fresh context per run), and nothing is saved,
 * created, deleted or sent. A shot whose control is not found is SKIPPED and
 * named, so a before run and an after run skip the same shots or the
 * comparison reports the missing file.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size'].includes(args[i - 1])) || '5257';
const OUT = flag('--out');
if (!OUT) { console.error('usage: timeline-state-shots.mjs <port> --out <dir> [--size WxH]'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.clock.setFixedTime(new Date('2026-09-24T09:00:00'));
page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });

const sleep = (ms) => page.waitForTimeout(ms);
const skipped = [];
/* The dependency arrows pulse with SMIL (<animateMotion>, <animate>), which
   the CSS kill-switch above cannot reach. Pausing and rewinding each SVG was
   not enough: the extraction's own runs caught one unchanged page cycling
   through three frames along the cyan arrow (React re-creates the animation
   elements on a re-render, and a fresh one starts from its own clock). So
   the animation elements are REMOVED before every photograph — the pulse
   dots then sit at their static attributes — in this page only. */
const freezeSvg = () => page.evaluate(() => {
  document.querySelectorAll('animate, animateMotion, animateTransform, set').forEach((a) => a.remove());
  document.querySelectorAll('svg').forEach((s) => { s.pauseAnimations?.(); s.setCurrentTime?.(0); });
});
const shot = async (name) => { await sleep(250); await freezeSvg(); await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log(`  ${name}`); };
const park = () => page.mouse.move(W - 70, 12);   // over the orange bar, away from every control
/** R.A.B.B.I.T.'s view tabs are role=tab (B1). */
const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
const byTitle = (t) => page.locator(`[title="${t}"]`).first();
const visible = async (loc) => (await loc.count()) > 0 && (await loc.first().isVisible());
/** Hover or click a control and photograph; skip (and say so) when it is not there. */
async function step(name, loc, action = 'hover') {
  if (!(await visible(loc))) { skipped.push(name); console.log(`  (skipped ${name}: control not found)`); return false; }
  if (action === 'click') { await loc.first().click(); await park(); } else await loc.first().hover();
  await shot(name);
  return true;
}

// Open Salt Hours, then the Timeline (the walk's `@proj`, by the same evidence).
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
await tab('Timeline').click();
await byTitle('Center the detail timeline on today').waitFor({ timeout: 20000 });
await sleep(800);

// ── The Gantt at rest, and each hover the extraction moves ─────────────────
await park();
await shot('01-default');
// The gantt's label row, not the first "Development" on the page: since B3b
// the minimap names its phases too, and that name takes no pointer events
// (a hover there would wait forever). `.rb-tl-row` is the label row before
// and after B3b, so a before run and an after run hover the same element.
await step('02-hover-phase-label', page.locator('.rb-tl-row').getByText('Development', { exact: true }).first());
await step('03-hover-task-label', page.getByText('Lock the shooting script', { exact: true }).first());
await step('04-hover-drop-zone', page.getByText(/^New task/).first());
// The first DETAIL bar (its title carries the length, "· 12.0d ·") with a
// visible stretch inside the chart, hovered at the middle of that stretch —
// never `.hover()`, which would scroll the chart to centre the whole bar.
const bars = await page.locator('[title*="d · drag to move"], [title*="d · click to view"]').all();
let hoveredBar = false;
for (const b of bars) {
  const box = await b.boundingBox();
  if (!box) continue;
  const x0 = Math.max(box.x, 260), x1 = Math.min(box.x + box.width, W - 160);
  const y0 = Math.max(box.y, 480), y1 = Math.min(box.y + box.height, H - 20);
  if (x1 - x0 >= 12 && y1 - y0 >= 6) {
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2); await shot('05-hover-detail-bar'); hoveredBar = true; break;
  }
}
if (!hoveredBar) { skipped.push('05-hover-detail-bar'); console.log('  (skipped 05-hover-detail-bar: no bar in view)'); }
await step('06-hover-minimap-phase', page.locator('[title^="Development · "]').first());
await step('07-hover-zoom-chip', byTitle('Switch the detail gantt to Month zoom'));
await step('08-hover-undo-disabled', byTitle('Undo (Ctrl+Z)'));

// ── Zoom, group-by, sort: each selected state ───────────────────────────────
await step('09-zoom-day', byTitle('Switch the detail gantt to Day zoom'), 'click');
await step('10-zoom-month', byTitle('Switch the detail gantt to Month zoom'), 'click');
await step('11-zoom-quarter', byTitle('Switch the detail gantt to Quarter zoom'), 'click');
await step('12-zoom-week', byTitle('Switch the detail gantt to Week zoom'), 'click');
await step('13-group-team', byTitle('Group by team member'), 'click');
await step('14-group-asset', byTitle('Group by asset'), 'click');
await step('15-group-scene', byTitle('Group by scene'), 'click');
await step('16-group-phase', byTitle('Group by phase'), 'click');
await step('17-sort-desc', byTitle('Sort phases and tasks by start date, latest first'), 'click');
await step('18-sort-asc', byTitle('Sort phases and tasks by start date, earliest first'), 'click');
await step('19-collapse-phase', byTitle('Collapse'), 'click');
if (await visible(byTitle('Expand'))) { await byTitle('Expand').click(); await park(); }

// ── The minimap's own controls, and its frame off-screen ───────────────────
await step('20-minimap-fit', byTitle('Fit minimap to project start/end'), 'click');
await step('21-minimap-today', byTitle('Center minimap on today'), 'click');
const mini = page.locator('[title^="Development · "]').first();
if (await visible(mini)) {
  const box = await mini.boundingBox();
  await page.mouse.move(W - 200, box.y + box.height / 2);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(4000, 0); await sleep(60); }
  await park();
  await shot('22-minimap-frame-off-right');
  await step('23-hover-offscreen-arrow', page.locator('[title^="Detail view is off-screen"]').first());
} else skipped.push('22-minimap-frame-off-right', '23-hover-offscreen-arrow');

// ── The settings panel (SettingsPanel) ─────────────────────────────────────
if (await step('24-settings', page.locator('[aria-label="RABBIT settings"]'), 'click')) {
  const panel = page.locator('.fixed.inset-0').last();
  await step('25-settings-hover-tab', panel.getByRole('button', { name: 'System Prompts', exact: true }));
  const switches = panel.locator('button.w-11.h-6');
  await step('26-settings-toggle-1', switches.nth(0), 'click');
  await step('27-settings-toggle-2', switches.nth(1), 'click');
  await step('28-settings-prompts-tab', panel.getByRole('button', { name: 'System Prompts', exact: true }), 'click');
  const section = panel.locator('button').filter({ hasText: /prompt|scheduler|recommend|generator/i }).first();
  await step('29-settings-section-open', section, 'click');
  await page.keyboard.press('Escape');
  await sleep(300);
  if (await visible(panel.getByRole('button', { name: 'System Prompts', exact: true }))) {
    await page.mouse.click(10, H / 2);
    await sleep(300);
  }
}

// ── Help (HelpModal) ────────────────────────────────────────────────────────
if (await step('30-help', page.locator('[aria-label="Help & documentation"]'), 'click')) {
  // The page list: the kit Dialog's `.rb-tl-help-item` since B3c; the old
  // modal's `.fixed nav button` for a before run on the old code.
  const items = page.locator('.rb-tl-help-item, .fixed nav button, .fixed aside button');
  if ((await items.count()) > 2) {
    await items.nth(1).hover(); await shot('31-help-hover-item');
    await items.nth(2).click(); await park(); await shot('32-help-third-page');
  } else skipped.push('31-help-hover-item', '32-help-third-page');
  // Escape first (the kit Dialog's key); the old modal only closes from its
  // backdrop, so click the backdrop's corner if it is still up.
  await page.keyboard.press('Escape');
  await sleep(300);
  if (await visible(page.locator('.fixed.inset-0.z-\\[100\\]'))) { await page.mouse.click(8, H - 8); await sleep(300); }
}

// ── The edit-history drawer (EditHistoryDrawer), from Tasks ────────────────
await tab('Tasks').click();
await sleep(800);
if (await step('33-history', page.locator('[title="View edit history"], [aria-label="View edit history"]'), 'click')) {
  await sleep(600);
  await shot('34-history-loaded');
  const revert = page.locator('button').filter({ hasText: /revert/i }).first();
  await step('35-history-hover-revert', revert);
}

await browser.close();
console.log(`✓ ${W}x${H} → ${OUT}${skipped.length ? `  (skipped: ${skipped.join(', ')})` : ''}`);
