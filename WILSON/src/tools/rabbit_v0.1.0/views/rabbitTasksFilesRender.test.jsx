/** @vitest-environment jsdom */
// =============================================================================
// TaskDetailPopup with the REAL FileManager in its files column (UI overhaul
// B2, review round two). rabbitTasksRender.test.jsx mocks FileManager, and a
// mock is only as true as its author's reading of the component: round one's
// mock drew the notes editor as a <textarea>, the popup's Escape mark keyed
// on TEXTAREA, and in the app one Escape in the (real, <input>) notes editor
// closed the whole popup with the suite green. This file mounts lane B4's
// component as it is, so when B4 changes it these tests say what the popup
// still needs (`markFilesEscape` went in B4; `filesLayerOpen` in B4c).
//
//   · W2 in the real notes editor: Escape cancels the note, the popup stays;
//   · the real VideoPreview (the kit Dialog in <body> since B4c, on
//     overlay.js's stack): one Escape closes it and the popup stays.
// =============================================================================

import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [], mode: 'supabase' }) }))
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => ({ entries: [] }) }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true }) }))
const rabbit = vi.hoisted(() => ({ current: { supportsManagedFiles: true, files: [] } }))

const { default: TaskDetailPopup } = await import('../components/TaskDetailPopup')

// jsdom loads no stylesheet: give it the two position rules a browser has.
let positions, realFetch
beforeAll(() => {
  positions = document.createElement('style')
  positions.textContent = '.fixed { position: fixed; } .ui-dialog-backdrop { position: fixed; }'
  document.head.appendChild(positions)
  realFetch = globalThis.fetch
  globalThis.fetch = vi.fn(() => Promise.reject(new Error('no network in this test')))
})
afterAll(() => { positions.remove(); globalThis.fetch = realFetch })
afterEach(() => { cleanup(); _resetOverlaysForTests() })

function popup() {
  const onClose = vi.fn()
  const task = { id: 't1', title: 'Lock the script', status: 'final', priority: 'high', asset_id: 'a1' }
  const ctx = {
    tasks: [task], assets: [{ id: 'a1', name: 'Script' }], phases: [],
    project: { id: 'p1' }, scenes: [], shots: [], levels: [], experiences: [],
    teamAssignments: [], updateTask: vi.fn(), deleteTask: vi.fn(),
    managedFiles: [
      { id: 'f1', asset_id: 'a1', stored_name: 'script_v001.pdf', name: 'script.pdf', uploaded_at: '2026-09-01T00:00:00Z', size: 1234, version: 1 },
      { id: 'f2', asset_id: 'a1', stored_name: 'table_read_v001.mov', name: 'table_read.mov', uploaded_at: '2026-09-02T00:00:00Z', size: 4321, version: 1 },
    ],
    myProjectRole: 'manager', projectIsStaffed: false, activeProjectId: 'p1',
  }
  render(<TaskDetailPopup taskId="t1" ctx={ctx} onClose={onClose} />)
  return { onClose }
}

describe('TaskDetailPopup with the real FileManager', () => {
  it('W2 in the real notes editor (an <input>): Escape cancels the note and the popup stays; the next closes it', () => {
    // B4: the prompt is "Add notes…" (one ellipsis glyph, R4-19), and the
    // mark is FileManager's own now (`markFilesEscape` is gone).
    const { onClose } = popup()
    fireEvent.click(screen.getAllByText('Add notes…')[0])
    const note = document.activeElement
    expect(note.closest('.rb-task-detail-files')).not.toBeNull()
    fireEvent.keyDown(note, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getAllByText('Add notes…').length).toBeGreaterThan(0)
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // B4c: the preview left the files column for <body>, a kit Dialog on the
  // modal stack, so the popup's `filesLayerOpen` guard is gone — and ONE
  // Escape closes the player, where it used to close nothing (the guard
  // refused the popup's close and the hand-rolled overlay had no Escape).
  it('the real VideoPreview open (the kit Dialog in <body>): one Escape closes it and the popup stays; the next closes the popup', () => {
    const { onClose } = popup()
    fireEvent.click(screen.getByRole('button', { name: 'Play table_read_v001.mov' }))
    const preview = screen.getByRole('dialog', { name: 'table_read_v001.mov' })
    expect(preview.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(document.querySelector('.rb-task-detail-files').contains(preview)).toBe(false)
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'table_read_v001.mov' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Lock the script' })).toBeTruthy()
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
