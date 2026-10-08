// =============================================================================
// scenes.js — six scenes, sixteen shots, one footage location, seven bins,
// sixteen bin files (one a frame sequence), nine takes, two shot lists (one
// active, one archived) and no edits. The bin rows follow docs/BINS_DESIGN.md
// §4.4 in the CLOUD shape of migration 0091 (a location plus a relative path,
// never an absolute path); `online` is the list route's computed flag and is
// true for every fixture file (there is no disk behind them — the posters are
// the SVG placeholders, and `probe_status` is 'done' so the renderer's own
// probe never runs on them).
// =============================================================================

import { fid, day, stamp } from '../ids'
import { placeholder } from '../svg'
import { WORKSPACE_ID, MEMBER_ID } from './workspace'
import { PROJECT_ID } from './project'

const SCENE_ROWS = [
  // [n, name, number, status, type, time_of_day, startDay, endDay, tint, description]
  [1, 'Lighthouse, dawn',   1, 'final',           'interior', 'dawn',      49, 50, 'sea',   'Mara lets herself in. The lamp is cold.'],
  [2, 'Cliff path',         2, 'approved',        'exterior', 'day',       57, 58, 'moss',  'The walk up. Wind. She finds the compass.'],
  [3, 'Harbour café',       3, 'in_progress',     'interior', 'afternoon', 52, 52, 'sand',  'The one conversation in the film.'],
  [4, 'The storm',          4, 'in_progress',     'int_ext',  'night',     53, 55, 'slate', 'Rain on the glass. The log book entry.'],
  [5, "Father's boat",      5, 'pending_review',  'exterior', 'dusk',      56, 56, 'ember', 'Dream. The boat that was never found.'],
  [6, 'Salt hours',         6, 'not_started',     'exterior', 'dawn',      59, 60, 'plum',  'She lights the lamp once, then leaves.'],
]

export const SCENES = SCENE_ROWS.map(([n, name, scene_number, status, type, time_of_day, s, e, tint, description], i) => ({
  id: fid('scene', n),
  project_id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  name,
  description,
  notes: '',
  scene_number,
  status,
  type,
  time_of_day,
  thumbnail_image: placeholder({ label: `SC ${String(scene_number).padStart(2, '0')}`, sub: name, tint }),
  start_date: day(s),
  end_date: day(e),
  sort_order: i,
  created_at: stamp(20, 10, i),
  created_by: MEMBER_ID.theo,
  updated_at: stamp(38, 10, i),
  updated_by: MEMBER_ID.theo,
}))

const SHOT_ROWS = [
  // [n, scene, number, name, status, framing, camera_movement (null = no movement), frames, description]
  [1,  1, 10, 'The door',            'final',          'WS',  'TILT', 240, 'Mara in the doorway, the stair behind.'],
  [2,  1, 20, 'The cold lamp',       'final',          'CU',  null,   120, 'Insert. Her hand on the lens housing.'],
  [3,  1, 30, 'Up the stair',        'final',          'MS',  'HANDHELD', 360, 'Following her up.'],
  [4,  2, 10, 'The path, wide',      'approved',       'EWS', 'CRANE UP', 288, 'Cliff, sea, one figure.'],
  [5,  2, 20, 'The compass',         'approved',       'CU',  null,   96,  'In the grass. She picks it up.'],
  [6,  2, 30, 'Turn to the sea',     'in_progress',    'MS',  'PAN',      192, 'She reads the needle.'],
  [7,  3, 10, 'Two-shot',            'in_progress',    'MS',  'DOLLY IN', 720, 'The whole conversation, one angle.'],
  [8,  3, 20, 'Her side',            'in_progress',    'MCU', null,   480, 'Coverage.'],
  [9,  3, 30, 'His side',            'not_started',     'MCU',null,   480, 'Coverage.'],
  [10, 4, 10, 'Rain on the glass',   'in_progress',    'CU',  null,   240, 'VFX: spray and rain over the lamp-room glass.'],
  [11, 4, 20, 'The log book',        'in_progress',    'CU',  'PUSH IN',    336, 'Push in on the entry.'],
  [12, 4, 30, 'Lightning, wide',     'blocked',        'WS',  null,   96,  'Needs the interactive light rig.'],
  [13, 5, 10, 'The boat',            'pending_review', 'WS',  'STEADICAM', 240, 'Dream. Sky replacement.'],
  [14, 5, 20, 'Father at the tiller','pending_review', 'MS',  'HANDHELD', 192, 'He does not look at camera.'],
  [15, 6, 10, 'The lamp lights',     'not_started',    'CU',  null,   144, 'Once.'],
  [16, 6, 20, 'She leaves',          'not_started',    'EWS', 'PULL OUT', 360, 'Last shot. Dawn.'],
]

export const SHOTS = SHOT_ROWS.map(([n, scene, shot_number, name, status, framing, camera_movement, frame_count, description], i) => {
  const sc = SCENES[scene - 1]
  return {
    id: fid('shot', n),
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    scene_id: sc.id,
    name,
    description,
    notes: '',
    shot_number,
    status,
    type: sc.type,
    time_of_day: sc.time_of_day,
    framing,
    camera_movement,
    frame_count,
    thumbnail_image: null,
    start_date: sc.start_date,
    end_date: sc.end_date,
    sort_order: i,
    created_at: stamp(21, 10, i),
    created_by: MEMBER_ID.theo,
    updated_at: stamp(38, 11, i),
    updated_by: MEMBER_ID.theo,
  }
})

// ── Bins ─────────────────────────────────────────────────────────────────────
//
// Bins on the cloud (BC1, migration 0091; Audrey's B1/B2): a clip is a
// REFERENCE — a footage LOCATION (the company's share, saved by its network
// address and named) plus a path inside it — never a copy, never one
// machine's absolute path. These rows are the CLOUD shape the fake cloud
// serves (location_id + relative_path, poster_path); the signed-out
// desktop's absolute source_path and its known roots (binRoots) have no place
// in it, so BIN_ROOTS is empty (B12: the desktop keeps its own, untouched).
// Posters were made while the company's remote-viewing switch was on
// (data/workspace.js), as a real company's would have been.

export const BIN_LOCATIONS = [
  { id: fid('binLocation', 1), workspace_id: WORKSPACE_ID, name: 'Footage NAS', unc_path: '\\\\salthours-nas\\footage', added_by: MEMBER_ID.sofia, created_at: stamp(30, 9), updated_at: stamp(30, 9) },
]
export const LOCATION_ID = BIN_LOCATIONS[0].id

export const BINS = [
  { id: fid('bin', 1), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: 'Footage',    description: 'Camera originals by shoot day.', kind: 'footage', color: null,     parent_bin_id: null,          sort_order: 0, created_at: stamp(30, 9), created_by: MEMBER_ID.sofia, updated_at: stamp(30, 9), updated_by: MEMBER_ID.sofia },
  { id: fid('bin', 2), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: 'Day 1',      description: 'Lighthouse interior.',          kind: 'footage', color: 'blue',   parent_bin_id: fid('bin', 1), sort_order: 0, created_at: stamp(30, 9, 1), created_by: MEMBER_ID.sofia, updated_at: stamp(30, 9, 1), updated_by: MEMBER_ID.sofia },
  { id: fid('bin', 3), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: 'Day 2',      description: 'Café and the storm.',           kind: 'footage', color: 'cyan',   parent_bin_id: fid('bin', 1), sort_order: 1, created_at: stamp(30, 9, 2), created_by: MEMBER_ID.sofia, updated_at: stamp(30, 9, 2), updated_by: MEMBER_ID.sofia },
  { id: fid('bin', 4), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: 'Audio',      description: 'Location sound, slated.',      kind: 'audio',   color: 'green',  parent_bin_id: null,          sort_order: 1, created_at: stamp(30, 9, 3), created_by: MEMBER_ID.lena,  updated_at: stamp(30, 9, 3), updated_by: MEMBER_ID.lena },
  { id: fid('bin', 5), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: 'Stills',     description: 'Set photography.',             kind: 'stills',  color: 'yellow', parent_bin_id: null,          sort_order: 2, created_at: stamp(30, 9, 4), created_by: MEMBER_ID.jonah, updated_at: stamp(30, 9, 4), updated_by: MEMBER_ID.jonah },
  // BC1: two more — a third shoot day under Footage, and the VFX plates.
  { id: fid('bin', 6), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: 'Day 3',      description: 'The lamp room, lightning.',    kind: 'footage', color: 'purple', parent_bin_id: fid('bin', 1), sort_order: 2, created_at: stamp(33, 9), created_by: MEMBER_ID.sofia, updated_at: stamp(33, 9), updated_by: MEMBER_ID.sofia },
  { id: fid('bin', 7), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: 'VFX plates', description: 'Rendered plates from Kenji.',  kind: 'vfx',     color: null,     parent_bin_id: null,          sort_order: 3, created_at: stamp(33, 9, 1), created_by: MEMBER_ID.kenji, updated_at: stamp(33, 9, 1), updated_by: MEMBER_ID.kenji },
]

// The signed-out desktop's known roots have no cloud shape (B12).
export const BIN_ROOTS = []

// The folder inside the location each bin's files sit in.
const BIN_FOLDER = { 2: 'A001', 3: 'A002', 4: 'SOUND', 5: 'STILLS', 6: 'A003', 7: 'VFX' }

const BIN_FILE_ROWS = [
  // [n, bin, name, ext, media_type, scene, shot, slate, take, camera, roll, dur, w, h, fps, codec, review_flag, color, circled, tint]
  [1,  2, 'A001_C001_0921AB', '.mov', 'video', 1, 1,  '1A', 1, 'A', 'A001', 14.5, 3840, 2160, 24, 'ProRes 422 HQ', 'select',    'green',  true,  'sea'],
  [2,  2, 'A001_C002_0921AB', '.mov', 'video', 1, 1,  '1A', 2, 'A', 'A001', 15.1, 3840, 2160, 24, 'ProRes 422 HQ', 'unflagged', null,     false, 'sea'],
  [3,  2, 'A001_C003_0921AB', '.mov', 'video', 1, 2,  '1B', 1, 'A', 'A001', 6.0,  3840, 2160, 24, 'ProRes 422 HQ', 'select',    null,     false, 'sea'],
  [4,  2, 'A001_C004_0921AB', '.mov', 'video', 1, 3,  '1C', 1, 'A', 'A001', 18.2, 3840, 2160, 24, 'ProRes 422 HQ', 'reject',    'red',    false, 'sea'],
  [5,  2, 'A001_C005_0921AB', '.mov', 'video', 1, 3,  '1C', 2, 'A', 'A001', 17.7, 3840, 2160, 24, 'ProRes 422 HQ', 'select',    'green',  true,  'sea'],
  [6,  3, 'A002_C001_0924AB', '.mov', 'video', 3, 7,  '3A', 1, 'A', 'A002', 31.0, 3840, 2160, 24, 'ProRes 422 HQ', 'unflagged', null,     false, 'sand'],
  [7,  3, 'A002_C002_0924AB', '.mov', 'video', 3, 7,  '3A', 2, 'A', 'A002', 30.4, 3840, 2160, 24, 'ProRes 422 HQ', 'select',    'green',  true,  'sand'],
  [8,  3, 'A002_C007_0925AB', '.mov', 'video', 4, 11, '4B', 1, 'A', 'A002', 14.0, 3840, 2160, 24, 'ProRes 422 HQ', 'select',    null,     false, 'slate'],
  [9,  3, 'A002_C008_0925AB', '.mov', 'video', 4, 11, '4B', 3, 'A', 'A002', 14.3, 3840, 2160, 24, 'ProRes 422 HQ', 'unflagged', 'orange', false, 'slate'],
  [10, 4, 'SH_1A_T01',        '.bwf', 'audio', 1, 1,  '1A', 1, null, 'S001', 14.9, null, null, null, 'PCM 24/48',  'unflagged', null,     false, 'moss'],
  [11, 4, 'SH_3A_T02',        '.bwf', 'audio', 3, 7,  '3A', 2, null, 'S001', 30.6, null, null, null, 'PCM 24/48',  'select',    null,     false, 'moss'],
  [12, 5, 'lamp_room_dressed','.png', 'still', 1, null, null, null, null, null, null, 4000, 2667, null, 'PNG',      'select',    'yellow', false, 'ember'],
  // BC1: four more — two Day 3 clips (one the take on "Lightning, wide"), a
  // frame SEQUENCE (one row for the folder) and a still.
  [13, 6, 'A003_C001_0927AB', '.mov', 'video', 4, 12, '4C', 1, 'A', 'A003', 22.0, 3840, 2160, 24, 'ProRes 422 HQ', 'select',    'green',  true,  'slate'],
  [14, 6, 'A003_C002_0927AB', '.mov', 'video', 4, 12, '4C', 2, 'A', 'A003', 21.4, 3840, 2160, 24, 'ProRes 422 HQ', 'unflagged', null,     false, 'slate'],
  [15, 7, 'storm_plate_v01',  '.exr', 'sequence', 4, 10, null, null, null, null, 10.0, 4096, 2160, 24, 'EXR',       'unflagged', null,     false, 'ember'],
  [16, 5, 'cafe_window_dressed', '.png', 'still', 3, null, null, null, null, null, null, 4000, 2667, null, 'PNG',   'unflagged', null,     false, 'sand'],
]

const posterKey = (n, name) => `projects/${PROJECT_ID}/bin_files/${fid('binFile', n)}/${1757548800000 + n}-${name}.jpg`

export const BIN_FILES = BIN_FILE_ROWS.map(([n, bin, name, extension, media_type, scene, shot, slate, take_number, camera, roll, duration_sec, width, height, fps, codec, review_flag, color, circled, tint], i) => {
  const is_sequence = media_type === 'sequence'
  return {
    id: fid('binFile', n),
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    bin_id: fid('bin', bin),
    // The cloud shape (0091): where the file sits, as the company's share
    // plus a path inside it, forward slashes; a sequence names its FOLDER.
    location_id: LOCATION_ID,
    relative_path: `${BIN_FOLDER[bin]}/${name}${is_sequence ? '' : extension}`,
    display_name: name,
    original_name: `${name}${is_sequence ? '' : extension}`,
    extension,
    mime_type: media_type === 'video' ? 'video/quicktime' : media_type === 'audio' ? 'audio/wav' : media_type === 'still' ? 'image/png' : media_type === 'sequence' ? 'image/x-exr' : null,
    is_sequence,
    sequence_pattern: is_sequence ? `${name}.####${extension}` : null,
    frame_count: duration_sec && fps ? Math.round(duration_sec * fps) : null,
    size_bytes: media_type === 'video' ? Math.round(duration_sec * 110 * 1024 * 1024) : media_type === 'audio' ? Math.round(duration_sec * 288000) : media_type === 'sequence' ? 240 * 24 * 1024 * 1024 : 9_400_000,
    mtime: stamp(49 + (bin === 3 ? 3 : bin === 6 || bin === 7 ? 6 : 0), 12, i),
    media_type,
    tags: media_type === 'video' ? ['camera-original'] : media_type === 'audio' ? ['location'] : media_type === 'sequence' ? ['plate', 'vfx'] : ['set-photo'],
    scene_id: scene ? fid('scene', scene) : null,
    shot_id: shot ? fid('shot', shot) : null,
    slate,
    take_number,
    take_modifier: null,
    camera,
    roll,
    shoot_day: day(49 + (bin === 3 ? 3 : bin === 6 || bin === 7 ? 6 : 0)),
    description: '',
    notes: review_flag === 'reject' ? 'Boom in shot at 00:00:09.' : '',
    review_flag,
    circled,
    color,
    duration_sec,
    width,
    height,
    fps,
    codec,
    timecode_start: media_type === 'still' || media_type === 'sequence' ? null : `0${9 + (i % 8)}:${String(10 + i * 3).padStart(2, '0')}:00:00`,
    probe_status: 'done',
    sort_order: i,
    // The picture's key in rabbit-thumbnails (0091's shape): the fake cloud
    // serves the SVG placeholder for it.
    poster_path: posterKey(n, name),
    added_by: bin === 7 ? MEMBER_ID.kenji : MEMBER_ID.sofia,
    added_at: stamp(51 + (bin === 3 ? 3 : bin === 6 || bin === 7 ? 6 : 0), 20, i),
    updated_at: stamp(52 + (bin === 3 ? 3 : bin === 6 || bin === 7 ? 6 : 0), 10, i),
    online: true,
    // Not a column. The fixtures adapter serves this as the poster.
    __poster: placeholder({ label: name, sub: `${slate ? `slate ${slate} · take ${take_number}` : media_type}`, tint, w: 320, h: 180 }),
  }
})

// Takes: one primary per shot, a part and an alt where the shoot gave options.
const TAKE_ROWS = [
  // [n, shot, binFile, role, position]
  [1, 1,  1, 'primary', 0],
  [2, 1,  2, 'alt',     1],
  [3, 2,  3, 'primary', 0],
  [4, 3,  5, 'primary', 0],
  [5, 3,  4, 'alt',     1],
  [6, 7,  7, 'primary', 0],
  [7, 7,  6, 'part',    1],
  [8, 11, 8, 'primary', 0],
  // BC1: the Day 3 clip cut into "Lightning, wide".
  [9, 12, 13, 'primary', 0],
]

export const SHOT_TAKES = TAKE_ROWS.map(([n, shot, file, role, position]) => ({
  id: fid('take', n),
  project_id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  shot_id: fid('shot', shot),
  bin_file_id: fid('binFile', file),
  role,
  position,
  notes: role === 'alt' ? 'Keep for the trailer.' : '',
  created_at: stamp(55, 14, n),
  updated_at: stamp(55, 14, n),
}))

// ── Shot lists and edits (post-overhaul S3a, migration 0084) ────────────────
// A list is MEMBERSHIP, not copies (D1 + D3): each item names ONE scene or ONE
// shot row, and the rows themselves are shared by every list. Scene items
// order a list's scenes; shot items order the shots WITHIN their scene,
// restarting at 0 per scene (and for the unlinked bucket).
//
// List 1 is exactly what 0084's D11 backfill writes for this project: "Shot
// list 1 · v1", every scene and every shot in today's order, ACTIVE
// (PROJECT.active_shot_list_id in project.js). created_by is null because the
// backfill runs as the migration, with no signed-in user. List 2 is an
// ARCHIVED second-unit pickups list (D4: archived, never deleted), so the
// archive / restore / "set active refuses an archived list" paths have a row
// to act on. No edit is seeded (D11 creates none).
//
// The ordering restates shotListModel.js's compareScenesForList /
// compareShotsForList (0084's backfill ORDER BY: number nulls last, then
// sort_order, created_at, id) because devFixtures.test.js allow-lists what
// src/dev may import — the byMilestoneDate precedent in rabbitFixturesAdapter.

function cmpNullsLast(a, b) {
  const an = a === null || a === undefined || a === ''
  const bn = b === null || b === undefined || b === ''
  if (an && bn) return 0
  if (an) return 1
  if (bn) return -1
  return Number(a) - Number(b)
}
function cmpText(a, b) {
  const x = a == null ? '' : String(a)
  const y = b == null ? '' : String(b)
  return x < y ? -1 : x > y ? 1 : 0
}
const listOrder = (numberKey) => (a, b) => cmpNullsLast(a[numberKey], b[numberKey])
  || cmpNullsLast(a.sort_order, b.sort_order)
  || cmpText(a.created_at, b.created_at)
  || cmpText(a.id, b.id)

/**
 * One list's items for these scenes and shots, in backfillItems() order:
 * scenes first (position = scene order), then each scene's shots (position
 * restarts at 0), then the unlinked bucket. Item ids count up from `firstN`.
 */
function listItems({ listId, scenes, shots, firstN, at, by }) {
  const rows = []
  let n = firstN
  const push = (scene_id, shot_id, position) => rows.push({
    id: fid('shotListItem', n++),
    shot_list_id: listId,
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    scene_id,
    shot_id,
    position,
    created_at: at,
    created_by: by,
    updated_at: at,
    updated_by: by,
  })
  const ordered = [...scenes].sort(listOrder('scene_number'))
  ordered.forEach((s, i) => push(s.id, null, i))
  for (const s of ordered) {
    shots.filter(sh => sh.scene_id === s.id).sort(listOrder('shot_number')).forEach((sh, i) => push(null, sh.id, i))
  }
  shots.filter(sh => !sh.scene_id).sort(listOrder('shot_number')).forEach((sh, i) => push(null, sh.id, i))
  return rows
}

const LIST_1_AT = stamp(22, 9)
const LIST_2_AT = stamp(31, 15)
const LIST_2_ARCHIVED_AT = stamp(37, 11, 30)
const PICKUP_SCENES = SCENES.filter(s => s.scene_number === 3 || s.scene_number === 5)
const PICKUP_SCENE_IDS = new Set(PICKUP_SCENES.map(s => s.id))

export const SHOT_LISTS = [
  {
    id: fid('shotList', 1),
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    title: 'Shot list 1',
    version: 1,
    summary: 'Created from existing scenes',
    snapshot: {},
    archived_at: null,
    archived_by: null,
    created_at: LIST_1_AT,
    created_by: null,
    updated_at: LIST_1_AT,
    updated_by: null,
  },
  {
    id: fid('shotList', 2),
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    title: 'Pickups',
    version: 1,
    summary: 'Scenes 3 and 5, second unit',
    snapshot: {},
    // Archived by Mara (a workspace admin — D8: archive is manager/admin only).
    // archive_shot_list() is an UPDATE, so the audit trigger stamps the row's
    // updated_at / updated_by with the same moment and person.
    archived_at: LIST_2_ARCHIVED_AT,
    archived_by: MEMBER_ID.mara,
    created_at: LIST_2_AT,
    created_by: MEMBER_ID.theo,
    updated_at: LIST_2_ARCHIVED_AT,
    updated_by: MEMBER_ID.mara,
  },
]

export const SHOT_LIST_ITEMS = [
  // Items 1..22: all 6 scenes, then all 16 shots.
  ...listItems({ listId: fid('shotList', 1), scenes: SCENES, shots: SHOTS, firstN: 1, at: LIST_1_AT, by: null }),
  // Items 23..29: scenes 3 and 5, then their 3 + 2 shots.
  ...listItems({
    listId: fid('shotList', 2),
    scenes: PICKUP_SCENES,
    shots: SHOTS.filter(sh => PICKUP_SCENE_IDS.has(sh.scene_id)),
    firstN: 23,
    at: LIST_2_AT,
    by: MEMBER_ID.theo,
  }),
]

export const EDITS = []

export const LEVELS = []
export const EXPERIENCES = []

// ── The `?fixtures=game` variant (B4, 2026-09-25) ──────────────────────────
// Salt Hours has `levels_enabled` and `experiences_enabled` off, so the
// Levels and Experiences views — and their detail popups, relations panel and
// asset picker — could not be opened on the fixtures at all. These rows are
// applied ONLY when the page loads with `?fixtures=game` (store.js,
// `applyGameVariant`), so the default dataset every other screen measures is
// byte-identical. Same shape as a scene row.

const GAME_ROW = (kind, [n, name, status, s, e, tint, description], i) => ({
  id: fid(kind, n),
  project_id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  name,
  description,
  notes: '',
  status,
  thumbnail_image: placeholder({ label: name, sub: kind, tint }),
  start_date: day(s),
  end_date: day(e),
  sort_order: i,
  created_at: stamp(20, 11, i),
  created_by: MEMBER_ID.theo,
  updated_at: stamp(38, 11, i),
  updated_by: MEMBER_ID.theo,
})

export const GAME_LEVELS = [
  // [n, name, status, startDay, endDay, tint, description]
  [1, 'Harbour Approach', 'approved',       21, 40, 'sea',   'Opening traversal along the breakwater; teaches the lamp.'],
  [2, 'Lamp Room',        'in_progress',    30, 55, 'ember', 'The lighthouse top: a puzzle room around the lens.'],
  [3, 'Cliff Path',       'not_started',    40, 70, 'moss',  'Night climb with the storm lantern.'],
  [4, 'Café at Dusk',     'pending_review', 35, 60, 'sand',  'Hub level: conversations and the compass.'],
].map((r, i) => GAME_ROW('level', r, i))

export const GAME_EXPERIENCES = [
  [1, 'First Light', 'in_progress',     21, 50, 'slate', 'Onboarding: the player learns to aim the lamp.'],
  [2, 'The Storm',   'needs_revisions', 45, 75, 'sea',   'Set piece across the Lamp Room and the Cliff Path.'],
  [3, 'Homecoming',  'not_started',     60, 90, 'plum',  'The ending, back at the harbour.'],
].map((r, i) => GAME_ROW('experience', r, i))

/** Asset number → the levels and experiences it belongs to, in the variant. */
export const GAME_LINKS = [
  // [asset n, level ns, experience ns]
  [4,  [1, 2], [1]],
  [7,  [2],    [1, 2]],
  [8,  [3],    [2]],
  [10, [4],    [3]],
  [11, [2, 3], [2]],
]
