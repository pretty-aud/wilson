// ============================================================
// RABBIT — ProjectAssetsView
// ============================================================
//
// Tabbed table/gallery of every asset in the active project. The
// table mode (this commit) lets the user inline-edit name, type,
// phase, and status, and surfaces the asset-status-warning flag
// when the user-facing status disagrees with the derived task
// roll-up.
//
// Layout:
//
//   ┌──────────────────────────────────────────┐
//   │ [+ Add asset]  Filter ▾  Search …  TBL│GAL│   ← toolbar
//   ├──────────────────────────────────────────┤
//   │ Name | Type | Phase | Status | Tasks | ⋯ │   ← header
//   │ ...                                       │
//   └──────────────────────────────────────────┘
//
// Commit 11 fills in the gallery view, Commit 12 wires the
// asset-status warning modal.

import { useMemo, useState } from 'react'
import {
  Boxes, Plus, Search, Filter, Trash2, AlertTriangle,
  Table as TableIcon, LayoutGrid, X,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import AssetStatusWarningModal from '../components/AssetStatusWarningModal'

export const ASSET_TYPES = [
  'character','environment','prop','vehicle','vfx','animation','rig','model',
  'texture','audio','vo','music','cinematic','ui','level','script','treatment',
  'concept','storyboard','illustration','document','deliverable','other',
]

export const ASSET_STATUSES = [
  'not_started','in_progress','pending_review','revisions',
  'approved','final','blocked','on_hold','omitted',
]

export default function ProjectAssetsView() {
  const ctx = useRabbit()
  const assets  = ctx?.assets  || []
  const phases  = ctx?.phases  || []
  const tasks   = ctx?.tasks   || []
  const project = ctx?.project

  const [viewMode, setViewMode] = useState('table')   // table | gallery
  const [search, setSearch]     = useState('')
  const [phaseFilter, setPhaseFilter] = useState('')  // '' = all
  const [typeFilter, setTypeFilter]   = useState('')
  const [warningAssetId, setWarningAssetId] = useState(null)

  const phaseById = useMemo(() => {
    const map = {}
    for (const p of phases) map[p.id] = p
    return map
  }, [phases])

  const taskCountByAsset = useMemo(() => {
    const map = {}
    for (const t of tasks) {
      if (!t.asset_id) continue
      map[t.asset_id] = (map[t.asset_id] || 0) + 1
    }
    return map
  }, [tasks])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return assets
      .filter(a => !phaseFilter || a.phase_id === phaseFilter)
      .filter(a => !typeFilter || a.type === typeFilter)
      .filter(a => !s || (a.name || '').toLowerCase().includes(s))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }, [assets, search, phaseFilter, typeFilter])

  async function handleAddAsset() {
    if (!ctx?.addAsset) return
    await ctx.addAsset({
      name: 'New asset',
      type: 'other',
      status: 'not_started',
    })
  }

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#7c2d12' }}>
          No project loaded
        </span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#fef3e8' }}>
      {/* ── Toolbar ── */}
      <div
        className="flex items-center gap-2 px-6 py-3 flex-wrap"
        style={{ borderBottom: '1px solid #f4a261', backgroundColor: '#fff7ed' }}
      >
        <button
          type="button"
          onClick={handleAddAsset}
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm"
          style={{
            color: '#fff7ed',
            backgroundColor: '#ea580c',
            border: '2px solid #7c2d12',
          }}
        >
          <Plus className="w-3 h-3" /> Add asset
        </button>

        <div className="flex items-center gap-1">
          <Filter className="w-3 h-3" style={{ color: '#7c2d12' }} />
          <select
            value={phaseFilter}
            onChange={(e) => setPhaseFilter(e.target.value)}
            className="px-2 py-1 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-700"
            style={{ backgroundColor: '#fff', color: '#1c1917', border: '1px solid #7c2d12' }}
          >
            <option value="">All phases</option>
            {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-2 py-1 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-700"
            style={{ backgroundColor: '#fff', color: '#1c1917', border: '1px solid #7c2d12' }}
          >
            <option value="">All types</option>
            {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-1 flex-1 max-w-xs">
          <Search className="w-3 h-3" style={{ color: '#7c2d12' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assets…"
            className="flex-1 px-2 py-1 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-700"
            style={{ backgroundColor: '#fff', color: '#1c1917', border: '1px solid #7c2d12' }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="p-0.5"
              style={{ color: '#7c2d12' }}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: '#7c2d12' }}>
            {filtered.length} / {assets.length}
          </span>
          <ViewModeButton
            active={viewMode === 'table'}
            onClick={() => setViewMode('table')}
            icon={TableIcon}
            label="Table"
          />
          <ViewModeButton
            active={viewMode === 'gallery'}
            onClick={() => setViewMode('gallery')}
            icon={LayoutGrid}
            label="Gallery"
          />
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'table' ? (
          <AssetTable
            assets={filtered}
            phases={phases}
            phaseById={phaseById}
            taskCountByAsset={taskCountByAsset}
            ctx={ctx}
            onWarningClick={(id) => setWarningAssetId(id)}
          />
        ) : (
          <AssetGallery
            assets={filtered}
            phaseById={phaseById}
            taskCountByAsset={taskCountByAsset}
            ctx={ctx}
            onWarningClick={(id) => setWarningAssetId(id)}
          />
        )}
      </div>

      {warningAssetId && (
        <AssetStatusWarningModal
          asset={assets.find(a => a.id === warningAssetId)}
          onClose={() => setWarningAssetId(null)}
        />
      )}
    </div>
  )
}

// ─── Table mode ───
function AssetTable({ assets, phases, phaseById, taskCountByAsset, ctx, onWarningClick }) {
  if (assets.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <Boxes className="w-8 h-8" style={{ color: '#7c2d12' }} />
        <span className="text-[11px] font-mono italic" style={{ color: '#7c2d12' }}>
          No assets — click “Add asset” or run the intake wizard.
        </span>
      </div>
    )
  }
  return (
    <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
      <thead className="sticky top-0 z-10">
        <tr style={{ backgroundColor: '#f4a261', borderBottom: '2px solid #7c2d12' }}>
          <Th>Name</Th>
          <Th>Type</Th>
          <Th>Phase</Th>
          <Th>Status</Th>
          <Th>Tasks</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {assets.map(a => (
          <AssetRow
            key={a.id}
            asset={a}
            phases={phases}
            phaseLabel={phaseById[a.phase_id]?.name || ''}
            taskCount={taskCountByAsset[a.id] || 0}
            warning={ctx?.selectAssetStatusWarning?.(a)}
            onUpdate={(patch) => ctx.updateAsset(a.id, patch)}
            onDelete={() => ctx.deleteAsset(a.id)}
            onWarningClick={() => onWarningClick?.(a.id)}
          />
        ))}
      </tbody>
    </table>
  )
}

function AssetRow({ asset, phases, phaseLabel, taskCount, warning, onUpdate, onDelete, onWarningClick }) {
  return (
    <tr style={{ borderBottom: '1px solid #fed7aa', backgroundColor: '#fff7ed' }}>
      <Td>
        <InlineText
          value={asset.name || ''}
          onCommit={(name) => onUpdate({ name })}
          placeholder="Untitled"
        />
      </Td>
      <Td>
        <InlineSelect
          value={asset.type || 'other'}
          options={ASSET_TYPES}
          onCommit={(type) => onUpdate({ type })}
        />
      </Td>
      <Td>
        <InlineSelect
          value={asset.phase_id || ''}
          options={[
            { value: '', label: '—' },
            ...phases.map(p => ({ value: p.id, label: p.name })),
          ]}
          onCommit={(phase_id) => onUpdate({ phase_id: phase_id || null })}
        />
        {!asset.phase_id && phaseLabel === '' && null}
      </Td>
      <Td>
        <div className="flex items-center gap-1">
          <InlineSelect
            value={asset.status || 'not_started'}
            options={ASSET_STATUSES}
            onCommit={(status) => onUpdate({ status })}
            tone={statusTone(asset.status)}
          />
          {warning && (
            <button
              type="button"
              onClick={onWarningClick}
              title="Tasks not yet done — click for details"
              className="p-0.5 rounded-sm hover:bg-red-100"
            >
              <AlertTriangle className="w-3.5 h-3.5" style={{ color: '#991b1b' }} />
            </button>
          )}
        </div>
      </Td>
      <Td>
        <span className="text-[11px] font-mono" style={{ color: '#7c2d12' }}>
          {taskCount}
        </span>
      </Td>
      <Td>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Delete asset "${asset.name}"? This cannot be undone.`)) {
              onDelete()
            }
          }}
          className="p-1 rounded-sm hover:bg-red-100"
          title="Delete asset"
          style={{ color: '#991b1b' }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </Td>
    </tr>
  )
}

// ─── Gallery mode ───
//
// Card grid showing thumbnail (or generated initials block),
// name, type, status, phase, and a small "tasks" footer. Click
// a card to inline-edit name, type, status, phase. Cards are a
// little chunkier than table rows so the user can scan a moodboard
// of an entire project at a glance.
function AssetGallery({ assets, phaseById, taskCountByAsset, ctx, onWarningClick }) {
  if (assets.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <Boxes className="w-8 h-8" style={{ color: '#7c2d12' }} />
        <span className="text-[11px] font-mono italic" style={{ color: '#7c2d12' }}>
          No assets — click “Add asset” or run the intake wizard.
        </span>
      </div>
    )
  }
  return (
    <div className="p-6 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {assets.map(a => (
        <AssetCard
          key={a.id}
          asset={a}
          phaseLabel={phaseById[a.phase_id]?.name || ''}
          taskCount={taskCountByAsset[a.id] || 0}
          warning={ctx?.selectAssetStatusWarning?.(a)}
          onUpdate={(patch) => ctx.updateAsset(a.id, patch)}
          onDelete={() => ctx.deleteAsset(a.id)}
          onWarningClick={() => onWarningClick?.(a.id)}
        />
      ))}
    </div>
  )
}

function AssetCard({ asset, phaseLabel, taskCount, warning, onUpdate, onDelete, onWarningClick }) {
  const tone = statusTone(asset.status)
  const colors = toneColors(tone)
  const initials = (asset.name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('')
  return (
    <div
      className="rounded-sm overflow-hidden flex flex-col"
      style={{ backgroundColor: '#fff7ed', border: '2px solid #7c2d12' }}
    >
      {/* Thumbnail / initials block */}
      <div
        className="h-24 flex items-center justify-center relative"
        style={{
          backgroundColor: '#fed7aa',
          borderBottom: '2px solid #7c2d12',
          ...(asset.thumbnail_url ? {
            backgroundImage: `url(${JSON.stringify(asset.thumbnail_url)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : {}),
        }}
      >
        {!asset.thumbnail_url && (
          <span
            className="text-2xl font-mono font-bold"
            style={{ color: '#7c2d12' }}
          >
            {initials}
          </span>
        )}
        {warning && (
          <button
            type="button"
            onClick={onWarningClick}
            className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-sm hover:bg-red-200"
            style={{ backgroundColor: '#fee2e2', border: '1px solid #991b1b', color: '#991b1b' }}
            title="Status mismatch — click for details"
          >
            <AlertTriangle className="w-3 h-3" />
          </button>
        )}
        <div
          className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm"
          style={{
            color: colors.fg,
            backgroundColor: colors.bg,
            border: `1px solid ${colors.border}`,
          }}
        >
          {asset.status || 'not_started'}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col gap-1 p-2">
        <InlineText
          value={asset.name || ''}
          onCommit={(name) => onUpdate({ name })}
          placeholder="Untitled"
        />
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider" style={{ color: '#7c2d12' }}>
          <span>{asset.type || 'other'}</span>
          {phaseLabel && <span className="truncate max-w-[100px]">· {phaseLabel}</span>}
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-2 py-1"
        style={{ borderTop: '1px solid #fed7aa', backgroundColor: '#fef3e8' }}
      >
        <span className="text-[10px] font-mono" style={{ color: '#7c2d12' }}>
          {taskCount} task{taskCount === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Delete asset "${asset.name}"? This cannot be undone.`)) {
              onDelete()
            }
          }}
          className="p-0.5 rounded-sm hover:bg-red-100"
          title="Delete asset"
          style={{ color: '#991b1b' }}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

// ─── Toolbar atoms ───
function ViewModeButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm"
      style={{
        color: active ? '#fff7ed' : '#7c2d12',
        backgroundColor: active ? '#ea580c' : 'transparent',
        border: '1px solid #7c2d12',
      }}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  )
}

// ─── Table atoms ───
function Th({ children }) {
  return (
    <th
      className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-left"
      style={{ color: '#1c1917' }}
    >
      {children}
    </th>
  )
}
function Td({ children }) {
  return <td className="px-3 py-2 align-middle">{children}</td>
}

// ─── Inline editors ───
function InlineText({ value, onCommit, placeholder }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className="w-full px-1 py-0.5 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-700"
        style={{ backgroundColor: '#fff', color: '#1c1917', border: '1px solid #7c2d12' }}
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => { setDraft(value); setEditing(true) }}
      className="text-xs font-mono text-left w-full truncate hover:bg-orange-100 px-1 py-0.5 rounded-sm"
      style={{ color: value ? '#1c1917' : '#7c2d12' }}
    >
      {value || placeholder || '—'}
    </button>
  )
}

function InlineSelect({ value, options, onCommit, tone }) {
  const opts = options.map(o => typeof o === 'string' ? { value: o, label: o } : o)
  const colors = toneColors(tone)
  return (
    <select
      value={value}
      onChange={(e) => onCommit(e.target.value)}
      className="px-1.5 py-0.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-700"
      style={{
        backgroundColor: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
      }}
    >
      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function statusTone(status) {
  if (status === 'final' || status === 'approved') return 'good'
  if (status === 'blocked') return 'danger'
  if (status === 'on_hold' || status === 'omitted') return 'warn'
  if (status === 'in_progress' || status === 'pending_review' || status === 'revisions') return 'active'
  return 'neutral'
}

function toneColors(tone) {
  switch (tone) {
    case 'good':   return { bg: '#dcfce7', fg: '#15803d', border: '#15803d' }
    case 'danger': return { bg: '#fee2e2', fg: '#991b1b', border: '#991b1b' }
    case 'warn':   return { bg: '#fed7aa', fg: '#7c2d12', border: '#7c2d12' }
    case 'active': return { bg: '#fed7aa', fg: '#ea580c', border: '#ea580c' }
    default:       return { bg: '#fff',    fg: '#1c1917', border: '#7c2d12' }
  }
}
