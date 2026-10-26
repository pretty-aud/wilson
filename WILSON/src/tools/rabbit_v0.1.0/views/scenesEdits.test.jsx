/** @vitest-environment jsdom */
// =============================================================================
// Post-overhaul S3c — the Scenes tab's EDITS, mounted (ScenesView with a ctx
// built from S3a's selectors, as rabbitScenesRender.test.jsx builds its own).
// Step 3: seeing an edit — the bar's edit selector, the cut (repeats, a
// missing shot, the bands following the cut), the tiles (D20), the toolbar
// standing aside, the edit's verbs, the picker's edits, "Recently removed".
// =============================================================================
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useEffect, useMemo, useRef, useState } from 'react'
import { render, screen, cleanup, fireEvent, within, act, waitFor } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'
import {
  activeScenesOf, activeShotsOf, activeShotListOf, scenesOfList, shotsOfList, listsContainingOf,
  unlistedScenesOf, unlistedShotsOf, nextShotListVersion, formatShotListLabel, isWithdrawn, backfillItems,
  editsOfList, editChainTip, nextEditVersion, editItemsFromList,
} from '../state/shotListModel'
import { startDraft, changeDraft, undoDraft, redoDraft } from '../state/editDrafts'
import { addLeaveGuard, _resetLeaveGuardsForTests } from '../state/leaveGuard'

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

afterEach(() => { cleanup(); _resetOverlaysForTests(); _resetLeaveGuardsForTests(); vi.restoreAllMocks(); localStorage.clear(); perms.current = null })

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
    // FX8: a row's buttons right after its name, in the kit's RowTitle, in
    // the name cell (its 4px/3px keep the row 44px — review round 1, R1-03);
    // a band's menu right after its words, its runtime last (R1-06).
    const row = container.querySelector('.rb-scene-cut-row')
    const cell = row.querySelector('.rb-scene-cut-name').closest('td')
    expect(cell.classList.contains('rb-scene-name-cell')).toBe(true)
    expect([...cell.querySelectorAll('.ui-row-title-acts button')].map(b => b.title)).toEqual(['Open The climb', 'Edit actions for The climb (cut 1)'])
    const head = container.querySelector('.rb-scene-table-cut .rb-scene-group-row .rb-scene-group-head')
    expect([...head.children].filter(c => !c.classList.contains('rb-scene-grip')).map(c => c.className))
      .toEqual(['rb-scene-cut-band-name', 'ui-hover-actions rb-scene-band-acts', 'rb-scene-group-frames'])
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
    // VW1e: the direction shows while the view has a sort, the one it reverses.
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'name' } })
    pickEdit('edit-1')
    expect(screen.getByRole('combobox', { name: 'Sort' }).disabled).toBe(true)
    expect(screen.getByRole('combobox', { name: 'Group' }).disabled).toBe(true)
    // The Views button too (step 0 finding 2): the view is not what is on screen.
    for (const name of ['Filter', 'Sorted ascending — reverse', 'Views: All']) {
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
  // FX4 (Audrey, 2026-10-12: "lets make the button 'save edit' and 'save
  // as'"): in List order the list's Save, Save as…, Set active; with an edit
  // on screen, in the same places, the edit's Save edit and Save as… — never
  // the list's beside them, and never "Save edit as…".
  it('while an edit is on screen the bar offers its verbs, never the list\'s Save beside them; List order brings the list\'s back', () => {
    page()
    const bar = () => document.querySelector('.rb-scene-lists')
    const verbs = () => [...bar().querySelectorAll('.ui-toolbar-right button')].map(b => b.textContent.trim()).filter(Boolean)
    expect(within(bar()).getByRole('button', { name: 'Save' })).toBeTruthy()
    expect(within(bar()).getByRole('button', { name: 'Save as…' })).toBeTruthy()
    pickEdit('edit-1')
    expect(within(bar()).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(bar()).getByRole('button', { name: 'Save edit' })).toBeTruthy()
    // The edit's Save as…, after Save edit (the list's places, the list's order).
    const v = verbs()
    expect(v.indexOf('Save as…')).toBe(v.indexOf('Save edit') + 1)
    expect(bar().textContent).toContain('Saved')
    pickEdit('')
    expect(within(bar()).getByRole('button', { name: 'Save' })).toBeTruthy()
    expect(within(bar()).queryByRole('button', { name: 'Save edit' })).toBeNull()
    for (const view of [() => {}, () => pickEdit('edit-1')]) {
      view()
      expect(screen.queryByRole('button', { name: 'Save edit as…' })).toBeNull()
    }
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
const log = { start: [], change: [], undo: 0, redo: 0, discard: 0, addShot: [], save: [], saveAs: [], leave: [] }
/** The stand-in provider's leave guard answers: 'stay', 'discard' (drops the draft, goes on) or 'go'. */
const leave = { answer: 'stay' }
function DraftHarness({ edits: given, extra, pageActive }) {
  const [drafts, setDrafts] = useState(() => extra.initialDrafts || {})
  // As the provider's (step 7): its drafts are the unsaved work every exit asks about.
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  useEffect(() => addLeaveGuard({
    order: 2,
    applies: (r) => r !== 'popup',
    dirty: () => Object.keys(draftsRef.current).length > 0,
    ask: async (r) => {
      log.leave.push(r)
      if (leave.answer === 'discard') { setDrafts({}); return true }
      return leave.answer === 'go'
    },
  }), [])
  const [shots, setShots] = useState(SHOTS)
  const [saved, setSaved] = useState([])
  // FX4: what Save edit wrote INTO a saved edit, by id.
  const [patched, setPatched] = useState({})
  const edits = useMemo(() => [...given.map(e => (patched[e.id] ? { ...e, ...patched[e.id] } : e)), ...saved], [given, saved, patched])
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
      // As the provider's: opts.made, the shots a change wrote (R1-04; review round 2 tests it).
      // As the provider's (FX4 review round 1): `next` may be a function of
      // the draft's items NOW, and `opts.editId` must be the draft's own.
      changeEditDraft: (listId, next, opts = {}) => {
        const cur = draftsRef.current[listId]
        if (!cur) throw new Error('there is no unsaved edit of this shot list')
        if ('editId' in opts && (cur.editId || null) !== (opts.editId || null)) throw new Error('another edit of this list has unsaved changes now, so this change was not made')
        const items = typeof next === 'function' ? next(cur.items) : next
        if (!items) return null
        log.change.push(items); log.changeOpts.push(opts)
        const changed = changeDraft(cur, items, 't', opts.made || [])
        draftsRef.current = { ...draftsRef.current, [listId]: changed }
        setDrafts(d => ({ ...d, [listId]: changed }))
        return changed
      },
      undoEditDraft: (listId) => { log.undo += 1; setDrafts(d => { const n = undoDraft(d[listId], 't'); return n ? { ...d, [listId]: n } : d }); return true },
      redoEditDraft: (listId) => { log.redo += 1; setDrafts(d => { const n = redoDraft(d[listId], 't'); return n ? { ...d, [listId]: n } : d }); return true },
      discardEditDraft: (listId) => { log.discard += 1; setDrafts(d => { const n = { ...d }; delete n[listId]; return n }) },
      // As the provider's (FX4): Save edit writes a saved edit's changes INTO
      // it (its title and version kept); a new edit from List order becomes
      // the chain's next edit under the name its question gave it.
      saveEditDraft: async (listId, opts) => {
        log.save.push(opts === undefined ? [listId] : [listId, opts])
        if (extra.saveRefusal) throw extra.saveRefusal
        const draft = drafts[listId]
        const end = () => setDrafts(d => { const n = { ...d }; delete n[listId]; return n })
        if (draft.editId) {
          const into = edits.find(e => e.id === draft.editId)
          const row = { ...into, items: draft.items, snapshot: { kind: 'edit', saved_at: '2026-10-12T12:00:00.000Z' } }
          setPatched(p => ({ ...p, [row.id]: { items: row.items, snapshot: row.snapshot } }))
          end()
          return row
        }
        const row = { ...EDIT_1, id: `edit-saved-${log.save.length}`, title: draft.title, version: draft.version, summary: null, items: draft.items, parent_edit_id: 'edit-1', created_at: '2026-10-02T12:00:00Z', snapshot: { kind: 'edit' } }
        end()
        setSaved(s => [...s, row])
        return row
      },
      // …and Save as… (FX4): always the chain's next edit, named in its dialog —
      // from the list's draft, or from a saved edit as it is.
      saveEditAs: async (listId, opts) => {
        log.saveAs.push([listId, opts])
        if (extra.saveRefusal) throw extra.saveRefusal
        const draft = drafts[listId]
        const items = draft ? draft.items : edits.find(e => e.id === opts.fromEditId).items
        const row = { ...EDIT_1, id: `edit-as-${log.saveAs.length}`, title: opts.title, version: opts.version, summary: opts.summary, items, parent_edit_id: 'edit-1', created_at: '2026-10-12T12:00:00Z', snapshot: { kind: 'edit', saved_at: '2026-10-12T12:00:00.000Z' } }
        if (draft) setDrafts(d => { const n = { ...d }; delete n[listId]; return n })
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
  log.start = []; log.change = []; log.changeOpts = []; log.undo = 0; log.redo = 0; log.discard = 0; log.addShot = []; log.save = []; log.saveAs = []; log.leave = []
  leave.answer = 'stay'
  return render(<DraftHarness edits={edits} extra={extra} pageActive={pageActive} />)
}
const cutNames = () => cutRowNames(document)
const rowMenu = (name, pos) => fireEvent.click(screen.getByRole('button', { name: `Edit actions for ${name} (cut ${pos})` }))
const bandMenu = (label) => fireEvent.click(screen.getAllByRole('button', { name: `Edit actions for the ${label} block` })[0])
// Every question a change can put: List order's (D13), and — FX4 — a saved
// edit's only one, when it would replace a kept copy. "Make a new version of
// this edit?" is gone, and a test that finds it fails here.
const question = () => screen.queryByRole('dialog', { name: /^(Make a new edit from this list|Replace the unsaved edit kept from before|Change this edit|Make a new version of this edit)\?$/ })
const yes = async (label) => { await act(async () => { fireEvent.click(within(question()).getByRole('button', { name: label })) }) }
/** FX4: a change to a saved edit lands at once — after its round trip, if it had one (New shot). */
const settle = async () => { await act(async () => {}) }
/** FX4: the edit's own unsaved changes are on screen — its own name, chosen as itself, no question. */
const changingEdit1 = () => {
  expect(question()).toBeNull()
  expect(editSelect().value).toBe('edit-1')
  expect(editSelect().selectedOptions[0].textContent).toBe("Director's cut · v1 (unsaved changes)")
}

describe('S3c step 4: the first change asks once (D13), and the draft takes every change after it', () => {
  // FX4 (Audrey, 2026-10-12): "every single time i went to make the first
  // change it forced me to make a new version ... when i make changes to an
  // edit, it should start to edit the current selected edit instead of asking
  // me to always make a new one."
  it('FX4: on a saved edit, a change asks nothing — it is made to THAT edit, unsaved: its own title and version, chosen as itself', async () => {
    draftPage()
    pickEdit('edit-1')
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Duplicate in edit'))
    await settle()
    changingEdit1()
    expect(log.start).toHaveLength(1)
    expect(log.start[0]).toMatchObject({ listId: 'list-1', basedOnEditId: 'edit-1', editId: 'edit-1', title: "Director's cut", version: 1, baseSavedAt: null })
    expect(log.start[0].base.map(i => i.id)).toEqual(['i1', 'i2', 'i3', 'i4', 'i5'])
    expect(cutNames()).toEqual(['The climb', 'The climb', 'The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
    // No "new edit" entry beside it: the selector holds the list's edits only.
    expect([...editSelect().options].map(o => o.value)).toEqual(['', 'edit-1'])
    // The second change: no question, straight into the same changes.
    rowMenu('Missing shot: The lost pan', 5)
    fireEvent.click(menuItem('Remove from edit'))
    expect(question()).toBeNull()
    expect(log.change).toHaveLength(1)
    expect(cutNames()).toEqual(['The climb', 'The climb', 'The door', 'The door', 'The cold lamp'])
    expect(log.start).toHaveLength(1)
  })

  it('FX4: the changes remember the Save they began from (for Save edit\'s check), and an OLDER edit is changed itself, not the chain\'s next', async () => {
    const v2 = { ...EDIT_1, id: 'edit-2', version: 2, parent_edit_id: 'edit-1', items: EDIT_1.items.slice(1), snapshot: { kind: 'edit', saved_at: '2026-10-05T10:00:00.000Z' } }
    const v1 = { ...EDIT_1, snapshot: { kind: 'edit', saved_at: '2026-10-01T09:00:00.000Z' } }
    draftPage({ edits: [v1, v2] })
    pickEdit('edit-1')
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Move down'))
    await settle()
    expect(log.start[0]).toMatchObject({ editId: 'edit-1', title: "Director's cut", version: 1, baseSavedAt: '2026-10-01T09:00:00.000Z' })
    expect(editSelect().value).toBe('edit-1')
    expect([...editSelect().options].map(o => o.textContent)).toEqual(['List order', "Director's cut · v1 (unsaved changes)", "Director's cut · v2"])
  })

  it('Ctrl+Z / Ctrl+Y on a draft are the draft\'s own: its last change taken back and put back; the provider\'s keys are not pressed', async () => {
    const { container } = draftPage()
    pickEdit('edit-1')
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Remove from edit'))
    await settle()
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
    await settle()
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
    await settle()
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
    // FX4: into the edit itself, not "a new version of" it.
    expect(d.textContent).toContain('Into “Director\'s cut · v1”, after “The climb” (cut 1). A shot added twice plays twice.')
    const doorRow = within(d).getByText('The door').closest('label')
    expect(doorRow.textContent).toContain('In the cut ×2')
    fireEvent.click(within(within(d).getByText('The cold lamp').closest('label')).getByRole('checkbox'))
    await act(async () => { fireEvent.click(within(d).getByRole('button', { name: 'Add 1 shot' })) })
    // A saved edit: the change is its own at once (FX4), no question.
    changingEdit1()
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

  // FX4: no question stands before a saved edit's change, so New shot writes
  // its real shot at once (D6), and the edit's changes carry it. Where a
  // question still stands (a kept copy, below), Cancel still makes none.
  it('New shot on a saved edit makes its real shot on the LIST at once and puts it at the block\'s end; Discard changes says it stays', async () => {
    draftPage()
    pickEdit('edit-1')
    bandMenu('Lighthouse, dawn')
    await act(async () => { fireEvent.click(menuItem('New shot')) })
    changingEdit1()
    expect(log.start[0].made).toEqual(['sh-new-1'])
    expect(log.addShot).toHaveLength(1)
    // The scene's next number past EVERY shot of it (sh1 #10, sh2 #20).
    expect(log.addShot[0][0]).toMatchObject({ scene_id: 'sc1', shot_number: 21, status: 'not_started', frame_count: 0 })
    expect(log.addShot[0][1]).toEqual({ listId: 'list-1' })
    expect(log.start[0].items.map(i => i.shot_id)).toEqual(['sh3', 'sh1', 'sh1', 'gone', 'sh-new-1', 'sh2'])
    // R1-04: Discard changes says the shot it wrote stays in the list.
    fireEvent.click(within(document.querySelector('.rb-scene-lists')).getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByRole('dialog', { name: 'Discard changes?' }).querySelector('.ui-dialog-body').textContent).toMatch(/The new shot they added to the list, “PROJ_SC001_SH0021”, stays there\.$/)
    expect(screen.getByRole('dialog', { name: 'Discard changes?' }).textContent).not.toContain('Nothing was written')
  })

  // Review round 2 (R2-08): R1-04's later New shot — on a draft already
  // unsaved, no question — had no test: the draft's change must carry the
  // shot it wrote, or Discard changes says "Nothing was written".
  it('R1-04 / R2-08: New shot on a draft already unsaved: the change carries the shot it wrote, and Discard changes names it', async () => {
    draftPage()
    pickEdit('edit-1')
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Duplicate in edit'))
    await settle()
    expect(log.start[0].made || []).toEqual([])
    bandMenu('Lighthouse, dawn')
    await act(async () => { fireEvent.click(menuItem('New shot')) })
    expect(question()).toBeNull()
    expect(log.changeOpts.at(-1).made).toEqual(['sh-new-1'])
    fireEvent.click(within(document.querySelector('.rb-scene-lists')).getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByRole('dialog', { name: 'Discard changes?' }).querySelector('.ui-dialog-body').textContent).toMatch(/The new shot they added to the list, “PROJ_SC001_SH0021”, stays there\.$/)
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

  // Review round 1 (R1-06): Yes swapped the More menu away (a draft has none)
  // with focus in it, and focus fell to the page.
  it('R1-06: after Yes, focus is on Save edit — the control the question came from is gone', async () => {
    draftPage({ edits: [] })
    fireEvent.click(screen.getByRole('button', { name: 'More shot list actions' }))
    fireEvent.click(menuItem('New edit from this list'))
    await yes('Start new edit')
    expect(screen.queryByRole('button', { name: 'More shot list actions' })).toBeNull()
    expect(document.activeElement.tagName).toBe('BUTTON')
    expect(document.activeElement.textContent).toBe('Save edit')
  })
  // Review round 2 (R2-08): R1-06 moves focus only when nothing holds it;
  // that check had no test. A row action hands focus back to the row's menu,
  // which is still there: focus stays (FX4: with no question between).
  it('R1-06 / R2-08: after a row action on a saved edit, focus stays on that row\'s menu — still there — and is not taken to Save edit', async () => {
    draftPage()
    pickEdit('edit-1')
    const trigger = screen.getByRole('button', { name: 'Edit actions for The climb (cut 1)' })
    trigger.focus()
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Duplicate in edit'))
    await settle()
    expect(document.activeElement.textContent).not.toBe('Save edit')
    expect(document.activeElement.getAttribute('aria-label') || document.activeElement.getAttribute('title')).toMatch(/^Edit actions for The climb \(cut \d\)$/)
  })

  it('"New edit from this list" (More): asks with no change named; Yes makes a draft of the list\'s order', async () => {
    draftPage({ edits: [] })
    fireEvent.click(screen.getByRole('button', { name: 'More shot list actions' }))
    fireEvent.click(menuItem('New edit from this list'))
    expect(question().textContent).toContain('Start new edit makes “Shoot · v1”, a new edit of “Shoot · v2”, from the list\'s order.')
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
    expect(d.textContent).toContain('“Shoot · v1”, an edit of “Shoot · v2”, was left unsaved. It holds 1 shot.')
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
  it('a three-answer question is a question: the draft\'s Ctrl+Z stands down under it (CONTROL: once answered, it acts)', () => {
    const base = EDIT_1.items
    const initialDrafts = { 'list-1': startDraft({ projectId: 'p1', listId: 'list-1', basedOnEditId: 'edit-1', title: "Director's cut", version: 2, base, items: base.slice(1), now: 't' }) }
    const { container } = draftPage({ initialDrafts, recoverableEditDrafts: [{ ...copy, listId: 'gone-list' }] })
    expect(screen.getByRole('dialog', { name: 'Recover unsaved edit?' }).getAttribute('data-width')).toBe('form')
    // A shot's popup open beneath: the tab's own surface keeps the keys, so
    // only the question's own count can stand them down (the form width is
    // not the confirm width questionOnScreen otherwise reads).
    fireEvent.click(screen.getAllByRole('button', { name: 'Open The door' })[0])
    expect(screen.getByRole('dialog', { name: 'The door' })).toBeTruthy()
    fireEvent.keyDown(container, { key: 'z', ctrlKey: true })
    expect(log.undo).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    fireEvent.keyDown(container, { key: 'z', ctrlKey: true })
    expect(log.undo).toBe(1)
  })
  // Review round 2 (R2-05): the window's close question is App's own (no kit
  // Dialog, its backdrop marked data-app-question): with a draft on screen a
  // Ctrl+Z under it took back a Move down. A question, popup open or not.
  it('R2-05: under the window\'s close question the draft\'s Ctrl+Z stands down, a popup open beneath or not (CONTROL: the same element unmarked does not)', () => {
    const base = EDIT_1.items
    const initialDrafts = { 'list-1': startDraft({ projectId: 'p1', listId: 'list-1', basedOnEditId: 'edit-1', title: "Director's cut", version: 2, base, items: base.slice(1), now: 't' }) }
    const { container } = draftPage({ initialDrafts })
    const q = document.createElement('div')
    q.setAttribute('data-app-question', 'close')
    document.body.appendChild(q)
    try {
      fireEvent.keyDown(container, { key: 'z', ctrlKey: true })
      expect(log.undo).toBe(0)
      fireEvent.click(screen.getAllByRole('button', { name: 'Open The door' })[0])
      fireEvent.keyDown(container, { key: 'z', ctrlKey: true })
      expect(log.undo).toBe(0)
      q.removeAttribute('data-app-question')
      fireEvent.keyDown(container, { key: 'z', ctrlKey: true })
      expect(log.undo).toBe(1)
    } finally {
      q.remove()
    }
  })
  // Review round 1 (R1-03): "Not now" kept the copy, but the next new edit of
  // its list replaced it without a word, and nothing led back to it.
  it('R1-03: put off, the copy is one menu item away, and a new edit of its list says it replaces it — and how to keep it instead', () => {
    draftPage({ recoverableEditDrafts: [copy], edits: [] })
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Recover unsaved edit?' })).getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('dialog', { name: 'Recover unsaved edit?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More shot list actions' }))
    fireEvent.click(menuItem('New edit from this list'))
    expect(question().textContent).toContain('It replaces “Shoot · v1”, the unsaved edit of this list kept from before (1 shot), which is then gone. To keep that one instead, choose Cancel, then Recover unsaved edit… in the bar\'s More menu.')
    fireEvent.click(within(question()).getByRole('button', { name: 'Cancel' }))
    // …and the way back is where it says.
    fireEvent.click(screen.getByRole('button', { name: 'More shot list actions' }))
    fireEvent.click(menuItem('Recover unsaved edit…'))
    expect(screen.getByRole('dialog', { name: 'Recover unsaved edit?' })).toBeTruthy()
  })
  // Review round 2 (R2-08): R1-03's item on a SAVED EDIT's More (the bar
  // while an edit of the list is on screen) had no test.
  it('R1-03 / R2-08: put off, the copy is in a saved edit\'s More menu too, and opens the question', () => {
    draftPage({ recoverableEditDrafts: [copy] })
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Recover unsaved edit?' })).getByRole('button', { name: 'Not now' }))
    pickEdit('edit-1')
    fireEvent.click(screen.getByRole('button', { name: 'More shot list actions' }))
    expect(menuItem('Archive this edit')).toBeTruthy()
    fireEvent.click(menuItem('Recover unsaved edit…'))
    expect(screen.getByRole('dialog', { name: 'Recover unsaved edit?' })).toBeTruthy()
  })
  // FX4: a saved edit's change asks nothing — except when it would replace an
  // unsaved edit of the list kept from before (R1-03's rule, on an edit now).
  it('FX4: on a saved edit a change asks only to replace a kept copy — Cancel keeps it and makes nothing (no New shot written); Replace kept edit makes the change on the edit itself', async () => {
    draftPage({ recoverableEditDrafts: [copy] })
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Recover unsaved edit?' })).getByRole('button', { name: 'Not now' }))
    pickEdit('edit-1')
    bandMenu('Lighthouse, dawn')
    await act(async () => { fireEvent.click(menuItem('New shot')) })
    const q = question()
    expect(screen.getByRole('dialog', { name: 'Replace the unsaved edit kept from before?' })).toBe(q)
    expect(q.textContent).toContain('Changing “Director\'s cut · v1” replaces “Shoot · v1”, the unsaved edit of this list kept from before (1 shot), which is then gone.')
    expect(q.textContent).toContain('The new shot is added to the list now, and stays there whatever becomes of the edit. The change (Add a new shot to “Lighthouse, dawn”) is made to “Director\'s cut · v1” itself')
    expect(q.textContent).not.toMatch(/new version/)
    expect(document.activeElement.textContent).toBe('Cancel')
    expect(within(q).getByRole('button', { name: 'Replace kept edit' }).dataset.variant).toBe('danger')
    fireEvent.click(within(q).getByRole('button', { name: 'Cancel' }))
    expect(log.addShot).toEqual([])
    expect(log.start).toEqual([])
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Move down'))
    await yes('Replace kept edit')
    changingEdit1()
    expect(log.start[0]).toMatchObject({ editId: 'edit-1', title: "Director's cut", version: 1 })
  })
  it('R1-03 CONTROL: with no copy kept for the list, neither the item nor the sentence', () => {
    draftPage({ edits: [] })
    fireEvent.click(screen.getByRole('button', { name: 'More shot list actions' }))
    expect(menuItem('Recover unsaved edit…')).toBeUndefined()
    fireEvent.click(menuItem('New edit from this list'))
    expect(question().textContent).not.toContain('It replaces')
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

// ── Step 5: Save edit, the pulse, Discard (D13, D14, D15) — and FX4 ───────
// FX4 (Audrey, 2026-10-12): "show me the unsaved and ask me to save or save
// as on the top button. only when i press save as should it ask me to make a
// new edit version." Save edit writes the changes INTO the edit on screen and
// opens nothing; Save as… is the one way to a new version, and asks for it.
async function draftOnEdit(extra = {}) {
  const page = draftPage(extra)
  pickEdit('edit-1')
  rowMenu('The climb', 1)
  fireEvent.click(menuItem('Remove from edit'))
  await settle()
  return page
}
const lists = () => document.querySelector('.rb-scene-lists')
const saveAsDialog = () => screen.queryByRole('dialog', { name: 'Save as a new version' })

describe('S3c step 5 / FX4: Save edit, Save as…, the pulse, Discard', () => {
  it('a saved edit on screen: Save edit stands where Save stood, greyed with the reason; Save as… beside it, live; no pulse, no Discard', () => {
    draftPage()
    pickEdit('edit-1')
    const save = within(lists()).getByRole('button', { name: 'Save edit' })
    expect(save.closest('[aria-disabled="true"]').getAttribute('title')).toBe('Nothing to save: “Director\'s cut · v1” is as it was saved. A change to the cut is made to it, and Save edit then saves it.')
    expect(save.dataset.attention).toBeUndefined()
    expect(lists().querySelector('.ui-btn-attention')).toBeNull()
    expect(within(lists()).queryByRole('button', { name: 'Discard changes' })).toBeNull()
    expect(within(lists()).queryByRole('button', { name: 'Save' })).toBeNull()
    const as = within(lists()).getByRole('button', { name: 'Save as…' })
    expect(as.closest('[aria-disabled="true"]')).toBeNull()
    expect(as.getAttribute('title')).toBe('Saves this cut as a new version, asking its title. “Director\'s cut · v1” stays as it was saved.')
  })

  it('unsaved changes: Save edit pulses (the kit\'s attention: signal edge, "● Unsaved", one polite announcement), then Save as… and Discard changes', async () => {
    await draftOnEdit()
    const save = within(lists()).getByRole('button', { name: 'Save edit' })
    expect(save.dataset.attention).toBe('true')
    expect(save.closest('[aria-disabled="true"]')).toBeNull()
    expect(save.getAttribute('title')).toBe('Saves these changes into “Director\'s cut · v1”, replacing its cut as it was saved. Save as… keeps that one and saves these as a new version.')
    const note = lists().querySelector('.ui-btn-attention')
    expect(note.textContent).toBe('Unsaved')
    expect(note.nextElementSibling.nextElementSibling).toBe(save)
    expect(lists().querySelector('.ui-btn-live').textContent).toBe('The changes to “Director\'s cut · v1” are not saved yet')
    // Save edit, Save as…, Discard changes: in that order, Discard last.
    const right = [...lists().querySelectorAll('.ui-toolbar-right button')].map(b => b.textContent.trim()).filter(Boolean)
    expect(right.slice(right.indexOf('Save edit'))).toEqual(['Save edit', 'Save as…', 'Discard changes'])
    // Never the list's Save beside it, nor the old name.
    expect(within(lists()).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(lists()).queryByRole('button', { name: 'Save edit as…' })).toBeNull()
    // Only Save edit pulses.
    expect(lists().querySelectorAll('[data-attention="true"]')).toHaveLength(1)
  })

  it('Save edit writes the changes INTO the edit on screen — no dialog, its title and version kept — and the next change asks nothing either', async () => {
    const { container } = await draftOnEdit()
    await act(async () => { fireEvent.click(within(lists()).getByRole('button', { name: 'Save edit' })) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(log.save).toEqual([['list-1']])
    expect(log.saveAs).toEqual([])
    expect(editSelect().value).toBe('edit-1')
    expect(editSelect().selectedOptions[0].textContent).toBe("Director's cut · v1")
    // No new edit: the list still has the one.
    expect([...editSelect().options].map(o => o.value)).toEqual(['', 'edit-1'])
    expect(cutRowNames(container)).toEqual(['The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
    expect(lists().querySelector('.ui-btn-attention')).toBeNull()
    // "Saved" is when it was last saved now, not when it was made (10/01).
    expect(lists().textContent).toMatch(/Saved 10\/12\/2026/)
    // The next change: the same edit's changes again, from the Save just made.
    rowMenu('The door', 1)
    fireEvent.click(menuItem('Duplicate in edit'))
    await settle()
    changingEdit1()
    expect(log.start).toHaveLength(2)
    expect(log.start[1]).toMatchObject({ editId: 'edit-1', version: 1, baseSavedAt: '2026-10-12T12:00:00.000Z' })
  })

  it('Save edit is one at a time: a second press while the first runs writes nothing more', async () => {
    let release
    const gate = new Promise(r => { release = r })
    const saveEditDraft = vi.fn(async () => { await gate; return { ...EDIT_1 } })
    await draftOnEdit({ saveEditDraft })
    const save = () => within(lists()).getByRole('button', { name: 'Save edit' })
    await act(async () => { fireEvent.click(save()) })
    expect(save().getAttribute('aria-busy')).toBe('true')
    await act(async () => { fireEvent.click(save()) })
    await act(async () => { release() })
    expect(saveEditDraft).toHaveBeenCalledTimes(1)
  })

  it('a refused Save edit (someone saved the edit since) is said in the bar\'s Banner, verbatim; the changes stay unsaved, on screen', async () => {
    const refusal = new Error('Someone saved “Director\'s cut · v1” since these changes began, and Save edit would write over that. Save as… keeps your changes as a new version; Discard changes shows the edit as they saved it.')
    const { container } = await draftOnEdit({ saveRefusal: refusal })
    await act(async () => { fireEvent.click(within(lists()).getByRole('button', { name: 'Save edit' })) })
    expect(screen.getByRole('alert').textContent).toBe(refusal.message)
    expect(lists().querySelector('.ui-btn-attention')).not.toBeNull()
    expect(editSelect().selectedOptions[0].textContent).toBe("Director's cut · v1 (unsaved changes)")
    expect(cutRowNames(container)).toEqual(['The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
  })

  it('a new edit from List order: Save edit saves it under the name its question gave it — no dialog', async () => {
    draftPage({ edits: [] })
    fireEvent.click(screen.getByRole('button', { name: 'More shot list actions' }))
    fireEvent.click(menuItem('New edit from this list'))
    await yes('Start new edit')
    expect(within(lists()).getByRole('button', { name: 'Save edit' }).getAttribute('title')).toBe('Saves “Shoot · v1” as a new edit of “Shoot · v2”.')
    await act(async () => { fireEvent.click(within(lists()).getByRole('button', { name: 'Save edit' })) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(log.save).toEqual([['list-1']])
    expect(editSelect().value).toBe('edit-saved-1')
    expect(editSelect().selectedOptions[0].textContent).toBe('Shoot · v1')
  })

  it('Save as… is the one way to a new version: its dialog asks the title (same title, next version) and a summary; the edit it began from stays', async () => {
    const { container } = await draftOnEdit()
    fireEvent.click(within(lists()).getByRole('button', { name: 'Save as…' }))
    const d = saveAsDialog()
    expect(d.textContent).toContain('A new version, from “Director\'s cut · v1”: this cut, 4 shots in this order. “Director\'s cut · v1” stays as it was saved.')
    const title = within(d).getByRole('textbox', { name: 'Title' })
    expect(title.value).toBe("Director's cut")
    expect(title.disabled).toBe(true)
    expect(within(d).getByRole('switch', { name: 'Same title, next version' }).getAttribute('aria-checked')).toBe('true')
    expect(d.textContent).toContain('Will be “Director\'s cut · v2”')
    fireEvent.change(within(d).getByRole('textbox', { name: 'Summary' }), { target: { value: '  Without the climb\n' } })
    await act(async () => { fireEvent.click(within(d).getByRole('button', { name: 'Save new version' })) })
    expect(log.saveAs).toEqual([['list-1', { title: "Director's cut", version: 2, summary: 'Without the climb', fromEditId: null }]])
    expect(log.save).toEqual([])
    expect(saveAsDialog()).toBeNull()
    expect(editSelect().value).toBe('edit-as-1')
    expect([...editSelect().options].map(o => o.textContent)).toEqual(['List order', "Director's cut · v1", "Director's cut · v2"])
    expect(cutRowNames(container)).toEqual(['The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
    expect(lists().querySelector('.ui-btn-attention')).toBeNull()
    // The edit it began from is as it was saved.
    pickEdit('edit-1')
    expect(cutRowNames(container)).toEqual(['The climb', 'The door', 'The door', 'Missing shot: The lost pan', 'The cold lamp'])
  })

  it('Save as… on a saved edit with nothing changed: a copy, as the next version, from that edit', async () => {
    draftPage()
    pickEdit('edit-1')
    fireEvent.click(within(lists()).getByRole('button', { name: 'Save as…' }))
    const d = saveAsDialog()
    expect(d.textContent).toContain('A new version, from “Director\'s cut · v1”: this cut, 5 shots in this order.')
    await act(async () => { fireEvent.click(within(d).getByRole('button', { name: 'Save new version' })) })
    expect(log.saveAs).toEqual([['list-1', { title: "Director's cut", version: 2, summary: null, fromEditId: 'edit-1' }]])
    expect(editSelect().value).toBe('edit-as-1')
  })

  it('"Same title, next version" off: a title of one\'s own at ITS next version; an empty one is refused before anything is sent', async () => {
    await draftOnEdit()
    fireEvent.click(within(lists()).getByRole('button', { name: 'Save as…' }))
    const d = saveAsDialog()
    fireEvent.click(within(d).getByRole('switch', { name: 'Same title, next version' }))
    const title = within(d).getByRole('textbox', { name: 'Title' })
    expect(title.disabled).toBe(false)
    fireEvent.change(title, { target: { value: '' } })
    expect(d.textContent).toContain('An edit needs a title.')
    expect(within(d).getByRole('button', { name: 'Save new version' }).disabled).toBe(true)
    fireEvent.change(title, { target: { value: '  Festival cut ' } })
    expect(d.textContent).toContain('Will be “Festival cut · v1”')
    await act(async () => { fireEvent.click(within(d).getByRole('button', { name: 'Save new version' })) })
    expect(log.saveAs[0][1]).toEqual({ title: 'Festival cut', version: 1, summary: null, fromEditId: null })
  })

  it('a Save as… refusal is shown verbatim in its dialog, which stays, and so do the changes', async () => {
    await draftOnEdit({ saveRefusal: new Error('This shot list already has an edit with this title and version.') })
    fireEvent.click(within(lists()).getByRole('button', { name: 'Save as…' }))
    await act(async () => { fireEvent.click(within(saveAsDialog()).getByRole('button', { name: 'Save new version' })) })
    expect(within(saveAsDialog()).getByRole('alert').textContent).toBe('This shot list already has an edit with this title and version.')
    expect(editSelect().value).toBe('edit-1')
    expect(lists().querySelector('.ui-btn-attention')).not.toBeNull()
  })

  it('Save as… written but its names refused: the dialog closes, the new edit is on screen, and the bar\'s Banner says what was not done', async () => {
    const err = new Error('The edit was saved as “Director\'s cut · v2”, but the names it holds were not: disk full')
    err.savedRow = { ...EDIT_1, id: 'edit-1' }
    await draftOnEdit({ saveRefusal: err })
    fireEvent.click(within(lists()).getByRole('button', { name: 'Save as…' }))
    await act(async () => { fireEvent.click(within(saveAsDialog()).getByRole('button', { name: 'Save new version' })) })
    expect(saveAsDialog()).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('The edit was saved as “Director\'s cut · v2”, but the names it holds were not: disk full')
  })

  it('Save as…\'s Cancel after typing asks first, and says the changes stay on screen, not saved', async () => {
    await draftOnEdit()
    fireEvent.click(within(lists()).getByRole('button', { name: 'Save as…' }))
    fireEvent.change(within(saveAsDialog()).getByRole('textbox', { name: 'Summary' }), { target: { value: 'x' } })
    fireEvent.click(within(saveAsDialog()).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('dialog', { name: 'Discard what you typed?' }).textContent).toContain('The changes stay on screen, not saved; only the title and summary typed here are dropped.')
  })

  it('a set-aside edit: no Save as… either — greyed with the reason', () => {
    draftPage({ edits: [{ ...EDIT_1, archived_at: '2026-10-02T09:00:00Z' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Shot lists…' }))
    fireEvent.doubleClick(within(screen.getByRole('dialog', { name: 'Shot lists' })).getByRole('button', { name: "Director's cut" }).closest('tr'))
    const as = within(lists()).getByRole('button', { name: 'Save as…' })
    expect(as.closest('[aria-disabled="true"]').getAttribute('title')).toBe('This edit is set aside: restore it to change it.')
  })

  it('Discard changes asks (Cancel focused) and says what goes; Discard ends the changes and the saved edit returns as it was', async () => {
    const { container } = await draftOnEdit()
    fireEvent.click(within(lists()).getByRole('button', { name: 'Discard changes' }))
    const q = screen.getByRole('dialog', { name: 'Discard changes?' })
    expect(q.textContent).toContain('The changes to “Director\'s cut · v1” are not saved: they go, and it comes back as it was saved.')
    expect(document.activeElement.textContent).toBe('Cancel')
    await act(async () => { fireEvent.click(within(q).getByRole('button', { name: 'Discard changes' })) })
    expect(log.discard).toBe(1)
    expect(editSelect().value).toBe('edit-1')
    expect(editSelect().selectedOptions[0].textContent).toBe("Director's cut · v1")
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

  // FX4: Audrey's own case — "i went to make a change in an edit and every
  // single time i went to make the first change it forced me to make a new
  // version": the first drop on a saved edit is that edit's change, asked
  // nothing.
  it('on a saved edit the first drop asks nothing — the edit takes it, unsaved; the drop line shows while over', async () => {
    draftPage()
    pickEdit('edit-1')
    const { line, transfer } = dragTo(cutGrip('The cold lamp'), cutRow('The climb'), BEFORE)
    expect(line).toBe('before')
    expect(transfer.setData).toHaveBeenCalledWith('application/x-wilson-cut', expect.any(String))
    // The dragged row is the drag's picture (the drop has landed since, and
    // the cut drawn again, so it is found by its name, not its element).
    expect(transfer.setDragImage).toHaveBeenCalledWith(expect.any(HTMLTableRowElement), 16, 16)
    expect(transfer.setDragImage.mock.calls[0][0].querySelector('.rb-scene-cut-name').textContent).toBe('The cold lamp')
    expect(cutRow('The climb').getAttribute('data-drop')).toBeNull()
    await settle()
    changingEdit1()
    expect(log.start).toHaveLength(1)
    expect(lists().querySelector('.ui-btn-attention').textContent).toBe('Unsaved')
    expect(cutNames()).toEqual(['The cold lamp', 'The climb', 'The door', 'The door', 'Missing shot: The lost pan'])
    // It joined the block it landed in.
    expect(bandLabels(document)[0]).toBe('Cliff path')
  })

  it('on a draft every drop applies at once: after a row, to a block\'s top, a block whole', async () => {
    draftPage()
    pickEdit('edit-1')
    rowMenu('The climb', 1)
    fireEvent.click(menuItem('Duplicate in edit'))
    await settle()
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
    // Review round 2 (R2-06): a row of ANOTHER block takes a block (after
    // that block); a row of its own block takes nothing.
    expect(fire('dragover', boxed(cutRow('The climb')), transfer, AFTER).defaultPrevented).toBe(true)
    expect(fire('dragover', boxed(cutRow('The door')), transfer, AFTER).defaultPrevented).toBe(false)
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
    // It landed (FX4: on the edit itself, asking nothing).
    expect(question()).toBeNull()
    expect(log.start).toHaveLength(1)
  })

  // Review round 1 (R1-07): over the lower half of a block's heading, a
  // block's line was drawn under the heading while the block landed after
  // the target block's last row.
  it('R1-07: a block over the lower half of a block\'s heading draws its line under that block\'s LAST row — where it lands', () => {
    draftPage()
    pickEdit('edit-1')
    const transfer = dt()
    const bandGrip = cutBand('Cliff path', 1).querySelector('.rb-scene-grip')
    fire('dragstart', bandGrip, transfer)
    fire('dragover', boxed(cutBand('Lighthouse, dawn')), transfer, AFTER)
    expect(cutBand('Lighthouse, dawn').getAttribute('data-drop')).toBeNull()
    expect(cutRow('Missing shot: The lost pan').getAttribute('data-drop')).toBe('after')
    // Over its top half: the heading's own line, before the block.
    fire('dragover', boxed(cutBand('Lighthouse, dawn')), transfer, BEFORE)
    expect(cutBand('Lighthouse, dawn').getAttribute('data-drop')).toBe('before')
    expect(cutRow('Missing shot: The lost pan').getAttribute('data-drop')).toBeNull()
    fire('dragend', bandGrip, transfer)
    // CONTROL: a shot onto the block is its top — the heading's line, as before.
    const t2 = dt()
    fire('dragstart', cutGrip('The cold lamp'), t2)
    fire('dragover', boxed(cutBand('Lighthouse, dawn')), t2, AFTER)
    expect(cutBand('Lighthouse, dawn').getAttribute('data-drop')).toBe('after')
    expect(cutRow('Missing shot: The lost pan').getAttribute('data-drop')).toBeNull()
    fire('dragend', cutGrip('The cold lamp'), t2)
  })

  // Review round 2 (R2-06): R1-07 drew a block's line under the target
  // block's last row, and that row refused the drop — the line vanished
  // under the pointer, and a drop on it did nothing. Any row of another block
  // takes a block, after that block; its own rows take nothing.
  it('R2-06: a block over ANY row of another block lands after that block — the line drawn under its last row, where the pointer can be', async () => {
    draftPage()
    pickEdit('edit-1')
    const bandGrip = cutBand('Lighthouse, dawn').querySelector('.rb-scene-grip')
    // Over the door's twin (its own block): nowhere.
    expect(dragTo(bandGrip, cutRow('The door', 1), AFTER).line).toBeNull()
    expect(question()).toBeNull()
    // Over the cold lamp (the last block's only row), either half: after that block.
    const transfer = dt()
    fire('dragstart', bandGrip, transfer)
    fire('dragover', boxed(cutRow('The cold lamp')), transfer, BEFORE)
    expect(cutRow('The cold lamp').getAttribute('data-drop')).toBe('after')
    expect(cutBand('Cliff path', 1).getAttribute('data-drop')).toBeNull()
    fire('drop', cutRow('The cold lamp'), transfer, BEFORE)
    fire('dragend', bandGrip, transfer)
    await settle()
    changingEdit1()
    expect(cutNames()).toEqual(['The climb', 'The cold lamp', 'The door', 'The door', 'Missing shot: The lost pan'])
  })

  // R2-06, measured on its re-run in Chromium: a step that changes the
  // element under the pointer fires dragenter and dragleave but no dragover
  // (the next comes a tick later), so a block's line cleared by each row's
  // dragleave blinked from row to row. It holds while the pointer moves
  // within the block, and goes when it leaves it.
  it('R2-06: a block\'s line holds while the pointer moves among that block\'s rows, and goes when it leaves the block', () => {
    draftPage()
    pickEdit('edit-1')
    const leaveTo = (from, to, transfer) => {
      const ev = new MouseEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: to })
      Object.defineProperty(ev, 'dataTransfer', { value: transfer })
      act(() => { from.dispatchEvent(ev) })
    }
    const bandGrip = cutBand('Cliff path', 0).querySelector('.rb-scene-grip')
    const transfer = dt()
    fire('dragstart', bandGrip, transfer)
    fire('dragover', boxed(cutRow('The door', 0)), transfer, BEFORE)
    const lineRow = () => cutRow('Missing shot: The lost pan')
    expect(lineRow().getAttribute('data-drop')).toBe('after')
    // Row to row inside "Lighthouse, dawn", and up onto its heading: the line stays.
    leaveTo(cutRow('The door', 0), cutRow('The door', 1).querySelector('td'), transfer)
    expect(lineRow().getAttribute('data-drop')).toBe('after')
    leaveTo(cutRow('The door', 1), cutBand('Lighthouse, dawn').querySelector('td'), transfer)
    expect(lineRow().getAttribute('data-drop')).toBe('after')
    // …and from the heading back down into its rows.
    fire('dragover', boxed(cutBand('Lighthouse, dawn')), transfer, AFTER)
    leaveTo(cutBand('Lighthouse, dawn'), cutRow('The door', 0).querySelector('td'), transfer)
    expect(lineRow().getAttribute('data-drop')).toBe('after')
    // Out of the block (onto the next block's row): it goes.
    leaveTo(lineRow(), cutRow('The cold lamp').querySelector('td'), transfer)
    expect(lineRow().getAttribute('data-drop')).toBeNull()
    fire('dragend', bandGrip, transfer)
  })

  it('a block over the row before it lands where it is (asks nothing), and a row dropped back where it was asks nothing', () => {
    draftPage()
    pickEdit('edit-1')
    const bandGrip = cutBand('Lighthouse, dawn').querySelector('.rb-scene-grip')
    // After the climb's block: where it already is.
    const { line } = dragTo(bandGrip, cutRow('The climb'), AFTER)
    expect(line).toBe('after')
    expect(question()).toBeNull()
    // The second door, dropped just after the first: where it already is.
    dragTo(cutGrip('The door', 1), cutRow('The door', 0), AFTER)
    expect(question()).toBeNull()
    expect(log.start).toEqual([])
    // CONTROL: after the climb it would join the climb's block — a change,
    // made (FX4: to the edit itself, asking nothing).
    dragTo(cutGrip('The door'), cutRow('The climb'), AFTER)
    expect(question()).toBeNull()
    expect(log.start).toHaveLength(1)
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
    expect(q.textContent).toContain('Start new edit makes “Shoot · v1”, a new edit of “Shoot · v2”, from the list\'s order with this change: Move the scene “Cliff path” before “Lighthouse, dawn”.')
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

  // Review round 1 (R1-07), the list's two blocks: a scene dropped after an
  // OPEN scene, or after a scene's band of shots, lands after its shots —
  // the line is drawn under them, not under the scene's own row.
  it('R1-07 on the list: a scene after an open scene draws its line under the nest of shots; after a band, under its last shot', () => {
    draftPage({ edits: [] })
    const nest = (name) => sceneRow(name).nextElementSibling
    // Closed: the scene's own row takes the line.
    let transfer = dt()
    const grip = sceneRow('Cliff path').querySelector('.rb-scene-num-cell > .rb-scene-grip')
    fire('dragstart', grip, transfer)
    fire('dragover', boxed(sceneRow('Lighthouse, dawn')), transfer, AFTER)
    expect(sceneRow('Lighthouse, dawn').getAttribute('data-drop')).toBe('after')
    fire('dragend', grip, transfer)
    // Open: the line is the nest's, under the shots.
    fireEvent.click(within(sceneRow('Lighthouse, dawn')).getByRole('button', { name: 'Show shots' }))
    expect(nest('Lighthouse, dawn').classList.contains('rb-scene-nest-row')).toBe(true)
    transfer = dt()
    fire('dragstart', grip, transfer)
    fire('dragover', boxed(sceneRow('Lighthouse, dawn')), transfer, AFTER)
    expect(sceneRow('Lighthouse, dawn').getAttribute('data-drop')).toBeNull()
    expect(nest('Lighthouse, dawn').getAttribute('data-drop')).toBe('after')
    fire('dragover', boxed(sceneRow('Lighthouse, dawn')), transfer, BEFORE)
    expect(sceneRow('Lighthouse, dawn').getAttribute('data-drop')).toBe('before')
    expect(nest('Lighthouse, dawn').getAttribute('data-drop')).toBeNull()
    fire('dragend', grip, transfer)
    cleanup()
    // The shot table grouped by scene: after a band, under its last shot.
    draftPage({ edits: [] })
    fireEvent.click(screen.getByRole('tab', { name: 'Shots' }))
    const band = (label) => [...document.querySelectorAll('.rb-scene-table-shots .rb-scene-group-row')].find(r => r.querySelector('.rb-scene-group-label')?.textContent === label)
    const shotRow = (name) => screen.getByRole('button', { name: `Select ${name}` }).closest('tr')
    transfer = dt()
    const bandGrip = band('Cliff path').querySelector('.rb-scene-grip')
    fire('dragstart', bandGrip, transfer)
    fire('dragover', boxed(band('Lighthouse, dawn')), transfer, AFTER)
    expect(band('Lighthouse, dawn').getAttribute('data-drop')).toBeNull()
    expect(shotRow('The cold lamp').getAttribute('data-drop')).toBe('after')
    fire('dragend', bandGrip, transfer)
  })

  // Review round 2 (R2-06), the list's two blocks: that line sat on rows that
  // refused a scene. An open scene's shots (and the rest of its nest), and a
  // band's shots, take a scene dropped on them: after that scene.
  it('R2-06 on the list: a scene over an open scene\'s shots, or its nest, lands after that scene; over its own, nowhere; a shot over a nest, nowhere', async () => {
    draftPage({ edits: [] })
    const nest = (name) => sceneRow(name).nextElementSibling
    const shotRow = (name) => screen.getByRole('button', { name: `Select ${name}` }).closest('tr')
    fireEvent.click(within(sceneRow('Cliff path')).getByRole('button', { name: 'Show shots' }))
    fireEvent.click(within(sceneRow('Lighthouse, dawn')).getByRole('button', { name: 'Show shots' }))
    const grip = sceneRow('Lighthouse, dawn').querySelector('.rb-scene-num-cell > .rb-scene-grip')
    let transfer = dt()
    fire('dragstart', grip, transfer)
    // Its own shots: nowhere.
    expect(fire('dragover', boxed(shotRow('The door')), transfer, BEFORE).defaultPrevented).toBe(false)
    expect(nest('Lighthouse, dawn').getAttribute('data-drop')).toBeNull()
    // Cliff path's shot, its top half: after Cliff path — the nest's line.
    expect(fire('dragover', boxed(shotRow('The climb')), transfer, BEFORE).defaultPrevented).toBe(true)
    expect(nest('Cliff path').getAttribute('data-drop')).toBe('after')
    expect(shotRow('The climb').getAttribute('data-drop')).toBeNull()
    // Up from the nest onto Cliff path's own row (the same block): it holds.
    const up = new MouseEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: sceneRow('Cliff path').querySelector('td') })
    Object.defineProperty(up, 'dataTransfer', { value: transfer })
    act(() => { shotRow('The climb').dispatchEvent(up) })
    expect(nest('Cliff path').getAttribute('data-drop')).toBe('after')
    // …and from that row back down into its nest.
    fire('dragover', boxed(sceneRow('Cliff path')), transfer, AFTER)
    const down = new MouseEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: nest('Cliff path').querySelector('td') })
    Object.defineProperty(down, 'dataTransfer', { value: transfer })
    act(() => { sceneRow('Cliff path').dispatchEvent(down) })
    expect(nest('Cliff path').getAttribute('data-drop')).toBe('after')
    // …straight into a shot row of the nest's own table (a row inside a row).
    fire('dragover', boxed(sceneRow('Cliff path')), transfer, AFTER)
    const inner = new MouseEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: shotRow('The climb').querySelector('td') })
    Object.defineProperty(inner, 'dataTransfer', { value: transfer })
    act(() => { sceneRow('Cliff path').dispatchEvent(inner) })
    expect(nest('Cliff path').getAttribute('data-drop')).toBe('after')
    fire('dragover', boxed(shotRow('The climb')), transfer, BEFORE)
    // Leaving that shot for nowhere takes the line away…
    fire('dragleave', shotRow('The climb'), transfer)
    expect(nest('Cliff path').getAttribute('data-drop')).toBeNull()
    // …and the nest around the shots draws it again, the same.
    expect(fire('dragover', boxed(nest('Cliff path')), transfer, BEFORE).defaultPrevented).toBe(true)
    expect(nest('Cliff path').getAttribute('data-drop')).toBe('after')
    fire('drop', shotRow('The climb'), transfer, BEFORE)
    fire('dragend', grip, transfer)
    expect(question().textContent).toContain('with this change:')
    await yes('Start new edit')
    expect(bandLabels(document)).toEqual(['Cliff path', 'Lighthouse, dawn'])
    cleanup()
    // CONTROL: a SHOT over a nest (not over a shot row) lands nowhere.
    draftPage({ edits: [] })
    fireEvent.click(within(sceneRow('Cliff path')).getByRole('button', { name: 'Show shots' }))
    fireEvent.click(within(sceneRow('Lighthouse, dawn')).getByRole('button', { name: 'Show shots' }))
    transfer = dt()
    const shotGrip = shotRow('The door').querySelector('.rb-scene-grip')
    fire('dragstart', shotGrip, transfer)
    expect(fire('dragover', boxed(nest('Cliff path')), transfer, BEFORE).defaultPrevented).toBe(false)
    fire('dragend', shotGrip, transfer)
  })

  it('R2-06 on the Shots table: a band over another band\'s shot lands after that band, its line under that band\'s last shot', async () => {
    draftPage({ edits: [] })
    fireEvent.click(screen.getByRole('tab', { name: 'Shots' }))
    const band = (label) => [...document.querySelectorAll('.rb-scene-table-shots .rb-scene-group-row')].find(r => r.querySelector('.rb-scene-group-label')?.textContent === label)
    const shotRow = (name) => screen.getByRole('button', { name: `Select ${name}` }).closest('tr')
    const bandGrip = band('Lighthouse, dawn').querySelector('.rb-scene-grip')
    // Its own shot: nowhere.
    expect(dragTo(bandGrip, shotRow('The door'), AFTER).line).toBeNull()
    expect(question()).toBeNull()
    // The line holds between Cliff path's band and its shot (one block), and
    // goes when the pointer leaves it.
    const leaveTo = (from, to, transfer) => {
      const ev = new MouseEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: to })
      Object.defineProperty(ev, 'dataTransfer', { value: transfer })
      act(() => { from.dispatchEvent(ev) })
    }
    const held = dt()
    fire('dragstart', bandGrip, held)
    fire('dragover', boxed(shotRow('The climb')), held, BEFORE)
    expect(shotRow('The climb').getAttribute('data-drop')).toBe('after')
    leaveTo(shotRow('The climb'), band('Cliff path').querySelector('td'), held)
    expect(shotRow('The climb').getAttribute('data-drop')).toBe('after')
    fire('dragover', boxed(band('Cliff path')), held, AFTER)
    leaveTo(band('Cliff path'), shotRow('The climb').querySelector('td'), held)
    expect(shotRow('The climb').getAttribute('data-drop')).toBe('after')
    leaveTo(shotRow('The climb'), band('Lighthouse, dawn').querySelector('td'), held)
    expect(shotRow('The climb').getAttribute('data-drop')).toBeNull()
    fire('dragend', bandGrip, held)
    const { line } = dragTo(bandGrip, shotRow('The climb'), BEFORE)
    expect(line).toBe('after')
    expect(question().textContent).toContain('with this change:')
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

// ── Step 7: the Scenes tab's own ways off a draft (D12) ────────────────────
describe('S3c step 7: what would take the draft off screen asks first', () => {
  it('the edit selector: Keep editing stays on the draft; Discard changes then shows what was chosen', async () => {
    await draftOnEdit()
    await act(async () => { pickEdit('') })
    expect(log.leave).toEqual(['edit'])
    // FX4: still the edit's own changes, chosen as itself.
    expect(editSelect().value).toBe('edit-1')
    expect(lists().querySelector('.ui-btn-attention')).not.toBeNull()
    leave.answer = 'discard'
    await act(async () => { pickEdit('') })
    expect(editSelect().value).toBe('')
    expect(document.querySelector('.rb-scene-table-cut')).toBeNull()
  })

  it('New shot list asks before its form opens; staying opens nothing', async () => {
    await draftOnEdit()
    await act(async () => { fireEvent.click(within(lists()).getByRole('button', { name: 'New shot list' })) })
    expect(log.leave).toEqual(['edit'])
    expect(screen.queryByRole('dialog', { name: 'New shot list' })).toBeNull()
    leave.answer = 'go'
    await act(async () => { fireEvent.click(within(lists()).getByRole('button', { name: 'New shot list' })) })
    expect(screen.getByRole('dialog', { name: 'New shot list' })).toBeTruthy()
  })

  it('the picker\'s Open of an edit asks; without a draft nothing asks', async () => {
    await draftOnEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Shot lists…' }))
    const picker = screen.getByRole('dialog', { name: 'Shot lists' })
    await act(async () => { fireEvent.doubleClick(within(picker).getByRole('button', { name: "Director's cut" }).closest('tr')) })
    expect(log.leave).toEqual(['edit'])
    cleanup()
    draftPage()
    await act(async () => { pickEdit('edit-1') })
    await act(async () => { pickEdit('') })
    expect(log.leave).toEqual([])
  })
})

// Post-overhaul FX1 (Audrey, 2026-10-11): an edit's cut draws a shot's frame
// count with the shot table's number field — its own chevrons, five figures
// and an ellipsis while unfocused — and the cut's write is the one it was:
// the shot's own field, live in every list (D3), and nothing at all for a
// seat that cannot write.
describe('FX1: the cut\'s frame count is the number field', () => {
  const BIG = () => SHOTS().map((s) => (s.id === 'sh3' ? { ...s, frame_count: 123456 } : s))
  const shownBy = (el) => {
    const wrap = el.closest('.rb-scene-number')
    return wrap.getAttribute('data-capped') === 'true' ? wrap.querySelector(':scope > .rb-scene-number-cap').textContent : el.value
  }
  it('a six-digit count reads five figures and an ellipsis at rest and the whole figure focused; its chevrons write the shot, as typing does', () => {
    const { ctx } = page({ shots: BIG() })
    pickEdit('edit-1')
    const el = screen.getByRole('spinbutton', { name: 'Frames for The climb (cut 1)' })
    expect([shownBy(el), el.value, el.title]).toEqual(['12345…', '123456', '123456'])
    // The tables' sizing (R1-06): 76px, right-aligned, as the shot table's.
    expect(el.closest('.rb-scene-number').classList.contains('rb-scene-frames')).toBe(true)
    act(() => el.focus())
    expect(shownBy(el)).toBe('123456')
    act(() => el.blur())
    fireEvent.click(screen.getByRole('button', { name: 'Increase Frames for The climb (cut 1)' }))
    expect(ctx.updateShot).toHaveBeenLastCalledWith('sh3', { frame_count: 123457 })
    // The door plays twice in this cut: each row's field is the one shot's.
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Frames for The door (cut 3)' }))
    expect(ctx.updateShot).toHaveBeenLastCalledWith('sh1', { frame_count: 239 })
    // No edit question: a shot's own fields are not the cut's order (D3, D13).
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('R2-02: a zero in the cut steps no lower and writes nothing (the cut\'s min); it steps up', () => {
    const { ctx } = page({ shots: SHOTS().map((s) => (s.id === 'sh2' ? { ...s, frame_count: 0 } : s)) })
    pickEdit('edit-1')
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Frames for The cold lamp (cut 5)' }))
    expect(ctx.updateShot).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Increase Frames for The cold lamp (cut 5)' }))
    expect(ctx.updateShot).toHaveBeenLastCalledWith('sh2', { frame_count: 1 })
  })
  it('a reviewer\'s cut has disabled fields with no chevrons, the six-digit count still capped; a change that reaches one (jsdom fires it) writes nothing', () => {
    perms.current = { role: 'user', ready: true, can: () => false, userId: 'u-1' }
    const { ctx } = page({ shots: BIG(), adapterMode: 'supabase', myProjectRole: 'reviewer', projectIsStaffed: true })
    pickEdit('edit-1')
    const el = screen.getByRole('spinbutton', { name: 'Frames for The climb (cut 1)' })
    expect([el.disabled, shownBy(el)]).toEqual([true, '12345…'])
    expect(screen.queryByRole('button', { name: 'Increase Frames for The climb (cut 1)' })).toBeNull()
    fireEvent.change(el, { target: { value: '12' } })
    expect(ctx.updateShot).not.toHaveBeenCalled()
  })
})

// ── FX4 review round 1: the bar after a save or a discard, a recovered or
//    archived edit, frozen names on the changes ───────────────────────────────
describe('FX4 review round 1 — the bar, the selector and the words', () => {
  const bar = () => document.querySelector('.rb-scene-lists')
  const changeClimb = async () => {
    pickEdit('edit-1')
    fireEvent.click(screen.getByRole('button', { name: 'Edit actions for The climb (cut 1)' }))
    fireEvent.click(menuItem('Remove from edit'))
    await act(async () => {})
  }

  it('R1-05: a refusal Save as… then answered is cleared from the Banner; so is one Discard changes answered', async () => {
    const refusal = 'Someone saved “Director\'s cut · v1” since these changes began, and Save edit would write over that.'
    draftPage({ saveEditDraft: async () => { throw new Error(refusal) } })
    await changeClimb()
    await act(async () => { fireEvent.click(within(bar()).getByRole('button', { name: 'Save edit' })) })
    expect(screen.getByRole('alert').textContent).toBe(refusal)
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save as…' }))
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Save as a new version' })).getByRole('button', { name: 'Save new version' })) })
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    draftPage({ saveEditDraft: async () => { throw new Error(refusal) } })
    await changeClimb()
    await act(async () => { fireEvent.click(within(bar()).getByRole('button', { name: 'Save edit' })) })
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Discard changes' }))
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard changes' })) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('R1-06: after Save edit focus goes to Save as… (nothing else had it), and a polite line says what was saved', async () => {
    draftPage()
    await changeClimb()
    const status = () => bar().querySelector('.sr-only[role="status"]')
    expect(status().getAttribute('aria-live')).toBe('polite')
    expect(status().textContent).toBe('')
    // As a keyboard user presses it: focus on it, then the press.
    const save = within(bar()).getByRole('button', { name: 'Save edit' })
    save.focus()
    await act(async () => { fireEvent.click(save) })
    expect(document.activeElement.textContent).toBe('Save as…')
    // Emptied first, then said (R2-05): the region hears a change each time.
    await waitFor(() => expect(status().textContent).toBe('“Director\'s cut · v1” saved'))
  })

  it('R1-06: after Discard changes focus goes to Save as… too, and the line says the changes were discarded', async () => {
    draftPage()
    await changeClimb()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Discard changes' }))
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard changes' })) })
    expect(document.activeElement.textContent).toBe('Save as…')
    await waitFor(() => expect(bar().querySelector('.sr-only[role="status"]').textContent).toBe('Changes discarded'))
  })

  // Review round 2 (R2-05): one region, always in the bar — in List order too
  // — and the same words twice are heard twice (emptied before each).
  it('R2-05: a new edit\'s Discard (back to List order): focus goes to the edit selector, and the line in the bar says so; a second Discard is said again', async () => {
    draftPage({ edits: [] })
    const status = () => bar().querySelector('.sr-only[role="status"]')
    expect(status()).not.toBeNull()
    const discardNew = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'More shot list actions' }))
      fireEvent.click(menuItem('New edit from this list'))
      await yes('Start new edit')
      fireEvent.click(within(bar()).getByRole('button', { name: 'Discard changes' }))
      await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard changes' })) })
    }
    await discardNew()
    expect(document.activeElement).toBe(editSelect())
    await waitFor(() => expect(status().textContent).toBe('Changes discarded'))
    const seen = []
    const watch = new MutationObserver(() => seen.push(status().textContent))
    watch.observe(status(), { childList: true, characterData: true, subtree: true })
    try {
      await discardNew()
      await waitFor(() => expect(seen).toContain('Changes discarded'))
      expect(seen[0]).toBe('')
    } finally { watch.disconnect() }
  })

  it('R2-05: a save that left changes made meanwhile unsaved says so, and focus goes back to Save edit', async () => {
    let finish
    const saveEditDraft = vi.fn(() => new Promise((r) => { finish = r }))
    draftPage({ saveEditDraft })
    await changeClimb()
    const save = within(bar()).getByRole('button', { name: 'Save edit' })
    save.focus()
    await act(async () => { fireEvent.click(save) })
    // Chromium blurs a focused button the moment it is disabled (Save edit
    // is, while it saves); jsdom does not, so the test does what Chromium does.
    expect(save.disabled).toBe(true)
    // (jsdom ignores blur() on a disabled button: the focus is lost instead
    // the way a page loses it, to an element taken out of the document.)
    act(() => { const gone = document.createElement('button'); document.body.appendChild(gone); gone.focus(); gone.remove() })
    expect(document.activeElement).toBe(document.body)
    // The stand-in leaves the changes in place, as a rebase does.
    await act(async () => { finish({ ...EDIT_1 }) })
    await waitFor(() => expect(bar().querySelector('.sr-only[role="status"]').textContent).toBe('“Director\'s cut · v1” saved. Changes made while it saved are not saved yet.'))
    expect(document.activeElement.textContent).toBe('Save edit')
  })

  it('R1-06 CONTROL: focus a control still holds is left where it is', async () => {
    draftPage()
    await changeClimb()
    const search = screen.getByRole('textbox', { name: 'Search' })
    search.focus()
    await act(async () => { fireEvent.click(within(bar()).getByRole('button', { name: 'Save edit' })) })
    expect(document.activeElement).toBe(search)
  })

  it('R1-07: "Recover unsaved edit?" for a saved edit\'s changes offers Discard changes, never "Discard edit"', () => {
    const copy = { personKey: 'local', projectId: 'p1', listId: 'list-1', basedOnEditId: 'edit-1', editId: 'edit-1', title: "Director's cut", version: 1, base: [], items: [editItem('a', 'sc1', 'sh1')], changedAt: '2026-10-12T09:00:00Z' }
    draftPage({ recoverableEditDrafts: [copy], recoverEditDraft: vi.fn(), dismissStoredEditDraft: vi.fn() })
    const d = screen.getByRole('dialog', { name: 'Recover unsaved edit?' })
    expect(d.textContent).toContain('Changes to “Director\'s cut · v1”, an edit of “Shoot · v2”, were left unsaved.')
    expect(within(d).getByRole('button', { name: 'Discard changes' })).toBeTruthy()
    expect(within(d).queryByRole('button', { name: 'Discard edit' })).toBeNull()
  })

  it('R1-08: changes to an edit archived since say so in the selector, its badge shows, and Save edit stands aside for Save as… with the reason', () => {
    const base = EDIT_1.items
    const initialDrafts = { 'list-1': startDraft({ projectId: 'p1', listId: 'list-1', basedOnEditId: 'edit-1', editId: 'edit-1', title: "Director's cut", version: 1, base, items: base.slice(1), now: 't' }) }
    draftPage({ initialDrafts, edits: [{ ...EDIT_1, archived_at: '2026-10-12T09:00:00Z' }] })
    expect(editSelect().value).toBe('edit-1')
    expect(editSelect().selectedOptions[0].textContent).toBe("Director's cut · v1 (unsaved changes, archived)")
    expect(within(bar()).getByText('Archived')).toBeTruthy()
    const save = within(bar()).getByRole('button', { name: 'Save edit' })
    expect(save.closest('[aria-disabled="true"]').getAttribute('title')).toBe('“Director\'s cut · v1” has been archived since these changes began, so they cannot be saved into it. Save as… keeps them as a new version.')
    expect(within(bar()).getByRole('button', { name: 'Save as…' }).closest('[aria-disabled="true"]')).toBeNull()
  })

  it('R1-08: changes to an edit the list no longer holds read as a new edit — its own entry, and the words of a new edit', () => {
    const initialDrafts = { 'list-1': startDraft({ projectId: 'p1', listId: 'list-1', basedOnEditId: 'gone', editId: 'gone', title: 'Lost cut', version: 2, base: [], items: EDIT_1.items.slice(0, 2), now: 't' }) }
    draftPage({ initialDrafts })
    expect(editSelect().value).toBe('draft')
    expect(editSelect().selectedOptions[0].textContent).toBe('Lost cut · v2 (not saved)')
    expect(within(bar()).getByRole('button', { name: 'Save edit' }).getAttribute('title')).toBe('Saves “Lost cut · v2” as a new edit of “Shoot · v2”.')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save as…' }))
    expect(screen.getByRole('dialog', { name: 'Save as a new edit' })).toBeTruthy()
  })

  it('R1-02: a saved edit\'s changes show the names it froze — "Missing scene: Salt hours" stays on the changes', async () => {
    const withGone = {
      ...EDIT_1,
      items: [...EDIT_1.items, editItem('i6', 'gone-scene', 'gone-shot', 'Salt pan')],
      snapshot: { kind: 'edit', saved_at: '2026-10-01T09:00:00.000Z', shots: { 'gone-shot': { name: 'Salt pan' } }, scenes: { 'gone-scene': { name: 'Salt hours' } } },
    }
    draftPage({ edits: [withGone] })
    pickEdit('edit-1')
    expect(bandLabels(document)).toContain('Missing scene: Salt hours')
    fireEvent.click(screen.getByRole('button', { name: 'Edit actions for The climb (cut 1)' }))
    fireEvent.click(menuItem('Remove from edit'))
    await act(async () => {})
    changingEdit1()
    expect(bandLabels(document)).toContain('Missing scene: Salt hours')
  })
})
