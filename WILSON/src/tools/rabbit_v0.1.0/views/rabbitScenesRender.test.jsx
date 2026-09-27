/** @vitest-environment jsdom */
// =============================================================================
// Lane B5b, mounted: the Scenes page on the kit and rabbitScenes.css.
// rabbitScenesCss.test.js reads source text; this renders ScenesView with a
// mocked R.A.B.B.I.T. context and asserts what a user would meet. One
// describe per surface, added in the commit that moves it — surface 6a: the
// tiles, the toolbar and both tables (the scene table with its nested shots,
// and the shot table), and the four delete questions on the kit Dialog (W9).
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { _resetOverlaysForTests } from '../../../ui/overlay'
import { STATUS } from '../../../ui/StatusDot'

// ScenesView's module graph reaches the cloud client and the permission hook
// at import; the popups it can open are not opened here.
vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true, can: () => true }) }))
// ONE object each for the whole run: ScenesView keys memos on their lists.
const team = vi.hoisted(() => ({ members: [] }))
const rateCard = vi.hoisted(() => ({ entries: [], rateCards: [] }))
vi.mock('../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => team }))
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => rateCard }))
const rabbit = vi.hoisted(() => ({ current: null }))

const { default: ScenesView } = await import('./ScenesView')

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
