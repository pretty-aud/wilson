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
import { allRules, decls, splitTop } from '../../../scripts/ui-css-rules.mjs'

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
    const OLD = /"(Theme Generator|Use Uploaded Assets|Use Project Assets|Generate Image Prompts)"/
    expect(help).not.toMatch(OLD)
    expect(page).not.toMatch(OLD)
    for (const q of ['"Theme generator"', '"Use uploaded assets"', '"Use project assets"', '"Generate image prompts"']) expect(help, q).toContain(q)
    // CONTROL: the export dialog's own label is the one Help quotes.
    expect(read('./modals/HistoryModal.jsx')).toContain("'Generate image prompts'")
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
