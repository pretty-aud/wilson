#!/usr/bin/env node
/**
 * An edit changed in place, photographed — post-overhaul FX4 (2026-10-12).
 *
 *   node scripts/fx4-shots.mjs <port> --out <dir> --phase before|after [--size 1440x900]
 *
 * Walkthrough 67's states, in the same order before and after the change, on
 * the dev fixtures' Salt Hours (Scenes tab):
 *   01 list-order   the bar in List order (Save, the list's Save as…, Set active)
 *   02 saved-edit   a saved edit on screen ("Shot list 1 · v1"), nothing changed
 *   03 first-change Move down on The door: BEFORE, "Make a new version of this
 *                   edit?"; AFTER, no question — the edit itself, unsaved
 *   04 unsaved      ● Unsaved and the bar's verbs (BEFORE: after Start new
 *                   version; AFTER: the same draft, hovered on Save edit)
 *   05 save-edit    BEFORE, Save edit's dialog (the next version); AFTER, the
 *                   edit saved in place: the same title and version
 *   06 save-as      a second change, then the edit's Save as… (AFTER only:
 *                   BEFORE has no such button on an edit — Save edit's dialog
 *                   was the only way, so 06 BEFORE is the version it made)
 *   07 save-as-done AFTER: the new version on screen; BEFORE: the bar after it
 *   08 leave        a change, then the Timeline tab: the leave question
 * Each file is `po-fx4-<phase>-NN-<state>-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server (launch entry `fx4-worktree`, port
 * 5293: the dev fixtures, no .env.local). Changes nothing that outlives the
 * page: the fixture store is in memory and the browser context is fresh per
 * run. Animations and transitions are off and the caret is transparent, in
 * this page only. A state whose control is not found stops the run and says
 * which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--phase'].includes(args[i - 1])) || '5293';
const OUT = flag('--out');
const PHASE = flag('--phase');
if (!OUT || !['before', 'after'].includes(PHASE)) {
  console.error('usage: fx4-shots.mjs <port> --out <dir> --phase before|after [--size WxH]');
  process.exit(1);
}
const AFTER = PHASE === 'after';
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.clock.setFixedTime(new Date('2026-10-12T09:00:00'));
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  const quiet = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: quiet });

  const sleep = (ms) => page.waitForTimeout(ms);
  const shot = async (nn, state) => {
    await sleep(250);
    const file = `po-fx4-${PHASE}-${nn}-${state}-${W}x${H}.png`;
    await page.screenshot({ path: join(OUT, file) });
    console.log(`  ${file}`);
  };
  const park = () => page.mouse.move(W - 70, 12);
  const button = (name, root = page) => root.getByRole('button', { name, exact: true }).first();
  const dialog = (name) => page.getByRole('dialog', { name, exact: true });
  const bar = () => page.locator('.ui-toolbar.rb-scene-lists');
  const menuItem = (words) => page.locator('.ui-menu .ui-menu-item', { has: page.locator('.ui-menu-item-label', { hasText: new RegExp(`^${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first();
  const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
  const sceneRow = (name) => page.locator('tr.rb-scene-row', { has: page.getByRole('button', { name: `Select ${name}`, exact: true }) }).first();
  const cutRow = (name, i = 0) => page.locator('tr.rb-scene-cut-row', { has: page.locator('.rb-scene-cut-name', { hasText: new RegExp(`^${name}$`) }) }).nth(i);
  const must = async (loc, what) => {
    try { await loc.waitFor({ state: 'visible', timeout: 5000 }); } catch { throw new Error(`not found: ${what}`); }
    return loc;
  };
  const click = async (loc, what) => { await (await must(loc, what)).click(); };
  const cutMenu = async (name, i = 0) => {
    const row = cutRow(name, i);
    await must(row, `the cut's ${name}`);
    await click(row.getByRole('button', { name: new RegExp(`^Edit actions for ${name} \\(cut \\d+\\)$`) }), `the edit actions of ${name}`);
  };
  const dragTo = async (grip, target) => {
    const g = await (await must(grip, 'a grip')).boundingBox();
    const t = await (await must(target, 'a drop target')).boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + 360, t.y + 6, { steps: 8 });
    await page.mouse.move(t.x + 372, t.y + 8, { steps: 2 });
    await sleep(150);
    await page.mouse.up();
  };

  // ── 01: Salt Hours, Scenes, the bar in List order ──
  await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
  await click(tab('Scenes'), 'the Scenes tab');
  await must(bar(), 'the shot list bar');
  await park();
  await shot('01', 'list-order');

  // ── 02: a saved edit — made from the list (its first question is kept), then saved ──
  await dragTo(sceneRow('The storm').locator('.rb-scene-num-cell .rb-scene-grip'), sceneRow('Cliff path'));
  await click(button('Start new edit', dialog('Make a new edit from this list?')), 'Start new edit');
  await click(button('Save edit', bar()), 'Save edit');
  if (!AFTER) {
    const save = dialog('Save edit');
    await must(save, 'the Save edit dialog');
    await click(save.locator('.ui-dialog-foot .ui-btn[data-variant="primary"]'), 'Save edit (dialog)');
  }
  await must(bar().getByText(/^Saved /), 'the saved edit');
  await park();
  await shot('02', 'saved-edit');

  // ── 03: the first change to the saved edit ──
  await cutMenu('The door');
  await click(menuItem('Move down'), 'Move down');
  if (!AFTER) {
    await must(dialog('Make a new version of this edit?'), 'the first-change question');
    await shot('03', 'first-change');
    await click(button('Start new version', dialog('Make a new version of this edit?')), 'Start new version');
  } else {
    await sleep(200);
    if (await page.getByRole('dialog').count()) throw new Error('a question opened on the first change to a saved edit');
    await park();
    await shot('03', 'first-change');
  }

  // ── 04: ● Unsaved and the verbs, Save edit hovered ──
  await (await must(button('Save edit', bar()), 'Save edit')).hover();
  await sleep(700);
  await shot('04', 'unsaved');

  // ── 05: Save edit ──
  await click(button('Save edit', bar()), 'Save edit');
  if (!AFTER) {
    await must(dialog('Save edit'), 'the Save edit dialog');
    await shot('05', 'save-edit');
    await click(dialog('Save edit').locator('.ui-dialog-foot .ui-btn[data-variant="primary"]'), 'Save edit (dialog)');
  } else {
    await must(bar().getByText(/^Saved /), 'the edit saved in place');
    await park();
    await shot('05', 'save-edit');
  }

  // ── 06 / 07: Save as… (AFTER) — or, BEFORE, the only way to a version ──
  await cutMenu('Up the stair');
  await click(menuItem('Duplicate in edit'), 'Duplicate in edit');
  if (!AFTER) {
    await click(button('Start new version', dialog('Make a new version of this edit?')), 'Start new version');
    await park();
    await shot('06', 'save-as');
    await click(button('Save edit', bar()), 'Save edit');
    await click(dialog('Save edit').locator('.ui-dialog-foot .ui-btn[data-variant="primary"]'), 'Save edit (dialog)');
  } else {
    await click(button('Save as…', bar()), 'Save as…');
    const as = dialog('Save edit as a new version');
    await must(as, 'the Save as… dialog');
    await as.getByRole('textbox', { name: 'Summary' }).fill('The stair plays twice.');
    await shot('06', 'save-as');
    await click(as.locator('.ui-dialog-foot .ui-btn[data-variant="primary"]'), 'Save new version');
  }
  await must(bar().getByText(/^Saved /), 'the new version');
  await park();
  await shot('07', 'save-as-done');

  // ── 08: a change, then the tab strip: the leave question ──
  await cutMenu('The door');
  await click(menuItem('Move up'), 'Move up');
  if (!AFTER) await click(button('Start new version', dialog('Make a new version of this edit?')), 'Start new version');
  await click(tab('Timeline'), 'the Timeline tab');
  await must(dialog('Save the edit before leaving?'), 'the leave question');
  await shot('08', 'leave');
  await click(button('Keep editing', dialog('Save the edit before leaving?')), 'Keep editing');
} finally {
  await browser.close();
}
