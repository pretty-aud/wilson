// =============================================================================
// dependencyRewire.js — Track A bundle A2 (2026-09-06), Audrey's ruling 7.
//
// The decision half of TimelineView's dependency re-wire gesture, lifted out
// of `beginDependencyRewire`'s mouseup so it can be unit-tested and so the
// confirm modal has a single, named thing to ask about.
//
// Dragging the head of a dependency arrow and releasing it does one of three
// things, unchanged from the gesture Session 29 gated:
//   • released on the ORIGINAL successor            → cancel   (nothing written)
//   • released on another bar of the SAME kind that
//     is not the predecessor                        → rewire   (unlink old, link new)
//   • released anywhere else — empty space, the
//     predecessor itself, a bar of the other kind   → disconnect (unlink only)
//
// The rewire is the one that gets a confirm first. It is two writes that are
// NOT atomic (docs/OUTSTANDING.md "A dependency rewire deletes before it
// links"): the unlink commits, then the link may be refused — most often by
// `unique (predecessor_id, successor_id)` when the target edge already exists
// — and the person is left with a pure delete. The modal does not fix that;
// Audrey accepted the confirm knowing it does not ("Are you sure" first, 7).
// It makes the destructive gesture deliberate, and says what it replaces.
// =============================================================================

/**
 * @param {object} p
 * @param {string|null} p.targetKey  the `data-row-bar` value under the cursor,
 *                                   "task:<id>" | "phase:<id>", or null
 * @param {'task'|'phase'} p.kind    the dragged edge's kind
 * @param {string} p.predId          the edge's predecessor
 * @param {string} p.origSuccId      the edge's current successor
 * @returns {{ action: 'cancel'|'rewire'|'disconnect', newSuccId: string|null }}
 */
export function resolveRewireDrop({ targetKey, kind, predId, origSuccId }) {
  if (targetKey) {
    const [tKind, tId] = String(targetKey).split(':')
    if (tKind === kind && tId) {
      if (tId === origSuccId) return { action: 'cancel', newSuccId: null }
      if (tId !== predId)     return { action: 'rewire', newSuccId: tId }
      // Released on the predecessor itself: a self-edge is not a rewire, and
      // the gesture has always read that as "take the arrow off".
    }
  }
  return { action: 'disconnect', newSuccId: null }
}

/**
 * Names for the confirm modal. Falls back to a short id so the modal never
 * shows "undefined → undefined" for a row that is scrolled out of the layout.
 */
export function describeRewire({ kind, predId, oldSuccId, newSuccId, taskById, phaseById }) {
  const lookup = kind === 'phase' ? phaseById : taskById
  const name = (id) => {
    const row = lookup?.[id]
    const label = row ? (kind === 'phase' ? row.name : (row.title || row.assigned_position)) : null
    return label || `#${String(id ?? '').slice(0, 8)}`
  }
  return {
    kindLabel: kind === 'phase' ? 'phase' : 'task',
    predName:  name(predId),
    oldName:   name(oldSuccId),
    newName:   name(newSuccId),
  }
}
