// mothHistoryScrub.test.js — MO2: the time slider rebuilds the picture from the live graph, undoing the record's
// rows newest first back to the chosen time. It reads only.
import { describe, it, expect, vi } from 'vitest'
import { rewind, recordedSince, readHistory, HISTORY_DAYS, RECENT_DAYS } from './mothHistoryScrub.js'

const DAY = 86400000
const NOW = Date.parse('2026-11-07T12:00:00Z')
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString()

const live = () => ({
  islands: [{ id: 'p1', title: 'Salt Hours' }],
  folders: { p1: [{ id: 'd1', parent_id: null, kind: 'custom', slug: 'shots', label: 'Shots' }] },
  files: { p1: [{ id: 'f1', project_id: 'p1', folder_id: 'd1', name: 'take2.mov', tags: ['shots'] }] },
  items: { p1: [{ id: 't1', kind: 'task', name: 'Grade' }] },
  relations: [{ source: { kind: 'task', id: 't1' }, target: { kind: 'asset', id: 'a1' }, label: 'task_item' }],
})

describe('rewind', () => {
  it('leaves the live graph alone, and a row at or before the time changes nothing', () => {
    const c = live()
    const { catalogue } = rewind(c, [{ entity_type: 'files', entity_id: 'f1', action: 'added', observed_at: at(10), state_project_id: 'p1' }], NOW - 5 * DAY)
    expect(catalogue.files.p1.map((f) => f.id)).toEqual(['f1'])
    expect(c.files.p1).toHaveLength(1)
    expect(catalogue).not.toBe(c)
  })
  it('a file added after the time is absent before it', () => {
    const rows = [{ entity_type: 'files', entity_id: 'f1', action: 'added', observed_at: at(1), state_project_id: 'p1' }]
    expect(rewind(live(), rows, NOW - 2 * DAY).catalogue.files.p1).toEqual([])
  })
  it('a file trashed after the time is back, as its prior side says', () => {
    const c = live()
    c.files.p1 = []
    const rows = [{
      entity_type: 'files', entity_id: 'f9', action: 'trashed', observed_at: at(1), prior_project_id: 'p1',
      prior: { folder_id: 'd1', name: 'old.mov', mime_type: 'video/quicktime', kind: 'video', categories: ['reference'] },
    }]
    const f = rewind(c, rows, NOW - 2 * DAY).catalogue.files.p1
    expect(f).toEqual([expect.objectContaining({ id: 'f9', folder_id: 'd1', name: 'old.mov', tags: ['reference'], project_id: 'p1' })])
  })
  it('a move and a rename go back to where and what it was; newest first undoes in order', () => {
    const rows = [
      { entity_type: 'files', entity_id: 'f1', action: 'changed', observed_at: at(1), state_project_id: 'p1', prior_project_id: 'p1', prior: { folder_id: 'd1', name: 'take1.mov' } },
      { entity_type: 'files', entity_id: 'f1', action: 'moved', observed_at: at(3), state_project_id: 'p1', prior_project_id: 'p1', prior: { folder_id: null, name: 'take1.mov' } },
    ]
    expect(rewind(live(), rows, NOW - 2 * DAY).catalogue.files.p1[0]).toMatchObject({ name: 'take1.mov', folder_id: 'd1' })
    expect(rewind(live(), rows, NOW - 4 * DAY).catalogue.files.p1[0]).toMatchObject({ name: 'take1.mov', folder_id: null })
  })
  // 0124 (MO2-18): the record's prior side says when a row was in the trash.
  it('a file emptied from the trash while in it is not brought back for the time it spent there', () => {
    const c = live()
    c.files.p1 = []
    const rows = [
      { entity_type: 'files', entity_id: 'f9', action: 'removed', observed_at: at(2), prior_project_id: 'p1',
        prior: { name: 'old.png', folder_id: 'd1', in_trash: true } },
      { entity_type: 'files', entity_id: 'f9', action: 'trashed', observed_at: at(6), prior_project_id: 'p1', state_project_id: 'p1',
        prior: { name: 'old.png', folder_id: 'd1' }, state: { name: 'old.png', folder_id: 'd1', in_trash: true } },
    ]
    expect(rewind(c, rows, NOW - 4 * DAY).catalogue.files.p1).toEqual([])
    expect(rewind(c, rows, NOW - 8 * DAY).catalogue.files.p1.map((f) => f.name)).toEqual(['old.png'])
    // A row recorded before 0124 says nothing of the trash, and is put back as before.
    const old = [{ ...rows[0], prior: { name: 'old.png', folder_id: 'd1' } }]
    expect(rewind(c, old, NOW - 4 * DAY).catalogue.files.p1.map((f) => f.name)).toEqual(['old.png'])
  })
  it('an item or a project emptied from the trash while in it is not brought back either (0124)', () => {
    const c = live()
    c.items.p1 = []
    c.islands = []
    const rows = [
      { entity_type: 'tasks', entity_id: 't9', action: 'removed', observed_at: at(2), prior_project_id: 'p1', prior: { title: 'Old', in_trash: true } },
      { entity_type: 'projects', entity_id: 'p9', action: 'removed', observed_at: at(2), prior_project_id: 'p9', prior: { title: 'Gone', in_trash: true } },
    ]
    const { catalogue } = rewind(c, rows, NOW - 4 * DAY)
    expect(catalogue.items.p1).toEqual([])
    expect(catalogue.islands).toEqual([])
    // Without the key, as recorded before 0124, both come back as before.
    const old = rows.map((r) => ({ ...r, prior: { title: r.prior.title } }))
    const back = rewind(c, old, NOW - 4 * DAY).catalogue
    expect(back.items.p1.map((i) => i.name)).toEqual(['Old'])
    expect(back.islands.map((i) => i.title)).toEqual(['Gone'])
  })
  it('a file shows at a time only if its folder does', () => {
    const rows = [{ entity_type: 'folders', entity_id: 'd1', action: 'added', observed_at: at(1), state_project_id: 'p1' }]
    const { catalogue } = rewind(live(), rows, NOW - 2 * DAY)
    expect(catalogue.folders.p1).toEqual([])
    expect(catalogue.files.p1).toEqual([])
  })
  it('a row about an unknown id with nothing to put back is ignored', () => {
    const rows = [{ entity_type: 'files', entity_id: 'zz', action: 'changed', observed_at: at(1), state_project_id: 'p1', prior: null }]
    expect(rewind(live(), rows, NOW - 2 * DAY).catalogue.files.p1.map((f) => f.id)).toEqual(['f1'])
  })
  it('items, projects and task links rewind too', () => {
    const rows = [
      { entity_type: 'tasks', entity_id: 't1', action: 'changed', observed_at: at(1), state_project_id: 'p1', prior_project_id: 'p1', prior: { name: 'Colour' } },
      { entity_type: 'projects', entity_id: 'p1', action: 'changed', observed_at: at(1), prior: { title: 'Salt' } },
      { entity_type: 'task_items', entity_id: 'ti1', action: 'added', observed_at: at(1), state: { task_id: 't1', item_id: 'a1' } },
      { entity_type: 'task_items', entity_id: 'ti2', action: 'removed', observed_at: at(1), prior: { task_id: 't1', item_type: 'shot', item_id: 's1' } },
    ]
    const { catalogue } = rewind(live(), rows, NOW - 2 * DAY)
    expect(catalogue.items.p1).toEqual([expect.objectContaining({ id: 't1', kind: 'task', name: 'Colour' })])
    expect(catalogue.islands[0].title).toBe('Salt')
    expect(catalogue.relations).toEqual([{ source: { kind: 'task', id: 't1' }, target: { kind: 'shot', id: 's1' }, label: 'task_item' }])
  })
  it('an item goes back under the parent it had then, and a trashed project comes back (MO2 round 1)', () => {
    const c = live()
    c.items.p1.push({ id: 'sh1', kind: 'shot', name: 'Wide', parent_kind: 'scene', parent_id: 'sc2' })
    c.islands = []
    const rows = [
      { entity_type: 'shots', entity_id: 'sh1', action: 'moved', observed_at: at(1), state_project_id: 'p1', prior_project_id: 'p1', prior: { name: 'Wide', scene_id: 'sc1' } },
      { entity_type: 'projects', entity_id: 'p1', action: 'trashed', observed_at: at(1), prior: { title: 'Salt Hours' } },
    ]
    const { catalogue } = rewind(c, rows, NOW - 2 * DAY)
    expect(catalogue.items.p1.find((i) => i.id === 'sh1')).toMatchObject({ parent_kind: 'scene', parent_id: 'sc1' })
    expect(catalogue.islands).toEqual([{ id: 'p1', title: 'Salt Hours' }])
  })
  it('a project restored after the time was not there before it', () => {
    const rows = [{ entity_type: 'projects', entity_id: 'p1', action: 'restored', observed_at: at(1) }]
    expect(rewind(live(), rows, NOW - 2 * DAY).catalogue.islands).toEqual([])
  })
  it('rewinds 20,000 rows over 30,000 files without a search per row', () => {
    const c = live()
    c.files.p1 = Array.from({ length: 30000 }, (_, i) => ({ id: `f${i}`, project_id: 'p1', folder_id: null, name: `f${i}`, tags: [] }))
    const rows = Array.from({ length: 20000 }, (_, i) => ({ entity_type: 'files', entity_id: `f${i}`, action: 'added', observed_at: at(1), state_project_id: 'p1' }))
    const t0 = Date.now()
    const { catalogue } = rewind(c, rows, NOW - 2 * DAY)
    expect(catalogue.files.p1).toHaveLength(10000)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
  it('a project added after the time is not there', () => {
    const rows = [{ entity_type: 'projects', entity_id: 'p1', action: 'added', observed_at: at(1) }]
    expect(rewind(live(), rows, NOW - 2 * DAY).catalogue.islands).toEqual([])
  })
  it('marks what changed in the week before the time, and skips a row with no time', () => {
    const rows = [
      { entity_type: 'files', entity_id: 'f1', action: 'changed', observed_at: at(3), state_project_id: 'p1', prior_project_id: 'p1', prior: { folder_id: 'd1', name: 'x' } },
      { entity_type: 'files', entity_id: 'f2', action: 'changed', observed_at: at(2 + RECENT_DAYS + 1), state_project_id: 'p1' },
      { entity_type: 'files', entity_id: 'f3', action: 'changed', observed_at: 'not a time' },
    ]
    const { changed } = rewind(live(), rows, NOW - 2 * DAY)
    expect(changed).toEqual(new Set(['f1']))
  })
})

describe('recordedSince', () => {
  it('is the latest recording start, never before the 90 days kept, never after now', () => {
    expect(recordedSince([], NOW)).toBe(NOW - HISTORY_DAYS * DAY)
    expect(recordedSince([{ recording_since: at(200) }], NOW)).toBe(NOW - HISTORY_DAYS * DAY)
    expect(recordedSince([{ recording_since: at(30) }, { recording_since: at(10) }, { recording_since: null }], NOW)).toBe(NOW - 10 * DAY)
    expect(recordedSince([{ recording_since: at(-3) }], NOW)).toBe(NOW)
  })
})

describe('readHistory', () => {
  it('follows the opaque key page by page, and says when it stopped short', async () => {
    const pages = [[{ row_key: 'k1' }, { row_key: 'k2' }], [{ row_key: 'k3' }, { row_key: 'k4' }], [{ row_key: 'k5' }]]
    const adapter = { fetchMothHistory: vi.fn(async ({ after }) => pages[{ null: 0, k2: 1, k4: 2 }[String(after)]]) }
    const all = await readHistory(adapter, NOW - DAY, { limit: 2 })
    expect(all).toEqual({ rows: pages.flat(), complete: true })
    expect(adapter.fetchMothHistory).toHaveBeenNthCalledWith(1, { since: new Date(NOW - DAY).toISOString(), after: null, limit: 2 })
    expect(adapter.fetchMothHistory).toHaveBeenNthCalledWith(2, expect.objectContaining({ after: 'k2' }))
    const short = await readHistory(adapter, NOW - DAY, { limit: 2, maxPages: 2 })
    expect(short.complete).toBe(false)
    expect(short.rows).toHaveLength(4)
  })
  it('an empty answer is a whole one', async () => {
    expect(await readHistory({ fetchMothHistory: async () => null }, NOW)).toEqual({ rows: [], complete: true })
  })
})
