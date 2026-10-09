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
  suggestedAnswer, confirmedAnswers, holdingLocation, resolveRootAnswer, cloudBinFileRow, cloudRowOf, binsParentsFirst, takesToLand, takePairKey,
  notCarriedOf, notCarriedLabel, NOT_CARRIED, POSTER_MEDIA, ADDRESS_NEEDED,
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
  it('compares segment by segment, so a letter whose lower case is two code units (İ) cuts nothing (review round 1)', () => {
    expect(relativeUnder('\\\\nas\\İİ\\Day01\\x.mov', '\\\\nas\\İİ')).toBe('Day01/x.mov')
    expect(relativeUnder('\\\\nas\\İ\\Day01\\x.mov', '\\\\nas\\İ')).toBe('Day01/x.mov')
    expect(isUnder('\\\\nas\\İİ\\Day01', '\\\\nas\\İİ')).toBe(true)
    expect(isUnder('\\\\nas\\İİx\\Day01', '\\\\nas\\İİ')).toBe(false)
    // The child's own spelling is kept.
    expect(relativeUnder('\\\\nas\\footage\\DaY01\\A.MOV', '\\\\NAS\\FOOTAGE')).toBe('DaY01/A.MOV')
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
  it('a sequence folder picked as its own root belongs to the folder above it (its path inside the location cannot be empty)', () => {
    expect(rootOfClip({ source_path: '\\\\nas\\footage\\VFX\\plate_v01', is_sequence: true }, [{ path: '\\\\nas\\footage\\VFX\\plate_v01' }])).toBe('\\\\nas\\footage\\VFX')
    expect(rootOfClip({ source_path: 'D:\\Renders\\shot010', is_sequence: true }, [{ path: 'D:\\Renders\\shot010' }])).toBe('D:\\Renders')
    expect(rootOfClip({ source_path: 'D:\\shot010', is_sequence: true }, [{ path: 'D:\\shot010' }])).toBe('D:\\')
    // CONTROL: a clip inside its root keeps the root.
    expect(rootOfClip({ source_path: 'D:\\Renders\\shot010\\f.exr' }, [{ path: 'D:\\Renders\\shot010' }])).toBe('D:\\Renders\\shot010')
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
  it('suggested: the company location that holds a network root (the longest) is an answer; its share as a NEW one is only a suggestion; nothing for a drive letter', () => {
    expect(suggestedAnswer(unc, LOCATIONS)).toEqual({ unc_path: '\\\\nas\\footage\\Day01', name: 'Day 1 only', confirmed: true })
    expect(suggestedAnswer({ ...unc, root: '\\\\nas\\vfx\\plates', key: '\\\\nas\\vfx\\plates' }, LOCATIONS)).toEqual({ unc_path: '\\\\nas\\vfx', name: 'Vfx', confirmed: false })
    expect(suggestedAnswer(local, LOCATIONS)).toEqual({ unc_path: '', name: '', confirmed: false })
    expect(holdingLocation('\\\\nas\\footage\\Day02', LOCATIONS)).toMatchObject({ id: 'L1' })
    expect(holdingLocation('\\\\other\\x', LOCATIONS)).toBeNull()
  })
  it('confirmedAnswers: a suggestion of a NEW location nobody touched is no answer; a typed address, a confirmed one, "left for now" and an address the company already holds are (review rounds 1 and 2, security)', () => {
    const answers = {
      a: { unc_path: '\\\\nas\\vfx', name: 'Vfx', confirmed: false },
      b: { unc_path: '\\\\nas\\vfx', name: 'Vfx', confirmed: true },
      c: { unc_path: '\\\\nas\\x' },
      d: { skip: true, unc_path: '\\\\nas\\vfx', confirmed: false },
      e: null,
      // Unconfirmed, but inside the company's "Footage NAS": the company's
      // answer, no new location (review round 2: a share a teammate named
      // after the dry run read as answered and was never sent).
      f: { unc_path: 'smb://NAS/Footage/Day02/', name: '', confirmed: false },
      g: { unc_path: 'D:\\Footage', name: '', confirmed: false },
    }
    expect(confirmedAnswers(answers, LOCATIONS)).toEqual({ b: answers.b, c: answers.c, d: answers.d, f: answers.f })
    // CONTROL: with no company list, the held one is a suggestion like any other.
    expect(confirmedAnswers(answers)).toEqual({ b: answers.b, c: answers.c, d: answers.d })
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
  const opts = (over = {}) => ({ root: NAS, locationId: 'L1', prefix: '', workspaceId: 'ws1', projectId: 'p1', ...over })
  it('keeps the id and every column, drops the desktop\'s own (source_path, online, its stamp, the audio columns, who added it), sets the project, the location, the cloud path, the workspace, no picture', () => {
    const { row, error } = cloudBinFileRow({ ...clip, project_id: 'p-claimed', added_by: 'u-forged', created_at: '2026-09-24T10:00:00Z', sample_rate: 48000, channels: 2 }, opts({ root: '\\\\nas\\footage\\Day01', prefix: 'Day01' }))
    expect(error).toBeUndefined()
    expect(row).toMatchObject({ id: 'f1', project_id: 'p1', bin_id: 'b1', location_id: 'L1', relative_path: 'Day01/A001/a.mov', workspace_id: 'ws1', poster_path: null, display_name: 'a', review_flag: 'select', tags: ['x'], sort_order: 3 })
    for (const k of ['source_path', 'online', 'added_by', 'created_at', 'sample_rate', 'channels']) expect(row, k).not.toHaveProperty(k)
  })
  it('a drive-letter root named on the network: the prefix is empty and the path is the clip\'s inside the folder', () => {
    const { row } = cloudBinFileRow({ ...clip, source_path: 'D:\\Footage\\Day01\\A001\\a.mov' }, opts({ root: 'D:\\Footage\\Day01', locationId: 'L9' }))
    expect(row.relative_path).toBe('A001/a.mov')
  })
  it('the date goes through dates.js (a stray spelling comes out as the DATE column stores it; garbage as nothing); a blank name takes the file\'s', () => {
    expect(cloudBinFileRow({ ...clip, shoot_day: '2026-9-24' }, opts()).row.shoot_day).toBe('2026-09-24')
    expect(cloudBinFileRow({ ...clip, shoot_day: 'last Tuesday' }, opts()).row.shoot_day).toBeNull()
    expect(cloudBinFileRow({ ...clip, shoot_day: '2026-09-24' }, opts()).row.shoot_day).toBe('2026-09-24')
    expect(cloudBinFileRow({ ...clip, display_name: ' ' }, opts()).row.display_name).toBe('a.mov')
  })
  it('a clip outside its root, or a path the cloud refuses, is an error — never a row', () => {
    expect(cloudBinFileRow(clip, opts({ root: '\\\\nas\\sound', locationId: 'L3' })).error).toMatch(/not inside/)
    expect(cloudBinFileRow({ ...clip, source_path: '\\\\nas\\footage\\Day01\\A001.\\a.mov' }, opts()).error).toMatch(/not one the cloud takes/)
    expect(cloudBinFileRow({ ...clip, source_path: NAS }, opts()).error).toMatch(/the location itself/)
  })
  it('cloudRowOf: any other desktop row takes the project being migrated, loses who the file says made it, and sends no picture path of this computer', () => {
    expect(cloudRowOf({ id: 'sc1', project_id: 'p-claimed', name: 'x', created_by: 'u-forged', updated_by: 'u-forged', thumbnail_image: 'C:\\Users\\a\\pic.jpg' }, 'p1'))
      .toEqual({ id: 'sc1', project_id: 'p1', name: 'x', thumbnail_image: null })
    expect(cloudRowOf({ id: 'b1', name: 'Footage' }, 'p1')).toEqual({ id: 'b1', project_id: 'p1', name: 'Footage' })
  })
})

describe('the takes that can land', () => {
  const takes = [
    { id: 't3', shot_id: 's1', bin_file_id: 'c3', role: 'alt', position: 2 },
    { id: 't1', shot_id: 's1', bin_file_id: 'c1', role: 'primary', position: 0 },
    { id: 't2', shot_id: 's1', bin_file_id: 'c2', role: 'part', position: 1 },
    { id: 't4', shot_id: 's2', bin_file_id: 'c1', role: 'primary', position: 0 },
    { id: 't5', shot_id: 's9', bin_file_id: 'c1', role: 'primary', position: 0 },
  ]
  it('leaves out a take whose shot or clip did not land; keeps the rest in order with their roles, positions 0..n-1 on a first run', () => {
    const out = takesToLand(takes, new Set(['s1', 's2']), new Set(['c1', 'c2', 'c3']))
    expect(out.map(t => [t.id, t.role, t.position])).toEqual([['t1', 'primary', 0], ['t2', 'part', 1], ['t3', 'alt', 2], ['t4', 'primary', 0]])
  })
  it('a shot whose primary did not land gets NO primary — nothing is promoted in its place (review round 2); a second claimant, or a garbage role, is an alt', () => {
    const out = takesToLand(takes, new Set(['s1']), new Set(['c2', 'c3']))
    expect(out.map(t => [t.id, t.role, t.position])).toEqual([['t2', 'part', 0], ['t3', 'alt', 1]])
    const two = takesToLand([
      { id: 'a', shot_id: 's', bin_file_id: 'x', role: 'primary', position: 1 },
      { id: 'b', shot_id: 's', bin_file_id: 'y', role: 'primary', position: 0 },
      { id: 'c', shot_id: 's', bin_file_id: 'z', role: 'hero', position: 2 },
    ], new Set(['s']), new Set(['x', 'y', 'z']))
    expect(two.map(t => [t.id, t.role])).toEqual([['b', 'primary'], ['a', 'alt'], ['c', 'alt']])
    // The input is not mutated.
    expect(takes[0].position).toBe(2)
  })
  it('against the cloud: a take already there (by id, or by its shot+clip pair) is not landed again; a primary arriving where the shot has one lands as an alt; positions continue after the cloud\'s (review round 2)', () => {
    const cloud = [
      { id: 't2', shot_id: 's1', bin_file_id: 'c2', role: 'primary', position: 0 },
      { id: 'theirs', shot_id: 's1', bin_file_id: 'c3', role: 'alt', position: 1 },
    ]
    const out = takesToLand(takes, new Set(['s1', 's2']), new Set(['c1', 'c2', 'c3']), cloud)
    expect(out.map(t => [t.id, t.role, t.position])).toEqual([['t1', 'alt', 2], ['t4', 'primary', 0]])
    // CONTROL: the cloud holds an alt only for the shot — the bundle's
    // primary is the primary, placed after it.
    const alone = takesToLand(takes, new Set(['s1']), new Set(['c1', 'c2', 'c3']), [{ id: 'theirs', shot_id: 's1', bin_file_id: 'c9', role: 'alt', position: 4 }])
    expect(alone.map(t => [t.id, t.role, t.position])).toEqual([['t1', 'primary', 5], ['t2', 'part', 6], ['t3', 'alt', 7]])
    expect(takePairKey({ shot_id: 's1', bin_file_id: 'c2' })).toBe('s1|c2')
  })
})

describe('what the migration does not carry', () => {
  it('names each non-empty collection the runner leaves on this computer, and the scenes\' and shots\' pictures, in the right number; nothing the runner carries is in the list', () => {
    expect(notCarriedOf({ comments: [{}], budgetLines: [{}, {}], shotLists: [], scenes: [{ thumbnail_image: 'C:\\a.jpg' }, {}], shots: [{ thumbnail_image: 'C:\\b.jpg' }] })).toEqual([
      { key: 'comments', label: 'comment', count: 1 },
      { key: 'budgetLines', label: 'budget lines', count: 2 },
      { key: 'thumbnails', label: 'scene and shot pictures', count: 2 },
    ])
    expect(notCarriedOf({})).toEqual([])
    expect(notCarriedOf(null)).toEqual([])
    expect(notCarriedLabel('taskLinks', 1)).toBe('link on tasks')
    expect(notCarriedLabel('taskLinks', 2)).toBe('links on tasks')
    expect(notCarriedLabel('thumbnails', 1)).toBe('scene and shot picture')
    expect(notCarriedLabel('expenses', 1)).toBe('expense')
    for (const k of ['scenes', 'shots', 'bins', 'binFiles', 'binRoots', 'shotTakes', 'phases', 'assets', 'tasks', 'dependencies', 'files', 'project']) expect(NOT_CARRIED.some(([key]) => key === k), k).toBe(false)
    for (const k of ['comments', 'milestones', 'budgetLines', 'expenses', 'shotLists', 'shotListItems', 'edits', 'folders', 'levels', 'experiences', 'thumbnails']) expect(NOT_CARRIED.some(([key]) => key === k), k).toBe(true)
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
