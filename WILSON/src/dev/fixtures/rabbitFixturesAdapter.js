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
// the refusals Audrey will see on a real backend.
// =============================================================================

import { devWriteRefused } from '../devFixtures'
import { planProjectFolders, planEntityFolder, ENTITY_FK_COLUMN } from '../../tools/rabbit_v0.1.0/folderPaths'
import {
  clone, newId, now, findById, live, upsert, patch, remove, softDelete, restore, notFound,
} from './store'

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

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}
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

export function createRabbitFixturesAdapter(store, { userId, workspaceId }) {
  const by = userId
  const stampBy = (row) => ({ ...row, updated_by: by, last_updated_by: by, last_updated_at: now() })
  const projectOf = (id) => findById(store.projects, id)

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
  const binFilesWithOnline = () => store.binFiles.map(f => ({ ...f, online: true }))

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
   */
  function sweepShotListLinks(column, id) {
    store.shotListItems = store.shotListItems.filter(i => i[column] !== id)
    for (const t of store.tasks) if (t[column] === id) { t[column] = null; t.updated_at = now() }
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
      return clone({
        project,
        phases: live(inProject(store.phases)).sort((a, b) => a.sort_order - b.sort_order),
        assets: live(inProject(store.assets)).sort((a, b) => a.sort_order - b.sort_order),
        tasks: live(inProject(store.tasks)),
        dependencies: store.dependencies.filter(d => !d.deleted_at),
        taskLinks: store.taskLinks.filter(l => taskIds.has(l.task_id)),
        files: live(inProject(store.files)),
        assetVersions: store.assetVersions.filter(v => assetIds.has(v.asset_id)),
        comments: live(store.comments),
        ingestionRuns: inProject(store.ingestionRuns),
        budgetVersions: inProject(store.budgetVersions),
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
        // 0084 (S3a): the three bundle keys every adapter returns, in the
        // contract's order.
        shotLists: inProject(store.shotLists).sort(byCreated),
        shotListItems: inProject(store.shotListItems).sort(byPosition),
        edits: inProject(store.edits).sort(byCreated),
      })
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
      return clone(patch(store.projects, id, stampBy(fields)))
    },
    async deleteProject(id) { softDelete(store.projects, id, by) },
    async restoreProject(id) { return restore(store.projects, id) },

    // ── Phases / assets / tasks ──────────────────────────────────────────────
    async listPhases(projectId) { return clone(live(store.phases.filter(p => p.project_id === projectId))) },
    async upsertPhase(phase) { return clone(upsert(store.phases, { workspace_id: workspaceId, ...phase })) },
    async patchPhase(id, fields) { return clone(patch(store.phases, id, fields)) },
    async deletePhase(id) { softDelete(store.phases, id, by) },
    async restorePhase(id) { return restore(store.phases, id) },

    async listAssets(projectId) { return clone(live(store.assets.filter(a => a.project_id === projectId))) },
    async upsertAsset(asset) { return clone(upsert(store.assets, stampBy({ workspace_id: workspaceId, created_by: by, ...asset }))) },
    async patchAsset(id, fields) { return clone(patch(store.assets, id, stampBy(fields))) },
    async deleteAsset(id) { softDelete(store.assets, id, by) },
    async restoreAsset(id) { return restore(store.assets, id) },

    async listTasks(projectId) { return clone(live(store.tasks.filter(t => t.project_id === projectId))) },
    async upsertTask(task) { return clone(upsert(store.tasks, stampBy({ workspace_id: workspaceId, created_by: by, ...task }))) },
    async patchTask(id, fields) { return clone(patch(store.tasks, id, stampBy(fields))) },
    async deleteTask(id) { softDelete(store.tasks, id, by) },
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
    async listFiles(projectId) { return clone(live(store.files.filter(f => f.project_id === projectId))) },
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
    async updateFile(id, fields) { return clone(patch(store.files, id, stampBy(fields))) },
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
      return clone(store.fileEvents.filter(e => e.file_id === fileId).sort((a, b) => b.created_at.localeCompare(a.created_at)))
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
      return clone(live(store.tasks)
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
      return clone(live(store.phases.filter(p => ids.has(p.project_id))))
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
    async deleteBudgetVersion(id) { remove(store.budgetVersions, id) },
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
    async deleteScene(id, _projectId) { remove(store.scenes, id); sweepShotListLinks('scene_id', id) },
    async listShots(projectId) { return clone(store.shots.filter(s => s.project_id === projectId)) },
    async upsertShot(shot) { return clone(upsert(store.shots, { workspace_id: workspaceId, created_by: by, ...shot, updated_by: by })) },
    async deleteShot(id, _projectId) { remove(store.shots, id); sweepShotListLinks('shot_id', id) },
    async listLevels(projectId) { return clone(store.levels.filter(s => s.project_id === projectId)) },
    async upsertLevel(level) { return clone(upsert(store.levels, { workspace_id: workspaceId, created_by: by, ...level, updated_by: by })) },
    async deleteLevel(id) { remove(store.levels, id) },
    async listExperiences(projectId) { return clone(store.experiences.filter(s => s.project_id === projectId)) },
    async upsertExperience(exp) { return clone(upsert(store.experiences, { workspace_id: workspaceId, created_by: by, ...exp, updated_by: by })) },
    async deleteExperience(id) { remove(store.experiences, id) },

    // ── Shot lists, items, edits (0084; the S3a contract's nine methods) ─────
    // Same names, signatures, rules and refusal texts as the Supabase and
    // Local Server adapters. There is no delete: lists and edits are archived,
    // never deleted (D4/D18). No role check here — the fixtures sign in as
    // Mara, a workspace admin, who may do everything D8 allows.
    //
    // Where one input breaks several rules, the refusal is the one the
    // database reaches first: on an UPDATE the guard trigger (moves, archive
    // columns, a frozen archived row), then the CHECK constraints (title,
    // version, snapshot / items shape, own parent), then the unique key, then
    // the foreign keys (list and parent in this project).
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
        guardArchived(body, stored, { archiveOnly: LIST_ARCHIVE_ONLY, frozen: 'this shot list is archived — restore it before changing it' })
      } else if (body.archived_at || body.archived_by) {
        throw forbidden(LIST_ARCHIVE_ONLY)
      }
      const row = stored
        ? { ...stored, ...body }
        : { version: 1, summary: null, snapshot: {}, archived_at: null, archived_by: null, ...body }
      validateVersioned(row, 'A shot list')
      if ('snapshot' in body && !isPlainObject(body.snapshot)) throw invalid("A shot list's snapshot must be an object.")
      const title = row.title.trim()
      const clash = store.shotLists.find(l => l.project_id === row.project_id && l.id !== row.id
        && String(l.title || '').trim() === title && Number(l.version) === row.version)
      if (clash) throw conflict(`There is already a shot list called "${versionedLabel(clash)}".`)
      return clone(upsert(store.shotLists, stored
        ? { ...row, updated_by: by }
        : { ...row, workspace_id: project.workspace_id ?? workspaceId, created_by: by, updated_by: by }))
    },

    async listShotListItems(projectId) {
      return clone(store.shotListItems.filter(i => i.project_id === projectId).sort(byPosition))
    },

    /**
     * Replace ONE list's whole membership (replace_shot_list_items(), 0084
     * §10d). Everything is validated before anything is written. An id of this
     * list keeps its row (created_at kept, updated_at bumped); an unknown id is
     * inserted with that id; no id mints one; an id that belongs to ANOTHER
     * list's item is skipped (the database's ON CONFLICT ... WHERE same list).
     * Items of this list that are not named are deleted. An archived list is
     * not frozen here (the database does not freeze it either — the provider
     * refuses client-side).
     */
    async replaceShotListItems(projectId, listId, items) {
      const list = liveProject(projectId) ? listIn(projectId, listId) : null
      if (!list) throw missing('shot list not found')
      if (!Array.isArray(items)) throw invalid('items must be a JSON array')
      const sceneIds = new Set(store.scenes.filter(s => s.project_id === projectId).map(s => s.id))
      const shotIds = new Set(store.shots.filter(s => s.project_id === projectId).map(s => s.id))
      const seen = new Set()
      const seenIds = new Set()
      for (const it of items) {
        if (!isPlainObject(it) || !it.scene_id === !it.shot_id) throw invalid('each item names exactly one scene or one shot')
        if (it.scene_id ? !sceneIds.has(it.scene_id) : !shotIds.has(it.shot_id)) {
          throw invalid('an item names a scene or shot that is not in this project')
        }
        const key = it.scene_id ? `scene:${it.scene_id}` : `shot:${it.shot_id}`
        if (seen.has(key)) throw conflict('a shot list holds each scene and each shot once')
        seen.add(key)
        if (it.position != null && !(Number.isInteger(it.position) && it.position >= 0)) {
          throw invalid("an item's position must be a whole number of at least 0")
        }
        // Not in the contract's list: the database answers two rows with one
        // id with "ON CONFLICT DO UPDATE command cannot affect row a second
        // time", so the fixtures refuse it too rather than keep the last one.
        if (it.id) {
          if (seenIds.has(it.id)) throw invalid('an item id appears twice')
          seenIds.add(it.id)
        }
      }
      const at = now()
      const own = new Map(store.shotListItems.filter(r => r.shot_list_id === listId).map(r => [r.id, r]))
      const elsewhere = new Set(store.shotListItems.filter(r => r.shot_list_id !== listId).map(r => r.id))
      const next = []
      items.forEach((it, i) => {
        if (it.id && elsewhere.has(it.id)) return
        const fields = { scene_id: it.scene_id || null, shot_id: it.shot_id || null, position: it.position ?? i }
        const kept = it.id ? own.get(it.id) : null
        next.push(kept
          ? { ...kept, ...fields, updated_at: at, updated_by: by }
          : {
            id: it.id || newId(), shot_list_id: listId, project_id: projectId,
            workspace_id: list.workspace_id ?? workspaceId, ...fields,
            created_at: at, created_by: by, updated_at: at, updated_by: by,
          })
      })
      store.shotListItems = [...store.shotListItems.filter(r => r.shot_list_id !== listId), ...next]
      return clone([...next].sort(byPosition))
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
        guardArchived(body, stored, { archiveOnly: EDIT_ARCHIVE_ONLY, frozen: 'this edit is archived — restore it before changing it' })
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
      const title = row.title.trim()
      const clash = store.edits.find(e => e.project_id === row.project_id && e.shot_list_id === row.shot_list_id
        && e.id !== row.id && String(e.title || '').trim() === title && Number(e.version) === row.version)
      if (clash) throw conflict(`This shot list already has an edit called "${versionedLabel(clash)}".`)
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
    async ensureEntityFolder(projectId, project, entityType, entity) {
      const planned = planEntityFolder(project || projectOf(projectId), entityType, entity)
      if (!planned) return null
      materialiseFolder(projectId, planned.category)
      return clone(materialiseFolder(projectId, planned.folder))
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
    async upsertMilestone(row) { return clone(upsert(store.milestones, row)) },
    async patchMilestone(id, fields) { return clone(patch(store.milestones, id, fields)) },
    async deleteMilestone(id, _projectId) { softDelete(store.milestones, id, by) },
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
    async listBins(projectId) {
      const answer = takesAnswer([])
      return {
        bins: clone(store.bins.filter(b => b.project_id === projectId)),
        binFiles: clone(binFilesWithOnline().filter(f => f.project_id === projectId)),
        binRoots: clone(store.binRoots.filter(r => r.project_id === projectId)),
        shotTakes: answer.shotTakes.filter(t => t.project_id === projectId),
        orphanTakes: answer.orphanTakes.filter(t => t.project_id === projectId),
        ffmpeg: false,
      }
    },
    async createBin(projectId, bin) { return clone(upsert(store.bins, { project_id: projectId, workspace_id: null, kind: 'other', color: null, parent_bin_id: null, sort_order: store.bins.length, created_by: by, ...bin, updated_by: by })) },
    async updateBin(_projectId, id, fields) { return clone(patch(store.bins, id, { ...fields, updated_by: by })) },
    async deleteBin(_projectId, id, { mode = 'remove', target = null } = {}) {
      const doomed = new Set([id])
      let grew = true
      while (grew) { grew = false; for (const b of store.bins) if (!doomed.has(b.id) && doomed.has(b.parent_bin_id)) { doomed.add(b.id); grew = true } }
      const files = store.binFiles.filter(f => doomed.has(f.bin_id))
      const movedFiles = []; const removedFiles = []
      for (const f of files) {
        if (mode === 'move' && target) { f.bin_id = target; f.updated_at = now(); movedFiles.push(clone(f)) }
        else { removedFiles.push(clone(f)) }
      }
      // A 'move' with no target is a remove (review round 1: the files must not
      // survive orphaned on a deleted bin id).
      if (!(mode === 'move' && target)) store.binFiles = store.binFiles.filter(f => !doomed.has(f.bin_id))
      const removedBins = store.bins.filter(b => doomed.has(b.id)).map(b => clone(b))
      store.bins = store.bins.filter(b => !doomed.has(b.id))
      return { removedBins, movedFiles, removedFiles }
    },
    async reorderBins(_projectId, rows) {
      for (const r of rows || []) { const b = findById(store.bins, r.id); if (b) { b.parent_bin_id = r.parent_bin_id ?? null; b.sort_order = r.sort_order ?? b.sort_order } }
      return { ok: true }
    },
    async pickBinFiles() { throw devWriteRefused('Picking files from disk') },
    async pickBinFolder() { throw devWriteRefused('Picking a folder from disk') },
    async prepareBinFiles() { throw devWriteRefused('Adding files from disk') },
    async addBinFiles() { throw devWriteRefused('Adding files from disk') },
    async updateBinFile(_projectId, id, fields) { return clone({ ...patch(store.binFiles, id, fields), online: true }) },
    async bulkUpdateBinFiles(_projectId, ids, fields) {
      const updated = []
      for (const id of ids || []) { const row = findById(store.binFiles, id); if (row) { Object.assign(row, fields, { updated_at: now() }); updated.push(clone({ ...row, online: true })) } }
      return { updated }
    },
    async moveBinFiles(_projectId, ids, binId) {
      const moved = []
      for (const id of ids || []) { const row = findById(store.binFiles, id); if (row) { row.bin_id = binId; row.updated_at = now(); moved.push(clone({ ...row, online: true })) } }
      return { moved }
    },
    async copyBinFiles(_projectId, ids, binId) {
      const created = []
      for (const id of ids || []) { const row = findById(store.binFiles, id); if (row) { const copy = { ...row, id: newId(), bin_id: binId, added_at: now(), updated_at: now() }; store.binFiles.push(copy); store.posters.set(copy.id, store.posters.get(id) ?? null); created.push(clone({ ...copy, online: true })) } }
      return { created }
    },
    async removeBinFiles(_projectId, ids) {
      const set = new Set(ids || [])
      const removed = store.binFiles.filter(f => set.has(f.id)).map(f => clone(f))
      store.binFiles = store.binFiles.filter(f => !set.has(f.id))
      const affected = store.shotTakes.filter(t => set.has(t.bin_file_id)).map(t => t.shot_id)
      return { removed, ...takesAnswer(affected) }
    },
    async restoreBinFiles(_projectId, rows) {
      const restored = []; const skipped = []
      for (const r of rows || []) {
        // Reasons are the provider's vocabulary (bin_gone | unauthorized | invalid).
        if (!r?.id) { skipped.push({ id: r?.id ?? null, reason: 'invalid' }); continue }
        if (findById(store.binFiles, r.id)) { skipped.push({ id: r.id, reason: 'invalid' }); continue }
        const { online, ...row } = r
        store.binFiles.push(row) // the poster map is keyed by id and survives a remove
        restored.push(clone({ ...row, online: true }))
      }
      const affected = restored.flatMap(r => store.shotTakes.filter(t => t.bin_file_id === r.id).map(t => t.shot_id))
      for (const s of new Set(affected)) normaliseTakes(s)
      return { restored, skipped, ...takesAnswer(affected) }
    },
    async probeBinFile(_projectId, id) { const row = findById(store.binFiles, id); if (!row) throw notFound(id); return clone({ ...row, online: true }) },
    binFileThumbnailUrl(_projectId, id) { return store.posters.get(id) ?? null },
    // No bytes to stream: the poster stands in for the frame (the panel's <img>).
    binFileStreamUrl(_projectId, id) { return store.posters.get(id) ?? null },
    async postBinFileThumbnail() { throw devWriteRefused('Saving a decoded poster') },
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
