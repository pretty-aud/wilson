// =============================================================================
// rabbitFixturesAdapter.js — the RabbitAdapter contract over the in-memory
// store (adapters/index.js's typedef, plus the budget, scenes, folders, task
// template, bins and take methods the Supabase and Local Server adapters grew
// since). `mode` is 'fixtures'.
//
// How it is reached: in a dev build with the fixtures on, `selectAdapter(
// 'supabase')` returns THIS adapter instead of the cloud one, so
// `adapterMode` stays 'supabase' and every `adapterMode === 'supabase'` gate
// in the provider, the Dashboard, the Projects page and the drawers opens the
// cloud feature set onto fixture data. Registering a fourth visible mode would
// have closed all of those gates and shown Audrey the local-server subset.
//
// Reads clone. Writes mutate the store for the session. Writes the fixtures
// cannot honour — bytes (upload, download), the OS (file pickers, opening a
// file, relinking a drive) — are refused with devWriteRefused(): a toast and
// a thrown Error, never a silent drop.
//
// rabbitFixturesAdapter.contract.test.js proves every method the Supabase
// adapter exposes exists here, by name, from the real factory.
//
// Shot lists, items and edits (post-overhaul S3a, migration 0084) enforce the
// S3a contract's rules here the way the database does — uniqueness, the
// archive guard, the active-list guard on the project row, same-project
// membership, and the delete sweep — so a screen walked on the fixtures sees
// the refusals Audrey will see on a real backend. Review round 1 added the
// membership deltas (upsert / delete named items), a scene delete that takes
// its shots, trimmed titles and the one-chain rule for edits (the round-1
// addendum, sections A, C, D, E). Round 2 reverted round 1's frozen
// membership of an archived list (R2-1) and added the positions-only reorder,
// which never inserts (R2-2).
// =============================================================================

import { devWriteRefused } from '../devFixtures'
import { planProjectFolders, planEntityFolder, ENTITY_FK_COLUMN } from '../../tools/rabbit_v0.1.0/folderPaths'
import { pendingShotRefiling, shotsCategoryRow, shotsCategoryEmpty } from '../../tools/rabbit_v0.1.0/shotRefiling'
import { FILE_TAG_IDS, GATED_TAG, isLegalFile, storedTags, legalRefusalSentence } from '../../tools/rabbit_v0.1.0/fileTags'
import {
  clone, newId, now, findById, live, upsert, patch, remove, softDelete, restore, notFound,
} from './store'
import { splitSetAside, isSetAside } from '../../tools/rabbit_v0.1.0/state/setAside'

const PRIMARY = 'primary'

// Key dates in the order both real adapters return them: by date, undated
// last, ties on id (state/milestoneOrder.js's byMilestoneDate — restated here
// because devFixtures.test.js allow-lists what src/dev may import).
function byMilestoneDate(a, b) {
  const ta = a.date ? Date.parse(a.date) : NaN
  const tb = b.date ? Date.parse(b.date) : NaN
  if (Number.isNaN(ta) && Number.isNaN(tb)) return String(a.id).localeCompare(String(b.id))
  if (Number.isNaN(ta)) return 1
  if (Number.isNaN(tb)) return -1
  return (ta - tb) || String(a.id).localeCompare(String(b.id))
}

// ── Shot lists, items and edits (post-overhaul S3a, migration 0084) ─────────
// The refusals are the S3a contract's, word for word: the provider shows the
// message, and the Local Server route and the database refuse the same inputs
// with the same text. `status` / `code` are the Local Server's HTTP answer, so
// a caller branches on one shape whichever backend it is talking to.
function refusal(status, code, message) {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}
const invalid = (message) => refusal(400, 'invalid', message)
const conflict = (message) => refusal(409, 'conflict', message)
const forbidden = (message) => refusal(403, 'forbidden', message)
const missing = (message) => refusal(404, 'not_found', message)

const LIST_ARCHIVE_ONLY = 'shot lists are archived and restored only by a project manager or a workspace admin, through archive_shot_list()'
const EDIT_ARCHIVE_ONLY = 'edits are archived and restored only by a project manager or a workspace admin, through archive_edit()'
const ACTIVE_LIST_ONLY = 'the active shot list is changed only by a project manager or a workspace admin, through set_active_shot_list()'
// 0089 (post-overhaul S5): the guard's and the RPC's sentences, word for word.
const OPEN_VERSION_ONLY = 'the open bid version is changed only by someone who can see this project\'s budget (a project manager or a workspace admin)'
const SELECTED_BID_ONLY = 'the selected bid is chosen only by someone who can see this project\'s budget (a project manager or a workspace admin)'
// 0090 (S5b): the set-aside stamp and the budget's settings, word for word.
const SET_ASIDE_ONLY = 'a row is set aside or brought back only by someone who can see this project\'s budget (a project manager or a workspace admin): the bid versions decide it'
const BUDGET_SETTINGS_ONLY = 'the budget\'s settings (margin, contingency, agency, actuals and the lock) are changed only by someone who can see this project\'s budget (a project manager or a workspace admin)'
const BUDGET_SETTINGS = ['budget_margin_pct', 'budget_contingency_pct', 'budget_agency_pct', 'budget_agency_enabled', 'budget_actual_column_mode', 'budget_actual_column_count', 'budget_active', 'budget_active_version_id', 'budget_finalized']
const VERSION_NOT_HERE = 'bid version not found in this project'
// BC1 (0091): the bins refusal map's sentences, word for word with the cloud
// adapter's BINS_REFUSALS (restated here because devFixtures.test.js
// allow-lists what src/dev may import; binsAdapterParity.test.js pins the two).
const BINS_SENTENCES = {
  locationShape: 'A footage location is written as its network address, like \\\\server\\footage — never a drive letter, never this computer (localhost), never an administrative share like C$, never with .. in it, and without a trailing backslash.',
  locationExists: 'This location is already in the company\'s list.',
  locationInUse: 'This location still has clips in it — move or remove them before taking it away.',
  locationName: 'A footage location needs a name.',
  remoteViewingOff: 'This company has not allowed files to be viewed from outside the office network, so WILSON keeps no picture of this clip in the cloud. A workspace admin can turn that on in the company settings.',
  switchAdminOnly: 'Only a workspace admin can change whether files may be viewed from outside the office network.',
}
// 0091's unc_path CHECK, as the database refuses it: two leading backslashes,
// a server and at least a share, no forbidden characters, no . or .. segment,
// no trailing backslash.
const UNC_SEGMENT = '[^\\\\/:*?"<>|]+'
const UNC_RE = new RegExp(`^\\\\\\\\${UNC_SEGMENT}(\\\\${UNC_SEGMENT})+$`)
// The same two refusals as 0091's CHECK and electron/rabbitBins.cjs (review
// round 1 of BC1): an administrative share (C$, ADMIN$, IPC$) and the
// loopback host. binsAdapterParity.test.js holds this copy to the desktop's.
// Review round 2: every spelling of 127.0.0.1, an all-digit or 0-led host,
// and any segment ending in a dot or a space (Windows strips both).
const UNC_LOOPBACK_HOST_RE = /^(localhost|127(\.\d+)*|0[\d.x].*|\d+)$/i
const UNC_ADMIN_SHARE_RE = /^([a-z]|admin|ipc)\$$/i
const TRAILING_DOT_OR_SPACE_RE = /[. ]$/
function isUncPath(p) {
  if (typeof p !== 'string' || p.length > 1024 || !UNC_RE.test(p)) return false
  // BC3 review round 1: no control, zero-width, bidi, separator or
  // formatting character; round 2: by Unicode property, one regex on every
  // backend (the desktop's and the renderer's, held equal by
  // binsAdapterParity.test.js).
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u.test(p)) return false
  const segs = p.split('\\')
  if (segs.slice(2).some(seg => seg === '.' || seg === '..' || TRAILING_DOT_OR_SPACE_RE.test(seg))) return false
  return !UNC_LOOPBACK_HOST_RE.test(segs[2]) && !UNC_ADMIN_SHARE_RE.test(segs[3])
}
// The fake cloud's capability object: a browser signed in to a company —
// no OS pickers, no bytes, no relink; locations, the switch, signed posters.
// `resolveFiles` is true because the dataset answers `online` itself (every
// fixture file is "reachable", there being no disk behind it).
const FIXTURES_BINS_CAPABILITIES = Object.freeze({
  backend: 'fixtures',
  pickFiles: false, probe: false, stream: false, resolveFiles: true, relink: false, openInOs: false,
  posters: 'cloud', locations: true, remoteViewingSwitch: true,
})
// BC3 (`?bins=browser`): the fake cloud as the real cloud answers a BROWSER —
// it cannot say what this computer reaches, so no row carries `online` and
// the provider marks every one "not on this computer" (B3). The same keys,
// one answer changed (binsBrowserVariant.test.js pins it).
const FIXTURES_BROWSER_BINS_CAPABILITIES = Object.freeze({ ...FIXTURES_BINS_CAPABILITIES, resolveFiles: false })
// For binsAdapterParity.test.js: the sentences and the capability object,
// pinned against the cloud adapter's.
export { BINS_SENTENCES as FIXTURES_BINS_SENTENCES, FIXTURES_BINS_CAPABILITIES, FIXTURES_BROWSER_BINS_CAPABILITIES }
// 0084 §7a's frozen-row sentences: an archived list or edit ROW is frozen.
// Its MEMBERSHIP is not — round 1 (addendum B) gave LIST_FROZEN to every item
// write on an archived list too, and round 2 reverted that (R2-1, below).
const LIST_FROZEN = 'this shot list is archived — restore it before changing it'
const EDIT_FROZEN = 'this edit is archived — restore it before changing it'
// D6, one linear chain of edits per list (review round 1, addendum E): 0084 §5's
// edits_one_root_per_list_key and edits_one_child_key, and §7a's guard.
const CHAIN_ONE_ROOT = "this shot list's edits form one chain — a new edit continues from the latest one"
const CHAIN_ONE_CHILD = "an edit's parent must be the latest edit of its shot list"
const CHAIN_FIXED = "an edit's place in its chain cannot change"
// Membership refusals — the Local Server's words (electron/rabbitShotLists.cjs),
// shared by the whole-list replace, the two delta writes and the reorder.
const ITEM = {
  notArray: 'items must be a JSON array',
  idsNotArray: 'ids must be a JSON array',
  shape: 'each item names exactly one scene or one shot',
  foreign: 'an item names a scene or shot that is not in this project',
  once: 'a shot list holds each scene and each shot once',
  position: "an item's position must be a whole number of at least 0",
  idTwice: 'an item id appears more than once',
  // R2-2: a reorder moves rows that exist, so each one is named by its id.
  repositionId: 'each item of a reorder needs an id',
}

// S4a (0085): which of its CHECKs refuses these tags, named as Postgres names
// it — it tests a row's CHECKs in alphabetical order by name (the CREATE
// TABLE docs, since 9.5), so a two-level list is flat_chk's, an unknown word
// known_chk's, a tenth tag len_chk's (round 2, R2-TST-14: every refusal said
// known_chk). A value that is not a list never reaches a CHECK: Postgres
// cannot read it as text[].
function fileTagsRefusal(tags) {
  if (!Array.isArray(tags)) return `malformed array literal: ${JSON.stringify(String(tags))}`
  const check = tags.some(t => Array.isArray(t)) ? 'files_tags_flat_chk'
    : tags.some(t => !FILE_TAG_IDS.includes(t)) ? 'files_tags_known_chk'
      : tags.length > 9 ? 'files_tags_len_chk'
        : null
  return check && `new row for relation "files" violates check constraint "${check}"`
}

// S4b (0088): the two Legal CHECKs, as the fake cloud's row can show them.
// A fixture row's path is not the cloud's key, so the "folder" is what the
// row was created as (isLegalFile of the row BEFORE the write): the legal
// tag may not be added to or removed from a file after it is added
// (files_legal_folder_chk), and a Legal file may not be core
// (files_legal_not_core_chk). Both sort before files_tags_*, so they are
// reported first, as Postgres would.
function legalRefusal(before, after) {
  const wasLegal = isLegalFile(before)
  const tagged = storedTags(after).includes(GATED_TAG)
  const check = tagged !== wasLegal ? 'files_legal_folder_chk'
    : (after.is_core_definer && (tagged || wasLegal)) ? 'files_legal_not_core_chk'
      : null
  return check && `new row for relation "files" violates check constraint "${check}"`
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}
// '' counts as absent, as the database's NULLIF(e ->> 'scene_id', '') does.
const present = (v) => v !== undefined && v !== null && v !== ''
// Plain code-unit order, not localeCompare: Postgres orders uuids byte-wise,
// which for lowercase hex is exactly this.
function cmpText(a, b) {
  const x = a == null ? '' : String(a)
  const y = b == null ? '' : String(b)
  return x < y ? -1 : x > y ? 1 : 0
}
// The bundle order every backend returns (the S3a contract): lists and edits
// by created_at then id; items by position then id.
const byCreated = (a, b) => cmpText(a.created_at, b.created_at) || cmpText(a.id, b.id)
const byPosition = (a, b) => ((Number(a.position) || 0) - (Number(b.position) || 0)) || cmpText(a.id, b.id)
// "Title · v3" (D14) — shotListModel.js's formatShotListLabel, restated.
const versionedLabel = (row) => `${row.title || 'Untitled'} · v${Number(row.version) || 1}`
const withoutUndefined = (row) => Object.fromEntries(Object.entries(row || {}).filter(([, v]) => v !== undefined))
// Timestamps are compared as instants: a row read back may carry the same
// moment spelled differently (Z vs +00:00).
function sameInstant(a, b) {
  if ((a ?? null) === (b ?? null)) return true
  if (a == null || b == null) return false
  const x = Date.parse(a)
  return !Number.isNaN(x) && x === Date.parse(b)
}
/**
 * 0084's fn_shot_list_archive_guard, for an UPDATE of a stored list or edit:
 * archived_at / archived_by move only through archive_*(), and an archived
 * row is frozen. A key the body leaves out is unchanged (an upsert of a
 * partial row), so only a key that is present can differ.
 */
function guardArchived(body, stored, { archiveOnly, frozen }) {
  if (('archived_at' in body && !sameInstant(body.archived_at, stored.archived_at))
    || ('archived_by' in body && (body.archived_by ?? null) !== (stored.archived_by ?? null))) {
    throw forbidden(archiveOnly)
  }
  if (stored.archived_at) throw conflict(frozen)
}
// `noun` carries its article ("A shot list", "An edit"): the contract's texts
// are "An edit needs a title.", never "A edit ...".
function validateVersioned(row, noun) {
  if (typeof row.title !== 'string' || !row.title.trim()) throw invalid(`${noun} needs a title.`)
  if (!Number.isInteger(row.version) || row.version < 1) {
    throw invalid(`${noun}'s version must be a whole number of at least 1.`)
  }
}

// `browser` (BC3): answer the bins as the cloud does in a browser — the
// capability object above with `resolveFiles` false, and no `online` on any
// clip row (the provider marks them from the capability object).
export function createRabbitFixturesAdapter(store, { userId, workspaceId, appRole = 'admin' }, { browser = false } = {}) {
  const by = userId
  const binsCaps = browser ? FIXTURES_BROWSER_BINS_CAPABILITIES : FIXTURES_BINS_CAPABILITIES
  // A clip row as this backend hands it out: answered for (online) where the
  // dataset answers, bare where a browser's cloud would not know.
  const withOnline = (row) => { if (!browser) return { ...row, online: true }; const { online: _o, ...bare } = row; return bare }
  const stampBy = (row) => ({ ...row, updated_by: by, last_updated_by: by, last_updated_at: now() })
  const projectOf = (id) => findById(store.projects, id)

  // S4b: the money gate, as can_access_project_money answers it (0037): a
  // workspace admin, or the project's manager. A reader who does not pass it
  // gets no money-gated row — an invoice (is_financial) or a Legal file — from
  // any file read, exactly as the cloud's RLS hides them (0038, 0088). The
  // default reviewer passes (Mara: admin and manager); `?fixtures=member`
  // does not.
  // S4d (0092): the LEGAL gate, as can_access_project_legal answers it — the
  // money gate OR a workspace manager (the project's own workspace; the
  // fixtures have one). A Legal row (isLegalRow: Legal and not an invoice —
  // files_legal_not_financial_chk) is readable past EITHER gate; an invoice
  // only past the money gate. `?fixtures=manager` is Mara as a workspace
  // manager holding a member seat: she sees the Legal file and not the
  // invoice, as the cloud's RLS answers her (0092).
  const passesMoneyGate = (projectId) => appRole === 'admin'
    || store.projectMembers.some(m => m.project_id === projectId && m.user_id === userId && m.project_role === 'manager')
  const passesLegalGate = (projectId) => passesMoneyGate(projectId) || appRole === 'manager'
  const isMoneyFile = (f) => !!f?.is_financial || isLegalFile(f)
  const isLegalRow = (f) => isLegalFile(f) && !f?.is_financial
  const readableFiles = (rows) => rows.filter(f => !isMoneyFile(f) || passesMoneyGate(f.project_id) || (isLegalRow(f) && passesLegalGate(f.project_id)))

  // 0090 (S5b): the set-aside stamp is written only by setAsideRows — never
  // by an ordinary write (the store MERGES, so a stale copy re-sent with
  // `set_aside_at: null` would bring a row back unasked) — and trashing a row
  // clears it: a trashed row is never also set aside (0090's guard).
  const unstamped = (row) => {
    if (!row || typeof row !== 'object' || !('set_aside_at' in row)) return row
    const { set_aside_at: _dropped, ...rest } = row
    return rest
  }
  const trash = (list, id) => {
    const row = softDelete(list, id, by)
    delete row.set_aside_at
    return row
  }

  // ── Folders (shared by the folder methods and entity creation) ─────────────
  function folderByPath(projectId, path) {
    return store.folders.find(f => f.project_id === projectId && f.path === path) || null
  }
  function materialiseFolder(projectId, planned) {
    const existing = folderByPath(projectId, planned.path)
    if (existing) return existing
    const parent = planned.parentPath == null ? null : folderByPath(projectId, planned.parentPath)
    const row = {
      id: newId(), project_id: projectId, workspace_id: workspaceId,
      parent_id: parent ? parent.id : null,
      kind: planned.kind, entity_type: planned.entityType,
      asset_id: null, scene_id: null, shot_id: null, level_id: null, experience_id: null,
      slug: planned.slug, label: planned.label, path: planned.path,
      sort_order: store.folders.filter(f => f.project_id === projectId).length,
      created_at: now(), created_by: by, updated_at: now(), updated_by: by,
    }
    for (const col of Object.values(ENTITY_FK_COLUMN)) if (planned[col]) row[col] = planned[col]
    store.folders.push(row)
    return row
  }

  // ── Takes: one primary per shot, contiguous positions ──────────────────────
  function normaliseTakes(shotId) {
    const rows = store.shotTakes.filter(t => t.shot_id === shotId).sort((a, b) => a.position - b.position)
    if (rows.length && !rows.some(t => t.role === PRIMARY)) rows[0].role = PRIMARY
    let seenPrimary = false
    rows.forEach((t, i) => {
      if (t.role === PRIMARY) { if (seenPrimary) t.role = 'alt'; seenPrimary = true }
      t.position = i
    })
  }
  function takesAnswer(affectedShotIds, extra = {}) {
    const fileIds = new Set(store.binFiles.map(f => f.id))
    const shotIds = new Set(store.shots.map(s => s.id))
    const liveTakes = store.shotTakes.filter(t => fileIds.has(t.bin_file_id) && shotIds.has(t.shot_id))
    const orphanTakes = store.shotTakes.filter(t => !fileIds.has(t.bin_file_id) || !shotIds.has(t.shot_id))
    return { affectedShotIds: [...new Set(affectedShotIds)], shotTakes: clone(liveTakes), orphanTakes: clone(orphanTakes), ...extra }
  }
  const binFilesWithOnline = () => store.binFiles.map(withOnline)

  // ── Shot lists (0084) ──────────────────────────────────────────────────────
  // A trashed project hides its lists in the cloud (the SELECT hop to a LIVE
  // project), so every shot-list write treats it as absent.
  const liveProject = (id) => { const p = id ? projectOf(id) : null; return p && !p.deleted_at ? p : null }
  const listIn = (projectId, listId) => store.shotLists.find(l => l.id === listId && l.project_id === projectId) || null

  /**
   * Rule 8: deleting a scene or a shot takes its items out of EVERY list and
   * unlinks the tasks that pointed at it — what the cloud's FKs do (items
   * ON DELETE CASCADE, tasks SET NULL). Edits keep their items (D17: a deleted
   * shot shows as "Missing shot"), and assets.scene_ids / shot_ids are NOT
   * swept (arrays are not FKs; the cloud leaves them too).
   *
   * EVERY list includes ARCHIVED ones, on purpose: in the cloud this is the
   * FK's CASCADE (D3: one shared scene / shot row), which reaches every list.
   * Since round 2 an archived list's membership is writable anyway (R2-1),
   * so the undo of this delete can put the items back (listForItems below).
   */
  function sweepShotListLinks(column, id) {
    store.shotListItems = store.shotListItems.filter(i => i[column] !== id)
    for (const t of store.tasks) if (t[column] === id) { t[column] = null; t.updated_at = now() }
  }

  /**
   * The list a membership write names, or the 404. An ARCHIVED list is
   * returned like any other: replace, upsert, reorder and delete of its items
   * are allowed (review round 2, R2-1, reverting round 1's addendum B). The
   * freeze made "delete a scene, Ctrl+Z" drop the scene from every archived
   * list for good — the CASCADE took it out and the undo could not put it
   * back — and it guarded little, since under D8 the same writers may rewrite
   * the ACTIVE list. 0084's shot_list_items policies no longer freeze it
   * either. The PROVIDER still refuses the UI verbs on an archived list
   * (requireEditableShotList); undo and restore paths write through here.
   */
  function listForItems(projectId, listId) {
    const list = liveProject(projectId) ? listIn(projectId, listId) : null
    if (!list) throw missing('shot list not found')
    return list
  }

  /**
   * Validate a membership payload for one list and plan the rows it writes —
   * the part replace_shot_list_items() and upsert_shot_list_items() share
   * (0084 §10d / §10e). Nothing is written here, so any refusal leaves the
   * store as it was (all-or-nothing). A missing position is the item's index
   * (COALESCE(position, ord - 1)). An id that belongs to ANOTHER list's item
   * is dropped from the plan — not written, not returned — which is the
   * database's ON CONFLICT (id) DO UPDATE ... WHERE same list; the item is
   * still validated first, in the Local Server's order.
   */
  function planItemWrites(projectId, listId, items) {
    if (!Array.isArray(items)) throw invalid(ITEM.notArray)
    const sceneIds = new Set(store.scenes.filter(s => s.project_id === projectId).map(s => s.id))
    const shotIds = new Set(store.shots.filter(s => s.project_id === projectId).map(s => s.id))
    const elsewhere = new Set(store.shotListItems.filter(r => r.shot_list_id !== listId).map(r => r.id))
    const seenIds = new Set()
    const planned = []
    items.forEach((it, i) => {
      if (!isPlainObject(it)) throw invalid(ITEM.shape)
      const scene_id = present(it.scene_id) ? String(it.scene_id) : null
      const shot_id = present(it.shot_id) ? String(it.shot_id) : null
      if ((scene_id === null) === (shot_id === null)) throw invalid(ITEM.shape)
      if (scene_id ? !sceneIds.has(scene_id) : !shotIds.has(shot_id)) throw invalid(ITEM.foreign)
      const position = it.position != null ? it.position : i
      if (!Number.isInteger(position) || position < 0) throw invalid(ITEM.position)
      const id = present(it.id) ? String(it.id) : null
      if (id && elsewhere.has(id)) return
      if (id) {
        // Not in the contract's list: the database answers two rows with one
        // id with "ON CONFLICT DO UPDATE command cannot affect row a second
        // time", so it is refused here by name rather than keeping the last.
        if (seenIds.has(id)) throw invalid(ITEM.idTwice)
        seenIds.add(id)
      }
      planned.push({ id, scene_id, shot_id, position })
    })
    return planned
  }

  /** 0084's two partial unique indexes: a list holds each scene and each shot once. */
  function assertEachOnce(rows) {
    const seen = new Set()
    for (const r of rows) {
      const key = r.scene_id ? `scene:${r.scene_id}` : `shot:${r.shot_id}`
      if (seen.has(key)) throw conflict(ITEM.once)
      seen.add(key)
    }
  }

  /**
   * Planned rows to stored rows. An id of THIS list keeps its row (created_at
   * kept, updated_at bumped as fn_audit_touch bumps it on the ON CONFLICT
   * update); an unknown id is inserted with that id; no id mints one.
   */
  function materialiseItems(list, planned) {
    const at = now()
    const own = new Map(store.shotListItems.filter(r => r.shot_list_id === list.id).map(r => [r.id, r]))
    return planned.map(({ id, ...fields }) => {
      const kept = id ? own.get(id) : null
      return kept
        ? { ...kept, ...fields, updated_at: at, updated_by: by }
        : {
          id: id || newId(), shot_list_id: list.id, project_id: list.project_id,
          workspace_id: list.workspace_id ?? workspaceId, ...fields,
          created_at: at, created_by: by, updated_at: at, updated_by: by,
        }
    })
  }

  /**
   * archive_shot_list() / archive_edit(): archived=true keeps an existing
   * archived_at / archived_by (idempotent) or stamps now and the caller;
   * false clears both. A call that changes nothing writes nothing and hands
   * the row back unchanged (0084 §10b's "no-op").
   */
  function setArchived(list, row, on) {
    const archived_at = on ? (row.archived_at ?? now()) : null
    const archived_by = on ? (row.archived_by ?? by) : null
    if (archived_at === (row.archived_at ?? null) && archived_by === (row.archived_by ?? null)) return row
    return patch(list, row.id, { archived_at, archived_by, updated_by: by })
  }

  const adapter = {
    mode: 'fixtures',

    async status() {
      return { online: true, lastSyncAt: new Date(), error: null }
    },

    // ── Projects ─────────────────────────────────────────────────────────────
    async listProjects() {
      return clone(live(store.projects))
    },
    async loadProject(projectId) {
      const project = projectOf(projectId)
      if (!project || project.deleted_at) throw notFound(projectId)
      const inProject = (list) => list.filter(r => r.project_id === projectId)
      const assetIds = new Set(inProject(store.assets).map(a => a.id))
      const taskIds = new Set(inProject(store.tasks).map(t => t.id))
      // 0090 (S5b): the set-aside rows split out exactly as the real loaders
      // split them (setAside.js), so the fake cloud hides what they hide.
      return clone(splitSetAside({
        project,
        phases: live(inProject(store.phases)).sort((a, b) => a.sort_order - b.sort_order),
        assets: live(inProject(store.assets)).sort((a, b) => a.sort_order - b.sort_order),
        tasks: live(inProject(store.tasks)),
        dependencies: store.dependencies.filter(d => !d.deleted_at),
        taskLinks: store.taskLinks.filter(l => taskIds.has(l.task_id)),
        files: readableFiles(live(inProject(store.files))),
        assetVersions: store.assetVersions.filter(v => assetIds.has(v.asset_id)),
        comments: live(store.comments),
        ingestionRuns: inProject(store.ingestionRuns),
        // 0037's money gate, as the cloud answers it: someone it refuses reads
        // zero bid versions (suite 91 proves it of the cloud; S5).
        budgetVersions: passesMoneyGate(projectId) ? inProject(store.budgetVersions) : [],
        expenses: inProject(store.expenses),
        scenes: inProject(store.scenes).sort((a, b) => a.sort_order - b.sort_order),
        shots: inProject(store.shots).sort((a, b) => a.sort_order - b.sort_order),
        levels: inProject(store.levels),
        experiences: inProject(store.experiences),
        folders: inProject(store.folders).sort((a, b) => a.path.localeCompare(b.path)),
        teamAssignments: inProject(store.projectMembers).map(m => ({
          project_id: m.project_id, member_id: m.user_id, project_role: m.project_role, project_title: m.project_title || '',
        })),
        managedFiles: [],
        projectTeam: [],
        // Trashed key dates stay out of the bundle, as both real adapters keep
        // them (0067's milestones_select; localServerAdapter's filter).
        milestones: live(inProject(store.milestones)).sort(byMilestoneDate),
        bins: inProject(store.bins),
        binFiles: binFilesWithOnline().filter(f => f.project_id === projectId),
        binRoots: inProject(store.binRoots),
        shotTakes: inProject(store.shotTakes),
        // BC1 (0091): the company's footage locations, every project of it.
        binLocations: clone(store.binLocations),
        // 0084 (S3a): the three bundle keys every adapter returns, in the
        // contract's order.
        shotLists: inProject(store.shotLists).sort(byCreated),
        shotListItems: inProject(store.shotListItems).sort(byPosition),
        edits: inProject(store.edits).sort(byCreated),
      }))
    },
    async createProject(payload) {
      const row = upsert(store.projects, stampBy({ workspace_id: workspaceId, status: 'draft', created_by: by, ...payload, id: payload.id || newId() }))
      return clone(row)
    },
    async updateProject(id, fields) {
      // Rule 7 (0084 §7b, trg_projects_active_shot_list_guard): the active
      // list moves only through setActiveShotList (D8: a project manager or a
      // workspace admin). Only a CHANGE is refused — a client that sends the
      // whole row back with the pointer unchanged passes — and so is clearing
      // a pointer to a list that no longer exists (the FK's own SET NULL).
      const stored = projectOf(id)
      if (stored && fields && fields.active_shot_list_id !== undefined) {
        const next = fields.active_shot_list_id || null
        const prev = stored.active_shot_list_id || null
        const clearsDangling = next === null && prev !== null && !store.shotLists.some(l => l.id === prev)
        if (next !== prev && !clearsDangling) throw forbidden(ACTIVE_LIST_ONLY)
      }
      // 0089 (S5): the OPEN bid version. A change is refused for anyone not
      // past the money gate (trg_projects_open_budget_version_guard); a
      // non-null pointer must name one of THIS project's versions (the
      // same-project FK). Unchanged passes; so does clearing a pointer whose
      // version is gone (the FK's own SET NULL).
      if (stored && fields && fields.open_budget_version_id !== undefined) {
        const next = fields.open_budget_version_id || null
        const prev = stored.open_budget_version_id || null
        const clearsDangling = next === null && prev !== null && !store.budgetVersions.some(v => v.id === prev)
        if (next !== prev && !clearsDangling) {
          if (!passesMoneyGate(id)) throw forbidden(OPEN_VERSION_ONLY)
          if (next !== null && !store.budgetVersions.some(v => v.id === next && v.project_id === id)) throw invalid(VERSION_NOT_HERE)
        }
      }
      // 0090 (S5b, S5-01): the budget's nine settings change only past the
      // money gate (trg_projects_budget_settings_guard). Unchanged passes (a
      // number compared as a number); so does the lock FK's own SET NULL.
      if (stored && fields && !passesMoneyGate(id)) {
        const same = (k) => {
          const a = stored[k] ?? null
          const b = fields[k] ?? null
          return (typeof a === 'number' || typeof b === 'number') && a !== null && b !== null ? Number(a) === Number(b) : a === b
        }
        for (const k of BUDGET_SETTINGS) {
          if (fields[k] === undefined || same(k)) continue
          const clearsDangling = k === 'budget_active_version_id' && fields[k] == null && stored[k] != null && !store.budgetVersions.some(v => v.id === stored[k])
          if (!clearsDangling) throw forbidden(BUDGET_SETTINGS_ONLY)
        }
      }
      return clone(patch(store.projects, id, stampBy(fields)))
    },
    async deleteProject(id) { softDelete(store.projects, id, by) },
    async restoreProject(id) { return restore(store.projects, id) },

    // ── Phases / assets / tasks ──────────────────────────────────────────────
    async listPhases(projectId) { return clone(live(store.phases.filter(p => p.project_id === projectId))) },
    async upsertPhase(phase) { return clone(upsert(store.phases, { workspace_id: workspaceId, ...unstamped(phase) })) },
    async patchPhase(id, fields) { return clone(patch(store.phases, id, unstamped(fields))) },
    async deletePhase(id) { trash(store.phases, id) },
    async restorePhase(id) { return restore(store.phases, id) },

    async listAssets(projectId) { return clone(live(store.assets.filter(a => a.project_id === projectId))) },
    async upsertAsset(asset) { return clone(upsert(store.assets, stampBy({ workspace_id: workspaceId, created_by: by, ...asset }))) },
    async patchAsset(id, fields) { return clone(patch(store.assets, id, stampBy(fields))) },
    async deleteAsset(id) { softDelete(store.assets, id, by) },
    async restoreAsset(id) { return restore(store.assets, id) },

    async listTasks(projectId) { return clone(live(store.tasks.filter(t => t.project_id === projectId))) },
    async upsertTask(task) { return clone(upsert(store.tasks, stampBy({ workspace_id: workspaceId, created_by: by, ...unstamped(task) }))) },
    async patchTask(id, fields) { return clone(patch(store.tasks, id, stampBy(unstamped(fields)))) },
    async deleteTask(id) { trash(store.tasks, id) },
    async restoreTask(id) { return restore(store.tasks, id) },

    // ── Dependencies and links ───────────────────────────────────────────────
    async upsertDependency(dep) {
      const kind = dep?.kind === 'phase' ? 'phase' : 'task'
      return clone(upsert(store.dependencies, { type: 'FS', lag_days: 0, created_by: by, ...dep, kind }))
    },
    async deleteDependency(id) { remove(store.dependencies, id) },
    async upsertTaskLink(link) { return clone(upsert(store.taskLinks, link)) },
    async deleteTaskLink(id) { remove(store.taskLinks, id) },

    // ── Files ────────────────────────────────────────────────────────────────
    async uploadFile() { throw devWriteRefused('Uploading a file') },
    async listFiles(projectId) { return clone(readableFiles(live(store.files.filter(f => f.project_id === projectId)))) },
    // There are no file bodies. A download is refused loudly (a data URI handed
    // to the anchor FileManager clicks would be a silent no-op — review round 1),
    // and fileUrl answers null, which the provider documents as "this backend
    // cannot mint a playable URL": the viewer says "preview unavailable", no toast.
    async downloadFile() { throw devWriteRefused('Downloading a file') },
    async downloadUrl() { throw devWriteRefused('Downloading a file') },
    async fileUrl() { return null },
    async thumbnailUrls(paths) {
      const out = new Map()
      for (const p of paths || []) { const u = store.thumbnails.get(p); if (u) out.set(p, u) }
      return out
    },
    async updateFile(id, fields) {
      // S4a (0085): the fake cloud refuses what the real CHECK refuses. A
      // value that is not a list never reaches a CHECK (Postgres cannot read
      // it as text[]); otherwise S4b's Legal CHECKs sort first (0088).
      if (fields && 'tags' in fields && !Array.isArray(fields.tags)) {
        throw new Error(`[fixtures] ${fileTagsRefusal(fields.tags)}`)
      }
      const before = findById(store.files, id)
      if (before) {
        // Refused as the CHECK would, and SAID as the cloud adapter says it
        // (fileTags.legalRefusalSentence — review round 1, R1-BEH-08).
        const refused = legalRefusal(before, { ...before, ...(fields || {}) })
        if (refused) throw new Error(`[fixtures] ${legalRefusalSentence(refused, fields)}`)
      }
      if (fields && 'tags' in fields) {
        const refused = fileTagsRefusal(fields.tags)
        if (refused) throw new Error(`[fixtures] ${refused}`)
      }
      return clone(patch(store.files, id, stampBy(fields)))
    },
    // S4a: the fake cloud has migration 0085.
    async supportsFileTags() { return true },
    // S4b: …and 0088 — the LEGAL folder is locked here. (Uploads are refused
    // in the fixtures, Legal or not: there are no bodies.)
    async supportsLegalFiles() { return true },
    async deleteFile(id) {
      softDelete(store.files, id, by)
      store.fileEvents.push({ id: newId(), file_id: id, project_id: findById(store.files, id)?.project_id ?? null, event: 'trashed', actor_id: by, actor_name: 'You', detail: {}, created_at: now() })
    },
    async restoreFile(id) {
      const ok = restore(store.files, id)
      if (ok) store.fileEvents.push({ id: newId(), file_id: id, project_id: findById(store.files, id)?.project_id ?? null, event: 'restored', actor_id: by, actor_name: 'You', detail: {}, created_at: now() })
      return ok
    },
    async listFileEvents(fileId) {
      // S4b: a money file's history is the money gate's, like its row (0074,
      // 0088's certificate arm for Legal). S4d (0092, Audrey's Legal 1): a
      // Legal file's history — its deletion record included — is the Legal
      // audience's, an invoice's the money audience's; a member or reviewer
      // reads neither. (The fake cloud never carried ruling 22's purged
      // exception; it now matches the real one.)
      const f = findById(store.files, fileId)
      if (f && isMoneyFile(f) && !passesMoneyGate(f.project_id) && !(isLegalRow(f) && passesLegalGate(f.project_id))) return []
      return clone(store.fileEvents.filter(e => e.file_id === fileId).sort((a, b) => b.created_at.localeCompare(a.created_at)))
    },
    // GW1 (0093): one clip's viewings from outside the office, as the cloud
    // answers a LIVE workspace admin (and nobody else: file_events_select).
    // The rows are the gateway fixture's (gatewayFixtures.js seeds them into
    // the store), so Settings' table and the inspector's line agree.
    async remoteViewsOfClip(binFileId) {
      if (appRole !== 'admin') return { count: 0, last: null }
      const rows = (store.gatewayViewings || []).filter(v => v.file_id === binFileId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
      return { count: rows.length, last: rows[0] ? { actor_label: rows[0].actor_label, created_at: rows[0].created_at } : null }
    },
    // S4a (E13): the cloud's log_file_downloaded, as an event the activity
    // drawer can show. No bytes exist here, so nothing calls it today (the
    // fixtures mint no preview URL); it is the contract, kept whole.
    async logFileDownloaded(file) {
      if (!file?.id) return false
      store.fileEvents.push({ id: newId(), file_id: file.id, project_id: findById(store.files, file.id)?.project_id ?? null, event: 'downloaded', actor_id: by, actor_name: 'You', detail: {}, created_at: now() })
      return true
    },

    // ── Versions, comments, history ─────────────────────────────────────────
    async upsertAssetVersion(version) { return clone(upsert(store.assetVersions, version)) },
    async listAssetVersions(assetId) { return clone(store.assetVersions.filter(v => v.asset_id === assetId)) },
    async createComment(comment) {
      const author = store.members.find(m => m.user_id === by)
      return clone(upsert(store.comments, { author_name: author?.display_name ?? 'You', author_user_id: by, ...comment }))
    },
    async listComments(entityType, entityId) {
      return clone(live(store.comments.filter(c => c.entity_type === entityType && c.entity_id === entityId)))
    },
    async deleteComment(id) { softDelete(store.comments, id, by) },
    async restoreComment(id) { return restore(store.comments, id) },
    async listEditHistory(entityType, entityId) {
      return clone(store.editHistory.filter(h => h.entity_type === entityType && h.entity_id === entityId))
    },

    // ── Roster ───────────────────────────────────────────────────────────────
    async listProjectMembers(projectId) { return clone(store.projectMembers.filter(m => m.project_id === projectId)) },
    async upsertProjectMember({ project_id, user_id, project_role }) {
      const i = store.projectMembers.findIndex(m => m.project_id === project_id && m.user_id === user_id)
      const member = store.members.find(m => m.user_id === user_id)
      if (i === -1) {
        const row = { project_id, user_id, workspace_id: workspaceId, project_role, project_title: member?.title ?? '', created_at: now(), created_by: by, updated_at: now(), updated_by: by }
        store.projectMembers.push(row)
        return clone(row)
      }
      store.projectMembers[i] = { ...store.projectMembers[i], project_role, updated_at: now(), updated_by: by }
      return clone(store.projectMembers[i])
    },
    async removeProjectMember(projectId, userId) {
      store.projectMembers = store.projectMembers.filter(m => !(m.project_id === projectId && m.user_id === userId))
    },
    async updateProjectMemberTitle(projectId, userId, projectTitle) {
      const i = store.projectMembers.findIndex(m => m.project_id === projectId && m.user_id === userId)
      if (i === -1) throw notFound(userId)
      store.projectMembers[i] = { ...store.projectMembers[i], project_title: projectTitle, updated_at: now(), updated_by: by }
      return clone(store.projectMembers[i])
    },

    // ── Dashboard ────────────────────────────────────────────────────────────
    async listMyTasks() {
      return clone(live(store.tasks).filter(t => !isSetAside(t))
        .filter(t => t.assignee_id === by || t.reviewer_id === by)
        .map(t => {
          const p = projectOf(t.project_id)
          const a = findById(store.assets, t.asset_id)
          return {
            ...t,
            project: p ? { id: p.id, title: p.title, status: p.status } : null,
            asset: a ? { id: a.id, name: a.name, phase_id: a.phase_id } : null,
          }
        }))
    },
    async listPhasesByProjects(projectIds) {
      const ids = new Set(projectIds || [])
      return clone(live(store.phases.filter(p => ids.has(p.project_id))).filter(p => !isSetAside(p)))
    },
    async listProjectMembersByProjects(projectIds) {
      const ids = new Set(projectIds || [])
      return clone(store.projectMembers.filter(m => ids.has(m.project_id)))
    },

    // ── Notes ────────────────────────────────────────────────────────────────
    async listNotes() {
      return clone(store.notes
        .map(({ ydoc_state, ...n }) => n)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)))
    },
    async getNote(id) { const n = findById(store.notes, id); return n ? clone(n) : null },
    async createNote(fields = {}) {
      return clone(upsert(store.notes, { workspace_id: workspaceId, owner_id: by, title: '', subject: null, note_date: null, ydoc_state: null, body_preview: '', version: 0, created_by: by, ...fields, updated_by: by }))
    },
    async patchNote(id, fields) {
      const { ydoc_state, version, ...safe } = fields || {}
      return clone(patch(store.notes, id, { ...safe, updated_by: by }))
    },
    async saveNoteDoc(id, { ydocState, bodyPreview, expectedVersion }) {
      const n = findById(store.notes, id)
      if (!n) throw notFound(id)
      if (n.version !== expectedVersion) return null
      return clone(patch(store.notes, id, { ydoc_state: ydocState, body_preview: bodyPreview ?? n.body_preview, version: n.version + 1, updated_by: by }))
    },
    async deleteNote(id) { remove(store.notes, id) },
    async listNoteSubjects() {
      return clone([...store.noteSubjects].sort((a, b) => (a.position - b.position) || a.label.localeCompare(b.label)))
    },
    async createNoteSubject({ label, position = 0 }) {
      return clone(upsert(store.noteSubjects, { workspace_id: workspaceId, owner_id: by, label, position, created_by: by, updated_by: by }))
    },
    async patchNoteSubject(id, fields) { return clone(patch(store.noteSubjects, id, fields)) },
    async retagNoteSubject(oldLabel, newLabel) {
      const ids = []
      for (const n of store.notes) if (n.subject === oldLabel) { n.subject = newLabel; n.updated_at = now(); ids.push(n.id) }
      return ids
    },
    async deleteNoteSubject(id) { remove(store.noteSubjects, id) },

    // ── Ingestion ────────────────────────────────────────────────────────────
    async createIngestionRun(run) { return clone(upsert(store.ingestionRuns, { workspace_id: workspaceId, created_by: by, ...run })) },
    async updateIngestionRun(runId, fields) { return clone(patch(store.ingestionRuns, runId, fields)) },
    async listIngestionChunks(runId) { return clone(store.ingestionChunks.filter(c => c.run_id === runId)) },
    async upsertIngestionChunk(chunk) { return clone(upsert(store.ingestionChunks, chunk)) },
    async updateChunk(chunk) { patch(store.ingestionChunks, chunk.id, chunk) },

    // ── Rate cards ───────────────────────────────────────────────────────────
    async listRateCards(wsId) { return clone(live(store.rateCards.filter(c => c.workspace_id === wsId))) },
    async upsertRateCard(card) { return clone(upsert(store.rateCards, { workspace_id: workspaceId, is_default: false, ...card })) },
    async deleteRateCard(id) { softDelete(store.rateCards, id, by) },
    async restoreRateCard(id) { return restore(store.rateCards, id) },
    async listRateCardEntries(rateCardId) { return clone(store.rateCardEntries.filter(e => e.rate_card_id === rateCardId)) },
    async upsertRateCardEntry(entry) { return clone(upsert(store.rateCardEntries, { currency: 'USD', ...entry })) },
    async deleteRateCardEntry(id) { remove(store.rateCardEntries, id) },

    // ── Task templates ───────────────────────────────────────────────────────
    async listTaskTemplates(wsId) {
      return clone(store.taskTemplates.filter(t => t.workspace_id === wsId).sort((a, b) => a.name.localeCompare(b.name)))
    },
    async listProjectTaskTemplates(projectId) {
      return clone(store.taskTemplates.filter(t => !t.project_id || t.project_id === projectId).sort((a, b) => a.name.localeCompare(b.name)))
    },
    async upsertTaskTemplate(template) { return clone(upsert(store.taskTemplates, { workspace_id: workspaceId, created_by: by, ...template, updated_by: by })) },
    async updateTaskTemplate(id, fields) { return clone(patch(store.taskTemplates, id, { ...fields, updated_by: by })) },
    async deleteTaskTemplate(id) { remove(store.taskTemplates, id) },

    // ── Team (the cloud mapping of the workspace directory) ──────────────────
    async listTeamMembers() {
      return clone(store.members.filter(m => m.is_active !== false).map(m => ({
        id: m.user_id, user_id: m.user_id,
        name: m.display_name || m.username || '(unnamed)',
        username: m.username, title: m.title || '', department: m.department || '',
        avatar_url: m.avatar_url || null, email: m.email || null, app_role: m.app_role,
        employment_type: 'fulltime',
      })))
    },

    // ── Budget ───────────────────────────────────────────────────────────────
    async listBudgetLines(projectId) { return clone(store.budgetLines.filter(l => l.project_id === projectId).sort((a, b) => a.sort_order - b.sort_order)) },
    async upsertBudgetLine(line) { return clone(upsert(store.budgetLines, { workspace_id: workspaceId, created_by: by, ...line, updated_by: by })) },
    async updateBudgetLine(id, _projectId, fields) { return clone(patch(store.budgetLines, id, { ...fields, updated_by: by })) },
    async deleteBudgetLine(id) { remove(store.budgetLines, id) },
    async listBudgetActuals(projectId) { return clone(store.budgetActuals.filter(a => a.project_id === projectId)) },
    async upsertBudgetActual(actual) { return clone(upsert(store.budgetActuals, { workspace_id: workspaceId, created_by: by, ...actual, updated_by: by })) },
    async updateBudgetActual(id, _projectId, fields) { return clone(patch(store.budgetActuals, id, { ...fields, updated_by: by })) },
    async deleteBudgetActual(id) { remove(store.budgetActuals, id) },
    async listBudgetVersions(projectId) { return clone(store.budgetVersions.filter(v => v.project_id === projectId)) },
    async upsertBudgetVersion(version) {
      if (version?.is_active) for (const v of store.budgetVersions) if (v.project_id === version.project_id) v.is_active = false
      return clone(upsert(store.budgetVersions, { workspace_id: workspaceId, created_by: by, ...version, updated_by: by }))
    },
    // Post-overhaul S5: the cloud's UPDATE of only the named columns, under
    // the money gate (an UPDATE it refuses returns no row: the 42501 here).
    async patchBudgetVersion(projectId, id, fields) {
      const row = store.budgetVersions.find(v => v.id === id && v.project_id === projectId)
      if (!row || !passesMoneyGate(projectId)) throw forbidden('you cannot change this bid version')
      const { id: _i, project_id: _p, workspace_id: _w, created_at: _c, created_by: _cb, ...rest } = fields || {}
      return clone(patch(store.budgetVersions, id, { ...rest, updated_by: by, updated_at: now() }))
    },
    // 0089 §4, select_budget_version: one write, every other version cleared;
    // null clears them all (F13).
    async selectBudgetVersion(projectId, versionId) {
      if (!passesMoneyGate(projectId)) throw forbidden(SELECTED_BID_ONLY)
      const target = versionId || null
      if (target && !store.budgetVersions.some(v => v.id === target && v.project_id === projectId)) throw missing(VERSION_NOT_HERE)
      for (const v of store.budgetVersions) {
        if (v.project_id !== projectId) continue
        const want = v.id === target
        if (!!v.is_active !== want) { v.is_active = want; v.updated_at = now(); v.updated_by = by }
      }
      return target
    },
    // 0090 §3, set_aside_schedule_rows: the named tasks, phases and key dates
    // of one project set aside (on) or brought back, in one write. Trashed
    // rows, rows of another project and rows already in the asked state are
    // untouched (an earlier stamp is kept). Past the money gate only.
    async setAsideRows(projectId, { on, tasks = [], phases = [], milestones = [] } = {}) {
      if (!passesMoneyGate(projectId)) throw forbidden(SET_ASIDE_ONLY)
      const at = on ? now() : null
      const counts = { tasks: 0, phases: 0, milestones: 0 }
      for (const [kind, list, ids] of [['tasks', store.tasks, tasks], ['phases', store.phases, phases], ['milestones', store.milestones, milestones]]) {
        const want = new Set((ids || []).map(String))
        for (const r of list) {
          if (r.project_id !== projectId || !want.has(String(r.id)) || r.deleted_at) continue
          if (on ? r.set_aside_at : !r.set_aside_at) continue
          if (on) r.set_aside_at = at
          else delete r.set_aside_at
          counts[kind] += 1
        }
      }
      return { set_aside_at: at, ...counts }
    },
    // The FKs' ON DELETE SET NULL: the project's locked (0037) and open
    // (0089) pointers to the deleted version are cleared with it.
    async deleteBudgetVersion(id) {
      const row = store.budgetVersions.find(v => v.id === id)
      remove(store.budgetVersions, id)
      const project = row ? projectOf(row.project_id) : null
      if (project) {
        if (project.budget_active_version_id === id) project.budget_active_version_id = null
        if (project.open_budget_version_id === id) project.open_budget_version_id = null
      }
    },
    async listExpenses(projectId) { return clone(store.expenses.filter(e => e.project_id === projectId)) },
    async upsertExpense(expense) { return clone(upsert(store.expenses, { workspace_id: workspaceId, created_by: by, asset_ids: [], phase_ids: [], task_ids: [], file_ids: [], ...expense, updated_by: by })) },
    async updateExpense(id, _projectId, fields) { return clone(patch(store.expenses, id, { ...fields, updated_by: by })) },
    async deleteExpense(id) { remove(store.expenses, id) },
    async listProjectRateOverrides(projectId) { return clone(store.rateOverrides.filter(o => o.project_id === projectId)) },
    async upsertProjectRateOverride(override) { return clone(upsert(store.rateOverrides, { workspace_id: workspaceId, created_by: by, ...override, updated_by: by })) },
    async deleteProjectRateOverride(id) { remove(store.rateOverrides, id) },

    // ── Scenes, shots, levels, experiences ───────────────────────────────────
    async listScenes(projectId) { return clone(store.scenes.filter(s => s.project_id === projectId)) },
    async upsertScene(scene) { return clone(upsert(store.scenes, { workspace_id: workspaceId, created_by: by, ...scene, updated_by: by })) },
    // Hard deletes, as in the cloud; rule 8's sweep runs with each (above).
    //
    // A scene takes its SHOTS with it (review round 1, addendum C). In the
    // cloud 0040's shots.scene_id is ON DELETE CASCADE, so every shot of the
    // scene goes in the same statement and each shot's own FK actions follow:
    // its items leave every list, archived ones included, and its tasks lose
    // their shot_id. Keeping the shots here (as the fixtures did until R1)
    // left a shot with a dangling scene_id still listed in other lists, a
    // state the cloud cannot hold — and a walkthrough on the fixtures could
    // never show the stale item a cloud list write would then trip over.
    async deleteScene(id, _projectId) {
      const shotIds = store.shots.filter(s => s.scene_id === id).map(s => s.id)
      remove(store.scenes, id)
      sweepShotListLinks('scene_id', id)
      for (const shotId of shotIds) {
        remove(store.shots, shotId)
        sweepShotListLinks('shot_id', shotId)
      }
    },
    async listShots(projectId) { return clone(store.shots.filter(s => s.project_id === projectId)) },
    async upsertShot(shot) { return clone(upsert(store.shots, { workspace_id: workspaceId, created_by: by, ...shot, updated_by: by })) },
    // BC2: a shot's takes go with it, as 0091's shot_takes_shot_fk CASCADE
    // takes them on the cloud (the provider's undo puts them back).
    async deleteShot(id, _projectId) { remove(store.shots, id); sweepShotListLinks('shot_id', id); store.shotTakes = store.shotTakes.filter(t => t.shot_id !== id) },
    async listLevels(projectId) { return clone(store.levels.filter(s => s.project_id === projectId)) },
    async upsertLevel(level) { return clone(upsert(store.levels, { workspace_id: workspaceId, created_by: by, ...level, updated_by: by })) },
    async deleteLevel(id) { remove(store.levels, id) },
    async listExperiences(projectId) { return clone(store.experiences.filter(s => s.project_id === projectId)) },
    async upsertExperience(exp) { return clone(upsert(store.experiences, { workspace_id: workspaceId, created_by: by, ...exp, updated_by: by })) },
    async deleteExperience(id) { remove(store.experiences, id) },

    // ── Shot lists, items, edits (0084; the S3a contract's nine methods plus
    //    round 1's two membership deltas and round 2's reorder) ──────────────
    // Same names, signatures, rules and refusal texts as the Supabase and
    // Local Server adapters. There is no delete of a list or an edit: they
    // are archived, never deleted (D4/D18). No role check here — the fixtures
    // sign in as Mara, a workspace admin, who may do everything D8 allows.
    //
    // Where one input breaks several rules, the refusal is the one the
    // database reaches first: on an UPDATE the guard trigger (moves, the
    // chain position, archive columns, a frozen archived row), then the CHECK
    // constraints (title, version, snapshot / items shape, own parent), then
    // the unique keys in their creation order ((title, version), then an
    // edit's one child and one root), then the foreign keys (list and parent
    // in this project). A membership write answers "not found" before it
    // looks at the payload; an archived list is no refusal there (R2-1).
    async listShotLists(projectId) {
      return clone(store.shotLists.filter(l => l.project_id === projectId).sort(byCreated))
    },

    async upsertShotList(list) {
      const body = clone(withoutUndefined(list))
      if (!body.project_id) throw invalid('A shot list needs a project.')
      const project = liveProject(body.project_id)
      if (!project) throw notFound(body.project_id)
      const stored = body.id ? findById(store.shotLists, body.id) : null
      if (stored) {
        if (stored.project_id !== body.project_id) throw forbidden('a shot_lists row cannot move to another project')
        guardArchived(body, stored, { archiveOnly: LIST_ARCHIVE_ONLY, frozen: LIST_FROZEN })
      } else if (body.archived_at || body.archived_by) {
        throw forbidden(LIST_ARCHIVE_ONLY)
      }
      const row = stored
        ? { ...stored, ...body }
        : { version: 1, summary: null, snapshot: {}, archived_at: null, archived_by: null, ...body }
      validateVersioned(row, 'A shot list')
      if ('snapshot' in body && !isPlainObject(body.snapshot)) throw invalid("A shot list's snapshot must be an object.")
      // Stored TRIMMED (review round 1, addendum D; 0084's guard does
      // NEW.title := btrim(NEW.title)), so "Main" and "Main " are one title
      // and the (title, version) key compares what is actually stored.
      row.title = row.title.trim()
      const clash = store.shotLists.find(l => l.project_id === row.project_id && l.id !== row.id
        && String(l.title || '').trim() === row.title && Number(l.version) === row.version)
      if (clash) throw conflict(`There is already a shot list called "${versionedLabel(clash)}".`)
      return clone(upsert(store.shotLists, stored
        ? { ...row, updated_by: by }
        : { ...row, workspace_id: project.workspace_id ?? workspaceId, created_by: by, updated_by: by }))
    },

    /**
     * Post-overhaul S3b: change ONLY the named columns of a stored list — the
     * cloud's UPDATE, the Local Server's partial POST. Every rule of the
     * upsert above applies (it is the upsert, given the stored row's id and
     * project), but a list this project does not hold is not found here,
     * never a new one; the row's identity comes from the arguments.
     */
    async patchShotList(projectId, listId, patch) {
      if (!listIn(projectId, listId)) throw missing('shot list not found')
      const { id: _id, project_id: _project, workspace_id: _workspace, ...cols } = patch || {}
      return adapter.upsertShotList({ ...cols, id: listId, project_id: projectId })
    },

    async listShotListItems(projectId) {
      return clone(store.shotListItems.filter(i => i.project_id === projectId).sort(byPosition))
    },

    /**
     * Replace ONE list's whole membership (replace_shot_list_items(), 0084
     * §10d) — tooling and bulk restores only; the provider writes deltas
     * (below), because a whole set from one client's stale view deletes a
     * collaborator's newer items (review round 1, addendum A). Everything is
     * validated before anything is written (planItemWrites). Items of this
     * list that are not named are deleted. An archived list is written like
     * any other (R2-1: a bulk restore must reach it).
     */
    async replaceShotListItems(projectId, listId, items) {
      const list = listForItems(projectId, listId)
      const planned = planItemWrites(projectId, listId, items)
      assertEachOnce(planned)
      const next = materialiseItems(list, planned)
      store.shotListItems = [...store.shotListItems.filter(r => r.shot_list_id !== listId), ...next]
      return clone([...next].sort(byPosition))
    },

    /**
     * The membership DELTA write (upsert_shot_list_items(), 0084 §10e; review
     * round 1, addendum A): insert the given rows and update the given rows of
     * THIS list, and touch nothing else — no unnamed item is ever deleted, so
     * an add from a stale view cannot remove what a collaborator added since.
     * An unknown id IS inserted, which is why a reorder does not come through
     * here (repositionShotListItems below, R2-2). An id of another list is
     * skipped. Validation is the
     * replace's, and the list AFTER the write must still hold each scene and
     * shot once: the unnamed rows are counted with the written ones (a row
     * re-sent with its own scene is not a duplicate of itself). Returns the
     * rows written, in the order given (the RPC's RETURNING); skipped ones
     * are absent.
     */
    async upsertShotListItems(projectId, listId, items) {
      const list = listForItems(projectId, listId)
      const planned = planItemWrites(projectId, listId, items)
      const named = new Set(planned.map(p => p.id).filter(Boolean))
      assertEachOnce([
        ...store.shotListItems.filter(r => r.shot_list_id === listId && !named.has(r.id)),
        ...planned,
      ])
      const written = materialiseItems(list, planned)
      const writtenIds = new Set(written.map(r => r.id))
      store.shotListItems = [...store.shotListItems.filter(r => !writtenIds.has(r.id)), ...written]
      return clone(written)
    },

    /**
     * The REORDER write (upsert_shot_list_items(p_list, p_items,
     * p_positions_only => true), 0084 §10e; review round 2, R2-2): set
     * `position` on rows that EXIST in THIS list and change nothing else.
     * Why not the upsert: planReorderList re-numbers the whole group from this
     * client's cached view, so the rows it sends can include an item a
     * collaborator has removed since — and an upsert re-inserted it, silently
     * undoing their removal (r2 sql2#1, provider2#2, parity2#0; the same for
     * a reorder's undo and redo). So an id that is unknown, or belongs to
     * another list, is SKIPPED, never inserted. scene_id / shot_id in the
     * payload are ignored (the provider sends whole rows).
     *
     * Validated before anything is written, in payload order, with the Local
     * Server's and the cloud adapter's words and order (electron/
     * rabbitShotLists.cjs planRepositions; the cloud adapter checks the same
     * before its request, because the SQL's positions-only arm is silent): the
     * 404, the array, then per item its id, its position — REQUIRED here,
     * unlike the upsert's "missing = its index": a move with no destination
     * is a malformed request — and an id named twice, skipped or not (the
     * SQL's UPDATE ... FROM would apply one of the two unpredictably). An
     * archived list is moved like any other (R2-1). Each row written gets
     * updated_at / updated_by, as fn_audit_touch stamps every UPDATE, even
     * one that leaves the position as it was. Returns the rows updated, in
     * the order given; skipped ids are absent.
     */
    async repositionShotListItems(projectId, listId, items) {
      const list = listForItems(projectId, listId)
      if (!Array.isArray(items)) throw invalid(ITEM.notArray)
      const own = new Map(store.shotListItems.filter(r => r.shot_list_id === list.id).map(r => [r.id, r]))
      const seen = new Set()
      const moves = new Map()
      for (const it of items) {
        if (!isPlainObject(it) || !present(it.id)) throw invalid(ITEM.repositionId)
        if (!Number.isInteger(it.position) || it.position < 0) throw invalid(ITEM.position)
        const id = String(it.id)
        if (seen.has(id)) throw invalid(ITEM.idTwice)
        seen.add(id)
        if (own.has(id)) moves.set(id, it.position)
      }
      const at = now()
      const updated = [...moves].map(([id, position]) => ({ ...own.get(id), position, updated_at: at, updated_by: by }))
      const byId = new Map(updated.map(r => [r.id, r]))
      store.shotListItems = store.shotListItems.map(r => byId.get(r.id) || r)
      return clone(updated)
    },

    /**
     * Remove exactly the named items of THIS list (the cloud's plain DELETE
     * ... WHERE shot_list_id = list AND id IN (...); review round 1, addendum
     * A). An id that is not one of this list's items — unknown, or another
     * list's — is ignored, never an error. Returns { deleted: [ids actually
     * deleted] }, in the order given, each once.
     */
    async deleteShotListItems(projectId, listId, itemIds) {
      listForItems(projectId, listId)
      if (!Array.isArray(itemIds)) throw invalid(ITEM.idsNotArray)
      const own = new Set(store.shotListItems.filter(r => r.shot_list_id === listId).map(r => r.id))
      const deleted = [...new Set(itemIds.filter(present).map(String))].filter(id => own.has(id))
      const gone = new Set(deleted)
      store.shotListItems = store.shotListItems.filter(r => !gone.has(r.id))
      return { deleted }
    },

    async listEdits(projectId) {
      return clone(store.edits.filter(e => e.project_id === projectId).sort(byCreated))
    },

    async upsertEdit(edit) {
      const body = clone(withoutUndefined(edit))
      if (!body.project_id) throw invalid('An edit needs a project.')
      const project = liveProject(body.project_id)
      if (!project) throw notFound(body.project_id)
      const stored = body.id ? findById(store.edits, body.id) : null
      if (stored) {
        if (stored.project_id !== body.project_id) throw forbidden('a edits row cannot move to another project')
        if ('shot_list_id' in body && body.shot_list_id !== stored.shot_list_id) {
          throw forbidden('an edit cannot move to another shot list')
        }
        // D6 (review round 1, addendum E; 0084 §7a): an edit's place in its
        // chain is fixed when it is made — its parent already exists then —
        // which is what makes a cycle impossible. Only a CHANGE is refused:
        // the whole row re-sent with its own parent passes.
        if ('parent_edit_id' in body && (body.parent_edit_id || null) !== (stored.parent_edit_id || null)) {
          throw forbidden(CHAIN_FIXED)
        }
        guardArchived(body, stored, { archiveOnly: EDIT_ARCHIVE_ONLY, frozen: EDIT_FROZEN })
      } else if (body.archived_at || body.archived_by) {
        throw forbidden(EDIT_ARCHIVE_ONLY)
      }
      const row = stored
        ? { ...stored, ...body }
        : { version: 1, summary: null, parent_edit_id: null, items: [], snapshot: null, archived_at: null, archived_by: null, ...body }
      validateVersioned(row, 'An edit')
      if (!Array.isArray(row.items)) throw invalid("An edit's items must be a list.")
      if (row.snapshot != null && !isPlainObject(row.snapshot)) throw invalid("An edit's snapshot must be an object.")
      const badParent = "an edit's parent must be another edit of the same shot list"
      if (row.parent_edit_id && row.parent_edit_id === row.id) throw invalid(badParent) // edits_not_own_parent_chk
      row.title = row.title.trim() // stored trimmed (addendum D), as for lists
      const clash = store.edits.find(e => e.project_id === row.project_id && e.shot_list_id === row.shot_list_id
        && e.id !== row.id && String(e.title || '').trim() === row.title && Number(e.version) === row.version)
      if (clash) throw conflict(`This shot list already has an edit called "${versionedLabel(clash)}".`)
      // D6, one linear chain per list (addendum E; 0084 §5's two partial
      // unique indexes, archived edits included): no edit has two children,
      // and a list has one root. A new edit continues from the LATEST one.
      // The child index is not per list, exactly as in 0084.
      const parentId = row.parent_edit_id || null
      if (parentId && store.edits.some(e => e.id !== row.id && e.parent_edit_id === parentId)) {
        throw conflict(CHAIN_ONE_CHILD)
      }
      if (!parentId && store.edits.some(e => e.id !== row.id && e.shot_list_id === row.shot_list_id && !e.parent_edit_id)) {
        throw conflict(CHAIN_ONE_ROOT)
      }
      if (!row.shot_list_id || !listIn(row.project_id, row.shot_list_id)) {
        throw invalid('an edit belongs to a shot list of this project')
      }
      if (row.parent_edit_id) {
        // edits_parent_same_list_fk: the parent is an edit of the SAME list (D6's one linear chain).
        const parent = findById(store.edits, row.parent_edit_id)
        if (!parent || parent.shot_list_id !== row.shot_list_id) throw invalid(badParent)
      }
      return clone(upsert(store.edits, stored
        ? { ...row, updated_by: by }
        : { ...row, workspace_id: project.workspace_id ?? workspaceId, created_by: by, updated_by: by }))
    },

    /** set_active_shot_list(): null clears (no active list = every scene and shot, D10). */
    async setActiveShotList(projectId, listId) {
      if (!liveProject(projectId)) throw missing('project not found')
      const next = listId || null
      if (next) {
        const list = listIn(projectId, next)
        if (!list) throw missing('shot list not found in this project')
        if (list.archived_at) throw conflict('an archived shot list cannot be made active — restore it first')
      }
      patch(store.projects, projectId, stampBy({ active_shot_list_id: next }))
      return next
    },

    async archiveShotList(projectId, listId, archived = true) {
      const project = liveProject(projectId)
      const list = project ? listIn(projectId, listId) : null
      if (!list) throw missing('shot list not found')
      const on = archived == null ? true : Boolean(archived) // COALESCE(p_archived, true)
      if (on && project.active_shot_list_id === listId) {
        throw conflict('the active shot list cannot be archived — make another list active first')
      }
      return clone(setArchived(store.shotLists, list, on))
    },

    async archiveEdit(projectId, editId, archived = true) {
      const edit = liveProject(projectId) ? store.edits.find(e => e.id === editId && e.project_id === projectId) : null
      if (!edit) throw missing('edit not found')
      const on = archived == null ? true : Boolean(archived)
      return clone(setArchived(store.edits, edit, on))
    },

    // ── Folders and the project mirror ───────────────────────────────────────
    async listFolders(projectId) {
      return clone(store.folders.filter(f => f.project_id === projectId).sort((a, b) => a.path.localeCompare(b.path)))
    },
    async ensureProjectFolders(projectId, project) {
      for (const planned of planProjectFolders(project || projectOf(projectId))) materialiseFolder(projectId, planned)
      return adapter.listFolders(projectId)
    },
    // S4c: a shot's folder nests in its scene's (the scene found in the
    // store, the scene's folder ensured first); an existing folder keeps
    // its parent — the cloud adapter's rule, so the fake cloud re-files a
    // project exactly as the real one does.
    async ensureEntityFolder(projectId, project, entityType, entity) {
      const scene = entityType === 'shot' && entity?.scene_id ? (store.scenes.find(s => s.id === entity.scene_id) || null) : null
      const planned = planEntityFolder(project || projectOf(projectId), entityType, entity, scene)
      if (!planned) return null
      const fk = ENTITY_FK_COLUMN[entityType]
      const mine = store.folders.find(f => f.project_id === projectId && f[fk] && f[fk] === entity?.id)
      if (mine) {
        const parent = mine.parent_id ? store.folders.find(f => f.id === mine.parent_id) : null
        const keptPath = parent ? `${parent.path ? parent.path + '/' : ''}${planned.folder.slug}` : planned.folder.path
        if (mine.path !== keptPath) {
          mine.slug = planned.folder.slug; mine.path = keptPath; mine.label = planned.folder.label; mine.updated_at = now()
        }
        return clone(mine)
      }
      materialiseFolder(projectId, planned.category)
      if (planned.parent) {
        const sceneRow = await adapter.ensureEntityFolder(projectId, project, 'scene', scene)
        if (sceneRow && sceneRow.path !== planned.folder.parentPath) {
          planned.folder.parentPath = sceneRow.path
          planned.folder.path = `${sceneRow.path}/${planned.folder.slug}`
        }
      }
      return clone(materialiseFolder(projectId, planned.folder))
    },

    // S4c: the one-time re-filing, in memory — the cloud adapter's shape and
    // order (the scene's folder, the files' keys, then the folder row; the
    // empty SHOTS category last), on the fixtures' own key shape
    // (…/projects/<pid>/<folder path>/<name>). Nothing is deleted; a second
    // run finds nothing to move.
    async refileShotFolders(projectId, project, opts = {}) {
      const progress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {}
      const folders = store.folders.filter(f => f.project_id === projectId)
      const pending = pendingShotRefiling({ folders, shots: store.shots, scenes: store.scenes })
      const moved = []
      for (const p of pending) {
        progress({ shot: p.shot, name: p.folder.slug, done: moved.length, total: pending.length })
        const sceneFolder = await adapter.ensureEntityFolder(projectId, project || projectOf(projectId), 'scene', p.scene)
        const toPath = `${sceneFolder.path}/${p.folder.slug}`
        const fromMark = `/projects/${projectId}/${p.folder.path}/`
        const toMark = `/projects/${projectId}/${toPath}/`
        let n = 0
        for (const f of store.files) {
          if (f.project_id !== projectId) continue
          const mine = (f.shot_id && String(f.shot_id) === String(p.shot.id)) || (f.folder_id && f.folder_id === p.folder.id)
          if (!mine) continue
          if (typeof f.storage_path === 'string' && f.storage_path.includes(fromMark)) {
            f.storage_path = f.storage_path.replace(fromMark, toMark)
            n += 1
          }
          if (typeof f.thumbnail_url === 'string' && f.thumbnail_url.includes(fromMark)) {
            const before = f.thumbnail_url
            f.thumbnail_url = before.replace(fromMark, toMark)
            // The generated picture follows its key, as the bucket's object does.
            if (store.thumbnails.has(before)) { store.thumbnails.set(f.thumbnail_url, store.thumbnails.get(before)); store.thumbnails.delete(before) }
          }
        }
        const row = store.folders.find(f => f.id === p.folder.id)
        row.parent_id = sceneFolder.id
        row.path = toPath
        row.updated_at = now()
        moved.push({ shotId: p.shot.id, name: p.folder.slug, from: p.folder.path, to: toPath, files: n })
      }
      let removedShotsCategory = false
      const after = store.folders.filter(f => f.project_id === projectId)
      const category = shotsCategoryRow(after)
      if (category && shotsCategoryEmpty(after)) { remove(store.folders, category.id); removedShotsCategory = true }
      return { moved, left: [], removedShotsCategory }
    },
    async writeProjectManifest(projectId, manifest) { store.manifests[projectId] = clone(manifest); return { ok: true } },
    async writeProjectRates(projectId, mirror) { store.ratesMirror[projectId] = clone(mirror); return { ok: true } },
    async deleteFolder(id) { remove(store.folders, id) },

    // ── Milestones (0067 + 0077 — Track A A2, merged 2026-09-29) ─────────────
    // The cloud shape, method for method: list(projectId) is the live rows by
    // date; delete(id, projectId) is SOFT (ruling 38: trash + undo) and
    // restore answers the RPC's boolean (false = already live); destroy is the
    // HARD delete RabbitProvider uses for the undo of a CREATE; the trash list
    // is newest first and carries purges_at for the panel's 30-day countdown
    // (0014 §4). patch is the per-field write the provider prefers when it
    // exists (0077's last-field-wins).
    async listMilestones(projectId) {
      return clone(live(store.milestones.filter(m => m.project_id === projectId)).sort(byMilestoneDate))
    },
    async upsertMilestone(row) { return clone(upsert(store.milestones, unstamped(row))) },
    async patchMilestone(id, fields) { return clone(patch(store.milestones, id, unstamped(fields))) },
    async deleteMilestone(id, _projectId) { trash(store.milestones, id) },
    async destroyMilestone(id, _projectId) { remove(store.milestones, id) },
    async restoreMilestone(id, _projectId) { return restore(store.milestones, id) },
    async listTrashedMilestones(projectId) {
      return clone(store.milestones
        .filter(m => m.project_id === projectId && m.deleted_at)
        .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)))
        .map(m => ({ ...m, purges_at: new Date(Date.parse(m.deleted_at) + 30 * 86400000).toISOString() })))
    },

    // ── Realtime: nothing to subscribe to; report a joined channel ───────────
    // The provider reads Supabase channel statuses ('SUBSCRIBED' → live), and
    // refetches the project on every join, so the answer is the real one.
    subscribeProjectChanges(projectId, _callback, opts = {}) {
      const t = setTimeout(() => {
        opts.onStatus?.('SUBSCRIBED')
        opts.onPresence?.(store.members.slice(0, 3).map(m => ({ user_id: m.user_id, label: m.display_name, avatar_url: m.avatar_url })))
      }, 0)
      return () => clearTimeout(t)
    },
    subscribeWorkspaceChanges(_workspaceId, _callback, opts = {}) {
      const t = setTimeout(() => {
        opts.onStatus?.('SUBSCRIBED')
        opts.onPresence?.(store.members.slice(0, 3).map(m => ({ user_id: m.user_id, label: m.display_name, avatar_url: m.avatar_url })))
      }, 0)
      return () => clearTimeout(t)
    },
    async supportsPrivateProjects() { return true },

    // ── Bins (docs/BINS_DESIGN.md §4; adapters/index.js's contract) ──────────
    // Since BC1 (0091) the fake cloud keeps the CLOUD's rules: a clip is a
    // location plus a relative path, a removed clip's takes go with it (the
    // CASCADE), a location in use cannot be removed (RESTRICT), the
    // location's address has the database's shape, and a clip's picture is
    // kept only while the company's remote-viewing switch is on (B4).
    binsCapabilities() { return binsCaps },
    async listBins(projectId) {
      const answer = takesAnswer([])
      return {
        bins: clone(store.bins.filter(b => b.project_id === projectId)),
        binFiles: clone(binFilesWithOnline().filter(f => f.project_id === projectId)),
        binRoots: clone(store.binRoots.filter(r => r.project_id === projectId)),
        binLocations: clone(store.binLocations),
        shotTakes: answer.shotTakes.filter(t => t.project_id === projectId),
        orphanTakes: answer.orphanTakes.filter(t => t.project_id === projectId),
        ffmpeg: false,
        capabilities: binsCaps,
      }
    },
    // ── Footage locations (BC1, 0091 §2; Audrey's B2) ────────────────────────
    async listBinLocations() { return clone(store.binLocations) },
    async createBinLocation(location) {
      const name = String(location?.name ?? '').trim()
      const unc_path = String(location?.unc_path ?? '').trim()
      if (!name) throw invalid(BINS_SENTENCES.locationName)
      if (!isUncPath(unc_path)) throw refusal(400, '23514', BINS_SENTENCES.locationShape)
      if (store.binLocations.some(l => l.unc_path.toLowerCase() === unc_path.toLowerCase())) throw conflict(BINS_SENTENCES.locationExists)
      const row = { id: location?.id || newId(), workspace_id: workspaceId, name, unc_path, added_by: by, created_at: now(), updated_at: now() }
      store.binLocations.push(row)
      return clone(row)
    },
    async updateBinLocation(id, fields) {
      const row = findById(store.binLocations, id); if (!row) throw missing('footage location not found')
      const p = { ...(fields || {}) }
      if ('name' in p) { p.name = String(p.name ?? '').trim(); if (!p.name) throw invalid(BINS_SENTENCES.locationName) }
      if ('unc_path' in p) {
        p.unc_path = String(p.unc_path ?? '').trim()
        if (!isUncPath(p.unc_path)) throw refusal(400, '23514', BINS_SENTENCES.locationShape)
        if (store.binLocations.some(l => l.id !== id && l.unc_path.toLowerCase() === p.unc_path.toLowerCase())) throw conflict(BINS_SENTENCES.locationExists)
      }
      delete p.id; delete p.workspace_id; delete p.added_by; delete p.created_at
      return clone(patch(store.binLocations, id, p))
    },
    async removeBinLocation(id) {
      const row = findById(store.binLocations, id); if (!row) throw missing('footage location not found')
      // ON DELETE RESTRICT: a clip never loses its address.
      if (store.binFiles.some(f => f.location_id === id)) throw refusal(409, '23503', BINS_SENTENCES.locationInUse)
      remove(store.binLocations, id)
      return clone(row)
    },
    // ── The company's switch (B5a) ───────────────────────────────────────────
    async getRemoteViewingEnabled() { return store.workspace.remote_viewing_enabled === true },
    // BC2: read for the workspace, where no project is open (Settings).
    async getWorkspaceRemoteViewing() { return store.workspace.remote_viewing_enabled === true },
    async setRemoteViewingEnabled(_workspaceId, enabled) {
      // workspaces_admin_update (0020): a workspace admin's verb.
      if (appRole !== 'admin') throw forbidden(BINS_SENTENCES.switchAdminOnly)
      store.workspace.remote_viewing_enabled = enabled === true
      return store.workspace.remote_viewing_enabled
    },
    // A clip's picture is kept only while the switch is on (B4): refused
    // before any byte, with the sentence the cloud answers.
    async postBinFileThumbnail(_projectId, id, base64) {
      const row = findById(store.binFiles, id); if (!row) throw notFound(id)
      if (!base64 || typeof base64 !== 'string') throw invalid('base64 required')
      if (store.workspace.remote_viewing_enabled !== true) throw refusal(403, 'remote_viewing_off', BINS_SENTENCES.remoteViewingOff)
      const poster_path = `projects/${row.project_id}/bin_files/${id}/${Date.now()}-poster.jpg`
      store.posters.set(id, `data:image/jpeg;base64,${base64}`)
      patch(store.binFiles, id, { poster_path })
      return { ok: true, poster_path }
    },
    // The cloud signs a poster per read; here the placeholder stands in.
    async binFilePosterUrl(_projectId, row) { return row?.id ? (store.posters.get(row.id) ?? null) : null },
    async createBin(projectId, bin) { return clone(upsert(store.bins, { project_id: projectId, workspace_id: null, kind: 'other', color: null, parent_bin_id: null, sort_order: store.bins.length, created_by: by, ...bin, updated_by: by })) },
    async updateBin(_projectId, id, fields) { return clone(patch(store.bins, id, { ...fields, updated_by: by })) },
    async deleteBin(_projectId, id, { mode = 'remove', target = null } = {}) {
      const doomed = new Set([id])
      let grew = true
      while (grew) { grew = false; for (const b of store.bins) if (!doomed.has(b.id) && doomed.has(b.parent_bin_id)) { doomed.add(b.id); grew = true } }
      const files = store.binFiles.filter(f => doomed.has(f.bin_id))
      const movedFiles = []; const removedFiles = []; let removedTakes = []
      for (const f of files) {
        if (mode === 'move' && target) { f.bin_id = target; f.updated_at = now(); movedFiles.push(clone(f)) }
        else { removedFiles.push(clone(f)) }
      }
      // A 'move' with no target is a remove (review round 1: the files must not
      // survive orphaned on a deleted bin id). BC1: a removed clip's takes go
      // with it, as 0091's CASCADE takes them; the answer carries them.
      if (!(mode === 'move' && target)) {
        const gone = new Set(removedFiles.map(f => f.id))
        removedTakes = store.shotTakes.filter(t => gone.has(t.bin_file_id)).map(t => clone(t))
        store.shotTakes = store.shotTakes.filter(t => !gone.has(t.bin_file_id))
        store.binFiles = store.binFiles.filter(f => !doomed.has(f.bin_id))
      }
      const removedBins = store.bins.filter(b => doomed.has(b.id)).map(b => clone(b))
      store.bins = store.bins.filter(b => !doomed.has(b.id))
      return { ok: true, removedBins, movedFiles, removedFiles, removedTakes }
    },
    async reorderBins(_projectId, rows) {
      for (const r of rows || []) { const b = findById(store.bins, r.id); if (b) { b.parent_bin_id = r.parent_bin_id ?? null; b.sort_order = r.sort_order ?? b.sort_order } }
      return { ok: true }
    },
    async pickBinFiles() { throw devWriteRefused('Picking files from disk') },
    async pickBinFolder() { throw devWriteRefused('Picking a folder from disk') },
    async prepareBinFiles() { throw devWriteRefused('Adding files from disk') },
    // BC2: the cloud's add_bin_files (0091), for the desktop signed in. An
    // item is a REFERENCE — one of the company's footage locations plus a
    // path inside it, the technical columns the adding computer read — never
    // bytes; an item without one is answered 'invalid', as the function does.
    // (Picking and preparing stay refused here: they are the desktop's.)
    async addBinFiles(_projectId, binId, items, createSubBins = true) {
      const bin = findById(store.bins, binId); if (!bin) throw missing('bin not found')
      if (!Array.isArray(items) || items.length === 0) throw invalid('items required')
      const MEDIA = ['video', 'still', 'sequence', 'audio', 'graphic', 'vfx', 'document', 'other']
      const COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink']
      const pos = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
      const text = (v) => (typeof v === 'string' && v.trim() ? v : null)
      const created = []; const bins = []; const results = []
      for (const e of items) {
        const rel = String(e?.relative_path ?? '').trim()
        const loc = e?.location_id ? store.binLocations.find(l => l.id === e.location_id) : null
        if (!loc || !rel) { results.push({ relative_path: e?.relative_path ?? null, status: 'invalid' }); continue }
        let target = bin.id
        if (createSubBins !== false && String(e.sub_bin ?? '').trim()) {
          let parent = bin.id
          for (const seg of String(e.sub_bin).split('/').map(s => s.trim()).filter(Boolean)) {
            let child = store.bins
              .filter(b => b.project_id === bin.project_id && (b.parent_bin_id ?? null) === parent && String(b.name).toLowerCase() === seg.toLowerCase())
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]
            if (!child) {
              const siblings = store.bins.filter(b => b.project_id === bin.project_id && (b.parent_bin_id ?? null) === parent)
              child = upsert(store.bins, { project_id: bin.project_id, workspace_id: bin.workspace_id ?? null, name: seg, description: '', kind: 'footage', color: null, parent_bin_id: parent, sort_order: siblings.reduce((m, b) => Math.max(m, b.sort_order ?? 0), -1) + 1, created_by: by, updated_by: by })
              bins.push(clone(child))
            }
            parent = child.id
          }
          target = parent
        }
        const isSeq = e.is_sequence === true
        const name = String(e.original_name ?? '').trim() || rel.replace(/^.*\//, '')
        const extOf = !isSeq && /\.[A-Za-z0-9]{1,12}$/.test(name) ? name.match(/(\.[A-Za-z0-9]{1,12})$/)[1] : ''
        const order = store.binFiles.filter(f => f.bin_id === target).reduce((m, f) => Math.max(m, f.sort_order ?? 0), -1) + 1
        const row = {
          id: newId(), project_id: bin.project_id, workspace_id: bin.workspace_id ?? workspaceId, bin_id: target,
          location_id: loc.id, relative_path: rel,
          display_name: String(e.display_name ?? '').trim() || (isSeq ? name : name.replace(/\.[A-Za-z0-9]{1,12}$/, '')),
          original_name: name, extension: String(e.extension || extOf).toLowerCase(), mime_type: text(e.mime_type),
          is_sequence: isSeq, sequence_pattern: text(e.sequence_pattern),
          frame_count: pos(e.frame_count) ? Math.round(e.frame_count) : null,
          size_bytes: typeof e.size_bytes === 'number' && Number.isFinite(e.size_bytes) ? e.size_bytes : null,
          mtime: e.mtime ?? null,
          media_type: MEDIA.includes(e.media_type) ? e.media_type : isSeq ? 'sequence' : 'other',
          tags: (Array.isArray(e.tags) ? e.tags : []).map(t => String(t).trim()).filter(Boolean).slice(0, 50),
          scene_id: e.scene_id ?? null, shot_id: e.shot_id ?? null, slate: text(e.slate),
          take_number: pos(e.take_number) ? Math.floor(e.take_number) : null, take_modifier: text(e.take_modifier),
          camera: text(e.camera), roll: text(e.roll),
          shoot_day: /^\d{4}-\d{2}-\d{2}$/.test(String(e.shoot_day ?? '')) ? e.shoot_day : null,
          description: e.description ?? '', notes: e.notes ?? '',
          review_flag: ['unflagged', 'select', 'reject'].includes(e.review_flag) ? e.review_flag : 'unflagged',
          circled: e.circled === true, color: COLORS.includes(e.color) ? e.color : null,
          duration_sec: pos(e.duration_sec), width: pos(e.width) ? Math.floor(e.width) : null, height: pos(e.height) ? Math.floor(e.height) : null,
          fps: pos(e.fps), codec: text(e.codec), timecode_start: text(e.timecode_start),
          probe_status: ['pending', 'done', 'failed', 'unavailable'].includes(e.probe_status) ? e.probe_status : 'pending',
          sort_order: order, poster_path: null, added_by: by, added_at: now(), updated_at: now(),
        }
        store.binFiles.push(row)
        created.push(clone(row))
        results.push({ relative_path: rel, status: 'added', id: row.id, bin_id: target })
      }
      return { created, bins, results }
    },
    async updateBinFile(_projectId, id, fields) { return clone(withOnline(patch(store.binFiles, id, fields))) },
    async bulkUpdateBinFiles(_projectId, ids, fields) {
      const updated = []
      for (const id of ids || []) { const row = findById(store.binFiles, id); if (row) { Object.assign(row, fields, { updated_at: now() }); updated.push(clone(withOnline(row))) } }
      return { updated }
    },
    async moveBinFiles(_projectId, ids, binId) {
      const moved = []
      for (const id of ids || []) { const row = findById(store.binFiles, id); if (row) { row.bin_id = binId; row.updated_at = now(); moved.push(clone(withOnline(row))) } }
      return { moved }
    },
    async copyBinFiles(_projectId, ids, binId) {
      const created = []
      for (const id of ids || []) { const row = findById(store.binFiles, id); if (row) { const copy = { ...row, id: newId(), bin_id: binId, added_at: now(), updated_at: now() }; store.binFiles.push(copy); store.posters.set(copy.id, store.posters.get(id) ?? null); created.push(clone(withOnline(copy))) } }
      return { created }
    },
    // Removes the ROWS only (B10). BC1: a removed clip's takes go with it
    // (0091's CASCADE) and ride the answer as `removedTakes`; the provider
    // snapshots the shots' takes first and puts them back on undo.
    async removeBinFiles(_projectId, ids) {
      const set = new Set(ids || [])
      const removed = store.binFiles.filter(f => set.has(f.id)).map(f => clone(f))
      store.binFiles = store.binFiles.filter(f => !set.has(f.id))
      const removedTakes = store.shotTakes.filter(t => set.has(t.bin_file_id)).map(t => clone(t))
      store.shotTakes = store.shotTakes.filter(t => !set.has(t.bin_file_id))
      const affected = removedTakes.map(t => t.shot_id)
      for (const s of new Set(affected)) normaliseTakes(s)
      return { removed, removedTakes, ...takesAnswer(affected) }
    },
    async restoreBinFiles(_projectId, rows) {
      const restored = []; const skipped = []
      for (const r of rows || []) {
        // Reasons are the provider's vocabulary (bin_gone | unauthorized | invalid).
        if (!r?.id) { skipped.push({ id: r?.id ?? null, reason: 'invalid' }); continue }
        if (findById(store.binFiles, r.id)) { skipped.push({ id: r.id, reason: 'invalid' }); continue }
        const { online, ...row } = r
        store.binFiles.push(row) // the poster map is keyed by id and survives a remove
        restored.push(clone(withOnline(row)))
      }
      const affected = restored.flatMap(r => store.shotTakes.filter(t => t.bin_file_id === r.id).map(t => t.shot_id))
      for (const s of new Set(affected)) normaliseTakes(s)
      return { restored, skipped, ...takesAnswer(affected) }
    },
    async probeBinFile(_projectId, id) { const row = findById(store.binFiles, id); if (!row) throw notFound(id); return clone(withOnline(row)) },
    binFileThumbnailUrl(_projectId, id) { return store.posters.get(id) ?? null },
    // No bytes to stream: the poster stands in for the frame (the panel's <img>).
    binFileStreamUrl(_projectId, id) { return store.posters.get(id) ?? null },
    async binRelinkScan() { return { offline: [], candidates: [], truncated: false } },
    async binRelinkApply() { throw devWriteRefused('Relinking a drive') },
    async openBinFile() { throw devWriteRefused('Opening a file on this machine') },
    async removeBinRoot(_projectId, id) { remove(store.binRoots, id); return { ok: true } },

    // ── Shot takes ───────────────────────────────────────────────────────────
    async assignShotTakes(projectId, rows) {
      const created = []; const skipped = []; const affected = []
      for (const r of rows || []) {
        if (store.shotTakes.some(t => t.shot_id === r.shot_id && t.bin_file_id === r.bin_file_id)) { skipped.push({ shot_id: r.shot_id, bin_file_id: r.bin_file_id, reason: 'exists' }); continue }
        const position = store.shotTakes.filter(t => t.shot_id === r.shot_id).length
        const role = r.role || (position === 0 ? PRIMARY : 'alt')
        if (role === PRIMARY) for (const t of store.shotTakes) if (t.shot_id === r.shot_id && t.role === PRIMARY) t.role = 'alt'
        const row = { id: newId(), project_id: projectId, shot_id: r.shot_id, bin_file_id: r.bin_file_id, role, position, notes: r.notes || '', created_at: now(), updated_at: now() }
        store.shotTakes.push(row); created.push(clone(row)); affected.push(r.shot_id)
      }
      for (const s of new Set(affected)) normaliseTakes(s)
      return { created, skipped, ...takesAnswer(affected) }
    },
    async updateShotTake(_projectId, id, fields) {
      const row = findById(store.shotTakes, id); if (!row) throw notFound(id)
      if (fields.role === PRIMARY) for (const t of store.shotTakes) if (t.shot_id === row.shot_id && t.id !== id && t.role === PRIMARY) t.role = 'alt'
      Object.assign(row, fields, { updated_at: now() })
      normaliseTakes(row.shot_id)
      return { take: clone(row), ...takesAnswer([row.shot_id]) }
    },
    async removeShotTakes(_projectId, ids) {
      const set = new Set(ids || [])
      const removed = store.shotTakes.filter(t => set.has(t.id)).map(t => clone(t))
      store.shotTakes = store.shotTakes.filter(t => !set.has(t.id))
      const affected = removed.map(t => t.shot_id)
      for (const s of new Set(affected)) normaliseTakes(s)
      return { removed, ...takesAnswer(affected) }
    },
    async reorderShotTakes(_projectId, shotId, ids) {
      (ids || []).forEach((id, i) => { const t = findById(store.shotTakes, id); if (t && t.shot_id === shotId) t.position = i })
      normaliseTakes(shotId)
      return takesAnswer([shotId])
    },
    async replaceShotTakes(projectId, shotIds, rows) {
      const set = new Set(shotIds || [])
      store.shotTakes = store.shotTakes.filter(t => !set.has(t.shot_id))
      for (const r of rows || []) store.shotTakes.push({ id: r.id || newId(), project_id: projectId, notes: '', created_at: now(), ...r, updated_at: now() })
      for (const s of set) normaliseTakes(s)
      return takesAnswer([...set])
    },
  }

  return adapter
}
