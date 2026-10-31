// ============================================================
// RABBIT — ProjectContextBar
// ============================================================
//
// Slim strip below the view tabs that always shows which project
// is currently loaded. Includes:
//
//   • The PROJECT label + title + status pill
//   • A "switch project" dropdown listing every project in the
//     workspace, with the active one marked
//   • One named slot, `presenceSlot` (below)
// Reads from RabbitProvider.
//
// ── The faces, and nothing else on the right (FX11, 2026-10-16) ─────────────
// Audrey: "the project bar has three green dots and its confusing. remove the
// live and additional green dot. just leave the icons that appear for users"
// … "i just want the project status there on that bar next to project name.
// leave to the right the switch dropdown". So: the project's name and status
// on the left; the faces of who else has the project open, then Switch, on
// the right. The LIVE / Sync pill and the adapter dot, which B1 (Q10) docked
// here from the old corner overlays, are gone: the connection is one dot in
// the bottom-left corner of every tab now (ConnectionDot.jsx).
//
//   presenceSlot  any node, rendered before Switch in a `[data-slot="presence"]`
//                 wrapper that is `display: contents`, so an empty slot takes
//                 no room and adds no gap. Rabbit.jsx passes the faces, which
//                 render nothing while realtime is off (Local Server mode) or
//                 nobody else is here.
//
// The bar is drawn on every view except Summary; on Summary Rabbit.jsx docks
// the same faces at the tab bar's right end (see its comment).
//
// ── The look (B1 restyle) ────────────────────────────────────────────────────
// The kit's Toolbar: 44px, the 24px page gutter, one hairline, every control
// 28px on one centre line. The status is the kit's StatusBadge (a dot plus
// the word at the Label step) — the three greens and the filled orange pill
// it replaces were four of the review's five disagreeing status maps (R07).
// The switcher is a floating surface, so it alone carries the one shadow.
//
// ── The label (FX7) ──────────────────────────────────────────────────────────
// Audrey, 2026-10-12: "bid ver and project should be same sizing and color.
// if anything project should stand out more. lets remove the folder icon
// before the word project". PROJECT is the kit's label (`ui-field-label`: the
// Label step at 600, uppercase, the second ink), the class the Timeline's
// "Bid ver." under it wears, with nothing before it on the gutter; both
// labels sit in one column, 5.1em of the label (rabbitShell.css,
// rabbitTimeline.css), so the project's name and the bid version's dropdown
// start at the same x. The name stays the Title step at 600, a step above
// the dropdown's 400 and the version's name beside it, at 400 too.

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { confirmLeave } from '../state/leaveGuard'
import { Toolbar } from '../../../ui/Toolbar'
import { Button } from '../../../ui/Button'
import { StatusBadge } from '../../../ui/StatusBadge'
import { useHeldOffline } from '../../../cloud/auth/heldSession'
import { offlineSentence } from '../../../cloud/ConnectionLostBanner'
import '../rabbitShell.css'

export default function ProjectContextBar({ presenceSlot = null } = {}) {
  const ctx = useRabbit()
  const project = ctx?.project
  const projectsIndex = ctx?.projectsIndex || {}
  const activeProjectId = ctx?.activeProjectId
  const setActiveProject = ctx?.setActiveProject
  // S2 (RECONNECT_DESIGN.md §11.8): a sign-in held at an offline launch, on the cloud adapter.
  const heldOffline = useHeldOffline() && ctx?.adapterMode === 'supabase'

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
      {/* The faces of who else has the project open (FX11), before Switch. */}
      {presenceSlot && <span className="contents" data-slot="presence">{presenceSlot}</span>}

      {/* Switcher dropdown */}
      <div ref={wrapperRef} className="relative">
        <Button size="sm" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          Switch
          <ChevronDown className="rb-ctx-chevron" aria-hidden="true" />
        </Button>
        {open && (
          <div className="rb-ctx-menu">
            {projects.length === 0 ? (
              <div className="rb-ctx-menu-empty text-dense">{heldOffline ? offlineSentence('projects') : 'No projects yet.'}</div>
            ) : (
              projects.map(p => {
                const isActive = p.id === activeProjectId
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={async () => {
                      setOpen(false)
                      // Post-overhaul S3c, step 7 (D12): another project is
                      // an exit — an unsaved edit, or a popup's typed text,
                      // asks first (state/leaveGuard.js). Keep editing stays.
                      if (p.id !== activeProjectId && !(await confirmLeave('project'))) return
                      setActiveProject?.(p.id)
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
      <span className="ui-field-label">Project</span>
      {/* Two elements, not one with a data attribute: `text-h3` carries its
          600 weight from the utilities layer, which no component rule can
          outrank (R1 finding 7), so the empty state takes the Body step. */}
      {project
        ? <span className="rb-ctx-title text-h3">{project.title || (activeProjectId ? 'Loading…' : 'No project selected')}</span>
        : <span className="rb-ctx-title text-body" data-empty="true">{activeProjectId ? 'Loading…' : 'No project selected'}</span>}
      {status && <StatusBadge status={status} />}
    </Toolbar>
  )
}
