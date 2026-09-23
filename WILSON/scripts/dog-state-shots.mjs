#!/usr/bin/env node
/**
 * D.O.G.'s states, photographed — UI overhaul A1 (2026-09-23).
 *
 *   node scripts/dog-state-shots.mjs <port> --out <dir> [--size 1440x900]
 *   node scripts/dog-state-shots.mjs --compare <dirA> <dirB>
 *
 * The state extraction (plan §5) promises NO VISUAL CHANGE, and every state
 * it moved is one a URL does not show: Full Deck on, a focused prompt, a
 * second tab, the visualizer, a hovered tab, Settings unlocked, a help page.
 * ui-walk.mjs photographs three D.O.G. screens at rest; this drives the tool
 * through each state the extraction touched and photographs it, so a run
 * before a change and a run after can be compared PIXEL BY PIXEL.
 *
 * Deterministic by construction: the clock is fixed (the sidebar prints the
 * import time), every animation and transition is off and the caret is
 * transparent (injected into this page only, never the app), and the pet's
 * corner is excluded from the comparison — the pet is C5's and moves.
 *
 * `--compare` decodes both PNGs in a headless page (no image library is a
 * dependency here) and reports, per shot, the count and bounding box of the
 * pixels that differ. Exit 1 on any difference.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1. Creates nothing that outlives the page: the deck is
 * pasted into history (React state), one history row is removed and nothing
 * is generated, saved, exported or sent.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

if (args.includes('--compare')) {
  const i = args.indexOf('--compare');
  const [A, B] = [args[i + 1], args[i + 2]];
  const names = readdirSync(A).filter((f) => f.endsWith('.png')).sort();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let bad = 0;
  for (const name of names) {
    if (!existsSync(join(B, name))) { console.log(`✗ ${name}: missing in ${B}`); bad++; continue; }
    const a = readFileSync(join(A, name)).toString('base64');
    const b = readFileSync(join(B, name)).toString('base64');
    const r = await page.evaluate(async ({ a, b }) => {
      const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = `data:image/png;base64,${src}`; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: [ia.width, ia.height, ib.width, ib.height] };
      const w = ia.width, h = ia.height;
      const px = (im) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, w, h).data; };
      const da = px(ia), db = px(ib);
      const ig = { x0: w - 140, y0: h - 140 };
      let n = 0, minX = w, minY = h, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (x >= ig.x0 && y >= ig.y0) continue;
        const k = (y * w + x) * 4;
        if (da[k] !== db[k] || da[k + 1] !== db[k + 1] || da[k + 2] !== db[k + 2]) {
          n++; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
        }
      }
      return { n, box: n ? [minX, minY, maxX, maxY] : null, w, h };
    }, { a, b });
    if (r.size) { console.log(`✗ ${name}: sizes differ ${r.size.join(' ')}`); bad++; continue; }
    if (r.n) { console.log(`✗ ${name}: ${r.n} px differ in [${r.box.join(', ')}]`); bad++; } else console.log(`✓ ${name}`);
  }
  await browser.close();
  console.log(bad ? `\n✗ ${bad} of ${names.length} shots differ` : `\n✓ all ${names.length} shots pixel-identical (pet corner excluded)`);
  process.exit(bad ? 1 : 0);
}

const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size'].includes(args[i - 1])) || '5251';
const OUT = flag('--out');
if (!OUT) { console.error('usage: dog-state-shots.mjs <port> --out <dir> | --compare <a> <b>'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
mkdirSync(OUT, { recursive: true });

const RULE = '═'.repeat(63);
const slide = (n, layout, title, sub) => `SLIDE #${n} — ${layout}\n${RULE}\n\n▸ TITLE:\n${title}\n\n▸ SUBTITLE:\n${sub}\n\n▸ COPY/TEXT CONTENT:\nProbe copy.\n\n${RULE}\n`;
const DECK = [slide(1, 'Title slide', 'Probe deck title', 'The first page'), slide(2, 'Title and body', 'Probe body page', 'The second page')].join('\n');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.clock.setFixedTime(new Date('2026-09-23T09:00:00'));
page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
await page.goto(`http://localhost:${PORT}/dog`, { waitUntil: 'networkidle' });
await page.getByText('Generate Page Outline').first().waitFor({ timeout: 20000 });
await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });

const settle = () => page.waitForTimeout(250);
const shot = async (name) => { await settle(); await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log(`  ${name}`); };
const main = () => page.locator('main').first();
const scrollMain = (to) => main().evaluate((m, to) => { m.scrollTop = to === 'bottom' ? m.scrollHeight : 0; }, to);
const clickTitle = (t) => page.locator(`[title="${t}"]`).first().click();
const blur = () => page.evaluate(() => document.activeElement?.blur());
const park = () => page.mouse.move(W - 70, 12);   // over the orange bar, away from every control

// ── Sections 1 and 2 ────────────────────────────────────────────────────
await park();
await shot('01-default');
await page.locator('h2', { hasText: 'Generate Page Outline' }).first().hover();
await shot('02-hover-s2-header');
await park();
await page.getByPlaceholder(/pitch deck for a luxury brand/).click();
await shot('03-focus-context');
await blur();
await main().getByText('Use Uploaded Assets', { exact: true }).click();
await main().getByText('Theme Generator', { exact: true }).click();
await park();
await shot('04-checks-toggled');
await main().getByText('Use Uploaded Assets', { exact: true }).click();
await main().getByText('Theme Generator', { exact: true }).click();
await page.locator('select').first().selectOption({ label: 'Salt Hours' });
await park();
await shot('05-project-selected');
await page.getByRole('switch', { name: 'Full deck' }).click();
await park();
await shot('06-full-deck-on');
await page.locator('h2', { hasText: 'Generate Page Outline' }).first().hover();
await shot('07-full-deck-hover-s2-header');
await page.getByRole('switch', { name: 'Full deck' }).click();
await page.getByPlaceholder(/main characters with summaries/).click();
await shot('08-focus-page-request');
await blur();
await scrollMain('bottom');
await park();
await shot('09-output-empty');

// ── A deck, tabs, the view toggle, the formatting toolbar ──────────────
await clickTitle('Import/export history');
await page.getByRole('button', { name: 'Import', exact: true }).click();
await page.getByPlaceholder('Or paste DECKOUTLINE content here...').fill(DECK);
await page.getByRole('button', { name: 'Import to History' }).click();
if (await page.getByText('Import to History').count()) await page.keyboard.press('Escape');
await page.getByText('Probe deck title', { exact: true }).first().click();
await page.getByText('Probe body page', { exact: true }).first().click();
await scrollMain(0);
await park();
await shot('10-two-tabs-top');
await scrollMain('bottom');
await park();
await shot('11-two-tabs-output');
await page.locator('button', { hasText: 'Probe deck title' }).last().hover();
await shot('12-hover-inactive-tab');
await clickTitle('Layout visualizer');
await park();
await shot('13-visualizer');
await page.locator('[title="Text view"]').first().hover();
await shot('14-hover-text-view');
await clickTitle('Text view');
await main().locator('textarea').last().click();
await page.keyboard.press('End');
await page.keyboard.type('x');
await blur();
await park();
await shot('15-format-undo-enabled');
await page.locator('[title="Undo (text)"]').first().hover();
await shot('16-hover-format-undo');
await page.locator('[title="Redo (text)"]').first().hover();
await shot('17-hover-format-redo-disabled');

// ── The sidebar ─────────────────────────────────────────────────────────
await page.getByText('Probe body page', { exact: true }).first().hover();
await shot('18-hover-history-row');
await page.locator('[title="Remove from outline"]').nth(1).click({ force: true });
await park();
await shot('19-history-undo-enabled');
await page.locator('[title="Undo delete"]').first().hover();
await shot('20-hover-history-undo');

// ── Settings (A2's surface; the extraction covered it) ─────────────────
await page.locator('[aria-label="Navigation"]').first().click();
await page.getByRole('button', { name: 'Tool settings' }).click();
await park();
await shot('21-settings-locked');
await page.getByRole('button', { name: 'Output Format' }).hover();
await shot('22-settings-hover-tab');
await page.locator('.fixed button.w-11.h-6, [class*="fixed"] button.w-11.h-6').last().click();
await park();
await shot('23-settings-unlocked');
await page.getByText('Single Page - API System Message', { exact: true }).click();
await park();
await shot('24-settings-accordion-open');
await page.getByRole('button', { name: 'Reset to default' }).first().hover();
await shot('25-settings-hover-reset');
await page.getByRole('button', { name: 'Output Format' }).click();
await park();
await shot('26-settings-format-tab');
await clickTitle('Help & Documentation');
await park();
await shot('27-help');
const helpItems = page.locator('nav button');
if (await helpItems.count() > 1) { await helpItems.nth(1).hover(); await shot('28-help-hover-item'); }

await browser.close();
console.log(`✓ ${W}x${H} → ${OUT}`);
