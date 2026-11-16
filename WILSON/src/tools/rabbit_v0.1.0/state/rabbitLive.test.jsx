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
//    it. Nothing at run time catches that, so this file PARSES every source
//    file under src (@babel/parser, as the source guards of O.T.T.E.R. and
//    the answers' links do) and holds, outside the provider and rabbitLive.js:
//    no member read of one of the eight (`x.undoToast`, `x?.undoToast`,
//    `x?.['undoToast']`), whatever the object and wherever it came from
//    (useRabbit(), the context's own hook, useContext), and no destructuring
//    that names one, anywhere, a function's parameter included (the value
//    spread into a component lands there). A use of one of the names that is
//    not the provider's value is on an allow-list below, with its reason, and
//    an entry no longer in the source fails. The readers through
//    useRabbitLive are exactly the ones listed here.
//
//    The scan read the text until the F4 review (round 1, C1): a regex took
//    the comments out, and a `/*` inside a `//` comment or a string
//    ('image/*') opened a block that ran to the next `*/`. Measured
//    2026-11-13: 2,111 lines of code in 5 files were never scanned, 1,892 of
//    them in supabaseAdapter.js. A bracket read, a destructuring ended with
//    `;`, and other sources were not seen either. The controls below plant
//    each of those in a copy of a real file.
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
import { parse } from '@babel/parser'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'
import {
  LIVE_NAMES, SHOWN_NAMES, useRabbitLive, useRabbitOnline, withRabbitLive, liveGetters, useRabbitProjects, withRabbitProjects,
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

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod'])
const stringOf = (n) => (n?.type === 'StringLiteral' ? n.value : n?.type === 'TemplateLiteral' && n.expressions.length === 0 ? n.quasis[0].value.cooked : null)
/** The name a function is known by: its own, or the variable, property or method it is written to. */
function functionName(n, parent) {
  if (n.id?.name) return n.id.name
  if (n.type !== 'FunctionDeclaration' && n.type !== 'FunctionExpression' && n.type !== 'ArrowFunctionExpression' && !n.computed) return n.key.name ?? n.key.id?.name ?? stringOf(n.key) ?? '(anonymous)'
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name
  if ((parent?.type === 'ObjectProperty' || parent?.type === 'ClassProperty') && !parent.computed) return parent.key.name ?? stringOf(parent.key)
  if (parent?.type === 'AssignmentExpression' && parent.left.type === 'Identifier') return parent.left.name
  return '(anonymous)'
}
/**
 * Every place a parsed file names one of the eight off an object (a member
 * read: `.name`, `?.name`, `['name']`) or in a destructuring (an object
 * pattern's key, a function's parameter included), as
 * `{ path, line, what, where }`: `where` is the function it sits in.
 */
function eightIn(path, ast) {
  const found = []
  const visit = (n, parent, where) => {
    if (!n || typeof n.type !== 'string') return
    if (FUNCTIONS.has(n.type)) where = functionName(n, parent)
    if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
      const name = n.computed ? stringOf(n.property) : n.property.name
      const dot = n.optional ? '?.' : n.computed ? '' : '.'
      if (EIGHT.includes(name)) found.push({ path, line: n.loc.start.line, what: n.computed ? `${dot}['${name}']` : `${dot}${name}`, where })
    }
    if (n.type === 'ObjectPattern') {
      for (const p of n.properties) {
        const name = p.type !== 'ObjectProperty' ? null : p.computed ? stringOf(p.key) : (p.key.name ?? stringOf(p.key))
        if (EIGHT.includes(name)) found.push({ path, line: p.loc.start.line, what: `{ ${name} }`, where })
      }
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'extra' || k.endsWith('Comments')) continue
      const v = n[k]
      if (Array.isArray(v)) v.forEach((c) => visit(c, n, where))
      else if (v && typeof v.type === 'string') visit(v, n, where)
    }
  }
  visit(ast.program, null, '(module)')
  return found
}
/**
 * A source file through the parser: `code`, its text with each comment
 * blanked (every character but a line break made a space, so what is left is
 * where it was), for the text checks below; and `eight`, every place it names
 * one of the eight. The tree is dropped once read: the tests need only these.
 */
function readSource(path, text) {
  const ast = parse(text, { sourceType: 'module', plugins: ['jsx'] })
  let code = ''
  let at = 0
  for (const c of ast.comments) { code += text.slice(at, c.start) + text.slice(c.start, c.end).replace(/[^\n]/g, ' '); at = c.end }
  return { path, code: code + text.slice(at), eight: eightIn(path, ast) }
}
const where = (f) => `${f.path}:${f.line}  ${f.what}  in ${f.where}`

const FILES = sourceFiles(SRC).map((full) => readSource(slashed(full), readFileSync(full, 'utf8')))
const THE_TWO = new Set(['tools/rabbit_v0.1.0/state/RabbitProvider.jsx', 'tools/rabbit_v0.1.0/state/rabbitLive.js'])

// The uses of one of the eight names that are not the provider's value, each
// with its reason, read and checked (F4 review round 1). Matched by file, by
// what is named and by the function it sits in, so another use in the same
// file is not let through with it.
const ALLOWED = [
  {
    path: 'tools/rabbit_v0.1.0/state/connectionStatus.js', what: '{ realtimeStatus }', where: 'connectionView',
    reason: 'a pure function\'s own parameter: the dot\'s view of a status it is handed. Its one caller, ConnectionDot, '
      + 'hands it the word it reads with useRabbitLive(\'realtimeStatus\', ctx).',
  },
]
const allows = (entry, f) => entry.path === f.path && entry.what === f.what && entry.where === f.where

describe('the source: nobody reads one of the eight off the value', () => {
  it('the eight are the module\'s eight, and seven of them have a context (activeIngestion is shown by nothing)', () => {
    expect([...LIVE_NAMES]).toEqual(EIGHT)
    expect([...SHOWN_NAMES]).toEqual(EIGHT.filter((name) => name !== 'activeIngestion'))
  })

  it('reads the tree it means to: several hundred source files, the provider among them, each parsed', () => {
    expect(FILES.length).toBeGreaterThan(300)
    for (const path of THE_TWO) expect(FILES.some((f) => f.path === path), path).toBe(true)
    // The walk sees a read where there is one: rabbitLive.js reads the status's word off the caller's own ctx
    // (no provider above) and off the eight it is handed.
    expect(FILES.find((f) => f.path === 'tools/rabbit_v0.1.0/state/rabbitLive.js').eight.map((f) => f.what)).toEqual(['?.adapterStatus', '.adapterStatus'])
  })

  it('no member read of one of the eight (x.name, x?.name, x[\'name\']) in any source file but the provider and rabbitLive.js', () => {
    const found = FILES.filter((f) => !THE_TWO.has(f.path)).flatMap((f) => f.eight).filter((f) => !f.what.startsWith('{'))
    // Each one would be a read that is never drawn again: read it with useRabbitLive('<name>', ctx) (state/rabbitLive.js).
    expect(found.filter((f) => !ALLOWED.some((entry) => allows(entry, f))).map(where)).toEqual([])
  })

  it('no one of the eight is named in a destructuring anywhere, a function\'s parameter included, but in the allowed uses', () => {
    const found = FILES.filter((f) => !THE_TWO.has(f.path)).flatMap((f) => f.eight).filter((f) => f.what.startsWith('{'))
    expect(found.filter((f) => !ALLOWED.some((entry) => allows(entry, f))).map(where)).toEqual([])
    // Each allowed use is still in the source: an entry that names nothing is taken out.
    for (const entry of ALLOWED) expect(found.some((f) => allows(entry, f)), `${entry.path} ${entry.what} in ${entry.where}`).toBe(true)
  })

  describe('CONTROL: each way a read hid from a scan of the text, planted in a copy of a real file, is found', () => {
    /** What the scan finds in a real file's source, changed by `edit`. */
    const planted = (path, edit) => {
      // Line endings as the repository holds them: a checkout with autocrlf (the owner's own) has CRLF on disk, and
      // an edit that plants after a '\n' would find nothing there (review round 2, C-1).
      const text = readFileSync(join(SRC, path), 'utf8').replace(/\r\n/g, '\n')
      const changed = edit(text)
      expect(changed, `${path}: the place to plant was found`).not.toBe(text)
      expect(FILES.find((f) => f.path === path).eight, `${path} names none of the eight as it is`).toEqual([])
      return readSource(path, changed).eight.map((f) => `${f.what} in ${f.where}`)
    }
    const BAR = 'tools/rabbit_v0.1.0/components/ProjectContextBar.jsx'
    const afterCtx = (code) => (text) => text.replace('  const ctx = useRabbit()\n', `  const ctx = useRabbit()\n${code}\n`)

    it('the hook\'s answer destructured, the statement ended with a semicolon', () => {
      expect(planted(BAR, afterCtx('  const { presentUsers } = useRabbit();'))).toEqual(['{ presentUsers } in ProjectContextBar'])
    })
    it('a bracket read, optional', () => {
      expect(planted(BAR, afterCtx("  const toast = ctx?.['undoToast']"))).toEqual(["?.['undoToast'] in ProjectContextBar"])
    })
    it('another source: the context\'s own hook', () => {
      expect(planted(BAR, afterCtx('  const { undoToast } = useRabbitContext()'))).toEqual(['{ undoToast } in ProjectContextBar'])
    })
    it('a read after a string holding "image/*", which a scan of the text took for a comment\'s start', () => {
      const CARD = 'tools/deck-outline-generator_v0.514/references/ReferencesCard.jsx'
      const at = "image/*,video/*';"
      expect(planted(CARD, (text) => text.replace(at, `${at} export const peopleOf = (ctx) => ctx.presentUsers;`))).toEqual(['.presentUsers in peopleOf'])
    })
    it('the value spread into a component whose parameter names one', () => {
      const code = '\nconst Faces = ({ presentUsers }) => <i>{presentUsers.length}</i>\nexport function Spread() { const rabbit = useRabbit(); return <Faces {...rabbit} /> }\n'
      expect(planted(BAR, (text) => `${text}${code}`)).toEqual(['{ presentUsers } in Faces'])
    })
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
      'components/Dashboard/DashboardPage.jsx':           ['workspacePresentUsers', 'workspaceRealtimeStatus'],
      'components/SettingsPage.jsx':                      ['adapterStatus'],
      'tools/rabbit_v0.1.0/Rabbit.jsx':                   ['presentUsers', 'realtimeStatus'],
      'tools/rabbit_v0.1.0/components/ConnectionDot.jsx': ['realtimeStatus'],
      'tools/rabbit_v0.1.0/components/IngestionToast.jsx': ['ingestionRun'],
      'tools/rabbit_v0.1.0/components/UndoToast.jsx':     ['undoToast'],
      'tools/rabbit_v0.1.0/views/intake/IntakeProgress.jsx': ['ingestionRun'],
    })
    // Every name asked for is one that has a context (a typo would throw at the first render, in the app).
    for (const names of Object.values(readers)) for (const name of names) expect(SHOWN_NAMES, name).toContain(name)
  })

  it('the adapter\'s status OBJECT is read by the two that print it; the seven that want one word of it read the word', () => {
    // Settings and the Admin terminal print the status (online, and its error in words). Everyone else asks only
    // "is it online", and reads useRabbitOnline: a new status object that says the same thing draws none of them.
    const word = FILES.filter((f) => /useRabbitOnline\(/.test(f.code) && f.path !== 'tools/rabbit_v0.1.0/state/rabbitLive.js').map((f) => f.path).sort()
    expect(word).toEqual([
      'components/Budget/useBudgetLines.js',
      'components/Budget/useProjectRateOverrides.js',
      'components/Expenses/useExpenses.js',
      'components/RateCard/useRateCard.js',
      'components/TaskTemplates/useTaskTemplates.js',
      'components/TeamMembers/useTeamMembers.js',
      'tools/rabbit_v0.1.0/components/ConnectionDot.jsx',
    ])
    for (const path of word) expect(FILES.find((f) => f.path === path).code, path).not.toMatch(/useRabbitLive\(\s*'adapterStatus'/)
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

describe('useRabbitOnline: the one word of the adapter\'s status', () => {
  function Asks({ ctx, seen }) { seen.value = useRabbitOnline(ctx); seen.renders++; return null }

  it('with no provider above, the word off the caller\'s own ctx: the expression each reader held before', () => {
    expect(show((seen) => <Asks ctx={{ adapterStatus: { online: true } }} seen={seen} />).seen.value).toBe(true)
    expect(show((seen) => <Asks ctx={{ adapterStatus: { online: false, error: 'x' } }} seen={seen} />).seen.value).toBe(false)
    expect(show((seen) => <Asks ctx={{}} seen={seen} />).seen.value).toBeUndefined()
    expect(show((seen) => <Asks ctx={null} seen={seen} />).seen.value).toBeUndefined()
  })

  it('with the provider above: not drawn for a new status that says the same thing, drawn when the word flips', () => {
    const live = LIVE()
    const { seen, view } = show((s) => withRabbitLive(live, <Asks ctx={{ adapterStatus: { online: false } }} seen={s} />))
    expect(seen.value).toBe(true)                         // the provider's, whatever the ctx says
    const child = <Asks seen={seen} />
    view.rerender(withRabbitLive(live, child))
    const settled = seen.renders
    for (let i = 1; i <= 3; i++) view.rerender(withRabbitLive({ ...live, adapterStatus: { online: true, lastSyncAt: new Date(i), error: null } }, child))
    expect(seen.renders).toBe(settled)
    view.rerender(withRabbitLive({ ...live, adapterStatus: { online: false, lastSyncAt: null, error: 'offline' } }, child))
    expect(seen.renders).toBe(settled + 1)
    expect(seen.value).toBe(false)
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
