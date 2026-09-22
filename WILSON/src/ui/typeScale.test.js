// =============================================================================
// typeScale.test.js — the codemod's own guard (plan §7's grep audit, as a test)
//
// WHY THIS FILE EXISTS. T0's passes tripped no existing guard, and that is
// correct — no test in this repo pinned a type size. It is also exactly the
// hole C3c named: "the case half of the pass had no guard at all, and a mutant
// proved it". A codemod that moves 2,582 sites and leaves nothing behind to
// hold them will be undone one careless `text-xs` at a time.
//
// So this asserts the INVARIANTS the passes establish, over the same scope the
// passes ran on, using the same modules the passes used. If a later session
// reintroduces an off-scale size or puts body copy back on the Label step,
// this goes red with the file and the line.
//
// Every block carries a CONTROL: a synthetic source string with the defect in
// it, asserted to be DETECTED. Without that, "0 violations" is equally
// consistent with "the detector is broken" — F4's trap 13, an assertion that
// cannot fail.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from '../../scripts/ui-audit.mjs';
import { protectedRanges, isProtected } from '../../scripts/ui-source-regions.mjs';
import { LABEL_EVIDENCE, CONTROL_TAGS } from '../../scripts/ui-type-map.mjs';
import { classifyMono } from '../../scripts/ui-mono-map.mjs';
import { enclosingRun, enclosingTag } from '../../scripts/ui-type-inventory.mjs';

/* The Label step used WITHOUT `uppercase`, on purpose, by name and reason.
   A bare count would let a new offender in whenever an old one left; naming
   the files makes the exception a decision someone has to edit. */
const BARE_LABEL_EXCEPTIONS = {
  'src/components/HelpPage.jsx':
    'the version footer — a version number has no case to convert (D2)',
};

/** Off-scale size tokens. `text-label` and friends deliberately do not match. */
const OFF_SCALE = /\btext-(?:\[(\d+(?:\.\d+)?)px\]|(xs|sm|base|lg|xl|2xl|3xl)\b)/g;
/* 🚨 The lookbehind is load-bearing. `\btext-label\b` matches INSIDE
   `var(--text-label)` — `-` is a non-word character, so there is a word
   boundary right before `text`. Four CSS-variable reads in DevFixturesBadge
   were reported as case-less labels before this. */
const SCALE_STEP = /(?<![-\w])text-(?:h1|h2|h3|body|dense|caption|label)\b/g;

/* 🚨 READ THE TREE ONCE. Six sweeps over 271 files is ~1,600 reads plus a
   region scan each, and while this file passes on its own in a second, under
   vitest's parallel workers that I/O pushed four unrelated tree-walking tests
   (devFixtures, authStateCallbacks, quizWiring, aiFiles) past their 5s timeout
   and tripled the whole suite's wall clock. A guard that makes other tests
   fail is worse than no guard: the next session debugs the wrong thing. */
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
      const run = enclosingRun(src, m.index) || '';
      const tag = enclosingTag(src, m.index);
      const line = src.slice(0, m.index).split('\n').length;
      if (!judge || judge({ token: m[0], run, tag, file })) {
        out.push(`${file}:${line}  ${m[0]}  [${run.replace(/\s+/g, ' ').slice(0, 90)}]`);
      }
    }
  }
  return out;
}

describe('type scale — no size off the seven steps (C7, plan §3.1)', () => {
  it('has no text-[Npx] and no text-xs…3xl in converted source', () => {
    const hits = sweep(OFF_SCALE);
    expect(hits, `off-scale sizes:\n${hits.join('\n')}`).toEqual([]);
  });

  it('CONTROL: the detector finds an off-scale size when one is present', () => {
    const src = 'const a = <p className="text-[10.5px] text-stone-500">x</p>';
    expect(src.match(new RegExp(OFF_SCALE.source, 'g'))).toEqual(['text-[10.5px]']);
  });

  it('CONTROL: the detector does NOT flag a scale step', () => {
    const src = 'const a = <p className="text-dense text-ink-2">x</p>';
    expect(src.match(new RegExp(OFF_SCALE.source, 'g'))).toBeNull();
  });

  it('CONTROL: the sweep reads real files and finds the steps the passes wrote', () => {
    // Guards the scope itself: an empty file list would make every assertion
    // above pass vacuously.
    expect(sourceFiles().length).toBeGreaterThan(200);
    expect(sweep(SCALE_STEP).length).toBeGreaterThan(2000);
  });
});

describe('the Label step is for labels (the C3b lesson)', () => {
  it('every text-label site still carries its uppercase', () => {
    const bare = sweep(SCALE_STEP, ({ token, run, tag }) =>
      token === 'text-label'
      && !LABEL_EVIDENCE.some((re) => re.test(run))
      && !CONTROL_TAGS.test(tag));
    const unexpected = bare.filter(
      (hit) => !Object.keys(BARE_LABEL_EXCEPTIONS).some((f) => hit.startsWith(`${f}:`)));
    expect(unexpected, `text-label sites with no uppercase:\n${unexpected.join('\n')}`)
      .toEqual([]);
  });

  it('CONTROL: each named bare-label exception is still really there', () => {
    // An allowlist nobody checks becomes a list of files that no longer exist.
    const bare = sweep(SCALE_STEP, ({ token, run, tag }) =>
      token === 'text-label'
      && !LABEL_EVIDENCE.some((re) => re.test(run))
      && !CONTROL_TAGS.test(tag));
    for (const f of Object.keys(BARE_LABEL_EXCEPTIONS)) {
      expect(bare.some((hit) => hit.startsWith(`${f}:`)), `${f} is allowlisted but clean now`).toBe(true);
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

// ── Pass 2: two weights, and tracking only where the Label step wants it ────
describe('weight and tracking (§3.1: the scale has 400 and 600)', () => {
  it('has no font-bold (700) and no font-medium (500)', () => {
    const hits = sweep(/\bfont-(?:bold|medium)\b/g);
    expect(hits, `weights off the 400/600 axis:\n${hits.join('\n')}`).toEqual([]);
  });

  it('has no named tracking utility except on a label that kept its capitals', () => {
    // Eleven eyebrow sites inherit their size from a parent, so they carry no
    // step and were left whole rather than being given one — giving an
    // inherited size an explicit 11px is a layout call, not a token swap.
    // Their tracking stays WITH their capitals; the pair is the exception.
    const hits = sweep(/\btracking-(?:wide|wider|widest|tight|tighter)\b/g,
      ({ run }) => !/\buppercase\b/.test(run));
    expect(hits, `tracking with no capitals to track:\n${hits.join('\n')}`).toEqual([]);
  });

  it('CONTROL: both weight detectors fire on a real string', () => {
    expect('a font-bold b'.match(/\bfont-(?:bold|medium)\b/g)).toEqual(['font-bold']);
    expect('a font-medium b'.match(/\bfont-(?:bold|medium)\b/g)).toEqual(['font-medium']);
    expect('a font-semibold b'.match(/\bfont-(?:bold|medium)\b/g)).toBeNull();
  });
});

// ── Pass 3: mono is for data ────────────────────────────────────────────────
// These twelve cases ARE the map's specification. Each was read out of the
// tree by hand and judged BEFORE the patterns were written to satisfy it, and
// the first draft got five of them wrong — which is why they are pinned rather
// than described. A later session that widens a pattern finds out here which
// side of the line it has moved.
describe('mono is for data, sans for everything else (§3.1)', () => {
  const RUN = 'text-dense font-mono';
  const cases = [
    ['{d.toLocaleDateString()}', 'div', RUN, true, 'a timestamp'],
    ['{file.display_name || file.original_name}', 'span', RUN, true, 'a file name, though it contains "name"'],
    ['{stats.taskCount}', 'span', RUN, true, 'a count, though the boundary is a camelCase hump'],
    ['{__OTTER_VERSION__}', 'span', RUN, true, 'a version, though the boundary is an underscore'],
    ['+{fmtCurrency(a, b)}', 'span', RUN, true, 'a figure with a character in front of it'],
    ['{sceneShots.length}', 'span', RUN, true, "a collection's size is a count"],
    ['{fmtCurrency(grand.total)}', 'div', 'text-h1 font-mono', true, 'a figure at a heading size is still a figure (the kit\'s Stat)'],
    ['{project.title}', 'span', RUN, false, 'a title is prose'],
    ['{member.email}', 'span', RUN, false, 'an address reads as prose in a modern UI'],
    ['No projects yet.', 'div', RUN, false, 'an empty state'],
    ['Contingency', 'td', RUN, false, 'a row label in a table cell'],
    ['{row.code}', 'span', 'text-label font-mono uppercase', false, 'the Label step is sans whatever it holds'],
  ];

  for (const [body, tag, run, keep, why] of cases) {
    it(`${keep ? 'keeps' : 'drops'} mono: ${why}`, () => {
      expect(classifyMono({ tag, run, body }).keep).toBe(keep);
    });
  }

  it('a control is sans whatever it holds — the kit already says so', () => {
    // .ui-input is var(--font-sans); C8 makes that the app's answer, not taste.
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

// ── Pass 4: one border, two radii, named transitions, no white ─────────────
describe('surface tokens (§3.3, §3.4, C9)', () => {
  it('has one border width: the 1px hairline', () => {
    // C4 keeps LayoutVisualizer's border-2, and the scope already excludes it.
    const hits = sweep(/\bborder-[2-9]\b/g);
    expect(hits, `border widths off the hairline:\n${hits.join('\n')}`).toEqual([]);
  });

  it('has two radii: rounded-control and rounded-float', () => {
    // §3.3 deletes 2, 4, 5, 8 and 10px. `rounded-full` is NOT on that list and
    // is not a radius — its 48 sites are dots, avatars, icon circles and pill
    // progress tracks, and squaring an avatar is a view change (C1).
    const hits = sweep(/\brounded(?![-\w])|\brounded-(?:sm|md|lg|xl|2xl)\b/g);
    expect(hits, `radii off the two-step system:\n${hits.join('\n')}`).toEqual([]);
  });

  it('has no transition-all', () => {
    // Home is out of the codemod's scope entirely (Q2/W4), and keeps its two.
    const hits = sweep(/\btransition-all\b/g, ({ file }) => !/Home\.jsx$/.test(file));
    expect(hits, `transition-all survives:\n${hits.join('\n')}`).toEqual([]);
  });

  it('has no white ground outside the one dark selection fill', () => {
    // `border-white bg-white/20` on O.T.T.E.R.'s checkbox indicator is a
    // selected-state fill on the DARK surface, not a ground. `well-light` is
    // rgba(120,70,30,0.18) — a warm screen for `#f4a261` — and on dark paper
    // it would make the selection invisible. C9 names grounds, cards and
    // wells; this is none of them. Named here so the swap is a decision.
    const hits = sweep(/\bbg-white(?:\/\d+)?\b/g,
      ({ file }) => !/otter_v0\.3\.1[\/]Otter\.jsx$/.test(file));
    expect(hits, `white grounds:\n${hits.join('\n')}`).toEqual([]);
  });

  it('has no arbitrary spacing off the 4px scale (§3.3)', () => {
    // The scale is 4, 8, 12, 16, 24, 32, 48. `vh` is NOT swept here: the 72
    // remaining uses are `max-h-[85vh]` on dialogs and overlays, and capping a
    // floating surface against the viewport is what vh is for. §3.3's "nothing
    // in vh" is about the spacing rhythm and names App.jsx's `3vh 0` padding
    // as its example — which F2 already converted to `--spacing-gutter`.
    const hits = sweep(/\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-\[\d+(?:\.\d+)?px\]/g);
    expect(hits, `arbitrary spacing:\n${hits.join('\n')}`).toEqual([]);
  });

  it('App.jsx takes the one 24px gutter, not a viewport fraction', () => {
    const app = readFileSync('src/App.jsx', 'utf8');
    expect(app).toContain("'var(--spacing-gutter) 0'");
    expect(app).not.toMatch(/padding:\s*(?:\([^)]*\)\s*\?[^:]*:\s*)?['"]\d+vh/);
  });

  it('CONTROL: every surface detector fires on a real string', () => {
    expect('a py-[5px] b'.match(/\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-\[\d+(?:\.\d+)?px\]/g)).toEqual(['py-[5px]']);
    expect('a py-1 b'.match(/\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-\[\d+(?:\.\d+)?px\]/g)).toBeNull();
    expect('a border-2 b'.match(/\bborder-[2-9]\b/g)).toEqual(['border-2']);
    expect('a rounded-sm b'.match(/\brounded(?![-\w])|\brounded-(?:sm|md|lg|xl|2xl)\b/g)).toEqual(['rounded-sm']);
    expect('a rounded b'.match(/\brounded(?![-\w])|\brounded-(?:sm|md|lg|xl|2xl)\b/g)).toEqual(['rounded']);
    expect('a rounded-control b'.match(/\brounded(?![-\w])|\brounded-(?:sm|md|lg|xl|2xl)\b/g)).toBeNull();
    expect('a rounded-full b'.match(/\brounded(?![-\w])|\brounded-(?:sm|md|lg|xl|2xl)\b/g)).toBeNull();
    expect('a bg-white/40 b'.match(/\bbg-white(?:\/\d+)?\b/g)).toEqual(['bg-white/40']);
  });
});
