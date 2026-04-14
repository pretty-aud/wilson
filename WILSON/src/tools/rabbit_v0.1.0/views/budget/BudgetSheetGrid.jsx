// ============================================================
// BudgetSheetGrid — Shared spreadsheet-like budget grid
// ============================================================
//
// Renders the bid/actual split layout matching the Excel template:
//
//   LEFT (sticky):  Label | Rate | Days | Qty | Subtotal | Agency | Bid Total
//   CENTER:         Variance
//   RIGHT (scroll): Actual Total | Period 1 | Period 2 | ...
//
// UX considerations:
//   - Jakob's Law: behaves like a spreadsheet (click cell to edit)
//   - Fitts's Law: adequate cell target areas (min 32px height)
//   - Miller's Law: department groups chunk the data
//   - Proximity: bid columns grouped left, actuals grouped right
//   - Common Region: distinct background tints for bid vs actual zones

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import {
  Plus, Trash2, X, ChevronDown, ChevronRight, Paperclip, Link2,
} from 'lucide-react'
import CurrencyDisplay from '../../components/CurrencyDisplay'

// ── Helpers ────────────────────────────────────────────────
function fmtCurrency(val, currency = 'USD') {
  const n = Number(val) || 0
  return n.toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function columnLabel(index, mode, projectStart) {
  if (mode === 'count') return `#${index + 1}`
  const start = projectStart ? new Date(projectStart) : new Date()
  const daysOffset = mode === 'weekly' ? index * 7 : index * 14
  const d = new Date(start.getTime() + daysOffset * 86400000)
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const day   = d.getDate().toString().padStart(2, '0')
  if (mode === 'weekly') return `Wk ${index + 1}\n${month}/${day}`
  return `Bi-wk ${index + 1}\n${month}/${day}`
}

// ── Cell Popover (for actual cell editing) ─────────────────
function CellPopover({ actual, lineLabel, colLabel, currency, expenses, onSave, onDelete, onClose }) {
  const [value, setValue]           = useState(actual?.value ?? '')
  const [invoiceNum, setInvoiceNum] = useState(actual?.invoice_number || '')
  const [expenseId, setExpenseId]   = useState(actual?.expense_id || '')
  const ref = useRef(null)

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onClose])

  function handleSave() {
    onSave({
      value: Number(value) || 0,
      invoice_number: invoiceNum.trim() || null,
      expense_id: expenseId || null,
    })
  }

  return (
    <div ref={ref} className="absolute z-50 rounded-sm shadow-2xl flex flex-col gap-2 p-3"
      style={{
        backgroundColor: '#292524', border: '2px solid #ea580c',
        width: 280, top: '100%', left: 0,
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
      }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>
          {lineLabel} / {colLabel}
        </span>
        <button type="button" onClick={onClose} className="p-0.5 hover:bg-stone-700 rounded transition-colors">
          <X className="w-3 h-3" style={{ color: '#a8a29e' }} />
        </button>
      </div>

      {/* Amount */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Amount ({currency})</label>
        <input type="number" step="0.01" value={value} onChange={e => setValue(e.target.value)} autoFocus
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose() }}
          className="px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
          style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#d6d3d1' }} />
      </div>

      {/* Invoice number */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Invoice #</label>
        <input type="text" value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)}
          placeholder="INV-001"
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose() }}
          className="px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
          style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#d6d3d1' }} />
      </div>

      {/* Link to expense */}
      {expenses && expenses.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] font-mono uppercase tracking-widest flex items-center gap-1" style={{ color: '#78716c' }}>
            <Link2 className="w-3 h-3" /> Link Expense
          </label>
          <select value={expenseId} onChange={e => setExpenseId(e.target.value)}
            className="px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#d6d3d1' }}>
            <option value="">-- none --</option>
            {expenses.map(ex => (
              <option key={ex.id} value={ex.id}>
                {ex.title || 'Untitled'} ({fmtCurrency(ex.actual_cost)})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-1">
        <button type="button" onClick={handleSave}
          className="flex-1 px-2 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors"
          style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
          Save
        </button>
        {actual?.id && (
          <button type="button" onClick={() => onDelete(actual.id)}
            className="px-2 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-red-900/40"
            style={{ color: '#fca5a5', border: '1px solid #7f1d1d' }}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}


// ── Inline editable cell ───────────────────────────────────
function InlineCell({ value, type = 'text', onChange, placeholder = '', disabled, style: extraStyle, className: extraClass }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select() }
  }, [editing])

  function start() {
    if (disabled) return
    setDraft(value == null ? '' : String(value))
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    if (type === 'number') {
      const n = parseFloat(draft)
      if (Number.isFinite(n) && n !== Number(value)) onChange(n)
    } else {
      if (draft !== (value || '')) onChange(draft)
    }
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type={type === 'number' ? 'number' : 'text'}
        step={type === 'number' ? '0.01' : undefined}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
          if (e.key === 'Tab') commit()
        }}
        className={`w-full px-1.5 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-orange-500 rounded-sm ${extraClass || ''}`}
        style={{ backgroundColor: '#1c1917', border: '1px solid #ea580c', color: '#d6d3d1', ...extraStyle }}
      />
    )
  }

  const displayVal = value == null || value === '' || value === 0
    ? <span style={{ color: '#57534e' }}>{placeholder || '\u2014'}</span>
    : type === 'number'
      ? <span style={{ color: '#d6d3d1' }}>{Number(value).toLocaleString()}</span>
      : <span style={{ color: '#d6d3d1' }}>{value}</span>

  return (
    <div
      onClick={start}
      className={`w-full px-1.5 py-1 text-[11px] font-mono cursor-pointer rounded-sm hover:bg-stone-800/50 transition-colors min-h-[28px] flex items-center ${disabled ? 'cursor-default opacity-60' : ''} ${extraClass || ''}`}
      style={extraStyle}
    >
      {displayVal}
    </div>
  )
}


// ── Actual cell (the small cells in the scrollable area) ───
function ActualCell({ actual, lineId, lineLabel, colIndex, colLabel, currency, expenses, onUpsert, onDelete }) {
  const [showPopover, setShowPopover] = useState(false)
  const val = actual?.value || 0
  const hasInvoice = actual?.invoice_number || actual?.expense_id

  function handleSave(data) {
    onUpsert({
      ...actual,
      line_id: lineId,
      column_index: colIndex,
      ...data,
    })
    setShowPopover(false)
  }

  return (
    <div className="relative" style={{ minWidth: 80 }}>
      <div
        onClick={() => setShowPopover(true)}
        className="px-1.5 py-1 text-[11px] font-mono cursor-pointer rounded-sm hover:bg-stone-700/50 transition-colors min-h-[28px] flex items-center justify-end gap-0.5"
        style={{
          backgroundColor: val ? '#1c1917' : 'transparent',
          border: val ? '1px solid #44403c' : '1px solid transparent',
          color: val ? '#d6d3d1' : '#57534e',
        }}
        title={actual?.invoice_number ? `Invoice: ${actual.invoice_number}` : undefined}
      >
        {hasInvoice && <Paperclip className="w-2.5 h-2.5 flex-shrink-0" style={{ color: '#78716c' }} />}
        {val ? fmtCurrency(val, currency) : '\u2014'}
      </div>
      {showPopover && (
        <CellPopover
          actual={actual}
          lineLabel={lineLabel}
          colLabel={colLabel}
          currency={currency}
          expenses={expenses}
          onSave={handleSave}
          onDelete={(id) => { onDelete(id); setShowPopover(false) }}
          onClose={() => setShowPopover(false)}
        />
      )}
    </div>
  )
}


// ── Main Grid Component ────────────────────────────────────
export default function BudgetSheetGrid({
  sheetType,           // 'crew' | 'talent' | 'expenses_travel'
  departments,         // ordered array of department names for this sheet
  linesByDept,         // { deptName: [line, ...] }
  lineComputations,    // { lineId: { subtotal, agencyFee, bidTotal, actualTotal, variance } }
  actualsByLine,       // { lineId: [actual, ...] }
  expenses,            // expense records for linking
  agencyEnabled,       // global agency toggle
  agencyPct,           // global agency %
  columnMode,          // 'fortnightly' | 'weekly' | 'count'
  columnCount,         // number of actual columns
  projectStart,        // project start date
  currency,            // currency code
  teamMembers,         // for crew: available team members to link
  onUpdateLine,        // (id, patch) => void
  onDeleteLine,        // (id) => void
  onAddLine,           // (data) => void
  onUpsertActual,      // (data) => void
  onDeleteActual,      // (id) => void
}) {
  const [collapsedDepts, setCollapsedDepts] = useState({})
  const scrollRef = useRef(null)

  function toggleDept(dept) {
    setCollapsedDepts(prev => ({ ...prev, [dept]: !prev[dept] }))
  }

  // Build column headers for the actual side
  const colHeaders = useMemo(() => {
    const cols = []
    for (let i = 0; i < columnCount; i++) {
      cols.push({ index: i, label: columnLabel(i, columnMode, projectStart) })
    }
    return cols
  }, [columnCount, columnMode, projectStart])

  // ── Bid columns config based on sheet type ──
  const bidColumns = useMemo(() => {
    if (sheetType === 'crew') {
      return [
        { key: 'label',    label: 'Role',       width: 180, type: 'text' },
        { key: 'rate',     label: 'Rate',       width: 80,  type: 'number' },
        { key: 'days',     label: 'Days',       width: 60,  type: 'number' },
        { key: 'qty',      label: 'Qty',        width: 50,  type: 'number' },
        { key: 'internal', label: 'Internal?',  width: 65,  type: 'boolean' },
      ]
    }
    if (sheetType === 'talent') {
      return [
        { key: 'label',                  label: 'Name',       width: 180, type: 'text' },
        { key: 'rate',                   label: 'Rate',       width: 80,  type: 'number' },
        { key: 'days',                   label: 'Days',       width: 60,  type: 'number' },
        { key: 'qty',                    label: 'Qty',        width: 50,  type: 'number' },
        { key: 'talent_agency_fee_pct',  label: 'Agent Fee',  width: 70,  type: 'number' },
      ]
    }
    // expenses_travel
    return [
      { key: 'label',       label: 'Expense',    width: 180, type: 'text' },
      { key: 'description', label: 'Description', width: 140, type: 'text' },
      { key: 'cost',        label: 'Cost',        width: 80,  type: 'number' },
      { key: 'days',        label: 'Days',        width: 60,  type: 'number', naKey: 'is_na_days' },
      { key: 'qty',         label: 'Qty',         width: 50,  type: 'number', naKey: 'is_na_qty' },
    ]
  }, [sheetType])

  const bidWidth = bidColumns.reduce((s, c) => s + c.width, 0)

  // ── Compute department subtotals ──
  const deptSubtotals = useMemo(() => {
    const map = {}
    for (const dept of departments) {
      const deptLines = (linesByDept[dept] || []).filter(l => !l.is_section_header)
      let bidSum = 0, actualSum = 0
      for (const l of deptLines) {
        const comp = lineComputations[l.id]
        if (comp) { bidSum += comp.bidTotal; actualSum += comp.actualTotal }
      }
      map[dept] = { bidSum, actualSum, variance: actualSum - bidSum, count: deptLines.length }
    }
    return map
  }, [departments, linesByDept, lineComputations])

  // Grand totals
  const grandTotals = useMemo(() => {
    let bid = 0, actual = 0
    for (const sub of Object.values(deptSubtotals)) {
      bid += sub.bidSum; actual += sub.actualSum
    }
    return { bid, actual, variance: actual - bid }
  }, [deptSubtotals])

  return (
    <div className="flex flex-col gap-0">
      {/* ── Column headers ── */}
      <div className="flex" style={{ borderBottom: '2px solid #57534e' }}>
        {/* Bid side header */}
        <div className="flex flex-shrink-0" style={{ width: bidWidth }}>
          {bidColumns.map(col => (
            <div key={col.key}
              className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-2 flex-shrink-0"
              style={{ width: col.width, color: '#fb923c', borderRight: '1px solid #44403c' }}>
              {col.label}
            </div>
          ))}
        </div>

        {/* Subtotal header */}
        <div className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-2 flex-shrink-0 text-right"
          style={{ width: 90, color: '#fb923c', borderRight: '1px solid #44403c' }}>
          Subtotal
        </div>

        {/* Agency column (only when enabled) */}
        {agencyEnabled && (
          <div className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-2 flex-shrink-0 text-right"
            style={{ width: 80, color: '#fb923c', borderRight: '1px solid #44403c' }}>
            Agency
          </div>
        )}

        {/* Bid total header */}
        <div className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-2 flex-shrink-0 text-right font-bold"
          style={{ width: 100, color: '#fb923c', borderRight: '2px solid #57534e' }}>
          Bid Total
        </div>

        {/* Variance header */}
        <div className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-2 flex-shrink-0 text-center"
          style={{ width: 90, color: '#fbbf24', backgroundColor: '#292524', borderRight: '2px solid #57534e' }}>
          Variance
        </div>

        {/* Actual total header */}
        <div className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-2 flex-shrink-0 text-right font-bold"
          style={{ width: 100, color: '#fb923c', borderRight: '1px solid #44403c' }}>
          Actual
        </div>

        {/* Scrollable period headers */}
        <div ref={scrollRef} className="flex overflow-x-auto flex-1" style={{ scrollbarWidth: 'thin' }}>
          {colHeaders.map(col => (
            <div key={col.index}
              className="text-[8.5px] font-mono uppercase tracking-wider px-1 py-2 flex-shrink-0 text-center whitespace-pre-line"
              style={{ width: 80, color: '#78716c', borderRight: '1px solid #3a3733' }}>
              {col.label}
            </div>
          ))}
        </div>
      </div>

      {/* ── Department groups ── */}
      {departments.map(dept => {
        const deptLines = linesByDept[dept] || []
        const collapsed = collapsedDepts[dept]
        const sub = deptSubtotals[dept] || { bidSum: 0, actualSum: 0, variance: 0, count: 0 }

        return (
          <div key={dept}>
            {/* Department header */}
            <div className="flex items-center cursor-pointer select-none"
              style={{ backgroundColor: '#292524', borderBottom: '1px solid #57534e', borderTop: '1px solid #57534e' }}
              onClick={() => toggleDept(dept)}>
              <div className="flex items-center gap-2 px-2 py-2 flex-1">
                {collapsed ? <ChevronRight className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
                           : <ChevronDown  className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />}
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
                  {dept}
                </span>
                <span className="text-[10px] font-mono" style={{ color: '#78716c' }}>
                  ({sub.count} line{sub.count !== 1 ? 's' : ''})
                </span>
              </div>
              <div className="flex items-center gap-4 px-3 text-[10px] font-mono">
                <span style={{ color: '#a8a29e' }}>Bid: {fmtCurrency(sub.bidSum, currency)}</span>
                <span style={{ color: '#a8a29e' }}>Actual: {fmtCurrency(sub.actualSum, currency)}</span>
                <span style={{ color: sub.variance > 0 ? '#fca5a5' : sub.variance < 0 ? '#86efac' : '#a8a29e' }}>
                  Var: {sub.variance > 0 ? '+' : ''}{fmtCurrency(sub.variance, currency)}
                </span>
              </div>
            </div>

            {/* Line items (hidden if collapsed) */}
            {!collapsed && (
              <div className="flex flex-col">
                {deptLines.filter(l => !l.is_section_header).map(line => {
                  const comp = lineComputations[line.id] || { subtotal: 0, agencyFee: 0, bidTotal: 0, actualTotal: 0, variance: 0 }
                  const lineActuals = actualsByLine[line.id] || []
                  const actualMap = {}
                  for (const a of lineActuals) actualMap[a.column_index] = a

                  return (
                    <div key={line.id} className="flex group" style={{ borderBottom: '1px solid #3a3733' }}>
                      {/* Bid cells */}
                      <div className="flex flex-shrink-0" style={{ width: bidWidth }}>
                        {bidColumns.map(col => (
                          <div key={col.key} className="flex-shrink-0" style={{ width: col.width, borderRight: '1px solid #3a3733' }}>
                            {col.type === 'boolean' ? (
                              <div className="px-1.5 py-1 flex items-center min-h-[28px]">
                                <input
                                  type="checkbox"
                                  checked={col.key === 'internal' ? !!(teamMembers?.find(m => m.id === line.team_member_id)?.employment_type === 'fulltime') : !!line[col.key]}
                                  onChange={e => {
                                    // Internal? is read from the linked team member
                                  }}
                                  disabled
                                  className="accent-orange-500 w-3.5 h-3.5"
                                  title="Set via Team Members database"
                                />
                              </div>
                            ) : col.naKey && line[col.naKey] ? (
                              <div className="px-1.5 py-1 text-[11px] font-mono min-h-[28px] flex items-center" style={{ color: '#78716c' }}>
                                N/A
                              </div>
                            ) : (
                              <InlineCell
                                value={col.key === 'talent_agency_fee_pct' ? (line.talent_agency_fee_pct ?? '') : line[col.key]}
                                type={col.type}
                                onChange={v => onUpdateLine(line.id, { [col.key]: v })}
                                placeholder={col.type === 'number' ? '0' : col.label}
                              />
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Subtotal */}
                      <div className="flex-shrink-0 px-1.5 py-1 text-[11px] font-mono text-right min-h-[28px] flex items-center justify-end"
                        style={{ width: 90, color: '#a8a29e', borderRight: '1px solid #3a3733' }}>
                        {fmtCurrency(comp.subtotal, currency)}
                      </div>

                      {/* Agency */}
                      {agencyEnabled && (
                        <div className="flex-shrink-0 px-1.5 py-1 text-[11px] font-mono text-right min-h-[28px] flex items-center justify-end gap-1"
                          style={{ width: 80, color: line.agency_opt_out ? '#57534e' : '#a8a29e', borderRight: '1px solid #3a3733' }}>
                          {sheetType !== 'talent' && (
                            <input
                              type="checkbox"
                              checked={!line.agency_opt_out}
                              onChange={e => onUpdateLine(line.id, { agency_opt_out: !e.target.checked })}
                              className="accent-orange-500 w-3 h-3 flex-shrink-0"
                              title={line.agency_opt_out ? 'Opted out of agency fee' : 'Agency fee applied'}
                            />
                          )}
                          <span>{fmtCurrency(comp.agencyFee, currency)}</span>
                        </div>
                      )}

                      {/* Bid Total */}
                      <div className="flex-shrink-0 px-1.5 py-1 text-[11px] font-mono font-bold text-right min-h-[28px] flex items-center justify-end"
                        style={{ width: 100, color: '#d6d3d1', borderRight: '2px solid #57534e' }}>
                        {fmtCurrency(comp.bidTotal, currency)}
                      </div>

                      {/* Variance */}
                      <div className="flex-shrink-0 px-1.5 py-1 text-[11px] font-mono text-center min-h-[28px] flex items-center justify-center"
                        style={{
                          width: 90,
                          backgroundColor: '#292524',
                          color: comp.variance > 0 ? '#fca5a5' : comp.variance < 0 ? '#86efac' : '#78716c',
                          borderRight: '2px solid #57534e',
                        }}>
                        {comp.bidTotal > 0 || comp.actualTotal > 0
                          ? `${comp.variance > 0 ? '+' : ''}${fmtCurrency(comp.variance, currency)}`
                          : '\u2014'}
                      </div>

                      {/* Actual Total */}
                      <div className="flex-shrink-0 px-1.5 py-1 text-[11px] font-mono font-bold text-right min-h-[28px] flex items-center justify-end"
                        style={{ width: 100, color: comp.actualTotal ? '#d6d3d1' : '#57534e', borderRight: '1px solid #44403c' }}>
                        {comp.actualTotal ? fmtCurrency(comp.actualTotal, currency) : '\u2014'}
                      </div>

                      {/* Scrollable actual cells */}
                      <div className="flex overflow-x-auto flex-1" style={{ scrollbarWidth: 'thin' }}>
                        {colHeaders.map(col => (
                          <div key={col.index} className="flex-shrink-0" style={{ width: 80, borderRight: '1px solid #3a3733' }}>
                            <ActualCell
                              actual={actualMap[col.index]}
                              lineId={line.id}
                              lineLabel={line.label}
                              colIndex={col.index}
                              colLabel={col.label}
                              currency={currency}
                              expenses={expenses}
                              onUpsert={onUpsertActual}
                              onDelete={onDeleteActual}
                            />
                          </div>
                        ))}
                      </div>

                      {/* Row delete (shows on hover) */}
                      <div className="flex-shrink-0 w-7 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" onClick={() => onDeleteLine(line.id)}
                          className="p-0.5 rounded hover:bg-red-900/40 transition-colors"
                          style={{ color: '#ef4444' }} title="Delete row">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )
                })}

                {/* Add row button */}
                <div className="flex items-center px-2 py-1" style={{ borderBottom: '1px solid #44403c' }}>
                  <button type="button"
                    onClick={() => onAddLine({
                      sheet: sheetType,
                      department: dept,
                      label: 'open slot',
                      sort_order: (deptLines.length || 0) + 1,
                    })}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-800 transition-colors"
                    style={{ color: '#78716c', border: '1px dashed #44403c' }}>
                    <Plus className="w-3 h-3" /> Add row
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* ── Grand total row ── */}
      <div className="flex" style={{ backgroundColor: '#292524', borderTop: '2px solid #57534e', borderBottom: '2px solid #57534e' }}>
        <div className="flex-shrink-0 flex items-center px-2 py-2"
          style={{ width: bidWidth }}>
          <span className="text-[11px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
            Total
          </span>
        </div>

        {/* Subtotal */}
        <div className="flex-shrink-0 px-1.5 py-2 text-[11px] font-mono font-bold text-right flex items-center justify-end"
          style={{ width: 90, color: '#d6d3d1', borderRight: '1px solid #44403c' }}>
          {/* Subtotal is the sum before agency */}
        </div>

        {/* Agency */}
        {agencyEnabled && (
          <div className="flex-shrink-0 px-1.5 py-2 text-[11px] font-mono font-bold text-right flex items-center justify-end"
            style={{ width: 80, color: '#d6d3d1', borderRight: '1px solid #44403c' }}>
          </div>
        )}

        {/* Bid Total */}
        <div className="flex-shrink-0 px-1.5 py-2 text-[12px] font-mono font-bold text-right flex items-center justify-end"
          style={{ width: 100, color: '#d6d3d1', borderRight: '2px solid #57534e' }}>
          {fmtCurrency(grandTotals.bid, currency)}
        </div>

        {/* Variance */}
        <div className="flex-shrink-0 px-1.5 py-2 text-[12px] font-mono font-bold text-center flex items-center justify-center"
          style={{
            width: 90,
            backgroundColor: '#1c1917',
            color: grandTotals.variance > 0 ? '#fca5a5' : grandTotals.variance < 0 ? '#86efac' : '#a8a29e',
            borderRight: '2px solid #57534e',
          }}>
          {grandTotals.variance > 0 ? '+' : ''}{fmtCurrency(grandTotals.variance, currency)}
        </div>

        {/* Actual */}
        <div className="flex-shrink-0 px-1.5 py-2 text-[12px] font-mono font-bold text-right flex items-center justify-end"
          style={{ width: 100, color: '#d6d3d1' }}>
          {fmtCurrency(grandTotals.actual, currency)}
        </div>
      </div>
    </div>
  )
}
