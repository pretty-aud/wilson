/** @vitest-environment jsdom */
// =============================================================================
// Post-overhaul S3c — the Scenes tab's EDITS, mounted (ScenesView with a ctx
// built from S3a's selectors, as rabbitScenesRender.test.jsx builds its own).
// Step 3: seeing an edit — the bar's edit selector, the cut (repeats, a
// missing shot, the bands following the cut), the tiles (D20), the toolbar
// standing aside, the edit's verbs, the picker's edits, "Recently removed".
// =============================================================================
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'
import {
  activeScenesOf, activeShotsOf, activeShotListOf, scenesOfList, shotsOfList, listsContainingOf,
  unlistedScenesOf, unlistedShotsOf, nextShotListVersion, formatShotListLabel, isWithdrawn, backfillItems,
  editsOfList, editChainTip, nextEditVersion,
} from '../state/shotListModel'

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
/** A kit Menu item by its words (the kit Menu's items are buttons in .ui-menu). */
export const menuItem = (words) => [...document.querySelectorAll('.ui-menu .ui-menu-item')].find((b) => b.textContent === words)
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
