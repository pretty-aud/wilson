// =============================================================================
// pages.test.js — the page registry (UI overhaul F2; review F32).
//
// The registry exists because a page used to be registered in three separate
// hand-kept lists and nothing failed when one was missed: `PAGE_BARS[id] ||
// PAGE_BARS.home` turned the miss into a silently wrong answer, and the
// densest table in the app rendered in Home's 268/268 chrome for three weeks
// (F-R04 / F05).
//
// So the thing to test is not "the table has twelve rows". It is:
//
//   1. A page with no geometry THROWS, at module load, rather than falling
//      back — the build failure F32 asked for. The controls below build each
//      incomplete page and prove the validator rejects it.
//   2. Every derived list is derived, i.e. the registry is the only source.
//   3. The fields that drive a REAL background colour say what the page
//      actually paints today, not what its lane will convert it to.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  PAGES, PAGE_BY_ID, PAGE_IDS, PAGE_BARS, PAGE_TITLES, HOME_BAR_HEIGHT,
  getPage, navPages, validatePage,
} from './pages'

const here = dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(resolve(here, '../App.jsx'), 'utf8')

describe('the registry', () => {
  it('holds every page the app can reach, each one complete', () => {
    expect(PAGES.length).toBe(12)
    for (const p of PAGES) {
      expect(typeof p.id, p.id).toBe('string')
      expect(p.title, p.id).toBeTruthy()
      expect(p.bars.top, p.id).toMatch(/^min\(/)
      expect(p.bars.bottom, p.id).toMatch(/^min\(/)
      expect(['dark', 'light'], p.id).toContain(p.surface)
      expect(['tool', 'page', 'none'], p.id).toContain(p.chrome)
      expect(['primary', 'resources'], p.id).toContain(p.nav)
      expect(p.navLabel, p.id).toBeTruthy()
    }
  })

  it('is frozen, so nothing can mutate the shell at runtime', () => {
    expect(Object.isFrozen(PAGES)).toBe(true)
    expect(Object.isFrozen(PAGES[0])).toBe(true)
    expect(() => { PAGES[0].title = 'nope' }).toThrow()
  })

  it('getPage answers null for an unknown id — never a silent fallback', () => {
    expect(getPage('team-members').title).toBe('Team members')
    expect(getPage('not-a-page')).toBeNull()
    expect(getPage(undefined)).toBeNull()
  })
})

describe('the derived tables are derived', () => {
  it('PAGE_BARS, PAGE_TITLES and PAGE_IDS are the registry, in its order', () => {
    expect(PAGE_IDS).toEqual(PAGES.map((p) => p.id))
    expect(Object.keys(PAGE_BARS)).toEqual(PAGE_IDS)
    expect(Object.keys(PAGE_TITLES)).toEqual(PAGE_IDS)
    for (const p of PAGES) {
      expect(PAGE_BARS[p.id]).toBe(p.bars)
      expect(PAGE_TITLES[p.id]).toBe(p.title)
    }
  })

  it('the sign-in seam is one value, not two literals (Phase 4)', () => {
    expect(HOME_BAR_HEIGHT).toBe(PAGE_BY_ID.home.bars.top)
    expect(HOME_BAR_HEIGHT).toBe(PAGE_BARS.home.bottom)
  })

  it('App.jsx no longer carries a second copy of any of them', () => {
    // The three hand-kept lists F32 names. If one comes back, it comes back
    // as a list that can disagree with this one.
    expect(appSrc).not.toMatch(/const PAGE_TITLES\s*=\s*\{/)
    expect(appSrc).not.toContain("{ id: 'project-manager', label:")
    expect(appSrc).not.toContain("currentPage === 'rate-card' || currentPage ===")
    expect(appSrc).toContain("from './layout/pages'")
  })
})

describe('nav columns', () => {
  it('splits the twelve pages across exactly two columns', () => {
    const primary = PAGES.filter((p) => p.nav === 'primary').map((p) => p.id)
    const resources = PAGES.filter((p) => p.nav === 'resources').map((p) => p.id)
    expect(primary).toEqual(['home', 'dog', 'otter', 'rabbit', 'dashboard', 'settings'])
    expect(resources).toEqual(['project-manager', 'rate-card', 'team-members', 'project-files', 'admin-terminal', 'help'])
    expect([...primary, ...resources].sort()).toEqual([...PAGE_IDS].sort())
  })

  it('omits the page you are on, and always keeps Home', () => {
    expect(navPages('primary', { currentPage: 'dog' }).map((p) => p.id)).not.toContain('dog')
    expect(navPages('resources', { currentPage: 'help' }).map((p) => p.id)).not.toContain('help')
    // Home is unconditional — the strip never opens on Home anyway.
    expect(navPages('primary', { currentPage: 'home' }).map((p) => p.id)).toContain('home')
  })

  it('filters the admin surface out of the ARRAY, not per button (Session 9)', () => {
    expect(navPages('resources', { isAdmin: false }).map((p) => p.id)).not.toContain('admin-terminal')
    expect(navPages('resources', { isAdmin: true }).map((p) => p.id)).toContain('admin-terminal')
    // …and it is the only page that is gated at all.
    expect(PAGES.filter((p) => p.adminOnly).map((p) => p.id)).toEqual(['admin-terminal'])
  })

  it('renames the two colliding SETTINGS items (Q7, ruled)', () => {
    expect(PAGE_BY_ID.settings.navLabel).toBe('App settings')
    expect(PAGE_BY_ID.settings.title).toBe('App settings')
    // The tool's own item is a trigger, not a page, so App.jsx builds it —
    // but it must carry the other half of the rename.
    expect(appSrc).toContain("label: 'Tool settings'")
    expect(appSrc).not.toContain("label: 'SYSTEM SETTINGS'")
    expect(appSrc).not.toContain("label: 'SETTINGS'")
  })
})

describe('surface and chrome say what the page PAINTS today', () => {
  it('the three tools and the one converted data page are dark; the rest are light', () => {
    const dark = PAGES.filter((p) => p.surface === 'dark').map((p) => p.id)
    // Q1 ruled the six data pages onto `paper`. They flip ONE AT A TIME, in
    // the commit that converts the page's own inks — F2 does Team Members
    // (the worked example) and lane C does the other five. A page listed here
    // early renders its own dark-on-dark text, so this list is the schedule.
    expect(dark).toEqual(['dog', 'otter', 'rabbit', 'team-members'])
    const stillLight = ['project-manager', 'rate-card', 'project-files', 'dashboard', 'admin-terminal']
    for (const id of stillLight) {
      expect(PAGE_BY_ID[id].surface, `${id} is lane C's to convert`).toBe('light')
    }
    // Home, Settings and Help stay light forever (Q1: reading and form pages).
    for (const id of ['home', 'settings', 'help']) {
      expect(PAGE_BY_ID[id].surface).toBe('light')
    }
  })

  it('only the three tools take the tool chrome, and only Home takes none', () => {
    expect(PAGES.filter((p) => p.chrome === 'tool').map((p) => p.id)).toEqual(['dog', 'otter', 'rabbit'])
    expect(PAGES.filter((p) => p.chrome === 'none').map((p) => p.id)).toEqual(['home'])
    // A subtitle is the tool wordmark's expansion and nothing else has one.
    expect(PAGES.filter((p) => p.subtitle).map((p) => p.id)).toEqual(['dog', 'otter', 'rabbit'])
  })

  it('every page wrapper in App.jsx comes from the registry, not a literal', () => {
    // Twelve PageSurface calls, one per page, and no hand-written scroll-class
    // wrapper left to disagree with the registry's surface.
    expect((appSrc.match(/<PageSurface id="/g) || []).length).toBe(12)
    for (const id of PAGE_IDS) expect(appSrc, id).toContain(`<PageSurface id="${id}"`)
    expect(appSrc).not.toMatch(/className="wilson-(light|dark)-scroll" style=\{\{ display: currentPage/)
  })
})

// ── The controls ─────────────────────────────────────────
// The registry's whole promise is that an incomplete page throws instead of
// falling back. These build each incomplete page and prove the rejection
// really fires.
//
// 🚨 They call `validatePage` FROM pages.js. An earlier cut of this file
// re-implemented the validator here and asserted that the COPY threw, which
// proves nothing about the source: every assertion survived any change to the
// real function, including deleting it.
describe('controls: an incomplete page really does throw', () => {
  const ok = Object.freeze({
    id: 'x', title: 'X', bars: { top: '1px', bottom: '1px' },
    surface: 'light', chrome: 'page', nav: 'primary',
  })

  it('accepts a complete page, and every real one', () => {
    expect(() => validatePage(ok)).not.toThrow()
    for (const p of PAGES) expect(() => validatePage(p), p.id).not.toThrow()
  })

  it('🚨 rejects the exact Files-page bug: registered, but with no bars', () => {
    const { bars, ...noBars } = ok
    expect(() => validatePage(noBars)).toThrow(/needs bars/)
    expect(() => validatePage({ ...ok, bars: {} })).toThrow(/needs bars/)
    expect(() => validatePage({ ...ok, bars: { top: '1px' } })).toThrow(/needs bars/)
    // …and the message names the page, so the failure says which one.
    expect(() => validatePage({ ...ok, bars: null })).toThrow(/"x"/)
  })

  it('rejects a missing id or title, and a value off any of the four enums', () => {
    expect(() => validatePage({ ...ok, id: '' })).toThrow(/needs a string id/)
    expect(() => validatePage(undefined)).toThrow(/needs a string id/)
    expect(() => validatePage({ ...ok, title: '' })).toThrow(/needs a title/)
    expect(() => validatePage({ ...ok, surface: 'orange' })).toThrow(/surface/)
    expect(() => validatePage({ ...ok, chrome: 'tools' })).toThrow(/chrome/)
    expect(() => validatePage({ ...ok, nav: 'sidebar' })).toThrow(/nav/)
    expect(() => validatePage({ ...ok, measure: 'wide' })).toThrow(/measure/)
    // `measure` is the one field that is legitimately absent.
    expect(() => validatePage({ ...ok, measure: null })).not.toThrow()
  })

  it('runs at module load, so the app cannot boot half-registered', () => {
    // If the CALL were removed, every assertion above would still pass:
    // validatePage would be a function nobody runs. This is the one that
    // notices, and it reads the source rather than trusting the import.
    const src = readFileSync(resolve(here, './pages.js'), 'utf8')
    expect(src).toContain('PAGE_LIST.forEach(validatePage);')
    expect(src.indexOf('PAGE_LIST.forEach(validatePage);'))
      .toBeLessThan(src.indexOf('export const PAGES'))
  })
})
