// =============================================================================
// runMigrationBins.test.js — BC3 (Audrey's B9): a desktop project's bins move
// with it.
//
// Two desktop bundles stand in for hers: the dev fixtures' Salt Hours, turned
// back into the signed-out desktop's shape (absolute paths under one network
// share, known roots), and a bundle shaped like her real projects — nested
// bins, a frame sequence, takes on shots, clips on a drive letter and on a
// share, one root nobody names. What this pins:
//   * the dry run counts the bins' part, lists every root once with what the
//     answers make of it, asks the switch, and writes nothing;
//   * the real run carries scenes and shots (a take's shot must be there),
//     bins parents first, each clip under the location its root was named as
//     with its path inside it (ids kept), the takes whose shot and clip
//     landed, and the pictures only while the switch is on;
//   * a new location is made once and serves every clip under it; an
//     existing one is matched by address, never made twice;
//   * a root left unnamed leaves its clips on this computer, listed, never
//     dropped — and the desktop's bundle is never written;
//   * a second run skips what is there, and completes a picture the first
//     run could not;
//   * what cannot land is said: a take whose shot is missing, a clip whose
//     bin is missing, a picture the desktop cannot make.
// The Supabase client is a recorder; the desktop server is a fetch of four
// routes. Nothing here touches a network.
//
// M1 (night 3 of docs/sessions/PLAN_TO_1_0.md) extends the pattern to the
// five kinds the migration carries since: key dates, comments, shot lists
// with their items and edits, folders — and the files filed in them — and to
// the project row itself. The whole of the fixtures' Salt Hours, turned back
// into the desktop's shape (desktopFixtures: the keys the desktop stamps on a
// project, the project_id it stamps on a comment, no folder_id on a file),
// goes through, and every row of the five kinds must come out with the
// cloud's shape, its id and its parents, in the runner's order. The fake
// cloud refuses what wilson-dev refused when M1 measured it (rolled back,
// 2026-10-28): a key that is no column (PGRST204), a shot list or an edit
// inserted archived (42501), a row its foreign keys cannot find (23503), a
// unique key taken (23505, naming the key).
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => {
  const state = { inserts: {}, updates: [], log: [], failWith: null, uploads: [], removed: [], lists: {}, listError: null, single: {}, singleError: null, ranges: [], dropOnUpdate: null, rpcs: [], rpcRefuse: {}, trash: {} }
  // M1: the cloud's columns for the tables the project row and the five
  // kinds reach — wilson-dev's, read from information_schema (2026-10-28).
  const COLUMNS = {
    projects: 'id,workspace_id,title,description,status,status_tag,start_date,end_date,budget_total,budget_currency,client_name,cover_image_url,created_by,created_at,updated_at,last_updated_by,last_updated_at,deleted_at,deleted_by,updated_by,producer_id,director_id,budget_margin_pct,budget_contingency_pct,budget_agency_pct,budget_agency_enabled,budget_actual_column_mode,budget_actual_column_count,budget_active,budget_active_version_id,budget_finalized,project_code,scene_separator,scene_digits,shot_digits,scene_start_number,fps,scenes_enabled,levels_enabled,experiences_enabled,uses_realtime_engine,engine_type,engine_proprietary_name,engine_version,engine_project_name,engine_repo_url,project_type,project_tier,folder_slug,folder_root,is_private,active_shot_list_id,open_budget_version_id',
    files: 'id,project_id,phase_id,asset_id,task_id,name,mime_type,size_bytes,storage_provider,storage_path,thumbnail_url,kind,is_core_definer,uploaded_at,last_updated_by,last_updated_at,deleted_at,deleted_by,workspace_id,created_by,updated_by,created_at,updated_at,is_financial,scene_id,shot_id,level_id,experience_id,folder_id,document_kind,description,duration_sec,source_modified_at,tags',
    comments: 'id,entity_type,entity_id,body,author_name,author_user_id,created_at,last_updated_by,last_updated_at,deleted_at,deleted_by,workspace_id,created_by,updated_by,updated_at',
    milestones: 'id,project_id,workspace_id,phase_id,title,date,color,description,sort_order,created_at,created_by,updated_at,updated_by,deleted_at,deleted_by,set_aside_at',
    folders: 'id,project_id,workspace_id,parent_id,kind,entity_type,asset_id,scene_id,shot_id,level_id,experience_id,slug,label,path,sort_order,created_at,created_by,updated_at,updated_by',
    shot_lists: 'id,project_id,workspace_id,title,version,summary,snapshot,archived_at,archived_by,created_at,created_by,updated_at,updated_by',
    shot_list_items: 'id,shot_list_id,project_id,workspace_id,scene_id,shot_id,position,created_at,created_by,updated_at,updated_by',
    edits: 'id,project_id,workspace_id,shot_list_id,title,version,summary,parent_edit_id,items,snapshot,archived_at,archived_by,created_at,created_by,updated_at,updated_by',
  }
  const has = (table, pred) => (state.lists[table] || []).some(pred)
  const no = (code, message) => ({ code, message })
  const fk = (table, key) => no('23503', `insert or update on table "${table}" violates foreign key constraint "${key}"`)
  const dup = (key) => no('23505', `duplicate key value violates unique constraint "${key}"`)
  const sameName = (a, b) => String(a.title ?? '').trim() === String(b.title ?? '').trim() && Number(a.version ?? 1) === Number(b.version ?? 1)
  // The database's own refusals, in its order: PostgREST's column check, the
  // BEFORE triggers (0084's guard), the primary key and the unique keys, the
  // foreign keys at the statement's end.
  function cloudRefusal(table, row) {
    const cols = COLUMNS[table]?.split(',')
    const stray = cols && Object.keys(row).find(k => !cols.includes(k))
    if (stray) return no('PGRST204', `Could not find the '${stray}' column of '${table}' in the schema cache`)
    if (table === 'projects') {
      // M1 review round 1: the column types and NOT NULL defaults, read on
      // wilson-dev (project_status's five values; DATE; the defaulted columns).
      if (row.status != null && !['active', 'on_hold', 'completed', 'archived', 'cancelled'].includes(row.status)) return no('22P02', `invalid input value for enum project_status: "${row.status}"`)
      for (const k of ['start_date', 'end_date']) if (row[k] != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(row[k]))) return no('22007', `invalid input syntax for type date: "${row[k]}"`)
      for (const k of ['budget_actual_column_count', 'scene_digits', 'shot_digits', 'scene_start_number']) if (row[k] != null && !Number.isInteger(Number(row[k]))) return no('22P02', `invalid input syntax for type integer: "${row[k]}"`)
      for (const k of 'status,created_at,updated_at,budget_margin_pct,budget_contingency_pct,budget_agency_pct,budget_agency_enabled,budget_actual_column_mode,budget_actual_column_count,budget_active,budget_finalized,scene_separator,scene_digits,shot_digits,scene_start_number,fps,scenes_enabled,levels_enabled,experiences_enabled,uses_realtime_engine,is_private,title'.split(',')) {
        if (k in row && row[k] === null) return no('23502', `null value in column "${k}" of relation "projects" violates not-null constraint`)
      }
    }
    if (table === 'projects' && row.folder_root != null) return no('P0001', 'only a workspace admin or manager can set a project folder')
    if ((table === 'shot_lists' || table === 'edits') && (row.archived_at != null || row.archived_by != null)) {
      return table === 'shot_lists'
        ? no('42501', 'shot lists are archived and restored only by a project manager or a workspace admin, through archive_shot_list()')
        : no('42501', 'edits are archived and restored only by a project manager or a workspace admin, through archive_edit()')
    }
    if (table === 'edits' && row.parent_edit_id != null && !has('edits', e => e.id === row.parent_edit_id)) return no('23503', "an edit's parent must be another edit of the same shot list")
    if (row?.id && has(table, r => r.id === row.id)) return dup(`${table}_pkey`)
    if (table === 'bin_locations' && has(table, r => String(r.unc_path).toLowerCase() === String(row.unc_path).toLowerCase())) return dup('bin_locations_workspace_unc_key')
    if (table === 'shot_lists' && has(table, l => l.project_id === row.project_id && sameName(l, row))) return dup('shot_lists_project_title_version_key')
    if (table === 'shot_list_items') {
      if (row.scene_id != null && has(table, i => i.shot_list_id === row.shot_list_id && i.scene_id === row.scene_id)) return dup('shot_list_items_list_scene_key')
      if (row.shot_id != null && has(table, i => i.shot_list_id === row.shot_list_id && i.shot_id === row.shot_id)) return dup('shot_list_items_list_shot_key')
    }
    if (table === 'edits') {
      if (has(table, e => e.project_id === row.project_id && e.shot_list_id === row.shot_list_id && sameName(e, row))) return dup('edits_list_title_version_key')
      if (row.parent_edit_id == null && has(table, e => e.shot_list_id === row.shot_list_id && e.parent_edit_id == null)) return dup('edits_one_root_per_list_key')
      if (row.parent_edit_id != null && has(table, e => e.parent_edit_id === row.parent_edit_id)) return dup('edits_one_child_key')
    }
    if (table === 'folders') {
      if ((row.kind === 'root') !== (row.parent_id == null)) return no('23514', 'new row for relation "folders" violates check constraint "folders_root_shape_chk"')
      if (has(table, f => f.project_id === row.project_id && f.path === row.path)) return dup('folders_project_path_uniq')
      for (const k of ['asset_id', 'scene_id', 'shot_id', 'level_id', 'experience_id']) if (row[k] != null && has(table, f => f[k] === row[k])) return dup(`folders_${k.replace(/_id$/, '')}_uniq`)
    }
    if (table === 'projects') {
      if (row.budget_active_version_id != null && !has('budget_versions', v => v.id === row.budget_active_version_id)) return fk('projects', 'projects_budget_active_version_id_fkey')
      if (row.open_budget_version_id != null && !has('budget_versions', v => v.id === row.open_budget_version_id && v.project_id === row.id)) return fk('projects', 'projects_open_budget_version_fk')
      if (row.active_shot_list_id != null && !has('shot_lists', l => l.id === row.active_shot_list_id && l.project_id === row.id)) return fk('projects', 'projects_active_shot_list_fk')
    }
    if (table === 'shot_list_items') {
      if (!has('shot_lists', l => l.id === row.shot_list_id && l.project_id === row.project_id)) return fk(table, 'shot_list_items_list_fk')
      if (row.scene_id != null && !has('scenes', s => s.id === row.scene_id && s.project_id === row.project_id)) return fk(table, 'shot_list_items_scene_fk')
      if (row.shot_id != null && !has('shots', s => s.id === row.shot_id && s.project_id === row.project_id)) return fk(table, 'shot_list_items_shot_fk')
    }
    if (table === 'edits' && !has('shot_lists', l => l.id === row.shot_list_id && l.project_id === row.project_id)) return fk(table, 'edits_list_fk')
    if (table === 'milestones' && row.phase_id != null && !has('phases', p => p.id === row.phase_id)) return fk(table, 'milestones_phase_id_fkey')
    if (table === 'comments') {
      const target = { project: 'projects', phase: 'phases', asset: 'assets', task: 'tasks' }[row.entity_type]
      if (!target) return no('23514', 'new row for relation "comments" violates check constraint "comments_entity_type_check"')
      if (!has(target, r => r.id === row.entity_id)) return no('23502', 'null value in column "workspace_id" of relation "comments" violates not-null constraint')
    }
    if (table === 'folders') {
      if (row.parent_id != null && !has('folders', f => f.id === row.parent_id)) return fk(table, 'folders_parent_id_fkey')
      for (const [k, t] of [['asset_id', 'assets'], ['scene_id', 'scenes'], ['shot_id', 'shots'], ['level_id', 'levels'], ['experience_id', 'experiences']]) if (row[k] != null && !has(t, r => r.id === row[k])) return fk(table, `folders_${k}_fkey`)
    }
    if (table === 'files' && row.folder_id != null && !has('folders', f => f.id === row.folder_id)) return fk(table, 'files_folder_id_fkey')
    return null
  }
  const builder = (table) => {
    const q = { table, cols: null, filters: [], range: null }
    const api = {
      select(cols) { q.cols = cols; return api },
      eq(col, value) { q.filters.push([col, value]); return api },
      order() { return api },
      range(from, to) { q.range = [from, to]; state.ranges.push([table, from, to]); return api },
      maybeSingle: async () => {
        if (state.singleError) return { data: null, error: state.singleError }
        const by = q.filters.find(f => f[0] === 'id')
        // A row set for the test, else the row in the cloud by its id (M1:
        // a project's active list, a file already there on a second run).
        const one = state.single[table]?.[by?.[1]] ?? (state.lists[table] || []).find(r => r.id === by?.[1]) ?? null
        return { data: one && state.single[table]?.[by?.[1]] ? one : one ? { ...one } : null, error: null }
      },
      // A list read: `await client.from(t).select(c).eq(k, v).order().range()`.
      // PostgREST's own cap: at most 1,000 rows an answer (config.toml max_rows).
      then(resolve) {
        if (state.listError) return resolve({ data: null, error: state.listError })
        if (state.listErrorFor?.[table]) return resolve({ data: null, error: state.listErrorFor[table] })
        const all = (state.lists[table] || []).filter(r => q.filters.every(([c, v]) => r[c] === v)).sort((a, b) => String(a.id).localeCompare(String(b.id)))
        const rows = q.range ? all.slice(q.range[0], Math.min(q.range[1] + 1, q.range[0] + 1000)) : all.slice(0, 1000)
        return resolve({ data: rows.map(r => ({ ...r })), error: null })
      },
      insert: async (row) => {
        state.log.push(table)
        const override = state.failWith?.(table, row)
        if (override) return { error: override }
        // The database's own refusals (cloudRefusal, above): a primary key
        // already there, one share per company whatever its case, and since
        // M1 the rules of the tables the five kinds reach.
        const refused = cloudRefusal(table, row)
        if (refused) return { error: refused }
        ;(state.inserts[table] ||= []).push(row)
        // The row is now "in the cloud" for later reads of this run.
        ;(state.lists[table] ||= []).push({ ...row })
        return { error: null }
      },
      update(patch) {
        const u = { table, patch, filters: [], selected: false }
        const chain = {
          eq(col, value) { u.filters.push([col, value]); return chain },
          select() { u.selected = true; return chain },
          then(resolve) {
            state.updates.push(u)
            // A teammate's removal between the insert and this PATCH.
            if (state.dropOnUpdate) state.lists[table] = (state.lists[table] || []).filter(r => !state.dropOnUpdate(table, r, u))
            const hit = (state.lists[table] || []).filter(r => u.filters.every(([c, v]) => r[c] === v))
            for (const r of hit) Object.assign(r, patch)
            return resolve({ data: u.selected ? hit.map(r => ({ id: r.id })) : null, error: null })
          },
        }
        return chain
      },
    }
    return api
  }
  const client = {
    from: (table) => builder(table),
    storage: {
      from() {
        return {
          list: async () => ({ data: [] }),
          upload: async (path, bytes) => {
            const override = state.failWith?.('storage', { path })
            if (override) return { error: override }
            state.uploads.push({ path, size: bytes?.length ?? 0 })
            return { error: null }
          },
          remove: async (keys) => { state.removed.push(...keys); return { error: null } },
        }
      },
    },
    // The database's functions the runner calls, as 0084, 0086 and 0067 answer
    // them (M1). `state.rpcRefuse[fn]`: the refusal a seat without the right
    // gets. Every call is recorded.
    rpc: async (fn, args) => {
      state.rpcs.push([fn, args])
      if (fn === 'rabbit_money_segment') return { data: args?.seg === 'LEGAL', error: null }
      if (state.rpcRefuse[fn]) return { data: null, error: state.rpcRefuse[fn] }
      if (fn === 'set_active_shot_list') {
        const project = (state.lists.projects || []).find(p => p.id === args.p_project)
        if (!project) return { data: null, error: { code: 'P0002', message: 'project not found' } }
        project.active_shot_list_id = args.p_list
        return { data: args.p_list, error: null }
      }
      if (fn === 'archive_shot_list' || fn === 'archive_edit') {
        const table = fn === 'archive_shot_list' ? 'shot_lists' : 'edits'
        const row = (state.lists[table] || []).find(r => r.id === (args.p_list ?? args.p_edit))
        if (!row) return { data: null, error: { code: 'P0002', message: `${fn === 'archive_shot_list' ? 'shot list' : 'edit'} not found` } }
        row.archived_at = row.archived_at || '2026-10-28T00:00:00.000Z'
        row.archived_by = row.archived_by || 'u-mover'
        return { data: { ...row }, error: null }
      }
      if (fn === 'milestones_trash_index') return { data: (state.trash.milestones || []).filter(m => m.project_id === args.p_project_id), error: null }
      return { data: null, error: null }
    },
  }
  return { state, client }
})

vi.mock('../auth/supabaseClient', () => ({ supabase: fake.client }))

const {
  runMigration, BINS_LEFT_BEHIND, POSTERS_SWITCH_OFF, ORPHAN_TAKES, BID_VERSIONS_PART_2, PROJECT_FOLDER_STAYS, ARCHIVED_AGAIN,
  KEY_DATES_TRASHED, COMMENTS_ON_GONE_ROWS, FILES_PLACED, SHOT_LIST_NAME_TAKEN, LIVE_IN_CLOUD, FOLDERS_OF_GONE_ROWS, FOLDERS_TAKEN,
  KEY_DATES_PHASE_LET_GO, FILE_LINKS_LET_GO, EDITS_CHAIN_TAKEN, STATUS_NOT_IN_CLOUD,
} = await import('./runMigration')
const { pathKey } = await import('./binsMigration')
const { projectRowForCloud } = await import('./migrationRows')
const { BINS, BIN_FILES, SHOT_TAKES, SCENES, SHOTS, BIN_LOCATIONS, SHOT_LISTS, SHOT_LIST_ITEMS, EDITS, TASK_ITEMS } = await import('../../dev/fixtures/data/scenes')
const { PROJECT, PHASES, MILESTONES, ASSETS, TASKS, DEPENDENCIES, COMMENTS } = await import('../../dev/fixtures/data/project')
const { FOLDERS, FILES } = await import('../../dev/fixtures/data/files')
const { BUDGET_VERSIONS, BUDGET_LINES, BUDGET_ACTUALS, EXPENSES } = await import('../../dev/fixtures/data/money')

const WS = 'ws1'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])

// ── The fixtures' Salt Hours, as the signed-out desktop keeps it ─────────────
// The cloud rows (location + relative path) turned back into absolute paths
// under the share the fixtures name, with that share as the one known root.
const SHARE = BIN_LOCATIONS[0].unc_path // \\salthours-nas\footage
function fixturesBundle() {
  const pid = PROJECT.id
  const binFiles = BIN_FILES.map(({ __poster, location_id, relative_path, workspace_id, poster_path, online, ...f }) => ({
    ...f, source_path: `${SHARE}\\${relative_path.replace(/\//g, '\\')}`,
  }))
  return {
    project: { id: pid, title: PROJECT.title },
    phases: [], assets: [], tasks: [], files: [], dependencies: [],
    scenes: SCENES.map(({ workspace_id, ...s }) => s),
    shots: SHOTS.map(({ workspace_id, ...s }) => s),
    bins: BINS.map(({ workspace_id, ...b }) => b),
    binFiles,
    binRoots: [{ id: 'r1', project_id: pid, path: SHARE, label: 'footage' }],
    shotTakes: SHOT_TAKES.map(({ workspace_id, ...t }) => t),
  }
}

// ── A bundle shaped like her real desktop projects ──────────────────────────
// Nested bins (Footage / Day 01 / A001), a frame sequence (one row for its
// folder), takes on two shots, clips on a share AND on a drive letter, plus a
// root nobody names.
function realBundle() {
  const pid = 'p-real'
  return {
    project: { id: pid, title: 'Real' },
    phases: [], assets: [], tasks: [], files: [], dependencies: [],
    // A scene's and a shot's thumbnail_image is a path on this computer's
    // disk on the desktop; created_by is whoever the file says.
    scenes: [{ id: 'sc1', project_id: pid, name: 'Lighthouse', scene_number: 1, thumbnail_image: 'C:\\Users\\audrey\\Pictures\\lighthouse.jpg', created_by: 'u-forged' }],
    shots: [
      { id: 'sh1', project_id: pid, scene_id: 'sc1', name: 'Wide', shot_number: 1, thumbnail_image: 'C:\\Users\\audrey\\Pictures\\wide.jpg' },
      { id: 'sh2', project_id: pid, scene_id: 'sc1', name: 'Close', shot_number: 2 },
    ],
    bins: [
      { id: 'b-day', project_id: pid, name: 'Day 01', kind: 'footage', parent_bin_id: 'b-footage', sort_order: 0 },
      { id: 'b-footage', project_id: pid, name: 'Footage', kind: 'footage', parent_bin_id: null, sort_order: 0 },
      { id: 'b-a001', project_id: pid, name: 'A001', kind: 'footage', parent_bin_id: 'b-day', sort_order: 0 },
      { id: 'b-vfx', project_id: pid, name: 'VFX plates', kind: 'vfx', parent_bin_id: null, sort_order: 1 },
      { id: 'b-stills', project_id: pid, name: 'Stills', kind: 'stills', parent_bin_id: null, sort_order: 2 },
    ],
    binFiles: [
      { id: 'c1', project_id: pid, bin_id: 'b-a001', source_path: '\\\\nas\\footage\\Day01\\A001\\A001_C001.mov', display_name: 'A001_C001', original_name: 'A001_C001.mov', extension: '.mov', media_type: 'video', review_flag: 'select', circled: true, scene_id: 'sc1', shot_id: 'sh1', shoot_day: '2026-09-24', sort_order: 0, online: true, added_by: 'u-forged', created_at: '2026-09-24T10:00:00Z', sample_rate: 48000, channels: 2 },
      { id: 'c2', project_id: pid, bin_id: 'b-a001', source_path: '\\\\nas\\footage\\Day01\\A001\\A001_C002.mov', display_name: 'A001_C002', original_name: 'A001_C002.mov', extension: '.mov', media_type: 'video', review_flag: 'reject', sort_order: 1, online: true },
      { id: 'seq', project_id: pid, bin_id: 'b-vfx', source_path: '\\\\nas\\footage\\VFX\\storm_plate_v01', display_name: 'storm_plate_v01', original_name: 'storm_plate_v01', extension: '.exr', media_type: 'sequence', is_sequence: true, sequence_pattern: 'storm_plate_v01.####.exr', frame_count: 240, sort_order: 0, online: true },
      { id: 'd1', project_id: pid, bin_id: 'b-stills', source_path: 'D:\\Dailies\\stills\\lamp_room.png', display_name: 'lamp_room', original_name: 'lamp_room.png', extension: '.png', media_type: 'still', sort_order: 0, online: true },
      { id: 'e1', project_id: pid, bin_id: 'b-stills', source_path: 'E:\\Scratch\\odd.wav', display_name: 'odd', original_name: 'odd.wav', extension: '.wav', media_type: 'audio', sort_order: 1, online: false },
    ],
    binRoots: [
      { id: 'r-a001', project_id: pid, path: '\\\\nas\\footage\\Day01\\A001', label: 'A001' },
      { id: 'r-vfx', project_id: pid, path: '\\\\nas\\footage\\VFX', label: 'VFX' },
      { id: 'r-d', project_id: pid, path: 'D:\\Dailies', label: 'Dailies' },
      { id: 'r-e', project_id: pid, path: 'E:\\Scratch', label: 'Scratch' },
    ],
    shotTakes: [
      { id: 't1', project_id: pid, shot_id: 'sh1', bin_file_id: 'c1', role: 'primary', position: 0, notes: '' },
      { id: 't2', project_id: pid, shot_id: 'sh1', bin_file_id: 'c2', role: 'alt', position: 1, notes: 'Keep for the trailer.' },
      { id: 't3', project_id: pid, shot_id: 'sh2', bin_file_id: 'seq', role: 'primary', position: 0, notes: '' },
    ],
  }
}

// The share for the two network roots (the company's "Footage NAS" where a
// test seeds it, a new location where none does); the drive letter named as
// a second share, new; the scratch drive left for now.
const REAL_ANSWERS = {
  [pathKey('\\\\nas\\footage\\Day01\\A001')]: { unc_path: '\\\\nas\\footage' },
  [pathKey('\\\\nas\\footage\\VFX')]: { unc_path: '\\\\nas\\footage' },
  [pathKey('D:\\Dailies')]: { unc_path: '\\\\nas\\dailies', name: 'Dailies on the NAS' },
  [pathKey('E:\\Scratch')]: { skip: true },
}
const seedNas = () => { fake.state.lists.bin_locations = [{ id: 'L1', workspace_id: WS, name: 'Footage NAS', unc_path: '\\\\nas\\footage' }] }

let served
let posterStatus
let bundleWrites
function serve(bundles) {
  served = bundles
  globalThis.fetch = vi.fn(async (url, init) => {
    if (init?.method && init.method !== 'GET') { bundleWrites.push(url); return { ok: false, status: 405 } }
    if (url === '/api/rabbit/projects') return { ok: true, json: async () => served.map(b => ({ id: b.project.id, title: b.project.title })) }
    const m = /^\/api\/rabbit\/projects\/([^/]+)$/.exec(url)
    if (m) { const b = served.find(x => x.project.id === m[1]); return b ? { ok: true, json: async () => JSON.parse(JSON.stringify(b)) } : { ok: false, status: 404 } }
    // M1: a file's body, as the desktop serves it (/files/:id/download).
    if (/^\/api\/rabbit\/projects\/[^/]+\/files\/[^/]+\/download$/.test(url)) return { ok: true, status: 200, blob: async () => ({ size: 3, type: 'application/octet-stream' }) }
    const t = /^\/api\/rabbit\/projects\/([^/]+)\/bin-files\/([^/]+)\/thumbnail$/.exec(url)
    if (t) {
      const status = posterStatus[t[2]] ?? 200
      return status === 200 ? { ok: true, status, arrayBuffer: async () => JPEG.buffer.slice(0) } : { ok: false, status }
    }
    return { ok: false, status: 404 }
  })
}

beforeEach(() => {
  Object.assign(fake.state, { inserts: {}, updates: [], log: [], failWith: null, uploads: [], removed: [], lists: {}, listError: null, listErrorFor: {}, single: {}, singleError: null, ranges: [], dropOnUpdate: null, rpcs: [], rpcRefuse: {}, trash: {} })
  fake.state.single.workspaces = { [WS]: { remote_viewing_enabled: false } }
  posterStatus = {}
  bundleWrites = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

const ins = (t) => fake.state.inserts[t] || []
const byId = (t, id) => ins(t).find(r => r.id === id)

describe('the dry run: counted, asked, nothing written', () => {
  it('counts scenes, shots, bins, clips and takes; lists every root once with what the answers make of it; asks the switch; writes nothing', async () => {
    serve([realBundle()])
    const lines = []
    const report = await runMigration({ workspaceId: WS, dryRun: true, onProgress: (m) => lines.push(m) })
    expect(fake.state.log).toEqual([])
    expect(fake.state.uploads).toEqual([])
    // The counts against an empty cloud: everything would be inserted — except
    // the clips, none of which can go until its root is named.
    // (The takes wait with their clips: none goes until its root is named.)
    expect(report).toMatchObject({ scenes: { total: 1, inserted: 1 }, shots: { total: 2, inserted: 2 }, bins: { total: 5, inserted: 5 }, binFiles: { total: 0 }, shotTakes: { total: 3, inserted: 0, leftBehind: 3, orphans: 0 } })
    // The scene's and the shot's pictures are files on this computer: not carried, said.
    expect(report.notCarried).toEqual([{ key: 'thumbnails', label: 'scene and shot pictures', count: 2, part2: false }])
    // No answer given: the runner names nothing on its own (the panel
    // suggests; the person answers), and every root is a question.
    expect(report.footageRoots.map(r => [r.root, r.kind, r.count, r.resolved])).toEqual([
      ['\\\\nas\\footage\\Day01\\A001', 'unc', 2, 'unanswered'],
      ['\\\\nas\\footage\\VFX', 'unc', 1, 'unanswered'],
      ['D:\\Dailies', 'local', 1, 'unanswered'],
      ['E:\\Scratch', 'local', 1, 'unanswered'],
    ])
    expect(lines).toContain('  5 bins, 5 clips in 4 footage roots, 3 takes')
    expect(lines).toContain('    \\\\nas\\footage\\Day01\\A001: 2 clips — which footage location is this? (not named yet)')
    // Nothing named yet: every clip would stay, and the report lists them;
    // no picture is counted for a clip that is not going.
    expect(report.binFiles).toMatchObject({ total: 0, inserted: 0, leftBehind: 5 })
    expect(report.clipsLeftBehind.map(c => c.id).sort()).toEqual(['c1', 'c2', 'd1', 'e1', 'seq'])
    expect(report.posters).toMatchObject({ total: 0, switchOff: 0 })
    expect(report.remoteViewing).toBeNull()
    expect(lines.some(l => l.includes(POSTERS_SWITCH_OFF))).toBe(false)
  })

  it('with the roots answered, the dry run counts what would be inserted against what the cloud holds, and the pictures that would go; a clip with no path is listed', async () => {
    const b = realBundle()
    b.binFiles.push({ id: 'nopath', project_id: 'p-real', bin_id: 'b-stills', source_path: '', display_name: 'ghost', original_name: 'ghost.png', media_type: 'still', sort_order: 9 })
    serve([b])
    seedNas()
    fake.state.lists.bins = [{ id: 'b-footage', project_id: 'p-real' }]
    fake.state.lists.bin_files = [{ id: 'c1', project_id: 'p-real', poster_path: 'projects/p-real/bin_files/c1/1-poster.jpg' }]
    const lines = []
    const report = await runMigration({ workspaceId: WS, dryRun: true, onProgress: (m) => lines.push(m), locations: REAL_ANSWERS })
    expect(fake.state.log).toEqual([])
    expect(report.bins).toEqual({ total: 5, inserted: 4, skipped: 1, failed: 0 })
    expect(report.binFiles).toEqual({ total: 4, inserted: 3, skipped: 1, failed: 0, leftBehind: 2 })
    expect(report.clipsLeftBehind).toEqual(expect.arrayContaining([
      { projectId: 'p-real', id: 'e1', name: 'odd', root: 'E:\\Scratch' },
      { projectId: 'p-real', id: 'nopath', name: 'ghost', root: null },
    ]))
    // Pictures: c1 has one already (skipped); c2, seq and d1 would go; the switch is off.
    expect(report.posters).toMatchObject({ total: 4, skipped: 1, switchOff: 3 })
    expect(lines.some(l => l.includes(`3 pictures: ${POSTERS_SWITCH_OFF}`))).toBe(true)
  })

  it('with answers given, the dry run says where each root will go; an existing location is matched by address (any case); a root left for now is said', async () => {
    serve([realBundle()])
    fake.state.lists.bin_locations = [{ id: 'L1', workspace_id: WS, name: 'Footage NAS', unc_path: '\\\\NAS\\Footage' }]
    const lines = []
    const report = await runMigration({ workspaceId: WS, dryRun: true, onProgress: (m) => lines.push(m), locations: REAL_ANSWERS })
    expect(report.footageRoots.map(r => r.resolved)).toEqual(['existing', 'existing', 'new', 'skip'])
    expect(lines).toContain('    \\\\nas\\footage\\Day01\\A001: 2 clips — the company\'s "Footage NAS"')
    expect(lines).toContain('    D:\\Dailies: 1 clip — a new location "Dailies on the NAS" (\\\\nas\\dailies)')
    expect(lines).toContain('    E:\\Scratch: 1 clip — left on this computer (not named)')
    expect(report.binFiles.leftBehind).toBe(1)
    expect(report.footageLocations).toEqual([{ id: 'L1', name: 'Footage NAS', unc_path: '\\\\NAS\\Footage' }])
    expect(fake.state.log).toEqual([])
  })

  it('an address inside a company location IS that location (Tesler: the system matches; nobody makes a second share)', async () => {
    serve([realBundle()])
    seedNas()
    const report = await runMigration({ workspaceId: WS, dryRun: true, locations: { ...REAL_ANSWERS, [pathKey('D:\\Dailies')]: { unc_path: '\\\\nas\\footage\\dailies' } } })
    expect(report.footageRoots.find(r => r.root === 'D:\\Dailies').resolved).toBe('existing')
  })
})

describe('the real run on a bundle shaped like her projects', () => {
  it('carries scenes and shots, the bins parents first, each clip under its location with its path inside, the takes, and lists the root left behind', async () => {
    serve([realBundle()])
    seedNas()
    const lines = []
    const report = await runMigration({ workspaceId: WS, onProgress: (m) => lines.push(m), locations: REAL_ANSWERS })
    // Scenes and shots, with the project.
    expect(ins('scenes').map(s => s.id)).toEqual(['sc1'])
    expect(ins('shots').map(s => s.id)).toEqual(['sh1', 'sh2'])
    expect(report.scenes).toEqual({ total: 1, inserted: 1, skipped: 0, failed: 0 })
    // Bins: parents before children, the workspace set, ids kept.
    const binOrder = ins('bins').map(b => b.id)
    expect(binOrder.indexOf('b-footage')).toBeLessThan(binOrder.indexOf('b-day'))
    expect(binOrder.indexOf('b-day')).toBeLessThan(binOrder.indexOf('b-a001'))
    expect(ins('bins').every(b => b.workspace_id === WS && b.project_id === 'p-real')).toBe(true)
    // The new location, made once; the existing one matched, never made.
    expect(ins('bin_locations')).toHaveLength(1)
    expect(ins('bin_locations')[0]).toMatchObject({ workspace_id: WS, name: 'Dailies on the NAS', unc_path: '\\\\nas\\dailies' })
    expect(report.binLocations).toEqual({ total: 1, inserted: 1, skipped: 0, failed: 0 })
    // Each clip: its id, its location, its path inside it; nothing of the desktop's.
    const c1 = byId('bin_files', 'c1')
    expect(c1).toMatchObject({ id: 'c1', project_id: 'p-real', bin_id: 'b-a001', location_id: 'L1', relative_path: 'Day01/A001/A001_C001.mov', workspace_id: WS, review_flag: 'select', circled: true, scene_id: 'sc1', shot_id: 'sh1', shoot_day: '2026-09-24', poster_path: null })
    for (const k of ['source_path', 'online', 'added_by', 'created_at', 'sample_rate', 'channels']) expect(c1, k).not.toHaveProperty(k)
    // A scene's or shot's picture is a path on this computer: not sent; nor who the file says made it.
    expect(ins('scenes')[0]).toMatchObject({ thumbnail_image: null })
    expect(ins('scenes')[0]).not.toHaveProperty('created_by')
    expect(ins('shots')[0]).toMatchObject({ thumbnail_image: null })
    expect(byId('bin_files', 'seq')).toMatchObject({ location_id: 'L1', relative_path: 'VFX/storm_plate_v01', is_sequence: true, frame_count: 240 })
    expect(byId('bin_files', 'd1')).toMatchObject({ location_id: ins('bin_locations')[0].id, relative_path: 'stills/lamp_room.png' })
    expect(byId('bin_files', 'e1')).toBeUndefined()
    expect(report.binFiles).toEqual({ total: 4, inserted: 4, skipped: 0, failed: 0, leftBehind: 1 })
    expect(report.clipsLeftBehind).toEqual([{ projectId: 'p-real', id: 'e1', name: 'odd', root: 'E:\\Scratch' }])
    expect(lines.some(l => l.includes(BINS_LEFT_BEHIND(1)))).toBe(true)
    // The takes, every one (their shots and clips landed), ids kept.
    expect(ins('shot_takes').map(t => t.id)).toEqual(['t1', 't2', 't3'])
    expect(ins('shot_takes')[1]).toMatchObject({ shot_id: 'sh1', bin_file_id: 'c2', role: 'alt', position: 1, notes: 'Keep for the trailer.', workspace_id: WS, project_id: 'p-real' })
    expect(report.shotTakes).toEqual({ total: 3, inserted: 3, skipped: 0, failed: 0, leftBehind: 0, orphans: 0 })
    // The switch off: no picture moved (the two clips, the sequence and the
    // still have one to send; the audio has none), said once.
    expect(fake.state.uploads).toEqual([])
    expect(report.posters).toMatchObject({ total: 4, uploaded: 0, switchOff: 4 })
    // The desktop's bundle was never written.
    expect(bundleWrites).toEqual([])
    // Nothing failed; the left-behind clip is not an error (it is listed).
    expect(report.errors).toEqual([])
  })

  it('writes the tables in an order every foreign key allows: scenes, shots, bins, locations, clips, takes', async () => {
    serve([realBundle()])
    seedNas()
    await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    const log = fake.state.log
    const first = (t) => log.indexOf(t); const last = (t) => log.lastIndexOf(t)
    expect(first('shots')).toBeGreaterThan(last('scenes'))
    expect(first('bin_files')).toBeGreaterThan(last('bins'))
    expect(first('bin_files')).toBeGreaterThan(last('shots'))
    expect(first('bin_locations')).toBeLessThan(last('bin_files'))
    expect(first('shot_takes')).toBeGreaterThan(last('bin_files'))
  })

  it('switch on: every picture the desktop can make is uploaded under the clip\'s own key and the row learns it; one it cannot make is said', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.single.workspaces[WS].remote_viewing_enabled = true
    posterStatus.seq = 410
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(fake.state.uploads.map(u => u.path)).toEqual([
      expect.stringMatching(/^projects\/p-real\/bin_files\/c1\/\d+-poster\.jpg$/),
      expect.stringMatching(/^projects\/p-real\/bin_files\/c2\/\d+-poster\.jpg$/),
      expect.stringMatching(/^projects\/p-real\/bin_files\/d1\/\d+-poster\.jpg$/),
    ])
    const patched = fake.state.updates.filter(u => u.table === 'bin_files')
    expect(patched.map(u => u.filters)).toEqual([[['id', 'c1'], ['project_id', 'p-real']], [['id', 'c2'], ['project_id', 'p-real']], [['id', 'd1'], ['project_id', 'p-real']]])
    expect(patched.every(u => /-poster\.jpg$/.test(u.patch.poster_path))).toBe(true)
    expect(report.posters).toEqual({ total: 4, uploaded: 3, skipped: 0, failed: 1, switchOff: 0 })
    expect(report.errors).toEqual([expect.objectContaining({ scope: 'poster', id: 'seq', message: 'storm_plate_v01: no picture on this computer (HTTP 410)' })])
  })

  it('a second run skips every row that is there, makes no second location, and completes a picture the first run could not', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.single.workspaces[WS].remote_viewing_enabled = true
    posterStatus.seq = 410
    await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    const firstUploads = fake.state.uploads.length
    // The desktop made the sequence's picture meanwhile.
    posterStatus = {}
    const again = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(again.bins).toEqual({ total: 5, inserted: 0, skipped: 5, failed: 0 })
    expect(again.binFiles).toEqual({ total: 4, inserted: 0, skipped: 4, failed: 0, leftBehind: 1 })
    expect(again.shotTakes).toEqual({ total: 3, inserted: 0, skipped: 3, failed: 0, leftBehind: 0, orphans: 0 })
    // A take already there is skipped without a write (review round 2).
    expect(fake.state.log.filter(t => t === 'shot_takes')).toHaveLength(3)
    // The location the first run made is the company's now: matched by
    // address, nothing to make, nothing to skip.
    expect(again.binLocations).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0 })
    expect(again.footageRoots.find(r => r.root === 'D:\\Dailies').resolved).toBe('existing')
    expect(ins('bin_locations')).toHaveLength(1)
    expect(fake.state.uploads).toHaveLength(firstUploads + 1)
    expect(fake.state.uploads.at(-1).path).toMatch(/\/bin_files\/seq\//)
    expect(again.posters).toEqual({ total: 4, uploaded: 1, skipped: 3, failed: 0, switchOff: 0 })
    expect(again.errors).toEqual([])
  })

  it('what cannot land is said: a take whose shot is missing, a clip whose bin is missing, a bin whose parent was refused', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.failWith = (table, row) => (table === 'shots' && row.id === 'sh2') || (table === 'bins' && row.id === 'b-vfx') ? { code: '23514', message: 'refused' } : null
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(report.shots).toMatchObject({ failed: 1 })
    expect(report.bins).toMatchObject({ failed: 1 })
    // The sequence's bin was refused, so the sequence cannot land; its take neither.
    expect(byId('bin_files', 'seq')).toBeUndefined()
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'bin_file', id: 'seq', message: expect.stringMatching(/its bin \(b-vfx\) is not in the cloud/) }),
      expect.objectContaining({ scope: 'shot_take', id: 't3', message: 'take not migrated: its shot is not in the cloud' }),
    ]))
    expect(ins('shot_takes').map(t => t.id)).toEqual(['t1', 't2'])
    expect(report.shotTakes).toEqual({ total: 3, inserted: 2, skipped: 0, failed: 1, leftBehind: 0, orphans: 0 })
  })

  // Review round 1: a take of a clip LEFT on this computer waits with it —
  // left behind, not failed, no error (an error would mark the run unclean
  // for a thing the person chose). Review round 2: NOTHING is promoted in
  // the primary's place (promoting a landed take left the shot with two
  // primaries once the real one arrived on the next run): the shot waits
  // for its primary, which lands as the primary when its root is named,
  // after the takes already there — no row in the cloud is moved.
  it('a take of a clip left for now is left behind, not failed; its shot gets no primary until it arrives, and then exactly one', async () => {
    const b = realBundle()
    // c1 (the primary of sh1) is moved to the scratch drive, which is left for now.
    b.binFiles[0].source_path = 'E:\\Scratch\\A001_C001.mov'
    serve([b])
    seedNas()
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(byId('bin_files', 'c1')).toBeUndefined()
    expect(report.binFiles.leftBehind).toBe(2)
    expect(report.shotTakes).toEqual({ total: 3, inserted: 2, skipped: 0, failed: 0, leftBehind: 1, orphans: 0 })
    expect(report.errors).toEqual([])
    expect(ins('shot_takes').filter(t => t.shot_id === 'sh1')).toEqual([expect.objectContaining({ id: 't2', role: 'alt', position: 0 })])
    // The scratch drive named: the clip and its take arrive, the take as the primary.
    const again = await runMigration({ workspaceId: WS, locations: { ...REAL_ANSWERS, [pathKey('E:\\Scratch')]: { unc_path: '\\\\nas\\scratch', name: 'Scratch' } } })
    expect(byId('bin_files', 'c1')).toMatchObject({ relative_path: 'A001_C001.mov' })
    expect(again.binFiles.leftBehind).toBe(0)
    expect(again.shotTakes).toEqual({ total: 3, inserted: 1, skipped: 2, failed: 0, leftBehind: 0, orphans: 0 })
    expect(ins('shot_takes').filter(t => t.shot_id === 'sh1').map(t => [t.id, t.role, t.position])).toEqual([['t2', 'alt', 0], ['t1', 'primary', 1]])
    expect(fake.state.updates.filter(u => u.table === 'shot_takes')).toEqual([])
    expect(again.errors).toEqual([])
  })

  // Review round 2: the desktop keeps a take of a removed shot or clip for
  // undo and shows it to nobody; the raw bundle carries it. Not carried,
  // not an error — as an error it made an ordinary project never reach Done.
  it('a take of a shot or clip removed on this computer is not carried and not an error; the dry run agrees', async () => {
    const b = realBundle()
    b.shotTakes.push(
      { id: 't-gone-clip', project_id: 'p-real', shot_id: 'sh1', bin_file_id: 'c-gone', role: 'alt', position: 2 },
      { id: 't-gone-shot', project_id: 'p-real', shot_id: 'sh-gone', bin_file_id: 'c2', role: 'primary', position: 0 },
    )
    serve([b])
    seedNas()
    const lines = []
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: REAL_ANSWERS, onProgress: (m) => lines.push(m) })
    expect(dry.shotTakes).toEqual({ total: 3, inserted: 3, skipped: 0, failed: 0, leftBehind: 0, orphans: 2 })
    expect(lines).toContain(`  ${ORPHAN_TAKES(2)}`)
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(report.shotTakes).toEqual({ total: 3, inserted: 3, skipped: 0, failed: 0, leftBehind: 0, orphans: 2 })
    expect(report.errors).toEqual([])
    expect(ins('shot_takes').map(t => t.id)).toEqual(['t1', 't2', 't3'])
  })

  it('the dry run counts the takes as the real run lands them (one in the cloud by its shot+clip pair skipped, one whose clip stays waiting) and the pictures that will upload while the switch is on', async () => {
    const b = realBundle()
    b.binFiles[0].source_path = 'E:\\Scratch\\A001_C001.mov' // c1 left for now: t1 waits
    serve([b])
    seedNas()
    fake.state.lists.shot_takes = [{ id: 'theirs', project_id: 'p-real', shot_id: 'sh1', bin_file_id: 'c2', role: 'alt', position: 0 }] // t2's pair, under another id
    fake.state.single.workspaces[WS].remote_viewing_enabled = true
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: REAL_ANSWERS })
    expect(dry.shotTakes).toEqual({ total: 3, inserted: 1, skipped: 1, failed: 0, leftBehind: 1, orphans: 0 })
    // c2 (video), the sequence and the still have a picture to send; c1 stays; the audio has none.
    expect(dry.posters).toEqual({ total: 3, uploaded: 3, skipped: 0, failed: 0, switchOff: 0 })
    expect(fake.state.log).toEqual([])
    // The real run lands the same: t2 skipped on its pair, no insert tried.
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(report.shotTakes).toEqual({ total: 3, inserted: 1, skipped: 1, failed: 0, leftBehind: 1, orphans: 0 })
    expect(ins('shot_takes').map(t => t.id)).toEqual(['t3'])
    expect(report.posters).toMatchObject({ total: 3, uploaded: 3 })
  })

  // Review round 2 (security): a row's id that belongs to ANOTHER project
  // (a copied project file; the same desktop moved into a second company)
  // is a failure with its reason, never "already in the cloud" — and a shot
  // never hangs off another project's scene (0040's scene link is a plain
  // foreign key, with no project in it).
  it('an id in the cloud under another project is a failure, said; a shot whose scene is another project\'s loses the link, said; the same ids under THIS project are skipped', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.lists.scenes = [{ id: 'sc1', project_id: 'p-other' }]
    fake.state.lists.bins = [{ id: 'b-vfx', project_id: 'p-other' }]
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(report.scenes).toEqual({ total: 1, inserted: 0, skipped: 0, failed: 1 })
    expect(report.bins).toEqual({ total: 5, inserted: 4, skipped: 0, failed: 1 })
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'scene', id: 'sc1', message: expect.stringMatching(/not this project's/) }),
      expect.objectContaining({ scope: 'bin', id: 'b-vfx', message: expect.stringMatching(/not this project's/) }),
      expect.objectContaining({ scope: 'shot', id: 'sh1', message: expect.stringMatching(/its scene is not in the cloud, so the shot's scene link was left empty/) }),
    ]))
    expect(byId('shots', 'sh1')).toMatchObject({ scene_id: null })
    expect(byId('shots', 'sh2')).toMatchObject({ scene_id: null })
    // CONTROL: the same ids under this project are skipped, the links kept.
    Object.assign(fake.state, { inserts: {}, lists: {}, log: [] })
    seedNas()
    fake.state.lists.scenes = [{ id: 'sc1', project_id: 'p-real' }]
    fake.state.lists.bins = [{ id: 'b-vfx', project_id: 'p-real' }]
    const again = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(again.scenes).toEqual({ total: 1, inserted: 0, skipped: 1, failed: 0 })
    expect(again.bins).toEqual({ total: 5, inserted: 4, skipped: 1, failed: 0 })
    expect(byId('shots', 'sh1')).toMatchObject({ scene_id: 'sc1' })
    expect(again.errors).toEqual([])
  })

  it('a re-run with a changed answer makes no location for clips already in the cloud, and says they keep theirs (review round 2)', async () => {
    serve([realBundle()])
    seedNas()
    await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(ins('bin_locations').map(l => l.unc_path)).toEqual(['\\\\nas\\dailies'])
    const lines = []
    const again = await runMigration({ workspaceId: WS, onProgress: (m) => lines.push(m), locations: { ...REAL_ANSWERS, [pathKey('D:\\Dailies')]: { unc_path: '\\\\nas2\\scratch', name: 'Elsewhere' } } })
    expect(again.binLocations).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0 })
    expect(ins('bin_locations').map(l => l.unc_path)).toEqual(['\\\\nas\\dailies'])
    expect(again.binFiles).toMatchObject({ inserted: 0, skipped: 4 })
    expect(lines).toContain('  D:\\Dailies: 1 clip already in the cloud keeps the footage location it has there (the answer given now moves no clip)')
    expect(again.errors).toEqual([])
  })

  it('what the migration does not carry is counted, summed over the projects, in the dry run and the real one — part 2\'s apart from what no migration carries', async () => {
    const a = realBundle()
    // Since M1 a comment and a shot list are carried; a budget line and a
    // level wait for part 2; an asset version and a scene's picture stay.
    a.budgetLines = [{ id: 'bl1' }, { id: 'bl2' }]; a.levels = [{ id: 'lv1' }]; a.assetVersions = [{ id: 'av1' }]
    const b = { project: { id: 'p-two', title: 'Two' }, phases: [], assets: [], tasks: [], files: [], dependencies: [], levels: [{ id: 'lv2' }] }
    serve([a, b])
    seedNas()
    // Summed over the two projects, the word in the right number for the sum.
    const expected = [
      { key: 'budgetLines', label: 'budget lines', count: 2, part2: true },
      { key: 'levels', label: 'levels', count: 2, part2: true },
      { key: 'assetVersions', label: 'asset version', count: 1, part2: false },
      { key: 'thumbnails', label: 'scene and shot pictures', count: 2, part2: false },
    ]
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: REAL_ANSWERS })
    expect(dry.notCarried).toEqual(expected)
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(report.notCarried).toEqual(expected)
  })

  it('a sequence folder picked as its own root belongs to the folder above it, so it has a path inside its location — and a clip the cloud cannot take makes no location first', async () => {
    const b = realBundle()
    b.binRoots.push({ id: 'r-seq', project_id: 'p-real', path: '\\\\nas\\footage\\VFX\\storm_plate_v01', label: 'storm_plate_v01' })
    serve([b])
    seedNas()
    const report = await runMigration({ workspaceId: WS, locations: { ...REAL_ANSWERS, [pathKey('\\\\nas\\footage\\VFX')]: { unc_path: '\\\\nas\\footage' } } })
    expect(byId('bin_files', 'seq')).toMatchObject({ location_id: 'L1', relative_path: 'VFX/storm_plate_v01' })
    expect(report.footageRoots.map(r => r.root)).not.toContain('\\\\nas\\footage\\VFX\\storm_plate_v01')
    // CONTROL: a clip whose path the cloud refuses (a segment ending in a
    // dot) fails BEFORE any location is made for its root.
    const c = realBundle()
    c.binFiles = [{ ...c.binFiles[3], source_path: 'D:\\Dailies\\stills.\\lamp_room.png' }]
    c.binRoots = [{ id: 'r-d', project_id: 'p-real', path: 'D:\\Dailies', label: 'Dailies' }]
    c.shotTakes = []
    serve([c])
    Object.assign(fake.state, { inserts: {}, lists: {} })
    seedNas()
    const r2 = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(r2.binFiles.failed).toBe(1)
    expect(ins('bin_locations')).toEqual([])
  })

  it('every list read is paged by id, so a project past a thousand clips is read whole (no picture uploaded twice)', async () => {
    const b = realBundle()
    serve([b])
    seedNas()
    fake.state.single.workspaces[WS].remote_viewing_enabled = true
    // 1,200 clips already in the cloud with a picture each, c1 among them —
    // and LAST by id, so it sits on the second page (review round 2: it
    // used to sort first, where a runner that dropped page two still found it).
    fake.state.lists.bin_files = Array.from({ length: 1200 }, (_, i) => ({ id: i === 0 ? 'c1' : `a-old-${String(i).padStart(4, '0')}`, project_id: 'p-real', poster_path: 'x' }))
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(fake.state.ranges.filter(r => r[0] === 'bin_files').map(r => [r[1], r[2]])).toEqual([[0, 999], [1000, 1999]])
    expect(fake.state.uploads.some(u => /\/bin_files\/c1\//.test(u.path))).toBe(false)
    expect(report.posters.skipped).toBe(1)
  })

  it('a picture whose row is gone from this project by the time its key is written (removed meanwhile) is taken back, and said; a clip whose id is another project\'s never has a picture tried', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.single.workspaces[WS].remote_viewing_enabled = true
    // A teammate removes c2 between its insert and the PATCH of its picture:
    // the PATCH matches no row of this project, so the object is taken back.
    fake.state.dropOnUpdate = (table, row) => table === 'bin_files' && row.id === 'c2'
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    const key = fake.state.uploads.find(u => /\/bin_files\/c2\//.test(u.path))?.path
    expect(key).toBeTruthy()
    expect(fake.state.removed).toContain(key)
    expect(report.errors).toEqual([expect.objectContaining({ scope: 'poster', id: 'c2', message: expect.stringMatching(/taken back/) })])
    // CONTROL (review round 2): an id that belongs to another project's row
    // is a failure of the clip itself — no picture is uploaded for it.
    Object.assign(fake.state, { inserts: {}, lists: {}, uploads: [], removed: [], dropOnUpdate: null })
    seedNas()
    fake.state.lists.bin_files = [{ id: 'c2', project_id: 'p-other', poster_path: null }]
    const again = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(fake.state.uploads.some(u => /\/bin_files\/c2\//.test(u.path))).toBe(false)
    expect(again.binFiles).toMatchObject({ failed: 1 })
    expect(again.errors).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'bin_file', id: 'c2', message: expect.stringMatching(/not this project's/) })]))
  })

  it('a clip logged to a shot that did not land keeps its row, its link let go and said', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.failWith = (table, row) => (table === 'shots' && row.id === 'sh1') ? { code: '23514', message: 'refused' } : null
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(byId('bin_files', 'c1')).toMatchObject({ scene_id: 'sc1', shot_id: null })
    expect(report.errors).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'bin_file', id: 'c1', message: expect.stringMatching(/its shot is not in the cloud/) })]))
  })

  it('a location named by a teammate meanwhile (the insert meets 23505) is read back by address, not made twice', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.failWith = (table) => {
      if (table !== 'bin_locations') return null
      // Between the run's read and its insert, a teammate named the same share.
      fake.state.lists.bin_locations.push({ id: 'L-theirs', workspace_id: WS, name: 'Theirs', unc_path: '\\\\NAS\\Dailies' })
      return { code: '23505', message: 'duplicate' }
    }
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(byId('bin_files', 'd1').location_id).toBe('L-theirs')
    expect(report.binLocations).toEqual({ total: 1, inserted: 0, skipped: 1, failed: 0 })
    expect(report.errors).toEqual([])
  })

  it('the project\'s cloud rows unreadable: the rows still go (skipped by key where they are there), no picture does, and the report says why', async () => {
    serve([realBundle()])
    fake.state.single.workspaces[WS].remote_viewing_enabled = true
    // Every list read fails (the company's locations too, so the answers
    // name new locations, which the inserts still take).
    fake.state.listError = { message: 'network down' }
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(fake.state.uploads).toEqual([])
    expect(report.posters.uploaded).toBe(0)
    expect(report.errors.some(e => e.scope === 'bin_files' && /no picture was uploaded for it/.test(e.message))).toBe(true)
    // CONTROL: the clips themselves landed (every failed READ is said, per table; nothing else is).
    expect(report.errors.filter(e => !['bin_files', 'bin_locations', 'scenes', 'shots', 'bins', 'shot_takes'].includes(e.scope))).toEqual([])
    expect(report.binFiles.inserted).toBe(4)
  })

  it('the switch unreadable: no picture leaves (fail closed), and the report says the read failed', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.singleError = { message: 'boom' }
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(fake.state.uploads).toEqual([])
    expect(report.errors.some(e => e.scope === 'posters' && /could not read the company's remote-viewing switch/.test(e.message))).toBe(true)
  })
})

describe('the real run on the fixtures\' Salt Hours, as the desktop keeps it', () => {
  it('every bin, clip and take arrives with its id, the clips under the one named location at the paths the fixtures use', async () => {
    serve([fixturesBundle()])
    const key = pathKey(SHARE)
    const report = await runMigration({ workspaceId: WS, locations: { [key]: { unc_path: SHARE, name: 'Footage NAS' } } })
    expect(report.errors).toEqual([])
    expect(ins('bin_locations')).toEqual([expect.objectContaining({ name: 'Footage NAS', unc_path: SHARE })])
    expect(report.bins.inserted).toBe(BINS.length)
    expect(report.binFiles).toMatchObject({ inserted: BIN_FILES.length, leftBehind: 0 })
    expect(report.shotTakes.inserted).toBe(SHOT_TAKES.length)
    for (const f of BIN_FILES) {
      const row = byId('bin_files', f.id)
      expect(row, f.id).toBeTruthy()
      expect(row.relative_path).toBe(f.relative_path)
      expect(row.bin_id).toBe(f.bin_id)
    }
    expect(ins('scenes').map(s => s.id).sort()).toEqual(SCENES.map(s => s.id).sort())
    expect(ins('shots').map(s => s.id).sort()).toEqual(SHOTS.map(s => s.id).sort())
  })

  it('run twice: the second changes nothing', async () => {
    serve([fixturesBundle()])
    const key = pathKey(SHARE)
    const locations = { [key]: { unc_path: SHARE, name: 'Footage NAS' } }
    await runMigration({ workspaceId: WS, locations })
    const before = JSON.stringify(fake.state.inserts)
    const again = await runMigration({ workspaceId: WS, locations })
    expect(JSON.stringify(fake.state.inserts)).toBe(before)
    expect(again.bins.inserted + again.binFiles.inserted + again.shotTakes.inserted + again.binLocations.inserted + again.scenes.inserted + again.shots.inserted).toBe(0)
    expect(again.binFiles.skipped).toBe(BIN_FILES.length)
    expect(again.errors).toEqual([])
  })
})

describe('a project with no bins is as it was', () => {
  it('no bins, no clips: nothing of the bins\' part is read or written, no root is asked about', async () => {
    serve([{ project: { id: 'p0', title: 'Bare' }, phases: [], assets: [], tasks: [], files: [], dependencies: [] }])
    const report = await runMigration({ workspaceId: WS })
    expect(report.footageRoots).toEqual([])
    expect(report.binFiles.total).toBe(0)
    expect(fake.state.log).toEqual(['projects'])
    expect(report.errors).toEqual([])
  })
})

// =============================================================================
// M1 (night 3): the five kinds and the project row
// =============================================================================

// The whole of Salt Hours as the signed-out desktop keeps it: the bins' part
// (fixturesBundle), and the rest from the fixtures' cloud rows turned back —
// the project carrying the keys the desktop stamps on every project
// (electron/main.cjs's POST: documents, visualAssets, files_dir, a folder on
// this computer, its own workspace id), each comment the project_id the
// desktop stamps (rabbitSubentityRoutes), each file a disk name and no
// folder_id (projectFileStream.cjs writes none), no workspace on any row,
// the desktop's archive (archived_by null: it has no people). A key date keeps
// the fixtures' `name` beside its title, as an older build's row may.
const DESKTOP_WS = '00000000-0000-0000-0000-000000000001'
const SALT_LOCATIONS = { [pathKey(BIN_LOCATIONS[0].unc_path)]: { unc_path: BIN_LOCATIONS[0].unc_path, name: 'Footage NAS' } }
const omit = (row, keys) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)))
const local = (rows) => rows.map(r => omit(r, ['workspace_id']))
const LIST_1 = SHOT_LISTS[0].id
const LIST_2 = SHOT_LISTS[1].id
function desktopFixtures() {
  const pid = PROJECT.id
  return {
    ...fixturesBundle(),
    project: {
      ...omit(PROJECT, ['workspace_id', 'created_by', 'updated_by']),
      workspace_id: DESKTOP_WS, created_by: null,
      documents: [], visualAssets: [], files_dir: null,
      folder_slug: 'Salt-Hours', folder_root: 'C:\\Projects\\Salt-Hours',
    },
    phases: local(PHASES),
    milestones: MILESTONES.map(m => ({ ...m })),
    assets: local(ASSETS),
    tasks: local(TASKS),
    dependencies: DEPENDENCIES.map(d => ({ ...d, project_id: pid })),
    taskItems: local(TASK_ITEMS),
    comments: COMMENTS.map(c => ({ ...c, project_id: pid })),
    shotLists: SHOT_LISTS.map(l => ({ ...l, workspace_id: null, created_by: null, updated_by: null, archived_by: null })),
    shotListItems: SHOT_LIST_ITEMS.map(i => ({ ...i, workspace_id: null, created_by: null, updated_by: null })),
    edits: EDITS.map(e => ({ ...e, workspace_id: null, created_by: null, updated_by: null, archived_by: null })),
    folders: FOLDERS.map(f => omit(f, ['workspace_id', 'created_by', 'updated_by'])),
    files: FILES.map(f => ({
      ...omit(f, ['workspace_id', 'folder_id', 'thumbnail_url', 'created_by', 'updated_by', 'last_updated_at', 'last_updated_by', 'deleted_at', 'deleted_by']),
      storage_provider: 'local_server', storage_path: `${f.id}-${f.name}`,
    })),
    budgetVersions: local(BUDGET_VERSIONS), budgetLines: local(BUDGET_LINES), budgetActuals: local(BUDGET_ACTUALS), expenses: local(EXPENSES),
  }
}

// Every row of the five kinds the fixtures hold, by the table it lands in:
// the ids that must come out the other side.
const FIVE_KINDS = { milestones: MILESTONES, comments: COMMENTS, shot_lists: SHOT_LISTS, shot_list_items: SHOT_LIST_ITEMS, edits: EDITS, folders: FOLDERS }
/** What the round trip lost: each table's missing ids (red when a kind's rows do not arrive). */
function roundTripMissing() {
  const out = {}
  for (const [table, rows] of Object.entries(FIVE_KINDS)) {
    const got = new Set(ins(table).map(r => r.id))
    const missing = rows.filter(r => !got.has(r.id)).map(r => r.id)
    if (missing.length) out[table] = missing.length
  }
  return out
}
// The files the desktop files in no folder: the two invoices and the
// schedule at the project's top, and the Legal file (in LEGAL, which has no
// row): `null` in the cloud, as the cloud's own upload files them.
const AT_THE_TOP = new Set([fileId(30), fileId(31), fileId(32), fileId(33)])
function fileId(n) { return FILES.find(f => f.id.endsWith(String(n).padStart(12, '0'))).id }
const rpcsCalled = (name) => fake.state.rpcs.filter(([fn]) => fn === name).map(([, args]) => args)

describe('M1: the round trip on the fixtures — key dates, comments, shot lists, their items and edits, folders, and files filed in them', () => {
  it('every row of the five kinds comes out with the cloud\'s shape, its id and its parents; the run is clean', async () => {
    serve([desktopFixtures()])
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toEqual([])
    expect(roundTripMissing()).toEqual({})
    // Key dates: the editor's columns, the fixtures' stray `name` left here,
    // no workspace (stamped by the cloud), the phase kept (it landed).
    expect(ins('milestones')).toEqual(MILESTONES.map(m => omit(m, ['name'])))
    expect(report.milestones).toEqual({ total: 3, inserted: 3, skipped: 0, failed: 0, trashed: 0, phaseLetGo: 0 })
    // Comments: no project_id (the cloud has none), no author's account (a
    // claim the file cannot prove), the author's name and the text kept.
    expect(ins('comments')).toEqual(COMMENTS.map(c => omit(c, ['author_user_id'])))
    expect(report.comments).toMatchObject({ total: COMMENTS.length, inserted: COMMENTS.length, failed: 0, orphans: 0 })
    // Shot lists: LIVE as inserted (0084 refuses one arriving archived), no
    // workspace, no maker, no archive columns; Pickups archived after,
    // through archive_shot_list(), after its archived edit through
    // archive_edit(); Shot list 1 made active through set_active_shot_list().
    expect(ins('shot_lists')).toEqual(SHOT_LISTS.map(l => omit(l, ['workspace_id', 'created_by', 'updated_by', 'archived_at', 'archived_by'])))
    expect(ins('shot_lists').every(l => !('archived_at' in l))).toBe(true)
    expect(rpcsCalled('set_active_shot_list')).toEqual([{ p_project: PROJECT.id, p_list: LIST_1 }])
    const archives = fake.state.rpcs.filter(([fn]) => fn.startsWith('archive_')).map(([fn, a]) => [fn, a.p_edit ?? a.p_list])
    expect(archives).toEqual([['archive_edit', EDITS[2].id], ['archive_shot_list', LIST_2]])
    expect(fake.state.lists.shot_lists.find(l => l.id === LIST_2).archived_at).toBeTruthy()
    expect(fake.state.lists.shot_lists.find(l => l.id === LIST_1).archived_at).toBeFalsy()
    expect(fake.state.lists.projects[0].active_shot_list_id).toBe(LIST_1)
    expect(report.shotLists).toEqual({ total: 2, inserted: 2, skipped: 0, failed: 0, archived: 1 })
    // Items: every one, its list and position, in list order (each list's
    // scenes, then its shots).
    expect(ins('shot_list_items')).toEqual(SHOT_LIST_ITEMS.map(i => omit(i, ['workspace_id', 'created_by', 'updated_by'])))
    expect(report.shotListItems).toEqual({ total: 29, inserted: 29, skipped: 0, failed: 0, orphans: 0 })
    // Edits: the chain, each after the edit it continues, its items one
    // array; the third archived after it landed.
    expect(ins('edits')).toEqual(EDITS.map(e => omit(e, ['workspace_id', 'created_by', 'updated_by', 'archived_at', 'archived_by'])))
    expect(ins('edits').map(e => e.parent_edit_id)).toEqual([null, EDITS[0].id, EDITS[1].id])
    expect(fake.state.lists.edits.find(e => e.id === EDITS[2].id).archived_at).toBeTruthy()
    expect(report.edits).toEqual({ total: 3, inserted: 3, skipped: 0, failed: 0, archived: 1, taken: 0 })
    // Folders: every row by its path, parents first, ids and parents kept,
    // no workspace or maker.
    expect(ins('folders').map(f => f.id).sort()).toEqual(FOLDERS.map(f => f.id).sort())
    for (const f of FOLDERS) expect(ins('folders').find(r => r.id === f.id), f.path).toEqual(omit(f, ['workspace_id', 'created_by', 'updated_by']))
    const at = new Map(ins('folders').map((f, i) => [f.id, i]))
    for (const f of ins('folders')) if (f.parent_id) expect(at.get(f.parent_id), f.path).toBeLessThan(at.get(f.id))
    expect(report.folders).toMatchObject({ total: FOLDERS.length, inserted: FOLDERS.length, failed: 0, leftBehind: 0, orphans: 0, taken: 0 })
    // Files: each filed where the desktop shows it — its asset's, its
    // scene's or its shot's folder (the fixtures' own folder_id) — and the
    // four at the project's top in none.
    for (const f of FILES) expect(ins('files').find(r => r.id === f.id)?.folder_id, f.name).toBe(AT_THE_TOP.has(f.id) ? null : f.folder_id)
    expect(report.files).toMatchObject({ total: FILES.length, inserted: FILES.length, failed: 0, placed: FILES.length - AT_THE_TOP.size })
    expect(lines).toContain(`  ${FILES_PLACED(FILES.length - AT_THE_TOP.size)}`)
  })

  it('writes the tables in an order every key allows: key dates after phases, comments after their rows, lists after shots, items and edits after lists, folders after their rows, files after folders, bins after files', async () => {
    serve([desktopFixtures()])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const log = fake.state.log
    const first = (t) => log.indexOf(t); const last = (t) => log.lastIndexOf(t)
    expect(first('milestones')).toBeGreaterThan(last('phases'))
    expect(first('comments')).toBeGreaterThan(Math.max(last('tasks'), last('assets'), last('phases')))
    expect(first('shot_lists')).toBeGreaterThan(Math.max(last('scenes'), last('shots')))
    expect(first('shot_list_items')).toBeGreaterThan(last('shot_lists'))
    expect(first('edits')).toBeGreaterThan(last('shot_lists'))
    expect(first('folders')).toBeGreaterThan(Math.max(last('assets'), last('shots'), last('edits')))
    expect(first('files')).toBeGreaterThan(last('folders'))
    expect(first('bins')).toBeGreaterThan(last('files'))
    // The archive and the active pointer, after every list and edit landed.
    expect(fake.state.rpcs.map(([fn]) => fn).filter(fn => /shot_list|archive/.test(fn))).toEqual(['set_active_shot_list', 'archive_edit', 'archive_shot_list'])
  })

  it('run twice: the second changes nothing — no row, no function call that writes, every row skipped, nothing failed', async () => {
    serve([desktopFixtures()])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const before = JSON.stringify(fake.state.inserts)
    const listsBefore = JSON.stringify(fake.state.lists)
    fake.state.rpcs = []
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(JSON.stringify(fake.state.inserts)).toBe(before)
    expect(JSON.stringify(fake.state.lists)).toBe(listsBefore)
    expect(fake.state.rpcs.map(([fn]) => fn).filter(fn => /^(set_active|archive_)/.test(fn))).toEqual([])
    for (const k of ['milestones', 'comments', 'shotLists', 'shotListItems', 'edits', 'folders', 'files']) {
      expect(again[k].inserted, k).toBe(0)
      expect(again[k].failed, k).toBe(0)
      expect(again[k].skipped, k).toBe(again[k].total)
    }
    expect(again.shotLists.archived + again.edits.archived).toBe(0)
    expect(again.files.placed).toBe(0)
    expect(again.errors).toEqual([])
    // The lists already there are not written again (no insert tried).
    for (const t of ['shot_lists', 'shot_list_items', 'edits', 'folders', 'milestones']) expect(fake.state.log.filter(x => x === t).length, t).toBe(FIVE_KINDS[t].length)
  })

  it('CONTROL: with a kind\'s rows gone from the bundle, the round trip is red for that kind — and only that kind', async () => {
    for (const key of ['milestones', 'comments', 'shotLists', 'shotListItems', 'edits', 'folders']) {
      Object.assign(fake.state, { inserts: {}, lists: {}, log: [], rpcs: [] })
      const b = desktopFixtures()
      b[key] = []
      if (key === 'shotLists') { b.shotListItems = []; b.edits = [] } // a list's items and edits go with it
      serve([b])
      await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
      const table = { milestones: 'milestones', comments: 'comments', shotLists: 'shot_lists', shotListItems: 'shot_list_items', edits: 'edits', folders: 'folders' }[key]
      expect(roundTripMissing()[table], key).toBe(FIVE_KINDS[table].length)
    }
  })

  it('CONTROL: a cloud that refuses a kind leaves its rows missing, each refusal said — the run is not done', async () => {
    serve([desktopFixtures()])
    fake.state.failWith = (table) => (table === 'edits' ? { code: '42501', message: 'new row violates row-level security policy for table "edits"' } : null)
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(roundTripMissing()).toEqual({ edits: 3 })
    expect(report.edits).toMatchObject({ total: 3, inserted: 0, failed: 3 })
    // The first refused; the two that continue it cannot land without it.
    expect(report.errors.filter(e => e.scope === 'edit').map(e => e.message)).toEqual([
      'edits: new row violates row-level security policy for table "edits"',
      'Pickups assembly · v2: the edit it continues is not in the cloud, so it was not carried (a second run brings both)',
      'Pickups assembly · v3: the edit it continues is not in the cloud, so it was not carried (a second run brings both)',
    ])
    expect(rpcsCalled('archive_edit')).toEqual([])
  })
})

describe('M1: the cloud\'s refusals the runner meets no more (measured on wilson-dev, rolled back)', () => {
  it('CONTROL: the desktop\'s project row as the runner sent it before M1 is refused whole — its deck keys, its bid versions, its folder — and the runner\'s row is not', async () => {
    const desktop = { ...desktopFixtures().project }
    const insert = (row) => fake.client.from('projects').insert(row)
    // documents / visualAssets / files_dir: no columns (42703 there; PGRST204 through PostgREST).
    expect((await insert({ ...desktop, workspace_id: WS })).error).toMatchObject({ code: 'PGRST204' })
    // A locked bid version the cloud does not hold (part 2 carries the budgets).
    expect((await insert({ id: 'p-b', title: 'x', workspace_id: WS, budget_active_version_id: PROJECT.budget_active_version_id })).error).toMatchObject({ code: '23503', message: expect.stringMatching(/projects_budget_active_version_id_fkey/) })
    expect((await insert({ id: 'p-c', title: 'x', workspace_id: WS, open_budget_version_id: BUDGET_VERSIONS[0].id })).error).toMatchObject({ code: '23503', message: expect.stringMatching(/projects_open_budget_version_fk/) })
    // A folder on this computer (only an admin or a manager, inside the company's drive).
    expect((await insert({ id: 'p-d', title: 'x', workspace_id: WS, folder_root: desktop.folder_root })).error).toMatchObject({ code: 'P0001' })
    expect(fake.state.lists.projects).toBeUndefined()
    // The runner's row: the same project, through the cloud's columns.
    serve([desktopFixtures()])
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.projects).toEqual({ total: 1, inserted: 1, skipped: 0, failed: 0 })
    const p = ins('projects')[0]
    for (const k of ['documents', 'visualAssets', 'files_dir', 'folder_root', 'budget_active_version_id', 'open_budget_version_id', 'active_shot_list_id', 'created_by', 'updated_by']) expect(p, k).not.toHaveProperty(k)
    expect(p).toMatchObject({ id: PROJECT.id, workspace_id: WS, title: PROJECT.title, folder_slug: 'Salt-Hours', fps: 24, producer_id: PROJECT.producer_id, budget_contingency_pct: 10 })
    // Its children followed it (a refused project skips every child).
    expect(ins('phases')).toHaveLength(PHASES.length)
    expect(report.projectsLeftAtHome).toEqual({ bidVersions: 1, folders: 1, statuses: {} })
  })

  it('CONTROL: a desktop project\'s own values the cloud\'s columns refuse — a status it does not have, a cleared date, a cleared frame rate, no title — and the runner\'s row, which lands with the defaults and says the status (review round 1)', async () => {
    const insert = (row) => fake.client.from('projects').insert({ id: 'p-x', title: 'x', workspace_id: WS, ...row })
    // wilson-dev's answers: project_status has five values; a DATE refuses ''; a NOT NULL column refuses null.
    expect((await insert({ status: 'wrapped' })).error).toMatchObject({ code: '22P02' })
    expect((await insert({ start_date: '' })).error).toMatchObject({ code: '22007' })
    expect((await insert({ fps: null })).error).toMatchObject({ code: '23502', message: expect.stringMatching(/"fps"/) })
    expect((await insert({ title: null })).error).toMatchObject({ code: '23502', message: expect.stringMatching(/"title"/) })
    expect(fake.state.lists.projects).toBeUndefined()
    // The desktop's row: wrapped (its settings offer it), D.O.G.'s start date
    // alone (its window writes no start_date), the end date cleared, the
    // frame rate cleared, the title cleared.
    const b = desktopFixtures()
    b.project = { ...omit(b.project, ['start_date']), status: 'wrapped', startDate: '2026-09-01', end_date: '', fps: null, title: '' }
    serve([b])
    const dryLines = []
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS, onProgress: (m) => dryLines.push(m) })
    expect(dry.projectsLeftAtHome.statuses).toEqual({ wrapped: 1 })
    expect(dryLines).toContain(`  ${STATUS_NOT_IN_CLOUD(1, ['wrapped'])}`)
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.projects).toEqual({ total: 1, inserted: 1, skipped: 0, failed: 0 })
    const p = ins('projects')[0]
    expect(p).toMatchObject({ start_date: '2026-09-01', end_date: null, title: 'Untitled Project' })
    for (const k of ['status', 'fps', 'startDate']) expect(p, k).not.toHaveProperty(k)
    expect(report.projectsLeftAtHome.statuses).toEqual({ wrapped: 1 })
    expect(lines).toContain(`  ${STATUS_NOT_IN_CLOUD(1, ['wrapped'])}`)
    expect(STATUS_NOT_IN_CLOUD(1, ['wrapped'])).toBe('1 project has a status the cloud does not have (wrapped): it arrives as active')
    // Its children followed it.
    expect(ins('phases')).toHaveLength(PHASES.length)
  })

  it('the project row leaves out every value its column refuses — an empty status, a fraction in a whole-number column, a negative percentage, an actuals mode or count outside the budget settings\' checks — and keeps the rest', async () => {
    const odd = { ...desktopFixtures().project, status: '', scene_digits: 3.5, shot_digits: '4', budget_margin_pct: -5, budget_actual_column_mode: 'monthly', budget_actual_column_count: 0, fps: '23.976' }
    const row = projectRowForCloud(odd, WS)
    for (const k of ['status', 'scene_digits', 'budget_margin_pct', 'budget_actual_column_mode', 'budget_actual_column_count']) expect(row, k).not.toHaveProperty(k)
    expect(row).toMatchObject({ shot_digits: '4', fps: '23.976', workspace_id: WS })
    // CONTROL: the fake refuses each value as the database does.
    const insert = (over) => fake.client.from('projects').insert({ id: 'p-x', title: 'x', workspace_id: WS, ...over })
    expect((await insert({ status: '' })).error).toMatchObject({ code: '22P02' })
    expect((await insert({ scene_digits: 3.5 })).error).toMatchObject({ code: '22P02' })
    // The runner's row for it lands.
    serve([{ ...desktopFixtures(), project: odd }])
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.projects).toEqual({ total: 1, inserted: 1, skipped: 0, failed: 0 })
  })

  it('a project whose status the cloud has keeps it, and says nothing of it', async () => {
    const b = desktopFixtures()
    b.project = { ...b.project, status: 'on_hold' }
    serve([b])
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(ins('projects')[0].status).toBe('on_hold')
    expect(report.projectsLeftAtHome.statuses).toEqual({})
    expect(lines.some(l => l.includes('a status the cloud does not have'))).toBe(false)
  })

  it('the dry run and the real one say what the project row leaves here: its bid versions for part 2, its folder', async () => {
    serve([desktopFixtures()])
    const lines = []
    await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(lines).toContain(`  ${BID_VERSIONS_PART_2(1)}`)
    expect(lines).toContain(`  ${PROJECT_FOLDER_STAYS(1)}`)
    // CONTROL: a project naming no bid version and no folder says neither.
    const bare = { ...desktopFixtures(), project: { ...desktopFixtures().project, budget_active_version_id: null, open_budget_version_id: null, folder_root: null } }
    serve([bare])
    const quiet = []
    const r = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS, onProgress: (m) => quiet.push(m) })
    expect(quiet.some(l => l.includes('bid version') || l.includes('project folder'))).toBe(false)
    expect(r.projectsLeftAtHome).toEqual({ bidVersions: 0, folders: 0, statuses: {} })
  })

  it('CONTROL: an archived list or edit sent as the desktop keeps it is refused (0084\'s guard), and the runner never sends one', async () => {
    const pickups = desktopFixtures().shotLists[1]
    fake.state.lists.projects = [{ id: PROJECT.id }]
    expect((await fake.client.from('shot_lists').insert(pickups)).error).toMatchObject({ code: '42501' })
    expect((await fake.client.from('edits').insert({ ...desktopFixtures().edits[2], parent_edit_id: null })).error).toMatchObject({ code: '42501' })
    Object.assign(fake.state, { lists: {}, inserts: {}, log: [] })
    serve([desktopFixtures()])
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors.filter(e => /archived and restored only/.test(e.message))).toEqual([])
    expect([...ins('shot_lists'), ...ins('edits')].some(r => 'archived_at' in r || 'archived_by' in r)).toBe(false)
  })

  it('CONTROL: a comment carrying the desktop\'s project_id is refused (the cloud has no such column), and the runner never sends one', async () => {
    serve([desktopFixtures()])
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(ins('comments').some(c => 'project_id' in c)).toBe(false)
    expect(report.comments.failed).toBe(0)
    const desktopComment = desktopFixtures().comments[1]
    expect((await fake.client.from('comments').insert({ ...desktopComment, id: 'c-new' })).error).toMatchObject({ code: 'PGRST204', message: expect.stringMatching(/'project_id'/) })
  })

  it('CONTROL: a key date carrying the fixtures\' name is refused, and the runner sends its title only', async () => {
    fake.state.lists.phases = [{ id: PHASES[3].id }]
    expect((await fake.client.from('milestones').insert({ ...MILESTONES[0] })).error).toMatchObject({ code: 'PGRST204', message: expect.stringMatching(/'name'/) })
    Object.assign(fake.state, { lists: {}, inserts: {}, log: [] })
    serve([desktopFixtures()])
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.milestones.failed).toBe(0)
    expect(ins('milestones').map(m => m.title)).toEqual(MILESTONES.map(m => m.title))
    expect(ins('milestones').some(m => 'name' in m)).toBe(false)
  })
})

describe('M1: what the dry run promises', () => {
  it('counts the five kinds against what the cloud holds, names what it will archive, counts the files it will file — and writes nothing', async () => {
    serve([desktopFixtures()])
    const lines = []
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(fake.state.log).toEqual([])
    expect(fake.state.rpcs.map(([fn]) => fn).filter(fn => /^(set_active|archive_)/.test(fn))).toEqual([])
    expect(dry.milestones).toEqual({ total: 3, inserted: 3, skipped: 0, failed: 0, trashed: 0, phaseLetGo: 0 })
    expect(dry.comments).toMatchObject({ total: COMMENTS.length, orphans: 0, trashed: 0, leftBehind: 0 })
    expect(dry.shotLists).toEqual({ total: 2, inserted: 2, skipped: 0, failed: 0, archived: 1 })
    expect(dry.shotListItems).toEqual({ total: 29, inserted: 29, skipped: 0, failed: 0, orphans: 0 })
    expect(dry.edits).toEqual({ total: 3, inserted: 3, skipped: 0, failed: 0, archived: 1, taken: 0 })
    expect(dry.folders).toMatchObject({ total: FOLDERS.length, inserted: FOLDERS.length, skipped: 0, failed: 0 })
    expect(dry.files.placed).toBe(FILES.length - AT_THE_TOP.size)
    expect(lines).toContain(`  ${ARCHIVED_AGAIN(['"Pickups assembly · v3"', '"Pickups · v1"'])}`)
    expect(lines).toContain('  "Shot list 1 · v1" will be the active shot list in the cloud, if none is active there')
    expect(lines).toContain('  2 shot lists with 29 items and 3 edits')
    // Part 2's kinds are named apart from what no migration carries.
    expect(dry.notCarried.filter(n => n.part2).map(n => n.key)).toEqual(['budgetVersions', 'budgetLines', 'budgetActuals', 'expenses'])
    expect(dry.notCarried.filter(n => !n.part2).map(n => n.key)).toEqual(['thumbnails'])
    // The real run then does what was promised.
    const real = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    for (const k of ['milestones', 'shotLists', 'shotListItems', 'edits']) expect(real[k], k).toEqual(dry[k])
    expect(real.folders.inserted).toBe(dry.folders.inserted)
    expect(real.files.placed).toBe(dry.files.placed)
  })

  it('a second dry run after the first real one counts the key dates, lists, items, edits and folders as there and files none; comments count in Total only, as phases, assets and tasks do', async () => {
    serve([desktopFixtures()])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    for (const k of ['milestones', 'shotLists', 'shotListItems', 'edits', 'folders']) expect(dry[k], k).toMatchObject({ inserted: 0, skipped: dry[k].total, failed: 0 })
    expect(dry.shotLists.archived + dry.edits.archived).toBe(0)
    // Review round 1: the files are in the cloud already, so none is filed again.
    expect(dry.files.placed).toBe(0)
    // A comment has no project to read by: the real run skips one already there by its key.
    expect(dry.comments).toMatchObject({ total: COMMENTS.length, inserted: 0, skipped: 0 })
    expect(dry.phases).toMatchObject({ total: PHASES.length, inserted: 0, skipped: 0 })
  })
})

describe('M1: key dates', () => {
  it('a key date in this computer\'s Recently deleted is not carried, counted, said; one in the cloud\'s trash keeps its id there and is skipped, never brought back', async () => {
    const b = desktopFixtures()
    b.milestones[0] = { ...b.milestones[0], deleted_at: '2026-09-20T10:00:00.000Z' }
    serve([b])
    fake.state.trash.milestones = [{ id: MILESTONES[1].id, project_id: PROJECT.id }]
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(ins('milestones').map(m => m.id)).toEqual([MILESTONES[2].id])
    expect(report.milestones).toEqual({ total: 2, inserted: 1, skipped: 1, failed: 0, trashed: 1, phaseLetGo: 0 })
    expect(lines).toContain(`  ${KEY_DATES_TRASHED(1)}`)
    expect(report.errors).toEqual([])
  })

  it('a key date whose phase failed fails with it (a second run brings both); one whose phase was removed here lands without it, counted and said, not an error (review round 1)', async () => {
    const b = desktopFixtures()
    b.milestones[2] = { ...b.milestones[2], phase_id: 'phase-removed-here' }
    serve([b])
    fake.state.failWith = (table, row) => (table === 'phases' && row.id === PHASES[3].id ? { code: '23514', message: 'refused' } : null)
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    // Picture lock and Final mix sit in the refused phase: not carried.
    expect(ins('milestones').map(m => m.id)).toEqual([MILESTONES[2].id])
    expect(ins('milestones')[0].phase_id).toBeNull()
    expect(report.milestones).toEqual({ total: 3, inserted: 1, skipped: 0, failed: 2, trashed: 0, phaseLetGo: 1 })
    expect(report.errors.filter(e => e.scope === 'milestone').map(e => e.message)).toEqual([
      'Picture lock: its phase is not in the cloud, so the key date was not carried (a second run brings both)',
      'Final mix: its phase is not in the cloud, so the key date was not carried (a second run brings both)',
    ])
    expect(lines).toContain(`  ${KEY_DATES_PHASE_LET_GO(1)}`)
  })

  it('security: a key date never hangs off a phase another project holds (its id skipped by its key, not this project\'s in the cloud)', async () => {
    const b = desktopFixtures()
    serve([b])
    // The Post phase's id is another project's row in the cloud.
    fake.state.lists.phases = [{ id: PHASES[3].id, project_id: 'p-other' }]
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const pictureLock = ins('milestones').find(m => m.id === MILESTONES[0].id)
    expect(pictureLock.phase_id).toBeNull()
    // Picture lock and Final mix sit in that phase: both let go of it, counted.
    expect(report.milestones.phaseLetGo).toBe(2)
    // CONTROL: the Delivery phase is this project's, and its key date keeps it.
    expect(ins('milestones').find(m => m.id === MILESTONES[2].id).phase_id).toBe(MILESTONES[2].phase_id)
  })
})

describe('M1: comments', () => {
  it('a comment on a row removed on this computer is not carried, counted, said; one marked removed is counted; one on a kind the cloud cannot name stays, named', async () => {
    const b = desktopFixtures()
    b.comments.push(
      { id: 'c-gone', entity_type: 'task', entity_id: 'task-removed-here', body: 'x', project_id: PROJECT.id },
      { id: 'c-removed', entity_type: 'task', entity_id: TASKS[0].id, body: 'y', project_id: PROJECT.id, deleted_at: '2026-09-20T10:00:00.000Z' },
      { id: 'c-scene', entity_type: 'scene', entity_id: SCENES[0].id, body: 'z', project_id: PROJECT.id },
    )
    serve([b])
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(ins('comments').map(c => c.id)).toEqual(COMMENTS.map(c => c.id))
    expect(report.comments).toEqual({ total: COMMENTS.length, inserted: COMMENTS.length, skipped: 0, failed: 0, trashed: 1, orphans: 1, leftBehind: 1 })
    expect(lines).toContain(`  ${COMMENTS_ON_GONE_ROWS(1)}`)
    expect(report.notCarried).toContainEqual({ key: 'commentsElsewhere', label: 'comment on a row the cloud cannot hang a comment on', count: 1, part2: false })
    expect(report.errors).toEqual([])
  })

  it('a comment whose task failed fails with it, said; security: one on a task another project holds is never carried', async () => {
    const b = desktopFixtures()
    serve([b])
    const T20 = TASKS.find(t => t.id.endsWith('000000000020')).id
    const T9 = TASKS.find(t => t.id.endsWith('000000000009')).id
    fake.state.failWith = (table, row) => (table === 'tasks' && row.id === T20 ? { code: '23514', message: 'refused' } : null)
    // Task 9's id is another project's row in the cloud: skipped by its key, never this project's.
    fake.state.lists.tasks = [{ id: T9, project_id: 'p-other' }]
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const carried = ins('comments').map(c => c.entity_id)
    expect(carried).not.toContain(T20)
    expect(carried).not.toContain(T9)
    expect(report.errors.filter(e => e.scope === 'comment').map(e => e.message)).toEqual([
      'its task is not in the cloud, so the comment was not carried (a second run brings both)',
      'its task is not in the cloud, so the comment was not carried (a second run brings both)',
    ])
    expect(report.comments.orphans).toBe(1) // task 9's
  })
})

describe('M1: shot lists, their items and edits', () => {
  it('a list whose name the cloud holds under another id (made there since) fails, said in words; its items and edits fail with it', async () => {
    serve([desktopFixtures()])
    fake.state.lists.shot_lists = [{ id: 'list-made-in-the-cloud', project_id: PROJECT.id, title: 'Pickups', version: 1 }]
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(ins('shot_lists').map(l => l.id)).toEqual([LIST_1])
    expect(report.errors.find(e => e.scope === 'shot_list').message).toBe(SHOT_LIST_NAME_TAKEN('Pickups · v1'))
    expect(report.shotListItems).toMatchObject({ inserted: 22, failed: 7 })
    expect(report.edits).toMatchObject({ inserted: 0, failed: 3 })
    expect(rpcsCalled('archive_shot_list')).toEqual([])
  })

  it('an edit whose place in the list\'s one chain an edit made in the cloud since holds is counted and said, never an error — and every edit continuing it with it (review round 1)', async () => {
    serve([desktopFixtures()])
    // A first run whose edits the cloud refused; a teammate then starts the
    // chain of Pickups in the cloud.
    fake.state.failWith = (table) => (table === 'edits' ? { code: '42501', message: 'refused' } : null)
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    fake.state.failWith = null
    fake.state.lists.edits = [{ id: 'edit-made-in-the-cloud', project_id: PROJECT.id, shot_list_id: LIST_2, title: 'Their cut', version: 1, parent_edit_id: null }]
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    expect(dry.edits).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0, archived: 0, taken: 3 })
    const lines = []
    fake.state.log = []
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(again.edits).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0, archived: 0, taken: 3 })
    expect(fake.state.log.filter(t => t === 'edits')).toEqual([])
    expect(again.errors).toEqual([])
    expect(lines).toContain(`  ${EDITS_CHAIN_TAKEN(3)}`)
    expect(EDITS_CHAIN_TAKEN(3)).toBe('3 edits not carried: their place in the shot list\'s one chain of edits is an edit made in the cloud since (an edit on this computer cannot be moved)')
  })

  it('an edit whose parent the cloud holds, continued there since by another edit, is counted with its own continuation; the parent is skipped', async () => {
    serve([desktopFixtures()])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    // In the cloud, v2 and v3 are gone (say a restore from before them), and a teammate continued v1.
    fake.state.lists.edits = fake.state.lists.edits.filter(e => e.id === EDITS[0].id)
    fake.state.lists.edits.push({ id: 'their-v2', project_id: PROJECT.id, shot_list_id: LIST_2, title: 'Their v2', version: 1, parent_edit_id: EDITS[0].id })
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.edits).toEqual({ total: 1, inserted: 0, skipped: 1, failed: 0, archived: 0, taken: 2 })
    expect(again.errors).toEqual([])
  })

  it('an edit whose place is taken between the read and the write (the one-root or one-child key) is counted as taken, with the edits continuing it, not as an error', async () => {
    serve([desktopFixtures()])
    // A teammate starts the chain between the runner's read and its write.
    let first = true
    fake.state.failWith = (table) => {
      if (table !== 'edits' || !first) return null
      first = false
      return { code: '23505', message: 'duplicate key value violates unique constraint "edits_one_root_per_list_key"' }
    }
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.edits).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0, archived: 0, taken: 3 })
    expect(report.errors).toEqual([])
    expect(rpcsCalled('archive_edit')).toEqual([])
    // CONTROL: another key's 23505 (the title and version) is an error, said in words.
    Object.assign(fake.state, { inserts: {}, lists: {}, log: [], rpcs: [] })
    serve([desktopFixtures()])
    first = true
    fake.state.failWith = (table) => {
      if (table !== 'edits' || !first) return null
      first = false
      return { code: '23505', message: 'duplicate key value violates unique constraint "edits_list_title_version_key"' }
    }
    const named = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(named.edits).toMatchObject({ failed: 3, taken: 0 })
  })

  it('an edit listed before the edit it continues still lands after it', async () => {
    const b = desktopFixtures()
    b.edits = [b.edits[2], b.edits[0], b.edits[1]]
    serve([b])
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(ins('edits').map(e => e.id)).toEqual([EDITS[0].id, EDITS[1].id, EDITS[2].id])
    expect(report.errors).toEqual([])
  })

  it('an archive the seat cannot make is said, and the list stays live; a second run archives nothing and says the list is live in the cloud', async () => {
    serve([desktopFixtures()])
    fake.state.rpcRefuse.archive_shot_list = { code: '42501', message: 'only an untouched shot list you made can be withdrawn — a project manager or a workspace admin can archive it' }
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors).toEqual([expect.objectContaining({ scope: 'shot_list', id: LIST_2, message: '"Pickups · v1" is archived on this computer but live in the cloud: only an untouched shot list you made can be withdrawn — a project manager or a workspace admin can archive it' })])
    expect(report.shotLists.archived).toBe(0)
    expect(fake.state.lists.shot_lists.find(l => l.id === LIST_2).archived_at).toBeFalsy()
    const lines = []
    fake.state.rpcs = []
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(again.errors).toEqual([])
    expect(rpcsCalled('archive_shot_list')).toEqual([])
    expect(again.liveInCloud).toBe(1)
    expect(lines).toContain(`  ${LIVE_IN_CLOUD(1)}`)
  })

  it('the active list is left alone where the cloud has one already (a teammate\'s choice), and where this run did not carry the list', async () => {
    serve([desktopFixtures()])
    fake.state.lists.projects = [{ id: PROJECT.id, active_shot_list_id: 'their-list' }]
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(rpcsCalled('set_active_shot_list')).toEqual([])
    expect(fake.state.lists.projects[0].active_shot_list_id).toBe('their-list')
  })

  it('a list item already in the cloud under another id (the list holds that scene) is skipped, not doubled', async () => {
    serve([desktopFixtures()])
    // A run that carried the lists before their items (the same membership, another item id).
    const run1 = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(run1.errors).toEqual([])
    const item = fake.state.lists.shot_list_items.find(i => i.id === SHOT_LIST_ITEMS[0].id)
    item.id = 'theirs'
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.shotListItems).toMatchObject({ inserted: 0, skipped: 29, failed: 0 })
    expect(fake.state.lists.shot_list_items.filter(i => i.scene_id === SHOT_LIST_ITEMS[0].scene_id && i.shot_list_id === LIST_1)).toHaveLength(1)
  })
})

describe('M1: folders and the files filed in them', () => {
  it('a folder the cloud holds at its path (its own planner\'s, another id) is matched, never doubled, and the files go into the cloud\'s', async () => {
    serve([desktopFixtures()])
    const assetsCategory = FOLDERS.find(f => f.path === 'ASSETS')
    const root = FOLDERS.find(f => f.kind === 'root')
    fake.state.lists.folders = [
      { id: 'cloud-root', project_id: PROJECT.id, kind: 'root', path: '', parent_id: null },
      { id: 'cloud-assets', project_id: PROJECT.id, kind: 'category', entity_type: 'asset', path: 'ASSETS', parent_id: 'cloud-root' },
    ]
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors).toEqual([])
    expect(ins('folders').map(f => f.id)).not.toContain(root.id)
    expect(ins('folders').map(f => f.id)).not.toContain(assetsCategory.id)
    expect(report.folders).toMatchObject({ inserted: FOLDERS.length - 2, skipped: 2 })
    // The asset folders hang off the cloud's ASSETS; the categories off its root.
    for (const f of ins('folders').filter(r => r.path.startsWith('ASSETS/'))) expect(f.parent_id).toBe('cloud-assets')
    for (const f of ins('folders').filter(r => r.kind === 'category')) expect(f.parent_id).toBe('cloud-root')
  })

  it('a level\'s folder waits for part 2, named; a folder of a row removed here is not carried; one whose place a namesake took is not carried — none an error', async () => {
    const b = desktopFixtures()
    const root = b.folders.find(f => f.kind === 'root')
    b.levels = [{ id: 'lv-1', project_id: PROJECT.id, name: 'Harbour Approach' }]
    b.folders.push(
      { id: 'fd-levels', project_id: PROJECT.id, parent_id: root.id, kind: 'category', entity_type: 'level', slug: 'LEVELS', label: null, path: 'LEVELS', sort_order: 90 },
      { id: 'fd-level', project_id: PROJECT.id, parent_id: 'fd-levels', kind: 'entity', entity_type: 'level', level_id: 'lv-1', slug: 'Harbour-Approach', label: 'Harbour Approach', path: 'LEVELS/Harbour-Approach', sort_order: 91 },
      { id: 'fd-gone', project_id: PROJECT.id, parent_id: b.folders.find(f => f.path === 'ASSETS').id, kind: 'entity', entity_type: 'asset', asset_id: 'asset-removed-here', slug: 'Old', label: 'Old', path: 'ASSETS/Old', sort_order: 92 },
    )
    serve([b])
    // A namesake scene's folder, made in the cloud, holds the first scene folder's path.
    const sceneFolder = FOLDERS.find(f => f.scene_id && f.scene_id === FILES.find(x => x.id === fileId(28)).scene_id)
    fake.state.lists.scenes = [{ id: 'their-scene', project_id: PROJECT.id }]
    fake.state.lists.folders = [{ id: 'theirs', project_id: PROJECT.id, kind: 'entity', entity_type: 'scene', scene_id: 'their-scene', path: sceneFolder.path, parent_id: null }]
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toEqual([])
    const carried = ins('folders').map(f => f.id)
    expect(carried).toContain('fd-levels') // a category: no row of its own to wait for
    expect(carried).not.toContain('fd-level')
    expect(carried).not.toContain('fd-gone')
    expect(carried).not.toContain(sceneFolder.id)
    expect(report.folders).toMatchObject({ leftBehind: 1, orphans: 1, taken: 1, failed: 0 })
    expect(report.notCarried).toContainEqual({ key: 'levelFolders', label: 'folder of a level or experience', count: 1, part2: true })
    expect(lines).toContain(`  ${FOLDERS_OF_GONE_ROWS(1)}`)
    expect(lines).toContain(`  ${FOLDERS_TAKEN(1)}`)
    // The files of the taken folder's scene sit at the project's top in the cloud.
    for (const f of FILES.filter(x => x.scene_id === sceneFolder.scene_id)) expect(ins('files').find(r => r.id === f.id).folder_id, f.name).toBeNull()
  })

  it('security: a folder never hangs off an asset another project holds; its files go to the project\'s top', async () => {
    serve([desktopFixtures()])
    const lookbook = FOLDERS.find(f => f.asset_id)
    fake.state.lists.assets = [{ id: lookbook.asset_id, project_id: 'p-other' }]
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(ins('folders').map(f => f.id)).not.toContain(lookbook.id)
    expect(report.folders.orphans).toBe(1)
    for (const f of FILES.filter(x => x.asset_id === lookbook.asset_id)) expect(ins('files').find(r => r.id === f.id)?.folder_id ?? null, f.name).toBeNull()
  })

  it('a file whose desktop row names a folder carries the folder IN THE CLOUD, never the desktop\'s id', async () => {
    const b = desktopFixtures()
    serve([b])
    const assetsCategory = FOLDERS.find(f => f.path === 'ASSETS')
    // The desktop's folder_id on file 32 (the schedule) names ASSETS, which the cloud already holds under another id.
    b.files.find(f => f.id === fileId(32)).folder_id = assetsCategory.id
    fake.state.lists.folders = [
      { id: 'cloud-root', project_id: PROJECT.id, kind: 'root', path: '', parent_id: null },
      { id: 'cloud-assets', project_id: PROJECT.id, kind: 'category', entity_type: 'asset', path: 'ASSETS', parent_id: 'cloud-root' },
    ]
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(ins('files').find(f => f.id === fileId(32)).folder_id).toBe('cloud-assets')
  })
})

describe('M1: what moving the files after the folders asks', () => {
  it('security: a file whose scene or shot did not land as this project\'s (refused, or another project\'s id) fails with it, said, before its body moves; one whose scene landed keeps the link', async () => {
    serve([desktopFixtures()])
    const sc4 = FILES.find(f => f.id === fileId(28)).scene_id // the lighting plan's scene
    const shotOf35 = FILES.find(f => f.id === fileId(35)).shot_id // the board's shot
    // Scene 4 is refused; the board's shot is another project's row in the cloud (that shot fails, as BC3 says).
    fake.state.failWith = (table, row) => (table === 'scenes' && row.id === sc4 ? { code: '23514', message: 'refused' } : null)
    fake.state.lists.shots = [{ id: shotOf35, project_id: 'p-other' }]
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(ins('files').find(f => f.id === fileId(28))).toBeUndefined()
    expect(ins('files').find(f => f.id === fileId(35))).toBeUndefined()
    expect(fake.state.uploads.some(u => u.path.includes(fileId(28)) || u.path.includes(fileId(35)))).toBe(false)
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'file', id: fileId(28), message: 'SC04_lighting_plan.pdf: its scene is not in the cloud, so the file was not carried (a second run brings both)' }),
      expect.objectContaining({ scope: 'file', id: fileId(35), message: 'SC01_SH020_board.png: its shot is not in the cloud, so the file was not carried (a second run brings both)' }),
    ]))
    // CONTROL: the other scene file keeps its link (its scene landed).
    expect(ins('files').find(f => f.id === fileId(29)).scene_id).toBe(FILES.find(f => f.id === fileId(29)).scene_id)
  })

  it('a file\'s link to a row removed on this computer, or not this project\'s in the cloud, is let go, counted and said; the file lands, and no error stands in the way of Done', async () => {
    const b = desktopFixtures()
    // The desktop removed the treatment's asset (a delete leaves its files' link)…
    const treatment = b.files.find(f => f.id === fileId(4))
    b.assets = b.assets.filter(a => a.id !== treatment.asset_id)
    b.folders = b.folders.filter(f => f.asset_id !== treatment.asset_id)
    serve([b])
    // …and the schedule's task is another project's row in the cloud (skipped by its key, never this project's).
    const schedule = FILES.find(f => f.id === fileId(32))
    fake.state.lists.tasks = [{ id: schedule.task_id, project_id: 'p-other' }]
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(ins('files').find(f => f.id === fileId(4))).toMatchObject({ asset_id: null, folder_id: null })
    expect(ins('files').find(f => f.id === fileId(32))).toMatchObject({ task_id: null })
    expect(report.files.linksLetGo).toBe(2)
    expect(lines).toContain(`  ${FILE_LINKS_LET_GO(2)}`)
    expect(report.errors.filter(e => e.scope === 'file')).toEqual([])
  })

  it('security: a scene skipped while the read of the cloud\'s scenes failed is not known to be this project\'s, so no folder or file links to it', async () => {
    serve([desktopFixtures()])
    const sc4 = FILES.find(f => f.id === fileId(28)).scene_id
    // The scenes read fails, and scene 4's id is another project's row: its insert meets the key and reads as skipped.
    fake.state.listErrorFor = { scenes: { message: 'read refused' } }
    fake.state.lists.scenes = [{ id: sc4, project_id: 'p-other' }]
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const sc4Folder = FOLDERS.find(f => f.scene_id === sc4)
    expect(ins('folders').map(f => f.id)).not.toContain(sc4Folder.id)
    expect(ins('files').find(f => f.id === fileId(28))).toBeUndefined()
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'folder', id: sc4Folder.id }),
      expect.objectContaining({ scope: 'file', id: fileId(28) }),
    ]))
    expect(report.scenes.skipped).toBe(1)
    // CONTROL: the same failed read, scene 4 inserted by this run (known to be
    // this project's): its folder and its file land, the file linked to it.
    Object.assign(fake.state, { inserts: {}, lists: {}, log: [], uploads: [], rpcs: [] })
    serve([desktopFixtures()])
    fake.state.listErrorFor = { scenes: { message: 'read refused' } }
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(ins('folders').map(f => f.id)).toContain(sc4Folder.id)
    expect(ins('files').find(f => f.id === fileId(28))).toMatchObject({ scene_id: sc4, folder_id: sc4Folder.id })
  })

  it('a folder whose place a namesake took between the read and the write is counted as taken, not as an error', async () => {
    serve([desktopFixtures()])
    const sceneFolder = FOLDERS.find(f => f.scene_id)
    let raced = false
    fake.state.failWith = (table, row) => {
      if (table !== 'folders' || row.id !== sceneFolder.id || raced) return null
      raced = true
      fake.state.lists.scenes.push({ id: 'their-scene', project_id: PROJECT.id })
      fake.state.lists.folders.push({ id: 'theirs', project_id: PROJECT.id, kind: 'entity', entity_type: 'scene', scene_id: 'their-scene', path: sceneFolder.path, parent_id: null })
      return { code: '23505', message: 'duplicate key value violates unique constraint "folders_project_path_uniq"' }
    }
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(raced).toBe(true)
    expect(report.folders.taken).toBe(1)
    expect(report.errors.filter(e => e.scope === 'folder')).toEqual([])
  })
})

describe('M1: a folder the cloud holds for the same row under another path', () => {
  it('is matched by its row (one folder per scene, 0041), never doubled, and the scene\'s files go into the cloud\'s', async () => {
    serve([desktopFixtures()])
    const sc4 = FILES.find(f => f.id === fileId(28)).scene_id
    const desktopFolder = FOLDERS.find(f => f.scene_id === sc4)
    // The scene was renamed in the cloud after an earlier run: its folder sits at its new path, under another id.
    fake.state.lists.folders = [{ id: 'cloud-sc4', project_id: PROJECT.id, kind: 'entity', entity_type: 'scene', scene_id: sc4, path: 'SCENES/The-storm-renamed', parent_id: null }]
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(ins('folders').map(f => f.id)).not.toContain(desktopFolder.id)
    expect(ins('files').find(f => f.id === fileId(28)).folder_id).toBe('cloud-sc4')
    expect(report.folders).toMatchObject({ skipped: 1, failed: 0 })
    expect(report.errors).toEqual([])
  })
})
