#!/usr/bin/env node
/**
 * A task's items, photographed — FX2 (migration 0096, 2026-10-11).
 *
 *   node scripts/task-items-shots.mjs <port> --out <dir> [--size 1440x900] [--prefix po-fx2-]
 *
 * Walks walkthrough 65 on the dev fixtures' Salt Hours: task 18 ("Glass and
 * rain rig test", about two assets, a scene and a shot) in its window, the
 * Items table on the left with the Main badge; a row's hover slot (Move up,
 * Move down, Remove); the one picker over every kind, then its search; a
 * second scene added and moved first; the question before a task's LAST item
 * goes; the scene's own window listing every task about it; and, on the
 * `?fixtures=game` variant, a task about a level and an experience. Each file
 * is `<prefix><nn>-<state>-<W>x<H>.png`.
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
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--prefix'].includes(args[i - 1])) || '5291';
const OUT = flag('--out');
if (!OUT) { console.error('usage: task-items-shots.mjs <port> --out <dir> [--size WxH] [--prefix p]'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PREFIX = flag('--prefix') || 'po-fx2-';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
let n = 0;
try {
  for (const variant of ['film', 'game']) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.clock.setFixedTime(new Date('2026-10-11T14:02:00'));
    page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
    const quiet = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    await page.goto(`http://localhost:${PORT}/rabbit${variant === 'game' ? '?fixtures=game' : ''}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: quiet });

    const sleep = (ms) => page.waitForTimeout(ms);
    const shot = async (state) => {
      n += 1;
      await sleep(300);
      const file = `${PREFIX}${String(n).padStart(2, '0')}-${state}-${W}x${H}.png`;
      await page.screenshot({ path: join(OUT, file) });
      console.log(`  ${file}`);
    };
    const must = async (loc, what) => {
      try { await loc.first().waitFor({ state: 'visible', timeout: 8000 }); } catch { throw new Error(`not found: ${what}`); }
      return loc.first();
    };
    const click = async (loc, what) => { await (await must(loc, what)).click(); };
    const button = (name, root = page) => root.getByRole('button', { name, exact: true }).first();
    const openTask = async (title) => {
      // A key date can share a task's title ("Final mix"): the task's row is
      // the one with the details button.
      const row = page.locator('tr', { hasText: title })
        .filter({ has: page.getByRole('button', { name: 'View task details' }) }).first();
      await must(row, `the row of ${title}`);
      await row.hover();
      await click(row.getByRole('button', { name: 'View task details' }), `View task details on ${title}`);
      const win = page.getByRole('dialog', { name: title, exact: true });
      await must(win, `the window of ${title}`);
      return win;
    };
    const items = (win) => win.locator('.rb-rel-items');

    await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
    await sleep(500);
    await click(page.getByRole('tab', { name: 'Tasks', exact: true }).first(), 'the Tasks tab');
    await sleep(500);

    if (variant === 'film') {
      // 1. Task 18: two assets (the first is Main), a scene, a shot.
      let win = await openTask('Glass and rain rig test');
      await must(items(win).getByText('Items (4)'), 'Items (4)');
      await page.mouse.move(W - 40, H - 40);
      await shot('window-items');

      // 2. A row's hover slot: Move up (greyed on the first), Move down, Remove.
      await items(win).locator('.rb-rel-item', { hasText: 'Sea Spray Comp' }).first().hover();
      await shot('row-hover');

      // 3. One add control, one picker over every kind, grouped.
      await click(button('Add an item', items(win)), 'Add an item');
      const pick = page.locator('.rb-rel-items-pick');
      await must(pick, 'the picker');
      await page.mouse.move(W - 40, H - 40);
      await shot('picker');

      // 4. Its search narrows every kind at once.
      await pick.getByLabel("Search the project's items").fill('boat');
      await sleep(200);
      await shot('picker-search');

      // 5. A second scene: The storm stays Main.
      await click(pick.getByRole('button', { name: "Add Father's boat" }), "Add Father's boat");
      await sleep(400);
      await click(button('Close', pick), 'the picker\'s Close');
      await must(items(win).getByText('Items (5)'), 'Items (5)');
      await page.mouse.move(W - 40, H - 40);
      await shot('second-scene');

      // 6. Move The storm down: Father's boat is the main scene now.
      await items(win).locator('.rb-rel-item', { hasText: 'The storm' }).first().hover();
      await click(button('Move The storm down', items(win)), 'Move The storm down');
      await sleep(400);
      await page.mouse.move(W - 40, H - 40);
      await shot('scene-moved-first');
      await click(button('Done', win), 'Done');
      await sleep(300);

      // 7. A task's LAST item asks first (Cancel focused).
      win = await openTask('Final mix');
      const row = items(win).locator('.rb-rel-item').first();
      await row.hover();
      await click(row.getByRole('button', { name: /^Remove / }), 'Remove on Final mix\'s only item');
      await must(page.getByRole('dialog', { name: 'Remove the last item' }), 'the last-item question');
      await shot('last-item-question');
      await click(button('Cancel', page.getByRole('dialog', { name: 'Remove the last item' })), 'Cancel');
      await click(button('Done', win), 'Done');
      await sleep(300);

      // 8. The scene's own window lists every task about it.
      await click(page.getByRole('tab', { name: 'Scenes', exact: true }).first(), 'the Scenes tab');
      await sleep(600);
      const sceneRow = page.locator('tr, [role="row"]', { hasText: 'The storm' }).first();
      await must(sceneRow, 'The storm');
      await sceneRow.hover();
      const detail = sceneRow.getByRole('button', { name: /details|Open/i }).first();
      if (await detail.isVisible().catch(() => false)) await detail.click(); else await sceneRow.dblclick();
      await must(page.locator('.rb-rel-panel').getByText(/^Tasks \(\d+\)$/), 'the scene window\'s Tasks');
      await page.mouse.move(W - 40, H - 40);
      await shot('scene-window-tasks');
    } else {
      // 9. ?fixtures=game: a task about a level and an experience.
      const win = await openTask('Practical lamp rig');
      await must(items(win).getByText(/^Items \(\d+\)$/), 'the Items head');
      await page.mouse.move(W - 40, H - 40);
      await shot('game-level-experience');
      await click(button('Add an item', items(win)), 'Add an item');
      await must(page.locator('.rb-rel-items-pick'), 'the picker');
      await page.mouse.move(W - 40, H - 40);
      await shot('game-picker');
    }
    await page.close();
  }
} finally {
  await browser.close();
}
