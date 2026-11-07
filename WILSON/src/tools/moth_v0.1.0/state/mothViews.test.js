// mothViews.test.js — MO2: which view is on, where its dots are, and this person's Moth settings, against a fake
// adapter. A config never carries an id; a reviewer arranges a project's view on screen and nothing of it is saved;
// a database without 0123 keeps everything for the visit and says so.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMothViews, placesToRows, rowsToPlaces, RECENT_MAX, UNSAVED } from './mothViews.js'

const absent = () => Object.assign(new Error('not on this database'), { code: 'moth_absent' })
const view = (id, extra = {}) => ({ id, name: id, scope_kind: 'aggregate', project_id: null, revision: 1, position: 0, config: { nodeKinds: ['file', 'tag'], edgeKinds: ['tagged_with'] }, ...extra })
const pos = (type, id, extra = {}) => ({ target_type: type, target_id: type === 'tag' ? null : id, target_tag: type === 'tag' ? id : null, x: 1, y: 2, pinned: false, is_open: false, is_focus: false, ...extra })

let adapter, prefs
beforeEach(() => {
  prefs = {}
  let n = 0
  adapter = {
    getMothPrefs: vi.fn(async () => ({ ...prefs })),
    setMothPrefs: vi.fn(async (patch) => { prefs = { ...prefs, ...patch }; return { ...prefs } }),
    listMothViews: vi.fn(async () => []),
    listMothPositions: vi.fn(async () => []),
    createMothView: vi.fn(async ({ scopeKind, projectId, name, config, position }) => view(`new${++n}`, { scope_kind: scopeKind, project_id: projectId, name, config, position })),
    updateMothView: vi.fn(async (id, { config }, revision) => view(id, { config, revision: revision + 1 })),
    deleteMothView: vi.fn(async () => ({ removed: true })),
    putMothPositions: vi.fn(async (_id, rows) => rows.length),
    clearMothPositions: vi.fn(async () => 0),
  }
})
const settle = () => new Promise((ok) => setTimeout(ok, 0))

describe('places as rows and back', () => {
  it('round-trips dots, tags, what is open and the focus; drops a place with no number', () => {
    const rows = placesToRows({
      'folder:d1': { x: 1, y: 2, pinned: true }, 'tag:shots': { x: 3, y: 4 }, 'file:f1': { x: NaN, y: 0 },
    }, { open: new Set(['folder:d1']), focusId: 'tag:shots' })
    expect(rows).toEqual([
      { t: 'folder', id: 'd1', x: 1, y: 2, pinned: true, open: true, focus: false },
      { t: 'tag', tag: 'shots', x: 3, y: 4, pinned: false, open: false, focus: true },
    ])
    const back = rowsToPlaces([
      pos('folder', 'd1', { pinned: true, is_open: true }), pos('tag', 'shots', { is_focus: true }),
      pos('file', 'f2', { is_focus: true }), pos('file', 'f3', { x: null }),
    ])
    expect(back.places).toEqual({ 'folder:d1': { x: 1, y: 2, pinned: true }, 'tag:shots': { x: 1, y: 2, pinned: false }, 'file:f2': { x: 1, y: 2, pinned: false } })
    expect(back.open).toEqual(new Set(['folder:d1']))
    expect(back.focusId).toBe('tag:shots')
  })
})

describe('createMothViews: the first visit and the last view', () => {
  it('a first visit asks what to map; the answer is remembered', async () => {
    const store = createMothViews({ adapter })
    await store.start()
    expect(store.getSnapshot()).toMatchObject({ ready: true, firstVisit: true, current: { key: 'q:folders' } })
    await store.chooseStart('q:tags')
    await settle()
    expect(store.getSnapshot()).toMatchObject({ firstVisit: false, current: { key: 'q:tags' } })
    expect(prefs).toMatchObject({ first_visit_done: true, last_view: 'q:tags' })
  })
  it('a later visit reopens the last view with its places', async () => {
    prefs = { first_visit_done: true, last_view: 'v1' }
    adapter.listMothViews = vi.fn(async () => [view('v1')])
    adapter.listMothPositions = vi.fn(async () => [pos('file', 'f1', { is_focus: true }), pos('folder', 'd1', { is_open: true })])
    const store = createMothViews({ adapter })
    await store.start()
    const s = store.getSnapshot()
    expect(s.firstVisit).toBe(false)
    expect(s.current.key).toBe('v1')
    expect(s.places).toEqual({ 'file:f1': { x: 1, y: 2, pinned: false }, 'folder:d1': { x: 1, y: 2, pinned: false } })
    expect(s.focusId).toBe('file:f1')
    expect(s.open).toEqual(new Set(['folder:d1']))
    expect(store.start()).toBe(store.start())
  })
  it('a last view that is gone opens the folders', async () => {
    prefs = { first_visit_done: true, last_view: 'gone' }
    const store = createMothViews({ adapter })
    await store.start()
    expect(store.getSnapshot().current.key).toBe('q:folders')
  })
  it('a settings read that fails does not ask the first-visit question again', async () => {
    adapter.getMothPrefs = vi.fn(async () => { throw new Error('offline') })
    const store = createMothViews({ adapter })
    await store.start()
    expect(store.getSnapshot()).toMatchObject({ firstVisit: false, prefsAvailable: true })
  })
  it('dismissing the first visit is remembered', async () => {
    const store = createMothViews({ adapter })
    await store.start()
    store.dismissFirstVisit()
    await settle()
    expect(store.getSnapshot().firstVisit).toBe(false)
    expect(prefs.first_visit_done).toBe(true)
  })
  it('a view built from scratch on the first visit is unsaved', async () => {
    const store = createMothViews({ adapter })
    await store.start()
    await store.chooseStart(UNSAVED, { nodeKinds: ['task', 'asset'], edgeKinds: ['related_to'] })
    expect(store.getSnapshot()).toMatchObject({ unsaved: true, current: { key: UNSAVED, config: { nodeKinds: ['task', 'asset'] } } })
  })
})

describe('createMothViews: changing and saving', () => {
  it('changing a quick start makes an unsaved view and carries its places', async () => {
    const store = createMothViews({ adapter })
    await store.start()
    await store.savePlaces({ 'folder:d1': { x: 5, y: 6 } })
    store.setConfig({ layout: 'radial' })
    const s = store.getSnapshot()
    expect(s).toMatchObject({ unsaved: true, current: { key: UNSAVED, config: { layout: 'radial' } } })
    expect(adapter.putMothPositions).not.toHaveBeenCalled()
  })
  it('a new view is saved with its config, never an id, then its places', async () => {
    const store = createMothViews({ adapter })
    await store.start()
    store.setConfig({ nodeKinds: ['file', 'tag'] })
    const row = await store.save({ name: '  Tags  ', positions: { 'tag:shots': { x: 1, y: 1 } } })
    expect(adapter.createMothView).toHaveBeenCalledWith(expect.objectContaining({ scopeKind: 'aggregate', projectId: null, name: 'Tags' }))
    const sent = adapter.createMothView.mock.calls[0][0]
    expect(JSON.stringify(sent.config)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
    expect(adapter.putMothPositions).toHaveBeenCalledWith(row.id, [expect.objectContaining({ t: 'tag', tag: 'shots' })])
    await settle()
    expect(store.getSnapshot()).toMatchObject({ unsaved: false, current: { key: row.id } })
    expect(prefs.last_view).toBe(row.id)
  })
  it('saving in place sends the revision it opened, and says so when someone saved since', async () => {
    prefs = { first_visit_done: true, last_view: 'v1' }
    adapter.listMothViews = vi.fn(async () => [view('v1', { revision: 4 })])
    const store = createMothViews({ adapter })
    await store.start()
    store.setConfig({ layout: 'radial' })
    await store.save()
    expect(adapter.updateMothView).toHaveBeenCalledWith('v1', { config: expect.objectContaining({ layout: 'radial' }) }, 4)
    adapter.updateMothView = vi.fn(async () => null)
    store.setConfig({ layout: 'force' })
    await expect(store.save()).rejects.toThrow(/Someone saved this view/)
  })
  it('a project\'s view is written only by those who may change the project', async () => {
    prefs = { first_visit_done: true, last_view: 'pv' }
    adapter.listMothViews = vi.fn(async () => [view('pv', { scope_kind: 'project', project_id: 'p1' })])
    const store = createMothViews({ adapter })
    await store.start()
    expect(store.writable()).toBe(false)
    expect(await store.savePlaces({ 'file:f1': { x: 1, y: 1 } })).toBe(0)
    expect(adapter.putMothPositions).not.toHaveBeenCalled()
    store.setConfig({ layout: 'radial' })
    await expect(store.save()).rejects.toThrow(/Only those who may change this project/)
    store.setGate((pid) => pid === 'p1')
    expect(store.writable()).toBe(true)
    expect(await store.savePlaces({ 'file:f1': { x: 1, y: 1 } })).toBe(1)
  })
  it('a writable saved view with no places yet asks for them', async () => {
    prefs = { first_visit_done: true, last_view: 'v1' }
    adapter.listMothViews = vi.fn(async () => [view('v1')])
    const store = createMothViews({ adapter })
    await store.start()
    expect(store.getSnapshot().needsPlaces).toBe(true)
    await store.savePlaces({ 'file:f1': { x: 1, y: 1 } })
    expect(store.getSnapshot().needsPlaces).toBe(false)
  })
  it('only the newest places read lands', async () => {
    prefs = { first_visit_done: true }
    adapter.listMothViews = vi.fn(async () => [view('v1'), view('v2')])
    let release
    adapter.listMothPositions = vi.fn(async (id) => {
      if (id === 'v1') { await new Promise((ok) => { release = ok }); return [pos('file', 'slow')] }
      return [pos('file', 'fast')]
    })
    const store = createMothViews({ adapter })
    await store.start()
    const first = store.select('v1')
    await store.select('v2')
    release()
    await first
    expect(Object.keys(store.getSnapshot().places)).toEqual(['file:fast'])
  })
})

describe('createMothViews: delete, undo, reset', () => {
  it('Delete goes back to the folders; Undo makes the view again with its places', async () => {
    prefs = { first_visit_done: true, last_view: 'v1' }
    adapter.listMothViews = vi.fn(async () => [view('v1', { name: 'Mine' })])
    adapter.listMothPositions = vi.fn(async (id) => (id === 'v1' ? [pos('folder', 'd1', { is_open: true, is_focus: true })] : []))
    const store = createMothViews({ adapter })
    await store.start()
    const undo = await store.remove('v1')
    expect(store.getSnapshot().views).toEqual([])
    expect(store.getSnapshot().current.key).toBe('q:folders')
    await undo()
    expect(adapter.createMothView).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mine', scopeKind: 'aggregate' }))
    const again = store.getSnapshot().views[0]
    expect(adapter.putMothPositions).toHaveBeenCalledWith(again.id, [{ t: 'folder', id: 'd1', x: 1, y: 2, pinned: false, open: true, focus: true }])
    expect(store.getSnapshot().current.key).toBe(again.id)
  })
  it('a view that could not be deleted says so; one that is not known is nothing', async () => {
    adapter.listMothViews = vi.fn(async () => [view('v1')])
    adapter.deleteMothView = vi.fn(async () => ({ removed: false }))
    const store = createMothViews({ adapter })
    await store.start()
    expect(await store.remove('nobody')).toBeNull()
    await expect(store.remove('v1')).rejects.toThrow(/could not be deleted/)
  })
  it('Reset clears a saved view\'s places on the server and a quick start\'s for the visit', async () => {
    prefs = { first_visit_done: true, last_view: 'v1' }
    adapter.listMothViews = vi.fn(async () => [view('v1')])
    const store = createMothViews({ adapter })
    await store.start()
    await store.reset()
    expect(adapter.clearMothPositions).toHaveBeenCalledWith('v1')
    await store.select('q:tags')
    await store.savePlaces({ 'tag:shots': { x: 1, y: 1 } })
    await store.reset()
    expect(store.getSnapshot().places).toBeNull()
  })
})

describe('createMothViews: open, focus, recent folders, appearance', () => {
  it('opening a folder notes it among the eight newest, once each, and never a file', async () => {
    prefs = { first_visit_done: true, recent: [] }
    const store = createMothViews({ adapter })
    await store.start()
    for (let i = 0; i < RECENT_MAX + 2; i++) { store.toggleOpen(`folder:d${i}`); await settle() }
    store.noteOpened('folder:d3')
    await settle()
    store.noteOpened('file:f1')
    await settle()
    expect(prefs.recent).toHaveLength(RECENT_MAX)
    expect(prefs.recent[0]).toEqual({ k: 'folder', id: 'd3' })
    expect(prefs.recent.filter((r) => r.id === 'd3')).toHaveLength(1)
    expect(prefs.recent.some((r) => r.k === 'file')).toBe(false)
    expect(store.getSnapshot().open.size).toBe(RECENT_MAX + 2)
    store.toggleOpen('folder:d0')
    expect(store.getSnapshot().open.has('folder:d0')).toBe(false)
  })
  it('opens many at once and sets the focus', async () => {
    const store = createMothViews({ adapter })
    await store.start()
    store.openAll(['project:p1', 'project:p2'])
    store.setFocus('file:f1')
    expect(store.getSnapshot().open).toEqual(new Set(['project:p1', 'project:p2']))
    expect(store.getSnapshot().focusId).toBe('file:f1')
    store.setFocus(null)
    expect(store.getSnapshot().focusId).toBeNull()
  })
  it('appearance is read back in its own words and written as a patch', async () => {
    const store = createMothViews({ adapter })
    await store.start()
    store.setAppearance({ glow: '#9fd3ff', light: 'nonsense' })
    expect(store.getSnapshot().prefs.appearance).toMatchObject({ glow: '#9fd3ff', light: 'auto' })
    expect(adapter.setMothPrefs).toHaveBeenCalledWith({ appearance: { glow: '#9fd3ff', light: 'nonsense' } })
  })
})

describe('createMothViews: a database without 0123', () => {
  it('keeps the views and settings for this visit only, and says why a save cannot happen', async () => {
    adapter.getMothPrefs = vi.fn(async () => null)
    adapter.setMothPrefs = vi.fn(async () => { throw absent() })
    adapter.listMothViews = vi.fn(async () => { throw absent() })
    const store = createMothViews({ adapter })
    await store.start()
    expect(store.getSnapshot()).toMatchObject({ available: false, prefsAvailable: false })
    store.setAppearance({ glow: '#ffffff' })
    store.dismissFirstVisit()
    await settle()
    expect(store.getSnapshot().prefs).toMatchObject({ appearance: { glow: '#ffffff' }, first_visit_done: true })
    expect(adapter.setMothPrefs).not.toHaveBeenCalled()
    await expect(store.save({ name: 'x' })).rejects.toThrow(/not on this database yet/)
  })
  it('a settings write that finds the column gone keeps the rest for the visit', async () => {
    adapter.setMothPrefs = vi.fn(async () => { throw absent() })
    const store = createMothViews({ adapter })
    await store.start()
    store.setAppearance({ size_by: 'recency' })
    await settle()
    expect(store.getSnapshot().prefsAvailable).toBe(false)
    expect(store.getSnapshot().prefs.appearance).toMatchObject({ size_by: 'recency' })
  })
})
