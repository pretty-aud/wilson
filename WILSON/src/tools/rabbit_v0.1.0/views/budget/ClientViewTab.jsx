// ============================================================
// ClientViewTab — Client-facing budget topsheet
// ============================================================
//
// Maps to TOPSHEET - CLIENT in the Excel template.
// Clean read-only view showing only department estimates.
// NO subtotals visible to client.
// NO contingency percentage visible — contingency shown as a flat line item.
// Includes print/export functionality.

import { useMemo, useRef } from 'react'
import { Eye, Printer } from 'lucide-react'

function fmtCurrency(val, currency = 'USD') {
  const n = Number(val) || 0
  return n.toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function ClientViewTab({ budget, budgetHook, project, tasks, roleRates, expensesHook, currency }) {
  const printRef = useRef(null)

  const markupPct      = Number(project?.budget_margin_pct ?? 0)
  const contingencyPct = Number(project?.budget_contingency_pct ?? 0)

  // Build department-level estimates from tasks + rate card (crew/team costs)
  const crewByDept = useMemo(() => {
    const map = {}
    for (const t of (tasks || [])) {
      const slug = t.assigned_role_slug
      if (!slug) continue
      const rate = Number(roleRates?.[slug] || 0)
      const days = Number(t.bid_days || 0)
      if (rate <= 0 || days <= 0) continue

      // Use assigned_position or slug as a department proxy
      const dept = t.assigned_position || slug
      if (!map[dept]) map[dept] = { department: dept, estimate: 0 }
      map[dept].estimate += rate * days
    }
    return map
  }, [tasks, roleRates])

  // Build expense estimates from expenses system
  const expenseTotal = useMemo(() => {
    const expenses = expensesHook?.expenses || []
    return expenses.reduce((s, e) => s + Number(e.estimated_cost || 0), 0)
  }, [expensesHook?.expenses])

  // Build budget-line estimates from talent lines (budgetHook)
  const talentTotal = useMemo(() => {
    if (!budgetHook?.lines || !budgetHook?.lineComputations) return 0
    return budgetHook.lines
      .filter(l => l.sheet === 'talent' && !l.is_section_header)
      .reduce((s, l) => s + (budgetHook.lineComputations[l.id]?.bidTotal || 0), 0)
  }, [budgetHook?.lines, budgetHook?.lineComputations])

  // Combine into clean client-facing line items
  const clientLineItems = useMemo(() => {
    const items = []

    // Add crew/team departments
    for (const row of Object.values(crewByDept)) {
      if (row.estimate > 0) {
        items.push({ label: row.department, estimate: row.estimate })
      }
    }

    // Add talent as a single line
    if (talentTotal > 0) {
      items.push({ label: 'Talent', estimate: talentTotal })
    }

    // Add expenses as a single line
    if (expenseTotal > 0) {
      items.push({ label: 'Expenses / Travel', estimate: expenseTotal })
    }

    // Sort by estimate descending
    items.sort((a, b) => b.estimate - a.estimate)

    return items
  }, [crewByDept, talentTotal, expenseTotal])

  // Calculate totals — contingency is a FLAT line item, not shown as %
  const subtotalBeforeExtras = clientLineItems.reduce((s, r) => s + r.estimate, 0)
  const contingencyAmt = subtotalBeforeExtras * (contingencyPct / 100)
  const markupAmt      = subtotalBeforeExtras * (markupPct / 100)
  const grandTotal     = subtotalBeforeExtras + contingencyAmt + markupAmt

  function handlePrint() {
    const el = printRef.current
    if (!el) return
    const printWin = window.open('', '_blank', 'width=800,height=1100')
    if (!printWin) return

    const lineRows = clientLineItems
      .map(r => `<tr><td>${r.label}</td><td>${fmtCurrency(r.estimate, currency)}</td></tr>`)
      .join('')

    const contingencyRow = contingencyAmt > 0
      ? `<tr><td>Contingency</td><td>${fmtCurrency(contingencyAmt, currency)}</td></tr>`
      : ''
    const markupRow = markupAmt > 0
      ? `<tr><td>Production Fee</td><td>${fmtCurrency(markupAmt, currency)}</td></tr>`
      : ''

    // Session 25: the title and code below were project.name / project.code.
    // NEITHER has ever been a column. The project title is 'title', and the
    // code the app actually writes is 'project_code'
    // (ProjectSummaryView.jsx:605) — so this printed "Project" and "--" on
    // every cloud project, on the one document that leaves the building.
    printWin.document.write(`
      <!DOCTYPE html><html><head><title>${project?.title || 'Budget'} - Client Estimate</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; padding: 40px; color: #1c1917; }
        h1 { font-size: 18px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px; }
        h2 { font-size: 13px; color: #78716c; margin-bottom: 20px; }
        .meta { display: flex; gap: 40px; margin-bottom: 24px; font-size: 11px; }
        .meta-item label { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #78716c; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 12px; border-bottom: 2px solid #1c1917; }
        th:last-child { text-align: right; }
        td { font-size: 11px; padding: 6px 12px; border-bottom: 1px solid #e7e5e4; }
        td:last-child { text-align: right; }
        .total-row td { border-top: 2px solid #1c1917; font-weight: bold; font-size: 13px; padding-top: 12px; }
        .note { font-size: 10px; color: #78716c; margin-top: 32px; }
        .signature { margin-top: 48px; font-size: 10px; }
        .signature .line { border-bottom: 1px solid #1c1917; width: 200px; height: 20px; display: inline-block; margin-left: 8px; }
      </style></head><body>
        <h1>${project?.title || 'Project'}</h1>
        <h2>Estimated Budget</h2>
        <div class="meta">
          <div class="meta-item"><label>Project Code</label>${project?.project_code || '--'}</div>
          <div class="meta-item"><label>Date</label>${new Date().toLocaleDateString()}</div>
        </div>
        <table>
          <thead><tr><th>Item</th><th>Estimate</th></tr></thead>
          <tbody>
            ${lineRows}
            ${contingencyRow}
            ${markupRow}
            <tr class="total-row"><td>Total</td><td>${fmtCurrency(grandTotal, currency)}</td></tr>
          </tbody>
        </table>
        <div class="note">Note:</div>
        <div class="signature" style="margin-top: 48px;">
          <div>Estimate Approved by: <span class="line"></span></div>
          <div style="margin-top: 16px;">Approver Signature: <span class="line"></span></div>
          <div style="margin-top: 16px;">Date Signed: <span class="line"></span></div>
        </div>
      </body></html>
    `)
    printWin.document.close()
    printWin.focus()
    setTimeout(() => { printWin.print(); printWin.close() }, 250)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header + Print */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="w-5 h-5" style={{ color: '#fb923c' }} />
          <span className="text-[13.5px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
            Client View
          </span>
          <span className="text-[10.5px] font-mono" style={{ color: '#78716c' }}>
            Clean estimate for client presentation
          </span>
        </div>
        <button type="button" onClick={handlePrint}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700"
          style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
          <Printer className="w-3.5 h-3.5" /> Print / Export
        </button>
      </div>

      {/* Preview card */}
      <div ref={printRef} className="rounded-sm p-6" style={{ backgroundColor: '#fafaf9', border: '1px solid #d6d3d1' }}>
        <h2 className="text-lg font-mono font-bold uppercase tracking-wider mb-1" style={{ color: '#1c1917' }}>
          {project?.title || 'Project'}
        </h2>
        <p className="text-[11.5px] font-mono mb-4" style={{ color: '#78716c' }}>Estimated Budget</p>

        <div className="flex gap-8 mb-5 text-[11.5px] font-mono">
          <div>
            <span className="text-[9.5px] uppercase tracking-widest block" style={{ color: '#78716c' }}>Project Code</span>
            <span style={{ color: '#1c1917' }}>{project?.project_code || '--'}</span>
          </div>
          <div>
            <span className="text-[9.5px] uppercase tracking-widest block" style={{ color: '#78716c' }}>Date</span>
            <span style={{ color: '#1c1917' }}>{new Date().toLocaleDateString()}</span>
          </div>
        </div>

        {/* Line items table — NO subtotals, NO contingency % */}
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #1c1917' }}>
              <th className="text-left text-[9.5px] font-mono uppercase tracking-widest py-2 px-3" style={{ color: '#44403c' }}>
                Item
              </th>
              <th className="text-right text-[9.5px] font-mono uppercase tracking-widest py-2 px-3" style={{ color: '#44403c' }}>
                Estimate
              </th>
            </tr>
          </thead>
          <tbody>
            {clientLineItems.map(row => (
              <tr key={row.label} style={{ borderBottom: '1px solid #e7e5e4' }}>
                <td className="text-[11.5px] font-mono py-2 px-3" style={{ color: '#1c1917' }}>{row.label}</td>
                <td className="text-[11.5px] font-mono text-right py-2 px-3" style={{ color: '#1c1917' }}>
                  {fmtCurrency(row.estimate, currency)}
                </td>
              </tr>
            ))}

            {/* Contingency as a flat dollar line item — NO percentage shown */}
            {contingencyAmt > 0 && (
              <tr style={{ borderBottom: '1px solid #e7e5e4' }}>
                <td className="text-[11.5px] font-mono py-2 px-3" style={{ color: '#1c1917' }}>
                  Contingency
                </td>
                <td className="text-[11.5px] font-mono text-right py-2 px-3" style={{ color: '#1c1917' }}>
                  {fmtCurrency(contingencyAmt, currency)}
                </td>
              </tr>
            )}

            {/* Markup as "Production Fee" — NO percentage shown */}
            {markupAmt > 0 && (
              <tr style={{ borderBottom: '1px solid #e7e5e4' }}>
                <td className="text-[11.5px] font-mono py-2 px-3" style={{ color: '#1c1917' }}>
                  Production Fee
                </td>
                <td className="text-[11.5px] font-mono text-right py-2 px-3" style={{ color: '#1c1917' }}>
                  {fmtCurrency(markupAmt, currency)}
                </td>
              </tr>
            )}

            {/* Grand total */}
            <tr style={{ borderTop: '2px solid #1c1917' }}>
              <td className="text-[13.5px] font-mono font-bold py-3 px-3" style={{ color: '#1c1917' }}>Total</td>
              <td className="text-[13.5px] font-mono font-bold text-right py-3 px-3" style={{ color: '#1c1917' }}>
                {fmtCurrency(grandTotal, currency)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Note + Signature area */}
        <div className="mt-8">
          <p className="text-[10.5px] font-mono mb-1" style={{ color: '#78716c' }}>Note:</p>
          <div className="h-16 rounded-sm mb-8" style={{ border: '1px solid #e7e5e4' }} />

          <div className="flex flex-col gap-4 text-[10.5px] font-mono" style={{ color: '#1c1917' }}>
            <div className="flex items-end gap-2">
              <span>Estimate Approved by:</span>
              <div className="flex-1" style={{ borderBottom: '1px solid #1c1917', height: 18 }} />
            </div>
            <div className="flex items-end gap-2">
              <span>Approver Signature:</span>
              <div className="flex-1" style={{ borderBottom: '1px solid #1c1917', height: 18 }} />
            </div>
            <div className="flex items-end gap-2">
              <span>Date Signed:</span>
              <div style={{ borderBottom: '1px solid #1c1917', height: 18, width: 200 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
