/** @vitest-environment jsdom */
// =============================================================================
// Post-overhaul F10 (rabbit A6): the kit's useInlineText, BulkSelect and Confirm
// in the R.A.B.B.I.T. views they replaced twenty copies in. What each view's
// copy did is pinned by its own suite, unedited; this file pins what changed
// and what must not:
//   1. P1-06: after an inline edit commits (Enter) or reverts (Escape), focus
//      is back on the words — in every one of the eight editors, in its real
//      view. Seven dropped it to <body> before F10; the Scenes window's name
//      field already did this and is the control. The Scenes table's words
//      stay a span with no tab stop (C1): focusable by script only.
//   2. "None" in the Tasks and Assets bulk bars clears the field (it wrote
//      nothing: its value was the label's '').
//   3. Each view's delete question asks as its copy did: Cancel focused, the
//      backdrop closing only the row's question, the verb once.
//   4. The views' names for the kit pieces hold no behaviour of their own
//      (no state, no effect, no key or blur handler), and no view writes the
//      optional-toast hook again.
// =============================================================================

import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { _resetOverlaysForTests } from '../../../ui/overlay'
import { _resetLeaveGuardsForTests } from '../state/leaveGuard'
import {
  backfillItems, activeShotListOf, activeScenesOf, activeShotsOf, scenesOfList, shotsOfList,
  listsContainingOf, unlistedScenesOf, unlistedShotsOf, nextShotListVersion, formatShotListLabel, isWithdrawn,
} from '../state/shotListModel'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
const rabbit = vi.hoisted(() => ({ current: null }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true, can: () => true }) }))
// Each hook returns ONE object for the whole test (a new one a render re-keys every memo).
const team = vi.hoisted(() => ({ members: [] }))
const rates = vi.hoisted(() => ({ entries: [], rateCards: [] }))
const roster = vi.hoisted(() => ({ members: [], mode: 'supabase' }))
const templates = vi.hoisted(() => ({ templates: [], loadProjectTemplates: async () => [] }))
vi.mock('../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => team }))
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => rates }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => roster }))
vi.mock('../../../components/TaskTemplates/useTaskTemplates', () => ({ useTaskTemplates: () => templates }))
// The windows' Files section: not what is tested here.
vi.mock('../components/FileManager', () => ({ default: () => null }))

const { default: LevelsView } = await import('./LevelsView')
const { default: ProjectAssetsView } = await import('./ProjectAssetsView')
const { default: ProjectTasksView } = await import('./ProjectTasksView')
const { default: ScenesView } = await import('./ScenesView')
const { default: TaskDetailPopup } = await import('../components/TaskDetailPopup')

let positions
beforeAll(() => {
  positions = document.createElement('style')
  positions.textContent = '.fixed { position: fixed; } .ui-dialog-backdrop { position: fixed; }'
  document.head.appendChild(positions)
})
afterAll(() => positions.remove())
afterEach(() => { cleanup(); _resetOverlaysForTests(); _resetLeaveGuardsForTests(); vi.restoreAllMocks(); localStorage.clear() })

// ── The pages, each over the least context its own suite gives it ──────────
function levels() {
  const ctx = {
    project: { id: 'p1', name: 'Salt Hours', levels_enabled: true },
    levels: [
      { id: 'l1', name: 'Harbour Approach', status: 'in_progress', sort_order: 0 },
      { id: 'l2', name: 'Cliff Path', status: 'blocked', sort_order: 1 },
    ],
    experiences: [], assets: [], tasks: [], phases: [], teamAssignments: [], files: [], managedFiles: [],
    addLevel: vi.fn(async () => {}), updateLevel: vi.fn(), deleteLevel: vi.fn(async () => {}),
    addTask: vi.fn(async () => {}),
  }
  rabbit.current = ctx
  render(<LevelsView />)
  return ctx
}
function assets() {
  const ctx = {
    project: { id: 'p1', name: 'Salt Hours' },
    assets: [
      { id: 'a1', project_id: 'p1', name: 'Mara', type: 'character', status: 'approved', phase_id: 'ph1', sort_order: 0 },
      { id: 'a2', project_id: 'p1', name: 'Cliff Path', type: 'environment', status: 'in_progress', phase_id: 'ph1', sort_order: 1 },
    ],
    phases: [{ id: 'ph1', name: 'Pre-production' }],
    tasks: [], files: [], managedFiles: [],
    myProjectRole: 'manager', projectIsStaffed: false,
    updateAsset: vi.fn(), deleteAsset: vi.fn(), deleteAssets: vi.fn(async () => {}),
  }
  rabbit.current = ctx
  render(<ProjectAssetsView />)
  return ctx
}
function tasks() {
  const ctx = {
    project: { id: 'p1', name: 'Salt Hours' },
    tasks: [
      { id: 't1', title: 'Glass and rain rig test', status: 'in_progress', priority: 'high', phase_id: 'ph1', assignee_id: 'u1' },
      { id: 't2', title: 'Wall texture pass', status: 'waiting_to_start', priority: 'medium' },
    ],
    assets: [], phases: [{ id: 'ph1', name: 'Pre-production' }], teamAssignments: [], milestones: [],
    taskItems: [], taskItemsAvailable: false,
    myProjectRole: 'manager', projectIsStaffed: false,
    updateTask: vi.fn(), deleteTask: vi.fn(), deleteTasks: vi.fn(async () => {}), addTask: vi.fn(async () => ({ id: 'new' })),
  }
  rabbit.current = ctx
  render(<ProjectTasksView />)
  return ctx
}
function taskWindow() {
  const ctx = {
    project: { id: 'p1', name: 'Salt Hours' },
    tasks: [{ id: 't1', title: 'Glass and rain rig test', status: 'in_progress', priority: 'high' }],
    assets: [], phases: [], milestones: [], taskItems: [], taskItemsAvailable: false, files: [], managedFiles: [],
    myProjectRole: 'manager', projectIsStaffed: false,
    updateTask: vi.fn(), deleteTask: vi.fn(),
  }
  rabbit.current = ctx
  render(<TaskDetailPopup taskId="t1" ctx={ctx} onClose={() => {}} />)
  return ctx
}
// The Scenes page over one active list holding every row (rabbitScenesRender's
// listContext, which builds S3a's selectors over the rows).
const LIST_1 = { id: 'list-1', project_id: 'p1', title: 'Shot list 1', version: 1, summary: null, snapshot: {}, archived_at: null, archived_by: null, created_at: '2026-09-30T10:00:00Z', created_by: null }
function scenes() {
  const sceneRows = [
    { id: 'sc1', name: 'Lighthouse, dawn', scene_number: 1, status: 'final', type: 'interior', time_of_day: 'dawn', description: 'Mara lets herself in.' },
    { id: 'sc2', name: 'Cliff path', scene_number: 2, status: 'needs_revisions', type: 'exterior', time_of_day: null, description: '' },
  ]
  const shotRows = [{ id: 'sh1', scene_id: 'sc1', name: 'The door', shot_number: 10, status: 'final', type: 'other', frame_count: 240, description: '' }]
  const items = backfillItems(sceneRows, shotRows).map((it, i) => ({ id: `item-${i + 1}`, shot_list_id: LIST_1.id, project_id: 'p1', scene_id: null, shot_id: null, ...it }))
  const project = { id: 'p1', name: 'Salt Hours', fps: 24, active_shot_list_id: LIST_1.id }
  const pointer = { active_shot_list_id: LIST_1.id }
  const shotLists = [LIST_1]
  const ctx = {
    project,
    scenes: activeScenesOf({ project: pointer, shotLists, shotListItems: items, scenes: sceneRows, shots: shotRows }),
    shots: activeShotsOf({ project: pointer, shotLists, shotListItems: items, shots: shotRows }),
    allScenes: sceneRows, allShots: shotRows, shotLists, shotListItems: items, edits: [],
    activeShotList: activeShotListOf(pointer, shotLists),
    scenesOf: (id) => scenesOfList(sceneRows, items, id, shotRows),
    shotsOf: (id) => shotsOfList(shotRows, items, id, sceneRows),
    listsContaining: (id) => listsContainingOf({ shotLists, shotListItems: items, shots: shotRows }, id),
    unlistedScenes: unlistedScenesOf({ shotLists, shotListItems: items, scenes: sceneRows, shots: shotRows }),
    unlistedShots: unlistedShotsOf({ shotLists, shotListItems: items, shots: shotRows }),
    sceneById: (id) => (id ? sceneRows.find((s) => s.id === id) || null : null),
    shotById: (id) => (id ? shotRows.find((s) => s.id === id) || null : null),
    nextShotListVersion: (title) => nextShotListVersion(shotLists, title),
    formatShotListLabel, isWithdrawn, recentlyWithdrawn: null, canWithdrawShotList: () => false,
    assets: [], tasks: [], phases: [], teamAssignments: [], files: [], managedFiles: [],
    binsInfo: { loadedFor: 'p1' },
    updateScene: vi.fn(), updateShot: vi.fn(), deleteScene: vi.fn(async () => {}), deleteShot: vi.fn(async () => {}),
    addScene: vi.fn(async () => {}), addShot: vi.fn(async () => {}),
    clearRecentlyWithdrawn: vi.fn(), runBatch: vi.fn(async (fn) => fn()),
  }
  rabbit.current = ctx
  render(<ScenesView pageActive />)
  return ctx
}

const row = (text) => screen.getAllByText(text).map((n) => n.closest('tr')).find(Boolean)
const openWindow = (name) => fireEvent.click(within(row(name)).getByRole('button', { name: `Open ${name}` }))

// ── 1. P1-06: focus back on the words, in each editor's real view ──────────
const EDITORS = [
  { editor: 'Levels: a row\'s name', mount: levels, words: () => within(row('Harbour Approach')).getByRole('button', { name: 'Harbour Approach' }), field: 'Name' },
  { editor: 'Levels: the window\'s name', mount: levels, before: () => openWindow('Harbour Approach'),
    words: () => within(screen.getByRole('dialog').querySelector('.rb-ent-detail-main')).getByRole('button', { name: 'Harbour Approach' }), field: 'Level name' },
  { editor: 'Assets: a row\'s name', mount: assets, words: () => within(row('Mara')).getByRole('button', { name: 'Mara' }), field: 'Name' },
  { editor: 'Assets: a card\'s name', mount: assets, before: () => fireEvent.click(screen.getByRole('tab', { name: 'Gallery' })),
    words: () => screen.getByText('Mara', { selector: '.rb-asset-card-name .rb-asset-inline' }), field: 'Name' },
  { editor: 'Assets: the window\'s title', mount: assets, before: () => openWindow('Mara'),
    words: () => screen.getByText('Mara', { selector: '.rb-asset-detail-title .rb-asset-inline' }), field: 'Name' },
  { editor: 'Tasks: a row\'s title', mount: tasks, words: () => within(row('Glass and rain rig test')).getByRole('button', { name: 'Glass and rain rig test' }), field: 'Title' },
  { editor: 'the task window\'s title', mount: taskWindow, words: () => screen.getByText('Glass and rain rig test', { selector: '.rb-task-textblock[data-size="line"]' }), field: 'Title' },
  { editor: 'Scenes: a row\'s name (a span, no tab stop)', mount: scenes, words: () => screen.getByText('Lighthouse, dawn', { selector: '.rb-scene-name-cell .rb-scene-inline' }), field: 'Name for Lighthouse, dawn' },
  { editor: 'Scenes: the window\'s name (the control: it did this before F10)', mount: scenes, before: () => openWindow('Lighthouse, dawn'),
    words: () => screen.getByText('Lighthouse, dawn', { selector: '.rb-scene-name-text' }), field: 'Scene name' },
]

describe.each(EDITORS)('P1-06 — $editor: focus comes back to the words', ({ mount, before, words, field }) => {
  it('after Enter commits, and after Escape reverts', () => {
    mount()
    before?.()
    for (const key of ['Enter', 'Escape']) {
      fireEvent.click(words())
      const box = screen.getByRole('textbox', { name: field })
      expect(document.activeElement, key).toBe(box)
      fireEvent.change(box, { target: { value: `${box.value} II` } })
      fireEvent.keyDown(box, { key })
      expect(screen.queryByRole('textbox', { name: field }), key).toBeNull()
      expect(document.activeElement, key).toBe(words())
    }
  })
})

describe('P1-06 — the Scenes table\'s words stay off the tab order (C1)', () => {
  it('the span is focusable by script only, with no role and no tab stop added to its row', () => {
    scenes()
    const span = screen.getByText('Lighthouse, dawn', { selector: '.rb-scene-name-cell .rb-scene-inline' })
    expect(span.tagName).toBe('SPAN')
    expect(span.getAttribute('tabindex')).toBe('-1')
    expect(span.hasAttribute('role')).toBe(false)
    const tabStops = [...row('Lighthouse, dawn').querySelectorAll('*')].filter((n) => n.tabIndex >= 0)
    expect(tabStops).not.toContain(span)
  })
})

// ── 2. "None" in the bulk bars clears the field ─────────────────────────────
describe('the bulk bars\' "None" clears the field on every ticked row (it wrote nothing before F10)', () => {
  // The bulk bar's own picker (a row's Phase cell is a select of that name too).
  const bar = () => document.querySelector('.rb-task-bulk, .rb-asset-bulk')
  const pickNone = (label) => {
    const select = within(bar()).getByRole('combobox', { name: label })
    const none = [...select.options].find((o) => o.textContent === 'None')
    fireEvent.change(select, { target: { value: none.value } })
  }
  it('Tasks: Phase and Assignee', () => {
    const ctx = tasks()
    fireEvent.click(screen.getByRole('button', { name: 'Select "Glass and rain rig test"' }))
    pickNone('Phase')
    expect(ctx.updateTask).toHaveBeenCalledWith('t1', { phase_id: null })
    fireEvent.click(screen.getByRole('button', { name: 'Select "Glass and rain rig test"' }))
    pickNone('Assignee')
    expect(ctx.updateTask).toHaveBeenCalledWith('t1', { assignee_id: null })
  })
  it('Assets: Phase', () => {
    const ctx = assets()
    fireEvent.click(screen.getByRole('button', { name: 'Select Mara' }))
    pickNone('Phase')
    expect(ctx.updateAsset).toHaveBeenCalledWith('a1', { phase_id: null })
  })
  it('CONTROL: a real choice still writes its value', () => {
    const ctx = assets()
    fireEvent.click(screen.getByRole('button', { name: 'Select Mara' }))
    fireEvent.change(within(bar()).getByRole('combobox', { name: 'Phase' }), { target: { value: 'ph1' } })
    expect(ctx.updateAsset).toHaveBeenCalledWith('a1', { phase_id: 'ph1' })
  })
})

// ── 3. Each view's question asks as its copy did ────────────────────────────
const question = (title) => screen.getByRole('dialog', { name: title })
const backdropOf = (d) => d.closest('.ui-dialog-backdrop')
describe('each view\'s delete question asks as its copy did', () => {
  it('Levels, a row: Cancel focused; Escape and the backdrop keep the row; Delete deletes once', () => {
    const ctx = levels()
    const ask = () => fireEvent.click(within(row('Harbour Approach')).getByRole('button', { name: 'Delete Harbour Approach' }))
    ask()
    expect(document.activeElement).toBe(within(question('Delete level?')).getByRole('button', { name: 'Cancel' }))
    expect(backdropOf(question('Delete level?')).parentElement).toBe(document.body)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    ask()
    fireEvent.mouseDown(backdropOf(question('Delete level?')))
    expect(screen.queryByRole('dialog')).toBeNull()
    ask()
    fireEvent.click(within(question('Delete level?')).getByRole('button', { name: 'Delete' }))
    expect(ctx.deleteLevel).toHaveBeenCalledTimes(1)
    expect(ctx.deleteLevel).toHaveBeenCalledWith('l1')
  })
  it('Levels, the bulk bar: in <body>, Cancel focused, the backdrop does NOT close it', () => {
    const ctx = levels()
    fireEvent.click(within(row('Harbour Approach')).getByRole('button', { name: 'Select Harbour Approach' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const q = question('Delete levels')
    expect(backdropOf(q).parentElement).toBe(document.body)
    expect(document.activeElement).toBe(within(q).getByRole('button', { name: 'Cancel' }))
    fireEvent.mouseDown(backdropOf(q))
    expect(question('Delete levels')).toBe(q)
    fireEvent.click(within(q).getByRole('button', { name: 'Delete' }))
    expect(ctx.deleteLevel).toHaveBeenCalledWith('l1')
  })
  it('Scenes, a row: Cancel focused, the backdrop closes it, Delete deletes once', () => {
    const ctx = scenes()
    const ask = () => fireEvent.click(within(row('Cliff path')).getByRole('button', { name: 'Delete Cliff path' }))
    ask()
    const q = screen.getByRole('dialog')
    expect(q.getAttribute('data-width')).toBe('confirm')
    expect(document.activeElement).toBe(within(q).getByRole('button', { name: 'Cancel' }))
    fireEvent.mouseDown(backdropOf(q))
    expect(screen.queryByRole('dialog')).toBeNull()
    ask()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(ctx.deleteScene).toHaveBeenCalledTimes(1)
    expect(ctx.deleteScene).toHaveBeenCalledWith('sc2')
  })
  it('Assets and Tasks, the bulk bar: drawn in the view (not portalled), Cancel focused, the backdrop does not close it', () => {
    for (const [mount, tick, title] of [
      [assets, 'Select Mara', 'Delete assets'],
      [tasks, 'Select "Glass and rain rig test"', 'Delete 1 task?'],
    ]) {
      const { container } = { container: document.body }
      mount()
      fireEvent.click(screen.getByRole('button', { name: tick }))
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      const q = question(title)
      expect(backdropOf(q).parentElement, title).not.toBe(container)
      expect(document.activeElement, title).toBe(within(q).getByRole('button', { name: 'Cancel' }))
      fireEvent.mouseDown(backdropOf(q))
      expect(question(title), title).toBe(q)
      fireEvent.click(within(q).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog'), title).toBeNull()
      cleanup(); _resetOverlaysForTests()
    }
  })
})

// ── 4. The views' names for the kit pieces are props only ───────────────────
const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
const FILES = ['EntityListView.jsx', 'ProjectAssetsView.jsx', 'ProjectTasksView.jsx', 'ScenesView.jsx', '../components/TaskDetailPopup.jsx']
/** A column-0 function's own lines, to the next column-0 function, const, export or divider. */
function functionsOf(src) {
  const out = {}
  let name = null
  for (const line of src.split('\n')) {
    const m = line.match(/^(?:export (?:default )?)?function ([A-Za-z0-9_]+)\(/)
    if (m) { name = m[1]; out[name] = [line]; continue }
    if (name && /^(const |export |\/\/ ─)/.test(line)) { name = null; continue }
    if (name) out[name].push(line)
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]))
}
const PIECE = /InlineText$|BulkSelect$|^ConfirmDialog$|^FieldLabel$/
const BEHAVIOUR = /\buse(State|Effect|Ref|Callback)\(|\bon(KeyDown|Blur)=/
describe('the views\' names for the kit pieces hold no behaviour of their own', () => {
  it('each is the kit piece with the view\'s look: no state, effect, ref, key or blur handler', () => {
    const found = []
    for (const file of FILES) {
      for (const [name, text] of Object.entries(functionsOf(read(file)))) {
        if (!PIECE.test(name)) continue
        found.push(`${file}:${name}`)
        expect(text, `${file}: ${name}`).not.toMatch(BEHAVIOUR)
        // The editors call the kit's hook (one component an editor: F4's
        // render counts); the bulk pickers, labels and questions draw the kit's.
        expect(text, `${file}: ${name}`).toMatch(/\buseInlineText\(|<Kit(BulkSelect|FieldLabel)\b|<Confirm\b/)
      }
    }
    // Sixteen names stand for the kit's pieces (the four optional-toast hooks went).
    expect(found.length).toBe(16)
  })
  it('no view writes the optional-toast hook again', () => {
    for (const file of FILES.slice(0, 4)) expect(read(file), file).not.toMatch(/function useOptionalToast\(/)
  })
  it('CONTROL: the scan sees a copy that grows state again, and reads only its own function', () => {
    const src = 'function InlineText({ value }) {\n  const [e, setE] = useState(false)\n  return <KitInlineText value={value} />\n}\nconst X = 1\nfunction Other() { useState(1) }'
    const fns = functionsOf(src)
    expect(fns.InlineText).toMatch(BEHAVIOUR)
    expect(fns.InlineText).not.toMatch(/Other/)
    expect('function BulkSelect() { return <select onBlur={x} /> }').toMatch(BEHAVIOUR)
  })
})
