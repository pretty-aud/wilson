#!/usr/bin/env node
/**
 * The custom views on the six tables, their toolbars measured and
 * photographed — post-overhaul VW1e (2026-10-25; docs/design/
 * CUSTOM_VIEWS_DESIGN.md §4.1, her Q-P1: the Views button 136px on every
 * table, the name cut short with an ellipsis, the full name in the dropdown
 * and on hover).
 *
 *   node scripts/vw1e-shots.mjs <port> --out <dir> [--size 1440x900] [--no-shots]
 *
 * On the dev fixtures' Salt Hours (the `vw1e-worktree` entry in
 * .claude/launch.json: VITE_DEV_FIXTURES=1, VITE_DEV_AUTOLOGIN=tester; the
 * Levels and Experiences tabs with `?fixtures=game`), each table on a fresh
 * page (the fixture store is in memory: nothing outlives it), in VW1d's
 * states of the bar and one of its own:
 *   rest      the toolbar at rest: Views: All, no bar
 *   filter    a filter on (status is its first value): Filter (1), the bar
 *   grouped   grouped (Tasks, Assets, Levels and Experiences by an item, with
 *             Create grouping in the toolbar; Scenes and Shots by status)
 *   sorted    grouped and sorted by name (Tasks: title), where the toolbar
 *             has a Sort
 *   long      a new view with a long name ("Lighthouse interiors at dawn"),
 *             the dropdown open on it: the button stays 136px, its name cut
 * Each state's toolbar is measured: its height, the rows its left slot
 * takes, the room between its two slots, the Views button's width and
 * whether its name is cut. Pictures of rest, grouped and long,
 * `po-vw1e-<table>-<state>-<W>x<H>.png`;
 * the numbers in `po-vw1e-measure-<W>x<H>.json`. Animations, transitions
 * and the caret off in this page only; real scrollbars. A control that is
 * not found stops the run and says which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const VALUED = ['--out', '--size'];
const PORT = args.find((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1])) || '5298';
const OUT = flag('--out');
const SHOTS = !args.includes('--no-shots');
if (!OUT) { console.error('usage: vw1e-shots.mjs <port> --out <dir> [--size WxH] [--no-shots]'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
mkdirSync(OUT, { recursive: true });

const LONG_NAME = 'Lighthouse interiors at dawn';
// Each table: the tab that shows it (and Shots' content tab), its toolbar,
// what to wait for, and the grouping its bar state uses.
const TABLES = [
  { key: 'tasks', tab: 'Tasks', toolbar: '.rb-task-toolbar', ready: '.ui-table.rb-task-table', group: 'asset', sort: 'title', creates: true },
  { key: 'assets', tab: 'Assets', toolbar: '.rb-asset-toolbar', ready: 'tr.rb-asset-row', group: 'scene', creates: true },
  { key: 'scenes', tab: 'Scenes', toolbar: '.rb-scene-toolbar', ready: 'table.rb-scene-table-scenes', group: 'status', creates: false },
  { key: 'shots', tab: 'Scenes', content: 'Shots', toolbar: '.rb-scene-toolbar', ready: 'table.rb-scene-table-shots', group: 'status', creates: false },
  { key: 'levels', tab: 'Levels', game: true, toolbar: '.rb-ent-toolbar', ready: '.rb-ent-toolbar', group: 'asset', creates: true },
  { key: 'experiences', tab: 'Experiences', game: true, toolbar: '.rb-ent-toolbar', ready: '.rb-ent-toolbar', group: 'asset', creates: true },
];

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const measures = {};
const measure = (page, sel) => page.evaluate((sel) => {
  const tb = document.querySelector(sel);
  if (!tb) throw new Error(`no toolbar ${sel}`);
  const r = (n) => Math.round(n);
  const slots = [...tb.querySelectorAll(':scope > .ui-toolbar-slot')];
  const boxes = slots.map(s => s.getBoundingClientRect());
  // The rows the left slot takes: its shown children's tops, a new row at a
  // step of more than 8px.
  const tops = [...slots[0].children].map(c => c.getBoundingClientRect()).filter(b => b.width > 0).map(b => b.top).sort((a, b) => a - b);
  let rows = tops.length ? 1 : 0;
  for (let i = 1; i < tops.length; i++) if (tops[i] - tops[i - 1] > 8) rows++;
  const btn = tb.querySelector('.rb-tv-button');
  const name = btn && btn.querySelector('.rb-tv-button-name');
  return {
    height: r(tb.getBoundingClientRect().height),
    rows,
    spare: boxes.length > 1 ? r(boxes[1].left - boxes[0].right) : null,
    views: btn ? r(btn.getBoundingClientRect().width) : null,
    cut: name ? name.scrollWidth > name.clientWidth : null,
    title: btn ? btn.getAttribute('title') : null,
    bar: !!document.querySelector('.rb-tv-bar'),
    createGrouping: [...tb.querySelectorAll('button')].some(b => b.textContent.trim() === 'Create grouping'),
  };
}, sel);

async function fresh(t) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.clock.setFixedTime(new Date('2026-10-25T14:00:00'));
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/rabbit${t.game ? '?fixtures=game' : ''}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  await page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('tab', { name: t.tab, exact: true }).first().click();
  if (t.content) await page.getByRole('tab', { name: t.content, exact: true }).first().click();
  await page.waitForSelector(t.ready);
  await page.mouse.move(W - 70, 12);
  await page.waitForTimeout(300);
  return page;
}
// Every state is measured; three are photographed (the bar shows in grouped).
const PICTURED = new Set(['rest', 'grouped', 'long']);
async function shot(page, t, state) {
  if (!PICTURED.has(state)) return;
  await page.waitForTimeout(250);
  const file = `po-vw1e-${t.key}-${state}-${W}x${H}.png`;
  if (SHOTS) { await page.screenshot({ path: join(OUT, file) }); console.log(`  ${file}`); }
}
const views = (page) => page.getByRole('button', { name: /^Views: / });
const dropdown = (page) => page.getByRole('dialog', { name: /^Views/ });

const settle = async (page) => { await page.waitForTimeout(300); await page.mouse.move(W - 70, 12); };

try {
  for (const t of TABLES) {
    const m = {};
    // At rest, then a filter on (status is its first value), as VW1d measured.
    let page = await fresh(t);
    m.rest = await measure(page, t.toolbar);
    await shot(page, t, 'rest');
    await page.getByRole('button', { name: /^Filter/ }).first().click();
    await page.getByRole('button', { name: 'Add filter' }).first().click();
    const row = page.locator('.rb-tv-filter-row').last();
    await row.getByRole('combobox', { name: 'Field' }).selectOption('status');
    await row.getByRole('button', { name: /^Value:/ }).click();
    await page.getByRole('dialog', { name: 'Status: values' }).getByRole('checkbox').first().click();
    await page.keyboard.press('Escape');
    await settle(page);
    m.filter = await measure(page, t.toolbar);
    await shot(page, t, 'filter');
    await page.close();

    // Grouped (a change for now: the bar; Create grouping where the table
    // offers it), then grouped and sorted where the toolbar has a Sort.
    page = await fresh(t);
    await page.getByRole('combobox', { name: 'Group' }).selectOption(t.group);
    await settle(page);
    m.grouped = await measure(page, t.toolbar);
    await shot(page, t, 'grouped');
    const sort = page.getByRole('combobox', { name: 'Sort' });
    if (await sort.count()) {
      await sort.first().selectOption(t.sort || 'name');
      await settle(page);
      m.sorted = await measure(page, t.toolbar);
      await shot(page, t, 'sorted');
    } else m.sorted = null;
    await page.close();

    // A view with a long name, the dropdown open on it.
    page = await fresh(t);
    await views(page).click();
    await dropdown(page).getByRole('button', { name: 'New view' }).click();
    await dropdown(page).getByRole('textbox', { name: 'View name' }).fill(LONG_NAME);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    m.long = await measure(page, t.toolbar);
    await shot(page, t, 'long');
    await page.close();

    measures[t.key] = m;
    console.log(`${t.key}: ${JSON.stringify(m)}`);
  }
  writeFileSync(join(OUT, `po-vw1e-measure-${W}x${H}.json`), JSON.stringify(measures, null, 2));
} finally {
  await browser.close();
}
