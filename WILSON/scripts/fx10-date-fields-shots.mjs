#!/usr/bin/env node
/**
 * The date fields, measured and photographed before and after — post-overhaul
 * FX10 (2026-10-13).
 *
 *   node scripts/fx10-date-fields-shots.mjs <port> --out <dir> --phase before|after
 *        [--engine chromium|electron|firefox|chrome|msedge] [--electron <electron.exe>]
 *        [--size 1440x900] [--part <name>[,<name>…]|all]
 *        [--no-shots] [--full]
 *
 * Audrey, 2026-10-13: "the calendar icon is covering the dates when it has all
 * the space to space them out" (the Tasks table: `09 / 26 / 202` with the
 * icon over the last digit, `mm / dd / yy` in the empty field).
 *
 * Walks every <input type="date"> of R.A.B.B.I.T.'s tables and windows on the
 * dev fixtures' Salt Hours (levels on `?fixtures=game`), and the three outside
 * it the kit's rule reaches (D.O.G.'s new project, the Projects page, a
 * Dashboard note), in one engine a run:
 *
 *   chromium  Playwright's Chromium (its headless shell). The field's own
 *             parts are read through the DevTools protocol (the input's
 *             user-agent shadow root: `-webkit-datetime-edit`, its fields,
 *             `-webkit-calendar-picker-indicator`).
 *   electron  the desktop app's own engine: this checkout's Electron binary
 *             (node_modules/electron/dist/electron.exe, or --electron <path>
 *             for another checkout's of the same version), one offscreen
 *             window on a throwaway user-data folder, driven over the
 *             DevTools protocol like chromium. Electron 33 = Chromium 130.
 *   chrome, msedge  the installed browser, through Playwright's channel.
 *   firefox   the INSTALLED Firefox (C:\Program Files\Mozilla Firefox), driven
 *             headless over WebDriver BiDi on a throwaway profile that is
 *             removed at the end, its crash reporter off — nothing is
 *             downloaded. Gecko draws the date with spaced slashes
 *             ("09 / 26 / 2026") and ALWAYS shows its calendar button (no
 *             `::-webkit-calendar-picker-indicator` rule reaches it) except on
 *             a disabled field: Audrey's screenshot is this engine's.
 *   Electron and Firefox each listen on a free port this run picks, and the
 *   run checks that the browser it reached is the one it started (Electron:
 *   a page titled with a one-off token; Firefox: the session's profile is
 *   the throwaway one) — it never measures some other app's browser.
 *
 * For each field, in three states (rest: the pointer parked; hover: the
 * pointer on the field, which hovers its row; focus: the field focused), it
 * prints and writes as `po-fx10-<phase>-<engine>-measure-<W>x<H>.json`:
 *   - the field's width and its cell's (a table cell, or the field's own
 *     container in a window), and whether the field runs past the cell (a
 *     borderless field bleeds 6px past its container a side by design);
 *   - `needs`: the field's max-content width, the engine's own measure of the
 *     whole date and its icon (a clone at `width: max-content`, same value).
 *     Firefox's is exact — its `short` (needs less the field) is the date it
 *     cuts; Chromium's is not (it grows with the pixel ratio and keeps room
 *     for a six-figure year), so in Chromium read `hidden` instead;
 *   - Chromium: the date's own width, how much of it the field hides, where
 *     the icon's glyph starts and the gap from the last figure to it;
 *   - every engine: a pixel scan of the field as drawn (its picture, scanned
 *     for ink): where the date's ink ends, where the icon's starts, the gap
 *     between, and the date's ink width against the same value drawn in a
 *     400px field (a shorter ink width = the date is cut). Focused, the
 *     scan leaves out the outer 3px a side (where an inset ring is drawn)
 *     and gives the gap only: the engine paints the date's focused part on
 *     a highlight, so its ink is not the reference's, and Chromium's parts
 *     and Firefox's `short` say whether it is cut (review round 1, R1-09);
 *   - after the states, every other control sharing the field's row (its
 *     table row, or its nearest grid or row of controls): its text against
 *     its room, an empty number field filled with "12.5" first — a date's
 *     room must not come out of a neighbour's (review round 1, R1-09). The
 *     `control-squeezed` part (not in `all`) squeezes the Bins inspector's
 *     left column to 24px in its page: the pass must report it.
 * Then a close-up picture of the measured fields per state (2x), and with
 * --full the whole window at rest and hovered. The pet companion's sprite is
 * hidden while measuring (it floats over the Bins inspector's Shoot day).
 *
 * 🚨 Edit nothing under WILSON/ while a run is going: Vite reloads every open
 * page on any change in the project (a test file too), and the run loses its
 * page ("window.__fx10 is undefined").
 *
 * Every table's first row gets her case: Start 2026-09-26, End empty; a
 * window's first date 2026-09-26 and its second empty; a window with one date
 * is measured full and empty. The values are written through the field
 * itself (its own input event, as typing does), so the fixtures' in-memory
 * store changes for this page only; nothing outlives it.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1 (the `fx10-worktree` entry in .claude/launch.json); it
 * refuses to run unless the page shows the fixtures badge. Animations and
 * transitions are off and the caret transparent, in this page only.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const VALUED = ['--out', '--size', '--phase', '--part', '--engine', '--electron'];
const PORT = args.find((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1])) || '5297';
const OUT = flag('--out');
const PHASE = flag('--phase');
const ENGINE = flag('--engine') || 'chromium';
const SHOTS = !args.includes('--no-shots');
const FULL = args.includes('--full');

const FULL_DATE = '2026-09-26';
// Where each surface is, how to reach it, and which date fields it holds.
// Steps: '@proj' the Salt Hours card; 'tab:<name>' a tab; 'click:<name>' any
// control by its name (exact, then prefix); 'row:<text>' a table row holding
// the text; 'css:<selector>' the first shown
// match, clicked; 'select:<aria-label>=<value>' a select set; 'wait:<css>';
// 'style:<css>' a style sheet added to this page (the control part only).
// `fields` selects the date inputs measured (the first `take`); `values` the
// configurations they are measured in, by index (a missing index keeps the
// field's own value).
const PARTS = {
  tasks: { steps: ['@proj', 'tab:Tasks', 'wait:tr.rb-task-row'], fields: 'tr.rb-task-row input[type="date"]', take: 4, values: [[FULL_DATE, '']], table: true },
  'tasks-phase': { steps: ['@proj', 'tab:Tasks', 'select:Group=phase', 'wait:.rb-task-group-row'], fields: '.rb-task-group-row input[type="date"]', take: 2, values: [[FULL_DATE, '']] },
  // The key date's editor commits and closes on blur: measured focused only.
  'tasks-keydate': { steps: ['@proj', 'tab:Tasks', 'css:button.rb-task-ms-date', 'wait:input[aria-label="Key date"]'], fields: 'input[aria-label="Key date"]', take: 1, values: [[FULL_DATE], ['']], keepFocus: true, table: true },
  'task-window': { steps: ['@proj', 'tab:Tasks', 'click:Open Lock the shooting script', 'wait:[role="dialog"]'], fields: '[role="dialog"] input[type="date"]', take: 2, values: [[FULL_DATE, '']] },
  'task-new': { steps: ['@proj', 'tab:Tasks', 'click:New task', 'wait:[role="dialog"]'], fields: '[role="dialog"] input[type="date"]', take: 2, values: [[FULL_DATE, '']] },
  assets: { steps: ['@proj', 'tab:Assets', 'wait:tr.rb-asset-row'], fields: 'tr.rb-asset-row input[type="date"]', take: 4, values: [[FULL_DATE, '']], table: true },
  'asset-window': { steps: ['@proj', 'tab:Assets', 'click:Open Shooting Script v4', 'wait:[role="dialog"]'], fields: '[role="dialog"] input[type="date"]', take: 2, values: [[FULL_DATE, '']] },
  'asset-new': { steps: ['@proj', 'tab:Assets', 'click:New asset', 'wait:[role="dialog"]'], fields: '[role="dialog"] input[type="date"]', take: 2, values: [[FULL_DATE, '']] },
  shots: { steps: ['@proj', 'tab:Scenes', 'tab:Shots', 'tab:Table', 'wait:.rb-scene-table-shots tr.rb-scene-row'], fields: '.rb-scene-table-shots tr.rb-scene-row input[type="date"]', take: 4, values: [[FULL_DATE, '']], table: true },
  'scene-window': { steps: ['@proj', 'tab:Scenes', 'click:Open Lighthouse, dawn', 'wait:[role="dialog"]'], fields: '[role="dialog"] input[type="date"]', take: 2, values: [[FULL_DATE, '']] },
  'shot-window': { steps: ['@proj', 'tab:Scenes', 'tab:Shots', 'click:Open The door', 'wait:[role="dialog"]'], fields: '[role="dialog"] input[type="date"]', take: 2, values: [[FULL_DATE, '']] },
  'level-window': { query: '?fixtures=game', steps: ['@proj', 'tab:Levels', 'click:Open Harbour Approach', 'wait:[role="dialog"]'], fields: '[role="dialog"] input.rb-ent-date', take: 2, values: [[FULL_DATE, '']] },
  'experience-window': { query: '?fixtures=game', steps: ['@proj', 'tab:Experiences', 'click:Open First Light', 'wait:[role="dialog"]'], fields: '[role="dialog"] input.rb-ent-date', take: 2, values: [[FULL_DATE, '']] },
  // An item window's new-task form (RelationsPanel): its three narrow columns.
  // The same window with the task form open (its left column narrower): the
  // level's own dates.
  'level-window-form': { query: '?fixtures=game', steps: ['@proj', 'tab:Levels', 'click:Open Harbour Approach', 'wait:[role="dialog"]', 'click:Add new task', 'wait:input[placeholder="Task title…"]'], fields: '[role="dialog"] input.rb-ent-date', take: 2, values: [[FULL_DATE, '']] },
  'level-task': { query: '?fixtures=game', steps: ['@proj', 'tab:Levels', 'click:Open Harbour Approach', 'wait:[role="dialog"]', 'click:Add new task', 'wait:input[placeholder="Task title…"]'], fields: '[role="dialog"] input.rb-rel-task-date', take: 2, values: [[FULL_DATE, '']] },
  // The same form in a scene's and a shot's window (RelationsPanel serves
  // all four; review round 1 checked these two by hand).
  'scene-task': { steps: ['@proj', 'tab:Scenes', 'click:Open Lighthouse, dawn', 'wait:[role="dialog"]', 'click:Add new task', 'wait:input[placeholder="Task title…"]'], fields: '[role="dialog"] input.rb-rel-task-date', take: 2, values: [[FULL_DATE, '']] },
  'shot-task': { steps: ['@proj', 'tab:Scenes', 'tab:Shots', 'click:Open The door', 'wait:[role="dialog"]', 'click:Add new task', 'wait:input[placeholder="Task title…"]'], fields: '[role="dialog"] input.rb-rel-task-date', take: 2, values: [[FULL_DATE, '']] },
  'timeline-task': { steps: ['@proj', 'tab:Timeline', 'click:Task', 'wait:.rb-tl-ed-title'], fields: 'input[type="date"]', take: 2, values: [[FULL_DATE, '']], within: '.rb-tl-ed-title' },
  'timeline-phase': { steps: ['@proj', 'tab:Timeline', 'click:Phase', 'wait:.rb-tl-ed-title'], fields: 'input[type="date"]', take: 2, values: [[FULL_DATE, '']], within: '.rb-tl-ed-title' },
  'timeline-keydate': { steps: ['@proj', 'tab:Timeline', 'click:Key date', 'wait:.rb-tl-ed-title'], fields: 'input[type="date"]', take: 1, values: [[FULL_DATE], ['']], within: '.rb-tl-ed-title' },
  holidays: { steps: ['click:R.A.B.B.I.T. settings', 'wait:input[aria-label="Holiday date"]'], fields: 'input[aria-label="Holiday date"]', take: 1, values: [[FULL_DATE], ['']] },
  'budget-expense': { steps: ['@proj', 'tab:Budget', 'tab:Expenses', 'click:New expense', 'wait:input[aria-label="Purchase date"]'], fields: 'input[aria-label="Purchase date"]', take: 1, values: [[FULL_DATE], ['']] },
  'control-panel': { steps: ['@proj', 'tab:Summary', 'click:Control panel', 'wait:input[type="date"]'], fields: 'input[type="date"]', take: 2, values: [[FULL_DATE, '']] },
  // Outside R.A.B.B.I.T., reached by the kit's rule too: D.O.G.'s new-project
  // form, the Projects page's details, the Dashboard's notes.
  'dog-new-project': { path: '/dog', steps: ['click:New project', 'wait:#dog-np-start'], fields: '#dog-np-start, #dog-np-end', take: 2, values: [[FULL_DATE, '']] },
  'projects-detail': { path: '/project-manager', steps: ['row:Salt Hours', 'wait:.pj-pair input[type="date"]'], fields: '.pj-pair input[type="date"]', take: 2, values: [[FULL_DATE, '']] },
  'dashboard-notes': { path: '/dashboard', steps: ['tab:Notes', 'css:.dash-note-row', 'wait:input.dash-date'], fields: 'input.dash-date', take: 1, values: [[FULL_DATE], ['']] },
  // Not walked: the Team tab's Start / End (`.ui-input.rb-team-date`) are the
  // legacy table of the desktop's signed-out Local Server; the fixtures run
  // the cloud branch (ProjectMembersPanel), which has no date field.
  intake: { steps: ['@proj', 'tab:Intake', 'click:New project', 'wait:input[type="date"]'], fields: 'input[type="date"]', take: 2, values: [[FULL_DATE, '']] },
  'bins-inspector': { steps: ['@proj', 'tab:Bins', 'click:List view', 'wait:.bn-trow', 'css:.bn-trow', 'wait:input[type="date"]'], fields: 'input[type="date"]', take: 1, values: [[FULL_DATE], ['']] },
  // A control, not a surface (left out of `all`): the same inspector with its
  // left column squeezed to 24px in this page, which the neighbours pass must
  // report as not fitting.
  'control-squeezed': { control: true, steps: ['@proj', 'tab:Bins', 'click:List view', 'wait:.bn-trow', 'css:.bn-trow', 'wait:input[type="date"]', 'style:.bn-insp-grid{grid-template-columns:24px minmax(calc(var(--date-room) + 18px),1fr)!important}'], fields: 'input[type="date"]', take: 1, values: [[FULL_DATE]] },
};
const ALL = Object.keys(PARTS).filter((p) => !PARTS[p].control);
if (!OUT || !['before', 'after'].includes(PHASE) || !['chromium', 'electron', 'firefox', 'chrome', 'msedge'].includes(ENGINE)) {
  console.error(`usage: fx10-date-fields-shots.mjs <port> --out <dir> --phase before|after [--engine chromium|electron|firefox|chrome|msedge] [--electron <exe>] [--size WxH] [--part ${Object.keys(PARTS).join('|')}|all] [--no-shots] [--full]`);
  process.exit(1);
}
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const WANT = (flag('--part') || 'all') === 'all' ? ALL : flag('--part').split(',');
for (const p of WANT) if (!PARTS[p]) { console.error(`unknown part ${p}`); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

// ── The page's side: functions run in the page by their source ─────────────
// (self-contained: they see only their argument and window.__fx10).

function pgHelpers() {
  const sleepP = (ms) => new Promise((r) => setTimeout(r, ms));
  const shown = (e) => {
    if (!e || !e.getClientRects().length) return false;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    return !e.closest('[aria-hidden="true"], [inert]');
  };
  const nameOf = (e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
  const CLICKABLE = 'button, [role="tab"], [role="menuitem"], [role="option"], [role="button"], a[href]';
  const find = (name, roleTab) => {
    const all = [...document.querySelectorAll(roleTab ? '[role="tab"]' : CLICKABLE)].filter(shown);
    return all.find((e) => nameOf(e) === name) || all.find((e) => nameOf(e).startsWith(name)) || null;
  };
  const waitFor = async (fn, ms = 10000) => {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await sleepP(100);
    }
  };
  window.__fx10 = { sleep: sleepP, shown, nameOf, find, waitFor };
  const s = document.createElement('style');
  // The pet companion's sprite floats bottom right, over a field there (the
  // Bins inspector's Shoot day): out of sight while measuring.
  s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
    + '.pet-slide-in,.pet-slide-out{visibility:hidden!important}';
  document.head.appendChild(s);
  return !!document.querySelector('button[aria-label="Turn dev fixtures off"]');
}

async function pgStep(step) {
  const { find, waitFor, shown, sleep: s } = window.__fx10;
  if (step === '@proj') {
    const card = await waitFor(() => [...document.querySelectorAll('.rb-summary-card, button')].filter(shown).find((e) => /Salt Hours/.test(e.textContent)));
    if (!card) return 'the Salt Hours card';
    card.click(); await s(900); return null;
  }
  const [kind, rest] = [step.slice(0, step.indexOf(':')), step.slice(step.indexOf(':') + 1)];
  if (kind === 'tab' || kind === 'click') {
    const el = await waitFor(() => find(rest, kind === 'tab'));
    if (!el) return `${kind} "${rest}"`;
    el.scrollIntoView({ block: 'center' });
    el.click(); await s(700); return null;
  }
  if (kind === 'css') {
    const el = await waitFor(() => [...document.querySelectorAll(rest)].find(shown));
    if (!el) return `css ${rest}`;
    el.scrollIntoView({ block: 'center' });
    el.click(); await s(600); return null;
  }
  if (kind === 'select') {
    const [label, value] = rest.split('=');
    const el = await waitFor(() => [...document.querySelectorAll(`select[aria-label="${label}"]`)].find(shown));
    if (!el) return `select ${label}`;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await s(600); return null;
  }
  if (kind === 'row') {
    const el = await waitFor(() => [...document.querySelectorAll('tr')].filter(shown).find((r) => r.textContent.includes(rest) && !r.closest('thead')));
    if (!el) return `row ${rest}`;
    el.click(); await s(700); return null;
  }
  if (kind === 'wait') {
    const el = await waitFor(() => [...document.querySelectorAll(rest)].find(shown));
    return el ? null : `wait ${rest}`;
  }
  if (kind === 'style') {
    const st = document.createElement('style');
    st.textContent = rest;
    document.head.appendChild(st);
    await s(300); return null;
  }
  return `unknown step ${step}`;
}

/** The fields: tagged data-fx10="<i>", with the values of `set` written first. */
async function pgFields({ sel, take, set, within }) {
  const { shown, sleep: s } = window.__fx10;
  const scope = within ? (() => { const t = document.querySelector(within); return t && (t.closest('[role="dialog"]') || t.closest('.fixed') || t.parentElement.parentElement); })() : document;
  if (!scope) return { error: `no scope ${within}` };
  const pick = () => [...scope.querySelectorAll(sel)].filter((e) => e.type === 'date' && shown(e)).slice(0, take);
  let fields = pick();
  if (!fields.length) return { error: `no date field for ${sel}` };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  for (let i = 0; i < fields.length && i < set.length; i++) {
    if (set[i] == null) continue;
    const el = fields[i];
    if (el.value === set[i]) continue;
    setter.call(el, set[i]);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await s(250);
    fields = pick();
  }
  await s(300);
  fields = pick();
  document.querySelectorAll('[data-fx10]').forEach((e) => e.removeAttribute('data-fx10'));
  // Its name: aria-label, else its <label>, else the nearest words before it.
  const labelOf = (el) => {
    const a = el.getAttribute('aria-label');
    if (a) return a;
    const lab = el.closest('label');
    if (lab && lab.textContent.trim()) return lab.textContent;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const p = n.previousElementSibling;
      if (p && p.textContent.trim()) return p.textContent;
    }
    return '';
  };
  return {
    fields: fields.map((el, i) => {
      el.setAttribute('data-fx10', String(i));
      return { i, label: labelOf(el).replace(/\s+/g, ' ').trim().slice(0, 40), cls: el.className, value: el.value };
    }),
  };
}

/** One field's numbers that page script can read. */
function pgBox(i) {
  const el = document.querySelector(`[data-fx10="${i}"]`);
  if (!el) return null;
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const cs = getComputedStyle(el);
  const px = (v) => parseFloat(v) || 0;
  const rb = el.getBoundingClientRect();
  const cell = el.closest('td') || el.parentElement;
  const cr = cell.getBoundingClientRect();
  const ccs = getComputedStyle(cell);
  // The field's clip: the nearest scroller or clipping box around it.
  let clipper = cell.tagName === 'TD' ? cell : null;
  const clone = el.cloneNode();
  clone.removeAttribute('data-fx10');
  clone.value = el.value;
  Object.assign(clone.style, { width: 'max-content', minWidth: '0', maxWidth: 'none', position: 'absolute', visibility: 'hidden', left: '0', top: '0' });
  el.parentElement.appendChild(clone);
  const needs = clone.getBoundingClientRect().width;
  clone.remove();
  return {
    x: rb.left, y: rb.top, w: rb.width, h: rb.height, right: rb.right,
    padL: px(cs.paddingLeft), padR: px(cs.paddingRight), bL: px(cs.borderLeftWidth), bR: px(cs.borderRightWidth),
    font: `${cs.fontSize} ${cs.fontFamily.split(',')[0]} ${cs.fontVariantNumeric}`,
    cell: { tag: cell.tagName.toLowerCase(), cls: String(cell.className || '').slice(0, 60), x: cr.left, w: cr.width, right: cr.right, padL: px(ccs.paddingLeft), padR: px(ccs.paddingRight), clips: clipper ? getComputedStyle(clipper).overflowX : null },
    needs,
    value: el.value,
    disabled: el.disabled,
    focused: document.activeElement === el,
  };
}

/** The same field, alone, 400px wide, on its own ground: the date's whole ink. */
function pgReference(i) {
  const el = document.querySelector(`[data-fx10="${i}"]`);
  const old = document.getElementById('fx10-ref');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'fx10-ref';
  // The ground the field sits on: its nearest painted ancestor's.
  let bg = 'rgba(0, 0, 0, 0)';
  for (let a = el.parentElement; a && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg); a = a.parentElement) bg = getComputedStyle(a).backgroundColor;
  Object.assign(wrap.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', padding: '8px', background: bg });
  const clone = el.cloneNode();
  clone.removeAttribute('data-fx10');
  clone.value = el.value;
  Object.assign(clone.style, { width: '400px', minWidth: '0', maxWidth: 'none', margin: '0' });
  wrap.appendChild(clone);
  document.body.appendChild(wrap);
  const r = clone.getBoundingClientRect();
  const cs = getComputedStyle(clone);
  return { x: r.left, y: r.top, w: r.width, h: r.height, bL: parseFloat(cs.borderLeftWidth) || 0, bR: parseFloat(cs.borderRightWidth) || 0, padR: parseFloat(cs.paddingRight) || 0 };
}
function pgReferenceOff() { const old = document.getElementById('fx10-ref'); if (old) old.remove(); return 1; }
/** Every other control sharing the field's row, and whether its text fits
    its room (review round 1, R1-09: the floor took a form's Bid days down to
    51px and only date fields were measured). The row: the field's table row,
    else its nearest grid of two or more columns or row-wise flex box with two
    or more children holding a control (an inline Field's label beside its
    control is not one). An empty number field gets "12.5" first, through its
    own input event; a number field's room leaves out the 15px its spinner
    keeps where one is drawn (Blink lays it out unseen at rest; Gecko draws
    it). A select's room is its content box, the kit's chevron padding
    already out of it. A control whose own words are drawn clear (another
    element shows them) is listed and not judged. */
async function pgNeighbours(i) {
  const { sleep: s } = window.__fx10;
  const el = document.querySelector(`[data-fx10="${i}"]`);
  if (!el) return { row: null, controls: [] };
  const CONTROL = 'input:not([type="date"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]):not([type="range"]):not([type="color"]):not([type="button"]):not([type="submit"]), select';
  const holds = (c) => c.matches('input, select, textarea') || !!c.querySelector('input, select, textarea');
  let row = el.closest('tr');
  for (let a = el.parentElement; !row && a && a !== document.body; a = a.parentElement) {
    const cs = getComputedStyle(a);
    const tracks = cs.gridTemplateColumns.split(/\s+/).filter((t) => /px$/.test(t)).length;
    const across = (cs.display.includes('grid') && tracks > 1) || (cs.display.includes('flex') && !cs.flexDirection.startsWith('column'));
    if (across && [...a.children].filter(holds).length > 1) row = a;
  }
  if (!row) return { row: null, controls: [] };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  let typed = 0;
  for (const n of row.querySelectorAll('input[type="number"]')) {
    if (!n.getClientRects().length || n.value !== '' || n.disabled || n.readOnly) continue;
    setter.call(n, '12.5');
    n.dispatchEvent(new Event('input', { bubbles: true }));
    n.dispatchEvent(new Event('change', { bubbles: true }));
    typed++;
  }
  if (typed) await s(300);
  const ctx = document.createElement('canvas').getContext('2d');
  const out = [];
  const clear = (c) => c === 'transparent' || /^rgba\([^)]*,\s*0\)$/.test(c || '');
  for (const n of row.querySelectorAll(CONTROL)) {
    if (!n.getClientRects().length) continue;
    const cs = getComputedStyle(n);
    const text = n.tagName === 'SELECT' ? ((n.options[n.selectedIndex] || {}).text || '') : (n.value || n.placeholder || '');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const textW = ctx.measureText(text).width;
    const r = n.getBoundingClientRect();
    const px = (v) => parseFloat(v) || 0;
    // A number field's spinner, where one is drawn: Gecko draws none under
    // `appearance: textfield`, Blink none once its inner spin button is put
    // away (FX1's NumberField does both).
    let spinner = 0;
    if (n.type === 'number') {
      if (/Firefox\//.test(navigator.userAgent)) spinner = cs.appearance === 'textfield' ? 0 : 15;
      else { const sb = getComputedStyle(n, '::-webkit-inner-spin-button'); spinner = sb.display === 'none' || sb.appearance === 'none' ? 0 : 15; }
    }
    const room = r.width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth) - spinner;
    // Words drawn clear are drawn by another element (the Shots table's
    // Framing cell shows its code over a select whose own words are clear):
    // reported, not judged.
    const hidden = clear(cs.webkitTextFillColor) || clear(cs.color);
    const field = n.closest('.ui-field');
    const label = n.getAttribute('aria-label') || (field && (field.querySelector('label, .ui-field-label') || {}).textContent) || n.name || n.tagName;
    out.push({ label: String(label).replace(/\s+/g, ' ').trim().slice(0, 30), tag: n.tagName.toLowerCase(), type: n.tagName === 'SELECT' ? 'select' : n.type, w: Math.round(r.width * 10) / 10, room: Math.round(room * 10) / 10, text: text.slice(0, 40), textW: Math.round(textW * 10) / 10, hidden, fits: hidden || textW <= room + 0.5 });
  }
  return { row: `${row.tagName.toLowerCase()}.${String(row.className || '').trim().split(/\s+/).slice(0, 3).join('.')}`, controls: out };
}
function pgFocus(i) { const el = document.querySelector(`[data-fx10="${i}"]`); el.focus(); return document.activeElement === el; }
function pgBlur() { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); return 1; }

// ── The engines ────────────────────────────────────────────────────────────

async function chromiumEngine(channel) {
  const browser = await chromium.launch(channel ? { channel } : {});
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  let page = null;
  let cdp = null;
  const run = (fn, arg) => page.evaluate(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
  return {
    name: channel || 'chromium',
    version: browser.version(),
    dpr: 2,
    async open(url) {
      if (page) await page.close();
      page = await context.newPage();
      page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
      await page.goto(url, { waitUntil: 'networkidle' });
      cdp = await context.newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
    },
    run,
    pointer: (x, y) => page.mouse.move(x, y),
    shot: (clip) => page.screenshot(clip ? { clip, scale: 'device' } : { scale: 'css' }),
    cdp: () => cdp,
    close: () => browser.close(),
  };
}

/**
 * The desktop app's own engine: the Electron binary of this checkout's
 * package.json (or --electron <path to electron.exe>), one hidden window on a
 * throwaway user-data folder, driven over the DevTools protocol.
 */
/** A port nothing listens on now (review round 1, R1-09: two runs on random
    ports could attach to each other's browser). */
const freePort = () => new Promise((res, rej) => {
  const srv = createServer();
  srv.once('error', rej);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
});

async function electronEngine() {
  const exe = flag('--electron') || join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe');
  const dir = mkdtempSync(join(tmpdir(), 'fx10-el-'));
  const port = await freePort();
  // The window opens on a page titled with this run's token: the browser the
  // DevTools port answers for is checked to be this run's before any use.
  const token = `fx10-${randomBytes(6).toString('hex')}`;
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx10-measure', main: 'main.cjs' }));
  writeFileSync(join(dir, 'main.cjs'), [
    "const { app, BrowserWindow } = require('electron');",
    `app.commandLine.appendSwitch('remote-debugging-port', '${port}');`,
    'app.whenReady().then(() => {',
    `  const w = new BrowserWindow({ width: ${W}, height: ${H}, show: false, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } });`,
    '  w.webContents.setFrameRate(30);',
    `  w.loadURL('data:text/html,<title>${token}</title>');`,
    '});',
    "app.on('window-all-closed', () => app.quit());",
  ].join('\n'));
  const el = spawn(exe, [dir, `--user-data-dir=${join(dir, 'user-data')}`]);
  el.stdout.on('data', () => {});
  el.stderr.on('data', () => {});
  const kill = async () => {
    try { el.kill(); } catch { /* gone */ }
    await sleep(1500);
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { console.error(`  the Electron folder was not removed: ${e.message}`); }
  };
  let browser = null;
  for (let i = 0; i < 100 && !browser; i++) {
    await sleep(200);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { /* not up yet */ }
  }
  if (!browser) { await kill(); throw new Error(`Electron did not open its DevTools port (${exe})`); }
  const context = browser.contexts()[0];
  let page = context.pages()[0];
  for (let i = 0; i < 50 && !page; i++) { await sleep(200); page = context.pages()[0]; }
  let title = '';
  for (let i = 0; i < 50 && title !== token; i++) { title = await page.title().catch(() => ''); if (title !== token) await sleep(100); }
  if (title !== token) { try { await browser.close(); } catch { /* not ours */ } await kill(); throw new Error(`the DevTools port ${port} answered for a browser that is not this run's`); }
  await page.setViewportSize({ width: W, height: H });
  const run = (fn, arg) => page.evaluate(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
  const version = await page.evaluate('navigator.userAgent.match(/Electron\\/[\\d.]+|Chrome\\/[\\d.]+/g).join(" ")');
  const engine = {
    name: 'electron',
    version,
    dpr: 1,
    cdpSession: null,
    async open(url) {
      await page.goto(url, { waitUntil: 'networkidle' });
      engine.dpr = await page.evaluate('devicePixelRatio');
      engine.cdpSession = await context.newCDPSession(page);
      await engine.cdpSession.send('DOM.enable');
      await engine.cdpSession.send('CSS.enable');
    },
    run,
    pointer: (x, y) => page.mouse.move(x, y),
    shot: (clip) => page.screenshot(clip ? { clip, scale: 'device' } : { scale: 'css' }),
    cdp: () => engine.cdpSession,
    async close() {
      try { await browser.close(); } catch { /* gone */ }
      await kill();
    },
  };
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  return engine;
}

async function firefoxEngine() {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'fx10-ff-'));
  // No crash reporter: a headless Firefox stopped from here must not leave a
  // reporter window on the desktop.
  const ff = spawn('C:/Program Files/Mozilla Firefox/firefox.exe', ['-headless', '-no-remote', '-profile', profile, '--remote-debugging-port', String(port)],
    { env: { ...process.env, MOZ_CRASHREPORTER_DISABLE: '1' } });
  let ready = false;
  ff.stderr.on('data', (d) => { if (String(d).includes('BiDi listening')) ready = true; });
  ff.stdout.on('data', () => {});
  const kill = async () => {
    try { ff.kill(); } catch { /* gone */ }
    await sleep(1500);
    try { rmSync(profile, { recursive: true, force: true }); } catch (e) { console.error(`  the Firefox profile was not removed: ${e.message}`); }
  };
  for (let i = 0; i < 150 && !ready; i++) await sleep(200);
  if (!ready) { await kill(); throw new Error('Firefox did not start its WebDriver BiDi listener'); }
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('BiDi websocket')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.type === 'error') p.rej(new Error(`${msg.error}: ${msg.message}`)); else p.res(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  let session; let context;
  try {
    session = await send('session.new', { capabilities: {} });
    // The session is this run's Firefox: its profile is the one made here.
    const prof = session.capabilities['moz:profile'];
    const norm = (p) => p.split('\\').join('/').toLowerCase();
    if (prof && norm(prof) !== norm(profile)) throw new Error(`the BiDi port ${port} answered for a Firefox that is not this run's (${prof})`);
    context = (await send('browsingContext.create', { type: 'tab' })).context;
    await send('browsingContext.setViewport', { context, viewport: { width: W, height: H }, devicePixelRatio: 2 });
  } catch (e) { try { ws.close(); } catch { /* closed */ } await kill(); throw e; }
  const run = async (fn, arg) => {
    const r = await send('script.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`, target: { context }, awaitPromise: true, resultOwnership: 'none' });
    if (r.type === 'exception') throw new Error(`page: ${r.exceptionDetails.text}`);
    return deserialize(r.result);
  };
  return {
    name: 'firefox',
    version: session.capabilities.browserVersion,
    dpr: 2,
    async open(url) {
      await send('browsingContext.navigate', { context, url, wait: 'complete' });
      await sleep(1500);
    },
    run,
    pointer: (x, y) => send('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y), duration: 0 }] }] }),
    shot: async (clip) => Buffer.from((await send('browsingContext.captureScreenshot', clip ? { context, clip: { type: 'box', ...clip } } : { context })).data, 'base64'),
    cdp: () => null,
    async close() {
      try { await send('browser.close', {}); } catch { /* going */ }
      try { ws.close(); } catch { /* closed */ }
      await kill();
    },
  };
}
/** A BiDi remote value back into a plain value. */
function deserialize(v) {
  if (v == null) return v;
  switch (v.type) {
    case 'undefined': case 'null': return null;
    case 'string': case 'boolean': return v.value;
    case 'number': return typeof v.value === 'number' ? v.value : Number(v.value);
    case 'array': return (v.value || []).map(deserialize);
    case 'object': return Object.fromEntries((v.value || []).map(([k, x]) => [typeof k === 'string' ? k : deserialize(k), deserialize(x)]));
    default: return v.value ?? null;
  }
}

// ── Chromium: the field's own parts, through the DevTools protocol ─────────
const attr = (node, k) => { const a = node.attributes || []; for (let i = 0; i < a.length; i += 2) if (a[i] === k) return a[i + 1]; return undefined; };
const kids = (node) => [...(node.shadowRoots || []), ...(node.children || []), ...(node.contentDocument ? [node.contentDocument] : [])];
async function nativeParts(cdp, i) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let input = null;
  const walk = (node) => { if (!input && node.nodeName === 'INPUT' && attr(node, 'data-fx10') === String(i)) input = node; for (const c of kids(node)) walk(c); };
  walk(root);
  if (!input) return null;
  const ua = (input.shadowRoots || []).find((s) => s.shadowRootType === 'user-agent');
  const parts = {};
  const walk2 = (node) => { const p = attr(node, 'pseudo'); if (p && !parts[p]) parts[p] = node; for (const c of node.children || []) walk2(c); };
  if (ua) walk2(ua);
  const content = async (node) => {
    if (!node) return null;
    try {
      const { model } = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId });
      const q = model.content;
      return { left: Math.min(q[0], q[6]), right: Math.max(q[2], q[4]) };
    } catch { return null; }
  };
  const textOf = (node) => { let t = ''; const w = (n) => { if (n.nodeType === 3) t += n.nodeValue; for (const c of n.children || []) w(c); }; if (node) w(node); return t; };
  const edit = await content(parts['-webkit-datetime-edit']);
  const wrapper = await content(parts['-webkit-datetime-edit-fields-wrapper']);
  const year = await content(parts['-webkit-datetime-edit-year-field']);
  const icon = await content(parts['-webkit-calendar-picker-indicator']);
  const out = { text: textOf(parts['-webkit-datetime-edit-fields-wrapper']) };
  if (edit && wrapper) {
    out.dateW = r1(wrapper.right - wrapper.left);
    out.editW = r1(edit.right - edit.left);
    out.hidden = r1(Math.max(0, wrapper.right - edit.right));
  }
  out.icon = icon ? { x: r1(icon.left), w: r1(icon.right - icon.left) } : null;
  if (icon && year && edit) out.gap = r1(icon.left - Math.min(year.right, edit.right));
  return out;
}

// ── Both engines: the field as drawn, scanned for ink ──────────────────────
function decodePng(buf) {
  let pos = 8; let width = 0; let height = 0; let depth = 0; let type = 0; let lace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; lace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || lace !== 0 || (type !== 2 && type !== 6)) throw new Error(`png: depth ${depth}, colour type ${type}, interlace ${lace} not read`);
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rgb = Buffer.alloc(width * height * 3);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = cur[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      rgb[(y * width + x) * 3] = cur[x * bpp];
      rgb[(y * width + x) * 3 + 1] = cur[x * bpp + 1];
      rgb[(y * width + x) * 3 + 2] = cur[x * bpp + 2];
    }
    prev = cur;
  }
  return { width, height, rgb };
}
/**
 * The ink of a field's picture: the columns holding anything that differs
 * from the field's ground by more than a quiet edge does. Returns, in CSS px
 * from the field's left edge, the date's ink (its first to its last column
 * before `iconFrom`) and the icon's (the ink from `iconFrom` on), and the gap
 * between them. `iconFrom` is where the icon's own box starts (Chromium: the
 * indicator's, read through the DevTools protocol; Firefox: 18px inside the
 * content box's right edge, where Gecko draws its button), or null when no
 * icon is drawn.
 */
function scanInk(png, dpr, box, iconFrom, margin = 0) {
  const { width, height, rgb } = png;
  const lum = (x, y) => { const i = (y * width + x) * 3; return 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2]; };
  const hist = new Map();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const l = Math.round(lum(x, y) / 4); hist.set(l, (hist.get(l) || 0) + 1); }
  let bg = 0; let best = -1;
  for (const [l, n] of hist) if (n > best) { best = n; bg = l * 4; }
  const x0 = Math.ceil(Math.max(box.bL + 1, margin) * dpr);
  const x1 = width - Math.ceil(Math.max(box.bR + 1, margin) * dpr);
  const y0 = Math.ceil(3 * dpr);
  const y1 = height - Math.ceil(3 * dpr);
  const ink = [];
  for (let x = x0; x < x1; x++) {
    let hit = false;
    for (let y = y0; y < y1 && !hit; y++) if (Math.abs(lum(x, y) - bg) > 56) hit = true;
    ink.push(hit);
  }
  const runs = [];
  let start = -1;
  for (let i = 0; i <= ink.length; i++) {
    if (i < ink.length && ink[i]) { if (start < 0) start = i; }
    else if (start >= 0) { runs.push([(start + x0) / dpr, (i + x0) / dpr]); start = -1; }
  }
  if (!runs.length) return { runs: 0 };
  const text = iconFrom == null ? runs : runs.filter((r) => r[1] <= iconFrom + 0.5);
  const icon = iconFrom == null ? [] : runs.filter((r) => r[1] > iconFrom + 0.5);
  if (!text.length) return { runs: runs.length, textW: 0, iconL: icon.length ? r1(icon[0][0]) : null };
  const textL = text[0][0];
  const textR = text[text.length - 1][1];
  const iconL = icon.length ? icon[0][0] : null;
  return {
    runs: runs.length,
    textL: r1(textL),
    textR: r1(textR),
    textW: r1(textR - textL),
    iconL: r1(iconL),
    iconR: icon.length ? r1(icon[icon.length - 1][1]) : null,
    gap: iconL == null ? null : r1(iconL - textR),
  };
}

// ── The walk ───────────────────────────────────────────────────────────────
const engine = ENGINE === 'firefox' ? await firefoxEngine()
  : ENGINE === 'electron' ? await electronEngine()
  : await chromiumEngine(ENGINE === 'chromium' ? null : ENGINE);
console.log(`${engine.name} ${engine.version} · ${W}x${H} · phase ${PHASE}`);
const results = { engine: engine.name, version: engine.version, size: `${W}x${H}`, phase: PHASE, parts: {} };
try {
  for (const PART of WANT) {
    const spec = PARTS[PART];
    await engine.open(`http://localhost:${PORT}${spec.path || '/rabbit'}${spec.query || ''}`);
    const fixtures = await engine.run(pgHelpers);
    if (!fixtures) throw new Error('the page shows no dev-fixtures badge: refusing to write to whatever this server is backed by');
    let failed = null;
    for (const step of spec.steps) {
      failed = await engine.run(pgStep, step);
      if (failed) break;
    }
    if (failed) {
      console.log(`\n=== ${PART}: NOT REACHED (${failed})`);
      writeFileSync(join(OUT, `debug-${engine.name}-${PART}-${W}x${H}.png`), await engine.shot());
      results.parts[PART] = { error: failed };
      continue;
    }
    const part = { configs: [] };
    for (let c = 0; c < spec.values.length; c++) {
      const set = spec.values[c];
      const got = await engine.run(pgFields, { sel: spec.fields, take: spec.take, set, within: spec.within || null });
      if (got.error) { console.log(`\n=== ${PART}: ${got.error}`); part.error = got.error; break; }
      const config = { set, fields: got.fields, states: {} };
      console.log(`\n=== ${PART} [${set.map((v) => v || 'empty').join(', ')}] ${engine.name} ${W}x${H}`);
      // References: each field's value drawn alone at 400px.
      const refs = {};
      for (const f of got.fields) {
        const rb = await engine.run(pgReference, f.i);
        await sleep(120);
        const png = decodePng(await engine.shot({ x: rb.x, y: rb.y, width: rb.w, height: rb.h }));
        refs[f.i] = scanInk(png, engine.dpr, rb, rb.w - rb.padR - rb.bR - 18);
        await engine.run(pgReferenceOff);
      }
      for (const state of spec.keepFocus ? ['focus'] : ['rest', 'hover', 'focus']) {
        if (!spec.keepFocus) await engine.run(pgBlur);
        await engine.pointer(W - 70, 12);
        await sleep(150);
        const rows = [];
        for (const f of got.fields) {
          let box = await engine.run(pgBox, f.i);
          if (!box) { rows.push({ i: f.i, error: 'gone' }); continue; }
          if (state === 'hover') { await engine.pointer(box.x + box.w / 2, box.y + box.h / 2); await sleep(200); }
          if (state === 'focus') { await engine.run(pgFocus, f.i); await sleep(200); }
          box = await engine.run(pgBox, f.i);
          const png = decodePng(await engine.shot({ x: box.x, y: box.y, width: box.w, height: box.h }));
          const parts = engine.cdp() ? await nativeParts(engine.cdp(), f.i) : null;
          // Where the icon's box starts: Chromium's indicator, or Gecko's button.
          // Gecko draws no button on a disabled field.
          const iconFrom = parts ? (parts.icon ? parts.icon.x - box.x - 1 : null) : box.disabled ? null : box.w - box.padR - box.bR - 18;
          // Focused: the outer 3px a side left out (an inset ring is drawn
          // there), and the gap only — the engine paints the focused part of
          // the date (its month) on a highlight, so the ink is not the
          // reference's; Chromium's parts and Firefox's `short` say the cut.
          const scan = scanInk(png, engine.dpr, box, iconFrom, state === 'focus' ? 3 : 0);
          const ref = refs[f.i];
          const cut = state !== 'focus' && scan && ref && ref.textW != null && scan.textW != null ? r1(Math.max(0, ref.textW - scan.textW)) : null;
          rows.push({
            i: f.i, label: f.label, cls: f.cls, value: box.value || '(empty)',
            field: r1(box.w), cell: r1(box.cell.w), cellTag: box.cell.tag, cellCls: box.cell.cls,
            overCell: r1(Math.max(0, box.right - box.cell.right, box.cell.x - box.x)),
            needs: r1(box.needs), short: r1(Math.max(0, box.needs - box.w)),
            pad: `${box.padL}/${box.padR}`, border: `${box.bL}/${box.bR}`, font: box.font, disabled: box.disabled,
            chromium: parts, scan, refTextW: ref ? ref.textW : null, cutInk: cut,
          });
          if (state === 'focus' && !spec.keepFocus) await engine.run(pgBlur);
          if (state !== 'rest') { await engine.pointer(W - 70, 12); await sleep(120); }
        }
        config.states[state] = rows;
        for (const r of rows) {
          if (r.error) { console.log(`  ${state} #${r.i}: ${r.error}`); continue; }
          const cp = r.chromium;
          const native = cp ? ` | date ${cp.dateW} in ${cp.editW}, hidden ${cp.hidden}, icon ${cp.icon ? `${cp.icon.w}@${cp.icon.x}` : 'none'}, gap ${cp.gap ?? '—'}` : '';
          const ink = r.scan ? ` | ink ${r.scan.textW}/${r.refTextW} (cut ${r.cutInk}), icon ${r.scan.iconL ?? '—'}, gap ${r.scan.gap ?? '—'}` : '';
          console.log(`  ${state.padEnd(5)} ${String(r.label).padEnd(26)} ${r.value.padEnd(10)} field ${r.field} cell ${r.cell} (${r.cellTag}) needs ${r.needs} short ${r.short} over ${r.overCell}${native}${ink}`);
        }
        // The close-up: every measured field, as this state draws them.
        if (SHOTS) {
          const boxes = [];
          for (const f of got.fields) boxes.push(await engine.run(pgBox, f.i));
          if (state === 'hover' && boxes[0]) { await engine.pointer(boxes[0].x + boxes[0].w / 2, boxes[0].y + boxes[0].h / 2); await sleep(200); }
          if (state === 'focus' && boxes[0]) { await engine.run(pgFocus, 0); await sleep(200); }
          const ok = boxes.filter(Boolean);
          const x = Math.max(0, Math.min(...ok.map((b) => Math.min(b.x, b.cell.x))) - 24);
          const y = Math.max(0, Math.min(...ok.map((b) => b.y)) - 16);
          const right = Math.min(W, Math.max(...ok.map((b) => Math.max(b.right, b.cell.right))) + 24);
          const bottom = Math.min(H, Math.max(...ok.map((b) => b.y + b.h)) + 16);
          const file = `po-fx10-${PHASE}-${engine.name}-${PART}-c${c + 1}-${state}-${W}x${H}.png`;
          writeFileSync(join(OUT, file), await engine.shot({ x, y, width: right - x, height: bottom - y }));
          if (FULL && engine.name === 'chromium' && state !== 'focus') writeFileSync(join(OUT, `po-fx10-${PHASE}-${engine.name}-${PART}-c${c + 1}-${state}-full-${W}x${H}.png`), await engine.shot());
          if (!spec.keepFocus) await engine.run(pgBlur);
          await engine.pointer(W - 70, 12);
        }
      }
      // The controls sharing each field's row, after its states (R1-09).
      config.neighbours = {};
      for (const f of got.fields) {
        const nb = await engine.run(pgNeighbours, f.i);
        config.neighbours[f.i] = nb;
        const tight = nb.controls.filter((n) => !n.fits);
        const least = nb.controls.filter((n) => !n.hidden).reduce((m, n) => (m && m.room - m.textW <= n.room - n.textW ? m : n), null);
        console.log(`  row of #${f.i} (${nb.row || 'none'}): ${nb.controls.length} other control${nb.controls.length === 1 ? '' : 's'}`
          + (least ? `, least spare ${r1(least.room - least.textW)} (${least.label}: "${least.text}" ${least.textW} in ${least.room} of ${least.w})` : '')
          + (tight.length ? ` — ${tight.length} NOT FITTING: ${tight.map((n) => `${n.label} "${n.text}" ${n.textW} in ${n.room}`).join('; ')}` : ''));
      }
      part.configs.push(config);
    }
    results.parts[PART] = part;
  }
} finally {
  await engine.close();
}
const file = join(OUT, `po-fx10-${PHASE}-${engine.name}-measure-${W}x${H}.json`);
writeFileSync(file, JSON.stringify(results, null, 2));
console.log(`\nwrote ${file}`);
