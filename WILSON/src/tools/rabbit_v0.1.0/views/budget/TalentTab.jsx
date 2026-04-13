// ============================================================
// TalentTab — Talent budget with unified row layout
// ============================================================
//
// Talent + background performers. Standalone (not in team system).
// Per-row agent representation fee (separate from global agency).
//
// Each row is a SINGLE element spanning both bid and actual zones
// so heights always align. Orange divider separates the two zones.
// No internal scroll — the page-level scroll handles overflow.
// Popovers render position:fixed so they escape the table frame.

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { Star, Plus, X, Trash2, RotateCcw } from 'lucide-react'
import { COLUMN_MODES } from '../../../../components/Budget/useBudgetLines'

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
  if (mode === 'weekly') return `Wk${index + 1} ${month}/${day}`
  return `P${index + 1} ${month}/${day}`
}

// ── Bid zone widths (px) ──────────────────────────────────
const W_NAME   = 200
const W_RATE   = 80
const W_DAYS   = 60
const W_SUB    = 88
const W_AGPCT  = 60
const W_BID    = 96
const W_MARGIN = 80
const W_CONT   = 80
const W_DEL    = 36
const BID_W    = W_NAME + W_RATE + W_DAYS + W_SUB + W_AGPCT + W_BID + W_MARGIN + W_CONT + W_DEL
// ── Actual zone widths ────────────────────────────────────
const W_DIV   = 3
const W_ACT   = 88
const W_VAR   = 80
const W_COL   = 72

// ── Fixed-position popover (renders outside any overflow container) ──
function ActualPopover({ pos, actual, colLabel, lineName, currency, onSave, onDelete, onClose }) {
  const [value, setValue]     = useState(actual?.value ?? '')
  const [invoice, setInvoice] = useState(actual?.invoice_number || '')
  const ref = useRef(null)

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onClose])

  // Clamp so popover doesn't go off screen
  const popW = 260
  const popH = 220
  const left = Math.min(pos.x, window.innerWidth - popW - 12)
  const top  = pos.y + pos.h + 4 + popH > window.innerHeight
    ? pos.y - popH - 4   // flip above if no room below
    : pos.y + pos.h + 4  // below the cell

  function handleSave() {
    onSave({ value: Number(value) || 0, invoice_number: invoice.trim() || null })
  }

  return (
    <div ref={ref} className="fixed z-[9999] rounded-sm shadow-2xl flex flex-col gap-2 p-3"
      style={{ backgroundColor: '#292524', border: '2px solid #ea580c', width: popW,
        top, left, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-mono uppercase tracking-widest truncate" style={{ color: '#fb923c' }}>{lineName} / {colLabel}</span>
        <button type="button" onClick={onClose} className="p-0.5 hover:bg-stone-700 rounded transition-colors">
          <X className="w-3 h-3" style={{ color: '#a8a29e' }} />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Amount ({currency})</label>
        <input type="number" step="any" value={value} onChange={e => setValue(e.target.value)}
          className="w-full px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
          style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#f4a261' }} autoFocus />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Invoice #</label>
        <input type="text" value={invoice} onChange={e => setInvoice(e.target.value)} placeholder="INV-001"
          className="w-full px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
          style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#d6d3d1' }} />
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button type="button" onClick={handleSave}
          className="flex-1 px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider font-bold rounded-sm"
          style={{ backgroundColor: '#ea580c', color: '#fff7ed', border: '1px solid #c2410c' }}>Save</button>
        {actual?.id && onDelete && (
          <button type="button" onClick={() => onDelete(actual.id)}
            className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded-sm"
            style={{ color: '#ef4444', border: '1px solid #7f1d1d' }}>Clear</button>
        )}
      </div>
    </div>
  )
}

// ── Inline editable cell ──────────────────────────────────
function InlineCell({ value, onChange, type = 'text', placeholder, disabled }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select() }
  }, [editing])

  function start() {
    if (disabled) return
    setDraft(String(value ?? ''))
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const v = type === 'number' ? (parseFloat(draft) || 0) : draft
    if (v !== value) onChange(v)
  }

  if (editing) {
    return (
      <input ref={ref} type={type} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
        }}
        className="w-full px-1 py-0.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
        style={{ backgroundColor: '#292524', border: '1px solid #ea580c', color: '#f4a261', textAlign: type === 'number' ? 'right' : 'left' }}
      />
    )
  }

  return (
    <button type="button" onClick={start} disabled={disabled}
      className="w-full text-left px-1 py-0.5 text-[11px] font-mono rounded-sm transition-colors hover:bg-stone-800 truncate disabled:cursor-not-allowed"
      style={{ color: value ? '#d6d3d1' : '#57534e', textAlign: type === 'number' ? 'right' : 'left' }}>
      {type === 'number' ? (value || placeholder || '\u2014') : (value || placeholder || '\u2014')}
    </button>
  )
}

// ── Margin / Contingency popover ───────────────────────��─
function MarginContPopover({ pos, marginPct, contPct, bidTotal, defaultMargin, defaultCont, currency, onSave, onClose }) {
  const [margin, setMargin] = useState(marginPct ?? '')
  const [cont, setCont]     = useState(contPct ?? '')
  const ref = useRef(null)

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onClose])

  const popW = 280
  const popH = 280
  const left = Math.min(pos.x, window.innerWidth - popW - 12)
  const top  = pos.y + pos.h + 4 + popH > window.innerHeight
    ? pos.y - popH - 4
    : pos.y + pos.h + 4

  const mPct = Number(margin) || 0
  const cPct = Number(cont) || 0
  const marginAmt = bidTotal * mPct / 100
  const contAmt   = bidTotal * cPct / 100

  return (
    <div ref={ref} className="fixed z-[9999] rounded-sm shadow-2xl flex flex-col gap-2.5 p-3"
      style={{ backgroundColor: '#292524', border: '2px solid #ea580c', width: popW,
        top, left, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>Margin & Contingency</span>
        <button type="button" onClick={onClose} className="p-0.5 hover:bg-stone-700 rounded transition-colors">
          <X className="w-3 h-3" style={{ color: '#a8a29e' }} />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Margin %</label>
        <div className="flex items-center gap-2">
          <input type="number" step="0.5" min="0" max="100" value={margin} onChange={e => setMargin(e.target.value)}
            placeholder={String(defaultMargin)}
            className="flex-1 px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#f4a261' }} autoFocus />
          <span className="text-[10px] font-mono" style={{ color: '#fb923c' }}>+{fmtCurrency(marginAmt, currency)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Contingency %</label>
        <div className="flex items-center gap-2">
          <input type="number" step="0.5" min="0" max="100" value={cont} onChange={e => setCont(e.target.value)}
            placeholder={String(defaultCont)}
            className="flex-1 px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#f4a261' }} />
          <span className="text-[10px] font-mono" style={{ color: '#fb923c' }}>+{fmtCurrency(contAmt, currency)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button type="button" onClick={() => onSave({ margin_pct: Number(margin) || 0, contingency_pct: Number(cont) || 0 })}
          className="flex-1 px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider font-bold rounded-sm"
          style={{ backgroundColor: '#ea580c', color: '#fff7ed', border: '1px solid #c2410c' }}>Save</button>
        <button type="button" onClick={() => { setMargin(String(defaultMargin)); setCont(String(defaultCont)) }}
          className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded-sm"
          style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
          <RotateCcw className="w-3 h-3" /> Default
        </button>
      </div>
    </div>
  )
}

export default function TalentTab({ budgetHook, project, expenses, currency }) {
  const {
    lines, linesBySheet, lineComputations, actualsByLine,
    addLine, updateLine, deleteLine, upsertActual, deleteActual, loading,
  } = budgetHook

  const talentLines = linesBySheet.talent || {}
  const allTalent = (lines || []).filter(l => l.sheet === 'talent' && !l.is_section_header)
  const hasLines = allTalent.length > 0

  const departments = useMemo(() => {
    const deptSet = new Set(['Talent', 'Background'])
    for (const line of lines.filter(l => l.sheet === 'talent')) {
      if (line.department) deptSet.add(line.department)
    }
    return [...deptSet]
  }, [lines])

  const columnMode   = project?.budget_actual_column_mode || 'fortnightly'
  const columnCount  = Number(project?.budget_actual_column_count ?? 10)
  const projectStart = project?.start_date || project?.created_at

  // Project-level defaults for margin & contingency
  const defaultMarginPct = Number(project?.budget_margin_pct ?? 0) || 0
  const defaultContPct   = Number(project?.budget_contingency_pct ?? 0) || 0

  // Popover state: { lineId, colIdx, x, y, h }
  const [openPopover, setOpenPopover] = useState(null)
  // Margin/contingency popover: { lineId, x, y, h }
  const [mcPopover, setMcPopover] = useState(null)

  const totals = useMemo(() => {
    let bid = 0, sub = 0, actual = 0, marginT = 0, contT = 0
    for (const line of allTalent) {
      const comp = lineComputations[line.id]
      if (comp) { bid += comp.bidTotal; sub += comp.subtotal; actual += comp.actualTotal }
      const mPct = line.margin_pct != null ? Number(line.margin_pct) : defaultMarginPct
      const cPct = line.contingency_pct != null ? Number(line.contingency_pct) : defaultContPct
      const bt = comp?.bidTotal || 0
      marginT += bt * mPct / 100
      contT   += bt * cPct / 100
    }
    return { subtotal: sub, bid, actual, variance: actual - bid, marginTotal: marginT, contTotal: contT }
  }, [allTalent, lineComputations, defaultMarginPct, defaultContPct])

  const deptGroups = useMemo(() => {
    const groups = []
    for (const dept of departments) {
      const rows = (talentLines[dept] || []).filter(l => !l.is_section_header)
      if (rows.length === 0) continue
      const sub = rows.reduce((s, l) => s + (lineComputations[l.id]?.subtotal || 0), 0)
      const bid = rows.reduce((s, l) => s + (lineComputations[l.id]?.bidTotal || 0), 0)
      const actual = rows.reduce((s, l) => s + (lineComputations[l.id]?.actualTotal || 0), 0)
      let marginT = 0, contT = 0
      for (const l of rows) {
        const bt = lineComputations[l.id]?.bidTotal || 0
        const mPct = l.margin_pct != null ? Number(l.margin_pct) : defaultMarginPct
        const cPct = l.contingency_pct != null ? Number(l.contingency_pct) : defaultContPct
        marginT += bt * mPct / 100
        contT   += bt * cPct / 100
      }
      groups.push({ department: dept, rows, subtotal: sub, bid, actual, variance: actual - bid, marginTotal: marginT, contTotal: contT })
    }
    return groups
  }, [departments, talentLines, lineComputations, defaultMarginPct, defaultContPct])

  async function handleAddTalent(department = 'Talent') {
    const existing = allTalent.filter(l => l.department === department).length
    await addLine({ sheet: 'talent', department, label: `${department} ${existing + 1}`, sort_order: existing + 1 })
  }

  const handleActualSave = useCallback(async (lineId, colIdx, data) => {
    const lineActuals = actualsByLine?.[lineId] || []
    const existing = lineActuals.find(a => a.column_index === colIdx)
    await upsertActual?.({
      ...(existing || {}), line_id: lineId, column_index: colIdx,
      value: data.value, invoice_number: data.invoice_number, source: 'manual',
    })
    setOpenPopover(null)
  }, [actualsByLine, upsertActual])

  // Capture cell position for fixed popover
  function handleCellClick(e, lineId, colIdx) {
    if (openPopover?.lineId === lineId && openPopover?.colIdx === colIdx) {
      setOpenPopover(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setOpenPopover({ lineId, colIdx, x: rect.left, y: rect.top, h: rect.height })
  }

  function handleMcCellClick(e, lineId) {
    if (mcPopover?.lineId === lineId) { setMcPopover(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    setMcPopover({ lineId, x: rect.left, y: rect.top, h: rect.height })
  }

  const handleMcSave = useCallback(async (lineId, data) => {
    await updateLine?.(lineId, { margin_pct: data.margin_pct, contingency_pct: data.contingency_pct })
    setMcPopover(null)
  }, [updateLine])

  async function resetAllMarginCont() {
    if (!window.confirm('Reset all margin & contingency values to the project defaults? This cannot be undone.')) return
    for (const line of allTalent) {
      if (line.margin_pct != null || line.contingency_pct != null) {
        await updateLine?.(line.id, { margin_pct: null, contingency_pct: null })
      }
    }
  }

  // Find the line data for the open popover
  const popoverLine = openPopover
    ? allTalent.find(l => l.id === openPopover.lineId)
    : null
  const popoverActual = popoverLine && openPopover
    ? (actualsByLine?.[popoverLine.id] || []).find(a => a.column_index === openPopover.colIdx)
    : null
  const mcLine = mcPopover ? allTalent.find(l => l.id === mcPopover.lineId) : null

  const colHeaders = Array.from({ length: columnCount }, (_, i) => columnLabel(i, columnMode, projectStart))
  const totalW = BID_W + W_DIV + W_ACT + W_VAR + columnCount * W_COL

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>Loading talent...</span>
      </div>
    )
  }

  if (!hasLines) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Star className="w-10 h-10" style={{ color: '#44403c' }} />
        <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>No talent budget lines yet</span>
        <p className="text-[10px] font-mono text-center max-w-md" style={{ color: '#78716c' }}>
          Add talent and background performers manually. Agent representation fees are set per row.
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => handleAddTalent('Talent')}
            className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-mono uppercase tracking-wider rounded-sm"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
            <Plus className="w-3.5 h-3.5" /> Add Talent
          </button>
          <button type="button" onClick={() => handleAddTalent('Background')}
            className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-mono uppercase tracking-wider rounded-sm"
            style={{ color: '#fde68a', backgroundColor: '#44403c', border: '1px solid #57534e' }}>
            <Plus className="w-3.5 h-3.5" /> Add Background
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Summary tiles ── */}
      <div className="flex gap-3 flex-wrap">
        <SummaryTile label="Bid Total" value={fmtCurrency(totals.bid, currency)} />
        <SummaryTile label="Actual Total" value={totals.actual > 0 ? fmtCurrency(totals.actual, currency) : '\u2014'} />
        <SummaryTile label="Variance"
          value={totals.bid > 0 || totals.actual > 0
            ? `${totals.variance > 0 ? '+' : ''}${fmtCurrency(totals.variance, currency)}`
            : '\u2014'}
          tone={totals.variance > 0 ? 'danger' : totals.variance < 0 ? 'good' : 'neutral'} />
        <SummaryTile label="Talent" value={allTalent.length} />
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 px-1 flex-wrap">
        <button type="button" onClick={() => handleAddTalent('Talent')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm"
          style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
          <Plus className="w-3.5 h-3.5" /> Add Talent
        </button>
        <button type="button" onClick={() => handleAddTalent('Background')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm"
          style={{ color: '#fde68a', backgroundColor: '#44403c', border: '1px solid #57534e' }}>
          <Plus className="w-3.5 h-3.5" /> Add Background
        </button>
        <span className="text-[10px] font-mono" style={{ color: '#57534e' }}>Agent fees are per-row</span>
        {(defaultMarginPct > 0 || defaultContPct > 0) && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-sm" style={{ color: '#fb923c', border: '1px solid #7c2d12' }}>
            Margin: {defaultMarginPct}%
          </span>
        )}
        {(defaultMarginPct > 0 || defaultContPct > 0) && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-sm" style={{ color: '#fb923c', border: '1px solid #7c2d12' }}>
            Contingency: {defaultContPct}%
          </span>
        )}
        <button type="button" onClick={resetAllMarginCont}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
          style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
          <RotateCcw className="w-3 h-3" /> Reset M/C
        </button>
      </div>

      {/* ── Unified table ── */}
      <div className="rounded-sm" style={{ border: '1px solid #44403c' }}>
        <div style={{ minWidth: totalW }}>

          {/* ═══ HEADER ROW ═══ */}
          <div className="flex" style={{ backgroundColor: '#292524', borderBottom: '2px solid #57534e' }}>
            <div style={{ width: W_NAME }} className="px-3 py-2"><span className="text-[9px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Name</span></div>
            <div style={{ width: W_RATE }} className="px-2 py-2 text-right"><span className="text-[9px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Rate</span></div>
            <div style={{ width: W_DAYS }} className="px-2 py-2 text-right"><span className="text-[9px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Days</span></div>
            <div style={{ width: W_SUB }}  className="px-2 py-2 text-right"><span className="text-[9px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Subtotal</span></div>
            <div style={{ width: W_AGPCT }} className="px-2 py-2 text-right"><span className="text-[9px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Agent %</span></div>
            <div style={{ width: W_MARGIN }} className="px-2 py-2 text-right"><span className="text-[9px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Margin</span></div>
            <div style={{ width: W_CONT }}  className="px-2 py-2 text-right"><span className="text-[9px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Conting.</span></div>
            <div style={{ width: W_BID }}  className="px-2 py-2 text-right"><span className="text-[9px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Bid Total</span></div>
            <div style={{ width: W_DEL }} />
            <div style={{ width: W_DIV, backgroundColor: '#fb923c' }} />
            <div style={{ width: W_ACT, backgroundColor: '#1f1d1a' }} className="px-2 py-2 text-right"><span className="text-[9px] font-mono uppercase tracking-widest font-bold" style={{ color: '#38bdf8' }}>Actual</span></div>
            <div style={{ width: W_VAR, backgroundColor: '#1f1d1a' }} className="px-2 py-2 text-right"><span className="text-[9px] font-mono uppercase tracking-widest font-bold" style={{ color: '#38bdf8' }}>Variance</span></div>
            {colHeaders.map((label, i) => (
              <div key={i} style={{ width: W_COL, backgroundColor: '#1f1d1a' }} className="px-1 py-2 text-center">
                <span className="text-[8px] font-mono uppercase tracking-widest" style={{ color: '#64748b' }}>{label}</span>
              </div>
            ))}
          </div>

          {/* ═══ DEPARTMENT GROUPS ═══ */}
          {deptGroups.map(group => (
            <div key={group.department}>

              {/* ── Department header ── */}
              <div className="flex" style={{ borderBottom: '1px solid #44403c' }}>
                <div style={{ width: BID_W, backgroundColor: '#292524' }} className="px-3 py-1.5 flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>{group.department}</span>
                  <span className="text-[9px] font-mono" style={{ color: '#78716c' }}>{group.rows.length}</span>
                </div>
                <div style={{ width: W_DIV, backgroundColor: '#fb923c' }} />
                <div className="flex-1" style={{ backgroundColor: '#1f1d1a' }}><div className="px-2 py-1.5" /></div>
              </div>

              {/* ── Talent rows ── */}
              {group.rows.map(line => {
                const comp = lineComputations[line.id] || {}
                const lineActuals = actualsByLine?.[line.id] || []

                return (
                  <div key={line.id} className="flex transition-colors hover:brightness-110 group" style={{ borderBottom: '1px solid #3a3733' }}>
                    {/* Bid cells */}
                    <div style={{ width: W_NAME, backgroundColor: '#1c1917' }} className="px-3 py-2 flex items-center">
                      <InlineCell value={line.label} placeholder="Name..." onChange={v => updateLine(line.id, { label: v })} />
                    </div>
                    <div style={{ width: W_RATE, backgroundColor: '#1c1917' }} className="px-2 py-2 flex items-center justify-end">
                      <InlineCell value={line.rate} type="number" placeholder="0" onChange={v => updateLine(line.id, { rate: v })} />
                    </div>
                    <div style={{ width: W_DAYS, backgroundColor: '#1c1917' }} className="px-2 py-2 flex items-center justify-end">
                      <InlineCell value={line.days} type="number" placeholder="0" onChange={v => updateLine(line.id, { days: v })} />
                    </div>
                    <div style={{ width: W_SUB, backgroundColor: '#1c1917' }} className="px-2 py-2 text-[11px] font-mono text-right flex items-center justify-end">
                      <span style={{ color: comp.subtotal > 0 ? '#a8a29e' : '#57534e' }}>{comp.subtotal > 0 ? fmtCurrency(comp.subtotal, currency) : '\u2014'}</span>
                    </div>
                    <div style={{ width: W_AGPCT, backgroundColor: '#1c1917' }} className="px-2 py-2 flex items-center justify-end">
                      <InlineCell value={line.talent_agency_fee_pct} type="number" placeholder="0" onChange={v => updateLine(line.id, { talent_agency_fee_pct: v })} />
                    </div>
                    {(() => {
                      const mPct = line.margin_pct != null ? Number(line.margin_pct) : defaultMarginPct
                      const cPct = line.contingency_pct != null ? Number(line.contingency_pct) : defaultContPct
                      const mAmt = (comp.bidTotal || 0) * mPct / 100
                      const cAmt = (comp.bidTotal || 0) * cPct / 100
                      return (<>
                        <div style={{ width: W_MARGIN, backgroundColor: '#1c1917' }} className="px-2 py-2 text-[10px] font-mono text-right flex items-center justify-end">
                          <button type="button" onClick={e => handleMcCellClick(e, line.id)}
                            className="px-1 py-0.5 rounded-sm transition-colors hover:bg-stone-700"
                            style={{ color: mAmt > 0 ? '#fb923c' : '#57534e', border: '1px solid #33302e' }}>
                            {mAmt > 0 ? `+${fmtCurrency(mAmt, currency)}` : '\u2014'}
                          </button>
                        </div>
                        <div style={{ width: W_CONT, backgroundColor: '#1c1917' }} className="px-2 py-2 text-[10px] font-mono text-right flex items-center justify-end">
                          <button type="button" onClick={e => handleMcCellClick(e, line.id)}
                            className="px-1 py-0.5 rounded-sm transition-colors hover:bg-stone-700"
                            style={{ color: cAmt > 0 ? '#fb923c' : '#57534e', border: '1px solid #33302e' }}>
                            {cAmt > 0 ? `+${fmtCurrency(cAmt, currency)}` : '\u2014'}
                          </button>
                        </div>
                      </>)
                    })()}
                    <div style={{ width: W_BID, backgroundColor: '#1c1917' }} className="px-2 py-2 text-[11px] font-mono text-right font-bold flex items-center justify-end">
                      <span style={{ color: comp.bidTotal > 0 ? '#d6d3d1' : '#57534e' }}>{comp.bidTotal > 0 ? fmtCurrency(comp.bidTotal, currency) : '\u2014'}</span>
                    </div>
                    <div style={{ width: W_DEL, backgroundColor: '#1c1917' }} className="flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={() => deleteLine(line.id)} className="p-1 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#ef4444' }}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    {/* Divider */}
                    <div style={{ width: W_DIV, backgroundColor: '#fb923c' }} />
                    {/* Actual cells */}
                    <div style={{ width: W_ACT, backgroundColor: '#1a1915' }} className="px-2 py-2 text-[11px] font-mono text-right flex items-center justify-end">
                      <span style={{ color: comp.actualTotal > 0 ? '#d6d3d1' : '#57534e' }}>{comp.actualTotal > 0 ? fmtCurrency(comp.actualTotal, currency) : '\u2014'}</span>
                    </div>
                    <div style={{ width: W_VAR, backgroundColor: '#1a1915' }} className="px-2 py-2 text-[11px] font-mono text-right flex items-center justify-end">
                      <span style={{
                        color: (comp.bidTotal > 0 || comp.actualTotal > 0)
                          ? (comp.variance > 0 ? '#fca5a5' : comp.variance < 0 ? '#86efac' : '#78716c')
                          : '#57534e',
                      }}>
                        {comp.bidTotal > 0 || comp.actualTotal > 0
                          ? `${comp.variance > 0 ? '+' : ''}${fmtCurrency(comp.variance, currency)}`
                          : '\u2014'}
                      </span>
                    </div>
                    {/* Period cells — click opens fixed popover */}
                    {colHeaders.map((label, colIdx) => {
                      const cellActual = lineActuals.find(a => a.column_index === colIdx)
                      return (
                        <div key={colIdx} style={{ width: W_COL, backgroundColor: '#1a1915' }}
                          className="px-1 py-2 flex items-center justify-center">
                          <button type="button"
                            onClick={e => handleCellClick(e, line.id, colIdx)}
                            className="w-full text-[10px] font-mono rounded-sm py-0.5 transition-colors hover:bg-stone-700"
                            style={{
                              color: cellActual?.value ? '#d6d3d1' : '#44403c',
                              border: `1px solid ${cellActual?.value ? '#57534e' : '#33302e'}`,
                              backgroundColor: cellActual?.value ? '#292524' : 'transparent',
                            }}>
                            {cellActual?.value ? fmtCurrency(cellActual.value, currency) : '\u00B7'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
              })}

              {/* ── Department subtotal ── */}
              <div className="flex" style={{ borderBottom: '2px solid #44403c' }}>
                <div style={{ width: W_NAME + W_RATE + W_DAYS, backgroundColor: '#292524' }} className="px-3 py-1.5 text-[10px] font-mono font-bold">
                  <span style={{ color: '#a8a29e' }}>{group.department} total</span>
                </div>
                <div style={{ width: W_SUB, backgroundColor: '#292524' }} className="px-2 py-1.5 text-[10px] font-mono text-right font-bold">
                  <span style={{ color: '#a8a29e' }}>{fmtCurrency(group.subtotal, currency)}</span>
                </div>
                <div style={{ width: W_AGPCT, backgroundColor: '#292524' }} />
                <div style={{ width: W_MARGIN, backgroundColor: '#292524' }} className="px-2 py-1.5 text-[10px] font-mono text-right font-bold">
                  <span style={{ color: group.marginTotal > 0 ? '#fb923c' : '#57534e' }}>{group.marginTotal > 0 ? `+${fmtCurrency(group.marginTotal, currency)}` : '\u2014'}</span>
                </div>
                <div style={{ width: W_CONT, backgroundColor: '#292524' }} className="px-2 py-1.5 text-[10px] font-mono text-right font-bold">
                  <span style={{ color: group.contTotal > 0 ? '#fb923c' : '#57534e' }}>{group.contTotal > 0 ? `+${fmtCurrency(group.contTotal, currency)}` : '\u2014'}</span>
                </div>
                <div style={{ width: W_BID, backgroundColor: '#292524' }} className="px-2 py-1.5 text-[10px] font-mono text-right font-bold">
                  <span style={{ color: '#d6d3d1' }}>{fmtCurrency(group.bid, currency)}</span>
                </div>
                <div style={{ width: W_DEL, backgroundColor: '#292524' }} />
                <div style={{ width: W_DIV, backgroundColor: '#fb923c' }} />
                <div style={{ width: W_ACT, backgroundColor: '#1f1d1a' }} className="px-2 py-1.5 text-[10px] font-mono text-right font-bold">
                  <span style={{ color: '#38bdf8' }}>{group.actual > 0 ? fmtCurrency(group.actual, currency) : '\u2014'}</span>
                </div>
                <div style={{ width: W_VAR, backgroundColor: '#1f1d1a' }} className="px-2 py-1.5 text-[10px] font-mono text-right font-bold">
                  <span style={{
                    color: group.variance > 0 ? '#fca5a5' : group.variance < 0 ? '#86efac' : '#78716c',
                  }}>
                    {group.bid > 0 || group.actual > 0
                      ? `${group.variance > 0 ? '+' : ''}${fmtCurrency(group.variance, currency)}`
                      : '\u2014'}
                  </span>
                </div>
                <div className="flex-1" style={{ backgroundColor: '#1f1d1a' }} />
              </div>
            </div>
          ))}

          {/* ═══ GRAND TOTAL ═══ */}
          <div className="flex" style={{ borderTop: '2px solid #fb923c' }}>
            <div style={{ width: W_NAME + W_RATE + W_DAYS, backgroundColor: '#292524' }} className="px-3 py-2.5 text-[12px] font-mono font-bold uppercase tracking-wider">
              <span style={{ color: '#fb923c' }}>Grand Total</span>
            </div>
            <div style={{ width: W_SUB, backgroundColor: '#292524' }} className="px-2 py-2.5 text-[11px] font-mono text-right font-bold">
              <span style={{ color: '#a8a29e' }}>{fmtCurrency(totals.subtotal, currency)}</span>
            </div>
            <div style={{ width: W_AGPCT, backgroundColor: '#292524' }} />
            <div style={{ width: W_MARGIN, backgroundColor: '#292524' }} className="px-2 py-2.5 text-[11px] font-mono text-right font-bold">
              <span style={{ color: totals.marginTotal > 0 ? '#fb923c' : '#57534e' }}>{totals.marginTotal > 0 ? `+${fmtCurrency(totals.marginTotal, currency)}` : '\u2014'}</span>
            </div>
            <div style={{ width: W_CONT, backgroundColor: '#292524' }} className="px-2 py-2.5 text-[11px] font-mono text-right font-bold">
              <span style={{ color: totals.contTotal > 0 ? '#fb923c' : '#57534e' }}>{totals.contTotal > 0 ? `+${fmtCurrency(totals.contTotal, currency)}` : '\u2014'}</span>
            </div>
            <div style={{ width: W_BID, backgroundColor: '#292524' }} className="px-2 py-2.5 text-[12px] font-mono text-right font-bold">
              <span style={{ color: '#d6d3d1' }}>{fmtCurrency(totals.bid, currency)}</span>
            </div>
            <div style={{ width: W_DEL, backgroundColor: '#292524' }} />
            <div style={{ width: W_DIV, backgroundColor: '#fb923c' }} />
            <div style={{ width: W_ACT, backgroundColor: '#1f1d1a' }} className="px-2 py-2.5 text-[12px] font-mono text-right font-bold">
              <span style={{ color: '#d6d3d1' }}>{totals.actual > 0 ? fmtCurrency(totals.actual, currency) : '\u2014'}</span>
            </div>
            <div style={{ width: W_VAR, backgroundColor: '#1f1d1a' }} className="px-2 py-2.5 text-[12px] font-mono text-right font-bold">
              <span style={{
                color: totals.variance > 0 ? '#fca5a5' : totals.variance < 0 ? '#86efac' : '#a8a29e',
              }}>
                {totals.bid > 0 || totals.actual > 0
                  ? `${totals.variance > 0 ? '+' : ''}${fmtCurrency(totals.variance, currency)}`
                  : '\u2014'}
              </span>
            </div>
            <div className="flex-1" style={{ backgroundColor: '#1f1d1a' }} />
          </div>

        </div>
      </div>

      {/* ── Fixed popover (rendered outside the table) ── */}
      {openPopover && popoverLine && (
        <ActualPopover
          pos={openPopover}
          actual={popoverActual}
          colLabel={colHeaders[openPopover.colIdx]}
          lineName={popoverLine.label}
          currency={currency}
          onSave={data => handleActualSave(openPopover.lineId, openPopover.colIdx, data)}
          onDelete={id => { deleteActual?.(id); setOpenPopover(null) }}
          onClose={() => setOpenPopover(null)}
        />
      )}

      {/* ── Margin/Contingency popover ── */}
      {mcPopover && mcLine && (
        <MarginContPopover
          pos={mcPopover}
          marginPct={mcLine.margin_pct != null ? Number(mcLine.margin_pct) : defaultMarginPct}
          contPct={mcLine.contingency_pct != null ? Number(mcLine.contingency_pct) : defaultContPct}
          bidTotal={lineComputations[mcLine.id]?.bidTotal || 0}
          defaultMargin={defaultMarginPct}
          defaultCont={defaultContPct}
          currency={currency}
          onSave={data => handleMcSave(mcPopover.lineId, data)}
          onClose={() => setMcPopover(null)}
        />
      )}
    </div>
  )
}

// ── Summary tile (matches BigTile: expenses colors, crew sizing) ──
function SummaryTile({ label, value, tone = 'neutral' }) {
  const colors = {
    good:    { bg: '#1c1917', border: '#15803d', text: '#86efac', label: '#86efac' },
    danger:  { bg: '#1c1917', border: '#7f1d1d', text: '#fca5a5', label: '#fca5a5' },
    neutral: { bg: '#1c1917', border: '#44403c', text: '#d6d3d1', label: '#a8a29e' },
  }[tone]
  return (
    <div className="flex-1 min-w-[120px] flex flex-col rounded-sm px-4 py-3"
      style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}>
      <span className="text-[9px] font-mono uppercase tracking-widest block mb-1" style={{ color: colors.label }}>{label}</span>
      <span className="text-xl font-mono font-bold" style={{ color: colors.text }}>{value}</span>
    </div>
  )
}
