#!/usr/bin/env node
/**
 * UI overhaul codemod — PASS 2: CASE AND WEIGHT.
 *
 *   node scripts/ui-pass2-case-weight.mjs --dry
 *   node scripts/ui-pass2-case-weight.mjs
 *
 * §3.1: "Uppercase appears only in the Label step and the transition title,
 * both tracked; everything else is sentence case with zero tracking." Q2 adds
 * Home. The scale has two weights, 400 and 600.
 *
 * THE RULE IS NOW TRIVIAL, BECAUSE PASS 1 ALREADY MADE THE JUDGMENT.
 * A site keeps its `uppercase` if and only if its class list carries
 * `text-label`. Pass 1 decided which sites those are, by role, with the
 * evidence written down; pass 2 does not re-litigate it. That is the whole
 * reason the passes are separate and in this order.
 *
 * What moves:
 *   uppercase        removed unless the run is on `text-label`
 *   tracking-wide…   removed everywhere; the Label token supplies its own
 *                    0.06em, so a tracked label needs no class
 *   font-bold        -> font-semibold (700 is not on the scale)
 *   font-medium      removed on a 400 step, -> font-semibold on a 600 step
 *                    (500 renders as a real third weight inside a 400–600 axis)
 *
 * What deliberately does NOT move:
 *   - `tracking-[…]` with an arbitrary value. Three sites: two are Home's
 *     ruled ALL-CAPITALS exception (W4) and one is the operator console's
 *     one-time-code input, where 0.4em is spacing out digits for reading and
 *     is functional, not decoration.
 *   - Inline `textTransform: 'uppercase'`. Sixteen sites, and one of them is
 *     the page-transition title, which C2 freezes. These are style objects,
 *     not class lists; they are T1–T3's residue and are counted in the
 *     hand-off.
 *   - Home.jsx, entirely. Audrey ruled Home ALL CAPITALS and an e2e guard
 *     pins its label strings.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { sourceFiles } from './ui-audit.mjs';
import { protectedRanges, isProtected } from './ui-source-regions.mjs';
import { enclosingRun, enclosingTag } from './ui-type-inventory.mjs';
import { CONTROL_TAGS } from './ui-type-map.mjs';

const DRY = process.argv.includes('--dry');
const SKIP = [/[\/]Home\.jsx$/];
const files = sourceFiles().filter((f) => !SKIP.some((re) => re.test(f)));

const SIX_HUNDRED_STEPS = /\btext-(?:h1|h2|h3|label)\b/;
const ANY_STEP = /\btext-(?:h1|h2|h3|body|dense|caption|label)\b/;

/* Every token this pass touches, in one scan. */
const TOKENS = /\b(uppercase|tracking-(?:wide|wider|widest|tight|tighter)|font-bold|font-medium)\b/g;

const tally = new Map();
const bump = (k) => tally.set(k, (tally.get(k) || 0) + 1);
const report = [];
const steplessUpper = [];
let total = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const guarded = protectedRanges(src);
  const re = new RegExp(TOKENS.source, 'g');
  const edits = [];
  let m;

  while ((m = re.exec(src))) {
    if (isProtected(guarded, m.index)) continue;
    const tok = m[1];

    /* An inline style object is not a class list. `textTransform: 'uppercase'`
       is sixteen sites including the frozen transition title (C2). */
    if (tok === 'uppercase') {
      const before = src.slice(Math.max(0, m.index - 30), m.index);
      if (/textTransform\s*:\s*['"]?\s*$/.test(before)) continue;
    }

    const run = enclosingRun(src, m.index) || '';
    const tag = enclosingTag(src, m.index);
    let to = null;                                   // null = delete the token

    /* A label that inherits its size from a parent: `uppercase tracking-widest`
       with no step in the run. Eleven sites, all eyebrows.
       LEFT WHOLE, both tokens. Giving it a step would be ADDING a class, not
       swapping one — an inherited size becoming 11px is a layout decision and
       a lane's call, not a token diff's. And stripping the tracking while
       keeping the capitals would be the worst of the three options: untracked
       capitals are exactly what §3.1 is trying to get rid of. */
    const steplessLabel = /\buppercase\b/.test(run) && !ANY_STEP.test(run) && !CONTROL_TAGS.test(tag);

    if (tok === 'uppercase') {
      if (/\btext-label\b/.test(run)) { bump('uppercase kept (Label)'); continue; }
      if (steplessLabel) {
        steplessUpper.push(`${file}:${src.slice(0, m.index).split('\n').length}  [${run.replace(/\s+/g, ' ').slice(0, 80)}]`);
        bump('uppercase left (no step in run)');
        continue;
      }
      bump('uppercase removed');
    } else if (tok.startsWith('tracking-')) {
      if (steplessLabel) { bump('tracking left (stays with its capitals)'); continue; }
      bump('tracking removed');
    } else if (tok === 'font-bold') {
      to = 'font-semibold';
      bump('font-bold -> font-semibold');
    } else if (tok === 'font-medium') {
      if (SIX_HUNDRED_STEPS.test(run)) { to = 'font-semibold'; bump('font-medium -> font-semibold'); }
      else bump('font-medium removed (step supplies 400)');
    }

    edits.push({ start: m.index, end: m.index + tok.length, to });
  }

  if (!edits.length) continue;
  let out = src;
  for (const e of edits.reverse()) {
    if (e.to) { out = out.slice(0, e.start) + e.to + out.slice(e.end); continue; }
    /* Delete the token and exactly one adjacent space, so `a uppercase b`
       becomes `a b` and never `a  b`. Prefer the leading space; fall back to
       the trailing one for a token that opens the run. */
    let s = e.start, t = e.end;
    if (out[s - 1] === ' ') s -= 1;
    else if (out[t] === ' ') t += 1;
    out = out.slice(0, s) + out.slice(t);
  }
  if (!DRY) writeFileSync(file, out, 'utf8');
  report.push([file, edits.length]);
  total += edits.length;
}

report.sort((a, b) => b[1] - a[1]);
console.log(`# pass 2 — case and weight${DRY ? ' (dry run)' : ''}`);
console.log(`${total} edits in ${report.length} files\n`);
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
if (steplessUpper.length) {
  console.log(`\n${steplessUpper.length} uppercase sites left alone (label with no step in its run):`);
  for (const s of steplessUpper) console.log(`  ${s}`);
}
console.log('\n| file | edits |');
console.log('|---|---|');
for (const [f, n] of report.slice(0, 25)) console.log(`| ${f} | ${n} |`);
