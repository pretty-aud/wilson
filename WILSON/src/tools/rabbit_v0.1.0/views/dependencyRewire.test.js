// =============================================================================
// dependencyRewire.test.js — Track A bundle A2 (2026-09-06).
//
// Two halves. The pure drop decision, exhaustively — every branch of the
// gesture that Session 29 gated is a case here, so a "tidy" that changed what
// a release on empty space does would go red. And a source-level guard, in
// the shape validatorSave.test.js established, that the rewire branch of
// `beginDependencyRewire` no longer writes on mouseup: it parks the rewire for
// the confirm modal, and the two writes live in `commitRewire` only.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveRewireDrop, describeRewire } from './dependencyRewire'

describe('resolveRewireDrop', () => {
  const edge = { kind: 'task', predId: 'A', origSuccId: 'B' }

  it('cancels when released back on the original successor', () => {
    expect(resolveRewireDrop({ ...edge, targetKey: 'task:B' })).toEqual({ action: 'cancel', newSuccId: null })
  })

  it('rewires when released on another bar of the same kind', () => {
    expect(resolveRewireDrop({ ...edge, targetKey: 'task:C' })).toEqual({ action: 'rewire', newSuccId: 'C' })
  })

  it('disconnects when released on the predecessor itself (no self-edges)', () => {
    expect(resolveRewireDrop({ ...edge, targetKey: 'task:A' })).toEqual({ action: 'disconnect', newSuccId: null })
  })

  it('disconnects when released on a bar of the other kind', () => {
    expect(resolveRewireDrop({ ...edge, targetKey: 'phase:P' })).toEqual({ action: 'disconnect', newSuccId: null })
    expect(resolveRewireDrop({ kind: 'phase', predId: 'P', origSuccId: 'Q', targetKey: 'task:C' }))
      .toEqual({ action: 'disconnect', newSuccId: null })
  })

  it('disconnects when released on empty space or on a malformed key', () => {
    expect(resolveRewireDrop({ ...edge, targetKey: null })).toEqual({ action: 'disconnect', newSuccId: null })
    expect(resolveRewireDrop({ ...edge, targetKey: '' })).toEqual({ action: 'disconnect', newSuccId: null })
    expect(resolveRewireDrop({ ...edge, targetKey: 'task:' })).toEqual({ action: 'disconnect', newSuccId: null })
    expect(resolveRewireDrop({ ...edge, targetKey: 'nonsense' })).toEqual({ action: 'disconnect', newSuccId: null })
  })

  it('rewires phase edges between phases', () => {
    expect(resolveRewireDrop({ kind: 'phase', predId: 'P', origSuccId: 'Q', targetKey: 'phase:R' }))
      .toEqual({ action: 'rewire', newSuccId: 'R' })
  })
})

describe('describeRewire', () => {
  const taskById = { A: { title: 'Model' }, B: { title: 'Rig' }, C: { assigned_position: 'Animator' } }
  const phaseById = { P: { name: 'Pre' }, Q: { name: 'Prod' }, R: { name: 'Post' } }

  it('names every end of a task rewire, using the role when a task has no title', () => {
    expect(describeRewire({ kind: 'task', predId: 'A', oldSuccId: 'B', newSuccId: 'C', taskById, phaseById }))
      .toEqual({ kindLabel: 'task', predName: 'Model', oldName: 'Rig', newName: 'Animator' })
  })

  it('names phases from the phase lookup', () => {
    expect(describeRewire({ kind: 'phase', predId: 'P', oldSuccId: 'Q', newSuccId: 'R', taskById, phaseById }))
      .toEqual({ kindLabel: 'phase', predName: 'Pre', oldName: 'Prod', newName: 'Post' })
  })

  it('never shows undefined for a row that is not in the lookup', () => {
    const d = describeRewire({ kind: 'task', predId: 'A', oldSuccId: 'zzzz-9999-unknown', newSuccId: undefined, taskById })
    expect(d.oldName).toBe('#zzzz-999')
    expect(d.newName).toBe('#')
    expect(d.predName).toBe('Model')
  })
})

// ── Source guard ─────────────────────────────────────────────────────────────

const TIMELINE = readFileSync(new URL('./TimelineView.jsx', import.meta.url), 'utf8')

/** The body of `function <name>(` by brace matching, so the assertions are scoped. */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) return null
  // Skip the parameter list by paren matching FIRST: a destructured
  // parameter such as `({ dep, kind })` would otherwise be taken for the body.
  let pd = 0
  let i = source.indexOf('(', start)
  for (; i < source.length; i++) {
    if (source[i] === '(') pd++
    else if (source[i] === ')') { pd--; if (pd === 0) break }
  }
  const open = source.indexOf('{', i)
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') {
      depth--
      if (depth === 0) return source.slice(open, j + 1)
    }
  }
  return null
}

describe('the rewire gesture confirms before it writes', () => {
  const begin = functionBody(TIMELINE, 'beginDependencyRewire')
  const commit = functionBody(TIMELINE, 'commitRewire')

  it('still defines both halves of the gesture', () => {
    expect(begin).toBeTruthy()
    expect(commit).toBeTruthy()
  })

  it('decides the drop through resolveRewireDrop and parks a rewire instead of writing it', () => {
    expect(begin).toContain('resolveRewireDrop(')
    expect(begin).toContain('setPendingRewire(')
    // The mouseup may still DISCONNECT (that branch is unchanged), but it
    // must not link: both link calls live in commitRewire only.
    expect(begin).not.toContain('onLinkTasks')
    expect(begin).not.toContain('onLinkPhases')
  })

  it('commits a confirmed rewire as unlink-then-link, both kinds', () => {
    expect(commit).toContain('onUnlinkDependency')
    expect(commit).toContain('onLinkTasks')
    expect(commit).toContain('onLinkPhases')
    expect(commit.indexOf('onUnlinkDependency')).toBeLessThan(commit.indexOf('onLinkTasks'))
  })

  it('mounts the confirm modal from the parked rewire', () => {
    expect(TIMELINE).toContain('<DependencyRewireModal')
    expect(TIMELINE).toMatch(/pendingRewire && \(?\s*<DependencyRewireModal/)
  })
})
