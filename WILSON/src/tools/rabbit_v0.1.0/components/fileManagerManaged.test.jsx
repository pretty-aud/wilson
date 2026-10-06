/** @vitest-environment jsdom */
// =============================================================================
// fileManagerManaged.test.jsx — post-overhaul S4c: FileManager on the managed
// store (the desktop in Local Server mode) files a copy where the RECORD says
// — the folder_path the managed-files POST answers from the entity's folder
// row — so a shot's file lands in SCENES/<scene>/<shot>/ once re-filed, a
// level's in LEVELS/<slug>/, an experience's in EXPERIENCES/<slug>/; Show in
// explorer and Open folder read the same. A record from before the tree
// (no folder_path) keeps the category + slug it always had. The desktop
// bridge is a fake; nothing touches a disk.
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
const ctx = {}
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => ctx }))
vi.mock('../../../lib/localServerFetch.js', () => ({ localFetch: async () => ({ ok: false }) }))

const { default: FileManager } = await import('./FileManager')

let api
beforeEach(() => {
  api = {
    pickFiles: vi.fn(async () => ['C:\\in\\plate.exr']),
    getFileStats: vi.fn(async () => ({ isFile: true, size: 12 })),
    copyFile: vi.fn(async () => ({ ok: true })),
    readFilesConfig: vi.fn(async () => ({ effectiveRootDir: 'E:\\Studio' })),
    openInExplorer: vi.fn(async () => {}),
    onCopyProgress: () => () => {},
  }
  window.electronAPI = { rabbit: api }
  for (const k of Object.keys(ctx)) delete ctx[k]
  Object.assign(ctx, {
    supportsManagedFiles: true,
    adapterMode: 'local_server',
    project: { id: 'p1', title: 'Salt Hours', folder_root: 'D:\\Projects\\Salt-Hours', folder_slug: 'Salt-Hours' },
    folders: [
      { id: 'f-sc1', path: 'SCENES/Dawn', scene_id: 'sc1' },
      { id: 'f-sh1', path: 'SCENES/Dawn/The-Door', shot_id: 'sh1', parent_id: 'f-sc1' },
      { id: 'f-sh2', path: 'SHOTS/Old-Shot', shot_id: 'sh2' },
      { id: 'f-l1', path: 'LEVELS/Lamp-Room', level_id: 'l1' },
    ],
    addManagedFile: vi.fn(async (rec) => ({ ...rec, id: 'm-new', stored_name: `Salt-Hours_${rec.file_name}_v001${rec.extension}`, folder_path: ctx.__folderPath })),
    refreshManagedFiles: vi.fn(),
  })
})
afterEach(() => { cleanup(); delete window.electronAPI })

const add = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add files' }))
  await waitFor(() => expect(api.copyFile).toHaveBeenCalledTimes(1))
  return api.copyFile.mock.calls[0][0]
}

describe('Add files on the managed store copies into the folder the record names', () => {
  it('a shot in its scene: SCENES/<scene>/<shot>, from the record; the record carries the shot link', async () => {
    ctx.__folderPath = 'SCENES/Dawn/The-Door/'
    render(<FileManager files={[]} shotId="sh1" shotName="The door" projectId="p1" project={ctx.project} />)
    const call = await add()
    expect(call).toEqual({ sourcePath: 'C:\\in\\plate.exr', destDir: 'D:\\Projects\\Salt-Hours\\SCENES\\Dawn\\The-Door', destFileName: 'Salt-Hours_plate_v001.exr' })
    expect(ctx.addManagedFile).toHaveBeenCalledWith(expect.objectContaining({ shot_id: 'sh1', scene_id: null, level_id: null, experience_id: null, original_name: 'plate.exr' }))
  })
  it('a level and an experience: their own folders, their own links — files on them for the first time', async () => {
    ctx.__folderPath = 'LEVELS/Lamp-Room/'
    render(<FileManager files={[]} levelId="l1" levelName="Lamp Room" projectId="p1" project={ctx.project} />)
    expect((await add()).destDir).toBe('D:\\Projects\\Salt-Hours\\LEVELS\\Lamp-Room')
    expect(ctx.addManagedFile).toHaveBeenCalledWith(expect.objectContaining({ level_id: 'l1', shot_id: null, experience_id: null }))
    cleanup(); api.copyFile.mockClear(); ctx.addManagedFile.mockClear()
    ctx.__folderPath = 'EXPERIENCES/The-Storm/'
    render(<FileManager files={[]} experienceId="x1" experienceName="The Storm" projectId="p1" project={ctx.project} />)
    expect((await add()).destDir).toBe('D:\\Projects\\Salt-Hours\\EXPERIENCES\\The-Storm')
    expect(ctx.addManagedFile).toHaveBeenCalledWith(expect.objectContaining({ experience_id: 'x1', level_id: null }))
  })
  it('with no project folder: the root this machine resolves under, the project slug, then the record\'s folder (S34)', async () => {
    ctx.__folderPath = 'SCENES/Dawn/The-Door/'
    const project = { id: 'p1', title: 'Salt Hours' }
    render(<FileManager files={[]} shotId="sh1" shotName="The door" projectId="p1" project={project} />)
    expect((await add()).destDir).toBe('E:\\Studio\\Salt-Hours\\SCENES\\Dawn\\The-Door')
  })
  it('CONTROL: a record with no folder_path (from before the tree) falls back to the entity\'s folder row, else the category and slug', async () => {
    ctx.__folderPath = undefined
    render(<FileManager files={[]} shotId="sh2" shotName="Old shot" projectId="p1" project={ctx.project} />)
    expect((await add()).destDir).toBe('D:\\Projects\\Salt-Hours\\SHOTS\\Old-Shot')
    cleanup(); api.copyFile.mockClear()
    render(<FileManager files={[]} shotId="sh-none" shotName="No row" projectId="p1" project={ctx.project} />)
    expect((await add()).destDir).toBe('D:\\Projects\\Salt-Hours\\SHOTS\\No-Row')
  })
})

describe('Show in explorer and Open folder read the same place', () => {
  it('the copy goes where the RECORD says even when the entity\'s row says elsewhere (the server files the record; a row can lag)', async () => {
    ctx.__folderPath = 'SHOTS/The-Door/'
    render(<FileManager files={[]} shotId="sh1" shotName="The door" projectId="p1" project={ctx.project} />)
    expect((await add()).destDir).toBe('D:\\Projects\\Salt-Hours\\SHOTS\\The-Door')
  })
  it('a record whose folder_path is not its entity row\'s (from before the move) is shown where IT is; the folder button opens the row\'s folder', async () => {
    const files = [{ id: 'm1', shot_id: 'sh1', file_name: 'plate', stored_name: 'Salt-Hours_plate_v001.exr', folder_path: 'SHOTS/The-Door/', size_bytes: 1, uploaded_at: '2026-10-01T00:00:00Z', version_label: 'v001' }]
    render(<FileManager files={files} shotId="sh1" shotName="The door" projectId="p1" project={ctx.project} />)
    fireEvent.click(screen.getByTitle('Show Salt-Hours_plate_v001.exr in explorer'))
    await waitFor(() => expect(api.openInExplorer).toHaveBeenCalledWith({ filePath: 'D:\\Projects\\Salt-Hours\\SHOTS\\The-Door\\Salt-Hours_plate_v001.exr' }))
    fireEvent.click(screen.getByTitle('Open folder in explorer'))
    await waitFor(() => expect(api.openInExplorer).toHaveBeenLastCalledWith({ filePath: 'D:\\Projects\\Salt-Hours\\SCENES\\Dawn\\The-Door' }))
  })
  it('a record\'s own folder_path; the entity\'s folder row for the folder button', async () => {
    const files = [{ id: 'm1', shot_id: 'sh1', file_name: 'plate', stored_name: 'Salt-Hours_plate_v001.exr', folder_path: 'SCENES/Dawn/The-Door/', size_bytes: 1, uploaded_at: '2026-10-01T00:00:00Z', version_label: 'v001' }]
    render(<FileManager files={files} shotId="sh1" shotName="The door" projectId="p1" project={ctx.project} />)
    fireEvent.click(screen.getByTitle('Show Salt-Hours_plate_v001.exr in explorer'))
    await waitFor(() => expect(api.openInExplorer).toHaveBeenCalledWith({ filePath: 'D:\\Projects\\Salt-Hours\\SCENES\\Dawn\\The-Door\\Salt-Hours_plate_v001.exr' }))
    fireEvent.click(screen.getByTitle('Open folder in explorer'))
    await waitFor(() => expect(api.openInExplorer).toHaveBeenLastCalledWith({ filePath: 'D:\\Projects\\Salt-Hours\\SCENES\\Dawn\\The-Door' }))
  })
  it('the list filters a level\'s and an experience\'s files by their own link', () => {
    const files = [
      { id: 'a', level_id: 'l1', stored_name: 'a.png', size_bytes: 1, uploaded_at: '2026-10-01T00:00:00Z' },
      { id: 'b', experience_id: 'x1', stored_name: 'b.png', size_bytes: 1, uploaded_at: '2026-10-01T00:00:00Z' },
      { id: 'c', shot_id: 'sh1', stored_name: 'c.png', size_bytes: 1, uploaded_at: '2026-10-01T00:00:00Z' },
    ]
    render(<FileManager files={files} levelId="l1" levelName="Lamp Room" projectId="p1" project={ctx.project} />)
    expect([...document.querySelectorAll('.rb-fm-name')].map(n => n.textContent)).toEqual(['a.png'])
    cleanup()
    render(<FileManager files={files} experienceId="x1" experienceName="The Storm" projectId="p1" project={ctx.project} />)
    expect([...document.querySelectorAll('.rb-fm-name')].map(n => n.textContent)).toEqual(['b.png'])
  })
})
