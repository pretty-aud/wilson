/** @vitest-environment jsdom */
// =============================================================================
// teamAssignments.test.js — MO1 (0110, MOTH_DESIGN §2.2 SEC-1): the Team page's
// Assigned-projects column draws no 'Untitled' for a project the reader cannot see
// and no 'Personal space', from the same rows the page reads. The fixtures' rows
// carry a real personal seat for each of two people.
// =============================================================================
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('../../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  hydrateSupabase: async () => null,
}))

const { assignmentsFromSeats } = await import('./TeamMembersPage')
const { buildDevFixtures } = await import('../../dev/fixtures/install')

describe('assignmentsFromSeats', () => {
  it('a seat whose project is hidden, or a personal space, is nobody\'s assignment', () => {
    const map = assignmentsFromSeats([
      { user_id: 'u1', projects: { title: 'Salt Hours', deleted_at: null } },
      { user_id: 'u1', projects: null },
      { user_id: 'u1', projects: { title: 'Personal space', deleted_at: null, personal_owner_id: 'u1' } },
      { user_id: 'u2', projects: { title: 'Personal space', deleted_at: null, personal_owner_id: 'u2' } },
    ])
    expect(map.get('u1')).toEqual(['Salt Hours'])
    expect(map.has('u2')).toBe(false)
  })

  it('FAILING CONTROL: a project with no title still shows, and a binned one does not', () => {
    const map = assignmentsFromSeats([
      { user_id: 'u1', projects: { title: '', deleted_at: null, personal_owner_id: null } },
      { user_id: 'u1', projects: { title: 'Binned', deleted_at: '2026-01-01' } },
    ])
    expect(map.get('u1')).toEqual(['Untitled'])
  })

  it('the fixtures: every person keeps their real project, and nobody has a personal space', () => {
    const { data } = buildDevFixtures().workspace.listProjectMemberships()
    expect(data.some(r => r.projects?.title === 'Personal space')).toBe(true)
    const titles = [...assignmentsFromSeats(data).values()].flat()
    expect(titles.length).toBeGreaterThan(0)
    expect(new Set(titles)).toEqual(new Set(['Salt Hours']))
  })
})

describe('the page reads the owner column only where it exists', () => {
  const src = readFileSync(resolve(__dirname, 'TeamMembersPage.jsx'), 'utf8')
  it('behind the probe, and "not now" reads nothing', () => {
    expect(src).toContain("projects(title, deleted_at${personal ? ', personal_owner_id' : ''})")
    expect(src).toContain('await personalSpacesAvailable(supabase)')
    expect(src).toContain('if (personal === null) { setAssignments(new Map()); return }')
  })
})
