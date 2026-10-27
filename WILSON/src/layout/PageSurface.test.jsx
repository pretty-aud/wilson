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
