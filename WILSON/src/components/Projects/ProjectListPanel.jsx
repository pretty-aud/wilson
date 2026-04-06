// ============================================================
// Projects — list panel (table of all legacy IDB projects)
// ============================================================

import { Plus, Trash2 } from 'lucide-react'

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

export default function ProjectListPanel({
  projects,
  onCreate,
  onOpen,
  onUpdateStatus,
  deleteConfirm,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  saveError,
  storageWarning,
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="max-w-4xl mx-auto w-full px-8 py-8 flex-1">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900">
              Projects
            </h2>
            <p className="text-[10px] text-stone-600 mt-0.5">
              Create and manage your deck projects, upload reference documents and visual assets
            </p>
          </div>
          <button
            onClick={onCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors"
            style={{ backgroundColor: '#ea580c', color: '#fff' }}
          >
            <Plus className="w-3.5 h-3.5" />
            New Project
          </button>
        </div>

        {projects.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: '#1c1917' }}>
              <Plus className="w-6 h-6 text-stone-500" />
            </div>
            <p className="text-sm text-stone-700 font-bold mb-1">No projects yet</p>
            <p className="text-xs text-stone-500 mb-4">Create your first project to get started</p>
            <button
              onClick={onCreate}
              className="px-4 py-2 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors"
              style={{ backgroundColor: '#ea580c', color: '#fff' }}
            >
              Create Project
            </button>
          </div>
        ) : (
          /* Project table */
          <div className="rounded-sm overflow-hidden" style={{ backgroundColor: '#1c1917' }}>
            <div className="grid grid-cols-[1fr_90px_120px_120px_40px] gap-4 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-stone-500 border-b border-stone-700">
              <span>Title</span>
              <span>Status</span>
              <span>Start</span>
              <span>End</span>
              <span></span>
            </div>
            {projects.map(project => (
              <div
                key={project.id}
                className="grid grid-cols-[1fr_90px_120px_120px_40px] gap-4 px-4 py-3 border-b border-stone-800 hover:bg-stone-800/50 transition-colors cursor-pointer items-center"
                onClick={() => onOpen(project.id)}
              >
                <span className="text-sm text-orange-400 font-medium truncate">{project.title}</span>
                <span>
                  <select
                    value={project.status || 'active'}
                    onChange={(e) => { e.stopPropagation(); onUpdateStatus(project.id, e.target.value) }}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[11px] font-bold uppercase tracking-wide cursor-pointer rounded-sm px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-500"
                    style={{
                      color: (project.status || 'active') === 'active' ? '#22c55e' : '#ef4444',
                      backgroundColor: '#292524',
                      border: '1px solid #44403c',
                    }}
                  >
                    <option value="active" style={{ color: '#22c55e', backgroundColor: '#1c1917' }}>Active</option>
                    <option value="inactive" style={{ color: '#ef4444', backgroundColor: '#1c1917' }}>Inactive</option>
                  </select>
                </span>
                <span className="text-xs text-stone-500">{formatDate(project.startDate)}</span>
                <span className="text-xs text-stone-500">{formatDate(project.endDate)}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onRequestDelete(project.id) }}
                  className="p-1 text-stone-600 hover:text-red-400 transition-colors"
                  title="Delete project"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Delete confirmation */}
        {deleteConfirm && (
          <div className="mt-3 flex items-center gap-3 px-4 py-2 rounded-sm" style={{ backgroundColor: '#1c1917' }}>
            <span className="text-xs text-red-400 font-bold">
              Delete "{projects.find(p => p.id === deleteConfirm)?.title}"?
            </span>
            <button
              onClick={() => onConfirmDelete(deleteConfirm)}
              className="px-3 py-1 text-xs font-bold uppercase rounded-sm"
              style={{ backgroundColor: '#dc2626', color: '#fff' }}
            >
              Confirm
            </button>
            <button
              onClick={onCancelDelete}
              className="text-xs text-stone-500 hover:text-stone-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {saveError && (
          <div className="mt-3 text-xs text-red-700 bg-red-100/50 px-3 py-2 rounded">
            {saveError}
          </div>
        )}

        {storageWarning && (
          <div className="mt-3 text-xs text-amber-700 bg-amber-100/50 px-3 py-2 rounded">
            Storage usage is high. Consider removing unused files to free up space.
          </div>
        )}
      </div>
    </div>
  )
}
