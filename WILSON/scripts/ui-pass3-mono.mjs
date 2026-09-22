#!/usr/bin/env node
/**
 * UI overhaul codemod — PASS 3: FONT-MONO.
 *
 *   node scripts/ui-pass3-mono.mjs --dry
 *   node scripts/ui-pass3-mono.mjs --sample keep [n]
 *   node scripts/ui-pass3-mono.mjs --sample drop [n]
 *   node scripts/ui-pass3-mono.mjs
 *
 * Deletes `font-mono` where the content is not data. The map and the argument
 * for every pattern are in `ui-mono-map.mjs`; this file is the mechanism.
 *
 * A numeric cell that keeps mono also takes `tabular-nums` (§3.1: "Numerics in
 * tables use font-variant-numeric: tabular-nums, right alignment, and the mono
 * at --mono-size-adjust"), so a kept numeric site gains that class if it does
 * not already carry it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { sourceFiles } from './ui-audit.mjs';
import { protectedRanges, isProtected } from './ui-source-regions.mjs';
import { enclosingRun, enclosingTag } from './ui-type-inventory.mjs';
import { classifyMono } from './ui-mono-map.mjs';

const DRY = process.argv.includes('--dry');
const SAMPLE = process.argv.includes('--sample') ? process.argv[process.argv.indexOf('--sample') + 1] : null;
const SAMPLE_N = parseInt(process.argv[process.argv.indexOf('--sample') + 2] || '30', 10);
const SKIP = [/[\/]Home\.jsx$/];
const files = sourceFiles().filter((f) => !SKIP.some((re) => re.test(f)));

/**
 * What the element renders, as evidence.
 *
 * 🚨 NOT just the direct text. A money column is written as a wrapper that
 * carries the alignment and the family, with the figure in a child:
 *
 *   <div className="… text-dense font-mono text-right …">
 *     <span …>{fmtCurrency(row.rate, currency)}</span>
 *   </div>
 *
 * Reading only up to the next `<` gives the empty string for that div, and an
 * empty string has no data evidence, so R.A.B.B.I.T.'s rate column would have
 * lost its mono AND its figures would never have been recognised as figures.
 * So the window reaches into the subtree, with the markup and the attribute
 * noise stripped, leaving the text and the `{…}` expressions — which is all
 * the map ever asks about.
 */
function elementBody(src, idx) {
  const after = src.slice(idx, idx + 1600);
  const gt = after.indexOf('>');
  if (gt < 0) return '';
  let s = after.slice(gt + 1, gt + 1 + 420);
  s = s.replace(/className=(?:"[^"]*"|\{[^}]*\})/g, ' ');
  s = s.replace(/style=\{\{[^}]*\}\}/g, ' ');
  s = s.replace(/<[^>]*>/g, ' ');
  return s.trim().replace(/\s+/g, ' ').slice(0, 260);
}

const sites = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const guarded = protectedRanges(src);
  const re = /\bfont-mono\b/g;
  let m;
  while ((m = re.exec(src))) {
    if (isProtected(guarded, m.index)) continue;
    const run = enclosingRun(src, m.index) || '';
    const tag = enclosingTag(src, m.index);
    const body = elementBody(src, m.index);
    const verdict = classifyMono({ tag, run, body });
    sites.push({ file, start: m.index, end: m.index + m[0].length, run, tag, body, ...verdict,
      line: src.slice(0, m.index).split('\n').length });
  }
}

if (SAMPLE) {
  const want = SAMPLE === 'keep';
  const pool = sites.filter((s) => s.keep === want);
  console.log(`# font-mono ${SAMPLE}: ${pool.length} sites, showing up to ${SAMPLE_N}`);
  const step = Math.max(1, Math.floor(pool.length / SAMPLE_N));
  for (let i = 0, n = 0; i < pool.length && n < SAMPLE_N; i += step, n++) {
    const s = pool[i];
    console.log(`<${s.tag}> ${s.file}:${s.line}  — ${s.why}`);
    console.log(`     body: ${s.body.slice(0, 96)}`);
  }
  process.exit(0);
}

/* Apply: delete the class on a drop; add `tabular-nums` on a kept numeric that
   does not carry it. Back to front, so no index shifts under a later edit. */
const byFile = new Map();
for (const s of sites) {
  if (!byFile.has(s.file)) byFile.set(s.file, []);
  byFile.get(s.file).push(s);
}

const tally = new Map();
const bump = (k) => tally.set(k, (tally.get(k) || 0) + 1);
let dropped = 0, kept = 0, numerics = 0;
const report = [];

for (const [file, list] of byFile) {
  let out = readFileSync(file, 'utf8');
  const edits = [];
  for (const s of list) {
    bump(`${s.keep ? 'keep' : 'drop'} — ${s.why}`);
    if (s.keep) {
      kept++;
      /* §3.1's numeric-cell clause: figures in tables line up or they are not
         a column. Only for figures, never for an id or a path. */
      const isFigure = /\b(?:count|total|totals|subtotal|sum|amount|price|cost|rate|budget|qty|quantity|size|bytes|pct|percent)\b/i.test(s.body)
        && !/\btabular-nums\b/.test(s.run);
      if (isFigure) { edits.push({ start: s.end, end: s.end, to: ' tabular-nums' }); numerics++; }
      continue;
    }
    dropped++;
    edits.push({ start: s.start, end: s.end, to: null });
  }
  if (!edits.length) continue;
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) {
    if (e.to !== null) { out = out.slice(0, e.start) + e.to + out.slice(e.end); continue; }
    let a = e.start, b = e.end;
    if (out[a - 1] === ' ') a -= 1;
    else if (out[b] === ' ') b += 1;
    out = out.slice(0, a) + out.slice(b);
  }
  if (!DRY) writeFileSync(file, out, 'utf8');
  report.push([file, edits.length]);
}

report.sort((a, b) => b[1] - a[1]);
console.log(`# pass 3 — font-mono${DRY ? ' (dry run)' : ''}`);
console.log(`${sites.length} sites: ${dropped} dropped, ${kept} kept (${numerics} gained tabular-nums)\n`);
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log('\n| file | edits |');
console.log('|---|---|');
for (const [f, n] of report.slice(0, 20)) console.log(`| ${f} | ${n} |`);
