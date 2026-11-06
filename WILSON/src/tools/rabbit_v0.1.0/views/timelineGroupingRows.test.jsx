/** @vitest-environment jsdom */
// =============================================================================
// VW1d (2026-10-25) — the Timeline's rows for the project's groupings
// (docs/design/CUSTOM_VIEWS_DESIGN.md §4.11, as VW1d's step 0 review, finding
// 8, wrote it). Her Q-D2 ("Saved for the project") and Q-D4 ("make the
// grouping a group in the timeline as well. do not add a new group button in
// timeline view though"): a grouping made on the Tasks table is a row on the
// Timeline grouped by its kind, even while empty; a grouping of one adds
// nothing (each item has its row); shot groupings sit under their one scene,
// or under a scene combination made for them; a grouping naming a row outside
// the active shot list is no row here. Each with a CONTROL.
// =============================================================================
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => ({}) }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [] }) }))
vi.mock('../state/useProjectAccess', () => ({ useProjectAccess: () => ({ canWrite: true, writeReason: null }) }))
vi.mock('../components/FileManager', () => ({ default: () => null }))
vi.mock('../components/TaskDetailPopup', () => ({ default: () => null }))
vi.mock('../../../components/TaskTemplates/TaskTemplateManager', () => ({ default: () => null }))

const { buildRowsByGrouping } = await import('./TimelineView.jsx')
const { buildItemLookup } = await import('../state/taskItemsModel')

const schedule = { tasks: {}, phases: {} }
const groups = (rows) => rows.filter(r => r.kind === 'phase').map(r => r.label)
const A = { id: 'A', name: 'Lighthouse Interior' }
const B = { id: 'B', name: 'Storm Lantern' }
const C = { id: 'C', name: 'Dock' }
const tasks = [{ id: 't1', title: 'Light the interior' }]
const items = [{ id: 'i1', task_id: 't1', project_id: 'p1', entity_type: 'asset', entity_id: 'A', position: 0 }]

describe('by asset, level or experience', () => {
  const lookup = buildItemLookup({ items, available: true, assets: [A, B, C] })
  const rows = (groupings) => buildRowsByGrouping({ groupBy: 'asset', phases: [], assets: [A, B, C], tasks, schedule, itemLookup: lookup, groupings })
  it('a grouping of two or more is a combination row, empty, after the single rows; CONTROL: without it, no such row', () => {
    // The single rows by their dates, then names (the Timeline's own order).
    expect(groups(rows({ asset: [['B', 'C']] }))).toEqual(['Dock', 'Lighthouse Interior', 'Storm Lantern', 'Dock, Storm Lantern'])
    expect(groups(rows(null))).toEqual(['Dock', 'Lighthouse Interior', 'Storm Lantern'])
    const combo = rows({ asset: [['B', 'C']] }).find(r => r.label === 'Dock, Storm Lantern')
    expect(combo.items).toEqual({ asset: ['C', 'B'] })
  })
  it('a grouping of one adds nothing (the item has its row); one whose set tasks already have is that row, not a second', () => {
    const t2 = [{ id: 't2', title: 'Both' }]
    const both = [{ id: 'i2', task_id: 't2', project_id: 'p1', entity_type: 'asset', entity_id: 'B', position: 0 }, { id: 'i3', task_id: 't2', project_id: 'p1', entity_type: 'asset', entity_id: 'C', position: 1 }]
    const lk = buildItemLookup({ items: both, available: true, assets: [A, B, C] })
    const out = buildRowsByGrouping({ groupBy: 'asset', phases: [], assets: [A, B, C], tasks: t2, schedule, itemLookup: lk, groupings: { asset: [['A'], ['C', 'B']] } })
    expect(groups(out).filter(l => l === 'Dock, Storm Lantern')).toHaveLength(1)
    expect(groups(out).filter(l => l === 'Lighthouse Interior')).toHaveLength(1)
  })
  it('a grouping naming a row the Timeline does not hold is no row', () => {
    expect(groups(rows({ asset: [['B', 'gone']] }))).toEqual(['Dock', 'Lighthouse Interior', 'Storm Lantern'])
  })
  it('levels take theirs too', () => {
    const L1 = { id: 'L1', name: 'Cliff Path' }
    const L2 = { id: 'L2', name: 'Harbour' }
    const out = buildRowsByGrouping({ groupBy: 'level', phases: [], assets: [], tasks: [], levels: [L1, L2], schedule, itemLookup: buildItemLookup({ items: [], available: true, levels: [L1, L2] }), groupings: { level: [['L1', 'L2']] } })
    expect(groups(out)).toEqual(['Cliff Path', 'Harbour', 'Cliff Path, Harbour'])
  })
})

describe('by scene: scene and shot groupings', () => {
  const S1 = { id: 'S1', name: 'The storm', scene_number: 1 }
  const S2 = { id: 'S2', name: 'Harbour', scene_number: 2 }
  const S9 = { id: 'S9', name: 'Cut scene', scene_number: 9 }
  const H1 = { id: 'H1', scene_id: 'S1', name: 'Rain', shot_number: 1 }
  const H2 = { id: 'H2', scene_id: 'S1', name: 'Glass', shot_number: 2 }
  const H3 = { id: 'H3', scene_id: 'S2', name: 'Pier', shot_number: 1 }
  const lookup = buildItemLookup({ items: [], available: true, scenes: [S1, S2, S9], shots: [H1, H2, H3] })
  const rows = (groupings) => buildRowsByGrouping({ groupBy: 'scene', phases: [], assets: [], tasks: [], scenes: [S1, S2], shots: [H1, H2, H3], schedule, itemLookup: lookup, groupings })
  it('two scenes: a scene combination row; CONTROL: none without it', () => {
    expect(groups(rows({ scene: [['S1', 'S2']] }))).toContain('The storm, Harbour')
    expect(groups(rows(null))).not.toContain('The storm, Harbour')
  })
  it('shots of one scene: a shot combination row under that scene', () => {
    const out = rows({ shot: [['H1', 'H2']] })
    const at = out.findIndex(r => r.label === 'Rain, Glass')
    expect(at).toBeGreaterThan(-1)
    expect(out[at].depth).toBe(1)
    expect(out.slice(0, at).reverse().find(r => r.kind === 'phase' && r.depth === 0).label).toBe('The storm')
  })
  it('shots across scenes: under a scene combination made for them', () => {
    const out = rows({ shot: [['H1', 'H3']] })
    const at = out.findIndex(r => r.label === 'Rain, Pier')
    expect(at).toBeGreaterThan(-1)
    expect(out.slice(0, at).reverse().find(r => r.kind === 'phase' && r.depth === 0).label).toBe('The storm, Harbour')
  })
  it('a scene outside the active list is no row here (the Timeline reads the active list)', () => {
    expect(groups(rows({ scene: [['S1', 'S9']] })).some(l => l.includes('Cut scene'))).toBe(false)
  })
})
