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
//
// Review round 1 added: both kinds and both boxes (1E-06); D21 kept off on
// every path — Close, Escape in a changed box, a project switch — each red
// with the window's `asks` turned on, now that the window draws the questions
// (1E-01: a leave guard that asked with no question drawn held every exit);
// and each window's thumbnail told the desktop channel under its own kind
// (1E-02: a wrong kind passed every test).
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { _resetOverlaysForTests } from '../../../../ui/overlay'
import { _resetLeaveGuardsForTests, confirmLeave } from '../../state/leaveGuard'

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
const { default: ExperiencesView } = await import('../ExperiencesView')

afterEach(() => { cleanup(); _resetOverlaysForTests(); _resetLeaveGuardsForTests(); localStorage.clear(); delete window.electronAPI })

const KINDS = [
  { kind: 'level', View: LevelsView, col: 'levels', add: 'addLevel', update: 'updateLevel', del: 'deleteLevel', id: 'l1', name: 'Harbour Approach' },
  { kind: 'experience', View: ExperiencesView, col: 'experiences', add: 'addExperience', update: 'updateExperience', del: 'deleteExperience', id: 'e1', name: 'Night Market' },
]
const BOXES = [['Description', 'Click to add a description...'], ['Notes', 'Click to add notes...']]

const thing = (k, extra = {}) => ({ id: k.id, name: k.name, status: 'in_progress', sort_order: 0, description: '', ...extra })
function ctxWith(k, rows) {
  return {
    project: { id: 'p1', name: 'Salt Hours', levels_enabled: true, experiences_enabled: true },
    levels: [], experiences: [], [k.col]: rows, assets: [], tasks: [],
    phases: [], teamAssignments: [], files: [], managedFiles: [],
    [k.add]: vi.fn(async () => {}), [k.update]: vi.fn(), [k.del]: vi.fn(async () => {}), addTask: vi.fn(async () => {}),
  }
}
function open(k, rows = [thing(k)]) {
  const ctx = ctxWith(k, rows)
  rabbit.current = ctx
  const view = render(<k.View />)
  fireEvent.click(within(screen.getByText(k.name).closest('tr')).getByRole('button', { name: `Open ${k.name}` }))
  return { ctx, view, dialog: screen.getByRole('dialog', { name: k.name }) }
}
const discardQuestion = () => screen.queryByRole('dialog', { name: 'Discard your changes?' })

describe.each(KINDS)('the $kind window: focus back to the words when a Description or Notes edit closes', (k) => {
  for (const [label, empty] of BOXES) {
    for (const how of ['Save', 'Cancel', 'Escape']) {
      it(`${label}, after ${how}`, () => {
        const { dialog } = open(k)
        const words = () => within(dialog).getByRole('button', { name: empty })
        fireEvent.click(words())
        const box = within(dialog).getByRole('textbox', { name: label })
        fireEvent.change(box, { target: { value: 'Rain on the glass' } })
        if (how === 'Escape') fireEvent.keyDown(box, { key: 'Escape' })
        else fireEvent.click(within(box.closest('.rb-ent-detail-text')).getByRole('button', { name: how }))
        expect(within(dialog).queryByRole('textbox', { name: label })).toBeNull()
        // Save wrote it (the writer is a spy: the words on screen stay the saved ones).
        expect(document.activeElement).toBe(words())
      })
    }
  }
})

describe('the Levels window: the draft follows the saved words while untouched, and keeps what was typed (R1-06)', () => {
  it('a change from elsewhere shows in an open, untouched editor; once typed in, the typed words stay', () => {
    const [k] = KINDS
    const { view, dialog } = open(k, [thing(k, { description: 'First words' })])
    fireEvent.click(within(dialog).getByRole('button', { name: 'First words' }))
    const box = () => within(dialog).getByRole('textbox', { name: 'Description' })
    rabbit.current = ctxWith(k, [thing(k, { description: 'A teammate\'s words' })])
    view.rerender(<k.View />)
    expect(box().value).toBe('A teammate\'s words')
    fireEvent.change(box(), { target: { value: 'Mine' } })
    rabbit.current = ctxWith(k, [thing(k, { description: 'Theirs again' })])
    view.rerender(<k.View />)
    expect(box().value).toBe('Mine')
  })
})

describe.each(KINDS)('D21\'s question stays off in the $kind window (her answer pending, F10-02)', (k) => {
  function changed() {
    const opened = open(k)
    fireEvent.click(within(opened.dialog).getByRole('button', { name: 'Click to add a description...' }))
    fireEvent.change(within(opened.dialog).getByRole('textbox', { name: 'Description' }), { target: { value: 'Typed' } })
    return opened
  }
  it('Close with a changed Description open closes, as before, without asking', () => {
    const { dialog } = changed()
    fireEvent.click(within(dialog.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('Escape in the changed box reverts it, without asking', () => {
    const { dialog } = changed()
    fireEvent.keyDown(within(dialog).getByRole('textbox', { name: 'Description' }), { key: 'Escape' })
    expect(discardQuestion()).toBeNull()
    expect(within(dialog).queryByRole('textbox', { name: 'Description' })).toBeNull()
  })
  it('a project switch goes on, without asking: the window\'s leave guard holds nothing', async () => {
    changed()
    let answer = 'pending'
    await act(async () => { confirmLeave('project').then((a) => { answer = a }) })
    expect(answer).toBe(true)
    expect(discardQuestion()).toBeNull()
  })
})

describe.each(KINDS)('the $kind window\'s thumbnail goes to the desktop channel under its own kind and row', (k) => {
  it('Set thumbnail: the picture is written to the row, and the channel is told this kind and this row', async () => {
    const desktop = { pickImage: vi.fn(async () => 'dawn.png'), generateEntityThumbnail: vi.fn(async () => {}), clearEntityThumbnail: vi.fn(async () => {}) }
    window.electronAPI = { rabbit: desktop }
    const { ctx, dialog } = open(k)
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Set thumbnail' })) })
    expect(ctx[k.update]).toHaveBeenCalledWith(k.id, { thumbnail_image: 'dawn.png' })
    expect(desktop.generateEntityThumbnail).toHaveBeenCalledWith({ entityType: k.kind, entityId: k.id, sourcePath: 'dawn.png' })
  })
})

describe('the scene and shot windows tell the hook their own kind (the channel\'s entityType)', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../ScenesView.jsx'), 'utf8')
  const body = (name) => {
    const at = src.indexOf(`function ${name}(`)
    return src.slice(at, src.indexOf('\nfunction ', at + 1))
  }
  it('SceneDetailPopup\'s is \'scene\' and ShotDetailPopup\'s is \'shot\'', () => {
    expect(body('SceneDetailPopup')).toMatch(/useEntityWindow\(\{\s*row: scene, kind: 'scene',/)
    expect(body('ShotDetailPopup')).toMatch(/useEntityWindow\(\{\s*row: shot, kind: 'shot',/)
  })
})
