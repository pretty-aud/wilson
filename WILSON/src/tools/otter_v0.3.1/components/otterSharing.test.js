// =============================================================================
// otterSharing.test.js — Session 11
//
// The filter predicates and capability helpers decide which controls a user is
// offered, so getting one wrong is either a dead button or an offer to do
// something the database will silently refuse. Two cases carry most of the
// weight and are covered hardest:
//
//   * LOCAL (signed-out Electron) mode sends none of these flags, so every
//     helper must treat `undefined` as "yours, readable, writable" — otherwise
//     signing out of a single-user install disables the whole tool;
//   * an ADMIN's metadata-only row for a colleague's personal course must never
//     be mistaken for something shared with them, or something they may open.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  courseMatchesFilter, filtersFor, canWriteCourse, canReadCourse,
  selectableVisibilities, canManageEditors, findStandardByName,
  daysUntilPurge, visibilityMeta,
  // B2: subject shares
  shareStateWords, shareFailureText, NOT_A_MEMBER_WORDS, shareCall, runShareLoop,
  inboxRows, inboxEntries, shareInboxCount, offerLine, batchCardTitle, batchGoneLine, acceptedSentence,
  sentRows, sentEntries, viaLabel, batchLine, withdrawConfirmText, removeConfirmText, ownerShareLine,
  sentPersonLine, reopenRestoredLinks, linkUnreadWords,
  deleteShareSentence, linkedRowsForHost, isClosedLink, linkedFromLine, linkClosedWords, acceptedSignature,
  shareContractLine, sharedSentence, sharedCourseSentence, courseCountLine, passOnExcluded,
  newSlugsOf, batchReceivers, planNewSubjectReminder, reminderPairs, reminderTitle, reminderLine,
} from './otterSharing.js'

const mine       = { name: 'Mine',     visibility: 'personal',         is_own: true,  can_read_content: true,  can_write: true }
const minePub    = { name: 'MinePub',  visibility: 'shared',           is_own: true,  can_read_content: true,  can_write: true }
const theirs     = { name: 'Theirs',   visibility: 'shared',           is_own: false, can_read_content: true,  can_write: false }
const standard   = { name: 'Standard', visibility: 'company_standard', is_own: false, can_read_content: true,  can_write: false }
const opaque     = { name: 'Opaque',   visibility: 'personal',         is_own: false, can_read_content: false, can_write: false }
const localOnly  = { name: 'Local' }   // Express server: no cloud fields at all

describe('courseMatchesFilter', () => {
  it('"Made for me" is ownership, regardless of tier', () => {
    expect(courseMatchesFilter(mine, 'mine')).toBe(true)
    expect(courseMatchesFilter(minePub, 'mine')).toBe(true)
    expect(courseMatchesFilter(theirs, 'mine')).toBe(false)
  })

  it('"Shared by me" excludes your own personal courses', () => {
    expect(courseMatchesFilter(minePub, 'by_me')).toBe(true)
    expect(courseMatchesFilter(mine, 'by_me')).toBe(false)
  })

  it('"Shared with me" excludes an admin\'s metadata-only rows', () => {
    expect(courseMatchesFilter(theirs, 'to_me')).toBe(true)
    // Nothing was shared and it cannot be opened — listing it here would be a lie.
    expect(courseMatchesFilter(opaque, 'to_me')).toBe(false)
  })

  it('surfaces unopenable rows only under the admin-only chip', () => {
    expect(courseMatchesFilter(opaque, 'unopenable')).toBe(true)
    expect(courseMatchesFilter(theirs, 'unopenable')).toBe(false)
    // Not in the default list: clicking one would do nothing, and an admin's
    // sidebar would fill with their colleagues' private course titles.
    expect(courseMatchesFilter(opaque, 'all')).toBe(false)
    expect(courseMatchesFilter(theirs, 'all')).toBe(true)
  })

  it('company standard is tier-based, not ownership-based', () => {
    expect(courseMatchesFilter(standard, 'standard')).toBe(true)
    expect(courseMatchesFilter(minePub, 'standard')).toBe(false)
  })

  it('never lists live courses under the trash chip', () => {
    for (const c of [mine, minePub, theirs, standard, opaque, localOnly]) {
      expect(courseMatchesFilter(c, 'trash')).toBe(false)
    }
  })

  it('treats a flagless local-mode course as the user\'s own readable course', () => {
    expect(courseMatchesFilter(localOnly, 'all')).toBe(true)
    expect(courseMatchesFilter(localOnly, 'mine')).toBe(true)
    expect(courseMatchesFilter(localOnly, 'to_me')).toBe(false)
    expect(courseMatchesFilter(localOnly, 'unopenable')).toBe(false)
  })

  it('is total — an unknown chip shows everything rather than an empty list', () => {
    expect(courseMatchesFilter(mine, 'nonsense')).toBe(true)
    expect(courseMatchesFilter(null, 'all')).toBe(false)
  })
})

describe('filtersFor', () => {
  it('adds the metadata-only chip for admins only', () => {
    expect(filtersFor('user').some(f => f.key === 'unopenable')).toBe(false)
    expect(filtersFor('admin').some(f => f.key === 'unopenable')).toBe(true)
  })

  it('stays within Miller\'s Law even for admins', () => {
    expect(filtersFor('admin').length).toBeLessThanOrEqual(9)
  })
})

describe('capability helpers default OPEN for local mode', () => {
  it('canWriteCourse', () => {
    expect(canWriteCourse(localOnly)).toBe(true)
    expect(canWriteCourse(undefined)).toBe(true)
    expect(canWriteCourse(theirs)).toBe(false)
    expect(canWriteCourse(mine)).toBe(true)
  })

  it('canReadCourse', () => {
    expect(canReadCourse(localOnly)).toBe(true)
    expect(canReadCourse(opaque)).toBe(false)
  })
})

describe('selectableVisibilities mirrors fn_otter_pin_course_identity', () => {
  it('offers the owner personal and shared, but not company standard', () => {
    expect(selectableVisibilities(mine, 'user')).toEqual(['personal', 'shared'])
  })

  it('offers an admin all three', () => {
    expect(selectableVisibilities(theirs, 'admin')).toEqual(
      ['personal', 'shared', 'company_standard'])
  })

  it('offers nothing to a non-owner non-admin', () => {
    expect(selectableVisibilities(theirs, 'user')).toEqual([])
  })

  // Leaving the tier is admin-only too — the trigger checks BOTH directions,
  // and a demote offered to the owner would silently do nothing.
  it('refuses to offer an owner a way out of company standard', () => {
    const ownStandard = { ...standard, is_own: true }
    expect(selectableVisibilities(ownStandard, 'user')).toEqual([])
    expect(selectableVisibilities(ownStandard, 'admin')).toHaveLength(3)
  })
})

describe('canManageEditors keeps the Session 10 critical finding intact', () => {
  it('lets the owner grant on their own course', () => {
    expect(canManageEditors(mine, 'user')).toBe(true)
  })

  it('lets an admin grant on shared and standard courses', () => {
    expect(canManageEditors(theirs, 'admin')).toBe(true)
    expect(canManageEditors(standard, 'admin')).toBe(true)
  })

  // Without this, index -> self-grant -> read defeats "no admin content bypass"
  // in two steps. 0022 refuses it server-side; the UI must not offer it either.
  it('does NOT let an admin grant on someone else\'s personal course', () => {
    expect(canManageEditors(opaque, 'admin')).toBe(false)
  })

  it('does not let a plain member grant on a course they merely read', () => {
    expect(canManageEditors(theirs, 'user')).toBe(false)
  })
})

describe('findStandardByName', () => {
  const list = [mine, minePub, theirs, standard]

  it('matches a company standard case-insensitively, the way Otter.jsx does', () => {
    expect(findStandardByName(list, '  StAnDaRd ')).toBe(standard)
  })

  it('does not offer a fork of a shared-but-not-standard course', () => {
    expect(findStandardByName(list, 'Theirs')).toBeNull()
  })

  it('returns null for empty input rather than a stray first match', () => {
    expect(findStandardByName(list, '   ')).toBeNull()
    expect(findStandardByName(undefined, 'Standard')).toBeNull()
  })
})

describe('daysUntilPurge', () => {
  const now = Date.parse('2026-07-29T00:00:00Z')

  it('counts whole days remaining', () => {
    expect(daysUntilPurge('2026-08-05T00:00:00Z', now)).toBe(7)
  })

  it('floors at zero for a row the sweep has not reached yet', () => {
    expect(daysUntilPurge('2026-07-01T00:00:00Z', now)).toBe(0)
  })

  it('tolerates missing and malformed timestamps', () => {
    expect(daysUntilPurge(null, now)).toBeNull()
    expect(daysUntilPurge('not-a-date', now)).toBeNull()
  })
})

describe('visibilityMeta', () => {
  it('falls back to personal — the safe tier — for anything unrecognised', () => {
    expect(visibilityMeta('nonsense').key).toBe('personal')
    expect(visibilityMeta(undefined).key).toBe('personal')
    expect(visibilityMeta('company_standard').short).toBe('Standard')
  })
})

// =============================================================================
// B2 (2026-10-27) — SUBJECT SHARES. Design §1, §3.6, §5. The rows below are the
// index's own shape (otter_subject_shares_index); nothing here derives a state.
// =============================================================================

const ME = 'u-me'
const row = (over = {}) => ({
  id: 'sh-1', subject_id: 's-1', subject_title: 'Modifiers', subject_is_stub: false,
  course_id: 'c-1', course_name: 'Blender 5.0', skill_level: 'beginner',
  shared_by: 'u-audrey', sharer_label: 'Audrey', shared_with: ME, receiver_label: 'Me',
  subject_owner_id: 'u-audrey', owner_label: 'Audrey', batch_id: null, via_share_id: null, chain_depth: 1,
  status: 'pending', state: 'pending', message: null, host_course_id: null, host_live: null,
  created_at: '2026-10-25T10:00:00Z', responded_at: null, ended_by: null, is_mine: false, is_owner: false,
  ...over,
})

describe('B2: the state words (design §5.3)', () => {
  it('every state in the owner\'s words; the receiver removing it reads differently from a withdrawal', () => {
    expect(shareStateWords(row({ state: 'pending' }))).toBe('waiting')
    expect(shareStateWords(row({ state: 'accepted' }))).toBe('accepted')
    expect(shareStateWords(row({ state: 'declined' }))).toBe('declined')
    expect(shareStateWords(row({ state: 'revoked', ended_by: 'u-audrey' }))).toBe('withdrawn')
    expect(shareStateWords(row({ state: 'revoked', ended_by: ME }))).toBe('they removed it')
    expect(shareStateWords(row({ state: 'gone' }))).toBe('no longer available')
  })
})

describe('B2: a failed call in words — a 409 is the function\'s sentence, a 500 is not a refusal', () => {
  it('passes a refusal through verbatim, words the one identifier, and never dresses a 500 as a refusal', () => {
    expect(shareFailureText(409, { error: 'this subject is already shared with that person' })).toBe('this subject is already shared with that person')
    expect(shareFailureText(409, { error: 'not_a_workspace_member' })).toBe(NOT_A_MEMBER_WORDS)
    expect(shareFailureText(500, { error: 'not_a_workspace_member' })).toBe(NOT_A_MEMBER_WORDS)
    expect(shareFailureText(501, { error: 'This O.T.T.E.R. feature needs a signed-in workspace.' })).toMatch(/signed-in workspace/)
    const lost = shareFailureText(500, { error: 'JWT expired' })
    expect(lost).not.toContain('JWT expired')
    expect(lost).toMatch(/did not reach the workspace \(HTTP 500\)/)
    expect(shareFailureText(0, null)).toMatch(/did not reach the workspace\./)
  })

  it('shareCall reads the body BEFORE ok, and a non-JSON body cannot replace the status', async () => {
    const res = (status, body) => ({ ok: status < 400, status, text: async () => body })
    expect(await shareCall(async () => res(200, '{"id":"x"}'), '/u')).toEqual({ ok: true, status: 200, data: { id: 'x' }, text: null })
    const refused = await shareCall(async () => res(409, '{"error":"that is their own subject"}'), '/u')
    expect(refused).toMatchObject({ ok: false, status: 409, text: 'that is their own subject' })
    const html = await shareCall(async () => res(500, '<!DOCTYPE html>'), '/u')
    expect(html.ok).toBe(false)
    expect(html.text).toMatch(/HTTP 500/)
    const thrown = await shareCall(async () => { throw new Error('offline') }, '/u')
    expect(thrown).toMatchObject({ ok: false, status: 0 })
  })
})

describe('B2: the loops stop at the first refusal; the rest stay as they were (design §5.3)', () => {
  const rows3 = [row({ id: 'a' }), row({ id: 'b', state: 'gone' }), row({ id: 'c' }), row({ id: 'd' })]

  it('Accept all: skips `gone` rows without a call, stops at the first other refusal', async () => {
    const calls = []
    const out = await runShareLoop(rows3, async (r) => { calls.push(r.id); return r.id === 'c' ? { ok: false, text: 'no' } : { ok: true } },
      { skip: (r) => r.state === 'gone' })
    expect(calls).toEqual(['a', 'c'])            // b skipped, d never reached
    expect(out.done.map(r => r.id)).toEqual(['a'])
    expect(out.skipped.map(r => r.id)).toEqual(['b'])
    expect(out.stoppedAt.id).toBe('c')
    expect(out.text).toBe('no')
  })

  it('Decline all: takes every row, gone ones included', async () => {
    const calls = []
    const out = await runShareLoop(rows3, async (r) => { calls.push(r.id); return { ok: true } })
    expect(calls).toEqual(['a', 'b', 'c', 'd'])
    expect(out.stoppedAt).toBeNull()
  })
})

describe('B2: "Shared with you" — the inbox (design §5.3)', () => {
  const shares = [
    row({ id: 'p1' }),
    row({ id: 'g1', state: 'gone' }),
    row({ id: 'dead', status: 'accepted', state: 'accepted', host_course_id: 'h', host_live: false }),
    row({ id: 'live', status: 'accepted', state: 'accepted', host_course_id: 'h', host_live: true }),
    row({ id: 'b2', batch_id: 'B', subject_title: 'Rigging' }),
    row({ id: 'b1', batch_id: 'B', subject_title: 'Armatures', state: 'gone' }),
    row({ id: 'theirs', shared_with: 'u-ben' }),
    row({ id: 'old', status: 'declined', state: 'declined' }),
  ]

  it('lists my pending rows (a gone one too) and my links whose host I trashed — nothing else', () => {
    expect(inboxRows(shares, ME).map(r => r.id)).toEqual(['p1', 'g1', 'dead', 'b2', 'b1'])
    expect(inboxRows(shares, null)).toEqual([])
    expect(shareInboxCount(shares, ME)).toBe(5)
  })

  it('a batch is ONE card, its rows in title order; every other row its own entry', () => {
    const entries = inboxEntries(inboxRows(shares, ME))
    expect(entries.map(e => (e.kind === 'batch' ? `batch:${e.rows.map(r => r.id).join(',')}` : e.row.id)))
      .toEqual(['p1', 'g1', 'dead', 'batch:b1,b2'])
  })

  it('the card\'s words: whose course, how many, and how many are no longer available', () => {
    const card = [row({ batch_id: 'B' }), row({ batch_id: 'B', state: 'gone' }), row({ batch_id: 'B' })]
    expect(batchCardTitle(card)).toBe('Audrey shared their course «Blender 5.0» with you: 3 subjects')
    expect(batchGoneLine(card)).toBe('1 of 3 is no longer available')
    expect(batchGoneLine([row()])).toBeNull()
  })

  it('an onward offer names who passed whose subject on', () => {
    const now = new Date('2026-10-27T10:00:00Z').getTime()
    expect(offerLine(row(), now)).toBe('from Audrey · Blender 5.0 · 2 days ago')
    expect(offerLine(row({ via_share_id: 'up', sharer_label: 'Ben' }), now)).toBe("Ben passes you Audrey's «Modifiers» · Blender 5.0 · 2 days ago")
  })

  it('the accept\'s sentence, one subject and a batch', () => {
    expect(acceptedSentence([row()], 'Blender 5.0')).toBe('«Modifiers» is now in your Blender 5.0 course, linked live from Audrey. It stays read-only; your progress is your own.')
    expect(acceptedSentence([row(), row(), row()], 'Blender 5.0')).toBe('3 subjects are now in your Blender 5.0 course, linked live from Audrey.')
  })
})

describe('B2: "Shared by you" — the owner\'s list and the chain line (design §5.3, §1.4)', () => {
  // Audrey (me here) shared S1 with Mara; Mara passed it on to Ben; Priya
  // waits on S1 too; a whole course went to Lee as a batch of two.
  const mine = (over) => row({ shared_by: ME, sharer_label: 'Me', subject_owner_id: ME, owner_label: 'Me', is_mine: true, is_owner: true, ...over })
  const shares = [
    mine({ id: 'm', shared_with: 'u-mara', receiver_label: 'Mara', status: 'accepted', state: 'accepted' }),
    row({ id: 'b', shared_by: 'u-mara', sharer_label: 'Mara', shared_with: 'u-ben', receiver_label: 'Ben', subject_owner_id: ME, owner_label: 'Me', via_share_id: 'm', chain_depth: 2, status: 'accepted', state: 'accepted', is_owner: true }),
    mine({ id: 'p', shared_with: 'u-priya', receiver_label: 'Priya' }),
    mine({ id: 'l1', shared_with: 'u-lee', receiver_label: 'Lee', batch_id: 'BL', subject_id: 's-2', subject_title: 'Rigging', status: 'accepted', state: 'accepted' }),
    mine({ id: 'l2', shared_with: 'u-lee', receiver_label: 'Lee', batch_id: 'BL', subject_id: 's-3', subject_title: 'Armatures' }),
    mine({ id: 'x', shared_with: 'u-zed', receiver_label: 'Zed', status: 'declined', state: 'declined' }),
  ]
  const byId = new Map(shares.map(r => [r.id, r]))

  it('lists the owner\'s rows and their own; groups a batch into one line; folds the decided', () => {
    const { live, decided } = sentEntries(sentRows(shares))
    expect(live.map(e => (e.kind === 'batch' ? `batch:${e.rows.map(r => r.id).join(',')}` : e.row.id))).toEqual(['m', 'b', 'p', 'batch:l2,l1'])
    expect(decided.map(e => e.row.id)).toEqual(['x'])
  })

  it('the chain line\'s *via* is resolved from the SAME list (the parent\'s receiver)', () => {
    expect(viaLabel(byId.get('b'), byId)).toBe('Mara')
    // The parent missing from the list: the row's own sharer label.
    expect(viaLabel(byId.get('b'), new Map())).toBe('Mara')
    expect(viaLabel(row({ via_share_id: 'gone-parent', sharer_label: 'Kim' }), byId)).toBe('Kim')
    expect(viaLabel(byId.get('m'), byId)).toBeNull()
  })

  it('a middle person\'s own onward rows name no via; the owner\'s view of the same row does (round 1, finding 3)', () => {
    // The owner sees Ben's row with Mara as its via.
    expect(sentPersonLine(byId.get('b'), byId)).toBe('Ben via Mara')
    // Mara sees the row SHE made: no "via Mara".
    expect(sentPersonLine({ ...byId.get('b'), is_mine: true, is_owner: false }, byId)).toBe('Ben')
    expect(sentPersonLine(byId.get('m'), byId)).toBe('Mara')
  })

  it('the batch line: who, how many, and the states counted', () => {
    expect(batchLine([byId.get('l1'), byId.get('l2')])).toBe('shared whole with Lee · 2 subjects · 1 accepted, 1 waiting')
  })

  it('Withdraw\'s confirm adds the chain\'s sentence when rows hang below; Withdraw all counts every row below', () => {
    expect(withdrawConfirmText(byId.get('p'), shares)).toBe('Priya will lose the link. Their own progress stays theirs.')
    expect(withdrawConfirmText(byId.get('m'), shares)).toBe('Mara will lose the link. Their own progress stays theirs. Removing it ends it for the 1 person it was passed on to, and for anyone they passed it on to.')
    expect(withdrawConfirmText([byId.get('m'), byId.get('p')], shares)).toMatch(/for the 1 person it was passed on to/)
  })

  it('the receiver\'s Remove counts only what THEY passed on', () => {
    const asMara = [
      row({ id: 'm', status: 'accepted', state: 'accepted', shared_with: ME }),
      row({ id: 'k1', shared_by: ME, is_mine: true, via_share_id: 'm', chain_depth: 2, status: 'pending', state: 'pending', shared_with: 'u-ben' }),
      row({ id: 'k2', shared_by: ME, is_mine: true, via_share_id: 'm', chain_depth: 2, status: 'accepted', state: 'accepted', shared_with: 'u-kim' }),
      row({ id: 'k3', shared_by: ME, is_mine: true, via_share_id: 'm', chain_depth: 2, status: 'declined', state: 'declined', shared_with: 'u-lee' }),
    ]
    expect(removeConfirmText(asMara[0], asMara)).toBe('It leaves your course. Your ticks are kept, and come back if it is shared with you again. Removing it ends it for the 2 people you passed it on to, and for anyone they passed it on to.')
    expect(removeConfirmText(asMara[1], asMara)).toBe('It leaves your course. Your ticks are kept, and come back if it is shared with you again.')
  })

  it('the owner\'s line under the subject: every live row, onward ones via their sharer, pending ones waiting', () => {
    expect(ownerShareLine(shares, 's-1')).toBe('Shared with Mara · Ben via Mara · Priya (waiting)')
    expect(ownerShareLine(shares, 'nothing')).toBeNull()
  })

  it('the delete confirm\'s sentence counts people, not rows', () => {
    expect(deleteShareSentence(shares, 's-1')).toBe('Shared with 3 people: the link stops for them while it is in the trash and ends when it is purged.')
    expect(deleteShareSentence(shares, 's-2')).toBe('Shared with 1 person: the link stops for them while it is in the trash and ends when it is purged.')
    expect(deleteShareSentence(shares, 's-9')).toBeNull()
  })
})

describe('B2: the linked subject inside the receiver\'s course (design §5.4)', () => {
  const host = (over) => row({ status: 'accepted', state: 'accepted', host_course_id: 'h-1', host_live: true, ...over })

  it('draws my accepted links hosted HERE and live, in accept order; a gone one stays (to be greyed)', () => {
    const shares = [
      host({ id: 'second', responded_at: '2026-10-26T00:00:00Z' }),
      host({ id: 'first', responded_at: '2026-10-25T00:00:00Z' }),
      host({ id: 'gone', state: 'gone', responded_at: '2026-10-27T00:00:00Z' }),
      host({ id: 'elsewhere', host_course_id: 'h-2' }),
      host({ id: 'dead-host', host_live: false }),
      row({ id: 'pending' }),
    ]
    expect(linkedRowsForHost(shares, 'h-1').map(r => r.id)).toEqual(['first', 'second', 'gone'])
    expect(isClosedLink(shares[2], new Set())).toBe(true)
    expect(isClosedLink(shares[0], new Set(['second']))).toBe(true)
    expect(isClosedLink(shares[1], new Set())).toBe(false)
  })

  it('the hint and the study line, an onward link naming who passed it on', () => {
    expect(linkedFromLine(host())).toBe("Linked from Audrey's Blender 5.0 · read only")
    expect(linkedFromLine(host(), { study: true })).toBe("Linked from Audrey's Blender 5.0 · read only · you see their edits as they make them")
    expect(linkedFromLine(host({ via_share_id: 'up', sharer_label: 'Ben' }), { study: true })).toBe("Linked from Audrey's Blender 5.0 via Ben · read only · you see their edits as they make them")
  })

  it('a 404\'s words are chosen by the index\'s state; anything but revoked reads as gone', () => {
    expect(linkClosedWords(host({ state: 'revoked' }))).toBe('«Modifiers» is no longer shared with you.')
    expect(linkClosedWords(host({ state: 'gone' }))).toBe('«Modifiers» is no longer available: the owner removed it. It comes back if they restore it.')
    expect(linkClosedWords(host({ state: 'accepted' }))).toMatch(/no longer available: the owner removed it/)
    expect(linkClosedWords(null, 'Modifiers')).toMatch(/^«Modifiers» is no longer available/)
  })

  it('a link a 404 closed reopens when the owner RESTORES it (gone → accepted); one that 404d while accepted stays closed (round 1, finding 2)', () => {
    const closed = new Map([['restored', 'gone'], ['odd', 'accepted'], ['still', 'gone']])
    const rows = [host({ id: 'restored' }), host({ id: 'odd' }), host({ id: 'still', state: 'gone' })]
    const next = reopenRestoredLinks(closed, rows)
    expect([...next.keys()]).toEqual(['odd', 'still'])
    expect(closed.size, 'the Map it was given is not changed').toBe(3)
    // Nothing to reopen: the same Map back (no needless re-render).
    expect(reopenRestoredLinks(next, rows)).toBe(next)
    const empty = new Map()
    expect(reopenRestoredLinks(empty, rows)).toBe(empty)
  })

  it('a row closed while accepted, then trashed, is remembered as gone, so the restore after it reopens it (round 2, note 4a)', () => {
    const closed = new Map([['odd', 'accepted']])
    const trashed = reopenRestoredLinks(closed, [host({ id: 'odd', state: 'gone' })])
    expect(trashed).not.toBe(closed)
    expect(trashed.get('odd')).toBe('gone')
    expect(closed.get('odd'), 'the Map it was given is not changed').toBe('accepted')
    expect(reopenRestoredLinks(trashed, [host({ id: 'odd' })]).has('odd')).toBe(false)
  })

  it('a 404 whose re-read failed says only that it could not be read', () => {
    expect(linkUnreadWords('Modifiers')).toBe('«Modifiers» could not be read just now. Try again in a moment.')
  })

  it('the readable set changes when a link ends, goes, or loses its host — and not otherwise', () => {
    const a = [host({ id: '1' }), host({ id: '2', subject_id: 's-2' })]
    expect(acceptedSignature(a)).toBe(acceptedSignature([...a].reverse()))
    expect(acceptedSignature(a)).not.toBe(acceptedSignature([a[0], { ...a[1], state: 'gone' }]))
    expect(acceptedSignature(a)).not.toBe(acceptedSignature([a[0], { ...a[1], status: 'revoked', state: 'revoked' }]))
    expect(acceptedSignature(a)).not.toBe(acceptedSignature([a[0], { ...a[1], host_live: false }]))
  })
})

describe('B2: the share dialog\'s words (design §5.2), verbatim', () => {
  it('each mode\'s contract line', () => {
    expect(shareContractLine('subject', { courseName: 'Blender 5.0' })).toBe('They will read this one subject inside their own «Blender 5.0» course, live and read-only, once they accept. Nothing else in your course is shared, and their progress is their own.')
    expect(shareContractLine('course', { courseName: 'Blender 5.0', subjectCount: 7 })).toBe('They will read all 7 subjects inside their own «Blender 5.0» course, live and read-only, once they accept them. Subjects you add later are not included: O.T.T.E.R. will ask you. Nothing else in your course is shared, and their progress is their own.')
    expect(shareContractLine('passOn', { courseName: 'Blender 5.0', ownerLabel: 'Audrey', subjectTitle: 'Modifiers' })).toBe("They will read Audrey's «Modifiers» inside their own «Blender 5.0» course, live and read-only, once they accept. If Audrey withdraws it from you, they lose it too, and Audrey sees every link.")
  })

  it('the successes, and what a whole course skipped', () => {
    expect(sharedSentence(['Mara'])).toBe('Shared with Mara. It is waiting for them to accept.')
    expect(sharedSentence(['Mara', 'Ben', 'Priya'])).toBe('Shared with Mara, Ben and Priya. It is waiting for them to accept.')
    expect(sharedCourseSentence('Mara', 7)).toBe('Shared your course with Mara: 7 subjects, waiting for them to accept.')
    expect(sharedCourseSentence('Mara', 6, ['Modifiers'])).toBe('Shared your course with Mara: 6 subjects, waiting for them to accept. «Modifiers» was already shared with them.')
    expect(courseCountLine([{ is_stub: true }, { is_stub: true }, {}, {}, {}, {}, {}])).toBe('7 subjects, 2 of them outlines')
  })

  it('pass-on leaves out the owner, me, and everyone my own rows show holding it live', () => {
    const mine = row({ id: 'mine', status: 'accepted', state: 'accepted', shared_by: 'u-mara', shared_with: ME })
    const shares = [
      mine,
      row({ id: 'onward', shared_by: ME, shared_with: 'u-ben', via_share_id: 'mine', status: 'pending', state: 'pending' }),
      row({ id: 'ended', shared_by: ME, shared_with: 'u-kim', via_share_id: 'mine', status: 'declined', state: 'declined' }),
      row({ id: 'other', subject_id: 's-9', shared_by: ME, shared_with: 'u-lee' }),
    ]
    expect([...passOnExcluded(shares, mine, ME)].sort()).toEqual(['u-audrey', 'u-ben', 'u-mara', 'u-me'])
  })
})

describe('B2: the reminder\'s plan (design §5.9)', () => {
  const batchRow = (over) => row({ batch_id: 'B', course_id: 'c-1', is_owner: true, shared_by: ME, ...over })
  const shares = [
    batchRow({ id: '1', shared_with: 'u-mara', receiver_label: 'Mara' }),
    batchRow({ id: '2', shared_with: 'u-mara', receiver_label: 'Mara', subject_id: 's-2', status: 'accepted', state: 'accepted' }),
    batchRow({ id: '3', shared_with: 'u-ben', receiver_label: 'Ben' }),
    batchRow({ id: '4', shared_with: 'u-kim', receiver_label: 'Kim', status: 'declined', state: 'declined' }),
    batchRow({ id: '5', shared_with: 'u-lee', receiver_label: 'Lee', course_id: 'c-2' }),
    row({ id: '6', shared_with: 'u-zed', receiver_label: 'Zed', course_id: 'c-1', is_owner: true }),   // a single share: no batch
  ]
  const listAfter = [
    { id: 'id-old', slug: 'old' }, { id: 'id-new', slug: 'new-one', title: 'New one' }, { id: 'id-two', slug: 'two', title: 'Two' },
  ]

  it('only slugs the course did not hold before: a re-save, a re-import and a declined one are not new', () => {
    expect(newSlugsOf(['old', 'two'], ['old', 'new-one', 'two', 'new-one'])).toEqual(['new-one'])
    expect(newSlugsOf(null, ['x'])).toEqual([])
  })

  it('the people: my live batch rows on this course, one entry each', () => {
    expect(batchReceivers(shares, 'c-1')).toEqual([{ userId: 'u-mara', label: 'Mara' }, { userId: 'u-ben', label: 'Ben' }])
  })

  it('maps the new slugs to the ids subject.list returned after the saves; nothing for a new course or with no people', () => {
    const plan = planNewSubjectReminder({ shares, courseId: 'c-1', slugsBefore: ['old'], slugsSaved: ['old', 'new-one', 'two'], listAfter })
    expect(plan.subjects).toEqual([{ id: 'id-new', slug: 'new-one', title: 'New one' }, { id: 'id-two', slug: 'two', title: 'Two' }])
    expect(plan.people.map(p => p.label)).toEqual(['Mara', 'Ben'])
    expect(planNewSubjectReminder({ shares, courseId: 'c-1', slugsBefore: null, slugsSaved: ['new-one'], listAfter })).toBeNull()
    expect(planNewSubjectReminder({ shares, courseId: 'c-9', slugsBefore: [], slugsSaved: ['new-one'], listAfter })).toBeNull()
    expect(planNewSubjectReminder({ shares, courseId: 'c-1', slugsBefore: ['old', 'new-one', 'two'], slugsSaved: ['two'], listAfter })).toBeNull()
    // A saved slug the list does not hold (the save was refused) is not offered.
    expect(planNewSubjectReminder({ shares, courseId: 'c-1', slugsBefore: [], slugsSaved: ['ghost'], listAfter })).toBeNull()
  })

  it('the calls: each new subject for each ticked person, less a pair already held', () => {
    const plan = planNewSubjectReminder({ shares: [...shares, row({ subject_id: 'id-two', shared_with: 'u-ben', status: 'pending', state: 'pending' })],
      courseId: 'c-1', slugsBefore: ['old'], slugsSaved: ['new-one', 'two'], listAfter })
    expect(reminderPairs(plan, ['u-mara', 'u-ben']).map(p => `${p.subject.id}>${p.person.userId}`))
      .toEqual(['id-new>u-mara', 'id-new>u-ben', 'id-two>u-mara'])
    expect(reminderPairs(plan, ['u-ben']).map(p => `${p.subject.id}>${p.person.userId}`)).toEqual(['id-new>u-ben'])
  })

  it('its two lines, verbatim', () => {
    expect(reminderTitle(1)).toBe('Share the new subject too?')
    expect(reminderTitle(7)).toBe('Share the 7 new subjects too?')
    expect(reminderLine('Blender 5.0', ['Mara', 'Ben'])).toBe('You shared «Blender 5.0» whole with Mara and Ben. New subjects are not shared with them unless you say so.')
  })
})
