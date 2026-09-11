// =============================================================================
// scenes.js — six scenes, sixteen shots, five bins, twelve bin files, eight
// takes. The bin rows follow docs/BINS_DESIGN.md §4.4; `online` is the list
// route's computed flag and is true for every fixture file (there is no disk
// behind them — the posters are the SVG placeholders, and `probe_status` is
// 'done' so the renderer's own probe never runs on them).
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

export const BINS = [
  { id: fid('bin', 1), project_id: PROJECT_ID, workspace_id: null, name: 'Footage',  description: 'Camera originals by shoot day.', kind: 'footage', color: null,     parent_bin_id: null,          sort_order: 0, created_at: stamp(30, 9), created_by: MEMBER_ID.sofia, updated_at: stamp(30, 9), updated_by: MEMBER_ID.sofia },
  { id: fid('bin', 2), project_id: PROJECT_ID, workspace_id: null, name: 'Day 1',    description: 'Lighthouse interior.',          kind: 'footage', color: 'blue',   parent_bin_id: fid('bin', 1), sort_order: 0, created_at: stamp(30, 9, 1), created_by: MEMBER_ID.sofia, updated_at: stamp(30, 9, 1), updated_by: MEMBER_ID.sofia },
  { id: fid('bin', 3), project_id: PROJECT_ID, workspace_id: null, name: 'Day 2',    description: 'Café and the storm.',           kind: 'footage', color: 'cyan',   parent_bin_id: fid('bin', 1), sort_order: 1, created_at: stamp(30, 9, 2), created_by: MEMBER_ID.sofia, updated_at: stamp(30, 9, 2), updated_by: MEMBER_ID.sofia },
  { id: fid('bin', 4), project_id: PROJECT_ID, workspace_id: null, name: 'Audio',    description: 'Location sound, slated.',      kind: 'audio',   color: 'green',  parent_bin_id: null,          sort_order: 1, created_at: stamp(30, 9, 3), created_by: MEMBER_ID.lena,  updated_at: stamp(30, 9, 3), updated_by: MEMBER_ID.lena },
  { id: fid('bin', 5), project_id: PROJECT_ID, workspace_id: null, name: 'Stills',   description: 'Set photography.',             kind: 'stills',  color: 'yellow', parent_bin_id: null,          sort_order: 2, created_at: stamp(30, 9, 4), created_by: MEMBER_ID.jonah, updated_at: stamp(30, 9, 4), updated_by: MEMBER_ID.jonah },
]

export const BIN_ROOTS = [
  { id: fid('binRoot', 1), project_id: PROJECT_ID, path: 'E:/SALT_HOURS/A001', label: 'Camera card A001', added_at: stamp(30, 9), last_seen_at: stamp(38, 9) },
  { id: fid('binRoot', 2), project_id: PROJECT_ID, path: 'E:/SALT_HOURS/SOUND', label: 'Sound recorder', added_at: stamp(30, 9), last_seen_at: stamp(38, 9) },
]

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
]

export const BIN_FILES = BIN_FILE_ROWS.map(([n, bin, name, extension, media_type, scene, shot, slate, take_number, camera, roll, duration_sec, width, height, fps, codec, review_flag, color, circled, tint], i) => ({
  id: fid('binFile', n),
  project_id: PROJECT_ID,
  bin_id: fid('bin', bin),
  display_name: name,
  original_name: `${name}${extension}`,
  extension,
  mime_type: media_type === 'video' ? 'video/quicktime' : media_type === 'audio' ? 'audio/wav' : 'image/png',
  source_path: `${bin === 4 ? 'E:/SALT_HOURS/SOUND' : 'E:/SALT_HOURS/A001'}/${name}${extension}`,
  is_sequence: false,
  sequence_pattern: null,
  frame_count: duration_sec && fps ? Math.round(duration_sec * fps) : null,
  size_bytes: media_type === 'video' ? Math.round(duration_sec * 110 * 1024 * 1024) : media_type === 'audio' ? Math.round(duration_sec * 288000) : 9_400_000,
  mtime: stamp(49 + (bin === 3 ? 3 : 0), 12, i),
  media_type,
  tags: media_type === 'video' ? ['camera-original'] : media_type === 'audio' ? ['location'] : ['set-photo'],
  scene_id: scene ? fid('scene', scene) : null,
  shot_id: shot ? fid('shot', shot) : null,
  slate,
  take_number,
  take_modifier: null,
  camera,
  roll,
  shoot_day: day(49 + (bin === 3 ? 3 : 0)),
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
  timecode_start: media_type === 'still' ? null : `0${9 + (i % 8)}:${String(10 + i * 3).padStart(2, '0')}:00:00`,
  probe_status: 'done',
  sort_order: i,
  added_by: MEMBER_ID.sofia,
  added_at: stamp(51 + (bin === 3 ? 3 : 0), 20, i),
  updated_at: stamp(52 + (bin === 3 ? 3 : 0), 10, i),
  online: true,
  // Not a column. The fixtures adapter serves this as the poster.
  __poster: placeholder({ label: name, sub: `${slate ? `slate ${slate} · take ${take_number}` : media_type}`, tint, w: 320, h: 180 }),
}))

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
]

export const SHOT_TAKES = TAKE_ROWS.map(([n, shot, file, role, position]) => ({
  id: fid('take', n),
  project_id: PROJECT_ID,
  shot_id: fid('shot', shot),
  bin_file_id: fid('binFile', file),
  role,
  position,
  notes: role === 'alt' ? 'Keep for the trailer.' : '',
  created_at: stamp(55, 14, n),
  updated_at: stamp(55, 14, n),
}))

export const LEVELS = []
export const EXPERIENCES = []
