#!/usr/bin/env node
/**
 * Bins through the file gateway, photographed — GW3 (2026-10-11).
 *
 *   node scripts/bins-gateway-shots.mjs <port> --out <dir> [--size 1440x900] [--prefix po-gw3-]
 *
 * Walks walkthrough 62 on the dev fixtures' Salt Hours, with the fixtures'
 * gateway stub answering the probe, the tickets and the bytes IN THE PAGE
 * (src/dev/fixtures/gatewayDoors.js; the bytes are a bundled three-second
 * clip of random frames, never footage). Each of GATEWAY_DESIGN.md §2's
 * states is a mode on the URL:
 *   /rabbit                     the office door: the notice's gateway sentence,
 *                               the inspector's player with no overlay, the
 *                               clip large on Space, a ProRes master keeping
 *                               its picture with the format sentence
 *   ?gateway=outside            the outside door: the viewer's name, member
 *                               code and the clock over the player (D9)
 *   ?gateway=none               no gateway enrolled: the admin's line
 *   ?gateway=unseen             a gateway silent for four minutes
 *   ?gateway=unreachable        one this browser's probes do not reach, with
 *                               the own-computer line
 *   ?gateway=inside&missing=…   a clip the gateway answers 404 for: the row
 *                               flips to "not at its path"
 *   the viewings table filtered to a clip (item 5), from the inspector's line
 *   ?gateways=nextroot          Settings, Storage: the new certificate's lines
 * Each file is `<prefix><nn>-<state>-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1 (the gw3-worktree launch entry, port 5289). Changes
 * nothing that outlives the page: the fixture store is in memory and the
 * browser context is fresh; no request leaves the page. Animations are off
 * and the caret transparent, in this page only. A state whose control is
 * not found stops the run and says which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--prefix'].includes(args[i - 1])) || '5289';
const OUT = flag('--out');
if (!OUT) { console.error('usage: bins-gateway-shots.mjs <port> --out <dir> [--size WxH] [--prefix p]'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PREFIX = flag('--prefix') || 'po-gw3-';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
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
  const must = async (loc, what, timeout = 8000) => {
    try { await loc.waitFor({ state: 'visible', timeout }); } catch {
      await page.screenshot({ path: join(OUT, `debug-not-found-${W}x${H}.png`) });
      throw new Error(`not found: ${what} (the screen then: debug-not-found-${W}x${H}.png)`);
    }
    return loc;
  };
  // A tile hovered after a click keeps its scrub video (and, outside, its
  // mark): the mouse leaves the grid so the inspector's is the only one.
  const click = async (loc, what) => { await (await must(loc, what)).click(); await page.mouse.move(W - 70, 12); };
  const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
  const tile = (name) => page.locator('[role="gridcell"]', { hasText: name }).first();
  const text = async (sel) => ((await page.locator(sel).first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  const say = async (label, sel) => console.log(`  ${label}: ${(await text(sel)).slice(0, 220)}`);

  const open = async (query = '') => {
    await page.goto(`http://localhost:${PORT}/rabbit${query}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: quiet });
    await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
    await sleep(500);
  };
  const bins = async (query = '') => {
    await open(query);
    await click(tab('Bins'), 'the Bins tab');
    await must(page.locator('[data-testid="catalogue-notice"]'), 'the catalogue notice');
    await must(page.locator('[role="gridcell"]').first(), 'a tile');
    await sleep(400); // the stub's probe (40 ms) and the first marks
  };
  // The seeded rows, read through the dev server (Node alone cannot resolve the fixtures' imports).
  const data = await (async () => {
    await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
    return page.evaluate(async () => {
      const s = await import('/src/dev/fixtures/data/scenes.js');
      const g = await import('/src/dev/fixtures/data/gateways.js');
      const viewed = g.seedViewings(Date.now())[0];
      return {
        proxy: s.BIN_FILES.find((f) => f.extension === '.mp4'),
        master: s.BIN_FILES.find((f) => f.extension === '.mov'),
        viewedName: s.BIN_FILES.find((f) => f.id === viewed.file_id)?.display_name || null,
      };
    });
  })();
  console.log(`  rows: proxy ${data.proxy.display_name} (${data.proxy.id}); master ${data.master.display_name}; viewed ${data.viewedName}`);

  // ── A. The office door (the default): the gateway sentence, the player, Space ──
  await bins();
  await shot('bins-gateway-notice');
  await say('notice', '[data-testid="catalogue-notice"]');
  await click(tile(data.proxy.display_name), 'the proxy clip');
  const preview = page.locator('[data-testid="gateway-preview"]');
  await must(preview, 'the inspector\'s player');
  await must(page.locator('[data-testid="gateway-player"][data-loaded="true"]'), 'the hand-over (loadeddata)');
  await shot('bins-inspector-player-inside');
  console.log(`  mark inside: ${await page.locator('[data-testid="viewer-mark"]').count()} (must be 0)`);
  await say('inspector', '[data-testid="gateway-preview"] + *, [data-testid="gateway-preview"]');
  await page.keyboard.press('Space');
  const large = page.locator('[data-testid="poster-large"]');
  await must(large, 'the clip large');
  await must(page.locator('[data-testid="poster-large"][data-plays="true"]'), 'the large view as the player');
  await sleep(800);
  await shot('bins-player-large-space');
  await page.keyboard.press('Escape');
  await sleep(300);

  await click(tile(data.master.display_name), 'the ProRes master');
  await must(page.locator('[data-testid="needs-desktop-format"]'), 'the format panel');
  await shot('bins-inspector-needs-desktop-format');
  await say('format', '[data-testid="needs-desktop-format"]');
  await page.keyboard.press('Space');
  await must(large, 'the picture large');
  await shot('bins-picture-large-prores');
  await page.keyboard.press('Escape');
  await sleep(300);

  // ── B. The outside door: the mark over the player ──
  await bins('?gateway=outside');
  await click(tile(data.proxy.display_name), 'the proxy clip');
  await must(page.locator('[data-testid="gateway-player"][data-loaded="true"]'), 'the hand-over');
  await must(preview.locator('[data-testid="viewer-mark"]'), 'the viewer\'s mark');
  await shot('bins-inspector-player-outside-mark');
  await say('mark', '[data-testid="gateway-preview"] [data-testid="viewer-mark"]');
  await page.keyboard.press('Space');
  await must(page.locator('[data-testid="poster-large"][data-plays="true"]'), 'the player large');
  await must(page.locator('[data-testid="poster-large"] [data-testid="viewer-mark"]'), 'the mark on the large player');
  await sleep(800);
  await shot('bins-player-large-outside-mark');
  await page.keyboard.press('Escape');
  await sleep(300);

  // ── C. No gateway, a silent one, an unreachable one ──
  await bins('?gateway=none');
  await must(page.locator('[data-testid="gateway-line"]'), 'the admin\'s line');
  await shot('bins-notice-no-gateway-admin-line');
  await say('lines', '[data-testid="gateway-line"]');
  await click(tile(data.proxy.display_name), 'the proxy clip');
  await must(page.locator('[data-testid="not-here"]'), 'the no-gateway sentence');
  await shot('bins-inspector-no-gateway');
  await say('inspector', '[data-testid="not-here"]');

  await bins('?gateway=unseen');
  await must(page.locator('[data-testid="gateway-line"]'), 'the unseen line');
  await shot('bins-notice-gateway-unseen');
  await say('lines', '[data-testid="gateway-line"]');

  await bins('?gateway=unreachable');
  await must(page.locator('[data-testid="gateway-line"]').nth(1), 'the own-computer line');
  await shot('bins-notice-gateway-unreachable');
  console.log(`  lines: ${(await page.locator('[data-testid="gateway-line"]').allTextContents()).join(' || ')}`);
  await click(page.locator('[data-testid="catalogue-notice"]').getByTitle('Got it'), 'the notice\'s ×');
  await must(page.locator('[data-testid="gateway-notice"]'), 'the strip after the notice is put away');
  await shot('bins-strip-after-dismiss');

  // ── D. A clip the gateway answers 404 for ──
  await bins(`?gateway=inside&missing=${data.proxy.id}`);
  await click(tile(data.proxy.display_name), 'the proxy clip');
  await must(page.locator('[data-testid="not-here"]'), 'the missing sentence', 15000);
  await sleep(300);
  await shot('bins-inspector-clip-missing-404');
  await say('inspector', '[data-testid="not-here"]');
  console.log(`  tile offline: ${await tile(data.proxy.display_name).getAttribute('data-offline')}`);
  console.log(`  count: ${await text('[data-testid="gateway-offline-count"]')}`);

  // ── E. Item 5: the viewings table filtered to a clip (the tester is an admin) ──
  if (data.viewedName) {
    await bins();
    await click(tile(data.viewedName), 'the viewed clip');
    const line = page.locator('button[data-testid="bin-remote-views"]');
    await must(line, 'the inspector\'s viewings button');
    await say('line', 'button[data-testid="bin-remote-views"]');
    await line.click();
    await must(page.locator('[data-testid="clip-viewings-table"]'), 'the clip\'s viewings table');
    await sleep(300);
    await shot('bins-clip-viewings-table');
    console.log(`  table: ${(await text('[data-testid="clip-remote-viewings"]')).slice(0, 300)}`);
    await page.keyboard.press('Escape');
  }

  // ── F. Settings, Storage: the new certificate's lines (item 0.3) ──
  await page.goto(`http://localhost:${PORT}/settings?gateways=nextroot`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: quiet });
  await click(tab('Storage'), 'the Storage tab');
  const well = page.locator('[data-testid="gateway-next-root"]');
  await must(well, 'the new-certificate well');
  await well.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await shot('settings-gateway-next-root');
  console.log(`  next root: ${(await text('[data-testid="gateway-next-root"]')).slice(0, 300)}`);
} finally {
  await browser.close();
}
