// ============================================================
// TalentTab — Talent budget with unified row layout
// ============================================================
//
// Talent + background performers. Standalone (not in team system).
// Per-row agent representation fee (separate from global agency).
//
// Layout (B5 surface 4): ONE kit Table (R3-20), CrewTeamTab's shape. Each
// line is one <tr> spanning the bid zone and the actual zone, so their
// heights always align; a line's details open as a full-width row of the
// same table under it; the grand total is the table's <tfoot>. The money
// reads in the lane's one order (R3-05): Subtotal, Margin, Contingency, Bid
// total, then Actual and the Variance derived from it, then the periods.
// The table scrolls sideways in its own scroller, as wide as its columns
// (rabbitBudget.css declares them once). The popovers are the lane's one
// BudgetPopover, portalled into <body>.

import { Fragment, useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Star, Plus, Trash2, RotateCcw, Paperclip, ChevronRight, ChevronDown } from 'lucide-react'
import InvoiceAttachment from '../../../../components/Budget/InvoiceAttachment'
import { useRabbit } from '../../state/RabbitProvider'
import CurrencyDisplay, { formatMoney } from '../../components/CurrencyDisplay'
import {
  Table, Th, Td, Row, Stat, Toolbar, Button, IconButton, Badge, Dialog, EmptyState, Loading,
  HoverActions, CellSelect,
} from '../../../../ui'
import BudgetPopover from './BudgetPopover'
import MarginContPopover from './MarginContPopover'
import '../rabbitBudget.css'

// Session 24: the local-server BASE_URL that used to sit here is gone.
// Invoice attachment now goes through the adapter (InvoiceAttachment),
// so it works on the web and on Local Server alike.

const TALENT_TYPE_OPTIONS = [
  { value: 'actor',            label: 'Actor' },
  { value: 'voice_actor',     label: 'Voice actor' },
  { value: 'extra',           label: 'Extra' },
  { value: 'background',      label: 'Background' },
  { value: 'stunt_performer', label: 'Stunt performer' },
  { value: 'motion_capture',  label: 'Motion capture performer' },
  { value: 'other',           label: 'Other' },
]

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

// The bid zone's columns (Name, Type, Rate, Days, Subtotal, Agent %, Margin,
// Conting., Bid total, the actions slot), the four the grand total's label
// spans, and the actual zone's two before its periods.
const BID_COLUMNS = 10
const LABEL_COLUMNS = 4
const ACTUAL_COLUMNS = 2

// ── A period's actual, on the lane's one popover (R3-32) ────
// Every field, label and button of the hand-rolled popover — the amount, the
// invoice number, the invoice file, Save and Clear — on BudgetPopover, which
// places itself by its own measured box (no written 280 x 320) and closes on
// a press outside it, as this did, and on Escape (Q17).
function ActualPopover({ anchor, actual, colLabel, lineName, currency, projectId, onSave, onDelete, onClose }) {
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
    <BudgetPopover anchor={anchor} title={`${lineName} / ${colLabel}`} onClose={onClose}>
      <div className="rb-talent-field">
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
      <div className="rb-talent-field">
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
      <div className="rb-talent-pop-actions">
        <Button size="sm" variant="primary" className="rb-talent-save" onClick={handleSave}>
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

// ── Inline editable cell ──────────────────────────────────
// Its behaviour is the review's "what works": Enter commits, Escape reverts,
// leaving the field commits. At rest it reads as the cell's text (a 28px
// borderless button that lifts on hover, B2's cell editors); editing, it is
// the kit's 28px field. Its alignment is its cell's: a figure's cell is
// right-aligned, a name's left.
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
        className="ui-input rb-talent-cell-input"
        data-size="sm"
      />
    )
  }

  return (
    <button type="button" onClick={start} disabled={disabled}
      className="rb-talent-cell-text"
      data-empty={value ? undefined : 'true'}>
      {value || placeholder || '—'}
    </button>
  )
}

export default function TalentTab({ budgetHook, project, expenses, currency }) {
  const {
    lines, lineComputations, actualsByLine,
    addLine, updateLine, deleteLine, upsertActual, deleteActual, loading,
  } = budgetHook

  const allTalent = (lines || []).filter(l => l.sheet === 'talent' && !l.is_section_header)
  const hasLines = allTalent.length > 0

  // No more department grouping — all talent in one flat list

  const columnMode   = project?.budget_actual_column_mode || 'fortnightly'
  const columnCount  = Number(project?.budget_actual_column_count ?? 20)
  const projectStart = project?.start_date || project?.created_at

  // Project-level defaults for margin & contingency
  const defaultMarginPct = Number(project?.budget_margin_pct ?? 0) || 0
  const defaultContPct   = Number(project?.budget_contingency_pct ?? 0) || 0

  // Popover state: { lineId, colIdx, x, y, h }
  const [openPopover, setOpenPopover] = useState(null)
  // Margin/contingency popover: { lineId, x, y, h }
  const [mcPopover, setMcPopover] = useState(null)
  // W9: the question window.confirm used to ask, as the kit Dialog.
  const [confirmResetMc, setConfirmResetMc] = useState(false)
  // Expanded detail rows
  const [expandedRows, setExpandedRows] = useState(new Set())
  function toggleExpand(id) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

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

  async function handleAddTalent() {
    const existing = allTalent.length
    await addLine({ sheet: 'talent', department: 'Talent', label: `Talent ${existing + 1}`, sort_order: existing + 1, talent_type: 'actor' })
  }

  const handleActualSave = useCallback(async (lineId, colIdx, data) => {
    const lineActuals = actualsByLine?.[lineId] || []
    const existing = lineActuals.find(a => a.column_index === colIdx)
    await upsertActual?.({
      ...(existing || {}), line_id: lineId, column_index: colIdx,
      value: data.value, invoice_number: data.invoice_number,
      attachment_name: data.attachment_name || null,
      attachment_path: data.attachment_path || null,
      source: 'manual',
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

  // What window.confirm's OK did; the question is the Dialog below.
  async function resetAllMarginCont() {
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
  // The period count: the table's one inline style (rabbitBudget.css sizes
  // the table from it) and the span of the grand total's empty periods.
  const periods = colHeaders.length

  // "Not yet" is the kit Loading, never the empty state (R3-19).
  if (loading) return <Loading label="Loading talent..." />

  // "Nothing here" is the kit EmptyState, its words in sentence case, with
  // the one action it always offered.
  if (!hasLines) {
    return (
      <EmptyState
        Icon={Star}
        title="No talent budget lines yet"
        body="Add talent performers manually. Use the Talent type column to tag each performer. Agent representation fees are set per row."
      >
        <Button variant="primary" Icon={Plus} onClick={handleAddTalent}>
          Add talent
        </Button>
      </EmptyState>
    )
  }

  // ── One line, as a row of the table (and its details, when open) ──
  // A render function, not a component declared in here: that would be a
  // new component type every render, so React would remount every row and
  // an inline editor would lose its focus (surface 2b's lesson).
  function lineRows(line) {
    const comp = lineComputations[line.id] || {}
    const lineActuals = actualsByLine?.[line.id] || []
    const isExpanded = expandedRows.has(line.id)
    const mPct = line.margin_pct != null ? Number(line.margin_pct) : defaultMarginPct
    const cPct = line.contingency_pct != null ? Number(line.contingency_pct) : defaultContPct
    const mAmt = (comp.bidTotal || 0) * mPct / 100
    const cAmt = (comp.bidTotal || 0) * cPct / 100
    return (
      <Fragment key={line.id}>
        <Row>
          {/* Name — the chevron opens the line's details */}
          <Td className="rb-talent-ctl">
            <span className="rb-talent-name">
              <IconButton
                size="sm"
                Icon={isExpanded ? ChevronDown : ChevronRight}
                title={isExpanded ? 'Hide details' : 'Show details'}
                aria-expanded={isExpanded}
                onClick={() => toggleExpand(line.id)}
              />
              <InlineCell value={line.label} placeholder="Name..." onChange={v => updateLine(line.id, { label: v })} />
            </span>
          </Td>
          {/* Talent type: the kit CellSelect */}
          <Td>
            <CellSelect
              value={line.talent_type || 'actor'}
              onChange={v => updateLine(line.id, { talent_type: v })}
              options={TALENT_TYPE_OPTIONS}
              aria-label={line.label ? `Talent type for ${line.label}` : 'Talent type'}
            />
          </Td>
          <Td numeric className="rb-talent-ctl">
            <InlineCell value={line.rate} type="number" placeholder="0" onChange={v => updateLine(line.id, { rate: v })} />
          </Td>
          <Td numeric className="rb-talent-ctl">
            <InlineCell value={line.days} type="number" placeholder="0" onChange={v => updateLine(line.id, { days: v })} />
          </Td>
          <Td numeric className="rb-talent-quiet">
            <span className="rb-talent-dash" data-empty={comp.subtotal > 0 ? undefined : 'true'}>
              {comp.subtotal > 0 ? <CurrencyDisplay value={comp.subtotal} currency={currency} /> : '—'}
            </span>
          </Td>
          <Td numeric className="rb-talent-ctl">
            <InlineCell value={line.talent_agency_fee_pct} type="number" placeholder="0" onChange={v => updateLine(line.id, { talent_agency_fee_pct: v })} />
          </Td>
          {/* Margin and Contingency open the margin & contingency popover. */}
          <Td numeric className="rb-talent-mc-cell">
            <button type="button" onClick={e => handleMcCellClick(e, line.id)} className="ui-input rb-talent-mc" data-size="sm">
              {mAmt > 0
                ? <CurrencyDisplay value={mAmt} currency={currency} signed />
                : <span className="rb-talent-dash" data-empty="true">{'—'}</span>}
            </button>
          </Td>
          <Td numeric className="rb-talent-mc-cell">
            <button type="button" onClick={e => handleMcCellClick(e, line.id)} className="ui-input rb-talent-mc" data-size="sm">
              {cAmt > 0
                ? <CurrencyDisplay value={cAmt} currency={currency} signed />
                : <span className="rb-talent-dash" data-empty="true">{'—'}</span>}
            </button>
          </Td>
          <Td numeric className="rb-talent-bid">
            <span className="rb-talent-dash" data-empty={comp.bidTotal > 0 ? undefined : 'true'}>
              {comp.bidTotal > 0 ? <CurrencyDisplay value={comp.bidTotal} currency={currency} /> : '—'}
            </span>
          </Td>
          {/* Delete: the kit HoverActions, revealed by hover and by focus (Q17(b)). */}
          <Td align="right" className="rb-talent-acts">
            <HoverActions>
              <IconButton size="sm" Icon={Trash2} danger title="Delete" onClick={() => deleteLine(line.id)} />
            </HoverActions>
          </Td>
          {/* The actual zone: Actual, then the Variance derived from it (R3-05). */}
          <Td numeric className="rb-talent-zone rb-talent-zone-edge">
            <span className="rb-talent-dash" data-empty={comp.actualTotal > 0 ? undefined : 'true'}>
              {comp.actualTotal > 0 ? <CurrencyDisplay value={comp.actualTotal} currency={currency} /> : '—'}
            </span>
          </Td>
          <Td numeric className="rb-talent-zone">
            <span className="rb-talent-var" data-tone={comp.variance > 0 ? 'danger' : comp.variance < 0 ? 'success' : 'zero'}>
              {comp.bidTotal > 0 || comp.actualTotal > 0
                ? <CurrencyDisplay value={comp.variance} currency={currency} signed />
                : '—'}
            </span>
          </Td>
          {/* Period cells: the same 28px button in each, opening the same popover (R3-33). */}
          {colHeaders.map((label, colIdx) => {
            const cellActual = lineActuals.find(a => a.column_index === colIdx)
            const hasAttach = !!cellActual?.attachment_name
            return (
              <Td key={colIdx} align="center" className="rb-talent-zone rb-talent-period">
                <button
                  type="button"
                  onClick={e => handleCellClick(e, line.id, colIdx)}
                  className="rb-talent-cell"
                  data-empty={cellActual?.value ? undefined : 'true'}
                >
                  {cellActual?.value ? <CurrencyDisplay value={cellActual.value} currency={currency} /> : '·'}
                  {hasAttach && <Paperclip className="rb-talent-clip" aria-hidden="true" />}
                </button>
              </Td>
            )
          })}
        </Row>

        {/* ── The line's details: a full-width row of the table under it ── */}
        {isExpanded && (
          <Row>
            <Td colSpan={BID_COLUMNS + ACTUAL_COLUMNS + periods} className="rb-talent-detail-cell">
              <div className="rb-talent-details">
                <TalentDetailField label="Union / Guild #" value={line.union_id} placeholder="SAG-AFTRA #"
                  onChange={v => updateLine(line.id, { union_id: v })} />
                <TalentDetailField label="Agency" value={line.agency_name} placeholder="Agency name"
                  onChange={v => updateLine(line.id, { agency_name: v })} />
                <TalentDetailField label="Agent" value={line.agent_name} placeholder="Agent name"
                  onChange={v => updateLine(line.id, { agent_name: v })} />
                <TalentDetailField label="Phone" value={line.phone} placeholder="Phone"
                  onChange={v => updateLine(line.id, { phone: v })} />
                <TalentDetailField label="Email" value={line.email} placeholder="Email"
                  onChange={v => updateLine(line.id, { email: v })} />
                <TalentDetailField label="Notes" value={line.description} placeholder="Notes..."
                  onChange={v => updateLine(line.id, { description: v })} wide />
              </div>
            </Td>
          </Row>
        )}
      </Fragment>
    )
  }

  return (
    <div className="rb-talent-tab">
      {/* ── The four tiles: the kit Stat, in one row at the gutter (R3-10) ── */}
      <div className="rb-talent-stats">
        <Stat className="rb-talent-stat" label="Bid total" value={formatMoney(totals.bid, currency)} />
        <Stat
          className="rb-talent-stat"
          label="Actual total"
          value={totals.actual > 0 ? formatMoney(totals.actual, currency) : '—'}
        />
        <Stat
          className="rb-talent-stat"
          label="Variance"
          value={totals.bid > 0 || totals.actual > 0
            ? formatMoney(totals.variance, currency, { sign: 'exceptZero' })
            : '—'}
          valueTone={totals.variance > 0 ? 'danger' : totals.variance < 0 ? 'success' : undefined}
        />
        <Stat className="rb-talent-stat" label="Talent" value={allTalent.length} />
      </div>

      {/* ── The toolbar: the kit Toolbar, the same items in the same order
          (C1), on the table's left edge (R3-31). ── */}
      <Toolbar wrap className="rb-talent-toolbar">
        <Button size="sm" variant="primary" Icon={Plus} onClick={handleAddTalent}>
          Add talent
        </Button>
        <span className="rb-talent-hint">Agent fees are per-row</span>
        {(defaultMarginPct > 0 || defaultContPct > 0) && <Badge>Margin: {defaultMarginPct}%</Badge>}
        {(defaultMarginPct > 0 || defaultContPct > 0) && <Badge>Contingency: {defaultContPct}%</Badge>}
        <Button size="sm" Icon={RotateCcw} onClick={() => setConfirmResetMc(true)}>
          Reset M/C
        </Button>
      </Toolbar>

      {/* ── The table (R3-20): one grid, flat — no department groups ── */}
      <Table
        className="rb-talent-table"
        style={{ '--rb-talent-cols': periods }}
        head={(
          <Row>
            <Th>Name</Th>
            <Th width="var(--rb-talent-w-type)">Type</Th>
            <Th width="var(--rb-talent-w-rate)" numeric>Rate</Th>
            <Th width="var(--rb-talent-w-days)" numeric>Days</Th>
            <Th width="var(--rb-talent-w-money)" numeric>Subtotal</Th>
            <Th width="var(--rb-talent-w-pct)" numeric>Agent %</Th>
            <Th width="var(--rb-talent-w-money)" numeric>Margin</Th>
            <Th width="var(--rb-talent-w-money)" numeric>Conting.</Th>
            <Th width="var(--rb-talent-w-money)" numeric>Bid total</Th>
            <Th width="var(--rb-talent-w-acts)" align="right"><span className="sr-only">Actions</span></Th>
            <Th width="var(--rb-talent-w-money)" numeric className="rb-talent-zone-edge">Actual</Th>
            <Th width="var(--rb-talent-w-money)" numeric>Variance</Th>
            {colHeaders.map((label, i) => (
              <Th key={i} width="var(--rb-talent-w-period)" align="center" className="rb-talent-period-th">{label}</Th>
            ))}
          </Row>
        )}
        foot={(
          <Row>
            <Td colSpan={LABEL_COLUMNS}>Grand total</Td>
            <Td numeric><CurrencyDisplay value={totals.subtotal} currency={currency} /></Td>
            <Td />
            <Td numeric>
              <span className="rb-talent-dash" data-empty={totals.marginTotal > 0 ? undefined : 'true'}>
                {totals.marginTotal > 0 ? <CurrencyDisplay value={totals.marginTotal} currency={currency} signed /> : '—'}
              </span>
            </Td>
            <Td numeric>
              <span className="rb-talent-dash" data-empty={totals.contTotal > 0 ? undefined : 'true'}>
                {totals.contTotal > 0 ? <CurrencyDisplay value={totals.contTotal} currency={currency} signed /> : '—'}
              </span>
            </Td>
            <Td numeric><CurrencyDisplay value={totals.bid} currency={currency} /></Td>
            <Td />
            <Td numeric className="rb-talent-zone rb-talent-zone-edge">
              <span className="rb-talent-dash" data-empty={totals.actual > 0 ? undefined : 'true'}>
                {totals.actual > 0 ? <CurrencyDisplay value={totals.actual} currency={currency} /> : '—'}
              </span>
            </Td>
            <Td numeric className="rb-talent-zone">
              <span className="rb-talent-var" data-tone={totals.variance > 0 ? 'danger' : totals.variance < 0 ? 'success' : 'zero'}>
                {totals.bid > 0 || totals.actual > 0
                  ? <CurrencyDisplay value={totals.variance} currency={currency} signed />
                  : '—'}
              </span>
            </Td>
            {periods > 0 && <Td colSpan={periods} className="rb-talent-zone" />}
          </Row>
        )}
      >
        {allTalent.map(line => lineRows(line))}
      </Table>

      {/* ── A period's actual: the lane's popover, in <body> ── */}
      {openPopover && popoverLine && (
        <ActualPopover
          // One popover per cell: opened on another cell while this one is
          // open (from the keyboard), it must not keep this cell's draft and
          // save it into the next (a defect older than the restyle).
          key={`${openPopover.lineId}:${openPopover.colIdx}`}
          anchor={openPopover}
          actual={popoverActual}
          colLabel={colHeaders[openPopover.colIdx]}
          lineName={popoverLine.label}
          currency={currency}
          projectId={project?.id}
          onSave={data => handleActualSave(openPopover.lineId, openPopover.colIdx, data)}
          onDelete={id => { deleteActual?.(id); setOpenPopover(null) }}
          onClose={() => setOpenPopover(null)}
        />
      )}

      {/* ── Margin & contingency: the lane's one editor (R3-32) ── */}
      {mcPopover && mcLine && (
        <MarginContPopover
          key={mcPopover.lineId}
          anchor={mcPopover}
          amountLabel="Bid total"
          baseAmount={lineComputations[mcLine.id]?.bidTotal || 0}
          marginPct={mcLine.margin_pct != null ? Number(mcLine.margin_pct) : defaultMarginPct}
          contPct={mcLine.contingency_pct != null ? Number(mcLine.contingency_pct) : defaultContPct}
          defaultMargin={defaultMarginPct}
          defaultCont={defaultContPct}
          currency={currency}
          onSave={data => handleMcSave(mcPopover.lineId, data)}
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

// ── Talent detail inline field (expandable row) ──
// Its Label-step label over the same editor as the cells: Enter commits,
// Escape reverts, leaving the field commits.
function TalentDetailField({ label, value, placeholder, onChange, wide }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select() }
  }, [editing])

  function start() { setDraft(String(value ?? '')); setEditing(true) }
  function commit() {
    setEditing(false)
    if (draft !== (value ?? '')) onChange(draft)
  }

  return (
    <div className="rb-talent-detail-field" data-wide={wide ? 'true' : undefined}>
      <span className="ui-field-label">{label}</span>
      {editing ? (
        <input ref={ref} type="text" value={draft} onChange={e => setDraft(e.target.value)}
          onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setEditing(false) }}
          className="ui-input rb-talent-cell-input"
          data-size="sm" />
      ) : (
        <button type="button" onClick={start}
          className="rb-talent-cell-text"
          data-empty={value ? undefined : 'true'}>
          {value || placeholder || '—'}
        </button>
      )}
    </div>
  )
}
