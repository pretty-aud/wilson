// ============================================================
// AssetStatusWarningModal
// ============================================================
//
// Modal that explains why a given asset is currently flagged
// with a status mismatch — i.e. the user marked it
// approved/final but at least one child task is still in
// flight. Lists every offending task and lets the user either:
//
//   • Bump the asset back to a "safer" status (in_progress).
//   • Force-confirm by clicking through (no-op — the asset
//     stays as-is, the modal just closes).
//
// Pure presentation + a couple of provider hooks. Owned by
// ProjectAssetsView, which decides when to mount it.

import { AlertTriangle, X, ArrowDownCircle, Check } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
// One definition of "done" — shared with the selectors and with the Phase 7
// predecessor warning (Track A bundle A2, 2026-09-06). The private copy that
// used to sit at the bottom of this file is gone on purpose.
import { isDone } from '../state/dependencyStatus'

export default function AssetStatusWarningModal({ asset, onClose }) {
  const ctx = useRabbit()
  const tasks = ctx?.tasks || []
  if (!asset) return null

  const childTasks = tasks.filter(t => t.asset_id === asset.id)
  const pending = childTasks.filter(t => !isDone(t))

  async function handleBumpBack() {
    try {
      await ctx.updateAsset(asset.id, { status: 'in_progress' })
    } catch (err) {
      console.warn('[RABBIT] failed to bump asset status:', err)
    } finally {
      onClose?.()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(28, 25, 23, 0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div
        className="w-full max-w-md rounded-sm overflow-hidden flex flex-col"
        style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ backgroundColor: '#1c1917', borderBottom: '1px solid #7f1d1d' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" style={{ color: '#fca5a5' }} />
            <span className="text-[11px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fca5a5' }}>
              Status mismatch
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-sm hover:bg-stone-700"
            style={{ color: '#fca5a5' }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-3">
          <p className="text-[12px] font-mono leading-relaxed" style={{ color: '#d6d3d1' }}>
            <span className="font-bold">{asset.name}</span> is marked
            <span
              className="mx-1 px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded-sm"
              style={{ backgroundColor: '#1c1917', color: '#86efac', border: '1px solid #15803d' }}
            >
              {asset.status}
            </span>
            but {pending.length} of its {childTasks.length} task{childTasks.length === 1 ? '' : 's'}
            {pending.length === 1 ? ' is' : ' are'} still in flight.
          </p>

          {pending.length > 0 && (
            <div
              className="rounded-sm overflow-hidden"
              style={{ border: '1px solid #44403c', backgroundColor: '#1c1917' }}
            >
              <div
                className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest"
                style={{ color: '#fb923c', borderBottom: '1px solid #44403c', backgroundColor: '#44403c' }}
              >
                Pending tasks
              </div>
              <div className="max-h-48 overflow-auto">
                {pending.map(t => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 px-3 py-1.5"
                    style={{ borderBottom: '1px solid #292524' }}
                  >
                    <span className="flex-1 text-[11px] font-mono truncate" style={{ color: '#d6d3d1' }}>
                      {t.title}
                    </span>
                    <span
                      className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm"
                      style={{ backgroundColor: '#292524', color: '#fb923c', border: '1px solid #57534e' }}
                    >
                      {t.status || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid #44403c' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm"
            style={{ color: '#a8a29e', border: '1px solid #44403c', backgroundColor: 'transparent' }}
          >
            <Check className="w-3 h-3" />
            Keep as-is
          </button>
          <button
            type="button"
            onClick={handleBumpBack}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm"
            style={{
              color: '#fff7ed',
              backgroundColor: '#ea580c',
              border: '1px solid #c2410c',
            }}
          >
            <ArrowDownCircle className="w-3 h-3" />
            Bump to in-progress
          </button>
        </div>
      </div>
    </div>
  )
}
