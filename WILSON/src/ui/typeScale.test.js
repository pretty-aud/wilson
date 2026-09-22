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

   It captures the value now, strips comments the way the size test does, and
   rejects any off-axis weight ANYWHERE in it. */
const INLINE_WEIGHT = /['"]?fontWeight['"]?\s*:/g;
const OFF_AXIS_WEIGHT = /\b(?:100|200|300|500|700|800|900|bold|bolder|lighter)\b/;
/* Reads the value with the same scanner the size test uses, so a weight
   inside parentheses or spread over two lines is judged the same way. */
const isOffAxisWeight = (src, index) =>
  OFF_AXIS_WEIGHT.test(stripInlineComments(inlineValueAt(src, index)));
/** The control's spelling: judge a standalone `fontWeight: …` fragment. */
const offAxisWeightIn = (fragment) => isOffAxisWeight(fragment, 0);
/* 8, not 7: `ProjectFilesTable.jsx:101` became visible when the regex above
   was fixed. 1 is T3's frozen transition title (the FLOOR) and 7 are T2's. */
const INLINE_WEIGHT_RESIDUE = 8;

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
 *  may only fall. Deleted along with the lane constants when T2 lands.
 *
 *  🚨 77 → 84, AND THE RISE IS THE GUARD GETTING HONEST, NOT A REGRESSION.
 *  T1 measured 77 against a value test that a reviewer then defeated two
 *  ways: it was a CONTAINS test, so `fontSize: w ? 13 : 10` passed on the
 *  strength of one arm, and it did not look at `lineHeight` at all. Both are
 *  closed below, and seven declarations that were always there became
 *  visible — five of them in `ProjectFilesTable.jsx`, which is the file the
 *  reviewer predicted would go green over half-finished work.
 *
 *  T2: this number is not something you broke. */
const T2_INLINE_RESIDUE = 84;

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
const CSS_OFF_SIZE = /font-size:(?!\s*var\(--text-)\s*[^;}]+/g;
const CSS_OFF_LEADING = /line-height:(?!\s*var\(--text-)\s*[^;}]+/g;
const CSS_OFF_WEIGHT = /font-weight:(?!\s*(?:400|600)\s*[;}]|\s*var\(--text-)\s*[^;}]+/g;
/** §3.1: "Measure 60 to 66ch, set in `ch`." */
const CSS_MEASURE = /max-width:\s*(?:6[0-6])ch\b/;

/** Every `.lesson-content` rule in `index.css`, comments removed first so a
 *  brace inside prose cannot invent or swallow one. */
function lessonRules() {
  const css = readFileSync('src/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  return css.match(/\.lesson-content[^{}]*\{[^{}]*\}/g) || [];
}
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
    const inline = sweep(INLINE_WEIGHT, ({ src, index }) => isOffAxisWeight(src, index));
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
    expect(offAxisWeightIn("fontWeight: 'bold'")).toBe(true);
    expect(offAxisWeightIn('fontWeight: 600')).toBe(false);
    expect(offAxisWeightIn('fontWeight: 400')).toBe(false);
    // 🚨 Round one: every one of these was invisible to the first version of
    // INLINE_WEIGHT, which required the weight immediately after the colon.
    // The second is LIVE in R.A.B.B.I.T. today.
    expect(offAxisWeightIn('fontWeight: cond ? 700 : 400')).toBe(true);
    expect(offAxisWeightIn('fontWeight: w ? 700 : undefined')).toBe(true);
    expect(offAxisWeightIn('fontWeight: hovered && 700')).toBe(true);
    expect(offAxisWeightIn('fontWeight: Number(700)')).toBe(true);
    expect(offAxisWeightIn('fontWeight: 800')).toBe(true);
    expect(offAxisWeightIn('fontWeight: 300')).toBe(true);
    expect(offAxisWeightIn("'fontWeight': 700")).toBe(true);
    // …and a comment can neither conjure one nor hide one.
    expect(offAxisWeightIn('fontWeight: 600 // was 700 before pass 2')).toBe(false);
    expect(offAxisWeightIn('fontWeight: 700 // on the axis, honest')).toBe(true);
  });
});

describe('O.T.T.E.R.s reading surface is on the scale (§3.1, plan §5 T1)', () => {
  it('CONTROL: the stylesheet is actually being read', () => {
    // If this block is ever renamed or deleted, every assertion below goes
    // green over nothing. That is the `(0 test)` failure mode one level down.
    expect(lessonRules().length).toBeGreaterThanOrEqual(15);
    expect(lessonRules().join(' ')).toContain('.lesson-content h1');
  });

  it('every font-size in .lesson-content is a step token', () => {
    const css = lessonRules().join('\n');
    const hits = css.match(CSS_OFF_SIZE) || [];
    expect(hits, `off-token sizes in the lesson surface:\n${hits.join('\n')}`).toEqual([]);
  });

  it('every line-height in .lesson-content is the step own (§3.1: one leading)', () => {
    const css = lessonRules().join('\n');
    const hits = css.match(CSS_OFF_LEADING) || [];
    expect(hits, `hand-set leadings:\n${hits.join('\n')}`).toEqual([]);
  });

  it('every font-weight in .lesson-content is on the 400/600 axis', () => {
    const css = lessonRules().join('\n');
    const hits = css.match(CSS_OFF_WEIGHT) || [];
    expect(hits, `weights off the axis:\n${hits.join('\n')}`).toEqual([]);
  });

  it('the reading surface has a measure, and it is 60-66ch', () => {
    expect(lessonRules().join('\n')).toMatch(CSS_MEASURE);
  });

  it('CONTROL: each stylesheet detector fires on the defect it replaced', () => {
    // These are the REAL values this surface carried before T1, measured in a
    // browser with a lesson open: h1 1.5rem/700, h3 1.1rem, code 0.9em,
    // p line-height 1.7, li 1.6.
    for (const s of ['font-size: 1.5rem;', 'font-size: 1.1rem;', 'font-size: 0.9em;',
                     'font-size: 16px;', 'font-size: 0.85rem;']) {
      expect(fires(CSS_OFF_SIZE, s), s).toBe(true);
    }
    expect(fires(CSS_OFF_SIZE, 'font-size: var(--text-body);')).toBe(false);

    for (const s of ['line-height: 1.7;', 'line-height: 1.6;', 'line-height: 1.5;']) {
      expect(fires(CSS_OFF_LEADING, s), s).toBe(true);
    }
    expect(fires(CSS_OFF_LEADING, 'line-height: var(--text-body--line-height);')).toBe(false);

    for (const s of ['font-weight: 700;', 'font-weight: bold;', 'font-weight: 500;']) {
      expect(fires(CSS_OFF_WEIGHT, s), s).toBe(true);
    }
    for (const s of ['font-weight: 600;', 'font-weight: 400;',
                     'font-weight: var(--text-h2--font-weight);']) {
      expect(fires(CSS_OFF_WEIGHT, s), s).toBe(false);
    }

    // The measure has a BAND, so both edges have to be checked: 74ch was the
    // real before-value and it must not satisfy the assertion.
    expect(CSS_MEASURE.test('max-width: 66ch;')).toBe(true);
    expect(CSS_MEASURE.test('max-width: 60ch;')).toBe(true);
    expect(CSS_MEASURE.test('max-width: 74ch;')).toBe(false);
    expect(CSS_MEASURE.test('max-width: 59ch;')).toBe(false);
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
function stripInlineComments(v) {
  return v.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/g, ' ').trim();
}
function isOnSystem(rawValue) {
  const v = stripInlineComments(rawValue);
  if (!v) return false;
  const operands = ternaryArms(v).map((s) => s.trim()).filter(Boolean);
  if (!operands.length) return false;
  return operands.every(operandOnSystem);
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
    if (')]}'.includes(c)) { depth--; continue; }
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

function operandOnSystem(o) {
  const scalar = o.match(/^(AUTH_[A-Z_]+)$/);
  if (scalar && !/STYLE$/.test(scalar[1])) {
    const value = resolveAuthScalar(scalar[1]);
    // Unresolvable is NOT a pass: an operand nobody can read is a defect this
    // scan cannot clear, which is the direction T0's trap 4 says to fail in.
    return value !== null && isOnSystem(value);
  }
  if (!/^`[\s\S]*`$/.test(o)) return ON_SYSTEM_OPERAND.test(o);
  const inner = o.slice(1, -1);
  const exprs = [...inner.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
  if (!exprs.length) return false;
  const literal = inner.replace(/\$\{[^}]*\}/g, '').trim();
  if (literal && !/^(?:px|em|rem|%|\s)*$/.test(literal)) return false;
  return exprs.every((e) => isOnSystem(e));
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
const INLINE_WEIGHT_KEY = /['"]?fontWeight['"]?\s*:/g;

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
function inlineValueAt(src, index) {
  let i = src.indexOf(':', index);
  if (i < 0) return '';
  i += 1;
  const start = i;
  let depth = 0;                 // ( ) [ ] { } at the current nesting level
  const stack = [];              // 'sq' | 'dq' | 'tpl' | 'expr'
  const top = () => stack[stack.length - 1];
  for (; i < src.length; i++) {
    const c = src[i];
    const t = top();
    if (t === 'sq' || t === 'dq') {
      if (c === '\\') { i++; continue; }
      if ((t === 'sq' && c === "'") || (t === 'dq' && c === '"')) stack.pop();
      continue;                  // a comma or brace inside a string is text
    }
    if (t === 'tpl') {
      if (c === '\\') { i++; continue; }
      if (c === '`') { stack.pop(); continue; }
      // `${` opens a real expression — quotes and braces count again inside it.
      if (c === '$' && src[i + 1] === '{') { stack.push('expr'); i++; }
      continue;
    }
    if (c === "'") { stack.push('sq'); continue; }
    if (c === '"') { stack.push('dq'); continue; }
    if (c === '`') { stack.push('tpl'); continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === '}') {
      if (t === 'expr' && depth === 0) { stack.pop(); continue; }
      if (depth === 0) break;    // the brace closing the style object
      depth--; continue;
    }
    if (c === ')' || c === ']') { if (depth === 0) break; depth--; continue; }
    if (!stack.length && depth === 0 && (c === ',' || c === ';' || c === '\n')) break;
  }
  return src.slice(start, i).trim();
}

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
  {
    file: 'src/tools/otter_v0.3.1/Otter.jsx',
    marker: 'scrollBeyondLastLine',
    sites: 1,
    why: "Monaco's editor option, not CSS: `fontSize` on that object is a "
      + 'NUMBER on a third-party API, so a token string would break the '
      + 'editor outright — and 14 is the Body step already (T1)',
  },
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
  return sweep(re, ({ file, src, index }) => {
    if (!inScope(file)) return false;
    if (isOnSystem(inlineValueAt(src, index))) return false;
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

  it('no inline lineHeight carries a hard-coded leading', () => {
    const hits = hardCodedInline(INLINE_LEADING);
    expect(hits, `inline leading off the token system:\n${hits.join('\n')}`).toEqual([]);
  });

  /* T2's lane is the only one left unasserted, and an unasserted lane with no
     ratchet at all is how a residue grows back while three sessions watch.
     This counts the SAME thing the assertions above do — a hard-coded VALUE,
     not a spelling — so when T2 lands, `IN_ASSERTED_SCOPE` becomes `() => true`
     and this whole block is deleted rather than reconciled. */
  it('R.A.B.B.I.T. inline type does not grow while T2 works it down', () => {
    const hits = [INLINE_SIZE, INLINE_FAMILY, INLINE_TRACKING, INLINE_LEADING]
      .flatMap((re) => hardCodedInline(re, INLINE_TYPE_EXCEPTIONS, (f) => T2_LANE.test(f)));
    expect(hits.length, `hard-coded inline type in T2's lane:\n${hits.join('\n')}`)
      .toBeLessThanOrEqual(T2_INLINE_RESIDUE);
  });

  it('CONTROL: the value test accepts tokens and rejects literals', () => {
    for (const v of ['`${TYPE.h1}px`', 'TYPE.dense', "'var(--text-label)'",
      "'var(--text-label--letter-spacing)'", 'FONT_MONO', "'var(--font-mono)'",
      'AUTH_INPUT_STYLE.fontSize', 'AUTH_TEXT_STYLE',
      'size >= 40 ? TYPE.h2 : TYPE.label', "'inherit'", '0', 'undefined',
      'a ? TYPE.h1 : b ? TYPE.h2 : TYPE.h3']) {
      expect(isOnSystem(v), `${v} should be on-system`).toBe(true);
    }
    for (const v of ["'16px'", "'0.15em'", "'monospace'", '13', "'16.8px'",
      "'ui-monospace, SFMono-Regular, Menlo, monospace'", '`${size}px`']) {
      expect(isOnSystem(v), `${v} should read as a literal`).toBe(false);
    }
  });

  /* 🚨 ROUND ONE'S THREE DEFEATS OF THIS TEST, PINNED AS A CONTROL so they
     cannot come back. Each one was PROVED against the real code path, and
     each one left a genuinely hard-coded size reading as compliant. */
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

  /* The weight ratchet above is app-wide and can only fall as T2 finishes.
     T3's share of it is ONE site — the frozen transition title — so over this
     scope it is an assertion, not a ratchet. A number that may not rise is a
     much weaker claim than a list that must be empty, and the difference is
     the whole reason this block exists. */
  it('no inline weight off the 400/600 axis, except the frozen title', () => {
    const hits = sweep(INLINE_WEIGHT, ({ file, src, index }) => {
      if (!IN_T3_SCOPE(file)) return false;
      if (!isOffAxisWeight(src, index)) return false;
      const window = src.slice(Math.max(0, index - EXEMPT_WINDOW), index + EXEMPT_WINDOW);
      return !INLINE_TYPE_EXCEPTIONS.some((x) => x.file === file && window.includes(x.marker));
    });
    expect(hits, `inline weights off the axis:\n${hits.join('\n')}`).toEqual([]);
  });

  it('CONTROL: the frozen title is still there, and is still the only one', () => {
    // If C2's block were ever edited away this assertion would go quiet and
    // read as success, so the site is pinned positively as well as negatively.
    const inScope = sweep(INLINE_WEIGHT, ({ file, src, index }) =>
      IN_T3_SCOPE(file) && isOffAxisWeight(src, index));
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
    /* 🚨 The denominator is SCOPED. It used to count app-wide — 57 sites, of
       which only 25 are T3's — so if `IN_T3_SCOPE` broke, or T3's files lost
       every inline size, 32 out-of-scope hits still satisfied it and every
       "no hits" assertion above would have read as proof (round one). */
    const inT3 = sweep(INLINE_SIZE, ({ file }) => IN_T3_SCOPE(file));
    expect(inT3.length, 'no inline sizes in T3 scope at all').toBeGreaterThan(20);
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
    // T1's and the pet's, not swept by this bundle (plan §5 lane A3, C5).
    ['src/index.css', '.lesson-content'],
    ['src/index.css', '.companion-chat-md'],
  ];
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
        const block = enclosingBlock(src, lineStart + Math.max(0, within));
        // The selector sits immediately before the block's opening brace.
        const before = src.slice(0, src.indexOf(block));
        const selector = (before.match(/([^{};]+)$/) || [''])[0].trim().replace(/\s+/g, ' ');
        if (!JUDGED_BORDERS.some(([jf, sel]) => jf === f && selector.includes(sel))) {
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
    // Comments are where this file explains itself, and they quote the hexes
    // they replaced; the CODE is what is under test.
    const code = app.slice(open, close)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g), 'a hex is back in the quit dialog').toBeNull();
    expect(code).not.toMatch(/onMouse(?:Enter|Leave)/);
    expect(code).not.toMatch(/currentTarget\.style/);
    // …and the two controls are the kit's, which is what puts the hover in CSS.
    expect(code).toMatch(/<Button\s+variant="secondary"/);
    expect(code).toMatch(/<Button\s+variant="primary"/);
    expect(code).not.toMatch(/<button/);
  });

  it('CONTROL: the CSS scan is actually reading the stylesheets', () => {
    // Every assertion above is an empty-list check, and an empty list is what
    // a scan that opened nothing also returns. These are the denominators.
    expect(CSS_FILES.length).toBe(5);
    for (const f of CSS_FILES) expect(readFileSync(f, 'utf8').length).toBeGreaterThan(1000);
    // A row that is SUPPOSED to be non-zero, so a scan returning nothing
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
