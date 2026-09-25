/** @vitest-environment jsdom */
// =============================================================================
// Lane B4b, mounted: the R.A.B.B.I.T. Assets PAGE on the kit (surface 3, part
// one — the page) and its two POPUPS (part two). What they DO — the kit
// Toolbar and its Tabs over a named tabpanel, the kit Table with ONE
// thumbnail column at every size, the task count a numeric cell, every
// icon-only control named for its asset, the W9 bulk-delete question on the
// kit Dialog, the saved-view Dialog, the group bands, the gallery's cards and
// the kit's empty state; then New asset and the asset's detail popup, each
// the kit's Dialog portalled into <body> — not how their source reads.
// =============================================================================

import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => perms.current }))
const perms = vi.hoisted(() => ({ current: null }))
// The two popups' hooks. Each returns ONE object for the whole run: the popups
// load templates in an effect keyed on `loadProjectTemplates`, and a new
// function on every render would load them forever. The popup tests below
// give the templates a list and the team its members.
const templates = vi.hoisted(() => {
  const state = { list: [] }
  return { state, api: { templates: [], loadProjectTemplates: async () => state.list } }
})
const team = vi.hoisted(() => ({ current: { members: [] } }))
vi.mock('../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => team.current }))
vi.mock('../../../components/TaskTemplates/useTaskTemplates', () => ({ useTaskTemplates: () => templates.api }))
const rabbit = vi.hoisted(() => ({ current: null }))

const { default: ProjectAssetsView } = await import('./ProjectAssetsView')

afterEach(() => {
  cleanup(); _resetOverlaysForTests(); vi.restoreAllMocks(); localStorage.clear()
  templates.state.list = []; team.current = { members: [] }
})

// Three assets: Mara is approved with a task still in flight (her row shows
// the warning), Cliff Path has a thumbnail, Festival DCP has no phase.
const ASSETS = () => [
  { id: 'a1', project_id: 'p1', name: 'Mara', type: 'character', status: 'approved', phase_id: 'ph1', start_date: '2026-08-03', due_date: '2026-08-19', description: 'Lead. Wardrobe, hair, the coat.', sort_order: 0 },
  { id: 'a2', project_id: 'p1', name: 'Cliff Path', type: 'environment', status: 'in_progress', phase_id: 'ph1', thumbnail_image: 'C:/thumbs/cliff.png', sort_order: 1 },
  { id: 'a3', project_id: 'p1', name: 'Festival DCP', type: 'deliverable', status: 'not_started', phase_id: null, sort_order: 2 },
]

// `reviewer`: a staffed project's reviewer, whom the write gate refuses.
// `extra`: more of the project's context (the popups' tasks, team, writers).
function page({ assets = ASSETS(), reviewer = false, ...extra } = {}) {
  perms.current = reviewer
    ? { role: 'user', ready: true, can: () => false }
    : { role: 'admin', ready: true, can: () => true }
  const ctx = {
    project: { id: 'p1', name: 'Salt Hours' },
    assets,
    phases: [{ id: 'ph1', name: 'Pre-production' }],
    tasks: [
      { id: 't1', asset_id: 'a1', status: 'in_progress' },
      { id: 't2', asset_id: 'a1', status: 'final' },
      { id: 't3', asset_id: 'a2', status: 'waiting_to_start' },
    ],
    myProjectRole: reviewer ? 'reviewer' : 'manager',
    projectIsStaffed: reviewer,
    updateAsset: vi.fn(),
    deleteAsset: vi.fn(),
    deleteAssets: vi.fn(async () => {}),
    selectAssetStatusWarning: (a) => a.id === 'a1',
    // The provider seeds both lists (RabbitProvider's initial state). Without
    // them the detail popup's FileManager reads `ctx.files || []` — a new
    // array each render, which re-keys its thumbnail effect, which sets state:
    // an effect loop that never lets `act` return.
    files: [],
    managedFiles: [],
    ...extra,
  }
  rabbit.current = ctx
  return { ctx, ...render(<ProjectAssetsView />) }
}

describe('ProjectAssetsView — the page on the kit', () => {
  it('the toolbar is the kit Toolbar, every control at the small size, and Table / Gallery the kit Tabs over a named tabpanel', () => {
    const { container } = page()
    const toolbar = container.querySelector('.ui-toolbar')
    expect(toolbar).not.toBeNull()
    for (const el of toolbar.querySelectorAll('.ui-btn, .ui-input')) expect(el.getAttribute('data-size')).toBe('sm')
    const tabs = within(toolbar).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Table', 'Gallery'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    const panel = screen.getByRole('tabpanel')
    expect(panel.id).toBeTruthy()
    for (const t of tabs) expect(t.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.contains(container.querySelector('table'))).toBe(true)
    // Filter says whether its strip is open.
    const filter = screen.getByRole('button', { name: 'Filter' })
    expect(filter.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(filter)
    expect(filter.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Add filter' })).toBeTruthy()
  })

  it('New asset is the kit primary, at the toolbar\'s small size', () => {
    page()
    const add = screen.getByRole('button', { name: 'New asset' })
    expect(add.className).toContain('ui-btn')
    expect(add.getAttribute('data-variant')).toBe('primary')
    expect(add.getAttribute('data-size')).toBe('sm')
  })

  it('draws the kit Table: its header labels, a row per asset, the task count a numeric cell, status a dot and words', () => {
    const { container } = page()
    const table = container.querySelector('table.ui-table')
    expect(table).not.toBeNull()
    const heads = [...table.querySelectorAll('thead th')]
    expect(heads.map((th) => th.textContent)).toEqual(
      ['', 'Thumbnail', 'Name', 'Type', 'Phase', 'Status', 'Start', 'Due', 'Description', 'Tasks', 'Actions'])
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3)
    // R4-17: the count right-aligned and tabular, under a numeric header.
    expect(heads.find((th) => th.textContent === 'Tasks').getAttribute('data-numeric')).toBe('true')
    expect([...table.querySelectorAll('tbody td[data-numeric="true"]')].map((td) => td.textContent)).toEqual(['2', '1', '0'])
    // R4-05: the kit's StatusDot beside a kit CellSelect whose words are the
    // kit's, and no colour of its own.
    const status = screen.getByRole('combobox', { name: 'Status for Cliff Path' })
    expect(status.closest('.ui-cell-select')).not.toBeNull()
    expect(status.selectedOptions[0].textContent).toBe('In progress')
    expect(status.getAttribute('style')).toBeNull()
    expect(status.closest('td').querySelector('.ui-status-dot[data-tone="signal"]')).not.toBeNull()
    // Every other in-cell select is the kit's too; a missing phase is "—".
    expect(screen.getByRole('combobox', { name: 'Type for Mara' }).closest('.ui-cell-select')).not.toBeNull()
    expect(screen.getByRole('combobox', { name: 'Phase for Festival DCP' }).selectedOptions[0].textContent).toBe('—')
    // R4-19: an empty value is an em dash, never "--".
    expect(container.textContent).not.toMatch(/--/)
  })

  it('every icon-only control is named, for its asset where it acts on one', () => {
    page()
    expect(screen.getByRole('button', { name: 'Select every asset' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Select Mara' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete Festival DCP' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Set thumbnail for Mara' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View edit history for Cliff Path' })).toBeTruthy()
    // The two names the walk steps on stay exactly as they were.
    expect(screen.getAllByRole('button', { name: 'View asset details' })).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Tasks not yet done — click for details' })).toBeTruthy()
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('aria-label') || b.title || b.textContent.trim(), b.outerHTML.slice(0, 80)).toBeTruthy()
    }
  })

  it('the thumbnail column is one width for the whole table, at every size', () => {
    const { container } = page()
    const wrap = container.querySelector('.rb-asset-table-wrap')
    const head = container.querySelector('thead th.rb-asset-thumb-cell')
    for (const size of ['md', 'lg', 'sm']) {
      fireEvent.click(screen.getByRole('button', { name: `${size} thumbnails` }))
      expect(wrap.getAttribute('data-thumb')).toBe(size)
      for (const other of ['sm', 'md', 'lg']) {
        expect(screen.getByRole('button', { name: `${other} thumbnails` }).getAttribute('aria-pressed')).toBe(String(other === size))
      }
      // The header declares the column once, for every size; no row's cell,
      // picture or placeholder carries a size of its own (each used to).
      expect(head.getAttribute('style')).toContain('--rb-asset-thumb')
      const cells = [...container.querySelectorAll('tbody td.rb-asset-thumb-cell')]
      expect(cells).toHaveLength(3)
      for (const td of cells) {
        expect(td.getAttribute('style')).toBeNull()
        for (const el of td.querySelectorAll('*')) expect(el.getAttribute('style')).toBeNull()
      }
    }
    // A row with a picture fills the column; the two without letterbox the
    // placeholder in it.
    expect(container.querySelectorAll('tbody td.rb-asset-thumb-cell img')).toHaveLength(1)
    expect(container.querySelector('tbody td.rb-asset-thumb-cell [title="Change thumbnail for Cliff Path"] img')).not.toBeNull()
    for (const n of ['Mara', 'Festival DCP']) {
      expect(screen.getByRole('button', { name: `Set thumbnail for ${n}` }).closest('td').classList.contains('rb-asset-thumb-cell')).toBe(true)
    }
  })

  it('W9: the bulk delete asks on the kit Dialog — Cancel leaves the assets, Delete deletes them; window.confirm is never called', () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { ctx } = page()
    fireEvent.click(screen.getByRole('button', { name: 'Select Mara' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select Festival DCP' }))
    expect(screen.getByText('2 selected')).toBeTruthy()
    // The kit Row's own selection (R4-22).
    expect(screen.getByRole('button', { name: 'Select Mara' }).closest('tr').getAttribute('data-selected')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete assets' })
    expect(dialog.textContent).toContain('Delete 2 assets?')
    expect(document.activeElement.textContent).toBe('Cancel')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.deleteAssets).not.toHaveBeenCalled()
    expect(screen.getByText('2 selected')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    dialog = screen.getByRole('dialog', { name: 'Delete assets' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(ctx.deleteAssets).toHaveBeenCalledTimes(1)
    expect(ctx.deleteAssets).toHaveBeenCalledWith(['a1', 'a3'])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('2 selected')).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('saving a view asks on the kit Dialog, and the view lands in the Views menu', () => {
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Views' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save current view' }))
    const dialog = screen.getByRole('dialog', { name: 'Save current view' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'View name' }), { target: { value: 'Pre only' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Views' }))
    expect(screen.getByText('Pre only')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete the saved view "Pre only"' })).toBeTruthy()
  })

  it('grouped by status, each group is one band: a button with the kit StatusDot, its words and its count', () => {
    const { container } = page()
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'status' } })
    const bands = [...container.querySelectorAll('tbody tr.rb-asset-group-row')]
    expect(bands.map((r) => r.textContent)).toEqual(['Not started1', 'In progress1', 'Approved1'])
    for (const r of bands) {
      expect(r.querySelector('.ui-status-dot')).not.toBeNull()
      expect(r.querySelector('[style]')).toBeNull()
    }
    const toggle = within(bands[0]).getByRole('button')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('tbody tr.rb-asset-row')).toHaveLength(2)
  })

  it('the Gallery tab draws the cards: the kit Card, the kit StatusBadge, "N task(s)" in the mono', () => {
    const { container } = page()
    fireEvent.click(screen.getByRole('tab', { name: 'Gallery' }))
    expect(container.querySelector('table')).toBeNull()
    const cards = [...container.querySelectorAll('.rb-asset-card')]
    expect(cards).toHaveLength(3)
    for (const c of cards) expect(c.classList.contains('ui-card')).toBe(true)
    expect(screen.getByRole('tabpanel').contains(cards[0])).toBe(true)
    // The walk proves the gallery by this text: it stays exactly as it was.
    expect(cards.map((c) => c.querySelector('.rb-asset-card-count').textContent)).toEqual(['2 tasks', '1 task', '0 tasks'])
    expect(cards[1].querySelector('.ui-status').textContent).toBe('In progress')
    expect(screen.getByRole('button', { name: 'Delete Festival DCP' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Status mismatch — click for details' })).toBeTruthy()
  })

  it('a read-only viewer keeps the gate: New asset greyed in place, every cell plain or disabled, no delete', () => {
    const { container, ctx } = page({ reviewer: true })
    // GatedAction: the control stays where it was, greyed, and says why.
    const add = screen.getByRole('button', { name: 'New asset' })
    expect(add.closest('[aria-disabled="true"]')).not.toBeNull()
    for (const s of container.querySelectorAll('tbody select, tbody input')) expect(s.disabled).toBe(true)
    expect(container.querySelector('tbody .rb-asset-cell-text[data-static="true"]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete Mara' })).toBeNull()
    // Selecting still works; the bulk actions are the gated group.
    fireEvent.click(screen.getByRole('button', { name: 'Select Mara' }))
    const bulk = container.querySelector('.rb-asset-bulk')
    expect(bulk.querySelector('[aria-disabled="true"]')).not.toBeNull()
    expect(ctx.updateAsset).not.toHaveBeenCalled()
  })

  it('an empty project says so with the kit EmptyState, in sentence case', () => {
    page({ assets: [] })
    const empty = screen.getByRole('status')
    expect(empty.className).toContain('ui-empty')
    expect(empty.querySelector('.ui-empty-title').textContent).toBe('No assets yet')
    expect(empty.textContent).toContain('to get started')
  })
})

describe('ProjectAssetsView — the popups on the kit', () => {
  // jsdom loads no stylesheet: give it the position rules a browser has — the
  // hand-rolled layers' `fixed` (Tailwind's) and the kit backdrop's — so the
  // layer guard is tested against what the app computes, and a guard that
  // scanned the whole document (and found the backdrop) would fail here too.
  // FileManager asks the desktop route for video support on mount.
  let positions, realFetch
  beforeAll(() => {
    positions = document.createElement('style')
    positions.textContent = '.fixed { position: fixed; } .ui-dialog-backdrop { position: fixed; }'
    document.head.appendChild(positions)
    realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('no network in this test')))
  })
  afterAll(() => { positions.remove(); globalThis.fetch = realFetch })

  const escape = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
  const openDetail = (name) => {
    const i = ASSETS().findIndex((a) => a.name === name)
    fireEvent.click(screen.getAllByRole('button', { name: 'View asset details' })[i])
    return screen.getByRole('dialog', { name })
  }

  it('New asset opens the kit Dialog in <body> at the form width, titled in sentence case; Cancel creates nothing', () => {
    const { ctx } = page({ addAsset: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'New asset' }))
    const dialog = screen.getByRole('dialog', { name: 'Create new asset' })
    expect(dialog.className).toContain('ui-dialog')
    expect(dialog.getAttribute('data-width')).toBe('form')
    // Portalled: its backdrop is a child of <body>, outside the page's tree.
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    // The kit Field: the Label step over each native field; Name has focus.
    const name = within(dialog).getByRole('textbox', { name: 'Name *' })
    expect(document.activeElement).toBe(name)
    for (const f of dialog.querySelectorAll('.ui-dialog-body input, .ui-dialog-body select, .ui-dialog-body textarea')) {
      expect(f.classList.contains('ui-input')).toBe(true)
      expect(f.closest('.ui-field')).not.toBeNull()
    }
    // Status: the kit's dot beside the kit's words, and no colour of its own.
    const status = within(dialog).getByRole('combobox', { name: 'Status' })
    expect(status.getAttribute('style')).toBeNull()
    expect(status.selectedOptions[0].textContent).toBe('Not started')
    expect([...status.options].every((o) => o.getAttribute('style') === null)).toBe(true)
    expect(status.parentElement.querySelector('.ui-status-dot[data-tone="neutral"]')).not.toBeNull()
    // Every value the popup started with, and no "--" (R4-19).
    expect(within(dialog).getByRole('combobox', { name: 'Type' }).value).toBe('other')
    expect(within(dialog).getByRole('combobox', { name: 'Phase' }).selectedOptions[0].textContent).toBe('No phase')
    expect(dialog.textContent).not.toMatch(/--/)
    // The footer: the note, Cancel, and the kit primary (disabled until named).
    expect(within(dialog).getByText('Nothing is saved until you confirm.').className).toBe('rb-asset-new-note')
    const create = within(dialog).getByRole('button', { name: 'Confirm & create' })
    expect(create.getAttribute('data-variant')).toBe('primary')
    expect(create.closest('.ui-dialog-foot')).not.toBeNull()
    expect(create.disabled).toBe(true)
    fireEvent.change(name, { target: { value: 'Harbour' } })
    expect(create.disabled).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.addAsset).not.toHaveBeenCalled()
  })

  it('New asset: the backdrop and Escape still close it, creating nothing', () => {
    const { ctx } = page({ addAsset: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'New asset' }))
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New asset' }))
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.addAsset).not.toHaveBeenCalled()
  })

  it('Confirm & create builds the asset as before, applies the chosen template in dependency order, then opens the asset', async () => {
    templates.state.list = [{
      id: 'tp1', name: 'Character build', tasks: [
        { id: 'k2', name: 'Rig', role_slug: 'rigger', bid_days: 2, depends_on: ['k1'] },
        { id: 'k1', name: 'Model', role_slug: 'modeler', bid_days: 3, depends_on: [] },
      ],
    }]
    // The new asset "is" Cliff Path, so the detail popup has an asset to open.
    const { ctx } = page({
      addAsset: vi.fn(async () => ({ id: 'a2' })),
      addTask: vi.fn(async (t) => ({ id: `new-${t.title}` })),
    })
    fireEvent.click(screen.getByRole('button', { name: 'New asset' }))
    const dialog = screen.getByRole('dialog', { name: 'Create new asset' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name *' }), { target: { value: '  Harbour  ' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Type' }), { target: { value: 'environment' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Phase' }), { target: { value: 'ph1' } })
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-08-03' } })
    await within(dialog).findByRole('option', { name: 'Character build (2 tasks, 5d)' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Task template' }), { target: { value: 'tp1' } })
    // The preview: its head in the Label step, each role the kit's Badge.
    expect(within(dialog).getByText('Tasks to be created (2)')).toBeTruthy()
    expect([...dialog.querySelectorAll('.rb-asset-preview .ui-badge')].map((b) => b.textContent)).toEqual(['rigger', 'modeler'])

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm & create' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Cliff Path' })).toBeTruthy())
    expect(screen.queryByRole('dialog', { name: 'Create new asset' })).toBeNull()
    expect(ctx.addAsset).toHaveBeenCalledTimes(1)
    expect(ctx.addAsset).toHaveBeenCalledWith({
      name: 'Harbour', type: 'environment', status: 'not_started', phase_id: 'ph1',
      description: '', start_date: '2026-08-03', due_date: null, task_template_id: 'tp1',
    })
    expect(ctx.addTask.mock.calls.map(([t]) => [t.title, t.asset_id, t.assigned_role_slug, t.start_date, t.end_date])).toEqual([
      ['Model', 'a2', 'modeler', '2026-08-03', '2026-08-05'],
      ['Rig', 'a2', 'rigger', '2026-08-06', '2026-08-07'],
    ])
  })

  it('a failed create says so inside the Dialog\'s footer, and the popup keeps what was typed', async () => {
    page({ addAsset: vi.fn(async () => { throw new Error('assets: permission denied') }) })
    fireEvent.click(screen.getByRole('button', { name: 'New asset' }))
    const dialog = screen.getByRole('dialog', { name: 'Create new asset' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name *' }), { target: { value: 'Harbour' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm & create' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toBe('assets: permission denied')
    expect(alert.closest('.ui-dialog-foot')).not.toBeNull()
    expect(within(dialog).getByRole('textbox', { name: 'Name *' }).value).toBe('Harbour')
  })

  it('View asset details opens the kit Dialog in <body>, 1152px wide and named by the asset; Done is the kit primary; Escape closes it', () => {
    page()
    const dialog = openDetail('Mara')
    expect(dialog.className).toContain('ui-dialog')
    expect(dialog.style.width).toBe('1152px')
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    // The title is the editable name (R4-09), with the status as the kit's
    // badge where the status-coloured rule under the header said it.
    expect(within(dialog.querySelector('.ui-dialog-title')).getByRole('button', { name: 'Mara' })).toBeTruthy()
    expect(dialog.querySelector('.ui-dialog-subtitle .ui-status').textContent).toBe('Approved')
    const done = within(dialog).getByRole('button', { name: 'Done' })
    expect(done.className).toContain('ui-btn')
    expect(done.getAttribute('data-variant')).toBe('primary')
    expect(done.closest('.ui-dialog-foot')).not.toBeNull()
    // No inline colour anywhere in the popup, and no "--" (R4-19).
    for (const el of dialog.querySelectorAll('[style]')) expect(el.getAttribute('style')).not.toMatch(/color/)
    expect(dialog.textContent).not.toMatch(/--/)
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()

    // Done and the backdrop close it too, as they did.
    fireEvent.click(within(openDetail('Mara')).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.mouseDown(openDetail('Mara').parentElement)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the title edits the name in place: Enter commits; Escape reverts and the popup stays, and the next Escape closes it', () => {
    const { ctx } = page()
    const dialog = openDetail('Mara')
    const title = dialog.querySelector('.ui-dialog-title')
    fireEvent.click(within(title).getByRole('button', { name: 'Mara' }))
    let field = within(title).getByRole('textbox', { name: 'Name' })
    expect(field.className).toContain('ui-input')
    fireEvent.change(field, { target: { value: 'Mara Vance' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(ctx.updateAsset).toHaveBeenCalledWith('a1', { name: 'Mara Vance' })

    fireEvent.click(within(title).getByRole('button', { name: 'Mara' }))
    field = within(title).getByRole('textbox', { name: 'Name' })
    fireEvent.change(field, { target: { value: 'Oops' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Mara' })).toBeTruthy()
    expect(within(title).queryByRole('textbox')).toBeNull()
    expect(ctx.updateAsset).not.toHaveBeenCalledWith('a1', { name: 'Oops' })
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the property grid: status a StatusDot beside the kit CellSelect with no colour of its own; every other select the kit\'s; the dates the lane\'s field', () => {
    const { ctx } = page()
    const dialog = openDetail('Mara')
    const status = within(dialog).getByRole('combobox', { name: 'Status' })
    expect(status.closest('.ui-cell-select')).not.toBeNull()
    expect(status.getAttribute('style')).toBeNull()
    expect(status.selectedOptions[0].textContent).toBe('Approved')
    expect(status.closest('.rb-asset-status').querySelector('.ui-status-dot[data-tone="success"]')).not.toBeNull()
    for (const n of ['Type', 'Phase', 'Task template']) {
      expect(within(dialog).getByRole('combobox', { name: n }).closest('.ui-cell-select'), n).not.toBeNull()
    }
    expect(within(dialog).getByRole('combobox', { name: 'Phase' }).selectedOptions[0].textContent).toBe('Pre-production')
    fireEvent.change(status, { target: { value: 'final' } })
    expect(ctx.updateAsset).toHaveBeenCalledWith('a1', { status: 'final' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Phase' }), { target: { value: '' } })
    expect(ctx.updateAsset).toHaveBeenLastCalledWith('a1', { phase_id: null })
    // The dates: the lane's borderless field with its dark picker (R4-28).
    const start = within(dialog).getByLabelText('Start date')
    expect(start.className).toBe('rb-asset-date')
    expect(start.value).toBe('2026-08-03')
    expect(within(dialog).getByLabelText('Due date').value).toBe('2026-08-19')
    // Tasks: a count, in the mono.
    expect(dialog.querySelector('.rb-asset-prop-value[data-numeric="true"]').textContent).toBe('2')
    // The description opens its editor, whose Escape reverts and keeps the popup.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lead. Wardrobe, hair, the coat.' }))
    const desc = within(dialog).getByRole('textbox', { name: 'Description' })
    fireEvent.change(desc, { target: { value: 'Changed' } })
    fireEvent.keyDown(desc, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Mara' })).toBeTruthy()
    expect(within(dialog).queryByRole('textbox', { name: 'Description' })).toBeNull()
  })

  it('the tasks table is the kit Table, dense: a StatusDot and the kit CellSelect in each row, the bid a numeric cell', () => {
    team.current = { members: [{ id: 'm1', name: 'Ines Ruiz' }, { id: 'm2', name: 'Tomas Berg' }] }
    const { ctx } = page({
      tasks: [
        { id: 't1', asset_id: 'a1', title: 'Wardrobe pass', status: 'in_progress', bid_days: 2.5, assignee_id: 'm1' },
        { id: 't2', asset_id: 'a1', title: 'Hair groom', status: 'final', bid_days: null },
      ],
      teamAssignments: [{ member_id: 'm1' }, { member_id: 'm2' }],
      updateTask: vi.fn(),
    })
    const dialog = openDetail('Mara')
    const table = dialog.querySelector('table.ui-table[data-dense="true"]')
    expect(table).not.toBeNull()
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Title', 'Status', 'Bid', 'Assignee', 'Reviewer'])
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2)
    // R4-17: the bid right-aligned and tabular under a numeric header; none is
    // an em dash (R4-19).
    expect([...table.querySelectorAll('thead th')].find((th) => th.textContent === 'Bid').getAttribute('data-numeric')).toBe('true')
    expect([...table.querySelectorAll('tbody td[data-numeric="true"]')].map((td) => td.textContent)).toEqual(['2.5d', '—'])
    // R4-05: the kit's dot beside the kit's words; the select has no colour.
    const status = within(table).getByRole('combobox', { name: 'Status for Wardrobe pass' })
    expect(status.closest('.ui-cell-select')).not.toBeNull()
    expect(status.getAttribute('style')).toBeNull()
    expect(status.selectedOptions[0].textContent).toBe('In progress')
    expect(status.closest('td').querySelector('.ui-status-dot[data-tone="signal"]')).not.toBeNull()
    for (const el of table.querySelectorAll('[style]')) expect(el.getAttribute('style')).not.toMatch(/color/)
    // Assignee and reviewer: the kit's CellSelect, "—" for nobody.
    const assignee = within(table).getByRole('combobox', { name: 'Assignee for Wardrobe pass' })
    expect(assignee.closest('.ui-cell-select')).not.toBeNull()
    expect(assignee.selectedOptions[0].textContent).toBe('Ines Ruiz')
    expect(within(table).getByRole('combobox', { name: 'Reviewer for Hair groom' }).selectedOptions[0].textContent).toBe('—')
    fireEvent.change(assignee, { target: { value: 'm2' } })
    expect(ctx.updateTask).toHaveBeenLastCalledWith('t1', { assignee_id: 'm2' })
    fireEvent.change(assignee, { target: { value: '' } })
    expect(ctx.updateTask).toHaveBeenLastCalledWith('t1', { assignee_id: null })
    fireEvent.change(status, { target: { value: 'pending_review' } })
    expect(ctx.updateTask).toHaveBeenLastCalledWith('t1', { status: 'pending_review' })
  })

  it('an asset with no tasks says so with the kit EmptyState', () => {
    page()
    const dialog = openDetail('Festival DCP')
    expect(dialog.querySelector('table.ui-table[data-dense="true"]')).toBeNull()
    expect(within(dialog).getByText('No tasks on this asset').closest('.ui-empty')).not.toBeNull()
  })

  // B4b surface 4 rewrote this one: the fields are RelationsPanel's
  // RelationBadge now (R4-27; the "N scene(s)" words it pinned are gone), and
  // the pickers are the kit Dialog, portalled: on the modal stack, so an
  // Escape is the picker's alone and needs no guard from the popup.
  it('the relation fields are the RelationBadge and keep their clicks; a picker opened from the popup (its own, or the sidebar\'s) is a kit Dialog on top, so Escape closes only it', () => {
    const assets = ASSETS()
    assets[0].scene_ids = ['s1']
    page({
      assets,
      project: { id: 'p1', name: 'Salt Hours', scenes_enabled: true },
      scenes: [{ id: 's1', name: 'Harbour at dawn' }, { id: 's2', name: 'Night market' }],
      shots: [],
    })
    const dialog = openDetail('Mara')
    // The count and the one active treatment; none is "0", quiet.
    const scenes = within(dialog).getByRole('button', { name: 'Scenes: 1 linked' })
    const shots = within(dialog).getByRole('button', { name: 'Shots: 0 linked' })
    expect(scenes.className).toBe('rb-rel-badge')
    expect(scenes.getAttribute('data-active')).toBe('true')
    expect(shots.getAttribute('data-active')).toBe('false')

    fireEvent.click(scenes)
    const picker = screen.getByRole('dialog', { name: 'Link scenes' })
    expect(picker.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    escape()
    expect(screen.queryByRole('dialog', { name: 'Link scenes' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Mara' })).toBeTruthy()
    // The picker still closes on its own backdrop, and the popup stays.
    fireEvent.click(scenes)
    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Link scenes' }).parentElement)
    expect(screen.queryByRole('dialog', { name: 'Link scenes' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Mara' })).toBeTruthy()

    // The relations sidebar's own picker: the same Dialog, the same Escape.
    fireEvent.click(within(dialog.querySelector('.rb-asset-detail-side')).getByRole('button', { name: 'Link scene' }))
    expect(screen.getByRole('dialog', { name: 'Link scenes' })).toBeTruthy()
    escape()
    expect(screen.queryByRole('dialog', { name: 'Link scenes' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Mara' })).toBeTruthy()
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
