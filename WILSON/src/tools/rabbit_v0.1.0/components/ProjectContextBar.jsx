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
//   • Two named slots, `presenceSlot` and `adapterSlot` (below)
// Reads from RabbitProvider.
//
// ── The two named slots (Q10; B1, 2026-09-23) ───────────────────────────────
// Audrey ruled "no shortcut bar anywhere" (Q10). The Bins footer bar goes in
// B6, and the two things that sat on it — the storage adapter's status dot
// and the realtime presence pill, both drawn by Rabbit.jsx as corner overlays
// — dock HERE instead, so they sit on a surface on every view rather than
// over content (V1-08).
//
//   presenceSlot  any node; rendered first. Rabbit.jsx passes the LIVE / SYNC
//                 pill plus the avatars of who else has the project open. It
//                 renders nothing while realtime is off (Local Server mode).
//   adapterSlot   any node; rendered after presence, before Switch. Rabbit.jsx
//                 passes the adapter dot (online / offline / unconfigured,
//                 with its mode in the tooltip).
//
// Both render inside `[data-slot="status"]`, each in its own
// `[data-slot="presence"]` / `[data-slot="adapter"]` wrapper. The wrappers
// are `display: contents`, so an empty slot takes no room and adds no gap.
// Omit both and the bar renders exactly as it did without them. The bar is
// drawn on every view except Summary; on Summary Rabbit.jsx docks the same two
// nodes at the tab bar's right end (see its comment).
//
// ── The look (B1 restyle) ────────────────────────────────────────────────────
// The kit's Toolbar: 44px, the 24px page gutter, one hairline, every control
// 28px on one centre line. The status is the kit's StatusBadge (a dot plus
// the word at the Label step) — the three greens and the filled orange pill
// it replaces were four of the review's five disagreeing status maps (R07).
// The switcher is a floating surface, so it alone carries the one shadow.

import { useState, useRef, useEffect } from 'react'
import { Folder, ChevronDown, Check } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { Toolbar } from '../../../ui/Toolbar'
import { Button } from '../../../ui/Button'
import { StatusBadge } from '../../../ui/StatusBadge'
import '../rabbitShell.css'

export default function ProjectContextBar({ presenceSlot = null, adapterSlot = null } = {}) {
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

  const right = (
    <>
      {/* The two named slots (Q10): presence, then the adapter dot. */}
      {(presenceSlot || adapterSlot) && (
        <div className="rb-ctx-status-group" data-slot="status">
          <span className="contents" data-slot="presence">{presenceSlot}</span>
          <span className="contents" data-slot="adapter">{adapterSlot}</span>
        </div>
      )}

      {/* Switcher dropdown */}
      <div ref={wrapperRef} className="relative">
        <Button size="sm" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          Switch
          <ChevronDown className="rb-ctx-chevron" aria-hidden="true" />
        </Button>
        {open && (
          <div className="rb-ctx-menu">
            {projects.length === 0 ? (
              <div className="rb-ctx-menu-empty text-dense">No projects yet.</div>
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
                    className="rb-ctx-option text-dense"
                    data-active={isActive ? 'true' : undefined}
                  >
                    <span className="rb-ctx-option-mark" aria-hidden="true">
                      {isActive && <Check />}
                    </span>
                    <span className="rb-ctx-option-title">{p.title || 'Untitled'}</span>
                    {p.status && <StatusBadge status={p.status} />}
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>
    </>
  )

  return (
    <Toolbar className="rb-ctx" right={right}>
      <Folder className="rb-ctx-icon" aria-hidden="true" />
      <span className="text-label uppercase rb-ctx-eyebrow">Project</span>
      <span className="rb-ctx-title text-h3" data-empty={project ? undefined : 'true'}>
        {project?.title || (activeProjectId ? 'Loading…' : 'No project selected')}
      </span>
      {status && <StatusBadge status={status} />}
    </Toolbar>
  )
}
