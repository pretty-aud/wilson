// ============================================================
// RateCardPage — workspace-level rate card editor
// ============================================================
//
// Two-column shell:
//
//   ┌──────────────────────┬──────────────────────────────────┐
//   │ Importer (left)      │ Editable entries table (right)   │
//   │  • CSV/XLSX (C3)     │                                  │
//   │  • PDF heuristic(C4) │  ← RateCardTable                 │
//   │  • Google Sheets(C5) │                                  │
//   └──────────────────────┴──────────────────────────────────┘
//
// The Rate Card is workspace-scoped, not project-scoped, so this
// page consumes a dedicated `useRateCard()` hook that talks to
// the active adapter directly. Commit 1 ships the shell + table.
// Importers land in Commits 3-5.

import { DollarSign, Upload, AlertCircle, Loader2 } from 'lucide-react'
import { useRateCard } from './useRateCard'
import RateCardTable from './RateCardTable'

export default function RateCardPage() {
  const {
    rateCards,
    activeRateCardId,
    setActiveRateCardId,
    entries,
    loading,
    error,
    addEntry,
    updateEntry,
    deleteEntry,
    makeSlug,
  } = useRateCard()

  const activeCard = rateCards.find(c => c.id === activeRateCardId) || null

  return (
    <div className="h-full w-full flex flex-col" style={{ backgroundColor: '#fef3e8' }}>
      {/* ── Page header ── */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '2px solid #7c2d12', backgroundColor: '#f4a261' }}
      >
        <div className="flex items-center gap-3">
          <DollarSign className="w-5 h-5" style={{ color: '#1c1917' }} />
          <span
            className="font-bold text-sm tracking-widest uppercase"
            style={{ color: '#1c1917' }}
          >
            Rate Card
          </span>
          {activeCard && (
            <span
              className="text-xs font-mono px-2 py-0.5 rounded-sm"
              style={{ backgroundColor: '#fef3e8', color: '#7c2d12', border: '1px solid #7c2d12' }}
            >
              {activeCard.name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {rateCards.length > 1 && (
            <select
              value={activeRateCardId || ''}
              onChange={(e) => setActiveRateCardId(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-700"
              style={{
                backgroundColor: '#fef3e8',
                color: '#1c1917',
                border: '2px solid #7c2d12',
              }}
            >
              {rateCards.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {loading && (
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#7c2d12' }} />
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div
          className="flex items-start gap-2 px-6 py-2"
          style={{ backgroundColor: '#fee2e2', borderBottom: '1px solid #991b1b' }}
        >
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#991b1b' }} />
          <span className="text-xs font-mono" style={{ color: '#991b1b' }}>{error}</span>
        </div>
      )}

      {/* ── Two-column body ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: importer column (placeholder until C3-C5) */}
        <div
          className="flex flex-col w-80 flex-shrink-0"
          style={{ borderRight: '2px solid #7c2d12', backgroundColor: '#fff7ed' }}
        >
          <div
            className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest"
            style={{ color: '#7c2d12', borderBottom: '1px solid #f4a261' }}
          >
            Import
          </div>

          <div className="flex-1 p-4 space-y-3 overflow-auto">
            <ImporterPlaceholder
              label="CSV / XLSX"
              note="Drop a spreadsheet — coming in Commit 3"
              disabled
            />
            <ImporterPlaceholder
              label="PDF"
              note="Heuristic extraction — coming in Commit 4"
              disabled
            />
            <ImporterPlaceholder
              label="Google Sheet"
              note="Public URL fetch — coming in Commit 5"
              disabled
            />

            <div
              className="mt-4 p-3 rounded-sm text-[11px] font-mono leading-relaxed"
              style={{ backgroundColor: '#fef3e8', border: '1px dashed #7c2d12', color: '#7c2d12' }}
            >
              Rate cards live at the workspace level and are reused
              across every RABBIT project for budget rollups.
            </div>
          </div>
        </div>

        {/* Right: editable table */}
        <div className="flex-1 overflow-hidden">
          {activeRateCardId ? (
            <RateCardTable
              entries={entries}
              loading={loading}
              addEntry={addEntry}
              updateEntry={updateEntry}
              deleteEntry={deleteEntry}
              makeSlug={makeSlug}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <span className="text-xs font-mono" style={{ color: '#7c2d12' }}>
                {loading ? 'Loading rate cards…' : 'No rate card available.'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Importer placeholder ───
function ImporterPlaceholder({ label, note, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="w-full flex items-start gap-2 p-3 rounded-sm text-left transition-colors disabled:cursor-not-allowed"
      style={{
        backgroundColor: '#fef3e8',
        border: '2px solid #f4a261',
        color: '#7c2d12',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Upload className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <div className="text-xs font-mono font-bold uppercase tracking-wider">{label}</div>
        <div className="text-[10px] font-mono mt-0.5">{note}</div>
      </div>
    </button>
  )
}
