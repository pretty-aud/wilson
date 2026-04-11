// ============================================================
// RateCardTable — editable rate card entries grid
// ============================================================
//
// Columns: Role · Dept · Wage · Burden · Overhead · Total · Curr · Region · Tier · Actions
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

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Trash2, Copy, Plus, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { CURRENCIES } from '../settings/CurrencyPicker'
import { DEFAULT_DEPARTMENTS } from '../TeamMembers/useTeamMembers'
import { computeEntryTotal, BUDGET_TIERS } from './useRateCard'

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
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
        }}
        className={`w-full px-2 py-1.5 text-xs rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${mono ? 'font-mono' : ''}`}
        style={{ backgroundColor: '#fff', color: '#1c1917', border: '1px solid #ea580c', textAlign: align }}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={start}
      className={`w-full px-2 py-1.5 text-xs rounded-sm transition-colors ${readOnly ? 'cursor-default' : 'hover:bg-orange-50'} ${mono ? 'font-mono' : ''}`}
      style={{ color: readOnly ? '#78716c' : '#1c1917', textAlign: align, minHeight: '28px' }}
    >
      {display || <span style={{ color: '#7c2d12', opacity: 0.4 }}>{placeholder || '—'}</span>}
    </button>
  )
}

// ─── Burden / Overhead cell ───
// Shows value + type toggle (% / $) + computed amount.
// When null and dept default exists, shows the default indicator.
function RateCompCell({ value, type, computedAmount, onCommitValue, onToggleType, currency, deptPct }) {
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

  if (editing) {
    return (
      <div className="flex items-center gap-1">
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
          className="flex-1 w-0 px-2 py-1 text-xs font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
          style={{ backgroundColor: '#fff', color: '#1c1917', border: '1px solid #ea580c', textAlign: 'right' }}
        />
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onToggleType() }}
          className="px-1.5 py-1 text-[10px] font-bold font-mono rounded-sm hover:bg-orange-100 flex-shrink-0"
          style={{ color: '#7c2d12', border: '1px solid #d6d3d1' }}
        >
          {isPercent ? '%' : '$'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end min-h-[28px] justify-center">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={start}
          className="px-2 py-0.5 text-xs font-mono rounded-sm hover:bg-orange-50 transition-colors text-right"
          style={{ color: hasValue ? '#1c1917' : '#78716c' }}
        >
          {hasValue
            ? (isPercent ? `${value}%` : formatCurrency(value, currency))
            : (usingDeptDefault
              ? <span style={{ fontSize: '10px' }}>dept {deptPct}%</span>
              : '—'
            )
          }
        </button>
        <button
          type="button"
          onClick={onToggleType}
          className="px-1 py-0.5 text-[9px] font-bold font-mono rounded-sm hover:bg-orange-100 flex-shrink-0"
          style={{ color: '#7c2d12', opacity: 0.45, lineHeight: 1 }}
          title={`Switch to ${isPercent ? 'fixed $' : 'percent'}`}
        >
          {isPercent ? '%' : '$'}
        </button>
      </div>
      {computedAmount > 0 && (
        <span className="text-[9px] font-mono pr-5" style={{ color: '#78716c' }}>
          = {formatCurrency(computedAmount, currency)}
        </span>
      )}
    </div>
  )
}

// ─── Inline currency dropdown ───
function CurrencyCell({ value, onCommit }) {
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
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-1 py-1.5 text-[10px] font-mono rounded-sm hover:bg-orange-50 transition-colors flex items-center justify-center gap-0.5"
        style={{ color: '#1c1917', minHeight: '28px' }}
      >
        <span style={{ color: '#7c2d12' }}>{current.symbol}</span>
        <span>{current.code}</span>
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 right-0 w-48 max-h-64 overflow-auto rounded-sm shadow-xl"
          style={{ backgroundColor: '#fff', border: '2px solid #ea580c' }}
        >
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search..."
            className="w-full px-3 py-2 text-xs font-mono focus:outline-none"
            style={{ borderBottom: '1px solid #f4a261', color: '#1c1917' }}
            autoFocus
          />
          {filtered.map(c => (
            <button
              key={c.code}
              type="button"
              onClick={() => { onCommit(c.code); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono hover:bg-orange-50 transition-colors"
              style={{ color: c.code === current.code ? '#ea580c' : '#1c1917' }}
            >
              <span className="w-6" style={{ color: '#7c2d12' }}>{c.symbol}</span>
              <span className="w-10">{c.code}</span>
              <span className="truncate" style={{ color: '#7c2d12', opacity: 0.7 }}>{c.label}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs font-mono" style={{ color: '#7c2d12', opacity: 0.7 }}>No matches.</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Department select ───
function DepartmentSelect({ value, onChange, readOnly = false }) {
  if (readOnly) {
    return (
      <span className="block px-2 py-1.5 text-xs truncate" style={{ color: '#78716c' }}>
        {value || '—'}
      </span>
    )
  }
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value || null)}
      className="w-full px-1 py-1.5 text-xs rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500 hover:bg-orange-50 cursor-pointer"
      style={{ backgroundColor: 'transparent', color: '#1c1917', border: 'none' }}
    >
      <option value="">—</option>
      {DEFAULT_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
    </select>
  )
}

// ─── Budget tier select ───
function TierSelect({ value, onChange }) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value || null)}
      className="w-full px-1 py-1.5 text-[10px] rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500 hover:bg-orange-50 cursor-pointer"
      style={{ backgroundColor: 'transparent', color: '#1c1917', border: 'none' }}
    >
      <option value="">—</option>
      {BUDGET_TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
    </select>
  )
}

// ─── Department default inline editor ───
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
    const num = parseNumeric(draft)
    onChange(num)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-mono whitespace-nowrap" style={{ color: '#7c2d12' }}>{label}:</span>
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
          className="w-14 px-1 py-0.5 text-[10px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
          style={{ backgroundColor: '#fff', color: '#1c1917', border: '1px solid #ea580c', textAlign: 'right' }}
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={start}
      className="flex items-center gap-1 hover:bg-amber-200/40 rounded-sm px-1.5 py-0.5 transition-colors"
    >
      <span className="text-[10px] font-mono whitespace-nowrap" style={{ color: '#7c2d12' }}>{label}:</span>
      <span className="text-[10px] font-mono font-bold" style={{ color: '#1c1917' }}>
        {value != null ? `${value}%` : '—'}
      </span>
    </button>
  )
}

// ─── Row actions ───
function RowActions({ onDuplicate, onDelete }) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <button
        type="button"
        onClick={onDuplicate}
        title="Duplicate row"
        className="p-1 rounded-sm hover:bg-orange-100 transition-colors"
        style={{ color: '#7c2d12' }}
      >
        <Copy className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Delete row"
        className="p-1 rounded-sm hover:bg-red-100 transition-colors"
        style={{ color: '#991b1b' }}
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  )
}

// ─── Column widths ───
const COL = {
  name: '19%', dept: '10%', wage: '11%', burden: '13%', overhead: '13%',
  total: '10%', curr: '6%', region: '6%', tier: '7%', actions: '5%',
}

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
    if (!draft.role_label?.trim()) return
    const toCreate = { ...draft }
    setDraft(emptyDraft)
    try { await addEntry(toCreate) } catch { /* surfaced via hook */ }
  }

  // ── Handlers ──
  async function handleUpdate(row, patch) {
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
    if (row._hasEntry === false) return
    const copy = { ...row }
    delete copy.id; delete copy._member; delete copy._hasEntry
    copy.role_label = `${row.role_label || ''} (copy)`
    copy.role_slug = makeSlug(copy.role_label)
    try { await addEntry(copy) } catch { /* surfaced via hook */ }
  }

  async function handleDelete(row) {
    if (row._hasEntry === false) return
    try { await deleteEntry(row.id) } catch { /* surfaced via hook */ }
  }

  function getDeptDefault(dept) {
    return deptDefaults.find(d => d.department === dept) || {}
  }

  // ── Styles ──
  const th = {
    backgroundColor: '#f4a261',
    color: '#1c1917',
    borderBottom: '2px solid #7c2d12',
    fontFamily: 'monospace',
    fontSize: '10px',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    padding: '6px 4px',
    textAlign: 'left',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  }

  const td = {
    borderBottom: '1px solid #fed7aa',
    padding: '1px 2px',
    verticalAlign: 'middle',
  }

  // ── Show dept defaults panel? Only when updateDeptDefault is available ──
  const [defaultsOpen, setDefaultsOpen] = useState(false)

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* ── Department defaults panel ── */}
      {updateDeptDefault && (
        <div style={{ backgroundColor: '#fff7ed', borderBottom: '2px solid #d97706', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setDefaultsOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-2 hover:bg-orange-50 transition-colors"
          >
            {defaultsOpen
              ? <ChevronDown className="w-3.5 h-3.5" style={{ color: '#7c2d12' }} />
              : <ChevronRight className="w-3.5 h-3.5" style={{ color: '#7c2d12' }} />}
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest" style={{ color: '#7c2d12' }}>
              Department defaults — Burden % &amp; Overhead %
            </span>
          </button>
          {defaultsOpen && (
            <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {DEFAULT_DEPARTMENTS.map(dept => {
                const dd = deptDefaults.find(d => d.department === dept) || {}
                return (
                  <div
                    key={dept}
                    className="flex flex-col gap-1 p-2 rounded-sm"
                    style={{ backgroundColor: '#fef3e8', border: '1px solid #f4a261' }}
                  >
                    <span className="text-[9px] font-mono font-bold uppercase tracking-wider truncate" style={{ color: '#7c2d12' }}>
                      {dept}
                    </span>
                    <div className="flex items-center gap-2">
                      <DeptDefaultInput
                        label="B"
                        value={dd.burden_pct}
                        onChange={v => updateDeptDefault(dept, { burden_pct: v })}
                      />
                      <DeptDefaultInput
                        label="O"
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

      <div className="flex-1 overflow-auto" style={{ backgroundColor: '#fef3e8' }}>
        <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: COL.name }}>{isInternal ? 'Member' : 'Role'}</th>
              <th style={{ ...th, width: COL.dept }}>Dept</th>
              <th style={{ ...th, width: COL.wage, textAlign: 'right' }}>Wage</th>
              <th style={{ ...th, width: COL.burden, textAlign: 'right' }}>Burden</th>
              <th style={{ ...th, width: COL.overhead, textAlign: 'right' }}>Overhead</th>
              <th style={{ ...th, width: COL.total, textAlign: 'right' }}>Total</th>
              <th style={{ ...th, width: COL.curr, textAlign: 'center' }}>Curr</th>
              <th style={{ ...th, width: COL.region }}>Region</th>
              <th style={{ ...th, width: COL.tier }}>Tier</th>
              <th style={{ ...th, width: COL.actions, textAlign: 'right' }}>&#x22EF;</th>
            </tr>
          </thead>

          <tbody>
            {grouped.map(([dept, rows]) => {
              const isOpen = !collapsed.has(dept)
              const dd = getDeptDefault(dept)

              return (
                <Fragment key={dept}>
                  {/* ── Department group header ── */}
                  <tr>
                    <td colSpan={10} style={{ padding: 0, borderBottom: '2px solid #d97706' }}>
                      <div
                        className="flex items-center gap-3 px-3 py-1.5"
                        style={{ backgroundColor: '#fde68a' }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleDept(dept)}
                          className="flex items-center gap-1.5 hover:opacity-80"
                        >
                          {isOpen
                            ? <ChevronDown className="w-3.5 h-3.5" style={{ color: '#7c2d12' }} />
                            : <ChevronRight className="w-3.5 h-3.5" style={{ color: '#7c2d12' }} />}
                          <span
                            className="text-xs font-mono font-bold uppercase tracking-wider"
                            style={{ color: '#7c2d12' }}
                          >
                            {dept}
                          </span>
                          <span className="text-[10px] font-mono" style={{ color: '#92400e' }}>
                            ({rows.length})
                          </span>
                        </button>

                        {dept !== 'Other' && updateDeptDefault && (
                          <div className="ml-auto flex items-center gap-4">
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
                      <tr
                        key={row.id}
                        className="hover:bg-orange-50 transition-colors"
                        style={isGhost ? { backgroundColor: '#fff7ed' } : undefined}
                      >
                        {/* Role / Member name */}
                        <td style={td}>
                          {isInternal && row._member ? (
                            <div className="flex items-center gap-1.5 px-2 py-1.5">
                              <span className="text-xs truncate" style={{ color: '#1c1917' }}>
                                {row._member.name}
                              </span>
                              {row._member.title && (
                                <span className="text-[10px] truncate" style={{ color: '#78716c' }}>
                                  {row._member.title}
                                </span>
                              )}
                              {isGhost && (
                                <AlertTriangle
                                  className="w-3 h-3 flex-shrink-0"
                                  style={{ color: '#d97706' }}
                                  title="No rate set"
                                />
                              )}
                            </div>
                          ) : (
                            <EditCell
                              value={row.role_label}
                              onCommit={v => handleUpdate(row, { role_label: v, role_slug: makeSlug(v) })}
                              placeholder={isInternal ? 'Title...' : 'Role...'}
                            />
                          )}
                        </td>

                        {/* Department */}
                        <td style={td}>
                          <DepartmentSelect
                            value={row.department}
                            onChange={v => handleUpdate(row, { department: v })}
                            readOnly={isInternal && !!row._member}
                          />
                        </td>

                        {/* Wage */}
                        <td style={td}>
                          <EditCell
                            value={row.wage}
                            numeric
                            currency={row.currency}
                            onCommit={v => handleUpdate(row, { wage: v })}
                            placeholder="—"
                            align="right"
                            mono
                          />
                        </td>

                        {/* Burden */}
                        <td style={td}>
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
                          />
                        </td>

                        {/* Overhead */}
                        <td style={td}>
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
                          />
                        </td>

                        {/* Total (computed, read-only) */}
                        <td style={td}>
                          <span
                            className="block px-2 py-1.5 text-xs font-mono text-right font-bold"
                            style={{
                              color: computed.total > 0 ? '#166534' : '#78716c',
                              opacity: computed.total > 0 ? 1 : 0.4,
                            }}
                          >
                            {computed.total > 0 ? formatCurrency(computed.total, row.currency) : '—'}
                          </span>
                        </td>

                        {/* Currency */}
                        <td style={td}>
                          <CurrencyCell
                            value={row.currency}
                            onCommit={v => handleUpdate(row, { currency: v })}
                          />
                        </td>

                        {/* Region */}
                        <td style={td}>
                          <EditCell
                            value={row.region}
                            onCommit={v => handleUpdate(row, { region: v || null })}
                            placeholder="—"
                          />
                        </td>

                        {/* Tier */}
                        <td style={td}>
                          <TierSelect
                            value={row.project_size}
                            onChange={v => handleUpdate(row, { project_size: v })}
                          />
                        </td>

                        {/* Actions */}
                        <td style={{ ...td, paddingRight: 6 }}>
                          {!isGhost ? (
                            <RowActions
                              onDuplicate={() => handleDuplicate(row)}
                              onDelete={() => handleDelete(row)}
                            />
                          ) : <span />}
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}

            {/* ── Draft row (general card only) ── */}
            {!isInternal && (
              <tr style={{ backgroundColor: '#fff7ed' }}>
                <td style={td}>
                  <EditCell
                    value={draft.role_label}
                    onCommit={v => {
                      patchDraft('role_label', v)
                      if (v?.trim()) setTimeout(commitDraft, 0)
                    }}
                    placeholder="+ Add role..."
                  />
                </td>
                <td style={td}>
                  <DepartmentSelect value={draft.department} onChange={v => patchDraft('department', v)} />
                </td>
                <td style={td}>
                  <EditCell
                    value={draft.wage}
                    numeric
                    currency={draft.currency}
                    onCommit={v => patchDraft('wage', v)}
                    placeholder="—"
                    align="right"
                    mono
                  />
                </td>
                <td style={td} colSpan={2}>
                  <span className="block px-2 py-1.5 text-[10px] font-mono text-center" style={{ color: '#78716c' }}>
                    editable after adding
                  </span>
                </td>
                <td style={td}>
                  <span className="block px-2 py-1.5 text-xs font-mono text-right" style={{ color: '#78716c', opacity: 0.4 }}>
                    —
                  </span>
                </td>
                <td style={td}>
                  <CurrencyCell value={draft.currency} onCommit={v => patchDraft('currency', v)} />
                </td>
                <td style={td}>
                  <EditCell value={draft.region} onCommit={v => patchDraft('region', v)} placeholder="—" />
                </td>
                <td style={td}>
                  <TierSelect value={draft.project_size} onChange={v => patchDraft('project_size', v)} />
                </td>
                <td style={{ ...td, paddingRight: 6 }}>
                  <button
                    type="button"
                    onClick={commitDraft}
                    disabled={!draft.role_label?.trim()}
                    title="Add row"
                    className="p-1 rounded-sm hover:bg-orange-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    style={{ color: '#7c2d12' }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            )}

            {/* ── Empty state ── */}
            {displayRows.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="text-center text-xs font-mono py-8" style={{ color: '#7c2d12', opacity: 0.7 }}>
                  {isInternal
                    ? 'No team members found — add team members in the Team Members page.'
                    : 'No rate card entries yet — add one above or import from a file.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
