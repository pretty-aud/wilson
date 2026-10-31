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
// card 1 in two columns from 1974, the measure on a wrapper for both.
//
// DG6 (Audrey, 2026-10-31, verbatim: "i want to keep the 1 and 2 cards
// stacked not side by side") stacked them at one capped width, card 1 in two
// columns from a 1468 window; her walkthrough 90 answers (Q1 "One column
// always", Q2 "Full card width") took the two columns out. Then, with a
// picture of the beta (verbatim in dog.css, CARD 1's SECTIONS): no open space
// to the right of the cards; the project, then the references with Add
// references, then the uploads; a title for each function; and, on the
// design round's sketch, "remove the dividing lines. the titles themselves
// are enough to separate", each title's text and buttons below it. So the two
// cards fill the column (no cap, no wrapper, no container, no query), and
// card 1 is titled sections 32px apart, twice the 16 between a section's
// parts; text and single controls keep DG4's 576px measure, and the lists of
// rows run in shelves of 416px or more. Review round 1 (finding 1, MEASURED:
// six layout changes passed the first pins) made the layout one census:
// every layout declaration on the main column's children, the cards and
// their parts, pinned whole. Review round 2 (finding 1, MEASURED: 17 more
// changes passed) added the cards' bodies by their ids, the project dropdown
// by its classes and the logical size properties, and pins the dropdown's
// and the cards' markup whole. What a source pin still cannot see (round 2's
// list, recorded in the hand-off): padding, transforms and zoom on these
// boxes; paths to the main column's children other than `.dog-main >`;
// another sheet reaching them. The pictures and the probe are the check on
// those.
// =============================================================================
describe('dog.css: card 1\'s sections (DG6\'s follow-up), with DG4\'s measure and meter in them', () => {
  const INDEX = read('../../index.css')
  const JSX = read('./DeckOutlineGenerator.jsx')
  const REFS = read('./references/ReferencesCard.jsx')
  // The declarations of the rules for `sel` directly inside `parent` (an
  // at-rule's head) or, with no parent, inside no @container; the last wins.
  const decl = (css, sel, parent) => Object.fromEntries(allRules(css)
    .filter((r) => splitTop(r.sel).map(norm).includes(sel))
    .filter((r) => (parent ? norm(r.parents[r.parents.length - 1] || '') === parent : !r.parents.some((h) => /^@container/.test(h))))
    .flatMap((r) => decls(r.body)))
  const at = (r) => norm(r.parents[r.parents.length - 1] || '')
  // What lays a box out: its display, place, size (and its logical names),
  // flow and the gaps in it.
  const LAYOUT = /^(display|position|float|order|inset|gap|row-gap|column-gap|columns|column-count|column-width|(min-|max-)?(width|inline-size|block-size)|flex(-[a-z]+)?|grid(-[a-z]+)*|justify-[a-z]+|align-[a-z]+|place-[a-z]+)$/
  // The two cards and their parts (card 1's sections, the project pair, the
  // shelves of rows), by their classes or ids anywhere in a selector.
  const PARTS = /\.dog-(card|card-project|s2|card-body|refs|project-details|mode|checks|field-row|context-prompt|page-request|generate|project-select|select|sec|sec-[a-z]+|project-pair|project-field|refs-rows|refs-uploads)(?![-\w])|#dog-(card1-body|card3-body|project)(?![-\w])/
  // What can reach inside card 1's body (DG6's follow-up, review round 1,
  // finding 4: lines, gaps and the titles' look were read only by the
  // selectors that drew them first): the body by its id, the card, its
  // sections, the references' part and its pieces, the project's parts, and
  // any h3. A line, a gap or a title's look under any of these is read.
  // Review round 2 (finding 2, MEASURED: a rule on the card's body, a note,
  // and an attribute selector passed) added the cards' body class, the notes
  // and any class written as an attribute; (finding 8) a selector naming
  // another card, a dialog or the Add references window is not card 1's.
  const REACH = /\.dog-sec(?![\w])|\.dog-refs(?![-\w])|\.dog-refs-(uploads|contract|group|group-label|rows|actions|core-said|notice)(?![-\w])|#dog-card1-body|\.dog-card-project|\.dog-card-body|\.dog-details-note|\.dog-project-(pair|field|details)(?![-\w])|\[class[~*^$|]?=|(^|[\s>+~(,])h3(?![-\w])/
  const OTHER = /\.dog-(output|s2)(?![-\w])|dialog|\.dog-refs-(layout|rail|pick|foot|preview|search)/
  const reach = (css, re) => allRules(css).flatMap((r) => splitTop(r.sel).map(norm).filter((sel) => REACH.test(sel) && !OTHER.test(sel))
    .flatMap((sel) => decls(r.body).filter(([prop]) => re.test(prop)).map(([prop, v]) => `${at(r)} ${sel} { ${prop}: ${v} }`)))
  // An element's opening tag in the JSX, from `start`, braces skipped (an
  // arrow's `>` is inside one): P1-50's reader below, for one tag.
  const openTag = (src, start) => {
    let depth = 0
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      else if (src[i] === '>' && depth === 0) return src.slice(start, i + 1)
    }
    return ''
  }
  const tagOf = (src, marker) => { const at = src.indexOf(marker); return at < 0 ? '' : openTag(src, src.lastIndexOf('<', at)) }
  const pins = (css) => ({
    padding: decl(css, '.dog-main').padding,
    main: decl(css, '.dog-main'),
    // Every container query in the sheet, by its head, and every
    // declaration that makes a box a container.
    queries: allRules(css).map((r) => norm(r.sel)).filter((h) => /^@container\b/.test(h)),
    containers: allRules(css).flatMap((r) => decls(r.body).filter(([prop]) => /^container(-type|-name)?$/.test(prop)).map(([prop, v]) => `${norm(r.sel)} { ${prop}: ${v} }`)),
    // Any rule that names the wrapper DG5 and DG6 had round the cards.
    wrapper: allRules(css).filter((r) => /dog-inputs/.test(r.sel)).map((r) => norm(r.sel)),
    // The layout census: every layout declaration of every rule whose
    // selector names a child of the main column, or a card or one of its
    // parts, with the head of the block it sits in (so the same rule under
    // @media, or under a query, is a new line).
    layout: allRules(css).flatMap((r) => splitTop(r.sel).map(norm)
      .filter((s) => /dog-inputs/.test(s) || /\.dog-main\s*>/.test(s) || PARTS.test(s))
      .flatMap((s) => decls(r.body).filter(([prop]) => LAYOUT.test(prop)).map(([prop, v]) => `${at(r)} ${s} { ${prop}: ${v} }`))),
    // Every line that can be drawn inside card 1's body (her "remove the
    // dividing lines"), every gap set there, and every type rule there.
    lines: reach(css, /^(border(?!-radius)|outline|box-shadow|background|text-decoration)/),
    spacing: reach(css, /^(margin|padding)/),
    type: reach(css, /^(font|line-height|color|letter-spacing|text-transform)/),
    // The spacing that divides the sections, and the title's look.
    between: [decl(css, '.dog-card-project > .dog-card-body > * + *')['margin-top'], decl(css, '.dog-refs > .dog-sec + .dog-sec')['margin-top']],
    within: decl(css, '.dog-sec > * + *')['margin-top'],
    title: decl(css, '.dog-sec-title'),
    measure: decl(css, '.dog-card-project')['--dog-measure'],
    meter: decl(css, '.dog-refs .dog-refs-meter').width,
    track: decl(css, '.dog-refs-meter-track').height,
    foot: decl(css, '.dog-refs-foot .dog-refs-meter'),
    // Every declaration of a D.O.G. measure, anywhere in the sheet.
    measures: allRules(css).flatMap((r) => decls(r.body)
      .filter(([prop]) => /^--dog-(refs-)?measure$/.test(prop))
      .map(([prop, v]) => `${norm(r.sel)} { ${prop}: ${v} }`)),
  })
  const px = (v) => Number(/^(\d+(?:\.\d+)?)px$/.exec(v || '')?.[1])
  const L = '@layer components'
  const SHELF = 'repeat(auto-fill, minmax(min(100%, 416px), 1fr))'
  // The census as DG6's follow-up leaves it: card 1's sections (the
  // project pair, the shelves), and the parts' own layouts as DG4 left them.
  const LAYOUT_NOW = [
    `${L} .dog-sec-desc { max-width: var(--dog-measure) }`,
    `${L} .dog-project-pair { display: flex }`,
    `${L} .dog-project-pair { flex-wrap: wrap }`,
    `${L} .dog-project-pair { align-items: flex-start }`,
    `${L} .dog-project-pair { gap: 8px 24px }`,
    `${L} .dog-project-field { flex: 0 1 var(--dog-measure) }`,
    `${L} .dog-project-field { min-width: 0 }`,
    `${L} .dog-card-project .dog-project-details { flex: 0 1 var(--dog-measure) }`,
    `${L} .dog-card-project .dog-project-details { min-width: 0 }`,
    `${L} .dog-card-project .dog-refs-rows { display: grid }`,
    `${L} .dog-card-project .dog-refs-rows { grid-template-columns: ${SHELF} }`,
    `${L} .dog-card-project .dog-refs-rows { column-gap: 32px }`,
    `${L} .dog-card-project .dog-refs-row { flex-wrap: wrap }`,
    `${L} .dog-card-project .dog-refs-row { row-gap: 0 }`,
    `${L} .dog-card-project .dog-refs-row { align-content: flex-start }`,
    `${L} .dog-card-project .dog-refs-row > :is(.dog-refs-warn, .dog-refs-gone, .dog-refs-sub) { order: 1 }`,
    `${L} .dog-card-project .dog-refs-row > :is(.dog-refs-warn, .dog-refs-gone, .dog-refs-sub) { flex-basis: 100% }`,
    `${L} .dog-field-row { display: flex }`,
    `${L} .dog-field-row { align-items: flex-start }`,
    `${L} .dog-field-row { gap: 16px }`,
    `${L} .dog-generate { width: 100% }`,
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
  // The one line inside card 1's body is the chosen project's description
  // box (the rows' own hairlines are the rows', not a section's); every gap
  // and the titles' look, as built.
  const LINES_NOW = [
    `${L} .dog-project-details { background-color: var(--color-paper-recessed) }`,
    `${L} .dog-project-details { border: 1px solid var(--color-rule) }`,
  ]
  const SPACING_NOW = [
    `${L} .dog-card-project > .dog-card-body > * + * { margin-top: 32px }`,
    `${L} .dog-refs > .dog-sec + .dog-sec { margin-top: 32px }`,
    `${L} .dog-sec > * + * { margin-top: 16px }`,
    `${L} .dog-sec-title { margin: 0 }`,
    `${L} .dog-sec > .dog-sec-title + * { margin-top: 8px }`,
    `${L} .dog-sec > .dog-sec-title + .dog-sec-desc { margin-top: 4px }`,
    `${L} .dog-sec > .dog-sec-desc + * { margin-top: 12px }`,
    `${L} .dog-card-project .dog-project-details { margin-top: 0 }`,
    // The tiles' status line starts under the name: the glyph and the gap in
    // (review round 2, finding 9: it was a bare 22px).
    `${L} .dog-card-project .dog-refs-row > :is(.dog-refs-warn, .dog-refs-gone, .dog-refs-sub) { padding: 0 0 8px calc(var(--icon-sm) + 8px) }`,
    `${L} .dog-sec > .dog-refs-core-said { margin-top: 8px }`,
    `${L} .dog-refs-uploads > .dog-refs-rows + .dog-upload { margin-top: 8px }`,
    `${L} .dog-refs-uploads > .dog-refs-upload-error { margin-top: 8px }`,
    `${L} .dog-sec-foot > .dog-refs-meter { margin-top: 8px }`,
    `${L} .dog-card-body { padding: 12px }`,
    `${L} .dog-card-body > * + * { margin-top: 16px }`,
    `${L} .dog-project-details { margin-top: 8px }`,
    `${L} .dog-project-details { padding: 8px 12px }`,
    `${L} .dog-details-note { margin-bottom: 8px }`,
    `${L} .dog-refs-notice { margin-bottom: 0 }`,
    `${L} .dog-refs-group-label { margin-bottom: 4px }`,
    `${L} .dog-refs-rows { margin: 0 }`,
    `${L} .dog-refs-rows { padding: 0 }`,
  ]
  const TYPE_NOW = [
    `${L} .dog-sec-title { font-size: var(--text-h3) }`,
    `${L} .dog-sec-title { line-height: var(--text-h3--line-height) }`,
    `${L} .dog-sec-title { font-weight: var(--text-h3--font-weight) }`,
    `${L} .dog-sec-title { color: var(--color-ink) }`,
    `${L} .dog-details-note { font-size: var(--text-dense) }`,
    `${L} .dog-details-note { line-height: var(--text-dense--line-height) }`,
    `${L} .dog-details-note { color: var(--color-ink-3) }`,
    `${L} .dog-details-note[data-tone='danger'] { color: var(--color-danger) }`,
  ]
  // Card 1's sections as built, and the stacks the earlier merges had, for
  // the controls below.
  const SECTIONS = /\.dog-card-project \{ --dog-measure: 576px; \}[\s\S]*?\.dog-sec-foot > \.dog-refs-meter \{ margin-top: 8px; \}/
  // DG6's stack as it was first merged (796399cf): 602 wide, 1,202 and card
  // 1 in two columns from W 1202, the main column a container.
  const DG6_TWO_COLUMNS = `.dog-inputs {
    --dog-measure: 576px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    max-width: 602px;
  }
  @container dog-main (min-width: 1202px) {
    .dog-inputs { max-width: 1202px; }
    .dog-card-project > .dog-card-body {
      display: grid;
      grid-template-columns: var(--dog-measure) var(--dog-measure);
      column-gap: 24px;
      align-items: start;
    }
    .dog-card-project > .dog-card-body > .dog-refs { margin-top: 0; }
  }`
  // DG6's one column (846e37e5): the stack 602 wide at every width.
  const DG6_ONE_COLUMN = `.dog-inputs {
    --dog-measure: 576px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    max-width: 602px;
  }`
  const GUTTER = 'scrollbar-gutter: stable;'

  it('the measure is one number, 576px, declared once, on card 1; its sentences, the project field and description and the meter keep to it', () => {
    const p = pins(DOG)
    expect(p.measures).toEqual(['.dog-card-project { --dog-measure: 576px }'])
    expect(p.measure).toBe('576px')
    expect(p.meter).toBe('var(--dog-measure)')
    for (const line of [
      `${L} .dog-sec-desc { max-width: var(--dog-measure) }`,
      `${L} .dog-project-field { flex: 0 1 var(--dog-measure) }`,
      `${L} .dog-card-project .dog-project-details { flex: 0 1 var(--dog-measure) }`,
    ]) expect(p.layout).toContain(line)
    expect(`${p.measures} ${p.meter}`).not.toMatch(/%|vw|fr\b/)
  })

  it('DG4\'s meter: the measure, a length and never a share of the card; the track 8px; the footer\'s meter still flexes', () => {
    const p = pins(DOG)
    expect(p.meter).toBe('var(--dog-measure)')
    expect(p.track).toBe('8px')
    expect(p.foot).toEqual({ flex: '1' })
  })

  it('the cards fill the column: no wrapper, no cap, no container and no query; the main column keeps C4\'s 8px padding and its scrollbar\'s gutter', () => {
    const p = pins(DOG)
    // Her words of 2026-10-31: "i really dont like that there is a open
    // space/gap to right". DG5's wrapper and DG6's 602 cap are gone, not left
    // inert; the cards are the column's own children, spaced by
    // `.dog-main > * + *` as the output card is.
    expect(p.wrapper).toEqual([])
    expect(JSX).not.toMatch(/dog-inputs/)
    expect(p.queries).toEqual([])
    expect(p.containers).toEqual([])
    expect(p.padding).toBe('8px')
    // DG5's follow-up, review round 1, finding 1: the scrollbar's gutter kept;
    // since DG6's follow-up so the output card (C4's preview) is one width
    // whether or not the column scrolls.
    expect(p.main).toEqual({ padding: '8px', 'background-color': 'var(--color-paper)', 'scrollbar-gutter': 'stable' })
    expect(decl(DOG, '.dog-main > * + *')).toEqual({ 'margin-top': '8px' })
  })

  it('card 1 is sections divided by their titles and space alone: no line on a section, 32px between sections, twice the 16 inside one, the title the H3 step in the first ink', () => {
    const p = pins(DOG)
    // Her words on the design round's sketch: "remove the dividing lines. the
    // titles themselves are enough to separate".
    expect(p.lines).toEqual(LINES_NOW)
    expect(p.spacing).toEqual(SPACING_NOW)
    expect(p.type).toEqual(TYPE_NOW)
    expect(p.between).toEqual(['32px', '32px'])
    expect(p.within).toBe('16px')
    expect(px(p.between[0])).toBe(2 * px(p.within))
    expect(p.title).toEqual({ margin: '0', 'font-size': 'var(--text-h3)', 'line-height': 'var(--text-h3--line-height)', 'font-weight': 'var(--text-h3--font-weight)', color: 'var(--color-ink)' })
    // The titles in the markup: an h3 each, in her order.
    expect(JSX).toContain('<h3 className="dog-sec-title">Project</h3>')
    expect(REFS).toContain('<h3 className="dog-sec-title">References</h3>')
    expect(REFS).toContain('<h3 className="dog-sec-title">{`Uploads (${uploadFiles.length})`}</h3>')
    expect(REFS.indexOf('dog-sec dog-sec-refs')).toBeLessThan(REFS.indexOf('dog-sec dog-refs-group dog-refs-uploads'))
    expect(REFS.indexOf('dog-sec dog-refs-group dog-refs-uploads')).toBeLessThan(REFS.indexOf('dog-sec dog-sec-foot'))
  })

  it('one column of sections at every width, the rows in shelves of 416px or more; nothing sets a card or a section beside another', () => {
    const p = pins(DOG)
    // Her walkthrough 90 Q1, "One column always": sections one under the
    // other; only the rows of a list sit side by side, in a shelf.
    expect(p.layout).toEqual(LAYOUT_NOW)
    expect(decl(DOG, '.dog-card-project > .dog-card-body')).toEqual({})
    expect(decl(DOG, '.dog-refs')).toEqual({})
    expect(DOG).not.toMatch(/min-width: (1148|1202|1708)px/)
    // A row's floor: 416 = 52 x 8, and the shelf's gap the rule of 8.
    const floor = Number(/minmax\(min\(100%, (\d+)px\)/.exec(SHELF)[1])
    expect(floor % 8).toBe(0)
    expect(floor).toBe(416)
  })

  it('the width is the measure\'s arithmetic, and the project row fills its field', () => {
    const p = pins(DOG)
    const measure = px(p.measure)
    const pad = px(decl(DOG, '.dog-card-body').padding)
    const border = px(/^(\d+px) solid/.exec(decl(INDEX, '.ui-card').border || '')?.[1])
    expect([measure, pad, border]).toEqual([576, 12, 1])
    // The project's field and its description sit side by side when both
    // fit at the measure, 24px apart, in the card's body: from a 1,176px body,
    // a 1468 window in Chromium (review round 1, finding 7, MEASURED).
    expect(measure + 24 + measure).toBe(1176)
    // DG6 review round 1, finding 4: the dropdown takes the row beside New
    // project, so the row ends at the field's edge (no inline cap: it was
    // 360px, which left the row 69px short).
    expect(JSX).toMatch(/<div className="flex items-center gap-2">\s*<div className="relative flex-1">\s*<select\s+id="dog-project"/)
    expect(JSX).not.toMatch(/maxWidth: '360px'/)
    // Review round 2, finding 1: the cap back by another spelling (a class or
    // a style on the select itself, a width on a card) is caught too; the
    // census reads `.dog-project-select` and `#dog-project` in the sheet.
    const select = tagOf(JSX, 'id="dog-project"')
    expect(select.startsWith('<select')).toBe(true)
    expect(/className="([^"]*)"/.exec(select)?.[1]).toBe('ui-input dog-select dog-project-select')
    expect(select).not.toMatch(/\bstyle=/)
    expect(tagOf(JSX, 'className="dog-card dog-card-project"')).toBe('<Card pad={false} className="dog-card dog-card-project">')
    expect(tagOf(JSX, 'className="dog-card dog-s2"')).toBe('<Card pad={false} className="dog-card dog-s2">')
  })

  it('CONTROL: the sheets as DG6 first merged it (two columns from W 1202) and as its one column had it (602 at every width) fail the pins', () => {
    expect(DOG).toMatch(SECTIONS)
    expect(DOG).toContain(GUTTER)
    const two = pins(DOG.replace(SECTIONS, DG6_TWO_COLUMNS).replace(GUTTER, `container: dog-main / inline-size;\n    ${GUTTER}`))
    expect(two.queries).toEqual(['@container dog-main (min-width: 1202px)'])
    expect(two.containers).toEqual(['.dog-main { container: dog-main / inline-size }'])
    expect(two.wrapper).not.toEqual([])
    expect(two.layout).not.toEqual(LAYOUT_NOW)
    const one = pins(DOG.replace(SECTIONS, DG6_ONE_COLUMN))
    expect(one.wrapper).toEqual(['.dog-inputs'])
    expect(one.layout).toContain(`${L} .dog-inputs { max-width: 602px }`)
    expect(one.layout).not.toEqual(LAYOUT_NOW)
    expect(one.between).toEqual([undefined, undefined])
    expect(one.measures).toEqual(['.dog-inputs { --dog-measure: 576px }'])
  })

  it('CONTROL: a dividing line, a title rail, sections side by side, a cap or a query back, and every way the reviews found to lay the cards out unseen, are each caught', () => {
    const swap = (from, to) => { const s = DOG.replace(from, to); expect(s).not.toBe(DOG); return pins(s) }
    const ANCHOR = '.dog-main > * + * { margin-top: 8px; }'
    const add = (plant) => swap(ANCHOR, `${ANCHOR}\n  ${plant}`)
    // A line between sections, under any spelling and any selector that
    // reaches card 1's body (review round 1, finding 4: the last four passed
    // the first pin).
    for (const plant of [
      '.dog-sec + .dog-sec { border-top: 1px solid var(--color-rule); }',
      '.dog-refs > .dog-sec-foot { border-top: 1px solid var(--color-rule); }',
      '.dog-sec-title { box-shadow: 0 1px 0 var(--color-rule); }',
      '.dog-refs-uploads { border-top: 1px solid var(--color-rule); }',
      '.dog-refs-contract { border-top: 1px solid var(--color-rule); }',
      '#dog-card1-body h3 { border-bottom: 1px solid var(--color-rule); }',
      '.dog-card-project .dog-refs > * { background-image: linear-gradient(var(--color-rule), var(--color-rule)); }',
    ]) expect(add(plant).lines, plant).not.toEqual(LINES_NOW)
    // Review round 2 (finding 2, MEASURED in the page): round 1's two plants
    // as round 1 wrote them (the background shorthand, a padding gap) and a
    // rule on the card's body.
    for (const plant of [
      '.dog-refs > div + div { background: linear-gradient(var(--color-rule), var(--color-rule)) top / 100% 1px no-repeat; }',
      '.dog-card-body > .dog-sec + * { border-top: 1px solid var(--color-rule); }',
    ]) expect(add(plant).lines, plant).not.toEqual(LINES_NOW)
    // A gap or a title's look changed by another selector, by padding, or
    // through a note.
    for (const plant of [
      '#dog-card1-body .dog-sec > .dog-sec-title + * { margin-top: 32px; }',
      '#dog-card1-body .dog-sec + .dog-sec { margin-top: 16px; }',
      '.dog-refs-uploads, .dog-refs-contract { padding-top: 32px; }',
      '.dog-sec-title { padding-bottom: 30px; }',
      '.dog-sec-refs > .dog-details-note:last-child { margin-bottom: 48px; }',
      '.dog-card-project .dog-refs-row > :is(.dog-refs-warn, .dog-refs-gone, .dog-refs-sub) { padding-left: 0; }',
    ]) expect(add(plant).spacing, plant).not.toEqual(SPACING_NOW)
    for (const plant of [
      '#dog-card1-body h3 { font-size: var(--text-caption); color: var(--color-ink-3); }',
      "[class~='dog-sec-title'] { font-size: var(--text-label); text-transform: uppercase; }",
    ]) expect(add(plant).type, plant).not.toEqual(TYPE_NOW)
    // The output card's own headings are not card 1's (review round 2,
    // finding 8): a rule there leaves card 1's pins as they are.
    const outside = add('.dog-output h3 { margin: 0 0 4px; font-size: var(--text-caption); }')
    expect([outside.spacing, outside.type]).toEqual([SPACING_NOW, TYPE_NOW])
    // The sections' spacing flattened, and the title made a label again.
    expect(swap('.dog-refs > .dog-sec + .dog-sec { margin-top: 32px; }', '.dog-refs > .dog-sec + .dog-sec { margin-top: 16px; }').between).toEqual(['16px', '16px'])
    expect(swap('font-size: var(--text-h3);', 'font-size: var(--text-caption);').title['font-size']).toBe('var(--text-caption)')
    // Each must change the census: a title rail (the design round's first
    // sketch), sections side by side, the cap or a query back, the wrapper
    // laid out, the main column's second child, a card placed, sized or
    // floated, card 1 split, card 2's box capped, the rows' shelf a fixed
    // column, the dropdown capped by its class, a width by its logical name.
    for (const plant of [
      '.dog-sec { display: flex; flex-wrap: wrap; }',
      '.dog-sec-head { flex: 1 1 240px; }',
      '.dog-refs { display: grid; grid-template-columns: 1fr 1fr; }',
      '.dog-card-project > .dog-card-body { display: grid; grid-template-columns: 1fr 1fr; }',
      '@media (min-width: 1300px) { .dog-card-project > .dog-card-body { display: grid; grid-template-columns: 1fr 1fr; } }',
      '#dog-card1-body { display: grid; grid-template-columns: 1fr 1fr; }',
      '.dog-card.dog-card-project { max-width: 602px; }',
      '.dog-main > div:nth-child(2) { display: flex; max-width: none; }',
      '.dog-card.dog-s2 { grid-column: 2; }',
      '.dog-s2[data-full-deck=\'true\'] { float: right; }',
      '.dog-context-prompt, .dog-generate { max-width: var(--dog-measure); }',
      '.dog-card-project .dog-refs-rows { grid-template-columns: 576px; }',
      '.dog-project-select { max-width: 360px; }',
      '.dog-card-project { max-inline-size: 1202px; }',
      '@container dog-main (min-width: 1202px) { .dog-card-project { max-width: 1202px; } }',
    ]) expect(add(plant).layout, plant).not.toEqual(LAYOUT_NOW)
    expect(swap(GUTTER, `container-type: inline-size;\n    ${GUTTER}`).containers).not.toEqual([])
    // The dropdown's and the cards' markup: a cap or a width by a class or a
    // style is caught by the tag readers above (review round 2, K12 to K14).
    const tags = (jsx) => [tagOf(jsx, 'id="dog-project"'), tagOf(jsx, 'className="dog-card dog-card-project"'), tagOf(jsx, 'className="dog-card dog-s2"')]
    const now = tags(JSX)
    for (const [from, to] of [
      ['className="ui-input dog-select dog-project-select"', 'className="ui-input dog-select dog-project-select max-w-sm"'],
      ['id="dog-project"', 'id="dog-project" style={{ maxWidth: 360 }}'],
      ['className="dog-card dog-s2"', 'className="dog-card dog-s2 w-1/2"'],
    ]) {
      const bad = JSX.replace(from, to)
      expect(bad, from).not.toBe(JSX)
      const t = tags(bad)
      const caught = /className="([^"]*)"/.exec(t[0])?.[1] !== 'ui-input dog-select dog-project-select' || /\bstyle=/.test(t[0]) || t[1] !== now[1] || t[2] !== now[2]
      expect(caught, to).toBe(true)
    }
  })

  it('CONTROL: a meter that is a share of the card, a 6px track, or a second measure fails the pins', () => {
    const bad = DOG
      .replace('.dog-refs .dog-refs-meter { width: var(--dog-measure); max-width: 100%; }', '.dog-refs .dog-refs-meter { width: 100%; }')
      .replace(/(\.dog-refs-meter-track \{[^}]*?height: )8px/, '$16px')
      .replace('.dog-refs-actions {', '.dog-s2 { --dog-measure: 600px; }\n  .dog-refs-actions {')
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
