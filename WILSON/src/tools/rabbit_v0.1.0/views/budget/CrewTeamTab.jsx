// ============================================================
// CrewTeamTab — Crew/team budget derived from real project data
// ============================================================
//
// Derives bid from: team members + rate card + tasks
// Actuals from: budget_actuals (manual invoice/timecard entry)
//
// Layout (B5 surface 4): ONE kit Table (R3-20). Each member is one <tr>
// spanning the bid zone and the actual zone, so the two halves cannot drift
// apart however many period columns there are — the contract the flex rows
// kept by hand. The department headers, the department subtotals and the
// grand total (the table's <tfoot>) are rows of the same table. The money
// reads in the lane's one order (R3-05): Subtotal, Margin, Contingency, Bid
// total, then Actual and the Variance derived from it, then the periods.
// The column widths are rabbitBudget.css's, declared once and read by the
// header cells; the table scrolls sideways in its own scroller, as wide as
// its columns, so every period stays reachable.
// The popovers are the lane's one BudgetPopover, portalled into <body>.

import { Fragment, useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Users, RotateCcw, Paperclip } from 'lucide-react'
import { COLUMN_MODES } from '../../../../components/Budget/useBudgetLines'
import InvoiceAttachment from '../../../../components/Budget/InvoiceAttachment'
import { useRabbit } from '../../state/RabbitProvider'
import CurrencyDisplay, { formatMoney } from '../../components/CurrencyDisplay'
import { Table, Th, Td, Row, Stat, Toolbar, Button, Badge, Dialog, EmptyState } from '../../../../ui'
import BudgetPopover from './BudgetPopover'
import MarginContPopover from './MarginContPopover'
import '../rabbitBudget.css'

// Session 24: the local-server BASE_URL that used to sit here is gone.
// Invoice attachment now goes through the adapter (InvoiceAttachment),
// so it works on the web and on Local Server alike.

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

// The bid zone's columns (Member / role, Type, Rate, Days, Subtotal, Margin,
// Conting., Bid total), the four a total's label spans, and the actual
// zone's two before its periods (Actual, Variance).
const BID_COLUMNS = 8
const LABEL_COLUMNS = 4
const ACTUAL_COLUMNS = 2

// ── A period's actual, on the lane's one popover (R3-32) ────
// Every field, label and button of the hand-rolled popover — the amount, the
// invoice number, the invoice file, Save and Clear — on BudgetPopover, which
// places itself by its own measured box (no written 280 x 320) and closes on
// a press outside it, as this did, and on Escape (Q17).
function ActualPopover({ anchor, actual, colLabel, memberName, currency, projectId, onSave, onDelete, onClose }) {
  const [value, setValue]     = useState(actual?.value ?? '')
  const [invoice, setInvoice] = useState(actual?.invoice_number || '')
  const [attachName, setAttachName] = useState(actual?.attachment_name || '')
  const [attachPath, setAttachPath] = useState(actual?.attachment_path || '')
  const getAdapter = useRabbit()?.getAdapter

  function handleSave() {
    onSave({
      value: Number(value) || 0,
      invoice_number: invoice.trim() || null,
      attachment_name: attachName || null,
      attachment_path: attachPath || null,
    })
  }

  return (
    <BudgetPopover anchor={anchor} title={`${memberName} / ${colLabel}`} onClose={onClose}>
      <div className="rb-crew-field">
        <span className="ui-field-label">Amount ({currency})</span>
        <input
          type="number" step="any"
          value={value}
          onChange={e => setValue(e.target.value)}
          aria-label={`Amount (${currency})`}
          className="ui-input"
          data-size="sm"
          autoFocus
        />
      </div>
      <div className="rb-crew-field">
        <span className="ui-field-label">Invoice #</span>
        <input
          type="text"
          value={invoice}
          onChange={e => setInvoice(e.target.value)}
          placeholder="INV-001"
          aria-label="Invoice #"
          className="ui-input"
          data-size="sm"
        />
      </div>
      <InvoiceAttachment
        getAdapter={getAdapter}
        projectId={projectId}
        lineId={actual?.line_id || null}
        name={attachName}
        path={attachPath}
        onChange={({ name, path }) => { setAttachName(name); setAttachPath(path) }}
      />
      <div className="rb-crew-pop-actions">
        <Button size="sm" variant="primary" className="rb-crew-save" onClick={handleSave}>
          Save
        </Button>
        {actual?.id && onDelete && (
          <Button size="sm" variant="danger" onClick={() => onDelete(actual.id)}>
            Clear
          </Button>
        )}
      </div>
    </BudgetPopover>
  )
}

export default function CrewTeamTab({
  budgetHook, project, tasks, roleRates, rateCard, teamMembers, expenses, currency,
  projectTitles, onSaveProjectTitle,
}) {
  const { lines, actualsByLine, addLine, updateLine, upsertActual, deleteActual } = budgetHook || {}

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
  // W9: the question window.confirm used to ask, as the kit Dialog.
  const [confirmResetMc, setConfirmResetMc] = useState(false)

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

  // What window.confirm's OK did; the question is the Dialog below.
  async function resetAllMarginCont() {
    for (const line of (lines || []).filter(l => l.sheet === 'crew')) {
      if (line.margin_pct != null || line.contingency_pct != null) {
        await updateLine?.(line.id, { margin_pct: null, contingency_pct: null })
      }
    }
  }

  const colHeaders = Array.from({ length: columnCount }, (_, i) => columnLabel(i, columnMode, projectStart))
  // The period count: the table's one inline style (rabbitBudget.css sizes
  // the table from it) and the span of a total row's empty periods.
  const periods = colHeaders.length
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

  // "Nothing here" is the kit EmptyState (R3-19), its words in sentence case.
  if (!hasData) {
    return (
      <EmptyState
        Icon={Users}
        title="No crew/team data yet"
        body="Add team members in the Team view and assign roles in the Rate card. Tasks with bid days will populate the budget automatically."
      />
    )
  }

  // ── One member, as a row of the table ──
  // A render function, not a component declared in here: that would be a
  // new component type every render, so React would remount every row and a
  // focused control would lose its focus (surface 2b's lesson).
  function memberRow(row) {
    return (
      <Row key={row.id}>
        <Td>
          <span className="rb-crew-name">{row.name}</span>
          {row.title && <span className="rb-crew-title">{row.title}{row.roleSlug ? ` · ${row.roleSlug}` : ''}</span>}
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
              className="rb-crew-role"
            />
          )}
        </Td>
        <Td>
          <Badge>{row.employmentType === 'fulltime' ? 'FT' : 'FR'}</Badge>
        </Td>
        <Td numeric className="rb-crew-quiet">
          <span className="rb-crew-dash" data-empty={row.rate > 0 ? undefined : 'true'}>
            {row.rate > 0 ? <CurrencyDisplay value={row.rate} currency={currency} /> : '—'}
          </span>
        </Td>
        <Td numeric className="rb-crew-quiet">
          <span className="rb-crew-dash" data-empty={row.bidDays > 0 ? undefined : 'true'}>
            {row.bidDays > 0 ? row.bidDays.toFixed(1) : '—'}
          </span>
        </Td>
        <Td numeric className="rb-crew-quiet">
          <span className="rb-crew-dash" data-empty={row.subtotal > 0 ? undefined : 'true'}>
            {row.subtotal > 0 ? <CurrencyDisplay value={row.subtotal} currency={currency} /> : '—'}
          </span>
        </Td>
        {/* Margin and Contingency open the margin & contingency popover. */}
        <Td numeric className="rb-crew-mc-cell">
          <button type="button" onClick={e => handleMcCellClick(e, row.id)} className="ui-input rb-crew-mc" data-size="sm">
            {row.marginAmt > 0
              ? <CurrencyDisplay value={row.marginAmt} currency={currency} signed />
              : <span className="rb-crew-dash" data-empty="true">{'—'}</span>}
          </button>
        </Td>
        <Td numeric className="rb-crew-mc-cell">
          <button type="button" onClick={e => handleMcCellClick(e, row.id)} className="ui-input rb-crew-mc" data-size="sm">
            {row.contAmt > 0
              ? <CurrencyDisplay value={row.contAmt} currency={currency} signed />
              : <span className="rb-crew-dash" data-empty="true">{'—'}</span>}
          </button>
        </Td>
        <Td numeric className="rb-crew-bid">
          <span className="rb-crew-dash" data-empty={row.bidTotal > 0 ? undefined : 'true'}>
            {row.bidTotal > 0 ? <CurrencyDisplay value={row.bidTotal} currency={currency} /> : '—'}
          </span>
        </Td>
        {/* The actual zone: Actual, then the Variance derived from it (R3-05). */}
        <Td numeric className="rb-crew-zone rb-crew-zone-edge">
          <span className="rb-crew-dash" data-empty={row.actualTotal > 0 ? undefined : 'true'}>
            {row.actualTotal > 0 ? <CurrencyDisplay value={row.actualTotal} currency={currency} /> : '—'}
          </span>
        </Td>
        <Td numeric className="rb-crew-zone">
          <span className="rb-crew-var" data-tone={row.variance > 0 ? 'danger' : row.variance < 0 ? 'success' : 'zero'}>
            {row.bidTotal > 0 || row.actualTotal > 0
              ? <CurrencyDisplay value={row.variance} currency={currency} signed />
              : '—'}
          </span>
        </Td>
        {/* Period cells: the same 28px button in each, opening the same popover (R3-33). */}
        {colHeaders.map((label, colIdx) => {
          const cellActual = (row.actuals || []).find(a => a.column_index === colIdx)
          const hasAttach = !!cellActual?.attachment_name
          return (
            <Td key={colIdx} align="center" className="rb-crew-zone rb-crew-period">
              <button
                type="button"
                onClick={e => handleCellClick(e, row.id, colIdx)}
                className="rb-crew-cell"
                data-empty={cellActual?.value ? undefined : 'true'}
              >
                {cellActual?.value ? <CurrencyDisplay value={cellActual.value} currency={currency} /> : '·'}
                {hasAttach && <Paperclip className="rb-crew-clip" aria-hidden="true" />}
              </button>
            </Td>
          )
        })}
      </Row>
    )
  }

  return (
    <div className="rb-crew-tab">
      {/* ── The four tiles: the kit Stat, in one row at the gutter (R3-10) ── */}
      <div className="rb-crew-stats">
        <Stat className="rb-crew-stat" label="Bid total" value={formatMoney(grandTotals.bidTotal, currency)} />
        <Stat
          className="rb-crew-stat"
          label="Actual total"
          value={grandTotals.actualTotal > 0 ? formatMoney(grandTotals.actualTotal, currency) : '—'}
        />
        <Stat
          className="rb-crew-stat"
          label="Variance"
          value={grandTotals.bidTotal > 0 || grandTotals.actualTotal > 0
            ? formatMoney(grandTotals.variance, currency, { sign: 'exceptZero' })
            : '—'}
          valueTone={grandTotals.variance > 0 ? 'danger' : grandTotals.variance < 0 ? 'success' : undefined}
        />
        <Stat className="rb-crew-stat" label="Members" value={memberCount} />
      </div>

      {/* ── The info bar: the kit Toolbar, the same items in the same order
          (C1), on the table's left edge (R3-31). The project's rates are kit
          Badges (they were orange and amber mono chips). ── */}
      <Toolbar wrap className="rb-crew-toolbar">
        <span className="rb-crew-eyebrow">Crew/team budget</span>
        {agencyEnabled && <Badge>Agency: {agencyPct}%</Badge>}
        {(defaultMarginPct > 0 || defaultContPct > 0) && <Badge>Margin: {defaultMarginPct}%</Badge>}
        {(defaultMarginPct > 0 || defaultContPct > 0) && <Badge>Contingency: {defaultContPct}%</Badge>}
        <Button size="sm" Icon={RotateCcw} onClick={() => setConfirmResetMc(true)}>
          Reset M/C
        </Button>
        <span className="rb-crew-hint">
          {COLUMN_MODES.find(m => m.value === columnMode)?.label || columnMode} · {columnCount} cols
        </span>
      </Toolbar>

      {/* ── The table (R3-20): one grid for the header, the departments,
          their members and subtotals, and the grand total. ── */}
      <Table
        className="rb-crew-table"
        style={{ '--rb-crew-cols': periods }}
        head={(
          <Row>
            <Th>Member / role</Th>
            <Th width="var(--rb-crew-w-type)">Type</Th>
            <Th width="var(--rb-crew-w-rate)" numeric>Rate</Th>
            <Th width="var(--rb-crew-w-days)" numeric>Days</Th>
            <Th width="var(--rb-crew-w-money)" numeric>Subtotal</Th>
            <Th width="var(--rb-crew-w-money)" numeric>Margin</Th>
            <Th width="var(--rb-crew-w-money)" numeric>Conting.</Th>
            <Th width="var(--rb-crew-w-money)" numeric>Bid total</Th>
            <Th width="var(--rb-crew-w-money)" numeric className="rb-crew-zone-edge">Actual</Th>
            <Th width="var(--rb-crew-w-money)" numeric>Variance</Th>
            {colHeaders.map((label, i) => (
              <Th key={i} width="var(--rb-crew-w-period)" align="center" className="rb-crew-period-th">{label}</Th>
            ))}
          </Row>
        )}
        foot={(
          <Row>
            <Td colSpan={LABEL_COLUMNS}>Grand total</Td>
            <Td numeric><CurrencyDisplay value={grandTotals.subtotal} currency={currency} /></Td>
            <Td numeric>
              <span className="rb-crew-dash" data-empty={grandTotals.marginTotal > 0 ? undefined : 'true'}>
                {grandTotals.marginTotal > 0 ? <CurrencyDisplay value={grandTotals.marginTotal} currency={currency} signed /> : '—'}
              </span>
            </Td>
            <Td numeric>
              <span className="rb-crew-dash" data-empty={grandTotals.contTotal > 0 ? undefined : 'true'}>
                {grandTotals.contTotal > 0 ? <CurrencyDisplay value={grandTotals.contTotal} currency={currency} signed /> : '—'}
              </span>
            </Td>
            <Td numeric><CurrencyDisplay value={grandTotals.bidTotal} currency={currency} /></Td>
            <Td numeric className="rb-crew-zone rb-crew-zone-edge">
              <span className="rb-crew-dash" data-empty={grandTotals.actualTotal > 0 ? undefined : 'true'}>
                {grandTotals.actualTotal > 0 ? <CurrencyDisplay value={grandTotals.actualTotal} currency={currency} /> : '—'}
              </span>
            </Td>
            <Td numeric className="rb-crew-zone">
              <span className="rb-crew-var" data-tone={grandTotals.variance > 0 ? 'danger' : grandTotals.variance < 0 ? 'success' : 'zero'}>
                {grandTotals.bidTotal > 0 || grandTotals.actualTotal > 0
                  ? <CurrencyDisplay value={grandTotals.variance} currency={currency} signed />
                  : '—'}
              </span>
            </Td>
            {periods > 0 && <Td colSpan={periods} className="rb-crew-zone" />}
          </Row>
        )}
      >
        {departmentGroups.map(group => (
          <Fragment key={group.department}>
            {/* A department's header: its name and its member count. */}
            <Row className="rb-crew-group">
              <Td colSpan={BID_COLUMNS}>
                <span className="rb-crew-group-head">
                  <span className="rb-crew-group-label">{group.department}</span>
                  <span className="rb-crew-group-count">{group.rows.length}</span>
                </span>
              </Td>
              <Td colSpan={ACTUAL_COLUMNS + periods} className="rb-crew-zone rb-crew-zone-edge" />
            </Row>

            {group.rows.map(row => memberRow(row))}

            {/* A department's subtotal. */}
            <Row className="rb-crew-subtotal">
              <Td colSpan={LABEL_COLUMNS}>{group.department} total</Td>
              <Td numeric className="rb-crew-quiet">
                <CurrencyDisplay value={group.subtotal} currency={currency} />
              </Td>
              <Td numeric>
                <span className="rb-crew-dash" data-empty={group.marginTotal > 0 ? undefined : 'true'}>
                  {group.marginTotal > 0 ? <CurrencyDisplay value={group.marginTotal} currency={currency} signed /> : '—'}
                </span>
              </Td>
              <Td numeric>
                <span className="rb-crew-dash" data-empty={group.contTotal > 0 ? undefined : 'true'}>
                  {group.contTotal > 0 ? <CurrencyDisplay value={group.contTotal} currency={currency} signed /> : '—'}
                </span>
              </Td>
              <Td numeric><CurrencyDisplay value={group.bidTotal} currency={currency} /></Td>
              <Td numeric className="rb-crew-zone rb-crew-zone-edge">
                <span className="rb-crew-dash" data-empty={group.actualTotal > 0 ? undefined : 'true'}>
                  {group.actualTotal > 0 ? <CurrencyDisplay value={group.actualTotal} currency={currency} /> : '—'}
                </span>
              </Td>
              <Td numeric className="rb-crew-zone">
                <span
                  className="rb-crew-var"
                  data-tone={group.actualTotal - group.bidTotal > 0 ? 'danger' : group.actualTotal - group.bidTotal < 0 ? 'success' : 'zero'}
                >
                  {group.bidTotal > 0 || group.actualTotal > 0
                    ? <CurrencyDisplay value={group.actualTotal - group.bidTotal} currency={currency} signed />
                    : '—'}
                </span>
              </Td>
              {periods > 0 && <Td colSpan={periods} className="rb-crew-zone" />}
            </Row>
          </Fragment>
        ))}
      </Table>

      {/* ── A period's actual: the lane's popover, in <body> ── */}
      {openPopover && popoverRow && (
        <ActualPopover
          // One popover per cell: opened on another cell while this one is
          // open (from the keyboard), it must not keep this cell's draft and
          // save it into the next (a defect older than the restyle).
          key={`${openPopover.memberId}:${openPopover.colIdx}`}
          anchor={openPopover}
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

      {/* ── Margin & contingency: the lane's one editor (R3-32) ── */}
      {mcPopover && mcRow && (
        <MarginContPopover
          key={mcPopover.memberId}
          anchor={mcPopover}
          amountLabel="Bid total"
          baseAmount={mcRow.bidTotal}
          marginPct={mcRow.marginPct}
          contPct={mcRow.contPct}
          defaultMargin={defaultMarginPct}
          defaultCont={defaultContPct}
          currency={currency}
          onSave={data => handleMcSave(mcPopover.memberId, data)}
          onClose={() => setMcPopover(null)}
        />
      )}

      {/* W9: Reset M/C's window.confirm, word for word, on the kit Dialog in
          <body> (the Expenses tab's). */}
      {confirmResetMc && createPortal(
        <Dialog
          width="confirm"
          title="Reset margin & contingency"
          onClose={() => setConfirmResetMc(false)}
          footer={(
            <>
              <Button autoFocus onClick={() => setConfirmResetMc(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => { setConfirmResetMc(false); resetAllMarginCont() }}>Reset</Button>
            </>
          )}
        >
          Reset all margin & contingency values to the project defaults? This cannot be undone.
        </Dialog>,
        document.body,
      )}
    </div>
  )
}
