// =============================================================================
// shotTakeSelectors.test.js — the shot-takes joins and rankings (milestone 2).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import {
  takesByShot, primaryOf, takesSummary, usageByFile, usageCounts,
  assignableShotGroups, commonSceneId, matchesShotSearch, rankFilesForShot, takeLengthFrames, TAKE_ROLES,
} from './shotTakeSelectors.js'

const require = createRequire(import.meta.url)
const server = require('../../../../electron/rabbitBins.cjs')

const scenes = [
  { id: 'sc2', name: 'Sc 2 Kitchen', scene_number: 2 },
  { id: 'sc1', name: 'Sc 1 Hall', scene_number: 1 },
]
const shots = [
  { id: 'sh1', scene_id: 'sc1', name: 'Hall wide', shot_number: 1, status: 'in_progress' },
  { id: 'sh2', scene_id: 'sc1', name: 'Hall CU', shot_number: 2, status: 'omitted' },
  { id: 'sh3', scene_id: 'sc2', name: 'Kitchen 2S', shot_number: 1, status: 'not_started', framing: '2S' },
  { id: 'sh4', scene_id: null, name: 'Loose', shot_number: 7, status: 'not_started' },
  { id: 'sh5', scene_id: 'ghost-scene', name: 'Orphan scene', shot_number: 1, status: 'not_started' },
]
const files = [
  { id: 'f1', display_name: 'T1', scene_id: 'sc1', shot_id: 'sh1', review_flag: 'unflagged', duration_sec: 2, is_sequence: false },
  { id: 'f2', display_name: 'T2', scene_id: 'sc1', shot_id: null, review_flag: 'select', circled: true, duration_sec: 3.02 },
  { id: 'f3', display_name: 'T3', scene_id: 'sc2', shot_id: null, review_flag: 'reject', duration_sec: null },
  { id: 'f4', display_name: 'Plate', scene_id: null, is_sequence: true, frame_count: 48, duration_sec: 2 },
  { id: 'f5', display_name: 'Rejected hero', scene_id: 'sc1', shot_id: 'sh1', review_flag: 'reject' },
]
const takes = [
  { id: 't1', shot_id: 'sh1', bin_file_id: 'f2', role: 'alt', position: 1, created_at: '2026-09-10T01:00:00Z' },
  { id: 't2', shot_id: 'sh1', bin_file_id: 'f1', role: 'primary', position: 0, created_at: '2026-09-10T00:00:00Z' },
  { id: 't3', shot_id: 'sh3', bin_file_id: 'f1', role: 'primary', position: 0 },
  { id: 't4', shot_id: 'gone-shot', bin_file_id: 'f1', role: 'primary', position: 0 },
  { id: 't5', shot_id: 'sh1', bin_file_id: 'gone-file', role: 'part', position: 2 },
]

describe('joins', () => {
  it('takesByShot orders by position and skips a take whose file is gone', () => {
    const m = takesByShot(takes, files)
    expect(m.get('sh1').map(e => e.take.id)).toEqual(['t2', 't1'])
    expect(m.get('sh1').map(e => e.file.id)).toEqual(['f1', 'f2'])
    expect(m.get('sh3').length).toBe(1)
    expect(m.get('gone-shot').length).toBe(1) // the shot's existence is the caller's business
    expect(m.has('sh2')).toBe(false)
  })
  it('takesByShot presents like the server: positions renumbered, exactly one primary, state untouched', () => {
    // f1 (the primary of sh1) is gone from the files: the next take must read
    // as primary and positions must close up — while the rows stay as they were.
    const rows = takes.map(t => ({ ...t }))
    const m = takesByShot(rows, files.filter(f => f.id !== 'f1'))
    expect(m.get('sh1').map(e => [e.take.id, e.take.role, e.take.position])).toEqual([['t1', 'primary', 0]])
    expect(rows.find(t => t.id === 't1')).toMatchObject({ role: 'alt', position: 1 })
    // Two claimants (a restored orphan beside a promoted take): the first by position wins, the other reads alt.
    const two = [{ id: 'a', shot_id: 's', bin_file_id: 'f1', role: 'primary', position: 0 }, { id: 'b', shot_id: 's', bin_file_id: 'f2', role: 'primary', position: 2 }, { id: 'c', shot_id: 's', bin_file_id: 'f3', role: 'part', position: 5 }]
    expect(takesByShot(two, files).get('s').map(e => [e.take.id, e.take.role, e.take.position])).toEqual([['a', 'primary', 0], ['b', 'alt', 1], ['c', 'part', 2]])
    // And the server's own presentation agrees row for row.
    expect(server.presentTakes(two).map(t => [t.id, t.role, t.position])).toEqual([['a', 'primary', 0], ['b', 'alt', 1], ['c', 'part', 2]])
  })
  it('primaryOf prefers the flagged row and falls back to the first', () => {
    const m = takesByShot(takes, files)
    expect(primaryOf(m.get('sh1')).take.id).toBe('t2')
    expect(primaryOf([{ take: { id: 'x', role: 'alt' }, file: {} }]).take.id).toBe('x')
    expect(primaryOf([])).toBeNull()
    expect(primaryOf(null)).toBeNull()
  })
  it('takesSummary counts roles', () => {
    const s = takesSummary(takesByShot(takes, files).get('sh1'))
    expect(s).toMatchObject({ count: 2, parts: 0, alts: 1 })
    expect(s.primary.take.id).toBe('t2')
    expect(takesSummary(null).count).toBe(0)
  })
  it('usageByFile lists where a file is used, scene then shot order, skipping deleted shots', () => {
    const u = usageByFile(takes, shots, scenes)
    expect(u.get('f1').map(x => `${x.scene?.scene_number}/${x.shot.id}/${x.take.role}`)).toEqual(['1/sh1/primary', '2/sh3/primary'])
    expect(u.get('f2').length).toBe(1)
    expect(u.has('gone-file')).toBe(true) // the shot exists; the file's absence is the inspector's problem
    expect(usageCounts(takes, shots).get('f1')).toBe(2)
    expect(usageCounts(takes, shots).has('f3')).toBe(false)
  })
})

describe('pickers', () => {
  it('assignableShotGroups hides omitted shots, counts them, puts the preferred scene first and unlinked last', () => {
    const { groups, hiddenOmitted } = assignableShotGroups(shots, scenes, { preferSceneId: 'sc2' })
    expect(hiddenOmitted).toBe(1)
    expect(groups.map(g => g.key)).toEqual(['sc2', 'sc1', '__unlinked__'])
    expect(groups[1].shots.map(s => s.id)).toEqual(['sh1'])
    // A shot whose scene no longer exists is treated as unlinked, never lost;
    // within a group shots follow their number.
    expect(groups[2].shots.map(s => s.id)).toEqual(['sh5', 'sh4'])
    const plain = assignableShotGroups(shots, scenes)
    expect(plain.groups.map(g => g.key)).toEqual(['sc1', 'sc2', '__unlinked__'])
  })
  it('commonSceneId is the scene most files are logged to', () => {
    expect(commonSceneId(files)).toBe('sc1')
    expect(commonSceneId([{ scene_id: null }])).toBeNull()
    expect(commonSceneId([])).toBeNull()
  })
  it('matchesShotSearch reads name, number, scene and framing', () => {
    expect(matchesShotSearch(shots[2], scenes[0], 'kitchen 2s')).toBe(true)
    expect(matchesShotSearch(shots[2], scenes[0], '#1')).toBe(true)
    expect(matchesShotSearch(shots[2], scenes[0], 'sc2')).toBe(true)
    expect(matchesShotSearch(shots[2], scenes[0], 'hall')).toBe(false)
    expect(matchesShotSearch(shots[3], null, '')).toBe(true)
  })
  it('rankFilesForShot tiers by intended shot, then scene, then the rest; rejects sink, selects rise', () => {
    const r = rankFilesForShot(files, shots[0])
    expect(r.map(x => `${x.tier}:${x.file.id}`)).toEqual(['0:f1', '0:f5', '1:f2', '2:f4', '2:f3'])
    expect(rankFilesForShot(files, null).every(x => x.tier === 2)).toBe(true)
  })
})

describe('take length', () => {
  it('is the frame count for a sequence, duration × fps otherwise, null when unknown', () => {
    expect(takeLengthFrames(files[3], 25)).toBe(48)
    expect(takeLengthFrames(files[0], 24)).toBe(48)
    expect(takeLengthFrames(files[1], 24)).toBe(72)
    expect(takeLengthFrames(files[2], 24)).toBeNull()
    expect(takeLengthFrames({ duration_sec: 0.01 }, 24)).toBe(1)
    expect(takeLengthFrames(null, 24)).toBeNull()
  })
  it('the role vocabulary matches the server (ESM here, CJS there, agreement by test)', () => {
    expect(TAKE_ROLES).toEqual(server.TAKE_ROLES)
    expect(TAKE_ROLES).toEqual(['primary', 'part', 'alt'])
  })
})
