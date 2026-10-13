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
/* `[2-9]xl`, not `2xl|3xl`: Tailwind goes to 9xl and this codebase reaches
   `text-5xl` and `text-6xl` — a quiz score and a lesson count, both display
   figures. A three-value alternation looked complete and was not. */
const SIZE = /\btext-(?:\[(\d+(?:\.\d+)?)px\]|(xs|sm|base|lg|xl|[2-9]xl)\b)/g;
const TW = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60, '7xl': 72, '8xl': 96, '9xl': 128 };
const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);

/* The class list a size token sits in is the quoted run containing it: a
   string literal, a template chunk, or one arm of a ternary. Walking back to
   the nearest unescaped quote gets that run without parsing JSX.
 *
 * 🚨 WITH ONE CORRECTION. In a template literal the nearest quote is often an
 * interpolation's own — `${small ? 'px-2 py-1 text-dense' : '…'} font-mono
 * uppercase` walks back into the ternary arm and returns `px-2 py-1
 * text-dense`, which hides the `uppercase` sitting outside it. The whole
 * template is the class list, so when the position is inside one, that is
 * what gets returned. Measured: 18 step tokens sit inside an interpolation
 * and 4 had an `uppercase` hidden this way, all in binUi.jsx. */
export function enclosingRun(src, idx) {
  const tpl = enclosingTemplate(src, idx);
  if (tpl) return stripConditionalArms(tpl, idx, src);
  const opens = ['"', "'", '`'];
  let start = -1, q = null;
  for (let i = idx; i >= 0 && idx - i < 4000; i--) {
    if (opens.includes(src[i]) && src[i - 1] !== BS) { q = src[i]; start = i; break; }
  }
  if (start < 0) return null;
  let end = src.indexOf(q, idx);
  if (end < 0) end = idx + 200;
  const run = src.slice(start + 1, end);
  /* A token BEFORE the template's first `${` reaches here rather than through
     `enclosingTemplate`, and it needs the same treatment: the run still spans
     every conditional arm. This is the path R.A.B.B.I.T.'s Gantt bar label
     takes — `text-[10.5px] truncate … ${phase ? '… uppercase' : ''}` — and
     without this it is still judged by a class only phase bars ever get. */
  if (q === String.fromCharCode(96)) {
    return run.replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' ');
  }
  return run;
}

/**
 * The run with the conditional arms LEFT IN.
 *
 * Two different questions want two different runs, and conflating them broke a
 * Bins badge. "What ROLE is this site?" must ignore a class only one branch
 * ever gets (the Gantt bar). "Does this site carry a step at all?" must see
 * every branch, because `${small ? 'px-1 text-label' : 'px-1.5 text-label'}`
 * genuinely does carry one — and pass 2 reading the stripped run concluded the
 * badge had no step, filed it as an inherited eyebrow, and left its tracking
 * on. Pass 1 asks the first question; pass 2 and the guard ask the second.
 */
export function enclosingRunRaw(src, idx) {
  /* The template FIRST. A token inside a ternary arm has a `'` as its nearest
     quote, so a quote-walk returns the arm alone — which is how the Bins badge
     reported as a case-less label: its `text-label` is in the arm and its
     `uppercase` is in the template around it. */
  const tpl = enclosingTemplate(src, idx);
  if (tpl) return tpl;
  const BT = String.fromCharCode(96);
  const opens = ['"', "'", BT];
  let start = -1, q = null;
  for (let i = idx; i >= 0 && idx - i < 4000; i--) {
    if (opens.includes(src[i]) && src[i - 1] !== BS) { q = src[i]; start = i; break; }
  }
  if (start < 0) return '';
  let end = src.indexOf(q, idx);
  if (end < 0) end = idx + 200;
  return src.slice(start + 1, end);
}

/**
 * Widening the run to the whole template literal fixes one problem and creates
 * another: a class that applies to only ONE BRANCH of a ternary then decides
 * the site for every branch.
 *
 *   `text-[10.5px] ${subgroup ? 'font-bold' : (phase ? 'font-bold uppercase' : '')}`
 *
 * That is R.A.B.B.I.T.'s Gantt bar label. Only a PHASE bar was ever uppercase,
 * but the widened run saw `uppercase` and put every TASK bar's name — a name,
 * truncated inside a fixed-width bar — on the Label step, with 600 weight and
 * 0.06em of tracking it never had, fitting fewer characters before the
 * ellipsis. Two sites, both real.
 *
 * So: when the token being classified sits OUTSIDE every `${…}`, the
 * interpolations are conditional and their classes are not evidence about it.
 * When the token is inside one, the whole template is the right context — which
 * is the binUi case the widening was written for, and it still works.
 */
function stripConditionalArms(tpl, idx, src) {
  const TICK = String.fromCharCode(96);
  const back = src.slice(Math.max(0, idx - 4000), idx);
  const tick = back.lastIndexOf(TICK);
  const start = Math.max(0, idx - 4000) + tick + 1;
  const offset = idx - start;                       // where the token sits in tpl
  let depth = 0, inInterp = false;
  for (let i = 0; i < tpl.length && i <= offset; i++) {
    if (tpl[i] === '$' && tpl[i + 1] === '{') { depth++; i++; continue; }
    if (depth > 0 && tpl[i] === '}') { depth--; continue; }
    if (i === offset) inInterp = depth > 0;
  }
  if (inInterp) return tpl;                         // classify with full context
  return tpl.replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' ');
}

/** The full body of the template literal containing `idx`, or null. */
function enclosingTemplate(src, idx) {
  const TICK = String.fromCharCode(96);
  const back = src.slice(Math.max(0, idx - 4000), idx);
  const tick = back.lastIndexOf(TICK);
  if (tick < 0) return null;
  const interp = back.lastIndexOf('${');
  if (interp < tick) return null;             // not inside an interpolation
  const start = Math.max(0, idx - 4000) + tick;
  let end = src.indexOf(TICK, idx);
  if (end < 0) end = Math.min(src.length, idx + 600);
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

/**
 * The element's own inline `style={{…}}`, as a string.
 *
 * `META_INK` is a class-list rule, so the Caption step was unreachable
 * anywhere the ink is written inline — and R.A.B.B.I.T. and the operator
 * console write `style={{ color: '#78716c' }}` where D.O.G. writes
 * `text-stone-500`. 92 sites fell through to Dense while their own opening tag
 * set the muted ink, with the result that **not one Caption site existed
 * anywhere in R.A.B.B.I.T.**: a seven-step scale shipping as six on the
 * largest surface.
 */
export function enclosingStyle(src, idx) {
  const around = src.slice(Math.max(0, idx - 400), idx + 400);
  const m = /style=\{\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\}/.exec(around);
  return m ? m[0] : '';
}

/**
 * What an element renders, as evidence: its text, plus every `{…}` expression
 * in its subtree INCLUDING its children's props.
 *
 * 🚨 THREE ATTEMPTS, AND THE FIRST TWO EACH BROKE R.A.B.B.I.T.'S MONEY.
 *
 *  1. Text up to the next `<` — empty for a wrapper, so every money column
 *     (wrapper carries the family, child carries the figure) lost its mono.
 *  2. A fixed 420-character window — runs past the element into the next
 *     block, so one of three sibling UNC paths saw a later `{probeSummary …}`
 *     and "summary" is on the prose list.
 *  3. Stop at the first `</` — stops at the first CHILD's close, so
 *     `<div …><span>{row.name}</span><span>{row.cost}</span></div>` is judged
 *     on the name column alone, and the whole Breakdown table went sans. And
 *     `<CurrencyDisplay value={baseCost} />` is self-closing: stripping tags
 *     wholesale erased the only expression there was.
 *
 * So: walk to the element's MATCHING close, keep the text, and harvest `{…}`
 * from props as well as from children. A prop's NAME is dropped — only its
 * value is evidence — because a prop called `label` is not prose.
 */
/**
 * The end of an element's OPENING TAG — the `>` that actually closes it.
 *
 * 🚨 `after.indexOf('>')` is not it. An `onClick={() => sort(d => …)}` puts a
 * `>` inside the attribute list, so the naive index lands in the middle of a
 * handler and everything after it is read as the element's content. That is
 * how 181 characters of arrow-function source came to be judged as a column
 * header's "text".
 */
function openingTagEnd(src, idx, limit) {
  /* 🚨 WE START INSIDE AN ATTRIBUTE VALUE. `idx` is the position of a class
     token, which sits inside `className="…"`, so a scanner that begins there
     reads the value's CLOSING quote as an OPENING one and every quote after it
     is inverted. Left unhandled it emptied almost every element body and pass 3
     dropped 1,552 of 1,601 mono sites instead of 1,276. So: step over the rest
     of this attribute value first, then scan. */
  const BT = String.fromCharCode(96);
  let q = null;
  for (let i = idx; i >= 0 && idx - i < 4000; i--) {
    const c = src[i];
    if ((c === '"' || c === "'" || c === BT) && src[i - 1] !== '\\') { q = c; break; }
  }
  let from = idx;
  if (q) {
    const close = src.indexOf(q, idx);
    if (close > 0) from = close + 1;
  }

  let quote = null, brace = 0;
  for (let i = from; i < src.length && i - idx < limit; i++) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'" || c === BT) { quote = c; continue; }
    if (c === '{') { brace++; continue; }
    if (c === '}') { brace--; continue; }
    if (c === '>' && brace <= 0) return i - idx;
  }
  return -1;
}

/**
 * The element's OWN literal text — not its subtree's, not its handlers'.
 *
 * `elementBody` deliberately reaches into the subtree, because a money column
 * keeps its figure in a child. Asking "is this a sentence?" needs the opposite:
 * a wrapper around six column headers concatenates to "Name Type Size From the
 * name Folder", 35 characters, and the shouting-sentence rule demoted the whole
 * header row on the strength of it. Two real header rows and one panel's worth
 * of eyebrows were lost that way — the eyebrows split at 30 versus 32
 * characters, nine in capitals and two not, on one screen.
 */
export function elementOwnText(src, idx, limit = 1600) {
  const after = src.slice(idx, idx + limit);
  const gt = openingTagEnd(src, idx, limit);
  if (gt < 0) return '';
  const rest = after.slice(gt + 1);
  const lt = rest.indexOf('<');
  const text = (lt < 0 ? rest.slice(0, 200) : rest.slice(0, lt));
  return text.replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' ').trim().replace(/\s+/g, ' ');
}

export function elementBody(src, idx, limit = 1600) {
  const after = src.slice(idx, idx + limit);
  const gt = openingTagEnd(src, idx, limit);   // not indexOf('>') — see above
  if (gt < 0) return '';
  const selfClosing = after[gt - 1] === '/';
  let span;
  if (selfClosing) {
    span = after.slice(0, gt);                       // its own props are the content
  } else {
    let depth = 0, end = after.length;
    const re = /<\/?[A-Za-z][\w.-]*|\/>/g;
    re.lastIndex = gt + 1;
    let m;
    while ((m = re.exec(after))) {
      if (m[0] === '/>') { depth--; continue; }
      if (m[0].startsWith('</')) { if (depth === 0) { end = m.index; break; } depth--; }
      else depth++;
    }
    span = after.slice(gt + 1, end);
  }
  const cleaned = span
    .replace(/className=(?:"[^"]*"|'[^']*'|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g, ' ')
    .replace(/style=\{\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\}/g, ' ');
  const exprs = cleaned.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) || [];
  const text = cleaned.replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' ').replace(/<[^>]*>?/g, ' ');
  return `${text} ${exprs.join(' ')}`.trim().replace(/\s+/g, ' ').slice(0, 300);
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
      const body = elementBody(src, m.index);
      const style = enclosingStyle(src, m.index);
      const line = src.slice(0, m.index).split(NL).length;
      rows.push({ f, line, token: m[0], px, run, tag, body,
        step: classifySite(f, px, run, tag, body, style, elementOwnText(src, m.index)) });
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
