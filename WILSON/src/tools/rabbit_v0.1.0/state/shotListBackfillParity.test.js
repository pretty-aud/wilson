// =============================================================================
// shotListBackfillParity.test.js — post-overhaul S3a (0084, D11).
//
// The backfill order lives in THREE places: 0084's ORDER BY (the cloud, run
// once), shotListModel.js's backfillItems (the provider and the fixtures), and
// electron/rabbitShotLists.cjs's copy (the Local Server, on read — CJS, so it
// cannot import the ESM model and restates it). A drift between the last two
// means the same project gets a different "Shot list 1" depending on where it
// is stored. This runs both on the SAME shuffled input — nulls, ties on every
// key, unlinked shots, a shot whose scene no longer exists — and requires the
// same (scene_id, shot_id, position) rows in the same order.
//
// 🚨 THE FAILING CONTROL: two deliberately different orders (nulls FIRST; and
// sort_order before scene_number) must be DETECTED by the same comparison. A
// comparison that could not tell orders apart (comparing sets of ids without
// positions, say) would pass the parity case and fail here.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { backfillItems, backfillShotList, compareScenesForList, compareShotsForList } from './shotListModel'

const require = createRequire(import.meta.url)
const cjs = require('../../../../electron/rabbitShotLists.cjs')

// A deterministic shuffle (mulberry32), so a failure reproduces.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffle(rows, seed) {
  const r = rng(seed)
  const out = [...rows]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Every tie-break is exercised: equal scene_number decided by sort_order, then
// created_at, then id; null and '' numbers last; a numeric string; a number
// that sorts differently as text ('10' vs 9).
const SCENES = [
  { id: 'sc-10', scene_number: 10, sort_order: 0, created_at: '2026-01-01' },
  { id: 'sc-9', scene_number: 9, sort_order: 5, created_at: '2026-01-01' },
  { id: 'sc-3a', scene_number: 3, sort_order: 2, created_at: '2026-01-01' },
  { id: 'sc-3b', scene_number: 3, sort_order: 1, created_at: '2026-01-01' },
  { id: 'sc-3c', scene_number: 3, sort_order: 1, created_at: '2025-12-31' },
  { id: 'sc-3e', scene_number: '3', sort_order: 1, created_at: '2025-12-31' },
  { id: 'sc-3d', scene_number: 3, sort_order: 1, created_at: '2025-12-31' },
  { id: 'sc-null', scene_number: null, sort_order: 0, created_at: '2026-01-01' },
  { id: 'sc-blank', scene_number: '', sort_order: null, created_at: '2026-01-01' },
  { id: 'sc-undef', sort_order: 0, created_at: '2026-01-01' },
  { id: 'sc-1', scene_number: 1, sort_order: null, created_at: null },
]
const SHOTS = [
  { id: 'a-2', scene_id: 'sc-3b', shot_number: 2, sort_order: 0 },
  { id: 'a-1', scene_id: 'sc-3b', shot_number: 1, sort_order: 9 },
  { id: 'a-1b', scene_id: 'sc-3b', shot_number: 1, sort_order: 3 },
  { id: 'a-null', scene_id: 'sc-3b', shot_number: null, sort_order: 0 },
  { id: 'b-1', scene_id: 'sc-10', shot_number: 1, sort_order: 0 },
  { id: 'b-10', scene_id: 'sc-10', shot_number: 10, sort_order: 0 },
  { id: 'b-9', scene_id: 'sc-10', shot_number: 9, sort_order: 0 },
  { id: 'c-1', scene_id: 'sc-null', shot_number: 1, created_at: '2026-02-02' },
  { id: 'c-1x', scene_id: 'sc-null', shot_number: 1, created_at: '2026-02-01' },
  { id: 'loose-2', scene_id: null, shot_number: 2 },
  { id: 'loose-1', scene_id: null, shot_number: 1 },
  { id: 'loose-u', shot_number: 1 }, // no scene_id key at all: the same bucket
  { id: 'gone-1', scene_id: 'sc-deleted', shot_number: 1 }, // its scene is gone (the desktop does not cascade)
  { id: 'gone-2', scene_id: 'sc-deleted', shot_number: 0 },
  { id: 'gone-3', scene_id: 'sc-also-deleted', shot_number: 0 },
]

const triple = (rows) => rows.map(r => [r.scene_id ?? null, r.shot_id ?? null, r.position])
const asSet = (rows) => new Set(rows.map(r => JSON.stringify([r.scene_id ?? null, r.shot_id ?? null, r.position])))
function sameSet(a, b) {
  const x = asSet(a)
  const y = asSet(b)
  return x.size === y.size && [...x].every(k => y.has(k))
}

describe('the Local Server backfill order equals shotListModel.backfillItems', () => {
  it('the same rows, in the same order, for twenty shuffles of the same input', () => {
    const expected = triple(backfillItems(SCENES, SHOTS))
    expect(expected).toHaveLength(SCENES.length + SHOTS.length)
    for (let seed = 1; seed <= 20; seed++) {
      const scenes = shuffle(SCENES, seed)
      const shots = shuffle(SHOTS, seed * 7919)
      const model = backfillItems(scenes, shots)
      const local = cjs.backfillItems(scenes, shots)
      expect(triple(local), `seed ${seed}`).toEqual(triple(model))
      expect(sameSet(local, model)).toBe(true)
      // And the model is order-independent itself, or "parity" would be luck.
      expect(triple(model), `seed ${seed}`).toEqual(expected)
    }
  })

  it('the comparators agree pairwise on every pair of rows', () => {
    for (const a of SCENES) for (const b of SCENES) {
      expect(Math.sign(cjs.compareScenesForList(a, b)), `${a.id} vs ${b.id}`).toBe(Math.sign(compareScenesForList(a, b)))
    }
    for (const a of SHOTS) for (const b of SHOTS) {
      expect(Math.sign(cjs.compareShotsForList(a, b)), `${a.id} vs ${b.id}`).toBe(Math.sign(compareShotsForList(a, b)))
    }
  })

  it('pins the order itself, so both copies cannot drift together unnoticed', () => {
    const rows = cjs.backfillItems(shuffle(SCENES, 3), shuffle(SHOTS, 4))
    expect(rows.filter(r => r.scene_id).map(r => r.scene_id)).toEqual([
      'sc-1', 'sc-3c', 'sc-3d', 'sc-3e', 'sc-3b', 'sc-3a', 'sc-9', 'sc-10',
      // the three "no number" scenes tie, so sort_order decides (null last), then id
      'sc-null', 'sc-undef', 'sc-blank',
    ])
    const shotPos = Object.fromEntries(rows.filter(r => r.shot_id).map(r => [r.shot_id, r.position]))
    expect(shotPos).toEqual({
      'a-1b': 0, 'a-1': 1, 'a-2': 2, 'a-null': 3,
      'b-1': 0, 'b-9': 1, 'b-10': 2,
      'c-1x': 0, 'c-1': 1,
      'gone-3': 0, 'gone-2': 0, 'gone-1': 1,
      'loose-1': 0, 'loose-u': 1, 'loose-2': 2,
    })
  })

  it('backfillShotListsOnRead writes the model\'s backfillShotList membership (ids and stamps aside)', () => {
    let n = 0
    const newId = () => `id-${++n}`
    const scenes = shuffle(SCENES, 11)
    const shots = shuffle(SHOTS, 12)
    const bundle = { project: { id: 'p1' }, scenes, shots }
    cjs.backfillShotListsOnRead(bundle, { newId, now: '2026-09-30T00:00:00.000Z' })
    const { list, items } = backfillShotList({ projectId: 'p1', scenes, shots, newId: () => 'm', now: '2026-09-30T00:00:00.000Z' })
    expect(triple(bundle.shotListItems)).toEqual(triple(items))
    expect(bundle.shotLists[0]).toMatchObject({
      title: list.title, version: list.version, summary: list.summary, snapshot: list.snapshot,
      archived_at: null, project_id: 'p1',
    })
  })
})

describe('FAILING CONTROLS — a deliberately different order is detected', () => {
  // The model's comparators with ONE change each; everything else identical.
  function variantBackfill(compareScenes, compareShots) {
    const out = []
    const ordered = [...SCENES].sort(compareScenes)
    ordered.forEach((s, i) => out.push({ scene_id: s.id, shot_id: null, position: i }))
    const groups = new Map()
    for (const sh of SHOTS) {
      const k = sh.scene_id || null
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(sh)
    }
    for (const g of groups.values()) g.sort(compareShots).forEach((sh, i) => out.push({ scene_id: null, shot_id: sh.id, position: i }))
    return out
  }
  const nullsFirst = (key) => (a, b) => {
    const an = a[key] == null || a[key] === ''
    const bn = b[key] == null || b[key] === ''
    if (an !== bn) return an ? -1 : 1
    return (key === 'scene_number' ? compareScenesForList : compareShotsForList)(a, b)
  }
  const sortOrderFirst = (cmp) => (a, b) => ((a.sort_order ?? 1e9) - (b.sort_order ?? 1e9)) || cmp(a, b)

  it('nulls FIRST (a NULLS FIRST ORDER BY) is caught', () => {
    const wrong = variantBackfill(nullsFirst('scene_number'), nullsFirst('shot_number'))
    const model = backfillItems(SCENES, SHOTS)
    expect(sameSet(wrong, model)).toBe(false)
    expect(triple(wrong)).not.toEqual(triple(model))
  })

  it('sort_order before scene_number is caught', () => {
    const wrong = variantBackfill(sortOrderFirst(compareScenesForList), sortOrderFirst(compareShotsForList))
    expect(sameSet(wrong, backfillItems(SCENES, SHOTS))).toBe(false)
  })

  it('CONTROL OF THE CONTROL: the variant builder with the model\'s own comparators matches (as a set)', () => {
    // Its group order differs from the model's (Map insertion order), which
    // is why the parity case above compares ORDER as well as the set.
    const same = variantBackfill(compareScenesForList, compareShotsForList)
    expect(sameSet(same, backfillItems(SCENES, SHOTS))).toBe(true)
  })
})
