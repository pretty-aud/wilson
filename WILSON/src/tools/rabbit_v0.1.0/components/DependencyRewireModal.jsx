// =============================================================================
// DependencyRewireModal — Track A bundle A2 (2026-09-06), Audrey's ruling 7.
//
// The "are you sure" before a dependency re-wire on the timeline. Mounted by
// TimelineView's DetailPane, which owns the gesture and decides when to show
// it (the same ownership shape as AssetStatusWarningModal / ProjectAssetsView
// and PhaseExtendModal / DetailBar).
//
// It states which edge is being replaced and by what, and says plainly that
// the old link is removed before the new one is saved — that is the loss the
// confirm does NOT prevent (docs/OUTSTANDING.md keeps the atomicity entry),
// and hiding it would make the modal a false promise.
// =============================================================================

import { AlertTriangle, ArrowRight, Undo2, Link2 } from 'lucide-react'

export default function DependencyRewireModal({ description, onConfirm, onCancel }) {
  if (!description) return null
  const { kindLabel, predName, oldName, newName } = description
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(28, 25, 23, 0.78)' }}
      // The timeline listens for mousedown to start drags; a click on this
      // backdrop must not reach it.
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onCancel?.() }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="rounded-sm flex flex-col w-full max-w-md"
        style={{ backgroundColor: '#292524', border: '1px solid #fb923c' }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: '1px solid #fb923c', backgroundColor: '#7c2d12' }}
        >
          <AlertTriangle className="w-3.5 h-3.5" style={{ color: '#fed7aa' }} />
          <span className="text-[10.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fed7aa' }}>
            Replace this dependency?
          </span>
        </div>

        <div className="px-4 py-4 flex flex-col gap-3 text-[11.5px] font-mono" style={{ color: '#d6d3d1' }}>
          <p>
            The {kindLabel} link from <span style={{ color: '#fb923c' }}>{predName}</span> will move from
          </p>
          <div
            className="flex flex-col gap-1.5 px-3 py-2 rounded-sm"
            style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider w-10" style={{ color: '#78716c' }}>Old</span>
              <span style={{ color: '#a8a29e', textDecoration: 'line-through' }}>{predName}</span>
              <ArrowRight className="w-3 h-3" style={{ color: '#78716c' }} />
              <span style={{ color: '#a8a29e', textDecoration: 'line-through' }}>{oldName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider w-10" style={{ color: '#78716c' }}>New</span>
              <span style={{ color: '#fb923c' }}>{predName}</span>
              <ArrowRight className="w-3 h-3" style={{ color: '#fb923c' }} />
              <span style={{ color: '#fb923c' }}>{newName}</span>
            </div>
          </div>
          <p style={{ color: '#a8a29e' }}>
            The old link is removed before the new one is saved. If the new link is refused
            — for instance because it already exists — the old one is already gone, and the
            timeline's "Not saved" strip will say so.
          </p>
        </div>

        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid #44403c', backgroundColor: '#1c1917' }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1 px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors"
            style={{ color: '#a8a29e', backgroundColor: 'transparent', border: '1px solid #44403c' }}
          >
            <Undo2 className="w-3 h-3" />
            Keep old link
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-1 px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
          >
            <Link2 className="w-3 h-3" />
            Replace link
          </button>
        </div>
      </div>
    </div>
  )
}
