// mothFileOps.test.js — MO1 (MOTH_DESIGN §1.10): what Move to, Delete and Undo do, against fakes of the adapter and
// the desktop. A step here that writes first and asks after is a file with no body or a row with no file.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMothFileOps } from './mothFileOps.js'
import { createMothHistory, HISTORY_CAP } from './mothHistory.js'
import { DESKTOP_ACTION_SENTENCE } from '../../rabbit_v0.1.0/storage/desktopFileOps.js'

const file = (id, extra = {}) => ({ id, name: `${id}.mov`, storage_path: `p/${id}.mov`, storage_provider: 'supabase', ...extra })

let adapter, catalogue, ops, history, changed, fileOps, calls

function make(extra = {}) {
  calls = []
  const note = (name, value) => vi.fn(async (...args) => { calls.push(name); return typeof value === 'function' ? value(...args) : value })
  adapter = {
    planFileMove: note('plan', { items: [] }),
    moveFiles: note('commit', { move_id: 'm1', moved: 1, ops: [] }),
    planUndoFileMove: note('planUndo', { items: [] }),
    undoFileMove: note('undo', { move_id: 'm2', ops: [] }),
    copyBodyForMove: note('copy', (f, i) => ({ file_id: f.id, path: i.to_path, thumbnail: null })),
    removeMoveCopy: note('uncopy'),
    trashFiles: note('trash', { done: 1, ops: [] }),
    restoreFiles: note('restore', { done: 1, ops: [] }),
    settleNetworkShareOps: note('settle'),
    ...extra,
  }
  catalogue = { runNasOp: note('rename', { done: [], notMoved: [] }) }
  ops = { available: () => true, put: note('put', {}), retireLocalMedia: note('retire', {}) }
  history = createMothHistory()
  changed = []
  fileOps = createMothFileOps({ adapter, catalogue, ops, history, onChanged: (p) => changed.push(p) })
}

beforeEach(() => make())

describe('a move in the cloud', () => {
  it('by association: plan, commit, and Files is told both projects', async () => {
    await fileOps.moveFiles([file('a')], 'p1', 'p2', 'f1')
    expect(calls).toEqual(['plan', 'commit'])
    expect(adapter.moveFiles).toHaveBeenCalledWith(['a'], 'p2', 'f1', null)
    expect(changed).toEqual([['p1', 'p2']])
    expect(history.canUndo()).toBe(true)
  })
  it('a rehome is copied before the commit, and the commit carries the copy', async () => {
    make({ planFileMove: vi.fn(async () => ({ items: [{ id: 'a', how: 'rehome', to_provider: 'supabase', to_path: 'new/a.mov' }] })) })
    await fileOps.moveFiles([file('a')], 'p1', 'p2')
    expect(calls).toEqual(['copy', 'commit'])
    expect(adapter.moveFiles.mock.calls[0][3]).toEqual([{ file_id: 'a', path: 'new/a.mov', thumbnail: null }])
  })
  it('🚨 a refused commit removes the copy, and the file stays where it was', async () => {
    make({
      planFileMove: vi.fn(async () => ({ items: [{ id: 'a', how: 'rehome', to_provider: 'supabase', to_path: 'new/a.mov' }] })),
      moveFiles: vi.fn(async () => { throw new Error('A file with this name is already there.') }),
    })
    await expect(fileOps.moveFiles([file('a')], 'p1', 'p2')).rejects.toThrow('already there')
    expect(calls).toEqual(['copy', 'uncopy'])
    expect(history.canUndo()).toBe(false)
    expect(changed).toEqual([])
  })
  it('a copy-up retires the local original once it has landed', async () => {
    make({ planFileMove: vi.fn(async () => ({ items: [{ id: 'a', how: 'copy_up', to_provider: 'supabase', to_path: 'new/a.mov' }] })) })
    await fileOps.moveFiles([file('a', { storage_provider: 'local_server', storage_path: 'projects/p/x/y/a.mov' })], 'p1', 'p2')
    expect(ops.retireLocalMedia).toHaveBeenCalledWith('projects/p/x/y/a.mov', 'm1')
  })
})

describe('on the office server', () => {
  const planShare = vi.fn(async () => ({ items: [{ id: 'a', how: 'share_move', from: 'Salt/a.mov', to_path: 'Moon/a.mov', to_provider: 'network_share' }] }))
  it('🚨 a browser is refused from the plan, before anything is written', async () => {
    make({ planFileMove: planShare })
    ops.available = () => false
    await expect(fileOps.moveFiles([file('a', { storage_provider: 'network_share' })], 'p1', 'p2')).rejects.toThrow(DESKTOP_ACTION_SENTENCE)
    expect(adapter.moveFiles).not.toHaveBeenCalled()
  })
  it('commits first, then renames', async () => {
    make({ planFileMove: planShare, moveFiles: vi.fn(async () => { calls.push('commit'); return { move_id: 'm1', ops: [{ op_id: 'o1', id: 'a', from: 'Salt/a.mov', to: 'Moon/a.mov' }] } }) })
    await fileOps.moveFiles([file('a', { storage_provider: 'network_share' })], 'p1', 'p2')
    expect(calls).toEqual(['commit', 'rename'])
  })
  it('a rename that fails is told, and is not counted as moved', async () => {
    make({ planFileMove: planShare, moveFiles: vi.fn(async () => ({ move_id: 'm1', ops: [{ op_id: 'o1', id: 'a', from: 'x', to: 'y' }] })) })
    catalogue.runNasOp = vi.fn(async () => ({ done: [], notMoved: [{ op_id: 'o1', code: 'name_taken' }] }))
    await expect(fileOps.moveFiles([file('a', { storage_provider: 'network_share' })], 'p1', 'p2')).rejects.toThrow('already in that folder')
    expect(history.canUndo()).toBe(false)
  })
  it('a copy-up copies, settles done, and a failed copy settles not_moved', async () => {
    make({
      planFileMove: vi.fn(async () => ({ items: [{ id: 'a', how: 'copy_up', to_provider: 'network_share', to_path: 'nas:Moon/a.mov' }] })),
      moveFiles: vi.fn(async () => ({ move_id: 'm1', ops: [{ op_id: 'o1', id: 'a', to: 'Moon/a.mov' }] })),
    })
    const local = file('a', { storage_provider: 'local_server', storage_path: 'projects/p/x/y/a.mov' })
    await fileOps.moveFiles([local], 'p1', 'p2')
    expect(ops.put).toHaveBeenCalledWith('Moon/a.mov', { media_key: 'projects/p/x/y/a.mov' })
    expect(adapter.settleNetworkShareOps).toHaveBeenCalledWith(['o1'], 'done')
    ops.put = vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'name_taken' }) })
    await expect(fileOps.moveFiles([local], 'p1', 'p2')).rejects.toThrow('already in that folder')
    expect(adapter.settleNetworkShareOps).toHaveBeenLastCalledWith(['o1'], 'not_moved')
  })
})

describe('undo and redo', () => {
  it('a move undoes, and its undo redoes', async () => {
    await fileOps.moveFiles([file('a')], 'p1', 'p2')
    await history.undo()
    expect(adapter.undoFileMove).toHaveBeenCalledWith('m1')
    expect(history.canRedo()).toBe(true)
    await history.redo()
    expect(adapter.undoFileMove).toHaveBeenLastCalledWith('m2')
    expect(history.canUndo()).toBe(true)
  })
  it('a refused undo leaves the step gone and says why', async () => {
    make({ undoFileMove: vi.fn(async () => { throw new Error('This file has changed since that move, so it cannot be undone.') }) })
    await fileOps.moveFiles([file('a')], 'p1', 'p2')
    await expect(history.undo()).rejects.toThrow('changed since')
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(false)
  })
  it('a delete undoes through a restore', async () => {
    await fileOps.trashFiles([file('a')], 'p1')
    await history.undo()
    expect(adapter.restoreFiles).toHaveBeenCalledWith(['a'], 'p1')
    await history.redo()
    expect(adapter.trashFiles).toHaveBeenCalledTimes(2)
  })
  it(`keeps ${HISTORY_CAP} each way, and a new step ends the redo`, async () => {
    for (let i = 0; i < HISTORY_CAP + 3; i += 1) history.push({ label: String(i), run: async () => null })
    let undone = 0
    while (history.canUndo()) { await history.undo(); undone += 1 }
    expect(undone).toBe(HISTORY_CAP)
    history.push({ label: 'x', run: async () => ({ label: 'y', run: async () => null }) })
    await history.undo()
    expect(history.canRedo()).toBe(true)
    history.push({ label: 'z', run: async () => null })
    expect(history.canRedo()).toBe(false)
  })
  it('clear empties both ways', async () => {
    await fileOps.trashFiles([file('a')], 'p1')
    history.clear()
    expect(history.canUndo()).toBe(false)
  })
})

describe('delete', () => {
  it('🚨 an office-server file is refused in a browser before the server is asked', async () => {
    ops.available = () => false
    await expect(fileOps.trashFiles([file('a', { storage_provider: 'network_share' })], 'p1')).rejects.toThrow(DESKTOP_ACTION_SENTENCE)
    expect(adapter.trashFiles).not.toHaveBeenCalled()
  })
  it('its renames run after the server has answered', async () => {
    make({ trashFiles: vi.fn(async () => { calls.push('trash'); return { done: 1, ops: [{ op_id: 'o', from: 'a', to: 'b' }] } }) })
    await fileOps.trashFiles([file('a', { storage_provider: 'network_share' })], 'p1')
    expect(calls).toEqual(['trash', 'rename'])
    expect(catalogue.runNasOp).toHaveBeenCalledWith([{ op_id: 'o', from: 'a', to: 'b' }], { kind: 'trash' })
  })
})

describe('a desktop-only project', () => {
  beforeEach(() => {
    make()
    delete adapter.planFileMove
    adapter.moveFilesBetweenProjects = vi.fn(async () => ({ moved: 1 }))
    adapter.moveFilesInProject = vi.fn(async () => ({ moved: 1 }))
    fileOps = createMothFileOps({ adapter, catalogue, ops, history, onChanged: () => {} })
  })
  it('between projects, through its own route, and back', async () => {
    await fileOps.moveFiles([file('a')], 'p1', 'p2', 'f1')
    expect(adapter.moveFilesBetweenProjects).toHaveBeenCalledWith(['a'], 'p1', 'p2', 'f1')
    await history.undo()
    expect(adapter.moveFilesBetweenProjects).toHaveBeenLastCalledWith(['a'], 'p2', 'p1', null)
    await history.redo()
    expect(adapter.moveFilesBetweenProjects).toHaveBeenLastCalledWith(['a'], 'p1', 'p2', 'f1')
  })
  it('within a project, each file back to the folder it came from', async () => {
    await fileOps.moveFiles([file('a', { folder_id: 'x' }), file('b', { folder_id: 'y' })], 'p1', 'p1', 'f1')
    expect(adapter.moveFilesInProject).toHaveBeenCalledWith(['a', 'b'], 'p1', 'f1')
    await history.undo()
    expect(adapter.moveFilesInProject).toHaveBeenCalledWith(['a'], 'p1', 'x')
    expect(adapter.moveFilesInProject).toHaveBeenCalledWith(['b'], 'p1', 'y')
  })
})
