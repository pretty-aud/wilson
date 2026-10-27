#!/usr/bin/env node
/**
 * D.O.G.'s uploads, measured and photographed in real Chromium — post-overhaul
 * DG2 (2026-10-26, Audrey's ask: the Upload Documents section moves into card
 * 2, References, as a first group of rows; card 1 becomes "1 Project").
 *
 *   node scripts/dg2-uploads-shots.mjs <port> --out <dir> [--size 1440x900] [--tag before|after] [--no-shots]
 *
 * Headless Chromium (no window on screen), closed in a `finally`. Needs the
 * dev server with the dev fixtures' tester (`dg2-worktree` in
 * .claude/launch.json). Nothing outlives the page: the fixture store is in
 * memory, nothing is saved, and no AI call is made (the tester has no
 * session, so a generation stops inside callAI before any request; every
 * part counts requests to an Edge Function, which must stay 0).
 *
 * 🚨 A file name is content. Every upload here is neutral: the dev fixtures'
 * own video (src/dev/fixtures/data/clip-noise.mp4), WILSON's own logo
 * (public/logo.png), and made-up text files named note-NN.txt. Never a real
 * file, so no real name reaches a picture, the JSON or the console.
 *
 * Written so the same run reads both layouts (before: the chips in card 1;
 * after: the rows in References), selecting by what each layout draws.
 *
 * What it measures:
 *   inputs    the upload's file inputs: which card holds them, `accept`,
 *             whether the input or its <label> can take focus, and the role
 *             and name Chromium gives each (CDP)
 *   walk      a Tab walk of D.O.G.'s page, no upload, then with the two
 *             neutral uploads: every stop by Chromium's role and name, and
 *             whether Tab ever reaches a file input or its label
 *   choose    Enter on the Choose file control, from wherever focus can be
 *             put on it, and the pointer's click: whether a file picker opens
 *   behaviour a kind `accept` admits but the handler refuses (its words), a
 *             duplicate name, the 20-file ceiling (what is left to press at
 *             19 and at 20), Remove, and the chips' columns at 7
 *   card      the References card's words in each state (no project, a
 *             project, two uploads, a reference chosen, over the limit,
 *             folded), the contract sentence, the header's count, the
 *             meter's words and hover with two uploads, Remove all
 *   enter     FX13's rule with an upload: the box empty asks, with words a
 *             full deck starts (to callAI's boundary, never past it)
 *
 * Writes `po-dg2-<tag>-<W>x<H>.json` into --out and prints a summary;
 * pictures `po-dg2-<tag>-<nn>-<what>-<W>x<H>.png` of cards 1 and 2.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const VALUED = ['--out', '--size', '--tag', '--only'];
const PORT = args.find((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1])) || '5306';
const OUT = flag('--out');
const TAG = flag('--tag') || 'now';
const SHOTS = !args.includes('--no-shots');
if (!OUT) {
  console.error('usage: dg2-uploads-shots.mjs <port> --out <dir> [--size WxH] [--tag before|after] [--no-shots]');
  process.exit(1);
}
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
mkdirSync(OUT, { recursive: true });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The two neutral uploads (never a real file: a file name is content). */
const NEUTRAL = [
  { name: 'clip-noise.mp4', mimeType: 'video/mp4', buffer: readFileSync(join(ROOT, 'src/dev/fixtures/data/clip-noise.mp4')) },
  { name: 'logo.png', mimeType: 'image/png', buffer: readFileSync(join(ROOT, 'public/logo.png')) },
];
const note = (n, body = 'A neutral test note.') => ({ name: `note-${String(n).padStart(2, '0')}.txt`, mimeType: 'text/plain', buffer: Buffer.from(body) });

const NO_MOTION = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
const SWITCH = '.dog-full-deck [role=switch]';
const BOX = 'textarea.dog-context-prompt';
const UPLOAD = 'input[type=file][accept*=".txt"]';
// Both layouts: the chips (before) and the uploads group's rows (after).
const UPLOAD_ROWS = '.dog-file-chip, .dog-refs-uploads .dog-refs-row';
const CONTEXT = 'A pitch deck for a watch launch, five pages.';

/** Chromium's own role and name for an element, from its accessibility tree
    over CDP (FX14: CSS text-transform shows as a screen reader hears it). */
async function axOf(page, handleExpr) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Accessibility.enable');
    const { result } = await cdp.send('Runtime.evaluate', { expression: handleExpr });
    if (!result.objectId) return null;
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
    const n = nodes.find((x) => !x.ignored) || nodes[0] || {};
    const states = (n.properties || []).filter((p) => ['expanded', 'checked', 'focusable'].includes(p.name)).map((p) => `${p.name}=${p.value?.value}`);
    return { role: n.role?.value || '?', name: n.name?.value || '', ignored: !!n.ignored, states };
  } finally {
    await cdp.detach().catch(() => {});
  }
}
const fmt = (a) => (a ? `${a.role} "${a.name}"${a.states.length ? ` [${a.states.join(' ')}]` : ''}${a.ignored ? ' (ignored)' : ''}` : '(none)');
async function focusedName(page) {
  if (await page.evaluate(() => !document.activeElement || document.activeElement === document.body)) return '(nothing: <body>)';
  return fmt(await axOf(page, 'document.activeElement')).slice(0, 100);
}

async function openDog(browser) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const seen = { boundary: 0, requests: 0 };
  page.on('console', (m) => { if (m.type() === 'error' && /AIProxyError|Sign in to use AI/.test(m.text())) seen.boundary++; });
  page.on('request', (r) => { if (/\/functions\/v1\//.test(r.url())) seen.requests++; });
  // A cold dev server serves several thousand modules: up to two minutes.
  await page.goto(`http://localhost:${PORT}/dog`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.addStyleTag({ content: NO_MOTION });
  await page.waitForSelector(SWITCH, { timeout: 30000 });
  await page.evaluate(() => document.activeElement?.blur());
  return { ctx, page, seen };
}
const rowCount = (page) => page.evaluate((s) => document.querySelectorAll(s).length, UPLOAD_ROWS);
async function upload(page, file) {
  const before = await rowCount(page);
  await page.setInputFiles(UPLOAD, file);
  await page.waitForFunction(([s, n]) => document.querySelectorAll(s).length > n, [UPLOAD_ROWS, before], { timeout: 15000 });
}
async function chooseProject(page) {
  const options = await page.$$eval('.dog-project-select option', (os) => os.map((o) => ({ value: o.value, label: o.textContent.trim() })));
  const first = options.find((o) => o.value);
  if (!first) throw new Error('the project dropdown lists no project');
  await page.selectOption('.dog-project-select', first.value);
  await page.waitForTimeout(400);
  return first.label;
}
const cardOf = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.closest('[id$="-body"]')?.id || '(no card body)'), sel);
const refsText = (page) => page.evaluate(() => ({
  head: document.querySelector('.dog-refs .dog-card-head')?.innerText.replace(/\s+/g, ' ').trim() || null,
  count: document.querySelector('.dog-refs-count')?.textContent.trim() || null,
  contract: document.querySelector('.dog-refs-contract')?.textContent.trim() || null,
  contractHover: document.querySelector('.dog-refs-contract')?.getAttribute('title') || null,
  groups: [...document.querySelectorAll('#dog-refs-body .dog-refs-group')].map((g) => ({
    label: g.querySelector('.dog-refs-group-label')?.textContent.trim(),
    aria: g.getAttribute('aria-label'),
    rows: [...g.querySelectorAll('.dog-refs-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
  })),
  order: [...(document.querySelector('#dog-refs-body')?.children || [])].map((c) => c.className.split(' ').find((k) => k.startsWith('dog-refs-') || k.startsWith('dog-details')) || c.tagName.toLowerCase()),
  meterWords: document.querySelector('#dog-refs-body .dog-refs-meter-words')?.textContent.trim() || null,
  meterHover: document.querySelector('#dog-refs-body .dog-refs-meter')?.getAttribute('title') || null,
  buttons: [...document.querySelectorAll('#dog-refs-body .dog-refs-actions button')].map((b) => b.textContent.trim()),
  card1: document.querySelector('#dog-card1-body')?.innerText.replace(/\s+/g, ' ').trim().slice(0, 400) || null,
  card1Title: document.querySelector('#dog-card1-title')?.textContent.trim() || null,
}));

// ── inputs ──────────────────────────────────────────────────────────────────
async function inputs(browser) {
  const { ctx, page, seen } = await openDog(browser);
  try {
    const empty = await page.evaluate((s) => [...document.querySelectorAll(s)].map((i) => {
      const label = i.closest('label');
      const can = (el) => { if (!el) return null; el.focus(); const ok = document.activeElement === el; el.blur(); return ok; };
      return {
        card: i.closest('[id$="-body"]')?.id || null,
        accept: i.getAttribute('accept'),
        display: getComputedStyle(i).display,
        inputTabIndex: i.tabIndex,
        inputFocusable: can(i),
        label: label ? { className: label.className, tabIndex: label.tabIndex, focusable: can(label), text: label.innerText.replace(/\s+/g, ' ').trim() } : null,
      };
    }), UPLOAD);
    const axInput = await axOf(page, `document.querySelector('${UPLOAD}')`);
    const axLabel = await axOf(page, `document.querySelector('${UPLOAD}')?.closest('label')`);
    await upload(page, NEUTRAL[0]);
    await upload(page, NEUTRAL[1]);
    const withTwo = { inputs: await cardOf(page, UPLOAD), rows: await rowCount(page), rowsIn: await cardOf(page, UPLOAD_ROWS) };
    // Every button in each upload row, by Chromium's name.
    const rowButtons = [];
    const n = await page.locator(`${UPLOAD_ROWS}`).count();
    for (let i = 0; i < n; i++) {
      const k = await page.evaluate(([s, i]) => document.querySelectorAll(s)[i].querySelectorAll('button, label').length, [UPLOAD_ROWS, i]);
      for (let j = 0; j < k; j++) {
        rowButtons.push(fmt(await axOf(page, `document.querySelectorAll('${UPLOAD_ROWS}')[${i}].querySelectorAll('button, label')[${j}]`)));
      }
    }
    const axChooseAfter = await axOf(page, `document.querySelector('${UPLOAD}')?.closest('label')`);
    return { empty, axInput: fmt(axInput), axLabel: fmt(axLabel), withTwo, rowButtons, axChooseWithTwo: fmt(axChooseAfter), requests: seen.requests };
  } finally { await ctx.close(); }
}

// ── walk ────────────────────────────────────────────────────────────────────
async function walkOnce(page) {
  // From the top: focus on <body> moves Chromium's sequential focus starting
  // point there, so the first Tab is the page's first stop.
  await page.evaluate(() => {
    const b = document.body;
    b.setAttribute('tabindex', '-1'); b.focus(); b.removeAttribute('tabindex');
    window.scrollTo(0, 0);
  });
  const stops = [];
  let first = null;
  for (let i = 0; i < 200; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      // One id per element (two first-child icon buttons under one id'd
      // ancestor looked alike to a key built from attributes).
      window.__dg2Walk = window.__dg2Walk || { ids: new WeakMap(), n: 0 };
      const w = window.__dg2Walk;
      if (el && !w.ids.has(el)) w.ids.set(el, ++w.n);
      const key = el ? String(w.ids.get(el)) : '';
      return {
        key,
        inDog: !!el?.closest('.dog-main'),
        card: el?.closest('[id$="-body"]')?.id || (el?.closest('.dog-card-head') ? 'head' : null),
        fileish: !!el && (el.matches('input[type=file]') || el.tagName === 'LABEL'),
      };
    });
    const name = await focusedName(page);
    if (first && info.key === first) break;
    if (!first) first = info.key;
    stops.push({ n: stops.length + 1, name, inDog: info.inDog, card: info.card, fileish: info.fileish });
  }
  return { total: stops.length, inDog: stops.filter((s) => s.inDog).length, fileish: stops.filter((s) => s.fileish).length, stops };
}
async function walk(browser) {
  const out = { requests: 0 };
  {
    const { ctx, page, seen } = await openDog(browser);
    try { out.none = await walkOnce(page); out.requests += seen.requests; } finally { await ctx.close(); }
  }
  {
    const { ctx, page, seen } = await openDog(browser);
    try {
      await upload(page, NEUTRAL[0]);
      await upload(page, NEUTRAL[1]);
      out.two = await walkOnce(page);
      out.requests += seen.requests;
    } finally { await ctx.close(); }
  }
  return out;
}

// ── choose: Enter and the pointer on Choose file ─────────────────────────────
async function chooserOpens(page, act) {
  const wait = page.waitForEvent('filechooser', { timeout: 1500 }).then(() => true, () => false);
  await act();
  return wait;
}
async function choose(browser) {
  const { ctx, page, seen } = await openDog(browser);
  try {
    const out = {};
    // Whatever focus can be put on: the label, then the input.
    out.labelFocus = await page.evaluate((s) => { const l = document.querySelector(s)?.closest('label'); l?.focus(); return document.activeElement === l; }, UPLOAD);
    out.enterOnLabel = out.labelFocus ? await chooserOpens(page, () => page.keyboard.press('Enter')) : 'not focusable';
    out.inputFocus = await page.evaluate((s) => { const i = document.querySelector(s); i?.focus(); return document.activeElement === i; }, UPLOAD);
    out.enterOnInput = out.inputFocus ? await chooserOpens(page, () => page.keyboard.press('Enter')) : 'not focusable';
    await page.evaluate(() => document.activeElement?.blur());
    out.enterOnPage = await chooserOpens(page, () => page.keyboard.press('Enter'));
    out.click = await chooserOpens(page, () => page.locator(UPLOAD).first().locator('xpath=ancestor::label[1]').click());
    // With one upload: the control that adds another (before: the + on the
    // last chip; after: Choose file at the group's foot).
    await upload(page, note(1));
    out.addControls = await page.evaluate((s) => [...document.querySelectorAll(s)].map((i) => ({ card: i.closest('[id$="-body"]')?.id || null, label: i.closest('label')?.innerText.replace(/\s+/g, ' ').trim() || '', title: i.closest('label')?.getAttribute('title') || null })), UPLOAD);
    out.clickWithOne = await chooserOpens(page, () => page.locator(UPLOAD).first().locator('xpath=ancestor::label[1]').click());
    out.requests = seen.requests;
    return out;
  } finally { await ctx.close(); }
}

// ── behaviour ───────────────────────────────────────────────────────────────
async function behaviour(browser) {
  const { ctx, page, seen } = await openDog(browser);
  try {
    const out = {};
    out.accept = await page.getAttribute(UPLOAD, 'accept');
    // A kind `accept` does not list, given anyway (a picker's "All files"):
    // the handler's own refusal and where it is said.
    await page.setInputFiles(UPLOAD, { name: 'note-00.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('x') });
    await page.waitForTimeout(400);
    out.refused = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.dog-main *')].find((e) => e.children.length === 0 && /Please upload a PDF/.test(e.textContent));
      return el ? { words: el.textContent.trim(), where: el.closest('[class]')?.className || null } : null;
    });
    out.rowsAfterRefusal = await rowCount(page);
    // A duplicate name.
    await upload(page, note(1));
    await upload(page, note(1));
    out.duplicateRows = await rowCount(page);
    // Remove (the first row's last button).
    const removeName = await axOf(page, `[...document.querySelectorAll('${UPLOAD_ROWS}')[0].querySelectorAll('button')].pop()`);
    out.removeName = fmt(removeName);
    await page.evaluate((s) => [...document.querySelectorAll(s)[0].querySelectorAll('button')].pop().click(), UPLOAD_ROWS);
    await page.waitForTimeout(200);
    out.afterRemove = await rowCount(page);
    // Up to 7: the chips' columns (before), the rows (after).
    for (let n = 2; await rowCount(page) < 7; n++) await upload(page, note(n));
    out.at7 = await page.evaluate((s) => {
      const rows = [...document.querySelectorAll(s)];
      const xs = new Set(rows.map((r) => Math.round(r.getBoundingClientRect().left)));
      return { rows: rows.length, columns: xs.size, widths: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().width)))] };
    }, UPLOAD_ROWS);
    // The ceiling.
    for (let n = 8; await rowCount(page) < 19; n++) await upload(page, note(n));
    const left = () => page.evaluate((s) => ({ inputs: document.querySelectorAll(s).length, cards: [...document.querySelectorAll(s)].map((i) => i.closest('[id$="-body"]')?.id || null) }), UPLOAD);
    out.at19 = { rows: await rowCount(page), ...(await left()) };
    await upload(page, note(19));
    out.at20 = { rows: await rowCount(page), ...(await left()) };
    out.errorAt20 = await page.evaluate(() => [...document.querySelectorAll('.dog-main *')].find((e) => e.children.length === 0 && /Maximum 20/.test(e.textContent))?.textContent.trim() || null);
    // One removed at 20: the control comes back.
    await page.evaluate((s) => [...document.querySelectorAll(s)[0].querySelectorAll('button')].pop().click(), UPLOAD_ROWS);
    await page.waitForTimeout(200);
    out.at19again = { rows: await rowCount(page), ...(await left()) };
    out.requests = seen.requests;
    return out;
  } finally { await ctx.close(); }
}

// ── card ────────────────────────────────────────────────────────────────────
async function card(browser) {
  const { ctx, page, seen } = await openDog(browser);
  const dialog = () => page.locator('.ui-dialog.dog-refs-dialog');
  try {
    const out = {};
    out.noProject = await refsText(page);
    await upload(page, NEUTRAL[0]);
    await upload(page, NEUTRAL[1]);
    out.twoUploads = await refsText(page);
    out.project = await chooseProject(page);
    out.projectAndUploads = await refsText(page);
    // Two references chosen (Remove all shows from two).
    await page.getByRole('button', { name: 'Add references' }).click();
    await dialog().waitFor();
    await page.waitForSelector('.dog-refs-rail-item');
    await dialog().locator('.dog-refs-rail-item', { hasText: 'Scenes' }).click();
    await dialog().getByRole('checkbox', { name: 'The storm' }).click();
    await dialog().locator('.dog-refs-rail-item', { hasText: 'Your notes' }).click();
    await dialog().getByRole('checkbox').first().click();
    await page.waitForTimeout(300);
    await dialog().getByRole('button', { name: 'Done' }).click();
    await dialog().waitFor({ state: 'detached' });
    await page.waitForTimeout(300);
    out.chosen = await refsText(page);
    // Folded.
    await page.locator('.dog-refs .dog-card-head h2').click();
    out.folded = await refsText(page);
    await page.locator('.dog-refs .dog-card-head h2').click();
    // Remove all: what goes and what stays.
    const removeAll = page.locator('#dog-refs-body .dog-refs-actions button', { hasText: 'Remove all' });
    out.removeAllShown = await removeAll.count();
    if (out.removeAllShown) {
      await removeAll.click();
      await page.waitForTimeout(300);
      out.afterRemoveAll = await refsText(page);
      out.afterRemoveAllUploads = await rowCount(page);
      out.notice = await page.evaluate(() => document.querySelector('.dog-refs-notice')?.innerText.replace(/\s+/g, ' ').trim() || null);
      const undo = page.locator('.dog-refs-notice button', { hasText: 'Undo' });
      if (await undo.count()) { await undo.click(); await page.waitForTimeout(300); }
      out.afterUndo = await refsText(page);
    }
    out.requests = seen.requests;
    return out;
  } finally { await ctx.close(); }
}
async function over(browser) {
  const { ctx, page, seen } = await openDog(browser);
  try {
    // 820,000 characters is about 205,000 tokens at the house's four to one:
    // past the 200,000 limit.
    await upload(page, note(1, 'word '.repeat(164000)));
    const open = await refsText(page);
    await page.locator('.dog-refs .dog-card-head h2').click();
    const folded = await refsText(page);
    return { open: { count: open.count, meterWords: open.meterWords, meterHover: open.meterHover }, folded: { head: folded.head }, requests: seen.requests };
  } finally { await ctx.close(); }
}

// ── enter ───────────────────────────────────────────────────────────────────
async function enter(browser) {
  const out = {};
  {
    const { ctx, page, seen } = await openDog(browser);
    try {
      await upload(page, note(1));
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      out.empty = {
        focus: await page.evaluate((b) => document.activeElement?.matches(b) || false, BOX),
        toasts: await page.evaluate(() => document.querySelectorAll('.ui-toast-stack .ui-toast').length),
        generating: await page.evaluate(() => [...document.querySelectorAll('button.dog-generate')].some((b) => /Generating/.test(b.textContent))),
        requests: seen.requests,
      };
    } finally { await ctx.close(); }
  }
  {
    const { ctx, page, seen } = await openDog(browser);
    try {
      await upload(page, note(1));
      await page.fill(BOX, CONTEXT);
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
      out.words = { boundary: seen.boundary, toasts: await page.evaluate(() => document.querySelectorAll('.ui-toast-stack .ui-toast:not([data-tone="danger"])').length), requests: seen.requests };
    } finally { await ctx.close(); }
  }
  return out;
}

// ── pictures of cards 1 and 2 ────────────────────────────────────────────────
async function shots(browser) {
  const files = [];
  const shoot = async (page, nn, what) => {
    await page.evaluate(() => { document.activeElement?.blur(); const m = document.querySelector('.dog-main'); if (m) m.scrollTop = 0; });
    await page.waitForTimeout(400);
    const file = `po-dg2-${TAG}-${nn}-${what}-${W}x${H}.png`;
    await page.screenshot({ path: join(OUT, file) });
    files.push(file);
  };
  {
    const { ctx, page } = await openDog(browser);
    try {
      await shoot(page, '01', 'cards-empty');
      await upload(page, NEUTRAL[0]);
      await upload(page, NEUTRAL[1]);
      await shoot(page, '02', 'cards-two-uploads');
      await chooseProject(page);
      const dialog = () => page.locator('.ui-dialog.dog-refs-dialog');
      await page.getByRole('button', { name: 'Add references' }).click();
      await dialog().waitFor();
      await page.waitForSelector('.dog-refs-rail-item');
      await dialog().locator('.dog-refs-rail-item', { hasText: 'Scenes' }).click();
      await dialog().getByRole('checkbox', { name: 'The storm' }).click();
      await dialog().getByRole('button', { name: 'Done' }).click();
      await dialog().waitFor({ state: 'detached' });
      await shoot(page, '03', 'one-list');
    } finally { await ctx.close(); }
  }
  return files;
}

// --only <part>[,<part>] runs just those parts (walk, shots, …).
const ONLY = (flag('--only') || '').split(',').filter(Boolean);
const runs = (part) => !ONLY.length || ONLY.includes(part);
const browser = await chromium.launch();
const report = { tag: TAG, size: `${W}x${H}`, port: PORT };
try {
  if (runs('inputs')) report.inputs = await inputs(browser);
  if (runs('walk')) report.walk = await walk(browser);
  if (runs('choose')) report.choose = await choose(browser);
  if (runs('behaviour')) report.behaviour = await behaviour(browser);
  if (runs('card')) report.card = await card(browser);
  if (runs('over')) report.over = await over(browser);
  if (runs('enter')) report.enter = await enter(browser);
  if (SHOTS && runs('shots')) report.shots = await shots(browser);
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `po-dg2-${TAG}-${W}x${H}${ONLY.length ? `-${ONLY.join('-')}` : ''}.json`), JSON.stringify(report, null, 2));
const pr = (k, v) => console.log(`${k}:`, typeof v === 'string' ? v : JSON.stringify(v));
if (report.inputs) pr('inputs', report.inputs);
if (report.walk) {
  for (const [k, w] of Object.entries({ none: report.walk.none, two: report.walk.two })) {
    console.log(`walk (${k}): ${w.total} stops, ${w.inDog} in D.O.G.'s column, ${w.fileish} on a file input or label`);
    for (const s of w.stops) console.log(`  ${String(s.n).padStart(3)} ${s.inDog ? 'D' : ' '} ${(s.card || '').padEnd(14)} ${s.name}`);
  }
}
if (report.choose) pr('choose', report.choose);
if (report.behaviour) pr('behaviour', report.behaviour);
if (report.card) console.log('card:', JSON.stringify(report.card, null, 1));
if (report.over) pr('over', report.over);
if (report.enter) pr('enter', report.enter);
if (report.shots) pr('shots', report.shots.join(', '));
const requests = ['inputs', 'walk', 'choose', 'behaviour', 'card', 'over'].reduce((n, k) => n + (report[k]?.requests || 0), 0)
  + (report.enter?.empty?.requests || 0) + (report.enter?.words?.requests || 0);
if (requests > 0) { console.error('🚨 a request reached an Edge Function'); process.exit(2); }
