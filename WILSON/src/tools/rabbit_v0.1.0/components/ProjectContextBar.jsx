// ============================================================
// RABBIT — ProjectContextBar
// ============================================================
//
// Slim strip below the view tabs that always shows which project
// is currently loaded. Includes:
//
//   • Project icon + title + status pill
//   • A "switch project" dropdown listing every project in the
//     workspace, with the active one marked
//   • A "Gallery →" link that jumps the user to the Summary tab
//     (which is where the full project gallery now lives)
//
// Reads from RabbitProvider.

import { useState, useRef, useEffect } from 'react'
import {
  Folder, ChevronDown, Check, LayoutGrid, Circle,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'

export default function ProjectContextBar({ onJumpToSummary }) {
  const ctx = useRabbit()
  const project = ctx?.project
  const projectsIndex = ctx?.projectsIndex || {}
  const activeProjectId = ctx?.activeProjectId
  const setActiveProject = ctx?.setActiveProject

  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [open])

  const projects = Object.values(projectsIndex).sort((a, b) => {
    const ad = a.updated_at ? new Date(a.updated_at).getTime() : 0
    const bd = b.updated_at ? new Date(b.updated_at).getTime() : 0
    return bd - ad
  })

  const status = project?.status || (activeProjectId ? 'draft' : null)
  const statusColor =
    status === 'active'   ? '#15803d' :
    status === 'archived' ? '#57534e' :
    status === 'wrapped'  ? '#15803d' :
    '#ea580c'

  return (
    <div
      className="flex items-center gap-3 px-6 py-2"
      style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}
    >
      <Folder className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#fb923c' }} />

      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>
          Project
        </span>
        <span className="text-[12px] font-mono font-bold truncate" style={{ color: project ? '#d6d3d1' : '#78716c' }}>
          {project?.title || (activeProjectId ? 'Loading…' : 'No project selected')}
        </span>
        {status && (
          <span
            className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm flex-shrink-0"
            style={{
              color: '#fff7ed',
              backgroundColor: statusColor,
              border: `1px solid ${statusColor}`,
            }}
          >
            {status}
          </span>
        )}
      </div>

      {/* Switcher dropdown */}
      <div ref={wrapperRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors"
          style={{
            color: '#a8a29e',
            backgroundColor: '#292524',
            border: '1px solid #44403c',
          }}
        >
          Switch
          <ChevronDown className="w-3 h-3" />
        </button>
        {open && (
          <div
            className="absolute right-0 mt-1 z-40 rounded-sm shadow-2xl overflow-hidden"
            style={{
              backgroundColor: '#292524',
              border: '1px solid #44403c',
              minWidth: 240,
              maxHeight: 360,
            }}
          >
            <div className="overflow-y-auto" style={{ maxHeight: 360 }}>
              {projects.length === 0 ? (
                <div className="px-3 py-2 text-[10px] font-mono italic" style={{ color: '#78716c' }}>
                  No projects yet.
                </div>
              ) : (
                projects.map(p => {
                  const isActive = p.id === activeProjectId
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setActiveProject?.(p.id)
                        setOpen(false)
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-700 transition-colors"
                      style={{
                        borderBottom: '1px solid #1c1917',
                        color: isActive ? '#fb923c' : '#d6d3d1',
                      }}
                    >
                      {isActive
                        ? <Check className="w-3 h-3 flex-shrink-0" style={{ color: '#fb923c' }} />
                        : <Circle className="w-3 h-3 flex-shrink-0" style={{ color: '#57534e' }} />}
                      <span className="flex-1 truncate text-[11px] font-mono">{p.title || 'Untitled'}</span>
                      {p.status && (
                        <span className="text-[9px] uppercase tracking-wider" style={{ color: '#78716c' }}>
                          {p.status}
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onJumpToSummary}
        className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors"
        style={{
          color: '#a8a29e',
          backgroundColor: '#292524',
          border: '1px solid #44403c',
        }}
        title="Open the project gallery in the Summary tab"
      >
        <LayoutGrid className="w-3 h-3" />
        Gallery →
      </button>
    </div>
  )
}
