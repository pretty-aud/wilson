// =============================================================================
//  THE PAGE REGISTRY — one list every page-shaped thing derives from
// =============================================================================
//
// UI overhaul F2 (plan §4 PageHeader, §5 F2; review F32).
//
// Adding a page used to mean editing THREE hand-maintained lists — PAGE_TITLES
// in App.jsx, PAGE_BARS in pageBars.js, and an eight-way OR chain in
// renderTopBarContent — plus two nav arrays. The Files page was added to
// PAGE_TITLES, the nav and the OR chain and missed PAGE_BARS, so for three
// weeks the densest table in the app rendered inside HOME's 268/268 chrome and
// lost about 400px of field (review F-R04 / F05). Nothing failed. Nothing
// could fail: `PAGE_BARS[currentPage] || PAGE_BARS.home` turns a missing key
// into a silent wrong answer.
//
// 🚨 THE POINT OF THIS FILE: a page with no `bars` is a BUILD failure, thrown
// at module load, not a fallback. `pages.test.js` also pins the derivation, so
// a page added here without geometry cannot reach a screen.
//
// ── The fields ───────────────────────────────────────────────────────────────
//
//   id        the `currentPage` value and the URL segment (/wilson/<id>)
//   title     the PageHeader title AND the page-transition title. Sentence
//             case: the transition applies `text-transform: uppercase` itself
//             and is otherwise untouched (Q18), so the stored case is the
//             header's (Q2, sentence case everywhere but the Label step).
//   subtitle  the Dense line under the title — the three tool wordmarks'
//             expansions, and nothing else has one. `#1c1917`, not
//             `text-orange-200`: that measured 2.63:1 on the frame (C6).
//   bars      the orange chrome's resting heights, from `bars(top, bottom)`
//   surface   'dark' | 'light' — WHAT THE PAGE ACTUALLY PAINTS TODAY, not
//             what it will paint after its lane converts it. See the note on
//             Q1 below; this field drives a real background colour, and an
//             aspirational value here renders black text on black.
//   measure   null      full-bleed: the page owns the whole field (the tools)
//             'data'    the 1240px data column (plan §3.3)
//             'reading' the 720px reading/form column
//             🚨 It is set on the PAGE and on its HEADER together. A page
//             capped to a centred column whose title is not is a title that
//             does not line up with its own first row, which is the
//             alignment Audrey named in the brief.
//   chrome    'tool'  the logo + wordmark + expansion header (D.O.G., O.T.T.E.R.,
//                     R.A.B.B.I.T.), a 4px separator under the bars, no content
//                     padding — the tool owns its own field
//             'page'  the plain title header, 24px gutter, 24px content padding
//             'none'  Home: no bar content at all
//   nav       'primary'   the main nav column
//             'resources' the RESOURCES sub-column
//             (every page is reachable from exactly one of the two)
//   navLabel  the nav strip's word for it, when that differs from `title`
//   adminOnly filtered out of the nav for non-admins (Admin Terminal)
//
// ── Q1 and the `surface` field ───────────────────────────────────────────────
//
// Audrey ruled Option A: the six DATA pages (Files, Projects, Rate Card, Team
// Members, Dashboard, Admin Terminal) move off `#f4a261` onto the same dark
// `paper` the tools use, and Home / Settings / Help stay light. That is a
// per-page conversion — the page's own inks, wells and borders all have to
// move in the same commit — so each one flips HERE in the commit that
// converts it, never before. F2 converts Team Members (the worked example).
// The other five are lane C's (plan §5, Wave 3 lane C) and say so below.
//
// =============================================================================

import { bars } from './pageBars';

// The order of this array is the nav order, in both columns.
const PAGE_LIST = [
  {
    id: 'home',
    title: 'Home',
    bars: bars(268, 268),
    surface: 'light',
    chrome: 'none',
    nav: 'primary',
  },
  {
    id: 'dog',
    title: 'D.O.G.',
    subtitle: 'Deck Outline Generator',
    bars: bars(95, 8),
    surface: 'dark',
    chrome: 'tool',
    nav: 'primary',
  },
  {
    id: 'otter',
    title: 'O.T.T.E.R.',
    subtitle: 'On-demand Training & Technical Education Resource',
    bars: bars(95, 8),
    surface: 'dark',
    chrome: 'tool',
    nav: 'primary',
  },
  {
    id: 'rabbit',
    title: 'R.A.B.B.I.T.',
    subtitle: 'Resource Allocation, Budgeting & Breakdown Intake Tool',
    bars: bars(95, 8),
    surface: 'dark',
    chrome: 'tool',
    nav: 'primary',
  },
  {
    // Lane C2 converted this page. Its inks moved onto `paper` in the same
    // commit as this line, which is the rule the comment above states.
    id: 'dashboard',
    title: 'Dashboard',
    // Q8(b): the resource-class rows drop to 120/80, which returns about
    // 150px of field to a view that showed roughly eight table rows.
    bars: bars(120, 80),
    surface: 'dark',
    chrome: 'page',
    measure: 'data',
    nav: 'primary',
  },
  {
    // Q7, ruled: "SETTINGS" (a tool's own) sat beside "SYSTEM SETTINGS" in the
    // same column. The tool item becomes "Tool settings" (App.jsx builds it —
    // it is a trigger, not a page) and this one "App settings". The page's own
    // title follows the nav word: one name for one thing is the whole point,
    // and a header that disagrees with the item that opened it is the defect
    // Q7 names. The transition title says APP SETTINGS for the same reason.
    id: 'settings',
    title: 'App settings',
    bars: bars(200, 150),
    surface: 'light',
    chrome: 'page',
    nav: 'primary',
  },

  // ── The RESOURCES sub-column ──
  {
    id: 'project-manager',
    title: 'Projects',
    bars: bars(200, 150),
    surface: 'light', // Q1 lane C (C1)
    chrome: 'page',
    nav: 'resources',
  },
  {
    id: 'rate-card',
    title: 'Rate card',
    bars: bars(200, 150),
    surface: 'light', // Q1 lane C (C1)
    chrome: 'page',
    nav: 'resources',
  },
  {
    // F2's worked example: the first page on the Q1 dark ground, and the first
    // caller of every component in the kit that had none.
    id: 'team-members',
    title: 'Team members',
    bars: bars(200, 150),
    surface: 'dark',
    chrome: 'page',
    measure: 'data',
    nav: 'resources',
  },
  {
    // F1 gave this page the resource geometry it had been missing (Q8a).
    id: 'project-files',
    title: 'Files',
    bars: bars(200, 150),
    surface: 'light', // Q1 lane C (C1)
    chrome: 'page',
    nav: 'resources',
  },
  {
    id: 'admin-terminal',
    title: 'Admin terminal',
    bars: bars(200, 150),
    surface: 'light', // Q1 lane C (C3)
    chrome: 'page',
    nav: 'resources',
    adminOnly: true,
  },
  {
    id: 'help',
    title: 'Help',
    bars: bars(140, 100),
    surface: 'light',
    chrome: 'page',
    nav: 'resources',
  },
];

const SURFACES = ['dark', 'light'];
const CHROMES = ['tool', 'page', 'none'];
const NAVS = ['primary', 'resources'];
const MEASURES = [null, 'data', 'reading'];

/**
 * Throws unless `p` is a complete page. This is the build failure F32 asked
 * for: an incomplete page throws where it is written instead of rendering in
 * Home's chrome three weeks later.
 *
 * 🚨 EXPORTED so `pages.test.js` can build each incomplete page and prove each
 * rejection really fires. A test that re-implements this function proves only
 * that its own copy throws, and every such assertion survives any change to
 * the real one.
 */
export function validatePage(p) {
  const at = `PAGES entry ${JSON.stringify(p?.id ?? '(no id)')}`;
  if (!p || !p.id || typeof p.id !== 'string') throw new Error(`${at}: needs a string id`);
  if (!p.title || typeof p.title !== 'string') throw new Error(`${at}: needs a title`);
  if (!p.bars || typeof p.bars.top !== 'string' || typeof p.bars.bottom !== 'string') {
    throw new Error(`${at}: needs bars(top, bottom) — the Files-page bug (F-R04) is exactly this`);
  }
  if (!SURFACES.includes(p.surface)) throw new Error(`${at}: surface must be one of ${SURFACES}`);
  if (!CHROMES.includes(p.chrome)) throw new Error(`${at}: chrome must be one of ${CHROMES}`);
  if (!NAVS.includes(p.nav)) throw new Error(`${at}: nav must be one of ${NAVS}`);
  if (!MEASURES.includes(p.measure ?? null)) throw new Error(`${at}: measure must be one of ${MEASURES}`);
  return p;
}

// Validation at module load. It runs in production too — a few string
// comparisons once per boot, and a half-registered page is not a state the app
// should be able to start in.
PAGE_LIST.forEach(validatePage);
if (new Set(PAGE_LIST.map((p) => p.id)).size !== PAGE_LIST.length) {
  throw new Error('PAGES: duplicate id');
}

export const PAGES = Object.freeze(PAGE_LIST.map((p) => Object.freeze({
  subtitle: null,
  navLabel: p.title,
  adminOnly: false,
  measure: null,
  ...p,
})));

export const PAGE_BY_ID = Object.freeze(Object.fromEntries(PAGES.map((p) => [p.id, p])));
export const PAGE_IDS = Object.freeze(PAGES.map((p) => p.id));

/** The page record, or null. Never a silent fallback — callers decide. */
export function getPage(id) {
  return PAGE_BY_ID[id] || null;
}

// ── The derived tables ───────────────────────────────────────────────────────
// Three lists that used to be typed by hand, now one expression each. They
// keep their old names and shapes so their existing readers are unchanged.

/** Bar geometry per page. `App.jsx` and the pet's offset read this. */
export const PAGE_BARS = Object.freeze(
  Object.fromEntries(PAGES.map((p) => [p.id, p.bars])),
);

/** Page titles. The URL↔page sync uses its keys as the id whitelist. */
export const PAGE_TITLES = Object.freeze(
  Object.fromEntries(PAGES.map((p) => [p.id, p.title])),
);

// 🚨 THE SIGN-IN SEAM (Phase 4, kept verbatim from pageBars.js). AuthShell's
// reveal settles its bars at this exact value and App's `playWelcome` picks
// them straight up from there, so the two animations read as one continuous
// movement: the bars close, say WELCOME, and open onto Home. It was a literal
// '268px' in AuthShell and a literal '268px' in the bar table — two copies of
// one number, and the first thing anyone sees after signing in is the two
// disagreeing.
export const HOME_BAR_HEIGHT = PAGE_BARS.home.top;

/**
 * The nav strip's page items for one column, minus the page you are on.
 * The RESOURCES trigger and a tool's own settings item are NOT pages and are
 * assembled by App.jsx around these.
 */
export function navPages(column, { currentPage, isAdmin } = {}) {
  return PAGES.filter((p) => p.nav === column)
    .filter((p) => !p.adminOnly || isAdmin)
    // Context-aware: the strip omits the page you are already on. Home is the
    // exception and always shows — it was unconditional before this registry,
    // and the strip never opens on Home anyway (`hasNavMenu = !isHome`), so
    // the exception is the old behaviour stated rather than a new one.
    .filter((p) => p.id === 'home' || p.id !== currentPage);
}
