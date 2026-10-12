#!/usr/bin/env node
/**
 * The Scenes tab's number fields, measured and photographed — post-overhaul
 * FX1 (2026-10-11), Audrey's "the chevrons are covering up the numbers".
 *
 *   node scripts/shot-number-fields-shots.mjs <port> --out <dir> [--size 1440x900] [--prefix po-fx1-] [--json <file>]
 *
 * On the dev fixtures' Salt Hours, Scenes: her picture first (the scene
 * table's nested shots at 2000, 6000 and 0, the pointer on one of them so its
 * chevrons show), then five and six digits (12345 and 123456) in the nest,
 * the shot table, the shot popup (Shot number, Frame count), the scene popup
 * (Scene number) and an edit's cut (a drag on the list, "Start new edit").
 *
 * Every number field on screen is measured: its box, its cell, the width
 * its text and five digits need in its own font, and where its chevrons
 * sit — the browser's (read through the DevTools protocol: they live in the
 * input's user-agent shadow root, which page script cannot reach) or the
 * field's own (`.rb-scene-number-step`) — and the gap between the last digit
 * and them: below zero, the digits run under the chevrons; `hidden` is how
 * much of the figure the field clips. The table goes to the console, the
 * numbers to --json.
 *
 * Each picture is `<prefix><nn>-<state>-<W>x<H>.png` (the viewport, one CSS
 * pixel a pixel) and, for the close-ups, `<prefix><nn>-<state>-zoom-<W>x<H>.png`
 * (the frames column at twice the size). Last, unphotographed, a seven-digit
 * figure in the cut at rest and focused (the tables' field holds six whole),
 * and a chevron held for 1.5 s: the steps it took (the browser's spinner took
 * 23 to 25 in the app, FX1 review round 2; fewer than 20 is flagged).
 * Needs the worktree's own dev server with the dev fixtures
 * (VITE_DEV_FIXTURES=1, VITE_DEV_AUTOLOGIN=tester; `fx1-worktree` in
 * .claude/launch.json), and changes nothing in the app unless the fixtures
 * badge says they are on (it stops before its first write; --out and --json
 * are still written). Changes nothing that outlives the page: the fixture
 * store is in memory and the browser context is fresh per run.
 * Animations and transitions are off and the caret is transparent, in this
 * page only. A state whose control is not found stops the run and says
 * which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const VALUED = ['--out', '--size', '--prefix', '--json'];
const PORT = args.find((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1])) || '5290';
const OUT = flag('--out');
if (!OUT) { console.error('usage: shot-number-fields-shots.mjs <port> --out <dir> [--size WxH] [--prefix p] [--json file]'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PREFIX = flag('--prefix') || 'po-fx1-';
const JSON_OUT = flag('--json');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const report = { size: `${W}x${H}`, fields: [] };
try {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-10-11T09:00:00'));
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');

  const sleep = (ms) => page.waitForTimeout(ms);
  let n = 0;
  const shot = async (state, zoomOn = null) => {
    n += 1;
    await sleep(250);
    const nn = String(n).padStart(2, '0');
    const file = `${PREFIX}${nn}-${state}-${W}x${H}.png`;
    await page.screenshot({ path: join(OUT, file), scale: 'css' });
    console.log(`  ${file}`);
    if (zoomOn) {
      // The frames column and its neighbours: the field, the cell either side.
      const b = await zoomOn.boundingBox();
      const x = Math.max(0, Math.round(b.x + b.width - 260));
      const y = Math.max(0, Math.round(b.y - 40));
      const zfile = `${PREFIX}${nn}-${state}-zoom-${W}x${H}.png`;
      await page.screenshot({ path: join(OUT, zfile), scale: 'device', clip: { x, y, width: Math.min(360, W - x), height: Math.min(140, H - y) } });
      console.log(`  ${zfile}`);
    }
  };
  const park = () => page.mouse.move(W - 70, 12);
  const button = (name, root = page) => root.getByRole('button', { name, exact: true }).first();
  const dialog = (name) => page.getByRole('dialog', { name, exact: true });
  const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
  /** The toolbar's Scenes | Shots (the page's own tab strip has a Scenes too). */
  const content = (name) => page.getByRole('tablist', { name: 'Content', exact: true }).getByRole('tab', { name, exact: true });
  const sceneRow = (name) => page.locator('tr.rb-scene-row', { has: page.getByRole('button', { name: `Select ${name}`, exact: true }) }).first();
  /** A field by its label; a label ending in "(cut " is a prefix (an edit's cut numbers its rows). */
  const fieldSel = (label) => (label.endsWith('(cut ') ? `input[aria-label^="${label}"]` : `input[aria-label="${label}"]`);
  const field = (label, root = page) => root.locator(fieldSel(label)).first();
  const must = async (loc, what) => {
    try { await loc.waitFor({ state: 'visible', timeout: 5000 }); } catch { throw new Error(`not found: ${what}`); }
    return loc;
  };
  const click = async (loc, what) => { await (await must(loc, what)).click(); };
  const setTo = async (label, value) => {
    const f = await must(field(label), label);
    await f.scrollIntoViewIfNeeded();
    await f.fill(String(value));
    await f.evaluate((el) => el.blur());
  };
  /** A native drag by the grip, ending over the top half of `target`. */
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

  // ── The browser's chevrons, through the DevTools protocol ──
  const attr = (node, k) => { const a = node.attributes || []; for (let i = 0; i < a.length; i += 2) if (a[i] === k) return a[i + 1]; return undefined; };
  const kids = (node) => [...(node.shadowRoots || []), ...(node.children || []), ...(node.contentDocument ? [node.contentDocument] : [])];
  const edges = async (node) => {
    try {
      const { model } = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId });
      const q = model.content;
      return { left: Math.min(q[0], q[6]), right: Math.max(q[2], q[4]), width: Math.max(q[2], q[4]) - Math.min(q[0], q[6]) };
    } catch { return null; }
  };
  const nativeParts = async (label, nth) => {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const inputs = [];
    const named = (v) => (label.endsWith('(cut ') ? (v || '').startsWith(label) : v === label);
    const walk = (node) => { if (node.nodeName === 'INPUT' && named(attr(node, 'aria-label'))) inputs.push(node); for (const c of kids(node)) walk(c); };
    walk(root);
    const input = inputs[nth];
    if (!input) return null;
    const ua = (input.shadowRoots || []).find((s) => s.shadowRootType === 'user-agent');
    let spin = null; let port = null;
    const walk2 = (node) => {
      if (attr(node, 'pseudo') === '-webkit-inner-spin-button') spin = node;
      if (attr(node, 'id') === 'editing-view-port') port = node;
      for (const c of node.children || []) walk2(c);
    };
    if (ua) walk2(ua);
    let opacity = null;
    if (spin) {
      try {
        const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId: spin.nodeId });
        opacity = (computedStyle.find((p) => p.name === 'opacity') || {}).value ?? null;
      } catch { /* the node went away */ }
    }
    return { spin: spin && await edges(spin), port: port && await edges(port), opacity };
  };

  /** One field, measured where it stands. `where` names the surface. */
  const measure = async (where, label, { nth = 0 } = {}) => {
    const loc = page.locator(fieldSel(label)).nth(nth);
    await must(loc, label);
    const m = await loc.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const px = (v) => parseFloat(v) || 0;
      const content = { left: r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft), right: r.right - px(cs.borderRightWidth) - px(cs.paddingRight) };
      const probe = document.createElement('span');
      for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariantNumeric', 'fontFeatureSettings', 'letterSpacing']) probe.style[p] = cs[p];
      probe.style.position = 'absolute'; probe.style.visibility = 'hidden'; probe.style.whiteSpace = 'pre';
      document.body.appendChild(probe);
      const w = (t) => { probe.textContent = t; return probe.getBoundingClientRect().width; };
      const wrap = el.parentElement;
      const cap = wrap && wrap.querySelector(':scope > .rb-scene-number-cap');
      const step = wrap && wrap.querySelector(':scope > .rb-scene-number-step');
      const capShown = !!cap && getComputedStyle(cap).display !== 'none' && getComputedStyle(cap).visibility !== 'hidden';
      const shown = capShown ? cap.textContent : el.value;
      const cell = el.closest('td') || el.closest('.rb-scene-prop');
      const cr = cell && cell.getBoundingClientRect();
      const sr = step && step.getBoundingClientRect();
      const capR = capShown && cap.getBoundingClientRect();
      const out = {
        type: el.type, value: el.value, shown, title: el.title || null, focused: document.activeElement === el,
        field: { left: r.left, right: r.right, width: r.width }, content, align: cs.textAlign,
        font: `${cs.fontSize} ${cs.fontFamily.split(',')[0]} ${cs.fontVariantNumeric}`,
        cell: cr ? { left: cr.left, right: cr.right, width: cr.width } : null,
        textW: w(shown), w5: w('99999'), w5e: w('12345…'), w6: w('123456'),
        own: sr ? { left: sr.left, right: sr.right, width: sr.width, showing: getComputedStyle(step).visibility === 'visible' } : null,
        cap: capR ? { left: capR.left, right: capR.right } : null,
      };
      probe.remove();
      return out;
    });
    const native = m.own ? null : await nativeParts(label, nth);
    // Where the figure ends and the chevrons begin: a right-aligned figure
    // ends at its room's right edge, a left-aligned one its own width in
    // (the cap sits in the same room, aligned as the field's text is).
    let avail; let textRight; let chevLeft; let overlap = null;
    const atEnd = m.align === 'right' || m.align === 'end';
    if (m.own) {
      avail = m.content.right - m.content.left;
      textRight = atEnd ? m.content.right : m.content.left + Math.min(m.textW, avail);
      chevLeft = m.own.left;
    } else if (native && native.port && native.spin) {
      avail = native.port.width;
      textRight = atEnd ? native.port.right : native.port.left + Math.min(m.textW, avail);
      chevLeft = native.spin.left;
      overlap = +(native.port.right - native.spin.left).toFixed(1);
    } else {
      avail = m.content.right - m.content.left;
      textRight = m.content.right;
      chevLeft = null;
    }
    const row = {
      where, label, type: m.type, value: m.value, shown: m.shown, title: m.title, focused: m.focused,
      field: +m.field.width.toFixed(1), cell: m.cell ? +m.cell.width.toFixed(1) : null, font: m.font,
      textW: +m.textW.toFixed(1), avail: +avail.toFixed(1), w5: +m.w5.toFixed(1), w5e: +m.w5e.toFixed(1), w6: +m.w6.toFixed(1),
      hidden: +Math.max(0, m.textW - avail).toFixed(1),
      chevrons: m.own ? 'own' : (native && native.spin ? 'browser' : 'none'),
      chevW: m.own ? +m.own.width.toFixed(1) : (native && native.spin ? +native.spin.width.toFixed(1) : null),
      gap: chevLeft == null ? null : +(chevLeft - textRight).toFixed(1),
      portOverSpin: overlap,
      // Whether the chevrons are drawn now: the browser's by their opacity
      // (0 until the field is pointed at or focused), the field's own by
      // their visibility (the same moments).
      chevShown: m.own ? m.own.showing : (native && native.opacity != null ? native.opacity === '1' : null),
      fits5: m.w5 <= avail + 0.01, fits5e: m.w5e <= avail + 0.01,
    };
    report.fields.push(row);
    return row;
  };
  const print = (rows) => {
    for (const r of rows) {
      console.log(`    ${r.where.padEnd(12)} ${r.label.padEnd(30)} ${String(r.shown).padStart(8)}  field ${r.field}  cell ${r.cell}  text ${r.textW}/${r.avail}  hidden ${r.hidden}  ${r.chevrons} ${r.chevW ?? ''}  gap ${r.gap}  5:${r.fits5 ? 'fits' : 'NO'}  5…:${r.fits5e ? 'fits' : 'NO'}  chevrons ${r.chevShown ? 'drawn' : 'not drawn'}${r.title ? `  title ${r.title}` : ''}${r.focused ? '  (focused)' : ''}`);
    }
  };

  // The script writes frame counts and starts an edit: only ever on the dev
  // fixtures' in-memory store, never on a server signed in to real data
  // (FX1 review round 1, R1-12). The badge's switch says they are on.
  await must(page.getByRole('button', { name: 'Turn dev fixtures off', exact: true }), 'the dev fixtures badge (fixtures ON) — refusing to write to this server');

  // ── Salt Hours, Scenes: the scene table ──
  await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
  await click(tab('Scenes'), 'the Scenes tab');
  await must(sceneRow('Lighthouse, dawn'), 'the scene table');

  // Her picture: Lighthouse, dawn's three shots at 2000, 6000 and 0.
  await click(sceneRow('Lighthouse, dawn').getByRole('button', { name: 'Show shots', exact: true }), 'Show shots of Lighthouse, dawn');
  await setTo('Frames for The door', 2000);
  await setTo('Frames for The cold lamp', 6000);
  await setTo('Frames for Up the stair', 0);
  console.log(`  ${W}x${H} — the nest, her picture:`);
  print([await measure('nest', 'Frames for The door'), await measure('nest', 'Frames for The cold lamp'), await measure('nest', 'Frames for Up the stair')]);
  await field('Frames for The door').scrollIntoViewIfNeeded();
  await field('Frames for The door').hover();
  console.log('    (the pointer on The door\'s field)');
  print([await measure('nest-hover', 'Frames for The door')]);
  await shot('nest-2000-6000-0', field('Frames for The door'));

  // Five and six digits, at rest and focused.
  await click(sceneRow('Cliff path').getByRole('button', { name: 'Show shots', exact: true }), 'Show shots of Cliff path');
  await setTo('Frames for The path, wide', 12345);
  await setTo('Frames for The compass', 123456);
  await park();
  console.log(`  ${W}x${H} — the nest, five and six digits:`);
  print([await measure('nest', 'Frames for The path, wide'), await measure('nest', 'Frames for The compass')]);
  await field('Frames for The compass').scrollIntoViewIfNeeded();
  await shot('nest-five-six-digits', field('Frames for The compass'));
  await field('Frames for The compass').click();
  print([await measure('nest-focus', 'Frames for The compass')]);
  await shot('nest-six-digits-focused', field('Frames for The compass'));
  await field('Frames for The compass').evaluate((el) => el.blur());

  // ── The shot table ──
  await click(content('Shots'), 'Shots, in the content tabs');
  await must(field('Frames for The compass'), 'the shot table');
  await park();
  console.log(`  ${W}x${H} — the shot table:`);
  print([
    await measure('shots', 'Frames for The door'), await measure('shots', 'Frames for The cold lamp'), await measure('shots', 'Frames for Up the stair'),
    await measure('shots', 'Frames for The path, wide'), await measure('shots', 'Frames for The compass'),
  ]);
  await field('Frames for The compass').scrollIntoViewIfNeeded();
  await field('Frames for The compass').hover();
  await shot('shot-table', field('Frames for The compass'));

  // ── The shot popup: Shot number and Frame count ──
  const compass = page.locator('tr.rb-scene-row', { has: field('Frames for The compass') }).first();
  await compass.hover();
  await click(compass.getByRole('button', { name: 'View details', exact: true }), 'View details of The compass');
  const shotPop = page.getByRole('dialog').filter({ has: field('Frame count') }).first();
  await must(shotPop, 'the shot popup');
  await park();
  console.log(`  ${W}x${H} — the shot popup:`);
  print([await measure('shot-popup', 'Shot number'), await measure('shot-popup', 'Frame count')]);
  await shot('shot-popup', field('Frame count'));
  await field('Frame count').click();
  print([await measure('popup-focus', 'Frame count')]);
  await shot('shot-popup-focused', field('Frame count'));
  await page.keyboard.press('Escape');
  await sleep(200);
  if (await shotPop.isVisible()) { await page.keyboard.press('Escape'); await sleep(200); }

  // ── The scene popup: Scene number ──
  await click(content('Scenes'), 'Scenes, in the content tabs');
  const lighthouse = sceneRow('Lighthouse, dawn');
  await lighthouse.hover();
  await click(lighthouse.getByRole('button', { name: 'View details', exact: true }), 'View details of Lighthouse, dawn');
  const scenePop = page.getByRole('dialog').filter({ has: field('Scene number') }).first();
  await must(scenePop, 'the scene popup');
  await park();
  console.log(`  ${W}x${H} — the scene popup:`);
  print([await measure('scene-popup', 'Scene number')]);
  await shot('scene-popup', field('Scene number'));
  await page.keyboard.press('Escape');
  await sleep(200);
  if (await scenePop.isVisible()) { await page.keyboard.press('Escape'); await sleep(200); }

  // ── An edit's cut: The storm dragged before Cliff path, "Start new edit" ──
  await must(sceneRow('The storm'), 'The storm');
  await dragTo(sceneRow('The storm').locator('.rb-scene-num-cell .rb-scene-grip'), sceneRow('Cliff path'));
  await click(button('Start new edit', dialog('Make a new edit from this list?')), 'Start new edit');
  await must(field('Frames for The compass (cut '), 'the cut');
  await park();
  console.log(`  ${W}x${H} — an edit's cut:`);
  print([await measure('cut', 'Frames for The door (cut '), await measure('cut', 'Frames for The path, wide (cut '), await measure('cut', 'Frames for The compass (cut ')]);
  await field('Frames for The compass (cut ').scrollIntoViewIfNeeded();
  await field('Frames for The compass (cut ').hover();
  await shot('edit-cut', field('Frames for The compass (cut '));

  // Seven figures (review round 1, R1-02): the tables' field holds six whole;
  // at rest the cap reads the first five, focused the figure scrolls inside
  // the field, as any field's text does. Measured, not photographed.
  await setTo('Frames for The door (cut ', 1234567);
  await park();
  console.log(`  ${W}x${H} — seven figures, in the cut:`);
  print([await measure('cut-seven', 'Frames for The door (cut ')]);
  await field('Frames for The door (cut ').click();
  print([await measure('cut-7-focus', 'Frames for The door (cut ')]);
  await field('Frames for The door (cut ').evaluate((el) => el.blur());

  // A chevron held for 1.5 s (review round 2, R2-01): the steps it takes.
  const held = 'Frames for The path, wide (cut ';
  await setTo(held, 1000);
  await field(held).hover();
  const chevron = page.locator(`button[aria-label^="Increase ${held}"]`).first();
  const cb = await (await must(chevron, 'the Increase chevron of The path, wide')).boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await sleep(1500);
  await page.mouse.up();
  await sleep(300);
  const steps = Number(await field(held).inputValue()) - 1000;
  report.hold = { ms: 1500, steps };
  console.log(`  ${W}x${H} — a chevron held 1.5 s: ${steps} steps${steps < 20 ? '  ⚠ fewer than 20 (the browser took 23–25)' : ''}`);
} finally {
  await browser.close();
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
}
