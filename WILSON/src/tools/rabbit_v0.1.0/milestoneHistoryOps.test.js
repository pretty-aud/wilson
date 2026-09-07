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

const NL = String.fromCharCode(10)

const PROVIDER = readFileSync(
  new URL('./state/RabbitProvider.jsx', import.meta.url), 'utf-8')

/**
 * Lift `const <name> = useCallback(<params> => { ... })` out of the source.
 *
 * 🚨 THE PARENS THAT MATTER ARE THE CALLBACK'S, NOT useCallback'S. The first
 * version of this matched from `useCallback(` itself, so the paren loop closed
 * on the end of `useCallback(fn, [deps])` and the next `{` it found was the
 * NEXT DECLARATION'S body — every extract silently carried a whole extra
 * function. R2 measured it: `addMilestone` came back with `updateMilestone`
 * attached. Every pin below still passed, which is exactly why the control at
 * the bottom of this function's describe block is not decoration.
 */
function extractCallback(source, name) {
  const decl = `const ${name} = useCallback(`
  const start = source.indexOf(decl)
  if (start < 0) throw new Error(`RabbitProvider no longer declares ${name} — the pin cannot run`)
  // Step past `useCallback(`, then past an optional `async `, to the
  // CALLBACK's own parameter list.
  let i = start + decl.length
  while (i < source.length && /\s/.test(source[i])) i++
  if (source.startsWith('async', i)) {
    i += 'async'.length
    while (i < source.length && /\s/.test(source[i])) i++
  }
  if (source[i] !== '(') throw new Error(`${name} is not a parenthesised arrow callback`)
  let pd = 0
  for (; i < source.length; i++) {
    if (source[i] === '(') pd++
    else if (source[i] === ')') { pd--; if (pd === 0) break }
  }
  const arrow = source.indexOf('=>', i)
  if (arrow < 0) throw new Error(`no arrow after ${name}'s parameter list`)
  const open = source.indexOf('{', arrow)
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
const listTrashed     = extractCallback(PROVIDER, 'listTrashedMilestones')

// A control on the extractor itself: if these are wrong, every assertion below
// is meaningless in the reassuring direction.
describe('the extractor actually extracted the right two functions', () => {
  it('addMilestone is the create', () => {
    expect(addMilestone).toContain('upsertMilestone')
    expect(addMilestone).toContain('pushHistory')
  })

  it('deleteMilestone is the delete', () => {
    expect(deleteMilestone).toContain('showUndoToast')
    expect(deleteMilestone).toContain('pushHistory')
  })

  it('🚨 THE REAL CONTROL: no extract carries a second useCallback', () => {
    // This is what the first version of the extractor failed and what its
    // controls could not see. `not.toContain('const deleteMilestone')` passed
    // happily while `addMilestone`'s extract carried `updateMilestone`, and a
    // length bound of PROVIDER.length / 4 left 4,000% of slack. One
    // useCallback per extract is the property that actually holds.
    for (const [label, text] of Object.entries({
      addMilestone, deleteMilestone, listTrashedMilestones: listTrashed,
    })) {
      const opens = text.split('useCallback(').length - 1
      expect(opens, `${label}'s extract spans ${opens} useCallback declarations`).toBe(1)
    }
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
  it('addMilestone filters the id before appending, and sorts', () => {
    // A refetch can land between an undo and the redo that replays this.
    // The WHOLE assignment, not just the filter: the same filter expression
    // also appears in this function's undo op, so a looser pin stayed green
    // when the dedupe was removed — measured, by the breaker for this line.
    //
    // The `.sort` half is R1's (2026-09-07). Both adapters load key dates
    // ORDER BY date, id and realtimeMerge splices incoming ones into that
    // order — but this is the path that runs on LOCAL SERVER, where no
    // broadcast ever arrives, so without the sort a new key date sat at the
    // bottom of the Tasks tab's key-date block until the next reload.
    expect(addMilestone).toContain(
      'milestones: [...prev.milestones.filter(m => m.id !== finalRow.id), finalRow]')
    expect(addMilestone).toContain('.sort(byMilestoneDate)')
  })

  it('the delete-undo filters the id before reinstating, and sorts', () => {
    // Same trap as above: the delete's own optimistic op filters on the same
    // expression, so the pin has to name the reinstating assignment.
    expect(deleteMilestone).toContain(
      'milestones: [...prev.milestones.filter(m => m.id !== id), oldMilestone]')
    expect(deleteMilestone).toContain('.sort(byMilestoneDate)')
  })
})

// ── R1 of Audrey's A2 decisions (2026-09-07): what live sync made necessary ──
//
// Two defects that were harmless while key dates received no remote events and
// became real the moment 0077 sent them one. Source pins, for the reason the
// header of this file gives: nothing here mounts the provider.

const updateMilestone = extractCallback(PROVIDER, 'updateMilestone')

describe('updateMilestone is ready for a remote event landing mid-write', () => {
  it('the extractor got the right function', () => {
    // The control this file's own header insists on: an extractor that
    // silently carried the NEXT declaration made every pin below meaningless
    // in the reassuring direction once already.
    expect(updateMilestone.startsWith('const updateMilestone = useCallback(')).toBe(true)
    expect(updateMilestone).toContain('upsertMilestone')
    expect(updateMilestone).not.toContain('const deleteMilestone')
    expect(updateMilestone).not.toContain('destroyMilestone')
  })

  it('🚨 registers pending fields, like every other broadcast table', () => {
    // R1: milestones were the ONE broadcast table whose mutator called
    // neither helper, so pendingFieldsFor('milestones', …) returned null
    // forever and per-field LWW never engaged. realtimeMerge.test.js's
    // pending-field probe was testing a path production could not reach.
    expect(updateMilestone).toContain("notePendingFields('milestones', id, fields)")
    expect(updateMilestone).toContain("clearPendingFields('milestones', id, fields)")
  })

  it('clears them in a finally, so a throwing adapter cannot pin a field', () => {
    // Without this a failed write leaves the field pinned for the life of the
    // session and that row silently stops accepting remote updates. Copied
    // from updateTask, which has carried the same try/finally since S7.
    const tryAt = updateMilestone.indexOf('try {')
    const finallyAt = updateMilestone.indexOf('} finally {')
    expect(tryAt).toBeGreaterThan(-1)
    expect(finallyAt).toBeGreaterThan(tryAt)
    expect(updateMilestone.slice(finallyAt)).toContain('clearPendingFields')
  })

  it('re-sorts, because a date change is a change of position', () => {
    expect(updateMilestone).toContain('.sort(byMilestoneDate)')
  })
})

describe('the provider imports the one comparator rather than growing another', () => {
  it('byMilestoneDate comes from state/milestoneOrder', () => {
    expect(PROVIDER).toContain("import { byMilestoneDate } from './milestoneOrder';")
    // ...and nowhere in the provider is there a second definition of it.
    expect(PROVIDER).not.toContain('function byMilestoneDate')
  })
})


// ── the Tasks tab's key-date row, which live sync turned into a writer ──────

const TASKS_VIEW = readFileSync(
  new URL('./views/ProjectTasksView.jsx', import.meta.url), 'utf-8')
  .split(String.fromCharCode(13) + NL).join(NL)

/** The body of `function <name>(` by brace matching, params skipped first. */
function functionBody(source, name) {
  const start = source.indexOf('function ' + name + '(')
  if (start < 0) throw new Error(name + ' is gone from ProjectTasksView')
  let i = source.indexOf('(', start)
  let pd = 0
  for (; i < source.length; i++) {
    if (source[i] === '(') pd++
    else if (source[i] === ')') { pd--; if (pd === 0) break }
  }
  const open = source.indexOf('{', i)
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1) }
  }
  throw new Error('unbalanced braces extracting ' + name)
}

const MILESTONE_ROW = functionBody(TASKS_VIEW, 'MilestoneRow')

describe('MilestoneRow re-seeds its drafts from props', () => {
  it('the slice really is MilestoneRow', () => {
    // Scoped by brace matching, not grepped over a 2,000-line file: a
    // useEffect belonging to CellInlineText twenty lines below would otherwise
    // satisfy every assertion here.
    expect(MILESTONE_ROW).toContain('const [localTitle, setLocalTitle]')
    expect(MILESTONE_ROW).toContain('function commitTitle()')
    expect(MILESTONE_ROW).not.toContain('function CellInlineText')
  })

  it('🚨 a remote rename cannot be reverted by a bare click', () => {
    // R1's HIGH. useState's argument is an INITIAL value and this row is keyed
    // `ms-<id>`, so its instance survives every bundle update: localTitle held
    // its first value forever. Before 0077 that was only reachable through
    // undo/redo. With key dates broadcast it is routine, and it is a WRITE —
    // window A renames "Alpha" to "Beta"; B's row displays "Beta" while
    // localTitle is still "Alpha"; someone in B clicks the title and clicks
    // away; commitTitle sees 'Alpha' !== 'Beta' and SAVES 'Alpha' over the
    // rename. No typing, no Save, no warning.
    expect(MILESTONE_ROW).toContain(
      'useEffect(() => { if (!editTitle) setLocalTitle(milestone.title) }, [milestone.title, editTitle])')
    expect(MILESTONE_ROW).toContain(
      "useEffect(() => { if (!editDate) setLocalDate(milestone.date || '') }, [milestone.date, editDate])")
  })

  it('...but cannot yank text out from under someone typing', () => {
    // The guard is half the fix. An unguarded re-seed would overwrite an open
    // draft on every incoming event, which is the same bug pointed the other
    // way. Asserted as the CONDITION, so deleting it fails even though the
    // effect survives.
    expect(MILESTONE_ROW).toContain('if (!editTitle) setLocalTitle')
    expect(MILESTONE_ROW).toContain('if (!editDate) setLocalDate')
  })

  it('commitTitle/commitDate still compare against the prop, not a snapshot', () => {
    // The re-seed is what makes these comparisons safe; if a later change made
    // them compare against something else, the fix above would stop mattering
    // without failing anything.
    expect(MILESTONE_ROW).toContain('if (localTitle !== milestone.title')
    expect(MILESTONE_ROW).toContain('if (localDate !== milestone.date')
  })
})

describe('the delete still raises the undo toast ruling 38 asks for', () => {
  it('and names the key date, using the app noun rather than the internal one', () => {
    expect(deleteMilestone).toContain('Deleted key date')
    expect(deleteMilestone).not.toContain('Deleted milestone')
  })
})


// ── The trash panel's three states start here, in the provider ─────────────

describe('listTrashedMilestones separates "no trash on this backend" from "empty"', () => {
  it('answers null when the adapter cannot list a trash', () => {
    // googleDriveAdapter is read-only and implements none of the milestone
    // methods. Returning [] for it would have the panel claim an empty trash it
    // never looked in — the mistake unwrapOptionalTable's own comment condemns
    // and that useRosterMembers makes. R1 of this session found the same shape.
    // The capability check answers null; the no-project check answers [].
    // Those are different claims and R2 found them collapsed: "no project
    // open" was being rendered as "this backend keeps no deleted key dates",
    // a false sentence about the adapter.
    const capability = "typeof adapterRef.current.listTrashedMilestones !== 'function'"
    expect(listTrashed).toContain(capability)
    const capLine = listTrashed.slice(listTrashed.indexOf(capability))
    expect(capLine.slice(0, capLine.indexOf(NL))).toContain('return null')
    const noProject = listTrashed.slice(0, listTrashed.indexOf(capability))
    expect(noProject).toContain('!activeProjectId')
    expect(noProject.slice(noProject.indexOf('!activeProjectId'))).toContain('return []')
  })

  it('still answers an array when the adapter DOES list one', () => {
    expect(listTrashed).toContain('listTrashedMilestones(activeProjectId)')
  })
})


// ── The trash panel's sequence guard ───────────────────────────────────────
//
// Another SOURCE PIN, for the same reason as the ones above: nothing in this
// repo mounts React, so a race between two in-flight loads has no behavioural
// vantage point here.
//
// What it guards (R2): close the panel, switch project, reopen before the
// first request settles, and the older resolution can land last — showing the
// PREVIOUS project's deleted key dates. A Restore pressed from that list is
// routed by row id, so in cloud it would restore a row belonging to the other
// project. Only the newest request may write state.

const MODAL = readFileSync(
  new URL('./components/MilestoneTrashModal.jsx', import.meta.url), 'utf-8')

describe('MilestoneTrashModal.load only lets the newest request write state', () => {
  const load = MODAL.slice(MODAL.indexOf('const load = useCallback'),
                           MODAL.indexOf('useEffect(('))

  it('takes a ticket before awaiting', () => {
    expect(load).toContain('const mine = ++runId.current')
  })

  it('checks that ticket on BOTH the success and the failure path', () => {
    // Two guards, not one: a stale REJECTION would otherwise overwrite a fresh
    // list with an error banner.
    const guards = load.split('if (runId.current !== mine) return').length - 1
    expect(guards, 'both the resolve and the catch path must be guarded').toBe(2)
  })

  it('the counter is a ref, so a re-render cannot reset it', () => {
    expect(MODAL).toContain('const runId = useRef(0)')
  })
})

