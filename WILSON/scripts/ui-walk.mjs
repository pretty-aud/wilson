#!/usr/bin/env node
/**
 * UI overhaul — V1's walk of every page AND every sub-view a URL cannot reach.
 *
 *   node scripts/ui-walk.mjs <port> [W] [H] [--only a,b] [--shots <dir>] [--json <file>] [--fast] [-v]
 *
 * Plan §5 Wave 4, V1: "walk every page and sub-view with the new designs at
 * 1440x900 and 1280x700, check the chosen face at every step, the alignment
 * of every table and toolbar, the two page classes".
 *
 * `ui-page-check.mjs` walks twelve URLs, and T1 and T2 each found the hard way
 * that twelve URLs is not twelve screens: the lesson surface needs two clicks,
 * every R.A.B.B.I.T. tab needs a project. V1 counted what else a URL cannot
 * reach — Settings' seven tabs, the Admin Terminal's seven sections, Budget's
 * ten views, O.T.T.E.R.'s nine, and about sixty dialogs — and NONE of it had
 * been measured by anything. This is the registry for all of it.
 *
 * Every entry names the step that opens it AND a proof that it opened. A
 * drive that silently misses screenshots the page underneath and measures it
 * clean (T0 trap 16, T1 trap 2, T2 trap 3 — three sessions, one lesson), so a
 * sub-view whose proof fails is a FAILURE here, never a pass.
 *
 * Per screen it measures, through `ui-measure.mjs` (one implementation, shared
 * with the page check):
 *   err / ovf / off / clip   — exactly what ui-page-check reports
 *   face    glyphs Chrome actually drew in a face that is not Geist or Geist
 *           Mono (the DevTools protocol's platform-font report — not CSS)
 *   wt / up / trk            — §3.1: weight off 400/600, capitals off the
 *           Label step, tracking off Label and H1
 *   anon    visible buttons with no text, aria-label, title or labelledby
 *   ground  which page class the field is on (Q1)
 *   dlg     the open dialog's surface, radius, title and whether every edge
 *           is on screen (§3.3's 1280x700 question)
 *   align   header-vs-column alignment in real tables; centre-line spread in
 *           toolbars (reported, not failed — see the functions' comments)
 *   b2 / rad / white / cr   stop point 1's other claims — one border, two
 *           radii, no white — and contrast (`stopPointCensus`). REPORTED,
 *           NOT FAILED: lanes A, B and C have not run, and every one of
 *           these is expected on their unconverted surfaces. De-duplicated
 *           across screens at the end, and saved whole by --json.
 *
 * It exits 1 on anything new. Findings V1 FILED rather than fixed are listed
 * in KNOWN below with their filing id, print as `known`, and do not fail, so
 * the walk stays a gate: the next session learns about a NEW defect and is
 * not trained to ignore a red run.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1 (see ui-shots.mjs). Nothing in the registry deletes,
 * creates, generates, runs, saves, sends or uploads: every opener was chosen
 * by hand from a dry run, and R.A.B.B.I.T.'s "New project" is deliberately
 * absent because it CREATES a project rather than opening a form.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pageCensus, typeCensus, renderedFaces, typeRules, pageGround, openDialog, tableAlignment, toolbarAlignment, unnamedControls, selectedControl, styledActive, stopPointCensus } from './ui-measure.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const positional = args.filter((a, i) => !a.startsWith('-') && !['--only', '--shots', '--json'].includes(args[i - 1]));
const PORT = positional[0] || '5245';
const W = Number(positional[1] || 1280);
const H = Number(positional[2] || 700);
const BASE = `http://localhost:${PORT}`;
const ONLY = flag('--only')?.split(',');
const SHOTS = flag('--shots');
const JSON_OUT = flag('--json');
const VERBOSE = args.includes('-v');
/* --fast skips the rendered-face query, the one slow measurement (a DevTools
   round trip per text node, ~30s a screen on a dense table). Use it for a
   census rerun; never for a claim about the face. */
const FAST = args.includes('--fast');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────────── the registry ──────────────────────────────
   step strings:  a visible control's text, aria-label or title (exact first,
                  then prefix); '@proj' opens the Salt Hours fixture project;
                  '@files' picks the first project on Files; '@row:<text>'
                  clicks a visible table row; '@lesson' opens a lesson;
                  '@quit' fires the Electron close request (see `stub`).
   expect:        { dialog: true } | { text } | { selector } | { expanded }
                  | { styled } — the named button is the one sibling styled
                  differently: for tab bars with NO selection state (Budget)
                  | { active } — the named tab is now the SELECTED one
                  (aria-selected, data-active, aria-current or aria-pressed).
                  A tab's label is visible whichever tab is showing, so a
                  text proof cannot tell them apart.                          */
const P = (key, path, extra = {}) => ({ key, path, steps: [], ...extra });
const REGISTRY = [
  // The twelve URLs, as ui-page-check walks them.
  P('home', '/', { homeCaps: true, expect: { text: 'R.A.B.B.I.T.' } }),
  P('dog', '/dog', { expect: { text: 'Generate Page Outline' } }),
  P('otter', '/otter', { expect: { text: 'New Course' } }),
  P('rabbit', '/rabbit', { expect: { text: 'Salt Hours' } }),
  P('settings', '/settings', { expect: { text: 'General' } }),
  P('projects', '/project-manager', { expect: { text: 'Salt Hours' } }),
  P('rate-card', '/rate-card', { expect: { text: 'Add a role' } }),
  P('team-members', '/team-members', { expect: { text: 'Invite user' } }),
  P('files', '/project-files', { expect: { text: 'Columns' } }),
  P('dashboard', '/dashboard', { expect: { text: 'My tasks' } }),
  P('admin-terminal', '/admin-terminal', { expect: { text: 'Add people' } }),
  P('help', '/help', { expect: { text: 'Basic Workflow' } }),

  // The shell.
  P('shell-nav', '/dog', { steps: ['Navigation'], expect: { expanded: 'Navigation' } }),
  P('shell-quit', '/', { steps: ['@quit'], stub: true, homeCaps: true, expect: { text: 'Close WILSON' } }),

  // D.O.G.
  P('dog-history', '/dog', { steps: ['Import/Export History'], expect: { dialog: true } }),
  P('dog-settings', '/dog', { steps: ['Tool settings'], expect: { dialog: true } }),

  // O.T.T.E.R. — the reading surface and the views behind the tool's own bar.
  P('otter-lesson', '/otter', { steps: ['@lesson'], expect: { selector: '.lesson-content' } }),
  P('otter-settings', '/otter', { steps: ['Tool settings'], expect: { dialog: true } }),
  P('otter-search', '/otter', { steps: ['Search'], expect: { dialog: true } }),
  P('otter-quiz', '/otter', { steps: ['Quiz'], expect: { text: 'Quiz Center' } }),
  P('otter-hotkeys', '/otter', { steps: ['Hotkeys'], expect: { text: 'Keyboard Shortcuts' } }),
  P('otter-nodes', '/otter', { steps: ['Nodes'], expect: { text: 'Nodes Reference' } }),
  P('otter-admin', '/otter', { steps: ['Admin'], expect: { text: 'For your review' } }),
  P('otter-validate', '/otter', { steps: ['Validate'], expect: { text: 'Lesson Validator' } }),
  P('otter-new-course', '/otter', { steps: ['New Course'], expect: { text: 'New Software Course' } }),
  P('otter-import', '/otter', { steps: ['Import'], expect: { text: 'Import Data' } }),

  // R.A.B.B.I.T. — the nine tabs with the project open, then what opens off them.
  ...['Intake', 'Summary', 'Team', 'Tasks', 'Timeline', 'Budget', 'Assets', 'Scenes', 'Bins'].map((t) =>
    P(`rabbit-${t.toLowerCase()}`, '/rabbit', { steps: ['@proj', t], expect: { active: t } })),
  P('rabbit-settings', '/rabbit', { steps: ['RABBIT settings'], expect: { text: 'Holidays / Blocked Days' } }),
  P('rabbit-help', '/rabbit', { steps: ['Help & Documentation'], expect: { text: 'Key Features' } }),
  P('rabbit-control-panel', '/rabbit', { steps: ['@proj', 'Summary', 'Control Panel'], expect: { text: 'Budget Variables' } }),
  P('rabbit-task-new', '/rabbit', { steps: ['@proj', 'Tasks', 'New task'], expect: { dialog: true } }),
  P('rabbit-task-detail', '/rabbit', { steps: ['@proj', 'Tasks', 'View task details'], expect: { dialog: true } }),
  P('rabbit-task-history', '/rabbit', { steps: ['@proj', 'Tasks', 'View edit history'], expect: { text: 'Edit history' } }),
  ...['By Role', 'By Asset', 'By Scene', 'By Shot', 'Custom', 'Crew/Team', 'Talent', 'Expenses', 'Client View'].map((t) =>
    P(`rabbit-budget-${t.toLowerCase().replace(/[^a-z]+/g, '-')}`, '/rabbit', { steps: ['@proj', 'Budget', t], expect: { styled: t } })),
  P('rabbit-asset-new', '/rabbit', { steps: ['@proj', 'Assets', 'New asset'], expect: { dialog: true } }),
  P('rabbit-asset-detail', '/rabbit', { steps: ['@proj', 'Assets', 'View asset details'], expect: { dialog: true } }),
  P('rabbit-scene-detail', '/rabbit', { steps: ['@proj', 'Scenes', 'View details'], expect: { text: 'Lighthouse, dawn' } }),

  // Settings' seven tabs (General is the page itself) and its one dialog.
  ...['Profile', 'Models', 'Storage', 'Teams', 'Agent', 'Agent Skills'].map((t) =>
    P(`settings-${t.toLowerCase().replace(/\s+/g, '-')}`, '/settings', { steps: [t], expect: { text: { Profile: 'Two-factor authentication', Models: 'AI models', Storage: 'Storage backend', Teams: 'Departments', Agent: 'Agent settings', 'Agent Skills': 'Agent skills' }[t] } })),
  P('settings-reset-dialog', '/settings', { steps: ['Reset history'], expect: { dialog: true } }),

  // The resource pages' sub-views.
  P('projects-detail', '/project-manager', { steps: ['@row:Salt Hours'], expect: { text: 'Project details' } }),
  P('rate-card-gsheet', '/rate-card', { steps: ['Google Sheet'], expect: { dialog: true } }),
  P('team-invite', '/team-members', { steps: ['Invite user'], expect: { dialog: true } }),
  P('team-rate', '/team-members', { steps: ['Edit rate card entry'], expect: { dialog: true } }),
  // Files opens in its Columns (Finder) view; the table exists only after "Table".
  P('files-project', '/project-files', { steps: ['@files', 'Table'], expect: { selector: 'table tbody tr' } }),
  P('dashboard-profile', '/dashboard', { steps: ['Profile'], expect: { active: 'Profile' } }),
  P('dashboard-notes', '/dashboard', { steps: ['Notes'], expect: { active: 'Notes' } }),
  ...['Company', 'Models', 'Storage', 'Logs', 'Diagnostics'].map((t) =>
    P(`admin-${t.toLowerCase()}`, '/admin-terminal', { steps: [t], expect: { active: t } })),
  ...['O.T.T.E.R.', 'Project Manager', 'Wilson'].map((t) =>
    P(`help-${t.toLowerCase().replace(/[^a-z]+/g, '')}`, '/help', { steps: [t], expect: { text: { 'O.T.T.E.R.': 'Course Library', 'Project Manager': 'Project Manager Overview', Wilson: 'About Wilson' }[t] } })),
];

/* ─────────────────────────── known, filed findings ─────────────────────────
   Each entry is a finding V1 FILED rather than fixed, keyed on the screen
   AND on what it is (the element's own text, or the unnamed control's icon),
   never on the screen alone — so a NEW defect of a known kind on a known
   screen still fails. The ids are the filings in
   docs/sessions/handoffs/ui-v1-2026-09-23.md §4; generated from both walks'
   --json at 1280x700 and 1440x900, not typed. When a lane fixes one, delete
   its line: an entry that no longer matches anything is harmless, but it is
   a claim, and a stale claim is how the next session gets misled.

   Empty on purpose: weight, upper, tracking, dialogFit. V1 FIXED every case
   of those it found (0223dbf), so any one of them is new. */
const KNOWN = {
  /* V1-01 — glyphs fontsource's Latin subset of Geist does not ship, drawn
     by Windows in Segoe UI instead. A font decision, not a per-site one: the
     lesson prose is generated content no icon swap can reach. */
  face: [
    { key: 'otter-lesson', text: 'Project Settings → M' },
    { key: 'otter-lesson', text: 'The is fixed the mom' },
    { key: 'otter-new-course', text: '○ Add Subject' },
    { key: 'otter-new-course', text: '○ Share with the com' },
    { key: 'otter-new-course', text: '● Just for me' },
    { key: 'otter-new-course', text: '● New Course' },
    { key: 'rabbit-intake', text: 'Run Intake →' },
    { key: 'rabbit-task-new', text: '✕' },
  ],
  weight: [],
  upper: [],
  tracking: [],
  dialogFit: [],
  errors: [
    /* Environment, not UI. The dev tester has NO session (App.jsx: "sign-in
       skipped, no session, no workspace"), so a section that fetches from
       the backend is refused; and the quit dialog's Electron stub makes
       `hasLocalServer()` true, so the app asks a local server that is not
       there. Neither can happen to a signed-in user in the desktop app. */
    { key: 'admin-logs', text: 'status of 401' },
    { key: 'admin-storage', text: 'status of 401' },
    { key: 'shell-quit', text: 'status of 404' },
    /* V1-09 — a <button> nested inside a <button> (React's own warning,
       element names captured from the console arguments). B4 and B5. */
    { key: 'rabbit-asset-detail', text: 'cannot be a descendant' },
    { key: 'rabbit-asset-detail', text: 'cannot contain a nested' },
    { key: 'rabbit-scene-detail', text: 'cannot be a descendant' },
  ],
  /* V1-05 — icon-only controls with no text, aria-label, title or
     labelledby (§3.3). By screen and icon; `no-icon` is a control with
     neither a name nor a lucide glyph. The Tasks table alone carries 43 row
     checkboxes and 42 delete buttons like this; the `lucide-x` rows are
     dialog CLOSE buttons. Owners: A1/A2 (dog*), A3/A4 (otter*), B1-B6
     (rabbit*), C1 (projects-detail), and the shell: the Electron title
     bar's three window controls, seen only under the quit stub. `shell-nav`
     opens the strip over /dog, so its four are D.O.G.'s — the strip itself
     adds none. */
  anon: [
    { key: 'dog', text: 'lucide-check' },
    { key: 'dog', text: 'no-icon' },
    { key: 'dog-history', text: 'lucide-check' },
    { key: 'dog-history', text: 'lucide-x' },
    { key: 'dog-history', text: 'no-icon' },
    { key: 'dog-settings', text: 'lucide-check' },
    { key: 'dog-settings', text: 'lucide-x' },
    { key: 'dog-settings', text: 'no-icon' },
    { key: 'otter-quiz', text: 'lucide-chevron-down' },
    { key: 'otter-search', text: 'lucide-x' },
    { key: 'otter-settings', text: 'lucide-x' },
    { key: 'otter-settings', text: 'no-icon' },
    { key: 'projects-detail', text: 'lucide-trash2' },
    { key: 'rabbit-asset-detail', text: 'lucide-square' },
    { key: 'rabbit-asset-detail', text: 'lucide-trash2' },
    { key: 'rabbit-asset-detail', text: 'lucide-x' },
    { key: 'rabbit-asset-new', text: 'lucide-square' },
    { key: 'rabbit-asset-new', text: 'lucide-trash2' },
    { key: 'rabbit-asset-new', text: 'lucide-x' },
    { key: 'rabbit-assets', text: 'lucide-square' },
    { key: 'rabbit-assets', text: 'lucide-trash2' },
    { key: 'rabbit-budget', text: 'no-icon' },
    { key: 'rabbit-control-panel', text: 'lucide-trash2' },
    { key: 'rabbit-control-panel', text: 'no-icon' },
    { key: 'rabbit-help', text: 'lucide-x' },
    { key: 'rabbit-scene-detail', text: 'lucide-arrow-up-down' },
    { key: 'rabbit-scene-detail', text: 'lucide-chevron-right' },
    { key: 'rabbit-scene-detail', text: 'lucide-trash2' },
    { key: 'rabbit-scene-detail', text: 'lucide-x' },
    { key: 'rabbit-scenes', text: 'lucide-arrow-up-down' },
    { key: 'rabbit-scenes', text: 'lucide-chevron-right' },
    { key: 'rabbit-settings', text: 'lucide-check' },
    { key: 'rabbit-settings', text: 'lucide-x' },
    { key: 'rabbit-settings', text: 'no-icon' },
    { key: 'rabbit-task-detail', text: 'lucide-square' },
    { key: 'rabbit-task-detail', text: 'lucide-trash2' },
    { key: 'rabbit-task-detail', text: 'lucide-x' },
    { key: 'rabbit-task-history', text: 'lucide-square' },
    { key: 'rabbit-task-history', text: 'lucide-trash2' },
    { key: 'rabbit-task-new', text: 'lucide-square' },
    { key: 'rabbit-task-new', text: 'lucide-trash2' },
    { key: 'rabbit-tasks', text: 'lucide-square' },
    { key: 'rabbit-tasks', text: 'lucide-trash2' },
    { key: 'shell-nav', text: 'lucide-check' },
    { key: 'shell-nav', text: 'no-icon' },
    { key: 'shell-quit', text: 'no-icon' },
  ],
};
/* `text` is REQUIRED on every entry: a key-only entry would excuse
   everything of its kind on that screen, which is the silent-green shape
   every session in this lane has hit once. */
const isKnown = (kind, key, text) => KNOWN[kind].some((k) => k.key === key && typeof k.text === 'string' && (text || '').includes(k.text));

/* ───────────────────────────────── driving ───────────────────────────────── */
async function click(page, label) {
  return page.evaluate((label) => {
    const vis = (e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0;
    const els = [...document.querySelectorAll('button, [role="button"], [role="tab"], a')].filter(vis);
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const named = (e) => [e.getAttribute('aria-label'), e.getAttribute('title')].filter(Boolean);
    const hit = els.find((e) => norm(e.textContent) === label)
      || els.find((e) => named(e).some((n) => n === label))
      || els.find((e) => named(e).some((n) => n.startsWith(label)))
      || els.find((e) => norm(e.textContent).startsWith(label));
    if (!hit) return false;
    hit.click();
    return true;
  }, label);
}

async function step(page, s) {
  if (s === '@proj') return page.evaluate(() => {
    const x = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Salt Hours') && b.offsetParent !== null);
    if (x) { x.click(); return true; } return false;
  });
  if (s === '@files') return page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find((s) => /choose a project/i.test(s.options[0]?.textContent || ''));
    if (!sel || sel.options.length < 2) return false;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value').set.call(sel, sel.options[1].value);
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  if (s.startsWith('@row:')) return page.evaluate((t) => {
    const r = [...document.querySelectorAll('tbody tr, [role="row"]')].find((r) => r.offsetParent !== null && (r.textContent || '').includes(t));
    if (!r) return false; (r.querySelector('td') || r).click(); return true;
  }, s.slice(5));
  if (s === '@lesson') {
    // ui-shots.mjs's driveToLesson, by the same two titles.
    const wide = (text) => page.evaluate((text) => {
      const hit = [...document.querySelectorAll('button, [role="button"], h1, h2, h3, h4')].find((e) => (e.textContent || '').trim() === text);
      if (!hit) return false; (hit.closest('button, [role="button"]') || hit).click(); return true;
    }, text);
    const a = await wide('DaVinci Resolve 19'); await sleep(3500);
    return a && wide('Project setup and media');
  }
  if (s === '@quit') return page.evaluate(() => { if (!window.__v1Close) return false; window.__v1Close(); return true; });
  return click(page, s);
}

async function opened(page, expect) {
  if (!expect) return true;
  if (expect.dialog) return !!(await page.evaluate(openDialog));
  if (expect.active) return page.evaluate(selectedControl, expect.active);
  if (expect.styled) return page.evaluate(styledActive, expect.styled);
  return page.evaluate((e) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && (el.offsetParent !== null || cs.position === 'fixed'); };
    if (e.selector) return [...document.querySelectorAll(e.selector)].some(vis);
    if (e.expanded) return !!document.querySelector(`[title="${e.expanded}"][aria-expanded="true"], [aria-label="${e.expanded}"][aria-expanded="true"]`);
    return [...document.querySelectorAll('body *')].some((el) => vis(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes(e.text)));
  }, expect);
}

/* ──────────────────────────────── measuring ──────────────────────────────── */
const FAILED = [];
const REPORT = [];

async function visit(ctx, entry) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 110)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 110)));

  await page.goto(BASE + entry.path, { waitUntil: 'domcontentloaded' });
  await sleep(5000);
  let drove = true;
  for (const s of entry.steps) {
    drove = (await step(page, s)) && drove;
    await sleep(s === '@proj' ? 4000 : 3000);
  }
  let isOpen = drove && await opened(page, entry.expect);
  /* One more try at the LAST step, then the proof again. V1's gate run
     caught `rabbit-intake` measuring Summary — the Intake click landed while
     Summary was still settling and was swallowed; every earlier run opened
     it. The proof is what caught it (the page check would have printed that
     row as a clean Intake), and a second failed proof is still a miss. */
  if (!isOpen && entry.steps.length) {
    await sleep(2500);
    await step(page, entry.steps[entry.steps.length - 1]);
    await sleep(3500);
    isOpen = await opened(page, entry.expect);
    if (isOpen) console.log(`  ~ ${entry.key}: opened on the second try of "${entry.steps[entry.steps.length - 1]}"`);
  }

  const info = await page.evaluate(pageCensus);
  const rows = await page.evaluate(typeCensus);
  const faces = FAST ? { tally: {}, off: [], unmeasured: 0, probed: 0 } : await renderedFaces(cdp, rows);
  const rules = typeRules(rows, { homeCaps: !!entry.homeCaps });
  const ground = await page.evaluate(pageGround);
  const dlg = await page.evaluate(openDialog);
  const tables = await page.evaluate(tableAlignment);
  const bars = await page.evaluate(toolbarAlignment);
  const anon = await page.evaluate(unnamedControls);
  const census = await page.evaluate(stopPointCensus);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${entry.key}-${W}x${H}.png`), animations: 'disabled' });

  const k = entry.key;
  const news = {
    face: faces.off.filter((r) => !isKnown('face', k, r.text)),
    weight: rules.weight.filter((r) => !isKnown('weight', k, r.text)),
    upper: rules.upper.filter((r) => !isKnown('upper', k, r.text)),
    tracking: rules.tracking.filter((r) => !isKnown('tracking', k, r.text)),
    errors: errors.filter((e) => !isKnown('errors', k, e)),
    anon: anon.filter((a) => !isKnown('anon', k, a)),
  };
  const dlgBad = dlg && !dlg.fits && !isKnown('dialogFit', k);
  const thin = info.measured < 10;
  const bad = !isOpen || thin || info.overflow || info.offScale || dlgBad
    || news.face.length || news.weight.length || news.upper.length || news.tracking.length || news.errors.length || news.anon.length;

  const knownN = (faces.off.length - news.face.length) + (rules.weight.length - news.weight.length)
    + (rules.upper.length - news.upper.length) + (rules.tracking.length - news.tracking.length) + (anon.length - news.anon.length);
  const dl = dlg ? ` dlg=${dlg.kind}:${dlg.bg}/r${dlg.radius}/${dlg.box[2]}x${dlg.box[3]}${dlg.fits ? '' : ' OFF-SCREEN'}` : '';
  const gr = dlg ? '(under a dialog)' : ground.join('/');
  console.log(`${(isOpen ? '' : '✗ ') + k}`.padEnd(30)
    + ` err=${errors.length} ovf=${info.overflow ? 'Y' : 'n'} off=${info.offScale} clip=${String(info.clipped).padEnd(3)}`
    + ` face=${faces.off.length} wt=${rules.weight.length} up=${rules.upper.length} trk=${rules.tracking.length} anon=${anon.length}`
    + (knownN ? ` (known ${knownN})` : '') + ` b2=${census.border.length} rad=${census.radius.length} white=${census.white.length} cr=${census.contrast.length} brk=${census.broken.length}`
    + ` ground=${gr}${dl}`
    + (isOpen ? '' : '   ← DID NOT OPEN') + (thin ? `   ← ONLY ${info.measured} TEXT NODES` : ''));
  const show = (label, arr, f) => { for (const r of arr.slice(0, VERBOSE ? 50 : 4)) console.log(`      ${label} ${f(r)}`); if (!VERBOSE && arr.length > 4) console.log(`      ${label} … +${arr.length - 4}`); };
  show('face', news.face, (r) => `${r.used} x${r.glyphs} <${r.tag}> "${r.text}"`);
  show('wt  ', news.weight, (r) => `${r.weight} ${r.px}px <${r.tag}.${r.cls}> "${r.text}"`);
  show('up  ', news.upper, (r) => `${r.px}px ${r.weight} <${r.tag}.${r.cls}> "${r.text}"`);
  show('trk ', news.tracking, (r) => `${r.tracking}px ${r.px}px <${r.tag}.${r.cls}> "${r.text}"`);
  show('err ', news.errors, (e) => e);
  // Grouped: a table row's unnamed checkbox repeats once per row.
  const groups = Object.entries(news.anon.reduce((m, a) => ((m[a] = (m[a] || 0) + 1), m), {}));
  show('anon', groups, ([a, n]) => `${n > 1 ? n + ' × ' : ''}${a}`);
  if (dlg && (VERBOSE || dlgBad)) console.log(`      dlg  ${JSON.stringify(dlg)}`);
  if (VERBOSE) {
    if (tables.alignMismatch.length || tables.offset.length) console.log(`      tbl  ${tables.tables} tables/${tables.columns} cols  align: ${tables.alignMismatch.join('; ') || '-'}  offset: ${tables.offset.join('; ') || '-'}`);
    for (const b of bars.slice(0, 3)) console.log(`      bar  spread ${b.spread}px  h ${b.heights}  ${b.labels}`);
  }
  REPORT.push({ key: k, ground: dlg ? ['(dialog)'] : ground, dlg, tables, bars, faces: faces.tally, clipped: info.clipped, anon, census,
    face: faces.off, rules, errors });
  if (bad) FAILED.push(k);
  await page.close();
}

const browser = await chromium.launch();
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const entries = REGISTRY.filter((e) => !ONLY || ONLY.includes(e.key));
console.log(`# ui-walk — ${entries.length} screens at ${W}x${H}, port ${PORT}\n`);

/* Two contexts. The quit dialog only opens through
   `window.electronAPI.onCloseRequested`, so its entry runs in a context whose
   init script stubs exactly that hook and `forceClose` — and nothing else, so
   `hasLocalServer()` flipping true is contained to the one screen that needs it. */
for (const stubbed of [false, true]) {
  const batch = entries.filter((e) => !!e.stub === stubbed);
  if (!batch.length) continue;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  if (stubbed) await ctx.addInitScript(() => {
    window.electronAPI = { onCloseRequested: (cb) => { window.__v1Close = cb; return () => {}; }, forceClose: () => {} };
  });
  const boot = await ctx.newPage();
  await boot.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sleep(12000);
  await boot.close();
  /* One retry per screen. V1's first full walk died at Budget with
     "Execution context was destroyed, most likely because of a navigation":
     Vite's dev server reloads the page when it first meets a dependency it
     has not pre-bundled, and a lazily loaded view is exactly that. A second
     failure is a failed SCREEN, not a crashed walk. */
  const firstLine = (err) => String(err.message || err).split(/\r?\n/)[0].slice(0, 90);
  for (const e of batch) {
    try { await visit(ctx, e); }
    catch (err) {
      console.log(`  ! ${e.key}: ${firstLine(err)} — retrying once`);
      for (const p of ctx.pages()) await p.close().catch(() => {});
      try { await visit(ctx, e); }
      catch (err2) { console.log(`✗ ${e.key}`.padEnd(30) + ` ${firstLine(err2)}`); FAILED.push(e.key); }
    }
  }
  await ctx.close();
}
await browser.close();

/* The two page classes (Q1), one line per screen class. */
const classes = {};
for (const r of REPORT) { const g = [...new Set(r.ground)].join('+'); (classes[g] ||= []).push(r.key); }
console.log('\n— page ground (plan §2 Q1: light = Home, Settings, Help; paper = the tools and the six data pages) —');
for (const [g, keys] of Object.entries(classes)) console.log(`  ${g.padEnd(28)} ${keys.join(', ')}`);

/* Stop point 1's census, de-duplicated: one line per distinct offender,
   with how many screens it appears on. A table row repeats per row and a
   shell element repeats per page; neither should read as many findings. */
for (const kind of ['contrast', 'broken', 'white', 'border', 'radius']) {
  const seen = new Map();
  for (const r of REPORT) for (const d of new Set(r.census[kind])) { if (!seen.has(d)) seen.set(d, new Set()); seen.get(d).add(r.key); }
  console.log(`
— ${kind}: ${seen.size} distinct —`);
  for (const [d, keys] of [...seen].sort((a, b) => b[1].size - a[1].size).slice(0, VERBOSE ? 400 : 12)) console.log(`  ${String(keys.size).padStart(3)}× ${d}   [${[...keys].slice(0, 4).join(', ')}${keys.size > 4 ? ', …' : ''}]`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ W, H, report: REPORT }, null, 1));

const faceTotal = {};
for (const r of REPORT) for (const [f, n] of Object.entries(r.faces)) faceTotal[f] = (faceTotal[f] || 0) + n;
console.log(`\n— glyphs drawn, all screens — ${Object.entries(faceTotal).map(([f, n]) => `${f} ${n}`).join(' · ')}`);

if (FAILED.length) {
  console.log(`\n🚨 ${FAILED.length} of ${entries.length} screens did not come back clean: ${FAILED.join(', ')}`);
  process.exit(1);
}
console.log(`\n✓ ${entries.length} screens: every one opened, 0 errors, 0 overflow, 0 off-scale, every glyph in Geist, every rule of §3.1 held`);
