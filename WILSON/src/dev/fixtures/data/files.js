// =============================================================================
// files.js — the project folder tree and thirty-two files.
//
// The tree comes from the real planner (folderPaths.planFullTree) over the
// fixture assets, scenes and shots, so the paths are exactly what the cloud
// adapter would have created: ROOT / ASSETS/<slug> / SCENES/<slug> /
// SHOTS/<slug> / INVOICES. Files then sit in those folders with the column
// shape of `files` (0026 onwards). `thumbnail_url` is an OBJECT PATH, as in the
// cloud, and the fixtures adapter's thumbnailUrls() resolves each path to a
// generated SVG — the same round trip FileManager makes against Storage.
// =============================================================================

import { planFullTree } from '../../../tools/rabbit_v0.1.0/folderPaths'
import { fid, stamp } from '../ids'
import { placeholder, tintFor } from '../svg'
import { WORKSPACE_ID, MEMBER_ID } from './workspace'
import { PROJECT, PROJECT_ID, ASSETS, ASSET_ID, PHASE_ID, TASK_ID } from './project'
import { SCENES, SHOTS } from './scenes'

// ── Folders ──────────────────────────────────────────────────────────────────

const plan = planFullTree(PROJECT, { assets: ASSETS, scenes: SCENES, shots: SHOTS })
const folderIdByPath = new Map()
plan.forEach((f, i) => folderIdByPath.set(f.path, fid('folder', i + 1)))

export const FOLDERS = plan.map((f, i) => ({
  id: folderIdByPath.get(f.path),
  project_id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  parent_id: f.parentPath == null ? null : folderIdByPath.get(f.parentPath) ?? null,
  kind: f.kind,
  entity_type: f.entityType,
  asset_id: f.asset_id ?? null,
  scene_id: f.scene_id ?? null,
  shot_id: f.shot_id ?? null,
  level_id: null,
  experience_id: null,
  slug: f.slug,
  label: f.label,
  path: f.path,
  sort_order: i,
  created_at: stamp(-10, 10, i),
  created_by: MEMBER_ID.mara,
  updated_at: stamp(-10, 10, i),
  updated_by: MEMBER_ID.mara,
}))

export function folderIdFor(path) {
  return folderIdByPath.get(path) ?? null
}

function assetFolderPath(n) {
  const f = plan.find(p => p.asset_id === ASSET_ID(n))
  return f ? f.path : 'ASSETS'
}
function sceneFolderPath(n) {
  const f = plan.find(p => p.scene_id === SCENES[n - 1].id)
  return f ? f.path : 'SCENES'
}

// ── Files ────────────────────────────────────────────────────────────────────

const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', mov: 'video/quicktime',
  mp4: 'video/mp4', exr: 'image/x-exr', wav: 'audio/wav', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fdx: 'application/xml', psd: 'image/vnd.adobe.photoshop', aep: 'application/octet-stream',
}
const THUMBABLE = new Set(['png', 'jpg', 'mov', 'mp4', 'exr', 'psd'])

const FILE_ROWS = [
  // [n, folderPath, name, kind, size(KB), asset, phase, task, is_core_definer, dayOffset]
  [1,  assetFolderPath(1),  'Salt_Hours_shooting_script_v4.pdf',   'source',      412,     1,  'dev',  1,  true,  16],
  [2,  assetFolderPath(1),  'Salt_Hours_shooting_script_v4.fdx',   'source',      98,      1,  'dev',  1,  false, 16],
  [3,  assetFolderPath(1),  'Salt_Hours_shooting_script_v3.pdf',   'source',      405,     1,  'dev',  1,  false, 13],
  [4,  assetFolderPath(2),  'Salt_Hours_treatment.pdf',            'deliverable', 1240,    2,  'dev',  3,  true,  6],
  [5,  assetFolderPath(3),  'Lookbook_v2.pdf',                     'deliverable', 18300,   3,  'dev',  6,  true,  18],
  [6,  assetFolderPath(3),  'ref_lighthouse_01.jpg',               'reference',   2100,    3,  'dev',  5,  false, 8],
  [7,  assetFolderPath(3),  'ref_lighthouse_02.jpg',               'reference',   1980,    3,  'dev',  5,  false, 8],
  [8,  assetFolderPath(3),  'ref_dawn_palette.png',                'reference',   760,     3,  'dev',  5,  false, 9],
  [9,  assetFolderPath(4),  'Boards_thumbnails_v1.pdf',            'source',      5400,    4,  'pre',  7,  false, 27],
  [10, assetFolderPath(4),  'Boards_clean_v2.pdf',                 'deliverable', 9800,    4,  'pre',  8,  true,  35],
  [11, assetFolderPath(4),  'Boards_sc04_sh010.png',               'source',      840,     4,  'pre',  8,  false, 34],
  [12, assetFolderPath(4),  'Boards_sc04_sh020.png',               'source',      812,     4,  'pre',  8,  false, 34],
  [13, assetFolderPath(4),  'Animatic_v2.mp4',                     'export',      62000,   4,  'pre',  9,  false, 38],
  [14, assetFolderPath(5),  'Mara_wardrobe_fitting_01.jpg',        'reference',   3300,    5,  'pre',  11, false, 36],
  [15, assetFolderPath(5),  'Mara_wardrobe_fitting_02.jpg',        'reference',   3100,    5,  'pre',  11, false, 36],
  [16, assetFolderPath(5),  'Mara_hair_test.jpg',                  'reference',   2900,    5,  'pre',  12, false, 40],
  [17, assetFolderPath(6),  'Father_photograph_prop.psd',          'source',      44000,   6,  'pre',  13, true,  38],
  [18, assetFolderPath(7),  'Lamp_room_plan_A2.pdf',               'source',      2200,    7,  'pre',  15, true,  30],
  [19, assetFolderPath(7),  'Lamp_room_elevation_A2.pdf',          'source',      2400,    7,  'pre',  15, false, 30],
  [20, assetFolderPath(7),  'Set_build_progress_0909.jpg',         'reference',   4100,    7,  'pre',  16, false, 37],
  [21, assetFolderPath(8),  'Cliff_recce_01.jpg',                  'reference',   5200,    8,  'pre',  19, false, 26],
  [22, assetFolderPath(8),  'Cliff_recce_02.jpg',                  'reference',   5000,    8,  'pre',  19, false, 26],
  [23, assetFolderPath(8),  'Cliff_recce_drone.mov',               'reference',   380000,  8,  'pre',  19, false, 26],
  [24, assetFolderPath(10), 'Compass_hero_weathered.jpg',          'reference',   2700,    10, 'pre',  25, true,  33],
  [25, assetFolderPath(11), 'Lantern_dimmer_wiring.pdf',           'source',      310,     11, 'pre',  26, false, 37],
  [26, assetFolderPath(12), 'Spray_test_comp_v001.exr',            'source',      27000,   12, 'post', 29, false, 39],
  [27, assetFolderPath(12), 'Spray_comp_setup.aep',                'source',      1500,    12, 'post', 29, false, 39],
  [28, sceneFolderPath(4),  'SC04_lighting_plan.pdf',              'source',      900,     null, 'pre', null, false, 38],
  [29, sceneFolderPath(2),  'SC02_weather_cover.docx',             'other',       120,     null, 'pre', 21, false, 39],
  [30, 'INVOICES',          'INV-0041_camera_hire.pdf',            'other',       210,     null, 'pre', null, false, 36],
  [31, 'INVOICES',          'INV-0042_set_timber.pdf',             'other',       190,     null, 'pre', null, false, 38],
  [32, '',                  'Salt_Hours_schedule_v3.xlsx',         'other',       88,      null, 'pre', 39, false, 39],
]

export const FILES = FILE_ROWS.map(([n, folderPath, name, kind, kb, asset, phase, task, is_core_definer, d], i) => {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  const storage_path = `workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/${folderPath ? folderPath + '/' : ''}${name}`
  return {
    id: fid('file', n),
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    phase_id: PHASE_ID[phase],
    asset_id: asset ? ASSET_ID(asset) : null,
    task_id: task ? TASK_ID(task) : null,
    scene_id: folderPath.startsWith('SCENES/') ? (plan.find(p => p.path === folderPath)?.scene_id ?? null) : null,
    shot_id: null,
    level_id: null,
    experience_id: null,
    folder_id: folderIdFor(folderPath),
    name,
    mime_type: MIME[ext] || 'application/octet-stream',
    size_bytes: kb * 1024,
    storage_provider: 'supabase',
    storage_path,
    thumbnail_url: THUMBABLE.has(ext) ? `${storage_path}.thumb.png` : null,
    kind,
    is_core_definer,
    is_financial: folderPath === 'INVOICES',
    uploaded_at: stamp(d, 11, i),
    source_modified_at: stamp(d - 1, 18, i),
    created_at: stamp(d, 11, i),
    created_by: MEMBER_ID.dev,
    updated_at: stamp(d, 11, i),
    updated_by: MEMBER_ID.dev,
    last_updated_at: stamp(d, 11, i),
    last_updated_by: MEMBER_ID.dev,
    deleted_at: null,
    deleted_by: null,
  }
})

/** Object path → generated picture, what thumbnailUrls() and fileUrl() serve. */
export const THUMBNAILS = new Map(
  FILES.filter(f => f.thumbnail_url).map((f, i) => [
    f.thumbnail_url,
    placeholder({ label: f.name.replace(/\.[a-z0-9]+$/i, ''), sub: f.mime_type, tint: tintFor(i) }),
  ]),
)

/** Lifecycle stream (0027) for the audit drawer: a few uploads, one move. */
export const FILE_EVENTS = [
  { id: fid('fileEvent', 1), file_id: fid('file', 10), project_id: PROJECT_ID, event: 'uploaded', actor_id: MEMBER_ID.dev, actor_name: 'Dev Patel', detail: { name: 'Boards_clean_v2.pdf' }, created_at: stamp(35, 11, 9) },
  { id: fid('fileEvent', 2), file_id: fid('file', 10), project_id: PROJECT_ID, event: 'moved', actor_id: MEMBER_ID.dev, actor_name: 'Dev Patel', detail: { from: 'ASSETS', to: assetFolderPath(4) }, created_at: stamp(35, 11, 30) },
  { id: fid('fileEvent', 3), file_id: fid('file', 1),  project_id: PROJECT_ID, event: 'uploaded', actor_id: MEMBER_ID.theo, actor_name: 'Theo Lindqvist', detail: { name: 'Salt_Hours_shooting_script_v4.pdf' }, created_at: stamp(16, 11, 0) },
]
