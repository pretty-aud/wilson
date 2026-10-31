// =============================================================================
// dog.css — V2, the second visual QA pass (2026-09-27). D.O.G.'s settings
// accordions take the two corrections O.T.T.E.R.'s copy of them already has
// (A4 hand-off §4, row 17): the third-ink description and the locked label
// are lifted to the second ink under the hover wash (the third ink is 3.99:1
// there, over paper-raised: tokens.test.js), and the head's focus ring is
// drawn inside, because `.dog-acc` clips (overflow: hidden) and cut it.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { allRules, decls, splitTop, specificity, compareSpecificity, themeValues, mentionsTokenHex, INK_PROPS } from '../../../scripts/ui-css-rules.mjs'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'

const traverse = traverseModule.default || traverseModule

const read = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
const DOG = read('./dog.css')
const OTTER = read('../otter_v0.3.1/otter.css')
const norm = (s) => s.replace(/\s+/g, ' ').replace(/"/g, "'").trim()
/** Every selector in a sheet whose own declarations set `prop` to a value
    `re` accepts, with the heads of the blocks around it. */
const setting = (css, prop, re) => allRules(css).flatMap((r) => {
  const d = decls(r.body).filter(([p]) => p === prop).pop()
  return d && re.test(d[1]) ? splitTop(r.sel).map((s) => ({ sel: norm(s), parents: r.parents.map(norm) })) : []
})
const LIFT = /^var\(--color-ink(-2)?\)$/

describe('dog.css: the settings accordions, level with O.T.T.E.R.\'s (V2; A4 §4 row 17)', () => {
  const PAIRS = [
    ['.dog-acc-head:hover .dog-acc-desc', '.otter-acc-head:hover .otter-acc-desc'],
    [".dog-settings-body[data-locked='true'] .dog-acc-head:hover .dog-acc-label",
      ".otter-settings-body[data-locked='true'] .otter-acc-head:hover .otter-acc-label"],
  ]

  it('lifts the third ink under the hover wash, only where a pointer hovers, as O.T.T.E.R. does', () => {
    const dog = setting(DOG, 'color', LIFT)
    const otter = setting(OTTER, 'color', LIFT)
    for (const [d, o] of PAIRS) {
      // CONTROL: the same scan finds the O.T.T.E.R. rule this one copies.
      expect(otter.some((x) => x.sel === o), `the scan missed O.T.T.E.R.'s ${o}`).toBe(true)
      const hit = dog.find((x) => x.sel === d)
      expect(hit, `not lifted: ${d}`).toBeTruthy()
      expect(hit.parents.some((p) => p.startsWith('@media (hover: hover)')), `${d} is outside @media (hover: hover)`).toBe(true)
    }
    // CONTROL: the rule the lift answers is still there — the description
    // rests on the third ink.
    expect(setting(DOG, 'color', /^var\(--color-ink-3\)$/).some((x) => x.sel === '.dog-acc-desc')).toBe(true)
  })

  it('draws the head\'s focus ring inside the accordion, which clips', () => {
    // The clip is real: an accordion is overflow: hidden, so a ring 1px
    // outside its head is cut on every side.
    expect(setting(DOG, 'overflow', /^hidden$/).some((x) => x.sel === '.dog-acc')).toBe(true)
    const inset = setting(DOG, 'outline-offset', /^-[1-9]\d*px$/)
    expect(inset.some((x) => x.sel === '.dog-acc-head:focus-visible'), 'the head\'s ring is outside its accordion, and cut').toBe(true)
  })
})

// V2: the page's three checkboxes ("Theme generator", "Use uploaded assets",
// "Use project assets") sat in the capitalised Label step beside the kit
// Switch's sentence-case "Full deck" on the same row. A checkbox's words are
// a control's label (Q2), so they take the Switch's step and ink. (The
// history dialog's own checkboxes were already sentence case, at Dense.)
describe('dog.css + DeckOutlineGenerator: the checkboxes\' words are sentence case (V2)', () => {
  const INDEX = read('../../index.css')
  it('the label is the kit Switch label\'s step and ink, with no capitals and no tracking', () => {
    const rule = allRules(DOG).find((r) => norm(r.sel) === '.dog-check-label')
    expect(rule, 'no .dog-check-label rule').toBeTruthy()
    const d = Object.fromEntries(decls(rule.body))
    expect(d['text-transform']).toBeUndefined()
    expect(d['letter-spacing']).toBeUndefined()
    expect(d['font-size']).toBe('var(--text-body)')
    expect(d.color).toBe('var(--color-ink)')
    // CONTROL: this is the kit Switch label's step and ink.
    expect(INDEX).toMatch(/\.ui-switch-label \{ font-size: var\(--text-body\);[^}]*color: var\(--color-ink\); \}/)
  })
  // DG1: "Use uploaded assets" read "Use visual assets" (Audrey's brief). DG4
  // (her notes 2 to 4, 2026-10-28): the Generate outline card keeps two,
  // "Place visual" (was "Use visual assets") and "Theme generator"; "Use
  // project assets" is gone; card 1 has "Core files only" (ReferencesCard).
  // A label may carry a hover (`title={…}`); its words are the checkbox's name.
  it('the words are written in sentence case, on the screen and to a screen reader alike', () => {
    const dog = read('./DeckOutlineGenerator.jsx')
    const card = read('./references/ReferencesCard.jsx')
    const label = (w) => new RegExp(`<span className="dog-check-label"(?: title=\\{[A-Z_]+\\})?>${w}</span>`)
    for (const [src, w] of [[dog, 'Place visual'], [dog, 'Theme generator'], [card, 'Core files only']]) {
      expect(src).toContain(`aria-label="${w}"`)
      expect(src).toMatch(label(w))
    }
    for (const src of [dog, card]) expect(src).not.toMatch(/className="dog-check-label"[^>]*>[^<]*\b[A-Z][a-z]* [A-Z]/)
    // The retired boxes are not drawn, and no flag of theirs is read.
    expect(dog).not.toMatch(/aria-label="Use (visual|project|uploaded) assets"|>Use (visual|project|uploaded) assets</)
    expect(`${dog}${card}${read('./references/useReferences.js')}`).not.toMatch(/\buse(Project|Uploaded)Assets\b/)
    // CONTROL: the scan would see the old box.
    expect('<span className="dog-check-label">Use project assets</span>').toMatch(/>Use (visual|project|uploaded) assets</)
  })

  // Review rounds one and two: Help quoted the controls by their old names.
  it('D.O.G.\'s Help and the Help page quote each control as the interface writes it', () => {
    const help = read('../../data/dogHelpContent.jsx')
    const page = read('../../components/HelpPage.jsx')
    // Review round two (R2-02) added the mode Switch, "Full deck". The Slides
    // extension's own "Full Deck" button is named unquoted, as it writes it.
    // DG4 retires "Use visual assets" and "Use project assets".
    const OLD = /"(Theme Generator|Use Uploaded Assets|Use Project Assets|Generate Image Prompts|Full Deck|Use visual assets|Use project assets)"/
    expect(help).not.toMatch(OLD)
    expect(page).not.toMatch(OLD)
    for (const q of ['"Theme generator"', '"Place visual"', '"Core files only"', '"Generate image prompts"', '"Full deck"', '"Single page"']) expect(help, q).toContain(q)
    for (const q of ['"Place visual"', '"Core files only"']) expect(page, q).toContain(q)
    for (const src of [help, page]) expect(src).not.toMatch(/Use (uploaded|visual|project) assets/i)
    // CONTROL: the export dialog's own label is the one Help quotes, and so
    // are the mode Switch's and the boxes'.
    expect(read('./modals/HistoryModal.jsx')).toContain("'Generate image prompts'")
    expect(read('./DeckOutlineGenerator.jsx')).toContain('aria-label="Full deck"')
    expect(read('./DeckOutlineGenerator.jsx')).toContain('aria-label="Place visual"')
    expect(read('./references/ReferencesCard.jsx')).toContain('aria-label="Core files only"')
    expect('Toggle "Full Deck" to generate').toMatch(OLD)
    expect('Enable "Use project assets" to let').toMatch(OLD)
  })
})

// =============================================================================
// DG4 (Audrey, 2026-10-28, note 1, verbatim): "the status bar for how many
// files have been added for reference is way too long in a wide monitor. so
// lets make it a fixes size the is about the length of the text lines above
// in the card. make the bar a little thicker too." Measured before, in
// Chromium: the track was the card's whole width (998px at 1280, 1158 at
// 1440, 2278 at 2560) and 6px tall; the contract line above it 571.28px.
// Card 1's column is 576px, the meter in it that fixed width, the track 8px
// in the card and the window alike; the window's footer meter keeps flex: 1.
//
// DG5 (Audrey, 2026-10-30, with a picture of card 1 at a 2,000px window):
// "the redesign has a bit too much negative space. the entire right side is
// an empty card". DG5 set the two cards side by side from a 1414 window and
// card 1 in two columns from 1974, the measure on the wrapper for both.
//
// DG6 (Audrey, 2026-10-31, verbatim, with a 2,000px-wide picture of DG5's two
// cards side by side): "this looks objectively bad. please do a pass to make
// it more appealing for the top two cards. leave the output card how it is
// dont touch it. i want to keep the 1 and 2 cards stacked not side by side".
// Measured stacked with nothing else done (Chromium, the dev fixtures): card
// 1's one column left 42, 50, 64 and 74 percent of the card empty across at
// 1280, 1440, 1920 and 2560, and card 2's box and Generate ran 988 to
// 2,268px. The design round's stack (dog.css, THE INPUTS STACK): .dog-main a
// named container with its scrollbar's gutter (both kept), the two cards in
// .dog-inputs, one under the other at every width, at one width for both,
// capped: 602 under W 1202, 1202 from W 1202 (a 1468 window), where card 1's
// body is two columns of the measure. DG4's pins hold on `--dog-measure`,
// declared once on the wrapper for both cards. Review round 1 (finding 1,
// MEASURED: six layout changes passed the first pins) made the layout one
// census: every layout declaration on the wrapper, the main column's
// children, the cards and their parts, pinned whole.
// =============================================================================
describe('dog.css: the inputs stack (DG6), with DG4\'s measure and meter in it', () => {
  const INDEX = read('../../index.css')
  const JSX = read('./DeckOutlineGenerator.jsx')
  const SPLIT = '@container dog-main (min-width: 1202px)'
  // The declarations of the rules for `sel` directly inside `parent` (an
  // at-rule's head) or, with no parent, inside no @container; the last wins.
  const decl = (css, sel, parent) => Object.fromEntries(allRules(css)
    .filter((r) => splitTop(r.sel).map(norm).includes(sel))
    .filter((r) => (parent ? norm(r.parents[r.parents.length - 1] || '') === parent : !r.parents.some((h) => /^@container/.test(h))))
    .flatMap((r) => decls(r.body)))
  const at = (r) => norm(r.parents[r.parents.length - 1] || '')
  // What lays a box out: its display, place, size, flow and the gaps in it.
  const LAYOUT = /^(display|position|float|order|inset|gap|row-gap|column-gap|columns|column-count|column-width|(min-|max-)?width|flex(-[a-z]+)?|grid(-[a-z]+)*|justify-[a-z]+|align-[a-z]+|place-[a-z]+)$/
  // The two cards and their parts, by their classes anywhere in a selector.
  const PARTS = /\.dog-(card|card-project|s2|card-body|refs|project-details|mode|checks|field-row|context-prompt|page-request|generate)(?![-\w])/
  const pins = (css) => ({
    container: decl(css, '.dog-main').container,
    padding: decl(css, '.dog-main').padding,
    main: decl(css, '.dog-main'),
    row: decl(css, '.dog-inputs'),
    cap: decl(css, '.dog-inputs', SPLIT),
    // Every container query in the sheet, by its head.
    queries: allRules(css).map((r) => norm(r.sel)).filter((h) => /^@container\b/.test(h)),
    split: decl(css, '.dog-card-project > .dog-card-body', SPLIT),
    level: decl(css, '.dog-card-project > .dog-card-body > .dog-refs', SPLIT)['margin-top'],
    // The layout census: every layout declaration of every rule whose
    // selector names the wrapper in any way, a child of the main column, or a
    // card or one of its parts, with the head of the block it sits in (so the
    // same rule under @media, or outside the query, is a new line).
    layout: allRules(css).flatMap((r) => splitTop(r.sel).map(norm)
      .filter((s) => /dog-inputs/.test(s) || /\.dog-main\s*>/.test(s) || PARTS.test(s))
      .flatMap((s) => decls(r.body).filter(([prop]) => LAYOUT.test(prop)).map(([prop, v]) => `${at(r)} ${s} { ${prop}: ${v} }`))),
    column: decl(css, '.dog-refs')['max-width'],
    details: decl(css, '.dog-card-project .dog-project-details')['max-width'],
    meter: decl(css, '.dog-refs .dog-refs-meter').width,
    track: decl(css, '.dog-refs-meter-track').height,
    foot: decl(css, '.dog-refs-foot .dog-refs-meter'),
    // Every declaration of a D.O.G. measure, anywhere in the sheet.
    measures: allRules(css).flatMap((r) => decls(r.body)
      .filter(([prop]) => /^--dog-(refs-)?measure$/.test(prop))
      .map(([prop, v]) => `${norm(r.sel)} { ${prop}: ${v} }`)),
  })
  const px = (v) => Number(/^(\d+(?:\.\d+)?)px$/.exec(v || '')?.[1])
  const minWidth = (head) => Number(/\(min-width: (\d+)px\)/.exec(head)?.[1])
  const L = '@layer components'
  // The census as DG6 leaves it: the wrapper and its one query, card 1's
  // two columns inside it, and the parts' own layouts as DG4 left them.
  const LAYOUT_NOW = [
    `${L} .dog-inputs { display: grid }`,
    `${L} .dog-inputs { grid-template-columns: 1fr }`,
    `${L} .dog-inputs { gap: 8px }`,
    `${L} .dog-inputs { max-width: 602px }`,
    `${SPLIT} .dog-inputs { max-width: 1202px }`,
    `${SPLIT} .dog-card-project > .dog-card-body { display: grid }`,
    `${SPLIT} .dog-card-project > .dog-card-body { grid-template-columns: var(--dog-measure) var(--dog-measure) }`,
    `${SPLIT} .dog-card-project > .dog-card-body { column-gap: 24px }`,
    `${SPLIT} .dog-card-project > .dog-card-body { align-items: start }`,
    `${L} .dog-field-row { display: flex }`,
    `${L} .dog-field-row { align-items: flex-start }`,
    `${L} .dog-field-row { gap: 16px }`,
    `${L} .dog-generate { width: 100% }`,
    `${L} .dog-card-project .dog-project-details { max-width: var(--dog-measure) }`,
    `${L} .dog-refs { max-width: var(--dog-measure) }`,
    `${L} .dog-refs .dog-refs-meter { width: var(--dog-measure) }`,
    `${L} .dog-refs .dog-refs-meter { max-width: 100% }`,
    `${L} .dog-mode { display: flex }`,
    `${L} .dog-mode { align-items: center }`,
    `${L} .dog-mode { gap: 8px }`,
    `${L} .dog-checks { display: flex }`,
    `${L} .dog-checks { flex-wrap: wrap }`,
    `${L} .dog-checks { align-items: center }`,
    `${L} .dog-checks { gap: 8px 24px }`,
  ]
  // DG5's row as it was merged (7de8d9d6), for the controls below.
  const DG5_ROW = `.dog-inputs {
    --dog-measure: 576px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    align-items: start;
  }
  @container dog-main (min-width: 1148px) {
    .dog-inputs { grid-template-columns: minmax(602px, 1fr) minmax(538px, 1fr); }
    .dog-s2 > .dog-card-body > * { max-width: var(--dog-measure); }
  }
  @container dog-main (min-width: 1708px) {
    .dog-inputs { grid-template-columns: 2fr 1fr; }
    .dog-card-project > .dog-card-body {
      display: grid;
      grid-template-columns: minmax(507px, var(--dog-measure)) var(--dog-measure);
      column-gap: 24px;
      align-items: start;
    }
    .dog-card-project > .dog-card-body > .dog-refs { margin-top: 0; }
  }`
  const STACK = /\.dog-inputs \{\s*--dog-measure[\s\S]*?\.dog-card-project > \.dog-card-body > \.dog-refs \{ margin-top: 0; \}\s*\}/

  it('the measure is one number, 576px, declared once, on the wrapper; card 1\'s column, its description and its meter keep to it', () => {
    const p = pins(DOG)
    expect(p.measures).toEqual(['.dog-inputs { --dog-measure: 576px }'])
    for (const v of [p.column, p.details, p.meter]) expect(v).toBe('var(--dog-measure)')
    expect(`${p.measures} ${p.meter}`).not.toMatch(/%|vw|fr\b/)
  })

  it('DG4\'s meter: the measure, a length and never a share of the card; the track 8px; the footer\'s meter still flexes', () => {
    const p = pins(DOG)
    expect(p.meter).toBe('var(--dog-measure)')
    expect(p.track).toBe('8px')
    expect(p.foot).toEqual({ flex: '1' })
  })

  it('the main column is a named inline-size container with C4\'s 8px padding and its scrollbar\'s gutter, and nothing else new; the wrapper is one grid column, the cards 8px apart, 602px at most', () => {
    const p = pins(DOG)
    expect(p.container).toBe('dog-main / inline-size')
    expect(p.padding).toBe('8px')
    // DG5 review round 1, finding 3: the container and nothing else new (a
    // grid here would hand its rows the scroll column's height). DG5's
    // follow-up, review round 1, finding 1: the scrollbar's gutter kept, or
    // a size query on this scroll column is answered before the scrollbar
    // takes its share (measured: the cards laid into a column 10px too
    // narrow, and a sideways scrollbar).
    expect(p.main).toEqual({ padding: '8px', 'background-color': 'var(--color-paper)', container: 'dog-main / inline-size', 'scrollbar-gutter': 'stable' })
    expect(p.row).toEqual({ '--dog-measure': '576px', display: 'grid', 'grid-template-columns': '1fr', gap: '8px', 'max-width': '602px' })
  })

  it('stacked at every width: one container query, from W 1202, that widens the cap and splits card 1\'s body, and every other layout as it was; nothing sets a card beside the other or gives a card or its parts a width of its own', () => {
    const p = pins(DOG)
    // Her words of 2026-10-31: "i want to keep the 1 and 2 cards stacked not
    // side by side". DG5's pair (W 1148) and triple (W 1708) are gone, not
    // left inert. Card 2's parts take its body's width (Generate's 100%).
    expect(p.queries).toEqual([SPLIT])
    expect(p.layout).toEqual(LAYOUT_NOW)
    expect(p.cap).toEqual({ 'max-width': '1202px' })
    expect(p.split).toEqual({ display: 'grid', 'grid-template-columns': 'var(--dog-measure) var(--dog-measure)', 'column-gap': '24px', 'align-items': 'start' })
    expect(p.level).toBe('0')
    expect(DOG).not.toMatch(/min-width: (1148|1708)px/)
  })

  it('the widths are the measure\'s arithmetic: 602 one column, 1202 two, and the split where the column holds 1202 (a 1468 window); the project row fills its column', () => {
    const p = pins(DOG)
    const measure = px(p.row['--dog-measure'])
    const pad = px(decl(DOG, '.dog-card-body').padding)
    const border = px(/^(\d+px) solid/.exec(decl(INDEX, '.ui-card').border || '')?.[1])
    const seam = px(p.row.gap)
    const gutter = px(p.split['column-gap'])
    expect([measure, pad, border, seam, gutter]).toEqual([576, 12, 1, 8, 24])
    const card = (body) => body + 2 * pad + 2 * border
    // One column: the card at the measure. Two: the measure twice, the gutter
    // between. The cap is the card, and the query starts where the column
    // holds the two-column card, so neither band has an empty card or a
    // squeezed one.
    expect(px(p.row['max-width'])).toBe(card(measure))
    expect(card(measure)).toBe(602)
    expect(px(p.cap['max-width'])).toBe(card(measure + gutter + measure))
    expect(minWidth(SPLIT)).toBe(px(p.cap['max-width']))
    expect(minWidth(SPLIT)).toBe(1202)
    // W: the window less the 240px sidebar, this column's padding and the
    // 10px gutter Chromium keeps for its scrollbar. 1280 and 1440 windows
    // hold one column; 1468 and wider, two. (Electron 33 drew an 11px
    // scrollbar where DG5 measured it, so a 1469 window there by this
    // arithmetic; DG6 did not measure Electron.)
    const app = (window) => window - 240 - 2 * px(p.padding) - 10
    expect(app(1468)).toBe(minWidth(SPLIT))
    for (const w of [1280, 1366, 1440, 1467]) expect(app(w)).toBeLessThan(minWidth(SPLIT))
    for (const w of [1920, 2560, 3440]) expect(app(w)).toBeGreaterThanOrEqual(minWidth(SPLIT))
    // DG6 review round 1, finding 4: the dropdown takes the row beside New
    // project, so the row ends at the column's edge (no inline cap: it was
    // 360px, which left the row 69px short of the column and, with no
    // project chosen, a 93px hole before the references in two columns).
    expect(JSX).toMatch(/<div className="flex items-center gap-2">\s*<div className="relative flex-1">\s*<select\s+id="dog-project"/)
    expect(JSX).not.toMatch(/maxWidth: '360px'/)
  })

  it('CONTROL: the sheet as DG5 left it (the pair, card 2\'s cap, the triple) fails every DG6 pin', () => {
    expect(DOG).toMatch(STACK)
    const before = DOG.replace(STACK, DG5_ROW)
    expect(before).not.toBe(DOG)
    const p = pins(before)
    expect(p.queries).toEqual(['@container dog-main (min-width: 1148px)', '@container dog-main (min-width: 1708px)'])
    expect(p.layout).not.toEqual(LAYOUT_NOW)
    expect(p.layout).toContain('@container dog-main (min-width: 1148px) .dog-inputs { grid-template-columns: minmax(602px, 1fr) minmax(538px, 1fr) }')
    expect(p.layout).toContain('@container dog-main (min-width: 1148px) .dog-s2 > .dog-card-body > * { max-width: var(--dog-measure) }')
    expect(p.row).not.toHaveProperty('max-width')
    expect(p.cap).toEqual({})
    expect(p.split).toEqual({})
    expect(p.level).toBeUndefined()
  })

  it('CONTROL: a cap that is a share or off its arithmetic, a third width, and every way review round 1 found to lay the cards out unseen, are each caught', () => {
    const swap = (from, to) => { const s = DOG.replace(from, to); expect(s).not.toBe(DOG); return pins(s) }
    // The cap a share of the column, and the cap off the two-column card.
    expect(swap('max-width: 602px;', 'max-width: 50%;').row['max-width']).toBe('50%')
    const off = swap('.dog-inputs { max-width: 1202px; }', '.dog-inputs { max-width: 1200px; }')
    expect(px(off.cap['max-width'])).not.toBe(minWidth(SPLIT))
    // A third width: the triple back.
    const third = swap('/* Two columns of the measure', '}\n  @container dog-main (min-width: 1708px) { .dog-inputs { grid-template-columns: 2fr 1fr; } }\n  @container dog-main (min-width: 1202px) {\n    /* Two columns of the measure')
    expect(third.queries).not.toEqual([SPLIT])
    expect(third.layout).not.toEqual(LAYOUT_NOW)
    // Each added at the sheet's top level, and each must change the census:
    // the wrapper laid out by a descendant, a :has(), its children or an
    // attribute (H4); the main column's second child (H5); a card placed,
    // sized or floated by a rule of its own; card 1 split outside the query
    // (H1) or under @media (H2); card 2's box and Generate capped by their
    // own classes (H3); the references' column given a width (H6); card 2's
    // parts capped as DG5 had them.
    const ANCHOR = '.dog-main > * + * { margin-top: 8px; }'
    for (const plant of [
      '.dog-main .dog-inputs { display: flex; }',
      '.dog-inputs:has(.dog-s2) { grid-auto-flow: column; }',
      '.dog-inputs > * { grid-template-columns: inherit; }',
      '[class~=\'dog-inputs\'] { display: flex; }',
      '.dog-main > div:nth-child(2) { display: flex; max-width: none; }',
      '.dog-card.dog-s2 { grid-column: 2; }',
      '.dog-inputs > .dog-card-project { width: 50%; }',
      '.dog-s2[data-full-deck=\'true\'] { float: right; }',
      '.dog-card-project > .dog-card-body { display: grid; grid-template-columns: 1fr 1fr; }',
      '@media (min-width: 1300px) { .dog-card-project > .dog-card-body { display: grid; grid-template-columns: 1fr 1fr; } }',
      '.dog-context-prompt, .dog-generate { max-width: var(--dog-measure); }',
      '.dog-refs { width: 400px; }',
      '.dog-s2 > .dog-card-body > * { max-width: var(--dog-measure); }',
    ]) expect(swap(ANCHOR, `${ANCHOR}\n  ${plant}`).layout, plant).not.toEqual(LAYOUT_NOW)
  })

  it('CONTROL: a meter that is a share of the card, a 6px track, or a second measure fails the pins', () => {
    const bad = DOG
      .replace('.dog-refs .dog-refs-meter { width: var(--dog-measure); max-width: 100%; }', '.dog-refs .dog-refs-meter { width: 100%; }')
      .replace(/(\.dog-refs-meter-track \{[^}]*?height: )8px/, '$16px')
      .replace('.dog-refs > * + * { margin-top: 16px; }', '.dog-refs > * + * { margin-top: 16px; }\n  .dog-s2 { --dog-measure: 600px; }')
    expect(bad).not.toBe(DOG)
    const p = pins(bad)
    expect(p.meter).toBe('100%')
    expect(p.track).toBe('6px')
    expect(p.measures).toHaveLength(2)
  })
})

// P1-50: D.O.G.'s two native selects with an empty first option ("No project
// selected", "Select layout...") read as placeholders, one way: every
// `.dog-select` says when it is empty, and one rule gives that state the
// placeholder ink.
describe('D.O.G.\'s empty selects are drawn one way (P1-50)', () => {
  const jsx = read('./DeckOutlineGenerator.jsx')
  // Each `<select …>` opening tag, read to the `>` outside any `{…}` (its
  // props hold arrows, whose `>` a lazy regex would stop at).
  const selectTags = (src) => {
    const out = []
    for (let at = src.indexOf('<select'); at >= 0; at = src.indexOf('<select', at + 1)) {
      let depth = 0
      for (let i = at; i < src.length; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}') depth--
        else if (src[i] === '>' && depth === 0) { out.push(src.slice(at, i + 1)); break }
      }
    }
    return out
  }
  const selectsWithoutEmpty = (src) => selectTags(src)
    .filter((tag) => /\bdog-select\b/.test(tag) && !/\bdata-empty=\{/.test(tag))
  it('every .dog-select carries data-empty, and the placeholder ink is the class\'s, not the project select\'s alone', () => {
    expect(selectTags(jsx).filter((t) => /\bdog-select\b/.test(t)).length).toBe(2)
    expect(selectsWithoutEmpty(jsx)).toEqual([])
    const rule = allRules(DOG).find((r) => splitTop(r.sel).includes(".dog-select[data-empty='true']"))
    expect(rule, 'no .dog-select empty rule').toBeTruthy()
    expect(decls(rule.body)).toContainEqual(['color', 'var(--color-ink-3)'])
    expect(allRules(DOG).some((r) => splitTop(r.sel).includes(".dog-project-select[data-empty='true']"))).toBe(false)
  })
  it('CONTROL: the layout select as it was is caught', () => {
    const was = '<select\n  value={selectedLayout}\n  className="ui-input dog-select" data-size="md" data-surface="dark"\n>'
    expect(selectsWithoutEmpty(was)).toHaveLength(1)
  })
})

// ── The "Deck outline" bar (post-overhaul S2a; Audrey's C1 and C7) ─────────
// The sidebar Panel's header, lifted out to run the page's full width at the
// tab strips' height, so D.O.G.'s gear sits where O.T.T.E.R.'s and
// R.A.B.B.I.T.'s do. scripts/tool-strip-probe.mjs measures the one x and y in
// the app, and scripts/dog-preview-probe.mjs --check the preview box (C4).
// What a source scan can hold: the bar's box is R.A.B.B.I.T.'s strip's box,
// its right-hand group is R.A.B.B.I.T.'s rule for rule, it sits ABOVE the
// sidebar-and-main row (inside it, it would be horizontal chrome and narrow
// the preview), and the Panel draws no header of its own.
describe('D.O.G.\'s "Deck outline" bar is a tab strip\'s bar, above both columns (S2a)', () => {
  const RABBIT = read('../rabbit_v0.1.0/rabbitShell.css')
  const INDEX = read('../../index.css')
  // EVERY rule for the selector, merged in source order (the later wins), so
  // a second `.dog-outline-bar { height: 44px }` further down cannot hide
  // behind the first (S2a review round 1, G-R1-07). Rules inside a media or
  // container query are left out: they are states, read on their own.
  const declsOf = (css, sel) => {
    const rules = allRules(css).filter((x) => splitTop(x.sel).map(norm).includes(sel)
      && !x.parents.some((p) => /^@(media|container|supports)/.test(p)))
    return rules.length ? Object.fromEntries(rules.flatMap((r) => decls(r.body))) : null
  }
  it('its box is the strips\' box: 36px + the hairline, the gutter on the right, 16px on the left, on paper', () => {
    const d = declsOf(DOG, '.dog-outline-bar')
    expect(d, 'no .dog-outline-bar rule').toBeTruthy()
    // NOT the kit Toolbar's 44: the tab strips are the kit tab's 36 + 1.
    expect(d.height).toBe('calc(var(--control-md) + 1px)')
    expect(INDEX).toMatch(/\.ui-tab \{[^}]*height: var\(--control-md\);/)
    // R.A.B.B.I.T.'s strip is the reference, property by property.
    const rb = declsOf(RABBIT, '.rb-viewtabs')
    for (const p of ['padding', 'border-bottom', 'background-color']) expect(d[p], p).toBe(rb[p])
    expect(rb.padding).toBe('0 var(--spacing-gutter) 0 calc(var(--spacing-gutter) - 8px)')
  })
  it('its right-hand group is R.A.B.B.I.T.\'s `.rb-viewtabs-right`, rule for rule', () => {
    const dog = declsOf(DOG, '.dog-outline-right')
    expect(dog, 'no .dog-outline-right rule').toBeTruthy()
    expect(dog).toEqual(declsOf(RABBIT, '.rb-viewtabs-right'))
  })
  it('its leading label is the Label step, its text on the 24px gutter (a tab\'s 8px side padding)', () => {
    expect(declsOf(DOG, '.dog-outline-label')).toEqual({ padding: '0 8px' })
    expect(declsOf(DOG, '.dog-toolbar-label')['font-size']).toBe('var(--text-label)')
  })

  // The JSX: where the bar sits, and what the Panel still carries.
  const barProblems = (src) => {
    const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
    const cls = (el) => {
      const a = el?.openingElement?.attributes.find((x) => x.type === 'JSXAttribute' && x.name.name === 'className')
      return a?.value?.type === 'StringLiteral' ? a.value.value.split(/\s+/) : []
    }
    const out = []
    let bar = null
    let panel = null
    traverse(ast, {
      JSXElement(p) {
        if (cls(p.node).includes('dog-outline-bar')) bar = p
        if (p.node.openingElement.name.name === 'Panel' && cls(p.node).includes('dog-sidebar')) panel = p
      },
    })
    if (!bar) return ['no .dog-outline-bar element']
    const parent = bar.findParent((q) => q.isJSXElement())
    if (!cls(parent?.node).includes('dog-root')) out.push(`the bar sits in .${cls(parent?.node).join('.') || '?'}, not directly in .dog-root`)
    // The next element after the bar is the row that holds the Panel.
    const siblings = parent.node.children.filter((c) => c.type === 'JSXElement')
    const row = siblings[siblings.indexOf(bar.node) + 1]
    if (!row || !panel || panel.findParent((q) => q.isJSXElement())?.node !== row) out.push('the sidebar-and-main row does not follow the bar')
    if (panel) {
      for (const prop of ['title', 'actions']) {
        if (panel.node.openingElement.attributes.some((a) => a.type === 'JSXAttribute' && a.name.name === prop)) out.push(`the Panel still takes ${prop}`)
      }
    } else out.push('no dog-sidebar Panel')
    return out
  }
  it('sits directly in the page, above the sidebar-and-main row, and the Panel has no header of its own', () => {
    expect(barProblems(read('./DeckOutlineGenerator.jsx'))).toEqual([])
  })
  it('CONTROL: the merged reader sees a later rule that overrides the first', () => {
    const twice = '.dog-outline-bar { height: calc(var(--control-md) + 1px); } .x {} .dog-outline-bar { height: 44px; }'
    expect(declsOf(twice, '.dog-outline-bar').height).toBe('44px')
  })
  it('CONTROL: a bar inside the row, and a Panel that keeps its title, are each caught', () => {
    const inRow = `const x = <div className="dog-root h-full"><div className="flex-1 flex min-h-0">
      <div className="dog-outline-bar" /><Panel width="md" className="dog-sidebar" /></div></div>`
    expect(barProblems(inRow)).toEqual(expect.arrayContaining(['the bar sits in .flex-1.flex.min-h-0, not directly in .dog-root']))
    const titled = `const x = <div className="dog-root h-full"><div className="dog-outline-bar" /><div className="flex-1 flex min-h-0">
      <Panel width="md" className="dog-sidebar" title="Deck outline" actions={<i />} /></div></div>`
    expect(barProblems(titled)).toEqual(['the Panel still takes title', 'the Panel still takes actions'])
    const fine = titled.replace(' title="Deck outline" actions={<i />}', '')
    expect(barProblems(fine)).toEqual([])
  })
})

// ── The orange D.O.G. takes back, exactly (S2a; Audrey's C3 and C8) ─────────
// The two numbered section titles and their numerals are the signal as an
// INK (4.54:1 on the card's paper-raised); on the header's hover wash the
// signal is 3.88:1, so there the text reverts to the ink (option c) and no
// orange ever sits on the wash (tokens.test.js holds both numbers). Section 2
// disabled in Full deck mode stays the third ink. Recorded as her exception
// in UI_OVERHAUL_PLAN.md §3.2: these guards are what stops a later session
// "correcting" it — or spreading it.
describe('D.O.G.\'s orange, exactly: the two section titles and their numerals (S2a, C3/C8)', () => {
  const THEME = themeValues(read('../../index.css'))
  const ORANGES = new Set([THEME.get('--color-signal'), THEME.get('--color-signal-fill')].map((h) => h.toLowerCase()))
  const winner = (a, b) => compareSpecificity(specificity(a), specificity(b))
  // Every rule whose glyph ink resolves, through @theme, to either orange —
  // in any spelling: the token, another token with the same hex
  // (`--color-focus` is #ea580c too), `-webkit-text-fill-color`, `fill` —
  // plus any custom property the sheet sets to an orange, which would recolour
  // everything that reads it (S2a review round 1, G-R1-04).
  // (round 2, G-R2-03: any token named anywhere in the value — a fallback,
  // a mix, a shadow's colour — counts, not only a value that IS one token)
  const orangeInks = (css) => allRules(css).flatMap((r) => decls(r.body)
    .filter(([p, v]) => (INK_PROPS.test(p) || p.startsWith('--')) && mentionsTokenHex(v, THEME, ORANGES))
    .flatMap(([p]) => splitTop(r.sel).map((s) => `${norm(s)} { ${p} }`))).sort()
  it('the orange paints exactly these: the two new rules, and two icons from before S2a — in every spelling', () => {
    expect(orangeInks(DOG)).toEqual([
      '.dog-lock-icon { color }', '.dog-resolver-selected > svg { color }',
      '.dog-step-title .dog-step { color }', '.ui-panel-title.dog-card-title.dog-step-title { color }',
    ].sort())
  })
  it('CONTROL: the reader resolves each spelling that beat the first cut', () => {
    for (const planted of [
      '.ui-panel-title.dog-card-title { color: var(--color-focus); }',
      '.dog-output { --color-ink-2: var(--color-signal); }',
      '.dog-card-title { -webkit-text-fill-color: var(--color-signal); }',
      '.dog-chevron { fill: var(--color-signal-fill); }',
      '.dog-card-title { color: var(--dog-title-ink, var(--color-signal)); }',
      '.dog-card-title { color: transparent; text-shadow: 0 0 0 var(--color-signal); }',
      '.dog-card-title { -webkit-text-stroke: 1px var(--color-signal); }',
      '.dog-card-title { color: color-mix(in srgb, var(--color-signal) 90%, transparent); }',
    ]) expect(orangeInks(planted), planted).toHaveLength(1)
    // …and not on what is not an orange.
    expect(orangeInks('.a { color: var(--color-ink); border-color: var(--color-signal); background: var(--color-signal-tint); }')).toEqual([])
  })
  it('no rule in dog.css uses !important — it would beat every specificity comparison below (G-R1-03)', () => {
    expect(DOG.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/!\s*important/i)
  })
  it('the orange outranks the second ink; the ink outranks the orange on the wash; the disabled third ink outranks the orange — by specificity, not order', () => {
    const on = (sel) => setting(DOG, 'color', /./).find((x) => x.sel === sel)
    const orangeTitle = '.ui-panel-title.dog-card-title.dog-step-title'
    const greyTitle = '.ui-panel-title.dog-card-title'
    const hoverTitle = ".dog-card-head[data-collapsible='true']:hover .dog-step-title"
    const hoverStep = ".dog-card-head[data-collapsible='true']:hover .dog-step"
    const disabled = ".dog-s2[data-full-deck='true'] .dog-card-head :is(.dog-card-title, .dog-step, .dog-chevron)"
    for (const s of [orangeTitle, greyTitle, hoverTitle, hoverStep, disabled, '.dog-step', '.dog-step-title .dog-step']) expect(on(s), s).toBeTruthy()
    expect(winner(orangeTitle, greyTitle)).toBeGreaterThan(0)
    expect(winner('.dog-step-title .dog-step', '.dog-step')).toBeGreaterThan(0)
    expect(winner(hoverTitle, orangeTitle)).toBeGreaterThan(0)
    expect(winner(hoverStep, '.dog-step-title .dog-step')).toBeGreaterThan(0)
    expect(winner(disabled, orangeTitle)).toBeGreaterThan(0)
    expect(winner(disabled, '.dog-step-title .dog-step')).toBeGreaterThan(0)
    // …and each says what it is for: the values, not only the selectors.
    expect(on(disabled).sel).toBe(disabled)
    const value = (sel) => decls(allRules(DOG).find((r) => splitTop(r.sel).map(norm).includes(sel)).body).find(([p]) => p === 'color')[1]
    expect(value(disabled)).toBe('var(--color-ink-3)')
    expect(value(greyTitle)).toBe('var(--color-ink-2)')
    expect(value(hoverTitle)).toBe('var(--color-ink)')
    expect(value(hoverStep)).toBe('var(--color-ink)')
  })
  it('selected, the orange is the ink — the title and every descendant, only while it IS orange (V-R1-02, V-R2-02, V-R2-03)', () => {
    const reverts = setting(DOG, 'color', /^var\(--color-ink\)$/).map((x) => x.sel).filter((s) => s.includes('::selection'))
    expect(reverts.sort()).toEqual([
      ".dog-card:not([data-full-deck='true']) .dog-step-title *::selection",
      ".dog-card:not([data-full-deck='true']) .dog-step-title::selection",
    ])
  })
  it('the revert is the ink, in the wash\'s own media query and on the wash\'s own state', () => {
    const wash = setting(DOG, 'background-color', /^var\(--color-hover\)$/).find((x) => x.sel === ".dog-card-head[data-collapsible='true']:hover")
    expect(wash, 'the wash rule moved').toBeTruthy()
    for (const sel of [".dog-card-head[data-collapsible='true']:hover .dog-step-title", ".dog-card-head[data-collapsible='true']:hover .dog-step"]) {
      const hit = setting(DOG, 'color', /^var\(--color-ink\)$/).find((x) => x.sel === sel)
      expect(hit, `no ink revert: ${sel}`).toBeTruthy()
      expect(hit.parents).toEqual(wash.parents)
    }
  })
  it('the numeral keeps its ring, and only the two numbered titles are step titles ("Generated output" is not)', () => {
    const step = allRules(DOG).find((r) => norm(r.sel) === '.dog-step')
    expect(Object.fromEntries(decls(step.body)).border).toBe('1px solid var(--color-rule)')
    // No other rule that reaches the numeral touches its ring (G-R1-03: an
    // orange `border-color` on `.dog-step-title .dog-step` passed the first cut).
    const ringRules = allRules(DOG).flatMap((r) => splitTop(r.sel).map(norm)
      .filter((s) => /\.dog-step(?![\w-])(::?[\w-]+)?$/.test(s) && decls(r.body).some(([p]) => /^border/.test(p))))
    expect(ringRules).toEqual(['.dog-step'])
    const jsx = read('./DeckOutlineGenerator.jsx')
    const titles = [...jsx.matchAll(/<h2 className="([^"]*\bdog-card-title\b[^"]*)">([\s\S]*?)<\/h2>/g)]
    expect(titles).toHaveLength(3)
    for (const [, cls, body] of titles) {
      const numbered = /className="dog-step"/.test(body)
      expect(cls.split(' ').includes('dog-step-title'), body.trim().slice(0, 40)).toBe(numbered)
    }
    expect(titles.filter(([, cls]) => cls.includes('dog-step-title'))).toHaveLength(2)
  })
  it('CONTROL: an orange spread to "Generated output", or a revert that ties, is caught', () => {
    // A title rule that ties the second ink would win only by coming later.
    expect(winner('.dog-card-title.dog-step-title', '.ui-panel-title.dog-card-title')).toBe(0)
    // The disabled rule as it was (three classes) ties the orange.
    expect(winner(".dog-s2[data-full-deck='true'] :is(.dog-card-title, .dog-step, .dog-chevron)", '.ui-panel-title.dog-card-title.dog-step-title')).toBe(0)
    const spread = '<h2 className="ui-panel-title dog-card-title dog-step-title">Generated output</h2>'
    const [, cls, body] = spread.match(/<h2 className="([^"]*\bdog-card-title\b[^"]*)">([\s\S]*?)<\/h2>/)
    expect(cls.split(' ').includes('dog-step-title')).not.toBe(/className="dog-step"/.test(body))
  })
})
