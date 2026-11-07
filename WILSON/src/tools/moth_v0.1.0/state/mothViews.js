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
// What a database before 0123 cannot keep, the store keeps for the session and says so: `available` is false.
import { QUICK_VIEWS, isQuick, normalizeConfig, configHasId } from './mothViewState.js'
import { normalizeAppearance } from './mothAppearance.js'

const absent = (err) => err?.code === 'moth_absent'
const kindOf = (id) => String(id).slice(0, String(id).indexOf(':'))
const rowOf = (id) => String(id).slice(String(id).indexOf(':') + 1)
export const RECENT_MAX = 8
export const UNSAVED = 'unsaved'

/** A view's places as rows for moth_put_positions: one per dot on show, open and focus marked. */
export function placesToRows(positions, { open = new Set(), focusId = null } = {}) {
  const rows = []
  for (const [id, p] of Object.entries(positions || {})) {
    const kind = kindOf(id)
    if (!kind || !Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue
    const row = kind === 'tag' ? { t: 'tag', tag: rowOf(id) } : { t: kind, id: rowOf(id) }
    rows.push({ ...row, x: p.x, y: p.y, pinned: !!p.pinned, open: open.has(id), focus: id === focusId })
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
  let canWriteProject = () => false
  let placesRead = 0

  const emit = (patch) => { s = { ...s, ...patch }; for (const fn of [...listeners]) fn() }

  async function writePrefs(patch) {
    if (!s.prefsAvailable) { emit({ prefs: { ...s.prefs, ...patch, appearance: { ...(s.prefs.appearance || {}), ...(patch.appearance || {}) } } }); return }
    try {
      const out = await adapter.setMothPrefs(patch)
      emit({ prefs: out || s.prefs })
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

  function viewFor(key) {
    if (isQuick(key)) return { key, config: QUICK_VIEWS[key].config, row: null }
    const row = s.views.find((v) => v.id === key)
    return row ? { key, config: normalizeConfig(row.config), row } : null
  }

  const api = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    getSnapshot: () => s,
    /** Who may write a project's shared view (the page's own gate, from the islands). */
    setGate(fn) { canWriteProject = typeof fn === 'function' ? fn : () => false },
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
    /** Pick a view from the widget. The last view is remembered for this person and company. */
    async select(key) {
      const view = viewFor(key)
      if (!view) return
      emit({ current: view, unsaved: false })
      await loadPlaces(view)
      if (!isQuick(key) || s.prefs.last_view !== key) writePrefs({ last_view: key }).catch(() => {})
    },
    /** The first visit's answer, or the new-view button's: a quick start, or a view built from scratch. */
    async chooseStart(key, config = null) {
      if (key === UNSAVED && config) {
        emit({ current: { key: UNSAVED, config: normalizeConfig(config), row: null }, unsaved: true, firstVisit: false })
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
        emit({ current: { key: UNSAVED, config, row: null }, unsaved: true })
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
        if (!row) throw new Error('Someone saved this view since you opened it. Open it again to see theirs.')
      } else {
        const position = s.views.length ? Math.max(...s.views.map((v) => v.position || 0)) + 1 : 0
        row = await adapter.createMothView({ scopeKind: scope, projectId: scope === 'project' ? projectId : null, name: (name || 'My view').trim().slice(0, 80), config, position })
      }
      const views = [...s.views.filter((v) => v.id !== row.id), row]
      const current = { key: row.id, config: normalizeConfig(row.config), row }
      emit({ views, current, unsaved: false })
      await api.savePlaces(positions)
      writePrefs({ last_view: row.id }).catch(() => {})
      return row
    },
    /** Delete a saved view. Undo makes it again with its config and its places (a client may not choose its id). */
    async remove(id) {
      const row = s.views.find((v) => v.id === id)
      if (!row) return null
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
    /** Back to the view as saved (or the quick start as it comes), its places cleared. */
    async reset() {
      const key = s.current.row ? s.current.row.id : isQuick(s.current.key) ? s.current.key : 'q:folders'
      session.delete(s.current.key)
      session.delete(key)
      if (s.current.row && writable(s.current)) await adapter.clearMothPositions(s.current.row.id)
      const view = viewFor(key)
      emit({ current: view, unsaved: false })
      await loadPlaces(view)
    },
    toggleOpen(id) {
      const open = new Set(s.open ?? [])
      if (open.has(id)) open.delete(id); else open.add(id)
      emit({ open })
      api.noteOpened(id)
    },
    openAll(ids) {
      const open = new Set(s.open ?? [])
      let changed = false
      for (const id of ids) if (!open.has(id)) { open.add(id); changed = true }
      if (changed) emit({ open })
    },
    setFocus(id) { emit({ focusId: id || null }) },
    /** Where the dots are, with what is open and the focus: the server for a saved view one may write, else the session. */
    async savePlaces(positions) {
      const open = s.open ?? new Set()
      const rows = placesToRows(positions, { open, focusId: s.focusId })
      session.set(s.current.key, { places: positions, open, focusId: s.focusId })
      if (!s.current.row || !writable(s.current) || !rows.length) return 0
      const n = await adapter.putMothPositions(s.current.row.id, rows)
      emit({ needsPlaces: false })
      return n
    },
    /** A folder (or a project) opened as a card or in the list: the eight newest, for the recent-folders icon. */
    noteOpened(id) {
      const k = kindOf(id)
      if (k !== 'folder' && k !== 'project') return
      const recent = [{ k, id: rowOf(id) }, ...(s.prefs.recent || []).filter((r) => !(r.k === k && r.id === rowOf(id)))].slice(0, RECENT_MAX)
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
