// =============================================================================
// rabbitFiles.css — lane B4's sheet (R.A.B.B.I.T. assets and files), and the
// files it styles. The guards are B2's and B3's (rabbitCssGuards.js), pointed
// at this lane: one layer, only lane classes, every selector scoped, every
// class declared AND written, no attribute value nobody sets, no fight with a
// utility or the kit that source order would decide, no colour that is not a
// token, and no state decided in a style or a className.
//
// FILES grows one surface per commit (B4 lands one commit per surface): a
// file joins here, whole, in the commit that moves it onto this sheet.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  jsCode, rulesOf, indexCss, normal, elementsOf, outsideLayer, selectorClasses,
  strayClasses, unscopedSelectors, importedSheet, classesWritten, unreadableAttributes,
  unreachableAttributeValues, utilityConflicts, weakAgainstKit, kitFights,
  undefinedProperties, readAwayFromSetter, colourLiterals, inlineStateTernaries, stateLeaks,
  jsxTags, cssCode, selectorsOf, lastCompound, specificity, gt,
} from '../rabbitCssGuards.js'
import { contrast, over } from '../../../ui/contrast.js'
import { PAPER_RAISED, INK, INK_2, DANGER, HOVER, BACKDROP } from '../../../ui/tokens.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
const SHEET = resolve(here, 'rabbitFiles.css')
const sheet = read('rabbitFiles.css')
/** Lane B4's class prefixes (the second word after `rb-`), as the guards' `prefix`. */
const LANE = 'files|fm|asset|rel|ent|vid|thumb|warn|audit|relink'
const LANE_RE = new RegExp(`^rb-(${LANE})-`)
/** B4's files on this sheet, relative to this directory, and the prefix each writes. */
const FILES = {
  filesTable: { file: '../components/ProjectFilesTable.jsx', prefix: 'rb-files-' },
  fileManager: { file: '../components/FileManager.jsx', prefix: 'rb-fm-' },
  assets: { file: '../views/ProjectAssetsView.jsx', prefix: 'rb-asset-' },
  relations: { file: '../components/RelationsPanel.jsx', prefix: 'rb-rel-' },
  // B4c, surface 5: the player on the kit Dialog and the preview tile. Neither
  // writes a style: the tile's size is `data-size`, the player's is the sheet's.
  video: { file: '../components/VideoPreview.jsx', prefix: 'rb-vid-' },
  thumb: { file: '../components/FileThumbnail.jsx', prefix: 'rb-thumb-' },
  // B4c, surface 6: the Levels and Experiences pages, one component since the
  // fold (R4-11) and on the kit whole since step C, its detail popup with
  // them. It writes no style: the popup's width is the kit Dialog's `width`,
  // every other geometry the sheet's.
  entity: { file: '../views/EntityListView.jsx', prefix: 'rb-ent-' },
  // B4c, surface 7: the three overlays left (R4-12) — the status-mismatch
  // question and the relink dialog on the kit Dialog, the file activity
  // stream on the kit Drawer. None writes a style: the relink dialog's 640 is
  // the kit Dialog's `width`, the drawer's 420 the kit's `xl`.
  warn: { file: '../components/AssetStatusWarningModal.jsx', prefix: 'rb-warn-' },
  audit: { file: '../components/FileAuditDrawer.jsx', prefix: 'rb-audit-' },
  relink: { file: '../components/RelinkDialog.jsx', prefix: 'rb-relink-' },
}
/** The inline styles each file may write: a caller-given geometry or a
    measured quantity carried as a custom property, never a state. */
const STYLES = {
  filesTable: ["{{ '--rb-files-max': maxHeight ? `${maxHeight}px` : undefined }}"],
  fileManager: ["{{ '--rb-fm-pct': `${copyProgress.percent}%` }}"],
}
// Every file is read whole. (B4c's STAGED — a file part-way onto the sheet,
// read without the functions a later step restyled — emptied at surface 6's
// step C and went with its plumbing in review round one's corrections.)
const source = Object.fromEntries(Object.entries(FILES).map(([k, { file }]) => [k, read(file)]))
const code = Object.fromEntries(Object.entries(source).map(([k, s]) => [k, normal(jsCode(s))]))
const jsx = Object.values(code).join('\n')
const ELEMENTS = Object.values(source).flatMap(elementsOf)

/* ── 1. the sheet's shape ─────────────────────────────────────────────────── */
describe('rabbitFiles.css: one layer, its own classes, every selector scoped', () => {
  it('the sheet and every file were read (every assertion below is an empty list otherwise)', () => {
    expect(rulesOf(sheet).length).toBeGreaterThan(15)
    for (const [key, { file }] of Object.entries(FILES)) expect(source[key].length, file).toBeGreaterThan(3000)
  })
  it('the @layer statement comes first and every rule sits inside the one components block', () => {
    const { statementFirst, rest } = outsideLayer(sheet)
    expect(statementFirst).toBe(true)
    expect(rest).toBe('')
  })
  it('every class is a B4 lane class or the kit\'s', () => {
    expect(strayClasses(sheet, LANE)).toEqual([])
  })
  it('every selector carries a lane class outside any :not()', () => {
    expect(unscopedSelectors(sheet, LANE)).toEqual([])
  })
  it('CONTROL: the shape guards fire on a rule outside the layer, a late statement, a near-miss class and a bare kit override', () => {
    expect(outsideLayer(`${sheet}\n.rb-files-x { color: red; }`).rest).not.toBe('')
    expect(outsideLayer(`@layer utilities { .a{} }\n${sheet}`).statementFirst).toBe(false)
    expect(strayClasses('.rb-files-x {} .rb-filez-ghost {} .rb-task-y {}', LANE)).toEqual(['rb-filez-ghost', 'rb-task-y'])
    expect(unscopedSelectors('.ui-td { padding: 0 }', LANE)).toEqual(['.ui-td'])
    expect(unscopedSelectors('.rb-files-x .ui-td { padding: 0 }', LANE)).toEqual([])
  })
})

/* ── 2. imports ────────────────────────────────────────────────────────────── */
describe('every B4 file on this sheet imports it', () => {
  for (const [key, { file }] of Object.entries(FILES)) {
    it(`${file} imports rabbitFiles.css by a path that resolves to it`, () => {
      expect(importedSheet(file, source[key], 'rabbitFiles.css')).toBe(SHEET)
    })
  }
})

/* ── 3. classes ────────────────────────────────────────────────────────────── */
const declared = new Set(selectorClasses(sheet).filter((c) => LANE_RE.test(c)))
const writtenIn = (key) => new Set(classesWritten(jsCode(source[key]), LANE))
const written = new Set(Object.keys(FILES).flatMap((k) => [...writtenIn(k)]))

describe('every B4 class is both declared and written', () => {
  it('no rule without a className that uses it', () => {
    expect([...declared].filter((c) => !written.has(c))).toEqual([])
  })
  it('no className class without a rule', () => {
    expect([...written].filter((c) => !declared.has(c))).toEqual([])
  })
  it('each file writes only its own prefix', () => {
    for (const [key, { file, prefix }] of Object.entries(FILES)) {
      expect(writtenIn(key).size, file).toBeGreaterThan(0)
      expect([...writtenIn(key)].filter((c) => !c.startsWith(prefix)), file).toEqual([])
    }
  })
})

/* ── 4. attributes ─────────────────────────────────────────────────────────── */
describe('the sheet keys on values the JSX can produce', () => {
  it('no [data-x="v"] rule waits for a value nobody sets', () => {
    expect(unreachableAttributeValues(sheet, jsx)).toEqual([])
  })
  it('only plain [data-x="v"] selectors: no operator, flag or non-data attribute', () => {
    expect(unreadableAttributes(sheet, jsx)).toEqual([])
  })
})

/* ── 5. fights ─────────────────────────────────────────────────────────────── */
describe('no rule loses a fight it cannot see', () => {
  it('no utility on an element sets a property its lane rule sets', () => {
    expect(utilityConflicts(sheet, jsx)).toEqual([])
  })
  it('no rule meets the kit where source order would decide it', () => {
    expect(weakAgainstKit(sheet, jsx)).toEqual([])
    expect(kitFights(sheet, indexCss, ELEMENTS, LANE)).toEqual([])
  })
})

/* ── 6. colour: every value a token ──────────────────────────────────────── */
describe('rabbitFiles.css writes no colour that is not a token', () => {
  it('no hex, no rgb()/hsl()/oklch(), no named or system colour', () => {
    expect(colourLiterals(sheet)).toEqual([])
  })
  it('every custom property it reads is defined, by the kit or by this sheet', () => {
    expect(undefinedProperties(sheet, indexCss, Object.values(source))).toEqual([])
    expect(readAwayFromSetter(sheet, Object.values(source))).toEqual([])
  })
  it('CONTROL: a hex, a named colour and an undefined property are each caught', () => {
    const fake = (decl) => `@layer theme, base, components, utilities;\n@layer components { .rb-files-x { ${decl} } }`
    expect(colourLiterals(fake('color: #78716c;'))).toHaveLength(1)
    expect(colourLiterals(fake('border-color: white;'))).toHaveLength(1)
    expect(undefinedProperties(fake('color: var(--rb-files-nowhere);'), indexCss, [])).toHaveLength(1)
  })
})

/* ── 7. the state extraction ─────────────────────────────────────────────── */
describe('no state is decided in a style or a className', () => {
  for (const [key, { file }] of Object.entries(FILES)) {
    it(`${file}: B1's scanner finds nothing`, () => {
      expect(inlineStateTernaries(source[key])).toEqual([])
    })
    it(`${file}: every style is an allowed geometry, every className a literal`, () => {
      expect(stateLeaks(source[key], STYLES[key] || [], [])).toEqual([])
    })
  }
  it('CONTROL: a hover colour in a style and a state in a className template are caught', () => {
    expect(inlineStateTernaries("<b style={{ color: hovered ? '#fb923c' : '#78716c' }} />").length).toBeGreaterThan(0)
    expect(stateLeaks("<b className={`x ${on ? 'a' : 'b'}`} />", [], []).length).toBeGreaterThan(0)
  })
})

/* ── 5. a geometry the fixtures cannot show ──────────────────────────────── */
describe('the asset thumbnail keeps its click (C1)', () => {
  // No fixture asset has a thumbnail, so no walk can hover one. The remove
  // control sits over the picture's corner, and the kit's 28px `sm` box
  // covered most of a 36px (1x) picture: a click meant to change the
  // thumbnail would mostly remove it (B4b; kit request B4b-KR-1).
  it('the remove control is the icon plus 2px a side, never the kit box', () => {
    const rule = rulesOf(sheet).find(({ sel }) => /\.rb-asset-thumb-remove$/.test(sel))
    expect(rule, 'the remove control has its own rule').toBeTruthy()
    expect(rule.body).toMatch(/(^|[\s;])width:\s*calc\(var\(--icon-sm\) \+ 4px\)/)
    expect(rule.body).toMatch(/(^|[\s;])height:\s*calc\(var\(--icon-sm\) \+ 4px\)/)
  })
})

/* ── 8. the two pages are config ─────────────────────────────────────────── */
// LevelsView and ExperiencesView are EntityListView with their own `entity`
// (B4c's fold, review R4-11). They draw nothing of their own — no class, no
// style, no colour, no element but the one — so the two pages are restyled
// once, in EntityListView and this sheet, and a drift like R4-11's date ring
// (ring-2 in one, ring-1 in the other: a config field until step C) has
// nowhere to come back.
const WRAPPERS = { levels: '../views/LevelsView.jsx', experiences: '../views/ExperiencesView.jsx' }
/** What a page wrapper does beyond configuring EntityListView. */
const wrapperLeaks = (src) => {
  const code = jsCode(src)
  const out = []
  if (/className/.test(code)) out.push('a class')
  if (/\sstyle=/.test(code)) out.push('a style')
  for (const h of code.match(/#[0-9a-fA-F]{3,8}\b/g) || []) out.push(h)
  const tags = jsxTags(code)
  if (tags.length !== 1 || !/^<EntityListView entity=\{[A-Z]+\} \/>$/.test(tags[0])) out.push(`the JSX: ${tags.join(' ')}`)
  // A config value that is a class list: `focus:ring-2` is a style in
  // another spelling.
  for (const [, s] of code.matchAll(/'([^']*)'/g)) {
    if (/[\s:]|^(?:text|bg|border|ring|outline|focus|hover|p[xytrbl]?|m[xytrbl]?|w|h|gap|rounded|font|flex|grid)-/.test(s)) out.push(`'${s}'`)
  }
  return out
}
/** The config's fields, in order. */
const configKeys = (src) => [...jsCode(src).matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])

describe('LevelsView and ExperiencesView are config only (B4c, R4-11)', () => {
  for (const file of Object.values(WRAPPERS)) {
    it(`${file}: no class, no style, no colour, and one element — <EntityListView entity={…} />`, () => {
      expect(read(file).length).toBeGreaterThan(300)
      expect(wrapperLeaks(read(file))).toEqual([])
    })
  }
  it('the two configs have the same fields, and the date ring R4-11 carried is not one of them', () => {
    const fields = ['type', 'noun', 'nouns', 'Noun', 'Icon', 'collection', 'linkKey', 'addMethod', 'updateMethod', 'deleteMethod', 'savedViewsKey']
    expect(configKeys(read(WRAPPERS.levels))).toEqual(fields)
    expect(configKeys(read(WRAPPERS.experiences))).toEqual(fields)
  })
  it('CONTROL: a class, a style, a colour, a second element and a utility in the config are each caught', () => {
    const src = read(WRAPPERS.levels)
    const one = '<EntityListView entity={LEVEL} />'
    expect(src).toContain(one)
    expect(wrapperLeaks(src.replace(one, `<div className="p-2">${one}</div>`)))
      .toEqual(expect.arrayContaining(['a class', expect.stringMatching(/^the JSX: <div/)]))
    expect(wrapperLeaks(src.replace(one, "<EntityListView entity={LEVEL} style={{ color: '#fb923c' }} />")))
      .toEqual(expect.arrayContaining(['a style', '#fb923c']))
    expect(wrapperLeaks(src.replace("  deleteMethod: 'deleteLevel',", "  deleteMethod: 'deleteLevel',\n  dateFocusRing: 'focus:ring-2',")))
      .toEqual(["'focus:ring-2'"])
  })
})

/* ── 9. reduced motion (plan §3.4) ───────────────────────────────────────── */
/** Selector text with its whitespace normalised, to compare a selector with its twin. */
const sameSel = (s) => s.replace(/\s+/g, ' ').trim()
/** The sheet's `prefers-reduced-motion: reduce` blocks: where each opens and
    closes in the comment-free text, and what it holds. */
function reducedMotionBlocks(css) {
  const c = cssCode(css)
  const out = []
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g
  let m
  while ((m = re.exec(c))) {
    let depth = 1, i = re.lastIndex
    for (; i < c.length && depth > 0; i++) { if (c[i] === '{') depth++; else if (c[i] === '}') depth-- }
    out.push({ start: m.index, end: i, text: c.slice(re.lastIndex, i - 1) })
  }
  return out
}
/** Every selector the sheet gives a transition, against the reduced-motion
    blocks: `uncovered` has no twin in one, `late` is declared after its twin
    (source order would hand it the motion back), `loud` is a rule in a block
    that does more than stop a transition. */
function motionCoverage(css) {
  const c = cssCode(css)
  const blocks = reducedMotionBlocks(css)
  const inBlock = (i) => blocks.some((b) => i >= b.start && i < b.end)
  const moving = []
  for (const m of c.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim()
    if (sel.startsWith('@') || inBlock(m.index)) continue
    if (!/(?:^|;)\s*transition(?:-[a-z]+)?\s*:\s*(?!none\s*(?:;|$))/.test(m[2])) continue
    for (const one of selectorsOf(sel)) moving.push({ sel: sameSel(one), at: m.index })
  }
  const quiet = new Map()
  const loud = []
  for (const b of blocks) {
    for (const r of rulesOf(b.text)) {
      if (!/^\s*transition\s*:\s*none\s*;?\s*$/.test(r.body)) loud.push(`${sameSel(r.sel)} { ${r.body.trim()} }`)
      for (const one of selectorsOf(r.sel)) quiet.set(sameSel(one), b.start)
    }
  }
  return {
    blocks: blocks.length,
    moving: moving.length,
    uncovered: moving.filter((x) => !quiet.has(x.sel)).map((x) => x.sel),
    late: moving.filter((x) => quiet.has(x.sel) && x.at > quiet.get(x.sel)).map((x) => x.sel),
    loud,
  }
}

describe('reduced motion (plan §3.4): every transition this sheet declares is stopped in its one block', () => {
  it('one block; each rule in it only `transition: none`, never a blanket selector; every selector given a transition has its twin there, none declared after it', () => {
    const cov = motionCoverage(sheet)
    expect(cov.blocks).toBe(1)
    // Read, not vacuous: the sheet declares 25 transitions today.
    expect(cov.moving).toBeGreaterThan(20)
    expect(cov.loud).toEqual([])
    expect(cov.uncovered).toEqual([])
    expect(cov.late).toEqual([])
    // C5: never a `*` — the pet's keyframes must keep playing.
    for (const b of reducedMotionBlocks(sheet)) expect(b.text).not.toMatch(/(^|[\s,])\*(\s|,|\{|$)/)
  })
  it('CONTROL: a transition added above the block, one added after it, and a block rule that does more than stop one are each caught', () => {
    const at = sheet.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(at).toBeGreaterThan(0)
    expect(motionCoverage(`${sheet.slice(0, at)}.rb-files-x { transition: opacity 1s; }\n  ${sheet.slice(at)}`).uncovered)
      .toEqual(['.rb-files-x'])
    const end = sheet.lastIndexOf('}')
    expect(motionCoverage(`${sheet.slice(0, end)}  .rb-files-cell-input { transition: color 1s; }\n${sheet.slice(end)}`).late)
      .toEqual(['.rb-files-cell-input'])
    const loud = sheet.replace('.rb-ent-prop-text { transition: none; }', '.rb-ent-prop-text { transition: none; opacity: 1; }')
    expect(loud).not.toBe(sheet)
    expect(motionCoverage(loud).loud).toHaveLength(1)
  })
})

/* ── 10. B4c review round one: geometry jsdom cannot lay out ─────────────── */
// Each finding here was measured in the running app (Playwright, before and
// after the fix): a focus ring a clipping box cut, a head 8px too tall, rows
// a flex column squeezed to 6px, a file name scrolled away, two date fields
// over each other, a glyph under 3:1. jsdom lays nothing out, so each is
// pinned as the declaration that fixes it, read off the sheet: an edit that
// drops one fails here by name.
/** The declarations the sheet gives exactly `sel` (one selector of a rule's
    list counts), outside the reduced-motion block, a later one winning. */
function declsFor(sel, css = sheet) {
  const out = {}
  const blocks = reducedMotionBlocks(css)
  for (const m of cssCode(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (blocks.some((b) => m.index >= b.start && m.index < b.end)) continue
    if (!selectorsOf(m[1].trim()).map(sameSel).includes(sameSel(sel))) continue
    for (const d of m[2].matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g)) out[d[1]] = d[2].trim()
  }
  return out
}
/** A kit rule's value for `prop`, from the first rule in index.css whose
    selector list holds exactly `sel` and sets it. */
function kitDecl(sel, prop) {
  for (const { sel: s, body } of rulesOf(indexCss)) {
    if (!selectorsOf(s).map(sameSel).includes(sel)) continue
    const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))
    if (m) return m[1].trim()
  }
  return undefined
}
/** A white picture under the thumbnail's scrim: the light case the review measured. */
const WHITE = '#ffffff'

describe('B4c review round one: the geometry the fixtures and jsdom cannot show, pinned as the declarations that fix it', () => {
  // The kit ring: 2px at a 1px offset — 3px outside a control.
  const ringWidth = parseFloat(kitDecl(':focus-visible', 'outline'))
  const ringOffset = parseFloat(kitDecl(':focus-visible', 'outline-offset'))

  it('premise: the kit ring is drawn 3px outside a control, and a -2px offset draws it inside the control\'s own box', () => {
    expect([ringWidth, ringOffset]).toEqual([2, 1])
    expect(-2 + ringWidth).toBeLessThanOrEqual(0)
  })

  it('every ring a clipping cell or label cut is drawn inside its control: ProjectFilesTable\'s icon buttons, FileManager\'s play tile, both pages\' "Select every …", the Assets row\'s "Set thumbnail for …"', () => {
    for (const sel of [
      // 2px above and 1px below in the kit's clipping `.ui-td`: 2px cut top and bottom.
      '.rb-files-frame .rb-files-table .rb-files-icon-cell .ui-iconbtn',
      '.rb-fm-play',
      // The kit's `.ui-th-label` clips at the button's own box: 3px cut every side.
      '.rb-asset-check',
      '.rb-ent-check',
      // Filling its padding-0 cell: 3px cut every side.
      '.rb-asset-thumb-set',
    ]) expect(declsFor(sel)['outline-offset'], sel).toBe('-2px')
  })

  it('a scroller Tab scrolls a control to the edge of keeps room for the ring — the Control Panel table across, both popups\' property columns down; the in-panel picker\'s rows sit 4px in from theirs', () => {
    const room = ringWidth + ringOffset
    expect(parseFloat(declsFor('.rb-files-frame .rb-files-scroll')['scroll-padding-inline'])).toBeGreaterThanOrEqual(room)
    expect(parseFloat(declsFor('.rb-asset-detail-main')['scroll-padding-block'])).toBeGreaterThanOrEqual(room)
    expect(parseFloat(declsFor('.rb-ent-detail-main')['scroll-padding-block'])).toBeGreaterThanOrEqual(room)
    const list = declsFor('.rb-rel-pick-list')
    expect(list['overflow-y']).toBe('auto')
    expect(list.padding).toBe('4px')
    expect(parseFloat(list.padding)).toBeGreaterThanOrEqual(room)
  })

  it('FileManager\'s head is one 28px row: its tabs at the small control height, over every kit rule that sizes a tab', () => {
    const sel = '.rb-fm-head .ui-tabs .ui-tab'
    expect(declsFor(sel).height).toBe('var(--control-sm)')
    expect(declsFor('.rb-fm-head')['min-height']).toBe('var(--control-sm)')
    const kitHeights = rulesOf(indexCss)
      .flatMap(({ sel: s, body }) => (/(?:^|;)\s*height\s*:/.test(body) ? selectorsOf(s) : []))
      .filter((s) => /\.ui-tab(?![\w-])/.test(lastCompound(s)))
    expect(kitHeights).toEqual(expect.arrayContaining(['.ui-tab', '.ui-toolbar .ui-tab']))
    for (const k of kitHeights) expect(gt(specificity(sel), specificity(k)), k).toBeGreaterThan(0)
  })

  it('RelinkDialog\'s missing files keep their line and the 160px list scrolls: a row never shrinks', () => {
    expect(declsFor('.rb-relink-missing')).toMatchObject({ display: 'flex', 'flex-direction': 'column', 'max-height': '160px', 'overflow-y': 'auto' })
    const row = declsFor('.rb-relink-missing-row')
    // A row clips, so its minimum height is 0: the column squeezed 14 rows
    // to 6.4px each, and 100 to nothing, instead of scrolling.
    expect(row.overflow).toBe('hidden')
    expect(row['flex-shrink']).toBe('0')
  })

  it('FileAuditDrawer\'s file name stays in view: sticky at the body\'s top on the drawer\'s own ground, a hairline under it, the kit body\'s padding taken back', () => {
    const band = declsFor('.rb-audit-file')
    expect(band).toMatchObject({ position: 'sticky', 'border-bottom': '1px solid var(--color-rule)' })
    expect(band['background-color']).toBe(kitDecl('.ui-drawer', 'background-color'))
    // The scroller it sticks in is the kit Drawer's body, padded 12px.
    expect(kitDecl('.ui-drawer-body', 'overflow')).toBe('auto')
    const pad = kitDecl('.ui-drawer-body', 'padding')
    expect(pad).toBe('12px')
    expect(band.margin).toBe(`-${pad} -${pad} 0`)
    expect(band.padding).toBe(`8px ${pad}`)
    // Chromium measures a sticky `top` from the scroller's CONTENT edge: the
    // padding, negative, is the body's top (`top: 0` held it 12px down, over
    // the first card at rest and under the passing stream once scrolled).
    expect(band.top).toBe(`-${pad}`)
  })

  it('the Levels / Experiences popup\'s date fields never outgrow their cell and the 6px they bleed each side (133px in a 94px cell at 1024x700 hid both calendar glyphs)', () => {
    const date = declsFor('.rb-ent-date')
    expect(date['margin-inline']).toBe('-6px')
    expect(date['max-width']).toBe('calc(100% + 12px)')
  })

  it('the popup thumbnail\'s Change and Remove sit on the raised paper over any picture, at rest and on hover', () => {
    const sel = '.ui-hover-actions.rb-ent-thumb-acts > .ui-iconbtn.rb-ent-thumb-act'
    expect(declsFor(sel)['background-color']).toBe('var(--color-paper-raised)')
    expect(declsFor(`${sel}:hover`)['background-image']).toBe('linear-gradient(var(--color-hover), var(--color-hover))')
    // Over the kit's hover, which would put its translucent screen back.
    expect(gt(specificity(sel), specificity('.ui-iconbtn:hover:not(:disabled)'))).toBeGreaterThan(0)
    // Before: the kit's inks through the scrim over a white picture (2.54, 2.76).
    expect(contrast(INK_2, over(BACKDROP, WHITE))).toBeLessThan(3)
    expect(contrast(DANGER, over(BACKDROP, WHITE))).toBeLessThan(3)
    // After: on the raised paper the picture no longer matters (7.85, 8.52; 12.19 hovered).
    expect(contrast(INK_2, PAPER_RAISED)).toBeGreaterThan(7)
    expect(contrast(DANGER, PAPER_RAISED)).toBeGreaterThan(7)
    expect(contrast(INK, over(HOVER, PAPER_RAISED))).toBeGreaterThan(7)
  })
})
