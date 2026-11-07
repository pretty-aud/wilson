// mothJumps.test.js — MO2: where a dot opens, and the one event it sends (the page asks first).
import { describe, it, expect, vi } from 'vitest'
import { mothJump, OPEN_RABBIT_ITEM, OPEN_PROJECT_FILE, JUMP_WORDS } from './mothJumps.js'

const fakeTarget = () => {
  const sent = []
  return { sent, dispatchEvent: vi.fn((e) => { sent.push({ type: e.type, detail: e.detail }); return true }) }
}

describe('mothJump', () => {
  it('a file opens in Files, selected, and nothing is sent until go()', () => {
    const target = fakeTarget()
    const j = mothJump({ kind: 'file', projectId: 'p1', rowId: 'f1' }, { target })
    expect(j.tool).toBe('files')
    expect(j.label).toBe('Open in Files')
    expect(target.sent).toEqual([])
    j.go()
    expect(target.sent).toEqual([{ type: OPEN_PROJECT_FILE, detail: { projectId: 'p1', fileId: 'f1' } }])
  })
  it('every R.A.B.B.I.T. kind opens there, at its own kind', () => {
    for (const kind of ['project', 'phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience']) {
      const target = fakeTarget()
      const j = mothJump({ kind, projectId: 'p1', rowId: 'x' }, { target })
      expect(j.tool).toBe('rabbit')
      j.go()
      expect(target.sent).toEqual([{ type: OPEN_RABBIT_ITEM, detail: { projectId: 'p1', kind, id: 'x' } }])
    }
  })
  it('a folder, a tag, or a dot with no project or row opens nowhere', () => {
    expect(mothJump({ kind: 'folder', projectId: 'p1', rowId: 'd1' })).toBeNull()
    expect(mothJump({ kind: 'tag', projectId: null, rowId: 'shots' })).toBeNull()
    expect(mothJump({ kind: 'file', projectId: null, rowId: 'f1' })).toBeNull()
    expect(mothJump({ kind: 'file', projectId: 'p1', rowId: null })).toBeNull()
    expect(mothJump(null)).toBeNull()
  })
  it('has words for both tools', () => {
    expect(JUMP_WORDS.rabbit).toBe('R.A.B.B.I.T.')
    expect(JUMP_WORDS.files).toMatch(/Files/)
  })
})
