// ============================================================
// RABBIT — shot lists, their membership and edits, local-server routes
// (post-overhaul bundle S3a, 2026-09-30)
// ============================================================
//
// The Local Server half of migration 0084 (supabase/migrations/
// 0084_shot_lists_and_edits.sql). The same row shapes, the same refusals and
// the same messages as the database, so a project behaves the same whichever
// backend holds it. The contract every backend implements is the S3a
// contract; Audrey's rulings (docs/design/POST_OVERHAUL_PLAN.md §0.1):
//   * D1 + D3 — a list is MEMBERSHIP (bundle.shotListItems), never a copy. The
//     scene and shot rows are shared by every list that contains them.
//   * D4 / D18 — lists and edits are ARCHIVED, never deleted: there is no
//     DELETE route here, exactly as 0084 grants no DELETE on either table.
//   * D8 — set-active and archive are manager/admin decisions in the cloud.
//     The Local Server has no roles, so here both are always allowed; the
//     ACTIVE list still cannot be archived (a data rule, not a role rule).
//   * D11 — a bundle that predates shot lists is given "Shot list 1 · v1" on
//     read (backfillShotListsOnRead), once, in 0084's backfill order.
//
// Mounted from main.cjs with one line inside startLocalServer, next to the
// bins (the same injected-helpers pattern and the same reason: readRabbitBundle
// migrates and reconciles on every read, so the module must use that one).
//
// No same-origin gate: unlike the bins, nothing here takes or returns a
// filesystem path.
//
// 🚨 EVERY HANDLER IS SYNCHRONOUS — read, validate EVERYTHING, mutate, write,
// with no `await` in between. There is no lock on the bundle file; a handler
// that awaited between its read and its write would race every other request
// (map.md, "No locking, non-atomic writes"). All-or-nothing follows from the
// same shape: a refusal returns before the bundle is touched.
//
// 🚨 `fetch` resolves for every status. Every refusal is a JSON body
// `{ error, code }` with the HTTP status; the adapter's jfetch turns that into
// an Error carrying `.status` and `.code`.

// ── messages (0084's RAISE texts; the provider shows them verbatim) ─────────

const MSG = {
  listTitle: 'A shot list needs a title.',
  listVersion: 'A shot list\'s version must be a whole number of at least 1.',
  listSnapshot: 'A shot list\'s snapshot must be an object.',
  listArchived: 'this shot list is archived — restore it before changing it',
  listArchiveForbidden: 'shot lists are archived and restored only by a project manager or a workspace admin, through archive_shot_list()',
  listNotFound: 'shot list not found',
  listNotInProject: 'shot list not found in this project',
  itemsNotArray: 'items must be a JSON array',
  itemShape: 'each item names exactly one scene or one shot',
  itemForeign: 'an item names a scene or shot that is not in this project',
  itemDuplicate: 'a shot list holds each scene and each shot once',
  itemPosition: 'an item\'s position must be a whole number of at least 0',
  itemIdTwice: 'an item id appears more than once',
  editTitle: 'An edit needs a title.',
  editVersion: 'An edit\'s version must be a whole number of at least 1.',
  editList: 'an edit belongs to a shot list of this project',
  editItems: 'An edit\'s items must be a list.',
  editSnapshot: 'An edit\'s snapshot must be an object.',
  editParent: 'an edit\'s parent must be another edit of the same shot list',
  editArchived: 'this edit is archived — restore it before changing it',
  editArchiveForbidden: 'edits are archived and restored only by a project manager or a workspace admin, through archive_edit()',
  editMove: 'an edit cannot move to another shot list',
  editNotFound: 'edit not found',
  activeArchived: 'an archived shot list cannot be made active — restore it first',
  activeListIdRequired: 'listId is required (null clears the active shot list)',
  archiveActive: 'the active shot list cannot be archived — make another list active first',
  archivedFlag: 'archived must be true or false',
};

const SHOT_LIST_BACKFILL_TITLE = 'Shot list 1';
const SHOT_LIST_BACKFILL_SUMMARY = 'Created from existing scenes';

// ── ordering — a CJS restatement of src/tools/rabbit_v0.1.0/state/
//    shotListModel.js (this file cannot import that ESM module synchronously).
//    🚨 It MUST stay identical to the model's backfillItems and to 0084's
//    backfill ORDER BY (scene_number NULLS LAST, sort_order, created_at, id;
//    shots PARTITION BY scene_id the same way on shot_number).
//    src/tools/rabbit_v0.1.0/state/shotListBackfillParity.test.js runs both on
//    the same shuffled input and fails on any difference. ──────────────────

function cmpNullsLast(a, b) {
  const an = a === null || a === undefined || a === '';
  const bn = b === null || b === undefined || b === '';
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  const x = Number(a);
  const y = Number(b);
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

function cmpText(a, b) {
  const x = a == null ? '' : String(a);
  const y = b == null ? '' : String(b);
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

function compareScenesForList(a, b) {
  return cmpNullsLast(a?.scene_number, b?.scene_number)
    || cmpNullsLast(a?.sort_order, b?.sort_order)
    || cmpText(a?.created_at, b?.created_at)
    || cmpText(a?.id, b?.id);
}

function compareShotsForList(a, b) {
  return cmpNullsLast(a?.shot_number, b?.shot_number)
    || cmpNullsLast(a?.sort_order, b?.sort_order)
    || cmpText(a?.created_at, b?.created_at)
    || cmpText(a?.id, b?.id);
}

/** The model's backfillItems, line for line: [{ scene_id, shot_id, position }]. */
function backfillItems(scenes, shots) {
  const out = [];
  const orderedScenes = [...(scenes || [])].sort(compareScenesForList);
  orderedScenes.forEach((s, i) => out.push({ scene_id: s.id, shot_id: null, position: i }));
  const groups = new Map();
  for (const sh of shots || []) {
    const key = sh.scene_id || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sh);
  }
  const sceneOrder = new Map(orderedScenes.map((s, i) => [s.id, i]));
  const rank = (k) => (k === null ? Number.MAX_SAFE_INTEGER
    : (sceneOrder.has(k) ? sceneOrder.get(k) : Number.MAX_SAFE_INTEGER - 1));
  const keys = [...groups.keys()].sort((a, b) => (rank(a) - rank(b)) || cmpText(a, b));
  for (const k of keys) {
    groups.get(k).sort(compareShotsForList).forEach((sh, i) => out.push({ scene_id: null, shot_id: sh.id, position: i }));
  }
  return out;
}

// ── small helpers ────────────────────────────────────────────────────────────

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** An own key that carries a value (JSON cannot carry undefined; a spread can). */
function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
}

function isRow(r) {
  return isPlainObject(r) && r.id != null && r.id !== '';
}

/** "Title · v3" (D14) — the model's formatShotListLabel. */
function label(row) {
  return `${(row && row.title) || 'Untitled'} · v${Number(row && row.version) || 1}`;
}

/**
 * Does the body try to change archived_at / archived_by? Only a key the body
 * CARRIES is examined, and an unchanged value passes — a caller that sends the
 * whole row back must not be refused (0084 §7a compares NEW with OLD the same
 * way). `stored` is the row as it is, or all-null for a new row.
 */
function archiveFieldsChanged(body, stored) {
  for (const k of ['archived_at', 'archived_by']) {
    if (!has(body, k)) continue;
    const next = body[k] === null ? null : String(body[k]);
    const cur = stored[k] == null ? null : String(stored[k]);
    if (next !== cur) return true;
  }
  return false;
}

function summaryOf(v) {
  return v == null ? null : String(v);
}

// ── the read-time migration (rule 9) ────────────────────────────────────────

/**
 * For a bundle that already HAS a `shotLists` array: make sure its two
 * siblings exist. Returns true when it changed anything. A bundle WITHOUT the
 * array is left alone — that is backfillShotListsOnRead's case, and creating
 * the array here first would stop the backfill from ever running.
 */
function ensureShotListKeys(bundle) {
  if (!bundle || !Array.isArray(bundle.shotLists)) return false;
  let changed = false;
  if (!Array.isArray(bundle.shotListItems)) { bundle.shotListItems = []; changed = true; }
  if (!Array.isArray(bundle.edits)) { bundle.edits = []; changed = true; }
  return changed;
}

/**
 * D11 on the desktop: the one-time cloud backfill, run when a bundle is READ.
 *
 * Only a bundle that PREDATES shot lists (`bundle.shotLists` is not an array)
 * is touched. It gains the three keys and, if it has scenes or shots, "Shot
 * list 1 · v1" (summary "Created from existing scenes") holding every scene
 * and shot in backfillItems' order, made active when the project has no
 * active list. No edit is created.
 *
 * A bundle that already has a `shotLists` array — even an EMPTY one — is
 * never backfilled again: a project created after S3a starts with [] (its
 * emptyBundle), and a project whose person archived every list and cleared
 * the pointer must not have a list reappear. That is the cloud's rule too
 * (0084's backfill skips a project that has any list, and runs once).
 *
 * Returns true when it changed anything. The whole result is computed before
 * the bundle is touched, so a throw leaves the bundle as it was.
 *
 * Not deleted, deliberately: a (malformed) bundle that has no `shotLists`
 * array but does carry `shotListItems` or `edits` arrays keeps them. The
 * contract says "set to []"; wiping rows nothing else can recover is the one
 * thing a read-time migration must never do (Audrey's never-delete rule).
 */
function backfillShotListsOnRead(bundle, opts) {
  if (!bundle || typeof bundle !== 'object') return false;
  if (Array.isArray(bundle.shotLists)) return false;
  const newId = opts && opts.newId;
  if (typeof newId !== 'function') throw new Error('backfillShotListsOnRead: opts.newId is required');
  const now = (opts && opts.now) || new Date().toISOString();
  const project = isPlainObject(bundle.project) ? bundle.project : null;
  const projectId = (opts && opts.projectId) || (project && project.id) || null;

  const scenes = (Array.isArray(bundle.scenes) ? bundle.scenes : []).filter(isRow);
  const shots = (Array.isArray(bundle.shots) ? bundle.shots : []).filter(isRow);
  let list = null;
  let items = [];
  if (scenes.length || shots.length) {
    list = {
      id: newId(),
      project_id: projectId,
      workspace_id: null,
      title: SHOT_LIST_BACKFILL_TITLE,
      version: 1,
      summary: SHOT_LIST_BACKFILL_SUMMARY,
      snapshot: {},
      archived_at: null,
      archived_by: null,
      created_at: now,
      created_by: null,
      updated_at: now,
      updated_by: null,
    };
    items = backfillItems(scenes, shots).map(it => ({
      id: newId(),
      shot_list_id: list.id,
      project_id: projectId,
      workspace_id: null,
      scene_id: it.scene_id,
      shot_id: it.shot_id,
      position: it.position,
      created_at: now,
      created_by: null,
      updated_at: now,
      updated_by: null,
    }));
  }

  bundle.shotLists = list ? [list] : [];
  bundle.shotListItems = (Array.isArray(bundle.shotListItems) ? bundle.shotListItems : []).concat(items);
  if (!Array.isArray(bundle.edits)) bundle.edits = [];
  if (project) {
    // 0084's UPDATE ... WHERE active_shot_list_id IS NULL: a pointer that is
    // already set is left alone. The key itself is added either way so the
    // desktop's project row has the column the cloud's has.
    if (list && project.active_shot_list_id == null) project.active_shot_list_id = list.id;
    else if (!('active_shot_list_id' in project)) project.active_shot_list_id = null;
  }
  return true;
}

// ── the scene / shot delete sweep (rule 8) ──────────────────────────────────

/**
 * The desktop's copy of 0084's foreign-key actions when a scene or shot is
 * deleted: its items leave EVERY list (shot_list_items_*_fk ON DELETE
 * CASCADE — the shared-row rule, D3) and every task that pointed at it is
 * unlinked (tasks_scene_fk / tasks_shot_fk ON DELETE SET NULL, and an FK
 * action is an UPDATE, so the task's updated_at moves as the audit trigger
 * would move it). Runs in the SAME write that removes the scene or shot, on
 * the bundle the _DATABASES mirrors are rendered from.
 *
 * NOT swept, on purpose, exactly as in the cloud: assets.scene_ids /
 * shot_ids (arrays are not foreign keys — 0084 §6c) and edits' items (D17: a
 * deleted shot stays in an edit as "Missing shot").
 *
 * kind: 'scene' | 'shot'. Returns { items, tasks } — how many of each moved.
 */
function sweepShotListLinks(bundle, kind, id) {
  const field = kind === 'scene' ? 'scene_id' : (kind === 'shot' ? 'shot_id' : null);
  if (!field) throw new Error(`sweepShotListLinks: kind must be 'scene' or 'shot', not ${kind}`);
  let items = 0;
  let tasks = 0;
  if (!bundle || id == null || id === '') return { items, tasks };
  if (Array.isArray(bundle.shotListItems)) {
    const before = bundle.shotListItems.length;
    bundle.shotListItems = bundle.shotListItems.filter(i => !(i && i[field] === id));
    items = before - bundle.shotListItems.length;
  }
  if (Array.isArray(bundle.tasks)) {
    const now = new Date().toISOString();
    for (let n = 0; n < bundle.tasks.length; n++) {
      const t = bundle.tasks[n];
      if (t && t[field] === id) {
        bundle.tasks[n] = { ...t, [field]: null, updated_at: now };
        tasks++;
      }
    }
  }
  return { items, tasks };
}

// ── row shapes (0084 §3–§5; the Local Server has no workspace and no users,
//    so workspace_id and every *_by column are null) ───────────────────────

function sortItemRows(rows) {
  return [...rows].sort((a, b) => ((Number(a.position) || 0) - (Number(b.position) || 0)) || cmpText(a.id, b.id));
}

// ── the mount ────────────────────────────────────────────────────────────────

function mountRabbitShotLists(expressApp, deps) {
  if (!expressApp || typeof expressApp.post !== 'function' || typeof expressApp.put !== 'function') {
    throw new Error('mountRabbitShotLists: an express app is required');
  }
  const d = deps || {};
  for (const k of ['readRabbitBundle', 'writeRabbitBundle', 'rabbitTouch', 'rabbitUpsertInto', 'rabbitNotFound']) {
    if (typeof d[k] !== 'function') throw new Error(`mountRabbitShotLists: missing helper ${k}`);
  }
  const newId = typeof d.newId === 'function' ? d.newId : d.uuidv4;
  if (typeof newId !== 'function') throw new Error('mountRabbitShotLists: missing helper uuidv4 (or newId)');
  const { readRabbitBundle, writeRabbitBundle, rabbitTouch, rabbitUpsertInto, rabbitNotFound } = d;
  const P = '/api/rabbit/projects/:projectId';
  const now = () => new Date().toISOString();

  function fail(res, status, code, error) {
    return res.status(status).json({ error, code });
  }

  function load(req, res) {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle || !isPlainObject(bundle.project)) { rabbitNotFound(res); return null; }
    // main.cjs's readRabbitBundle has already run both of these; running them
    // again is a no-op there and keeps the module right with any other store
    // (the route tests' fake one). The backfill, not a bare `= []`, so a
    // legacy bundle reaching this path first still gets its D11 list.
    backfillShotListsOnRead(bundle, { newId, now: now(), projectId: req.params.projectId });
    ensureShotListKeys(bundle);
    return bundle;
  }

  const findList = (bundle, id) => (id ? bundle.shotLists.find(l => l && l.id === id) : null) || null;
  const listItems = (bundle, listId) => sortItemRows(bundle.shotListItems.filter(i => i && i.shot_list_id === listId));

  // ── rule 1: upsert a shot list ──────────────────────────────────────────
  expressApp.post(`${P}/shot-lists`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const projectId = req.params.projectId;
    const body = isPlainObject(req.body) ? req.body : {};
    const id = has(body, 'id') && body.id !== null && body.id !== '' ? String(body.id) : null;
    const stored = findList(bundle, id);

    // 0084 §7a's order: a change to the archive columns first, then any
    // change at all to an archived row.
    if (archiveFieldsChanged(body, stored || { archived_at: null, archived_by: null })) {
      return fail(res, 403, 'forbidden', MSG.listArchiveForbidden);
    }
    if (stored && stored.archived_at) return fail(res, 409, 'conflict', MSG.listArchived);

    const title = has(body, 'title') ? body.title : (stored ? stored.title : undefined);
    if (typeof title !== 'string' || !title.trim()) return fail(res, 400, 'invalid', MSG.listTitle);
    // A new row without a version is v1 (the column's DEFAULT 1).
    const version = has(body, 'version') ? body.version : (stored ? stored.version : 1);
    if (!Number.isInteger(version) || version < 1) return fail(res, 400, 'invalid', MSG.listVersion);
    let snapshot;
    if (has(body, 'snapshot')) {
      if (!isPlainObject(body.snapshot)) return fail(res, 400, 'invalid', MSG.listSnapshot);
      snapshot = body.snapshot;
    } else {
      snapshot = stored && isPlainObject(stored.snapshot) ? stored.snapshot : {};
    }
    const summary = has(body, 'summary') ? summaryOf(body.summary) : (stored ? summaryOf(stored.summary) : null);

    // D14: title (trimmed) + version is unique per project, archived or not.
    const rowId = stored ? stored.id : (id || newId());
    const t = title.trim();
    const clash = bundle.shotLists.find(l => l && l.id !== rowId
      && String(l.title || '').trim() === t && Number(l.version) === version);
    if (clash) return fail(res, 409, 'conflict', `There is already a shot list called "${label(clash)}".`);

    // Written column by column, never spread from the body: project_id comes
    // from the URL (or the stored row, which never moves), created_at is the
    // stored one, and a key the table does not have is not persisted.
    const row = rabbitTouch({
      id: rowId,
      project_id: stored ? (stored.project_id || projectId) : projectId,
      workspace_id: null,
      title,
      version,
      summary,
      snapshot,
      archived_at: stored ? (stored.archived_at ?? null) : null,
      archived_by: stored ? (stored.archived_by ?? null) : null,
      created_at: stored ? stored.created_at : (typeof body.created_at === 'string' && body.created_at ? body.created_at : undefined),
      created_by: stored ? (stored.created_by ?? null) : null,
      updated_by: null,
    });
    const result = rabbitUpsertInto(bundle.shotLists, row);
    writeRabbitBundle(projectId, bundle);
    res.json(result);
  });

  // ── rule 2: replace one list's membership, atomically ───────────────────
  //
  // 0084's replace_shot_list_items: delete the list's rows not named, upsert
  // the rest, one transaction. Here: validate every item, then swap the
  // list's rows in one assignment. An id that belongs to ANOTHER list's item
  // is skipped — not written, not returned — which is what the database's
  // `ON CONFLICT (id) DO UPDATE ... WHERE t.shot_list_id = EXCLUDED.shot_list_id`
  // does. Archived lists are not frozen here (the database does not freeze
  // them either); the provider refuses client-side.
  expressApp.put(`${P}/shot-lists/:listId/items`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const projectId = req.params.projectId;
    const list = findList(bundle, req.params.listId);
    if (!list) return fail(res, 404, 'not_found', MSG.listNotFound);
    const items = isPlainObject(req.body) ? req.body.items : undefined;
    if (!Array.isArray(items)) return fail(res, 400, 'invalid', MSG.itemsNotArray);

    const sceneIds = new Set((Array.isArray(bundle.scenes) ? bundle.scenes : []).filter(isRow).map(s => s.id));
    const shotIds = new Set((Array.isArray(bundle.shots) ? bundle.shots : []).filter(isRow).map(s => s.id));
    const own = new Map();
    const foreign = new Set();
    for (const i of bundle.shotListItems) {
      if (!i || i.id == null) continue;
      if (i.shot_list_id === list.id) own.set(i.id, i); else foreign.add(i.id);
    }

    const planned = [];
    const seenIds = new Set();
    const seenScenes = new Set();
    const seenShots = new Set();
    for (let n = 0; n < items.length; n++) {
      const it = items[n];
      if (!isPlainObject(it)) return fail(res, 400, 'invalid', MSG.itemShape);
      // '' counts as absent (the database's NULLIF(e ->> 'scene_id', '')).
      const sceneId = it.scene_id != null && it.scene_id !== '' ? String(it.scene_id) : null;
      const shotId = it.shot_id != null && it.shot_id !== '' ? String(it.shot_id) : null;
      if ((sceneId === null) === (shotId === null)) return fail(res, 400, 'invalid', MSG.itemShape);
      if (sceneId ? !sceneIds.has(sceneId) : !shotIds.has(shotId)) return fail(res, 400, 'invalid', MSG.itemForeign);
      // Missing position = its index in the payload (COALESCE(position, ord - 1)).
      let position = n;
      if (it.position !== undefined && it.position !== null) {
        if (!Number.isInteger(it.position) || it.position < 0) return fail(res, 400, 'invalid', MSG.itemPosition);
        position = it.position;
      }
      const itemId = it.id != null && it.id !== '' ? String(it.id) : null;
      if (itemId && foreign.has(itemId)) continue;
      if (itemId) {
        // The database answers a repeated id with "ON CONFLICT DO UPDATE
        // command cannot affect row a second time"; refused here by name.
        if (seenIds.has(itemId)) return fail(res, 400, 'invalid', MSG.itemIdTwice);
        seenIds.add(itemId);
      }
      if (sceneId) {
        if (seenScenes.has(sceneId)) return fail(res, 409, 'conflict', MSG.itemDuplicate);
        seenScenes.add(sceneId);
      } else {
        if (seenShots.has(shotId)) return fail(res, 409, 'conflict', MSG.itemDuplicate);
        seenShots.add(shotId);
      }
      planned.push({ id: itemId, sceneId, shotId, position });
    }

    // Everything is valid: now, and only now, the bundle changes.
    const t = now();
    const next = planned.map(p => {
      const old = p.id ? own.get(p.id) : null;
      if (old) {
        // Its row is kept (created_at and all), re-pointed and re-positioned;
        // updated_at moves, as fn_audit_touch moves it on the ON CONFLICT update.
        return { ...old, project_id: old.project_id || projectId, scene_id: p.sceneId, shot_id: p.shotId, position: p.position, updated_at: t, updated_by: null };
      }
      return {
        id: p.id || newId(),
        shot_list_id: list.id,
        project_id: projectId,
        workspace_id: null,
        scene_id: p.sceneId,
        shot_id: p.shotId,
        position: p.position,
        created_at: t,
        created_by: null,
        updated_at: t,
        updated_by: null,
      };
    });
    bundle.shotListItems = bundle.shotListItems.filter(i => !(i && i.shot_list_id === list.id)).concat(next);
    writeRabbitBundle(projectId, bundle);
    res.json(listItems(bundle, list.id));
  });

  // ── rule 5: archive / restore a shot list ───────────────────────────────
  function archivedFlag(body) {
    // COALESCE(p_archived, true): absent or null archives.
    const v = isPlainObject(body) ? body.archived : undefined;
    if (v === undefined || v === null) return true;
    if (typeof v === 'boolean') return v;
    return undefined;
  }
  function applyArchive(row, archived) {
    const next = archived
      ? { archived_at: row.archived_at || now(), archived_by: row.archived_by ?? null }
      : { archived_at: null, archived_by: null };
    const changed = next.archived_at !== (row.archived_at ?? null) || next.archived_by !== (row.archived_by ?? null);
    return changed ? { ...row, ...next, updated_at: now() } : null;
  }

  expressApp.post(`${P}/shot-lists/:listId/archive`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const archived = archivedFlag(req.body);
    if (archived === undefined) return fail(res, 400, 'invalid', MSG.archivedFlag);
    const idx = bundle.shotLists.findIndex(l => l && l.id === req.params.listId);
    if (idx < 0) return fail(res, 404, 'not_found', MSG.listNotFound);
    const cur = bundle.shotLists[idx];
    if (archived && (bundle.project.active_shot_list_id ?? null) === cur.id) {
      return fail(res, 409, 'conflict', MSG.archiveActive);
    }
    // Idempotent: archiving an archived list keeps its first archived_at, and
    // restoring a live one changes nothing — neither writes.
    const next = applyArchive(cur, archived);
    if (next) {
      bundle.shotLists[idx] = next;
      writeRabbitBundle(req.params.projectId, bundle);
    }
    res.json(bundle.shotLists[idx]);
  });

  // ── rule 4: the active list ─────────────────────────────────────────────
  //
  // The one way projects.active_shot_list_id changes (main.cjs's project
  // PATCH refuses a change, rule 7). null clears it — "no active list", every
  // scene and shot shows (D10) — which is what undoing a first activation
  // needs.
  expressApp.post(`${P}/active-shot-list`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const body = isPlainObject(req.body) ? req.body : {};
    // Required, not defaulted: JSON.stringify drops an undefined listId, and a
    // body that lost its key must not silently clear the pointer. The cloud
    // RPC has no default for p_list either.
    if (!Object.prototype.hasOwnProperty.call(body, 'listId')) return fail(res, 400, 'invalid', MSG.activeListIdRequired);
    const listId = body.listId != null && body.listId !== '' ? String(body.listId) : null;
    if (listId) {
      const list = findList(bundle, listId);
      if (!list) return fail(res, 404, 'not_found', MSG.listNotInProject);
      if (list.archived_at) return fail(res, 409, 'conflict', MSG.activeArchived);
    }
    if ((bundle.project.active_shot_list_id ?? null) !== listId) {
      bundle.project.active_shot_list_id = listId;
      writeRabbitBundle(req.params.projectId, bundle);
    }
    res.json({ active_shot_list_id: listId });
  });

  // ── rule 3: upsert an edit ──────────────────────────────────────────────
  expressApp.post(`${P}/edits`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const projectId = req.params.projectId;
    const body = isPlainObject(req.body) ? req.body : {};
    const id = has(body, 'id') && body.id !== null && body.id !== '' ? String(body.id) : null;
    const stored = id ? (bundle.edits.find(e => e && e.id === id) || null) : null;

    // 0084 §7a's order: the list pin, then the archive columns, then any
    // change to an archived row.
    if (stored && has(body, 'shot_list_id')) {
      const next = body.shot_list_id == null ? null : String(body.shot_list_id);
      if (next !== (stored.shot_list_id == null ? null : String(stored.shot_list_id))) {
        return fail(res, 403, 'forbidden', MSG.editMove);
      }
    }
    if (archiveFieldsChanged(body, stored || { archived_at: null, archived_by: null })) {
      return fail(res, 403, 'forbidden', MSG.editArchiveForbidden);
    }
    if (stored && stored.archived_at) return fail(res, 409, 'conflict', MSG.editArchived);

    const title = has(body, 'title') ? body.title : (stored ? stored.title : undefined);
    if (typeof title !== 'string' || !title.trim()) return fail(res, 400, 'invalid', MSG.editTitle);
    const version = has(body, 'version') ? body.version : (stored ? stored.version : 1);
    if (!Number.isInteger(version) || version < 1) return fail(res, 400, 'invalid', MSG.editVersion);
    const shotListId = stored
      ? stored.shot_list_id
      : (body.shot_list_id != null && body.shot_list_id !== '' ? String(body.shot_list_id) : null);
    if (!findList(bundle, shotListId)) return fail(res, 400, 'invalid', MSG.editList);
    // D6: items are stored as sent — { id, scene_id, shot_id, label, notes },
    // shaped by the provider's normalizeEditItems; the database's CHECK admits
    // any array the same way.
    const items = has(body, 'items') ? body.items : (stored ? stored.items : []);
    if (!Array.isArray(items)) return fail(res, 400, 'invalid', MSG.editItems);
    let snapshot;
    if (has(body, 'snapshot')) snapshot = body.snapshot;
    else snapshot = stored ? (stored.snapshot ?? null) : null;
    if (snapshot !== null && !isPlainObject(snapshot)) return fail(res, 400, 'invalid', MSG.editSnapshot);
    const rowId = stored ? stored.id : (id || newId());
    const parentRaw = has(body, 'parent_edit_id') ? body.parent_edit_id : (stored ? stored.parent_edit_id : null);
    const parentId = parentRaw != null && parentRaw !== '' ? String(parentRaw) : null;
    // D6: one linear chain per list — the parent is another edit of the SAME
    // list (0084's edits_parent_same_list_fk + edits_not_own_parent_chk).
    if (parentId && (parentId === rowId || !bundle.edits.some(e => e && e.id === parentId && e.shot_list_id === shotListId))) {
      return fail(res, 400, 'invalid', MSG.editParent);
    }
    const summary = has(body, 'summary') ? summaryOf(body.summary) : (stored ? summaryOf(stored.summary) : null);

    const t = title.trim();
    const clash = bundle.edits.find(e => e && e.id !== rowId && e.shot_list_id === shotListId
      && String(e.title || '').trim() === t && Number(e.version) === version);
    if (clash) return fail(res, 409, 'conflict', `This shot list already has an edit called "${label(clash)}".`);

    const row = rabbitTouch({
      id: rowId,
      project_id: stored ? (stored.project_id || projectId) : projectId,
      workspace_id: null,
      shot_list_id: shotListId,
      title,
      version,
      summary,
      parent_edit_id: parentId,
      items,
      snapshot,
      archived_at: stored ? (stored.archived_at ?? null) : null,
      archived_by: stored ? (stored.archived_by ?? null) : null,
      created_at: stored ? stored.created_at : (typeof body.created_at === 'string' && body.created_at ? body.created_at : undefined),
      created_by: stored ? (stored.created_by ?? null) : null,
      updated_by: null,
    });
    const result = rabbitUpsertInto(bundle.edits, row);
    writeRabbitBundle(projectId, bundle);
    res.json(result);
  });

  // ── rule 6: archive / restore an edit ───────────────────────────────────
  expressApp.post(`${P}/edits/:editId/archive`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const archived = archivedFlag(req.body);
    if (archived === undefined) return fail(res, 400, 'invalid', MSG.archivedFlag);
    const idx = bundle.edits.findIndex(e => e && e.id === req.params.editId);
    if (idx < 0) return fail(res, 404, 'not_found', MSG.editNotFound);
    const next = applyArchive(bundle.edits[idx], archived);
    if (next) {
      bundle.edits[idx] = next;
      writeRabbitBundle(req.params.projectId, bundle);
    }
    res.json(bundle.edits[idx]);
  });
}

module.exports = {
  mountRabbitShotLists,
  ensureShotListKeys,
  backfillShotListsOnRead,
  sweepShotListLinks,
  // Pure helpers, exported for the parity test against shotListModel.js.
  backfillItems,
  compareScenesForList,
  compareShotsForList,
  SHOT_LIST_BACKFILL_TITLE,
  SHOT_LIST_BACKFILL_SUMMARY,
};
