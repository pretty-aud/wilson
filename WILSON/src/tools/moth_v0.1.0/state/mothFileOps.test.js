// mothFileOps.test.js — MO1 (MOTH_DESIGN §1.10): what Move to, Delete and Undo do, against fakes of the adapter and
// the desktop. A step here that writes first and asks after is a file with no body or a row with no file.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMothFileOps } from './mothFileOps.js'
import { createMothHistory, HISTORY_CAP } from './mothHistory.js'
import { DESKTOP_ACTION_SENTENCE } from '../../rabbit_v0.1.0/storage/desktopFileOps.js'

const file = (id, extra = {}) => ({ id, name: `${id}.mov`, storage_path: `p/${id}.mov`, storage_provider: 'supabase', ...extra })

let adapter, catalogue, ops, history, changed, fileOps, calls, notes

function make(extra = {}) {
  calls = []
  const note = (name, value) => vi.fn(async (...args) => { calls.push(name); return typeof value === 'function' ? value(...args) : value })
  adapter = {
    planFileMove: note('plan', { items: [] }),
    moveFiles: note('commit', { move_id: 'm1', moved: 1, ops: [] }),
    planUndoFileMove: note('planUndo', { items: [] }),
    undoFileMove: note('undo', { move_id: 'm2', ops: [] }),
    copyBodyForMove: note('copy', (f, i) => ({ file_id: f.id, to_provider: i.to_provider, path: i.to_path, thumbnail: null })),
    removeMoveCopy: note('uncopy'),
    trashFiles: note('trash', { done: 1, ops: [] }),
    restoreFiles: note('restore', { done: 1, ops: [] }),
    settleNetworkShareOps: note('settle'),
    ...extra,
  }
  catalogue = { runNasOp: note('rename', { done: [], notMoved: [], left: [] }), runCopyUp: note('put', { ok: true }) }
  ops = { available: () => true, reachable: note('reachable', { ok: true }), retireLocalMedia: note('retire', {}) }
  history = createMothHistory()
  changed = []
  notes = []
  fileOps = createMothFileOps({ adapter, catalogue, ops, history, onChanged: (p) => changed.push(p), onNote: (n) => notes.push(n) })
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
    expect(adapter.moveFiles.mock.calls[0][3]).toEqual([{ file_id: 'a', to_provider: 'supabase', path: 'new/a.mov', thumbnail: null }])
  })
  it('🚨 a refused commit removes the copy, and the file stays where it was', async () => {
    make({
      planFileMove: vi.fn(async () => ({ items: [{ id: 'a', how: 'rehome', to_provider: 'supabase', to_path: 'new/a.mov' }] })),
      moveFiles: vi.fn(async () => { throw Object.assign(new Error('A file with this name is already there.'), { code: 'name_taken' }) }),
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
  it('asks whether the server is there, commits, then renames', async () => {
    make({ planFileMove: planShare, moveFiles: vi.fn(async () => { calls.push('commit'); return { move_id: 'm1', ops: [{ op_id: 'o1', id: 'a', from: 'Salt/a.mov', to: 'Moon/a.mov' }] } }) })
    await fileOps.moveFiles([file('a', { storage_provider: 'network_share' })], 'p1', 'p2')
    expect(calls).toEqual(['reachable', 'commit', 'rename'])
  })
  it('🚨 a server that is off is said before anything is written', async () => {
    make({ planFileMove: planShare })
    ops.reachable = vi.fn(async () => { throw Object.assign(new Error('The office server cannot be reached from this computer.'), { code: 'unreachable' }) })
    await expect(fileOps.moveFiles([file('a', { storage_provider: 'network_share' })], 'p1', 'p2')).rejects.toThrow('cannot be reached')
    expect(adapter.moveFiles).not.toHaveBeenCalled()
    await expect(fileOps.trashFiles([file('a', { storage_provider: 'network_share' })], 'p1')).rejects.toThrow('cannot be reached')
    expect(adapter.trashFiles).not.toHaveBeenCalled()
    await expect(fileOps.restoreFiles([file('a', { storage_provider: 'network_share' })], 'p1')).rejects.toThrow('cannot be reached')
    expect(adapter.restoreFiles).not.toHaveBeenCalled()
  })
  it('🚨 a folder change inside a project is refused: WILSON would say it moved, and the server would not', async () => {
    make({ planFileMove: vi.fn(async () => ({ items: [{ id: 'a', how: 'metadata' }] })) })
    await expect(fileOps.moveFiles([file('a', { storage_provider: 'network_share' })], 'p1', 'p1', 'f1')).rejects.toThrow('on the server itself')
    expect(adapter.moveFiles).not.toHaveBeenCalled()
  })
  it('CONTROL: a project change with no copy, on the same provider, is not that', async () => {
    make({ planFileMove: vi.fn(async () => ({ items: [{ id: 'a', how: 'metadata' }] })) })
    await fileOps.moveFiles([file('a')], 'p1', 'p1', 'f1')
    expect(adapter.moveFiles).toHaveBeenCalled()
  })
  it('a rename carries the size it expects, for a repeat to compare', async () => {
    make({ planFileMove: planShare, moveFiles: vi.fn(async () => ({ move_id: 'm1', ops: [{ op_id: 'o1', id: 'a', from: 'Salt/a.mov', to: 'Moon/a.mov' }] })) })
    await fileOps.moveFiles([file('a', { storage_provider: 'network_share', size_bytes: 7 })], 'p1', 'p2')
    expect(catalogue.runNasOp.mock.calls[0][0][0].size).toBe(7)
  })
  it('🚨 a rename the server has not answered is left to finish, and says so: told, no undo step', async () => {
    make({ planFileMove: planShare, moveFiles: vi.fn(async () => ({ move_id: 'm1', ops: [{ op_id: 'o1', id: 'a', from: 'x', to: 'y' }] })) })
    catalogue.runNasOp = vi.fn(async () => ({ done: [], notMoved: [], left: [{ op_id: 'o1', code: 'failed' }] }))
    await expect(fileOps.moveFiles([file('a', { storage_provider: 'network_share' })], 'p1', 'p2')).rejects.toThrow('will finish')
    expect(history.canUndo()).toBe(false)
    expect(changed).toEqual([['p1', 'p2']])
  })
  it('🚨 part of a batch moved: it says how many, tells Files, and offers no undo the server would refuse', async () => {
    const two = vi.fn(async () => ({ items: [
      { id: 'a', how: 'share_move', from: 'Salt/a.mov', to_path: 'Moon/a.mov', to_provider: 'network_share' },
      { id: 'b', how: 'share_move', from: 'Salt/b.mov', to_path: 'Moon/b.mov', to_provider: 'network_share' },
    ] }))
    make({ planFileMove: two, moveFiles: vi.fn(async () => ({ move_id: 'm1', ops: [{ op_id: 'o1', id: 'a', from: 'x', to: 'y' }, { op_id: 'o2', id: 'b', from: 'x2', to: 'y2' }] })) })
    catalogue.runNasOp = vi.fn(async () => ({ done: [{ op_id: 'o1', id: 'a' }], notMoved: [{ op_id: 'o2', id: 'b', code: 'name_taken' }], left: [] }))
    const files = [file('a', { storage_provider: 'network_share' }), file('b', { storage_provider: 'network_share' })]
    await expect(fileOps.moveFiles(files, 'p1', 'p2')).rejects.toThrow('Moved 1 of 2')
    expect(changed).toEqual([['p1', 'p2']])
    expect(history.canUndo()).toBe(false)
  })
  it('🚨 part of a delete went: the undo step is for what went, and Files is told', async () => {
    make({ trashFiles: vi.fn(async () => ({ done: 2, ops: [{ op_id: 'o1', id: 'a', from: 'x', to: 'y' }, { op_id: 'o2', id: 'b', from: 'x2', to: 'y2' }] })) })
    catalogue.runNasOp = vi.fn(async () => ({ done: [{ op_id: 'o1', id: 'a' }], notMoved: [{ op_id: 'o2', id: 'b', code: 'in_use' }], left: [] }))
    const files = [file('a', { storage_provider: 'network_share' }), file('b', { storage_provider: 'network_share' })]
    await expect(fileOps.trashFiles(files, 'p1')).rejects.toThrow('1 of 2')
    expect(changed).toEqual([['p1']])
    expect(history.canUndo()).toBe(true)
    await history.undo()
    expect(adapter.restoreFiles).toHaveBeenCalledWith(['a'], 'p1')
  })
  it('a rename that fails is told, and is not counted as moved', async () => {
    make({ planFileMove: planShare, moveFiles: vi.fn(async () => ({ move_id: 'm1', ops: [{ op_id: 'o1', id: 'a', from: 'x', to: 'y' }] })) })
    catalogue.runNasOp = vi.fn(async () => ({ done: [], notMoved: [{ op_id: 'o1', code: 'name_taken' }] }))
    await expect(fileOps.moveFiles([file('a', { storage_provider: 'network_share' })], 'p1', 'p2')).rejects.toThrow('already in that folder')
    expect(history.canUndo()).toBe(false)
  })
  it('a copy-up goes through the catalogue with its media key, and only one that landed retires the original', async () => {
    make({
      planFileMove: vi.fn(async () => ({ items: [{ id: 'a', how: 'copy_up', to_provider: 'network_share', to_path: 'nas:Moon/a.mov' }] })),
      moveFiles: vi.fn(async () => ({ move_id: 'm1', ops: [{ op_id: 'o1', id: 'a', to: 'Moon/a.mov' }] })),
    })
    const local = file('a', { storage_provider: 'local_server', storage_path: 'projects/p/x/y/a.mov' })
    await fileOps.moveFiles([local], 'p1', 'p2')
    expect(catalogue.runCopyUp).toHaveBeenCalledWith({ op_id: 'o1', id: 'a', to: 'Moon/a.mov' }, 'projects/p/x/y/a.mov')
    expect(ops.retireLocalMedia).toHaveBeenCalledTimes(1)
    catalogue.runCopyUp = vi.fn(async () => ({ ok: false, code: 'name_taken' }))
    await expect(fileOps.moveFiles([local], 'p1', 'p2')).rejects.toThrow('already in that folder')
    expect(ops.retireLocalMedia).toHaveBeenCalledTimes(1)
  })
})

describe('what a move leaves behind', () => {
  it('🚨 a refused commit removes the copy, and a lost answer does not: the row may already name it', async () => {
    const rehome = vi.fn(async () => ({ items: [{ id: 'a', how: 'rehome', to_provider: 'supabase', to_path: 'new/a.mov' }] }))
    make({ planFileMove: rehome, moveFiles: vi.fn(async () => { throw Object.assign(new Error('A file with this name is already there.'), { code: 'name_taken' }) }) })
    await expect(fileOps.moveFiles([file('a')], 'p1', 'p2')).rejects.toThrow('already there')
    expect(adapter.removeMoveCopy).toHaveBeenCalledTimes(1)
    make({ planFileMove: rehome, moveFiles: vi.fn(async () => { throw new TypeError('Failed to fetch') }) })
    await expect(fileOps.moveFiles([file('a')], 'p1', 'p2')).rejects.toThrow('could not tell')
    expect(adapter.removeMoveCopy).not.toHaveBeenCalled()
    expect(changed).toEqual([['p1', 'p2']])
  })
  it('a copy that fails before the commit removes what was made', async () => {
    const two = vi.fn(async () => ({ items: [
      { id: 'a', how: 'rehome', to_provider: 'supabase', to_path: 'new/a.mov' },
      { id: 'b', how: 'rehome', to_provider: 'supabase', to_path: 'new/b.mov' },
    ] }))
    make({ planFileMove: two, copyBodyForMove: vi.fn(async (f) => { if (f.id === 'b') throw new Error('no copy'); return { file_id: f.id, path: 'x' } }) })
    await expect(fileOps.moveFiles([file('a'), file('b')], 'p1', 'p2')).rejects.toThrow('no copy')
    expect(adapter.removeMoveCopy).toHaveBeenCalledTimes(1)
    expect(adapter.moveFiles).not.toHaveBeenCalled()
  })
  it('🚨 the person is told what a move cleared and what an undo could not bring back', async () => {
    make({
      moveFiles: vi.fn(async () => ({ move_id: 'm1', moved: 1, links_cleared: 2, ops: [] })),
      undoFileMove: vi.fn(async () => ({ move_id: 'm2', links_not_restored: 1, pictures_not_restored: 1, ops: [] })),
    })
    await fileOps.moveFiles([file('a')], 'p1', 'p2')
    expect(notes[0]).toMatch(/links/)
    await history.undo()
    expect(notes[1]).toMatch(/could not come back/)
  })
})

describe('undo and redo', () => {
  it('🚨 a step that failed for a reason that may pass stays, so it can be asked again', async () => {
    make({ undoFileMove: vi.fn(async () => { throw new TypeError('Failed to fetch') }) })
    await fileOps.moveFiles([file('a')], 'p1', 'p2')
    await expect(history.undo()).rejects.toThrow('Failed to fetch')
    expect(history.canUndo()).toBe(true)
  })
  it('🚨 asked twice at once, it runs once', async () => {
    let finish
    const ran = vi.fn(() => new Promise((ok) => { finish = ok }))
    history.push({ label: 'a', run: ran })
    history.push({ label: 'b', run: ran })
    const first = history.undo()
    const second = history.undo()
    finish()
    await first
    await second
    expect(ran).toHaveBeenCalledTimes(1)
  })
  it('🚨 a toast\'s Undo acts only on its own step, not on whatever is on top', async () => {
    const one = vi.fn(async () => null)
    const two = vi.fn(async () => null)
    history.push({ label: 'one', run: one })
    const own = history.top()
    history.push({ label: 'two', run: two })
    await history.undoStep(own)
    expect(one).not.toHaveBeenCalled()
    expect(two).not.toHaveBeenCalled()
    await history.undoStep(history.top())
    expect(two).toHaveBeenCalledTimes(1)
  })
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
    make({ undoFileMove: vi.fn(async () => { throw Object.assign(new Error('This file has changed since that move, so it cannot be undone.'), { code: 'changed_since' }) }) })
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
    expect(calls).toEqual(['reachable', 'trash', 'rename'])
    expect(catalogue.runNasOp).toHaveBeenCalledWith([{ op_id: 'o', from: 'a', to: 'b' }], { kind: 'trash' })
  })
})

describe('a desktop-only project', () => {
  beforeEach(() => {
    make()
    delete adapter.planFileMove
    adapter.moveFilesBetweenProjects = vi.fn(async () => ({ moved: 1, before: [{ id: 'a', folder_id: 'x', links: {} }], links_not_restored: 0 }))
    adapter.moveFilesInProject = vi.fn(async () => ({ moved: 1 }))
    notes = []
    fileOps = createMothFileOps({ adapter, catalogue, ops, history, onChanged: () => {}, onNote: (n) => notes.push(n) })
  })
  it('between projects, through its own route, and back', async () => {
    await fileOps.moveFiles([file('a')], 'p1', 'p2', 'f1')
    expect(adapter.moveFilesBetweenProjects).toHaveBeenCalledWith(['a'], 'p1', 'p2', 'f1')
    await history.undo()
    expect(adapter.moveFilesBetweenProjects).toHaveBeenLastCalledWith(['a'], 'p2', 'p1', null, { back: [{ id: 'a', folder_id: 'x', links: {} }] })
    await history.redo()
    expect(adapter.moveFilesBetweenProjects).toHaveBeenLastCalledWith(['a'], 'p1', 'p2', 'f1')
  })
  it('🚨 an undo says what it could not bring back', async () => {
    await fileOps.moveFiles([file('a')], 'p1', 'p2')
    adapter.moveFilesBetweenProjects = vi.fn(async () => ({ moved: 1, links_not_restored: 1 }))
    await history.undo()
    expect(notes.some((n) => /could not come back/.test(n))).toBe(true)
  })
  it('within a project, each file back to the folder it came from', async () => {
    await fileOps.moveFiles([file('a', { folder_id: 'x' }), file('b', { folder_id: 'y' })], 'p1', 'p1', 'f1')
    expect(adapter.moveFilesInProject).toHaveBeenCalledWith(['a', 'b'], 'p1', 'f1')
    await history.undo()
    expect(adapter.moveFilesInProject).toHaveBeenCalledWith(['a'], 'p1', 'x')
    expect(adapter.moveFilesInProject).toHaveBeenCalledWith(['b'], 'p1', 'y')
  })
})

describe('round 2: which failures keep a step', () => {
  const failing = (err) => ({ label: 'Moved', run: async () => { throw err } })
  const coded = (code) => Object.assign(new Error(code), { code })
  it.each(['unreachable', 'cannot_check', 'in_use', 'folder_away', 'pending', 'plan_changed', 'failed', '57014', '55P03'])('🚨 %s may pass, so Undo stays', async (code) => {
    history.push(failing(coded(code)))
    await expect(history.undo()).rejects.toThrow(code)
    expect(history.canUndo()).toBe(true)
  })
  it.each(['changed_since', 'already_undone', 'needs_copy', 'not_found', 'not_finished'])('%s will say the same again, so it goes', async (code) => {
    history.push(failing(coded(code)))
    await expect(history.undo()).rejects.toThrow(code)
    expect(history.canUndo()).toBe(false)
  })
  it('a part that happened, a later, and a lost answer go too', async () => {
    for (const extra of [{ notMoved: [] }, { later: true }, { stale: true }]) {
      history.push(failing(Object.assign(new Error('x'), extra)))
      await expect(history.undo()).rejects.toThrow('x')
      expect(history.canUndo()).toBe(false)
    }
  })
  it('🚨 a part-failed undo tells the lists, which now show the old places', async () => {
    make({
      moveFiles: vi.fn(async () => ({ move_id: 'm1', ops: [] })),
      undoFileMove: vi.fn(async () => ({ move_id: 'm2', ops: [{ id: 'a', op_id: 'o', from: 'x', to: 'y' }] })),
      planUndoFileMove: vi.fn(async () => ({ items: [] })),
    })
    catalogue.runNasOp = vi.fn(async () => ({ done: [], notMoved: [{ id: 'a', code: 'name_taken' }], left: [] }))
    await fileOps.moveFiles([file('a')], 'p1', 'p2')
    changed.length = 0
    await expect(history.undo()).rejects.toThrow(/already in that folder/)
    expect(changed).toEqual([['p1', 'p2']])
  })
})
