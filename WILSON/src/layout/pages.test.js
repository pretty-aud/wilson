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

  it('renames the two colliding SETTINGS items (Q7, ruled); the tool half has left the strip (S2a, C6)', () => {
    expect(PAGE_BY_ID.settings.navLabel).toBe('App settings')
    expect(PAGE_BY_ID.settings.title).toBe('App settings')
    expect(appSrc).not.toContain("label: 'SYSTEM SETTINGS'")
    expect(appSrc).not.toContain("label: 'SETTINGS'")
    // Post-overhaul S2a (Audrey's C6, 2026-09-29): "Tool settings" left the
    // nav strip for all three tools. Each tool's gear is in its own bar (the
    // block at the foot of this file); nothing in the shell builds the item
    // or opens a tool's settings any more, and no tool listens for it.
    expect(shellSettingsPlumbing(appSrc)).toEqual([])
    for (const spec of TOOL_STRIPS) {
      expect(shellSettingsPlumbing(readFileSync(resolve(here, spec.file), 'utf8'), { tool: true }), spec.tool).toEqual([])
    }
    // CONTROL: the shell keeps its own nav-strip state, which a TOOL may not
    // take as a prop (D.O.G.'s two dead props).
    expect(appSrc).toMatch(/const \[showNavMenu, setShowNavMenu\] = useState\(false\)/)
  })
  it('CONTROL: the plumbing reader finds the item, each counter, the setter path and a tool\'s effect, and skips a comment', () => {
    const was = [
      "      tail.push({ label: 'Tool settings', action: () => closeNavAndTrigger(toolSettingsTrigger) });",
      '  const [openOtterSettingsTrigger, setOpenOtterSettingsTrigger] = useState(0);',
      '          openSettingsTrigger={openRabbitSettingsTrigger}',
      'export default function DeckOutlineGenerator({ onNavigate, showNavMenu, onToggleNavMenu, zoomLevel = 0 }) {',
      '  const prevSettingsTrigger = useRef(openSettingsTrigger);',
      '  // the old `openSettingsTrigger` counter and its "Tool settings" item',
    ].join('\n')
    expect(shellSettingsPlumbing(was, { tool: true })).toEqual([
      "'Tool settings'", 'closeNavAndTrigger', 'toolSettingsTrigger',
      'openOtterSettingsTrigger', 'setOpenOtterSettingsTrigger',
      'openSettingsTrigger', 'openRabbitSettingsTrigger',
      'showNavMenu', 'onToggleNavMenu',
      'prevSettingsTrigger', 'openSettingsTrigger',
    ])
    // In the shell, `showNavMenu` is the strip's own open state, not plumbing.
    expect(shellSettingsPlumbing('const [showNavMenu, setShowNavMenu] = useState(false);')).toEqual([])
  })

  // UI overhaul P1, review round two (R2-06): the rename reached the nav and
  // Help, but an empty state still sent people to "System settings → RABBIT"
  // and both companion prompts named "System Settings" and "PROJECT
  // MANAGER". No string the app draws, or tells a companion, names a page or
  // tab by its retired name. Comments may keep the history; the dev fixtures
  // are exempt because their course quotes DaVinci Resolve's own "Project
  // Manager" menu. Post-overhaul S2a: "Tool settings" is retired too — the
  // nav item left the strip (C6) and O.T.T.E.R.'s drawer tab of that name is
  // "Storage & data" — so no string can send anyone looking for it.
  const RETIRED = /System [Ss]ettings|SYSTEM SETTINGS|Project Manager|PROJECT MANAGER|RABBIT tab|Tool [Ss]ettings|TOOL SETTINGS/
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
      "items={[{ id: 'prompts', label: 'System prompts' }, { id: 'tools', label: 'Tool settings' }]}",
      '// the old Tool settings tab',
    ].join('\n')
    expect(retiredIn(planted)).toEqual([
      "const b = 'Open System settings → RABBIT'",
      'context += `- PROJECT MANAGER: documents`',
      '<p>Change it in System Settings.</p>',
      "items={[{ id: 'prompts', label: 'System prompts' }, { id: 'tools', label: 'Tool settings' }]}",
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
// Per tool: its strip (the element, or R.A.B.B.I.T.'s ViewTabs slot), the
// group at its right end, the Settings title and setter, where the Help and
// Settings state is DRAWN (so a button cannot open something else under the
// right name), and the exact props at its render site and in its signature
// (review round 1, G-R1-01/02: a new name for the old plumbing passed).
const TOOL_STRIPS = [
  {
    tool: 'D.O.G.', file: '../tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx',
    strip: { className: 'dog-outline-bar', group: 'dog-outline-right' }, settings: 'D.O.G. settings', opens: 'setShowSettingsMenu',
    helpState: /const \[showHelpModal, setShowHelpModal\] = useState\(false\)/,
    settingsState: /const \[showSettingsMenu, setShowSettingsMenu\] = useState\(false\)/,
    helpMount: /\{showHelpModal && \(\s*<Dialog\s+title="Help & documentation"/,
    settingsMount: /<Drawer\s+open=\{showSettingsMenu\}[\s\S]{0,300}?className="dog-settings-drawer"/,
    site: 'DeckOutlineGenerator', siteAttrs: ['onNavigate', 'currentPage', 'zoomLevel'], props: ['onNavigate', 'currentPage', 'zoomLevel'],
  },
  {
    tool: 'O.T.T.E.R.', file: '../tools/otter_v0.3.1/Otter.jsx',
    strip: { className: 'otter-nav', group: 'otter-nav-right' }, settings: 'O.T.T.E.R. settings', opens: 'setSettingsOpen',
    helpState: /const \[showHelpModal, setShowHelpModal\] = useState\(false\)/,
    settingsState: /const \[settingsOpen, setSettingsOpen\] = useState\(false\)/,
    helpMount: /\{showHelpModal && \(\s*<Dialog\s+title="Help & documentation"/,
    settingsMount: /\{settingsOpen && renderSettingsPanel\(\)\}[\s\S]*function renderSettingsPanel\(\) \{[\s\S]{0,900}?<Drawer[\s\S]{0,300}?className="otter-settings-drawer"/,
    site: 'Otter', siteAttrs: ['onNavigate', 'currentPage', 'onContextChange'], props: ['onNavigate', 'currentPage', 'onContextChange'],
  },
  {
    tool: 'R.A.B.B.I.T.', file: '../tools/rabbit_v0.1.0/Rabbit.jsx',
    strip: { slotOf: 'ViewTabs', prop: 'rightSlot' }, settings: 'R.A.B.B.I.T. settings', opens: 'setSettingsOpen',
    helpState: /const \[showHelpModal, setShowHelpModal\] = useState\(false\)/,
    settingsState: /const \[settingsOpen, setSettingsOpen\] = useState\(false\)/,
    helpMount: /\{showHelpModal && \(\s*<HelpModal\b/,
    settingsMount: /\{settingsOpen && \(\s*<SettingsPanel\b/,
    site: 'Rabbit', siteAttrs: ['onNavigate', 'isActive', 'currentPage'], props: ['currentPage'],
  },
]
// Everything that built the tool half of the nav strip or carried it into a
// tool (S2a, C6), read from code with its comments blanked — history may stay
// in a comment. `tool` adds the nav-menu state as a PROP: D.O.G. took it and
// its toggle and read neither; the shell still owns it as its own state.
const PLUMBING = /'Tool settings'|"Tool settings"|\bcloseNavAndTrigger\b|\btoolSettingsTrigger\b|\b(?:set)?[oO]pen(?:Otter|Rabbit)?SettingsTrigger\b|\bprevSettingsTrigger\b|\bonToggleNavMenu\b/
function shellSettingsPlumbing(src, { tool = false } = {}) {
  const re = new RegExp(PLUMBING.source + (tool ? '|\\bshowNavMenu\\b' : ''), 'g')
  return blankJsComments(src).match(re) || []
}
const traverse = traverseModule.default || traverseModule
const attrOf =(el, name) => el.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === name)
const stringAttr = (el, name) => {
  const a = attrOf(el, name)
  if (!a?.value) return null
  if (a.value.type === 'StringLiteral') return a.value.value
  if (a.value.type === 'JSXExpressionContainer' && a.value.expression.type === 'StringLiteral') return a.value.expression.value
  return null
}
const nameOf = (el) => el.openingElement.name.name
const classesOf = (el) => (stringAttr(el, 'className') || '').split(/\s+/).filter(Boolean)
const jsxChildren = (el) => el.children.filter((c) => c.type === 'JSXElement')
// What a person can operate: the kit's controls, the native ones, anything
// with a handler of its own.
const INTERACTIVE = new Set(['IconButton', 'Button', 'button', 'a', 'input', 'select', 'textarea', 'Chip', 'Switch', 'Link', 'Menu'])
const operable = (el) => INTERACTIVE.has(nameOf(el))
  || el.openingElement.attributes.some((a) => a.type === 'JSXAttribute' && /^on[A-Z]/.test(a.name.name))
/** The right-hand group of a tool's strip and every operable element in it,
    in source order. The group must be the strip's LAST element (its right
    end) and the strip's own child (not inside the kit Tabs, not in an
    `items` label). Problems come back as strings. */
function stripGroup(src, strip) {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
  const problems = []
  let group = null
  if (strip.className) {
    const strips = []
    const groups = []
    traverse(ast, {
      JSXElement(p) {
        if (classesOf(p.node).includes(strip.className)) strips.push(p)
        if (classesOf(p.node).includes(strip.group)) groups.push(p)
      },
    })
    if (strips.length !== 1) return { problems: [`${strips.length} .${strip.className} strips, not one`], controls: [] }
    if (groups.length !== 1) return { problems: [`${groups.length} .${strip.group} groups, not one`], controls: [] }
    const kids = jsxChildren(strips[0].node)
    if (kids[kids.length - 1] !== groups[0].node) problems.push(`.${strip.group} is not the last element of .${strip.className}`)
    group = groups[0]
  } else {
    const slots = []
    traverse(ast, {
      JSXElement(p) {
        if (nameOf(p.node) !== strip.slotOf) return
        const slot = attrOf(p.node, strip.prop)
        if (slot?.value?.type === 'JSXExpressionContainer') slots.push(p.get('openingElement').get('attributes').find((a) => a.node === slot))
      },
    })
    if (slots.length !== 1) return { problems: [`${slots.length} ${strip.slotOf} ${strip.prop} slots, not one`], controls: [] }
    group = slots[0]
  }
  const controls = []
  group.traverse({
    JSXElement(p) {
      if (!operable(p.node)) return
      const attrs = p.node.openingElement.attributes
      const click = attrOf(p.node, 'onClick')?.value?.expression
      controls.push({
        name: nameOf(p.node),
        title: stringAttr(p.node, 'title'),
        icon: (attrOf(p.node, 'Icon') || attrOf(p.node, 'icon'))?.value?.expression?.name ?? null,
        size: stringAttr(p.node, 'size'),
        onClick: click ? src.slice(click.start, click.end) : null,
        spread: attrs.some((a) => a.type === 'JSXSpreadAttribute'),
        handlers: attrs.filter((a) => a.type === 'JSXAttribute' && /^on[A-Z]/.test(a.name.name)).map((a) => a.name.name),
        inTabs: !!p.findParent((q) => q.isJSXElement() && nameOf(q.node) === 'Tabs'),
      })
    },
  })
  return { problems, controls }
}
/** What is wrong with one tool's strip, against Audrey's rule. */
function stripProblems(src, spec) {
  const { problems, controls } = stripGroup(src, spec.strip)
  if (problems.length && !controls.length) return problems
  const out = [...problems]
  if (controls.length !== 2) out.push(`${controls.length} operable controls in the group, not 2: ${controls.map((c) => c.title || c.name).join(', ')}`)
  const [help, settings] = controls.slice(-2)
  if (!help || !settings) return out
  if (help.title !== 'Help & documentation') out.push(`second to last is "${help.title}", not Help`)
  if (settings.title !== spec.settings) out.push(`last is "${settings.title}", not "${spec.settings}"`)
  for (const b of [help, settings]) {
    if (b.name !== 'IconButton') out.push(`"${b.title}" is a ${b.name}, not the kit IconButton`)
    if (b.size !== 'sm') out.push(`"${b.title}" is size ${b.size}, not sm (28px)`)
    if (b.spread) out.push(`"${b.title}" takes a spread of props`)
    if (b.handlers.join() !== 'onClick') out.push(`"${b.title}" has handlers ${b.handlers.join(', ')}`)
    if (b.inTabs) out.push(`"${b.title}" sits inside the kit Tabs`)
  }
  if (help.icon !== 'HelpCircle') out.push(`Help draws ${help.icon}`)
  if (!/^Settings(Icon)?$/.test(settings.icon || '')) out.push(`Settings draws ${settings.icon}`)
  if (help.onClick !== '() => setShowHelpModal(true)') out.push(`Help does ${help.onClick}, not the tool's own Help dialog`)
  if (settings.onClick !== `() => ${spec.opens}(true)`) out.push(`Settings does ${settings.onClick}`)
  // …and those two setters draw what their names say: the tool's own Help
  // dialog and its settings drawer (comments blanked, so a commented-out
  // mount cannot pass).
  const code = blankJsComments(src)
  for (const [what, re] of [['Help state', spec.helpState], ['Settings state', spec.settingsState], ['Help dialog', spec.helpMount], ['settings drawer', spec.settingsMount]]) {
    if (!re.test(code)) out.push(`the ${what} is not where it should be`)
  }
  return out
}
/** Every JSX render site of a component: its attribute names, and whether
    any is a spread. */
function renderSites(src, component) {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
  const sites = []
  traverse(ast, {
    JSXElement(p) {
      if (nameOf(p.node) !== component) return
      const attrs = p.node.openingElement.attributes
      sites.push({ attrs: attrs.filter((a) => a.type === 'JSXAttribute').map((a) => a.name.name), spread: attrs.some((a) => a.type === 'JSXSpreadAttribute') })
    },
  })
  return sites
}
/** The names a component's default export destructures from its props. */
function propsOf(src) {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
  let names = null
  traverse(ast, {
    ExportDefaultDeclaration(p) {
      const param = p.node.declaration?.params?.[0]
      const pattern = param?.type === 'AssignmentPattern' ? param.left : param
      if (pattern?.type === 'ObjectPattern') names = pattern.properties.map((q) => (q.type === 'RestElement' ? '...rest' : q.key.name))
    },
  })
  return names
}
/** getNavStripItems: what it pushes into its tail, and the rows it returns. */
function navStripShape(src) {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
  let fn = null
  traverse(ast, { VariableDeclarator(p) { if (p.node.id.name === 'getNavStripItems') fn = p } })
  if (!fn) return null
  const pushes = []
  const labels = []
  fn.traverse({
    CallExpression(p) {
      const c = p.node.callee
      if (c.type === 'MemberExpression' && c.property.name === 'push') pushes.push(src.slice(c.object.start, c.object.end))
    },
    ObjectProperty(p) {
      if (p.node.key.name === 'label' || p.node.key.value === 'label') labels.push(src.slice(p.node.value.start, p.node.value.end))
    },
  })
  const ret = []
  fn.traverse({ ReturnStatement(p) { ret.push(src.slice(p.node.argument.start, p.node.argument.end)) } })
  return { pushes, labels, ret }
}

describe('each tool draws Help, then Settings, at the right end of its own strip (C1, C7)', () => {
  for (const spec of TOOL_STRIPS) {
    it(`${spec.tool}: Help & documentation, then "${spec.settings}" — the strip's last two controls, 28px kit IconButtons, opening the tool's own dialog and drawer`, () => {
      const src = readFileSync(resolve(here, spec.file), 'utf8')
      expect(stripProblems(src, spec)).toEqual([])
    })
  }
  it('R.A.B.B.I.T.: ViewTabs draws its right-hand slot as the strip\'s last element, beside the kit Tabs, not in it', () => {
    const view = blankJsComments(readFileSync(resolve(here, '../tools/rabbit_v0.1.0/components/ViewTabs.jsx'), 'utf8'))
    // (a blanked JSX comment leaves an empty `{ }` behind)
    expect(view).toMatch(/<div className="rb-viewtabs">\s*<Tabs[\s\S]*?\/>\s*(?:\{\s*\}\s*)*\{rightSlot && <div className="rb-viewtabs-right">\{rightSlot\}<\/div>\}\s*<\/div>/)
  })
  it('D.O.G.: the bar\'s left group is the label and the four history controls, with their handlers unchanged', () => {
    const src = readFileSync(resolve(here, TOOL_STRIPS[0].file), 'utf8')
    const { problems, controls } = stripGroup(src, { className: 'dog-outline-bar', group: 'dog-outline-right' })
    expect(problems).toEqual([])
    expect(controls).toHaveLength(2)
    const left = stripGroup(src.replace('className="dog-outline-group"', 'className="dog-outline-group dog-probe-left"'), { className: 'dog-outline-bar', group: 'dog-probe-left' })
    expect(left.controls.map((c) => [c.title, c.icon, c.onClick])).toEqual([
      ['Undo delete', 'Undo2', 'undoHistoryDelete'],
      ['Redo delete', 'Redo2', 'redoHistoryDelete'],
      ['Import/export history', 'FolderUp', '() => setShowHistoryModal(true)'],
      ['Clear history', 'Trash2', 'clearHistory'],
    ])
    expect(blankJsComments(src)).toMatch(/<div className="dog-outline-group" role="group" aria-labelledby="dog-outline-label">\s*<span id="dog-outline-label" className="dog-toolbar-label dog-outline-label">Deck outline<\/span>/)
  })
  it('CONTROL: the reader fails the strip as it was, and each way the first cut let through', () => {
    const [dog, otter, rabbit] = TOOL_STRIPS
    // R.A.B.B.I.T.'s slot before S2a: Settings first, titled "RABBIT settings".
    const was = `const x = <ViewTabs rightSlot={(<>
      <IconButton size="sm" Icon={SettingsIcon} title="RABBIT settings" onClick={() => setSettingsOpen(true)} />
      <IconButton size="sm" Icon={HelpCircle} title="Help & documentation" onClick={() => setShowHelpModal(true)} />
    </>)} />`
    expect(stripProblems(was, rabbit)).toEqual(expect.arrayContaining([
      'second to last is "RABBIT settings", not Help',
      'last is "Help & documentation", not "R.A.B.B.I.T. settings"',
    ]))
    const pair = (help = "onClick={() => setShowHelpModal(true)}", extra = '') => `
      <IconButton size="sm" Icon={HelpCircle} title="Help & documentation" ${help} />
      <IconButton size="sm" Icon={Settings} title="O.T.T.E.R. settings" onClick={() => setSettingsOpen(true)} />${extra}`
    const nav = (inner) => `const x = <nav className="otter-nav"><Tabs /><div className="otter-nav-right">${inner}</div></nav>`
    // Help sent to the app's Help page.
    expect(stripProblems(nav(pair("onClick={() => onNavigate('help')}")), otter)).toEqual(expect.arrayContaining(["Help does () => onNavigate('help'), not the tool's own Help dialog"]))
    // A spread that swaps the handler behind the right text.
    expect(stripProblems(nav(pair("onClick={() => setShowHelpModal(true)} {...{ onClick: () => onNavigate('help') }}")), otter)).toEqual(expect.arrayContaining(['"Help & documentation" takes a spread of props']))
    // A third control after Settings.
    expect(stripProblems(nav(pair(undefined, '<Button onClick={exportAll}>Export</Button>')), otter)).toEqual(expect.arrayContaining(['3 operable controls in the group, not 2: Help & documentation, O.T.T.E.R. settings, Button']))
    // The group moved into the kit Tabs (a tab, and gone from the right end).
    const inTabs = `const x = <nav className="otter-nav"><Tabs><div className="otter-nav-right">${pair()}</div></Tabs></nav>`
    expect(stripProblems(inTabs, otter)).toEqual(expect.arrayContaining(['.otter-nav-right is not the last element of .otter-nav', '"Help & documentation" sits inside the kit Tabs']))
    // D.O.G.'s group moved into "Generated output"'s head.
    const moved = `const x = <><div className="dog-outline-bar"><div className="dog-outline-group" /></div><header className="dog-card-head"><div className="dog-outline-right">${pair().replace('O.T.T.E.R.', 'D.O.G.').replace('setSettingsOpen', 'setShowSettingsMenu')}</div></header></>`
    expect(stripProblems(moved, dog)).toEqual(expect.arrayContaining(['.dog-outline-right is not the last element of .dog-outline-bar']))
    // No group at all (O.T.T.E.R. before S2a).
    expect(stripProblems('const x = <nav className="otter-nav"><Tabs /></nav>', otter)).toEqual(['0 .otter-nav-right groups, not one'])
    // A mount that is commented out does not count.
    expect(stripProblems(`${nav(pair())}\n// {showHelpModal && (<Dialog title="Help & documentation" />)}`, otter)).toEqual(expect.arrayContaining(['the Help dialog is not where it should be']))
  })
})

describe('the nav strip\'s tail is Resources and App settings, and nothing carries a tool\'s settings to it (C6)', () => {
  it('getNavStripItems pushes exactly two tail rows — the Resources toggle and App settings — and returns primary pages, one separator, the tail', () => {
    const shape = navStripShape(appSrc)
    expect(shape, 'no getNavStripItems in App.jsx').not.toBeNull()
    expect(shape.pushes).toEqual(['tail', 'tail'])
    expect(shape.labels).toEqual(['p.navLabel', "'Resources'", 'appSettings.navLabel'])
    expect(shape.ret).toEqual(['[...items, { separator: true }, ...tail]'])
  })
  it('each tool is rendered with exactly the props it reads, and reads exactly those', () => {
    for (const spec of TOOL_STRIPS) {
      const sites = renderSites(appSrc, spec.site)
      expect(sites, spec.site).toHaveLength(1)
      expect(sites[0].spread, spec.site).toBe(false)
      expect([...sites[0].attrs].sort(), spec.site).toEqual([...spec.siteAttrs].sort())
      expect(propsOf(readFileSync(resolve(here, spec.file), 'utf8')), spec.tool).toEqual(spec.props)
    }
  })
  it('no string, wrapped over lines or not, in any case, names "Tool settings" (comments may keep the history)', () => {
    const files = sourceFiles().filter((f) => !f.startsWith('src/dev/'))
    const hits = files.filter((f) => /tool\s+settings/i.test(blankJsComments(readFileSync(f, 'utf8'))))
    expect(hits).toEqual([])
  })
  it('the three settings drawers keep their footer Help, titled as the strip\'s', () => {
    const code = (f) => blankJsComments(readFileSync(resolve(here, f), 'utf8'))
    expect(code(TOOL_STRIPS[0].file)).toMatch(/<div className="dog-settings-foot">[\s\S]{0,400}?title="Help & documentation" onClick=\{\(\) => setShowHelpModal\(true\)\}/)
    expect(code(TOOL_STRIPS[1].file)).toMatch(/<div className="otter-settings-foot">[\s\S]{0,400}?title="Help & documentation" onClick=\{\(\) => setShowHelpModal\(true\)\}/)
    expect(code('../tools/rabbit_v0.1.0/views/TimelineView.jsx')).toMatch(/onClick=\{onOpenHelp\}\s*title="Help & documentation"/)
  })
  it('CONTROL: the shape reader, the site reader and the wrapped-text check each fire on a renamed return of the item', () => {
    const renamed = `const getNavStripItems = () => {
      const items = primary.map(p => ({ label: p.navLabel }));
      const tail = [];
      if (isToolPage) tail.push({ label: 'Settings', action: () => setToolSettingsNonce(n => n + 1) });
      tail.push({ label: 'Resources', isResourcesTrigger: true });
      tail.push({ label: appSettings.navLabel });
      return [...items, { separator: true }, ...tail];
    };`
    expect(navStripShape(renamed).pushes).toEqual(['tail', 'tail', 'tail'])
    expect(navStripShape(renamed).labels).toContain("'Settings'")
    expect(renderSites('const x = <Otter onNavigate={go} currentPage={p} onContextChange={c} settingsNonce={n} />', 'Otter')[0].attrs).toContain('settingsNonce')
    expect(renderSites('const x = <Otter {...props} />', 'Otter')[0].spread).toBe(true)
    expect(propsOf('export default function Otter({ onNavigate, currentPage, onContextChange, settingsNonce = 0 }) {}')).toContain('settingsNonce')
    expect(/tool\s+settings/i.test('<p>Open Tool\n        settings</p>')).toBe(true)
  })
})
