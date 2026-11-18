// ============================================================
// RABBIT — a task's items, local-server half (FX2, 2026-10-11; VW1m, 2026-10-16)
// ============================================================
//
// The Local Server's twin of migrations 0096 and 0097 (supabase/migrations/
// 0096_task_items.sql): `bundle.taskItems`, one row per (task, item) —
// `{ id, task_id, project_id, entity_type, entity_id, position, created_at,
// created_by, updated_at }`, entity_type one of asset / scene / shot / level /
// experience. NOT `taskLinks` (a task's URL links, 0000).
//
// VW1m (2026-10-16, Audrey's batch 12 and 13 rulings): a task's items are its
// items; no item of a kind counts for more than another. Each task's five
// single fields (asset_id, scene_id, shot_id, level_id, experience_id) stay
// as THE OLDER BUILDS' COPY only — each kind's first item in the stored order
// (position, then created_at, then id), as 0097 §7a keeps the cloud's three
// columns — written here (syncTaskFields) and read for meaning by nothing in
// this app. An older build's write of one field ADDS that item and never
// removes another, except the one a cleared field named (0097 §7b,
// planLegacyFieldWrite); a read never reorders.
//
// The RULES are src/tools/rabbit_v0.1.0/state/taskItemsModel.js's (the
// backends' half); since F9 they are not copied here but generated from it
// into electron/rules/taskItems.cjs (a synchronous route cannot import an ES
// module), and src/lib/electronRules.test.js holds the generated file current.
//
// Mounted from main.cjs, beside the shot lists, with the same injected
// helpers; its write hooks ride on main.cjs's generic routes through
// `taskItems: taskItemHooks` (tasks, scenes, shots, levels, experiences) and
// the asset DELETE route.
//
// 🚨 EVERY HANDLER IS SYNCHRONOUS — read, validate, mutate, write, with no
// `await` in between (the bundle file has no lock; rabbitShotLists.cjs).
// 🚨 Every refusal is a JSON body `{ error, code }` with its HTTP status.

'use strict';

const crypto = require('node:crypto');

// F9 (B1): the rules are taskItemsModel.js's own, GENERATED into
// electron/rules/taskItems.cjs by scripts/build-electron-rules.mjs (esbuild's
// CommonJS bundle of the module) — no longer copied here by hand.
// src/lib/electronRules.test.js fails while the generated file is stale;
// after changing a rule in the module: npm run build:rules.
const {
  ITEM_KINDS, KIND_FIELD, LINK_FIELDS, FIELD_KIND, isItemKind, compareItems, itemsOfTask,
  copyFieldsFromItems, nextPosition, planLegacyFieldWrite, seedItemsFor, itemShapeProblem,
} = require('./rules/taskItems.cjs');

// Where each kind's rows live in the bundle (this file's own).
const KIND_COLLECTION = Object.freeze({
  asset: 'assets', scene: 'scenes', shot: 'shots', level: 'levels', experience: 'experiences',
});

// An older build's reorder only (VW1m: this app has no Move buttons). VW1m
// review round 1 (R1-8): this and applyPositions are this file's own, for
// the reorder route below; the model no longer states them (no caller in
// the app), so taskItemsParity.test.js holds them here, not against it.
function planReorder(items, taskId, kind, orderedIds) {
  const mine = itemsOfTask(items, taskId, kind);
  const named = new Map();
  (Array.isArray(orderedIds) ? orderedIds : []).forEach((id, n) => {
    if (id != null && !named.has(String(id))) named.set(String(id), n);
  });
  const ranked = mine.slice().sort((a, b) => {
    const na = named.has(String(a.id)) ? named.get(String(a.id)) : null;
    const nb = named.has(String(b.id)) ? named.get(String(b.id)) : null;
    if (na != null && nb != null) return na - nb;
    if (na != null) return -1;
    if (nb != null) return 1;
    return compareItems(a, b);
  });
  const changes = [];
  ranked.forEach((row, n) => {
    if ((Number(row.position) || 0) !== n) changes.push({ id: row.id, position: n });
  });
  return changes;
}

function applyPositions(items, changes) {
  if (!Array.isArray(changes) || changes.length === 0) return items;
  const pos = new Map(changes.map(c => [String(c.id), c.position]));
  return items.map(i => (i && pos.has(String(i.id)) ? Object.assign({}, i, { position: pos.get(String(i.id)) }) : i));
}

const idOrNull = (v) => (v == null || v === '' ? null : String(v));

// sha1 of the name as a v5-style UUID (rabbitShotLists.cjs's stableUuid): an
// item the read backfill makes has the same id on every read, so a read whose
// write-back failed mints the same rows next time.
function stableItemId(projectId, taskId, kind, entityId) {
  const h = crypto.createHash('sha1')
    .update(`wilson-task-item:${projectId}:${taskId}:${kind}:${entityId}`, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// ── Bundle-level operations ─────────────────────────────────────────────

function entityExists(bundle, kind, id) {
  const rows = bundle && bundle[KIND_COLLECTION[kind]];
  return Array.isArray(rows) && rows.some(r => r && String(r.id) === String(id));
}

// Review round 2 (R2-2): the read below runs on every project route, on the
// desktop's main process. Scanning every item per task and every entity per
// item made it quadratic (measured: 1.36 s at 5,000 tasks and 15,000 items,
// with nothing to change). These indexes are built once per call.
function knownIdsByKind(bundle) {
  const out = {};
  for (const kind of ITEM_KINDS) {
    const rows = bundle && bundle[KIND_COLLECTION[kind]];
    out[kind] = new Set((Array.isArray(rows) ? rows : []).filter(r => r && r.id != null).map(r => String(r.id)));
  }
  return out;
}

function itemsByTask(items) {
  const out = new Map();
  for (const i of Array.isArray(items) ? items : []) {
    if (!i || i.task_id == null) continue;
    const k = String(i.task_id);
    const list = out.get(k);
    if (list) list.push(i); else out.set(k, [i]);
  }
  return out;
}

function taskById(bundle, id) {
  return (Array.isArray(bundle && bundle.tasks) ? bundle.tasks : []).find(t => t && String(t.id) === String(id)) || null;
}

/**
 * The older builds' copy: each named task's (every task's, with no names)
 * five fields set to its first item of each kind in the stored order. With
 * `stampAt`, a task whose copy moved also takes it as updated_at (a row's
 * delete is the cloud's FK action, an UPDATE, which moves it). True when one
 * moved.
 */
function syncTaskFields(bundle, taskIds, stampAt) {
  if (!bundle || !Array.isArray(bundle.tasks)) return false;
  const byTask = itemsByTask(bundle.taskItems);
  const only = taskIds ? new Set([...taskIds].map(String)) : null;
  let changed = false;
  bundle.tasks = bundle.tasks.map(t => {
    if (!t || (only && !only.has(String(t.id)))) return t;
    const fields = copyFieldsFromItems(byTask.get(String(t.id)) || []);
    let same = true;
    for (const f of LINK_FIELDS) if ((t[f] == null ? null : t[f]) !== fields[f]) { same = false; break; }
    if (same) return t;
    changed = true;
    return Object.assign({}, t, fields, stampAt ? { updated_at: stampAt } : null);
  });
  return changed;
}

/**
 * The cloud's CASCADEs: an item whose task, or whose asset / scene / shot /
 * level / experience, is no longer in the bundle goes; an item of an unknown
 * kind, or the second copy of one (task, kind, entity), goes. Returns the
 * task ids whose items changed.
 */
function pruneDanglingTaskItems(bundle) {
  const touched = new Set();
  if (!bundle || !Array.isArray(bundle.taskItems)) return touched;
  const taskIds = new Set((bundle.tasks || []).filter(Boolean).map(t => String(t.id)));
  const known = knownIdsByKind(bundle);
  const seen = new Set();
  const kept = [];
  for (const i of bundle.taskItems.slice().sort(compareItems)) {
    const ok = i && isItemKind(i.entity_type) && taskIds.has(String(i.task_id))
      && known[i.entity_type].has(String(i.entity_id));
    const key = ok ? `${i.task_id}|${i.entity_type}|${i.entity_id}` : null;
    if (!ok || seen.has(key)) {
      if (i && i.task_id != null) touched.add(String(i.task_id));
      continue;
    }
    seen.add(key);
    kept.push(i);
  }
  if (kept.length !== bundle.taskItems.length) {
    const keepIds = new Set(kept.map(i => i.id));
    bundle.taskItems = bundle.taskItems.filter(i => keepIds.has(i && i.id));
  }
  return touched;
}

function applyPlan(bundle, plan) {
  if (!plan) return;
  if (plan.remove && plan.remove.length) {
    const gone = new Set(plan.remove.map(i => i.id));
    bundle.taskItems = bundle.taskItems.filter(i => !gone.has(i.id));
  }
  if (plan.insert) bundle.taskItems.push(plan.insert);
}

/**
 * A read reconciles CONSERVATIVELY (it cannot know who wrote what): the
 * dangling items go; a single field set on a task with no item for it — a
 * bundle from before FX2, or a build from before FX2 that wrote the field —
 * becomes an item (0096's backfill and §7c, seedItemsFor), with a
 * DETERMINISTIC id; then every task's copy is its items'. VW1m (2026-10-16):
 * a read NEVER reorders and never removes an item a task still names (FX2's
 * "a field that disagrees moves first" arm is gone with the first item that
 * counted for more). Returns true when the bundle changed.
 */
function reconcileTaskItemsOnRead(bundle, opts) {
  if (!bundle || typeof bundle !== 'object') return false;
  const o = opts || {};
  const projectId = o.projectId != null ? o.projectId : (bundle.project && bundle.project.id);
  const now = o.now || new Date().toISOString();
  let dirty = false;
  if (!Array.isArray(bundle.taskItems)) { bundle.taskItems = []; dirty = true; }
  if (pruneDanglingTaskItems(bundle).size > 0) dirty = true;
  const known = knownIdsByKind(bundle);
  const byTask = itemsByTask(bundle.taskItems);
  for (const t of Array.isArray(bundle.tasks) ? bundle.tasks : []) {
    if (!t || t.id == null) continue;
    const make = (base) => ({
      id: stableItemId(projectId, t.id, base.entity_type, base.entity_id),
      project_id: projectId,
      created_at: now, created_by: null, updated_at: now,
      ...base,
    });
    // A field naming a row the bundle does not have makes no item (the copy
    // then reads nothing for it).
    const seeds = seedItemsFor(t, byTask.get(String(t.id)) || [], make)
      .filter(i => known[i.entity_type].has(String(i.entity_id)));
    if (seeds.length) {
      for (const i of seeds) bundle.taskItems.push(i);
      dirty = true;
    }
  }
  if (syncTaskFields(bundle)) dirty = true;
  return dirty;
}

/**
 * A task row was written through main.cjs's generic routes (`before` is the
 * stored row before the write, null for a new task; `after` the row as
 * stored). Each single field the write CHANGED is an older build's write of
 * one field (this app sends none): 0097 §7b's add-only rule against the value
 * the field held before; a new task's set fields become its items (§7c). Then
 * the task's copy is its items'.
 */
function applyTaskWrite(bundle, before, after, opts) {
  if (!bundle || !after || after.id == null) return;
  if (!Array.isArray(bundle.taskItems)) bundle.taskItems = [];
  const o = opts || {};
  const newId = typeof o.newId === 'function' ? o.newId : (() => crypto.randomUUID());
  const now = o.now || new Date().toISOString();
  const projectId = after.project_id;
  const make = (base) => ({
    id: newId(), project_id: projectId, created_at: now, created_by: null, updated_at: now, ...base,
  });
  for (const f of LINK_FIELDS) {
    const kind = FIELD_KIND[f];
    const was = before ? idOrNull(before[f]) : null;
    const is = idOrNull(after[f]);
    if (before && was === is) continue;
    if (!before && is == null) continue;
    if (is != null && !entityExists(bundle, kind, is)) continue;
    applyPlan(bundle, planLegacyFieldWrite(bundle.taskItems, after.id, kind, after[f], was, make));
  }
  syncTaskFields(bundle, [after.id]);
}

/**
 * A row left the bundle (a task, or an asset / scene / shot / level /
 * experience): every item it ends goes, and the tasks that had one take a
 * fresh copy (stamped, as the cloud's FK action is an UPDATE) — the cloud's
 * CASCADE and §7a in one write. A task is never removed here: her Q-M2
 * (2026-10-16), "The tasks stay".
 */
function afterRowRemoved(bundle) {
  if (!bundle || !Array.isArray(bundle.taskItems)) return;
  const touched = pruneDanglingTaskItems(bundle);
  if (touched.size) syncTaskFields(bundle, touched, new Date().toISOString());
}

/** The hooks main.cjs's generic routes call (`taskItems: taskItemHooks`). */
function makeTaskItemHooks(deps) {
  const d = deps || {};
  return Object.freeze({
    onWrite(bundleKey, bundle, before, after) {
      if (bundleKey !== 'tasks') return;
      applyTaskWrite(bundle, before, after, { newId: d.newId });
    },
    onRemoved(bundleKey, bundle) {
      afterRowRemoved(bundle);
    },
  });
}

function sortForRead(rows) {
  return (Array.isArray(rows) ? rows.slice() : []).sort((a, b) => {
    const ta = String(a && a.task_id != null ? a.task_id : ''), tb = String(b && b.task_id != null ? b.task_id : '');
    if (ta !== tb) return ta < tb ? -1 : 1;
    const ka = String(a && a.entity_type || ''), kb = String(b && b.entity_type || '');
    if (ka !== kb) return ka < kb ? -1 : 1;
    return compareItems(a, b);
  });
}

// ── Routes ──────────────────────────────────────────────────────────────

function mountRabbitTaskItems(expressApp, deps) {
  if (!expressApp || typeof expressApp.post !== 'function' || typeof expressApp.get !== 'function'
      || typeof expressApp.delete !== 'function') {
    throw new Error('mountRabbitTaskItems: an express app is required');
  }
  const d = deps || {};
  for (const k of ['readRabbitBundle', 'writeRabbitBundle', 'rabbitNotFound']) {
    if (typeof d[k] !== 'function') throw new Error(`mountRabbitTaskItems: missing helper ${k}`);
  }
  const newId = typeof d.newId === 'function' ? d.newId : d.uuidv4;
  if (typeof newId !== 'function') throw new Error('mountRabbitTaskItems: missing helper uuidv4 (or newId)');
  const { readRabbitBundle, writeRabbitBundle, rabbitNotFound } = d;
  const P = '/api/rabbit/projects/:projectId/task-items';

  function fail(res, status, code, error) {
    return res.status(status).json({ error, code });
  }
  function load(req, res) {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle || !bundle.project) { rabbitNotFound(res); return null; }
    // main.cjs's readRabbitBundle has reconciled already; a no-op there, and
    // right with any other store (the route tests' fake one).
    reconcileTaskItemsOnRead(bundle, { projectId: req.params.projectId });
    return bundle;
  }

  expressApp.get(P, (req, res) => {
    const bundle = load(req, res);
    if (!bundle) return;
    res.json(sortForRead(bundle.taskItems));
  });

  // Add one item, or answer the stored row when the task already names it
  // (the cloud's ON CONFLICT DO NOTHING, then a read).
  expressApp.post(P, (req, res) => {
    const bundle = load(req, res);
    if (!bundle) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const problem = itemShapeProblem(body);
    if (problem) return fail(res, 400, 'task_item_invalid', problem);
    const task = taskById(bundle, body.task_id);
    if (!task) return fail(res, 404, 'task_not_found', 'that task is not in this project');
    if (!entityExists(bundle, body.entity_type, body.entity_id)) {
      return fail(res, 404, 'task_item_entity_not_found', `that ${body.entity_type} is not in this project`);
    }
    const stored = bundle.taskItems.find(i => String(i.task_id) === String(body.task_id)
      && i.entity_type === body.entity_type && String(i.entity_id) === String(body.entity_id));
    if (stored) return res.json(stored);
    if (body.id != null && bundle.taskItems.some(i => String(i.id) === String(body.id))) {
      return fail(res, 409, 'task_item_id_taken', 'an item with that id names something else');
    }
    const now = new Date().toISOString();
    const row = {
      id: body.id != null && body.id !== '' ? String(body.id) : newId(),
      task_id: task.id,
      project_id: req.params.projectId,
      entity_type: body.entity_type,
      entity_id: String(body.entity_id),
      position: body.position == null ? 0 : Number(body.position),
      created_at: typeof body.created_at === 'string' && body.created_at ? body.created_at : now,
      created_by: null,
      updated_at: now,
    };
    bundle.taskItems.push(row);
    syncTaskFields(bundle, [task.id]);
    writeRabbitBundle(req.params.projectId, bundle);
    res.json(row);
  });

  // reorder_task_items' twin, kept for older builds (VW1m, 2026-10-16: this
  // app sends none; the stored order is only the order the items were added,
  // so a reorder moves the older builds' copy and the Date added sort,
  // nothing else). Registered BEFORE the :itemId route below so "reorder" is
  // never read as an id.
  expressApp.post(`${P}/reorder`, (req, res) => {
    const bundle = load(req, res);
    if (!bundle) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!isItemKind(body.entity_type)) {
      return fail(res, 400, 'task_item_invalid', `${body.entity_type} is not a kind of item (asset, scene, shot, level, experience)`);
    }
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (new Set(ids).size !== ids.length) return fail(res, 400, 'task_item_invalid', 'an item is named twice');
    const changes = planReorder(bundle.taskItems, body.task_id, body.entity_type, ids);
    if (changes.length === 0) return res.json([]);
    const now = new Date().toISOString();
    const movedIds = new Set(changes.map(c => String(c.id)));
    bundle.taskItems = applyPositions(bundle.taskItems, changes)
      .map(i => (movedIds.has(String(i.id)) ? Object.assign({}, i, { updated_at: now }) : i));
    const moved = bundle.taskItems.filter(i => movedIds.has(String(i.id)));
    syncTaskFields(bundle, [body.task_id]);
    writeRabbitBundle(req.params.projectId, bundle);
    res.json(moved);
  });

  // Removing an item that is not there is not an error (the cloud's DELETE
  // of no row): `removed: false`.
  expressApp.delete(`${P}/:itemId`, (req, res) => {
    const bundle = load(req, res);
    if (!bundle) return;
    const row = bundle.taskItems.find(i => String(i.id) === String(req.params.itemId));
    if (!row) return res.json({ ok: true, removed: false });
    bundle.taskItems = bundle.taskItems.filter(i => i !== row);
    syncTaskFields(bundle, [row.task_id]);
    writeRabbitBundle(req.params.projectId, bundle);
    res.json({ ok: true, removed: true });
  });
}

module.exports = {
  ITEM_KINDS, KIND_FIELD, LINK_FIELDS, FIELD_KIND,
  compareItems, itemsOfTask, copyFieldsFromItems, nextPosition,
  planReorder, applyPositions, planLegacyFieldWrite, seedItemsFor, itemShapeProblem, stableItemId,
  syncTaskFields, pruneDanglingTaskItems, reconcileTaskItemsOnRead,
  applyTaskWrite, afterRowRemoved, makeTaskItemHooks,
  mountRabbitTaskItems,
};
