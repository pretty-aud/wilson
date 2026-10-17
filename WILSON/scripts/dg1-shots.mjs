#!/usr/bin/env node
/**
 * D.O.G. as it stands, measured and photographed for the references research
 * — post-overhaul DG1 (2026-10-16).
 *
 *   node scripts/dg1-shots.mjs <port> --out <dir> [--size 1440x900] [--part dog|notes|all] [--no-shots]
 *
 * On the dev fixtures:
 *
 *   dog    D.O.G. at rest; a project chosen (the first one in the list); Full
 *          deck; Single page with a layout chosen. Since DG1b D.O.G. opens on
 *          Full deck, so shots 1 to 3 share that side.
 *   notes  The Dashboard's Notes tab: the list, then the first note open.
 *   refs   DG1 as built (walkthrough 75): the three cards; the Add references
 *          window on Files, on Scenes with a scene ticked and previewed, on
 *          Notes with one ticked; the card with what was chosen; Full deck
 *          and Single page; a deck asked for from files the test data
 *          refuses to read. The side D.O.G. opens on is measured first
 *          (`refsOpensOn`: Full deck since DG1b, Audrey's Q21), so card 3 is on
 *          Full deck in shots 1 to 6 and on Single page in shot 7.
 *
 * For each state it prints, and writes as `po-dg1-measure-<part>-<W>x<H>.json`
 * into --out, what the screen says: every field label, hint, placeholder and
 * checkbox with its state, the switch and its state, the project dropdown's
 * options, the generate buttons and whether they are enabled, and, with a
 * project chosen, what the project panel lists. Pictures (`--no-shots` skips
 * them), each `po-dg1-<part>-<nn>-<state>-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1 (the `dg1-worktree` entry in .claude/launch.json sets
 * both). Changes nothing that outlives the page: nothing is generated, saved,
 * exported or sent, and the fixture store is in memory. Animations and
 * transitions are off and the caret transparent, in this page only. A control
 * that is not found stops that part and says which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const VALUED = ['--out', '--size', '--part'];
const PORT = args.find((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1])) || '5300';
const OUT = flag('--out');
const SHOTS = !args.includes('--no-shots');
const ALL = ['dog', 'notes', 'refs'];
if (!OUT) {
  console.error(`usage: dg1-shots.mjs <port> --out <dir> [--size WxH] [--part ${ALL.join('|')}|all] [--no-shots]`);
  process.exit(1);
}
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PARTS = (flag('--part') || 'all') === 'all' ? ALL : [flag('--part')];
for (const p of PARTS) if (!ALL.includes(p)) { console.error(`unknown part ${p}`); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const NO_MOTION = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

async function fresh(browser, path) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: NO_MOTION });
  return { ctx, page };
}

async function shot(page, part, n, state) {
  if (!SHOTS) return;
  const name = `po-dg1-${part}-${String(n).padStart(2, '0')}-${state}-${W}x${H}.png`;
  await page.screenshot({ path: join(OUT, name) });
  console.log(`  📷 ${name}`);
}

// The Single page / Full deck switch, set to one side and never toggled
// blind: D.O.G. opens on Full deck since DG1b (Audrey's Q21) and opened on
// Single page before, so a toggle would photograph the other side.
const SWITCH = '.dog-full-deck [role=switch]';
const sideOf = (page) => page.$eval(SWITCH, (e) => (e.getAttribute('aria-checked') === 'true' ? 'Full deck' : 'Single page'));
async function setSide(page, side) {
  if ((await sideOf(page)) !== side) await page.click(SWITCH);
  await page.waitForFunction(([sel, want]) => document.querySelector(sel)?.getAttribute('aria-checked') === want,
    [SWITCH, String(side === 'Full deck')]);
}

// What D.O.G.'s two input cards say, read from the page.
function readDog() {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const txt = (e) => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const cards = [...document.querySelectorAll('.dog-card')].filter(vis).map((card) => {
    const title = txt(card.querySelector('.dog-card-title'));
    const fields = [...card.querySelectorAll('.ui-field-label')].filter(vis).map((l) => {
      const hint = l.parentElement?.querySelector('.ui-field-hint');
      return { label: txt(l), hint: hint && vis(hint) ? txt(hint) : null };
    });
    const hints = [...card.querySelectorAll('.ui-field-hint')].filter(vis).map(txt);
    const placeholders = [...card.querySelectorAll('textarea, input[type=text]')].filter(vis)
      .map((e) => ({ tag: e.tagName.toLowerCase(), cls: e.className.split(' ').filter((c) => c.startsWith('dog-')).join(' '), placeholder: e.getAttribute('placeholder'), disabled: e.disabled }));
    const checks = [...card.querySelectorAll('[role=checkbox]')].filter(vis)
      .map((e) => ({ name: e.getAttribute('aria-label'), checked: e.getAttribute('aria-checked') === 'true', words: txt(e.parentElement) }));
    const switches = [...card.querySelectorAll('[role=switch]')].filter(vis)
      .map((e) => ({ label: txt(e.parentElement), checked: e.getAttribute('aria-checked') === 'true', width: Math.round(e.parentElement.getBoundingClientRect().width) }));
    const selects = [...card.querySelectorAll('select')].filter(vis)
      .map((s) => ({ cls: s.className.split(' ').filter((c) => c.startsWith('dog-')).join(' '), value: s.value, options: [...s.options].map((o) => o.textContent.trim()) }));
    const buttons = [...card.querySelectorAll('button.ui-btn, label.ui-btn')].filter(vis)
      .map((b) => ({ words: txt(b), disabled: !!b.disabled }));
    const note = txt(card.querySelector('.dog-card-note'));
    const collapsed = card.querySelector('.dog-card-head')?.getAttribute('data-collapsed');
    const rect = card.getBoundingClientRect();
    return { title, collapsed, note: note || null, top: Math.round(rect.top), height: Math.round(rect.height), fields, hints, placeholders, checks, switches, selects, buttons };
  });
  const details = document.querySelector('.dog-project-details');
  const project = details ? {
    description: txt(details.querySelector('.dog-details-desc')) || null,
    notes: [...details.querySelectorAll('.dog-details-note')].map(txt),
    roles: [...details.querySelectorAll('.dog-role-name')].map(txt),
    roleChips: [...details.querySelectorAll('.dog-role-chip')].map(txt),
  } : null;
  const banners = [...document.querySelectorAll('.ui-banner')].filter(vis).map(txt);
  return { cards, project, banners };
}

const report = {};

async function partDog(browser) {
  const { ctx, page } = await fresh(browser, '/dog');
  try {
    await page.waitForSelector('.dog-project-select', { timeout: 15000 });
    report.rest = await page.evaluate(readDog);
    await shot(page, 'dog', 1, 'rest');

    // The first real project in the dropdown.
    const options = await page.$$eval('.dog-project-select option', (os) => os.map((o) => ({ value: o.value, label: o.textContent.trim() })));
    const first = options.find((o) => o.value);
    if (!first) throw new Error('the project dropdown lists no project');
    await page.selectOption('.dog-project-select', first.value);
    await page.waitForSelector('.dog-project-details', { timeout: 10000 });
    // Until the attachment read settles ("Reading project attachments…").
    await page.waitForFunction(() => ![...document.querySelectorAll('.dog-details-note')]
      .some((n) => /Reading project attachments/.test(n.textContent || '')), null, { timeout: 15000 });
    report.project = { chosen: first.label, ...(await page.evaluate(readDog)) };
    await shot(page, 'dog', 2, 'project');

    // Full deck (where D.O.G. opens since DG1b): set, not toggled.
    await setSide(page, 'Full deck');
    report.fullDeck = await page.evaluate(readDog);
    await shot(page, 'dog', 3, 'full-deck');

    // Single page, a layout chosen, card 3 in view.
    await setSide(page, 'Single page');
    const layouts = await page.$$eval('.dog-s2 select option', (os) => os.map((o) => o.value).filter(Boolean));
    if (!layouts.length) throw new Error('the layout dropdown lists no layout');
    await page.selectOption('.dog-s2 select', layouts[0]);
    await page.evaluate(() => document.querySelector('.dog-s2')?.scrollIntoView({ block: 'start' }));
    report.singlePage = await page.evaluate(readDog);
    await shot(page, 'dog', 4, 'single-page');
  } finally {
    await ctx.close();
  }
}

// The references, as built (walkthrough 75). Salt Hours chosen; the window
// on Files, then Scenes with "The storm" ticked and previewed, then Notes with
// one ticked; the card with what was chosen; the switch on each side; and a
// deck asked for from a file alone, which the test data cannot read.
async function partRefs(browser) {
  const { ctx, page } = await fresh(browser, '/dog');
  const dialog = () => page.locator('.ui-dialog.dog-refs-dialog');
  try {
    await page.waitForSelector('.dog-project-select', { timeout: 15000 });
    report.refsOpensOn = await sideOf(page);
    const options = await page.$$eval('.dog-project-select option', (os) => os.map((o) => ({ value: o.value, label: o.textContent.trim() })));
    const first = options.find((o) => o.value);
    if (!first) throw new Error('the project dropdown lists no project');
    await page.selectOption('.dog-project-select', first.value);
    await page.waitForSelector('.dog-refs');
    report.refsCards = await page.evaluate(readDog);
    await shot(page, 'refs', 1, 'cards');

    await page.getByRole('button', { name: 'Add references' }).click();
    await dialog().waitFor();
    await page.waitForSelector('.dog-refs-rail-item');
    await page.waitForFunction(() => !document.querySelector('.dog-refs-list .dog-refs-preview-busy'));
    report.refsRail = await page.$$eval('.dog-refs-rail-item', (bs) => bs.map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
    await shot(page, 'refs', 2, 'window-files');

    await dialog().locator('.dog-refs-rail-item', { hasText: 'Scenes' }).click();
    await dialog().getByRole('checkbox', { name: 'The storm' }).click();
    await dialog().getByRole('button', { name: 'Preview The storm' }).click();
    await page.waitForSelector('.dog-refs-preview .dog-refs-preview-text');
    report.refsPreview = await page.$eval('.dog-refs-preview', (e) => e.innerText);
    await shot(page, 'refs', 3, 'window-scene-preview');

    await dialog().locator('.dog-refs-rail-item', { hasText: 'Your notes' }).click();
    const note = dialog().getByRole('checkbox').first();
    await note.click();
    await page.waitForTimeout(300);
    await shot(page, 'refs', 4, 'window-notes');

    await dialog().getByRole('button', { name: 'Done' }).click();
    await dialog().waitFor({ state: 'detached' });
    await page.evaluate(() => document.querySelector('.dog-refs')?.scrollIntoView({ block: 'start' }));
    report.refsChosen = await page.$$eval('.dog-refs-row .dog-refs-name', (ns) => ns.map((n) => n.textContent.trim()));
    report.refsMeter = await page.$eval('.dog-refs-meter-words', (e) => e.textContent.trim());
    await shot(page, 'refs', 5, 'card-chosen');

    await setSide(page, 'Full deck');
    await page.evaluate(() => document.querySelector('.dog-s2')?.scrollIntoView({ block: 'start' }));
    report.refsFullDeck = await page.evaluate(readDog);
    await shot(page, 'refs', 6, 'full-deck');

    await setSide(page, 'Single page');
    const layouts = await page.$$eval('.dog-s2 select option', (os) => os.map((o) => o.value).filter(Boolean));
    await page.selectOption('.dog-s2 select', layouts[0]);
    await page.evaluate(() => document.querySelector('.dog-s2')?.scrollIntoView({ block: 'start' }));
    report.refsSinglePage = await page.evaluate(readDog);
    report.refsApplied = await page.$eval('.dog-applied-line', (e) => e.textContent.trim());
    await shot(page, 'refs', 7, 'single-page');
  } finally {
    await ctx.close();
  }

  // A deck asked for from files the test data refuses to read (every fixture
  // download is refused), with nothing uploaded.
  const second = await fresh(browser, '/dog');
  try {
    const p = second.page;
    await p.waitForSelector('.dog-project-select');
    const opts = await p.$$eval('.dog-project-select option', (os) => os.map((o) => o.value).filter(Boolean));
    await p.selectOption('.dog-project-select', opts[0]);
    await p.getByRole('button', { name: 'Add references' }).click();
    const dlg = p.locator('.ui-dialog.dog-refs-dialog');
    await dlg.waitFor();
    await p.waitForSelector('.dog-refs-quick');
    await dlg.getByRole('button', { name: /^All Core files/ }).click();
    await dlg.getByRole('button', { name: 'Done' }).click();
    await dlg.waitFor({ state: 'detached' });
    await setSide(p, 'Full deck');
    await p.getByRole('button', { name: 'Generate full deck outline' }).click();
    await p.waitForSelector('.ui-banner', { timeout: 15000 });
    report.refsNothingReadable = await p.$$eval('.ui-banner', (bs) => bs.map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
    await p.evaluate(() => document.querySelector('.dog-main')?.scrollTo(0, 0));
    await shot(p, 'refs', 8, 'nothing-readable');
  } finally {
    await second.ctx.close();
  }
}

async function partNotes(browser) {
  const { ctx, page } = await fresh(browser, '/dashboard');
  try {
    await page.getByRole('tab', { name: 'Notes' }).click();
    await page.waitForSelector('.dash-note-row-preview, .dash-note-row', { timeout: 15000 });
    report.notesList = await page.evaluate(() => {
      const txt = (e) => (e?.textContent || '').replace(/\s+/g, ' ').trim();
      const rows = [...document.querySelectorAll('.dash-note-row')].filter((e) => e.getClientRects().length);
      return { count: rows.length, rows: rows.map((r) => txt(r).slice(0, 160)) };
    });
    await shot(page, 'notes', 1, 'list');
    const rows = await page.$$('.dash-note-row');
    if (rows.length) {
      await rows[0].click();
      await page.waitForSelector('.ProseMirror', { timeout: 10000 });
      await page.waitForTimeout(400);
      report.noteOpen = await page.evaluate(() => {
        const pm = document.querySelector('.ProseMirror');
        return { words: (pm?.innerText || '').split(/\s+/).filter(Boolean).length, chars: (pm?.innerText || '').length };
      });
      await shot(page, 'notes', 2, 'open');
    }
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch();
let failed = 0;
for (const part of PARTS) {
  console.log(`▸ ${part} at ${W}x${H}`);
  try {
    if (part === 'dog') await partDog(browser);
    if (part === 'notes') await partNotes(browser);
    if (part === 'refs') await partRefs(browser);
  } catch (err) {
    failed++;
    console.error(`✗ ${part}: ${err?.message || err}`);
  }
}
await browser.close();
const file = join(OUT, `po-dg1-measure-${PARTS.join('-')}-${W}x${H}.json`);
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${file}`);
process.exit(failed ? 1 : 0);
