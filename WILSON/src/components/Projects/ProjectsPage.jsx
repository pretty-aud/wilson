// ============================================================
// Projects — page-level container
// ============================================================
//
// Hosts two distinct project lists side by side:
//
//   1. RABBIT projects — pulled from RabbitProvider's
//      `projectsIndex` (workspace-scoped, served by the active
//      adapter — Supabase / Local Server / Drive). Clicking one
//      sets it active in the provider and navigates to the
//      RABBIT page.
//
//   2. Legacy DOG projects — IndexedDB-backed deck projects with
//      free-form documents/visualAssets uploads. This section is
//      identical to v0.5 — kept intact so DOG keeps working.
//
// The split lives here in the page container; the two panels
// (ProjectListPanel + ProjectDetailPanel) are still dumb views
// for the legacy data model.

import { useState, useEffect, useCallback, useRef } from 'react'
import { Rabbit as RabbitIcon, Plus, Trash2, ArrowRight } from 'lucide-react'
import {
  loadProjects as idbLoadProjects,
  saveProjects as idbSaveProjects,
  loadProjectsSync,
  STORAGE_WARNING_BYTES,
} from '../../storage'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
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

export default function ProjectsPage({ onNavigate }) {
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
    <div className="flex flex-col">
      <RabbitProjectsSection onNavigate={onNavigate} />
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
    </div>
  )
}

// ─── RABBIT projects section ──────────────────────────────
//
// Reads from RabbitProvider. Renders a compact card list
// above the legacy DOG project table. "Open" sets the
// active project on the provider and navigates to the
// RABBIT page; "New" prompts for a title and creates via
// the active adapter; "Delete" goes through the provider's
// optimistic deleteProject helper.
function RabbitProjectsSection({ onNavigate }) {
  const ctx = useRabbit()
  const projectsIndex = ctx?.projectsIndex || {}
  const adapterStatus = ctx?.adapterStatus
  const setActiveProject = ctx?.setActiveProject
  const createProject = ctx?.createProject
  const deleteProject = ctx?.deleteProject
  const refreshProjectsIndex = ctx?.refreshProjectsIndex

  const [showNewForm, setShowNewForm] = useState(false)
  const [newRabbitTitle, setNewRabbitTitle] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  const projects = Object.values(projectsIndex).sort((a, b) => {
    const ad = a.updated_at ? new Date(a.updated_at).getTime() : 0
    const bd = b.updated_at ? new Date(b.updated_at).getTime() : 0
    return bd - ad
  })

  const open = async (id) => {
    if (!setActiveProject) return
    try {
      await setActiveProject(id)
      onNavigate?.('rabbit')
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  const create = async () => {
    if (!newRabbitTitle.trim() || !createProject) return
    setCreating(true)
    setError(null)
    try {
      const created = await createProject({ title: newRabbitTitle.trim() })
      setNewRabbitTitle('')
      setShowNewForm(false)
      if (created?.id) {
        await setActiveProject(created.id)
        onNavigate?.('rabbit')
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setCreating(false)
    }
  }

  const remove = async (id) => {
    if (!deleteProject) return
    try {
      await deleteProject(id)
      setPendingDeleteId(null)
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  return (
    <div className="max-w-4xl mx-auto w-full px-8 pt-8 pb-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <RabbitIcon className="w-4 h-4" style={{ color: '#ea580c' }} />
          <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900">
            RABBIT Projects
          </h2>
          <span
            className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm"
            style={{
              color: adapterStatus?.online ? '#15803d' : '#991b1b',
              backgroundColor: adapterStatus?.online ? '#dcfce7' : '#fee2e2',
              border: `1px solid ${adapterStatus?.online ? '#15803d' : '#991b1b'}`,
            }}
          >
            {adapterStatus?.online ? 'Online' : 'Offline'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshProjectsIndex?.()}
            className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm"
            style={{ color: '#7c2d12', border: '1px solid #7c2d12', backgroundColor: 'transparent' }}
          >
            Refresh
          </button>
          <button
            onClick={() => setShowNewForm(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors"
            style={{ backgroundColor: '#ea580c', color: '#fff' }}
          >
            <Plus className="w-3.5 h-3.5" />
            New RABBIT Project
          </button>
        </div>
      </div>

      {/* New project inline form */}
      {showNewForm && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-sm mb-3"
          style={{ backgroundColor: '#fff7ed', border: '2px solid #7c2d12' }}
        >
          <input
            type="text"
            autoFocus
            value={newRabbitTitle}
            onChange={(e) => setNewRabbitTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create() }}
            placeholder="New RABBIT project title…"
            className="flex-1 px-2 py-1 text-[12px] font-mono rounded-sm"
            style={{ backgroundColor: '#fef3e8', color: '#1c1917', border: '1px solid #7c2d12' }}
          />
          <button
            onClick={create}
            disabled={creating || !newRabbitTitle.trim()}
            className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider rounded-sm disabled:opacity-40"
            style={{ backgroundColor: '#ea580c', color: '#fff7ed', border: '2px solid #7c2d12' }}
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
          <button
            onClick={() => { setShowNewForm(false); setNewRabbitTitle('') }}
            className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider rounded-sm"
            style={{ color: '#7c2d12', border: '1px solid #7c2d12', backgroundColor: 'transparent' }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Project list */}
      {projects.length === 0 ? (
        <div
          className="px-4 py-6 rounded-sm text-center"
          style={{ backgroundColor: '#fff7ed', border: '2px dashed #7c2d12', color: '#7c2d12' }}
        >
          <p className="text-[11px] font-mono">
            No RABBIT projects yet. Click <span className="font-bold">New RABBIT Project</span> to create one.
          </p>
        </div>
      ) : (
        <div className="rounded-sm overflow-hidden" style={{ backgroundColor: '#fff7ed', border: '2px solid #7c2d12' }}>
          <div
            className="grid grid-cols-[1fr_100px_140px_60px] gap-3 px-4 py-2 text-[10px] font-mono uppercase tracking-widest"
            style={{ color: '#7c2d12', borderBottom: '1px solid #f4a261', backgroundColor: '#fef3e8' }}
          >
            <span>Title</span>
            <span>Status</span>
            <span>Updated</span>
            <span></span>
          </div>
          {projects.map(p => (
            <div
              key={p.id}
              className="grid grid-cols-[1fr_100px_140px_60px] gap-3 px-4 py-2 items-center text-[12px] font-mono"
              style={{ borderBottom: '1px solid #fed7aa', color: '#1c1917' }}
            >
              <button
                type="button"
                onClick={() => open(p.id)}
                className="text-left flex items-center gap-1.5 truncate hover:underline"
                style={{ color: '#ea580c' }}
              >
                {p.title || 'Untitled'}
                <ArrowRight className="w-3 h-3 flex-shrink-0" />
              </button>
              <span
                className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded-sm w-fit"
                style={{
                  color: p.status === 'active' ? '#fff7ed' : '#7c2d12',
                  backgroundColor: p.status === 'active' ? '#15803d' : '#fed7aa',
                  border: `1px solid ${p.status === 'active' ? '#15803d' : '#7c2d12'}`,
                }}
              >
                {p.status || 'draft'}
              </span>
              <span className="text-[10px]" style={{ color: '#7c2d12' }}>{formatRabbitDate(p.updated_at)}</span>
              {pendingDeleteId === p.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => remove(p.id)}
                    className="px-1.5 py-0.5 text-[9px] font-mono uppercase rounded-sm"
                    style={{ backgroundColor: '#991b1b', color: '#fff7ed' }}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setPendingDeleteId(null)}
                    className="px-1.5 py-0.5 text-[9px] font-mono uppercase rounded-sm"
                    style={{ color: '#7c2d12' }}
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setPendingDeleteId(p.id)}
                  className="p-1 justify-self-end"
                  style={{ color: '#7c2d12' }}
                  title="Delete project"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div
          className="mt-3 px-3 py-2 rounded-sm text-[11px] font-mono"
          style={{ color: '#991b1b', backgroundColor: '#fee2e2', border: '1px solid #991b1b' }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

function formatRabbitDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}
