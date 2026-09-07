// ============================================================
// CrewTeamTab — Crew/team budget derived from real project data
// ============================================================
//
// Derives bid from: team members + rate card + tasks
// Actuals from: budget_actuals (manual invoice/timecard entry)
//
// Layout: Each row is a SINGLE element spanning both bid and
// actual zones, guaranteeing vertical alignment.
// No internal scroll — the page-level scroll handles overflow.
// Popovers render position:fixed so they escape the table frame.

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { Users, X, RotateCcw, Paperclip, FolderOpen } from 'lucide-react'
import { COLUMN_MODES } from '../../../../components/Budget/useBudgetLines'
import InvoiceAttachment from '../../../../components/Budget/InvoiceAttachment'
import { useRabbit } from '../../state/RabbitProvider'

// Session 24: the local-server BASE_URL that used to sit here is gone.
// Invoice attachment now goes through the adapter (InvoiceAttachment),
// so it works on the web and on Local Server alike.

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
const W_NAME  = 180
const W_TYPE  = 56
const W_RATE  = 80
const W_DAYS  = 60
const W_SUB   = 88
const W_BID   = 96
const W_MARGIN = 80
const W_CONT   = 80
const BID_W   = W_NAME + W_TYPE + W_RATE + W_DAYS + W_SUB + W_BID + W_MARGIN + W_CONT
// ── Actual zone widths ────────────────────────────────────
const W_DIV   = 3
const W_ACT   = 88
const W_VAR   = 80
const W_COL   = 72

// ── Fixed-position popover (renders outside any overflow container) ──
function ActualPopover({ pos, actual, colLabel, memberName, currency, projectId, onSave, onDelete, onClose }) {
  const [value, setValue]     = useState(actual?.value ?? '')
  const [invoice, setInvoice] = useState(actual?.invoice_number || '')
  const [attachName, setAttachName] = useState(actual?.attachment_name || '')
  const [attachPath, setAttachPath] = useState(actual?.attachment_path || '')
  const getAdapter = useRabbit()?.getAdapter
  const ref = useRef(null)

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onClose])

  const popW = 280
  const popH = 320
  const left = Math.min(pos.x, window.innerWidth - popW - 12)
  const top  = pos.y + pos.h + 4 + popH > window.innerHeight
    ? pos.y - popH - 4
    : pos.y + pos.h + 4


  function handleSave() {
    onSave({
      value: Number(value) || 0,
      invoice_number: invoice.trim() || null,
      attachment_name: attachName || null,
      attachment_path: attachPath || null,
    })
  }

  return (
    <div ref={ref} className="fixed z-[9999] rounded-sm shadow-2xl flex flex-col gap-2 p-3"
      style={{ backgroundColor: '#292524', border: '2px solid #ea580c', width: popW,
        top, left, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9.5px] font-mono uppercase tracking-widest truncate" style={{ color: '#fb923c' }}>
          {memberName} / {colLabel}
        </span>
        <button type="button" onClick={onClose} className="p-0.5 hover:bg-stone-700 rounded transition-colors">
          <X className="w-3 h-3" style={{ color: '#a8a29e' }} />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Amount ({currency})</label>
        <input type="number" step="any" value={value} onChange={e => setValue(e.target.value)}
          className="w-full px-2 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
          style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#f4a261' }}
          autoFocus />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Invoice #</label>
        <input type="text" value={invoice} onChange={e => setInvoice(e.target.value)}
          placeholder="INV-001"
          className="w-full px-2 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
          style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#d6d3d1' }} />
      </div>
      <InvoiceAttachment
        getAdapter={getAdapter}
        projectId={projectId}
        lineId={actual?.line_id || null}
        name={attachName}
        path={attachPath}
        onChange={({ name, path }) => { setAttachName(name); setAttachPath(path) }}
      />
      <div className="flex items-center gap-2 mt-1">
        <button type="button" onClick={handleSave}
          className="flex-1 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider font-bold rounded-sm"
          style={{ backgroundColor: '#ea580c', color: '#fff7ed', border: '1px solid #c2410c' }}>
          Save
        </button>
        {actual?.id && onDelete && (
          <button type="button" onClick={() => onDelete(actual.id)}
            className="px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm"
            style={{ color: '#ef4444', border: '1px solid #7f1d1d' }}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

// ── Margin / Contingency popover ─────────────────────────
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
        <span className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>Margin & Contingency</span>
        <button type="button" onClick={onClose} className="p-0.5 hover:bg-stone-700 rounded transition-colors">
          <X className="w-3 h-3" style={{ color: '#a8a29e' }} />
        </button>
      </div>

      {/* Margin */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Margin %</label>
        <div className="flex items-center gap-2">
          <input type="number" step="0.5" min="0" max="100" value={margin} onChange={e => setMargin(e.target.value)}
            placeholder={String(defaultMargin)}
            className="flex-1 px-2 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#f4a261' }} autoFocus />
          <span className="text-[10.5px] font-mono" style={{ color: '#fb923c' }}>+{fmtCurrency(marginAmt, currency)}</span>
        </div>
      </div>

      {/* Contingency */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Contingency %</label>
        <div className="flex items-center gap-2">
          <input type="number" step="0.5" min="0" max="100" value={cont} onChange={e => setCont(e.target.value)}
            placeholder={String(defaultCont)}
            className="flex-1 px-2 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#f4a261' }} />
          <span className="text-[10.5px] font-mono" style={{ color: '#fb923c' }}>+{fmtCurrency(contAmt, currency)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-1">
        <button type="button" onClick={() => onSave({ margin_pct: Number(margin) || 0, contingency_pct: Number(cont) || 0 })}
          className="flex-1 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider font-bold rounded-sm"
          style={{ backgroundColor: '#ea580c', color: '#fff7ed', border: '1px solid #c2410c' }}>Save</button>
        <button type="button" onClick={() => { setMargin(String(defaultMargin)); setCont(String(defaultCont)) }}
          className="flex items-center gap-1 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm"
          style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
          <RotateCcw className="w-3 h-3" /> Default
        </button>
      </div>
    </div>
  )
}

export default function CrewTeamTab({
  budgetHook, project, tasks, roleRates, rateCard, teamMembers, expenses, currency,
  projectTitles, onSaveProjectTitle,
}) {
  const { lines, lineComputations, actualsByLine, addLine, updateLine, upsertActual, deleteActual } = budgetHook || {}

  const agencyEnabled = project?.budget_agency_enabled === true
  const agencyPct     = Number(project?.budget_agency_pct ?? 0)
  const columnMode    = project?.budget_actual_column_mode || 'fortnightly'
  const columnCount   = Number(project?.budget_actual_column_count ?? 20)
  const projectStart  = project?.start_date || project?.created_at

  // Project-level defaults for margin & contingency
  const defaultMarginPct = Number(project?.budget_margin_pct ?? 0) || 0
  const defaultContPct   = Number(project?.budget_contingency_pct ?? 0) || 0

  // Popover state: { memberId, colIdx, x, y, h }
  const [openPopover, setOpenPopover] = useState(null)
  // Margin/contingency popover: { memberId, x, y, h }
  const [mcPopover, setMcPopover] = useState(null)

  function handleCellClick(e, memberId, colIdx) {
    if (openPopover?.memberId === memberId && openPopover?.colIdx === colIdx) {
      setOpenPopover(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setOpenPopover({ memberId, colIdx, x: rect.left, y: rect.top, h: rect.height })
  }

  const rateMap = useMemo(() => {
    const map = {}
    for (const e of (rateCard?.entries || [])) {
      if (!e.role_slug) continue
      const rate = Number(e.wage || e.day_rate || 0)
      if (rate > 0 && !map[e.role_slug]) map[e.role_slug] = rate
    }
    if (roleRates) {
      for (const [slug, rate] of Object.entries(roleRates)) {
        if (!map[slug]) map[slug] = rate
      }
    }
    return map
  }, [rateCard?.entries, roleRates])

  const bidDaysByRole = useMemo(() => {
    const map = {}
    for (const t of (tasks || [])) {
      const slug = t.assigned_role_slug
      if (!slug) continue
      map[slug] = (map[slug] || 0) + Number(t.bid_days || 0)
    }
    return map
  }, [tasks])

  const { departmentGroups, grandTotals } = useMemo(() => {
    const members = teamMembers || []
    const byDept = {}

    for (const m of members) {
      const dept = m.department || 'Uncategorized'
      if (!byDept[dept]) byDept[dept] = []

      let rate = 0, roleSlug = null
      const memberEntry = (rateCard?.entries || []).find(e => e.member_id === m.id)
      if (memberEntry) {
        rate = Number(memberEntry.wage || memberEntry.day_rate || 0)
        roleSlug = memberEntry.role_slug
      }

      const bidDays = roleSlug ? Number(bidDaysByRole[roleSlug] || 0) : 0
      const subtotal = rate * bidDays
      const agencyFee = (agencyEnabled && subtotal > 0) ? subtotal * (agencyPct / 100) : 0
      const bidTotal = subtotal + agencyFee

      const memberLine = (lines || []).find(l => l.team_member_id === m.id && l.sheet === 'crew')
      const memberActuals = memberLine ? (actualsByLine?.[memberLine.id] || []) : []
      const actualTotal = memberActuals.reduce((sum, a) => sum + (Number(a.value) || 0), 0)

      const marginPct = memberLine?.margin_pct != null ? Number(memberLine.margin_pct) : defaultMarginPct
      const contPct   = memberLine?.contingency_pct != null ? Number(memberLine.contingency_pct) : defaultContPct
      const marginAmt = bidTotal * marginPct / 100
      const contAmt   = bidTotal * contPct / 100

      // Every member in the project team gets a row — even if they
      // have no bid days or actuals yet (the row shows zero values).
      byDept[dept].push({
        id: m.id, name: m.name, title: m.title || '',
        department: dept, employmentType: m.employment_type || 'fulltime',
        roleSlug, rate, bidDays, subtotal, agencyFee, bidTotal,
        marginPct, contPct, marginAmt, contAmt,
        actualTotal, variance: actualTotal - bidTotal,
        lineId: memberLine?.id || null, actuals: memberActuals,
      })
    }

    const assignedSlugs = new Set(
      (teamMembers || []).map(m => {
        const e = (rateCard?.entries || []).find(e => e.member_id === m.id)
        return e?.role_slug
      }).filter(Boolean)
    )
    for (const [slug, days] of Object.entries(bidDaysByRole)) {
      if (assignedSlugs.has(slug) || days <= 0) continue
      const entry = (rateCard?.entries || []).find(e => e.role_slug === slug)
      const dept = entry?.department || 'Unassigned'
      if (!byDept[dept]) byDept[dept] = []
      const rate = rateMap[slug] || 0
      const subtotal = rate * days
      const agencyFee = (agencyEnabled && subtotal > 0) ? subtotal * (agencyPct / 100) : 0
      const uBidTotal = subtotal + agencyFee
      byDept[dept].push({
        id: `unassigned-${slug}`, name: entry?.role_label || slug,
        title: '(unassigned)', department: dept, employmentType: 'freelancer',
        roleSlug: slug, rate, bidDays: days, subtotal, agencyFee,
        bidTotal: uBidTotal, actualTotal: 0, variance: -uBidTotal,
        marginPct: defaultMarginPct, contPct: defaultContPct,
        marginAmt: uBidTotal * defaultMarginPct / 100, contAmt: uBidTotal * defaultContPct / 100,
        lineId: null, actuals: [],
      })
    }

    const groups = Object.entries(byDept)
      .map(([dept, rows]) => ({
        department: dept,
        rows: rows.sort((a, b) => b.bidTotal - a.bidTotal),
        subtotal: rows.reduce((s, r) => s + r.subtotal, 0),
        bidTotal: rows.reduce((s, r) => s + r.bidTotal, 0),
        marginTotal: rows.reduce((s, r) => s + r.marginAmt, 0),
        contTotal: rows.reduce((s, r) => s + r.contAmt, 0),
        actualTotal: rows.reduce((s, r) => s + r.actualTotal, 0),
      }))
      .sort((a, b) => b.bidTotal - a.bidTotal)

    const totals = {
      subtotal: groups.reduce((s, g) => s + g.subtotal, 0),
      bidTotal: groups.reduce((s, g) => s + g.bidTotal, 0),
      marginTotal: groups.reduce((s, g) => s + g.marginTotal, 0),
      contTotal: groups.reduce((s, g) => s + g.contTotal, 0),
      actualTotal: groups.reduce((s, g) => s + g.actualTotal, 0),
    }
    totals.variance = totals.actualTotal - totals.bidTotal
    return { departmentGroups: groups, grandTotals: totals }
  }, [teamMembers, rateCard?.entries, bidDaysByRole, rateMap, agencyEnabled, agencyPct, lines, actualsByLine, defaultMarginPct, defaultContPct])

  const ensureLine = useCallback(async (memberId) => {
    const existing = (lines || []).find(l => l.team_member_id === memberId && l.sheet === 'crew')
    if (existing) return existing.id
    const member = (teamMembers || []).find(m => m.id === memberId)
    const result = await addLine?.({
      sheet: 'crew', department: member?.department || 'Uncategorized',
      label: member?.name || 'Team Member', team_member_id: memberId,
    })
    return result?.id || null
  }, [lines, teamMembers, addLine])

  const handleActualSave = useCallback(async (memberId, colIdx, data) => {
    const lineId = await ensureLine(memberId)
    if (!lineId) return
    const row = departmentGroups.flatMap(g => g.rows).find(r => r.id === memberId)
    const existing = (row?.actuals || []).find(a => a.column_index === colIdx)
    await upsertActual?.({
      ...(existing || {}), line_id: lineId, column_index: colIdx,
      value: data.value, invoice_number: data.invoice_number,
      attachment_name: data.attachment_name || null,
      attachment_path: data.attachment_path || null,
      source: 'manual',
    })
    setOpenPopover(null)
  }, [ensureLine, departmentGroups, upsertActual])

  const handleMcSave = useCallback(async (memberId, data) => {
    const lineId = await ensureLine(memberId)
    if (!lineId) return
    await updateLine?.(lineId, { margin_pct: data.margin_pct, contingency_pct: data.contingency_pct })
    setMcPopover(null)
  }, [ensureLine, updateLine])

  function handleMcCellClick(e, memberId) {
    if (mcPopover?.memberId === memberId) { setMcPopover(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    setMcPopover({ memberId, x: rect.left, y: rect.top, h: rect.height })
  }

  async function resetAllMarginCont() {
    if (!window.confirm('Reset all margin & contingency values to the project defaults? This cannot be undone.')) return
    for (const line of (lines || []).filter(l => l.sheet === 'crew')) {
      if (line.margin_pct != null || line.contingency_pct != null) {
        await updateLine?.(line.id, { margin_pct: null, contingency_pct: null })
      }
    }
  }

  const colHeaders = Array.from({ length: columnCount }, (_, i) => columnLabel(i, columnMode, projectStart))
  const totalW = BID_W + W_DIV + W_ACT + W_VAR + columnCount * W_COL
  const memberCount = departmentGroups.reduce((s, g) => s + g.rows.length, 0)
  const hasData = departmentGroups.length > 0

  // Find the row data for the open popovers
  const allRows = departmentGroups.flatMap(g => g.rows)
  const popoverRow = openPopover
    ? allRows.find(r => r.id === openPopover.memberId)
    : null
  const popoverActual = popoverRow && openPopover
    ? (popoverRow.actuals || []).find(a => a.column_index === openPopover.colIdx)
    : null
  const mcRow = mcPopover
    ? allRows.find(r => r.id === mcPopover.memberId)
    : null

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Users className="w-10 h-10" style={{ color: '#44403c' }} />
        <span className="text-[11.5px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>No crew/team data yet</span>
        <p className="text-[10.5px] font-mono text-center max-w-md" style={{ color: '#78716c' }}>
          Add team members in the Team view and assign roles in the Rate Card.
          Tasks with bid days will populate the budget automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Summary tiles ── */}
      <div className="flex gap-3 flex-wrap">
        <SummaryTile label="Bid Total" value={fmtCurrency(grandTotals.bidTotal, currency)} />
        <SummaryTile label="Actual Total" value={grandTotals.actualTotal > 0 ? fmtCurrency(grandTotals.actualTotal, currency) : '\u2014'} />
        <SummaryTile label="Variance"
          value={grandTotals.bidTotal > 0 || grandTotals.actualTotal > 0
            ? `${grandTotals.variance > 0 ? '+' : ''}${fmtCurrency(grandTotals.variance, currency)}`
            : '\u2014'}
          tone={grandTotals.variance > 0 ? 'danger' : grandTotals.variance < 0 ? 'good' : 'neutral'} />
        <SummaryTile label="Members" value={memberCount} />
      </div>

      {/* ── Info bar ── */}
      <div className="flex items-center gap-3 px-1 flex-wrap">
        <span className="text-[10.5px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>Crew/Team Budget</span>
        {agencyEnabled && (
          <span className="text-[10.5px] font-mono px-2 py-0.5 rounded-sm" style={{ color: '#fbbf24', border: '1px solid #78350f' }}>
            Agency: {agencyPct}%
          </span>
        )}
        {(defaultMarginPct > 0 || defaultContPct > 0) && (
          <span className="text-[10.5px] font-mono px-2 py-0.5 rounded-sm" style={{ color: '#fb923c', border: '1px solid #7c2d12' }}>
            Margin: {defaultMarginPct}%
          </span>
        )}
        {(defaultMarginPct > 0 || defaultContPct > 0) && (
          <span className="text-[10.5px] font-mono px-2 py-0.5 rounded-sm" style={{ color: '#fb923c', border: '1px solid #7c2d12' }}>
            Contingency: {defaultContPct}%
          </span>
        )}
        <button type="button" onClick={resetAllMarginCont}
          className="flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
          style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
          <RotateCcw className="w-3 h-3" /> Reset M/C
        </button>
        <span className="text-[10.5px] font-mono" style={{ color: '#57534e' }}>
          {COLUMN_MODES.find(m => m.value === columnMode)?.label || columnMode} · {columnCount} cols
        </span>
      </div>

      {/* ── Table — no internal scroll, extends full width ── */}
      <div className="rounded-sm" style={{ border: '1px solid #44403c' }}>
        <div style={{ minWidth: totalW }}>

          {/* HEADER ROW */}
          <div className="flex" style={{ backgroundColor: '#292524', borderBottom: '2px solid #57534e' }}>
            <div style={{ width: W_NAME }} className="px-3 py-2"><span className="text-[9.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Member / Role</span></div>
            <div style={{ width: W_TYPE }} className="px-2 py-2"><span className="text-[9.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Type</span></div>
            <div style={{ width: W_RATE }} className="px-2 py-2 text-right"><span className="text-[9.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Rate</span></div>
            <div style={{ width: W_DAYS }} className="px-2 py-2 text-right"><span className="text-[9.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Days</span></div>
            <div style={{ width: W_SUB }}  className="px-2 py-2 text-right"><span className="text-[9.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Subtotal</span></div>
            <div style={{ width: W_MARGIN }} className="px-2 py-2 text-right"><span className="text-[9.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Margin</span></div>
            <div style={{ width: W_CONT }}  className="px-2 py-2 text-right"><span className="text-[9.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Conting.</span></div>
            <div style={{ width: W_BID }}  className="px-2 py-2 text-right"><span className="text-[9.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>Bid Total</span></div>
            <div style={{ width: W_DIV, backgroundColor: '#fb923c' }} />
            <div style={{ width: W_VAR, backgroundColor: '#1f1d1a' }} className="px-2 py-2 text-right"><span className="text-[9.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#38bdf8' }}>Variance</span></div>
            <div style={{ width: W_ACT, backgroundColor: '#1f1d1a' }} className="px-2 py-2 text-right"><span className="text-[9.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#38bdf8' }}>Actual</span></div>
            {colHeaders.map((label, i) => (
              <div key={i} style={{ width: W_COL, backgroundColor: '#1f1d1a' }} className="px-1 py-2 text-center">
                <span className="text-[8.5px] font-mono uppercase tracking-widest" style={{ color: '#64748b' }}>{label}</span>
              </div>
            ))}
          </div>

          {/* DEPARTMENT GROUPS */}
          {departmentGroups.map(group => (
            <div key={group.department}>

              {/* Dept header */}
              <div className="flex" style={{ borderBottom: '1px solid #44403c' }}>
                <div style={{ width: BID_W, backgroundColor: '#292524' }} className="px-3 py-1.5 flex items-center gap-2">
                  <span className="text-[10.5px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>{group.department}</span>
                  <span className="text-[9.5px] font-mono" style={{ color: '#78716c' }}>{group.rows.length}</span>
                </div>
                <div style={{ width: W_DIV, backgroundColor: '#fb923c' }} />
                <div className="flex-1" style={{ backgroundColor: '#1f1d1a' }}><div className="py-1.5" /></div>
              </div>

              {/* Member rows */}
              {group.rows.map(row => (
                <div key={row.id} className="flex transition-colors hover:brightness-110" style={{ borderBottom: '1px solid #3a3733' }}>
                  <div style={{ width: W_NAME, backgroundColor: '#1c1917' }} className="px-3 py-2 min-w-0">
                    <div className="text-[11.5px] font-mono truncate" style={{ color: '#d6d3d1' }}>{row.name}</div>
                    {row.title && <div className="text-[9.5px] font-mono truncate" style={{ color: '#78716c' }}>{row.title}{row.roleSlug ? ` · ${row.roleSlug}` : ''}</div>}
                    {/* Session 24 — the PROJECT job title, e.g. "Lead
                        Animator". Audrey: "you can have a company/title role
                        AND a separate project role", and the manager types
                        this one in. The line above is the COMPANY title;
                        this is per project, and neither is the permission
                        role. Only rendered where it can actually be saved —
                        an input that silently discards what you type is
                        worse than no input. */}
                    {onSaveProjectTitle && !String(row.id).startsWith('unassigned-') && (
                      <input
                        type="text"
                        defaultValue={projectTitles?.[row.id] || ''}
                        placeholder="+ project role"
                        onBlur={e => {
                          const v = e.target.value.trim()
                          if (v !== (projectTitles?.[row.id] || '')) {
                            onSaveProjectTitle(row.id, v)?.catch?.(err =>
                              console.error('project title save failed:', err))
                          }
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        className="w-full bg-transparent outline-none text-[9.5px] font-mono truncate mt-0.5"
                        style={{ color: '#fb923c' }}
                      />
                    )}
                  </div>
                  <div style={{ width: W_TYPE, backgroundColor: '#1c1917' }} className="px-2 py-2 flex items-center">
                    <span className="text-[9.5px] font-mono px-1 py-0.5 rounded-sm" style={{
                      color: row.employmentType === 'fulltime' ? '#86efac' : '#fde68a',
                      backgroundColor: row.employmentType === 'fulltime' ? '#14532d33' : '#78350f33',
                    }}>{row.employmentType === 'fulltime' ? 'FT' : 'FR'}</span>
                  </div>
                  <div style={{ width: W_RATE, backgroundColor: '#1c1917' }} className="px-2 py-2 text-[11.5px] font-mono text-right flex items-center justify-end">
                    <span style={{ color: row.rate > 0 ? '#a8a29e' : '#57534e' }}>{row.rate > 0 ? fmtCurrency(row.rate, currency) : '\u2014'}</span>
                  </div>
                  <div style={{ width: W_DAYS, backgroundColor: '#1c1917' }} className="px-2 py-2 text-[11.5px] font-mono text-right flex items-center justify-end">
                    <span style={{ color: row.bidDays > 0 ? '#a8a29e' : '#57534e' }}>{row.bidDays > 0 ? row.bidDays.toFixed(1) : '\u2014'}</span>
                  </div>
                  <div style={{ width: W_SUB, backgroundColor: '#1c1917' }} className="px-2 py-2 text-[11.5px] font-mono text-right flex items-center justify-end">
                    <span style={{ color: row.subtotal > 0 ? '#a8a29e' : '#57534e' }}>{row.subtotal > 0 ? fmtCurrency(row.subtotal, currency) : '\u2014'}</span>
                  </div>
                  <div style={{ width: W_MARGIN, backgroundColor: '#1c1917' }} className="px-2 py-2 text-[10.5px] font-mono text-right flex items-center justify-end">
                    <button type="button" onClick={e => handleMcCellClick(e, row.id)}
                      className="px-1 py-0.5 rounded-sm transition-colors hover:bg-stone-700"
                      style={{ color: row.marginAmt > 0 ? '#fb923c' : '#57534e', border: '1px solid #33302e' }}>
                      {row.marginAmt > 0 ? `+${fmtCurrency(row.marginAmt, currency)}` : '\u2014'}
                    </button>
                  </div>
                  <div style={{ width: W_CONT, backgroundColor: '#1c1917' }} className="px-2 py-2 text-[10.5px] font-mono text-right flex items-center justify-end">
                    <button type="button" onClick={e => handleMcCellClick(e, row.id)}
                      className="px-1 py-0.5 rounded-sm transition-colors hover:bg-stone-700"
                      style={{ color: row.contAmt > 0 ? '#fb923c' : '#57534e', border: '1px solid #33302e' }}>
                      {row.contAmt > 0 ? `+${fmtCurrency(row.contAmt, currency)}` : '\u2014'}
                    </button>
                  </div>
                  <div style={{ width: W_BID, backgroundColor: '#1c1917' }} className="px-2 py-2 text-[11.5px] font-mono text-right font-bold flex items-center justify-end">
                    <span style={{ color: row.bidTotal > 0 ? '#d6d3d1' : '#57534e' }}>{row.bidTotal > 0 ? fmtCurrency(row.bidTotal, currency) : '\u2014'}</span>
                  </div>
                  <div style={{ width: W_DIV, backgroundColor: '#fb923c' }} />
                  <div style={{ width: W_VAR, backgroundColor: '#1a1915' }} className="px-2 py-2 text-[11.5px] font-mono text-right flex items-center justify-end">
                    <span style={{
                      color: (row.bidTotal > 0 || row.actualTotal > 0)
                        ? (row.variance > 0 ? '#fca5a5' : row.variance < 0 ? '#86efac' : '#78716c')
                        : '#57534e',
                    }}>
                      {row.bidTotal > 0 || row.actualTotal > 0
                        ? `${row.variance > 0 ? '+' : ''}${fmtCurrency(row.variance, currency)}`
                        : '\u2014'}
                    </span>
                  </div>
                  <div style={{ width: W_ACT, backgroundColor: '#1a1915' }} className="px-2 py-2 text-[11.5px] font-mono text-right flex items-center justify-end">
                    <span style={{ color: row.actualTotal > 0 ? '#d6d3d1' : '#57534e' }}>{row.actualTotal > 0 ? fmtCurrency(row.actualTotal, currency) : '\u2014'}</span>
                  </div>
                  {/* Period cells — click opens fixed popover */}
                  {colHeaders.map((label, colIdx) => {
                    const cellActual = (row.actuals || []).find(a => a.column_index === colIdx)
                    const hasAttach = !!cellActual?.attachment_name
                    return (
                      <div key={colIdx} style={{ width: W_COL, backgroundColor: '#1a1915' }}
                        className="px-1 py-2 flex items-center justify-center">
                        <button type="button"
                          onClick={e => handleCellClick(e, row.id, colIdx)}
                          className="relative w-full text-[10.5px] font-mono rounded-sm py-0.5 transition-colors hover:bg-stone-700"
                          style={{
                            color: cellActual?.value ? '#d6d3d1' : '#44403c',
                            border: `1px solid ${cellActual?.value ? '#57534e' : '#33302e'}`,
                            backgroundColor: cellActual?.value ? '#292524' : 'transparent',
                          }}>
                          {cellActual?.value ? fmtCurrency(cellActual.value, currency) : '\u00B7'}
                          {hasAttach && <Paperclip className="absolute top-0 right-0.5 w-2.5 h-2.5" style={{ color: '#fb923c' }} />}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}

              {/* Dept subtotal */}
              <div className="flex" style={{ borderBottom: '2px solid #44403c' }}>
                <div style={{ width: W_NAME + W_TYPE + W_RATE + W_DAYS, backgroundColor: '#292524' }} className="px-3 py-1.5 text-[10.5px] font-mono font-bold">
                  <span style={{ color: '#a8a29e' }}>{group.department} total</span>
                </div>
                <div style={{ width: W_SUB, backgroundColor: '#292524' }} className="px-2 py-1.5 text-[10.5px] font-mono text-right font-bold">
                  <span style={{ color: '#a8a29e' }}>{fmtCurrency(group.subtotal, currency)}</span>
                </div>
                <div style={{ width: W_MARGIN, backgroundColor: '#292524' }} className="px-2 py-1.5 text-[10.5px] font-mono text-right font-bold">
                  <span style={{ color: group.marginTotal > 0 ? '#fb923c' : '#57534e' }}>{group.marginTotal > 0 ? `+${fmtCurrency(group.marginTotal, currency)}` : '\u2014'}</span>
                </div>
                <div style={{ width: W_CONT, backgroundColor: '#292524' }} className="px-2 py-1.5 text-[10.5px] font-mono text-right font-bold">
                  <span style={{ color: group.contTotal > 0 ? '#fb923c' : '#57534e' }}>{group.contTotal > 0 ? `+${fmtCurrency(group.contTotal, currency)}` : '\u2014'}</span>
                </div>
                <div style={{ width: W_BID, backgroundColor: '#292524' }} className="px-2 py-1.5 text-[10.5px] font-mono text-right font-bold">
                  <span style={{ color: '#d6d3d1' }}>{fmtCurrency(group.bidTotal, currency)}</span>
                </div>
                <div style={{ width: W_DIV, backgroundColor: '#fb923c' }} />
                <div style={{ width: W_VAR, backgroundColor: '#1f1d1a' }} className="px-2 py-1.5 text-[10.5px] font-mono text-right font-bold">
                  <span style={{
                    color: (group.actualTotal - group.bidTotal) > 0 ? '#fca5a5'
                      : (group.actualTotal - group.bidTotal) < 0 ? '#86efac' : '#78716c',
                  }}>
                    {group.bidTotal > 0 || group.actualTotal > 0
                      ? `${(group.actualTotal - group.bidTotal) > 0 ? '+' : ''}${fmtCurrency(group.actualTotal - group.bidTotal, currency)}`
                      : '\u2014'}
                  </span>
                </div>
                <div style={{ width: W_ACT, backgroundColor: '#1f1d1a' }} className="px-2 py-1.5 text-[10.5px] font-mono text-right font-bold">
                  <span style={{ color: '#38bdf8' }}>{group.actualTotal > 0 ? fmtCurrency(group.actualTotal, currency) : '\u2014'}</span>
                </div>
                <div className="flex-1" style={{ backgroundColor: '#1f1d1a' }} />
              </div>
            </div>
          ))}

          {/* GRAND TOTAL */}
          <div className="flex" style={{ borderTop: '2px solid #fb923c' }}>
            <div style={{ width: W_NAME + W_TYPE + W_RATE + W_DAYS, backgroundColor: '#292524' }} className="px-3 py-2.5 text-[12.5px] font-mono font-bold uppercase tracking-wider">
              <span style={{ color: '#fb923c' }}>Grand Total</span>
            </div>
            <div style={{ width: W_SUB, backgroundColor: '#292524' }} className="px-2 py-2.5 text-[11.5px] font-mono text-right font-bold">
              <span style={{ color: '#a8a29e' }}>{fmtCurrency(grandTotals.subtotal, currency)}</span>
            </div>
            <div style={{ width: W_MARGIN, backgroundColor: '#292524' }} className="px-2 py-2.5 text-[11.5px] font-mono text-right font-bold">
              <span style={{ color: grandTotals.marginTotal > 0 ? '#fb923c' : '#57534e' }}>{grandTotals.marginTotal > 0 ? `+${fmtCurrency(grandTotals.marginTotal, currency)}` : '\u2014'}</span>
            </div>
            <div style={{ width: W_CONT, backgroundColor: '#292524' }} className="px-2 py-2.5 text-[11.5px] font-mono text-right font-bold">
              <span style={{ color: grandTotals.contTotal > 0 ? '#fb923c' : '#57534e' }}>{grandTotals.contTotal > 0 ? `+${fmtCurrency(grandTotals.contTotal, currency)}` : '\u2014'}</span>
            </div>
            <div style={{ width: W_BID, backgroundColor: '#292524' }} className="px-2 py-2.5 text-[12.5px] font-mono text-right font-bold">
              <span style={{ color: '#d6d3d1' }}>{fmtCurrency(grandTotals.bidTotal, currency)}</span>
            </div>
            <div style={{ width: W_DIV, backgroundColor: '#fb923c' }} />
            <div style={{ width: W_VAR, backgroundColor: '#1f1d1a' }} className="px-2 py-2.5 text-[12.5px] font-mono text-right font-bold">
              <span style={{
                color: grandTotals.variance > 0 ? '#fca5a5' : grandTotals.variance < 0 ? '#86efac' : '#a8a29e',
              }}>
                {grandTotals.bidTotal > 0 || grandTotals.actualTotal > 0
                  ? `${grandTotals.variance > 0 ? '+' : ''}${fmtCurrency(grandTotals.variance, currency)}`
                  : '\u2014'}
              </span>
            </div>
            <div style={{ width: W_ACT, backgroundColor: '#1f1d1a' }} className="px-2 py-2.5 text-[12.5px] font-mono text-right font-bold">
              <span style={{ color: '#d6d3d1' }}>{grandTotals.actualTotal > 0 ? fmtCurrency(grandTotals.actualTotal, currency) : '\u2014'}</span>
            </div>
            <div className="flex-1" style={{ backgroundColor: '#1f1d1a' }} />
          </div>

        </div>
      </div>

      {/* ── Fixed popover (rendered outside the table) ── */}
      {openPopover && popoverRow && (
        <ActualPopover
          pos={openPopover}
          actual={popoverActual}
          colLabel={colHeaders[openPopover.colIdx]}
          memberName={popoverRow.name}
          currency={currency}
          projectId={project?.id}
          onSave={data => handleActualSave(openPopover.memberId, openPopover.colIdx, data)}
          onDelete={id => { deleteActual?.(id); setOpenPopover(null) }}
          onClose={() => setOpenPopover(null)}
        />
      )}

      {/* ── Margin/Contingency popover ── */}
      {mcPopover && mcRow && (
        <MarginContPopover
          pos={mcPopover}
          marginPct={mcRow.marginPct}
          contPct={mcRow.contPct}
          bidTotal={mcRow.bidTotal}
          defaultMargin={defaultMarginPct}
          defaultCont={defaultContPct}
          currency={currency}
          onSave={data => handleMcSave(mcPopover.memberId, data)}
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
      <span className="text-[11.5px] font-mono uppercase tracking-widest block mb-1" style={{ color: colors.label }}>{label}</span>
      <span className="text-xl font-mono font-bold" style={{ color: colors.text }}>{value}</span>
    </div>
  )
}
