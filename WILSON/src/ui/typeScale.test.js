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
import { sourceFiles } from '../../scripts/ui-audit.mjs';
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
   bans: the number may fall, never rise. Four of the eleven are in App.jsx and
   one of those is the page-transition title, which C2 freezes. */
const INLINE_WEIGHT = /fontWeight\s*:\s*['"]?(?:500|700|bold)['"]?/g;
const INLINE_WEIGHT_RESIDUE = 11;

/** Any side, any width above the hairline, and arbitrary values too. */
const OFF_BORDER = /\bborder(?:-[tblrxyse]{1,2})?-(?:[2-9]\b|\[[^\]]*\])/g;
/* Any corner, every deleted step, and arbitrary values. `rounded-full` is NOT
   here: §3.3's deletion list is "2, 4, 5, 8, 10px" and the 48 live sites are
   dots, avatars, icon circles and pill progress tracks — squaring a circular
   avatar is a view change (C1), not a token swap. */
const OFF_RADIUS = /\brounded(?:-(?:[tblr]|tl|tr|bl|br|[se]{1,2}))?(?![-\w])|\brounded(?:-(?:[tblr]|tl|tr|bl|br|[se]{1,2}))?-(?:(?:sm|md|lg|xl|[2-9]xl)\b|\[[^\]]*\])/g;
const TRANSITION_ALL = /\btransition-all\b/g;
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
