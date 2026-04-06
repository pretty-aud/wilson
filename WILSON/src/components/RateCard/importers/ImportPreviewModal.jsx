// ============================================================
// ImportPreviewModal — review parsed rows before committing
// ============================================================
//
// Used by every Rate Card importer (CSV, XLSX, PDF, GSheets).
// Shows the parsed rows in a scrollable table, surfaces any
// header-mapping warnings or per-row errors, and offers a
// single Confirm button that calls `onConfirm(rows)`.
//
// The host page is responsible for actually pushing the rows
// into the rate card via `bulkUpsertEntries(rows)`.

import { useEffect } from 'react'
import { X, CheckCircle2, AlertTriangle, FileWarning } from 'lucide-react'

function fmtCurrency(value, currency) {
  if (value === null || value === undefined || value === '') return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return String(value)
  }
}

export default function ImportPreviewModal({
  open,
  source,         // 'CSV' | 'XLSX' | 'PDF' | 'Google Sheet'
  fileName,
  result,         // { rows, columns, unmapped, totalRows, errors, sheetName? }
  busy,
  onClose,
  onConfirm,
}) {
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open || !result) return null

  const { rows = [], unmapped = [], totalRows = 0, errors = [], sheetName } = result
  const canConfirm = rows.length > 0 && !busy

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(28, 25, 23, 0.6)' }}
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col rounded-sm shadow-2xl"
        style={{
          width: 'min(900px, 92vw)',
          maxHeight: '80vh',
          backgroundColor: '#fef3e8',
          border: '2px solid #7c2d12',
        }}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '2px solid #7c2d12', backgroundColor: '#f4a261' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono font-bold uppercase tracking-widest" style={{ color: '#1c1917' }}>
              Import {source} preview
            </span>
            {fileName && (
              <span
                className="text-[11px] font-mono px-2 py-0.5 rounded-sm"
                style={{ backgroundColor: '#fef3e8', color: '#7c2d12', border: '1px solid #7c2d12' }}
              >
                {fileName}{sheetName ? ` › ${sheetName}` : ''}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1 rounded-sm hover:bg-orange-200 disabled:opacity-30 transition-colors"
            style={{ color: '#1c1917' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Status strip ── */}
        <div className="px-5 py-2 flex items-center gap-4 text-[11px] font-mono" style={{ color: '#7c2d12' }}>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {rows.length} row{rows.length === 1 ? '' : 's'} ready
          </span>
          <span className="text-stone-500">/ {totalRows} parsed</span>
          {unmapped.length > 0 && (
            <span className="flex items-center gap-1" style={{ color: '#a16207' }}>
              <AlertTriangle className="w-3.5 h-3.5" />
              {unmapped.length} column{unmapped.length === 1 ? '' : 's'} ignored
            </span>
          )}
          {errors.length > 0 && (
            <span className="flex items-center gap-1" style={{ color: '#991b1b' }}>
              <FileWarning className="w-3.5 h-3.5" />
              {errors.length} error{errors.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {/* ── Errors panel ── */}
        {errors.length > 0 && (
          <div
            className="mx-5 mb-2 p-2 rounded-sm text-[11px] font-mono max-h-24 overflow-auto"
            style={{ backgroundColor: '#fee2e2', border: '1px solid #991b1b', color: '#991b1b' }}
          >
            {errors.map((e, i) => <div key={i}>• {e}</div>)}
          </div>
        )}

        {/* ── Unmapped warning ── */}
        {unmapped.length > 0 && (
          <div
            className="mx-5 mb-2 p-2 rounded-sm text-[11px] font-mono"
            style={{ backgroundColor: '#fef3c7', border: '1px solid #a16207', color: '#7c2d12' }}
          >
            Ignored columns: {unmapped.map(u => u.header).filter(Boolean).join(', ') || '(blank headers)'}
          </div>
        )}

        {/* ── Preview table ── */}
        <div className="flex-1 overflow-auto mx-5 mb-3 rounded-sm" style={{ border: '1px solid #f4a261' }}>
          <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead className="sticky top-0 z-10">
              <tr style={{ backgroundColor: '#f4a261' }}>
                {['Role', 'Slug', 'Currency', 'Day', 'Week', 'Month', 'Region', 'Size'].map((h, i) => (
                  <th
                    key={h}
                    className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-left"
                    style={{
                      color: '#1c1917',
                      borderBottom: '1px solid #7c2d12',
                      textAlign: i >= 3 && i <= 5 ? 'right' : 'left',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-xs text-stone-500 font-mono">
                    No rows could be parsed.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-orange-50">
                  <td className="px-2 py-1 text-xs" style={{ color: '#1c1917' }}>{r.role_label}</td>
                  <td className="px-2 py-1 text-xs font-mono" style={{ color: '#7c2d12' }}>{r.role_slug}</td>
                  <td className="px-2 py-1 text-xs font-mono" style={{ color: '#7c2d12' }}>{r.currency || 'USD'}</td>
                  <td className="px-2 py-1 text-xs font-mono text-right" style={{ color: '#1c1917' }}>{fmtCurrency(r.day_rate, r.currency)}</td>
                  <td className="px-2 py-1 text-xs font-mono text-right" style={{ color: '#1c1917' }}>{fmtCurrency(r.week_rate, r.currency)}</td>
                  <td className="px-2 py-1 text-xs font-mono text-right" style={{ color: '#1c1917' }}>{fmtCurrency(r.month_rate, r.currency)}</td>
                  <td className="px-2 py-1 text-xs" style={{ color: '#1c1917' }}>{r.region || '—'}</td>
                  <td className="px-2 py-1 text-xs" style={{ color: '#1c1917' }}>{r.project_size || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Footer ── */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: '1px solid #f4a261', backgroundColor: '#fff7ed' }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
            style={{ color: '#7c2d12', border: '1px solid #7c2d12', backgroundColor: 'transparent' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(rows)}
            disabled={!canConfirm}
            className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
            style={{
              color: '#fff7ed',
              backgroundColor: '#ea580c',
              border: '1px solid #7c2d12',
            }}
          >
            {busy ? 'Importing…' : `Add ${rows.length} row${rows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
