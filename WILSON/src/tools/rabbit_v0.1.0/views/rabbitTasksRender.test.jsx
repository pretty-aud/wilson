/** @vitest-environment jsdom */
// =============================================================================
// B2's popups, RENDERED (UI overhaul B2, review round one). Until this file no
// test mounted TaskDetailPopup or the task template manager: the Dashboard's
// test mocks the popup out, and the kit's tests prove only the kit. Round
// one's guard review deleted the Escape-reverts-first handling from both files
// and the whole suite stayed green. What is pinned here is behaviour the
// running app showed round one breaking, and that source text cannot prove:
//
//   · W2 — Escape inside an open editor reverts it and the dialog stays; the
//     second Escape closes it;
//   · K5 — a press on the backdrop keeps a save-on-blur edit (it discarded it);
//   · the files column's layers (FileManager's, lane B4's) own their Escape:
//     a fixed overlay (its VideoPreview) and a text field (its notes);
//   · the template editor's dependency picker: Escape closes the picker, then
//     the editor, then the manager, one layer per press; its scrim takes the
//     click that dismisses it.
// =============================================================================

import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { _resetOverlaysForTests, menuOpened } from '../../../ui/overlay'

vi.mock('../../../ui/overlay', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, menuOpened: vi.fn(() => vi.fn(real.menuOpened())) }
})

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [], mode: 'supabase' }) }))
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => ({ entries: [] }) }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true }) }))
// FileManager is lane B4's; the popup only has to leave its layers their keys.
// Its real VideoPreview is fixed by a CLASS (`fixed inset-0`), as the kit
// Dialog's backdrop is; the sheet below gives jsdom the two rules a browser
// has, so a check that reads only inline styles, or one that scans the whole
// document (and so finds the backdrop), fails here as it would in the app.
const files = vi.hoisted(() => ({ overlay: false, noteEscape: vi.fn() }))
vi.mock('../components/FileManager', () => ({
  default: () => (
    <div>
      {/* B4: FileManager's notes editor marks its own Escape (K4's mark) —
          the popup's `markFilesEscape`, which marked it from outside, is gone.
          `unmarked` is a text field that does NOT, to prove the popup no
          longer marks on anyone's behalf. */}
      <input type="text" aria-label="File note" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); files.noteEscape() } }} />
      <input type="text" aria-label="Unmarked field" />
      <button type="button">Download</button>
      {files.overlay && <div data-testid="preview" className="fixed inset-0">preview</div>}
    </div>
  ),
}))
let positions
beforeAll(() => {
  positions = document.createElement('style')
  positions.textContent = '.fixed { position: fixed; } .ui-dialog-backdrop { position: fixed; }'
  document.head.appendChild(positions)
})
afterAll(() => positions.remove())
const rabbit = vi.hoisted(() => ({ current: null }))
const templates = vi.hoisted(() => ({ current: null }))
vi.mock('../../../components/TaskTemplates/useTaskTemplates', () => ({ useTaskTemplates: () => templates.current }))

const { default: TaskDetailPopup } = await import('../components/TaskDetailPopup')
const { default: TaskTemplateManager } = await import('../../../components/TaskTemplates/TaskTemplateManager')

afterEach(() => { cleanup(); _resetOverlaysForTests(); files.overlay = false; files.noteEscape.mockClear(); menuOpened.mockClear() })

const escape = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })

function popup({ withFiles = false } = {}) {
  const updateTask = vi.fn()
  const onClose = vi.fn()
  const task = { id: 't1', title: 'Lock the script', description: 'Old words', notes: 'Old note', status: 'final', priority: 'high', asset_id: withFiles ? 'a1' : null }
  const ctx = {
    tasks: [task], assets: withFiles ? [{ id: 'a1', name: 'Script' }] : [], phases: [],
    project: { id: 'p1' }, scenes: [], shots: [], levels: [], experiences: [],
    teamAssignments: [], managedFiles: [], updateTask, deleteTask: vi.fn(),
    myProjectRole: 'manager', projectIsStaffed: false, activeProjectId: 'p1',
  }
  render(<TaskDetailPopup taskId="t1" ctx={ctx} onClose={onClose} />)
  return { updateTask, onClose }
}

describe('TaskDetailPopup, rendered', () => {
  it('W2: Escape in an open editor reverts it and the popup stays; the next Escape closes it', () => {
    const { updateTask, onClose } = popup()
    fireEvent.click(screen.getByRole('button', { name: 'Old words' }))
    const box = screen.getByLabelText('Description')
    fireEvent.change(box, { target: { value: 'New words' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(updateTask).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Old words' })).toBeTruthy()
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // Every inline editor in the popup, not only Description (round two's
  // guard review: the Title and Notes editors' Escape could reach the Dialog
  // with the suite green).
  for (const [name, open, box, old] of [
    ['Title', () => document.querySelector('.rb-task-textblock[data-size="line"]'), 'Title', 'Lock the script'],
    ['Notes', () => screen.getByRole('button', { name: 'Old note' }), 'Notes', 'Old note'],
  ]) {
    it(`W2 on ${name}: Escape reverts it and the popup stays; the next Escape closes it`, () => {
      const { updateTask, onClose } = popup()
      fireEvent.click(open())
      const field = screen.getByLabelText(box)
      fireEvent.change(field, { target: { value: 'Not kept' } })
      fireEvent.keyDown(field, { key: 'Escape' })
      expect(onClose).not.toHaveBeenCalled()
      expect(updateTask).not.toHaveBeenCalled()
      expect(screen.queryByDisplayValue('Not kept')).toBeNull()
      expect(document.body.textContent).toContain(old)
      escape()
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  }

  it('K5: a click outside keeps the edit that was being typed', () => {
    const { updateTask, onClose } = popup()
    fireEvent.click(screen.getByRole('button', { name: 'Old words' }))
    const box = screen.getByLabelText('Description')
    box.focus()
    fireEvent.change(box, { target: { value: 'Typed, then clicked away' } })
    fireEvent.mouseDown(document.querySelector('.ui-dialog-backdrop'))
    expect(updateTask).toHaveBeenCalledWith('t1', { description: 'Typed, then clicked away' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("the files column's text field (FileManager's notes, an <input>) has its own Escape: the popup stays", () => {
    const { onClose } = popup({ withFiles: true })
    const note = screen.getByLabelText('File note')
    note.focus()
    fireEvent.keyDown(note, { key: 'Escape' })
    expect(files.noteEscape).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('B4: the popup no longer marks a files-column Escape for anyone — an unmarked field\'s Escape closes it', () => {
    // `markFilesEscape` is gone: a layer in the files column owns its Escape
    // by marking it (FileManager's notes editor does, since B4).
    const { onClose } = popup({ withFiles: true })
    const field = screen.getByLabelText('Unmarked field')
    field.focus()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("an Escape on a files-column control that is not a text field closes the popup (only typing is the column's own)", () => {
    const { onClose } = popup({ withFiles: true })
    const download = screen.getByRole('button', { name: 'Download' })
    download.focus()
    fireEvent.keyDown(download, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('W2 in the files column: Escape in the upload-file-name editor reverts it and the popup stays; the next closes it', () => {
    const { onClose } = popup({ withFiles: true })
    fireEvent.click(document.querySelector('.rb-task-detail-files .rb-task-textblock'))
    const box = screen.getByRole('textbox', { name: 'Upload file name' })
    fireEvent.change(box, { target: { value: 'renamed.mov' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Upload file name' })).toBeNull()
    expect(document.querySelector('.rb-task-detail-files .rb-task-textblock').textContent).not.toContain('renamed.mov')
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("an overlay open in the files column (FileManager's video preview) keeps the popup open on Escape", () => {
    files.overlay = true
    const { onClose } = popup({ withFiles: true })
    expect(screen.getByTestId('preview')).toBeTruthy()
    escape()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('the task template manager, rendered', () => {
  function manager() {
    const updateTemplate = vi.fn()
    templates.current = {
      templates: [{
        id: 'tp1', name: 'Environment build', description: '', project_id: null,
        tasks: [
          { id: 'k1', name: 'Model', role_slug: '', bid_days: 3, depends_on: [] },
          { id: 'k2', name: 'Texture', role_slug: '', bid_days: 2, depends_on: [] },
        ],
      }],
      loading: false, error: null,
      getTemplateStats: (t) => ({ taskCount: t.tasks.length, totalDays: 5 }),
      addTemplate: vi.fn(), updateTemplate, deleteTemplate: vi.fn(),
    }
    rabbit.current = { projects: [], project: null, myProjectRole: null }
    const onClose = vi.fn()
    render(<TaskTemplateManager onClose={onClose} />)
    return { onClose, updateTemplate }
  }

  it('Escape closes the dependency list, then the editor, then the manager — one layer per press', () => {
    const { onClose } = manager()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    const trigger = screen.getAllByRole('button', { expanded: false }).find((b) => b.classList.contains('rb-tpl-deps'))
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('group', { name: 'Depends on' })).toBeTruthy()
    escape()
    expect(screen.queryByRole('group', { name: 'Depends on' })).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    // Closing it hands focus back to its trigger (round two).
    expect(document.activeElement).toBe(trigger)
    escape()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the open list registers with overlay.js as a menu, and unregisters when it closes', () => {
    manager()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const trigger = document.querySelectorAll('.rb-tpl-deps')[0]
    trigger.focus()
    expect(menuOpened).not.toHaveBeenCalled()
    fireEvent.click(trigger)
    expect(menuOpened).toHaveBeenCalledTimes(1)
    const unregister = menuOpened.mock.results[0].value
    expect(unregister).not.toHaveBeenCalled()
    escape()
    expect(unregister).toHaveBeenCalledTimes(1)
  })

  it("W2 on a template's name in the list: Escape reverts it and the manager stays; the next closes it", () => {
    const { updateTemplate, onClose } = manager()
    fireEvent.click(screen.getByRole('button', { name: 'Environment build' }))
    const box = screen.getByRole('textbox', { name: 'Template name' })
    fireEvent.change(box, { target: { value: 'Not kept' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(updateTemplate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Environment build' })).toBeTruthy()
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a dependency toggles and the list stays open; its scrim takes the click that closes it', () => {
    const { updateTemplate } = manager()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const trigger = document.querySelectorAll('.rb-tpl-deps')[0]
    trigger.focus()
    fireEvent.click(trigger)
    const list = screen.getByRole('group', { name: 'Depends on' })
    fireEvent.click(within(list).getByRole('button', { name: /Texture/ }))
    expect(updateTemplate).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('group', { name: 'Depends on' })).toBeTruthy()
    const scrim = document.querySelector('.rb-tpl-scrim')
    expect(scrim).not.toBeNull()
    fireEvent.click(scrim)
    expect(screen.queryByRole('group', { name: 'Depends on' })).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
  })

  it('keyboard focus leaving the list and its trigger closes it (round two)', () => {
    manager()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const trigger = document.querySelectorAll('.rb-tpl-deps')[0]
    trigger.focus()
    fireEvent.click(trigger)
    const option = within(screen.getByRole('group', { name: 'Depends on' })).getAllByRole('button')[0]
    fireEvent.blur(trigger, { relatedTarget: option })
    expect(screen.getByRole('group', { name: 'Depends on' })).toBeTruthy()
    fireEvent.blur(option, { relatedTarget: screen.getByRole('button', { name: 'Add task' }) })
    expect(screen.queryByRole('group', { name: 'Depends on' })).toBeNull()
  })

  it("W2 in the editor: Escape in the description reverts it and the editor stays; the next closes the editor only", () => {
    const { updateTemplate, onClose } = manager()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Click to add description…' }))
    const box = screen.getByLabelText('Description')
    fireEvent.change(box, { target: { value: 'Not kept' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(updateTemplate).not.toHaveBeenCalled()
    escape()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it("W2 on a task's name in the editor: Escape reverts it and the editor stays; the next closes the editor only", () => {
    const { updateTemplate, onClose } = manager()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Model' }))
    const box = screen.getByRole('textbox', { name: 'Task name…' })
    fireEvent.change(box, { target: { value: 'Not kept' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(updateTemplate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Model' })).toBeTruthy()
    escape()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('K5 in the editor: a click outside keeps the description being typed', () => {
    const { updateTemplate } = manager()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Click to add description…' }))
    const box = screen.getByLabelText('Description')
    box.focus()
    fireEvent.change(box, { target: { value: 'Drawings first' } })
    const backdrops = document.querySelectorAll('.ui-dialog-backdrop')
    fireEvent.mouseDown(backdrops[backdrops.length - 1])
    expect(updateTemplate).toHaveBeenCalledWith('tp1', { description: 'Drawings first' })
  })
})
