// ============================================================
// RABBIT — custom table views and groupings: the rules (VW1c, 2026-10-17)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §5 (corrected by VW1c's step 0 review,
// §11 round 4) and Audrey's answers (docs/design/CUSTOM_VIEWS_QUESTIONS.md):
// Q1 every view is shared with the project's team; Q2 anyone who can edit the
// project saves views; Q4 each person opens each table on the view they last
// used there; Q5c views in the order made, draggable; Q-D2 a grouping made
// with Create grouping is saved for the project; Q20 each table comes with
// the built-in *All* only, never stored.
//
// A VIEW is a row `{ id, project_id, table_key, name, position, revision,
// revised_by, config, created_at, created_by, updated_at, updated_by }` —
// table_key one of the six TABLE_KEYS. Its CONFIG is the client's JSON object
// (at most 32 KB): readViewConfig turns any stored value into a table's state
// and never throws; writeViewConfig keeps the keys this build does not know.
// Its REVISION is a number taken on insert and on every change of config —
// never on a rename or a reorder — from one counter that never repeats (the
// cloud's sequence, the desktop's counter in the project file), so a change
// for now saves only over the view it started from.
//
// A GROUPING is a row `{ id, project_id, table_key, kind, entity_ids,
// created_at, created_by }`: a set of 1 to 100 items of one kind, stored
// sorted and distinct, unique per (project, table_key, kind). It holds no
// rows; rows join it by having exactly its live items. An item deleted for
// good leaves every grouping that names it (planForgetItem); one in the trash
// stays named, and the grouping shows only while every item is live.
//
// THE LAST USED VIEW (Q4): a map `{ "<project id>:<table key>": { view, at } }`
// — `view` a view id or "all", `at` the writer's clock in epoch milliseconds —
// keeping a person's 300 newest tables (mergeTableViewLast).
//
// This file is the ONE statement of these rules, pure, importing nothing:
//   * the cloud runs them in SQL (migration 0098: its CHECKs, triggers, the
//     sweep, reorder_table_views, set_table_view_last), and this file mirrors
//     them so the screen changes before the echo;
//   * the Local Server runs the backends' half in electron/rabbitTableViews.cjs,
//     a CommonJS copy held to this one by tableViewsParity.test.js;
//   * the dev fixtures import this file (src/dev/devFixtures.test.js allows it).

export const TABLE_KEYS = Object.freeze(['tasks', 'assets', 'scenes', 'shots', 'levels', 'experiences'])

/** The kinds each table can be grouped by with a saved grouping (design §4.11). */
export const GROUPING_KINDS = Object.freeze({
  tasks: Object.freeze(['asset', 'scene', 'shot', 'level', 'experience']),
  assets: Object.freeze(['scene', 'shot', 'level', 'experience']),
  levels: Object.freeze(['asset']),
  experiences: Object.freeze(['asset']),
})

export const VIEW_NAME_MAX = 80
export const VIEW_CONFIG_MAX_BYTES = 32768
export const VIEW_CONFIG_VERSION = 1
export const VIEWS_PER_TABLE_MAX = 200
export const GROUPINGS_PER_TABLE_MAX = 500
export const GROUPING_IDS_MAX = 100
export const TABLE_VIEW_LAST_MAX = 300
export const ALL_VIEW_ID = 'all'
export const ALL_VIEW_NAME = 'All'

/** The layouts each table can remember (Q8): a Board on Tasks only. */
export const LAYOUTS_BY_TABLE = Object.freeze({
  tasks: Object.freeze(['table', 'board']),
  assets: Object.freeze(['table', 'gallery']),
  scenes: Object.freeze(['table', 'gallery']),
  shots: Object.freeze(['table', 'gallery']),
  levels: Object.freeze(['table', 'gallery']),
  experiences: Object.freeze(['table', 'gallery']),
})

/** Filter conditions that take no value (a row with one of them is complete). */
export const FILTER_VALUELESS_OPS = Object.freeze(['is_empty', 'is_not_empty'])

export function isTableKey(key) {
  return typeof key === 'string' && TABLE_KEYS.includes(key)
}

export function isGroupingPair(tableKey, kind) {
  return Object.prototype.hasOwnProperty.call(GROUPING_KINDS, tableKey)
    && GROUPING_KINDS[tableKey].includes(kind)
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

// ── Names ───────────────────────────────────────────────────────────────

/** A view's name as it is stored: trimmed (the cloud's CHECK refuses padding). */
export function normalizeViewName(name) {
  return typeof name === 'string' ? name.trim() : ''
}

/** Why a name cannot be stored, in words, or null. Read on the trimmed name. */
export function viewNameProblem(name) {
  if (typeof name !== 'string') return 'A view needs a name.'
  if (name !== name.trim()) return 'A view\'s name cannot start or end with a space.'
  if (name.length === 0) return 'A view needs a name.'
  if ([...name].length > VIEW_NAME_MAX) return `A view's name can be at most ${VIEW_NAME_MAX} characters.`
  if (CONTROL.test(name)) return 'A view\'s name cannot hold a line break or a tab.'
  return null
}

// ── Configs ─────────────────────────────────────────────────────────────

/** The size the cloud's CHECK measures: the JSON text in UTF-8 bytes. */
export function utf8Length(text) {
  let n = 0
  for (const ch of String(text)) {
    const c = ch.codePointAt(0)
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return n
}

/**
 * A value's JSON with every object's keys sorted, so two configs that differ
 * only in key order read alike — Postgres compares jsonb that way, and the
 * revision changes only when the config does (0098 §4b).
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (isPlainObject(value)) {
    return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}'
  }
  return value === undefined ? 'null' : JSON.stringify(value)
}

/** Do two configs hold the same settings (key order ignored)? */
export function configsEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b)
}

/** Why a config cannot be stored, in words, or null. */
export function viewConfigProblem(config) {
  if (!isPlainObject(config)) return 'A view\'s settings must be an object.'
  let text
  try { text = JSON.stringify(config) } catch { return 'A view\'s settings could not be read.' }
  if (utf8Length(text) > VIEW_CONFIG_MAX_BYTES) return 'A view\'s settings can be at most 32 KB.'
  return null
}

/**
 * The built-in *All* view's settings for a table (design §3, §5.1): nothing
 * filtered or sorted, every field at its default place, the grouping as today
 * (the Tasks table none and its Board by Status; Shots by Scene; the rest
 * none), Hide empty groups as today (Q-I: off where today shows empty groups —
 * the Tasks Status grouping and the Board; on elsewhere).
 */
export function defaultViewConfig(tableKey) {
  const config = {
    version: VIEW_CONFIG_VERSION,
    layout: 'table',
    filters: [],
    sorts: [],
    group: tableKey === 'shots' ? { field: 'scene', hideEmpty: true } : null,
    fields: [],
    leading: [],
  }
  if (tableKey === 'tasks') {
    config.board = { field: 'status', hideEmpty: false }
    config.keyDates = true
  }
  return config
}

const KNOWN_CONFIG_KEYS = Object.freeze(['version', 'layout', 'filters', 'sorts', 'group', 'board', 'fields', 'leading', 'keyDates'])

const isPrimitive = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
const isField = (v) => typeof v === 'string' && v.length > 0

/** Is a filter row complete (a field, a condition, and a value unless the condition takes none)? */
export function isCompleteFilter(row) {
  if (!isPlainObject(row) || !isField(row.field) || !isField(row.op)) return false
  if (FILTER_VALUELESS_OPS.includes(row.op)) return true
  return Array.isArray(row.values) && row.values.some(isPrimitive)
}

function readFilters(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const row of raw) {
    if (!isCompleteFilter(row)) continue
    const values = FILTER_VALUELESS_OPS.includes(row.op) ? [] : row.values.filter(isPrimitive)
    out.push({ field: row.field, op: row.op, values })
  }
  return out
}

function readSorts(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const row of raw) {
    if (!isPlainObject(row) || !isField(row.field) || seen.has(row.field)) continue
    seen.add(row.field)
    out.push({ field: row.field, dir: row.dir === 'desc' ? 'desc' : 'asc' })
  }
  return out
}

function readGroup(raw, fallback) {
  if (raw === null) return null
  if (!isPlainObject(raw) || !isField(raw.field)) return fallback
  return { field: raw.field, hideEmpty: typeof raw.hideEmpty === 'boolean' ? raw.hideEmpty : !!fallback?.hideEmpty }
}

function readFieldList(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const row of raw) {
    if (!isPlainObject(row) || !isField(row.key) || seen.has(row.key)) continue
    seen.add(row.key)
    out.push({ key: row.key, visible: row.visible !== false })
  }
  return out
}

/**
 * Any stored value → `{ config, newer, unreadable }`. Never throws (design
 * §5.1): a value that is not an object opens as *All* (`unreadable`); a key
 * this build does not know is ignored here and kept by writeViewConfig; a
 * malformed part falls back to *All*'s; `newer` is true when the config was
 * written by a newer WILSON (its version is above this build's), which greys
 * Save. A filter row that is not complete is dropped (never stored, Q21).
 */
export function readViewConfig(raw, tableKey) {
  const base = defaultViewConfig(tableKey)
  if (!isPlainObject(raw)) return { config: base, newer: false, unreadable: true }
  const version = typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : VIEW_CONFIG_VERSION
  const layouts = LAYOUTS_BY_TABLE[tableKey] || ['table']
  const config = {
    version: VIEW_CONFIG_VERSION,
    layout: layouts.includes(raw.layout) ? raw.layout : base.layout,
    filters: readFilters(raw.filters),
    sorts: readSorts(raw.sorts),
    group: Object.prototype.hasOwnProperty.call(raw, 'group') ? readGroup(raw.group, base.group) : base.group,
    fields: readFieldList(raw.fields),
    leading: readFieldList(raw.leading),
  }
  if (tableKey === 'tasks') {
    const board = readGroup(raw.board, base.board)
    config.board = board || base.board
    config.keyDates = typeof raw.keyDates === 'boolean' ? raw.keyDates : base.keyDates
  }
  return { config, newer: version > VIEW_CONFIG_VERSION, unreadable: false }
}

/**
 * The object to store for `config`, over what was stored: the keys this build
 * knows are written from `config` (incomplete filter rows dropped), every
 * other key of the stored object is kept as it was (design §5.1), and the
 * version is this build's.
 */
export function writeViewConfig(stored, config) {
  const out = isPlainObject(stored) ? { ...stored } : {}
  const next = isPlainObject(config) ? config : {}
  for (const key of KNOWN_CONFIG_KEYS) {
    if (key === 'version') continue
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue
    out[key] = key === 'filters' ? readFilters(next.filters) : next[key]
  }
  out.version = VIEW_CONFIG_VERSION
  return out
}

// ── Views ───────────────────────────────────────────────────────────────

/** The built-in *All* view of a table: never stored, always first (Q20). */
export function allViewOf(tableKey) {
  return Object.freeze({
    id: ALL_VIEW_ID,
    table_key: tableKey,
    name: ALL_VIEW_NAME,
    builtIn: true,
    position: -1,
    revision: 0,
    revised_by: null,
    config: defaultViewConfig(tableKey),
  })
}

// Milliseconds, with the database's microseconds as a fraction (a Postgres
// timestamp carries six digits; the desktop's ISO strings three).
function timeOf(v) {
  if (v == null || v === '') return 0
  const t = Date.parse(v)
  if (!Number.isFinite(t)) return 0
  const m = /\.(\d{4,})/.exec(String(v))
  return m ? t + Number('0.' + m[1].slice(3)) : t
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

/** The dropdown's order (Q5c): position, then created_at, then id. */
export function compareViews(a, b) {
  const p = num(a?.position) - num(b?.position)
  if (p !== 0) return p
  const t = timeOf(a?.created_at) - timeOf(b?.created_at)
  if (t !== 0) return t
  const ia = String(a?.id ?? ''), ib = String(b?.id ?? '')
  return ia < ib ? -1 : ia > ib ? 1 : 0
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** A bundle's views (every table): by table, then the dropdown's order — the loads' order. */
export function compareViewRows(a, b) {
  return byText(String(a?.table_key ?? ''), String(b?.table_key ?? '')) || compareViews(a, b)
}

/** A bundle's groupings: by table, kind, created_at (to the microsecond), id — the loads' order. */
export function compareGroupingRows(a, b) {
  return byText(String(a?.table_key ?? ''), String(b?.table_key ?? ''))
    || byText(String(a?.kind ?? ''), String(b?.kind ?? ''))
    || (timeOf(a?.created_at) - timeOf(b?.created_at))
    || byText(String(a?.id ?? ''), String(b?.id ?? ''))
}

/** A table's views, in the dropdown's order. */
export function viewsOfTable(views, tableKey) {
  return (Array.isArray(views) ? views : [])
    .filter(v => v && v.table_key === tableKey)
    .sort(compareViews)
}

/** Where a new view goes: after the table's last (Q5c, Q-G1). */
export function nextViewPosition(views, tableKey) {
  let max = -1
  for (const v of Array.isArray(views) ? views : []) {
    if (v && v.table_key === tableKey && num(v.position) > max) max = num(v.position)
  }
  return max + 1
}

/**
 * reorder_table_views' rule (0098 §8): the named views of the table first, in
 * the order given; every other view of the table after, in its current order;
 * positions dense from 0. An id not of this table is ignored. Returns the
 * changes `[{ id, position }]` for the views whose position moves. Refuses
 * (throws, code `table_view_invalid`) an unknown table, an empty id or an id
 * named twice — the cloud's 22023.
 */
export function planReorderViews(views, tableKey, orderedIds) {
  if (!isTableKey(tableKey)) throw invalid(`${tableKey} is not a table with views`)
  const ids = Array.isArray(orderedIds) ? orderedIds : []
  if (ids.some(id => id == null || id === '')) throw invalid('a view id is empty')
  const named = ids.map(String)
  if (new Set(named).size !== named.length) throw invalid('a view is named twice')
  const rank = new Map(named.map((id, i) => [id, i]))
  const rows = viewsOfTable(views, tableKey)
  const ordered = rows.slice().sort((a, b) => {
    const ra = rank.has(String(a.id)) ? rank.get(String(a.id)) : Infinity
    const rb = rank.has(String(b.id)) ? rank.get(String(b.id)) : Infinity
    if (ra !== rb) return ra - rb
    return compareViews(a, b)
  })
  const changes = []
  ordered.forEach((v, i) => {
    if (num(v.position) !== i) changes.push({ id: v.id, position: i })
  })
  return changes
}

function invalid(message) {
  const err = new Error(message)
  err.code = 'table_view_invalid'
  return err
}

// ── Groupings ───────────────────────────────────────────────────────────

/** A grouping's set as it is stored: the ids as strings, sorted, distinct. */
export function normalizeEntityIds(ids) {
  const out = [...new Set((Array.isArray(ids) ? ids : []).filter(id => id != null && id !== '').map(String))]
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** A set's key (the sorted ids joined with |), as the combination groups key theirs. */
export function groupingKeyOf(ids) {
  return normalizeEntityIds(ids).join('|')
}

/** Why a grouping cannot be stored, in words, or null (the cloud's CHECKs). */
export function groupingProblem(row) {
  if (!isPlainObject(row)) return 'A grouping must be an object.'
  if (!isGroupingPair(row.table_key, row.kind)) {
    return `The ${row.table_key} table cannot be grouped by ${row.kind}.`
  }
  const raw = Array.isArray(row.entity_ids) ? row.entity_ids : null
  if (!raw || raw.length === 0) return 'A grouping names at least one item.'
  if (raw.some(id => id == null || id === '' || typeof id !== 'string')) return 'A grouping\'s items must each be an id.'
  if (normalizeEntityIds(raw).length > GROUPING_IDS_MAX) return `A grouping can name at most ${GROUPING_IDS_MAX} items.`
  return null
}

/** The groupings of a table and kind, oldest first. */
export function groupingsOfTable(groupings, tableKey, kind) {
  return (Array.isArray(groupings) ? groupings : [])
    .filter(g => g && g.table_key === tableKey && g.kind === kind)
    .sort(compareGroupingRows)
}

/** The stored grouping with exactly this set, or null. */
export function findGroupingBySet(groupings, tableKey, kind, ids) {
  const key = groupingKeyOf(ids)
  return (Array.isArray(groupings) ? groupings : [])
    .find(g => g && g.table_key === tableKey && g.kind === kind && groupingKeyOf(g.entity_ids) === key) || null
}

/** Is every item a grouping names live (Q-N4: a grouping hides while one is in the trash)? */
export function isGroupingLive(grouping, isLive) {
  const ids = Array.isArray(grouping?.entity_ids) ? grouping.entity_ids : []
  return ids.length > 0 && ids.every(id => isLive(grouping.kind, String(id)))
}

/**
 * The sweep (0098 §5): an item deleted for good leaves every grouping of its
 * kind that names it. Returns `{ remove: [grouping ids], update: [{ id,
 * entity_ids }] }`: a grouping left empty, or left naming the set of another
 * grouping of the same table and kind (one that did not name the item), is
 * removed; the rest shrink. Processed in id order, as the cloud's loop.
 */
export function planForgetItem(groupings, kind, entityId) {
  const id = String(entityId)
  const rows = (Array.isArray(groupings) ? groupings : []).filter(g => g && g.kind === kind)
  const holding = rows.filter(g => normalizeEntityIds(g.entity_ids).includes(id))
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))
  const remove = []
  const update = []
  for (const g of holding) {
    const rest = normalizeEntityIds(g.entity_ids).filter(x => x !== id)
    const key = rest.join('|')
    const collides = rest.length > 0 && rows.some(o => o !== g && o.table_key === g.table_key
      && !normalizeEntityIds(o.entity_ids).includes(id) && groupingKeyOf(o.entity_ids) === key)
    if (rest.length === 0 || collides) remove.push(g.id)
    else update.push({ id: g.id, entity_ids: rest })
  }
  return { remove, update }
}

// ── The last used view (Q4) ─────────────────────────────────────────────

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The map's key for a project's table. */
export function tableViewLastKey(projectId, tableKey) {
  return `${projectId}:${tableKey}`
}

/** Why a key cannot be stored, in words, or null. */
export function tableViewLastKeyProblem(key) {
  if (typeof key !== 'string') return 'not a key'
  const at = key.lastIndexOf(':')
  if (at <= 0) return `${key} is not a project id and a table`
  const project = key.slice(0, at), table = key.slice(at + 1)
  if (!SAFE_ID.test(project) || !isTableKey(table)) return `${key} is not a project id and a table`
  return null
}

/** A view id or "all" (the built-in view). */
export function isViewIdOrAll(view) {
  return view === ALL_VIEW_ID || (typeof view === 'string' && SAFE_ID.test(view))
}

const atOf = (entry) => (isPlainObject(entry) && typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : null)

/**
 * set_table_view_last's merge (0098 §9): the map with `key` set to `{ view,
 * at }`, keeping the TABLE_VIEW_LAST_MAX newest by `at` (an entry without a
 * number `at` counts as the oldest), ties by key A to Z. Pure.
 */
export function mergeTableViewLast(map, key, view, at) {
  const merged = { ...(isPlainObject(map) ? map : {}), [key]: { view, at } }
  const entries = Object.entries(merged)
  if (entries.length <= TABLE_VIEW_LAST_MAX) return merged
  entries.sort(([ka, va], [kb, vb]) => {
    const a = atOf(va), b = atOf(vb)
    if (a !== b) {
      if (a === null) return 1
      if (b === null) return -1
      return b - a
    }
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
  return Object.fromEntries(entries.slice(0, TABLE_VIEW_LAST_MAX))
}

/** The view a person last used on a project's table: an id, "all", or null (never chosen). */
export function readTableViewLast(map, projectId, tableKey) {
  const entry = isPlainObject(map) ? map[tableViewLastKey(projectId, tableKey)] : null
  return isPlainObject(entry) && isViewIdOrAll(entry.view) ? entry.view : null
}
