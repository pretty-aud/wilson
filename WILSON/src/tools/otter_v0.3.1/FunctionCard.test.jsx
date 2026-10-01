/** @vitest-environment jsdom */
// =============================================================================
// FunctionCard.test.jsx — post-overhaul S2b (C9, C10).
//
//  - An unknown language draws the card EXACTLY as the pre-S2b JSX did (that
//    JSX is copied here verbatim and rendered beside it).
//  - A known language colours the TEXT of the two wells and nothing else: the
//    well is still the stylesheet's `.otter-code-well` <pre>, carrying no
//    inline style (the highlighter's own box is withheld — a planted naive
//    use is shown to leak it), its code wraps (`pre-wrap`), and the name and
//    the prose parts are untouched.
//  - Otter.jsx renders the one card in both hosts, with a language, under a
//    heading that reads "General" for a nameless category.
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import FunctionCard, { CodeWell } from './FunctionCard.jsx'
import { LESSON_CODE_THEME } from './otterLanguage.js'

afterEach(cleanup)

const PRINT = {
  name: 'print()',
  syntax: "print(*objects, sep=' ', end='\\n', file=None, flush=False)",
  parameters: 'objects - values to print; sep (str) - separator',
  returns: 'None',
  description: 'Prints the given objects to the console.',
  example: "name = 'Ada'  # a comment\nif name:\n    print(f'Hello, {name}!', 42)",
}

/** The card as Otter.jsx drew it before S2b (both hosts), verbatim. */
function PreS2bCard({ f }) {
  return (
    <div className="otter-fn-card">
      <code className="otter-fn-name">{f.name}</code>
      {f.syntax && <pre className="otter-code-well">{f.syntax}</pre>}
      {f.parameters && <div className="otter-fn-part"><span className="otter-fn-label">Parameters:</span><span className="otter-fn-text">{f.parameters}</span></div>}
      {f.returns && <div className="otter-fn-part"><span className="otter-fn-label">Returns: </span><span className="otter-fn-text">{f.returns}</span></div>}
      {f.description && <p className="otter-fn-desc">{f.description}</p>}
      {f.example && <pre className="otter-code-well">{f.example}</pre>}
    </div>
  )
}

describe('FunctionCard — an unknown language is today\'s card', () => {
  it('renders the pre-S2b markup exactly, for every combination of parts', () => {
    // Review round 1: an imported library can carry a non-string value; the
    // plain card renders it as React always did (an array reads "ab", not "a,b").
    const variants = [PRINT, { ...PRINT, syntax: '' }, { ...PRINT, parameters: '', returns: '' }, { name: 'x' }, { ...PRINT, example: '' },
      { ...PRINT, example: ['a = 1', '\nb = 2'] }, { ...PRINT, syntax: 42 }, { ...PRINT, syntax: true }, { ...PRINT, returns: [['a'], 'b'] }]
    for (const f of variants) {
      const now = render(<FunctionCard fn={f} language={null} />).container.innerHTML
      cleanup()
      const before = render(<PreS2bCard f={f} />).container.innerHTML
      cleanup()
      expect(now, JSON.stringify(f)).toBe(before)
    }
  })
})

describe('FunctionCard — a known language colours the code text only', () => {
  const card = () => render(<FunctionCard fn={PRINT} language="python" />).container

  it('both wells are the stylesheet\'s <pre class="otter-code-well">, with no inline style of the highlighter\'s', () => {
    const wells = card().querySelectorAll('.otter-code-well')
    expect(wells).toHaveLength(2)
    for (const w of wells) {
      expect(w.tagName).toBe('PRE')
      expect(w.className).toBe('otter-code-well')
      expect(w.getAttribute('style'), 'the theme\'s box (its ground, padding, margin, radius, font) stays off the well').toBeNull()
      expect(w.getAttribute('data-language')).toBe('python')
    }
  })

  it('the code wraps as the well always has, in the well\'s font', () => {
    const code = card().querySelector('.otter-code-well > code')
    expect(code.className).toBe('language-python')
    expect(code.style.whiteSpace).toBe('pre-wrap')
    expect(code.style.fontFamily).toBe('var(--font-mono)')
    expect(code.style.color, 'the plain text keeps the well\'s ink').toBe('')
    expect(code.style.background, 'and the well\'s ground').toBe('')
  })

  it('strings, keywords, functions, numbers and comments each take their own colour, from the one theme', () => {
    const c = card()
    // With inline styles on, the highlighter drops the class names its theme
    // styles (create-element.js), so a token is found by its text.
    const colourOf = (text) => [...c.querySelectorAll('.otter-code-well span')].find((s) => s.textContent === text && s.style.color)?.style.color
    const want = (key) => {
      const probe = document.createElement('span')
      probe.style.color = LESSON_CODE_THEME[key].color
      return probe.style.color
    }
    expect(colourOf("'Ada'")).toBe(want('string'))
    expect(colourOf('42')).toBe(want('number'))
    expect(colourOf('# a comment')).toBe(want('comment'))
    expect(colourOf('if')).toBe(want('keyword'))
    expect(colourOf('print'), 'the built-in is coloured').toBeTruthy()
    const distinct = new Set([colourOf("'Ada'"), colourOf('42'), colourOf('# a comment'), colourOf('if')])
    expect(distinct.size).toBe(4)
  })

  it('the text is the source, character for character', () => {
    const wells = card().querySelectorAll('.otter-code-well')
    expect(wells[0].textContent).toBe(PRINT.syntax)
    expect(wells[1].textContent).toBe(PRINT.example)
  })

  it('the name and the prose parts are untouched: no token spans, the same markup as before', () => {
    const c = card()
    expect(c.querySelector('.otter-fn-name').outerHTML).toBe('<code class="otter-fn-name">print()</code>')
    for (const el of c.querySelectorAll('.otter-fn-part, .otter-fn-desc')) expect(el.querySelector('span[style]')).toBeNull()
    expect(c.querySelector('.otter-fn-desc').textContent).toBe(PRINT.description)
  })

  it('CONTROL: the obvious use — the well class on the highlighter\'s own <pre> — leaks the theme\'s box onto the well', () => {
    const naive = render(
      <SyntaxHighlighter language="python" style={LESSON_CODE_THEME} className="otter-code-well">{PRINT.example}</SyntaxHighlighter>,
    ).container.querySelector('pre')
    expect(naive.getAttribute('style')).toMatch(/background/)
    expect(naive.querySelector('code').style.whiteSpace).toBe('pre')
  })

  it('a well draws any stored value as React would draw it, the same text plain or coloured, and an object as text, never a crash (round 2)', () => {
    // Round 2: an object `syntax` threw "Objects are not valid as a React
    // child" on the plain path, and nothing in the app catches it — the
    // window went blank. A generated or imported library can carry one.
    const values = [[42, '42'], [['a = 1', '\nb = 2'], 'a = 1\nb = 2'], [[['a', 'b'], 'c', null, false], 'abc'],
      [true, ''], [{ x: 1 }, '{"x":1}'], ['print()', 'print()']]
    for (const [value, text] of values) {
      for (const language of [null, 'python']) {
        const w = render(<CodeWell code={value} language={language} />).container.querySelector('.otter-code-well')
        expect(w.textContent, `${JSON.stringify(value)} in ${language}`).toBe(text)
        cleanup()
      }
    }
    // The prose parts too.
    const c = render(<FunctionCard fn={{ name: 'f', parameters: { a: 'int' }, returns: ['x', 'y'], description: 7 }} language={null} />).container
    expect([...c.querySelectorAll('.otter-fn-text, .otter-fn-desc')].map((e) => e.textContent)).toEqual(['{"a":"int"}', 'xy', '7'])
  })
})

// ── the hosts ────────────────────────────────────────────────────────────────
// (jsdom's import.meta.url is not a file URL; the suite runs from WILSON/.)
const OTTER = readFileSync('src/tools/otter_v0.3.1/Otter.jsx', 'utf8')
const blank = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '')
/** A slice of the RAW source between two markers (comments are markers here),
 *  blanked of comments afterwards; '' when either marker is missing. */
function between(src, from, to, after = 0) {
  const a = src.indexOf(from, after)
  const b = a < 0 ? -1 : src.indexOf(to, a + from.length)
  return a < 0 || b < 0 ? '' : blank(src.slice(a, b))
}
function hostReport(src) {
  const code = blank(src)
  const bad = []
  // The card's own markup lives in FunctionCard.jsx only.
  if (/className="otter-fn-name"/.test(code)) bad.push('a second copy of the card\'s markup in Otter.jsx')
  const uses = [...code.matchAll(/<FunctionCard\b([^>]*)\/>/g)]
  if (uses.length !== 2) bad.push(`${uses.length} <FunctionCard> uses, want 2 (the Functions view and the Search dialog)`)
  for (const u of uses) if (!/\blanguage=\{[^}]+\}/.test(u[1])) bad.push(`<FunctionCard${u[1]}/> passes no language`)
  // Review round 1 (reviewer C, O3/O4): WHICH language. The Functions view
  // reads the open course; a Search result reads its course by NAME first
  // (in the cloud the slug is an id).
  if (!/const fnLanguage = courseLanguage\(activeSoftware\);/.test(code) || !/<FunctionCard key=\{j\} fn=\{f\} language=\{fnLanguage\} \/>/.test(code)) bad.push('the Functions view does not colour in the open course\'s language')
  if (!/const resultLanguage = courseLanguage\(\{ name: r\.softwareName, slug: r\.softwareSlug \}\);/.test(code) || !/<FunctionCard key=\{fi\} fn=\{f\} language=\{resultLanguage\} \/>/.test(code)) bad.push('a Search result does not colour in its course\'s language')
  // Both function headings read the category through the shared reader.
  const fnBlocks = [
    between(src, "r.resultType === 'functions' && r.matchedCategories", "r.resultType === 'nodes' && r.matchedCategories"),
    between(src, 'if (isCodingLang) {', '// Software hotkeys', src.indexOf('function renderHotkeys()')),
  ]
  for (const b of fnBlocks) {
    if (b.length < 200) { bad.push('a functions block was not found'); continue }
    if (!/otter-ref-section-title">\{functionCategoryName\(cat\)\}/.test(b)) bad.push('a function heading does not read functionCategoryName(cat)')
    if (/\{cat\.category\}/.test(b)) bad.push('a function heading reads cat.category')
  }
  const search = between(src, '// Functions search', '// Nodes search')
  if (!/\$\{functionCategoryName\(cat\)\}\\n/.test(search)) bad.push('the search text reads the category raw')
  // Review round 1: the heading is counted, so a category whose heading
  // matches must show its cards ("general" found 1 and showed none).
  if (!/functionCategoryName\(cat\)\.toLowerCase\(\)\.includes\(q\)\s*\?\s*cat\b/.test(search)) bad.push('a category found by its heading shows no cards')
  // Round 2: the count and the cards read ONE text per function (the count
  // left out parameters and examples, so 838 of 1,975 words from her own
  // library found nothing), and an empty category is not counted.
  const sharedText = /const fnSearchText = \(f\) => \[f\.name, f\.description, f\.syntax, f\.returns, f\.parameters, f\.example\]\.filter\(Boolean\)\.join\(' '\);/
  if (!sharedText.test(search) || (search.match(/fnSearchText\(f\)/g) || []).length < 2) bad.push('the search count and its cards read different text')
  if (!/funcCategories\s*=\s*\(cached\.functions\?\.categories \|\| \[\]\)\.filter\(cat => cat && Array\.isArray\(cat\.functions\) && cat\.functions\.length > 0\)/.test(search)) bad.push('an empty category is counted')
  // Round 2: the generation paths keep a category the generator keyed `name`.
  if (/category: cat\.category \|\| 'General'/.test(code) || (code.match(/category: functionCategoryName\(cat\),/g) || []).length !== 3) bad.push('a generation path reads only `category`')
  return bad
}

describe('Otter.jsx renders the one card in both hosts', () => {
  it('the Functions view and the Search dialog: the card, a language, the shared heading reader', () => {
    expect(hostReport(OTTER)).toEqual([])
  })
  it('CONTROL: a copied card, a dropped language and a raw heading are each reported', () => {
    const copied = OTTER.replace('<FunctionCard key={fi} fn={f} language={resultLanguage} />', '<div className="otter-fn-card"><code className="otter-fn-name">{f.name}</code></div>')
    expect(hostReport(copied).join('\n')).toMatch(/second copy/)
    expect(hostReport(OTTER.replace('language={fnLanguage}', '')).join('\n')).toMatch(/passes no language/)
    expect(hostReport(OTTER.replace('<h3 className="otter-ref-section-title">{functionCategoryName(cat)}</h3>', '<h3 className="otter-ref-section-title">{cat.category}</h3>')).join('\n'))
      .toMatch(/reads cat\.category/)
    expect(hostReport(OTTER.replace('`${functionCategoryName(cat)}\\n` + cat.functions', '`${cat.category}\\n` + cat.functions')).join('\n'))
      .toMatch(/search text/)
    expect(hostReport(OTTER.replace('functionCategoryName(cat).toLowerCase().includes(q) ? cat', 'false ? cat')).join('\n'))
      .toMatch(/shows no cards/)
    expect(hostReport(OTTER.replace('const fnLanguage = courseLanguage(activeSoftware);', 'const fnLanguage = courseLanguage(null);')).join('\n'))
      .toMatch(/open course's language/)
    expect(hostReport(OTTER.replace('f.returns, f.parameters, f.example].filter(Boolean)', 'f.returns].filter(Boolean)')).join('\n'))
      .toMatch(/different text/)
    expect(hostReport(OTTER.replace(' && cat.functions.length > 0)', ')')).join('\n')).toMatch(/empty category is counted/)
    expect(hostReport(OTTER.replace('category: functionCategoryName(cat),', "category: cat.category || 'General',")).join('\n'))
      .toMatch(/generation path/)
    expect(hostReport(OTTER.replace('courseLanguage({ name: r.softwareName, slug: r.softwareSlug })', 'courseLanguage({ slug: r.softwareSlug })')).join('\n'))
      .toMatch(/its course's language/)
  })
})
