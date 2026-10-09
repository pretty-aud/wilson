#!/usr/bin/env node
/**
 * Bins in the browser, photographed — Bins on the cloud BC3 (2026-10-09).
 *
 *   node scripts/bins-browser-shots.mjs <port> --out <dir> [--size 1440x900] [--prefix po-bc3-]
 *
 * Walks walkthrough 58 on the dev fixtures' Salt Hours. First as a browser
 * sees a company's bins (`?bins=browser`: the fixtures answer as the cloud
 * does in a browser, no row reachable): the catalogue with its one notice;
 * a clip's inspector ("not on this computer", the browser's sentence); the
 * picture large on Space; a flag made with S; the file menu (no Open, no
 * Reveal); Assign to shot; a clip removed with Undo in the toast; the list
 * view; a shot's takes on the Scenes tab. Then the plain fixtures (every row
 * answered for, nothing streams): the inspector's play sentence. Then App
 * settings, Storage, Migrate to cloud with the desktop's routes and the
 * cloud's REST STUBBED in the page (Playwright routes): the dry run's
 * question, an answer typed, a root left for now, the report. Each file is
 * `<prefix><nn>-<state>-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1. Changes nothing that outlives the page: the fixture
 * store is in memory, the browser context is fresh, and every write of the
 * migration goes to the stub, never to a database. Animations are off and
 * the caret transparent, in this page only. A state whose control is not
 * found stops the run and says which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--prefix'].includes(args[i - 1])) || '5286';
const OUT = flag('--out');
if (!OUT) { console.error('usage: bins-browser-shots.mjs <port> --out <dir> [--size WxH] [--prefix p]'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PREFIX = flag('--prefix') || 'po-bc3-';
mkdirSync(OUT, { recursive: true });

// ── The desktop's bundle, as the signed-out app keeps Salt Hours ────────────
// The fixtures' cloud rows (read through the dev server, which resolves the
// fixtures' extensionless imports; Node alone does not) turned back into
// absolute paths: the footage, the audio and the VFX plates on the company's
// share; the stills on a drive letter of this computer — two roots, so the
// question shows both kinds.
async function desktopBundle(page) {
  const d = await page.evaluate(async () => {
    const s = await import('/src/dev/fixtures/data/scenes.js');
    const p = await import('/src/dev/fixtures/data/project.js');
    return {
      BINS: s.BINS, BIN_FILES: s.BIN_FILES.map(({ __poster, ...f }) => f), SHOT_TAKES: s.SHOT_TAKES,
      SCENES: s.SCENES, SHOTS: s.SHOTS, BIN_LOCATIONS: s.BIN_LOCATIONS, PROJECT: p.PROJECT,
    };
  });
  const share = d.BIN_LOCATIONS[0].unc_path;
  const stillsBin = d.BINS.find(b => b.name === 'Stills')?.id;
  const binFiles = d.BIN_FILES.map(({ location_id, relative_path, workspace_id, poster_path, online, ...f }) => ({
    ...f,
    source_path: f.bin_id === stillsBin
      ? `D:\\Set photos\\${relative_path.replace(/^STILLS\//, '').replace(/\//g, '\\')}`
      : `${share}\\${relative_path.replace(/\//g, '\\')}`,
  }));
  return {
    project: { id: d.PROJECT.id, title: d.PROJECT.title },
    phases: [], assets: [], tasks: [], files: [], dependencies: [],
    scenes: d.SCENES.map(({ workspace_id, ...s }) => s),
    shots: d.SHOTS.map(({ workspace_id, ...s }) => s),
    bins: d.BINS.map(({ workspace_id, ...b }) => b),
    binFiles,
    binRoots: [
      { id: 'r-share', project_id: d.PROJECT.id, path: share, label: 'footage' },
      { id: 'r-stills', project_id: d.PROJECT.id, path: 'D:\\Set photos', label: 'Set photos' },
    ],
    shotTakes: d.SHOT_TAKES.map(({ workspace_id, ...t }) => t),
  };
}

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
  const must = async (loc, what) => {
    try { await loc.waitFor({ state: 'visible', timeout: 8000 }); } catch {
      await page.screenshot({ path: join(OUT, `debug-not-found-${W}x${H}.png`) });
      throw new Error(`not found: ${what} (the screen then: debug-not-found-${W}x${H}.png)`);
    }
    return loc;
  };
  const click = async (loc, what) => { await (await must(loc, what)).click(); };
  const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
  const tile = (name) => page.locator('[role="gridcell"]', { hasText: name }).first();

  const open = async (query = '') => {
    await page.goto(`http://localhost:${PORT}/rabbit${query}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: quiet });
    await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
    await sleep(500);
  };

  // ── A browser's bins: no row reachable ───────────────────────────────────
  await open('?bins=browser');
  await click(tab('Bins'), 'the Bins tab');
  await must(page.locator('[data-testid="catalogue-notice"]'), 'the catalogue notice');
  await must(page.locator('[role="gridcell"]').first(), 'a tile');
  await shot('bins-catalogue-notice');
  console.log(`  notice: ${await page.locator('[data-testid="catalogue-notice"]').textContent()}`);

  await click(tile('A001_C002'), 'the clip A001_C002');
  await must(page.locator('[data-testid="not-here"]'), 'the inspector\'s not-here panel');
  await shot('bins-inspector-not-on-this-computer');
  console.log(`  inspector: ${(await page.locator('[data-testid="not-here"]').textContent()).slice(0, 160)}…`);

  await page.keyboard.press('Space');
  await must(page.locator('[data-testid="poster-large"]'), 'the picture large');
  await shot('bins-picture-large-space');
  await page.keyboard.press('Escape');
  await sleep(200);

  // A flag made in the browser (S), on the selected clip.
  await page.keyboard.press('s');
  await sleep(400);
  await shot('bins-select-mark-s');

  await page.locator('[role="gridcell"]', { hasText: 'A001_C002' }).first().click({ button: 'right' });
  await must(page.locator('.ui-menu'), 'the file menu');
  await shot('bins-file-menu-no-open');
  console.log(`  menu: ${(await page.locator('.ui-menu').textContent()).replace(/\s+/g, ' ').slice(0, 200)}`);
  await page.keyboard.press('Escape');
  await sleep(200);

  // The menu's Escape leaves nothing selected (as on the desktop): select the
  // clip again, then A.
  await click(tile('A001_C002'), 'the clip, for Assign');
  await page.keyboard.press('a');
  await must(page.getByRole('dialog', { name: /^Assign/ }), 'the assign dialog');
  await shot('bins-assign-to-shot');
  await page.keyboard.press('Escape');
  await sleep(300);

  // Remove with undo: Delete on the selected clip, the toast offers Undo.
  await click(tile('A001_C002'), 'the clip again');
  await page.keyboard.press('Delete');
  await must(page.getByRole('button', { name: 'Undo', exact: true }), 'the Undo in the toast');
  await shot('bins-remove-undo-toast');
  await click(page.getByRole('button', { name: 'Undo', exact: true }), 'Undo');
  await sleep(500);
  await must(tile('A001_C002'), 'the clip, back');

  await click(page.getByRole('button', { name: 'List view', exact: true }), 'List view');
  await sleep(300);
  await shot('bins-list-view');

  // A shot's takes on the Scenes tab, in a browser: the Shots view, a shot's
  // popup, its Takes section ("not on this computer" on each take, Add takes).
  await click(tab('Scenes'), 'the Scenes tab');
  await click(tab('Shots'), 'the Shots view');
  await sleep(400);
  const shotRow = page.locator('tr', { hasText: 'The cold lamp' }).first();
  await click(shotRow.getByRole('button', { name: 'View details', exact: true }), 'the shot\'s View details');
  const takes = page.locator('.rb-scene-detail-takes');
  await must(takes, 'the shot popup\'s Takes');
  await takes.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await shot('scenes-takes-in-browser');
  console.log(`  takes: ${(await takes.textContent()).replace(/\s+/g, ' ').slice(0, 200)}`);
  await page.keyboard.press('Escape');
  await sleep(300);

  // ── The plain fixtures: rows answered for, nothing streams ───────────────
  await open();
  await click(tab('Bins'), 'the Bins tab');
  await click(tile('A001_C001'), 'the clip A001_C001');
  await must(page.locator('[data-testid="no-stream"]'), 'the inspector\'s no-stream panel');
  await shot('bins-fixtures-play-needs-desktop');

  // ── The move: App settings, Storage, Migrate to cloud ────────────────────
  // The desktop's three routes and the cloud's REST answered in the page.
  const bundle = await desktopBundle(page);
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: 96, height: 54 } });
  await page.route('**/api/rabbit/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === '/api/rabbit/projects') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: bundle.project.id, title: bundle.project.title }]) });
    if (p === `/api/rabbit/projects/${bundle.project.id}`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle) });
    if (/\/bin-files\/[^/]+\/thumbnail$/.test(p)) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpeg });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not here"}' });
  });
  const cloud = { inserts: 0, uploads: 0 };
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const table = url.pathname.split('/').pop();
    const accept = req.headers()['accept'] || '';
    if (req.method() === 'GET') {
      if (table === 'workspaces') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(accept.includes('object') ? { remote_viewing_enabled: true } : [{ remote_viewing_enabled: true }]) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (req.method() === 'POST') { cloud.inserts++; return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' }); }
    // A PATCH that asks for the row back (`.select('id')`: the picture's
    // key lands on THIS project's row, or the object is taken back) answers
    // the one row the query names, as PostgREST does.
    if (req.method() === 'PATCH') {
      const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(id ? [{ id }] : []) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/storage/v1/**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && /\/object\/rabbit-thumbnails\//.test(req.url())) cloud.uploads++;
    else if (req.method() === 'DELETE' || /\/object\/rabbit-thumbnails$/.test(req.url())) cloud.removes = (cloud.removes || 0) + 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: req.url().split('/object/')[1] || 'x' }) });
  });
  await page.goto(`http://localhost:${PORT}/settings`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: quiet });
  await click(tab('Storage'), 'the Storage tab');
  const migrate = page.locator('section.s-section', { hasText: 'Migrate to cloud' }).first();
  await must(migrate, 'the migration section');
  await migrate.scrollIntoViewIfNeeded();
  await click(migrate.getByRole('button', { name: 'Dry-run', exact: true }), 'Dry-run');
  await must(page.locator('[data-footage-root]').first(), 'the roots\' question');
  await sleep(300);
  // The settings panel scrolls inside the page: the question's group at the
  // top of the view, so both roots are in the frame.
  const question = page.locator('.s-group', { hasText: 'Footage locations' }).first();
  const showQuestion = () => question.evaluate(el => el.scrollIntoView({ block: 'start' }));
  await showQuestion();
  await sleep(200);
  await shot('migrate-dry-run-question');
  console.log(`  roots: ${(await page.locator('[data-footage-root]').allTextContents()).map(t => t.replace(/\s+/g, ' ').slice(0, 140)).join(' || ')}`);

  // The share root: suggested as a new location, which waits for "Use this
  // address" (review round 1: a new company location comes only from an
  // address the person confirmed). The drive letter's folder, named as the
  // network sees it.
  const share = page.locator('[data-footage-root="\\\\\\\\salthours-nas\\\\footage"]');
  await must(share, 'the share root');
  console.log(`  share root before confirming: ${share.getAttribute ? await share.getAttribute('data-resolved') : ''} · ${await page.locator('[data-testid="roots-progress"]').textContent()}`);
  await click(share.getByRole('button', { name: 'Use this address', exact: true }), 'Use this address');
  await sleep(200);
  const stills = page.locator('[data-footage-root="D:\\\\Set photos"]');
  await must(stills, 'the D: root');
  await stills.getByLabel('Network address').fill('smb://salthours-nas/set photos/');
  await stills.getByLabel('Network address').blur();
  await sleep(200);
  await stills.getByLabel('Location name').fill('Set photos on the NAS');
  await sleep(200);
  await showQuestion();
  await shot('migrate-answers');
  console.log(`  resolution: ${(await page.locator('[data-testid="root-resolution"]').allTextContents()).join(' || ')}`);

  // Left for now, then named again (the walkthrough shows both states).
  await click(stills.getByRole('button', { name: 'Leave on this computer for now', exact: true }), 'Leave on this computer for now');
  await sleep(200);
  await showQuestion();
  await shot('migrate-leave-for-now');
  await click(stills.getByRole('button', { name: 'Name it', exact: true }), 'Name it');
  await sleep(200);

  await click(migrate.getByRole('button', { name: 'Migrate', exact: true }), 'Migrate');
  await must(page.locator('caption', { hasText: 'Migration report' }), 'the migration report');
  await sleep(300);
  await page.locator('pre.s-log').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await sleep(200);
  await shot('migrate-report');
  await page.locator('.s-table tbody tr', { hasText: 'pictures' }).evaluate(el => el.scrollIntoView({ block: 'end' }));
  await sleep(200);
  await shot('migrate-report-table');
  console.log(`  cloud stub: ${cloud.inserts} inserts, ${cloud.uploads} uploads, ${cloud.removes || 0} removes`);
  console.log(`  report: ${(await page.locator('.s-table').textContent()).replace(/\s+/g, ' ').slice(0, 400)}`);
  console.log(`  log tail: ${(await page.locator('pre.s-log').textContent()).split('\n').slice(-6).join(' | ')}`);
} finally {
  await browser.close();
}
