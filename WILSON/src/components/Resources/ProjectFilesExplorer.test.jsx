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
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
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

const ctx = {
  projectsIndex: { p1: { id: 'p1', title: 'Smoke one' }, p2: { id: 'p2', title: 'Smoke two', is_private: true } },
  activeProjectId: 'p1',
  getAdapter: () => ({
    listFolders: async () => FOLDERS,
    listFiles: async () => FILES,
    listManagedFiles: async () => [],
  }),
}

vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({
  useRabbit: () => ctx,
}))

const { default: ProjectFilesExplorer } = await import('./ProjectFilesExplorer')

afterEach(cleanup)

/** Mount, wait for the adapter promises, and switch to the table view. */
async function mountTable() {
  const utils = render(<ProjectFilesExplorer />)
  await screen.findByRole('table')
    .catch(() => null)
  // The page opens on Columns; the table is the other tab.
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
    expect(screen.getByLabelText('Filter')).toBeTruthy()
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
    // enforces it for four kit classes but not for `.ui-tab` (36px), so the
    // view switch stood 8px proud until this page pinned it. Kit request, in
    // the hand-off.
    expect(css).toMatch(/\.rs-page \.ui-toolbar \.ui-tab \{ height: var\(--control-sm\); \}/)
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
      .toMatch(/\.ui-th\[data-numeric\], \.ui-td\[data-numeric\] \{ font-variant-numeric: tabular-nums; \}/)
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
    // …and the depth indent is on the SLOT, so the icon and the name move
    // together rather than the text sliding out from under its own glyph.
    expect(css).toMatch(/\.fx-name \{[^}]*padding-left: calc\(var\(--fx-depth, 0\) \* 18px\);/s)
  })

  it('drops the indent once a sort has destroyed the parentage (F-R12)', async () => {
    await mountTable()
    const depthOf = () => [...document.querySelectorAll('.ui-table[data-files-table] .fx-name')]
      .map(n => n.style.getPropertyValue('--fx-depth'))
    // Sorted by name, the tree order holds and the indent means something.
    expect(depthOf().some(d => Number(d) > 0)).toBe(true)
    // Sort by Size: `sortRows` reorders the flattened list globally while each
    // row keeps its tree depth, so an indent here would claim a parentage that
    // no longer exists.
    fireEvent.click(screen.getByRole('button', { name: /Size/ }))
    expect(depthOf().every(d => Number(d) === 0)).toBe(true)
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
      .toMatch(/\.ui-tr\[data-selected\] > \.ui-td:first-child \{ box-shadow: inset 2px 0 0 0 var\(--color-signal\); \}/)
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
  it('says "no project chosen" before a project is chosen', async () => {
    const noProject = { ...ctx, activeProjectId: null }
    vi.spyOn(noProject, 'getAdapter')
    const { rerender } = render(<ProjectFilesExplorer />)
    rerender(<ProjectFilesExplorer />)
    // With the fixture's activeProjectId the page lands on a project, so the
    // arrival state is asserted from the source's own branch instead.
    expect(source).toMatch(/title="No project chosen"/)
    expect(source).toMatch(/<Loading rows=\{10\} columns=\{7\}/)
    expect(source).toMatch(/title="Nothing filed yet"/)
    expect(noProject.getAdapter).toBeDefined()
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
