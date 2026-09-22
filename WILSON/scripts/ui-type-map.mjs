#!/usr/bin/env node
/**
 * UI overhaul — THE MAP. Every hand-written type size onto the seven scale
 * steps, by ROLE, with the class list as the evidence.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONE RULE THAT IS NOT MECHANICAL, AND WHY IT IS WRITTEN DOWN FIRST
 * ═══════════════════════════════════════════════════════════════════════════
 * C3b mapped sizes by NUMBER — 11px in, 11px out — and put 52 sites of body
 * copy on the 11px Label step, which is uppercase, tracked and 600. C3c spent
 * a whole session undoing it. The number a designer typed in 2025 is not the
 * role; it is one weak signal about the role, and on this codebase it is
 * usually wrong, because the old de-facto body was 12px and the old dense band
 * was 9–11px.
 *
 * So: **map by role, using the class list as the evidence.** The evidence is
 * the sibling classes the size token ships with, plus the JSX tag it sits on.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MAP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * | evidence in the class list / tag             | step          | px | wt  | case     |
 * |----------------------------------------------|---------------|----|-----|----------|
 * | tag is button/select/input/textarea, <=12.5px| `text-dense`  | 13 | kit | sentence |
 * | tag is button/select/input/textarea, >12.5px | `text-body`   | 14 | kit | sentence |
 * | `uppercase` on an h1–h6 tag                  | h3/h2/h1 by px| .. | 600 | sentence |
 * | `uppercase` on >30 chars of literal text     | `text-dense`  | 13 | 400 | sentence |
 * | `uppercase`, under 18px                      | `text-label`  | 11 | 600 | KEEPS UPPER |
 * | `uppercase`, 18px and over                   | `text-h1`     | 20 | 600 | sentence |
 * | plain, <= 12.5px, positive metadata evidence | `text-caption`| 12 | 400 | sentence |
 * | plain, <= 12.5px, otherwise                  | `text-dense`  | 13 | 400 | sentence |
 * | plain, 13 – 13.5px                           | `text-dense`  | 13 | 400 | sentence |
 * | plain, 14px, heading evidence                | `text-h3`     | 14 | 600 | sentence |
 * | plain, 14px, otherwise                       | `text-body`   | 14 | 400 | sentence |
 * | plain, 15 – 17px, heading evidence           | `text-h2`     | 16 | 600 | sentence |
 * | plain, >= 18px, heading evidence             | `text-h1`     | 20 | 600 | sentence |
 * | plain, > 14px, NO heading evidence           | `text-body`   | 14 | 400 | sentence |
 *
 * A site WITHOUT `uppercase`/`tracking-*` is running text or data and NEVER
 * lands on Label. That is the whole lesson, in one sentence.
 *
 * `text-xs / sm / base / lg / xl / 2xl / 3xl` go through the same table at
 * their rendered px (12 / 14 / 16 / 18 / 20 / 24 / 30).
 *
 * WHY "dense" IS THE DEFAULT BELOW 12.5 AND "caption" NEEDS EVIDENCE.
 * §3.1 gives Dense "table cells, dense lists, tree rows, sidebars" and Caption
 * "metadata, hints, counts, timestamps". In a seven-column desktop tool the
 * first set is the mass and the second is a nameable minority, so the default
 * goes to the mass and the minority has to prove itself. It also errs one step
 * toward legibility, which is the direction the whole overhaul is going.
 *
 * WHY 15px+ WITHOUT HEADING EVIDENCE FALLS TO BODY.
 * The scale has no 15, 17, 18, 24 or 30px step and no large 400-weight step at
 * all. Running text set at 16px has exactly one honest home and it is Body.
 * Forcing it onto H2 would make it 600 and turn a paragraph into a heading.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE IS NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * It decides steps. It does not edit files. Pass 1 (`ui-pass1-sizes.mjs`)
 * applies it; `ui-type-inventory.mjs` reads it so a reviewer can re-derive
 * every decision without trusting the codemod's own report.
 */

/* ── Label evidence, and there is exactly one signal. ─────────────────────
   `uppercase`. Not tracking.
 *
 * The first draft also accepted `tracking-wide|wider|widest|tight|tighter`
 * and `tracking-[…]` on the reasoning that tracking on a small size is the
 * same design intent as capitals. Measured: of the 855 sites that rule
 * caught, 853 carried `uppercase` anyway, so the tracking arms decided
 * exactly two sites — and the one they decided on their own, they decided
 * WRONG. `ProjectSummaryView`'s shot-naming preview sets the generated name
 * in `text-[11px] font-mono font-bold tracking-wide` next to a `Preview:`
 * label. The tracking arm called the VALUE a label; it is data, and the
 * label is the word beside it.
 *
 * Tracking is a typographic nicety an author reaches for on anything small.
 * Capitals are a statement about what the text IS. Only the second one is
 * evidence, and pass 2's own guard is what found this. */
export const LABEL_EVIDENCE = [
  /\buppercase\b/,
];

/* ── THE ONE EXCEPTION TO "uppercase MEANS Label": A CONTROL IS A CONTROL.
   241 of the uppercase sites are on `<button>` and 34 more on `<select>`.
   The kit already rules on what those look like and it is not the Label step:
     .ui-btn                  14px / 600 / letter-spacing 0 / sentence
     .ui-btn[data-size="sm"]  13px / 600 / letter-spacing 0 / sentence
     .ui-input, .ui-select    13px / 400 / sentence
   §3.1 gives Label "table headers, field labels, eyebrows, Kbd, status
   badges" — no control is on that list, and C8 says the repeated thing is the
   kit's. So a control loses `uppercase` and `tracking-*` and takes Dense or
   Body by its own size.

   This is a real visible change and it is the right one: the button copy is
   already sentence case in the source and the CSS was shouting it. D.O.G.'s
   generate button reads `Generating Full Deck...` in the JSX and `GENERATING
   FULL DECK...` on screen. Dropping `uppercase` is what makes the source and
   the screen agree. */
export const CONTROL_TAGS = /^(?:button|select|input|textarea)$/;

/* ── Heading evidence: a weight the author reached for, or a heading tag.
   🚨 `font-medium` is NOT on this list. 500 is a mild lift, and on this
   codebase it sits on body copy as often as on anything structural — it
   classified D.O.G.'s red error banner (`p-3 bg-red-900/50 … font-medium
   text-sm`) as a heading in the first draft. 600 and above is a decision;
   500 is a mood. `font-medium` resolves to 400 through the Body step instead,
   which is half of what §5's "font-medium resolved" asks for. */
export const HEADING_WEIGHT = /\bfont-(?:bold|semibold|black|extrabold)\b/;
export const HEADING_TAGS = /^h[1-6]$/;

/* ── Metadata evidence, which promotes a sub-12.5px site from Dense to
   Caption. All three are positive signals that the author was marking text as
   secondary, which is exactly what Caption is for:
     1. a muted ink (the third ink, or its pre-token stone/neutral/zinc/gray
        400–500 spellings, or the literal hexes the ink ladder replaces),
     2. an opacity used as a dimmer,
     3. the size sits on a timestamp / count / hint in the same run.
   Tables are excluded first (below) — a muted cell is still a cell. */
/* 🚨 `-400` IS NOT ON THIS LIST, AND THAT IS THE WHOLE POINT.
   F1's ink ladder maps the old greys onto three inks: `#d6d3d1` and `#a8a29e`
   (stone-300/400) become **ink-2**, the secondary BODY ink at 72%; `#78716c`
   and `#57534e` (stone-500/600) become **ink-3**, the muted ink at 52%.
   Secondary body copy is still body copy. Treating stone-400 as "metadata"
   put four runs of D.O.G. help prose on the 12px Caption step in the first
   draft of this map — the same species of error as C3b's, one step milder.
   Caption is for the muted ink only. */
export const META_INK = [
  /\btext-ink-3\b/,
  /\btext-(?:stone|neutral|zinc|gray|slate)-(?:500|600)\b/,
  /\btext-\[#(?:78716c|8d8986|57534e)\]/i,
  /\bopacity-(?:40|50|60|70)\b/,
  /* The SAME muted ink, written inline. `META_INK` was a class-list rule, and
     R.A.B.B.I.T. and the operator console write `style={{ color: '#78716c' }}`
     where D.O.G. writes `text-stone-500` — so the Caption step was unreachable
     on the largest surface in the app and a seven-step scale shipped as six.
     `#a8a29e` is deliberately absent for the same reason `-400` is: it is
     ink-2, the secondary BODY ink. */
  /color:\s*['"]#(?:78716c|8d8986|57534e)['"]/i,
];

/* ── Prose evidence: a leading or a stack rhythm the author set means running
   text, and running text is never a caption however dim it is. §3.1 gives
   "paragraphs, descriptions, list items" to Body and "dense lists" to Dense;
   at these sizes (9–12px today) Dense is the honest landing. */
export const PROSE_CLASS = [
  /\bleading-(?:relaxed|loose|normal|6|7|8)\b/,
  /\bspace-y-(?:1\.5|2|2\.5|3|4)\b/,
  /\bwhitespace-pre-wrap\b/,
];

/* ── Dense evidence: the structural mass. A table cell is a table cell even
   when it is dim, so this is tested BEFORE the metadata promotion. */
/* `p`, `ul`, `ol` and `blockquote` are here for the same reason `td` and `li`
   are: the tag says what the content IS, and it outranks how dim the author
   made it. Without them, `META_INK` fired first and two paragraphs of the same
   kind in one D.O.G. help card landed on Dense and Caption — a 13px and a 12px
   paragraph side by side reads as a rendering fault, not as a hierarchy. */
export const DENSE_TAGS = /^(?:td|th|tr|li|option|p|ul|ol|blockquote|dd|dt)$/;
export const DENSE_FILE = /(?:Table|Row|Tree|Sidebar|List|Grid|Cell|Bin|Timeline|Gantt|Budget|Scenes|Assets|FileManager|ProjectFiles|Tasks)/i;
export const DENSE_CLASS = [
  /\btabular-nums\b/,
  /\btruncate\b/,
  /\bwhitespace-nowrap\b/,
];

/** Rendered px for the Tailwind named sizes. */
export const TAILWIND_PX = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30 };

/**
 * Decide the step for one size site.
 * @param {string} file  repo-relative path (evidence: which surface this is)
 * @param {number} px    the rendered size the author wrote
 * @param {string} run   the class-list run the token sits in
 * @param {string} [tag] the JSX tag the className is on, lowercased
 * @returns {string} one of text-label|caption|dense|body|h3|h2|h1
 */
/**
 * Literal text long enough that it is a sentence rather than a label. Counts
 * only the words: an interpolation is a value, and a value can legitimately be
 * long. Thirty characters is about five words — no column header, field label,
 * eyebrow or status badge in this app comes close.
 */
export function isShoutingSentence(body = '') {
  const words = body.replace(/\{[^{}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
  return words.length > 30 && /\s/.test(words);
}

/**
 * @param {string} body the element's rendered content, as evidence for (b)
 */
export function classifySite(file, px, run, tag = '', body = '', style = '') {
  /* 0. A control is a control, whatever case it was shouting in. The kit
        rules these and the kit's split is 13 small / 14 normal. */
  if (CONTROL_TAGS.test(tag)) return px <= 12.5 ? 'text-dense' : 'text-body';

  /* 1. Label — but three things outrank it, and each one was a real defect.

     (a) A HEADING TAG IS A HEADING, whatever size it was written at. §3.1
         gives Label "table headers, field labels, eyebrows, Kbd, status
         badges" and a heading is none of them. This codebase writes section
         headings as `<h3 className="text-sm font-bold uppercase">`, so the
         size test alone sent 54 heading tags to the 11px floor — and left
         them SMALLER than the body they introduce. D.O.G.'s help pane had 15
         `<h3>` at 11px over 47 `<h4>` at 13px; the operator console's only
         `<h1>` was 11px above a 13px paragraph. A heading that shouts is
         fixed by sentence case (Q2), not by shrinking it.

     (b) A SHOUTING SENTENCE IS A SENTENCE. `uppercase` with forty characters
         of literal text behind it is prose someone set in capitals, not a
         label: "No shots yet — create a scene first, then add shots" was
         ratified as a label and got smaller. 14 sites.

     (c) THE SIZE CLIFF IS AT 18, NOT 16. At 16 it split one designed pair of
         row labels in R.A.B.B.I.T.'s cost breakdown — "BASE COST" at 11px in
         capitals four rows from "Grand Total" at 16px in sentence case, when
         13.5 and 16 had been one author's emphasis inside one waterfall. */
  if (LABEL_EVIDENCE.some((re) => re.test(run))) {
    if (HEADING_TAGS.test(tag)) return px >= 18 ? 'text-h1' : px >= 15 ? 'text-h2' : 'text-h3';
    if (isShoutingSentence(body)) return 'text-dense';
    if (px < 18) return 'text-label';
    return 'text-h1';
  }

  const heading = HEADING_WEIGHT.test(run) || HEADING_TAGS.test(tag);

  /* 2. Above body. */
  if (px > 14) {
    if (!heading) return 'text-body';
    if (px >= 18) return 'text-h1';
    return 'text-h2';
  }

  /* 3. Body band. */
  if (px >= 13.6) return heading ? 'text-h3' : 'text-body';

  /* 4. Dense band. */
  if (px >= 12.6) return 'text-dense';

  /* 5. Below 12.5: dense is the mass, caption has to prove itself. Structure
        and prose are tested FIRST — a dim table cell is still a cell, and a
        dim paragraph is still a paragraph. */
  if (DENSE_TAGS.test(tag)) return 'text-dense';
  if (DENSE_CLASS.some((re) => re.test(run))) return 'text-dense';
  if (PROSE_CLASS.some((re) => re.test(run))) return 'text-dense';
  if (DENSE_FILE.test(file)) return 'text-dense';
  if (META_INK.some((re) => re.test(run) || re.test(style))) return 'text-caption';
  return 'text-dense';
}

/** The weight the step brings, for the case/weight pass to reason about. */
export const STEP_WEIGHT = {
  'text-h1': 600, 'text-h2': 600, 'text-h3': 600,
  'text-body': 400, 'text-dense': 400, 'text-caption': 400, 'text-label': 600,
};

/** The steps whose token already sets 600 — an explicit weight class on them
 *  is noise the case/weight pass removes rather than rewrites. */
export const STEP_IS_SEMIBOLD = new Set(['text-h1', 'text-h2', 'text-h3', 'text-label']);
