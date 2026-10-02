#!/usr/bin/env node
/**
 * The Scenes tab's edits, photographed — post-overhaul S3c (2026-10-02).
 *
 *   node scripts/scenes-edits-shots.mjs <port> --out <dir> [--size 1440x900] [--prefix po-s3c-]
 *
 * Walks walkthrough 53's states in order on the dev fixtures' Salt Hours: the
 * list with its grips, a drag and its line, the first-change question, the
 * draft (Save edit's "Unsaved"), a row's edit actions, a repeat and a removal,
 * Add shot…, the Save edit dialog, the saved edit, the next version's
 * question, the picker's edits, a missing shot, the leave question at four
 * exits (the tab strip, a page switch, "Show in Bins", the edit selector),
 * "Recover unsaved edit?" after a reload, the Budget's "Based on shot list",
 * the Timeline's "Shot list:" label, and a task showing its shot's list; then
 * Audrey's rule of 2026-10-02 (removing a list never removes the Timeline or
 * the Budget): another list made active, a scene taken out of it, and its
 * task read as not assigned on the Timeline and the Budget and named "not in
 * the active list" in its own window. The window's close question is the
 * desktop app's (a separate run, number 21). Each file is
 * `<prefix><nn>-<state>-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1. Changes nothing that outlives the page: the fixture
 * store is in memory, the browser context is fresh per run, and the
 * localStorage copy of a draft goes with the context. Animations and
 * transitions are off and the caret is transparent, in this page only (Save
 * edit's ring is caught at rest: its edge, its dot and its word show). A
 * state whose control is not found stops the run and says which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--prefix'].includes(args[i - 1])) || '5278';
const OUT = flag('--out');
if (!OUT) { console.error('usage: scenes-edits-shots.mjs <port> --out <dir> [--size WxH] [--prefix p]'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PREFIX = flag('--prefix') || 'po-s3c-';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.clock.setFixedTime(new Date('2026-10-02T09:00:00'));
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  const quiet = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: quiet });

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
  const menuItem = (words) => page.locator('.ui-menu .ui-menu-item', { has: page.locator('.ui-menu-item-label', { hasText: new RegExp(`^${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first();
  const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
  const sceneRow = (name) => page.locator('tr.rb-scene-row', { has: page.getByRole('button', { name: `Select ${name}`, exact: true }) }).first();
  const cutRow = (name, i = 0) => page.locator('tr.rb-scene-cut-row', { has: page.locator('.rb-scene-cut-name', { hasText: new RegExp(`^${name}$`) }) }).nth(i);
  const editSelect = () => page.getByRole('combobox', { name: 'Edit on screen' });
  const leaveQ = () => dialog('Save the edit before leaving?');
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
  /** A native drag by the grip, ending over the top half of `target`; `drop` releases it. */
  const dragTo = async (grip, target, { drop = true, shotFirst = null } = {}) => {
    const g = await (await must(grip, 'a grip')).boundingBox();
    const t = await (await must(target, 'a drop target')).boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + 360, t.y + 6, { steps: 8 });
    await page.mouse.move(t.x + 372, t.y + 8, { steps: 2 });
    await sleep(150);
    if (shotFirst) await shotFirst();
    if (drop) await page.mouse.up();
  };

  // ── Salt Hours, the Scenes tab: the list, in List order, with its grips ──
  await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
  await click(tab('Scenes'), 'the Scenes tab');
  await must(bar(), 'the shot list bar');
  await park();
  await shot('list-grips');

  // ── A drag on the list: The storm, before Cliff path. Its line, then its question. ──
  await dragTo(sceneRow('The storm').locator('.rb-scene-num-cell .rb-scene-grip'), sceneRow('Cliff path'), {
    shotFirst: () => shot('drag-line'),
  });
  await must(dialog('Make a new edit from this list?'), 'the first-change question');
  await shot('first-drag-question');
  await click(button('Start new edit', dialog('Make a new edit from this list?')), 'Start new edit');
  await park();
  await shot('draft');

  // ── A row's edit actions; a repeat and a removal; Add shot… ──
  await cutMenu('Up the stair');
  await shot('row-edit-actions');
  await click(menuItem('Duplicate in edit'), 'Duplicate in edit');
  await cutMenu('Her side');
  await click(menuItem('Remove from edit'), 'Remove from edit');
  await park();
  await shot('repeat-and-removal');
  await cutMenu('The door');
  await click(menuItem('Add shot…'), 'Add shot…');
  const add = dialog('Add shots to the edit');
  await must(add, 'Add shots');
  await add.locator('label.rb-scene-addfrom-shot', { hasText: 'Lightning, wide' }).locator('input').check();
  await shot('add-shots');
  await click(add.locator('.ui-dialog-foot .ui-btn[data-variant="primary"]'), 'Add 1 shot');

  // ── Save edit: the dialog, then the edit saved ──
  await click(button('Save edit', bar()), 'Save edit');
  const save = dialog('Save edit');
  await must(save, 'the Save edit dialog');
  await save.getByRole('textbox', { name: 'Summary' }).fill('The storm moves up; the stair plays twice; his side, without her side.');
  await shot('save-edit');
  await click(save.locator('.ui-dialog-foot .ui-btn[data-variant="primary"]'), 'Save edit');
  await park();
  await shot('saved-edit');

  // ── A change on a saved edit asks for its next version ──
  await cutMenu('The door');
  await click(menuItem('Move down'), 'Move down');
  await must(dialog('Make a new version of this edit?'), 'the next version\'s question');
  await shot('next-version-question');
  await click(button('Cancel', dialog('Make a new version of this edit?')), 'Cancel');

  // ── The picker shows the list's edits ──
  await click(button('Shot lists…', bar()), 'Shot lists…');
  await must(dialog('Shot lists'), 'the picker');
  await shot('picker-edits');
  await page.keyboard.press('Escape');

  // ── A missing shot: one the edit holds, deleted from the project ──
  const savedEdit = await editSelect().inputValue();
  await editSelect().selectOption('');
  await click(tab('Shots'), 'the Shots content tab');
  const lightning = page.locator('tr.rb-scene-row', { has: page.getByRole('button', { name: 'Select Lightning, wide', exact: true }) }).first();
  await lightning.hover();
  await click(lightning.getByRole('button', { name: 'Delete shot', exact: true }), 'Delete shot');
  await click(button('Delete', dialog('Delete shot?')), 'Delete');
  await editSelect().selectOption(savedEdit);
  await park();
  await shot('missing-shot');

  // ── Four exits, each asking first while an edit is unsaved (a new draft) ──
  await cutMenu('The door');
  await click(menuItem('Move down'), 'Move down');
  await click(button('Start new version', dialog('Make a new version of this edit?')), 'Start new version');
  await click(tab('Timeline'), 'the Timeline tab');
  await must(leaveQ(), 'the leave question (tab strip)');
  await shot('leave-tab');
  await click(button('Keep editing', leaveQ()), 'Keep editing');
  await click(page.getByRole('button', { name: 'Navigation', exact: true }).first(), 'the navigation menu');
  await click(page.locator('button', { hasText: /^Home$/ }).first(), 'Home');
  await must(leaveQ(), 'the leave question (page)');
  await shot('leave-page');
  await click(button('Keep editing', leaveQ()), 'Keep editing');
  await page.keyboard.press('Escape');
  await click(cutRow('The door').getByRole('button', { name: 'View details of The door', exact: true }), 'The door\'s details');
  const door = dialog('The door');
  await must(door, 'the shot popup');
  await click(door.getByRole('button', { name: 'Show in Bins' }).first(), 'Show in Bins');
  await must(leaveQ(), 'the leave question (a jump out of Scenes)');
  await shot('leave-jump');
  await click(button('Keep editing', leaveQ()), 'Keep editing');
  await click(button('Close', door.locator('.ui-dialog-foot')), 'Close');
  await editSelect().selectOption('');
  await must(leaveQ(), 'the leave question (the edit selector)');
  await shot('leave-edit-selector');
  await click(button('Keep editing', leaveQ()), 'Keep editing');

  // ── A reload: the draft's copy is offered back ──
  await page.reload({ waitUntil: 'networkidle' });
  await page.addStyleTag({ content: quiet });
  await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
  await click(tab('Scenes'), 'the Scenes tab');
  await must(dialog('Recover unsaved edit?'), 'Recover unsaved edit?');
  await shot('recover');
  await click(button('Discard edit', dialog('Recover unsaved edit?')), 'Discard edit');

  // ── The Budget's "Based on shot list" ──
  await click(tab('Budget'), 'the Budget tab');
  const basedOn = page.getByRole('combobox', { name: 'Based on shot list' });
  await basedOn.scrollIntoViewIfNeeded();
  await must(basedOn, 'Based on shot list');
  await park();
  await shot('budget-based-on');

  // ── The Timeline's "Shot list:" label, grouped by scene ──
  await click(tab('Timeline'), 'the Timeline tab');
  await click(page.locator('[role="tab"][title="Group by scene"]').first(), 'Group by scene');
  await park();
  await shot('timeline-label');

  // ── A task made on a shot shows the shot's list ──
  await click(tab('Scenes'), 'the Scenes tab');
  await click(tab('Shots'), 'the Shots content tab');
  const doorRow = page.locator('tr.rb-scene-row', { has: page.getByRole('button', { name: 'Select The door', exact: true }) }).first();
  await doorRow.hover();
  await click(doorRow.getByRole('button', { name: 'View details', exact: true }), 'The door\'s details');
  const pop = dialog('The door');
  await click(button('Add new task', pop), 'Add new task');
  await page.getByPlaceholder('Task title…').fill('Grade the doorway');
  await click(button('Create task', pop), 'Create task');
  const sure = page.getByRole('dialog', { name: /^Create task/ });
  if (await sure.count()) await click(sure.locator('.ui-dialog-foot .ui-btn[data-variant="primary"]'), 'Create');
  await click(pop.getByText('Grade the doorway').first(), 'the new task');
  await must(page.locator('.rb-task-links'), 'the task\'s links');
  await park();
  await shot('task-shot-list');

  // ── Audrey's rule of 2026-10-02: removing a list never removes the
  //    Timeline or the Budget. 21 is the desktop app's close question (a
  //    separate run), so these are 22 onward. ──
  n += 1;
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await sleep(300);
  if (await page.getByRole('dialog').count()) throw new Error('not found: the popups closed');
  // The tab strip's "Scenes" comes first; the content tab is the second.
  await click(page.getByRole('tab', { name: 'Scenes', exact: true }).nth(1), 'the Scenes content tab');
  await click(button('New shot list', bar()), 'New shot list');
  const form = dialog('New shot list');
  await must(form, 'the New shot list form');
  await form.getByRole('textbox', { name: 'Title' }).fill('Second unit');
  await form.locator('input[type="radio"][value="screen"]').check();
  await click(button('Create shot list', form), 'Create shot list');
  await click(button('Set active', bar()), 'Set active');
  await must(dialog('Make this the active list?'), 'the Set active question');
  await shot('set-active-question');
  await click(button('Make active', dialog('Make this the active list?')), 'Make active');
  const lighthouse = sceneRow('Lighthouse, dawn');
  await lighthouse.hover();
  await click(lighthouse.getByRole('button', { name: 'Shot list actions for Lighthouse, dawn', exact: true }), 'the shot-list menu of Lighthouse, dawn');
  await click(menuItem('Remove from this list'), 'Remove from this list');
  await must(dialog('Remove from this list?'), 'the Remove question');
  await shot('remove-from-active-question');
  await click(button('Remove from list', dialog('Remove from this list?')), 'Remove from list');
  await sleep(300);

  await click(tab('Timeline'), 'the Timeline tab');
  await click(page.locator('[role="tab"][title="Group by scene"]').first(), 'Group by scene');
  const graded = page.locator('.rb-tl-row-label', { hasText: /^Grade the doorway$/ }).first();
  await must(graded, 'Grade the doorway on the Timeline');
  await graded.scrollIntoViewIfNeeded();
  console.log(`    its row says: ${JSON.stringify(await graded.locator('xpath=..').getAttribute('title'))}`);
  await park();
  await shot('timeline-not-assigned');

  await click(tab('Budget'), 'the Budget tab');
  await click(tab('By scene'), 'By scene');
  const noScene = page.locator('table.rb-budget-report tbody td', { hasText: /^No scene$/ }).first();
  await must(noScene, 'the No scene row');
  console.log(`    "No scene" says: ${JSON.stringify(await noScene.getAttribute('title'))}`);
  await park();
  await shot('budget-not-assigned');

  await click(tab('Timeline'), 'the Timeline tab');
  await graded.scrollIntoViewIfNeeded();
  await click(graded, 'Grade the doorway');
  const taskPop = dialog('Grade the doorway');
  await must(taskPop.locator('.rb-scene-home[data-outside="true"]'), 'the task\'s "not in the active list"');
  await park();
  await shot('task-not-in-active');
} finally {
  await browser.close();
}
