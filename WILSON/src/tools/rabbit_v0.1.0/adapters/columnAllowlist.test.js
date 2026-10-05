// =============================================================================
// columnAllowlist.test.js — Session 25.
//
// The allowlist is the piece of the adapter with NO other visible symptom. A
// missing entry does not fail a build, a type check, a lint or a render: it
// rejects one PostgREST request at runtime with PGRST204 and the save appears
// to do nothing at all. That is exactly how R.A.B.B.I.T. item creation was
// broken for an unknown length of time before S23 — the app's primary action,
// dead, with no error anywhere on screen.
//
// S23's own close-out recorded the gap that let it ship: "there is no
// automated coverage of item creation at any layer — no vitest, no pgTAP.
// That is why a total failure of the app's primary action shipped unnoticed."
// This file and pgTAP suites 48-51 are that coverage.
//
// Unlike projectAttachments.test.js, this does NOT mirror the adapter's logic
// — it imports the real COLUMN_ALLOWLIST and the real toColumns. A mirrored
// copy would keep passing while the adapter regressed, which that file names
// as its own honest limitation. The Supabase client module is stubbed because
// supabaseAdapter imports it at module scope; nothing here touches a client.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({ supabase: null }))

const { toColumns, COLUMN_ALLOWLIST, DEPENDENCY_TABLE, dependencyKind } =
  await import('./supabaseAdapter')

let warn
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })


// ── The trap this file exists for ───────────────────────────────────────────

describe('every client-written table has an allowlist entry', () => {
  // 🚨 toColumns returns the object UNFILTERED when a table has no entry.
  // That is the failure mode, not a missing column: one invented key then
  // reaches PostgREST and takes the WHOLE request with it. Any table the
  // client writes to must appear here.
  it('covers the four entity tables added in 0040', () => {
    for (const t of ['scenes', 'shots', 'levels', 'experiences']) {
      expect(COLUMN_ALLOWLIST[t], `${t} has no COLUMN_ALLOWLIST entry`).toBeDefined()
    }
  })

  it('covers files, which S27 put in front of the user in three new places', () => {
    // `files` had no entry until S27. That was survivable only because the one
    // writer built its row literally; the Resources folder view, the entity
    // FileManagers and the ProjectsPage drop zone all patch file rows now.
    expect(COLUMN_ALLOWLIST.files, 'files has no COLUMN_ALLOWLIST entry').toBeDefined()
  })

  it('covers task_templates, added in 0044', () => {
    expect(COLUMN_ALLOWLIST.task_templates,
      'task_templates has no COLUMN_ALLOWLIST entry').toBeDefined()
  })

  it('covers milestones, added in 0067', () => {
    // Until 0067 the two milestone methods threw outright, so there was
    // nothing to allowlist. Now TimelineView's editor writes them on both
    // backends and RabbitProvider.updateMilestone re-sends the WHOLE row, so
    // a missing entry here would PGRST204 every key-date edit in cloud with
    // no error on screen — the S23 shape exactly.
    expect(COLUMN_ALLOWLIST.milestones,
      'milestones has no COLUMN_ALLOWLIST entry').toBeDefined()
  })

  // ── Track C, bundle C3 (migration 0075) ───────────────────────────────────
  it('files carries document_kind and description — 0075, §6 #31 trap (a)', () => {
    // 🚨 THE FAILURE THIS PINS IS SILENT IN BOTH DIRECTIONS. ProjectFilesTable's
    // Kind select and Description cell have written these two on every gesture
    // since S27; `files` had neither column, so toColumns stripped them and the
    // PATCH became a 200 no-op that the optimistic setState hid until the next
    // listFiles(). 0075 adds the columns; without these two names the write is
    // still dropped, and with the names but no columns every PATCH carrying
    // one dies as PGRST204. The migration and the allowlist are ONE change,
    // and this is the half a test can hold.
    expect(COLUMN_ALLOWLIST.files.has('document_kind'),
      'files allowlist is missing document_kind (0075)').toBe(true)
    expect(COLUMN_ALLOWLIST.files.has('description'),
      'files allowlist is missing description (0075)').toBe(true)
    expect(toColumns('files', { id: 'x', document_kind: 'brief', description: 'note' }))
      .toEqual({ id: 'x', document_kind: 'brief', description: 'note' })
  })

  // ── Post-overhaul S4a (migration 0085) ────────────────────────────────────
  it('files carries tags — 0085, the nine tags (Audrey\'s E3)', () => {
    // The same silent failure as 0075's two columns, a third time: the file
    // window's tag chips write `tags`, and without this name toColumns strips
    // it and the PATCH is a 200 no-op the optimistic update hides.
    expect(COLUMN_ALLOWLIST.files.has('tags'), 'files allowlist is missing tags (0085)').toBe(true)
    expect(toColumns('files', { id: 'x', tags: ['shots', 'legal'] })).toEqual({ id: 'x', tags: ['shots', 'legal'] })
    expect(toColumns('files', { id: 'x', tags: [] })).toEqual({ id: 'x', tags: [] })
    // CONTROL, against the REAL toColumns: plant the fault (the name taken
    // out of the real Set), watch the tags drop, put it back.
    COLUMN_ALLOWLIST.files.delete('tags')
    try {
      expect(toColumns('files', { id: 'x', tags: ['shots'] })).toEqual({ id: 'x' })
    } finally {
      COLUMN_ALLOWLIST.files.add('tags')
    }
    expect(COLUMN_ALLOWLIST.files.has('tags')).toBe(true)
  })

  it('files still carries is_core_definer — the §6 #31 (b) polarity flag', () => {
    // The flag D.O.G.'s CORE/REF split reads. If it ever left the allowlist,
    // the Core checkbox would go quiet exactly as document_kind did.
    expect(COLUMN_ALLOWLIST.files.has('is_core_definer')).toBe(true)
    expect(toColumns('files', { is_core_definer: true })).toEqual({ is_core_definer: true })
  })

  it('covers both dependency tables — the last two writers on the raw denylist', () => {
    // upsertDependency called sanitize(dep, []) — a denylist with an EMPTY drop
    // list — right through S23, S24 and S27, which added entries for every
    // other table. This is the entry that closes that class out.
    for (const t of ['task_dependencies', 'phase_dependencies']) {
      expect(COLUMN_ALLOWLIST[t], `${t} has no COLUMN_ALLOWLIST entry`).toBeDefined()
    }
  })

  it('a table with no entry passes everything through — the hazard, pinned', () => {
    // Documents WHY the check above matters. If this ever stops being true,
    // the reasoning in the adapter's comments needs revisiting.
    expect(toColumns('not_a_table', { anything: 1 })).toEqual({ anything: 1 })
  })
})


// ── The payloads the UI actually sends ──────────────────────────────────────

describe('scenes — the create payload from ScenesView', () => {
  // ScenesView.jsx:371-376 + RabbitProvider.jsx:1309-1314.
  const payload = {
    id: 's1', project_id: 'p1', sort_order: 0,
    name: 'WLSN_SC001', scene_number: 1, status: 'not_started', type: 'interior',
  }

  it('keeps every field the create sends', () => {
    expect(toColumns('scenes', payload)).toEqual(payload)
  })

  it('keeps the detail popup edit fields', () => {
    const edits = {
      description: 'a', notes: 'b', time_of_day: 'day',
      thumbnail_image: '/x.png', start_date: '2026-01-01', end_date: '2026-01-02',
    }
    expect(toColumns('scenes', edits)).toEqual(edits)
  })
})

describe('shots — the create payload from ScenesView', () => {
  const payload = {
    id: 'h1', project_id: 'p1', sort_order: 0, scene_id: 's1',
    name: 'WLSN_SC001_SH0001', shot_number: 1,
    status: 'not_started', type: 'other', frame_count: 0,
  }

  it('keeps every field the create sends', () => {
    expect(toColumns('shots', payload)).toEqual(payload)
  })

  it('keeps the shot-only fields the scene table has no use for', () => {
    const edits = { framing: 'CU', camera_movement: 'PAN', frame_count: 240 }
    expect(toColumns('shots', edits)).toEqual(edits)
  })

  it('keeps a NULL scene_id rather than dropping the key', () => {
    // Dropping the KEY and sending null are different writes: the first
    // leaves an existing parent in place, the second unlinks the shot. The
    // UI relies on the second (unlinked shots are a real state).
    expect(toColumns('shots', { id: 'h1', scene_id: null }))
      .toEqual({ id: 'h1', scene_id: null })
  })
})

describe('levels and experiences — the `files` key that has no column', () => {
  // 🚨 THE REGRESSION THIS FILE IS REALLY FOR.
  // CreateEntityPopup sends { name, status, description, files } — an array of
  // picked files (EntityListView.jsx:1154-1159). `files` is not a column and will
  // not be one until S26 gives these entities folders. Without an allowlist
  // entry that single key PGRST204s the entire insert, and the New Level
  // button does nothing with no error, exactly like S23's New Task.
  const payload = {
    id: 'l1', project_id: 'p1', sort_order: 0,
    name: 'Level 1', status: 'not_started', description: '',
    files: [{ name: 'a.uasset', path: '/tmp/a.uasset' }],
  }

  it('drops `files` and keeps the rest, for levels', () => {
    const out = toColumns('levels', payload)
    expect(out).not.toHaveProperty('files')
    expect(out).toEqual({
      id: 'l1', project_id: 'p1', sort_order: 0,
      name: 'Level 1', status: 'not_started', description: '',
    })
  })

  it('drops `files` and keeps the rest, for experiences', () => {
    const out = toColumns('experiences', { ...payload, id: 'e1', name: 'Experience 1' })
    expect(out).not.toHaveProperty('files')
    expect(out.name).toBe('Experience 1')
  })

  it('WARNS about the dropped key rather than dropping it silently', () => {
    // The warning is the mechanism by which a genuinely missing column gets
    // noticed. A field a user can edit that shows up here needs a column, not
    // a bigger allowlist — the adapter says so in the message itself.
    toColumns('levels', payload)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('files')
    expect(warn.mock.calls[0][0]).toContain('public.levels')
  })

  it('does not warn when every key is a real column', () => {
    toColumns('levels', { id: 'l1', name: 'Level 1' })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('files — the local managedFiles field names that have no columns', () => {
  // 🚨 S27 makes FileManager serve BOTH stores. The local_server managedFiles
  // records are loose JSON with fields that were never columns here, and
  // shared code paths will hand them straight to updateFile. One of them would
  // PGRST204 the whole patch and the notes edit would silently do nothing —
  // the S23 New Task failure, on a different surface.
  it('keeps the 0043 links and drops the local-only field names', () => {
    const out = toColumns('files', {
      id: 'f1', project_id: 'p1',
      scene_id: 's1', shot_id: null, level_id: null,
      experience_id: null, folder_id: 'fo1',
      is_core_definer: true,
      // local managedFiles shape — none of these is a column
      stored_name: 'hero_v001.png', version_label: 'v001',
      extension: '.png', original_name: 'hero.png', notes: 'a note',
    })
    expect(out).toEqual({
      id: 'f1', project_id: 'p1',
      scene_id: 's1', shot_id: null, level_id: null,
      experience_id: null, folder_id: 'fo1',
      is_core_definer: true,
    })
  })

  it('keeps a NULL entity link rather than dropping the key', () => {
    // Dropping the KEY leaves the old link in place; sending null unlinks.
    // Moving a file out of a scene relies on the second.
    expect(toColumns('files', { id: 'f1', scene_id: null, folder_id: null }))
      .toEqual({ id: 'f1', scene_id: null, folder_id: null })
  })
})

describe('task_templates — the payloads useTaskTemplates sends (Session 28)', () => {
  // useTaskTemplates.addTemplate builds this literal.
  const created = {
    id: 't1', workspace_id: 'w1', project_id: null,
    name: 'New Template', description: '',
    tasks: [{
      id: 'tt1', name: 'Model', role_slug: 'modeler',
      bid_days: 3, sort_order: 0, depends_on: ['tt0'],
    }],
  }

  it('keeps every field the create sends', () => {
    expect(toColumns('task_templates', created)).toEqual(created)
    expect(warn).not.toHaveBeenCalled()
  })

  it('does NOT reach inside the tasks array', () => {
    // 🚨 The template's own task objects live INSIDE the jsonb value, so
    // toColumns never sees their keys. `role_slug` here is legitimate and must
    // survive untouched — it is a key in a JSON document, not a column. This
    // is the exact pair that made the ProjectAssetsView bug confusing: the
    // template field really IS called role_slug; the TASK column is not.
    const out = toColumns('task_templates', created)
    expect(out.tasks[0].role_slug).toBe('modeler')
    expect(out.tasks[0].depends_on).toEqual(['tt0'])
  })

  it('keeps a NULL project_id rather than dropping the key', () => {
    // Dropping the KEY leaves the pin in place; sending null makes the
    // template global. TemplateScope's checkbox relies on the second — and
    // 0044's UPDATE policy is what refuses it for a project manager.
    expect(toColumns('task_templates', { id: 't1', project_id: null }))
      .toEqual({ id: 't1', project_id: null })
  })

  it('drops a stray key and warns', () => {
    const out = toColumns('task_templates', { id: 't1', name: 'x', taskCount: 4 })
    expect(out).toEqual({ id: 't1', name: 'x' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('public.task_templates')
  })
})

describe('tasks — the template branch wrote a key that is not a column', () => {
  // 🚨 THE S28 REGRESSION, PINNED. ProjectAssetsView applied a template by
  // sending `role_slug`, but TASK_COLUMNS has `assigned_role_slug`. Because
  // `tasks` HAS an allowlist entry, toColumns dropped the key with a warning
  // instead of rejecting the request — so the tasks were created successfully
  // with NO ROLE, and every bid built from them priced at nothing. Quieter
  // than an un-allowlisted table, and far harder to notice.
  it('drops role_slug and keeps assigned_role_slug', () => {
    const out = toColumns('tasks', {
      title: 'Model', asset_id: 'a1', bid_days: 3,
      assigned_role_slug: 'modeler', role_slug: 'modeler',
    })
    expect(out).toHaveProperty('assigned_role_slug', 'modeler')
    expect(out).not.toHaveProperty('role_slug')
  })

  it('the corrected template payload passes clean', () => {
    const out = toColumns('tasks', {
      title: 'Model', asset_id: 'a1', phase_id: null,
      status: 'waiting_to_start', priority: 'medium',
      bid_days: 3, assigned_role_slug: 'modeler',
      start_date: '2026-01-01', end_date: '2026-01-03',
    })
    expect(warn).not.toHaveBeenCalled()
    expect(out.assigned_role_slug).toBe('modeler')
  })
})

describe('assets — task_template_id arrives with its feature (0044)', () => {
  // S23 kept this out on the stated rule that "a column for a feature with no
  // cloud implementation is schema debt", and 0041 applied the same rule to
  // files_dir. The rule was "it arrives WITH the feature" — 0044 is that
  // arrival, and both writers become reachable in the same commit.
  it('keeps task_template_id on the create and the patch', () => {
    expect(toColumns('assets', { id: 'a1', name: 'Hero', task_template_id: 't1' }))
      .toEqual({ id: 'a1', name: 'Hero', task_template_id: 't1' })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('the whole-row re-send on update', () => {
  // RabbitProvider.jsx:1333 upserts `{ ...existingRow, ...patch, id }`, so
  // the payload carries whatever the row already held — including server-
  // managed columns read back from the last insert.
  it('lets the server-managed audit columns through to the upsert', () => {
    // These ARE real columns, so they belong in the allowlist; the upsert is
    // a full-row write and Postgres will simply overwrite them. What must NOT
    // happen is the request being rejected because they were unexpected.
    const row = {
      id: 's1', project_id: 'p1', workspace_id: 'w1', name: 'WLSN_SC001',
      created_at: '2026-08-04T00:00:00Z', updated_at: '2026-08-04T00:00:00Z',
      created_by: 'u1', updated_by: 'u1',
    }
    expect(toColumns('scenes', row)).toEqual(row)
    expect(warn).not.toHaveBeenCalled()
  })
})


// ── Dependencies — Phase 2 of the 2026-08-10 build pass, migration 0061 ─────

describe('dependencies — the exact rows linkTasks and linkPhases build', () => {
  // 🚨 THE DEFECT THIS PHASE EXISTS FOR, pinned as the EXECUTABLE payload
  // rather than as a description of it. Audrey, 2026-08-10: "i was able to
  // grab the line from the dependency task but i could not attach it to
  // another this is crucial to work."
  //
  // RabbitProvider.linkTasks/linkPhases build this literal. `kind` and
  // `project_id` are not columns on either table, so before 0061 the whole
  // request was rejected with PGRST204 and TimelineView swallowed it.
  const linkRow = (kind) => ({
    id: 'd1',
    predecessor_id: 'x1',
    successor_id: 'x2',
    kind,
    type: 'FS',
    lag_days: 0,
    project_id: 'p1',
  })

  it('drops kind and project_id, keeps everything the table actually has', () => {
    const out = toColumns('task_dependencies', linkRow('task'))
    expect(out).not.toHaveProperty('kind')
    expect(out).not.toHaveProperty('project_id')
    expect(out).toEqual({
      id: 'd1', predecessor_id: 'x1', successor_id: 'x2', type: 'FS', lag_days: 0,
    })
  })

  it('treats the phase table identically — 0061 gave it the same column shape', () => {
    const out = toColumns('phase_dependencies', linkRow('phase'))
    expect(out).toEqual({
      id: 'd1', predecessor_id: 'x1', successor_id: 'x2', type: 'FS', lag_days: 0,
    })
  })

  it('keeps lag_days: 0 rather than dropping the key', () => {
    // A falsy value is still a value. Dropping the key would leave a previous
    // lag in place on an upsert that was meant to clear it.
    expect(toColumns('task_dependencies', { id: 'd1', lag_days: 0 }))
      .toEqual({ id: 'd1', lag_days: 0 })
  })

  it('drops the loader\'s `predecessor` embed — the undo-after-reload bug', () => {
    // 🚨 THE THIRD NON-COLUMN, and the one a fix aimed only at kind/project_id
    // would have missed. loadProject selects
    //   '*, predecessor:tasks!..._fkey!inner(project_id)'
    // so EVERY row in the bundle carries a `predecessor` object. Undo-of-unlink
    // re-sends the loaded row verbatim via upsertDependency(oldRow), so undo
    // stayed broken for any dependency the user had not created in that same
    // session — the failure would look intermittent and depend on whether the
    // page had been reloaded.
    const loaded = {
      id: 'd1', predecessor_id: 'x1', successor_id: 'x2', type: 'FS', lag_days: 2,
      predecessor: { project_id: 'p1' },
      kind: 'task',
    }
    const out = toColumns('task_dependencies', loaded)
    expect(out).not.toHaveProperty('predecessor')
    expect(out).toEqual({
      id: 'd1', predecessor_id: 'x1', successor_id: 'x2', type: 'FS', lag_days: 2,
    })
  })

  it('warns about the dropped keys instead of dropping them silently', () => {
    toColumns('task_dependencies', linkRow('task'))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('public.task_dependencies')
    expect(warn.mock.calls[0][0]).toContain('kind')
    expect(warn.mock.calls[0][0]).toContain('project_id')
  })
})

describe('dependency routing — which table an edge lives in (0061)', () => {
  it('routes by kind, and anything not "phase" is a task edge', () => {
    // Matches DetailPane's `const kind = d.kind || 'task'` exactly. A row
    // written before 0061 has no kind at all and must route to the task table.
    expect(dependencyKind({ kind: 'phase' })).toBe('phase')
    expect(dependencyKind({ kind: 'task' })).toBe('task')
    expect(dependencyKind({})).toBe('task')
    expect(dependencyKind(undefined)).toBe('task')
    expect(dependencyKind({ kind: 'nonsense' })).toBe('task')
  })

  it('maps each kind to its real table name', () => {
    // The executable mapping, not a restatement of it: a typo here is a
    // PGRST205 at runtime and nothing else would catch it.
    expect(DEPENDENCY_TABLE[dependencyKind({ kind: 'task' })]).toBe('task_dependencies')
    expect(DEPENDENCY_TABLE[dependencyKind({ kind: 'phase' })]).toBe('phase_dependencies')
  })

  it('every routed table has an allowlist entry', () => {
    // Ties the two halves together: routing to a table with no entry would
    // reopen the exact hole this phase closed.
    for (const table of Object.values(DEPENDENCY_TABLE)) {
      expect(COLUMN_ALLOWLIST[table], `${table} is routed to but has no allowlist`).toBeDefined()
    }
  })
})


// ── The projects drift ──────────────────────────────────────────────────────

describe('projects — the Control Panel fields 0040 added', () => {
  it('accepts every field the panel writes', () => {
    // Each of these was silently dropped before 0040: the panel appeared to
    // save and discarded the value.
    const panel = {
      project_code: 'WLSN', scene_separator: '-', scene_digits: 2,
      shot_digits: 3, scene_start_number: 10, fps: 29.97,
      scenes_enabled: true, levels_enabled: true, experiences_enabled: true,
      uses_realtime_engine: true, engine_type: 'unreal_engine',
      engine_proprietary_name: null, engine_version: '5.67',
      engine_project_name: 'MyProject', engine_repo_url: 'https://x/y',
      project_type: 'video_game', project_tier: 'large',
    }
    expect(toColumns('projects', panel)).toEqual(panel)
    expect(warn).not.toHaveBeenCalled()
  })

  it('still drops `code` and `name`, which have never been columns', () => {
    // ClientViewTab read both until S25. They are wrong READS, not missing
    // columns — nothing in the app has ever written either one. If someone
    // "closes the documented gap" by adding a `code` column, this fails and
    // points at the pgTAP probe that explains why.
    const out = toColumns('projects', { title: 'Real', name: 'Wrong', code: 'Wrong' })
    expect(out).toEqual({ title: 'Real' })
  })
})


// ── Milestones (0067) ───────────────────────────────────────────────────────

describe('milestones — the editor payload from TimelineView', () => {
  // TimelineView's editor save, mode 'milestone', builds exactly this, and
  // RabbitProvider.addMilestone adds id + project_id.
  const payload = {
    id: 'm1', project_id: 'p1',
    title: 'Lock picture', date: '2026-10-01', color: '#f59e0b',
    description: 'the cut is frozen', phase_id: null,
  }

  it('keeps every field the editor sends', () => {
    expect(toColumns('milestones', payload)).toEqual(payload)
    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps a NULL phase_id rather than dropping the key', () => {
    // Dropping the KEY and sending null are different writes: the first
    // leaves an existing phase attached, the second detaches the milestone.
    // The editor relies on the second — `draft.phase_id || null` — and an
    // unparented key date is a real, displayed state (0067's S23 note).
    expect(toColumns('milestones', { id: 'm1', phase_id: null }))
      .toEqual({ id: 'm1', phase_id: null })
  })

  it('drops the trash columns — a client never writes them', () => {
    // deleted_at/deleted_by are written by soft_delete_row and the stamp
    // trigger, as definer. If a plain upsert could carry deleted_at, the write
    // would be refused by milestones_update (the NEW row would be invisible to
    // milestones_select) — a 42501 where the user pressed Save.
    const out = toColumns('milestones', {
      id: 'm1', title: 'Wrap', deleted_at: '2026-09-07T00:00:00Z', deleted_by: 'u1',
    })
    expect(out).toEqual({ id: 'm1', title: 'Wrap' })
    expect(warn).toHaveBeenCalled()
  })

  it('drops isProjectBound, the synthetic marker flag', () => {
    // TimelineView synthesizes project start/end markers with this flag and
    // refuses to open the editor on them, so it cannot reach a write today.
    // If a future affordance lets it, the key is dropped rather than taking
    // the whole request with it.
    expect(toColumns('milestones', { id: 'm1', isProjectBound: true }))
      .toEqual({ id: 'm1' })
  })
})


// ── Shot lists, items and edits (0084, post-overhaul S3a) ───────────────────
//
// Every test below is a PLANTED CONTROL: the payload goes in and must come out
// identical with no warning, so removing any one key from the allowlist turns
// it red (toColumns drops the key and warns). Each table also gets the
// opposite control — a key that is NOT a column is dropped and warned about —
// so the pair proves the entry filters rather than passing everything
// through (the hazard pinned at the top of this file).

// The S3a contract's row shapes, verbatim. The allowlists must be EXACTLY
// these: a missing column loses a write, and an extra one PGRST204s it.
const SHOT_LIST_ROW = {
  id: 'l1', project_id: 'p1', workspace_id: 'w1',
  title: 'Shot list 1', version: 1, summary: 'Created from existing scenes',
  snapshot: {}, archived_at: null, archived_by: null,
  created_at: '2026-09-30T00:00:00Z', created_by: 'u1',
  updated_at: '2026-09-30T00:00:00Z', updated_by: 'u1',
}
const SHOT_LIST_ITEM_ROW = {
  id: 'i1', shot_list_id: 'l1', project_id: 'p1', workspace_id: 'w1',
  scene_id: null, shot_id: 'h1', position: 0,
  created_at: '2026-09-30T00:00:00Z', created_by: 'u1',
  updated_at: '2026-09-30T00:00:00Z', updated_by: 'u1',
}
const EDIT_ROW = {
  id: 'e1', project_id: 'p1', workspace_id: 'w1', shot_list_id: 'l1',
  title: 'Assembly', version: 2, summary: 'first pass', parent_edit_id: 'e0',
  items: [{ id: 'ei1', scene_id: 's1', shot_id: 'h1', label: 'Wide', notes: 'hold' }],
  snapshot: null, archived_at: null, archived_by: null,
  created_at: '2026-09-30T00:00:00Z', created_by: 'u1',
  updated_at: '2026-09-30T00:00:00Z', updated_by: 'u1',
}

describe('the three 0084 tables have entries, and each is EXACTLY its row shape', () => {
  it('shot_lists, shot_list_items and edits are all in COLUMN_ALLOWLIST', () => {
    for (const t of ['shot_lists', 'shot_list_items', 'edits']) {
      expect(COLUMN_ALLOWLIST[t], `${t} has no COLUMN_ALLOWLIST entry`).toBeDefined()
    }
  })

  it('each entry equals the contract row, key for key', () => {
    const sorted = (x) => [...x].sort()
    expect(sorted(COLUMN_ALLOWLIST.shot_lists)).toEqual(sorted(Object.keys(SHOT_LIST_ROW)))
    expect(sorted(COLUMN_ALLOWLIST.shot_list_items)).toEqual(sorted(Object.keys(SHOT_LIST_ITEM_ROW)))
    expect(sorted(COLUMN_ALLOWLIST.edits)).toEqual(sorted(Object.keys(EDIT_ROW)))
  })
})

describe('shot_lists — the whole row the provider re-sends (0084)', () => {
  it('keeps every column, archived_at / archived_by included', () => {
    // The allowlist describes the TABLE, so all of the row survives here.
    // What an upsert SENDS is narrower: upsertShotList / upsertEdit strip the
    // four audit columns and archived_* BEFORE toColumns (S3a review round 1,
    // addendum F) — pinned by supabaseLoadProject.test.js, "send no audit or
    // archive column". Dropping them here instead would hide them from every
    // future writer of the table, not just from the upsert.
    expect(toColumns('shot_lists', SHOT_LIST_ROW)).toEqual(SHOT_LIST_ROW)
    expect(warn).not.toHaveBeenCalled()
  })

  it('drops the computed "Title · vN" label and warns', () => {
    const out = toColumns('shot_lists', { id: 'l1', title: 'Shot list 1', label: 'Shot list 1 · v1' })
    expect(out).toEqual({ id: 'l1', title: 'Shot list 1' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('public.shot_lists')
    expect(warn.mock.calls[0][0]).toContain('label')
  })
})

describe('shot_list_items — membership rows (0084)', () => {
  it('keeps every column, a NULL scene_id and position 0 included', () => {
    // Exactly one of scene_id / shot_id is set, so the other is a real NULL,
    // and position 0 is the first item — dropping either key is a different
    // write.
    expect(toColumns('shot_list_items', SHOT_LIST_ITEM_ROW)).toEqual(SHOT_LIST_ITEM_ROW)
    expect(warn).not.toHaveBeenCalled()
  })

  it('drops a stray key and warns', () => {
    const out = toColumns('shot_list_items', { id: 'i1', shot_id: 'h1', position: 3, kind: 'shot' })
    expect(out).toEqual({ id: 'i1', shot_id: 'h1', position: 3 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('public.shot_list_items')
  })
})

describe('edits — the saved edit (0084)', () => {
  it('keeps every column, the items array and a NULL parent / snapshot included', () => {
    expect(toColumns('edits', EDIT_ROW)).toEqual(EDIT_ROW)
    expect(toColumns('edits', { id: 'e1', parent_edit_id: null, snapshot: null }))
      .toEqual({ id: 'e1', parent_edit_id: null, snapshot: null })
    expect(warn).not.toHaveBeenCalled()
  })

  it('does NOT reach inside the items array', () => {
    // 🚨 items is ONE jsonb column (0084 §5, the task_templates precedent).
    // `label` and `notes` are keys of an edit ITEM, not columns — they must
    // survive untouched even though `label` is dropped from a shot_lists row.
    const out = toColumns('edits', EDIT_ROW)
    expect(out.items).toEqual([{ id: 'ei1', scene_id: 's1', shot_id: 'h1', label: 'Wide', notes: 'hold' }])
  })

  it('drops a stray key and warns', () => {
    const out = toColumns('edits', { id: 'e1', title: 'Assembly', draft: true })
    expect(out).toEqual({ id: 'e1', title: 'Assembly' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('public.edits')
  })
})

describe('the four lists 0084 widens', () => {
  it('tasks keeps scene_id / shot_id — the TimelineView payload', () => {
    // TimelineView.jsx:4355-4356 has sent both on every save since S23; they
    // were dropped with a warning until 0084 gave them columns.
    expect(COLUMN_ALLOWLIST.tasks.has('scene_id'), 'tasks allowlist is missing scene_id (0084)').toBe(true)
    expect(COLUMN_ALLOWLIST.tasks.has('shot_id'), 'tasks allowlist is missing shot_id (0084)').toBe(true)
    const payload = { id: 't1', project_id: 'p1', title: 'Grade SC1', scene_id: 's1', shot_id: 'h1' }
    expect(toColumns('tasks', payload)).toEqual(payload)
    // NULL is "not linked" — the key must survive so an unlink is written.
    expect(toColumns('tasks', { id: 't1', scene_id: null, shot_id: null }))
      .toEqual({ id: 't1', scene_id: null, shot_id: null })
    expect(warn).not.toHaveBeenCalled()
  })

  it('tasks still drops level_id / experience_id, which 0084 keeps local-only', () => {
    // The same editor sends these two; D9 names scene and shot only.
    const out = toColumns('tasks', { id: 't1', scene_id: 's1', level_id: 'lv1', experience_id: 'ex1' })
    expect(out).toEqual({ id: 't1', scene_id: 's1' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('public.tasks')
    expect(warn.mock.calls[0][0]).toContain('level_id')
  })

  it('assets keeps scene_ids / shot_ids — the relation pickers\' whole arrays', () => {
    // ProjectAssetsView.jsx:2026 / :2040 send `{ scene_ids: next }` and
    // `{ shot_ids: next }`; an EMPTY array is a real write (the last link
    // removed) and must not vanish.
    expect(COLUMN_ALLOWLIST.assets.has('scene_ids'), 'assets allowlist is missing scene_ids (0084)').toBe(true)
    expect(COLUMN_ALLOWLIST.assets.has('shot_ids'), 'assets allowlist is missing shot_ids (0084)').toBe(true)
    const payload = { id: 'a1', name: 'Hero', scene_ids: ['s1', 's2'], shot_ids: [] }
    expect(toColumns('assets', payload)).toEqual(payload)
    expect(warn).not.toHaveBeenCalled()
  })

  it('assets still drops level_ids, which has no column', () => {
    const out = toColumns('assets', { id: 'a1', shot_ids: ['h1'], level_ids: ['lv1'] })
    expect(out).toEqual({ id: 'a1', shot_ids: ['h1'] })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('public.assets')
    expect(warn.mock.calls[0][0]).toContain('level_ids')
  })

  it('budget_versions keeps shot_list_id and summary — the whole-row re-send', () => {
    // BudgetView spreads the whole row on every activate and rename, so both
    // ride along once a row carries them.
    expect(COLUMN_ALLOWLIST.budget_versions.has('shot_list_id'),
      'budget_versions allowlist is missing shot_list_id (0084)').toBe(true)
    expect(COLUMN_ALLOWLIST.budget_versions.has('summary'),
      'budget_versions allowlist is missing summary (0084)').toBe(true)
    const payload = {
      id: 'bv1', project_id: 'p1', name: 'Bid v2', type: 'bid', is_active: true,
      snapshot: { lines: [] }, shot_list_id: 'l1', summary: 'pickups priced',
    }
    expect(toColumns('budget_versions', payload)).toEqual(payload)
    expect(toColumns('budget_versions', { id: 'bv1', shot_list_id: null }))
      .toEqual({ id: 'bv1', shot_list_id: null })
    expect(warn).not.toHaveBeenCalled()
  })

  // Post-overhaul S5 loosened this: an UNDONE delete re-inserts the version
  // with its own created_at, so it keeps its place in the newest-first list
  // and stays the "version before" F8's automatic line names. A new version
  // sends none (the provider leaves it to the server's default).
  it('budget_versions keeps created_at (S5: an undone delete keeps its place) and still drops updated_at', () => {
    expect(toColumns('budget_versions', { id: 'bv1', summary: 's', created_at: '2026-09-30T00:00:00Z' }))
      .toEqual({ id: 'bv1', summary: 's', created_at: '2026-09-30T00:00:00Z' })
    expect(warn).not.toHaveBeenCalled()
    // CONTROL: the other server-managed stamp is still dropped, said aloud.
    const out = toColumns('budget_versions', { id: 'bv1', summary: 's', updated_at: '2026-09-30T00:00:00Z' })
    expect(out).toEqual({ id: 'bv1', summary: 's' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('public.budget_versions')
  })

  it('projects keeps active_shot_list_id — an UNCHANGED pointer must pass', () => {
    // 0084's guard refuses a CHANGE (only set_active_shot_list() may make
    // one) but must let a whole-row re-send with the same value through.
    expect(COLUMN_ALLOWLIST.projects.has('active_shot_list_id'),
      'projects allowlist is missing active_shot_list_id (0084)').toBe(true)
    expect(toColumns('projects', { title: 'Real', active_shot_list_id: 'l1' }))
      .toEqual({ title: 'Real', active_shot_list_id: 'l1' })
    expect(toColumns('projects', { active_shot_list_id: null }))
      .toEqual({ active_shot_list_id: null })
    expect(warn).not.toHaveBeenCalled()
  })

  it('projects still drops a camelCase stray of the same field', () => {
    const out = toColumns('projects', { title: 'Real', activeShotListId: 'l1' })
    expect(out).toEqual({ title: 'Real' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('public.projects')
  })
})
