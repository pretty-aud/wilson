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
 *              separately below, never mixed into the JSX columns.
 *
 * Usage:  node scripts/ui-audit.mjs            # human table
 *         node scripts/ui-audit.mjs --json     # machine readable
 *         node scripts/ui-audit.mjs --files X  # list the files for pattern X
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
  ['text-xs…3xl (Tailwind sizes)',   /\btext-(?:xs|sm|base|lg|xl|2xl|3xl)\b/g],
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

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ scanned: files.length, rows: rows.map(({ label, hits, files }) => ({ label, hits, files })) }, null, 2));
  process.exit(0);
}

console.log(`# plan §7 grep audit — ${files.length} source files in scope\n`);
console.log('| pattern | hits | files |');
console.log('|---|---|---|');
for (const r of rows) console.log(`| \`${r.label}\` | ${r.hits} | ${r.files} |`);

}
