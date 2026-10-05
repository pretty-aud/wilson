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
 * Post-overhaul S5d: `--part timeline` walks walkthrough 55's SECOND half,
 * the Timeline's bid version bar (default prefix po-s5d-):
 *
 *   node scripts/budget-versions-shots.mjs <port> --out <dir> --part timeline [--size 1280x700]
 *
 * the bar under the lock (greyed, pinned to the locked bid, the reason in
 * words) and Save as new version… there, which only records; Reset to
 * bidding; the dropdown's list; "Low ROM" (from Bid v1) and "Mid ROM" (from
 * Bid v2) saved as new from the Timeline; viewing Low ROM while Mid ROM is
 * open, then Current; Edit this version from the bar, its question and the
 * open; a drag, "● Unsaved", Save; Save as new version… "High ROM"; and, with
 * "Show weekends" off, a viewed version keeping its place across a zoom
 * change (the gantt's left date printed at each). It prints the bar's
 * measured widths too (the room the hand-off quotes).
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
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--prefix', '--part'].includes(args[i - 1])) || '5280';
const OUT = flag('--out');
if (!OUT) { console.error('usage: budget-versions-shots.mjs <port> --out <dir> [--size WxH] [--prefix p] [--part budget|timeline]'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PART = flag('--part') || 'budget';
if (!['budget', 'timeline'].includes(PART)) { console.error(`--part is budget or timeline, not ${PART}`); process.exit(1); }
const PREFIX = flag('--prefix') || (PART === 'timeline' ? 'po-s5d-' : 'po-s5c-');
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

  if (PART === 'budget') {
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
  } else {
    // ── The Timeline's half (post-overhaul S5d) ─────────────────────────────
    const verBar = () => page.locator('.rb-tl-ver-bar');
    const verSelect = () => verBar().getByRole('combobox', { name: 'Bid version' });
    const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
    const toTimeline = async () => {
      await click(tab('Timeline'), 'the Timeline tab');
      await must(verBar(), 'the bid version bar');
      await sleep(300);
    };
    const pickVersion = async (prefix) => {
      const sel = await must(verSelect(), 'the Bid version dropdown');
      const value = await sel.evaluate((s, p) => [...s.options].find((o) => o.textContent.startsWith(p))?.value, prefix);
      if (!value) throw new Error(`no version named ${prefix}`);
      await sel.selectOption(value);
      await sleep(400);
    };
    // Edit this version (the bar's, while viewing): the question that may come
    // first ("Save what the Timeline shows first?" → Discard), then its Edit.
    const editViewed = async (name, shotIt = null) => {
      await click(button('Edit this version', verBar()), 'the bar\'s Edit this version');
      const pre = dialog('Save what the Timeline shows first?');
      if (await pre.isVisible().catch(() => false)) await click(button('Discard', pre), 'Discard');
      const q = dialog(`Edit “${name}”?`);
      await must(q, `the Edit “${name}” question`);
      if (shotIt) await shot(shotIt);
      await click(button('Edit this version', q), 'the question\'s Edit this version');
      await must(verBar().locator('.rb-tl-ver-state', { hasText: `Open: ${name}` }), `${name} open`);
      await sleep(300);
    };
    const saveAsNew = async (name, shotIt = null) => {
      await click(button('Save as new version…', verBar()), 'Save as new version…');
      const f = dialog('Save as new version');
      await must(f, 'the Save as new version form');
      await f.getByRole('textbox', { name: 'Name' }).fill(name);
      if (shotIt) await shot(shotIt);
      await click(button('Save as new version', f), 'the form\'s Save as new version');
      await must(verBar().locator('.rb-tl-ver-state', { hasText: `Open: ${name}` }), `${name} open`);
      await sleep(300);
    };
    const leftDate = () => page.evaluate(() => {
      // The gantt's left date, read off the header the pane draws: the last
      // tick at or left of the scroll.
      const g = document.querySelector('.rb-tl-gantt');
      const ticks = [...g.querySelectorAll('.rb-tl-axis-tick')].map((t) => ({ x: parseFloat(t.style.left), label: t.querySelector('.rb-tl-axis-label')?.textContent || '' }));
      const at = ticks.filter((t) => t.x <= g.scrollLeft + 1 && t.label).pop();
      return at ? at.label : '?';
    });
    const measure = async (state) => {
      const m = await page.evaluate(() => {
        const w = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().width) : null; };
        const bar = document.querySelector('.rb-tl-ver-bar');
        const verbsEl = bar.querySelector('.rb-tl-ver-verbs');
        const tb = [...document.querySelectorAll('.ui-toolbar')].find((t) => t.querySelector('[aria-label="Detail zoom"]'));
        const [l, r] = tb.querySelectorAll(':scope > .ui-toolbar-slot');
        const lb = l.getBoundingClientRect(), rb = r.getBoundingClientRect();
        return {
          barH: Math.round(bar.getBoundingClientRect().height),
          select: w('.rb-tl-ver-select'), words: w('.rb-tl-ver-state'), verbs: verbsEl ? Math.round(verbsEl.getBoundingClientRect().width) : null,
          unsavedWord: w('.rb-tl-ver-bar .ui-btn-attention'),
          buttons: verbsEl ? [...verbsEl.querySelectorAll('button')].map((b) => `${b.textContent.trim()} ${Math.round(b.getBoundingClientRect().width)}`) : [],
          toolbarH: Math.round(tb.getBoundingClientRect().height), toolbarFree: Math.round(rb.left - lb.right - 8),
        };
      });
      console.log(`  measured (${state}): ${JSON.stringify(m)}`);
    };

    // Salt Hours, its Timeline.
    await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
    await sleep(500);
    await toTimeline();
    // 1 · Under the lock (F9): greyed, pinned to the locked bid, the reason in words.
    await shot('locked');
    await measure('locked');
    // 2 · Save as new version… there only records.
    await click(button('Save as new version…', verBar()), 'Save as new version…');
    const lockedForm = dialog('Save as new version');
    await must(lockedForm, 'the Save as new version form');
    await lockedForm.getByRole('textbox', { name: 'Name' }).fill('Revision after week 2');
    await shot('save-as-new-locked');
    await click(button('Save as new version', lockedForm), 'the form\'s Save as new version');
    await must(toast(/^Recorded “Revision after week 2”/), 'the recorded toast');
    await shot('recorded');
    // Reset to bidding (the Budget's banner), back to the Timeline.
    await click(tab('Budget'), 'the Budget tab');
    await click(button('Reset to bidding'), 'Reset to bidding');
    await must(toast(/^Back to bidding/), 'the reset toast');
    await toTimeline();
    await shot('bidding');
    // 3 · The dropdown's list. A native dropdown is never in a screenshot, so
    // for this one picture the select shows its options as a list (its own
    // options, nothing added), then goes back.
    // (With a size it is a listbox, no longer a combobox: found by its class.)
    const listed = verBar().locator('select.rb-tl-ver-select');
    await listed.evaluate((s) => { s.size = s.options.length + s.querySelectorAll('optgroup').length; s.style.height = 'auto'; s.style.maxWidth = 'none'; });
    await shot('dropdown');
    await listed.evaluate((s) => { s.removeAttribute('size'); s.style.height = ''; s.style.maxWidth = ''; });
    // 4 · "Low ROM" from Bid v1, "Mid ROM" from Bid v2 — each viewed, edited
    // from the bar, then saved as new from the Timeline.
    await pickVersion('Bid v1');
    await editViewed('Bid v1 (fund application)');
    await saveAsNew('Low ROM');
    await pickVersion('Bid v2');
    await editViewed('Bid v2 (pre-production)');
    await saveAsNew('Mid ROM');
    // 5 · Viewing Low ROM while Mid ROM is open; then Current. (The last
    // step's toast goes first: it is not this picture's subject.)
    const quiet = async () => {
      const x = page.getByTitle('Dismiss').first();
      if (await x.isVisible().catch(() => false)) { await x.click(); await sleep(200); }
    };
    await quiet();
    await pickVersion('Low ROM');
    await must(verBar().locator('.rb-tl-ver-state', { hasText: 'Viewing bid version: Low ROM' }), 'the viewing words');
    await shot('viewing-low-rom');
    await click(button('Current', verBar()), 'Current');
    await must(verBar().locator('.rb-tl-ver-state', { hasText: 'Open: Mid ROM' }), 'Mid ROM again');
    await shot('current-mid-rom');
    // 6 · Edit this version from the bar: the question, then the open.
    await pickVersion('Low ROM');
    await editViewed('Low ROM', 'edit-question');
    await must(toast(/editing “Low ROM”/), 'the open toast');
    await shot('open-low-rom');
    // 7 · A drag: the first task bar, brought on screen, one day later. "● Unsaved".
    // (The toast first goes: it sits over the gantt's lower rows.)
    const dismiss = page.getByTitle('Dismiss').first();
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-row-bar^="task:"]')].find((x) => x.getBoundingClientRect().width > 40);
      b?.scrollIntoView({ block: 'center', inline: 'center' });
    });
    await sleep(400);
    const box = await page.evaluate(() => {
      const g = document.querySelector('.rb-tl-gantt').getBoundingClientRect();
      const bars = [...document.querySelectorAll('[data-row-bar^="task:"]')].map((b) => b.getBoundingClientRect())
        .filter((b) => b.left > g.left + 250 && b.right < g.right - 20 && b.top > g.top + 44 && b.bottom < g.bottom && b.width > 40);
      return bars[0] ? { x: bars[0].left + bars[0].width / 2, y: bars[0].top + bars[0].height / 2 } : null;
    });
    if (!box) throw new Error('no task bar on screen to drag');
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + 12, box.y, { steps: 3 });
    await page.mouse.move(box.x + 24, box.y, { steps: 3 });
    await page.mouse.up();
    await sleep(500);
    // A drag past the task's phase asks to extend it: keep the task inside.
    const extend = page.getByRole('button', { name: /^Clamp/ }).first();
    if (await extend.isVisible().catch(() => false)) { await extend.click(); await sleep(400); }
    await must(verBar().locator('.rb-tl-ver-status', { hasText: 'Unsaved changes' }), 'Unsaved changes');
    await shot('unsaved');
    await measure('unsaved');
    await click(button('Save', verBar()), 'Save');
    await must(verBar().locator('.rb-tl-ver-status', { hasText: /^Saved / }), 'Saved');
    await shot('saved');
    // 8 · Save as new version… from the Timeline: "High ROM".
    await saveAsNew('High ROM', 'save-as-new');
    await shot('open-high-rom');
    // 9 · "Show weekends" off, Day zoom: a viewed version keeps its place
    // across a zoom change.
    await click(page.getByRole('button', { name: 'R.A.B.B.I.T. settings' }).first(), 'the settings gear');
    // The drawer opens locked: its "Editable" switch first.
    const editable = page.getByRole('switch', { name: 'Editable' }).first();
    await must(editable, 'the settings drawer\'s Editable switch');
    if ((await editable.getAttribute('aria-checked')) !== 'true') await editable.click();
    const weekends = page.getByRole('switch', { name: /weekends/i }).first();
    await must(weekends, 'the Show weekends switch');
    if ((await weekends.getAttribute('aria-checked')) === 'true') await weekends.click();
    await page.keyboard.press('Escape');
    await sleep(400);
    await click(page.getByRole('tab', { name: 'Day', exact: true }).first(), 'Day zoom');
    await sleep(400);
    await pickVersion('Low ROM');
    console.log(`  left date, viewing Low ROM at Day: ${await leftDate()}`);
    await shot('weekends-off-viewing-day');
    await click(page.getByRole('tab', { name: 'Week', exact: true }).first(), 'Week zoom');
    await sleep(500);
    console.log(`  left date, at Week: ${await leftDate()}`);
    await shot('weekends-off-viewing-week');
    await click(page.getByRole('tab', { name: 'Day', exact: true }).first(), 'Day zoom');
    await sleep(500);
    console.log(`  left date, back at Day: ${await leftDate()}`);
    await shot('weekends-off-viewing-day-again');
  }
} finally {
  await browser.close();
}
