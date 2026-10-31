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
// 2026-10-27): a key that is no column (PGRST204), a shot list or an edit
// inserted archived (42501), a row its foreign keys cannot find (23503), a
// unique key taken (23505, naming the key).
//
// M3 (night 5): the people map, the roster, the files kept with rows, the
// rate cards and the templates, the receipts moved, the archive (the M3
// describe blocks at the end). The fake cloud gains the five tables and
// their gates as wilson-dev answered (2026-10-28, rolled back), the
// directory, the reservation, a storage bucket that lists and moves, and a
// tus double that reads the Range-fed source the runner hands it; the fake
// desktop serves the workspace stores, the workspace record and a managed
// file's stream (Range, 206; 410 for a body gone; `?probe=1`).
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

const fake = vi.hoisted(() => {
  const state = { inserts: {}, updates: [], log: [], failWith: null, failUpdate: null, uploads: [], removed: [], lists: {}, listError: null, single: {}, singleError: null, ranges: [], dropOnUpdate: null, rpcs: [], rpcRefuse: {}, trash: {}, moneyGate: true, legalGate: true, pre0103: false, inReads: [], callerId: 'u-mover', directory: [], directoryError: null, reservations: [], released: [], objects: [], moves: [], tus: [], rosterGate: true, entryGate: true, templateGate: true, failMove: null }
  // M3: the fake's own workspace (WS below is defined after this hoisted block).
  const FAKE_WS = 'ws1'
  // M1: the cloud's columns for the tables the project row and the five
  // kinds reach — wilson-dev's, read from information_schema (2026-10-27).
  const COLUMNS = {
    projects: 'id,workspace_id,title,description,status,status_tag,start_date,end_date,budget_total,budget_currency,client_name,cover_image_url,created_by,created_at,updated_at,last_updated_by,last_updated_at,deleted_at,deleted_by,updated_by,producer_id,director_id,budget_margin_pct,budget_contingency_pct,budget_agency_pct,budget_agency_enabled,budget_actual_column_mode,budget_actual_column_count,budget_active,budget_active_version_id,budget_finalized,project_code,scene_separator,scene_digits,shot_digits,scene_start_number,fps,scenes_enabled,levels_enabled,experiences_enabled,uses_realtime_engine,engine_type,engine_proprietary_name,engine_version,engine_project_name,engine_repo_url,project_type,project_tier,folder_slug,folder_root,is_private,active_shot_list_id,open_budget_version_id',
    files: 'id,project_id,phase_id,asset_id,task_id,name,mime_type,size_bytes,storage_provider,storage_path,thumbnail_url,kind,is_core_definer,uploaded_at,last_updated_by,last_updated_at,deleted_at,deleted_by,workspace_id,created_by,updated_by,created_at,updated_at,is_financial,scene_id,shot_id,level_id,experience_id,folder_id,document_kind,description,duration_sec,source_modified_at,tags',
    comments: 'id,entity_type,entity_id,body,author_name,author_user_id,created_at,last_updated_by,last_updated_at,deleted_at,deleted_by,workspace_id,created_by,updated_by,updated_at',
    milestones: 'id,project_id,workspace_id,phase_id,title,date,color,description,sort_order,created_at,created_by,updated_at,updated_by,deleted_at,deleted_by,set_aside_at',
    folders: 'id,project_id,workspace_id,parent_id,kind,entity_type,asset_id,scene_id,shot_id,level_id,experience_id,slug,label,path,sort_order,created_at,created_by,updated_at,updated_by',
    shot_lists: 'id,project_id,workspace_id,title,version,summary,snapshot,archived_at,archived_by,created_at,created_by,updated_at,updated_by',
    shot_list_items: 'id,shot_list_id,project_id,workspace_id,scene_id,shot_id,position,created_at,created_by,updated_at,updated_by',
    edits: 'id,project_id,workspace_id,shot_list_id,title,version,summary,parent_edit_id,items,snapshot,archived_at,archived_by,created_at,created_by,updated_at,updated_by',
    // M2 (night 4): part 2's tables, read from wilson-dev's information_schema (2026-10-28).
    budget_versions: 'id,project_id,workspace_id,name,type,is_active,snapshot,locked_at,locked_by,created_at,created_by,updated_at,updated_by,shot_list_id,summary',
    budget_lines: 'id,project_id,workspace_id,sheet,department,sort_order,label,description,is_section_header,team_member_id,role_slug,rate,days,qty,cost,is_na_days,is_na_qty,margin_pct,contingency_pct,agency_opt_out,talent_agency_fee_pct,talent_type,agent_name,agency_name,email,phone,union_id,created_at,created_by,updated_at,updated_by',
    budget_actuals: 'id,project_id,workspace_id,line_id,column_index,value,invoice_number,expense_id,source,notes,attachment_name,attachment_path,created_at,created_by,updated_at,updated_by',
    expenses: 'id,project_id,workspace_id,title,description,estimated_cost,actual_cost,purchase_date,asset_ids,phase_ids,task_ids,file_ids,created_at,created_by,updated_at,updated_by',
    project_rate_overrides: 'id,project_id,workspace_id,role_slug,member_id,day_rate,week_rate,month_rate,wage,currency,notes,created_at,created_by,updated_at,updated_by',
    levels: 'id,project_id,workspace_id,name,description,notes,status,thumbnail_image,start_date,end_date,sort_order,created_at,created_by,updated_at,updated_by',
    experiences: 'id,project_id,workspace_id,name,description,notes,status,thumbnail_image,start_date,end_date,sort_order,created_at,created_by,updated_at,updated_by',
    task_links: 'id,task_id,label,url,created_at,last_updated_by,last_updated_at,deleted_at,deleted_by,created_by,updated_by,updated_at',
    // M3 (night 5): the roster, the rate cards and entries, the templates, the versions — wilson-dev's (2026-10-28).
    project_members: 'project_id,user_id,workspace_id,project_role,created_at,created_by,updated_at,updated_by,project_title',
    rate_cards: 'id,workspace_id,name,source_file_id,is_default,created_at,last_updated_by,last_updated_at,deleted_at,deleted_by,created_by,updated_by,updated_at,type',
    rate_card_entries: 'id,rate_card_id,role_label,role_slug,region,project_size,day_rate,week_rate,month_rate,currency,source_row,last_updated_by,last_updated_at,deleted_at,deleted_by,created_by,updated_by,created_at,updated_at,member_id,wage,burden,burden_type,overhead,overhead_type,department',
    task_templates: 'id,workspace_id,project_id,name,description,tasks,created_at,created_by,updated_at,updated_by',
    asset_versions: 'id,asset_id,version_no,notes,thumbnail_url,file_id,created_at,last_updated_by,last_updated_at,deleted_at,deleted_by,created_by,updated_by,updated_at',
  }
  // M2: the five tables behind the money gate (0037), and the CHECKs and
  // defaulted NOT NULL columns wilson-dev answered with (rolled back).
  const MONEY = ['budget_versions', 'budget_lines', 'budget_actuals', 'expenses', 'project_rate_overrides']
  const PROJECT_STATUSES = ['draft', 'active', 'on_hold', 'inactive', 'wrapped', 'completed', 'archived', 'cancelled']
  const ENTITY_STATUSES = ['not_started', 'in_progress', 'pending_review', 'needs_revisions', 'approved', 'final', 'blocked', 'on_hold', 'omitted']
  const NOT_NULL = {
    budget_versions: ['name', 'type', 'is_active', 'snapshot'],
    budget_lines: ['sheet', 'sort_order', 'is_section_header', 'rate', 'days', 'qty', 'cost', 'is_na_days', 'is_na_qty', 'agency_opt_out'],
    budget_actuals: ['line_id', 'column_index', 'value', 'source'],
    expenses: ['title', 'estimated_cost', 'actual_cost', 'asset_ids', 'phase_ids', 'task_ids', 'file_ids'],
    project_rate_overrides: ['currency'],
    levels: ['status', 'sort_order'], experiences: ['status', 'sort_order'],
    task_links: ['task_id', 'url'],
  }
  const NUMBERS = { budget_lines: ['rate', 'days', 'qty', 'cost', 'margin_pct', 'contingency_pct', 'talent_agency_fee_pct'], budget_actuals: ['value'], expenses: ['estimated_cost', 'actual_cost'], project_rate_overrides: ['day_rate', 'week_rate', 'month_rate', 'wage'], rate_card_entries: ['day_rate', 'week_rate', 'month_rate', 'wage', 'burden', 'overhead'] }
  const chk = (table, name) => no('23514', `new row for relation "${table}" violates check constraint "${name}"`)
  const has = (table, pred) => (state.lists[table] || []).some(pred)
  const no = (code, message) => ({ code, message })
  const fk = (table, key) => no('23503', `insert or update on table "${table}" violates foreign key constraint "${key}"`)
  const dup = (key) => no('23505', `duplicate key value violates unique constraint "${key}"`)
  const sameName = (a, b) => String(a.title ?? '').trim() === String(b.title ?? '').trim() && Number(a.version ?? 1) === Number(b.version ?? 1)
  // The database's own refusals, in its order: PostgREST's column check, the
  // BEFORE triggers (0084's guard), the primary key and the unique keys, the
  // foreign keys at the statement's end.
  // M1 review round 2: the UUID columns the runner's rows reach refuse ''
  // (measured on wilson-dev: 22P02, invalid input syntax for type uuid).
  const UUID_COLUMNS = { projects: ['producer_id', 'director_id'], milestones: ['phase_id'], files: ['phase_id', 'asset_id', 'task_id', 'scene_id', 'shot_id', 'folder_id'] }
  function cloudRefusal(table, row) {
    const cols = COLUMNS[table]?.split(',')
    const stray = cols && Object.keys(row).find(k => !cols.includes(k))
    if (stray) return no('PGRST204', `Could not find the '${stray}' column of '${table}' in the schema cache`)
    // M2: the money gate is RLS (0037): a person who is neither a workspace
    // admin nor the project's manager is refused row by row (42501 —
    // measured), a money file too (0038 / 0042).
    if (state.moneyGate === false && (MONEY.includes(table) || (table === 'files' && (row.is_financial || /\/INVOICES\//.test(String(row.storage_path)))))) return no('42501', `new row violates row-level security policy for table "${table}"`)
    for (const k of UUID_COLUMNS[table] || []) if (row[k] === '') return no('22P02', 'invalid input syntax for type uuid: ""')
    // M2: part 2's types, NOT NULLs and CHECKs (measured on wilson-dev).
    for (const k of NUMBERS[table] || []) if (row[k] === '' || (row[k] != null && !Number.isFinite(Number(row[k])))) return no('22P02', `invalid input syntax for type numeric: "${row[k]}"`)
    // A line's own percentages are NUMERIC(7,3) (measured, review round 1).
    if (table === 'budget_lines' && ['margin_pct', 'contingency_pct', 'talent_agency_fee_pct'].some(k => row[k] != null && Math.abs(Number(row[k])) >= 9999.9995)) return no('22003', 'numeric field overflow')
    for (const k of NOT_NULL[table] || []) if (k in row && row[k] == null) return no('23502', `null value in column "${k}" of relation "${table}" violates not-null constraint`)
    if (table === 'budget_versions' && !('name' in row)) return no('23502', 'null value in column "name" of relation "budget_versions" violates not-null constraint')
    if (table === 'budget_versions' && row.type != null && !['bid', 'actual', 'final'].includes(row.type)) return chk(table, 'budget_versions_type_check')
    if (table === 'budget_lines' && row.sheet != null && !['crew', 'talent', 'expenses_travel'].includes(row.sheet)) return chk(table, 'budget_lines_sheet_check')
    if (table === 'budget_lines' && ['margin_pct', 'contingency_pct', 'talent_agency_fee_pct'].some(k => row[k] != null && Number(row[k]) < 0)) return chk(table, 'budget_lines_pct_nonneg')
    if (table === 'budget_actuals' && row.source != null && !['manual', 'timecard', 'expense'].includes(row.source)) return chk(table, 'budget_actuals_source_check')
    if (table === 'budget_actuals' && !(Number.isInteger(row.column_index) && row.column_index >= 0)) return chk(table, 'budget_actuals_column_index_check')
    if (table === 'expenses' && row.purchase_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.purchase_date))) return no('22007', `invalid input syntax for type date: "${row.purchase_date}"`)
    if (table === 'project_rate_overrides' && !((row.role_slug != null) !== (row.member_id != null))) return chk(table, 'project_rate_overrides_target_chk')
    if ((table === 'levels' || table === 'experiences') && row.status != null && !ENTITY_STATUSES.includes(row.status)) return chk(table, `${table}_status_chk`)
    if (table === 'files' && row.is_financial && row.storage_provider !== 'supabase') return chk(table, 'files_money_provider_chk')
    // M3: the five tables as wilson-dev answered (rolled back, 2026-10-28). The
    // roster: the gate (42501), the role CHECK, the pair, a user who is no
    // member of the project's workspace (23503). A card: the policy's
    // workspace test before anything else (42501: none, or the desktop's seed
    // id), the type CHECK. An entry: the gate (admin or the edit grant), the
    // two type CHECKs, its card. A template: the workspace test and the write
    // gate (42501), tasks an array, a pinned project of this workspace (the
    // composite key). A files row: the provider enum.
    if (table === 'project_members') {
      if (state.rosterGate === false) return no('42501', 'new row violates row-level security policy for table "project_members"')
      if (row.project_role != null && !['manager', 'reviewer', 'member'].includes(row.project_role)) return chk(table, 'project_members_project_role_check')
      if (has(table, r => r.project_id === row.project_id && r.user_id === row.user_id)) return dup('project_members_pkey')
      const project = (state.lists.projects || []).find(p => p.id === row.project_id)
      if (!has('workspace_members', m => m.user_id === row.user_id && m.workspace_id === (project?.workspace_id ?? FAKE_WS) && m.is_active !== false)) return fk(table, 'project_members_member_fkey')
    }
    if (table === 'rate_cards') {
      if (row.workspace_id !== FAKE_WS) return no('42501', 'new row violates row-level security policy for table "rate_cards"')
      if (row.type != null && !['general', 'internal'].includes(row.type)) return chk(table, 'rc_type_chk')
    }
    if (table === 'rate_card_entries') {
      if (state.entryGate === false) return no('42501', 'new row violates row-level security policy for table "rate_card_entries"')
      for (const k of ['burden_type', 'overhead_type']) if (row[k] != null && !['percent', 'fixed'].includes(row[k])) return chk(table, k === 'burden_type' ? 'rce_burden_type_chk' : 'rce_overhead_type_chk')
      if (!has('rate_cards', c => c.id === row.rate_card_id)) return fk(table, 'rate_card_entries_rate_card_id_fkey')
    }
    if (table === 'task_templates') {
      if (row.workspace_id !== FAKE_WS || state.templateGate === false || (state.templateGate === 'pinned' && row.project_id == null)) return no('42501', 'new row violates row-level security policy for table "task_templates"')
      if (row.tasks != null && !Array.isArray(row.tasks)) return chk(table, 'task_templates_tasks_is_array_chk')
      if (row.project_id != null && !has('projects', p => p.id === row.project_id && p.workspace_id === row.workspace_id)) return fk(table, 'task_templates_project_workspace_fk')
    }
    if (table === 'files' && row.storage_provider != null && !['supabase', 'google_drive', 'local_server', 's3'].includes(row.storage_provider)) return no('22P02', `invalid input value for enum storage_provider: "${row.storage_provider}"`)
    if (table === 'projects') {
      // M1 review round 1: the column types and NOT NULL defaults, read on
      // wilson-dev (project_status's values — M2: 0103's eight, or the five
      // of a cloud without it; DATE; the defaulted columns).
      if (row.status != null && !(state.pre0103 ? ['active', 'on_hold', 'completed', 'archived', 'cancelled'] : PROJECT_STATUSES).includes(row.status)) return no('22P02', `invalid input value for enum project_status: "${row.status}"`)
      // A DATE takes a string that starts with a day (its time and offset ignored — measured), never '' or a word.
      for (const k of ['start_date', 'end_date']) if (row[k] != null && !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(String(row[k]))) return no('22007', `invalid input syntax for type date: "${row[k]}"`)
      for (const k of ['budget_actual_column_count', 'scene_digits', 'shot_digits', 'scene_start_number']) if (row[k] != null && !Number.isInteger(Number(row[k]))) return no('22P02', `invalid input syntax for type integer: "${row[k]}"`)
      for (const k of ['budget_actual_column_count', 'scene_digits', 'shot_digits', 'scene_start_number']) if (row[k] != null && Math.abs(Number(row[k])) > 2147483647) return no('22003', 'integer out of range')
      // NUMERIC's room: 0000's budget_total (12,2), 0036's percentages (7,3), 0040's fps (6,2).
      for (const [k, room] of [['budget_total', 1e10], ['budget_margin_pct', 1e4], ['budget_contingency_pct', 1e4], ['budget_agency_pct', 1e4], ['fps', 1e4]]) if (row[k] != null && Math.abs(Number(row[k])) >= room) return no('22003', 'numeric field overflow')
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
    // Review round 1: the pair keys wilson-dev holds (measured): the same
    // fact under another id.
    if (table === 'task_items' && has(table, i => i.task_id === row.task_id && i.entity_type === row.entity_type && i.entity_id === row.entity_id)) return dup('task_items_task_entity_key')
    if (table === 'task_dependencies' && has(table, d => d.predecessor_id === row.predecessor_id && d.successor_id === row.successor_id)) return dup('task_dependencies_predecessor_id_successor_id_key')
    if (table === 'bin_locations' &&has(table, r => String(r.unc_path).toLowerCase() === String(row.unc_path).toLowerCase())) return dup('bin_locations_workspace_unc_key')
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
    // M2: part 2's keys, as wilson-dev holds them (measured): plain keys take
    // any project's row; the composite ones only this project's.
    if (table === 'files') for (const [k, t] of [['level_id', 'levels'], ['experience_id', 'experiences']]) if (row[k] != null && !has(t, r => r.id === row[k])) return fk(table, `files_${k}_fkey`)
    if (table === 'assets' && row.task_template_id != null && !has('task_templates', r => r.id === row.task_template_id)) return fk(table, 'assets_task_template_id_fkey')
    if ((table === 'assets' || table === 'tasks') && row.phase_id != null && !has('phases', p => p.id === row.phase_id)) return fk(table, `${table}_phase_id_fkey`)
    if (table === 'phases' && row.parent_phase_id != null && !has('phases', p => p.id === row.parent_phase_id)) return fk(table, 'phases_parent_phase_id_fkey')
    if (table === 'task_items' && (row.entity_type === 'level' || row.entity_type === 'experience') && !has(`${row.entity_type}s`, r => r.id === row.entity_id && r.project_id === row.project_id)) return fk(table, `task_items_${row.entity_type}_fk`)
    if (table === 'budget_versions' && row.shot_list_id != null && !has('shot_lists', l => l.id === row.shot_list_id && l.project_id === row.project_id)) return fk(table, 'budget_versions_shot_list_fk')
    if (table === 'budget_actuals') {
      if (!has('budget_lines', l => l.id === row.line_id)) return fk(table, 'budget_actuals_line_id_fkey')
      if (has(table, a => a.line_id === row.line_id && a.column_index === row.column_index)) return dup('budget_actuals_line_column_uniq')
    }
    if (table === 'project_rate_overrides' && row.role_slug != null && has(table, o => o.project_id === row.project_id && o.role_slug === row.role_slug)) return dup('project_rate_overrides_role_uniq')
    if (table === 'task_links' && !has('tasks', t => t.id === row.task_id)) return fk(table, 'task_links_task_id_fkey')
    return null
  }
  // M2: an UPDATE of a project's locked or open bid version, past 0089's and
  // 0090's guards (the money gate) and their keys — the lock's single-column
  // (any project's version: measured), the open one's this project's.
  function updateRefusal(table, patch, row) {
    if (table !== 'projects') return null
    for (const col of ['budget_active_version_id', 'open_budget_version_id']) {
      if (!(col in patch) || patch[col] === row[col]) continue
      if (state.moneyGate === false) {
        return col === 'open_budget_version_id'
          ? no('42501', 'the open bid version is changed only by someone who can see this project\'s budget (a project manager or a workspace admin)')
          : no('42501', 'the budget\'s settings (margin, contingency, agency, actuals and the lock) are changed only by someone who can see this project\'s budget (a project manager or a workspace admin)')
      }
      if (patch[col] == null) continue
      if (col === 'budget_active_version_id' && !has('budget_versions', v => v.id === patch[col])) return fk('projects', 'projects_budget_active_version_id_fkey')
      if (col === 'open_budget_version_id' && !has('budget_versions', v => v.id === patch[col] && v.project_id === row.id)) return fk('projects', 'projects_open_budget_version_fk')
    }
    return null
  }
  // The money gate (0037, 0038) and the Legal gate (0092) hide their rows from
  // anyone they shut out (review round 1).
  const hiddenByGate = (table, r) => (state.moneyGate === false && (MONEY.includes(table) || (table === 'files' && r?.is_financial === true)))
    || (state.legalGate === false && table === 'files' && Array.isArray(r?.tags) && r.tags.includes('legal'))
    // M3: a trashed card is hidden (0014's select policy) and so is another
    // workspace's row of the workspace kinds (their policies' workspace test);
    // both still hold their keys.
    || (table === 'rate_cards' && r?.deleted_at != null)
    || (['rate_cards', 'task_templates', 'project_members'].includes(table) && r?.workspace_id != null && r.workspace_id !== FAKE_WS)
  // M3 (review round 1): fn_projects_auto_staff, as wilson-dev's trigger
  // (measured): the project's insert seats the person who made it, and a
  // producer who is a member of the workspace, as its managers; the trigger
  // swallows a refusal, so a producer who is no member is not seated and the
  // project lands. A seat already there is left as it is.
  const autoStaff = (project, who = [state.callerId, project.producer_id]) => {
    const seats = (state.lists.project_members ||= [])
    for (const userId of who) {
      if (!userId || seats.some(s => s.project_id === project.id && s.user_id === userId)) continue
      if (userId !== state.callerId && !has('workspace_members', m => m.user_id === userId && m.workspace_id === (project.workspace_id ?? FAKE_WS) && m.is_active !== false)) continue
      seats.push({ project_id: project.id, user_id: userId, workspace_id: project.workspace_id ?? FAKE_WS, project_role: 'manager', project_title: null })
    }
  }
  const builder = (table) => {
    const q = { table, cols: null, filters: [], range: null, ins: [], badOrder: null }
    // A filter as PostgREST applies it: `eq`, or `is` (null).
    const matches = (r) => q.filters.every(([c, v, op]) => (op === 'is' && v === null ? r[c] == null : r[c] === v))
    const api = {
      select(cols) { q.cols = cols; return api },
      eq(col, value) { q.filters.push([col, value]); return api },
      // M3: `is.null` (a column still empty).
      is(col, value) { q.filters.push([col, value, 'is']); return api },
      // M2: `in.(…)` (the record's ids, a project's links through its tasks).
      in(col, values) { q.ins.push([col, values.map(String)]); state.inReads.push([table, col, values.length]); return api },
      // M3 (design review, finding 8): an order by a column the table lacks is
      // refused, as Postgres refuses it (project_members has no id).
      order(col) { if (col && COLUMNS[table] && !COLUMNS[table].split(',').includes(col)) q.badOrder = col; return api },
      range(from, to) { q.range = [from, to]; state.ranges.push([table, from, to]); return api },
      maybeSingle: async () => {
        if (state.singleError) return { data: null, error: state.singleError }
        const by = q.filters.find(f => f[0] === 'id')
        // A row set for the test, else the row in the cloud by its id (M1:
        // a project's active list, a file already there on a second run) —
        // review round 1: not a money file past a shut gate (0038's RLS).
        // M3: with no id asked, the first row the filters match (the
        // workspace's storage row).
        const one = by
          ? (state.single[table]?.[by?.[1]] ?? (state.lists[table] || []).find(r => r.id === by?.[1] && !hiddenByGate(table, r)) ?? null)
          : ((state.lists[table] || []).find(r => matches(r) && !hiddenByGate(table, r)) ?? null)
        return { data: one && by && state.single[table]?.[by?.[1]] ? one : one ? { ...one } : null, error: null }
      },
      // A list read: `await client.from(t).select(c).eq(k, v).order().range()`.
      // PostgREST's own cap: at most 1,000 rows an answer (config.toml max_rows).
      then(resolve) {
        if (state.listError) return resolve({ data: null, error: state.listError })
        if (state.listErrorFor?.[table]) return resolve({ data: null, error: state.listErrorFor[table] })
        if (q.badOrder) return resolve({ data: null, error: no('42703', `column ${table}.${q.badOrder} does not exist`) })
        const all = (state.lists[table] || []).filter(r => matches(r) && q.ins.every(([c, vs]) => vs.includes(String(r[c]))))
          // The money gate hides a money table's rows from anyone else
          // (0037), and a money file (0038 — review round 1).
          .filter(r => !hiddenByGate(table, r))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
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
        // The row is now "in the cloud" for later reads of this run. M3: a
        // seat takes its project's workspace (0013's trigger overwrites it).
        const stored = table === 'project_members' ? { ...row, workspace_id: (state.lists.projects || []).find(p => p.id === row.project_id)?.workspace_id ?? FAKE_WS } : { ...row }
        ;(state.lists[table] ||= []).push(stored)
        if (table === 'projects') autoStaff(stored)
        return { error: null }
      },
      update(patch) {
        const u = { table, patch, filters: [], selected: false }
        const chain = {
          eq(col, value) { u.filters.push([col, value]); return chain },
          is(col, value) { u.filters.push([col, value, 'is']); return chain },
          select() { u.selected = true; return chain },
          then(resolve) {
            state.updates.push(u)
            // A teammate's removal between the insert and this PATCH.
            if (state.dropOnUpdate) state.lists[table] = (state.lists[table] || []).filter(r => !state.dropOnUpdate(table, r, u))
            const hit = (state.lists[table] || []).filter(r => u.filters.every(([c, v, op]) => (op === 'is' && v === null ? r[c] == null : r[c] === v)) && !hiddenByGate(table, r))
            // Review round 1: a write the network or the database refused.
            const forced = state.failUpdate?.(table, patch)
            if (forced) return resolve({ data: null, error: forced })
            // M2: the guards and keys an UPDATE meets (updateRefusal).
            for (const r of hit) { const refused = updateRefusal(table, patch, r); if (refused) return resolve({ data: null, error: refused }) }
            for (const r of hit) { Object.assign(r, patch); if (table === 'projects' && 'producer_id' in patch) autoStaff(r, [r.producer_id]) }
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
    // M3: the signed-in person (the people map asks who is running; the
    // resumable path reads the token per request).
    auth: { getSession: async () => ({ data: { session: state.callerId ? { user: { id: state.callerId }, access_token: 'tok' } : null }, error: null }) },
    // M3: a bucket's objects (`state.objects`: bucket, name, size) — listed as
    // storage-api lists a directory's own children (`search` on the leaf, as
    // supabaseProvider.exists asks), uploaded with upsert off (a taken key is
    // refused), removed, and moved (a missing source or a taken destination
    // refused, as the API refuses them).
    storage: {
      from(bucket = 'rabbit-files') {
        const inBucket = () => state.objects.filter(o => o.bucket === bucket)
        return {
          list: async (dir = '', opts = {}) => {
            const prefix = dir ? `${dir}/` : ''
            const data = inBucket().filter(o => o.name.startsWith(prefix) && !o.name.slice(prefix.length).includes('/'))
              .map(o => ({ name: o.name.slice(prefix.length), metadata: { size: o.size } }))
              .filter(o => !opts.search || o.name.includes(opts.search))
            return { data, error: null }
          },
          upload: async (path, bytes, opts) => {
            const override = state.failWith?.('storage', { path, bucket })
            if (override) return { error: override }
            if (inBucket().some(o => o.name === path)) return { error: { message: 'The resource already exists', statusCode: '409' } }
            const size = bytes?.size ?? bytes?.length ?? 0
            state.uploads.push({ path, size, bucket, contentType: opts?.contentType })
            state.objects.push({ bucket, name: path, size })
            return { error: null }
          },
          remove: async (keys) => { state.removed.push(...keys); state.objects = state.objects.filter(o => !(o.bucket === bucket && keys.includes(o.name))); return { error: null } },
          move: async (from, to) => {
            const refused = state.failMove?.(bucket, from, to)
            if (refused) return { error: refused }
            const src = inBucket().find(o => o.name === from)
            if (!src) return { error: { message: 'Object not found', statusCode: '404' } }
            if (inBucket().some(o => o.name === to)) return { error: { message: 'The resource already exists', statusCode: '409' } }
            src.name = to
            state.moves.push({ bucket, from, to })
            return { data: { message: 'Successfully moved' }, error: null }
          },
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
      // M3: the company's directory (0060: emails for an admin or manager —
      // the test sets the rows as the caller would see them), the quota's
      // reservation (0073: an id for an ordinary key, null for a money one).
      if (fn === 'workspace_directory') return state.directoryError ? { data: null, error: state.directoryError } : { data: state.directory.map(r => ({ ...r })), error: null }
      if (fn === 'reserve_upload_bytes') { state.reservations.push(args); return { data: /\/(INVOICES|FINANCE|LEGAL)\//.test(String(args?.p_path || '')) ? null : state.reservations.length, error: null } }
      if (fn === 'release_upload_reservation' || fn === 'abandon_upload_reservation') { state.released.push([fn, args]); return { data: true, error: null } }
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
      // M2: the money gate as 0037 answers it — NULL, never false, for a
      // member with no seat on the project (measured).
      if (fn === 'can_access_project_money') return { data: state.moneyGate === false ? null : true, error: null }
      // M2: 0090's one writer of set-aside rows.
      if (fn === 'set_aside_schedule_rows') {
        const at = '2026-10-28T00:00:00.000Z'
        const n = {}
        for (const [table, ids] of [['tasks', args.p_tasks], ['phases', args.p_phases], ['milestones', args.p_milestones]]) {
          n[table] = 0
          for (const r of state.lists[table] || []) if ((ids || []).includes(r.id) && r.project_id === args.p_project) { r.set_aside_at = at; n[table]++ }
        }
        return { data: { ...n, set_aside_at: at }, error: null }
      }
      return { data: null, error: null }
    },
  }
  return { state, client }
})

vi.mock('../auth/supabaseClient', () => ({ supabase: fake.client }))

// M3: the tus double reads the source the runner hands it (the library's
// fileReader option) chunk by chunk, as tus does — each slice one Range
// request of the fake desktop — and records the chunks, the key and the
// headers; the object then exists in the fake bucket, as a completed upload's
// does. The source must say `done` exactly at its end, or the double throws
// (tus errors by design).
vi.mock('tus-js-client', () => ({
  Upload: class {
    constructor(body, opts) { this.body = body; this.opts = opts }
    start() {
      const { body, opts } = this
      ;(async () => {
        try {
          if (!opts.fileReader?.openFile) throw new Error('the double takes a source through fileReader only')
          const source = await opts.fileReader.openFile(body, opts.chunkSize)
          const chunks = []
          let start = 0
          for (;;) {
            const end = Math.min(start + opts.chunkSize, source.size)
            const { value, done } = await source.slice(start, end)
            chunks.push(value?.size ?? 0)
            if ((end >= source.size) !== !!done) throw new Error(`done was ${done} at ${end} of ${source.size}`)
            start = end
            if (done) break
          }
          source.close?.()
          fake.state.tus.push({ key: opts.metadata.objectName, bucket: opts.metadata.bucketName, chunks, headers: opts.headers })
          fake.state.objects.push({ bucket: opts.metadata.bucketName, name: opts.metadata.objectName, size: chunks.reduce((a, c) => a + c, 0) })
          opts.onSuccess()
        } catch (err) {
          opts.onError(err)
        }
      })()
    }
  },
}))

const {
  runMigration, BINS_LEFT_BEHIND, POSTERS_SWITCH_OFF, ORPHAN_TAKES, PROJECT_FOLDER_STAYS, ARCHIVED_AGAIN,
  KEY_DATES_TRASHED, COMMENTS_ON_GONE_ROWS, FILES_PLACED, INVOICES_FILED, SHOT_LIST_NAME_TAKEN, LIVE_IN_CLOUD, FOLDERS_OF_GONE_ROWS, FOLDERS_TAKEN,
  KEY_DATES_PHASE_LET_GO, FILE_LINKS_LET_GO, EDITS_CHAIN_TAKEN, STATUS_NOT_IN_CLOUD, VALUES_NOT_IN_CLOUD,
  REMOVED_SINCE_LAST_RUN, MONEY_GATE_LEFT, RECEIPTS_GATED, SET_ASIDE_AGAIN, RECORD_NOT_KEPT, TASK_LINKS_ON_GONE_TASKS, ROW_LINKS_LET_GO, removedWords,
  PROJECT_NOT_OURS, LINE_PCTS_LEFT_OUT, ACTUALS_TAKEN, RATES_TAKEN, RECEIPTS_LEFT_OPEN,
} = await import('./runMigration')
const { pathKey } = await import('./binsMigration')
const { projectRowForCloud, cloudDay, RECORD_KEY, budgetLineRowForCloud } = await import('./migrationRows')
const { clearWorkspaceStorageCache } = await import('../workspaceStorage')
const { BINS, BIN_FILES, SHOT_TAKES, SCENES, SHOTS, BIN_LOCATIONS, SHOT_LISTS, SHOT_LIST_ITEMS, EDITS, TASK_ITEMS, GAME_LEVELS, GAME_EXPERIENCES, GAME_LINKS, GAME_TASK_ITEMS } = await import('../../dev/fixtures/data/scenes')
const { PROJECT, PHASES, MILESTONES, ASSETS, TASKS, DEPENDENCIES, COMMENTS, TASK_LINKS, ASSET_ID } = await import('../../dev/fixtures/data/project')
const { FOLDERS, FILES, GAME_FOLDERS, GAME_FILES } = await import('../../dev/fixtures/data/files')
const { BUDGET_VERSIONS, BUDGET_LINES, BUDGET_ACTUALS, EXPENSES, PROJECT_RATE_OVERRIDES, RATE_CARDS, RATE_CARD_ENTRIES, GENERAL_CARD_ID } = await import('../../dev/fixtures/data/money')
const { MEMBERS, MEMBER_ID } = await import('../../dev/fixtures/data/workspace')
const { TASK_TEMPLATES } = await import('../../dev/fixtures/data/project')

// M2: the desktop's record route (electron/main.cjs), its merge lifted by
// brace matching as desktopDeleteSweep.test.js lifts the sweep, so the fake
// desktop below keeps the record exactly as the real one does.
const MAIN_CJS = readFileSync(new URL('../../../electron/main.cjs', import.meta.url), 'utf-8')
function liftFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`main.cjs no longer defines ${name}() — the round trip cannot keep the record`)
  let depth = 0
  for (let j = source.indexOf('{', source.indexOf(')', start)); j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}' && --depth === 0) return source.slice(start, j + 1)
  }
  throw new Error(`unbalanced braces lifting ${name}() from main.cjs`)
}
// eslint-disable-next-line no-new-func
const mergeCloudMigrationRecord = new Function(`${liftFunction(MAIN_CJS, 'mergeCloudMigrationRecord')}\nreturn mergeCloudMigrationRecord`)()

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
let servedStores
let servedRecord
let servedGone
let streamCalls
let streamEvents
let posterStatus
let bundleWrites
let recordWrites
let recordStatus
// M3: `extra.stores` — the desktop's workspace stores (`members`, `rateCards`
// as `[{ card, entries, deptDefaults }]`, `templates`), each row carrying the
// workspace id it was written under; `extra.workspaceRecord` — the holder the
// workspace route keeps; `extra.gone` — the managed files whose body is not on
// the disk (410); `extra.noWorkspaceRoute` — an older desktop (404).
function serve(bundles, extra = {}) {
  served = bundles
  servedStores = extra.stores || { members: [], rateCards: [], templates: [] }
  servedRecord = extra.workspaceRecord || { cloudMigration: {} }
  servedGone = extra.gone || new Set()
  streamCalls = []
  streamEvents = 0
  globalThis.fetch = vi.fn(async (url, init) => {
    // M2: the one write the migration makes on this computer — its record,
    // into the bundle beside the rows it is about (never the rows).
    const rec = /^\/api\/rabbit\/projects\/([^/]+)\/cloud-migration-record$/.exec(url)
    if (rec && init?.method === 'POST') {
      const body = JSON.parse(init.body)
      recordWrites.push({ projectId: rec[1], ...body })
      if (recordStatus !== 200) return { ok: false, status: recordStatus }
      const b = served.find(x => x.project.id === rec[1])
      const added = b ? mergeCloudMigrationRecord(b, body) : null
      return added === null ? { ok: false, status: b ? 400 : 404 } : { ok: true, status: 200, json: async () => ({ ok: true, added }) }
    }
    // M3: the workspace record's route (electron/main.cjs: the same merge,
    // a body naming another workspace refused).
    const wrec = /^\/api\/rabbit\/workspaces\/([^/]+)\/cloud-migration-record$/.exec(url)
    if (wrec) {
      if (extra.noWorkspaceRoute) return { ok: false, status: 404 }
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body)
        if (body.workspace_id !== decodeURIComponent(wrec[1])) return { ok: false, status: 400 }
        recordWrites.push({ workspaceId: decodeURIComponent(wrec[1]), ...body })
        if (recordStatus !== 200) return { ok: false, status: recordStatus }
        const added = mergeCloudMigrationRecord(servedRecord, body)
        return added === null ? { ok: false, status: 400 } : { ok: true, status: 200, json: async () => ({ ok: true, added }) }
      }
      return { ok: true, status: 200, json: async () => ({ cloudMigration: JSON.parse(JSON.stringify(servedRecord.cloudMigration || {})) }) }
    }
    if (init?.method && init.method !== 'GET') { bundleWrites.push(url); return { ok: false, status: 405 } }
    // M3: the desktop's workspace stores, each by the workspace id its rows carry.
    const store = /^\/api\/rabbit\/workspaces\/([^/]+)\/(team-members|rate-cards|task-templates)$/.exec(url)
    if (store) {
      const ws = decodeURIComponent(store[1])
      const rows = store[2] === 'team-members' ? servedStores.members : store[2] === 'rate-cards' ? servedStores.rateCards.map(c => c.card) : servedStores.templates
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(rows.filter(r => r.workspace_id === ws))) }
    }
    const cardPart = /^\/api\/rabbit\/rate-cards\/([^/]+)\/(entries|dept-defaults)$/.exec(url)
    if (cardPart) {
      const c = servedStores.rateCards.find(x => String(x.card.id) === decodeURIComponent(cardPart[1]))
      if (!c) return { ok: false, status: 404 }
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(cardPart[2] === 'entries' ? c.entries : c.deptDefaults)) }
    }
    // M3: a managed file's stream as the desktop serves it: Range (206, the
    // true size in Content-Range; 416 past the end), the whole body without
    // one, 410 for a body gone from the disk, 404 for a row gone. A read
    // without `?probe=1` would write a 'downloaded' event: counted.
    const stream = /^\/api\/rabbit\/projects\/([^/]+)\/managed-files\/([^/]+)\/stream(\?.*)?$/.exec(url)
    if (stream) {
      const probe = (stream[3] || '').includes('probe=1')
      const b = served.find(x => x.project.id === stream[1])
      const mf = (b?.managedFiles || []).find(f => f.id === stream[2] && !f.deleted_at)
      const range = init?.headers?.Range || init?.headers?.range || null
      streamCalls.push({ id: stream[2], range, probe })
      if (!probe) streamEvents++
      const h = (map) => ({ get: (n) => map[String(n).toLowerCase()] ?? null })
      if (!mf) return { ok: false, status: 404, headers: h({}) }
      if (servedGone.has(mf.id)) return { ok: false, status: 410, headers: h({}) }
      const size = Number(mf.size_bytes) || 0
      if (range) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(range)
        const a = Number(m?.[1] ?? 0)
        let z = m?.[2] === '' || m?.[2] == null ? size - 1 : Number(m[2])
        if (a >= size) return { ok: false, status: 416, headers: h({ 'content-range': `bytes */${size}` }) }
        if (z >= size) z = size - 1
        return { ok: true, status: 206, headers: h({ 'content-range': `bytes ${a}-${z}/${size}`, 'content-length': String(z - a + 1) }), blob: async () => ({ size: z - a + 1, type: mf.mime_type || '' }) }
      }
      return { ok: true, status: 200, headers: h({ 'content-length': String(size) }), blob: async () => ({ size, type: mf.mime_type || '' }) }
    }
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
  Object.assign(fake.state, { inserts: {}, updates: [], log: [], failWith: null, failUpdate: null, uploads: [], removed: [], lists: {}, listError: null, listErrorFor: {}, single: {}, singleError: null, ranges: [], dropOnUpdate: null, rpcs: [], rpcRefuse: {}, trash: {}, moneyGate: true, legalGate: true, pre0103: false, inReads: [], callerId: 'u-mover', directory: [], directoryError: null, reservations: [], released: [], objects: [], moves: [], tus: [], rosterGate: true, entryGate: true, templateGate: true, failMove: null })
  fake.state.single.workspaces = { [WS]: { remote_viewing_enabled: false } }
  posterStatus = {}
  bundleWrites = []
  recordWrites = []
  recordStatus = 200
  // M3: the resumable path reads these at call time (never from a developer's
  // .env.local: CI has none); the storage rule's cache is per session.
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-tests')
  clearWorkspaceStorageCache()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

const ins = (t) => fake.state.inserts[t] || []
const byId = (t, id) => ins(t).find(r => r.id === id)
// A new, empty cloud for the same desktop (M2: its bundle forgets what an
// earlier run carried too, which would read as removed from the new cloud).
const newCloud = (patch) => { Object.assign(fake.state, patch); for (const b of served || []) delete b[RECORD_KEY] }

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
    expect(report.notCarried).toEqual([{ key: 'thumbnails', label: 'scene, shot, level and experience pictures', count: 2, later: false }])
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
    newCloud({ inserts: {}, lists: {}, log: [] })
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

  it('what the migration does not carry is counted, summed over the projects, in the dry run and the real one — a later run\'s apart from what no migration carries', async () => {
    const a = realBundle()
    // Since M1 a comment and a shot list are carried, since M2 a budget line
    // and a level; an asset version waits for a later run, and a scene's
    // picture stays.
    a.budgetLines = [{ id: 'bl1' }, { id: 'bl2' }]; a.levels = [{ id: 'lv1' }]; a.assetVersions = [{ id: 'av1' }]
    const b = { project: { id: 'p-two', title: 'Two' }, phases: [], assets: [], tasks: [], files: [], dependencies: [], levels: [{ id: 'lv2' }] }
    serve([a, b])
    seedNas()
    // Summed over the two projects, the word in the right number for the sum.
    // M3: an asset version is a kind no desktop writes (said as that).
    const expected = [
      { key: 'assetVersions', label: 'asset version (no desktop writes one)', count: 1, later: false },
      { key: 'thumbnails', label: 'scene, shot, level and experience pictures', count: 2, later: false },
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
    newCloud({ inserts: {}, lists: {} })
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
    newCloud({ inserts: {}, lists: {}, uploads: [], removed: [], dropOnUpdate: null })
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
// folder_id (projectFileStream.cjs writes one only for an invoice or a
// receipt since M1-L7, and these are older rows), no workspace on any row,
// the desktop's archive (archived_by null: it has no people). A key date keeps
// the fixtures' `name` beside its title, as an older build's row may.
const DESKTOP_WS = '00000000-0000-0000-0000-000000000001'
const SALT_LOCATIONS = { [pathKey(BIN_LOCATIONS[0].unc_path)]: { unc_path: BIN_LOCATIONS[0].unc_path, name: 'Footage NAS' } }
const omit = (row, keys) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)))
const local = (rows) => rows.map(r => omit(r, ['workspace_id']))
const LIST_1 = SHOT_LISTS[0].id
const LIST_2 = SHOT_LISTS[1].id
// M2 (night 4): and part 2 in the shape the desktop's writers make it
// (measured from each writer, electron/main.cjs storing what they send):
// the game variant's levels and experiences — a picture a path on this disk,
// one carrying the older add's `files` key — with their folders and files;
// the assets' links to them and the tasks' items about them; the links on
// tasks with the project_id the desktop stamps; the bid versions, the lines
// (the fixtures' section headers with null numbers), the actuals — one whose
// receipt is a files row (`file:<id>`), one attached by a path on this
// computer — the expenses (one with the add's '' day), a role's rate and a
// team member's.
const desktopPath = (name) => `C:\\Users\\someone\\Pictures\\${name}.png`
const LEVEL_OF = new Map(GAME_LINKS.map(([n, levels, experiences]) => [ASSET_ID(n), {
  level_ids: levels.map(l => GAME_LEVELS[l - 1].id), experience_ids: experiences.map(x => GAME_EXPERIENCES[x - 1].id),
}]))
const RECEIPT = FILES.find(f => f.is_financial).id
const ROLE_RATE = { id: '00000000-0000-4000-8000-0000000000e1', project_id: PROJECT.id, role_slug: 'editor', member_id: null, day_rate: 550, currency: 'USD', created_at: '2026-10-20T10:00:00.000Z', updated_at: '2026-10-20T10:00:00.000Z' }
const desktopFile = (f) => ({
  ...omit(f, ['workspace_id', 'folder_id', 'thumbnail_url', 'created_by', 'updated_by', 'last_updated_at', 'last_updated_by', 'deleted_at', 'deleted_by']),
  storage_provider: 'local_server', storage_path: `${f.id}-${f.name}`,
})
// M3 (night 5): the desktop knows people by its own team-member ids. The
// fixtures' eight as the desktop's team store keeps them (useTeamMembers'
// shape: a desktop id each, the fixtures' email — Lena's missing, as a member
// added without one), plus Nadia, whom no company account matches, and Dev
// added a second time (two desktop entries, one email). Every person column
// of a desktop bundle names these ids; the cloud's rows name the accounts.
const DESKTOP_MEMBERS = MEMBERS.map((m, i) => ({
  id: `0e1a0000-0000-4000-8000-00000000d${String(i + 1).padStart(3, '0')}`, workspace_id: DESKTOP_WS,
  name: m.display_name, title: m.title, department: m.department, location: '', email: m.username === 'lena.fischer' ? '' : m.email,
  employment_type: 'fulltime', pronouns: [], profile_picture_url: null, created_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-08-01T10:00:00.000Z',
}))
const NADIA_ID = '0e1a0000-0000-4000-8000-00000000d009'
DESKTOP_MEMBERS.push({ id: NADIA_ID, workspace_id: DESKTOP_WS, name: 'Nadia Quill', title: 'Colourist', department: 'Post', location: '', email: 'nadia.quill@lanternash.example', employment_type: 'freelancer', pronouns: [], profile_picture_url: null, created_at: '2026-08-02T10:00:00.000Z', updated_at: '2026-08-02T10:00:00.000Z' })
const DEV_AGAIN_ID = '0e1a0000-0000-4000-8000-00000000d010'
DESKTOP_MEMBERS.push({ ...DESKTOP_MEMBERS[7], id: DEV_AGAIN_ID, workspace_id: WS, email: MEMBERS[7].email.toUpperCase() })
const DESKTOP_ID_OF = new Map(MEMBERS.map((m, i) => [String(m.user_id), DESKTOP_MEMBERS[i].id]))
const desktopIdOf = (userId) => (userId == null || userId === '' ? userId : DESKTOP_ID_OF.get(String(userId)) ?? userId)
// The desktop's workspace stores: the fixtures' two rate cards (their entries
// naming desktop ids, with the desktop's computed total; one department
// default on the General card; an internal entry for Nadia) and the
// desktop's own auto-made empty General shell; the two task templates.
function desktopStores() {
  const stamp = { created_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z' }
  const cardOf = (c) => ({ ...omit(c, ['deleted_at', 'source_file_id']), workspace_id: DESKTOP_WS, ...stamp })
  const entryOf = (e) => ({ ...e, member_id: desktopIdOf(e.member_id), total: 999, ...stamp })
  return {
    members: DESKTOP_MEMBERS,
    rateCards: [
      { card: cardOf(RATE_CARDS[0]), entries: RATE_CARD_ENTRIES.filter(e => e.rate_card_id === RATE_CARDS[0].id).map(entryOf), deptDefaults: [{ department: 'Post', burden_pct: 12, overhead_pct: 8 }] },
      { card: cardOf(RATE_CARDS[1]), entries: [...RATE_CARD_ENTRIES.filter(e => e.rate_card_id === RATE_CARDS[1].id).map(entryOf), { id: '0e1a0000-0000-4000-8000-00000000e100', rate_card_id: RATE_CARDS[1].id, role_label: 'Colourist', role_slug: 'colourist', member_id: NADIA_ID, wage: 50000, burden: 18, burden_type: 'percent', overhead: 10, overhead_type: 'percent', currency: 'USD', ...stamp }], deptDefaults: [] },
      { card: { id: '0e1a0000-0000-4000-8000-00000000c003', workspace_id: WS, name: 'General Rate Card', type: 'general', is_default: true, ...stamp }, entries: [], deptDefaults: [] },
    ],
    templates: TASK_TEMPLATES.map(t => ({ ...omit(t, ['created_by', 'updated_by']), workspace_id: DESKTOP_WS })),
  }
}
// The files the desktop keeps with its rows (FileManager's store), in the
// POST route's shape: a small image of an asset, a large video of a scene
// (above the resumable threshold, a second version), and one removed.
const MANAGED = {
  small: {
    id: '0e1a0000-0000-4000-8000-0000000f0001', project_id: PROJECT.id, asset_id: ASSET_ID(1), shot_id: null, scene_id: null, level_id: null, experience_id: null, task_id: null,
    file_name: 'plate', stored_name: 'Salt-Hours_plate_v001.png', original_name: 'plate.png', extension: '.png', mime_type: 'image/png', size_bytes: 3,
    version: 1, version_label: 'v001', folder_path: `${FOLDERS.find(f => f.asset_id === ASSET_ID(1)).path}/`, thumbnail_path: null, uploaded_by: null,
    uploaded_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z', deleted_at: null, notes: 'first plate', storage_provider: 'local_managed', tags: ['reference'],
  },
  large: {
    id: '0e1a0000-0000-4000-8000-0000000f0002', project_id: PROJECT.id, asset_id: null, shot_id: null, scene_id: SCENES[0].id, level_id: null, experience_id: null, task_id: null,
    file_name: 'plate_scan', stored_name: 'Salt-Hours_plate_scan_v002.mov', original_name: 'plate_scan.mov', extension: '.mov', mime_type: 'video/quicktime', size_bytes: 60 * 1024 * 1024 + 7,
    version: 2, version_label: 'v002', folder_path: `${FOLDERS.find(f => f.scene_id === SCENES[0].id).path}/`, thumbnail_path: null, uploaded_by: null,
    uploaded_at: '2026-10-03T10:00:00.000Z', updated_at: '2026-10-03T10:00:00.000Z', deleted_at: null, notes: 'second pass', storage_provider: 'local_managed',
  },
  deleted: {
    id: '0e1a0000-0000-4000-8000-0000000f0003', project_id: PROJECT.id, asset_id: ASSET_ID(1), file_name: 'old', stored_name: 'Salt-Hours_old_v001.png', original_name: 'old.png', extension: '.png', mime_type: 'image/png', size_bytes: 5,
    version: 1, version_label: 'v001', folder_path: `${FOLDERS.find(f => f.asset_id === ASSET_ID(1)).path}/`, uploaded_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-10-02T10:00:00.000Z', deleted_at: '2026-10-02T10:00:00.000Z', notes: '', storage_provider: 'local_managed',
  },
}
// …and the first asset made from the pinned template (the fixtures' assets
// name none; the desktop's New Asset dialog writes task_template_id).
const withManaged = (b) => ({
  ...b,
  managedFiles: [MANAGED.small, MANAGED.large, MANAGED.deleted].map(m => ({ ...m })),
  assets: b.assets.map((a, i) => (i === 0 ? { ...a, task_template_id: TASK_TEMPLATES[1].id } : a)),
})
// Lena has no email on the desktop: her account is never matched, so a row
// naming her arrives without the person (counted), as the ruling says.
const lenaIs = (uid) => String(uid) === String(MEMBER_ID.lena)
const expectUser = (uid) => (uid == null || lenaIs(uid) ? null : uid)
function desktopFixtures() {
  const pid = PROJECT.id
  return {
    ...fixturesBundle(),
    project: {
      ...omit(PROJECT, ['workspace_id', 'created_by', 'updated_by']),
      workspace_id: DESKTOP_WS, created_by: null,
      documents: [], visualAssets: [], files_dir: null,
      folder_slug: 'Salt-Hours', folder_root: 'C:\\Projects\\Salt-Hours',
      // M3: the people by the desktop's ids.
      producer_id: desktopIdOf(PROJECT.producer_id), director_id: desktopIdOf(PROJECT.director_id),
    },
    // M3: the team assignments (the Team tab's rows: a role, the dates it
    // keeps for two of them); Lena has no email here, Nadia no account.
    teamAssignments: [
      { id: '0e1a0000-0000-4000-8000-00000000a001', project_id: pid, member_id: desktopIdOf(MEMBER_ID.mara), role: 'manager', start_date: '2026-09-01', end_date: null },
      { id: '0e1a0000-0000-4000-8000-00000000a002', project_id: pid, member_id: desktopIdOf(MEMBER_ID.theo), role: 'member' },
      { id: '0e1a0000-0000-4000-8000-00000000a003', project_id: pid, member_id: desktopIdOf(MEMBER_ID.lena), role: 'member' },
      { id: '0e1a0000-0000-4000-8000-00000000a004', project_id: pid, member_id: NADIA_ID, role: 'reviewer' },
      { id: '0e1a0000-0000-4000-8000-00000000a005', project_id: pid, member_id: desktopIdOf(MEMBER_ID.dev), role: 'producer' },
      { id: '0e1a0000-0000-4000-8000-00000000a006', project_id: pid, member_id: DEV_AGAIN_ID, role: 'member' },
    ],
    phases: local(PHASES),
    milestones: MILESTONES.map(m => ({ ...m })),
    levels: GAME_LEVELS.map((l, i) => ({ ...omit(l, ['workspace_id']), thumbnail_image: desktopPath(l.name), ...(i === 0 ? { files: [] } : {}) })),
    experiences: GAME_EXPERIENCES.map(x => ({ ...omit(x, ['workspace_id']), thumbnail_image: desktopPath(x.name) })),
    assets: local(ASSETS).map(a => ({ ...a, ...(LEVEL_OF.get(a.id) || {}) })),
    tasks: local(TASKS).map(t => ({ ...t, assignee_id: desktopIdOf(t.assignee_id), reviewer_id: desktopIdOf(t.reviewer_id) })),
    dependencies: DEPENDENCIES.map(d => ({ ...d, project_id: pid })),
    taskItems: [...local(TASK_ITEMS), ...local(GAME_TASK_ITEMS)],
    taskLinks: TASK_LINKS.map(l => ({ ...l, project_id: pid, updated_at: l.created_at })),
    comments: COMMENTS.map(c => ({ ...c, project_id: pid })),
    shotLists: SHOT_LISTS.map(l => ({ ...l, workspace_id: null, created_by: null, updated_by: null, archived_by: null })),
    shotListItems: SHOT_LIST_ITEMS.map(i => ({ ...i, workspace_id: null, created_by: null, updated_by: null })),
    edits: EDITS.map(e => ({ ...e, workspace_id: null, created_by: null, updated_by: null, archived_by: null })),
    folders: [...FOLDERS, ...GAME_FOLDERS].map(f => omit(f, ['workspace_id', 'created_by', 'updated_by'])),
    files: [...FILES, ...GAME_FILES].map(desktopFile),
    budgetVersions: local(BUDGET_VERSIONS).map((v, i) => (i === 0 ? { ...v, shot_list_id: LIST_1 } : v)),
    budgetLines: local(BUDGET_LINES).map(l => ({ ...l, team_member_id: desktopIdOf(l.team_member_id) })),
    budgetActuals: local(BUDGET_ACTUALS).map((a, i) => (i === 0 ? { ...a, attachment_path: `file:${RECEIPT}` } : i === 1 ? { ...a, attachment_path: 'C:\\Invoices\\INV-0042_set_timber.pdf' } : a)),
    expenses: local(EXPENSES).map((e, i) => (i === 2 ? { ...e, purchase_date: '' } : e)),
    projectRateOverrides: [...local(PROJECT_RATE_OVERRIDES).map(o => ({ ...o, member_id: desktopIdOf(o.member_id) })), ROLE_RATE],
  }
}

// Every row of the five kinds the fixtures hold, by the table it lands in:
// the ids that must come out the other side (M2: the game variant's folders
// with the rest).
const FIVE_KINDS = { milestones: MILESTONES, comments: COMMENTS, shot_lists: SHOT_LISTS, shot_list_items: SHOT_LIST_ITEMS, edits: EDITS, folders: [...FOLDERS, ...GAME_FOLDERS] }
// M2: part 2's rows, by the table each lands in (a team member's rate stays
// for a later run), and every file.
const PART_2 = {
  levels: GAME_LEVELS, experiences: GAME_EXPERIENCES, task_links: TASK_LINKS,
  budget_versions: BUDGET_VERSIONS, budget_lines: BUDGET_LINES, budget_actuals: BUDGET_ACTUALS, expenses: EXPENSES, project_rate_overrides: [ROLE_RATE],
}
const ALL_FILES = [...FILES, ...GAME_FILES]
/** What the round trip lost of part 2: each table's missing ids. */
function part2Missing() {
  const out = {}
  for (const [table, rows] of Object.entries(PART_2)) {
    const got = new Set(ins(table).map(r => r.id))
    const missing = rows.filter(r => !got.has(r.id)).length
    if (missing) out[table] = missing
  }
  return out
}
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
// The files the desktop files in no folder: the schedule at the project's
// top and the Legal file (in LEGAL, which has no row): `null` in the cloud,
// as the cloud's own upload files them. The two invoices sit at the top on
// the desktop too, but go into INVOICES in the cloud (her ruling of
// 2026-10-29, walkthrough 84's M1 Q1): the fixtures' own folder for them.
const AT_THE_TOP = new Set([fileId(32), fileId(33)])
const IN_INVOICES = new Set([fileId(30), fileId(31)])
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
    expect(report.edits).toEqual({ total: 3, inserted: 3, skipped: 0, failed: 0, archived: 1, taken: 0, orphans: 0 })
    // Folders: every row by its path, parents first, ids and parents kept,
    // no workspace or maker — since M2 a level's and an experience's too.
    const allFolders = [...FOLDERS, ...GAME_FOLDERS]
    expect(ins('folders').map(f => f.id).sort()).toEqual(allFolders.map(f => f.id).sort())
    for (const f of allFolders) expect(ins('folders').find(r => r.id === f.id), f.path).toEqual(omit(f, ['workspace_id', 'created_by', 'updated_by']))
    const at = new Map(ins('folders').map((f, i) => [f.id, i]))
    for (const f of ins('folders')) if (f.parent_id) expect(at.get(f.parent_id), f.path).toBeLessThan(at.get(f.id))
    expect(report.folders).toMatchObject({ total: allFolders.length, inserted: allFolders.length, failed: 0, orphans: 0, taken: 0 })
    // Files: each filed where the desktop shows it — its asset's, its
    // scene's, its shot's, its level's or its experience's folder (the
    // fixtures' own folder_id) — the two invoices in INVOICES (her ruling),
    // and the two at the project's top in none.
    for (const f of ALL_FILES) expect(ins('files').find(r => r.id === f.id)?.folder_id, f.name).toBe(AT_THE_TOP.has(f.id) ? null : f.folder_id)
    const asOnTheDesktop = ALL_FILES.length - AT_THE_TOP.size - IN_INVOICES.size
    expect(report.files).toMatchObject({ total: ALL_FILES.length, inserted: ALL_FILES.length, failed: 0, placed: asOnTheDesktop, invoicesFiled: IN_INVOICES.size })
    expect(lines).toContain(`  ${FILES_PLACED(asOnTheDesktop)}`)
    expect(lines).toContain(`  ${INVOICES_FILED(IN_INVOICES.size)}`)
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

  it('run twice: the second changes nothing — no row, no function call that writes, every row skipped, nothing failed (M2: and no insert is even tried)', async () => {
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
      newCloud({ inserts: {}, lists: {}, log: [], rpcs: [] })
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
    // A locked bid version the cloud does not hold (since M2 the runner sets both by UPDATE after the versions).
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
    // M3: a producer is the account the people map gives, or nobody (no
    // directory here: a desktop id is never sent raw).
    expect(p).toMatchObject({ id: PROJECT.id, workspace_id: WS, title: PROJECT.title, folder_slug: 'Salt-Hours', fps: 24, producer_id: null, budget_contingency_pct: 10 })
    // Its children followed it (a refused project skips every child).
    expect(ins('phases')).toHaveLength(PHASES.length)
    expect(report.projectsLeftAtHome).toEqual({ folders: 1, statuses: {}, withValues: 0, values: {} })
  })

  it('CONTROL: a desktop project\'s own values the cloud\'s columns refuse — a status a cloud without 0103 does not have, a cleared date, a cleared frame rate, no title — and the runner\'s row, which lands with the defaults and says the status (review round 1; M2)', async () => {
    fake.state.pre0103 = true
    const insert = (row) => fake.client.from('projects').insert({ id: 'p-x', title: 'x', workspace_id: WS, ...row })
    // wilson-dev's answers: project_status had five values before 0103; a DATE refuses ''; a NOT NULL column refuses null.
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
    fake.state.log = []
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.projects).toEqual({ total: 1, inserted: 1, skipped: 0, failed: 0 })
    const p = ins('projects')[0]
    expect(p).toMatchObject({ start_date: '2026-09-01', end_date: null, title: 'Untitled Project' })
    for (const k of ['status', 'fps', 'startDate']) expect(p, k).not.toHaveProperty(k)
    // M2: the type refused the status, so the row went again without it.
    expect(fake.state.log.filter(x => x === 'projects')).toEqual(['projects', 'projects'])
    expect(report.projectsLeftAtHome.statuses).toEqual({ wrapped: 1 })
    expect(lines).toContain(`  ${STATUS_NOT_IN_CLOUD(1, ['wrapped'])}`)
    expect(STATUS_NOT_IN_CLOUD(1, ['wrapped'])).toBe('1 project has a status the cloud does not have (wrapped): it arrives as active')
    // Its children followed it.
    expect(ins('phases')).toHaveLength(PHASES.length)
  })

  it('M2 (0103, her ruling of 2026-10-28): the desktop\'s Draft, Wrapped and Inactive arrive as they are, said nowhere; a status no build has still arrives as active, said', async () => {
    for (const status of ['draft', 'wrapped', 'inactive']) {
      newCloud({ inserts: {}, lists: {}, log: [] })
      const b = desktopFixtures()
      b.project = { ...b.project, status }
      serve([b])
      const lines = []
      const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
      expect(ins('projects')[0].status, status).toBe(status)
      expect(report.projectsLeftAtHome.statuses, status).toEqual({})
      expect(lines.some(l => l.includes('a status the cloud does not have')), status).toBe(false)
    }
    // CONTROL: a word no build offers is still left out, so the default applies, and said.
    newCloud({ inserts: {}, lists: {}, log: [] })
    const b = desktopFixtures()
    b.project = { ...b.project, status: 'paused' }
    serve([b])
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(ins('projects')[0]).not.toHaveProperty('status')
    expect(report.projectsLeftAtHome.statuses).toEqual({ paused: 1 })
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

  it('a day picked in the project\'s settings (stored as that day\'s midnight in UTC) goes up as that day, whatever the clock\'s zone; R.A.B.B.I.T.\'s later date wins over D.O.G.\'s first one (review round 2)', async () => {
    // Postgres keeps the literal day of such a string (measured on wilson-dev):
    // both of these, read as an instant, fall on another day in New York or in UTC.
    expect(cloudDay('2026-12-01T00:00:00.000Z')).toBe('2026-12-01')
    expect(cloudDay('2026-12-20T23:30:00-05:00')).toBe('2026-12-20')
    expect(cloudDay('2026-02-30')).toBeNull()
    expect(cloudDay('')).toBeNull()
    const b = desktopFixtures()
    // Born in D.O.G. (startDate alone), then dated in R.A.B.B.I.T.'s settings (start_date alone, later).
    b.project = { ...b.project, startDate: '2026-08-01', start_date: '2026-12-01T00:00:00.000Z', endDate: '2027-01-15', end_date: '2026-12-20T23:30:00-05:00' }
    serve([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(ins('projects')[0]).toMatchObject({ start_date: '2026-12-01', end_date: '2026-12-20' })
    // D.O.G.'s day where the column has none.
    expect(projectRowForCloud({ title: 'x', startDate: '2026-08-01', start_date: null, end_date: '' }, WS)).toMatchObject({ start_date: '2026-08-01', end_date: null })
  })

  it('a cleared director or producer (the settings store \'\') goes up empty, and one that is no id too, named; the project lands (review round 2)', async () => {
    // CONTROL: the column refuses '' (measured: 22P02, invalid input syntax for type uuid).
    expect((await fake.client.from('projects').insert({ id: 'p-x', title: 'x', workspace_id: WS, director_id: '' })).error).toMatchObject({ code: '22P02' })
    const b = desktopFixtures()
    b.project = { ...b.project, director_id: '', producer_id: 'tm-12' }
    serve([b])
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.projects).toEqual({ total: 1, inserted: 1, skipped: 0, failed: 0 })
    expect(ins('projects')[0]).toMatchObject({ director_id: null, producer_id: null })
    // The cleared picker is no value; the stray producer is one, said.
    expect(report.projectsLeftAtHome.values).toEqual({ producer: 1 })
    expect(lines).toContain(`  ${VALUES_NOT_IN_CLOUD(1, ['producer'])}`)
  })

  it('a number past its column\'s room (a budget in yen past ten billion), a whole number past INTEGER\'s and a word for a number are left out and named in the settings\' words; the project lands (review round 2)', async () => {
    expect((await fake.client.from('projects').insert({ id: 'p-x', title: 'x', workspace_id: WS, budget_total: 1e10 })).error).toMatchObject({ code: '22003' })
    const b = desktopFixtures()
    b.project = { ...b.project, budget_currency: 'JPY', budget_total: 12000000000, scene_digits: 3e9, fps: 'fast' }
    serve([b])
    const words = ['targeted budget total', 'scene digits', 'frames per second']
    const dryLines = []
    await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS, onProgress: (m) => dryLines.push(m) })
    expect(dryLines).toContain(`  ${VALUES_NOT_IN_CLOUD(1, words)}`)
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.projects.inserted).toBe(1)
    for (const k of ['budget_total', 'scene_digits', 'fps']) expect(ins('projects')[0], k).not.toHaveProperty(k)
    expect(report.projectsLeftAtHome).toMatchObject({ withValues: 1, values: { 'targeted budget total': 1, 'scene digits': 1, 'frames per second': 1 } })
    expect(VALUES_NOT_IN_CLOUD(1, ['frames per second'])).toBe('1 project has a value the cloud cannot hold (frames per second): left out, so the field is empty or at the cloud\'s default')
  })

  it('the status line is said only for a project that arrives: not on a second run, not in a dry run once it is there, not for a refused project (review round 2)', async () => {
    fake.state.pre0103 = true // M2: a status the cloud lacks needs a cloud without 0103
    const b = desktopFixtures()
    b.project = { ...b.project, status: 'wrapped' }
    serve([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const said = (lines) => lines.some(l => l.includes('a status the cloud does not have'))
    const again = []
    const r2 = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => again.push(m) })
    expect(r2.projects).toMatchObject({ inserted: 0, skipped: 1 })
    expect(r2.projectsLeftAtHome.statuses).toEqual({})
    expect(said(again)).toBe(false)
    const dryLines = []
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS, onProgress: (m) => dryLines.push(m) })
    expect(dry.projects).toMatchObject({ inserted: 0, skipped: 1 })
    expect(said(dryLines)).toBe(false)
    newCloud({ inserts: {}, lists: {}, log: [] })
    serve([b])
    fake.state.failWith = (table) => (table === 'projects' ? { code: '42501', message: 'refused' } : null)
    const refused = []
    const r3 = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => refused.push(m) })
    expect(r3.projects.failed).toBe(1)
    expect(said(refused)).toBe(false)
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

  it('the dry run and the real one say what the project row leaves here: its folder (since M2 its bid versions go up, set after them)', async () => {
    serve([desktopFixtures()])
    const lines = []
    await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(lines).toContain(`  ${PROJECT_FOLDER_STAYS(1)}`)
    expect(lines).toContain('  the locked bid version will be set in the cloud as on this computer, if none is there')
    expect(lines.some(l => /part 2/.test(l))).toBe(false)
    // CONTROL: a project naming no bid version and no folder says neither.
    const bare = { ...desktopFixtures(), project: { ...desktopFixtures().project, budget_active_version_id: null, open_budget_version_id: null, folder_root: null } }
    serve([bare])
    const quiet = []
    const r = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS, onProgress: (m) => quiet.push(m) })
    expect(quiet.some(l => l.includes('bid version will be set') || l.includes('project folder'))).toBe(false)
    expect(r.projectsLeftAtHome).toEqual({ folders: 0, statuses: {}, withValues: 0, values: {} })
  })

  it('CONTROL: an archived list or edit sent as the desktop keeps it is refused (0084\'s guard), and the runner never sends one', async () => {
    const pickups = desktopFixtures().shotLists[1]
    fake.state.lists.projects = [{ id: PROJECT.id }]
    expect((await fake.client.from('shot_lists').insert(pickups)).error).toMatchObject({ code: '42501' })
    expect((await fake.client.from('edits').insert({ ...desktopFixtures().edits[2], parent_edit_id: null })).error).toMatchObject({ code: '42501' })
    newCloud({ lists: {}, inserts: {}, log: [] })
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
    newCloud({ lists: {}, inserts: {}, log: [] })
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
    expect(dry.edits).toEqual({ total: 3, inserted: 3, skipped: 0, failed: 0, archived: 1, taken: 0, orphans: 0 })
    expect(dry.folders).toMatchObject({ total: FOLDERS.length + GAME_FOLDERS.length, inserted: FOLDERS.length + GAME_FOLDERS.length, skipped: 0, failed: 0 })
    expect(dry.files.placed).toBe(ALL_FILES.length - AT_THE_TOP.size - IN_INVOICES.size)
    expect(dry.files.invoicesFiled).toBe(IN_INVOICES.size)
    expect(lines).toContain(`  ${ARCHIVED_AGAIN(['"Pickups assembly · v3"', '"Pickups · v1"'])}`)
    expect(lines).toContain('  "Shot list 1 · v1" will be the active shot list in the cloud, if none is active there')
    expect(lines).toContain('  2 shot lists with 29 items and 3 edits')
    // A later run's kinds (night 5) are named apart from what no migration
    // carries; part 2's are carried (M2).
    // M3: with no directory nobody is matched, so every person column and
    // seat is a later run's (once they have accounts); the rest stays.
    expect(dry.notCarried.filter(n => n.later).map(n => n.key)).toEqual(['teamAssignments', 'taskPeople', 'projectPeople', 'lineTeamMembers', 'memberRates'])
    expect(dry.notCarried.filter(n => !n.later).map(n => n.key)).toEqual(['thumbnails', 'invoicePaths'])
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
    expect(dry.files.linksLetGo).toBe(0)
    expect(dry.projects).toMatchObject({ inserted: 0, skipped: 1 })
    // Review round 2: a failed read of the cloud's files is said, as every dry run read's is.
    fake.state.listErrorFor = { files: { message: 'read refused' } }
    const blind = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    expect(blind.errors).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'files', message: 'could not read the files already in the cloud: read refused' })]))
    fake.state.listErrorFor = {}
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
    expect(report.notCarried).toContainEqual({ key: 'commentsElsewhere', label: 'comment on a row the cloud cannot hang a comment on', count: 1, later: false })
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
    expect(dry.edits).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0, archived: 0, taken: 3, orphans: 0 })
    const lines = []
    fake.state.log = []
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(again.edits).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0, archived: 0, taken: 3, orphans: 0 })
    expect(fake.state.log.filter(t => t === 'edits')).toEqual([])
    expect(again.errors).toEqual([])
    expect(lines).toContain(`  ${EDITS_CHAIN_TAKEN(3)}`)
    expect(EDITS_CHAIN_TAKEN(3)).toBe('3 edits not carried: the shot list\'s one chain of edits already has an edit in their place (made in the cloud since, or a second chain an older version kept on this computer), and an edit cannot be moved')
  })

  it('an edit whose parent the cloud holds, continued there since by another edit, is counted with its own continuation; the parent is skipped (M2: once carried, they are removed there, never brought back)', async () => {
    serve([desktopFixtures()])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    // In the cloud, v2 and v3 are gone (say a restore from before them), and a teammate continued v1.
    fake.state.lists.edits = fake.state.lists.edits.filter(e => e.id === EDITS[0].id)
    fake.state.lists.edits.push({ id: 'their-v2', project_id: PROJECT.id, shot_list_id: LIST_2, title: 'Their v2', version: 1, parent_edit_id: EDITS[0].id })
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    // M2: the record says this computer carried v2 and v3, so they are removed in the cloud since — named, not tried.
    expect(again.edits).toEqual({ total: 1, inserted: 0, skipped: 1, failed: 0, archived: 0, taken: 0, orphans: 0 })
    expect(again.removed.byTable).toEqual({ edits: 2 })
    expect(again.errors).toEqual([])
    // CONTROL: edits this computer never carried (no record) meet the taken place, as M1 counted them.
    delete served[0][RECORD_KEY]
    const fresh = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(fresh.edits).toEqual({ total: 1, inserted: 0, skipped: 1, failed: 0, archived: 0, taken: 2, orphans: 0 })
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
    expect(report.edits).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0, archived: 0, taken: 3, orphans: 0 })
    expect(report.errors).toEqual([])
    expect(rpcsCalled('archive_edit')).toEqual([])
    // CONTROL: another key's 23505 (the title and version) is an error, said in words.
    newCloud({ inserts: {}, lists: {}, log: [], rpcs: [] })
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

  it('a second chain an older version kept in one list on this computer: one root lands, the other is counted with what continues it, never an error — and the dry run says the same (review round 2)', async () => {
    const b = desktopFixtures()
    b.edits = [...b.edits, { ...b.edits[0], id: 'f1c70000-0028-4000-8000-000000000999', title: 'Second chain', version: 1, parent_edit_id: null, archived_at: null }]
    serve([b])
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.edits.taken).toBeGreaterThan(0)
    expect(report.edits.inserted + report.edits.taken).toBe(4)
    expect({ inserted: report.edits.inserted, taken: report.edits.taken }).toEqual({ inserted: dry.edits.inserted, taken: dry.edits.taken })
    expect(report.errors).toEqual([])
    expect(ins('edits').filter(e => e.shot_list_id === LIST_2 && e.parent_edit_id == null)).toHaveLength(1)
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
    // The project in the cloud, in this workspace (M2 review round 1: one
    // in no workspace of this run's is none of it — the lists never went).
    fake.state.lists.projects = [{ id: PROJECT.id, workspace_id: WS, active_shot_list_id: 'their-list' }]
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.projects).toMatchObject({ skipped: 1, failed: 0 })
    expect(ins('shot_lists')).toHaveLength(SHOT_LISTS.length)
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
    expect(report.folders).toMatchObject({ inserted: FOLDERS.length + GAME_FOLDERS.length - 2, skipped: 2 })
    // The asset folders hang off the cloud's ASSETS; the categories off its root.
    for (const f of ins('folders').filter(r => r.path.startsWith('ASSETS/'))) expect(f.parent_id).toBe('cloud-assets')
    for (const f of ins('folders').filter(r => r.kind === 'category')) expect(f.parent_id).toBe('cloud-root')
  })

  it('M2: a level\'s and an experience\'s folder go up after their rows; a folder of a row removed here is not carried; one whose place a namesake took is not carried — none an error', async () => {
    const b = desktopFixtures()
    b.folders.push(
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
    for (const f of GAME_FOLDERS) expect(carried, f.path).toContain(f.id)
    expect(carried).not.toContain('fd-gone')
    expect(carried).not.toContain(sceneFolder.id)
    expect(report.folders).toMatchObject({ orphans: 1, taken: 1, failed: 0 })
    expect(report.folders).not.toHaveProperty('leftBehind')
    expect(report.notCarried.find(n => n.key === 'levelFolders')).toBeUndefined()
    // After the rows they are the folders of.
    const log = fake.state.log
    expect(log.indexOf('folders')).toBeGreaterThan(Math.max(log.lastIndexOf('levels'), log.lastIndexOf('experiences')))
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
    // Review round 2: the dry run counts them too, judged against the bundle —
    // the treatment's asset is gone from it; that the schedule's task is
    // another project's only the real run's read can know.
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    expect(dry.files.linksLetGo).toBe(1)
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
    // Review round 2: scene 4's shots wait as well — a shot hanging off
    // another project's scene would go with it (0040's ON DELETE CASCADE).
    const sc4Shots = SHOTS.filter(s => s.scene_id === sc4).map(s => s.id)
    expect(sc4Shots.length).toBeGreaterThan(0)
    expect(ins('shots').filter(s => sc4Shots.includes(s.id))).toEqual([])
    const shotErrors = report.errors.filter(e => e.scope === 'shot' && sc4Shots.includes(e.id))
    expect(shotErrors).toHaveLength(sc4Shots.length)
    for (const e of shotErrors) expect(e.message).toMatch(/whether its scene is this project's could not be checked \(the read of the cloud's scenes failed\), so the shot was not carried/)
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'folder', id: sc4Folder.id }),
      expect.objectContaining({ scope: 'file', id: fileId(28) }),
    ]))
    expect(report.scenes.skipped).toBe(1)
    // CONTROL: the same failed read, scene 4 inserted by this run (known to be
    // this project's): its folder and its file land, the file linked to it.
    newCloud({ inserts: {}, lists: {}, log: [], uploads: [], rpcs: [] })
    serve([desktopFixtures()])
    fake.state.listErrorFor = { scenes: { message: 'read refused' } }
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(ins('folders').map(f => f.id)).toContain(sc4Folder.id)
    expect(ins('files').find(f => f.id === fileId(28))).toMatchObject({ scene_id: sc4, folder_id: sc4Folder.id })
    expect(ins('shots').filter(s => sc4Shots.includes(s.id)).map(s => s.scene_id)).toEqual(sc4Shots.map(() => sc4))
  })

  it('her ruling of 2026-10-29: an invoice the desktop shows at the top goes into INVOICES — the bundle\'s own, else the cloud\'s; with neither it stays at the top; with the folders unread it waits', async () => {
    expect(INVOICES_FILED(2)).toBe('2 invoices and receipts filed in the INVOICES folder (on this computer they sit at the project\'s top)')
    const invoicesRow = FOLDERS.find(f => f.path === 'INVOICES')
    expect(invoicesRow).toMatchObject({ kind: 'category' })
    // The bundle without its INVOICES row (a fresh one each time: a run
    // writes its record into the bundle, M2); the cloud holds this project's own.
    const fresh = () => { const x = desktopFixtures(); x.folders = x.folders.filter(f => f.id !== invoicesRow.id); return x }
    serve([fresh()])
    fake.state.lists.folders = [{ ...omit(invoicesRow, ['workspace_id', 'created_by', 'updated_by']), id: 'cloud-invoices', parent_id: null }]
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    for (const id of IN_INVOICES) expect(ins('files').find(f => f.id === id).folder_id).toBe('cloud-invoices')
    expect(report.files.invoicesFiled).toBe(IN_INVOICES.size)
    // CONTROL: no INVOICES folder anywhere: the invoices stay at the top, counted nowhere.
    Object.assign(fake.state, { inserts: {}, lists: {}, log: [], uploads: [], rpcs: [] })
    serve([fresh()])
    const bare = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    for (const id of IN_INVOICES) expect(ins('files').find(f => f.id === id).folder_id).toBeNull()
    expect(bare.files.invoicesFiled).toBe(0)
    expect(bare.errors).toEqual([])
    // The folders unread: the cloud's INVOICES folder is not known, so the invoices wait (a second run files them).
    Object.assign(fake.state, { inserts: {}, lists: {}, log: [], uploads: [], rpcs: [] })
    serve([fresh()])
    fake.state.listErrorFor = { folders: { message: 'read refused' } }
    const blind = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    for (const id of IN_INVOICES) expect(ins('files').find(f => f.id === id)).toBeUndefined()
    expect(blind.errors.filter(e => e.scope === 'file' && IN_INVOICES.has(e.id)).map(e => e.message)).toEqual([...IN_INVOICES].map(() => expect.stringMatching(/its folder is not in the cloud, so the file was not carried/)))
    // The schedule, not money, stays at the top whatever happens to INVOICES.
    expect(ins('files').find(f => f.id === fileId(32)).folder_id).toBeNull()
  })

  it('her ruling of 2026-10-29: an invoice whose INVOICES folder the cloud refused in this run waits with it, never filed at the top for good; a second run files it there', async () => {
    const invoicesRow = FOLDERS.find(f => f.path === 'INVOICES')
    serve([desktopFixtures()])
    fake.state.failWith = (table, row) => (table === 'folders' && row.id === invoicesRow.id ? { code: '42501', message: 'refused' } : null)
    const r1 = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    for (const id of IN_INVOICES) expect(ins('files').find(f => f.id === id)).toBeUndefined()
    expect(r1.errors.filter(e => e.scope === 'file' && IN_INVOICES.has(e.id))).toHaveLength(IN_INVOICES.size)
    expect(fake.state.uploads.some(u => [...IN_INVOICES].some(id => u.path.includes(id)))).toBe(false)
    // CONTROL: the other files are not held by it.
    expect(ins('files').find(f => f.id === fileId(32)).folder_id).toBeNull()
    fake.state.failWith = null
    const r2 = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(r2.errors).toEqual([])
    for (const id of IN_INVOICES) expect(ins('files').find(f => f.id === id).folder_id).toBe(invoicesRow.id)
    expect(r2.files.invoicesFiled).toBe(IN_INVOICES.size)
  })

  it('a file filed in a folder that did not land waits with it, its body unmoved; a second run brings both, each file in its folder (review round 2)', async () => {
    serve([desktopFixtures()])
    fake.state.listErrorFor = { folders: { message: 'read refused' } }
    const r1 = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const filed = ALL_FILES.filter(f => !AT_THE_TOP.has(f.id))
    expect(ins('files').map(f => f.id).sort()).toEqual([...AT_THE_TOP].sort())
    expect(fake.state.uploads.some(u => filed.some(f => u.path.includes(f.id)))).toBe(false)
    expect(r1.errors.filter(e => e.scope === 'file').map(e => e.id).sort()).toEqual(filed.map(f => f.id).sort())
    expect(r1.errors.find(e => e.scope === 'folders').message).toMatch(/nor any file filed in one \(run again\)/)
    // The second run, the read answering: every folder, and every file in its own.
    fake.state.listErrorFor = {}
    const r2 = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(r2.errors).toEqual([])
    for (const f of filed) expect(ins('files').find(r => r.id === f.id)?.folder_id, f.name).toBe(f.folder_id)
  })

  it('when the read of the project\'s phases fails, a key date or a file on one waits, and the report says the check could not be made, not that the phase is missing (review round 2)', async () => {
    serve([desktopFixtures()])
    fake.state.listErrorFor = { phases: { message: 'read refused' } }
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const kd = report.errors.filter(e => e.scope === 'milestone')
    expect(kd).toHaveLength(MILESTONES.filter(m => m.phase_id).length)
    for (const e of kd) expect(e.message).toMatch(/whether its phase is in the cloud could not be checked \(the read failed\), so the key date was not carried \(run again\)$/)
    const files = report.errors.filter(e => e.scope === 'file')
    expect(files.length).toBeGreaterThan(0)
    for (const e of files) expect(e.message).toMatch(/whether its phase is in the cloud could not be checked \(the read failed\), so the file was not carried \(run again\)$/)
    expect(report.errors.some(e => ['milestone', 'file', 'comment'].includes(e.scope) && / is not in the cloud, so /.test(e.message))).toBe(false)
  })

  it('a cleared picker\'s \'\' is no link: a key date\'s phase and a file\'s task go up empty, not refused, and nothing is counted as let go (review round 2)', async () => {
    // CONTROL: the column refuses '' (22P02).
    expect((await fake.client.from('milestones').insert({ ...omit(MILESTONES[0], ['name']), id: 'm-x', phase_id: '' })).error).toMatchObject({ code: '22P02' })
    const b = desktopFixtures()
    b.milestones[0] = { ...b.milestones[0], phase_id: '' }
    const sched = b.files.findIndex(f => f.id === fileId(32))
    b.files[sched] = { ...b.files[sched], task_id: '' }
    serve([b])
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(ins('milestones').find(m => m.id === MILESTONES[0].id).phase_id).toBeNull()
    expect(ins('files').find(f => f.id === fileId(32)).task_id).toBeNull()
    expect(report.milestones.phaseLetGo).toBe(0)
    expect(report.files.linksLetGo).toBe(0)
    expect(report.errors).toEqual([])
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

// =============================================================================
// M2 (night 4 of docs/sessions/PLAN_TO_1_0.md): part 2 — the budgets, the
// levels and experiences with what hangs on them, the links on tasks, the
// project's statuses, the phases', assets' and tasks' own checks (M1-L5),
// and the second run's record. The fake refuses what wilson-dev refused when
// M2 measured it (rolled back, 2026-10-28).
// =============================================================================

const versionV2 = BUDGET_VERSIONS[1].id
const recordOf = (b) => b[RECORD_KEY]?.[WS]?.carried || {}

describe('M2: the round trip on the fixtures — part 2 in the desktop\'s shape', () => {
  it('every row of part 2 comes out with the cloud\'s shape, its id and its parents; the pointers are set after the versions; the run is clean', async () => {
    serve([desktopFixtures()])
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toEqual([])
    expect(part2Missing()).toEqual({})
    expect(roundTripMissing()).toEqual({})
    // Levels and experiences: the cloud's columns only — no picture on this
    // disk, no `files` key (the older add's), no workspace, no maker.
    for (const l of ins('levels')) {
      for (const k of ['thumbnail_image', 'files', 'workspace_id', 'created_by', 'updated_by']) expect(l, k).not.toHaveProperty(k)
      expect(l.project_id).toBe(PROJECT.id)
    }
    expect(ins('levels').map(l => l.status)).toEqual(GAME_LEVELS.map(l => l.status))
    // The assets keep their links to them, a task's items name them.
    for (const [n, levels, experiences] of GAME_LINKS) {
      expect(byId('assets', ASSET_ID(n)).level_ids, `asset ${n}`).toEqual(levels.map(l => GAME_LEVELS[l - 1].id))
      expect(byId('assets', ASSET_ID(n)).experience_ids, `asset ${n}`).toEqual(experiences.map(x => GAME_EXPERIENCES[x - 1].id))
    }
    for (const it of GAME_TASK_ITEMS) expect(byId('task_items', it.id), it.id).toMatchObject({ entity_type: it.entity_type, entity_id: it.entity_id })
    // The files of a level and of an experience, linked and filed in its folder.
    for (const f of GAME_FILES) expect(byId('files', f.id)).toMatchObject({ level_id: f.level_id, experience_id: f.experience_id, folder_id: f.folder_id })
    // Links on tasks: no project_id (the cloud has none), who made it the cloud's.
    expect(ins('task_links')).toEqual(TASK_LINKS.map(l => ({ id: l.id, task_id: l.task_id, label: l.label, url: l.url, created_at: l.created_at })))
    // The bid versions: no workspace, no maker, no locker (a person on this
    // computer); the first one's shot list kept (it landed, this project's).
    expect(ins('budget_versions').map(v => v.id)).toEqual(BUDGET_VERSIONS.map(v => v.id))
    for (const v of ins('budget_versions')) for (const k of ['workspace_id', 'created_by', 'updated_by', 'locked_by']) expect(v, k).not.toHaveProperty(k)
    expect(byId('budget_versions', BUDGET_VERSIONS[0].id).shot_list_id).toBe(LIST_1)
    expect(byId('budget_versions', versionV2).locked_at).toBe(BUDGET_VERSIONS[1].locked_at)
    // The lines: a header's null numbers left to the cloud's defaults; a
    // line priced for one of this computer's team members goes up without
    // the person (a later run's), counted.
    const header = byId('budget_lines', BUDGET_LINES[0].id)
    for (const k of ['rate', 'days', 'qty', 'cost']) expect(header, k).not.toHaveProperty(k)
    expect(ins('budget_lines').every(l => l.team_member_id == null)).toBe(true)
    expect(report.notCarried).toContainEqual({ key: 'lineTeamMembers', label: 'budget lines priced for a team member without a WILSON account', count: BUDGET_LINES.filter(l => l.team_member_id).length, later: true })
    // The actuals: on their lines; the receipt kept (a files row of this
    // project); the invoice attached by a path on this computer left out
    // with its name, counted.
    expect(byId('budget_actuals', BUDGET_ACTUALS[0].id)).toMatchObject({ line_id: BUDGET_ACTUALS[0].line_id, attachment_path: `file:${RECEIPT}`, source: 'expense' })
    expect(byId('budget_actuals', BUDGET_ACTUALS[1].id)).toMatchObject({ attachment_path: null, attachment_name: null })
    expect(report.notCarried).toContainEqual({ key: 'invoicePaths', label: 'invoice attached by a path on this computer', count: 1, later: false })
    // The expenses: the add's '' day goes up as none; the four lists kept.
    expect(byId('expenses', EXPENSES[2].id).purchase_date).toBeNull()
    expect(byId('expenses', EXPENSES[1].id)).toMatchObject({ asset_ids: EXPENSES[1].asset_ids, task_ids: EXPENSES[1].task_ids, file_ids: EXPENSES[1].file_ids })
    // The rates: a role's goes up; a team member's stays for a later run.
    expect(ins('project_rate_overrides')).toEqual([{ id: ROLE_RATE.id, project_id: PROJECT.id, role_slug: 'editor', member_id: null, day_rate: 550, currency: 'USD', created_at: ROLE_RATE.created_at, updated_at: ROLE_RATE.updated_at }])
    expect(report.notCarried).toContainEqual({ key: 'memberRates', label: 'project rate of a team member without a WILSON account', count: 1, later: true })
    // The project's locked bid version, set by UPDATE once its version is in.
    expect(fake.state.lists.projects[0].budget_active_version_id).toBe(versionV2)
    expect(fake.state.updates.filter(u => u.table === 'projects').map(u => u.patch)).toEqual([{ budget_active_version_id: versionV2 }])
    for (const k of ['levels', 'experiences', 'taskLinks', 'budgetVersions', 'budgetLines', 'budgetActuals', 'expenses', 'rateOverrides']) {
      expect(report[k].failed, k).toBe(0)
      expect(report[k].inserted, k).toBe(report[k].total)
    }
    expect(report.moneyLeft).toEqual({ projects: 0, rows: 0, receipts: 0 })
    expect(report.notCarried.map(n => n.key)).not.toEqual(expect.arrayContaining(['budgetLines', 'levels', 'taskLinks']))
  })

  it('writes the tables in an order every key allows: levels before the assets, folders, files, items; versions after the shot lists; lines before actuals; the pointers after the versions; links on tasks after the tasks', async () => {
    serve([desktopFixtures()])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const log = fake.state.log
    const first = (t) => log.indexOf(t); const last = (t) => log.lastIndexOf(t)
    for (const t of ['assets', 'folders', 'files', 'task_items']) expect(first(t), t).toBeGreaterThan(Math.max(last('levels'), last('experiences')))
    expect(first('task_links')).toBeGreaterThan(last('tasks'))
    expect(first('budget_versions')).toBeGreaterThan(last('shot_lists'))
    expect(first('budget_actuals')).toBeGreaterThan(last('budget_lines'))
    expect(first('budget_versions')).toBeGreaterThan(last('files'))
    // The project's pointer is the run's last write to its row, after every version.
    const pointer = fake.state.updates.findIndex(u => u.table === 'projects')
    expect(pointer).toBeGreaterThanOrEqual(0)
  })

  it('run twice: the second writes nothing — not a row, not a pointer, not an insert tried — and the record names every row the first carried', async () => {
    const b = desktopFixtures()
    serve([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const listsBefore = JSON.stringify(fake.state.lists)
    const carried = recordOf(b)
    for (const [table, rows] of Object.entries(PART_2)) expect(new Set(carried[table]), table).toEqual(new Set(rows.map(r => r.id)))
    expect(carried.projects).toEqual([PROJECT.id])
    fake.state.log = []
    fake.state.updates = []
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(JSON.stringify(fake.state.lists)).toBe(listsBefore)
    expect(fake.state.log.filter(t => t !== 'bin_locations')).toEqual(['projects'])
    expect(fake.state.updates).toEqual([])
    for (const k of ['levels', 'experiences', 'taskLinks', 'budgetVersions', 'budgetLines', 'budgetActuals', 'expenses', 'rateOverrides', 'phases', 'assets', 'tasks', 'files', 'folders']) {
      expect(again[k].inserted, k).toBe(0)
      expect(again[k].failed, k).toBe(0)
    }
    expect(again.removed.rows).toEqual([])
    expect(again.errors).toEqual([])
  })

  it('CONTROL: the desktop\'s part-2 rows as it keeps them are refused as wilson-dev refused them, and the runner never sends one so', async () => {
    fake.state.lists.projects = [{ id: PROJECT.id }]
    fake.state.lists.budget_lines = [{ id: BUDGET_LINES[1].id, project_id: PROJECT.id }]
    fake.state.lists.tasks = [{ id: TASK_LINKS[0].task_id, project_id: PROJECT.id }]
    const insert = (table, row) => fake.client.from(table).insert(row)
    const d = desktopFixtures()
    expect((await insert('budget_actuals', { ...d.budgetActuals[2], line_id: BUDGET_LINES[1].id, source: 'timesheet' })).error).toMatchObject({ code: '23514', message: expect.stringMatching(/budget_actuals_source_check/) })
    expect((await insert('budget_lines', d.budgetLines[0])).error).toMatchObject({ code: '23502', message: expect.stringMatching(/"rate"/) })
    expect((await insert('expenses', { ...omit(d.expenses[2], ['created_by', 'updated_by']) })).error).toMatchObject({ code: '22007' })
    expect((await insert('project_rate_overrides', { ...omit(d.projectRateOverrides[0], ['created_by', 'updated_by']), role_slug: 'editor' })).error).toMatchObject({ code: '23514', message: expect.stringMatching(/target_chk/) })
    expect((await insert('levels', omit(d.levels[0], ['created_by', 'updated_by']))).error).toMatchObject({ code: 'PGRST204', message: expect.stringMatching(/'thumbnail_image'|'files'/) })
    expect((await insert('levels', { id: 'lv-x', project_id: PROJECT.id, name: 'x', status: null })).error).toMatchObject({ code: '23502' })
    expect((await insert('task_links', d.taskLinks[0])).error).toMatchObject({ code: 'PGRST204', message: expect.stringMatching(/'project_id'/) })
    expect((await insert('budget_versions', { id: 'bv-x', project_id: PROJECT.id, name: 'x', shot_list_id: LIST_1 })).error).toMatchObject({ code: '23503', message: expect.stringMatching(/budget_versions_shot_list_fk/) })
    // The runner's rows land.
    newCloud({ inserts: {}, lists: {}, log: [] })
    serve([desktopFixtures()])
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors).toEqual([])
    expect(part2Missing()).toEqual({})
  })
})

describe('M2: the money gate (0037) — a count and a sentence, never a failed project', () => {
  it('a workspace manager with no seat on a project already in the cloud sends none of its budget, no receipt, no pointer; said once; the rest of the project goes', async () => {
    serve([desktopFixtures()])
    // The project is there already (made by another), and this person is not its manager.
    fake.state.lists.projects = [{ id: PROJECT.id, workspace_id: WS, budget_active_version_id: null, open_budget_version_id: null }]
    fake.state.moneyGate = false
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    for (const t of ['budget_versions', 'budget_lines', 'budget_actuals', 'expenses', 'project_rate_overrides']) expect(fake.state.log, t).not.toContain(t)
    const money = FILES.filter(f => f.is_financial).map(f => f.id)
    for (const id of money) expect(fake.state.uploads.some(u => u.path.includes(id)), id).toBe(false)
    expect(fake.state.updates.filter(u => u.table === 'projects')).toEqual([])
    const rows = BUDGET_VERSIONS.length + BUDGET_LINES.length + BUDGET_ACTUALS.length + EXPENSES.length + 2
    expect(report.moneyLeft).toEqual({ projects: 1, rows, receipts: money.length })
    expect(lines).toContain(`  ${MONEY_GATE_LEFT(1, rows)}`)
    expect(report.projects).toMatchObject({ skipped: 1, failed: 0 })
    // Nothing refused row by row: the gate was asked first.
    expect(report.errors).toEqual([])
    expect(rpcsCalled('can_access_project_money')).toEqual([{ p_project: PROJECT.id }])
    // The rest of the project went.
    expect(ins('levels')).toHaveLength(GAME_LEVELS.length)
    expect(ins('files').length).toBe(ALL_FILES.length - money.length)
  })

  it('CONTROL: the person who inserts the project is its manager (fn_projects_auto_staff — measured), so the same run carries the budget', async () => {
    serve([desktopFixtures()])
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.moneyLeft.projects).toBe(0)
    expect(part2Missing()).toEqual({})
    // CONTROL of the control: the fake refuses a money row to anyone else, as RLS does.
    fake.state.moneyGate = false
    expect((await fake.client.from('budget_lines').insert({ id: 'bl-x', project_id: PROJECT.id })).error).toMatchObject({ code: '42501' })
  })

  it('the dry run says the same before anything is written', async () => {
    serve([desktopFixtures()])
    fake.state.lists.projects = [{ id: PROJECT.id, workspace_id: WS }]
    fake.state.moneyGate = false
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    expect(dry.moneyLeft.projects).toBe(1)
    expect(dry.budgetLines.total).toBe(0)
    expect(fake.state.log).toEqual([])
  })
})

describe('M2: receipts stay money (the handbook\'s §12.9, residual 3)', () => {
  it('a receipt an expense names, kept as an ordinary file on this computer (before C4), goes up behind the money gate — INVOICES and is_financial — said', async () => {
    const b = desktopFixtures()
    const preC4 = FILES.filter(f => f.is_financial)[1].id
    b.files = b.files.map(f => (f.id === preC4 ? { ...f, is_financial: false } : f))
    // An ordinary file no expense or actual names, flagged false.
    const plain = FILES.find(f => !f.is_financial && f.asset_id).id
    serve([b])
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(byId('files', preC4)).toMatchObject({ is_financial: true, storage_provider: 'supabase' })
    expect(byId('files', preC4).storage_path).toMatch(/\/INVOICES\//)
    expect(fake.state.uploads.find(u => u.path.includes(preC4)).path).toMatch(/\/INVOICES\//)
    expect(report.files.receiptsGated).toBe(1)
    expect(lines).toContain(`  ${RECEIPTS_GATED(1)}`)
    // CONTROL: a file no expense or actual names stays an ordinary file.
    expect(byId('files', plain).storage_path).toMatch(/\/files\//)
    expect(byId('files', plain).is_financial).toBe(false)
    // An actual's `file:` receipt is one too.
    expect(byId('files', RECEIPT).storage_path).toMatch(/\/INVOICES\//)
  })
})

describe('M2: the project\'s locked and open bid versions', () => {
  it('each only to a version this run carried for this project; one the cloud holds as another project\'s is never set (the lock\'s key would take it — measured)', async () => {
    const b = desktopFixtures()
    serve([b])
    // Version 2's id is another project's row in the cloud.
    fake.state.lists.budget_versions = [{ id: versionV2, project_id: 'p-other' }]
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(fake.state.updates.filter(u => u.table === 'projects')).toEqual([])
    expect(fake.state.lists.projects.find(p => p.id === PROJECT.id).budget_active_version_id ?? null).toBeNull()
    expect(report.errors).toEqual([expect.objectContaining({ scope: 'budget_version', id: versionV2, message: expect.stringMatching(/not this project's/) })])
    // CONTROL: the lock's single-column key takes another project's version, so only the runner's check stands in the way.
    const update = await fake.client.from('projects').update({ budget_active_version_id: versionV2 }).eq('id', PROJECT.id).select('id')
    expect(update.error).toBeNull()
    // …and the open pointer's composite key refuses it.
    const open = await fake.client.from('projects').update({ open_budget_version_id: versionV2 }).eq('id', PROJECT.id).select('id')
    expect(open.error).toMatchObject({ code: '23503', message: expect.stringMatching(/projects_open_budget_version_fk/) })
  })

  it('a pointer the cloud already holds (a teammate locked another version) is left alone', async () => {
    serve([desktopFixtures()])
    fake.state.lists.projects = [{ id: PROJECT.id, workspace_id: WS, budget_active_version_id: 'their-version', open_budget_version_id: null }]
    fake.state.lists.budget_versions = [{ id: 'their-version', project_id: PROJECT.id }]
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(fake.state.updates.filter(u => u.table === 'projects')).toEqual([])
    expect(fake.state.lists.projects[0].budget_active_version_id).toBe('their-version')
  })

  it('an open version on this computer: set after it lands, and the rows it set aside there — carried live — set aside again through 0090\'s writer', async () => {
    const b = desktopFixtures()
    const aside = TASKS[TASKS.length - 1].id
    b.project = { ...b.project, budget_active_version_id: null, open_budget_version_id: versionV2 }
    b.tasks = b.tasks.map(t => (t.id === aside ? { ...t, set_aside_at: '2026-10-20T10:00:00.000Z' } : t))
    serve([b])
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toEqual([])
    // Carried live (an insert carrying the stamp needs the gate, and before its version would hide it for good).
    expect(byId('tasks', aside)).not.toHaveProperty('set_aside_at')
    expect(fake.state.lists.projects[0].open_budget_version_id).toBe(versionV2)
    expect(rpcsCalled('set_aside_schedule_rows')).toEqual([{ p_project: PROJECT.id, p_on: true, p_tasks: [aside], p_phases: [], p_milestones: [] }])
    expect(fake.state.lists.tasks.find(t => t.id === aside).set_aside_at).toBeTruthy()
    expect(report.setAside).toBe(1)
    expect(lines).toContain(`  ${SET_ASIDE_AGAIN(1)}`)
    // CONTROL: no open version, no set-aside call.
    newCloud({ inserts: {}, lists: {}, log: [], rpcs: [] })
    b.project = { ...b.project, open_budget_version_id: null }
    serve([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(rpcsCalled('set_aside_schedule_rows')).toEqual([])
  })
})

describe('M2: a second run brings back nothing a teammate removed', () => {
  // What a teammate removes in the browser after the first run: a budget
  // line, a level, a task, a clip, a key date and a link on a task.
  const removeInTheCloud = () => {
    const drop = (table, id) => { fake.state.lists[table] = (fake.state.lists[table] || []).filter(r => r.id !== id) }
    drop('budget_lines', BUDGET_LINES[3].id)
    drop('levels', GAME_LEVELS[0].id)
    drop('tasks', TASKS[0].id)
    drop('bin_files', BIN_FILES[0].id)
    drop('milestones', MILESTONES[2].id)
    drop('task_links', TASK_LINKS[0].id)
  }

  it('run, remove in the cloud, run again: none of them comes back — each counted and named, nothing written for it', async () => {
    const b = desktopFixtures()
    serve([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    removeInTheCloud()
    fake.state.log = []
    const lines = []
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    for (const [table, id] of [['budget_lines', BUDGET_LINES[3].id], ['levels', GAME_LEVELS[0].id], ['tasks', TASKS[0].id], ['bin_files', BIN_FILES[0].id], ['milestones', MILESTONES[2].id], ['task_links', TASK_LINKS[0].id]]) {
      expect((fake.state.lists[table] || []).some(r => r.id === id), `${table} ${id}`).toBe(false)
    }
    expect(again.removed.byTable).toEqual({ milestones: 1, levels: 1, tasks: 1, task_links: 1, budget_lines: 1, bin_files: 1 })
    expect(again.removed.rows.map(r => r.name)).toEqual(expect.arrayContaining([GAME_LEVELS[0].name, TASKS[0].title, TASK_LINKS[0].label]))
    expect(lines).toContain(`  ${REMOVED_SINCE_LAST_RUN(removedWords(again.removed.byTable))}`)
    expect(fake.state.log.filter(t => t !== 'projects' && t !== 'bin_locations')).toEqual([])
    expect(again.errors).toEqual([])
  })

  it('CONTROL: without the record (an earlier build\'s run), every one of them comes back', async () => {
    const b = desktopFixtures()
    serve([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    removeInTheCloud()
    delete b[RECORD_KEY]
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    for (const [table, id] of [['budget_lines', BUDGET_LINES[3].id], ['levels', GAME_LEVELS[0].id], ['tasks', TASKS[0].id], ['milestones', MILESTONES[2].id], ['task_links', TASK_LINKS[0].id]]) {
      expect((fake.state.lists[table] || []).some(r => r.id === id), `${table} ${id}`).toBe(true)
    }
    expect(again.removed.rows).toEqual([])
  })

  it('the dry run reads the record too: it names what will not come back, and writes nothing (not even the record)', async () => {
    const b = desktopFixtures()
    serve([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    removeInTheCloud()
    fake.state.log = []
    recordWrites = []
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    expect(dry.removed.byTable).toEqual({ milestones: 1, levels: 1, tasks: 1, task_links: 1, budget_lines: 1, bin_files: 1 })
    expect(fake.state.log).toEqual([])
    expect(recordWrites).toEqual([])
  })

  it('a project removed in the cloud since is not carried again, nor anything of it', async () => {
    const b = desktopFixtures()
    serve([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    fake.state.lists = {}
    fake.state.log = []
    const lines = []
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(fake.state.log).toEqual([])
    expect(again.removed.byTable).toEqual({ projects: 1 })
    expect(again.removed.rows).toEqual([{ projectId: PROJECT.id, table: 'projects', id: PROJECT.id, name: PROJECT.title }])
    expect(lines).toContain(`  ${REMOVED_SINCE_LAST_RUN('1 project')} (nor anything of it)`)
  })

  it('the record is true after a run that stops part way: it names only rows the cloud took', async () => {
    const b = desktopFixtures()
    serve([b])
    // The budget lines are refused (a network gone at that moment, say).
    fake.state.failWith = (table) => (table === 'budget_lines' ? { code: '08006', message: 'connection failure' } : null)
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(recordOf(b).budget_lines ?? []).toEqual([])
    expect(new Set(recordOf(b).levels)).toEqual(new Set(GAME_LEVELS.map(l => l.id)))
    // Written as rows land, a few at a time, never the whole run at the end.
    expect(recordWrites.length).toBeGreaterThan(5)
    // The next run brings the lines (never carried, so never removed).
    fake.state.failWith = null
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.budgetLines.inserted).toBe(BUDGET_LINES.length)
    expect(again.removed.rows).toEqual([])
  })

  it('a desktop that cannot keep the record says so once, and nothing is called removed', async () => {
    serve([desktopFixtures()])
    recordStatus = 500
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.recordKept).toBe(false)
    expect(lines.filter(l => l.startsWith(`  ${RECORD_NOT_KEPT('').split('(')[0]}`))).toHaveLength(1)
    expect(report.errors).toEqual([])
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.removed.rows).toEqual([])
  })
})

describe('M2: links on tasks (0000\'s task_links)', () => {
  it('read through this project\'s tasks; a link on a task removed on this computer is not carried, counted; one whose task failed waits with it', async () => {
    const b = desktopFixtures()
    b.taskLinks.push({ id: 'link-gone', project_id: PROJECT.id, task_id: 'task-removed-here', label: 'Old', url: 'https://example.test/old' })
    serve([b])
    const T16 = TASK_LINKS[1].task_id
    fake.state.failWith = (table, row) => (table === 'tasks' && row.id === T16 ? { code: '23514', message: 'refused' } : null)
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(ins('task_links').map(l => l.id)).toEqual([TASK_LINKS[0].id, TASK_LINKS[2].id])
    expect(report.taskLinks).toEqual({ total: 3, inserted: 2, skipped: 0, failed: 1, orphans: 1 })
    expect(report.errors.find(e => e.scope === 'task_link').message).toBe(`${TASK_LINKS[1].label}: its task is not in the cloud, so the link was not carried (a second run brings both)`)
    expect(lines).toContain(`  ${TASK_LINKS_ON_GONE_TASKS(1)}`)
    // Read through the tasks (task_links has no project_id): by `in`, never by project.
    expect(fake.state.inReads.some(([t, c]) => t === 'task_links' && c === 'task_id')).toBe(true)
  })
})

describe('M2: phases, assets and tasks get the "is it this project\'s" check (OUTSTANDING M1-L5)', () => {
  it('an id another project holds is said, not read as there; a phase link to a phase not this project\'s is let go, counted; what hangs on such a row lets go too', async () => {
    const b = desktopFixtures()
    serve([b])
    // Phase 2's id is another project's row; so is task 1's.
    fake.state.lists.phases = [{ id: PHASES[1].id, project_id: 'p-other' }]
    fake.state.lists.tasks = [{ id: TASKS[0].id, project_id: 'p-other' }]
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors.filter(e => ['phase', 'task'].includes(e.scope)).map(e => [e.scope, e.id])).toEqual([['phase', PHASES[1].id], ['task', TASKS[0].id]])
    for (const e of report.errors.filter(e => ['phase', 'task'].includes(e.scope))) expect(e.message).toMatch(/not this project's/)
    // Every asset and task in that phase lands without it, counted.
    const inPhase = [...ASSETS, ...TASKS].filter(r => r.phase_id === PHASES[1].id && r.id !== TASKS[0].id)
    expect(inPhase.length).toBeGreaterThan(0)
    for (const r of inPhase) expect((byId('assets', r.id) || byId('tasks', r.id)).phase_id, r.id).toBeNull()
    expect(report.rowLinksLetGo).toBeGreaterThanOrEqual(inPhase.length)
    expect(lines.some(l => l.startsWith(`  ${ROW_LINKS_LET_GO(report.rowLinksLetGo)}`))).toBe(true)
    // No error waits on a run that could never come.
    expect(report.errors.filter(e => /a second run brings both/.test(e.message))).toEqual([])
  })

  it('an asset made from a task template keeps the asset, not the template (the company\'s templates are a later run\'s; assets_task_template_id_fkey refused it whole — measured)', async () => {
    const b = desktopFixtures()
    b.assets = b.assets.map((a, i) => (i === 0 ? { ...a, task_template_id: '00000000-0000-4000-8000-0000000000aa' } : a))
    serve([b])
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(byId('assets', ASSETS[0].id)).not.toHaveProperty('task_template_id')
    expect(report.notCarried).toContainEqual({ key: 'assetTemplates', label: "asset's task template not in the cloud", count: 1, later: true })
    // CONTROL: the asset as the desktop keeps it is refused whole.
    expect((await fake.client.from('assets').insert({ ...b.assets[0], id: 'a-x' })).error).toMatchObject({ code: '23503', message: expect.stringMatching(/assets_task_template_id_fkey/) })
  })
})

// ── M2 review round 1 (Opus): its findings, each pinned with the run that ──
// showed it. The record names a row only once it is known to be this
// project's in the cloud; what could not be told waits for a run that can.
describe('M2 review round 1: whose a row is, before the record names it', () => {
  it('H2: a project whose id another workspace holds is said, none of it written or recorded — and the next run does not call it removed', async () => {
    const b = desktopFixtures()
    serve([b])
    fake.state.lists.projects = [{ id: PROJECT.id, workspace_id: 'ws-other' }]
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors).toEqual([{ scope: 'project', projectId: PROJECT.id, message: PROJECT_NOT_OURS }])
    expect(report.projects).toMatchObject({ failed: 1, skipped: 0 })
    expect(fake.state.log).toEqual(['projects'])
    expect(recordOf(b)).toEqual({})
    // Out of sight (a private project, another company's): its key met, the read answers nothing.
    fake.state.lists.projects = []
    fake.state.failWith = (table) => (table === 'projects' ? { code: '23505', message: 'duplicate key value violates unique constraint "projects_pkey"' } : null)
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.errors).toEqual([{ scope: 'project', projectId: PROJECT.id, message: PROJECT_NOT_OURS }])
    expect(again.removed.rows).toEqual([])
    expect(recordOf(b)).toEqual({})
    // The dry run says the same of another workspace's, and counts none of it.
    fake.state.failWith = null
    fake.state.lists.projects = [{ id: PROJECT.id, workspace_id: 'ws-other' }]
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    expect(dry.errors).toContainEqual({ scope: 'project', projectId: PROJECT.id, message: PROJECT_NOT_OURS })
    expect(dry.phases.total).toBe(0)
  })

  it('H2: a file whose id another project holds is said, never uploaded or recorded', async () => {
    const b = desktopFixtures()
    serve([b])
    const theirs = FILES.find(f => !f.is_financial && f.asset_id).id
    fake.state.lists.files = [{ id: theirs, project_id: 'p-other', storage_path: `projects/p-other/files/${theirs}/other.pdf`, is_financial: false }]
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors).toEqual([expect.objectContaining({ scope: 'file', id: theirs, message: expect.stringMatching(/is in the cloud but is not this project's/) })])
    expect(recordOf(b).files).not.toContain(theirs)
    expect(fake.state.uploads.some(u => u.path.includes(theirs))).toBe(false)
  })

  it('H3: an actual whose line and period the cloud holds under another id, and a role rate whose role it holds, are counted and said — no error, never recorded, never called removed', async () => {
    const b = desktopFixtures()
    serve([b])
    const a = BUDGET_ACTUALS[2]
    // Entered in the browser since: another id, the same place.
    fake.state.lists.budget_actuals = [{ id: 'actual-teammate', project_id: PROJECT.id, line_id: a.line_id, column_index: a.column_index }]
    fake.state.lists.project_rate_overrides = [{ id: 'rate-teammate', project_id: PROJECT.id, role_slug: ROLE_RATE.role_slug }]
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toEqual([])
    expect(report.budgetActuals.taken).toBe(1)
    expect(report.rateOverrides.taken).toBe(1)
    expect(lines).toContain(`  ${ACTUALS_TAKEN(1)}`)
    expect(lines).toContain(`  ${RATES_TAKEN(1)}`)
    expect(recordOf(b).budget_actuals).not.toContain(a.id)
    expect(recordOf(b).project_rate_overrides ?? []).not.toContain(ROLE_RATE.id)
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.errors).toEqual([])
    expect(again.removed.rows).toEqual([])
    expect(again.budgetActuals.taken).toBe(1)
  })

  it('H4: a line\'s own percentage the cloud cannot hold goes up empty and is said; the line and the actuals on it land', async () => {
    const b = desktopFixtures()
    const negative = BUDGET_ACTUALS[2].line_id
    const huge = BUDGET_ACTUALS[3].line_id
    b.budgetLines = b.budgetLines.map(l => (l.id === negative ? { ...l, margin_pct: -5 } : l.id === huge ? { ...l, contingency_pct: 12000, talent_agency_fee_pct: 'ten' } : l))
    serve([b])
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toEqual([])
    expect(byId('budget_lines', negative).margin_pct).toBeNull()
    expect(byId('budget_lines', huge)).toMatchObject({ contingency_pct: null, talent_agency_fee_pct: null })
    expect(report.budgetLines.pctsLeftOut).toBe(2)
    expect(lines).toContain(`  ${LINE_PCTS_LEFT_OUT(2)}`)
    for (const a of [BUDGET_ACTUALS[2], BUDGET_ACTUALS[3]]) expect(byId('budget_actuals', a.id), a.id).toBeTruthy()
    // CONTROL: the line with the desktop's value is refused whole (measured: 23514, 22003, 22P02).
    const plain = BUDGET_LINES.find(l => !l.is_section_header)
    const insert = (over) => fake.client.from('budget_lines').insert({ ...budgetLineRowForCloud(plain, PROJECT.id), id: `bl-${Object.keys(over)[0]}`, ...over })
    expect((await insert({ margin_pct: -5 })).error).toMatchObject({ code: '23514', message: expect.stringMatching(/budget_lines_pct_nonneg/) })
    expect((await insert({ contingency_pct: 12000 })).error).toMatchObject({ code: '22003' })
    expect((await insert({ talent_agency_fee_pct: 'ten' })).error).toMatchObject({ code: '22P02' })
  })

  it('H5: a pointer whose write failed is set by the next run; once set, no later run sets it again, even after a teammate clears it', async () => {
    const b = desktopFixtures()
    serve([b])
    fake.state.failUpdate = (table) => (table === 'projects' ? { code: '08006', message: 'connection failure' } : null)
    const first = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(first.errors).toEqual([expect.objectContaining({ scope: 'project', message: expect.stringMatching(/was not set in the cloud \(run again\)/) })])
    expect(fake.state.lists.projects[0].budget_active_version_id ?? null).toBeNull()
    expect(recordOf(b).pointers ?? []).toEqual([])
    fake.state.failUpdate = null
    const second = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(second.errors).toEqual([])
    expect(fake.state.lists.projects[0].budget_active_version_id).toBe(versionV2)
    expect(recordOf(b).pointers).toEqual([`locked:${versionV2}`])
    // A teammate unlocks it in the browser: no later run locks it again.
    fake.state.lists.projects[0].budget_active_version_id = null
    fake.state.updates = []
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(fake.state.updates.filter(u => u.table === 'projects')).toEqual([])
    expect(fake.state.lists.projects[0].budget_active_version_id).toBeNull()
  })

  it('H5: rows a build before M2 carried live, set aside by the open version on this computer, are set aside by the run that carries the version — once: a row a teammate brings back stays back', async () => {
    const b = desktopFixtures()
    const aside = TASKS[TASKS.length - 1].id
    const versions = b.budgetVersions
    b.project = { ...b.project, budget_active_version_id: null, open_budget_version_id: versionV2 }
    b.tasks = b.tasks.map(t => (t.id === aside ? { ...t, set_aside_at: '2026-10-20T10:00:00.000Z' } : t))
    // An earlier build's run: the schedule went up, no bid version, no record.
    b.budgetVersions = []
    serve([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(rpcsCalled('set_aside_schedule_rows')).toEqual([])
    delete b[RECORD_KEY]
    b.budgetVersions = versions
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors).toEqual([])
    expect(fake.state.lists.projects[0].open_budget_version_id).toBe(versionV2)
    expect(rpcsCalled('set_aside_schedule_rows')).toEqual([{ p_project: PROJECT.id, p_on: true, p_tasks: [aside], p_phases: [], p_milestones: [] }])
    expect(fake.state.lists.tasks.find(t => t.id === aside).set_aside_at).toBeTruthy()
    // A teammate brings it back in the browser: no later run sets it aside again.
    fake.state.lists.tasks.find(t => t.id === aside).set_aside_at = null
    fake.state.rpcs = []
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(rpcsCalled('set_aside_schedule_rows')).toEqual([])
    expect(fake.state.lists.tasks.find(t => t.id === aside).set_aside_at).toBeNull()
  })

  it('H5: a set-aside the cloud refused is made by the next run', async () => {
    const b = desktopFixtures()
    const aside = TASKS[TASKS.length - 1].id
    b.project = { ...b.project, budget_active_version_id: null, open_budget_version_id: versionV2 }
    b.tasks = b.tasks.map(t => (t.id === aside ? { ...t, set_aside_at: '2026-10-20T10:00:00.000Z' } : t))
    serve([b])
    fake.state.rpcRefuse.set_aside_schedule_rows = { code: '08006', message: 'connection failure' }
    const first = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(first.errors).toEqual([expect.objectContaining({ scope: 'set_aside', message: expect.stringMatching(/\(run again\)/) })])
    delete fake.state.rpcRefuse.set_aside_schedule_rows
    fake.state.rpcs = []
    const second = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(second.errors).toEqual([])
    expect(rpcsCalled('set_aside_schedule_rows')).toEqual([{ p_project: PROJECT.id, p_on: true, p_tasks: [aside], p_phases: [], p_milestones: [] }])
  })

  it('M3 (M2-L4): a receipt an earlier build carried as an ordinary file is put behind the money gate — its picture, its body, then its row in one UPDATE — recorded as carried; a second run touches nothing; the dry run counts it', async () => {
    const b = desktopFixtures()
    const preC4 = FILES.filter(f => f.is_financial)[1].id
    const receipt = FILES.find(f => f.id === preC4)
    b.files = b.files.map(f => (f.id === preC4 ? { ...f, is_financial: false } : f))
    serve([b])
    // An earlier build carried it by its own flag, as an ordinary file, with its picture.
    const from = `projects/${PROJECT.id}/files/${preC4}/receipt.pdf`
    fake.state.lists.files = [{ id: preC4, project_id: PROJECT.id, storage_path: from, is_financial: false, thumbnail_url: `${from}.jpg` }]
    fake.state.objects.push({ bucket: 'rabbit-files', name: from, size: 3 }, { bucket: 'rabbit-thumbnails', name: `${from}.jpg`, size: 2 })
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    expect(dry.receiptsMoved).toBe(1)
    expect(fake.state.moves).toEqual([])
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toEqual([])
    const to = `projects/${PROJECT.id}/INVOICES/${preC4}/${receipt.name.replace(/[^a-zA-Z0-9._-]+/g, '_')}`
    expect(fake.state.moves).toEqual([{ bucket: 'rabbit-thumbnails', from: `${from}.jpg`, to: `${to}.jpg` }, { bucket: 'rabbit-files', from, to }])
    expect(fake.state.lists.files.find(f => f.id === preC4)).toMatchObject({ is_financial: true, storage_path: to, thumbnail_url: `${to}.jpg` })
    expect(fake.state.updates.filter(u => u.table === 'files').map(u => u.patch)).toEqual([{ is_financial: true, storage_path: to, thumbnail_url: `${to}.jpg` }])
    expect(report.receiptsMoved).toBe(1)
    expect(report.files.receiptsOpen).toBe(0)
    expect(lines).toContain(`  ${RECEIPTS_MOVED(1)}`)
    expect(recordOf(b).files).toContain(preC4)
    expect(fake.state.uploads.some(u => u.path.includes(preC4))).toBe(false)
    fake.state.moves = []; fake.state.updates = []
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.receiptsMoved).toBe(0)
    expect(fake.state.moves).toEqual([])
    expect(fake.state.updates.filter(u => u.table === 'files')).toEqual([])
    expect(again.removed.rows).toEqual([])
    // CONTROL: a move the cloud refuses leaves the receipt open — said with its reason, the row untouched, never recorded as carried, said again next run; a body moved before the row changed (a run that stopped) is not moved again, only the row.
    newCloud({ inserts: {}, lists: {}, log: [], objects: [], moves: [], updates: [] })
    const c = desktopFixtures()
    c.files = c.files.map(f => (f.id === preC4 ? { ...f, is_financial: false } : f))
    serve([c])
    fake.state.lists.files = [{ id: preC4, project_id: PROJECT.id, storage_path: from, is_financial: false, thumbnail_url: null }]
    fake.state.objects.push({ bucket: 'rabbit-files', name: from, size: 3 })
    fake.state.failMove = () => ({ message: 'new row violates row-level security policy', statusCode: '403' })
    const refused = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(refused.files.receiptsOpen).toBe(1)
    expect(refused.receiptsMoved).toBe(0)
    expect(lines).toContain(`  ${RECEIPTS_LEFT_OPEN(1)}`)
    expect(refused.errors).toEqual([expect.objectContaining({ scope: 'file', id: preC4, message: expect.stringMatching(/still open to every member of the project in the cloud — its body could not be moved behind the gate/) })])
    expect(fake.state.lists.files.find(f => f.id === preC4)).toMatchObject({ is_financial: false, storage_path: from })
    expect(recordOf(c).files ?? []).not.toContain(preC4)
    expect(recordOf(c).receipts_open).toEqual([preC4])
    fake.state.failMove = null
    fake.state.objects = [{ bucket: 'rabbit-files', name: to, size: 3 }]
    fake.state.moves = []
    const repaired = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(repaired.receiptsMoved).toBe(1)
    expect(fake.state.moves).toEqual([])
    expect(fake.state.lists.files.find(f => f.id === preC4)).toMatchObject({ is_financial: true, storage_path: to, thumbnail_url: null })
  })

  it('M3 (review round 1): a receipt whose row says ordinary while its body and picture are already behind the gate (a run that stopped after writing the path) gets only its row changed — nothing moved, nothing removed; the dry run counts it', async () => {
    const b = desktopFixtures()
    const preC4 = FILES.filter(f => f.is_financial)[1].id
    const receipt = FILES.find(f => f.id === preC4)
    b.files = b.files.map(f => (f.id === preC4 ? { ...f, is_financial: false } : f))
    serve([b])
    const to = `projects/${PROJECT.id}/INVOICES/${preC4}/${receipt.name.replace(/[^a-zA-Z0-9._-]+/g, '_')}`
    fake.state.lists.files = [{ id: preC4, project_id: PROJECT.id, storage_path: to, is_financial: false, thumbnail_url: `${to}.jpg` }]
    fake.state.objects.push({ bucket: 'rabbit-files', name: to, size: 3 }, { bucket: 'rabbit-thumbnails', name: `${to}.jpg`, size: 2 })
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    expect(dry.receiptsMoved).toBe(1)
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors).toEqual([])
    expect(report.receiptsMoved).toBe(1)
    expect(fake.state.moves).toEqual([])
    expect(fake.state.removed.filter(k => k.includes(preC4))).toEqual([])
    expect(fake.state.lists.files.find(f => f.id === preC4)).toMatchObject({ is_financial: true, storage_path: to, thumbnail_url: `${to}.jpg` })
    expect(fake.state.objects.filter(o => o.name.includes(preC4)).map(o => o.name).sort()).toEqual([to, `${to}.jpg`].sort())
    expect(recordOf(b).files).toContain(preC4)
    // CONTROL (review round 2): the same row with no body anywhere in the bucket is left as it is — said open with the reason, never flagged money over a key the bucket does not hold.
    newCloud({ inserts: {}, lists: {}, log: [], objects: [], moves: [], updates: [] })
    const c = desktopFixtures()
    c.files = c.files.map(f => (f.id === preC4 ? { ...f, is_financial: false } : f))
    serve([c])
    fake.state.lists.files = [{ id: preC4, project_id: PROJECT.id, storage_path: to, is_financial: false, thumbnail_url: null }]
    const bodiless = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(bodiless.receiptsMoved).toBe(0)
    expect(bodiless.files.receiptsOpen).toBe(1)
    expect(bodiless.errors).toEqual([expect.objectContaining({ scope: 'file', id: preC4, message: expect.stringMatching(/its body is not in the cloud at the place its row names, so the row was left as it is/) })])
    expect(fake.state.lists.files.find(f => f.id === preC4)).toMatchObject({ is_financial: false, storage_path: to })
    expect(fake.state.updates.filter(u => u.table === 'files')).toEqual([])
  })

  it('M2: someone the money gate shuts out leaves the money files an earlier run carried before the record is asked: none called removed, none written', async () => {
    const b = desktopFixtures()
    serve([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const money = FILES.filter(f => f.is_financial).map(f => f.id)
    expect(recordOf(b).files).toEqual(expect.arrayContaining(money))
    fake.state.moneyGate = false
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.removed.rows).toEqual([])
    expect(again.moneyLeft.projects).toBe(1)
  })

  it('M2: someone the Legal gate shuts out asks nothing of the Legal files an earlier run carried, and calls none of them removed — nor writes them again', async () => {
    const b = desktopFixtures()
    serve([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const legal = FILES.filter(f => Array.isArray(f.tags) && f.tags.includes('legal')).map(f => f.id)
    expect(legal.length).toBeGreaterThan(0)
    expect(recordOf(b).files).toEqual(expect.arrayContaining(legal))
    fake.state.legalGate = false
    fake.state.uploads = []
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.removed.rows).toEqual([])
    for (const id of legal) expect(fake.state.uploads.some(u => u.path.includes(id)), id).toBe(false)
    // CONTROL: the fake hides a Legal file from that person, as 0092 does.
    expect((await fake.client.from('files').select('id').in('id', legal)).data).toEqual([])
  })

  it('M3: a level skipped while the read of the project\'s levels failed is not known to be this project\'s — an asset in it waits (run again), never loses the link; the next run brings both', async () => {
    const b = desktopFixtures()
    serve([b])
    const level = GAME_LEVELS[0]
    fake.state.lists.levels = [{ ...omit(level, ['workspace_id']), project_id: PROJECT.id }]
    fake.state.listErrorFor = { levels: { message: 'network down' } }
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const inLevel = [...LEVEL_OF].filter(([, l]) => l.level_ids.includes(level.id)).map(([id]) => id)
    expect(inLevel.length).toBeGreaterThan(0)
    for (const id of inLevel) {
      expect(byId('assets', id), id).toBeUndefined()
      expect(report.errors.find(e => e.scope === 'asset' && e.id === id)?.message, id).toMatch(/whether its level is this project's in the cloud could not be checked/)
    }
    expect(recordOf(b).levels ?? []).not.toContain(level.id)
    fake.state.listErrorFor = {}
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    for (const id of inLevel) expect(byId('assets', id)?.level_ids, id).toContain(level.id)
  })

  it('M3: a bid version on a shot list skipped while the read of the project\'s lists failed waits (run again), its list kept for the next run', async () => {
    const b = desktopFixtures()
    serve([b])
    fake.state.lists.shot_lists = [{ id: LIST_1, project_id: PROJECT.id, title: 'already there', version: 1 }]
    fake.state.listErrorFor = { shot_lists: { message: 'network down' } }
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(byId('budget_versions', BUDGET_VERSIONS[0].id)).toBeUndefined()
    expect(report.errors.find(e => e.scope === 'budget_version' && e.id === BUDGET_VERSIONS[0].id)?.message).toMatch(/whether its shot list is this project's in the cloud could not be checked/)
    fake.state.listErrorFor = {}
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(byId('budget_versions', BUDGET_VERSIONS[0].id).shot_list_id).toBe(LIST_1)
  })

  it('M6: an actual on a line skipped while the read of the project\'s lines failed waits (run again) — it never hangs on a line not known to be this project\'s', async () => {
    const b = desktopFixtures()
    serve([b])
    const a = BUDGET_ACTUALS[2]
    // The line's id is another project's row, and the read of this project's lines fails.
    fake.state.lists.budget_lines = [{ id: a.line_id, project_id: 'p-other' }]
    fake.state.listErrorFor = { budget_lines: { message: 'network down' } }
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(byId('budget_actuals', a.id)).toBeUndefined()
    expect(report.errors.find(e => e.scope === 'budget_actual' && e.id === a.id)?.message).toMatch(/whether its budget line is this project's in the cloud could not be checked/)
    expect(recordOf(b).budget_lines ?? []).not.toContain(a.line_id)
  })

  it('L2: a task\'s item or a dependency the cloud holds under another id (the same pair) is skipped, never recorded — no later run calls it removed', async () => {
    const b = desktopFixtures()
    serve([b])
    const item = b.taskItems[0]
    const dep = DEPENDENCIES.find(d => d.kind === 'task')
    fake.state.lists.task_items = [{ id: 'item-teammate', task_id: item.task_id, project_id: PROJECT.id, entity_type: item.entity_type, entity_id: item.entity_id }]
    fake.state.lists.task_dependencies = [{ id: 'dep-teammate', predecessor_id: dep.predecessor_id, successor_id: dep.successor_id }]
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(recordOf(b).task_items).not.toContain(item.id)
    expect(recordOf(b).task_dependencies).not.toContain(dep.id)
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.removed.rows).toEqual([])
  })

  it('L3: a money question the cloud did not answer is an error, said as one — never "you are neither" — and none of the budget goes', async () => {
    serve([desktopFixtures()])
    fake.state.lists.projects = [{ id: PROJECT.id, workspace_id: WS }]
    fake.state.rpcRefuse.can_access_project_money = { code: '08006', message: 'connection failure' }
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toContainEqual({ scope: 'budget', projectId: PROJECT.id, message: "could not ask whether you can see this project's budget in the cloud, so none of it was carried (run again): connection failure" })
    expect(report.moneyLeft.projects).toBe(0)
    expect(lines.some(l => /you are neither/.test(l))).toBe(false)
    for (const t of ['budget_versions', 'budget_lines', 'budget_actuals', 'expenses', 'project_rate_overrides']) expect(fake.state.log, t).not.toContain(t)
  })

  it('L1: the dry run counts no money file the gate keeps here, as the real run carries none', async () => {
    serve([desktopFixtures()])
    fake.state.lists.projects = [{ id: PROJECT.id, workspace_id: WS }]
    fake.state.moneyGate = false
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    expect(dry.files.total).toBe(ALL_FILES.length - FILES.filter(f => f.is_financial).length)
    const real = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(real.files.total).toBe(dry.files.total)
  })
})

// ── M2 review round 2 (Fable): round 1's corrections attacked ─────────────
describe('M2 review round 2: what round 1 promised, held', () => {
  it('F1: a pointer the cloud already holds at this computer\'s value is recorded as set, so a teammate who clears it later is not overruled', async () => {
    const b = desktopFixtures()
    serve([b])
    // A teammate locked the same version in the browser before this run.
    fake.state.lists.projects = [{ id: PROJECT.id, workspace_id: WS, budget_active_version_id: versionV2, open_budget_version_id: null }]
    const first = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(first.errors).toEqual([])
    expect(fake.state.updates.filter(u => u.table === 'projects')).toEqual([])
    expect(recordOf(b).pointers).toEqual([`locked:${versionV2}`])
    // The teammate unlocks it: no later run locks it again.
    fake.state.lists.projects[0].budget_active_version_id = null
    fake.state.updates = []
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(fake.state.updates.filter(u => u.table === 'projects')).toEqual([])
    expect(fake.state.lists.projects[0].budget_active_version_id).toBeNull()
  })

  it('F2: a receipt found open, then removed in the cloud, stays removed — counted and named, its body never uploaded; the dry run says the same', async () => {
    const b = desktopFixtures()
    const preC4 = FILES.filter(f => f.is_financial)[1].id
    b.files = b.files.map(f => (f.id === preC4 ? { ...f, is_financial: false } : f))
    serve([b])
    fake.state.lists.files = [{ id: preC4, project_id: PROJECT.id, storage_path: `projects/${PROJECT.id}/files/${preC4}/receipt.pdf`, is_financial: false }]
    const first = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(first.files.receiptsOpen).toBe(1)
    expect(recordOf(b).receipts_open).toEqual([preC4])
    // An admin removes it in the browser, as the report's sentence says they may.
    fake.state.lists.files = fake.state.lists.files.filter(f => f.id !== preC4)
    fake.state.uploads = []
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    for (const r of [dry, again]) {
      expect(r.removed.rows).toEqual([expect.objectContaining({ table: 'files', id: preC4 })])
      expect(r.files.receiptsOpen).toBe(0)
    }
    expect(dry.files.total).toBe(again.files.total)
    expect(fake.state.uploads.filter(u => u.path.includes(preC4))).toEqual([])
    expect(byId('files', preC4)).toBeUndefined()
  })

  it('F6: a project of this workspace in the cloud\'s trash (hidden from every read, its id still holding the key) is said in words that name the trash', async () => {
    serve([desktopFixtures()])
    fake.state.failWith = (table) => (table === 'projects' ? { code: '23505', message: 'duplicate key value violates unique constraint "projects_pkey"' } : null)
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors).toEqual([{ scope: 'project', projectId: PROJECT.id, message: PROJECT_NOT_OURS }])
    expect(PROJECT_NOT_OURS).toBe("a project with this id is in the cloud, but not one you can see in this workspace (another company's, a private one, or one in the cloud's trash — restored, it carries on the next run), so none of it was written")
  })
})

// =============================================================================
// M3 (night 5): the people, the roster, the files kept with rows, the rate
// cards, the templates, the receipts moved, the archive — each rule with its
// failing control. The desktop's team is DESKTOP_MEMBERS (desktop ids, the
// fixtures' emails: one without, one twice, one nobody has); the company's
// directory is the fixtures' eight; the mover is Mara, an admin.
// =============================================================================

const { peopleMapOf, projectMemberRowForCloud, rateCardEntryRowForCloud, taskTemplateRowForCloud, managedFileRowForCloud, managedFileName, desktopFolderOfManagedFile, roleSlugOf } = await import('./migrationRows')
const { makeSlug } = await import('../../components/RateCard/useRateCard')
const { TUS_CHUNK_SIZE } = await import('../../tools/rabbit_v0.1.0/storage/resumableUpload.js')
const { registerStorageProvider, getStorageProvider, fileProviderFor, FILE_PROVIDERS } = await import('../../tools/rabbit_v0.1.0/storage/index.js')
const {
  PEOPLE_MATCHED, PEOPLE_NOT_MATCHED, PEOPLE_SHARED, PEOPLE_NEED_ADMIN, PEOPLE_UNREAD, MANAGERS_SEATED, PEOPLE_SET, ROLES_LEFT,
  RATE_CARDS_NEED_RIGHT, CARD_NOT_OURS, ENTRIES_NEED_GRANT, EMPTY_CARDS, TEMPLATES_LEFT, TEMPLATES_ORPHAN, ASSET_TEMPLATES_LINKED,
  MANAGED_FILES_WILL_UPLOAD, SERVER_MEDIA_STAY, BODIES_GONE, RECEIPTS_MOVED, RECEIPTS_WILL_MOVE,
} = await import('./runMigration')

const DIRECTORY = MEMBERS.map(m => ({ workspace_id: WS, user_id: m.user_id, app_role: m.app_role, username: m.username, display_name: m.display_name, is_active: true, email: m.email, grant_rate_card_view: false, grant_rate_card_edit: false }))
const serveM3 = (bundles, extra = {}) => {
  fake.state.callerId = MEMBER_ID.mara
  fake.state.directory = DIRECTORY.map(r => ({ ...r }))
  fake.state.lists.workspace_members = MEMBERS.map(m => ({ workspace_id: WS, user_id: m.user_id, is_active: true }))
  serve(bundles, { stores: desktopStores(), ...extra })
}
const workspaceRecordOf = () => servedRecord?.cloudMigration?.[WS]?.carried || {}
const DM = (key) => DESKTOP_ID_OF.get(MEMBER_ID[key])
const nameOf = (key) => MEMBERS.find(m => m.user_id === MEMBER_ID[key]).display_name
const personColumns = () => [
  ...ins('project_members').map(r => r.user_id), ...ins('tasks').flatMap(t => [t.assignee_id, t.reviewer_id]),
  ...ins('budget_lines').map(l => l.team_member_id), ...ins('project_rate_overrides').map(o => o.member_id),
  ...ins('rate_card_entries').map(e => e.member_id), ...ins('projects').flatMap(p => [p.producer_id, p.director_id]),
].filter(v => v != null)

describe('M3: the people map (migrationRows.peopleMapOf)', () => {
  it('an admin or a manager matches by email, trimmed and lower-cased, active accounts only; the unmatched are named with why; two desktop entries with one email both name the account', () => {
    const members = [
      { id: 'd1', name: 'Mara', email: ' MARA.OKONKWO@lanternash.example ' },
      { id: 'd2', name: 'Theo', email: 'theo.lindqvist@lanternash.example' },
      { id: 'd3', name: 'Lena', email: '' },
      { id: 'd4', name: 'Nadia', email: 'nadia@lanternash.example' },
      { id: 'd5', name: 'Theo again', email: 'Theo.Lindqvist@lanternash.example' },
      { id: 'd6', name: 'Old Jonah', email: 'jonah.beck@lanternash.example' },
    ]
    const directory = DIRECTORY.map(r => (r.user_id === MEMBER_ID.jonah ? { ...r, is_active: false } : r))
    const map = peopleMapOf({ members, directory, callerUserId: MEMBER_ID.mara })
    expect(map.canMatch).toBe(true)
    expect(map.userOf('d1')).toBe(MEMBER_ID.mara)
    expect(map.userOf('d2')).toBe(MEMBER_ID.theo)
    expect(map.userOf('d5')).toBe(MEMBER_ID.theo)
    expect(map.shared).toBe(2)
    expect(map.userOf('d3')).toBeNull()
    expect(map.userOf('d4')).toBeNull()
    expect(map.userOf('d6')).toBeNull()
    expect(map.unmatched).toEqual([{ id: 'd3', name: 'Lena', why: 'no_email' }, { id: 'd4', name: 'Nadia', why: 'no_account' }, { id: 'd6', name: 'Old Jonah', why: 'inactive' }])
    expect(map.matched).toBe(3)
    expect(map.desktop).toBe(6)
    expect(map.callerEditsRateCards).toBe(true)
    // A manager matches too; a manager without the grant does not edit the rate cards.
    const asKenji = peopleMapOf({ members, directory, callerUserId: MEMBER_ID.kenji })
    expect(asKenji.canMatch).toBe(true)
    expect(asKenji.callerEditsRateCards).toBe(false)
    expect(peopleMapOf({ members, directory: directory.map(r => (r.user_id === MEMBER_ID.kenji ? { ...r, grant_rate_card_edit: true } : r)), callerUserId: MEMBER_ID.kenji }).callerEditsRateCards).toBe(true)
    // The sentence names people, never an email.
    const words = PEOPLE_NOT_MATCHED(map.unmatched)
    expect(words).toBe('3 desktop team members not matched to a company account (no WILSON account yet: Nadia; no email on this computer: Lena; account deactivated: Old Jonah): their seats, crew lines, rates and tasks arrive without the person until they join (no email is sent)')
    expect(words).not.toMatch(/@/)
  })

  it('CONTROL: below admin or manager, or with no session, nobody is matched (a plain member reads only their own email — measured) and nothing is named', () => {
    const members = [{ id: 'd1', name: 'Mara', email: MEMBERS[0].email }, { id: 'd3', name: 'Priya', email: MEMBERS[2].email }]
    const asPriya = peopleMapOf({ members, directory: DIRECTORY.map(r => ({ ...r, email: r.user_id === MEMBER_ID.priya ? r.email : null })), callerUserId: MEMBER_ID.priya })
    expect(asPriya.canMatch).toBe(false)
    expect(asPriya.userOf('d3')).toBeNull()
    expect(asPriya.unmatched).toEqual([])
    expect(peopleMapOf({ members, directory: DIRECTORY, callerUserId: null }).canMatch).toBe(false)
    // CONTROL of the control: the same directory with Mara calling matches both.
    expect(peopleMapOf({ members, directory: DIRECTORY, callerUserId: MEMBER_ID.mara }).matched).toBe(2)
  })

  it('a seat row: the person by the map, the role as the desktop says (outside the three: member), the member\'s title, no dates, no workspace, no id; a slug as useRateCard makes one', () => {
    const map = peopleMapOf({ members: DESKTOP_MEMBERS, directory: DIRECTORY, callerUserId: MEMBER_ID.mara })
    const a = { id: 'ta-1', project_id: 'p', member_id: DM('theo'), role: 'manager', start_date: '2026-09-01', end_date: '2026-12-01' }
    expect(projectMemberRowForCloud(a, 'p', map, { title: 'Director' })).toEqual({ row: { project_id: 'p', user_id: MEMBER_ID.theo, project_role: 'manager', project_title: 'Director' }, roleLeft: false, datesLeft: 2 })
    expect(projectMemberRowForCloud({ ...a, role: 'producer', start_date: null }, 'p', map, { title: '' })).toEqual({ row: { project_id: 'p', user_id: MEMBER_ID.theo, project_role: 'member' }, roleLeft: true, datesLeft: 1 })
    expect(projectMemberRowForCloud({ ...a, member_id: NADIA_ID }, 'p', map, {})).toBeNull()
    for (const label of ['Director of Photography', '1st AC', ' Sound  Recordist ']) expect(roleSlugOf(label)).toBe(makeSlug(label))
    // An entry: the desktop's computed total dropped, a blank wage none, the person by the map (or left).
    const e = { id: 'e1', rate_card_id: 'c', role_label: 'Editor', role_slug: '', wage: '', day_rate: 550, burden: 12, burden_type: 'flat', overhead: '', overhead_type: 'percent', total: 616, member_id: DM('sofia'), currency: '' }
    const shaped = rateCardEntryRowForCloud(e, 'c2', map)
    expect(shaped).toEqual({ row: { id: 'e1', rate_card_id: 'c2', role_label: 'Editor', role_slug: 'editor', wage: 550, day_rate: 550, burden: 12, burden_type: 'percent', overhead: null, overhead_type: 'percent', member_id: MEMBER_ID.sofia }, userLeft: false })
    expect(shaped.row).not.toHaveProperty('total')
    expect(rateCardEntryRowForCloud({ ...e, member_id: NADIA_ID }, 'c2', map).userLeft).toBe(true)
    // A template: the cloud's workspace, the tasks in the desktop's shape (an older row's title read as its name).
    const t = taskTemplateRowForCloud({ id: 't1', workspace_id: DESKTOP_WS, name: '', tasks: [{ title: 'Plates', bid_days: '1', role_slug: 'dop' }, { id: 'x', name: 'Comp', bid_days: 6, sort_order: 1, depends_on: [null, 'y'] }], created_by: 'someone' }, WS, 'p')
    expect(t).toEqual({ id: 't1', workspace_id: WS, project_id: 'p', name: 'Untitled Template', description: '', tasks: [{ name: 'Plates', role_slug: 'dop', bid_days: 1, sort_order: 0, depends_on: [] }, { id: 'x', name: 'Comp', role_slug: '', bid_days: 6, sort_order: 1, depends_on: ['y'] }] })
  })
})

describe('M3: the round trip on the fixtures — the team, the files kept with rows, the rate cards and the templates', () => {
  it('every person column names an account, never a desktop id; the seats, the cards with their entries, the templates and the files kept with rows land with the cloud\'s shape; the run is clean', async () => {
    const b = withManaged(desktopFixtures())
    serveM3([b])
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toEqual([])
    expect(part2Missing()).toEqual({})
    // The people: the fixtures' eight less Lena (no email on the desktop) plus Nadia (no account) and Dev twice.
    expect(report.people).toMatchObject({ canMatch: true, desktop: DESKTOP_MEMBERS.length, matched: 8, shared: 2, needAdmin: false, unread: null })
    expect(report.people.unmatched).toEqual([{ id: DM('lena'), name: nameOf('lena'), why: 'no_email' }, { id: NADIA_ID, name: 'Nadia Quill', why: 'no_account' }])
    expect(lines).toContain(`  ${PEOPLE_MATCHED(8, DESKTOP_MEMBERS.length)}`)
    expect(lines).toContain(`  ${PEOPLE_NOT_MATCHED(report.people.unmatched)}`)
    expect(lines).toContain(`  ${PEOPLE_SHARED(2)}`)
    // No desktop id in any person column; no email anywhere in the report or the log.
    const desktopIds = new Set([...DESKTOP_MEMBERS.map(m => m.id), NADIA_ID])
    for (const v of personColumns()) expect(desktopIds.has(String(v)), v).toBe(false)
    expect(JSON.stringify(report) + lines.join('\n')).not.toMatch(/@lanternash\.example/)
    // The roster: Mara's seat is the project insert's own (fn_projects_auto_staff seats the mover — review round 1: the fake does as the trigger does), met on its pair and skipped;
    // Theo (member), Dev twice → one seat (the pair skipped); Lena and Nadia unmatched; a role outside the three is member, said.
    expect(ins('project_members').map(r => [r.user_id, r.project_role, r.project_title ?? null])).toEqual([[MEMBER_ID.theo, 'member', 'Director'], [MEMBER_ID.dev, 'member', 'Production Coordinator']])
    expect(fake.state.lists.project_members.find(r => r.user_id === MEMBER_ID.mara)).toMatchObject({ project_id: PROJECT.id, project_role: 'manager' })
    for (const r of ins('project_members')) for (const k of ['id', 'workspace_id', 'start_date', 'end_date', 'member_id', 'role']) expect(r, k).not.toHaveProperty(k)
    expect(report.projectMembers).toEqual({ total: 4, inserted: 2, skipped: 2, failed: 0, unmatched: 2, datesLeft: 1, rolesLeft: 1, left: 0 })
    expect(lines).toContain(`  ${ROLES_LEFT(1)}`)
    expect(report.notCarried).toContainEqual({ key: 'teamAssignments', label: 'team assignments of people without a WILSON account', count: 2, later: true })
    expect(report.notCarried).toContainEqual({ key: 'assignmentDates', label: "team assignment's start and end dates (no cloud columns)", count: 1, later: false })
    expect(report.people.managersSeated).toEqual([nameOf('mara')])
    expect(lines).toContain(`  ${MANAGERS_SEATED([nameOf('mara')])}`)
    // The project's people, the tasks', the lines', the rates': the accounts.
    expect(ins('projects')[0]).toMatchObject({ producer_id: MEMBER_ID.mara, director_id: MEMBER_ID.theo })
    for (const t of TASKS) expect(byId('tasks', t.id), t.title).toMatchObject({ assignee_id: expectUser(t.assignee_id), reviewer_id: expectUser(t.reviewer_id) })
    for (const l of BUDGET_LINES.filter(l => l.team_member_id)) expect(byId('budget_lines', l.id).team_member_id, l.label).toBe(expectUser(l.team_member_id))
    const memberRate = PROJECT_RATE_OVERRIDES.find(o => o.member_id)
    expect(byId('project_rate_overrides', memberRate.id)).toMatchObject({ member_id: memberRate.member_id, role_slug: null })
    // What Lena's rows leave: counted by kind; nothing else of the people is left.
    const lenaTasks = TASKS.filter(t => lenaIs(t.assignee_id) || lenaIs(t.reviewer_id)).length
    const lenaLines = BUDGET_LINES.filter(l => lenaIs(l.team_member_id)).length
    expect(report.notCarried.find(n => n.key === 'taskPeople')?.count ?? 0).toBe(lenaTasks)
    expect(report.notCarried.find(n => n.key === 'lineTeamMembers')?.count ?? 0).toBe(lenaLines)
    for (const k of ['memberRates', 'projectPeople']) expect(report.notCarried.find(n => n.key === k), k).toBeUndefined()
    // The rate cards: the two with entries, by their own ids, the cloud's workspace; the General one default (the cloud had none); the desktop's empty shell not carried; the entries with their people (Nadia's left).
    expect(ins('rate_cards').map(c => [c.id, c.workspace_id, c.type, c.is_default])).toEqual([[GENERAL_CARD_ID, WS, 'general', true], [RATE_CARDS[1].id, WS, 'internal', false]])
    for (const c of ins('rate_cards')) for (const k of ['source_file_id', 'created_by', 'deleted_at']) expect(c, k).not.toHaveProperty(k)
    expect(report.rateCards).toEqual({ total: 2, inserted: 2, skipped: 0, failed: 0, empty: 1, defaultsLeft: 0, left: 0 })
    expect(lines).toContain(`  ${EMPTY_CARDS(1)}`)
    const internal = ins('rate_card_entries').filter(e => e.rate_card_id === RATE_CARDS[1].id)
    expect(internal.map(e => e.member_id).sort()).toEqual(RATE_CARD_ENTRIES.filter(e => e.member_id).map(e => e.member_id).sort())
    for (const e of ins('rate_card_entries')) { expect(e, 'total').not.toHaveProperty('total'); expect(e.role_slug).toBeTruthy() }
    expect(report.rateCardEntries).toEqual({ total: RATE_CARD_ENTRIES.length, inserted: RATE_CARD_ENTRIES.length, skipped: 0, failed: 0, unmatched: 1, left: 0 })
    expect(report.notCarried).toContainEqual({ key: 'entryPeople', label: 'rate card entry of a team member without a WILSON account', count: 1, later: true })
    expect(report.notCarried).toContainEqual({ key: 'deptDefaults', label: "rate card's department default (no cloud home)", count: 1, later: false })
    // The templates: the global one and the one pinned to Salt Hours, the cloud's workspace, the tasks' names; the assets' links restored by UPDATE, only where empty.
    expect(ins('task_templates').map(t => [t.id, t.workspace_id, t.project_id])).toEqual([[TASK_TEMPLATES[0].id, WS, null], [TASK_TEMPLATES[1].id, WS, PROJECT.id]])
    expect(ins('task_templates')[1].tasks.map(t => t.name)).toEqual(['Plates', 'Comp', 'Director review', 'Final'])
    expect(report.taskTemplates).toEqual({ total: 2, inserted: 2, skipped: 0, failed: 0, orphans: 0, left: 0 })
    const linked = fake.state.updates.filter(u => u.table === 'assets')
    expect(linked.map(u => u.patch)).toEqual([{ task_template_id: TASK_TEMPLATES[1].id }])
    expect(fake.state.lists.assets.find(a => a.id === ASSETS[0].id).task_template_id).toBe(TASK_TEMPLATES[1].id)
    expect(report.assetTemplatesLinked).toBe(1)
    expect(lines).toContain(`  ${ASSET_TEMPLATES_LINKED(1)}`)
    expect(report.notCarried.map(n => n.key)).not.toContain('assetTemplates')
    // The files kept with rows: two rows through the files columns, bodies where the company keeps its media (Petal), the small one whole, the large one by Range.
    const small = byId('files', MANAGED.small.id)
    const large = byId('files', MANAGED.large.id)
    expect(small).toMatchObject({ project_id: PROJECT.id, name: 'plate.png', mime_type: 'image/png', size_bytes: 3, storage_provider: 'supabase', kind: 'source', is_core_definer: false, is_financial: false, asset_id: ASSET_ID(1), folder_id: FOLDERS.find(f => f.asset_id === ASSET_ID(1)).id, description: 'first plate', tags: ['reference'], uploaded_at: MANAGED.small.uploaded_at, created_at: MANAGED.small.uploaded_at })
    expect(small.storage_path).toMatch(new RegExp(`^projects/${PROJECT.id}/files/${MANAGED.small.id}/\\d+-plate\\.png$`))
    expect(large).toMatchObject({ name: 'plate_scan.mov', scene_id: SCENES[0].id, folder_id: FOLDERS.find(f => f.scene_id === SCENES[0].id).id, description: 'v002 · second pass', size_bytes: MANAGED.large.size_bytes })
    for (const row of [small, large]) for (const k of ['stored_name', 'version', 'version_label', 'folder_path', 'extension', 'original_name', 'file_name', 'thumbnail_path', 'uploaded_by', 'notes', 'deleted_at']) expect(row, k).not.toHaveProperty(k)
    expect(byId('files', MANAGED.deleted.id)).toBeUndefined()
    expect(report.managedFiles).toMatchObject({ total: 2, inserted: 2, skipped: 0, failed: 0, uploaded: 2, bytes: 3 + MANAGED.large.size_bytes, placed: 2, bodiesGone: 0, server: 0, overCap: 0, overBound: 0, versions: 1 })
    expect(report.notCarried).toContainEqual({ key: 'managedVersions', label: 'version label of a file kept with an asset, scene, shot, level or experience (the cloud keeps the file, not its number)', count: 1, later: false })
    // The small body: one GET, the standard put (the Blob); the large: Range requests only, six MiB at a time, the resumable path reserved first and released.
    const smallCalls = streamCalls.filter(c => c.id === MANAGED.small.id)
    expect(smallCalls.map(c => c.range)).toEqual(['bytes=0-0', null])
    expect(fake.state.uploads.find(u => u.path === small.storage_path)).toMatchObject({ size: 3, bucket: 'rabbit-files' })
    const largeCalls = streamCalls.filter(c => c.id === MANAGED.large.id)
    expect(largeCalls.every(c => c.range)).toBe(true)
    expect(largeCalls.length).toBe(1 + Math.ceil(MANAGED.large.size_bytes / TUS_CHUNK_SIZE))
    expect(fake.state.uploads.some(u => u.path === large.storage_path)).toBe(false)
    expect(fake.state.tus).toEqual([{ key: large.storage_path, bucket: 'rabbit-files', chunks: expect.any(Array), headers: expect.objectContaining({ authorization: 'Bearer tok', 'x-upsert': 'false' }) }])
    const chunks = fake.state.tus[0].chunks
    expect(chunks.length).toBe(Math.ceil(MANAGED.large.size_bytes / TUS_CHUNK_SIZE))
    expect(Math.max(...chunks)).toBeLessThanOrEqual(TUS_CHUNK_SIZE)
    expect(chunks.reduce((a, c) => a + c, 0)).toBe(MANAGED.large.size_bytes)
    expect(fake.state.reservations).toEqual([{ p_path: large.storage_path, p_bytes: MANAGED.large.size_bytes }])
    expect(fake.state.released).toEqual([['release_upload_reservation', { p_path: large.storage_path }]])
    // Every read of the stream was a probe: the desktop wrote no 'downloaded' event.
    expect(streamCalls.every(c => c.probe)).toBe(true)
    expect(streamEvents).toBe(0)
    // The records: the project's seats by user id, its files with the managed ones; the workspace's cards, entries and templates.
    const rec = recordOf(b)
    expect(new Set(rec.project_members)).toEqual(new Set([MEMBER_ID.mara, MEMBER_ID.theo, MEMBER_ID.dev]))
    expect(rec.files).toEqual(expect.arrayContaining([MANAGED.small.id, MANAGED.large.id]))
    const wrec = workspaceRecordOf()
    expect(new Set(wrec.rate_cards)).toEqual(new Set([GENERAL_CARD_ID, RATE_CARDS[1].id]))
    expect(new Set(wrec.rate_card_entries)).toEqual(new Set(RATE_CARD_ENTRIES.map(e => e.id)))
    expect(new Set(wrec.task_templates)).toEqual(new Set(TASK_TEMPLATES.map(t => t.id)))
    expect(recordWrites.every(w => w.workspace_id === WS)).toBe(true)
  })

  it('writes in an order every key allows: the seats right after the project and before the phases; the cards before the projects; the files kept with rows after the folders and files; the templates after the last project; the assets\' links after the templates', async () => {
    serveM3([withManaged(desktopFixtures())])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const log = fake.state.log
    const first = (t) => log.indexOf(t); const last = (t) => log.lastIndexOf(t)
    expect(first('project_members')).toBeGreaterThan(first('projects'))
    expect(last('project_members')).toBeLessThan(first('phases'))
    expect(last('rate_cards')).toBeLessThan(first('projects'))
    expect(last('rate_card_entries')).toBeLessThan(first('projects'))
    expect(first('task_templates')).toBeGreaterThan(last('projects'))
    expect(first('task_templates')).toBeGreaterThan(last('assets'))
    const managedInsert = fake.state.inserts.files.findIndex(f => f.id === MANAGED.small.id)
    expect(managedInsert).toBeGreaterThanOrEqual(0)
    // The files' inserts come after every folder's (the managed rows among them).
    expect(first('files')).toBeGreaterThan(last('folders'))
    const assetLink = fake.state.updates.findIndex(u => u.table === 'assets')
    expect(assetLink).toBeGreaterThanOrEqual(0)
  })

  it('run twice: the second writes nothing — no seat, no card, no entry, no template, no body, no update — and the records name every row the first carried', async () => {
    const b = withManaged(desktopFixtures())
    serveM3([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    const listsBefore = JSON.stringify(fake.state.lists)
    const objectsBefore = JSON.stringify(fake.state.objects)
    fake.state.log = []; fake.state.updates = []; fake.state.uploads = []; fake.state.tus = []; fake.state.reservations = []; streamCalls = []
    const said = []
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => said.push(m) })
    expect(JSON.stringify(fake.state.lists)).toBe(listsBefore)
    expect(JSON.stringify(fake.state.objects)).toBe(objectsBefore)
    expect(fake.state.log.filter(t => t !== 'bin_locations')).toEqual(['projects'])
    expect(fake.state.updates).toEqual([])
    expect(fake.state.uploads).toEqual([])
    expect(fake.state.tus).toEqual([])
    expect(streamCalls).toEqual([])
    for (const k of ['projectMembers', 'rateCards', 'rateCardEntries', 'taskTemplates', 'managedFiles']) { expect(again[k].inserted, k).toBe(0); expect(again[k].failed, k).toBe(0) }
    expect(again.projectMembers.skipped).toBe(4)
    // Review round 2: a role outside the three is said left only where a seat is given — not on a run that gave none.
    expect(again.projectMembers.rolesLeft).toBe(0)
    expect(said).not.toContain(`  ${ROLES_LEFT(1)}`)
    expect(again.managedFiles.skipped).toBe(2)
    expect(again.assetTemplatesLinked).toBe(0)
    expect(again.removed.rows).toEqual([])
    expect(again.errors).toEqual([])
  })

  it('the dry run promises what the real run does: the people lines, the seats, the cards, the templates, the files kept with rows and their bytes — and writes nothing', async () => {
    serveM3([withManaged(desktopFixtures())])
    const lines = []
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(fake.state.log).toEqual([])
    expect(fake.state.updates).toEqual([])
    expect(fake.state.uploads).toEqual([])
    // Review round 1: the dry run probes each body (one Range request, no event) and reads nothing else of it.
    expect(streamCalls.map(c => [c.range, c.probe])).toEqual([['bytes=0-0', true], ['bytes=0-0', true]])
    expect(streamEvents).toBe(0)
    expect(recordWrites).toEqual([])
    expect(dry.people).toMatchObject({ matched: 8, desktop: DESKTOP_MEMBERS.length, managersSeated: [nameOf('mara')] })
    // The mover's own seat, which the insert will make, is counted as there (review round 1).
    expect(dry.projectMembers).toMatchObject({ total: 4, inserted: 2, skipped: 2, unmatched: 2 })
    expect(dry.rateCards).toMatchObject({ total: 2, inserted: 2, empty: 1 })
    expect(dry.rateCardEntries).toMatchObject({ inserted: RATE_CARD_ENTRIES.length, unmatched: 1 })
    expect(dry.taskTemplates).toMatchObject({ total: 2, inserted: 2 })
    expect(dry.assetTemplatesLinked).toBe(1)
    expect(dry.managedFiles).toMatchObject({ total: 2, inserted: 2, bytes: 3 + MANAGED.large.size_bytes, versions: 1 })
    expect(lines).toContain(`  ${MANAGED_FILES_WILL_UPLOAD(2, 3 + MANAGED.large.size_bytes)}`)
    const real = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    for (const k of ['rateCards', 'rateCardEntries', 'taskTemplates', 'managedFiles']) expect(real[k].inserted, k).toBe(dry[k].inserted)
    expect(real.projectMembers.inserted).toBe(dry.projectMembers.inserted)
    expect(real.projectMembers.skipped).toBe(dry.projectMembers.skipped)
    expect(real.assetTemplatesLinked).toBe(dry.assetTemplatesLinked)
  })

  it('CONTROL: the desktop\'s rows as it keeps them are refused as wilson-dev refused them, and the runner never sends one so', async () => {
    fake.state.lists.projects = [{ id: PROJECT.id, workspace_id: WS }]
    fake.state.lists.workspace_members = MEMBERS.map(m => ({ workspace_id: WS, user_id: m.user_id, is_active: true }))
    const insert = (table, row) => fake.client.from(table).insert(row)
    const b = withManaged(desktopFixtures())
    const stores = desktopStores()
    // A seat for a desktop id (no member), a role outside the three, the pair twice.
    expect((await insert('project_members', { project_id: PROJECT.id, user_id: DM('mara'), project_role: 'manager' })).error).toMatchObject({ code: '23503', message: expect.stringMatching(/project_members_member_fkey/) })
    expect((await insert('project_members', { project_id: PROJECT.id, user_id: MEMBER_ID.mara, project_role: 'producer' })).error).toMatchObject({ code: '23514' })
    expect((await insert('project_members', { project_id: PROJECT.id, user_id: MEMBER_ID.mara, project_role: 'manager' })).error).toBeNull()
    expect((await insert('project_members', { project_id: PROJECT.id, user_id: MEMBER_ID.mara, project_role: 'member' })).error).toMatchObject({ code: '23505', message: expect.stringMatching(/project_members_pkey/) })
    // fn_projects_auto_staff on UPDATE OF producer_id (review round 2): a member producer is seated manager; a stranger is not, and the project lands.
    expect((await fake.client.from('projects').update({ producer_id: MEMBER_ID.priya }).eq('id', PROJECT.id)).error).toBeNull()
    expect(fake.state.lists.project_members.find(r => r.user_id === MEMBER_ID.priya)).toMatchObject({ project_id: PROJECT.id, project_role: 'manager' })
    expect((await fake.client.from('projects').update({ producer_id: 'nobody' }).eq('id', PROJECT.id)).error).toBeNull()
    expect(fake.state.lists.project_members.some(r => r.user_id === 'nobody')).toBe(false)
    // A card with the desktop's workspace, a type outside the two; an entry with the desktop's total, a blank wage, a type outside percent|fixed.
    expect((await insert('rate_cards', { ...stores.rateCards[0].card })).error).toMatchObject({ code: '42501' })
    expect((await insert('rate_cards', { id: 'rc-x', workspace_id: WS, name: 'x', type: 'vendor' })).error).toMatchObject({ code: '23514', message: expect.stringMatching(/rc_type_chk/) })
    expect((await insert('rate_cards', { id: GENERAL_CARD_ID, workspace_id: WS, name: 'x', type: 'general', is_default: true })).error).toBeNull()
    expect((await insert('rate_card_entries', { ...stores.rateCards[1].entries[0], rate_card_id: GENERAL_CARD_ID })).error).toMatchObject({ code: 'PGRST204', message: expect.stringMatching(/'total'/) })
    expect((await insert('rate_card_entries', { id: 'e-x', rate_card_id: GENERAL_CARD_ID, role_label: 'x', role_slug: 'x', wage: '' })).error).toMatchObject({ code: '22P02' })
    expect((await insert('rate_card_entries', { id: 'e-y', rate_card_id: GENERAL_CARD_ID, role_label: 'x', role_slug: 'x', burden_type: 'flat' })).error).toMatchObject({ code: '23514', message: expect.stringMatching(/rce_burden_type_chk/) })
    // A template with the desktop's workspace; pinned to another workspace's project; tasks not an array.
    expect((await insert('task_templates', { ...omit(stores.templates[0], ['created_by', 'updated_by']) })).error).toMatchObject({ code: '42501' })
    expect((await insert('task_templates', { id: 't-x', workspace_id: WS, name: 'x', description: '', tasks: [], project_id: 'p-other' })).error).toMatchObject({ code: '23503', message: expect.stringMatching(/task_templates_project_workspace_fk/) })
    expect((await insert('task_templates', { id: 't-y', workspace_id: WS, name: 'x', description: '', tasks: { a: 1 } })).error).toMatchObject({ code: '23514' })
    // A files row with a managed row's keys, or its provider; an asset version in the desktop's shape.
    expect((await insert('files', { ...b.managedFiles[0] })).error).toMatchObject({ code: 'PGRST204', message: expect.stringMatching(/'file_name'|'stored_name'|'version'/) })
    expect((await insert('files', { id: 'f-x', project_id: PROJECT.id, name: 'x', storage_provider: 'local_managed', storage_path: 'projects/x/files/y/z' })).error).toMatchObject({ code: '22P02', message: expect.stringMatching(/local_managed/) })
    expect((await insert('asset_versions', { id: 'v-x', asset_id: 'a', project_id: PROJECT.id, version_no: 1 })).error).toMatchObject({ code: 'PGRST204', message: expect.stringMatching(/'project_id'/) })
    // The runner's rows land.
    newCloud({ inserts: {}, lists: {}, log: [], objects: [] })
    serveM3([b])
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors).toEqual([])
    expect(ins('project_members')).toHaveLength(2)
    expect(ins('rate_cards')).toHaveLength(2)
    expect(ins('task_templates')).toHaveLength(2)
  })

  it('CONTROL: a person column sent raw (the rule before M3) names nobody; the map is what removes the desktop id — and a project row shaped without the map keeps it', () => {
    const map = peopleMapOf({ members: DESKTOP_MEMBERS, directory: DIRECTORY, callerUserId: MEMBER_ID.mara })
    const desktop = desktopFixtures().project
    expect(projectRowForCloud(desktop, WS).producer_id).toBe(DM('mara'))
    expect(projectRowForCloud(desktop, WS, map).producer_id).toBe(MEMBER_ID.mara)
    expect(budgetLineRowForCloud({ id: 'l', team_member_id: DM('sofia') }, PROJECT.id).team_member_id).toBeNull()
    expect(budgetLineRowForCloud({ id: 'l', team_member_id: DM('sofia') }, PROJECT.id, map).team_member_id).toBe(MEMBER_ID.sofia)
    expect(budgetLineRowForCloud({ id: 'l', team_member_id: NADIA_ID }, PROJECT.id, map).team_member_id).toBeNull()
  })

  it('CONTROL: the mover\'s own seat, made by the project\'s insert, is met on its pair and skipped — never upserted, its role as the cloud gave it, recorded', async () => {
    const b = desktopFixtures()
    // The desktop says Mara is a member; the cloud seats her manager when the project goes in (fn_projects_auto_staff — measured; the fake's insert does the same since review round 1).
    b.teamAssignments = b.teamAssignments.map(a => (a.member_id === DM('mara') ? { ...a, role: 'member' } : a))
    serveM3([b])
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors).toEqual([])
    expect(ins('project_members').map(r => r.user_id)).not.toContain(MEMBER_ID.mara)
    expect(fake.state.lists.project_members.find(r => r.user_id === MEMBER_ID.mara).project_role).toBe('manager')
    expect(fake.state.updates.filter(u => u.table === 'project_members')).toEqual([])
    expect(fake.client.from('project_members').upsert).toBeUndefined()
    expect(recordOf(b).project_members).toContain(MEMBER_ID.mara)
    expect(report.projectMembers).toMatchObject({ skipped: 2, inserted: 2 })
    // A seat a teammate removes stays removed — Theo's, and Dev's, whom the desktop lists twice (one seat, said removed once: review round 2).
    fake.state.lists.project_members = fake.state.lists.project_members.filter(r => r.user_id !== MEMBER_ID.theo && r.user_id !== MEMBER_ID.dev)
    const said = []
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS, onProgress: (m) => said.push(m) })
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => said.push(m) })
    expect(fake.state.lists.project_members.some(r => r.user_id === MEMBER_ID.theo || r.user_id === MEMBER_ID.dev)).toBe(false)
    for (const r of [dry, again]) {
      expect(r.removed.byTable).toEqual({ project_members: 2 })
      expect(r.removed.rows.map(x => x.name).sort()).toEqual([nameOf('dev'), nameOf('theo')].sort())
    }
    // Review round 1: the progress log says it too (the snapshot is taken before the roster).
    expect(said.filter(l => l === `  ${REMOVED_SINCE_LAST_RUN(removedWords({ project_members: 2 }))}`)).toHaveLength(2)
  })

  it('a roster the cloud did not answer fails the seats this run would have given — the people without an account stay unmatched, as on any run (review round 2)', async () => {
    serveM3([desktopFixtures()])
    fake.state.listErrorFor = { project_members: { code: '08006', message: 'connection failure' } }
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors).toEqual([expect.objectContaining({ scope: 'project_members', projectId: PROJECT.id, message: expect.stringMatching(/could not read the project's roster in the cloud, so no seat was given \(run again\)/) })])
    expect(report.projectMembers).toMatchObject({ total: 4, inserted: 0, skipped: 0, failed: 4, unmatched: 2 })
    expect(ins('project_members')).toEqual([])
    expect(report.notCarried).toContainEqual({ key: 'teamAssignments', label: 'team assignments of people without a WILSON account', count: 2, later: true })
  })

  it('below admin or manager nobody is matched: said once, no seat, every person column empty and none counted as a person without an account (the one sentence covers the team — review round 1), the run not done (the panel\'s gate) — and a directory the cloud did not answer is an error, never "ask an admin"', async () => {
    const b = desktopFixtures()
    serveM3([b])
    fake.state.callerId = MEMBER_ID.priya
    fake.state.directory = DIRECTORY.map(r => ({ ...r, email: r.user_id === MEMBER_ID.priya ? r.email : null }))
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(lines).toContain(`  ${PEOPLE_NEED_ADMIN}`)
    expect(report.people).toMatchObject({ canMatch: false, needAdmin: true, matched: 0 })
    expect(ins('project_members')).toEqual([])
    expect(personColumns()).toEqual([])
    // Review round 1: nobody was looked up, so nobody is "without a WILSON account" beside PEOPLE_NEED_ADMIN; the roster is not even asked for.
    for (const k of ['teamAssignments', 'taskPeople', 'projectPeople', 'lineTeamMembers', 'memberRates', 'entryPeople']) expect(report.notCarried.map(n => n.key), k).not.toContain(k)
    expect(report.projectMembers).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0, unmatched: 0, datesLeft: 0, rolesLeft: 0, left: 0 })
    expect(fake.state.inReads.filter(([t]) => t === 'project_members')).toEqual([])
    expect(report.errors).toEqual([])
    // The directory unreadable: an error, said as one — and the same silence beside it.
    newCloud({ inserts: {}, lists: {}, log: [], objects: [] })
    serveM3([desktopFixtures()])
    fake.state.directoryError = { code: '08006', message: 'connection failure' }
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.errors).toContainEqual({ scope: 'people', message: PEOPLE_UNREAD('connection failure') })
    expect(again.people.needAdmin).toBe(false)
    for (const k of ['teamAssignments', 'taskPeople', 'projectPeople', 'lineTeamMembers']) expect(again.notCarried.map(n => n.key), k).not.toContain(k)
  })

  it('the people on rows an earlier run carried without them are set once — a line\'s person where null, a task\'s or the project\'s where the raw desktop id still stands — recorded, and a teammate who clears one is not overruled; the producer set is seated as manager', async () => {
    const b = desktopFixtures()
    // An earlier build's run: the project with raw desktop ids, the lines without their person, the tasks with raw ids, and its record.
    serve([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(fake.state.lists.projects[0].producer_id).toBeNull()
    // Make the cloud look like a pre-M3 build's: the raw ids on the project and the tasks (the build before M3 sent them so).
    fake.state.lists.projects[0].producer_id = DM('mara')
    fake.state.lists.projects[0].director_id = DM('theo')
    for (const t of fake.state.lists.tasks) { const src = TASKS.find(x => x.id === t.id); t.assignee_id = DESKTOP_ID_OF.get(src.assignee_id); t.reviewer_id = DESKTOP_ID_OF.get(src.reviewer_id) }
    fake.state.log = []; fake.state.updates = []
    serveM3([b])
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toEqual([])
    // Every column naming a matched person is set; Lena's (no account yet) keep the raw id until she joins.
    const linesWithPeople = BUDGET_LINES.filter(l => l.team_member_id && !lenaIs(l.team_member_id)).length
    const tasksWithPeople = TASKS.filter(t => [t.assignee_id, t.reviewer_id].some(u => u && !lenaIs(u))).length
    // Rows, not columns (review round 1): a task's assignee and reviewer are one row; the project's producer and director one.
    expect(report.people.set).toBe(linesWithPeople + tasksWithPeople + 1)
    expect(lines).toContain(`  ${PEOPLE_SET(report.people.set)}`)
    const rawOr = (uid) => (lenaIs(uid) ? DESKTOP_ID_OF.get(String(uid)) : uid)
    for (const l of BUDGET_LINES.filter(l => l.team_member_id)) expect(fake.state.lists.budget_lines.find(x => x.id === l.id).team_member_id, l.label).toBe(lenaIs(l.team_member_id) ? null : l.team_member_id)
    for (const t of TASKS) expect(fake.state.lists.tasks.find(x => x.id === t.id), t.title).toMatchObject({ assignee_id: rawOr(t.assignee_id), reviewer_id: rawOr(t.reviewer_id) })
    expect(fake.state.lists.projects[0]).toMatchObject({ producer_id: MEMBER_ID.mara, director_id: MEMBER_ID.theo })
    expect(report.people.managersSeated).toEqual([nameOf('mara')])
    const set = recordOf(b).people_set
    expect(set).toContain(`project:${PROJECT.id}:producer_id`)
    expect(set).toContain(`task:${TASKS[0].id}:assignee_id`)
    expect(set.filter(k => k.startsWith('line:'))).toHaveLength(linesWithPeople)
    // Every update was guarded on the column's current value (null, or the raw id): the fake's filters say so.
    for (const u of fake.state.updates.filter(u => ['tasks', 'budget_lines', 'projects'].includes(u.table))) expect(u.filters.some(([c, , op]) => op === 'is' || c === Object.keys(u.patch)[0]), JSON.stringify(u)).toBe(true)
    // A teammate clears a line's person and a task's assignee: no later run sets them again.
    const line = BUDGET_LINES.find(l => l.team_member_id && !lenaIs(l.team_member_id))
    fake.state.lists.budget_lines.find(x => x.id === line.id).team_member_id = null
    fake.state.lists.tasks.find(x => x.id === TASKS[0].id).assignee_id = null
    fake.state.updates = []
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.people.set).toBe(0)
    expect(fake.state.updates.filter(u => ['tasks', 'budget_lines', 'projects'].includes(u.table))).toEqual([])
    expect(fake.state.lists.budget_lines.find(x => x.id === line.id).team_member_id).toBeNull()
    // CONTROL: without the record (an earlier build's), the cleared line would be filled again.
    delete b[RECORD_KEY]
    const third = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(third.people.set).toBeGreaterThan(0)
    expect(fake.state.lists.budget_lines.find(x => x.id === line.id).team_member_id).toBe(line.team_member_id)
  })

  it('a row that arrives with its person is recorded as set at the insert, so a teammate who clears the person afterwards is not overruled by the next run — nor is a cleared producer seated again; a column that arrived empty is not recorded (review round 1)', async () => {
    const b = desktopFixtures()
    serveM3([b])
    const first = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(first.errors).toEqual([])
    const set = recordOf(b).people_set
    const line = BUDGET_LINES.find(l => l.team_member_id && !lenaIs(l.team_member_id))
    const task = TASKS.find(t => t.assignee_id && !lenaIs(t.assignee_id))
    expect(set).toEqual(expect.arrayContaining([`project:${PROJECT.id}:producer_id`, `project:${PROJECT.id}:director_id`, `line:${line.id}:team_member_id`, `task:${task.id}:assignee_id`]))
    // Lena's columns arrived empty (no account yet): not recorded, so the run after she joins sets them.
    const lenaLine = BUDGET_LINES.find(l => lenaIs(l.team_member_id))
    const lenaTask = TASKS.find(t => lenaIs(t.assignee_id))
    expect(set).not.toContain(`line:${lenaLine.id}:team_member_id`)
    expect(set).not.toContain(`task:${lenaTask.id}:assignee_id`)
    // A teammate clears the three in the browser.
    fake.state.lists.projects[0].producer_id = null
    fake.state.lists.budget_lines.find(x => x.id === line.id).team_member_id = null
    fake.state.lists.tasks.find(x => x.id === task.id).assignee_id = null
    fake.state.updates = []
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    for (const r of [dry, again]) { expect(r.people.set).toBe(0); expect(r.people.managersSeated).toEqual([]) }
    expect(fake.state.updates.filter(u => ['tasks', 'budget_lines', 'projects'].includes(u.table))).toEqual([])
    expect(fake.state.lists.projects[0].producer_id).toBeNull()
    expect(fake.state.lists.budget_lines.find(x => x.id === line.id).team_member_id).toBeNull()
    expect(fake.state.lists.tasks.find(x => x.id === task.id).assignee_id).toBeNull()
    // CONTROL: with the keys the insert recorded taken out of the record (the build before this round), the next run sets all three again and seats the producer.
    const carried = b[RECORD_KEY][WS].carried
    carried.people_set = carried.people_set.filter(k => !k.startsWith('project:') && k !== `line:${line.id}:team_member_id` && k !== `task:${task.id}:assignee_id`)
    const third = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(third.people.set).toBe(3)
    expect(third.people.managersSeated).toEqual([nameOf('mara')])
    expect(fake.state.lists.projects[0].producer_id).toBe(MEMBER_ID.mara)
  })
})

describe('M3: the files kept with rows — the storage rule, the body, the key', () => {
  it('a body gone from the disk (410) is counted and said, not failed, not uploaded, and the run is not done; a link to a row removed on this computer is let go; a link to a row that failed holds the file', async () => {
    const b = withManaged(desktopFixtures())
    b.managedFiles.push({ ...MANAGED.small, id: '0e1a0000-0000-4000-8000-0000000f0009', asset_id: 'asset-removed-here', original_name: 'orphan.png' })
    serveM3([b], { gone: new Set([MANAGED.large.id]) })
    // Review round 1: the dry run probes the bodies too, so it promises what the real run does — the gone one said, the bytes the bytes sent.
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    expect(dry.managedFiles).toMatchObject({ total: 2, inserted: 2, failed: 0, bodiesGone: 1, linksLetGo: 1, bytes: 6 })
    expect(fake.state.uploads).toEqual([])
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toEqual([])
    expect(report.managedFiles).toMatchObject({ total: 2, inserted: 2, failed: 0, bodiesGone: 1, linksLetGo: 1, bytes: 6 })
    expect(byId('files', MANAGED.large.id)).toBeUndefined()
    expect(byId('files', '0e1a0000-0000-4000-8000-0000000f0009').asset_id).toBeNull()
    expect(lines).toContain(`  ${BODIES_GONE(1)}`)
    expect(recordOf(b).files).not.toContain(MANAGED.large.id)
    expect(fake.state.tus).toEqual([])
    // A second run with the body back carries it (never called removed).
    serveM3([b])
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(byId('files', MANAGED.large.id)).toBeTruthy()
    expect(again.removed.rows).toEqual([])
    // A file whose asset failed this run waits with it.
    newCloud({ inserts: {}, lists: {}, log: [], objects: [] })
    const c = withManaged(desktopFixtures())
    serveM3([c])
    fake.state.failWith = (table, row) => (table === 'assets' && row.id === ASSET_ID(1) ? { code: '08006', message: 'connection failure' } : null)
    const third = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(byId('files', MANAGED.small.id)).toBeUndefined()
    expect(third.errors.find(e => e.scope === 'managed_file' && e.id === MANAGED.small.id)?.message).toMatch(/its asset is not in the cloud, so the file was not carried \(a second run brings both\)/)
  })

  it('a file kept with a row that a teammate removed in the cloud since an earlier run is called removed, named — never skipped as if it were there — and never carried again; the dry run says the same (review round 1)', async () => {
    const b = withManaged(desktopFixtures())
    serveM3([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(recordOf(b).files).toContain(MANAGED.small.id)
    // The teammate removes the small one in the browser.
    fake.state.lists.files = fake.state.lists.files.filter(f => f.id !== MANAGED.small.id)
    fake.state.uploads = []; streamCalls = []
    const dry = await runMigration({ workspaceId: WS, dryRun: true, locations: SALT_LOCATIONS })
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    for (const r of [dry, again]) {
      expect(r.managedFiles).toMatchObject({ inserted: 0, skipped: 1, failed: 0 })
      expect(r.removed.byTable).toEqual({ files: 1 })
      expect(r.removed.rows).toEqual([{ projectId: PROJECT.id, table: 'files', id: MANAGED.small.id, name: 'plate.png' }])
    }
    expect(fake.state.uploads).toEqual([])
    expect(streamCalls).toEqual([])
    expect(fake.state.lists.files.some(f => f.id === MANAGED.small.id)).toBe(false)
  })

  it('a company on its own server (her ruling of 2026-10-28): nothing uploaded, no files row, one sentence; a private project the same; the ordinary files go as before', async () => {
    const b = withManaged(desktopFixtures())
    serveM3([b])
    fake.state.lists.workspace_storage = [{ workspace_id: WS, mode: 'byos', provider: 'network', provider_config: null, root_path: '\\\\nas\\media', root_kind: 'unc', updated_at: null, updated_by: null }]
    clearWorkspaceStorageCache()
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toEqual([])
    expect(byId('files', MANAGED.small.id)).toBeUndefined()
    expect(byId('files', MANAGED.large.id)).toBeUndefined()
    expect(fake.state.uploads.some(u => u.path.includes(MANAGED.small.id))).toBe(false)
    expect(fake.state.tus).toEqual([])
    expect(streamCalls).toEqual([])
    expect(report.managedFiles).toMatchObject({ total: 0, inserted: 0, server: 2 })
    expect(lines).toContain(`  ${SERVER_MEDIA_STAY(2)}`)
    expect(report.notCarried).toContainEqual({ key: 'managedFilesServer', label: "files kept with assets, scenes, shots, levels and experiences on the company's own server (the browser says where they are)", count: 2, later: false })
    expect(ins('files').length).toBe(ALL_FILES.length)
    // A private project: its media lives on the computer that added it.
    newCloud({ inserts: {}, lists: {}, log: [], objects: [] })
    fake.state.lists.workspace_storage = []
    clearWorkspaceStorageCache()
    const c = withManaged(desktopFixtures())
    c.project.is_private = true
    serveM3([c])
    const second = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(second.managedFiles).toMatchObject({ total: 0, privateHome: 2 })
    expect(byId('files', MANAGED.small.id)).toBeUndefined()
    // CONTROL: on Petal the same two go up.
    newCloud({ inserts: {}, lists: {}, log: [], objects: [] })
    clearWorkspaceStorageCache()
    serveM3([withManaged(desktopFixtures())])
    const third = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(third.managedFiles.inserted).toBe(2)
  })

  it('a company in its own bucket (s3): one PUT through the s3 provider, up to its bound; a body past 5 GiB is left and counted; money never goes there (the invoices stay on Supabase)', async () => {
    const realS3 = getStorageProvider(FILE_PROVIDERS.S3)
    const puts = []
    registerStorageProvider(FILE_PROVIDERS.S3, { ...realS3, put: async (key, body, opts) => { puts.push({ key, size: body?.size, contentType: opts?.contentType }); return { key } } })
    try {
      const b = withManaged(desktopFixtures())
      b.managedFiles.push({ ...MANAGED.large, id: '0e1a0000-0000-4000-8000-0000000f0010', original_name: 'master.mov', size_bytes: 5 * 1024 * 1024 * 1024 + 1 })
      serveM3([b])
      fake.state.lists.workspace_storage = [{ workspace_id: WS, mode: 'byos', provider: 's3', provider_config: { bucket: 'b' }, root_path: null, root_kind: null, updated_at: null, updated_by: null }]
      clearWorkspaceStorageCache()
      const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
      expect(report.errors).toEqual([])
      expect(puts.map(p => p.size).sort((x, y) => x - y)).toEqual([3, MANAGED.large.size_bytes])
      expect(byId('files', MANAGED.small.id).storage_provider).toBe('s3')
      expect(byId('files', MANAGED.large.id).storage_provider).toBe('s3')
      expect(byId('files', '0e1a0000-0000-4000-8000-0000000f0010')).toBeUndefined()
      expect(report.managedFiles).toMatchObject({ inserted: 2, overBound: 1 })
      expect(fake.state.tus).toEqual([])
      expect(fake.state.reservations).toEqual([])
      // Money stays on Supabase whatever the company chose: the pin, and the invoices' rows.
      expect(fileProviderFor('s3', { financial: true })).toBe('supabase')
      for (const f of FILES.filter(f => f.is_financial)) expect(byId('files', f.id).storage_provider, f.id).toBe('supabase')
    } finally {
      registerStorageProvider(FILE_PROVIDERS.S3, realS3)
      clearWorkspaceStorageCache()
    }
  })

  it('the key is never reused: an object already under the file\'s directory of the body\'s size is taken as the body (a run that stopped before the row) and nothing is uploaded again; one of another size is not', async () => {
    const b = withManaged(desktopFixtures())
    serveM3([b])
    const dir = `projects/${PROJECT.id}/files/${MANAGED.large.id}`
    fake.state.objects.push({ bucket: 'rabbit-files', name: `${dir}/.emptyFolderPlaceholder`, size: 0 }, { bucket: 'rabbit-files', name: `${dir}/1700000000000-plate_scan.mov`, size: MANAGED.large.size_bytes })
    fake.state.objects.push({ bucket: 'rabbit-files', name: `projects/${PROJECT.id}/files/${MANAGED.small.id}/1700000000000-plate.png`, size: 99 })
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors).toEqual([])
    expect(byId('files', MANAGED.large.id).storage_path).toBe(`${dir}/1700000000000-plate_scan.mov`)
    expect(fake.state.tus).toEqual([])
    expect(report.managedFiles.bytes).toBe(3)
    // Review round 2: the bodies sent, apart from the rows inserted (the panel's line counts these).
    expect(report.managedFiles).toMatchObject({ inserted: 2, uploaded: 1 })
    // The small one's stray object is another size: a new key, uploaded.
    expect(byId('files', MANAGED.small.id).storage_path).not.toBe(`projects/${PROJECT.id}/files/${MANAGED.small.id}/1700000000000-plate.png`)
    expect(fake.state.uploads.filter(u => u.path.includes(MANAGED.small.id))).toHaveLength(1)
  })

  it('CONTROL: a managed row\'s shape and folder, pure — the name with its extension, the folder at its path else its entity\'s, the version label ahead of the notes only past the first version, no Legal tag', () => {
    expect(managedFileName({ original_name: 'Plate.PNG' })).toBe('Plate.PNG')
    expect(managedFileName({ file_name: 'plate', extension: '.png' })).toBe('plate.png')
    expect(managedFileName({ file_name: 'plate.png', extension: '.png' })).toBe('plate.png')
    expect(managedFileName({})).toBe('file')
    const folders = [...FOLDERS]
    const assetFolder = folders.find(f => f.asset_id === ASSET_ID(1))
    expect(desktopFolderOfManagedFile({ folder_path: `${assetFolder.path}/`, asset_id: ASSET_ID(2) }, folders).id).toBe(assetFolder.id)
    expect(desktopFolderOfManagedFile({ folder_path: 'ASSETS/nowhere/', asset_id: ASSET_ID(1) }, folders).id).toBe(assetFolder.id)
    expect(desktopFolderOfManagedFile({ folder_path: 'ASSETS/nowhere/' }, folders)).toBeNull()
    const base = { id: 'f', notes: 'n', version: 1, tags: ['legal', 'reference', 'finance', 'nope'] }
    const one = managedFileRowForCloud(base, 'p', { storageProvider: 'supabase', storagePath: 'k' })
    expect(one.row.description).toBe('n')
    expect(one.row.tags).toEqual(['reference'])
    expect(one.versionLeft).toBe(false)
    const two = managedFileRowForCloud({ ...base, version: 2, version_label: 'v002', notes: '' }, 'p', { storageProvider: 'supabase', storagePath: 'k' })
    expect(two.row.description).toBe('v002')
    expect(two.versionLeft).toBe(true)
    expect(managedFileRowForCloud({ ...base, version: 3, version_label: '' }, 'p', { storageProvider: 'supabase', storagePath: 'k' }).row.description).toBe('v003 · n')
  })
})

describe('M3: the rate cards and the templates — who may, whose a card is', () => {
  it('a card whose id the cloud holds out of sight (trashed, or another company\'s) is refused in words and never recorded; one the cloud shows is skipped and recorded; the cloud\'s own default of a type keeps the desktop\'s default off', async () => {
    const b = desktopFixtures()
    serveM3([b])
    fake.state.lists.rate_cards = [
      { id: GENERAL_CARD_ID, workspace_id: 'ws-other', type: 'general', is_default: true, name: 'Theirs' },
      { id: 'rc-cloud-general', workspace_id: WS, type: 'general', is_default: true, name: 'General Rate Card' },
      { id: RATE_CARDS[1].id, workspace_id: WS, type: 'internal', is_default: false, name: 'Internal Rate Card', deleted_at: null },
    ]
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.errors).toEqual([{ scope: 'rate_card', id: GENERAL_CARD_ID, message: CARD_NOT_OURS('General Rate Card') }])
    expect(report.rateCards).toMatchObject({ inserted: 0, skipped: 1, failed: 1 })
    expect(workspaceRecordOf().rate_cards).toEqual([RATE_CARDS[1].id])
    // The internal card's entries went up under it; the general card's did not (their card was refused).
    expect(ins('rate_card_entries').every(e => e.rate_card_id === RATE_CARDS[1].id)).toBe(true)
    // A trashed card of this workspace: the same answer.
    newCloud({ inserts: {}, lists: {}, log: [], objects: [] })
    serveM3([desktopFixtures()])
    fake.state.lists.rate_cards = [{ id: GENERAL_CARD_ID, workspace_id: WS, type: 'general', is_default: false, name: 'Old', deleted_at: '2026-10-01T00:00:00Z' }]
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.errors).toEqual([{ scope: 'rate_card', id: GENERAL_CARD_ID, message: CARD_NOT_OURS('General Rate Card') }])
    expect(workspaceRecordOf().rate_cards ?? []).not.toContain(GENERAL_CARD_ID)
    // The cloud's default of the type: the desktop's General lands with is_default false, counted.
    newCloud({ inserts: {}, lists: {}, log: [], objects: [] })
    serveM3([desktopFixtures()])
    fake.state.lists.rate_cards = [{ id: 'rc-cloud-general', workspace_id: WS, type: 'general', is_default: true, name: 'General Rate Card' }]
    const third = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(byId('rate_cards', GENERAL_CARD_ID).is_default).toBe(false)
    expect(third.rateCards.defaultsLeft).toBe(1)
    expect(fake.state.lists.rate_cards.find(c => c.id === 'rc-cloud-general').is_default).toBe(true)
  })

  it('a manager without the edit grant leaves the cards here, said once, nothing tried, the run not done; a plain user the templates; a refused entry stops the card\'s entries, counted', async () => {
    serveM3([desktopFixtures()])
    fake.state.callerId = MEMBER_ID.kenji
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toEqual([])
    expect(fake.state.log).not.toContain('rate_cards')
    // Review round 1: the desktop's empty shell is noise, not a card left for want of the right.
    expect(report.rateCards).toMatchObject({ total: 0, left: 2, empty: 1 })
    expect(report.needsRights.rateCards).toBe(true)
    expect(lines).toContain(`  ${RATE_CARDS_NEED_RIGHT(2)}`)
    expect(lines).toContain(`  ${EMPTY_CARDS(1)}`)
    // A manager matches people and writes the templates.
    expect(report.people.matched).toBe(8)
    expect(ins('task_templates')).toHaveLength(2)
    // The entries' gate met mid-way (the grant withdrawn): the card lands, its entries are counted, no error.
    newCloud({ inserts: {}, lists: {}, log: [], objects: [] })
    serveM3([desktopFixtures()])
    fake.state.entryGate = false
    const second = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(second.errors).toEqual([])
    expect(second.rateCards.inserted).toBe(2)
    expect(second.rateCardEntries).toMatchObject({ inserted: 0, left: RATE_CARD_ENTRIES.length, unmatched: 1 })
    // Review round 1: entries refused mid-run are a right this person lacks — the run is not done.
    expect(second.needsRights.rateCards).toBe(true)
    // One insert met the gate; the rest were not tried (the gate is the person's, not a card's).
    expect(fake.state.log.filter(t => t === 'rate_card_entries')).toHaveLength(1)
    // The templates by a plain user who is a project manager: the pinned one lands, the global one is left, said, the run not done.
    newCloud({ inserts: {}, lists: {}, log: [], objects: [] })
    serveM3([desktopFixtures()])
    fake.state.callerId = MEMBER_ID.priya
    fake.state.directory = DIRECTORY.map(r => ({ ...r, email: r.user_id === MEMBER_ID.priya ? r.email : null }))
    fake.state.templateGate = 'pinned'
    const third = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(ins('task_templates').map(t => t.id)).toEqual([TASK_TEMPLATES[1].id])
    expect(third.taskTemplates).toMatchObject({ inserted: 1, left: 1 })
    expect(third.needsRights.templates).toBe(true)
    expect(lines).toContain(`  ${TEMPLATES_LEFT(1)}`)
  })

  it('a template pinned to a project not on this computer is left, counted; one whose project failed this run waits; an asset\'s link goes only to a template the cloud holds under this workspace (another workspace\'s id is never written), and only where empty', async () => {
    const b = desktopFixtures()
    const stores = desktopStores()
    stores.templates.push({ ...stores.templates[1], id: '0e1a0000-0000-4000-8000-00000000e001', name: 'Orphan', project_id: 'p-deleted-on-desktop' })
    b.assets = b.assets.map((a, i) => (i === 1 ? { ...a, task_template_id: '0e1a0000-0000-4000-8000-00000000e002' } : i === 2 ? { ...a, task_template_id: TASK_TEMPLATES[0].id } : a))
    serveM3([b], { stores })
    // Another workspace's template, hidden from this one's reads; an asset already linked by a teammate.
    fake.state.lists.task_templates = [{ id: '0e1a0000-0000-4000-8000-00000000e002', workspace_id: 'ws-other', project_id: null, name: 'Theirs' }]
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.errors).toEqual([])
    expect(report.taskTemplates).toMatchObject({ inserted: 2, orphans: 1 })
    expect(lines).toContain(`  ${TEMPLATES_ORPHAN(1)}`)
    expect(fake.state.updates.filter(u => u.table === 'assets').map(u => u.patch.task_template_id)).toEqual([TASK_TEMPLATES[0].id])
    expect(fake.state.lists.assets.find(a => a.id === ASSETS[1].id).task_template_id ?? null).toBeNull()
    expect(report.notCarried).toContainEqual({ key: 'assetTemplates', label: "asset's task template not in the cloud", count: 1, later: true })
    // CONTROL: the key takes another workspace's template (measured), so only the runner's set stands in the way.
    const update = await fake.client.from('assets').update({ task_template_id: '0e1a0000-0000-4000-8000-00000000e002' }).eq('id', ASSETS[1].id).eq('project_id', PROJECT.id).select('id')
    expect(update.error).toBeNull()
    expect(update.data).toHaveLength(1)
    // A pinned template whose project failed waits.
    newCloud({ inserts: {}, lists: {}, log: [], objects: [] })
    serveM3([desktopFixtures()])
    fake.state.failWith = (table) => (table === 'projects' ? { code: '08006', message: 'connection failure' } : null)
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(byId('task_templates', TASK_TEMPLATES[0].id)).toBeTruthy()
    expect(byId('task_templates', TASK_TEMPLATES[1].id)).toBeUndefined()
    expect(again.errors.find(e => e.scope === 'task_template')?.message).toMatch(/its project is not in the cloud, so the template was not carried \(a second run brings both\)/)
  })
})

describe('M3: the archive keeps its promise (electron/main.cjs, archiveLocalRabbitData)', () => {
  it('archives the projects, the thumbnails, the three workspace stores and the workspace records into one file, then clears them all', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const os = await import('node:os')
    // eslint-disable-next-line no-new-func
    const archive = new Function(`${liftFunction(MAIN_CJS, 'archiveLocalRabbitData')}\nreturn archiveLocalRabbitData`)()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rabbit-archive-'))
    const write = (rel, data) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data)) }
    write('projects/p1/project.json', { project: { id: 'p1', title: 'One' } })
    write('thumbnails/asset-x.jpg', 'not json')
    write('rate-cards/rc1.json', { card: { id: 'rc1', name: 'General' }, entries: [{ id: 'e1' }], dept_defaults: [{ department: 'Post' }] })
    write('team-members/m1.json', { id: 'm1', name: 'Mara' })
    write('task-templates/t1.json', { id: 't1', name: 'Build' })
    write('cloud-migration/ws1.json', { cloudMigration: { ws1: { carried: { rate_cards: ['rc1'] } } } })
    const out = archive(dir, fs, path)
    expect(out.ok).toBe(true)
    expect(out.projectCount).toBe(1)
    expect(out.storeCounts).toEqual({ 'rate-cards': 1, 'team-members': 1, 'task-templates': 1, 'cloud-migration': 1 })
    const snapshot = JSON.parse(fs.readFileSync(out.archivePath, 'utf-8'))
    expect(snapshot.projects).toEqual([{ project: { id: 'p1', title: 'One' } }])
    expect(snapshot.workspace['rate-cards']).toEqual([{ card: { id: 'rc1', name: 'General' }, entries: [{ id: 'e1' }], dept_defaults: [{ department: 'Post' }] }])
    expect(snapshot.workspace['team-members']).toEqual([{ id: 'm1', name: 'Mara' }])
    expect(snapshot.workspace['task-templates']).toEqual([{ id: 't1', name: 'Build' }])
    expect(snapshot.workspace['cloud-migration']).toEqual([{ cloudMigration: { ws1: { carried: { rate_cards: ['rc1'] } } } }])
    // CONTROL: every store is cleared with the projects (the function before M3 left the three stores and would have left the records).
    for (const rel of ['projects', 'thumbnails', 'rate-cards', 'team-members', 'task-templates', 'cloud-migration']) expect(fs.existsSync(path.join(dir, rel)), rel).toBe(false)
    expect(fs.existsSync(path.join(dir, 'archives'))).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})


// =============================================================================
// D2 (night 6 of docs/sessions/PLAN_TO_1_0.md, 2026-10-29;
// RECONNECT_DESIGN.md §13.4): her ruling on walkthrough 85's M2 Q3 — the
// report names the actuals that arrive in the cloud without the invoice
// attached by a path on this computer, as the budget names them (its line /
// its period), so she can attach each again in the browser. Never the
// invoice's path or its file's name: a file's name is content. Measured on the
// tip 4728a92d: the report counted the invoice and named nothing.
// =============================================================================

const { actualAsTheBudgetShowsIt, INVOICES_LEFT_BEHIND } = await import('./runMigration')
const { periodLabel } = await import('../../tools/rabbit_v0.1.0/views/budget/periodLabel')

const BS = String.fromCharCode(92)
// Names found nowhere else in the fixtures (their files carry an INV-0042_set_timber.pdf of their own, a gated file the migration carries).
const INVOICE_PATH = ['C:', 'Invoices', 'd2-timber-invoice-kept-here.pdf'].join(BS)
const INVOICE_NAME = 'd2-timber-invoice-kept-here.pdf'
const CREW_PATH = ['D:', 'Paperwork', 'jonah-week-one-invoice.pdf'].join(BS)
const CREW_NAME = 'jonah-week-one-invoice.pdf'
/** The desktop fixtures with two invoices on a path: the timber actual's (line 35, as the M2 round trip has it) and Jonah's crew actual's (line 12), each file named. */
const withCrewInvoice = () => {
  const b = desktopFixtures()
  b.budgetActuals = b.budgetActuals.map((a, i) => (i === 1 ? { ...a, attachment_path: INVOICE_PATH, attachment_name: INVOICE_NAME } : i === 2 ? { ...a, column_index: 1, attachment_path: CREW_PATH, attachment_name: CREW_NAME } : a))
  return b
}
const headerOf = (index) => periodLabel(index, PROJECT.budget_actual_column_mode || 'fortnightly', PROJECT.start_date || PROJECT.created_at)

describe('D2: actualAsTheBudgetShowsIt — an actual as its popover is titled', () => {
  const project = { budget_actual_column_mode: 'weekly', start_date: '2026-10-05' }
  const names = { 'desk-mara': 'Mara Okonkwo' }
  const nameOf = (id) => names[id] ?? null

  it('Crew/team: the team member\'s name, as the row shows it; without a name, the line\'s label', () => {
    const line = { sheet: 'crew', team_member_id: 'desk-mara', label: 'Producer', department: 'Production' }
    expect(actualAsTheBudgetShowsIt({ column_index: 2 }, line, project, nameOf)).toBe('Mara Okonkwo / Wk3 10/19')
    expect(actualAsTheBudgetShowsIt({ column_index: 2 }, { ...line, team_member_id: 'desk-nobody' }, project, nameOf)).toBe('Producer / Wk3 10/19')
  })

  it('Talent and any other sheet: the line\'s label, else its department, else "a budget line"', () => {
    expect(actualAsTheBudgetShowsIt({ column_index: 0 }, { sheet: 'talent', label: 'Talent 1', team_member_id: 'desk-mara' }, project, nameOf)).toBe('Talent 1 / Wk1 10/05')
    expect(actualAsTheBudgetShowsIt({ column_index: 0 }, { sheet: 'expenses_travel', label: '', department: 'Kit' }, project, nameOf)).toBe('Kit / Wk1 10/05')
    expect(actualAsTheBudgetShowsIt({ column_index: 0 }, undefined, project, nameOf)).toBe('a budget line / Wk1 10/05')
  })

  it('the period as the tabs print it: fortnightly by default, a count, a column that is not a whole number read as the first', () => {
    const line = { sheet: 'talent', label: 'Talent 1' }
    expect(actualAsTheBudgetShowsIt({ column_index: 1 }, line, { start_date: '2026-10-05' })).toBe('Talent 1 / P2 10/19')
    expect(actualAsTheBudgetShowsIt({ column_index: 3 }, line, { budget_actual_column_mode: 'count', start_date: '2026-10-05' })).toBe('Talent 1 / #4')
    for (const column_index of [-1, 1.5, 'x', null]) expect(actualAsTheBudgetShowsIt({ column_index }, line, project), String(column_index)).toBe('Talent 1 / Wk1 10/05')
  })

  it('the sentence, one and many', () => {
    expect(INVOICES_LEFT_BEHIND(1)).toBe('1 actual arrives in the cloud without its invoice (attached by a path on this computer, which the migration does not carry): attach it again in the browser, on the project\'s Budget')
    expect(INVOICES_LEFT_BEHIND(2)).toBe('2 actuals arrive in the cloud without their invoices (attached by a path on this computer, which the migration does not carry): attach them again in the browser, on the project\'s Budget')
  })
})

describe('D2: the report names the actuals that arrive without their invoice', () => {
  it('the dry run and the real run name the same actuals, by line and period, with the tab; the count is unchanged', async () => {
    const dryLines = []
    serveM3([withCrewInvoice()])
    const dry = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, dryRun: true, onProgress: (m) => dryLines.push(m) })
    const want = [
      { projectId: PROJECT.id, id: BUDGET_ACTUALS[1].id, project: 'Salt Hours', tab: null, actual: `Set timber and paint / ${headerOf(0)}` },
      { projectId: PROJECT.id, id: BUDGET_ACTUALS[2].id, project: 'Salt Hours', tab: 'Crew/team', actual: `${nameOf('jonah')} / ${headerOf(1)}` },
    ]
    expect(dry.invoicesLeftBehind).toEqual(want)
    expect(dry.notCarried).toContainEqual({ key: 'invoicePaths', label: 'invoices attached by a path on this computer', count: 2, later: false })
    serveM3([withCrewInvoice()])
    const real = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(real.invoicesLeftBehind).toEqual(want)
    expect(byId('budget_actuals', BUDGET_ACTUALS[1].id)).toMatchObject({ attachment_path: null, attachment_name: null })
    expect(byId('budget_actuals', BUDGET_ACTUALS[2].id)).toMatchObject({ attachment_path: null, attachment_name: null })
  })

  it('never the invoice\'s path or its file\'s name: not in the report, the progress lines, the record or any request the run made', async () => {
    serveM3([withCrewInvoice()])
    const lines = []
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS, onProgress: (m) => lines.push(m) })
    expect(report.invoicesLeftBehind).toHaveLength(2)
    const sent = [
      JSON.stringify(report), lines.join('\n'), JSON.stringify(recordWrites),
      JSON.stringify(fake.state.inserts), JSON.stringify(fake.state.updates), JSON.stringify(fake.state.rpcs),
      JSON.stringify(globalThis.fetch.mock.calls),
    ]
    // Build review round 1, F4: JSON doubles a backslash, so each path is also
    // searched in the form JSON writes it.
    const escaped = (p) => JSON.stringify(p).slice(1, -1)
    expect(escaped(INVOICE_PATH)).not.toBe(INVOICE_PATH)
    for (const needle of [INVOICE_PATH, escaped(INVOICE_PATH), INVOICE_NAME, CREW_PATH, escaped(CREW_PATH), CREW_NAME, 'Invoices' + BS, 'Paperwork', 'timber-invoice', 'week-one-invoice']) {
      for (const [i, hay] of sent.entries()) expect(hay.includes(needle), `${needle} in #${i}`).toBe(false)
    }
  })

  it('a second run names an actual still without its invoice, and not one she attached again in the browser', async () => {
    const b = withCrewInvoice()
    serveM3([b])
    await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    // In the browser, the crew actual's invoice attached again (a files row of the project).
    const row = (fake.state.lists.budget_actuals || []).find(r => r.id === BUDGET_ACTUALS[2].id)
    row.attachment_path = 'file:0e1a0000-0000-4000-8000-00000000f042'
    row.attachment_name = 'attached in the browser'
    const again = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(again.invoicesLeftBehind.map(x => x.id)).toEqual([BUDGET_ACTUALS[1].id])
    expect(again.budgetActuals.inserted).toBe(0)
  })

  it('an actual not carried is not named: its line removed on this computer, or its place held by another row', async () => {
    const b = withCrewInvoice()
    b.budgetLines = b.budgetLines.filter(l => l.id !== BUDGET_ACTUALS[2].line_id)          // the crew line removed here
    serveM3([b])
    // the timber actual's place (its line and period) holds another row in the cloud
    fake.state.lists.budget_actuals = [{ id: '0e1a0000-0000-4000-8000-00000000ac01', project_id: PROJECT.id, line_id: BUDGET_ACTUALS[1].line_id, column_index: BUDGET_ACTUALS[1].column_index, value: 1 }]
    fake.state.failWith = (table, row) => (table === 'budget_actuals' && row.id === BUDGET_ACTUALS[1].id ? { code: '23505', message: 'duplicate key value violates unique constraint "budget_actuals_line_column_uniq"' } : null)
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.budgetActuals.taken).toBe(1)
    expect(report.budgetActuals.orphans).toBeGreaterThanOrEqual(1)
    expect(report.invoicesLeftBehind).toEqual([])
    expect(report.notCarried).toContainEqual({ key: 'invoicePaths', label: 'invoices attached by a path on this computer', count: 2, later: false })
  })

  it('a project whose budget stays on this computer names nothing (its actuals do not arrive)', async () => {
    serveM3([withCrewInvoice()])
    fake.state.moneyGate = false
    const report = await runMigration({ workspaceId: WS, locations: SALT_LOCATIONS })
    expect(report.invoicesLeftBehind).toEqual([])
  })
})
