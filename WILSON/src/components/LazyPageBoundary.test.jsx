// @vitest-environment jsdom
// LazyPageBoundary.test.jsx — MO1 (whole-session review round 1): a lazy page that cannot load, or that throws
// while drawing, must not take the whole window with it. Suspense handles only the wait.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { lazy, Suspense } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import LazyPageBoundary, { LazyPart } from './LazyPageBoundary.jsx'

afterEach(cleanup)

describe('a page that will not open', () => {
  it('🚨 says so, and the rest of the window stays', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Page = lazy(() => Promise.reject(new Error('the chunk answered 404')))
    render(<div><p>the rest of the app</p><LazyPageBoundary title="M.O.T.H."><Suspense fallback={null}><Page /></Suspense></LazyPageBoundary></div>)
    expect(await screen.findByText('M.O.T.H. could not open.')).toBeTruthy()
    expect(screen.getByText('the rest of the app')).toBeTruthy()
    vi.restoreAllMocks()
  })
  it('🚨 a page that throws while drawing is held the same way', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Throws = () => { throw new Error('bad row') }
    render(<LazyPageBoundary title="M.O.T.H."><Throws /></LazyPageBoundary>)
    expect(await screen.findByText('M.O.T.H. could not open.')).toBeTruthy()
    vi.restoreAllMocks()
  })
  it('Try again asks the parent for a new load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onRetry = vi.fn()
    const Throws = () => { throw new Error('x') }
    render(<LazyPageBoundary title="M.O.T.H." onRetry={onRetry}><Throws /></LazyPageBoundary>)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1))
    vi.restoreAllMocks()
  })
  it('App.jsx holds Moth inside it', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf8')
    const surface = app.slice(app.indexOf('function MothSurface'), app.indexOf('function MothSurface') + 700)
    expect(surface).toContain('LazyPageBoundary')
    expect(surface).toContain('<Suspense')
  })
})

// ── F11 (the review's shared-client C3): a PART of a page, loaded on its first draw ─────────────────────────────────
// Failing controls, run before the commit: a `lazy()` made once for every attempt turns the Try again test red; a
// `lazy()` made at every draw turns the redraw test red; one static import of a part put back turns the walk red.
describe('F11: LazyPart', () => {
  const Part = ({ label = 'the part' }) => <p>{label}</p>
  it('draws its one waiting line in the part’s place, then the part', async () => {
    let finish
    const load = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    render(<LazyPart load={load} title="Notes" waiting="Opening Notes…">{({ default: P }) => <P />}</LazyPart>)
    expect(screen.getByText('Opening Notes…')).toBeTruthy()
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    finish({ default: Part })
    expect(await screen.findByText('the part')).toBeTruthy()
    expect(screen.queryByText('Opening Notes…')).toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('🚨 a part that cannot load says so in its place, the page stays, and Try again loads it again', async () => {
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValue({ default: Part })
    render(<div><p>the rest of the page</p><LazyPart load={load} title="The migration tools" waiting="Opening…">{({ default: P }) => <P />}</LazyPart></div>)
    expect(await screen.findByText('The migration tools could not open.')).toBeTruthy()
    expect(screen.getByText('the rest of the page')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('the part')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
    silence.mockRestore()
  })
  it('several modules at once (Promise.all) reach the drawing function in order', async () => {
    const load = () => Promise.all([Promise.resolve({ default: () => <p>one</p> }), Promise.resolve({ default: () => <p>two</p> })])
    render(<LazyPart load={load} title="x" waiting="…">{([{ default: A }, { default: B }]) => <><A /><B /></>}</LazyPart>)
    expect(await screen.findByText('one')).toBeTruthy()
    expect(screen.getByText('two')).toBeTruthy()
  })
  it('drawing again with new props draws the part again, without loading it again', async () => {
    const load = vi.fn(async () => ({ default: Part }))
    const { rerender } = render(<LazyPart load={() => load()} title="x" waiting="…">{({ default: P }) => <P label="first" />}</LazyPart>)
    expect(await screen.findByText('first')).toBeTruthy()
    rerender(<LazyPart load={() => load()} title="x" waiting="…">{({ default: P }) => <P label="second" />}</LazyPart>)
    expect(await screen.findByText('second')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('on a light page the sentence takes the light treatment; a page that names no surface keeps what it had', async () => {
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fail = () => Promise.reject(new Error('offline'))
    const { container, unmount } = render(<LazyPart load={fail} title="Light" waiting="…" surface="light">{() => null}</LazyPart>)
    await screen.findByText('Light could not open.')
    expect(container.querySelector('[data-lazy-page-failed]').getAttribute('data-surface')).toBe('light')
    expect(screen.getByRole('button', { name: 'Try again' }).getAttribute('data-variant')).toBe('secondary')
    unmount()
    const before = render(<LazyPageBoundary title="M.O.T.H."><Fails /></LazyPageBoundary>)
    expect(before.container.querySelector('[data-lazy-page-failed]').getAttribute('data-surface')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Try again' }).getAttribute('data-variant')).toBe('ghost')
    silence.mockRestore()
  })
  function Fails() { throw new Error('x') }
})

describe('F11: the three parts are out of the main chunk', () => {
  const SRC = path.join(process.cwd(), 'src')
  const PARTS = [
    'cloud/migrate/MigrationPanel.jsx', 'cloud/migrate/OtterMigrationPanel.jsx', 'cloud/migrate/AttachmentMigrationPanel.jsx',
    'components/Dashboard/NotesView.jsx',
    'components/AdminTerminal/UsersSection.jsx', 'components/AdminTerminal/CompanySection.jsx',
    'components/AdminTerminal/LogsSection.jsx', 'components/AdminTerminal/DiagnosticsSection.jsx',
    'components/AdminTerminal/ChangeRequestsSection.jsx', 'components/AdminTerminal/ModelsSection.jsx',
    'components/AdminTerminal/StorageSection.jsx',
  ]
  // Every relative `import … from` / `export … from` / bare `import '…'` of a source file, comments removed; a
  // dynamic import() is not an edge, which is what puts its module in a chunk of its own.
  const resolveFrom = (from, spec) => {
    const base = path.resolve(path.dirname(from), spec)
    for (const c of [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js'), path.join(base, 'index.jsx')]) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
    }
    return null
  }
  const staticEdges = (file) => {
    const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const specs = [...code.matchAll(/(?:^|[\n;])\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1])
    return specs.map((s) => resolveFrom(file, s)).filter((p) => p && /\.(js|jsx)$/.test(p))
  }
  const reached = (() => {
    const seen = new Set()
    const stack = [path.join(SRC, 'main.jsx')]
    while (stack.length) {
      const f = stack.pop()
      if (seen.has(f)) continue
      seen.add(f)
      stack.push(...staticEdges(f))
    }
    return new Set([...seen].map((p) => path.relative(SRC, p).replace(/\\/g, '/')))
  })()
  it('the walk is real: it reaches the pages that host the parts', () => {
    expect(reached.size).toBeGreaterThan(300)
    for (const host of ['components/SettingsPage.jsx', 'components/AdminTerminal/AdminTerminalPage.jsx', 'components/Dashboard/DashboardPage.jsx', 'components/LazyPageBoundary.jsx']) {
      expect(reached.has(host), host).toBe(true)
    }
  })
  it('🚨 a static import from src/main.jsx reaches none of the eleven files', () => {
    expect(PARTS.filter((p) => reached.has(p))).toEqual([])
  })
  it('each is still reached, through a dynamic import in its host', () => {
    const settings = fs.readFileSync(path.join(SRC, 'components/SettingsPage.jsx'), 'utf8')
    for (const p of ['MigrationPanel', 'OtterMigrationPanel', 'AttachmentMigrationPanel']) expect(settings).toContain(`import('../cloud/migrate/${p}')`)
    expect(fs.readFileSync(path.join(SRC, 'components/AdminTerminal/AdminTerminalPage.jsx'), 'utf8')).toContain("import('./adminSections')")
    expect(fs.readFileSync(path.join(SRC, 'components/Dashboard/DashboardPage.jsx'), 'utf8')).toContain("import('./NotesView')")
  })
})

describe('round 2', () => {
  it('🚨 a window open across a deploy cannot load the old chunk again, so a reload is offered', () => {
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onReload = vi.fn()
    const Broken = () => { throw new Error('the chunk answered 404') }
    render(<LazyPageBoundary title="M.O.T.H." onRetry={() => {}} onReload={onReload}><Broken /></LazyPageBoundary>)
    fireEvent.click(screen.getByRole('button', { name: 'Reload the page' }))
    expect(onReload).toHaveBeenCalledTimes(1)
    silence.mockRestore()
  })
})
