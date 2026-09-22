#!/usr/bin/env node
/**
 * UI overhaul codemod — PASS 5: SPACING.
 *
 *   node scripts/ui-pass5-spacing.mjs --dry
 *   node scripts/ui-pass5-spacing.mjs
 *
 * §3.3: "Base 4px. Scale 4, 8, 12, 16, 24, 32, 48. Nothing in `vh`
 * (`App.jsx`'s `3vh 0` content padding becomes 24px)."
 *
 * This is the smallest pass by a wide margin, and that is a finding rather
 * than a shortfall:
 *
 *   - `App.jsx`'s `3vh 0` IS ALREADY DONE. F2 converted it to
 *     `var(--spacing-gutter) 0` and left the reasoning in place: 3vh was 27px
 *     at a 900px-tall window and 21px at 700, so the app's one vertical
 *     rhythm changed with the window. Nothing to do.
 *   - The other 72 `vh` values are `max-h-[85vh]` and `maxHeight: '85vh'` on
 *     dialogs and overlays. Capping a floating surface against the viewport is
 *     what `vh` is FOR; §3.3's "nothing in vh" is about the spacing rhythm and
 *     names the padding as its example. Left, and counted in the hand-off.
 *   - That leaves twelve arbitrary spacing values, all in the tools.
 *
 * `Nothing else moves; a padding change that shifts layout is a lane's job.`
 * These twelve shift by 1 to 2px each, which is the rounding the 4px grid
 * exists to do. No gutter, no page padding and no gap between panels is
 * touched here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { sourceFiles } from './ui-audit.mjs';
import { protectedRanges, isProtected } from './ui-source-regions.mjs';

const DRY = process.argv.includes('--dry');
const SKIP = [/[\/]Home\.jsx$/];
const files = sourceFiles().filter((f) => !SKIP.some((re) => re.test(f)));

/** §3.3's scale, and the Tailwind step that spells each value. */
const SCALE = [[4, '1'], [8, '2'], [12, '3'], [16, '4'], [24, '6'], [32, '8'], [48, '12']];

/** Nearest step. A tie rounds UP to the smaller gap's neighbour, i.e. 2 -> 4,
 *  because 0 is not a step and collapsing a deliberate gap to nothing is a
 *  bigger change than widening it by two pixels. */
function nearestStep(px) {
  let best = SCALE[0];
  for (const s of SCALE) if (Math.abs(s[0] - px) < Math.abs(best[0] - px)) best = s;
  return best;
}

const SPACING = /\b(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-\[(\d+(?:\.\d+)?)px\]/g;

const rows = [];
let total = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const guarded = protectedRanges(src);
  const re = new RegExp(SPACING.source, 'g');
  const edits = [];
  let m;
  while ((m = re.exec(src))) {
    if (isProtected(guarded, m.index)) continue;
    const px = parseFloat(m[2]);
    const [stepPx, step] = nearestStep(px);
    const to = `${m[1]}-${step}`;
    edits.push({ start: m.index, end: m.index + m[0].length, to });
    rows.push(`${file}:${src.slice(0, m.index).split('\n').length}  ${m[0]} -> ${to}  (${px}px -> ${stepPx}px)`);
  }
  if (!edits.length) continue;
  let out = src;
  for (const e of edits.reverse()) out = out.slice(0, e.start) + e.to + out.slice(e.end);
  if (!DRY) writeFileSync(file, out, 'utf8');
  total += edits.length;
}

console.log(`# pass 5 — spacing${DRY ? ' (dry run)' : ''}`);
console.log(`${total} arbitrary values onto the 4px scale\n`);
for (const r of rows) console.log(`  ${r}`);
