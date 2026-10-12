#!/usr/bin/env node
/**
 * FX7's two rows, photographed and measured before and after — post-overhaul
 * FX7 (2026-10-12): the Timeline's PROJECT and BID VER. labels in one size
 * and colour, in one column, the project standing out, no folder icon.
 *
 *   node scripts/fx7-shots.mjs <port> --out <dir> --phase before|after [--size 1440x900] [--no-shots] [--check]
 *
 * --check (FX7 review round 1, R1-01: the unit tests pin rules, this pins the
 * result): exits 1 unless, in every state, nothing stands before PROJECT,
 * both labels are the kit's `ui-field-label` on the gutter with the same
 * computed size, line height, weight, tracking, case and ink, the project's
 * name and the dropdown start at one x, neither row overflows, and the
 * project's name is the one name at 600 (the dropdown's value and the
 * version's name in the words at 400). Each failure is printed.
 *
 * Walks walkthrough 69 on the dev fixtures' Salt Hours: the Timeline's first
 * screen under the lock, back to bidding (Current, nothing open), a bid
 * version viewed, a version open, a change made ("● Unsaved"), and the Tasks
 * tab (the project title bar is every tab's). At each it prints the two rows
 * measured: each label's box, size, weight, tracking, case and ink; each
 * value's left edge, size, weight and ink; the gap from label to value; what
 * sits before PROJECT; the bar's parts' widths (S5d's and FX3's numbers);
 * and whether either row overflows. Each picture is the whole window
 * (`…-<W>x<H>.png`) and the two rows cropped (`…-rows-<W>x<H>.png`).
 *
 * Each file is `po-fx7-<phase>-<nn>-<state>[-rows]-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1. Changes nothing that outlives the page: the fixture
 * store is in memory and the browser context is fresh per run. Animations and
 * transitions are off and the caret transparent, in this page only. A state
 * whose control is not found stops the run and says which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--phase'].includes(args[i - 1])) || '5295';
const OUT = flag('--out');
const PHASE = flag('--phase');
const SHOTS = !args.includes('--no-shots');
const CHECK = args.includes('--check');
const failures = [];
if (!OUT || !['before', 'after'].includes(PHASE)) {
  console.error('usage: fx7-shots.mjs <port> --out <dir> --phase before|after [--size WxH] [--no-shots] [--check]');
  process.exit(1);
}
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.clock.setFixedTime(new Date('2026-10-12T14:02:00'));
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  const quietCss = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  const sleep = (ms) => page.waitForTimeout(ms);
  let n = 0;
  const must = async (loc, what) => {
    try {
      await loc.waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      await page.screenshot({ path: join(OUT, `debug-not-found-${W}x${H}.png`) });
      throw new Error(`not found: ${what} (the screen then: debug-not-found-${W}x${H}.png)`);
    }
    return loc;
  };
  const click = async (loc, what) => { await (await must(loc, what)).click(); };
  const button = (name, root = page) => root.getByRole('button', { name, exact: true }).first();
  const dialog = (name) => page.getByRole('dialog', { name, exact: true });
  const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
  const verBar = () => page.locator('.rb-tl-ver-bar');
  const verSelect = () => verBar().getByRole('combobox', { name: 'Bid version' });

  // The two rows, measured. Before FX7 the project's label is `.rb-ctx-eyebrow`
  // after a folder icon; after, the kit's `.ui-field-label` the bar's label
  // wears. Everything is read from the browser's own layout and styles.
  const measure = async (state) => {
    const m = await page.evaluate(() => {
      const r = (e) => (e ? e.getBoundingClientRect() : null);
      const px = (v) => Math.round(v * 10) / 10;
      const title = document.querySelector('.ui-toolbar.rb-ctx');
      const slot = title?.querySelector('.ui-toolbar-slot');
      const pLabel = title?.querySelector('.ui-field-label') || title?.querySelector('.rb-ctx-eyebrow');
      const pValue = title?.querySelector('.rb-ctx-title');
      const bar = document.querySelector('.rb-tl-ver-bar');
      const vLabel = bar?.querySelector(':scope > .ui-field-label');
      const vValue = bar?.querySelector('.rb-tl-ver-select');
      const type = (e) => {
        if (!e) return null;
        const s = getComputedStyle(e);
        return { size: s.fontSize, lineHeight: s.lineHeight, weight: s.fontWeight, tracking: s.letterSpacing, case: s.textTransform, ink: s.color };
      };
      const vName = bar?.querySelector('.rb-tl-ver-name');
      const label = (e) => e && { text: e.textContent, cls: e.className, x: px(r(e).left), w: px(r(e).width), right: px(r(e).right), ...type(e) };
      const value = (e) => e && { x: px(r(e).left), w: px(r(e).width), ...type(e), text: e.tagName === 'SELECT' ? e.selectedOptions[0]?.textContent : e.textContent };
      // What sits before the project's label in its row (the folder icon, before FX7).
      const before = [];
      for (const c of slot ? [...slot.children] : []) { if (c === pLabel) break; before.push(`${c.tagName.toLowerCase()}.${c.getAttribute('class') || ''}`); }
      const w = (sel) => { const e = bar?.querySelector(sel); return e ? px(r(e).width) : null; };
      const verbs = bar?.querySelector('.rb-tl-ver-verbs');
      const state = bar?.querySelector('.rb-tl-ver-state');
      return {
        project: { before, label: label(pLabel), value: value(pValue), gap: pLabel && pValue ? px(r(pValue).left - r(pLabel).right) : null,
          rowH: title ? px(r(title).height) : null, overflow: title ? title.scrollWidth - title.clientWidth : null },
        version: bar ? { label: label(vLabel), value: value(vValue), gap: vLabel && vValue ? px(r(vValue).left - r(vLabel).right) : null,
          mode: bar.dataset.mode, rowH: px(r(bar).height), overflow: bar.scrollWidth - bar.clientWidth,
          words: state ? { w: px(r(state).width), natural: state.scrollWidth, clipped: state.scrollWidth > state.clientWidth + 0.5, text: state.textContent } : null,
          name: vName ? type(vName) : null,
          leadInk: bar?.querySelector('.rb-tl-ver-lead') ? getComputedStyle(bar.querySelector('.rb-tl-ver-lead')).color : null,
          select: w('.rb-tl-ver-select'), verbs: verbs ? px(r(verbs).width) : null, verbsRight: verbs ? px(r(verbs).right) : null, barRight: px(r(bar).right),
          buttons: verbs ? [...verbs.querySelectorAll('button')].map((b) => `${b.textContent.trim()} ${px(r(b).width)}`) : [] } : null,
        valuesAligned: pValue && vValue ? px(r(vValue).left - r(pValue).left) : null,
        labelsAligned: pLabel && vLabel ? px(r(vLabel).left - r(pLabel).left) : null,
        titleBottom: title ? px(r(title).bottom) : null, barTop: bar ? px(r(bar).top) : null,
        ganttTop: document.querySelector('.rb-tl-gantt') ? px(r(document.querySelector('.rb-tl-gantt')).top) : null,
      };
    });
    console.log(`  measured (${state}): ${JSON.stringify(m)}`);
    if (CHECK) {
      // Absolute values (review round 2, R2-01: comparing the two labels with
      // each other let a rule recolour or resize both names unseen). The
      // kit's: the Label step 11px at 600, 0.66px tracking, uppercase, the
      // second ink; the Title step 14px at 600 in the ink; the Dense step 13px
      // at 400. A missing element is a failure, not a crash (R2-05).
      const INK = 'rgb(245, 240, 236)';
      const INK2 = 'rgb(184, 180, 176)';
      const fail = (what) => failures.push(`${state} at ${W}x${H}: ${what}`);
      const is = (what, got, want) => { if (got !== want) fail(`${what} is ${got}, not ${want}`); };
      const p = m.project;
      const v = m.version;
      if (!p.label) fail('no PROJECT label');
      if (!p.value) fail('no project name');
      if (p.before.length) fail(`something before PROJECT: ${p.before.join(', ')}`);
      is("PROJECT's class", p.label?.cls, 'ui-field-label');
      is("PROJECT's x", p.label?.x, 24);
      for (const [k, want] of [['size', '11px'], ['weight', '600'], ['tracking', '0.66px'], ['case', 'uppercase'], ['ink', INK2]]) is(`PROJECT's ${k}`, p.label?.[k], want);
      for (const [k, want] of [['size', '14px'], ['weight', '600'], ['ink', INK]]) is(`the project's name's ${k}`, p.value?.[k], want);
      if (p.overflow) fail(`the title bar overflows by ${p.overflow}px`);
      if (v) {
        if (!v.label) fail('no BID VER. label');
        if (!v.value) fail('no dropdown');
        is("BID VER.'s class", v.label?.cls, 'ui-field-label');
        for (const k of ['size', 'lineHeight', 'weight', 'tracking', 'case', 'ink']) is(`BID VER.'s ${k} (PROJECT's)`, v.label?.[k], p.label?.[k]);
        is("the labels' offset", m.labelsAligned, 0);
        if (!(Math.abs(m.valuesAligned) < 0.5)) fail(`the values start ${m.valuesAligned}px apart`);
        if (v.overflow) fail(`the version bar overflows by ${v.overflow}px`);
        for (const [k, want] of [['size', '13px'], ['weight', '400']]) is(`the dropdown's ${k}`, v.value?.[k], want);
        if (v.name) {
          for (const [k, want] of [['size', '13px'], ['weight', '400'], ['ink', INK]]) is(`the version's name's ${k}`, v.name[k], want);
          if (v.name.ink === v.leadInk) fail(`the version's name has the lead's ink, ${v.leadInk}`);
        }
      }
    }
    return m;
  };
  const shot = async (state) => {
    n += 1;
    await page.mouse.move(W - 70, H - 12);
    await sleep(300);
    const m = await measure(state);
    if (!SHOTS) return;
    const base = `po-fx7-${PHASE}-${String(n).padStart(2, '0')}-${state}`;
    await page.screenshot({ path: join(OUT, `${base}-${W}x${H}.png`) });
    // The two rows, cropped: from the tab bar's foot to the bar's foot (the
    // title row alone on a tab without the bar), the window's full width.
    const clip = await page.evaluate(() => {
      const title = document.querySelector('.ui-toolbar.rb-ctx').getBoundingClientRect();
      const bar = document.querySelector('.rb-tl-ver-bar');
      const bottom = bar ? bar.getBoundingClientRect().bottom : title.bottom;
      return { x: 0, y: Math.max(0, Math.floor(title.top) - 8), width: window.innerWidth, height: Math.ceil(bottom - title.top) + 16 };
    });
    await page.screenshot({ path: join(OUT, `${base}-rows-${W}x${H}.png`), clip });
    console.log(`  ${base}-${W}x${H}.png, ${base}-rows-${W}x${H}.png`);
    return m;
  };
  const toTimeline = async () => {
    await click(tab('Timeline'), 'the Timeline tab');
    await must(verBar(), 'the bid version bar');
    await sleep(400);
  };
  const pickVersion = async (prefix) => {
    const sel = await must(verSelect(), 'the Bid version dropdown');
    const value = await sel.evaluate((s, p) => [...s.options].find((o) => o.textContent.startsWith(p))?.value, prefix);
    if (!value) throw new Error(`no version named ${prefix}`);
    await sel.selectOption(value);
    await sleep(400);
  };
  const dismissToast = async () => {
    const dismiss = page.getByTitle('Dismiss').first();
    if (await dismiss.isVisible().catch(() => false)) { await dismiss.click(); await sleep(200); }
  };

  await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: quietCss });
  await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
  await sleep(600);
  await toTimeline();
  await shot('locked');
  await click(tab('Budget'), 'the Budget tab');
  await click(button('Reset to bidding'), 'Reset to bidding');
  await must(page.getByText(/^Back to bidding/).first(), 'the reset toast');
  await toTimeline();
  await dismissToast();
  await shot('bidding');
  await pickVersion('Bid v1');
  await must(verBar().locator('.rb-tl-ver-state', { hasText: /^Viewing bid version/ }), 'the viewing words');
  await shot('viewing-bid-v1');
  await click(button('Edit this version', verBar()), 'the bar\'s Edit this version');
  const pre = dialog('Save what the Timeline shows first?');
  if (await pre.isVisible().catch(() => false)) await click(button('Discard', pre), 'Discard');
  const q = page.getByRole('dialog').filter({ hasText: 'Edit' }).last();
  await must(q, 'the Edit question');
  await click(button('Edit this version', q), 'the question\'s Edit this version');
  await must(verBar().locator('.rb-tl-ver-state', { hasText: /^Open: / }), 'the version open');
  await dismissToast();
  await shot('open-bid-v1');
  // A drag: a task bar on screen, one day later, so the open version reads
  // "Unsaved changes" and Save carries "● Unsaved" (S5d's recipe).
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
  const extend = page.getByRole('button', { name: /^Clamp/ }).first();
  if (await extend.isVisible().catch(() => false)) { await extend.click(); await sleep(400); }
  await must(verBar().locator('.rb-tl-ver-status', { hasText: 'Unsaved changes' }), 'Unsaved changes');
  await dismissToast();
  await shot('unsaved');
  // The project title bar is every tab's: the Tasks tab shows it alone.
  await click(tab('Tasks'), 'the Tasks tab');
  const leave = page.getByRole('dialog').filter({ hasText: /unsaved|Unsaved/ }).last();
  if (await leave.isVisible().catch(() => false)) {
    const stay = leave.getByRole('button', { name: /^(Leave|Discard|Keep|Continue)/ }).first();
    if (await stay.isVisible().catch(() => false)) await stay.click();
  }
  await must(page.locator('.ui-toolbar.rb-ctx'), 'the project title bar on Tasks');
  await sleep(400);
  await shot('tasks-tab');
  if (CHECK) {
    // A member (below the money gate): the Timeline draws no version bar;
    // the title bar's PROJECT is the same label (R2-05).
    await page.goto(`http://localhost:${PORT}/rabbit?fixtures=member`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: quietCss });
    await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours (a member)');
    await sleep(600);
    await click(tab('Timeline'), 'the Timeline tab (a member)');
    await must(page.locator('.rb-tl-gantt'), "the member's gantt");
    await sleep(400);
    const mm = await measure('member-timeline');
    if (mm.version) failures.push(`member-timeline at ${W}x${H}: a member sees the version bar`);
  }
} finally {
  await browser.close();
}
if (CHECK) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(`check at ${W}x${H}: ${failures.length ? `${failures.length} failure(s)` : 'every state holds'}`);
  if (failures.length) process.exit(1);
}
