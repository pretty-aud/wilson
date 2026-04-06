// ============================================================
// RABBIT — ProjectPicker
// ============================================================
//
// Compact dropdown that lists every project in the workspace
// index and switches the active project on click. Used in the
// RabbitPage header next to the title.
//
// New project creation lives in a tiny inline modal that pops
// from the picker — keeping it co-located so the header stays
// the single source of truth for which project the views see.

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, Folder, X } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'

export default function ProjectPicker() {
  const ctx = useRabbit()
  const projectsIndex = ctx?.projectsIndex || []
  const activeProjectId = ctx?.activeProjectId
  const setActiveProject = ctx?.setActiveProject
  const createProject = ctx?.createProject

  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const active = projectsIndex.find(p => p.id === activeProjectId) || null

  async function handleCreate(e) {
    e?.preventDefault?.()
    if (!newName.trim() || busy) return
    setBusy(true)
    try {
      const created = await createProject({ name: newName.trim() })
      if (created?.id) await setActiveProject(created.id)
      setNewName('')
      setCreateOpen(false)
      setOpen(false)
    } catch {
      /* error surfaced via provider state */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded-sm transition-colors hover:bg-orange-100"
        style={{
          color: '#1c1917',
          backgroundColor: '#fef3e8',
          border: '2px solid #7c2d12',
          minWidth: '180px',
        }}
      >
        <Folder className="w-3.5 h-3.5" style={{ color: '#7c2d12' }} />
        <span className="flex-1 text-left truncate">
          {active ? active.name : <span className="text-stone-500">No project selected</span>}
        </span>
        <ChevronDown className="w-3.5 h-3.5" style={{ color: '#7c2d12' }} />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 right-0 w-72 max-h-80 overflow-auto rounded-sm shadow-xl"
          style={{ backgroundColor: '#fef3e8', border: '2px solid #7c2d12' }}
        >
          {projectsIndex.length === 0 && (
            <div className="px-3 py-2 text-[11px] font-mono" style={{ color: '#7c2d12' }}>
              No projects yet.
            </div>
          )}
          {projectsIndex.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={async () => {
                await setActiveProject(p.id)
                setOpen(false)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-mono hover:bg-orange-100 transition-colors"
              style={{
                color: p.id === activeProjectId ? '#ea580c' : '#1c1917',
                borderBottom: '1px solid #f4a261',
              }}
            >
              <Folder className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="flex-1 truncate">{p.name}</span>
              {p.status && (
                <span className="text-[9px] uppercase tracking-wider" style={{ color: '#7c2d12' }}>
                  {p.status}
                </span>
              )}
            </button>
          ))}

          <button
            type="button"
            onClick={() => { setCreateOpen(true) }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-mono hover:bg-orange-100 transition-colors"
            style={{ color: '#7c2d12', borderTop: '1px solid #f4a261', backgroundColor: '#fff7ed' }}
          >
            <Plus className="w-3.5 h-3.5" />
            New project…
          </button>
        </div>
      )}

      {createOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ backgroundColor: 'rgba(28, 25, 23, 0.6)' }}
          onClick={() => !busy && setCreateOpen(false)}
        >
          <form
            onSubmit={handleCreate}
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col rounded-sm shadow-2xl"
            style={{
              width: 'min(440px, 92vw)',
              backgroundColor: '#fef3e8',
              border: '2px solid #7c2d12',
            }}
          >
            <div
              className="flex items-center justify-between px-5 py-3"
              style={{ borderBottom: '2px solid #7c2d12', backgroundColor: '#f4a261' }}
            >
              <span className="text-xs font-mono font-bold uppercase tracking-widest" style={{ color: '#1c1917' }}>
                New project
              </span>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                disabled={busy}
                className="p-1 rounded-sm hover:bg-orange-200 disabled:opacity-30"
                style={{ color: '#1c1917' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4">
              <label className="block text-[10px] font-mono uppercase tracking-widest mb-1" style={{ color: '#7c2d12' }}>
                Project name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={busy}
                autoFocus
                placeholder="e.g. Falcon Heavy Pitch Trailer"
                className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-700"
                style={{ backgroundColor: '#fff', color: '#1c1917', border: '2px solid #f4a261' }}
              />
            </div>

            <div
              className="flex items-center justify-end gap-2 px-5 py-3"
              style={{ borderTop: '1px solid #f4a261', backgroundColor: '#fff7ed' }}
            >
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                disabled={busy}
                className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm disabled:opacity-30"
                style={{ color: '#7c2d12', border: '1px solid #7c2d12', backgroundColor: 'transparent' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !newName.trim()}
                className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm disabled:opacity-30"
                style={{
                  color: '#fff7ed',
                  backgroundColor: '#ea580c',
                  border: '1px solid #7c2d12',
                }}
              >
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
