// =============================================================================
// courseBadges.test.js — 2026-08-12.
//
// Audrey, after finding the share menu: "make sure to indicate visually when a
// course is company shared, your own and if its shared directly by someone
// else."
//
// The badge used to key on `visibility` ALONE, so a course YOU shared with the
// company and a course SOMEONE ELSE shared rendered the identical blue chip —
// the two states a person most needs to tell apart in a mixed library. This
// pins the four origins as a PURE FUNCTION, so the rules are asserted rather
// than scanned: vitest runs in `environment: 'node'` with no jsdom, so nothing
// in this repo can mount a component, and a source scan could only prove the
// strings exist, not that the right one is chosen.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { originOf } from './CourseBadges.jsx'

const mine    = (visibility) => ({ visibility, is_own: true,  owner_label: 'Audrey' })
const theirs  = (visibility) => ({ visibility, is_own: false, owner_label: 'Bob' })
/** LOCAL (signed-out Electron) mode: the Express server sends no is_own. */
const local   = (visibility) => ({ visibility })

describe('the four origins a course row can have', () => {
  it('tells YOUR shared course from SOMEONE ELSE\'S — the whole point', () => {
    expect(originOf(undefined, mine('shared'))).toBe('shared')
    expect(originOf(undefined, theirs('shared'))).toBe('from_someone')
  })

  it('marks a course that is only yours', () => {
    expect(originOf(undefined, mine('personal'))).toBe('own')
  })

  it('treats company standard as the tier, whoever owns it', () => {
    expect(originOf(undefined, mine('company_standard'))).toBe('company_standard')
    expect(originOf(undefined, theirs('company_standard'))).toBe('company_standard')
  })
})

describe('the edges that have bitten this codebase before', () => {
  it('a MISSING is_own reads as yours, because local mode sends none', () => {
    // The `!== false` test is load-bearing, exactly as in otterSharing.js.
    // Reading undefined as "someone else's" would badge every course in a
    // single-user desktop install as shared with you by a stranger.
    expect(originOf(undefined, local('personal'))).toBe('own')
    expect(originOf(undefined, local('shared'))).toBe('shared')
  })

  it('an explicit is_own:false is the only thing that means someone else', () => {
    expect(originOf(undefined, { visibility: 'shared', is_own: false })).toBe('from_someone')
    expect(originOf(undefined, { visibility: 'shared', is_own: undefined })).toBe('shared')
    expect(originOf(undefined, { visibility: 'shared', is_own: null })).toBe('shared')
  })

  it('falls back to the tier when there is no row at all', () => {
    // The dialog header and the trash list pass a bare visibility string.
    expect(originOf('company_standard', undefined)).toBe('company_standard')
    expect(originOf('shared', undefined)).toBe('shared')
    expect(originOf('personal', undefined)).toBe('own')
    expect(originOf(undefined, undefined)).toBe('own')
  })

  it('an unknown or absent visibility never crashes and never over-claims', () => {
    expect(originOf(undefined, { is_own: true })).toBe('own')
    expect(originOf(undefined, theirs(undefined))).toBe('personal')
    // A colleague's row with no tier is the admin metadata-only case; it must
    // NOT be badged "Yours", and MetadataOnlyBadge labels it separately.
    expect(originOf(undefined, theirs('personal'))).toBe('personal')
  })

  it('the explicit visibility argument wins over the row', () => {
    // ShareCourseDialog passes `current`, which it has already re-read from the
    // server response — it is fresher than the row it was opened with.
    expect(originOf('company_standard', mine('personal'))).toBe('company_standard')
  })
})
