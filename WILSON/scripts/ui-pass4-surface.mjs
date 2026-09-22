#!/usr/bin/env node
/**
 * UI overhaul codemod — PASS 4: BORDER, RADIUS, TRANSITION, GROUNDS.
 *
 *   node scripts/ui-pass4-surface.mjs --dry
 *   node scripts/ui-pass4-surface.mjs
 *
 * §3.3: "Border 1px hairline from the `rule` token, everywhere except inside
 * LayoutVisualizer. Radius 3px controls / 6px floating / full for dots and the
 * Switch (Q5). 2, 4, 5, 8, 10px are deleted."
 * §3.4: "`transition-all` is retired for named properties."
 * C9: no white or near-white surface.
 *
 * WHAT MOVES
 *   border-2        -> border            (2px becomes the 1px hairline)
 *   rounded         -> rounded-control   (4px is on the deletion list)
 *   rounded-sm      -> rounded-control   (2px is on the deletion list)
 *   rounded-md/lg   -> rounded-float on a floating surface, else -control
 *   transition-all  -> the properties the site actually animates
 *   bg-white/40     -> bg-well-light     (C9)
 *
 * WHAT DOES NOT, AND WHY — each of these is a decision, not an oversight:
 *
 *   `rounded-full`, 48 sites. The plan's deletion list is "2, 4, 5, 8, 10px";
 *   `rounded-full` is not on it, and the sites are not radii — they are dots
 *   (`w-1.5 h-1.5`), avatars (`w-16 h-16 object-cover`), icon circles and
 *   pill progress tracks. Turning a circular avatar into a 3px-cornered
 *   square is a view change (C1), not a token swap.
 *
 *   `rounded-t/b/l/r-*`, 4 sites. A single-corner radius is doing a layout
 *   job (a tab meeting its panel, a bar meeting its rail). Listed, not
 *   guessed at.
 *
 *   BORDER COLOUR. `border-2 border-stone-600` becomes `border
 *   border-stone-600`. The WIDTH is §3.3 and is T0's; the COLOUR is §3.2's
 *   ink ladder and belongs to the lane that owns the surface, because
 *   `border-stone-600` sits next to inline `style={{ border: '1px solid
 *   #44403c' }}` on the same elements and the two have to move together.
 *
 *   `opacity-30/40/50` AS A DISABLED STATE, 94 sites. Measured before
 *   deciding: of the 89 that carry a `disabled:` prefix, 58 also carry a
 *   `bg-*` class and 32 have an inline `backgroundColor` within 400 characters
 *   — only FOUR are a clean swap. The kit's disabled is not one class, it is
 *   three declarations (`color: ink-3`, `background-color: transparent`,
 *   `border-color: rule`), and an inline background beats every one of them.
 *   Swapping opacity for a dim ink on a control that keeps its full-strength
 *   orange fill produces a disabled button that looks enabled, which is worse
 *   than the defect. The brief's own instruction is "the disabled token if the
 *   site is unambiguous, otherwise listed for the lanes"; the measurement says
 *   these are not unambiguous. All 94 are listed in the hand-off.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { sourceFiles } from './ui-audit.mjs';
import { protectedRanges, isProtected } from './ui-source-regions.mjs';
import { enclosingRun } from './ui-type-inventory.mjs';

const DRY = process.argv.includes('--dry');
const SKIP = [/[\/]Home\.jsx$/];
const files = sourceFiles().filter((f) => !SKIP.some((re) => re.test(f)));

/** A surface that floats above the page takes the 6px radius. */
const FLOATING_FILE = /(?:Dialog|Modal|Menu|Popup|Popover|Toast|Drawer|Sheet|Tooltip)/i;
const FLOATING_RUN = /\b(?:fixed|absolute)\b/;
const FLOATING_HINT = /\b(?:shadow-|z-\[?\d)/;

/**
 * What a `transition-all` site actually animates. Read off the class list,
 * because that is where the author said what changes on hover or on state.
 * Order matters: the most specific evidence first.
 */
function namedTransition(run) {
  if (/\bring-/.test(run)) return 'transition-shadow';          // a ring IS a box-shadow
  if (/\bbrightness-/.test(run)) return 'transition-[filter]';
  if (/\b(?:scale|translate|rotate)-/.test(run)) return 'transition-transform';
  if (/\btop-\[|\bleft-\[/.test(run) && FLOATING_RUN.test(run)) return 'transition-[left]';
  // A full-height bar with no hover state is a progress track: it animates width.
  if (/\bh-full\b/.test(run) && !/hover:/.test(run)) return 'transition-[width]';
  if (/opacity/.test(run)) return 'transition-[color,background-color,border-color,opacity]';
  return 'transition-colors';
}

const EDITS = [
  { name: 'border-2 -> border (the 1px hairline)', re: /\bborder-2\b/g, to: () => 'border' },
  { name: 'rounded-sm -> rounded-control', re: /\brounded-sm\b/g, to: () => 'rounded-control' },
  { name: 'rounded (bare 4px) -> rounded-control', re: /\brounded(?![-\w])/g, to: () => 'rounded-control' },
  {
    name: 'rounded-md/lg -> control or float',
    re: /\brounded-(?:md|lg)\b/g,
    to: (run, file) => (FLOATING_FILE.test(file) || (FLOATING_RUN.test(run) && FLOATING_HINT.test(run))
      ? 'rounded-float' : 'rounded-control'),
  },
  { name: 'transition-all -> named properties', re: /\btransition-all\b/g, to: (run) => namedTransition(run) },
  /* 🚨 `well-light` IS A LIGHT-GROUND TOKEN: rgba(120,70,30,0.18), a warm
     screen designed to read as a raised well on `#f4a261`. On the dark paper
     it flattens to a muddy nothing.
     Two of the three `bg-white/*` sites are the Help page's cards, and those
     are exactly what C9 names ("every `bg-white/40` card"). The third is
     `border-white bg-white/20` on a checkbox indicator inside O.T.T.E.R., on
     the DARK surface — a selected-state fill, not a ground, and `well-light`
     there would make the selection invisible. So the swap is gated on the
     light surface and the third site is listed for the lane that owns it. */
  {
    name: 'bg-white/NN -> bg-well-light (C9, light ground only)',
    re: /\bbg-white\/\d+\b/g,
    to: (run, file) => (/HelpContent\.jsx$/.test(file) ? 'bg-well-light' : null),
  },
];

const tally = new Map();
const report = [];
let total = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const guarded = protectedRanges(src);
  const edits = [];

  for (const spec of EDITS) {
    const re = new RegExp(spec.re.source, 'g');
    let m;
    while ((m = re.exec(src))) {
      if (isProtected(guarded, m.index)) continue;
      const run = enclosingRun(src, m.index) || '';
      const to = spec.to(run, file);
      if (to === null) { tally.set(`LEFT — ${spec.name}`, (tally.get(`LEFT — ${spec.name}`) || 0) + 1); continue; }
      if (to === m[0]) continue;
      edits.push({ start: m.index, end: m.index + m[0].length, to });
      tally.set(`${spec.name} [${to}]`, (tally.get(`${spec.name} [${to}]`) || 0) + 1);
    }
  }

  if (!edits.length) continue;
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.to + out.slice(e.end);
  if (!DRY) writeFileSync(file, out, 'utf8');
  report.push([file, edits.length]);
  total += edits.length;
}

report.sort((a, b) => b[1] - a[1]);
console.log(`# pass 4 — border, radius, transition, grounds${DRY ? ' (dry run)' : ''}`);
console.log(`${total} edits in ${report.length} files\n`);
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log('\n| file | edits |');
console.log('|---|---|');
for (const [f, n] of report.slice(0, 15)) console.log(`| ${f} | ${n} |`);
