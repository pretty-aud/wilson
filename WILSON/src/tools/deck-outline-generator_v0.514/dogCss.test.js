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
  it('the words are written in sentence case, on the screen and to a screen reader alike', () => {
    const src = read('./DeckOutlineGenerator.jsx')
    for (const w of ['Theme generator', 'Use uploaded assets', 'Use project assets']) {
      expect(src).toContain(`aria-label="${w}"`)
      expect(src).toContain(`<span className="dog-check-label">${w}</span>`)
    }
    expect(src).not.toMatch(/className="dog-check-label">[^<]*\b[A-Z][a-z]* [A-Z]/)
  })

  // Review rounds one and two: Help quoted the controls by their old names.
  it('D.O.G.\'s Help and the Help page quote each control as the interface writes it', () => {
    const help = read('../../data/dogHelpContent.jsx')
    const page = read('../../components/HelpPage.jsx')
    // Review round two (R2-02) added the mode Switch, "Full deck". The Slides
    // extension's own "Full Deck" button is named unquoted, as it writes it.
    const OLD = /"(Theme Generator|Use Uploaded Assets|Use Project Assets|Generate Image Prompts|Full Deck)"/
    expect(help).not.toMatch(OLD)
    expect(page).not.toMatch(OLD)
    for (const q of ['"Theme generator"', '"Use uploaded assets"', '"Use project assets"', '"Generate image prompts"', '"Full deck"']) expect(help, q).toContain(q)
    // CONTROL: the export dialog's own label is the one Help quotes, and so
    // is the mode Switch's.
    expect(read('./modals/HistoryModal.jsx')).toContain("'Generate image prompts'")
    expect(read('./DeckOutlineGenerator.jsx')).toContain('label="Full deck"')
    expect('Toggle "Full Deck" to generate').toMatch(OLD)
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
