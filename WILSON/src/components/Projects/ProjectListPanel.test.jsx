/** @vitest-environment jsdom */
// =============================================================================
// ProjectListPanel.test.jsx — UI overhaul C1.
//
// The Projects list carried the highest-severity MEASURED defect on the whole
// Resources surface: a status column at 1.10:1 that was also the view's only
// colour-coded signal (F-R02). It also carried the surface's two JS hover
// handlers, which wrote `e.currentTarget.style` and therefore could never
// answer `:focus-within` (F-R20), and a seven-column grid template written out
// twice so a column change had to be made in two places or the header silently
// detached from the body (alignment list #9).
//
// None of that is visible in the browser here — tester mode has no session, so
// the page renders its empty state and never a row. This mounts it with
// fixture projects on F1's harness.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import ProjectListPanel from './ProjectListPanel'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../Resources/resources.css'), 'utf8')
const source = readFileSync(resolve(here, 'ProjectListPanel.jsx'), 'utf8')
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n')

afterEach(cleanup)

const PROJECTS = [
  {
    id: 'p1', title: 'Smoke one', description: 'A long-running reference project',
    status: 'active', client_name: 'Petal', start_date: '2026-01-05', end_date: '2026-06-30',
  },
  {
    id: 'p2', title: 'Smoke two', description: '', status: 'inactive',
    client_name: '', is_private: true,
  },
]

function mount(props = {}) {
  const api = {
    onCreate: vi.fn(),
    onOpen: vi.fn(),
    onUpdateStatus: vi.fn(),
    onRequestDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    onCancelDelete: vi.fn(),
  }
  const utils = render(
    <ProjectListPanel projects={PROJECTS} deleteConfirm={null} {...api} {...props} />,
  )
  return { ...utils, ...api }
}

describe('the projects list is the shared table', () => {
  it('declares seven columns ONCE, whose widths sum to exactly 100', () => {
    mount()
    const ths = [...document.querySelectorAll('table.ui-table th')]
    expect(ths.map(t => t.textContent.trim())).toEqual([
      'Title', 'Description', 'Status', 'Client', 'Start', 'End', 'Actions',
    ])
    expect(ths.reduce((n, t) => n + parseFloat(t.style.width), 0)).toBe(100)
    // Alignment list #9: the grid template was written out twice, once for the
    // header and once per row, so a column change had to be made in both or
    // the header silently detached from the body.
    expect((code.match(/gridTemplateColumns/g) || [])).toHaveLength(0)
  })

  it('carries no zebra and no JS hover handlers (F-R07, F-R20)', () => {
    mount()
    expect(code).not.toMatch(/onMouseEnter|onMouseLeave/)
    expect(code).not.toContain('rgba(120, 70, 30, 0.12)')
    expect(code).not.toContain('rgba(120, 70, 30, 0.22)')
    expect(code).not.toMatch(/#[0-9a-fA-F]{6}\b/)
    // The hover is a rule on the shared Row, so `:focus-within` answers it.
    expect(readFileSync(resolve(here, '../../index.css'), 'utf8'))
      .toMatch(/\.ui-tr\[data-interactive\]:hover > \.ui-td/)
  })

  it('opens a project from anywhere on the row, as before', () => {
    const { onOpen } = mount()
    fireEvent.click(document.querySelectorAll('tbody tr')[0])
    expect(onOpen).toHaveBeenCalledWith('p1')
  })

  it('right-aligns the two date columns with tabular figures', () => {
    mount()
    const numeric = [...document.querySelectorAll('table.ui-table th[data-numeric]')]
      .map(t => t.textContent.trim())
    expect(numeric).toEqual(['Start', 'End'])
  })
})

describe('the status column (F-R02, the worst measured defect on the surface)', () => {
  it('keeps the SELECT as the control and the WORD as the state', () => {
    const { onUpdateStatus } = mount()
    const select = screen.getByLabelText('Status of Smoke one')
    expect(select.tagName).toBe('SELECT')
    // The word is in the option, so colour is never the only carrier.
    expect([...select.options].map(o => o.textContent)).toEqual(['Active', 'Inactive'])
    expect(select.value).toBe('active')
    fireEvent.change(select, { target: { value: 'inactive' } })
    expect(onUpdateStatus).toHaveBeenCalledWith('p1', 'inactive')
  })

  it('drives the ink from a data attribute, on the dark ground', () => {
    mount()
    expect(screen.getByLabelText('Status of Smoke one').dataset.status).toBe('active')
    expect(screen.getByLabelText('Status of Smoke two').dataset.status).toBe('inactive')
    // `#16a34a` measured 1.33:1 and `#dc2626` 1.10:1 composited on the old
    // ground. Inactive takes the third ink rather than a red: a project that
    // is not running is neutral, not in error.
    expect(css).toMatch(/\.pl-status\[data-status="active"\] \{ color: var\(--color-success\); \}/)
    expect(css).toMatch(/\.pl-status\[data-status="inactive"\] \{ color: var\(--color-ink-3\); \}/)
  })

  it('does not open the project when the status control is used', () => {
    const { onOpen } = mount()
    fireEvent.click(screen.getByLabelText('Status of Smoke one'))
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('the rest of the row', () => {
  it('marks a private project with the kit Badge, at the 11px Label step', () => {
    mount()
    const badge = screen.getByText('Private')
    expect(badge.className).toContain('ui-badge')
    // 🚨 `{project.is_private && (` and the word `Private` are pinned by
    // src/lib/localMediaWiring.test.js. The shell changed; the branch did not.
    expect(code).toContain('{project.is_private && (')
  })

  it('keeps delete visible at rest in a reserved slot', () => {
    const { onRequestDelete, onOpen } = mount()
    const row = document.querySelectorAll('tbody tr')[0]
    const slot = row.querySelector('.ui-hover-actions')
    // `always`: hiding a SECONDARY control behind hover is allowed under C1,
    // but this is the row's only write and it was visible before, so it stays.
    expect(slot.dataset.always).toBe('true')
    fireEvent.click(within(slot).getByRole('button'))
    expect(onRequestDelete).toHaveBeenCalledWith('p1')
    expect(onOpen, 'and it does not also open the project').not.toHaveBeenCalled()
  })

  it('hides the delete control without collapsing the column', () => {
    mount({ onRequestDelete: null })
    const slot = document.querySelectorAll('tbody tr')[0].querySelector('.ui-hover-actions')
    expect(slot, 'the slot is reserved either way').toBeTruthy()
    expect(slot.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('the chrome', () => {
  it('does not print the page title a second time (F-R06)', () => {
    mount()
    expect(document.querySelectorAll('h1, h2')).toHaveLength(0)
    // …and the one primary action that sat beside it is in the toolbar.
    expect(screen.getByRole('button', { name: /New project/ })).toBeTruthy()
  })

  it('confirms a delete in the flow, with the same two outcomes', () => {
    const { onConfirmDelete, onCancelDelete } = mount({ deleteConfirm: 'p1' })
    expect(screen.getByRole('alert').textContent).toMatch(/Delete “Smoke one”/)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirmDelete).toHaveBeenCalledWith('p1')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancelDelete).toHaveBeenCalled()
  })

  it('keeps Delete and Cancel reachable if the row leaves the list', () => {
    // A realtime update or a filter can drop the pending project while the
    // confirmation is open. Gating the strip on the LOOKUP rather than on
    // `deleteConfirm` took both outcomes away and left the state stuck.
    const { onCancelDelete } = mount({ projects: [PROJECTS[1]], deleteConfirm: 'p1' })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/Delete this project\?/)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancelDelete).toHaveBeenCalled()
  })

  it('offers the canonical empty state, with its action and without the circle', () => {
    const { onCreate } = mount({ projects: [] })
    expect(screen.getByText('No projects yet')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: /New project/ })
    // One in the toolbar, one in the empty state — the review keeps this as
    // the canonical shape precisely because it is the only one with an action.
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1])
    expect(onCreate).toHaveBeenCalled()
  })
})
