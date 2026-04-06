// ============================================================
// Projects — page-level container
// ============================================================
//
// Owns the legacy IDB-backed projects state and switches between
// the list panel, the create panel, and the detail panel. Future
// work will fold the RABBIT projects index into the same view.

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  loadProjects as idbLoadProjects,
  saveProjects as idbSaveProjects,
  loadProjectsSync,
  STORAGE_WARNING_BYTES,
} from '../../storage'
import ProjectListPanel from './ProjectListPanel'
import ProjectDetailPanel from './ProjectDetailPanel'

function createEmptyProject(title) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    title: title || 'Untitled Project',
    description: '',
    status: 'active',
    startDate: '',
    endDate: '',
    documents: [],
    visualAssets: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export default function ProjectsPage() {
  // Initialize with sync localStorage data, then hydrate from IndexedDB.
  const [projects, setProjects] = useState(loadProjectsSync)
  const [view, setView] = useState('list') // 'list' | 'create' | 'detail'
  const [activeProjectId, setActiveProjectId] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [storageWarning, setStorageWarning] = useState(false)
  const [saveError, setSaveError] = useState('')
  const saveTimerRef = useRef(null)
  const hydratedRef = useRef(false)

  const activeProject = projects.find(p => p.id === activeProjectId) || null

  // Hydrate from IndexedDB on mount (async — overwrites sync localStorage data if IDB has data).
  useEffect(() => {
    idbLoadProjects().then(idbProjects => {
      if (idbProjects && idbProjects.length > 0) {
        setProjects(idbProjects)
      }
      hydratedRef.current = true
    }).catch(() => {
      hydratedRef.current = true
    })
  }, [])

  // Auto-save with debounce — saves to IndexedDB.
  useEffect(() => {
    if (!hydratedRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      idbSaveProjects(projects).then(bytes => {
        setStorageWarning(bytes > STORAGE_WARNING_BYTES)
        setSaveError('')
      }).catch(err => {
        console.error('[WILSON] Save failed:', err)
        setSaveError('Failed to save — storage may be full.')
      })
    }, 500)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [projects])

  const updateProject = useCallback((id, updates) => {
    setProjects(prev => prev.map(p =>
      p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
    ))
  }, [])

  const handleCreateProject = () => {
    if (!newTitle.trim()) return
    const project = createEmptyProject(newTitle.trim())
    setProjects(prev => [project, ...prev])
    setActiveProjectId(project.id)
    setNewTitle('')
    setView('detail')
  }

  const handleDeleteProject = (id) => {
    setProjects(prev => prev.filter(p => p.id !== id))
    setDeleteConfirm(null)
    if (activeProjectId === id) {
      setActiveProjectId(null)
      setView('list')
    }
  }

  const handleFileUpload = useCallback((projectId, category, files) => {
    const promises = Array.from(files).map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          name: file.name,
          content: reader.result,
          type: file.type,
          size: file.size,
        })
        reader.readAsDataURL(file)
      })
    })

    Promise.all(promises).then(newFiles => {
      setProjects(prev => prev.map(p => {
        if (p.id !== projectId) return p
        return {
          ...p,
          [category]: [...p[category], ...newFiles],
          updatedAt: new Date().toISOString(),
        }
      }))
    })
  }, [])

  const handleRemoveFile = useCallback((projectId, category, fileId) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p
      return {
        ...p,
        [category]: p[category].filter(f => f.id !== fileId),
        updatedAt: new Date().toISOString(),
      }
    }))
  }, [])

  // ── Create prompt view ────────────────────────────────────
  if (view === 'create') {
    return (
      <div className="h-full flex items-center justify-center px-8">
        <div className="w-full max-w-md">
          <h2 className="text-lg font-bold uppercase tracking-widest text-stone-900 mb-6 text-center">
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
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: 'none' }}
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
              disabled={!newTitle.trim()}
              className="flex-1 px-4 py-2 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors disabled:opacity-40"
              style={{ backgroundColor: '#ea580c', color: '#fff' }}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Detail view ───────────────────────────────────────────
  if (view === 'detail' && activeProject) {
    return (
      <ProjectDetailPanel
        project={activeProject}
        onBack={() => { setView('list'); setActiveProjectId(null) }}
        onUpdate={(updates) => updateProject(activeProject.id, updates)}
        onDelete={() => handleDeleteProject(activeProject.id)}
        deleteConfirm={deleteConfirm === activeProject.id}
        onRequestDelete={() => setDeleteConfirm(activeProject.id)}
        onCancelDelete={() => setDeleteConfirm(null)}
        onUploadFiles={(category, files) => handleFileUpload(activeProject.id, category, files)}
        onRemoveFile={(category, fileId) => handleRemoveFile(activeProject.id, category, fileId)}
        saveError={saveError}
        storageWarning={storageWarning}
      />
    )
  }

  // ── List view (default) ───────────────────────────────────
  return (
    <ProjectListPanel
      projects={projects}
      onCreate={() => setView('create')}
      onOpen={(id) => { setActiveProjectId(id); setView('detail') }}
      onUpdateStatus={(id, status) => updateProject(id, { status })}
      deleteConfirm={deleteConfirm}
      onRequestDelete={(id) => setDeleteConfirm(id)}
      onConfirmDelete={(id) => handleDeleteProject(id)}
      onCancelDelete={() => setDeleteConfirm(null)}
      saveError={saveError}
      storageWarning={storageWarning}
    />
  )
}
