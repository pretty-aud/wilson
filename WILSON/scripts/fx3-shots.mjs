#!/usr/bin/env node
/**
 * FX3's four fixes, photographed before and after — post-overhaul FX3 (2026-10-11).
 *
 *   node scripts/fx3-shots.mjs <port> --out <dir> --phase before|after [--size 1440x900] [--part banner|versionbar|saveas|team|all]
 *
 * Walks walkthrough 66's four sections on the dev fixtures' Salt Hours (and,
 * for levels and experiences, `?fixtures=game`):
 *
 *   banner      the six item popups — asset, task, scene, shot, level,
 *               experience — each with what sits under its title; after, the
 *               task popup's status changed (the banner recolours) and Ctrl+Z
 *               (it recolours back).
 *   versionbar  the Timeline's first screen: under the lock, back to bidding,
 *               a bid version viewed, a version open; and the bar's measured
 *               widths and where it sits relative to the project title and
 *               the toolbar (the numbers the hand-off quotes).
 *   saveas      the Scenes tab's shot-list bar and the dialog its button opens.
 *   team        the Team tab: the table; after, the switch and the gallery,
 *               a card with the keyboard's focus.
 *
 * Each file is `po-fx3-<phase>-<part>-<nn>-<state>-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1 (the `fx3-worktree` entry in .claude/launch.json sets
 * both). Changes nothing that outlives the page: the fixture store is in
 * memory and the browser context is fresh per run. Animations and
 * transitions are off and the caret transparent, in this page only. A state
 * whose control is not found stops the run and says which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--phase', '--part'].includes(args[i - 1])) || '5292';
const OUT = flag('--out');
const PHASE = flag('--phase');
if (!OUT || !['before', 'after'].includes(PHASE)) {
  console.error('usage: fx3-shots.mjs <port> --out <dir> --phase before|after [--size WxH] [--part banner|versionbar|saveas|team|all]');
  process.exit(1);
}
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PARTS = (flag('--part') || 'all') === 'all' ? ['banner', 'versionbar', 'saveas', 'team'] : [flag('--part')];
for (const p of PARTS) if (!['banner', 'versionbar', 'saveas', 'team'].includes(p)) { console.error(`unknown part ${p}`); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  for (const PART of PARTS) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.clock.setFixedTime(new Date('2026-10-11T14:02:00'));
    page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
    const quietCss = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    const sleep = (ms) => page.waitForTimeout(ms);
    let n = 0;
    const shot = async (state, { hover = true } = {}) => {
      n += 1;
      if (hover) await page.mouse.move(W - 70, 12);
      await sleep(300);
      const file = `po-fx3-${PHASE}-${PART}-${String(n).padStart(2, '0')}-${state}-${W}x${H}.png`;
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
    const button = (name, root = page) => root.getByRole('button', { name, exact: true }).first();
    const dialog = (name) => page.getByRole('dialog', { name, exact: true });
    const anyDialog = () => page.locator('.ui-dialog').last();
    const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
    const open = async (query = '') => {
      await page.goto(`http://localhost:${PORT}/rabbit${query}`, { waitUntil: 'networkidle' });
      await page.addStyleTag({ content: quietCss });
      await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
      await sleep(600);
    };
    // A row's hover-only action: the row hovered first, then its button.
    const rowAction = async (name, what) => {
      const b = page.getByRole('button', { name, exact: true }).first();
      await b.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
      const row = b.locator('xpath=ancestor::*[self::tr or contains(@class,"card") or contains(@class,"row")][1]');
      if (await row.count()) await row.hover().catch(() => {});
      await click(b, what);
      await must(anyDialog(), `${what}: its popup`);
      await sleep(400);
    };
    const closeDialog = async () => { await page.keyboard.press('Escape'); await sleep(300); };
    // What sits under a popup's title, measured: the subtitle badge (before)
    // or the banner (after), its box and its tone.
    const underTitle = async (label) => {
      const m = await page.evaluate(() => {
        const d = [...document.querySelectorAll('.ui-dialog')].pop();
        if (!d) return null;
        const head = d.querySelector('.ui-dialog-head').getBoundingClientRect();
        const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left - d.getBoundingClientRect().left), y: Math.round(r.top - head.top), w: Math.round(r.width), h: Math.round(r.height) }; };
        const banner = d.querySelector('.ui-status-banner');
        const badge = d.querySelector('.ui-dialog-subtitle .ui-status');
        const el = banner || badge;
        return {
          dialogW: Math.round(d.getBoundingClientRect().width), headH: Math.round(head.height),
          kind: banner ? 'banner' : badge ? 'subtitle badge' : 'none',
          box: box(el), tone: el?.getAttribute('data-tone') || null, word: el?.textContent.trim() || null,
          bg: el ? getComputedStyle(el).backgroundColor : null,
        };
      });
      console.log(`  under the title (${label}): ${JSON.stringify(m)}`);
    };

    if (PART === 'banner') {
      await open();
      await click(tab('Assets'), 'the Assets tab');
      await rowAction('View asset details', 'an asset\'s details');
      await underTitle('asset'); await shot('asset');
      await closeDialog();

      await click(tab('Tasks'), 'the Tasks tab');
      await rowAction('View task details', 'a task\'s details');
      await underTitle('task'); await shot('task');
      await closeDialog();
      if (PHASE === 'after') {
        // Live: the Timeline's task popup (the tab whose Ctrl+Z works with its
        // own popup open), after Reset to bidding (the fixture's budget is
        // locked, which makes the Timeline read-only). The status changed in
        // the popup recolours the banner at once; Ctrl+Z puts both back.
        await click(tab('Budget'), 'the Budget tab');
        await click(button('Reset to bidding'), 'Reset to bidding');
        await must(page.getByText(/^Back to bidding/).first(), 'the reset toast');
        await click(tab('Timeline'), 'the Timeline tab');
        await sleep(600);
        // The reset's toast is not these pictures' subject.
        const x0 = page.getByTitle('Dismiss').first();
        if (await x0.isVisible().catch(() => false)) { await x0.click(); await sleep(200); }
        await click(page.locator('[title^="Click to edit"]', { hasText: 'Lock the shooting script' }).first(), 'the task row on the Timeline');
        await must(anyDialog(), 'the Timeline\'s task popup');
        await sleep(400);
        const status = anyDialog().getByRole('combobox', { name: 'Status' }).first();
        await must(status, 'the task popup\'s Status');
        const was = await status.inputValue();
        await status.selectOption(was === 'blocked' ? 'approved' : 'blocked');
        await sleep(400);
        await underTitle('task, status changed'); await shot('task-status-changed');
        // Focus off the field (the dialog's own surface), then Ctrl+Z.
        await anyDialog().locator('.ui-dialog-title').click();
        await page.keyboard.press('Control+z');
        await sleep(600);
        await underTitle('task, after Ctrl+Z'); await shot('task-undone');
        await closeDialog();
        // The reset's toast is not the next pictures' subject.
        const x = page.getByTitle('Dismiss').first();
        if (await x.isVisible().catch(() => false)) { await x.click(); await sleep(200); }
        await click(tab('Tasks'), 'the Tasks tab');
      }

      await click(tab('Scenes'), 'the Scenes tab');
      await sleep(400);
      await rowAction('View details', 'a scene\'s details');
      await underTitle('scene'); await shot('scene');
      await closeDialog();
      await click(tab('Shots'), 'the Shots content tab');
      await sleep(400);
      await rowAction('View details', 'a shot\'s details');
      await underTitle('shot'); await shot('shot');
      await closeDialog();

      await open('?fixtures=game');
      await click(tab('Levels'), 'the Levels tab');
      await rowAction('View details', 'a level\'s details');
      await underTitle('level'); await shot('level');
      await closeDialog();
      await click(tab('Experiences'), 'the Experiences tab');
      await rowAction('View details', 'an experience\'s details');
      await underTitle('experience'); await shot('experience');
      await closeDialog();
    } else if (PART === 'versionbar') {
      const verBar = () => page.locator('.rb-tl-ver-bar');
      const verSelect = () => verBar().getByRole('combobox', { name: 'Bid version' });
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
      // Where the bar sits: its top against the project title's bottom and
      // the Timeline's toolbar; its height; the room its parts take.
      const measure = async (state) => {
        const m = await page.evaluate(() => {
          const r = (e) => e ? e.getBoundingClientRect() : null;
          const bar = document.querySelector('.rb-tl-ver-bar');
          const title = document.querySelector('.rb-ctx-bar, [data-project-context], .rb-project-context') || [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === 'Salt Hours' && e.getBoundingClientRect().top < 260)?.parentElement;
          const tb = [...document.querySelectorAll('.ui-toolbar')].find((t) => t.querySelector('[aria-label="Detail zoom"]'));
          const verbs = bar?.querySelector('.rb-tl-ver-verbs');
          const w = (sel) => { const e = bar?.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().width) : null; };
          return {
            titleBottom: title ? Math.round(r(title).bottom) : null,
            barTop: bar ? Math.round(r(bar).top) : null, barH: bar ? Math.round(r(bar).height) : null, barW: bar ? Math.round(r(bar).width) : null,
            toolbarTop: tb ? Math.round(r(tb).top) : null, toolbarH: tb ? Math.round(r(tb).height) : null,
            barAboveToolbar: bar && tb ? r(bar).bottom <= r(tb).top + 1 : null,
            select: w('.rb-tl-ver-select'), words: w('.rb-tl-ver-state'), verbs: verbs ? Math.round(verbs.getBoundingClientRect().width) : null,
            buttons: verbs ? [...verbs.querySelectorAll('button')].map((b) => `${b.textContent.trim()} ${Math.round(b.getBoundingClientRect().width)}`) : [],
            ganttTop: document.querySelector('.rb-tl-gantt') ? Math.round(r(document.querySelector('.rb-tl-gantt')).top) : null,
          };
        });
        console.log(`  measured (${state}): ${JSON.stringify(m)}`);
      };
      await open();
      await toTimeline();
      await measure('locked'); await shot('locked');
      await click(tab('Budget'), 'the Budget tab');
      await click(button('Reset to bidding'), 'Reset to bidding');
      await must(page.getByText(/^Back to bidding/).first(), 'the reset toast');
      await toTimeline();
      const dismiss = page.getByTitle('Dismiss').first();
      if (await dismiss.isVisible().catch(() => false)) { await dismiss.click(); await sleep(200); }
      await measure('bidding'); await shot('bidding');
      await pickVersion('Bid v1');
      await must(verBar().locator('.rb-tl-ver-state', { hasText: /^Viewing bid version/ }), 'the viewing words');
      await measure('viewing'); await shot('viewing-bid-v1');
      await click(button('Edit this version', verBar()), 'the bar\'s Edit this version');
      const pre = dialog('Save what the Timeline shows first?');
      if (await pre.isVisible().catch(() => false)) await click(button('Discard', pre), 'Discard');
      const q = page.getByRole('dialog').filter({ hasText: 'Edit' }).last();
      await must(q, 'the Edit question');
      await click(button('Edit this version', q), 'the question\'s Edit this version');
      await must(verBar().locator('.rb-tl-ver-state', { hasText: /^Open: / }), 'the version open');
      if (await dismiss.isVisible().catch(() => false)) { await dismiss.click(); await sleep(200); }
      await measure('open'); await shot('open-bid-v1');
    } else if (PART === 'saveas') {
      await open();
      await click(tab('Scenes'), 'the Scenes tab');
      const bar = page.locator('.rb-scene-lists');
      await must(bar, 'the shot-list bar');
      const saveAs = bar.getByRole('button', { name: /^Save (edit )?as…$/ }).first();
      await must(saveAs, 'the bar\'s Save as… / Save edit as…');
      console.log(`  the button reads: "${(await saveAs.textContent()).trim()}"`);
      await saveAs.hover();
      await shot('bar', { hover: false });
      await saveAs.click();
      await must(anyDialog(), 'the dialog it opens');
      await shot('dialog');
      await closeDialog();
    } else if (PART === 'team') {
      await open();
      await click(tab('Team'), 'the Team tab');
      await sleep(600);
      await shot('table');
      if (PHASE === 'after') {
        const gallery = page.getByRole('radio', { name: 'Gallery', exact: true }).or(page.getByRole('button', { name: 'Gallery', exact: true })).or(page.getByRole('tab', { name: 'Gallery', exact: true })).first();
        await click(gallery, 'the Gallery switch');
        await sleep(500);
        await shot('gallery');
        const firstCard = page.locator('.rb-team-card').first();
        await firstCard.focus();
        await page.keyboard.press('ArrowRight');
        await sleep(200);
        await shot('gallery-keyboard', { hover: false });
        await page.keyboard.press('Enter');
        await sleep(500);
        await shot('gallery-enter-opens');
        await closeDialog();
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
