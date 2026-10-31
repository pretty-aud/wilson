// =============================================================================
// teardownCollect.test.js — P8 (night 5, 2026-10-28), TPN-CONT-018.
//
// The teardown's collectors (supabase/functions/_shared/teardownCollect.ts),
// imported across the Deno/Node line and driven against a FAKE client: a
// query builder that answers canned rows for each table and a storage
// listing that answers a canned folder tree. Before P8 the collectors sat
// beside Deno.serve in operator-workspaces/index.ts, where no test could run
// them, and the bin clips' posters — named only by bin_files.poster_path,
// which no sweep read — stayed in rabbit-thumbnails after every teardown.
// The first test below is the one that fails on that shape.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import {
  collectBlobPaths, collectAvatarPaths, listFolder,
  BUCKET, THUMBNAIL_BUCKET, AVATAR_BUCKET, PAGE, LIST_PAGE, AVATAR_MAX, BIN_POSTERS_MAX,
} from '../../supabase/functions/_shared/teardownCollect.ts'

const WS = '11111111-1111-1111-1111-111111111111'
const P1 = 'aaaa1111-0000-0000-0000-000000000001'
const P2 = 'aaaa1111-0000-0000-0000-000000000002'
const OTHER = 'bbbb2222-0000-0000-0000-000000000001' // another workspace's project

/**
 * A fake service-role client: `.from(table)` answers rows filtered by the
 * eq/neq/not calls the collectors make, paged by range(); a count query
 * (`select('id', { count, head })`) answers the filtered count; the storage
 * listing answers `tree[bucket][prefix]`, a listing error where the tree says
 * `error`.
 */
function fakeClient({ projects = [], files = [], queue = [], tree = {} } = {}) {
  const tables = { projects, files, storage_gc_queue: queue }
  const listCalls = []
  const from = (table) => {
    const filters = []
    let range = null
    let count = false
    const b = {
      select: (_cols, opts) => { count = !!opts?.count; return b },
      eq: (k, v) => { filters.push((r) => r[k] === v); return b },
      neq: (k, v) => { filters.push((r) => r[k] !== v); return b },
      not: (k, op, v) => { if (op === 'is' && v === null) filters.push((r) => r[k] != null); return b },
      in: (k, vs) => { filters.push((r) => vs.includes(r[k])); return b },
      order: () => b,
      range: (a, z) => { range = [a, z]; return b },
      then: (resolve) => {
        const rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)))
        if (count) return resolve({ count: rows.length, error: null })
        const page = range ? rows.slice(range[0], range[1] + 1) : rows
        return resolve({ data: page, error: null })
      },
    }
    return b
  }
  const storage = {
    from: (bucket) => ({
      list: async (prefix, opts) => {
        listCalls.push({ bucket, prefix, opts })
        const node = tree[bucket]?.[prefix]
        if (node?.error) return { data: null, error: { message: node.error } }
        return { data: node ?? [], error: null }
      },
    }),
  }
  return { ctx: { admin: { from, storage } }, listCalls }
}
const folder = (name) => ({ name, id: null })
const object = (name) => ({ name, id: `obj-${name}` })

describe('the bin clips\' posters at teardown (TPN-CONT-018)', () => {
  it('🚨 lists rabbit-thumbnails under projects/{id}/bin_files/ for every owned project and collects every poster into thumbs', async () => {
    const { ctx, listCalls } = fakeClient({
      projects: [{ id: P1, workspace_id: WS }, { id: P2, workspace_id: WS }, { id: OTHER, workspace_id: 'other' }],
      tree: {
        [THUMBNAIL_BUCKET]: {
          [`projects/${P1}/bin_files`]: [folder('f1'), folder('f2')],
          [`projects/${P1}/bin_files/f1`]: [object('1700000000000-poster.jpg')],
          [`projects/${P1}/bin_files/f2`]: [object('1700000000001-poster.jpg'), object('1700000000002-poster.jpg')],
          [`projects/${P2}/bin_files`]: [],
          [`projects/${OTHER}/bin_files`]: [folder('x')],
          [`projects/${OTHER}/bin_files/x`]: [object('9-poster.jpg')],
        },
      },
    })
    const out = await collectBlobPaths(ctx, WS)
    expect(out.thumbs.sort()).toEqual([
      `projects/${P1}/bin_files/f1/1700000000000-poster.jpg`,
      `projects/${P1}/bin_files/f2/1700000000001-poster.jpg`,
      `projects/${P1}/bin_files/f2/1700000000002-poster.jpg`,
    ])
    expect(out.binPostersListed).toBe(3)
    expect(out.binPostersTruncated).toBe(false)
    // Only the OWNED projects' prefixes are listed — never another tenant's.
    const prefixes = listCalls.filter((c) => c.bucket === THUMBNAIL_BUCKET).map((c) => c.prefix)
    expect(prefixes).toContain(`projects/${P1}/bin_files`)
    expect(prefixes).toContain(`projects/${P2}/bin_files`)
    expect(prefixes.some((p) => p.includes(OTHER))).toBe(false)
    // The rest of the certificate's shape is untouched by the listing.
    expect(out).toMatchObject({ paths: [], rejected: [], byoLeft: 0, byoThumbsLeft: 0 })
    expect(out.reserved).toHaveLength(4) // two per owned project (reservedObjects.ts)
  })
  it('a poster is joined with the row-derived previews, once (deduped), and a poster below the depth bound stops the walk and says so', async () => {
    const { ctx } = fakeClient({
      projects: [{ id: P1, workspace_id: WS }],
      files: [{ workspace_id: WS, storage_provider: 'supabase', storage_path: `projects/${P1}/files/a/1-a.mov`, thumbnail_url: `projects/${P1}/bin_files/f1/1700000000000-poster.jpg` }],
      tree: {
        [THUMBNAIL_BUCKET]: {
          [`projects/${P1}/bin_files`]: [folder('f1'), folder('deep')],
          [`projects/${P1}/bin_files/f1`]: [object('1700000000000-poster.jpg')],
          [`projects/${P1}/bin_files/deep`]: [folder('deeper')],
          [`projects/${P1}/bin_files/deep/deeper`]: [folder('deepest')],
        },
      },
    })
    const out = await collectBlobPaths(ctx, WS)
    expect(out.thumbs).toEqual([`projects/${P1}/bin_files/f1/1700000000000-poster.jpg`])
    expect(out.binPostersListed).toBe(1)
    expect(out.binPostersTruncated).toBe(true)
  })
  it('🚨 a listing that fails THROWS: the teardown refuses rather than certify over an unknown set', async () => {
    const { ctx } = fakeClient({
      projects: [{ id: P1, workspace_id: WS }],
      tree: { [THUMBNAIL_BUCKET]: { [`projects/${P1}/bin_files`]: { error: 'storage is down' } } },
    })
    await expect(collectBlobPaths(ctx, WS)).rejects.toThrow(/storage list rabbit-thumbnails\/projects\/.*storage is down/)
  })
  it('the budget: past binPostersMax the walk stops and truncated is true, so the certificate never claims a sweep it did not finish', async () => {
    const { ctx } = fakeClient({
      projects: [{ id: P1, workspace_id: WS }],
      tree: {
        [THUMBNAIL_BUCKET]: {
          [`projects/${P1}/bin_files`]: [folder('f1')],
          [`projects/${P1}/bin_files/f1`]: [object('1-poster.jpg'), object('2-poster.jpg'), object('3-poster.jpg')],
        },
      },
    })
    const out = await collectBlobPaths(ctx, WS, { binPostersMax: 2 })
    expect(out.binPostersListed).toBe(2)
    expect(out.binPostersTruncated).toBe(true)
    expect(out.thumbs).toHaveLength(2)
    expect(BIN_POSTERS_MAX).toBe(20000)
  })
})

describe('the collectors as they were (moved verbatim)', () => {
  it('bodies from files (supabase only) and the queue, rejecting a path outside the owned projects; previews from every provider but s3', async () => {
    const { ctx } = fakeClient({
      projects: [{ id: P1, workspace_id: WS }],
      files: [
        { workspace_id: WS, storage_provider: 'supabase', storage_path: `projects/${P1}/files/a/1-a.mov`, thumbnail_url: `projects/${P1}/files/a/1-a.mov.jpg` },
        { workspace_id: WS, storage_provider: 'supabase', storage_path: `projects/${OTHER}/files/b/1-b.mov`, thumbnail_url: null },
        { workspace_id: WS, storage_provider: 's3', storage_path: `projects/${P1}/files/c/1-c.mov`, thumbnail_url: `projects/${P1}/files/c/1-c.mov.jpg` },
        { workspace_id: WS, storage_provider: 'local_server', storage_path: null, thumbnail_url: `projects/${P1}/files/d/1-d.jpg` },
      ],
      queue: [
        { workspace_id: WS, bucket_id: BUCKET, object_path: `projects/${P1}/files/e/1-e.mov`, provider: 'supabase', kind: 'body', status: 'pending' },
        { workspace_id: WS, bucket_id: THUMBNAIL_BUCKET, object_path: `projects/${P1}/files/f/1-f.jpg`, provider: 'supabase', kind: 'thumbnail', status: 'pending' },
        { workspace_id: WS, bucket_id: 'byo-s3', object_path: `projects/${P1}/files/g/1-g.mov`, provider: 's3', kind: 'body', status: 'failed' },
      ],
    })
    const out = await collectBlobPaths(ctx, WS)
    expect(out.paths.sort()).toEqual([`projects/${P1}/files/a/1-a.mov`, `projects/${P1}/files/e/1-e.mov`])
    expect(out.rejected).toEqual([`projects/${OTHER}/files/b/1-b.mov`])
    expect(out.thumbs.sort()).toEqual([`projects/${P1}/files/a/1-a.mov.jpg`, `projects/${P1}/files/d/1-d.jpg`, `projects/${P1}/files/f/1-f.jpg`])
    // Left in the customer's bucket, counted: the s3 body (live) and the failed s3 queue row; the s3 preview.
    expect(out.byoLeft).toBe(2)
    expect(out.byoThumbsLeft).toBe(1)
  })
  it('avatars are listed by prefix, two levels deep, with the budget; a failing listing throws', async () => {
    const { ctx } = fakeClient({ tree: { [AVATAR_BUCKET]: { [WS]: [folder('u1')], [`${WS}/u1`]: [object('a.jpg'), object('b.jpg')] } } })
    expect(await collectAvatarPaths(ctx, WS)).toEqual({ avatars: [`${WS}/u1/a.jpg`, `${WS}/u1/b.jpg`], truncated: false })
    const bad = fakeClient({ tree: { [AVATAR_BUCKET]: { [WS]: { error: 'nope' } } } })
    await expect(collectAvatarPaths(bad.ctx, WS)).rejects.toThrow(/storage list user-avatars/)
    expect(await listFolder(fakeClient().ctx, AVATAR_BUCKET, 'nothing')).toEqual([])
    expect([PAGE, LIST_PAGE, AVATAR_MAX]).toEqual([1000, 100, 5000])
  })
  it('a listing pages through LIST_PAGE-sized answers until a short one', async () => {
    const pages = [Array.from({ length: LIST_PAGE }, (_, i) => object(`${i}.jpg`)), [object('last.jpg')]]
    let n = 0
    const ctx = { admin: { storage: { from: () => ({ list: async () => ({ data: pages[n++] ?? [], error: null }) }) } } }
    expect((await listFolder(ctx, THUMBNAIL_BUCKET, 'p')).length).toBe(LIST_PAGE + 1)
    expect(n).toBe(2)
  })
})

describe('the wiring is real: index.ts calls the moved collectors exactly as before, and the certificate carries the posters', () => {
  const { readFileSync } = require('node:fs')
  const { join } = require('node:path')
  const ops = readFileSync(join(__dirname, '..', '..', 'supabase', 'functions', 'operator-workspaces', 'index.ts'), 'utf8')
  it('the call sites, the import and the certificate lines', () => {
    expect(ops).toContain("} from '../_shared/teardownCollect.ts'")
    expect(ops).toContain('const scan = await collectBlobPaths(ctx, workspaceId)')
    expect(ops).toContain('await collectAvatarPaths(ctx, workspaceId)')
    expect(ops).toContain('bin_posters_listed: binPostersListed,')
    expect(ops).toContain('bin_posters_truncated: binPostersTruncated,')
    expect(ops).toContain('binPostersListed = scan.binPostersListed')
    expect(ops).not.toMatch(/^async function collectBlobPaths\(/m)
    // Step 2c removes `thumbs` (posters included) BEFORE the CASCADE, as the ordering pins in uploadReservation.test.js hold.
    expect(ops.indexOf('storage.from(THUMBNAIL_BUCKET).remove(batch)')).toBeLessThan(ops.indexOf(".from('workspaces')\n      .delete()".replace('\n', ops.includes('\r\n') ? '\r\n' : '\n')))
  })
})
