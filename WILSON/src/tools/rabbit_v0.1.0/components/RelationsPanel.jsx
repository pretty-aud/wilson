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
//
// UI overhaul B4b, surface 4 (2026-09-25): on the shared kit (src/ui) and
// lane B4's sheet, rabbitFiles.css (`rb-rel-`). Both sidebars are the kit
// Panel at `lg`, one width (R4-23); a group's head is a row of SIBLINGS —
// its collapse toggle, then its link buttons, the kit's small IconButtons —
// where the buttons used to sit inside the toggle (R4-24); every status is
// the kit's StatusDot and the kit's words, from the one STATUS map. The two
// pickers share one head, search field and row spec (R4-43):
// RelationPickerPopup is the kit Dialog, portalled into <body>, and
// AssetPickerOverlay stays the in-panel overlay it was (C1). NewTaskSidePopup
// is on the kit's surface tokens, its fields the kit Field over native
// `ui-input`s, and its "Create task …?" question the kit Dialog (W9).
// RelationBadge is drawn at last, in the asset popup's four relation fields
// (R4-27). Every state is a `data-*` attribute or a real :hover resolved in
// the sheet.

import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Boxes, ListChecks, Plus, X, Search,
  ChevronDown, ChevronRight, Square, CheckSquare,
  Film, Clapperboard, Gamepad2, Sparkles,
} from 'lucide-react'
import {
  Panel, Dialog, Button, IconButton, Field, EmptyState, HoverActions,
  StatusDot, statusMeta,
} from '../../../ui'
import '../views/rabbitFiles.css'

// A priority's words, in sentence case ("low" -> "Low"). A status's words
// are the kit's (`statusMeta`), and its colour the kit's tone: the local
// status colour map this file kept is gone.
function fmt(s) { return (s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) }


// ═════════════════════════════════════════════════════════
// The parts both sidebars and both pickers are made of
// ═════════════════════════════════════════════════════════

// ── A relation group: its head row, then its rows ──
// The head is SIBLINGS: the collapse toggle (chevron, glyph, the group's
// name and its count) and then the group's own buttons, where they were.
// Those buttons used to be nested INSIDE the toggle — a <button> in a
// <button>, which React warned about on every asset popup (R4-24).
function RelSection({ Icon, title, collapsed, onToggle, actions, children }) {
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <div className="rb-rel-section">
      <div className="rb-rel-head">
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="rb-rel-toggle">
          <Chevron aria-hidden="true" className="rb-rel-chevron" />
          <Icon aria-hidden="true" className="rb-rel-glyph" />
          <span className="rb-rel-title">{title}</span>
        </button>
        {actions}
      </div>
      {!collapsed && <div className="rb-rel-body">{children}</div>}
    </div>
  )
}

// ── A row's status, in the two places the row showed it ──
// The kit's dot at the row's start (its tone, from the one STATUS map), and,
// where the row printed a word, the kit's words at its end: Caption, in the
// second ink, where they were 7 and 8px capitals in a status colour. A
// row's dot is hidden from assistive technology when its words say it, as
// StatusBadge hides its own. (The StatusBadge pill, 63 to 137px wide, left a
// shot's name 36 to 110px of the 300px column: measured, B4b.)
function QuietDot({ status }) {
  return <StatusDot status={status} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
}
function StatusWord({ status }) {
  return <span className="rb-rel-status">{statusMeta(status).label}</span>
}

// ── A row's remove control ──
// The kit's small IconButton in the kit's reserved hover slot: it shows on
// the row's hover as it did, and now on keyboard focus too (Q17b) — it used
// to be invisible while it had focus.
function RemoveButton({ title, onClick }) {
  return (
    <HoverActions>
      <IconButton size="sm" Icon={X} danger title={title} onClick={onClick} />
    </HoverActions>
  )
}

// ── The pickers' search field: one field for both (R4-43) ──
// A native field in the kit's small well, as the Assets toolbar's search.
function PickerSearch({ value, onChange, placeholder, label }) {
  return (
    <div className="rb-rel-pick-search">
      <div className="rb-rel-pick-field">
        <Search aria-hidden="true" className="rb-rel-pick-search-icon" />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          autoFocus
          className="ui-input rb-rel-pick-search-input"
          data-size="sm"
        />
      </div>
    </div>
  )
}


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
    <Panel width="lg" side="left" className="rb-rel-panel">
      <div className="rb-rel-list">

        {/* ── Related Assets ── */}
        <RelSection
          Icon={Boxes}
          title={`Assets (${relatedAssets.length})`}
          collapsed={collapsedAssets}
          onToggle={() => setCollapsedAssets(!collapsedAssets)}
          actions={<IconButton size="sm" Icon={Plus} title="Add asset relation" onClick={() => setShowAssetPicker(true)} />}
        >
          {relatedAssets.length === 0 ? (
            <p className="rb-rel-empty">No assets linked</p>
          ) : relatedAssets.map(a => (
            <div key={a.id}
              onClick={() => onOpenAsset?.(a.id)}
              className="rb-rel-row ui-hover-host"
              data-clickable="true">
              <QuietDot status={a.status || 'not_started'} />
              <span className="rb-rel-name" title={a.name || 'Untitled'}>
                {a.name || 'Untitled'}
              </span>
              <StatusWord status={a.status || 'not_started'} />
              <RemoveButton title="Remove relation"
                onClick={e => { e.stopPropagation(); removeAssetRelation(a.id) }} />
            </div>
          ))}
        </RelSection>

        {/* ── Related Tasks ── */}
        <RelSection
          Icon={ListChecks}
          title={`Tasks (${relatedTasks.length})`}
          collapsed={collapsedTasks}
          onToggle={() => setCollapsedTasks(!collapsedTasks)}
          actions={onCreateTask && (
            <IconButton size="sm" Icon={Plus} title="Add new task" onClick={() => onCreateTask()} />
          )}
        >
          {relatedTasks.length === 0 ? (
            <p className="rb-rel-empty">No tasks linked</p>
          ) : relatedTasks.map(t => {
            const linkedAsset = t.asset_id ? assets.find(a => a.id === t.asset_id) : null
            return (
              <div key={t.id}
                onClick={() => onOpenTask?.(t.id)}
                className="rb-rel-row"
                data-clickable="true">
                <QuietDot status={t.status || 'waiting_to_start'} />
                <span className="rb-rel-stack">
                  <span className="rb-rel-name" title={t.title || 'Untitled'}>
                    {t.title || 'Untitled'}
                  </span>
                  {linkedAsset && (
                    <span className="rb-rel-sub">
                      {linkedAsset.name}
                    </span>
                  )}
                </span>
                <StatusWord status={t.status || 'waiting_to_start'} />
              </div>
            )
          })}
        </RelSection>

        {/* No relations at all: the kit's empty state (R4-13) */}
        {relatedAssets.length === 0 && relatedTasks.length === 0 && (
          <EmptyState compact Icon={Boxes} title="No assets or tasks linked yet" />
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
    </Panel>
  )
}


// ═════════════════════════════════════════════════════════
// AssetPickerOverlay — mini-picker for adding assets
// ═════════════════════════════════════════════════════════
// Still the overlay over the sidebar it was (C1: where the picker appears is
// Audrey's call — R4-43's "one Dialog for both" is recorded, not assumed). It
// shares RelationPickerPopup's head, search field, row and empty state, so
// the two read as one component in two shells.
function AssetPickerOverlay({ assets, onPick, onClose }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return assets
    const q = search.toLowerCase()
    return assets.filter(a => (a.name || '').toLowerCase().includes(q))
  }, [assets, search])

  return (
    <div className="rb-rel-pick">
      {/* Header */}
      <div className="rb-rel-pick-head">
        <span className="rb-rel-pick-title">Link asset</span>
        <IconButton size="sm" Icon={X} title="Close" onClick={onClose} />
      </div>

      {/* Search */}
      <PickerSearch value={search} onChange={setSearch} placeholder="Search assets…" label="Search assets" />

      {/* List */}
      <div className="rb-rel-pick-list">
        {filtered.length === 0 ? (
          <EmptyState compact title={assets.length === 0 ? 'All assets already linked' : 'No matches'} />
        ) : (
          filtered.map(a => (
            <button key={a.id} type="button"
              onClick={() => onPick(a.id)}
              className="rb-rel-pick-row">
              <StatusDot status={a.status || 'not_started'} />
              <span className="rb-rel-name">
                {a.name || 'Untitled'}
              </span>
              <Plus aria-hidden="true" className="rb-rel-pick-add" />
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
  // W9: the "Create task …?" question, which was `window.confirm`.
  const [confirming, setConfirming] = useState(false)

  function upd(patch) { setDraft(prev => ({ ...prev, ...patch })) }

  function handleConfirm() {
    if (!draft.title.trim()) return
    setConfirming(true)
  }

  const scenesOn = project?.scenes_enabled
  const levelsOn = project?.levels_enabled
  const experiencesOn = project?.experiences_enabled

  // Filter shots by selected scene
  const shotsForScene = draft.scene_id
    ? shots.filter(s => s.scene_id === draft.scene_id)
    : shots

  return (
    <div className="rb-rel-task">
      {/* Header: the kit Dialog's head, in sentence case */}
      <div className="rb-rel-task-head">
        <span className="rb-rel-task-title">
          <ListChecks aria-hidden="true" className="rb-rel-task-glyph" />
          New task
        </span>
        <IconButton size="sm" Icon={X} title="Close" onClick={onClose} />
      </div>

      {/* Scrollable body: the kit Field (its label the Label step) over a
          native field in the kit's small well, as B2's NewTaskPopup. An
          empty value reads in the third ink; set, in the ink (it was the
          orange). */}
      <div className="rb-rel-task-body ui-field-stack">
        {/* Title */}
        <Field label="Title *">
          <input type="text" value={draft.title} onChange={e => upd({ title: e.target.value })}
            placeholder="Task title…" autoFocus
            className="ui-input"
            data-size="sm" />
        </Field>

        {/* Status + Priority */}
        <div className="rb-rel-task-grid">
          <Field label="Status">
            {/* The kit's dot inside the field, the kit's words in the select:
                the status colour on the text and on every option is gone. */}
            <span className="rb-rel-task-status">
              <StatusDot status={draft.status} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
              <select value={draft.status} onChange={e => upd({ status: e.target.value })}
                className="ui-input rb-rel-task-status-input"
                data-size="sm">
                {TASK_STATUSES_LIST.map(s => <option key={s} value={s}>{statusMeta(s).label}</option>)}
              </select>
            </span>
          </Field>
          <Field label="Priority">
            <select value={draft.priority} onChange={e => upd({ priority: e.target.value })}
              className="ui-input"
              data-size="sm">
              {PRIORITIES_LIST.map(p => <option key={p} value={p}>{fmt(p)}</option>)}
            </select>
          </Field>
        </div>

        {/* Asset + Phase */}
        <div className="rb-rel-task-grid">
          <Field label="Asset">
            <select value={draft.asset_id || ''} onChange={e => upd({ asset_id: e.target.value || null })}
              className="ui-input rb-rel-task-field"
              data-size="sm"
              data-empty={draft.asset_id ? 'false' : 'true'}>
              <option value="">—</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.name || 'Untitled'}</option>)}
            </select>
          </Field>
          <Field label="Phase">
            <select value={draft.phase_id || ''} onChange={e => upd({ phase_id: e.target.value || null })}
              className="ui-input rb-rel-task-field"
              data-size="sm"
              data-empty={draft.phase_id ? 'false' : 'true'}>
              <option value="">—</option>
              {phases.map(p => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
            </select>
          </Field>
        </div>

        {/* Scene / Shot (conditional) */}
        {scenesOn && (
          <div className="rb-rel-task-grid">
            <Field label="Scene">
              <select value={draft.scene_id || ''} onChange={e => upd({ scene_id: e.target.value || null, shot_id: null })}
                className="ui-input rb-rel-task-field"
                data-size="sm"
                data-empty={draft.scene_id ? 'false' : 'true'}
                disabled={entityType === 'scene'}>
                <option value="">—</option>
                {scenes.map(s => <option key={s.id} value={s.id}>{s.name || 'Untitled'}</option>)}
              </select>
            </Field>
            <Field label="Shot">
              <select value={draft.shot_id || ''} onChange={e => upd({ shot_id: e.target.value || null })}
                className="ui-input rb-rel-task-field"
                data-size="sm"
                data-empty={draft.shot_id ? 'false' : 'true'}
                disabled={entityType === 'shot'}>
                <option value="">—</option>
                {shotsForScene.map(s => <option key={s.id} value={s.id}>{s.name || 'Untitled'}</option>)}
              </select>
            </Field>
          </div>
        )}

        {/* Level / Experience (conditional) */}
        {(levelsOn || experiencesOn) && (
          <div className="rb-rel-task-grid">
            {levelsOn && (
              <Field label="Level">
                <select value={draft.level_id || ''} onChange={e => upd({ level_id: e.target.value || null })}
                  className="ui-input rb-rel-task-field"
                  data-size="sm"
                  data-empty={draft.level_id ? 'false' : 'true'}
                  disabled={entityType === 'level'}>
                  <option value="">—</option>
                  {levels.map(l => <option key={l.id} value={l.id}>{l.name || 'Untitled'}</option>)}
                </select>
              </Field>
            )}
            {experiencesOn && (
              <Field label="Experience">
                <select value={draft.experience_id || ''} onChange={e => upd({ experience_id: e.target.value || null })}
                  className="ui-input rb-rel-task-field"
                  data-size="sm"
                  data-empty={draft.experience_id ? 'false' : 'true'}
                  disabled={entityType === 'experience'}>
                  <option value="">—</option>
                  {experiences.map(ex => <option key={ex.id} value={ex.id}>{ex.name || 'Untitled'}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}

        {/* Assignee + Role */}
        <div className="rb-rel-task-grid">
          <Field label="Assignee">
            <select value={draft.assignee_id || ''} onChange={e => upd({ assignee_id: e.target.value || null })}
              className="ui-input rb-rel-task-field"
              data-size="sm"
              data-empty={draft.assignee_id ? 'false' : 'true'}>
              <option value="">—</option>
              {projectMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Role">
            <select value={draft.assigned_role_slug || ''} onChange={e => upd({ assigned_role_slug: e.target.value || null })}
              className="ui-input rb-rel-task-field"
              data-size="sm"
              data-empty={draft.assigned_role_slug ? 'false' : 'true'}>
              <option value="">—</option>
              {roleEntries.map(r => <option key={r.role_slug} value={r.role_slug}>{r.role_label}</option>)}
            </select>
          </Field>
        </div>

        {/* Bid + Dates: the figures in the mono, the dates' picker dark */}
        <div className="rb-rel-task-grid" data-cols="3">
          <Field label="Bid days">
            <input type="number" value={draft.bid_days ?? ''} min={0} step={0.5}
              onChange={e => { const n = parseFloat(e.target.value); upd({ bid_days: isNaN(n) ? null : n }) }}
              className="ui-input rb-rel-task-number"
              data-size="sm"
              placeholder="—" />
          </Field>
          <Field label="Start">
            <input type="date" value={draft.start_date || ''} onChange={e => upd({ start_date: e.target.value || '' })}
              className="ui-input rb-rel-task-field rb-rel-task-date"
              data-size="sm"
              data-empty={draft.start_date ? 'false' : 'true'} />
          </Field>
          <Field label="End">
            <input type="date" value={draft.end_date || ''} onChange={e => upd({ end_date: e.target.value || '' })}
              className="ui-input rb-rel-task-field rb-rel-task-date"
              data-size="sm"
              data-empty={draft.end_date ? 'false' : 'true'} />
          </Field>
        </div>

        {/* Description */}
        <Field label="Description">
          <textarea value={draft.description} onChange={e => upd({ description: e.target.value })}
            rows={3}
            className="ui-input"
            placeholder="Task description…" />
        </Field>
      </div>

      {/* Footer */}
      <div className="rb-rel-task-foot">
        <Button size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={handleConfirm}
          disabled={!draft.title.trim()}>
          Create task
        </Button>
      </div>

      {/* W9 (B4b): the create question, on the kit Dialog — the same words,
          Cancel leaves the draft as it was, Create creates exactly as the
          browser's OK did. 🚨 PORTALLED: the kit Dialog does not portal, and
          this panel is drawn inside other popups' fixed layers. Create takes
          focus, as the browser's OK did, so Enter still creates. */}
      {confirming && createPortal(
        <Dialog
          width="confirm"
          title="Create task"
          onClose={() => setConfirming(false)}
          footer={(
            <>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
              <Button variant="primary" autoFocus onClick={() => { setConfirming(false); onConfirm(draft) }}>
                Create
              </Button>
            </>
          )}
        >
          <p className="rb-rel-confirm">
            {`Create task "${draft.title}"?`}
          </p>
        </Dialog>,
        document.body,
      )}
    </div>
  )
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
    extraSections.push({ key: 'levels', label: 'Levels', icon: Gamepad2, items: relLevels, field: 'level_ids', allItems: levels })
  }
  if (experiencesOn) {
    extraSections.push({ key: 'experiences', label: 'Experiences', icon: Sparkles, items: relExperiences, field: 'experience_ids', allItems: experiences })
  }

  const sceneShotCount = relScenes.length + relShots.length
  const sceneShotCollapsed = collapsed['scenes_shots']

  return (
    <Panel width="lg" side="left" className="rb-rel-panel">
      <div className="rb-rel-list">

        {/* ── Combined Scenes & Shots section ── */}
        {/* Its two link buttons sit after the toggle, where they were, as
            the kit's small IconButtons with one glyph each (they were 10px
            Film+Plus and Clapperboard+Plus pairs in an 18px target, R4-24). */}
        {scenesOn && (
          <RelSection
            Icon={Film}
            title={`Scenes & Shots (${sceneShotCount})`}
            collapsed={sceneShotCollapsed}
            onToggle={() => toggle('scenes_shots')}
            actions={(
              <>
                <IconButton size="sm" Icon={Film} title="Link scene" onClick={() => setShowPicker('scenes')} />
                <IconButton size="sm" Icon={Clapperboard} title="Link shot" onClick={() => setShowPicker('shots')} />
              </>
            )}
          >
            {relScenes.length === 0 && orphanShots.length === 0 ? (
              <p className="rb-rel-empty">No scenes or shots linked</p>
            ) : (
              <>
                {/* Scene rows — each expandable to show child shots */}
                {relScenes.map(sc => {
                  const childShots = shotsByScene[sc.id] || []
                  const isExpanded = expandedScenes.has(sc.id)
                  const hasShots = childShots.length > 0
                  const Chevron = isExpanded ? ChevronDown : ChevronRight
                  return (
                    <div key={sc.id}>
                      {/* Scene row */}
                      <div className="rb-rel-row ui-hover-host">
                        {/* Expand chevron: the button it always was, in every
                            scene row, now named; a scene with no linked
                            shots draws no chevron in it, as before. */}
                        <IconButton size="sm"
                          Icon={hasShots ? Chevron : undefined}
                          title={`Shots in ${sc.name || 'Untitled'}`}
                          aria-expanded={hasShots ? isExpanded : undefined}
                          onClick={() => toggleSceneExpand(sc.id)} />
                        <Film aria-hidden="true" className="rb-rel-glyph" />
                        <StatusDot status={sc.status || 'not_started'} />
                        <span className="rb-rel-name" title={sc.name || 'Untitled'}>
                          {sc.name || 'Untitled'}
                        </span>
                        {hasShots && (
                          <span className="rb-rel-count">
                            {childShots.length}
                          </span>
                        )}
                        <RemoveButton title="Remove scene" onClick={() => removeRelation('scene_ids', sc.id)} />
                      </div>

                      {/* Nested shots: the indent and the hairline spine
                          say the depth; the status is the same size at
                          every depth (R4-25: it was 7px here, 8 above). */}
                      {isExpanded && hasShots && (
                        <div className="rb-rel-nest">
                          {childShots.map(sh => (
                            <div key={sh.id} className="rb-rel-row ui-hover-host">
                              <Clapperboard aria-hidden="true" className="rb-rel-glyph" />
                              <QuietDot status={sh.status || 'not_started'} />
                              <span className="rb-rel-name" title={sh.name || 'Untitled'}>
                                {sh.name || 'Untitled'}
                              </span>
                              <StatusWord status={sh.status || 'not_started'} />
                              <RemoveButton title="Remove shot" onClick={() => removeRelation('shot_ids', sh.id)} />
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
                      <div className="rb-rel-rule" />
                    )}
                    {orphanShots.map(sh => (
                      <div key={sh.id} className="rb-rel-row ui-hover-host">
                        {/* The chevron's slot, held empty */}
                        <span className="rb-rel-slot" />
                        <Clapperboard aria-hidden="true" className="rb-rel-glyph" />
                        <QuietDot status={sh.status || 'not_started'} />
                        <span className="rb-rel-name" title={sh.name || 'Untitled'}>
                          {sh.name || 'Untitled'}
                        </span>
                        <StatusWord status={sh.status || 'not_started'} />
                        <RemoveButton title="Remove shot" onClick={() => removeRelation('shot_ids', sh.id)} />
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </RelSection>
        )}

        {/* ── Levels / Experiences sections ── */}
        {extraSections.map(sec => (
          <RelSection
            key={sec.key}
            Icon={sec.icon}
            title={`${sec.label} (${sec.items.length})`}
            collapsed={collapsed[sec.key]}
            onToggle={() => toggle(sec.key)}
            actions={(
              <IconButton size="sm" Icon={Plus} title={`Add ${sec.label.toLowerCase()} relation`}
                onClick={() => setShowPicker(sec.key)} />
            )}
          >
            {sec.items.length === 0 ? (
              <p className="rb-rel-empty">No {sec.label.toLowerCase()} linked</p>
            ) : sec.items.map(item => (
              <div key={item.id} className="rb-rel-row ui-hover-host">
                <QuietDot status={item.status || 'not_started'} />
                <span className="rb-rel-name" title={item.name || 'Untitled'}>
                  {item.name || 'Untitled'}
                </span>
                <StatusWord status={item.status || 'not_started'} />
                <RemoveButton title="Remove relation" onClick={() => removeRelation(sec.field, item.id)} />
              </div>
            ))}
          </RelSection>
        ))}
      </div>

      {/* Picker popup (the kit Dialog, in <body>) */}
      {showPicker === 'scenes' && (
        <RelationPickerPopup
          title="Link scenes"
          icon={Film}
          items={scenes}
          selectedIds={asset?.scene_ids || []}
          onToggle={id => toggleRelation('scene_ids', id)}
          onClose={() => setShowPicker(null)}
        />
      )}
      {showPicker === 'shots' && (
        <RelationPickerPopup
          title="Link shots"
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
            title={`Link ${sec.label.toLowerCase()}`}
            icon={sec.icon}
            items={sec.allItems}
            selectedIds={asset?.[sec.field] || []}
            onToggle={id => toggleRelation(sec.field, id)}
            onClose={() => setShowPicker(null)}
          />
        )
      })()}
    </Panel>
  )
}


// ═════════════════════════════════════════════════════════
// RelationPickerPopup — modal for managing asset relations
// ═════════════════════════════════════════════════════════
//
// Shows all available items (scenes/shots/levels/experiences)
// with checkboxes for toggling relations on the given asset.
//
// The kit's Dialog (it was a hand-rolled centred modal with its own
// backdrop): its backdrop still closes it, Done still closes it, and the
// kit adds Escape, the focus trap and the modal stack (Q17) — so an Escape
// here closes the picker and not the asset popup under it. 🚨 PORTALLED:
// the kit Dialog does not portal, and the asset popup that opens this
// centres itself with `transform`, which would lay a fixed child out
// inside its box. React events still bubble through the tree it was
// written in.
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

  return createPortal(
    <Dialog
      width="confirm"
      className="rb-rel-picker"
      // A title that is a node names nothing: the dialog carries its title
      // as its name ("Link scenes", in sentence case — Q2).
      aria-label={title}
      title={(
        <span className="rb-rel-pick-title">
          {Icon && <Icon aria-hidden="true" className="rb-rel-pick-glyph" />}
          {title}
          <span className="rb-rel-pick-count">
            ({selectedIds.length} linked)
          </span>
        </span>
      )}
      dismissOnBackdrop
      onClose={onClose}
      footer={(
        <Button onClick={onClose}>
          Done
        </Button>
      )}
    >
      {/* Search */}
      <PickerSearch value={search} onChange={setSearch} placeholder="Search…" label="Search" />

      {/* Items: each row is the toggle it was, and says so (aria-pressed);
          the box is the lane's checkbox glyph, the signal when linked. */}
      <div className="rb-rel-pick-list">
        {filtered.length === 0 ? (
          <EmptyState compact title="No items found" />
        ) : (
          filtered.map(item => {
            const isSelected = selectedSet.has(item.id)
            const Box = isSelected ? CheckSquare : Square
            return (
              <button key={item.id} type="button"
                onClick={() => onToggle(item.id)}
                aria-pressed={isSelected}
                className="rb-rel-pick-row"
                data-selected={isSelected ? 'true' : 'false'}>
                <Box aria-hidden="true" className="rb-rel-pick-check" />
                <QuietDot status={getStatus(item)} />
                <span className="rb-rel-name">
                  {getName(item)}
                </span>
                <StatusWord status={getStatus(item)} />
              </button>
            )
          })
        )}
      </div>
    </Dialog>,
    document.body,
  )
}


// ═════════════════════════════════════════════════════════
// RelationBadge — clickable badge for inline in table rows
// ═════════════════════════════════════════════════════════
// The kit Chip's language in this lane's classes (R4-27): 28px, the
// control radius, the glyph and the count in the tabular mono; ONE active
// treatment — the signal as a tint and an edge, the ink unchanged — when
// anything is linked, and the second ink at rest when nothing is. It names
// itself ("Scenes: 3 linked"). Not the kit Chip: a Chip is a filter and
// announces itself pressed; this opens a picker.
export function RelationBadge({ icon: Icon, count, label, onClick }) {
  const n = count || 0
  const name = label ? `${label}: ${n} linked` : `${n} linked`
  return (
    <button type="button" onClick={onClick}
      title={name}
      aria-label={name}
      className="rb-rel-badge"
      data-active={n > 0 ? 'true' : 'false'}>
      {Icon && <Icon aria-hidden="true" className="rb-rel-badge-glyph" />}
      <span className="rb-rel-badge-count">{n}</span>
    </button>
  )
}
