#!/usr/bin/env node
/**
 * UI overhaul — the type inventory that the codemod's map is argued from.
 *
 * WHY THIS EXISTS. C3b mapped sizes by NUMBER and put 52 sites of body copy on
 * the 11px Label step; C3c spent a whole session undoing it. The lesson, in one
 * line: **map by role, and the class list is the evidence.** This script is how
 * you see the evidence before you write the map, and how a reviewer re-reads it
 * without trusting the codemod's own report.
 *
 * The one signal that is never a judgment call: a site whose class list already
 * carries `uppercase` or `tracking-*` IS a label. Everything else is running
 * text or data and can never land on the Label step.
 *
 * Usage:
 *   node scripts/ui-type-inventory.mjs summary
 *   node scripts/ui-type-inventory.mjs sample <px> <label|plain> [n]
 *   node scripts/ui-type-inventory.mjs files <px>
 *   node scripts/ui-type-inventory.mjs bucket <label|caption|dense|body|h3|h2|h1> [n]
 */
import { readFileSync } from 'node:fs';
import { sourceFiles } from './ui-audit.mjs';
import { classifySite, LABEL_EVIDENCE } from './ui-type-map.mjs';
import { protectedRanges, isProtected } from './ui-source-regions.mjs';

/* NOTE the boundary placement. `/…\]\b/` does NOT match `text-[12px]"` — `]`
   and `"` are both non-word, so there is no boundary between them and the
   whole arbitrary-size arm silently matches nothing. The `\b` belongs on the
   named arm only. This cost one confused inventory run; it would have cost a
   whole silent pass. */
const SIZE = /\btext-(?:\[(\d+(?:\.\d+)?)px\]|(xs|sm|base|lg|xl|2xl|3xl)\b)/g;
const TW = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30 };
const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);

/* The class list a size token sits in is the quoted run containing it: a
   string literal, a template chunk, or one arm of a ternary. Walking back to
   the nearest unescaped quote gets that run without parsing JSX. */
export function enclosingRun(src, idx) {
  const opens = ['"', "'", '`'];
  let start = -1, q = null;
  for (let i = idx; i >= 0 && idx - i < 4000; i--) {
    if (opens.includes(src[i]) && src[i - 1] !== BS) { q = src[i]; start = i; break; }
  }
  if (start < 0) return null;
  let end = src.indexOf(q, idx);
  if (end < 0) end = idx + 200;
  return src.slice(start + 1, end);
}

/* The JSX tag a className sits on: walk back to the nearest `<Word`. A `<`
   inside an attribute value would fool this, but a `<` inside a className run
   does not occur, and the worst case is an extra `div` — which decides
   nothing, because `div` is in neither the heading nor the dense tag set. */
export function enclosingTag(src, idx) {
  for (let i = idx; i >= 0 && idx - i < 2000; i--) {
    if (src[i] === '<' && /[A-Za-z]/.test(src[i + 1] || '')) {
      const m = /^<([A-Za-z][\w.-]*)/.exec(src.slice(i, i + 40));
      return m ? m[1].toLowerCase() : '';
    }
  }
  return '';
}

export function collectSites(files = sourceFiles()) {
  const rows = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const guarded = protectedRanges(src);
    const re = new RegExp(SIZE.source, 'g');
    let m;
    while ((m = re.exec(src))) {
      if (isProtected(guarded, m.index)) continue;
      const px = m[1] ? parseFloat(m[1]) : TW[m[2]];
      const run = enclosingRun(src, m.index) || '';
      const tag = enclosingTag(src, m.index);
      const line = src.slice(0, m.index).split(NL).length;
      rows.push({ f, line, token: m[0], px, run, tag, step: classifySite(f, px, run, tag) });
    }
  }
  return rows;
}

const isLabel = (r) => LABEL_EVIDENCE.some((re) => re.test(r.run));

const INVOKED = process.argv[1] && /ui-type-inventory\.mjs$/.test(process.argv[1]);
if (INVOKED) {
  const rows = collectSites();
  const mode = process.argv[2] || 'summary';

  if (mode === 'summary') {
    const byPx = new Map();
    for (const r of rows) {
      if (!byPx.has(r.px)) byPx.set(r.px, { px: r.px, total: 0, label: 0, plain: 0, steps: new Map() });
      const b = byPx.get(r.px);
      b.total++;
      if (isLabel(r)) b.label++; else b.plain++;
      b.steps.set(r.step, (b.steps.get(r.step) || 0) + 1);
    }
    console.log('| px | sites | label-evidence | plain | resolves to |');
    console.log('|---|---|---|---|---|');
    for (const b of [...byPx.values()].sort((a, c) => a.px - c.px)) {
      const steps = [...b.steps].sort((a, c) => c[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ');
      console.log(`| ${b.px} | ${b.total} | ${b.label} | ${b.plain} | ${steps} |`);
    }
    const byStep = new Map();
    for (const r of rows) byStep.set(r.step, (byStep.get(r.step) || 0) + 1);
    console.log(`${NL}total sites: ${rows.length}`);
    console.log('per step: ' + [...byStep].sort((a, c) => c[1] - a[1]).map(([s, n]) => `${s}=${n}`).join('  '));
  } else if (mode === 'sample') {
    const px = parseFloat(process.argv[3]);
    const want = process.argv[4] || 'plain';
    const n = parseInt(process.argv[5] || '30', 10);
    const pool = rows.filter((r) => r.px === px && (want === 'label' ? isLabel(r) : !isLabel(r)));
    console.log(`# ${px}px ${want}: ${pool.length} sites, showing up to ${n} spread across the pool`);
    const step = Math.max(1, Math.floor(pool.length / n));
    for (let i = 0, shown = 0; i < pool.length && shown < n; i += step, shown++) {
      const r = pool[i];
      console.log(`${r.f}:${r.line}  -> ${r.step}`);
      console.log('    ' + r.run.replace(/\s+/g, ' ').slice(0, 200));
    }
  } else if (mode === 'bucket') {
    const want = process.argv[3];
    const n = parseInt(process.argv[4] || '30', 10);
    const pool = rows.filter((r) => r.step === `text-${want}`);
    console.log(`# text-${want}: ${pool.length} sites, showing up to ${n} spread across the pool`);
    const step = Math.max(1, Math.floor(pool.length / n));
    for (let i = 0, shown = 0; i < pool.length && shown < n; i += step, shown++) {
      const r = pool[i];
      console.log(`${r.f}:${r.line}  (${r.px}px)`);
      console.log('    ' + r.run.replace(/\s+/g, ' ').slice(0, 200));
    }
  } else if (mode === 'files') {
    const px = parseFloat(process.argv[3]);
    const c = new Map();
    for (const r of rows.filter((r) => r.px === px)) c.set(r.f, (c.get(r.f) || 0) + 1);
    for (const [f, n] of [...c].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), f);
  }
}
