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
import { adapterSupportsWrites } from '../../tools/rabbit_v0.1.0/adapters'
import { usePermissions } from '../../permissions/usePermissions'
import { detectDocumentKind } from '../../tools/rabbit_v0.1.0/components/ProjectFilesTable'
import { documentKindFor, NEW_ATTACHMENT_IS_CORE } from '../../tools/rabbit_v0.1.0/deckAttachments'
import ProjectListPanel from './ProjectListPanel'
import ProjectDetailPanel from './ProjectDetailPanel'
import { LIGHT_INK } from '../lightSurface'

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
  // 🚨 §6 #31 trap (f): gate on the adapter MODE, never on
  // `typeof adapter.uploadFile`. Every adapter HAS an uploadFile — the Google
  // Drive one is `readOnly('uploadFile')`, a function that throws — so a
  // typeof check reads as "this backend can store files" for the one backend
  // that cannot. adapterSupportsWrites is the existing answer to exactly this
  // question ('supabase' or 'local_server') and is what RabbitProvider itself
  // uses before writing folders.
  const canStoreFiles = adapterSupportsWrites(ctx?.adapterMode)
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
    setFileRows([])
    setFolders([])
    loadFileRows(id)
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

  // ── The project's file rows (Session 27; both backends since C3) ──
  //
  // `public.files` + the rabbit-files bucket in cloud mode, `bundle.files` +
  // the project's files directory on Local Server. This page never showed
  // either: it only ever knew about the DOG-side documents/visualAssets
  // arrays on the project row.
  //
  // ⚠️ NAMED `fileRows`, NOT `cloudFiles`. S27 called it cloudFiles because it
  // only ever held cloud rows; C3's reroute makes Local Server fill the same
  // state, and a name that says "cloud" would have been read as "this branch
  // is cloud-only" by the next person the way it was by this one.
  //
  // 🚨 Read with the adapter DIRECTLY and an explicit project id, never
  // through ctx.uploadFile / ctx.files. Those are scoped to RabbitProvider's
  // activeProjectId, and this page has its OWN selection — opening a project
  // here sets the active one, but the two are separate pieces of state and
  // nothing guarantees they agree at the moment of a write. Uploading through
  // the context would eventually file somebody's brief into whichever project
  // RABBIT happened to have open.
  const [fileRows, setFileRows] = useState([])
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

  const loadFileRows = useCallback(async (projectId) => {
    const adapter = ctx?.getAdapter?.()
    if (!adapter?.listFiles || !projectId) { setFileRows([]); return }
    try {
      const rows = await adapter.listFiles(projectId)
      // Invoices are manager-only and have their own surface in the budget.
      // RLS already hides them from anyone who cannot see them — this stops a
      // manager finding them mixed in with the project's ordinary documents.
      // Local Server mirrors is_financial on its own rows (0038's twin in
      // electron/main.cjs), so the one filter is right on both backends.
      setFileRows((rows || []).filter(f => !f.deleted_at && !f.is_financial))
    } catch {
      // A backend that cannot list files is not an error on this page; the
      // legacy arrays below still render.
      setFileRows([])
    }
  }, [ctx])

  // ── Unified file handlers ─────────────────────────────────

  /**
   * Upload files into the project's ONE file store, on every backend that has
   * one.
   *
   * 🚨 SESSION 27 REROUTED CLOUD; C3 REROUTES LOCAL SERVER, AND THAT IS THE
   * WHOLE POINT OF MASTER_PLAN §6 #31. S27's note here said Local Server was
   * "deliberately NOT rerouted" because switching it would be a silent
   * behaviour change to a tool this session is not otherwise touching. C3 IS
   * that session. Leaving it split is what breaks Audrey's parity rule
   * (2026-08-10, "all functionality should be the same in both versions of the
   * app"): the same drop zone wrote base64 into a project-row array on the
   * desktop and a real files row in the cloud, so a project's attachments
   * meant two different things and D.O.G. could only ever read one of them.
   *
   * Both write-capable backends now take the same path: adapter.uploadFile →
   * a row in public.files (cloud) or bundle.files (Local Server) → the body in
   * rabbit-files or the project's files directory. uploadFile has worked on
   * the web, the desktop, Supabase and Local Server since S24's
   * InvoiceAttachment rode it, so the parity is free rather than built.
   *
   * 🚨 §6 #31 trap (e) — LOCAL MODE STAYS READABLE. Nothing here touches the
   * legacy documents/visualAssets arrays, and the detail panel below still
   * merges them into the list. An old project's attachments keep rendering and
   * keep feeding D.O.G. exactly as before; only NEW files go to the store. The
   * one-time move is Settings → Migration (runAttachmentMigration), on her
   * command and with a dry run, never as a side effect of opening a page.
   */
  const handleFileUpload = useCallback(async (fileList) => {
    if (!activeProject) return
    if (!canStoreFiles) {
      // Drive: readOnly('uploadFile') would throw a less useful sentence.
      setSaveError('This backend is read-only — files cannot be uploaded to it.')
      return
    }
    const adapter = ctx?.getAdapter?.()
    if (!adapter?.uploadFile) {
      setSaveError('This backend cannot store files.')
      return
    }
    setFilesBusy(true)
    setSaveError('')
    try {
      for (const file of Array.from(fileList)) {
        await adapter.uploadFile(activeProject.id, {
          // 0075's column. NULL for media — an image is not a document and
          // must not claim a kind (suite 79 probe 4 is why the column allows
          // it) — and the detected kind or 'other' for anything else.
          //
          // 🚨 NOT `detectDocumentKind(name) || null`, which is what the legacy
          // writer on this page did. D.O.G. finds a project's attachments in
          // `files` by `document_kind IS NOT NULL OR mime is image/video`, and
          // detectDocumentKind returns null for a PDF whose name matches none
          // of its heuristics — so "Nightjar_v3.pdf" would upload, list in the
          // grid, and be invisible to generation. §6 #31 trap (c), measured on
          // `legacy.pdf` by this bundle's round-trip diff.
          documentKind: documentKindFor(file.type, file.name, detectDocumentKind),
          // 🚨 §6 #31 trap (b), THE POLARITY — and review round 1 found the
          // first version of this line had it BACKWARDS.
          //
          // The claim it carried was that `false` matched "what the legacy
          // writer on this page already wrote (is_core_definer: false)". It
          // did write that key, and NOTHING READ IT: D.O.G.'s legacy reader
          // looks at `doc.isCore`, which that writer never set, and reads a
          // missing flag as CORE. So the identical gesture — drop a brief on
          // Resources, Local Server — produced a CORE file before C3 and a
          // REFERENCE file after it: "a primary source of truth for what this
          // project IS" became "supporting reference material only", silently,
          // with nothing failing. That is exactly the consequence §6 #31's
          // disposition row names, arriving through the WRITE path while both
          // measured diffs — which cover the read path and the migration —
          // stayed at zero.
          //
          // CORE it is, which is also what runAttachmentMigration carries
          // across, so a brief dropped today means what one dropped last month
          // means. See deckAttachments.NEW_ATTACHMENT_IS_CORE for the RABBIT
          // side of this flag.
          isCoreDefiner: NEW_ATTACHMENT_IS_CORE,
        }, file)
      }
      await loadFileRows(activeProject.id)
    } catch (err) {
      setSaveError(err.message || 'Upload failed.')
    } finally {
      setFilesBusy(false)
    }
  }, [activeProject, canStoreFiles, ctx, loadFileRows])

  /** Update a file property (is_core_definer, description, document_kind, etc.) */
  const handleFileUpdate = useCallback((fileId, patch) => {
    if (!activeProject) return

    // A stored row is not in either legacy array, so it has to be recognised
    // FIRST — otherwise both findIndex calls miss, the function returns
    // silently, and marking a file as core appears to do nothing.
    //
    // ⚠️ Until 0075 this optimistic setState was the ONLY thing that happened
    // to document_kind and description on a cloud row: neither was a column,
    // so toColumns stripped both and the PATCH was a no-op the local state
    // hid until the next listFiles(). The write is real now — FILE_COLUMNS
    // carries both names and columnAllowlist.test.js pins them.
    const storedRow = fileRows.find(f => f.id === fileId)
    if (storedRow) {
      // 🚨 Review round 2, §6 #31 trap (f) — the SAME defect D.O.G.'s Core
      // toggle had, on the sibling surface that finding was about, left
      // unfixed by round 1. `if (!adapter?.updateFile)` is the typeof check
      // the trap names: Drive's is `readOnly('updateFile')`, a function that
      // throws, so the guard passes.
      if (!canStoreFiles) {
        setSaveError('This backend is read-only — files cannot be changed on it.')
        return
      }
      const adapter = ctx?.getAdapter?.()
      if (!adapter?.updateFile) return
      // 🚨 AND IT REVERTS. Round 1 fixed the optimistic-write-with-no-revert
      // in D.O.G. and left it here, where its own sibling `handleFileDelete`
      // already re-reads on failure: a rejected write left the Core tick, the
      // Kind or the Description showing a value the row does not have, with an
      // error message beside it, until the project was reopened.
      const before = storedRow
      setFileRows(prev => prev.map(f => (f.id === fileId ? { ...f, ...patch } : f)))
      adapter.updateFile(fileId, { ...patch, project_id: activeProject.id })
        .catch(err => {
          setSaveError(err.message || 'Failed to update file.')
          setFileRows(prev => prev.map(f => (f.id === fileId ? before : f)))
        })
      return
    }

    const docs   = Array.isArray(activeProject.documents)    ? [...activeProject.documents]    : []
    const assets = Array.isArray(activeProject.visualAssets) ? [...activeProject.visualAssets] : []

    // 🚨 R1: A LEGACY ROW HAS TWO NAMES FOR ONE FLAG, and this page was
    // writing the one nothing reads. ProjectFilesTable's Core checkbox emits
    // `is_core_definer` — right for a stored row, where it is the column — but
    // a legacy entry's CORE/REFERENCE role lives in `isCore`, which is what
    // D.O.G. reads and what runAttachmentMigration carries across. Ticking the
    // box therefore appeared to work and changed nothing about the split the
    // checkbox is captioned for. Both are written so the row is consistent
    // however it is read, and `allFiles` below derives the checkbox's state
    // from `isCore` so an unticked box no longer lies about a CORE file.
    const legacyPatch = ('is_core_definer' in patch)
      ? { ...patch, isCore: !!patch.is_core_definer }
      : patch

    const docIdx = docs.findIndex(f => f.id === fileId)
    if (docIdx >= 0) {
      docs[docIdx] = { ...docs[docIdx], ...legacyPatch }
      updateActive({ documents: docs })
      return
    }

    const assetIdx = assets.findIndex(f => f.id === fileId)
    if (assetIdx >= 0) {
      assets[assetIdx] = { ...assets[assetIdx], ...legacyPatch }
      updateActive({ visualAssets: assets })
    }
  }, [activeProject, updateActive, fileRows, ctx, canStoreFiles])

  /** Remove a file — a stored row, or an entry in either legacy array */
  const handleFileDelete = useCallback((fileId) => {
    if (!activeProject) return

    const storedRow = fileRows.find(f => f.id === fileId)
    if (storedRow) {
      if (!canStoreFiles) {
        setSaveError('This backend is read-only — files cannot be deleted from it.')
        return
      }
      const adapter = ctx?.getAdapter?.()
      if (!adapter?.deleteFile) return
      // 🚨 §6 #31 trap (g), AND IT IS TWO DIFFERENT THINGS. In CLOUD mode
      // deleteFile is a soft delete (0014): the row keeps deleted_at, the blob
      // stays where it is so a restore has something to restore, and the space
      // is held for the 30-day window. On LOCAL SERVER the same call is
      // PERMANENT — electron/main.cjs unlinks the body and certificates it as
      // 'purged', because there is no local trash. One button, two meanings,
      // so the panel is told which one it is (deletesAreSoft) and says so
      // above the table rather than promising "removed" in both.
      setFileRows(prev => prev.filter(f => f.id !== fileId))
      adapter.deleteFile(fileId, activeProject.id)
        .catch(err => {
          setSaveError(err.message || 'Failed to delete file.')
          loadFileRows(activeProject.id)
        })
      return
    }

    const docs   = (activeProject.documents    || []).filter(f => f.id !== fileId)
    const assets = (activeProject.visualAssets || []).filter(f => f.id !== fileId)
    updateActive({ documents: docs, visualAssets: assets })
  }, [activeProject, updateActive, fileRows, ctx, loadFileRows, canStoreFiles])

  // ── Create prompt view ────────────────────────────────────
  if (view === 'create') {
    return (
      <div className="h-full flex items-center justify-center px-8">
        <div className="w-full max-w-md">
          <h2 className="text-lg font-bold uppercase tracking-widest mb-6 text-center" style={{ color: LIGHT_INK }}>
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
    // Session 27 added the third source; C3 made it the one every backend
    // writes to. `public.files` (cloud) and `bundle.files` (Local Server) are
    // where a project's files actually live, and this page had never shown
    // either — so a file uploaded from RABBIT was invisible here and a file
    // "uploaded" here in cloud mode never existed at all.
    //
    // 🚨 §6 #31 trap (e): THE TWO LEGACY ARRAYS ARE STILL READ, on every
    // backend. They hold real content on Local Server for every project that
    // predates C3.
    //
    // ⚠️ THEY CANNOT HOLD ANYTHING IN CLOUD MODE, and this comment used to say
    // they might ("rows written before S12 stopped accepting them"). Review
    // round 2 settled it against the schema: the cloud `projects` table has no
    // such columns and never has, `mapDogProjectFields` deletes both keys, and
    // an insert carrying them 42703s. So the cloud branch of this read is
    // structurally empty — kept because it costs nothing and because the same
    // code serves both backends, not because there is anything there.
    //
    // Nothing writes them any more, so on Local Server the list shrinks toward
    // the single store as Audrey runs the migration — never underneath her.
    //
    // ProjectFilesTable keys on `name`, `size`, `type` and `is_image`; a
    // stored row spells two of those differently, so it is mapped rather than
    // spread.
    const allFiles = [
      // 🚨 R1: the Core checkbox reads `is_core_definer`, and a legacy row's
      // real flag is `isCore` with a DEFAULT OF TRUE. Mapping it here is what
      // makes the box show the state D.O.G. is actually using; without it an
      // unmarked legacy attachment rendered unticked while generating as CORE.
      ...normalized.documents.map(f => ({
        ...f,
        is_core_definer: f.isCore !== false,
        is_image: f.is_image ?? isMediaMime(f.type),
      })),
      ...normalized.visualAssets.map(f => ({
        ...f,
        is_core_definer: f.isCore !== false,
        is_image: f.is_image ?? true,
      })),
      ...fileRows.map(f => ({
        ...f,
        type:       f.mime_type || '',
        size:       f.size_bytes ?? null,
        is_image:   isMediaMime(f.mime_type),
        created_at: f.uploaded_at || f.created_at || null,
        storage:    'stored',
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
        canUpload={canStoreFiles}
        // §6 #31 trap (g). Cloud deletes are soft and hold quota for 30 days;
        // Local Server deletes unlink the body there and then. The panel says
        // which, because "Delete" alone means the wrong one half the time.
        deletesAreSoft={cloud}
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
