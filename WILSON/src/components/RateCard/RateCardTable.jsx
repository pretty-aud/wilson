// ============================================================
// RateCardTable — editable rate card entries grid
// ============================================================
//
// Inline editing model:
//   - Click a cell to focus its input.
//   - Enter or blur commits via updateEntry().
//   - Escape reverts to the last saved value.
//   - The bottom row is always an empty draft. Filling its
//     role_label promotes it via addEntry() and a new empty
//     draft slides in below.
//
// Currency is a small inline dropdown reusing the CURRENCIES
// list from settings/CurrencyPicker.jsx so the table stays in
// lockstep with the workspace currency picker.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2, Copy, ChevronUp, ChevronDown, Plus } from 'lucide-react'
import { CURRENCIES } from '../settings/CurrencyPicker'

const NUMERIC_FIELDS = new Set(['day_rate', 'week_rate', 'month_rate'])

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
  // Strip currency symbols, thousand separators, spaces.
  const cleaned = String(input).replace(/[^\d.\-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

// ─── Inline editable cell ───
function EditableCell({ value, field, currency, onCommit, placeholder, align = 'left', monospace = false }) {
  const isNumeric = NUMERIC_FIELDS.has(field)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const display = isNumeric
    ? formatCurrency(value, currency) || <span className="text-stone-400">—</span>
    : (value || <span className="text-stone-400">{placeholder || '—'}</span>)

  function startEdit() {
    setDraft(value === null || value === undefined ? '' : String(value))
    setEditing(true)
  }

  function commit() {
    const next = isNumeric ? parseNumeric(draft) : draft.trim()
    setEditing(false)
    if (next !== value && !(next === null && (value === null || value === undefined))) {
      onCommit(next)
    }
  }

  function cancel() {
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
        className={`w-full px-2 py-1.5 text-xs rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${monospace ? 'font-mono' : ''}`}
        style={{
          backgroundColor: '#fff',
          color: '#1c1917',
          border: '1px solid #ea580c',
          textAlign: align,
        }}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      className={`w-full px-2 py-1.5 text-xs rounded-sm hover:bg-orange-50 transition-colors ${monospace ? 'font-mono' : ''}`}
      style={{ color: '#1c1917', textAlign: align, minHeight: '28px' }}
    >
      {display}
    </button>
  )
}

// ─── Inline currency dropdown ───
function CurrencyCell({ value, onCommit }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) { setFilter(''); return }
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
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
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-2 py-1.5 text-xs font-mono rounded-sm hover:bg-orange-50 transition-colors flex items-center justify-between"
        style={{ color: '#1c1917', minHeight: '28px' }}
      >
        <span>
          <span className="text-orange-700 mr-1">{current.symbol}</span>
          {current.code}
        </span>
        <span className="text-stone-400 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 w-48 max-h-64 overflow-auto rounded-sm shadow-xl"
          style={{ backgroundColor: '#fff', border: '2px solid #ea580c' }}
        >
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search…"
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
              <span className="w-6 text-orange-700">{c.symbol}</span>
              <span className="w-10">{c.code}</span>
              <span className="text-stone-500 truncate">{c.label}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-stone-500 font-mono">No matches.</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Row actions menu ───
function RowActions({ onDuplicate, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={onMoveUp}
        disabled={!canMoveUp}
        title="Move up"
        className="p-1 rounded-sm hover:bg-orange-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        style={{ color: '#7c2d12' }}
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={!canMoveDown}
        title="Move down"
        className="p-1 rounded-sm hover:bg-orange-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        style={{ color: '#7c2d12' }}
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={onDuplicate}
        title="Duplicate row"
        className="p-1 rounded-sm hover:bg-orange-100 transition-colors"
        style={{ color: '#7c2d12' }}
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Delete row"
        className="p-1 rounded-sm hover:bg-red-100 transition-colors"
        style={{ color: '#991b1b' }}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ─── Main table ───
export default function RateCardTable({
  entries,
  loading,
  addEntry,
  updateEntry,
  deleteEntry,
  makeSlug,
}) {
  // Local state for the always-empty draft row at the bottom.
  const emptyDraft = useMemo(() => ({
    role_label: '',
    role_slug: '',
    currency: 'USD',
    day_rate: null,
    week_rate: null,
    month_rate: null,
    region: '',
    project_size: '',
  }), [])
  const [draft, setDraft] = useState(emptyDraft)

  function patchDraft(field, value) {
    setDraft(prev => {
      const next = { ...prev, [field]: value }
      // Auto-derive slug from label whenever the user hasn't typed
      // a slug of their own.
      if (field === 'role_label') {
        next.role_slug = makeSlug(value)
      }
      return next
    })
  }

  async function commitDraftIfReady() {
    if (!draft.role_label || !draft.role_label.trim()) return
    const toCreate = { ...draft }
    setDraft(emptyDraft)
    try {
      await addEntry(toCreate)
    } catch {
      // hook surfaces the error in its own state; reset is fine
    }
  }

  async function handleDuplicate(entry) {
    const copy = { ...entry }
    delete copy.id
    copy.role_label = `${entry.role_label} (copy)`
    copy.role_slug = makeSlug(copy.role_label)
    try { await addEntry(copy) } catch { /* surfaced via hook */ }
  }

  // Move up/down is local-only reorder; we don't persist order
  // because the schema has no `position` column. The visual order
  // reverts on reload, which is acceptable for v0.1.
  // (Reorder logic intentionally omitted — handlers no-op for now.)
  // We still expose disabled chevrons so the affordance is present
  // and v0.2 can light them up by adding a position column.
  const noOp = () => {}

  // Header style
  const th = {
    backgroundColor: '#f4a261',
    color: '#1c1917',
    borderBottom: '2px solid #7c2d12',
    fontFamily: 'monospace',
    fontSize: '10px',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    padding: '8px',
    textAlign: 'left',
  }

  const td = {
    borderBottom: '1px solid #fed7aa',
    padding: '2px 4px',
    verticalAlign: 'middle',
  }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto" style={{ backgroundColor: '#fef3e8' }}>
        <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead className="sticky top-0 z-10">
            <tr>
              <th style={{ ...th, width: '18%' }}>Role label</th>
              <th style={{ ...th, width: '14%' }}>Slug</th>
              <th style={{ ...th, width: '10%' }}>Currency</th>
              <th style={{ ...th, width: '10%', textAlign: 'right' }}>Day</th>
              <th style={{ ...th, width: '10%', textAlign: 'right' }}>Week</th>
              <th style={{ ...th, width: '10%', textAlign: 'right' }}>Month</th>
              <th style={{ ...th, width: '11%' }}>Region</th>
              <th style={{ ...th, width: '11%' }}>Size</th>
              <th style={{ ...th, width: '6%', textAlign: 'right' }}>⋯</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, idx) => (
              <tr key={entry.id} className="hover:bg-orange-50 transition-colors">
                <td style={td}>
                  <EditableCell
                    value={entry.role_label}
                    field="role_label"
                    onCommit={(val) => updateEntry(entry.id, {
                      role_label: val,
                      role_slug: entry.role_slug || makeSlug(val),
                    })}
                    placeholder="Role…"
                  />
                </td>
                <td style={td}>
                  <EditableCell
                    value={entry.role_slug}
                    field="role_slug"
                    onCommit={(val) => updateEntry(entry.id, { role_slug: makeSlug(val) })}
                    monospace
                  />
                </td>
                <td style={td}>
                  <CurrencyCell
                    value={entry.currency}
                    onCommit={(val) => updateEntry(entry.id, { currency: val })}
                  />
                </td>
                <td style={td}>
                  <EditableCell
                    value={entry.day_rate}
                    field="day_rate"
                    currency={entry.currency}
                    onCommit={(val) => updateEntry(entry.id, { day_rate: val })}
                    align="right"
                    monospace
                  />
                </td>
                <td style={td}>
                  <EditableCell
                    value={entry.week_rate}
                    field="week_rate"
                    currency={entry.currency}
                    onCommit={(val) => updateEntry(entry.id, { week_rate: val })}
                    align="right"
                    monospace
                  />
                </td>
                <td style={td}>
                  <EditableCell
                    value={entry.month_rate}
                    field="month_rate"
                    currency={entry.currency}
                    onCommit={(val) => updateEntry(entry.id, { month_rate: val })}
                    align="right"
                    monospace
                  />
                </td>
                <td style={td}>
                  <EditableCell
                    value={entry.region}
                    field="region"
                    onCommit={(val) => updateEntry(entry.id, { region: val || null })}
                    placeholder="—"
                  />
                </td>
                <td style={td}>
                  <EditableCell
                    value={entry.project_size}
                    field="project_size"
                    onCommit={(val) => updateEntry(entry.id, { project_size: val || null })}
                    placeholder="—"
                  />
                </td>
                <td style={{ ...td, paddingRight: 8 }}>
                  <RowActions
                    onDuplicate={() => handleDuplicate(entry)}
                    onDelete={() => deleteEntry(entry.id)}
                    onMoveUp={noOp}
                    onMoveDown={noOp}
                    canMoveUp={false}
                    canMoveDown={false}
                  />
                </td>
              </tr>
            ))}

            {/* Always-present draft row */}
            <tr style={{ backgroundColor: '#fff7ed' }}>
              <td style={td}>
                <EditableCell
                  value={draft.role_label}
                  field="role_label"
                  onCommit={(val) => {
                    patchDraft('role_label', val)
                    if (val && val.trim()) {
                      // Defer commit so the slug update lands first.
                      setTimeout(commitDraftIfReady, 0)
                    }
                  }}
                  placeholder="+ Add role…"
                />
              </td>
              <td style={td}>
                <EditableCell
                  value={draft.role_slug}
                  field="role_slug"
                  onCommit={(val) => patchDraft('role_slug', makeSlug(val))}
                  monospace
                />
              </td>
              <td style={td}>
                <CurrencyCell
                  value={draft.currency}
                  onCommit={(val) => patchDraft('currency', val)}
                />
              </td>
              <td style={td}>
                <EditableCell
                  value={draft.day_rate}
                  field="day_rate"
                  currency={draft.currency}
                  onCommit={(val) => patchDraft('day_rate', val)}
                  align="right"
                  monospace
                />
              </td>
              <td style={td}>
                <EditableCell
                  value={draft.week_rate}
                  field="week_rate"
                  currency={draft.currency}
                  onCommit={(val) => patchDraft('week_rate', val)}
                  align="right"
                  monospace
                />
              </td>
              <td style={td}>
                <EditableCell
                  value={draft.month_rate}
                  field="month_rate"
                  currency={draft.currency}
                  onCommit={(val) => patchDraft('month_rate', val)}
                  align="right"
                  monospace
                />
              </td>
              <td style={td}>
                <EditableCell
                  value={draft.region}
                  field="region"
                  onCommit={(val) => patchDraft('region', val)}
                  placeholder="—"
                />
              </td>
              <td style={td}>
                <EditableCell
                  value={draft.project_size}
                  field="project_size"
                  onCommit={(val) => patchDraft('project_size', val)}
                  placeholder="—"
                />
              </td>
              <td style={{ ...td, paddingRight: 8 }}>
                <button
                  type="button"
                  onClick={commitDraftIfReady}
                  disabled={!draft.role_label || !draft.role_label.trim()}
                  title="Add row"
                  className="p-1 rounded-sm hover:bg-orange-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                  style={{ color: '#7c2d12' }}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>

            {entries.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="text-center text-xs text-stone-500 font-mono py-6">
                  No rate card entries yet — add one above or import from a file.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
