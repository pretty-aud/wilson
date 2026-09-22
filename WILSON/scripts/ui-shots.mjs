#!/usr/bin/env node
/**
 * UI overhaul — the six before/after pages, at both window sizes.
 *
 *   node scripts/ui-shots.mjs <before|after> [port] [outDir]
 *
 * Writes `docs/sessions/handoffs/img/t0-<phase>-<page>-<W>x<H>.png`.
 *
 * WHY A SCRIPT AND NOT THE BROWSER PANE. Twelve shots per phase is twelve
 * images into a session's context for no reading benefit — the shots are for
 * Audrey, not for me. Playwright writes them to disk and tells me only the
 * byte count. (F4 trap 9: node cannot resolve @playwright/test from the
 * scratchpad, so this has to live inside the worktree. `scripts/` does.)
 *
 * PREREQUISITES, and they are not optional:
 *   - the worktree's OWN dev server (the shared `wilson-dev` entry on 5203
 *     serves a different checkout and the app boots anyway — C3c trap 1),
 *   - `.env.local` with VITE_DEV_AUTOLOGIN=tester and VITE_DEV_FIXTURES=1,
 *     which is what puts the "Salt Hours" fixture project behind R.A.B.B.I.T.
 *     so Timeline has something to draw.
 *
 * The app is deliberately slow: a ~6s logo intro and 2.1s page swaps (C2 keeps
 * the transition exactly as it is). Every wait here is generous on purpose; a
 * screenshot taken mid-transition is a picture of the orange overlay.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) {
  console.error('usage: node scripts/ui-shots.mjs <before|after> [port] [outDir]');
  process.exit(1);
}
const PORT = process.argv[3] || '5241';
const OUT = process.argv[4] || 'docs/sessions/handoffs/img';
const BASE = `http://localhost:${PORT}`;
const SIZES = [[1440, 900], [1280, 700]];

/* T2 (2026-09-22): the file name carried a hard-coded `t0-`, and the page set
   was T0's six. Both are now overridable and BOTH DEFAULT TO EXACTLY WHAT THEY
   WERE, so `node scripts/ui-shots.mjs before 5241` still writes T0's twelve
   files with T0's names.
     UI_SHOTS_PREFIX=t2               the file-name prefix
     UI_SHOTS_PAGES=rabbit-intake,…   which pages, by key (default: T0's six)
   A lane whose surface is a TAB inside a project cannot reach it by URL — see
   `driveToTab` — which is why the page set is a registry rather than a list of
   paths. */
const PREFIX = process.env.UI_SHOTS_PREFIX || 't0';

/* Six pages. `rabbit-timeline` is the one that needs driving rather than a
   URL: R.A.B.B.I.T. opens on its project list and Timeline is a tab inside a
   project, so the fixture project has to be opened first. */
const ALL_PAGES = [
  { key: 'home', path: '/' },
  { key: 'settings', path: '/settings' },
  { key: 'dog', path: '/dog' },
  { key: 'otter', path: '/otter' },
  { key: 'files', path: '/project-files', drive: driveToFiles },
  { key: 'rabbit-timeline', path: '/rabbit', drive: driveToTimeline },
  /* T2's surfaces. Three of the four files in its bundle draw here; the
     fourth, `ProjectFilesTable`, is drawn by BOTH `rabbit-intake` and
     `files`, which is why it belongs to B4 and not to a lane. */
  { key: 'rabbit-intake', path: '/rabbit', drive: driveToTab('Intake') },
  { key: 'rabbit-team', path: '/rabbit', drive: driveToTab('Team') },
  { key: 'rabbit-summary', path: '/rabbit', drive: driveToTab('Summary') },
  /* `ProjectFilesTable` draws itself TWICE over, and only this page shows the
     second one: `ProjectDetailPanel` passes `warm`, the light-surface variant,
     where the same `fontSize: w ? 12 : 10` ternary takes its other arm. A shot
     of the dark one alone would have proved half of that file. */
  { key: 'projects', path: '/project-manager', drive: driveToProject },
];

const DEFAULT_KEYS = ['home', 'settings', 'dog', 'otter', 'files', 'rabbit-timeline'];
const WANTED = (process.env.UI_SHOTS_PAGES || DEFAULT_KEYS.join(',')).split(',').map((s) => s.trim());
const PAGES = WANTED.map((k) => {
  const p = ALL_PAGES.find((x) => x.key === k);
  if (!p) { console.error(`unknown page key: ${k}`); process.exit(1); }
  return p;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Click a button by its text, in the page's own DOM.
 *
 * 🚨 WHY NOT `page.locator(...)`. App.jsx renders EVERY page at once and hides
 * the inactive ones to preserve their state ("all pages rendered" — the
 * comment is right there above the content block), so a Playwright locator
 * happily resolves `button:has-text("Summary")` to a button on a page nobody
 * is looking at, and then either times out on it or clicks nothing. This is
 * F4's trap 7 in a different surface. Matching in-page and dispatching the
 * click directly sidesteps both the hidden-twin problem and the nav strip's
 * off-screen transform.
 */
async function clickByText(page, text, exact = true) {
  return page.evaluate(({ text, exact }) => {
    const btns = [...document.querySelectorAll('button')];
    const hit = btns.find((b) => {
      const t = (b.textContent || '').trim();
      return exact ? t === text : t.includes(text);
    });
    if (hit) { hit.click(); return true; }
    return false;
  }, { text, exact });
}

/**
 * Open the fixture project, THEN the Timeline tab — in that order.
 *
 * Timeline with no project selected is an empty state, not a Gantt, and the
 * empty state says so: "Open the Summary tab to pick an existing project".
 * The first draft of this script clicked Timeline first and screenshotted the
 * empty state twice. The project is chosen on Summary (or through the SWITCH
 * control in the project bar), and only then does Timeline have anything to
 * draw.
 */
/**
 * Choose a project on the Files page, which otherwise draws "No project
 * chosen" — and Files is the page Audrey called out by name, so an empty
 * state is the one picture that must not be in this set.
 * React owns the select's value, so setting `.value` alone does nothing: the
 * native setter has to be called and an `input`/`change` dispatched for
 * React's synthetic handler to see it.
 */
async function driveToFiles(page) {
  await page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find((s) =>
      /choose a project/i.test(s.options[0]?.textContent || ''));
    if (!sel || sel.options.length < 2) return false;
    const proto = Object.getPrototypeOf(sel);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(sel, sel.options[1].value) : (sel.value = sel.options[1].value);
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  await sleep(4000);
}

async function driveToTimeline(page) {
  await clickByText(page, 'Summary');
  await sleep(2500);
  const picked = await clickByText(page, 'Salt Hours', false);
  await sleep(3500);
  const tl = await clickByText(page, 'Timeline');
  await sleep(4500);
  if (!picked || !tl) console.log(`    (drive: project=${picked} timeline=${tl})`);
}

/**
 * The same three steps for any other R.A.B.B.I.T. tab: land on Summary, pick
 * the fixture project, open the tab. Every one of the eleven tabs is an empty
 * state until a project is chosen (trap 16 — the first two runs of this script
 * screenshotted "No project selected" at both sizes and the PNGs looked
 * plausible), so the project step is not optional for any of them.
 */
/**
 * Open the fixture project's detail panel on the Projects page.
 *
 * 🚨 NOT `clickByText`. That one queries `button` only — correct everywhere
 * else, and useless here, because the Projects list is a real `<table>` and
 * the row is a `<tr>`. The first run of this drive reported success (the
 * project NAME is on the page) and screenshotted the list with no panel open.
 * So: click the row, and require it to be VISIBLE, which is what keeps
 * App.jsx's every-page-rendered-at-once from resolving a twin on a page nobody
 * is looking at.
 */
async function driveToProject(page) {
  const picked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr, [role="row"]')];
    const hit = rows.find((r) => (r.textContent || '').includes('Salt Hours') && r.offsetParent !== null);
    if (!hit) return false;
    (hit.querySelector('td') || hit).click();
    return true;
  });
  await sleep(4500);
  if (!picked) console.log('    (drive: project row=false)');
}

function driveToTab(label) {
  return async function drive(page) {
    await clickByText(page, 'Summary');
    await sleep(2500);
    const picked = await clickByText(page, 'Salt Hours', false);
    await sleep(3500);
    const tab = await clickByText(page, label);
    await sleep(4000);
    if (!picked || !tab) console.log(`    (drive: project=${picked} ${label}=${tab})`);
  };
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const written = [];

for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();

  // Boot once per context and let the intro and auto-login finish.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sleep(12000);

  for (const p of PAGES) {
    await page.goto(BASE + p.path, { waitUntil: 'domcontentloaded' });
    await sleep(p.path === '/' ? 5000 : 6500); // clear the page transition
    if (p.drive) await p.drive(page);
    const file = join(OUT, `${PREFIX}-${phase}-${p.key}-${w}x${h}.png`);
    await page.screenshot({ path: file, animations: 'disabled' });
    written.push([file, statSync(file).size]);
    console.log(`  ${file}  ${(statSync(file).size / 1024).toFixed(0)} kB`);
  }
  await ctx.close();
}

await browser.close();
const total = written.reduce((a, [, n]) => a + n, 0);
console.log(`\n${written.length} shots, ${(total / 1024 / 1024).toFixed(2)} MB total`);
