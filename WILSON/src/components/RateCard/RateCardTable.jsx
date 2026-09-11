// ============================================================
// RateCardTable — editable rate card entries grid
// ============================================================
//
// Columns: Role · Dept · Hourly · Day · Burden · Overhead · Total · Curr ·
//          Region · Tier · Actions
//
// Groups entries by department with collapsible sections.
// Department group headers include editable default burden% and overhead%.
//
// For Internal rate card type:
//   • Auto-merges team member data with rate entries
//   • Ghost rows for team members without rate data (warning indicator)
//   • Editing a ghost row auto-creates the entry
//
// Burden / overhead per entry can be percent-of-wage or fixed-dollar.
// A small toggle in each cell switches between the two modes.
// When null, the department default kicks in (shown as "dept X%").
//
// Total = wage + burden_amount + overhead_amount (computed, read-only).
//
// ── UI overhaul C1 ───────────────────────────────────────────────────────────
//
// Every one of the eleven columns, all six inline editors, both branches of
// each of them, the ghost rows, the draft row, the collapse, the department
// defaults in both places and Escape-reverts-the-edit are exactly what they
// were. The review's own note: "The interaction is right; only its typography
// and hit targets are wrong."
//
//  · THE WORST ALIGNMENT DEFECT ON THE SURFACE IS FIXED. `th` padded 6px 4px,
//    `td` padded 1px 2px, and every inner control added its own 8px or 4px —
//    so in an ELEVEN-column financial grid each column label sat 6px left of
//    its own data, and the row height came from `EditCell`'s `minHeight: 28px`
//    rather than from the row. The kit `Table` owns the 8px/12px cell on both
//    `th` and `td`; every control below is padded to ZERO horizontally and
//    fills its cell; the row declares `--row` (36px) and the head 32px.
//
//    Measured, because an earlier cut of this file asserted 36 and rendered
//    63: a `--control-sm` toggle stacked above the derived amount inside an
//    8px-padded cell. The toggle is 20px and the derived amount sits beside
//    the value, so a burden cell no longer sets the row's height. What does
//    set it is the row-actions slot — a 28px icon button plus the cell's 16px
//    of vertical padding is 44 — so these rows render at 45px, which is what
//    EVERY kit table row holding a `sm` control renders at, Team Members
//    included. The declared 36px is the floor, not the outcome; that tension
//    between `--row` and `--control-sm` + `--cell-pad-y` is the kit's and is
//    recorded in the hand-off.
//
//  · THE STICKY HEADER HAS A REGION. `th` painted bare `#f4a261`, identical to
//    the page, so rows scrolled THROUGH the header text. `paper-raised`
//    (F-R35).
//
//  · THE DIVIDER WAS `#fed7aa`, a near-white peach on an orange page (C9).
//
//  · THE %/$ TOGGLE HAS A TARGET. It was 9px at `opacity: 0.45` in roughly a
//    16x14px hit area, 2px from a different action, on every row — and the
//    mis-click silently changes a rate from a percentage to a dollar amount on
//    a financial record. Both controls stay and both behaviours stay; the
//    toggle takes a reserved 28px slot at the cell's right edge, 8px clear of
//    the value, at the Label step in full-strength ink (F-R21). The editing
//    branch was already sized correctly, so the two states finally match.
//
//  · THE ROW ACTIONS ARE A RESERVED, FIXED-WIDTH SLOT, so the column cannot
//    shift when a row is a ghost or the grant is view-only. They stay VISIBLE
//    at rest: they were visible before, and hiding a control that was not
//    hidden is what C1 calls a disclosure. Hick's #4 is answered by the
//    toggle's reserved slot and the one cell inset, not by hiding two icons.
//
//  · THERE IS A SUMMARY ROW, AND IT IS AN AVERAGE, NOT A SUM.
//
//    The plan's bundle line asks for "totals rows", which it inherits from the
//    money-table prescription written for BudgetView. A budget is a bill and
//    its column sums to something real. A rate card is a PRICE LIST: adding a
//    producer's day rate to an editor's day rate produces a figure that is
//    true only if every role on the card works exactly one day, which is the
//    same fabricated-number defect this overhaul removed from O.T.T.E.R.'s
//    progress readout (Q22). The first cut of this file summed anyway, and an
//    adversarial review was right to say so.
//
//    What IS true of a price list is what a rate costs on average and how many
//    rates that covers, so the row says that. It is PER CURRENCY — these rows
//    can carry several, and one figure across them is true of nothing either.
//
//    It sits at the end of the body rather than in a `<tfoot>`, because the
//    shared Table has no footer slot; that is a kit request in the hand-off.
//    Flagged for Audrey in the walkthrough: an average is this session's
//    reading of "totals row" for this particular table, not her ruling.
//
//  · MONO KEEPS THE FIGURES AND LOSES EVERYTHING ELSE. The surface was mono
//    throughout, including role labels and department names (F-R18/Q4).
//
// 🚨 THE GHOST BRANCH IS LOAD-BEARING. Ghost rows, the draft row and the
// department-default editors all write through `handleUpdate`, and a restyle
// that changed which element receives the click could convert a ghost row into
// a real entry on a stray click — a write to a financial record (review Risk
// 8). No cell was wrapped in anything clickable: the row is not `interactive`,
// and every editor is the same <button> or <input> it already was.
// ============================================================

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Trash2, Copy, Plus, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { CURRENCIES } from '../settings/CurrencyPicker'
import { DEFAULT_DEPARTMENTS } from '../TeamMembers/useTeamMembers'
import { computeEntryTotal, BUDGET_TIERS } from './useRateCard'
import {
  Card, EmptyState, HoverActions, IconButton, Row, Table, Td, Th,
} from '../../ui'
import '../Resources/resources.css'

const DEPT_ORDER = Object.fromEntries(DEFAULT_DEPARTMENTS.map((d, i) => [d, i]))

function formatCurrency(value, currency) {
  if (value === null || value === undefined || value === '') return ''
  const num = Number(value)
  if (!Number.isFinite(num)) return ''
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(num)
  } catch {
    return String(num)
  }
}

function parseNumeric(input) {
  if (input === '' || input === null || input === undefined) return null
  const cleaned = String(input).replace(/[^\d.\-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

// ─── Inline editable cell ───
// TWO returned branches, and the EDITING one is what the user looks at while
// typing — converting only the display branch leaves the editor unstyled
// (review Risk 1). Both are named classes; both are zero-inset and full-width,
// so the cell does not move when it opens.
function EditCell({
  value, onCommit, placeholder, align = 'left',
  mono = false, numeric = false, currency, readOnly = false,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select() }
  }, [editing])

  const display = numeric
    ? (value != null && value !== '' ? formatCurrency(value, currency) : null)
    : (value || null)

  function start() {
    if (readOnly) return
    setDraft(value == null ? '' : String(value))
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const next = numeric ? parseNumeric(draft) : draft.trim()
    if (next !== value && !(next == null && (value == null || value === undefined || value === ''))) {
      onCommit(next)
    }
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          // Escape reverts the edit; Enter commits. Kept exactly (F-R08).
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
        }}
        className="rc-cell-input"
        data-align={align}
        data-numeric={mono || numeric || undefined}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={start}
      className="rc-cell"
      data-align={align}
      data-numeric={mono || numeric || undefined}
      data-readonly={readOnly || undefined}
    >
      {display || <span className="rc-cell-placeholder">{placeholder || '—'}</span>}
    </button>
  )
}

// ─── Burden / Overhead cell ───
// Value + a type toggle (% / $) + the computed amount. When null and a dept
// default exists, shows the default indicator.
function RateCompCell({ value, type, computedAmount, onCommitValue, onToggleType, currency, deptPct, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select() }
  }, [editing])

  const hasValue = value != null && value !== ''
  const isPercent = type !== 'fixed'
  const usingDeptDefault = !hasValue && deptPct != null

  function start() {
    if (readOnly) return
    setDraft(value != null ? String(value) : '')
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const num = parseNumeric(draft)
    if (num !== value && !(num == null && (value == null || value === ''))) {
      onCommitValue(num)
    }
  }

  // The toggle is the SAME slot in both branches, which is what makes the
  // display and editing states finally line up (F-R21). Its size is set in
  // CSS at 20px rather than the 28px control token, so that giving it a real
  // target does not also make the densest table on the surface 63px per row —
  // see the note on `.rc-comp-type` in `resources.css`.
  const toggle = (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onToggleType() }}
      className="rc-comp-type"
      title={`Switch to ${isPercent ? 'a fixed amount' : 'a percentage'}`}
    >
      {isPercent ? '%' : '$'}
    </button>
  )

  if (editing) {
    return (
      <div className="rc-comp">
        <input
          ref={ref}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
          }}
          className="rc-cell-input rc-comp-value"
          data-align="right"
          data-numeric
        />
        {toggle}
      </div>
    )
  }

  // 🚨 THE DERIVED AMOUNT IS A CHILD OF `.rc-comp`, NOT A SIBLING. It is a
  // grid item — row 2, spanning both columns — and a span outside the grid
  // gets none of that: `grid-column`, `grid-row` and `width: 100%` are all
  // no-ops on an inline element whose parent is a `<td>`. An earlier cut of
  // this file wrote the grid and left the span outside it, so the rule that
  // exists to stop `= $1,234,567.89` truncating to `= $1,234,567…` did
  // nothing at all, while its own comment said otherwise. Round 2 measured it.
  return (
    <div className="rc-comp">
      <button
        type="button"
        onClick={start}
        className="rc-cell rc-comp-value"
        data-align="right"
        data-numeric
        data-readonly={readOnly || undefined}
      >
        {hasValue
          ? (isPercent ? `${value}%` : formatCurrency(value, currency))
          : (usingDeptDefault ? `dept ${deptPct}%` : '—')}
      </button>
      {toggle}
      {computedAmount > 0 && (
        <span className="rc-comp-derived" title={formatCurrency(computedAmount, currency)}>
          = {formatCurrency(computedAmount, currency)}
        </span>
      )}
    </div>
  )
}

// ─── Inline currency dropdown ───
function CurrencyCell({ value, onCommit, readOnly = false }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) { setFilter(''); return }
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const current = CURRENCIES.find(c => c.code === (value || 'USD')) || CURRENCIES[0]
  const filtered = filter
    ? CURRENCIES.filter(c =>
        c.code.toLowerCase().includes(filter.toLowerCase()) ||
        c.label.toLowerCase().includes(filter.toLowerCase()))
    : CURRENCIES

  return (
    <div className="rc-currency" ref={wrapRef}>
      <button
        type="button"
        onClick={() => { if (!readOnly) setOpen(o => !o) }}
        className="rc-currency-face"
      >
        <span className="rc-currency-symbol">{current.symbol}</span>
        <span>{current.code}</span>
      </button>
      {open && (
        // A floating list must be OPAQUE or the grid shows through it.
        <div className="rc-currency-menu">
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search"
            className="rc-currency-search"
            autoFocus
          />
          {filtered.map(c => (
            <button
              key={c.code}
              type="button"
              onClick={() => { onCommit(c.code); setOpen(false) }}
              className="rc-currency-option"
              data-current={c.code === current.code || undefined}
            >
              <span className="rc-currency-symbol">{c.symbol}</span>
              <span className="rc-currency-code">{c.code}</span>
              <span className="rc-currency-label">{c.label}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="rc-currency-empty">No matches.</div>}
        </div>
      )}
    </div>
  )
}

// ─── Department select ───
function DepartmentSelect({ value, onChange, readOnly = false }) {
  if (readOnly) {
    return <span className="rc-cell" data-readonly>{value || '—'}</span>
  }
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value || null)}
      className="rc-select"
      aria-label="Department"
      title={value || 'Department'}
    >
      <option value="">—</option>
      {DEFAULT_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
    </select>
  )
}

// ─── Budget tier select ───
function TierSelect({ value, onChange, readOnly = false }) {
  return (
    <select
      value={value || ''}
      disabled={readOnly}
      onChange={e => onChange(e.target.value || null)}
      className="rc-select"
      aria-label="Budget tier"
      title={BUDGET_TIERS.find(t => t.value === value)?.label || 'Budget tier'}
    >
      <option value="">—</option>
      {BUDGET_TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
    </select>
  )
}

// ─── Department default inline editor ───
// Two branches again, and it appears in TWO places on one screen — the bulk
// panel and every department bar — which the review keeps deliberately
// (Hick's #3: "Keep both behaviours"). On the bar it takes the fill's own ink.
function DeptDefaultInput({ label, value, onChange }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select() }
  }, [editing])

  function start() {
    setDraft(value != null ? String(value) : '')
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    onChange(parseNumeric(draft))
  }

  if (editing) {
    return (
      <span className="rc-dd" data-editing>
        <span className="rc-dd-label">{label}</span>
        <input
          ref={ref}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
          }}
          className="rc-dd-input"
          aria-label={label}
        />
      </span>
    )
  }

  return (
    <button type="button" onClick={start} className="rc-dd">
      <span className="rc-dd-label">{label}</span>
      <span className="rc-dd-value">{value != null ? `${value}%` : '—'}</span>
    </button>
  )
}

// ─── Column widths ───
// `table-layout: fixed` reads the header row, so these ARE the grid.
//
// 🚨 Sums to exactly 100: 16 + 11 + 8 + 8 + 11 + 11 + 8 + 6 + 6 + 7 + 8.
//
// They are MEASURED, not guessed. An earlier cut of this file gave the action
// column 4 percent, which is what it had before — and at the 1280px minimum
// window that is a 38px cell holding two 28px buttons, so they overflowed it.
// The numbers below were checked against the narrowest real case (a 1280px
// window minus the 240px side panel and the 24px gutters), against the
// `min-width` the card carries so the table scrolls rather than crushing, and
// against the content each column actually holds:
//
//   actions  two 28px buttons + the 24px cell inset = 82px minimum
//   curr     a symbol, a gap and a three-letter code in the mono
//   total    the widest money string on the card
//   dept     a <select>, which has no `text-overflow` and hard-clips
//   tier     the same, with the longest label ("Tier 4 — AAA / Tentpole")
//
// The two selects carry a `title`, as Team Members' department select does,
// so a clipped value is still readable.
const COL = {
  name: '16%', dept: '11%', hourly: '8%', wage: '8%', burden: '11%',
  overhead: '11%', total: '8%', curr: '6%', region: '6%', tier: '7%',
  actions: '8%',
}

// Hours in a standard working day. `wage` is stored per DAY — it is the only
// rate persisted — so the hourly column is DERIVED from it and editing hourly
// writes the day rate back. One stored number means the two boxes can never
// disagree, which two independent columns would allow within a week.
//
// ⚠️ 8 is an assumption, and it is visible in the column header rather than
// buried here, so it can be argued with. If a studio bills 10-hour days this
// wants to become a workspace setting, which is a schema change, not a tweak.
const HOURS_PER_DAY = 8

// ─── Main table ───
export default function RateCardTable({
  entries = [],
  deptDefaults = [],
  cardType = 'general',
  teamMembers = [],
  loading,
  addEntry,
  updateEntry,
  deleteEntry,
  updateDeptDefault,
  makeSlug,
  // Session 9: per-user grants can confer VIEW without EDIT — RLS would
  // reject the writes anyway; this keeps the UI honest about it.
  readOnly = false,
}) {
  const isInternal = cardType === 'internal'

  // ── Merge team members with entries for internal card ──
  const displayRows = useMemo(() => {
    if (!isInternal || !teamMembers.length) return entries

    const entryByMemberId = new Map()
    for (const e of entries) {
      if (e.member_id) entryByMemberId.set(e.member_id, e)
    }

    const merged = teamMembers.map(member => {
      const entry = entryByMemberId.get(member.id)
      if (entry) return { ...entry, _member: member, _hasEntry: true }
      return {
        id: `_ghost_${member.id}`,
        member_id: member.id,
        role_label: member.title || '',
        role_slug: makeSlug(member.title || member.name),
        department: member.department || null,
        wage: null,
        burden: null,
        burden_type: 'percent',
        overhead: null,
        overhead_type: 'percent',
        currency: 'USD',
        region: member.location || null,
        project_size: null,
        _member: member,
        _hasEntry: false,
      }
    })

    // Include entries not linked to any current team member
    const memberIds = new Set(teamMembers.map(m => m.id))
    for (const e of entries) {
      if (!e.member_id || !memberIds.has(e.member_id)) {
        merged.push({ ...e, _hasEntry: true })
      }
    }

    return merged
  }, [isInternal, entries, teamMembers, makeSlug])

  // ── Group by department ──
  const grouped = useMemo(() => {
    const groups = new Map()
    for (const row of displayRows) {
      const dept = row.department || 'Other'
      if (!groups.has(dept)) groups.set(dept, [])
      groups.get(dept).push(row)
    }
    return [...groups.entries()].sort((a, b) => {
      const ai = DEPT_ORDER[a[0]] ?? 999
      const bi = DEPT_ORDER[b[0]] ?? 999
      if (ai !== bi) return ai - bi
      return a[0].localeCompare(b[0])
    })
  }, [displayRows])

  // ── The summary row, per currency ──
  //
  // 🚨 AVERAGES, NOT SUMS, and per currency. See the note at the head of this
  // file: adding one role's day rate to another's describes nothing, and
  // adding across currencies describes less than nothing. The mean day rate
  // and the mean fully-loaded rate are both true of the card, and the count
  // says how many rates each is the mean of.
  //
  // A row with no wage is not a rate, so it is not averaged in — otherwise
  // every unrated team member on the internal card would drag the mean down
  // and the number would describe the roster rather than the rates.
  const summary = useMemo(() => {
    const byCurrency = new Map()
    for (const row of displayRows) {
      const { total } = computeEntryTotal(row, deptDefaults)
      if (!(total > 0)) continue
      const code = row.currency || 'USD'
      const acc = byCurrency.get(code) || { currency: code, day: 0, total: 0, rows: 0 }
      acc.day += Number(row.wage ?? row.day_rate ?? 0) || 0
      acc.total += total
      acc.rows += 1
      byCurrency.set(code, acc)
    }
    return [...byCurrency.values()]
      .map(a => ({ ...a, day: a.day / a.rows, total: a.total / a.rows }))
      .sort((a, b) => a.currency.localeCompare(b.currency))
  }, [displayRows, deptDefaults])

  // ── Collapsed state ──
  const [collapsed, setCollapsed] = useState(new Set())
  function toggleDept(dept) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(dept) ? next.delete(dept) : next.add(dept)
      return next
    })
  }

  // ── Draft row state (general card only) ──
  const emptyDraft = useMemo(() => ({
    role_label: '', role_slug: '', department: null, wage: null,
    burden: null, burden_type: 'percent', overhead: null, overhead_type: 'percent',
    currency: 'USD', region: '', project_size: null,
  }), [])
  const [draft, setDraft] = useState(emptyDraft)

  function patchDraft(field, value) {
    setDraft(prev => {
      const next = { ...prev, [field]: value }
      if (field === 'role_label') next.role_slug = makeSlug(value)
      return next
    })
  }

  async function commitDraft() {
    if (readOnly || !draft.role_label?.trim()) return
    const toCreate = { ...draft }
    setDraft(emptyDraft)
    try { await addEntry(toCreate) } catch { /* surfaced via hook */ }
  }

  // ── Handlers ──
  async function handleUpdate(row, patch) {
    if (readOnly) return
    // Ghost rows (internal card, no entry yet) — create on first edit
    if (row._hasEntry === false && row.id?.startsWith('_ghost_')) {
      const full = { ...row, ...patch }
      delete full.id
      delete full._member
      delete full._hasEntry
      try { await addEntry(full) } catch { /* surfaced via hook */ }
      return
    }
    try { await updateEntry(row.id, patch) } catch { /* surfaced via hook */ }
  }

  async function handleDuplicate(row) {
    if (readOnly || row._hasEntry === false) return
    const copy = { ...row }
    delete copy.id; delete copy._member; delete copy._hasEntry
    copy.role_label = `${row.role_label || ''} (copy)`
    copy.role_slug = makeSlug(copy.role_label)
    try { await addEntry(copy) } catch { /* surfaced via hook */ }
  }

  async function handleDelete(row) {
    if (readOnly || row._hasEntry === false) return
    try { await deleteEntry(row.id) } catch { /* surfaced via hook */ }
  }

  function getDeptDefault(dept) {
    return deptDefaults.find(d => d.department === dept) || {}
  }

  // ── Show dept defaults panel? Only when updateDeptDefault is available ──
  const [defaultsOpen, setDefaultsOpen] = useState(false)

  return (
    <div className="rc-table-wrap">
      {/* ── Department defaults panel ──
          It holds editors that also exist on every department bar below, so
          the same value is editable in two places on one screen. The review
          keeps BOTH (Hick's #3) and asks only that this one read as the BULK
          path, which the label now says. It is collapsed at rest, as before. */}
      {updateDeptDefault && (
        <div className="rc-defaults">
          <button
            type="button"
            onClick={() => setDefaultsOpen(o => !o)}
            className="rc-defaults-toggle"
            aria-expanded={defaultsOpen}
          >
            {defaultsOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            <span className="rc-defaults-title">Edit all department defaults</span>
            <span className="rs-count">Burden % and overhead %</span>
          </button>
          {defaultsOpen && (
            <div className="rc-defaults-grid">
              {DEFAULT_DEPARTMENTS.map(dept => {
                const dd = deptDefaults.find(d => d.department === dept) || {}
                return (
                  <div key={dept} className="rc-defaults-card">
                    <span className="rc-defaults-dept">{dept}</span>
                    <div className="rc-defaults-pair">
                      <DeptDefaultInput
                        label="Burden"
                        value={dd.burden_pct}
                        onChange={v => updateDeptDefault(dept, { burden_pct: v })}
                      />
                      <DeptDefaultInput
                        label="Overhead"
                        value={dd.overhead_pct}
                        onChange={v => updateDeptDefault(dept, { overhead_pct: v })}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <Card pad={false} className="rc-card">
        <Table
          aria-label={isInternal ? 'Internal rate card' : 'General rate card'}
          head={(
            <Row>
              <Th width={COL.name}>{isInternal ? 'Member' : 'Role'}</Th>
              <Th width={COL.dept}>Dept</Th>
              <Th width={COL.hourly} numeric>Hourly</Th>
              <Th width={COL.wage} numeric>Day</Th>
              <Th width={COL.burden} numeric>Burden</Th>
              <Th width={COL.overhead} numeric>Overhead</Th>
              <Th width={COL.total} numeric>Total</Th>
              <Th width={COL.curr} align="center">Curr</Th>
              <Th width={COL.region}>Region</Th>
              <Th width={COL.tier}>Tier</Th>
              <Th width={COL.actions}><span className="rs-sr">Actions</span></Th>
            </Row>
          )}
          /* The per-currency averages, in a real <tfoot> (F3 closed C1's kit
             request 3). They used to be the last rows of the <tbody> because
             the shared Table had no footer slot; same picture, correct
             element, and now they stay put while the body scrolls. */
          foot={summary.map(t => (
            <Row key={`avg-${t.currency}`} className="rc-total-row">
              <Td colSpan={3}>
                <span className="rc-total-label">
                  Average · {t.currency} · {t.rows} rate{t.rows === 1 ? '' : 's'}
                </span>
              </Td>
              <Td numeric>{formatCurrency(t.day, t.currency)}</Td>
              <Td colSpan={2} />
              <Td numeric>{formatCurrency(t.total, t.currency)}</Td>
              <Td colSpan={4} />
            </Row>
          ))}
        >
          {grouped.map(([dept, rows]) => {
            const isOpen = !collapsed.has(dept)
            const dd = getDeptDefault(dept)

            return (
              <Fragment key={dept}>
                {/* ── Department group header ──
                    Audrey, 2026-08-10: "make the yellow team bars in the
                    internal page a dark orange … stick to our color palette."
                    `#c2410c` carries white at 5.18:1 and is the one status
                    fill on this surface the review measured and kept; it is
                    `signal-fill` app-wide now (Q16). Its label indents to the
                    first column's text inset, so the group reads as a heading
                    over the column it names (alignment list #10). */}
                <tr>
                  <td colSpan={11} className="rc-dept-cell">
                    <div className="rc-dept">
                      <button
                        type="button"
                        onClick={() => toggleDept(dept)}
                        className="rc-dept-toggle"
                        aria-expanded={isOpen}
                      >
                        {isOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                        <span className="rc-dept-name">{dept}</span>
                        <span className="rc-dept-count">{rows.length}</span>
                      </button>

                      {dept !== 'Other' && updateDeptDefault && (
                        <div className="rc-dept-defaults">
                          <DeptDefaultInput
                            label="Burden"
                            value={dd.burden_pct}
                            onChange={v => updateDeptDefault(dept, { burden_pct: v })}
                          />
                          <DeptDefaultInput
                            label="Overhead"
                            value={dd.overhead_pct}
                            onChange={v => updateDeptDefault(dept, { overhead_pct: v })}
                          />
                        </div>
                      )}
                    </div>
                  </td>
                </tr>

                {/* ── Entries in this group ── */}
                {isOpen && rows.map(row => {
                  const computed = computeEntryTotal(row, deptDefaults)
                  const isGhost = row._hasEntry === false

                  return (
                    <Row key={row.id} className="rc-row" data-ghost={isGhost || undefined}>
                      {/* Role / Member name */}
                      <Td>
                        {isInternal && row._member ? (
                          <span className="rc-member">
                            <span className="rc-member-name">{row._member.name}</span>
                            {row._member.title && (
                              <span className="rc-member-title">{row._member.title}</span>
                            )}
                            {isGhost && (
                              <AlertTriangle className="rc-member-warn" role="img" aria-label="No rate set" />
                            )}
                          </span>
                        ) : (
                          <EditCell
                            value={row.role_label}
                            onCommit={v => handleUpdate(row, { role_label: v, role_slug: makeSlug(v) })}
                            placeholder={isInternal ? 'Title…' : 'Role…'}
                            readOnly={readOnly}
                          />
                        )}
                      </Td>

                      {/* Department */}
                      <Td>
                        <DepartmentSelect
                          value={row.department}
                          onChange={v => handleUpdate(row, { department: v })}
                          readOnly={readOnly || (isInternal && !!row._member)}
                        />
                      </Td>

                      {/* Hourly — derived from the day rate, and editable.
                          Committing here multiplies back up so `wage` stays
                          the single stored number. */}
                      <Td numeric>
                        <EditCell
                          value={row.wage == null || row.wage === '' ? null
                            : Math.round((Number(row.wage) / HOURS_PER_DAY) * 100) / 100}
                          numeric
                          currency={row.currency}
                          onCommit={v => handleUpdate(row, {
                            wage: v == null || v === '' ? null
                              : Math.round(Number(v) * HOURS_PER_DAY * 100) / 100,
                          })}
                          placeholder="—"
                          align="right"
                          mono
                          readOnly={readOnly}
                        />
                      </Td>

                      {/* Day rate — the stored `wage` */}
                      <Td numeric>
                        <EditCell
                          value={row.wage}
                          numeric
                          currency={row.currency}
                          onCommit={v => handleUpdate(row, { wage: v })}
                          placeholder="—"
                          align="right"
                          mono
                          readOnly={readOnly}
                        />
                      </Td>

                      {/* Burden */}
                      <Td numeric>
                        <RateCompCell
                          value={row.burden}
                          type={row.burden_type || 'percent'}
                          computedAmount={computed.burden_amount}
                          onCommitValue={v => handleUpdate(row, { burden: v })}
                          onToggleType={() => handleUpdate(row, {
                            burden_type: (row.burden_type || 'percent') === 'percent' ? 'fixed' : 'percent',
                          })}
                          currency={row.currency}
                          deptPct={dd.burden_pct}
                          readOnly={readOnly}
                        />
                      </Td>

                      {/* Overhead */}
                      <Td numeric>
                        <RateCompCell
                          value={row.overhead}
                          type={row.overhead_type || 'percent'}
                          computedAmount={computed.overhead_amount}
                          onCommitValue={v => handleUpdate(row, { overhead: v })}
                          onToggleType={() => handleUpdate(row, {
                            overhead_type: (row.overhead_type || 'percent') === 'percent' ? 'fixed' : 'percent',
                          })}
                          currency={row.currency}
                          deptPct={dd.overhead_pct}
                          readOnly={readOnly}
                        />
                      </Td>

                      {/* Total (computed, read-only). Weight carries it, not a
                          green: `#166534` measured 3.46:1 and was one of three
                          greens the review pinned as failing (F-R19). */}
                      <Td numeric>
                        <span className="rc-total" data-positive={computed.total > 0 || undefined}>
                          {computed.total > 0 ? formatCurrency(computed.total, row.currency) : '—'}
                        </span>
                      </Td>

                      {/* Currency */}
                      <Td align="center">
                        <CurrencyCell
                          value={row.currency}
                          onCommit={v => handleUpdate(row, { currency: v })}
                          readOnly={readOnly}
                        />
                      </Td>

                      {/* Region */}
                      <Td>
                        <EditCell
                          value={row.region}
                          onCommit={v => handleUpdate(row, { region: v || null })}
                          placeholder="—"
                          readOnly={readOnly}
                        />
                      </Td>

                      {/* Tier */}
                      <Td>
                        <TierSelect
                          value={row.project_size}
                          onChange={v => handleUpdate(row, { project_size: v })}
                          readOnly={readOnly}
                        />
                      </Td>

                      {/* Actions — a RESERVED, fixed-width slot, so the
                          column cannot shift when a row is a ghost or the
                          grant is view-only.

                          🚨 `always`. An earlier cut of this file let these
                          hide until hover, which is C1's "a disclosure that
                          hides a control": they were visible at rest before,
                          and Q17(b) authorises adding the FOCUS reveal to
                          controls that already hide — not hiding one that did
                          not. It also left an invisible Delete on a financial
                          record clickable at rest on any input that never
                          generates hover. The Projects list reasoned this out
                          correctly and this file did not. */}
                      <Td align="right">
                        <HoverActions always>
                          {!isGhost && !readOnly && (
                            <>
                              <IconButton
                                icon={Copy}
                                size="sm"
                                title={`Duplicate ${row.role_label || 'this rate'}`}
                                onClick={() => handleDuplicate(row)}
                              />
                              <IconButton
                                icon={Trash2}
                                size="sm"
                                title={`Delete ${row.role_label || 'this rate'}`}
                                onClick={() => handleDelete(row)}
                              />
                            </>
                          )}
                        </HoverActions>
                      </Td>
                    </Row>
                  )
                })}
              </Fragment>
            )
          })}

          {/* ── Draft row (general card only) ── */}
          {!isInternal && !readOnly && (
            <Row className="rc-row" data-draft>
              <Td>
                <EditCell
                  value={draft.role_label}
                  onCommit={v => {
                    patchDraft('role_label', v)
                    if (v?.trim()) setTimeout(commitDraft, 0)
                  }}
                  placeholder="Add a role…"
                />
              </Td>
              <Td>
                <DepartmentSelect value={draft.department} onChange={v => patchDraft('department', v)} />
              </Td>
              {/* Hourly on the draft row, same derivation as a live row. */}
              <Td numeric>
                <EditCell
                  value={draft.wage == null || draft.wage === '' ? null
                    : Math.round((Number(draft.wage) / HOURS_PER_DAY) * 100) / 100}
                  numeric
                  currency={draft.currency}
                  onCommit={v => patchDraft('wage', v == null || v === '' ? null
                    : Math.round(Number(v) * HOURS_PER_DAY * 100) / 100)}
                  placeholder="—"
                  align="right"
                  mono
                />
              </Td>
              <Td numeric>
                <EditCell
                  value={draft.wage}
                  numeric
                  currency={draft.currency}
                  onCommit={v => patchDraft('wage', v)}
                  placeholder="—"
                  align="right"
                  mono
                />
              </Td>
              <Td colSpan={2} align="center">
                <span className="rc-draft-note">Editable once the row is added</span>
              </Td>
              <Td numeric><span className="rc-total">—</span></Td>
              <Td align="center">
                <CurrencyCell value={draft.currency} onCommit={v => patchDraft('currency', v)} />
              </Td>
              <Td>
                <EditCell value={draft.region} onCommit={v => patchDraft('region', v)} placeholder="—" />
              </Td>
              <Td>
                <TierSelect value={draft.project_size} onChange={v => patchDraft('project_size', v)} />
              </Td>
              <Td align="right">
                <HoverActions always>
                  <IconButton
                    icon={Plus}
                    size="sm"
                    title="Add this row"
                    onClick={commitDraft}
                    disabled={!draft.role_label?.trim()}
                  />
                </HoverActions>
              </Td>
            </Row>
          )}

        </Table>
      </Card>

      {/* ── Empty state ──
          Out of the table, so it is a real empty state rather than an italic
          cell spanning eleven columns (F-R13). */}
      {displayRows.length === 0 && !loading && (
        <EmptyState
          Icon={AlertTriangle}
          title={isInternal ? 'No team members found' : 'No rates yet'}
          body={isInternal
            ? 'Add team members in the Team members page; they appear here automatically.'
            : 'Add one in the row at the bottom of the table, or import a file from the panel on the left.'}
        />
      )}
    </div>
  )
}
