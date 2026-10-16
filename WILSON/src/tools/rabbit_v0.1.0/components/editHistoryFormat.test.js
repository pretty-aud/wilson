// =============================================================================
// editHistoryFormat.test.js — the drawer's rendering logic against the diff
// shapes migration 0012's capture trigger actually writes (verified against
// wilson-dev; see supabase/tests/rls/17_edit_history.sql for the DB side).
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  ACTION_META, ENTITY_LABELS, RESTORE_META,
  diffLines, snapshotSummary, formatHistoryTimestamp, actorName,
  softDeleteTransition, entryActionMeta,
} from './editHistoryFormat'

const updateEntry = {
  action: 'update',
  entity_type: 'tasks',
  diff: {
    title:      { old: 'Comp shot 010', new: 'Comp shot 011' },
    status_tag: { old: null, new: 'probe' },
  },
}

// Soft delete / restore rows are what 0014's stamp trigger + 0012's capture
// trigger actually write: an 'update' whose diff flips deleted_at/deleted_by.
const softDeleteEntry = {
  action: 'update',
  entity_type: 'assets',
  diff: {
    deleted_at: { old: null, new: '2026-07-28T14:05:00Z' },
    deleted_by: { old: null, new: 'some-uuid' },
  },
}

const restoreEntry = {
  action: 'update',
  entity_type: 'assets',
  diff: {
    deleted_at: { old: '2026-07-28T14:05:00Z', new: null },
    deleted_by: { old: 'some-uuid', new: null },
  },
}

describe('diffLines', () => {
  it('maps update diffs to sorted field/from/to lines', () => {
    expect(diffLines(updateEntry)).toEqual([
      { field: 'status_tag', from: '—', to: 'probe' },
      { field: 'title', from: 'Comp shot 010', to: 'Comp shot 011' },
    ])
  })

  it('hides bookkeeping fields', () => {
    const entry = {
      action: 'update',
      diff: {
        title: { old: 'a', new: 'b' },
        project_id: { old: 'x', new: 'y' },
        deleted_at: { old: null, new: '2026-07-28' },
      },
    }
    expect(diffLines(entry).map(l => l.field)).toEqual(['title'])
  })

  it('returns [] for create/delete/malformed entries', () => {
    expect(diffLines({ action: 'create', diff: { new: { title: 'x' } } })).toEqual([])
    expect(diffLines({ action: 'delete', diff: { old: { title: 'x' } } })).toEqual([])
    expect(diffLines(null)).toEqual([])
    expect(diffLines({ action: 'update' })).toEqual([])
  })

  // VW1m (2026-10-16), Q-N8 (batch 16; interim: the old link lines read in
  // words, named, without Revert — editHistoryRevert.test.js has the Revert).
  it('VW1m: a task\'s link lines read in words, each item named where the project shows it', () => {
    const names = { 'asset:a1': 'Lighthouse Interior', 'asset:a2': 'Storm Lantern', 'level:l1': 'Harbour' }
    const nameOf = (kind, id) => names[`${kind}:${id}`] || null
    const entry = {
      action: 'update', entity_type: 'tasks',
      diff: {
        asset_id: { old: 'a1', new: 'a2' },
        level_id: { old: null, new: 'l1' },
        experience_id: { old: 'x-gone', new: null },
        title: { old: 'A', new: 'B' },
      },
    }
    expect(diffLines(entry, { nameOf })).toEqual([
      { field: 'asset_id', label: 'Asset', from: 'Lighthouse Interior', to: 'Storm Lantern' },
      { field: 'experience_id', label: 'Experience', from: 'an experience no longer in the project', to: '—' },
      { field: 'level_id', label: 'Level', from: '—', to: 'Harbour' },
      { field: 'title', from: 'A', to: 'B' },
    ])
  })
  it('VW1m CONTROL: another entity\'s field of the same name keeps its raw line', () => {
    const entry = { action: 'update', entity_type: 'files', diff: { asset_id: { old: 'a1', new: 'a2' } } }
    expect(diffLines(entry, { nameOf: () => 'Named' })).toEqual([{ field: 'asset_id', from: 'a1', to: 'a2' }])
  })
})

describe('soft delete / restore relabel (migration 0014)', () => {
  it('detects both deleted_at transitions', () => {
    expect(softDeleteTransition(softDeleteEntry)).toBe('deleted')
    expect(softDeleteTransition(restoreEntry)).toBe('restored')
    expect(softDeleteTransition(updateEntry)).toBeNull()
    expect(softDeleteTransition({ action: 'delete', diff: { old: { title: 'x' } } })).toBeNull()
    expect(softDeleteTransition(null)).toBeNull()
  })

  it('labels soft deletes with the delete styling, restores as Restored', () => {
    expect(entryActionMeta(softDeleteEntry)).toEqual(ACTION_META.delete)
    expect(entryActionMeta(restoreEntry)).toEqual(RESTORE_META)
  })

  it('falls back to ACTION_META for ordinary rows', () => {
    expect(entryActionMeta(updateEntry)).toEqual(ACTION_META.update)
    expect(entryActionMeta({ action: 'create', diff: { new: { title: 'x' } } })).toEqual(ACTION_META.create)
  })

  it('still suppresses the raw deleted_at/deleted_by lines', () => {
    expect(diffLines(softDeleteEntry)).toEqual([])
    expect(diffLines(restoreEntry)).toEqual([])
  })
})

describe('snapshotSummary', () => {
  it('prefers title, then name, over lower-priority fields', () => {
    expect(snapshotSummary({ diff: { new: { title: 'Shot 010', status: 'active' } } })).toBe('Shot 010')
    expect(snapshotSummary({ diff: { old: { name: 'Asset A', url: 'https://x' } } })).toBe('Asset A')
    expect(snapshotSummary({ diff: { old: { url: 'https://a.example' } } })).toBe('https://a.example')
  })
  it('returns null when nothing presentable exists', () => {
    expect(snapshotSummary({ diff: { new: { lag_days: 0 } } })).toBeNull()
    expect(snapshotSummary({})).toBeNull()
  })
})

describe('actorName', () => {
  it('uses the write-time label when present', () => {
    expect(actorName({ actor_label: 'User C' })).toBe('User C')
  })
  it('falls back to Former member for departed users, System for no actor', () => {
    expect(actorName({ actor_label: null, actor_user_id: 'some-uuid' })).toBe('Former member')
    expect(actorName({ actor_label: null, actor_user_id: null })).toBe('System')
  })
})

describe('formatHistoryTimestamp', () => {
  it('renders an absolute en-US timestamp', () => {
    const out = formatHistoryTimestamp('2026-07-28T14:05:00Z')
    expect(out).toMatch(/Jul 28, 2026/)
    expect(out).toMatch(/\d{1,2}:\d{2}/)
  })
  it('does not crash on garbage', () => {
    expect(formatHistoryTimestamp('not-a-date')).toBe('not-a-date')
    expect(formatHistoryTimestamp(null)).toBe('')
  })
})

describe('contract with the capture trigger', () => {
  it('covers every action the DB CHECK allows', () => {
    expect(Object.keys(ACTION_META).sort()).toEqual(['create', 'delete', 'update'])
  })
  it('labels all 13 RABBIT tables', () => {
    expect(Object.keys(ENTITY_LABELS)).toHaveLength(13)
  })
})
