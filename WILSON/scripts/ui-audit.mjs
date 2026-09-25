#!/usr/bin/env node
/**
 * UI overhaul — the plan §7 grep audit, as a script.
 *
 * T0 (the codemod) runs this BEFORE its first pass and AFTER its last, and
 * both columns go in the hand-off. That table is the bundle's definition of
 * done, so the scope below has to be stable across the two runs: change the
 * scope and the columns stop comparing.
 *
 * SCOPE (plan §5 "Never touched" + §6.5 ownership):
 *   included   src/ ** / *.{js,jsx}
 *   excluded   src/ui/**            Foundation's, already on scale
 *              *.test.*             guards, not product surface
 *              LayoutVisualizer.jsx, VideoThumbnail.jsx      (C4)
 *              src/components/sprites/**                     (C5)
 *              src/index.css and the four page CSS files are counted
 *              separately, in the SECOND table — never mixed into the JSX
 *              columns, because the two tables have different scopes and
 *              adding them together would compare nothing to nothing.
 *
 * 🚨 THE SECOND TABLE EXISTS BECAUSE THE COMMENT ABOVE USED TO LIE.
 * Until T3 (2026-09-22) this scanner read `.js` and `.jsx` only, while its
 * own header promised the stylesheets were "counted separately below". There
 * was no below. Five CSS files — 4,000-odd lines carrying the Settings,
 * Dashboard, Admin Terminal and Resources surfaces plus every `@theme`
 * token — had therefore never been swept by anything, by any session, at
 * any point in the overhaul: not by T0's five passes (which rewrite class
 * names in JSX) and not by this audit. A reviewer found the gap; the fix is
 * to make the sentence true rather than to delete it.
 *
 * Usage:  node scripts/ui-audit.mjs            # both tables
 *         node scripts/ui-audit.mjs --json     # machine readable
 *         node scripts/ui-audit.mjs --files X  # list the files for pattern X
 *         node scripts/ui-audit.mjs --css      # the stylesheet table alone,
 *                                              # with every hit's line number
 */
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

const ROOT = 'src';

export const EXCLUDED = [
  /(^|[\/])ui[\/]/,                       // src/ui/**  — Foundation's, on scale
  /\.test\.[jt]sx?$/,                     // guards, not product surface
  /[\/]rabbitCssGuards\.js$/,             // B2: B1's CSS scanners, moved out of a test file; regexes, not product
  /LayoutVisualizer\.jsx$/,               // C4, including its border-2
  /VideoThumbnail\.jsx$/,                 // C4
  /[\/]sprites[\/]/,                      // C5
  /PetCompanion\.jsx$/,                   // C5 — the pet is untouchable
];

export function sourceFiles(root = ROOT) {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(js|jsx)$/.test(p)) continue;
      const rel = p.split(sep).join('/');
      if (EXCLUDED.some((re) => re.test(rel))) continue;
      out.push(rel);
    }
  })(root);
  return out.sort();
}

/* Each row: [label, regex]. Counts are OCCURRENCES (every match), and the
   file count is how many files carry at least one. Both matter: the mass tells
   you how much the pass moves, the spread tells you how much can break. */
export const PATTERNS = [
  ['text-[Npx] (off-scale sizes)',   /\btext-\[\d+(?:\.\d+)?px\]/g],
  ['text-xs…9xl (Tailwind sizes)',   /\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b/g],
  ['font-mono (class)',              /\bfont-mono\b/g],
  ['fontFamily (inline)',            /fontFamily\s*:/g],
  ['fontSize (inline)',              /fontSize\s*:/g],
  ['letterSpacing (inline)',         /letterSpacing\s*:/g],
  /* T2: the fifth inline spelling, and the only one the table could not show.
     `uppercase` below does count these — T0's hand-off says so, "18 are inline
     textTransform" — but it counts them mixed in with 500-odd class sites, so
     a lane clearing its own inline case had no column that moved. This one
     moves. */
  ['textTransform (inline)',         /textTransform\s*:/g],
  ['uppercase',                      /\buppercase\b/g],
  ['tracking-*',                     /\btracking-(?:wide|wider|widest|tight|tighter)\b/g],
  ['tracking-[…] (arbitrary)',       /\btracking-\[[^\]]+\]/g],
  ['font-bold',                      /\bfont-bold\b/g],
  ['font-medium',                    /\bfont-medium\b/g],
  ['fontWeight 500/700 (inline)',    /fontWeight\s*:\s*['"]?(?:500|700|bold)['"]?/g],
  ['border-2',                       /\bborder-2\b/g],
  /* V1 (2026-09-23): the row above cannot see a border spelled one side at a
     time, and D.O.G.'s output panel draws its whole frame that way — top,
     left, right and bottom at 2px, while this table read `border-2: 0`. 37
     in 4 files when added. Some are right: an active tab's 2px underline
     (§4 Tabs) and a selected row's 2px edge (§3.2). So it is a census to
     read, not a row that must reach zero. */
  ['border-[side]-2 (one side)',     /\bborder-[tblrxy]-2\b/g],
  /* V1, round one of its review: and neither row above sees a border set in
     a STYLE OBJECT — `border: '2px solid …'`, `borderBottom: \`2px …\``,
     `borderWidth: 2` — which is how R.A.B.B.I.T.'s popups draw their 2px
     frames. Round two: the first pattern wanted the width straight after
     the colon, so a ternary — `borderBottom: active ? '2px solid …' : …`,
     which is exactly how R.A.B.B.I.T.'s two tab bars draw their underline —
     was invisible. It scans the whole value now, up to the next comma or
     line end, for a px width of 2 or more that is not the tail of a decimal
     (`0.5px`); a bare numeric `borderWidth: 2` counts too. A census, like the
     row above. */
  ['border 2px+ (inline style)',     /\bborder(?:Top|Right|Bottom|Left)?(?:Width)?\s*:[^,;}\n]*?(?<![\d.])(?:[2-9]|[1-9]\d)(?:\.\d+)?px\b|\bborder(?:Top|Right|Bottom|Left)?Width\s*:\s*(?:[2-9]|[1-9]\d)\b/g],
  ['rounded-sm/md/lg/xl/2xl',        /\brounded-(?:sm|md|lg|xl|2xl)\b/g],
  /* Added by T0 after pass 3: the bare `rounded` is Tailwind's 4px, which
     §3.3 deletes along with 2, 5, 8 and 10. It was missing from the first
     draft of this table and is 431 sites in 27 files at `6471480`. */
  ['rounded (bare, 4px)',            /\brounded(?![-\w])/g],
  ['rounded-full',                   /\brounded-full\b/g],
  ['rounded-[…] (arbitrary)',        /\brounded-\[[^\]]+\]/g],
  ['transition-all',                 /\btransition-all\b/g],
  ['opacity-30/40/50',               /\bopacity-(?:30|40|50)\b/g],
  ['bg-white / bg-white/*',          /\bbg-white(?:\/\d+)?\b/g],
  ['window.confirm',                 /window\.confirm\s*\(/g],
  ['p-[Npx] / gap off the 4px grid', /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-\[\d+(?:\.\d+)?px\]/g],
  ['vh units (inline or class)',     /\d+vh\b/g],
];

/* Blank JS/JSX comments to spaces, keeping every byte offset. The `[^:]`
   before `//` is what stops `https://…` inside a string from blanking the
   rest of the line — a crude test, and it is crude on purpose: this feeds a
   REPORTING column, never an assertion, so erring toward leaving code
   visible is the safe direction. */
export function blankJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

/* 🚨 A SECOND COLUMN, BECAUSE THE FIRST ONE COUNTS PROSE (T3, round one).
   `countIn` greps source text, so a comment that NAMES a class or a property
   is counted as a live site. That is not hypothetical and it is not T3's
   doing: measured across the 271 in-scope files, 26 `uppercase` hits, 22
   `vh` hits and 6 `text-xs…9xl` hits are inside comments written by D2, F2
   and the lanes — sessions explaining what they had just removed.

   T0's own remainder notes already hand-annotate this ("2 are comments",
   "four are comments quoting old class names"). The `in code` column does
   the annotation arithmetically.

   The `hits` column is left EXACTLY as it was rather than replaced, because
   T0's before/after table and T1's and T2's running comparisons are all
   against that number and "change the scope and the columns stop comparing"
   is this script's own first rule. */
function countIn(files, re) {
  let hits = 0; let code = 0; const inFiles = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const m = src.match(new RegExp(re.source, re.flags));
    const c = blankJsComments(src).match(new RegExp(re.source, re.flags));
    code += c ? c.length : 0;
    if (m && m.length) { hits += m.length; inFiles.push([f, m.length]); }
  }
  return { hits, code, files: inFiles.length, inFiles };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE STYLESHEETS (T3, 2026-09-22)

   Five files, and until now none of them was read by any tool in this
   bundle. They are listed rather than globbed so the column is stable
   between runs the way the JSX scope is, and so a new stylesheet has to be
   added deliberately — a `src/ ** / *.css` glob would silently change the
   denominator the first time someone adds one.
   ═══════════════════════════════════════════════════════════════════════ */
export const CSS_FILES = [
  'src/index.css',
  'src/components/settings/settings.css',
  'src/components/Dashboard/dashboard.css',
  'src/components/AdminTerminal/adminTerminal.css',
  'src/components/Resources/resources.css',
  // B1 (2026-09-23): R.A.B.B.I.T.'s shell, Intake, Summary and Team. Added
  // deliberately, in the commit that took its last hex out, so the audit's
  // denominator moves by one named file.
  'src/tools/rabbit_v0.1.0/rabbitShell.css',
  // A1, 2026-09-23 — D.O.G.'s extracted state and its A1 restyle. The A2
  // half still holds the extraction's oklch palette literals (no hex).
  'src/tools/deck-outline-generator_v0.514/dog.css',
  // B6, 2026-09-23 — Bins' extracted state and its restyle, on the tokens.
  // Added deliberately, like the two above; it scores 0 on every row.
  'src/tools/rabbit_v0.1.0/views/bins/bins.css',
  // B2, 2026-09-23 — Tasks, the task popups and the template manager. Added
  // in the commit that took its last hex out, as B1's was.
  'src/tools/rabbit_v0.1.0/views/rabbitTasks.css',
  // A3, 2026-09-24 — O.T.T.E.R.'s extracted state and its A3 restyle. Added
  // in the commit that created it, so the denominator moves by one named
  // file. The restyle replaced every extraction literal with a token: it
  // scores 0 on every row (otterCss.test.js holds it there).
  'src/tools/otter_v0.3.1/otter.css',
  // B3, 2026-09-24 — the Timeline's extracted state (TimelineView and
  // EditHistoryDrawer). Added in its STAGE 1 commit, when it transcribed the
  // shipped hexes on purpose; B3b–B3d tokenised every one, and since B3d
  // (2026-09-25) typeScale.test.js holds it to no hex like every page sheet.
  'src/tools/rabbit_v0.1.0/views/rabbitTimeline.css',
];

/* A comment is not code. Blanking comments to spaces (rather than deleting
   them) keeps every byte offset, so a hit's line number is still its line
   number. T0's hand-off §5 trap 4 is the same lesson from the other side:
   a scanner that mis-handles a non-code region fails SILENTLY. */
export function blankCssComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/* `@theme` is the ONE place a hex is legal (plan §3.2, C8). Its range has to
   be excluded from the hex row or the token block reports itself as 60-odd
   violations and the row is useless. Returns [start, end) offsets, or null. */
export function themeRange(src) {
  const i = src.indexOf('@theme');
  if (i < 0) return null;
  let depth = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return [i, j + 1]; }
  }
  return [i, src.length];
}

/* The declaration block a hit sits in: back to the nearest unmatched `{`,
   forward to the `}` that closes it. Some rows can only be judged against
   their siblings — `text-transform: uppercase` is correct on the Label step
   and a defect anywhere else, and the step is a DIFFERENT declaration in the
   same block. T0's hand-off §5 trap 7 is this problem in JSX: an evidence
   window is a parser you did not write, so walk to the matching close rather
   than guessing a character count. */
export function enclosingBlock(src, index) {
  let depth = 0, start = -1;
  for (let i = index; i >= 0; i--) {
    if (src[i] === '}') depth++;
    else if (src[i] === '{') { if (depth === 0) { start = i; break; } depth--; }
  }
  if (start < 0) return '';
  depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  /* 🚨 THE WALK DID NOT CLOSE, SO RETURN NOTHING RATHER THAN EVERYTHING.
     The first draft fell through to `src.slice(start)` — the rest of the
     file — and a reviewer showed what that costs: a stray `{` inside a
     string (`content: "{"`) makes the forward walk overrun, and the
     rest-of-file "block" then contains SOMEBODY ELSE'S `var(--text-label)`,
     so an uppercase rule at the wrong step is ACCEPTED. That is T0's §5 trap
     4 exactly — an unmatched delimiter swallowing the file and failing in
     the safe-LOOKING direction. An empty block matches no accept rule, so a
     hit is now REPORTED when the parse is uncertain. Not live today (no
     string or `url()` in the five sheets contains a brace) and it is not
     going to become live silently. */
  return '';
}

/* Each row: [label, regex, accept?]. `accept(match, block)` returning true
   means the hit is ON the system and is not counted — that is where the
   judgment lives, and it is written here rather than in the caller so the
   guard and the table agree by construction (T0 §5 trap 13: a control that
   re-types its assertion's regex proves nothing). */
export const CSS_PATTERNS = [
  /* §3.3: ONE 1px hairline. A width of 2px or more is either an indicator
     (§3.2's "a 2px selected-row edge") or a defect, and this row cannot tell
     them apart — it reports the population and a human judges it, exactly as
     T0's pass 4 judged the 102 class-based side borders and left 38.
     Flattening all of them would erase every active-tab underline in the app.

     🚨 ALL EIGHTEEN REMAINING HITS WERE JUDGED BY HAND BY T3 (2026-09-22)
     AND EVERY ONE IS DELIBERATE. Written down here so the next session does
     not re-litigate a list that has already been walked:

       index.css     1349  the Spinner's ring (a 2px ring is a spinner)
                     1703  the Tabs underline — the kit contract is literally
                           "one 2px signal underline", and its own comment
                           cites C6 for why the edge is transparent, not a fill
                     1269  the Toast / Banner tone edge
                     2356  `.companion-chat-md` — the agent panel's (P1), not
                           swept here; `.lesson-content`'s four went with A3
       settings.css   109  the Settings tab underline (same contract)
                429/448  a semantic left edge on the danger button and the
                         status block
              458/777/819/825  🚨 THE LIGHT SURFACE HAS NO STATUS COLOUR.
                           §3.2 draws none on `#f4a261` — success measures
                           1.18:1, danger 1.09, warning 1.04 — so D1 carried
                           ok / warning / error on WIDTH, WEIGHT and LINE
                           STYLE instead, measured and documented at the
                           rules: 2px solid at 400, 4px dashed at 600, 4px
                           solid at 600. Flattening these does not tidy a
                           border, it DELETES the difference between a
                           warning and an error on the Settings page.
       dashboard.css  443  the selected note row's 2px edge — §3.2 verbatim
       adminTerminal  700  the decide panel's signal edge, same job
       dog.css  (A1)  .dog-history-row — F2 Row's "highlighted" 2px edge (a page
                      open in a tab); .dog-page-tab — the kit's tab underline on
                      the closable wrapper (kit request KR-1). (A third,
                      .dog-settings-tab, went when A2 put the Settings tabs
                      on the kit's Tabs, 2026-09-23.)

     The one that was NOT an indicator — dashboard.css's ProseMirror
     blockquote, a neutral colour with no conditional and no state — is the
     hairline now. That is the whole yield of this row, and it is the right
     yield. */
  /* 🚨 `(?<![\d.])` is load-bearing, and a reviewer found why: `\b` sits
     between the `.` and the `5` of `1.5px`, so a hairline-and-a-half matched
     as "5px" and was counted as a 2px-or-more border. A correct rule reported
     as a defect is the same class of error as a defect reported as clean — it
     sends the next session to a site that is already right. Case-insensitive
     because CSS is. */
  ['border >= 2px', /\bborder(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-width)?\s*:\s*[^;{}]*?(?<![\d.])(?:[2-9]|[1-9]\d+)(?:\.\d+)?px/gi],
  /* §3.3: two radii, 3px and 6px, both behind tokens. `0` is not a radius and
     `9999px` / `50%` are §6's `rounded-full`, which the plan's deletion list
     ("2, 4, 5, 8, 10px") does not name. */
  ['border-radius off the two', /\bborder-radius\s*:\s*([^;{}]+)/g,
    (m) => /var\(--radius-(?:control|float)\)/.test(m[1]) || /^\s*0(?:px)?\s*$/.test(m[1]) || /9999px|50%/.test(m[1])],
  /* §3.1: two weights, 400 and 600. The faces are declared `font-weight:
     400 600`, so a 700 CLAMPS to 600 — it renders identically and the source
     claims a weight the system does not have. */
  /* 🚨 §3.1 HAS TWO WEIGHTS, AND THIS ROW USED TO LIST THE THREE SPELLINGS IT
     EXPECTED TO FIND rather than asking what the system allows. So
     `font-weight: 800` and `font-weight: 300` were guarded by nothing at all,
     while a test built on this row asserted the page sheets were "off the
     axis nowhere". It ACCEPTS now instead of rejecting: 400, 600, the step's
     own sub-property, and the keywords that inherit rather than set.
     Everything else is reported, including spellings nobody has thought of. */
  /* 🚨 ROUND TWO, two ways. `!important` is COMPLIANT and was reported —
     this repo already writes out that lesson at length in typeScale.test.js
     and applies it there, and this row did not inherit it. And `400 600` was
     accepted ANYWHERE: it is the variable-font AXIS RANGE, legal only in an
     `@font-face`, and a browser drops it on an ordinary rule so the element
     silently inherits — a defect reading as compliance. It is gated on the
     block now. */
  ['font-weight off the 400/600 axis', /\bfont-weight\s*:\s*([^;{}]+)/gi,
    (m, block) => /^\s*(?:400|600|var\(--text-(?:h1|h2|h3|body|dense|caption|label)--font-weight\)|inherit|initial|unset|revert|normal)(?:\s*!important)?\s*$/i.test(m[1])
      || (/^\s*400\s+600(?:\s*!important)?\s*$/.test(m[1]) && /\bsrc\s*:/i.test(block))],
  /* `400 600` above is the variable-font AXIS RANGE, which is only legal in
     an `@font-face`. It is accepted because it is the declaration that MAKES
     the two-weight system true — and it is the reason a `700` anywhere else
     clamps to 600 rather than rendering heavier. */

  /* 🚨 THE `font:` SHORTHAND SETS A WEIGHT *AND* A SIZE AND MATCHES NEITHER
     ROW. `font: 600 9px/1.2 var(--font-sans)` walks past the weight row, the
     size row, and both T3 assertions built on them.
     `adminTerminalCss.test.js` already bans the shorthand on its own sheet —
     and its comment records a reviewer doing exactly this to defeat it — but
     the five-file scan did not inherit the lesson. `font: inherit` is the one
     legitimate use here and is accepted; the sheets carry seven of them. */
  ['font: shorthand', /(?<![-\w])font\s*:\s*([^;{}]+)/gi,
    (m) => /^\s*(?:inherit|initial|unset|revert)\s*$/i.test(m[1])],
  /* §3.1: seven steps, all behind `--text-*`, and "every step a whole pixel".
     An `em`- or `rem`-relative size is therefore OFF the scale and counted —
     it inherits whatever its parent happens to be, which is the opposite of
     a step with a job.
     ⚠️ The first draft of this row excluded them with `/\bem\b/`, which
     matches NOTHING against `0.9em`: `9` and `e` are both word characters,
     so there is no boundary between them. That is T0's hand-off §5 trap 2
     for the fourth time in this bundle, and it failed in the direction that
     looks fine — seven real hits silently accepted. The row now reports
     them, which is what its comment always claimed. */
  ['font-size off the scale', /\bfont-size\s*:\s*([^;{}]+)/g,
    (m) => /var\(--text-/.test(m[1]) || /^\s*(?:inherit|unset|revert)\s*$/.test(m[1])],
  /* C8: a hex outside `@theme` has failed. The `@theme` range is excluded by
     the caller, not here, because it is a position not a value. */
  ['hex colour outside @theme', /#[0-9a-fA-F]{3,8}\b/g],
  /* §3.4: named properties, never the blanket. */
  ['transition: all', /\btransition(?:-property)?\s*:\s*[^;{}]*\ball\b/g],
  /* §3.1: uppercase is the Label step's, and the Label step KEEPS its
     capitals by design (T0's map: `uppercase`, under 18px → `text-label`,
     KEEPS UPPER). So a rule that shouts AND sets the Label step is the
     system working; only a rule that shouts at some other step is a defect.
     Judged against the enclosing block, because the step is a sibling
     declaration — reporting all 36 without that test would be 36 lines of
     noise, and a row nobody can act on is a row the next session skips. */
  ['text-transform: uppercase off the Label step', /\btext-transform\s*:\s*uppercase\b/g,
    (m, block) => /var\(--text-label\)/.test(block)],
];

/** Count one CSS pattern across `files`, returning per-file hits WITH line
 *  numbers — the JSX table only needs totals, but a stylesheet finding is
 *  useless without the line, because nobody greps a 1,179-line file by eye. */
/* `read` is the file reader, so a test can feed a mutant through the REAL
   path (typeScale.test.js's control): an exemption keyed on a path is then
   caught, which a mutant written to a temporary file cannot catch. */
export function cssCounts(files = CSS_FILES, read = (f) => readFileSync(f, 'utf8')) {
  return CSS_PATTERNS.map(([label, re, accept]) => {
    let hits = 0; const inFiles = [];
    for (const f of files) {
      const raw = read(f);
      const src = blankCssComments(raw);
      const theme = f.endsWith('index.css') ? themeRange(src) : null;
      const found = [];
      const rx = new RegExp(re.source, re.flags);
      let m;
      while ((m = rx.exec(src))) {
        if (accept && accept(m, enclosingBlock(src, m.index))) continue;
        if (theme && m.index >= theme[0] && m.index < theme[1]) continue;
        found.push([src.slice(0, m.index).split('\n').length, m[0].trim().replace(/\s+/g, ' ')]);
      }
      if (found.length) { hits += found.length; inFiles.push([f, found]); }
    }
    return { label, hits, files: inFiles.length, inFiles };
  });
}

/* Only run the CLI when invoked directly — the passes import `sourceFiles`
   and `EXCLUDED` from here, and an import must not print a table. */
const INVOKED_DIRECTLY = process.argv[1] && /ui-audit\.mjs$/.test(process.argv[1]);
if (!INVOKED_DIRECTLY) { /* imported as a library */ } else {

const files = sourceFiles();
const wantFiles = process.argv.includes('--files')
  ? process.argv[process.argv.indexOf('--files') + 1] : null;

const rows = PATTERNS.map(([label, re]) => {
  const r = countIn(files, re);
  return { label, hits: r.hits, code: r.code, files: r.files, inFiles: r.inFiles };
});

if (wantFiles) {
  const row = rows.find((r) => r.label.toLowerCase().includes(wantFiles.toLowerCase()));
  if (!row) { console.error(`no pattern matching "${wantFiles}"`); process.exit(1); }
  console.log(`# ${row.label} — ${row.hits} hits in ${row.files} files`);
  for (const [f, n] of row.inFiles.sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${f}`);
  process.exit(0);
}

const css = cssCounts();

if (process.argv.includes('--css')) {
  console.log(`# stylesheets — ${CSS_FILES.length} files\n`);
  for (const r of css) {
    console.log(`## ${r.label} — ${r.hits} in ${r.files}`);
    for (const [f, found] of r.inFiles) for (const [line, text] of found) {
      console.log(`  ${f}:${line}  ${text.slice(0, 96)}`);
    }
    if (!r.hits) console.log('  (none)');
    console.log('');
  }
  process.exit(0);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    scanned: files.length,
    rows: rows.map(({ label, hits, code, files }) => ({ label, hits, code, files })),
    cssScanned: CSS_FILES.length,
    cssRows: css.map(({ label, hits, files }) => ({ label, hits, files })),
  }, null, 2));
  process.exit(0);
}

console.log(`# plan §7 grep audit — ${files.length} source files in scope\n`);
console.log('| pattern | hits | files | in code |');
console.log('|---|---|---|---|');
for (const r of rows) {
  const note = r.code === r.hits ? `${r.code}` : `**${r.code}**`;
  console.log(`| \`${r.label}\` | ${r.hits} | ${r.files} | ${note} |`);
}
console.log('\n`hits` greps the source text, so it counts a class named in a');
console.log('COMMENT as a live site; `in code` blanks comments first. A bold');
console.log('figure is a row where the two disagree.');

/* The second table. Separate scope, separate denominator, never summed with
   the first — see the header note on why it did not exist until T3. */
console.log(`\n# the stylesheets — ${CSS_FILES.length} files\n`);
console.log('| pattern | hits | files |');
console.log('|---|---|---|');
for (const r of css) console.log(`| \`${r.label}\` | ${r.hits} | ${r.files} |`);
console.log('\n`--css` lists every hit with its line number.');

}
