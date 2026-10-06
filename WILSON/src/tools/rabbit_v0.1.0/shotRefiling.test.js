// =============================================================================
// shotRefiling.test.js — post-overhaul S4c: the pure half of the one-time
// move of shot folders into their scenes' folders, and the nested object key.
// =============================================================================
import { describe, it, expect } from 'vitest'
import {
  pendingShotRefiling, shotsCategoryRow, shotsCategoryEmpty, shotObjectPrefix,
  isLegacyShotKey, nestedShotKey, refilingSentence, SHOTS_PREFIX,
} from './shotRefiling.js'
import { entityFolderPath, planProjectFolders, planEntityFolder, planFullTree, FOLDER_CATEGORIES } from './folderPaths.js'

const PID = 'p1'
const scenes = [
  { id: 'sc1', name: 'Lighthouse, dawn' },
  { id: 'sc2', name: 'Cliff path' },
]
const shots = [
  { id: 'sh1', name: 'The door', scene_id: 'sc1' },
  { id: 'sh2', name: 'The cold lamp', scene_id: 'sc1' },
  { id: 'sh3', name: 'Loose', scene_id: null },          // no scene: stays under SHOTS
  { id: 'sh4', name: 'Orphan scene', scene_id: 'gone' }, // its scene is gone: stays
]
const folders = [
  { id: 'r', kind: 'root', path: '', parent_id: null },
  { id: 'cs', kind: 'category', path: 'SCENES', parent_id: 'r' },
  { id: 'csh', kind: 'category', path: 'SHOTS', parent_id: 'r' },
  { id: 'f-sc1', kind: 'entity', path: 'SCENES/Lighthouse-Dawn', parent_id: 'cs', scene_id: 'sc1', slug: 'Lighthouse-Dawn' },
  { id: 'f-sh2', kind: 'entity', path: 'SHOTS/The-Cold-Lamp', parent_id: 'csh', shot_id: 'sh2', slug: 'The-Cold-Lamp' },
  { id: 'f-sh1', kind: 'entity', path: 'SHOTS/The-Door', parent_id: 'csh', shot_id: 'sh1', slug: 'The-Door' },
  { id: 'f-sh3', kind: 'entity', path: 'SHOTS/Loose', parent_id: 'csh', shot_id: 'sh3', slug: 'Loose' },
  { id: 'f-sh4', kind: 'entity', path: 'SHOTS/Orphan-Scene', parent_id: 'csh', shot_id: 'sh4', slug: 'Orphan-Scene' },
  { id: 'f-sh5', kind: 'entity', path: 'SHOTS/Deleted-Shot', parent_id: 'csh', shot_id: 'sh-gone', slug: 'Deleted-Shot' },
  { id: 'moved', kind: 'entity', path: 'SCENES/Lighthouse-Dawn/Already', parent_id: 'f-sc1', shot_id: 'sh9', slug: 'Already' },
]

describe('the folder plan (folderPaths, S4c)', () => {
  it('a shot in a scene is SCENES/<scene>/<shot>; with no scene it is SHOTS/<shot>', () => {
    expect(entityFolderPath('shot', shots[0], scenes[0])).toBe('SCENES/Lighthouse-Dawn/The-Door')
    expect(entityFolderPath('shot', shots[2], null)).toBe('SHOTS/Loose')
    expect(entityFolderPath('shot', shots[0])).toBe('SHOTS/The-Door')
    expect(entityFolderPath('scene', scenes[0])).toBe('SCENES/Lighthouse-Dawn')
  })
  it('planEntityFolder carries the scene folder as the parent, and the shot under its path', () => {
    const p = planEntityFolder({}, 'shot', shots[0], scenes[0])
    expect(p.category.path).toBe('SCENES')
    expect(p.parent).toMatchObject({ kind: 'entity', entityType: 'scene', path: 'SCENES/Lighthouse-Dawn', parentPath: 'SCENES', scene_id: 'sc1' })
    expect(p.folder).toMatchObject({ kind: 'entity', entityType: 'shot', path: 'SCENES/Lighthouse-Dawn/The-Door', parentPath: 'SCENES/Lighthouse-Dawn', shot_id: 'sh1', slug: 'The-Door' })
    const bare = planEntityFolder({}, 'shot', shots[2], null)
    expect(bare.parent).toBeNull()
    expect(bare.category.path).toBe('SHOTS')
    expect(bare.folder).toMatchObject({ path: 'SHOTS/Loose', parentPath: 'SHOTS' })
  })
  it('SHOTS is lazy: never planned for a project, even with scenes on', () => {
    const paths = planProjectFolders({ scenes_enabled: true, levels_enabled: true, experiences_enabled: true }).map(f => f.path)
    expect(paths).toEqual(['', 'ASSETS', 'SCENES', 'LEVELS', 'EXPERIENCES', 'INVOICES'])
    expect(FOLDER_CATEGORIES.find(c => c.slug === 'SHOTS').lazy).toBe(true)
    expect(FOLDER_CATEGORIES.filter(c => c.lazy).map(c => c.slug)).toEqual(['SHOTS'])
  })
  it('planFullTree nests each shot under its scene, lists the parent first, and keeps SHOTS only for a shot with no scene', () => {
    const plan = planFullTree({ scenes_enabled: true }, { scenes, shots })
    const paths = plan.map(f => f.path)
    expect(paths.indexOf('SCENES/Lighthouse-Dawn')).toBeLessThan(paths.indexOf('SCENES/Lighthouse-Dawn/The-Door'))
    expect(paths).toContain('SCENES/Lighthouse-Dawn/The-Cold-Lamp')
    expect(paths).toContain('SHOTS')
    expect(paths).toContain('SHOTS/Loose')
    expect(paths).toContain('SHOTS/Orphan-Scene')
    expect(paths.filter(p => p === 'SHOTS')).toHaveLength(1)
    // CONTROL: with every shot in a scene, no SHOTS category at all.
    const clean = planFullTree({ scenes_enabled: true }, { scenes, shots: shots.slice(0, 2) }).map(f => f.path)
    expect(clean).not.toContain('SHOTS')
    for (const f of planFullTree({ scenes_enabled: true }, { scenes, shots })) {
      if (f.parentPath) expect(paths.indexOf(f.parentPath), `${f.path}'s parent is planned before it`).toBeLessThan(paths.indexOf(f.path))
    }
  })
})

describe('pendingShotRefiling', () => {
  it('lists the folders under SHOTS whose shot exists and has a scene that exists, in path order, with where each goes', () => {
    const pending = pendingShotRefiling({ folders, shots, scenes })
    expect(pending.map(p => p.folder.id)).toEqual(['f-sh2', 'f-sh1'])
    expect(pending.map(p => p.toPath)).toEqual(['SCENES/Lighthouse-Dawn/The-Cold-Lamp', 'SCENES/Lighthouse-Dawn/The-Door'])
    expect(pending[0].scene.id).toBe('sc1')
    expect(pending[0].sceneFolder.id).toBe('f-sc1')
  })
  it('leaves alone: a shot with no scene, a shot whose scene is gone, a folder whose shot is gone, a folder already moved', () => {
    const ids = pendingShotRefiling({ folders, shots, scenes }).map(p => p.folder.id)
    for (const left of ['f-sh3', 'f-sh4', 'f-sh5', 'moved']) expect(ids).not.toContain(left)
  })
  it('toPath follows the scene\'s ROW where it has one (a row can lag its scene\'s name; the backends write under the row), else the planned path', () => {
    const lagging = folders.map(f => (f.id === 'f-sc1' ? { ...f, path: 'SCENES/Old-Name' } : f))
    expect(pendingShotRefiling({ folders: lagging, shots, scenes }).map(p => p.toPath))
      .toEqual(['SCENES/Old-Name/The-Cold-Lamp', 'SCENES/Old-Name/The-Door'])
    expect(pendingShotRefiling({ folders: folders.filter(f => f.id !== 'f-sc1'), shots, scenes }).map(p => p.toPath))
      .toEqual(['SCENES/Lighthouse-Dawn/The-Cold-Lamp', 'SCENES/Lighthouse-Dawn/The-Door'])
  })
  it('a scene with no folder row yet is still pending (sceneFolder null; the move makes the row)', () => {
    const noSceneRow = folders.filter(f => f.id !== 'f-sc1')
    const pending = pendingShotRefiling({ folders: noSceneRow, shots, scenes })
    expect(pending.map(p => p.folder.id)).toEqual(['f-sh2', 'f-sh1'])
    expect(pending[0].sceneFolder).toBeNull()
  })
  it('tolerates nothing at all', () => {
    expect(pendingShotRefiling({})).toEqual([])
    expect(pendingShotRefiling({ folders: [null, {}], shots: [null], scenes: undefined })).toEqual([])
  })
})

describe('the SHOTS category', () => {
  it('is found by kind and path, and is empty only when no folder sits under SHOTS/', () => {
    expect(shotsCategoryRow(folders).id).toBe('csh')
    expect(shotsCategoryEmpty(folders)).toBe(false)
    const after = folders.filter(f => !f.path.startsWith(SHOTS_PREFIX))
    expect(shotsCategoryEmpty(after)).toBe(true)
    expect(shotsCategoryRow(after.filter(f => f.id !== 'csh'))).toBeNull()
    expect(SHOTS_PREFIX).toBe('SHOTS/')
  })
})

describe('the object key (the bucket)', () => {
  it('nests inside the scene prefix by ids, or keeps the old prefix with no scene; the third segment is never a locked one', () => {
    expect(shotObjectPrefix(PID, 'sc1', 'sh1')).toBe('projects/p1/scenes/sc1/sh1')
    expect(shotObjectPrefix(PID, null, 'sh1')).toBe('projects/p1/shots/sh1')
    for (const k of [shotObjectPrefix(PID, 'sc1', 'sh1'), shotObjectPrefix(PID, null, 'sh1')]) {
      const third = k.split('/')[2]
      expect(['INVOICES', 'FINANCE', 'LEGAL']).not.toContain(third.toUpperCase())
      expect(third).toMatch(/^[a-z]+$/)
    }
  })
  it('rewrites this shot\'s legacy key to the nested one, leaf kept; anything else is null', () => {
    const ctx = { projectId: PID, sceneId: 'sc1', shotId: 'sh1' }
    expect(isLegacyShotKey('projects/p1/shots/sh1/1-plate.exr', ctx)).toBe(true)
    expect(nestedShotKey('projects/p1/shots/sh1/1-plate.exr', ctx)).toBe('projects/p1/scenes/sc1/sh1/1-plate.exr')
    expect(nestedShotKey('projects/p1/shots/sh1/1-plate.exr.jpg', ctx)).toBe('projects/p1/scenes/sc1/sh1/1-plate.exr.jpg')
    // Already nested, another shot's, a bare prefix, another project's, a segment that only starts the same way.
    expect(nestedShotKey('projects/p1/scenes/sc1/sh1/1-plate.exr', ctx)).toBeNull()
    expect(nestedShotKey('projects/p1/shots/sh2/1-plate.exr', ctx)).toBeNull()
    expect(nestedShotKey('projects/p1/shots/sh1/', ctx)).toBeNull()
    expect(nestedShotKey('projects/p2/shots/sh1/1-plate.exr', ctx)).toBeNull()
    expect(nestedShotKey('projects/p1/shots/sh10/1-plate.exr', ctx)).toBeNull()
    expect(nestedShotKey(null, ctx)).toBeNull()
  })
})

describe('the words of the offer', () => {
  it('counts, names up to three folders by their slug, and says how many more', () => {
    const pending = pendingShotRefiling({ folders, shots, scenes })
    expect(refilingSentence(pending)).toBe('2 shot folders still sit under SHOTS: The-Cold-Lamp, The-Door.')
    expect(refilingSentence(pending.slice(0, 1))).toBe('1 shot folder still sits under SHOTS: The-Cold-Lamp.')
    const five = Array.from({ length: 5 }, (_, i) => ({ folder: { slug: `Sh-${i + 1}` }, shot: { name: `Sh ${i + 1}` } }))
    expect(refilingSentence(five)).toBe('5 shot folders still sit under SHOTS: Sh-1, Sh-2, Sh-3 and 2 more.')
    expect(refilingSentence([])).toBe('')
  })
})
