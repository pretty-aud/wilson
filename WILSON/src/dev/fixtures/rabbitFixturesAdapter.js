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
// =============================================================================

import { devWriteRefused } from '../devFixtures'
import { planProjectFolders, planEntityFolder, ENTITY_FK_COLUMN } from '../../tools/rabbit_v0.1.0/folderPaths'
import {
  clone, newId, now, findById, live, upsert, patch, remove, softDelete, restore, notFound,
} from './store'

const PRIMARY = 'primary'

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
  const binFilesWithOnline = () => store.binFiles.map(({ __poster, ...f }) => ({ ...f, online: true }))

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
        milestones: inProject(store.milestones),
        bins: inProject(store.bins),
        binFiles: binFilesWithOnline().filter(f => f.project_id === projectId),
        binRoots: inProject(store.binRoots),
        shotTakes: inProject(store.shotTakes),
      })
    },
    async createProject(payload) {
      const row = upsert(store.projects, stampBy({ workspace_id: workspaceId, status: 'draft', created_by: by, ...payload, id: payload.id || newId() }))
      return clone(row)
    },
    async updateProject(id, fields) {
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
    async downloadFile() { throw devWriteRefused('Downloading a file') },
    async downloadUrl(file) {
      const url = file?.thumbnail_url ? store.thumbnails.get(file.thumbnail_url) : null
      if (!url) throw devWriteRefused('Downloading a file')
      return url
    },
    async fileUrl(file) {
      const url = file?.thumbnail_url ? store.thumbnails.get(file.thumbnail_url) : null
      if (!url) throw devWriteRefused('Opening a file')
      return url
    },
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
    async deleteScene(id) { remove(store.scenes, id) },
    async listShots(projectId) { return clone(store.shots.filter(s => s.project_id === projectId)) },
    async upsertShot(shot) { return clone(upsert(store.shots, { workspace_id: workspaceId, created_by: by, ...shot, updated_by: by })) },
    async deleteShot(id) { remove(store.shots, id) },
    async listLevels(projectId) { return clone(store.levels.filter(s => s.project_id === projectId)) },
    async upsertLevel(level) { return clone(upsert(store.levels, { workspace_id: workspaceId, created_by: by, ...level, updated_by: by })) },
    async deleteLevel(id) { remove(store.levels, id) },
    async listExperiences(projectId) { return clone(store.experiences.filter(s => s.project_id === projectId)) },
    async upsertExperience(exp) { return clone(upsert(store.experiences, { workspace_id: workspaceId, created_by: by, ...exp, updated_by: by })) },
    async deleteExperience(id) { remove(store.experiences, id) },

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

    // ── Milestones (the bundle key exists; the cloud has no table yet) ───────
    async upsertMilestone(row) { return clone(upsert(store.milestones, row)) },
    async deleteMilestone(id) { remove(store.milestones, id) },

    // ── Realtime: nothing to subscribe to; report a live channel ─────────────
    subscribeProjectChanges(projectId, _callback, opts = {}) {
      const t = setTimeout(() => {
        opts.onStatus?.('live')
        opts.onPresence?.(store.members.slice(0, 3).map(m => ({ user_id: m.user_id, label: m.display_name, avatar_url: m.avatar_url })))
      }, 0)
      return () => clearTimeout(t)
    },
    subscribeWorkspaceChanges(_workspaceId, _callback, opts = {}) {
      const t = setTimeout(() => {
        opts.onStatus?.('live')
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
      if (mode !== 'move') store.binFiles = store.binFiles.filter(f => !doomed.has(f.bin_id))
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
    async updateBinFile(_projectId, id, fields) { const row = patch(store.binFiles, id, fields); const { __poster, ...out } = row; return clone({ ...out, online: true }) },
    async bulkUpdateBinFiles(_projectId, ids, fields) {
      const updated = []
      for (const id of ids || []) { const row = findById(store.binFiles, id); if (row) { Object.assign(row, fields, { updated_at: now() }); const { __poster, ...out } = row; updated.push(clone({ ...out, online: true })) } }
      return { updated }
    },
    async moveBinFiles(_projectId, ids, binId) {
      const moved = []
      for (const id of ids || []) { const row = findById(store.binFiles, id); if (row) { row.bin_id = binId; row.updated_at = now(); const { __poster, ...out } = row; moved.push(clone({ ...out, online: true })) } }
      return { moved }
    },
    async copyBinFiles(_projectId, ids, binId) {
      const created = []
      for (const id of ids || []) { const row = findById(store.binFiles, id); if (row) { const copy = { ...row, id: newId(), bin_id: binId, added_at: now(), updated_at: now() }; store.binFiles.push(copy); const { __poster, ...out } = copy; created.push(clone({ ...out, online: true })) } }
      return { created }
    },
    async removeBinFiles(_projectId, ids) {
      const set = new Set(ids || [])
      const removed = store.binFiles.filter(f => set.has(f.id)).map(({ __poster, ...f }) => clone(f))
      store.binFiles = store.binFiles.filter(f => !set.has(f.id))
      const affected = store.shotTakes.filter(t => set.has(t.bin_file_id)).map(t => t.shot_id)
      return { removed, ...takesAnswer(affected) }
    },
    async restoreBinFiles(_projectId, rows) {
      const restored = []
      for (const r of rows || []) {
        if (findById(store.binFiles, r.id)) continue
        store.binFiles.push({ ...r, __poster: r.__poster ?? null })
        restored.push(clone({ ...r, online: true }))
      }
      const affected = restored.flatMap(r => store.shotTakes.filter(t => t.bin_file_id === r.id).map(t => t.shot_id))
      for (const s of new Set(affected)) normaliseTakes(s)
      return { restored, skipped: [], ...takesAnswer(affected) }
    },
    async probeBinFile(_projectId, id) { const row = findById(store.binFiles, id); if (!row) throw notFound(id); const { __poster, ...out } = row; return clone({ ...out, online: true }) },
    binFileThumbnailUrl(_projectId, id) { return findById(store.binFiles, id)?.__poster ?? null },
    binFileStreamUrl(_projectId, id) { return findById(store.binFiles, id)?.__poster ?? null },
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
