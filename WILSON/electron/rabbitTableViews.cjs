// ============================================================
// RABBIT — custom table views and groupings, local-server half (VW1c, 2026-10-17)
// ============================================================
//
// The Local Server's twin of migration 0098 (supabase/migrations/
// 0098_table_views.sql; docs/design/CUSTOM_VIEWS_DESIGN.md §5.4):
//
//   bundle.tableViews         a project's saved views of its six tables, one
//                             row each `{ id, project_id, table_key, name,
//                             position, revision, revised_by, config,
//                             created_at, created_by, updated_at, updated_by }`;
//   bundle.itemGroupings      its saved groupings `{ id, project_id,
//                             table_key, kind, entity_ids, created_at,
//                             created_by, updated_at, updated_by }`;
//   bundle.tableViewRevision  the counter a view's revision is taken from (the
//                             cloud's table_views_revision_seq): a new view,
//                             and every change of a view's config, takes the
//                             next number. It only grows, so no view ever has
//                             a number another view had, even one deleted and
//                             made again with its id (an undo). Absent (a
//                             bundle with no view yet), it starts from the
//                             largest revision stored.
//
// No roles here: created_by, updated_by and revised_by are null, and anyone
// using the desktop saves views and makes groupings (§5.4). No live channel:
// a teammate's save on a shared project shows the next time it loads.
//
// The RULES are src/tools/rabbit_v0.1.0/state/tableViewsModel.js's backend
// half, copied here in CommonJS (a synchronous route cannot import an ES
// module); tableViewsParity.test.js runs the same cases through both and fails
// when they part. The screens-only rules (readViewConfig, writeViewConfig,
// defaultViewConfig, allViewOf, …) stay in the model.
//
// Mounted from main.cjs beside the task items, with the same injected helpers.
// The sweep (0098 §5, fn_item_groupings_forget) runs after the generic DELETE
// of a scene, shot, level or experience (withItemGroupingSweep wraps the item
// hooks main.cjs hands those routes), in the asset DELETE route, and on every
// read (reconcileTableViewsOnRead, from readRabbitBundle).
//
// THE LAST USED VIEW (her Q4) is per computer on the desktop (§5.4, finding
// 8): `<data folder>/rabbit-machine-settings.json`, `{ tableViewLast }`, one
// key merged per write with this machine's clock, the 300 newest kept.
//
// 🚨 EVERY HANDLER IS SYNCHRONOUS — read, validate, mutate, write, with no
// `await` in between (the bundle file has no lock; rabbitShotLists.cjs). So
// two windows' last-used writes never lose each other's key either.
// 🚨 Every bundle write is writeRabbitBundle(…, { touch: false }): a saved
// view is not a change to the project (it must not move to the top of the
// Projects list), and the _DATABASES mirrors carry no views (finding 16).
// 🚨 Every refusal is a JSON body `{ error, code }` with its HTTP status; a
// stale conditional write's 409 also carries the stored `row`.

'use strict';

const path = require('node:path');

// ── The rules (tableViewsModel.js's backend half, in the same words) ────

const TABLE_KEYS = Object.freeze(['tasks', 'assets', 'scenes', 'shots', 'levels', 'experiences']);

/** The kinds each table can be grouped by with a saved grouping (design §4.11). */
const GROUPING_KINDS = Object.freeze({
  tasks: Object.freeze(['asset', 'scene', 'shot', 'level', 'experience']),
  assets: Object.freeze(['scene', 'shot', 'level', 'experience']),
  levels: Object.freeze(['asset']),
  experiences: Object.freeze(['asset']),
});

const VIEW_NAME_MAX = 80;
const VIEW_CONFIG_MAX_BYTES = 32768;
const VIEWS_PER_TABLE_MAX = 200;
const GROUPINGS_PER_TABLE_MAX = 500;
const GROUPING_IDS_MAX = 100;
const TABLE_VIEW_LAST_MAX = 300;
const ALL_VIEW_ID = 'all';

function isTableKey(key) {
  return typeof key === 'string' && TABLE_KEYS.includes(key);
}

function isGroupingPair(tableKey, kind) {
  return Object.prototype.hasOwnProperty.call(GROUPING_KINDS, tableKey)
    && GROUPING_KINDS[tableKey].includes(kind);
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

// Names

/** A view's name as it is stored: trimmed (the cloud's CHECK refuses padding). */
function normalizeViewName(name) {
  return typeof name === 'string' ? name.trim() : '';
}

/** Why a name cannot be stored, in words, or null. Read on the trimmed name. */
function viewNameProblem(name) {
  if (typeof name !== 'string') return 'A view needs a name.';
  if (name !== name.trim()) return 'A view\'s name cannot start or end with a space.';
  if (name.length === 0) return 'A view needs a name.';
  if ([...name].length > VIEW_NAME_MAX) return `A view's name can be at most ${VIEW_NAME_MAX} characters.`;
  if (CONTROL.test(name)) return 'A view\'s name cannot hold a line break or a tab.';
  return null;
}

// Configs

/** The size the cloud's CHECK measures: the JSON text in UTF-8 bytes. */
function utf8Length(text) {
  let n = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * A value's JSON with every object's keys sorted, so two configs that differ
 * only in key order read alike — Postgres compares jsonb that way, and the
 * revision changes only when the config does (0098 §4b).
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (isPlainObject(value)) {
    return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return value === undefined ? 'null' : JSON.stringify(value);
}

/** Do two configs hold the same settings (key order ignored)? */
function configsEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

// Code point order, which is UTF-8 byte order (Postgres' memcmp on text).
function compareCodePoints(a, b) {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/**
 * A value as Postgres prints it as jsonb text (`config::text`, what 0098's
 * CHECK measures): ": " after a key and ", " between members, an object's
 * keys by their length in bytes, then byte by byte. The model's jsonbText,
 * word for word (review round 1, R1-5: measured as JSON.stringify, a config
 * between about 31.5 and 32 KB passed here and was refused by the cloud).
 */
function jsonbText(value, seen = new Set()) {
  if (value !== null && typeof value === 'object' && typeof value.toJSON === 'function') value = value.toJSON();
  if (value === null || value === undefined || typeof value === 'function' || typeof value === 'symbol') return 'null';
  if (typeof value === 'bigint') return JSON.stringify(value); // throws, as JSON.stringify does
  if (typeof value !== 'object') return typeof value === 'number' && !Number.isFinite(value) ? 'null' : JSON.stringify(value);
  if (seen.has(value)) throw new TypeError('Converting circular structure to JSON');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const parts = [];
      for (let i = 0; i < value.length; i++) parts.push(jsonbText(value[i], seen));
      return '[' + parts.join(', ') + ']';
    }
    const keys = Object.keys(value)
      .filter(k => value[k] !== undefined && typeof value[k] !== 'function' && typeof value[k] !== 'symbol')
      .sort((a, b) => (utf8Length(a) - utf8Length(b)) || compareCodePoints(a, b));
    return '{' + keys.map(k => JSON.stringify(k) + ': ' + jsonbText(value[k], seen)).join(', ') + '}';
  } finally {
    seen.delete(value);
  }
}

/** Why a config cannot be stored, in words, or null (measured as the cloud's CHECK measures it). */
function viewConfigProblem(config) {
  if (!isPlainObject(config)) return 'A view\'s settings must be an object.';
  let text;
  try { text = jsonbText(config); } catch { return 'A view\'s settings could not be read.'; }
  if (utf8Length(text) > VIEW_CONFIG_MAX_BYTES) return 'A view\'s settings can be at most 32 KB.';
  return null;
}

// Views

// Milliseconds, with the database's microseconds as a fraction (a Postgres
// timestamp carries six digits; the desktop's ISO strings three).
function timeOf(v) {
  if (v == null || v === '') return 0;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return 0;
  const m = /\.(\d{4,})/.exec(String(v));
  return m ? t + Number('0.' + m[1].slice(3)) : t;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** The dropdown's order (Q5c): position, then created_at, then id. */
function compareViews(a, b) {
  const p = num(a?.position) - num(b?.position);
  if (p !== 0) return p;
  const t = timeOf(a?.created_at) - timeOf(b?.created_at);
  if (t !== 0) return t;
  const ia = String(a?.id ?? ''), ib = String(b?.id ?? '');
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A bundle's views (every table): by table, then the dropdown's order — the loads' order. */
function compareViewRows(a, b) {
  return byText(String(a?.table_key ?? ''), String(b?.table_key ?? '')) || compareViews(a, b);
}

/** A bundle's groupings: by table, kind, created_at (to the microsecond), id — the loads' order. */
function compareGroupingRows(a, b) {
  return byText(String(a?.table_key ?? ''), String(b?.table_key ?? ''))
    || byText(String(a?.kind ?? ''), String(b?.kind ?? ''))
    || (timeOf(a?.created_at) - timeOf(b?.created_at))
    || byText(String(a?.id ?? ''), String(b?.id ?? ''));
}

/** A table's views, in the dropdown's order. */
function viewsOfTable(views, tableKey) {
  return (Array.isArray(views) ? views : [])
    .filter(v => v && v.table_key === tableKey)
    .sort(compareViews);
}

/** Where a new view goes: after the table's last (Q5c, Q-G1). */
/** The largest position the cloud's INTEGER column holds. */
const MAX_VIEW_POSITION = 2147483647;

// At most MAX_VIEW_POSITION (review round 1, R1-6): a stored position at the
// ceiling never makes every later insert overflow; a tie falls to created_at.
function nextViewPosition(views, tableKey) {
  let max = -1;
  for (const v of Array.isArray(views) ? views : []) {
    if (v && v.table_key === tableKey && num(v.position) > max) max = num(v.position);
  }
  return Math.min(max + 1, MAX_VIEW_POSITION);
}

/**
 * reorder_table_views' rule (0098 §8): the named views of the table first, in
 * the order given; every other view of the table after, in its current order;
 * positions dense from 0. An id not of this table is ignored. Returns the
 * changes `[{ id, position }]` for the views whose position moves. Refuses
 * (throws, code `table_view_invalid`) an unknown table, an empty id or an id
 * named twice — the cloud's 22023.
 */
function planReorderViews(views, tableKey, orderedIds) {
  if (!isTableKey(tableKey)) throw invalid(`${tableKey} is not a table with views`);
  const ids = Array.isArray(orderedIds) ? orderedIds : [];
  if (ids.some(id => id == null || id === '')) throw invalid('a view id is empty');
  const named = ids.map(String);
  if (new Set(named).size !== named.length) throw invalid('a view is named twice');
  const rank = new Map(named.map((id, i) => [id, i]));
  const rows = viewsOfTable(views, tableKey);
  const ordered = rows.slice().sort((a, b) => {
    const ra = rank.has(String(a.id)) ? rank.get(String(a.id)) : Infinity;
    const rb = rank.has(String(b.id)) ? rank.get(String(b.id)) : Infinity;
    if (ra !== rb) return ra - rb;
    return compareViews(a, b);
  });
  const changes = [];
  ordered.forEach((v, i) => {
    if (num(v.position) !== i) changes.push({ id: v.id, position: i });
  });
  return changes;
}

function invalid(message) {
  const err = new Error(message);
  err.code = 'table_view_invalid';
  return err;
}

// Groupings

/** A grouping's set as it is stored: the ids as strings, sorted, distinct. */
function normalizeEntityIds(ids) {
  const out = [...new Set((Array.isArray(ids) ? ids : []).filter(id => id != null && id !== '').map(String))];
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A set's key (the sorted ids joined with |), as the combination groups key theirs. */
function groupingKeyOf(ids) {
  return normalizeEntityIds(ids).join('|');
}

/** Why a grouping cannot be stored, in words, or null (the cloud's CHECKs). */
function groupingProblem(row) {
  if (!isPlainObject(row)) return 'A grouping must be an object.';
  if (!isGroupingPair(row.table_key, row.kind)) {
    return `The ${row.table_key} table cannot be grouped by ${row.kind}.`;
  }
  const raw = Array.isArray(row.entity_ids) ? row.entity_ids : null;
  if (!raw || raw.length === 0) return 'A grouping names at least one item.';
  if (raw.some(id => id == null || id === '' || typeof id !== 'string')) return 'A grouping\'s items must each be an id.';
  if (normalizeEntityIds(raw).length > GROUPING_IDS_MAX) return `A grouping can name at most ${GROUPING_IDS_MAX} items.`;
  return null;
}

/** The stored grouping with exactly this set, or null. */
function findGroupingBySet(groupings, tableKey, kind, ids) {
  const key = groupingKeyOf(ids);
  return (Array.isArray(groupings) ? groupings : [])
    .find(g => g && g.table_key === tableKey && g.kind === kind && groupingKeyOf(g.entity_ids) === key) || null;
}

/**
 * The sweep (0098 §5): an item deleted for good leaves every grouping of its
 * kind that names it. Returns `{ remove: [grouping ids], update: [{ id,
 * entity_ids }] }`: a grouping left empty, or left naming the set of another
 * grouping of the same table and kind (one that did not name the item), is
 * removed; the rest shrink. Processed in id order, as the cloud's loop.
 */
function planForgetItem(groupings, kind, entityId) {
  const id = String(entityId);
  const rows = (Array.isArray(groupings) ? groupings : []).filter(g => g && g.kind === kind);
  const holding = rows.filter(g => normalizeEntityIds(g.entity_ids).includes(id))
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const remove = [];
  const update = [];
  for (const g of holding) {
    const rest = normalizeEntityIds(g.entity_ids).filter(x => x !== id);
    const key = rest.join('|');
    const collides = rest.length > 0 && rows.some(o => o !== g && o.table_key === g.table_key
      && !normalizeEntityIds(o.entity_ids).includes(id) && groupingKeyOf(o.entity_ids) === key);
    if (rest.length === 0 || collides) remove.push(g.id);
    else update.push({ id: g.id, entity_ids: rest });
  }
  return { remove, update };
}

// The last used view (Q4)

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The map's key for a project's table. */
function tableViewLastKey(projectId, tableKey) {
  return `${projectId}:${tableKey}`;
}

/** Why a key cannot be stored, in words, or null. */
function tableViewLastKeyProblem(key) {
  if (typeof key !== 'string') return 'not a key';
  const at = key.lastIndexOf(':');
  if (at <= 0) return `${key} is not a project id and a table`;
  const project = key.slice(0, at), table = key.slice(at + 1);
  if (!SAFE_ID.test(project) || !isTableKey(table)) return `${key} is not a project id and a table`;
  return null;
}

/** A view id or "all" (the built-in view). */
function isViewIdOrAll(view) {
  return view === ALL_VIEW_ID || (typeof view === 'string' && SAFE_ID.test(view));
}

const atOf = (entry) => (isPlainObject(entry) && typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : null);

/**
 * set_table_view_last's merge (0098 §9): the map with `key` set to `{ view,
 * at }`, keeping the TABLE_VIEW_LAST_MAX newest by `at` (an entry without a
 * number `at` counts as the oldest), ties by key A to Z. Pure.
 */
function mergeTableViewLast(map, key, view, at) {
  const merged = { ...(isPlainObject(map) ? map : {}), [key]: { view, at } };
  const entries = Object.entries(merged);
  if (entries.length <= TABLE_VIEW_LAST_MAX) return merged;
  entries.sort(([ka, va], [kb, vb]) => {
    const a = atOf(va), b = atOf(vb);
    if (a !== b) {
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    }
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return Object.fromEntries(entries.slice(0, TABLE_VIEW_LAST_MAX));
}

// ── Bundle-level operations (this file's own) ───────────────────────────

// The kinds a grouping names, and where each kind's rows live in the bundle.
const ITEM_KINDS = Object.freeze(['asset', 'scene', 'shot', 'level', 'experience']);
const KIND_COLLECTION = Object.freeze({
  asset: 'assets', scene: 'scenes', shot: 'shots', level: 'levels', experience: 'experiences',
});
const ITEM_COLLECTIONS = Object.freeze(ITEM_KINDS.map(k => KIND_COLLECTION[k]));
const MAX_POSITION = 2147483647; // the cloud's INTEGER
const MACHINE_SETTINGS_FILE = 'rabbit-machine-settings.json';

const isSafeId = (id) => typeof id === 'string' && SAFE_ID.test(id);
// Postgres' initcap for a one-word table key: the cap refusals' words.
const initcap = (s) => { const t = String(s); return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); };

function knownIds(bundle, kind) {
  const rows = bundle && bundle[KIND_COLLECTION[kind]];
  return new Set((Array.isArray(rows) ? rows : []).filter(r => r && r.id != null).map(r => String(r.id)));
}

/**
 * The sweep's twin (0098 §5, fn_item_groupings_forget; design §5.2): every id
 * a grouping names whose row is no longer in the bundle's collection of its
 * kind leaves every grouping of that kind (planForgetItem): a grouping left
 * empty, or left naming the set of another grouping of the same table and
 * kind, goes; the rest shrink (and take updated_at, as the cloud's UPDATE
 * does). The gone ids are taken in code-unit order, each by planForgetItem
 * (which runs the groupings in id order, as the cloud's loop). A grouping of
 * a kind that is not an item kind is left as it is. Returns true when
 * anything changed; converges — once nothing dangles it changes nothing.
 */
function forgetGoneItems(bundle) {
  if (!bundle || !Array.isArray(bundle.itemGroupings) || bundle.itemGroupings.length === 0) return false;
  let changed = false;
  let now = null;
  for (const kind of ITEM_KINDS) {
    const rows = bundle.itemGroupings.filter(g => g && g.kind === kind);
    if (rows.length === 0) continue;
    const known = knownIds(bundle, kind);
    // The ids as normalizeEntityIds reads them (strings; no null, no ''),
    // without its sort: this runs on every read.
    const gone = new Set();
    for (const g of rows) {
      for (const raw of Array.isArray(g.entity_ids) ? g.entity_ids : []) {
        if (raw == null || raw === '') continue;
        const id = String(raw);
        if (!known.has(id)) gone.add(id);
      }
    }
    for (const id of [...gone].sort(byText)) {
      const plan = planForgetItem(bundle.itemGroupings, kind, id);
      if (plan.remove.length === 0 && plan.update.length === 0) continue;
      if (now == null) now = new Date().toISOString();
      const removed = new Set(plan.remove.map(String));
      const shrunk = new Map(plan.update.map(u => [String(u.id), u.entity_ids]));
      bundle.itemGroupings = bundle.itemGroupings
        .filter(g => !(g && removed.has(String(g.id))))
        .map(g => (g && shrunk.has(String(g.id)) ? { ...g, entity_ids: shrunk.get(String(g.id)), updated_at: now } : g));
      changed = true;
    }
  }
  return changed;
}

/**
 * A read reconciles: a bundle from before VW1c gains both arrays, and a
 * grouping naming an item no longer in the bundle (deleted by a build without
 * the sweep, or by hand) loses it. True when the bundle changed (main.cjs's
 * readRabbitBundle then writes it once).
 */
function reconcileTableViewsOnRead(bundle) {
  if (!bundle || typeof bundle !== 'object') return false;
  let dirty = false;
  if (!Array.isArray(bundle.tableViews)) { bundle.tableViews = []; dirty = true; }
  if (!Array.isArray(bundle.itemGroupings)) { bundle.itemGroupings = []; dirty = true; }
  if (forgetGoneItems(bundle)) dirty = true;
  return dirty;
}

/**
 * main.cjs's generic routes take one hooks object per entity (`taskItems:
 * taskItemHooks`, whose registrations desktopDeleteSweep.test.js pins word for
 * word). This wraps it: everything it did, then — after a DELETE of an asset,
 * scene, shot, level or experience — the grouping sweep, in the same write. A
 * scene's delete has already taken its shots by then, so theirs go too.
 */
function withItemGroupingSweep(hooks) {
  const inner = hooks || null;
  return Object.freeze({
    onWrite(bundleKey, bundle, before, after) {
      if (inner && typeof inner.onWrite === 'function') inner.onWrite(bundleKey, bundle, before, after);
    },
    onRemoved(bundleKey, bundle, id) {
      if (inner && typeof inner.onRemoved === 'function') inner.onRemoved(bundleKey, bundle, id);
      if (ITEM_COLLECTIONS.includes(bundleKey)) forgetGoneItems(bundle);
    },
  });
}

/** The next revision (the counter, or the largest stored, plus one), taken. */
function takeRevision(bundle) {
  const counter = Number(bundle.tableViewRevision);
  let max = Number.isFinite(counter) ? counter : 0;
  for (const v of Array.isArray(bundle.tableViews) ? bundle.tableViews : []) {
    const r = Number(v && v.revision);
    if (Number.isFinite(r) && r > max) max = r;
  }
  const next = Math.floor(max) + 1;
  bundle.tableViewRevision = next;
  return next;
}

// The loads' order (the cloud's): copies, the stored arrays untouched.
function sortViewsForRead(rows) {
  return (Array.isArray(rows) ? rows : []).filter(v => v && typeof v === 'object').sort(compareViewRows);
}
function sortGroupingsForRead(rows) {
  return (Array.isArray(rows) ? rows : []).filter(g => g && typeof g === 'object').sort(compareGroupingRows);
}

const given = (v) => v !== undefined && v !== null;
// A revision the caller expects, against the stored one ("7" from a query
// string reads as 7; anything that is not a number never matches).
function sameRevision(expected, stored) {
  const e = Number(expected);
  return Number.isFinite(e) && e === Number(stored);
}
function positionProblem(p) {
  return Number.isInteger(p) && p >= 0 && p <= MAX_POSITION
    ? null : `A view's position is a whole number from 0 to ${MAX_POSITION}.`;
}

// ── Routes ──────────────────────────────────────────────────────────────

function mountRabbitTableViews(expressApp, deps) {
  if (!expressApp || typeof expressApp.post !== 'function' || typeof expressApp.get !== 'function'
      || typeof expressApp.patch !== 'function' || typeof expressApp.delete !== 'function') {
    throw new Error('mountRabbitTableViews: an express app is required');
  }
  const d = deps || {};
  for (const k of ['readRabbitBundle', 'writeRabbitBundle', 'rabbitNotFound', 'getDataDir', 'readJSON', 'writeJSON']) {
    if (typeof d[k] !== 'function') throw new Error(`mountRabbitTableViews: missing helper ${k}`);
  }
  const newId = typeof d.newId === 'function' ? d.newId : d.uuidv4;
  if (typeof newId !== 'function') throw new Error('mountRabbitTableViews: missing helper uuidv4 (or newId)');
  const { readRabbitBundle, writeRabbitBundle, rabbitNotFound, getDataDir, readJSON, writeJSON } = d;
  const V = '/api/rabbit/projects/:projectId/table-views';
  const G = '/api/rabbit/projects/:projectId/item-groupings';
  const M = '/api/rabbit/machine-settings';

  function fail(res, status, code, error, extra) {
    return res.status(status).json(Object.assign({ error, code }, extra || null));
  }
  function bodyOf(req) {
    return isPlainObject(req.body) ? req.body : {};
  }
  function load(req, res) {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle || !isPlainObject(bundle.project)) { rabbitNotFound(res); return null; }
    // main.cjs's readRabbitBundle has reconciled already; a no-op there, and
    // right with any other store (the route tests' fake one).
    reconcileTableViewsOnRead(bundle);
    return bundle;
  }
  function save(req, bundle) {
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
  }
  const findView = (bundle, id) => bundle.tableViews.find(v => v && String(v.id) === String(id)) || null;
  const stale = (res, row) => fail(res, 409, 'table_view_stale',
    'That view has changed since it was read, so nothing was written.', { row });
  const notFound = (res) => fail(res, 404, 'table_view_not_found', 'That view is no longer in this project.');

  // ── Views ──

  expressApp.get(V, (req, res) => {
    const bundle = load(req, res);
    if (!bundle) return;
    res.json(sortViewsForRead(bundle.tableViews));
  });

  // An INSERT, never an upsert (the cloud's column grants refuse one). The
  // order of the refusals is the cloud's: the cap trigger fires before the
  // CHECKs, and the CHECKs before the primary key. An id, a position or a
  // config not sent (or null) takes its default: a new id, after the table's
  // last view, `{}`.
  expressApp.post(V, (req, res) => {
    const bundle = load(req, res);
    if (!bundle) return;
    const body = bodyOf(req);
    const tableKey = body.table_key;
    if (!isTableKey(tableKey)) {
      return fail(res, 400, 'table_view_invalid', `${tableKey} is not a table with views (${TABLE_KEYS.join(', ')})`);
    }
    if (bundle.tableViews.filter(v => v && v.table_key === tableKey).length >= VIEWS_PER_TABLE_MAX) {
      return fail(res, 422, 'table_view_cap', `A project's ${initcap(tableKey)} table holds at most ${VIEWS_PER_TABLE_MAX} saved views.`);
    }
    const name = normalizeViewName(body.name);
    const nameProblem = viewNameProblem(name);
    if (nameProblem) return fail(res, 400, 'table_view_invalid', nameProblem);
    const config = given(body.config) ? body.config : {};
    const configProblem = viewConfigProblem(config);
    if (configProblem) return fail(res, 400, 'table_view_invalid', configProblem);
    const position = given(body.position) ? body.position : nextViewPosition(bundle.tableViews, tableKey);
    const posProblem = positionProblem(position);
    if (posProblem) return fail(res, 400, 'table_view_invalid', posProblem);
    // A view's id is remembered in the last used map, whose ids are
    // isViewIdOrAll's; "all" is the built-in view's and never stored.
    if (given(body.id) && (!isSafeId(body.id) || body.id === ALL_VIEW_ID)) {
      return fail(res, 400, 'table_view_invalid', 'A view\'s id is 1 to 64 letters, digits, hyphens or underscores, and never "all".');
    }
    if (given(body.id) && findView(bundle, body.id)) {
      return fail(res, 409, 'table_view_id_taken', 'A view with that id is already in this project.');
    }
    const now = new Date().toISOString();
    const row = {
      id: given(body.id) ? body.id : newId(),
      project_id: req.params.projectId,
      table_key: tableKey,
      name,
      position,
      revision: takeRevision(bundle),
      revised_by: null,
      config,
      created_at: now,
      created_by: null,
      updated_at: now,
      updated_by: null,
    };
    bundle.tableViews.push(row);
    save(req, bundle);
    res.json(row);
  });

  // reorder_table_views' twin (0098 §8). A reorder never makes a new
  // revision. Registered BEFORE the :viewId routes so "reorder" is never read
  // as an id.
  expressApp.post(`${V}/reorder`, (req, res) => {
    const bundle = load(req, res);
    if (!bundle) return;
    const body = bodyOf(req);
    let changes;
    try {
      changes = planReorderViews(bundle.tableViews, body.table_key, body.ids);
    } catch (e) {
      return fail(res, 400, 'table_view_invalid', e.message);
    }
    if (changes.length === 0) return res.json([]);
    const now = new Date().toISOString();
    const pos = new Map(changes.map(c => [String(c.id), c.position]));
    bundle.tableViews = bundle.tableViews.map(v => (v && pos.has(String(v.id))
      ? { ...v, position: pos.get(String(v.id)), updated_at: now } : v));
    save(req, bundle);
    res.json(bundle.tableViews.filter(v => v && pos.has(String(v.id))).sort(compareViews));
  });

  // A save (config), a rename (name) or a move (position). Conditional when
  // the body names the revision (a save, a save's undo) or the name (a
  // rename's undo) it expects: another is refused with the stored row and
  // nothing is written — the cloud adapter's filtered UPDATE, then a read.
  // Only a change of config takes a new revision.
  expressApp.patch(`${V}/:viewId`, (req, res) => {
    const bundle = load(req, res);
    if (!bundle) return;
    const stored = findView(bundle, req.params.viewId);
    if (!stored) return notFound(res);
    const body = bodyOf(req);
    if (given(body.expectRevision) && !sameRevision(body.expectRevision, stored.revision)) return stale(res, stored);
    if (given(body.expectName) && String(body.expectName) !== String(stored.name)) return stale(res, stored);
    const next = { ...stored };
    if (body.name !== undefined) {
      const name = normalizeViewName(body.name);
      const problem = viewNameProblem(name);
      if (problem) return fail(res, 400, 'table_view_invalid', problem);
      next.name = name;
    }
    if (body.position !== undefined) {
      const problem = positionProblem(body.position);
      if (problem) return fail(res, 400, 'table_view_invalid', problem);
      next.position = body.position;
    }
    let newConfig = false;
    if (body.config !== undefined) {
      const problem = viewConfigProblem(body.config);
      if (problem) return fail(res, 400, 'table_view_invalid', problem);
      if (!configsEqual(body.config, stored.config)) { next.config = body.config; newConfig = true; }
    }
    // Nothing differs: the stored row, and nothing written.
    if (!newConfig && next.name === stored.name && next.position === stored.position) return res.json(stored);
    if (newConfig) next.revision = takeRevision(bundle);
    next.updated_at = new Date().toISOString();
    bundle.tableViews = bundle.tableViews.map(v => (v === stored ? next : v));
    save(req, bundle);
    res.json(next);
  });

  // `?expectRevision=` makes it conditional (a new view's undo deletes it
  // only while it still has the revision it was made with).
  expressApp.delete(`${V}/:viewId`, (req, res) => {
    const bundle = load(req, res);
    if (!bundle) return;
    const stored = findView(bundle, req.params.viewId);
    if (!stored) return notFound(res);
    const expected = req.query ? req.query.expectRevision : undefined;
    if (given(expected) && expected !== '' && !sameRevision(expected, stored.revision)) return stale(res, stored);
    bundle.tableViews = bundle.tableViews.filter(v => v !== stored);
    save(req, bundle);
    res.json({ ok: true, removed: true });
  });

  // ── Groupings ──

  expressApp.get(G, (req, res) => {
    const bundle = load(req, res);
    if (!bundle) return;
    res.json(sortGroupingsForRead(bundle.itemGroupings));
  });

  // An INSERT; a set already stored for that table and kind answers the
  // stored row and writes nothing (the cloud's unique key, then a read).
  expressApp.post(G, (req, res) => {
    const bundle = load(req, res);
    if (!bundle) return;
    const body = bodyOf(req);
    const problem = groupingProblem(body);
    if (problem) return fail(res, 400, 'item_grouping_invalid', problem);
    if (given(body.id) && !isSafeId(body.id)) {
      return fail(res, 400, 'item_grouping_invalid', 'A grouping\'s id is 1 to 64 letters, digits, hyphens or underscores.');
    }
    const ids = normalizeEntityIds(body.entity_ids);
    // fn_item_groupings_validate's twin (the cloud's 23503): every id a row
    // of its kind in this project. The desktop has no trash: a deleted item
    // is gone.
    const known = knownIds(bundle, body.kind);
    const missing = ids.filter(id => !known.has(id)).length;
    if (missing > 0) {
      return fail(res, 422, 'item_grouping_entity_not_found',
        `A grouping can name only this project's own ${body.kind}s: ${missing} of the ${ids.length} named are not in it.`);
    }
    const same = findGroupingBySet(bundle.itemGroupings, body.table_key, body.kind, ids);
    if (same) return res.json(same);
    if (bundle.itemGroupings.filter(g => g && g.table_key === body.table_key).length >= GROUPINGS_PER_TABLE_MAX) {
      return fail(res, 422, 'item_grouping_cap', `A project's ${initcap(body.table_key)} table holds at most ${GROUPINGS_PER_TABLE_MAX} groupings.`);
    }
    if (given(body.id) && bundle.itemGroupings.some(g => g && String(g.id) === String(body.id))) {
      return fail(res, 409, 'item_grouping_id_taken', 'A grouping with that id names another set.');
    }
    const now = new Date().toISOString();
    const row = {
      id: given(body.id) ? body.id : newId(),
      project_id: req.params.projectId,
      table_key: body.table_key,
      kind: body.kind,
      entity_ids: ids,
      created_at: now,
      created_by: null,
      updated_at: now,
      updated_by: null,
    };
    bundle.itemGroupings.push(row);
    save(req, bundle);
    res.json(row);
  });

  // Removing one that is not there is not an error (the cloud's DELETE of no
  // row): `removed: false`, and nothing written.
  expressApp.delete(`${G}/:groupingId`, (req, res) => {
    const bundle = load(req, res);
    if (!bundle) return;
    const row = bundle.itemGroupings.find(g => g && String(g.id) === String(req.params.groupingId));
    if (!row) return res.json({ ok: true, removed: false });
    bundle.itemGroupings = bundle.itemGroupings.filter(g => g !== row);
    save(req, bundle);
    res.json({ ok: true, removed: true });
  });

  // ── This machine's settings: the last used view (Q4, design §5.4) ──

  const settingsFile = () => path.join(getDataDir(), MACHINE_SETTINGS_FILE);
  const readSettings = () => {
    const s = readJSON(settingsFile(), {});
    return isPlainObject(s) ? s : {};
  };

  expressApp.get(M, (req, res) => {
    const s = readSettings();
    res.json({ tableViewLast: isPlainObject(s.tableViewLast) ? s.tableViewLast : {} });
  });

  // set_table_view_last's twin: one key merged with this machine's clock,
  // the 300 newest kept, every other key of the file kept as it was.
  expressApp.post(`${M}/table-view-last`, (req, res) => {
    const body = bodyOf(req);
    const keyProblem = tableViewLastKeyProblem(body.key);
    if (keyProblem) return fail(res, 400, 'table_view_last_invalid', keyProblem);
    if (!isViewIdOrAll(body.view)) {
      return fail(res, 400, 'table_view_last_invalid', `${body.view} is not a view id or "all"`);
    }
    const s = readSettings();
    const map = mergeTableViewLast(s.tableViewLast, body.key, body.view, Date.now());
    writeJSON(settingsFile(), { ...s, tableViewLast: map });
    res.json({ tableViewLast: map });
  });
}

module.exports = {
  TABLE_KEYS, GROUPING_KINDS,
  VIEW_NAME_MAX, VIEW_CONFIG_MAX_BYTES, VIEWS_PER_TABLE_MAX, GROUPINGS_PER_TABLE_MAX,
  GROUPING_IDS_MAX, TABLE_VIEW_LAST_MAX, ALL_VIEW_ID, MAX_VIEW_POSITION,
  isTableKey, isGroupingPair, normalizeViewName, viewNameProblem,
  utf8Length, canonicalJson, configsEqual, jsonbText, viewConfigProblem,
  compareViews, compareViewRows, compareGroupingRows, viewsOfTable, nextViewPosition, planReorderViews,
  normalizeEntityIds, groupingKeyOf, groupingProblem, findGroupingBySet, planForgetItem,
  tableViewLastKey, tableViewLastKeyProblem, isViewIdOrAll, mergeTableViewLast,
  forgetGoneItems, reconcileTableViewsOnRead, withItemGroupingSweep,
  mountRabbitTableViews,
};
