#!/usr/bin/env node
/**
 * The tables' row buttons, measured and photographed before and after —
 * post-overhaul FX8 (2026-10-12).
 *
 *   node scripts/fx8-shots.mjs <port> --out <dir> --phase before|after [--size 1440x900] [--part tasks|assets|scenes|nest|shots|cut|levels|experiences|all] [--no-shots]
 *
 * Walks every R.A.B.B.I.T. table whose rows carry buttons that open an item's
 * window, on the dev fixtures' Salt Hours (levels and experiences on
 * `?fixtures=game`):
 *
 *   tasks        Tasks, Table
 *   assets       Assets, Table
 *   scenes       Scenes, the scene table
 *   nest         Scenes, the first scene opened onto its shots
 *   shots        Scenes, Shots, Table (grouped by scene)
 *   cut          Scenes, an edit's cut (a draft made by dragging one scene)
 *   levels       Levels, Table
 *   experiences  Experiences, Table
 *
 * For each table it prints, and writes as `po-fx8-<phase>-measure-<W>x<H>.json`
 * into --out: every header's label and width, the scroller's width and
 * whether it scrolls sideways, and for the first three rows the title's
 * words (their own glyph extent, not the button's box), every row button
 * (its icon, name, tooltip, box, the column it sits in, the gap from the end
 * of the words and from the row's right edge) and the buttons' opacity at
 * rest, with the row hovered and with the keyboard on the first of them —
 * plus the row's Tab order. Then three pictures a table (`--no-shots` skips
 * them): at rest, the first row hovered, the keyboard on its first button.
 * Each file is `po-fx8-<phase>-<part>-<nn>-<state>-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1 (the `fx8-worktree` entry in .claude/launch.json sets
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
const VALUED = ['--out', '--size', '--phase', '--part'];
const PORT = args.find((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1])) || '5296';
const OUT = flag('--out');
const PHASE = flag('--phase');
const SHOTS = !args.includes('--no-shots');
const ALL = ['tasks', 'assets', 'scenes', 'nest', 'shots', 'cut', 'levels', 'experiences'];
if (!OUT || !['before', 'after'].includes(PHASE)) {
  console.error(`usage: fx8-shots.mjs <port> --out <dir> --phase before|after [--size WxH] [--part ${ALL.join('|')}|all] [--no-shots]`);
  process.exit(1);
}
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PARTS = (flag('--part') || 'all') === 'all' ? ALL : [flag('--part')];
for (const p of PARTS) if (!ALL.includes(p)) { console.error(`unknown part ${p}`); process.exit(1); }
mkdirSync(OUT, { recursive: true });

// Where each table is and what its rows' title is called. `title` is the
// header's words; `rows` the data rows (never a band, a nest or an Add row).
const TABLES = {
  tasks:       { table: '.ui-table.rb-task-table', rows: 'tr.rb-task-row', title: 'Title' },
  assets:      { table: '.ui-table.rb-asset-table', rows: 'tr.rb-asset-row', title: 'Name' },
  scenes:      { table: '.ui-table.rb-scene-table-scenes', rows: '.rb-scene-table-scenes > tbody > tr.rb-scene-row', title: 'Name' },
  nest:        { table: '.ui-table.rb-scene-nest-table', rows: '.rb-scene-nest-table > tbody > tr.rb-scene-row', title: null, nameCell: 'td.rb-scene-name-cell' },
  shots:       { table: '.ui-table.rb-scene-table-shots', rows: '.rb-scene-table-shots > tbody > tr.rb-scene-row', title: 'Shot name' },
  cut:         { table: '.ui-table.rb-scene-table-cut', rows: 'tr.rb-scene-cut-row', title: 'Shot' },
  levels:      { table: '.ui-table.rb-ent-table', rows: 'tr.rb-ent-row', title: 'Name' },
  experiences: { table: '.ui-table.rb-ent-table', rows: 'tr.rb-ent-row', title: 'Name' },
};

// In the page: the table's numbers. A row button is any button in the row
// but the checkbox, the shots toggle and the thumbnail; its icon is the
// lucide class on its glyph.
function measureInPage({ table, rows, title, nameCell }) {
  const t = document.querySelector(table);
  if (!t) return { error: `no table ${table}` };
  const scroller = t.closest('.ui-table-scroll');
  const round = (n) => Math.round(n * 10) / 10;
  const box = (r) => ({ x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height), right: round(r.right) });
  const ths = [...t.querySelectorAll(':scope > thead > tr > th')];
  const headers = ths.map((th) => ({ label: th.textContent.trim() || '(none)', w: round(th.getBoundingClientRect().width) }));
  const titleIdx = title ? ths.findIndex((th) => th.textContent.trim() === title) : -1;
  const NAME = '.rb-task-cell-text, .rb-asset-cell-text, .rb-scene-inline, .rb-ent-cell-text, .rb-scene-cut-name, input';
  const out = {
    viewport: `${innerWidth}x${innerHeight}`,
    table: { w: round(t.getBoundingClientRect().width), left: round(t.getBoundingClientRect().left) },
    scroller: scroller ? { clientW: scroller.clientWidth, scrollW: scroller.scrollWidth, sideways: scroller.scrollWidth > scroller.clientWidth + 1 } : null,
    headers,
    titleColumn: titleIdx >= 0 ? headers[titleIdx] : null,
    rows: [],
  };
  const rowEls = [...document.querySelectorAll(rows)].slice(0, 3);
  for (const tr of rowEls) {
    const tds = [...tr.children];
    const td = nameCell ? tr.querySelector(nameCell) : tds[titleIdx];
    const nameEl = td?.querySelector(NAME);
    let words = null;
    if (nameEl) {
      const range = document.createRange();
      range.selectNodeContents(nameEl);
      const rr = range.getBoundingClientRect();
      words = { text: nameEl.textContent.trim(), glyphs: box(rr), element: box(nameEl.getBoundingClientRect()), tag: nameEl.tagName.toLowerCase(), cls: nameEl.className };
    }
    const colOf = (el) => {
      const cell = el.closest('td');
      const i = tds.indexOf(cell);
      return i >= 0 ? (headers[i]?.label ?? `#${i}`) : '?';
    };
    const isRowButton = (b) => !b.closest('.rb-task-check-cell, .rb-asset-check-cell, .rb-scene-check-cell, .rb-ent-check-cell, .rb-scene-expand-cell, .rb-asset-thumb-cell, .rb-scene-thumb-cell')
      && !b.matches('.rb-task-cell-text, .rb-asset-cell-text, .rb-ent-cell-text');
    const buttons = [...tr.querySelectorAll('button')].filter(isRowButton).map((b) => {
      const svg = b.querySelector('svg');
      const icon = svg ? [...svg.classList].find((c) => c.startsWith('lucide-') && c !== 'lucide-icon') || svg.getAttribute('class') : null;
      const slot = b.closest('.ui-hover-actions');
      const r = b.getBoundingClientRect();
      return {
        icon, name: b.getAttribute('aria-label'), tooltip: b.getAttribute('title'), column: colOf(b),
        box: box(r),
        opacity: Number(getComputedStyle(slot || b).opacity),
        fromWords: words ? round(r.left - words.glyphs.right) : null,
        toRowEnd: round(tr.getBoundingClientRect().right - r.right),
      };
    });
    const tabbable = [...tr.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
      .filter((e) => !e.disabled && e.getAttribute('tabindex') !== '-1' && e.getClientRects().length > 0)
      .map((e) => e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent.trim().slice(0, 30) || e.tagName.toLowerCase());
    out.rows.push({
      row: box(tr.getBoundingClientRect()),
      titleCell: td ? box(td.getBoundingClientRect()) : null,
      words, buttons, tabOrder: tabbable,
    });
  }
  return out;
}

const browser = await chromium.launch();
const results = {};
try {
  for (const PART of PARTS) {
    const spec = TABLES[PART];
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.clock.setFixedTime(new Date('2026-10-12T14:00:00'));
    page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
    const quietCss = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    const sleep = (ms) => page.waitForTimeout(ms);
    const park = () => page.mouse.move(W - 70, 12);
    let n = 0;
    const shot = async (state) => {
      n += 1;
      if (!SHOTS) return;
      await sleep(250);
      const file = `po-fx8-${PHASE}-${PART}-${String(n).padStart(2, '0')}-${state}-${W}x${H}.png`;
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
    const button = (name, root = page) => root.getByRole('button', { name, exact: true }).first();
    const dialog = (name) => page.getByRole('dialog', { name, exact: true });
    const open = async (query = '') => {
      await page.goto(`http://localhost:${PORT}/rabbit${query}`, { waitUntil: 'networkidle' });
      await page.addStyleTag({ content: quietCss });
      await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
      await sleep(500);
    };
    const sceneRow = (name) => page.locator('tr.rb-scene-row', { has: page.getByRole('button', { name: `Select ${name}`, exact: true }) }).first();
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

    if (PART === 'levels' || PART === 'experiences') {
      await open('?fixtures=game');
      await click(tab(PART === 'levels' ? 'Levels' : 'Experiences'), `the ${PART} tab`);
    } else {
      await open();
      const where = { tasks: 'Tasks', assets: 'Assets' }[PART] || 'Scenes';
      await click(tab(where), `the ${where} tab`);
    }
    if (['scenes', 'nest', 'cut'].includes(PART)) await click(tab('Scenes'), 'the Scenes mode');
    if (PART === 'shots') await click(tab('Shots'), 'the Shots mode');
    await click(tab('Table'), 'the Table view');
    if (PART === 'nest') {
      const first = page.locator('.rb-scene-table-scenes > tbody > tr.rb-scene-row').filter({ has: page.getByRole('button', { name: 'Show shots', exact: true }) }).first();
      await click(first.getByRole('button', { name: 'Show shots', exact: true }), 'Show shots on the first scene with shots');
    }
    if (PART === 'cut') {
      await dragTo(sceneRow('The storm').locator('.rb-scene-num-cell .rb-scene-grip'), sceneRow('Cliff path'));
      await click(button('Start new edit', dialog('Make a new edit from this list?')), 'Start new edit');
    }
    await must(page.locator(spec.rows).first(), `the ${PART} rows`);
    await park();
    await sleep(300);

    const rest = await page.evaluate(measureInPage, spec);
    await shot('rest');

    // The first row hovered: the pointer on its words.
    const firstRow = page.locator(spec.rows).first();
    const nameLoc = firstRow.locator(spec.nameCell || 'td').locator('.rb-task-cell-text, .rb-asset-cell-text, .rb-scene-inline, .rb-ent-cell-text, .rb-scene-cut-name').first();
    await (await must(nameLoc, `the first ${PART} row's words`)).hover();
    await sleep(250);
    const hover = await page.evaluate(measureInPage, spec);
    await shot('hover');

    // The keyboard on the row's first button: focus the control before it
    // in the row's Tab order, then Tab.
    await park();
    const focusInfo = await page.evaluate(({ rows }) => {
      const tr = document.querySelector(rows);
      const all = [...tr.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
        .filter((e) => !e.disabled && e.getAttribute('tabindex') !== '-1' && e.getClientRects().length > 0);
      const acts = all.filter((b) => b.closest('.ui-hover-actions, .rb-scene-cut-acts'));
      if (!acts.length) return { error: 'no action button in the first row' };
      const i = all.indexOf(acts[0]);
      if (i > 0) all[i - 1].focus(); else document.body.focus();
      return { before: i > 0 ? (all[i - 1].getAttribute('aria-label') || all[i - 1].textContent.trim().slice(0, 30)) : '(body)', target: acts[0].getAttribute('aria-label') };
    }, spec);
    await page.keyboard.press('Tab');
    await sleep(200);
    const focused = await page.evaluate(() => {
      const a = document.activeElement;
      return { name: a?.getAttribute('aria-label') || a?.textContent.trim().slice(0, 30), focusVisible: a?.matches(':focus-visible') || false };
    });
    const focus = await page.evaluate(measureInPage, spec);
    await shot('focus');

    const summarize = (m) => m.rows.map((r) => r.buttons.map((b) => b.opacity));
    results[PART] = {
      rest,
      opacity: { rest: summarize(rest), hover: summarize(hover), focus: summarize(focus) },
      keyboard: { ...focusInfo, landedOn: focused },
    };
    console.log(`\n=== ${PART} ${W}x${H} ===`);
    console.log(`  title column: ${JSON.stringify(rest.titleColumn)}  scroller: ${JSON.stringify(rest.scroller)}`);
    console.log(`  headers: ${rest.headers.map((h) => `${h.label}=${h.w}`).join(' · ')}`);
    for (const r of rest.rows) {
      console.log(`  row "${r.words?.text}" words ${r.words?.glyphs.x}..${r.words?.glyphs.right} (${r.words?.tag}.${r.words?.cls}) cell ${r.titleCell?.x}..${r.titleCell?.right}`);
      for (const b of r.buttons) console.log(`    [${b.icon}] "${b.name}" in ${b.column} at x ${b.box.x} ${b.box.w}x${b.box.h}; from words ${b.fromWords}, to row end ${b.toRowEnd}`);
      console.log(`    tab: ${r.tabOrder.join(' → ')}`);
    }
    console.log(`  opacity rest ${JSON.stringify(results[PART].opacity.rest[0])} hover ${JSON.stringify(results[PART].opacity.hover[0])} focus ${JSON.stringify(results[PART].opacity.focus[0])}`);
    console.log(`  keyboard: from "${focusInfo.before}" Tab → "${focused.name}" (focus-visible ${focused.focusVisible})`);
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `po-fx8-${PHASE}-measure-${W}x${H}.json`), JSON.stringify(results, null, 2));
console.log(`\nwrote ${join(OUT, `po-fx8-${PHASE}-measure-${W}x${H}.json`)}`);
