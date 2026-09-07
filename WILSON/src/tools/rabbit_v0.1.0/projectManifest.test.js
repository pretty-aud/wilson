// =============================================================================
// projectManifest.test.js — Session 26.
//
// The manifest is a file written into the project folder, and on Supabase
// that folder is readable by every project member — MEASURED against
// wilson-dev, storage policy `rabbit_files_select`. So the interesting
// assertions here are not about shape, they are about what must never end up
// in it.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  buildProjectManifest, serializeProjectManifest,
  MANIFEST_VERSION, MANIFEST_FILENAME,
} from './projectManifest'

const PROJECT = {
  id: 'p1',
  title: 'Hero Film 2026',
  project_code: 'HF26',
  folder_slug: 'Hero-Film-2026',
  budget_margin_pct: 15,
  budget_contingency_pct: 10,
  budget_total: 250000,
  scenes_enabled: true,
  fps: 23.98,
  // Audit plumbing — meaningless outside the database.
  workspace_id: 'w1',
  created_by: 'u1',
  updated_by: 'u1',
  deleted_at: null,
  deleted_by: null,
  last_updated_at: '2026-08-04T00:00:00Z',
  last_updated_by: 'u1',
}

const BUNDLE = {
  folders: [
    { kind: 'entity',   path: 'SCENES/Wlsn-Sc001', slug: 'Wlsn-Sc001', label: 'WLSN_SC001', entity_type: 'scene', id: 'f3', project_id: 'p1' },
    { kind: 'root',     path: '',        slug: 'Hero-Film-2026', label: 'Hero Film 2026', entity_type: null, id: 'f1' },
    { kind: 'category', path: 'SCENES',  slug: 'SCENES', label: null, entity_type: 'scene', id: 'f2' },
  ],
  teamAssignments: [
    { member_id: 'u1', project_role: 'manager', project_title: 'Producer' },
    { member_id: 'u2', project_role: 'member',  project_title: '' },
  ],
  assets: [{ id: 'a1' }], scenes: [{ id: 's1' }], shots: [],
  levels: [], experiences: [], phases: [{ id: 'ph1' }], tasks: [{ id: 't1' }, { id: 't2' }],
}


describe('🚨 what must never be in the manifest', () => {
  it('carries no per-member rate overrides, under any key', () => {
    // THE ONE THAT MATTERS. project_rate_overrides are gated by
    // can_access_project_money — manager-only. The manifest sits at
    // projects/<id>/PROJECT.json, which has no third path segment, so
    // rabbit_files_select's `upper(foldername[3]) IS DISTINCT FROM 'INVOICES'`
    // is TRUE and every project member can download it. Putting rates in here
    // hands a team member the exact figures RLS just denied them — the S24
    // invoice defect, in a new file.
    //
    // Passing them in explicitly is the point: the builder must ignore them
    // even when a caller hands them over.
    const manifest = buildProjectManifest(PROJECT, {
      ...BUNDLE,
      projectRateOverrides: [{ id: 'r1', member_id: 'u2', day_rate: 850, wage: 42 }],
    })
    const json = serializeProjectManifest(manifest)
    expect(json).not.toContain('day_rate')
    expect(json).not.toContain('850')
    expect(json).not.toContain('projectRateOverrides')
    expect(manifest.projectRateOverrides).toBeUndefined()
  })

  it('says out loud that rates are missing, so nobody assumes it is complete', () => {
    // A handoff file that silently omits something is worse than one that
    // omits it loudly: the reader believes they have everything.
    expect(buildProjectManifest(PROJECT, BUNDLE).omitted).toMatch(/rate overrides/i)
  })

  it('carries no budget lines, actuals or expenses', () => {
    // These are the `_DATABASES/` trap: main mirrored budget.json, tasks.json
    // and timeline.json into the project folder and created a second,
    // diverging datastore. The manifest is SETTINGS, never content.
    const manifest = buildProjectManifest(PROJECT, {
      ...BUNDLE,
      budgetLines:   [{ id: 'bl1', cost: 1234 }],
      budgetActuals: [{ id: 'ba1', value: 5678 }],
      expenses:      [{ id: 'ex1', actual_cost: 91011 }],
    })
    const json = serializeProjectManifest(manifest)
    for (const leak of ['budgetLines', 'budgetActuals', 'expenses', '1234', '5678', '91011']) {
      expect(json, `manifest leaked ${leak}`).not.toContain(leak)
    }
  })

  it('drops the audit plumbing that means nothing outside the database', () => {
    const { project } = buildProjectManifest(PROJECT, BUNDLE)
    for (const k of ['workspace_id', 'created_by', 'updated_by', 'deleted_at',
                     'deleted_by', 'last_updated_at', 'last_updated_by']) {
      expect(project, `${k} should not be mirrored`).not.toHaveProperty(k)
    }
  })
})


describe('what the manifest is for', () => {
  it('mirrors the project settings, including margin and contingency', () => {
    // Two of the three things Audrey named. Safe to include, and MEASURED to
    // be so: projects_select admits any active workspace member, so these are
    // already readable by everyone who can open the project. Mirroring them
    // exposes nothing that was not already exposed.
    const { project } = buildProjectManifest(PROJECT, BUNDLE)
    expect(project.budget_margin_pct).toBe(15)
    expect(project.budget_contingency_pct).toBe(10)
    expect(project.project_code).toBe('HF26')
    expect(project.fps).toBe(23.98)
  })

  it('describes the folder tree, sorted by path', () => {
    // So someone looking at SCENES/Wlsn-Sc001 on a drive can tell what it is
    // without opening WILSON. Sorted so two exports of an unchanged project
    // produce the same file rather than a spurious diff.
    const { folders } = buildProjectManifest(PROJECT, BUNDLE)
    expect(folders.map(f => f.path)).toEqual(['', 'SCENES', 'SCENES/Wlsn-Sc001'])
    expect(folders[2].label).toBe('WLSN_SC001')
  })

  it('carries only the folder fields a reader needs, not the row', () => {
    // Database ids in a portable file invite someone to treat it as a
    // restorable backup, which it explicitly is not.
    for (const f of buildProjectManifest(PROJECT, BUNDLE).folders) {
      expect(f).not.toHaveProperty('id')
      expect(f).not.toHaveProperty('project_id')
    }
  })

  it('lists the team with their per-project job titles', () => {
    const { team } = buildProjectManifest(PROJECT, BUNDLE)
    expect(team).toEqual([
      { member_id: 'u1', project_role: 'manager', project_title: 'Producer' },
      { member_id: 'u2', project_role: 'member',  project_title: '' },
    ])
  })

  it('counts the entities, as an integrity signal for a handoff', () => {
    // If the folder has forty scene directories and this says one, the folder
    // travelled and the database did not.
    expect(buildProjectManifest(PROJECT, BUNDLE).counts).toEqual({
      assets: 1, scenes: 1, shots: 0, levels: 0, experiences: 0, phases: 1, tasks: 2,
    })
  })

  it('states that the database is authoritative, IN the file', () => {
    // Someone finding this on a drive in a year has none of the reasoning in
    // the source. The one thing they must not do is edit it and expect WILSON
    // to notice.
    const m = buildProjectManifest(PROJECT, BUNDLE)
    expect(m.authority).toBe('database')
    expect(m.note).toMatch(/editing this file changes nothing/i)
    expect(m.wilson_manifest_version).toBe(MANIFEST_VERSION)
  })

  it('takes the timestamp from the caller, so it is deterministic', () => {
    const a = buildProjectManifest(PROJECT, BUNDLE, '2026-08-04T12:00:00Z')
    const b = buildProjectManifest(PROJECT, BUNDLE, '2026-08-04T12:00:00Z')
    expect(a.generated_at).toBe('2026-08-04T12:00:00Z')
    expect(serializeProjectManifest(a)).toBe(serializeProjectManifest(b))
  })

  it('survives an empty bundle and a null project', () => {
    const m = buildProjectManifest(null, {})
    expect(m.project).toEqual({})
    expect(m.folders).toEqual([])
    expect(m.team).toEqual([])
    expect(m.counts.scenes).toBe(0)
  })

  it('serializes as indented JSON a person can read', () => {
    const json = serializeProjectManifest(buildProjectManifest(PROJECT, BUNDLE))
    expect(json).toContain('\n  "authority": "database"')
    expect(JSON.parse(json).project.title).toBe('Hero Film 2026')
  })

  it('is written as PROJECT.json', () => {
    expect(MANIFEST_FILENAME).toBe('PROJECT.json')
  })
})
