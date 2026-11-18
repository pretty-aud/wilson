/** @vitest-environment jsdom */
// =============================================================================
// useEntityWindow (post-overhaul F10, rabbit A1): the four kinds' windows do
// one thing one way. The scene and shot windows' own suite pins what they did
// (D21's questions, the drafts, the focus); this file pins what the Levels
// and Experiences window gained by taking the same behaviour: focus back to
// the words after Save, Cancel or Escape in Description or Notes (it fell to
// <body>), and a draft that follows the saved words while untouched and keeps
// what was typed (an effect overwrote it), with D21's question still off there
// (OUTSTANDING F10-02, her answer pending). Each red on the window before F10.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../../ui/overlay'
import { _resetLeaveGuardsForTests } from '../../state/leaveGuard'

vi.mock('../../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
const rabbit = vi.hoisted(() => ({ current: null }))
vi.mock('../../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true, can: () => true }) }))
const team = vi.hoisted(() => ({ members: [] }))
const rates = vi.hoisted(() => ({ entries: [] }))
const roster = vi.hoisted(() => ({ members: [], mode: 'supabase' }))
vi.mock('../../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => team }))
vi.mock('../../../../components/RateCard/useRateCard', () => ({ useRateCard: () => rates }))
vi.mock('../../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => roster }))
vi.mock('../../components/FileManager', () => ({ default: () => null }))

const { default: LevelsView } = await import('../LevelsView')

afterEach(() => { cleanup(); _resetOverlaysForTests(); _resetLeaveGuardsForTests(); localStorage.clear() })

const level = (extra = {}) => ({ id: 'l1', name: 'Harbour Approach', status: 'in_progress', sort_order: 0, description: '', ...extra })
function ctxWith(levels) {
  return {
    project: { id: 'p1', name: 'Salt Hours', levels_enabled: true }, levels, experiences: [], assets: [], tasks: [],
    phases: [], teamAssignments: [], files: [], managedFiles: [],
    addLevel: vi.fn(async () => {}), updateLevel: vi.fn(), deleteLevel: vi.fn(async () => {}), addTask: vi.fn(async () => {}),
  }
}
function open(levels = [level()]) {
  const ctx = ctxWith(levels)
  rabbit.current = ctx
  const view = render(<LevelsView />)
  fireEvent.click(within(screen.getByText('Harbour Approach').closest('tr')).getByRole('button', { name: 'Open Harbour Approach' }))
  return { ctx, view, dialog: screen.getByRole('dialog', { name: 'Harbour Approach' }) }
}

describe('the Levels window: focus back to the words when a Description or Notes edit closes', () => {
  for (const how of ['Save', 'Cancel', 'Escape']) {
    it(`after ${how}`, () => {
      const { dialog } = open()
      const words = () => within(dialog).getByRole('button', { name: 'Click to add a description...' })
      fireEvent.click(words())
      const box = within(dialog).getByRole('textbox', { name: 'Description' })
      fireEvent.change(box, { target: { value: 'Rain on the glass' } })
      if (how === 'Escape') fireEvent.keyDown(box, { key: 'Escape' })
      else fireEvent.click(within(dialog).getByRole('button', { name: how }))
      expect(within(dialog).queryByRole('textbox', { name: 'Description' })).toBeNull()
      // Save wrote it (the writer is a spy: the words on screen stay the saved ones).
      expect(document.activeElement).toBe(words())
    })
  }
})

describe('the Levels window: the draft follows the saved words while untouched, and keeps what was typed (R1-06)', () => {
  it('a change from elsewhere shows in an open, untouched editor; once typed in, the typed words stay', () => {
    const { view, dialog } = open([level({ description: 'First words' })])
    fireEvent.click(within(dialog).getByRole('button', { name: 'First words' }))
    const box = () => within(dialog).getByRole('textbox', { name: 'Description' })
    rabbit.current = ctxWith([level({ description: 'A teammate\'s words' })])
    view.rerender(<LevelsView />)
    expect(box().value).toBe('A teammate\'s words')
    fireEvent.change(box(), { target: { value: 'Mine' } })
    rabbit.current = ctxWith([level({ description: 'Theirs again' })])
    view.rerender(<LevelsView />)
    expect(box().value).toBe('Mine')
  })
})

describe('D21\'s question stays off in the Levels window (her answer pending)', () => {
  it('closing with a changed Description open closes, as before, without asking', () => {
    const { dialog } = open()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Click to add a description...' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Description' }), { target: { value: 'Typed' } })
    fireEvent.click(within(dialog.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
