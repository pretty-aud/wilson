// ============================================================
// TopsheetTab — Internal budget topsheet (summary rollup)
// ============================================================
//
// Maps to TOPSHEET - INTERNAL in the Excel template.
// Rolls up all budget sheets into department-level totals:
//   Department | Subtotal | Bid | Actual | Variance | Agency
//
// Shows project meta (EP, Producer, Start Date) and grand totals
// with contingency + markup applied.

import { useMemo } from 'react'
import { FileSpreadsheet, AlertCircle } from 'lucide-react'
import CurrencyDisplay from '../../components/CurrencyDisplay'

function fmtCurrency(val, currency = 'USD') {
  const n = Number(val) || 0
  return n.toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function TopsheetTab({ budgetHook, project, currency }) {
  const { lines, lineComputations } = budgetHook

  const agencyEnabled = project?.budget_agency_enabled === true
  const agencyPct     = Number(project?.budget_agency_pct ?? 0)
  const markupPct     = Number(project?.budget_margin_pct ?? 0)
  const contingencyPct = Number(project?.budget_contingency_pct ?? 0)

  // Roll up by department across all sheets
  const departmentRollup = useMemo(() => {
    const map = {}
    for (const line of lines) {
      if (line.is_section_header) continue
      const dept = line.department || 'Uncategorized'
      if (!map[dept]) map[dept] = { department: dept, subtotal: 0, agencyFee: 0, bidTotal: 0, actualTotal: 0, variance: 0 }
      const comp = lineComputations[line.id]
      if (comp) {
        map[dept].subtotal    += comp.subtotal
        map[dept].agencyFee   += comp.agencyFee
        map[dept].bidTotal    += comp.bidTotal
        map[dept].actualTotal += comp.actualTotal
        map[dept].variance    += comp.variance
      }
    }
    return Object.values(map).sort((a, b) => b.bidTotal - a.bidTotal)
  }, [lines, lineComputations])

  // Grand totals
  const totals = useMemo(() => {
    let subtotal = 0, agency = 0, bid = 0, actual = 0
    for (const r of departmentRollup) {
      subtotal += r.subtotal
      agency   += r.agencyFee
      bid      += r.bidTotal
      actual   += r.actualTotal
    }
    const contingency = bid * (contingencyPct / 100)
    const markup      = bid * (markupPct / 100)
    const grandBid    = bid + contingency + markup
    const grandVariance = actual - grandBid
    return { subtotal, agency, bid, actual, contingency, markup, grandBid, grandVariance }
  }, [departmentRollup, contingencyPct, markupPct])

  const hasData = departmentRollup.length > 0

  return (
    <div className="flex flex-col gap-4">
      {/* Project header */}
      <div className="rounded-sm p-4" style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}>
        <div className="flex items-center gap-2 mb-3">
          <FileSpreadsheet className="w-5 h-5" style={{ color: '#fb923c' }} />
          <span className="text-[13px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
            Top Sheet - Internal
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[11px] font-mono">
          <div>
            <span className="text-[9px] uppercase tracking-widest block" style={{ color: '#78716c' }}>Project</span>
            <span style={{ color: '#d6d3d1' }}>{project?.name || 'Untitled'}</span>
          </div>
          <div>
            <span className="text-[9px] uppercase tracking-widest block" style={{ color: '#78716c' }}>Project Code</span>
            <span style={{ color: '#d6d3d1' }}>{project?.code || '--'}</span>
          </div>
          <div>
            <span className="text-[9px] uppercase tracking-widest block" style={{ color: '#78716c' }}>Start Date</span>
            <span style={{ color: '#d6d3d1' }}>{project?.start_date || '--'}</span>
          </div>
          <div className="flex gap-4">
            <div>
              <span className="text-[9px] uppercase tracking-widest block" style={{ color: '#78716c' }}>Contingency</span>
              <span style={{ color: '#d6d3d1' }}>{contingencyPct}%</span>
            </div>
            <div>
              <span className="text-[9px] uppercase tracking-widest block" style={{ color: '#78716c' }}>Markup</span>
              <span style={{ color: '#d6d3d1' }}>{markupPct}%</span>
            </div>
            <div>
              <span className="text-[9px] uppercase tracking-widest block" style={{ color: '#78716c' }}>Agency</span>
              <span style={{ color: agencyEnabled ? '#fbbf24' : '#57534e' }}>
                {agencyEnabled ? `${agencyPct}%` : 'Off'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Department breakdown table */}
      {!hasData ? (
        <div className="flex flex-col items-center py-12 gap-3">
          <AlertCircle className="w-8 h-8" style={{ color: '#44403c' }} />
          <span className="text-[11px] font-mono" style={{ color: '#78716c' }}>
            No budget lines entered yet. Add lines in the Crew/Team, Talent, or Exp/Travel tabs.
          </span>
        </div>
      ) : (
        <div className="rounded-sm overflow-hidden" style={{ border: '1px solid #44403c' }}>
          {/* Header row */}
          <div className="grid gap-0" style={{
            gridTemplateColumns: agencyEnabled
              ? '2fr repeat(5, 1fr)'
              : '2fr repeat(4, 1fr)',
            backgroundColor: '#292524', borderBottom: '2px solid #57534e',
          }}>
            {['Item/Department', 'Subtotal', ...(agencyEnabled ? ['Agency'] : []), 'Bid', 'Actual', 'Variance'].map(h => (
              <div key={h} className="px-3 py-2 text-[9px] font-mono uppercase tracking-widest font-bold"
                style={{ color: '#fb923c', borderRight: '1px solid #44403c' }}>
                {h}
              </div>
            ))}
          </div>

          {/* Department rows */}
          {departmentRollup.map(row => (
            <div key={row.department} className="grid gap-0"
              style={{
                gridTemplateColumns: agencyEnabled
                  ? '2fr repeat(5, 1fr)'
                  : '2fr repeat(4, 1fr)',
                borderBottom: '1px solid #3a3733',
                backgroundColor: '#1c1917',
              }}>
              <div className="px-3 py-2 text-[11px] font-mono font-bold" style={{ color: '#d6d3d1', borderRight: '1px solid #3a3733' }}>
                {row.department}
              </div>
              <div className="px-3 py-2 text-[11px] font-mono text-right" style={{ color: '#a8a29e', borderRight: '1px solid #3a3733' }}>
                {fmtCurrency(row.subtotal, currency)}
              </div>
              {agencyEnabled && (
                <div className="px-3 py-2 text-[11px] font-mono text-right" style={{ color: '#a8a29e', borderRight: '1px solid #3a3733' }}>
                  {fmtCurrency(row.agencyFee, currency)}
                </div>
              )}
              <div className="px-3 py-2 text-[11px] font-mono text-right font-bold" style={{ color: '#d6d3d1', borderRight: '1px solid #3a3733' }}>
                {fmtCurrency(row.bidTotal, currency)}
              </div>
              <div className="px-3 py-2 text-[11px] font-mono text-right" style={{ color: row.actualTotal ? '#d6d3d1' : '#57534e', borderRight: '1px solid #3a3733' }}>
                {row.actualTotal ? fmtCurrency(row.actualTotal, currency) : '\u2014'}
              </div>
              <div className="px-3 py-2 text-[11px] font-mono text-right" style={{
                color: row.variance > 0 ? '#fca5a5' : row.variance < 0 ? '#86efac' : '#78716c',
              }}>
                {row.bidTotal > 0 || row.actualTotal > 0
                  ? `${row.variance > 0 ? '+' : ''}${fmtCurrency(row.variance, currency)}`
                  : '\u2014'}
              </div>
            </div>
          ))}

          {/* Subtotal row */}
          <div className="grid gap-0" style={{
            gridTemplateColumns: agencyEnabled
              ? '2fr repeat(5, 1fr)'
              : '2fr repeat(4, 1fr)',
            borderTop: '2px solid #57534e', borderBottom: '1px solid #57534e',
            backgroundColor: '#292524',
          }}>
            <div className="px-3 py-2 text-[11px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
              Subtotal
            </div>
            <div className="px-3 py-2 text-[11px] font-mono text-right font-bold" style={{ color: '#d6d3d1' }}>
              {fmtCurrency(totals.subtotal, currency)}
            </div>
            {agencyEnabled && (
              <div className="px-3 py-2 text-[11px] font-mono text-right font-bold" style={{ color: '#d6d3d1' }}>
                {fmtCurrency(totals.agency, currency)}
              </div>
            )}
            <div className="px-3 py-2 text-[11px] font-mono text-right font-bold" style={{ color: '#d6d3d1' }}>
              {fmtCurrency(totals.bid, currency)}
            </div>
            <div className="px-3 py-2 text-[11px] font-mono text-right font-bold" style={{ color: '#d6d3d1' }}>
              {fmtCurrency(totals.actual, currency)}
            </div>
            <div className="px-3 py-2 text-[11px] font-mono text-right font-bold" style={{
              color: totals.grandVariance > 0 ? '#fca5a5' : totals.grandVariance < 0 ? '#86efac' : '#a8a29e',
            }}>
              {totals.grandVariance > 0 ? '+' : ''}{fmtCurrency(totals.grandVariance, currency)}
            </div>
          </div>

          {/* Contingency + Markup rows */}
          {contingencyPct > 0 && (
            <div className="grid gap-0" style={{
              gridTemplateColumns: agencyEnabled
                ? '2fr repeat(5, 1fr)'
                : '2fr repeat(4, 1fr)',
              borderBottom: '1px solid #3a3733', backgroundColor: '#1c1917',
            }}>
              <div className="px-3 py-1.5 text-[11px] font-mono" style={{ color: '#a8a29e' }}>
                Contingency ({contingencyPct}%)
              </div>
              <div className="px-3 py-1.5 text-[11px] font-mono text-right" style={{ color: '#a8a29e' }}>
                {fmtCurrency(totals.contingency, currency)}
              </div>
              {agencyEnabled && <div />}
              <div /><div /><div />
            </div>
          )}

          {markupPct > 0 && (
            <div className="grid gap-0" style={{
              gridTemplateColumns: agencyEnabled
                ? '2fr repeat(5, 1fr)'
                : '2fr repeat(4, 1fr)',
              borderBottom: '1px solid #3a3733', backgroundColor: '#1c1917',
            }}>
              <div className="px-3 py-1.5 text-[11px] font-mono" style={{ color: '#a8a29e' }}>
                Markup ({markupPct}%)
              </div>
              <div className="px-3 py-1.5 text-[11px] font-mono text-right" style={{ color: '#a8a29e' }}>
                {fmtCurrency(totals.markup, currency)}
              </div>
              {agencyEnabled && <div />}
              <div /><div /><div />
            </div>
          )}

          {/* Grand total */}
          <div className="grid gap-0" style={{
            gridTemplateColumns: agencyEnabled
              ? '2fr repeat(5, 1fr)'
              : '2fr repeat(4, 1fr)',
            borderTop: '2px solid #fb923c', backgroundColor: '#292524',
          }}>
            <div className="px-3 py-3 text-[13px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
              Grand Total
            </div>
            <div />
            {agencyEnabled && <div />}
            <div className="px-3 py-3 text-[13px] font-mono text-right font-bold" style={{ color: '#d6d3d1' }}>
              {fmtCurrency(totals.grandBid, currency)}
            </div>
            <div className="px-3 py-3 text-[13px] font-mono text-right font-bold" style={{ color: '#d6d3d1' }}>
              {fmtCurrency(totals.actual, currency)}
            </div>
            <div className="px-3 py-3 text-[13px] font-mono text-right font-bold" style={{
              color: totals.grandVariance > 0 ? '#fca5a5' : totals.grandVariance < 0 ? '#86efac' : '#a8a29e',
            }}>
              {totals.grandVariance > 0 ? '+' : ''}{fmtCurrency(totals.grandVariance, currency)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
