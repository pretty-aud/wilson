#!/usr/bin/env node
/**
 * The orange Audrey named, measured in the running app — post-overhaul S2a
 * (2026-09-30).
 *
 *   node scripts/orange-probe.mjs <port> [--check] [--json <file>] [--shots <dir>] [--prefix <name>]
 *
 * Her C3 and C8 (docs/design/POST_OVERHAUL_PLAN.md §0.1): D.O.G.'s two
 * section titles and their numerals (reverting to the ink on the header's
 * hover wash), O.T.T.E.R.'s "Course library", the key caps' text in both
 * hotkey tables, and the two lesson cards' titles and icons are the signal
 * orange AS AN INK. tokens.test.js pins the token pairs; this reads what the
 * browser actually paints — each element's computed ink against the ground
 * under it (every translucent layer composited down to the first opaque
 * one) — in each state:
 *
 *   dog      the two titles and numerals at rest; Section 1's under the
 *            pointer (the wash); "Generated output" (stays grey); Section 2
 *            in Full deck mode (the disabled third ink)
 *   otter    "Course library"; a key cap on the Hotkeys view; a matching
 *            and a non-matching row's key cap in the Search dialog's table;
 *            the two lesson cards' titles and icons
 *
 * `--check` fails if an orange element is not the signal, a revert is not
 * the ink, or any text pair is under 4.5:1 (an icon under 3:1). `--shots`
 * writes the pictures the hand-off needs at both sizes: D.O.G. with a
 * document loaded (so its primary button is lit), its header hovered, the
 * Hotkeys view, the Search dialog's hotkey table and a lesson's two cards.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1. It writes nothing that outlives the page: a small
 * text file is attached in the page (React state), nothing is generated.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const VALUED = ['--json', '--shots', '--prefix'];
const positional = args.filter((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1]));
const PORT = positional[0] || '5273';
const BASE = `http://localhost:${PORT}`;
const CHECK = args.includes('--check');
const JSON_OUT = flag('--json');
const SHOTS = flag('--shots');
const PREFIX = flag('--prefix') || 'orange';
const SIZES = [[1440, 900], [1280, 700]];
const SIGNAL = 'rgb(234, 88, 12)';
const INK = 'rgb(245, 240, 236)';
const INK_3 = 'rgb(141, 137, 134)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** In the page: the first VISIBLE element for `sel` (every page stays mounted),
    its computed ink, the ground composited under it, and the ratio. */
function measure({ sel, nth = 0 }) {
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const el = [...document.querySelectorAll(sel)].filter(shown)[nth];
  if (!el) return { sel, error: 'not found' };
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
    return [Number(r), Number(g), Number(b), Number(a)];
  };
  const layers = [];
  for (let n = el; n; n = n.parentElement) {
    const bg = parse(getComputedStyle(n).backgroundColor);
    if (bg && bg[3] > 0) { layers.push(bg); if (bg[3] >= 1) break; }
  }
  let ground = [255, 255, 255];
  for (const [r, g, b, a] of layers.reverse()) ground = [r * a + ground[0] * (1 - a), g * a + ground[1] * (1 - a), b * a + ground[2] * (1 - a)];
  // The ink the glyph is painted in: `-webkit-text-fill-color` wins over
  // `color` when set, and every ancestor's opacity thins it over the ground
  // (review round 1, G-R1-10: a title at opacity .5 reported 4.54).
  const cs = getComputedStyle(el);
  const fill = parse(cs.webkitTextFillColor || '');
  const painted = fill && cs.webkitTextFillColor !== cs.color ? fill : parse(cs.color);
  let alpha = painted ? painted[3] : 1;
  for (let n = el; n; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity);
  const ink = painted ? painted.slice(0, 3).map((v, i) => v * alpha + ground[i] * (1 - alpha)) : null;
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [hi, lo] = [lum(ink), lum(ground)].sort((a, b) => b - a);
  const r = el.getBoundingClientRect();
  return {
    sel,
    text: (el.textContent || '').trim().slice(0, 40),
    color: cs.color,
    opacity: Math.round(alpha * 1000) / 1000,
    // What the glyph is when selected (V-R1-02: the selection screen).
    selectionColor: getComputedStyle(el, '::selection').color,
    ground: `rgb(${ground.map((v) => Math.round(v)).join(', ')})`,
    ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
    box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
  };
}

async function openPage(browser, W, H, path, ready) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.error(`  pageerror (${path} ${W}x${H}): ${e.message}`));
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.getByText(ready).first().waitFor({ timeout: 25000 });
  await sleep(1500);
  return page;
}
const inPage = (page) => ({
  measure: (sel, nth = 0) => page.evaluate(measure, { sel, nth }),
  clickText: (text) => page.evaluate((text) => {
    const shown = (e) => e.getClientRects().length > 0;
    const hit = [...document.querySelectorAll('button, [role="button"], [role="tab"], h1, h2, h3, h4')]
      .filter(shown).find((e) => (e.textContent || '').trim() === text);
    if (!hit) return false;
    (hit.closest('button, [role="button"], [role="tab"]') || hit).click();
    return true;
  }, text),
});
const shot = async (page, name, W, H) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(W - 70, 12).catch(() => {});
  await page.screenshot({ path: join(SHOTS, `${PREFIX}-${name}-${W}x${H}.png`) });
};

async function dog(browser, W, H) {
  const page = await openPage(browser, W, H, '/dog', 'Generate Page Outline');
  const p = inPage(page);
  const out = {};
  out.title1 = await p.measure('.dog-step-title', 0);
  out.title2 = await p.measure('.dog-step-title', 1);
  out.step1 = await p.measure('.dog-step', 0);
  out.step2 = await p.measure('.dog-step', 1);
  out.generatedOutput = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2.dog-card-title')].find((e) => /Generated output/.test(e.textContent));
    return h ? { color: getComputedStyle(h).color, stepTitle: h.classList.contains('dog-step-title') } : { error: 'not found' };
  });
  // Section 1's header under the pointer: the wash, and the ink.
  await page.locator('.dog-step-title').first().hover();
  await sleep(400);   // the 120ms transition, with room
  out.title1Hover = await p.measure('.dog-step-title', 0);
  out.step1Hover = await p.measure('.dog-step', 0);
  out.headHoverGround = await page.evaluate(() => getComputedStyle(document.querySelector('.dog-card-head')).backgroundColor);
  if (SHOTS) await shot(page, 'dog-header-hover', W, H);
  await page.mouse.move(W - 70, 12);
  await sleep(400);
  // A document attached (in the page), a layout and a request: the page
  // outline's primary button is lit. Nothing is generated.
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'probe-brief.md', mimeType: 'text/markdown', buffer: Buffer.from('# Probe brief\n\nA short document so the generate buttons light up.\n') });
  await sleep(800);
  await page.evaluate(() => {
    const sel = [...document.querySelectorAll('select.dog-select')].find((s) => s.getClientRects().length > 0 && s.options.length > 1 && /layout/i.test(s.options[0].textContent));
    if (!sel) return;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, sel.options[1].value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const request = page.locator('textarea.dog-page-request').first();
  if (await request.count()) await request.fill('A title page for the probe deck.');
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(400);
  out.generateButton = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.dog-generate')].find((e) => e.getClientRects().length > 0);
    return b ? { disabled: b.disabled, background: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color, text: b.textContent.trim() } : { error: 'not found' };
  });
  if (SHOTS) await shot(page, 'dog-document-loaded', W, H);
  // Full deck mode: Section 2 is disabled, its title the third ink.
  await page.getByRole('switch', { name: 'Full deck' }).first().click();
  await sleep(400);
  out.title2FullDeck = await p.measure('.dog-step-title', 1);
  out.step2FullDeck = await p.measure('.dog-step', 1);
  await page.close();
  return out;
}

async function otter(browser, W, H) {
  const page = await openPage(browser, W, H, '/otter', 'Course library');
  const p = inPage(page);
  const out = {};
  out.courseLibrary = await p.measure('.otter-library-title .ui-section-title');
  out.otherViewTitles = await page.evaluate(() => [...document.querySelectorAll('.otter-view-title:not(.otter-library-title) .ui-section-title')]
    .map((e) => ({ text: e.textContent.trim().slice(0, 30), color: getComputedStyle(e).color })));
  if (SHOTS) await shot(page, 'otter-library', W, H);
  // The Hotkeys view needs the course open.
  await p.clickText('DaVinci Resolve 19');
  await sleep(2500);
  await p.clickText('Hotkeys');
  await sleep(1500);
  out.hotkeysTitle = await p.measure('.otter-view-title .ui-section-title');
  out.hotkeyCap = await p.measure('.otter-hk-card:not(.otter-search-hk) .ui-kbd');
  if (SHOTS) await shot(page, 'otter-hotkeys', W, H);
  // The Search dialog's hotkey table: a query that one shortcut matches.
  await p.clickText('Search');
  await sleep(600);
  await page.getByPlaceholder('Search lessons, hotkeys, functions, nodes...').fill('Blade');
  await sleep(1500);
  const picked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ui-dialog [data-active]')].filter((e) => e.getClientRects().length > 0);
    const hk = rows.find((r) => /hotkey|shortcut/i.test(r.textContent)) || rows[0];
    if (!hk) return false;
    hk.click();
    return true;
  });
  await sleep(800);
  out.searchPicked = picked;
  out.searchCapMatch = await page.evaluate(measure, { sel: ".otter-search-hk .ui-tr:not([data-inactive='true']) .ui-kbd" });
  out.searchCapDim = await page.evaluate(measure, { sel: ".otter-search-hk .ui-tr[data-inactive='true'] .ui-kbd" });
  if (SHOTS) await shot(page, 'otter-search-hotkeys', W, H);
  await page.close();
  // A lesson, on a fresh page (ui-shots.mjs's driveToLesson): the course,
  // then its first subject, opens the first lesson — which has both cards.
  const lesson = await openPage(browser, W, H, '/otter', 'Course library');
  const l = inPage(lesson);
  await l.clickText('DaVinci Resolve 19');
  await sleep(3500);
  await l.clickText('Project setup and media');
  await sleep(4000);
  out.lessonOpen = await lesson.evaluate(() => !!document.querySelector('.lesson-content'));
  return { ...out, ...(await lessonCards(lesson, W, H)) };
}

async function lessonCards(page, W, H) {
  const p = inPage(page);
  const out = {};
  out.lessonTitle1 = await p.measure('.otter-lesson-card .ui-card-title', 0);
  out.lessonTitle2 = await p.measure('.otter-lesson-card .ui-card-title', 1);
  out.lessonIcon1 = await p.measure('.otter-card-icon', 0);
  out.lessonIcon2 = await p.measure('.otter-card-icon', 1);
  if (SHOTS) {
    await page.locator('.otter-lesson-card').first().scrollIntoViewIfNeeded().catch(() => {});
    await sleep(300);
    await shot(page, 'otter-lesson-cards', W, H);
  }
  await page.close();
  return out;
}

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const results = {};
try {
  for (const [W, H] of SIZES) {
    results[`${W}x${H}`] = { dog: await dog(browser, W, H), otter: await otter(browser, W, H) };
  }
} finally {
  await browser.close();
}
const out = JSON.stringify(results, null, 2);
console.log(out);
if (JSON_OUT) writeFileSync(JSON_OUT, out + '\n');

if (CHECK) {
  const bad = [];
  for (const [size, { dog: d, otter: o }] of Object.entries(results)) {
    const orange = (name, m, min = 4.5) => {
      if (!m || m.error) { bad.push(`${size} ${name}: ${m?.error || 'not measured'}`); return; }
      if (m.color !== SIGNAL) bad.push(`${size} ${name}: ${m.color}, not the signal`);
      if (m.ratio < min) bad.push(`${size} ${name}: ${m.ratio}:1 on ${m.ground}, under ${min}`);
      // Selected, the orange sits on the selection screen and fails: the ink.
      if (m.selectionColor !== INK) bad.push(`${size} ${name}: selected, it paints ${m.selectionColor}, not the ink`);
    };
    const is = (name, m, want, min = 4.5) => {
      if (!m || m.error) { bad.push(`${size} ${name}: ${m?.error || 'not measured'}`); return; }
      if (m.color !== want) bad.push(`${size} ${name}: ${m.color}, not ${want}`);
      if (m.ratio < min) bad.push(`${size} ${name}: ${m.ratio}:1 on ${m.ground}, under ${min}`);
    };
    orange('D.O.G. title 1', d.title1); orange('D.O.G. title 2', d.title2);
    orange('D.O.G. numeral 1', d.step1); orange('D.O.G. numeral 2', d.step2);
    is('D.O.G. title 1 on the wash', d.title1Hover, INK); is('D.O.G. numeral 1 on the wash', d.step1Hover, INK);
    if (d.headHoverGround === 'rgba(0, 0, 0, 0)') bad.push(`${size} D.O.G.: the header took no wash under the pointer (the hover was not measured)`);
    // Fail closed: a control that was not found is a breach, never a pass
    // (review round 1, G-R1-10).
    if (!d.generatedOutput || d.generatedOutput.error) bad.push(`${size} D.O.G.: "Generated output" was not found`);
    else if (d.generatedOutput.color === SIGNAL || d.generatedOutput.stepTitle) bad.push(`${size} D.O.G.: "Generated output" is orange`);
    if (!d.generateButton || d.generateButton.disabled !== false) bad.push(`${size} D.O.G.: the page-outline button is not lit (${JSON.stringify(d.generateButton)})`);
    is('D.O.G. title 2, Full deck', d.title2FullDeck, INK_3); is('D.O.G. numeral 2, Full deck', d.step2FullDeck, INK_3);
    orange('"Course library"', o.courseLibrary);
    if (!(o.otherViewTitles || []).length) bad.push(`${size} O.T.T.E.R.: no other view title was read (the check is blind)`);
    for (const t of o.otherViewTitles || []) if (t.color === SIGNAL) bad.push(`${size} O.T.T.E.R.: "${t.text}" is orange`);
    if (!o.hotkeysTitle || o.hotkeysTitle.error || o.hotkeysTitle.text !== 'Keyboard shortcuts') bad.push(`${size} O.T.T.E.R.: the Hotkeys title was not found (${JSON.stringify(o.hotkeysTitle?.text)})`);
    else if (o.hotkeysTitle.color === SIGNAL) bad.push(`${size} O.T.T.E.R.: "Keyboard shortcuts" is orange`);
    orange('Hotkeys key cap', o.hotkeyCap);
    orange('Search key cap (a match)', o.searchCapMatch);
    is('Search key cap (not a match)', o.searchCapDim, INK_3);
    orange('lesson card title 1', o.lessonTitle1); orange('lesson card title 2', o.lessonTitle2);
    orange('lesson card icon 1', o.lessonIcon1, 3); orange('lesson card icon 2', o.lessonIcon2, 3);
  }
  if (bad.length) { console.error(`\n✗ ${bad.length} breach(es):\n  ${bad.join('\n  ')}`); process.exit(1); }
  console.error('\n✓ every named orange is the signal on a legible ground; the wash reverts to the ink; Full deck is the third ink; nothing else turned orange');
}
