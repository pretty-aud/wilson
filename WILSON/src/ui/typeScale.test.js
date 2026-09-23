// =============================================================================
// typeScale.test.js — the codemod's own guard (plan §7's grep audit, as a test)
//
// WHY THIS FILE EXISTS. T0's passes tripped no existing guard, and that is
// correct — no test in this repo pinned a type size. It is also exactly the
// hole C3c named: "the case half of the pass had no guard at all, and a mutant
// proved it". A codemod that moves 2,584 sites and leaves nothing behind to
// hold them will be undone one careless `text-xs` at a time.
//
// ── TWO RULES THIS FILE FOLLOWS, BOTH LEARNED FROM AN ADVERSARIAL REVIEW ────
//
// 1. EVERY SWEEP REGEX IS A NAMED CONST, USED BY BOTH THE ASSERTION AND ITS
//    CONTROL. The first draft re-typed each regex inside its control, so the
//    two could drift — and a reviewer proved it: narrowing the border
//    assertion to `/\bborder-[9]\b/` and planting a real `border-4` left the
//    suite green, with the control still passing, because it was proving a
//    literal in this file rather than the code path the assertion runs. That
//    is F4's trap 13 one level up.
//
// 2. EVERY PATTERN ANCHORS ON THE UTILITY ROOT, NOT ON ONE SPELLING.
//    `border-2` missed 102 live `border-b-2`; `text-…3xl` missed a `text-6xl`;
//    `rounded-sm` missed `rounded-t-sm`. An assertion that passes green over a
//    hundred live instances of the thing it names is worse than no assertion,
//    because it is read as evidence.
//
// Every block still carries a CONTROL: a synthetic string with the defect in
// it, asserted to be DETECTED, so "0 violations" cannot be confused with "the
// detector is broken".
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  sourceFiles, cssCounts, CSS_FILES, themeRange, blankCssComments, enclosingBlock,
} from '../../scripts/ui-audit.mjs';
import { protectedRanges, isProtected } from '../../scripts/ui-source-regions.mjs';
import { LABEL_EVIDENCE, CONTROL_TAGS } from '../../scripts/ui-type-map.mjs';
import { classifyMono } from '../../scripts/ui-mono-map.mjs';
import { isIndicatorBorder } from '../../scripts/ui-pass4-surface.mjs';
import { enclosingRunRaw, enclosingTag } from '../../scripts/ui-type-inventory.mjs';
import {
  coverage, inlineClassEvidence, valueArms, declsNearMarker, openTagOf,
  openingTagEndFromAttr, classNameRun, ownTextFrom,
  SPELLINGS_MATCH_PROPS, INLINE_TYPE_PROPS, NOT_A_STYLE, isMonoValue,
} from '../../scripts/ui-inline-type.mjs';

/* The Label step used WITHOUT `uppercase`, on purpose. Keyed on the file AND
   on a string from the site: the reason names ONE site, and a bare path
   exempts the whole file — a reviewer planted a fresh, unrelated bare label in
   HelpPage.jsx and the guard stayed green. */
const BARE_LABEL_EXCEPTIONS = [
  {
    file: 'src/components/HelpPage.jsx',
    marker: '__WILSON_VERSION__',
    why: 'the version footer — a version number has no case to convert (D2)',
  },
];

// ── The patterns. One const each, shared by assertion and control. ──────────

/* The lookbehind is load-bearing on both of these: `\btext-label\b` matches
   INSIDE `var(--text-label)`, because `-` is a non-word character and the
   boundary is therefore right there. Four CSS-variable reads in
   DevFixturesBadge were reported as case-less labels before it existed. */
const OFF_SCALE = /(?<![-\w])text-(?:\[[\d.]+(?:px|rem|em|pt)\]|(?:xs|sm|base|lg|xl|[2-9]xl)\b)/g;
const SCALE_STEP = /(?<![-\w])text-(?:h1|h2|h3|body|dense|caption|label)\b/g;

/* 🚨 The `\b` sits on the WORD alternatives ONLY. After `]` there is no word
   boundary, so `…|\[\d+\])\b` matches nothing — the same trap that made the
   first inventory report 706 sites instead of 2,584. This file's own control
   caught it, which is the point of writing controls. */
const OFF_WEIGHT = /\bfont-(?:(?:bold|medium|black|extrabold|light|thin|extralight)\b|\[\d+\])/g;
const NAMED_TRACKING = /\btracking-(?:wide|wider|widest|tight|tighter)\b/g;

/* Inline weights were T1–T3's residue by plan, and this RATCHETED rather than
   banning: 11 (T0) → 7 (T3) → 1 (T2, 2026-09-22), and one is the floor.

   All three lanes have landed, so the ratchet is gone and the app-wide
   assertion at the bottom of this file is hard. What remains is:

     src/App.jsx:2118   the page-transition title, FROZEN by C2 and Q18. A
                        session that "fixes" it is proposing to edit a block
                        the plan forbids touching. (It reads `bold`, which
                        asks for 700 and clamps to 600, because the faces are
                        declared `font-weight: 400 600`. The pixels are right;
                        the source is not; the rule says leave it.) */
/* 🚨 REVIEW ROUND ONE. The first version demanded the weight IMMEDIATELY
   after the colon — `/fontWeight\s*:\s*['"]?(?:500|700|bold)['"]?/` — so
   every one of these was invisible:

     fontWeight: cond ? 700 : 400
     fontWeight: w ? 700 : undefined     ← LIVE, and uncounted, at
                                           rabbit/components/ProjectFilesTable.jsx:101
     fontWeight: hovered && 700
     fontWeight: Number(700)

   The stated population of 7 was therefore really 8, and T3's own hard
   `toBe(1)` could have been regressed to a real 2 by writing a ternary. It
   also saw only 500, 700 and bold, so `fontWeight: 800` and `fontWeight:
   300` were guarded by NOTHING — `fontWeight` is deliberately outside the
   value test above, on the grounds that "400 and 600 are the system's own
   vocabulary", and that rule was being enforced for no value at all.

   It reads the value with the scanner now, and 🚨 ROUND TWO INVERTED IT.
   Round one's own commit message says, of the CSS weight row: "it listed the
   three spellings it expected rather than asking what the system allows… It
   ACCEPTS now instead of rejecting." That lesson was applied to the CSS row
   and NOT to this one — it was only re-enumerated. Variable fonts take any
   integer from 1 to 1000, and every one of these passed:

       fontWeight: 450   550   350   250   1000   '650'   TYPE.h1

   §3.1 has two weights. Anything that is not one of them, or a keyword that
   inherits rather than sets, is reported — including spellings nobody has
   thought of yet. Judged per OPERAND, so a ternary cannot hide an arm. */
const INLINE_WEIGHT = /['"]?fontWeight['"]?\s*:/g;
const ON_AXIS_WEIGHT = /^['"`]?(?:400|600|var\(--text-(?:h1|h2|h3|body|dense|caption|label)--font-weight\)|inherit|initial|unset|revert|normal|undefined|null)['"`]?$/;
const isOffAxisWeight = (src, index) => {
  const value = inlineValueAt(src, index);
  if (!value) return true;                 // unreadable is not clean
  const arms = ternaryArms(value).map((s) => s.trim()).filter(Boolean);
  if (!arms.length) return true;
  return !arms.every((a) => ON_AXIS_WEIGHT.test(a)
    || /^WEIGHT\s*\.\s*(?:h1|h2|h3|body|dense|caption|label)$/.test(a));
};
/** The control's spelling: judge a standalone `fontWeight: …` fragment. */
const offAxisWeightIn = (fragment) => isOffAxisWeight(fragment, 0);
/* 8, not 7: `ProjectFilesTable.jsx:101` became visible when the regex above
   was fixed. 1 is T3's frozen transition title (the FLOOR) and 7 are T2's. */


/* ── T1 and T3 MET IN THIS FILE, and T3's design won on the merge.

   T1 arrived with a spelling ban: an `INLINE_SIZE` that matched the KEY
   `fontSize:` and asserted T1's lane held none. T3 arrived, in the same
   hour and on the same branch, with a VALUE test: `tokens.js` exists so
   that "the ~2,000 inline style sites can read a name instead of a number",
   so `fontSize: TYPE.dense` is the system WORKING and banning the spelling
   would forbid the escape hatch the design provides. Git merged both
   silently, because they differed only in the body of a const with the same
   name, and the file stopped parsing — `Identifier 'INLINE_SIZE' has
   already been declared`, which no conflict marker announced.

   So T1's half is gone and its lane is folded into T3's machinery instead.
   T3's own block says what should happen next — "when T1 and T2 land,
   `IN_T3_SCOPE` widens to everything and the ratchet goes" — and T1 has
   landed, so it widens by exactly one lane here.

   🚨 T2 LANDED TOO (2026-09-22), so the widening is complete and the ratchet
   IS gone: `IN_ASSERTED_SCOPE` is `() => true`, `T2_INLINE_RESIDUE` and the
   ratchet that used it are deleted, and the app-wide weight assertion is hard.
   T2 arrived with a THIRD design — a spelling ban scoped to its own lane, plus
   ratchets set from `node scripts/ui-audit.mjs` — and T3's value test is
   better on both counts, so what survives from T2 is only what T3's design
   does not already cover: the 11px floor stated in its own right, the
   inventory's coverage control, and the inline-evidence control. The spelling
   ratchets went in the bin, because `fontSize: TYPE.dense` is the system
   working and a spelling count would have gone red on T3 adding one. */

/** T1's lane, plan §5 Wave 1: D.O.G. and O.T.T.E.R. */
const T1_LANE = /^src\/tools\/(?:deck-outline-generator_v0\.514|otter_v0\.3\.1)\//;
/** T2's lane: R.A.B.B.I.T. Landed; its scope is asserted hard below. */
const T2_LANE = /^src\/tools\/rabbit_v0\.1\.0\//;

/** Any side, any width above the hairline, and arbitrary values too. */
const OFF_BORDER = /\bborder(?:-[tblrxyse]{1,2})?-(?:[2-9]\b|\[[^\]]*\])/g;
/* Any corner, every deleted step, and arbitrary values. `rounded-full` is NOT
   here: §3.3's deletion list is "2, 4, 5, 8, 10px" and the 48 live sites are
   dots, avatars, icon circles and pill progress tracks — squaring a circular
   avatar is a view change (C1), not a token swap. */
const OFF_RADIUS = /\brounded(?:-(?:[tblr]|tl|tr|bl|br|[se]{1,2}))?(?![-\w])|\brounded(?:-(?:[tblr]|tl|tr|bl|br|[se]{1,2}))?-(?:(?:sm|md|lg|xl|[2-9]xl)\b|\[[^\]]*\])/g;
const TRANSITION_ALL = /\btransition-all\b/g;

/* ── T1: O.T.T.E.R.'S READING SURFACE, WHICH LIVES IN CSS AND WHICH NOTHING
   IN THIS REPO COULD SEE.

   Every assertion above sweeps the JS and JSX under `src`.
   `.lesson-content` is a block of plain CSS in `src/index.css`, so all of
   them were silent over it
   — and so was `ui-page-check.mjs`, which walks `/otter` but never clicks
   into a lesson, so the element it would have to measure is not in the DOM
   when it looks. The result was a surface carrying h1 at 24px, h3 at 17.6px
   and inline code at 14.4px while twelve pages reported "0 off-scale".

   These read the stylesheet directly. The one spelling that is NOT a defect
   — a read of the step's own token — is excluded inside each pattern rather
   than in a judge, because a judge would have to re-find the value and
   re-deciding the same thing twice is the drift this file exists to stop. */
/* 🚨 THE LOOKAHEAD SITS IMMEDIATELY AFTER THE COLON, BEFORE ANY `\s*`, AND
   THAT IS THE WHOLE TRICK. Written the natural way —
   `font-size:\s*(?!var\(--text-)` — the `\s*` BACKTRACKS to zero width, the
   lookahead is then evaluated against the SPACE rather than the value, a
   space is not `var(`, and the exemption silently inverts: every token read
   in the file was reported as a defect. It cost this file's own control one
   red run to find. Consume nothing before deciding. */
/* 🚨 `\s*` BEFORE THE COLON AND `i` ON EVERY ONE, because `font-size : 1.5rem`
   and `FONT-SIZE: 1.5rem` are both legal CSS and both were invisible to the
   first draft. The `\s*` goes BEFORE the colon and never between the colon and
   the lookahead — see the next comment, which is the opposite trap.

   🚨 AND `!important` IS PART OF THE VALUE. `font-weight: 600 !important`
   was reported as a DEFECT, because the exemption demanded `[;}]` directly
   after the digits. This very block already carries two `!important`
   declarations, so the idiom is live here — and a guard that goes red on the
   system's own vocabulary teaches the next session to weaken the regex
   instead of fixing the CSS. */
/* `!\s*important`, not `!important`: a space between the bang and the word is
   legal CSS, and round one fixed the common spelling rather than the general
   one — so `font-weight: 600 ! important` was still reported as a defect. */
const END = String.raw`\s*(?:!\s*important\s*)?[;}]`;
/* ⚠️ The `i` flag makes the EXEMPTION case-insensitive too, so
   `font-size: var(--TEXT-BODY)` reads as on-system although CSS custom
   property names are case-SENSITIVE and that is an undefined variable. And
   `var(--text-anything)` is exempt, not only a size token. Both are
   contrived while every `--text-*` token in `@theme` is a type token; the
   note is here so the next reader does not have to rediscover it. */
const CSS_OFF_SIZE = new RegExp(String.raw`font-size\s*:(?!\s*var\(--text-)\s*[^;}]+`, 'gi');
const CSS_OFF_LEADING = new RegExp(String.raw`line-height\s*:(?!\s*var\(--text-)\s*[^;}]+`, 'gi');
const CSS_OFF_WEIGHT = new RegExp(
  String.raw`font-weight\s*:(?!\s*(?:400|600)${END}|\s*var\(--text-)\s*[^;}]+`, 'gi');

/* 🚨 THE SHORTHAND IS THE ROOT; THE THREE ABOVE ARE SPELLINGS OF IT.
   `font: 700 1.5rem/1.7 sans-serif` sets size, leading AND weight in one
   declaration and was silent to all three detectors at once. That is this
   file's own rule 2 — "anchor on the utility ROOT, not on one spelling" —
   restated for CSS, and T1 wrote all three detectors without noticing it.
   A reading surface has no business using the shorthand, so this bans it
   outright rather than trying to parse it. */
/* 🚨 A LOOKBEHIND, NOT A LIST OF DELIMITERS. Round one wrote
   `(?:^|[;{])\s*font\s*:`, which misses a shorthand that follows a nested
   block's `}` — `{ & em { … } font: 700 1.5rem/1.7 sans-serif; }` was invisible
   to all four detectors. It is masked today only because the same correction
   forbids nesting in this block, so the one backstop depends on the other:
   the day A3 nests legitimately and relaxes that check, the hole opens with
   nothing under it. Asking "is this the property `font` and not `font-size`"
   needs no delimiter list at all. */
const CSS_SHORTHAND = /(?<![-\w])font\s*:/gi;
/** §3.1: "Measure 60 to 66ch, set in `ch`." Either the literal or the token
 *  that carries it — `--measure-reading` is 66ch and is asserted to be in the
 *  band by its own case below, so a rule reading it is in the band too. */
const CSS_MEASURE = /max-width\s*:\s*(?:(?:6[0-6])ch\b|var\(--measure-reading\))/i;
/** The band itself, so the token cannot drift out of it unnoticed. */
const MEASURE_TOKEN = /--measure-reading:\s*(6[0-6])ch\s*;/;

/**
 * Every `.lesson-content` rule in `index.css`.
 *
 * 🚨 A REGEX CANNOT DO THIS AND THE FIRST VERSION PROVED IT. T1 shipped
 * `/\.lesson-content[^{}]*\{[^{}]*\}/g`, and `[^{}]*\}` cannot cross a nested
 * brace — so a rule written with CSS nesting (legal in Tailwind v4 and every
 * current browser) or wrapping an `@media` does not get TRUNCATED, it
 * DISAPPEARS, taking its declarations with it. A reviewer rewrote two real
 * rules with nesting, left a live `font-size: 1.5rem` and `font-weight: 700`
 * inside them, and every assertion below — INCLUDING its control — stayed
 * green. That is the `(0 test)` failure mode this file has now met three
 * times on this branch, reached by nothing worse than a routine CSS
 * modernisation.
 *
 * So: walk the braces and count depth. `source` is a parameter so a control
 * can run the REAL pipeline over a synthetic stylesheet — the whole point of
 * finding 2 against the first draft was that nothing proved this function's
 * output ever reaches a detector.
 *
 * The `(?![\w-])` after the class name stops `.lesson-content-wrapper` being
 * swept in as if it were part of this block.
 */
function extractLessonRules(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  const head = /\.lesson-content(?![\w-])[^{};]*\{/g;
  let m;
  while ((m = head.exec(css))) {
    let depth = 1, i = m.index + m[0].length;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    out.push(css.slice(m.index, i));
    head.lastIndex = i;
  }
  return out;
}
/* Read once. Six uncached reads of a 113 KB file is trap 12 in miniature, and
   the block beside this one already computes its rows at module scope. */
let LESSON_RULES = null;
const lessonRules = () => (LESSON_RULES ??= extractLessonRules(readFileSync('src/index.css', 'utf8')));
/** The selectors this block is REQUIRED to carry. A rule that vanishes from
 *  the sweep takes its name with it, so naming them is what makes a
 *  disappearance loud rather than silent. */
const LESSON_SELECTORS = ['h1', 'h2', 'h3', ' p ', 'li', 'code', 'pre', 'blockquote', 'th', 'td'];

/** A leading set by hand on an element that already carries a scale step.
 *  §3.1 gives every step one leading; 156 sites override it anyway. */
const LEADING_OVERRIDE = /\bleading-(?:tight|snug|normal|relaxed|loose|none|\[[^\]]*\])\b/;
/** Measured 2026-09-22: 19 in T1's lane, 38 in T2's, 99 in the rest. */
const STEP_LEADING_RESIDUE = 156;
const WHITE_GROUND = /\bbg-white(?:\/\d+)?\b/g;
const OFF_SPACING = /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-\[[\d.]+(?:px|rem|em)\]/g;
/* The INVARIANT ("no vh in any padding"), not the shape of today's ternary:
   the first version required a parenthesised condition with the vh in the
   false arm, and dropping two parentheses walked straight past it. */
/* `[^;\n]*` cannot cross a newline, so a prettier reflow that put the ternary
   on its own line walked straight past this — and so did a template literal,
   `padding: ${pad}vh 0`. Bounded, newline-tolerant, and it no longer requires
   the digits to be literal.
   🚨 AND NO LEADING `\b`: in `3vh` there is no boundary between `3` and `v`,
   both being word characters. That is the trailing/leading-boundary trap for
   the third time in this bundle — `text-[12px]"`, `font-[550]`, and now this. */
const VH_PADDING = /padding[A-Za-z]*\s*:[\s\S]{0,120}?vh\b/g;

/* 🚨 READ THE TREE ONCE. Uncached sweeps over 271 files pushed four unrelated
   tree-walking tests past their 5s timeout under vitest's parallel workers and
   tripled the whole suite's wall clock, while passing in a second on their
   own. A guard that makes other tests fail is worse than no guard: the next
   session debugs the wrong thing. */
let TREE = null;
function tree() {
  if (!TREE) {
    TREE = sourceFiles().map((file) => {
      const src = readFileSync(file, 'utf8');
      return { file, src, guarded: protectedRanges(src) };
    });
  }
  return TREE;
}

/** Collect matches of `re` across the scope, skipping protected regions. */
function sweep(re, judge) {
  const out = [];
  for (const { file, src, guarded } of tree()) {
    const r = new RegExp(re.source, 'g');
    let m;
    while ((m = r.exec(src))) {
      if (isProtected(guarded, m.index)) continue;
      const run = enclosingRunRaw(src, m.index) || '';
      const tag = enclosingTag(src, m.index);
      const line = src.slice(0, m.index).split('\n').length;
      /* A NARROW window around the token, for judges that must not be fooled
         by something elsewhere in the same className template — see the border
         judge, where one unrelated ternary anywhere in a long template used to
         exempt every border in it. */
      const near = src.slice(Math.max(0, m.index - 140), m.index + 140);
      if (!judge || judge({ token: m[0], run, tag, file, near, src, index: m.index })) {
        out.push(`${file}:${line}  ${m[0]}  [${run.replace(/\s+/g, ' ').slice(0, 90)}]`);
      }
    }
  }
  return out;
}

/** Does `re` fire on `s`? Every control goes through this, against the SAME
 *  const the assertion uses, so the two cannot drift apart. */
const fires = (re, s) => new RegExp(re.source, re.flags.replace('g', '')).test(s);

describe('the sweep can see the app', () => {
  it('reads the whole converted scope', () => {
    expect(sourceFiles().length).toBeGreaterThan(200);
    expect(sweep(SCALE_STEP).length).toBeGreaterThan(2000);
  });

  it('🚨 no in-scope file is swallowed whole by one protected range', () => {
    // An unmatched `<style>` inside a COMMENT used to protect to end of file,
    // and `NotesView.jsx` — 821 lines — was 99.9% invisible to the passes AND
    // to every assertion below. It failed silently and in the safe-LOOKING
    // direction, which is what made it dangerous.
    //
    // The signal is ONE RANGE swallowing the file, not total coverage: this
    // repo writes very long explanatory comments and several real files are
    // 70–90% comment by bytes, which is healthy. Measured, the largest
    // legitimate single range is 57.5% (one header comment in
    // `adapters/index.js`); NotesView's was ~99%.
    const blind = [];
    for (const { file, src, guarded } of tree()) {
      if (src.length < 4000) continue;
      const widest = guarded.reduce((a, [s, e]) => Math.max(a, e - s), 0);
      const pct = (100 * widest) / src.length;
      if (pct > 75) blind.push(`${file}  one range covers ${pct.toFixed(1)}%`);
    }
    expect(blind, `files the guard cannot see:\n${blind.join('\n')}`).toEqual([]);
  });
});

describe('type scale — no size off the seven steps (C7, plan §3.1)', () => {
  it('has no off-scale size anywhere in converted source', () => {
    const hits = sweep(OFF_SCALE);
    expect(hits, `off-scale sizes:\n${hits.join('\n')}`).toEqual([]);
  });

  it('CONTROL: the size detector fires on every spelling it claims to cover', () => {
    for (const s of ['text-[10.5px]', 'text-xs', 'text-sm', 'text-6xl', 'text-[0.75rem]']) {
      expect(fires(OFF_SCALE, `a ${s} b`), s).toBe(true);
    }
    for (const s of ['text-dense', 'text-label', 'var(--text-sm)', 'text-stone-500']) {
      expect(fires(OFF_SCALE, `a ${s} b`), s).toBe(false);
    }
  });
});

describe('the Label step is for labels (the C3b lesson)', () => {
  /* Two functions on purpose: the assertion wants the exceptions removed, the
     control wants them still visible so it can check they describe something
     real. One function serving both is how the control ended up asserting the
     opposite of what it meant. */
  const bareLabelsRaw = (applyExceptions) => sweep(SCALE_STEP, ({ token, run, tag, near }) => {
    if (token !== 'text-label') return false;
    if (LABEL_EVIDENCE.some((re) => re.test(run))) return false;
    if (CONTROL_TAGS.test(tag)) return false;
    if (!applyExceptions) return true;
    // 🚨 THE EXEMPTION IS PER SITE, NOT PER FILE. Keying it on the path alone
    // exempted every line of HelpPage.jsx: a reviewer planted a fresh,
    // unrelated bare label there and the assertion stayed green. The marker
    // has to be near the hit, not merely somewhere in the file.
    return !BARE_LABEL_EXCEPTIONS.some((x) => near.includes(x.marker));
  });
  const bareLabels = () => bareLabelsRaw(true);

  it('every text-label site still carries its uppercase', () => {
    const unexpected = bareLabels();
    expect(unexpected, `text-label sites with no uppercase:\n${unexpected.join('\n')}`).toEqual([]);
  });

  it('CONTROL: each named exception is still exactly the site it describes', () => {
    for (const x of BARE_LABEL_EXCEPTIONS) {
      const entry = tree().find((t) => t.file === x.file);
      expect(entry, `${x.file} is allowlisted but not in scope`).toBeTruthy();
      expect(entry.src.includes(x.marker), `${x.file} no longer contains ${x.marker}`).toBe(true);
      expect(bareLabelsRaw(false).some((hit) => hit.startsWith(`${x.file}:`)),
        `${x.file} is allowlisted but clean now`).toBe(true);
      // …and the exemption must actually be doing work: with it applied, the
      // site is gone.
      expect(bareLabels().some((hit) => hit.startsWith(`${x.file}:`)),
        `${x.file}'s exemption is not firing`).toBe(false);
    }
  });

  it('no uppercase site sits on a running-text step', () => {
    const shouting = sweep(SCALE_STEP, ({ token, run, tag }) =>
      (token === 'text-body' || token === 'text-caption')
      && /\buppercase\b/.test(run)
      && !CONTROL_TAGS.test(tag));
    expect(shouting, `uppercase on a running-text step:\n${shouting.join('\n')}`).toEqual([]);
  });

  it('CONTROL: the label rule distinguishes the two cases', () => {
    expect(LABEL_EVIDENCE.some((re) => re.test('text-label text-ink-2'))).toBe(false);
    expect(LABEL_EVIDENCE.some((re) => re.test('text-label uppercase text-ink-2'))).toBe(true);
  });
});

describe('weight and tracking (§3.1: the scale has 400 and 600)', () => {
  it('has no weight class off the 400/600 axis', () => {
    const hits = sweep(OFF_WEIGHT);
    expect(hits, `weights off the 400/600 axis:\n${hits.join('\n')}`).toEqual([]);
  });

  /* The ratchet that sat here (11 → 7 → 1) is gone: all three lanes have
     landed, so the app-wide claim is asserted HARD at the bottom of this
     file, with the frozen transition title as its one named exception. The
     first draft of the assertion ABOVE made a claim about WEIGHT and checked
     only class names, which is why an inline one has to be asserted at all —
     `fontWeight: 'bold'` sat four times in App.jsx underneath it. */

  it('has no named tracking except on a label that kept its capitals', () => {
    // Eleven eyebrows inherit their size, carry no step, and were left whole
    // rather than given one — an inherited size becoming 11px is a layout call.
    // Their tracking stays WITH their capitals; the pair is the exception.
    const hits = sweep(NAMED_TRACKING, ({ run }) => !/\buppercase\b/.test(run));
    expect(hits, `tracking with no capitals to track:\n${hits.join('\n')}`).toEqual([]);
  });

  it('CONTROL: the weight and tracking detectors fire on every spelling', () => {
    for (const s of ['font-bold', 'font-medium', 'font-black', 'font-[550]']) {
      expect(fires(OFF_WEIGHT, `a ${s} b`), s).toBe(true);
    }
    expect(fires(OFF_WEIGHT, 'a font-semibold b')).toBe(false);
    expect(fires(NAMED_TRACKING, 'a tracking-widest b')).toBe(true);
    expect(fires(NAMED_TRACKING, 'a tracking-[0.06em] b')).toBe(false);
    expect(offAxisWeightIn("fontWeight: 'bold'")).toBe(true);
    expect(offAxisWeightIn('fontWeight: 600')).toBe(false);
    // 🚨 Round one: every one of these was invisible to the first version,
    // which demanded the weight immediately after the colon. The second was
    // LIVE in R.A.B.B.I.T. at the time.
    expect(offAxisWeightIn('fontWeight: cond ? 700 : 400')).toBe(true);
    expect(offAxisWeightIn('fontWeight: w ? 700 : undefined')).toBe(true);
    expect(offAxisWeightIn('fontWeight: hovered && 700')).toBe(true);
    expect(offAxisWeightIn('fontWeight: Number(700)')).toBe(true);
    expect(offAxisWeightIn('fontWeight: 800')).toBe(true);
    expect(offAxisWeightIn('fontWeight: 300')).toBe(true);
    expect(offAxisWeightIn('fontWeight: 600 // was 700 before pass 2')).toBe(false);
    expect(offAxisWeightIn('fontWeight: 700 // on the axis, honest')).toBe(true);
  });
});

describe('O.T.T.E.R.s reading surface is on the scale (§3.1, plan §5 T1)', () => {
  const lessonCss = () => lessonRules().join('\n');

  it('CONTROL: the stylesheet is actually being read, rule for rule', () => {
    /* 🚨 EXACT, NOT A FLOOR. T1 shipped `>= 15` over a 17-rule block, which
       left two rules free to disappear in silence — and a reviewer made two
       disappear, with a live `font-size: 1.5rem` inside them, while this
       control stayed green. A floor on a COUNT OF RULES guards nothing:
       rules are not a quantity that is supposed to trend downwards. */
    /* `toBe(17)` is a poor SPECIFICATION — it fails with "expected 18 to be
       17" and invites the next reader to bump the number. It stays because it
       is the only assertion that proves `lessonRules()` read the real
       `src/index.css` end to end: the pipeline control below exercises
       `extractLessonRules` over synthetic strings and never touches the
       cached real-file reader. It is a denominator, and the selector list
       under it carries the specification. */
    expect(lessonRules().length).toBe(17);
    const css = lessonCss();
    /* 🚨 A BOUNDARY, BECAUSE `.lesson-content p` IS A SUBSTRING OF
       `.lesson-content pre`. Round one wrote the list with `' p '` — it saw
       that `p` needs one — and then threw it away with `.trim()` inside a
       `toContain`. A reviewer deleted the `p` rule outright, split
       `ul, ol` into two so the count stayed 17, and the whole block including
       this control stayed GREEN: the `pre` rule was answering for the
       paragraph rule. That is the disappearance this control exists to make
       loud, passing silently, on the one selector it was written for. */
    for (const sel of LESSON_SELECTORS) {
      const name = sel.trim();
      expect(new RegExp(`\\.lesson-content ${name}(?![\\w-])`).test(css),
        `the .lesson-content ${name} rule is missing from the sweep`).toBe(true);
    }
    // Nesting is what made rules vanish. The extractor walks it now; this says
    // no one has to rely on that being right in this block.
    expect(css.match(/\{[^{}]*\{/), 'a nested block appeared in .lesson-content').toBe(null);
  });

  it('every font-size in .lesson-content is a step token', () => {
    const hits = lessonCss().match(CSS_OFF_SIZE) || [];
    expect(hits, `off-token sizes in the lesson surface:\n${hits.join('\n')}`).toEqual([]);
  });

  it('every line-height in .lesson-content is the step own (§3.1: one leading)', () => {
    const hits = lessonCss().match(CSS_OFF_LEADING) || [];
    expect(hits, `hand-set leadings:\n${hits.join('\n')}`).toEqual([]);
  });

  it('every font-weight in .lesson-content is on the 400/600 axis', () => {
    const hits = lessonCss().match(CSS_OFF_WEIGHT) || [];
    expect(hits, `weights off the axis:\n${hits.join('\n')}`).toEqual([]);
  });

  it('the font shorthand is not used — it would hide all three at once', () => {
    const hits = lessonCss().match(CSS_SHORTHAND) || [];
    expect(hits, `the font shorthand sets size, leading and weight invisibly:\n${hits.join('\n')}`)
      .toEqual([]);
  });

  it('a scale step keeps its own leading, and the override count does not grow', () => {
    /* 🚨 A RATCHET, BECAUSE T1's FIX WAS ONE SITE OF NINETEEN IN ITS OWN LANE.
       This bundle argued "three leadings where §3.1 asks for one per step" as
       the reason to rewrite `.lesson-content`, then removed exactly one
       `leading-tight` from a file it was already editing — and a reviewer
       found eighteen more in D.O.G. and O.T.T.E.R. alone, including the same
       shape one file over. Either a step owns its leading, in which case the
       fix was 5% done, or `leading-relaxed` on long prose is a legitimate
       exception, in which case the removal had no principle behind it. It is
       the second, mostly: T0 left `text-dense … leading-relaxed` standing
       across the app on purpose, and deciding site by site is lane work.

       So this asserts nothing about the 156 that exist and everything about
       the 157th. The number may fall, never rise. 19 are T1's lane (A1/A2),
       38 are R.A.B.B.I.T.'s (lane B), 99 are the rest of the app. */
    const hits = sweep(SCALE_STEP, ({ run }) => LEADING_OVERRIDE.test(run));
    expect(hits.length, `a scale step with a hand-set leading:\n${hits.slice(0, 20).join('\n')}`)
      .toBeLessThanOrEqual(STEP_LEADING_RESIDUE);
    // The denominator: this really is a live, non-empty pattern, not a regex
    // that stopped matching.
    expect(hits.length, 'LEADING_OVERRIDE matches nothing — it has stopped working')
      .toBeGreaterThan(50);
  });

  it('the measure is on the PROSE rule, and the token is in §3.1s band', () => {
    /* 🚨 NOT "somewhere in the block". T1 asserted `CSS_MEASURE` against the
       whole joined string, so a reviewer put the prose back to 74ch, dropped a
       66ch onto `pre code`, and the assertion stayed green over the exact
       before-value this bundle exists to have removed. The measure has to be
       on the rule that carries the paragraphs. */
    /* 🚨 AND IT HAS TO SELECT PARAGRAPHS UNCONDITIONALLY. Round one asked
       only whether the token `p` appeared anywhere in the selector, which a
       reviewer defeated in one line:

           .lesson-content :is(h1, h2, h3, blockquote) p { max-width: … }

       — a measure that applies to paragraphs INSIDE a heading or a quote and
       to nothing else, leaving every top-level paragraph uncapped at the full
       container width, which is the 74ch defect this bundle exists to have
       removed. Green, under an assertion titled "the measure is on the PROSE
       rule". So the selector must reach `p` directly from `.lesson-content`:
       one descendant step, nothing after it. */
    const selectorOf = (r) => r.slice(0, r.indexOf('{')).trim();
    const DIRECT_P = /^\.lesson-content\s+(?:p|:is\([^)]*\bp\b[^)]*\))\s*(?:,|$)/;
    const prose = lessonRules().filter((r) =>
      selectorOf(r).split(',').some((one) => DIRECT_P.test(one.trim().startsWith('.lesson-content')
        ? one.trim() : `.lesson-content ${one.trim()}`)));
    expect(prose.length, 'no .lesson-content rule selects paragraphs directly').toBeGreaterThan(0);
    expect(prose.some((r) => CSS_MEASURE.test(r)),
      `no rule selecting p directly carries a 60-66ch measure:\n${prose.map(selectorOf).join('\n')}`)
      .toBe(true);
    expect(readFileSync('src/index.css', 'utf8'), '--measure-reading is outside §3.1s band')
      .toMatch(MEASURE_TOKEN);
  });

  it('CONTROL: the whole pipeline reports a planted defect, not just the regex', () => {
    /* 🚨 THIS IS THE ONE T1 DID NOT HAVE, AND IT IS WHY THE REST WERE BLIND.
       Every case in the control below tests a regex against a string typed in
       THIS FILE. Nothing proved that extract -> join -> match ever reaches a
       detector at all — which is rule 1 of this file's own header, and is
       exactly the demonstration a reviewer used to prove T0's border
       assertion inert. `bareLabelsRaw(false)` and `hardCodedInline(re, false)`
       already re-run their real pipelines; this is the third. */
    const clean = `
      .lesson-content h1 { font-size: var(--text-h1); line-height: var(--text-h1--line-height); }
      .lesson-content p { font-size: var(--text-body); max-width: var(--measure-reading); }
    `;
    expect(extractLessonRules(clean).length).toBe(2);
    expect(extractLessonRules(clean).join('\n').match(CSS_OFF_SIZE)).toBe(null);

    // One planted defect per detector, through the REAL extractor.
    const dirty = `
      .lesson-content h1 { font-size: 1.5rem; }
      .lesson-content h2 { line-height: 1.7; }
      .lesson-content h3 { font-weight: 700; }
      .lesson-content pre { font: 700 1.5rem/1.7 sans-serif; }
    `;
    const out = extractLessonRules(dirty).join('\n');
    expect(out.match(CSS_OFF_SIZE), 'pipeline missed a hard-coded size').toHaveLength(1);
    expect(out.match(CSS_OFF_LEADING), 'pipeline missed a hand-set leading').toHaveLength(1);
    expect(out.match(CSS_OFF_WEIGHT), 'pipeline missed an off-axis weight').toHaveLength(1);
    expect(out.match(CSS_SHORTHAND), 'pipeline missed the font shorthand').toHaveLength(1);

    // …and the nesting that used to make a whole rule vanish is now walked.
    const nested = '.lesson-content h2 { color: #fb923c; & { font-size: 1.5rem; } }';
    expect(extractLessonRules(nested).length, 'a nested rule vanished from the sweep').toBe(1);
    expect(extractLessonRules(nested).join('\n').match(CSS_OFF_SIZE),
      'a defect inside a nested block escaped').toHaveLength(1);

    // `.lesson-content-wrapper` is a different class and must not be swept in.
    expect(extractLessonRules('.lesson-content-wrapper { font-size: 99rem; }')).toEqual([]);
  });

  it('CONTROL: each stylesheet detector fires on the defect it replaced', () => {
    // These are the REAL values this surface carried before T1, measured in a
    // browser with a lesson open: h1 1.5rem/700, h3 1.1rem, code 0.9em,
    // p line-height 1.7, li 1.6. The spaced and upper-case spellings are the
    // ones the first draft was silent over; every one is legal CSS.
    for (const s of ['font-size: 1.5rem;', 'font-size: 1.1rem;', 'font-size: 0.9em;',
      'font-size: 16px;', 'font-size: 0.85rem;',
      'font-size : 1.5rem;', 'FONT-SIZE: 1.5rem;', 'font-size:1.5rem;']) {
      expect(fires(CSS_OFF_SIZE, s), s).toBe(true);
    }
    for (const s of ['font-size: var(--text-body);', 'font-size:var(--text-dense);',
      'font-size : var(--text-h2);']) {
      expect(fires(CSS_OFF_SIZE, s), s).toBe(false);
    }

    for (const s of ['line-height: 1.7;', 'line-height: 1.6;', 'line-height: 1.5;',
      'line-height : 1.7;', 'LINE-HEIGHT: 1.7;']) {
      expect(fires(CSS_OFF_LEADING, s), s).toBe(true);
    }
    expect(fires(CSS_OFF_LEADING, 'line-height: var(--text-body--line-height);')).toBe(false);

    for (const s of ['font-weight: 700;', 'font-weight: bold;', 'font-weight: 500;',
      'font-weight : 700;', 'FONT-WEIGHT: 700;', 'font-weight: bolder;']) {
      expect(fires(CSS_OFF_WEIGHT, s), s).toBe(true);
    }
    for (const s of ['font-weight: 600;', 'font-weight: 400;',
      'font-weight: var(--text-h2--font-weight);',
      'font-weight: 600 !important;', 'font-weight: 400 !important;',
      'font-weight : 600;']) {
      expect(fires(CSS_OFF_WEIGHT, s), s).toBe(false);
    }

    for (const s of ['font: 700 1.5rem/1.7 sans-serif;', '{ font:14px/1.4 Geist;',
      '; FONT: bold 1em serif;']) {
      expect(fires(CSS_SHORTHAND, s), s).toBe(true);
    }
    for (const s of ['font-size: 14px;', 'font-family: var(--font-sans);',
      'font-weight: 600;']) {
      expect(fires(CSS_SHORTHAND, s), s).toBe(false);
    }

    // The measure has a BAND, so both edges have to be checked: 74ch was the
    // real before-value and it must not satisfy the assertion.
    for (const s of ['max-width: 66ch;', 'max-width: 60ch;', 'max-width:63ch;',
      'max-width: var(--measure-reading);']) {
      expect(CSS_MEASURE.test(s), s).toBe(true);
    }
    for (const s of ['max-width: 74ch;', 'max-width: 59ch;', 'max-width: 6ch;',
      'max-width: 160ch;', 'max-width: 66chx;', 'max-width: 66.5ch;']) {
      expect(CSS_MEASURE.test(s), s).toBe(false);
    }
    expect(MEASURE_TOKEN.test('  --measure-reading: 66ch;')).toBe(true);
    expect(MEASURE_TOKEN.test('  --measure-reading: 74ch;')).toBe(false);
  });
});

describe('mono is for data, sans for everything else (§3.1)', () => {
  // These cases ARE the map's specification. Each was read out of the tree by
  // hand and judged BEFORE the patterns were written to satisfy it, and the
  // first draft got five of them wrong — which is why they are pinned rather
  // than described.
  const RUN = 'text-dense font-mono';
  const cases = [
    ['{d.toLocaleDateString()}', 'div', RUN, true, 'a timestamp'],
    ['{file.display_name || file.original_name}', 'span', RUN, true, 'a file name, though it contains "name"'],
    ['{stats.taskCount}', 'span', RUN, true, 'a count, though the boundary is a camelCase hump'],
    ['{__OTTER_VERSION__}', 'span', RUN, true, 'a version, though the boundary is an underscore'],
    ['+{fmtCurrency(a, b)}', 'span', RUN, true, 'a figure with a character in front of it'],
    ['{sceneShots.length}', 'span', RUN, true, "a collection's size is a count"],
    ['{fmtCurrency(grand.total)}', 'div', 'text-h1 font-mono', true, "a figure at a heading size (the kit's Stat)"],
    ['{row.code}', 'span', 'text-label font-mono uppercase', true, 'a label rendering a code is still a code'],
    ['{project.title}', 'span', RUN, false, 'a title is prose'],
    ['{member.email}', 'span', RUN, false, 'an address reads as prose in a modern UI'],
    ['No projects yet.', 'div', RUN, false, 'an empty state'],
    ['Contingency', 'td', RUN, false, 'a row label in a table cell'],
    ['{col.label}', 'th', 'text-label font-mono uppercase', false, 'a label rendering a word is a word'],
  ];

  for (const [body, tag, run, keep, why] of cases) {
    it(`${keep ? 'keeps' : 'drops'} mono: ${why}`, () => {
      expect(classifyMono({ tag, run, body }).keep).toBe(keep);
    });
  }

  it('keeps mono: a UNC path standing beside a JSX space', () => {
    // `{' '}` is how JSX spells a significant space. Counting it as an
    // expression skipped the literal test, and three paths in Admin Terminal's
    // storage help — set in mono precisely BECAUSE they are paths — lost it.
    const body = String.raw`\\server\share\... {' '} form instead`;
    expect(classifyMono({ tag: 'span', run: RUN, body }).keep).toBe(true);
  });

  it('a control is sans whatever it holds — the kit already says so', () => {
    for (const tag of ['button', 'select', 'input', 'textarea', 'label']) {
      expect(classifyMono({ tag, run: RUN, body: '{row.id}' }).keep).toBe(false);
    }
  });

  it('code, pre and kbd keep mono whatever they hold', () => {
    for (const tag of ['code', 'pre', 'kbd']) {
      expect(classifyMono({ tag, run: RUN, body: 'No projects yet.' }).keep).toBe(true);
    }
  });
});

describe('surface tokens (§3.3, §3.4, C9)', () => {
  it('has one border width: the 1px hairline', () => {
    // 38 single-side 2px rules are LEFT on purpose: §3.2 gives the signal "a
    // 2px selected-row edge" and F2's Row ships one, so an active-tab underline
    // is an indicator rather than a border that forgot the hairline. They are
    // recognised by a signal colour or a conditional; the 64 structural ones
    // (neutral colour, no ternary) became hairlines.
    // 🚨 Judged by the SAME function pass 4 used, so the two cannot disagree —
    // and it asks whether THIS border is conditional, not whether a ternary
    // exists somewhere in the same className template. "Does the run contain a
    // `?`" exempted every border in any element that had one anywhere: a
    // reviewer planted a structural `border-b-4 border-stone-700` beside an
    // unrelated `${wide ? 'w-full' : 'w-1/2'}` and this stayed green.
    const hits = sweep(OFF_BORDER, ({ src, index }) => !isIndicatorBorder(src, index));
    expect(hits, `border widths off the hairline:\n${hits.join('\n')}`).toEqual([]);
  });

  it('has two radii: rounded-control and rounded-float', () => {
    const hits = sweep(OFF_RADIUS);
    expect(hits, `radii off the two-step system:\n${hits.join('\n')}`).toEqual([]);
  });

  it('has no transition-all', () => {
    const hits = sweep(TRANSITION_ALL, ({ file }) => file !== 'src/components/Home.jsx');
    expect(hits, `transition-all survives:\n${hits.join('\n')}`).toEqual([]);
  });

  it('has no white ground outside the one dark selection fill', () => {
    // `border-white bg-white/20` on O.T.T.E.R.'s checkbox indicator is a
    // selected-state fill on the DARK surface, not a ground. `well-light` is a
    // warm screen for `#f4a261` and would make the selection invisible there.
    const hits = sweep(WHITE_GROUND, ({ file }) => file !== 'src/tools/otter_v0.3.1/Otter.jsx');
    expect(hits, `white grounds:\n${hits.join('\n')}`).toEqual([]);
  });

  it('has no arbitrary spacing off the 4px scale (§3.3)', () => {
    const hits = sweep(OFF_SPACING);
    expect(hits, `arbitrary spacing:\n${hits.join('\n')}`).toEqual([]);
  });

  it('App.jsx takes the one 24px gutter, not a viewport fraction', () => {
    const app = readFileSync('src/App.jsx', 'utf8');
    expect(app).toContain("'var(--spacing-gutter) 0'");
    expect(app.match(VH_PADDING), 'vh in a padding').toBeNull();
  });

  it('CONTROL: every surface detector fires on every spelling it covers', () => {
    for (const s of ['border-2', 'border-b-2', 'border-t-4', 'border-[3px]']) {
      expect(fires(OFF_BORDER, `a ${s} b`), s).toBe(true);
    }
    expect(fires(OFF_BORDER, 'a border b')).toBe(false);
    for (const s of ['rounded', 'rounded-sm', 'rounded-t-sm', 'rounded-3xl', 'rounded-[6px]']) {
      expect(fires(OFF_RADIUS, `a ${s} b`), s).toBe(true);
    }
    for (const s of ['rounded-control', 'rounded-float', 'rounded-full']) {
      expect(fires(OFF_RADIUS, `a ${s} b`), s).toBe(false);
    }
    expect(fires(TRANSITION_ALL, 'a transition-all b')).toBe(true);
    expect(fires(TRANSITION_ALL, 'a transition-colors b')).toBe(false);
    expect(fires(WHITE_GROUND, 'a bg-white/40 b')).toBe(true);
    for (const s of ['py-[5px]', 'space-y-[3px]', 'p-[0.5rem]']) {
      expect(fires(OFF_SPACING, `a ${s} b`), s).toBe(true);
    }
    expect(fires(OFF_SPACING, 'a py-1 b')).toBe(false);
    expect(fires(VH_PADDING, "padding: '3vh 0'")).toBe(true);
    expect(fires(VH_PADDING, "padding: isNarrow ? '3vh 0' : 'x'")).toBe(true);
    expect(fires(VH_PADDING, "paddingTop: '3vh'")).toBe(true);
    expect(fires(VH_PADDING, "padding: 'var(--spacing-gutter) 0'")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// THE INLINE HALF (T3, 2026-09-22)
//
// Everything above guards CLASS names. The inline `style={{}}` sites are the
// residue plan §5 hands to T1 / T2 / T3, and until now this file only
// RATCHETED one of them — the weight count — which says "do not get worse"
// and nothing at all about what is there.
//
// 🚨 THE RIGHT ASSERTION IS NOT "NO INLINE fontSize", AND GETTING THAT WRONG
// WOULD FIGHT THE DESIGN. `tokens.js`'s whole purpose, in its own header, is
// that "the ~2,000 inline style sites can read a name instead of a number".
// An inline size that reads TYPE.h1 is the system working. The audit counts
// the SPELLING because a grep cannot do better; a test can. So what is
// asserted here is the VALUE: every inline type declaration reads a token,
// and a hard-coded one is a defect.
//
// SCOPE. T1 (D.O.G. + O.T.T.E.R.) and T2 (R.A.B.B.I.T.) are working their own
// residue in tandem with this bundle — `IntakePrepare.jsx` alone holds 73 of
// the 164 declarations — so a hard ban app-wide would go red on their
// unfinished work and tell them nothing they do not know. These assertions
// therefore bite over T3's surfaces (everything outside `src/tools/`) while
// the app-wide weight count keeps ratcheting. When T1 and T2 land,
// `IN_T3_SCOPE` widens to everything and the ratchet goes.
// ═════════════════════════════════════════════════════════════════════════════

/** T3's surfaces: the light pages, the shell and auth — i.e. not a tool. */
const IN_T3_SCOPE = (file) => !/(^|\/)tools\//.test(file);

/* 🚨 ALL THREE LANES HAVE LANDED, so this is `() => true` and the widening is
   complete — exactly as T3's block said it would be ("when T1 and T2 land,
   `IN_T3_SCOPE` widens to everything and the ratchet goes"). T1 widened it by
   one lane; T2 (2026-09-22) widens it to the app.

   It is written as a function of `file` rather than deleted because the two
   lane constants are still load-bearing for the controls below, and because
   the NEXT lane to touch this file should see what the predicate was for.
   Every inline type value in `src/**` is now asserted to read a token, with
   three named exceptions and a control that each one covers exactly the
   number of sites it claims. */
const IN_ASSERTED_SCOPE = () => true;

/* The seven steps, enumerated. 🚨 REVIEW ROUND ONE: the first draft accepted
   `TYPE\.[a-z0-9]+`, so `TYPE.huge` — which is `undefined` at runtime — read
   as on-system, and `var\(--(?:text|font)-` accepted `var(--text-xs)` (a
   Tailwind step, not WILSON's) and `var(--font-size-i-invented)`. An
   undefined custom property resolves to nothing and the element silently
   inherits, which is a real defect that reads as compliance. The names are
   listed now. `adminTerminalCss.test.js` had this right already, resolving
   through its `STEP_PX` table; this file simply did not reuse the idea. */
const STEP = 'h1|h2|h3|body|dense|caption|label';
const SUB = 'line-height|letter-spacing|font-weight';
const ON_SYSTEM_OPERAND = new RegExp(
  '^(?:'
  + `(?:TYPE|LEADING|TRACKING|WEIGHT)\\s*\\.\\s*(?:${STEP})`          // TYPE.dense
  + '|TYPE_FLOOR'
  + '|FONT_(?:MONO|SANS)'
  + `|['"\`]?\\s*var\\(--text-(?:${STEP})(?:--(?:${SUB}))?\\)\\s*['"\`]?`
  + '|[\'"`]?\\s*var\\(--font-(?:sans|mono)\\)\\s*[\'"`]?'
  /* 🚨 AN `AUTH_*_STYLE` REFERENCE IS ACCEPTED ON ITS SHAPE, AND ONLY ITS
     SHAPE — a composed STYLE OBJECT, whose own declarations this same sweep
     reads where they are written in AuthShell.jsx, so accepting the
     reference double-counts nothing and hides nothing.
     Round one found that the first draft accepted `AUTH_[A-Z_]+` outright:
     a name-shaped escape hatch, under which a future `const AUTH_H2 =
     '17px'` would have passed on its prefix. A SCALAR `AUTH_*` constant is
     not accepted here; it is resolved against its own declaration by
     `operandOnSystem` below. */
  + '|AUTH_[A-Z_]*STYLE(?:\\s*\\.\\s*\\w+)?'                            // AUTH_INPUT_STYLE.fontSize
  + '|[\'"`]?(?:inherit|initial|unset|revert|normal|none)[\'"`]?'       // resets, not values
  + '|[\'"`]?0(?:px|em|rem)?[\'"`]?'                                    // §3.1: five steps track at zero
  + '|undefined|null'                                                   // "do not set this" is not a value
  + ')$',
);

/* 🚨 REVIEW ROUND ONE, THE TWO THAT MATTERED MOST. The first draft was a
   CONTAINS test over the whole captured value, and a reviewer defeated it two
   ways, both proved end to end:

     fontSize: big ? TYPE.h1 : 9      ← ONE on-system operand launders the other
     fontSize: '9px' // AUTH sets it  ← the COMMENT satisfies the regex

   The second is the dangerous one, because this repo's house style is dense
   explanatory comments and it lets a future session neutralise the assertion
   WITHOUT EDITING THE GUARD. Both are closed here: comments are stripped
   first, then the value is split into operands and EVERY operand must be on
   the system. A ternary's CONDITION is not a value, so it is dropped — `size
   >= 40` is a threshold, exactly as `adminTerminalCss.test.js` reasons about
   the same expression. */
/* `stripInlineComments` is GONE. Round two showed why a regex cannot do
   this job: `.replace(/\/\/.*$/g,' ')` has no idea what a string is, so
   `'a//b'` became `'a` and `'https://x'` became `'https:` — and a live
   `fontWeight: isUrl('//cdn') ? 700 : 400` lost its 700 entirely. Comments
   are skipped inside `inlineValueAt` instead, where the quote state is
   already tracked. */
/* 🚨 ROUND TWO: THE NAMESPACE BELONGS TO THE PROPERTY. The first version
   accepted any of the four token maps for any declaration, so

       fontSize: LEADING.h2      -> 1.3px,  and it PASSED
       fontSize: WEIGHT.h2       -> 600px,  and it PASSED
       fontSize: FONT_MONO       -> a font stack used as a size

   all read as on-system, and the 11px-floor assertion could not catch them
   either because `BELOW_FLOOR` only matches a literal digit. A 1.3px size
   was invisible to both of the things that exist to stop it. A token is
   only on-system for the property whose scale it belongs to. */
const NAMESPACE = {
  fontSize: /^(?:TYPE|TYPE_FLOOR)$/,
  lineHeight: /^LEADING$/,
  letterSpacing: /^TRACKING$/,
  fontWeight: /^WEIGHT$/,
  fontFamily: /^FONT_(?:MONO|SANS)$/,
};

function isOnSystem(rawValue, prop = null) {
  /* Normalised through the SAME scanner the sweep uses, so comments, quotes
     and templates are handled in exactly ONE place. Round two's finding was
     that a second, regex-based comment stripper could not see strings; the
     answer is not a better regex, it is not having a second implementation.
     The `x:` prefix is what gives the scanner a colon to start from. */
  const v = inlineValueAt(`x:${String(rawValue)}`, 0);
  if (!v) return false;
  /* `?.` is a member access, not a branch — normalise it away before the
     splitter can mistake its `?` for a ternary. `??` IS a branch, and both
     of ITS sides are values (unlike a ternary, whose first part is a test),
     so it splits and every side is checked.
     ⚠️ Round two expected `size ?? TYPE.body` to pass. It does not, and that
     is deliberate: `size` is an unknown, and a fallback's LEFT side is the
     value that normally wins. Accepting it would accept `magic ?? TYPE.body`
     where `magic` is 9. The reviewer's real finding — that the splitter
     MANGLED it into the nonsense operand `? TYPE.body` — is fixed; it now
     fails for the right reason, and reporting an unknown is the direction
     this guard fails in everywhere else. */
  const flat = v.replace(/\?\./g, '.');
  const operands = ternaryArms(flat)
    .flatMap((arm) => arm.split(/\?\?/))
    .map((s) => s.trim())
    .filter(Boolean);
  if (!operands.length) return false;
  return operands.every((o) => operandOnSystem(o, prop));
}

/** The token map an operand reads, or null if it reads none.
 *  🚨 The STEP is enumerated here too. The first draft matched
 *  `\.\s*[a-z0-9]+$`, so `TYPE.huge` — the very thing round one enumerated
 *  `ON_SYSTEM_OPERAND` to stop — walked back in through this function, and
 *  with no `prop` to check against it returned true. A second reader of the
 *  same syntax is a second place for the same hole. */
function tokenNamespace(o) {
  const m = o.match(new RegExp(`^(TYPE|LEADING|TRACKING|WEIGHT)\\s*\\.\\s*(?:${STEP})$`))
    || o.match(/^(TYPE_FLOOR|FONT_MONO|FONT_SANS)$/);
  return m ? m[1] : null;
}

/* The VALUES a ternary can produce, with the CONDITIONS dropped — a condition
   is a test, not a size (`size >= 40` is a threshold, which is how
   `adminTerminalCss.test.js` reasons about the very same expression).
   Recursive, because `a ? b : c ? d : e` yields b, d and e, and a flat
   `split('?')` then `split(':')` leaves `c` in the list as though it were a
   value. Scans for the TOP-LEVEL `?` so a `?` inside a string or a nested
   call is not mistaken for one. */
function topLevelIndex(s, chars, from = 0) {
  let depth = 0; let quote = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) { depth++; continue; }
    /* 🚨 ROUND TWO: a FLOOR. Unbounded, one stray closer sent depth negative
       and it never recovered, so `topLevelIndex('a) ? x : y', '?')` returned
       -1 and the whole string was judged as a single operand. Reachable
       whenever an earlier truncation ends a value mid-expression. */
    if (')]}'.includes(c)) { depth = Math.max(0, depth - 1); continue; }
    /* 🚨 ROUND TWO: `??` AND `?.` ARE NOT TERNARIES, and splitting on them
       mangled legitimate values into nonsense — `size ?? TYPE.body` became
       the single operand `? TYPE.body` and FAILED. A false positive sends
       the next session to fix correct code, which is the same harm round
       one named for `border: 1.5px`. */
    if (c === '?' && (s[i + 1] === '?' || s[i + 1] === '.')) {
      if (s[i + 1] === '?') i++;
      continue;
    }
    if (depth === 0 && chars.includes(c)) return i;
  }
  return -1;
}
function ternaryArms(v) {
  const q = topLevelIndex(v, '?');
  if (q < 0) return [v];
  // The `:` that pairs with THIS `?`, skipping any nested ternary between.
  let depth = 0; let colon = -1;
  for (let i = q + 1; i < v.length; i++) {
    const j = topLevelIndex(v, '?:', i);
    if (j < 0) break;
    if (v[j] === '?') { depth++; i = j; continue; }
    if (depth === 0) { colon = j; break; }
    depth--; i = j;
  }
  if (colon < 0) return [v.slice(q + 1)];
  return [...ternaryArms(v.slice(q + 1, colon)), ...ternaryArms(v.slice(colon + 1))];
}
/* A template literal is the app's usual spelling — `` `${TYPE.h1}px` `` —
   because the tokens are numbers and CSS wants units. It is on the system
   when EVERY interpolation is, and when the literal text between them is
   nothing but a unit. Without this arm the anchored operand test would
   reject the most common correct form in the codebase. */
/* A scalar constant is judged on its VALUE, by reading the declaration it
   comes from. That is what closes round one's name-shaped hole: a reference
   is only as on-system as the thing it refers to. Scoped to the auth field
   kit, which is the one place this app declares shared type scalars. */
const AUTH_SHELL = 'src/cloud/auth/AuthShell.jsx';
function resolveAuthScalar(name) {
  const entry = tree().find((t) => t.file === AUTH_SHELL);
  if (!entry) return null;
  const m = entry.src.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*([^\\n]+)`));
  return m ? m[1].replace(/[,;]\s*$/, '').trim() : null;
}

function operandOnSystem(o, prop = null) {
  const scalar = o.match(/^(AUTH_[A-Z_]+)$/);
  if (scalar && !/STYLE$/.test(scalar[1])) {
    const value = resolveAuthScalar(scalar[1]);
    // Unresolvable is NOT a pass: an operand nobody can read is a defect this
    // scan cannot clear, which is the direction T0's trap 4 says to fail in.
    return value !== null && isOnSystem(value, prop);
  }
  /* A CALL or an INDEX over tokens — `clamp(TYPE.dense, 2, 4)`,
     `String(TYPE.h1)`, `TYPE['h1']`. Round two found these reported as
     defects, which is a false positive: they compose tokens, they do not
     invent values. Accepted when every identifier-looking argument is
     itself on the system and no bare number is used as a SIZE. */
  const call = o.match(/^(?:[A-Za-z_$][\w$.]*)\(([\s\S]*)\)$/);
  if (call) {
    const args = call[1].split(',').map((s) => s.trim()).filter(Boolean);
    return args.length > 0 && args.some((a) => tokenNamespace(a))
      && args.every((a) => tokenNamespace(a) || /^\d+(?:\.\d+)?$/.test(a));
  }
  if (!/^`[\s\S]*`$/.test(o)) {
    // The namespace has to match the property (see NAMESPACE above).
    const ns = tokenNamespace(o);
    if (ns) return !prop || !NAMESPACE[prop] || NAMESPACE[prop].test(ns);
    return ON_SYSTEM_OPERAND.test(o);
  }
  const inner = o.slice(1, -1);
  const exprs = [...inner.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
  if (!exprs.length) return false;
  const literal = inner.replace(/\$\{[^}]*\}/g, '').trim();
  if (literal && !/^(?:px|em|rem|%|\s)*$/.test(literal)) return false;
  return exprs.every((e) => isOnSystem(e, prop));
}

/* The three declarations that can carry a hard-coded type value. These find
   the SITE; `inlineValueAt` below reads the value.
   🚨 The key may be QUOTED — `{ 'fontSize': '9px' }` is valid JS and the
   first draft's regexes saw nothing at all (round one, finding 10). */
const INLINE_SIZE = /['"]?fontSize['"]?\s*:/g;
const INLINE_FAMILY = /['"]?fontFamily['"]?\s*:/g;
const INLINE_TRACKING = /['"]?letterSpacing['"]?\s*:/g;
/* 🚨 ROUND ONE, FINDING 6. The commit that introduced `LEADING` justified it
   with "every inline site that wanted the H1 step restated 1.2 from memory"
   — and then converted three objects in `AuthShell.jsx` and left three more,
   in the same file, in the same commit, each sitting directly under a
   converted `fontSize: ${TYPE.caption}px`. A new token with no assertion
   behind it only moves the drift somewhere quieter. */
const INLINE_LEADING = /['"]?lineHeight['"]?\s*:/g;

/* 🚨 A VALUE IS NOT `[^,;\n}]+`, AND THE ROUND-ONE FIX IS WHAT PROVED IT.
   That character class stops at the first `}` — which in this codebase is
   usually the one closing `${TYPE.h2}`, the single most common correct
   spelling in the app. It reported sixteen perfectly good sites as defects
   the moment the value test got strict enough to notice a truncated value.
   It also truncated `fontFamily: 'Geist, sans-serif'` at the comma.

   So the value is SCANNED, not matched: forward from the colon, tracking
   quotes, template interpolations and bracket depth, stopping at a `,` `;`
   `}` or newline that is genuinely at the top level. An evidence window is a
   parser you did not write (T0 §5 trap 7) — so this one is written. */
/* 🚨 ROUND TWO. The first version of this scanner was COMMENT-BLIND, which is
   the same defect, in the same shape, that `ui-inline-type.mjs` had already
   been fixed for and that T0's §5 trap 5 names outright: "an apostrophe in
   JSX prose desynchronises a naive string scanner". A trailing `// don't`
   opened a string that never closed, and the value ran past the newline —
   on a fully unterminated quote it returned the REST OF THE FILE, which is
   T0's trap 4 all over again. Two live sites in this repo reproduced it
   (`SettingsPage.jsx:1203` → 5,696 characters; `DevFixturesBadge.jsx:41` →
   2,737), and they were invisible only because `isProtected` happened to
   skip them.

   A `}` inside a `/* } *\/` comment also truncated the value, which for the
   SIZE test only over-reports but for the WEIGHT judge UNDER-reports: a real
   `700` hid behind it.

   So comments are skipped here, in the scanner, rather than stripped
   afterwards by a regex that cannot see strings — and an unterminated quote
   or template at end of input returns NOTHING, so the caller reports rather
   than silently clearing a value it never really read. */
function inlineValueAt(src, index) {
  let i = src.indexOf(':', index);
  if (i < 0) return '';
  i += 1;
  const start = i;
  let out = '';
  let depth = 0;                 // ( ) [ ] { } at the current nesting level
  const stack = [];              // 'sq' | 'dq' | 'tpl' | 'expr'
  const top = () => stack[stack.length - 1];
  for (; i < src.length; i++) {
    const c = src[i];
    const t = top();
    if (t === 'sq' || t === 'dq') {
      out += c;
      if (c === '\\') { out += src[i + 1] ?? ''; i++; continue; }
      if ((t === 'sq' && c === "'") || (t === 'dq' && c === '"')) stack.pop();
      continue;                  // a comma or brace inside a string is text
    }
    if (t === 'tpl') {
      out += c;
      if (c === '\\') { out += src[i + 1] ?? ''; i++; continue; }
      if (c === '`') { stack.pop(); continue; }
      // `${` opens a real expression — quotes and braces count again inside it.
      if (c === '$' && src[i + 1] === '{') { stack.push('expr'); out += '{'; i++; }
      continue;
    }
    // ── Comments, OUTSIDE any string. Skipped entirely, never captured.
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      if (nl < 0) { i = src.length; break; }
      i = nl - 1;                // the loop's i++ lands on the newline itself
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return '';    // unterminated: report, do not guess
      i = end + 1;
      out += ' ';
      continue;
    }
    if (c === "'") { stack.push('sq'); out += c; continue; }
    if (c === '"') { stack.push('dq'); out += c; continue; }
    if (c === '`') { stack.push('tpl'); out += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; out += c; continue; }
    if (c === '}') {
      if (t === 'expr' && depth === 0) { stack.pop(); out += c; continue; }
      if (depth === 0) break;    // the brace closing the style object
      depth--; out += c; continue;
    }
    if (c === ')' || c === ']') { if (depth === 0) break; depth--; out += c; continue; }
    if (!stack.length && depth === 0 && (c === ',' || c === ';' || c === '\n')) break;
    out += c;
  }
  // An unclosed string or template means the scan lost its place. Returning
  // '' makes the caller REPORT the site, which is the direction to fail in.
  if (stack.length) return '';
  void start;
  return out.trim();
}

/* The fifth spelling. It has no value test because there are only two answers
   and one of them — `uppercase` — is the Label step's own, so what matters is
   whether the declaration exists at all in a lane that has landed. */
const INLINE_CASE = /textTransform\s*:/g;

/* 🚨 `fontSize: 10` AND `fontSize: '10px'` AND `fontSize: 9.5`, and NOT
   `fontSize: 100`, and NOT `fontSize: '0.9em'`. Two lookaheads, both earned:
     (?![\d.])   without it `fontSize: 110` matches as an "11" and a real
                 below-floor site hides behind a lookalike. The boundary trap
                 once more — the shape that made T0's first inventory report
                 706 sites instead of 2,584 — except `\b` cannot help, since
                 `10` and `100` share one.
     (?![a-z%])  a RELATIVE size is not a px value. The first draft flagged
                 Otter's `fontSize: '0.9em'` on a `<code>` element, which is
                 90 percent of whatever it inherits — 11.7px inside Dense. */
const BELOW_FLOOR = /fontSize\s*:\s*['"]?(?:10|\d)(?:\.\d+)?(?![\d.])(?:px)?['"]?(?![a-z%])/g;

/* 🚨 THE SAME CLAIM, ASKED OF ONE ARM. `BELOW_FLOOR` above is a regex over raw
   source, so a ternary hides from it: `fontSize: wide ? TYPE.dense : 9` has
   `wide` after the colon and the digit test never runs. `isOnSystem` already
   refuses to let one arm vouch for the other on the TOKEN assertion; the FLOOR
   assertion needs the same reach, and gets it by asking each arm in units. A
   px value under 11 is a violation; an em, a rem, a percent and a token are
   not — `0.9em` is 90 percent of whatever it inherits. */
const belowFloorArm = (v) => {
  const m = /^['"]?(\d+(?:\.\d+)?)(?:px)?['"]?$/.exec(String(v).trim());
  return !!m && Number(m[1]) < 11;
};

/* 🚨 A WIDER WINDOW THAN `sweep`'s ±140, AND THE WIDTH IS MEASURED. The frozen
   transition title is five consecutive declarations, and from its `fontSize`
   the nearest string that identifies the element — the `title-hold` test —
   ends at about 155 characters. At ±140 two of the five matched their own
   exception and two did not, which would have read as a real defect inside a
   block C2 forbids touching. Windows are measured, not picked (T0 §5 #18). */
const EXEMPT_WINDOW = 400;

/* Keyed on the file AND a marker near the site, never on the file alone: a
   bare path exempts everything in it, and a reviewer proved exactly that
   against this file's other allowlist by planting a fresh unrelated defect.
   `sites` pins how many hits the entry may swallow, so a marker that starts
   covering its neighbours FAILS rather than widening in silence. */
const INLINE_TYPE_EXCEPTIONS = [
  {
    file: 'src/App.jsx',
    marker: "transitionState === 'title-hold'",
    sites: 2,
    why: 'the page-transition title, frozen by C2 and Q18: it keeps its own '
      + '16.8px and 0.3em and takes only the app face',
  },
  {
    file: 'src/cloud/auth/AuthShell.jsx',
    // The declaration itself, two lines above the use. The prose that
    // explains it sits 23 lines up, which is outside the ±400 window — a
    // marker has to be NEAR the site, and "near" is measured, not assumed.
    marker: 'const AUTH_CODE_TRACK =',
    sites: 1,
    why: "the one-time-code field's tracking. FUNCTIONAL, not decorative — it "
      + 'spaces the digits so they can be read back off a phone — so it is '
      + 'not one of §3.1\'s two tracked steps and does not belong in @theme. '
      + 'T0 left the operator console\'s copy for the same reason. It is '
      + 'named HERE rather than passing on its `AUTH_` prefix, because round '
      + 'one showed the prefix was a name-shaped escape hatch under which a '
      + "future `const AUTH_H2 = '17px'` would also have passed",
  },
  {
    file: 'src/cloud/auth/AuthShell.jsx',
    marker: 'metrics pin 1.2 and the two must agree',
    sites: 1,
    why: "AUTH_INPUT_STYLE's `lineHeight: '1.2'` — explicitly NOT the Body "
      + "step's 1.5, because AuthPasswordInput's mask pins 1.2 and the two "
      + 'layers must agree. Leaving it unset resolved to 1.5 and the plain '
      + "fields came out 36.17px tall against the password field's 31.06px",
  },
  {
    file: 'src/cloud/auth/AuthShell.jsx',
    marker: 'const metrics = {',
    sites: 1,
    why: "AuthPasswordInput's mask tracking — load-bearing for caret "
      + 'alignment, proved at 0.00px by scripts/ui-caret-check.mjs, and not a '
      + 'scale value (§3.1 tracks two steps and this is neither of them)',
  },
  /* 🚨 AN `Otter.jsx` ENTRY WAS REMOVED HERE, AND THE MERGE COMMIT BLAMED THE
     WRONG SESSION FOR IT. Round two checked both parents and the record is:
     T1's side had already converted the site to `fontSize: TYPE.body` AND
     removed its own exemption — it was internally consistent. T3's side had
     `fontSize: 14` AND the exemption — also internally consistent. NEITHER
     parent held a stale entry. The staleness was created by combining them,
     which is precisely the class of defect a three-way merge produces and
     neither side can see alone.

     So the finding is not "T1 left a rotten allowlist". It is that an
     exemption and the site it describes can be separated by a MERGE, with
     both sides green, and the only thing that catches it is a control that
     asserts every entry still has a real site to cover rather than merely
     naming a file that exists. That control is below, and it did its job.

     If Monaco ever needs a raw number again, add the entry back WITH the
     number — `fontSize` there is a NUMBER on a third-party API, and
     `TYPE.body` satisfies it because `TYPE` is numbers (tokens.js casts the
     `px` off), not strings. */
];

/** Inline type declarations whose VALUE is hard-coded. `applyExceptions` is a
 *  parameter so a control can run the same sweep with them off — proving the
 *  allowlist does work, rather than sitting beside an already-clean scan. */
/* 🚨 `exceptions` is a LIST, not a boolean, and round one is why. The control
   below used to compute `raw.length - kept.length` with the whole allowlist
   applied, which is the FILE's total rather than the entry's — so the moment
   a second entry landed in `AuthShell.jsx` both entries were measured against
   the same number and both failed, blaming the wrong marker. Passing one
   entry at a time makes the count mean what its comment says. */
function hardCodedInline(re, exceptions = INLINE_TYPE_EXCEPTIONS, inScope = IN_ASSERTED_SCOPE) {
  return sweep(re, ({ file, src, index, token }) => {
    if (!inScope(file)) return false;
    // The PROPERTY decides which token map is legal (NAMESPACE, above).
    const prop = (token.match(/['"]?(\w+)['"]?\s*:/) || [])[1] || null;
    if (isOnSystem(inlineValueAt(src, index), prop)) return false;
    if (!exceptions.length) return true;
    const window = src.slice(Math.max(0, index - EXEMPT_WINDOW), index + EXEMPT_WINDOW);
    return !exceptions.some((x) => x.file === file && window.includes(x.marker));
  });
}

describe('the inline half: every type value reads a token (T3)', () => {
  it('no inline fontSize carries a hard-coded size', () => {
    const hits = hardCodedInline(INLINE_SIZE);
    expect(hits, `inline sizes off the token system:\n${hits.join('\n')}`).toEqual([]);
  });

  it('no inline fontFamily carries a hand-written stack', () => {
    // A quoted `monospace` is the spelling that survived the class pass: T0's
    // pass 3 rewrote `font-mono` and could not see inside a style object.
    const hits = hardCodedInline(INLINE_FAMILY);
    expect(hits, `inline families off the token system:\n${hits.join('\n')}`).toEqual([]);
  });

  it('no inline letterSpacing carries a hard-coded amount', () => {
    const hits = hardCodedInline(INLINE_TRACKING);
    expect(hits, `inline tracking off the token system:\n${hits.join('\n')}`).toEqual([]);
  });

  /* T2's lane had a ratchet here at 77 while it worked. It has landed, and a
     landed lane gets an assertion rather than a number: not "no hard-coded
     VALUE" — which the three assertions above already cover app-wide — but
     the stronger and simpler claim that R.A.B.B.I.T. carries no inline type
     DECLARATION at all, of any spelling, token-valued or not. 105 of them
     went; a table that styled itself from two consts is why it is worth
     saying out loud. */
  /* 🚨 SEVEN `lineHeight` DECLARATIONS (SIX since V1 — see below), AND THE
     TEST'S OWN TITLE WAS WRONG.
     T2 asserted "no type in a style object at all, of any spelling" while
     sweeping five of the six spellings — `lineHeight` was not among them,
     because the assertion that swept it was written by T3 in the same hour
     and was lost in the three-way merge. Round two caught the omission and
     the merge together.

     The seven were real and they are R.A.B.B.I.T.'s. NOT converted here, and
     that is a deliberate refusal rather than an oversight: three of them
     (1.5, 1.5, 1.4) are exact scale values and would be a free swap, but
     four are NOT on the scale at all —

       TimelineView.jsx:2493        lineHeight: 1     a tick label
       IntakePrepare.jsx:176, 293   lineHeight: 1.6   prose
       IntakePrepare.jsx:413        lineHeight: 1.7   prose

     — so converting them would MOVE TEXT on a surface this bundle does not
     own, and §3.1's leadings run 1.2 to 1.5. Choosing 1.6 → Body is a design
     call for whoever holds R.A.B.B.I.T., not a token swap. Pinned so the
     number can only fall, with every site named in T3's hand-off.

     V1 (2026-09-23): SIX, and the "three free swaps" were not alike. T3's
     hand-off named :262 and :382; the lines had drifted to :293 and :413,
     which is why the numbers above are corrected rather than trusted.

       IntakePrepare.jsx:395 (was)  `text-caption` + 1.4 — Caption's OWN
                                    leading, so the declaration restated the
                                    step. Deleted; the four captions measured
                                    16.8px leading and 16.80px boxes at the
                                    same y before and after.
       IntakePrepare.jsx:353, 364   `text-dense` + 1.5 — Body's leading on the
                                    Dense step. A token read would only
                                    SPELL the mismatch; the fix is either the
                                    leading (1.45) or the step (Body, 14px),
                                    and which one is lane B1's call. Filed.

     B1 (2026-09-23): ONE. Lane B1 made the call for all five of
     IntakePrepare's (V1-13): each <p> is Dense prose, so it takes the Dense
     step's own leading (1.45) and the declaration goes — 1.6 and 1.7 were
     off the scale, and 1.5 was Body's leading on the Dense step. The one
     left is TimelineView.jsx's tick label, lane B3's. */
  const T2_LEADING_RESIDUE = 1;
  it('R.A.B.B.I.T. declares no type in a style object, except one leading', () => {
    const spellings = [INLINE_SIZE, INLINE_FAMILY, INLINE_TRACKING, INLINE_WEIGHT, INLINE_CASE];
    const hits = spellings.flatMap((re) => sweep(re, ({ file }) => T2_LANE.test(file)));
    expect(hits, `inline type in T2's lane:\n${hits.join('\n')}`).toEqual([]);

    const leadings = hardCodedInline(INLINE_LEADING, INLINE_TYPE_EXCEPTIONS,
      (f) => T2_LANE.test(f));
    expect(leadings.length, `hard-coded leading in T2's lane:\n${leadings.join('\n')}`)
      .toBeLessThanOrEqual(T2_LEADING_RESIDUE);
  });

  /* 🚨 STATED IN ITS OWN RIGHT, THOUGH THE VALUE TEST ABOVE IMPLIES IT TODAY.
     §3.1's floor is 11px and there is no step under it — a claim about the
     SYSTEM, where the assertions above are claims about the SPELLING of a
     value. The two come apart the moment somebody adds an entry to
     `INLINE_TYPE_EXCEPTIONS`: an exempted `fontSize: '9px'` would pass every
     assertion above it and this one would still go red, which is the whole
     point of writing it down. */
  it('no inline size sits below the 11px floor', () => {
    // Two detectors for one claim, because one of them cannot see a ternary:
    // the regex reads raw source, the arm test reads the VALUE. A reviewer's
    // `fontSize: wide ? TYPE.dense : 9` was caught by the token assertion and
    // walked straight past this one.
    const inArms = sweep(INLINE_SIZE, ({ src, index }) =>
      valueArms(inlineValueAt(src, index)).some(belowFloorArm));
    const hits = [...new Set([...sweep(BELOW_FLOOR), ...inArms])].sort();
    expect(hits, `inline sizes below the 11px floor:\n${hits.join('\n')}`).toEqual([]);
  });

  it('🚨 the inline inventory sees every declaration the audit grep sees', () => {
    // THE CONTROL THAT FOUND A REAL BUG, and it is about the TOOL rather than
    // the tree. `ui-inline-type.mjs` — the inventory that asked T0's map for
    // every one of T2's 105 steps — matched braces quote-aware but
    // comment-BLIND in its first draft, so the apostrophe in App.jsx's "This
    // overlay's own background is" opened a string it never closed and the
    // whole page-transition style object came back as -1. Four declarations
    // vanished silently, in the safe-LOOKING direction, and the smaller number
    // looked entirely plausible. T0's trap 5, one bundle later.
    //
    // So the inventory is not trusted to report its own completeness: this
    // compares it, per file, against the audit's independent grep. Its one
    // exemption is declared in `NOT_A_STYLE` and keyed on a marker from the
    // site, not on the path.
    const bad = coverage().filter((c) => !c.ok)
      .map((c) => `${c.file}: grep ${c.raw}, inventory ${c.seen} (+${c.exempt} exempt)`);
    expect(bad, `files the inline inventory cannot fully see:\n${bad.join('\n')}`).toEqual([]);
  });

  /* 🚨 THE FIFTH SPELLING WAS ASSERTED OVER ONE LANE WHILE THE BLOCK CLAIMED
     THE APP. `textTransform` appeared only in T2's lane assertion, so a
     reviewer added `textTransform: 'capitalize'` to `CurrencyPicker.jsx` and
     the suite stayed green — four-fifths of the app unguarded on the property
     that decides whether text SHOUTS.
     The app-wide claim is about the VALUE, because §3.1 has exactly two cases,
     sentence and UPPER, and `uppercase` on a Label-step element is the system
     working. What it forbids is a third case. */
  it('no inline textTransform invents a case the scale does not have', () => {
    const hits = sweep(INLINE_CASE, ({ src, index }) =>
      valueArms(inlineValueAt(src, index)).some((a) =>
        !/^['"]?(?:uppercase|none|inherit|initial|unset|revert)['"]?$/.test(a.trim())));
    expect(hits, `case values off the two the scale has:\n${hits.join('\n')}`).toEqual([]);
  });

  it('CONTROL: the below-floor detector covers its whole range, arms included', () => {
    // 🚨 1 THROUGH 10, not just the three the other control happens to name:
    // narrowing the detector from 1-10 to 8-10 left every one of those passing.
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9.5, 10.5]) {
      expect(belowFloorArm(String(n)), `${n} is below the floor`).toBe(true);
      expect(belowFloorArm(`'${n}px'`), `'${n}px' is below the floor`).toBe(true);
    }
    for (const v of ['11', "'13px'", '100', '110', '20', "'0.9em'", "'95%'",
      '1.2rem', 'TYPE.dense', "'var(--text-label)'", 'wide']) {
      expect(belowFloorArm(v), `${v} is not a below-floor px value`).toBe(false);
    }
    // …and through the arm splitter, which is how the assertion reaches it.
    expect(valueArms('wide ? TYPE.dense : 9').some(belowFloorArm)).toBe(true);
    expect(valueArms('wide ? TYPE.dense : TYPE.label').some(belowFloorArm)).toBe(false);
  });

  it('CONTROL: every inline detector fires, and only on its own spelling', () => {
    /* 🚨 THE FILE'S OWN RULE 1, APPLIED TO THE CONSTS THAT WERE MISSING IT.
       `INLINE_CASE` appeared in an assertion and in no control, so a reviewer
       replaced it with a never-matching pattern, planted a real
       `textTransform: 'uppercase'`, and the suite stayed green. The others
       were pinned only INCIDENTALLY, by the allowlist's `sites:` counts, which
       is not a pin anybody wrote down. */
    expect(fires(INLINE_SIZE, 'fontSize: 15')).toBe(true);
    expect(fires(INLINE_SIZE, 'text-dense')).toBe(false);
    expect(fires(INLINE_FAMILY, "fontFamily: 'monospace'")).toBe(true);
    expect(fires(INLINE_FAMILY, 'font-mono')).toBe(false);
    expect(fires(INLINE_TRACKING, "letterSpacing: '0.06em'")).toBe(true);
    expect(fires(INLINE_TRACKING, 'tracking-wide')).toBe(false);
    expect(fires(INLINE_CASE, "textTransform: 'uppercase'")).toBe(true);
    expect(fires(INLINE_CASE, 'uppercase')).toBe(false);
    expect(fires(INLINE_LEADING, 'lineHeight: 1.6')).toBe(true);
    expect(fires(INLINE_LEADING, 'leading-relaxed')).toBe(false);
    // 🚨 `INLINE_WEIGHT` was the sixth, and it was missing: three assertions
    // run it, and a mutant that killed it was caught only INCIDENTALLY, by the
    // frozen-title count — which is the shape this control exists to replace.
    expect(fires(INLINE_WEIGHT, 'fontWeight: 600')).toBe(true);
    expect(fires(INLINE_WEIGHT, "fontWeight: 'bold'")).toBe(true);
    expect(fires(INLINE_WEIGHT, 'font-semibold')).toBe(false);
  });

  it("CONTROL: the inventory's own property list cannot be pruned in silence", () => {
    // 🚨 `coverage()` IS ONLY A CONTROL IF ITS TWO SIDES ARE INDEPENDENT.
    // `rawDeclCount` used to loop the same `INLINE_TYPE_PROPS` that `typeDecls`
    // loops, so deleting the single word 'fontSize' — the central property of
    // T2's whole bundle — dropped the inventory from 21 sites to 14 while every
    // coverage row still read ` ok `. The denominator is five literal regexes
    // now, and this keeps the two lists describing the same five properties.
    expect(SPELLINGS_MATCH_PROPS(), 'RAW_SPELLINGS and INLINE_TYPE_PROPS disagree').toBe(true);
    expect(INLINE_TYPE_PROPS).toEqual(
      ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'textTransform']);
  });

  it('CONTROL: every allowlist marker is specific enough to name its site', () => {
    /* 🚨 COUNTING IS NOT ENOUGH IN A FILE WITH ONE DECLARATION. `NOT_A_STYLE`
       keyed its exemption on `src.includes(marker)` — file-keying under
       another name — and a reviewer widened the marker to the single letter
       `e`. The count stayed at 1, because Otter has exactly one declaration to
       count, and the exemption held. So the marker itself is pinned: long
       enough to name something, and rare enough in its own file that it could
       not be pointing anywhere else. Both allowlists go through it. */
    const entries = [
      ...NOT_A_STYLE.map((e) => ({ ...e, sites: e.n, from: 'NOT_A_STYLE' })),
      ...INLINE_TYPE_EXCEPTIONS.map((e) => ({ ...e, from: 'INLINE_TYPE_EXCEPTIONS' })),
    ];
    expect(entries.length, 'both allowlists must be non-empty or this proves nothing')
      .toBeGreaterThan(2);
    for (const e of entries) {
      expect(e.marker.length, `${e.from} ${e.file}: "${e.marker}" is too short to name a site`)
        .toBeGreaterThanOrEqual(6);
      const entry = tree().find((t) => t.file === e.file);
      expect(entry, `${e.from}: ${e.file} is exempted but not in scope`).toBeTruthy();
      const occurrences = entry.src.split(e.marker).length - 1;
      expect(occurrences,
        `${e.from} ${e.file}: "${e.marker}" appears ${occurrences} times but claims ${e.sites}`)
        .toBeLessThanOrEqual(e.sites);
    }
    // And the inventory's own exemption covers exactly the site it claims…
    const na = NOT_A_STYLE[0];
    expect(declsNearMarker(tree().find((t) => t.file === na.file).src, na.marker)).toBe(na.n);
    expect(declsNearMarker('const x = 1', na.marker), 'no declaration, no exemption').toBe(0);
    // …while a loose marker covers more than one, on a synthetic source (the
    // live file holds a single declaration, so the tree cannot show this).
    const synthetic = `const a = { fontSize: 14, marker_ALPHA: true }\n${'\n'.repeat(500)}`
      + 'const b = { fontSize: 12, marker_BETA: true }\n';
    expect(declsNearMarker(synthetic, 'marker_ALPHA')).toBe(1);
    expect(declsNearMarker(synthetic, 'e')).toBe(2);
  });

  /* ── The inventory's own three silent failures, each pinned on a synthetic
        source. All three failed in the safe-LOOKING direction and none is
        visible to `coverage()`: the declaration is still counted, merely
        judged on bad evidence. ── */
  it('CONTROL: a less-than operator does not eat the element it precedes', () => {
    // 🚨 `src.lastIndexOf('<', attrStart)` cannot tell an opening tag from a
    // comparison. Measured over the tree, it disagreed with the quote-aware
    // walk at two live sites, both in R.A.B.B.I.T. (`BudgetView.jsx:699`,
    // `BinFileGrid.jsx:86`). Both escape damage today only because their
    // className sits after the stray `<`; move it and the run comes back
    // EMPTY, which is the map blind — T0's defect #8.
    const clean = `<span className="text-label uppercase" style={{ fontSize: 11 }}>A</span>`;
    const dirty = `<span className="text-label uppercase" onClick={() => n < 3 && go()} style={{ fontSize: 11 }}>B</span>`;
    for (const [what, src] of [['clean', clean], ['with a < operator', dirty]]) {
      const at = src.indexOf('style=');
      const { index, tag } = openTagOf(src, at);
      expect(tag, `${what}: tag`).toBe('span');
      expect(classNameRun(src, index, openingTagEndFromAttr(src, at)), `${what}: class run`)
        .toBe('text-label uppercase');
    }
    // …and the naive version really does differ, so this is not a no-op test.
    const at = dirty.indexOf('style=');
    expect(dirty.lastIndexOf('<', at)).not.toBe(openTagOf(dirty, at).index);
  });

  it('CONTROL: a self-closing element has no text of its own', () => {
    // Without the `/` check, `<Icon style={{…}} />` read the NEXT SIBLING's
    // copy as its own literal text — and that text is what the
    // shouting-sentence rule judges, so a long enough sibling demotes a label.
    const src = `<Icon className="text-caption" style={{ fontSize: 11 }} />\n`
      + 'Total project budget for the quarter';
    const at = src.indexOf('style=');
    expect(ownTextFrom(src, openingTagEndFromAttr(src, at))).toBe('');
    const paired = `<span style={{ fontSize: 11 }}>Real own text</span>`;
    const pAt = paired.indexOf('style=');
    expect(ownTextFrom(paired, openingTagEndFromAttr(paired, pAt))).toBe('Real own text');
  });

  it("CONTROL: the inventory recognises the repo's own mono token", () => {
    /* 🚨 THIS CONTROL USED TO RE-TYPE THE REGEX AS A LITERAL INSTEAD OF CALLING
       THE CODE, which is the file's own rule 1 inside out: a reviewer reverted
       the fix in `ui-inline-type.mjs` and all 2,910 tests stayed green while
       the inventory printed no family verdict for any site the overhaul had
       actually converted. The predicate is exported now and this calls it.
       The fix it pins: the test was written against `'ui-monospace,monospace'`
       and `DATA`, case-sensitively, and could not see `FONT_MONO` — the token
       everything was converted TO, which SHOUTS. */
    for (const v of ["'ui-monospace,monospace'", 'FONT_MONO', 'DATA', "'monospace'"]) {
      expect(isMonoValue(v), `${v} is a mono value`).toBe(true);
    }
    for (const v of ['SANS', 'FONT_SANS', "'var(--font-sans)'", "'Geist'"]) {
      expect(isMonoValue(v), `${v} is not`).toBe(false);
    }
  });

  it('CONTROL: the arm splitter finds a ternary wherever it is hiding', () => {
    /* 🚨 NOTHING TESTED THIS, AND IT WAS WRONG THREE WAYS. `valueArms` is what
       lets the token and floor assertions ask each rendered value separately,
       and a reviewer showed that (a) a LEFT-nested ternary reported its own
       condition as a value, (b) a ternary inside a template literal was never
       split at all, because `isConditional` strips backtick-quoted text before
       looking for a `?`, and (c) a bracketed arm came back opaque. (b) and (c)
       both laundered a 9px arm straight past the 11px floor — the assertion
       that exists as the independent backstop for an allowlisted site. */
    expect(valueArms('a ? b : c ? d : e')).toEqual(['b', 'd', 'e']);      // right-nested
    expect(valueArms('a ? b ? c : d : e')).toEqual(['c', 'd', 'e']);      // LEFT-nested
    expect(valueArms('`${w ? TYPE.h2 : 9}px`')).toEqual(['TYPE.h2', '9']);
    expect(valueArms('(b ? TYPE.h2 : 9)')).toEqual(['TYPE.h2', '9']);
    expect(valueArms('b ? (c ? TYPE.h1 : 9) : TYPE.label'))
      .toEqual(['TYPE.h1', '9', 'TYPE.label']);
    // A condition is never a value, and a call is not a ternary.
    expect(valueArms('size >= 40 ? TYPE.h2 : TYPE.label')).toEqual(['TYPE.h2', 'TYPE.label']);
    expect(valueArms('Math.max(8, size * 0.38)')).toEqual(['Math.max(8, size * 0.38)']);
    // …and each of those hiding places reaches the floor assertion.
    for (const v of ['`${w ? TYPE.h2 : 9}px`', '(b ? TYPE.h2 : 9)',
      'b ? (c ? TYPE.h1 : 9) : TYPE.label']) {
      expect(valueArms(v).some(belowFloorArm), `${v} hides a 9`).toBe(true);
    }
  });

  it('CONTROL: the below-floor detector has both its boundaries', () => {
    for (const s of ['fontSize: 9', "fontSize: '10px'", 'fontSize: 10.5', 'fontSize: 8']) {
      expect(fires(BELOW_FLOOR, s), s).toBe(true);
    }
    // `110` is not an `11`, and `0.9em` is not a px value below the floor —
    // it is 90 percent of whatever it inherits. An assertion about the FLOOR
    // that fires on an em is one nobody can act on.
    for (const s of ['fontSize: 11', "fontSize: '13px'", 'fontSize: 100', 'fontSize: 20',
      "fontSize: '0.9em'", "fontSize: '95%'", 'fontSize: 1.2rem']) {
      expect(fires(BELOW_FLOOR, s), s).toBe(false);
    }
  });

  it('CONTROL: the map reads the inline spelling of its own evidence', () => {
    // `classifySite` looks for `uppercase` and `font-semibold` in a CLASS run,
    // and R.A.B.B.I.T. wrote both in a style object — T0's defect #8 on two
    // more signals. Without this translation nine sites on IntakePrepare alone
    // classify one step wrong, and three of one screen's six eyebrows land on
    // a different step from the other three.
    expect(inlineClassEvidence({ textTransform: ["'uppercase'"] })).toContain('uppercase');
    expect(inlineClassEvidence({ fontWeight: ['600'] })).toContain('font-semibold');
    expect(inlineClassEvidence({ fontWeight: ["'bold'"] })).toContain('font-semibold');
    // 500 is a mood, not a decision — T0's rule, kept.
    expect(inlineClassEvidence({ fontWeight: ['500'] })).toBe('');
    // And a conditional arm is not evidence about every branch (T0 trap 6).
    expect(inlineClassEvidence({ fontWeight: ['on ? 600 : 400'] })).toBe('');
    expect(inlineClassEvidence({ textTransform: ["w ? 'uppercase' : 'none'"] })).toBe('');
  });

  it('CONTROL: the value test accepts tokens and rejects literals', () => {
    for (const v of ['`${TYPE.h1}px`', 'TYPE.dense', "'var(--text-label)'",
      'FONT_MONO', 'AUTH_INPUT_STYLE.fontSize', 'AUTH_TEXT_STYLE',
      'size >= 40 ? TYPE.h2 : TYPE.label', "'inherit'", '0']) {
      expect(isOnSystem(v), `${v} should be on-system`).toBe(true);
    }
    for (const v of ["'16px'", "'0.15em'", "'monospace'", '13', "'16.8px'",
      "'ui-monospace, SFMono-Regular, Menlo, monospace'"]) {
      expect(isOnSystem(v), `${v} should read as a literal`).toBe(false);
    }
  });

  it('CONTROL: one on-system operand cannot launder a hard-coded one', () => {
    // The whole value used to be a CONTAINS test, so the token in one arm
    // vouched for the number in the other.
    expect(isOnSystem('big ? TYPE.h1 : 9')).toBe(false);
    expect(isOnSystem("big ? TYPE.h1 : '9px'")).toBe(false);
    expect(isOnSystem('selected ? 600 : 400')).toBe(false);   // weights are not sizes
    expect(isOnSystem('a ? TYPE.h1 : b ? TYPE.h2 : 11')).toBe(false);
  });

  it('CONTROL: a trailing comment cannot vouch for the value', () => {
    // The most dangerous of the three: this repo's house style is dense
    // explanatory comments, so it let a future session neutralise the
    // assertion WITHOUT EDITING THE GUARD.
    expect(isOnSystem("'9px' /* none of the steps fit here */")).toBe(false);
    expect(isOnSystem("'9px' // AUTH_INPUT_STYLE sets the rest")).toBe(false);
    expect(isOnSystem("'0.15em' // normal for a wordmark")).toBe(false);
    // …and a comment must not break a value that IS on the system.
    expect(isOnSystem('TYPE.dense // the table row step')).toBe(true);
  });

  it('CONTROL: a scalar AUTH_ constant is judged on its value, not its name', () => {
    // Round one: `AUTH_[A-Z_]+` accepted any identifier with the prefix.
    // A composed STYLE object is still accepted on shape — its own
    // declarations are swept where they are written — but a scalar is
    // resolved, so `AUTH_CODE_TRACK` ('0.35em') now needs a named exemption
    // and a hypothetical `AUTH_H2 = '17px'` could never get one by accident.
    expect(isOnSystem('AUTH_TEXT_STYLE')).toBe(true);
    expect(isOnSystem('AUTH_INPUT_STYLE.fontSize')).toBe(true);
    expect(isOnSystem('AUTH_CODE_TRACK')).toBe(false);
    expect(isOnSystem('AUTH_NOT_DECLARED_ANYWHERE')).toBe(false);
  });

  it('CONTROL: a token name that does not exist is not a token', () => {
    // `TYPE.huge` is `undefined` at runtime; `var(--text-xs)` is Tailwind's
    // step, not this app's; an undefined custom property silently inherits.
    expect(isOnSystem('TYPE.huge')).toBe(false);
    expect(isOnSystem("'var(--text-xs)'")).toBe(false);
    expect(isOnSystem("'var(--font-size-i-invented)'")).toBe(false);
    expect(isOnSystem('PROTOTYPE.dense')).toBe(false);   // no left boundary, round one #11
    for (const step of ['h1', 'h2', 'h3', 'body', 'dense', 'caption', 'label']) {
      expect(isOnSystem(`TYPE.${step}`), step).toBe(true);
    }
  });


  it('no inline lineHeight carries a hard-coded leading', () => {
    /* Everywhere but R.A.B.B.I.T., whose seven are pinned by the ratchet in
       the T2 assertion below, with the reason they are not converted here.
       The exclusion goes when they do — it is the last thing between this
       assertion and being app-wide like the other five. */
    const hits = hardCodedInline(INLINE_LEADING, INLINE_TYPE_EXCEPTIONS,
      (f) => IN_ASSERTED_SCOPE(f) && !T2_LANE.test(f));
    expect(hits, `inline leading off the token system:\n${hits.join('\n')}`).toEqual([]);
  });


  /* ═══════════════════════════════════════════════════════════════════════
     ROUND TWO'S DEFEATS, PINNED. Each of these passed against round one's
     corrections and each one hid a real hard-coded value or reported a
     correct one. They are controls rather than prose because round two's
     other finding was that three of round one's corrections had been
     silently REVERTED by a merge — an assertion is the only form of a fix
     that a merge cannot quietly undo.
     ═══════════════════════════════════════════════════════════════════════ */

  it('CONTROL: a token is only on-system for its own property', () => {
    // `fontSize: LEADING.h2` is 1.3px and used to pass BOTH this test and the
    // 11px floor, because the floor only matches a literal digit. A sub-2px
    // size was invisible to both of the things that exist to stop it.
    expect(isOnSystem('LEADING.h2', 'fontSize')).toBe(false);
    expect(isOnSystem('WEIGHT.h2', 'fontSize')).toBe(false);
    expect(isOnSystem('FONT_MONO', 'fontSize')).toBe(false);
    expect(isOnSystem('`${LEADING.h2}px`', 'fontSize')).toBe(false);
    expect(isOnSystem('TYPE.h2', 'letterSpacing')).toBe(false);
    // …and each map is still accepted for the property it belongs to.
    expect(isOnSystem('TYPE.h2', 'fontSize')).toBe(true);
    expect(isOnSystem('LEADING.h2', 'lineHeight')).toBe(true);
    expect(isOnSystem('TRACKING.label', 'letterSpacing')).toBe(true);
    expect(isOnSystem('FONT_MONO', 'fontFamily')).toBe(true);
  });

  it('CONTROL: a comment cannot hide a value, and a string is not a comment', () => {
    // The old stripper was `.replace(/\/\/.*$/g, ' ')`, which has no idea
    // what a string is: `'a//b'` became `'a` and a live
    // `fontWeight: isUrl('//cdn') ? 700 : 400` lost its 700 entirely.
    expect(offAxisWeightIn("fontWeight: isUrl('//cdn') ? 700 : 400")).toBe(true);
    expect(offAxisWeightIn('fontWeight: cond /* } */ ? 700 : 400')).toBe(true);
    expect(isOnSystem("'Geist, sans-serif' // not a token", 'fontFamily')).toBe(false);
    // A `//` inside a string is text, not the start of a comment.
    expect(inlineValueAt("x: 'a//b',", 0)).toBe("'a//b'");
    expect(inlineValueAt("x: 'https://wilson.example',", 0)).toBe("'https://wilson.example'");
  });

  it('CONTROL: the scanner never runs away, and says so when it is lost', () => {
    // An apostrophe in a trailing comment used to open a string that never
    // closed, and the value ran to the end of the FILE — T0's trap 4 in a
    // scanner this bundle wrote. Comments are skipped inside the scan now.
    const runaway = "x: TYPE.h1 // don't\n  color: 'red',\n  fontWeight: 700,\n";
    expect(inlineValueAt(runaway, 0)).toBe('TYPE.h1');
    // A genuinely unterminated quote returns NOTHING, so the caller reports.
    expect(inlineValueAt("x: 'unterminated", 0)).toBe('');
    expect(inlineValueAt('x: `unterminated', 0)).toBe('');
    expect(inlineValueAt('x: /* unterminated', 0)).toBe('');
    // …and an unreadable weight is NOT treated as clean.
    expect(offAxisWeightIn("fontWeight: 'unterminated")).toBe(true);
    // The shapes it must still get right.
    expect(inlineValueAt('x: `${TYPE.h2}px`,', 0)).toBe('`${TYPE.h2}px`');
    expect(inlineValueAt("x: 'Geist, sans-serif',", 0)).toBe("'Geist, sans-serif'");
    expect(inlineValueAt('x: `a${`b${TYPE.h1}c`}d`,', 0)).toBe('`a${`b${TYPE.h1}c`}d`');
  });

  it('CONTROL: ?? and ?. are not ternaries', () => {
    // Splitting on a bare `?` mangled legitimate values into nonsense:
    // `size ?? TYPE.body` became the single operand `? TYPE.body` and FAILED.
    // A false positive sends the next session to fix correct code.
    // `?.` is a member access and is normalised away, so it is not a branch.
    expect(isOnSystem('AUTH_INPUT_STYLE?.fontSize', 'fontSize')).toBe(true);
    // `??` IS a branch and BOTH its sides are values, so both are checked.
    // Round two expected `size ?? TYPE.body` to pass; it does not, on purpose
    // — `size` is an unknown and a fallback's left side is the one that
    // normally wins, so accepting it would accept `magic ?? TYPE.body` with
    // `magic` at 9. What the reviewer actually found — the splitter MANGLING
    // this into the nonsense operand `? TYPE.body` — is gone.
    expect(isOnSystem('size ?? TYPE.body', 'fontSize')).toBe(false);
    expect(isOnSystem('TYPE.dense ?? TYPE.body', 'fontSize')).toBe(true);
    // …and a real ternary still splits.
    expect(isOnSystem("big ? TYPE.h1 : '9px'", 'fontSize')).toBe(false);
    expect(isOnSystem('big ? TYPE.h1 : TYPE.h2', 'fontSize')).toBe(true);
    // A stray closer must not send the depth counter negative and stay there.
    expect(topLevelIndex('a) ? x : y', '?')).toBeGreaterThan(0);
  });

  it('CONTROL: composing tokens is not inventing a value', () => {
    // Reported as defects by the first draft, which is the other direction of
    // wrong: these compose tokens, they do not invent numbers.
    expect(isOnSystem('clamp(TYPE.dense, 2, 4)', 'fontSize')).toBe(true);
    expect(isOnSystem('String(TYPE.h1)', 'fontSize')).toBe(true);
    expect(isOnSystem('Math.max(TYPE.body, TYPE.dense)', 'fontSize')).toBe(true);
    // …but a call over nothing but numbers is still a number.
    expect(isOnSystem('clamp(9, 2, 4)', 'fontSize')).toBe(false);
  });

  it('CONTROL: the weight judge ACCEPTS the axis rather than listing offenders', () => {
    // Round one converted the CSS weight row from a reject-list to an
    // accept-list and left this one a reject-list. Variable fonts take any
    // integer 1–1000, and every one of these passed.
    for (const w of ['450', '550', '350', '250', '1000', "'650'", 'TYPE.h1']) {
      expect(offAxisWeightIn(`fontWeight: ${w}`), w).toBe(true);
    }
    for (const w of ['400', '600', 'WEIGHT.h2', "'var(--text-label--font-weight)'",
      'inherit', 'undefined']) {
      expect(offAxisWeightIn(`fontWeight: ${w}`), w).toBe(false);
    }
    // A ternary is judged arm by arm, so one good arm cannot carry a bad one.
    expect(offAxisWeightIn('fontWeight: cond ? 600 : 450')).toBe(true);
    expect(offAxisWeightIn('fontWeight: cond ? 600 : 400')).toBe(false);
  });

  it('CONTROL: each exception is the site it names, and swallows only it', () => {
    const ALL = [INLINE_SIZE, INLINE_FAMILY, INLINE_TRACKING, INLINE_LEADING];
    for (const x of INLINE_TYPE_EXCEPTIONS) {
      const entry = tree().find((t) => t.file === x.file);
      expect(entry, `${x.file} is allowlisted but not in scope`).toBeTruthy();
      expect(entry.src.includes(x.marker), `${x.file} no longer contains "${x.marker}"`).toBe(true);

      // With NO allowlist at all, the file's sites are reported…
      const raw = ALL.flatMap((re) => hardCodedInline(re, []))
        .filter((hit) => hit.startsWith(`${x.file}:`));
      expect(raw.length, `${x.file} is allowlisted but has nothing to exempt`).toBeGreaterThan(0);

      // …with THIS ENTRY ALONE applied, exactly `sites` of them go away. One
      // entry at a time, because the difference is otherwise the FILE's total
      // and two entries in one file would each be measured against it (round
      // one, finding 12 — and it fired the moment a second entry landed).
      const mine = ALL.flatMap((re) => hardCodedInline(re, [x]))
        .filter((hit) => hit.startsWith(`${x.file}:`));
      expect(raw.length - mine.length,
        `${x.file}: "${x.marker}" exempts ${raw.length - mine.length} sites, not ${x.sites}`)
        .toBe(x.sites);

      // …and with the WHOLE allowlist the file is clean, so no exempted site
      // is quietly still being reported by a different regex.
      const kept = ALL.flatMap((re) => hardCodedInline(re))
        .filter((hit) => hit.startsWith(`${x.file}:`));
      expect(kept, `${x.file} still reports sites after every exemption:\n${kept.join('\n')}`).toEqual([]);
    }
  });

  it('no inline weight off the 400/600 axis, except the frozen title', () => {
    const hits = sweep(INLINE_WEIGHT, ({ file, src, index }) => {
      if (!isOffAxisWeight(src, index)) return false;
      const window = src.slice(Math.max(0, index - EXEMPT_WINDOW), index + EXEMPT_WINDOW);
      return !INLINE_TYPE_EXCEPTIONS.some((x) => x.file === file && window.includes(x.marker));
    });
    expect(hits, `inline weights off the axis:\n${hits.join('\n')}`).toEqual([]);
  });

  it('CONTROL: the frozen title is still there, and is still the only one', () => {
    // If C2's block were ever edited away this assertion would go quiet and
    // read as success, so the site is pinned positively as well as negatively.
    const inScope = sweep(INLINE_WEIGHT, ({ src, index }) => isOffAxisWeight(src, index));
    expect(inScope.length, `inline weights, app-wide:\n${inScope.join('\n')}`).toBe(1);
    expect(inScope[0]).toMatch(/^src[/\\]App\.jsx:/);
    const app = tree().find((t) => t.file === 'src/App.jsx').src;
    expect(app).toContain("fontSize: '16.8px'");
    expect(app).toContain("letterSpacing: '0.3em'");
    expect(app).toContain("transitionState === 'title-hold'");
  });

  it('CONTROL: the scope predicate separates the three lanes', () => {
    expect(IN_T3_SCOPE('src/App.jsx')).toBe(true);
    expect(IN_T3_SCOPE('src/cloud/auth/AuthShell.jsx')).toBe(true);
    expect(IN_T3_SCOPE('src/components/AdminTerminal/UsersSection.jsx')).toBe(true);
    expect(IN_T3_SCOPE('src/tools/rabbit_v0.1.0/views/intake/IntakePrepare.jsx')).toBe(false);
    expect(IN_T3_SCOPE('src/tools/otter_v0.3.1/Otter.jsx')).toBe(false);
    // And the sweep really reaches T3's files, so "no hits" is not "no scan".
    expect(tree().filter((t) => IN_T3_SCOPE(t.file)).length).toBeGreaterThan(100);
    expect(sweep(INLINE_SIZE).length).toBeGreaterThan(20);

    /* T1 (2026-09-22) widened the asserted scope by one lane but left this
       control still exercising only `IN_T3_SCOPE`, though its title claims
       all three. Two lane regexes with no control is how a directory rename
       turns a live assertion into a green no-op — see the T2 ratchet, where
       a reviewer demonstrated exactly that. */
    expect(T1_LANE.test('src/tools/otter_v0.3.1/Otter.jsx')).toBe(true);
    expect(T1_LANE.test('src/tools/deck-outline-generator_v0.514/modals/DuplicateResolverModal.jsx')).toBe(true);
    expect(T1_LANE.test('src/tools/rabbit_v0.1.0/views/TeamView.jsx')).toBe(false);
    expect(T2_LANE.test('src/tools/rabbit_v0.1.0/views/TeamView.jsx')).toBe(true);
    expect(T2_LANE.test('src/tools/otter_v0.3.1/Otter.jsx')).toBe(false);
    // Both lanes exist in the tree, so neither predicate is silently empty.
    expect(tree().filter((t) => T1_LANE.test(t.file)).length).toBeGreaterThan(10);
    expect(tree().filter((t) => T2_LANE.test(t.file)).length).toBeGreaterThan(50);
    /* ⚠️ THERE IS NOTHING LEFT TO ASSERT ABOUT `IN_ASSERTED_SCOPE`, AND
       PRETENDING OTHERWISE IS WORSE THAN SAYING SO. T1 wrote
       `expect(tree().every(t => IN_ASSERTED_SCOPE(t.file))).toBe(true)` after
       T2 had already set the predicate to `() => true`: a tautology that
       cannot fail, sitting in a control block, reading as coverage. A
       reviewer called it, rightly. The real content of this control is the
       orphan check below — that is the one that catches a lane being renamed
       out from under an assertion — so the tautology is deleted rather than
       dressed up. If a later session ever narrows the scope again, it should
       write the assertion then, against whatever it narrows to. */
    expect(tree().filter((t) => !IN_ASSERTED_SCOPE(t.file)).map((t) => t.file),
      'the hard assertion no longer covers every file').toEqual([]);
    // Every in-scope file belongs to exactly one of the three lanes.
    const orphans = tree().filter((t) =>
      !IN_T3_SCOPE(t.file) && !T1_LANE.test(t.file) && !T2_LANE.test(t.file));
    expect(orphans.map((t) => t.file), 'a tool directory belongs to no lane').toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// THE STYLESHEETS (T3, 2026-09-22)
//
// `ui-audit.mjs` grew a second table in this bundle, because its header had
// promised since T0 that the five CSS files were "counted separately below"
// and there was no below — they had never been read by any tool in this
// overhaul. A table nobody asserts is a table that rots, so the rows that
// should be ZERO are pinned here and the rows that are OWNERSHIP are
// ratcheted with the owner named.
//
// The scan runs ONCE for the whole block. T0's hand-off §5 trap 12: six
// uncached sweeps pushed four unrelated tree-walking tests past their 5s
// timeout under vitest's parallel workers and tripled the suite's wall clock,
// while passing in a second on their own. Five files is cheap, but the habit
// is the point.
// ═════════════════════════════════════════════════════════════════════════════
const CSS_ROWS = Object.fromEntries(cssCounts().map((r) => [r.label, r]));
const cssRow = (label) => {
  const row = CSS_ROWS[label];
  if (!row) throw new Error(`ui-audit.mjs no longer has a CSS row called "${label}"`);
  return row;
};

/* The four PAGE stylesheets. `src/index.css` is excluded from the assertions
   below and ratcheted separately: it is Foundation's under §6.5, and what it
   still carries belongs to two named blocks with two named owners. */
const PAGE_SHEETS = (hit) => !hit.startsWith('src/index.css');

describe('the stylesheets: the rows that must be zero (T3)', () => {
  it('no stylesheet shouts anywhere but the Label step', () => {
    const row = cssRow('text-transform: uppercase off the Label step');
    const where = row.inFiles.flatMap(([f, hits]) => hits.map(([l, t]) => `${f}:${l}  ${t}`));
    expect(where, `uppercase off the Label step:\n${where.join('\n')}`).toEqual([]);
  });

  it('no stylesheet uses the blanket transition', () => {
    const row = cssRow('transition: all');
    const where = row.inFiles.flatMap(([f, hits]) => hits.map(([l, t]) => `${f}:${l}  ${t}`));
    expect(where, `transition: all:\n${where.join('\n')}`).toEqual([]);
  });

  it('the four page stylesheets are off the 400/600 axis nowhere', () => {
    // resources.css carried the last one — a sorted column header at 700,
    // which the faces (declared `font-weight: 400 600`) were clamping to 600
    // anyway, so the declaration asked for a weight this app does not have.
    const row = cssRow('font-weight off the 400/600 axis');
    const where = row.inFiles.flatMap(([f, hits]) => hits.map(([l, t]) => `${f}:${l}  ${t}`))
      .filter(PAGE_SHEETS);
    expect(where, `page stylesheets off the weight axis:\n${where.join('\n')}`).toEqual([]);
  });

  it('the four page stylesheets write no hex and no off-scale size', () => {
    // C8 and C7, on the surfaces T3 swept. Everything the two rows still
    // report is inside `src/index.css`, in `.lesson-content` (T1's by plan §5
    // lane A3) and `.companion-chat-md` (the agent panel's, lane A — `index.css`
    // says so; it is not the pet's sprite, so C5 does not cover it; V1).
    for (const label of ['hex colour outside @theme', 'font-size off the scale']) {
      const row = cssRow(label);
      const where = row.inFiles.flatMap(([f, hits]) => hits.map(([l, t]) => `${f}:${l}  ${t}`))
        .filter(PAGE_SHEETS);
      expect(where, `${label} in a page stylesheet:\n${where.join('\n')}`).toEqual([]);
    }
  });

  /* 🚨 The 2px borders are NOT a defect row and are not asserted to zero.
     §3.2 gives the signal "a 2px selected-row edge", the kit's Tabs contract
     is literally "one 2px signal underline", and — the one that would do real
     damage — the light surface has NO status colour, so D1 carries Settings'
     ok / warning / error on width, weight and line style alone. Flattening
     those deletes the difference between a warning and an error on the page
     that warns you agent edits will be applied without review.

     All eighteen were judged by hand and the list is in `ui-audit.mjs`'s
     comment for that row. This RATCHETS so the population cannot grow
     unnoticed while the judgment stands. */
  /* 🚨 A SET, NOT A COUNT. Round one: `toBeLessThanOrEqual(18)` lets anyone
     delete the Tabs underline and add a fresh 2px defect elsewhere while the
     suite stays green and the hand-judged list in `ui-audit.mjs` is silently
     wrong. The count was also a claim nothing checked against the
     enumeration — which is how the comment came to list SEVENTEEN sites
     while the row reported eighteen (`settings.css:802`, `.s-feedback`'s
     base edge, was the one missing).

     Keyed on file + selector rather than file + LINE, because a line number
     moves when someone edits the comment above it and that is not a
     regression. Selectors are what a reader recognises anyway. */
  const JUDGED_BORDERS = [
    ['src/index.css', '.ui-spinner'],                 // a 2px ring is a spinner
    ['src/index.css', '.ui-tab'],                     // the kit's "one 2px signal underline"
    ['src/index.css', '.ui-toast'],                   // the tone edge
    ['src/components/settings/settings.css', '.s-tab'],
    ['src/components/settings/settings.css', '.s-danger-btn'],
    ['src/components/settings/settings.css', '.s-status'],
    ['src/components/settings/settings.css', '.s-profile-empty'],
    ['src/components/settings/settings.css', '.s-feedback'],
    ['src/components/Dashboard/dashboard.css', '.dash-note-row'],
    ['src/components/AdminTerminal/adminTerminal.css', '.at-decide-panel'],
    // B1: the intake step strip's current step — the kit Tabs' own underline, on a strip that reads as tabs
    ['src/tools/rabbit_v0.1.0/rabbitShell.css', '.rb-step'],
    /* A1, 2026-09-23 — three indicators, no structural 2px. EXACT selectors
       (the third element): `includes` let '.dog-page-tab' excuse the strip
       '.dog-page-tabs' and every '.dog-history-row …' descendant rule, so a
       structural 2px border there would have passed (A1 review round 1). */
    ['src/tools/deck-outline-generator_v0.514/dog.css', '.dog-history-row', 'exact'],   // F2 Row's "highlighted" edge: a page open in a tab
    ['src/tools/deck-outline-generator_v0.514/dog.css', '.dog-page-tab', 'exact'],      // the kit's tab underline, on the closable wrapper (A1-KR-1)
    // T1's and the pet's, not swept by this bundle (plan §5 lane A3, C5).
    ['src/index.css', '.lesson-content'],
    ['src/index.css', '.companion-chat-md'],
  ];
  /* The selector of the rule that holds the declaration at `offset`: it sits
     immediately before the block's opening brace. 🚨 The block is found by
     searching BACK from the declaration (A1 review round 2). The first draft
     took the FIRST occurrence of the block's text in the file, so a rule
     whose body is byte-identical to an earlier rule's was reported under the
     earlier selector — settings.css's `.s-feedback[data-tone='error']` read as
     `.s-status[data-state='error']` — and an exact judged entry could excuse a
     copy of its body pasted under any other selector. */
  const selectorAt = (src, offset) => {
    const block = enclosingBlock(src, offset);
    const before = src.slice(0, src.lastIndexOf(block, offset));
    return (before.match(/([^{};]+)$/) || [''])[0].trim().replace(/\s+/g, ' ');
  };
  it('CONTROL: a rule whose body repeats an earlier rule is named by its OWN selector', () => {
    const css = '.judged { border-left: 2px solid red; }\n.other { border-left: 2px solid red; }\n';
    expect(selectorAt(css, css.lastIndexOf('border-left'))).toBe('.other');
    expect(selectorAt(css, css.indexOf('border-left'))).toBe('.judged');
  });

  it('every 2px border is one of the rules that were judged by hand', () => {
    const row = cssRow('border >= 2px');
    const unjudged = [];
    for (const [f, hits] of row.inFiles) {
      const src = blankCssComments(readFileSync(f, 'utf8'));
      for (const [line, text] of hits) {
        /* 🚨 The offset of the DECLARATION, not of the line. A single-line
           rule (`.lesson-content th { … border: 2px … }`) starts before its
           own `{`, so walking back from the line's first character finds the
           WRONG block — or none, which reported an empty selector and read
           as "nobody judged this". */
        const lines = src.split('\n');
        const lineStart = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
        const within = lines[line - 1].indexOf(text.split(/\s+/)[0]);
        const selector = selectorAt(src, lineStart + Math.max(0, within));
        if (!JUDGED_BORDERS.some(([jf, sel, exact]) => jf === f && (exact ? selector === sel : selector.includes(sel)))) {
          unjudged.push(`${f}:${line}  ${text}   selector: ${selector.slice(0, 70)}`);
        }
      }
    }
    expect(unjudged, `2px borders on rules nobody judged:\n${unjudged.join('\n')}`).toEqual([]);
  });

  it('the one border that was NOT an indicator is still a hairline', () => {
    // dashboard.css's ProseMirror blockquote: a neutral colour, no
    // conditional, no state — the only structural 2px rule in five files.
    // Pinned positively, because a row that merely counts down cannot tell
    // "someone fixed it" from "someone deleted the rule".
    const css = readFileSync('src/components/Dashboard/dashboard.css', 'utf8');
    const rule = css.match(/\.dash-note-editor \.ProseMirror blockquote \{[^}]*\}/);
    expect(rule, 'the blockquote rule is gone').toBeTruthy();
    expect(rule[0]).toMatch(/border-left:\s*1px solid var\(--color-rule\)/);
  });

  /* 🚨 THE QUIT DIALOG, WHICH IS THE LAST HAND-ROLLED SURFACE IN THE SHELL
     AND THE ONE ROUND ONE CAUGHT HALF-CONVERTED.

     Its first pass copied the kit's primary-hover `color-mix` into a JS
     handler and guarded the copy. Round one's answer was better: take the
     whole object. Both controls are `<Button>` now, so the hover is a `:hover`
     RULE and there is no copy left to drift — which also settles the
     state-extraction step §5 requires and round one called a violation.

     What is pinned here is the property that made all of that true: NO
     INLINE STYLE, NO HEX AND NO HOVER HANDLER inside the dialog. An inline
     style beats a hover rule (§1, and it is the reason the state extraction
     exists at all), so a future session re-adding one would silently
     re-create the dead hover this commit deleted. */
  it('the quit dialog carries no hex, no hover handler and no inline control style', () => {
    const app = tree().find((t) => t.file === 'src/App.jsx').src;
    const open = app.indexOf('{showCloseDialog && (');
    expect(open, 'the quit dialog is gone').toBeGreaterThan(-1);
    // To its closing brace — the next line that is exactly six spaces + `)}`.
    const close = app.indexOf('\n      )}', open);
    expect(close).toBeGreaterThan(open);
    /* 🚨 ROUND TWO: AND NOTHING AFTER IT. The stray `)}` this bundle left in
       the dialog — a literal `")}"` TEXT NODE compiled into the app root —
       sat one line PAST `close`, so this very test's window excluded it
       while its title claimed the dialog was taken whole. */
    expect(app.slice(close + 9, close + 40), 'a stray closer after the dialog')
      .not.toMatch(/^\s*\)\}/);

    // Comments are where this file explains itself, and they quote the hexes
    // they replaced; the CODE is what is under test.
    const code = app.slice(open, close)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    /* 🚨 ROUND TWO: `rgb()` IS A COLOUR TOO, and this surface has written one
       before. A reviewer restored the 4.07:1 / 3.03:1 Cancel button using
       `backgroundColor: 'rgb(68,64,60)'` and every assertion here stayed
       green — a test named "no hex" that let the exact defect it was written
       for walk back in. */
    expect(code.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g),
      'a raw colour is back in the quit dialog').toBeNull();
    expect(code).not.toMatch(/onMouse(?:Enter|Leave)/);
    expect(code).not.toMatch(/currentTarget\.style/);
    // …and the two controls are the kit's, which is what puts the hover in CSS.
    expect(code).toMatch(/<Button\s+variant="secondary"/);
    expect(code).toMatch(/<Button\s+variant="primary"/);
    expect(code).not.toMatch(/<button/);
    /* 🚨 AND THE CONTROLS CARRY NO INLINE STYLE BUT `flex`. The title says "no
       inline control style" and nothing asserted it: the same reviewer
       re-added the whole failing colour pair through `<Button style={{…}}>`.
       An inline style beats a `:hover` rule, so this is the property the
       state extraction actually bought. */
    for (const m of code.matchAll(/<Button\b[\s\S]*?>/g)) {
      const style = m[0].match(/style=\{\{([^}]*)\}\}/);
      if (!style) continue;
      const props = style[1].split(',').map((x) => x.split(':')[0].trim()).filter(Boolean);
      expect(props, `a Button in the quit dialog styles more than its width: ${style[1].trim()}`)
        .toEqual(['flex']);
    }
  });

  it('CONTROL: the CSS scan is actually reading the stylesheets', () => {
    // Every assertion above is an empty-list check, and an empty list is what
    // a scan that opened nothing also returns. These are the denominators.
    // 8: B1 added rabbitShell.css, A1 dog.css and B6 bins.css (all 2026-09-23).
    expect(CSS_FILES.length).toBe(8);
    for (const f of CSS_FILES) expect(readFileSync(f, 'utf8').length).toBeGreaterThan(1000);
    // Two rows that are SUPPOSED to be non-zero, so a scan returning nothing
    // anywhere fails here instead of passing everywhere.
    expect(cssRow('border >= 2px').hits).toBeGreaterThan(0);
    /* 🚨 NOT the hex row, which the first draft used here. Round one caught
       that it ties this control to work T3 says belongs to someone else:
       every one of those 28 hexes is inside `.lesson-content` or
       `.companion-chat-md`, so the control would go RED on the day lane A3
       finishes its own surface. A denominator must not be an unfinished
       defect count. `@theme` is the stable positive instead — it is excluded
       POSITIONALLY rather than by value, so counting its hexes proves the
       scan opened `index.css` and found the block, and stays true forever. */
    const theme = themeRange(blankCssComments(readFileSync('src/index.css', 'utf8')));
    expect(theme, '@theme not found — index.css was not parsed').toBeTruthy();
    const themeSrc = readFileSync('src/index.css', 'utf8').slice(theme[0], theme[1]);
    expect((themeSrc.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length,
      '@theme carries no hexes, so the range is wrong').toBeGreaterThan(20);
    // And the uppercase row's judgment is a real filter, not a dead branch:
    // the sheets DO carry uppercase, it is simply all on the Label step.
    const rawUppercase = CSS_FILES.reduce(
      (n, f) => n + (readFileSync(f, 'utf8').match(/text-transform:\s*uppercase/g) || []).length, 0);
    expect(rawUppercase, 'no uppercase at all — the row proves nothing').toBeGreaterThan(20);
  });
});
