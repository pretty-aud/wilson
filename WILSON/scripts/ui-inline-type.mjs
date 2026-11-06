#!/usr/bin/env node
/**
 * UI overhaul, Wave 1 bundle T2 — THE INLINE TYPE INVENTORY.
 *
 *   node scripts/ui-inline-type.mjs [path-fragment]
 *   node scripts/ui-inline-type.mjs --json [path-fragment]
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS FOR
 * ═══════════════════════════════════════════════════════════════════════════
 * T0's five passes move CLASS tokens. They deliberately never touched a type
 * declaration written inside a `style={{ … }}` object, because an inline
 * declaration beats every class and a codemod that half-converts one element
 * ships a size fighting a size. The plan (§5 Wave 1) hands that residue to
 * T1/T2/T3, one surface each.
 *
 * The residue still has to land on the SAME seven steps by the SAME rules, or
 * Wave 1 ships two type systems. So this file decides nothing on its own: it
 * finds each inline site, reconstructs exactly the evidence `classifySite`
 * expects (tag, class run, style text, element body, element's own text) and
 * asks T0's map. The map's answer, not this session's taste, is what the hand
 * edits apply. A reviewer re-derives any decision by running this.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY IT ANCHORS ON `style=` AND NOT ON THE DECLARATION
 * ═══════════════════════════════════════════════════════════════════════════
 * 🚨 T0's trap 17, the one that cost it 1,552 mono sites: a scanner that
 * starts INSIDE an attribute value reads that value's CLOSING quote as an
 * OPENING one, and every quote after it is inverted. `ui-type-inventory.mjs`
 * handles it by stepping over the rest of the current attribute first —
 * correct there, because its anchor is a class token inside `className="…"`.
 *
 * An inline site's anchor would be inside `style={{ … }}`, where that
 * step-over is WRONG in a new way: a style object often has no quote at all
 * (`{ fontSize: 20, fontWeight: 600 }`), so the backward walk finds a quote
 * belonging to some earlier attribute and the forward `indexOf` lands in the
 * middle of the style object.
 *
 * So this scanner anchors on the `s` of `style=`, which is at ATTRIBUTE level
 * — between attributes, inside no quote and inside no brace. From there a
 * quote-and-brace-aware scan for the `>` that closes the opening tag needs no
 * step-over and no special case. Everything else is derived from that one
 * honest position.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT REPORTS, AND WHAT IT CANNOT
 * ═══════════════════════════════════════════════════════════════════════════
 * Per site: the tag, the px the author wrote, the step `classifySite` returns,
 * and — for `fontFamily` — `classifyMono`'s keep/drop verdict with its reason.
 *
 * A `fontSize` written as an expression (`fontSize: small ? 11 : 13`) is
 * reported with `px: null` and NO step. That is deliberate: a conditional size
 * is two sites and a human has to say which arm is which. There are none in
 * T2's scope; the column exists so a later lane's are not silently skipped.
 */
import { readFileSync } from 'node:fs';
import { sourceFiles } from './ui-audit.mjs';
import { protectedRanges, isProtected } from './ui-source-regions.mjs';
import { classifySite, CONTROL_TAGS, STEP_IS_SEMIBOLD } from './ui-type-map.mjs';
import { classifyMono } from './ui-mono-map.mjs';

const BT = String.fromCharCode(96);
const BS = String.fromCharCode(92);

/**
 * 🚨 EVERY STRUCTURAL SCAN IN THIS FILE RUNS OVER COMMENT-BLANKED SOURCE, AND
 * THAT IS T0's TRAP 5 AND TRAP 4, BOTH OF WHICH THIS FILE HIT.
 *
 * `App.jsx`'s page-transition title is
 *
 *     <span style={{
 *       // Session 43: was '#fff'. This overlay's own background is
 *       …
 *       fontSize: '16.8px',
 *
 * and the first draft of `matchBraces` — quote-aware, comment-blind — opened a
 * string on the apostrophe in "overlay's", ran to some later quote, lost the
 * braces in between and returned -1 for the whole object. FOUR declarations
 * vanished, silently, in the safe-LOOKING direction: the inventory simply
 * reported a smaller number and every one of them looked plausible.
 *
 * It was `coverage()` below that caught it, which is the whole reason that
 * function exists. Blanking is length-preserving, so every index still points
 * where it did.
 */
export function blankComments(src) {
  const out = src.split('');
  for (const [s, e] of protectedRanges(src)) {
    if (!/^\s*\/[/*]/.test(src.slice(s, s + 3))) continue;   // comments only
    for (let i = s; i < e && i < out.length; i++) if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
  }
  return out.join('');
}

/**
 * Declarations that the grep counts and this inventory deliberately does not,
 * because they are not styles at all. Keyed on the file AND a marker string
 * from the site, because a path alone would exempt a whole file — T0's
 * round-two finding on the guard's own bare-label allowlist, which was keyed
 * on the file though its reason named one site.
 */
export const NOT_A_STYLE = [
  {
    file: 'src/tools/otter_v0.3.1/Otter.jsx',
    marker: 'minimap',
    n: 1,
    why: "Monaco's `options={{ minimap: …, fontSize: 14 }}` — an editor setting, not a style attribute",
  },
];

/** How far from a declaration an exemption's marker may sit. Matched to the
 *  window T3 measured for the frozen transition title, which is the widest
 *  real case in the tree: five consecutive declarations, and the string that
 *  identifies the element is ~155 characters from the first of them. */
export const EXEMPT_WINDOW = 400;

/**
 * 🚨 HOW MANY DECLARATIONS THIS MARKER SITS NEXT TO — not "is it in the file".
 *
 * The first draft tested `src.includes(marker)`, which is keyed on the FILE in
 * everything but name, though its own comment claimed otherwise. A reviewer
 * changed the marker from `'minimap'` to the single letter `'e'` and the guard
 * stayed green.
 *
 * A window alone does not fix that — every declaration has an `e` within 400
 * characters. What fixes it is COUNTING: `coverage()` requires the count to
 * equal the `n` the entry claims, so a marker that starts covering its
 * neighbours makes the arithmetic fail instead of widening in silence. That is
 * the same shape as `INLINE_TYPE_EXCEPTIONS`' `sites:` pin, which is the one
 * allowlist mechanism in this codebase that has survived a reviewer.
 */
export function declsNearMarker(src, marker) {
  const code = blankComments(src);
  const seen = new Set();
  for (const re of RAW_SPELLINGS) {
    const r = new RegExp(re.source, 'g');
    let m;
    while ((m = r.exec(code))) {
      const w = code.slice(Math.max(0, m.index - EXEMPT_WINDOW), m.index + EXEMPT_WINDOW);
      if (w.includes(marker)) seen.add(m.index);
    }
  }
  return seen.size;
}

/** The five inline spellings of a type decision, and nothing else. */
export const INLINE_TYPE_PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'textTransform',
];

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE INLINE SPELLING OF THE CLASS EVIDENCE — read this before arguing with a
 * verdict, because it is where every non-obvious one comes from.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `classifySite` reads its evidence out of the CLASS RUN. On this surface the
 * author wrote that evidence in a style object instead, so the run is empty
 * and the map is blind — which is T0's defect #8 exactly (`META_INK` was a
 * class-list rule, R.A.B.B.I.T. writes `style={{ color: '#78716c' }}`, and the
 * Caption step was unreachable on the largest surface in the app). T0 fixed
 * that one by widening the evidence to the inline spelling. This does the same
 * for the other two signals, and for the same reason:
 *
 *   textTransform: 'uppercase'            ->  `uppercase`      (LABEL_EVIDENCE)
 *   fontWeight: 600 | 700 | 'bold'        ->  `font-semibold`  (HEADING_WEIGHT)
 *
 * Measured, not assumed: without the first, all nine of `IntakePrepare`'s
 * inline uppercase sites classify as though they were lower case — the eyebrow
 * over the personas row comes back `text-caption` instead of `text-label`, and
 * a screen with six eyebrows ships three of them on one step and three on
 * another.
 *
 * 🚨 AND `fontWeight: 500` IS NOT ON THE LIST, deliberately, because
 * `font-medium` is not on T0's: "600 and above is a decision; 500 is a mood".
 * 🚨 NOR IS `letterSpacing`. T0 measured tracking over 855 sites and it decided
 * exactly two, one of them wrong. Tracking is a nicety; capitals are a claim.
 */
export function inlineClassEvidence(decls) {
  const out = [];
  const upper = (decls.textTransform || []).some((v) => !isConditional(v) && /uppercase/.test(v));
  if (upper) out.push('uppercase');
  const heavy = (decls.fontWeight || []).some(
    (v) => !isConditional(v) && /\b(?:600|700|800|900)\b|bold/.test(v));
  if (heavy) out.push('font-semibold');
  return out.join(' ');
}

/**
 * 🚨 A CONDITIONAL VALUE IS NOT EVIDENCE ABOUT EVERY BRANCH — T0's trap 6, in
 * the inline spelling. `fontWeight: on ? 600 : 400` is the persona chip's
 * SELECTED state; reading the 600 as "this element is a heading" would decide
 * the unselected chip on the selected chip's evidence, which is exactly how
 * widening the run to a whole template put every Gantt TASK bar on the Label
 * step. Pass 1 ignores the arms; so does this.
 */
/** Is the whole string one bracketed group — `(x)` rather than `(a) + (b)`? */
export function outerParensWrap(text = '') {
  if (text[0] !== '(' || text[text.length - 1] !== ')') return false;
  let depth = 0, quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote && text[i - 1] !== BS) quote = null; continue; }
    if (c === '"' || c === "'" || c === BT) { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i === text.length - 1; }
  }
  return false;
}

export function isConditional(valueText = '') {
  const bare = valueText.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');
  return /\?/.test(bare) && /:/.test(bare);
}

/**
 * The value(s) a declaration can actually render, as separate strings.
 *
 * 🚨 A VALUE TEST THAT LOOKS FOR A TOKEN ANYWHERE IN THE TEXT IS LAUNDERED BY
 * ONE ARM. `fontSize: wide ? TYPE.dense : 9` contains `TYPE.dense`, so a
 * substring test calls the whole declaration on-system and the 9px arm ships
 * — past the token assertion AND past the 11px-floor assertion, which looks
 * for a digit straight after the colon and finds `wide`. A reviewer proved
 * both with one mutant. The arms are two sites and each has to answer for
 * itself.
 *
 * Comments are stripped first, for the same reason: `fontSize: '15px' /* was
 * var(--text-dense) *\/` satisfied the token test on the strength of its own
 * apology.
 */
export function valueArms(valueText = '') {
  const noComments = String(valueText)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .trim();
  /* 🚨 A TERNARY CAN HIDE INSIDE A TEMPLATE LITERAL OR A PAIR OF BRACKETS, AND
     THE FIRST DRAFT GAVE UP AT BOTH. `isConditional` strips backtick-quoted
     text before looking for a `?`, so `` `${w ? TYPE.h2 : 9}px` `` was never
     split; and the splitter tracks bracket depth, so `(b ? TYPE.h2 : 9)` came
     back as one opaque arm. A reviewer planted both against the 11px floor —
     the assertion that exists precisely as the independent backstop — and both
     walked past it while the token assertion caught them. So: recurse into
     every `${…}` span, and into a fully-bracketed arm, before answering. */
  const interpolations = [...noComments.matchAll(/\$\{([\s\S]*?)\}/g)].map((m) => m[1]);
  if (interpolations.length) {
    return interpolations.flatMap((inner) => valueArms(inner));
  }
  /* A wholly-bracketed value is its contents. `outerParensWrap` checks the
     FIRST `(` really closes at the LAST `)`, so `(a) + (b)` is not mistaken
     for one bracket and stripped into `a) + (b`. */
  if (outerParensWrap(noComments)) return valueArms(noComments.slice(1, -1));

  if (!isConditional(noComments)) return [noComments];

  /* Split on the `?` and `:` that are OUTSIDE strings, brackets and calls,
     keeping the separator that PRECEDED each piece. */
  const pieces = [];
  let depth = 0, quote = null, start = 0, sep = null;
  for (let i = 0; i < noComments.length; i++) {
    const c = noComments[i];
    if (quote) { if (c === quote && noComments[i - 1] !== BS) quote = null; continue; }
    if (c === '"' || c === "'" || c === BT) { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; continue; }
    if (depth === 0 && (c === '?' || c === ':')) {
      pieces.push({ text: noComments.slice(start, i), sep });
      sep = c; start = i + 1;
    }
  }
  pieces.push({ text: noComments.slice(start), sep });

  /* 🚨 A CONDITION IS NOT A VALUE. `size >= 40 ? TYPE.h2 : TYPE.label` splits
     into three pieces and only two of them render; treating `size >= 40` as a
     value would report a legitimate, fully tokenised site as hard-coded.
     Piece 0 is always the condition. A piece followed by `?` is a condition
     too — that is a NESTED ternary, and it can nest either way:

       a ? b : c ? d : e     (right)  arms b, d, e
       a ? b ? c : d : e     (left)   arms c, d, e

     The first draft keyed on the separator BEFORE a piece, which got the
     right-nested form and reported `b` — a condition — as a value in the
     left-nested one. A reviewer measured it. Keying on the separator AFTER
     gets both, because what makes a piece a condition is that a `?` follows
     it, wherever it sits. */
  const arms = [];
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i].sep === null) continue;                  // the outer condition
    if (pieces[i + 1]?.sep === '?') continue;              // a nested condition
    arms.push(pieces[i].text);
  }
  /* And each arm answers the same question again, because an arm can itself be
     a bracketed ternary or a template — `b ? (c ? TYPE.h1 : 9) : TYPE.label`.
     The recursion terminates because an arm is always shorter than the value
     it came from, and the guard makes that explicit. */
  return arms
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((a) => (a.length < noComments.length ? valueArms(a) : [a]));
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A CONTROL IS A CONTROL EVEN WHEN ITS COPY IS IN A CHILD.
 * ═══════════════════════════════════════════════════════════════════════════
 * T0's rule 0 keys on the element's own tag, and that is right for the 241
 * uppercase sites that sit ON a `<button>`. R.A.B.B.I.T.'s intake screen puts
 * the button's copy in child `<span>`s instead — the drop zone is
 *
 *   <button …><Upload/><span>Drop files or click to browse</span><span>…</span></button>
 *
 * so the tag rule sees a `<span>`, the uppercase rule fires, and the primary
 * call to action on the screen goes to the 11px floor while the identical copy
 * on any other button in the app goes to 13 or 14. §3.1's Label job list —
 * "table headers, field labels, eyebrows, Kbd, status badges" — has no control
 * on it and no control's LABEL on it either.
 *
 * So: a text-only element whose nearest ancestor element is a control is
 * classified with the CONTROL's tag. Narrow on purpose — the ancestor must be
 * the immediate one, and the site must not itself be a control.
 *
 * 📌 T0 met this shape once (`BinFileTable`'s sortable column header is a
 * `<button>`) and recorded it for the lane rather than teaching the codemod,
 * because there it was ONE site. Here it is the primary action of the screen
 * and its sibling, so it is worth a rule — stated here, applied by the map.
 */
export function controlAncestorTag(src, openStart) {
  const before = src.slice(Math.max(0, openStart - 2000), openStart);
  const re = /<\/?([A-Za-z][\w.-]*)|\/>/g;
  const stack = [];
  let m;
  while ((m = re.exec(before))) {
    if (m[0] === '/>') { stack.pop(); continue; }
    if (m[0].startsWith('</')) { stack.pop(); continue; }
    stack.push(m[1].toLowerCase());
  }
  const parent = stack[stack.length - 1] || '';
  return CONTROL_TAGS.test(parent) ? parent : '';
}

/**
 * What the inline weight becomes, given the step the site lands on. T0's
 * pass 2, in the inline spelling:
 *   700 / 'bold'  -> font-semibold
 *   600           -> font-semibold, or nothing when the step already sets 600
 *   500           -> nothing on a 400 step, font-semibold on a 600 step
 *   400           -> nothing
 */
export function weightVerdict(decls, step) {
  const raw = (decls.fontWeight || [])[0];
  if (raw == null) return null;
  if (isConditional(raw)) return `conditional — both arms, as a class: ${raw}`;
  const stepIs600 = STEP_IS_SEMIBOLD.has(step);
  if (/\b(?:600|700|800|900)\b|bold/.test(raw)) return stepIs600 ? 'drop (step is 600)' : 'font-semibold';
  if (/\b500\b/.test(raw)) return stepIs600 ? 'drop (step is 600)' : 'drop (500 is not a step)';
  if (/\b400\b|normal/.test(raw)) return 'drop (step supplies 400)';
  return `KEEP — conditional: ${raw}`;
}

/**
 * The `>` that actually closes the opening tag whose `style=` starts at `from`.
 *
 * `from` is at attribute level by construction (see the header), so this is a
 * plain quote- and brace-aware scan with no step-over. Returns an ABSOLUTE
 * index, or -1.
 */
export function openingTagEndFromAttr(src, from, limit = 4000) {
  let quote = null, brace = 0;
  for (let i = from; i < src.length && i - from < limit; i++) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== BS) quote = null; continue; }
    if (c === '"' || c === "'" || c === BT) { quote = c; continue; }
    if (c === '{') { brace++; continue; }
    if (c === '}') { brace--; continue; }
    if (c === '>' && brace <= 0) return i;
  }
  return -1;
}

/**
 * The opening `<Tag` this attribute belongs to: its INDEX and its lowercased
 * name, from one walk.
 *
 * 🚨 THE INDEX AND THE NAME MUST COME FROM THE SAME WALK, and the first draft
 * of this file had them come from two. `tagOfAttr` was quote- and brace-aware;
 * the caller then took `src.lastIndexOf('<', attrStart)` for the position, and
 * a bare `lastIndexOf` cannot tell an opening tag from a LESS-THAN OPERATOR.
 * A reviewer measured the disagreement over all 271 in-scope files and found
 * two live sites — `BudgetView.jsx:699` (`n <= 100`) and
 * `BinFileGrid.jsx:86` (`r.width <= 0`) — where the two answers differ. Both
 * escape damage today only because their `className` happens to sit after the
 * stray `<`; move the operator and the class run comes back EMPTY, which is
 * T0's defect #8 exactly: the map blind because its evidence vanished, and
 * `coverage()` cannot see it because the declaration is still counted, merely
 * classified wrong.
 */
export function openTagOf(src, from) {
  let quote = null, brace = 0;
  for (let i = from; i >= 0 && from - i < 4000; i--) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== BS) quote = null; continue; }
    if (c === '"' || c === "'" || c === BT) { quote = c; continue; }
    if (c === '}') { brace++; continue; }
    if (c === '{') { brace--; continue; }
    if (c === '<' && brace <= 0 && /[A-Za-z]/.test(src[i + 1] || '')) {
      const m = /^<([A-Za-z][\w.-]*)/.exec(src.slice(i, i + 40));
      return { index: i, tag: m ? m[1].toLowerCase() : '' };
    }
  }
  return { index: -1, tag: '' };
}

/** Just the name, for callers that do not need the position. */
export function tagOfAttr(src, from) {
  return openTagOf(src, from).tag;
}

/**
 * Brace-match a `{{ … }}` (or `{ … }`) starting at `open`, returning the index
 * just past its close. Quote-aware, because a style value can hold a brace in
 * a string (`fontFamily: "…{…}…"` does not occur here, but `content` would).
 */
function matchBraces(src, open) {
  let quote = null, depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== BS) quote = null; continue; }
    if (c === '"' || c === "'" || c === BT) { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/**
 * The element's `className` value as raw text — the "run" `classifySite`
 * reads. Template literals come back whole, INCLUDING their `${…}` arms,
 * which is `enclosingRunRaw`'s behaviour and the right one here: the question
 * this run answers is "what evidence does this element carry", and a class in
 * a conditional arm is still evidence about the element (T0's trap 6 —
 * pass 1 ignores the arms, pass 2 and the guard read them; an inline site is
 * being classified wholesale, so it is the second question).
 */
export function classNameRun(src, openStart, openEnd) {
  const tag = src.slice(openStart, openEnd);
  const m = /className=(?:"([^"]*)"|'([^']*)'|\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\})/.exec(tag);
  if (!m) return '';
  return (m[1] ?? m[2] ?? m[3] ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The element's own literal text — T0's `elementOwnText` rule, from an
 * absolute opening-tag end rather than from a class token.
 *
 * 🚨 A SELF-CLOSING ELEMENT HAS NO OWN TEXT, AND WITHOUT THIS LINE IT BORROWS
 * ITS NEXT SIBLING'S. `bodyFrom` below checks for the `/`; this did not, so
 * for `<Icon style={{…}} />` the slice began after `/>` — inside the PARENT —
 * and handed `classifySite` the following copy as the icon's own literal text.
 * That text is what the shouting-sentence rule reads, so a long enough sibling
 * demotes a real label. Silent, and `coverage()` cannot see it: the
 * declaration is counted, merely judged on someone else's words.
 */
export function ownTextFrom(src, openEnd, limit = 1600) {
  if (src[openEnd - 1] === '/') return '';
  const rest = src.slice(openEnd + 1, openEnd + 1 + limit);
  const lt = rest.indexOf('<');
  const text = lt < 0 ? rest.slice(0, 200) : rest.slice(0, lt);
  return text.replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * What the element renders, as evidence: its subtree's text plus every `{…}`
 * expression in it, props included. T0's `elementBody` rule — walk to the
 * MATCHING close, keep self-closing children's props, because
 * `<CurrencyDisplay value={x} />` is the only expression there is.
 */
export function bodyFrom(src, openStart, openEnd, limit = 1600) {
  const selfClosing = src[openEnd - 1] === '/';
  let span;
  if (selfClosing) {
    span = src.slice(openStart, openEnd);
  } else {
    const after = src.slice(openEnd + 1, openEnd + 1 + limit);
    let depth = 0, end = after.length;
    const re = /<\/?[A-Za-z][\w.-]*|\/>/g;
    let m;
    while ((m = re.exec(after))) {
      if (m[0] === '/>') { depth--; continue; }
      if (m[0].startsWith('</')) { if (depth === 0) { end = m.index; break; } depth--; }
      else depth++;
    }
    span = after.slice(0, end);
  }
  const cleaned = span
    .replace(/className=(?:"[^"]*"|'[^']*'|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g, ' ')
    .replace(/style=\{\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\}/g, ' ');
  const exprs = cleaned.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) || [];
  const text = cleaned.replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' ').replace(/<[^>]*>?/g, ' ');
  return `${text} ${exprs.join(' ')}`.trim().replace(/\s+/g, ' ').slice(0, 300);
}

/**
 * Pull the type declarations out of one style-object text.
 * Returns `{ fontSize: '20', fontFamily: 'SANS', … }` with the raw value text.
 * Only TOP-LEVEL keys count: a nested object (none here) is a different
 * element's problem.
 */
export function typeDecls(objText) {
  const out = {};
  for (const prop of INLINE_TYPE_PROPS) {
    const re = new RegExp(`\\b${prop}\\s*:\\s*`, 'g');
    let m;
    while ((m = re.exec(objText))) {
      const from = m.index + m[0].length;
      let quote = null, depth = 0, end = objText.length;
      for (let i = from; i < objText.length; i++) {
        const c = objText[i];
        if (quote) { if (c === quote && objText[i - 1] !== BS) quote = null; continue; }
        if (c === '"' || c === "'" || c === BT) { quote = c; continue; }
        if (c === '{' || c === '(' || c === '[') { depth++; continue; }
        if (c === '}' || c === ')' || c === ']') { if (depth === 0) { end = i; break; } depth--; continue; }
        if (c === ',' && depth === 0) { end = i; break; }
      }
      (out[prop] ||= []).push(objText.slice(from, end).trim());
    }
  }
  return out;
}

/**
 * Does this `fontFamily` value name the mono?
 *
 * 🚨 EXPORTED SO THE GUARD CAN CALL IT, AND IT WAS NOT. The first fix here was
 * to make the test case-insensitive, because it had been written against
 * `'ui-monospace,monospace'` and `DATA` and could not see `FONT_MONO` — the
 * token the overhaul converted everything TO, which SHOUTS. The control that
 * was supposed to pin that re-typed the regex as a literal inside the test
 * file instead of calling this, so reverting the fix left 2,910 tests green.
 * That is the file's own rule 1 inside out, and a reviewer proved it.
 */
export const isMonoValue = (v) => /mono|\bDATA\b/i.test(String(v));

/** A literal number, or `'20px'`. Anything else is an expression → null. */
export function pxOf(valueText) {
  if (valueText == null) return null;
  const m = /^(?:['"]?)(\d+(?:\.\d+)?)(?:px)?(?:['"]?)$/.exec(valueText.trim());
  return m ? Number(m[1]) : null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🚨 A STYLE OBJECT DOES NOT HAVE TO BE INSIDE `style={{`.
 * ═══════════════════════════════════════════════════════════════════════════
 * `ProjectFilesTable` sets the type of its ENTIRE table — eight column headers
 * and every cell of every row, on both variants — from two consts:
 *
 *   const hdr  = { fontSize: w ? 11 : 9,  fontFamily: 'ui-monospace,monospace', … }
 *   const cell = { fontSize: w ? 13 : 10, fontFamily: 'ui-monospace,monospace', … }
 *
 * The `style={{` scan finds NEITHER, and its per-file total came back 4 where
 * the audit's own grep says 11. A scanner that misses the biggest site in a
 * file and reports a plausible smaller number is T0's trap 2 wearing different
 * clothes, so `inlineSites` now finds these too and `coverage()` below refuses
 * to let the two counts disagree.
 *
 * A token object has no element, so it gets no automatic verdict: it is
 * reported with the tags that CONSUME it (`style={hdr}`, `{...cell}`) and the
 * lane decides once for all of them. That is the honest shape — one object is
 * one decision, applied to n elements.
 */
export function tokenObjects(rawSrc) {
  const src = blankComments(rawSrc);
  const out = [];
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    const end = matchBraces(src, open);
    if (end < 0) continue;
    const objText = src.slice(open, end);
    const decls = typeDecls(objText);
    if (!Object.keys(decls).length) continue;
    const name = m[1];
    const used = [
      ...src.matchAll(new RegExp(`style=\\{${name}\\}`, 'g')),
      ...src.matchAll(new RegExp(`\\.\\.\\.${name}\\b`, 'g')),
    ];
    const consumers = used.map((u) => ({ tag: tagOfAttr(src, u.index), line: src.slice(0, u.index).split('\n').length }));
    out.push({ name, objText, decls, line: src.slice(0, m.index).split('\n').length, consumers });
  }
  return out;
}

/**
 * Every type declaration the audit's grep can see, per file. The control for
 * `inlineSites` + `tokenObjects`: if these two numbers disagree, a site is
 * invisible to the inventory and therefore to every decision built on it.
 */
/**
 * 🚨 THE DENOMINATOR MUST NOT SHARE A LIST WITH THE NUMERATOR, AND THE FIRST
 * DRAFT DID.
 *
 * `coverage()` exists to be an INDEPENDENT check on the inventory — its
 * comment in the guard says so. But `rawDeclCount` looped
 * `INLINE_TYPE_PROPS`, and so does `typeDecls`, so both sides of the equality
 * were driven by one array and any blinding cancelled exactly. A reviewer
 * deleted the single word `'fontSize'` from that array — the central property
 * of this whole bundle — and the inventory fell from 21 sites in 12 files to
 * 14 in 9 while `coverage()` printed ` ok ` on every remaining row and the
 * guard stayed green at 61/61.
 *
 * So these five regexes are written out here, LITERALLY and once, and are not
 * derived from `INLINE_TYPE_PROPS`. `SPELLINGS_MATCH_PROPS` below is the
 * control that keeps the two honest without coupling them.
 */
const RAW_SPELLINGS = [
  /fontFamily\s*:/g,
  /fontSize\s*:/g,
  /fontWeight\s*:/g,
  /letterSpacing\s*:/g,
  /textTransform\s*:/g,
];

/** The two lists describe the same five properties. A control asserts it. */
export const SPELLINGS_MATCH_PROPS = () =>
  RAW_SPELLINGS.length === INLINE_TYPE_PROPS.length
  && INLINE_TYPE_PROPS.every((p, i) => RAW_SPELLINGS[i].source.startsWith(p));

export function rawDeclCount(src) {
  const code = blankComments(src);
  let n = 0;
  for (const re of RAW_SPELLINGS) n += (code.match(new RegExp(re.source, 'g')) || []).length;
  return n;
}

/** Every inline type site in `files`, with the map's verdict on each. */
export function inlineSites(files = sourceFiles()) {
  const rows = [];
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    const src = blankComments(raw);   // see `blankComments` — trap 5, measured
    const guarded = protectedRanges(raw);
    const rel = f.split(BS).join('/').replace(/^.*?WILSON\//, '');
    const re = /style=\{\{/g;
    let m;
    while ((m = re.exec(src))) {
      const attrStart = m.index;
      if (isProtected(guarded, attrStart)) continue;
      const objEnd = matchBraces(src, attrStart + 'style='.length);
      if (objEnd < 0) continue;
      const objText = src.slice(attrStart + 'style='.length, objEnd);
      const decls = typeDecls(objText);
      if (!Object.keys(decls).length) continue;

      const openEnd = openingTagEndFromAttr(src, attrStart);
      if (openEnd < 0) continue;
      /* ONE walk for both — see `openTagOf`. A `lastIndexOf('<')` here reads a
         `<=` operator as an opening tag and empties the class run. */
      const { index: found, tag } = openTagOf(src, attrStart);
      const openStart = found < 0 ? attrStart : found;

      const classRun = classNameRun(src, openStart, openEnd);
      /* The run the MAP sees: the element's real classes plus the class
         spelling of its own inline evidence. See `inlineClassEvidence`. */
      const run = [classRun, inlineClassEvidence(decls)].filter(Boolean).join(' ');
      const body = bodyFrom(src, openStart, openEnd);
      const ownText = ownTextFrom(src, openEnd);
      const px = pxOf(decls.fontSize?.[0]);
      const line = src.slice(0, attrStart).split('\n').length;

      /* A control's copy is the control's. See `controlAncestorTag`. */
      const parentControl = CONTROL_TAGS.test(tag) ? '' : controlAncestorTag(src, openStart);
      const judgedTag = parentControl || tag;

      /* 🚨 `classifyMono` answers "does this site KEEP its mono", so it is
         asked ONLY of sites that have mono today. A site already in the sans
         has nothing to decide: T0 never PROMOTED anything to the mono, and a
         `keep: true` verdict on a sans site would read as an instruction to.
         🚨 CASE-INSENSITIVE, and the first draft was not. It was written
         against `'ui-monospace,monospace'` and `DATA`, and T3 converted those
         sites to the `FONT_MONO` token — which `/mono|Mono/` does not match,
         because the token SHOUTS. The result was that every site the overhaul
         had actually converted printed no family verdict at all. */
      const hasMono = (decls.fontFamily || []).some(isMonoValue);
      const step = px == null ? null : classifySite(rel, px, run, judgedTag, body, objText, ownText);

      rows.push({
        file: rel,
        line,
        tag,
        judgedTag,
        parentControl,
        classRun,
        run,
        px,
        rawSize: decls.fontSize?.[0] ?? null,
        decls,
        style: objText,
        ownText,
        body,
        step,
        weight: weightVerdict(decls, step),
        mono: hasMono ? classifyMono({ tag: judgedTag, run, body }) : null,
      });
    }
  }
  return rows;
}

/**
 * Per file: what the grep sees vs what the inventory sees. Any row where they
 * differ is a site no decision will ever be made about.
 */
export function coverage(files = sourceFiles()) {
  const out = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const rel = f.split(BS).join('/').replace(/^.*?WILSON\//, '');
    const raw = rawDeclCount(src);
    const inElements = inlineSites([f]).reduce(
      (n, r) => n + Object.values(r.decls).reduce((a, v) => a + v.length, 0), 0);
    const inTokens = tokenObjects(src).reduce(
      (n, o) => n + Object.values(o.decls).reduce((a, v) => a + v.length, 0), 0);
    /* 🚨 `if (!raw) continue` USED TO BE HERE and it hid the failure it was
       supposed to report: when the inventory went blind, a file's count fell
       to zero and the file left the table altogether rather than showing a
       MISS. A row is skipped only when BOTH sides are zero. */
    if (!raw && !inElements && !inTokens) continue;
    /* The exemption contributes what its marker ACTUALLY sits next to, not
       what it claims. If the two differ the arithmetic below stops balancing
       and the row reads MISS, which is how a widened marker gets caught. */
    const exempt = NOT_A_STYLE
      .filter((e) => e.file === rel)
      .reduce((n, e) => n + declsNearMarker(src, e.marker), 0);
    out.push({
      file: rel, raw, exempt,
      seen: inElements + inTokens, inElements, inTokens,
      ok: inElements + inTokens + exempt === raw,
    });
  }
  return out;
}

/* ── CLI ──────────────────────────────────────────────────────────────────
   🚨 Guarded, because `typeScale.test.js` imports from this module and a
   bare top-level CLI would run a full tree sweep on every test file that
   touches it — T0 learned the same thing on `ui-pass4-surface.mjs`. */
const INVOKED = process.argv[1] && /ui-inline-type\.mjs$/.test(process.argv[1]);
if (INVOKED) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const frag = args.filter((a) => a !== '--json')[0] || '';
  const rows = inlineSites().filter((r) => r.file.includes(frag));

  if (json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(`# inline type sites — ${rows.length} elements in ${new Set(rows.map((r) => r.file)).size} files\n`);
    let file = '';
    for (const r of rows) {
      if (r.file !== file) { file = r.file; console.log(`\n## ${file}`); }
      const props = Object.entries(r.decls)
        .map(([k, v]) => `${k}:${v.join('|')}`).join('  ');
      const tagShown = r.parentControl ? `<${r.tag}/in ${r.parentControl}>` : `<${r.tag}>`;
      console.log(
        `  ${String(r.line).padStart(4)}  ${tagShown}`.padEnd(28) +
        `${String(r.px ?? '—').padStart(5)}px  ` +
        `${(r.step || '(expression)').padEnd(13)}` +
        `${r.mono ? (r.mono.keep ? 'MONO  ' : 'sans  ') : '      '}` +
        `${props}`
      );
      if (r.weight) console.log(' '.repeat(28) + `weight: ${r.weight}`);
      if (r.mono) console.log(' '.repeat(28) + `mono: ${r.mono.why}`);
      if (r.ownText) console.log(' '.repeat(28) + `text: "${r.ownText.slice(0, 70)}"`);
    }
    const byStep = {};
    for (const r of rows) byStep[r.step || '(expression)'] = (byStep[r.step || '(expression)'] || 0) + 1;
    console.log(`\n${JSON.stringify(byStep)}`);

    console.log('\n# token objects (one decision, n elements)\n');
    for (const f of new Set(rows.map((r) => r.file))) {
      const abs = sourceFiles().find((p) => p.split(BS).join('/').endsWith(f));
      if (!abs) continue;
      for (const o of tokenObjects(readFileSync(abs, 'utf8'))) {
        const props = Object.entries(o.decls).map(([k, v]) => `${k}:${v.join('|')}`).join('  ');
        console.log(`  ${f}:${o.line}  const ${o.name}  ->  ${o.consumers.length} elements  ${props}`);
        console.log(' '.repeat(4) + `consumers: ${o.consumers.map((c) => `<${c.tag}>@${c.line}`).join(' ')}`);
      }
    }

    console.log('\n# coverage — grep vs inventory\n');
    for (const c of coverage().filter((c) => c.file.includes(frag))) {
      console.log(`  ${c.ok ? ' ok ' : 'MISS'}  ${String(c.seen).padStart(3)}/${String(c.raw).padEnd(3)}  ` +
        `(elements ${c.inElements}, tokens ${c.inTokens}, exempt ${c.exempt})  ${c.file}`);
    }
  }
}
