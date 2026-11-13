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
// counts two components: react-markdown's `Markdown` (the lesson's body) and
// `FunctionCard`.
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
// follow what they read (the middle of this file), and the source is read to
// hold that the views' lists of what they read are complete (its end).
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
const world = { writes: [] }
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
    '/api/software/csharp/subjects/loops': SUBJECT,
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

beforeEach(() => { world.writes.length = 0; vi.spyOn(console, 'log').mockImplementation(() => {}) })
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
    const mark = renderSpy.mark()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Mark complete/ })) })
    await waitFor(() => expect(screen.getByRole('button', { name: /Completed/ })).toBeTruthy())
    expect(renderSpy.renders('Otter', mark)).toBeGreaterThan(0)
    // The functions view's own parts, which no other view draws: its course picker, its cards and their code wells. None ran.
    expect(renderSpy.which(['FunctionCard', 'CodeWell', 'Select'], mark)).toEqual([])
  })
})

// ── Each list is what its function reads ─────────────────────────────────────
// The two lists of things the reference views are built again for are written
// by hand beside the views (Otter.jsx). A piece of state read in
// renderHotkeys() or renderNodes() and left out of its list would show as of
// the last change of the others, and no test above would see it until someone
// wrote one for that state. So the source is read: everything each function
// reads of the component's own scope is found, and it is either in the list,
// or one of the three kinds that never change (a ref, a state setter, a
// callback over no deps). The same reading holds that the function handed to
// the lesson's body reads nothing of the component at all.
describe('the source: the views\' lists are what the views read', () => {
  const src = readFileSync(resolve(here, 'Otter.jsx'), 'utf8')
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
  const otter = ast.program.body.map((n) => n.declaration || n).find((n) => n.type === 'FunctionDeclaration' && n.id?.name === 'Otter')
  const namesIn = (pattern, out = []) => {
    if (!pattern) return out
    if (pattern.type === 'Identifier') out.push(pattern.name)
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((e) => namesIn(e, out))
    else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((p) => namesIn(p.value || p.argument, out))
    else if (pattern.type === 'AssignmentPattern') namesIn(pattern.left, out)
    else if (pattern.type === 'RestElement') namesIn(pattern.argument, out)
    return out
  }
  // The component's own names, and how each was made.
  const scope = new Map()
  for (const st of otter.body.body) {
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
  /** Every name of the component's own scope that `fn` reads and does not declare itself. */
  const readsOf = (fn) => {
    const local = new Set()
    const used = new Set()
    const walk = (n, parent, key) => {
      if (!n || typeof n.type !== 'string') return
      if (n.type === 'VariableDeclarator') namesIn(n.id).forEach((x) => local.add(x))
      if (n.type === 'FunctionDeclaration' && n !== fn && n.id) local.add(n.id.name)
      if (/Function/.test(n.type) && n !== fn) n.params.forEach((p) => namesIn(p).forEach((x) => local.add(x)))
      if (n.type === 'CatchClause' && n.param) namesIn(n.param).forEach((x) => local.add(x))
      if (n.type === 'Identifier') {
        const memberName = (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && key === 'property' && !parent.computed
        const propertyKey = (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') && key === 'key' && !parent.computed
        if (!memberName && !propertyKey) used.add(n.name)
      }
      for (const k of Object.keys(n)) {
        if (k === 'loc' || k === 'start' || k === 'end' || k === 'extra' || k.endsWith('Comments')) continue
        const v = n[k]
        if (Array.isArray(v)) v.forEach((c) => walk(c, n, k))
        else if (v && typeof v.type === 'string') walk(v, n, k)
      }
    }
    fn.params.forEach((p) => namesIn(p).forEach((x) => local.add(x)))
    walk(fn.body, fn, 'body')
    return [...used].filter((x) => scope.has(x) && !local.has(x)).sort()
  }
  const fnNamed = (name) => otter.body.body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === name)
  /** The deps of `const <name> = useMemo(() => <fn>(), [...])`. */
  const listOf = (name, fn) => {
    const decl = otter.body.body.flatMap((st) => (st.type === 'VariableDeclaration' ? st.declarations : [])).find((d) => d.id.name === name)
    expect(decl?.init?.callee?.name, `${name} is a useMemo`).toBe('useMemo')
    const [build, deps] = decl.init.arguments
    expect(build.body.type === 'CallExpression' && build.body.callee.name, `${name} is built by ${fn}()`).toBe(fn)
    return deps.elements.map((e) => e.name).sort()
  }
  const NEVER_CHANGES = new Set(['a ref', 'a setter', 'a callback over nothing'])

  it('reads the component it means to: more than three hundred names, each kind among them', () => {
    expect(scope.size).toBeGreaterThan(300)
    expect(scope.get('functionSearch')).toBe('state')
    expect(scope.get('setFunctionSearch')).toBe('a setter')
    expect(scope.get('functionScrollRef')).toBe('a ref')
    expect(scope.get('selectSoftware')).toBe('a callback over nothing')
    expect(scope.get('renderHotkeys')).toBe('a function made at each render')
  })

  for (const [view, fn] of [['hotkeysView', 'renderHotkeys'], ['nodesView', 'renderNodes']]) {
    it(`${view}: everything ${fn}() reads that can change is in its list, and its list holds nothing else`, () => {
      const reads = readsOf(fnNamed(fn))
      const canChange = reads.filter((name) => !NEVER_CHANGES.has(scope.get(name)))
      expect(canChange.map((name) => `${name}: ${scope.get(name)}`)).toEqual(canChange.map((name) => `${name}: state`))
      expect(listOf(view, fn)).toEqual(canChange)
    })
  }

  it('CONTROL: a read added to renderNodes() is found (the lesson\'s id, which its list does not hold)', () => {
    const planted = src.replace("const systems = Array.isArray(softwareNodes?.systems) ? softwareNodes.systems : [];", "const systems = Array.isArray(softwareNodes?.systems) ? softwareNodes.systems : []; void selectedLessonId;")
    expect(planted).not.toBe(src)
    const tree = parse(planted, { sourceType: 'module', plugins: ['jsx'] })
    const comp = tree.program.body.map((n) => n.declaration || n).find((n) => n.type === 'FunctionDeclaration' && n.id?.name === 'Otter')
    const reads = readsOf(comp.body.body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === 'renderNodes'))
    expect(reads).toContain('selectedLessonId')
    expect(listOf('nodesView', 'renderNodes')).not.toContain('selectedLessonId')
  })

  it('the function handed to the lesson\'s body reads nothing of the component', () => {
    const found = []
    const walk = (n) => {
      if (!n || typeof n.type !== 'string') return
      if (n.type === 'JSXElement' && n.openingElement.name.name === 'LessonBodyOnce') found.push(n)
      for (const k of Object.keys(n)) {
        if (k === 'loc' || k === 'start' || k === 'end' || k === 'extra' || k.endsWith('Comments')) continue
        const v = n[k]
        if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v.type === 'string') walk(v)
      }
    }
    walk(otter)
    expect(found).toHaveLength(1)
    const child = found[0].children.find((c) => c.type === 'JSXExpressionContainer' && /Function/.test(c.expression.type))?.expression
    expect(child?.type).toBe('ArrowFunctionExpression')
    expect(namesIn(child.params[0])).toEqual(['content'])
    expect(readsOf(child)).toEqual([])
  })
})
