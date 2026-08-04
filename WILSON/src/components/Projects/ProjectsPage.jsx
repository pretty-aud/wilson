// ============================================================
// Projects — page-level container
// ============================================================
//
// Single unified project list, served by the RabbitProvider's
// active adapter (Local Server / Supabase / Drive). Both DOG
// and RABBIT read and write the same project records — fields
// are merged on the project row:
//
//   * Canonical:    id, workspace_id, title, description,
//                   status, status_tag, budget_*, dates, ...
//   * DOG-side:     documents[], visualAssets[]  (file payloads)
//   * RABBIT-side:  phases / assets / tasks / etc. live on the
//                   bundle, not on the project row itself.
//
// As of WILSON v0.6.x the legacy IndexedDB store has been
// replaced by this single source. Setting `activeProjectId` from
// here also lights up RABBIT's view body, so a project picked on
// this page is the same project RABBIT will open on navigation.
//
// v0.6.3+: documents + visualAssets are merged into a unified
// file list in the detail panel. Media files are auto-detected
// by MIME type. Files can be marked as core and classified.

import { useState, useCallback } from 'react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { usePermissions } from '../../permissions/usePermissions'
import { detectDocumentKind } from '../../tools/rabbit_v0.1.0/components/ProjectFilesTable'
import ProjectListPanel from './ProjectListPanel'
import ProjectDetailPanel from './ProjectDetailPanel'

function newFileId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function isMediaMime(t) {
  return (t || '').startsWith('image/') || (t || '').startsWith('video/')
}

export default function ProjectsPage({ onNavigate }) {
  const ctx = useRabbit()
  const projectsIndex = ctx?.projectsIndex || {}
  const createProject = ctx?.createProject
  const updateProject = ctx?.updateProject
  const deleteProject = ctx?.deleteProject
  const setActiveProject = ctx?.setActiveProject

  // Create/delete affordances (Session 6) — DB-side RLS is the real gate;
  // cloud mode hides them below the matrix roles, local mode stays open.
  const { can } = usePermissions()
  const cloud = ctx?.adapterMode === 'supabase'
  const canCreate = !cloud || can('project.create')
  const canDelete = !cloud || can('project.delete')

  const projects = Object.values(projectsIndex).sort((a, b) => {
    const ad = a.updated_at ? new Date(a.updated_at).getTime() : 0
    const bd = b.updated_at ? new Date(b.updated_at).getTime() : 0
    return bd - ad
  })

  const [view, setView] = useState('list') // 'list' | 'create' | 'detail'
  const [activeId, setActiveId] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [saveError, setSaveError] = useState('')
  const [busy, setBusy] = useState(false)

  const activeProject = projects.find(p => p.id === activeId) || null

  // ── Create / open / delete ────────────────────────────────
  const handleCreateProject = async () => {
    if (!newTitle.trim() || !createProject) return
    setBusy(true)
    setSaveError('')
    try {
      const created = await createProject({
        title:        newTitle.trim(),
        description:  '',
        status:       'active',
        documents:    [],
        visualAssets: [],
      })
      setNewTitle('')
      if (created?.id) {
        setActiveId(created.id)
        setActiveProject?.(created.id)
        setView('detail')
      }
    } catch (err) {
      setSaveError(err.message || 'Failed to create project.')
    } finally {
      setBusy(false)
    }
  }

  const handleOpen = (id) => {
    setActiveId(id)
    setActiveProject?.(id)
    setView('detail')
    // Session 27: the cloud file rows are fetched per project rather than
    // read from the provider bundle, because this page's selection and
    // RabbitProvider's activeProjectId are separate state.
    setCloudFiles([])
    setFolders([])
    loadCloudFiles(id)
    loadFolders(id)
  }

  const handleDeleteProject = async (id) => {
    if (!deleteProject) return
    try {
      await deleteProject(id)
      setDeleteConfirm(null)
      if (activeId === id) {
        setActiveId(null)
        setView('list')
      }
    } catch (err) {
      setSaveError(err.message || 'Failed to delete project.')
    }
  }

  const updateActive = useCallback(async (patch) => {
    if (!activeId || !updateProject) return
    try {
      await updateProject(activeId, patch)
      setSaveError('')
    } catch (err) {
      setSaveError(err.message || 'Failed to save changes.')
    }
  }, [activeId, updateProject])

  // ── Cloud project files (Session 27) ──────────────────────
  //
  // The rows in `public.files` + the rabbit-files bucket, which is where a
  // cloud project's files have actually lived since S14. This page never
  // showed them: it only ever knew about the DOG-side documents/visualAssets
  // arrays on the project row.
  //
  // 🚨 Read with the adapter DIRECTLY and an explicit project id, never
  // through ctx.uploadFile / ctx.files. Those are scoped to RabbitProvider's
  // activeProjectId, and this page has its OWN selection — opening a project
  // here sets the active one, but the two are separate pieces of state and
  // nothing guarantees they agree at the moment of a write. Uploading through
  // the context would eventually file somebody's brief into whichever project
  // RABBIT happened to have open.
  const [cloudFiles, setCloudFiles] = useState([])
  const [folders, setFolders] = useState([])
  const [filesBusy, setFilesBusy] = useState(false)

  // The folder tree (0041) for the selected project, so this page can show
  // WHERE the project's files live and that the folder describes itself.
  // Audrey, 2026-08-03: "these details of the project should also be seen in
  // the project page in the resources section of wilson."
  const loadFolders = useCallback(async (projectId) => {
    const adapter = ctx?.getAdapter?.()
    if (!adapter?.listFolders || !projectId) { setFolders([]); return }
    try {
      setFolders(await adapter.listFolders(projectId) || [])
    } catch {
      setFolders([])
    }
  }, [ctx])

  const loadCloudFiles = useCallback(async (projectId) => {
    const adapter = ctx?.getAdapter?.()
    if (!adapter?.listFiles || !projectId) { setCloudFiles([]); return }
    try {
      const rows = await adapter.listFiles(projectId)
      // Invoices are manager-only and have their own surface in the budget.
      // RLS already hides them from anyone who cannot see them — this stops a
      // manager finding them mixed in with the project's ordinary documents.
      setCloudFiles((rows || []).filter(f => !f.deleted_at && !f.is_financial))
    } catch {
      // A backend that cannot list files is not an error on this page; the
      // legacy arrays below still render.
      setCloudFiles([])
    }
  }, [ctx])

  // ── Unified file handlers ─────────────────────────────────

  /** Upload files — auto-sorts into documents or visualAssets by MIME type */
  const handleFileUpload = useCallback(async (fileList) => {
    if (!activeProject) return

    // 🚨 In CLOUD mode the legacy path below cannot work and has not since
    // S12. documents/visualAssets have no columns on the cloud `projects`
    // table, and the adapter REFUSES a create or update carrying them rather
    // than dropping them silently (supabaseAdapter's ATTACHMENTS_MSG, added in
    // S15 precisely so files could not vanish). So the drop zone on this page
    // has been showing an honest error and going nowhere — the message even
    // tells the user to go and do it in RABBIT instead.
    //
    // This is the other half of that fix, deferred at the time as MASTER_PLAN
    // §6 #31: the cloud home for project files exists, so use it.
    //
    // Local Server is deliberately NOT rerouted. There the legacy arrays are a
    // working store that persists in the JSON bundle, and D.O.G. reads them
    // for deck context — switching that path would be a silent behaviour
    // change to a tool this session is not otherwise touching.
    if (cloud) {
      const adapter = ctx?.getAdapter?.()
      if (!adapter?.uploadFile) {
        setSaveError('This backend cannot store files.')
        return
      }
      setFilesBusy(true)
      setSaveError('')
      try {
        for (const file of Array.from(fileList)) {
          await adapter.uploadFile(activeProject.id, {}, file)
        }
        await loadCloudFiles(activeProject.id)
      } catch (err) {
        setSaveError(err.message || 'Upload failed.')
      } finally {
        setFilesBusy(false)
      }
      return
    }

    const promises = Array.from(fileList).map(file => new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        const isImg = isMediaMime(file.type)
        resolve({
          id:              newFileId(),
          name:            file.name,
          content:         reader.result,
          type:            file.type,
          size:            file.size,
          is_image:        isImg,
          is_core_definer: false,
          document_kind:   isImg ? null : (detectDocumentKind(file.name) || null),
          description:     '',
          created_at:      new Date().toISOString(),
        })
      }
      reader.readAsDataURL(file)
    }))

    Promise.all(promises).then(newFiles => {
      const docFiles = newFiles.filter(f => !f.is_image)
      const imgFiles = newFiles.filter(f => f.is_image)
      const existingDocs   = Array.isArray(activeProject.documents)    ? activeProject.documents    : []
      const existingAssets = Array.isArray(activeProject.visualAssets) ? activeProject.visualAssets : []
      updateActive({
        documents:    [...existingDocs, ...docFiles],
        visualAssets: [...existingAssets, ...imgFiles],
      })
    })
  }, [activeProject, updateActive, cloud, ctx, loadCloudFiles])

  /** Update a file property (is_core_definer, description, document_kind, etc.) */
  const handleFileUpdate = useCallback((fileId, patch) => {
    if (!activeProject) return

    // A cloud row is not in either legacy array, so it has to be recognised
    // FIRST — otherwise both findIndex calls miss, the function returns
    // silently, and marking a file as core appears to do nothing.
    const cloudRow = cloudFiles.find(f => f.id === fileId)
    if (cloudRow) {
      const adapter = ctx?.getAdapter?.()
      if (!adapter?.updateFile) return
      setCloudFiles(prev => prev.map(f => (f.id === fileId ? { ...f, ...patch } : f)))
      adapter.updateFile(fileId, { ...patch, project_id: activeProject.id })
        .catch(err => setSaveError(err.message || 'Failed to update file.'))
      return
    }

    const docs   = Array.isArray(activeProject.documents)    ? [...activeProject.documents]    : []
    const assets = Array.isArray(activeProject.visualAssets) ? [...activeProject.visualAssets] : []

    const docIdx = docs.findIndex(f => f.id === fileId)
    if (docIdx >= 0) {
      docs[docIdx] = { ...docs[docIdx], ...patch }
      updateActive({ documents: docs })
      return
    }

    const assetIdx = assets.findIndex(f => f.id === fileId)
    if (assetIdx >= 0) {
      assets[assetIdx] = { ...assets[assetIdx], ...patch }
      updateActive({ visualAssets: assets })
    }
  }, [activeProject, updateActive, cloudFiles, ctx])

  /** Remove a file — a cloud row, or an entry in either legacy array */
  const handleFileDelete = useCallback((fileId) => {
    if (!activeProject) return

    const cloudRow = cloudFiles.find(f => f.id === fileId)
    if (cloudRow) {
      const adapter = ctx?.getAdapter?.()
      if (!adapter?.deleteFile) return
      // Soft delete in cloud (0014): the row keeps deleted_at and the blob is
      // deliberately left in place so a restore has something to restore.
      setCloudFiles(prev => prev.filter(f => f.id !== fileId))
      adapter.deleteFile(fileId, activeProject.id)
        .catch(err => {
          setSaveError(err.message || 'Failed to delete file.')
          loadCloudFiles(activeProject.id)
        })
      return
    }

    const docs   = (activeProject.documents    || []).filter(f => f.id !== fileId)
    const assets = (activeProject.visualAssets || []).filter(f => f.id !== fileId)
    updateActive({ documents: docs, visualAssets: assets })
  }, [activeProject, updateActive, cloudFiles, ctx, loadCloudFiles])

  // ── Create prompt view ────────────────────────────────────
  if (view === 'create') {
    return (
      <div className="h-full flex items-center justify-center px-8">
        <div className="w-full max-w-md">
          <h2 className="text-lg font-bold uppercase tracking-widest text-stone-300 mb-6 text-center">
            Create New Project
          </h2>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProject() }}
            placeholder="Enter project title..."
            autoFocus
            className="w-full px-4 py-3 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
          />
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => { setView('list'); setNewTitle('') }}
              className="flex-1 px-4 py-2 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors"
              style={{ backgroundColor: '#44403c', color: '#a8a29e' }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreateProject}
              disabled={busy || !newTitle.trim()}
              className="flex-1 px-4 py-2 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors disabled:opacity-40"
              style={{ backgroundColor: '#ea580c', color: '#fff' }}
            >
              {busy ? 'Creating...' : 'Create'}
            </button>
          </div>
          {saveError && (
            <div className="mt-3 text-xs text-red-400 px-3 py-2 rounded-sm" style={{ backgroundColor: '#1c1917', border: '1px solid #991b1b' }}>
              {saveError}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Detail view ───────────────────────────────────────────
  if (view === 'detail' && activeProject) {
    // Normalize fields the detail panel expects
    const normalized = {
      ...activeProject,
      title:           activeProject.title       || '',
      description:     activeProject.description || '',
      status:          activeProject.status      || 'active',
      startDate:       activeProject.startDate   || activeProject.start_date || '',
      endDate:         activeProject.endDate     || activeProject.end_date   || '',
      client_name:     activeProject.client_name || '',
      director_id:     activeProject.director_id || '',
      producer_id:     activeProject.producer_id || '',
      budget_total:    activeProject.budget_total ?? null,
      budget_currency: activeProject.budget_currency || 'USD',
      folder_root:     activeProject.folder_root || '',
      documents:       Array.isArray(activeProject.documents)    ? activeProject.documents    : [],
      visualAssets:    Array.isArray(activeProject.visualAssets) ? activeProject.visualAssets : [],
    }

    // Merge documents + visualAssets + the cloud file rows into one list.
    //
    // Session 27: the third source is new. `public.files` is where a cloud
    // project's files have actually lived since S14 and this page had never
    // shown them, so a file uploaded from RABBIT was invisible here and a file
    // "uploaded" here never existed at all.
    //
    // The two legacy arrays are still read. They hold real content on Local
    // Server, and on cloud they may hold rows written before S12 stopped
    // accepting them. Nothing writes them in cloud any more, so the list
    // shrinks toward the single store on its own rather than by a migration
    // nobody asked for.
    //
    // ProjectFilesTable keys on `name`, `size`, `type` and `is_image`; a cloud
    // row spells two of those differently, so it is mapped rather than spread.
    const allFiles = [
      ...normalized.documents.map(f => ({
        ...f,
        is_image: f.is_image ?? isMediaMime(f.type),
      })),
      ...normalized.visualAssets.map(f => ({
        ...f,
        is_image: f.is_image ?? true,
      })),
      ...cloudFiles.map(f => ({
        ...f,
        type:       f.mime_type || '',
        size:       f.size_bytes ?? null,
        is_image:   isMediaMime(f.mime_type),
        created_at: f.uploaded_at || f.created_at || null,
        storage:    'cloud',
      })),
    ]

    return (
      <ProjectDetailPanel
        project={normalized}
        onBack={() => { setView('list'); setActiveId(null) }}
        onUpdate={updateActive}
        onOpenInRabbit={() => onNavigate?.('rabbit')}
        onDelete={() => handleDeleteProject(activeProject.id)}
        deleteConfirm={deleteConfirm === activeProject.id}
        onRequestDelete={canDelete ? () => setDeleteConfirm(activeProject.id) : null}
        onCancelDelete={() => setDeleteConfirm(null)}
        allFiles={allFiles}
        folders={folders}
        filesBusy={filesBusy}
        onFileUpdate={handleFileUpdate}
        onFileDelete={handleFileDelete}
        onFileUpload={handleFileUpload}
        saveError={saveError}
        storageWarning={false}
      />
    )
  }

  // ── List view (default) ───────────────────────────────────
  return (
    <ProjectListPanel
      projects={projects}
      onCreate={canCreate ? () => setView('create') : null}
      onOpen={handleOpen}
      onUpdateStatus={(id, status) => updateProject?.(id, { status })}
      deleteConfirm={deleteConfirm}
      onRequestDelete={canDelete ? (id) => setDeleteConfirm(id) : null}
      onConfirmDelete={(id) => handleDeleteProject(id)}
      onCancelDelete={() => setDeleteConfirm(null)}
      saveError={saveError}
      storageWarning={false}
    />
  )
}
