#!/usr/bin/env node
/**
 * VW1m's after-pictures: a task's items are its items (no main item) —
 * post-overhaul VW1m (2026-10-16).
 *
 *   node scripts/vw1m-shots.mjs <port> --out <dir> [--size 1440x900[,1280x700]] [--part <name>[,<name>…]|all] [--no-shots]
 *
 * On the dev fixtures' Salt Hours (task 18 "Glass and rain rig test" is
 * about two assets, Lighthouse Interior and Sea Spray Comp, a scene and a
 * shot; `?fixtures=game` puts it on two levels, Lamp Room and Cliff Path):
 *
 *   window     01 task 18's window from the Tasks table's Open button: the
 *                 Items table (no Main, no Move, Remove on a hovered row),
 *                 the Sort in its head, a Files section per item (first open)
 *              02 the Sort menu open; 02b after choosing A to Z; 02c Date
 *                 added; 02d `?fixtures=game` task 18 (levels, experience
 *                 too) in A to Z, where it differs from Type
 *   tasks      03 the Tasks table grouped by Asset (top); 03b scrolled to the
 *                 combination group; 03c the same after "Final mix" lost its
 *                 only asset in this page (so a No asset group exists)
 *   board      04 the Board grouped by Asset (start); 04b scrolled to the
 *                 combination column and No asset
 *   timeline   05 the Timeline grouped by asset, scrolled to the combination
 *                 row; 05c the same after "Final mix" lost its only asset
 *   budget     06 By asset; 06b By phase; 06c By asset after "Final mix"
 *                 lost its only asset (a No asset row)
 *   level      07 `?fixtures=game`: the Timeline grouped by level, scrolled to
 *                 the combination row
 *   dashboard  08 the Dashboard's My tasks (the tester's tasks: task 18 is
 *                 not one, and none of hers is about two assets)
 *
 * Every picture is `po-vw1m-<nn>-<state>-<W>x<H>.png`; one JSON,
 * `po-vw1m-measure.json`, holds every size's record: the group/row labels
 * of 03, 04, 05, 07 (with whether each is in view, cut short, and for the
 * Timeline whether it draws a bar), the By asset rows (name, bid, cost) and
 * whether they add up exactly to the Summary's Bid days and Base cost, the
 * Sort menu's options, the Files section labels, the Dashboard's rows.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1. Changes nothing that outlives the page: the fixture
 * store is in memory and every part gets a fresh page (a fresh browser
 * context). Animations and transitions are off and the caret transparent, in
 * this page only. A control that is not found stops that part, says which,
 * and leaves `po-vw1m-debug-<part>-<W>x<H>.png`.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const VALUED = ['--out', '--size', '--part'];
const PORT = args.find((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1])) || '5298';
const OUT = flag('--out');
const SHOTS = !args.includes('--no-shots');
const ALL = ['window', 'tasks', 'board', 'timeline', 'budget', 'level', 'dashboard'];
if (!OUT) {
  console.error(`usage: vw1m-shots.mjs <port> --out <dir> [--size WxH[,WxH]] [--part ${ALL.join('|')}|all] [--no-shots]`);
  process.exit(1);
}
const SIZES = (flag('--size') || '1440x900,1280x700').split(',').map((s) => s.split('x').map(Number));
const PARTS = (flag('--part') || 'all') === 'all' ? ALL : flag('--part').split(',');
for (const p of PARTS) if (!ALL.includes(p)) { console.error(`unknown part ${p}`); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const TASK18 = 'Glass and rain rig test';
const LOSES_ASSET = 'Final mix';           // one asset (Score & Foley): made asset-less in 03c, 05c, 06c
const quietCss = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

// ── In-page measures ─────────────────────────────────────────────────────────

/** The scroll box an element sits in (the nearest ancestor that scrolls). */
function inViewIn(el) {
  const r = el.getBoundingClientRect();
  let box = { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
  for (let p = el.parentElement; p; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (/(auto|scroll|hidden)/.test(cs.overflowY + cs.overflowX) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) {
      const pr = p.getBoundingClientRect();
      box = { top: Math.max(box.top, pr.top), bottom: Math.min(box.bottom, pr.bottom), left: Math.max(box.left, pr.left), right: Math.min(box.right, pr.right) };
    }
  }
  return r.bottom > box.top + 1 && r.top < box.bottom - 1 && r.right > box.left + 1 && r.left < box.right - 1;
}

function measureWindow(title) {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => (x.getAttribute('aria-label') || x.querySelector('h1,h2,h3')?.textContent || '').includes(title)) || document.querySelector('[role="dialog"]');
  if (!d) return { error: 'no dialog' };
  const items = d.querySelector('.rb-rel-items');
  const rows = items ? [...items.querySelectorAll('.rb-rel-row')].map((r) => {
    const name = r.querySelector('.rb-rel-name');
    const kindGroup = r.closest('[role="group"]');
    const glyph = r.querySelector('.rb-rel-glyph');
    const buttons = [...r.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent.trim());
    return {
      name: name?.textContent.trim(),
      kind: kindGroup?.getAttribute('aria-label') || glyph?.getAttribute('aria-label') || null,
      nameCut: name ? name.scrollWidth > name.clientWidth + 1 : null,
      words: r.textContent.replace(/\s+/g, ' ').trim(),
      buttons,
    };
  }) : [];
  const head = items?.querySelector('.rb-rel-section-head, header, [class*="head"]');
  const sortBtn = d.querySelector('button[title^="Sort items"], button[aria-label^="Sort items"]');
  const files = [...d.querySelectorAll('.rb-task-section')].map((s) => {
    const h = s.querySelector('.rb-task-section-head');
    const l = s.querySelector('.rb-task-section-label');
    return { label: l?.textContent.trim(), open: h?.getAttribute('aria-expanded') === 'true', cut: l ? l.scrollWidth > l.clientWidth + 1 : null };
  });
  const allButtons = [...d.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent.trim());
  const text = d.textContent.replace(/\s+/g, ' ');
  // The open Files section's table: cells whose words run past their room,
  // and whether its table is wider than the box that holds it.
  const body = d.querySelector('.rb-task-section-body');
  const ft = body?.querySelector('table');
  const filesTable = ft ? (() => {
    let box = ft.parentElement;
    while (box && box !== body && box.clientWidth >= ft.getBoundingClientRect().width - 1) box = box.parentElement;
    const holder = ft.parentElement;
    const hs = getComputedStyle(holder);
    return {
      tableW: Math.round(ft.getBoundingClientRect().width),
      holderW: holder.clientWidth,
      holderScrolls: /(auto|scroll)/.test(hs.overflowX) && holder.scrollWidth > holder.clientWidth + 1,
      sectionW: body.clientWidth,
      cutCells: [...ft.querySelectorAll('td, th')].filter((c) => c.getClientRects().length && (c.scrollWidth > c.clientWidth + 1 || c.getBoundingClientRect().right > body.getBoundingClientRect().right + 1))
        .map((c) => ({ words: c.textContent.trim().slice(0, 30), right: Math.round(c.getBoundingClientRect().right), sectionRight: Math.round(body.getBoundingClientRect().right), over: c.scrollWidth - c.clientWidth })),
    };
  })() : null;
  return {
    itemsHead: items?.querySelector('[class*="title"], h3, h4')?.textContent.trim() || null,
    itemsHeadWords: head ? head.textContent.replace(/\s+/g, ' ').trim() : null,
    kindLabels: items ? [...items.querySelectorAll('.rb-rel-kind-label')].map((k) => k.textContent.trim()) : [],
    rows,
    sortButton: sortBtn ? { title: sortBtn.getAttribute('title'), name: sortBtn.getAttribute('aria-label'), expanded: sortBtn.getAttribute('aria-expanded') } : null,
    mainAnywhere: /\bMain\b/.test(text) ? text.match(/.{0,40}\bMain\b.{0,40}/g) : false,
    moveButtons: allButtons.filter((n) => /^Move\b/i.test(n || '')),
    removeButtons: allButtons.filter((n) => /^Remove\b/i.test(n || '')),
    files,
    filesTable,
    goneWords: /No longer in the project/.test(text),
  };
}

function measureMenu() {
  const m = [...document.querySelectorAll('.ui-menu')].filter((e) => e.getClientRects().length).pop();
  if (!m) return null;
  const r = m.getBoundingClientRect();
  return {
    words: m.textContent.replace(/\s+/g, ' ').trim(),
    items: [...m.querySelectorAll('.ui-menu-item')].map((b) => ({ words: b.textContent.trim(), checked: !!b.querySelector('svg.lucide-check'), cut: b.scrollWidth > b.clientWidth + 1 })),
    box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
  };
}

function measureTasksTable() {
  const t = document.querySelector('.ui-table.rb-task-table');
  if (!t) return { error: 'no tasks table' };
  const ths = [...t.querySelectorAll(':scope > thead > tr > th')].map((th) => th.textContent.trim());
  const assetCol = ths.indexOf('Asset');
  const groups = [];
  let g = null;
  const titleOf = (tr) => {
    const b = [...tr.querySelectorAll('button')].map((x) => x.getAttribute('aria-label') || x.getAttribute('title') || '').find((n) => /^Open /.test(n));
    return b ? b.slice(5) : tr.textContent.trim().slice(0, 40);
  };
  for (const tr of t.querySelectorAll(':scope > tbody > tr')) {
    if (tr.classList.contains('rb-task-group-row')) {
      const l = tr.querySelector('.rb-task-group-label');
      g = { label: l?.textContent.trim() || tr.textContent.trim(), count: tr.querySelector('.rb-task-group-count')?.textContent.trim(), cut: l ? l.scrollWidth > l.clientWidth + 1 : null, labelTitle: l ? (l.closest('[title]')?.getAttribute('title') || null) : null, inView: inViewIn(tr), tasks: [] };
      groups.push(g);
    } else if (tr.classList.contains('rb-task-row')) {
      const td = assetCol >= 0 ? tr.children[assetCol] : null;
      const task = { title: titleOf(tr), asset: td ? td.textContent.trim() : null, assetTitle: td ? (td.getAttribute('title') || td.querySelector('[title]')?.getAttribute('title') || null) : null };
      if (g) g.tasks.push(task); else groups.push({ label: '(no group)', tasks: [task] });
    }
  }
  return { headers: ths, groups };
}

function measureBoard() {
  const cols = [...document.querySelectorAll('.rb-task-col')];
  return cols.map((c) => {
    const l = c.querySelector('.rb-task-col-head .rb-task-group-label');
    return {
      label: l?.textContent.trim(),
      count: c.querySelector('.rb-task-col-head .rb-task-group-count')?.textContent.trim(),
      cut: l ? l.scrollWidth > l.clientWidth + 1 : null,
      labelTitle: l ? (l.closest('[title]')?.getAttribute('title') || null) : null,
      inView: inViewIn(c.querySelector('.rb-task-col-head') || c),
      cards: [...c.querySelectorAll('.rb-task-card')].map((card) => {
        const a = card.querySelector('.rb-task-card-asset');
        return { title: card.querySelector('.rb-task-card-title')?.textContent.trim(), asset: a?.textContent.trim() || null, assetTitle: a?.getAttribute('title') || null, assetCut: a ? a.scrollWidth > a.clientWidth + 1 : null };
      }),
    };
  });
}

function measureTimeline() {
  const labels = [...document.querySelectorAll('.rb-tl-row')].filter((e) => e.getClientRects().length);
  const chartRows = [...document.querySelectorAll('.rb-tl-chart-row')];
  const rows = labels.map((el) => {
    const r = el.getBoundingClientRect();
    const lab = el.querySelector('.rb-tl-row-label');
    const chart = chartRows.find((c) => Math.abs(c.getBoundingClientRect().top - r.top) < 2);
    return {
      label: lab?.textContent.trim() ?? el.textContent.trim(),
      shape: el.dataset.shape,
      indent: parseFloat(el.style.paddingLeft) || 0,
      inView: inViewIn(el),
      cut: lab ? lab.scrollWidth > lab.clientWidth + 1 : null,
      bar: chart ? !!chart.querySelector('.rb-tl-bar') : null,
      title: el.getAttribute('title'),
    };
  });
  // Each task row's group: the last header above it with a smaller indent.
  const stack = [];
  for (const row of rows) {
    while (stack.length && stack[stack.length - 1].indent >= row.indent) stack.pop();
    if (row.shape !== 'task') { row.parent = stack.length ? stack[stack.length - 1].label : null; stack.push(row); }
    else row.group = stack.length ? stack[stack.length - 1].label : null;
  }
  return rows;
}

function measureBudgetReport() {
  const t = [...document.querySelectorAll('.rb-budget-report')].filter((e) => e.getClientRects().length).pop();
  if (!t) return { error: 'no report table' };
  const ths = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  const rows = [...t.querySelectorAll('tbody tr')].map((tr) => {
    const cells = [...tr.children].map((td) => td.textContent.trim());
    const o = {};
    ths.forEach((h, i) => { o[h] = cells[i]; });
    const first = tr.children[0];
    o._cut = first ? first.scrollWidth > first.clientWidth + 1 : null;
    o._title = first?.getAttribute('title') || null;
    return o;
  });
  const foot = [...t.querySelectorAll('tfoot tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  return { headers: ths, rows, foot };
}

function measureBudgetSummary() {
  const stat = (label) => {
    const s = [...document.querySelectorAll('.rb-budget-stat')].find((e) => e.textContent.includes(label));
    return s ? (s.querySelector('.ui-stat-value')?.textContent.trim() ?? null) : null;
  };
  const wf = (label) => {
    const r = [...document.querySelectorAll('.rb-budget-wf-row')].find((e) => e.querySelector('.rb-budget-wf-label')?.textContent.trim() === label);
    return r ? r.querySelector('.rb-budget-wf-amount')?.textContent.trim() : null;
  };
  return { bidDays: stat('Bid days'), loggedDays: stat('Logged days'), baseCost: wf('Base cost') };
}

function measureDashboard() {
  const t = document.querySelector('table[aria-label="My tasks across every project"]');
  if (!t) return { error: 'no My tasks table' };
  const ths = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  const out = [];
  let group = null;
  for (const tr of t.querySelectorAll('tbody tr')) {
    if (tr.classList.contains('dash-group-row')) { group = tr.querySelector('.dash-group-name')?.textContent.trim(); continue; }
    const cells = [...tr.children];
    const o = { group };
    ths.forEach((h, i) => {
      const td = cells[i];
      o[h || `(col ${i})`] = td?.textContent.trim();
      if (/asset/i.test(h)) { o._assetTitle = td?.getAttribute('title') || null; o._assetCut = td ? td.scrollWidth > td.clientWidth + 1 : null; }
    });
    out.push(o);
  }
  return { headers: ths, rows: out };
}

// ── Numbers ──────────────────────────────────────────────────────────────────
const num = (s) => {
  if (s == null) return null;
  const m = String(s).replace(/[,\s]/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const sumOf = (xs) => Math.round(xs.reduce((a, b) => a + (b || 0), 0) * 100) / 100;

function checkReport(report, summary) {
  if (!report?.rows) return null;
  const bids = report.rows.map((r) => num(r.Bid));
  const costs = report.rows.map((r) => num(r.Cost));
  const bidSum = sumOf(bids);
  const costSum = sumOf(costs);
  const totalBid = num(summary?.bidDays);
  const totalCost = num(summary?.baseCost);
  return {
    rows: report.rows.map((r) => ({ name: r[report.headers[0]], tasks: r.Tasks, bid: r.Bid, logged: r.Logged, cost: r.Cost, cut: r._cut })),
    bidSum, costSum, totalBid, totalCost,
    bidAddsUp: totalBid != null ? Math.abs(bidSum - totalBid) < 1e-9 : null,
    costAddsUp: totalCost != null ? Math.abs(costSum - totalCost) < 1e-9 : null,
  };
}

// ── The run ──────────────────────────────────────────────────────────────────
const JSON_PATH = join(OUT, 'po-vw1m-measure.json');
const results = existsSync(JSON_PATH) ? JSON.parse(readFileSync(JSON_PATH, 'utf8')) : {};
results._about = 'VW1m after-pictures (scripts/vw1m-shots.mjs), dev fixtures, Salt Hours. Per size, per part. 03c/05c/06c: "Final mix" had its only asset (Score & Foley) removed through its window in that page first, so a No asset group/row exists (no fixture task is without an asset). Budget totals are the Summary tab Bid days and Base cost (the By asset tab shows no total of its own). mainOnScreen: every "Main" in the page text at each photographed state.';
const browser = await chromium.launch();
try {
  for (const [W, H] of SIZES) {
    const SZ = `${W}x${H}`;
    results[SZ] = results[SZ] || {};
    for (const PART of PARTS) {
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      await page.clock.setFixedTime(new Date('2026-09-16T10:00:00'));
      const errors = [];
      page.on('pageerror', (e) => { errors.push(e.message); console.error(`  pageerror: ${e.message}`); });
      const sleep = (ms) => page.waitForTimeout(ms);
      const park = () => page.mouse.move(W - 70, 12);
      const shot = async (name) => {
        // Every state photographed (or not): the word "Main" anywhere the
        // page shows (VW1m: there is no main item, so it should be nowhere).
        const main = await page.evaluate(() => document.body.innerText.match(/.{0,30}\bMain\b.{0,30}/g) || []);
        R.mainOnScreen = R.mainOnScreen || {};
        R.mainOnScreen[name] = main;
        if (!SHOTS) return;
        await sleep(250);
        const file = `po-vw1m-${name}-${SZ}.png`;
        await page.screenshot({ path: join(OUT, file) });
        console.log(`  ${file}`);
      };
      const must = async (loc, what) => {
        try {
          await loc.first().waitFor({ state: 'visible', timeout: 10000 });
        } catch {
          await page.screenshot({ path: join(OUT, `po-vw1m-debug-${PART}-${SZ}.png`) });
          throw new Error(`not found: ${what} (the screen then: po-vw1m-debug-${PART}-${SZ}.png)`);
        }
        return loc.first();
      };
      const click = async (loc, what) => { await (await must(loc, what)).click(); };
      // The in-page measures share `inViewIn`: put it on the page first.
      const measure = async (fn, arg) => {
        await page.evaluate(`window.inViewIn = ${inViewIn.toString()}`);
        return page.evaluate(fn, arg);
      };
      const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
      const button = (name, root = page) => root.getByRole('button', { name, exact: true }).first();
      const open = async (query = '') => {
        await page.goto(`http://localhost:${PORT}/rabbit${query}`, { waitUntil: 'networkidle' });
        await page.addStyleTag({ content: quietCss });
        await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }), 'Salt Hours');
        await sleep(500);
      };
      const openTask = async (title) => {
        const row = page.locator('tr.rb-task-row').filter({ has: page.getByRole('button', { name: `Open ${title}`, exact: true }) }).first();
        await must(row, `the row of ${title}`);
        await row.scrollIntoViewIfNeeded();
        await row.hover();
        await click(row.getByRole('button', { name: `Open ${title}`, exact: true }), `Open ${title}`);
        const win = page.getByRole('dialog', { name: title, exact: true });
        await must(win, `the window of ${title}`);
        await sleep(300);
        return win;
      };
      const closeWindow = async (win) => {
        const done = win.getByRole('button', { name: /^(Done|Close)$/ }).first();
        if (await done.count()) await done.click(); else await page.keyboard.press('Escape');
        await sleep(300);
      };
      const toTasksTable = async () => {
        await click(tab('Tasks'), 'the Tasks tab');
        await sleep(400);
        await click(tab('Table'), 'the Table view');
        await must(page.locator('.ui-table.rb-task-table'), 'the Tasks table');
      };
      // "Final mix" loses its only asset (Score & Foley) through its window's
      // Remove and the last-item question: a task with no asset, in this page.
      const makeAssetless = async (title) => {
        await toTasksTable();
        await page.locator('select[aria-label="Group"]').selectOption('').catch(() => {});
        await sleep(300);
        const win = await openTask(title);
        const row = win.locator('.rb-rel-items .rb-rel-row').first();
        const name = (await row.locator('.rb-rel-name').textContent()).trim();
        await row.hover();
        await click(row.getByRole('button', { name: `Remove ${name}`, exact: true }), `Remove ${name}`);
        const q = page.getByRole('dialog', { name: 'Remove the last item' });
        await must(q, 'the last-item question');
        await click(button('Remove', q), 'the question\'s Remove');
        await sleep(400);
        const left = await win.locator('.rb-rel-items .rb-rel-row').count();
        await closeWindow(win);
        return { task: title, removed: name, itemsLeft: left };
      };
      const groupTasksBy = async (value) => {
        await page.locator('select[aria-label="Group"]').selectOption(value);
        await sleep(400);
      };
      const timelineGroup = async (title) => {
        await click(tab('Timeline'), 'the Timeline tab');
        await must(page.locator('[title="Center the detail timeline on today"]'), 'the Timeline toolbar');
        await sleep(500);
        await click(page.locator(`[title="${title}"]`), title);
        await sleep(600);
      };
      const scrollRowIntoView = async (sel, text) => {
        await page.evaluate(([s, t]) => {
          const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t || e.querySelector('.rb-tl-row-label, .rb-task-group-label')?.textContent.trim() === t);
          el?.scrollIntoView({ block: 'center', inline: 'nearest' });
        }, [sel, text]);
        await sleep(300);
      };
      const R = (results[SZ][PART] = {});
      try {
        // ── 01, 02: task 18's window, its Sort ─────────────────────────────
        if (PART === 'window') {
          await open();
          await toTasksTable();
          const win = await openTask(TASK18);
          await must(win.locator('.rb-rel-items'), 'the Items table');
          R.atOpen = await measure(measureWindow, TASK18);
          // Hover the first asset row: its Remove shows.
          const firstRow = win.locator('.rb-rel-items .rb-rel-row').first();
          await firstRow.hover();
          await sleep(200);
          R.hoveredRow = await firstRow.evaluate((r) => {
            const b = [...r.querySelectorAll('button')].find((x) => /^Remove /.test(x.getAttribute('aria-label') || x.getAttribute('title') || ''));
            if (!b) return { remove: null };
            let op = 1;
            for (let e = b; e && e !== r.parentElement; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
            return { name: r.querySelector('.rb-rel-name')?.textContent.trim(), remove: b.getAttribute('aria-label') || b.getAttribute('title'), opacity: op, visible: b.getClientRects().length > 0 && op > 0.5 };
          });
          // A row not hovered: its Remove hidden?
          R.unhoveredRow = await win.locator('.rb-rel-items .rb-rel-row').nth(1).evaluate((r) => {
            const b = [...r.querySelectorAll('button')].find((x) => /^Remove /.test(x.getAttribute('aria-label') || x.getAttribute('title') || ''));
            if (!b) return { remove: null };
            let op = 1;
            for (let e = b; e && e !== r.parentElement; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
            return { name: r.querySelector('.rb-rel-name')?.textContent.trim(), opacity: op };
          });
          await shot('01-task-window');

          // 02: the Sort menu open.
          const sortBtn = win.locator('button[title^="Sort items"]').first();
          await click(sortBtn, 'the Items head\'s Sort');
          await must(page.locator('.ui-menu'), 'the Sort menu');
          await page.mouse.move(W - 40, H - 40);
          R.sortMenu = await measure(measureMenu);
          await shot('02-sort-menu');
          // 02b: A to Z chosen.
          await click(page.locator('.ui-menu .ui-menu-item', { hasText: 'A to Z' }), 'A to Z');
          await sleep(400);
          await page.mouse.move(W - 40, H - 40);
          R.afterAtoZ = await measure(measureWindow, TASK18);
          R.afterAtoZ.menuStillOpen = (await measure(measureMenu)) !== null;
          const names = R.afterAtoZ.rows.map((r) => r.name);
          const sorted = [...names].sort(new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare);
          R.afterAtoZ.rowsAreAtoZ = JSON.stringify(names) === JSON.stringify(sorted);
          R.afterAtoZ.filesFollowSort = JSON.stringify(R.afterAtoZ.files.map((f) => f.label.replace(/^[^:]+:\s*/, ''))) === JSON.stringify(names);
          await shot('02b-sort-a-to-z');
          // The menu again: A to Z now checked.
          await click(win.locator('button[title^="Sort items"]').first(), 'the Sort again');
          await must(page.locator('.ui-menu'), 'the Sort menu again');
          R.sortMenuAfter = await measure(measureMenu);
          await page.keyboard.press('Escape');
          await sleep(200);
          // Date added, for the record (no picture).
          await click(win.locator('button[title^="Sort items"]').first(), 'the Sort a third time');
          await click(page.locator('.ui-menu .ui-menu-item', { hasText: 'Date added' }), 'Date added');
          await sleep(300);
          await page.mouse.move(W - 40, H - 40);
          R.afterDateAdded = (await measure(measureWindow, TASK18)).rows.map((r) => r.name);
          await shot('02c-sort-date-added');
          // Each Files section opened in turn (no picture): its label, its
          // "Files (n)" and the names it lists — a scene's and a shot's
          // section list THEIR files (they passed their id as an asset's).
          R.filesBySection = [];
          const heads = win.locator('.rb-task-section-head');
          for (let i = 0; i < await heads.count(); i++) {
            const h = heads.nth(i);
            if ((await h.getAttribute('aria-expanded')) !== 'true') { await h.click(); await sleep(400); }
            R.filesBySection.push(await h.evaluate((el) => {
              const s = el.closest('.rb-task-section');
              const body = s.querySelector('.rb-task-section-body');
              const count = (body?.textContent.match(/Files\s*\(\d+\)/i) || [null])[0];
              const names = body ? [...body.querySelectorAll('tbody tr')].map((tr) => (tr.querySelector('[title]')?.getAttribute('title') || tr.textContent).trim().slice(0, 50)) : [];
              const empty = body ? /No files yet/.test(body.textContent) : null;
              return { label: s.querySelector('.rb-task-section-label')?.textContent.trim(), count, names, empty };
            }));
          }
          // ?fixtures=game: task 18 on two levels and an experience too, where
          // A to Z and Type differ.
          await open('?fixtures=game');
          await toTasksTable();
          const g = await openTask(TASK18);
          const choose = async (label) => {
            await click(g.locator('button[title^="Sort items"]').first(), 'the Sort (game)');
            await click(page.locator('.ui-menu .ui-menu-item', { hasText: label }), label);
            await sleep(300);
            await page.mouse.move(W - 40, H - 40);
          };
          await choose('Type');
          const gt = await measure(measureWindow, TASK18);
          R.game = { type: gt.rows.map((r) => `${r.kind}: ${r.name}`), typeKindLabels: gt.kindLabels, files: gt.files.map((f) => f.label) };
          await choose('A to Z');
          const ga = await measure(measureWindow, TASK18);
          R.game.aToZ = ga.rows.map((r) => `${r.kind}: ${r.name}`);
          R.game.aToZFiles = ga.files.map((f) => f.label);
          await shot('02d-sort-a-to-z-game');
        }

        // ── 03: the Tasks table grouped by Asset ───────────────────────────
        if (PART === 'tasks') {
          await open();
          await toTasksTable();
          await groupTasksBy('asset');
          await must(page.locator('.rb-task-group-row'), 'a group row');
          await park();
          R.asIs = await measure(measureTasksTable);
          await shot('03-tasks-by-asset');
          const combo = R.asIs.groups.find((g) => g.tasks.some((t) => t.title === TASK18));
          if (combo) {
            await scrollRowIntoView('.rb-task-group-row', combo.label);
            await park();
            R.asIsScrolled = (await measure(measureTasksTable)).groups.map((g) => ({ label: g.label, inView: g.inView }));
            await shot('03b-tasks-by-asset-combination');
          }
          R.madeAssetless = await makeAssetless(LOSES_ASSET);
          await toTasksTable();
          await groupTasksBy('asset');
          await must(page.locator('.rb-task-group-row'), 'a group row');
          R.afterAssetless = await measure(measureTasksTable);
          await scrollRowIntoView('.rb-task-group-row', R.afterAssetless.groups[R.afterAssetless.groups.length - 1].label);
          await park();
          R.afterAssetlessScrolled = (await measure(measureTasksTable)).groups.map((g) => ({ label: g.label, inView: g.inView }));
          await shot('03c-tasks-by-asset-no-asset');
        }

        // ── 04: the Board grouped by asset ─────────────────────────────────
        if (PART === 'board') {
          await open();
          await click(tab('Tasks'), 'the Tasks tab');
          await click(tab('Board'), 'the Board view');
          await groupTasksBy('asset');
          await must(page.locator('.rb-task-col'), 'a Board column');
          await park();
          R.columns = await measure(measureBoard);
          await shot('04-board-by-asset');
          const combo = R.columns.find((c) => c.cards.some((k) => k.title === TASK18));
          if (combo) {
            // To the end: the combination column and No asset after it.
            await page.evaluate(() => {
              const cols = document.querySelectorAll('.rb-task-col');
              cols[cols.length - 1]?.scrollIntoView({ block: 'nearest', inline: 'end' });
            });
            await sleep(300);
            await park();
            R.scrolled = (await measure(measureBoard)).map((c) => ({ label: c.label, inView: c.inView }));
            await shot('04b-board-by-asset-combination');
          }
        }

        // ── 05: the Timeline grouped by asset ──────────────────────────────
        if (PART === 'timeline') {
          await open();
          await timelineGroup('Group by asset');
          R.asIs = await measure(measureTimeline);
          const t18 = R.asIs.find((r) => r.shape === 'task' && r.label === TASK18);
          if (t18?.group) await scrollRowIntoView('.rb-tl-row', t18.group);
          await park();
          R.asIsInView = (await measure(measureTimeline)).filter((r) => r.inView).map((r) => `${r.shape}:${r.label}${r.bar ? ' [bar]' : ''}`);
          await shot('05-timeline-by-asset');
          // A combination's header opens nothing (no picture): click its
          // label and see whether any window comes up.
          if (t18?.group) {
            const before = await page.locator('[role="dialog"]').count();
            await page.locator('.rb-tl-row', { has: page.locator('.rb-tl-row-label', { hasText: t18.group }) }).first().click();
            await sleep(500);
            const after = await page.locator('[role="dialog"]').count();
            R.comboHeaderClick = { opened: after > before, dialogs: await page.locator('[role="dialog"]').evaluateAll((ds) => ds.map((d) => d.getAttribute('aria-label') || d.querySelector('h1,h2,h3')?.textContent.trim() || '(unnamed)')) };
            if (after > before) { await page.keyboard.press('Escape'); await sleep(300); }
          }
          R.madeAssetless = await makeAssetless(LOSES_ASSET);
          await timelineGroup('Group by asset');
          R.afterAssetless = await measure(measureTimeline);
          const last = R.afterAssetless.filter((r) => r.shape !== 'task').pop();
          if (last) await scrollRowIntoView('.rb-tl-row', last.label);
          await park();
          R.afterAssetlessInView = (await measure(measureTimeline)).filter((r) => r.inView).map((r) => `${r.shape}:${r.label}${r.bar ? ' [bar]' : ''}`);
          await shot('05c-timeline-by-asset-no-asset');
        }

        // ── 06: the Budget's By asset and By phase ─────────────────────────
        if (PART === 'budget') {
          await open();
          // What the Tasks table shows: each task's assets and bid, for an
          // independent even split.
          await toTasksTable();
          const table = await page.evaluate(() => {
            const t = document.querySelector('.ui-table.rb-task-table');
            const ths = [...t.querySelectorAll(':scope > thead > tr > th')].map((th) => th.textContent.trim());
            return [...t.querySelectorAll(':scope > tbody > tr.rb-task-row')].map((tr) => {
              const b = [...tr.querySelectorAll('button')].map((x) => x.getAttribute('aria-label') || x.getAttribute('title') || '').find((n) => /^Open /.test(n));
              const cell = (h) => {
                const td = tr.children[ths.indexOf(h)];
                if (!td) return null;
                const inp = td.querySelector('input');
                return inp ? inp.value : td.textContent.trim();
              };
              return { title: b ? b.slice(5) : null, asset: cell('Asset'), bid: cell('Bid') };
            });
          });
          const expected = {};
          for (const r of table) {
            const names = (r.asset || '').split(', ').filter(Boolean);
            const bid = num(r.bid) || 0;
            if (!names.length) expected['No asset'] = (expected['No asset'] || 0) + bid;
            for (const n of names) expected[n] = (expected[n] || 0) + bid / names.length;
          }
          R.tasksTableSeen = table.filter((r) => r.title === TASK18 || /,/.test(r.asset || ''));
          R.expectedSplitFromTasksTable = Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, Math.round(v * 100) / 100]));
          await click(tab('Budget'), 'the Budget tab');
          await must(page.locator('.rb-budget-stat'), 'the Summary\'s tiles');
          R.summary = await measure(measureBudgetSummary);
          await click(tab('By asset'), 'By asset');
          await must(page.locator('.rb-budget-report'), 'the By asset table');
          await park();
          R.byAsset = checkReport(await measure(measureBudgetReport), R.summary);
          R.byAsset.vsExpected = R.byAsset.rows.map((r) => ({ name: r.name, bid: num(r.bid), expected: R.expectedSplitFromTasksTable[r.name] ?? null }))
            .filter((r) => r.expected == null || Math.abs(r.bid - Math.round(r.expected * 10) / 10) > 0.051);
          await shot('06-budget-by-asset');
          await click(tab('By phase'), 'By phase');
          await must(page.locator('.rb-budget-report'), 'the By phase table');
          await park();
          R.byPhase = checkReport(await measure(measureBudgetReport), R.summary);
          await shot('06b-budget-by-phase');
          R.madeAssetless = await makeAssetless(LOSES_ASSET);
          await click(tab('Budget'), 'the Budget tab');
          await must(page.locator('.rb-budget-stat'), 'the Summary\'s tiles');
          R.summaryAfterAssetless = await measure(measureBudgetSummary);
          await click(tab('By asset'), 'By asset');
          await must(page.locator('.rb-budget-report'), 'the By asset table');
          await park();
          R.byAssetAfterAssetless = checkReport(await measure(measureBudgetReport), R.summaryAfterAssetless);
          // Down to the table's last rows: No asset is the last.
          await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.rb-budget-report tbody tr')];
            rows[rows.length - 1]?.scrollIntoView({ block: 'end' });
          });
          await sleep(300);
          await park();
          await shot('06c-budget-by-asset-no-asset');
        }

        // ── 07: ?fixtures=game, the Timeline grouped by level ──────────────
        if (PART === 'level') {
          await open('?fixtures=game');
          await timelineGroup('Group by level');
          R.rows = await measure(measureTimeline);
          const t18 = R.rows.find((r) => r.shape === 'task' && r.label === TASK18);
          if (t18?.group) await scrollRowIntoView('.rb-tl-row', t18.group);
          await park();
          R.inView = (await measure(measureTimeline)).filter((r) => r.inView).map((r) => `${r.shape}:${r.label}${r.bar ? ' [bar]' : ''}`);
          await shot('07-timeline-by-level-game');
          // Headers that only group open nothing (no "Edit phase" on a
          // stand-in): the combination's, No level's, a single level's.
          R.headerClicks = {};
          for (const label of [t18?.group, 'No level', 'Cliff Path'].filter(Boolean)) {
            const row = page.locator('.rb-tl-row', { has: page.locator('.rb-tl-row-label', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first();
            if (!(await row.count())) { R.headerClicks[label] = 'row not found'; continue; }
            await row.scrollIntoViewIfNeeded();
            const before = await page.locator('[role="dialog"]').count();
            await row.click();
            await sleep(500);
            const dialogs = await page.locator('[role="dialog"]').evaluateAll((ds) => ds.map((d) => d.getAttribute('aria-label') || d.querySelector('h1,h2,h3')?.textContent.trim() || '(unnamed)'));
            R.headerClicks[label] = { opened: dialogs.length > before, dialogs };
            if (dialogs.length > before) { await page.keyboard.press('Escape'); await sleep(300); }
          }
        }

        // ── 08: the Dashboard's My tasks ───────────────────────────────────
        if (PART === 'dashboard') {
          await page.goto(`http://localhost:${PORT}/dashboard`, { waitUntil: 'networkidle' });
          await page.addStyleTag({ content: quietCss });
          const myTasks = tab('My tasks');
          if (await myTasks.count()) await myTasks.click();
          await must(page.locator('table[aria-label="My tasks across every project"]'), 'the My tasks table');
          await sleep(500);
          await park();
          R.asIs = await measure(measureDashboard);
          R.task18 = R.asIs.rows?.find((r) => Object.values(r).includes(TASK18)) || 'not one of the tester\'s tasks (task 18: assignee Kenji, reviewer Priya)';
          await shot('08-dashboard');
          // The tester's tasks are each about one asset in the fixtures, and
          // the Dashboard loads once per app session (every page is mounted
          // at start; its refresh rides the cloud's workspace channel), so a
          // second asset added in this page never reaches it: the "A, B"
          // case is recorded as not reachable here.
          R.multiAssetRows = (R.asIs.rows || []).filter((r) => /,/.test(r.Asset || ''));
        }
      } catch (e) {
        R.error = e.message;
        console.error(`  ${PART} ${SZ}: ${e.message}`);
      }
      R.pageErrors = errors;
      console.log(`=== ${PART} ${SZ} done`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  writeFileSync(JSON_PATH, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${JSON_PATH}`);
}
