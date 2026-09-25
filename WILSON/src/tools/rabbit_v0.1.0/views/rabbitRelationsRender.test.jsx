/** @vitest-environment jsdom */
// =============================================================================
// Lane B4b, mounted: RelationsPanel.jsx on the kit (surface 4). What its parts
// DO — both relations sidebars the kit Panel at one width, a group's head a
// row of SIBLINGS (no button inside a button), every status the kit's, the
// picker the kit Dialog in <body> on top of the asset popup, the in-panel
// asset picker on the same row spec, RelationBadge naming itself in the asset
// popup's four relation fields, and NewTaskSidePopup's create question on the
// kit Dialog (W9) — not how their source reads.
// =============================================================================

import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { Film } from 'lucide-react'
import { _resetOverlaysForTests } from '../../../ui/overlay'
import { token, contrast, over, PAPER, PAPER_RAISED, INK_2, INK_3, HOVER } from '../../../ui'
import { rulesOf } from '../rabbitCssGuards.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => perms.current }))
const perms = vi.hoisted(() => ({ current: null }))
// The asset popup's hooks, as rabbitAssetsRender.test.jsx gives them: ONE
// object for the whole run (a new loader each render loads forever).
const templates = vi.hoisted(() => ({ api: { templates: [], loadProjectTemplates: async () => [] } }))
const team = vi.hoisted(() => ({ current: { members: [] } }))
vi.mock('../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => team.current }))
vi.mock('../../../components/TaskTemplates/useTaskTemplates', () => ({ useTaskTemplates: () => templates.api }))
const rabbit = vi.hoisted(() => ({ current: null }))

const {
  default: RelationsPanel, AssetRelationsSidebar, NewTaskSidePopup, RelationBadge,
} = await import('../components/RelationsPanel')
const { default: ProjectAssetsView } = await import('./ProjectAssetsView')

afterEach(() => { cleanup(); _resetOverlaysForTests(); vi.restoreAllMocks(); localStorage.clear() })

const escape = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
/** React's own report of a button inside a button (validateDOMNesting). */
const nestingReported = (spy) => spy.mock.calls.some((args) => /cannot be a descendant of|cannot contain a nested/.test(args.map(String).join(' ')))

const SCENES = [
  { id: 's1', name: 'Harbour at dawn', status: 'in_progress' },
  { id: 's2', name: 'Night market', status: 'approved' },
]
// Shot 010 is Harbour at dawn's; Shot 020's scene (Night market) is not
// linked to the asset below, so it is an orphan there.
const SHOTS = [
  { id: 'sh1', name: 'Shot 010', scene_id: 's1', status: 'final' },
  { id: 'sh2', name: 'Shot 020', scene_id: 's2', status: 'needs_revisions' },
]
const LEVELS = [{ id: 'l1', name: 'Harbour Approach', status: 'blocked' }]
const EXPERIENCES = [{ id: 'e1', name: 'First Light' }]
const ALL_ON = { scenes_enabled: true, levels_enabled: true, experiences_enabled: true }

// The asset popup's left column, on its own.
function sidebar({ asset = { id: 'a1', scene_ids: ['s1'], shot_ids: ['sh1', 'sh2'], level_ids: ['l1'], experience_ids: [] } } = {}) {
  const ctx = { project: ALL_ON, scenes: SCENES, shots: SHOTS, levels: LEVELS, experiences: EXPERIENCES, updateAsset: vi.fn() }
  return { ctx, ...render(<AssetRelationsSidebar asset={asset} ctx={ctx} />) }
}

// The Level / Experience / Scene popups' left column, for scene s1.
const PANEL_ASSETS = () => [
  { id: 'a1', name: 'Mara', status: 'approved', scene_ids: ['s1'] },
  { id: 'a2', name: 'Cliff Path', status: 'in_progress', scene_ids: [] },
  { id: 'a3', name: 'Festival DCP', scene_ids: [] },
]
const PANEL_TASKS = [
  { id: 't1', title: 'Wardrobe pass', scene_id: 's1', asset_id: 'a1', status: 'pending_review' },
  { id: 't2', title: 'Lookdev', scene_id: 's2', status: 'in_progress' },
]
function panel({ assets = PANEL_ASSETS(), tasks = PANEL_TASKS, entityId = 's1' } = {}) {
  const ctx = { updateAsset: vi.fn() }
  const on = { onOpenAsset: vi.fn(), onOpenTask: vi.fn(), onCreateTask: vi.fn() }
  const utils = render(
    <RelationsPanel entityType="scene" entityId={entityId} assets={assets} tasks={tasks} ctx={ctx}
      onOpenAsset={on.onOpenAsset} onOpenTask={on.onOpenTask} onCreateTask={on.onCreateTask} />,
  )
  return { ctx, ...on, ...utils }
}

describe('the relations sidebars — one kit Panel, one head language', () => {
  it('both sidebars are the kit Panel at ONE width token, lg: 300px (they were 360 and 320), the hairline on the docked edge', () => {
    expect(token('panel-lg')).toBe('300px')
    const roots = []
    const a = sidebar()
    roots.push(a.container.firstElementChild)
    cleanup()
    const b = panel()
    roots.push(b.container.firstElementChild)
    for (const aside of roots) {
      expect(aside.tagName).toBe('ASIDE')
      expect(aside.className).toBe('ui-panel rb-rel-panel')
      expect(aside.getAttribute('data-width')).toBe('lg')
      expect(aside.getAttribute('data-side')).toBe('left')
      // No width, border or colour decided inline, anywhere in it.
      expect(aside.querySelector('[style]')).toBeNull()
      expect(aside.getAttribute('style')).toBeNull()
    }
  })

  it('no button inside a button in either sidebar, and React reports none', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const a = sidebar()
    // Expanded, so the nested shot rows are in the tree too.
    fireEvent.click(screen.getByRole('button', { name: 'Shots in Harbour at dawn' }))
    expect(a.container.querySelectorAll('button button')).toHaveLength(0)
    cleanup()
    const b = panel()
    expect(b.container.querySelectorAll('button button')).toHaveLength(0)
    expect(nestingReported(errors)).toBe(false)
  })

  it('the Scenes & Shots head is a row of SIBLINGS — the toggle, then Link scene and Link shot, kit IconButtons at 28px with one glyph each — in the places they were', () => {
    sidebar()
    const toggle = screen.getByRole('button', { name: 'Scenes & Shots (3)' })
    const scene = screen.getByRole('button', { name: 'Link scene' })
    const shot = screen.getByRole('button', { name: 'Link shot' })
    expect([...toggle.parentElement.children]).toEqual([toggle, scene, shot])
    for (const b of [scene, shot]) {
      expect(b.className).toContain('ui-iconbtn')
      expect(b.getAttribute('data-size')).toBe('sm')
      expect(b.querySelectorAll('svg')).toHaveLength(1)
    }
    // The walk clicks "Link scene": the title stays exactly that.
    expect(scene.title).toBe('Link scene')
    expect(shot.title).toBe('Link shot')
    // The toggle still collapses the group, and now says so.
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Harbour at dawn')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText('Harbour at dawn')).toBeTruthy()
    // Levels and Experiences keep their own add buttons, after their toggles.
    const levels = screen.getByRole('button', { name: 'Levels (1)' })
    expect(levels.nextElementSibling).toBe(screen.getByRole('button', { name: 'Add levels relation' }))
    expect(screen.getByRole('button', { name: 'Experiences (0)' }).nextElementSibling)
      .toBe(screen.getByRole('button', { name: 'Add experiences relation' }))
  })

  it('every status is the kit\'s, where the row had it: the StatusDot at its start and, where it printed a word, the kit\'s words at its end — the same at every depth', () => {
    const { container } = sidebar()
    // A scene row showed a dot and no word: the kit's dot, named.
    const scene = screen.getByText('Harbour at dawn').closest('.rb-rel-row')
    expect(scene.querySelector('.ui-status-dot[data-tone="signal"]').getAttribute('aria-label')).toBe('In progress')
    expect(scene.querySelector('.rb-rel-status')).toBeNull()
    // Its child count, the chevron button named for its scene.
    expect(scene.querySelector('.rb-rel-count').textContent).toBe('1')
    const expand = within(scene).getByRole('button', { name: 'Shots in Harbour at dawn' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(expand)
    expect(expand.getAttribute('aria-expanded')).toBe('true')
    // A nested shot: under the spine, its dot and the kit's words (it was 7px).
    const nested = screen.getByText('Shot 010').closest('.rb-rel-row')
    expect(nested.parentElement.className).toBe('rb-rel-nest')
    expect(nested.querySelector('.ui-status-dot').getAttribute('data-tone')).toBe('success')
    expect(nested.querySelector('.rb-rel-status').textContent).toBe('Final')
    // An orphan shot and a level: the same, in the kit's words and tone; the
    // dot is hidden from assistive technology where the words say it.
    const orphan = screen.getByText('Shot 020').closest('.rb-rel-row')
    expect(orphan.querySelector('.rb-rel-slot')).not.toBeNull()
    expect(orphan.querySelector('.rb-rel-status').textContent).toBe('Needs revisions')
    expect(orphan.querySelector('.ui-status-dot').getAttribute('data-tone')).toBe('warning')
    expect(orphan.querySelector('.ui-status-dot').getAttribute('aria-hidden')).toBe('true')
    const level = screen.getByText('Harbour Approach').closest('.rb-rel-row')
    expect(level.querySelector('.rb-rel-status').textContent).toBe('Blocked')
    expect(level.querySelector('.ui-status-dot').getAttribute('data-tone')).toBe('danger')
    // Every dot in the column is the kit's; no status colour of the file's own.
    for (const el of container.querySelectorAll('*')) expect(el.getAttribute('style')).toBeNull()
    // An empty group: one sentence-case line (it was 9.5px capitals).
    const empty = screen.getByText('No experiences linked')
    expect(empty.className).toBe('rb-rel-empty')
  })

  it('a row\'s remove control is the kit IconButton in the kit\'s hover slot, named as it was, and removes as it did', () => {
    const { ctx } = sidebar()
    const orphan = screen.getByText('Shot 020').closest('.rb-rel-row')
    expect(orphan.classList.contains('ui-hover-host')).toBe(true)
    const remove = within(orphan).getByRole('button', { name: 'Remove shot' })
    expect(remove.closest('.ui-hover-actions')).not.toBeNull()
    expect(remove.getAttribute('data-danger')).toBe('true')
    fireEvent.click(remove)
    expect(ctx.updateAsset).toHaveBeenLastCalledWith('a1', { shot_ids: ['sh1'] })
    fireEvent.click(within(screen.getByText('Harbour at dawn').closest('.rb-rel-row')).getByRole('button', { name: 'Remove scene' }))
    expect(ctx.updateAsset).toHaveBeenLastCalledWith('a1', { scene_ids: [] })
    fireEvent.click(within(screen.getByText('Harbour Approach').closest('.rb-rel-row')).getByRole('button', { name: 'Remove relation' }))
    expect(ctx.updateAsset).toHaveBeenLastCalledWith('a1', { level_ids: [] })
  })
})

describe('the pickers — the kit Dialog, and the in-panel overlay on the same spec', () => {
  it('"Link scene" opens the kit Dialog in <body>, titled "Link scenes", printing "(0 linked)"; a row click toggles the relation', () => {
    const asset = { id: 'a1', scene_ids: [], shot_ids: [] }
    const { ctx, container, rerender } = sidebar({ asset })
    fireEvent.click(screen.getByRole('button', { name: 'Link scene' }))
    const picker = screen.getByRole('dialog', { name: 'Link scenes' })
    expect(picker.className).toContain('ui-dialog')
    expect(picker.getAttribute('data-width')).toBe('confirm')
    // Portalled: not inside the sidebar (the asset popup centres with a transform).
    expect(container.contains(picker)).toBe(false)
    expect(picker.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(picker.querySelector('.ui-dialog-title').textContent).toContain('(0 linked)')
    // The search has focus, as it did, in the kit's small well.
    const search = within(picker).getByRole('textbox', { name: 'Search' })
    expect(document.activeElement).toBe(search)
    expect(search.className).toContain('ui-input')
    // A row is the toggle it was, and says so.
    const row = within(picker).getByRole('button', { name: /^Harbour at dawn/ })
    expect(row.className).toBe('rb-rel-pick-row')
    expect(row.getAttribute('aria-pressed')).toBe('false')
    expect(row.querySelector('.rb-rel-status').textContent).toBe('In progress')
    fireEvent.click(row)
    expect(ctx.updateAsset).toHaveBeenCalledWith('a1', { scene_ids: ['s1'] })
    // The provider hands the asset back linked: the count and the row follow.
    rerender(<AssetRelationsSidebar asset={{ ...asset, scene_ids: ['s1'] }} ctx={ctx} />)
    const again = screen.getByRole('dialog', { name: 'Link scenes' })
    expect(again.querySelector('.ui-dialog-title').textContent).toContain('(1 linked)')
    const linked = within(again).getByRole('button', { name: /^Harbour at dawn/ })
    expect(linked.getAttribute('aria-pressed')).toBe('true')
    expect(linked.getAttribute('data-selected')).toBe('true')
    fireEvent.click(linked)
    expect(ctx.updateAsset).toHaveBeenLastCalledWith('a1', { scene_ids: [] })
    // The search still filters; Done closes it.
    fireEvent.change(within(again).getByRole('textbox', { name: 'Search' }), { target: { value: 'market' } })
    expect(within(again).getAllByRole('button', { name: /market|dawn/ }).map((b) => b.querySelector('.rb-rel-name').textContent)).toEqual(['Night market'])
    fireEvent.click(within(again).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the picker closes on Escape (the kit Dialog\'s) and on its own backdrop, as it did; Link shot and each group\'s add button open theirs', () => {
    sidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Link scene' }))
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Link shot' }))
    const shots = screen.getByRole('dialog', { name: 'Link shots' })
    expect(shots.textContent).toContain('(2 linked)')
    fireEvent.mouseDown(shots.parentElement)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add levels relation' }))
    expect(screen.getByRole('dialog', { name: 'Link levels' }).textContent).toContain('(1 linked)')
    escape()
    fireEvent.click(screen.getByRole('button', { name: 'Add experiences relation' }))
    const exp = screen.getByRole('dialog', { name: 'Link experiences' })
    // An item with no status reads "Not started" in the kit's words.
    expect(within(exp).getByRole('button', { name: /^First Light/ }).querySelector('.rb-rel-status').textContent).toBe('Not started')
  })

  it('the in-panel asset picker stays an overlay over the sidebar (C1), on the same head, search field and row as the Dialog', () => {
    const { ctx, container } = panel()
    fireEvent.click(screen.getByRole('button', { name: 'Add asset relation' }))
    // Not a dialog: the overlay inside the column, as before.
    expect(screen.queryByRole('dialog')).toBeNull()
    const overlay = container.querySelector('aside.rb-rel-panel .rb-rel-pick')
    expect(overlay).not.toBeNull()
    // The walk proves it by its field: the placeholder stays exactly this.
    const search = within(overlay).getByPlaceholderText('Search assets…')
    expect(document.activeElement).toBe(search)
    expect(overlay.querySelector('.rb-rel-pick-title').textContent).toBe('Link asset')
    // Only the unlinked assets; the rows are the picker row.
    const rows = [...overlay.querySelectorAll('button.rb-rel-pick-row')]
    expect(rows.map((r) => r.querySelector('.rb-rel-name').textContent)).toEqual(['Cliff Path', 'Festival DCP'])
    expect(rows[0].querySelector('.ui-status-dot[data-tone="signal"]')).not.toBeNull()
    fireEvent.click(rows[0])
    expect(ctx.updateAsset).toHaveBeenCalledWith('a2', { scene_ids: ['s1'] })
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(within(overlay).getByRole('status').textContent).toBe('No matches')
    // The Dialog picker's row, search field and title use the very same classes.
    const dialogSide = render(<AssetRelationsSidebar asset={{ id: 'a9', scene_ids: [] }} ctx={{ project: ALL_ON, scenes: SCENES, shots: [], levels: [], experiences: [], updateAsset: vi.fn() }} />)
    fireEvent.click(within(dialogSide.container).getByRole('button', { name: 'Link scene' }))
    const picker = screen.getByRole('dialog', { name: 'Link scenes' })
    const dialogRow = picker.querySelector('button.rb-rel-pick-row')
    expect(dialogRow.className).toBe(rows[0].className)
    expect(picker.querySelector('input').className).toBe(search.className)
    expect(picker.querySelector('.rb-rel-pick-title')).not.toBeNull()
    // Close closes the overlay (it had no name; it is the kit's "Close").
    fireEvent.click(within(overlay).getByRole('button', { name: 'Close' }))
    expect(container.querySelector('.rb-rel-pick')).toBeNull()
  })
})

describe('RelationsPanel — the Level, Experience and Scene popups\' column', () => {
  it('its heads are siblings too; a row opens its asset or task as it did, and a remove does not open anything', () => {
    const { ctx, onOpenAsset, onOpenTask, onCreateTask } = panel()
    const assets = screen.getByRole('button', { name: 'Assets (1)' })
    expect(assets.nextElementSibling).toBe(screen.getByRole('button', { name: 'Add asset relation' }))
    const tasks = screen.getByRole('button', { name: 'Tasks (1)' })
    const add = screen.getByRole('button', { name: 'Add new task' })
    expect(tasks.nextElementSibling).toBe(add)
    fireEvent.click(add)
    expect(onCreateTask).toHaveBeenCalledTimes(1)
    // The asset row opens the asset; its remove removes and opens nothing.
    // (Mara is the task row's asset line too: the asset row's name carries
    // the whole name as its title.)
    const row = screen.getByTitle('Mara').closest('.rb-rel-row')
    expect(row.getAttribute('data-clickable')).toBe('true')
    expect(row.querySelector('.rb-rel-status').textContent).toBe('Approved')
    fireEvent.click(row)
    expect(onOpenAsset).toHaveBeenCalledWith('a1')
    fireEvent.click(within(row).getByRole('button', { name: 'Remove relation' }))
    expect(ctx.updateAsset).toHaveBeenCalledWith('a1', { scene_ids: [] })
    expect(onOpenAsset).toHaveBeenCalledTimes(1)
    // The task row: the task, the asset it is for, the kit's badge; it opens the task.
    const task = screen.getByText('Wardrobe pass').closest('.rb-rel-row')
    expect(task.querySelector('.rb-rel-sub').textContent).toBe('Mara')
    expect(task.querySelector('.rb-rel-status').textContent).toBe('Pending review')
    fireEvent.click(task)
    expect(onOpenTask).toHaveBeenCalledWith('t1')
  })

  it('an empty column says so in sentence case: a Caption line per group, and the kit\'s EmptyState for the whole', () => {
    const { container } = panel({ entityId: 'nothing' })
    expect(screen.getByText('No assets linked').className).toBe('rb-rel-empty')
    expect(screen.getByText('No tasks linked').className).toBe('rb-rel-empty')
    const empty = screen.getByRole('status')
    expect(empty.className).toContain('ui-empty')
    expect(empty.getAttribute('data-compact')).toBe('true')
    expect(empty.querySelector('.ui-empty-title').textContent).toBe('No assets or tasks linked yet')
    // No capitals typed or classed onto the words (Q2).
    expect(container.querySelector('.uppercase')).toBeNull()
  })

  it('without onCreateTask the Tasks head has no add button, as before', () => {
    render(<RelationsPanel entityType="level" entityId="l1" assets={[]} tasks={[]} ctx={{}} />)
    expect(screen.getByRole('button', { name: 'Tasks (0)' }).nextElementSibling).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add new task' })).toBeNull()
  })
})

describe('RelationBadge — the chip it was meant to be (R4-27)', () => {
  it('names itself from its label and count, keys its one active treatment on data-active, and keeps its click', () => {
    const onClick = vi.fn()
    const { rerender } = render(<RelationBadge icon={Film} count={3} label="Scenes" onClick={onClick} />)
    const badge = screen.getByRole('button', { name: 'Scenes: 3 linked' })
    expect(badge.title).toBe('Scenes: 3 linked')
    expect(badge.className).toBe('rb-rel-badge')
    expect(badge.getAttribute('data-active')).toBe('true')
    expect(badge.querySelector('.rb-rel-badge-count').textContent).toBe('3')
    expect(badge.querySelectorAll('svg')).toHaveLength(1)
    expect(badge.getAttribute('style')).toBeNull()
    fireEvent.click(badge)
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(<RelationBadge icon={Film} count={0} label="Scenes" onClick={onClick} />)
    const none = screen.getByRole('button', { name: 'Scenes: 0 linked' })
    expect(none.getAttribute('data-active')).toBe('false')
    expect(none.textContent).toBe('0')
  })

  it('its quiet inks measure: at rest the second ink on the Dialog\'s raised paper; the sidebar\'s empty line the third on the paper', () => {
    const sheet = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'rabbitFiles.css'), 'utf8')
    const rule = (sel) => rulesOf(sheet).find((r) => r.sel === sel)?.body || ''
    const ink = (sel) => (rule(sel).match(/(?:^|[\s;])color:\s*var\(--(color-ink(?:-2|-3)?)\)/) || [])[1]
    // Nothing linked: quiet, and over 4.5:1 where it is drawn.
    expect(ink('.rb-rel-badge')).toBe('color-ink-2')
    expect(contrast(token('color-ink-2'), PAPER_RAISED)).toBeGreaterThan(4.5)
    expect(contrast(INK_2, over(HOVER, PAPER_RAISED))).toBeGreaterThan(4.5)
    // Something linked: the chip's one active treatment, the ink unchanged.
    expect(rule('.rb-rel-badge[data-active="true"]')).toMatch(/background-color:\s*var\(--color-signal-tint\)/)
    expect(rule('.rb-rel-badge[data-active="true"]')).toMatch(/border-color:\s*var\(--color-signal\)/)
    // An empty group's line: the third ink, on the column's paper.
    expect(ink('.rb-rel-empty')).toBe('color-ink-3')
    expect(rule('.ui-panel.rb-rel-panel')).toMatch(/background-color:\s*var\(--color-paper\)/)
    expect(contrast(INK_3, PAPER)).toBeGreaterThan(4.5)
  })
})

describe('NewTaskSidePopup — on the kit', () => {
  const props = (over = {}) => ({
    entityType: 'level',
    entityId: 'l1',
    assets: [{ id: 'a1', name: 'Mara' }],
    phases: [{ id: 'ph1', name: 'Pre-production' }],
    levels: [{ id: 'l1', name: 'Harbour Approach' }],
    experiences: [],
    projectMembers: [{ id: 'm1', name: 'Ines Ruiz' }],
    roleEntries: [{ role_slug: 'rigger', role_label: 'Rigger' }],
    project: { levels_enabled: true },
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...over,
  })

  it('its fields are the kit Field over native ui-input fields: the kit\'s words and dot for the status, an em dash for none, no inline colour', () => {
    const p = props()
    const { container } = render(<NewTaskSidePopup {...p} />)
    const title = screen.getByRole('textbox', { name: 'Title *' })
    expect(document.activeElement).toBe(title)
    // The walk proves the popup by this placeholder: it stays exactly this.
    expect(title.placeholder).toBe('Task title…')
    for (const f of container.querySelectorAll('input, select, textarea')) {
      expect(f.classList.contains('ui-input'), f.outerHTML.slice(0, 60)).toBe(true)
      expect(f.closest('label.ui-field'), f.outerHTML.slice(0, 60)).not.toBeNull()
    }
    for (const el of container.querySelectorAll('*')) expect(el.getAttribute('style')).toBeNull()
    const status = screen.getByRole('combobox', { name: 'Status' })
    expect(status.selectedOptions[0].textContent).toBe('Waiting to start')
    expect(status.parentElement.querySelector('.ui-status-dot[data-tone="neutral"]')).not.toBeNull()
    expect([...screen.getByRole('combobox', { name: 'Priority' }).options].map((o) => o.textContent)).toEqual(['Low', 'Medium', 'High', 'Urgent'])
    // Its own level, set and locked, as before.
    const level = screen.getByRole('combobox', { name: 'Level' })
    expect(level.value).toBe('l1')
    expect(level.disabled).toBe(true)
    expect(screen.getByRole('combobox', { name: 'Asset' }).selectedOptions[0].textContent).toBe('—')
    expect(screen.getByRole('combobox', { name: 'Asset' }).getAttribute('data-empty')).toBe('true')
    expect(container.textContent).not.toMatch(/--/)
    // The dates' picker dark, by the lane's date field.
    expect(screen.getByLabelText('Start').className).toContain('rb-rel-task-date')
    // Sentence case: the title, the action; the action is the kit primary.
    expect(container.querySelector('.rb-rel-task-title').textContent).toBe('New task')
    const create = screen.getByRole('button', { name: 'Create task' })
    expect(create.getAttribute('data-variant')).toBe('primary')
    expect(create.disabled).toBe(true)
    // Close and Cancel close it, as before.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(p.onClose).toHaveBeenCalledTimes(2)
  })

  it('W9: Create task asks on the kit Dialog in <body>, in the same words; Cancel and Escape create nothing; Create creates as the browser\'s OK did; window.confirm is never called', () => {
    const confirm = vi.spyOn(window, 'confirm')
    const p = props()
    const { container } = render(<NewTaskSidePopup {...p} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Title *' }), { target: { value: 'Blockout pass' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), { target: { value: 'high' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    let dialog = screen.getByRole('dialog', { name: 'Create task' })
    expect(dialog.getAttribute('data-width')).toBe('confirm')
    expect(container.contains(dialog)).toBe(false)
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(dialog.querySelector('.ui-dialog-body').textContent).toBe('Create task "Blockout pass"?')
    // The action has focus, as the browser's OK did: Enter still creates.
    expect(document.activeElement.textContent).toBe('Create')
    expect(document.activeElement.getAttribute('data-variant')).toBe('primary')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(p.onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Title *' }).value).toBe('Blockout pass')
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(p.onConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    dialog = screen.getByRole('dialog', { name: 'Create task' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(p.onConfirm).toHaveBeenCalledTimes(1)
    expect(p.onConfirm).toHaveBeenCalledWith({
      title: 'Blockout pass', status: 'waiting_to_start', priority: 'high',
      asset_id: null, phase_id: null, scene_id: null, shot_id: null, level_id: 'l1', experience_id: null,
      assignee_id: null, assigned_role_slug: null, bid_days: null, start_date: '', end_date: '', description: '',
    })
    expect(confirm).not.toHaveBeenCalled()
  })
})

// ── The asset popup (ProjectAssetsView), with rabbitAssetsRender's harness ──
const ASSET = () => ({
  id: 'a1', project_id: 'p1', name: 'Mara', type: 'character', status: 'approved', phase_id: null,
  scene_ids: ['s1', 's2'], shot_ids: [], level_ids: ['l1'], experience_ids: [], sort_order: 0,
})
function page(extra = {}) {
  perms.current = { role: 'admin', ready: true, can: () => true }
  const ctx = {
    project: { id: 'p1', name: 'Salt Hours', ...ALL_ON },
    assets: [ASSET()],
    phases: [],
    tasks: [],
    scenes: SCENES,
    shots: SHOTS,
    levels: LEVELS,
    experiences: EXPERIENCES,
    myProjectRole: 'manager',
    projectIsStaffed: false,
    updateAsset: vi.fn(),
    selectAssetStatusWarning: () => false,
    // Without both lists FileManager re-keys an effect every render and the
    // test never returns (rabbitAssetsRender.test.jsx's note).
    files: [],
    managedFiles: [],
    ...extra,
  }
  rabbit.current = ctx
  return { ctx, ...render(<ProjectAssetsView />) }
}

describe('the asset popup — its four relation fields and the pickers they open', () => {
  // As rabbitAssetsRender's: the position rules a browser has, so a check
  // that reads a computed position meets what the app computes (the popup's
  // layer guard is gone since B4c); FileManager asks the desktop route for
  // video support on mount.
  let positions, realFetch
  beforeAll(() => {
    positions = document.createElement('style')
    positions.textContent = '.fixed { position: fixed; } .ui-dialog-backdrop { position: fixed; }'
    document.head.appendChild(positions)
    realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('no network in this test')))
  })
  afterAll(() => { positions.remove(); globalThis.fetch = realFetch })

  it('the four fields render the RelationBadge, named for their kind and count, each in its place; no "(s)" words, no nested button', () => {
    page()
    fireEvent.click(screen.getByRole('button', { name: 'View asset details' }))
    const popup = screen.getByRole('dialog', { name: 'Mara' })
    const badges = [...popup.querySelectorAll('.rb-asset-prop-grid .rb-rel-badge')]
    expect(badges.map((b) => b.getAttribute('aria-label'))).toEqual(
      ['Scenes: 2 linked', 'Shots: 0 linked', 'Levels: 1 linked', 'Experiences: 0 linked'])
    expect(badges.map((b) => b.getAttribute('data-active'))).toEqual(['true', 'false', 'true', 'false'])
    expect(badges.map((b) => b.closest('.rb-asset-prop').querySelector('.rb-asset-prop-label').textContent)).toEqual(
      ['Scenes', 'Shots', 'Levels', 'Experiences'])
    expect(popup.textContent).not.toMatch(/\(s\)/)
    expect(popup.querySelectorAll('button button')).toHaveLength(0)
    // Its left column is the relations Panel, at the one width.
    expect(popup.querySelector('.rb-asset-detail-side > aside.ui-panel').getAttribute('data-width')).toBe('lg')
  })

  it('each field opens its picker, a kit Dialog in <body> ON TOP of the popup: Escape closes the picker and the popup stays; the next Escape closes the popup', () => {
    const { ctx } = page()
    fireEvent.click(screen.getByRole('button', { name: 'View asset details' }))
    const popup = screen.getByRole('dialog', { name: 'Mara' })
    const titles = ['Link scenes', 'Link shots', 'Link levels', 'Link experiences']
    const badges = [...popup.querySelectorAll('.rb-asset-prop-grid .rb-rel-badge')]
    badges.forEach((badge, i) => {
      fireEvent.click(badge)
      const picker = screen.getByRole('dialog', { name: titles[i] })
      expect(popup.contains(picker)).toBe(false)
      expect(picker.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
      escape()
      expect(screen.queryByRole('dialog', { name: titles[i] })).toBeNull()
      expect(screen.getByRole('dialog', { name: 'Mara' })).toBeTruthy()
    })
    // A row click in a field's picker toggles that field's relation.
    fireEvent.click(badges[0])
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Link scenes' })).getByRole('button', { name: /^Harbour at dawn/ }))
    expect(ctx.updateAsset).toHaveBeenLastCalledWith('a1', { scene_ids: ['s2'] })
    escape()
    // And the sidebar's own "Link scene": the same Dialog, the same Escape.
    fireEvent.click(within(popup.querySelector('.rb-asset-detail-side')).getByRole('button', { name: 'Link scene' }))
    expect(screen.getByRole('dialog', { name: 'Link scenes' }).textContent).toContain('(2 linked)')
    escape()
    expect(screen.getByRole('dialog', { name: 'Mara' })).toBeTruthy()
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

// Last, on purpose: React reports a nesting ONCE per tag pair per load, so
// this control would blind the check above if it ran first.
describe('CONTROL', () => {
  it('a button inside a button is caught by both the DOM query and React\'s report', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(<button type="button"><span><button type="button">x</button></span></button>)
    expect(container.querySelectorAll('button button')).toHaveLength(1)
    expect(nestingReported(errors)).toBe(true)
  })
})
