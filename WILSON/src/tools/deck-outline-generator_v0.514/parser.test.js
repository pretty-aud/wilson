// =============================================================================
// parser.test.js — F6 (A2): D.O.G.'s slide format, read in one place.
//
// Generation (parseOutputToPages), the History import and parseSlideContent
// (the visualiser's and the exports' reader) each read the slide format with
// their own copy, and the copies accepted different shapes. F6 moved them into
// parser.js (splitSlides, slideHeader, slideTitle, frameSlide, parseAssetLine)
// without changing any output: a temporary harness ran the committed copies
// and these over one corpus, field for field (the hand-off records it). Where
// generation and import still disagree, an output would change, so each keeps
// today's reading; the cases below pin both sides, and docs/OUTSTANDING.md
// records them (F6-01 to F6-06).
//
// parser.js had no test file; this is it.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  splitSlides, slideHeader, slideTitle, frameSlide, parseSlideContent,
  parseAssetLine, parsePlacedAssets,
} from './parser.js'

const R = '═'.repeat(63)
const heads = (pages) => pages.map(p => [p.pageNum, p.layout, p.title])

// The model's own format, as the tests that drive the real screens hold it.
const slide = (n, layout, title) => `SLIDE #${n} — ${layout}\n${R}\n\n▸ TITLE:\n  ${title}\n▸ SUBTITLE: Five pages\n▸ LAYOUT STRUCTURE:\n  Text on the left, the image on the right\n▸ COPY/TEXT CONTENT:\n  • The first point\n  • The second point\n▸ REQUIRED ASSETS:\n  • [Image | 16:9] - Hero shot of the lamp room\n  • [Icon/Logo] - The keeper's mark\n\n${R}\n\n`
// enterKey.render.test.jsx's DECK (a short rule of 15).
const ENTER_KEY_DECK = 'SLIDE #1 — Title Page\n═══════════════\n▸ TITLE:\nThe watch launch\n▸ SUBTITLE:\nA pitch\n'

const AGREE = {
  'App.focus.test.jsx\'s two-slide deck': slide(1, 'Title and Body', 'The lighthouse at dusk') + slide(2, 'Title and Body', 'The keeper'),
  'a visual deck file, its summary and its themes around the slides': `DECK SUMMARY\n${R}\n▸ DECK TITLE: The lighthouse\n${R}\n\n`
    + slide(1, 'Title Slide', 'The lighthouse') + slide(2, 'Two columns', 'Keepers')
    + `ALTERNATE THEME COLORS\n${R}\n• Dawn: #111111, #222222, #333333, #444444\n${R}`,
  'enterKey.render.test.jsx\'s one-slide deck': ENTER_KEY_DECK,
  'rules of exactly 20': `SLIDE #1 — Caption\n${'═'.repeat(20)}\n▸ TITLE: Exactly twenty\n${'═'.repeat(20)}\nSLIDE #2 — Caption\n${'═'.repeat(20)}\n▸ TITLE: Again\n`,
}

describe('generation, import and the visualiser read the model\'s format the same way', () => {
  it.each(Object.entries(AGREE))('%s', (_name, text) => {
    const generated = splitSlides(text)
    const imported = splitSlides(text, { as: 'import' })
    expect(generated.length).toBeGreaterThan(0)
    expect(heads(imported)).toEqual(heads(generated))
    // What the visualiser and the exports read from each slide.
    generated.forEach((p, k) => expect(parseSlideContent(imported[k].content)).toEqual(parseSlideContent(p.content)))
  })

  it('the model\'s format, read: page, layout and title', () => {
    expect(heads(splitSlides(AGREE['App.focus.test.jsx\'s two-slide deck']))).toEqual([
      ['1', 'Title and Body', 'The lighthouse at dusk'], ['2', 'Title and Body', 'The keeper'],
    ])
  })
})

describe('where generation and import differ today, each keeps its reading (recorded)', () => {
  it('F6-01: a bracketed header with a rule under it: generation loses the body, import reads it', () => {
    const text = `${R}\nSLIDE #1 — [LAYOUT TYPE: Title Slide]\n${R}\n▸ TITLE:\nHello\n▸ SUBTITLE: There\n${R}\nSLIDE #2 — [LAYOUT TYPE: Caption]\n${R}\n▸ TITLE: Second\n`
    expect(heads(splitSlides(text))).toEqual([['1', 'Title Slide', 'Untitled'], ['2', 'Caption', 'Untitled']])
    expect(splitSlides(text)[0].content).toBe(frameSlide('1', 'Title Slide', ']'))
    expect(heads(splitSlides(text, { as: 'import' }))).toEqual([['1', 'Title Slide', 'Hello'], ['2', 'Caption', 'Second']])
  })

  it('F6-02: SLIDE #X: import runs the first slide on into the second', () => {
    const text = `SLIDE #X — One column text\n${R}\n\n▸ TITLE:\n  Unnumbered\n\n${R}\n\nSLIDE #X — Caption\n${R}\n\n# A markdown title\n\n${R}`
    expect(heads(splitSlides(text))).toEqual([['X', 'One column text', 'Unnumbered'], ['X', 'Caption', 'A markdown title']])
    expect(heads(splitSlides(text, { as: 'import' }))).toEqual([['X', 'One column text', 'Unnumbered']])
  })

  it('F6-03: an empty title: generation (and the visualiser) take the next line, import says Untitled', () => {
    const text = `SLIDE #4 — Title and body\n${R}\n\n▸ TITLE:\n▸ SUBTITLE: Only a subtitle\n\n${R}`
    expect(splitSlides(text)[0].title).toBe('▸ SUBTITLE: Only a subtitle')
    expect(slideTitle('▸ TITLE:\n▸ SUBTITLE: Only a subtitle')).toBe('▸ SUBTITLE: Only a subtitle')
    expect(splitSlides(text, { as: 'import' })[0].title).toBe('Untitled')
  })

  it('F6-04: a loose "Slide 1" with no #: generation\'s last resort reads it, import does not', () => {
    const text = 'Slide 1: intro\nLAYOUT: Caption\nTITLE: hi there\n\nSlide 2\n# Markdown title\nbody'
    expect(heads(splitSlides(text))).toEqual([['1', 'Caption', 'hi there'], ['2', 'Title and body', 'Markdown title']])
    expect(splitSlides(text, { as: 'import' })).toEqual([])
  })

  it('F6-05: the drawer\'s full-deck format as it read before F6: generation strips the layout\'s closing bracket, import keeps it', () => {
    const format = ['SLIDE #1 — [Layout Name]', R, '', '▸ TITLE:', '[Title text]', '', R, '', 'SLIDE #2 — [Layout Name]', R, '', '▸ TITLE:', '[Title text]', '', R].join('\n')
    expect(heads(splitSlides(format)).map(h => h[1])).toEqual(['[Layout Name', '[Layout Name'])
    expect(heads(splitSlides(format, { as: 'import' })).map(h => h[1])).toEqual(['[Layout Name]', '[Layout Name]'])
  })

  it('F6-06: the text kept: generation frames every slide; import keeps short-ruled text as written and doubles a closing rule', () => {
    expect(splitSlides(ENTER_KEY_DECK)[0].content)
      .toBe(frameSlide('1', 'Title Page', '▸ TITLE:\nThe watch launch\n▸ SUBTITLE:\nA pitch'))
    expect(splitSlides(ENTER_KEY_DECK, { as: 'import' })[0].content).toBe(ENTER_KEY_DECK.trim())
    const deck = AGREE['App.focus.test.jsx\'s two-slide deck']
    expect(splitSlides(deck)[0].content.endsWith(`${R}\n\n${R}`)).toBe(false)
    expect(splitSlides(deck, { as: 'import' })[0].content.endsWith(`${R}\n\n${R}`)).toBe(true)
  })
})

describe('the header, the title and the frame', () => {
  it('slideHeader: format 1 before format 2, the trailing bracket stripped, X kept', () => {
    expect(slideHeader('SLIDE #2 — [LAYOUT TYPE: Title and Body]\n▸ TITLE: x'))
      .toEqual({ pageNum: '2', layout: 'Title and Body', match: 'SLIDE #2 — [LAYOUT TYPE: Title and Body' })
    expect(slideHeader('SLIDE # 7 – Caption\n')).toMatchObject({ pageNum: '7', layout: 'Caption' })
    expect(slideHeader('SLIDE #X - Two columns')).toMatchObject({ pageNum: 'X', layout: 'Two columns' })
    expect(slideHeader('Slide seven')).toBeNull()
  })

  it('slideTitle: next line, same line, then a markdown heading', () => {
    expect(slideTitle('▸ TITLE:\n  On the next line')).toBe('On the next line')
    expect(slideTitle('▸ TITLE: On the same line')).toBe('On the same line')
    expect(slideTitle('# A heading\nbody')).toBe('A heading')
    expect(slideTitle('no title here')).toBeNull()
  })

  it('frameSlide: the header, a rule of 63, the body, a rule of 63', () => {
    expect(frameSlide('3', 'Caption', 'body')).toBe(`SLIDE #3 — Caption\n${R}\n\nbody\n\n${R}`)
  })

  it('parseSlideContent reads the header and title through the same two', () => {
    const c = splitSlides(AGREE['App.focus.test.jsx\'s two-slide deck'])[1].content
    expect(parseSlideContent(c)).toMatchObject({ pageNum: '2', layoutType: 'Title and Body', title: 'The keeper', subtitle: 'Five pages' })
  })
})

describe('one asset line', () => {
  it('a required asset: type, ratio and description, raw', () => {
    expect(parseAssetLine('  • [Image | 16:9] - Hero shot of the lamp room'))
      .toEqual({ filename: undefined, type: 'Image', ratio: '16:9', description: 'Hero shot of the lamp room' })
    expect(parseAssetLine('• [Icon/Logo] - The keeper\'s mark')).toMatchObject({ type: 'Icon/Logo', ratio: undefined })
    expect(parseAssetLine('• [Image | 16:9] – an en dash is not the separator')).toBeNull()
    expect(parseAssetLine('• hero.jpg → [Image | 16:9] - a placed line is not a required one')).toBeNull()
  })

  it('a placed asset (arrow): the file name too, and the placed reader\'s defaults', () => {
    expect(parseAssetLine('• hero.jpg → [Video | 9:16] - tall', { arrow: true }))
      .toEqual({ filename: 'hero.jpg', type: 'Video', ratio: '9:16', description: 'tall' })
    expect(parsePlacedAssets('• a b.png → [Image] - no ratio\n• not an asset\n• x.png → [ | 1:1] - no type')).toEqual([
      { filename: 'a b.png', assetType: 'Image', ratio: '', description: 'no ratio' },
      { filename: 'x.png', assetType: 'Image', ratio: '1:1', description: 'no type' },
    ])
  })
})
