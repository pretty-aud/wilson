// ============================================================
// RABBIT — the Scenes and Shots tables' descriptions for the custom views
// (VW1e, 2026-10-25)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §6 and its Scenes step (§11 round 6,
// finding 2): her Q16 ("Two lists (Recommended)") — Scenes and Shots each
// have their own list of views, because their fields differ; the content
// tabs choose which one is on screen. These are the two tables'
// descriptions, the Tasks one's twins (tasksTableView.js).
//
// The keys. Scenes: `name` (fixed), `status`, `time_of_day`, `type`,
// `description`, `runtime` and `frames` (sums over the scene's shots, Q12:
// computed columns a view can hide); the nest-only `takes`, `framing`,
// `camera_movement` (the nested shot rows' own columns, finding 7: one list,
// no third); `scene_number` and `created_at`, sorts with no column. Leading
// (her Q-J): `expand`, `thumbnail`, `scene_number`. Shots: `name` (fixed),
// `takes` (while the backend keeps takes), `status`, `time_of_day`, `type`,
// `framing`, `camera_movement`, `description`, `duration`, `frame_count`,
// `start_date`, `end_date`; `scene`, a grouping with no column (*All*'s, a
// shot's one scene, finding 5); `shot_number` and `created_at`, sorts with no
// column. Leading: `thumbnail`, `shot_number`.

import { statusMeta, humanizeStatus } from '../../../../ui'
import { CHOICE_OPS, TEXT_OPS } from './tasksTableView'

export const SCENES_TABLE = 'scenes'
export const SHOTS_TABLE = 'shots'

export const SCENE_STATUSES = Object.freeze([
  'not_started', 'in_progress', 'pending_review', 'needs_revisions',
  'approved', 'final', 'blocked', 'on_hold', 'omitted',
])
export const SCENE_TYPES = Object.freeze(['interior', 'exterior', 'int_ext', 'other'])
export const TIME_OF_DAY_OPTIONS = Object.freeze([
  'day', 'night', 'dawn', 'morning', 'afternoon', 'dusk',
  'evening', 'later', 'moments_later', 'continuous', 'same_time',
])

/** The leading columns (her Q-J: hideable, never movable), in their order. */
const SCENE_LEADING = Object.freeze([
  Object.freeze({ key: 'expand', label: 'Shots arrow' }),
  Object.freeze({ key: 'thumbnail', label: 'Picture' }),
  Object.freeze({ key: 'scene_number', label: 'Number' }),
])
const SHOT_LEADING = Object.freeze([
  Object.freeze({ key: 'thumbnail', label: 'Picture' }),
  Object.freeze({ key: 'shot_number', label: 'Number' }),
])

/** The Gallery cards' own lines (finding 6's rule, built for the Gallery). */
const SCENE_CARD_FIELDS = Object.freeze(['description', 'type', 'time_of_day', 'status', 'runtime'])
// The Shots card's number is a leading column (`cardLeading`), listed here at
// its place on the card, after the description (code review round 1, R1-7).
const SHOT_CARD_FIELDS = Object.freeze(['description', 'shot_number', 'status', 'duration', 'frame_count', 'takes'])

/** The nested shot rows' column for each scene field that has one (finding 7). */
const NEST_OF_SCENE = Object.freeze({
  status: 'status', time_of_day: 'time_of_day', type: 'type', description: 'description', runtime: 'duration', frames: 'frames',
})

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null)
const byNumber = (a, b) => {
  const x = num(a), y = num(b)
  if (x === y) return 0
  if (x === null) return 1
  if (y === null) return -1
  return x - y
}
const plain = (x, y) => (x < y ? -1 : x > y ? 1 : 0)
const indexOf = (list, v, dflt) => { const i = list.indexOf(v || dflt); return i < 0 ? list.length : i }
const labelsOf = (list) => list.map(v => ({ value: v, label: humanizeStatus(v) }))

function frozenFields(list) {
  const fields = list.map(f => Object.freeze({ column: true, ...f }))
  const byKey = new Map(fields.map(f => [f.key, f]))
  return { fields, byKey, field: (key) => (typeof key === 'string' && byKey.has(key) ? byKey.get(key) : null) }
}

/**
 * The Scenes table's columns: each with its CSS width and what it takes at
 * the least (§4.10, finding 8: the name is FIXED here, Description the auto
 * column). `nest` marks a nested shot row's own column (no scene column).
 */
export function scenesTableColumns({ takes = false } = {}) {
  return [
    { key: 'name', label: 'Name', width: 'var(--rb-scene-col-name)', min: 'var(--rb-scene-col-name)' },
    { key: 'status', label: 'Status', width: 'var(--rb-scene-col-status)', min: 'var(--rb-scene-col-status)' },
    { key: 'time_of_day', label: 'Time of day', width: 'var(--rb-scene-col-time)', min: 'var(--rb-scene-col-time)' },
    { key: 'type', label: 'Type', width: 'var(--rb-scene-col-type)', min: 'var(--rb-scene-col-type)' },
    { key: 'description', label: 'Description', min: 'var(--rb-scene-col-desc)', grow: true },
    { key: 'runtime', label: 'Runtime', width: 'var(--rb-scene-col-runtime)', min: 'var(--rb-scene-col-runtime)', numeric: true },
    { key: 'frames', label: 'Frames', width: 'var(--rb-scene-col-frames)', min: 'var(--rb-scene-col-frames)', numeric: true },
    ...(takes ? [{ key: 'takes', label: 'Takes (shots)', nest: true }] : []),
    { key: 'framing', label: 'Framing (shots)', nest: true },
    { key: 'camera_movement', label: 'Camera movement (shots)', nest: true },
  ]
}

/** The Shots table's columns (§4.10: the name fixed, Description the auto column). */
export function shotsTableColumns({ takes = false } = {}) {
  return [
    { key: 'name', label: 'Shot name', width: 'var(--rb-scene-col-name)', min: 'var(--rb-scene-col-name)' },
    ...(takes ? [{ key: 'takes', label: 'Takes', width: 'var(--rb-scene-col-takes)', min: 'var(--rb-scene-col-takes)', title: 'Bin files assigned to the shot; the starred one is the primary take' }] : []),
    { key: 'status', label: 'Status', width: 'var(--rb-scene-col-status)', min: 'var(--rb-scene-col-status)' },
    { key: 'time_of_day', label: 'Time of day', width: 'var(--rb-scene-col-time)', min: 'var(--rb-scene-col-time)' },
    { key: 'type', label: 'Type', width: 'var(--rb-scene-col-type)', min: 'var(--rb-scene-col-type)' },
    { key: 'framing', label: 'Framing', width: 'var(--rb-scene-col-framing)', min: 'var(--rb-scene-col-framing)' },
    { key: 'camera_movement', label: 'Cam move', width: 'var(--rb-scene-col-move)', min: 'var(--rb-scene-col-move)' },
    { key: 'description', label: 'Description', grow: true },
    { key: 'duration', label: 'Duration', width: 'var(--rb-scene-col-runtime)', min: 'var(--rb-scene-col-runtime)', numeric: true },
    { key: 'frame_count', label: 'Frames', width: 'var(--rb-scene-col-frames)', min: 'var(--rb-scene-col-frames)', numeric: true },
    { key: 'start_date', label: 'Start', width: 'var(--rb-scene-col-date)', min: 'var(--rb-scene-col-date)' },
    { key: 'end_date', label: 'End', width: 'var(--rb-scene-col-date)', min: 'var(--rb-scene-col-date)' },
  ]
}

const SCENE_LEAD_WIDTH = Object.freeze({ expand: 'var(--rb-scene-col-expand)', thumbnail: 'var(--rb-scene-col-thumb)', scene_number: 'var(--rb-scene-col-num)' })
const SHOT_LEAD_WIDTH = Object.freeze({ thumbnail: 'var(--rb-scene-col-thumb)', shot_number: 'var(--rb-scene-col-num)' })

/**
 * A table's least width from the columns on screen (§4.10, finding 8): the
 * checkbox, each leading column shown and each column's minimum; `grow` how
 * many growable columns show (Description, or none: the table is then never
 * wider than that sum).
 */
export function sceneTableMin(columns, leadingShown, { shots = false } = {}) {
  const widths = shots ? SHOT_LEAD_WIDTH : SCENE_LEAD_WIDTH
  const lead = Object.keys(widths).filter(k => leadingShown.has(k)).map(k => widths[k])
  const list = (Array.isArray(columns) ? columns : []).filter(c => c && !c.nest)
  const mins = ['var(--rb-scene-col-check)', ...lead, ...list.filter(c => c.min).map(c => c.min)]
  return { min: `calc(${mins.join(' + ')})`, grow: list.filter(c => c.grow).length }
}

// Takes is not here: the sheet's [data-takes] rule adds its width to the nest's.
const NEST_WIDTH = Object.freeze({
  status: 'var(--rb-scene-col-status)', time_of_day: 'var(--rb-scene-col-time)',
  type: 'var(--rb-scene-col-nest-type)', framing: 'var(--rb-scene-col-nest-framing)', camera_movement: 'var(--rb-scene-col-move)',
  duration: 'var(--rb-scene-col-runtime)', frames: 'var(--rb-scene-col-frames)',
})
/** The nested shot rows' columns from the scene view's fields (finding 7), in the nest's own order. */
const NEST_ORDER = Object.freeze(['takes', 'status', 'time_of_day', 'type', 'framing', 'camera_movement', 'description', 'duration', 'frames'])
export function nestColumnsOf(visibleSceneKeys) {
  const shown = new Set()
  for (const k of visibleSceneKeys) {
    if (k === 'takes' || k === 'framing' || k === 'camera_movement') shown.add(k)
    else if (NEST_OF_SCENE[k]) shown.add(NEST_OF_SCENE[k])
  }
  return NEST_ORDER.filter(k => shown.has(k))
}
/** The nest's least width (its static sum's terms, for the cells it shows). */
export function nestMin(nestKeys, leadingShown) {
  const terms = ['var(--rb-scene-col-check)', 'var(--rb-scene-col-mark)']
  if (leadingShown.has('thumbnail')) terms.push('var(--rb-scene-col-nest-thumb)')
  if (leadingShown.has('scene_number')) terms.push('var(--rb-scene-col-nest-num)')
  terms.push('var(--rb-scene-col-nest-name)')
  for (const k of nestKeys) if (NEST_WIDTH[k]) terms.push(NEST_WIDTH[k])
  return `calc(${terms.join(' + ')})`
}

/**
 * The Scenes table's description: the empty sort's word (`defaultOrderLabel`:
 * "List order" while a list is on screen, finding 14), whether the backend
 * keeps takes, and each scene's frames (its shots' sum).
 */
export function scenesDescription({ defaultOrderLabel = 'Default order', takes = false, framesOf = () => 0 } = {}) {
  const columns = scenesTableColumns({ takes })
  const { fields, byKey, field } = frozenFields([
    { key: 'name', label: 'Name', filter: 'text', sortable: true },
    { key: 'status', label: 'Status', filter: 'choice', sortable: true, groupable: true },
    { key: 'time_of_day', label: 'Time of day', filter: 'choice', sortable: true },
    { key: 'type', label: 'Type', filter: 'choice', sortable: true, groupable: true },
    { key: 'description', label: 'Description', filter: 'text' },
    { key: 'runtime', label: 'Runtime', sortable: true },
    { key: 'frames', label: 'Frames', sortable: true },
    ...(takes ? [{ key: 'takes', label: 'Takes (shots)' }] : []),
    { key: 'framing', label: 'Framing (shots)' },
    { key: 'camera_movement', label: 'Camera movement (shots)' },
    { key: 'scene_number', label: 'Scene number', sortable: true, column: false },
    { key: 'created_at', label: 'Created', sortable: true, column: false },
  ])
  function valuesOf(row, key) {
    switch (key) {
      case 'status': return [row.status || 'not_started']
      case 'runtime':
      case 'frames': return [framesOf(row)]
      default: return row[key] == null || row[key] === '' ? [] : [row[key]]
    }
  }
  function compare(key, a, b) {
    switch (key) {
      case 'status': return indexOf(SCENE_STATUSES, a.status, 'not_started') - indexOf(SCENE_STATUSES, b.status, 'not_started')
      case 'type': return indexOf(SCENE_TYPES, a.type, '') - indexOf(SCENE_TYPES, b.type, '')
      case 'time_of_day': return indexOf(TIME_OF_DAY_OPTIONS, a.time_of_day, '') - indexOf(TIME_OF_DAY_OPTIONS, b.time_of_day, '')
      case 'scene_number': return byNumber(a.scene_number, b.scene_number)
      case 'runtime':
      case 'frames': return framesOf(a) - framesOf(b)
      case 'name': return plain(String(a.name || '').toLowerCase(), String(b.name || '').toLowerCase())
      default: return plain(String(a[key] ?? ''), String(b[key] ?? ''))
    }
  }
  function options(key) {
    if (key === 'status') return SCENE_STATUSES.map(s => ({ value: s, label: statusMeta(s).label }))
    if (key === 'type') return labelsOf(SCENE_TYPES)
    if (key === 'time_of_day') return labelsOf(TIME_OF_DAY_OPTIONS)
    return []
  }
  return Object.freeze({
    tableKey: SCENES_TABLE,
    fields,
    field,
    columns,
    fieldKeys: columns.map(c => c.key),
    fixed: ['name'],
    leading: SCENE_LEADING,
    leadingKeys: SCENE_LEADING.map(l => l.key),
    filterFields: ['status', 'type', 'time_of_day', 'name', 'description'].map(k => byKey.get(k)),
    sortFields: fields.filter(f => f.sortable),
    groupFields: fields.filter(f => f.groupable),
    cardFields: SCENE_CARD_FIELDS.filter(k => byKey.has(k)),
    defaultOrderLabel,
    filterOps: (def) => (def?.filter === 'text' ? TEXT_OPS : CHOICE_OPS),
    valuesOf,
    compare,
    options,
    hideEmptyDefault: () => true,
  })
}

/**
 * The Shots table's description: the empty sort's word, whether the backend
 * keeps takes, the scenes the Scene grouping and its filter name (the list
 * on screen's, in its order), and the framing and camera movement choices
 * (`[{ value, label }]`, the table's own lists in ScenesView); `takesOf(shot)`
 * a shot's number of takes, Takes' sort (code review round 1, R1-5: every
 * computed column sorts as a number, §4.7).
 */
export function shotsDescription({ defaultOrderLabel = 'Default order', takes = false, scenes = [], framings = [], movements = [], takesOf = () => 0 } = {}) {
  const columns = shotsTableColumns({ takes })
  const { fields, byKey, field } = frozenFields([
    { key: 'name', label: 'Name', filter: 'text', sortable: true },
    ...(takes ? [{ key: 'takes', label: 'Takes', sortable: true }] : []),
    { key: 'status', label: 'Status', filter: 'choice', sortable: true, groupable: true },
    { key: 'time_of_day', label: 'Time of day', filter: 'choice', sortable: true, groupable: true },
    { key: 'type', label: 'Type', filter: 'choice', sortable: true, groupable: true },
    { key: 'framing', label: 'Framing', filter: 'choice', sortable: true, groupable: true },
    { key: 'camera_movement', label: 'Camera movement', filter: 'choice', sortable: true, groupable: true },
    { key: 'description', label: 'Description', filter: 'text' },
    { key: 'duration', label: 'Duration', sortable: true },
    { key: 'frame_count', label: 'Frames', sortable: true },
    { key: 'start_date', label: 'Start date', short: 'Start' },
    { key: 'end_date', label: 'End date', short: 'End' },
    // *All*'s grouping (finding 5): a shot's one scene, no column.
    { key: 'scene', label: 'Scene', filter: 'choice', groupable: true, column: false },
    { key: 'shot_number', label: 'Shot number', sortable: true, column: false },
    { key: 'created_at', label: 'Created', sortable: true, column: false },
  ])
  function valuesOf(row, key) {
    switch (key) {
      case 'status': return [row.status || 'not_started']
      case 'scene': return row.scene_id ? [row.scene_id] : []
      case 'duration': return [Number(row.frame_count) || 0]
      default: return row[key] == null || row[key] === '' ? [] : [row[key]]
    }
  }
  function compare(key, a, b) {
    switch (key) {
      case 'status': return indexOf(SCENE_STATUSES, a.status, 'not_started') - indexOf(SCENE_STATUSES, b.status, 'not_started')
      case 'type': return indexOf(SCENE_TYPES, a.type, '') - indexOf(SCENE_TYPES, b.type, '')
      case 'time_of_day': return indexOf(TIME_OF_DAY_OPTIONS, a.time_of_day, '') - indexOf(TIME_OF_DAY_OPTIONS, b.time_of_day, '')
      case 'shot_number':
      case 'frame_count': return (Number(a[key]) || 0) - (Number(b[key]) || 0)
      // Duration is the frames' (R1-5); Takes the shot's number of takes.
      case 'duration': return (Number(a.frame_count) || 0) - (Number(b.frame_count) || 0)
      case 'takes': return takesOf(a) - takesOf(b)
      case 'name': return plain(String(a.name || '').toLowerCase(), String(b.name || '').toLowerCase())
      default: return plain(String(a[key] ?? '').toLowerCase(), String(b[key] ?? '').toLowerCase())
    }
  }
  function options(key) {
    if (key === 'status') return SCENE_STATUSES.map(s => ({ value: s, label: statusMeta(s).label }))
    if (key === 'type') return labelsOf(SCENE_TYPES)
    if (key === 'time_of_day') return labelsOf(TIME_OF_DAY_OPTIONS)
    if (key === 'scene') return (Array.isArray(scenes) ? scenes : []).map(s => ({ value: s.id, label: s.name || 'Untitled scene' }))
    if (key === 'framing') return framings
    if (key === 'camera_movement') return movements
    return []
  }
  return Object.freeze({
    tableKey: SHOTS_TABLE,
    fields,
    field,
    columns,
    fieldKeys: columns.map(c => c.key),
    fixed: ['name'],
    leading: SHOT_LEADING,
    leadingKeys: SHOT_LEADING.map(l => l.key),
    // A card's number follows the Number column (her Q-J), listed with its lines.
    cardLeading: ['shot_number'],
    filterFields: ['status', 'type', 'time_of_day', 'framing', 'camera_movement', 'scene', 'name', 'description'].map(k => byKey.get(k)),
    sortFields: fields.filter(f => f.sortable),
    groupFields: fields.filter(f => f.groupable),
    cardFields: SHOT_CARD_FIELDS.filter(k => byKey.has(k)),
    defaultOrderLabel,
    filterOps: (def) => (def?.filter === 'text' ? TEXT_OPS : CHOICE_OPS),
    valuesOf,
    compare,
    options,
    hideEmptyDefault: () => true,
  })
}
