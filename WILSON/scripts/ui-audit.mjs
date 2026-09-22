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
  ['uppercase',                      /\buppercase\b/g],
  ['tracking-*',                     /\btracking-(?:wide|wider|widest|tight|tighter)\b/g],
  ['tracking-[…] (arbitrary)',       /\btracking-\[[^\]]+\]/g],
  ['font-bold',                      /\bfont-bold\b/g],
  ['font-medium',                    /\bfont-medium\b/g],
  ['fontWeight 500/700 (inline)',    /fontWeight\s*:\s*['"]?(?:500|700|bold)['"]?/g],
  ['border-2',                       /\bborder-2\b/g],
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

function countIn(files, re) {
  let hits = 0; const inFiles = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const m = src.match(new RegExp(re.source, re.flags));
    if (m && m.length) { hits += m.length; inFiles.push([f, m.length]); }
  }
  return { hits, files: inFiles.length, inFiles };
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
  return src.slice(start);
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
     T0's pass 4 judged the 102 class-based side borders and left 38. */
  ['border >= 2px', /\bborder(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-width)?\s*:\s*[^;{}]*?\b(?:[2-9]|[1-9]\d+)px/g],
  /* §3.3: two radii, 3px and 6px, both behind tokens. `0` is not a radius and
     `9999px` / `50%` are §6's `rounded-full`, which the plan's deletion list
     ("2, 4, 5, 8, 10px") does not name. */
  ['border-radius off the two', /\bborder-radius\s*:\s*([^;{}]+)/g,
    (m) => /var\(--radius-(?:control|float)\)/.test(m[1]) || /^\s*0(?:px)?\s*$/.test(m[1]) || /9999px|50%/.test(m[1])],
  /* §3.1: two weights, 400 and 600. The faces are declared `font-weight:
     400 600`, so a 700 CLAMPS to 600 — it renders identically and the source
     claims a weight the system does not have. */
  ['font-weight 500/700/bold', /\bfont-weight\s*:\s*(?:500|700|bold)\b/g],
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
export function cssCounts(files = CSS_FILES) {
  return CSS_PATTERNS.map(([label, re, accept]) => {
    let hits = 0; const inFiles = [];
    for (const f of files) {
      const raw = readFileSync(f, 'utf8');
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
  return { label, hits: r.hits, files: r.files, inFiles: r.inFiles };
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
    rows: rows.map(({ label, hits, files }) => ({ label, hits, files })),
    cssScanned: CSS_FILES.length,
    cssRows: css.map(({ label, hits, files }) => ({ label, hits, files })),
  }, null, 2));
  process.exit(0);
}

console.log(`# plan §7 grep audit — ${files.length} source files in scope\n`);
console.log('| pattern | hits | files |');
console.log('|---|---|---|');
for (const r of rows) console.log(`| \`${r.label}\` | ${r.hits} | ${r.files} |`);

/* The second table. Separate scope, separate denominator, never summed with
   the first — see the header note on why it did not exist until T3. */
console.log(`\n# the stylesheets — ${CSS_FILES.length} files\n`);
console.log('| pattern | hits | files |');
console.log('|---|---|---|');
for (const r of css) console.log(`| \`${r.label}\` | ${r.hits} | ${r.files} |`);
console.log('\n`--css` lists every hit with its line number.');

}
