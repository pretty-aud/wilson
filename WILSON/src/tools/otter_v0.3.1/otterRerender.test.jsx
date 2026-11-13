/** @vitest-environment jsdom */
// =============================================================================
// otterRerender.test.jsx — O.T.T.E.R. draws a lesson and a reference once
// (F4, 2026-11-13; the review's dog-otter C2).
//
// O.T.T.E.R. keeps its seven views mounted and hides the ones off screen
// (handbook §13.2), and until F4 it BUILT all seven on every render: the open
// lesson's markdown was parsed again and its code coloured again, and every
// function card of the reference coloured its two code wells again, whatever
// had changed. Otter.jsx is mounted whole here over a small library (a coding
// course with one lesson that has a code fence and three functions; an
// application with shortcuts and two systems of nodes) and the render spy
// counts what draws: react-markdown's `Markdown` (the lesson's body),
// `FunctionCard` and its `CodeWell`s, and the kit's `Select`, which on the
// lesson's screen only the two reference views draw (each its picker). The
// Select is counted by reference (`rendersOf`): the build names its function
// Select2, and a count by its name would be 0 whatever happened. Each one a
// pin holds at 0 is first seen to have been drawn at all (`assertSeen`).
//
// MEASURED BEFORE F4's change (2026-11-13, at the brief's tip a71cd144; the
// three pins red): marking the lesson complete parsed the lesson again and
// drew the three function cards, which are off screen, once each; four
// letters typed in the functions search parsed the lesson, which is off
// screen, four times; and the three letters that leave the search's result
// as it was drew its one card three times more.
//
// AFTER (the commit that keeps the lesson's body for its text, the two
// reference views for their data and a card for its function): none of the
// three parses or draws. The lesson's body, the views and the card each
// follow what they read (the middle of this file), the lesson's links follow
// the page's address (AnswerLink draws a link against it), and the source is
// read to hold that the views' lists of what they read are complete (its end).
// =============================================================================
import { renderSpy } from '../../lib/renderSpy'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { parse } from '@babel/parser'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const COURSE = { slug: 'csharp', name: 'C#', type: 'coding_language', skill_level: 'beginner', visibility: 'personal', is_own: true, can_write: true, can_read_content: true, owner_id: 'u-me' }
const LESSON = 'A loop repeats.\n\n```csharp\nfor (var i = 0; i < 3; i++) { Console.WriteLine(i); }\n```\n\n| Word | Means |\n| --- | --- |\n| for | repeat |\n\nRead [the docs](https://example.invalid/loops).'
const SUBJECT = {
  id: 'sub-1', slug: 'loops', title: 'Loops', is_stub: false, subject_order: 1, skill_level: 'beginner',
  sections: [{ id: 's1', title: 'Going round', lessons: [
    { id: 'lesson_1_1', title: 'The for loop', content: LESSON, key_takeaways: ['A loop repeats'], practice_prompt: 'Write one.' },
    { id: 'lesson_1_2', title: 'The while loop', content: '# The while loop\n\nWhile it is true.', key_takeaways: [], practice_prompt: '' },
  ] }],
}
/** The subject with another text for its first lesson. */
const subjectWith = (content) => ({ ...SUBJECT, sections: [{ ...SUBJECT.sections[0], lessons: [{ ...SUBJECT.sections[0].lessons[0], content }, SUBJECT.sections[0].lessons[1]] }] })
const FUNCTIONS = { categories: [{ category: 'Console', functions: [
  { name: 'Console.WriteLine', description: 'Writes a line.', syntax: 'Console.WriteLine(value)', example: 'Console.WriteLine("hi");' },
  { name: 'Console.ReadLine', description: 'Reads a line.', syntax: 'Console.ReadLine()', example: 'var s = Console.ReadLine();' },
  { name: 'Math.Max', description: 'The larger of two.', syntax: 'Math.Max(a, b)', example: 'Math.Max(1, 2);' },
] }] }
// A second course, an application: its shortcuts and its nodes are the other two reference views.
const APP = { slug: 'blender', name: 'Blender', type: 'software', skill_level: 'beginner', visibility: 'personal', is_own: true, can_write: true, can_read_content: true, owner_id: 'u-me' }
const HOTKEYS = { categories: [{ category: 'View', shortcuts: [
  { action: 'Orbit the view', windows: 'MMB', mac: 'MMB', notes: '' },
  { action: 'Pan the view', windows: 'Shift MMB', mac: 'Shift MMB', notes: 'With a mouse' },
] }] }
const NODES = { systems: [
  { system: 'Geometry Nodes', categories: [{ category: 'Mesh', nodes: [
    { name: 'Join Geometry', description: 'Many into one.', inputs: [{ name: 'Geometry', type: 'Geometry', description: 'Each to join' }], outputs: [{ name: 'Geometry', type: 'Geometry', description: 'The one' }] },
    { name: 'Subdivide Mesh', description: 'More faces.', inputs: [{ name: 'Level', type: 'Integer', description: 'How many times' }], outputs: [] },
  ] }] },
  { system: 'Shader Nodes', categories: [{ category: 'Shader', nodes: [
    { name: 'Principled BSDF', description: 'The one shader.', inputs: [], outputs: [{ name: 'BSDF', type: 'Shader', description: '' }] },
  ] }] },
] }
// `firstLesson`: another text for the subject's first lesson, for the one test that needs it.
const world = { writes: [], firstLesson: null }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
async function backend(url, init) {
  if ((init?.method ?? 'GET') !== 'GET') { world.writes.push({ url, body: init?.body ? JSON.parse(init.body) : null }); return json({ ok: true }) }
  const routes = {
    '/api/software': [COURSE, APP],
    '/api/software/blender': APP,
    '/api/software/blender/subjects': [],
    '/api/software/blender/progress': { subjects: {} },
    '/api/software/blender/hotkeys': HOTKEYS,
    '/api/software/blender/functions': { categories: [] },
    '/api/software/blender/nodes': NODES,
    '/api/software/blender/references': { urls: [] },
    '/api/software/csharp': COURSE,
    '/api/software/csharp/subjects': [{ id: SUBJECT.id, slug: SUBJECT.slug, title: SUBJECT.title, description: '', skill_level: 'beginner', is_stub: false, subject_order: 1 }],
    '/api/software/csharp/subjects/loops': world.firstLesson == null ? SUBJECT : subjectWith(world.firstLesson),
    '/api/software/csharp/progress': { subjects: {} },
    '/api/software/csharp/hotkeys': { categories: [] },
    '/api/software/csharp/functions': FUNCTIONS,
    '/api/software/csharp/nodes': { systems: [] },
    '/api/software/csharp/references': { urls: [] },
    '/api/otter/subject-shares': [],
    '/api/otter/change-requests': [],
    '/api/otter/nominations': [],
  }
  return url in routes ? json(routes[url]) : json({ error: 'Not found' }, 404)
}

vi.mock('./adapters', () => ({
  otterFetch: (...a) => backend(...a),
  otterCloudActive: () => Promise.resolve(false),
  getOtterAdapterMode: () => 'auto',
  setOtterAdapterMode: () => 'auto',
  subscribeOtterAdapterMode: () => () => {},
}))
vi.mock('./Validator', () => ({ default: () => null }))
vi.mock('./petKnowledge.js', () => ({ clearPetKnowledgeCache: () => {} }))
const PERMS = { ready: true, role: 'member', userId: 'u-me', workspaceId: 'w-1' }
vi.mock('../../permissions', () => ({ usePermissions: () => PERMS }))
vi.mock('../../agent', () => ({ useAgent: () => null }))
const MEMBERS = { members: [], loading: false, error: null }
vi.mock('../../components/TeamMembers/useWorkspaceMembers', () => ({ useWorkspaceMembers: () => MEMBERS }))
vi.mock('@monaco-editor/react', () => ({ default: () => null }))
vi.mock('../../cloud/aiProxy', () => ({ callAI: vi.fn(), isRetryableAIError: () => false }))
vi.mock('../../lib/localData', () => ({
  hasLocalServer: () => false,
  loadOtterSettings: () => Promise.resolve({}),
  saveOtterSettings: () => Promise.resolve({}),
}))
vi.mock('../../lib/userState', () => ({ pushSettingsToCloud: () => Promise.resolve() }))

const { default: Otter } = await import('./Otter.jsx')
// The kit's Select, the very one Otter.jsx imports: counted by reference.
const { Select } = await import('../../ui')

const noop = () => {}
/** Mount, open the course and its subject: the first lesson is on screen, the Functions reference behind it. */
async function openLesson() {
  const view = render(createElement(Otter, { currentPage: 'otter', onNavigate: noop, onContextChange: noop }))
  fireEvent.click(await waitFor(() => { const b = document.querySelector('.otter-course-open[title="C#"]'); if (!b) throw new Error('no course yet'); return b }))
  fireEvent.click(await waitFor(() => { const b = document.querySelector('.otter-subject-open'); if (!b) throw new Error('no subject yet'); return b }))
  await screen.findByRole('heading', { name: 'The for loop' })
  await waitFor(() => { if (!view.container.textContent.includes('Console.ReadLine')) throw new Error('the functions have not loaded') })
  await act(async () => {})
  return view
}
const searchBox = () => document.querySelector('input[placeholder="Search functions..."]')

beforeEach(() => { world.writes.length = 0; world.firstLesson = null; vi.spyOn(console, 'log').mockImplementation(() => {}) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); renderSpy.reset() })

describe('the lesson and the reference as drawn', () => {
  it('the lesson: its prose, its fence coloured, its table in its box, its link the shared one; the reference: its three cards', async () => {
    const view = await openLesson()
    const body = view.container.querySelector('.lesson-content')
    expect(body.textContent).toContain('A loop repeats.')
    expect(body.querySelector('code.language-csharp')).not.toBeNull()
    expect(body.querySelector('.lesson-table table')).not.toBeNull()
    expect(body.querySelector('a[href="https://example.invalid/loops"]').getAttribute('target')).toBe('_blank')
    expect([...view.container.querySelectorAll('.otter-fn-name')].map((n) => n.textContent)).toEqual(['Console.WriteLine', 'Console.ReadLine', 'Math.Max'])
  })

  it('a lesson whose first line repeats its title does not say it twice', async () => {
    const view = await openLesson()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Next/ })) })
    await screen.findByRole('heading', { name: 'The while loop', level: 2 })
    const body = view.container.querySelector('.lesson-content')
    expect(body.textContent).toContain('While it is true.')
    expect(body.querySelector('h1')).toBeNull()
  })
})

describe('a render of O.T.T.E.R. that changes neither', () => {
  it('marking the lesson complete: the lesson is not parsed again, and no function card is drawn', async () => {
    const view = await openLesson()
    renderSpy.assertSeen('Markdown', 'FunctionCard')                   // both drew at the mount: a 0 below is a measurement
    const mark = renderSpy.mark()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Mark complete/ })) })
    await waitFor(() => expect(screen.getByRole('button', { name: /Completed/ })).toBeTruthy())
    expect(renderSpy.renders('Otter', mark)).toBeGreaterThan(0)            // it did render
    expect({ lesson: renderSpy.renders('Markdown', mark), cards: renderSpy.renders('FunctionCard', mark) }).toEqual({ lesson: 0, cards: 0 })
    expect(view.container.querySelector('.lesson-content').textContent).toContain('A loop repeats.')
  })

  it('typing in the functions search: the lesson, off screen, is not parsed again', async () => {
    await openLesson()
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Functions/ })) })
    renderSpy.assertSeen('Markdown')
    const mark = renderSpy.mark()
    for (const typed of ['M', 'Ma', 'Mat', 'Math']) await act(async () => { fireEvent.change(searchBox(), { target: { value: typed } }) })
    expect(renderSpy.renders('Otter', mark)).toBe(4)
    expect(renderSpy.renders('Markdown', mark)).toBe(0)
  })
})

describe('the functions search', () => {
  it('finds as it did: "M" leaves the one function with an M, and the letters after it that change nothing draw no card again', async () => {
    const view = await openLesson()
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Functions/ })) })
    await act(async () => { fireEvent.change(searchBox(), { target: { value: 'M' } }) })
    const names = () => [...view.container.querySelectorAll('.otter-fn-name')].map((n) => n.textContent)
    expect(names()).toEqual(['Math.Max'])
    renderSpy.assertSeen('FunctionCard')
    const mark = renderSpy.mark()
    for (const typed of ['Ma', 'Mat', 'Math']) await act(async () => { fireEvent.change(searchBox(), { target: { value: typed } }) })
    expect(names()).toEqual(['Math.Max'])
    expect(renderSpy.renders('FunctionCard', mark)).toBe(0)
    // CONTROL: a search that changes the result does draw.
    await act(async () => { fireEvent.change(searchBox(), { target: { value: 'Console' } }) })
    expect(names()).toEqual(['Console.WriteLine', 'Console.ReadLine'])
    await act(async () => { fireEvent.change(searchBox(), { target: { value: 'zzz' } }) })
    expect(view.container.textContent).toContain('No functions matching your search.')
  })
})

// ── The views still follow everything they read ──────────────────────────────
// The two reference views are kept as the elements their functions returned
// and built again when one of the things they read changes (Otter.jsx, above
// its main layout). A view kept too long is the failure to fear, so each
// thing they read is CHANGED here, and the view is seen to follow.
describe('the reference views follow what they read', () => {
  const shown = (view, sel) => [...view.container.querySelectorAll(sel)].map((n) => n.textContent)
  const typeIn = (placeholder, value) => act(async () => { fireEvent.change(document.querySelector(`input[placeholder="${placeholder}"]`), { target: { value } }) })

  it('the shortcuts: another course opens them, and their search finds', async () => {
    const view = await openLesson()
    // From a coding course, Hotkeys opens the first application's shortcuts.
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Hotkeys/ })) })
    await waitFor(() => expect(view.container.textContent).toContain('Orbit the view'))
    expect(view.container.textContent).toContain('Keyboard shortcuts')
    expect(view.container.textContent).toContain('Pan the view')
    expect(shown(view, '.otter-fn-name')).toEqual([])                 // the functions view is this view's other face: gone with the course
    await typeIn('Search shortcuts...', 'orb')
    expect(view.container.textContent).toContain('Orbit the view')
    expect(view.container.textContent).not.toContain('Pan the view')
    await typeIn('Search shortcuts...', 'zzz')
    expect(view.container.textContent).toContain('No shortcuts matching your search.')
    await typeIn('Search shortcuts...', '')
    expect(view.container.textContent).toContain('Pan the view')
    // And back: Functions opens the first coding course's functions.
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Functions/ })) })
    await waitFor(() => expect(shown(view, '.otter-fn-name')).toEqual(['Console.WriteLine', 'Console.ReadLine', 'Math.Max']))
    expect(view.container.textContent).not.toContain('Orbit the view')
  })

  it('the nodes: the course\'s systems, a change of system, and their search', async () => {
    const view = await openLesson()
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Nodes/ })) })
    await waitFor(() => expect(shown(view, '.otter-node-name')).toEqual(['Join Geometry', 'Subdivide Mesh']))
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Shader Nodes/ })) })
    expect(shown(view, '.otter-node-name')).toEqual(['Principled BSDF'])
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Geometry Nodes/ })) })
    await typeIn('Search nodes...', 'level')                          // an input's name is searched too
    expect(shown(view, '.otter-node-name')).toEqual(['Subdivide Mesh'])
    await typeIn('Search nodes...', 'zzz')
    expect(view.container.textContent).toContain('No nodes matching your search.')
  })

  it('and neither is built for what it does not read: a lesson marked complete builds no view again', async () => {
    await openLesson()
    // On this screen the kit's Select is drawn by the two views and nothing else: each view's picker. A view
    // built again draws its picker again (a forwardRef, no memo), whatever its cards' memo holds.
    expect([...document.querySelectorAll('select')].map((s) => s.getAttribute('aria-label'))).toEqual(['Language', 'Software'])
    renderSpy.assertSeen(Select, 'FunctionCard', 'CodeWell')            // all drew at the mount: a 0 below is a measurement
    const mark = renderSpy.mark()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Mark complete/ })) })
    await waitFor(() => expect(screen.getByRole('button', { name: /Completed/ })).toBeTruthy())
    expect(renderSpy.renders('Otter', mark)).toBeGreaterThan(0)
    expect(renderSpy.rendersOf(Select, mark)).toBe(0)                  // neither view was built again
    expect(renderSpy.which(['FunctionCard', 'CodeWell'], mark)).toEqual([])
    // CONTROL: a letter typed in the functions search, which the functions view reads, builds that view
    // again and only it: its picker draws, the nodes view's does not.
    const typed = renderSpy.mark()
    await act(async () => { fireEvent.change(searchBox(), { target: { value: 'M' } }) })
    expect(renderSpy.rendersOf(Select, typed)).toBe(1)
  })
})

// ── The lesson's links follow the page's address ─────────────────────────────
// AnswerLink draws a link against the address it is drawn at: a link to this
// very page's path with a fragment is an anchor, another path on this origin
// is its text (a click would reload WILSON in place). The lesson's body is
// kept for its text AND that address, so a lesson first drawn while another
// page's address was current (a generation that finished while R.A.B.B.I.T.
// was on screen opens its subject's first lesson there) is drawn again when
// O.T.T.E.R. is shown, and the link is an anchor again.
describe('the lesson\'s links follow the page\'s address', () => {
  it('a lesson drawn at another page\'s address, then O.T.T.E.R. shown at its own: its in-page link is an anchor', async () => {
    const was = window.location.href
    world.firstLesson = 'Go [jump](/otter#loops) now.'
    window.history.replaceState(null, '', '/rabbit')
    try {
      const props = { onNavigate: noop, onContextChange: noop }
      const view = render(createElement(Otter, { ...props, currentPage: 'rabbit' }))
      fireEvent.click(await waitFor(() => { const b = document.querySelector('.otter-course-open[title="C#"]'); if (!b) throw new Error('no course yet'); return b }))
      fireEvent.click(await waitFor(() => { const b = document.querySelector('.otter-subject-open'); if (!b) throw new Error('no subject yet'); return b }))
      const body = () => view.container.querySelector('.lesson-content')
      await waitFor(() => { if (!body()?.textContent.includes('jump')) throw new Error('the lesson is not drawn yet') })
      expect(body().querySelector('a')).toBeNull()                    // at /rabbit, /otter#loops is another page of this origin: its text
      expect(body().textContent).toBe('Go jump now.')
      window.history.replaceState(null, '', '/otter')
      await act(async () => { view.rerender(createElement(Otter, { ...props, currentPage: 'otter' })) })
      expect(body().querySelector('a')?.getAttribute('href')).toBe('/otter#loops')
      expect(body().textContent).toBe('Go jump now.')
    } finally {
      window.history.replaceState(null, '', was)
    }
  })
})

// ── Each list is what its function reads ─────────────────────────────────────
// The two lists of things the reference views are built again for are written
// by hand beside the views (Otter.jsx). A piece of state or a prop read in
// renderHotkeys() or renderNodes() and left out of its list would show as of
// the last change of the others, and no test above would see it until someone
// wrote one for that state. So the source is read: everything each function
// reads of the component's own scope (its props, and what its body declares)
// is found, and it is either in the list, or one of the three kinds that never
// change (a ref, a state setter, a callback over no deps). A name is the
// component's only where nothing nearer declares it: a parameter is its own
// function's, a let or const its own block's. A ref's `.current` read while
// the view draws is an error of its own: a ref's value is in no list. The same
// reading holds that the function handed to the lesson's body reads nothing of
// the component at all.
describe('the source: the views\' lists are what the views read', () => {
  const src = readFileSync(resolve(here, 'Otter.jsx'), 'utf8')
  /** The parsed component in a text of Otter.jsx. */
  const otterOf = (text) => parse(text, { sourceType: 'module', plugins: ['jsx'] }).program.body.map((n) => n.declaration || n).find((n) => n.type === 'FunctionDeclaration' && n.id?.name === 'Otter')
  const otter = otterOf(src)
  const namesIn = (pattern, out = []) => {
    if (!pattern) return out
    if (pattern.type === 'Identifier') out.push(pattern.name)
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((e) => namesIn(e, out))
    else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((p) => namesIn(p.value || p.argument, out))
    else if (pattern.type === 'AssignmentPattern') namesIn(pattern.left, out)
    else if (pattern.type === 'RestElement') namesIn(pattern.argument, out)
    return out
  }
  /** The component's own names, and how each was made: its props, and what its body declares. */
  const scopeOf = (comp) => {
    const scope = new Map()
    for (const p of comp.params) namesIn(p).forEach((n) => scope.set(n, 'a prop'))
    for (const st of comp.body.body) {
      if (st.type === 'FunctionDeclaration') scope.set(st.id.name, 'a function made at each render')
      if (st.type !== 'VariableDeclaration') continue
      for (const d of st.declarations) {
        const call = d.init?.type === 'CallExpression' ? d.init.callee.name : null
        if (d.id.type === 'ArrayPattern' && call === 'useState') {
          if (d.id.elements[0]) scope.set(d.id.elements[0].name, 'state')
          if (d.id.elements[1]) scope.set(d.id.elements[1].name, 'a setter')
        } else if (call === 'useRef') namesIn(d.id).forEach((n) => scope.set(n, 'a ref'))
        else if (call === 'useCallback') {
          const deps = d.init.arguments[1]
          namesIn(d.id).forEach((n) => scope.set(n, deps?.type === 'ArrayExpression' && deps.elements.length === 0 ? 'a callback over nothing' : 'a callback with deps'))
        } else namesIn(d.id).forEach((n) => scope.set(n, 'a value made at each render'))
      }
    }
    return scope
  }
  const scope = scopeOf(otter)

  const SKIP = new Set(['loc', 'start', 'end', 'extra', 'range'])
  const childKeys = (n) => Object.keys(n).filter((k) => !SKIP.has(k) && !k.endsWith('Comments'))
  const isFunction = (n) => /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod|ClassMethod|ClassPrivateMethod)$/.test(n.type)
  /** The `var` names a function's body declares, wherever they sit in it (not in a function inside it). */
  const varsIn = (n, out = []) => {
    if (!n || typeof n.type !== 'string' || isFunction(n)) return out
    if (n.type === 'VariableDeclaration' && n.kind === 'var') n.declarations.forEach((d) => namesIn(d.id, out))
    for (const k of childKeys(n)) {
      const v = n[k]
      if (Array.isArray(v)) v.forEach((c) => varsIn(c, out))
      else if (v && typeof v.type === 'string') varsIn(v, out)
    }
    return out
  }
  /** The names a block's own statements declare for it: let, const, class and function. */
  const lexicalIn = (statements) => statements.flatMap((st) => {
    if (st.type === 'VariableDeclaration' && st.kind !== 'var') return st.declarations.flatMap((d) => namesIn(d.id))
    if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) return [st.id.name]
    return []
  })
  /**
   * What `fn` reads from outside itself: `names`, every name it uses that no
   * scope inside it declares (JSX counts: `<Thing />` reads Thing), and
   * `currents`, each `x.current` it reads of a name from outside while it
   * draws. A function handed to an `on…` attribute runs on an event, after the
   * draw: a `.current` read there is the event's, and is not listed.
   */
  const readsIn = (fn) => {
    const names = new Set()
    const currents = new Set()
    const declared = (name, scopes) => scopes.some((s) => s.has(name))
    const visitPattern = (p, scopes, later) => {
      if (!p || p.type === 'Identifier') return
      if (p.type === 'AssignmentPattern') { visitPattern(p.left, scopes, later); visit(p.right, p, 'right', scopes, later) }
      else if (p.type === 'ArrayPattern') p.elements.forEach((e) => visitPattern(e, scopes, later))
      else if (p.type === 'RestElement') visitPattern(p.argument, scopes, later)
      else if (p.type === 'ObjectPattern') {
        for (const prop of p.properties) {
          if (prop.type === 'RestElement') { visitPattern(prop.argument, scopes, later); continue }
          if (prop.computed) visit(prop.key, prop, 'key', scopes, later)
          visitPattern(prop.value, scopes, later)
        }
      } else visit(p, null, null, scopes, later)
    }
    const visitFunction = (f, scopes, later) => {
      const own = new Set()
      if (f.type === 'FunctionExpression' && f.id) own.add(f.id.name)
      f.params.forEach((p) => namesIn(p).forEach((x) => own.add(x)))
      if (f.body.type === 'BlockStatement') [...varsIn(f.body), ...lexicalIn(f.body.body)].forEach((x) => own.add(x))
      const inner = [...scopes, own]
      f.params.forEach((p) => visitPattern(p, inner, later))
      if (f.body.type === 'BlockStatement') f.body.body.forEach((st) => visit(st, f.body, 'body', inner, later))
      else visit(f.body, f, 'body', inner, later)
    }
    const visit = (n, parent, key, scopes, later) => {
      if (!n || typeof n.type !== 'string') return
      if (isFunction(n)) {
        if (n.computed && n.key) visit(n.key, n, 'key', scopes, later)
        visitFunction(n, scopes, later)
        return
      }
      switch (n.type) {
        case 'Identifier': {
          const notARead = ((parent?.type === 'MemberExpression' || parent?.type === 'OptionalMemberExpression') && key === 'property' && !parent.computed)
            || (/^(ObjectProperty|ClassProperty|ClassPrivateProperty|ClassAccessorProperty)$/.test(parent?.type ?? '') && key === 'key' && !parent.computed)
            || (/^(LabeledStatement|BreakStatement|ContinueStatement)$/.test(parent?.type ?? '') && key === 'label')
            || parent?.type === 'MetaProperty'
          if (!notARead && !declared(n.name, scopes)) names.add(n.name)
          return
        }
        case 'JSXIdentifier': {
          // <Thing> and <Thing.Part> read Thing; <div> is the host's own element.
          const element = (parent?.type === 'JSXOpeningElement' || parent?.type === 'JSXClosingElement') && key === 'name' && /^[A-Z]/.test(n.name)
          const object = parent?.type === 'JSXMemberExpression' && key === 'object'
          if ((element || object) && !declared(n.name, scopes)) names.add(n.name)
          return
        }
        case 'VariableDeclarator': {
          // `const { current } = someRef` reads the ref's value as surely as someRef.current.
          if (n.id.type === 'ObjectPattern' && n.init?.type === 'Identifier' && !declared(n.init.name, scopes) && !later
            && n.id.properties.some((p) => p.type === 'ObjectProperty' && !p.computed && p.key.name === 'current')) currents.add(`${n.init.name}.current`)
          visitPattern(n.id, scopes, later)
          visit(n.init, n, 'init', scopes, later)
          return
        }
        case 'CatchClause': {
          const inner = [...scopes, new Set(namesIn(n.param))]
          visitPattern(n.param, inner, later)
          visit(n.body, n, 'body', inner, later)
          return
        }
        case 'BlockStatement': {
          const inner = [...scopes, new Set(lexicalIn(n.body))]
          n.body.forEach((st) => visit(st, n, 'body', inner, later))
          return
        }
        case 'SwitchStatement': {
          visit(n.discriminant, n, 'discriminant', scopes, later)
          const inner = [...scopes, new Set(lexicalIn(n.cases.flatMap((c) => c.consequent)))]
          n.cases.forEach((c) => { visit(c.test, c, 'test', inner, later); c.consequent.forEach((st) => visit(st, c, 'consequent', inner, later)) })
          return
        }
        case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
          const head = n.type === 'ForStatement' ? n.init : n.left
          const inner = [...scopes, new Set(head?.type === 'VariableDeclaration' && head.kind !== 'var' ? head.declarations.flatMap((d) => namesIn(d.id)) : [])]
          for (const k of childKeys(n)) visit(n[k], n, k, inner, later)
          return
        }
        case 'ClassDeclaration': case 'ClassExpression': {
          const inner = n.type === 'ClassExpression' && n.id ? [...scopes, new Set([n.id.name])] : scopes
          visit(n.superClass, n, 'superClass', inner, later)
          visit(n.body, n, 'body', inner, later)
          return
        }
        case 'JSXAttribute': {
          const handler = /^on[A-Z]/.test(n.name?.name ?? '') && n.value?.type === 'JSXExpressionContainer' && isFunction(n.value.expression)
          visit(n.value, n, 'value', scopes, later || handler)
          return
        }
        case 'MemberExpression': case 'OptionalMemberExpression': {
          const property = n.computed ? (n.property.type === 'StringLiteral' ? n.property.value : null) : n.property.name
          if (property === 'current' && n.object.type === 'Identifier' && !declared(n.object.name, scopes) && !later) currents.add(`${n.object.name}.current`)
          break
        }
        default: break
      }
      for (const k of childKeys(n)) {
        const v = n[k]
        if (Array.isArray(v)) v.forEach((c) => visit(c, n, k, scopes, later))
        else if (v && typeof v.type === 'string') visit(v, n, k, scopes, later)
      }
    }
    visitFunction(fn, [], false)
    return { names, currents }
  }
  /** Every name of the component's own scope that `fn` reads and does not declare itself. */
  const readsOf = (fn, own = scope) => [...readsIn(fn).names].filter((x) => own.has(x)).sort()
  /** Every `.current` that `fn` reads, while it draws, of one of the component's refs. */
  const refReadsOf = (fn, own = scope) => [...readsIn(fn).currents].filter((r) => own.get(r.slice(0, -'.current'.length)) === 'a ref').sort()

  const fnIn = (comp, name) => comp.body.body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === name)
  /** The deps of `const <view> = useMemo(() => <fn>(), [...])`. */
  const listIn = (comp, view, fn) => {
    const decl = comp.body.body.flatMap((st) => (st.type === 'VariableDeclaration' ? st.declarations : [])).find((d) => d.id.name === view)
    expect(decl?.init?.callee?.name, `${view} is a useMemo`).toBe('useMemo')
    const [build, deps] = decl.init.arguments
    expect(build.body.type === 'CallExpression' && build.body.callee.name, `${view} is built by ${fn}()`).toBe(fn)
    return deps.elements.map((e) => e.name).sort()
  }
  const NEVER_CHANGES = new Set(['a ref', 'a setter', 'a callback over nothing'])
  const LISTABLE = new Set(['state', 'a prop'])
  /** What the guard finds wrong with a view of `comp`, a line each; none is the pass. */
  const problemsOf = (comp, view, fn) => {
    const own = scopeOf(comp)
    const reads = readsOf(fnIn(comp, fn), own)
    const list = listIn(comp, view, fn)
    const out = []
    for (const name of reads) {
      const kind = own.get(name)
      if (NEVER_CHANGES.has(kind)) continue
      if (!LISTABLE.has(kind)) out.push(`${name} (${kind}) is read by ${fn}(): only state and props can be listed`)
      else if (!list.includes(name)) out.push(`${name} (${kind}) is read by ${fn}() and is not in ${view}'s list`)
    }
    for (const name of list) if (!reads.includes(name)) out.push(`${name} is in ${view}'s list and ${fn}() does not read it`)
    for (const read of refReadsOf(fnIn(comp, fn), own)) out.push(`${read} is read while ${fn}() draws: a ref's value is in no list`)
    return out
  }
  /** The function handed to the lesson's body, in `comp`. */
  const lessonChildOf = (comp) => {
    const found = []
    const walk = (n) => {
      if (!n || typeof n.type !== 'string') return
      if (n.type === 'JSXElement' && n.openingElement.name.name === 'LessonBodyOnce') found.push(n)
      for (const k of childKeys(n)) {
        const v = n[k]
        if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v.type === 'string') walk(v)
      }
    }
    walk(comp)
    expect(found).toHaveLength(1)
    return found[0].children.find((c) => c.type === 'JSXExpressionContainer' && isFunction(c.expression))?.expression
  }
  /** Otter.jsx with `code` put into renderNodes() after its first line, parsed. */
  const plantedInNodes = (code) => {
    const at = 'const systems = Array.isArray(softwareNodes?.systems) ? softwareNodes.systems : [];'
    const text = src.replace(at, `${at} ${code}`)
    expect(text, 'the place to plant was found').not.toBe(src)
    return otterOf(text)
  }

  it('reads the component it means to: more than three hundred names, each kind among them, its props too', () => {
    expect(scope.size).toBeGreaterThan(300)
    expect(scope.get('functionSearch')).toBe('state')
    expect(scope.get('setFunctionSearch')).toBe('a setter')
    expect(scope.get('functionScrollRef')).toBe('a ref')
    expect(scope.get('selectSoftware')).toBe('a callback over nothing')
    expect(scope.get('renderHotkeys')).toBe('a function made at each render')
    expect(['onNavigate', 'currentPage', 'onContextChange'].map((name) => scope.get(name))).toEqual(['a prop', 'a prop', 'a prop'])
  })

  for (const [view, fn, size] of [['hotkeysView', 'renderHotkeys', 7], ['nodesView', 'renderNodes', 5]]) {
    it(`${view}: everything ${fn}() reads that can change is in its list, its list holds nothing else, and it reads no ref while it draws`, () => {
      expect(problemsOf(otter, view, fn)).toEqual([])
      expect(listIn(otter, view, fn)).toHaveLength(size)
      expect(readsOf(fnIn(otter, fn))).toEqual(expect.arrayContaining(['activeSoftwareSlug', 'selectSoftware']))   // it reads: the walk saw the body
    })
  }

  it('CONTROL: a read planted in renderNodes() is found: state, a prop, a name a parameter elsewhere shadows, a ref\'s value', () => {
    const problems = (code) => problemsOf(plantedInNodes(code), 'nodesView', 'renderNodes')
    expect(problems('void selectedLessonId;')).toEqual(["selectedLessonId (state) is read by renderNodes() and is not in nodesView's list"])
    expect(problems('void currentPage;')).toEqual(["currentPage (a prop) is read by renderNodes() and is not in nodesView's list"])
    // A parameter is its own function's: the read beside the function is the component's.
    expect(problems('[].map((currentView) => currentView); void currentView;')).toEqual(["currentView (state) is read by renderNodes() and is not in nodesView's list"])
    expect(problems('[].map((currentView) => currentView);')).toEqual([])
    expect(problems('void softwareCacheRef.current[activeSoftwareSlug];')).toEqual(['softwareCacheRef.current is read while renderNodes() draws: a ref\'s value is in no list'])
    expect(problems('const { current } = softwareCacheRef; void current;')).toEqual(['softwareCacheRef.current is read while renderNodes() draws: a ref\'s value is in no list'])
    // The same ref read in an event's handler runs after the draw: no problem.
    expect(problems('void (<button onClick={() => softwareCacheRef.current[activeSoftwareSlug]} />);')).toEqual([])
  })

  it('the function handed to the lesson\'s body reads nothing of the component', () => {
    const child = lessonChildOf(otter)
    expect(child?.type).toBe('ArrowFunctionExpression')
    expect(namesIn(child.params[0])).toEqual(['content'])
    expect(readsOf(child)).toEqual([])
    expect(refReadsOf(child)).toEqual([])
    // CONTROL: a prop read planted in it is found.
    const at = '{(content) => ('
    expect(src.split(at)).toHaveLength(2)
    const planted = otterOf(src.replace(at, `${at}void currentPage, `))
    expect(readsOf(lessonChildOf(planted))).toEqual(['currentPage'])
  })
})
