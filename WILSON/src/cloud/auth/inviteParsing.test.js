// Unit tests for the Session 9 multi-invite parser. Pure functions — no
// Supabase, no DOM.

import { describe, it, expect } from 'vitest'
import { USERNAME_RE, deriveUsername, parseInviteList } from './inviteParsing'

describe('parseInviteList', () => {
  it('splits on commas, semicolons, whitespace and newlines', () => {
    const { entries, invalid } = parseInviteList(
      'a@x.com, b@x.com;c@x.com\nd@x.com  e@x.com',
    )
    expect(entries.map(e => e.email)).toEqual([
      'a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com',
    ])
    expect(invalid).toEqual([])
  })

  it('accepts "Name <email>" forms, including next to bare emails', () => {
    const { entries, invalid } = parseInviteList(
      'plain@x.com, Jane Doe <JANE@X.COM>\nBob <bob@y.co>',
    )
    expect(entries.map(e => e.email)).toEqual([
      'jane@x.com', 'bob@y.co', 'plain@x.com',
    ])
    expect(invalid).toEqual([])
  })

  it('lowercases and dedupes emails case-insensitively', () => {
    const { entries } = parseInviteList('A@X.com a@x.COM a@x.com other@x.com')
    expect(entries.map(e => e.email)).toEqual(['a@x.com', 'other@x.com'])
  })

  it('collects invalid shapes without dropping valid ones', () => {
    const { entries, invalid } = parseInviteList('notanemail, ok@x.com, foo@bar, @x.com')
    expect(entries.map(e => e.email)).toEqual(['ok@x.com'])
    expect(invalid).toContain('notanemail')
    expect(invalid).toContain('foo@bar') // TLD must be 2+ chars
    expect(invalid).toContain('@x.com')
  })

  it('derives usernames from localparts and dedupes within the batch', () => {
    const { entries } = parseInviteList('jane@a.com jane@b.com jane@c.com')
    expect(entries.map(e => e.username)).toEqual(['jane', 'jane2', 'jane3'])
    for (const e of entries) expect(e.username).toMatch(USERNAME_RE)
  })
})

describe('deriveUsername', () => {
  it('sanitizes weird unicode and symbols into the allowed alphabet', () => {
    expect(deriveUsername('jöhn.dõe@x.com')).toBe('j.hn.d.e')
    expect(deriveUsername('jane+test@x.com')).toBe('jane.test')
    // Leading non-alphanumerics stripped (first char must be [a-z0-9]).
    expect(deriveUsername('--_.jane@x.com')).toBe('jane')
    expect(deriveUsername('jöhn.dõe@x.com')).toMatch(USERNAME_RE)
  })

  it('pads short localparts and falls back when nothing survives', () => {
    expect(deriveUsername('x@y.com')).toBe('userx')
    expect(deriveUsername('@y.com')).toBe('user.invite')
    expect(deriveUsername('')).toBe('user.invite')
  })

  it('truncates to 32 chars, including numeric-suffix forms', () => {
    const long = `${'a'.repeat(40)}@x.com`
    expect(deriveUsername(long)).toBe('a'.repeat(32))
    const taken = new Set(['a'.repeat(32)])
    expect(deriveUsername(long, taken)).toBe(`${'a'.repeat(31)}2`)
    expect(deriveUsername(long, taken)).toMatch(USERNAME_RE)
  })

  it('dedupes against takenSet without mutating it', () => {
    const taken = new Set(['jane', 'jane2'])
    expect(deriveUsername('jane@x.com', taken)).toBe('jane3')
    expect([...taken]).toEqual(['jane', 'jane2']) // caller adds, not us
  })
})
