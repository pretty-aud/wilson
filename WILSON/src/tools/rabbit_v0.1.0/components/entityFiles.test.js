// =============================================================================
// entityFiles.test.js — post-overhaul S4c: files picked on a level's or an
// experience's CREATE form are added to the row once it exists, by the store
// in use. CONTROLs: the managed path never runs on the cloud (and the other
// way round), a failed file never stops the next, nothing is added to a row
// that was not made.
// =============================================================================
import { describe, it, expect, vi } from 'vitest'
import { addFilesToEntity, entityScope } from './entityFiles.js'

const fileA = { name: 'a.png', size: 3 }
const fileB = { name: 'b.pdf', size: 4 }

describe('entityScope', () => {
  it('names the scope uploadFile and the managed record take', () => {
    expect(entityScope('level', 'l1')).toEqual({ levelId: 'l1' })
    expect(entityScope('experience', 'x1')).toEqual({ experienceId: 'x1' })
    expect(entityScope('scene', 's1')).toEqual({ sceneId: 's1' })
    expect(entityScope('shot', 'h1')).toEqual({ shotId: 'h1' })
    expect(entityScope('asset', 'a1')).toEqual({ assetId: 'a1' })
    expect(entityScope('task', 't1')).toEqual({})
  })
})

describe('the cloud store (supportsManagedFiles false)', () => {
  it('uploads each picked File with the entity scope, in order', async () => {
    const uploadFile = vi.fn(async () => ({ id: 'row' }))
    const ctx = { supportsManagedFiles: false, uploadFile, addManagedFile: vi.fn() }
    const out = await addFilesToEntity({ ctx, entityType: 'level', entity: { id: 'l1', name: 'Lamp Room' }, picked: [{ name: 'a.png', file: fileA }, { name: 'b.pdf', file: fileB }], api: null })
    expect(out).toEqual({ added: 2, failed: [] })
    expect(uploadFile.mock.calls).toEqual([[fileA, { levelId: 'l1' }], [fileB, { levelId: 'l1' }]])
    expect(ctx.addManagedFile).not.toHaveBeenCalled()
  })
  it('an experience files under experienceId; a refusal names the file and the next one still goes', async () => {
    const uploadFile = vi.fn(async (f) => { if (f === fileA) throw new Error('quota') ; return { id: 'r' } })
    const ctx = { supportsManagedFiles: false, uploadFile }
    const out = await addFilesToEntity({ ctx, entityType: 'experience', entity: { id: 'x1' }, picked: [{ name: 'a.png', file: fileA }, { name: 'b.pdf', file: fileB }], api: null })
    expect(out.added).toBe(1)
    expect(out.failed).toEqual(['a.png: quota'])
    expect(uploadFile.mock.calls[1]).toEqual([fileB, { experienceId: 'x1' }])
  })
  it('a pick with no bytes (a desktop path on the cloud) is a named failure, not a crash', async () => {
    const ctx = { supportsManagedFiles: false, uploadFile: vi.fn() }
    const out = await addFilesToEntity({ ctx, entityType: 'level', entity: { id: 'l1' }, picked: [{ name: 'c.mov', path: 'C:\\x\\c.mov' }], api: null })
    expect(out.failed).toEqual(['c.mov: no file bytes to upload'])
    expect(ctx.uploadFile).not.toHaveBeenCalled()
  })
})

describe('the managed store (the desktop in Local Server mode)', () => {
  function desktop({ root = 'D:/Root' } = {}) {
    return {
      getFileStats: vi.fn(async ({ filePath }) => ({ isFile: !filePath.endsWith('dir'), size: 10 })),
      readFilesConfig: vi.fn(async () => ({ effectiveRootDir: root })),
      copyFile: vi.fn(async () => ({ ok: true })),
      pickFiles: vi.fn(),
    }
  }
  it('makes the record (the server answers folder_path), then copies into THAT folder under the project folder', async () => {
    const api = desktop()
    const addManagedFile = vi.fn(async (rec) => ({ ...rec, id: 'm1', stored_name: `Salt_${rec.file_name}_v001${rec.extension}`, folder_path: 'LEVELS/Lamp-Room/' }))
    const ctx = { supportsManagedFiles: true, addManagedFile, uploadFile: vi.fn(), project: { id: 'p1', title: 'Salt Hours', folder_root: 'D:\\Projects\\Salt-Hours' } }
    const out = await addFilesToEntity({ ctx, entityType: 'level', entity: { id: 'l1', name: 'Lamp Room' }, picked: [{ name: 'blockout.png', path: 'C:\\in\\blockout.png' }], api })
    expect(out).toEqual({ added: 1, failed: [] })
    expect(addManagedFile).toHaveBeenCalledWith(expect.objectContaining({ level_id: 'l1', file_name: 'blockout', original_name: 'blockout.png', extension: '.png', size_bytes: 10 }))
    expect(api.copyFile).toHaveBeenCalledWith({ sourcePath: 'C:\\in\\blockout.png', destDir: 'D:\\Projects\\Salt-Hours\\LEVELS\\Lamp-Room', destFileName: 'Salt_blockout_v001.png' })
    expect(ctx.uploadFile).not.toHaveBeenCalled()
  })
  it('with no project folder set, the root this machine resolves under, then the project slug (S34)', async () => {
    const api = desktop({ root: 'E:\\Studio' })
    const addManagedFile = vi.fn(async (rec) => ({ ...rec, id: 'm2', stored_name: 'x_v001.pdf', folder_path: 'EXPERIENCES/The-Storm/' }))
    const ctx = { supportsManagedFiles: true, addManagedFile, project: { id: 'p1', title: 'Salt Hours' } }
    await addFilesToEntity({ ctx, entityType: 'experience', entity: { id: 'x1', name: 'The Storm' }, picked: [{ name: 'beats.pdf', path: '/in/beats.pdf' }], api })
    expect(addManagedFile).toHaveBeenCalledWith(expect.objectContaining({ experience_id: 'x1' }))
    expect(api.copyFile.mock.calls[0][0].destDir).toBe('E:\\Studio\\Salt-Hours\\EXPERIENCES\\The-Storm')
  })
  it('CONTROL: a record with no folder_path is refused before any copy; a non-file is refused; a File with no path is refused', async () => {
    const api = desktop()
    const addManagedFile = vi.fn(async (rec) => ({ ...rec, id: 'm3', stored_name: 'x' }))
    const ctx = { supportsManagedFiles: true, addManagedFile, project: { id: 'p1', folder_root: 'D:\\P' } }
    const out = await addFilesToEntity({ ctx, entityType: 'level', entity: { id: 'l1' }, picked: [
      { name: 'a.png', path: 'C:\\a.png' }, { name: 'dir', path: 'C:\\dir' }, { name: 'web.png', file: fileA },
    ], api })
    expect(out.added).toBe(0)
    expect(out.failed).toEqual(['a.png: the record names no folder', 'dir: not a file', 'web.png: no path on this computer'])
    expect(api.copyFile).not.toHaveBeenCalled()
  })
  it('nothing happens with no row, no picks, or no context', async () => {
    const api = desktop()
    const ctx = { supportsManagedFiles: true, addManagedFile: vi.fn(), uploadFile: vi.fn() }
    expect(await addFilesToEntity({ ctx, entityType: 'level', entity: null, picked: [{ name: 'a', path: 'C:\\a' }], api })).toEqual({ added: 0, failed: [] })
    expect(await addFilesToEntity({ ctx, entityType: 'level', entity: { id: 'l1' }, picked: [], api })).toEqual({ added: 0, failed: [] })
    expect(await addFilesToEntity({ ctx: null, entityType: 'level', entity: { id: 'l1' }, picked: [{ name: 'a', path: 'C:\\a' }], api })).toEqual({ added: 0, failed: [] })
    expect(ctx.addManagedFile).not.toHaveBeenCalled()
  })
})
