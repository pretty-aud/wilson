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

// Each kind's rows by id, with the project each is in: a row is taken out and put back by id, so a rewind over
// 20,000 recorded rows and a large project costs a lookup a row, not a search (MO2 review round 1).
function byId(bag) {
  const rows = new Map()
  for (const [pid, list] of Object.entries(bag || {})) for (const r of list || []) if (r && r.id != null) rows.set(r.id, { pid, row: { ...r } })
  return rows
}
function toBag(rows, pids) {
  const out = Object.fromEntries([...pids].map((pid) => [pid, []]))
  for (const { pid, row } of rows.values()) (out[pid] ||= []).push(row)
  return out
}
const ms = (t) => (typeof t === 'number' ? t : Date.parse(t))

/**
 * The catalogue as it was at `atMs`, from the live one and the record's rows (newest first, as moth_history_read
 * answers). Returns { catalogue, changed: Set of entity ids changed in the RECENT_DAYS before atMs }.
 */
export function rewind(live, rows, atMs) {
  const pids = new Set([...Object.keys(live.files || {}), ...Object.keys(live.folders || {}), ...Object.keys(live.items || {})])
  const files = byId(live.files)
  const folders = byId(live.folders)
  const items = byId(live.items)
  let islands = (live.islands || []).map((r) => ({ ...r }))
  let relations = [...(live.relations || [])]
  const changed = new Set()
  const recentFrom = atMs - RECENT_DAYS * 86400000
  for (const r of rows || []) {
    const t = ms(r.observed_at)
    if (!Number.isFinite(t)) continue
    if (t <= atMs) {
      if (t >= recentFrom) changed.add(r.entity_id)
      continue
    }
    const before = r.prior || null
    const pidBefore = r.prior_project_id || null
    const id = r.entity_id
    if (pidBefore) pids.add(pidBefore)
    if (r.entity_type === 'files') {
      const now = files.get(id)?.row || null
      const nowPid = files.get(id)?.pid
      files.delete(id)
      if (r.action === 'added' || r.action === 'restored') continue
      if (!before || !pidBefore) { if (now) files.set(id, { pid: nowPid, row: now }); continue }
      files.set(id, { pid: pidBefore, row: {
        ...(now || { id, tags: [] }), id, project_id: pidBefore, folder_id: before.folder_id ?? null,
        name: before.name ?? now?.name ?? '', mime_type: before.mime_type ?? now?.mime_type ?? null,
        kind: before.kind ?? now?.kind ?? null, tags: Array.isArray(before.categories) ? before.categories : now?.tags ?? [],
      } })
    } else if (r.entity_type === 'folders') {
      const now = folders.get(id)?.row || null
      const nowPid = folders.get(id)?.pid
      folders.delete(id)
      if (r.action === 'added' || r.action === 'restored') continue
      if (!before || !pidBefore) { if (now) folders.set(id, { pid: nowPid, row: now }); continue }
      folders.set(id, { pid: pidBefore, row: {
        ...(now || { id }), id, parent_id: before.parent_id ?? null, kind: before.kind ?? now?.kind ?? 'custom',
        slug: before.slug ?? now?.slug ?? '', label: before.name ?? now?.label ?? null,
      } })
    } else if (TABLE_KIND[r.entity_type]) {
      const kind = TABLE_KIND[r.entity_type]
      const now = items.get(id)?.row || null
      const nowPid = items.get(id)?.pid
      items.delete(id)
      if (r.action === 'added' || r.action === 'restored') continue
      if (!before || !pidBefore) { if (now) items.set(id, { pid: nowPid, row: now }); continue }
      // Under the parent it had then: a phase's parent phase, a shot's scene.
      const parent = kind === 'phase' ? { parent_kind: before.parent_phase_id ? 'phase' : null, parent_id: before.parent_phase_id ?? null }
        : kind === 'shot' ? { parent_kind: before.scene_id ? 'scene' : null, parent_id: before.scene_id ?? null } : {}
      items.set(id, { pid: pidBefore, row: { ...(now || { id, kind }), id, kind, name: before.name ?? before.title ?? now?.name ?? '', ...parent } })
    } else if (r.entity_type === 'projects') {
      const isle = islands.find((x) => x.id === id)
      if (r.action === 'added' || r.action === 'restored') { islands = islands.filter((x) => x.id !== id); continue }
      if ((r.action === 'trashed' || r.action === 'removed') && !isle) { islands.push({ id, title: before?.title ?? '' }); continue }
      if (isle && before?.title) isle.title = before.title
    } else if (r.entity_type === 'task_items') {
      const s = r.state
      const pr = before
      if (r.action === 'added' && s) {
        relations = relations.filter((l) => !(l.source.kind === 'task' && l.source.id === s.task_id && l.target.id === s.item_id))
      } else if ((r.action === 'removed' || r.action === 'trashed') && pr) {
        relations.push({ source: { kind: 'task', id: pr.task_id }, target: { kind: pr.item_type, id: pr.item_id }, label: 'task_item' })
      }
    }
  }
  const c = { islands, folders: toBag(folders, pids), files: toBag(files, pids), items: toBag(items, pids), relations }
  // A file shows at a time only if its folder does.
  for (const [pid, list] of Object.entries(c.files)) {
    const kept = new Set((c.folders[pid] || []).map((f) => f.id))
    c.files[pid] = list.filter((f) => f.folder_id == null || kept.has(f.folder_id))
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
