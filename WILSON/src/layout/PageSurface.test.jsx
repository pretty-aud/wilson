/** @vitest-environment jsdom */
// =============================================================================
// PageSurface.test.jsx — post-overhaul FX15 (OUTSTANDING FX14-03): the page on
// screen has one main region, on every page.
//
// Before FX15 only D.O.G. and O.T.T.E.R. drew a <main>; every other page and
// every R.A.B.B.I.T. tab exposed none, so a screen reader's landmark list had
// no main there and the kit toast's focus return, once the element focus came
// from was gone, had nowhere to go: Chromium put focus on <body>
// (scripts/fx15-landmarks-names.mjs, the FX15 hand-off).
//
// The shell here is App's own: the real PageSurface, the real registry, all
// twelve pages in App's order, the real D.O.G. (it draws its own main and
// stays mounted behind every other page) and, for the rest, a page's words
// and a button (none of them draws a main of its own: the source scan below
// holds that). App itself is not rendered (it is the whole application:
// sign-in, the three tools, the pet); App's use of PageSurface is pinned in
// pages.test.js and enterGenerates.test.js.
//
// jsdom has no layout: `checkVisibility` is stubbed by Chromium's rule (an
// element is not shown when it or an ancestor computes `display: none`), and
// `:focus-visible` by Chromium's rule as Toast.test.jsx's FX14 tests do.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// CI has no .env.local: the real Supabase client would throw at import
// (enterKey.render.test.jsx's harness). D.O.G. never reaches it here.
vi.mock('../cloud/auth/supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
vi.mock('../cloud/aiProxy', async (orig) => ({ ...(await orig()), callAI: vi.fn(() => new Promise(() => {})) }))

import PageSurface from './PageSurface'
import { PAGES, PAGE_IDS, getPage } from './pages'
import DeckOutlineGenerator from '../tools/deck-outline-generator_v0.514/DeckOutlineGenerator'
import { ToastProvider, useToast, toastFocusReturn } from '../ui/Toast'
import { _resetOverlaysForTests } from '../ui/overlay'
import { blankJsComments } from '../../scripts/ui-audit.mjs'
import { allRules, decls, splitTop, specificity, compareSpecificity } from '../../scripts/ui-css-rules.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(resolve(here, rel), 'utf8').replace(/\r\n/g, '\n')

// App's order (renderAllPages): the registry's ids, D.O.G. second.
const ORDER = ['home', 'dog', 'otter', 'rabbit', 'settings', 'project-manager', 'rate-card', 'team-members', 'project-files', 'dashboard', 'admin-terminal', 'help']

// O.T.T.E.R.'s own main as it draws it (Otter.jsx; its markup pinned below).
function OtterLike({ currentPage }) {
  return (
    <div className="flex flex-1">
      <nav aria-label="O.T.T.E.R.">nav</nav>
      <main className="flex-1 overflow-hidden relative" hidden={currentPage !== 'otter'}><p>O.T.T.E.R.'s column</p></main>
    </div>
  )
}
function Words({ id }) {
  return (
    <section data-content={id}>
      <h1>{getPage(id).title}</h1>
      <button type="button">{`Act on ${id}`}</button>
    </section>
  )
}
let toast = null
function Grab() { toast = useToast(); return null }
let go = null
function Shell({ start }) {
  const [page, setPage] = useState(start)
  go = setPage
  return (
    <ToastProvider bar="0px">
      {ORDER.map((id) => (
        <PageSurface key={id} id={id} currentPage={page} overflow={getPage(id).chrome === 'tool' ? 'hidden' : 'auto'}>
          {id === 'dog' ? <DeckOutlineGenerator currentPage={page} />
            : id === 'otter' ? <OtterLike currentPage={page} />
              : <Words id={id} />}
        </PageSurface>
      ))}
      <Grab />
    </ToastProvider>
  )
}
const surfaceOf = (id) => document.querySelector(`[data-content="${id}"]`)?.parentElement
const theMainOf = (id) => (id === 'dog' ? document.querySelector('main.dog-main') : id === 'otter' ? document.querySelector('main.relative') : surfaceOf(id))

let mouse = false
let visibleFocus = null
const onKey = () => { mouse = false }
const onMouse = () => { mouse = true }
const onFocusIn = (e) => { visibleFocus = mouse ? null : e.target }
beforeEach(() => {
  // Chromium's rule, without layout: not shown when it or an ancestor
  // computes display: none.
  Element.prototype.checkVisibility = function checkVisibility() {
    for (let el = this; el; el = el.parentElement) if (getComputedStyle(el).display === 'none') return false
    return true
  }
  mouse = false
  visibleFocus = null
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('mousedown', onMouse, true)
  document.addEventListener('focusin', onFocusIn, true)
  const matches = Element.prototype.matches
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (sel) {
    if (sel === ':focus-visible') return this === this.ownerDocument.activeElement && this === visibleFocus
    return matches.call(this, sel)
  })
})
afterEach(() => {
  cleanup()
  _resetOverlaysForTests()
  vi.restoreAllMocks()
  delete Element.prototype.checkVisibility
  document.removeEventListener('keydown', onKey, true)
  document.removeEventListener('mousedown', onMouse, true)
  document.removeEventListener('focusin', onFocusIn, true)
  toast = null
  go = null
})

describe('one main region on every page (FX15)', () => {
  it('the shell here is App\'s: every page of the registry, once', () => {
    expect([...ORDER].sort()).toEqual([...PAGE_IDS].sort())
  })

  it('on each of the twelve pages, one main landmark is exposed, and it is that page\'s; the document holds one main without `hidden`', () => {
    render(<Shell start="home" />)
    for (const id of ORDER) {
      act(() => { go(id) })
      const exposed = screen.getAllByRole('main')
      expect([id, exposed.length]).toEqual([id, 1])
      expect([id, exposed[0] === theMainOf(id)]).toEqual([id, true])
      expect([id, document.querySelectorAll('main:not([hidden]), [role="main"]:not([hidden])').length]).toEqual([id, 1])
      // …and every other is hidden by display, as the page around it.
      for (const m of document.querySelectorAll('main, [role="main"]')) {
        if (m !== exposed[0]) expect([id, m.checkVisibility()]).toEqual([id, false])
      }
    }
  })

  it('the wrapper is the main region except where the tool draws its own (the registry\'s ownMain): D.O.G. and O.T.T.E.R.', () => {
    expect(PAGES.filter((p) => p.ownMain).map((p) => p.id)).toEqual(['dog', 'otter'])
    render(<Shell start="home" />)
    for (const id of ORDER) {
      const wrapper = id === 'dog' ? document.querySelector('main.dog-main').closest('[data-surface]')
        : id === 'otter' ? document.querySelector('main.relative').closest('[data-surface]')
          : surfaceOf(id)
      expect([id, wrapper.tagName]).toEqual([id, getPage(id).ownMain ? 'DIV' : 'MAIN'])
    }
  })

  it('the toast\'s focus return, the element gone, finds the main on screen: Home, a R.A.B.B.I.T. page, D.O.G., and every other', () => {
    render(<Shell start="home" />)
    const gone = document.createElement('button')
    for (const id of ORDER) {
      act(() => { go(id) })
      expect([id, toastFocusReturn(gone) === theMainOf(id)]).toEqual([id, true])
    }
  })

  // The whole flow, as a keyboard user meets it, on pages that had no main
  // before FX15 and on D.O.G.: focus in the page, Tab to a note's Dismiss,
  // the element it came from gone, Dismiss pressed.
  for (const id of ['rabbit', 'home', 'team-members', 'dog']) {
    it(`${id}: a note dismissed from the keyboard, the element focus came from gone, gives focus to ${id === 'dog' ? 'D.O.G.\'s own main' : 'the page\'s main region'}, focusable for that one move`, () => {
      render(<Shell start={id} />)
      const page = theMainOf(id)
      const origin = document.createElement('button')
      origin.textContent = 'a control that goes'
      ;(id === 'dog' ? page : surfaceOf(id).firstElementChild).appendChild(origin)
      act(() => { origin.focus() })
      act(() => { toast.push({ tone: 'info', title: 'Saved', duration: 1000 }) })
      const x = within(document.querySelector('.ui-toast-stack .ui-toast')).getByRole('button', { name: 'Dismiss' })
      act(() => { x.focus() })
      origin.remove()
      fireEvent.click(x)
      expect(document.querySelector('.ui-toast-stack .ui-toast')).toBeNull()
      expect(document.activeElement).toBe(page)
      expect(page.getAttribute('tabindex')).toBe('-1')
      // CONTROL: it is the page on screen's, and no hidden page's.
      expect(document.activeElement.checkVisibility()).toBe(true)
    })
  }
})

describe('no page draws a second main (FX15 source scan)', () => {
  // A role written on an element, not one a selector looks for ('[role="main"]',
  // the toast's own query).
  const MAIN = /<main\b|(?<!\[)\brole=\{?["']main["']\}?|role:\s*["']main["']|createElement\(\s*["']main["']/
  const drawsMain = (src) => MAIN.test(blankJsComments(src))
  it('only D.O.G. and O.T.T.E.R. draw a main of their own; each marks it hidden off its page', () => {
    const hits = productFiles().filter((f) => drawsMain(readFileSync(resolve(here, '../..', f), 'utf8')))
    expect(hits.sort()).toEqual(['src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx', 'src/tools/otter_v0.3.1/Otter.jsx'])
    expect(read('../tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx')).toContain('<main className="dog-main flex-1 min-h-0 overflow-y-auto" hidden={currentPage !== \'dog\'}>')
    expect(read('../tools/otter_v0.3.1/Otter.jsx')).toContain('<main className="flex-1 overflow-hidden relative" hidden={currentPage !== \'otter\'}>')
  })
  it('CONTROL: the scan sees a main drawn as a tag, by role, or made by hand, and not one named in a comment', () => {
    expect(drawsMain('return <main className="x">')).toBe(true)
    expect(drawsMain('<div role="main">')).toBe(true)
    expect(drawsMain("<div role={'main'}>")).toBe(true)
    expect(drawsMain("document.createElement('main')")).toBe(true)
    expect(drawsMain('// keeps <main> as it is\nconst a = 1')).toBe(false)
    expect(drawsMain("document.querySelectorAll('main, [role=\"main\"]')")).toBe(false)
  })
})

// =============================================================================
// DG3 (OUTSTANDING FX15-03; Audrey, 2026-10-27: "Keep it everywhere"): the
// ring the main region wears when the toast's return gives it focus shows on
// every page, the same 2px on all four sides. Before, the kit's ring sat 1px
// OUTSIDE the region, which fills its page from edge to edge, and the content
// box's `overflow: hidden` cut it: wholly on R.A.B.B.I.T. and Help, left and
// right everywhere else (MEASURED in Chromium, every page at 1280x800 and
// 1440x900: the DG3 hand-off). Now the kit draws it inside the region's own
// box; on R.A.B.B.I.T., whose shell is positioned and paints its paper over
// the whole region after the region's outline, the shell draws the same ring
// above itself. jsdom draws nothing: the sheets are pinned here, and Chromium
// measured the pixels.
// =============================================================================
describe('the main region\'s ring is drawn inside its own box, on every page (DG3)', () => {
  const kit = read('../index.css')
  const shell = read('../tools/rabbit_v0.1.0/rabbitShell.css')
  /** Every rule for `selector` exactly (one of its list), with its blocks. */
  const rulesFor = (css, selector) => allRules(css).filter((r) => splitTop(r.sel).includes(selector))
  const declsOf = (css, selector) => rulesFor(css, selector).map((r) => ({ parents: r.parents, decls: Object.fromEntries(decls(r.body)) }))
  const withoutRule = (css, selector) => {
    const at = css.indexOf(`\n  ${selector} {`)
    return at < 0 ? css : css.slice(0, at) + css.slice(css.indexOf('}', at) + 1)
  }
  const ringWidth = () => parseFloat(declsOf(kit, ':focus-visible')[0].decls.outline)

  it('the kit\'s ring is as it was: 2px of the focus token, 1px outside whatever it rings', () => {
    expect(declsOf(kit, ':focus-visible')).toEqual([{ parents: ['@layer base'], decls: { outline: '2px solid var(--color-focus)', 'outline-offset': '1px' } }])
  })

  it('a main region\'s ring is drawn inside its box: one base-layer rule, the offset alone, by the kit ring\'s width, and it outweighs the kit\'s bare rule', () => {
    expect(declsOf(kit, 'main:focus-visible')).toEqual([{ parents: ['@layer base'], decls: { 'outline-offset': '-2px' } }])
    expect(parseFloat('-2px') + ringWidth()).toBe(0)    // the ring's outer edge on the region's edge, its 2px inside
    expect(compareSpecificity(specificity('main:focus-visible'), specificity(':focus-visible'))).toBeGreaterThan(0)
    // Only the offset moves: the width, style and colour stay the kit's (and
    // the surface scopes' colour, `ink-light` on a light page).
    expect(Object.keys(declsOf(kit, 'main:focus-visible')[0].decls)).toEqual(['outline-offset'])
  })

  it('every page\'s main region is a <main>, which the rule names: the shell\'s wrapper, D.O.G.\'s and O.T.T.E.R.\'s own', () => {
    render(<Shell start="home" />)
    for (const id of ORDER) {
      act(() => { go(id) })
      expect([id, theMainOf(id).tagName]).toEqual([id, 'MAIN'])
      expect([id, theMainOf(id).matches('main')]).toEqual([id, true])
    }
  })

  it('CONTROL: the kit\'s sheet without the rule gives a main region the kit\'s 1px outside, the ring the pages cut', () => {
    const cut = withoutRule(kit, 'main:focus-visible')
    expect(cut).not.toBe(kit)
    expect(declsOf(cut, 'main:focus-visible')).toEqual([])
    expect(declsOf(cut, ':focus-visible')[0].decls['outline-offset']).toBe('1px')
  })

  it('R.A.B.B.I.T.\'s shell draws the same ring above its content while its region has keyboard focus, and never takes a click', () => {
    const sel = 'main:focus-visible > .rb-shell::after'
    expect(declsOf(shell, sel)).toEqual([{
      parents: ['@layer components'],
      decls: { content: "''", position: 'absolute', inset: '0', 'z-index': '26', 'pointer-events': 'none', outline: '2px solid var(--color-focus)', 'outline-offset': '-2px' },
    }])
    // The same ring: the kit's width, inset by it, in the kit's colour for a
    // dark page (R.A.B.B.I.T. is one: the registry's surface).
    const d = declsOf(shell, sel)[0].decls
    expect(parseFloat(d.outline)).toBe(ringWidth())
    expect(parseFloat(d['outline-offset']) + ringWidth()).toBe(0)
    expect(d.outline).toBe(declsOf(kit, ':focus-visible')[0].decls.outline)
    expect(getPage('rabbit').surface).toBe('dark')
    // Over every layer that rests in the shell (the connection dot is the
    // highest, 25), under its menus and popovers (30 and up).
    const dot = Number(declsOf(shell, '.rb-conn')[0].decls['z-index'])
    expect(dot).toBe(25)
    expect(Number(d['z-index'])).toBeGreaterThan(dot)
    expect(Number(d['z-index'])).toBeLessThan(30)
  })

  it('the shell is the region\'s own child and positioned, so the overlay covers the region exactly', () => {
    // App renders R.A.B.B.I.T. straight inside its page's main region…
    expect(read('../App.jsx')).toMatch(/<PageSurface id="rabbit" currentPage=\{currentPage\} overflow="hidden">\s*<Rabbit\b/)
    // …and R.A.B.B.I.T.'s root element is the shell, `relative` (Tailwind).
    const rabbit = read('../tools/rabbit_v0.1.0/Rabbit.jsx')
    expect(rabbit.match(/className="rb-shell\b[^"]*"/g)).toEqual(['className="rb-shell relative h-full w-full flex flex-col"'])
    expect(rabbit).toMatch(/return \(\s*<div className="rb-shell relative h-full w-full flex flex-col">/)
    expect(getPage('rabbit').ownMain).toBeFalsy()          // its wrapper is the main region
  })

  it('CONTROL: the shell\'s sheet without the overlay draws no ring above the shell, the R.A.B.B.I.T. FX15 measured', () => {
    const sel = 'main:focus-visible > .rb-shell::after'
    const cut = withoutRule(shell, sel)
    expect(cut).not.toBe(shell)
    expect(declsOf(cut, sel)).toEqual([])
    expect(allRules(cut).filter((r) => /\.rb-shell\b/.test(r.sel)).map((r) => r.sel)).toEqual(['.rb-shell'])
  })
})

// Every product file under src, the kit's included (ui-audit's sourceFiles
// leaves the kit and a few others out; this scan wants them all), tests not.
function productFiles() {
  const out = []
  ;(function walk(dir) {
    for (const name of readdirSync(resolve(here, '../..', dir))) {
      const rel = `${dir}/${name}`
      if (statSync(resolve(here, '../..', rel)).isDirectory()) { walk(rel); continue }
      if (/\.(js|jsx)$/.test(name) && !/\.test\.[jt]sx?$/.test(name)) out.push(rel)
    }
  })('src')
  return out
}
