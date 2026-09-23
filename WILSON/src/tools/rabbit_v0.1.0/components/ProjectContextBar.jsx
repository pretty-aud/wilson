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
// Reads from RabbitProvider.

import { useState, useRef, useEffect } from 'react'
import {
  Folder, ChevronDown, Check, Circle,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import '../rabbitShell.css'

export default function ProjectContextBar() {
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

  return (
    <div
      className="flex items-center gap-3 px-6 py-2"
      style={{ borderBottom: '1px solid #44403c', backgroundColor: '#292524' }}
    >
      <Folder className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#fb923c' }} />

      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-label uppercase" style={{ color: '#78716c' }}>
          Project
        </span>
        <span className="rb-ctx-title text-dense font-semibold truncate" data-empty={project ? undefined : 'true'}>
          {project?.title || (activeProjectId ? 'Loading…' : 'No project selected')}
        </span>
        {status && (
          <span
            className="rb-ctx-status px-1.5 py-0.5 text-label uppercase rounded-control flex-shrink-0"
            data-status={status}
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
          className="flex items-center gap-1 px-2 py-1 text-dense rounded-control transition-colors"
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
            className="absolute right-0 mt-1 z-40 rounded-control shadow-2xl overflow-hidden"
            style={{
              backgroundColor: '#292524',
              border: '1px solid #44403c',
              minWidth: 240,
              maxHeight: 360,
            }}
          >
            <div className="overflow-y-auto" style={{ maxHeight: 360 }}>
              {projects.length === 0 ? (
                <div className="px-3 py-2 text-dense italic" style={{ color: '#78716c' }}>
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
                      className="rb-ctx-option w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-700 transition-colors"
                      data-active={isActive ? 'true' : undefined}
                    >
                      {isActive
                        ? <Check className="w-3 h-3 flex-shrink-0" style={{ color: '#fb923c' }} />
                        : <Circle className="w-3 h-3 flex-shrink-0" style={{ color: '#57534e' }} />}
                      <span className="flex-1 truncate text-dense">{p.title || 'Untitled'}</span>
                      {p.status && (
                        <span className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="rb-ctx-option-dot w-1.5 h-1.5 rounded-full flex-shrink-0" data-status={p.status} />
                          <span className="rb-ctx-option-status text-label uppercase" data-status={p.status}>
                            {p.status}
                          </span>
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

    </div>
  )
}
