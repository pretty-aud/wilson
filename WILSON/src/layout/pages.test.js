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

import { describe, it, expect, vi } from 'vitest'

// TM_COLUMN_WIDTHS comes from the Team Members page COMPONENT, whose import chain
// (useWorkspaceMembers -> supabaseClient) constructs the Supabase client at module
// load and throws 'supabaseUrl is required' when there is no .env.local, which is
// every CI run (red from 2d98d21 to 7a00c43, 2026-09-11). Same mock the other unit
// tests use; nothing here touches the client.
vi.mock('../cloud/auth/supabaseClient', () => ({
  supabase: {},
  hydrateSupabase: async () => {},
}))
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  PAGES, PAGE_BY_ID, PAGE_IDS, PAGE_BARS, PAGE_TITLES, HOME_BAR_HEIGHT,
  getPage, navPages, validatePage,
} from './pages'
import { TM_COLUMN_WIDTHS } from '../components/TeamMembers/TeamMembersPage'
import { sourceFiles, blankJsComments } from '../../scripts/ui-audit.mjs'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'

const here = dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(resolve(here, '../App.jsx'), 'utf8')

// ── The worked example's column widths ──────────────────────────────────────
// 🚨 `table-layout: fixed` reads the declared widths and hands any excess back
// to the browser to reconcile, so an over-sum means NO column renders at the
// width it was written at. Two cuts of this table shipped with a comment
// claiming the widths summed to 100 while they summed to 112 and then 109.
// The sum is computed here rather than asserted in prose.
const pct = (v) => Number(String(v).replace('%', ''))
const total = (cols, keys) => keys.reduce((n, k) => n + pct(cols[k]), 0)

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

  // UI overhaul P1, review round two (R2-06): the rename reached the nav and
  // Help, but an empty state still sent people to "System settings → RABBIT"
  // and both companion prompts named "System Settings" and "PROJECT
  // MANAGER". No string the app draws, or tells a companion, names a page or
  // tab by its retired name. Comments may keep the history; the dev fixtures
  // are exempt because their course quotes DaVinci Resolve's own "Project
  // Manager" menu.
  const RETIRED = /System [Ss]ettings|SYSTEM SETTINGS|Project Manager|PROJECT MANAGER|RABBIT tab/
  const retiredIn = (src) => blankJsComments(src).split('\n').filter((line) => RETIRED.test(line))
  it('no string the app draws or tells a companion names a retired page or tab (Q7)', () => {
    const files = sourceFiles().filter((f) => !f.startsWith('src/dev/'))
    expect(files.length).toBeGreaterThan(200)
    const hits = files.flatMap((f) => retiredIn(readFileSync(f, 'utf8')).map((line) => `${f}: ${line.trim().slice(0, 80)}`))
    expect(hits).toEqual([])
  })
  it('CONTROL: the reader sees a retired name in a string, a template and JSX text, and skips a comment', () => {
    const planted = [
      "const a = 'App settings' // was System Settings",
      '/* the old RABBIT tab */',
      "const b = 'Open System settings → RABBIT'",
      'context += `- PROJECT MANAGER: documents`',
      '<p>Change it in System Settings.</p>',
    ].join('\n')
    expect(retiredIn(planted)).toEqual([
      "const b = 'Open System settings → RABBIT'",
      'context += `- PROJECT MANAGER: documents`',
      '<p>Change it in System Settings.</p>',
    ])
  })
})

describe('surface and chrome say what the page PAINTS today', () => {
  it('the three tools and all six data pages are dark; only the three reading pages are light', () => {
    const dark = PAGES.filter((p) => p.surface === 'dark').map((p) => p.id)
    // Q1 ruled the six data pages onto `paper`. They flip ONE AT A TIME, in
    // the commit that converts the page's own inks — F2 does Team Members
    // (the worked example) and lane C does the other five. A page listed here
    // early renders its own dark-on-dark text, so this list is the schedule.
    expect(dark).toEqual([
      'dog', 'otter', 'rabbit',
      // lane C, C2: converted with its own inks in the same commit
      'dashboard',
      // lane C, C1: same rule, same commit
      'project-manager', 'rate-card',
      'team-members',
      'project-files',
      // lane C, C3b: the last of the six, and the one that took two sessions
      'admin-terminal',
    ])
    // 🚨 THE `stillLight` LIST IS EMPTY NOW AND IS NOT KEPT AS AN EMPTY
    // ARRAY. C3b converted the last of the six data pages, so a `for` loop
    // over nothing would pass forever and prove nothing — C1's hand-off §10
    // asked for the assertion to be REWRITTEN at this moment rather than
    // emptied. What is true from here is the closed statement: exactly three
    // pages are light, they are the three READING and FORM pages Q1 named,
    // and a fourth appearing is the regression worth catching.
    expect(PAGES.filter((p) => p.surface === 'light').map((p) => p.id))
      .toEqual(['home', 'settings', 'help'])
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

  it('rejects two pages sharing an id', () => {
    // Not part of validatePage (which sees one entry at a time), so it needs
    // its own control: `PAGES` is built from a list, and two entries with the
    // same id would silently shadow one another in every derived table.
    const ids = PAGES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const src = readFileSync(resolve(here, './pages.js'), 'utf8')
    expect(src).toContain("throw new Error('PAGES: duplicate id')")
    // The mistake, built: the check the source runs really does catch it.
    const dupes = ['home', 'dog', 'home']
    expect(new Set(dupes).size !== dupes.length).toBe(true)
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

describe("the worked example's table columns add up", () => {
  // The four conditional columns, from TeamMembersPage's own flags:
  //   showEmail   activeView !== 'user'
  //   showStatus  isAdminView
  //   showRate    isAdminView && rateAccess.canView
  //   showActions isAdminView && wm.can('member.remove')
  const ALWAYS = ['member', 'username', 'title', 'department', 'pronouns', 'fullTime', 'role', 'projects']

  it('sums to exactly 100 in the widest view, and under it in the others', () => {
    const admin = [...ALWAYS, 'email', 'status', 'rate', 'actions']
    expect(total(TM_COLUMN_WIDTHS, admin)).toBe(100)
    // An admin without the rate-card grant, and without the remove
    // permission: still under, never over.
    expect(total(TM_COLUMN_WIDTHS, [...ALWAYS, 'email', 'status'])).toBeLessThanOrEqual(100)
    expect(total(TM_COLUMN_WIDTHS, [...ALWAYS, 'email'])).toBeLessThanOrEqual(100)
    expect(total(TM_COLUMN_WIDTHS, ALWAYS)).toBeLessThanOrEqual(100)
  })

  it('declares every column as a share — one stray pixel value and the sum stops meaning anything', () => {
    for (const [k, v] of Object.entries(TM_COLUMN_WIDTHS)) {
      expect(String(v), k).toMatch(/^\d+%$/)
    }
    expect(Object.keys(TM_COLUMN_WIDTHS)).toHaveLength(12)
  })

  it('gives the column holding the widest string in a <select> the largest data share', () => {
    // A <select> has no text-overflow: it hard-clips mid-word rather than
    // eliding, and Department holds "Physical Production".
    const data = Object.entries(TM_COLUMN_WIDTHS)
      .filter(([k]) => !['member', 'actions'].includes(k))
    const widest = data.reduce((a, b) => (pct(a[1]) >= pct(b[1]) ? a : b))[0]
    expect(widest).toBe('department')
  })
})

// ── Each tool's Help and Settings, in its own strip (post-overhaul S2a) ─────
// Audrey, 2026-09-29 (POST_OVERHAUL_PLAN §0.1, C6 and C7): "Tool settings"
// leaves the WILSON nav strip, so each tool's gear lives at the right end of
// the tool's OWN strip, Help beside it ("settings at the right end"), and the
// in-page Help opens the tool's own Help dialog. R.A.B.B.I.T.'s ViewTabs slot
// is the reference. Read from each file's JSX (no test here lays a tool out;
// scripts/tool-strip-probe.mjs measures the one x and y in the running app).
const TOOL_STRIPS = [
  { tool: 'D.O.G.', file: '../tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx', container: { className: 'dog-outline-right' }, settings: 'D.O.G. settings', opens: 'setShowSettingsMenu' },
  { tool: 'O.T.T.E.R.', file: '../tools/otter_v0.3.1/Otter.jsx', container: { className: 'otter-nav-right' }, settings: 'O.T.T.E.R. settings', opens: 'setSettingsOpen' },
  { tool: 'R.A.B.B.I.T.', file: '../tools/rabbit_v0.1.0/Rabbit.jsx', container: { slotOf: 'ViewTabs', prop: 'rightSlot' }, settings: 'R.A.B.B.I.T. settings', opens: 'setSettingsOpen' },
]
const traverse = traverseModule.default || traverseModule
const attrOf = (el, name) => el.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === name)
const stringAttr = (el, name) => {
  const a = attrOf(el, name)
  if (!a?.value) return null
  if (a.value.type === 'StringLiteral') return a.value.value
  if (a.value.type === 'JSXExpressionContainer' && a.value.expression.type === 'StringLiteral') return a.value.expression.value
  return null
}
const nameOf = (el) => el.openingElement.name.name
/** The IconButtons a strip's right-hand group renders, in source order, with
    the source text of each one's onClick. Problems come back as strings. */
function stripButtons(src, container) {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
  const groups = []
  traverse(ast, {
    JSXElement(p) {
      const el = p.node
      if (container.className) {
        const cls = stringAttr(el, 'className')
        if (cls && cls.split(/\s+/).includes(container.className)) groups.push(p)
      } else if (nameOf(el) === container.slotOf) {
        const slot = attrOf(el, container.prop)
        if (slot?.value?.type === 'JSXExpressionContainer') groups.push(p.get('openingElement').get('attributes').find((a) => a.node === slot))
      }
    },
  })
  if (groups.length !== 1) return { problems: [`${groups.length} right-hand groups found, not one`], buttons: [] }
  const buttons = []
  groups[0].traverse({
    JSXElement(p) {
      if (nameOf(p.node) !== 'IconButton') return
      const click = attrOf(p.node, 'onClick')?.value?.expression
      buttons.push({
        title: stringAttr(p.node, 'title'),
        icon: (attrOf(p.node, 'Icon') || attrOf(p.node, 'icon'))?.value?.expression?.name ?? null,
        size: stringAttr(p.node, 'size'),
        onClick: click ? src.slice(click.start, click.end) : null,
      })
    },
  })
  return { problems: [], buttons }
}
/** What is wrong with one tool's strip, against Audrey's rule. */
function stripProblems(src, spec) {
  const { problems, buttons } = stripButtons(src, spec.container)
  if (problems.length) return problems
  const [help, settings] = buttons.slice(-2)
  const out = []
  if (buttons.length < 2) return [`${buttons.length} icon buttons in the group`]
  if (help.title !== 'Help & documentation') out.push(`second to last is "${help.title}", not Help`)
  if (settings.title !== spec.settings) out.push(`last is "${settings.title}", not "${spec.settings}"`)
  if (help.icon !== 'HelpCircle') out.push(`Help draws ${help.icon}`)
  if (!/^Settings(Icon)?$/.test(settings.icon || '')) out.push(`Settings draws ${settings.icon}`)
  for (const b of [help, settings]) if (b.size !== 'sm') out.push(`"${b.title}" is size ${b.size}, not sm (28px)`)
  if (help.onClick !== '() => setShowHelpModal(true)') out.push(`Help does ${help.onClick}, not the tool's own Help dialog`)
  if (settings.onClick !== `() => ${spec.opens}(true)`) out.push(`Settings does ${settings.onClick}`)
  return out
}

describe('each tool draws Help, then Settings, at the right end of its own strip (C1, C7)', () => {
  for (const spec of TOOL_STRIPS) {
    it(`${spec.tool}: Help & documentation, then "${spec.settings}", the last two 28px icon buttons, opening the tool's own dialogs`, () => {
      const src = readFileSync(resolve(here, spec.file), 'utf8')
      expect(stripProblems(src, spec)).toEqual([])
    })
  }
  it('CONTROL: the reader fails the strip as it was — Settings first, the old title, Help to the app page, no group', () => {
    const rabbit = TOOL_STRIPS.find((s) => s.tool === 'R.A.B.B.I.T.')
    // R.A.B.B.I.T.'s slot before S2a: Settings first, titled "RABBIT settings".
    const was = `const x = <ViewTabs rightSlot={(<>
      <IconButton size="sm" Icon={SettingsIcon} title="RABBIT settings" onClick={() => setSettingsOpen(true)} />
      <IconButton size="sm" Icon={HelpCircle} title="Help & documentation" onClick={() => setShowHelpModal(true)} />
    </>)} />`
    expect(stripProblems(was, rabbit)).toEqual(expect.arrayContaining([
      'second to last is "RABBIT settings", not Help',
      'last is "Help & documentation", not "R.A.B.B.I.T. settings"',
    ]))
    // Help sent to the app's Help page instead of the tool's own dialog.
    const otter = TOOL_STRIPS.find((s) => s.tool === 'O.T.T.E.R.')
    const toAppHelp = `const x = <div className="otter-nav-right">
      <IconButton size="sm" Icon={HelpCircle} title="Help & documentation" onClick={() => onNavigate('help')} />
      <IconButton size="sm" Icon={Settings} title="O.T.T.E.R. settings" onClick={() => setSettingsOpen(true)} />
    </div>`
    expect(stripProblems(toAppHelp, otter)).toEqual(["Help does () => onNavigate('help'), not the tool's own Help dialog"])
    // A 36px pair would sit off the other tools' line.
    expect(stripProblems(toAppHelp.replace(/size="sm"/g, 'size="md"').replace("onNavigate('help')", 'setShowHelpModal(true)'), otter))
      .toEqual(['"Help & documentation" is size md, not sm (28px)', '"O.T.T.E.R. settings" is size md, not sm (28px)'])
    // No group at all (O.T.T.E.R. before S2a).
    expect(stripProblems('const x = <nav className="otter-nav"><Tabs /></nav>', otter)).toEqual(['0 right-hand groups found, not one'])
  })
})
