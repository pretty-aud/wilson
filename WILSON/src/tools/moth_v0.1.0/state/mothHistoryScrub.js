// mothHistoryScrub.js — MO2: the time slider (the brief §3.1; her Q2: "Show graph structure and metadata from
// Moth's first recorded baseline onward, retain 90 days, and label periods with no recorded history; file bodies are
// not historical copies"). MOTH_DESIGN §2.5 H3 and its rebuild rule: start from the live, authorised graph and undo
// the record's rows newest first, back to the chosen time. 'added' means absent before; 'removed' and 'trashed'
// mean present before, as the prior side says; 'moved' and 'changed' mean as the prior side says. A row about an
// id the live graph does not know, with nothing to put back, is ignored. A prior side that says it was in the trash
// (0124, MO2-18) was not on the graph then, whatever the row's action: a file emptied from the trash while in it
// does not come back for that time. A file shows at a time only if its folder
// does. Everything before a kind's recording_since is not recorded. The scrub reads only; nothing is written.
//
// MO3 (0129): workspace notes, typed tags, their assignments and saved links are rewound the same way, by id. Their
// record begins with 0129, so they do not set the floor (S3_KINDS); they keep their own, per kind and per kind and
// project (s3Floors: a kind's start, a restart in a project), and no row of theirs below its floor is undone: before
// it they show as they were then, and the slider says so (s3RecordedSince). A change or a move about one not on the
// graph is ignored.
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
/** 0129's four kinds: recorded from that migration on, so not the scrub's floor. */
export const S3_KINDS = Object.freeze(['notes', 'moth_tags', 'moth_tag_assignments', 'moth_relationships'])
const listById = (list) => new Map((list || []).filter((r) => r && r.id != null).map((r) => [r.id, { ...r }]))

/**
 * The catalogue as it was at `atMs`, from the live one and the record's rows (newest first, as moth_history_read
 * answers). Returns { catalogue, changed: Set of entity ids changed in the RECENT_DAYS before atMs }.
 */
export function rewind(live, rows, atMs, { s3Floors: floors = null } = {}) {
  const pids = new Set([...Object.keys(live.files || {}), ...Object.keys(live.folders || {}), ...Object.keys(live.items || {})])
  const files = byId(live.files)
  const folders = byId(live.folders)
  const items = byId(live.items)
  let islands = (live.islands || []).map((r) => ({ ...r }))
  let relations = [...(live.relations || [])]
  const notes = listById(live.notes)
  const mtags = listById(live.mtags)
  const assignments = listById(live.assignments)
  const looks = new Map((live.mtags || []).map((t) => [t.type_id, { shape: t.shape, colour: t.colour, type_name: t.type_name }]))
  for (const ty of live.mtagTypes || []) if (ty?.id) looks.set(ty.id, { shape: ty.shape ?? 'circle', colour: ty.colour ?? 'mist', type_name: ty.name ?? '' })
  const changed = new Set()
  const recentFrom = atMs - RECENT_DAYS * 86400000
  for (const r of rows || []) {
    const t = ms(r.observed_at)
    if (!Number.isFinite(t)) continue
    if (t <= atMs) {
      if (t >= recentFrom) changed.add(r.entity_id)
      continue
    }
    // Session 3's record is whole only from its own floor: an older row of theirs is not undone.
    if (floors && S3_KINDS.includes(r.entity_type) && t < s3FloorOf(floors, r)) continue
    const before = r.prior || null
    const pidBefore = r.prior_project_id || null
    const id = r.entity_id
    if (pidBefore) pids.add(pidBefore)
    if (r.entity_type === 'files') {
      const now = files.get(id)?.row || null
      const nowPid = files.get(id)?.pid
      files.delete(id)
      if (r.action === 'added' || r.action === 'restored' || before?.in_trash === true) continue
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
      if (r.action === 'added' || r.action === 'restored' || before?.in_trash === true) continue
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
      if (r.action === 'added' || r.action === 'restored' || before?.in_trash === true) continue
      if (!before || !pidBefore) { if (now) items.set(id, { pid: nowPid, row: now }); continue }
      // Under the parent it had then: a phase's parent phase, a shot's scene.
      const parent = kind === 'phase' ? { parent_kind: before.parent_phase_id ? 'phase' : null, parent_id: before.parent_phase_id ?? null }
        : kind === 'shot' ? { parent_kind: before.scene_id ? 'scene' : null, parent_id: before.scene_id ?? null } : {}
      items.set(id, { pid: pidBefore, row: { ...(now || { id, kind }), id, kind, name: before.name ?? before.title ?? now?.name ?? '', ...parent } })
    } else if (r.entity_type === 'projects') {
      const isle = islands.find((x) => x.id === id)
      if (r.action === 'added' || r.action === 'restored') { islands = islands.filter((x) => x.id !== id); continue }
      if ((r.action === 'trashed' || r.action === 'removed') && !isle && before?.in_trash !== true) { islands.push({ id, title: before?.title ?? '' }); continue }
      if (isle && before?.title) isle.title = before.title
    } else if (r.entity_type === 'notes') {
      const now = notes.get(id) || null
      if (!now && (r.action === 'changed' || r.action === 'moved')) continue
      notes.delete(id)
      if (r.action === 'added' || r.action === 'restored' || before?.in_trash === true) continue
      if (!before) { if (now) notes.set(id, now); continue }
      notes.set(id, { ...(now || { id, is_mine: false }), id, title: before.title ?? now?.title ?? '', tier: before.tier ?? now?.tier ?? null })
    } else if (r.entity_type === 'moth_tags') {
      const now = mtags.get(id) || null
      if (!now && (r.action === 'changed' || r.action === 'moved')) continue
      mtags.delete(id)
      if (r.action === 'added') continue
      if (!before) { if (now) mtags.set(id, now); continue }
      // Its type's look as its type was then: a type no longer known is drawn plain, never with today's type's look.
      const typeThen = before.type_id ?? now?.type_id ?? null
      const look = looks.get(typeThen) || (typeThen !== (now?.type_id ?? null) ? { shape: 'circle', colour: 'mist', type_name: '' } : {})
      mtags.set(id, { shape: 'circle', colour: 'mist', ...(now || {}), ...look, id, label: before.label ?? now?.label ?? '',
        type_id: before.type_id ?? now?.type_id ?? null, tier: before.tier ?? now?.tier ?? null, canonical_id: before.canonical_id ?? null,
        retired_at: before.retired === true ? (now?.retired_at || 'retired') : null })
    } else if (r.entity_type === 'moth_tag_assignments') {
      const now = assignments.get(id) || null
      if (!now && (r.action === 'changed' || r.action === 'moved')) continue
      assignments.delete(id)
      if (r.action === 'added') continue
      if (!before) { if (now) assignments.set(id, now); continue }
      assignments.set(id, { ...(now || {}), id, tag_id: before.tag_id ?? now?.tag_id, target_type: before.target_type ?? now?.target_type,
        target_id: before.target_id ?? now?.target_id, tier: before.tier ?? now?.tier })
    } else if (r.entity_type === 'moth_relationships') {
      const was = relations.find((l) => l.relationship === id) || null
      if (!was && (r.action === 'changed' || r.action === 'moved')) continue
      relations = relations.filter((l) => l.relationship !== id)
      if (r.action === 'added') continue
      if (!before) { if (was) relations.push(was); continue }
      relations.push({ source: { kind: before.source_type, id: before.source_id }, target: { kind: before.dest_type, id: before.dest_id },
        label: before.label ?? null, relationship: id, origin: before.origin ?? null })
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
  const c = { islands, folders: toBag(folders, pids), files: toBag(files, pids), items: toBag(items, pids), relations,
    notes: [...notes.values()], mtags: [...mtags.values()], assignments: [...assignments.values()] }
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
    if (S3_KINDS.includes(w.entity_type)) continue
    const t = ms(w.recording_since)
    if (Number.isFinite(t) && t > floor) floor = t
  }
  return Math.min(floor, nowMs)
}

/**
 * MO3 (0129): when the record holds each of notes, typed tags, their assignments and links: per kind (its start, or a
 * restart with no project) and per kind and project (a restart there). `none`: the window names none of the four (a
 * database before 0129), and none of their rows exists to undo.
 */
export function s3Floors(windowRows) {
  const base = {}
  const byProject = {}
  let named = false
  for (const w of windowRows || []) {
    if (!S3_KINDS.includes(w.entity_type)) continue
    named = true
    const t = ms(w.recording_since)
    if (!Number.isFinite(t)) continue
    if (w.project_id == null) base[w.entity_type] = Math.max(base[w.entity_type] ?? -Infinity, t)
    else {
      const m = (byProject[w.entity_type] ||= {})
      m[w.project_id] = Math.max(m[w.project_id] ?? -Infinity, t)
    }
  }
  return { base, byProject, none: !named }
}

// The floor a Session 3 row is undone above: its kind's start, or a restart in a project the row names, the later.
function s3FloorOf(floors, r) {
  if (floors.none) return Infinity
  let f = floors.base[r.entity_type] ?? -Infinity
  const m = floors.byProject[r.entity_type]
  if (m) for (const p of [r.prior_project_id, r.state_project_id]) if (p && m[p] > f) f = m[p]
  return f
}

/** For the slider's words: from when all four are recorded (the latest kind's start); Infinity before 0129. */
export function s3RecordedSince(windowRows, nowMs = Date.now()) {
  const f = s3Floors(windowRows)
  if (f.none) return Infinity
  const starts = Object.values(f.base)
  return starts.length ? Math.min(Math.max(...starts), nowMs) : null
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
