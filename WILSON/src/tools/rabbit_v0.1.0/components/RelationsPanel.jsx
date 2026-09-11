// ============================================================
// RABBIT — RelationsPanel (shared)
// ============================================================
//
// Reusable left-column panel that shows related assets & tasks
// for scene/shot/level/experience detail popups. Matches the
// two-column layout of TaskDetailPopup.
//
// Also exports:
//   • RelationPickerPopup — multi-select picker for assets
//   • RelationBadge — clickable badge for asset table rows
//   • NewTaskSidePopup — task creation form (appears to left)
//   • AssetRelationsSidebar — left sidebar for asset popup

import { useState, useMemo } from 'react'
import {
  Boxes, ListChecks, Plus, X, Search,
  ChevronDown, ChevronRight, Check,
  Film, Clapperboard, Gamepad2, Sparkles,
} from 'lucide-react'

// ── Status colors ──
function statusColor(status) {
  switch (status) {
    case 'in_progress':     return '#fb923c'
    case 'pending_review':  return '#fbbf24'
    case 'needs_revisions': return '#e879f9'
    case 'approved':        return '#4ade80'
    case 'final':           return '#22c55e'
    case 'blocked':         return '#ef4444'
    case 'on_hold':         return '#fcd34d'
    case 'omitted':         return '#57534e'
    case 'waiting_to_start': return '#a8a29e'
    default:                return '#a8a29e'
  }
}
function fmt(s) { return (s || '').replace(/_/g, ' ') }


// ═════════════════════════════════════════════════════════
// RelationsPanel — LEFT COLUMN for detail popups
// ═════════════════════════════════════════════════════════
//
// Props:
//   entityType     — 'scene' | 'shot' | 'level' | 'experience'
//   entityId       — the ID of the entity
//   assets         — all assets array
//   tasks          — all tasks array
//   ctx            — RabbitProvider context
//   onOpenAsset    — (assetId) => void — click an asset row
//   onOpenTask     — (taskId) => void — click a task row
//   onCreateTask   — () => void — click "+" to create a new task

export default function RelationsPanel({
  entityType,
  entityId,
  assets,
  tasks,
  ctx,
  onOpenAsset,
  onOpenTask,
  onCreateTask,
}) {
  const [collapsedAssets, setCollapsedAssets] = useState(false)
  const [collapsedTasks, setCollapsedTasks] = useState(false)
  const [showAssetPicker, setShowAssetPicker] = useState(false)

  // Field name on asset for this entity type
  const assetField = `${entityType}_ids` // e.g. "scene_ids"
  // Field name on task for this entity type
  const taskField = `${entityType}_id`   // e.g. "scene_id"

  // Related assets: assets where entityId is in asset[scene_ids/shot_ids/etc.]
  const relatedAssets = useMemo(() =>
    assets.filter(a => (a[assetField] || []).includes(entityId)),
    [assets, assetField, entityId]
  )

  // Related tasks: tasks where task[scene_id/shot_id/etc.] === entityId
  const relatedTasks = useMemo(() =>
    tasks.filter(t => t[taskField] === entityId),
    [tasks, taskField, entityId]
  )

  // Add asset relation
  function addAssetRelation(assetId) {
    const asset = assets.find(a => a.id === assetId)
    if (!asset) return
    const current = asset[assetField] || []
    if (!current.includes(entityId)) {
      ctx?.updateAsset?.(assetId, { [assetField]: [...current, entityId] })
    }
  }

  // Remove asset relation
  function removeAssetRelation(assetId) {
    const asset = assets.find(a => a.id === assetId)
    if (!asset) return
    const current = asset[assetField] || []
    ctx?.updateAsset?.(assetId, { [assetField]: current.filter(id => id !== entityId) })
  }

  // Unlinked assets (for picker)
  const unlinkedAssets = useMemo(() =>
    assets.filter(a => !(a[assetField] || []).includes(entityId)),
    [assets, assetField, entityId]
  )

  return (
    <div className="relative flex-shrink-0 overflow-auto" style={{ width: 360, borderRight: '1px solid #44403c', backgroundColor: '#1c1917' }}>
      <div className="p-3 flex flex-col gap-1">

        {/* ── Related Assets ── */}
        <div className="rounded" style={{ border: '1px solid #292524' }}>
          <button type="button"
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-stone-800/50 transition-colors"
            onClick={() => setCollapsedAssets(!collapsedAssets)}
            style={{ borderBottom: collapsedAssets ? 'none' : '1px solid #292524' }}>
            {collapsedAssets
              ? <ChevronRight className="w-3 h-3" style={{ color: '#78716c' }} />
              : <ChevronDown className="w-3 h-3" style={{ color: '#78716c' }} />}
            <Boxes className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
            <span className="text-[10.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>
              Assets ({relatedAssets.length})
            </span>
            <button type="button"
              onClick={e => { e.stopPropagation(); setShowAssetPicker(true) }}
              className="ml-auto p-0.5 rounded hover:bg-stone-700 transition-colors"
              style={{ color: '#78716c' }}
              title="Add asset relation">
              <Plus className="w-3 h-3" />
            </button>
          </button>

          {!collapsedAssets && (
            <div className="px-1 pb-1">
              {relatedAssets.length === 0 ? (
                <div className="px-3 py-3 text-center">
                  <p className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
                    No assets linked
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {relatedAssets.map(a => (
                    <div key={a.id}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-stone-800/50 transition-colors group/rel cursor-pointer"
                      onClick={() => onOpenAsset?.(a.id)}>
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor(a.status) }} />
                      <span className="text-[11px] font-mono truncate flex-1" style={{ color: '#d6d3d1' }}>
                        {a.name || 'Untitled'}
                      </span>
                      <span className="px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider rounded flex-shrink-0"
                        style={{ color: statusColor(a.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(a.status)}30` }}>
                        {fmt(a.status || 'not_started')}
                      </span>
                      <button type="button"
                        onClick={e => { e.stopPropagation(); removeAssetRelation(a.id) }}
                        className="p-0.5 rounded hover:bg-stone-700 transition-colors opacity-0 group-hover/rel:opacity-100 flex-shrink-0"
                        style={{ color: '#ef4444' }}
                        title="Remove relation">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Related Tasks ── */}
        <div className="rounded" style={{ border: '1px solid #292524' }}>
          <button type="button"
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-stone-800/50 transition-colors"
            onClick={() => setCollapsedTasks(!collapsedTasks)}
            style={{ borderBottom: collapsedTasks ? 'none' : '1px solid #292524' }}>
            {collapsedTasks
              ? <ChevronRight className="w-3 h-3" style={{ color: '#78716c' }} />
              : <ChevronDown className="w-3 h-3" style={{ color: '#78716c' }} />}
            <ListChecks className="w-3.5 h-3.5" style={{ color: '#fbbf24' }} />
            <span className="text-[10.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fbbf24' }}>
              Tasks ({relatedTasks.length})
            </span>
            {onCreateTask && (
              <button type="button"
                onClick={e => { e.stopPropagation(); onCreateTask() }}
                className="ml-auto p-0.5 rounded hover:bg-stone-700 transition-colors"
                style={{ color: '#78716c' }}
                title="Add new task">
                <Plus className="w-3 h-3" />
              </button>
            )}
          </button>

          {!collapsedTasks && (
            <div className="px-1 pb-1">
              {relatedTasks.length === 0 ? (
                <div className="px-3 py-3 text-center">
                  <p className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
                    No tasks linked
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {relatedTasks.map(t => {
                    const linkedAsset = t.asset_id ? assets.find(a => a.id === t.asset_id) : null
                    return (
                      <div key={t.id}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-stone-800/50 transition-colors cursor-pointer"
                        onClick={() => onOpenTask?.(t.id)}>
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor(t.status) }} />
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] font-mono truncate block" style={{ color: '#d6d3d1' }}>
                            {t.title || 'Untitled'}
                          </span>
                          {linkedAsset && (
                            <span className="text-[9px] font-mono truncate block" style={{ color: '#57534e' }}>
                              {linkedAsset.name}
                            </span>
                          )}
                        </div>
                        <span className="px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider rounded flex-shrink-0"
                          style={{ color: statusColor(t.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(t.status)}30` }}>
                          {fmt(t.status || 'waiting_to_start')}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* No relations at all */}
        {relatedAssets.length === 0 && relatedTasks.length === 0 && (
          <div className="px-3 py-4 text-center">
            <Boxes className="w-5 h-5 mx-auto mb-2" style={{ color: '#44403c' }} />
            <p className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
              No assets or tasks linked yet
            </p>
          </div>
        )}
      </div>

      {/* Asset Picker overlay */}
      {showAssetPicker && (
        <AssetPickerOverlay
          assets={unlinkedAssets}
          onPick={assetId => { addAssetRelation(assetId) }}
          onClose={() => setShowAssetPicker(false)}
        />
      )}
    </div>
  )
}


// ═════════════════════════════════════════════════════════
// AssetPickerOverlay — mini-picker for adding assets
// ═════════════════════════════════════════════════════════
function AssetPickerOverlay({ assets, onPick, onClose }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return assets
    const q = search.toLowerCase()
    return assets.filter(a => (a.name || '').toLowerCase().includes(q))
  }, [assets, search])

  return (
    <div className="absolute inset-0 z-30 flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid #44403c' }}>
        <span className="text-[10.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>
          Link Asset
        </span>
        <div className="flex-1" />
        <button type="button" onClick={onClose}
          className="p-0.5 rounded hover:bg-stone-700 transition-colors" style={{ color: '#a8a29e' }}>
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2" style={{ borderBottom: '1px solid #292524' }}>
        <div className="flex items-center rounded" style={{ border: '1px solid #44403c', backgroundColor: '#292524' }}>
          <Search className="w-3 h-3 ml-2 flex-shrink-0" style={{ color: '#57534e' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search assets…"
            className="flex-1 px-2 py-1.5 text-[10.5px] font-mono bg-transparent"
            style={{ color: '#d6d3d1' }}
            autoFocus />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto px-1 py-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-[10px] font-mono uppercase" style={{ color: '#57534e' }}>
            {assets.length === 0 ? 'All assets already linked' : 'No matches'}
          </div>
        ) : (
          filtered.map(a => (
            <button key={a.id} type="button"
              onClick={() => onPick(a.id)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-stone-800/50 transition-colors text-left">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor(a.status) }} />
              <span className="text-[11px] font-mono truncate flex-1" style={{ color: '#d6d3d1' }}>
                {a.name || 'Untitled'}
              </span>
              <Plus className="w-3 h-3 flex-shrink-0" style={{ color: '#78716c' }} />
            </button>
          ))
        )}
      </div>
    </div>
  )
}


// ═════════════════════════════════════════════════════════
// NewTaskSidePopup — task creation form for the left side
// ═════════════════════════════════════════════════════════
//
// Renders as a standalone panel; parent positions it.
//
// Props:
//   entityType      — 'scene' | 'shot' | 'level' | 'experience'
//   entityId        — auto-set on the new task
//   assets          — for asset dropdown
//   phases          — for phase dropdown
//   scenes, shots, levels, experiences — for optional relation dropdowns
//   projectMembers  — for assignee dropdown
//   roleEntries     — for role dropdown
//   project         — for feature flags
//   onConfirm(task) — called with the task data after user confirms
//   onClose         — close popup

const TASK_STATUSES_LIST = [
  'waiting_to_start','in_progress','pending_review','needs_revisions',
  'approved','final','blocked','on_hold','omitted',
]
const PRIORITIES_LIST = ['low','medium','high','urgent']

export function NewTaskSidePopup({
  entityType,
  entityId,
  assets = [],
  phases = [],
  scenes = [],
  shots = [],
  levels = [],
  experiences = [],
  projectMembers = [],
  roleEntries = [],
  project,
  onConfirm,
  onClose,
}) {
  const [draft, setDraft] = useState({
    title: '',
    status: 'waiting_to_start',
    priority: 'medium',
    asset_id: null,
    phase_id: null,
    scene_id: entityType === 'scene' ? entityId : null,
    shot_id: entityType === 'shot' ? entityId : null,
    level_id: entityType === 'level' ? entityId : null,
    experience_id: entityType === 'experience' ? entityId : null,
    assignee_id: null,
    assigned_role_slug: null,
    bid_days: null,
    start_date: '',
    end_date: '',
    description: '',
  })

  function upd(patch) { setDraft(prev => ({ ...prev, ...patch })) }

  function handleConfirm() {
    if (!draft.title.trim()) return
    if (!window.confirm(`Create task "${draft.title}"?`)) return
    onConfirm(draft)
  }

  const scenesOn = project?.scenes_enabled
  const levelsOn = project?.levels_enabled
  const experiencesOn = project?.experiences_enabled

  // Filter shots by selected scene
  const shotsForScene = draft.scene_id
    ? shots.filter(s => s.scene_id === draft.scene_id)
    : shots

  return (
    <div className="flex flex-col h-full overflow-hidden rounded-sm"
      style={{ width: 400, backgroundColor: '#292524', border: '2px solid #f97316', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid #44403c' }}>
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4" style={{ color: '#fbbf24' }} />
          <span className="text-[13px] font-mono font-bold" style={{ color: '#fbbf24' }}>New Task</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {/* Title */}
        <div className="mb-3">
          <SideLabel>Title *</SideLabel>
          <input type="text" value={draft.title} onChange={e => upd({ title: e.target.value })}
            placeholder="Task title…" autoFocus
            className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
        </div>

        {/* Status + Priority */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <SideLabel>Status</SideLabel>
            <select value={draft.status} onChange={e => upd({ status: e.target.value })}
              className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: statusColor(draft.status), border: '1px solid #44403c' }}>
              {TASK_STATUSES_LIST.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
            </select>
          </div>
          <div>
            <SideLabel>Priority</SideLabel>
            <select value={draft.priority} onChange={e => upd({ priority: e.target.value })}
              className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}>
              {PRIORITIES_LIST.map(p => <option key={p} value={p}>{fmt(p)}</option>)}
            </select>
          </div>
        </div>

        {/* Asset + Phase */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <SideLabel>Asset</SideLabel>
            <select value={draft.asset_id || ''} onChange={e => upd({ asset_id: e.target.value || null })}
              className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: draft.asset_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
              <option value="">--</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.name || 'Untitled'}</option>)}
            </select>
          </div>
          <div>
            <SideLabel>Phase</SideLabel>
            <select value={draft.phase_id || ''} onChange={e => upd({ phase_id: e.target.value || null })}
              className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: draft.phase_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
              <option value="">--</option>
              {phases.map(p => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
            </select>
          </div>
        </div>

        {/* Scene / Shot (conditional) */}
        {scenesOn && (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <SideLabel>Scene</SideLabel>
              <select value={draft.scene_id || ''} onChange={e => upd({ scene_id: e.target.value || null, shot_id: null })}
                className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: draft.scene_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}
                disabled={entityType === 'scene'}>
                <option value="">--</option>
                {scenes.map(s => <option key={s.id} value={s.id}>{s.name || 'Untitled'}</option>)}
              </select>
            </div>
            <div>
              <SideLabel>Shot</SideLabel>
              <select value={draft.shot_id || ''} onChange={e => upd({ shot_id: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: draft.shot_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}
                disabled={entityType === 'shot'}>
                <option value="">--</option>
                {shotsForScene.map(s => <option key={s.id} value={s.id}>{s.name || 'Untitled'}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Level / Experience (conditional) */}
        {(levelsOn || experiencesOn) && (
          <div className="grid grid-cols-2 gap-3 mb-3">
            {levelsOn && (
              <div>
                <SideLabel>Level</SideLabel>
                <select value={draft.level_id || ''} onChange={e => upd({ level_id: e.target.value || null })}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: draft.level_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}
                  disabled={entityType === 'level'}>
                  <option value="">--</option>
                  {levels.map(l => <option key={l.id} value={l.id}>{l.name || 'Untitled'}</option>)}
                </select>
              </div>
            )}
            {experiencesOn && (
              <div>
                <SideLabel>Experience</SideLabel>
                <select value={draft.experience_id || ''} onChange={e => upd({ experience_id: e.target.value || null })}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: draft.experience_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}
                  disabled={entityType === 'experience'}>
                  <option value="">--</option>
                  {experiences.map(ex => <option key={ex.id} value={ex.id}>{ex.name || 'Untitled'}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Assignee + Role */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <SideLabel>Assignee</SideLabel>
            <select value={draft.assignee_id || ''} onChange={e => upd({ assignee_id: e.target.value || null })}
              className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: draft.assignee_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
              <option value="">--</option>
              {projectMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <SideLabel>Role</SideLabel>
            <select value={draft.assigned_role_slug || ''} onChange={e => upd({ assigned_role_slug: e.target.value || null })}
              className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: draft.assigned_role_slug ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
              <option value="">--</option>
              {roleEntries.map(r => <option key={r.role_slug} value={r.role_slug}>{r.role_label}</option>)}
            </select>
          </div>
        </div>

        {/* Bid + Dates */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <SideLabel>Bid days</SideLabel>
            <input type="number" value={draft.bid_days ?? ''} min={0} step={0.5}
              onChange={e => { const n = parseFloat(e.target.value); upd({ bid_days: isNaN(n) ? null : n }) }}
              className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}
              placeholder="--" />
          </div>
          <div>
            <SideLabel>Start</SideLabel>
            <input type="date" value={draft.start_date || ''} onChange={e => upd({ start_date: e.target.value || '' })}
              className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', colorScheme: 'dark' }} />
          </div>
          <div>
            <SideLabel>End</SideLabel>
            <input type="date" value={draft.end_date || ''} onChange={e => upd({ end_date: e.target.value || '' })}
              className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', colorScheme: 'dark' }} />
          </div>
        </div>

        {/* Description */}
        <div className="mb-3">
          <SideLabel>Description</SideLabel>
          <textarea value={draft.description} onChange={e => upd({ description: e.target.value })}
            rows={3}
            className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:ring-2 focus:ring-orange-500 resize-y"
            style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}
            placeholder="Task description…" />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid #44403c' }}>
        <button type="button" onClick={onClose}
          className="px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded transition-colors hover:bg-stone-700"
          style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
          Cancel
        </button>
        <button type="button" onClick={handleConfirm}
          disabled={!draft.title.trim()}
          className="px-4 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded transition-colors"
          style={{
            color: draft.title.trim() ? '#fff7ed' : '#78716c',
            backgroundColor: draft.title.trim() ? '#ea580c' : '#292524',
            border: draft.title.trim() ? '1px solid #c2410c' : '1px solid #44403c',
          }}>
          Create Task
        </button>
      </div>
    </div>
  )
}

function SideLabel({ children }) {
  return <div className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: '#78716c' }}>{children}</div>
}


// ═════════════════════════════════════════════════════════
// AssetRelationsSidebar — left sidebar for asset popup
// ═════════════════════════════════════════════════════════
//
// Shows all scenes, shots, levels, experiences an asset is
// related to. Allows adding new relations. Each database
// section is collapsible.

export function AssetRelationsSidebar({ asset, ctx }) {
  const project = ctx?.project
  const scenes = ctx?.scenes || []
  const shots = ctx?.shots || []
  const levels = ctx?.levels || []
  const experiences = ctx?.experiences || []

  const scenesOn = project?.scenes_enabled
  const levelsOn = project?.levels_enabled
  const experiencesOn = project?.experiences_enabled

  const [collapsed, setCollapsed] = useState({})
  const [expandedScenes, setExpandedScenes] = useState(new Set())
  const [showPicker, setShowPicker] = useState(null) // 'scenes' | 'shots' | 'levels' | 'experiences' | null

  function toggle(key) { setCollapsed(prev => ({ ...prev, [key]: !prev[key] })) }
  function toggleSceneExpand(sceneId) {
    setExpandedScenes(prev => {
      const next = new Set(prev)
      next.has(sceneId) ? next.delete(sceneId) : next.add(sceneId)
      return next
    })
  }

  // Related items
  const relScenes = useMemo(() => {
    const ids = asset?.scene_ids || []
    return scenes.filter(s => ids.includes(s.id))
  }, [scenes, asset?.scene_ids])

  const relShots = useMemo(() => {
    const ids = asset?.shot_ids || []
    return shots.filter(s => ids.includes(s.id))
  }, [shots, asset?.shot_ids])

  // Group related shots by their parent scene
  const shotsByScene = useMemo(() => {
    const map = {}
    relShots.forEach(sh => {
      const sid = sh.scene_id || '__orphan__'
      if (!map[sid]) map[sid] = []
      map[sid].push(sh)
    })
    return map
  }, [relShots])

  // Orphan shots: related shots whose parent scene is NOT in relScenes
  const relSceneIdSet = useMemo(() => new Set(relScenes.map(s => s.id)), [relScenes])
  const orphanShots = useMemo(() =>
    relShots.filter(sh => !sh.scene_id || !relSceneIdSet.has(sh.scene_id)),
    [relShots, relSceneIdSet]
  )

  const relLevels = useMemo(() => {
    const ids = asset?.level_ids || []
    return levels.filter(l => ids.includes(l.id))
  }, [levels, asset?.level_ids])

  const relExperiences = useMemo(() => {
    const ids = asset?.experience_ids || []
    return experiences.filter(e => ids.includes(e.id))
  }, [experiences, asset?.experience_ids])

  function toggleRelation(field, id) {
    const current = asset?.[field] || []
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    ctx?.updateAsset?.(asset.id, { [field]: next })
  }

  function removeRelation(field, id) {
    const current = asset?.[field] || []
    ctx?.updateAsset?.(asset.id, { [field]: current.filter(x => x !== id) })
  }

  if (!asset) return null
  if (!scenesOn && !levelsOn && !experiencesOn) return null

  // Standalone sections (levels, experiences)
  const extraSections = []
  if (levelsOn) {
    extraSections.push({ key: 'levels', label: 'Levels', icon: Gamepad2, color: '#fbbf24', items: relLevels, field: 'level_ids', allItems: levels })
  }
  if (experiencesOn) {
    extraSections.push({ key: 'experiences', label: 'Experiences', icon: Sparkles, color: '#e879f9', items: relExperiences, field: 'experience_ids', allItems: experiences })
  }

  const sceneShotCount = relScenes.length + relShots.length
  const sceneShotCollapsed = collapsed['scenes_shots']

  return (
    <div className="flex-shrink-0 overflow-auto" style={{ width: 320, borderRight: '1px solid #44403c', backgroundColor: '#1c1917' }}>
      <div className="p-3 flex flex-col gap-1">

        {/* ── Combined Scenes & Shots section ── */}
        {scenesOn && (
          <div className="rounded" style={{ border: '1px solid #292524' }}>
            {/* Section header */}
            <button type="button"
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-stone-800/50 transition-colors"
              onClick={() => toggle('scenes_shots')}
              style={{ borderBottom: sceneShotCollapsed ? 'none' : '1px solid #292524' }}>
              {sceneShotCollapsed
                ? <ChevronRight className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
                : <ChevronDown className="w-3.5 h-3.5" style={{ color: '#78716c' }} />}
              <Film className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
              <span className="text-[10.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>
                Scenes & Shots ({sceneShotCount})
              </span>
              <div className="ml-auto flex items-center gap-0.5">
                <button type="button"
                  onClick={e => { e.stopPropagation(); setShowPicker('scenes') }}
                  className="p-1 rounded hover:bg-stone-700 transition-colors flex items-center gap-0.5"
                  style={{ color: '#78716c' }}
                  title="Link scene">
                  <Film className="w-2.5 h-2.5" /><Plus className="w-2.5 h-2.5" />
                </button>
                <button type="button"
                  onClick={e => { e.stopPropagation(); setShowPicker('shots') }}
                  className="p-1 rounded hover:bg-stone-700 transition-colors flex items-center gap-0.5"
                  style={{ color: '#78716c' }}
                  title="Link shot">
                  <Clapperboard className="w-2.5 h-2.5" /><Plus className="w-2.5 h-2.5" />
                </button>
              </div>
            </button>

            {!sceneShotCollapsed && (
              <div className="px-1 pb-1">
                {relScenes.length === 0 && orphanShots.length === 0 ? (
                  <div className="px-3 py-2 text-center">
                    <p className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
                      No scenes or shots linked
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {/* Scene rows — each expandable to show child shots */}
                    {relScenes.map(sc => {
                      const childShots = shotsByScene[sc.id] || []
                      const isExpanded = expandedScenes.has(sc.id)
                      return (
                        <div key={sc.id}>
                          {/* Scene row */}
                          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-stone-800/50 transition-colors group/rel">
                            {/* Expand chevron */}
                            <button type="button"
                              onClick={() => toggleSceneExpand(sc.id)}
                              className="p-0.5 rounded hover:bg-stone-700/50 transition-colors flex-shrink-0"
                              style={{ color: '#78716c' }}>
                              {childShots.length > 0 ? (
                                isExpanded
                                  ? <ChevronDown className="w-3.5 h-3.5" />
                                  : <ChevronRight className="w-3.5 h-3.5" />
                              ) : (
                                <span className="w-3.5 h-3.5 block" />
                              )}
                            </button>
                            <Film className="w-3 h-3 flex-shrink-0" style={{ color: '#fb923c' }} />
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor(sc.status) }} />
                            <span className="text-[11px] font-mono truncate flex-1" style={{ color: '#d6d3d1' }}>
                              {sc.name || 'Untitled'}
                            </span>
                            {childShots.length > 0 && (
                              <span className="text-[8px] font-mono flex-shrink-0" style={{ color: '#78716c' }}>
                                {childShots.length}
                              </span>
                            )}
                            <button type="button"
                              onClick={() => removeRelation('scene_ids', sc.id)}
                              className="p-0.5 rounded hover:bg-stone-700 transition-colors opacity-0 group-hover/rel:opacity-100 flex-shrink-0"
                              style={{ color: '#ef4444' }}
                              title="Remove scene">
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>

                          {/* Nested shots */}
                          {isExpanded && childShots.length > 0 && (
                            <div className="ml-5 flex flex-col gap-0.5" style={{ borderLeft: '1px solid #292524' }}>
                              {childShots.map(sh => (
                                <div key={sh.id}
                                  className="flex items-center gap-2 pl-3 pr-2 py-1 rounded hover:bg-stone-800/50 transition-colors group/sh">
                                  <Clapperboard className="w-2.5 h-2.5 flex-shrink-0" style={{ color: '#f97316' }} />
                                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor(sh.status) }} />
                                  <span className="text-[10.5px] font-mono truncate flex-1" style={{ color: '#a8a29e' }}>
                                    {sh.name || 'Untitled'}
                                  </span>
                                  <span className="px-1 py-0.5 text-[7px] font-mono uppercase tracking-wider rounded flex-shrink-0"
                                    style={{ color: statusColor(sh.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(sh.status)}30` }}>
                                    {fmt(sh.status || 'not_started')}
                                  </span>
                                  <button type="button"
                                    onClick={() => removeRelation('shot_ids', sh.id)}
                                    className="p-0.5 rounded hover:bg-stone-700 transition-colors opacity-0 group-hover/sh:opacity-100 flex-shrink-0"
                                    style={{ color: '#ef4444' }}
                                    title="Remove shot">
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Orphan shots (related but parent scene not linked) */}
                    {orphanShots.length > 0 && (
                      <>
                        {relScenes.length > 0 && (
                          <div className="mx-2 my-1" style={{ borderTop: '1px solid #292524' }} />
                        )}
                        {orphanShots.map(sh => (
                          <div key={sh.id}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-stone-800/50 transition-colors group/rel">
                            <span className="w-3.5 h-3.5 block flex-shrink-0" />
                            <Clapperboard className="w-3 h-3 flex-shrink-0" style={{ color: '#f97316' }} />
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor(sh.status) }} />
                            <span className="text-[11px] font-mono truncate flex-1" style={{ color: '#d6d3d1' }}>
                              {sh.name || 'Untitled'}
                            </span>
                            <span className="px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider rounded flex-shrink-0"
                              style={{ color: statusColor(sh.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(sh.status)}30` }}>
                              {fmt(sh.status || 'not_started')}
                            </span>
                            <button type="button"
                              onClick={() => removeRelation('shot_ids', sh.id)}
                              className="p-0.5 rounded hover:bg-stone-700 transition-colors opacity-0 group-hover/rel:opacity-100 flex-shrink-0"
                              style={{ color: '#ef4444' }}
                              title="Remove shot">
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Levels / Experiences sections ── */}
        {extraSections.map(sec => {
          const Icon = sec.icon
          const isCollapsed = collapsed[sec.key]
          return (
            <div key={sec.key} className="rounded" style={{ border: '1px solid #292524' }}>
              <button type="button"
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-stone-800/50 transition-colors"
                onClick={() => toggle(sec.key)}
                style={{ borderBottom: isCollapsed ? 'none' : '1px solid #292524' }}>
                {isCollapsed
                  ? <ChevronRight className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
                  : <ChevronDown className="w-3.5 h-3.5" style={{ color: '#78716c' }} />}
                <Icon className="w-3.5 h-3.5" style={{ color: sec.color }} />
                <span className="text-[10.5px] font-mono uppercase tracking-wider font-bold" style={{ color: sec.color }}>
                  {sec.label} ({sec.items.length})
                </span>
                <button type="button"
                  onClick={e => { e.stopPropagation(); setShowPicker(sec.key) }}
                  className="ml-auto p-0.5 rounded hover:bg-stone-700 transition-colors"
                  style={{ color: '#78716c' }}
                  title={`Add ${sec.label.toLowerCase()} relation`}>
                  <Plus className="w-3 h-3" />
                </button>
              </button>

              {!isCollapsed && (
                <div className="px-1 pb-1">
                  {sec.items.length === 0 ? (
                    <div className="px-3 py-2 text-center">
                      <p className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
                        No {sec.label.toLowerCase()} linked
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {sec.items.map(item => (
                        <div key={item.id}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-stone-800/50 transition-colors group/rel">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor(item.status) }} />
                          <span className="text-[11px] font-mono truncate flex-1" style={{ color: '#d6d3d1' }}>
                            {item.name || 'Untitled'}
                          </span>
                          <span className="px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider rounded flex-shrink-0"
                            style={{ color: statusColor(item.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(item.status)}30` }}>
                            {fmt(item.status || 'not_started')}
                          </span>
                          <button type="button"
                            onClick={() => removeRelation(sec.field, item.id)}
                            className="p-0.5 rounded hover:bg-stone-700 transition-colors opacity-0 group-hover/rel:opacity-100 flex-shrink-0"
                            style={{ color: '#ef4444' }}
                            title="Remove relation">
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Picker popup */}
      {showPicker === 'scenes' && (
        <RelationPickerPopup
          title="Link Scenes"
          icon={Film}
          items={scenes}
          selectedIds={asset?.scene_ids || []}
          onToggle={id => toggleRelation('scene_ids', id)}
          onClose={() => setShowPicker(null)}
        />
      )}
      {showPicker === 'shots' && (
        <RelationPickerPopup
          title="Link Shots"
          icon={Clapperboard}
          items={shots}
          selectedIds={asset?.shot_ids || []}
          onToggle={id => toggleRelation('shot_ids', id)}
          onClose={() => setShowPicker(null)}
        />
      )}
      {showPicker && showPicker !== 'scenes' && showPicker !== 'shots' && (() => {
        const sec = extraSections.find(s => s.key === showPicker)
        if (!sec) return null
        return (
          <RelationPickerPopup
            title={`Link ${sec.label}`}
            icon={sec.icon}
            items={sec.allItems}
            selectedIds={asset?.[sec.field] || []}
            onToggle={id => toggleRelation(sec.field, id)}
            onClose={() => setShowPicker(null)}
          />
        )
      })()}
    </div>
  )
}


// ═════════════════════════════════════════════════════════
// RelationPickerPopup — modal for managing asset relations
// ═════════════════════════════════════════════════════════
//
// Shows all available items (scenes/shots/levels/experiences)
// with checkboxes for toggling relations on the given asset.
//
// Props:
//   title           — popup title
//   icon            — lucide icon component
//   items           — all available items (scenes/shots/etc.)
//   selectedIds     — array of currently related IDs
//   onToggle(id)    — toggle relation on/off
//   onClose()       — close popup
//   getItemName(item) — optional name accessor
//   getItemStatus(item) — optional status accessor

export function RelationPickerPopup({
  title,
  icon: Icon,
  items,
  selectedIds = [],
  onToggle,
  onClose,
  getItemName,
  getItemStatus,
}) {
  const [search, setSearch] = useState('')

  const getName = getItemName || (item => item.name || 'Untitled')
  const getStatus = getItemStatus || (item => item.status || 'not_started')

  const filtered = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter(item => getName(item).toLowerCase().includes(q))
  }, [items, search])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  return (
    <>
      <div className="fixed inset-0 z-[60]" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div className="fixed z-[60] top-1/2 left-1/2 w-full max-w-md rounded overflow-hidden flex flex-col"
        style={{
          backgroundColor: '#292524',
          border: '2px solid #f97316',
          maxHeight: '70vh',
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #44403c' }}>
          <div className="flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4" style={{ color: '#fb923c' }} />}
            <span className="text-[13px] font-mono font-bold" style={{ color: '#fb923c' }}>
              {title}
            </span>
            <span className="text-[10px] font-mono" style={{ color: '#78716c' }}>
              ({selectedIds.length} linked)
            </span>
          </div>
          <button type="button" onClick={onClose}
            className="p-1 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2" style={{ borderBottom: '1px solid #292524' }}>
          <div className="flex items-center rounded" style={{ border: '1px solid #44403c', backgroundColor: '#1c1917' }}>
            <Search className="w-3 h-3 ml-2 flex-shrink-0" style={{ color: '#57534e' }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="flex-1 px-2 py-1.5 text-[11px] font-mono bg-transparent"
              style={{ color: '#d6d3d1' }}
              autoFocus />
          </div>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-auto px-2 py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[10.5px] font-mono uppercase" style={{ color: '#57534e' }}>
              No items found
            </div>
          ) : (
            filtered.map(item => {
              const isSelected = selectedSet.has(item.id)
              const st = getStatus(item)
              return (
                <button key={item.id} type="button"
                  onClick={() => onToggle(item.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded hover:bg-stone-800/50 transition-colors text-left"
                  style={{ backgroundColor: isSelected ? 'rgba(234, 88, 12, 0.08)' : 'transparent' }}>
                  {/* Checkbox */}
                  <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                    style={{
                      border: `1.5px solid ${isSelected ? '#fb923c' : '#57534e'}`,
                      backgroundColor: isSelected ? '#ea580c' : 'transparent',
                    }}>
                    {isSelected && <Check className="w-2.5 h-2.5" style={{ color: '#fff' }} />}
                  </div>
                  {/* Status dot */}
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor(st) }} />
                  {/* Name */}
                  <span className="text-[11.5px] font-mono truncate flex-1"
                    style={{ color: isSelected ? '#f4a261' : '#d6d3d1' }}>
                    {getName(item)}
                  </span>
                  {/* Status badge */}
                  <span className="px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider rounded flex-shrink-0"
                    style={{ color: statusColor(st), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(st)}30` }}>
                    {fmt(st)}
                  </span>
                </button>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 flex justify-end" style={{ borderTop: '1px solid #44403c' }}>
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded transition-colors hover:bg-stone-700"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
            Done
          </button>
        </div>
      </div>
    </>
  )
}


// ═════════════════════════════════════════════════════════
// RelationBadge — clickable badge for inline in table rows
// ═════════════════════════════════════════════════════════
export function RelationBadge({ icon: Icon, count, label, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-stone-800 transition-colors"
      style={{
        color: count > 0 ? '#f4a261' : '#57534e',
        border: `1px solid ${count > 0 ? '#f4a261' + '40' : '#44403c'}`,
        backgroundColor: count > 0 ? 'rgba(249, 115, 22, 0.06)' : 'transparent',
      }}>
      {Icon && <Icon className="w-3 h-3" />}
      <span className="text-[9.5px] font-mono tabular-nums">{count}</span>
    </button>
  )
}
