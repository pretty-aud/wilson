#!/usr/bin/env node
/**
 * The five R.A.B.B.I.T. tables as they stand, measured and photographed for
 * the custom-views research — post-overhaul VW1 (2026-10-13).
 *
 *   node scripts/vw1-shots.mjs <port> --out <dir> [--size 1440x900] [--part tasks|assets|scenes|shots|levels|experiences|all] [--no-shots]
 *
 * On the dev fixtures' Salt Hours (levels and experiences on `?fixtures=game`):
 *
 *   tasks        Tasks, Table
 *   assets       Assets, Table
 *   scenes       Scenes, Scenes mode, Table
 *   shots        Scenes, Shots mode, Table
 *   levels       Levels, Table
 *   experiences  Experiences, Table
 *
 * For each table it prints, and writes as `po-vw1-measure-<W>x<H>.json` into
 * --out: the toolbar's controls left to right (tag, role, words, name, title,
 * x and width; a native select's options), the table's headers with their
 * widths, whether the table scrolls sideways, the row count; then for Tasks
 * the Asset cell of the task that holds two assets ("Glass and rain rig
 * test": its select's chosen value and every option). Pictures
 * (`--no-shots` skips them), each `po-vw1-<part>-<nn>-<state>-<W>x<H>.png`:
 * at rest, the Filter control opened, the saved-views menu opened, the menu
 * again after one view ("Research view") is saved through its own command
 * (the JSON records that saved row's element: OUTSTANDING P1-08), for
 * Tasks the two-asset row, and for Levels the window of "Cliff Path" (a
 * level fixture task 18 names second) beside the table's counts for it
 * (OUTSTANDING P1-26). It also records whether Escape, with the keyboard
 * on the menu's button, closes the menu. A native select's open list is
 * drawn by the operating system and never reaches a screenshot: its options
 * are in the
 * JSON instead.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1 (the `vw1-worktree` entry in .claude/launch.json sets
 * both). Changes nothing that outlives the page: the fixture store is in
 * memory and every table gets a fresh page. Animations and transitions are
 * off and the caret transparent, in this page only. A control that is not
 * found stops the run and says which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const VALUED = ['--out', '--size', '--part', '--vw1b'];
const PORT = args.find((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1])) || '5298';
const OUT = flag('--out');
const SHOTS = !args.includes('--no-shots');
const ALL = ['tasks', 'assets', 'scenes', 'shots', 'levels', 'experiences'];
if (!OUT) {
  console.error(`usage: vw1-shots.mjs <port> --out <dir> [--size WxH] [--part ${ALL.join('|')}|all] [--no-shots]`);
  process.exit(1);
}
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PARTS = (flag('--part') || 'all') === 'all' ? ALL : [flag('--part')];
for (const p of PARTS) if (!ALL.includes(p)) { console.error(`unknown part ${p}`); process.exit(1); }
mkdirSync(OUT, { recursive: true });

// ── Post-overhaul VW1b (2026-10-17): the Tasks table's item columns ─────────
//
//   node scripts/vw1-shots.mjs <port> --out <dir> --vw1b before|after [--size WxH] [--no-shots]
//
// The states VW1b's brief asks for, the same on the integration branch's
// code (before) and VW1b's (after), each `po-vw1b-<phase>-<nn>-<state>-<W>x<H>.png`
// and every number in `po-vw1b-measure-<phase>-<W>x<H>.json`:
//   01 tasks          a film project's Tasks table at rest (Salt Hours): the
//                     toolbar's two SLOTS measured (not two controls: VW1's
//                     trap 2), every header's width, whether it scrolls;
//   02 two-assets     task 18, "Glass and rain rig test" (two assets), in view:
//                     each of its cells' words and accessible names;
//   03 picker         its Asset cell's picker open (after only);
//   04 by-asset       grouped by Asset, scrolled to the combination group;
//   05 scrolled       scrolled all the way sideways: where the checkbox and
//                     Title cells sit, and the first scrolled cell's left edge;
//   06 game, 07 game-scrolled   the same table on `?fixtures=game` (levels
//                     and experiences on), at rest and scrolled;
//   08 levels         Levels: "Cliff Path" (a level task 18 names second) —
//                     its row's Assets and Tasks counts and its window's
//                     Linked counts line (OUTSTANDING P1-26).
// Real scrollbars (FX8's --scrollbars): the desktop app draws them, and a
// table that scrolls sideways is the point. The fixtures give no asset a
// scene, so the scene window's count is 0 on either side (its test proves it).
const VW1B = flag('--vw1b');
if (VW1B) {
  if (!['before', 'after'].includes(VW1B)) { console.error('--vw1b before|after'); process.exit(1); }
  const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
  const out = {};
  try {
    // Each state keeps its number on both sides (the picker is after only).
    const NUMBER = { tasks: 1, 'two-assets': 2, picker: 3, 'by-asset': 4, scrolled: 5, game: 6, 'game-scrolled': 7, levels: 8 };
    const state = async (name, query, act) => {
      const n = NUMBER[name];
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      await page.clock.setFixedTime(new Date('2026-10-17T14:00:00'));
      page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
      await page.goto(`http://localhost:${PORT}/rabbit${query}`, { waitUntil: 'networkidle' });
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
      await page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first().click();
      await page.waitForTimeout(500);
      const measured = await act(page);
      await page.waitForTimeout(250);
      const file = `po-vw1b-${VW1B}-${String(n).padStart(2, '0')}-${name}-${W}x${H}.png`;
      if (SHOTS) { await page.screenshot({ path: join(OUT, file) }); console.log(`  ${file}`); }
      out[name] = measured;
      await page.close();
    };
    const tasksTab = async (page) => {
      await page.getByRole('tab', { name: 'Tasks', exact: true }).first().click();
      await page.getByRole('tab', { name: 'Table', exact: true }).first().click();
      await page.waitForSelector('.ui-table.rb-task-table');
      await page.mouse.move(W - 70, 12);
      await page.waitForTimeout(300);
    };
    const tableNow = (page) => page.evaluate(() => {
      const r1 = (n) => Math.round(n * 10) / 10;
      const t = document.querySelector('.ui-table.rb-task-table');
      const sc = t.closest('.ui-table-scroll');
      const bar = document.querySelector('.rb-task-toolbar');
      const slots = [...bar.querySelectorAll(':scope > .ui-toolbar-slot')].map((s) => { const b = s.getBoundingClientRect(); return { x: r1(b.left), w: r1(b.width), right: r1(b.right) }; });
      return {
        toolbar: { h: r1(bar.getBoundingClientRect().height), slots, gapBetween: slots.length === 2 ? r1(slots[1].x - slots[0].right) : null },
        headers: [...t.querySelectorAll(':scope > thead > tr > th')].map((th) => [th.textContent.trim() || '(check)', r1(th.getBoundingClientRect().width)]),
        scroller: { clientW: sc.clientWidth, scrollW: sc.scrollWidth, scrollLeft: sc.scrollLeft, sideways: sc.scrollWidth > sc.clientWidth + 1 },
        sticky: t.getAttribute('data-sticky'),
      };
    });
    const rowNow = (page, title) => page.evaluate((title) => {
      const r1 = (n) => Math.round(n * 10) / 10;
      const t = document.querySelector('.ui-table.rb-task-table');
      const tr = [...t.querySelectorAll('tr.rb-task-row')].find((r) => r.textContent.includes(title));
      if (!tr) return null;
      const ths = [...t.querySelectorAll(':scope > thead > tr > th')].map((th) => th.textContent.trim() || '(check)');
      const cells = {};
      ths.forEach((h, i) => {
        const td = tr.children[i];
        const named = td?.querySelector('[aria-label]');
        cells[h] = { words: td?.textContent.trim().slice(0, 60), name: named?.getAttribute('aria-label') || null, left: r1(td.getBoundingClientRect().left) };
      });
      return cells;
    }, title);
    const scrollAll = (page) => page.evaluate(() => { const sc = document.querySelector('.ui-table.rb-task-table').closest('.ui-table-scroll'); sc.scrollLeft = sc.scrollWidth; });
    // A row brought into view, the table at rest sideways: a row wider than
    // the scroller is also scrolled sideways by scrollIntoViewIfNeeded (12px
    // in Chromium once the scroll padding went, VW1b review round 1, R1-2),
    // which no person's own scrolling does.
    const rowInView = async (page, locator) => {
      await locator.scrollIntoViewIfNeeded();
      await page.evaluate(() => { document.querySelector('.ui-table.rb-task-table').closest('.ui-table-scroll').scrollLeft = 0; });
    };
    const TWO = 'Glass and rain rig test';

    await state('tasks', '', async (page) => { await tasksTab(page); return tableNow(page); });
    await state('two-assets', '', async (page) => {
      await tasksTab(page);
      await rowInView(page, page.locator('tr.rb-task-row', { hasText: TWO }).first());
      return rowNow(page, TWO);
    });
    if (VW1B === 'after') {
      await state('picker', '', async (page) => {
        await tasksTab(page);
        const row = page.locator('tr.rb-task-row', { hasText: TWO }).first();
        await rowInView(page, row);
        await row.locator('button.rb-task-items').first().click();
        await page.waitForTimeout(300);
        return page.evaluate(() => {
          const p = document.querySelector('.ui-popover');
          const b = p.getBoundingClientRect();
          return { label: p.getAttribute('aria-label'), box: { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
            rows: [...p.querySelectorAll('[role="checkbox"]')].map((r) => `${r.textContent.trim()}${r.getAttribute('aria-checked') === 'true' ? ' ✓' : ''}`) };
        });
      });
    }
    await state('by-asset', '', async (page) => {
      await tasksTab(page);
      await page.getByRole('combobox', { name: 'Group' }).selectOption('asset');
      await page.waitForTimeout(300);
      const band = page.locator('tr.rb-task-group-row', { hasText: ',' }).first();
      if (await band.count()) await rowInView(page, band);
      return page.evaluate(() => [...document.querySelectorAll('tr.rb-task-group-row')].map((r) => `${r.querySelector('.rb-task-group-label').textContent} (${r.querySelector('.rb-task-group-count').textContent})`));
    });
    await state('scrolled', '', async (page) => {
      await tasksTab(page);
      await page.locator('tr.rb-task-row', { hasText: TWO }).first().scrollIntoViewIfNeeded();
      await scrollAll(page);
      await page.waitForTimeout(200);
      return { table: await tableNow(page), row: await rowNow(page, TWO) };
    });
    await state('game', '?fixtures=game', async (page) => { await tasksTab(page); return tableNow(page); });
    await state('game-scrolled', '?fixtures=game', async (page) => {
      await tasksTab(page);
      await page.locator('tr.rb-task-row', { hasText: TWO }).first().scrollIntoViewIfNeeded();
      await scrollAll(page);
      await page.waitForTimeout(200);
      return { table: await tableNow(page), row: await rowNow(page, TWO) };
    });
    await state('levels', '?fixtures=game', async (page) => {
      await page.getByRole('tab', { name: 'Levels', exact: true }).first().click();
      await page.getByRole('tab', { name: 'Table', exact: true }).first().click();
      const row = page.locator('tr.rb-ent-row', { hasText: 'Cliff Path' }).first();
      await row.waitFor();
      const counts = await row.evaluate((tr) => {
        const ths = [...tr.closest('table').querySelectorAll(':scope > thead > tr > th')].map((th) => th.textContent.trim());
        return { assets: tr.children[ths.indexOf('Assets')]?.textContent.trim(), tasks: tr.children[ths.indexOf('Tasks')]?.textContent.trim() };
      });
      await page.getByRole('button', { name: 'Open Cliff Path', exact: true }).click();
      await page.waitForTimeout(500);
      const windowLine = await page.evaluate(() => {
        const text = (document.querySelector('[role="dialog"]')?.textContent || '').replace(/\s+/g, ' ');
        const i = text.indexOf('Linked counts');
        return { lists: text.match(/(Assets|Tasks|Files) \(\d+\)/g), linked: i >= 0 ? text.slice(i, i + 40) : null };
      });
      return { row: counts, window: windowLine };
    });
  } finally {
    await browser.close();
  }
  const file = join(OUT, `po-vw1b-measure-${VW1B}-${W}x${H}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`wrote ${file}`);
  process.exit(0);
}

// Each table's own class. The toolbar is found from the table: the nearest
// `.ui-toolbar` above it in the page that holds a Filter control.
const TABLES = {
  tasks:       '.ui-table.rb-task-table',
  assets:      '.ui-table.rb-asset-table',
  scenes:      '.ui-table.rb-scene-table-scenes',
  shots:       '.ui-table.rb-scene-table-shots',
  levels:      '.ui-table.rb-ent-table',
  experiences: '.ui-table.rb-ent-table',
};

function measureInPage(tableSel) {
  const t = document.querySelector(tableSel);
  if (!t) return { error: `no table ${tableSel}` };
  const bars = [...document.querySelectorAll('.ui-toolbar')].filter((b) => b.getClientRects().length
    && [...b.querySelectorAll('button')].some((x) => /filter/i.test(x.getAttribute('aria-label') || x.textContent || '')));
  const bar = bars[bars.length - 1] || null;
  const controls = bar ? [...bar.querySelectorAll('button, select, input')].filter((e) => e.getClientRects().length).map((e) => {
    const r = e.getBoundingClientRect();
    return {
      tag: e.tagName.toLowerCase(),
      role: e.getAttribute('role'),
      words: e.tagName === 'SELECT' ? e.options[e.selectedIndex]?.textContent.trim() : (e.textContent.trim().slice(0, 40) || e.getAttribute('placeholder') || ''),
      name: e.getAttribute('aria-label'),
      title: e.getAttribute('title'),
      pressed: e.getAttribute('aria-pressed') ?? e.getAttribute('aria-selected'),
      x: round(r.left), w: round(r.width), h: round(r.height),
      options: e.tagName === 'SELECT' ? [...e.options].map((o) => o.textContent.trim()) : undefined,
    };
  }) : [];
  const scroller = t.closest('.ui-table-scroll');
  const headers = [...t.querySelectorAll(':scope > thead > tr > th')].map((th) => ({
    label: th.textContent.trim() || '(none)', w: round(th.getBoundingClientRect().width),
  }));
  const rows = t.querySelectorAll(':scope > tbody > tr').length;
  return {
    viewport: `${innerWidth}x${innerHeight}`,
    toolbar: bar ? { cls: bar.className, w: round(bar.getBoundingClientRect().width), wraps: bar.getBoundingClientRect().height > 40, h: round(bar.getBoundingClientRect().height) } : null,
    controls,
    table: { w: round(t.getBoundingClientRect().width) },
    scroller: scroller ? { clientW: scroller.clientWidth, scrollW: scroller.scrollWidth, sideways: scroller.scrollWidth > scroller.clientWidth + 1 } : null,
    headers,
    bodyRows: rows,
  };
}

const browser = await chromium.launch();
const results = {};
try {
  for (const PART of PARTS) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.clock.setFixedTime(new Date('2026-10-13T14:00:00'));
    page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
    const quietCss = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    const sleep = (ms) => page.waitForTimeout(ms);
    const park = () => page.mouse.move(W - 70, 12);
    let n = 0;
    const shot = async (state) => {
      n += 1;
      if (!SHOTS) return;
      await sleep(250);
      const file = `po-vw1-${PART}-${String(n).padStart(2, '0')}-${state}-${W}x${H}.png`;
      await page.screenshot({ path: join(OUT, file) });
      console.log(`  ${file}`);
    };
    const must = async (loc, what) => {
      try {
        await loc.waitFor({ state: 'visible', timeout: 10000 });
      } catch {
        await page.screenshot({ path: join(OUT, `debug-not-found-${PART}-${W}x${H}.png`) });
        throw new Error(`not found: ${what} (the screen then: debug-not-found-${PART}-${W}x${H}.png)`);
      }
      return loc;
    };
    const click = async (loc, what) => { await (await must(loc, what)).click(); };
    const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
    const open = async (query = '') => {
      await page.goto(`http://localhost:${PORT}/rabbit${query}`, { waitUntil: 'networkidle' });
      await page.addStyleTag({ content: quietCss });
      await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
      await sleep(500);
    };

    if (PART === 'levels' || PART === 'experiences') {
      await open('?fixtures=game');
      await click(tab(PART === 'levels' ? 'Levels' : 'Experiences'), `the ${PART} tab`);
    } else {
      await open();
      const where = { tasks: 'Tasks', assets: 'Assets' }[PART] || 'Scenes';
      await click(tab(where), `the ${where} tab`);
    }
    if (PART === 'scenes') await click(tab('Scenes'), 'the Scenes mode');
    if (PART === 'shots') await click(tab('Shots'), 'the Shots mode');
    await click(tab('Table'), 'the Table view');
    await must(page.locator(TABLES[PART]).first(), `the ${PART} table`);
    await park();
    await sleep(300);

    const rest = await page.evaluate(measureInPage, TABLES[PART]);
    results[PART] = { rest };
    await shot('rest');

    // The Filter control, opened.
    const filterBtn = page.locator('.ui-toolbar button').filter({ hasText: /^Filter/ }).first();
    if (await filterBtn.count()) {
      await filterBtn.click();
      await sleep(250);
      await park();
      results[PART].filterOpen = await page.evaluate(() => {
        const strip = document.querySelector('[class*="filter-strip"], [class*="filter-bar"], [class*="filters"]');
        return strip ? { cls: strip.className, words: strip.textContent.trim().replace(/\s+/g, ' ').slice(0, 200) } : null;
      });
      await shot('filter');
      await filterBtn.click();
      await sleep(200);
    }

    // The saved-views menu, opened (its trigger reads "Views" or is an icon
    // named for saved views).
    const viewsBtn = page.locator('.ui-toolbar button').filter({ hasText: /^Views$/ }).first();
    const viewsIcon = page.locator('.ui-toolbar button[aria-label*="view" i], .ui-toolbar button[title*="view" i]').first();
    const trigger = (await viewsBtn.count()) ? viewsBtn : viewsIcon;
    // The open menu: the smallest visible element whose class names a menu
    // and which holds the "Save … view" command (each lane has its own
    // classes: rb-task-menu, rb-asset-…, rb-scene-…, rb-ent-…).
    const menuInPage = () => {
      const save = [...document.querySelectorAll('button, [role="menuitem"], div, span')]
        .filter((e) => e.getClientRects().length && /^save (current )?view/i.test(e.textContent.trim()))
        .pop();
      if (!save) return null;
      // A class token that ENDS in menu / dropdown / popover (rb-task-menu),
      // never one that only contains it (rb-task-menu-label).
      const isMenu = (e) => e.classList && [...e.classList].some((c) => /(^|-)(menu|dropdown|popover)$/i.test(c));
      let m = save;
      while (m && !isMenu(m)) m = m.parentElement;
      m = m || save.parentElement;
      return {
        cls: m.className, role: m.getAttribute('role'),
        words: m.textContent.trim().replace(/\s+/g, ' ').slice(0, 240),
        items: [...m.querySelectorAll('button, [role="menuitem"], [tabindex], div[class*="row"], div[class*="item"]')]
          .filter((e) => e.getClientRects().length)
          .map((e) => ({ tag: e.tagName.toLowerCase(), cls: typeof e.className === 'string' ? e.className : '', role: e.getAttribute('role'), tabindex: e.getAttribute('tabindex'), words: e.textContent.trim().slice(0, 40), name: e.getAttribute('aria-label') || e.getAttribute('title') })),
      };
    };
    if (await trigger.count()) {
      results[PART].viewsTrigger = await trigger.evaluate((b) => ({ words: b.textContent.trim(), name: b.getAttribute('aria-label'), title: b.getAttribute('title'), expanded: b.getAttribute('aria-expanded'), haspopup: b.getAttribute('aria-haspopup') }));
      await trigger.click();
      await sleep(250);
      await park();
      results[PART].viewsOpen = await page.evaluate(menuInPage);
      await shot('views');
      // Escape with the keyboard on the trigger (where a click leaves it):
      // does the menu close?
      await trigger.focus();
      await page.keyboard.press('Escape');
      await sleep(200);
      results[PART].viewsClosesOnEscape = (await page.evaluate(menuInPage)) === null;
      // Save one view through the menu's own command, then reopen the menu
      // to measure a saved row (OUTSTANDING P1-08: rows are divs, mouse
      // only). The name field is whatever input the command focuses.
      if (!results[PART].viewsClosesOnEscape) await page.mouse.click(W - 70, 12);
      await sleep(150);
      await trigger.click();
      await sleep(200);
      const saveCmd = page.getByText(/^Save (current )?view/i).first();
      if (await saveCmd.count()) {
        await saveCmd.click();
        await sleep(250);
        const field = page.locator('input:focus');
        if (await field.count()) {
          await field.fill('Research view');
          await field.press('Enter');
          await sleep(300);
          results[PART].savedOne = true;
          await park();
          if ((await page.evaluate(menuInPage)) === null) { await trigger.click(); await sleep(250); }
          await park();
          results[PART].viewsWithOne = await page.evaluate(menuInPage);
          results[PART].savedRow = await page.evaluate(() => {
            const el = [...document.querySelectorAll('*')].filter((e) => e.getClientRects().length && e.textContent.trim() === 'Research view').pop();
            if (!el) return null;
            const rowEl = el.closest('button, [role="menuitem"], [tabindex], div[class*="row"], div[class*="item"]') || el.parentElement;
            return { tag: rowEl.tagName.toLowerCase(), cls: typeof rowEl.className === 'string' ? rowEl.className : '', role: rowEl.getAttribute('role'), tabindex: rowEl.getAttribute('tabindex'), focusable: rowEl.tabIndex >= 0, buttonsInside: [...rowEl.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent.trim()) };
          });
          await shot('views-saved');
        } else {
          results[PART].savedOne = 'no focused field after the save command';
        }
      }
    } else {
      results[PART].viewsTrigger = null;
    }

    // Tasks: the task with two assets, and its Asset cell.
    if (PART === 'tasks') {
      await page.mouse.click(W - 70, 12);
      await sleep(200);
      const row = page.locator('tr.rb-task-row', { hasText: 'Glass and rain rig test' }).first();
      await must(row, 'the task with two assets');
      await row.scrollIntoViewIfNeeded();
      results.tasks.twoAssetRow = await row.evaluate((tr) => {
        const ths = [...tr.closest('table').querySelectorAll(':scope > thead > tr > th')].map((th) => th.textContent.trim());
        const cells = {};
        ths.forEach((h, i) => {
          const td = tr.children[i];
          const sel = td?.querySelector('select');
          cells[h || '(none)'] = sel
            ? { control: 'select', name: sel.getAttribute('aria-label'), chosen: sel.options[sel.selectedIndex]?.textContent.trim(), options: [...sel.options].map((o) => o.textContent.trim()) }
            : { words: td?.textContent.trim().slice(0, 60) };
        });
        return cells;
      });
      await park();
      await shot('two-assets');
    }
    // Levels: the window of a level that a task names as its SECOND level
    // ("Cliff Path", fixture task 18): its own lists against the table's
    // counts (OUTSTANDING P1-26).
    if (PART === 'levels') {
      await page.mouse.click(W - 70, 12);
      await sleep(200);
      const row = page.locator('tr.rb-ent-row', { hasText: 'Cliff Path' }).first();
      results.levels.cliffPathRow = await (await must(row, 'the Cliff Path row')).evaluate((tr) => {
        const ths = [...tr.closest('table').querySelectorAll(':scope > thead > tr > th')].map((th) => th.textContent.trim());
        return { assets: tr.children[ths.indexOf('Assets')]?.textContent.trim(), tasks: tr.children[ths.indexOf('Tasks')]?.textContent.trim() };
      });
      await click(page.getByRole('button', { name: 'Open Cliff Path', exact: true }), 'Open Cliff Path');
      await sleep(500);
      results.levels.cliffPathWindow = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        const text = (d?.textContent || '').replace(/\s+/g, ' ');
        const i = text.indexOf('Linked counts');
        return { lists: text.match(/(Assets|Tasks|Files) \(\d+\)/g), linkedCounts: i >= 0 ? text.slice(i, i + 40) : null };
      });
      await park();
      await shot('window-counts');
    }
    console.log(`\n=== ${PART} ${W}x${H} ===`);
    console.log(`  toolbar: ${rest.controls.map((c) => `${c.words || c.name || c.tag}${c.options ? `[${c.options.length}]` : ''}@${c.x}`).join(' · ')}`);
    console.log(`  headers: ${rest.headers.map((h) => `${h.label}=${h.w}`).join(' · ')}`);
    console.log(`  table ${rest.table.w}  scroller ${JSON.stringify(rest.scroller)}  rows ${rest.bodyRows}`);
    console.log(`  views: ${JSON.stringify(results[PART].viewsTrigger)} menu ${results[PART].viewsOpen?.cls} esc-closes ${results[PART].viewsClosesOnEscape}`);
    console.log(`  saved row: ${JSON.stringify(results[PART].savedRow)} (saved: ${results[PART].savedOne})`);
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `po-vw1-measure-${W}x${H}.json`), JSON.stringify(results, null, 2));
console.log(`\nwrote ${join(OUT, `po-vw1-measure-${W}x${H}.json`)}`);
