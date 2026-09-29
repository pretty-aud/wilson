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
import { STATUS } from '../../../ui/StatusDot'
import { formatSceneCode, formatShotCode } from '../entityNaming'

// ScenesView's module graph reaches the cloud client and the permission hook
// at import.
vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true, can: () => true }) }))
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

afterEach(() => { cleanup(); _resetOverlaysForTests(); vi.restoreAllMocks(); localStorage.clear() })

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

function page({ scenes = SCENES(), shots = SHOTS(), ...extra } = {}) {
  const ctx = {
    project: { id: 'p1', name: 'Salt Hours', fps: 24 },
    scenes,
    shots,
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
    ...extra,
  }
  rabbit.current = ctx
  return { ctx, ...render(<ScenesView />) }
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
    expect(within(acts('Lighthouse, dawn')).getAllByRole('button').map((b) => b.getAttribute('title'))).toEqual(['View details', 'Delete scene'])
    expect(within(acts('The door')).getAllByRole('button').map((b) => b.getAttribute('title'))).toEqual(['View details', 'Delete shot'])
    // The slot is one width in every table: the sheet's one column.
    expect(read('./rabbitScenes.css')).toMatch(/--rb-scene-col-acts: 84px;/)
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

  it('W9: a row\'s Delete asks on the kit Dialog in <body> — Cancel keeps the scene, Delete deletes it and its shots through the context', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { ctx } = page()
    fireEvent.click(within(rowOf('Lighthouse, dawn')).getByRole('button', { name: 'Delete scene' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete scene?' })
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(dialog.getAttribute('data-width')).toBe('confirm')
    expect(dialog.textContent).toContain('This will permanently delete "Lighthouse, dawn" and all its shots.')
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
    expect(ctx.deleteShot.mock.calls.map((c) => c[0])).toEqual(['sh1', 'sh2'])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(confirm).not.toHaveBeenCalled()
  })

  it('W9: the scenes\' bulk Delete asks on the kit Dialog — Cancel and Escape keep the rows, a click outside does nothing, Delete deletes each scene and its shots', () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { ctx } = page()
    fireEvent.click(screen.getByRole('button', { name: 'Select Lighthouse, dawn' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select Cliff path' }))
    const bulk = () => document.querySelector('.rb-scene-bulk')
    expect(within(bulk()).getByText('2 selected')).toBeTruthy()
    fireEvent.click(within(bulk()).getByRole('button', { name: 'Delete' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete scenes' })
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(dialog.textContent).toContain('Delete 2 scenes and their shots?')
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
    expect(ctx.deleteScene.mock.calls.map((c) => c[0]).sort()).toEqual(['sc1', 'sc2'])
    expect(ctx.deleteShot.mock.calls.map((c) => c[0])).toEqual(['sh1', 'sh2'])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bulk()).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('W9: the nested shots\' bulk Delete asks on the kit Dialog — Cancel keeps them, Delete deletes them through the context', () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { ctx } = page()
    openScene('Lighthouse, dawn')
    fireEvent.click(screen.getByRole('button', { name: 'Select The door' }))
    const bar = () => document.querySelector('.rb-scene-nest-bulk')
    expect(within(bar()).getByText('1 selected')).toBeTruthy()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete shots' })
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(dialog.textContent).toContain('Delete 1 shot?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.deleteShot).not.toHaveBeenCalled()
    expect(rowOf('The door').getAttribute('data-selected')).toBe('true')

    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))
    dialog = screen.getByRole('dialog', { name: 'Delete shots' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(ctx.deleteShot).toHaveBeenCalledTimes(1)
    expect(ctx.deleteShot).toHaveBeenCalledWith('sh1')
    expect(ctx.deleteScene).not.toHaveBeenCalled()
    expect(bar()).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('W9: the shot table\'s bulk Delete asks on the kit Dialog — Cancel keeps the shots, Delete deletes them through the context', () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { ctx } = page()
    toShots()
    fireEvent.click(screen.getByRole('button', { name: 'Select every shot' }))
    const bulk = () => document.querySelector('.rb-scene-bulk')
    expect(within(bulk()).getByText('2 selected')).toBeTruthy()
    fireEvent.click(within(bulk()).getByRole('button', { name: 'Delete' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete shots' })
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(dialog.textContent).toContain('Delete 2 shots?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.deleteShot).not.toHaveBeenCalled()
    expect(rowOf('The cold lamp').getAttribute('data-selected')).toBe('true')

    fireEvent.click(within(bulk()).getByRole('button', { name: 'Delete' }))
    dialog = screen.getByRole('dialog', { name: 'Delete shots' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(ctx.deleteShot.mock.calls.map((c) => c[0]).sort()).toEqual(['sh1', 'sh2'])
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
    expect(dialog.textContent).toContain('This will permanently delete "Lighthouse, dawn" and all its shots.')
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
    expect(screen.getByRole('dialog', { name: 'Delete shot?' }).textContent).toContain('"The door"')
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
      'Shots / assets / tasks', 'Start date', 'End date', 'Description', 'Notes', 'Folder', 'Files (0)', 'Shots (2)'])
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
      'Framing', 'Camera movement', 'Parent scene', 'Start date', 'End date', 'Description', 'Notes', 'Folder', 'Files (0)'])
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
      expect(question.textContent, way).toContain('This will permanently delete "Lighthouse, dawn" and all its shots.')
      // On Cancel — not on the question's ✕, where the popup's close sent it.
      expect(document.activeElement, way).toBe(within(question.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Cancel' }))
      close(question)
      expect(screen.queryByRole('dialog'), way).toBeNull()
      expect(document.activeElement, way).toBe(view)
    }
    expect(ctx.deleteScene).not.toHaveBeenCalled()
    fireEvent.click(within(ask().querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(ctx.deleteScene).toHaveBeenCalledWith('sc1'))
    expect(ctx.deleteShot.mock.calls.map((c) => c[0])).toEqual(['sh1', 'sh2'])
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
    fireEvent.keyDown(box, { key: 'Escape' })
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
    expect(ctx.addShot).toHaveBeenCalledWith(expect.objectContaining({ scene_id: 'sc1' }))
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
    render(<><UndoToast /><IngestionToast /></>)
    /** A fixed surface's layer: its one z- utility, a number. */
    const zOf = (el) => (el.className.match(/(?:^|\s)z-\[?(\d+)\]?(?=\s|$)/g) || []).map((z) => Number(z.replace(/\D/g, '')))
    const undo = screen.getByRole('button', { name: 'Undo' }).closest('.fixed')
    const ingestion = screen.getByText('Breakdown ready').closest('.fixed')
    expect([zOf(undo), zOf(ingestion)]).toEqual([[toastLayer], [toastLayer]])
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
