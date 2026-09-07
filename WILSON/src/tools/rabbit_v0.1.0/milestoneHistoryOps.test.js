// =============================================================================
// milestoneHistoryOps.test.js — Track A bundle A2 session 2, R1 corrections.
//
// A SOURCE PIN, and it says so. Nothing in this repo mounts React or the
// RabbitProvider — the provider is a 2,900-line context with an adapter, an
// undo stack and live Supabase behind it — so the undo/redo contract for
// milestones has no behavioural test to sit in. A source pin is the honest
// instrument that remains, in the tradition of folderParity.test.js and the
// RelationsPanel pin A2 session 1 added.
//
// WHAT IT GUARDS, and why it exists at all. R1 of this session found that
// making `deleteMilestone` a SOFT delete quietly broke the OTHER end of the
// history stack. `addMilestone` pushes an undo op and a redo op; its undo op
// called `deleteMilestone`, which now trashes rather than destroys, so:
//
//   * REDO after an undone create upserted an id that still existed with
//     deleted_at set. `deleted_at` is not in MILESTONE_COLUMNS, so the stamp
//     survived the upsert; milestones_select then filtered the RETURNING read;
//     `.single()` answered PGRST116; and `redo` swallows errors — so Redo did
//     nothing at all, silently. On the desktop the row reappeared carrying its
//     stamp and vanished on the next reload.
//   * The trash filled with rows the user never deleted, and on Local Server
//     nothing purges, so they accumulated with no way to remove them.
//
// The fix is that undoing a CREATE destroys (`destroyMilestone`, a hard
// delete) while deleting an existing row trashes. These pins fail if the two
// are ever collapsed back together.
//
// 🚨 A pin is only as good as its extractor. The brace matcher below matches
// the PARENTHESES of the callback first, because `useCallback(async (x) => {`
// puts a parameter list before the body — the exact trap A2 session 1 recorded
// after a naive matcher took a destructured parameter for a function body.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const PROVIDER = readFileSync(
  new URL('./state/RabbitProvider.jsx', import.meta.url), 'utf-8')

/**
 * Lift `const <name> = useCallback(<params> => { ... })` out of the source.
 * Parens first, then braces — see the header.
 */
function extractCallback(source, name) {
  const decl = `const ${name} = useCallback(`
  const start = source.indexOf(decl)
  if (start < 0) throw new Error(`RabbitProvider no longer declares ${name} — the pin cannot run`)
  // Walk to the arrow's parameter list, paren-matching from the useCallback(.
  let i = source.indexOf('(', start + decl.length - 1)
  let pd = 0
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
      if (depth === 0) return source.slice(start, j + 1)
    }
  }
  throw new Error(`unbalanced braces extracting ${name} from RabbitProvider`)
}

const addMilestone    = extractCallback(PROVIDER, 'addMilestone')
const deleteMilestone = extractCallback(PROVIDER, 'deleteMilestone')

// A control on the extractor itself: if these are wrong, every assertion below
// is meaningless in the reassuring direction.
describe('the extractor actually extracted the right two functions', () => {
  it('addMilestone is the create, and does not swallow deleteMilestone', () => {
    expect(addMilestone).toContain('upsertMilestone')
    expect(addMilestone).toContain('pushHistory')
    expect(addMilestone.length).toBeLessThan(PROVIDER.length / 4)
    expect(addMilestone).not.toContain('const deleteMilestone')
  })

  it('deleteMilestone is the delete, and does not swallow addMilestone', () => {
    expect(deleteMilestone).toContain('showUndoToast')
    expect(deleteMilestone).toContain('pushHistory')
    expect(deleteMilestone).not.toContain('const addMilestone')
  })
})

describe('undoing a CREATE destroys; deleting an existing key date trashes', () => {
  it('addMilestone undoes with destroyMilestone, the hard delete', () => {
    expect(addMilestone).toContain('destroyMilestone')
  })

  it('🚨 addMilestone does NOT undo through the soft delete', () => {
    // This is the regression itself. `deleteMilestone` here means the undo of
    // a create files the row in "Recently deleted" and leaves the redo
    // upserting a trashed id.
    const undo = addMilestone.slice(addMilestone.indexOf('undoOps'),
                                    addMilestone.indexOf('redoOps'))
    expect(undo).toContain('destroyMilestone')
    expect(undo).not.toContain('mutationsRef.current.deleteMilestone')
  })

  it('the fallback for an adapter without destroyMilestone is stated, not silent', () => {
    // An adapter that cannot hard-delete keeps the soft path — worse, but not
    // broken — and the capability check is what chooses.
    expect(addMilestone).toContain('typeof adapterRef.current?.destroyMilestone')
  })

  it('deleteMilestone undoes by RESTORING, not by re-inserting', () => {
    const undo = deleteMilestone.slice(deleteMilestone.indexOf('undoOps'),
                                       deleteMilestone.indexOf('redoOps'))
    expect(undo).toContain('restoreMilestone')
  })

  it('deleteMilestone keeps its capability check for adapters without restore', () => {
    expect(deleteMilestone).toContain('typeof adapterRef.current?.restoreMilestone')
  })
})

describe('neither history op can leave two rows with one id', () => {
  it('addMilestone filters the id before appending', () => {
    // A refetch can land between an undo and the redo that replays this.
    // The WHOLE assignment, not just the filter: the same filter expression
    // also appears in this function's undo op, so a looser pin stayed green
    // when the dedupe was removed — measured, by the breaker for this line.
    expect(addMilestone).toContain(
      'milestones: [...prev.milestones.filter(m => m.id !== finalRow.id), finalRow],')
  })

  it('the delete-undo filters the id before reinstating', () => {
    // Same trap as above: the delete's own optimistic op filters on the same
    // expression, so the pin has to name the reinstating assignment.
    expect(deleteMilestone).toContain(
      'milestones: [...prev.milestones.filter(m => m.id !== id), oldMilestone],')
  })
})

describe('the delete still raises the undo toast ruling 38 asks for', () => {
  it('and names the key date, using the app noun rather than the internal one', () => {
    expect(deleteMilestone).toContain('Deleted key date')
    expect(deleteMilestone).not.toContain('Deleted milestone')
  })
})


// ── The trash panel's three states start here, in the provider ─────────────

const listTrashed = extractCallback(PROVIDER, 'listTrashedMilestones')

describe('listTrashedMilestones separates "no trash on this backend" from "empty"', () => {
  it('answers null when the adapter cannot list a trash', () => {
    // googleDriveAdapter is read-only and implements none of the milestone
    // methods. Returning [] for it would have the panel claim an empty trash it
    // never looked in — the mistake unwrapOptionalTable's own comment condemns
    // and that useRosterMembers makes. R1 of this session found the same shape.
    expect(listTrashed).toContain("typeof adapterRef.current.listTrashedMilestones !== 'function'")
    // Both early exits answer null, and neither answers an empty array.
    const early = listTrashed.slice(0, listTrashed.indexOf('return (await'))
    expect(early).toContain('return null')
    expect(early).not.toContain('return []')
  })

  it('still answers an array when the adapter DOES list one', () => {
    expect(listTrashed).toContain('listTrashedMilestones(activeProjectId)')
  })
})

