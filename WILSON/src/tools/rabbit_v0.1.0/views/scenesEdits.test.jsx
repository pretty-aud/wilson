/** @vitest-environment jsdom */
// =============================================================================
// Post-overhaul S3c — the Scenes tab's EDITS, mounted (ScenesView with a ctx
// built from S3a's selectors, as rabbitScenesRender.test.jsx builds its own).
// Step 3: seeing an edit — the bar's edit selector, the cut (repeats, a
// missing shot, the bands following the cut), the tiles (D20), the toolbar
// standing aside, the edit's verbs, the picker's edits, "Recently removed".
// =============================================================================
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useMemo, useState } from 'react'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'
import {
  activeScenesOf, activeShotsOf, activeShotListOf, scenesOfList, shotsOfList, listsContainingOf,
  unlistedScenesOf, unlistedShotsOf, nextShotListVersion, formatShotListLabel, isWithdrawn, backfillItems,
  editsOfList, editChainTip, nextEditVersion, editItemsFromList,
} from '../state/shotListModel'
import { startDraft, changeDraft, undoDraft, redoDraft } from '../state/editDrafts'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
const perms = vi.hoisted(() => ({ admin: { role: 'admin', ready: true, can: () => true }, current: null }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => perms.current || perms.admin }))
const team = vi.hoisted(() => ({ members: [] }))
const rateCard = vi.hoisted(() => ({ entries: [], rateCards: [] }))
vi.mock('../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => team }))
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => rateCard }))
const roster = vi.hoisted(() => ({ members: [], mode: 'supabase' }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => roster }))
const rabbit = vi.hoisted(() => ({ current: null }))

const { default: ScenesView } = await import('./ScenesView')

afterEach(() => { cleanup(); _resetOverlaysForTests(); vi.restoreAllMocks(); localStorage.clear(); perms.current = null })

export const SCENES = () => [
  { id: 'sc1', name: 'Lighthouse, dawn', scene_number: 1, status: 'final' },
  { id: 'sc2', name: 'Cliff path', scene_number: 2, status: 'needs_revisions' },
]
export const SHOTS = () => [
  { id: 'sh1', scene_id: 'sc1', name: 'The door', shot_number: 10, status: 'final', frame_count: 240 },
  { id: 'sh2', scene_id: 'sc1', name: 'The cold lamp', shot_number: 20, status: 'in_progress', frame_count: 48 },
  { id: 'sh3', scene_id: 'sc2', name: 'The climb', shot_number: 10, status: 'not_started', frame_count: 100 },
]
export const LIST_1 = {
  id: 'list-1', project_id: 'p1', title: 'Shoot', version: 2, summary: null, snapshot: {},
  archived_at: null, archived_by: null, created_at: '2026-09-30T10:00:00Z', created_by: null,
}
const itemsFor = (listId, entries) => entries.map((it, i) => ({ id: `${listId}-item-${i + 1}`, shot_list_id: listId, project_id: 'p1', scene_id: null, shot_id: null, ...it }))
const editItem = (id, scene, shot, label) => ({ id, scene_id: scene, shot_id: shot, label: label || shot, notes: '' })
// "Director's cut · v1": the climb first, the door twice, then a shot since
// deleted from the project, then the cold lamp — scene 1 comes back after 2.
export const EDIT_1 = {
  id: 'edit-1', project_id: 'p1', shot_list_id: 'list-1', title: "Director's cut", version: 1, summary: 'First assembly',
  parent_edit_id: null, snapshot: null, archived_at: null, archived_by: null, created_at: '2026-10-01T09:00:00Z', created_by: null,
  items: [
    editItem('i1', 'sc2', 'sh3'),
    editItem('i2', 'sc1', 'sh1'),
    editItem('i3', 'sc1', 'sh1'),
    editItem('i4', 'sc1', 'gone', 'The lost pan'),
    editItem('i5', 'sc2', 'sh2'),
  ],
}

/** S3a's ctx selectors over these rows, as RabbitProvider's shotListView builds them. */
function listContext({ project, scenes, shots, shotLists, shotListItems, edits }) {
  const pointer = { active_shot_list_id: project.active_shot_list_id || null }
  return {
    scenes: activeScenesOf({ project: pointer, shotLists, shotListItems, scenes, shots }),
    shots: activeShotsOf({ project: pointer, shotLists, shotListItems, shots }),
    allScenes: scenes,
    allShots: shots,
    shotLists,
    shotListItems,
    edits,
    activeShotList: activeShotListOf(pointer, shotLists),
    scenesOf: (id) => scenesOfList(scenes, shotListItems, id, shots),
    shotsOf: (id) => shotsOfList(shots, shotListItems, id, scenes),
    listsContaining: (id) => listsContainingOf({ shotLists, shotListItems, shots }, id),
    editsOf: (id) => editsOfList(edits, id),
    editChainTip: (id) => editChainTip(edits, id),
    nextEditVersion: (id, title) => nextEditVersion(edits, id, title),
    editItemsFromList: (id) => {
      let n = 0
      return editItemsFromList({ scenes, shots, items: shotListItems, listId: id, newId: () => `s${++n}` })
    },
    unlistedScenes: unlistedScenesOf({ shotLists, shotListItems, scenes, shots }),
    unlistedShots: unlistedShotsOf({ shotLists, shotListItems, shots }),
    sceneById: (id) => (id ? scenes.find((s) => s.id === id) || null : null),
    shotById: (id) => (id ? shots.find((s) => s.id === id) || null : null),
    nextShotListVersion: (title) => nextShotListVersion(shotLists, title),
    formatShotListLabel,
    isWithdrawn,
    recentlyWithdrawn: null,
    canWithdrawShotList: () => false,
    canWithdrawEdit: () => false,
  }
}

/** The page, mounted with LIST_1 active holding every row, and EDIT_1 on it. */
export function page({ scenes = SCENES(), shots = SHOTS(), edits = [EDIT_1], pageActive = true, ...extra } = {}) {
  const lists = [LIST_1]
  const items = itemsFor(LIST_1.id, backfillItems(scenes, shots))
  const project = { id: 'p1', name: 'Salt Hours', fps: 24, active_shot_list_id: LIST_1.id }
  const ctx = {
    project,
    ...listContext({ project, scenes, shots, shotLists: lists, shotListItems: items, edits }),
    adapterMode: 'local_server',
    assets: [], tasks: [], phases: [], teamAssignments: [], files: [], managedFiles: [],
    binsInfo: { loadedFor: 'p1' },
    updateScene: vi.fn(), updateShot: vi.fn(),
    deleteScene: vi.fn(async () => {}), deleteShot: vi.fn(async () => {}),
    addScene: vi.fn(async () => {}), addShot: vi.fn(async () => {}),
    saveShotListSnapshot: vi.fn(async (id) => ({ id })),
    setActiveShotList: vi.fn(async (id) => id),
    archiveShotList: vi.fn(async (id) => ({ id })),
    archiveEdit: vi.fn(async (id) => ({ id })),
    withdrawEdit: vi.fn(async (id) => ({ id })),
    restoreWithdrawn: vi.fn(async () => null),
    clearRecentlyWithdrawn: vi.fn(),
    reorderShotListItems: vi.fn(async () => []),
    runBatch: vi.fn(async (fn) => fn()),
    ...extra,
  }
  rabbit.current = ctx
  return { ctx, ...render(<ScenesView pageActive={pageActive} />) }
}

export const editSelect = () => screen.getByRole('combobox', { name: 'Edit on screen' })
export const pickEdit = (value) => fireEvent.change(editSelect(), { target: { value } })
const tiles = (container) => Object.fromEntries([...container.querySelectorAll('.rb-scene-stat')].map(t => [
  t.querySelector('.ui-stat-label')?.textContent, t.querySelector('.ui-stat-value')?.textContent,
]))
const cutRowNames = (container) => [...container.querySelectorAll('.rb-scene-cut-row .rb-scene-cut-name')].map(n => n.textContent)
/** A kit Menu item by its words (the kit Menu's items are buttons in .ui-menu; a hint sits beside the label). */
export const menuItem = (words) => [...document.querySelectorAll('.ui-menu .ui-menu-item')]
  .find((b) => (b.querySelector('.ui-menu-item-label')?.textContent ?? b.textContent) === words)
const bandLabels = (container) => [...container.querySelectorAll('.rb-scene-table-cut .rb-scene-group-label')].map(n => n.textContent)

describe('S3c step 3: seeing an edit', () => {
  it('the bar\'s selector offers "List order" and the list\'s live edits, after the list\'s own words', () => {
    page({ edits: [EDIT_1, { ...EDIT_1, id: 'edit-0', title: 'Old', version: 1, archived_at: '2026-10-01T10:00:00Z' }] })
    const options = [...editSelect().options].map(o => o.textContent)
    expect(options).toEqual(['List order', "Director's cut · v1"])
    expect(editSelect().value).toBe('')
    // The list's words come first on the bar, the edit's after.
    const bar = document.querySelector('.rb-scene-lists')
    const text = bar.textContent
    expect(text.indexOf('Shoot · v2')).toBeLessThan(text.indexOf('Edit'))
  })
  it('choosing an edit shows its cut: cut positions, a repeated shot twice, a missing shot by its last name, the bands following the cut', () => {
    const { container } = page()
    expect(container.querySelector('.rb-scene-table-cut')).toBeNull()
    pickEdit('edit-1')
    expect(container.querySelector('.rb-scene-table-cut')).toBeTruthy()
    expect(cutRowNames(container)).toEqual(['The climb', 'The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
    expect([...container.querySelectorAll('.rb-scene-cut-pos')].map(n => n.textContent)).toEqual(['1', '2', '3', '4', '5'])
    expect(bandLabels(container)).toEqual(['Cliff path', 'Lighthouse, dawn', 'Cliff path'])
    expect(container.querySelector('.rb-scene-cut-row[data-missing="true"] .rb-scene-cut-name').textContent).toBe('Missing shot: The lost pan')
    // The list's own tables are not on screen.
    expect(container.querySelector('.rb-scene-table-scenes')).toBeNull()
  })
  it('D20: the tiles total the cut in order — repeats counted, the missing shot not — and the runtime says it is the edit\'s', () => {
    const { container } = page()
    expect(tiles(container)['Total runtime']).toBeDefined()
    pickEdit('edit-1')
    const t = tiles(container)
    expect(t['Total runtime']).toBeUndefined()
    // 100 + 240 + 240 + 48 = 628 frames at 24 fps.
    expect(t['Edit runtime']).toBe('00:00:26:04')
    expect(t['Total frames']).toBe('628')
    expect(t.Scenes).toBe('2')
    expect(t.Shots).toBe('4')
  })
  it('the toolbar stands aside: sort, group, filter and view greyed with the reason; New scene and New shot give way to the cut', () => {
    page()
    pickEdit('edit-1')
    expect(screen.getByRole('combobox', { name: 'Sort' }).disabled).toBe(true)
    expect(screen.getByRole('combobox', { name: 'Group' }).disabled).toBe(true)
    for (const name of ['Filter', 'Sorted ascending — reverse']) {
      const b = screen.getByRole('button', { name })
      expect(b.closest('[aria-disabled="true"]')?.getAttribute('title'), name).toMatch(/^An edit shows its cut order/)
    }
    for (const tab of ['Scenes', 'Shots']) expect(screen.getByRole('tab', { name: tab }).disabled, tab).toBe(true)
    const newScene = screen.getByRole('button', { name: 'New scene' })
    expect(newScene.closest('[aria-disabled="true"]')?.getAttribute('title')).toMatch(/^An edit is on screen/)
    // CONTROL: back to List order, every one of them works again.
    pickEdit('')
    expect(screen.getByRole('combobox', { name: 'Sort' }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'New scene' }).closest('[aria-disabled="true"]')).toBeNull()
  })
  it('the search still finds a shot in the cut (its count says how many of the cut\'s rows), and a band with none goes', () => {
    const { container } = page()
    pickEdit('edit-1')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'door' } })
    expect(cutRowNames(container)).toEqual(['The door', 'The door'])
    expect(bandLabels(container)).toEqual(['Lighthouse, dawn'])
    expect(container.querySelector('.rb-scene-count').textContent).toBe('2/5')
  })
  it('while an edit is on screen the bar offers its verbs, never the list\'s Save beside them; List order brings the list\'s back', () => {
    page()
    expect(screen.getByRole('button', { name: 'Save as…' })).toBeTruthy()
    pickEdit('edit-1')
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save as…' })).toBeNull()
    expect(document.querySelector('.rb-scene-lists').textContent).toContain('Saved')
    pickEdit('')
    expect(screen.getByRole('button', { name: 'Save as…' })).toBeTruthy()
  })
  it('Archive this edit (a manager\'s): asked, written, and the list goes back to List order', async () => {
    const { ctx } = page()
    pickEdit('edit-1')
    fireEvent.click(screen.getByRole('button', { name: 'More shot list actions' }))
    fireEvent.click(menuItem('Archive this edit'))
    const q = screen.getByRole('dialog', { name: 'Archive this edit?' })
    await act(async () => { fireEvent.click(within(q).getByRole('button', { name: 'Archive' })) })
    expect(ctx.archiveEdit).toHaveBeenCalledWith('edit-1', true)
    expect(editSelect().value).toBe('')
  })
  it('Withdraw this edit is offered only where S3a\'s rule and the seat both allow it', async () => {
    const { ctx } = page({ canWithdrawEdit: (id) => id === 'edit-1' })
    pickEdit('edit-1')
    fireEvent.click(screen.getByRole('button', { name: 'More shot list actions' }))
    fireEvent.click(menuItem('Withdraw this edit'))
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Withdraw this edit?' })).getByRole('button', { name: 'Withdraw' })) })
    expect(ctx.withdrawEdit).toHaveBeenCalledWith('edit-1')
    cleanup()
    page()
    pickEdit('edit-1')
    fireEvent.click(screen.getByRole('button', { name: 'More shot list actions' }))
    expect(menuItem('Withdraw this edit')).toBeUndefined()
  })
  it('the picker lists the selected list\'s edits (title, version, created, summary); opening one shows it', () => {
    const { container } = page()
    fireEvent.click(screen.getByRole('button', { name: 'Shot lists…' }))
    const picker = screen.getByRole('dialog', { name: 'Shot lists' })
    const edits = within(picker).getByRole('group', { name: 'Edits of Shoot · v2' })
    const row = within(edits).getByRole('button', { name: "Director's cut" }).closest('tr')
    expect([...row.querySelectorAll('td')].slice(1, 5).map(td => td.textContent)).toEqual(["Director's cut", 'v1', expect.stringMatching(/2026/), 'First assembly'])
    fireEvent.doubleClick(row)
    expect(screen.queryByRole('dialog', { name: 'Shot lists' })).toBeNull()
    expect(editSelect().value).toBe('edit-1')
    expect(container.querySelector('.rb-scene-table-cut')).toBeTruthy()
  })
  it('"Recently removed" names a withdrawn edit and its list; Open shows it read-only, Restore restores it', async () => {
    const gone = { ...EDIT_1, archived_at: '2026-10-02T09:00:00Z', archived_by: 'u1', created_by: 'u1' }
    const { ctx, container } = page({ edits: [gone], recentlyWithdrawn: { kind: 'edit', id: gone.id, row: gone } })
    const bar = document.querySelector('.rb-scene-lists')
    expect(bar.textContent).toContain("Recently removed: Director's cut · v1, an edit of Shoot · v2")
    fireEvent.click(within(bar).getByRole('button', { name: 'Open' }))
    expect(editSelect().value).toBe('edit-1')
    expect([...editSelect().options].map(o => o.textContent)).toContain("Director's cut · v1 (archived)")
    expect(container.querySelector('.rb-scene-table-cut')).toBeTruthy()
    await act(async () => { fireEvent.click(within(bar).getByRole('button', { name: 'Restore' })) })
    expect(ctx.restoreWithdrawn).toHaveBeenCalled()
  })
})

// ── Step 4: the draft, and the first-change question (D13) ────────────────
// The page over a stateful stand-in for the provider's draft (the real one is
// editDraftsProvider.test.jsx's): editDrafts.js's own pure steps, kept in
// React state, so a change re-renders the page as the provider's does.
const log = { start: [], change: [], undo: 0, redo: 0, discard: 0, addShot: [], save: [] }
function DraftHarness({ edits: given, extra, pageActive }) {
  const [drafts, setDrafts] = useState({})
  const [shots, setShots] = useState(SHOTS)
  const [saved, setSaved] = useState([])
  const edits = useMemo(() => [...given, ...saved], [given, saved])
  const scenes = useMemo(() => SCENES(), [])
  const items = useMemo(() => itemsFor(LIST_1.id, backfillItems(scenes, SHOTS())), [scenes])
  const ctx = useMemo(() => {
    const project = { id: 'p1', name: 'Salt Hours', fps: 24, active_shot_list_id: LIST_1.id }
    return {
      project,
      ...listContext({ project, scenes, shots, shotLists: [LIST_1], shotListItems: items, edits }),
      adapterMode: 'local_server',
      assets: [], tasks: [], phases: [], teamAssignments: [], files: [], managedFiles: [],
      binsInfo: { loadedFor: 'p1' },
      updateScene: vi.fn(), updateShot: vi.fn(),
      clearRecentlyWithdrawn: vi.fn(),
      reorderShotListItems: vi.fn(async () => []),
      runBatch: vi.fn(async (fn) => fn()),
      undo: vi.fn(), redo: vi.fn(),
      editDraftOf: (listId) => drafts[listId] || null,
      startEditDraft: (opts) => { log.start.push(opts); setDrafts(d => ({ ...d, [opts.listId]: startDraft({ projectId: 'p1', ...opts, now: 't' }) })) },
      changeEditDraft: (listId, next) => { log.change.push(next); setDrafts(d => ({ ...d, [listId]: changeDraft(d[listId], next, 't') })) },
      undoEditDraft: (listId) => { log.undo += 1; setDrafts(d => { const n = undoDraft(d[listId], 't'); return n ? { ...d, [listId]: n } : d }); return true },
      redoEditDraft: (listId) => { log.redo += 1; setDrafts(d => { const n = redoDraft(d[listId], 't'); return n ? { ...d, [listId]: n } : d }); return true },
      discardEditDraft: (listId) => { log.discard += 1; setDrafts(d => { const n = { ...d }; delete n[listId]; return n }) },
      // As the provider's: the draft becomes the next edit (here, at once).
      saveEditDraft: async (listId, opts) => {
        log.save.push([listId, opts])
        if (extra.saveRefusal) throw extra.saveRefusal
        const draft = drafts[listId]
        const row = { ...EDIT_1, id: `edit-saved-${log.save.length}`, title: opts.title, version: opts.version, summary: opts.summary, items: draft.items, parent_edit_id: 'edit-1', created_at: '2026-10-02T12:00:00Z', snapshot: { kind: 'edit' } }
        setDrafts(d => { const n = { ...d }; delete n[listId]; return n })
        setSaved(s => [...s, row])
        return row
      },
      addShot: async (shot, opts) => {
        const row = { id: `sh-new-${log.addShot.length + 1}`, ...shot }
        log.addShot.push([shot, opts])
        setShots(s => [...s, row])
        return row
      },
      ...extra,
    }
  }, [drafts, shots, scenes, items, edits, extra])
  rabbit.current = ctx
  return <ScenesView pageActive={pageActive} />
}
function draftPage({ edits = [EDIT_1], pageActive = true, ...extra } = {}) {
  log.start = []; log.change = []; log.undo = 0; log.redo = 0; log.discard = 0; log.addShot = []; log.save = []
  return render(<DraftHarness edits={edits} extra={extra} pageActive={pageActive} />)
}
const cutNames = () => cutRowNames(document)
const rowMenu = (name, pos) => fireEvent.click(screen.getByRole('button', { name: `Edit actions for ${name} (cut ${pos})` }))
const bandMenu = (label) => fireEvent.click(screen.getAllByRole('button', { name: `Edit actions for the ${label} block` })[0])
const question = () => screen.queryByRole('dialog', { name: /^Make a new (edit from this list|version of this edit)\?$/ })
const yes = async (label) => { await act(async () => { fireEvent.click(within(question()).getByRole('button', { name: label })) }) }

describe('S3c step 4: the first change asks once (D13), and the draft takes every change after it', () => {
  it('on a saved edit, a change asks first — what Yes makes, from what, with which change — Cancel focused; Cancel changes nothing', () => {
    draftPage()
    pickEdit('edit-1')
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Duplicate in edit'))
    const q = question()
    expect(screen.getByRole('dialog', { name: 'Make a new version of this edit?' })).toBe(q)
    expect(q.textContent).toContain('Yes starts “Director\'s cut · v2” from “Director\'s cut · v1” with this change: Duplicate “The climb” in the edit.')
    expect(q.textContent).toContain('“Director\'s cut · v1” stays as it was saved. Nothing is saved until you choose Save edit.')
    expect(document.activeElement.textContent).toBe('Cancel')
    fireEvent.click(within(q).getByRole('button', { name: 'Cancel' }))
    expect(question()).toBeNull()
    expect(log.start).toEqual([])
    expect(cutNames()).toEqual(['The climb', 'The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
  })

  it('Yes starts the draft from the edit with the change applied — on screen, named in the selector — and the next change asks nothing', async () => {
    draftPage()
    pickEdit('edit-1')
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Duplicate in edit'))
    await yes('Start new version')
    expect(log.start).toHaveLength(1)
    expect(log.start[0]).toMatchObject({ listId: 'list-1', basedOnEditId: 'edit-1', title: "Director's cut", version: 2 })
    expect(log.start[0].base.map(i => i.id)).toEqual(['i1', 'i2', 'i3', 'i4', 'i5'])
    expect(cutNames()).toEqual(['The climb', 'The climb', 'The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
    expect(editSelect().value).toBe('draft')
    expect(editSelect().selectedOptions[0].textContent).toBe("Director's cut · v2 (not saved)")
    // The second change: no question, straight into the draft.
    rowMenu('Missing shot: The lost pan', 5)
    fireEvent.click(menuItem('Remove from edit'))
    expect(question()).toBeNull()
    expect(log.change).toHaveLength(1)
    expect(cutNames()).toEqual(['The climb', 'The climb', 'The door', 'The door', 'The cold lamp'])
    expect(log.start).toHaveLength(1)
  })

  it('Ctrl+Z / Ctrl+Y on a draft are the draft\'s own: its last change taken back and put back; the provider\'s keys are not pressed', async () => {
    const { container } = draftPage()
    pickEdit('edit-1')
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Remove from edit'))
    await yes('Start new version')
    expect(cutNames()).toEqual(['The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
    fireEvent.keyDown(container, { key: 'z', ctrlKey: true })
    expect(log.undo).toBe(1)
    expect(cutNames()).toEqual(['The climb', 'The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
    fireEvent.keyDown(container, { key: 'y', ctrlKey: true })
    expect(log.redo).toBe(1)
    expect(cutNames()).toEqual(['The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
    expect(rabbit.current.undo).not.toHaveBeenCalled()
    expect(rabbit.current.redo).not.toHaveBeenCalled()
    // Not while typing in a field.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'z', ctrlKey: true })
    expect(log.undo).toBe(1)
  })

  it('without a draft the keys stay where S3b left them: off where there are no bins (CONTROL: with bins, the provider\'s)', () => {
    const { container } = draftPage()
    pickEdit('edit-1')
    fireEvent.keyDown(container, { key: 'z', ctrlKey: true })
    expect(rabbit.current.undo).not.toHaveBeenCalled()
    expect(log.undo).toBe(0)
    cleanup()
    const again = draftPage({ supportsBins: true })
    fireEvent.keyDown(again.container, { key: 'z', ctrlKey: true })
    expect(rabbit.current.undo).toHaveBeenCalledTimes(1)
  })

  it('Move up / Move down move one shot (stopping at the cut\'s ends), and stand aside while a search hides rows', async () => {
    draftPage()
    pickEdit('edit-1')
    rowMenu('The climb', 1)
    expect(menuItem('Move up').disabled).toBe(true)
    fireEvent.click(menuItem('Move down'))
    await yes('Start new version')
    // Across a band's edge the shot joins the next scene's block, in place.
    expect(cutNames()).toEqual(['The climb', 'The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
    expect(bandLabels(document)).toEqual(['Lighthouse, dawn', 'Cliff path'])
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Move down'))
    expect(cutNames()).toEqual(['The door', 'The climb', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'door' } })
    rowMenu('The door', 1)
    expect(menuItem('Move down').disabled).toBe(true)
    expect(menuItem('Move down').textContent).toContain('clear the search')
  })

  it('a scene block moves, repeats and leaves the cut whole', async () => {
    draftPage()
    pickEdit('edit-1')
    bandMenu('Cliff path')
    fireEvent.click(menuItem('Move scene down'))
    await yes('Start new version')
    // Moved past the Lighthouse block, the climb meets the cut's other
    // Cliff path run: one band now.
    expect(bandLabels(document)).toEqual(['Lighthouse, dawn', 'Cliff path'])
    expect(cutNames()).toEqual(['The door', 'The door', 'Missing shot: The lost pan', 'The climb', 'The cold lamp'])
    bandMenu('Lighthouse, dawn')
    fireEvent.click(menuItem('Duplicate scene in edit'))
    expect(cutNames()).toEqual(['The door', 'The door', 'Missing shot: The lost pan', 'The door', 'The door', 'Missing shot: The lost pan', 'The climb', 'The cold lamp'])
    bandMenu('Lighthouse, dawn')
    fireEvent.click(menuItem('Remove scene from edit'))
    expect(cutNames()).toEqual(['The climb', 'The cold lamp'])
  })

  it('Add shot… offers the list\'s shots (repeats allowed, each says how often it plays) and puts the ticked ones after the row, in its block', async () => {
    draftPage()
    pickEdit('edit-1')
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Add shot…'))
    const d = screen.getByRole('dialog', { name: 'Add shots to the edit' })
    expect(d.textContent).toContain('Into a new version of “Director\'s cut · v1”, after “The climb” (cut 1). A shot added twice plays twice.')
    const doorRow = within(d).getByText('The door').closest('label')
    expect(doorRow.textContent).toContain('In the cut ×2')
    fireEvent.click(within(within(d).getByText('The cold lamp').closest('label')).getByRole('checkbox'))
    await act(async () => { fireEvent.click(within(d).getByRole('button', { name: 'Add 1 shot' })) })
    // A saved edit: the first change still asks.
    await yes('Start new version')
    expect(cutNames()).toEqual(['The climb', 'The cold lamp', 'The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
    expect(log.start[0].items[1]).toMatchObject({ shot_id: 'sh2', scene_id: 'sc2', label: 'The cold lamp' })
  })

  it('Add shot… is about the cut it opened on: archived under it, it closes', () => {
    const { rerender } = draftPage()
    pickEdit('edit-1')
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Add shot…'))
    expect(screen.getByRole('dialog', { name: 'Add shots to the edit' })).toBeTruthy()
    rerender(<DraftHarness edits={[{ ...EDIT_1, archived_at: '2026-10-02T09:00:00Z' }]} extra={{}} pageActive />)
    expect(screen.queryByRole('dialog', { name: 'Add shots to the edit' })).toBeNull()
    // Closed, not hidden: restored, the edit does not bring it back.
    rerender(<DraftHarness edits={[EDIT_1]} extra={{}} pageActive />)
    expect(screen.queryByRole('dialog', { name: 'Add shots to the edit' })).toBeNull()
  })

  it('New shot makes a real shot on the LIST only once Yes is pressed (Cancel makes none), and puts it at the block\'s end', async () => {
    draftPage()
    pickEdit('edit-1')
    bandMenu('Lighthouse, dawn')
    fireEvent.click(menuItem('New shot'))
    fireEvent.click(within(question()).getByRole('button', { name: 'Cancel' }))
    expect(log.addShot).toEqual([])
    bandMenu('Lighthouse, dawn')
    fireEvent.click(menuItem('New shot'))
    expect(question().textContent).toContain('with this change: Add a new shot to “Lighthouse, dawn”.')
    await yes('Start new version')
    expect(log.addShot).toHaveLength(1)
    // The scene's next number past EVERY shot of it (sh1 #10, sh2 #20).
    expect(log.addShot[0][0]).toMatchObject({ scene_id: 'sc1', shot_number: 21, status: 'not_started', frame_count: 0 })
    expect(log.addShot[0][1]).toEqual({ listId: 'list-1' })
    expect(log.start[0].items.map(i => i.shot_id)).toEqual(['sh3', 'sh1', 'sh1', 'gone', 'sh-new-1', 'sh2'])
  })

  it('a reviewer changes edits but not shots: New shot is greyed, "members only"; a seat without list writes gets no edit actions', () => {
    perms.current = { role: 'user', ready: true, can: () => false, userId: 'u-1' }
    draftPage({ adapterMode: 'supabase', myProjectRole: 'reviewer', projectIsStaffed: true })
    pickEdit('edit-1')
    rowMenu('The climb', 1)
    expect(menuItem('New shot').disabled).toBe(true)
    expect(menuItem('New shot').textContent).toContain('members only')
    expect(menuItem('Duplicate in edit').disabled).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    cleanup()
    draftPage({ adapterMode: 'supabase', myProjectRole: null, projectIsStaffed: true })
    pickEdit('edit-1')
    expect(screen.queryByRole('button', { name: 'Edit actions for The climb (cut 1)' })).toBeNull()
    expect(screen.queryAllByRole('button', { name: /^Edit actions for the .* block$/ })).toEqual([])
  })

  it('an archived edit is read-only: no edit actions', () => {
    draftPage({ edits: [{ ...EDIT_1, archived_at: '2026-10-02T09:00:00Z' }], recentlyWithdrawn: null })
    fireEvent.click(screen.getByRole('button', { name: 'Shot lists…' }))
    const picker = screen.getByRole('dialog', { name: 'Shot lists' })
    fireEvent.doubleClick(within(picker).getByRole('button', { name: "Director's cut" }).closest('tr'))
    expect(document.querySelector('.rb-scene-table-cut')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit actions for The climb (cut 1)' })).toBeNull()
  })

  it('"New edit from this list" (More): asks with no change named; Yes makes a draft of the list\'s order', async () => {
    draftPage({ edits: [] })
    fireEvent.click(screen.getByRole('button', { name: 'More shot list actions' }))
    fireEvent.click(menuItem('New edit from this list'))
    expect(question().textContent).toContain('Yes starts “Shoot · v1”, a new edit of “Shoot · v2”, from the list\'s order.')
    expect(question().textContent).toContain('The list itself does not change.')
    await yes('Start new edit')
    expect(log.start[0]).toMatchObject({ listId: 'list-1', basedOnEditId: null, title: 'Shoot', version: 1 })
    expect(cutNames()).toEqual(['The door', 'The cold lamp', 'The climb'])
    expect(editSelect().selectedOptions[0].textContent).toBe('Shoot · v1 (not saved)')
  })
})

describe('S3c step 4: "Recover unsaved edit?"', () => {
  const copy = { personKey: 'local', projectId: 'p1', listId: 'list-1', basedOnEditId: null, title: 'Shoot', version: 1, base: [], items: [editItem('a', 'sc1', 'sh1')], changedAt: '2026-10-02T09:00:00Z' }
  it('a copy a previous run left is offered while the page is on screen: Not now (focused) keeps it, Recover and Discard each answer it', async () => {
    const recoverEditDraft = vi.fn()
    const dismissStoredEditDraft = vi.fn()
    draftPage({ recoverableEditDrafts: [copy], recoverEditDraft, dismissStoredEditDraft })
    let d = screen.getByRole('dialog', { name: 'Recover unsaved edit?' })
    expect(d.textContent).toContain('WILSON closed before “Shoot · v1”, an edit of “Shoot · v2”, was saved. It holds 1 shot.')
    expect(document.activeElement.textContent).toBe('Not now')
    fireEvent.click(within(d).getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('dialog', { name: 'Recover unsaved edit?' })).toBeNull()
    expect(recoverEditDraft).not.toHaveBeenCalled()
    cleanup()
    // The next visit asks again.
    draftPage({ recoverableEditDrafts: [copy], recoverEditDraft, dismissStoredEditDraft })
    d = screen.getByRole('dialog', { name: 'Recover unsaved edit?' })
    await act(async () => { fireEvent.click(within(d).getByRole('button', { name: 'Recover edit' })) })
    expect(recoverEditDraft).toHaveBeenCalledWith('list-1')
    cleanup()
    draftPage({ recoverableEditDrafts: [copy], recoverEditDraft, dismissStoredEditDraft })
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Recover unsaved edit?' })).getByRole('button', { name: 'Discard edit' })) })
    expect(dismissStoredEditDraft).toHaveBeenCalledWith('list-1')
  })
  it('never over another page; a copy whose list is archived can only be discarded', () => {
    draftPage({ recoverableEditDrafts: [copy], pageActive: false })
    expect(screen.queryByRole('dialog', { name: 'Recover unsaved edit?' })).toBeNull()
    cleanup()
    draftPage({ recoverableEditDrafts: [{ ...copy, listId: 'gone-list' }] })
    const d = screen.getByRole('dialog', { name: 'Recover unsaved edit?' })
    expect(d.textContent).toContain('Its list is no longer in this project, so it cannot be recovered.')
    expect(within(d).queryByRole('button', { name: 'Recover edit' })).toBeNull()
    expect(within(d).getByRole('button', { name: 'Discard edit' })).toBeTruthy()
  })
})

// ── Step 5: Save edit, the pulse, Discard (D13, D14, D15) ──────────────────
async function draftOnEdit(extra = {}) {
  const page = draftPage(extra)
  pickEdit('edit-1')
  rowMenu('The climb', 1)
  fireEvent.click(menuItem('Remove from edit'))
  await yes('Start new version')
  return page
}
const lists = () => document.querySelector('.rb-scene-lists')
const saveEditDialog = () => screen.queryByRole('dialog', { name: 'Save edit' })

describe('S3c step 5: Save edit, the pulse, Discard', () => {
  it('a saved edit on screen: Save edit stands where Save stood, greyed with the reason; no pulse, no Discard', () => {
    draftPage()
    pickEdit('edit-1')
    const save = within(lists()).getByRole('button', { name: 'Save edit' })
    expect(save.closest('[aria-disabled="true"]').getAttribute('title')).toBe('Nothing to save: “Director\'s cut · v1” is as it was saved. A change to the cut starts its next version.')
    expect(save.dataset.attention).toBeUndefined()
    expect(lists().querySelector('.ui-btn-attention')).toBeNull()
    expect(within(lists()).queryByRole('button', { name: 'Discard changes' })).toBeNull()
    expect(within(lists()).queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('a draft: Save edit pulses (the kit\'s attention: signal edge, "● Unsaved", one polite announcement) with Discard changes beside it', async () => {
    await draftOnEdit()
    const save = within(lists()).getByRole('button', { name: 'Save edit' })
    expect(save.dataset.attention).toBe('true')
    expect(save.closest('[aria-disabled="true"]')).toBeNull()
    const note = lists().querySelector('.ui-btn-attention')
    expect(note.textContent).toBe('Unsaved')
    expect(note.nextElementSibling.nextElementSibling).toBe(save)
    expect(lists().querySelector('.ui-btn-live').textContent).toBe('“Director\'s cut · v2” is not saved yet')
    expect(within(lists()).getByRole('button', { name: 'Discard changes' })).toBeTruthy()
    // Never the list's Save beside it.
    expect(within(lists()).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(lists()).queryByRole('button', { name: 'Save as…' })).toBeNull()
  })

  it('Save edit: the chain\'s title at its next version, a summary — written, then the new edit on screen; the next change asks again', async () => {
    const { container } = await draftOnEdit()
    fireEvent.click(within(lists()).getByRole('button', { name: 'Save edit' }))
    const d = saveEditDialog()
    expect(d.textContent).toContain('The next edit of “Shoot · v2”: this cut, 4 shots in this order. Every shot keeps its name.')
    const title = within(d).getByRole('textbox', { name: 'Title' })
    expect(title.value).toBe("Director's cut")
    expect(title.disabled).toBe(true)
    expect(within(d).getByRole('switch', { name: 'Same title, next version' }).getAttribute('aria-checked')).toBe('true')
    expect(d.textContent).toContain('Will be “Director\'s cut · v2”')
    fireEvent.change(within(d).getByRole('textbox', { name: 'Summary' }), { target: { value: '  Without the climb\n' } })
    await act(async () => { fireEvent.click(within(d).getByRole('button', { name: 'Save edit' })) })
    expect(log.save).toEqual([['list-1', { title: "Director's cut", version: 2, summary: 'Without the climb' }]])
    expect(saveEditDialog()).toBeNull()
    expect(editSelect().value).toBe('edit-saved-1')
    expect(cutRowNames(container)).toEqual(['The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
    expect(lists().querySelector('.ui-btn-attention')).toBeNull()
    // After a Save, the next change asks again (D13).
    rowMenu('The door', 1)
    fireEvent.click(menuItem('Duplicate in edit'))
    expect(question().textContent).toContain('Yes starts “Director\'s cut · v3” from “Director\'s cut · v2”')
  })

  it('"Same title, next version" off: a title of one\'s own at ITS next version; an empty one is refused before anything is sent', async () => {
    await draftOnEdit()
    fireEvent.click(within(lists()).getByRole('button', { name: 'Save edit' }))
    const d = saveEditDialog()
    fireEvent.click(within(d).getByRole('switch', { name: 'Same title, next version' }))
    const title = within(d).getByRole('textbox', { name: 'Title' })
    expect(title.disabled).toBe(false)
    fireEvent.change(title, { target: { value: '' } })
    expect(d.textContent).toContain('An edit needs a title.')
    expect(within(d).getByRole('button', { name: 'Save edit' }).disabled).toBe(true)
    fireEvent.change(title, { target: { value: '  Festival cut ' } })
    expect(d.textContent).toContain('Will be “Festival cut · v1”')
    await act(async () => { fireEvent.click(within(d).getByRole('button', { name: 'Save edit' })) })
    expect(log.save[0][1]).toEqual({ title: 'Festival cut', version: 1, summary: null })
  })

  it('a refusal is shown verbatim in the dialog, which stays, and so does the draft', async () => {
    await draftOnEdit({ saveRefusal: new Error('This shot list already has an edit with this title and version.') })
    fireEvent.click(within(lists()).getByRole('button', { name: 'Save edit' }))
    await act(async () => { fireEvent.click(within(saveEditDialog()).getByRole('button', { name: 'Save edit' })) })
    expect(within(saveEditDialog()).getByRole('alert').textContent).toBe('This shot list already has an edit with this title and version.')
    expect(editSelect().value).toBe('draft')
  })

  it('written but its Save refused: the dialog closes, the edit is on screen, and the bar\'s Banner says what was not done', async () => {
    const err = new Error('The edit was saved as “Director\'s cut · v2”, but the names it holds were not: disk full')
    err.savedRow = { ...EDIT_1, id: 'edit-1' }
    await draftOnEdit({ saveRefusal: err })
    fireEvent.click(within(lists()).getByRole('button', { name: 'Save edit' }))
    await act(async () => { fireEvent.click(within(saveEditDialog()).getByRole('button', { name: 'Save edit' })) })
    expect(saveEditDialog()).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('The edit was saved as “Director\'s cut · v2”, but the names it holds were not: disk full')
  })

  it('Discard changes asks (Cancel focused) and says what comes back; Discard ends the draft and the saved edit returns', async () => {
    const { container } = await draftOnEdit()
    fireEvent.click(within(lists()).getByRole('button', { name: 'Discard changes' }))
    const q = screen.getByRole('dialog', { name: 'Discard changes?' })
    expect(q.textContent).toContain('“Director\'s cut · v2” is not saved: its changes go, and “Director\'s cut · v1” comes back as it was saved.')
    expect(document.activeElement.textContent).toBe('Cancel')
    await act(async () => { fireEvent.click(within(q).getByRole('button', { name: 'Discard changes' })) })
    expect(log.discard).toBe(1)
    expect(editSelect().value).toBe('edit-1')
    expect(cutRowNames(container)).toEqual(['The climb', 'The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
  })
})

// ── Step 6: drag-and-drop (D16) ─────────────────────────────────────────────
// Native drag events, dispatched as the browser sends them (a MouseEvent with
// its clientY, the dataTransfer beside it); each row's box is stubbed so the
// half the pointer is over can be chosen.
const dt = () => ({ setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '', dropEffect: '' })
function fire(type, el, transfer, clientY = 0) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientY })
  Object.defineProperty(ev, 'dataTransfer', { value: transfer })
  act(() => { el.dispatchEvent(ev) })
  return ev
}
const boxed = (row) => { row.getBoundingClientRect = () => ({ top: 0, height: 40, bottom: 40, left: 0, right: 100, width: 100 }); return row }
const BEFORE = 10
const AFTER = 30
/** Drag `grip` to `row`: start, over, drop, end — as one gesture. */
function dragTo(grip, row, clientY) {
  const transfer = dt()
  fire('dragstart', grip, transfer)
  fire('dragover', boxed(row), transfer, clientY)
  const line = row.getAttribute('data-drop')
  fire('drop', row, transfer, clientY)
  fire('dragend', grip, transfer)
  return { transfer, line }
}
const cutRow = (name, n = 0) => [...document.querySelectorAll('.rb-scene-cut-row')].filter(r => r.querySelector('.rb-scene-cut-name')?.textContent === name)[n]
const cutGrip = (name, n = 0) => cutRow(name, n).querySelector('.rb-scene-grip')
const cutBand = (label, n = 0) => [...document.querySelectorAll('.rb-scene-table-cut .rb-scene-group-row')].filter(r => r.querySelector('.rb-scene-group-label')?.textContent === label)[n]

describe('S3c step 6: drag-and-drop on a cut', () => {
  it('a row is dragged by the grip in its cut cell — only the grip is draggable, hidden from a screen reader (Move up / Move down are the keyboard\'s way)', () => {
    draftPage()
    pickEdit('edit-1')
    const grip = cutGrip('The door')
    expect(grip.getAttribute('draggable')).toBe('true')
    expect(grip.getAttribute('aria-hidden')).toBe('true')
    expect(grip.closest('td').classList.contains('rb-scene-cut-pos')).toBe(true)
    expect(grip.closest('td').getAttribute('data-grip')).toBe('true')
    expect(document.querySelectorAll('.rb-scene-table-cut [draggable="true"]')).toHaveLength(5 + 3)
  })

  it('on a saved edit the first drop asks — naming the move — and Yes makes the draft with it; the drop line shows while over', async () => {
    draftPage()
    pickEdit('edit-1')
    const { line, transfer } = dragTo(cutGrip('The cold lamp'), cutRow('The climb'), BEFORE)
    expect(line).toBe('before')
    expect(transfer.setData).toHaveBeenCalledWith('application/x-wilson-cut', expect.any(String))
    expect(transfer.setDragImage).toHaveBeenCalledWith(cutRow('The cold lamp'), 16, 16)
    expect(cutRow('The climb').getAttribute('data-drop')).toBeNull()
    expect(question().textContent).toContain('with this change: Move “The cold lamp” before “The climb”.')
    await yes('Start new version')
    expect(cutNames()).toEqual(['The cold lamp', 'The climb', 'The door', 'The door', 'Missing shot: The lost pan'])
    // It joined the block it landed in.
    expect(bandLabels(document)[0]).toBe('Cliff path')
  })

  it('on a draft every drop applies at once: after a row, to a block\'s top, a block whole', async () => {
    draftPage()
    pickEdit('edit-1')
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Duplicate in edit'))
    await yes('Start new version')
    expect(cutNames()).toEqual(['The climb', 'The climb', 'The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
    dragTo(cutGrip('The climb', 1), cutRow('The cold lamp'), AFTER)
    expect(question()).toBeNull()
    expect(cutNames()).toEqual(['The climb', 'The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp', 'The climb'])
    // Onto a block: its top (the line under its heading).
    const { line } = dragTo(cutGrip('The cold lamp'), cutBand('Lighthouse, dawn'), BEFORE)
    expect(line).toBe('after')
    expect(cutNames()).toEqual(['The climb', 'The cold lamp', 'The door', 'The door', 'Missing shot: The lost pan', 'The climb'])
    // A block, whole, by the grip before its name.
    const bandGrip = cutBand('Cliff path', 1).querySelector('.rb-scene-grip')
    dragTo(bandGrip, cutBand('Cliff path', 0), BEFORE)
    expect(bandLabels(document)).toEqual(['Cliff path', 'Lighthouse, dawn'])
    expect(cutNames()).toEqual(['The climb', 'The climb', 'The cold lamp', 'The door', 'The door', 'Missing shot: The lost pan'])
    // The first change made the draft; the three drops each changed it.
    expect(log.start).toHaveLength(1)
    expect(log.change).toHaveLength(3)
  })

  it('a row that takes the drag says so to the browser (its dragover\'s default is prevented — no drop happens otherwise); one that does not, does not', () => {
    draftPage()
    pickEdit('edit-1')
    let transfer = dt()
    fire('dragstart', cutGrip('The door'), transfer)
    expect(fire('dragover', boxed(cutRow('The climb')), transfer, AFTER).defaultPrevented).toBe(true)
    fire('dragend', cutGrip('The door'), transfer)
    transfer = dt()
    const bandGrip = cutBand('Lighthouse, dawn').querySelector('.rb-scene-grip')
    fire('dragstart', bandGrip, transfer)
    expect(fire('dragover', boxed(cutRow('The climb')), transfer, AFTER).defaultPrevented).toBe(false)
    fire('dragend', bandGrip, transfer)
  })

  it('the line goes when the drag is called off (dragend alone: Escape, or let go elsewhere), and when it lands', () => {
    draftPage()
    pickEdit('edit-1')
    const transfer = dt()
    fire('dragstart', cutGrip('The door'), transfer)
    fire('dragover', boxed(cutRow('The climb')), transfer, BEFORE)
    expect(cutRow('The climb').getAttribute('data-drop')).toBe('before')
    fire('dragend', cutGrip('The door'), transfer)
    expect(cutRow('The climb').getAttribute('data-drop')).toBeNull()
    expect(question()).toBeNull()
    // Lands, with no dragend after it: the line goes with the drop.
    const t2 = dt()
    fire('dragstart', cutGrip('The cold lamp'), t2)
    fire('dragover', boxed(cutRow('The climb')), t2, BEFORE)
    fire('drop', cutRow('The climb'), t2, BEFORE)
    expect(cutRow('The climb').getAttribute('data-drop')).toBeNull()
    expect(question()).not.toBeNull()
  })

  it('a block never lands on a row, and a row dropped back where it was asks nothing', () => {
    draftPage()
    pickEdit('edit-1')
    const bandGrip = cutBand('Lighthouse, dawn').querySelector('.rb-scene-grip')
    const { line } = dragTo(bandGrip, cutRow('The climb'), AFTER)
    expect(line).toBeNull()
    expect(question()).toBeNull()
    // The second door, dropped just after the first: where it already is.
    dragTo(cutGrip('The door', 1), cutRow('The door', 0), AFTER)
    expect(question()).toBeNull()
    expect(log.start).toEqual([])
    // CONTROL: after the climb it would join the climb's block — a change, asked.
    dragTo(cutGrip('The door'), cutRow('The climb'), AFTER)
    expect(question()).not.toBeNull()
  })

  it('nothing to drag where nothing may change: an archived edit, or a seat without list writes', () => {
    draftPage({ edits: [{ ...EDIT_1, archived_at: '2026-10-02T09:00:00Z' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Shot lists…' }))
    fireEvent.doubleClick(within(screen.getByRole('dialog', { name: 'Shot lists' })).getByRole('button', { name: "Director's cut" }).closest('tr'))
    expect(document.querySelectorAll('.rb-scene-table-cut .rb-scene-grip')).toHaveLength(0)
    cleanup()
    perms.current = { role: 'user', ready: true, can: () => false, userId: 'u-1' }
    draftPage({ adapterMode: 'supabase', myProjectRole: null, projectIsStaffed: true })
    pickEdit('edit-1')
    expect(document.querySelectorAll('.rb-scene-table-cut .rb-scene-grip')).toHaveLength(0)
  })
})

describe('S3c step 6: a drag on the LIST asks to make an edit (Audrey\'s flow)', () => {
  const sceneRow = (name) => screen.getByRole('button', { name: `Select ${name}` }).closest('tr')
  it('in List order a scene row is dragged by its number cell; the drop asks "Make a new edit from this list?" and Yes puts the draft on screen', async () => {
    draftPage({ edits: [] })
    const grip = sceneRow('Cliff path').querySelector('.rb-scene-num-cell > .rb-scene-grip')
    expect(grip.getAttribute('draggable')).toBe('true')
    const { line } = dragTo(grip, sceneRow('Lighthouse, dawn'), BEFORE)
    expect(line).toBe('before')
    const q = question()
    expect(screen.getByRole('dialog', { name: 'Make a new edit from this list?' })).toBe(q)
    expect(q.textContent).toContain('Yes starts “Shoot · v1”, a new edit of “Shoot · v2”, from the list\'s order with this change: Move the scene “Cliff path” before “Lighthouse, dawn”.')
    await yes('Start new edit')
    expect(editSelect().selectedOptions[0].textContent).toBe('Shoot · v1 (not saved)')
    expect(cutNames()).toEqual(['The climb', 'The door', 'The cold lamp'])
    // The list itself did not move.
    expect(rabbit.current.reorderShotListItems).not.toHaveBeenCalled()
  })

  it('Cancel leaves the list as it was and makes nothing', () => {
    draftPage({ edits: [] })
    dragTo(sceneRow('Cliff path').querySelector('.rb-scene-grip'), sceneRow('Lighthouse, dawn'), BEFORE)
    fireEvent.click(within(question()).getByRole('button', { name: 'Cancel' }))
    expect(log.start).toEqual([])
    expect(document.querySelector('.rb-scene-table-cut')).toBeNull()
    // The rows sprang back: the list's own order, as before the drag.
    const order = [...document.querySelectorAll('.rb-scene-table-scenes button[aria-label^="Select "]')]
      .map(b => b.getAttribute('aria-label')).filter(l => l !== 'Select every scene')
    expect(order).toEqual(['Select Lighthouse, dawn', 'Select Cliff path'])
  })

  it('a nested shot onto a shot of another scene joins that scene\'s block in the draft', async () => {
    draftPage({ edits: [] })
    fireEvent.click(within(sceneRow('Lighthouse, dawn')).getByRole('button', { name: 'Show shots' }))
    fireEvent.click(within(sceneRow('Cliff path')).getByRole('button', { name: 'Show shots' }))
    const shotRow = (name) => screen.getByRole('button', { name: `Select ${name}` }).closest('tr')
    dragTo(shotRow('The door').querySelector('.rb-scene-grip'), shotRow('The climb'), AFTER)
    expect(question().textContent).toContain('with this change: Move “The door” after “The climb”.')
    await yes('Start new edit')
    expect(cutNames()).toEqual(['The cold lamp', 'The climb', 'The door'])
    expect(bandLabels(document)).toEqual(['Lighthouse, dawn', 'Cliff path'])
  })

  it('the shot table (grouped by scene): a shot to the top of another scene; a scene\'s band before another', async () => {
    draftPage({ edits: [] })
    fireEvent.click(screen.getByRole('tab', { name: 'Shots' }))
    const shotRow = (name) => screen.getByRole('button', { name: `Select ${name}` }).closest('tr')
    const band = (label) => [...document.querySelectorAll('.rb-scene-table-shots .rb-scene-group-row')].find(r => r.querySelector('.rb-scene-group-label')?.textContent === label)
    const { line } = dragTo(shotRow('The cold lamp').querySelector('.rb-scene-grip'), band('Cliff path'), BEFORE)
    expect(line).toBe('after')
    expect(question().textContent).toContain('with this change: Move “The cold lamp” to the top of “Cliff path”.')
    fireEvent.click(within(question()).getByRole('button', { name: 'Cancel' }))
    dragTo(band('Cliff path').querySelector('.rb-scene-grip'), band('Lighthouse, dawn'), BEFORE)
    await yes('Start new edit')
    expect(bandLabels(document)).toEqual(['Cliff path', 'Lighthouse, dawn'])
  })

  it('no grips when the rows are not in the list\'s order: another sort, or the shots grouped by something else', () => {
    draftPage({ edits: [] })
    expect(document.querySelectorAll('.rb-scene-table-scenes .rb-scene-grip').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'name' } })
    expect(document.querySelectorAll('.rb-scene-grip')).toHaveLength(0)
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Shots' }))
    expect(document.querySelectorAll('.rb-scene-table-shots .rb-scene-grip').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'status' } })
    expect(document.querySelectorAll('.rb-scene-grip')).toHaveLength(0)
  })
})
