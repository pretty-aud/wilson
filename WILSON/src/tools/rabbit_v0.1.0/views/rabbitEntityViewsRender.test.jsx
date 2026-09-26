/** @vitest-environment jsdom */
// =============================================================================
// Lane B4c, surface 6 (step A), mounted: LevelsView and ExperiencesView are
// ONE component now — EntityListView, each page a thin file with its own
// `entity` config (review R4-11: the two were a verbatim twin). What each
// page DOES with its config, not how the source reads: its own words on
// screen, its own ctx writers (never the other entity's), its own default
// name, its own saved-views storage key, both delete questions (the row's
// ConfirmDialog and the bulk one, W9's kit Dialog since step B), and a new
// task linked by its own key. The DOM is unchanged by the fold; the DOM
// fingerprints prove that, this file proves the wiring.
//
// Step B (the restyle onto the kit) changed three interactions here and no
// assertion: a row is its <tr> (the kit Table's), a row's checkbox is a named
// button, and the bulk question is a kit Dialog, not window.confirm. The
// create popup's title and button are in sentence case (Q2): "New level",
// "Confirm & create". Its second describe block pins the kit itself.
//
// Step C put the detail popup on the kit, and changed one assertion above:
// the popup is found as the kit Dialog named by its row (it was the
// hand-rolled `.max-w-4xl` box), and its two date fields, which carried R4-11's
// drift (ring-2 in Levels, ring-1 in Experiences) until then, carry no ring
// utility at all — the drift is the thing step C removed. The third describe
// block pins the popup: the kit Dialog in <body>, W2 in its text fields, the
// status CellSelect, the task form INSIDE the Dialog as its first column,
// and a task opened from the sidebar as a kit Dialog over it, whose Escape is
// its own.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { _resetOverlaysForTests, focusableWithin } from '../../../ui/overlay'
import { statusMeta } from '../../../ui/StatusDot'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
// The context and the view's two hooks each return ONE object for the whole
// test: a new one per render would re-key every memo that reads them.
const rabbit = vi.hoisted(() => ({ current: null }))
const team = vi.hoisted(() => ({ current: { members: [] } }))
const rates = vi.hoisted(() => ({ current: { entries: [] } }))
vi.mock('../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => team.current }))
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => rates.current }))
// A task opened from the popup's sidebar is TaskDetailPopup, which reads the
// roster and the app role (rabbitTasksFilesRender.test.jsx's stand-ins).
const roster = vi.hoisted(() => ({ current: { members: [], mode: 'supabase' } }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => roster.current }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true }) }))

const { default: LevelsView } = await import('./LevelsView')
const { default: ExperiencesView } = await import('./ExperiencesView')

afterEach(() => { cleanup(); _resetOverlaysForTests(); vi.restoreAllMocks(); localStorage.clear() })

const LEVEL_WRITERS = ['addLevel', 'updateLevel', 'deleteLevel']
const EXPERIENCE_WRITERS = ['addExperience', 'updateExperience', 'deleteExperience']

const PAGES = [
  {
    page: 'LevelsView', View: LevelsView,
    noun: 'level', nouns: 'levels', Noun: 'Level',
    ids: ['l1', 'l2'], names: ['Harbour Approach', 'Cliff Path'], others: ['First Light', 'Night Market'],
    counts: [['1', '2'], ['0', '0']],
    add: 'addLevel', update: 'updateLevel', remove: 'deleteLevel', otherWriters: EXPERIENCE_WRITERS,
    key: 'rabbit_level_saved_views', otherKey: 'rabbit_experience_saved_views',
    link: 'level_id', otherLink: 'experience_id', glyph: /lucide-gamepad/,
    // Grouped by status, in the STATUSES order: each band's words and count.
    bands: ['In progress1', 'Blocked1'],
  },
  {
    page: 'ExperiencesView', View: ExperiencesView,
    noun: 'experience', nouns: 'experiences', Noun: 'Experience',
    ids: ['e1', 'e2'], names: ['First Light', 'Night Market'], others: ['Harbour Approach', 'Cliff Path'],
    counts: [['0', '1'], ['1', '0']],
    add: 'addExperience', update: 'updateExperience', remove: 'deleteExperience', otherWriters: LEVEL_WRITERS,
    key: 'rabbit_experience_saved_views', otherKey: 'rabbit_level_saved_views',
    link: 'experience_id', otherLink: 'level_id', glyph: /lucide-sparkles/,
    bands: ['Not started1', 'Approved1'],
  },
]

// Both entities' rows are in the context, so a page that read the other's
// list would show them; every writer of both is a spy. The asset and the
// tasks link to rows of both, each by its entity's key. `extra` replaces
// parts of the context (step C's popup tests give the tasks titles).
function mount(View, extra = {}) {
  const ctx = {
    project: { id: 'p1', name: 'Salt Hours', levels_enabled: true, experiences_enabled: true },
    levels: [
      { id: 'l1', name: 'Harbour Approach', status: 'in_progress', sort_order: 0 },
      { id: 'l2', name: 'Cliff Path', status: 'blocked', sort_order: 1 },
    ],
    experiences: [
      { id: 'e1', name: 'First Light', status: 'approved', sort_order: 0 },
      { id: 'e2', name: 'Night Market', status: 'not_started', sort_order: 1 },
    ],
    assets: [{ id: 'a1', level_id: 'l1', experience_id: 'e2' }],
    tasks: [{ id: 't1', level_id: 'l1', experience_id: 'e1' }, { id: 't2', level_id: 'l1' }],
    phases: [], teamAssignments: [],
    addLevel: vi.fn(async () => {}), updateLevel: vi.fn(), deleteLevel: vi.fn(async () => {}),
    addExperience: vi.fn(async () => {}), updateExperience: vi.fn(), deleteExperience: vi.fn(async () => {}),
    addTask: vi.fn(async () => {}),
    ...extra,
  }
  rabbit.current = ctx
  return { ctx, ...render(<View />) }
}

/** A table row, by the name it shows: the kit Table's <tr>. */
const row = (name) => screen.getByText(name).closest('tr')
/** Tick a row's checkbox: the named button in its first cell. */
const tick = (name) => fireEvent.click(within(row(name)).getByRole('button', { name: `Select ${name}` }))

describe.each(PAGES)('$page — EntityListView with its own config', (p) => {
  it('shows its own noun and its own rows, none of the other entity\'s, counted by its own link key', () => {
    mount(p.View)
    expect(screen.getByRole('button', { name: `New ${p.noun}` })).toBeTruthy()
    expect(screen.queryByRole('button', { name: `New ${p.noun === 'level' ? 'experience' : 'level'}` })).toBeNull()
    for (const name of p.names) expect(within(row(name)).getByRole('button', { name: `Delete ${p.noun}` })).toBeTruthy()
    for (const name of p.others) expect(screen.queryByText(name)).toBeNull()
    // A row's cells: checkbox, name, status, assets, tasks, description, actions.
    p.names.forEach((name, i) => {
      const cells = row(name).children
      expect([cells[3].textContent, cells[4].textContent]).toEqual(p.counts[i])
    })
    expect(screen.getByText('2/2')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'zzz' } })
    expect(screen.getByText(`No ${p.nouns} yet`)).toBeTruthy()
  })

  it('a row\'s status change calls its own update method with { status }', () => {
    const { ctx } = mount(p.View)
    p.names.forEach((name, i) => {
      fireEvent.change(within(row(name)).getByRole('combobox'), { target: { value: 'final' } })
      expect(ctx[p.update]).toHaveBeenLastCalledWith(p.ids[i], { status: 'final' })
    })
    expect(ctx[p.update]).toHaveBeenCalledTimes(2)
    for (const m of p.otherWriters) expect(ctx[m]).not.toHaveBeenCalled()
  })

  it(`the create popup opens on the default name and creates by its own add method`, async () => {
    const { ctx } = mount(p.View)
    fireEvent.click(screen.getByRole('button', { name: `New ${p.noun}` }))
    // Titled in sentence case (Q2): "New level", as its button says.
    expect(screen.getByRole('dialog', { name: `New ${p.noun}` })).toBeTruthy()
    // Two rows, so the next is the third.
    expect(screen.getByDisplayValue(`${p.Noun} 3`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & create' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: `New ${p.noun}` })).toBeNull())
    expect(ctx[p.add]).toHaveBeenCalledTimes(1)
    expect(ctx[p.add]).toHaveBeenCalledWith({ name: `${p.Noun} 3`, status: 'not_started', description: '', files: [] })
    for (const m of p.otherWriters) expect(ctx[m]).not.toHaveBeenCalled()
  })

  it('the saved views read and write its own storage key, and only that', () => {
    localStorage.setItem(p.key, JSON.stringify([{ id: 'v1', name: 'By status', groupBy: 'status' }]))
    localStorage.setItem(p.otherKey, JSON.stringify([{ id: 'v2', name: 'Theirs' }]))
    mount(p.View)
    fireEvent.click(screen.getByRole('button', { name: 'Views' }))
    expect(screen.queryByText('Theirs')).toBeNull()
    // Loading it applies it: the group control reads Status.
    fireEvent.click(screen.getByText('By status'))
    expect(screen.getByDisplayValue('Status')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Views' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save current view' }))
    fireEvent.change(screen.getByPlaceholderText('View name...'), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = JSON.parse(localStorage.getItem(p.key))
    expect(saved.map((v) => v.name)).toEqual(['By status', 'Mine'])
    expect(saved[1]).toMatchObject({ groupBy: 'status', viewMode: 'table' })
    expect(JSON.parse(localStorage.getItem(p.otherKey)).map((v) => v.name)).toEqual(['Theirs'])
  })

  it('deleting a row asks first (the ConfirmDialog), then calls its own delete method', async () => {
    const { ctx } = mount(p.View)
    const ask = () => fireEvent.click(within(row(p.names[1])).getByRole('button', { name: `Delete ${p.noun}` }))
    ask()
    expect(screen.getByText(`Delete ${p.noun}?`)).toBeTruthy()
    expect(screen.getByText(`This will permanently delete "${p.names[1]}".`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(`Delete ${p.noun}?`)).toBeNull()
    expect(ctx[p.remove]).not.toHaveBeenCalled()
    ask()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText(`Delete ${p.noun}?`)).toBeNull())
    expect(ctx[p.remove]).toHaveBeenCalledTimes(1)
    expect(ctx[p.remove]).toHaveBeenCalledWith(p.ids[1])
    for (const m of p.otherWriters) expect(ctx[m]).not.toHaveBeenCalled()
  })

  it('a bulk delete asks on the kit Dialog in its own noun: Cancel deletes nothing, Delete deletes each selected row', () => {
    const { ctx } = mount(p.View)
    const confirm = vi.spyOn(window, 'confirm')
    // W9: the question is the kit Dialog's; `Delete` opens it, Cancel answers no.
    const ask = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      return screen.getByRole('dialog', { name: `Delete ${p.nouns}` })
    }
    tick(p.names[0])
    let dialog = ask()
    expect(within(dialog).getByText(`Delete 1 ${p.noun}?`)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    tick(p.names[1])
    dialog = ask()
    expect(within(dialog).getByText(`Delete 2 ${p.nouns}?`)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx[p.remove]).not.toHaveBeenCalled()
    expect(screen.getByText('2 selected')).toBeTruthy()
    fireEvent.click(within(ask()).getByRole('button', { name: 'Delete' }))
    expect(ctx[p.remove].mock.calls).toEqual([[p.ids[0]], [p.ids[1]]])
    expect(screen.queryByText('2 selected')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
    for (const m of p.otherWriters) expect(ctx[m]).not.toHaveBeenCalled()
  })

  it('the detail popup is its own: its noun, its update method, a new task linked by its key, and its date fields on the kit\'s one focus treatment', async () => {
    const { ctx } = mount(p.View)
    fireEvent.click(within(row(p.names[0])).getByRole('button', { name: 'View details' }))
    // Step C: the kit Dialog, named by its row (it was the `.max-w-4xl` box).
    const popup = screen.getByRole('dialog', { name: p.names[0] })
    expect(within(popup).getByText(`${p.Noun} name`)).toBeTruthy()
    expect(within(popup).getByRole('button', { name: `Delete ${p.noun}` })).toBeTruthy()
    fireEvent.change(within(popup).getByRole('combobox', { name: 'Status' }), { target: { value: 'approved' } })
    expect(ctx[p.update]).toHaveBeenCalledWith(p.ids[0], { status: 'approved' })
    // R4-11's one drift — ring-2 in Levels, ring-1 in Experiences, carried in
    // the config until step C — is gone: both pages' two date fields carry
    // the same classes and no ring or focus utility (the kit's own :focus-visible).
    const dates = popup.querySelectorAll('input[type="date"]')
    expect(dates).toHaveLength(2)
    for (const d of dates) {
      expect(d.className.split(' ').filter((c) => /ring|focus:/.test(c))).toEqual([])
      expect(d.className).toBe('rb-ent-date')
    }
    // + in its Tasks group: the new task carries this row's id under its own key.
    fireEvent.click(within(popup).getByRole('button', { name: 'Add new task' }))
    fireEvent.change(screen.getByPlaceholderText('Task title…'), { target: { value: 'Blockout' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(screen.queryByPlaceholderText('Task title…')).toBeNull())
    expect(ctx.addTask).toHaveBeenCalledTimes(1)
    expect(ctx.addTask.mock.calls[0][0]).toMatchObject({ title: 'Blockout', [p.link]: p.ids[0], [p.otherLink]: null })
    for (const m of p.otherWriters) expect(ctx[m]).not.toHaveBeenCalled()
  })
})

// =============================================================================
// Step B, mounted: the page on the kit — what it DRAWS and how it asks, for
// both pages. The detail popup is step C's and is not pinned here.
// =============================================================================

/** Every inline style on the page is a kit header cell's width, never a colour
    or a state (the rows' status spine and every hex went with R4-05). */
const onlyWidths = (root) => [...root.querySelectorAll('[style]')]
  .filter((el) => !(el.tagName === 'TH' && /^width: var\(--rb-ent-[a-z]+\);$/.test(el.getAttribute('style'))))
  .map((el) => `${el.tagName} ${el.getAttribute('style')}`)

/** A kit Dialog raised into <body>, outside the page's own tree. */
const inBody = (dialog, container) => {
  expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
  expect(container.contains(dialog)).toBe(false)
}

describe.each(PAGES)('$page — on the kit (B4c surface 6, step B)', (p) => {
  it('the toolbar is the kit Toolbar at the small size, New the kit primary, Table / Gallery the kit Tabs over a named tabpanel', () => {
    const { container } = mount(p.View)
    const toolbar = container.querySelector('.ui-toolbar')
    for (const el of toolbar.querySelectorAll('.ui-btn, .ui-iconbtn, .ui-input')) expect(el.getAttribute('data-size')).toBe('sm')
    // The one filled button: the kit primary — white on the signal fill
    // (#c2410c, 5.17:1), the kit's own.
    expect(within(toolbar).getByRole('button', { name: `New ${p.noun}` }).getAttribute('data-variant')).toBe('primary')
    const tabs = within(toolbar).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Table', 'Gallery'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    const panel = screen.getByRole('tabpanel')
    expect(panel.id).toBeTruthy()
    for (const t of tabs) expect(t.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.contains(container.querySelector('table.ui-table'))).toBe(true)
    // Filter, Sort and Group say when they are doing something (the sheet
    // draws the signal edge on it); Filter says whether its strip is open.
    const filter = within(toolbar).getByRole('button', { name: 'Filter' })
    expect([filter.getAttribute('data-active'), filter.getAttribute('aria-expanded')]).toEqual(['false', 'false'])
    fireEvent.click(filter)
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    expect([filter.getAttribute('data-active'), filter.getAttribute('aria-expanded')]).toEqual(['true', 'true'])
    const sort = within(toolbar).getByRole('combobox', { name: 'Sort' })
    expect(sort.getAttribute('data-active')).toBe('false')
    fireEvent.change(sort, { target: { value: 'name' } })
    expect(sort.getAttribute('data-active')).toBe('true')
    const group = within(toolbar).getByRole('combobox', { name: 'Group' })
    fireEvent.change(group, { target: { value: 'status' } })
    expect(group.getAttribute('data-active')).toBe('true')
  })

  it('the table is the kit Table: its columns in their old order, the counts numeric cells, a status the kit\'s dot beside the kit\'s CellSelect', () => {
    const { container, ctx } = mount(p.View)
    const table = container.querySelector('table.ui-table')
    const heads = [...table.querySelectorAll('thead th')]
    expect(heads.map((th) => th.textContent)).toEqual(['', 'Name', 'Status', 'Assets', 'Tasks', 'Description', 'Actions'])
    // R4-17: the two counts right-aligned and tabular, under numeric headers.
    expect(heads.filter((th) => th.getAttribute('data-numeric') === 'true').map((th) => th.textContent)).toEqual(['Assets', 'Tasks'])
    const rows = [...table.querySelectorAll('tbody tr.ui-tr')]
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => [...r.querySelectorAll('td[data-numeric="true"]')].map((td) => td.textContent))).toEqual(p.counts)
    // The name is the row's anchor: its own button, whose text is the name.
    expect(within(rows[0]).getByRole('button', { name: p.names[0] }).getAttribute('data-quiet')).toBe('false')
    expect(within(rows[0]).getByRole('button', { name: 'No description' }).getAttribute('data-quiet')).toBe('true')
    // R4-05: the kit's words in a kit CellSelect with no colour of its own,
    // the kit's dot beside it, toned by the one STATUS map.
    const { status } = ctx[p.nouns][0]
    const select = screen.getByRole('combobox', { name: `Status for ${p.names[0]}` })
    expect(select.closest('.ui-cell-select')).not.toBeNull()
    expect(select.selectedOptions[0].textContent).toBe(statusMeta(status).label)
    expect([...select.options].map((o) => o.textContent)).toContain('Needs revisions')
    expect(select.closest('td').querySelector('.ui-status-dot').getAttribute('data-tone')).toBe(statusMeta(status).tone)
    // No row, cell or select carries a colour: the only styles are widths.
    expect(onlyWidths(container)).toEqual([])
  })

  it('every icon-only control is named — the sort direction for what a click does, each checkbox for its row, each card\'s delete for its card', () => {
    mount(p.View)
    const reverse = screen.getByRole('button', { name: 'Sorted ascending — reverse' })
    fireEvent.click(reverse)
    expect(reverse.getAttribute('title')).toBe('Sorted descending — reverse')
    expect(screen.getByRole('button', { name: `Select every ${p.noun}` })).toBeTruthy()
    for (const n of p.names) expect(screen.getByRole('button', { name: `Select ${n}` })).toBeTruthy()
    // The names the walk and the wiring tests step on stay exactly as they were.
    expect(screen.getAllByRole('button', { name: 'View details' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: `Delete ${p.noun}` })).toHaveLength(2)
    const named = () => {
      for (const b of screen.getAllByRole('button')) {
        expect(b.getAttribute('aria-label') || b.title || b.textContent.trim(), b.outerHTML.slice(0, 90)).toBeTruthy()
      }
    }
    named()
    fireEvent.click(screen.getByRole('tab', { name: 'Gallery' }))
    for (const n of p.names) expect(screen.getByRole('button', { name: `Delete ${n}` })).toBeTruthy()
    for (const s of ['sm', 'md', 'lg']) expect(screen.getByRole('button', { name: `${s} cards` })).toBeTruthy()
    named()
  })

  it('the Gallery tab draws the kit Cards under data-entity-view="gallery": a status the kit StatusBadge, the size its data-card; a card opens its detail and its delete asks', () => {
    const { container, ctx } = mount(p.View)
    fireEvent.click(screen.getByRole('tab', { name: 'Gallery' }))
    expect(container.querySelector('table')).toBeNull()
    // The walk proves the gallery by this attribute.
    const gallery = container.querySelector('[data-entity-view="gallery"]')
    expect(screen.getByRole('tabpanel').contains(gallery)).toBe(true)
    const cards = [...gallery.querySelectorAll('.rb-ent-card')]
    expect(cards).toHaveLength(2)
    for (const c of cards) expect(c.classList.contains('ui-card')).toBe(true)
    expect(cards.map((c) => c.querySelector('.ui-status').textContent)).toEqual(ctx[p.nouns].map((i) => statusMeta(i.status).label))
    // The card sizes as they were, keyed on one attribute; the chosen size says so.
    expect(gallery.getAttribute('data-card')).toBe('md')
    fireEvent.click(screen.getByRole('button', { name: 'lg cards' }))
    expect(gallery.getAttribute('data-card')).toBe('lg')
    for (const s of ['sm', 'md', 'lg']) {
      expect(screen.getByRole('button', { name: `${s} cards` }).getAttribute('aria-pressed')).toBe(String(s === 'lg'))
    }
    expect(onlyWidths(container)).toEqual([])
    // A card's delete asks the row's question, and does not open the card.
    fireEvent.click(screen.getByRole('button', { name: `Delete ${p.names[1]}` }))
    expect(within(screen.getByRole('dialog', { name: `Delete ${p.noun}?` })).getByText(`This will permanently delete "${p.names[1]}".`)).toBeTruthy()
    expect(screen.queryByText(`${p.Noun} name`)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    // The whole card opens the detail popup, as it did.
    fireEvent.click(cards[0])
    expect(screen.getByText(`${p.Noun} name`)).toBeTruthy()
  })

  it('grouped by status: a band per status — one button, the kit\'s StatusDot, the status in the kit\'s words, its count — then that group\'s own table', () => {
    const { container } = mount(p.View)
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'status' } })
    const bands = [...container.querySelectorAll('.rb-ent-group-toggle')]
    expect(bands.map((b) => b.textContent)).toEqual(p.bands)
    for (const b of bands) {
      expect(b.tagName).toBe('BUTTON')
      expect(b.querySelector('.ui-status-dot')).not.toBeNull()
      expect(b.getAttribute('aria-expanded')).toBe('true')
    }
    // Each group keeps its own table, head and selection, as it did.
    expect(container.querySelectorAll('table.ui-table')).toHaveLength(2)
    fireEvent.click(bands[0])
    expect(bands[0].getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('table.ui-table')).toHaveLength(1)
    expect(onlyWidths(container)).toEqual([])
  })

  it('every question is the kit Dialog, portalled into <body>: the row\'s delete and the bulk one at the confirm width, New at the form width', () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { container } = mount(p.View)
    fireEvent.click(within(row(p.names[0])).getByRole('button', { name: `Delete ${p.noun}` }))
    let dialog = screen.getByRole('dialog', { name: `Delete ${p.noun}?` })
    inBody(dialog, container)
    expect(dialog.getAttribute('data-width')).toBe('confirm')
    // Cancel takes focus first, and Escape closes it now (Q17).
    expect(document.activeElement.textContent).toBe('Cancel')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    tick(p.names[0])
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    dialog = screen.getByRole('dialog', { name: `Delete ${p.nouns}` })
    inBody(dialog, container)
    expect(dialog.getAttribute('data-width')).toBe('confirm')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: `New ${p.noun}` }))
    dialog = screen.getByRole('dialog', { name: `New ${p.noun}` })
    inBody(dialog, container)
    expect(dialog.getAttribute('data-width')).toBe('form')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('a press on the backdrop answers the delete question and New as it always did: the row stays, nothing is created — and a press inside either keeps it open', () => {
    const { ctx } = mount(p.View)
    fireEvent.click(within(row(p.names[0])).getByRole('button', { name: `Delete ${p.noun}` }))
    const question = screen.getByRole('dialog', { name: `Delete ${p.noun}?` })
    // CONTROL: a press on the question itself is not a press on its backdrop.
    fireEvent.mouseDown(question)
    expect(screen.getByRole('dialog', { name: `Delete ${p.noun}?` })).toBe(question)
    fireEvent.mouseDown(question.parentElement)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx[p.remove]).not.toHaveBeenCalled()
    expect(row(p.names[0])).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: `New ${p.noun}` }))
    const create = screen.getByRole('dialog', { name: `New ${p.noun}` })
    fireEvent.mouseDown(create)
    expect(screen.getByRole('dialog', { name: `New ${p.noun}` })).toBe(create)
    fireEvent.mouseDown(create.parentElement)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx[p.add]).not.toHaveBeenCalled()
  })

  it('New: the kit Fields, the status the kit\'s dot and words, the files picker with a named remove per file; Cancel creates nothing', () => {
    const { ctx } = mount(p.View)
    fireEvent.click(screen.getByRole('button', { name: `New ${p.noun}` }))
    const dialog = screen.getByRole('dialog', { name: `New ${p.noun}` })
    const name = within(dialog).getByRole('textbox', { name: 'Name *' })
    expect(name.value).toBe(`${p.Noun} 3`)
    expect(document.activeElement).toBe(name)
    const status = within(dialog).getByRole('combobox', { name: 'Status' })
    expect(status.selectedOptions[0].textContent).toBe('Not started')
    expect(status.getAttribute('style')).toBeNull()
    expect(status.parentElement.querySelector('.ui-status-dot[data-tone="neutral"]')).not.toBeNull()
    expect(within(dialog).getByRole('textbox', { name: 'Description' }).getAttribute('placeholder')).toBe('Description...')
    // Add files opens the picker; a picked file lists, and its remove is named for it.
    const picker = dialog.querySelector('input[type="file"]')
    expect(picker.multiple).toBe(true)
    const open = vi.spyOn(picker, 'click')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add files' }))
    expect(open).toHaveBeenCalledTimes(1)
    fireEvent.change(picker, { target: { files: [new File(['x'], 'blockout.uasset')] } })
    expect(within(dialog).getByText('blockout.uasset')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove blockout.uasset' }))
    expect(within(dialog).queryByText('blockout.uasset')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx[p.add]).not.toHaveBeenCalled()
  })
})

// =============================================================================
// Step C, mounted: the detail popup on the kit — for both pages. What it IS
// (the kit Dialog in <body>, named by its row, its title, badge and footer),
// how it closes (Escape now, the backdrop and Close as before), W2 in its
// three text fields, the status the kit's CellSelect calling the page's own
// writer, the task form inside it and a task opened from it over it.
// =============================================================================

describe.each(PAGES)('$page — the detail popup on the kit (B4c surface 6, step C)', (p) => {
  const openPopup = (name = p.names[0]) => {
    fireEvent.click(within(row(name)).getByRole('button', { name: 'View details' }))
    return screen.getByRole('dialog', { name })
  }
  const escape = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })

  it('is the kit Dialog in <body>, 896px and named by its row: the glyph and name its H2 title, its status the kit StatusBadge, every control named, Delete the kit danger at the footer\'s left; Escape, the backdrop and Close close it', () => {
    const { container, ctx } = mount(p.View)
    const dialog = openPopup()
    inBody(dialog, container)
    expect(dialog.classList.contains('ui-dialog')).toBe(true)
    expect(dialog.classList.contains('rb-ent-detail')).toBe(true)
    expect(dialog.style.width).toBe('896px')
    // The title: the entity's glyph and the name, read-only — the "<Noun>
    // name" field is still where the name is edited (C1: the two stay two).
    const title = dialog.querySelector('.ui-dialog-title')
    expect(title.textContent).toBe(p.names[0])
    expect(title.querySelector('svg').getAttribute('class')).toMatch(p.glyph)
    expect(within(title).queryByRole('button')).toBeNull()
    const main = dialog.querySelector('.rb-ent-detail-main')
    expect(within(main).getByText(`${p.Noun} name`)).toBeTruthy()
    expect(within(main).getByRole('button', { name: p.names[0] })).toBeTruthy()
    // The status, where the status-coloured rule under the header said it.
    const { status } = ctx[p.nouns][0]
    expect(dialog.querySelector('.ui-dialog-subtitle .ui-status').textContent).toBe(statusMeta(status).label)
    // The kit's ✕ is named (the old one was not); so is every other control.
    expect(within(dialog.querySelector('.ui-dialog-head')).getByRole('button', { name: 'Close' })).toBeTruthy()
    for (const b of within(dialog).getAllByRole('button')) {
      expect(b.getAttribute('aria-label') || b.title || b.textContent.trim(), b.outerHTML.slice(0, 90)).toBeTruthy()
    }
    const foot = dialog.querySelector('.ui-dialog-foot')
    const del = within(foot).getByRole('button', { name: `Delete ${p.noun}` })
    expect(del.getAttribute('data-variant')).toBe('danger')
    expect(foot.firstElementChild).toBe(del)
    expect(within(foot).getByRole('button', { name: 'Close' }).getAttribute('data-variant')).toBe('secondary')
    // No inline style inside it: every colour and every state is the sheet's.
    expect([...dialog.querySelectorAll('[style]')].map((el) => el.outerHTML.slice(0, 90))).toEqual([])
    // Escape closes it now (Q17); the backdrop and Close close it as before.
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.mouseDown(openPopup().parentElement)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(openPopup().querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    // Delete closes it and asks the row's question, as it did.
    fireEvent.click(within(openPopup()).getByRole('button', { name: `Delete ${p.noun}` }))
    expect(screen.queryByRole('dialog', { name: p.names[0] })).toBeNull()
    expect(within(screen.getByRole('dialog', { name: `Delete ${p.noun}?` })).getByText(`This will permanently delete "${p.names[0]}".`)).toBeTruthy()
  })

  it('its Delete asks with focus on Cancel, as a row\'s Delete does — not on the question\'s ✕, where the popup\'s own close used to send it', () => {
    const { ctx } = mount(p.View)
    // Opened from the keyboard's place, so closing the popup hands focus back
    // to "View details" — in the same commit the question opens.
    const view = within(row(p.names[0])).getByRole('button', { name: 'View details' })
    view.focus()
    fireEvent.click(view)
    const dialog = screen.getByRole('dialog', { name: p.names[0] })
    fireEvent.click(within(dialog.querySelector('.ui-dialog-foot')).getByRole('button', { name: `Delete ${p.noun}` }))
    const question = screen.getByRole('dialog', { name: `Delete ${p.noun}?` })
    const cancel = within(question.querySelector('.ui-dialog-foot')).getByRole('button', { name: 'Cancel' })
    expect(document.activeElement).toBe(cancel)
    // …and Cancel answers as it always did: nothing deleted.
    fireEvent.click(document.activeElement)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx[p.remove]).not.toHaveBeenCalled()
  })

  it('W2: the name field edits in place — Enter commits by the page\'s own writer; Escape reverts it and the popup stays, and the next Escape closes it', () => {
    const { ctx } = mount(p.View)
    const dialog = openPopup()
    const main = dialog.querySelector('.rb-ent-detail-main')
    fireEvent.click(within(main).getByRole('button', { name: p.names[0] }))
    let field = within(main).getByRole('textbox', { name: `${p.Noun} name` })
    expect(document.activeElement).toBe(field)
    expect(field.className).toBe('ui-input rb-ent-name-input')
    fireEvent.change(field, { target: { value: `${p.names[0]} II` } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(ctx[p.update]).toHaveBeenCalledWith(p.ids[0], { name: `${p.names[0]} II` })

    fireEvent.click(within(main).getByRole('button', { name: p.names[0] }))
    field = within(main).getByRole('textbox', { name: `${p.Noun} name` })
    fireEvent.change(field, { target: { value: 'Oops' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: p.names[0] })).toBe(dialog)
    expect(within(main).queryByRole('textbox')).toBeNull()
    expect(ctx[p.update]).not.toHaveBeenCalledWith(p.ids[0], { name: 'Oops' })
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
    for (const m of p.otherWriters) expect(ctx[m]).not.toHaveBeenCalled()
  })

  it('W2: Description and Notes open the kit\'s well, Save the kit primary and Cancel the kit ghost; Escape and Cancel drop the edit and the popup stays; Save writes by the page\'s own writer', () => {
    const { ctx } = mount(p.View)
    const dialog = openPopup()
    for (const [key, label, prompt] of [['description', 'Description', 'Click to add a description...'], ['notes', 'Notes', 'Click to add notes...']]) {
      const open = () => {
        const words = within(dialog).getByRole('button', { name: prompt })
        expect(words.getAttribute('data-empty')).toBe('true')
        fireEvent.click(words)
        const box = within(dialog).getByRole('textbox', { name: label })
        expect(document.activeElement).toBe(box)
        return box
      }
      let box = open()
      expect(box.className).toBe('ui-input rb-ent-textarea')
      expect(within(dialog).getByRole('button', { name: 'Save' }).getAttribute('data-variant')).toBe('primary')
      expect(within(dialog).getByRole('button', { name: 'Cancel' }).getAttribute('data-variant')).toBe('ghost')
      fireEvent.change(box, { target: { value: 'Draft' } })
      fireEvent.keyDown(box, { key: 'Escape' })
      expect(screen.getByRole('dialog', { name: p.names[0] })).toBe(dialog)
      expect(within(dialog).queryByRole('textbox', { name: label })).toBeNull()
      box = open()
      expect(box.value).toBe('')
      fireEvent.change(box, { target: { value: 'Draft' } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(within(dialog).queryByRole('textbox', { name: label })).toBeNull()
      expect(ctx[p.update]).not.toHaveBeenCalled()
      box = open()
      fireEvent.change(box, { target: { value: `A ${key}` } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
      expect(ctx[p.update]).toHaveBeenLastCalledWith(p.ids[0], { [key]: `A ${key}` })
      ctx[p.update].mockClear()
    }
    for (const m of p.otherWriters) expect(ctx[m]).not.toHaveBeenCalled()
  })

  it('the status is the kit\'s StatusDot beside the kit CellSelect, no colour of its own, and calls the page\'s own writer; the counts a value in the mono; the dates on the kit\'s one focus treatment write theirs', () => {
    const { ctx } = mount(p.View)
    const dialog = openPopup()
    const { status } = ctx[p.nouns][0]
    const select = within(dialog).getByRole('combobox', { name: 'Status' })
    expect(select.closest('.ui-cell-select')).not.toBeNull()
    expect(select.getAttribute('style')).toBeNull()
    for (const o of select.options) expect(o.getAttribute('style')).toBeNull()
    // The kit's words (Q2), where they were lower-case with underscores gone.
    expect(select.selectedOptions[0].textContent).toBe(statusMeta(status).label)
    expect([...select.options].map((o) => o.textContent)).toContain('Needs revisions')
    expect(select.closest('.rb-ent-status').querySelector('.ui-status-dot').getAttribute('data-tone')).toBe(statusMeta(status).tone)
    fireEvent.change(select, { target: { value: 'final' } })
    expect(ctx[p.update]).toHaveBeenLastCalledWith(p.ids[0], { status: 'final' })
    // The linked counts: a value, not a label — no capitals (Q2).
    expect(dialog.querySelector('.rb-ent-prop-value').textContent).toBe(`${p.counts[0][0]} assets / ${p.counts[0][1]} tasks`)
    // The dates, named for their labels; no ring utility on either (R4-11).
    for (const [label, key] of [['Start date', 'start_date'], ['Due date', 'end_date']]) {
      const date = within(dialog).getByLabelText(label)
      expect(date.getAttribute('type')).toBe('date')
      expect(date.className).toBe('rb-ent-date')
      expect(date.getAttribute('data-empty')).toBe('true')
      fireEvent.change(date, { target: { value: '2026-10-01' } })
      expect(ctx[p.update]).toHaveBeenLastCalledWith(p.ids[0], { [key]: '2026-10-01' })
    }
    for (const m of p.otherWriters) expect(ctx[m]).not.toHaveBeenCalled()
  })

  it('the thumbnail: none, the whole well is "Set thumbnail"; a picture, the kit\'s HoverActions over it with Change and Remove named, and Remove writes null by the page\'s own writer', () => {
    let { ctx } = mount(p.View)
    let dialog = openPopup()
    const set = within(dialog).getByRole('button', { name: 'Set thumbnail' })
    expect(set.closest('.rb-ent-thumb')).not.toBeNull()
    expect(set.querySelector('svg.rb-ent-thumb-glyph').getAttribute('class')).toMatch(p.glyph)
    cleanup(); _resetOverlaysForTests()

    const [first, ...rest] = ctx[p.nouns]
    ;({ ctx } = mount(p.View, { [p.nouns]: [{ ...first, thumbnail_image: 'C:/thumbs/a.png' }, ...rest] }))
    dialog = openPopup()
    const img = dialog.querySelector('.rb-ent-thumb img')
    expect(img.getAttribute('src')).toBe(`/api/rabbit/projects/p1/${p.nouns}/${p.ids[0]}/thumbnail?r=0`)
    const acts = dialog.querySelector('.rb-ent-thumb .ui-hover-actions')
    expect(within(acts).getByRole('button', { name: 'Change thumbnail' })).toBeTruthy()
    const remove = within(acts).getByRole('button', { name: 'Remove thumbnail' })
    expect(remove.getAttribute('data-danger')).toBe('true')
    // Both on the raised paper over any picture (the sheet's `.rb-ent-thumb-act`):
    // through the scrim alone they measured 2.54 and 2.76:1 over a light one.
    expect(within(acts).getAllByRole('button').map((b) => b.className)).toEqual(['ui-iconbtn rb-ent-thumb-act', 'ui-iconbtn rb-ent-thumb-act'])
    fireEvent.click(remove)
    expect(ctx[p.update]).toHaveBeenCalledWith(p.ids[0], { thumbnail_image: null })
  })

  it('"Add new task" opens the task form INSIDE the Dialog as its first column, in its focus trap, the Dialog wider by it; the form\'s own Close closes only the form', () => {
    mount(p.View)
    const dialog = openPopup()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add new task' }))
    const title = screen.getByPlaceholderText('Task title…')
    const form = title.closest('.rb-rel-task')
    expect(dialog.contains(form)).toBe(true)
    // The first of three columns: the form, the sidebar, the properties.
    const cols = [...dialog.querySelector('.rb-ent-detail-body').children]
    expect(cols.map((c) => c.className)).toEqual(['rb-ent-detail-task', 'rb-ent-detail-side', 'rb-ent-detail-main'])
    expect(cols[0].firstElementChild).toBe(form)
    // 896 + the form's 400 + its hairline; the Dialog's Tab trap holds the form.
    expect(dialog.style.width).toBe('1297px')
    expect(document.activeElement).toBe(title)
    expect(focusableWithin(dialog)).toContain(title)
    // The form's own Close closes the form; the Dialog stays, at its width.
    fireEvent.click(within(form).getByRole('button', { name: 'Close' }))
    expect(screen.queryByPlaceholderText('Task title…')).toBeNull()
    expect(screen.getByRole('dialog', { name: p.names[0] })).toBe(dialog)
    expect(dialog.style.width).toBe('896px')
  })

  it('an Escape pressed inside the task form or the in-panel asset picker is theirs: it does nothing, as before the kit, and the draft stays; outside them the popup\'s own Escape closes it', () => {
    mount(p.View)
    const dialog = openPopup()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add new task' }))
    const title = screen.getByPlaceholderText('Task title…')
    fireEvent.change(title, { target: { value: 'Draft kept' } })
    fireEvent.keyDown(title, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: p.names[0] })).toBe(dialog)
    expect(screen.getByPlaceholderText('Task title…').value).toBe('Draft kept')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add asset relation' }))
    const search = screen.getByPlaceholderText('Search assets…')
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: p.names[0] })).toBe(dialog)
    expect(screen.getByPlaceholderText('Search assets…')).toBe(search)
    // Outside both layers the popup's own Escape (Q17) still closes it.
    fireEvent.keyDown(dialog.querySelector('.rb-ent-detail-main'), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: p.names[0] })).toBeNull()
  })

  it('a task opened from the sidebar is its own kit Dialog in <body>, over this one: one Escape closes only the task; the next closes the popup', () => {
    const task = { id: 't9', title: 'Light pass', status: 'in_progress', [p.link]: p.ids[0] }
    mount(p.View, { tasks: [task] })
    const dialog = openPopup()
    fireEvent.click(within(dialog.querySelector('.rb-ent-detail-side')).getByText('Light pass'))
    const taskDialog = screen.getByRole('dialog', { name: 'Light pass' })
    expect(taskDialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(dialog.contains(taskDialog)).toBe(false)
    // Over it: later in <body>, as it is later on the modal stack.
    expect(dialog.closest('.ui-dialog-backdrop').compareDocumentPosition(taskDialog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    escape()
    expect(screen.queryByRole('dialog', { name: 'Light pass' })).toBeNull()
    expect(screen.getByRole('dialog', { name: p.names[0] })).toBe(dialog)
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Levels and Experiences are one component', () => {
  it('render the same DOM apart from their nouns and their icon — the table, the gallery and the New dialog', () => {
    // The same two rows, linked the same way, under both entities.
    const rows = () => [
      { id: 'r1', name: 'Harbour Approach', status: 'in_progress', description: 'Blockout, then the light pass', sort_order: 0 },
      { id: 'r2', name: 'Cliff Path', status: 'blocked', sort_order: 1 },
    ]
    const shots = (View) => {
      rabbit.current = {
        project: { id: 'p1', name: 'Salt Hours', levels_enabled: true, experiences_enabled: true },
        levels: rows(), experiences: rows(),
        assets: [{ id: 'a1', level_id: 'r1', experience_id: 'r1' }],
        tasks: [{ id: 't1', level_id: 'r2', experience_id: 'r2' }],
        phases: [], teamAssignments: [],
      }
      render(<View />)
      const out = [document.body.innerHTML]
      fireEvent.click(screen.getByRole('tab', { name: 'Gallery' }))
      out.push(document.body.innerHTML)
      fireEvent.click(screen.getByRole('button', { name: /^New / }))
      out.push(document.body.innerHTML)
      cleanup(); _resetOverlaysForTests()
      return out
    }
    const icon = /<svg[^>]*lucide-(?:gamepad[\w-]*|sparkles)[^>]*>[\s\S]*?<\/svg>/g
    const norm = (html) => html.replace(icon, '<ENTITY-ICON>')
      .replace(/experiences|levels/g, 'NOUNS').replace(/experience|level/g, 'NOUN').replace(/Experience|Level/g, 'Noun')
    const levels = shots(LevelsView)
    const experiences = shots(ExperiencesView)
    expect(levels.map(norm)).toEqual(experiences.map(norm))
    // CONTROL: each drew its own glyph, and the words really differed.
    expect(levels[1]).toMatch(/lucide-gamepad/)
    expect(experiences[1]).toMatch(/lucide-sparkles/)
    expect(levels[2]).toContain('New level')
    expect(experiences[2]).toContain('New experience')
  })

  it('render the detail popup the same apart from their nouns and their icon — at rest, and with the task form open', () => {
    // The same rows, relations and task under both entities; each project
    // switches on its own entity only, so the task form's one locked field
    // is the page's own (the level on Levels, the experience on Experiences).
    const rows = () => [
      { id: 'r1', name: 'Harbour Approach', status: 'in_progress', description: 'Blockout, then the light pass', sort_order: 0 },
      { id: 'r2', name: 'Cliff Path', status: 'blocked', sort_order: 1 },
    ]
    const shots = (View, flag) => {
      rabbit.current = {
        project: { id: 'p1', name: 'Salt Hours', [flag]: true },
        levels: rows(), experiences: rows(),
        assets: [{ id: 'a1', name: 'Mara', status: 'approved', level_ids: ['r1'], experience_ids: ['r1'] }],
        tasks: [{ id: 't1', title: 'Light pass', status: 'in_progress', level_id: 'r1', experience_id: 'r1' }],
        phases: [], teamAssignments: [],
      }
      render(<View />)
      fireEvent.click(within(screen.getByText('Harbour Approach').closest('tr')).getByRole('button', { name: 'View details' }))
      const out = [document.body.innerHTML]
      fireEvent.click(screen.getByRole('button', { name: 'Add new task' }))
      out.push(document.body.innerHTML)
      cleanup(); _resetOverlaysForTests()
      return out
    }
    const icon = /<svg[^>]*lucide-(?:gamepad[\w-]*|sparkles)[^>]*>[\s\S]*?<\/svg>/g
    const norm = (html) => html.replace(icon, '<ENTITY-ICON>')
      .replace(/experiences|levels/g, 'NOUNS').replace(/experience|level/g, 'NOUN').replace(/Experience|Level/g, 'Noun')
    const levels = shots(LevelsView, 'levels_enabled')
    const experiences = shots(ExperiencesView, 'experiences_enabled')
    expect(levels.map(norm)).toEqual(experiences.map(norm))
    // CONTROL: the popup was open, then its form; each drew its own glyph
    // in the title, and the words really differed.
    for (const shot of [...levels, ...experiences]) expect(shot).toContain('rb-ent-detail-body')
    expect(levels[1]).toContain('rb-ent-detail-task')
    expect(levels[0]).toMatch(/<svg[^>]*lucide-gamepad[^>]*rb-ent-detail-icon/)
    expect(experiences[0]).toMatch(/<svg[^>]*lucide-sparkles[^>]*rb-ent-detail-icon/)
    expect(levels[0]).toContain('Level name')
    expect(experiences[0]).toContain('Experience name')
  })
})
