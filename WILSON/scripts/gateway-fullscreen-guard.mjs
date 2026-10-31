#!/usr/bin/env node
/**
 * The mark's fullscreen guard, measured in a real engine — GW3 review round 1,
 * finding 4 (2026-10-11).
 *
 *   node scripts/gateway-fullscreen-guard.mjs <port> --out <dir> [--browser chromium|firefox|webkit]
 *
 * Firefox and Safari ignore `controlsList` and draw their own fullscreen
 * control on `<video controls>`, which takes the ELEMENT fullscreen, where
 * the mark is not; Safari ignores `disablePictureInPicture` too. Through the
 * outside door the player undoes either: it pauses the clip, leaves
 * fullscreen or picture-in-picture, and says FULLSCREEN_KEEPS_MARK. This
 * script asks for both on the inspector's player the way those controls do
 * (`requestFullscreen` on the element; `requestPictureInPicture` with the
 * attribute removed, as Safari behaves) and reads the outcome:
 *   A  outside door, the bare element fullscreen   → undone, paused, the sentence
 *   B  outside door, the frame's own Fullscreen    → kept, the mark inside, playing
 *   C  office door, the bare element fullscreen    → left alone (no mark there)
 *   D  outside door, picture-in-picture            → refused by the attribute, or
 *                                                    undone when the engine ignores it
 * Exits 1 when any outcome differs, 0 otherwise; the report and two pictures
 * go to --out.
 *
 * Needs the worktree's own dev server with the fixtures (the gw3-worktree
 * launch entry, port 5289): the gateway is acted IN THE PAGE
 * (src/dev/fixtures/gatewayDoors.js; three seconds of random frames, never
 * footage). Loopback only; nothing listens; the browser context is fresh.
 * Only the engines Playwright has installed run: on GW3's machine that was
 * Chromium alone, so Firefox and WebKit are this script's to answer later.
 */
import { chromium, firefox, webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--browser'].includes(args[i - 1])) || '5289';
const OUT = flag('--out');
const ENGINE = flag('--browser') || 'chromium';
if (!OUT || !['chromium', 'firefox', 'webkit'].includes(ENGINE)) {
  console.error('usage: gateway-fullscreen-guard.mjs <port> --out <dir> [--browser chromium|firefox|webkit]');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const report = { engine: ENGINE, port: PORT, at: new Date().toISOString(), steps: [], failures: [] };
const note = (k, v) => { report.steps.push({ k, v }); console.log(`  ${k}: ${JSON.stringify(v)}`); };
const expect = (what, ok, seen) => { if (!ok) { report.failures.push({ what, seen }); console.log(`  ✗ ${what}`); } else console.log(`  ✓ ${what}`); };

const browser = await { chromium, firefox, webkit }[ENGINE].launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => note('pageerror', e.message));
  const sleep = (ms) => page.waitForTimeout(ms);
  await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
  const { proxy, sentence } = await page.evaluate(async () => {
    const s = await import('/src/dev/fixtures/data/scenes.js');
    const w = await import('/src/tools/rabbit_v0.1.0/bins/binLocations.js');
    return { proxy: s.BIN_FILES.find((f) => f.extension === '.mp4'), sentence: w.FULLSCREEN_KEEPS_MARK };
  });
  const bins = async (query) => {
    await page.goto(`http://localhost:${PORT}/rabbit${query}`, { waitUntil: 'networkidle' });
    await page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first().click();
    await sleep(500);
    await page.getByRole('tab', { name: 'Bins', exact: true }).first().click();
    await page.locator('[role="gridcell"]').first().waitFor({ state: 'visible', timeout: 8000 });
    await sleep(400);
    await page.locator('[role="gridcell"]', { hasText: proxy.display_name }).first().click();
    await page.mouse.move(1370, 12);
    await page.locator('[data-testid="gateway-preview"] [data-testid="gateway-player"][data-loaded="true"]').waitFor({ state: 'visible', timeout: 10000 });
  };
  const video = () => page.locator('[data-testid="gateway-preview"] video').first();
  const play = () => video().evaluate((v) => v.play().then(() => 'playing', (e) => `refused: ${e.name}`));
  const state = () => page.evaluate(() => {
    const v = document.querySelector('[data-testid="gateway-preview"] video');
    const fe = document.fullscreenElement;
    const s = document.querySelector('[data-testid="gateway-preview"] [data-testid="gateway-sentence"]');
    return {
      fullscreen: fe ? (fe === v ? 'element' : (fe.contains(v) ? 'frame' : fe.tagName)) : null,
      paused: v ? v.paused : null,
      sentence: s ? s.textContent : null,
      marks: fe ? fe.querySelectorAll('[data-testid="viewer-mark"]').length : null,
      pip: document.pictureInPictureElement ? 'element' : null,
      pipEnabled: !!document.pictureInPictureEnabled,
    };
  });

  console.log(`${ENGINE}: A, the outside door, the bare element`);
  await bins('?gateway=outside');
  note('play', await play());
  await sleep(600);
  note('requestFullscreen', await video().evaluate((v) => v.requestFullscreen().then(() => 'entered', (e) => `refused: ${e.name}`)));
  await sleep(950);
  const a = await state();
  note('after 950 ms', a);
  await page.screenshot({ path: join(OUT, `A-outside-element-undone-${ENGINE}.png`) });
  expect('A: the element is not left fullscreen', a.fullscreen === null, a);
  expect('A: the clip is paused', a.paused === true, a);
  expect('A: the sentence says where fullscreen is', a.sentence === sentence, a);
  note('play again', await play());
  await sleep(500);
  const a2 = await state();
  expect('A: playing again clears the sentence', a2.sentence === null && a2.paused === false, a2);

  console.log(`${ENGINE}: B, the outside door, the frame's own button`);
  await page.locator('[data-testid="gateway-preview"]').hover();
  await page.locator('[data-testid="gateway-preview"] button[title="Fullscreen"]').first().click();
  await sleep(1200);
  const b = await state();
  note('after 1.2 s', b);
  await page.screenshot({ path: join(OUT, `B-outside-frame-mark-${ENGINE}.png`) });
  expect('B: the frame is fullscreen', b.fullscreen === 'frame', b);
  expect('B: the mark is inside it', b.marks === 1, b);
  expect('B: the clip plays on', b.paused === false && b.sentence === null, b);
  await page.evaluate(() => document.exitFullscreen().catch(() => {}));
  await sleep(400);

  console.log(`${ENGINE}: D, the outside door, picture-in-picture`);
  if (!(await state()).pipEnabled) note('picture-in-picture', 'not offered by this engine: nothing to measure');
  else {
    note('with the attribute', await video().evaluate((v) => v.requestPictureInPicture().then(() => 'entered', (e) => `refused: ${e.name}`)));
    await sleep(900);
    const d1 = await state();
    expect('D: with the attribute, no picture-in-picture is left open', d1.pip === null, d1);
    note('the attribute removed (as Safari)', await video().evaluate(async (v) => {
      v.removeAttribute('disablepictureinpicture'); v.disablePictureInPicture = false;
      await v.play().catch(() => {});
      return v.requestPictureInPicture().then(() => 'entered', (e) => `refused: ${e.name}`);
    }));
    await sleep(900);
    const d2 = await state();
    note('after 900 ms', d2);
    expect('D: picture-in-picture is undone, the clip paused', d2.pip === null && d2.paused === true, d2);
  }

  console.log(`${ENGINE}: C, the office door, the bare element`);
  await bins('');
  note('play', await play());
  await sleep(600);
  note('requestFullscreen', await video().evaluate((v) => v.requestFullscreen().then(() => 'entered', (e) => `refused: ${e.name}`)));
  await sleep(950);
  const c = await state();
  note('after 950 ms', c);
  expect('C: the office door leaves the element fullscreen', c.fullscreen === 'element' && c.paused === false && c.sentence === null, c);
  await page.evaluate(() => document.exitFullscreen().catch(() => {}));
} finally {
  await browser.close();
  writeFileSync(join(OUT, `report-${ENGINE}.json`), JSON.stringify(report, null, 2));
}
console.log(report.failures.length ? `${report.failures.length} outcome(s) differ` : 'every outcome as expected');
process.exit(report.failures.length ? 1 : 0);
