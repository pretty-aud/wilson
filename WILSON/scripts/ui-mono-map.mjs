#!/usr/bin/env node
/**
 * UI overhaul codemod — the MONO map: which sites keep `font-mono`.
 *
 * §3.1 has two families. Mono is for DATA: "file names and paths, ids, hashes,
 * keys, code, log lines, timestamps, Kbd, numeric table cells". Everything
 * else — headings, labels, buttons, paragraphs, nav, empty states — is the
 * sans. WILSON currently sets 1,601 sites in mono, which is most of the reason
 * Audrey said the app "seems to use fonts that dont look super contemporary".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFAULT IS DROP. KEEPING HAS TO BE EARNED.
 * ═══════════════════════════════════════════════════════════════════════════
 * §3.1 states the rule as an exception list, so the code states it the same
 * way. A site keeps mono only on positive evidence that its content is data.
 * That is the opposite default from pass 1's caption/dense split, and for the
 * opposite reason: there, the structural mass WAS the majority; here the
 * mono-as-default IS the defect being removed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE KINDS OF EVIDENCE
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. THE TAG. `<code>`, `<pre>`, `<kbd>` are data by definition and keep it.
 *     `<button>`, `<select>`, `<input>`, `<textarea>`, `<label>`, `<p>` and
 *     `<h1…h6>` are not, and lose it — the kit already rules the controls
 *     (`.ui-input` is `var(--font-sans)`), so this is C8, not taste.
 *  2. THE STEP. A site on `text-label`, `text-h1`, `text-h2` or `text-h3` is a
 *     label or a heading. §3.1's own sentence puts both in the sans.
 *  3. THE CONTENT. What the element actually renders, read out of the JSX:
 *     an identifier chain, a formatter call, a path literal — or prose.
 *
 * Evidence 3 is why this pass needed hand-checking and the others did not.
 * The patterns below were built by sampling and are listed rather than
 * summarised so a reviewer can argue with each one.
 */

/** Tags that are data whatever they contain. */
export const MONO_TAGS = /^(?:code|pre|kbd|samp)$/;

/** Tags that are never data, whatever they contain. */
export const SANS_TAGS = /^(?:button|select|input|textarea|label|p|a|h[1-6])$/;

/**
 * The Label step is sans, full stop: §3.1 gives Label "table headers, field
 * labels, eyebrows, Kbd, status badges" and not one of those is a figure.
 *
 * 🚨 THE HEADING STEPS ARE NOT ON THIS LIST, and the kit is why. F2 shipped
 * `Stat` with "the value is the mono at the H1 step", because a big number is
 * still a number and numbers line up. R.A.B.B.I.T.'s budget band sets BID DAYS
 * 125.5, LOGGED DAYS 65.0 and VARIANCE -60.5 as its own tiles at a heading
 * size; dropping mono there made three figures stop agreeing with every other
 * figure on the page. So a heading falls through to the content test: a
 * heading that renders prose loses mono, a heading that renders a figure keeps
 * it. C8 — the repeated thing is the kit's, and the kit already decided.
 */
export const SANS_STEPS = /\btext-label\b/;

/**
 * Identifier fragments that mean the rendered value is data.
 * Matched case-insensitively against the expression inside `{…}`.
 * Grouped by the §3.1 phrase each one serves.
 */
export const DATA_IDENT = [
  // "file names and paths"
  /\b(?:path|paths|filename|file_?name|filepath|dir|folder|ext|basename)\b/i,
  // "ids, hashes, keys"
  /\b(?:id|ids|uuid|guid|hash|sha|checksum|key|keys|token|slug|code|codes|ref)\b/i,
  // "log lines" and machine strings
  /\b(?:url|uri|href|endpoint|mime|status_?code|method|agent|payload)\b/i,
  // "timestamps"
  /\b(?:date|time|timestamp|created|updated|uploaded|modified|expires|locale)\b/i,
  /\b(?:duration|runtime|elapsed|seconds|minutes|hours|days|ms)\b/i,
  // "numeric table cells"
  /\b(?:count|total|totals|subtotal|sum|amount|price|cost|rate|budget|qty|quantity)\b/i,
  /\b(?:size|bytes|kb|mb|gb|pct|percent|index|idx|num|number|version|revision)\b/i,
  // the formatters those values go through
  /\b(?:fmt|format|formatted|toFixed|toLocale\w*|padStart|padEnd|round|currency)\b/i,
  // a collection's size is a count
  /\blength\b/,
  // bare arithmetic is a number by construction
  /\bMath\b/,
  /^\s*\w+\s*[+\-*/]\s*\d+\s*$/,
];

/** Literal content that is data on sight. */
export const DATA_LITERAL = [
  /\\\\/,                       // a UNC path: \\server\share
  /:\/\//,                      // a URL scheme
  /^[#$@]/,                     // #1234, $1,200
  /^[A-Z0-9][A-Z0-9_\-.]*\d[A-Z0-9_\-.]*$/,   // SH_010, v0.3.1, ABC-12
  /^[\d.,:%+\-/\s]+$/,          // pure figures, ratios, times
];

/** Identifier fragments that mean the value is a NAME, and names are prose. */
export const PROSE_IDENT = [
  /\b(?:title|name|label|description|desc|message|msg|text|body|summary|note|notes|caption|heading|placeholder|hint|error|reason|comment)\b/i,
];

/**
 * A FILE NAME IS DATA EVEN THOUGH IT CONTAINS THE WORD "name".
 * §3.1 puts "file names and paths" first in the mono list, and the fields that
 * hold them here are `display_name`, `original_name` and `file_name` — all of
 * which the prose list would otherwise claim. Tested before prose, and only
 * these spellings, so `project.name` and `member.name` stay prose.
 */
export const FILE_NAME_IDENT =
  /\b(?:display|original|file|base|folder|path)[_\s]?name\b/i;

/* Right-aligned means a column of figures. §3.1's numeric-cell clause is about
   figures lining up, and the alignment is the author saying so. */
export const NUMERIC_ALIGN = /\b(?:text-right|justify-end)\b/;

/**
 * Split an expression on camelCase humps, `_` and `.` so a word-boundary match
 * can see the parts. `taskCount` does not contain `\bcount\b` — the boundary is
 * not there — and `__OTTER_VERSION__` does not contain `\bversion\b` either,
 * because `_` is a word character. Both are data, and both were being dropped.
 */
export function splitIdentifiers(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.\[\]()]/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Decide whether one `font-mono` site keeps it.
 * @returns {{keep: boolean, why: string}}
 */
export function classifyMono({ tag, run, body }) {
  if (MONO_TAGS.test(tag)) return { keep: true, why: 'tag is code/pre/kbd' };
  if (/\btabular-nums\b/.test(run)) return { keep: true, why: 'tabular-nums (a numeric cell)' };
  if (SANS_TAGS.test(tag)) return { keep: false, why: `tag <${tag}> is never data` };
  if (SANS_STEPS.test(run)) return { keep: false, why: 'on a label or heading step' };

  /* Expressions anywhere in the body, not only at the start: `+{fmtCurrency(…)}`
     and `· {count} assets` are both a figure with a character in front of it. */
  const exprs = body.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) || [];
  const raw = exprs.join(' ');
  /* Every pattern is tested against BOTH spellings: the source form, where
     `display_name` still has its underscore, and the split form, where
     `taskCount` has become `task Count`. Testing only the split form broke
     every underscore pattern; testing only the raw form broke every camelCase
     one. Both, or neither works. */
  const hit = (pats) => pats.some((re) => re.test(raw) || re.test(splitIdentifiers(raw)));
  const expr = raw;

  if (expr && hit([FILE_NAME_IDENT])) return { keep: true, why: 'renders a file name' };
  if (expr && hit(PROSE_IDENT)) return { keep: false, why: 'renders a name or a message' };
  if (expr && hit(DATA_IDENT)) return { keep: true, why: 'renders an identifier, figure or timestamp' };
  if (NUMERIC_ALIGN.test(run) && exprs.length) return { keep: true, why: 'right-aligned figure column' };
  if (!exprs.length && DATA_LITERAL.some((re) => re.test(body))) return { keep: true, why: 'literal is a path, figure or code' };

  return { keep: false, why: 'no data evidence' };
}
