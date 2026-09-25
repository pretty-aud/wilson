#!/usr/bin/env node
/**
 * UI overhaul — V1's walk of every page AND the sub-views a URL cannot reach.
 *
 *   node scripts/ui-walk.mjs <port> [W] [H] [--only a,b] [--shots <dir>] [--json <file>] [--fast] [-v]
 *
 * Plan §5 Wave 4, V1: "walk every page and sub-view with the new designs at
 * 1440x900 and 1280x700, check the chosen face at every step, the alignment
 * of every table and toolbar, the two page classes".
 *
 * `ui-page-check.mjs` walks twelve URLs and, with --tabs, R.A.B.B.I.T.'s nine
 * tabs. T1 and T2 each found the hard way that URLs are not screens. This
 * registry adds Settings' tabs, the Admin Terminal's sections, Budget's
 * views, O.T.T.E.R.'s tools and lesson, Help's sections, the shell's nav and
 * quit dialog, and 18 of the app's roughly sixty dialogs — 77 screens.
 * NOT walked, and named so nobody reads "every screen": the other ~40
 * dialogs, R.A.B.B.I.T.'s Levels and Experiences tabs (hidden for this
 * project type), Timeline's TaskEditor, and anything behind a real session.
 *
 * Every entry names the step that opens it AND a proof that it opened, and a
 * proof must go from FALSE to TRUE across its last step — V1's review round
 * one found four text proofs that were already true on the page underneath
 * (the shell's nav, the dev badge, a scene title visible before its dialog)
 * and one entry (`help-otter`) that clicked the SHELL's "O.T.T.E.R." and
 * measured the tool page. Nothing inside `.wilson-chrome` or the dev badge
 * can satisfy a proof now, and the click prefers the page to the shell.
 *
 * Per screen, through `ui-measure.mjs` (one implementation, shared with the
 * page check):
 *   err / ovf / off / clip   — ui-page-check's census, verbatim
 *   face    text Chrome actually DREW in a face that is not Geist or Geist
 *           Mono (the DevTools protocol's platform-font report — not CSS);
 *           a text node the protocol could not answer for FAILS the screen
 *   wt / up / trk            — §3.1: weight off 400/600, capitals off the
 *           Label step, tracking off +0.06em (Label) / +0.01em (H1) / 0
 *   anon    visible buttons with no text, aria-label, title or labelledby
 *   ground  which page class the field is on (Q1)
 *   dlg     the open dialog's surface, radius, title, whether every edge is
 *           on screen, and which parts of it scroll (a capped panel "fits"
 *           because its body scrolls — that is not the same thing)
 *   align   header-vs-column alignment in real tables; toolbar centre lines
 *   b2 / rad / white / cr / brk / caps   stop point 1's other claims — one
 *           border, two radii, no white — plus contrast, tokens broken across
 *           lines and capitals typed into the text. REPORTED, NOT FAILED:
 *           lanes A and B have not run, and most of it is their planned
 *           colour work. De-duplicated at the end; saved whole by --json.
 *
 * It exits 1 on anything new. Findings V1 FILED rather than fixed are in
 * KNOWN below, keyed on screen AND element (and, for unnamed controls, on the
 * exact icon and a COUNT), so a new defect of a known kind still fails.
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
import {
  pageCensus, typeCensus, renderedFaces, typeRules, pageGround, openDialog, tableAlignment, toolbarAlignment,
  unnamedControls, selectedControl, styledActive, stopPointCensus, bodyTextCount, formFields, nestedButtons,
} from './ui-measure.mjs';

/* An orange ground, by hue: the signal, signal-fill and Tailwind's orange
   400-700 all qualify; the light page ground #f4a261 and #dd9155 too. */
const isOrange = (h) => { const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); return r > 180 && g > 50 && g < 175 && b < 110 && r - b > 100; };

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const positional = args.filter((a, i) => !a.startsWith('-') && !['--only', '--shots', '--json'].includes(args[i - 1]));
const PORT = positional[0] || '5245';
const W = Number(positional[1] || 1280);
const H = Number(positional[2] || 700);
const BASE = `http://localhost:${PORT}`;
const ONLY = flag('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
const SHOTS = flag('--shots');
const JSON_OUT = flag('--json');
const VERBOSE = args.includes('-v');
/* --fast skips the rendered-face query, the one slow measurement. Use it for
   a census rerun; never for a claim about the face — and the closing line
   says so rather than printing "every glyph in Geist" over a run that never
   asked (round one). */
const FAST = args.includes('--fast');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────────── the registry ──────────────────────────────
   step strings:  a visible control's text, aria-label or title (exact first,
                  then prefix; the page before the shell); '@proj' opens the
                  Salt Hours fixture project; '@files' picks the first project
                  on Files; '@row:<text>' clicks a visible table row; '@lesson'
                  opens a lesson; '@quit' fires the Electron close request.
   expect:        { dialog: true } | { text } | { selector } | { expanded }
                  | { expandedText } — a page button whose text starts with it
                    has aria-expanded="true" (Help's sections)
                  | { active } — the named tab is now SELECTED (aria-selected,
                    data-active, aria-current or aria-pressed; exact label)
                  | { styled } — the named button is the one sibling styled
                    differently, for tab bars with NO selection state (Budget)
                  A tab's label is visible whichever tab is showing, so a text
                  proof cannot tell tabs apart. `active` and `styled` may be
                  true before their step (a default tab); every other proof
                  must be FALSE before the last step and TRUE after it.       */
const P = (key, path, extra = {}) => ({ key, path, steps: [], ...extra });
const REGISTRY = [
  // The twelve URLs, as ui-page-check walks them. Proofs are page text, never
  // the shell's (excluded) — "R.A.B.B.I.T." here is Home's own button.
  P('home', '/', { homeCaps: true, expect: { text: 'R.A.B.B.I.T.' } }),
  P('dog', '/dog', { expect: { text: 'Generate page outline' } }),   // A1: sentence case (Q2)
  P('otter', '/otter', { expect: { text: 'New course' } }),   // A3: sentence case (Q2)
  P('rabbit', '/rabbit', { expect: { text: 'Salt Hours' } }),
  P('settings', '/settings', { expect: { text: 'Version and updates' } }),
  P('projects', '/project-manager', { expect: { text: 'Salt Hours' } }),
  P('rate-card', '/rate-card', { expect: { text: 'Add a role' } }),
  P('team-members', '/team-members', { expect: { text: 'Invite user' } }),
  P('files', '/project-files', { expect: { text: 'No project chosen' } }),
  P('dashboard', '/dashboard', { expect: { text: 'Café location agreement' } }),
  P('admin-terminal', '/admin-terminal', { expect: { text: 'Add people' } }),
  P('help', '/help', { expect: { text: 'Basic Workflow' } }),

  // The shell.
  P('shell-nav', '/dog', { steps: ['Navigation'], expect: { expanded: 'Navigation' } }),
  P('shell-quit', '/', { steps: ['@quit'], stub: true, homeCaps: true, expect: { text: 'Close WILSON' } }),

  // D.O.G.
  P('dog-history', '/dog', { steps: ['Import/export history'], expect: { dialog: true } }),
  P('dog-settings', '/dog', { steps: ['Tool settings'], expect: { dialog: 'System prompts' } }),

  // O.T.T.E.R. — the reading surface and the views behind the tool's own bar.
  P('otter-lesson', '/otter', { steps: ['@lesson'], expect: { selector: '.lesson-content' } }),
  // A3 (2026-09-24): the course page (Sidebar 1 expanded, the subject cards)
  // and the Sources view off the lesson sidebar. Functions is NOT here: the
  // fixture course is software, and the Functions view needs a
  // coding-language course, so on fixtures its button lands on Hotkeys.
  // The course page's OWN element: a subject's title also appears in Sidebar 1
  // the moment the course opens there, so a text proof proved the sidebar.
  P('otter-course', '/otter', { steps: ['DaVinci Resolve 19'], expect: { selector: '.otter-subject-card' } }),
  P('otter-sources', '/otter', { steps: ['@lesson', 'Sources'], expect: { text: 'Works cited' } }),
  P('otter-settings', '/otter', { steps: ['Tool settings'], expect: { dialog: 'System prompts' } }),   // A4: the Drawer's tab, sentence case (Q2)
  P('otter-search', '/otter', { steps: ['Search'], expect: { dialog: true } }),
  P('otter-quiz', '/otter', { steps: ['Quiz'], expect: { text: 'Quiz Center' } }),
  P('otter-hotkeys', '/otter', { steps: ['Hotkeys'], expect: { text: 'Keyboard shortcuts' } }),   // A3: sentence case (Q2)
  P('otter-nodes', '/otter', { steps: ['Nodes'], expect: { text: 'Nodes reference' } }),   // A3: sentence case (Q2)
  P('otter-admin', '/otter', { steps: ['Admin'], expect: { text: 'For your review' } }),
  P('otter-validate', '/otter', { steps: ['Validate'], expect: { text: 'Lesson validator' } }),   // A4: sentence case (Q2)
  P('otter-new-course', '/otter', { steps: ['New course'], expect: { text: 'New software course' } }),   // A3: sentence case (Q2)
  P('otter-import', '/otter', { steps: ['Import'], expect: { dialog: 'Import data' } }),   // A4: sentence case (Q2)
  // A4: the overlays the walk lacked, each proven open by its own panel's
  // text (never text the page already showed). Openers only: nothing here
  // confirms, deletes, clears, shares or restores. Not walkable on the
  // fixtures, and measured by a driver instead (A4 hand-off §2): the
  // change-request dialog (the one course has no source course, so
  // "Suggest a change…" is not offered), the duplicate dialog (nothing sets
  // its state), the quiz's question, results, code writing and leave
  // confirm (a quiz is generated by a model call). The clear confirm joined
  // when the settings lock became the kit's Switch, named "Editable".
  P('otter-help', '/otter', { steps: ['Tool settings', 'Help & documentation'], expect: { dialog: 'Getting Started' } }),
  P('otter-clear', '/otter', { steps: ['Tool settings', 'Tool settings', 'Editable', 'Clear all data'], expect: { dialog: 'ALL courses' } }),
  P('otter-delete', '/otter', { steps: ['Actions for DaVinci Resolve 19', 'Move to trash'], expect: { dialog: 'Recently deleted' } }),
  P('otter-delete-subject', '/otter', { steps: ['DaVinci Resolve 19', 'Delete subject'], expect: { dialog: 'permanently remove this subject' } }),
  P('otter-share', '/otter', { steps: ['Actions for DaVinci Resolve 19', 'Share or submit…'], expect: { dialog: true } }),
  P('otter-trash', '/otter', { steps: ['Recently deleted'], expect: { text: 'Nothing deleted' } }),

  // R.A.B.B.I.T. — the nine tabs with the project open, then what opens off them.
  ...['Intake', 'Summary', 'Team', 'Tasks', 'Timeline', 'Budget', 'Assets', 'Scenes', 'Bins'].map((t) =>
    P(`rabbit-${t.toLowerCase()}`, '/rabbit', { steps: ['@proj', t], expect: { active: t } })),
  P('rabbit-settings', '/rabbit', { steps: ['RABBIT settings'], expect: { text: 'Holidays / Blocked Days' } }),
  P('rabbit-help', '/rabbit', { steps: ['Help & documentation'], expect: { text: 'Key Features' } }),
  P('rabbit-control-panel', '/rabbit', { steps: ['@proj', 'Summary', 'Control Panel'], expect: { text: 'Budget variables' } }),
  P('rabbit-task-new', '/rabbit', { steps: ['@proj', 'Tasks', 'New task'], expect: { dialog: true } }),
  P('rabbit-task-detail', '/rabbit', { steps: ['@proj', 'Tasks', 'View task details'], expect: { dialog: 'Lock the shooting script' } }),
  P('rabbit-task-history', '/rabbit', { steps: ['@proj', 'Tasks', 'View edit history'], expect: { text: 'Edit history' } }),
  // B2: the rest of the Tasks view the walk could not see — the board, and
  // the two small dialogs off its toolbar (Phase creates nothing until its
  // own Create; Save view writes nothing until its own Save).
  // The board itself, not which tab is styled: with two tabs, "the one
  // styled differently" is true of both before any click (B2 round one).
  P('rabbit-tasks-board', '/rabbit', { steps: ['@proj', 'Tasks', 'Board'], expect: { selector: '.rb-task-board' } }),
  P('rabbit-task-phase', '/rabbit', { steps: ['@proj', 'Tasks', 'Phase'], expect: { dialog: true } }),
  P('rabbit-task-save-view', '/rabbit', { steps: ['@proj', 'Tasks', 'Views', 'Save current view'], expect: { dialog: true } }),
  ...['By Phase', 'By Role', 'By Asset', 'By Scene', 'By Shot', 'Custom', 'Crew/Team', 'Talent', 'Expenses', 'Client View'].map((t) =>
    P(`rabbit-budget-${t.toLowerCase().replace(/[^a-z]+/g, '-')}`, '/rabbit', { steps: ['@proj', 'Budget', t], expect: { styled: t } })),
  P('rabbit-asset-new', '/rabbit', { steps: ['@proj', 'Assets', 'New asset'], expect: { dialog: true } }),
  P('rabbit-asset-detail', '/rabbit', { steps: ['@proj', 'Assets', 'View asset details'], expect: { dialog: true } }),
  // "Lighthouse, dawn" is on the Scenes table before the dialog opens.
  P('rabbit-scene-detail', '/rabbit', { steps: ['@proj', 'Scenes', 'View details'], expect: { dialog: 'Lighthouse, dawn' } }),

  // Settings' seven tabs (General is the page itself) and its one dialog.
  ...['Profile', 'Models', 'Storage', 'Teams', 'Agent', 'Agent Skills'].map((t) =>
    P(`settings-${t.toLowerCase().replace(/\s+/g, '-')}`, '/settings', { steps: [t], expect: { active: t } })),
  P('settings-reset-dialog', '/settings', { steps: ['Reset history'], expect: { dialog: 'Reset pet history' } }),
  // B2: the task template manager (Settings' "Storage" tab is the old
  // R.A.B.B.I.T. tab; the Timeline's settings panel opens the same component).
  P('settings-task-templates', '/settings', { steps: ['Storage', 'Manage task templates'], expect: { dialog: true } }),

  // The resource pages' sub-views.
  P('projects-detail', '/project-manager', { steps: ['@row:Salt Hours'], expect: { text: 'Project details' } }),
  P('rate-card-gsheet', '/rate-card', { steps: ['Google Sheet'], expect: { dialog: 'Import a Google Sheet' } }),
  P('team-invite', '/team-members', { steps: ['Invite user'], expect: { dialog: 'Invite a workspace member' } }),
  P('team-rate', '/team-members', { steps: ['Edit rate card entry'], expect: { dialog: 'Edit rate' } }),
  // Files opens in its Columns (Finder) view; the table exists only after "Table".
  P('files-project', '/project-files', { steps: ['@files', 'Table'], expect: { selector: 'table tbody tr' } }),
  P('dashboard-profile', '/dashboard', { steps: ['Profile'], expect: { active: 'Profile' } }),
  P('dashboard-notes', '/dashboard', { steps: ['Notes'], expect: { active: 'Notes' } }),
  // B2: TaskDetailPopup's second home — every Dashboard row click opens it.
  P('dashboard-task-detail', '/dashboard', { steps: ['@row:Café location agreement'], expect: { dialog: 'Café location agreement' } }),
  ...['Company', 'Models', 'Storage', 'Requests', 'Logs', 'Diagnostics'].map((t) =>
    P(`admin-${t.toLowerCase()}`, '/admin-terminal', { steps: [t], expect: { active: t } })),
  ...['O.T.T.E.R.', 'Project Manager', 'Wilson'].map((t) =>
    P(`help-${t.toLowerCase().replace(/[^a-z]+/g, '')}`, '/help', { steps: [t], expect: { expandedText: t } })),
];

/* ─────────────────────────── known, filed findings ─────────────────────────
   Each entry is a finding V1 FILED rather than fixed, keyed on the screen
   AND on what it is — never on the screen alone, so a new defect of a known
   kind on a known screen still fails. The ids are the filings in
   docs/sessions/handoffs/ui-v1-2026-09-23.md §4, generated from both walks'
   --json at 1280x700 and 1440x900, not typed. When a lane fixes one, delete
   its line: a stale entry is a claim, and a stale claim misleads.

   Empty on purpose: weight, upper, tracking, dialogFit. V1 fixed every one
   of those it found, so any one of them is new. */
const KNOWN = {
  /* V1-01 — glyphs fontsource's Latin subset of Geist does not ship, drawn
     by Windows in Segoe UI instead. Matched on the element's own text. */
  face: [
    { key: 'otter-lesson', text: 'Project Settings → M' },
    { key: 'otter-lesson', text: 'The is fixed the mom' },
    { key: 'otter-new-course', text: '○ Add subject' },
    { key: 'otter-new-course', text: '○ Share with the com' },
    { key: 'otter-new-course', text: '● Just for me' },
    { key: 'otter-new-course', text: '● New course' },
    // A4: the share dialog's tier cards draw the prompt form's ●/○ — the same
    // glyphs, the same open question (A3 §6 question 11), walked from A4 on.
    { key: 'otter-share', text: '○Just for me' },
    { key: 'otter-share', text: '○Share with the company' },
    { key: 'otter-share', text: '●Company standard' },
  ],
  weight: [],
  upper: [],
  tracking: [],
  dialogFit: [],
  /* V1-02 — C6: text on an orange ground under its threshold. Keyed on the
     screen and the element's own quoted text, generated from both walks.
     (O.T.T.E.R.'s "+ New", "All" and its count repeated on every one of its
     views until A3 took the fills away, 2026-09-24. D.O.G.'s step badges
     "1" / "2" were here on every D.O.G. screen;
     A1 took the fill away and deleted the lines, 2026-09-23; History
     import/export's "Export" mode went with A2's kit Tabs.) The fix
     is the rule, not the ink (§3.2, Q16): a filled PRIMARY takes
     signal-fill with white, a selected TAB or CHIP loses the fill. */
  c6: [
    // A3 (2026-09-24) deleted the O.T.T.E.R. rows it fixed: the course filter
    // chip and its count, New, New course, Next and the skill level all left
    // the orange fill. The Validator's own button is A4's and stays.
    { key: 'rabbit-asset-detail', text: '"Add files"' },
    { key: 'rabbit-asset-detail', text: '"Done"' },
    { key: 'rabbit-asset-detail', text: '"New asset"' },
    { key: 'rabbit-asset-detail', text: '"Table"' },
    { key: 'rabbit-asset-new', text: '"New asset"' },
    { key: 'rabbit-asset-new', text: '"Table"' },
    { key: 'rabbit-assets', text: '"New asset"' },
    { key: 'rabbit-assets', text: '"Table"' },
    { key: 'rabbit-scene-detail', text: '"Add files"' },
    { key: 'rabbit-scene-detail', text: '"Scene"' },
    { key: 'rabbit-scene-detail', text: '"Scenes"' },
    { key: 'rabbit-scene-detail', text: '"Table"' },
    { key: 'rabbit-scenes', text: '"Scene"' },
    { key: 'rabbit-scenes', text: '"Scenes"' },
    { key: 'rabbit-scenes', text: '"Table"' },
    { key: 'rabbit-task-detail', text: '"Add files"' },
    // rabbit-timeline's two ("Task", "Week") left with B3b: + Task is the kit
    // primary on signal-fill and the zoom is the kit Tabs' underline.
  ],
  /* V1-09 — buttons nested inside buttons, counted in the DOM per screen
     (React warns once per tag pair per page load, so its warning cannot
     count them). The larger count of the two window sizes. */
  nested: [
    { key: 'rabbit-asset-detail', n: 2 },
    { key: 'rabbit-scene-detail', n: 2 },
  ],
  errors: [
    /* Environment, not UI. The dev tester has NO session (App.jsx: "sign-in
       skipped, no session, no workspace"), so a section that fetches from
       the backend is refused; and the quit dialog's Electron stub makes
       `hasLocalServer()` true, so the app asks a local server that is not
       there. Neither can happen to a signed-in user in the desktop app. */
    { key: 'admin-logs', text: 'status of 401' },
    { key: 'admin-storage', text: 'status of 401' },
    { key: 'admin-requests', text: 'status of 401' },
    { key: 'shell-quit', text: 'status of 404' },
    /* V1-09 — a <button> nested inside a <button>. React's warning, with its
       %s placeholders filled from the console arguments so the ELEMENTS are
       part of what is excused, not just the kind of warning. B4 and B5. */
    { key: 'rabbit-asset-detail', text: 'In HTML, <button> cannot be a descendant of <button>' },
    { key: 'rabbit-asset-detail', text: '<button> cannot contain a nested <button>' },
    { key: 'rabbit-scene-detail', text: 'In HTML, <button> cannot be a descendant of <button>' },
  ],
  /* V1-05 — icon-only controls with no text, aria-label, title or
     labelledby (§3.3). Keyed on the EXACT icon class (`lucide-x` no longer
     excuses `lucide-x-circle`) with the COUNT seen, the larger of the two
     window sizes: one more of the same kind on the same screen fails. The
     dialog screens repeat the table underneath them, which is why their
     counts match the tab's. `no-icon` is a control with neither a name nor a
     lucide glyph. Owners: A1/A2 (dog*), A3/A4 (otter*), B1-B6 (rabbit*), P1
     (projects-detail — lane C is finished), and the Electron title bar's
     three window controls, seen only under the quit stub. `shell-nav` opens
     the strip over /dog, so its four were D.O.G.'s — A1 named them and
     deleted the lines (2026-09-23), as it did the page's share of the
     dog-history and dog-settings counts; A2 put History import/export on
     the kit's Dialog, Tabs and named checkboxes, and the Settings lock on
     the kit's Switch, and deleted the last four (2026-09-23). */
  anon: [
    { key: 'otter-quiz', text: 'lucide-chevron-down', n: 1 },
    { key: 'projects-detail', text: 'lucide-trash2', n: 30 },
    { key: 'rabbit-asset-detail', text: 'lucide-square', n: 16 },
    { key: 'rabbit-asset-detail', text: 'lucide-trash2', n: 15 },
    { key: 'rabbit-asset-detail', text: 'lucide-x', n: 1 },
    { key: 'rabbit-asset-new', text: 'lucide-square', n: 16 },
    { key: 'rabbit-asset-new', text: 'lucide-trash2', n: 15 },
    { key: 'rabbit-asset-new', text: 'lucide-x', n: 1 },
    { key: 'rabbit-assets', text: 'lucide-square', n: 16 },
    { key: 'rabbit-assets', text: 'lucide-trash2', n: 15 },
    { key: 'rabbit-budget', text: 'no-icon', n: 1 },
    { key: 'rabbit-control-panel', text: 'lucide-trash2', n: 32 },
    { key: 'rabbit-scene-detail', text: 'lucide-arrow-up-down', n: 1 },
    { key: 'rabbit-scene-detail', text: 'lucide-chevron-right', n: 6 },
    { key: 'rabbit-scene-detail', text: 'lucide-trash2', n: 3 },
    { key: 'rabbit-scene-detail', text: 'lucide-x', n: 1 },
    { key: 'rabbit-scenes', text: 'lucide-arrow-up-down', n: 1 },
    { key: 'rabbit-scenes', text: 'lucide-chevron-right', n: 6 },
    { key: 'rabbit-settings', text: 'lucide-check', n: 11 },
    { key: 'rabbit-settings', text: 'lucide-x', n: 1 },
    { key: 'rabbit-settings', text: 'no-icon', n: 27 },
    { key: 'shell-quit', text: 'no-icon', n: 3 },
  ],
};
/* `text` is REQUIRED: a key-only entry would excuse everything of its kind on
   the screen, which is the silent-green shape this lane keeps hitting. */
/* Which KNOWN entries matched something this run, so the close can name the
   ones that matched nothing on a screen it walked. A3 review round 1: 39 C6
   rows stayed filed for 25 commits after their defect was gone, and nothing
   said so. Reported, never failed. */
const MATCHED = new Set();
/* The highest count each ceiling entry (anon, nested) met this run: a ceiling
   above what its screen has lets that many NEW unnamed controls pass under it,
   so it is reported like a stale line (A3 review round 2: `n: 5` against 1
   on screen passed in silence). */
const CEILING_SEEN = new Map();
const seenAtMost = (k, n) => CEILING_SEEN.set(k, Math.max(CEILING_SEEN.get(k) ?? 0, n));
const isKnown = (kind, key, text) => KNOWN[kind].some((k) => {
  const hit = k.key === key && typeof k.text === 'string' && (text || '').includes(k.text);
  if (hit) MATCHED.add(k);
  return hit;
});
/* Unnamed controls, per icon: known only if the EXACT icon is listed for this
   screen and the count has not grown. Returns the ones that are new. */
function newAnon(key, anon) {
  const byIcon = {};
  for (const a of anon) (byIcon[a.split(' ')[0]] ||= []).push(a);
  return Object.entries(byIcon).flatMap(([icon, list]) => {
    const k = KNOWN.anon.find((x) => x.key === key && x.text === icon);
    if (k) { MATCHED.add(k); seenAtMost(k, list.length); }
    return k && list.length <= k.n ? [] : list;
  });
}

/* ───────────────────────────────── driving ───────────────────────────────── */
/* The PAGE before the shell: `help-otter` used to click the nav strip's
   "O.T.T.E.R." (an exact-text match) instead of Help's own entry (whose text
   carries a subtitle) and so measured the tool page. The shell is searched
   only on a step's LAST try — round two: falling back on the first try sent
   a not-yet-rendered "Team" tab to the shell's "Team members" and navigated
   away. `shell-nav`'s hamburger lives there, and gets there on try five. */
async function click(page, label, allowShell) {
  return page.evaluate(({ label, allowShell }) => {
    const vis = (e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0;
    const inShell = (e) => !!e.closest('.wilson-chrome, [data-testid="dev-fixtures-badge"]');
    const all = [...document.querySelectorAll('button, [role="button"], [role="tab"], a')].filter(vis);
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const named = (e) => [e.getAttribute('aria-label'), e.getAttribute('title')].filter(Boolean);
    const find = (els) => els.find((e) => norm(e.textContent) === label)
      || els.find((e) => named(e).some((n) => n === label))
      || els.find((e) => named(e).some((n) => n.startsWith(label)))
      || els.find((e) => norm(e.textContent).startsWith(label));
    const hit = find(all.filter((e) => !inShell(e))) || (allowShell ? find(all.filter(inShell)) : null);
    if (!hit) return false;
    hit.click();
    return true;
  }, { label, allowShell });
}

/* A step LOOKS for its target a few times before it gives up: the walk's
   second full run failed `rabbit-intake` because the project list had not
   rendered five seconds after load, `@proj` found no "Salt Hours" and
   returned false once — and a failed step correctly forbids the retry. */
async function step(page, s) {
  // Compound or one-shot steps are not repeated: a second '@lesson' would
  // click the course again and could collapse it.
  if (s === '@lesson' || s === '@quit') return stepOnce(page, s);
  for (let i = 0; i < 5; i++) {
    const ok = await stepOnce(page, s, i === 4);
    if (ok) return true;
    await sleep(800);
  }
  return false;
}

/* `@proj` succeeds when the project IS OPEN, not when a click was accepted
   (round two): a click the app's transition swallowed used to count as a
   step that drove. Evidence of an open project is the button only an open
   one shows — "Control Panel" on Summary, "Switch" on every other tab. So a
   try clicks when it must and reports success only on a later look. */
async function stepOnce(page, s, lastTry) {
  if (s === '@proj') return page.evaluate(() => {
    const vis = (b) => b.offsetParent !== null && !b.closest('.wilson-chrome, [data-testid="dev-fixtures-badge"]');
    const buttons = [...document.querySelectorAll('button')].filter(vis);
    if (buttons.some((b) => ['Control Panel', 'Switch'].includes((b.textContent || '').trim()))) return true;
    const x = buttons.find((b) => (b.textContent || '').includes('Salt Hours'));
    if (x) x.click();
    return false;
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
  return click(page, s, lastTry);
}

async function opened(page, expect) {
  if (!expect) return true;
  /* `dialog: true` proves A dialog; `dialog: '<text>'` proves THE dialog —
     its panel must say that text (round two). */
  if (expect.dialog) {
    const d = await page.evaluate(openDialog);
    return !!d && (expect.dialog === true || d.panelText.includes(expect.dialog));
  }
  if (expect.active) return page.evaluate(selectedControl, expect.active);
  if (expect.styled) return page.evaluate(styledActive, expect.styled);
  return page.evaluate((e) => {
    const inShell = (el) => !!el.closest('.wilson-chrome, [data-testid="dev-fixtures-badge"]');
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && (el.offsetParent !== null || cs.position === 'fixed'); };
    if (e.selector) return [...document.querySelectorAll(e.selector)].some((el) => vis(el) && !inShell(el));
    if (e.expanded) return !!document.querySelector(`[title="${e.expanded}"][aria-expanded="true"], [aria-label="${e.expanded}"][aria-expanded="true"]`);
    if (e.expandedText) return [...document.querySelectorAll('button[aria-expanded="true"]')].some((b) => vis(b) && !inShell(b)
      && (b.textContent || '').replace(/\s+/g, ' ').trim().startsWith(e.expandedText));
    return [...document.querySelectorAll('body *')].some((el) => vis(el) && !inShell(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes(e.text)));
  }, expect);
}
/* A proof that may already hold before its step: a tab bar's default tab. */
const mayPreexist = (expect) => !!(expect && (expect.active || expect.styled));

/* ──────────────────────────────── measuring ──────────────────────────────── */
const FAILED = [];
const REPORT = [];

async function visit(ctx, entry) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const errors = [];
  const filling = [];
  /* React writes its warnings as a format string ("%s cannot be a descendant
     of <%s>") with the elements as arguments. The message is recorded the
     moment it arrives — round two: pushing it only after the arguments
     resolved could land it after the verdict, or after the page closed —
     and the placeholders are filled in afterwards, awaited before judging. */
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const i = errors.push(m.text().replace(/\s+/g, ' ').slice(0, 400)) - 1;
    if (!errors[i].includes('%s')) return;
    filling.push(Promise.all(m.args().slice(1).map((a) => a.jsonValue().then(String).catch(() => '?'))).then((vals) => {
      let j = 0;
      errors[i] = errors[i].replace(/%s/g, () => (j < vals.length ? vals[j++].replace(/\s+/g, ' ').slice(0, 120) : '%s'));
    }).catch(() => {}));
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 110)));

  await page.goto(BASE + entry.path, { waitUntil: 'domcontentloaded' });
  await sleep(5000);
  let drove = true;
  let preexisting = false;
  const last = entry.steps.length - 1;
  for (let i = 0; i < entry.steps.length; i++) {
    if (i === last && !mayPreexist(entry.expect)) preexisting = await opened(page, entry.expect);
    drove = (await step(page, entry.steps[i])) && drove;
    await sleep(entry.steps[i] === '@proj' ? 4000 : 3000);
  }
  let isOpen = drove && !preexisting && await opened(page, entry.expect);
  /* One more try at the LAST step, then the proof again — only when every
     step up to it drove and the retry's own click lands. The gate caught
     `rabbit-intake` measuring Summary: the Intake click landed while Summary
     was still settling and was swallowed. A second failure is still a miss. */
  if (!isOpen && drove && !preexisting && entry.steps.length) {
    await sleep(2500);
    const again = await step(page, entry.steps[last]);
    await sleep(3500);
    isOpen = again && await opened(page, entry.expect);
    if (isOpen) console.log(`  ~ ${entry.key}: opened on the second try of "${entry.steps[last]}"`);
  }

  /* Fonts laid out before the font query: an empty platform-font answer
     means "not laid out yet" (trap 4), and one is now a failure. */
  await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
  const info = await page.evaluate(pageCensus);
  const body = await page.evaluate(bodyTextCount);
  const rows = await page.evaluate(typeCensus);
  const faces = FAST ? { tally: {}, off: [], unmeasured: 0, probed: rows.length } : await renderedFaces(cdp, rows);
  const rules = typeRules(rows, { homeCaps: !!entry.homeCaps });
  const ground = await page.evaluate(pageGround);
  const dlg = await page.evaluate(openDialog);
  const tables = await page.evaluate(tableAlignment);
  const bars = await page.evaluate(toolbarAlignment);
  const anon = await page.evaluate(unnamedControls);
  const census = await page.evaluate(stopPointCensus);
  const fields = await page.evaluate(formFields);
  const nested = await page.evaluate(nestedButtons);
  /* The URL too (round two): the twelve pages have no step before their
     proof, and "Salt Hours" is page text on three of them. A walk that lands
     on the wrong route fails here whatever its proof says. */
  const urlOk = new URL(page.url()).pathname.replace(/\/+$/, '') === entry.path.replace(/\/+$/, '');
  /* The proof AGAIN, after ~13s of measuring: a reload or a popup closing
     itself mid-measurement would otherwise report the fresh page. */
  const stillOpen = await opened(page, entry.expect);
  await Promise.allSettled(filling);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${entry.key}-${W}x${H}.png`), animations: 'disabled' });

  const k = entry.key;
  /* C6 is a hard constraint, so it GATES (round two: the Budget sub-tab fix
     had no guard at all — putting its old ink back left everything green).
     A C6 row is a contrast failure whose ground is orange; the rest of the
     contrast census stays a report. */
  const c6 = census.contrast.filter((d) => { const m = d.match(/ on #([0-9a-f]{6}) /); return m && isOrange(m[1]); });
  const nestedEntry = KNOWN.nested.find((x) => x.key === k);
  if (nestedEntry && nested > 0) { MATCHED.add(nestedEntry); seenAtMost(nestedEntry, nested); }
  const nestedKnown = nestedEntry?.n ?? 0;
  const news = {
    face: faces.off.filter((r) => !isKnown('face', k, r.text)),
    weight: rules.weight.filter((r) => !isKnown('weight', k, r.text)),
    upper: rules.upper.filter((r) => !isKnown('upper', k, r.text)),
    tracking: rules.tracking.filter((r) => !isKnown('tracking', k, r.text)),
    errors: errors.filter((e) => !isKnown('errors', k, e)),
    anon: newAnon(k, anon),
    c6: c6.filter((d) => !isKnown('c6', k, d)),
    nested: nested > nestedKnown ? nested - nestedKnown : 0,
  };
  const faceGap = !FAST && (faces.unmeasured > 0 || faces.probed !== rows.length);
  /* Form fields cannot be asked which font drew them; their DECLARED family
     is checked — every visible input, select and textarea (round two found
     30 selects on the Rate Card that no check had looked at). */
  const formFace = fields.filter((f) => !/^Geist( Mono)?$/.test(f.family));
  const dlgBad = dlg && !dlg.fits && !isKnown('dialogFit', k, 'fits');
  /* "Did this page render?", counted OUTSIDE the shell: the shell and the
     dev badge alone are 18 text nodes, so the old floor of 10 could not
     trip while they were on screen (round one). */
  /* 3, not 10: Files' own empty state ("No project chosen") is four text
     nodes, and a body that rendered nothing is 0. */
  const thin = body < 3;
  const open = isOpen && stillOpen;
  const bad = !open || !urlOk || thin || faceGap || formFace.length || info.overflow || info.offScale || dlgBad
    || news.face.length || news.weight.length || news.upper.length || news.tracking.length || news.errors.length || news.anon.length
    || news.c6.length || news.nested;

  const knownN = (faces.off.length - news.face.length) + (rules.weight.length - news.weight.length)
    + (rules.upper.length - news.upper.length) + (rules.tracking.length - news.tracking.length) + (anon.length - news.anon.length)
    + (c6.length - news.c6.length);
  const dl = dlg ? ` dlg=${dlg.kind}:${dlg.bg}/r${dlg.radius}/${dlg.box[2]}x${dlg.box[3]}${dlg.fits ? '' : ' OFF-SCREEN'}${dlg.scrolls.length ? ' scrolls' : ''}` : '';
  const gr = dlg ? '(under a dialog)' : ground.join('/');
  const why = !open ? (preexisting ? '   ← PROOF TRUE BEFORE ITS STEP' : !isOpen ? '   ← DID NOT OPEN' : '   ← CLOSED WHILE MEASURED') : '';
  console.log(`${(open ? '' : '✗ ') + k}`.padEnd(30)
    + ` err=${errors.length} ovf=${info.overflow ? 'Y' : 'n'} off=${info.offScale} clip=${String(info.clipped).padEnd(3)}`
    + ` face=${FAST ? '-' : faces.off.length} wt=${rules.weight.length} up=${rules.upper.length} trk=${rules.tracking.length} anon=${anon.length} c6=${c6.length} nest=${nested}`
    + (knownN ? ` (known ${knownN})` : '')
    + ` b2=${census.border.length} rad=${census.radius.length} white=${census.white.length} cr=${census.contrast.length} brk=${census.broken.length} caps=${census.typedCaps.length}`
    + ` ground=${gr}${dl}${why}`
    + (urlOk ? '' : `   ← WRONG ROUTE ${new URL(page.url()).pathname}`)
    + (thin ? `   ← ONLY ${body} TEXT NODES OUTSIDE THE SHELL` : '')
    + (faceGap ? `   ← FACE UNMEASURED ${faces.unmeasured}, PROBED ${faces.probed} OF ${rows.length}` : ''));
  const show = (label, arr, f) => { for (const r of arr.slice(0, VERBOSE ? 50 : 4)) console.log(`      ${label} ${f(r)}`); if (!VERBOSE && arr.length > 4) console.log(`      ${label} … +${arr.length - 4}`); };
  show('face', news.face, (r) => `${r.used} x${r.glyphs} <${r.tag}> "${r.text}"`);
  show('form', formFace, (f) => `declares ${f.family} <${f.tag}> "${f.value}"`);
  show('c6  ', news.c6, (d) => d);
  if (news.nested) console.log(`      nest ${nested} button(s) inside buttons; ${nestedKnown} filed`);
  if (faceGap) show('gap ', faces.missed || [], (r) => `no answer for <${r.tag}.${r.cls}> "${r.text}"`);
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
  REPORT.push({ key: k, open, urlOk, c6, nested, fields: fields.length, ground: dlg ? ['(dialog)'] : ground, dlg, tables, bars, faces: faces.tally,
    faceProbe: { probed: faces.probed, rows: rows.length, unmeasured: faces.unmeasured },
    clipped: info.clipped, body, anon, census, face: faces.off, rules, errors });
  if (bad) FAILED.push(k);
  await page.close();
}

/* A mistyped --only key used to run fewer screens — or none — and print a
   pass (round one ran `--only help_otter`: "✓ 0 screens"). */
if (ONLY) {
  const unknown = ONLY.filter((k) => !REGISTRY.some((e) => e.key === k));
  if (unknown.length) { console.error(`unknown --only key(s): ${unknown.join(', ')}`); process.exit(1); }
}
const entries = REGISTRY.filter((e) => !ONLY || ONLY.includes(e.key));
if (!entries.length) { console.error('no screens to walk'); process.exit(1); }

const browser = await chromium.launch();
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
console.log(`# ui-walk — ${entries.length} screens at ${W}x${H}, port ${PORT}${FAST ? ' (--fast: face NOT checked)' : ''}\n`);

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
for (const kind of ['contrast', 'broken', 'typedCaps', 'white', 'border', 'radius']) {
  const seen = new Map();
  for (const r of REPORT) for (const d of new Set(r.census[kind])) { if (!seen.has(d)) seen.set(d, new Set()); seen.get(d).add(r.key); }
  console.log(`\n— ${kind}: ${seen.size} distinct —`);
  for (const [d, keys] of [...seen].sort((a, b) => b[1].size - a[1].size).slice(0, VERBOSE ? 400 : 12)) console.log(`  ${String(keys.size).padStart(3)}× ${d}   [${[...keys].slice(0, 4).join(', ')}${keys.size > 4 ? ', …' : ''}]`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ W, H, fast: FAST, report: REPORT }, null, 1));

const faceTotal = {};
for (const r of REPORT) for (const [f, n] of Object.entries(r.faces)) faceTotal[f] = (faceTotal[f] || 0) + n;
if (!FAST) console.log(`\n— glyphs drawn, all screens — ${Object.entries(faceTotal).map(([f, n]) => `${f} ${n}`).join(' · ')}`);

{
  /* A screen counts as WALKED only when it opened: a screen that failed to
     open, or threw twice, was never looked at, and its filings are not
     evidence of anything (A3 review round 2). */
  const walked = new Set(REPORT.filter((r) => r.open).map((r) => r.key));
  const line = (kind, x, tail = '') => `${kind.padEnd(10)} ${x.key.padEnd(24)} ${x.text ?? ''}${x.n != null ? ` (n=${x.n})` : ''}${tail}`;
  const kinds = Object.entries(KNOWN).filter(([kind]) => !(FAST && kind === 'face'));
  const stale = kinds.flatMap(([kind, list]) => list.filter((x) => walked.has(x.key) && !MATCHED.has(x)).map((x) => line(kind, x)));
  if (stale.length) {
    console.log(`\n— stale KNOWN: ${stale.length} filed entr${stale.length === 1 ? 'y' : 'ies'} matched nothing on a screen this run walked — delete the line if its defect is gone —`);
    for (const s of stale) console.log(`  ${s}`);
  }
  // A ceiling above what its screen has.
  const loose = kinds.flatMap(([kind, list]) => list
    .filter((x) => x.n != null && walked.has(x.key) && CEILING_SEEN.has(x) && CEILING_SEEN.get(x) < x.n)
    .map((x) => line(kind, x, ` — the screen has ${CEILING_SEEN.get(x)}`)));
  if (loose.length) {
    console.log(`\n— loose KNOWN ceilings: ${loose.length} — lower each to what the screen has, or new ones pass under it —`);
    for (const s of loose) console.log(`  ${s}`);
  }
  // A filing against a screen the registry does not have (a renamed or
  // deleted screen): no run can ever match it, so no run would ever say so.
  const orphans = Object.entries(KNOWN).flatMap(([kind, list]) => list
    .filter((x) => !REGISTRY.some((e) => e.key === x.key)).map((x) => line(kind, x)));
  if (orphans.length) {
    console.log(`\n— orphaned KNOWN: ${orphans.length} filed against a screen the registry does not have —`);
    for (const s of orphans) console.log(`  ${s}`);
  }
}
if (FAILED.length) {
  console.log(`\n🚨 ${FAILED.length} of ${entries.length} screens did not come back clean: ${FAILED.join(', ')}`);
  process.exit(1);
}
const knownFace = REPORT.reduce((a, r) => a + r.face.length, 0);
const knownC6 = REPORT.reduce((a, r) => a + r.c6.length, 0);
console.log(`\n✓ ${entries.length} screens: every one opened on its own route and stayed open, 0 new errors, 0 overflow, 0 off-scale, `
  + (FAST ? 'face NOT checked (--fast), ' : `the drawn face of every text node measured — ${knownFace} in a fallback face, all filed (V1-01) — `)
  + 'form fields by their DECLARED family only, '
  + `no new break of §3.1's weight, case or tracking, no new unnamed control, no new nested button, `
  + `no new C6 break (${knownC6} filed, V1-02)`);
