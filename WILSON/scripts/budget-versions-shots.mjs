#!/usr/bin/env node
/**
 * The Budget's bid versions, photographed — post-overhaul S5c (2026-10-05).
 *
 *   node scripts/budget-versions-shots.mjs <port> --out <dir> [--size 1440x900] [--prefix po-s5c-]
 *
 * Walks walkthrough 55's Budget half on the dev fixtures' Salt Hours (Bid v1
 * holds the first thirty-one tasks, Bid v2 all forty-two and is LOCKED): the
 * Summary under the lock; Save as new version… there, which only records;
 * Reset to bidding and its undo toast; Edit this version — the question
 * first when the Timeline is saved in no version, then the question naming
 * what leaves the Timeline, the rows with work first and the checkbox; the
 * open version saved, then a change and its "● Unsaved"; the question before
 * editing another version while unsaved; Manage versions…; a version's
 * delete question; Set budget active and the lock; the overall total with
 * the total before agency. Each file is `<prefix><nn>-<state>-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1. Changes nothing that outlives the page (the fixture
 * store is in memory; the browser context is fresh per run). Animations and
 * transitions are off and the caret transparent, in this page only. A state
 * whose control is not found stops the run and says which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--prefix'].includes(args[i - 1])) || '5280';
const OUT = flag('--out');
if (!OUT) { console.error('usage: budget-versions-shots.mjs <port> --out <dir> [--size WxH] [--prefix p]'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PREFIX = flag('--prefix') || 'po-s5c-';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.clock.setFixedTime(new Date('2026-10-05T14:02:00'));
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  const quiet = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: quiet });

  const sleep = (ms) => page.waitForTimeout(ms);
  let n = 0;
  const shot = async (state) => {
    n += 1;
    await page.mouse.move(W - 70, 12);
    await sleep(300);
    const file = `${PREFIX}${String(n).padStart(2, '0')}-${state}-${W}x${H}.png`;
    await page.screenshot({ path: join(OUT, file) });
    console.log(`  ${file}`);
  };
  const must = async (loc, what) => {
    try {
      await loc.waitFor({ state: 'visible', timeout: 8000 });
    } catch {
      await page.screenshot({ path: join(OUT, `debug-not-found-${W}x${H}.png`) });
      throw new Error(`not found: ${what} (the screen then: debug-not-found-${W}x${H}.png)`);
    }
    return loc;
  };
  const click = async (loc, what) => { await (await must(loc, what)).click(); };
  const button = (name, root = page) => root.getByRole('button', { name, exact: true }).first();
  const dialog = (name) => page.getByRole('dialog', { name, exact: true });
  const block = () => page.locator('section.rb-bv-block');
  const scrollTo = async (loc) => { await loc.evaluate((el) => el.scrollIntoView({ block: 'start' })); await sleep(150); };
  const pickBid = async (prefix) => {
    const sel = await must(block().getByRole('combobox', { name: 'Selected bid' }), 'the Selected bid dropdown');
    const value = await sel.evaluate((s, p) => [...s.options].find((o) => o.textContent.startsWith(p))?.value, prefix);
    if (!value) throw new Error(`no bid named ${prefix}`);
    await sel.selectOption(value);
    await sleep(300);
  };
  const toast = (re) => page.getByText(re).first();

  // Salt Hours (its card on R.A.B.B.I.T.'s Summary, as S3c's walk opens it),
  // its Budget, the Budget's Summary.
  await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
  await sleep(500);
  await click(page.getByRole('tab', { name: 'Budget', exact: true }).first(), 'the Budget tab');
  await must(block(), 'the bid versions block');
  await shot('summary-locked');

  // Under the lock, Save as new version… only records (F9).
  await click(button('Save as new version…', block()), 'Save as new version…');
  const saveNew = dialog('Save as new version');
  await must(saveNew, 'the Save as new version form');
  await saveNew.getByRole('textbox', { name: 'Name' }).fill('Revision after week 2');
  await saveNew.getByRole('textbox', { name: 'Note' }).fill('Production changes after the first two weeks');
  await shot('save-as-new-locked');
  await click(button('Save as new version', saveNew), 'the form\'s Save as new version');
  await must(toast(/^Recorded “Revision after week 2”/), 'the recorded toast');
  await shot('recorded');

  // Reset to bidding: one click, and the toast is the way back.
  await click(button('Reset to bidding'), 'Reset to bidding');
  await must(toast(/^Back to bidding/), 'the reset toast');
  await shot('bidding');

  // Bid v1: eleven tasks leave the Timeline, two of them with work. (No
  // question comes first: "Revision after week 2", recorded above from these
  // very rows, holds the Timeline as it is — nothing is unsaved.)
  await pickBid('Bid v1');
  await click(button('Edit this version', block()), 'Edit this version on Bid v1');
  const pre = dialog('Save what the Timeline shows first?');
  if (await pre.isVisible().catch(() => false)) await click(button('Discard', pre), 'Discard');
  const edit = dialog('Edit “Bid v1 (fund application)”?');
  await must(edit, 'the Edit question');
  await shot('edit-question-work');
  await click(button('Edit this version', edit), 'the question\'s Edit this version');
  await must(toast(/editing “Bid v1/), 'the open toast');
  await shot('open-saved');

  // A change: the margin. The open version reads unsaved; Save is the orange.
  const marginRow = page.locator('.rb-budget-wf-row', { hasText: 'Margin' }).first();
  await scrollTo(page.locator('.rb-budget-wf').first());
  await click(marginRow.locator('.rb-budget-pct').first(), 'the margin');
  const pct = marginRow.locator('input.rb-budget-pct').first();
  await must(pct, 'the margin field');
  await pct.fill('12');
  await pct.press('Enter');
  await sleep(300);
  await scrollTo(block());
  await must(block().locator('.rb-bv-open-status', { hasText: 'Unsaved changes' }), 'Unsaved changes');
  await shot('unsaved');

  // Editing another version while this one is unsaved asks first.
  await pickBid('Bid v2');
  await click(button('Edit this version', block()), 'Edit this version on Bid v2');
  const ask = dialog('Save the changes to “Bid v1 (fund application)” first?');
  await must(ask, 'the unsaved question');
  await shot('unsaved-question');
  await click(button('Cancel', ask), 'its Cancel');
  await pickBid('Bid v1');
  await click(button('Save', block()), 'Save');
  await must(block().locator('.rb-bv-open-status', { hasText: /^Saved / }), 'Saved');
  await shot('saved');

  // Manage versions…, and a version's delete question (Cancel).
  await click(button('Manage versions…', block()), 'Manage versions…');
  const picker = dialog('Bid versions');
  await must(picker, 'the picker');
  await shot('manage');
  await click(picker.getByRole('button', { name: 'Actions for “Bid v2 (pre-production)”' }), 'Bid v2\'s actions');
  await click(page.locator('.ui-menu .ui-menu-item', { hasText: 'Delete…' }).first(), 'Delete…');
  const del = dialog('Delete “Bid v2 (pre-production)”?');
  await must(del, 'the delete question');
  await shot('delete-question');
  await click(button('Cancel', del), 'its Cancel');
  await click(button('Close', picker), 'the picker\'s Close');

  // Set budget active on the open, saved Bid v1: the lock.
  await click(button('Set budget active', block()), 'Set budget active');
  const lock = dialog('Set “Bid v1 (fund application)” active?');
  await must(lock, 'the lock question');
  await shot('lock-question');
  await click(button('Set budget active', lock), 'the question\'s Set budget active');
  await must(page.getByText('Budget active — in production').first(), 'the banner');
  await shot('locked');

  // The overall total, and the total before agency under it (F7).
  await scrollTo(page.locator('.rb-budget-wf').first());
  await shot('overall-total');
} finally {
  await browser.close();
}
