/** @vitest-environment jsdom */
// =============================================================================
// ProjectFilesExplorer.test.jsx — UI overhaul C1.
//
// 🚨 WHY THIS FILE EXISTS, AND WHAT IT CAN AND CANNOT PROVE.
//
// The plan's §7 says every visual claim is checked in the RUNNING app, and it
// is right. But the dev server in tester mode has no session, so every
// cloud-backed table on this surface is empty in the browser: the project
// picker offers nothing and neither view ever renders a row. The page chrome,
// the ground, the toolbar and all three empty states were screenshotted
// (`docs/sessions/handoffs/img/`); the ROWS could not be.
//
// So this file mounts the component with real fixture rows and pins the
// structural facts a screenshot of an empty page cannot: the column contract
// lane B converges on, the fixed-width icon slot that finally lets the name
// column left-align, the numeric columns, the sorted-indent fix, and the
// three distinct states. It uses F1's render harness (vitest + jsdom +
// Testing Library, opted into by the docblock on line 1).
//
// It cannot prove pixels. It can prove that the DOM the pixels come from is
// the one the review asked for.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// 🚨 THE VITEST JOB HAS NO `.env.local`. This file mounts a real component, so
// it pulls in whatever that component's imports pull in — and somewhere down
// that graph is `supabaseClient`, which calls `createClient` AT MODULE LOAD
// and throws "supabaseUrl is required." when the env vars are absent. Locally
// the file is there and everything is green; in CI the whole test file fails
// to import, with a message that says nothing about this test.
//
// `pages.test.js` hit the same wall and solved it the same way (commit
// 720affb). The mock is the smallest shape the client's importers touch.
vi.mock('../../cloud/auth/supabaseClient', () => ({
  supabase: {},
  hydrateSupabase: async () => {},
}))


const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'resources.css'), 'utf8')
const source = readFileSync(resolve(here, 'ProjectFilesExplorer.jsx'), 'utf8')

// 🚨 The "this value is gone" assertions below scan CODE, not comments. The
// component's header comment names every value it retired and every helper it
// replaced — which is the point of the comment — and a naive scan of the whole
// file therefore fails on the explanation of the fix rather than on the fix.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n')

// The page reads everything through `useRabbit()`, and RabbitContext is not
// exported, so the hook is the seam. The adapter below is the shape the page
// actually calls: three list functions and nothing else.
const FOLDERS = [
  { id: 'root', kind: 'root', path: '', name: 'Project' },
  { id: 'assets', kind: 'entity', path: 'ASSETS', name: 'ASSETS', parent_id: 'root' },
  { id: 'hero', kind: 'entity', path: 'ASSETS/hero-shot', name: 'hero-shot', parent_id: 'assets' },
]
const FILES = [
  {
    id: '1', name: 'brief.pdf', folder_id: 'root', size_bytes: 10_240,
    mime_type: 'application/pdf', created_at: '2026-09-01T10:00:00Z',
  },
  {
    id: '2', name: 'hero_v3.mov', folder_id: 'hero', size_bytes: 98_000_000,
    mime_type: 'video/quicktime', created_at: '2026-09-02T10:00:00Z',
    source_modified_at: '2026-09-03T10:00:00Z', duration_sec: 42.5,
    storage_provider: 'supabase',
  },
]

const REAL_ADAPTER = () => ({
  listFolders: async () => FOLDERS,
  listFiles: async () => FILES,
  listManagedFiles: async () => [],
})

// 🚨 MUTABLE ON PURPOSE. The `vi.mock` below closes over this object, so a
// test that needs a different context changes THIS one and puts it back.
const ctx = {
  projectsIndex: { p1: { id: 'p1', title: 'Smoke one' }, p2: { id: 'p2', title: 'Smoke two', is_private: true } },
  activeProjectId: 'p1',
  getAdapter: REAL_ADAPTER,
}

vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({
  useRabbit: () => ctx,
}))

// Post-overhaul S4a: the page asks who may edit (usePermissions, through
// useProjectAccess too). The real hook reads a Supabase session; this is the
// fixtures' admin, ONE object for every render (a fresh object per call would
// re-run every effect that depends on it — B4b's trap 9).
const perms = { role: 'admin', ready: true, workspaceId: 'w1', userId: 'u1' }
vi.mock('../../permissions/usePermissions', () => ({
  usePermissions: () => perms,
}))

const { default: ProjectFilesExplorer } = await import('./ProjectFilesExplorer')
const { navigateTo } = await import('../../tools/rabbit_v0.1.0/state/rabbitNavigate')
const { pushModal, _resetOverlaysForTests } = await import('../../ui/overlay')

afterEach(cleanup)

/** Mount, wait for the adapter promises, and switch to the table view. */
async function mountTable(props) {
  const utils = render(<ProjectFilesExplorer {...(props || {})} />)
  // The page opens on COLUMNS, so waiting for a <table> here waits out the
  // full findBy timeout and finds nothing — eight callers, eight seconds. Wait
  // for the tab (which appears once the adapter promises settle), then switch.
  const tab = await screen.findByRole('tab', { name: 'Table' })
  fireEvent.click(tab)
  return utils
}

// ── S4c: the Table shows one folder at a time, so a test that wants a file
// in a sub-folder walks there first, by the folder's name button (a click
// from Testing Library has `detail` 0, the keyboard's, so the settle guard
// never holds it back). The crumb and the rows, read as the person reads them.
const rowsOf = () => [...document.querySelectorAll('.ui-table[data-files-table] tbody tr')]
const namesOf = () => rowsOf().map(r => r.querySelector('.fx-name-text').textContent)
const crumbOf = () => [...document.querySelectorAll('[data-files-crumbs] [data-crumb]')].map(c => c.textContent)
const enter = (name) => fireEvent.click(screen.getByRole('button', { name }))
const rowNamed = (name) => rowsOf().find(r => r.textContent.includes(name))
const upButton = () => document.querySelector('[data-folder-up]')
const filterBox = () => screen.getByLabelText('Filter')
const search = (q) => fireEvent.change(filterBox(), { target: { value: q } })

describe('the Files page — the chrome', () => {
  it('does NOT render the page title a second time (F-R06)', async () => {
    render(<ProjectFilesExplorer />)
    await screen.findByRole('tablist')
    // The orange bar's PageHeader is the only H1, and this page adds no
    // heading of its own at any level.
    expect(document.querySelectorAll('h1, h2, h3')).toHaveLength(0)
    expect(code).not.toMatch(/text-lg/)
  })

  it('keeps BOTH views and the project picker, the filter and Refresh (C1)', async () => {
    render(<ProjectFilesExplorer />)
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map(t => t.textContent)).toEqual(['Table', 'Columns'])
    expect(screen.getByLabelText('Project')).toBeTruthy()
    // `type="search"`, which is what it was: the browser's own clear
    // affordance came with that type, and swapping it for a hand-rolled
    // button would be exchanging one control for another under C1.
    expect(screen.getByLabelText('Filter').getAttribute('type')).toBe('search')
    expect(screen.getByTitle("Reload this project's folders and files")).toBeTruthy()
  })

  it('the view switch and Refresh are no longer the same object (F-R16)', () => {
    // One `btnStyle(active)` helper drew the two-state radio AND the
    // idempotent command, so the row offered three identical pills for two
    // kinds of decision. Neither control was removed; they are different
    // components in different toolbar slots now.
    expect(code).not.toMatch(/btnStyle/)
    expect(code).toMatch(/<Tabs/)
    expect(code).toMatch(/icon=\{RefreshCw\}/)
  })

  it('the toolbar controls sit at the 28px control height, tabs included', () => {
    // Toolbar's contract is one baseline for the whole row. `index.css`
    // enforced it for four kit classes but not for `.ui-tab` (36px), so the
    // view switch stood 8px proud until this page pinned it.
    //
    // 📌 F3 took the rule into the kit and F4 retired this page's copy. The
    // PROPERTY is unchanged and the OWNER moved, so this asserts it where it
    // now lives — and then asserts the copy is gone, which is the half that
    // would otherwise rot into a second source of truth.
    const kit = readFileSync(resolve(here, '../../index.css'), 'utf8')
    const rule = kit.match(/\.ui-toolbar \.ui-btn[\s\S]*?\{[^}]*\}/)
    expect(rule, 'no toolbar baseline rule in index.css').not.toBeNull()
    expect(rule[0]).toContain('.ui-toolbar .ui-tab')
    expect(rule[0]).toContain('height: var(--control-sm)')
    expect(css).not.toMatch(/\.rs-page \.ui-toolbar \.ui-tab\b/)
  })

  it('and the tab strip itself no longer needs a page-local nowrap', () => {
    // Same move: `.rs-page .ui-toolbar .ui-tabs` was this page's copy of a
    // rule that is now `.ui-toolbar .ui-tabs` in the kit (F4). Both
    // declarations came with it, so retiring the copy is a no-op — and the
    // `flex-shrink: 0` half is the one that matters here, because the view
    // switch has to hold its width against the picker beside it.
    const kit = readFileSync(resolve(here, '../../index.css'), 'utf8')
    const scoped = kit.match(/\n {2}\.ui-toolbar \.ui-tabs \{([^}]*)\}/)
    expect(scoped, 'no .ui-toolbar .ui-tabs rule in index.css').not.toBeNull()
    expect(scoped[1]).toContain('flex-wrap: nowrap')
    expect(scoped[1]).toContain('flex-shrink: 0')
    expect(css).not.toMatch(/\.rs-page \.ui-toolbar \.ui-tabs\b/)
  })
})

describe('the Files table — the contract lane B converges on', () => {
  it('is the shared kit Table in `dense` mode, not a hand-built one', async () => {
    await mountTable()
    const table = document.querySelector('table.ui-table')
    expect(table, 'the table is the kit component').toBeTruthy()
    // Q11: 36px app-wide, 32px `dense` for the media tables, set by the VIEW.
    expect(table.getAttribute('data-dense')).toBe('true')
    expect(table.hasAttribute('data-files-table')).toBe(true)
  })

  it('declares six columns in a folder and seven in a search, each set summing to exactly 100 (S4c)', async () => {
    await mountTable()
    const ths = () => [...document.querySelectorAll('.ui-table[data-files-table] th')]
    // In a folder the crumb names every row's parent, so there is no
    // Location column; Name takes its width.
    expect(ths().map(t => t.textContent.trim())).toEqual([
      'Name', 'Type', 'Size', 'Created', 'Modified', 'Duration',
    ])
    // `table-layout: fixed` reads the header row, so an over-summing set of
    // percentages is not a declared grid at all — the browser reconciles the
    // excess and every column lands somewhere other than where it was written.
    const total = () => ths().reduce((n, t) => n + parseFloat(t.style.width), 0)
    expect(total()).toBe(100)
    // A search lists matches from the whole tree, so Location comes back.
    search('hero')
    expect(ths().map(t => t.textContent.trim())).toEqual([
      'Name', 'Type', 'Size', 'Created', 'Modified', 'Duration', 'Location',
    ])
    expect(total()).toBe(100)
  })

  it('right-aligns every figure with tabular mono, headers included (F-R10)', async () => {
    await mountTable()
    const table = document.querySelector('.ui-table[data-files-table]')
    const numericHeads = [...table.querySelectorAll('th[data-numeric]')].map(t => t.textContent.trim())
    expect(numericHeads).toEqual(['Size', 'Created', 'Modified', 'Duration'])
    // Declared once on HEADERS, so a header and its cells cannot disagree —
    // which is what left Size and Duration in monospace AND left-aligned.
    for (const th of table.querySelectorAll('th[data-numeric]')) {
      expect(th.getAttribute('data-align')).toBe('right')
    }
    const row = table.querySelector('tbody tr:last-child')
    expect([...row.querySelectorAll('td[data-numeric]')]).toHaveLength(4)
    // The kit, not this page, owns what `numeric` means.
    expect(readFileSync(resolve(here, '../../index.css'), 'utf8'))
      .toMatch(/\.ui-th\[data-numeric="true"\], \.ui-td\[data-numeric="true"\] \{ font-variant-numeric: tabular-nums; \}/)
  })

  it('gives the name column ONE x origin: a fixed-width icon slot (F11)', async () => {
    await mountTable()
    const names = [...document.querySelectorAll('.ui-table[data-files-table] .fx-name')]
    expect(names.length).toBeGreaterThan(1)
    // Both kinds render the SAME element in the SAME slot. The old '▸' and '·'
    // were two glyphs of different advance widths, so a file name and a folder
    // name in one listing started at different x positions.
    for (const n of names) {
      expect(n.querySelector('svg.fx-name-icon'), 'every row has the icon slot').toBeTruthy()
    }
    expect(css).toMatch(/\.fx-name-icon \{\s*flex: 0 0 var\(--icon-md\);/)
    // …and the slot IS the column's leading edge: no depth indent survives to
    // move it row by row, so "one x origin" is one x origin for the whole
    // column, not one per depth.
    expect(css).toMatch(/\.fx-name \{ display: flex; align-items: center; min-width: 0; \}/)
    const xs = new Set(names.map(n => Math.round(n.getBoundingClientRect().x)))
    expect(xs.size, 'every name slot starts at the same x').toBe(1)
  })

  it('lists ONE folder: its folders first, then its files, each sorted by the column; no indent, every sort state reachable (S4c, F-R12 settled)', async () => {
    // F-R12's lying indent cannot arise now: every row in the Table has the
    // same parent, the one the crumb names, and a sort reorders the folder's
    // own children (fileTree.folderRows), never a flattened tree.
    await mountTable()
    expect(namesOf(), 'the root: its folder, then its file').toEqual(['ASSETS', 'brief.pdf'])
    expect(crumbOf()).toEqual(['Project'])
    for (const n of document.querySelectorAll('.ui-table[data-files-table] .fx-name')) {
      expect(n.getAttribute('style'), 'no per-row indent survives').toBeNull()
    }
    // A second file at the root, and a second folder: the sort stays within
    // each group, and Name descending inverts each group, not the list.
    const two = [...FILES, { id: '7', name: 'aaa.txt', folder_id: 'root', size_bytes: 1, mime_type: 'text/plain', created_at: '2026-09-05T10:00:00Z' }]
    const folders = [...FOLDERS, { id: 'zed', kind: 'category', path: 'ZED', name: 'ZED', parent_id: 'root' }]
    ctx.getAdapter = () => ({ listFolders: async () => folders, listFiles: async () => two, listManagedFiles: async () => [] })
    cleanup()
    await mountTable()
    expect(namesOf()).toEqual(['ASSETS', 'ZED', 'aaa.txt', 'brief.pdf'])
    const nameTh = [...document.querySelectorAll('.ui-table[data-files-table] th')].find(t => t.textContent.trim() === 'Name')
    expect(nameTh.getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(within(nameTh).getByRole('button'))
    expect(nameTh.getAttribute('aria-sort')).toBe('descending')
    expect(namesOf(), 'folders stay first; each group inverts').toEqual(['ZED', 'ASSETS', 'brief.pdf', 'aaa.txt'])
    // Size descending: a folder has no size, and still sits first.
    const sizeTh = [...document.querySelectorAll('.ui-table[data-files-table] th')].find(t => t.textContent.trim() === 'Size')
    fireEvent.click(within(sizeTh).getByRole('button'))
    fireEvent.click(within(sizeTh).getByRole('button'))
    expect(sizeTh.getAttribute('aria-sort')).toBe('descending')
    expect(namesOf()).toEqual(['ASSETS', 'ZED', 'brief.pdf', 'aaa.txt'])
    ctx.getAdapter = REAL_ADAPTER
  })

  it('keeps the sort slot reserved so the header label never shifts', async () => {
    await mountTable()
    const th = [...document.querySelectorAll('.ui-table[data-files-table] th')]
      .find(t => t.textContent.trim() === 'Size')
    // Present whether or not the column is the sort field — an arrow that
    // appears on click shoves the label sideways under the pointer, at the one
    // moment you are looking straight at it.
    expect(th.querySelector('.ui-th-sort')).toBeTruthy()
    expect(th.hasAttribute('aria-sort')).toBe(false)
    fireEvent.click(within(th).getByRole('button'))
    expect(th.getAttribute('aria-sort')).toBe('ascending')
  })

  it('makes every row interactive — a folder opens, a file selects — through a name button on each; the row stays a plain <tr> (S4c)', async () => {
    await mountTable()
    const rows = rowsOf()
    const files = rows.filter(r => r.getAttribute('data-node-kind') === 'file')
    const folders = rows.filter(r => r.getAttribute('data-node-kind') === 'folder')
    expect(files.length).toBeGreaterThan(0)
    expect(folders.length).toBeGreaterThan(0)
    // Both kinds answer the pointer now (F-R11's hover on the shared Row): a
    // folder row opens on a click, which is what the pointer promises.
    for (const r of rows) expect(r.hasAttribute('data-interactive')).toBe(true)
    // The name cell is a <button> for BOTH kinds — the keyboard reaches a
    // folder as it reaches a file — and the row itself gains no role and no
    // tab stop: the buttons carry the (roving) focus.
    for (const r of rows) {
      expect(r.querySelector('button.fx-name-btn[data-node-id]')).toBeTruthy()
      expect(r.hasAttribute('role')).toBe(false)
      expect(r.hasAttribute('tabindex')).toBe(false)
    }
    expect(folders[0].querySelector('button').hasAttribute('data-folder-name')).toBe(true)
    expect(files[0].querySelector('button').hasAttribute('data-file-name')).toBe(true)
    fireEvent.click(folders[0])
    expect(crumbOf()).toEqual(['Project', 'ASSETS'])
  })

  it('selects a file row with the one selected treatment', async () => {
    await mountTable()
    const fileRow = document.querySelector('.ui-table[data-files-table] tbody tr[data-node-kind="file"]')
    fireEvent.click(fileRow)
    expect(fileRow.hasAttribute('data-selected')).toBe(true)
    // One fill plus a 2px signal left edge, from the kit — not a fourth alpha.
    expect(readFileSync(resolve(here, '../../index.css'), 'utf8'))
      .toMatch(/\.ui-tr\[data-selected="true"\] > \.ui-td:first-child \{ box-shadow: inset 2px 0 0 0 var\(--color-signal\); \}/)
  })

  it('carries no zebra, no cream header and no second ink', () => {
    // The three values the review measured on this page: `#f5efe6` (the only
    // use in the app, luminance 0.869 against the page's 0.459), the two zebra
    // alphas, and `MUTED #7c4f1f` carrying six of seven columns at 3.40:1.
    for (const dead of ['#f5efe6', '#7c4f1f', 'rgba(120, 70, 30, 0.12)', 'rgba(120, 70, 30, 0.22)', 'ROW_A', 'ROW_B']) {
      expect(code, `${dead} is gone from the Files page`).not.toContain(dead)
    }
    // …and no hex of any kind is written in this component any more (C8: a
    // colour that is not in `@theme` does not exist).
    expect(code).not.toMatch(/#[0-9a-fA-F]{6}\b/)
  })
})

describe('the Files page — the three states are three pictures (F-R13)', () => {
  // 🚨 The `vi.mock` above closes over `ctx`, so the way to drive a different
  // context is to MUTATE it, not to build a second object the mock never
  // reads. An earlier cut of this test did the latter and asserted
  // `expect(spy).toBeDefined()` — which `vi.spyOn` guarantees — so it could
  // not fail, and its three real assertions grepped the source rather than
  // the DOM. An adversarial review called it the worst test in the file and
  // was right.
  // 🚨 BOTH fields, and in the HOOK. Two tests below swap `getAdapter` and
  // used to put it back as their last statement — which does not run if an
  // assertion throws, so one failure leaked a held-open adapter into every
  // later test in the file and buried its own cause.
  afterEach(() => { ctx.activeProjectId = 'p1'; ctx.getAdapter = REAL_ADAPTER })

  it('says "no project chosen" before a project is chosen', async () => {
    ctx.activeProjectId = null
    render(<ProjectFilesExplorer />)
    await screen.findByRole('tablist')
    expect(screen.getByText('No project chosen')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('status', { name: /Loading/ })).toBeNull()
  })

  it('draws skeleton ROWS while loading, not the empty state', async () => {
    // The defect was one component serving all three, so a slow adapter and an
    // empty project were the same picture — which on this page is the whole
    // question. The adapter is held open here so the loading state is real
    // rather than asserted from the source.
    let release
    ctx.getAdapter = () => ({
      listFolders: () => new Promise((r) => { release = () => r(FOLDERS) }),
      listFiles: async () => FILES,
      listManagedFiles: async () => [],
    })
    render(<ProjectFilesExplorer />)
    const loading = await screen.findByRole('status', { name: /Loading/ })
    expect(loading.querySelectorAll('.ui-skeleton').length).toBeGreaterThan(0)
    expect(screen.queryByText('Nothing filed yet')).toBeNull()
    release()
    // …and once it resolves the skeleton is replaced by the real thing.
    await screen.findByRole('tab', { name: 'Table' })
  })

  it('says "nothing filed yet" for a project with no folders or files', async () => {
    ctx.getAdapter = () => ({
      listFolders: async () => [],
      listFiles: async () => [],
      listManagedFiles: async () => [],
    })
    render(<ProjectFilesExplorer />)
    expect(await screen.findByText('Nothing filed yet')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('never hands EmptyState a loading string', () => {
    // The kit console.errors on this in DEV, and Logs shipped exactly that
    // bug. The old `Empty` component served all three states, so "Loading…"
    // and "No folders or files yet." were the same picture.
    //
    // The check is on what EmptyState is PASSED, not on what sits near it:
    // `<Loading>` is rendered as a sibling two lines away, which is the fix
    // rather than the defect.
    for (const el of code.match(/<EmptyState[\s\S]*?\/>/g) || []) {
      expect(el, 'an EmptyState carrying a loading string').not.toMatch(/[Ll]oading/)
    }
    // Five since S4c: no project, nothing filed, the Columns view's empty
    // folder, and the Table's two — an empty folder and a search that matches
    // nothing.
    expect((code.match(/<EmptyState/g) || []).length).toBe(5)
    expect((code.match(/<Loading /g) || []).length).toBe(1)
  })
})

describe('the details panel', () => {
  it('keeps all eight facts, as a two-column grid (F-R33)', async () => {
    await mountTable()
    fireEvent.click(document.querySelector('.ui-table[data-files-table] tbody tr[data-node-kind="file"]'))
    const panel = document.querySelector('[data-file-details]')
    const labels = [...panel.querySelectorAll('dt')].map(d => d.textContent)
    expect(labels).toEqual(['Name', 'Type', 'Size', 'Created', 'Modified', 'Duration', 'Location', 'Stored'])
    // The pair wrapper must not become the grid item, or the 96px label column
    // measures the wrapper instead of the label.
    expect(css).toMatch(/\.fx-details-pair \{ display: contents; \}/)
    expect(css).toMatch(/grid-template-columns: 96px minmax\(0, 1fr\)/)
    // The numeric facts take the mono; the prose ones do not.
    const numeric = [...panel.querySelectorAll('dd[data-numeric]')].length
    expect(numeric).toBe(4)
  })
})

describe('the Finder columns are the same object as the table', () => {
  it('shares the row height, the cell inset and the icon slot', async () => {
    render(<ProjectFilesExplorer />)
    const col = await screen.findByRole('tabpanel')
    const items = col.querySelectorAll('.fx-col-item')
    expect(items.length).toBeGreaterThan(0)
    for (const i of items) expect(i.querySelector('svg.fx-name-icon')).toBeTruthy()
    // 32px rows and the 12px cell inset, the same two tokens the dense table
    // uses — the two views were 32px zebra rows against 27px flat buttons.
    expect(css).toMatch(/\.fx-col-item \{[^}]*height: var\(--row-dense\);/s)
    expect(css).toMatch(/\.fx-col-item \{[^}]*padding: 0 var\(--cell-pad-x\);/s)
    // F-R11's other half: these are real buttons that had no hover fill.
    expect(css).toMatch(/\.fx-col-item:hover \{ background-color: var\(--color-hover\); \}/)
  })
})

// ── Post-overhaul S4a: one explorer, two hosts (Audrey's E8) ─────────────────
// RESOURCES → FILES passes nothing; R.A.B.B.I.T.'s Files tab passes the open
// project and showPicker={false}. On the tab, the page reads the project again
// whenever the provider's files / folders / managed files change, keeps the
// selected file across that read, lays the provider's own rows over what the
// adapter returned, and drops an answer that arrives after a newer one.
describe('one explorer, two hosts (S4a, E8)', () => {
  afterEach(() => {
    ctx.activeProjectId = 'p1'
    ctx.getAdapter = REAL_ADAPTER
    delete ctx.files
    delete ctx.folders
    delete ctx.managedFiles
  })

  /** An adapter that counts its reads and answers from `answers()`. */
  function countingAdapter(answers = () => FILES) {
    const calls = []
    return {
      calls,
      make: () => ({
        listFolders: async () => FOLDERS,
        listFiles: async (id) => { calls.push(id); return answers() },
        listManagedFiles: async () => [],
      }),
    }
  }

  const fileNames = () => [...document.querySelectorAll('.ui-table[data-files-table] .fx-name-text')].map(n => n.textContent)

  it('the tab host: no picker, the open project, data-host="rabbit"', async () => {
    const a = countingAdapter()
    ctx.getAdapter = a.make
    render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    await screen.findByRole('tab', { name: 'Table' })
    expect(screen.queryByLabelText('Project')).toBeNull()
    expect(document.querySelector('[data-files-explorer]').getAttribute('data-host')).toBe('rabbit')
    expect(a.calls).toEqual(['p1'])
  })

  it('CONTROL: the Resources host still has its picker and says so', async () => {
    render(<ProjectFilesExplorer />)
    await screen.findByRole('tab', { name: 'Table' })
    expect(screen.getByLabelText('Project')).toBeTruthy()
    expect(document.querySelector('[data-files-explorer]').getAttribute('data-host')).toBe('resources')
  })

  it('reads again when the provider\'s files change, and keeps the selected file', async () => {
    const a = countingAdapter()
    ctx.getAdapter = a.make
    ctx.files = [FILES[0]]
    const { rerender } = render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Table' }))
    // S4c: the file sits in ASSETS › hero-shot; walk there.
    enter('ASSETS'); enter('hero-shot')
    const row = () => [...document.querySelectorAll('.ui-table[data-files-table] tbody tr')].find(r => r.textContent.includes('hero_v3.mov'))
    fireEvent.click(row())
    expect(row().hasAttribute('data-selected')).toBe(true)
    expect(a.calls.length).toBe(1)
    // CONTROL first: a render with the SAME files array reads nothing.
    rerender(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    await new Promise(r => setTimeout(r, 0))
    expect(a.calls.length).toBe(1)
    // A new array (an upload, a teammate's edit) → one more read.
    ctx.files = [FILES[0], { ...FILES[1] }]
    rerender(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    // While that read is in flight the table stays on screen: no skeleton for
    // a refetch of the project already shown (asserted BEFORE the answer).
    expect(screen.queryByRole('status', { name: /Loading/ })).toBeNull()
    expect(row(), 'the table is still drawn during the read').toBeTruthy()
    await waitFor(() => expect(a.calls.length).toBe(2))
    expect(row().hasAttribute('data-selected'), 'the selection survives the read').toBe(true)
  })

  it('reads again when the open project\'s FOLDERS or MANAGED files change too (round 1, mutants 8 and 9)', async () => {
    const a = countingAdapter()
    ctx.getAdapter = a.make
    ctx.folders = [FOLDERS[0]]
    ctx.managedFiles = []
    const { rerender } = render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    await screen.findByRole('tab', { name: 'Table' })
    expect(a.calls.length).toBe(1)
    ctx.folders = [...FOLDERS]
    rerender(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    await waitFor(() => expect(a.calls.length).toBe(2))
    ctx.managedFiles = [{ id: 'm9', file_name: 'take.mov', stored_name: 'take.mov', folder_path: '' }]
    rerender(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    await waitFor(() => expect(a.calls.length).toBe(3))
  })

  it('Refresh shows a change the provider MISSED: the adapter\'s row wins when it is newer (round 1, R1-UI-09)', async () => {
    ctx.files = [{ ...FILES[0], updated_at: '2026-09-01T10:00:00Z' }]
    ctx.getAdapter = () => ({ ...REAL_ADAPTER(), listFiles: async () => [{ ...FILES[0], name: 'brief_RENAMED.pdf', updated_at: '2026-09-05T10:00:00Z' }, FILES[1]] })
    render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Table' }))
    expect(fileNames()).toContain('brief_RENAMED.pdf')
    expect(fileNames()).not.toContain('brief.pdf')
  })

  it('CONTROL: an adapter answer OLDER than the provider\'s row (a refetch racing a save) still loses', async () => {
    ctx.files = [{ ...FILES[0], name: 'brief-saved.pdf', updated_at: '2026-09-05T10:00:00Z' }]
    ctx.getAdapter = () => ({ ...REAL_ADAPTER(), listFiles: async () => [{ ...FILES[0], updated_at: '2026-09-01T10:00:00Z' }, FILES[1]] })
    render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Table' }))
    expect(fileNames()).toContain('brief-saved.pdf')
    expect(fileNames()).not.toContain('brief.pdf')
  })

  it('CONTROL: an adapter answer of the SAME age loses too — a save still in flight keeps the stamp it had (round 2, R2-TST, M07)', async () => {
    ctx.files = [{ ...FILES[0], name: 'brief-SAVING.pdf', updated_at: '2026-09-01T10:00:00Z' }]
    ctx.getAdapter = () => ({ ...REAL_ADAPTER(), listFiles: async () => [{ ...FILES[0], updated_at: '2026-09-01T10:00:00Z' }, FILES[1]] })
    render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Table' }))
    expect(fileNames()).toContain('brief-SAVING.pdf')
    expect(fileNames()).not.toContain('brief.pdf')
  })

  it('lays the open project\'s provider rows over the adapter\'s, by id', async () => {
    ctx.files = [{ ...FILES[0], name: 'brief-final.pdf' }]
    render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Table' }))
    expect(fileNames()).toContain('brief-final.pdf')
    expect(fileNames()).not.toContain('brief.pdf')
  })

  it('CONTROL: a project that is NOT open gets no overlay (its rows are the adapter\'s)', async () => {
    ctx.files = [{ ...FILES[0], name: 'brief-final.pdf' }]
    ctx.activeProjectId = 'p2'
    render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Table' }))
    expect(fileNames()).toContain('brief.pdf')
    expect(fileNames()).not.toContain('brief-final.pdf')
  })

  it('"Show in Files" before the files have loaded stays PENDING, then selects the file (round 1, R1-TST-19)', async () => {
    let release
    ctx.getAdapter = () => ({ ...REAL_ADAPTER(), listFiles: () => new Promise((r) => { release = () => r(FILES) }) })
    navigateTo({ view: 'files', fileId: '2', projectId: 'p1' })
    render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    await new Promise((r) => setTimeout(r, 0)) // mounted, the tree not loaded: declined, kept
    await act(async () => { release() })
    await waitFor(() => expect(document.querySelector('[data-file-details]')?.getAttribute('data-file-details')).toBe('f:2'))
  })

  it('drops an answer that arrives after a newer one', async () => {
    let releaseOld
    let n = 0
    ctx.getAdapter = () => ({
      listFolders: async () => FOLDERS,
      listFiles: () => {
        n += 1
        if (n === 2) return new Promise((r) => { releaseOld = () => r([{ ...FILES[0], name: 'stale.pdf' }]) })
        return Promise.resolve(n === 1 ? FILES : [{ ...FILES[0], name: 'newest.pdf' }])
      },
      listManagedFiles: async () => [],
    })
    ctx.files = [FILES[1]]
    const { rerender } = render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Table' }))
    ctx.files = [{ ...FILES[1] }]            // read 2: held open (the stale one)
    rerender(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    ctx.files = [{ ...FILES[1] }]            // read 3: answers at once
    rerender(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    await waitFor(() => expect(fileNames()).toContain('newest.pdf'))
    releaseOld()
    await new Promise(r => setTimeout(r, 0))
    expect(fileNames(), 'the older answer must not land').not.toContain('stale.pdf')
    expect(fileNames()).toContain('newest.pdf')
  })
})

// ── Post-overhaul S4a, step 3: the three controls that left the Summary ──────
// Audrey's E1: "both go; those three controls move to the Files tab; the
// project-folder controls stay in the Control Panel." Add files (still to the
// project root, `{ type: 'project' }`), the missing-files Relink notice with
// its dialog, and File activity for the selected file.
describe('the Files tab\'s toolbar: Add files, Relink, File activity (E1)', () => {
  afterEach(() => {
    ctx.activeProjectId = 'p1'
    ctx.getAdapter = REAL_ADAPTER
    delete ctx.uploadFile
    delete ctx.adapterMode
  })

  const onTab = () => render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)

  it('the tab has Add files and File activity; the Resources page has neither (CONTROL)', async () => {
    ctx.adapterMode = 'supabase'
    const { unmount } = onTab()
    await screen.findByRole('tab', { name: 'Table' })
    expect(screen.getByRole('button', { name: /Add files/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /File activity/ })).toBeTruthy()
    unmount()
    render(<ProjectFilesExplorer />)
    await screen.findByRole('tab', { name: 'Table' })
    expect(screen.queryByRole('button', { name: /Add files/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /File activity/ })).toBeNull()
  })

  it('Add files uploads each picked file to the project root, { type: "project" }', async () => {
    ctx.adapterMode = 'supabase'
    const calls = []
    ctx.uploadFile = async (file, scope) => { calls.push([file.name, scope]) }
    onTab()
    await screen.findByRole('tab', { name: 'Table' })
    const input = document.querySelector('input[type="file"]')
    const a = new File(['a'], 'a.pdf', { type: 'application/pdf' })
    const b = new File(['b'], 'b.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [a, b] } })
    await waitFor(() => expect(calls).toEqual([['a.pdf', { type: 'project' }], ['b.png', { type: 'project' }]]))
  })

  it('an upload refusal is READ on screen, not logged (the S37 rule, moved with it)', async () => {
    ctx.adapterMode = 'supabase'
    ctx.uploadFile = async () => { throw new Error('This workspace stores files on its own server.') }
    onTab()
    await screen.findByRole('tab', { name: 'Table' })
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(['a'], 'a.pdf')] } })
    expect(await screen.findByText('This workspace stores files on its own server.')).toBeTruthy()
  })

  it('File activity waits for a selected file, then opens the drawer on THAT file', async () => {
    ctx.adapterMode = 'supabase'
    let asked = null
    ctx.getAdapter = () => ({ ...REAL_ADAPTER(), listFileEvents: async (id) => { asked = id; return [] } })
    onTab()
    fireEvent.click(await screen.findByRole('tab', { name: 'Table' }))
    const button = screen.getByRole('button', { name: /File activity/ })
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('title')).toBe('Select a file to see its activity')
    enter('ASSETS'); enter('hero-shot')
    const hero = [...document.querySelectorAll('.ui-table[data-files-table] tbody tr')].find(r => r.textContent.includes('hero_v3.mov'))
    fireEvent.click(hero)
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(await screen.findByRole('complementary', { name: 'File activity' })).toBeTruthy()
    await waitFor(() => expect(asked).toBe('2'))
  })

  it('the missing-files notice: a count, on the kit Banner, and Relink… opens the dialog', async () => {
    ctx.adapterMode = 'local_server'
    ctx.getAdapter = () => ({ ...REAL_ADAPTER(), relinkScan: async () => ({ missing: [{ id: 'x' }, { id: 'y' }], candidates: [] }) })
    onTab()
    const notice = await screen.findByText(/2 files can.t be found on disk/)
    expect(notice.closest('.ui-banner')?.getAttribute('data-tone')).toBe('warning')
    fireEvent.click(screen.getByRole('button', { name: /Relink…/ }))
    expect(await screen.findByRole('dialog', { name: 'Relink missing files' })).toBeTruthy()
  })

  it('after a relink is applied the census runs again, and the notice goes (round 1, mutant 10)', async () => {
    ctx.adapterMode = 'local_server'
    const row = { id: '1', name: 'brief.pdf', storage_path: 'old/brief.pdf', size_bytes: 10_240 }
    let applied = false
    ctx.getAdapter = () => ({
      ...REAL_ADAPTER(),
      relinkScan: async (_pid, dir) => (applied
        ? { missing: [], candidates: [] }
        : { missing: [row], candidates: dir ? [{ relPath: 'brief.pdf', name: 'brief.pdf', size: 10_240 }] : [] }),
      relinkApply: async () => { applied = true; return { relinked: 1, filesDir: 'D:\\moved' } },
    })
    window.electronAPI = { rabbit: { pickDirectory: async () => 'D:\\moved' } }
    try {
      onTab()
      expect(await screen.findByText(/1 file can.t be found on disk/)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /Relink…/ }))
      const dialog = await screen.findByRole('dialog', { name: 'Relink missing files' })
      fireEvent.click(await within(dialog).findByRole('button', { name: /Choose folder/ }))
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Relink 1 file' }))
      await waitFor(() => expect(screen.queryByText(/can.t be found on disk/)).toBeNull())
    } finally {
      delete window.electronAPI
    }
  })

  it('an upload refusal belongs to its project: another project does not inherit it (round 1, R1-UI-11)', async () => {
    ctx.adapterMode = 'supabase'
    ctx.uploadFile = async () => { throw new Error('This workspace stores files on its own server.') }
    const { rerender } = onTab()
    await screen.findByRole('tab', { name: 'Table' })
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(['a'], 'a.pdf')] } })
    expect(await screen.findByText('This workspace stores files on its own server.')).toBeTruthy()
    ctx.activeProjectId = 'p2'
    rerender(<ProjectFilesExplorer projectId="p2" showPicker={false} />)
    await waitFor(() => expect(screen.queryByText('This workspace stores files on its own server.')).toBeNull())
  })

  it('…nor one that ARRIVES after the switch, from an upload still in flight (round 2, R2-TST-12)', async () => {
    ctx.adapterMode = 'supabase'
    let refuse
    ctx.uploadFile = () => new Promise((_, reject) => { refuse = () => reject(new Error('This workspace stores files on its own server.')) })
    const { rerender } = onTab()
    await screen.findByRole('tab', { name: 'Table' })
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(['a'], 'a.pdf')] } })
    await waitFor(() => expect(refuse).toBeTypeOf('function'))
    ctx.activeProjectId = 'p2'
    rerender(<ProjectFilesExplorer projectId="p2" showPicker={false} />)
    await act(async () => { refuse() })
    expect(screen.queryByText('This workspace stores files on its own server.')).toBeNull()
    expect(document.querySelector('[data-upload-error]')).toBeNull()
  })

  it('CONTROL: a backend with no relinkScan (the cloud) draws no notice at all', async () => {
    ctx.adapterMode = 'supabase'
    onTab()
    await screen.findByRole('tab', { name: 'Table' })
    expect(screen.queryByText(/can.t be found on disk/)).toBeNull()
  })

  it('a read-only backend greys Add files and says why', async () => {
    ctx.adapterMode = 'google_drive'
    const calls = []
    ctx.uploadFile = async (f) => { calls.push(f) }
    onTab()
    await screen.findByRole('tab', { name: 'Table' })
    const gate = screen.getByRole('button', { name: /Add files/ }).closest('[aria-disabled="true"]')
    expect(gate?.getAttribute('title')).toBe('This backend is read-only.')
  })
})

// V2, the second visual QA pass (2026-09-27), B4c §4.2 item 1: "the Files
// page cuts every Created / Modified date at every width, with no title".
// toLocaleString's "9/10/2026, 7:35:00 PM" needs about 170px of the mono and
// the column gives it about 106 at 1280. The date is the short one the other
// file tables print ("Sep 10, 2026", about 94px): whole at 1280 and 1440,
// still right-aligned as a figure (F-R10), and its time is in the tooltip.
describe('the Files table: its dates (V2)', () => {
  it('prints the short date and keeps the date and time in the cell\'s tooltip', async () => {
    await mountTable()
    const heads = [...document.querySelectorAll('.ui-table[data-files-table] th')].map((t) => t.textContent.trim())
    const cells = (name) => [...rowsOf().find((tr) => tr.textContent.includes(name)).querySelectorAll('td')]
    // S4c: a folder has no date, and so no tooltip (ASSETS › hero-shot).
    enter('ASSETS')
    expect(cells('hero-shot')[heads.indexOf('Created')].hasAttribute('title')).toBe(false)
    enter('hero-shot')
    const hero = cells('hero_v3.mov')
    const created = hero[heads.indexOf('Created')]
    const modified = hero[heads.indexOf('Modified')]
    const short = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    expect(created.textContent).toBe(short('2026-09-02T10:00:00Z'))
    expect(modified.textContent).toBe(short('2026-09-03T10:00:00Z'))
    expect(created.getAttribute('title')).toBe(new Date('2026-09-02T10:00:00Z').toLocaleString())
    expect(modified.getAttribute('title')).toBe(new Date('2026-09-03T10:00:00Z').toLocaleString())
    // Still a figure: right-aligned, tabular (F-R10).
    expect(created.getAttribute('data-numeric')).toBe('true')
  })
})

// ── Post-overhaul S4b: Add as Legal ─────────────────────────────────────────
// Audrey, 2026-10-01: a Legal file is seen by "same as money files for now"
// (workspace admins and the project's managers), and Legal is chosen when the
// file is ADDED — "its just the folder that is locked". The one control: a
// secondary "Add as Legal" beside Add files, drawn only for those people; the
// picker first, then a confirmation naming the files and who will see them;
// then each upload carries `legal: true`. Where the database lacks 0088 the
// control is greyed with the reason.
describe('Add as Legal (S4b)', () => {
  const LEGAL_ADD_HINT = 'Only project managers and workspace admins will see these files.'
  const LEGAL_UNAVAILABLE = 'Legal files need a database update (migration 0088) that has not reached this workspace yet.'
  const LEGAL_LOCAL_NOTE = 'On this computer\'s storage Legal is a folder, not a lock: restrict the LEGAL folder on the drive or NAS itself.'
  const legalAdapter = (supported = true) => () => ({ ...REAL_ADAPTER(), supportsLegalFiles: async () => supported })

  afterEach(() => {
    ctx.activeProjectId = 'p1'
    ctx.getAdapter = REAL_ADAPTER
    delete ctx.uploadFile
    delete ctx.adapterMode
    delete ctx.myProjectRole
    delete ctx.projectIsStaffed
    perms.role = 'admin'
  })

  const onTab = (projectId = 'p1') => render(<ProjectFilesExplorer projectId={projectId} showPicker={false} />)
  const legalButton = () => screen.queryByRole('button', { name: /Add as Legal/ })
  const legalInput = () => document.querySelector('[data-legal-input]')
  const pick = (names) => fireEvent.change(legalInput(), {
    target: { files: names.map(n => new File([n], n, { type: 'application/pdf' })) },
  })
  /** A cloud seat on the open project. */
  const seat = (appRole, projectRole) => {
    ctx.adapterMode = 'supabase'
    perms.role = appRole
    ctx.myProjectRole = projectRole
    ctx.projectIsStaffed = true
  }
  const settle = () => new Promise(r => setTimeout(r, 0))

  it('a project manager has it; picking files asks first, naming them and who will see them', async () => {
    seat('member', 'manager')
    ctx.getAdapter = legalAdapter(true)
    const calls = []
    ctx.uploadFile = async (file, scope) => { calls.push([file.name, scope]) }
    onTab()
    await screen.findByRole('tab', { name: 'Table' })
    await waitFor(() => expect(legalInput()).toBeTruthy())
    const button = legalButton()
    expect(button.getAttribute('title')).toBe(LEGAL_ADD_HINT)
    // The button opens the picker (the hidden input) and nothing else.
    const opened = vi.spyOn(legalInput(), 'click')
    fireEvent.click(button)
    expect(opened).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    pick(['release_A.pdf', 'nda.pdf'])
    const dialog = await screen.findByRole('dialog', { name: 'Add these 2 files as Legal?' })
    expect([...dialog.querySelectorAll('[data-legal-names] li')].map(li => li.textContent)).toEqual(['release_A.pdf', 'nda.pdf'])
    expect(within(dialog).getByText(LEGAL_ADD_HINT)).toBeTruthy()
    expect(within(dialog).getByText('Legal is chosen when a file is added. To change it later, add the file again.')).toBeTruthy()
    // Nothing is uploaded before the confirm.
    expect(calls).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 2 as Legal' }))
    await waitFor(() => expect(calls).toEqual([
      ['release_A.pdf', { type: 'project', legal: true }],
      ['nda.pdf', { type: 'project', legal: true }],
    ]))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('CONTROL: Add files beside it still uploads plain files, never `legal`', async () => {
    seat('member', 'manager')
    ctx.getAdapter = legalAdapter(true)
    const calls = []
    ctx.uploadFile = async (file, scope) => { calls.push([file.name, scope]) }
    onTab()
    await screen.findByRole('tab', { name: 'Table' })
    await waitFor(() => expect(legalInput()).toBeTruthy())
    // Add files' own input, named so (review round 1, R1-BEH-14: "the first
    // file input" leaned on the DOM order).
    const plain = document.querySelector('input[type="file"]:not([data-legal-input])')
    expect(plain).toBeTruthy()
    fireEvent.change(plain, { target: { files: [new File(['a'], 'a.pdf')] } })
    await waitFor(() => expect(calls).toEqual([['a.pdf', { type: 'project' }]]))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('one file: the singular title and button', async () => {
    seat('admin', null)
    ctx.getAdapter = legalAdapter(true)
    onTab()
    await waitFor(() => expect(legalInput()).toBeTruthy())
    pick(['release_A.pdf'])
    const dialog = await screen.findByRole('dialog', { name: 'Add this file as Legal?' })
    expect(within(dialog).getByRole('button', { name: 'Add as Legal' })).toBeTruthy()
  })

  it('many files: five names, then how many more', async () => {
    seat('admin', null)
    ctx.getAdapter = legalAdapter(true)
    onTab()
    await waitFor(() => expect(legalInput()).toBeTruthy())
    pick(['1.pdf', '2.pdf', '3.pdf', '4.pdf', '5.pdf', '6.pdf', '7.pdf'])
    const dialog = await screen.findByRole('dialog', { name: 'Add these 7 files as Legal?' })
    const items = [...dialog.querySelectorAll('[data-legal-names] li')].map(li => li.textContent)
    expect(items).toEqual(['1.pdf', '2.pdf', '3.pdf', '4.pdf', '5.pdf', 'and 2 more'])
    expect(within(dialog).getByRole('button', { name: 'Add 7 as Legal' })).toBeTruthy()
  })

  it('Cancel uploads nothing, and the same files can be picked again', async () => {
    seat('admin', null)
    ctx.getAdapter = legalAdapter(true)
    const calls = []
    ctx.uploadFile = async (file, scope) => { calls.push([file.name, scope]) }
    onTab()
    await waitFor(() => expect(legalInput()).toBeTruthy())
    // A browser fires no change for the same file picked twice unless the
    // input is emptied; jsdom keeps a file input's value '' whatever happens,
    // so the emptying is recorded at the setter (planted fault M5-12).
    const emptied = []
    Object.defineProperty(legalInput(), 'value', { configurable: true, get: () => '', set: (v) => { emptied.push(v) } })
    pick(['nda.pdf'])
    const dialog = await screen.findByRole('dialog', { name: 'Add this file as Legal?' })
    expect(emptied).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls).toEqual([])
    expect(emptied).toEqual([''])
    pick(['nda.pdf'])
    expect(await screen.findByRole('dialog', { name: 'Add this file as Legal?' })).toBeTruthy()
  })

  it('a confirmed upload empties the picker too', async () => {
    seat('admin', null)
    ctx.getAdapter = legalAdapter(true)
    const calls = []
    ctx.uploadFile = async (file, scope) => { calls.push([file.name, scope]) }
    onTab()
    await waitFor(() => expect(legalInput()).toBeTruthy())
    const emptied = []
    Object.defineProperty(legalInput(), 'value', { configurable: true, get: () => '', set: (v) => { emptied.push(v) } })
    pick(['nda.pdf'])
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Add as Legal' }))
    await waitFor(() => expect(calls.length).toBe(1))
    await waitFor(() => expect(emptied).toEqual(['']))
  })

  it('a refusal is READ on screen, in the same banner as Add files\'', async () => {
    seat('admin', null)
    ctx.getAdapter = legalAdapter(true)
    ctx.uploadFile = async () => { throw new Error('Only project managers and workspace admins can add Legal files.') }
    onTab()
    await waitFor(() => expect(legalInput()).toBeTruthy())
    pick(['nda.pdf'])
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Add as Legal' }))
    const banner = await screen.findByText('Only project managers and workspace admins can add Legal files.')
    expect(banner.closest('[data-upload-error]')).toBeTruthy()
  })

  it('a member, a reviewer, and a workspace manager without a manager seat are not shown it at all', async () => {
    for (const [appRole, projectRole] of [['member', 'member'], ['member', 'reviewer'], ['manager', 'member'], ['manager', null]]) {
      seat(appRole, projectRole)
      let probed = false
      ctx.getAdapter = () => ({ ...REAL_ADAPTER(), supportsLegalFiles: async () => { probed = true; return true } })
      const { unmount } = onTab()
      await screen.findByRole('tab', { name: 'Table' })
      await settle()
      expect(legalButton(), `${appRole}/${projectRole}`).toBeNull()
      expect(legalInput(), `${appRole}/${projectRole}`).toBeNull()
      expect(document.querySelector('[data-add-legal]'), `${appRole}/${projectRole}`).toBeNull()
      // Not even asked: the page does not probe for a control it will not draw.
      expect(probed, `${appRole}/${projectRole}`).toBe(false)
      // CONTROL: Add files is still there for them (a member writes plain files).
      expect(screen.getByRole('button', { name: /Add files/ })).toBeTruthy()
      unmount()
    }
  })

  it('CONTROL: a project manager and a workspace admin ARE shown it', async () => {
    for (const [appRole, projectRole] of [['member', 'manager'], ['manager', 'manager'], ['admin', null], ['admin', 'member']]) {
      seat(appRole, projectRole)
      ctx.getAdapter = legalAdapter(true)
      const { unmount } = onTab()
      await waitFor(() => expect(legalInput(), `${appRole}/${projectRole}`).toBeTruthy())
      expect(legalButton()).toBeTruthy()
      unmount()
    }
  })

  it('where the database lacks 0088 it is greyed, says why, and opens nothing', async () => {
    seat('admin', null)
    ctx.getAdapter = legalAdapter(false)
    onTab()
    await screen.findByRole('tab', { name: 'Table' })
    await settle()
    const gate = legalButton().closest('[aria-disabled="true"]')
    expect(gate?.getAttribute('title')).toBe(LEGAL_UNAVAILABLE)
    expect(legalInput()).toBeNull()
    fireEvent.click(legalButton())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('while the database is being asked it says so — not that a migration is missing (review round 1, R1-BEH-09)', async () => {
    seat('admin', null)
    let answer
    ctx.getAdapter = () => ({ ...REAL_ADAPTER(), supportsLegalFiles: () => new Promise((r) => { answer = r }) })
    onTab()
    await screen.findByRole('tab', { name: 'Table' })
    await waitFor(() => expect(answer).toBeTypeOf('function'))
    const gate = () => legalButton().closest('[aria-disabled="true"]')
    expect(gate()?.getAttribute('title')).toBe('Checking whether this workspace can keep Legal files…')
    expect(legalInput()).toBeNull()
    await act(async () => { answer(true) })
    await waitFor(() => expect(legalInput()).toBeTruthy())
    expect(gate()).toBeNull()
  })

  it('a seat that arrives after the page asks again, and says "Checking…" meanwhile (planted fault R2-4)', async () => {
    seat('member', 'member')
    let answer
    ctx.getAdapter = () => ({ ...REAL_ADAPTER(), supportsLegalFiles: () => new Promise((r) => { answer = r }) })
    const { rerender } = onTab()
    await screen.findByRole('tab', { name: 'Table' })
    await settle()
    expect(legalButton()).toBeNull()
    // The manager seat loads: the control appears, and the database is asked.
    ctx.myProjectRole = 'manager'
    rerender(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    await waitFor(() => expect(answer).toBeTypeOf('function'))
    expect(legalButton().closest('[aria-disabled="true"]')?.getAttribute('title'))
      .toBe('Checking whether this workspace can keep Legal files…')
    await act(async () => { answer(true) })
    await waitFor(() => expect(legalInput()).toBeTruthy())
  })

  it('an answer that is not exactly true is "not available"', async () => {
    seat('admin', null)
    ctx.getAdapter = () => ({ ...REAL_ADAPTER(), supportsLegalFiles: async () => 'yes' })
    onTab()
    await screen.findByRole('tab', { name: 'Table' })
    await settle()
    expect(legalButton().closest('[aria-disabled="true"]')?.getAttribute('title')).toBe(LEGAL_UNAVAILABLE)
  })

  it('the confirm closes, uploading nothing, when the person loses the gate while it is open (review round 1, R1-BEH-15)', async () => {
    seat('member', 'manager')
    ctx.getAdapter = legalAdapter(true)
    const calls = []
    ctx.uploadFile = async (file, scope) => { calls.push([file.name, scope]) }
    const { rerender } = onTab()
    await waitFor(() => expect(legalInput()).toBeTruthy())
    pick(['nda.pdf'])
    expect(await screen.findByRole('dialog', { name: 'Add this file as Legal?' })).toBeTruthy()
    ctx.myProjectRole = 'member'
    rerender(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(legalButton()).toBeNull()
    expect(calls).toEqual([])
  })

  it('…and so does a backend with no Legal probe at all (fail closed)', async () => {
    seat('admin', null)
    ctx.getAdapter = REAL_ADAPTER
    onTab()
    await screen.findByRole('tab', { name: 'Table' })
    await settle()
    expect(legalButton().closest('[aria-disabled="true"]')?.getAttribute('title')).toBe(LEGAL_UNAVAILABLE)
  })

  it('a probe that throws is "not available", not "available"', async () => {
    seat('admin', null)
    ctx.getAdapter = () => ({ ...REAL_ADAPTER(), supportsLegalFiles: async () => { throw new Error('network') } })
    onTab()
    await screen.findByRole('tab', { name: 'Table' })
    await settle()
    expect(legalButton().closest('[aria-disabled="true"]')?.getAttribute('title')).toBe(LEGAL_UNAVAILABLE)
  })

  it('a read-only backend greys it with the write reason first', async () => {
    perms.role = 'admin'
    ctx.adapterMode = 'google_drive'
    ctx.getAdapter = legalAdapter(true)
    onTab()
    await screen.findByRole('tab', { name: 'Table' })
    await settle()
    expect(legalButton().closest('[aria-disabled="true"]')?.getAttribute('title')).toBe('This backend is read-only.')
  })

  it('on the Local Server it is there (no roles) and says Legal is a folder there, not a lock — never that only managers will see it', async () => {
    ctx.adapterMode = 'local_server'
    perms.role = 'member'
    ctx.getAdapter = legalAdapter(true)
    onTab()
    await waitFor(() => expect(legalInput()).toBeTruthy())
    // The button's own line (review round 1, R1-BEH-02: it promised the
    // managers-only rule this backend cannot keep).
    expect(legalButton().getAttribute('title')).toBe(LEGAL_LOCAL_NOTE)
    pick(['nda.pdf'])
    const dialog = await screen.findByRole('dialog', { name: 'Add this file as Legal?' })
    expect(within(dialog).getByText(LEGAL_LOCAL_NOTE)).toBeTruthy()
    expect(dialog.textContent).not.toContain(LEGAL_ADD_HINT)
  })

  it('CONTROL: the cloud\'s confirm carries no Local Server note', async () => {
    seat('admin', null)
    ctx.getAdapter = legalAdapter(true)
    onTab()
    await waitFor(() => expect(legalInput()).toBeTruthy())
    pick(['nda.pdf'])
    const dialog = await screen.findByRole('dialog', { name: 'Add this file as Legal?' })
    expect(dialog.querySelector('[data-legal-local]')).toBeNull()
  })

  it('the Resources page never has it, even for an admin', async () => {
    seat('admin', null)
    ctx.getAdapter = legalAdapter(true)
    render(<ProjectFilesExplorer />)
    await screen.findByRole('tab', { name: 'Table' })
    await settle()
    expect(legalButton()).toBeNull()
    expect(legalInput()).toBeNull()
  })

  it('a pick made on one project is not offered on the next, nor on coming back', async () => {
    seat('admin', null)
    ctx.getAdapter = legalAdapter(true)
    const calls = []
    ctx.uploadFile = async (file, scope) => { calls.push([file.name, scope]) }
    const { rerender } = onTab('p1')
    await waitFor(() => expect(legalInput()).toBeTruthy())
    pick(['nda.pdf'])
    expect(await screen.findByRole('dialog')).toBeTruthy()
    ctx.activeProjectId = 'p2'
    rerender(<ProjectFilesExplorer projectId="p2" showPicker={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Back on p1: the pick was dropped, not hidden (planted fault M5-19).
    ctx.activeProjectId = 'p1'
    rerender(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    await screen.findByRole('tab', { name: 'Table' })
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls).toEqual([])
  })
})

// ── Post-overhaul S4c: the Table navigates like an explorer ─────────────────
// Audrey, 2026-10-05: "i should be able to press into a folder and the table
// should show the files/folders in that folder … at the top i should see the
// breadcrumb path … think how the table view works in windows explorer". One
// folder at a time, a crumb bar with an Up button, Backspace and Alt+← go
// up, the search box reaches the whole tree, and the Columns view keeps the
// same place. Each guard below has its CONTROL: the state in which the guard
// must NOT act, which a version without the guard would get wrong.
describe('the Table as an explorer (S4c)', () => {
  afterEach(() => { _resetOverlaysForTests(); ctx.getAdapter = REAL_ADAPTER })
  const keyOn = (el, key, init = {}) => fireEvent.keyDown(el, { key, ...init })
  const focusedName = () => document.activeElement?.getAttribute?.('data-node-id') || null

  it('opens on the project folder: folders then files, the crumb "Project", Up greyed, no Location column', async () => {
    await mountTable()
    expect(namesOf()).toEqual(['ASSETS', 'brief.pdf'])
    expect(crumbOf()).toEqual(['Project'])
    expect(document.querySelector('[data-files-crumbs] [aria-current="location"]').textContent).toBe('Project')
    expect(upButton().disabled).toBe(true)
    expect(upButton().getAttribute('title')).toBe('This is the project folder')
    expect(document.querySelector('[data-files-table]').getAttribute('data-mode')).toBe('folder')
  })

  it('a click on a folder row enters it; the crumb grows; Up names the parent and the key; a crumb goes back', async () => {
    await mountTable()
    fireEvent.click(rowNamed('ASSETS'))
    expect(crumbOf()).toEqual(['Project', 'ASSETS'])
    expect(namesOf()).toEqual(['hero-shot'])
    expect(upButton().disabled).toBe(false)
    expect(upButton().getAttribute('title')).toBe('Up to Project (Backspace)')
    enter('hero-shot')
    expect(crumbOf()).toEqual(['Project', 'ASSETS', 'hero-shot'])
    expect(namesOf()).toEqual(['hero_v3.mov'])
    expect(upButton().getAttribute('title')).toBe('Up to ASSETS (Backspace)')
    // Every crumb but the last is a button; the last is where you are.
    const crumbButtons = [...document.querySelectorAll('[data-files-crumbs] button.fx-crumb-btn')].map(b => b.textContent)
    expect(crumbButtons).toEqual(['Project', 'ASSETS'])
    fireEvent.click(screen.getByRole('button', { name: 'ASSETS', exact: true }))
    expect(crumbOf()).toEqual(['Project', 'ASSETS'])
    fireEvent.click(upButton())
    expect(crumbOf()).toEqual(['Project'])
    expect(namesOf()).toEqual(['ASSETS', 'brief.pdf'])
  })

  it('entering a folder clears the selected file (the window closes) — the file is not in this folder any more', async () => {
    await mountTable()
    fireEvent.click(rowNamed('brief.pdf'))
    expect(document.querySelector('[data-file-details]')).toBeTruthy()
    enter('ASSETS')
    expect(document.querySelector('[data-file-details]')).toBeNull()
  })

  it('Backspace on a row goes up, and focus lands on the folder just left; Alt+← does the same', async () => {
    await mountTable()
    enter('ASSETS'); enter('hero-shot')
    const hero = screen.getByRole('button', { name: 'hero_v3.mov' })
    hero.focus()
    keyOn(hero, 'Backspace')
    expect(crumbOf()).toEqual(['Project', 'ASSETS'])
    await waitFor(() => expect(focusedName()).toBe('hero'))
    keyOn(document.activeElement, 'ArrowLeft', { altKey: true })
    expect(crumbOf()).toEqual(['Project'])
    await waitFor(() => expect(focusedName()).toBe('assets'))
  })

  it('CONTROL: Backspace does nothing at the root, with Shift, in the search box, under a dialog, or while the page is off screen', async () => {
    const { rerender } = await mountTable({ projectId: 'p1', showPicker: false, pageActive: true })
    // At the root there is nowhere to go.
    const assets = screen.getByRole('button', { name: 'ASSETS' })
    assets.focus()
    keyOn(assets, 'Backspace')
    expect(crumbOf()).toEqual(['Project'])
    enter('ASSETS')
    // Shift+Backspace is not the key.
    const hero = screen.getByRole('button', { name: 'hero-shot' })
    hero.focus()
    keyOn(hero, 'Backspace', { shiftKey: true })
    expect(crumbOf()).toEqual(['Project', 'ASSETS'])
    // In the search box Backspace edits the query: the handler is not there.
    filterBox().focus()
    keyOn(filterBox(), 'Backspace')
    expect(crumbOf()).toEqual(['Project', 'ASSETS'])
    // Under a kit dialog or menu the table's keys stand down.
    const release = pushModal({})
    hero.focus()
    keyOn(hero, 'Backspace')
    expect(crumbOf()).toEqual(['Project', 'ASSETS'])
    release()
    // While R.A.B.B.I.T. is not the page on screen, nothing acts.
    rerender(<ProjectFilesExplorer projectId="p1" showPicker={false} pageActive={false} />)
    hero.focus()
    keyOn(hero, 'Backspace')
    expect(crumbOf()).toEqual(['Project', 'ASSETS'])
    // …and back on screen, the same key goes up (the gate, not a dead key).
    rerender(<ProjectFilesExplorer projectId="p1" showPicker={false} pageActive={true} />)
    hero.focus()
    keyOn(hero, 'Backspace')
    expect(crumbOf()).toEqual(['Project'])
    // While a query is typed the rows are a search, not a folder: Backspace
    // on a result neither changes the folder underneath nor clears the query.
    enter('ASSETS')
    search('hero')
    const result = screen.getByRole('button', { name: 'hero_v3.mov' })
    result.focus()
    keyOn(result, 'Backspace')
    keyOn(result, 'ArrowLeft', { altKey: true })
    expect(filterBox().value).toBe('hero')
    expect(document.querySelector('[data-files-table]').getAttribute('data-mode')).toBe('search')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(crumbOf(), 'the folder underneath was untouched').toEqual(['Project', 'ASSETS'])
  })

  it('Enter on a folder\'s name opens it; the arrows, Home and End walk the name buttons, one of which is in the tab order', async () => {
    const files = [...FILES, { id: '7', name: 'aaa.txt', folder_id: 'root', size_bytes: 1, mime_type: 'text/plain', created_at: '2026-09-05T10:00:00Z' }]
    ctx.getAdapter = () => ({ ...REAL_ADAPTER(), listFiles: async () => files })
    await mountTable()
    expect(namesOf()).toEqual(['ASSETS', 'aaa.txt', 'brief.pdf'])
    const buttons = () => [...document.querySelectorAll('[data-files-table] [data-node-id]')]
    expect(buttons().map(b => b.tabIndex)).toEqual([0, -1, -1])
    buttons()[0].focus()
    keyOn(buttons()[0], 'ArrowDown')
    expect(focusedName()).toBe('f:7')
    keyOn(document.activeElement, 'End')
    expect(focusedName()).toBe('f:1')
    keyOn(document.activeElement, 'ArrowDown')
    expect(focusedName(), 'the last row stays').toBe('f:1')
    keyOn(document.activeElement, 'Home')
    expect(focusedName()).toBe('assets')
    keyOn(document.activeElement, 'ArrowUp')
    expect(focusedName(), 'the first row stays').toBe('assets')
    // Enter on a folder's name is the button's click: the folder opens, and
    // focus goes to its first row.
    fireEvent.click(document.activeElement)
    expect(crumbOf()).toEqual(['Project', 'ASSETS'])
    await waitFor(() => expect(focusedName()).toBe('hero'))
    // The selected file's row is the one in the tab order.
    fireEvent.click(upButton())
    fireEvent.click(rowNamed('brief.pdf'))
    expect(buttons().map(b => b.tabIndex)).toEqual([-1, -1, 0])
  })

  it('the second click of a double-click (detail 2) on the new folder\'s row is dropped; a FRESH click (detail 1) and a keyboard click (detail 0) right after a move are never held back', async () => {
    await mountTable()
    fireEvent.click(rowNamed('ASSETS'), { detail: 1 })
    expect(crumbOf()).toEqual(['Project', 'ASSETS'])
    // The second click of the double-click lands on the new folder's first row.
    fireEvent.click(rowNamed('hero-shot'), { detail: 2 })
    expect(crumbOf(), 'held back').toEqual(['Project', 'ASSETS'])
    // A fresh click is a new gesture (round 2, item 5: holding every click
    // for a fixed time was both too short for a slow double-click and a
    // needless wait for a quick person).
    fireEvent.click(rowNamed('hero-shot'), { detail: 1 })
    expect(crumbOf()).toEqual(['Project', 'ASSETS', 'hero-shot'])
    // CONTROL: a keyboard click (detail 0) right after a move is never held back.
    fireEvent.click(upButton())
    expect(crumbOf()).toEqual(['Project', 'ASSETS'])
    enter('hero-shot')
    expect(crumbOf()).toEqual(['Project', 'ASSETS', 'hero-shot'])
  })

  it('the window is by the clock and longer than any OS double-click time: a detail-2 click 100 ms and 999 ms after a move is held, at 1,000 ms it acts; the name button the same', async () => {
    await mountTable()
    const now = vi.spyOn(Date, 'now')
    try {
      now.mockReturnValue(1_000_000)
      fireEvent.click(rowNamed('ASSETS'), { detail: 1 })
      expect(crumbOf()).toEqual(['Project', 'ASSETS'])
      now.mockReturnValue(1_000_100)
      fireEvent.click(rowNamed('hero-shot'), { detail: 2 })
      expect(crumbOf(), 'held back at 100 ms').toEqual(['Project', 'ASSETS'])
      // The name button's own click too (it stops the row's).
      fireEvent.click(rowNamed('hero-shot').querySelector('[data-node-id]'), { detail: 2 })
      expect(crumbOf(), 'the name button is held back too').toEqual(['Project', 'ASSETS'])
      now.mockReturnValue(1_000_999)
      fireEvent.click(rowNamed('hero-shot'), { detail: 3 })
      expect(crumbOf(), 'held back at 999 ms').toEqual(['Project', 'ASSETS'])
      now.mockReturnValue(1_001_000)
      fireEvent.click(rowNamed('hero-shot'), { detail: 2 })
      expect(crumbOf()).toEqual(['Project', 'ASSETS', 'hero-shot'])
    } finally { now.mockRestore() }
  })

  it('a double-click on a folder opens it ONCE: the dblclick that lands on the new folder\'s row within the window previews nothing; past it, a double-click previews (review round 1, item 5)', async () => {
    await mountTable()
    const now = vi.spyOn(Date, 'now')
    try {
      now.mockReturnValue(2_000_000)
      enter('ASSETS')
      // The double-click, 480 ms apart (slower than round 1's window, within
      // Windows' default 500 ms): its first click opens the folder, its
      // second (detail 2) is held, and the dblclick fires on the file now
      // under the pointer.
      now.mockReturnValue(2_002_000)
      fireEvent.click(rowNamed('hero-shot'), { detail: 1 })
      expect(crumbOf()).toEqual(['Project', 'ASSETS', 'hero-shot'])
      now.mockReturnValue(2_002_480)
      fireEvent.click(rowNamed('hero_v3.mov'), { detail: 2 })
      fireEvent.doubleClick(rowNamed('hero_v3.mov'))
      expect(document.querySelector('[data-file-preview]'), 'no preview of a file nobody chose').toBeNull()
      now.mockReturnValue(2_003_000)
      fireEvent.doubleClick(rowNamed('hero_v3.mov'))
      expect(document.querySelector('[data-file-preview]')).toBeTruthy()
    } finally { now.mockRestore() }
  })

  it('the keys stand down in a text field inside the table area — by the element, whatever the case of its tag name', async () => {
    await mountTable()
    enter('ASSETS')
    const main = document.querySelector('.fx-main')
    const input = document.createElement('input')
    main.appendChild(input)
    try {
      input.focus()
      keyOn(input, 'Backspace')
      expect(crumbOf(), 'Backspace in a field edits the field').toEqual(['Project', 'ASSETS'])
      keyOn(input, 'ArrowLeft', { altKey: true })
      expect(crumbOf()).toEqual(['Project', 'ASSETS'])
    } finally { main.removeChild(input) }
  })

  it('Alt+← is taken, never the browser\'s Back: at the project folder and during a search it is prevented and does nothing; a plain ← is left alone (review round 1, item 9)', async () => {
    await mountTable()
    const row = rowNamed('ASSETS').querySelector('[data-node-id]')
    row.focus()
    expect(fireEvent.keyDown(row, { key: 'ArrowLeft', altKey: true }), 'prevented at the root').toBe(false)
    expect(crumbOf()).toEqual(['Project'])
    expect(fireEvent.keyDown(row, { key: 'ArrowLeft' }), 'a plain ← is not the explorer\'s').toBe(true)
    enter('ASSETS')
    search('hero')
    const match = document.querySelector('[data-files-table] [data-node-id]')
    expect(fireEvent.keyDown(match, { key: 'ArrowLeft', altKey: true }), 'prevented in a search').toBe(false)
    expect(document.querySelector('[data-files-table]').getAttribute('data-mode')).toBe('search')
  })

  it('the search box reaches the whole tree: matches with their Location, a count, Clear returns to the folder you were in', async () => {
    await mountTable()
    enter('ASSETS')
    search('hero')
    expect(document.querySelector('[data-files-table]').getAttribute('data-mode')).toBe('search')
    expect(document.querySelector('[data-search-note]').textContent).toBe('2 matches for “hero” across the project')
    expect(namesOf()).toEqual(['hero-shot', 'hero_v3.mov'])
    const heads = [...document.querySelectorAll('.ui-table[data-files-table] th')].map(t => t.textContent.trim())
    expect(heads).toContain('Location')
    const loc = (name) => rowNamed(name).querySelectorAll('td')[heads.indexOf('Location')].textContent
    expect(loc('hero_v3.mov')).toBe('assets/hero-shot')
    expect(loc('hero-shot')).toBe('assets/hero-shot')
    expect(document.querySelector('[data-folder-up]'), 'no Up while searching').toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(crumbOf()).toEqual(['Project', 'ASSETS'])
    expect(namesOf()).toEqual(['hero-shot'])
  })

  it('a search with no match says so, naming the query and the project', async () => {
    await mountTable()
    search('zzz-nothing')
    expect(document.querySelector('[data-files-table]')).toBeNull()
    expect(document.querySelector('[data-files-empty="search"]').textContent).toContain('No files match “zzz-nothing” in this project')
    expect(document.querySelector('[data-search-note]').textContent).toBe('0 matches for “zzz-nothing” across the project')
  })

  it('a folder opened from the search results becomes the current folder, and the query clears', async () => {
    await mountTable()
    search('hero')
    enter('hero-shot')
    expect(filterBox().value).toBe('')
    expect(crumbOf()).toEqual(['Project', 'ASSETS', 'hero-shot'])
    expect(namesOf()).toEqual(['hero_v3.mov'])
  })

  it('an empty folder says so inside the table area, and Backspace still goes up from it', async () => {
    const folders = [...FOLDERS, { id: 'empty', kind: 'category', path: 'EMPTY', name: 'EMPTY', parent_id: 'root' }]
    ctx.getAdapter = () => ({ ...REAL_ADAPTER(), listFolders: async () => folders })
    await mountTable()
    enter('EMPTY')
    expect(document.querySelector('[data-files-table]')).toBeNull()
    expect(document.querySelector('[data-files-empty="folder"]').textContent).toContain('Empty folder')
    // Focus fell to the Up button (there is no row to take it).
    await waitFor(() => expect(document.activeElement).toBe(upButton()))
    keyOn(upButton(), 'Backspace')
    expect(crumbOf()).toEqual(['Project'])
  })

  it('the Columns view keeps the same place, and so does the file window\'s Location', async () => {
    await mountTable()
    enter('ASSETS'); enter('hero-shot')
    fireEvent.click(screen.getByRole('tab', { name: 'Columns' }))
    const heads = [...document.querySelectorAll('.fx-column-head')].map(h => h.textContent)
    expect(heads).toEqual(['Project', 'ASSETS', 'hero-shot'])
    fireEvent.click(document.querySelector('.fx-col-item[data-node-id="f:2"]'))
    const location = [...document.querySelectorAll('[data-file-details] .fx-details-pair')].find(p => p.querySelector('dt').textContent === 'Location')
    expect(location.querySelector('dd').textContent).toBe('ASSETS › hero-shot')
    fireEvent.click(screen.getByRole('tab', { name: 'Table' }))
    expect(crumbOf()).toEqual(['Project', 'ASSETS', 'hero-shot'])
    expect(rowNamed('hero_v3.mov').hasAttribute('data-selected')).toBe(true)
  })

  it('"Show in Files" lands in the file\'s folder with the file selected, in the Table too', async () => {
    navigateTo({ view: 'files', fileId: '2', projectId: 'p1' })
    render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Table' }))
    await waitFor(() => expect(document.querySelector('[data-file-details]')?.getAttribute('data-file-details')).toBe('f:2'))
    expect(crumbOf()).toEqual(['Project', 'ASSETS', 'hero-shot'])
    expect(rowNamed('hero_v3.mov').hasAttribute('data-selected')).toBe(true)
  })

  // ── The one-time re-filing of shot folders (S4c item 2) ─────────────────
  // A project from before S4c has its shot folders under SHOTS. The tab
  // OFFERS the move to someone who can write the open project — a banner
  // with the count and the names — asks first, shows the run, and says what
  // moved and what was left with the reason. Never on the Resources page,
  // never to a reader, never when nothing is pending.
  describe('the offer to move shot folders into their scenes', () => {
    const LEGACY_FOLDERS = [
      ...FOLDERS,
      { id: 'cs', kind: 'category', path: 'SCENES', name: 'SCENES', parent_id: 'root' },
      { id: 'csh', kind: 'category', path: 'SHOTS', name: 'SHOTS', parent_id: 'root' },
      { id: 'f-sc1', kind: 'entity', path: 'SCENES/Dawn', name: 'Dawn', parent_id: 'cs', scene_id: 'sc1', slug: 'Dawn' },
      { id: 'f-sh1', kind: 'entity', path: 'SHOTS/The-Door', name: 'The-Door', parent_id: 'csh', shot_id: 'sh1', slug: 'The-Door' },
      { id: 'f-sh2', kind: 'entity', path: 'SHOTS/The-Lamp', name: 'The-Lamp', parent_id: 'csh', shot_id: 'sh2', slug: 'The-Lamp' },
    ]
    function legacy({ canWrite = true, result } = {}) {
      ctx.getAdapter = () => ({ ...REAL_ADAPTER(), listFolders: async () => LEGACY_FOLDERS })
      // EVERY shot and scene of the project (`allShots` / `allScenes`): the
      // active list's rows (`shots` / `scenes`) are empty here on purpose —
      // the run moves every shot's folder, so the offer must count every
      // one (review round 1, item 3).
      ctx.allShots = [{ id: 'sh1', name: 'The door', scene_id: 'sc1' }, { id: 'sh2', name: 'The lamp', scene_id: 'sc1' }]
      ctx.allScenes = [{ id: 'sc1', name: 'Dawn' }]
      ctx.shots = []
      ctx.scenes = []
      ctx.adapterMode = 'supabase'
      ctx.refileShotFolders = vi.fn(async (opts) => {
        opts?.onProgress?.({ name: 'The-Door', done: 0, total: 2 })
        return result || { moved: [{ shotId: 'sh1', name: 'The-Door', from: 'SHOTS/The-Door', to: 'SCENES/Dawn/The-Door', files: 1 }, { shotId: 'sh2', name: 'The-Lamp', from: 'SHOTS/The-Lamp', to: 'SCENES/Dawn/The-Lamp', files: 0 }], left: [], removedShotsCategory: true }
      })
      // A reader: a workspace user holding a REVIEWER seat on a staffed
      // project (projectRoleMatrix: reviewers read, comment and build lists,
      // and change nothing else).
      perms.role = canWrite ? 'admin' : 'user'
      ctx.projectIsStaffed = !canWrite
      ctx.myProjectRole = canWrite ? null : 'reviewer'
    }
    afterEach(() => { delete ctx.shots; delete ctx.scenes; delete ctx.allShots; delete ctx.allScenes; delete ctx.refileShotFolders; delete ctx.adapterMode; delete ctx.projectIsStaffed; delete ctx.myProjectRole; perms.role = 'admin' })
    const offer = () => document.querySelector('[data-shot-refile-offer]')

    it('is a banner on the tab naming how many and which, with the one action; the question lists each move; the run reports', async () => {
      legacy()
      await mountTable({ projectId: 'p1', showPicker: false })
      await waitFor(() => expect(offer()).toBeTruthy())
      expect(offer().textContent).toContain('2 shot folders still sit under SHOTS: The-Door, The-Lamp.')
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders into their scenes…' }))
      const dialog = screen.getByRole('dialog', { name: 'Move 2 shot folders into their scenes?' })
      const lines = [...dialog.querySelectorAll('[data-shot-refile-list] li')].map(li => li.getAttribute('title'))
      expect(lines).toEqual(['SHOTS/The-Door → SCENES/Dawn/The-Door', 'SHOTS/The-Lamp → SCENES/Dawn/The-Lamp'])
      // "no file is deleted" since review round 1: the empty SHOTS folder IS
      // removed at the end, and the sentence says so — and a trashed file,
      // which the cloud cannot see, keeps its place.
      expect(dialog.textContent).toContain('no file is deleted, and only an empty SHOTS folder is removed at the end. A file in Recently deleted keeps its place and still restores. If it stops part way')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move shot folders' }))
      expect(ctx.refileShotFolders).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(document.querySelector('[data-shot-refile-result]')).toBeTruthy())
      expect(document.querySelector('[data-shot-refile-result]').textContent).toBe('Moved 2 shot folders into their scenes. The empty SHOTS folder is gone.')
      expect(document.querySelector('[data-shot-refile-result]').getAttribute('data-tone')).toBe('success')
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('what was left is named with its reason, on a warning banner; the offer stays for what is still pending', async () => {
      legacy({ result: { moved: [{ shotId: 'sh1', name: 'The-Door', files: 1 }], left: [{ shotId: 'sh2', name: 'The-Lamp', reason: '“board.png” is missing from rabbit-files' }], removedShotsCategory: false } })
      await mountTable({ projectId: 'p1', showPicker: false })
      await waitFor(() => expect(offer()).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders into their scenes…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders' }))
      await waitFor(() => expect(document.querySelector('[data-shot-refile-result]')).toBeTruthy())
      const result = document.querySelector('[data-shot-refile-result]')
      expect(result.textContent).toBe('Moved 1 of 2. Left where it was: The-Lamp (“board.png” is missing from rabbit-files).')
      expect(result.getAttribute('data-tone')).toBe('warning')
      // The rows are what they were (the fake moved nothing), so the offer is back.
      expect(offer()).toBeTruthy()
      fireEvent.click(within(result).getByRole('button', { name: 'Dismiss' }))
      expect(document.querySelector('[data-shot-refile-result]')).toBeNull()
    })

    it('while it runs, the line names the shot it is on; a backend that answers in one go gets "shot folders"; what was not found on disk is said with the result (round 2, items 1 and 10)', async () => {
      legacy()
      let release
      ctx.refileShotFolders = vi.fn((opts) => new Promise((resolve) => {
        opts.onProgress({ name: 'The-Door', done: 0, total: 2 })
        release = () => resolve({ moved: [{ shotId: 'sh1', name: 'The-Door', files: 2, missing: 1 }, { shotId: 'sh2', name: 'The-Lamp', files: 0, missing: 0 }], left: [], removedShotsCategory: true })
      }))
      await mountTable({ projectId: 'p1', showPicker: false })
      await waitFor(() => expect(offer()).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders into their scenes…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders' }))
      await waitFor(() => expect(document.querySelector('[data-shot-refile-progress]')).toBeTruthy())
      expect(document.querySelector('[data-shot-refile-progress]').textContent).toContain('Moving The-Door (1 of 2)…')
      expect(offer(), 'no offer while it runs').toBeNull()
      release()
      await waitFor(() => expect(document.querySelector('[data-shot-refile-result]')).toBeTruthy())
      expect(document.querySelector('[data-shot-refile-result]').textContent).toBe('Moved 2 shot folders into their scenes. The empty SHOTS folder is gone. 1 file was not found on this computer; its record moved with the folder, and the relink census finds it.')
      cleanup()
      // One answer, no progress: the line names the shot folders.
      legacy()
      let release2
      ctx.refileShotFolders = vi.fn(() => new Promise((resolve) => { release2 = () => resolve({ moved: [], left: [], removedShotsCategory: false }) }))
      await mountTable({ projectId: 'p1', showPicker: false })
      await waitFor(() => expect(offer()).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders into their scenes…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders' }))
      await waitFor(() => expect(document.querySelector('[data-shot-refile-progress]')).toBeTruthy())
      expect(document.querySelector('[data-shot-refile-progress]').textContent).toContain('Moving shot folders (1 of 2)…')
      release2()
      await waitFor(() => expect(document.querySelector('[data-shot-refile-progress]')).toBeNull())
    })

    it('a run still going for the last project is not shown on the next: the line goes, and its offer is read afresh (round 2, item 10)', async () => {
      legacy()
      ctx.refileShotFolders = vi.fn((opts) => new Promise(() => { opts.onProgress({ name: 'The-Door', done: 0, total: 2 }) }))
      ctx.getAdapter = () => ({ ...REAL_ADAPTER(), listFolders: async (id) => (id === 'p1' ? LEGACY_FOLDERS : FOLDERS) })
      const { rerender } = render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
      fireEvent.click(await screen.findByRole('tab', { name: 'Table' }))
      await waitFor(() => expect(offer()).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders into their scenes…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders' }))
      await waitFor(() => expect(document.querySelector('[data-shot-refile-progress]')).toBeTruthy())
      ctx.activeProjectId = 'p2'
      rerender(<ProjectFilesExplorer projectId="p2" showPicker={false} />)
      await waitFor(() => expect(document.querySelector('[data-shot-refile-progress]')).toBeNull())
      expect(offer()).toBeNull()
      ctx.activeProjectId = 'p1'
    })

    it('the question\'s words on a trashed file follow the store: the cloud cannot see one (it keeps its place), the Local Server moves it with its folder (round 2, item 12)', async () => {
      legacy()
      await mountTable({ projectId: 'p1', showPicker: false })
      await waitFor(() => expect(offer()).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders into their scenes…' }))
      expect(screen.getByRole('dialog').textContent).toContain('A file in Recently deleted keeps its place and still restores.')
      cleanup()
      legacy()
      ctx.supportsManagedFiles = true
      try {
        await mountTable({ projectId: 'p1', showPicker: false })
        await waitFor(() => expect(offer()).toBeTruthy())
        fireEvent.click(screen.getByRole('button', { name: 'Move shot folders into their scenes…' }))
        expect(screen.getByRole('dialog').textContent).toContain('A file in Recently deleted moves with its folder.')
        expect(screen.getByRole('dialog').textContent).not.toContain('keeps its place')
      } finally { delete ctx.supportsManagedFiles }
    })

    it('the move keeps the folder you were in (the rows are read again; the place is not lost)', async () => {
      legacy()
      await mountTable({ projectId: 'p1', showPicker: false })
      await waitFor(() => expect(offer()).toBeTruthy())
      enter('ASSETS')
      expect(crumbOf()).toEqual(['Project', 'ASSETS'])
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders into their scenes…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders' }))
      await waitFor(() => expect(document.querySelector('[data-shot-refile-result]')).toBeTruthy())
      await new Promise(r => setTimeout(r, 30))
      expect(crumbOf()).toEqual(['Project', 'ASSETS'])
    })

    it('a refusal from the backend is read on screen; Cancel on the question moves nothing', async () => {
      legacy()
      ctx.refileShotFolders = vi.fn(async () => { throw new Error('permission denied for table folders') })
      await mountTable({ projectId: 'p1', showPicker: false })
      await waitFor(() => expect(offer()).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders into their scenes…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(ctx.refileShotFolders).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders into their scenes…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Move shot folders' }))
      await waitFor(() => expect(document.querySelector('[data-shot-refile-error]')?.textContent).toBe('permission denied for table folders'))
    })

    it('CONTROL: no offer to a reader, none on the Resources page, none when every shot folder is already in its scene, none with no shots', async () => {
      legacy({ canWrite: false })
      await mountTable({ projectId: 'p1', showPicker: false })
      await new Promise(r => setTimeout(r, 20))
      expect(offer()).toBeNull()
      cleanup()
      legacy()
      await mountTable()  // the Resources host
      await new Promise(r => setTimeout(r, 20))
      expect(offer()).toBeNull()
      cleanup()
      legacy()
      ctx.getAdapter = () => ({ ...REAL_ADAPTER(), listFolders: async () => LEGACY_FOLDERS.map(f => (f.shot_id ? { ...f, path: `SCENES/Dawn/${f.slug}`, parent_id: 'f-sc1' } : f)) })
      await mountTable({ projectId: 'p1', showPicker: false })
      await new Promise(r => setTimeout(r, 20))
      expect(offer()).toBeNull()
      cleanup()
      legacy()
      ctx.allShots = []
      ctx.shots = [{ id: 'sh1', name: 'The door', scene_id: 'sc1' }] // the active list alone is not the project's shots
      await mountTable({ projectId: 'p1', showPicker: false })
      await new Promise(r => setTimeout(r, 20))
      expect(offer()).toBeNull()
    })

    it('the offer is the OPEN project\'s: switching to a project with nothing under SHOTS drops it', async () => {
      legacy()
      ctx.getAdapter = () => ({ ...REAL_ADAPTER(), listFolders: async (id) => (id === 'p1' ? LEGACY_FOLDERS : FOLDERS) })
      const { rerender } = render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
      fireEvent.click(await screen.findByRole('tab', { name: 'Table' }))
      await waitFor(() => expect(offer()).toBeTruthy())
      ctx.activeProjectId = 'p2'
      rerender(<ProjectFilesExplorer projectId="p2" showPicker={false} />)
      await waitFor(() => expect(offer()).toBeNull())
      await new Promise(r => setTimeout(r, 20))
      expect(offer()).toBeNull()
      ctx.activeProjectId = 'p1'
    })
  })

  it('the crumb bar is the table head\'s height on its paper, never wraps, and the keys handler sits on the table area only', () => {
    expect(css).toMatch(/\.fx-crumbs \{[^}]*height: var\(--table-head\);[^}]*background-color: var\(--color-paper-raised\);[^}]*overflow: hidden;/s)
    expect(css).toMatch(/\.fx-crumb-list \{[^}]*white-space: nowrap;/s)
    expect(css).toMatch(/\.fx-crumb-here \{[^}]*color: var\(--color-ink\); font-weight: 600; \}/)
    // The handler is React's, on the table area — not on document or window,
    // which would act from every page (S2a-01, S4a-07).
    expect(code).toMatch(/className="fx-main" onKeyDown=\{view === 'table' \? onTableKeyDown : undefined\}/)
    expect(code).not.toMatch(/(document|window)\.addEventListener\('keydown'/)
    // …and it stands down for the page, an overlay and a text field.
    expect(code).toMatch(/if \(!pageActive \|\| overlayOpen\(\)\) return/)
    expect(code).toMatch(/if \(isTextField\(e\.target\) \|\| e\.ctrlKey \|\| e\.metaKey\) return/)
  })
})
