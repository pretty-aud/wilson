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

afterEach(cleanup)

/** Mount, wait for the adapter promises, and switch to the table view. */
async function mountTable() {
  const utils = render(<ProjectFilesExplorer />)
  // The page opens on COLUMNS, so waiting for a <table> here waits out the
  // full findBy timeout and finds nothing — eight callers, eight seconds. Wait
  // for the tab (which appears once the adapter promises settle), then switch.
  const tab = await screen.findByRole('tab', { name: 'Table' })
  fireEvent.click(tab)
  return utils
}

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

  it('declares seven columns whose widths sum to exactly 100', async () => {
    await mountTable()
    const ths = [...document.querySelectorAll('.ui-table[data-files-table] th')]
    expect(ths.map(t => t.textContent.trim())).toEqual([
      'Name', 'Type', 'Size', 'Created', 'Modified', 'Duration', 'Location',
    ])
    // `table-layout: fixed` reads the header row, so an over-summing set of
    // percentages is not a declared grid at all — the browser reconciles the
    // excess and every column lands somewhere other than where it was written.
    const total = ths.reduce((n, t) => n + parseFloat(t.style.width), 0)
    expect(total).toBe(100)
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

  it('does not indent at all, and leaves every sort state reachable (F-R12)', async () => {
    await mountTable()
    // 🚨 THE THIRD ANSWER TO F-R12, and the first two are worth knowing about
    // because each was green under a test that described it.
    //
    // `sortRows` re-sorts the FLATTENED list globally for EVERY key including
    // name-ascending, which is the default — so the indent never described the
    // order, on arrival or after any sort. Attempt one dropped the indent only
    // for non-name sorts and left the default lying. Attempt two made tree
    // order the default, which fixed the indent and left the Name header
    // claiming `aria-sort="ascending"` over rows that were not in name order,
    // and lost flat A-to-Z entirely.
    //
    // So: the ordering is untouched and the INDENT is gone.
    const slots = [...document.querySelectorAll('.ui-table[data-files-table] .fx-name')]
    expect(slots.length).toBeGreaterThan(1)
    for (const n of slots) {
      expect(n.getAttribute('style'), 'no per-row indent survives').toBeNull()
    }

    // Every sort state is still reachable and every arrow still honest: the
    // header claims a direction only when the rows are in it.
    const nameTh = [...document.querySelectorAll('.ui-table[data-files-table] th')]
      .find(t => t.textContent.trim() === 'Name')
    expect(nameTh.getAttribute('aria-sort')).toBe('ascending')
    const namesOf = () => [...document.querySelectorAll('.ui-table[data-files-table] .fx-name-text')]
      .map(n => n.textContent)
    const asc = namesOf()
    expect(asc, 'the default IS a flat A-to-Z listing').toEqual([...asc].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1))

    fireEvent.click(within(nameTh).getByRole('button'))
    expect(nameTh.getAttribute('aria-sort')).toBe('descending')
    expect(namesOf(), 'and descending is its exact inverse').toEqual([...asc].reverse())
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

  it('makes only FILE rows interactive, and adds no role or tab stop (C1)', async () => {
    await mountTable()
    const rows = [...document.querySelectorAll('.ui-table[data-files-table] tbody tr')]
    const files = rows.filter(r => r.getAttribute('data-node-kind') === 'file')
    const folders = rows.filter(r => r.getAttribute('data-node-kind') === 'folder')
    expect(files.length).toBeGreaterThan(0)
    expect(folders.length).toBeGreaterThan(0)
    // A folder row is not selectable, so it must not promise the pointer.
    for (const r of files) expect(r.hasAttribute('data-interactive')).toBe(true)
    for (const r of folders) expect(r.hasAttribute('data-interactive')).toBe(false)
    // F-R11's hover is CSS on the shared Row. Adding `role`/`tabIndex` to make
    // the row focusable would be an interaction change, so it was not done.
    for (const r of rows) {
      expect(r.hasAttribute('role')).toBe(false)
      expect(r.hasAttribute('tabindex')).toBe(false)
    }
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
    expect((code.match(/<EmptyState/g) || []).length).toBe(3)
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
    const rows = [...document.querySelectorAll('.ui-table[data-files-table] tbody tr')]
    const cells = (name) => [...rows.find((tr) => tr.textContent.includes(name)).querySelectorAll('td')]
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
    // A folder has no date, and so no tooltip.
    expect(cells('hero-shot')[heads.indexOf('Created')].hasAttribute('title')).toBe(false)
  })
})
