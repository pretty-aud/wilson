/** @vitest-environment jsdom */
// =============================================================================
// D.O.G.'s "Enter generates" key (enterGenerates.js), driven with real
// elements, and the one call DeckOutlineGenerator.jsx makes to it —
// post-overhaul S2a, Audrey's C12 (Enter presses whatever has focus), review
// round 1 (B-R1-01, B-R1-08, G-R1-05).
// =============================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { render, cleanup } from '@testing-library/react'
import { enterIsDogs, ENTER_PRESSES, GENERATE_TOGGLES } from './enterGenerates'
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
  it('D.O.G.\'s own option toggles and its Full deck switch keep the shortcut — they are buttons, so Enter would flip them back (B-R1-01)', () => {
    expect(enterIsDogs(enterOn(el('<button type="button" role="checkbox" aria-checked="true" class="dog-check">Theme generator</button>')), ON)).toBe(true)
    const deck = el('<span class="ui-switch dog-full-deck"><button type="button" role="switch" aria-checked="false" class="ui-switch-track"></button><span class="ui-switch-label">Full deck</span></span>')
    expect(enterIsDogs(enterOn(deck.querySelector('button')), ON)).toBe(true)
    // …and no other toggle: any other switch or checkbox is a button Enter presses (round 2, B-R2-03).
    expect(enterIsDogs(enterOn(el('<button type="button" role="switch" aria-checked="false" class="ui-switch-track"></button>')), ON)).toBe(false)
    expect(enterIsDogs(enterOn(el('<button type="button" role="checkbox" aria-checked="false">Other</button>')), ON)).toBe(false)
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

describe('DeckOutlineGenerator calls it first, with its own page, and App tells it the page', () => {
  it('the document listener\'s first line is the decision (comments blanked, so a commented-out call cannot pass)', () => {
    const dog = blankJsComments(read('./DeckOutlineGenerator.jsx'))
    expect(dog).toMatch(/import \{ enterIsDogs \} from '\.\/enterGenerates';/)
    expect(dog).toMatch(/const handler = \(e\) => \{\s*if \(!enterIsDogs\(e, \{ onDogPage: currentPage === 'dog' \}\)\) return;\s*if \(history\.length > 0\) return;/)
    expect(dog).toMatch(/\}, \[currentPage, history\.length, isGenerating, hasFileContent/)
    expect(dog).toMatch(/export default function DeckOutlineGenerator\(\{ onNavigate, currentPage = 'dog', zoomLevel = 0 \}\)/)
    const app = blankJsComments(read('../../App.jsx'))
    expect(app).toMatch(/<DeckOutlineGenerator\s+onNavigate=\{navigateTo\}\s+currentPage=\{currentPage\}/)
  })
  it('CONTROL: a commented-out call is blank to the reader', () => {
    const planted = "const handler = (e) => {\n  // if (!enterIsDogs(e, { onDogPage: currentPage === 'dog' })) return;\n  if (history.length > 0) return;"
    expect(blankJsComments(planted)).not.toMatch(/enterIsDogs\(/)
  })
  // The exception names the Full deck switch by a class on the kit Switch, so
  // two things must hold for it to keep the shortcut (round 2, B-R2-03): the
  // kit puts that class where the selector looks, and D.O.G. gives it to that
  // one switch and no other (the settings drawer's "Editable" is a Switch too).
  it('the kit Switch, rendered, is the toggle the selector names — with the class, and only with it', () => {
    const deck = render(createElement(Switch, { className: 'dog-full-deck', checked: false, label: 'Full deck', onChange: () => {} }))
    expect(deck.container.querySelector('[role="switch"]').matches(GENERATE_TOGGLES)).toBe(true)
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
// the Alt toggle, heard on every page: OUTSTANDING DG1b-01). With Full deck on
// and no page yet, the Enter key, wherever enterIsDogs says it is D.O.G.'s,
// generates the deck whenever the "Generate full deck outline" button is
// enabled (the handler asks the button's own two things).
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
    /^setFullDeckMode\(prev => !prev\);$/,
  ]
  const strayCallers = (src) => blankJsComments(src).split(/\r?\n/).map((l) => l.trim())
    .filter((l) => /setFullDeckMode/.test(l) && !/const \[fullDeckMode, setFullDeckMode\]/.test(l))
    .filter((l) => !CALLERS.some((re) => re.test(l)))

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
    // The Alt toggle is one line, inside the Alt key's own handler (a key's,
    // not a mount's), however long that handler's comments grow.
    const live = blankJsComments(dog)
    expect(live.match(/setFullDeckMode\(prev => !prev\)/g)).toHaveLength(1)
    const from = live.indexOf("if (e.key !== 'Alt') return;")
    const to = live.indexOf("document.addEventListener('keyup', handler)", from)
    const toggle = live.indexOf('setFullDeckMode(prev => !prev)')
    expect(from, 'the Alt handler').toBeGreaterThan(-1)
    expect(toggle > from && toggle < to, 'the toggle sits inside the Alt handler').toBe(true)
  })
  it('App mounts D.O.G. once and gives it no key, so nothing remounts it and resets the side', () => {
    const tags = (src) => blankJsComments(src).match(/<DeckOutlineGenerator\b[\s\S]*?\/>/g) || []
    const app = tags(read('../../App.jsx'))
    expect(app).toHaveLength(1)
    expect(app[0]).not.toMatch(/\bkey=/)
    // CONTROL: a key anywhere in the tag is seen, after the other props too.
    expect(tags('<DeckOutlineGenerator\n  onNavigate={navigateTo}\n  currentPage={currentPage}\n  key={projectId}\n/>')[0]).toMatch(/\bkey=/)
  })
  it('CONTROL: an effect that resets the side when D.O.G. mounts is caught', () => {
    const planted = "  useEffect(() => { setFullDeckMode(false); }, []);\n  useEffect(() => setFullDeckMode(false), [projectId]);"
    expect(strayCallers(planted)).toHaveLength(2)
  })
})
