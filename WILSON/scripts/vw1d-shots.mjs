#!/usr/bin/env node
/**
 * The custom views on the Tasks table, photographed and measured —
 * post-overhaul VW1d (2026-10-25; docs/design/CUSTOM_VIEWS_DESIGN.md §4.1 to
 * §4.5, §4.11).
 *
 *   node scripts/vw1d-shots.mjs <port> --out <dir> [--size 1440x900] [--no-shots]
 *
 * On the dev fixtures' Salt Hours (the `vw1d-worktree` entry in
 * .claude/launch.json: VITE_DEV_FIXTURES=1, VITE_DEV_AUTOLOGIN=tester), each
 * state on a fresh page (the fixture store is in memory: nothing outlives it),
 * each `po-vw1d-<nn>-<state>-<W>x<H>.png`, the numbers in
 * `po-vw1d-measure-<W>x<H>.json`:
 *   01 rest          the Tasks toolbar at rest: Views: All, the one New menu;
 *                    the toolbar's two slots and its height measured
 *   02 new-menu      the New menu open (Task, Phase, Key date)
 *   03 dropdown      the Views dropdown after a New view "Shoot week"
 *   04 filters       its Filters card: Status is In progress, Pending review,
 *                    the value picker open
 *   05 bar           the change for now's bar under the toolbar
 *   06 grouped       grouped by Asset with Create grouping in the toolbar
 *                    (measured: does the toolbar keep one line?)
 *   07 create        Create grouping's window, two assets ticked
 *   08 grouping      the new grouping, empty, in the table
 *   09 fields        the Fields card
 *   10 board-fields  the Board's Fields card (the card's own six)
 * Animations, transitions and the caret off in this page only; real
 * scrollbars. A control that is not found stops the run and says which.
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
if (!OUT) { console.error('usage: vw1d-shots.mjs <port> --out <dir> [--size WxH] [--no-shots]'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const measures = {};
const toolbar = (page) => page.evaluate(() => {
  const tb = document.querySelector('.rb-task-toolbar');
  const r = (n) => Math.round(n);
  const [left, right] = [...tb.querySelectorAll(':scope > .ui-toolbar-slot')].map(s => s.getBoundingClientRect());
  return { height: r(tb.getBoundingClientRect().height), left: { x: r(left.left), right: r(left.right) }, right: { x: r(right.left), right: r(right.right) }, spare: r(right.left - left.right), views: r(document.querySelector('.rb-tv-button').getBoundingClientRect().width) };
});

async function fresh() {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.clock.setFixedTime(new Date('2026-10-25T14:00:00'));
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  await page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('tab', { name: 'Tasks', exact: true }).first().click();
  await page.waitForSelector('.ui-table.rb-task-table');
  await page.mouse.move(W - 70, 12);
  await page.waitForTimeout(300);
  return page;
}
async function shot(page, n, name) {
  await page.waitForTimeout(250);
  const file = `po-vw1d-${String(n).padStart(2, '0')}-${name}-${W}x${H}.png`;
  if (SHOTS) { await page.screenshot({ path: join(OUT, file) }); console.log(`  ${file}`); }
}
const views = (page) => page.getByRole('button', { name: /^Views: / });
const dropdown = (page) => page.getByRole('dialog', { name: /^Views/ });
async function newView(page, name) {
  await views(page).click();
  await dropdown(page).getByRole('button', { name: 'New view' }).click();
  await dropdown(page).getByRole('textbox', { name: 'View name' }).fill(name);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}
async function statusFilter(page, labels, inCard) {
  const scope = inCard ? dropdown(page) : page;
  await scope.getByRole('button', { name: 'Add filter' }).click();
  const row = scope.locator('.rb-tv-filter-row').last();
  await row.getByRole('combobox', { name: 'Field' }).selectOption('status');
  await row.getByRole('button', { name: /^Value:/ }).click();
  const picker = page.getByRole('dialog', { name: 'Status: values' });
  for (const l of labels) await picker.getByRole('checkbox', { name: new RegExp(`^${l}`) }).click();
}

try {
  let page = await fresh();
  measures.rest = await toolbar(page);
  await shot(page, 1, 'rest');
  await page.getByRole('button', { name: /^New/ }).click();
  await shot(page, 2, 'new-menu');
  await page.keyboard.press('Escape');

  await newView(page, 'Shoot week');
  await shot(page, 3, 'dropdown');
  await dropdown(page).getByRole('button', { name: /^Filters:/ }).click();
  await statusFilter(page, ['In progress', 'Pending review'], true);
  await shot(page, 4, 'filters');
  await page.keyboard.press('Escape'); // the picker
  await page.keyboard.press('Escape'); // the card
  await page.keyboard.press('Escape'); // the dropdown
  measures.bar = await toolbar(page);
  await shot(page, 5, 'bar');
  await page.close();

  page = await fresh();
  await page.getByRole('combobox', { name: 'Group' }).selectOption('asset');
  measures.grouped = await toolbar(page);
  await shot(page, 6, 'grouped');
  await page.getByRole('button', { name: 'Create grouping' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create grouping' });
  await dialog.getByRole('checkbox', { name: /^Lighthouse Interior/ }).click();
  await dialog.getByRole('checkbox', { name: /^Cliff Path/ }).click();
  await shot(page, 7, 'create');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(300);
  const head = page.locator('tr.rb-task-group-row', { hasText: 'Cliff Path, Lighthouse Interior' });
  await head.scrollIntoViewIfNeeded();
  await page.evaluate(() => { const s = document.querySelector('.ui-table-scroll'); if (s) s.scrollLeft = 0; });
  await head.hover();
  await shot(page, 8, 'grouping');
  await page.close();

  page = await fresh();
  await views(page).click();
  await dropdown(page).getByRole('button', { name: /^Fields:/ }).click();
  await shot(page, 9, 'fields');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Board', exact: true }).first().click();
  await views(page).click();
  await dropdown(page).getByRole('button', { name: /^Fields:/ }).click();
  await shot(page, 10, 'board-fields');
  await page.close();

  writeFileSync(join(OUT, `po-vw1d-measure-${W}x${H}.json`), JSON.stringify(measures, null, 2));
  console.log(JSON.stringify(measures));
} finally {
  await browser.close();
}
