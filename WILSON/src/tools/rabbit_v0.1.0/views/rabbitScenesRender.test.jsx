/** @vitest-environment jsdom */
// =============================================================================
// Lane B5b, mounted: the Scenes page on the kit and rabbitScenes.css.
// rabbitScenesCss.test.js reads source text; this renders ScenesView with a
// mocked R.A.B.B.I.T. context and asserts what a user would meet. One
// describe per surface, added in the commit that moves it — surface 6a: the
// tiles, the toolbar and both tables (the scene table with its nested shots,
// and the shot table), and the four delete questions on the kit Dialog (W9);
// surface 6b: the two galleries, the filter strip and the saved-views menu;
// surface 6c: the scene and shot detail popups on the kit Dialog.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { _resetOverlaysForTests, focusableWithin } from '../../../ui/overlay'
import { ToastProvider } from '../../../ui/Toast'
import { STATUS } from '../../../ui/StatusDot'
import { formatSceneCode, formatShotCode } from '../entityNaming'
import { navigateTo } from '../state/rabbitNavigate'
import { confirmLeave, _resetLeaveGuardsForTests } from '../state/leaveGuard'
import { VIEWED_LISTS_KEY } from './scenes/useViewedShotList'
// Post-overhaul S3b: the context's shot-list selectors are S3a's own pure
// functions over the mock's rows, so the page meets what the provider gives.
import {
  backfillItems, activeShotListOf, activeScenesOf, activeShotsOf, scenesOfList, shotsOfList,
  listsContainingOf, unlistedScenesOf, unlistedShotsOf, nextShotListVersion, formatShotListLabel, isWithdrawn,
  buildShotListSnapshot,
} from '../state/shotListModel'
import { showDate } from '../dates'

// ScenesView's module graph reaches the cloud client and the permission hook
// at import.
vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
// A workspace admin unless a test seats someone else (S3b's reviewer variant).
const perms = vi.hoisted(() => ({ admin: { role: 'admin', ready: true, can: () => true }, current: null }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => perms.current || perms.admin }))
// ONE object each for the whole run: ScenesView keys memos on their lists.
const team = vi.hoisted(() => ({ members: [] }))
const rateCard = vi.hoisted(() => ({ entries: [], rateCards: [] }))
vi.mock('../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => team }))
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => rateCard }))
// Surface 6c: a task opened from a popup's sidebar is TaskDetailPopup, which
// reads the roster (rabbitEntityViewsRender.test.jsx's stand-in).
const roster = vi.hoisted(() => ({ members: [], mode: 'supabase' }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => roster }))
const rabbit = vi.hoisted(() => ({ current: null }))

const { default: ScenesView } = await import('./ScenesView')
// Review round one, R1-01: the shell's two toasts, which read the same context.
const { default: UndoToast } = await import('../components/UndoToast')
const { default: IngestionToast } = await import('../components/IngestionToast')

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')

afterEach(() => { cleanup(); _resetOverlaysForTests(); _resetLeaveGuardsForTests(); vi.restoreAllMocks(); localStorage.clear(); perms.current = null })

// Two scenes: Lighthouse, dawn (final, two shots, 240 frames) and Cliff path
// (needs revisions — the magenta that is the kit's warning now — no time of
// day, no description, no shots, so its runtime and frame count are zero).
const SCENES = () => [
  { id: 'sc1', name: 'Lighthouse, dawn', scene_number: 1, status: 'final', type: 'interior', time_of_day: 'dawn', description: 'Mara lets herself in.' },
  { id: 'sc2', name: 'Cliff path', scene_number: 2, status: 'needs_revisions', type: 'exterior', time_of_day: null, description: '' },
]
const SHOTS = () => [
  { id: 'sh1', scene_id: 'sc1', name: 'The door', shot_number: 10, status: 'final', type: 'other', framing: 'WS', camera_movement: 'TILT', frame_count: 240, description: 'Mara in the doorway.', start_date: '2026-09-08', end_date: null },
  { id: 'sh2', scene_id: 'sc1', name: 'The cold lamp', shot_number: 20, status: 'in_progress', type: 'other', framing: null, camera_movement: null, frame_count: 0, description: '' },
]

// The list 0084's backfill (D11) leaves every project that had scenes with:
// "Shot list 1 · v1", ACTIVE, holding every scene and shot in number order.
const LIST_1 = {
  id: 'list-1', project_id: 'p1', title: 'Shot list 1', version: 1, summary: 'Created from existing scenes',
  snapshot: {}, archived_at: null, archived_by: null, created_at: '2026-09-30T10:00:00Z', created_by: null,
}
/** Membership rows for one list, from { scene_id | shot_id, position } entries. */
const itemsFor = (listId, entries) => entries.map((it, i) => ({ id: `${listId}-item-${i + 1}`, shot_list_id: listId, project_id: 'p1', scene_id: null, shot_id: null, ...it }))

/** S3a's ctx selectors over these rows, as RabbitProvider's shotListView builds them. */
function listContext({ project, scenes, shots, shotLists, shotListItems }) {
  const pointer = { active_shot_list_id: project.active_shot_list_id || null }
  return {
    scenes: activeScenesOf({ project: pointer, shotLists, shotListItems, scenes, shots }),
    shots: activeShotsOf({ project: pointer, shotLists, shotListItems, shots }),
    allScenes: scenes,
    allShots: shots,
    shotLists,
    shotListItems,
    edits: [],
    activeShotList: activeShotListOf(pointer, shotLists),
    scenesOf: (id) => scenesOfList(scenes, shotListItems, id, shots),
    shotsOf: (id) => shotsOfList(shots, shotListItems, id, scenes),
    listsContaining: (id) => listsContainingOf({ shotLists, shotListItems, shots }, id),
    unlistedScenes: unlistedScenesOf({ shotLists, shotListItems, scenes, shots }),
    unlistedShots: unlistedShotsOf({ shotLists, shotListItems, shots }),
    sceneById: (id) => (id ? scenes.find((s) => s.id === id) || null : null),
    shotById: (id) => (id ? shots.find((s) => s.id === id) || null : null),
    nextShotListVersion: (title) => nextShotListVersion(shotLists, title),
    formatShotListLabel,
    isWithdrawn,
    recentlyWithdrawn: null,
    canWithdrawShotList: () => false,
  }
}

/**
 * The page, mounted. `shotLists` / `shotListItems` / `activeListId` give it
 * lists of its own; without them it has LIST_1 holding every row, active.
 * `pageActive` is Rabbit.jsx's `currentPage === 'rabbit'` (S4a-07).
 */
function page({ scenes = SCENES(), shots = SHOTS(), shotLists, shotListItems, activeListId, projectFields = {}, pageActive = true, ...extra } = {}) {
  const lists = shotLists ?? [LIST_1]
  const items = shotListItems ?? (shotLists ? [] : itemsFor(LIST_1.id, backfillItems(scenes, shots)))
  const project = {
    id: 'p1', name: 'Salt Hours', fps: 24,
    active_shot_list_id: activeListId !== undefined ? activeListId : (shotLists ? null : LIST_1.id),
    ...projectFields,
  }
  const ctx = {
    project,
    ...listContext({ project, scenes, shots, shotLists: lists, shotListItems: items }),
    assets: [],
    tasks: [],
    phases: [],
    teamAssignments: [],
    files: [],
    managedFiles: [],
    // The bins are loaded for this project: no refresh at mount.
    binsInfo: { loadedFor: 'p1' },
    updateScene: vi.fn(),
    updateShot: vi.fn(),
    deleteScene: vi.fn(async () => {}),
    deleteShot: vi.fn(async () => {}),
    addScene: vi.fn(async () => {}),
    addShot: vi.fn(async () => {}),
    // S3a's shot-list mutators (S3b calls them; each resolves as the provider's do).
    addShotList: vi.fn(async (opts) => ({ ...LIST_1, id: 'list-new', title: opts?.title, version: opts?.version ?? 1, summary: opts?.summary ?? null })),
    updateShotList: vi.fn(async (id, patch) => ({ id, ...patch })),
    saveShotListSnapshot: vi.fn(async (id) => ({ id })),
    setActiveShotList: vi.fn(async (id) => id),
    archiveShotList: vi.fn(async (id) => ({ id })),
    addToShotList: vi.fn(async () => []),
    removeFromShotList: vi.fn(async () => []),
    reorderShotListItems: vi.fn(async () => []),
    withdrawShotList: vi.fn(async (id) => ({ id })),
    restoreWithdrawn: vi.fn(async () => null),
    clearRecentlyWithdrawn: vi.fn(),
    // The provider's undo grouping: one step for what runs inside.
    runBatch: vi.fn(async (fn) => fn()),
    ...extra,
  }
  rabbit.current = ctx
  return { ctx, ...render(<ScenesView pageActive={pageActive} />) }
}

/** A runBatch that knows when it is running, and mutators that note whether
    each one's history step lands INSIDE it (review round 1: R1-01, R1-11 —
    a count of runBatch calls passed with a call moved out of the batch).
    The provider pushes a step when the backend has answered (deleteScene,
    after its optimistic() write), so the note is taken then: a macrotask
    after the call, as a round trip is. Round 2 (R2-03) moved it there —
    noted at the call, a delete fired just after an EMPTY batch had opened
    read as inside it. */
function batchProbe() {
  let depth = 0
  const calls = []
  return {
    calls,
    runBatch: vi.fn(async (fn) => { depth += 1; try { return await fn() } finally { depth -= 1 } }),
    mark: (name, result = () => undefined) => vi.fn(async (...args) => {
      await new Promise((r) => setTimeout(r, 0))
      try { return await result(...args) } finally { calls.push([name, depth > 0]) }
    }),
  }
}

/** A header cell's visible label: its words, less a screen-reader-only name. */
const visibleLabel = (th) => {
  const c = th.cloneNode(true)
  c.querySelectorAll('.sr-only').forEach((n) => n.remove())
  return c.textContent.trim()
}
/** Every declaration of a colour, a ground or an edge in an inline style —
    what surface 6a moved into rabbitScenes.css. A width (the kit Th's) or a
    corner radius is not one. */
const inlineColours = (root) => [...root.querySelectorAll('[style]')]
  .map((el) => el.getAttribute('style'))
  .filter((s) => /(^|;)\s*(color|background(-color)?|border(?!-radius)(-[a-z]+)*|fill|stroke|opacity)\s*:/i.test(s))
const sceneTable = () => document.querySelector('table.ui-table.rb-scene-table-scenes')
const shotTable = () => document.querySelector('table.ui-table.rb-scene-table-shots')
/** A row, found by its checkbox's name. */
const rowOf = (name) => screen.getByRole('button', { name: `Select ${name}` }).closest('tr')
const toShots = () => fireEvent.click(screen.getByRole('tab', { name: 'Shots' }))
const openScene = (name) => fireEvent.click(within(rowOf(name)).getByRole('button', { name: 'Show shots' }))

/* ── surface 6a: the tiles, the toolbar and both tables ──────────────────── */
describe('surface 6a', () => {
  it('the scene table is a real <table>: the same columns in the same order, the figures numeric (R3-20)', () => {
    page()
    const table = sceneTable()
    expect(table?.tagName).toBe('TABLE')
    const ths = [...table.querySelectorAll('thead th')]
    // Before: a checkbox, two blank columns (the toggle, the thumbnail), #,
    // NAME, STATUS, TIME OF DAY, TYPE, DESCRIPTION, RUNTIME, FRAMES and the
    // actions' blank. The words are sentence case; the kit Th draws the Label
    // step's capitals.
    expect(ths.map(visibleLabel)).toEqual(['', '', '', '#', 'Name', 'Status', 'Time of day', 'Type', 'Description', 'Runtime', 'Frames', ''])
    expect(ths.filter((th) => th.getAttribute('data-numeric') === 'true').map(visibleLabel)).toEqual(['#', 'Runtime', 'Frames'])
    // A row: one cell per column, its figures right-aligned in the kit's numeric cell.
    const row = rowOf('Lighthouse, dawn')
    expect(row.querySelectorAll(':scope > td')).toHaveLength(ths.length)
    expect([...row.querySelectorAll(':scope > td[data-numeric="true"]')].map((td) => td.textContent)).toEqual(['1', '00:00:10:00', '240'])
  })

  it('the nested shots stay nested: the same toggle opens a table of the scene\'s shots under it, and closes it', () => {
    page()
    expect(sceneTable().querySelector('table.rb-scene-nest-table')).toBeNull()
    const toggle = within(rowOf('Lighthouse, dawn')).getByRole('button', { name: 'Show shots' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    const nest = sceneTable().querySelector('table.rb-scene-nest-table')
    expect(nest).not.toBeNull()
    // The nest is one row of the scene table, straight after its scene, spanning every column.
    const holder = nest.closest('tr.rb-scene-nest-row')
    expect(holder.previousElementSibling).toBe(rowOf('Lighthouse, dawn'))
    expect(holder.querySelector(':scope > td').getAttribute('colspan')).toBe('12')
    // Its rows are the scene's shots, in order, with their Add shot after them.
    expect([...nest.querySelectorAll('tbody > tr')].map((tr) => within(tr).getByRole('button', { name: /^Select / }).getAttribute('aria-label')))
      .toEqual(['Select The door', 'Select The cold lamp'])
    expect(within(holder).getByRole('button', { name: 'Add shot' })).toBeTruthy()
    fireEvent.click(within(rowOf('Lighthouse, dawn')).getByRole('button', { name: 'Hide shots' }))
    expect(sceneTable().querySelector('table.rb-scene-nest-table')).toBeNull()
  })

  it('the shot table is a real <table>: the same columns in the same order, Takes where the bins are (R3-20)', () => {
    page()
    toShots()
    const expected = ['', '', '#', 'Shot name', 'Status', 'Time of day', 'Type', 'Framing', 'Cam move', 'Description', 'Duration', 'Frames', 'Start', 'End', '']
    let ths = [...shotTable().querySelectorAll('thead th')]
    expect(ths.map(visibleLabel)).toEqual(expected)
    expect(ths.filter((th) => th.getAttribute('data-numeric') === 'true').map(visibleLabel)).toEqual(['#', 'Duration', 'Frames'])
    expect(rowOf('The door').querySelectorAll(':scope > td')).toHaveLength(ths.length)
    cleanup()
    page({ supportsBins: true })
    toShots()
    ths = [...shotTable().querySelectorAll('thead th')]
    expect(ths.map(visibleLabel)).toEqual([...expected.slice(0, 4), 'Takes', ...expected.slice(4)])
    expect(rowOf('The door').querySelectorAll(':scope > td')).toHaveLength(ths.length)
    // A scene group's band is one row across the table; its Scene details beside its toggle, not inside it.
    const band = shotTable().querySelector('tr.rb-scene-group-row')
    expect(band.querySelector(':scope > td').getAttribute('colspan')).toBe(String(ths.length))
    const toggle = within(band).getByRole('button', { name: /^Lighthouse, dawn/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.querySelector('button')).toBeNull()
    expect(within(band).getByRole('button', { name: 'Scene details' })).toBeTruthy()
  })

  it('a row\'s status is the kit StatusDot beside a kit CellSelect, its tone from the one STATUS map (R3-11)', () => {
    const { ctx } = page()
    for (const [name, status] of [['Lighthouse, dawn', 'final'], ['Cliff path', 'needs_revisions']]) {
      const row = rowOf(name)
      expect(row.querySelector('.ui-status-dot')?.getAttribute('data-tone'), name).toBe(STATUS[status].tone)
      const select = within(row).getByRole('combobox', { name: `Status for ${name}` })
      expect(select.parentElement.classList.contains('ui-cell-select')).toBe(true)
      expect(select.value).toBe(status)
      expect([...select.options].map((o) => o.textContent))
        .toEqual(['Not started', 'In progress', 'Pending review', 'Needs revisions', 'Approved', 'Final', 'Blocked', 'On hold', 'Omitted'])
    }
    // needs_revisions was magenta (#e879f9): it is the kit's warning.
    expect(rowOf('Cliff path').querySelector('.ui-status-dot').getAttribute('data-tone')).toBe('warning')
    fireEvent.change(within(rowOf('Cliff path')).getByRole('combobox', { name: 'Status for Cliff path' }), { target: { value: 'approved' } })
    expect(ctx.updateScene).toHaveBeenCalledWith('sc2', { status: 'approved' })
    // The nested rows and the shot table's rows are the same cell.
    openScene('Lighthouse, dawn')
    expect(rowOf('The cold lamp').querySelector('.ui-status-dot').getAttribute('data-tone')).toBe('signal')
    toShots()
    const shot = rowOf('The door')
    expect(shot.querySelector('.ui-status-dot').getAttribute('data-tone')).toBe('success')
    fireEvent.change(within(shot).getByRole('combobox', { name: 'Status for The door' }), { target: { value: 'blocked' } })
    expect(ctx.updateShot).toHaveBeenCalledWith('sh1', { status: 'blocked' })
  })

  it('R3-26: every inline select is the kit CellSelect and every field the kit\'s small field, with the same effect as before', () => {
    const { ctx } = page()
    openScene('Lighthouse, dawn')
    const check = (table) => {
      const selects = [...table.querySelectorAll('tbody select')]
      expect(selects.length).toBeGreaterThan(0)
      for (const s of selects) expect(s.parentElement.classList.contains('ui-cell-select'), s.getAttribute('aria-label')).toBe(true)
      const inputs = [...table.querySelectorAll('tbody input')]
      expect(inputs.length).toBeGreaterThan(0)
      for (const i of inputs) {
        expect(i.classList.contains('ui-input'), i.getAttribute('aria-label')).toBe(true)
        expect(i.getAttribute('data-size')).toBe('sm')
      }
    }
    check(sceneTable())
    // The same writes: an emptied time of day is null, a frame count a number.
    fireEvent.change(within(rowOf('Lighthouse, dawn')).getByRole('combobox', { name: 'Time of day for Lighthouse, dawn' }), { target: { value: '' } })
    expect(ctx.updateScene).toHaveBeenCalledWith('sc1', { time_of_day: null })
    fireEvent.change(within(rowOf('The door')).getByRole('spinbutton', { name: 'Frames for The door' }), { target: { value: '96' } })
    expect(ctx.updateShot).toHaveBeenCalledWith('sh1', { frame_count: 96 })
    // Framing keeps its code in the cell and its long names in the list.
    const framing = within(rowOf('The door')).getByRole('combobox', { name: 'Framing for The door' })
    expect(framing.value).toBe('WS')
    expect(framing.closest('.rb-scene-framing').querySelector('.rb-scene-framing-code').textContent).toBe('WS')
    expect([...framing.options].find((o) => o.value === 'WS').textContent).toBe('Wide shot')
    toShots()
    check(shotTable())
    fireEvent.change(within(rowOf('The door')).getByLabelText('End date for The door'), { target: { value: '2026-09-12' } })
    expect(ctx.updateShot).toHaveBeenCalledWith('sh1', { end_date: '2026-09-12' })
  })

  it('no element in the mounted tables writes an inline colour or edge', () => {
    page()
    openScene('Lighthouse, dawn')
    expect(sceneTable().querySelectorAll('[style]').length).toBeGreaterThan(0) // the kit Th's widths: read, and allowed
    expect(inlineColours(sceneTable())).toEqual([])
    toShots()
    expect(inlineColours(shotTable())).toEqual([])
  })

  it('CONTROL: the inline-colour scan catches a colour, a ground and an edge, and passes a width and a radius', () => {
    const host = document.createElement('div')
    host.innerHTML = '<b style="color: red"></b><b style="width: 4px; background-color: red"></b><b style="border-left: 1px solid red"></b>'
      + '<b style="width: var(--rb-scene-col-num)"></b><b style="width: 50px; height: 28px; border-radius: 0px"></b>'
    expect(inlineColours(host)).toHaveLength(3)
  })

  it('R3-26: the file writes no hover style — no onMouseEnter / onMouseLeave and no e.target.style, anywhere in it', () => {
    const src = read('./ScenesView.jsx')
    expect(src.match(/\bonMouse(?:Enter|Leave)\b/g) || []).toEqual([])
    expect(src.match(/\.(?:target|currentTarget)\.style\b/g) || []).toEqual([])
  })

  it('a cell\'s words become the kit\'s small field on a click, and commit as before', () => {
    const { ctx } = page()
    fireEvent.click(within(rowOf('Lighthouse, dawn')).getByText('Lighthouse, dawn'))
    const field = screen.getByRole('textbox', { name: 'Name for Lighthouse, dawn' })
    expect(field.classList.contains('ui-input')).toBe(true)
    expect(field.getAttribute('data-size')).toBe('sm')
    fireEvent.change(field, { target: { value: 'Lighthouse, night' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(ctx.updateScene).toHaveBeenCalledWith('sc1', { name: 'Lighthouse, night' })
    // A name is the row's anchor (600 in the ink, it was orange); an empty
    // description its placeholder, marked for the third ink (R3-13).
    expect(within(rowOf('Lighthouse, dawn')).getByText('Lighthouse, dawn').getAttribute('data-tone')).toBe('strong')
    expect(within(rowOf('Cliff path')).getByText('Add description…').getAttribute('data-empty')).toBe('true')
  })

  it('a zero or a missing value is marked for the third ink, and the sheet paints it there (R3-13)', () => {
    page()
    const row = rowOf('Cliff path')
    const [num, runtime, frames] = row.querySelectorAll(':scope > td[data-numeric="true"]')
    expect([num.textContent, runtime.textContent, frames.textContent]).toEqual(['2', '00:00:00:00', '0'])
    expect(num.getAttribute('data-empty')).toBeNull()
    expect(runtime.getAttribute('data-empty')).toBe('true')
    expect(frames.getAttribute('data-empty')).toBe('true')
    expect(within(row).getByRole('combobox', { name: 'Time of day for Cliff path' }).getAttribute('data-empty')).toBe('true')
    const css = read('./rabbitScenes.css')
    expect(css).toMatch(/\.rb-scene-dur-cell\[data-empty="true"\],\n {2}\.rb-scene-count-cell\[data-empty="true"\] \{ color: var\(--color-ink-3\); \}/)
    expect(css).toMatch(/\.rb-scene-inline\[data-empty="true"\] \{ font-weight: 400; color: var\(--color-ink-3\); \}/)
  })

  it('the toolbar holds the same sixteen controls in the same order, on the kit (C1; R3-25 recorded, not applied)', () => {
    page()
    const bar = document.querySelector('.ui-toolbar.rb-scene-toolbar')
    const names = () => [...bar.querySelectorAll('[role="tab"], button, select, input, .ui-badge, .rb-scene-count')]
      .map((el) => el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim())
    // R3-25's sixteen: content mode (2), Filter, sort, its direction, group,
    // view mode (2), the thumbnail triple OR the card triple, the FPS badge,
    // saved views, search, the count, New scene, New shot.
    const before = ['Scenes', 'Shots', 'Filter', 'Sort', 'Sorted ascending — reverse', 'Group', 'Table', 'Gallery']
    const after = ['24 fps', 'Saved views', 'Search', '2/2', 'New scene', 'New shot']
    expect(names()).toEqual([...before, 'sm thumbnails', 'md thumbnails', 'lg thumbnails', ...after])
    fireEvent.click(screen.getByRole('tab', { name: 'Gallery' }))
    expect(names()).toEqual([...before, 'sm cards', 'md cards', 'lg cards', ...after])
    // The two pairs are the kit Tabs, each pointing at the region it switches.
    for (const label of ['Content', 'View']) {
      const tabs = within(screen.getByRole('tablist', { name: label })).getAllByRole('tab')
      expect(tabs).toHaveLength(2)
      for (const tab of tabs) expect(document.getElementById(tab.getAttribute('aria-controls'))?.getAttribute('role'), label).toBe('tabpanel')
    }
    expect(screen.getByRole('tab', { name: 'Gallery' }).getAttribute('aria-selected')).toBe('true')
  })

  it('the size triple is three kit IconButtons in one group, the chosen one the kit\'s selected treatment; the create buttons are the kit\'s, one primary', () => {
    page()
    const sizes = screen.getByRole('group', { name: 'Thumbnail size' })
    const buttons = within(sizes).getAllByRole('button')
    expect(buttons.map((b) => b.classList.contains('ui-iconbtn'))).toEqual([true, true, true])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', null, null])
    fireEvent.click(within(sizes).getByRole('button', { name: 'lg thumbnails' }))
    expect(within(sizes).getByRole('button', { name: 'lg thumbnails' }).getAttribute('data-active')).toBe('true')
    expect(sceneTable().closest('.rb-scene-table-wrap').getAttribute('data-thumb')).toBe('lg')
    // The create button for the content mode on show is the one primary, as its orange fill was.
    const variants = () => ['New scene', 'New shot'].map((n) => screen.getByRole('button', { name: n }).getAttribute('data-variant'))
    expect(variants()).toEqual(['primary', 'secondary'])
    toShots()
    expect(variants()).toEqual(['secondary', 'primary'])
  })

  it('the four tiles are the kit Stat, in sentence case (R3-10)', () => {
    page()
    const tiles = [...document.querySelectorAll('.rb-scene-stats > .ui-stat.rb-scene-stat')]
    expect(tiles.map((t) => [t.querySelector('.ui-stat-label').textContent, t.querySelector('.ui-stat-value').textContent]))
      .toEqual([['Total runtime', '00:00:10:00'], ['Total frames', '240'], ['Scenes', '2'], ['Shots', '2']])
  })

  it('a ticked row is the kit Row\'s selected row, every checkbox a named 28px square, and the row actions the kit HoverActions in one slot (R3-38, R3-40, R3-24)', () => {
    page()
    openScene('Lighthouse, dawn')
    for (const name of ['Lighthouse, dawn', 'The door']) {
      const check = screen.getByRole('button', { name: `Select ${name}` })
      expect(check.classList.contains('rb-scene-check')).toBe(true)
      expect(check.closest('td').classList.contains('rb-scene-check-cell')).toBe(true)
      fireEvent.click(check)
      expect(check.getAttribute('aria-pressed')).toBe('true')
      expect(check.closest('tr').getAttribute('data-selected')).toBe('true')
    }
    expect(within(document.querySelector('.rb-scene-bulk')).getByText('1 selected')).toBeTruthy()
    const acts = (name) => rowOf(name).querySelector(':scope > td.rb-scene-acts-cell > .ui-hover-actions')
    // S3b: the row's shot-list menu sits between View details and Delete.
    expect(within(acts('Lighthouse, dawn')).getAllByRole('button').map((b) => b.getAttribute('title')))
      .toEqual(['View details', 'Shot list actions for Lighthouse, dawn', 'Delete scene'])
    expect(within(acts('The door')).getAllByRole('button').map((b) => b.getAttribute('title')))
      .toEqual(['View details', 'Shot list actions for The door', 'Delete shot'])
    // The slot is one width in every table: the sheet's one column, three
    // 28px buttons since S3b (it was two, 84px).
    expect(read('./rabbitScenes.css')).toMatch(/--rb-scene-col-acts: 112px;/)
    expect([...sceneTable().querySelectorAll('thead th')].at(-1).style.width).toBe('var(--rb-scene-col-acts)')
  })

  it('nothing to list is the kit EmptyState, in the same words (R3-19)', () => {
    page({ scenes: [], shots: [] })
    let empty = document.querySelector('.rb-scene-view > .ui-empty')
    expect(empty?.getAttribute('role')).toBe('status')
    expect(empty.textContent).toBe('No scenes yet')
    toShots()
    empty = document.querySelector('.rb-scene-view > .ui-empty')
    expect(empty.querySelector('.ui-empty-title').textContent).toBe('No shots yet')
    expect(empty.querySelector('.ui-empty-body').textContent).toBe('Create a scene first, then add shots.')
  })

  it('ShotTakeChips keeps every height ScenesView passes it, and the primary take\'s poster takes its edge from a class', () => {
    page({
      supportsBins: true,
      shotTakes: [{ id: 't1', shot_id: 'sh2', bin_file_id: 'f1', role: 'primary', position: 0 }],
      binFiles: [{ id: 'f1', display_name: 'take_01.mov', media_type: 'video', online: true }],
    })
    // Nested: Math.min(nestedThumbH, 22) — 22 at every size.
    openScene('Lighthouse, dawn')
    expect(within(rowOf('The door')).getByTitle('Assign takes from the bins').style.height).toBe('22px')
    // The poster stands in for The cold lamp's empty thumbnail: a class, no inline edge.
    const poster = rowOf('The cold lamp').querySelector('.bn-poster')
    expect(poster.classList.contains('rb-scene-poster')).toBe(true)
    expect(poster.style.border).toBe('')
    // The shot table: Math.min(rowH, 26) — 26 at the small size (36px rows).
    toShots()
    expect(within(rowOf('The door')).getByTitle('Assign takes from the bins').style.height).toBe('26px')
  })

  it('W9: a row\'s Delete asks on the kit Dialog in <body> — Cancel keeps the scene, Delete deletes it (and so its shots) through the context', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { ctx } = page()
    fireEvent.click(within(rowOf('Lighthouse, dawn')).getByRole('button', { name: 'Delete scene' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete scene?' })
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(dialog.getAttribute('data-width')).toBe('confirm')
    expect(dialog.textContent).toContain('This will permanently delete “Lighthouse, dawn” and its 2 shots from the project. It will be gone from “Shot list 1 · v1” too. To take it out of “Shot list 1 · v1” only, use “Remove from this list” in its shot-list menu.')
    expect(document.activeElement.textContent).toBe('Cancel')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.deleteScene).not.toHaveBeenCalled()
    expect(rowOf('Lighthouse, dawn')).toBeTruthy()
    // Its backdrop still cancels, as the hand-rolled one's did.
    fireEvent.click(within(rowOf('Lighthouse, dawn')).getByRole('button', { name: 'Delete scene' }))
    fireEvent.mouseDown(screen.getByRole('dialog').closest('.ui-dialog-backdrop'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.deleteScene).not.toHaveBeenCalled()

    fireEvent.click(within(rowOf('Lighthouse, dawn')).getByRole('button', { name: 'Delete scene' }))
    dialog = screen.getByRole('dialog', { name: 'Delete scene?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(ctx.deleteScene).toHaveBeenCalledWith('sc1'))
    // Review round 1 (R1-01): S3a's deleteScene takes the shots, in ONE undo
    // step — no deleteShot of its own per shot.
    expect(ctx.deleteShot).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(confirm).not.toHaveBeenCalled()
  })

  it('W9: the scenes\' bulk Delete asks on the kit Dialog — Cancel and Escape keep the rows, a click outside does nothing, Delete deletes each scene (and so its shots)', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { ctx } = page()
    fireEvent.click(screen.getByRole('button', { name: 'Select Lighthouse, dawn' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select Cliff path' }))
    const bulk = () => document.querySelector('.rb-scene-bulk')
    expect(within(bulk()).getByText('2 selected')).toBeTruthy()
    fireEvent.click(within(bulk()).getByRole('button', { name: 'Delete' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete scenes' })
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(dialog.textContent).toContain('This will permanently delete 2 scenes and their 2 shots from the project. They will be gone from “Shot list 1 · v1” too. To take them out of “Shot list 1 · v1” only, use “Remove from list” in the selection bar.')
    // window.confirm had no outside to click: the backdrop keeps the question.
    fireEvent.mouseDown(dialog.closest('.ui-dialog-backdrop'))
    expect(screen.getByRole('dialog', { name: 'Delete scenes' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    // Escape, the kit Dialog's (Q17), is a Cancel too.
    fireEvent.click(within(bulk()).getByRole('button', { name: 'Delete' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.deleteScene).not.toHaveBeenCalled()
    expect(ctx.deleteShot).not.toHaveBeenCalled()
    expect(within(bulk()).getByText('2 selected')).toBeTruthy()
    expect(rowOf('Cliff path').getAttribute('data-selected')).toBe('true')

    fireEvent.click(within(bulk()).getByRole('button', { name: 'Delete' }))
    dialog = screen.getByRole('dialog', { name: 'Delete scenes' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    // R1-01: one deleteScene a scene, awaited in turn inside one batch.
    await waitFor(() => expect(ctx.deleteScene.mock.calls.map((c) => c[0])).toEqual(['sc1', 'sc2']))
    expect(ctx.runBatch).toHaveBeenCalledTimes(1)
    expect(ctx.deleteShot).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bulk()).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('W9: the nested shots\' bulk Delete asks on the kit Dialog — Cancel keeps them, Delete deletes them through the context', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    // Review round 2 (R2-03): every delete INSIDE the one batch (R1-01).
    const probe = batchProbe()
    const { ctx } = page({ runBatch: probe.runBatch, deleteShot: probe.mark('deleteShot') })
    openScene('Lighthouse, dawn')
    fireEvent.click(screen.getByRole('button', { name: 'Select The door' }))
    const bar = () => document.querySelector('.rb-scene-nest-bulk')
    expect(within(bar()).getByText('1 selected')).toBeTruthy()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete shots' })
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(dialog.textContent).toContain('This will permanently delete shot “The door” from the project. It will be gone from “Shot list 1 · v1” too. To take it out of “Shot list 1 · v1” only, use “Remove from list” in the selection bar.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.deleteShot).not.toHaveBeenCalled()
    expect(rowOf('The door').getAttribute('data-selected')).toBe('true')

    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))
    dialog = screen.getByRole('dialog', { name: 'Delete shots' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(probe.calls).toEqual([['deleteShot', true]]))
    expect(ctx.deleteShot).toHaveBeenCalledTimes(1)
    expect(ctx.deleteShot).toHaveBeenCalledWith('sh1')
    expect(ctx.deleteScene).not.toHaveBeenCalled()
    expect(bar()).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('W9: the shot table\'s bulk Delete asks on the kit Dialog — Cancel keeps the shots, Delete deletes them through the context', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const probe = batchProbe()
    const { ctx } = page({ runBatch: probe.runBatch, deleteShot: probe.mark('deleteShot') })
    toShots()
    fireEvent.click(screen.getByRole('button', { name: 'Select every shot' }))
    const bulk = () => document.querySelector('.rb-scene-bulk')
    expect(within(bulk()).getByText('2 selected')).toBeTruthy()
    fireEvent.click(within(bulk()).getByRole('button', { name: 'Delete' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete shots' })
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(dialog.textContent).toContain('This will permanently delete 2 shots from the project. They will be gone from “Shot list 1 · v1” too. To take them out of “Shot list 1 · v1” only, use “Remove from list” in the selection bar.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.deleteShot).not.toHaveBeenCalled()
    expect(rowOf('The cold lamp').getAttribute('data-selected')).toBe('true')

    fireEvent.click(within(bulk()).getByRole('button', { name: 'Delete' }))
    dialog = screen.getByRole('dialog', { name: 'Delete shots' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    // R1-01: awaited in turn, inside one batch — one undo step (round 2,
    // R2-03: each call INSIDE it, not only one runBatch).
    await waitFor(() => expect(probe.calls).toEqual([['deleteShot', true], ['deleteShot', true]]))
    expect(ctx.deleteShot.mock.calls.map((c) => c[0]).sort()).toEqual(['sh1', 'sh2'])
    expect(ctx.runBatch).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bulk()).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
  })
})

/* ── surface 6b: the two galleries, the filter strip, the saved-views menu ─ */
const toGallery = () => fireEvent.click(screen.getByRole('tab', { name: 'Gallery' }))
const gallery = () => document.querySelector('.rb-scene-view > .rb-scene-gallery')
const cardsOf = (root = gallery()) => [...root.querySelectorAll('.rb-scene-card')]
const cardName = (card) => card.querySelector('.rb-scene-card-name').textContent
const cardOf = (name) => cardsOf().find((c) => cardName(c) === name)
/** The rows a table lists, in order, by their checkboxes' names. */
const rowNames = (table) => [...table.querySelectorAll(':scope > tbody > tr .rb-scene-check')].map((b) => b.getAttribute('aria-label').replace(/^Select /, ''))
const SAVED_VIEWS_KEY = 'rabbit_scene_saved_views'
const TAKES = {
  supportsBins: true,
  shotTakes: [{ id: 't1', shot_id: 'sh2', bin_file_id: 'f1', role: 'primary', position: 0 }],
  binFiles: [{ id: 'f1', display_name: 'take_01.mov', media_type: 'video', online: true }],
}

describe('surface 6b', () => {
  it('each gallery holds its table\'s cards in the same order, with the same words, on the kit Card (C1)', () => {
    page()
    const scenes = rowNames(sceneTable())
    toGallery()
    expect(sceneTable()).toBeNull()
    const cards = cardsOf()
    for (const c of cards) expect(c.classList.contains('ui-card'), cardName(c)).toBe(true)
    expect(cards.map(cardName)).toEqual(scenes)
    expect(scenes).toEqual(['Lighthouse, dawn', 'Cliff path'])
    // A scene card: its name, description, type, time of day and status, then
    // its shot count and runtime (none for a scene with no shots), as before.
    const words = (card) => ({
      desc: card.querySelector('.rb-scene-card-desc')?.textContent ?? null,
      tags: [...card.querySelectorAll('.rb-scene-card-tag')].map((t) => t.textContent),
      status: card.querySelector('.ui-status').textContent,
      figures: [...card.querySelectorAll('.rb-scene-card-figure')].map((f) => f.textContent),
    })
    expect(words(cards[0])).toEqual({ desc: 'Mara lets herself in.', tags: ['Interior', 'Dawn'], status: 'Final', figures: ['2 shots', '00:00:10:00'] })
    expect(words(cards[1])).toEqual({ desc: null, tags: ['Exterior'], status: 'Needs revisions', figures: [] })

    toShots()
    toGallery()
    expect(gallery()).not.toBeNull()
    cleanup()
    page()
    toShots()
    const shots = rowNames(shotTable())
    toGallery()
    expect(cardsOf().map(cardName)).toEqual(shots)
    expect(shots).toEqual(['The door', 'The cold lamp'])
    // A shot card: its number and status, then its runtime and frame count.
    const [door, lamp] = cardsOf()
    expect([door.querySelector('.rb-scene-card-desc').textContent, door.querySelector('.rb-scene-card-num').textContent, door.querySelector('.ui-status').textContent])
      .toEqual(['Mara in the doorway.', '#10', 'Final'])
    expect([...door.querySelectorAll('.rb-scene-card-figure')].map((f) => f.textContent)).toEqual(['00:00:10:00', '240 fr'])
    expect([lamp.querySelector('.rb-scene-card-desc'), lamp.querySelector('.rb-scene-card-num').textContent, lamp.querySelectorAll('.rb-scene-card-figure').length])
      .toEqual([null, '#20', 0])
    // A group's head: the scene, its count and its runtime, and Scene details the named kit IconButton.
    const head = gallery().querySelector('.rb-scene-gallery-group > .rb-scene-gallery-head')
    expect(head.querySelector('.rb-scene-group-label').textContent).toBe('Lighthouse, dawn')
    expect([...head.querySelectorAll('.rb-scene-group-count')].map((s) => s.textContent)).toEqual(['2 shots', '· 00:00:10:00'])
    expect(within(head).getByRole('button', { name: 'Scene details' }).classList.contains('ui-iconbtn')).toBe(true)
  })

  it('the three card sizes stay three, keyed on the gallery\'s data-card, and the sheet sizes them', () => {
    page()
    toGallery()
    expect(gallery().getAttribute('data-card')).toBe('md')
    for (const s of ['sm', 'lg', 'md']) {
      fireEvent.click(screen.getByRole('button', { name: `${s} cards` }))
      expect(gallery().getAttribute('data-card')).toBe(s)
      expect(screen.getByRole('button', { name: `${s} cards` }).getAttribute('aria-pressed')).toBe('true')
    }
    toShots()
    fireEvent.click(screen.getByRole('button', { name: 'lg cards' }))
    expect(gallery().getAttribute('data-card')).toBe('lg')
    // No card carries a size of its own: the sheet's widths, keyed on data-card.
    for (const c of cardsOf()) expect(c.getAttribute('style')).toBeNull()
  })

  it('a card\'s status is the kit StatusBadge, its tone from the one STATUS map; the status-coloured bar is gone (R3-11)', () => {
    page()
    toGallery()
    for (const [name, status] of [['Lighthouse, dawn', 'final'], ['Cliff path', 'needs_revisions']]) {
      const badges = cardOf(name).querySelectorAll('.ui-status')
      expect(badges, name).toHaveLength(1)
      expect([badges[0].getAttribute('data-status'), badges[0].getAttribute('data-tone')]).toEqual([status, STATUS[status].tone])
    }
    // needs_revisions was magenta (#e879f9): the kit's warning.
    expect(cardOf('Cliff path').querySelector('.ui-status').getAttribute('data-tone')).toBe('warning')
    toShots()
    expect(cardOf('The cold lamp').querySelector('.ui-status').getAttribute('data-tone')).toBe('signal')
    // The ScenesView source no longer calls statusColor outside the two popups (6c's).
    const src = read('./ScenesView.jsx')
    for (const name of ['SceneGallery', 'ShotGallery']) {
      const body = src.slice(src.indexOf(`function ${name}(`), src.indexOf('\n}\n', src.indexOf(`function ${name}(`)))
      expect(body, name).not.toMatch(/statusColor\(/)
    }
  })

  it('no element in the mounted galleries writes an inline colour, border or background', () => {
    page()
    toGallery()
    expect(cardsOf()).toHaveLength(2)
    expect(inlineColours(gallery())).toEqual([])
    toShots()
    expect(cardsOf()).toHaveLength(2)
    expect(inlineColours(gallery())).toEqual([])
    cleanup()
    // With the bins: the primary take's poster keeps the size it is handed and
    // takes its edge from a class. The chips are ShotTakeChips (B6's, its inks
    // its own contract), left out of the scan.
    page(TAKES)
    toShots()
    toGallery()
    const poster = cardOf('The cold lamp').querySelector('.bn-poster')
    expect(poster.classList.contains('rb-scene-poster')).toBe(true)
    expect([poster.style.width, poster.style.height, poster.style.border]).toEqual(['220px', '124px', ''])
    const host = gallery().cloneNode(true)
    host.querySelectorAll('.rb-scene-card-takes').forEach((n) => n.remove())
    expect(host.querySelectorAll('.rb-scene-card').length).toBe(2)
    expect(inlineColours(host)).toEqual([])
    // ShotTakeChips keeps the 20px ScenesView always handed it in a card.
    expect(within(cardOf('The door')).getByTitle('Assign takes from the bins').style.height).toBe('20px')
  })

  it('a card\'s delete sits in the kit HoverActions, named for its card: it asks and does not open the card; the card opens it (R3-24)', async () => {
    const { ctx } = page()
    toGallery()
    const card = cardOf('Lighthouse, dawn')
    // The card hosts the kit's reveal: on hover AND on focus-within (Q17(b)).
    expect(card.classList.contains('ui-hover-host')).toBe(true)
    const acts = card.querySelector(':scope > .rb-scene-card-media > .ui-hover-actions')
    const del = within(acts).getByRole('button', { name: 'Delete Lighthouse, dawn' })
    expect([del.classList.contains('ui-iconbtn'), del.getAttribute('data-danger'), del.getAttribute('data-size')]).toEqual([true, 'true', 'sm'])
    fireEvent.click(del)
    const dialog = screen.getByRole('dialog', { name: 'Delete scene?' })
    expect(dialog.textContent).toContain('This will permanently delete “Lighthouse, dawn” and its 2 shots from the project. It will be gone from “Shot list 1 · v1” too. To take it out of “Shot list 1 · v1” only, use “Remove from this list” in its shot-list menu.')
    expect(screen.queryByText('Scene name')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(ctx.deleteScene).not.toHaveBeenCalled()
    // The whole card opens the scene, as it did.
    fireEvent.click(card)
    expect(await screen.findByText('Scene name')).toBeTruthy()
    cleanup()

    page()
    toShots()
    toGallery()
    const door = cardOf('The door')
    fireEvent.click(within(door.querySelector('.ui-hover-actions')).getByRole('button', { name: 'Delete The door' }))
    expect(screen.getByRole('dialog', { name: 'Delete shot?' }).textContent).toContain('delete shot “The door” from the project.')
    expect(screen.queryByText('Shot name')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(door)
    expect(await screen.findByText('Shot name')).toBeTruthy()
  })

  it('grouped by a field, the shot gallery keys each group on its own key (a scene\'s id was every group\'s key)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    page()
    toShots()
    toGallery()
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'status' } })
    const heads = [...gallery().querySelectorAll('.rb-scene-gallery-head')]
    expect(heads.map((h) => h.querySelector('.rb-scene-group-label').textContent)).toEqual(['Final', 'In progress'])
    // A field group has no scene, so no Scene details.
    for (const h of heads) expect(within(h).queryByRole('button', { name: 'Scene details' })).toBeNull()
    expect(error.mock.calls.map((c) => String(c[0])).filter((m) => /unique "key"/.test(m))).toEqual([])
  })

  it('nothing to show is the kit EmptyState, in the same words (R3-19)', () => {
    page({ scenes: [], shots: [] })
    toGallery()
    let empty = document.querySelector('.rb-scene-view > .ui-empty')
    expect(empty?.getAttribute('role')).toBe('status')
    expect(empty.textContent).toBe('No scenes yet')
    toShots()
    empty = document.querySelector('.rb-scene-view > .ui-empty')
    expect(empty.querySelector('.ui-empty-title').textContent).toBe('No shots yet')
    // The gallery's never had the table's instruction line.
    expect(empty.querySelector('.ui-empty-body')).toBeNull()
  })

  it('the filter strip: the same controls in the same order on the kit; Add filter adds a row, and each field acts as before', () => {
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const strip = () => document.querySelector('.rb-scene-filters')
    // No filter yet: Add filter and Done, the kit's Buttons (Done shows, as it did).
    const actions = () => within(strip().querySelector('.rb-scene-filter-actions')).getAllByRole('button')
    expect(actions().map((b) => [b.textContent, b.classList.contains('ui-btn'), b.getAttribute('data-variant')]))
      .toEqual([['Add filter', true, 'secondary'], ['Done', true, 'ghost']])
    fireEvent.click(within(strip()).getByRole('button', { name: 'Add filter' }))
    const rows = () => [...strip().querySelectorAll('.rb-scene-filter-row')]
    expect(rows()).toHaveLength(1)
    const named = (row) => [...row.children].map((el) => el.getAttribute('aria-label') || el.textContent.trim())
    expect(named(rows()[0])).toEqual(['Where', 'Field', 'Condition', 'Value', 'Remove this filter'])
    // Every field the kit's small well; the remove the kit's danger IconButton.
    for (const el of rows()[0].querySelectorAll('select, input')) {
      expect(el.classList.contains('ui-input'), el.getAttribute('aria-label')).toBe(true)
      expect(el.getAttribute('data-size')).toBe('sm')
    }
    const remove = within(rows()[0]).getByRole('button', { name: 'Remove this filter' })
    expect([remove.classList.contains('ui-iconbtn'), remove.getAttribute('data-danger')]).toEqual([true, 'true'])
    const row = () => within(rows()[0])
    const options = (name) => [...row().getByRole('combobox', { name }).options].map((o) => o.textContent)
    expect(options('Field')).toEqual(['Status', 'Type', 'Time of day', 'Name'])
    expect(options('Condition')).toEqual(['is', 'is not', 'is empty', 'is not empty'])
    // The choices in sentence case (they were "not started", "in progress"…).
    expect(options('Value')).toEqual(['Select…', 'Not started', 'In progress', 'Pending review', 'Needs revisions', 'Approved', 'Final', 'Blocked', 'On hold', 'Omitted'])
    // It filters as before: status is final leaves one scene of two.
    fireEvent.change(row().getByRole('combobox', { name: 'Value' }), { target: { value: 'final' } })
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn'])
    expect(screen.getByRole('button', { name: 'Filter (1)' })).toBeTruthy()
    // A text field: its own conditions, a text value in the kit's small well.
    fireEvent.change(row().getByRole('combobox', { name: 'Field' }), { target: { value: 'name' } })
    expect(options('Condition')).toEqual(['contains', 'does not contain', 'is', 'is not', 'is empty', 'is not empty'])
    fireEvent.change(row().getByRole('combobox', { name: 'Condition' }), { target: { value: 'contains' } })
    const value = row().getByRole('textbox', { name: 'Value' })
    expect([value.classList.contains('ui-input'), value.getAttribute('placeholder')]).toEqual([true, 'Value…'])
    fireEvent.change(value, { target: { value: 'cliff' } })
    expect(rowNames(sceneTable())).toEqual(['Cliff path'])
    // "is empty" takes no value.
    fireEvent.change(row().getByRole('combobox', { name: 'Condition' }), { target: { value: 'is_empty' } })
    expect(named(rows()[0])).toEqual(['Where', 'Field', 'Condition', 'Remove this filter'])
    // A second row says And; the remove takes its own row; Done closes the strip.
    fireEvent.click(within(strip()).getByRole('button', { name: 'Add filter' }))
    expect(rows().map((r) => r.firstElementChild.textContent)).toEqual(['Where', 'And'])
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Remove this filter' }))
    expect(rows().map((r) => within(r).getByRole('combobox', { name: 'Field' }).value)).toEqual(['status'])
    fireEvent.click(within(strip()).getByRole('button', { name: 'Done' }))
    expect(strip()).toBeNull()
    // The shots' strip offers the shots' fields, in their order.
    toShots()
    fireEvent.click(screen.getByRole('button', { name: 'Filter (1)' }))
    expect([...within(strip()).getByRole('combobox', { name: 'Field' }).options].map((o) => o.textContent))
      .toEqual(['Status', 'Type', 'Time of day', 'Framing', 'Camera movement', 'Name'])
    expect(inlineColours(strip())).toEqual([])
  })

  it('the saved-views menu: the icon it was, named "Saved views"; a view\'s row loads it, its named delete deletes it, and the foot saves the current view', () => {
    const shotCards = { id: 'v1', name: 'Shot cards, large', filters: [], sortField: '', sortDir: 'asc', groupBy: '', viewMode: 'gallery', gallerySize: 'lg', thumbSize: 'sm', contentMode: 'shots' }
    const sceneCards = { id: 'v2', name: 'Scene cards, small', filters: [], sortField: '', sortDir: 'asc', groupBy: '', viewMode: 'gallery', gallerySize: 'sm', thumbSize: 'sm', contentMode: 'scenes' }
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([shotCards, sceneCards]))
    page()
    const button = screen.getByRole('button', { name: 'Saved views' })
    expect([button.classList.contains('ui-iconbtn'), button.getAttribute('data-saved'), button.getAttribute('aria-expanded')]).toEqual([true, 'true', 'false'])
    const menu = () => document.querySelector('.rb-scene-menu')
    const mode = () => ['Scenes', 'Shots', 'Table', 'Gallery'].filter((n) => screen.getByRole('tab', { name: n }).getAttribute('aria-selected') === 'true')
    expect(mode()).toEqual(['Scenes', 'Table'])
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect([...menu().querySelectorAll('.rb-scene-menu-list > .rb-scene-menu-item')].map((r) => r.textContent)).toEqual(['Shot cards, large', 'Scene cards, small'])

    // Delete: the view's own named button. The view goes, nothing loads, the menu stays.
    fireEvent.click(within(menu()).getByRole('button', { name: 'Delete the saved view "Shot cards, large"' }))
    expect(JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)).map((v) => v.id)).toEqual(['v2'])
    expect(mode()).toEqual(['Scenes', 'Table'])
    expect([...menu().querySelectorAll('.rb-scene-menu-list > .rb-scene-menu-item')].map((r) => r.textContent)).toEqual(['Scene cards, small'])

    // Load: a click on the view's row. The menu closes and the view is on show.
    fireEvent.click(within(menu()).getByText('Scene cards, small'))
    expect(menu()).toBeNull()
    expect(mode()).toEqual(['Scenes', 'Gallery'])
    expect(gallery().getAttribute('data-card')).toBe('sm')

    // Delete the last: none saved, the glyph back to the ink.
    fireEvent.click(button)
    fireEvent.click(within(menu()).getByRole('button', { name: 'Delete the saved view "Scene cards, small"' }))
    expect(menu().querySelector('.rb-scene-menu-empty').textContent).toBe('No saved views yet')
    expect(button.getAttribute('data-saved')).toBe('false')

    // Save current view: the menu closes and the inline row under the toolbar opens, as before.
    fireEvent.click(within(menu()).getByRole('button', { name: 'Save current view' }))
    expect(menu()).toBeNull()
    const name = screen.getByRole('textbox', { name: 'View name' })
    fireEvent.change(name, { target: { value: 'Mine' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)).map((v) => v.name)).toEqual(['Mine'])
    fireEvent.click(button)
    expect(within(menu()).getByText('Mine')).toBeTruthy()
    expect(inlineColours(menu())).toEqual([])
    // An outside press closes it, as it always did.
    fireEvent.mouseDown(document.body)
    expect(menu()).toBeNull()
  })

  it('the menu\'s look is the sheet\'s: the signal on the glyph while views are saved, the float tokens, the list scrolling past 200px', () => {
    const css = read('./rabbitScenes.css')
    expect(css).toContain('.rb-scene-views > .ui-iconbtn.rb-scene-views-button[data-saved="true"] { color: var(--color-signal); }')
    expect(css).toMatch(/\.rb-scene-menu \{[^}]*min-width: 180px;[^}]*background-color: var\(--color-paper-raised\);[^}]*border-radius: var\(--radius-float\);[^}]*box-shadow: var\(--shadow-float\);/)
    expect(css).toContain('.rb-scene-menu-list { max-height: 200px; overflow-y: auto; }')
  })
})

/* ── surface 6c: the scene and shot detail popups ────────────────────────── */
/** A popup, opened from its row's "View details" (the walk's way in). */
const openScenePopup = (name = 'Lighthouse, dawn') => {
  fireEvent.click(within(rowOf(name)).getByRole('button', { name: 'View details' }))
  return screen.getByRole('dialog', { name })
}
const openShotPopup = (name = 'The door') => {
  toShots()
  fireEvent.click(within(rowOf(name)).getByRole('button', { name: 'View details' }))
  return screen.getByRole('dialog', { name })
}
const escape = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
/** R3-36's groups: each SectionTitle's words, and the labels of its grid's cells, in order. */
const groupsOf = (dialog) => [...dialog.querySelectorAll('.rb-scene-detail-main .rb-scene-group')].map((g) => [
  g.querySelector(':scope > .ui-section .ui-section-title').textContent,
  [...g.querySelectorAll(':scope > .rb-scene-prop-grid > .rb-scene-prop > .rb-scene-label')].map((l) => l.textContent),
])
/** Every label in the properties column, in order. */
const labelsOf = (dialog) => [...dialog.querySelectorAll('.rb-scene-detail-main .rb-scene-label')].map((l) => l.textContent)
const inertOf = (dialog) => [...dialog.querySelectorAll('.rb-scene-detail-main .rb-scene-prop-inert')]
const wordsOf = (el) => el.textContent.replace(/\s+/g, ' ').trim()
/** Is `b` after `a` in the document? (Later in <body>: painted over it.) */
const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('surface 6c', () => {
  it('each popup is the kit Dialog in <body>, 896px, named by its scene or shot: the glyph, name and code its title, its status the kit StatusBadge, Delete the kit danger at the footer\'s left; Escape, the backdrop and Close close it', () => {
    const { container, ctx } = page()
    // The codes the page names them by (entityNaming, as before).
    const codes = [formatSceneCode(ctx.project, 1), formatShotCode(ctx.project, 1, 10)]
    for (const [open, name, noun, code] of [[() => openScenePopup(), 'Lighthouse, dawn', 'scene', codes[0]], [() => openShotPopup(), 'The door', 'shot', codes[1]]]) {
      const dialog = open()
      expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
      expect(container.contains(dialog)).toBe(false)
      expect([dialog.classList.contains('ui-dialog'), dialog.classList.contains('rb-scene-detail'), dialog.style.width]).toEqual([true, true, '896px'])
      // Off the legacy #292524: the kit's surface, no ground of its own.
      expect(dialog.getAttribute('data-surface')).toBe('dark')
      // The title: the glyph, the name (read-only: the name field below still
      // edits it, C1) and the code, the kit Badge.
      const title = dialog.querySelector('.ui-dialog-title')
      expect(title.querySelector('svg.rb-scene-detail-icon')).not.toBeNull()
      expect(title.querySelector('.rb-scene-detail-name').textContent).toBe(name)
      expect(title.querySelector('.ui-badge.rb-scene-detail-code').textContent).toBe(code)
      expect(within(title).queryByRole('button')).toBeNull()
      // The status, where the status-coloured rule under the header said it (R3-11).
      const badge = dialog.querySelector('.ui-dialog-subtitle .ui-status')
      expect([badge.getAttribute('data-status'), badge.textContent]).toEqual(['final', STATUS.final.label])
      // Every control named — the kit's ✕ too (the old one had no name).
      expect(within(dialog.querySelector('.ui-dialog-head')).getByRole('button', { name: 'Close' })).toBeTruthy()
      for (const b of within(dialog).getAllByRole('button')) {
        expect(b.getAttribute('aria-label') || b.title || b.textContent.trim(), b.outerHTML.slice(0, 90)).toBeTruthy()
      }
      const foot = dialog.querySelector('.ui-dialog-foot')
      const del = within(foot).getByRole('button', { name: `Delete ${noun}` })
      expect([foot.firstElementChild === del, del.getAttribute('data-variant')]).toEqual([true, 'danger'])
      expect(within(foot).getByRole('button', { name: 'Close' }).getAttribute('data-variant')).toBe('secondary')
      // Escape closes it now (Q17); the backdrop and Close close it, as they did.
      escape()
      expect(screen.queryByRole('dialog')).toBeNull()
      fireEvent.mouseDown(open().parentElement)
      expect(screen.queryByRole('dialog')).toBeNull()
      fireEvent.click(within(open().querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  it('R3-36: the grids under the kit SectionTitle at the Label step — Identity and Schedule in the scene, Identity, Camera and Schedule in the shot — each with the same fields in the same order', () => {
    page()
    let dialog = openScenePopup()
    expect(groupsOf(dialog)).toEqual([
      ['Identity', ['Status', 'Type', 'Time of day', 'Scene number', 'Runtime', 'Total frames']],
      ['Schedule', ['Shots / assets / tasks', 'Start date', 'End date']],
    ])
    // Every label in the column, in the old order, in sentence case (Q2: they
    // were "Time of Day", "Total Frames", "Start Date"…; the Label step draws the capitals).
    expect(labelsOf(dialog)).toEqual(['Scene name', 'Status', 'Type', 'Time of day', 'Scene number', 'Runtime', 'Total frames',
      'Shots / assets / tasks', 'Start date', 'End date', 'Description', 'Notes', 'Folder', 'Shots (2)'])
    // P1-24 (S3b step 7): "Files (N)" once — FileManager's own head; the
    // popup's label above it said it again.
    expect([...dialog.querySelectorAll('.rb-fm-title')].map((t) => t.textContent.trim())).toEqual(['Files (0)'])
    // Each heading is the kit's SectionTitle: its hairline above, an h3 under
    // the Dialog's H2, and the sheet sets it at the Label step.
    const sections = [...dialog.querySelectorAll('.rb-scene-group > .ui-section')]
    expect(sections).toHaveLength(2)
    for (const s of sections) {
      expect([s.classList.contains('rb-scene-section'), s.getAttribute('data-rule'), s.querySelector('.ui-section-title').tagName]).toEqual([true, 'true', 'H3'])
    }
    const css = read('./rabbitScenes.css')
    expect(css).toMatch(/\.rb-scene-section \.ui-section-title \{\n {4}font-size: var\(--text-label\);[^}]*text-transform: uppercase;\n {4}color: var\(--color-ink-3\);\n {2}\}/)
    expect(css).toContain('.rb-scene-prop-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }')
    escape()

    dialog = openShotPopup()
    expect(groupsOf(dialog)).toEqual([
      ['Identity', ['Status', 'Type', 'Time of day', 'Shot number', 'Frame count', 'Duration']],
      ['Camera', ['Framing', 'Camera movement']],
      ['Schedule', ['Parent scene', 'Start date', 'End date']],
    ])
    expect(labelsOf(dialog)).toEqual(['Shot name', 'Status', 'Type', 'Time of day', 'Shot number', 'Frame count', 'Duration',
      'Framing', 'Camera movement', 'Parent scene', 'Start date', 'End date', 'Description', 'Notes', 'Folder'])
    expect([...dialog.querySelectorAll('.rb-fm-title')].map((t) => t.textContent.trim())).toEqual(['Files (0)'])
    // The empty div that held the Camera grid open is gone: the movement spans
    // the two columns it left.
    const camera = dialog.querySelectorAll('.rb-scene-group > .rb-scene-prop-grid')[1]
    expect([...camera.children].map((c) => c.className)).toEqual(['rb-scene-prop', 'rb-scene-prop rb-scene-prop-wide'])
    expect(css).toContain('.rb-scene-prop-wide { grid-column: span 2; }')
  })

  it('R3-36: a value nobody types is inert — no form control, never a tab stop, the inert class — and every other field a named control in the kit\'s small well, writing as before', () => {
    const { ctx } = page()
    let dialog = openScenePopup()
    expect(inertOf(dialog).map(wordsOf)).toEqual(['00:00:10:00', '240', '2 / 0 / 0', 'SCENES/Lighthouse-Dawn/'])
    for (const el of inertOf(dialog)) {
      expect(el.matches('input, select, textarea, button, [tabindex]'), wordsOf(el)).toBe(false)
      expect(el.querySelector('input, select, textarea, button, [tabindex]'), wordsOf(el)).toBeNull()
      expect(focusableWithin(dialog).some((f) => el.contains(f)), wordsOf(el)).toBe(false)
    }
    for (const [name, role] of [['Status', 'combobox'], ['Type', 'combobox'], ['Time of day', 'combobox'], ['Scene number', 'spinbutton']]) {
      const el = within(dialog).getByRole(role, { name })
      expect([el.classList.contains('ui-input'), el.getAttribute('data-size')], name).toEqual([true, 'sm'])
    }
    for (const name of ['Start date', 'End date']) {
      const el = within(dialog).getByLabelText(name)
      expect([el.type, el.className, el.getAttribute('data-size')], name).toEqual(['date', 'ui-input rb-scene-date', 'sm'])
    }
    // The status: the kit's dot inside the well and the kit's words, no colour
    // of its own on the select or any option (R3-11).
    const status = within(dialog).getByRole('combobox', { name: 'Status' })
    expect(status.closest('.rb-scene-prop-status').querySelector('.ui-status-dot').getAttribute('data-tone')).toBe(STATUS.final.tone)
    expect([status.getAttribute('style'), ...[...status.options].map((o) => o.getAttribute('style'))].filter(Boolean)).toEqual([])
    expect([...status.options].map((o) => o.textContent))
      .toEqual(['Not started', 'In progress', 'Pending review', 'Needs revisions', 'Approved', 'Final', 'Blocked', 'On hold', 'Omitted'])
    // The same writes as before.
    fireEvent.change(status, { target: { value: 'approved' } })
    expect(ctx.updateScene).toHaveBeenLastCalledWith('sc1', { status: 'approved' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Time of day' }), { target: { value: '' } })
    expect(ctx.updateScene).toHaveBeenLastCalledWith('sc1', { time_of_day: null })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Scene number' }), { target: { value: '4' } })
    expect(ctx.updateScene).toHaveBeenLastCalledWith('sc1', { scene_number: 4 })
    fireEvent.change(within(dialog).getByLabelText('End date'), { target: { value: '2026-10-02' } })
    expect(ctx.updateScene).toHaveBeenLastCalledWith('sc1', { end_date: '2026-10-02' })
    escape()
    // A scene with no shots: a zero runtime and frame count, and an empty time
    // of day, marked for the third ink (R3-13).
    dialog = openScenePopup('Cliff path')
    expect(inertOf(dialog).slice(0, 2).map((el) => [wordsOf(el), el.getAttribute('data-empty')])).toEqual([['00:00:00:00', 'true'], ['0', 'true']])
    expect(within(dialog).getByRole('combobox', { name: 'Time of day' }).getAttribute('data-empty')).toBe('true')
    escape()

    dialog = openShotPopup()
    expect(inertOf(dialog).map(wordsOf)).toEqual(['00:00:10:00', 'Lighthouse, dawn', 'SHOTS/The-Door/'])
    for (const el of inertOf(dialog)) expect(el.querySelector('input, select, textarea, button, [tabindex]'), wordsOf(el)).toBeNull()
    for (const name of ['Status', 'Type', 'Time of day', 'Framing', 'Camera movement']) {
      expect(within(dialog).getByRole('combobox', { name }).classList.contains('ui-input'), name).toBe(true)
    }
    expect(within(dialog).getByRole('combobox', { name: 'Framing' }).selectedOptions[0].textContent).toBe('Wide shot')
    expect(within(dialog).getByRole('combobox', { name: 'Camera movement' }).selectedOptions[0].textContent).toBe('TILT — Tilt')
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Frame count' }), { target: { value: '96' } })
    expect(ctx.updateShot).toHaveBeenLastCalledWith('sh1', { frame_count: 96 })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Camera movement' }), { target: { value: '' } })
    expect(ctx.updateShot).toHaveBeenLastCalledWith('sh1', { camera_movement: null })
    // The sheet's inert treatment: no well, no edge, the second ink; a zero the third.
    const css = read('./rabbitScenes.css')
    expect(css).toMatch(/\.rb-scene-prop-inert \{[^}]*min-height: var\(--control-sm\);[^}]*color: var\(--color-ink-2\);\n {2}\}/)
    expect(css).not.toMatch(/\.rb-scene-prop-inert \{[^}]*(border|background)/)
    expect(css).toContain('.rb-scene-prop-inert[data-empty="true"] { color: var(--color-ink-3); }')
  })

  it('no element in either mounted popup writes an inline colour, border or background; the primary take\'s poster keeps the 142 × 80 it is handed', () => {
    page(TAKES)
    let dialog = openScenePopup()
    expect(inlineColours(dialog)).toEqual([])
    escape()
    // The cold lamp has no thumbnail of its own: its primary take stands in,
    // its caption at the Label step (it was 7.5px), the well its edge.
    dialog = openShotPopup('The cold lamp')
    const set = dialog.querySelector('.rb-scene-detail-thumb > .rb-scene-detail-thumb-set')
    expect([set.getAttribute('data-take'), set.title]).toEqual(['true', 'Showing the primary take. Click to set a thumbnail of your own.'])
    const poster = set.querySelector(':scope > .rb-scene-detail-poster > .bn-poster')
    expect(poster.classList.contains('rb-scene-poster')).toBe(true)
    expect([poster.style.width, poster.style.height, poster.style.borderRadius, poster.style.border]).toEqual(['142px', '80px', '0px', ''])
    expect(set.querySelector('.rb-scene-detail-thumb-take').textContent).toBe('From primary take')
    expect(read('./rabbitScenes.css')).toMatch(/\.rb-scene-detail-thumb-take \{[^}]*font-size: var\(--text-label\);[^}]*text-transform: uppercase;/)
    // ShotTakesPanel is B6's, its inks its own contract: left out of the scan,
    // and only it — the last child of the takes block, under its label.
    const takes = dialog.querySelector('.rb-scene-detail-takes')
    expect(takes.querySelector('.rb-scene-label').textContent).toBe('Takes (1)')
    const host = dialog.cloneNode(true)
    const panel = host.querySelector('.rb-scene-detail-takes').lastElementChild
    expect(within(panel).getByRole('button', { name: /Add takes/ })).toBeTruthy()
    panel.remove()
    expect(inlineColours(host)).toEqual([])
  })

  it('a task opened from a popup\'s sidebar is its own kit Dialog in <body>, over the popup: ONE Escape closes only the task, and the next closes the popup', () => {
    page({ tasks: [
      { id: 't9', title: 'Light pass', status: 'in_progress', scene_id: 'sc1' },
      { id: 't8', title: 'Door wipe', status: 'in_progress', shot_id: 'sh1', scene_id: 'sc1' },
    ] })
    for (const [open, name, task] of [[() => openScenePopup(), 'Lighthouse, dawn', 'Light pass'], [() => openShotPopup(), 'The door', 'Door wipe']]) {
      const dialog = open()
      fireEvent.click(within(dialog.querySelector('.rb-scene-detail-side')).getByText(task))
      const taskDialog = screen.getByRole('dialog', { name: task })
      // In <body>, in the portal's one wrapper, which carries the app's dark
      // scrollbar class B2's popup cannot take (review round one, R1-12).
      const wrap = taskDialog.closest('.ui-dialog-backdrop').parentElement
      expect([wrap.parentElement, wrap.className]).toEqual([document.body, 'wilson-dark-scroll'])
      expect(dialog.contains(taskDialog)).toBe(false)
      // Over it: later in <body>, as it is later on the modal stack.
      expect(after(dialog.closest('.ui-dialog-backdrop'), taskDialog)).toBe(true)
      escape()
      expect(screen.queryByRole('dialog', { name: task })).toBeNull()
      expect(screen.getByRole('dialog', { name })).toBe(dialog)
      escape()
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  it('the take picker opened from the shot popup\'s takes is its own kit Dialog in <body>, after the popup and over it: one Escape closes only the picker', () => {
    page(TAKES)
    const dialog = openShotPopup('The cold lamp')
    fireEvent.click(within(dialog.querySelector('.rb-scene-detail-takes')).getByRole('button', { name: /Add takes/ }))
    const picker = screen.getByRole('dialog', { name: 'Add takes to "The cold lamp"' })
    // In <body>, in the portal's one wrapper, which carries the app's dark
    // scrollbar class B6's dialog cannot take (review round one, R1-12).
    const wrap = picker.closest('.ui-dialog-backdrop').parentElement
    expect([wrap.parentElement, wrap.className]).toEqual([document.body, 'wilson-dark-scroll'])
    expect(after(dialog.closest('.ui-dialog-backdrop'), picker)).toBe(true)
    escape()
    expect(screen.queryByRole('dialog', { name: 'Add takes to "The cold lamp"' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'The cold lamp' })).toBe(dialog)
  })

  it('the popup\'s Delete asks with focus on Cancel, and the question hands focus back to the row\'s "View details" every way it closes; its Delete deletes, as before', async () => {
    const { ctx } = page()
    const view = within(rowOf('Lighthouse, dawn')).getByRole('button', { name: 'View details' })
    const ask = () => {
      view.focus()
      fireEvent.click(view)
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Lighthouse, dawn' }).querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Delete scene' }))
      expect(screen.queryByRole('dialog', { name: 'Lighthouse, dawn' })).toBeNull()
      return screen.getByRole('dialog', { name: 'Delete scene?' })
    }
    const closes = {
      Cancel: (q) => fireEvent.click(within(q.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Cancel' })),
      Escape: () => fireEvent.keyDown(document.activeElement, { key: 'Escape' }),
      '✕': (q) => fireEvent.click(within(q.querySelector('.ui-dialog-head')).getByRole('button', { name: 'Close' })),
      backdrop: (q) => fireEvent.mouseDown(q.parentElement),
    }
    for (const [way, close] of Object.entries(closes)) {
      const question = ask()
      expect(question.textContent, way).toContain('This will permanently delete “Lighthouse, dawn” and its 2 shots from the project. It will be gone from “Shot list 1 · v1” too. To take it out of “Shot list 1 · v1” only, use “Remove from this list” in its shot-list menu.')
      // On Cancel — not on the question's ✕, where the popup's close sent it.
      expect(document.activeElement, way).toBe(within(question.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Cancel' }))
      close(question)
      expect(screen.queryByRole('dialog'), way).toBeNull()
      expect(document.activeElement, way).toBe(view)
    }
    expect(ctx.deleteScene).not.toHaveBeenCalled()
    fireEvent.click(within(ask().querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(ctx.deleteScene).toHaveBeenCalledWith('sc1'))
    // R1-01: the scene's own delete takes its shots.
    expect(ctx.deleteShot).not.toHaveBeenCalled()
  })

  it('W2: the name edits in place, the kit\'s small field where its well was — Enter commits; Escape reverts it and the popup stays; Description opens the kit\'s textarea, Escape drops the edit and the popup stays, Save writes', () => {
    const { ctx } = page()
    const dialog = openScenePopup()
    const main = dialog.querySelector('.rb-scene-detail-main')
    const name = () => within(main).getByRole('button', { name: 'Lighthouse, dawn' })
    expect([name().className, name().getAttribute('data-size')]).toEqual(['ui-input rb-scene-name-text', 'sm'])
    fireEvent.click(name())
    let field = within(main).getByRole('textbox', { name: 'Scene name' })
    expect(document.activeElement).toBe(field)
    expect([field.className, field.getAttribute('data-size')]).toEqual(['ui-input', 'sm'])
    fireEvent.change(field, { target: { value: 'Lighthouse, night' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(ctx.updateScene).toHaveBeenCalledWith('sc1', { name: 'Lighthouse, night' })
    fireEvent.click(name())
    field = within(main).getByRole('textbox', { name: 'Scene name' })
    fireEvent.change(field, { target: { value: 'Oops' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Lighthouse, dawn' })).toBe(dialog)
    expect(within(main).queryByRole('textbox', { name: 'Scene name' })).toBeNull()
    expect(ctx.updateScene).not.toHaveBeenCalledWith('sc1', { name: 'Oops' })

    const words = () => within(main).getByRole('button', { name: 'Mara lets herself in.' })
    expect(words().className).toBe('ui-input rb-scene-prop-text')
    fireEvent.click(words())
    let box = within(main).getByRole('textbox', { name: 'Description' })
    expect([document.activeElement === box, box.className]).toEqual([true, 'ui-input rb-scene-textarea'])
    fireEvent.change(box, { target: { value: 'Draft' } })
    // D21 (S3b step 7): a changed draft is not dropped without a word —
    // Escape asks first, over the popup; Discard drops it and the popup stays.
    fireEvent.keyDown(box, { key: 'Escape' })
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard your changes?' })).getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('dialog', { name: 'Lighthouse, dawn' })).toBe(dialog)
    expect(within(main).queryByRole('textbox', { name: 'Description' })).toBeNull()
    fireEvent.click(words())
    box = within(main).getByRole('textbox', { name: 'Description' })
    expect(box.value).toBe('Mara lets herself in.')
    fireEvent.change(box, { target: { value: 'Mara lets herself in. The lamp is cold.' } })
    const save = within(main).getByRole('button', { name: 'Save' })
    expect(save.getAttribute('data-variant')).toBe('primary')
    fireEvent.click(save)
    expect(ctx.updateScene).toHaveBeenLastCalledWith('sc1', { description: 'Mara lets herself in. The lamp is cold.' })
    // Notes: none yet, its prompt marked for the third ink.
    expect(within(main).getByRole('button', { name: 'Click to add notes...' }).getAttribute('data-empty')).toBe('true')
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Add new task" opens the task form INSIDE the Dialog as its first column, in its focus trap, the Dialog wider by it; an Escape inside the form is the form\'s', () => {
    page()
    const dialog = openScenePopup()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add new task' }))
    const title = screen.getByPlaceholderText('Task title…')
    const form = title.closest('.rb-rel-task')
    expect(dialog.contains(form)).toBe(true)
    expect([...dialog.querySelector('.rb-scene-detail-body').children].map((c) => c.className))
      .toEqual(['rb-scene-detail-task', 'rb-scene-detail-side', 'rb-scene-detail-main'])
    expect(form.parentElement.className).toBe('rb-scene-detail-task')
    // 896 + the form's 400 + its hairline; the Dialog's Tab trap holds the form.
    expect(dialog.style.width).toBe('1297px')
    expect(document.activeElement).toBe(title)
    expect(focusableWithin(dialog)).toContain(title)
    // RelationsPanel's mark: an Escape in the form is the form's; the draft stays.
    fireEvent.change(title, { target: { value: 'Draft kept' } })
    fireEvent.keyDown(title, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Lighthouse, dawn' })).toBe(dialog)
    expect(screen.getByPlaceholderText('Task title…').value).toBe('Draft kept')
    fireEvent.click(within(form).getByRole('button', { name: 'Close' }))
    expect(screen.queryByPlaceholderText('Task title…')).toBeNull()
    expect(dialog.style.width).toBe('896px')
    // Its float frame stands down in the column (the sheet's).
    expect(read('./rabbitScenes.css')).toMatch(/\.rb-scene-detail-task > div \{[^}]*border: 0;[^}]*box-shadow: none;/)
  })

  it('the scene popup\'s shots: a row\'s name opens its shot over the popup; its status the kit StatusBadge, its delete named in the kit HoverActions; none is the kit EmptyState', () => {
    const { ctx } = page()
    const dialog = openScenePopup()
    const rows = [...dialog.querySelectorAll('.rb-scene-shot-list > .rb-scene-shot')]
    expect(rows.map((r) => r.querySelector('.rb-scene-shot-name').textContent)).toEqual(['The door', 'The cold lamp'])
    expect(rows.map((r) => r.querySelector('.ui-status').getAttribute('data-status'))).toEqual(['final', 'in_progress'])
    expect(rows.map((r) => r.querySelector('.rb-scene-shot-num').textContent)).toEqual(['#10', '#20'])
    expect([rows[0].querySelector('.rb-scene-shot-time').textContent, rows[1].querySelector('.rb-scene-shot-time')]).toEqual(['00:00:10:00 · 240 fr', null])
    const del = within(rows[0].querySelector('.ui-hover-actions.rb-scene-shot-acts')).getByRole('button', { name: 'Delete The door' })
    expect([del.classList.contains('ui-iconbtn'), del.getAttribute('data-danger')]).toEqual([true, 'true'])
    // The name opens the shot's popup over this one, both in <body>.
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'The door' }))
    const shot = screen.getByRole('dialog', { name: 'The door' })
    expect(after(dialog.closest('.ui-dialog-backdrop'), shot)).toBe(true)
    escape()
    expect(screen.queryByRole('dialog', { name: 'The door' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Lighthouse, dawn' })).toBe(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add shot' }))
    // S3b: into the list on screen.
    expect(ctx.addShot).toHaveBeenCalledWith(expect.objectContaining({ scene_id: 'sc1' }), { listId: 'list-1' })
    escape()
    const empty = openScenePopup('Cliff path').querySelector('.rb-scene-detail-main .ui-empty.rb-scene-detail-empty')
    expect(empty.textContent).toBe('No shots yet')
  })
})

/* ── review round one ───────────────────────────────────────────────────── */
describe('review round one', () => {
  it('R1-01: the Undo and ingestion toasts are on the kit Toast\'s layer, over the kit Dialog\'s backdrop — an Undo for a take unassigned in a popup is the Undo\'s to click', () => {
    const kit = read('../../../index.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const layer = (sel) => Number((kit.match(new RegExp(`\\${sel} \\{[^}]*?z-index: (\\d+);`)) || [])[1])
    const toastLayer = layer('.ui-toast-stack')
    const dialogLayer = layer('.ui-dialog-backdrop')
    expect(toastLayer).toBeGreaterThan(dialogLayer)
    rabbit.current = {
      undoToast: { key: 1, message: 'Unassigned 1 take from "The door"', onUndo: vi.fn() },
      dismissUndoToast: vi.fn(),
      ingestionRun: { phase: 'done', chunksDone: 3, chunksTotal: 3, fileCount: 1 },
    }
    // The Undo is the kit stack's PINNED row since the Track A merge's review
    // round 2 (A-R2-02): it rides the stack's layer and anchor and restates
    // neither, so the same layer holds by containment rather than by a copied
    // number. The ingestion toast is still a fixed surface of its own.
    render(<ToastProvider bar="8px" pinned={<UndoToast />}><IngestionToast /></ToastProvider>)
    /** A fixed surface's layer: its one z- utility, a number. */
    const zOf = (el) => (el.className.match(/(?:^|\s)z-\[?(\d+)\]?(?=\s|$)/g) || []).map((z) => Number(z.replace(/\D/g, '')))
    const stack = document.querySelector('.ui-toast-stack')
    const undoButton = screen.getByRole('button', { name: 'Undo' })
    expect(stack.contains(undoButton)).toBe(true)
    const undo = undoButton.closest('.ui-toast-pinned > *')
    expect(undo.className).not.toMatch(/(?:^|\s)fixed(?:\s|$)/)
    expect(zOf(undo)).toEqual([])
    const ingestion = screen.getByText('Breakdown ready').closest('.fixed')
    expect(zOf(ingestion)).toEqual([toastLayer])
  })

  it('R1-02: a shot\'s description in the scene popup reverts on Escape and the popup stays; the next Escape closes it', () => {
    const { ctx } = page()
    const dialog = openScenePopup()
    const row = dialog.querySelector('.rb-scene-shot-list > .rb-scene-shot')
    fireEvent.click(within(row).getByText('Mara in the doorway.'))
    const field = within(row).getByRole('textbox', { name: 'Description for The door' })
    expect(document.activeElement).toBe(field)
    fireEvent.change(field, { target: { value: 'Oops' } })
    // Marked handled: fireEvent answers false for a key whose default was prevented.
    expect(fireEvent.keyDown(field, { key: 'Escape' })).toBe(false)
    expect(screen.getByRole('dialog', { name: 'Lighthouse, dawn' })).toBe(dialog)
    expect(within(row).queryByRole('textbox')).toBeNull()
    expect(within(row).getByText('Mara in the doorway.')).toBeTruthy()
    expect(ctx.updateShot).not.toHaveBeenCalled()
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('R1-08: Ctrl+Z and Ctrl+Y do nothing behind a delete question — a table\'s bulk one and a row\'s; window.confirm blocked them — and undo as before on the page and with a popup open (C1)', () => {
    const undo = vi.fn()
    const redo = vi.fn()
    page({ ...TAKES, undo, redo })
    const press = (el) => {
      expect(el.tagName, 'a button, never a field').toBe('BUTTON')
      fireEvent.keyDown(el, { key: 'z', ctrlKey: true })
      fireEvent.keyDown(el, { key: 'z', ctrlKey: true, shiftKey: true })
      fireEvent.keyDown(el, { key: 'y', ctrlKey: true })
    }
    const calls = () => [undo.mock.calls.length, redo.mock.calls.length]
    const cancel = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    toShots()
    // The shot table's bulk question, The door ticked: an undo behind it
    // reverted a status while the question was up.
    fireEvent.click(within(rowOf('The door')).getByRole('button', { name: 'Select The door' }))
    fireEvent.click(within(document.querySelector('.rb-scene-bulk')).getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('dialog', { name: 'Delete shots' })).toBeTruthy()
    press(document.activeElement)
    expect(calls()).toEqual([0, 0])
    cancel()
    // A row's question.
    fireEvent.click(within(rowOf('The door')).getByRole('button', { name: 'Delete shot' }))
    expect(screen.getByRole('dialog', { name: 'Delete shot?' })).toBeTruthy()
    press(document.activeElement)
    expect(calls()).toEqual([0, 0])
    cancel()
    expect(screen.queryByRole('dialog')).toBeNull()
    // No question up: the keys undo and redo on the page…
    press(within(rowOf('The door')).getByRole('button', { name: 'View details' }))
    expect(calls()).toEqual([1, 2])
    // …and with a popup open, as they did before the kit Dialog.
    fireEvent.click(within(rowOf('The door')).getByRole('button', { name: 'View details' }))
    const popup = screen.getByRole('dialog', { name: 'The door' })
    press(popup.querySelector('.ui-dialog-head button'))
    expect(calls()).toEqual([2, 4])
  })

  it('R1-12: every dialog the page portals scrolls on the app\'s dark bar — <body> is outside the app\'s root: its two popups carry the class, and B6\'s takes dialogs (and B2\'s task popup, above) sit in a wrapper that does', () => {
    page(TAKES)
    for (const [open, name] of [[() => openScenePopup(), 'Lighthouse, dawn'], [() => openShotPopup(), 'The door']]) {
      const dialog = open()
      expect(dialog.closest('.ui-dialog-backdrop').parentElement, name).toBe(document.body)
      expect(dialog.classList.contains('wilson-dark-scroll'), name).toBe(true)
      escape()
      expect(screen.queryByRole('dialog'), name).toBeNull()
    }
    // B6's takes dialog, from a row's takes (the picker's is above).
    fireEvent.click(rowOf('The cold lamp').querySelector('.rb-scene-takes-cell button'))
    const takes = screen.getByRole('dialog', { name: 'Takes — The cold lamp' })
    const wrap = takes.closest('.ui-dialog-backdrop').parentElement
    expect([wrap.parentElement, wrap.className]).toEqual([document.body, 'wilson-dark-scroll'])
  })
})

/* ── review round two ───────────────────────────────────────────────────── */
describe('review round two', () => {
  it('R2-01: Ctrl+Z and Ctrl+Y do nothing behind a question the page did not ask — FileManager\'s "Delete file" in the scene popup, the kit Dialog at the confirm width — and undo with the popup open before it and after it (C1)', () => {
    const undo = vi.fn()
    const redo = vi.fn()
    page({ ...TAKES, undo, redo, files: [{ id: 'f9', scene_id: 'sc1', name: 'SC04_lighting_plan.pdf', size_bytes: 2048, uploaded_at: '2026-09-20T10:00:00Z' }] })
    const press = (el) => {
      expect(el.tagName, 'a button, never a field').toBe('BUTTON')
      fireEvent.keyDown(el, { key: 'z', ctrlKey: true })
      fireEvent.keyDown(el, { key: 'z', ctrlKey: true, shiftKey: true })
      fireEvent.keyDown(el, { key: 'y', ctrlKey: true })
    }
    const calls = () => [undo.mock.calls.length, redo.mock.calls.length]
    const dialog = openScenePopup()
    // The popup open and no question: the keys undo, as they did (C1).
    press(within(dialog.querySelector('.ui-dialog-head')).getByRole('button', { name: 'Close' }))
    expect(calls()).toEqual([1, 2])
    // The file's delete asks FileManager's question, over the popup, focus on its Cancel.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete SC04_lighting_plan.pdf' }))
    const question = screen.getByRole('dialog', { name: 'Delete file' })
    expect([question.getAttribute('data-width'), dialog.contains(question)]).toEqual(['confirm', false])
    expect(document.activeElement).toBe(within(question).getByRole('button', { name: 'Cancel' }))
    press(document.activeElement)
    expect(calls()).toEqual([1, 2])
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Delete file' })).toBeNull()
    // Answered: the popup's keys undo again.
    press(within(dialog.querySelector('.ui-dialog-head')).getByRole('button', { name: 'Close' }))
    expect(calls()).toEqual([2, 4])
  })

  it('R2-05: an editor whose words are a control gives focus back to them when it closes — the name by Enter and Escape, each description and notes by Escape, Save and Cancel — in both popups; focus had fallen to <body>', () => {
    const { ctx } = page()
    const inBody = () => document.activeElement === document.body
    for (const [open, name, desc] of [[() => openScenePopup(), 'Lighthouse, dawn', 'Mara lets herself in.'], [() => openShotPopup(), 'The door', 'Mara in the doorway.']]) {
      const dialog = open()
      const main = dialog.querySelector('.rb-scene-detail-main')
      // The name (PopupInlineText): Enter commits, Escape reverts; each hands focus back.
      const nameWords = () => within(main).getByRole('button', { name })
      for (const key of ['Enter', 'Escape']) {
        fireEvent.click(nameWords())
        const field = within(main).getByRole('textbox', { name: name === 'The door' ? 'Shot name' : 'Scene name' })
        expect(document.activeElement, `${name}: ${key}`).toBe(field)
        fireEvent.keyDown(field, { key })
        expect([inBody(), document.activeElement === nameWords()], `${name}: ${key}`).toEqual([false, true])
      }
      // The description and the notes: Escape, Save and Cancel each hand focus back.
      for (const [words, label] of [[desc, 'Description'], ['Click to add notes...', 'Notes']]) {
        for (const close of ['Escape', 'Save', 'Cancel']) {
          fireEvent.click(within(main).getByRole('button', { name: words }))
          const box = within(main).getByRole('textbox', { name: label })
          expect(document.activeElement, `${name}: ${label} ${close}`).toBe(box)
          if (close === 'Escape') fireEvent.keyDown(box, { key: 'Escape' })
          else fireEvent.click(within(box.parentElement).getByRole('button', { name: close }))
          expect([inBody(), document.activeElement === within(main).getByRole('button', { name: words })], `${name}: ${label} ${close}`).toEqual([false, true])
        }
      }
      escape()
      expect(screen.queryByRole('dialog')).toBeNull()
    }
    // The edits were the editors' own, as before: the name's Enter wrote an unchanged draft nowhere.
    expect(ctx.updateScene.mock.calls.filter(([, patch]) => 'name' in patch)).toEqual([])
  })

  it('R2-05: a blur commit hands focus back only when it fell to <body> — a Tab or a click elsewhere keeps where it went', () => {
    const { ctx } = page()
    const dialog = openScenePopup()
    const main = dialog.querySelector('.rb-scene-detail-main')
    const nameWords = () => within(main).getByRole('button', { name: 'Lighthouse, dawn' })
    // Focus moves on to another control: the edit commits there and focus stays there.
    fireEvent.click(nameWords())
    let field = within(main).getByRole('textbox', { name: 'Scene name' })
    fireEvent.change(field, { target: { value: 'Lighthouse, noon' } })
    const status = within(main).getByRole('combobox', { name: 'Status' })
    act(() => { status.focus() })
    expect(ctx.updateScene).toHaveBeenLastCalledWith('sc1', { name: 'Lighthouse, noon' })
    expect(document.activeElement).toBe(status)
    // Focus goes nowhere (the window loses it, say): the words take it back.
    fireEvent.click(nameWords())
    field = within(main).getByRole('textbox', { name: 'Scene name' })
    act(() => { field.blur() })
    expect(document.activeElement).toBe(nameWords())
  })
})

/* ── post-overhaul S3b, step 1: safe with more than one list ────────────────
   S3a made ctx.scenes / ctx.shots the ACTIVE list's rows. A fact about the
   whole project — the next number, every shot a scene's delete takes — must
   read ctx.allScenes / ctx.allShots, and a popup must find its row through
   ctx.sceneById / ctx.shotById, or a second list loses numbers and shots. */
// Two lists. "Shoot · v1" (ACTIVE) holds Lighthouse, dawn with The door and
// The cold lamp, and Cliff path. "Pickups · v1" holds Lighthouse with only
// The far lamp (shot 30, in no other list) and Harbour café (scene 3, in no
// other list) with The kettle.
const TWO_LISTS = () => ({
  scenes: [...SCENES(), { id: 'sc3', name: 'Harbour café', scene_number: 3, status: 'in_progress', type: 'interior', time_of_day: 'afternoon', description: 'The one conversation.' }],
  shots: [
    ...SHOTS(),
    { id: 'sh3', scene_id: 'sc3', name: 'The kettle', shot_number: 10, status: 'not_started', type: 'other', frame_count: 48, description: '' },
    { id: 'sh4', scene_id: 'sc1', name: 'The far lamp', shot_number: 30, status: 'not_started', type: 'other', frame_count: 24, description: '' },
  ],
  shotLists: [
    { ...LIST_1, id: 'list-a', title: 'Shoot', summary: 'The main unit' },
    { ...LIST_1, id: 'list-b', title: 'Pickups', summary: 'Second unit', created_at: '2026-09-30T12:00:00Z' },
  ],
  shotListItems: [
    ...itemsFor('list-a', [{ scene_id: 'sc1', position: 0 }, { scene_id: 'sc2', position: 1 }, { shot_id: 'sh1', position: 0 }, { shot_id: 'sh2', position: 1 }]),
    ...itemsFor('list-b', [{ scene_id: 'sc1', position: 0 }, { scene_id: 'sc3', position: 1 }, { shot_id: 'sh4', position: 0 }, { shot_id: 'sh3', position: 0 }]),
  ],
  activeListId: 'list-a',
})

describe('S3b step 1: the tab is safe with more than one list', () => {
  it('the premise: the list on screen holds scenes 1 and 2 and four shots of the project\'s six — the rest only the other list holds', () => {
    const { ctx } = page(TWO_LISTS())
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Cliff path'])
    expect(ctx.scenes.map((s) => s.id)).toEqual(['sc1', 'sc2'])
    expect(ctx.allScenes.map((s) => s.id)).toEqual(['sc1', 'sc2', 'sc3'])
    expect(ctx.shots.map((s) => s.id)).toEqual(['sh1', 'sh2'])
    expect(ctx.allShots.map((s) => s.id)).toEqual(['sh1', 'sh2', 'sh3', 'sh4'])
  })

  it('New scene takes the number after EVERY scene of the project, not after the list\'s (scene 3, held only by the other list, was minted again)', async () => {
    const { ctx } = page(TWO_LISTS())
    fireEvent.click(screen.getByRole('button', { name: 'New scene' }))
    await waitFor(() => expect(ctx.addScene).toHaveBeenCalledTimes(1))
    expect(ctx.addScene.mock.calls[0][0]).toMatchObject({ scene_number: 4, name: formatSceneCode(ctx.project, 4) })
  })

  it('a new shot takes the number after every shot of its scene, in every list (The far lamp, 30, only in the other list)', async () => {
    const { ctx } = page(TWO_LISTS())
    openScene('Lighthouse, dawn')
    fireEvent.click(within(rowOf('Lighthouse, dawn').nextElementSibling).getByRole('button', { name: 'Add shot' }))
    await waitFor(() => expect(ctx.addShot).toHaveBeenCalledTimes(1))
    expect(ctx.addShot.mock.calls[0][0]).toMatchObject({ scene_id: 'sc1', shot_number: 31, name: formatShotCode(ctx.project, 1, 31) })
  })

  // Review round 1 (R1-01) re-pinned these two. Step 1 had each shot deleted
  // by its own call before the scene — "so each has its own undo" — on a
  // premise S3a's round 1 had already made false: S3a's deleteScene takes
  // EVERY shot of the scene, in every list, and its ONE undo step restores
  // the scene, each shot, every membership and every task link
  // (shotListsProvider.test.jsx). One step a shot ran past the history's
  // ten: a scene with eleven shots came back with nine of them.
  it('a scene\'s delete is S3a\'s deleteScene alone — the scene\'s every shot, in every list, goes with it in one undo step (R1-01)', async () => {
    const { ctx } = page(TWO_LISTS())
    fireEvent.click(within(rowOf('Lighthouse, dawn')).getByRole('button', { name: 'Delete scene' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(ctx.deleteScene).toHaveBeenCalledWith('sc1'))
    expect(ctx.deleteScene).toHaveBeenCalledTimes(1)
    expect(ctx.deleteShot).not.toHaveBeenCalled()
  })

  it('the bulk delete: each scene ticked by deleteScene, every call inside ONE batch — one undo step for the selection (R1-01)', async () => {
    const probe = batchProbe()
    const { ctx } = page({ ...TWO_LISTS(), runBatch: probe.runBatch, deleteScene: probe.mark('deleteScene') })
    fireEvent.click(screen.getByRole('button', { name: 'Select Lighthouse, dawn' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select Cliff path' }))
    fireEvent.click(within(document.querySelector('.rb-scene-bulk')).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(probe.calls).toEqual([['deleteScene', true], ['deleteScene', true]]))
    expect(ctx.deleteScene.mock.calls.map((c) => c[0])).toEqual(['sc1', 'sc2'])
    expect(ctx.runBatch).toHaveBeenCalledTimes(1)
    expect(ctx.deleteShot).not.toHaveBeenCalled()
  })

  it('a shot and a scene only the other list holds open their popups ("Open in Scenes"): each found among every row, the shot\'s code and parent scene its own', () => {
    const { ctx } = page(TWO_LISTS())
    act(() => navigateTo({ view: 'scenes', projectId: 'p1', shotId: 'sh3' }))
    const shot = screen.getByRole('dialog', { name: 'The kettle' })
    expect(shot.querySelector('.rb-scene-detail-code').textContent).toBe(formatShotCode(ctx.project, 3, 10))
    const parent = within(shot).getByText('Parent scene').closest('.rb-scene-prop')
    expect(parent.querySelector('.rb-scene-prop-words').textContent).toBe('Harbour café')
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => navigateTo({ view: 'scenes', projectId: 'p1', sceneId: 'sc3' }))
    const scene = screen.getByRole('dialog', { name: 'Harbour café' })
    // The list on screen does not hold it, so its popup lists every shot it has.
    expect([...scene.querySelectorAll('.rb-scene-shot-name')].map((b) => b.textContent)).toEqual(['The kettle'])
  })

  it('each popup\'s task form offers every scene and shot: the row only the other list holds is the task\'s own, not "—"', () => {
    page({ ...TWO_LISTS(), projectFields: { scenes_enabled: true } })
    const formSelects = (dialog) => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add new task' }))
      const form = screen.getByPlaceholderText('Task title…').closest('.rb-rel-task')
      return ['Scene', 'Shot'].map((label) => within(form).getByText(label).closest('.ui-field').querySelector('select'))
    }
    act(() => navigateTo({ view: 'scenes', projectId: 'p1', shotId: 'sh3' }))
    const shotPopup = screen.getByRole('dialog', { name: 'The kettle' })
    let [sceneSelect, shotSelect] = formSelects(shotPopup)
    expect([...sceneSelect.options].map((o) => o.textContent)).toEqual(['—', 'Lighthouse, dawn', 'Cliff path', 'Harbour café'])
    expect([shotSelect.value, shotSelect.selectedOptions[0].textContent]).toEqual(['sh3', 'The kettle'])
    fireEvent.click(within(shotPopup.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => navigateTo({ view: 'scenes', projectId: 'p1', sceneId: 'sc3' }));
    [sceneSelect, shotSelect] = formSelects(screen.getByRole('dialog', { name: 'Harbour café' }))
    expect([sceneSelect.value, sceneSelect.selectedOptions[0].textContent]).toEqual(['sc3', 'Harbour café'])
    expect([...shotSelect.options].map((o) => o.textContent)).toEqual(['—', 'The kettle'])
  })

  it('the take picker opened from such a shot\'s popup finds the shot, and its scene, among every row', () => {
    page({ ...TWO_LISTS(), ...TAKES })
    act(() => navigateTo({ view: 'scenes', projectId: 'p1', shotId: 'sh3' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'The kettle' })).getByRole('button', { name: /Add takes/ }))
    const picker = screen.getByRole('dialog', { name: 'Add takes to "The kettle"' })
    expect(picker.querySelector('.ui-dialog-subtitle').textContent).toMatch(/^Harbour café · /)
  })
})

/* ── post-overhaul S3b, step 2: the list on screen ──────────────────────────
   D2: the tab shows the list THIS PERSON is viewing (remembered per person
   and project; the active list by default and when the remembered one is
   archived or gone); D20: the tiles and the count total it; "List order" is
   the default sort, with Move up / Move down in each row's shot-list menu. */
/** Remember a list for a person (the Local Server's one key by default) in Salt Hours. */
const remember = (listId, person = 'local') => localStorage.setItem(VIEWED_LISTS_KEY, JSON.stringify({ [`${person}|p1`]: listId }))
const tileValues = () => [...document.querySelectorAll('.rb-scene-stats .ui-stat-value')].map((v) => v.textContent)
const moreButton = (name) => screen.getByRole('button', { name: `Shot list actions for ${name}` })
/** Open a row's shot-list menu; its items as [words, disabled]. */
const openMore = (name) => {
  fireEvent.click(moreButton(name))
  return [...document.querySelectorAll('.ui-menu .ui-menu-item')].map((b) => [b.textContent, b.disabled])
}
const menuItem = (words) => [...document.querySelectorAll('.ui-menu .ui-menu-item')].find((b) => b.textContent === words)
// One list holding three scenes in number order — for the moves.
const THREE_SCENES = () => {
  const scenes = TWO_LISTS().scenes
  const shots = SHOTS()
  return { scenes, shots, shotLists: [LIST_1], shotListItems: itemsFor('list-1', backfillItems(scenes, shots)), activeListId: 'list-1' }
}

describe('S3b step 2: the list on screen', () => {
  it('a remembered list is the one on screen — its rows in its order, the tiles and the count its own (D20); the other tabs still read the active list', () => {
    remember('list-b')
    const { ctx } = page(TWO_LISTS())
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Harbour café'])
    // Pickups holds The far lamp (24 frames) and The kettle (48): 72 frames, 3 seconds.
    expect(tileValues()).toEqual(['00:00:03:00', '72', '2', '2'])
    expect(document.querySelector('.rb-scene-count').textContent).toBe('2/2')
    // ctx.scenes, what every other tab reads, is still the active list's.
    expect(ctx.scenes.map((s) => s.id)).toEqual(['sc1', 'sc2'])
    openScene('Lighthouse, dawn')
    expect(rowNames(rowOf('Lighthouse, dawn').nextElementSibling.querySelector('table'))).toEqual(['The far lamp'])
  })

  it('remembered per person: another person on the same machine gets the active list', () => {
    remember('list-b', 'u-1')
    perms.current = { ...perms.admin, userId: 'u-2' }
    page(TWO_LISTS())
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Cliff path'])
    cleanup()
    perms.current = { ...perms.admin, userId: 'u-1' }
    page(TWO_LISTS())
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Harbour café'])
  })

  it('a remembered list that has been archived, or is gone, falls back to the active list', () => {
    remember('list-b')
    const two = TWO_LISTS()
    page({ ...two, shotLists: [two.shotLists[0], { ...two.shotLists[1], archived_at: '2026-10-01T09:00:00Z', archived_by: 'u-9' }] })
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Cliff path'])
    cleanup()
    remember('list-gone')
    page(TWO_LISTS())
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Cliff path'])
  })

  it('New scene and New shot join the list on screen, not the active one', async () => {
    remember('list-b')
    const { ctx } = page(TWO_LISTS())
    fireEvent.click(screen.getByRole('button', { name: 'New scene' }))
    await waitFor(() => expect(ctx.addScene).toHaveBeenCalledTimes(1))
    expect(ctx.addScene.mock.calls[0][1]).toEqual({ listId: 'list-b' })
    openScene('Harbour café')
    fireEvent.click(within(rowOf('Harbour café').nextElementSibling).getByRole('button', { name: 'Add shot' }))
    await waitFor(() => expect(ctx.addShot).toHaveBeenCalledTimes(1))
    expect(ctx.addShot.mock.calls[0]).toEqual([expect.objectContaining({ scene_id: 'sc3', shot_number: 11 }), { listId: 'list-b' }])
  })

  it('"List order" is the default sort: the list\'s own positions, scenes and each scene\'s shots; another sort orders by number as before', () => {
    const two = TWO_LISTS()
    // Shoot, reordered: Cliff path first, and Lighthouse's shots The cold lamp then The door.
    const items = two.shotListItems.map((i) => (i.shot_list_id !== 'list-a' ? i
      : { ...i, position: { sc1: 1, sc2: 0, sh1: 1, sh2: 0 }[i.scene_id || i.shot_id] }))
    page({ ...two, shotListItems: items })
    const sort = screen.getByRole('combobox', { name: 'Sort' })
    expect([sort.value, sort.selectedOptions[0].textContent]).toEqual(['', 'List order'])
    // The scene table's own rows (an open nest's rows are its own table's).
    const sceneRows = () => [...sceneTable().querySelectorAll(':scope > tbody > tr.rb-scene-row > td > .rb-scene-check')].map((b) => b.getAttribute('aria-label').replace(/^Select /, ''))
    expect(sceneRows()).toEqual(['Cliff path', 'Lighthouse, dawn'])
    openScene('Lighthouse, dawn')
    const nest = () => rowOf('Lighthouse, dawn').nextElementSibling.querySelector('table')
    expect(rowNames(nest())).toEqual(['The cold lamp', 'The door'])
    fireEvent.change(sort, { target: { value: 'scene_number' } })
    expect(sceneRows()).toEqual(['Lighthouse, dawn', 'Cliff path'])
    expect(rowNames(nest())).toEqual(['The door', 'The cold lamp'])
  })

  it('in the Shots mode, grouped by scene, List order follows the list\'s scenes and shots', () => {
    remember('list-b')
    const two = TWO_LISTS()
    // Pickups, reordered: Harbour café before Lighthouse.
    const items = two.shotListItems.map((i) => (i.shot_list_id === 'list-b' && i.scene_id ? { ...i, position: i.scene_id === 'sc3' ? 0 : 1 } : i))
    page({ ...two, shotListItems: items })
    toShots()
    const bands = () => [...shotTable().querySelectorAll('tr.rb-scene-group-row .rb-scene-group-label')].map((l) => l.textContent)
    expect(bands()).toEqual(['Harbour café', 'Lighthouse, dawn'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'name' } })
    expect(bands()).toEqual(['Lighthouse, dawn', 'Harbour café'])
  })

  it('Move up / Move down, in each row\'s shot-list menu: a scene among the list\'s scenes, a shot among its scene\'s shots — the whole group\'s new order written', async () => {
    const { ctx } = page(TWO_LISTS())
    expect(openMore('Lighthouse, dawn')).toEqual([['Move up', true], ['Move down', false], ['Remove from this list', false]])
    fireEvent.click(menuItem('Move down'))
    await waitFor(() => expect(ctx.reorderShotListItems).toHaveBeenCalledTimes(1))
    expect(ctx.reorderShotListItems).toHaveBeenLastCalledWith('list-a', ['sc2', 'sc1'])
    expect(document.querySelector('.ui-menu')).toBeNull()
    openScene('Lighthouse, dawn')
    expect(openMore('The cold lamp')).toEqual([['Move up', false], ['Move down', true], ['Remove from this list', false]])
    fireEvent.click(menuItem('Move up'))
    await waitFor(() => expect(ctx.reorderShotListItems).toHaveBeenCalledTimes(2))
    expect(ctx.reorderShotListItems).toHaveBeenLastCalledWith('list-a', ['sh2', 'sh1'])
  })

  it('a move passes the neighbour on SCREEN: with Cliff path hidden by a search, Lighthouse moves down past Harbour café', async () => {
    const { ctx } = page(THREE_SCENES())
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'ou' } })
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Harbour café'])
    openMore('Lighthouse, dawn')
    fireEvent.click(menuItem('Move down'))
    await waitFor(() => expect(ctx.reorderShotListItems).toHaveBeenCalledTimes(1))
    expect(ctx.reorderShotListItems).toHaveBeenLastCalledWith('list-1', ['sc2', 'sc3', 'sc1'])
  })

  it('no move in any other sort, and none for a scene shown only because one of its shots is in the list', () => {
    page(TWO_LISTS())
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'name' } })
    // S3b step 6: the menu holds the removal alone — no move.
    expect(openMore('Lighthouse, dawn')).toEqual([['Remove from this list', false]])
    cleanup()
    // Pickups without Harbour café's own item: the scene is there for The kettle.
    remember('list-b')
    const two = TWO_LISTS()
    page({ ...two, shotListItems: two.shotListItems.filter((i) => i.scene_id !== 'sc3') })
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Harbour café'])
    expect(openMore('Harbour café')).toEqual([['Remove from this list', false]])
    fireEvent.keyDown(document, { key: 'Escape' })
    // …and it is never a neighbour: Lighthouse has nothing to move past.
    expect(openMore('Lighthouse, dawn')).toEqual([['Move up', true], ['Move down', true], ['Remove from this list', false]])
  })
})

/* ── post-overhaul S3b, step 3: the list bar (D7) ───────────────────────────
   One row between the tiles and the toolbar: what you are viewing on the
   left, the verbs on the right in the brief's order. */
const bar = () => document.querySelector('.ui-toolbar.rb-scene-lists')
/** The bar's controls, by name, in order (a greyed one by its own words). */
const barControls = () => [...bar().querySelectorAll('button')].map((b) => b.getAttribute('title') || b.textContent.trim())
/** The GatedAction wrapper a greyed control sits in, or null when it is live. */
const greyed = (words) => within(bar()).getByText(words).closest('[aria-disabled="true"]')
const barMenu = () => {
  fireEvent.click(within(bar()).getByRole('button', { name: 'More shot list actions' }))
  return [...document.querySelectorAll('.ui-menu .ui-menu-item')].map((b) => [b.querySelector('.ui-menu-item-label').textContent, b.disabled])
}
/** A seat on a staffed project (D8), not a workspace admin. */
const seat = (projectRole) => {
  perms.current = { role: 'user', ready: true, can: () => false, userId: 'u-1' }
  return { myProjectRole: projectRole, projectIsStaffed: true }
}
/** The snapshot a Save of `listId` would write now (S3a's own builder). */
const savedNow = (data, listId, savedAt = '2026-09-30T15:00:00.000Z') => buildShotListSnapshot({
  list: data.shotLists.find((l) => l.id === listId), scenes: data.scenes, shots: data.shots, items: data.shotListItems, savedAt,
})

describe('S3b step 3: the list bar', () => {
  it('sits between the tiles and the toolbar on the kit Toolbar, named "Shot list": the list on screen, its Active badge and its state; the brief\'s verbs in her order', () => {
    page()
    const b = bar()
    expect(b.previousElementSibling.classList.contains('rb-scene-stats')).toBe(true)
    expect(b.nextElementSibling.classList.contains('rb-scene-toolbar')).toBe(true)
    expect([b.getAttribute('role'), b.getAttribute('aria-label')]).toEqual(['group', 'Shot list'])
    expect(b.querySelector('.rb-scene-lists-eyebrow').textContent).toBe('Shot list')
    expect(b.querySelector('.rb-scene-lists-name').textContent).toBe('Shot list 1 · v1')
    // The summary on hover.
    expect(b.querySelector('.rb-scene-lists-name').getAttribute('title')).toBe('Created from existing scenes')
    expect(b.querySelector('.ui-status').getAttribute('data-status')).toBe('active')
    expect(b.querySelector('.rb-scene-lists-note').textContent).toBe('Never saved')
    // Set active is hidden on the active list; no button on the bar is filled.
    expect(barControls()).toEqual(['New shot list', 'Shot lists…', 'Save', 'Save as…', 'More shot list actions'])
    expect([...b.querySelectorAll('.ui-btn')].map((x) => x.getAttribute('data-variant'))).toEqual(['secondary', 'secondary', 'ghost', 'ghost'])
  })

  it('beside a list that is not the active one: no badge, "Active: Shoot · v1" shows that list, and Set active is offered', () => {
    remember('list-b')
    page(TWO_LISTS())
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Pickups · v1')
    expect(bar().querySelector('.ui-status')).toBeNull()
    expect(barControls()).toEqual(['Show the active list', 'New shot list', 'Shot lists…', 'Save', 'Save as…', 'Set active', 'More shot list actions'])
    fireEvent.click(within(bar()).getByRole('button', { name: 'Active: Shoot · v1' }))
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Shoot · v1')
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Cliff path'])
    // …and remembered: the next visit opens it.
    expect(JSON.parse(localStorage.getItem(VIEWED_LISTS_KEY))).toEqual({ 'local|p1': 'list-a' })
  })

  it('says whether the list has changed since its last Save — on the content, whatever order the stored keys came back in', () => {
    const two = TWO_LISTS()
    const snap = savedNow(two, 'list-a')
    // jsonb hands the keys back in its own order: reversed here.
    const reversed = JSON.parse(JSON.stringify(snap, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)))
    const saved = { ...two, shotLists: two.shotLists.map((l) => (l.id === 'list-a' ? { ...l, snapshot: reversed } : l)) }
    page(saved)
    expect(bar().querySelector('.rb-scene-lists-note').textContent).toBe(`Saved ${showDate('2026-09-30T15:00:00.000Z')}`)
    expect(bar().querySelector('.rb-scene-lists-note').getAttribute('data-state')).toBe('saved')
    // Saving an unchanged list would record the same point: greyed, and why.
    expect(greyed('Save').getAttribute('title')).toBe(`Nothing has changed since it was saved on ${showDate('2026-09-30T15:00:00.000Z')}.`)
    cleanup()
    // A shot renamed since (D3: the row is shared, so the list changed).
    page({ ...saved, shots: saved.shots.map((s) => (s.id === 'sh1' ? { ...s, name: 'The door, wide' } : s)) })
    expect(bar().querySelector('.rb-scene-lists-note').textContent).toBe('Not saved since changes')
    expect(greyed('Save')).toBeNull()
  })

  it('Save records a version point of the list on screen; a refusal is said in the Banner under the bar, word for word', async () => {
    const refusal = 'this shot list is archived — restore it before changing it'
    const { ctx } = page({ saveShotListSnapshot: vi.fn().mockResolvedValueOnce({ id: 'list-1' }).mockRejectedValueOnce(new Error(refusal)) })
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(ctx.saveShotListSnapshot).toHaveBeenCalledWith('list-1'))
    expect(document.querySelector('.ui-banner')).toBeNull()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save' }))
    const banner = await screen.findByRole('alert')
    expect([banner.classList.contains('ui-banner'), banner.getAttribute('data-tone'), banner.textContent]).toEqual([true, 'danger', refusal])
    expect(bar().nextElementSibling).toBe(banner)
    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('Set active asks first, Cancel focused — what every other tab will show — and only then makes the list active; a refusal stays in the question', async () => {
    remember('list-b')
    const refusal = 'only a project manager or a workspace admin can change the active shot list'
    const { ctx, rerender } = page({ ...TWO_LISTS(), setActiveShotList: vi.fn().mockRejectedValueOnce(new Error(refusal)).mockResolvedValue('list-b') })
    fireEvent.click(within(bar()).getByRole('button', { name: 'Set active' }))
    let dialog = screen.getByRole('dialog', { name: 'Make this the active list?' })
    expect(dialog.getAttribute('data-width')).toBe('confirm')
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(document.activeElement.textContent).toBe('Cancel')
    expect(dialog.textContent).toContain('“Pickups · v1” becomes the list the Timeline, Budget, Tasks, Assets, Bins and every other tab show.')
    // Audrey's rule of 2026-10-02: what the change of list does to the
    // Timeline and the Budget — nothing deleted, tasks read as not assigned.
    expect(dialog.textContent).toContain('Nothing on the Timeline or the Budget is deleted: a task on a scene or shot this list does not hold reads there as not assigned to it until it is in the active list.')
    expect(dialog.textContent).toContain('“Shoot · v1” is not changed, and can be made active again.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(ctx.setActiveShotList).not.toHaveBeenCalled()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Set active' }))
    dialog = screen.getByRole('dialog', { name: 'Make this the active list?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make active' }))
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe(refusal))
    expect(screen.getByRole('dialog', { name: 'Make this the active list?' })).toBe(dialog)
    // The provider puts a backend refusal in ctx.error too (optimistic()):
    // said in the question, it is not said again in the Banner.
    rabbit.current = { ...ctx, error: refusal }
    rerender(<ScenesView pageActive />)
    expect(document.querySelector('.ui-banner')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make active' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(ctx.setActiveShotList.mock.calls).toEqual([['list-b'], ['list-b']])
  })

  it('a member writes lists but may not make one active or archive it: both are greyed with the reason (D8); a reviewer the same', () => {
    for (const role of ['member', 'reviewer']) {
      // Their own memory: the seat signs in as u-1.
      remember('list-b', 'u-1')
      page({ ...TWO_LISTS(), ...seat(role) })
      expect(greyed('New shot list'), role).toBeNull()
      expect(greyed('Save as…'), role).toBeNull()
      expect(greyed('Set active').getAttribute('title'), role).toBe('Only a project manager or a workspace admin can make a shot list active or archive one.')
      expect(barMenu().find(([w]) => w === 'Archive'), role).toEqual(['Archive', true])
      cleanup()
      localStorage.clear()
    }
  })

  it('the More menu: Clear only on a list never Saved, Withdraw only where S3a says this person may, Archive for a manager — each asks first', async () => {
    remember('list-b')
    const { ctx } = page({ ...TWO_LISTS(), canWithdrawShotList: (id) => id === 'list-b' })
    expect(barMenu()).toEqual([['Add from another list…', false], ['New edit from this list', false], ['Edit details…', false], ['Clear this list', false], ['Withdraw', false], ['Archive', false]])
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Clear this list'))
    let dialog = screen.getByRole('dialog', { name: 'Clear this list?' })
    expect(dialog.textContent).toContain('Takes 2 scenes and 2 shots out of “Pickups · v1”. Nothing is deleted: each stays in the project and in any other list that holds it.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear list' }))
    await waitFor(() => expect(ctx.removeFromShotList).toHaveBeenCalledWith('list-b', { sceneIds: ['sc1', 'sc3'], shotIds: ['sh4', 'sh3'] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    barMenu()
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Withdraw'))
    dialog = screen.getByRole('dialog', { name: 'Withdraw this list?' })
    expect(document.activeElement.textContent).toBe('Cancel')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(ctx.withdrawShotList).toHaveBeenCalledWith('list-b'))
    barMenu()
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Archive'))
    // Only a list that is not the active one is archived: the question says
    // the Timeline and the Budget do not change (the rule of 2026-10-02).
    expect(screen.getByRole('dialog', { name: 'Archive this list?' }).querySelector('.ui-dialog-body').textContent)
      .toBe('“Pickups · v1” moves to Archived in Shot lists. Nothing in it is deleted, and a project manager or a workspace admin can restore it. It is not the active list, so nothing on the Timeline or the Budget changes.')
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Archive this list?' })).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(ctx.archiveShotList).toHaveBeenCalledWith('list-b', true))
    cleanup()
    localStorage.clear()
    // Saved: never cleared (D4). The active list: never archived, nor withdrawn.
    const two = TWO_LISTS()
    page({ ...two, shotLists: two.shotLists.map((l) => (l.id === 'list-a' ? { ...l, snapshot: savedNow(two, 'list-a') } : l)) })
    expect(barMenu()).toEqual([['Add from another list…', false], ['New edit from this list', false], ['Edit details…', false]])
  })

  it('"Recently removed": the list this person withdrew, with Open (read-only, "Withdrawn") and Restore; the mark ends when the tab mounts, unmounts, or R.A.B.B.I.T. leaves the screen', async () => {
    const two = TWO_LISTS()
    const withdrawn = { ...two.shotLists[1], created_by: 'u-1', archived_by: 'u-1', archived_at: '2026-10-01T09:00:00Z' }
    const recent = { kind: 'shot_list', id: 'list-b', row: withdrawn }
    const { ctx, rerender } = page({ ...two, shotLists: [two.shotLists[0], withdrawn], recentlyWithdrawn: recent, isWithdrawn: (r) => r.archived_by === r.created_by })
    expect(ctx.clearRecentlyWithdrawn).toHaveBeenCalledTimes(1)
    const line = bar().querySelector('.rb-scene-lists-recent')
    expect(line.querySelector('.rb-scene-lists-recent-words').textContent).toBe('Recently removed: Pickups · v1')
    fireEvent.click(within(line).getByRole('button', { name: 'Open' }))
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Pickups · v1')
    expect(bar().querySelector('.ui-status').textContent).toBe('Withdrawn')
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Harbour café'])
    // Read-only: no Save, no Set active; Save as… may start a new list from
    // it, and the More menu restores it. The mark's line is still there.
    expect(barControls()).toEqual(['Open', 'Restore', 'New shot list', 'Shot lists…', 'Save as…', 'More shot list actions'])
    fireEvent.click(within(line).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(ctx.restoreWithdrawn).toHaveBeenCalledTimes(1))
    // R.A.B.B.I.T. leaves the screen; then the tab unmounts.
    rerender(<ScenesView pageActive={false} />)
    expect(ctx.clearRecentlyWithdrawn).toHaveBeenCalledTimes(2)
    cleanup()
    expect(ctx.clearRecentlyWithdrawn).toHaveBeenCalledTimes(3)
  })

  it('an archived list on screen offers Restore by the seat\'s own route: a manager archives it back, its maker restores what they withdrew', async () => {
    const two = TWO_LISTS()
    const withdrawn = { ...two.shotLists[1], created_by: 'u-1', archived_by: 'u-1', archived_at: '2026-10-01T09:00:00Z' }
    const data = { ...two, shotLists: [two.shotLists[0], withdrawn], recentlyWithdrawn: { kind: 'shot_list', id: 'list-b', row: withdrawn } }
    let { ctx } = page(data)
    fireEvent.click(within(bar()).getByRole('button', { name: 'Open' }))
    expect(barMenu()).toEqual([['Restore', false]])
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Restore'))
    await waitFor(() => expect(ctx.archiveShotList).toHaveBeenCalledWith('list-b', false))
    cleanup()
    ;({ ctx } = page({ ...data, ...seat('member'), adapterMode: 'supabase' }))
    fireEvent.click(within(bar()).getByRole('button', { name: 'Open' }))
    fireEvent.click(within(bar()).getByRole('button', { name: 'More shot list actions' }))
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Restore'))
    await waitFor(() => expect(ctx.restoreWithdrawn).toHaveBeenCalledWith({ kind: 'shot_list', id: 'list-b' }))
    expect(ctx.archiveShotList).not.toHaveBeenCalled()
    cleanup()
    // Someone else's: nothing to offer this member.
    page({ ...data, ...seat('member'), adapterMode: 'supabase', shotLists: [two.shotLists[0], { ...withdrawn, created_by: 'u-9', archived_by: 'u-9' }] })
    fireEvent.click(within(bar()).getByRole('button', { name: 'Open' }))
    expect(within(bar()).queryByRole('button', { name: 'More shot list actions' })).toBeNull()
  })

  it('ctx.error that arrives while the tab is open is said in the Banner; the one it held before it opened is not', () => {
    const { ctx, rerender } = page({ error: 'an older failure on the Timeline' })
    expect(screen.queryByRole('alert')).toBeNull()
    rabbit.current = { ...ctx, error: 'you cannot change this shot list' }
    rerender(<ScenesView pageActive />)
    expect(screen.getByRole('alert').textContent).toBe('you cannot change this shot list')
  })

  it('a project with no list at all reads as today: every scene and shot, "No shot list yet", and only New shot list and Shot lists… on the bar', () => {
    page({ shotLists: [], shotListItems: [], activeListId: null })
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Cliff path'])
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('No shot list yet')
    expect(bar().querySelector('.rb-scene-lists-name').getAttribute('data-tone')).toBe('quiet')
    expect(barControls()).toEqual(['New shot list', 'Shot lists…'])
    expect(screen.getByRole('combobox', { name: 'Sort' }).selectedOptions[0].textContent).toBe('Sort…')
    expect(screen.queryByRole('button', { name: /^Shot list actions for/ })).toBeNull()
  })
})

/* ── post-overhaul S3b, step 4: "Shot lists…", the picker ───────────────────
   The kit Dialog at the reading width with a kit Table: Active · Title ·
   Version · Created · Summary · actions, newest first; select, then Open. */
const openPicker = () => {
  fireEvent.click(within(bar()).getByRole('button', { name: 'Shot lists…' }))
  return screen.getByRole('dialog', { name: /shot lists$/i })
}
/** The picker's rows: [mark, title, version, created, summary]. */
const pickerRows = (dialog) => [...dialog.querySelectorAll('tbody > tr')].map((tr) => [...tr.querySelectorAll('td')].slice(0, 5).map((td) => td.textContent.trim()))
const pickerRow = (dialog, title) => within(dialog).getByRole('button', { name: title }).closest('tr')
/** TWO_LISTS with Harbour café's twin, scene 4, in no list at all. */
const WITH_UNLISTED = () => {
  const two = TWO_LISTS()
  return { ...two, scenes: [...two.scenes, { id: 'sc4', name: 'The jetty', scene_number: 4, status: 'not_started', type: 'exterior' }] }
}

describe('S3b step 4: the picker', () => {
  it('the kit Dialog at the reading width in <body>, its table newest first: the active list badged, dates by dates.js; the list on screen selected, its title focused', () => {
    remember('list-b')
    page(TWO_LISTS())
    const dialog = openPicker()
    expect([dialog.getAttribute('data-width'), dialog.closest('.ui-dialog-backdrop').parentElement]).toEqual(['reading', document.body])
    expect(dialog.querySelector('.ui-dialog-title').textContent).toBe('Shot lists')
    const heads = [...dialog.querySelectorAll('thead th')].map(visibleLabel)
    expect(heads).toEqual(['', 'Title', 'Version', 'Created', 'Summary', ''])
    expect([...dialog.querySelectorAll('thead th .sr-only')].map((s) => s.textContent)).toEqual(['Active', 'Actions'])
    expect(pickerRows(dialog)).toEqual([
      ['', 'Pickups', 'v1', showDate('2026-09-30T12:00:00Z'), 'Second unit'],
      ['Active', 'Shoot', 'v1', showDate('2026-09-30T10:00:00Z'), 'The main unit'],
    ])
    expect(pickerRow(dialog, 'Pickups').getAttribute('data-selected')).toBe('true')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Pickups' }))
    // The footer: New shot list… on the left, then Cancel and Open.
    expect([...dialog.querySelectorAll('.ui-dialog-foot button')].map((b) => b.textContent)).toEqual(['New shot list…', 'Cancel', 'Open'])
  })

  it('a click selects a row; Open shows it in the tab (and remembers it); a double-click, or Enter on its title, opens at once; Cancel and Escape change nothing', () => {
    page(TWO_LISTS())
    let dialog = openPicker()
    fireEvent.click(pickerRow(dialog, 'Pickups'))
    expect(pickerRow(dialog, 'Pickups').getAttribute('data-selected')).toBe('true')
    expect(pickerRow(dialog, 'Shoot').getAttribute('data-selected')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Shoot · v1')
    dialog = openPicker()
    fireEvent.click(pickerRow(dialog, 'Pickups'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Pickups · v1')
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Harbour café'])
    expect(JSON.parse(localStorage.getItem(VIEWED_LISTS_KEY))).toEqual({ 'local|p1': 'list-b' })
    dialog = openPicker()
    fireEvent.doubleClick(pickerRow(dialog, 'Shoot'))
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Shoot · v1')
    dialog = openPicker()
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Pickups' }), { key: 'Enter' })
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Pickups · v1')
    openPicker()
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a row\'s actions by seat (D8): a manager sets active and archives; a member sees both greyed, "managers only"; a list never Saved can be cleared; the active one is neither archived nor made active again', () => {
    page({ ...TWO_LISTS(), canWithdrawShotList: (id) => id === 'list-b' })
    let dialog = openPicker()
    const rowMenu = (title) => {
      fireEvent.click(within(pickerRow(dialog, title)).getByRole('button', { name: `Actions for ${title} · v1` }))
      const out = [...document.querySelectorAll('.ui-menu .ui-menu-item')].map((b) => [b.querySelector('.ui-menu-item-label').textContent, b.disabled])
      fireEvent.keyDown(document, { key: 'Escape' })
      return out
    }
    expect(rowMenu('Pickups')).toEqual([['Set active', false], ['Edit details…', false], ['Clear this list', false], ['Withdraw', false], ['Archive', false]])
    // The active list, never Saved, can be cleared (D4). Review round 1
    // (R1-08) took Clear off it; round 2 (R2-07) put it back — that
    // narrowed Audrey's ruling — and its question says what it does to the
    // other tabs (the R2-07 test below).
    expect(rowMenu('Shoot')).toEqual([['Edit details…', false], ['Clear this list', false]])
    // The menu's Escape is the menu's: the picker stays.
    expect(screen.getByRole('dialog', { name: 'Shot lists' })).toBe(dialog)
    cleanup()
    page({ ...TWO_LISTS(), ...seat('member') })
    dialog = openPicker()
    expect(rowMenu('Pickups')).toEqual([['Set active', true], ['Edit details…', false], ['Clear this list', false], ['Archive', true]])
  })

  it('Set active from a row asks over the picker, and the picker stays to show the change', async () => {
    const { ctx } = page(TWO_LISTS())
    const dialog = openPicker()
    fireEvent.click(within(pickerRow(dialog, 'Pickups')).getByRole('button', { name: 'Actions for Pickups · v1' }))
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Set active'))
    const question = screen.getByRole('dialog', { name: 'Make this the active list?' })
    expect(after(dialog.closest('.ui-dialog-backdrop'), question)).toBe(true)
    expect(question.textContent).toContain('“Pickups · v1” becomes the list')
    fireEvent.click(within(question).getByRole('button', { name: 'Make active' }))
    await waitFor(() => expect(ctx.setActiveShotList).toHaveBeenCalledWith('list-b'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Make this the active list?' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Shot lists' })).toBe(dialog)
  })

  // S3c review round 1 (R1-01): Archive and Withdraw were offered on a list
  // with an unsaved edit, and said nothing of it (Withdraw even said nobody
  // had started an edit on it). The edit is kept, dormant, until the list is
  // restored; the questions say so.
  it('S3c R1-01: Archive and Withdraw on a list with an unsaved edit say it is kept, off screen, until the list is restored', () => {
    const draft = { listId: 'list-b', title: 'Pickups cut', version: 1, items: [] }
    const extra = { canWithdrawShotList: (id) => id === 'list-b', editDraftOf: (id) => (id === 'list-b' ? draft : null) }
    page({ ...TWO_LISTS(), ...extra })
    let dialog = openPicker()
    fireEvent.click(within(pickerRow(dialog, 'Pickups')).getByRole('button', { name: 'Actions for Pickups · v1' }))
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Archive'))
    expect(screen.getByRole('dialog', { name: 'Archive this list?' }).querySelector('.ui-dialog-body').textContent)
      .toMatch(/ Its unsaved edit, “Pickups cut · v1”, is kept as it is, off screen: restore the list to go back to it\.$/)
    cleanup()
    page({ ...TWO_LISTS(), ...extra })
    dialog = openPicker()
    fireEvent.click(within(pickerRow(dialog, 'Pickups')).getByRole('button', { name: 'Actions for Pickups · v1' }))
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Withdraw'))
    const words = screen.getByRole('dialog', { name: 'Withdraw this list?' }).querySelector('.ui-dialog-body').textContent
    expect(words).toMatch(/^Nobody has saved “Pickups · v1” or saved an edit of it, so it can be taken back\./)
    expect(words).toMatch(/ Its unsaved edit, “Pickups cut · v1”, is kept as it is, off screen: restore the list to go back to it\.$/)
    cleanup()
    // CONTROL: without an unsaved edit, nothing is said of one.
    page({ ...TWO_LISTS(), canWithdrawShotList: (id) => id === 'list-b' })
    dialog = openPicker()
    fireEvent.click(within(pickerRow(dialog, 'Pickups')).getByRole('button', { name: 'Actions for Pickups · v1' }))
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Archive'))
    expect(screen.getByRole('dialog', { name: 'Archive this list?' }).textContent).not.toContain('unsaved edit')
  })

  it('"Not in any list (N)" — only while there are such rows and a list to compare them with — selects and opens like a list: the tab shows those rows', () => {
    page(WITH_UNLISTED())
    const dialog = openPicker()
    const entry = within(dialog).getByRole('button', { name: /^Not in any list/ })
    expect(entry.textContent).toBe('Not in any list (1)1 scene · 0 shots no list holds')
    // Just above "Archived…", after the lists and a hairline (Audrey, 2026-09-30).
    expect(entry.closest('.rb-scene-lists-more')).toBeTruthy()
    fireEvent.click(entry)
    expect(entry.getAttribute('data-selected')).toBe('true')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Not in any list')
    expect(rowNames(sceneTable())).toEqual(['The jetty'])
    // Not a list: never remembered.
    expect(localStorage.getItem(VIEWED_LISTS_KEY)).toBeNull()
    cleanup()
    page(TWO_LISTS())
    expect(within(openPicker()).queryByRole('button', { name: /^Not in any list/ })).toBeNull()
    cleanup()
    // No list at all: every row is "unlisted", and the tab already shows them all.
    page({ ...WITH_UNLISTED(), shotLists: [], shotListItems: [], activeListId: null })
    const empty = openPicker()
    expect(within(empty).queryByRole('button', { name: /^Not in any list/ })).toBeNull()
    expect(empty.querySelector('.ui-empty-title').textContent).toBe('No shot lists yet')
  })

  it('"Archived…" is the same table over the archived and withdrawn lists: Restore for whoever may, Open shows one read-only, and back to all lists', async () => {
    const two = TWO_LISTS()
    const archived = { ...two.shotLists[1], archived_at: '2026-10-01T09:00:00Z', archived_by: 'u-9', created_by: 'u-1' }
    const { ctx } = page({ ...two, shotLists: [two.shotLists[0], archived], isWithdrawn: (r) => r.archived_by === r.created_by })
    let dialog = openPicker()
    expect(pickerRows(dialog).map((r) => r[1])).toEqual(['Shoot'])
    fireEvent.click(within(dialog).getByRole('button', { name: /^Archived…/ }))
    expect(dialog.querySelector('.ui-dialog-title').textContent).toBe('Archived shot lists')
    expect(pickerRows(dialog)).toEqual([['Archived', 'Pickups', 'v1', showDate('2026-09-30T12:00:00Z'), 'Second unit']])
    fireEvent.click(within(pickerRow(dialog, 'Pickups')).getByRole('button', { name: 'Restore “Pickups · v1”' }))
    await waitFor(() => expect(ctx.archiveShotList).toHaveBeenCalledWith('list-b', false))
    fireEvent.click(pickerRow(dialog, 'Pickups'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bar().querySelector('.ui-status').textContent).toBe('Archived')
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Harbour café'])
    dialog = openPicker()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Archived…/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'All shot lists' }))
    expect(dialog.querySelector('.ui-dialog-title').textContent).toBe('Shot lists')
  })

  it('a Restore the backend refuses is said in the picker\'s own error slot, word for word', async () => {
    const two = TWO_LISTS()
    const archived = { ...two.shotLists[1], archived_at: '2026-10-01T09:00:00Z', archived_by: 'u-9' }
    const refusal = 'only a project manager or a workspace admin can archive or restore a shot list'
    page({ ...two, shotLists: [two.shotLists[0], archived], archiveShotList: vi.fn().mockRejectedValue(new Error(refusal)) })
    const dialog = openPicker()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Archived…/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore “Pickups · v1”' }))
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe(refusal))
    expect(document.querySelector('.ui-banner')).toBeNull()
  })

  it('"Recently removed" heads the picker with Open and Restore', async () => {
    const two = TWO_LISTS()
    const withdrawn = { ...two.shotLists[1], created_by: 'u-1', archived_by: 'u-1', archived_at: '2026-10-01T09:00:00Z' }
    const { ctx, rerender } = page({ ...two, shotLists: [two.shotLists[0], withdrawn], recentlyWithdrawn: { kind: 'shot_list', id: 'list-b', row: withdrawn } })
    const dialog = openPicker()
    const line = dialog.querySelector('.rb-scene-lists-recent-row')
    expect(line.querySelector('.rb-scene-lists-recent-words').textContent).toBe('Recently removed: Pickups · v1')
    fireEvent.click(within(line).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(ctx.restoreWithdrawn).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // The restored list is the one to show: remembered now, on screen as soon
    // as the provider has it live again (the mark ends with it).
    expect(JSON.parse(localStorage.getItem(VIEWED_LISTS_KEY))).toEqual({ 'local|p1': 'list-b' })
    rabbit.current = { ...ctx, shotLists: [two.shotLists[0], { ...withdrawn, archived_at: null, archived_by: null }], recentlyWithdrawn: null }
    rerender(<ScenesView pageActive />)
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Pickups · v1')
  })
})

/* ── post-overhaul S3b, step 5: New shot list, Save as…, Edit details ───────
   One kit Dialog at the form width: Title, "Same title, next version" (D14),
   Summary, and — for a new list — Start from (linked, not copied, D1 + D3). */
const formDialog = (name) => screen.getByRole('dialog', { name })
const titleField = (dialog) => within(dialog).getByRole('textbox', { name: 'Title' })
const takes = (dialog) => dialog.querySelector('.rb-scene-listform-takes')
const create = (dialog, verb) => within(dialog).getByRole('button', { name: verb })

describe('S3b step 5: New shot list, Save as…, Edit details', () => {
  it('New shot list: the kit Dialog at the form width, its title the list on screen\'s, selected; off the toggle, a taken "Title · v1" is refused before anything is sent', async () => {
    const { ctx } = page(TWO_LISTS())
    fireEvent.click(within(bar()).getByRole('button', { name: 'New shot list' }))
    const dialog = formDialog('New shot list')
    expect([dialog.getAttribute('data-width'), dialog.closest('.ui-dialog-backdrop').parentElement]).toEqual(['form', document.body])
    const title = titleField(dialog)
    expect([title.value, document.activeElement]).toEqual(['Shoot', title])
    expect(within(dialog).getByRole('switch', { name: 'Same title, next version' }).getAttribute('aria-checked')).toBe('false')
    // Off: a title of its own at v1 — and "Shoot · v1" is taken. Untouched,
    // the form says what to do; it does not open on a refusal.
    expect([takes(dialog).textContent, takes(dialog).getAttribute('data-state')])
      .toEqual(['Type a new title, or turn on “Same title, next version” for “Shoot · v2”.', 'hint'])
    expect(create(dialog, 'Create shot list').disabled).toBe(true)
    // Touched (the same title, as typed): the model's refusal, in its words.
    fireEvent.change(title, { target: { value: 'Shoot ' } })
    expect([takes(dialog).textContent, takes(dialog).getAttribute('data-state')])
      .toEqual(['There is already a shot list called "Shoot · v1".', 'refused'])
    fireEvent.change(title, { target: { value: 'Night exteriors' } })
    expect(takes(dialog).textContent).toBe('Will be “Night exteriors · v1”')
    // Start from: the list on screen by default — linked, not copied.
    const from = within(dialog).getByRole('radio', { name: /^The list on screen/ })
    expect(from.checked).toBe(true)
    expect(from.closest('label').textContent).toContain('“Shoot · v1”: 2 scenes and 2 shots, linked — not copied')
    expect(dialog.querySelector('.rb-scene-listform-shared').textContent).toMatch(/^A scene or shot is one row in every list that holds it/)
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Summary' }), { target: { value: '  Second unit, nights  ' } })
    fireEvent.click(create(dialog, 'Create shot list'))
    await waitFor(() => expect(ctx.addShotList).toHaveBeenCalledWith({ title: 'Night exteriors', version: 1, summary: 'Second unit, nights', from: 'list-a' }))
    // One undo step; not made active — the project has an active list.
    expect(ctx.runBatch).toHaveBeenCalledTimes(1)
    expect(ctx.setActiveShotList).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // The new list is the one on screen (remembered).
    expect(JSON.parse(localStorage.getItem(VIEWED_LISTS_KEY))).toEqual({ 'local|p1': 'list-new' })
  })

  it('"Same title, next version" on: the title is the list\'s, the version the next free one; every scene and shot, or empty, are the other starts', async () => {
    const { ctx } = page(TWO_LISTS())
    fireEvent.click(within(bar()).getByRole('button', { name: 'New shot list' }))
    const dialog = formDialog('New shot list')
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Same title, next version' }))
    expect(titleField(dialog).disabled).toBe(true)
    expect(takes(dialog).textContent).toBe('Will be “Shoot · v2”')
    fireEvent.click(within(dialog).getByRole('radio', { name: /^Every scene and shot in this project/ }))
    expect(within(dialog).getByRole('radio', { name: /^Every scene and shot/ }).closest('label').textContent).toContain('3 scenes and 4 shots, in number order')
    fireEvent.click(create(dialog, 'Create shot list'))
    await waitFor(() => expect(ctx.addShotList).toHaveBeenCalledWith({ title: 'Shoot', version: 2, summary: null, fromAll: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(within(bar()).getByRole('button', { name: 'New shot list' }))
    const second = formDialog('New shot list')
    fireEvent.change(titleField(second), { target: { value: 'Scratch' } })
    fireEvent.click(within(second).getByRole('radio', { name: /^Empty/ }))
    fireEvent.click(create(second, 'Create shot list'))
    await waitFor(() => expect(ctx.addShotList).toHaveBeenLastCalledWith({ title: 'Scratch', version: 1, summary: null }))
  })

  it('Save as…: the same dialog, fixed to the list on screen with the toggle on — a new version of it, linked', async () => {
    const { ctx } = page(TWO_LISTS())
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save as…' }))
    const dialog = formDialog('Save as a new version')
    expect(dialog.querySelector('.ui-dialog-subtitle').textContent).toBe('A new list from “Shoot · v1”: the same scenes and shots, linked — not copied.')
    expect(within(dialog).getByRole('switch', { name: 'Same title, next version' }).getAttribute('aria-checked')).toBe('true')
    expect(within(dialog).queryByRole('radio')).toBeNull()
    expect(within(dialog).getByRole('textbox', { name: 'Summary' }).value).toBe('The main unit')
    expect(takes(dialog).textContent).toBe('Will be “Shoot · v2”')
    fireEvent.click(create(dialog, 'Save new version'))
    await waitFor(() => expect(ctx.addShotList).toHaveBeenCalledWith({ title: 'Shoot', version: 2, summary: 'The main unit', from: 'list-a' }))
  })

  it('the first list of a project: "Shot list 1" from every scene and shot, made active in the same step when this person may; for a member it is not', async () => {
    const probe = batchProbe()
    let { ctx } = page({
      shotLists: [], shotListItems: [], activeListId: null,
      runBatch: probe.runBatch,
      addShotList: probe.mark('addShotList', (opts) => ({ ...LIST_1, id: 'list-new', title: opts?.title, version: opts?.version ?? 1, summary: opts?.summary ?? null })),
      setActiveShotList: probe.mark('setActiveShotList', (id) => id),
    })
    fireEvent.click(within(bar()).getByRole('button', { name: 'New shot list' }))
    let dialog = formDialog('New shot list')
    expect(titleField(dialog).value).toBe('Shot list 1')
    expect(within(dialog).getByRole('radio', { name: /^The list on screen/ }).disabled).toBe(true)
    expect(within(dialog).getByRole('radio', { name: /^Every scene and shot/ }).checked).toBe(true)
    fireEvent.click(create(dialog, 'Create shot list'))
    await waitFor(() => expect(ctx.setActiveShotList).toHaveBeenCalledWith('list-new'))
    expect(ctx.addShotList).toHaveBeenCalledWith({ title: 'Shot list 1', version: 1, summary: null, fromAll: true })
    // Both inside the one batch: one Ctrl+Z takes back the activation, then
    // the list (review round 1, R1-11: the count alone passed with the
    // activation moved out of the batch).
    await waitFor(() => expect(probe.calls).toEqual([['addShotList', true], ['setActiveShotList', true]]))
    expect(ctx.runBatch).toHaveBeenCalledTimes(1)
    cleanup()
    ;({ ctx } = page({ shotLists: [], shotListItems: [], activeListId: null, ...seat('member') }))
    fireEvent.click(within(bar()).getByRole('button', { name: 'New shot list' }))
    dialog = formDialog('New shot list')
    fireEvent.click(create(dialog, 'Create shot list'))
    await waitFor(() => expect(ctx.addShotList).toHaveBeenCalledTimes(1))
    expect(ctx.setActiveShotList).not.toHaveBeenCalled()
  })

  it('a refusal from the backend stays in the dialog, word for word; an activation refused after the list is made is said in the Banner, the list kept', async () => {
    const refusal = 'There is already a shot list with this title and version.'
    let { ctx } = page({ ...TWO_LISTS(), addShotList: vi.fn().mockRejectedValue(new Error(refusal)) })
    fireEvent.click(within(bar()).getByRole('button', { name: 'New shot list' }))
    let dialog = formDialog('New shot list')
    fireEvent.change(titleField(dialog), { target: { value: 'Night exteriors' } })
    fireEvent.click(create(dialog, 'Create shot list'))
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe(refusal))
    expect(formDialog('New shot list')).toBe(dialog)
    cleanup()
    const seated = 'only a project manager or a workspace admin can change the active shot list'
    ;({ ctx } = page({ shotLists: [], shotListItems: [], activeListId: null, setActiveShotList: vi.fn().mockRejectedValue(new Error(seated)) }))
    fireEvent.click(within(bar()).getByRole('button', { name: 'New shot list' }))
    fireEvent.click(create(formDialog('New shot list'), 'Create shot list'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(ctx.addShotList).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toBe(`“Shot list 1 · v1” was made, but not made active: ${seated}`)
  })

  // Review round 1 (R1-11): this said "✕ … or the backdrop" and tested
  // neither; the backdrop does nothing (the kit form's default).
  it('Escape, ✕ and Cancel ask before a changed form is dropped — Cancel focused; a press on the backdrop does nothing; an untouched one closes at once', () => {
    page(TWO_LISTS())
    fireEvent.click(within(bar()).getByRole('button', { name: 'New shot list' }))
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(bar()).getByRole('button', { name: 'New shot list' }))
    const dialog = formDialog('New shot list')
    fireEvent.change(titleField(dialog), { target: { value: 'Night exteriors' } })
    // Escape from the title field: the plain well does not swallow it.
    fireEvent.keyDown(titleField(dialog), { key: 'Escape' })
    let ask = screen.getByRole('dialog', { name: 'Discard this new shot list?' })
    expect([ask.getAttribute('data-width'), document.activeElement.textContent]).toEqual(['confirm', 'Cancel'])
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(formDialog('New shot list')).toBe(dialog)
    expect(titleField(dialog).value).toBe('Night exteriors')
    // The ✕ asks too.
    fireEvent.click(within(dialog.querySelector('.ui-dialog-head')).getByRole('button', { name: 'Close' }))
    ask = screen.getByRole('dialog', { name: 'Discard this new shot list?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(formDialog('New shot list')).toBe(dialog)
    // A press on the backdrop: nothing — no question, the form and its words stay.
    fireEvent.mouseDown(dialog.closest('.ui-dialog-backdrop'))
    expect(screen.queryByRole('dialog', { name: 'Discard this new shot list?' })).toBeNull()
    expect([formDialog('New shot list'), titleField(dialog).value]).toEqual([dialog, 'Night exteriors'])
    fireEvent.click(within(dialog.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Cancel' }))
    ask = screen.getByRole('dialog', { name: 'Discard this new shot list?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Discard' }))
    return waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Edit details… (the bar\'s menu, a picker row\'s): title and summary, no toggle, no start — and only what changed is sent', async () => {
    const { ctx } = page(TWO_LISTS())
    fireEvent.click(within(bar()).getByRole('button', { name: 'More shot list actions' }))
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Edit details…'))
    let dialog = formDialog('Edit details')
    expect(dialog.querySelector('.ui-dialog-subtitle').textContent).toBe('Of “Shoot · v1”. Its scenes and shots are not changed.')
    expect(within(dialog).queryByRole('switch')).toBeNull()
    expect(within(dialog).queryByRole('radio')).toBeNull()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Summary' }), { target: { value: 'Main unit, days' } })
    fireEvent.click(create(dialog, 'Save details'))
    await waitFor(() => expect(ctx.updateShotList).toHaveBeenCalledWith('list-a', { summary: 'Main unit, days' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // From the picker, a rename onto a taken "Title · vN" is refused before anything is sent.
    const picker = openPicker()
    fireEvent.click(within(pickerRow(picker, 'Pickups')).getByRole('button', { name: 'Actions for Pickups · v1' }))
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Edit details…'))
    dialog = formDialog('Edit details')
    fireEvent.change(titleField(dialog), { target: { value: 'Shoot' } })
    expect(takes(dialog).textContent).toBe('There is already a shot list called "Shoot · v1".')
    expect(create(dialog, 'Save details').disabled).toBe(true)
    fireEvent.change(titleField(dialog), { target: { value: 'Pickups, nights' } })
    fireEvent.click(create(dialog, 'Save details'))
    await waitFor(() => expect(ctx.updateShotList).toHaveBeenLastCalledWith('list-b', { title: 'Pickups, nights' }))
  })
})

/* ── post-overhaul S3b, step 6: the membership verbs ────────────────────────
   A scene or shot is ONE row many lists may hold (D1 + D3). Remove from this
   list takes it out of the list on screen and deletes nothing; Delete takes
   it out of the project and so out of every list. Each question says which,
   and names the lists. Add from another list… links rows in; a name's title
   lists its lists (D10, live lists only). */
const removeDialog = () => screen.getByRole('dialog', { name: 'Remove from this list?' })
const bulkBarOf = (cls = '.rb-scene-bulk') => document.querySelector(cls)
/** The words of a question, without its title and buttons. */
const askWords = (dialog) => dialog.querySelector('.ui-dialog-body').textContent

describe('S3b step 6: Remove from this list', () => {
  it('asks first on the kit Dialog in <body>, Cancel focused, and names the lists that keep the scene; then takes it — and its shots — out of THIS list only: nothing is deleted', async () => {
    const { ctx } = page(TWO_LISTS())
    expect(openMore('Lighthouse, dawn').map(([w]) => w)).toEqual(['Move up', 'Move down', 'Remove from this list'])
    fireEvent.click(menuItem('Remove from this list'))
    const dialog = removeDialog()
    expect([dialog.getAttribute('data-width'), dialog.closest('.ui-dialog-backdrop').parentElement]).toEqual(['confirm', document.body])
    expect(document.activeElement.textContent).toBe('Cancel')
    // Review round 1 (R1-08): Pickups holds the scene but neither of these
    // shots, and Shoot is the active list — both said.
    expect(askWords(dialog)).toBe('Takes “Lighthouse, dawn” and its 2 shots out of “Shoot · v1”. Nothing is deleted: it stays in the project. It is still in “Pickups · v1”. Its 2 shots are in no other shot list, so Shot lists… will show them under “Not in any list”. This is the active list, so the other tabs stop showing it. Nothing on the Timeline or the Budget is deleted: a task on it reads there as not assigned to it until it is in the active list again.')
    // The verb says what it does; it is not Delete.
    expect([...dialog.querySelectorAll('.ui-dialog-foot button')].map((b) => b.textContent)).toEqual(['Cancel', 'Remove from list'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.removeFromShotList).not.toHaveBeenCalled()
    openMore('Lighthouse, dawn')
    fireEvent.click(menuItem('Remove from this list'))
    fireEvent.click(within(removeDialog()).getByRole('button', { name: 'Remove from list' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(ctx.removeFromShotList.mock.calls).toEqual([['list-a', { sceneIds: ['sc1'] }]])
    expect(ctx.deleteScene).not.toHaveBeenCalled()
    expect(ctx.deleteShot).not.toHaveBeenCalled()
  })

  it('a row no other list holds: the question says where it will be found — "Not in any list" — and a shot is named as one', async () => {
    const { ctx } = page(TWO_LISTS())
    openMore('Cliff path')
    fireEvent.click(menuItem('Remove from this list'))
    expect(askWords(removeDialog())).toBe('Takes “Cliff path” out of “Shoot · v1”. Nothing is deleted: it stays in the project. No other shot list holds it, so Shot lists… will show it under “Not in any list”. This is the active list, so the other tabs stop showing it. Nothing on the Timeline or the Budget is deleted: a task on it reads there as not assigned to it until it is in the active list again.')
    fireEvent.click(within(removeDialog()).getByRole('button', { name: 'Cancel' }))
    openScene('Lighthouse, dawn')
    openMore('The door')
    fireEvent.click(menuItem('Remove from this list'))
    expect(askWords(removeDialog())).toBe('Takes shot “The door” out of “Shoot · v1”. Nothing is deleted: it stays in the project. No other shot list holds it, so Shot lists… will show it under “Not in any list”. This is the active list, so the other tabs stop showing it. Nothing on the Timeline or the Budget is deleted: a task on it reads there as not assigned to it until it is in the active list again.')
    fireEvent.click(within(removeDialog()).getByRole('button', { name: 'Remove from list' }))
    await waitFor(() => expect(ctx.removeFromShotList).toHaveBeenCalledWith('list-a', { shotIds: ['sh1'] }))
  })

  it('every bulk bar has "Remove from list" beside Delete, not in the danger ink: the same question for the selection, which clears once the rows are out', async () => {
    const { ctx } = page(TWO_LISTS())
    fireEvent.click(screen.getByRole('button', { name: 'Select Lighthouse, dawn' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select Cliff path' }))
    const verbs = [...bulkBarOf().querySelectorAll('.ui-btn')].map((b) => [b.textContent, b.getAttribute('data-variant')])
    expect(verbs).toEqual([['Remove from list', 'secondary'], ['Delete', 'danger']])
    fireEvent.click(within(bulkBarOf()).getByRole('button', { name: 'Remove from list' }))
    expect(askWords(removeDialog())).toBe('Takes 2 scenes and their 2 shots out of “Shoot · v1”. Nothing is deleted: they stay in the project. 1 of them is in no other shot list, so Shot lists… will show it under “Not in any list”. The other one is still in “Pickups · v1”. Their 2 shots are in no other shot list, so Shot lists… will show them under “Not in any list”. This is the active list, so the other tabs stop showing them. Nothing on the Timeline or the Budget is deleted: a task on them reads there as not assigned to them until they are in the active list again.')
    fireEvent.click(within(removeDialog()).getByRole('button', { name: 'Remove from list' }))
    await waitFor(() => expect(bulkBarOf()).toBeNull())
    expect(ctx.removeFromShotList.mock.calls).toEqual([['list-a', { sceneIds: ['sc1', 'sc2'] }]])
    // The nested shots' bar.
    openScene('Lighthouse, dawn')
    fireEvent.click(screen.getByRole('button', { name: 'Select The door' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select The cold lamp' }))
    fireEvent.click(within(bulkBarOf('.rb-scene-nest-bulk')).getByRole('button', { name: 'Remove from list' }))
    expect(askWords(removeDialog())).toBe('Takes 2 shots out of “Shoot · v1”. Nothing is deleted: they stay in the project. No other shot list holds them, so Shot lists… will show them under “Not in any list”. This is the active list, so the other tabs stop showing them. Nothing on the Timeline or the Budget is deleted: a task on them reads there as not assigned to them until they are in the active list again.')
    fireEvent.click(within(removeDialog()).getByRole('button', { name: 'Remove from list' }))
    await waitFor(() => expect(bulkBarOf('.rb-scene-nest-bulk')).toBeNull())
    expect(ctx.removeFromShotList).toHaveBeenLastCalledWith('list-a', { shotIds: ['sh1', 'sh2'] })
    // The shot table's.
    toShots()
    fireEvent.click(screen.getByRole('button', { name: 'Select The cold lamp' }))
    fireEvent.click(within(bulkBarOf()).getByRole('button', { name: 'Remove from list' }))
    fireEvent.click(within(removeDialog()).getByRole('button', { name: 'Remove from list' }))
    await waitFor(() => expect(ctx.removeFromShotList).toHaveBeenLastCalledWith('list-a', { shotIds: ['sh2'] }))
    expect(ctx.deleteShot).not.toHaveBeenCalled()
  })

  it('a refusal stays in the question, word for word, and the selection with it; the Banner does not say it again', async () => {
    const refusal = 'this shot list is archived — restore it before changing it'
    const { ctx, rerender } = page({ ...TWO_LISTS(), removeFromShotList: vi.fn().mockRejectedValue(new Error(refusal)) })
    fireEvent.click(screen.getByRole('button', { name: 'Select Cliff path' }))
    fireEvent.click(within(bulkBarOf()).getByRole('button', { name: 'Remove from list' }))
    const dialog = removeDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from list' }))
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe(refusal))
    expect(removeDialog()).toBe(dialog)
    rabbit.current = { ...ctx, error: refusal }
    rerender(<ScenesView pageActive />)
    expect(document.querySelector('.ui-banner')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(rowOf('Cliff path').getAttribute('data-selected')).toBe('true')
  })

  it('offered only on a live list this person may change: not on an archived list (read-only), not without a list seat; "Not in any list" offers Add to list instead', async () => {
    // A staffed project and no seat on it: no list verbs on a row or a selection.
    page({ ...TWO_LISTS(), ...seat(null) })
    expect(screen.queryByRole('button', { name: 'Shot list actions for Lighthouse, dawn' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Select Lighthouse, dawn' }))
    expect(within(bulkBarOf()).queryByRole('button', { name: 'Remove from list' })).toBeNull()
    cleanup()
    perms.current = null
    // An archived list, opened from the picker: read, not changed.
    const two = TWO_LISTS()
    page({ ...two, shotLists: [two.shotLists[0], { ...two.shotLists[1], archived_at: '2026-10-01T09:00:00Z', archived_by: 'u-9' }] })
    const picker = openPicker()
    fireEvent.click(within(picker).getByRole('button', { name: /^Archived…/ }))
    fireEvent.doubleClick(pickerRow(screen.getByRole('dialog'), 'Pickups'))
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Pickups · v1')
    expect(screen.queryByRole('button', { name: 'Shot list actions for Lighthouse, dawn' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Select Lighthouse, dawn' }))
    expect(within(bulkBarOf()).queryByRole('button', { name: 'Remove from list' })).toBeNull()
    cleanup()
    // "Not in any list": each live list, one click, under its header.
    const { ctx } = page(WITH_UNLISTED())
    const p = openPicker()
    fireEvent.click(within(p).getByRole('button', { name: /^Not in any list/ }))
    fireEvent.click(within(p).getByRole('button', { name: 'Open' }))
    expect(openMore('The jetty')).toEqual([['Pickups · v1', false], ['Shoot · v1', false]])
    expect(document.querySelector('.ui-menu .ui-menu-header').textContent).toBe('Add to list')
    fireEvent.click(menuItem('Shoot · v1'))
    await waitFor(() => expect(ctx.addToShotList).toHaveBeenCalledWith('list-a', { sceneId: 'sc4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select The jetty' }))
    expect(within(bulkBarOf()).queryByRole('button', { name: 'Remove from list' })).toBeNull()
  })
})

describe('S3b step 6: a name says which lists hold it (D10)', () => {
  it('in the tables and on the cards: "In: …", live lists only, sorted; "In no shot list" for a row none holds; nothing in a project with no lists', () => {
    page(TWO_LISTS())
    const nameTitle = (name) => rowOf(name).querySelector('.rb-scene-name-cell .rb-scene-inline').getAttribute('title')
    expect(nameTitle('Lighthouse, dawn')).toBe('In: Pickups · v1, Shoot · v1')
    expect(nameTitle('Cliff path')).toBe('In: Shoot · v1')
    openScene('Lighthouse, dawn')
    expect(nameTitle('The door')).toBe('In: Shoot · v1')
    toShots()
    expect(nameTitle('The cold lamp')).toBe('In: Shoot · v1')
    toGallery()
    expect(cardsOf().map((c) => c.querySelector('.rb-scene-card-name').getAttribute('title'))).toEqual(['In: Shoot · v1', 'In: Shoot · v1'])
    fireEvent.click(screen.getByRole('tab', { name: 'Scenes' }))
    expect(cardOf('Lighthouse, dawn').querySelector('.rb-scene-card-name').getAttribute('title')).toBe('In: Pickups · v1, Shoot · v1')
    cleanup()
    // An archived list is no list a row is "in" (S3a's "Not in any list" agrees).
    const two = WITH_UNLISTED()
    page({ ...two, shotLists: [two.shotLists[0], { ...two.shotLists[1], archived_at: '2026-10-01T09:00:00Z', archived_by: 'u-9' }] })
    expect(nameTitle('Lighthouse, dawn')).toBe('In: Shoot · v1')
    const p = openPicker()
    fireEvent.click(within(p).getByRole('button', { name: /^Not in any list/ }))
    fireEvent.click(within(p).getByRole('button', { name: 'Open' }))
    // The far lamp is in no live list now: its scene heads it, in number order.
    expect(rowNames(sceneTable())).toEqual(['Lighthouse, dawn', 'Harbour café', 'The jetty'])
    expect(nameTitle('The jetty')).toBe('In no shot list')
    expect(nameTitle('Lighthouse, dawn')).toBe('In: Shoot · v1')
    cleanup()
    page({ ...WITH_UNLISTED(), shotLists: [], shotListItems: [], activeListId: null })
    expect(rowOf('The jetty').querySelector('.rb-scene-name-cell .rb-scene-inline').hasAttribute('title')).toBe(false)
  })
})

describe('S3b step 6: Delete says it is the project\'s, and every list\'s', () => {
  it('a scene: every shot it has in the project, every list that holds it — an archived one too, marked — and, with a list on screen, the verb that takes it out of that list alone', async () => {
    const two = TWO_LISTS()
    const old = { ...LIST_1, id: 'list-o', title: 'Old cut', archived_at: '2026-10-01T09:00:00Z', archived_by: 'u-9' }
    const { ctx } = page({ ...two, shotLists: [...two.shotLists, old], shotListItems: [...two.shotListItems, ...itemsFor('list-o', [{ scene_id: 'sc1', position: 0 }])] })
    fireEvent.click(within(rowOf('Lighthouse, dawn')).getByRole('button', { name: 'Delete scene' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete scene?' })
    expect(askWords(dialog)).toBe('This will permanently delete “Lighthouse, dawn” and its 3 shots from the project. It will be gone from all 3 shot lists that hold it: “Old cut · v1” (archived), “Pickups · v1” and “Shoot · v1”. To take it out of “Shoot · v1” only, use “Remove from this list” in its shot-list menu.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(ctx.deleteScene).toHaveBeenCalledWith('sc1'))
    cleanup()
    page(TWO_LISTS())
    fireEvent.click(within(rowOf('Lighthouse, dawn')).getByRole('button', { name: 'Delete scene' }))
    expect(askWords(screen.getByRole('dialog', { name: 'Delete scene?' }))).toBe('This will permanently delete “Lighthouse, dawn” and its 3 shots from the project. It will be gone from both shot lists that hold it: “Pickups · v1” and “Shoot · v1”. To take it out of “Shoot · v1” only, use “Remove from this list” in its shot-list menu.')
  })

  it('no "Remove" hint where it would not work: a row the list on screen does not hold (its popup, from another tab), the "Not in any list" view, a person without a list seat', () => {
    page(TWO_LISTS())
    act(() => navigateTo({ view: 'scenes', projectId: 'p1', shotId: 'sh3' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'The kettle' })).getByRole('button', { name: 'Delete shot' }))
    expect(askWords(screen.getByRole('dialog', { name: 'Delete shot?' }))).toBe('This will permanently delete shot “The kettle” from the project. It will be gone from “Pickups · v1” too.')
    cleanup()
    page(WITH_UNLISTED())
    const p = openPicker()
    fireEvent.click(within(p).getByRole('button', { name: /^Not in any list/ }))
    fireEvent.click(within(p).getByRole('button', { name: 'Open' }))
    fireEvent.click(within(rowOf('The jetty')).getByRole('button', { name: 'Delete scene' }))
    expect(askWords(screen.getByRole('dialog', { name: 'Delete scene?' }))).toBe('This will permanently delete “The jetty” from the project.')
    cleanup()
    page({ ...TWO_LISTS(), ...seat(null) })
    fireEvent.click(within(rowOf('Cliff path')).getByRole('button', { name: 'Delete scene' }))
    expect(askWords(screen.getByRole('dialog', { name: 'Delete scene?' }))).toBe('This will permanently delete “Cliff path” from the project. It will be gone from “Shoot · v1” too.')
  })
})

/** Add from another list…, opened from the bar's More menu. */
const openAddFrom = () => {
  fireEvent.click(within(bar()).getByRole('button', { name: 'More shot list actions' }))
  fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Add from another list…'))
  return screen.getByRole('dialog', { name: 'Add from another list' })
}
/** The dialog's rows: [kind, words, checked ('mixed' when indeterminate), disabled, note]. */
const addRows = (dialog) => [...dialog.querySelectorAll('.rb-scene-addfrom-row')].map((r) => {
  const box = r.querySelector('input[type="checkbox"]')
  return [r.classList.contains('rb-scene-addfrom-scene') ? 'scene' : 'shot', r.querySelector('.rb-scene-addfrom-name').textContent, box.indeterminate ? 'mixed' : box.checked, box.disabled, r.querySelector('.rb-scene-addfrom-note').textContent]
})
const addRow = (dialog, words) => [...dialog.querySelectorAll('.rb-scene-addfrom-row')].find((r) => r.querySelector('.rb-scene-addfrom-name').textContent === words)
const addButton = (dialog) => dialog.querySelector('.ui-dialog-foot .ui-btn[data-variant="primary"]')

describe('S3b step 6: Add from another list…', () => {
  it('the bar\'s More menu leads with it; the kit Dialog at the reading width, from another live list by default: scene → shots, what the list already holds ticked and greyed', () => {
    page(TWO_LISTS())
    const dialog = openAddFrom()
    expect([dialog.getAttribute('data-width'), dialog.closest('.ui-dialog-backdrop').parentElement]).toEqual(['reading', document.body])
    expect(dialog.querySelector('.ui-dialog-subtitle').textContent).toBe('Into “Shoot · v1”: the same scenes and shots, linked — not copied. Renaming one, or changing its status, changes it in every list.')
    const from = within(dialog).getByRole('combobox')
    expect([...from.options].map((o) => o.textContent)).toEqual(['Pickups · v1', 'Not in any list', 'Every scene and shot in this project'])
    expect(from.value).toBe('list-b')
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Search scenes and shots' }))
    expect(addRows(dialog)).toEqual([
      ['scene', 'Sc 1 · Lighthouse, dawn', false, false, '1 shot'],
      ['shot', 'The far lamp', false, false, ''],
      ['scene', 'Sc 3 · Harbour café', false, false, '1 shot'],
      ['shot', 'The kettle', false, false, ''],
    ])
    expect([addButton(dialog).textContent, addButton(dialog).disabled]).toEqual(['Add', true])
    fireEvent.change(from, { target: { value: 'all' } })
    expect(addRows(dialog)).toEqual([
      ['scene', 'Sc 1 · Lighthouse, dawn', false, false, '3 shots'],
      ['shot', 'The door', true, true, 'In this list'],
      ['shot', 'The cold lamp', true, true, 'In this list'],
      ['shot', 'The far lamp', false, false, ''],
      ['scene', 'Sc 2 · Cliff path', true, true, 'In this list'],
      ['scene', 'Sc 3 · Harbour café', false, false, '1 shot'],
      ['shot', 'The kettle', false, false, ''],
    ])
  })

  it('a scene\'s box ticks it and every shot under it that can be added — mixed while only some are; the button counts what will be added, and Add links them through addToShotList', async () => {
    const { ctx } = page(TWO_LISTS())
    const dialog = openAddFrom()
    fireEvent.click(addRow(dialog, 'The kettle').querySelector('input'))
    // A shot whose scene the list lacks brings its scene (S3a): counted.
    expect(addButton(dialog).textContent).toBe('Add 1 scene and 1 shot')
    expect(addRows(dialog)[2]).toEqual(['scene', 'Sc 3 · Harbour café', 'mixed', false, '1 shot'])
    fireEvent.click(addRow(dialog, 'Sc 3 · Harbour café').querySelector('input'))
    expect(addRows(dialog)[2]).toEqual(['scene', 'Sc 3 · Harbour café', true, false, '1 shot'])
    fireEvent.click(addRow(dialog, 'Sc 1 · Lighthouse, dawn').querySelector('input'))
    expect(addRows(dialog)[1]).toEqual(['shot', 'The far lamp', true, false, ''])
    expect(addButton(dialog).textContent).toBe('Add 1 scene and 2 shots')
    // Unticking the scene's box takes back all it ticked.
    fireEvent.click(addRow(dialog, 'Sc 3 · Harbour café').querySelector('input'))
    expect(addRows(dialog).slice(2)).toEqual([['scene', 'Sc 3 · Harbour café', false, false, '1 shot'], ['shot', 'The kettle', false, false, '']])
    expect(addButton(dialog).textContent).toBe('Add 1 shot')
    fireEvent.click(addRow(dialog, 'Sc 3 · Harbour café').querySelector('input'))
    fireEvent.click(addButton(dialog))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(ctx.addToShotList.mock.calls).toEqual([['list-a', { sceneIds: ['sc3'], shotIds: ['sh4', 'sh3'] }]])
  })

  it('the search narrows by name or number — a scene that matches keeps its shots — and its first Escape only clears it; ticks survive a change of source', () => {
    page(WITH_UNLISTED())
    const dialog = openAddFrom()
    const search = within(dialog).getByRole('textbox', { name: 'Search scenes and shots' })
    fireEvent.change(search, { target: { value: 'kettle' } })
    expect(addRows(dialog).map((r) => r[1])).toEqual(['Sc 3 · Harbour café', 'The kettle'])
    fireEvent.change(search, { target: { value: 'harbour' } })
    expect(addRows(dialog).map((r) => r[1])).toEqual(['Sc 3 · Harbour café', 'The kettle'])
    fireEvent.change(search, { target: { value: '30' } })
    expect(addRows(dialog).map((r) => r[1])).toEqual(['Sc 1 · Lighthouse, dawn', 'The far lamp'])
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(dialog.querySelector('.ui-empty-title').textContent).toBe('Nothing matches “zzz”')
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search.value).toBe('')
    expect(screen.getByRole('dialog', { name: 'Add from another list' })).toBe(dialog)
    fireEvent.click(addRow(dialog, 'The far lamp').querySelector('input'))
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'unlisted' } })
    expect(addRows(dialog)).toEqual([['scene', 'Sc 4 · The jetty', false, false, '0 shots']])
    fireEvent.click(addRow(dialog, 'Sc 4 · The jetty').querySelector('input'))
    expect(addButton(dialog).textContent).toBe('Add 1 scene and 1 shot')
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a refusal stays in the Dialog, word for word, with the ticks; a person without a list seat finds it greyed', async () => {
    const refusal = 'Only this project\'s managers, members and reviewers can change its shot lists and edits.'
    page({ ...TWO_LISTS(), addToShotList: vi.fn().mockRejectedValue(new Error(refusal)) })
    const dialog = openAddFrom()
    fireEvent.click(addRow(dialog, 'The kettle').querySelector('input'))
    fireEvent.click(addButton(dialog))
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe(refusal))
    expect(addRow(dialog, 'The kettle').querySelector('input').checked).toBe(true)
    cleanup()
    page({ ...TWO_LISTS(), ...seat(null) })
    expect(barMenu().find(([w]) => w === 'Add from another list…')).toEqual(['Add from another list…', true])
  })
})

describe('S3b step 6: the edges', () => {
  it('an archived list is no home for a removed row: "No other shot list holds it"; and the question closes, removing nothing, if the list on screen changes under it', async () => {
    const two = TWO_LISTS()
    // Cliff path is also in an ARCHIVED list.
    const old = { ...LIST_1, id: 'list-o', title: 'Old cut', archived_at: '2026-10-01T09:00:00Z', archived_by: 'u-9' }
    const data = { ...two, shotLists: [...two.shotLists, old], shotListItems: [...two.shotListItems, ...itemsFor('list-o', [{ scene_id: 'sc2', position: 0 }])] }
    remember('list-b')
    const { ctx, rerender } = page(data)
    // Viewing Pickups: The far lamp, only there.
    openScene('Lighthouse, dawn')
    openMore('The far lamp')
    fireEvent.click(menuItem('Remove from this list'))
    expect(askWords(removeDialog())).toBe('Takes shot “The far lamp” out of “Pickups · v1”. Nothing is deleted: it stays in the project. No other shot list holds it, so Shot lists… will show it under “Not in any list”.')
    // Someone archives Pickups meanwhile: the tab falls back to the active
    // list, and a question about Pickups must not now act on Shoot.
    rabbit.current = { ...ctx, ...listContext({ project: ctx.project, scenes: data.scenes, shots: data.shots, shotLists: data.shotLists.map((l) => (l.id === 'list-b' ? { ...l, archived_at: '2026-10-01T10:00:00Z', archived_by: 'u-9' } : l)), shotListItems: data.shotListItems }) }
    rerender(<ScenesView pageActive />)
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Shoot · v1')
    expect(screen.queryByRole('dialog', { name: 'Remove from this list?' })).toBeNull()
    expect(ctx.removeFromShotList).not.toHaveBeenCalled()
    cleanup()
    localStorage.clear()
    page(data)
    openMore('Cliff path')
    fireEvent.click(menuItem('Remove from this list'))
    expect(askWords(removeDialog())).toContain('No other shot list holds it, so Shot lists… will show it under “Not in any list”.')
  })

  it('Add from another list… opens on the first source with something to add — never an empty "Not in any list", nor a list the one on screen holds whole — and offers no archived list', () => {
    // One list holding every row: nothing to add anywhere; every row, greyed.
    page()
    let dialog = openAddFrom()
    const from = () => within(dialog).getByRole('combobox')
    expect([...from().options].map((o) => o.value)).toEqual(['unlisted', 'all'])
    expect(from().value).toBe('all')
    expect(addRows(dialog).every(([, , checked, disabled]) => checked === true && disabled === true)).toBe(true)
    cleanup()
    // Pickups holds only Lighthouse, which Shoot holds too; Harbour café is
    // in no list; and an archived list is no source.
    const two = TWO_LISTS()
    const old = { ...LIST_1, id: 'list-o', title: 'Old cut', archived_at: '2026-10-01T09:00:00Z', archived_by: 'u-9' }
    page({
      ...two,
      shotLists: [...two.shotLists, old],
      shotListItems: [...two.shotListItems.filter((i) => i.shot_list_id === 'list-a'), ...itemsFor('list-b', [{ scene_id: 'sc1', position: 0 }]), ...itemsFor('list-o', [{ scene_id: 'sc3', position: 0 }])],
    })
    dialog = openAddFrom()
    expect([...from().options].map((o) => o.textContent)).toEqual(['Pickups · v1', 'Not in any list', 'Every scene and shot in this project'])
    expect(from().value).toBe('unlisted')
    expect(addRows(dialog).map((r) => r[1])).toEqual(['Sc 1 · Lighthouse, dawn', 'The far lamp', 'Sc 3 · Harbour café', 'The kettle'])
  })

  it('adds to the list ON SCREEN, which need not be the active one', async () => {
    remember('list-b')
    const { ctx } = page(TWO_LISTS())
    const dialog = openAddFrom()
    expect(within(dialog).getByRole('combobox').value).toBe('list-a')
    fireEvent.click(addRow(dialog, 'Sc 2 · Cliff path').querySelector('input'))
    fireEvent.click(addButton(dialog))
    await waitFor(() => expect(ctx.addToShotList).toHaveBeenCalledWith('list-b', { sceneIds: ['sc2'], shotIds: [] }))
  })
})

/* ── post-overhaul S3b, step 7: gates, keys and the old bugs ────────────────
   A reviewer now writes shot lists on this tab but still may not write its
   scenes and shots (project.entity.write): every such verb greyed with the
   reason, every cell plain words, every field disabled — and the list verbs
   live. Ctrl+Z / Ctrl+Y only on R.A.B.B.I.T.'s page with nothing foreign
   over the tab (S4a-07). A draft is not dropped without a word (D21).
   P1-21 to P1-24. */
const REVIEWER_REASON = 'Reviewers can read, comment and build shot lists and edits, but cannot change scenes, shots, tasks, budgets or the project\'s other items. Ask a project manager for a member or manager seat.'
/** The GatedAction wrapper a control sits in while greyed, or null when it is live. */
const gateOf = (el) => el.closest('[aria-disabled="true"]')

describe('S3b step 7: a reviewer reads the scenes and shots, and builds lists, but cannot change them', () => {
  it('the toolbar\'s New scene and New shot, every Delete, Add shot and the bulk edits are greyed with the reviewer\'s reason; the list verbs stay live', async () => {
    const { ctx } = page({ ...TWO_LISTS(), ...seat('reviewer') })
    for (const words of ['New scene', 'New shot']) {
      const gate = gateOf(screen.getByRole('button', { name: words }))
      expect(gate, words).not.toBeNull()
      expect(gate.getAttribute('title'), words).toBe(REVIEWER_REASON)
    }
    expect(gateOf(within(rowOf('Lighthouse, dawn')).getByRole('button', { name: 'Delete scene' }))).not.toBeNull()
    // The list verbs: the row's menu and the bar's.
    expect(gateOf(moreButton('Lighthouse, dawn'))).toBeNull()
    expect(gateOf(within(bar()).getByRole('button', { name: 'New shot list' }))).toBeNull()
    // A selection: the edits and Delete greyed, Remove from list live.
    fireEvent.click(screen.getByRole('button', { name: 'Select Lighthouse, dawn' }))
    const bulk = document.querySelector('.rb-scene-bulk')
    expect(gateOf(within(bulk).getByRole('combobox', { name: 'Status' }))).not.toBeNull()
    expect(gateOf(within(bulk).getByRole('button', { name: 'Delete' }))).not.toBeNull()
    expect(gateOf(within(bulk).getByRole('button', { name: 'Remove from list' }))).toBeNull()
    // The nest: Add shot and each shot's Delete greyed.
    openScene('Lighthouse, dawn')
    const nest = rowOf('Lighthouse, dawn').nextElementSibling
    expect(gateOf(within(nest).getByRole('button', { name: 'Add shot' }))).not.toBeNull()
    expect(gateOf(within(rowOf('The door')).getByRole('button', { name: 'Delete shot' }))).not.toBeNull()
    expect(within(rowOf('The door')).getByLabelText('Frames for The door').disabled).toBe(true)
    // 🚨 jsdom does not honour `inert`, so these clicks and changes reach the
    // handlers a browser keeps them from: every funnel refuses on its own
    // (the Tasks tab's Session 29 rule — the greyed control is not the gate).
    fireEvent.click(screen.getByRole('button', { name: 'New scene' }))
    fireEvent.click(within(nest).getByRole('button', { name: 'Add shot' }))
    fireEvent.change(within(bulk).getByRole('combobox', { name: 'Status' }), { target: { value: 'final' } })
    fireEvent.click(within(rowOf('Cliff path')).getByRole('button', { name: 'Delete scene' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete scene?' })).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(rowOf('The door')).getByRole('button', { name: 'Delete shot' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete shot?' })).getByRole('button', { name: 'Delete' }))
    await act(async () => {})
    expect([ctx.addScene, ctx.addShot, ctx.updateScene, ctx.deleteScene, ctx.deleteShot].map((f) => f.mock.calls.length)).toEqual([0, 0, 0, 0, 0])
  })

  it('every cell is the words alone — a name or description opens no field — and every select and field is disabled; the thumbnail is a picture, not a button', () => {
    const { ctx } = page({ ...TWO_LISTS(), ...seat('reviewer') })
    const row = rowOf('Lighthouse, dawn')
    const nameWords = row.querySelector('.rb-scene-name-cell .rb-scene-inline')
    expect(nameWords.getAttribute('data-static')).toBe('true')
    // D10's lists stay its title.
    expect(nameWords.getAttribute('title')).toBe('In: Pickups · v1, Shoot · v1')
    fireEvent.click(nameWords)
    expect(within(row).queryByRole('textbox')).toBeNull()
    expect(['Status for Lighthouse, dawn', 'Time of day for Lighthouse, dawn', 'Type for Lighthouse, dawn'].map((n) => within(row).getByRole('combobox', { name: n }).disabled)).toEqual([true, true, true])
    const thumb = row.querySelector('.rb-scene-thumb')
    expect([thumb.getAttribute('data-static'), thumb.querySelector('.rb-scene-thumb-add')]).toEqual(['true', null])
    // …and a click on it picks nothing.
    const pickImage = vi.fn(async () => 'C:/stills/x.jpg')
    window.electronAPI = { rabbit: { pickImage, generateEntityThumbnail: vi.fn() } }
    try {
      fireEvent.click(thumb)
      expect(pickImage).not.toHaveBeenCalled()
    } finally {
      delete window.electronAPI
    }
    // An empty description reads as a dash, not an "Add description…" it could not do.
    expect(rowOf('Cliff path').querySelector('.rb-scene-desc-cell .rb-scene-inline').textContent).toBe('—')
    toShots()
    const shotRow = rowOf('The door')
    expect(['Frames for The door', 'Start date for The door', 'End date for The door'].map((n) => within(shotRow).getByLabelText(n).disabled)).toEqual([true, true, true])
    expect(ctx.updateScene).not.toHaveBeenCalled()
    expect(ctx.updateShot).not.toHaveBeenCalled()
  })

  it('the popups: every field inert or disabled, Delete and Add shot greyed, no "Set thumbnail"; a member\'s are live', () => {
    const { ctx } = page({ ...TWO_LISTS(), ...seat('reviewer') })
    let dialog = openScenePopup()
    const main = dialog.querySelector('.rb-scene-detail-main')
    expect(within(main).queryByRole('button', { name: 'Lighthouse, dawn' })).toBeNull()
    expect(main.querySelector('.rb-scene-detail-field .rb-scene-prop-inert').textContent).toBe('Lighthouse, dawn')
    expect(['Status', 'Type', 'Time of day', 'Scene number', 'Start date', 'End date'].map((n) => within(main).getByLabelText(n).disabled)).toEqual([true, true, true, true, true, true])
    expect(within(main).queryByRole('button', { name: 'Mara lets herself in.' })).toBeNull()
    expect(within(main).queryByRole('button', { name: 'Click to add notes...' })).toBeNull()
    expect(within(main).queryByRole('button', { name: 'Set thumbnail' })).toBeNull()
    expect(gateOf(within(dialog).getByRole('button', { name: 'Delete scene' })).getAttribute('title')).toBe(REVIEWER_REASON)
    expect(gateOf(within(main).getByRole('button', { name: 'Add shot' }))).not.toBeNull()
    expect(gateOf(within(main).getByRole('button', { name: 'Delete The door' }))).not.toBeNull()
    // A change that reached a disabled field (jsdom fires it) writes nothing.
    fireEvent.change(within(main).getByLabelText('Status'), { target: { value: 'final' } })
    expect(ctx.updateScene).not.toHaveBeenCalled()
    escape()
    dialog = openShotPopup()
    expect(['Status', 'Type', 'Time of day', 'Shot number', 'Frame count', 'Framing', 'Camera movement', 'Start date', 'End date'].map((n) => within(dialog).getByLabelText(n).disabled).every(Boolean)).toBe(true)
    expect(gateOf(within(dialog).getByRole('button', { name: 'Delete shot' }))).not.toBeNull()
    fireEvent.change(within(dialog).getByLabelText('Frame count'), { target: { value: '12' } })
    expect(ctx.updateShot).not.toHaveBeenCalled()
    escape()
    cleanup()
    page({ ...TWO_LISTS(), ...seat('member') })
    dialog = openScenePopup()
    expect(within(dialog).getByLabelText('Status').disabled).toBe(false)
    expect(gateOf(within(dialog).getByRole('button', { name: 'Delete scene' }))).toBeNull()
    expect(gateOf(screen.getByRole('button', { name: 'New scene' }))).toBeNull()
  })
})

describe('S3b step 7: S4a-07 — Ctrl+Z / Ctrl+Y only on R.A.B.B.I.T.\'s page, with nothing foreign over the tab', () => {
  const keys = (target = document.body) => [
    fireEvent.keyDown(target, { key: 'z', ctrlKey: true }),
    fireEvent.keyDown(target, { key: 'y', ctrlKey: true }),
  ]
  it('on another page the keys do nothing and are not taken; back on R.A.B.B.I.T. the same keys undo and redo', () => {
    const undo = vi.fn()
    const redo = vi.fn()
    const { ctx, rerender } = page({ ...TAKES, undo, redo, pageActive: false })
    expect(keys()).toEqual([true, true])
    expect([undo.mock.calls.length, redo.mock.calls.length]).toEqual([0, 0])
    // CONTROL: the gate, not a broken handler.
    rabbit.current = ctx
    rerender(<ScenesView pageActive />)
    expect(keys()).toEqual([false, false])
    expect([undo.mock.calls.length, redo.mock.calls.length]).toEqual([1, 1])
  })

  it('a kit menu, the shot lists\' picker or a drawer over the tab: nothing; with a popup open, as always, they undo (C1)', () => {
    const undo = vi.fn()
    page({ ...TAKES, undo })
    openMore('Lighthouse, dawn')
    keys()
    expect(undo).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('.ui-menu')).toBeNull()
    openPicker()
    keys()
    expect(undo).not.toHaveBeenCalled()
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
    // A drawer on screen (R.A.B.B.I.T.'s settings), or focus inside one.
    const drawer = document.createElement('div')
    drawer.className = 'ui-drawer-backdrop'
    document.body.appendChild(drawer)
    keys()
    expect(undo).not.toHaveBeenCalled()
    drawer.remove()
    const inDrawer = document.createElement('button')
    const shell = document.createElement('div')
    shell.className = 'ui-drawer'
    shell.appendChild(inDrawer)
    document.body.appendChild(shell)
    keys(inDrawer)
    expect(undo).not.toHaveBeenCalled()
    shell.remove()
    // Nothing over the tab: they undo; and inside a popup, as they did.
    keys()
    expect(undo).toHaveBeenCalledTimes(1)
    openScenePopup()
    keys(document.activeElement)
    expect(undo).toHaveBeenCalledTimes(2)
  })
})

describe('S3b step 7: D21 — a popup\'s draft is never dropped without a word', () => {
  const discardAsk = () => screen.getByRole('dialog', { name: 'Discard your changes?' })
  it('closing the popup — ✕, Close, Escape, the backdrop — with a changed description asks first, Cancel focused; Cancel keeps the draft, Discard closes', () => {
    const { ctx } = page()
    const dialog = openScenePopup()
    const main = dialog.querySelector('.rb-scene-detail-main')
    fireEvent.click(within(main).getByRole('button', { name: 'Mara lets herself in.' }))
    fireEvent.change(within(main).getByRole('textbox', { name: 'Description' }), { target: { value: 'Mara stays out.' } })
    const ways = [
      ['✕', () => fireEvent.click(within(dialog.querySelector('.ui-dialog-head')).getByRole('button', { name: 'Close' }))],
      ['Close', () => fireEvent.click(within(dialog.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Close' }))],
      ['Escape', () => fireEvent.keyDown(within(dialog.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Close' }), { key: 'Escape' })],
      ['backdrop', () => fireEvent.mouseDown(dialog.closest('.ui-dialog-backdrop'))],
    ]
    for (const [way, close] of ways) {
      close()
      const ask = discardAsk()
      expect([ask.getAttribute('data-width'), document.activeElement.textContent], way).toEqual(['confirm', 'Cancel'])
      expect(ask.querySelector('.ui-dialog-body').textContent, way).toBe('What you typed in the description is not saved. Discard it, or go back and Save it.')
      fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('dialog', { name: 'Lighthouse, dawn' }), way).toBe(dialog)
      expect(within(main).getByRole('textbox', { name: 'Description' }).value, way).toBe('Mara stays out.')
    }
    // Both drafts changed: the question names both.
    fireEvent.click(within(main).getByRole('button', { name: 'Click to add notes...' }))
    fireEvent.change(within(main).getByRole('textbox', { name: 'Notes' }), { target: { value: 'Bring the lamp.' } })
    fireEvent.click(within(dialog.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Close' }))
    expect(discardAsk().querySelector('.ui-dialog-body').textContent).toBe('What you typed in the description and the notes is not saved. Discard it, or go back and Save it.')
    fireEvent.click(within(discardAsk()).getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.updateScene).not.toHaveBeenCalled()
  })

  it('Escape in a changed box asks; Discard drops the draft and the popup stays — and an unchanged one closes at once (the shot popup\'s too)', () => {
    page()
    const dialog = openShotPopup()
    const box = () => within(dialog).getByRole('textbox', { name: 'Notes' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Click to add notes...' }))
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Discard your changes?' })).toBeNull()
    expect(within(dialog).queryByRole('textbox', { name: 'Notes' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Click to add notes...' }))
    fireEvent.change(box(), { target: { value: 'Wide first.' } })
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(discardAsk().querySelector('.ui-dialog-body').textContent).toBe('What you typed in the notes is not saved. Discard it, or go back and Save it.')
    fireEvent.click(within(discardAsk()).getByRole('button', { name: 'Cancel' }))
    expect(box().value).toBe('Wide first.')
    fireEvent.keyDown(box(), { key: 'Escape' })
    fireEvent.click(within(discardAsk()).getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('dialog', { name: 'The door' })).toBe(dialog)
    expect(within(dialog).queryByRole('textbox', { name: 'Notes' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Click to add notes...' })).toBeTruthy()
    // Nothing changed now: it closes at once.
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('S3b step 7: the four old Scenes bugs', () => {
  it('P1-21: a thumbnail set in the UNGROUPED scene table shows at once — the table is handed the page\'s revision', async () => {
    const pickImage = vi.fn(async () => 'C:/stills/lighthouse.jpg')
    const generateEntityThumbnail = vi.fn(async () => {})
    window.electronAPI = { rabbit: { pickImage, generateEntityThumbnail } }
    try {
      page({ scenes: SCENES().map((s) => (s.id === 'sc1' ? { ...s, thumbnail_image: 'old.jpg' } : s)) })
      const img = () => rowOf('Lighthouse, dawn').querySelector('.rb-scene-thumb-img')
      expect(img().getAttribute('src')).toMatch(/\?r=0$/)
      await act(async () => { fireEvent.click(rowOf('Lighthouse, dawn').querySelector('.rb-scene-thumb')) })
      expect(generateEntityThumbnail).toHaveBeenCalledWith({ entityType: 'scene', entityId: 'sc1', sourcePath: 'C:/stills/lighthouse.jpg' })
      expect(img().getAttribute('src')).toMatch(/\?r=1$/)
    } finally {
      delete window.electronAPI
    }
  })

  it('P1-22: a shot\'s delete in the scene popup asks to delete it and does not open it', () => {
    page()
    const dialog = openScenePopup()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete The door' }))
    expect(screen.getByRole('dialog', { name: 'Delete shot?' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'The door' })).toBeNull()
  })

  it('P1-23: a related asset opens in the Assets tab\'s own popup, over the scene popup; one Escape closes it and the scene popup stays', () => {
    page({ assets: [{ id: 'a1', name: 'Fresnel lamp', status: 'in_progress', scene_ids: ['sc1'], shot_ids: ['sh1'] }] })
    const scene = openScenePopup()
    fireEvent.click(within(scene.querySelector('.rb-scene-detail-side')).getByText('Fresnel lamp'))
    const asset = screen.getByRole('dialog', { name: 'Fresnel lamp' })
    expect(asset.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    escape()
    expect(screen.queryByRole('dialog', { name: 'Fresnel lamp' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Lighthouse, dawn' })).toBe(scene)
    escape()
    // The shot popup's side too.
    const shot = openShotPopup()
    fireEvent.click(within(shot.querySelector('.rb-scene-detail-side')).getByText('Fresnel lamp'))
    expect(screen.getByRole('dialog', { name: 'Fresnel lamp' })).toBeTruthy()
  })
})

/* ── post-overhaul S3b, review round 1 ──────────────────────────────────────
   One test (or more) for each defect the first adversarial review found in
   S3b's own files, R1-01 … R1-16; each fails on the code before its fix
   (the hand-off lists the planted faults). R1-01's and R1-11's are the
   re-pinned tests above (batchProbe). */
const ARCHIVED_REASON = 'This shot list is archived. Restore it, or open another list, to add scenes and shots.'
/** Show the list in the provider's place: the context rebuilt over new rows. */
const swapRows = (ctx, rerender, rows) => {
  rabbit.current = { ...ctx, ...listContext({ project: ctx.project, ...rows }) }
  rerender(<ScenesView pageActive />)
}

describe('S3b review round 1', () => {
  it('R1-02: with an archived list on screen New scene, New shot and every Add shot are greyed with the reason — a new row went to the ACTIVE list; "Not in any list" makes rows in no list', async () => {
    const two = TWO_LISTS()
    const archived = { ...two.shotLists[1], archived_at: '2026-10-01T09:00:00Z', archived_by: 'u-9' }
    let { ctx } = page({ ...two, shotLists: [two.shotLists[0], archived] })
    const dialog = openPicker()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Archived…/ }))
    fireEvent.click(pickerRow(dialog, 'Pickups'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
    expect(bar().querySelector('.ui-status').textContent).toBe('Archived')
    for (const words of ['New scene', 'New shot']) expect(gateOf(screen.getByRole('button', { name: words }))?.getAttribute('title'), words).toBe(ARCHIVED_REASON)
    openScene('Lighthouse, dawn')
    const nest = rowOf('Lighthouse, dawn').nextElementSibling
    expect(gateOf(within(nest).getByRole('button', { name: 'Add shot' }))?.getAttribute('title')).toBe(ARCHIVED_REASON)
    // The rows themselves are the project's: still edited and deleted here.
    expect(gateOf(within(rowOf('Lighthouse, dawn')).getByRole('button', { name: 'Delete scene' }))).toBeNull()
    // jsdom does not honour inert: the funnels refuse on their own.
    fireEvent.click(screen.getByRole('button', { name: 'New scene' }))
    fireEvent.click(within(nest).getByRole('button', { name: 'Add shot' }))
    const popup = openScenePopup()
    expect(gateOf(within(popup.querySelector('.rb-scene-detail-main')).getByRole('button', { name: 'Add shot' }))?.getAttribute('title')).toBe(ARCHIVED_REASON)
    escape()
    // The shot table's Add shot too (review round 2, R2-03).
    toShots()
    const shotAdds = within(shotTable()).getAllByRole('button', { name: 'Add shot' })
    expect(shotAdds.length).toBeGreaterThan(0)
    for (const b of shotAdds) expect(gateOf(b)?.getAttribute('title')).toBe(ARCHIVED_REASON)
    fireEvent.click(shotAdds[0])
    await act(async () => {})
    expect([ctx.addScene.mock.calls.length, ctx.addShot.mock.calls.length]).toEqual([0, 0])
    cleanup()
    // "Not in any list": a new scene is in no list, said in so many words.
    ;({ ctx } = page(WITH_UNLISTED()))
    const picker = openPicker()
    fireEvent.click(within(picker).getByRole('button', { name: /^Not in any list/ }))
    fireEvent.click(within(picker).getByRole('button', { name: 'Open' }))
    expect(gateOf(screen.getByRole('button', { name: 'New scene' }))).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New scene' }))
    await waitFor(() => expect(ctx.addScene).toHaveBeenCalledTimes(1))
    expect(ctx.addScene.mock.calls[0][1]).toEqual({ listId: null })
    cleanup()
    // CONTROL: on a live list, the list's id.
    ;({ ctx } = page(TWO_LISTS()))
    fireEvent.click(screen.getByRole('button', { name: 'New scene' }))
    await waitFor(() => expect(ctx.addScene).toHaveBeenCalledTimes(1))
    expect(ctx.addScene.mock.calls[0][1]).toEqual({ listId: 'list-a' })
  })

  it('R1-03: a gallery card\'s shot-list menu does its verb and nothing else — the card under it does not open', () => {
    const { ctx } = page(TWO_LISTS())
    toGallery()
    fireEvent.click(within(cardOf('Lighthouse, dawn')).getByRole('button', { name: 'Shot list actions for Lighthouse, dawn' }))
    // CONTROL: opening the menu opens nothing.
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(menuItem('Remove from this list'))
    expect(screen.getByRole('dialog', { name: 'Remove from this list?' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Lighthouse, dawn' })).toBeNull()
    escape()
    toShots()
    fireEvent.click(within(cardOf('The door')).getByRole('button', { name: 'Shot list actions for The door' }))
    fireEvent.click(menuItem('Move down'))
    expect(ctx.reorderShotListItems).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('R1-04: a reviewer\'s popups offer no "Add new task" (the panel shows it whenever it is handed onCreateTask); a member\'s do', () => {
    page({ ...TWO_LISTS(), ...seat('reviewer') })
    let dialog = openScenePopup()
    expect(within(dialog).queryByRole('button', { name: 'Add new task' })).toBeNull()
    escape()
    dialog = openShotPopup()
    expect(within(dialog).queryByRole('button', { name: 'Add new task' })).toBeNull()
    cleanup()
    page({ ...TWO_LISTS(), ...seat('member') })
    dialog = openScenePopup()
    expect(within(dialog).getByRole('button', { name: 'Add new task' })).toBeTruthy()
    escape()
    dialog = openShotPopup()
    expect(within(dialog).getByRole('button', { name: 'Add new task' })).toBeTruthy()
  })

  it('R1-05: a selection holds only rows on screen — another list opened takes the rest out of it, so no bulk verb acts on a row nobody sees', () => {
    page(TWO_LISTS())
    fireEvent.click(screen.getByRole('button', { name: 'Select Cliff path' }))
    expect(within(bulkBarOf()).getByText('1 selected')).toBeTruthy()
    fireEvent.doubleClick(pickerRow(openPicker(), 'Pickups'))
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Pickups · v1')
    expect(bulkBarOf()).toBeNull()
    // A row on both lists stays ticked (CONTROL: the pruning keeps what it can).
    fireEvent.click(screen.getByRole('button', { name: 'Select Lighthouse, dawn' }))
    fireEvent.doubleClick(pickerRow(openPicker(), 'Shoot'))
    expect(within(bulkBarOf()).getByText('1 selected')).toBeTruthy()
    expect(rowOf('Lighthouse, dawn').getAttribute('data-selected')).toBe('true')
    // The shot table's too.
    toShots()
    fireEvent.click(screen.getByRole('button', { name: 'Select The cold lamp' }))
    fireEvent.doubleClick(pickerRow(openPicker(), 'Pickups'))
    expect(bulkBarOf()).toBeNull()
  })

  it('R1-06: a draft typed in stays when the saved words change under it, and closing still asks; an editor open but untouched shows the new words', () => {
    const { ctx, rerender } = page()
    const dialog = openScenePopup()
    const main = dialog.querySelector('.rb-scene-detail-main')
    const rows = (sc1) => {
      const scenes = SCENES().map((s) => (s.id === 'sc1' ? { ...s, ...sc1 } : s))
      return { scenes, shots: SHOTS(), shotLists: [LIST_1], shotListItems: itemsFor(LIST_1.id, backfillItems(scenes, SHOTS())) }
    }
    // The notes: open, nothing typed — a teammate's words arrive and show.
    fireEvent.click(within(main).getByRole('button', { name: 'Click to add notes...' }))
    swapRows(ctx, rerender, rows({ notes: 'Bring the lamp.' }))
    expect(within(main).getByRole('textbox', { name: 'Notes' }).value).toBe('Bring the lamp.')
    // The description: typed in — the draft stays.
    fireEvent.click(within(main).getByRole('button', { name: 'Mara lets herself in.' }))
    fireEvent.change(within(main).getByRole('textbox', { name: 'Description' }), { target: { value: 'Mara stays out.' } })
    swapRows(ctx, rerender, rows({ notes: 'Bring the lamp.', description: 'Mara knocks.' }))
    expect(within(main).getByRole('textbox', { name: 'Description' }).value).toBe('Mara stays out.')
    fireEvent.click(within(dialog.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Close' }))
    // Only the draft someone typed is "not saved".
    expect(screen.getByRole('dialog', { name: 'Discard your changes?' }).querySelector('.ui-dialog-body').textContent)
      .toBe('What you typed in the description is not saved. Discard it, or go back and Save it.')
  })

  it('R1-07: a popup whose row is gone keeps no key live behind the picker, and does not come back by itself with the row', () => {
    const undo = vi.fn()
    const data = TWO_LISTS()
    // The keys are bound where the bins are (supportsBins).
    const { ctx, rerender } = page({ ...data, ...TAKES, undo })
    openScenePopup('Cliff path')
    // The scene is gone (Ctrl+Z took its creation, or a teammate deleted it).
    swapRows(ctx, rerender, { scenes: data.scenes.filter((s) => s.id !== 'sc2'), shots: data.shots, shotLists: data.shotLists, shotListItems: data.shotListItems.filter((i) => i.scene_id !== 'sc2') })
    expect(screen.queryByRole('dialog')).toBeNull()
    openPicker()
    fireEvent.keyDown(document.activeElement, { key: 'z', ctrlKey: true })
    expect(undo).not.toHaveBeenCalled()
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
    // Ctrl+Y brings the scene back: its popup stays closed.
    rabbit.current = ctx
    rerender(<ScenesView pageActive />)
    expect(screen.queryByRole('dialog')).toBeNull()
    // CONTROL: with nothing over the tab, the key undoes.
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('R1-08: a scene\'s shots no other list holds are counted apart from its own homes; from a list that is not the active one, no word of the other tabs', () => {
    const two = TWO_LISTS()
    // Pickups holds The door too.
    const data = { ...two, shotListItems: [...two.shotListItems, { ...itemsFor('list-b', [{ shot_id: 'sh1', position: 1 }])[0], id: 'list-b-extra' }] }
    page(data)
    openMore('Lighthouse, dawn')
    fireEvent.click(menuItem('Remove from this list'))
    expect(askWords(removeDialog())).toBe('Takes “Lighthouse, dawn” and its 2 shots out of “Shoot · v1”. Nothing is deleted: it stays in the project. It is still in “Pickups · v1”. 1 of its shots is in no other shot list, so Shot lists… will show it under “Not in any list”. This is the active list, so the other tabs stop showing it. Nothing on the Timeline or the Budget is deleted: a task on it reads there as not assigned to it until it is in the active list again.')
    cleanup()
    remember('list-b')
    page(data)
    openMore('Lighthouse, dawn')
    fireEvent.click(menuItem('Remove from this list'))
    expect(askWords(removeDialog())).toBe('Takes “Lighthouse, dawn” and its 2 shots out of “Pickups · v1”. Nothing is deleted: it stays in the project. It is still in “Shoot · v1”. 1 of its shots is in no other shot list, so Shot lists… will show it under “Not in any list”.')
    cleanup()
    localStorage.clear()
    // An ARCHIVED list is no home (S3a's rule for rows, round 2's R2-03 for
    // a scene's shots): The cold lamp, held by an archived list besides
    // Shoot, still counts as in no other list.
    const old = { ...LIST_1, id: 'list-o', title: 'Old cut', archived_at: '2026-10-01T09:00:00Z', archived_by: 'u-9' }
    page({ ...data, shotLists: [...data.shotLists, old], shotListItems: [...data.shotListItems, ...itemsFor('list-o', [{ scene_id: 'sc1', position: 0 }, { shot_id: 'sh2', position: 0 }])] })
    openMore('Lighthouse, dawn')
    fireEvent.click(menuItem('Remove from this list'))
    expect(askWords(removeDialog())).toContain('1 of its shots is in no other shot list, so Shot lists… will show it under “Not in any list”.')
  })

  it('R1-09: the menu takes focus as it opens and gives it back; its button closes it; in the picker it sits inside the dialog', () => {
    page(TWO_LISTS())
    const button = within(bar()).getByRole('button', { name: 'More shot list actions' })
    button.focus()
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(menuItem('Add from another list…'))
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(document.querySelector('.ui-menu')).toBeNull()
    expect(document.activeElement).toBe(button)
    // The button closes its own menu: the press closes it, the click does not open it again…
    fireEvent.click(button)
    fireEvent.mouseDown(button)
    fireEvent.click(button)
    expect(document.querySelector('.ui-menu')).toBeNull()
    // …and the next click opens it.
    fireEvent.click(button)
    expect(document.querySelector('.ui-menu')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    // An item that opens nothing leaves focus on the row's button.
    openMore('Cliff path')
    fireEvent.click(menuItem('Move up'))
    expect(document.activeElement).toBe(moreButton('Cliff path'))
    // An item that opens a question: the question gives focus back to the
    // row's button, not to the item that went with the menu.
    openMore('Cliff path')
    fireEvent.click(menuItem('Remove from this list'))
    fireEvent.click(within(removeDialog()).getByRole('button', { name: 'Cancel' }))
    expect(document.activeElement).toBe(moreButton('Cliff path'))
    // In the picker: inside the dialog, so its Tab trap holds the items.
    const dialog = openPicker()
    fireEvent.click(within(pickerRow(dialog, 'Pickups')).getByRole('button', { name: 'Actions for Pickups · v1' }))
    expect(dialog.contains(document.querySelector('.ui-menu'))).toBe(true)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('R1-11: with no seat to write lists, the More menu offers no Clear and no Withdraw, whatever S3a would allow', () => {
    remember('list-b', 'u-1')
    page({ ...TWO_LISTS(), canWithdrawShotList: () => true, ...seat(null) })
    expect(barMenu()).toEqual([['Add from another list…', true], ['New edit from this list', true], ['Edit details…', true], ['Archive', true]])
    fireEvent.keyDown(document, { key: 'Escape' })
    cleanup()
    localStorage.clear()
    // CONTROL: a member sees both.
    remember('list-b', 'u-1')
    page({ ...TWO_LISTS(), canWithdrawShotList: () => true, ...seat('member') })
    expect(barMenu().map(([w]) => w)).toEqual(['Add from another list…', 'New edit from this list', 'Edit details…', 'Clear this list', 'Withdraw', 'Archive'])
  })

  it('R1-12: Add from another list… closes if the list on screen changes under it — it never retargets — and does not come back with the list', () => {
    remember('list-b')
    const data = TWO_LISTS()
    const { ctx, rerender } = page(data)
    openAddFrom()
    const archived = data.shotLists.map((l) => (l.id === 'list-b' ? { ...l, archived_at: '2026-10-01T10:00:00Z', archived_by: 'u-9' } : l))
    swapRows(ctx, rerender, { scenes: data.scenes, shots: data.shots, shotLists: archived, shotListItems: data.shotListItems })
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Shoot · v1')
    expect(screen.queryByRole('dialog', { name: 'Add from another list' })).toBeNull()
    // Restored: Pickups is on screen again (still remembered), the dialog is not.
    swapRows(ctx, rerender, { scenes: data.scenes, shots: data.shots, shotLists: data.shotLists, shotListItems: data.shotListItems })
    expect(bar().querySelector('.rb-scene-lists-name').textContent).toBe('Pickups · v1')
    expect(screen.queryByRole('dialog', { name: 'Add from another list' })).toBeNull()
    expect(ctx.addToShotList).not.toHaveBeenCalled()
  })

  it('R1-13: one Save at a time — a double press records one version point; the button is busy until it is done', async () => {
    let done
    const saveShotListSnapshot = vi.fn(() => new Promise((r) => { done = r }))
    page({ ...TWO_LISTS(), saveShotListSnapshot })
    const save = within(bar()).getByRole('button', { name: 'Save' })
    // Two presses before React draws the busy button.
    act(() => { save.click(); save.click() })
    expect(saveShotListSnapshot).toHaveBeenCalledTimes(1)
    expect([save.disabled, save.getAttribute('aria-busy')]).toEqual([true, 'true'])
    await act(async () => { done({ id: 'list-a' }) })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    expect(saveShotListSnapshot).toHaveBeenCalledTimes(2)
  })

  it('R1-14: New shot list from "Not in any list" opens on what to do, not on a refusal; a title of spaces is refused', () => {
    page(WITH_UNLISTED())
    const picker = openPicker()
    fireEvent.click(within(picker).getByRole('button', { name: /^Not in any list/ }))
    fireEvent.click(within(picker).getByRole('button', { name: 'Open' }))
    fireEvent.click(within(bar()).getByRole('button', { name: 'New shot list' }))
    const dialog = formDialog('New shot list')
    expect(titleField(dialog).value).toBe('')
    expect([takes(dialog).textContent, takes(dialog).getAttribute('data-state')]).toEqual(['Type a title for the new shot list.', 'hint'])
    fireEvent.change(titleField(dialog), { target: { value: '   ' } })
    expect([takes(dialog).textContent, takes(dialog).getAttribute('data-state')]).toEqual(['A shot list needs a title.', 'refused'])
    expect(create(dialog, 'Create shot list').disabled).toBe(true)
  })

  it('R1-15: Withdraw says "You made" only where the maker test holds — on the Local Server, any untouched list may be taken back', () => {
    remember('list-b')
    page({ ...TWO_LISTS(), canWithdrawShotList: (id) => id === 'list-b' })
    barMenu()
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Withdraw'))
    expect(screen.getByRole('dialog', { name: 'Withdraw this list?' }).querySelector('.ui-dialog-body').textContent)
      .toBe('Nobody has saved “Pickups · v1” or saved an edit of it, so it can be taken back. It is set aside, not deleted: it shows as “Recently removed” until you leave the Scenes tab, and stays in Shot lists under Archived. It is not the active list, so nothing on the Timeline or the Budget changes.')
    cleanup()
    localStorage.clear()
    remember('list-b', 'u-1')
    page({ ...TWO_LISTS(), canWithdrawShotList: (id) => id === 'list-b', ...seat('member'), adapterMode: 'supabase' })
    barMenu()
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Withdraw'))
    expect(screen.getByRole('dialog', { name: 'Withdraw this list?' }).querySelector('.ui-dialog-body').textContent)
      .toMatch(/^You made “Pickups · v1” and nobody has saved it or saved an edit of it, so you can take it back\. /)
  })

  it('R1-16: a reviewer\'s greyed bulk edits share a wrapper that keeps the bar\'s gap (rabbitScenesCss.test.js reads the rule)', () => {
    page({ ...TWO_LISTS(), ...seat('reviewer') })
    fireEvent.click(screen.getByRole('button', { name: 'Select Lighthouse, dawn' }))
    expect(gateOf(within(bulkBarOf()).getByRole('combobox', { name: 'Status' })).classList.contains('rb-scene-bulk-gate')).toBe(true)
    toShots()
    fireEvent.click(screen.getByRole('button', { name: 'Select The door' }))
    expect(gateOf(within(bulkBarOf()).getByRole('combobox', { name: 'Status' })).classList.contains('rb-scene-bulk-gate')).toBe(true)
  })
})

/* ── post-overhaul S3b, review round 2 ──────────────────────────────────────
   The second adversarial review attacked round 1's corrections. One test
   (or more) for each defect it found in S3b's files; R2-02's (the ⋯ under
   Chromium's event order) is views/scenes/MenuButton.test.jsx, R2-03's are
   the strengthened tests above. */
/** A promise and the hands that settle it. */
const deferred = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
/** Salt Hours with a second scene that has a shot: Cliff path's The gate. */
const TWO_NESTS = () => {
  const shots = [...SHOTS(), { id: 'sh5', scene_id: 'sc2', name: 'The gate', shot_number: 10, status: 'not_started', type: 'other', frame_count: 0, description: '' }]
  return { shots, shotListItems: itemsFor(LIST_1.id, backfillItems(SCENES(), shots)) }
}

describe('S3b review round 2', () => {
  it('R2-01: while a bulk delete runs, Ctrl+Z and Ctrl+Y stand down — the run is not yet a step, so an undo would take back the one before it; after it, they act', async () => {
    const undo = vi.fn()
    const redo = vi.fn()
    const first = deferred()
    const deleteScene = vi.fn((id) => (id === 'sc1' ? first.promise : Promise.resolve()))
    const { ctx } = page({ ...TAKES, undo, redo, deleteScene })
    fireEvent.click(screen.getByRole('button', { name: 'Select Lighthouse, dawn' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select Cliff path' }))
    fireEvent.click(within(bulkBarOf()).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete scenes' })).getByRole('button', { name: 'Delete' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(deleteScene.mock.calls.map((c) => c[0])).toEqual(['sc1'])
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })
    expect([undo.mock.calls.length, redo.mock.calls.length]).toEqual([0, 0])
    await act(async () => { first.resolve() })
    await waitFor(() => expect(deleteScene.mock.calls.map((c) => c[0])).toEqual(['sc1', 'sc2']))
    // CONTROL: the run done, the keys act again.
    await act(async () => {})
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(ctx.runBatch).toHaveBeenCalledTimes(1)
  })

  it('R2-01: a refused delete does not stop the rest of the run, which stays one batch', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const probe = batchProbe()
    const refused = 'new row violates row-level security policy for table "scenes"'
    const deleteScene = probe.mark('deleteScene', (id) => { if (id === 'sc1') throw new Error(refused) })
    page({ runBatch: probe.runBatch, deleteScene })
    fireEvent.click(screen.getByRole('button', { name: 'Select every scene' }))
    fireEvent.click(within(bulkBarOf()).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete scenes' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(probe.calls).toEqual([['deleteScene', true], ['deleteScene', true]]))
    expect(deleteScene.mock.calls.map((c) => c[0])).toEqual(['sc1', 'sc2'])
    expect(error.mock.calls.some(([words, err]) => words === 'Failed to delete scenes:' && err?.message === refused)).toBe(true)
  })

  it('R2-04: each open scene\'s bar counts AND acts on its own ticked shots; closing a scene unticks its shots', async () => {
    const { ctx } = page(TWO_NESTS())
    openScene('Lighthouse, dawn')
    openScene('Cliff path')
    fireEvent.click(screen.getByRole('button', { name: 'Select The door' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select The gate' }))
    const bars = () => [...document.querySelectorAll('.rb-scene-nest-bulk')]
    expect(bars().map((b) => b.querySelector('.rb-scene-bulk-count').textContent)).toEqual(['1 selected', '1 selected'])
    // Cliff path's bar: its Delete asks about, and deletes, The gate alone.
    const cliffBar = () => rowOf('Cliff path').nextElementSibling.querySelector('.rb-scene-nest-bulk')
    fireEvent.click(within(cliffBar()).getByRole('button', { name: 'Delete' }))
    const ask = screen.getByRole('dialog', { name: 'Delete shots' })
    expect(ask.textContent).toContain('This will permanently delete shot “The gate” from the project.')
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(ctx.deleteShot.mock.calls.map((c) => c[0])).toEqual(['sh5']))
    // Lighthouse's tick is still there, and its bar.
    expect(rowOf('The door').getAttribute('data-selected')).toBe('true')
    // With The gate ticked again, Lighthouse's Remove from list takes The
    // door alone…
    fireEvent.click(screen.getByRole('button', { name: 'Select The gate' }))
    fireEvent.click(within(rowOf('Lighthouse, dawn').nextElementSibling.querySelector('.rb-scene-nest-bulk')).getByRole('button', { name: 'Remove from list' }))
    expect(askWords(removeDialog())).toMatch(/^Takes shot “The door” out of/)
    fireEvent.click(within(removeDialog()).getByRole('button', { name: 'Remove from list' }))
    await waitFor(() => expect(ctx.removeFromShotList).toHaveBeenCalledWith('list-1', { shotIds: ['sh1'] }))
    // …and leaves The gate ticked; Cliff path's Clear the selection clears its own.
    expect(rowOf('The gate').getAttribute('data-selected')).toBe('true')
    fireEvent.click(within(cliffBar()).getByRole('button', { name: 'Clear the selection' }))
    expect(rowOf('The gate').getAttribute('data-selected')).toBeNull()
    // Closing a scene unticks its shots: open again, nothing is ticked.
    fireEvent.click(screen.getByRole('button', { name: 'Select The cold lamp' }))
    fireEvent.click(within(rowOf('Lighthouse, dawn')).getByRole('button', { name: 'Hide shots' }))
    openScene('Lighthouse, dawn')
    expect(rowOf('The cold lamp').getAttribute('data-selected')).toBeNull()
    expect(rowOf('Lighthouse, dawn').nextElementSibling.querySelector('.rb-scene-nest-bulk')).toBeNull()
  })

  it('R2-05: with every list set aside, New shot list opens on the first free "Shot list N"; a taken title — typed, or taken under the open form — is refused in the model\'s words', () => {
    const archived = { ...LIST_1, archived_at: '2026-10-01T09:00:00Z', archived_by: 'u-9' }
    const items = itemsFor(LIST_1.id, backfillItems(SCENES(), SHOTS()))
    const { ctx, rerender } = page({ shotLists: [archived], shotListItems: items, activeListId: null })
    fireEvent.click(within(bar()).getByRole('button', { name: 'New shot list' }))
    const dialog = formDialog('New shot list')
    expect(titleField(dialog).value).toBe('Shot list 2')
    expect([takes(dialog).textContent, takes(dialog).getAttribute('data-state')]).toEqual(['Will be “Shot list 2 · v1”', 'ok'])
    // A teammate makes "Shot list 2 · v1" while the form sits untouched: it
    // says so — not "Type a title", which stood in for it before round 2.
    swapRows(ctx, rerender, { scenes: SCENES(), shots: SHOTS(), shotLists: [archived, { ...LIST_1, id: 'list-2', title: 'Shot list 2' }], shotListItems: items })
    expect([takes(dialog).textContent, takes(dialog).getAttribute('data-state')]).toEqual(['There is already a shot list called "Shot list 2 · v1".', 'refused'])
    fireEvent.change(titleField(dialog), { target: { value: 'Shot list 1' } })
    expect([takes(dialog).textContent, takes(dialog).getAttribute('data-state')]).toEqual(['There is already a shot list called "Shot list 1 · v1".', 'refused'])
    expect(create(dialog, 'Create shot list').disabled).toBe(true)
  })

  it('R2-07: Clear is offered on the active list, never Saved (D4), and its question says the other tabs lose the rows; on another list it does not', async () => {
    const { ctx } = page(TWO_LISTS())
    expect(barMenu().map(([w]) => w)).toContain('Clear this list')
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Clear this list'))
    const ask = screen.getByRole('dialog', { name: 'Clear this list?' })
    expect(ask.querySelector('.ui-dialog-body').textContent).toBe('Takes 2 scenes and 2 shots out of “Shoot · v1”. Nothing is deleted: each stays in the project and in any other list that holds it. A list can be cleared only until it is first saved. This is the active list, so the other tabs stop showing them. Nothing on the Timeline or the Budget is deleted: a task on them reads there as not assigned to them until they are in the active list again.')
    fireEvent.click(within(ask).getByRole('button', { name: 'Clear list' }))
    await waitFor(() => expect(ctx.removeFromShotList).toHaveBeenCalledWith('list-a', { sceneIds: ['sc1', 'sc2'], shotIds: ['sh1', 'sh2'] }))
    cleanup()
    remember('list-b')
    page(TWO_LISTS())
    barMenu()
    fireEvent.click(within(document.querySelector('.ui-menu')).getByText('Clear this list'))
    expect(screen.getByRole('dialog', { name: 'Clear this list?' }).querySelector('.ui-dialog-body').textContent).not.toMatch(/active list/)
  })

  it('R1-22: a refused New scene or New shot is said in the tab\'s Banner, not only the console', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const refused = 'this shot list is archived — restore it before changing it'
    page({ ...TWO_LISTS(), addScene: vi.fn().mockRejectedValue(new Error(refused)), addShot: vi.fn().mockRejectedValue(new Error(refused)) })
    fireEvent.click(screen.getByRole('button', { name: 'New scene' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(refused))
    cleanup()
    page({ ...TWO_LISTS(), addShot: vi.fn().mockRejectedValue(new Error('the network is down')) })
    openScene('Lighthouse, dawn')
    fireEvent.click(within(rowOf('Lighthouse, dawn').nextElementSibling).getByRole('button', { name: 'Add shot' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('the network is down'))
  })

  // Post-overhaul S3c, step 7 (S3b-08): that draft used to go UNASKED. The
  // jump now asks D21's question first; Discard opens the other scene, clean
  // (still its row's own), and Cancel keeps the first popup and what was typed.
  it('a popup is its row\'s own: another scene opened over it (an "Open in Scenes" target) shows that scene, not the first one\'s draft — after asking (S3b-08)', async () => {
    page()
    const first = openScenePopup()
    fireEvent.click(within(first.querySelector('.rb-scene-detail-main')).getByRole('button', { name: 'Mara lets herself in.' }))
    fireEvent.change(within(first).getByRole('textbox', { name: 'Description' }), { target: { value: 'Typed for the lighthouse.' } })
    act(() => navigateTo({ view: 'scenes', projectId: 'p1', sceneId: 'sc2' }))
    const ask = await screen.findByRole('dialog', { name: 'Discard your changes?' })
    expect(ask.querySelector('.ui-dialog-body').textContent).toBe('What you typed in the description is not saved. Discard it, or go back and Save it.')
    expect(screen.queryByRole('dialog', { name: 'Cliff path' })).toBeNull()
    await act(async () => { fireEvent.click(within(ask).getByRole('button', { name: 'Discard' })) })
    const second = await screen.findByRole('dialog', { name: 'Cliff path' })
    expect(within(second).queryByRole('textbox', { name: 'Description' })).toBeNull()
    expect(second.textContent).not.toContain('Typed for the lighthouse.')
  })
  it('CONTROL (S3b-08): Cancel keeps the first popup and what was typed in it; the jump is dropped', async () => {
    page()
    const first = openScenePopup()
    fireEvent.click(within(first.querySelector('.rb-scene-detail-main')).getByRole('button', { name: 'Mara lets herself in.' }))
    fireEvent.change(within(first).getByRole('textbox', { name: 'Description' }), { target: { value: 'Typed for the lighthouse.' } })
    act(() => navigateTo({ view: 'scenes', projectId: 'p1', sceneId: 'sc2' }))
    const ask = await screen.findByRole('dialog', { name: 'Discard your changes?' })
    await act(async () => { fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' })) })
    expect(screen.queryByRole('dialog', { name: 'Cliff path' })).toBeNull()
    expect(within(first).getByRole('textbox', { name: 'Description' }).value).toBe('Typed for the lighthouse.')
  })
})

// ── Post-overhaul S3c, step 7: the popups' typed work and the leave guard ──
describe('S3c step 7: a popup\'s typed work is asked about before it goes (S3b-05, S3b-08)', () => {
  const ask = () => screen.getByRole('dialog', { name: 'Discard your changes?' })
  it('S3b-05: a task form with something typed counts as the popup\'s draft — closing the popup asks, and says it is the new task', async () => {
    page()
    const dialog = openScenePopup()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add new task' }))
    fireEvent.change(screen.getByPlaceholderText('Task title…'), { target: { value: 'Board the pier' } })
    fireEvent.click(within(dialog.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Close' }))
    expect(ask().querySelector('.ui-dialog-body').textContent).toBe('What you typed in the new task is not saved. Discard it, or go back to it.')
    await act(async () => { fireEvent.click(within(ask()).getByRole('button', { name: 'Cancel' })) })
    expect(screen.getByPlaceholderText('Task title…').value).toBe('Board the pier')
    fireEvent.click(within(dialog.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Close' }))
    await act(async () => { fireEvent.click(within(ask()).getByRole('button', { name: 'Discard' })) })
    expect(screen.queryByRole('dialog', { name: 'Lighthouse, dawn' })).toBeNull()
  })
  it('CONTROL: an untouched task form goes with the popup at once', () => {
    page()
    const dialog = openScenePopup()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add new task' }))
    fireEvent.click(within(dialog.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('S3b-08: leaving the tab ("Show in Bins", the strip) with typed text asks D21\'s question; Cancel stays, Discard goes; leaving the PAGE does not ask (the popup stays mounted)', async () => {
    page()
    const dialog = openScenePopup()
    fireEvent.click(within(dialog.querySelector('.rb-scene-detail-main')).getByRole('button', { name: 'Mara lets herself in.' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Description' }), { target: { value: 'Typed.' } })
    expect(await confirmLeave('page')).toBe(true)
    let went
    act(() => { confirmLeave('tab').then((g) => { went = g }) })
    expect(ask().querySelector('.ui-dialog-body').textContent).toBe('What you typed in the description is not saved. Discard it, or go back and Save it.')
    await act(async () => { fireEvent.click(within(ask()).getByRole('button', { name: 'Cancel' })) })
    expect(went).toBe(false)
    expect(within(dialog).getByRole('textbox', { name: 'Description' }).value).toBe('Typed.')
    act(() => { confirmLeave('project').then((g) => { went = g }) })
    await act(async () => { fireEvent.click(within(ask()).getByRole('button', { name: 'Discard' })) })
    expect(went).toBe(true)
  })
  // S3c review round 1 (R1-10): a question torn down before it was answered
  // never settled, and the leave guard's one-question lock then refused every
  // later exit in silence.
  it('S3c R1-10: the scene deleted elsewhere under an open question — the question goes, that exit stays, and the next exit is not refused', async () => {
    const { ctx, rerender } = page()
    const dialog = openScenePopup()
    fireEvent.click(within(dialog.querySelector('.rb-scene-detail-main')).getByRole('button', { name: 'Mara lets herself in.' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Description' }), { target: { value: 'Typed.' } })
    let went
    act(() => { confirmLeave('tab').then((g) => { went = g }) })
    expect(ask()).toBeTruthy()
    const gone = ctx.scenes.find(s => s.name === 'Lighthouse, dawn').id
    rabbit.current = { ...ctx, scenes: ctx.scenes.filter(s => s.id !== gone), sceneById: (id) => (id === gone ? null : ctx.sceneById(id)) }
    await act(async () => { rerender(<ScenesView pageActive />) })
    await act(async () => { await Promise.resolve() })
    expect(went).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'Discard your changes?' })).toBeNull()
    // The lock is let go: the next exit is answered at once.
    expect(await confirmLeave('tab')).toBe(true)
  })
})
