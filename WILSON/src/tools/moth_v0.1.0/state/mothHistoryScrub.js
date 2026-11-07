// mothHistoryScrub.js — MO2: the time slider (the brief §3.1; her Q2: "Show graph structure and metadata from
// Moth's first recorded baseline onward, retain 90 days, and label periods with no recorded history; file bodies are
// not historical copies"). MOTH_DESIGN §2.5 H3 and its rebuild rule: start from the live, authorised graph and undo
// the record's rows newest first, back to the chosen time. 'added' means absent before; 'removed' and 'trashed'
// mean present before, as the prior side says; 'moved' and 'changed' mean as the prior side says. A row about an
// id the live graph does not know, with nothing to put back, is ignored. A file shows at a time only if its folder
// does. Everything before a kind's recording_since is not recorded. The scrub reads only; nothing is written.
export const HISTORY_DAYS = 90
export const RECENT_DAYS = 7
const TABLE_KIND = Object.freeze({
  phases: 'phase', assets: 'asset', tasks: 'task', scenes: 'scene', shots: 'shot', levels: 'level', experiences: 'experience',
})

const clone = (c) => ({
  islands: (c.islands || []).map((r) => ({ ...r })),
  folders: Object.fromEntries(Object.entries(c.folders || {}).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
  files: Object.fromEntries(Object.entries(c.files || {}).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
  items: Object.fromEntries(Object.entries(c.items || {}).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
  relations: [...(c.relations || [])],
})
const take = (list, id) => { const i = list.findIndex((r) => r.id === id); return i < 0 ? null : list.splice(i, 1)[0] }
const ms = (t) => (typeof t === 'number' ? t : Date.parse(t))

/**
 * The catalogue as it was at `atMs`, from the live one and the record's rows (newest first, as moth_history_read
 * answers). Returns { catalogue, changed: Set of entity ids changed in the RECENT_DAYS before atMs }.
 */
export function rewind(live, rows, atMs) {
  const c = clone(live)
  const changed = new Set()
  const recentFrom = atMs - RECENT_DAYS * 86400000
  const where = (bag, pid) => { if (!bag[pid]) bag[pid] = []; return bag[pid] }
  for (const r of rows || []) {
    const t = ms(r.observed_at)
    if (!Number.isFinite(t)) continue
    if (t <= atMs) {
      if (t >= recentFrom) changed.add(r.entity_id)
      continue
    }
    const before = r.prior || null
    const pidBefore = r.prior_project_id || null
    const pidNow = r.state_project_id || null
    const id = r.entity_id
    if (r.entity_type === 'files') {
      const now = pidNow ? take(where(c.files, pidNow), id) : Object.values(c.files).map((l) => take(l, id)).find(Boolean) || null
      if (r.action === 'added' || r.action === 'restored') continue
      if (!before || !pidBefore) continue
      where(c.files, pidBefore).push({
        ...(now || { id, tags: [] }), id, project_id: pidBefore, folder_id: before.folder_id ?? null,
        name: before.name ?? now?.name ?? '', mime_type: before.mime_type ?? now?.mime_type ?? null,
        kind: before.kind ?? now?.kind ?? null, tags: Array.isArray(before.categories) ? before.categories : now?.tags ?? [],
      })
    } else if (r.entity_type === 'folders') {
      const now = pidNow ? take(where(c.folders, pidNow), id) : Object.values(c.folders).map((l) => take(l, id)).find(Boolean) || null
      if (r.action === 'added' || r.action === 'restored') continue
      if (!before || !pidBefore) continue
      where(c.folders, pidBefore).push({
        ...(now || { id }), id, parent_id: before.parent_id ?? null, kind: before.kind ?? now?.kind ?? 'custom',
        slug: before.slug ?? now?.slug ?? '', label: before.name ?? now?.label ?? null,
      })
    } else if (TABLE_KIND[r.entity_type]) {
      const kind = TABLE_KIND[r.entity_type]
      const now = pidNow ? take(where(c.items, pidNow), id) : Object.values(c.items).map((l) => take(l, id)).find(Boolean) || null
      if (r.action === 'added' || r.action === 'restored') continue
      if (!before || !pidBefore) continue
      where(c.items, pidBefore).push({ ...(now || { id, kind }), id, kind, name: before.name ?? before.title ?? now?.name ?? '' })
    } else if (r.entity_type === 'projects') {
      const isle = c.islands.find((x) => x.id === id)
      if (r.action === 'added') { c.islands = c.islands.filter((x) => x.id !== id); continue }
      if (isle && before?.title) isle.title = before.title
    } else if (r.entity_type === 'task_items') {
      const s = r.state
      const p = before
      if (r.action === 'added' && s) {
        c.relations = c.relations.filter((l) => !(l.source.kind === 'task' && l.source.id === s.task_id && l.target.id === s.item_id))
      } else if ((r.action === 'removed' || r.action === 'trashed') && p) {
        c.relations.push({ source: { kind: 'task', id: p.task_id }, target: { kind: p.item_type, id: p.item_id }, label: 'task_item' })
      }
    }
  }
  // A file shows at a time only if its folder does.
  for (const [pid, list] of Object.entries(c.files)) {
    const folders = new Set((c.folders[pid] || []).map((f) => f.id))
    c.files[pid] = list.filter((f) => f.folder_id == null || folders.has(f.folder_id))
  }
  return { catalogue: c, changed }
}

/** From when the record holds this scope: the latest recording_since among the kinds (the honest floor). */
export function recordedSince(windowRows, nowMs = Date.now()) {
  let floor = nowMs - HISTORY_DAYS * 86400000
  for (const w of windowRows || []) {
    const t = ms(w.recording_since)
    if (Number.isFinite(t) && t > floor) floor = t
  }
  return Math.min(floor, nowMs)
}

/** Every row of the record from `sinceMs` to now, following the opaque row_key, at most `maxPages` pages. */
export async function readHistory(adapter, sinceMs, { maxPages = 20, limit = 1000 } = {}) {
  const out = []
  let after = null
  for (let page = 0; page < maxPages; page++) {
    const rows = (await adapter.fetchMothHistory({ since: new Date(sinceMs).toISOString(), after, limit })) || []
    out.push(...rows)
    if (rows.length < limit) return { rows: out, complete: true }
    after = rows[rows.length - 1]?.row_key ?? null
    if (!after) return { rows: out, complete: true }
  }
  return { rows: out, complete: false }
}
