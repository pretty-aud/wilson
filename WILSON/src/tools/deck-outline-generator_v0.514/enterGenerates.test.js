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
import { enterIsDogs, ENTER_PRESSES, ENTER_TOGGLES } from './enterGenerates'
import { blankJsComments } from '../../../scripts/ui-audit.mjs'

const read = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
afterEach(() => { document.body.innerHTML = '' })

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
  it('a focused checkbox or switch keeps the shortcut — D.O.G.\'s toggles are buttons, and the role decides (B-R1-01)', () => {
    for (const html of [
      '<button type="button" role="checkbox" aria-checked="true" class="dog-check">Theme generator</button>',
      '<button type="button" role="switch" aria-checked="false" class="ui-switch">Full deck</button>',
    ]) expect(enterIsDogs(enterOn(el(html)), ON), html).toBe(true)
  })
  it('never in a text field, never with a modifier, never taken, never on another page (B-R1-08)', () => {
    for (const html of ['<input type="text" />', '<textarea></textarea>', '<select><option>a</option></select>']) {
      expect(enterIsDogs(enterOn(el(html)), ON), html).toBe(false)
    }
    const editable = el('<div contenteditable="true">x</div>')
    Object.defineProperty(editable, 'isContentEditable', { value: true })   // jsdom does not implement it
    expect(enterIsDogs(enterOn(editable), ON)).toBe(false)
    for (const mod of ['ctrlKey', 'altKey', 'shiftKey', 'metaKey']) expect(enterIsDogs(enterOn(document.body, { [mod]: true }), ON), mod).toBe(false)
    expect(enterIsDogs(enterOn(document.body, {}, { taken: true }), ON)).toBe(false)
    expect(enterIsDogs(enterOn(document.body), { onDogPage: false })).toBe(false)
    expect(enterIsDogs(new window.KeyboardEvent('keydown', { key: ' ' }), ON)).toBe(false)
  })
  it('CONTROL: the two selectors say what the test above relies on', () => {
    expect(ENTER_PRESSES.split(',').map((s) => s.trim())).toContain('button')
    expect(ENTER_TOGGLES.split(',').map((s) => s.trim())).toEqual(['[role="checkbox"]', '[role="switch"]'])
    // A checkbox that were one of the pressed controls would lose the shortcut.
    const box = el('<button type="button" role="checkbox">x</button>')
    expect(box.matches(ENTER_PRESSES)).toBe(true)
    expect(box.matches(ENTER_TOGGLES)).toBe(true)
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
})
