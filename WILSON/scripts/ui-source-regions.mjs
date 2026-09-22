#!/usr/bin/env node
/**
 * UI overhaul — the regions of a source file the codemod must NOT rewrite.
 *
 * A Tailwind class name is a string of characters, and the same characters
 * appear in three places where rewriting them is wrong or actively harmful:
 *
 *  1. **Embedded CSS.** `dogHelpContent.jsx` carries a light-theme override
 *     sheet as a template literal — `.help-light h3.text-sm { color: … }`.
 *     Rewriting `text-sm` there does not restyle anything; it unhooks the
 *     override from the element it was written to catch, and the help page
 *     silently loses its light theme. D.O.G. has two more `<style>` blocks and
 *     R.A.B.B.I.T.'s client tab has the print sheet.
 *
 *  2. **Comments.** `Home.jsx` explains its own conversion in a comment that
 *     quotes the old classes: "`font-bold text-sm tracking-widest uppercase`
 *     became `text-h2`". A pass that rewrites that turns a record of what
 *     happened into a claim that never was.
 *
 *  3. **Class-name *fragments* used as data** — selectors built at runtime.
 *     Rarer; the CSS rule above catches most of them.
 *
 * Over-protecting is safe: the site simply is not converted, the audit still
 * counts it, and it lands in the hand-off as residue for T1–T3. Under-
 * protecting corrupts a stylesheet invisibly. So every ambiguous case here
 * resolves toward protection.
 */

const BACKTICK = String.fromCharCode(96);

/**
 * Scan a source file and return sorted, non-overlapping [start, end) ranges
 * that the codemod must leave alone.
 */
export function protectedRanges(src) {
  const ranges = [];
  const templates = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    /* Line comment */
    if (c === '/' && c2 === '/') {
      const end = src.indexOf('\n', i);
      ranges.push([i, end < 0 ? n : end]);
      i = end < 0 ? n : end;
      continue;
    }
    /* Block comment */
    if (c === '/' && c2 === '*') {
      const end = src.indexOf('*/', i + 2);
      ranges.push([i, end < 0 ? n : end + 2]);
      i = end < 0 ? n : end + 2;
      continue;
    }
    /* Ordinary string — skipped, not protected: className="…" lives here. */
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    /* Template literal — recorded, then judged on its content below. */
    if (c === BACKTICK) {
      const start = i;
      i++;
      let depth = 0;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue; }
        if (depth > 0 && src[i] === '}') { depth--; i++; continue; }
        if (depth === 0 && src[i] === BACKTICK) break;
        i++;
      }
      templates.push([start, Math.min(i + 1, n)]);
      i++;
      continue;
    }
    i++;
  }

  /* A template literal is CSS when it carries a declaration block: a `{` with
     a `property: value;` inside, or an at-rule. `className={`…`}` never does —
     its interpolations are ${…}, which the scanner already stepped over. */
  const CSS_SHAPE = /\{[^{}]*[a-z-]+\s*:\s*[^{};]+;/i;
  const AT_RULE = /@(?:media|keyframes|supports|font-face|page)\b/i;
  for (const [s, e] of templates) {
    const body = src.slice(s, e);
    if (CSS_SHAPE.test(body) || AT_RULE.test(body)) ranges.push([s, e]);
  }

  /* <style> … </style>, whatever the content shape. */
  const styleRe = /<style\b[^>]*>/gi;
  let m;
  while ((m = styleRe.exec(src))) {
    const close = src.toLowerCase().indexOf('</style>', m.index);
    ranges.push([m.index, close < 0 ? n : close + 8]);
  }

  return merge(ranges);
}

function merge(ranges) {
  if (!ranges.length) return [];
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
  const out = [sorted[0]];
  for (const r of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push(r.slice());
  }
  return out;
}

/** Is `idx` inside any protected range? */
export function isProtected(ranges, idx) {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e] = ranges[mid];
    if (idx < s) hi = mid - 1;
    else if (idx >= e) lo = mid + 1;
    else return true;
  }
  return false;
}
