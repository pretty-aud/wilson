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
