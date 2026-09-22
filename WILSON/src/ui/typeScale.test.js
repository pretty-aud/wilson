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
import {
  coverage, inlineClassEvidence, valueArms, declsNearMarker, openTagOf,
  openingTagEndFromAttr, classNameRun, ownTextFrom,
  SPELLINGS_MATCH_PROPS, INLINE_TYPE_PROPS, NOT_A_STYLE,
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
/* 🚨 TWO CONSTS, BECAUSE THEY ANSWER TWO QUESTIONS, AND ONE REGEX ANSWERED
   BOTH WRONGLY. The single `/fontWeight\s*:\s*['"]?(?:500|700|bold)['"]?/` was
   a VALUE filter doing duty as a SPELLING filter: `fontWeight: 900` in
   R.A.B.B.I.T. satisfied "this lane declares no inline weight", and
   `fontWeight: 800` app-wide satisfied "no inline weight off the 400/600
   axis" — by the assertion's own name. A reviewer planted all three and the
   suite stayed green; `bolder` was caught only by accident, as a substring of
   `bold`. The class-side twin `OFF_WEIGHT` covers `font-black` and
   `font-extrabold`; the inline side covered neither's numeral. */
const INLINE_WEIGHT_ANY = /fontWeight\s*:/g;
const INLINE_WEIGHT_VAL = /fontWeight\s*:\s*([^,;\n}]+)/g;

/** Is ONE rendered value off §3.1's two-weight axis? Every numeral except
 *  400 and 600, and every keyword the CSS spec allows. */
const offAxisWeight = (v) =>
  /^['"]?(?:100|200|300|500|700|800|900)['"]?$/.test(String(v).trim())
  || /^['"]?(?:bold|bolder|lighter|thin|black|extrabold|semibold|medium|light)['"]?$/.test(String(v).trim());

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
    expect(fires(INLINE_WEIGHT_ANY, "fontWeight: 'bold'")).toBe(true);
    expect(fires(INLINE_WEIGHT_ANY, 'fontWeight: 600')).toBe(true);   // a SPELLING test
    expect(fires(INLINE_WEIGHT_ANY, 'font-semibold')).toBe(false);
    // …and the VALUE test, which is the one that knows about the axis.
    for (const v of ['100', '200', '300', '500', '700', '800', '900', "'bold'",
      'bolder', 'lighter', 'black']) {
      expect(offAxisWeight(v), `${v} is off the axis`).toBe(true);
    }
    for (const v of ['400', '600', "'400'", 'WEIGHT.h2', 'undefined', 'inherit']) {
      expect(offAxisWeight(v), `${v} is on the axis or not a weight`).toBe(false);
    }
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

/* A value is ON THE SYSTEM when it reads a token, or when it is a CSS keyword
   that RESETS rather than sets. A bare `0` is on the list because §3.1 gives
   five of the seven steps zero tracking, so `letterSpacing: 0` states the
   system's own default rather than inventing a number. */
/* The leading `\b` on the token alternation is load-bearing: without it
   `MYTYPE.junk` and `legacyTYPE.x` both read as on-system (measured). */
const ON_SYSTEM_VALUE = /\b(?:TYPE|LEADING|TRACKING|WEIGHT)\s*\.\s*[a-z0-9]+|\bTYPE_FLOOR\b|\bFONT_(?:MONO|SANS)\b|var\(--(?:text|font)-|\bAUTH_[A-Z_]+\b|\b(?:inherit|initial|unset|revert|normal|none|undefined)\b|^\s*0\s*$/;

/* The three declarations that can carry a hard-coded type value. `fontWeight`
   is NOT among them: it has its own ratchet above, and 400/600 written as
   numerals is the system's own vocabulary rather than a magic number. */
const INLINE_SIZE = /fontSize\s*:\s*([^,;\n}]+)/g;
const INLINE_FAMILY = /fontFamily\s*:\s*([^,;\n}]+)/g;
const INLINE_TRACKING = /letterSpacing\s*:\s*([^,;\n}]+)/g;
/* The fifth spelling. It has no value test because there are only two answers
   and one of them — `uppercase` — is the Label step's own, so what matters is
   whether the declaration exists at all in a lane that has landed. */
const INLINE_CASE = /textTransform\s*:/g;
const INLINE_CASE_VAL = /textTransform\s*:\s*([^,;\n}]+)/g;

/**
 * 🚨 THE FLOOR IS A PROPERTY OF A VALUE, SO IT IS TESTED ON A VALUE.
 *
 * The first draft was a regex over raw source —
 * `/fontSize\s*:\s*['"]?(?:10|\d)…/` — and it had two failures a reviewer
 * proved with one mutant each:
 *   · a ternary hid from it. `fontSize: wide ? TYPE.dense : 9` has `wide`
 *     after the colon, so the digit test never ran and a 9px arm shipped.
 *   · its control checked 8, 9, 10 and the em/percent edge but never 1–7, so
 *     narrowing the detector's range to `(?:10|[89])` left every case passing.
 *
 * Both go away if the question is asked of each ARM, in units:
 *   a px value under 11 is a violation; an em, a rem, a percent and a token
 *   are not — `0.9em` is 90 percent of whatever it inherits (11.7px inside
 *   Dense) and an assertion about the FLOOR that fires on it is one nobody can
 *   act on.
 */
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
function hardCodedInline(re, applyExceptions = true) {
  return sweep(re, ({ file, src, index, token }) => {
    if (!IN_ASSERTED_SCOPE(file)) return false;
    /* 🚨 EVERY ARM ANSWERS FOR ITSELF, AND A SUBSTRING TEST LET ONE ARM SPEAK
       FOR BOTH. `fontSize: wide ? TYPE.dense : 9` contains `TYPE.dense`, so an
       unanchored `test` over the whole value called the declaration on-system
       and the 9px arm shipped — past this assertion AND past the 11px floor,
       which looked for a digit straight after the colon and found `wide`. A
       reviewer proved it with one mutant. `valueArms` also strips comments,
       because `fontSize: '15px' /* was var(--text-dense) *\/` satisfied the
       token test on the strength of its own apology. */
    const arms = valueArms(token.slice(token.indexOf(':') + 1));
    if (arms.length && arms.every((a) => ON_SYSTEM_VALUE.test(a))) return false;
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

  /* T2's lane had a ratchet here at 77 while it worked. It has landed, and a
     landed lane gets an assertion rather than a number: not "no hard-coded
     VALUE" — which the three assertions above already cover app-wide — but
     the stronger and simpler claim that R.A.B.B.I.T. carries no inline type
     DECLARATION at all, of any spelling, token-valued or not. 105 of them
     went; a table that styled itself from two consts is why it is worth
     saying out loud. */
  it('neither tool lane declares any type in a style object', () => {
    // 🚨 `INLINE_WEIGHT_ANY`, not the value regex. The first draft used a
    // filter that only matches 500/700/bold, so `fontWeight: 900` — and
    // `fontWeight: 400` — satisfied "declares none". A reviewer planted both
    // and the suite stayed green.
    // T1's lane is here too: it landed with none, and a lane that is finished
    // is asserted rather than described.
    const hits = [INLINE_SIZE, INLINE_FAMILY, INLINE_TRACKING, INLINE_WEIGHT_ANY, INLINE_CASE]
      .flatMap((re) => sweep(re, ({ file, src, index }) => {
        if (!T2_LANE.test(file) && !T1_LANE.test(file)) return false;
        /* The allowlist applies here too, and it has exactly one entry in a
           tool lane: Monaco's `options={{ minimap: …, fontSize: 14 }}`, which
           is a third-party editor's API and not a style attribute at all. */
        const window = src.slice(Math.max(0, index - EXEMPT_WINDOW), index + EXEMPT_WINDOW);
        return !INLINE_TYPE_EXCEPTIONS.some((x) => x.file === file && window.includes(x.marker));
      }));
    expect(hits, `inline type in a tool lane:\n${hits.join('\n')}`).toEqual([]);
  });

  /* 🚨 THE FIFTH SPELLING WAS ASSERTED OVER ONE LANE WHILE THE BLOCK CLAIMED
     THE APP. `textTransform` appeared only in the lane test above, so a
     reviewer added `textTransform: 'uppercase'` to `CurrencyPicker.jsx` and
     the suite stayed green — four-fifths of the app unguarded on the property
     that decides whether text SHOUTS.
     The app-wide claim is about the VALUE, because §3.1 has exactly two cases,
     sentence and UPPER, and `uppercase` on a Label-step element is the system
     working. What it forbids is a third case. */
  it('no inline textTransform invents a case the scale does not have', () => {
    const hits = sweep(INLINE_CASE_VAL, ({ token }) =>
      valueArms(token.slice(token.indexOf(':') + 1))
        .some((a) => !/^['"]?(?:uppercase|none|inherit|initial|unset|revert)['"]?$/.test(a.trim())));
    expect(hits, `case values off the two the scale has:\n${hits.join('\n')}`).toEqual([]);
  });

  /* 🚨 STATED IN ITS OWN RIGHT, THOUGH THE VALUE TEST ABOVE IMPLIES IT TODAY.
     §3.1's floor is 11px and there is no step under it — a claim about the
     SYSTEM, where the assertions above are claims about the SPELLING of a
     value. The two come apart the moment somebody adds an entry to
     `INLINE_TYPE_EXCEPTIONS`: an exempted `fontSize: '9px'` would pass every
     assertion above it and this one would still go red, which is the whole
     point of writing it down. */
  it('no inline size sits below the 11px floor', () => {
    const hits = sweep(INLINE_SIZE, ({ token }) =>
      valueArms(token.slice(token.indexOf(':') + 1)).some(belowFloorArm));
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

  it('CONTROL: every inline detector fires, and only on its own spelling', () => {
    /* 🚨 THE FILE'S OWN RULE 1, APPLIED TO THE CONSTS THAT WERE MISSING IT.
       Four of the six inline regexes appeared in an assertion and in no
       control, so a reviewer replaced `INLINE_FAMILY` with
       `/fontFamilyNEVER…/`, planted a real hand-written `'ui-monospace, Menlo,
       monospace'`, and the suite stayed green — the assertion was live, but
       nothing pinned the regex it ran. The same held for `INLINE_CASE`.
       `INLINE_SIZE` and `INLINE_TRACKING` were pinned only INCIDENTALLY, by
       the allowlist's `sites:` counts, which is not a pin anybody wrote. */
    expect(fires(INLINE_SIZE, 'fontSize: 15')).toBe(true);
    expect(fires(INLINE_SIZE, "fontSize: 'var(--text-dense)'")).toBe(true);
    expect(fires(INLINE_SIZE, 'text-dense')).toBe(false);
    expect(fires(INLINE_FAMILY, "fontFamily: 'monospace'")).toBe(true);
    expect(fires(INLINE_FAMILY, 'fontFamily: FONT_MONO')).toBe(true);
    expect(fires(INLINE_FAMILY, 'font-mono')).toBe(false);
    expect(fires(INLINE_TRACKING, "letterSpacing: '0.06em'")).toBe(true);
    expect(fires(INLINE_TRACKING, 'tracking-wide')).toBe(false);
    expect(fires(INLINE_CASE, "textTransform: 'uppercase'")).toBe(true);
    expect(fires(INLINE_CASE_VAL, "textTransform: 'none'")).toBe(true);
    expect(fires(INLINE_CASE, 'uppercase')).toBe(false);
  });

  it('CONTROL: the below-floor detector covers its whole range', () => {
    // 🚨 1 THROUGH 10, not just the three the first control happened to name.
    // A reviewer narrowed the detector from 1–10 to 8–10 and every case in
    // that control still passed.
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10.5, 9.5]) {
      expect(belowFloorArm(String(n)), `${n} is below the floor`).toBe(true);
      expect(belowFloorArm(`'${n}px'`), `'${n}px' is below the floor`).toBe(true);
    }
    // `110` is not an `11`, and a RELATIVE size is not a px value below the
    // floor — `0.9em` is 90 percent of whatever it inherits, 11.7px inside
    // Dense. An assertion about the FLOOR that fires on it is one nobody can
    // act on.
    for (const v of ['11', "'13px'", '100', '110', '20', "'0.9em'", "'95%'",
      '1.2rem', 'TYPE.dense', "'var(--text-label)'", 'wide']) {
      expect(belowFloorArm(v), `${v} is not a below-floor px value`).toBe(false);
    }
    // …and through the arm splitter, which is how the assertion reaches it.
    expect(valueArms('wide ? TYPE.dense : 9').some(belowFloorArm)).toBe(true);
    expect(valueArms('wide ? TYPE.dense : TYPE.label').some(belowFloorArm)).toBe(false);
  });

  it('CONTROL: a value test that one arm can launder is not a value test', () => {
    // Every one of these was green before `valueArms` was wired in.
    expect(valueArms('wide ? TYPE.dense : 9').every((a) => ON_SYSTEM_VALUE.test(a))).toBe(false);
    expect(valueArms("'15px' /* was var(--text-dense) */")
      .every((a) => ON_SYSTEM_VALUE.test(a))).toBe(false);
    // …while a fully tokenised conditional stays on-system, conditions and all.
    expect(valueArms('size >= 40 ? TYPE.h2 : TYPE.label')
      .every((a) => ON_SYSTEM_VALUE.test(a))).toBe(true);
    // The leading boundary on the token alternation, which was missing.
    expect(ON_SYSTEM_VALUE.test('MYTYPE.junk')).toBe(false);
    expect(ON_SYSTEM_VALUE.test('TYPE.dense')).toBe(true);
  });

  it("CONTROL: the inventory's own property list cannot be pruned in silence", () => {
    // 🚨 `coverage()` IS ONLY A CONTROL IF ITS TWO SIDES ARE INDEPENDENT.
    // `rawDeclCount` used to loop the same `INLINE_TYPE_PROPS` that `typeDecls`
    // loops, so deleting the single word 'fontSize' — the central property of
    // the whole bundle — dropped the inventory from 21 sites to 14 while every
    // coverage row still read ` ok `. The denominator is five literal regexes
    // now, and this is what keeps the two lists describing the same thing.
    expect(SPELLINGS_MATCH_PROPS(), 'RAW_SPELLINGS and INLINE_TYPE_PROPS disagree').toBe(true);
    expect(INLINE_TYPE_PROPS).toEqual(
      ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'textTransform']);
  });

  it("CONTROL: the inventory's own exemption covers exactly what it claims", () => {
    // `src.includes(marker)` is file-keying under another name, and a WINDOW
    // alone does not fix it — every declaration has an `e` within 400
    // characters. Counting does: a widened marker covers more sites than its
    // `n`, the coverage arithmetic stops balancing, and the row reads MISS.
    const entry = NOT_A_STYLE[0];
    const otter = tree().find((t) => t.file === entry.file);
    expect(otter, `${entry.file} is exempted but not in scope`).toBeTruthy();
    expect(declsNearMarker(otter.src, entry.marker), 'the exemption must cover its own site')
      .toBe(entry.n);
    expect(declsNearMarker('const x = 1', entry.marker), 'no declaration, no exemption').toBe(0);

    /* The over-covering half, on a synthetic source: the one live exemption
       sits in a file that holds exactly ONE declaration, so counting alone
       cannot tell a tight marker from a loose one THERE. Two declarations, far
       enough apart that a 400-character window reaches only its own. */
    const synthetic = `const a = { fontSize: 14, marker_ALPHA: true }\n${'\n'.repeat(500)}`
      + 'const b = { fontSize: 12, marker_BETA: true }\n';
    expect(declsNearMarker(synthetic, 'marker_ALPHA'), 'a specific marker covers one site').toBe(1);
    expect(declsNearMarker(synthetic, 'e'), 'a one-letter marker covers both').toBe(2);
  });

  it('CONTROL: every allowlist marker is specific enough to name its site', () => {
    /* 🚨 COUNTING IS NOT ENOUGH IN A FILE WITH ONE DECLARATION. A reviewer
       widened `NOT_A_STYLE`'s marker to the single letter `e`; the count
       stayed at 1, because Otter has exactly one declaration to count, and the
       exemption held. So the marker itself is pinned: it has to be long enough
       to name something, and it has to be rare enough in its own file that it
       could not be pointing anywhere else. Both allowlists in this file go
       through it — T3's `INLINE_TYPE_EXCEPTIONS` as well as T2's
       `NOT_A_STYLE`, because the same widening works on either. */
    const entries = [
      ...NOT_A_STYLE.map((e) => ({ ...e, sites: e.n, from: 'NOT_A_STYLE' })),
      ...INLINE_TYPE_EXCEPTIONS.map((e) => ({ ...e, from: 'INLINE_TYPE_EXCEPTIONS' })),
    ];
    expect(entries.length, 'both allowlists must be non-empty or this proves nothing')
      .toBeGreaterThan(3);
    for (const e of entries) {
      expect(e.marker.length, `${e.from} ${e.file}: "${e.marker}" is too short to name a site`)
        .toBeGreaterThanOrEqual(6);
      const src = tree().find((t) => t.file === e.file)?.src;
      expect(src, `${e.from}: ${e.file} is exempted but not in scope`).toBeTruthy();
      const occurrences = src.split(e.marker).length - 1;
      expect(occurrences, `${e.from} ${e.file}: "${e.marker}" appears ${occurrences} times but claims ${e.sites} site(s)`)
        .toBeLessThanOrEqual(e.sites);
    }
  });

  /* ── The inventory's own three silent failures, each pinned on a synthetic
        source. All three were found by a reviewer, all three failed in the
        safe-LOOKING direction, and none of them is visible to `coverage()`:
        the declaration is still counted, merely judged on bad evidence. ── */
  it('CONTROL: a less-than operator does not eat the element it precedes', () => {
    // 🚨 `src.lastIndexOf('<', attrStart)` cannot tell an opening tag from a
    // comparison. Measured over the tree, it disagreed with the quote-aware
    // walk at two live sites, both in T2's own lane (`BudgetView.jsx:699`,
    // `BinFileGrid.jsx:86`). Both escape damage today only because their
    // className sits after the stray `<`; move it and the run comes back
    // EMPTY, which is the map blind — T0's defect #8.
    const clean = `<span className="text-label uppercase" style={{ fontSize: 11 }}>A</span>`;
    const dirty = `<span className="text-label uppercase" onClick={() => n < 3 && go()} style={{ fontSize: 11 }}>B</span>`;
    for (const [what, src] of [['clean', clean], ['with a < operator', dirty]]) {
      const at = src.indexOf('style=');
      const { index, tag } = openTagOf(src, at);
      const end = openingTagEndFromAttr(src, at);
      expect(tag, `${what}: tag`).toBe('span');
      expect(classNameRun(src, index, end), `${what}: the class run survives`)
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
    // The family test was written against `'ui-monospace,monospace'` and
    // `DATA`, case-sensitively — and T3 converted those sites to `FONT_MONO`,
    // which SHOUTS. Every site the overhaul actually converted printed no
    // family verdict at all.
    for (const v of ["'ui-monospace,monospace'", 'FONT_MONO', 'DATA', "'monospace'"]) {
      expect(/mono|\bDATA\b/i.test(v), `${v} is a mono value`).toBe(true);
    }
    for (const v of ['SANS', 'FONT_SANS', "'var(--font-sans)'"]) {
      expect(/mono|\bDATA\b/i.test(v), `${v} is not`).toBe(false);
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

  /* T3 asserted this over its own surfaces and left the rest ratcheting at 7,
     because T2 still held six. T2 landed with none, so the scope predicate is
     gone and the claim is app-wide: exactly one inline weight in `src/**`, and
     it is the one the plan freezes. A number that may not rise is a much
     weaker claim than a list that must be empty. */
  it('no inline weight off the 400/600 axis, except the frozen title', () => {
    // 🚨 EVERY NUMERAL AND EVERY KEYWORD, AND THROUGH THE ARMS. The value
    // filter this used to be matched 500, 700 and `bold` only, so 800, 900,
    // 300 and `lighter` all passed an assertion whose own title names the
    // axis; `bolder` was caught by accident, as a substring of `bold`. And a
    // conditional hid its arms: `w ? 700 : undefined` has `w` after the colon.
    const hits = sweep(INLINE_WEIGHT_VAL, ({ file, src, index, token }) => {
      if (!valueArms(token.slice(token.indexOf(':') + 1)).some(offAxisWeight)) return false;
      const window = src.slice(Math.max(0, index - EXEMPT_WINDOW), index + EXEMPT_WINDOW);
      return !INLINE_TYPE_EXCEPTIONS.some((x) => x.file === file && window.includes(x.marker));
    });
    expect(hits, `inline weights off the axis:\n${hits.join('\n')}`).toEqual([]);
  });

  it('CONTROL: the frozen title is still there, and is still the only one', () => {
    // If C2's block were ever edited away this assertion would go quiet and
    // read as success, so the site is pinned positively as well as negatively.
    const inScope = sweep(INLINE_WEIGHT_VAL, ({ token }) =>
      valueArms(token.slice(token.indexOf(':') + 1)).some(offAxisWeight));
    expect(inScope.length, `off-axis inline weights, app-wide:\n${inScope.join('\n')}`).toBe(1);
    expect(inScope[0]).toMatch(/^src[/\\]App\.jsx:/);
    const app = tree().find((t) => t.file === 'src/App.jsx').src;
    expect(app).toContain("fontSize: '16.8px'");
    expect(app).toContain("letterSpacing: '0.3em'");
    expect(app).toContain("transitionState === 'title-hold'");
  });

  it('CONTROL: the scope really is every lane, and the sweep really scans', () => {
    /* 🚨 THIS CONTROL USED TO PROVE A PREDICATE NO ASSERTION RAN. It exercised
       `IN_T3_SCOPE`, which stopped being reachable the moment
       `IN_ASSERTED_SCOPE` became `() => true` — a control for a code path with
       no caller is the file's own rule 1 inside out, and a reviewer said so.
       It now measures what the assertions above actually cover. */
    const scanned = tree().filter((t) => IN_ASSERTED_SCOPE(t.file));
    expect(scanned.length, 'the scope must be the whole tree').toBe(tree().length);
    for (const lane of [T1_LANE, T2_LANE]) {
      expect(scanned.some((t) => lane.test(t.file)), `${lane} is inside the scope`).toBe(true);
    }
    expect(scanned.some((t) => !/(^|\/)tools\//.test(t.file)), 'and so is everything else').toBe(true);
    // And "no hits" is not "no scan": the sweeps find plenty, they just pass.
    expect(sweep(INLINE_SIZE).length).toBeGreaterThan(20);
    expect(sweep(INLINE_WEIGHT_ANY).length).toBeGreaterThan(10);
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

  /* App.jsx's close dialog is not a kit component — it is inline styles — so
     its primary button's hover is a JS handler rather than a `:hover` rule.
     The VALUE is copied from the kit rather than approximated, and there is no
     `signal-fill-hover` token to point at because the kit derives it instead
     of declaring it. A copied value drifts unless something watches, so this
     is the something: the two strings must be identical, character for
     character. If the kit ever changes its primary hover, this goes red and
     names the dialog as the other place that has to move. */
  it('the close dialog\'s primary hover is the kit\'s own expression', () => {
    const css = readFileSync('src/index.css', 'utf8');
    const kit = css.match(/\[data-variant="primary"\]:hover[^{]*\{[^}]*?background-color:\s*([^;]+);/);
    expect(kit, 'the kit no longer has a primary :hover background').toBeTruthy();
    const app = tree().find((t) => t.file === 'src/App.jsx').src;
    const mine = app.match(/const BTN_PRIMARY_HOVER = '([^']+)'/);
    expect(mine, 'App.jsx no longer declares BTN_PRIMARY_HOVER').toBeTruthy();
    expect(mine[1]).toBe(kit[1].trim());
    // …and it is a derived expression, not a fourth orange written as a hex (C8).
    expect(mine[1]).toMatch(/^color-mix\(/);
    expect(mine[1]).not.toMatch(/#[0-9a-fA-F]{3,8}/);
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
