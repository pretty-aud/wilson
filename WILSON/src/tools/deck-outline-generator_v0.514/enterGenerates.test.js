/** @vitest-environment jsdom */
// =============================================================================
// D.O.G.'s "Enter generates" key (enterGenerates.js), driven with real
// elements, and the one call DeckOutlineGenerator.jsx makes to it —
// post-overhaul S2a, Audrey's C12 (Enter presses whatever has focus), review
// round 1 (B-R1-01, B-R1-08, G-R1-05); FX13, her answers of 2026-10-26 (Enter
// on the switch moves it; a full deck from Enter needs text in the deck
// context box). The rendered D.O.G. is driven in enterKey.render.test.jsx.
// =============================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { render, cleanup } from '@testing-library/react'
import { enterIsDogs, ENTER_PRESSES, GENERATE_TOGGLES, deckContextWritten, enterStarts, ASK_FOR_CONTEXT } from './enterGenerates'
import { pushModal, popModal, _resetOverlaysForTests } from '../../ui/overlay'
import { Switch } from '../../ui/Switch'
import { blankJsComments } from '../../../scripts/ui-audit.mjs'

const read = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
afterEach(() => { cleanup(); document.body.innerHTML = ''; _resetOverlaysForTests() })

/** An Enter keydown as the document listener sees it, on `target`. */
function enterOn(target, init = {}, { taken = false } = {}) {
  const e = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })
  Object.defineProperty(e, 'target', { value: target })
  if (taken) e.preventDefault()
  return e
}
function el(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host.firstElementChild
}
const ON = { onDogPage: true }

describe('D.O.G.\'s "Enter generates" key: whose Enter it is', () => {
  it('nothing focused (the page itself), on D.O.G.\'s page: the key is D.O.G.\'s — the shortcut she uses', () => {
    expect(enterIsDogs(enterOn(document.body), ON)).toBe(true)
    expect(enterIsDogs(enterOn(el('<p>Plain text</p>')), ON)).toBe(true)
  })
  it('a focused control Enter presses by itself is left to Enter: a button (the bar\'s Help and Settings), a link, a tab, a menu item, a summary', () => {
    for (const html of [
      '<button type="button" title="Help &amp; documentation"><svg></svg></button>',
      '<a href="#x">A link</a>',
      '<div role="tab" tabindex="0">Library</div>',
      '<div role="menuitem" tabindex="0">Export all</div>',
      '<div role="button" tabindex="0">Card</div>',
      '<details><summary>More</summary></details>',
    ]) {
      const node = el(html)
      const target = node.tagName === 'DETAILS' ? node.querySelector('summary') : node
      expect(enterIsDogs(enterOn(target), ON), html).toBe(false)
    }
    // …and a child inside one (an icon inside a button) counts as the button.
    expect(enterIsDogs(enterOn(el('<button type="button"><span>x</span></button>').firstElementChild), ON)).toBe(false)
  })
  it('D.O.G.\'s own option toggles keep the shortcut — they are buttons, so Enter would flip them back (B-R1-01)', () => {
    expect(enterIsDogs(enterOn(el('<button type="button" role="checkbox" aria-checked="true" class="dog-check">Theme generator</button>')), ON)).toBe(true)
    // …and no other toggle: any other switch or checkbox is a button Enter presses (round 2, B-R2-03).
    expect(enterIsDogs(enterOn(el('<button type="button" role="switch" aria-checked="false" class="ui-switch-track"></button>')), ON)).toBe(false)
    expect(enterIsDogs(enterOn(el('<button type="button" role="checkbox" aria-checked="false">Other</button>')), ON)).toBe(false)
  })
  it('the Full deck switch is not D.O.G.\'s Enter since FX13 ("Enter moves the switch"): the button takes it and flips', () => {
    const deck = el('<span class="ui-switch dog-full-deck"><button type="button" role="switch" aria-checked="false" class="ui-switch-track"><span class="ui-switch-knob"></span></button><span class="ui-switch-label">Full deck</span></span>')
    expect(enterIsDogs(enterOn(deck.querySelector('button')), ON)).toBe(false)
    // …the knob inside it too (a click can land there).
    expect(enterIsDogs(enterOn(deck.querySelector('.ui-switch-knob')), ON)).toBe(false)
    // CONTROL: a D.O.G. tick box beside it keeps the shortcut (B-R1-01), and
    // the switch's label word, which is not a control, is the page's.
    expect(enterIsDogs(enterOn(el('<button type="button" role="checkbox" aria-checked="false" class="dog-check"></button>')), ON)).toBe(true)
    expect(enterIsDogs(enterOn(deck.querySelector('.ui-switch-label')), ON)).toBe(true)
  })
  it('CONTROL: the selector before FX13 named the switch, so this file would have caught it staying', () => {
    const before = 'button.dog-check[role="checkbox"], .dog-full-deck button[role="switch"]'
    const deck = el('<span class="ui-switch dog-full-deck"><button type="button" role="switch" aria-checked="false" class="ui-switch-track"></button></span>')
    expect(deck.querySelector('button').matches(before)).toBe(true)
    expect(deck.querySelector('button').matches(GENERATE_TOGGLES)).toBe(false)
  })
  it('never while a window is over the page: a drawer (its "Editable" switch), a dialog, an alert, anything aria-modal, a kit overlay, a shown backdrop (B-R2-03)', () => {
    const drawer = el('<aside class="ui-drawer dog-settings-drawer"><span class="ui-switch dog-full-deck"><button type="button" role="switch" aria-label="Editable"></button></span><p>Body</p></aside>')
    expect(enterIsDogs(enterOn(drawer.querySelector('button')), ON)).toBe(false)
    expect(enterIsDogs(enterOn(drawer.querySelector('p')), ON)).toBe(false)
    for (const html of ['<div role="dialog"><p>x</p></div>', '<div role="alertdialog"><p>x</p></div>', '<div aria-modal="true"><p>x</p></div>']) {
      expect(enterIsDogs(enterOn(el(html).querySelector('p')), ON), html).toBe(false)
    }
    pushModal('probe')
    try { expect(enterIsDogs(enterOn(document.body), ON)).toBe(false) } finally { popModal('probe') }
    expect(enterIsDogs(enterOn(document.body), ON)).toBe(true)
    // A backdrop counts only when it is on screen: one on a hidden page has
    // no client rects (jsdom has none for anything, so the shown one is stubbed).
    const backdrop = el('<div class="ui-drawer-backdrop"></div>')
    expect(enterIsDogs(enterOn(document.body), ON)).toBe(true)
    backdrop.getClientRects = () => [{ width: 1, height: 1 }]
    expect(enterIsDogs(enterOn(document.body), ON)).toBe(false)
  })
  it('never in a text field, never with a modifier, never on another page (B-R1-08)', () => {
    for (const html of ['<input type="text" />', '<textarea></textarea>', '<select><option>a</option></select>']) {
      expect(enterIsDogs(enterOn(el(html)), ON), html).toBe(false)
    }
    const editable = el('<div contenteditable="true">x</div>')
    Object.defineProperty(editable, 'isContentEditable', { value: true })   // jsdom does not implement it
    expect(enterIsDogs(enterOn(editable), ON)).toBe(false)
    for (const mod of ['ctrlKey', 'altKey', 'shiftKey', 'metaKey']) expect(enterIsDogs(enterOn(document.body, { [mod]: true }), ON), mod).toBe(false)
    expect(enterIsDogs(enterOn(document.body), { onDogPage: false })).toBe(false)
    expect(enterIsDogs(new window.KeyboardEvent('keydown', { key: ' ' }), ON)).toBe(false)
  })
  it('an Enter another listener already took still counts on D.O.G.\'s page — Bins\' hidden listener takes every Enter once a file is selected (round 2, B-R2-01)', () => {
    expect(enterIsDogs(enterOn(document.body, {}, { taken: true }), ON)).toBe(true)
    // …while on another page the page check alone keeps D.O.G. out of it.
    expect(enterIsDogs(enterOn(document.body, {}, { taken: true }), { onDogPage: false })).toBe(false)
  })
  it('CONTROL: the selectors say what the tests above rely on', () => {
    expect(ENTER_PRESSES.split(',').map((s) => s.trim())).toContain('button')
    // A D.O.G. toggle IS a pressed control; only the exception keeps it.
    const box = el('<button type="button" role="checkbox" class="dog-check">x</button>')
    expect(box.matches(ENTER_PRESSES)).toBe(true)
    expect(box.matches(GENERATE_TOGGLES)).toBe(true)
    expect(el('<button type="button" role="switch">x</button>').matches(GENERATE_TOGGLES)).toBe(false)
  })
})

// FX13, Audrey's answers of 2026-10-26 (verbatim in
// docs/sessions/briefs/po-fx13-dog-enter-key.md): "Enter needs text in the
// box" (with the box empty, Enter does nothing and the box gets focus; the
// Generate button still works), and Single page was not her question.
describe('FX13: a full deck from Enter needs text in the deck context box', () => {
  it('whitespace alone is empty', () => {
    for (const blank of ['', ' ', '   ', '\n', '\t\n ', ' ', undefined, null]) expect(deckContextWritten(blank), JSON.stringify(blank)).toBe(false)
    for (const words of ['x', '  A pitch deck  ', '\nfive pages\n']) expect(deckContextWritten(words), words).toBe(true)
  })
  it('Full deck: words start the deck; an empty or blank box asks for them', () => {
    expect(enterStarts({ fullDeckMode: true, deckContext: 'A pitch deck for a watch launch', pageReady: false })).toBe('full deck')
    expect(enterStarts({ fullDeckMode: true, deckContext: '', pageReady: false })).toBe('ask')
    expect(enterStarts({ fullDeckMode: true, deckContext: '  \n ', pageReady: false })).toBe('ask')
    // a ready single page changes nothing on the Full deck side
    expect(enterStarts({ fullDeckMode: true, deckContext: '', pageReady: true })).toBe('ask')
  })
  it('Single page is untouched: a layout and a page request start a page, the deck context box or not; without them, nothing', () => {
    expect(enterStarts({ fullDeckMode: false, deckContext: '', pageReady: true })).toBe('single page')
    expect(enterStarts({ fullDeckMode: false, deckContext: 'Words', pageReady: true })).toBe('single page')
    expect(enterStarts({ fullDeckMode: false, deckContext: '', pageReady: false })).toBe(null)
    expect(enterStarts({ fullDeckMode: false, deckContext: 'Words', pageReady: false })).toBe(null)
  })
  it('CONTROL: the rule before FX13 (Full deck generated whatever the box held) gives a different answer exactly where the box is blank', () => {
    const before = ({ fullDeckMode, pageReady }) => (fullDeckMode ? 'full deck' : pageReady ? 'single page' : null)
    const cases = [true, false].flatMap((fullDeckMode) => [true, false].flatMap((pageReady) => ['', '  ', 'Words'].map((deckContext) => ({ fullDeckMode, pageReady, deckContext }))))
    const changed = cases.filter((c) => enterStarts(c) !== before(c))
    expect(changed).toEqual(cases.filter((c) => c.fullDeckMode && !deckContextWritten(c.deckContext)))
    expect(changed).toHaveLength(4)
  })
  it('the words said, politely: info tone (a status, never an alert), why, and that the Generate button still works; no timer (round 2, finding 1)', () => {
    expect(ASK_FOR_CONTEXT.tone).toBe('info')
    expect(ASK_FOR_CONTEXT.duration).toBe(0)   // the kit's sticky toast: D.O.G. takes it down
    expect(ASK_FOR_CONTEXT.title).toBe('Write in the deck context box first')
    expect(ASK_FOR_CONTEXT.body).toMatch(/^Enter makes a full deck once the box has words in it\. Generate full deck outline works with the box empty\.$/)
    expect(Object.isFrozen(ASK_FOR_CONTEXT)).toBe(true)
  })
  it('the deck context box\'s own Enter follows the rule, and Shift+Enter is still a new line', () => {
    const dog = blankJsComments(read('./DeckOutlineGenerator.jsx'))
    const box = (dog.match(/<textarea\s+ref=\{deckContextRef\}[\s\S]*?className="ui-input dog-context-prompt"/) || [''])[0]
    expect(box, 'the deck context box carries the ref the ask focuses').not.toBe('')
    expect(box).toMatch(/if \(e\.key === 'Enter' && !e\.shiftKey && fullDeckMode\) \{\s*e\.preventDefault\(\);\s*if \(!isGenerating && hasFileContent && deckContextWritten\(systemPrompt\)\) \{\s*generateFullDeck\(\);\s*\}\s*\}/)
    expect(dog.match(/ref=\{deckContextRef\}/g)).toHaveLength(1)
  })
  // Her third answer: "Keep it as it is". The Alt effect is byte for byte the
  // one FX13 found (84bacc4c), comments included.
  it('the Alt key\'s effect is unchanged (DG1b-01 closed by her ruling, nothing built)', () => {
    const src = read('./DeckOutlineGenerator.jsx').replace(/\r\n/g, '\n')
    expect(src).toContain([
      '  // Alt key toggle for Full Deck mode',
      '  useEffect(() => {',
      '    const handler = (e) => {',
      "      if (e.key !== 'Alt') return;",
      '      // Don\'t toggle if user is typing in an input, textarea, or contenteditable',
      '      const tag = e.target.tagName.toLowerCase();',
      "      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;",
      '      // Don\'t toggle if other modifier keys are held',
      '      if (e.ctrlKey || e.shiftKey || e.metaKey) return;',
      '      e.preventDefault();',
      '      setFullDeckMode(prev => !prev);',
      '    };',
      "    document.addEventListener('keyup', handler);",
      "    return () => document.removeEventListener('keyup', handler);",
      '  }, []);',
    ].join('\n'))
  })
})

describe('DeckOutlineGenerator calls it first, with its own page, and App tells it the page', () => {
  it('the document listener\'s first line is the decision (comments blanked, so a commented-out call cannot pass)', () => {
    const dog = blankJsComments(read('./DeckOutlineGenerator.jsx'))
    expect(dog).toMatch(/import \{ enterIsDogs, enterStarts, deckContextWritten, ASK_FOR_CONTEXT \} from '\.\/enterGenerates';/)
    expect(dog).toMatch(/const handler = \(e\) => \{\s*if \(!enterIsDogs\(e, \{ onDogPage: currentPage === 'dog' \}\)\) return;\s*if \(history\.length > 0\) return;/)
    expect(dog).toMatch(/\}, \[currentPage, history\.length, isGenerating, hasFileContent/)
    // FX13: what Enter starts is enterStarts', read from the box's own state,
    // and the effect hears the box change (else it would read a stale box).
    expect(dog).toMatch(/e\.preventDefault\(\);\s*const starts = enterStarts\(\{ fullDeckMode, deckContext: systemPrompt, pageReady: !!\(pagePrompt && selectedLayout\) \}\);\s*if \(starts === 'full deck'\) generateFullDeck\(\);\s*else if \(starts === 'single page'\) generatePageOutline\(\);\s*else if \(starts === 'ask'\) askForDeckContext\(\);\s*\};/)
    expect(dog).toMatch(/generateFullDeck, generatePageOutline, systemPrompt, askForDeckContext\]\);/)
    expect(dog).toMatch(/export default function DeckOutlineGenerator\(\{ onNavigate, currentPage = 'dog', zoomLevel = 0 \}\)/)
    const app = blankJsComments(read('../../App.jsx'))
    expect(app).toMatch(/<DeckOutlineGenerator\s+onNavigate=\{navigateTo\}\s+currentPage=\{currentPage\}/)
  })
  it('CONTROL: a commented-out call is blank to the reader', () => {
    const planted = "const handler = (e) => {\n  // if (!enterIsDogs(e, { onDogPage: currentPage === 'dog' })) return;\n  if (history.length > 0) return;"
    expect(blankJsComments(planted)).not.toMatch(/enterIsDogs\(/)
  })
  // Until FX13 the exception named the Full deck switch by a class on the kit
  // Switch (round 2, B-R2-03). Since her "Enter moves the switch" no kit
  // Switch is in it, the Full deck one included; the class stays, as the
  // name the scripts find the switch by (scripts/dg1-shots.mjs,
  // scripts/fx13-enter-shots.mjs).
  it('no kit Switch, rendered, is a toggle that keeps "Enter generates": not with the Full deck class, not without it', () => {
    const deck = render(createElement(Switch, { className: 'dog-full-deck', checked: false, label: 'Full deck', onChange: () => {} }))
    const sw = deck.container.querySelector('[role="switch"]')
    expect(sw.matches(GENERATE_TOGGLES)).toBe(false)
    expect(sw.matches(ENTER_PRESSES)).toBe(true)   // a button: Enter presses it
    expect(enterIsDogs(enterOn(sw), ON)).toBe(false)
    const editable = render(createElement(Switch, { checked: true, label: 'Editable', onChange: () => {} }))
    expect(editable.container.querySelector('[role="switch"]').matches(GENERATE_TOGGLES)).toBe(false)
  })
  it('DeckOutlineGenerator gives the class to the Full deck switch and to nothing else', () => {
    const dog = blankJsComments(read('./DeckOutlineGenerator.jsx'))
    // DG1: both sides are written beside it; its own name is "Full deck".
    // The Switch tag, whatever the order of its props (code review round 1).
    const tag = (dog.match(/<Switch\b[^>]*className="dog-full-deck"[^>]*>/) || [''])[0]
    expect(tag, 'no Switch carries dog-full-deck').not.toBe('')
    expect(tag).toMatch(/checked=\{fullDeckMode\}/)
    expect(tag).toMatch(/aria-label="Full deck"/)
    expect(dog.match(/dog-full-deck/g)).toHaveLength(1)
  })
})

// Audrey's Q21 (2026-10-17, DG1b): "When D.O.G. opens, which side is the
// switch on?" "Full deck". The side is the switch state's first value, and
// App renders every page at once and only hides the others, so D.O.G. opens
// on Full deck each time WILSON starts and keeps the side after that (but for
// the Alt toggle, heard on every page and kept by her ruling of 2026-10-26,
// FX13). With Full deck on and no page yet, the Enter key, wherever
// enterIsDogs says it is D.O.G.'s, generates the deck whenever the "Generate
// full deck outline" button is enabled (the handler asks the button's own
// two things) and, since FX13, the deck context box has words.
describe("D.O.G. opens on Full deck (Audrey's Q21)", () => {
  const DECL = /const \[fullDeckMode, setFullDeckMode\] = useState\((true|false)\)/g
  // The side the one live declaration starts on; null unless there is exactly one.
  const opensOn = (src) => {
    const live = blankJsComments(src).match(DECL) || []
    if (live.length !== 1) return null
    return live[0].endsWith('useState(true)') ? 'Full deck' : 'Single page'
  }
  // Every live line that calls the setter: none may run when D.O.G. mounts.
  // The known callers are a click on a side's words, the switch's own change
  // and arrow keys, and the Alt key's toggle; anything else (an effect that
  // resets the side, say) would quietly undo her answer.
  const CALLERS = [
    /onClick=\{\(\) => setFullDeckMode\((true|false)\)\}>/,
    /onChange=\{setFullDeckMode\}/,
    /if \(e\.key === 'Arrow(Left|Right)'\) \{ e\.preventDefault\(\); setFullDeckMode\((true|false)\); \}/,
    /^setFullDeckMode\(\(?prev\)? => !prev\);$/,
  ]
  const strayCallers = (src) => blankJsComments(src).split(/\r?\n/).map((l) => l.trim())
    .filter((l) => /setFullDeckMode/.test(l) && !/const \[fullDeckMode, setFullDeckMode\]/.test(l))
    .filter((l) => !CALLERS.some((re) => re.test(l)))
  // Where the one Alt toggle sits: inside the handler that checks for Alt (a
  // key's, not a mount's), between that check and the handler's closing `};`,
  // however long its comments grow; `(prev) =>` is read as well.
  const TOGGLE = /setFullDeckMode\(\(?prev\)? => !prev\)/g
  const altToggle = (src) => {
    const live = blankJsComments(src)
    const n = (live.match(TOGGLE) || []).length
    if (n !== 1) return `${n} toggles`
    const check = live.indexOf("if (e.key !== 'Alt') return;")
    if (check < 0 || live.lastIndexOf('const handler = (e) => {', check) < 0) return 'no Alt handler'
    const at = live.search(TOGGLE)
    return at > check && at < live.indexOf('};', check) ? 'inside the Alt handler' : 'outside it'
  }
  // Why D.O.G. keeps its side (and its pages and uploads) while WILSON is
  // open: App renders it once, directly inside its own PageSurface, with no
  // key and no condition around it, and PageSurface hides an inactive page by
  // display rather than dropping it. A registry `.map` rendering the pages
  // would turn this red: read it again then. (FX15 moved PageSurface beside
  // the registry, src/layout/PageSurface.jsx: read there, and App must render
  // that one.)
  const SURFACE = '../../layout/PageSurface.jsx'
  const remountRisks = (app, surfaceSrc = read(SURFACE)) => {
    const live = blankJsComments(app)
    const risks = []
    const tags = live.match(/<DeckOutlineGenerator\b[\s\S]*?\/>/g) || []
    if (tags.length !== 1) risks.push(`${tags.length} DeckOutlineGenerator tags`)
    if (tags.some((t) => /\bkey=/.test(t))) risks.push('a key on D.O.G.')
    if (!/<PageSurface id="dog"(?![^>]*\bkey=)[^>]*>\s*<DeckOutlineGenerator\b/.test(live)) risks.push('not directly inside a key-less PageSurface id="dog"')
    if (!/^import PageSurface from '\.\/layout\/PageSurface'$/m.test(live)) risks.push('App does not render layout/PageSurface')
    const surface = (blankJsComments(surfaceSrc).match(/function PageSurface\([\s\S]*?\r?\n}\r?\n/) || [''])[0]
    if (!/display: currentPage === id \? 'flex' : 'none'/.test(surface)) risks.push('PageSurface does not hide by display')
    if (/return null|&&\s*\(?\s*children|\?\s*children\s*:/.test(surface)) risks.push('PageSurface can drop its children')
    return risks
  }

  it('the switch starts on Full deck', () => {
    expect(opensOn(read('./DeckOutlineGenerator.jsx'))).toBe('Full deck')
  })
  it('CONTROL: the check reads Single page, ignores a commented-out line, and refuses two declarations', () => {
    expect(opensOn('const [fullDeckMode, setFullDeckMode] = useState(false);')).toBe('Single page')
    expect(opensOn('// const [fullDeckMode, setFullDeckMode] = useState(true);\nconst [fullDeckMode, setFullDeckMode] = useState(false);')).toBe('Single page')
    expect(opensOn('const [fullDeckMode, setFullDeckMode] = useState(true);\nconst [fullDeckMode, setFullDeckMode] = useState(true);')).toBe(null)
  })
  it('nothing sets the side on its own: every call is a click, the switch, an arrow key or Alt', () => {
    const dog = read('./DeckOutlineGenerator.jsx')
    expect(strayCallers(dog)).toEqual([])
    expect(altToggle(dog)).toBe('inside the Alt handler')
  })
  it('CONTROL: a toggle beside the Alt handler instead of in it, or a second one, is caught', () => {
    const effect = (inside, beside) => [
      '  useEffect(() => {',
      '    const handler = (e) => {',
      "      if (e.key !== 'Alt') return;",
      '      e.preventDefault();',
      inside,
      '    };',
      beside,
      "    document.addEventListener('keyup', handler);",
      '  }, []);',
    ].join('\n')
    expect(altToggle(effect('      setFullDeckMode((prev) => !prev);', ''))).toBe('inside the Alt handler')
    expect(altToggle(effect('', '    setFullDeckMode(prev => !prev);'))).toBe('outside it')
    expect(altToggle(effect('      setFullDeckMode(prev => !prev);', '    setFullDeckMode(prev => !prev);'))).toBe('2 toggles')
  })
  it('App keeps D.O.G. mounted: once, directly in its own page, no key, hidden by display', () => {
    expect(remountRisks(read('../../App.jsx'))).toEqual([])
  })
  it('CONTROL: a key, a condition around it, a key on its page, and a page that drops its children are each caught', () => {
    const app = read('../../App.jsx')
    expect(remountRisks(app.replace(/(<DeckOutlineGenerator\b[\s\S]*?)(\s*\/>)/, '$1\n          key={currentPage}$2'))).toContain('a key on D.O.G.')
    expect(remountRisks(app.replace(/(<PageSurface id="dog"[^>]*>)(\s*)(<DeckOutlineGenerator\b[\s\S]*?\/>)/, "$1$2{currentPage === 'dog' && $3}"))).toContain('not directly inside a key-less PageSurface id="dog"')
    expect(remountRisks(app.replace('<PageSurface id="dog"', '<PageSurface id="dog" key={currentPage}'))).toContain('not directly inside a key-less PageSurface id="dog"')
    const surface = read(SURFACE)
    expect(remountRisks(app, surface.replace(/(function PageSurface\([\s\S]*?)\{children\}/, '$1{currentPage === id && children}'))).toContain('PageSurface can drop its children')
    expect(remountRisks(app, surface.replace("display: currentPage === id ? 'flex' : 'none'", "display: 'flex'"))).toContain('PageSurface does not hide by display')
    expect(remountRisks(app.replace("import PageSurface from './layout/PageSurface'", ''))).toContain('App does not render layout/PageSurface')
  })
  it('CONTROL: an effect that resets the side when D.O.G. mounts is caught', () => {
    const planted = "  useEffect(() => { setFullDeckMode(false); }, []);\n  useEffect(() => setFullDeckMode(false), [projectId]);"
    expect(strayCallers(planted)).toHaveLength(2)
  })
})
