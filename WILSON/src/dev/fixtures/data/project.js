// =============================================================================
// project.js — "Salt Hours", a fourteen-minute short film.
//
// One project, five phases with a timeline, three milestones, fifteen assets,
// forty-two tasks across every status, dependencies, links, comments, asset
// versions, the project roster and two task templates. Column names follow
// supabaseAdapter's COLUMN_ALLOWLIST so a fixture row round-trips through the
// same views a cloud row does.
//
// The calendar: development in August 2026, pre-production to mid September,
// a two-week shoot from 21 September, post through November, delivery by
// 18 December. "Today" in the dataset is 2026-09-11 (ids.js), so the shoot is
// ahead, pre-production is live, and development is done — which is what makes
// the status spread honest rather than random.
// =============================================================================

import { fid, day, stamp, TODAY_OFFSET } from '../ids'
import { placeholder, tintFor } from '../svg'
import { WORKSPACE_ID, MEMBER_ID } from './workspace'

export const PROJECT_ID = fid('project', 1)

export const PROJECT = {
  id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  title: 'Salt Hours',
  description:
    'A fourteen-minute short. Mara returns to the lighthouse her father kept, ' +
    'to close it for the last time, and finds the storm he wrote about in his ' +
    'log has not finished with either of them.',
  status: 'active',
  status_tag: 'Pre-production',
  start_date: day(0),
  end_date: day(137),
  budget_total: 186000,
  budget_currency: 'USD',
  client_name: 'Harbourlight Film Fund',
  cover_image_url: placeholder({ label: 'SALT HOURS', sub: 'a short film', tint: 'sea', w: 640, h: 360 }),
  producer_id: MEMBER_ID.mara,
  director_id: MEMBER_ID.theo,
  budget_contingency_pct: 10,
  budget_agency_pct: 15,
  budget_agency_enabled: true,
  budget_active: true,
  budget_active_version_id: fid('budgetVersion', 2),
  budget_finalized: false,
  scene_separator: '_',
  scene_digits: 2,
  shot_digits: 3,
  scene_start_number: 1,
  fps: 24,
  scenes_enabled: true,
  levels_enabled: false,
  experiences_enabled: false,
  uses_realtime_engine: false,
  engine_type: null,
  created_at: stamp(-14, 9),
  updated_at: stamp(TODAY_OFFSET - 1, 16, 20),
  created_by: MEMBER_ID.mara,
  updated_by: MEMBER_ID.mara,
}

// ── Phases ───────────────────────────────────────────────────────────────────
// Phase colour is DATA the Timeline paints (a hex in a row, like a bin label).

const PHASE_ROWS = [
  // [n, name, startDay, endDay, color, description]
  [1, 'Development',     0,  18, '#a78bfa', 'Script to lock, lookbook, treatment.'],
  [2, 'Pre-production', 21,  46, '#38bdf8', 'Casting, locations, boards, builds.'],
  [3, 'Production',     49,  60, '#fb923c', 'Two weeks on the coast. Six scenes.'],
  [4, 'Post-production',63, 116, '#4ade80', 'Cut, VFX, sound, grade.'],
  [5, 'Delivery',      119, 137, '#f472b6', 'DCP, trailer, festival package.'],
]

export const PHASES = PHASE_ROWS.map(([n, name, s, e, color, description], i) => ({
  id: fid('phase', n),
  project_id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  name,
  description,
  start_date: day(s),
  end_date: day(e),
  sort_order: i,
  color,
  created_at: stamp(-14, 9, 5 + i),
  updated_at: stamp(-14, 9, 5 + i),
}))

export const PHASE_ID = {
  dev: fid('phase', 1), pre: fid('phase', 2), prod: fid('phase', 3), post: fid('phase', 4), delivery: fid('phase', 5),
}

export const MILESTONES = [
  { id: fid('milestone', 1), project_id: PROJECT_ID, name: 'Picture lock', title: 'Picture lock', date: day(95), color: '#4ade80', phase_id: PHASE_ID.post, description: 'No further picture changes after this date.' },
  { id: fid('milestone', 2), project_id: PROJECT_ID, name: 'Final mix', title: 'Final mix', date: day(112), color: '#38bdf8', phase_id: PHASE_ID.post, description: 'Sound mix printed; grade conformed.' },
  { id: fid('milestone', 3), project_id: PROJECT_ID, name: 'Festival submission', title: 'Festival submission', date: day(130), color: '#f472b6', phase_id: PHASE_ID.delivery, description: 'Package uploaded to the first three festivals.' },
]

// ── Assets ───────────────────────────────────────────────────────────────────

const ASSET_ROWS = [
  // [n, name, type, phase, status, startDay, dueDay, tint, description]
  [1,  'Shooting Script v4',   'script',      'dev',      'final',           0,  16, 'ink',   'Locked draft. Fourteen pages, six scenes.'],
  [2,  'Treatment',            'treatment',   'dev',      'final',           0,   9, 'plum',  'Two-page treatment for the fund.'],
  [3,  'Lookbook',             'document',    'dev',      'final',           5,  18, 'sand',  'Palette, references, the light we want.'],
  [4,  'Storyboards',          'storyboard',  'pre',      'approved',       21,  35, 'slate', 'Boards for all sixteen shots.'],
  [5,  'Mara',                 'character',   'pre',      'approved',       21,  40, 'moss',  'Lead. Wardrobe, hair, the coat.'],
  [6,  "Mara's Father",        'character',   'pre',      'pending_review', 21,  40, 'rust',  'Seen in the log, the photograph and one dream.'],
  [7,  'Lighthouse Interior',  'environment', 'pre',      'in_progress',    24,  46, 'sea',   'Studio build: the lamp room and the stair.'],
  [8,  'Cliff Path',           'environment', 'pre',      'in_progress',    24,  44, 'moss',  'Location. Weather-dependent.'],
  [9,  'Harbour Café',         'environment', 'pre',      'not_started',    30,  46, 'sand',  'Location, one afternoon.'],
  [10, 'Brass Compass',        'prop',        'pre',      'final',          21,  33, 'ember', 'Hero prop. Two identical, one weathered.'],
  [11, 'Storm Lantern',        'prop',        'pre',      'needs_revisions',21,  38, 'ember', 'Practical light source; needs a dimmer.'],
  [12, 'Sea Spray Comp',       'vfx',         'post',     'not_started',    63,  98, 'sea',   'Spray and rain over the lamp-room glass, sc 04.'],
  [13, 'Sky Replacement',      'vfx',         'post',     'not_started',    63,  95, 'slate', 'Dusk skies on the boat scene, sc 05.'],
  [14, 'Score & Foley',        'audio',       'post',     'not_started',    70, 112, 'plum',  'Original score; foley for the stair and the door.'],
  [15, 'Festival DCP',         'deliverable', 'delivery', 'not_started',   119, 130, 'ink',   '2K flat DCP, 5.1 and stereo.'],
]

const PHASE_OF = (key) => PHASE_ID[key]

export const ASSETS = ASSET_ROWS.map(([n, name, type, phase, status, s, e, tint, description], i) => ({
  id: fid('asset', n),
  project_id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  phase_id: PHASE_OF(phase),
  name,
  type,
  type_label: null,
  description,
  thumbnail_url: placeholder({ label: name, sub: type, tint, w: 320, h: 180 }),
  status,
  sort_order: i,
  start_date: day(s),
  due_date: day(e),
  task_template_id: null,
  created_at: stamp(-10, 10, i),
  updated_at: stamp(Math.min(TODAY_OFFSET - 2, e), 15, i),
  last_updated_at: stamp(Math.min(TODAY_OFFSET - 2, e), 15, i),
  last_updated_by: MEMBER_ID.mara,
  created_by: MEMBER_ID.mara,
  updated_by: MEMBER_ID.mara,
  deleted_at: null,
  deleted_by: null,
}))

export const ASSET_ID = (n) => fid('asset', n)

// ── Tasks ────────────────────────────────────────────────────────────────────
//
// Forty-two tasks. The status follows the calendar: development tasks are
// final, pre-production is in flight (in progress, in review, one blocked on
// a location permit), the shoot and post are waiting, one delivery task is on
// hold pending the fund's answer and one shot list was omitted when scene 6
// merged into scene 1. Mara (the reviewer) is assignee on nine and reviewer
// on four so the Dashboard has thirteen rows to group and sort.

const M = MEMBER_ID
const TASK_ROWS = [
  // [n, asset, title, status, priority, startDay, endDay, bid, logged, assignee, reviewer, role_slug]
  [1,  1,  'Lock the shooting script',            'final',           'high',   0,  16, 8,   8,   M.theo,  M.mara,  'director'],
  [2,  1,  'Scene numbering pass',                'final',           'low',    14, 16, 1,   1,   M.dev,   M.mara,  'coordinator'],
  [3,  2,  'Write the treatment',                 'final',           'high',   0,   6, 3,   3,   M.theo,  M.mara,  'director'],
  [4,  2,  'Fund submission',                     'final',           'urgent', 7,   9, 1,   1.5, M.mara,  M.theo,  'producer'],
  [5,  3,  'Reference pull',                      'final',           'medium', 5,  11, 3,   3,   M.jonah, M.theo,  'production_designer'],
  [6,  3,  'Lookbook layout',                     'final',           'medium', 12, 18, 3,   4,   M.jonah, M.theo,  'production_designer'],
  [7,  4,  'Thumbnail boards',                    'final',           'high',   21, 27, 4,   4,   M.theo,  M.priya, 'director'],
  [8,  4,  'Clean boards, all shots',             'approved',        'high',   28, 35, 5,   5.5, M.jonah, M.theo,  'production_designer'],
  [9,  4,  'Animatic with scratch track',         'in_progress',     'medium', 33, 42, 4,   2,   M.sofia, M.theo,  'editor'],
  [10, 5,  'Casting sessions',                    'final',           'urgent', 21, 27, 4,   4,   M.mara,  M.theo,  'producer'],
  [11, 5,  'Wardrobe fitting',                    'approved',        'medium', 30, 36, 2,   2,   M.jonah, M.theo,  'production_designer'],
  [12, 5,  'Hair and makeup test',                'pending_review',  'medium', 37, 40, 1,   1,   M.jonah, M.priya, 'production_designer'],
  [13, 6,  'Photograph props: the father',        'pending_review',  'low',    30, 40, 2,   2,   M.jonah, M.theo,  'production_designer'],
  [14, 6,  'Dream sequence lighting test',        'needs_revisions', 'medium', 34, 40, 2,   2.5, M.priya, M.theo,  'dop'],
  [15, 7,  'Lamp-room set drawings',              'approved',        'high',   24, 30, 4,   4,   M.jonah, M.theo,  'production_designer'],
  [16, 7,  'Set build',                           'in_progress',     'urgent', 31, 46, 10,  6,   M.jonah, M.mara,  'production_designer'],
  [17, 7,  'Practical lamp rig',                  'in_progress',     'high',   38, 46, 4,   1,   M.priya, M.jonah, 'dop'],
  [18, 7,  'Glass and rain rig test',             'waiting_to_start','medium', 42, 46, 2,   0,   M.kenji, M.priya, 'vfx_supervisor'],
  [19, 8,  'Location recce',                      'final',           'high',   24, 26, 2,   2,   M.priya, M.theo,  'dop'],
  [20, 8,  'Cliff path permit',                   'blocked',         'urgent', 27, 44, 1,   0.5, M.dev,   M.mara,  'coordinator'],
  [21, 8,  'Weather cover plan',                  'in_progress',     'medium', 35, 44, 1,   0.5, M.dev,   M.mara,  'coordinator'],
  [22, 9,  'Café location agreement',             'waiting_to_start','medium', 40, 46, 1,   0,   M.mara,  M.dev,   'producer'],
  [23, 9,  'Café dressing list',                  'waiting_to_start','low',    42, 46, 1,   0,   M.jonah, M.theo,  'production_designer'],
  [24, 10, 'Source two compasses',                'final',           'medium', 21, 26, 1,   1,   M.jonah, M.theo,  'production_designer'],
  [25, 10, 'Weather one compass',                 'final',           'low',    27, 33, 2,   2,   M.jonah, M.theo,  'production_designer'],
  [26, 11, 'Lantern dimmer wiring',               'needs_revisions', 'high',   30, 38, 2,   3,   M.jonah, M.priya, 'production_designer'],
  [27, 11, 'Lantern flame safety sign-off',       'pending_review',  'urgent', 36, 38, 0.5, 0.5, M.dev,   M.mara,  'coordinator'],
  [28, 12, 'Spray element shoot',                 'waiting_to_start','medium', 63, 67, 2,   0,   M.kenji, M.priya, 'vfx_supervisor'],
  [29, 12, 'Spray comp, sc 04 sh 010–030',        'waiting_to_start','high',   70, 98, 12,  0,   M.kenji, M.theo,  'vfx_supervisor'],
  [30, 13, 'Sky plates',                          'waiting_to_start','medium', 63, 66, 1,   0,   M.priya, M.kenji, 'dop'],
  [31, 13, 'Sky replacement, sc 05',              'waiting_to_start','medium', 75, 95, 8,   0,   M.kenji, M.theo,  'vfx_supervisor'],
  [32, 14, 'Temp score for the assembly',         'waiting_to_start','low',    70, 77, 3,   0,   M.lena,  M.sofia, 'sound_designer'],
  [33, 14, 'Foley: stair, door, log book',        'waiting_to_start','medium', 98, 105, 4,  0,   M.lena,  M.sofia, 'sound_designer'],
  [34, 14, 'Final mix',                           'waiting_to_start','high',   106, 112, 5, 0,   M.lena,  M.theo,  'sound_designer'],
  [35, 15, 'Grade conform',                       'waiting_to_start','high',   113, 118, 3, 0,   M.sofia, M.priya, 'editor'],
  [36, 15, 'DCP build and QC',                    'waiting_to_start','high',   119, 126, 3, 0,   M.sofia, M.mara,  'editor'],
  [37, 15, 'Festival package',                    'on_hold',         'medium', 126, 130, 2, 0,   M.mara,  M.theo,  'producer'],
  [38, 4,  'Shot list, scene 6 (merged)',         'omitted',         'low',    28, 30, 1,   0,   M.theo,  M.mara,  'director'],
  [39, 1,  'Call sheet template',                 'in_progress',     'medium', 38, 46, 1,   0.5, M.dev,   M.mara,  'coordinator'],
  [40, 8,  'Insurance certificate',               'in_progress',     'high',   36, 46, 1,   0.5, M.mara,  M.dev,   'producer'],
  [41, 7,  'Pre-light day',                       'waiting_to_start','high',   47, 48, 1,   0,   M.priya, M.theo,  'dop'],
  [42, 15, 'Trailer cut',                         'waiting_to_start','low',    113, 125, 4, 0,   M.sofia, M.mara,  'editor'],
]

const PRIORITY_OK = new Set(['low', 'medium', 'high', 'urgent'])

export const TASKS = TASK_ROWS.map(([n, asset, title, status, priority, s, e, bid, logged, assignee, reviewer, role], i) => {
  if (!PRIORITY_OK.has(priority)) throw new Error(`[fixtures] bad priority on task ${n}`)
  const a = ASSETS[asset - 1]
  const updatedDay = Math.min(TODAY_OFFSET - (i % 5), e)
  return {
    id: fid('task', n),
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    asset_id: a.id,
    phase_id: a.phase_id,
    title,
    description: `${title} for ${a.name}.`,
    status,
    priority,
    start_date: day(s),
    end_date: day(e),
    bid_days: bid,
    logged_days: logged,
    assigned_position: null,
    assigned_role_slug: role,
    assigned_user_id: assignee,
    assignee_id: assignee,
    reviewer_id: reviewer,
    notes: status === 'blocked' ? 'Waiting on the council. Chased 9 Sep.' : '',
    created_at: stamp(Math.max(-10, s - 7), 9, i),
    updated_at: stamp(updatedDay, 14, i),
    last_updated_at: stamp(updatedDay, 14, i),
    last_updated_by: assignee,
    created_by: MEMBER_ID.mara,
    updated_by: assignee,
    deleted_at: null,
    deleted_by: null,
  }
})

export const TASK_ID = (n) => fid('task', n)

// ── Dependencies: task→task edges and phase→phase edges (0061) ───────────────

const TASK_EDGES = [
  // [n, predecessorTask, successorTask]
  [1, 1, 7], [2, 7, 8], [3, 8, 9], [4, 15, 16], [5, 16, 17], [6, 17, 41],
  [7, 19, 20], [8, 28, 29], [9, 30, 31], [10, 34, 35], [11, 35, 36],
]
const PHASE_EDGES = [
  // [n, predecessorPhase, successorPhase]
  [12, 1, 2], [13, 2, 3], [14, 3, 4], [15, 4, 5],
]

export const DEPENDENCIES = [
  ...TASK_EDGES.map(([n, p, s]) => ({
    id: fid('dependency', n), predecessor_id: fid('task', p), successor_id: fid('task', s),
    type: 'FS', lag_days: 0, kind: 'task', created_at: stamp(-9, 11, n), updated_at: stamp(-9, 11, n),
  })),
  ...PHASE_EDGES.map(([n, p, s]) => ({
    id: fid('dependency', n), predecessor_id: fid('phase', p), successor_id: fid('phase', s),
    type: 'FS', lag_days: 0, kind: 'phase', created_at: stamp(-9, 11, n), updated_at: stamp(-9, 11, n),
  })),
]

export const TASK_LINKS = [
  { id: fid('link', 1), task_id: fid('task', 20), label: 'Council permits portal', url: 'https://permits.example/coast/apply', created_at: stamp(28, 10) },
  { id: fid('link', 2), task_id: fid('task', 16), label: 'Set build drawings (shared drive)', url: 'https://drive.example/salt-hours/set-build', created_at: stamp(31, 10) },
  { id: fid('link', 3), task_id: fid('task', 9),  label: 'Animatic review link', url: 'https://review.example/salt-hours/animatic-v2', created_at: stamp(38, 10) },
]

// ── Comments, asset versions, edit history ──────────────────────────────────

export const COMMENTS = [
  { id: fid('comment', 1), entity_type: 'task', entity_id: fid('task', 20), body: 'Council says two weeks minimum. We should plan the cliff scenes for the second week.', author_name: 'Dev Patel', author_user_id: M.dev, created_at: stamp(34, 15, 10) },
  { id: fid('comment', 2), entity_type: 'task', entity_id: fid('task', 20), body: 'Agreed. Moving sc 02 and sc 06 to days 8–9.', author_name: 'Mara Okonkwo', author_user_id: M.mara, created_at: stamp(34, 16, 2) },
  { id: fid('comment', 3), entity_type: 'task', entity_id: fid('task', 26), body: 'The dimmer buzzes at low settings. Trying a different driver.', author_name: 'Jonah Beck', author_user_id: M.jonah, created_at: stamp(37, 11, 40) },
  { id: fid('comment', 4), entity_type: 'asset', entity_id: fid('asset', 7), body: 'Stair tread depth is 240 — Priya, is that enough for the dolly?', author_name: 'Jonah Beck', author_user_id: M.jonah, created_at: stamp(36, 9, 15) },
  { id: fid('comment', 5), entity_type: 'asset', entity_id: fid('asset', 7), body: 'Yes if we lose the handrail on the camera side for sh 040.', author_name: 'Priya Raman', author_user_id: M.priya, created_at: stamp(36, 9, 48) },
  { id: fid('comment', 6), entity_type: 'task', entity_id: fid('task', 9), body: 'v2 has the new opening. Scratch VO is Theo, do not judge it.', author_name: 'Sofia Aldana', author_user_id: M.sofia, created_at: stamp(38, 17, 5) },
]

export const ASSET_VERSIONS = [
  { id: fid('version', 1), asset_id: fid('asset', 1), version_no: 1, notes: 'First draft', thumbnail_url: null, file_id: null, created_at: stamp(0, 12) },
  { id: fid('version', 2), asset_id: fid('asset', 1), version_no: 2, notes: 'Fund notes addressed', thumbnail_url: null, file_id: null, created_at: stamp(8, 12) },
  { id: fid('version', 3), asset_id: fid('asset', 1), version_no: 3, notes: 'Scene 6 folded into scene 1', thumbnail_url: null, file_id: null, created_at: stamp(13, 12) },
  { id: fid('version', 4), asset_id: fid('asset', 1), version_no: 4, notes: 'Locked', thumbnail_url: null, file_id: null, created_at: stamp(16, 12) },
  { id: fid('version', 5), asset_id: fid('asset', 4), version_no: 1, notes: 'Thumbnails', thumbnail_url: placeholder({ label: 'Boards v1', tint: tintFor(3) }), file_id: null, created_at: stamp(27, 12) },
  { id: fid('version', 6), asset_id: fid('asset', 4), version_no: 2, notes: 'Clean boards', thumbnail_url: placeholder({ label: 'Boards v2', tint: tintFor(3) }), file_id: null, created_at: stamp(35, 12) },
]

/** Trigger-captured history (0012) for the drawer: newest first per entity. */
export const EDIT_HISTORY = [
  { id: fid('history', 1), entity_type: 'task', entity_id: fid('task', 26), action: 'update', diff: { status: { from: 'in_progress', to: 'needs_revisions' } }, changed_by: M.priya, changed_by_name: 'Priya Raman', created_at: stamp(37, 12, 5) },
  { id: fid('history', 2), entity_type: 'task', entity_id: fid('task', 26), action: 'update', diff: { logged_days: { from: 2, to: 3 } }, changed_by: M.jonah, changed_by_name: 'Jonah Beck', created_at: stamp(36, 18, 0) },
  { id: fid('history', 3), entity_type: 'task', entity_id: fid('task', 26), action: 'create', diff: null, changed_by: M.mara, changed_by_name: 'Mara Okonkwo', created_at: stamp(23, 10, 0) },
  { id: fid('history', 4), entity_type: 'task', entity_id: fid('task', 20), action: 'update', diff: { status: { from: 'in_progress', to: 'blocked' } }, changed_by: M.dev, changed_by_name: 'Dev Patel', created_at: stamp(34, 15, 0) },
  { id: fid('history', 5), entity_type: 'asset', entity_id: fid('asset', 11), action: 'update', diff: { status: { from: 'in_progress', to: 'needs_revisions' } }, changed_by: M.priya, changed_by_name: 'Priya Raman', created_at: stamp(37, 12, 6) },
]

// ── The roster ───────────────────────────────────────────────────────────────

const ROSTER = [
  [M.mara,  'manager',  'Producer'],
  [M.theo,  'manager',  'Director'],
  [M.priya, 'member',   'Director of Photography'],
  [M.jonah, 'member',   'Production Designer'],
  [M.sofia, 'member',   'Editor'],
  [M.kenji, 'manager',  'VFX Supervisor'],
  [M.lena,  'member',   'Sound Designer'],
  [M.dev,   'reviewer', 'Production Coordinator'],
]

export const PROJECT_MEMBERS = ROSTER.map(([user_id, project_role, project_title], i) => ({
  project_id: PROJECT_ID,
  user_id,
  workspace_id: WORKSPACE_ID,
  project_role,
  project_title,
  created_at: stamp(-12, 10, i),
  created_by: M.mara,
  updated_at: stamp(-12, 10, i),
  updated_by: M.mara,
}))

// ── Task templates (0044) ────────────────────────────────────────────────────

export const TASK_TEMPLATES = [
  {
    id: fid('template', 1), workspace_id: WORKSPACE_ID, project_id: null,
    name: 'Environment build',
    description: 'Drawings, build, dress, pre-light.',
    tasks: [
      { title: 'Set drawings', bid_days: 3, role_slug: 'production_designer' },
      { title: 'Build', bid_days: 8, role_slug: 'production_designer' },
      { title: 'Dressing', bid_days: 2, role_slug: 'production_designer' },
      { title: 'Pre-light', bid_days: 1, role_slug: 'dop' },
    ],
    created_at: stamp(-40, 10), updated_at: stamp(-40, 10), created_by: M.mara, updated_by: M.mara,
  },
  {
    id: fid('template', 2), workspace_id: WORKSPACE_ID, project_id: PROJECT_ID,
    name: 'VFX shot',
    description: 'Plates, comp, review, final.',
    tasks: [
      { title: 'Plates', bid_days: 1, role_slug: 'dop' },
      { title: 'Comp', bid_days: 6, role_slug: 'vfx_supervisor' },
      { title: 'Director review', bid_days: 0.5, role_slug: 'director' },
      { title: 'Final', bid_days: 1, role_slug: 'vfx_supervisor' },
    ],
    created_at: stamp(-5, 10), updated_at: stamp(-5, 10), created_by: M.kenji, updated_by: M.kenji,
  },
]
