// =============================================================================
// store.js — the in-memory database the fixture backends read and write.
//
// One `createStore()` per app session: the dataset is deep-copied in, so a
// write mutates the copy and the next read sees it, and a reload starts
// clean. Every read the adapters hand out is a clone too, so React state
// never aliases a store row (a bug there would look like realtime).
//
// Soft-deleted tables (0014) carry `deleted_at`; readers filter it. Nothing
// here imports the Supabase client, `fetch`, or anything that could reach a
// network — devFixtures.test.js greps this directory for exactly that.
// =============================================================================

import { WORKSPACE, MEMBERS } from './data/workspace'
import {
  PROJECT, PHASES, MILESTONES, ASSETS, TASKS, DEPENDENCIES, TASK_LINKS,
  COMMENTS, ASSET_VERSIONS, EDIT_HISTORY, PROJECT_MEMBERS, PERSONAL_SPACES, PERSONAL_SPACE_FILES, PERSONAL_SPACE_MEMBERS, TASK_TEMPLATES,
} from './data/project'
import {
  SCENES, SHOTS, LEVELS, EXPERIENCES, BINS, BIN_FILES, BIN_ROOTS, BIN_LOCATIONS, SHOT_TAKES,
  GAME_LEVELS, GAME_EXPERIENCES, GAME_LINKS, SHOT_LISTS, SHOT_LIST_ITEMS, EDITS,
  TASK_ITEMS, GAME_TASK_ITEMS,
} from './data/scenes'
import { fid } from './ids'
// FX2 (0096): the one statement of a task's items' rules (pure, imports
// nothing), so the fake cloud keeps a task's columns as the database does.
import { COLUMN_KINDS, KIND_FIELD, copyFieldsFromItems, indexItemsByTask } from '../../tools/rabbit_v0.1.0/state/taskItemsModel'
import { FOLDERS, FILES, THUMBNAILS, FILE_EVENTS, GAME_FOLDERS, GAME_FILES } from './data/files'
import {
  RATE_CARDS, RATE_CARD_ENTRIES, BUDGET_LINES, BUDGET_ACTUALS, BUDGET_VERSIONS,
  EXPENSES, PROJECT_RATE_OVERRIDES,
} from './data/money'
import { NOTES, NOTE_SUBJECTS, SHARED_NOTES } from './data/notes'
import { COURSE, SUBJECTS, PROGRESS, QUIZ_ATTEMPTS, CODING_COURSE, CODING_SUBJECTS } from './data/otter'

export function clone(v) {
  if (v === undefined) return undefined
  return structuredClone(v)
}

let counter = 0
/** A fresh id for rows the session creates. Valid v4 shape, marked "f1c7" + "aa". */
export function newId() {
  counter += 1
  const tail = `${Date.now().toString(16)}${counter.toString(16)}`.slice(-12).padStart(12, '0')
  return `f1c7aa00-0000-4000-8000-${tail}`
}

export function now() {
  return new Date().toISOString()
}

/**
 * The `?fixtures=game` variant (B4): Salt Hours with levels and experiences
 * switched on, four levels, three experiences and five assets linked to them.
 * Applied to a store AFTER `createStore()`, only when the page asked for it,
 * so the default dataset is untouched. Returns the store.
 *
 * It adds levels and experiences and touches no scene or shot, so the seeded
 * shot lists (0084) stay whole: every item still names a live row
 * (rabbitFixturesAdapter.contract.test.js checks the variant's bundle).
 */
export function applyGameVariant(store) {
  const project = store.projects[0]
  project.levels_enabled = true
  project.experiences_enabled = true
  store.levels = clone(GAME_LEVELS)
  store.experiences = clone(GAME_EXPERIENCES)
  // FX2 (0096): two tasks are also about the variant's levels and experiences.
  store.taskItems.push(...clone(GAME_TASK_ITEMS))
  for (const [n, levels, experiences] of GAME_LINKS) {
    const asset = store.assets.find(a => a.id === fid('asset', n))
    if (!asset) throw new Error(`[fixtures] game variant: no asset ${n}`)
    asset.level_ids = levels.map(l => fid('level', l))
    asset.experience_ids = experiences.map(x => fid('experience', x))
  }
  // S4c: the levels' and experiences' folders, and a file on one of each
  // (data/files.js) — the explorer and the two popups' Files sections have
  // something to show.
  store.folders.push(...clone(GAME_FOLDERS))
  store.files.push(...clone(GAME_FILES))
  return store
}

/**
 * Post-overhaul S4b: `?fixtures=member` — the same project seen by a plain
 * project MEMBER. The reviewer's own seat (Mara: workspace admin, project
 * manager) is lowered to a workspace 'user' holding a 'member' seat, and the
 * fixtures adapter then hides every money-gated row — an invoice, a Legal
 * file — from her reads, as RLS does on the cloud (0038, 0088). Nothing else
 * changes, so a screenshot pair (this and the default) differs only in what
 * the money gate withholds.
 */
export function applyMemberVariant(store, userId) {
  for (const m of store.projectMembers) if (m.user_id === userId) m.project_role = 'member'
  for (const m of store.members) if (m.user_id === userId) m.app_role = 'user'
  return store
}

/**
 * Post-overhaul S4d: `?fixtures=manager` — the same project seen by a
 * WORKSPACE MANAGER holding only a member seat (Audrey, 2026-10-08: "Also
 * workspace managers, without taking a seat"). Mara's seat is lowered to
 * 'member' and her app role to 'manager', and the fixtures adapter then
 * gives her the Legal file and its activity (the Legal gate, 0092) but not
 * the invoice, the budget or the bid versions (the money gate, unchanged) —
 * the one row where the two gates differ, on screen.
 */
export function applyWorkspaceManagerVariant(store, userId) {
  for (const m of store.projectMembers) if (m.user_id === userId) m.project_role = 'member'
  for (const m of store.members) if (m.user_id === userId) m.app_role = 'manager'
  return store
}

/** `game`, `member` or `manager` from `?fixtures=…`, else null. */
export function fixtureVariant(search = typeof location === 'undefined' ? '' : location.search) {
  const v = new URLSearchParams(search).get('fixtures')
  return v === 'game' || v === 'member' || v === 'manager' ? v : null
}

// BC3: `?bins=browser` makes the fake cloud answer the Bins tab as the real
// cloud does in a BROWSER — no row reachable (`resolveFiles` false, no
// `online` on any row), so the catalogue's "not on this computer" surfaces
// can be rehearsed on the fixtures. The default stays what BC1 made it:
// every row answered for.
export function binsFixtureMode(search = typeof location === 'undefined' ? '' : location.search) {
  return new URLSearchParams(search).get('bins') === 'browser' ? 'browser' : null
}

// FX11: what R.A.B.B.I.T.'s connection dot hears from the fake cloud.
// `?connection=files-down` — the database answers and the files' storage does
// not (amber); `?connection=offline` — neither answers (red). The default:
// both answer (green). The fixtures' realtime and data are untouched, as a
// project already open stays open when the network goes.
export function connectionFixtureMode(search = typeof location === 'undefined' ? '' : location.search) {
  const v = new URLSearchParams(search).get('connection')
  return v === 'files-down' || v === 'offline' ? v : null
}

// MO1 (MOTH_DESIGN §1.9): `?storage=network` is a company whose files are on its office server: the workspace's storage
// row, Salt Hours' folder under the drive, a dozen listed files (one the last check did not find, one in a working
// folder, one in the trash), the row of that check, and a move a laptop left a day ago. A dev build is a browser, so
// what the desktop must do says so, and the writes are refused as every fixture write is.
export function storageFixtureMode(search = typeof location === 'undefined' ? '' : location.search) {
  return new URLSearchParams(search).get('storage') === 'network' ? 'network' : null
}

const OFFICE_ROOT = '//office-server/share/Projects'
const NAS_NAMES = [
  'rushes/A001_C001.mov', 'rushes/A001_C002.mov', 'rushes/A001_C003.mov', 'rushes/A002_C001.mov', 'rushes/B001_C001.mov',
  'sound/day1_mix.wav', 'sound/day2_mix.wav', 'plates/sh010_plate', 'refs/location_walk.mov', 'refs/colour_chart.png',
  'gone_from_server.mov', 'deleted_last_week.mov',
]

export function applyNetworkStorageVariant(store, userId) {
  const project = store.projects.find(p => !p.personal_owner_id)
  const folderName = 'Salt-Hours'
  project.folder_root = `${OFFICE_ROOT}/${folderName}`
  const workingFolder = store.folders.find(f => f.project_id === project.id && f.kind !== 'root' && !/^(invoices|finance|legal)/i.test(f.path))
  const at = (daysAgo) => new Date(Date.parse('2026-11-06T09:00:00Z') - daysAgo * 86400000).toISOString()
  NAS_NAMES.forEach((rel, i) => {
    const leaf = rel.split('/').pop()
    const sequence = rel === 'plates/sh010_plate'
    store.files.push({
      id: `f1c70000-5a5a-4000-8000-${String(i + 1).padStart(12, '0')}`,
      workspace_id: store.workspace.id,
      project_id: project.id,
      folder_id: rel === 'refs/location_walk.mov' ? workingFolder?.id ?? null : null,
      name: leaf,
      mime_type: sequence ? 'inode/x-frame-sequence' : leaf.endsWith('.wav') ? 'audio/wav' : leaf.endsWith('.png') ? 'image/png' : 'video/quicktime',
      size_bytes: 1048576 * (i + 3),
      storage_provider: 'network_share',
      storage_path: `nas:${folderName}/${rel}`,
      thumbnail_url: null,
      tags: [],
      is_financial: false,
      source_modified_at: at(10),
      uploaded_at: at(10),
      created_at: at(10),
      updated_at: at(1),
      share_missing_since: rel === 'gone_from_server.mov' ? at(1) : null,
      share_bin_path: rel === 'deleted_last_week.mov' ? `${folderName}/.wilson-bin/f1c70000-5a5a-4000-8000-${String(i + 1).padStart(12, '0')}/${leaf}` : null,
      deleted_at: rel === 'deleted_last_week.mov' ? at(7) : null,
    })
  })
  store.workspaceStorage = {
    workspace_id: store.workspace.id, mode: 'byos', provider: 'network', provider_config: null,
    root_path: OFFICE_ROOT, root_kind: 'unc', updated_at: at(30), updated_by: userId,
  }
  store.networkShareChecks = {
    [project.id]: {
      project_id: project.id, last_checked_at: at(1), last_checked_by: userId, last_complete_at: at(1),
      files_seen: NAS_NAMES.length - 1, missing_count: 1, next_start: null,
    },
  }
  store.networkShareStale = [{
    op_id: 'f1c70000-5a5b-4000-8000-000000000001', file_id: 'f1c70000-5a5a-4000-8000-000000000005', op: 'move',
    from: `${folderName}/rushes/B001_C001.mov`, to: `${folderName}/selects/B001_C001.mov`, name: 'B001_C001.mov',
  }]
  return store
}

export function createStore() {
  const progress = {}
  progress[COURSE.id] = clone(PROGRESS)
  const store = {
    workspace: clone(WORKSPACE),
    members: clone(MEMBERS),

    projects: [clone(PROJECT), ...clone(PERSONAL_SPACES)],
    // MO1 (0110): the fixtures' stand-in for the WIL-4114 line in app_events.
    personalSpaceOpens: [],
    phases: clone(PHASES),
    milestones: clone(MILESTONES),
    assets: clone(ASSETS),
    tasks: clone(TASKS),
    dependencies: clone(DEPENDENCIES),
    taskLinks: clone(TASK_LINKS),
    // FX2 (0096): a task's items (not the URL links above).
    taskItems: clone(TASK_ITEMS),
    comments: clone(COMMENTS),
    assetVersions: clone(ASSET_VERSIONS),
    editHistory: clone(EDIT_HISTORY),
    projectMembers: [...clone(PROJECT_MEMBERS), ...clone(PERSONAL_SPACE_MEMBERS)],
    taskTemplates: clone(TASK_TEMPLATES),
    ingestionRuns: [],
    ingestionChunks: [],

    scenes: clone(SCENES),
    shots: clone(SHOTS),
    levels: clone(LEVELS),
    experiences: clone(EXPERIENCES),
    bins: clone(BINS),
    // Posters live beside the rows, keyed by id, so a removed-then-restored row
    // (the UI hands back the stripped row) gets its picture back (review round 1).
    binFiles: BIN_FILES.map(({ __poster, ...f }) => clone(f)),
    posters: new Map(BIN_FILES.map(f => [f.id, f.__poster])),
    binRoots: clone(BIN_ROOTS),
    // Bins on the cloud (BC1, 0091): the company's footage locations — a
    // cloud clip is one of these plus a relative path.
    binLocations: clone(BIN_LOCATIONS),
    shotTakes: clone(SHOT_TAKES),
    // 0084 (S3a): lists are archived, never deleted; items are the membership.
    shotLists: clone(SHOT_LISTS),
    shotListItems: clone(SHOT_LIST_ITEMS),
    edits: clone(EDITS),
    // VW1c (0098): custom table views and groupings. Nothing is seeded (Q20:
    // each table comes with the built-in All only, which is never stored).
    // `tableViewRevision` is 0098's table_views_revision_seq: one counter for
    // every view, never reused, so a view made again with its id takes a
    // number no view ever had. `tableViewLast` is the person's
    // user_settings.table_view_last (Q4), in memory for the session.
    tableViews: [],
    itemGroupings: [],
    tableViewRevision: 0,
    tableViewLast: {},
    // MO2 (0123): Moth's saved views, their places and the person's Moth settings, in memory for the session.
    // Nothing is seeded: the first visit asks what to map.
    mothViews: [],
    mothPositions: [],
    mothPrefs: {},
    // MO3 (0126, 0127): typed tags, their nominations, relationships and the picker's reservations. Nothing is
    // seeded: tags and links are made on the page.
    mothTagTypes: [],
    mothTags: [],
    mothTagAssignments: [],
    mothTagNominations: [],
    mothRelationships: [],
    mothMentionReservations: [],

    folders: clone(FOLDERS),
    files: [...clone(FILES), ...clone(PERSONAL_SPACE_FILES)],
    fileEvents: clone(FILE_EVENTS),
    thumbnails: new Map(THUMBNAILS),
    manifests: {},
    ratesMirror: {},

    rateCards: clone(RATE_CARDS),
    rateCardEntries: clone(RATE_CARD_ENTRIES),
    budgetLines: clone(BUDGET_LINES),
    budgetActuals: clone(BUDGET_ACTUALS),
    budgetVersions: clone(BUDGET_VERSIONS),
    expenses: clone(EXPENSES),
    rateOverrides: clone(PROJECT_RATE_OVERRIDES),

    notes: [...clone(NOTES), ...clone(SHARED_NOTES)],
    noteSubjects: clone(NOTE_SUBJECTS),

    // S2b: the C# course (a coding language) after the software one.
    courses: [clone(COURSE), clone(CODING_COURSE)],
    subjects: [...clone(SUBJECTS), ...clone(CODING_SUBJECTS)],
    progress,
    quizAttempts: clone(QUIZ_ATTEMPTS),
  }
  // FX2 (0096): each task's asset_id / scene_id / shot_id is its first item
  // of that kind, as the database's triggers keep the cloud's three columns
  // (VW1m: the older apps' copy, which this app never reads).
  syncTaskItemColumns(store)
  return store
}

/**
 * Every task's three cloud columns set to the older apps' copy of its items:
 * each kind's first item in the stored order (0097 §4, which restates 0096
 * §7a's rule; VW1m, 2026-10-16). Levels and experiences have no column on
 * the cloud, so the fake cloud keeps none either.
 */
// `kinds`: the kinds a write touched (0096 §7a recomputes the column of the
// item's kind only; review round 2, R2-7). Null: every column (a load's
// reconcile, as 0096's backfill and post-condition 10h).
export function syncTaskItemColumns(store, taskIds = null, kinds = null) {
  const only = taskIds ? new Set(taskIds) : null
  const which = kinds ? COLUMN_KINDS.filter(k => kinds.includes(k)) : COLUMN_KINDS
  if (!which.length) return store
  const byTask = indexItemsByTask(store.taskItems)
  for (const t of store.tasks) {
    if (only && !only.has(t.id)) continue
    const copy = copyFieldsFromItems(byTask.get(String(t.id)))
    for (const kind of which) t[KIND_FIELD[kind]] = copy[KIND_FIELD[kind]]
  }
  return store
}

// ── Row helpers ──────────────────────────────────────────────────────────────

export function findById(list, id) {
  return list.find(r => r.id === id) || null
}

export function live(list) {
  return list.filter(r => !r.deleted_at)
}

/** Insert or merge by id; stamps updated_at. Returns the stored row. */
export function upsert(list, row, { idKey = 'id' } = {}) {
  const id = row[idKey] || newId()
  const i = list.findIndex(r => r[idKey] === id)
  const ts = now()
  if (i === -1) {
    const created = { created_at: ts, ...row, [idKey]: id, updated_at: ts }
    list.push(created)
    return created
  }
  list[i] = { ...list[i], ...row, [idKey]: id, updated_at: ts }
  return list[i]
}

export function patch(list, id, fields) {
  const i = list.findIndex(r => r.id === id)
  if (i === -1) throw notFound(id)
  list[i] = { ...list[i], ...fields, updated_at: now() }
  return list[i]
}

export function remove(list, id) {
  const i = list.findIndex(r => r.id === id)
  if (i === -1) return false
  list.splice(i, 1)
  return true
}

export function softDelete(list, id, by) {
  const i = list.findIndex(r => r.id === id)
  if (i === -1) throw notFound(id)
  list[i] = { ...list[i], deleted_at: now(), deleted_by: by ?? null }
  return list[i]
}

/** Returns true when the row was deleted and is now live (the RPC's boolean). */
export function restore(list, id) {
  const i = list.findIndex(r => r.id === id)
  if (i === -1 || !list[i].deleted_at) return false
  list[i] = { ...list[i], deleted_at: null, deleted_by: null }
  return true
}

export function notFound(id) {
  const err = new Error(`[fixtures] no row ${id}`)
  err.status = 404
  err.code = 'not_found'
  return err
}
