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

  // ── Unified file handlers ─────────────────────────────────

  /** Upload files — auto-sorts into documents or visualAssets by MIME type */
  const handleFileUpload = useCallback((fileList) => {
    if (!activeProject) return
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
  }, [activeProject, updateActive])

  /** Update a file property (is_core_definer, description, document_kind, etc.) */
  const handleFileUpdate = useCallback((fileId, patch) => {
    if (!activeProject) return
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
  }, [activeProject, updateActive])

  /** Remove a file from either array */
  const handleFileDelete = useCallback((fileId) => {
    if (!activeProject) return
    const docs   = (activeProject.documents    || []).filter(f => f.id !== fileId)
    const assets = (activeProject.visualAssets || []).filter(f => f.id !== fileId)
    updateActive({ documents: docs, visualAssets: assets })
  }, [activeProject, updateActive])

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

    // Merge documents + visualAssets into unified file list
    const allFiles = [
      ...normalized.documents.map(f => ({
        ...f,
        is_image: f.is_image ?? isMediaMime(f.type),
      })),
      ...normalized.visualAssets.map(f => ({
        ...f,
        is_image: f.is_image ?? true,
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
        onRequestDelete={() => setDeleteConfirm(activeProject.id)}
        onCancelDelete={() => setDeleteConfirm(null)}
        allFiles={allFiles}
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
      onCreate={() => setView('create')}
      onOpen={handleOpen}
      onUpdateStatus={(id, status) => updateProject?.(id, { status })}
      deleteConfirm={deleteConfirm}
      onRequestDelete={(id) => setDeleteConfirm(id)}
      onConfirmDelete={(id) => handleDeleteProject(id)}
      onCancelDelete={() => setDeleteConfirm(null)}
      saveError={saveError}
      storageWarning={false}
    />
  )
}
