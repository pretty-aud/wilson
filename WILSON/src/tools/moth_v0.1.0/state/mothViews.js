// mothViews.js — MO2: which view is on, where its dots are, what is open and in focus, and this person's Moth
// settings (0123: moth_views, moth_layout_positions, user_settings.moth_prefs; the brief §2, §3.1, §12a.2-3).
//
// One store per adapter. On first entry it reads the person's settings and the views they can see. The first
// visit (no settings yet, or the first visit not done) asks what to map; later visits reopen the last view
// (her §12a.2). A saved view's places come from the server, each only while Moth shows its target; a quick start's
// live for the session only. Saving a view writes its config (never an id: the server refuses one) and its
// places, through the person who may write it: a person's own view by its owner, a project's by those who may
// write to that project. A reviewer can arrange a project's shared view on screen; nothing of it is saved.
//
// Places are written as they change, and only what changed (MO2 review round 1): a dot moved by hand, and a folder
// opened or closed or the focus moved, each noted under the view it was changed in and written to that view, even
// if another view is on screen by then. So two people arranging one shared view each keep what they moved, a save
// never lands in the wrong view, and a project's view is sent that project's things only (the server refuses any
// other). A place is sent only for a dot of the live catalogue (`setLookup`): never while looking back, never for a
// made-up replay.
//
// What a database before 0123 cannot keep, the store keeps for the session and says so: `available` is false.
import { QUICK_VIEWS, isQuick, normalizeConfig, configHasId } from './mothViewState.js'
import { normalizeAppearance } from './mothAppearance.js'

const absent = (err) => err?.code === 'moth_absent'
const kindOf = (id) => String(id).slice(0, String(id).indexOf(':'))
const rowOf = (id) => String(id).slice(String(id).indexOf(':') + 1)
export const RECENT_MAX = 8
export const UNSAVED = 'unsaved'
export const NAME_MAX = 80

/** A view's name as the server keeps it: no control characters, trimmed, at most 80 letters, then trimmed again. */
export function viewName(raw) {
  // eslint-disable-next-line no-control-regex
  const clean = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  const cut = Array.from(clean).slice(0, NAME_MAX).join('').trim()
  return cut || 'My view'
}

const isPlace = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
/** One place as moth_put_positions takes it. */
function placeRow(id, p, { open = false, focus = false } = {}) {
  const kind = kindOf(id)
  const head = kind === 'tag' ? { t: 'tag', tag: rowOf(id) } : { t: kind, id: rowOf(id) }
  return { ...head, x: p.x, y: p.y, pinned: !!p.pinned, open: !!open, focus: !!focus }
}

/** A view's places as rows for moth_put_positions: one per dot on show, open and focus marked. */
export function placesToRows(positions, { open = new Set(), focusId = null } = {}) {
  const rows = []
  for (const [id, p] of Object.entries(positions || {})) {
    if (!kindOf(id) || !isPlace(p)) continue
    rows.push(placeRow(id, p, { open: open.has(id), focus: id === focusId }))
  }
  return rows
}

/** The rows moth_view_positions answers, as the world's places, the open containers and the focus. */
export function rowsToPlaces(rows) {
  const places = {}
  const open = new Set()
  let focusId = null
  for (const r of rows || []) {
    const id = r.target_type === 'tag' ? `tag:${r.target_tag}` : `${r.target_type}:${r.target_id}`
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) continue
    places[id] = { x: r.x, y: r.y, pinned: !!r.pinned }
    if (r.is_open) open.add(id)
    if (r.is_focus && !focusId) focusId = id
  }
  return { places, open, focusId }
}

/** A server's refusal of a place, in a person's words. */
function placesError(err) {
  const code = err?.code ?? ''
  if (code === '23503' || /foreign key/i.test(err?.message ?? '')) {
    return new Error('Some places could not be kept: what they belong to has gone, or is no longer yours to see. Nothing in this view changed.')
  }
  if (code === '23514') return new Error('A project\'s view keeps that project\'s things only.')
  return err instanceof Error ? err : new Error(String(err))
}

export function createMothViews({ adapter, now = () => Date.now() }) {
  const listeners = new Set()
  let started = null
  let s = {
    ready: false,
    available: true, // moth_views is on this database
    prefsAvailable: true,
    prefs: {},
    firstVisit: false,
    views: [],
    current: { key: 'q:folders', config: QUICK_VIEWS['q:folders'].config, row: null },
    unsaved: false,
    places: null,
    placesKey: null,
    open: null,
    focusId: null,
    needsPlaces: false,
  }
  const session = new Map() // a quick start's (or an unsaved view's) places, open and focus, for this session
  const pending = new Map() // a saved view's id -> Map(dot id -> place row) not written yet
  let canWriteProject = () => false
  let projectOf = () => null // a dot's project in the live catalogue, or null when it is not one
  let openNow = () => null // the page's open set when the view has none of its own (every project, by default)
  const openMarks = () => s.open ?? openNow() ?? new Set()
  let placesRead = 0
  let prefsAsked = 0

  const emit = (patch) => { s = { ...s, ...patch }; for (const fn of [...listeners]) fn() }

  // Each settings write is numbered: an answer is taken only while it is the newest, so a slow reply never puts
  // back an older colour over a newer one.
  async function writePrefs(patch) {
    if (!s.prefsAvailable) { emit({ prefs: { ...s.prefs, ...patch, appearance: { ...(s.prefs.appearance || {}), ...(patch.appearance || {}) } } }); return }
    const asked = ++prefsAsked
    try {
      const out = await adapter.setMothPrefs(patch)
      if (asked === prefsAsked) emit({ prefs: out || s.prefs })
    } catch (err) {
      if (absent(err)) { emit({ prefsAvailable: false }); return writePrefs(patch) }
      throw err
    }
  }

  async function loadPlaces(view) {
    const asked = ++placesRead
    if (!view || isQuick(view.key) || view.key === UNSAVED) {
      const kept = session.get(view?.key) || null
      emit({ places: kept?.places ?? null, placesKey: `${view?.key}:${asked}`, open: kept?.open ?? null, focusId: kept?.focusId ?? null, needsPlaces: false })
      return
    }
    try {
      const rows = await adapter.listMothPositions(view.row.id)
      if (asked !== placesRead) return
      const { places, open, focusId } = rowsToPlaces(rows)
      emit({ places, placesKey: `${view.row.id}:${asked}`, open: open.size ? open : null, focusId, needsPlaces: Object.keys(places).length === 0 && writable(view) })
    } catch {
      if (asked !== placesRead) return
      emit({ places: null, placesKey: `${view.row.id}:${asked}`, open: null, focusId: null, needsPlaces: false })
    }
  }

  const writable = (view) => {
    if (!view?.row || !s.available) return false
    return view.row.scope_kind === 'aggregate' || canWriteProject(view.row.project_id)
  }
  // What a view may keep a place for: a tag dot, or a dot of the live catalogue (of the view's project, for a
  // project's view).
  const keeps = (row, id) => {
    if (kindOf(id) === 'tag') return true
    const p = projectOf(id)
    if (!p) return false
    return row?.scope_kind === 'project' ? p === row.project_id : true
  }

  function viewFor(key) {
    if (isQuick(key)) return { key, config: QUICK_VIEWS[key].config, row: null }
    const row = s.views.find((v) => v.id === key)
    return row ? { key, config: normalizeConfig(row.config), row } : null
  }

  // Why an update matched no row: gone or hidden, someone else's newer save, or no longer this person's to change.
  async function whyNot(row) {
    try {
      const now = (await adapter.listMothViews()) || []
      const there = now.find((v) => v.id === row.id)
      if (!there) return 'This view is gone, or you can no longer see it.'
      if (there.revision !== row.revision) return 'Someone saved this view since you opened it. Open it again to see theirs.'
      return 'Only those who may change this project may save its views.'
    } catch {
      return 'This view could not be saved just now.'
    }
  }

  // The session's copy of a quick start's (or unsaved view's) arrangement, so it comes back within the visit.
  const keepInSession = (patch) => {
    if (s.current.row) return
    const was = session.get(s.current.key) || { places: {}, open: s.open, focusId: s.focusId }
    session.set(s.current.key, { ...was, ...patch, places: { ...(was.places || {}), ...(patch.places || {}) } })
  }
  const note = (id, p) => {
    if (!isPlace(p)) return
    const key = s.current.key
    if (!s.current.row) { keepInSession({ places: { [id]: { x: p.x, y: p.y, pinned: !!p.pinned } }, open: s.open, focusId: s.focusId }); return }
    if (!writable(s.current) || !keeps(s.current.row, id)) return
    if (!pending.has(key)) pending.set(key, new Map())
    pending.get(key).set(id, placeRow(id, p, { open: openMarks().has(id), focus: id === s.focusId }))
  }

  const api = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    getSnapshot: () => s,
    /** Who may write a project's shared view (the page's own gate, from the islands). */
    setGate(fn) { canWriteProject = typeof fn === 'function' ? fn : () => false },
    /** A dot's project in the live catalogue, or null for one that is not there (the page's catalogue). */
    setLookup({ projectOf: fn, openNow: open } = {}) {
      projectOf = typeof fn === 'function' ? fn : () => null
      openNow = typeof open === 'function' ? open : () => null
    },
    writable: () => writable(s.current),
    /** May this person save a view shared with a project's people (the page's gate, on a database with views)? */
    canWriteProject: (projectId) => !!projectId && s.available && canWriteProject(projectId),
    /** Settings, then the views, then the last view (or the first visit's question). Once per store. */
    start() {
      if (started) return started
      started = (async () => {
        // null: a database without moth_prefs (kept for this visit). A failed read is not a first visit: the
        // question is not asked again because the answer could not be read.
        let prefs = null
        let prefsFailed = false
        try { prefs = await adapter.getMothPrefs() } catch { prefsFailed = true }
        const prefsAvailable = prefsFailed || prefs !== null
        let views = []
        let available = true
        try { views = (await adapter.listMothViews()) || [] } catch (err) { available = !absent(err); views = [] }
        s = { ...s, prefs: prefs || {}, prefsAvailable, views, available }
        const last = prefs?.last_view
        const firstVisit = !prefsFailed && !prefs?.first_visit_done
        const current = (last && viewFor(last)) || viewFor('q:folders')
        emit({ ready: true, firstVisit, current, unsaved: false })
        await loadPlaces(current)
      })()
      return started
    },
    /** Pick a view from the widget. What was changed in the last one is written to it first. */
    async select(key) {
      const view = viewFor(key)
      if (!view) return
      await api.flush().catch(() => {})
      emit({ current: view, unsaved: false })
      await loadPlaces(view)
      if (!isQuick(key) || s.prefs.last_view !== key) writePrefs({ last_view: key }).catch(() => {})
    },
    /** The first visit's answer, or the new-view button's: a quick start, or a view built from scratch. */
    async chooseStart(key, config = null) {
      if (key === UNSAVED && config) {
        await api.flush().catch(() => {})
        emit({ current: { key: UNSAVED, config: normalizeConfig(config), row: null, from: null }, unsaved: true, firstVisit: false })
        session.delete(UNSAVED)
        await loadPlaces(s.current)
        writePrefs({ first_visit_done: true }).catch(() => {})
        return
      }
      emit({ firstVisit: false })
      await api.select(isQuick(key) ? key : 'q:folders')
      writePrefs({ first_visit_done: true, last_view: isQuick(key) ? key : 'q:folders' }).catch(() => {})
    },
    dismissFirstVisit() {
      emit({ firstVisit: false })
      writePrefs({ first_visit_done: true }).catch(() => {})
    },
    /** A change to what the view shows. A saved view becomes unsaved until saved; a quick start becomes a new one. */
    setConfig(patch) {
      const config = normalizeConfig({ ...s.current.config, ...patch })
      if (isQuick(s.current.key)) {
        const kept = session.get(s.current.key)
        if (kept) session.set(UNSAVED, kept)
        emit({ current: { key: UNSAVED, config, row: null, from: s.current.key }, unsaved: true })
        return
      }
      emit({ current: { ...s.current, config }, unsaved: true })
    },
    /** Save: the current saved view in place (its revision), or a new one ('aggregate' or a project's). */
    async save({ name = null, scope = 'aggregate', projectId = null, positions = {} } = {}) {
      if (!s.available) throw new Error('Saved views are not on this database yet: the view stays for this visit only.')
      const config = normalizeConfig(s.current.config)
      if (configHasId(config)) throw new Error('This view cannot be saved.')
      let row
      if (s.current.row && !name) {
        if (!writable(s.current)) throw new Error('Only those who may change this project may save its views.')
        row = await adapter.updateMothView(s.current.row.id, { config }, s.current.row.revision)
        if (!row) throw new Error(await whyNot(s.current.row))
      } else {
        const position = s.views.length ? Math.max(...s.views.map((v) => v.position || 0)) + 1 : 0
        row = await adapter.createMothView({ scopeKind: scope, projectId: scope === 'project' ? projectId : null, name: viewName(name), config, position })
      }
      const views = [...s.views.filter((v) => v.id !== row.id), row]
      const current = { key: row.id, config: normalizeConfig(row.config), row }
      emit({ views, current, unsaved: false })
      await api.savePlaces(positions)
      writePrefs({ last_view: row.id }).catch(() => {})
      return row
    },
    /** Rename a saved view this person may change; its config and revision stay. */
    async rename(id, name) {
      const row = s.views.find((v) => v.id === id)
      if (!row) return null
      if (!writable({ row })) throw new Error('Only those who may change this project may rename its views.')
      const out = await adapter.updateMothView(id, { name: viewName(name) }, row.revision)
      if (!out) throw new Error(await whyNot(row))
      emit({ views: s.views.map((v) => (v.id === id ? out : v)), current: s.current.key === id ? { ...s.current, row: out } : s.current })
      return out
    },
    /** Delete a saved view. Undo makes it again with its config and its places (a client may not choose its id). */
    async remove(id) {
      const row = s.views.find((v) => v.id === id)
      if (!row) return null
      if (!writable({ row })) throw new Error('Only those who may change this project may delete its views.')
      pending.delete(id)
      let kept = []
      try { kept = await adapter.listMothPositions(id) } catch { kept = [] }
      const out = await adapter.deleteMothView(id)
      if (!out?.removed) throw new Error('This view could not be deleted.')
      emit({ views: s.views.filter((v) => v.id !== id) })
      if (s.current.key === id) await api.select('q:folders')
      return async () => {
        const again = await adapter.createMothView({ scopeKind: row.scope_kind, projectId: row.project_id, name: row.name, config: row.config, position: row.position || 0 })
        const { places, open, focusId } = rowsToPlaces(kept)
        const rows = placesToRows(places, { open, focusId })
        if (rows.length) await adapter.putMothPositions(again.id, rows)
        emit({ views: [...s.views, again] })
        await api.select(again.id)
      }
    },
    /**
     * Back to the view as saved (or the quick start as it comes): what was changed here and not written is dropped,
     * and the saved places are read again. Nothing on the server is cleared: a shared view's layout is everyone's.
     */
    async reset() {
      const key = s.current.row ? s.current.row.id : isQuick(s.current.key) ? s.current.key : (s.current.from && isQuick(s.current.from) ? s.current.from : 'q:folders')
      pending.delete(s.current.key)
      session.delete(s.current.key)
      session.delete(key)
      const view = viewFor(key)
      emit({ current: view, unsaved: false })
      await loadPlaces(view)
    },
    toggleOpen(id, base = null) {
      const open = new Set(s.open ?? base ?? [])
      if (open.has(id)) open.delete(id); else open.add(id)
      emit({ open })
      api.noteOpened(id)
    },
    /** Open every one of `ids`, from `base` when the view has no open set of its own yet (its default). */
    openAll(ids, base = null) {
      const open = new Set(s.open ?? base ?? [])
      let changed = false
      for (const id of ids) if (!open.has(id)) { open.add(id); changed = true }
      if (changed || !s.open) emit({ open })
    },
    setFocus(id) { emit({ focusId: id || null }) },
    /** A dot this person moved, at its new place: kept for the view it was moved in, written by `flush`. */
    notePlace(id, p) { note(id, p) },
    /**
     * Dots whose marks changed (a folder opened or closed, the focus moved), at their places now: each is written
     * with what is open and in focus now, by `flush`.
     */
    noteMarks(places) {
      for (const [id, p] of Object.entries(places || {})) note(id, p)
      if (!s.current.row) keepInSession({ open: s.open, focusId: s.focusId })
    },
    /** Write what was noted, each to the view it was noted in. Errors come back in a person's words. */
    async flush() {
      const jobs = [...pending.entries()]
      pending.clear()
      let n = 0
      for (const [key, rows] of jobs) {
        const row = s.views.find((v) => v.id === key)
        if (!row || !writable({ row })) continue
        const list = [...rows.entries()].filter(([id]) => keeps(row, id)).map(([, r]) => r)
        if (!list.length) continue
        try { n += (await adapter.putMothPositions(key, list)) || 0 } catch (err) { throw placesError(err) }
        if (key === s.current.key) emit({ needsPlaces: false })
      }
      return n
    },
    /**
     * Every dot's place at once: a new saved view's, or a writable view's first layout (needsPlaces). A quick
     * start's go to the session.
     */
    async savePlaces(positions) {
      const open = openMarks()
      if (!s.current.row) { session.set(s.current.key, { places: positions, open, focusId: s.focusId }); return 0 }
      if (!writable(s.current)) return 0
      const row = s.current.row
      const kept = Object.fromEntries(Object.entries(positions || {}).filter(([id]) => keeps(row, id)))
      const rows = placesToRows(kept, { open, focusId: s.focusId })
      if (!rows.length) return 0
      let n
      try { n = await adapter.putMothPositions(row.id, rows) } catch (err) { throw placesError(err) }
      emit({ needsPlaces: false })
      return n
    },
    /** A folder (or a project) opened as a card or in the list: the eight newest, for the recent-folders icon. */
    noteOpened(id) {
      const k = kindOf(id)
      if (k !== 'folder' && k !== 'project') return
      const recent = [{ k, id: rowOf(id) }, ...(s.prefs.recent || []).filter((r) => !(r.k === k && r.id === rowOf(id)))].slice(0, RECENT_MAX)
      // Kept here at once, so a second opening before the first write answers builds on it.
      emit({ prefs: { ...s.prefs, recent } })
      writePrefs({ recent }).catch(() => {})
    },
    setAppearance(patch) {
      const appearance = normalizeAppearance({ ...(s.prefs.appearance || {}), ...patch })
      emit({ prefs: { ...s.prefs, appearance } })
      writePrefs({ appearance: patch }).catch(() => {})
    },
    now,
  }
  return api
}
