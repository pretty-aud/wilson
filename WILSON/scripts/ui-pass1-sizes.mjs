#!/usr/bin/env node
/**
 * UI overhaul codemod — PASS 1: SIZES.
 *
 * Every `text-[Npx]` and every `text-xs|sm|base|lg|xl|2xl|3xl` onto one of the
 * seven scale steps, by the role rule in `ui-type-map.mjs`. Nothing else moves:
 * case, weight, family, border, radius and transition are passes 2–5.
 *
 *   node scripts/ui-pass1-sizes.mjs --dry     # report only
 *   node scripts/ui-pass1-sizes.mjs           # write
 *
 * HOW A SITE IS DECIDED — see ui-type-map.mjs for the table and the reasoning.
 * In one line: the class list is the evidence, never the number.
 *
 * THREE MECHANICS THAT ARE EASY TO GET WRONG AND EXPENSIVE TO GET WRONG:
 *
 *  1. **Replace back to front.** `text-[10.5px]` (14 chars) becomes
 *     `text-dense` (10), so every index after it shifts. Every match is
 *     decided against the ORIGINAL source and then applied from the last
 *     offset to the first, so no decision is ever made against a half-edited
 *     file.
 *  2. **Skip protected regions.** Embedded CSS quotes these exact class names
 *     in selectors (`.help-light h3.text-sm { … }`) and comments quote them as
 *     history. Rewriting either is silent damage. See ui-source-regions.mjs.
 *  3. **Leave the newline alone.** This repo has mixed endings
 *     (`core.autocrlf=true`, no `.gitattributes`): `src/index.css` is LF,
 *     some tests are CRLF (F4 trap 5). Reading and writing utf8 without
 *     normalising keeps each file's own endings, so the diff stays the edit.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { sourceFiles } from './ui-audit.mjs';
import { classifySite } from './ui-type-map.mjs';
import { protectedRanges, isProtected } from './ui-source-regions.mjs';
import { enclosingRun, enclosingTag, elementBody, enclosingStyle } from './ui-type-inventory.mjs';

const SIZE = /\btext-(?:\[(\d+(?:\.\d+)?)px\]|(xs|sm|base|lg|xl|[2-9]xl)\b)/g;
const TW = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60, '7xl': 72, '8xl': 96, '9xl': 128 };

/* Already converted by an earlier session and carrying a ruled exception:
   Home is ALL CAPITALS by Audrey's decision (W4) and its label strings are
   pinned by an e2e guard. It is on the scale already (`text-h2`), so there is
   nothing here for this pass to do — the skip is belt and braces. */
const SKIP = [/[\/]Home\.jsx$/];

const DRY = process.argv.includes('--dry');
const files = sourceFiles().filter((f) => !SKIP.some((re) => re.test(f)));

const report = [];
let totalEdits = 0;
const stepTally = new Map();

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const guarded = protectedRanges(src);
  const re = new RegExp(SIZE.source, 'g');
  const edits = [];
  let m;

  while ((m = re.exec(src))) {
    if (isProtected(guarded, m.index)) continue;
    const px = m[1] ? parseFloat(m[1]) : TW[m[2]];
    const run = enclosingRun(src, m.index) || '';
    const tag = enclosingTag(src, m.index);
    const step = classifySite(file, px, run, tag, elementBody(src, m.index), enclosingStyle(src, m.index));
    if (m[0] === step) continue;                       // already there
    edits.push({ start: m.index, end: m.index + m[0].length, from: m[0], to: step });
    stepTally.set(step, (stepTally.get(step) || 0) + 1);
  }

  if (!edits.length) continue;
  let out = src;
  for (const e of edits.reverse()) out = out.slice(0, e.start) + e.to + out.slice(e.end);
  if (!DRY) writeFileSync(file, out, 'utf8');
  report.push([file, edits.length]);
  totalEdits += edits.length;
}

/* ── The one consequence this pass has to clean up after itself ───────────
   `dogHelpContent.jsx` carries D.O.G.'s help page light theme as an embedded
   stylesheet, and three of its selectors name the very classes this pass
   rewrites: `h3.text-sm`, `h4.text-xs` and `.text-xs.text-stone-300`.
   ui-source-regions.mjs correctly refuses to rewrite inside a stylesheet — a
   rewritten selector would not restyle anything, it would just unhook the
   override. But leaving them pointing at classes that no longer exist has the
   same end result: the help page silently loses its light theme.
   So the pass re-points them deliberately, to the steps its own map chose
   (measured across the file: all 15 h3 → text-label, all 47 h4 → text-dense,
   and the .text-stone-300 prose → text-dense). This is the only place in the
   codemod where an edit lands INSIDE a protected region, and it is here
   rather than in a follow-up commit so a clean-tree re-run reproduces it. */
const HELP_CSS = 'src/data/dogHelpContent.jsx';
const HELP_FIXUPS = [
  ['.help-light h3.text-sm {', '.help-light h3.text-label {'],
  ['.help-light h4.text-xs {', '.help-light h4.text-dense {'],
  ['.help-light .text-xs.text-stone-300 {', '.help-light .text-dense.text-stone-300 {'],
];
if (files.includes(HELP_CSS)) {
  let s = readFileSync(HELP_CSS, 'utf8');
  let n = 0;
  for (const [from, to] of HELP_FIXUPS) {
    if (s.includes(from)) { s = s.replace(from, to); n++; }
  }
  if (n && !DRY) writeFileSync(HELP_CSS, s, 'utf8');
  console.log(`help-page light theme: ${n}/3 selectors re-pointed`);
}

report.sort((a, b) => b[1] - a[1]);
console.log(`# pass 1 — sizes${DRY ? ' (dry run)' : ''}`);
console.log(`${totalEdits} sites in ${report.length} files\n`);
console.log('per step: ' + [...stepTally].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}=${n}`).join('  '));
console.log('\n| file | sites |');
console.log('|---|---|');
for (const [f, n] of report) console.log(`| ${f} | ${n} |`);
