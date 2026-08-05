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

const { toColumns, COLUMN_ALLOWLIST } = await import('./supabaseAdapter')

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
  // CreateLevelPopup sends { name, status, description, files } — an array of
  // picked files (LevelsView.jsx:1004-1009). `files` is not a column and will
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
