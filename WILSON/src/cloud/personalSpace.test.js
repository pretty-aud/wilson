// =============================================================================
// personalSpace.test.js — MO1 (0110, MOTH_DESIGN §2.2 PS-1, PS-9): the classifier,
// the once-per-session probe in its three answers, and what Files calls a space.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'

const answering = (error) => {
  const asks = []
  return {
    asks,
    from: (table) => ({
      select: (cols) => ({
        limit: async () => { asks.push({ table, cols }); return { error } },
      }),
    }),
  }
}

let mod
beforeEach(async () => { vi.resetModules(); mod = await import('./personalSpace') })

describe('isPersonalSpace', () => {
  it('a row with an owner, or the desktop bundle that says so', () => {
    expect(mod.isPersonalSpace({ personal_owner_id: 'u1' })).toBe(true)
    expect(mod.isPersonalSpace({ personal: true })).toBe(true)
  })
  it('CONTROL: a private project, an empty owner, and no row at all are not', () => {
    expect(mod.isPersonalSpace({ is_private: true })).toBe(false)
    expect(mod.isPersonalSpace({ personal_owner_id: null })).toBe(false)
    expect(mod.isPersonalSpace({ personal: false })).toBe(false)
    expect(mod.isPersonalSpace(null)).toBe(false)
  })
})

describe('personalSpacesAvailable', () => {
  it('the column answers: true, remembered, asked once', async () => {
    const c = answering(null)
    expect(await mod.personalSpacesAvailable(c)).toBe(true)
    expect(await mod.personalSpacesAvailable(c)).toBe(true)
    expect(c.asks).toEqual([{ table: 'projects', cols: 'personal_owner_id' }])
  })
  it('a database without it: false, remembered', async () => {
    const c = answering({ code: '42703', message: 'column projects.personal_owner_id does not exist' })
    expect(await mod.personalSpacesAvailable(c)).toBe(false)
    expect(await mod.personalSpacesAvailable(c)).toBe(false)
    expect(c.asks).toHaveLength(1)
  })
  it('a failure that says nothing about the column: null ("not now"), asked again next time', async () => {
    const c = answering({ code: '503', message: 'network' })
    expect(await mod.personalSpacesAvailable(c)).toBe(null)
    expect(await mod.personalSpacesAvailable(c)).toBe(null)
    expect(c.asks).toHaveLength(2)
  })
})

describe('personalSpaceLabel', () => {
  const members = [
    { user_id: 'priya', display_name: 'Priya Raman', is_active: true },
    { user_id: 'theo', display_name: 'Theo Lindqvist', is_active: false },
  ]
  const label = (row, me = 'mara', known = true) => mod.personalSpaceLabel(row, { me, members, membersKnown: known })
  it('the owner sees "My personal space"; the desktop says where it is', () => {
    expect(label({ personal_owner_id: 'mara' })).toBe('My personal space')
    expect(label({ personal: true }, null)).toBe('Personal space on this computer')
  })
  it('an admin sees the owner\'s name, and what is known about them', () => {
    expect(label({ personal_owner_id: 'priya' })).toBe('Personal space · Priya Raman')
    expect(label({ personal_owner_id: 'theo' })).toBe('Personal space · Theo Lindqvist (inactive)')
    expect(label({ personal_owner_id: 'gone' })).toBe('Personal space · (former member)')
  })
  it('until the members have loaded nobody is called a former member', () => {
    expect(label({ personal_owner_id: 'gone' }, 'mara', false)).toBe('Personal space')
  })
})
