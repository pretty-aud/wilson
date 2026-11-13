/** @vitest-environment jsdom */
// =============================================================================
// rabbitLive.test.jsx — the eight pieces of R.A.B.B.I.T.'s state that move on
// their own clock, out of the provider's one value (F4, 2026-11-13).
//
// Two halves.
//
// 1. THE SOURCE. The value still carries the eight, as getters, and a getter
//    tells nobody: a component that reads `ctx.presentUsers` while it draws
//    compiles, looks right on the first render, and is never drawn again for
//    it. Nothing at run time catches that, so this file reads every source
//    file under src and holds two things: nobody reads one of the eight off an
//    object (`x.undoToast`, `x?.undoToast`) or takes one out of the provider's
//    value by destructuring, outside the provider and rabbitLive.js; and the
//    readers through useRabbitLive are exactly the ones listed here.
//
// 2. THE MODULE. What each hook answers with a provider above and without one
//    (the 54 test files that stand in for the provider have none above), and
//    what the getters are.
//
// Who is DRAWN when one of the eight changes is volatileState.rerender.test.jsx
// (the real provider on the dev fixtures, the real shell under it).
// =============================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'
import {
  LIVE_NAMES, SHOWN_NAMES, useRabbitLive, withRabbitLive, liveGetters, useRabbitProjects, withRabbitProjects,
} from './rabbitLive'

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', '..', '..')

const EIGHT = ['adapterStatus', 'undoToast', 'activeIngestion', 'ingestionRun', 'realtimeStatus', 'presentUsers', 'workspaceRealtimeStatus', 'workspacePresentUsers']

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { sourceFiles(full, out); continue }
    if (!/\.(js|jsx)$/.test(name) || /\.test\.(js|jsx)$/.test(name)) continue
    out.push(full)
  }
  return out
}
const slashed = (full) => relative(SRC, full).split(sep).join('/')
/** The code without its comments. (A `//` inside a string goes too: more is taken out than need be, never less.) */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const FILES = sourceFiles(SRC).map((full) => ({ path: slashed(full), code: code(readFileSync(full, 'utf8')) }))
const THE_TWO = new Set(['tools/rabbit_v0.1.0/state/RabbitProvider.jsx', 'tools/rabbit_v0.1.0/state/rabbitLive.js'])

describe('the source: nobody reads one of the eight off the value', () => {
  it('the eight are the module\'s eight, and seven of them have a context (activeIngestion is shown by nothing)', () => {
    expect([...LIVE_NAMES]).toEqual(EIGHT)
    expect([...SHOWN_NAMES]).toEqual(EIGHT.filter((name) => name !== 'activeIngestion'))
  })

  it('reads the tree it means to: several hundred source files, the provider among them', () => {
    expect(FILES.length).toBeGreaterThan(300)
    for (const path of THE_TWO) expect(FILES.some((f) => f.path === path), path).toBe(true)
  })

  it('no member read of one of the eight (x.name, x?.name) in any source file but the provider and rabbitLive.js', () => {
    const member = new RegExp(`\\??\\.\\s*(${EIGHT.join('|')})\\b`, 'g')
    const found = []
    for (const file of FILES) {
      if (THE_TWO.has(file.path)) continue
      for (const m of file.code.matchAll(member)) found.push(`${file.path}: ${m[0]}`)
    }
    // Each one would be a read that is never drawn again: read it with useRabbitLive('<name>', ctx) (state/rabbitLive.js).
    expect(found).toEqual([])
  })

  it('no one of the eight is taken out of the value by destructuring', () => {
    const taken = new RegExp(`\\{[^{}]*\\b(${EIGHT.join('|')})\\b[^{}]*\\}\\s*=\\s*(useRabbit\\(\\)|ctx|rabbit|rabbitCtx)\\b`, 'g')
    const found = []
    for (const file of FILES) {
      if (THE_TWO.has(file.path)) continue
      for (const m of file.code.matchAll(taken)) found.push(`${file.path}: ${m[0].replace(/\s+/g, ' ')}`)
    }
    expect(found).toEqual([])
  })

  it('the readers through useRabbitLive are these, each with the names it shows', () => {
    const call = /useRabbitLive\(\s*'([A-Za-z]+)'/g
    const readers = {}
    for (const file of FILES) {
      if (file.path === 'tools/rabbit_v0.1.0/state/rabbitLive.js') continue
      const names = [...file.code.matchAll(call)].map((m) => m[1])
      if (names.length > 0) readers[file.path] = [...new Set(names)].sort()
    }
    expect(readers).toEqual({
      'components/AdminTerminal/DiagnosticsSection.jsx':  ['adapterStatus', 'workspaceRealtimeStatus'],
      'components/Budget/useBudgetLines.js':              ['adapterStatus'],
      'components/Budget/useProjectRateOverrides.js':     ['adapterStatus'],
      'components/Dashboard/DashboardPage.jsx':           ['workspacePresentUsers', 'workspaceRealtimeStatus'],
      'components/Expenses/useExpenses.js':               ['adapterStatus'],
      'components/RateCard/useRateCard.js':               ['adapterStatus'],
      'components/SettingsPage.jsx':                      ['adapterStatus'],
      'components/TaskTemplates/useTaskTemplates.js':     ['adapterStatus'],
      'components/TeamMembers/useTeamMembers.js':         ['adapterStatus'],
      'tools/rabbit_v0.1.0/Rabbit.jsx':                   ['presentUsers', 'realtimeStatus'],
      'tools/rabbit_v0.1.0/components/ConnectionDot.jsx': ['adapterStatus', 'realtimeStatus'],
      'tools/rabbit_v0.1.0/components/IngestionToast.jsx': ['ingestionRun'],
      'tools/rabbit_v0.1.0/components/UndoToast.jsx':     ['undoToast'],
      'tools/rabbit_v0.1.0/views/intake/IntakeProgress.jsx': ['ingestionRun'],
    })
    // Every name asked for is one that has a context (a typo would throw at the first render, in the app).
    for (const names of Object.values(readers)) for (const name of names) expect(SHOWN_NAMES, name).toContain(name)
  })

  it('the provider: none of the eight is a dep of the value, and all of them are provided beside it', () => {
    const provider = FILES.find((f) => f.path === 'tools/rabbit_v0.1.0/state/RabbitProvider.jsx').code
    const from = provider.indexOf('const value = useMemo(() => liveGetters({')
    const to = provider.indexOf('const projects = useMemo(')
    expect(from).toBeGreaterThan(0)
    expect(to).toBeGreaterThan(from)
    const value = provider.slice(from, to)
    for (const name of EIGHT) expect(value, name).not.toMatch(new RegExp(`\\b${name}\\b`))
    expect(value).toMatch(/\}, liveRef\), \[/)
    // The eight, in one object written to the ref as the provider renders, and handed to the seven contexts.
    const live = provider.slice(provider.indexOf('const live = {'), from)
    for (const name of EIGHT) expect(live, name).toMatch(new RegExp(`\\b${name}\\b`))
    expect(live).toMatch(/const liveRef = useRef\(live\);\s*liveRef\.current = live;/)
    expect(provider).toMatch(/\{withRabbitProjects\(projects, withRabbitLive\(live, children\)\)\}/)
  })

  it('D.O.G. reads its six through useRabbitProjects, with the provider\'s hook handed over and not called', () => {
    const dog = FILES.find((f) => f.path === 'tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx').code
    expect(dog).toContain('const rabbitCtx = useRabbitProjects(useRabbit);')
    expect(dog).not.toMatch(/useRabbit\(\)/)
    // The six it reads are the six the provider keeps for it.
    const read = [...new Set([...dog.matchAll(/rabbitCtx\?\.([A-Za-z]+)/g)].map((m) => m[1]))].sort()
    expect(read).toEqual(['adapterMode', 'createProject', 'getAdapter', 'projectsIndex', 'refreshProjectsIndex', 'updateProject'])
  })
})

// ── The module ───────────────────────────────────────────────────────────────
function show(ui) {
  const seen = { value: undefined, renders: 0 }
  const view = render(ui(seen))
  return { seen, view }
}
function Reads({ name, ctx, seen }) { seen.value = useRabbitLive(name, ctx); seen.renders++; return null }
const LIVE = () => ({
  adapterStatus: { online: true, lastSyncAt: null, error: null }, undoToast: null, activeIngestion: null, ingestionRun: null,
  realtimeStatus: 'live', presentUsers: [{ user_id: 'u-2', label: 'Mara Lind' }], workspaceRealtimeStatus: 'off', workspacePresentUsers: [],
})

describe('useRabbitLive', () => {
  it('with no provider above, answers from the caller\'s own ctx: the expression the reader held before', () => {
    const ctx = { presentUsers: ['from the stand-in'], undoToast: null }
    expect(show((seen) => <Reads name="presentUsers" ctx={ctx} seen={seen} />).seen.value).toBe(ctx.presentUsers)
    expect(show((seen) => <Reads name="undoToast" ctx={ctx} seen={seen} />).seen.value).toBeNull()
    expect(show((seen) => <Reads name="realtimeStatus" ctx={ctx} seen={seen} />).seen.value).toBeUndefined()
    expect(show((seen) => <Reads name="realtimeStatus" ctx={null} seen={seen} />).seen.value).toBeUndefined()
    expect(show((seen) => <Reads name="realtimeStatus" seen={seen} />).seen.value).toBeUndefined()
  })

  it('with the provider above, answers from it, whatever the ctx says; null is an answer and not "absent"', () => {
    const live = LIVE()
    const stale = { presentUsers: ['stale'], undoToast: { message: 'stale' }, realtimeStatus: 'off' }
    expect(show((seen) => withRabbitLive(live, <Reads name="presentUsers" ctx={stale} seen={seen} />)).seen.value).toBe(live.presentUsers)
    expect(show((seen) => withRabbitLive(live, <Reads name="undoToast" ctx={stale} seen={seen} />)).seen.value).toBeNull()
    expect(show((seen) => withRabbitLive(live, <Reads name="realtimeStatus" ctx={stale} seen={seen} />)).seen.value).toBe('live')
    expect(show((seen) => withRabbitLive(live, <Reads name="adapterStatus" seen={seen} />)).seen.value).toBe(live.adapterStatus)
  })

  it('a reader is drawn again when ITS one changes, and not when another of the seven does', () => {
    const live = LIVE()
    const { seen, view } = show((s) => withRabbitLive(live, <Reads name="presentUsers" seen={s} />))
    const child = <Reads name="presentUsers" seen={seen} />
    view.rerender(withRabbitLive(live, child))
    const settled = seen.renders
    view.rerender(withRabbitLive({ ...live, realtimeStatus: 'error', undoToast: { message: 'x' }, ingestionRun: { phase: 'running' } }, child))
    view.rerender(withRabbitLive({ ...live, adapterStatus: { online: false }, workspaceRealtimeStatus: 'live', workspacePresentUsers: [1] }, child))
    expect(seen.renders).toBe(settled)                    // six others moved: not drawn
    const people = [{ user_id: 'u-3', label: 'Ines Okoro' }]
    view.rerender(withRabbitLive({ ...live, presentUsers: people }, child))
    expect(seen.renders).toBe(settled + 1)
    expect(seen.value).toBe(people)
  })

  it('a name that has no context throws where it is asked for (a typo, or activeIngestion, which nothing shows)', () => {
    const quiet = console.error
    console.error = () => {}
    try {
      expect(() => render(<Reads name="presentUser" seen={{}} />)).toThrow(/presentUser is not one of/)
      expect(() => render(<Reads name="activeIngestion" seen={{}} />)).toThrow(/activeIngestion is not one of/)
    } finally { console.error = quiet }
  })
})

describe('liveGetters: the eight as fields of the value still', () => {
  it('each answers from the ref when it is ASKED, so a value object made earlier is never behind', () => {
    const ref = { current: LIVE() }
    const value = liveGetters({ adapterMode: 'supabase' }, ref)
    expect(value.realtimeStatus).toBe('live')
    ref.current = { ...ref.current, realtimeStatus: 'error', undoToast: { message: 'Deleted' } }
    expect(value.realtimeStatus).toBe('error')
    expect(value.undoToast).toEqual({ message: 'Deleted' })
    expect(value.adapterMode).toBe('supabase')
  })

  it('they are enumerable (Object.keys, `in`, a spread that copies what they answer now) and cannot be assigned', () => {
    const ref = { current: LIVE() }
    const value = liveGetters({ adapterMode: 'supabase' }, ref)
    expect(Object.keys(value)).toEqual(['adapterMode', ...EIGHT])
    for (const name of EIGHT) expect(name in value, name).toBe(true)
    const copy = { ...value }
    ref.current = { ...ref.current, realtimeStatus: 'error' }
    expect(copy.realtimeStatus).toBe('live')              // a copy is a copy: it holds what was answered when it was made
    expect(value.realtimeStatus).toBe('error')
    expect(() => { value.undoToast = null }).toThrow(TypeError)
  })
})

describe('useRabbitProjects: D.O.G.\'s six', () => {
  function DogReads({ readWhole, seen }) { seen.value = useRabbitProjects(readWhole); return null }

  it('with no provider above, CALLS what it is handed (a test\'s stand-in for the provider\'s hook answers)', () => {
    const fake = { projectsIndex: { p1: { id: 'p1' } } }
    let calls = 0
    const { seen } = show((s) => <DogReads readWhole={() => { calls++; return fake }} seen={s} />)
    expect(seen.value).toBe(fake)
    expect(calls).toBe(1)
    expect(show((s) => <DogReads seen={s} />).seen.value).toBeNull()
  })

  it('with the provider above, answers with its object and does not call the whole value\'s hook', () => {
    const projects = { adapterMode: 'supabase', projectsIndex: {} }
    let calls = 0
    const { seen } = show((s) => withRabbitProjects(projects, <DogReads readWhole={() => { calls++; return {} }} seen={s} />))
    expect(seen.value).toBe(projects)
    expect(calls).toBe(0)
  })
})
