// =============================================================================
// binsMigration.test.js — BC3 (B9): the pure rules of the bins' migration.
//
// A desktop clip is an absolute path under a recorded root; a cloud clip is a
// footage location plus a path inside it. These pin how a clip finds its
// root, how a root's answer resolves to a location (an existing one by
// address, a new one named now, or left on this computer), how a clip's row
// takes the cloud's shape, and that bins arrive parents first. Every rule has
// a control that shows it can fail.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import {
  pathKey, isUnder, relativeUnder, isCloudRelativePath, shareRootOf, rootKind, rootOfClip, binRootsOf, mergeRoots,
  suggestedAnswer, holdingLocation, resolveRootAnswer, cloudBinFileRow, binsParentsFirst, POSTER_MEDIA, ADDRESS_NEEDED,
} from './binsMigration'

// The refusal sentence is the cloud adapter's, word for word. The adapter's
// import builds the Supabase client (CI has no address: BC2's trap 1), so it
// is mocked here and the pure module above never imports it.
vi.mock('../auth/supabaseClient', () => ({ supabase: null }))
const { BINS_REFUSALS } = await import('../../tools/rabbit_v0.1.0/adapters/supabaseAdapter')

describe('the refusal is the cloud\'s own sentence', () => {
  it('ADDRESS_NEEDED is BINS_REFUSALS.locationShape', () => {
    expect(ADDRESS_NEEDED).toBe(BINS_REFUSALS.locationShape)
  })
})

const NAS = '\\\\nas\\footage'
const LOCATIONS = [
  { id: 'L1', name: 'Footage NAS', unc_path: NAS },
  { id: 'L2', name: 'Day 1 only', unc_path: '\\\\nas\\footage\\Day01' },
  { id: 'L3', name: 'Sound', unc_path: '\\\\nas\\sound' },
]

describe('paths', () => {
  it('a key is case-blind, backslashed, without a trailing one (a drive root keeps its)', () => {
    expect(pathKey('\\\\NAS\\Footage\\Day01\\')).toBe('\\\\nas\\footage\\day01')
    expect(pathKey('//nas/footage/Day01')).toBe('\\\\nas\\footage\\day01')
    expect(pathKey('D:\\')).toBe('d:\\')
    expect(pathKey('D:\\Footage\\')).toBe('d:\\footage')
  })
  it('isUnder: the folder itself, and anything inside — never a sibling that merely shares a prefix', () => {
    expect(isUnder('\\\\nas\\footage\\Day01\\a.mov', NAS)).toBe(true)
    expect(isUnder(NAS, NAS)).toBe(true)
    expect(isUnder('\\\\nas\\footage2\\a.mov', NAS)).toBe(false)
    expect(isUnder('D:\\Footage\\x.mov', 'D:\\')).toBe(true)
    expect(isUnder('', NAS)).toBe(false)
  })
  it('relativeUnder: forward slashes, the folder itself as the empty path, null outside', () => {
    expect(relativeUnder('\\\\nas\\footage\\Day01\\A001\\a.mov', NAS)).toBe('Day01/A001/a.mov')
    expect(relativeUnder('\\\\NAS\\FOOTAGE\\Day01', NAS)).toBe('Day01')
    expect(relativeUnder(NAS, NAS)).toBe('')
    expect(relativeUnder('\\\\nas\\sound\\a.wav', NAS)).toBeNull()
    expect(relativeUnder('D:\\Footage\\Day01\\a.mov', 'D:\\')).toBe('Footage/Day01/a.mov')
  })
  it("isCloudRelativePath: 0091's CHECK, as it refuses", () => {
    expect(isCloudRelativePath('Day01/A001/a.mov')).toBe(true)
    for (const bad of ['', '/Day01/a.mov', 'Day01/a.mov/', 'Day01//a.mov', 'Day01\\a.mov', 'C:/a.mov', '../a.mov', 'Day01/../a.mov', 'Day01/./a.mov', 'Day01./a.mov', 'Day01 /a.mov', 'x'.repeat(1025)]) {
      expect(isCloudRelativePath(bad), bad).toBe(false)
    }
  })
  it('shareRootOf: the share of a network path, only one 0091 admits; rootKind tells a drive letter from a share', () => {
    expect(shareRootOf('\\\\nas\\footage\\Day01\\a.mov')).toBe(NAS)
    expect(shareRootOf('//nas/footage/Day01')).toBe(NAS)
    expect(shareRootOf('\\\\localhost\\C$\\x')).toBeNull()
    expect(shareRootOf('D:\\Footage\\a.mov')).toBeNull()
    expect(rootKind('\\\\nas\\footage')).toBe('unc')
    expect(rootKind('D:\\Footage')).toBe('local')
    expect(rootKind('C:\\')).toBe('local')
  })
})

describe('roots', () => {
  const roots = [{ path: NAS }, { path: '\\\\nas\\footage\\Day01' }, { path: 'D:\\Footage' }]
  it('a clip belongs to the LONGEST recorded root that holds it', () => {
    expect(rootOfClip({ source_path: '\\\\nas\\footage\\Day01\\a.mov' }, roots)).toBe('\\\\nas\\footage\\Day01')
    expect(rootOfClip({ source_path: '\\\\nas\\footage\\Day02\\a.mov' }, roots)).toBe(NAS)
    expect(rootOfClip({ source_path: 'D:\\Footage\\Day01\\a.mov' }, roots)).toBe('D:\\Footage')
  })
  it('with no recorded root: a network path falls to its share, a local one to its own folder; no path, no root', () => {
    expect(rootOfClip({ source_path: '\\\\nas\\sound\\a.wav' }, roots)).toBe('\\\\nas\\sound')
    expect(rootOfClip({ source_path: 'E:\\Dailies\\Day03\\a.mov' }, roots)).toBe('E:\\Dailies\\Day03')
    expect(rootOfClip({ source_path: 'E:\\a.mov' }, roots)).toBe('E:\\')
    expect(rootOfClip({ source_path: '' }, roots)).toBeNull()
    expect(rootOfClip({}, roots)).toBeNull()
  })
  it('binRootsOf: the distinct roots of a bundle, each with its clips, in order; mergeRoots joins projects', () => {
    const bundle = {
      binRoots: [{ path: 'D:\\Footage' }],
      binFiles: [
        { id: 'a', source_path: 'D:\\Footage\\Day01\\a.mov' }, { id: 'b', source_path: 'd:\\footage\\Day02\\b.mov' },
        { id: 'c', source_path: '\\\\nas\\sound\\c.wav' }, { id: 'd', source_path: null },
      ],
    }
    const roots = binRootsOf(bundle)
    expect(roots.map(r => [r.root, r.kind, r.count, r.clipIds])).toEqual([
      ['\\\\nas\\sound', 'unc', 1, ['c']],
      ['D:\\Footage', 'local', 2, ['a', 'b']],
    ])
    const merged = mergeRoots([{ projectId: 'p1', roots }, { projectId: 'p2', roots: [{ root: 'd:\\footage', key: 'd:\\footage', kind: 'local', clipIds: ['z'], count: 1 }] }])
    expect(merged.find(r => r.key === 'd:\\footage')).toMatchObject({ count: 3, projects: ['p1', 'p2'] })
  })
})

describe('the question\'s answer', () => {
  const unc = { root: '\\\\nas\\footage\\Day01\\A001', key: pathKey('\\\\nas\\footage\\Day01\\A001'), kind: 'unc' }
  const local = { root: 'D:\\Footage\\Day01', key: 'd:\\footage\\day01', kind: 'local' }
  it('suggested: the company location that holds a network root (the longest), else its share as a new one; nothing for a drive letter', () => {
    expect(suggestedAnswer(unc, LOCATIONS)).toEqual({ unc_path: '\\\\nas\\footage\\Day01', name: 'Day 1 only' })
    expect(suggestedAnswer({ ...unc, root: '\\\\nas\\vfx\\plates', key: '\\\\nas\\vfx\\plates' }, LOCATIONS)).toEqual({ unc_path: '\\\\nas\\vfx', name: 'Vfx' })
    expect(suggestedAnswer(local, LOCATIONS)).toEqual({ unc_path: '', name: '' })
    expect(holdingLocation('\\\\nas\\footage\\Day02', LOCATIONS)).toMatchObject({ id: 'L1' })
    expect(holdingLocation('\\\\other\\x', LOCATIONS)).toBeNull()
  })
  it('an existing location by address: the one NAMED wins, else the longest holder; the root\'s path inside it is the prefix', () => {
    expect(resolveRootAnswer(unc, { unc_path: NAS }, LOCATIONS)).toEqual({ kind: 'existing', location: LOCATIONS[0], prefix: 'Day01/A001' })
    // Typed in another spelling, matched all the same (Postel).
    expect(resolveRootAnswer(unc, { unc_path: 'smb://NAS/Footage/' }, LOCATIONS)).toMatchObject({ kind: 'existing', location: LOCATIONS[0] })
    expect(resolveRootAnswer(unc, { unc_path: '\\\\nas\\footage\\Day01' }, LOCATIONS)).toEqual({ kind: 'existing', location: LOCATIONS[1], prefix: 'A001' })
    // An address that is no location of the company, but holds the root
    // through one: the longest holder (a folder above these clips typed as
    // the share's sub-folder).
    expect(resolveRootAnswer(unc, { unc_path: '\\\\nas\\footage\\Day01\\A001' }, LOCATIONS)).toEqual({ kind: 'existing', location: LOCATIONS[1], prefix: 'A001' })
  })
  it('a new location named now: at the typed address, the name typed or suggested, the prefix from the root', () => {
    expect(resolveRootAnswer(unc, { unc_path: '\\\\nas\\footage\\Day01\\A001', name: 'Card A001' }, [])).toEqual({ kind: 'new', unc_path: '\\\\nas\\footage\\Day01\\A001', name: 'Card A001', prefix: '' })
    expect(resolveRootAnswer(unc, { unc_path: NAS, name: '  ' }, [])).toEqual({ kind: 'new', unc_path: NAS, name: 'Footage', prefix: 'Day01/A001' })
  })
  it('a drive letter or local folder: the typed address IS the folder\'s address on the network; under a company location, it is that location', () => {
    expect(resolveRootAnswer(local, { unc_path: '\\\\nas\\footage\\Day01' }, LOCATIONS)).toEqual({ kind: 'existing', location: LOCATIONS[1], prefix: '' })
    expect(resolveRootAnswer(local, { unc_path: '\\\\nas\\footage\\Day01\\extra' }, LOCATIONS)).toEqual({ kind: 'existing', location: LOCATIONS[1], prefix: 'extra' })
    expect(resolveRootAnswer(local, { unc_path: '\\\\other\\dailies\\Day01' }, LOCATIONS)).toEqual({ kind: 'new', unc_path: '\\\\other\\dailies\\Day01', name: 'Day01', prefix: '' })
  })
  it('left on this computer, unanswered, or an address the cloud refuses — and a network root not inside the typed address', () => {
    expect(resolveRootAnswer(unc, { skip: true }, LOCATIONS)).toEqual({ kind: 'skip' })
    expect(resolveRootAnswer(unc, undefined, LOCATIONS)).toEqual({ kind: 'unanswered' })
    expect(resolveRootAnswer(unc, { unc_path: '   ' }, LOCATIONS)).toEqual({ kind: 'unanswered' })
    expect(resolveRootAnswer(local, { unc_path: 'D:\\Footage' }, LOCATIONS)).toEqual({ kind: 'invalid', problem: ADDRESS_NEEDED })
    expect(resolveRootAnswer(local, { unc_path: '\\\\localhost\\C$\\x' }, LOCATIONS)).toMatchObject({ kind: 'invalid' })
    const r = resolveRootAnswer(unc, { unc_path: '\\\\nas\\sound' }, LOCATIONS)
    expect(r.kind).toBe('invalid')
    expect(r.problem).toBe('\\\\nas\\footage\\Day01\\A001 is not inside \\\\nas\\sound: name the share, or a folder above these clips.')
  })
})

describe('the cloud row', () => {
  const clip = {
    id: 'f1', project_id: 'p1', bin_id: 'b1', source_path: '\\\\nas\\footage\\Day01\\A001\\a.mov', online: true, display_name: 'a', original_name: 'a.mov',
    extension: '.mov', media_type: 'video', shoot_day: '2026-09-24', review_flag: 'select', poster_path: null, tags: ['x'], sort_order: 3,
  }
  it('keeps the id and every column, drops the desktop\'s own (source_path, online), sets the location, the cloud path, the workspace, no picture', () => {
    const { row, error } = cloudBinFileRow(clip, { root: '\\\\nas\\footage\\Day01', locationId: 'L1', prefix: 'Day01', workspaceId: 'ws1' })
    expect(error).toBeUndefined()
    expect(row).toMatchObject({ id: 'f1', bin_id: 'b1', location_id: 'L1', relative_path: 'Day01/A001/a.mov', workspace_id: 'ws1', poster_path: null, display_name: 'a', review_flag: 'select', tags: ['x'], sort_order: 3 })
    expect(row).not.toHaveProperty('source_path')
    expect(row).not.toHaveProperty('online')
  })
  it('a drive-letter root named on the network: the prefix is empty and the path is the clip\'s inside the folder', () => {
    const { row } = cloudBinFileRow({ ...clip, source_path: 'D:\\Footage\\Day01\\A001\\a.mov' }, { root: 'D:\\Footage\\Day01', locationId: 'L9', prefix: '', workspaceId: 'ws1' })
    expect(row.relative_path).toBe('A001/a.mov')
  })
  it('the date goes through dates.js (a stray spelling comes out as the DATE column stores it; garbage as nothing); a blank name takes the file\'s', () => {
    expect(cloudBinFileRow({ ...clip, shoot_day: '2026-9-24' }, { root: NAS, locationId: 'L1', prefix: '', workspaceId: 'ws1' }).row.shoot_day).toBe('2026-09-24')
    expect(cloudBinFileRow({ ...clip, shoot_day: 'last Tuesday' }, { root: NAS, locationId: 'L1', prefix: '', workspaceId: 'ws1' }).row.shoot_day).toBeNull()
    expect(cloudBinFileRow({ ...clip, shoot_day: '2026-09-24' }, { root: NAS, locationId: 'L1', prefix: '', workspaceId: 'ws1' }).row.shoot_day).toBe('2026-09-24')
    expect(cloudBinFileRow({ ...clip, display_name: ' ' }, { root: NAS, locationId: 'L1', prefix: '', workspaceId: 'ws1' }).row.display_name).toBe('a.mov')
  })
  it('a clip outside its root, or a path the cloud refuses, is an error — never a row', () => {
    expect(cloudBinFileRow(clip, { root: '\\\\nas\\sound', locationId: 'L3', prefix: '', workspaceId: 'ws1' }).error).toMatch(/not inside/)
    expect(cloudBinFileRow({ ...clip, source_path: '\\\\nas\\footage\\Day01\\A001.\\a.mov' }, { root: NAS, locationId: 'L1', prefix: '', workspaceId: 'ws1' }).error).toMatch(/not one the cloud takes/)
    expect(cloudBinFileRow({ ...clip, source_path: NAS }, { root: NAS, locationId: 'L1', prefix: '', workspaceId: 'ws1' }).error).toMatch(/the location itself/)
  })
})

describe('bins arrive parents first', () => {
  it('a child never precedes its parent; an orphan comes to the top; a cycle is broken, not looped on', () => {
    const bins = [
      { id: 'c', parent_bin_id: 'b' }, { id: 'a', parent_bin_id: null }, { id: 'b', parent_bin_id: 'a' },
      { id: 'o', parent_bin_id: 'gone' },
    ]
    const order = binsParentsFirst(bins).map(b => [b.id, b.parent_bin_id])
    expect(order.map(x => x[0]).indexOf('a')).toBeLessThan(order.map(x => x[0]).indexOf('b'))
    expect(order.map(x => x[0]).indexOf('b')).toBeLessThan(order.map(x => x[0]).indexOf('c'))
    expect(order.find(x => x[0] === 'o')[1]).toBeNull()
    expect(binsParentsFirst([{ id: 'x', parent_bin_id: 'y' }, { id: 'y', parent_bin_id: 'x' }]).map(b => b.id)).toHaveLength(2)
    // The input is not mutated.
    expect(bins[3].parent_bin_id).toBe('gone')
  })
  it('POSTER_MEDIA: what the desktop can make a picture of', () => {
    expect([...POSTER_MEDIA].sort()).toEqual(['graphic', 'sequence', 'still', 'vfx', 'video'])
  })
})
