/** @vitest-environment jsdom */
// =============================================================================
// DashboardTasksView.test.jsx — UI overhaul C2, 2026-09-11.
//
// 🚨 WHY THIS FILE EXISTS. The dev server's tester mode signs in with NO
// session by design, so every RLS-gated query returns nothing and the running
// app can only ever show this surface's EMPTY states. The chrome, the type
// and the empty states are verified in the browser and screenshotted; the
// populated table is verified here, with fixture rows, because otherwise the
// central claim of this bundle — that the eight-column table is now the
// shared `Table` and declares its own grid — would rest on nobody having
// looked at it.
//
// It mounts the real component against F1's render harness. The three hooks
// it reaches for are mocked at the module boundary; nothing about the view's
// own logic is stubbed.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'

// The Supabase client is constructed at module load and throws
// 'supabaseUrl is required' without a .env.local, which is every CI run
// (pages.test.js carries the same mock and the same note).
vi.mock('../../cloud/auth/supabaseClient', () => ({
  supabase: {},
  hydrateSupabase: async () => {},
}))
// RABBIT's, 680 lines, and not this session's to mount (review D31). The
// stand-in reproduces the ONE thing the real popup does with this session's
// ctx that matters: it calls `ctx.deleteTask(id)` and reads the return value,
// closing itself unless the answer is exactly `false`
// (TaskDetailPopup.jsx:568). `vetoed` records that answer so the test can
// assert the contract rather than the implementation.
const vetoed = vi.hoisted(() => ({ value: null, closed: false }))
vi.mock('../../tools/rabbit_v0.1.0/components/TaskDetailPopup', () => ({
  default: ({ taskId, ctx, onClose }) => (
    <button
      type="button"
      data-testid="popup-delete"
      onClick={() => {
        vetoed.value = ctx.deleteTask(taskId)
        if (vetoed.value !== false) { vetoed.closed = true; onClose() }
      }}
    >
      Delete task
    </button>
  ),
}))

const myTasks = vi.hoisted(() => ({ current: null }))
vi.mock('./useMyTasks', () => ({ useMyTasks: () => myTasks.current }))
vi.mock('../../permissions/usePermissions', () => ({
  usePermissions: () => ({ role: 'admin', ready: true }),
}))

const { default: DashboardTasksView } = await import('./DashboardTasksView')
const { TASK_COLUMNS } = await import('./dashboardTaskModel')

afterEach(cleanup)

const task = (over = {}) => ({
  id: 't1',
  title: 'Model the fox',
  status: 'in_progress',
  priority: 'urgent',
  project_id: 'p1',
  project: { id: 'p1', title: 'Alpha' },
  asset: { id: 'a1', name: 'Fox', phase_id: 'ph1' },
  assignee_id: 'me',
  reviewer_id: null,
  start_date: '2026-09-03',
  end_date: '2026-09-14',
  ...over,
})

const hook = (over = {}) => ({
  cloudReady: true,
  loading: false,
  error: null,
  tasks: [task()],
  userId: 'me',
  projectsById: { p1: { id: 'p1', title: 'Alpha' } },
  phasesById: {},
  myRoleByProject: { p1: 'producer' },
  staffedByProject: { p1: true },
  patchTask: vi.fn(async () => {}),
  deleteTask: vi.fn(async () => {}),
  reload: vi.fn(),
  ...over,
})

const mount = (over = {}) => {
  myTasks.current = hook(over)
  return render(<DashboardTasksView />)
}

describe('the task table is the shared Table', () => {
  it('renders a REAL <table> with a thead, a tbody and th scope="col"', () => {
    const { container } = mount()
    const t = container.querySelector('table.ui-table')
    expect(t).not.toBeNull()
    expect(t.querySelector('thead')).not.toBeNull()
    expect(t.querySelector('tbody')).not.toBeNull()
    for (const th of t.querySelectorAll('th')) expect(th.getAttribute('scope')).toBe('col')
  })

  it('🚨 the fifth copy of ThLight is gone', () => {
    const { container } = mount()
    // The local component rendered `th.px-3.py-2.text-[10px]`; every header
    // cell is the kit's `.ui-th` now.
    for (const th of container.querySelectorAll('th')) {
      expect(th.className).toContain('ui-th')
    }
  })

  it('declares every column width on the header row, which is what fixed layout reads', () => {
    const { container } = mount()
    const ths = [...container.querySelectorAll('thead th')]
    expect(ths).toHaveLength(TASK_COLUMNS.length)
    ths.forEach((th, i) => expect(th.style.width).toBe(TASK_COLUMNS[i].width))
  })

  it('right-aligns the two date columns with tabular figures', () => {
    const { container } = mount()
    const heads = [...container.querySelectorAll('thead th')]
    const start = heads.find((th) => th.textContent.startsWith('Start'))
    const due = heads.find((th) => th.textContent.startsWith('Due'))
    for (const th of [start, due]) expect(th.getAttribute('data-align')).toBe('right')
    // …and the body cells follow, which is the half that was left-aligned
    // `toLocaleDateString` output before (review alignment 5).
    const cells = [...container.querySelectorAll('tbody td[data-numeric]')]
    expect(cells).toHaveLength(2)
    for (const td of cells) expect(td.getAttribute('data-align')).toBe('right')
  })

  it('a data row is interactive, so the hover fill and the pointer appear where a click does something', () => {
    const { container } = mount()
    const rows = [...container.querySelectorAll('tbody tr')]
    const dataRow = rows.find((r) => !r.className.includes('dash-group-row'))
    expect(dataRow.getAttribute('data-interactive')).toBe('true')
  })
})

describe('the row carries its content at three levels', () => {
  it('the title takes the weight and the due date takes the other', () => {
    const { container } = mount()
    expect(container.querySelector('td.dash-cell-title').textContent).toBe('Model the fox')
    expect(container.querySelector('td.dash-cell-due')).not.toBeNull()
  })

  it('status and priority are in-cell editors with no native caret', () => {
    const { container } = mount()
    const selects = [...container.querySelectorAll('tbody select.dash-cell-select')]
    expect(selects).toHaveLength(2)
    // Every one is wrapped by the element that draws the caret, so the caret
    // can be revealed on hover instead of painted on every row forever.
    for (const s of selects) expect(s.parentElement.className).toContain('dash-cell-editor')
    // And each carries a name, because a <select> hard-clips instead of
    // eliding (F2 §5 trap 15).
    expect(selects.map((s) => s.getAttribute('aria-label'))).toEqual(['Status', 'Priority'])
  })

  it('priority carries a tone only for urgent and high', () => {
    const { container } = mount()
    expect(container.querySelectorAll('select.dash-cell-select')[1].getAttribute('data-tone')).toBe('danger')
    cleanup()
    const low = mount({ tasks: [task({ priority: 'low' })] })
    expect(low.container.querySelectorAll('select.dash-cell-select')[1].getAttribute('data-tone')).toBe('neutral')
  })

  it('the status vocabulary comes from the kit, in sentence case', () => {
    const { container } = mount()
    const opts = [...container.querySelectorAll('select.dash-cell-select')[0].options].map((o) => o.textContent)
    expect(opts).toContain('In progress')
    expect(opts).toContain('Waiting to start')
    expect(opts).not.toContain('in progress')
  })

  it('the role marker is the inert Badge, not a filled pill', () => {
    const { container } = mount()
    const badge = [...container.querySelectorAll('tbody .ui-badge')].find((b) => b.textContent === 'Assigned')
    expect(badge).not.toBeNull()
  })
})

describe('the group band', () => {
  it('is one full-width cell spanning every column', () => {
    const { container } = mount()
    const band = container.querySelector('tr.dash-group-row td')
    expect(band.getAttribute('colspan')).toBe(String(TASK_COLUMNS.length))
  })

  it('marks a band with nothing under it, so it can recede instead of reading as content', () => {
    const { container } = mount()
    const bands = [...container.querySelectorAll('tr.dash-group-row')]
    // The status grouping keeps every status group on purpose, so opening the
    // page used to show nine filled bands reading "waiting to start 0".
    expect(bands.length).toBeGreaterThan(1)
    const empty = bands.filter((b) => b.getAttribute('data-empty') === 'true')
    expect(empty.length).toBeGreaterThan(0)
    const filled = bands.filter((b) => b.getAttribute('data-empty') === null)
    expect(filled).toHaveLength(1)
    expect(within(filled[0]).getByText('In progress')).toBeTruthy()
  })

  it('🚨 keeps its drag-over branch', () => {
    const { container } = mount()
    for (const b of container.querySelectorAll('tr.dash-group-row')) {
      expect(b.getAttribute('data-dragover')).toBe('false')
    }
  })
})

describe('loading, empty and cloud-gated are three different pictures', () => {
  it('loading renders skeleton ROWS, not the table and not an empty state', () => {
    const { container } = mount({ loading: true, tasks: [] })
    expect(container.querySelector('.ui-skeleton-rows')).not.toBeNull()
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('.ui-empty')).toBeNull()
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading your tasks')
  })

  it('empty renders EmptyState, and says which kind of empty it is', () => {
    const { container } = mount({ tasks: [] })
    expect(container.querySelector('.ui-empty')).not.toBeNull()
    expect(screen.getByText('Nothing assigned to you yet')).toBeTruthy()
    cleanup()
    mount({ tasks: [task()], loading: false })
  })

  it('🚨 no empty state ever carries a loading string', () => {
    const { container } = mount({ tasks: [] })
    expect(container.querySelector('.ui-empty').textContent).not.toMatch(/loading/i)
  })

  it('the cloud gate is an EmptyState too, not a fourth composition', () => {
    const { container } = mount({ cloudReady: false })
    expect(container.querySelector('.ui-empty')).not.toBeNull()
    expect(screen.getByText('Dashboard needs the cloud')).toBeTruthy()
  })
})

describe('C1: the control count is unchanged', () => {
  // The review's Hick's-law findings shipped as grouping, not as disclosure.
  // D1's round-1 audit method: enumerate the controls and compare.
  it('the toolbar still exposes all nine controls, in the same order', () => {
    const { container } = mount()
    const bar = container.querySelector('.ui-toolbar')
    const controls = [...bar.querySelectorAll('button, input, select')]
    // The accessible name, in the order a screen reader resolves it. The two
    // view selects take theirs from the VISIBLE <label> beside them — the
    // review's alignment-3 complaint was that the word sat three pixels off
    // the control's baseline, not that it should stop existing — so a naive
    // title-or-aria-label read would report their option lists instead.
    const name = (c) => c.getAttribute('aria-label')
      || c.getAttribute('title')
      || [...(c.labels || [])].map((l) => l.textContent).join('')
      || c.textContent
    expect(controls.map(name)).toEqual([
      'Table', 'Board', 'Gallery', 'Search tasks',
      'Group', 'Sort', 'Ascending', 'Filter tasks',
      'Refresh',
    ])
  })

  it('a separator is decorative — it adds grouping, never a target', () => {
    const { container } = mount()
    const sep = container.querySelector('.dash-toolbar-sep')
    expect(sep).not.toBeNull()
    expect(sep.getAttribute('aria-hidden')).toBe('true')
    expect(sep.tagName).toBe('SPAN')
  })
})

describe('W9: the native confirm became the kit Dialog, and the veto survived', () => {
  const openPopupAndDelete = () => {
    const r = mount()
    // open a task, then press the popup's delete
    fireEvent.click(r.container.querySelector('td.dash-cell-title').closest('tr'))
    vetoed.value = null
    vetoed.closed = false
    fireEvent.click(screen.getByTestId('popup-delete'))
    return r
  }

  it('🚨 the ctx callback still answers `false` synchronously, so the popup stays open', () => {
    openPopupAndDelete()
    expect(vetoed.value).toBe(false)
    expect(vetoed.closed).toBe(false)
    // …and the popup is still mounted behind the dialog.
    expect(screen.queryByTestId('popup-delete')).not.toBeNull()
  })

  it('raises a confirm Dialog instead of window.confirm', () => {
    const { container } = openPopupAndDelete()
    const dialog = container.querySelector('.ui-dialog') || document.querySelector('.ui-dialog')
    expect(dialog, 'a Dialog is on screen').not.toBeNull()
    expect(screen.getByText('Delete this task?')).toBeTruthy()
    // The warning the old confirm string carried is still said.
    expect(document.body.textContent).toMatch(/30-day trash/)
    expect(document.body.textContent).toMatch(/admin can restore/i)
  })

  it('cancel deletes nothing and leaves the popup open, as a cancelled confirm did', () => {
    openPopupAndDelete()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(myTasks.current.deleteTask).not.toHaveBeenCalled()
    expect(screen.queryByTestId('popup-delete')).not.toBeNull()
    expect(screen.queryByText('Delete this task?')).toBeNull()
  })

  it('confirm deletes the task and closes the popup — what the old `true` return did', () => {
    openPopupAndDelete()
    // Scoped to the dialog: the popup's own trigger says "Delete task" too,
    // which is correct on screen (two layers) and ambiguous to a query.
    const dialog = document.querySelector('.ui-dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete task' }))
    expect(myTasks.current.deleteTask).toHaveBeenCalledWith('t1')
    expect(screen.queryByTestId('popup-delete')).toBeNull()
  })

  it('🚨 no window.confirm survives on this surface', () => {
    const spy = vi.spyOn(window, 'confirm')
    openPopupAndDelete()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
