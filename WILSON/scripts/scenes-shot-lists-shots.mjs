#!/usr/bin/env node
/**
 * The Scenes tab's shot lists, photographed — post-overhaul S3b (2026-10-01).
 *
 *   node scripts/scenes-shot-lists-shots.mjs <port> --out <dir> [--size 1440x900] [--prefix po-s3b-]
 *
 * Walks walkthrough 51's states in order on the dev fixtures' Salt Hours:
 * the tab with its one list, a second list made empty, Add from another
 * list…, a row's shot-list menu and the Remove question, the Delete
 * question, Save, Save as…, Set active, Withdraw and Restore, the picker
 * and its Archived view, "Not in any list" and its Add to list menu, and
 * the scene popup's draft question (D21). Each file is
 * `<prefix><nn>-<state>-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1. Changes nothing that outlives the page: the fixture
 * store is in memory, and the browser context is fresh per run. Animations
 * and transitions are off and the caret is transparent, in this page only.
 * A state whose control is not found stops the run and says which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--prefix'].includes(args[i - 1])) || '5276';
const OUT = flag('--out');
if (!OUT) { console.error('usage: scenes-shot-lists-shots.mjs <port> --out <dir> [--size WxH] [--prefix p]'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PREFIX = flag('--prefix') || 'po-s3b-';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.clock.setFixedTime(new Date('2026-10-01T09:00:00'));
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });

  const sleep = (ms) => page.waitForTimeout(ms);
  let n = 0;
  const shot = async (state) => {
    n += 1;
    await sleep(250);
    const file = `${PREFIX}${String(n).padStart(2, '0')}-${state}-${W}x${H}.png`;
    await page.screenshot({ path: join(OUT, file) });
    console.log(`  ${file}`);
  };
  const park = () => page.mouse.move(W - 70, 12);
  const button = (name, root = page) => root.getByRole('button', { name, exact: true }).first();
  const dialog = (name) => page.getByRole('dialog', { name, exact: true });
  const bar = () => page.locator('.ui-toolbar.rb-scene-lists');
  const menuItem = (words) => page.locator('.ui-menu .ui-menu-item', { hasText: words }).first();
  const rowOf = (name) => page.locator('tr.rb-scene-row', { has: page.getByRole('button', { name: `Select ${name}`, exact: true }) }).first();
  const must = async (loc, what) => {
    try { await loc.waitFor({ state: 'visible', timeout: 4000 }); } catch { throw new Error(`not found: ${what}`); }
    return loc;
  };
  const click = async (loc, what) => { await (await must(loc, what)).click(); };
  const rowMenu = async (name) => {
    await rowOf(name).hover();
    await click(page.getByRole('button', { name: `Shot list actions for ${name}`, exact: true }).first(), `the menu of ${name}`);
  };

  // Salt Hours, then the Scenes tab.
  await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
  await click(page.getByRole('tab', { name: 'Scenes', exact: true }).first(), 'the Scenes tab');
  await must(bar(), 'the shot list bar');
  await park();
  await shot('one-list');

  // A second list, made empty.
  await click(button('New shot list', bar()), 'New shot list');
  const form = dialog('New shot list');
  await must(form, 'the New shot list form');
  await form.getByRole('textbox').first().fill('Second unit');
  await form.getByRole('radio', { name: /^Empty/ }).check();
  await shot('new-list-form');
  await click(button('Create shot list', form), 'Create shot list');
  await park();
  await shot('second-list-empty');

  // Add from another list…: a whole scene, and one shot of another.
  await click(button('More shot list actions', bar()), 'the bar\'s More');
  await shot('bar-more-menu');
  await click(menuItem('Add from another list…'), 'Add from another list…');
  const add = dialog('Add from another list');
  await must(add, 'Add from another list');
  await add.locator('.rb-scene-addfrom-scene').first().locator('input').check();
  await add.locator('.rb-scene-addfrom-group').nth(1).locator('.rb-scene-addfrom-shot').first().locator('input').check();
  await shot('add-from-another-list');
  await click(add.locator('.ui-dialog-foot .ui-btn[data-variant="primary"]'), 'Add');
  await park();
  await shot('second-list-filled');

  // A row's shot-list menu, and the Remove question.
  await rowMenu('Lighthouse, dawn');
  await shot('row-menu');
  await click(menuItem('Remove from this list'), 'Remove from this list');
  await must(dialog('Remove from this list?'), 'the Remove question');
  await shot('remove-question');
  await click(button('Cancel', dialog('Remove from this list?')), 'Cancel');

  // The Delete question, which says it is the project's.
  await rowOf('Cliff path').hover();
  await click(rowOf('Cliff path').getByRole('button', { name: 'Delete scene', exact: true }), 'Delete scene');
  await must(dialog('Delete scene?'), 'the Delete question');
  await shot('delete-question');
  await click(button('Cancel', dialog('Delete scene?')), 'Cancel');

  // Save, Save as…, Set active.
  await click(button('Save', bar()), 'Save');
  await park();
  await shot('saved');
  await click(button('Save as…', bar()), 'Save as…');
  await must(dialog('Save as a new version'), 'Save as…');
  await shot('save-as');
  await click(button('Cancel', dialog('Save as a new version')), 'Cancel');
  await click(button('Set active', bar()), 'Set active');
  await must(dialog('Make this the active list?'), 'Set active\'s question');
  await shot('set-active-question');
  await click(button('Cancel', dialog('Make this the active list?')), 'Cancel');

  // Withdraw a new, untouched list, then Restore it.
  await click(button('New shot list', bar()), 'New shot list');
  await dialog('New shot list').getByRole('textbox').first().fill('Night unit');
  await dialog('New shot list').getByRole('radio', { name: /^Empty/ }).check();
  await click(button('Create shot list', dialog('New shot list')), 'Create shot list');
  await click(button('More shot list actions', bar()), 'the bar\'s More');
  await click(menuItem('Withdraw'), 'Withdraw');
  await must(dialog('Withdraw this list?'), 'the Withdraw question');
  await shot('withdraw-question');
  await click(button('Withdraw', dialog('Withdraw this list?')), 'Withdraw');
  await park();
  await shot('recently-removed');
  await click(button('Restore', bar()), 'Restore');
  await park();
  await shot('restored');

  // The picker, and its Archived view.
  await click(button('Shot lists…', bar()), 'Shot lists…');
  await must(dialog('Shot lists'), 'the picker');
  await shot('picker');
  await click(dialog('Shot lists').getByRole('button', { name: /^Archived…/ }), 'Archived…');
  await shot('picker-archived');
  await click(dialog('Archived shot lists').getByRole('button', { name: 'All shot lists' }), 'All shot lists');
  // Back to the active list, to take a scene out of the only list holding it.
  await click(dialog('Shot lists').getByRole('button', { name: 'Shot list 1', exact: true }), 'Shot list 1');
  await click(button('Open', dialog('Shot lists')), 'Open');
  await rowMenu('Salt hours');
  await click(menuItem('Remove from this list'), 'Remove from this list');
  await shot('remove-question-no-other-list');
  await click(button('Remove from list', dialog('Remove from this list?')), 'Remove from list');

  // "Not in any list", and its Add to list menu.
  await click(button('Shot lists…', bar()), 'Shot lists…');
  await click(dialog('Shot lists').getByRole('button', { name: /^Not in any list/ }), 'Not in any list');
  await click(button('Open', dialog('Shot lists')), 'Open');
  await park();
  await shot('not-in-any-list');
  await rowMenu('Salt hours');
  await shot('add-to-list-menu');
  await page.keyboard.press('Escape');

  // D21: a changed description, and the popup's question (back on the
  // active list first: the "Not in any list" view has no list to go back to).
  await click(button('Shot lists…', bar()), 'Shot lists…');
  await click(dialog('Shot lists').getByRole('button', { name: 'Shot list 1', exact: true }), 'Shot list 1');
  await click(button('Open', dialog('Shot lists')), 'Open');
  await rowOf('Lighthouse, dawn').hover();
  await click(rowOf('Lighthouse, dawn').getByRole('button', { name: 'View details', exact: true }), 'View details');
  const popup = dialog('Lighthouse, dawn');
  await must(popup, 'the scene popup');
  await click(popup.locator('.rb-scene-detail-main .rb-scene-prop-text').first(), 'the description');
  await popup.getByRole('textbox', { name: 'Description' }).fill('Mara stays out in the rain.');
  await page.keyboard.press('Escape');
  await must(dialog('Discard your changes?'), 'the draft question');
  await shot('discard-question');
} finally {
  await browser.close();
}
