#!/usr/bin/env node
/**
 * D.O.G.'s card title bars and the kit toast, by keyboard, measured in real
 * Chromium — post-overhaul FX14 (2026-10-26, FX13's leftovers FX13-01 and
 * FX13-02).
 *
 *   node scripts/fx14-keyboard-shots.mjs <port> --out <dir> [--size 1440x900] [--tag before|after] [--no-shots]
 *
 * Headless Chromium (no window on screen), closed in a `finally`. Needs the
 * dev server with the dev fixtures' tester (`fx14-worktree` in
 * .claude/launch.json). Nothing outlives the page: the fixture store is in
 * memory, nothing is saved or sent, and no AI call is made (the tester has no
 * session, so a generation stops inside callAI before any request; every
 * trial counts requests to an Edge Function, which must stay 0).
 *
 * What it measures:
 *   walk      a Tab walk of D.O.G.'s page from the top (no upload, so no file
 *             name is ever read out): every stop, by Chromium's own role and
 *             name, and which of them are in D.O.G.'s column
 *   headers   the three folding card headers: role, tab stop, the buttons in
 *             them (name, aria-expanded, aria-controls and whether it exists)
 *   keys      Enter and Space on each header's button, the deck context box
 *             empty and with words, Full deck on: the fold, a generation
 *             (gen: the Generate button said "Generating"; boundary: callAI's
 *             refusal in the console), requests, notes, where focus is
 *   ask       FX13's rule, still: card 3 folded, the box empty, Enter on the
 *             page opens card 3 and focuses the box
 *   toast     a timed kit toast (the dev fixtures' refusal notice, 6 s) and
 *             D.O.G.'s note (no timer): reached by Tab, held past its time,
 *             dismissed from the keyboard, taken down by its owner; where
 *             focus is afterwards; and the pointer (hover holds it, leaving
 *             lets it go, the × takes it down)
 *
 * Writes `po-fx14-keys-<tag>-<W>x<H>.json` into --out and prints the rows;
 * pictures `po-fx14-<tag>-<nn>-<what>-<W>x<H>.png` of the card headers.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const VALUED = ['--out', '--size', '--tag'];
const PORT = args.find((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1])) || '5304';
const OUT = flag('--out');
const TAG = flag('--tag') || 'now';
const SHOTS = !args.includes('--no-shots');
if (!OUT) {
  console.error('usage: fx14-keyboard-shots.mjs <port> --out <dir> [--size WxH] [--tag before|after] [--no-shots]');
  process.exit(1);
}
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
mkdirSync(OUT, { recursive: true });

const NO_MOTION = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
const SWITCH = '.dog-full-deck [role=switch]';
const BOX = 'textarea.dog-context-prompt';
const UPLOAD = 'input[type=file][accept*=".txt"]';
const HEADS = '.dog-card-head[data-collapsible="true"]';
const STACK = '.ui-toast-stack';
const CONTEXT = 'A pitch deck for a watch launch, five pages.';
const DEV_TOAST_MS = 6000;

/** Chromium's own role, name and state for the focused element, read from its
    accessibility tree over CDP, so CSS text-transform shows as a screen reader
    hears it (review round 1, finding 3: Playwright's ariaSnapshot computes
    names itself, in mixed case). */
async function focusedName(page) {
  if (await page.evaluate(() => !document.activeElement || document.activeElement === document.body)) return '(nothing: <body>)';
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Accessibility.enable');
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.activeElement' });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
    const n = nodes.find((x) => !x.ignored) || nodes[0] || {};
    const states = (n.properties || []).filter((p) => ['expanded', 'checked'].includes(p.name)).map((p) => `${p.name}=${p.value?.value}`);
    return `${n.role?.value || '?'} "${n.name?.value || ''}"${states.length ? ` [${states.join(' ')}]` : ''}`.slice(0, 90);
  } finally {
    await cdp.detach().catch(() => {});
  }
}
const where = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return 'body';
  if (el.closest('.ui-toast-stack')) return 'in the toast';
  if (el.matches('textarea.dog-context-prompt')) return 'the deck context box';
  if (el.closest('.dog-card-head')) return `card head: ${el.closest('.dog-card-head').querySelector('h2')?.textContent.trim()}`;
  return el.tagName.toLowerCase() + (el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : '');
});

async function openDog(browser, { upload = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const seen = { boundary: 0, requests: 0 };
  page.on('console', (m) => { if (m.type() === 'error' && /AIProxyError|Sign in to use AI/.test(m.text())) seen.boundary++; });
  page.on('request', (r) => { if (/\/functions\/v1\//.test(r.url())) seen.requests++; });
  // A cold dev server serves several thousand modules: up to two minutes.
  await page.goto(`http://localhost:${PORT}/dog`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.addStyleTag({ content: NO_MOTION });
  await page.waitForSelector(SWITCH, { timeout: 30000 });
  if (upload) {
    await page.setInputFiles(UPLOAD, { name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('The brief: a watch launch.') });
    await page.waitForFunction(() => !!document.querySelector('button.dog-generate:not([disabled])'), null, { timeout: 10000 });
  }
  await page.evaluate(() => document.activeElement?.blur());
  return { ctx, page, seen };
}
const generating = (page) => page.evaluate(() => [...document.querySelectorAll('button.dog-generate')].some((b) => /Generating/.test(b.textContent)));
const toastCount = (page) => page.evaluate((s) => document.querySelectorAll(`${s} .ui-toast`).length, STACK);
const folded = (page) => page.evaluate((s) => [...document.querySelectorAll(s)].map((h) => h.dataset.collapsed === 'true'), HEADS);

// ── walk ────────────────────────────────────────────────────────────────────
async function walk(browser) {
  const { ctx, page } = await openDog(browser);
  try {
    const stops = [];
    let first = null;
    for (let i = 0; i < 160; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        const key = el ? (el.id || '') + '|' + el.tagName + '|' + (el.className?.baseVal ?? el.className) + '|' + [...(el.parentElement?.children || [])].indexOf(el) + '|' + (el.closest('[id]')?.id || '') : '';
        return { key, inDog: !!el?.closest('.dog-main') };
      });
      const name = await focusedName(page);
      if (first && info.key === first) break;
      if (!first) first = info.key;
      stops.push({ n: stops.length + 1, name, inDog: info.inDog });
    }
    return { total: stops.length, inDog: stops.filter((s) => s.inDog).length, stops };
  } finally { await ctx.close(); }
}

// ── headers ─────────────────────────────────────────────────────────────────
async function headers(browser) {
  const { ctx, page } = await openDog(browser);
  try {
    return await page.evaluate((s) => [...document.querySelectorAll(s)].map((h) => ({
      title: h.querySelector('h2')?.textContent.trim(),
      role: h.getAttribute('role'),
      tabStop: h.tabIndex >= 0,
      buttons: [...h.querySelectorAll('button')].map((b) => ({
        labelledBy: b.getAttribute('aria-labelledby'),
        label: b.getAttribute('aria-label'),
        expanded: b.getAttribute('aria-expanded'),
        controls: b.getAttribute('aria-controls'),
        controlsExists: b.getAttribute('aria-controls') ? !!document.getElementById(b.getAttribute('aria-controls')) : null,
        glyphHidden: [...b.querySelectorAll('svg')].every((g) => g.getAttribute('aria-hidden') === 'true'),
      })),
    })), HEADS);
  } finally { await ctx.close(); }
}

// ── keys on the header buttons ──────────────────────────────────────────────
async function keys(browser) {
  const rows = [];
  for (const words of [false, true]) {
    for (const key of ['Enter', 'Space']) {
      for (let card = 0; card < 3; card++) {
        const { ctx, page, seen } = await openDog(browser, { upload: true });
        try {
          if (words) await page.fill(BOX, CONTEXT);
          const btn = page.locator(HEADS).nth(card).locator('button');
          if (!(await btn.count())) { rows.push({ card, key, words, result: 'no button in the header (no tab stop)' }); continue; }
          await btn.first().focus();
          const before = await folded(page);
          await page.keyboard.press(key);
          await page.waitForTimeout(400);
          const after = await folded(page);
          const name = await focusedName(page);
          const expanded = await btn.first().getAttribute('aria-expanded');
          await page.keyboard.press(key);
          await page.waitForTimeout(300);
          const back = await folded(page);
          rows.push({
            card, key, words,
            foldedBefore: before[card], foldedAfter: after[card], foldedAgain: back[card],
            othersUnchanged: before.every((v, i) => i === card || v === after[i]),
            expandedAfter: expanded,
            gen: await generating(page), boundary: seen.boundary, requests: seen.requests,
            notes: await toastCount(page), focus: name,
          });
        } finally { await ctx.close(); }
      }
    }
  }
  return rows;
}

// ── FX13's rule, still ──────────────────────────────────────────────────────
async function ask(browser) {
  const { ctx, page, seen } = await openDog(browser, { upload: true });
  try {
    const head3 = page.locator(HEADS).nth(2);
    const btn = head3.locator('button');
    if (await btn.count()) { await btn.first().focus(); await page.keyboard.press('Enter'); }
    else await head3.click();
    await page.waitForTimeout(300);
    const foldedFirst = (await folded(page))[2];
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    return { card3FoldedFirst: foldedFirst, card3FoldedAfter: (await folded(page))[2], focus: await where(page), notes: await toastCount(page), gen: await generating(page), requests: seen.requests };
  } finally { await ctx.close(); }
}

// ── the toasts ──────────────────────────────────────────────────────────────
const raiseDevToast = (page) => page.evaluate(async () => { (await import('/src/dev/devFixtures.js')).devWriteRefused('FX14 measuring'); });
async function tabIntoStack(page, from) {
  await page.locator(from).focus();
  let prior = await where(page);
  for (let i = 1; i <= 80; i++) {
    const was = await where(page);
    await page.keyboard.press('Tab');
    if (await page.evaluate((s) => !!document.activeElement?.closest(s), STACK)) return { tabs: i, prior: was };
    prior = was;
  }
  return { tabs: null, prior };
}
async function toast(browser) {
  const out = {};
  // T1: the timed toast held past its time by keyboard focus, then let go.
  {
    const { ctx, page } = await openDog(browser);
    try {
      await raiseDevToast(page);
      await page.waitForSelector(`${STACK} .ui-toast`);
      const reach = await tabIntoStack(page, BOX);
      await page.waitForTimeout(DEV_TOAST_MS + 1500);
      const heldUp = await toastCount(page);
      const focusThen = await where(page);
      await page.keyboard.press('Shift+Tab');
      const focusOut = await where(page);
      await page.waitForTimeout(DEV_TOAST_MS + 1500);
      out.timedByFocus = { ...reach, upAfterItsTime: heldUp, focusThen, shiftTabTo: focusOut, upAfterFocusLeft: await toastCount(page), focusAtEnd: await where(page) };
    } finally { await ctx.close(); }
  }
  // T2: Dismiss pressed from the keyboard.
  {
    const { ctx, page } = await openDog(browser);
    try {
      await raiseDevToast(page);
      await page.waitForSelector(`${STACK} .ui-toast`);
      const reach = await tabIntoStack(page, BOX);
      const on = await focusedName(page);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      out.dismissByKey = { ...reach, pressedOn: on, up: await toastCount(page), focusAfter: await where(page) };
    } finally { await ctx.close(); }
  }
  // T3: D.O.G.'s note (no timer), focus on its ×, its owner takes it down
  // (Alt flips to Single page: the note stops being true).
  {
    const { ctx, page } = await openDog(browser, { upload: true });
    try {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      const asked = { notes: await toastCount(page), focus: await where(page) };
      const reach = await tabIntoStack(page, BOX);
      await page.keyboard.press('Alt');
      await page.waitForTimeout(400);
      out.noteTakenDownByOwner = { asked, ...reach, switchNow: await page.locator(SWITCH).getAttribute('aria-checked'), up: await toastCount(page), focusAfter: await where(page) };
    } finally { await ctx.close(); }
  }
  // T4: the pointer, unchanged: hover holds the timed toast, leaving lets it go, the × takes it down.
  {
    const { ctx, page } = await openDog(browser);
    try {
      await raiseDevToast(page);
      const t = page.locator(`${STACK} .ui-toast`).first();
      await t.hover();
      await page.waitForTimeout(DEV_TOAST_MS + 1500);
      const heldByHover = await toastCount(page);
      await page.mouse.move(5, 5);
      await page.waitForTimeout(DEV_TOAST_MS + 1500);
      const afterLeave = await toastCount(page);
      await raiseDevToast(page);
      await page.locator(`${STACK} .ui-toast button[aria-label="Dismiss"]`).first().click();
      await page.waitForTimeout(300);
      out.pointerTimed = { upAfterItsTimeHovered: heldByHover, upAfterLeaving: afterLeave, upAfterXClick: await toastCount(page), focusAfterX: await where(page) };
    } finally { await ctx.close(); }
  }
  // T6 (review round 1, finding 1): two timed toasts, Tab to the older's ×,
  // Tab to the newer's ×, Enter: focus on the older's ×, which then holds it.
  {
    const { ctx, page } = await openDog(browser);
    try {
      await raiseDevToast(page);
      await page.waitForTimeout(150);
      await raiseDevToast(page);
      const reach = await tabIntoStack(page, BOX);
      await page.keyboard.press('Tab');
      const onNewer = await page.evaluate((s) => { const ts = [...document.querySelectorAll(`${s} .ui-toast`)]; return ts.length === 2 && ts[1].contains(document.activeElement); }, STACK);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      const onOlder = await page.evaluate((s) => { const ts = [...document.querySelectorAll(`${s} .ui-toast`)]; return ts.length === 1 && ts[0].contains(document.activeElement); }, STACK);
      await page.waitForTimeout(DEV_TOAST_MS + 1500);
      const olderUp = await toastCount(page);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      out.stacked = { ...reach, onNewer, focusOnOlderAfterNewerClosed: onOlder, olderUpPastItsTime: olderUp, focusAfterBoth: await where(page) };
    } finally { await ctx.close(); }
  }
  // T5 (review round 1, finding 2): something focused and scrolled out of
  // view, then the × clicked with the mouse: nothing scrolls, focus is not
  // taken back to it.
  {
    const { ctx, page } = await openDog(browser);
    try {
      await page.locator('.dog-main select').first().focus();
      const top = await page.evaluate(() => { const m = document.querySelector('.dog-main'); m.scrollTop = 99999; return m.scrollTop; });
      await raiseDevToast(page);
      await page.locator(`${STACK} .ui-toast button[aria-label="Dismiss"]`).first().click();
      await page.waitForTimeout(300);
      out.pointerScrolled = { scrollTopBefore: top, scrollTopAfter: await page.evaluate(() => document.querySelector('.dog-main').scrollTop), focusAfterX: await where(page) };
    } finally { await ctx.close(); }
  }
  {
    const { ctx, page } = await openDog(browser, { upload: true });
    try {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      await page.waitForTimeout(6500);
      const still = await toastCount(page);
      await page.locator(`${STACK} .ui-toast button[aria-label="Dismiss"]`).first().click();
      await page.waitForTimeout(300);
      out.pointerNote = { upAfterSixAndAHalfSeconds: still, upAfterXClick: await toastCount(page) };
    } finally { await ctx.close(); }
  }
  return out;
}

// ── pictures of the headers (no upload: no file name on screen) ──────────────
async function shots(browser) {
  const files = [];
  const { ctx, page } = await openDog(browser);
  try {
    const shoot = async (nn, what) => {
      await page.waitForTimeout(400);
      const file = `po-fx14-${TAG}-${nn}-${what}-${W}x${H}.png`;
      await page.screenshot({ path: join(OUT, file) });
      files.push(file);
    };
    await shoot('01', 'headers');
    const btn = page.locator(HEADS).first().locator('button');
    if (await btn.count()) {
      // Reach card 1's button by Tab from the step before it, so the ring is :focus-visible.
      await page.evaluate(() => document.activeElement?.blur());
      for (let i = 0; i < 160; i++) {
        await page.keyboard.press('Tab');
        if (await page.evaluate(() => !!document.activeElement?.closest('.dog-card-head'))) break;
      }
      await shoot('02', 'header-focus');
      await page.keyboard.press('Enter');
      await shoot('03', 'card1-folded-by-key');
    }
  } finally { await ctx.close(); }
  // Review round 2, finding 1: D.O.G.'s note taken down by Alt with focus on
  // its ×, the button focus came from gone: focus on D.O.G.'s main column,
  // which wears the kit's ring. Card 1 folded first, so the upload's name is
  // not on screen.
  {
    const { ctx: c2, page: p2 } = await openDog(browser, { upload: true });
    try {
      const btn1 = p2.locator(HEADS).first().locator('button');
      if (await btn1.count()) {
        await btn1.first().focus();
        await p2.keyboard.press('Enter');
        await p2.evaluate(() => document.activeElement?.blur());
        await p2.keyboard.press('Enter');
        await p2.waitForTimeout(400);
        await tabIntoStack(p2, BOX);
        await p2.keyboard.press('Alt');
        await p2.waitForTimeout(400);
        const file = `po-fx14-${TAG}-04-note-gone-main-ring-${W}x${H}.png`;
        await p2.screenshot({ path: join(OUT, file) });
        files.push(file);
      }
    } finally { await c2.close(); }
  }
  return files;
}

const browser = await chromium.launch();
const report = { tag: TAG, size: `${W}x${H}`, port: PORT };
try {
  report.walk = await walk(browser);
  report.headers = await headers(browser);
  report.keys = await keys(browser);
  report.ask = await ask(browser);
  report.toast = await toast(browser);
  if (SHOTS) report.shots = await shots(browser);
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `po-fx14-keys-${TAG}-${W}x${H}.json`), JSON.stringify(report, null, 2));
console.log(`walk: ${report.walk.total} stops, ${report.walk.inDog} in D.O.G.'s column`);
for (const s of report.walk.stops) console.log(`  ${String(s.n).padStart(3)} ${s.inDog ? 'D' : ' '} ${s.name}`);
console.log('headers:', JSON.stringify(report.headers));
for (const k of report.keys) console.log('keys:', JSON.stringify(k));
console.log('ask:', JSON.stringify(report.ask));
console.log('toast:', JSON.stringify(report.toast, null, 1));
if (report.shots) console.log('shots:', report.shots.join(', '));
const requests = report.keys.reduce((n, k) => n + (k.requests || 0), 0) + (report.ask.requests || 0);
if (requests > 0) { console.error('🚨 a request reached an Edge Function'); process.exit(2); }
