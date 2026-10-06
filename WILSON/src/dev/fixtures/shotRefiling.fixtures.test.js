// =============================================================================
// shotRefiling.fixtures.test.js — post-overhaul S4c: the dev fixtures are a
// project from BEFORE S4c (shot folders under SHOTS, two shot files), and the
// fixtures adapter re-files them as the cloud adapter does, in memory.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { createStore, applyGameVariant } from './store'
import { buildDevFixtures } from './install'
import { FOLDERS, FILES, GAME_FOLDERS, GAME_FILES } from './data/files'
import { SHOTS, SCENES } from './data/scenes'
import { PROJECT_ID } from './data/project'
import { pendingShotRefiling } from '../../tools/rabbit_v0.1.0/shotRefiling'

describe('the dataset stands for a project from before S4c', () => {
  it('every shot has a folder under SHOTS, beside the scene folders; two files sit in shot folders', () => {
    expect(FOLDERS.some(f => f.kind === 'category' && f.path === 'SHOTS')).toBe(true)
    const shotFolders = FOLDERS.filter(f => f.shot_id)
    expect(shotFolders).toHaveLength(SHOTS.length)
    for (const f of shotFolders) expect(f.path.startsWith('SHOTS/')).toBe(true)
    const shotFiles = FILES.filter(f => f.shot_id)
    expect(shotFiles.map(f => f.name)).toEqual(['SC01_SH010_plate_v001.exr', 'SC01_SH020_board.png'])
    for (const f of shotFiles) {
      expect(FOLDERS.find(x => x.id === f.folder_id).shot_id).toBe(f.shot_id)
      expect(f.storage_path).toContain('/SHOTS/')
    }
    expect(pendingShotRefiling({ folders: FOLDERS, shots: SHOTS, scenes: SCENES })).toHaveLength(SHOTS.length)
  })
  it('the game variant adds a folder per level and experience under LEVELS and EXPERIENCES, and a file on one of each', () => {
    expect(GAME_FOLDERS.filter(f => f.kind === 'category').map(f => f.path).sort()).toEqual(['EXPERIENCES', 'LEVELS'])
    expect(GAME_FOLDERS.filter(f => f.level_id)).toHaveLength(4)
    expect(GAME_FOLDERS.filter(f => f.experience_id)).toHaveLength(3)
    for (const f of GAME_FOLDERS.filter(f => f.kind === 'entity')) {
      const parent = GAME_FOLDERS.find(x => x.id === f.parent_id)
      expect(parent.path).toBe(f.level_id ? 'LEVELS' : 'EXPERIENCES')
      expect(f.path).toBe(`${parent.path}/${f.slug}`)
    }
    expect(GAME_FILES.map(f => [f.name, !!f.level_id, !!f.experience_id])).toEqual([
      ['Lamp_Room_blockout_v2.png', true, false], ['The_Storm_beat_sheet.pdf', false, true],
    ])
    for (const f of GAME_FILES) expect(GAME_FOLDERS.find(x => x.id === f.folder_id)).toBeTruthy()
    // Ids never collide with the dataset's.
    const ids = new Set([...FOLDERS, ...FILES].map(r => r.id))
    for (const r of [...GAME_FOLDERS, ...GAME_FILES]) expect(ids.has(r.id), r.id).toBe(false)
    const store = applyGameVariant(createStore())
    expect(store.folders.filter(f => f.level_id || f.experience_id)).toHaveLength(7)
    expect(store.files.filter(f => f.level_id || f.experience_id)).toHaveLength(2)
    expect(createStore().files.some(f => f.level_id)).toBe(false)
  })
})

describe('the fixtures adapter re-files like the cloud', () => {
  it('moves every shot folder under its scene, rewrites the files\' keys and pictures, removes the empty SHOTS category; a second run finds nothing', async () => {
    const fx = buildDevFixtures()
    const store = fx.store
    const adapter = fx.rabbitAdapter()
    const progress = []
    const res = await adapter.refileShotFolders(PROJECT_ID, store.projects[0], { onProgress: (p) => progress.push(p.done) })
    expect(res.moved).toHaveLength(SHOTS.length)
    expect(res.left).toEqual([])
    expect(res.removedShotsCategory).toBe(true)
    expect(progress[0]).toBe(0)
    const folders = await adapter.listFolders(PROJECT_ID)
    expect(folders.some(f => f.path === 'SHOTS' || f.path.startsWith('SHOTS/'))).toBe(false)
    for (const shot of SHOTS) {
      const row = folders.find(f => f.shot_id === shot.id)
      const scene = folders.find(f => f.scene_id === shot.scene_id)
      expect(row.parent_id, shot.name).toBe(scene.id)
      expect(row.path.startsWith(`${scene.path}/`)).toBe(true)
    }
    const bundle = await adapter.loadProject(PROJECT_ID)
    const shotFiles = bundle.files.filter(f => f.shot_id)
    expect(shotFiles).toHaveLength(2)
    for (const f of shotFiles) {
      expect(f.storage_path).not.toContain('/SHOTS/')
      expect(f.storage_path).toContain('/SCENES/')
      if (f.thumbnail_url) {
        expect(f.thumbnail_url).toContain('/SCENES/')
        expect((await adapter.thumbnailUrls([f.thumbnail_url])).has(f.thumbnail_url)).toBe(true)
      }
    }
    const again = await adapter.refileShotFolders(PROJECT_ID, store.projects[0])
    expect(again).toEqual({ moved: [], left: [], removedShotsCategory: false })
  })
  it('a new shot gets its folder inside its scene\'s; an existing one keeps its parent on a rename', async () => {
    const fx = buildDevFixtures()
    const store = fx.store
    const adapter = fx.rabbitAdapter()
    const shot = { id: 'shot-new', name: 'Brand new', scene_id: SCENES[0].id }
    const row = await adapter.ensureEntityFolder(PROJECT_ID, store.projects[0], 'shot', shot)
    const scene = store.folders.find(f => f.scene_id === SCENES[0].id)
    expect(row.parent_id).toBe(scene.id)
    expect(row.path).toBe(`${scene.path}/Brand-New`)
    const old = store.folders.find(f => f.shot_id === SHOTS[0].id)
    const kept = await adapter.ensureEntityFolder(PROJECT_ID, store.projects[0], 'shot', { ...SHOTS[0], name: 'Renamed shot' })
    expect(kept.id).toBe(old.id)
    expect(kept.path).toBe('SHOTS/Renamed-Shot')
  })
})
