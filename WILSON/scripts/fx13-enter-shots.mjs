#!/usr/bin/env node
/**
 * D.O.G.'s Enter key, door by door, measured and photographed — post-overhaul
 * FX13 (2026-10-26, Audrey's answers: a full deck from Enter needs text in the
 * deck context box; Enter on the switch moves the switch).
 *
 *   node scripts/fx13-enter-shots.mjs <port> --out <dir> [--size 1440x900] [--tag before|after] [--no-shots]
 *
 * Each trial opens /dog fresh, uploads one small text file (so D.O.G. has
 * something to read), sets the card up, puts focus where the trial says (or
 * nowhere), presses Enter in real Chromium and reads what happened:
 *
 *   gen       a generation started (the Generate button showed "Generating")
 *   boundary  the generation reached the AI call (callAI's "Sign in to use AI
 *             features": the dev fixtures' tester has no session, so it stops
 *             there, before any request)
 *   requests  requests to an Edge Function (must be 0: no AI call is made)
 *   switch    the Single page / Full deck switch, before -> after
 *   checks    the three tick boxes that changed, if any
 *   focus     where focus ended
 *   box       the deck context box's words, quoted
 *   said      what the polite live regions say (the toast stack)
 *   window    a dialog or drawer that opened
 *   kept      whether the keydown was left to the browser (not cancelled)
 *
 * Writes `po-fx13-enter-<tag>-<W>x<H>.json` into --out and prints the table;
 * pictures `po-fx13-<tag>-<nn>-<trial>-<W>x<H>.png` for the trials marked
 * `shot`. Needs the worktree's dev server with the dev fixtures' tester
 * (`fx13-worktree` in .claude/launch.json). Changes nothing that outlives the
 * page: nothing is saved or sent, the fixture store is in memory.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const VALUED = ['--out', '--size', '--tag'];
const PORT = args.find((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1])) || '5303';
const OUT = flag('--out');
const TAG = flag('--tag') || 'now';
const SHOTS = !args.includes('--no-shots');
if (!OUT) {
  console.error('usage: fx13-enter-shots.mjs <port> --out <dir> [--size WxH] [--tag before|after] [--no-shots]');
  process.exit(1);
}
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
mkdirSync(OUT, { recursive: true });

const NO_MOTION = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
const SWITCH = '.dog-full-deck [role=switch]';
const BOX = 'textarea.dog-context-prompt';
const PAGE_BOX = 'textarea.dog-page-request';
const LAYOUT = '.dog-layout-select select';
const UPLOAD = 'input[type=file][accept*=".txt"]';
const CONTEXT = 'A pitch deck for a watch launch, five pages.';

// Where focus goes: a selector, a tick box by its name, a button by its words or title, or nowhere.
const check = (name) => `button.dog-check[aria-label="${name}"]`;
const TRIALS = [
  // Full deck (D.O.G. opens on it)
  { id: 'page-empty', side: 'Full deck', at: null, shot: true },
  { id: 'page-spaces', side: 'Full deck', at: null, context: '   ' },
  { id: 'page-text', side: 'Full deck', at: null, context: CONTEXT },
  { id: 'switch-empty', side: 'Full deck', at: SWITCH, shot: true },
  { id: 'switch-text', side: 'Full deck', at: SWITCH, context: CONTEXT },
  { id: 'visual-empty', side: 'Full deck', at: check('Use visual assets') },
  { id: 'visual-text', side: 'Full deck', at: check('Use visual assets'), context: CONTEXT },
  { id: 'project-empty', side: 'Full deck', at: check('Use project assets') },
  { id: 'theme-empty', side: 'Full deck', at: check('Theme generator') },
  { id: 'theme-text', side: 'Full deck', at: check('Theme generator'), context: CONTEXT },
  { id: 'box-empty', side: 'Full deck', at: BOX },
  { id: 'box-spaces', side: 'Full deck', at: BOX, context: '   ' },
  { id: 'box-shift', side: 'Full deck', at: BOX, key: 'Shift+Enter' },
  { id: 'box-text', side: 'Full deck', at: BOX, context: CONTEXT },
  { id: 'add-references', side: 'Full deck', at: 'button.ui-btn:text-is("Add references")' },
  { id: 'help', side: 'Full deck', at: '[title="Help & documentation"]' },
  { id: 'settings', side: 'Full deck', at: '[title="D.O.G. settings"]' },
  { id: 'page-empty-folded', side: 'Full deck', at: null, fold: true, shot: true },
  { id: 'nothing-to-read', side: 'Full deck', at: null, noUpload: true },
  // Single page
  { id: 'sp-page-unset', side: 'Single page', at: null },
  { id: 'sp-page-set', side: 'Single page', at: null, page: true },
  { id: 'sp-switch-set', side: 'Single page', at: SWITCH, page: true },
  { id: 'sp-box-set', side: 'Single page', at: PAGE_BOX, page: true },
  { id: 'sp-page-number', side: 'Single page', at: 'input.dog-page-number', page: true },
  { id: 'sp-layout', side: 'Single page', at: LAYOUT, page: true },
];

/** What the page says now, read in the page. */
function readNow([sw, box]) {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const a = document.activeElement;
  // a field by its label (FX13 review round 1: the box focus lands in is named by it)
  const name = (e) => (e.labels?.[0]?.textContent || '').trim() || e.getAttribute('aria-label') || e.getAttribute('title') || (e.textContent || '').trim().slice(0, 30)
    || e.className.toString().split(' ').filter((c) => c.startsWith('dog-')).join(' ');
  return {
    switch: document.querySelector(sw)?.getAttribute('aria-checked') === 'true' ? 'Full deck' : (document.querySelector(sw) ? 'Single page' : 'gone'),
    checks: Object.fromEntries([...document.querySelectorAll('button.dog-check')].map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-checked')])),
    focus: !a || a === document.body ? 'nothing (the page)' : `${a.tagName.toLowerCase()} ${name(a) || a.className.toString().slice(0, 40)}`,
    box: document.querySelector(box) ? JSON.stringify(document.querySelector(box).value) : 'not drawn',
    said: [...document.querySelectorAll('.ui-toast-stack .ui-toast')].map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim()),
    window: [...document.querySelectorAll('[role=dialog], .ui-drawer')].filter(vis).map((d) => d.getAttribute('aria-label') || d.className.toString().slice(0, 30)),
    gen: window.__fx13gen || 0,
    kept: (window.__fx13keys || []).map((k) => !k.prevented),
  };
}

async function trial(browser, t, n) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const seen = { boundary: 0, requests: 0 };
  page.on('console', (m) => { if (m.type() === 'error' && /AIProxyError/.test(m.text())) seen.boundary++; });
  page.on('request', (r) => { if (/\/functions\/v1\//.test(r.url())) seen.requests++; });
  try {
    await page.goto(`http://localhost:${PORT}/dog`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: NO_MOTION });
    await page.waitForSelector(SWITCH, { timeout: 15000 });
    if (!t.noUpload) {
      await page.setInputFiles(UPLOAD, { name: 'fx13-brief.txt', mimeType: 'text/plain', buffer: Buffer.from('The brief: a watch launch.') });
      await page.waitForFunction(() => document.body.innerText.includes('fx13-brief.txt'), null, { timeout: 10000 });
    }
    const on = (await page.getAttribute(SWITCH, 'aria-checked')) === 'true';
    if (on !== (t.side === 'Full deck')) await page.click(`.dog-mode-side:text-is("${t.side}")`);
    if (t.context != null) await page.fill(BOX, t.context);
    if (t.page) {
      await page.selectOption(LAYOUT, { index: 1 });
      await page.fill(PAGE_BOX, 'The characters, one line each');
    }
    if (t.fold) await page.click('.dog-s2 .dog-card-head');
    // A generation shows "Generating" on the Generate button; count each start.
    await page.evaluate(() => {
      window.__fx13gen = 0; let was = false;
      const now = () => [...document.querySelectorAll('.dog-generate')].some((b) => b.textContent.includes('Generating'));
      new MutationObserver(() => { const g = now(); if (g && !was) window.__fx13gen++; was = g; })
        .observe(document.body, { subtree: true, childList: true, characterData: true });
      window.__fx13keys = [];
      window.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.__fx13keys.push({ prevented: e.defaultPrevented }); });
    });
    if (t.at) await page.focus(t.at);
    else await page.evaluate(() => document.activeElement?.blur());
    const before = await page.evaluate(readNow, [SWITCH, BOX]);
    await page.keyboard.press(t.key || 'Enter');
    await page.waitForTimeout(700);
    const after = await page.evaluate(readNow, [SWITCH, BOX]);
    if (t.shot && SHOTS) {
      const file = `po-fx13-${TAG}-${String(n).padStart(2, '0')}-${t.id}-${W}x${H}.png`;
      await page.screenshot({ path: join(OUT, file) });
      console.log(`  📷 ${file}`);
    }
    const flipped = Object.keys(after.checks).filter((k) => after.checks[k] !== before.checks[k]);
    return {
      id: t.id,
      key: t.key || 'Enter',
      gen: after.gen,
      boundary: seen.boundary,
      requests: seen.requests,
      switch: before.switch === after.switch ? after.switch : `${before.switch} -> ${after.switch}`,
      checks: flipped.length ? flipped.map((k) => `${k} ${before.checks[k]} -> ${after.checks[k]}`).join('; ') : 'unchanged',
      focus: after.focus,
      box: after.box,
      said: after.said,
      window: after.window,
      kept: after.kept,
    };
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch();
const rows = [];
try {
  for (const [i, t] of TRIALS.entries()) {
    try {
      rows.push(await trial(browser, t, i + 1));
    } catch (err) {
      rows.push({ id: t.id, error: String(err.message || err).split('\n')[0] });
    }
    const r = rows.at(-1);
    console.log(r.error ? `${t.id}: ERROR ${r.error}`
      : `${r.id.padEnd(18)} ${r.key.padEnd(11)} gen=${r.gen} boundary=${r.boundary} req=${r.requests} | ${r.switch} | ${r.checks} | focus: ${r.focus} | box ${r.box} | said ${JSON.stringify(r.said)} | window ${JSON.stringify(r.window)} | kept ${JSON.stringify(r.kept)}`);
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `po-fx13-enter-${TAG}-${W}x${H}.json`), JSON.stringify({ tag: TAG, size: `${W}x${H}`, port: PORT, rows }, null, 2));
const errors = rows.filter((r) => r.error).length;
if (rows.some((r) => r.requests > 0)) { console.error('🚨 a request reached an Edge Function'); process.exit(2); }
process.exit(errors ? 1 : 0);
