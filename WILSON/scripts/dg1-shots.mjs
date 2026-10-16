#!/usr/bin/env node
/**
 * D.O.G. as it stands, measured and photographed for the references research
 * — post-overhaul DG1 (2026-10-16).
 *
 *   node scripts/dg1-shots.mjs <port> --out <dir> [--size 1440x900] [--part dog|notes|all] [--no-shots]
 *
 * On the dev fixtures:
 *
 *   dog    D.O.G. at rest; a project chosen (the first one in the list); the
 *          Full deck switch on; the switch off again with a layout chosen.
 *   notes  The Dashboard's Notes tab: the list, then the first note open.
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
const ALL = ['dog', 'notes'];
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

    // Full deck on.
    await page.click('.dog-full-deck [role=switch]');
    await page.waitForFunction(() => document.querySelector('.dog-full-deck [role=switch]')?.getAttribute('aria-checked') === 'true');
    report.fullDeck = await page.evaluate(readDog);
    await shot(page, 'dog', 3, 'full-deck');

    // Off again, a layout chosen, the second card in view.
    await page.click('.dog-full-deck [role=switch]');
    await page.waitForFunction(() => document.querySelector('.dog-full-deck [role=switch]')?.getAttribute('aria-checked') === 'false');
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
