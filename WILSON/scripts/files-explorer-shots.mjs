#!/usr/bin/env node
/**
 * The Files tab as an explorer, photographed — post-overhaul S4c (2026-10-06).
 *
 *   node scripts/files-explorer-shots.mjs <port> --out <dir> [--size 1440x900] [--prefix po-s4c-]
 *
 * Walks walkthrough 56 on the dev fixtures' Salt Hours, a project from before
 * S4c (its shot folders under SHOTS): the Table at the project folder with
 * the crumb, the Up button and the one-time offer; SCENES opened; a scene
 * opened; Backspace back up with the folder focused; a search across the
 * project with the Location column; the question before the move, and the
 * result with the shot folders inside their scene; the shot popup's Folder
 * line; then, on the game variant (?fixtures=game), a level's and an
 * experience's popup with their Files section. Each file is
 * `<prefix><nn>-<state>-<W>x<H>.png`.
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
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--prefix'].includes(args[i - 1])) || '5283';
const OUT = flag('--out');
if (!OUT) { console.error('usage: files-explorer-shots.mjs <port> --out <dir> [--size WxH] [--prefix p]'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PREFIX = flag('--prefix') || 'po-s4c-';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  // 🚨 No fixed clock here (the S5 shots script pins one): the explorer drops
  // a pointer click within 350 ms of the last move by Date.now(), and a page
  // whose Date.now() never advances would drop every click after the first.
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  const quiet = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  const sleep = (ms) => page.waitForTimeout(ms);
  let n = 0;
  const shot = async (state) => {
    n += 1;
    await page.mouse.move(W - 70, 12);
    await sleep(250);
    const file = `${PREFIX}${String(n).padStart(2, '0')}-${state}-${W}x${H}.png`;
    await page.screenshot({ path: join(OUT, file) });
    console.log(`  ${file}`);
  };
  const must = async (loc, what) => {
    try { await loc.waitFor({ state: 'visible', timeout: 8000 }); } catch {
      await page.screenshot({ path: join(OUT, `debug-not-found-${W}x${H}.png`) });
      throw new Error(`not found: ${what} (the screen then: debug-not-found-${W}x${H}.png)`);
    }
    return loc;
  };
  const click = async (loc, what) => { await (await must(loc, what)).click(); };
  const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
  const folderName = (name) => page.locator('[data-files-table] button[data-folder-name]', { hasText: name }).first();
  // A folder opens on ONE click, so a pointer click within 350 ms of the
  // last move is dropped as the second half of a double-click (the explorer's
  // settle guard): the walk waits that out before the next folder.
  const enter = async (name, what) => { await sleep(420); await click(folderName(name), what); await sleep(200); };
  const filterBox = () => page.getByRole('searchbox', { name: 'Filter', exact: true });
  const crumbs = async () => (await page.locator('[data-files-crumbs] [data-crumb]').allTextContents()).join(' › ');

  const open = async (query = '') => {
    await page.goto(`http://localhost:${PORT}/rabbit${query}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: quiet });
    await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
    await sleep(500);
  };

  // ── The Files tab, Table view ──────────────────────────────────────────
  await open();
  await click(tab('Files'), 'the Files tab');
  await click(tab('Table'), 'the Table view');
  await must(page.locator('[data-files-crumbs]'), 'the crumb bar');
  await must(page.locator('[data-shot-refile-offer]'), 'the re-filing offer');
  await shot('files-root-offer');
  console.log(`  crumb: ${await crumbs()}`);
  await enter('SCENES', 'the SCENES folder');
  await shot('files-scenes');
  console.log(`  crumb: ${await crumbs()}`);
  await enter('Lighthouse-Dawn', 'the Lighthouse-Dawn scene folder');
  await shot('files-scene-before');
  console.log(`  crumb: ${await crumbs()}`);
  // Backspace with a row focused goes up; focus lands on the folder just left.
  await page.keyboard.press('Backspace');
  await sleep(200);
  await shot('files-backspace-up');
  console.log(`  crumb after Backspace: ${await crumbs()}; focused: ${await page.evaluate(() => document.activeElement?.textContent || '')}`);
  // A search across the project: the Location column comes back.
  await filterBox().fill('board');
  await sleep(300);
  await shot('files-search');
  console.log(`  search note: ${await page.locator('[data-search-note]').textContent()}`);
  await click(page.getByRole('button', { name: 'Clear', exact: true }), 'Clear');
  await sleep(200);
  console.log(`  crumb after Clear: ${await crumbs()}`);

  // ── The one-time move ──────────────────────────────────────────────────
  await click(page.getByRole('button', { name: 'Move shot folders into their scenes…', exact: true }), 'the offer');
  const question = page.getByRole('dialog', { name: /^Move \d+ shot folders? into (its scene|their scenes)\?$/ });
  await must(question, 'the question');
  await shot('refile-question');
  await click(question.getByRole('button', { name: 'Move shot folders', exact: true }), 'Move shot folders');
  await must(page.locator('[data-shot-refile-result]'), 'the result');
  await shot('refile-result');
  console.log(`  result: ${await page.locator('[data-shot-refile-result]').textContent()}`);
  // Up to the project folder: SHOTS is gone; into the scene: its shot folders.
  await sleep(420);
  await click(page.locator('[data-folder-up]'), 'Up');
  await sleep(200);
  await shot('files-root-after');
  console.log(`  root rows: ${(await page.locator('[data-files-table] .fx-name-text').allTextContents()).join(', ')}`);
  await enter('SCENES', 'SCENES again');
  await enter('Lighthouse-Dawn', 'the scene again');
  await shot('files-scene-with-shots');
  console.log(`  scene rows: ${(await page.locator('[data-files-table] .fx-name-text').allTextContents()).join(', ')}`);
  await sleep(420);
  const shotFolder = page.locator('[data-files-table] button[data-folder-name]').first();
  await click(shotFolder, 'a shot folder');
  await sleep(200);
  await shot('files-shot-folder');
  console.log(`  crumb in the shot: ${await crumbs()}`);

  // ── The shot popup's Folder line ───────────────────────────────────────
  await click(tab('Scenes'), 'the Scenes tab');
  const sceneRow = page.locator('tr', { hasText: 'Lighthouse, dawn' }).first();
  await click(sceneRow.getByRole('button', { name: 'View details', exact: true }), 'the scene\'s View details');
  const scenePopup = page.getByRole('dialog', { name: 'Lighthouse, dawn' });
  await must(scenePopup, 'the scene popup');
  await shot('scene-popup-folder');
  await page.keyboard.press('Escape');
  await sleep(300);

  // ── The game variant: a level's and an experience's popup ──────────────
  await open('?fixtures=game');
  await click(tab('Levels'), 'the Levels tab');
  const levelRow = page.locator('tr', { hasText: 'Lamp Room' }).first();
  await click(levelRow.getByRole('button', { name: 'View details', exact: true }), 'the level\'s View details');
  const levelPopup = page.getByRole('dialog', { name: 'Lamp Room' });
  await must(levelPopup.locator('.rb-ent-detail-files'), 'the level popup\'s Files section');
  await levelPopup.locator('.rb-ent-detail-files').scrollIntoViewIfNeeded();
  await shot('level-popup-files');
  await page.keyboard.press('Escape');
  await sleep(300);
  await click(tab('Experiences'), 'the Experiences tab');
  const xRow = page.locator('tr', { hasText: 'The Storm' }).first();
  await click(xRow.getByRole('button', { name: 'View details', exact: true }), 'the experience\'s View details');
  const xPopup = page.getByRole('dialog', { name: 'The Storm' });
  await must(xPopup.locator('.rb-ent-detail-files'), 'the experience popup\'s Files section');
  await xPopup.locator('.rb-ent-detail-files').scrollIntoViewIfNeeded();
  await shot('experience-popup-files');
  // Its Files tab: LEVELS and EXPERIENCES among the project's folders.
  await page.keyboard.press('Escape');
  await sleep(300);
  await click(tab('Files'), 'the Files tab (game)');
  await click(tab('Table'), 'the Table view (game)');
  await enter('LEVELS', 'LEVELS');
  await enter('Lamp-Room', 'Lamp-Room');
  await shot('files-level-folder');
  console.log(`  level folder rows: ${(await page.locator('[data-files-table] .fx-name-text').allTextContents()).join(', ')}`);
} finally {
  await browser.close();
}
