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
