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
import { sourceFiles, cssCounts, CSS_FILES } from '../../scripts/ui-audit.mjs';
import { protectedRanges, isProtected } from '../../scripts/ui-source-regions.mjs';
import { LABEL_EVIDENCE, CONTROL_TAGS } from '../../scripts/ui-type-map.mjs';
import { classifyMono } from '../../scripts/ui-mono-map.mjs';
import { isIndicatorBorder } from '../../scripts/ui-pass4-surface.mjs';
import { enclosingRunRaw, enclosingTag } from '../../scripts/ui-type-inventory.mjs';

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

/* Inline weights are T1–T3's residue by plan, so this RATCHETS rather than
   bans: the number may fall, never rise.

   11 → 7 (T3, 2026-09-22). T3's three convertible ones are gone and T1 has
   none left. What remains, named so the next session knows whose each is and
   how far the number can still fall:

     src/App.jsx:2118                    1   the page-transition title, FROZEN
                                             by C2 and Q18 — this is the floor,
                                             and a session that lowers the
                                             ratchet past it is proposing to
                                             edit a block the plan forbids
                                             touching. (It reads `bold`, which
                                             asks for 700 and clamps to 600,
                                             because the faces are declared
                                             `font-weight: 400 600`. The pixels
                                             are right; the source is not; the
                                             rule says leave it.)
     rabbit/views/TeamView.jsx           1   T2's
     rabbit/views/intake/IntakePrepare   5   T2's

   T3's own scope is asserted HARD at the bottom of this file rather than
   ratcheted, so this number can only be moved down by T2 finishing. */
const INLINE_WEIGHT = /fontWeight\s*:\s*['"]?(?:500|700|bold)['"]?/g;
const INLINE_WEIGHT_RESIDUE = 7;

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
   landed, so it widens by exactly one lane here. */

/** T1's lane, plan §5 Wave 1: D.O.G. and O.T.T.E.R. */
const T1_LANE = /^src\/tools\/(?:deck-outline-generator_v0\.514|otter_v0\.3\.1)\//;
/** T2's lane, the last one still working its residue down. */
const T2_LANE = /^src\/tools\/rabbit_v0\.1\.0\//;
/** Hard-coded inline type declarations left in T2's lane. Measured, and it
 *  may only fall. Deleted along with the lane constants when T2 lands. */
const T2_INLINE_RESIDUE = 77;

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
const END = String.raw`\s*(?:!important\s*)?[;}]`;
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
const CSS_SHORTHAND = /(?:^|[;{])\s*font\s*:/gi;
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

  it('the inline-weight residue does not grow while T1–T3 work it down', () => {
    // The first draft of the assertion above made a claim about WEIGHT and
    // checked only class names, so `fontWeight: 'bold'` sat four times in
    // App.jsx underneath it.
    const inline = sweep(INLINE_WEIGHT);
    expect(inline.length, `inline weights:\n${inline.join('\n')}`)
      .toBeLessThanOrEqual(INLINE_WEIGHT_RESIDUE);
  });

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
    expect(fires(INLINE_WEIGHT, "fontWeight: 'bold'")).toBe(true);
    expect(fires(INLINE_WEIGHT, 'fontWeight: 600')).toBe(false);
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
    expect(lessonRules().length).toBe(17);
    const css = lessonCss();
    for (const sel of LESSON_SELECTORS) {
      expect(css, `the .lesson-content ${sel.trim()} rule is missing from the sweep`)
        .toContain(`.lesson-content ${sel.trim()}`);
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

  it('the measure is on the PROSE rule, and the token is in §3.1s band', () => {
    /* 🚨 NOT "somewhere in the block". T1 asserted `CSS_MEASURE` against the
       whole joined string, so a reviewer put the prose back to 74ch, dropped a
       66ch onto `pre code`, and the assertion stayed green over the exact
       before-value this bundle exists to have removed. The measure has to be
       on the rule that carries the paragraphs. */
    const prose = lessonRules().filter((r) => /(^|[\s,(])p([\s,)]|$)/.test(r.slice(0, r.indexOf('{'))));
    expect(prose.length, 'no .lesson-content rule selects `p`').toBeGreaterThan(0);
    expect(prose.some((r) => CSS_MEASURE.test(r)),
      `no rule selecting p carries a 60-66ch measure:\n${prose.join('\n')}`).toBe(true);
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

/* T1 LANDED, so its lane joins the hard assertion exactly as the block above
   said it would ("when T1 and T2 land, `IN_T3_SCOPE` widens to everything and
   the ratchet goes"). It widens by one lane, not to everything: T2 is still
   running, and a hard ban over `IntakePrepare.jsx`'s 23 unconverted sites
   would go red on work in progress and tell T2 nothing it does not know.
   T2's lane keeps a ratchet below until it lands, and then this becomes
   `() => true` and both lane constants go. */
const IN_ASSERTED_SCOPE = (file) => IN_T3_SCOPE(file) || T1_LANE.test(file);

/* A value is ON THE SYSTEM when it reads a token, or when it is a CSS keyword
   that RESETS rather than sets. A bare `0` is on the list because §3.1 gives
   five of the seven steps zero tracking, so `letterSpacing: 0` states the
   system's own default rather than inventing a number. */
/* 🚨 THE KEYWORD ARM IS ANCHORED, and it was not. Unanchored, `\b(?:inherit|
   initial|unset|revert|normal|none)\b` matched anywhere in the value
   EXPRESSION, so any conditional whose TEST mentions one of the six words
   exempted both of its arms:
       fontSize: mode === 'normal' ? 14 : 16        <- both arms hidden
       fontSize: icon === 'none' ? 12 : 18          <- both arms hidden
       letterSpacing: kind === 'initial' ? '0.2em' : '0.1em'
   A keyword that RESETS is the whole value or it is not a reset. Before T1
   this covered T3's surfaces only; `IN_ASSERTED_SCOPE` extends it over D.O.G.
   and O.T.T.E.R. too, which is why T1 is the one fixing it. */
const ON_SYSTEM_VALUE = /(?:TYPE|LEADING|TRACKING|WEIGHT)\s*\.\s*[a-z0-9]+|\bTYPE_FLOOR\b|\bFONT_(?:MONO|SANS)\b|var\(--(?:text|font)-|\bAUTH_[A-Z_]+\b|^\s*['"]?(?:inherit|initial|unset|revert|normal|none)['"]?\s*$|^\s*0\s*$/;

/* The three declarations that can carry a hard-coded type value. `fontWeight`
   is NOT among them: it has its own ratchet above, and 400/600 written as
   numerals is the system's own vocabulary rather than a magic number. */
const INLINE_SIZE = /fontSize\s*:\s*([^,;\n}]+)/g;
const INLINE_FAMILY = /fontFamily\s*:\s*([^,;\n}]+)/g;
const INLINE_TRACKING = /letterSpacing\s*:\s*([^,;\n}]+)/g;

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
    marker: 'const metrics = {',
    sites: 1,
    why: "AuthPasswordInput's mask tracking — load-bearing for caret "
      + 'alignment, proved at 0.00px by scripts/ui-caret-check.mjs, and not a '
      + 'scale value (§3.1 tracks two steps and this is neither of them)',
  },
  /* 🚨 T1 ADDED A THIRD ENTRY HERE AND A REVIEWER DELETED IT, RIGHTLY.
     `Otter.jsx`'s Monaco editor takes `fontSize` as a NUMBER, so T1
     allowlisted a hard-coded 14 on the grounds that "a token string would
     break the editor". True of a string, and beside the point: `tokens.js`
     builds `TYPE` with `Number(THEME['text-body'].replace('px',''))`, so
     `TYPE.body` IS the number 14 and `ON_SYSTEM_VALUE` already accepts it.
     The entry bought nothing and cost a permanent 800-character exempt window
     in the largest file in T1's lane. `Otter.jsx` now reads `TYPE.body` and
     the exemption is gone — which also makes T1's lane an HONEST empty-scope
     assertion rather than one whose only member was excused. The best fix is
     the one that deletes machinery. */
];

/** Inline type declarations whose VALUE is hard-coded. `applyExceptions` is a
 *  parameter so a control can run the same sweep with them off — proving the
 *  allowlist does work, rather than sitting beside an already-clean scan. */
function hardCodedInline(re, applyExceptions = true, inScope = IN_ASSERTED_SCOPE) {
  return sweep(re, ({ file, src, index, token }) => {
    if (!inScope(file)) return false;
    const value = token.slice(token.indexOf(':') + 1).trim();
    if (ON_SYSTEM_VALUE.test(value)) return false;
    if (!applyExceptions) return true;
    const window = src.slice(Math.max(0, index - EXEMPT_WINDOW), index + EXEMPT_WINDOW);
    return !INLINE_TYPE_EXCEPTIONS.some((x) => x.file === file && window.includes(x.marker));
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

  /* T2's lane is the only one left unasserted, and an unasserted lane with no
     ratchet at all is how a residue grows back while three sessions watch.
     This counts the SAME thing the assertions above do — a hard-coded VALUE,
     not a spelling — so when T2 lands, `IN_ASSERTED_SCOPE` becomes `() => true`
     and this whole block is deleted rather than reconciled. */
  it('R.A.B.B.I.T. inline type does not grow while T2 works it down', () => {
    const hits = [INLINE_SIZE, INLINE_FAMILY, INLINE_TRACKING]
      .flatMap((re) => hardCodedInline(re, true, (f) => T2_LANE.test(f)));
    /* 🚨 A RATCHET NEEDS A DENOMINATOR. `T2_LANE` is a path regex over a
       directory whose name carries a VERSION — `rabbit_v0.1.0` — and this
       repo has already shipped `v0.514`, `v0.3.1` and `v0.1.0` in paths. A
       reviewer bumped the directory to `v0.1.1` and the count went 77 -> 0
       with the assertion still green: a rename would have taken 77 live
       hard-coded declarations out from under the only thing watching them.
       So the premise is asserted too — this lane exists, and it is non-empty
       and falling, not absent and therefore "clean". */
    expect(tree().filter((t) => T2_LANE.test(t.file)).length,
      'T2_LANE matches no files — the lane was renamed and this ratchet is watching nothing')
      .toBeGreaterThan(50);
    expect(hits.length, 'T2 has finished: delete the lane constants and widen IN_ASSERTED_SCOPE')
      .toBeGreaterThan(0);
    expect(hits.length, `hard-coded inline type in T2's lane:\n${hits.join('\n')}`)
      .toBeLessThanOrEqual(T2_INLINE_RESIDUE);
  });

  it('CONTROL: the value test accepts tokens and rejects literals', () => {
    for (const v of ['`${TYPE.h1}px`', 'TYPE.dense', "'var(--text-label)'",
      'FONT_MONO', 'AUTH_INPUT_STYLE.fontSize', 'AUTH_CODE_TRACK',
      'size >= 40 ? TYPE.h2 : TYPE.label', "'inherit'", '0']) {
      expect(ON_SYSTEM_VALUE.test(v), `${v} should be on-system`).toBe(true);
    }
    for (const v of ["'16px'", "'0.15em'", "'monospace'", '13', "'16.8px'",
      "'ui-monospace, SFMono-Regular, Menlo, monospace'"]) {
      expect(ON_SYSTEM_VALUE.test(v), `${v} should read as a literal`).toBe(false);
    }
  });

  it('CONTROL: each exception is the site it names, and swallows only it', () => {
    const ALL = [INLINE_SIZE, INLINE_FAMILY, INLINE_TRACKING];
    for (const x of INLINE_TYPE_EXCEPTIONS) {
      const entry = tree().find((t) => t.file === x.file);
      expect(entry, `${x.file} is allowlisted but not in scope`).toBeTruthy();
      expect(entry.src.includes(x.marker), `${x.file} no longer contains "${x.marker}"`).toBe(true);

      // Without the allowlist the site IS reported…
      const raw = ALL.flatMap((re) => hardCodedInline(re, false))
        .filter((hit) => hit.startsWith(`${x.file}:`));
      expect(raw.length, `${x.file} is allowlisted but has nothing to exempt`).toBeGreaterThan(0);

      // …with it applied the site is gone…
      const kept = ALL.flatMap((re) => hardCodedInline(re, true))
        .filter((hit) => hit.startsWith(`${x.file}:`));
      expect(kept, `${x.file}'s exemption is not firing:\n${kept.join('\n')}`).toEqual([]);

      // …and it covered EXACTLY the number of sites it claims.
      expect(raw.length - kept.length,
        `${x.file}: "${x.marker}" exempts ${raw.length - kept.length} sites, not ${x.sites}`)
        .toBe(x.sites);
    }
  });

  /* The weight ratchet above is app-wide and can only fall as T2 finishes.
     T3's share of it is ONE site — the frozen transition title — so over this
     scope it is an assertion, not a ratchet. A number that may not rise is a
     much weaker claim than a list that must be empty, and the difference is
     the whole reason this block exists. */
  it('no inline weight off the 400/600 axis, except the frozen title', () => {
    const hits = sweep(INLINE_WEIGHT, ({ file, src, index }) => {
      if (!IN_T3_SCOPE(file)) return false;
      const window = src.slice(Math.max(0, index - EXEMPT_WINDOW), index + EXEMPT_WINDOW);
      return !INLINE_TYPE_EXCEPTIONS.some((x) => x.file === file && window.includes(x.marker));
    });
    expect(hits, `inline weights off the axis:\n${hits.join('\n')}`).toEqual([]);
  });

  it('CONTROL: the frozen title is still there, and is still the only one', () => {
    // If C2's block were ever edited away this assertion would go quiet and
    // read as success, so the site is pinned positively as well as negatively.
    const inScope = sweep(INLINE_WEIGHT, ({ file }) => IN_T3_SCOPE(file));
    expect(inScope.length, `T3-scope inline weights:\n${inScope.join('\n')}`).toBe(1);
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
    // The widening is real: T1's lane is inside the hard assertion now.
    expect(IN_ASSERTED_SCOPE('src/tools/otter_v0.3.1/Otter.jsx')).toBe(true);
    expect(IN_ASSERTED_SCOPE('src/tools/rabbit_v0.1.0/views/TeamView.jsx')).toBe(false);
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
    const row = cssRow('font-weight 500/700/bold');
    const where = row.inFiles.flatMap(([f, hits]) => hits.map(([l, t]) => `${f}:${l}  ${t}`))
      .filter(PAGE_SHEETS);
    expect(where, `page stylesheets off the weight axis:\n${where.join('\n')}`).toEqual([]);
  });

  it('the four page stylesheets write no hex and no off-scale size', () => {
    // C8 and C7, on the surfaces T3 swept. Everything the two rows still
    // report is inside `src/index.css`, in `.lesson-content` (T1's by plan §5
    // lane A3) and `.companion-chat-md` (the pet, C5).
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
  const BORDER_RESIDUE = 18;
  it('the 2px border population does not grow past the judged list', () => {
    const row = cssRow('border >= 2px');
    const where = row.inFiles.flatMap(([f, hits]) => hits.map(([l, t]) => `${f}:${l}  ${t}`));
    expect(where.length, `2px borders:\n${where.join('\n')}`).toBeLessThanOrEqual(BORDER_RESIDUE);
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

  it('CONTROL: the CSS scan is actually reading the stylesheets', () => {
    // Every assertion above is an empty-list check, and an empty list is what
    // a scan that opened nothing also returns. These are the denominators.
    expect(CSS_FILES.length).toBe(5);
    for (const f of CSS_FILES) expect(readFileSync(f, 'utf8').length).toBeGreaterThan(1000);
    // Two rows that are SUPPOSED to be non-zero, so a scan returning nothing
    // anywhere fails here instead of passing everywhere.
    expect(cssRow('border >= 2px').hits).toBeGreaterThan(0);
    expect(cssRow('hex colour outside @theme').hits).toBeGreaterThan(0);
    // And the uppercase row's judgment is a real filter, not a dead branch:
    // the sheets DO carry uppercase, it is simply all on the Label step.
    const rawUppercase = CSS_FILES.reduce(
      (n, f) => n + (readFileSync(f, 'utf8').match(/text-transform:\s*uppercase/g) || []).length, 0);
    expect(rawUppercase, 'no uppercase at all — the row proves nothing').toBeGreaterThan(20);
  });
});
