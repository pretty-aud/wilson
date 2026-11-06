// =============================================================================
// authEventLabels.test.js — Track B bundle B2, part 2. Every (kind, outcome)
// pair 0070 can produce has a label; the source and surface read correctly;
// the filters partition the rows the way the two views promise.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  describeAuthEvent, surfaceOf, sourceLabel, matchesFilter, KIND_FILTERS, AUTH_EVENT_COLUMNS,
} from './authEventLabels'

const KINDS = ['sign_in', 'mfa_verify', 'sign_out', 'idle_timeout', 'session_cap']

describe('describeAuthEvent', () => {
  it('names every pair the table can hold, and tones failures as bad', () => {
    for (const kind of KINDS) {
      for (const outcome of ['success', 'failure']) {
        const d = describeAuthEvent({ kind, outcome })
        expect(d.label).toBeTruthy()
        if (outcome === 'failure') expect(d.tone).toBe('bad')
      }
    }
    expect(describeAuthEvent({ kind: 'sign_in', outcome: 'success' })).toEqual({ label: 'Signed in', tone: 'ok' })
    expect(describeAuthEvent({ kind: 'mfa_verify', outcome: 'failure' })).toEqual({ label: 'Two-factor failed', tone: 'bad' })
    expect(describeAuthEvent({ kind: 'idle_timeout', outcome: 'success' }).label).toBe('Signed out (idle)')
    expect(describeAuthEvent({ kind: 'session_cap', outcome: 'success' }).label).toBe('Signed out (4-hour limit)')
  })

  it('does not throw on a row it has never seen', () => {
    expect(describeAuthEvent({ kind: 'future_kind', outcome: 'success' }).label).toContain('future_kind')
    expect(describeAuthEvent(null).tone).toBe('neutral')
  })
})

describe('source and surface', () => {
  it('reads the surface from a client row only', () => {
    expect(surfaceOf({ source: 'client', context: { surface: 'admin' } })).toBe('admin')
    expect(surfaceOf({ source: 'client', context: { surface: 'app' } })).toBe('app')
    expect(surfaceOf({ source: 'client', context: {} })).toBe(null)
    expect(surfaceOf({ source: 'gotrue_hook', context: { surface: 'admin' } })).toBe(null)
  })

  it('labels the three writers', () => {
    expect(sourceLabel({ source: 'gotrue_hook' })).toBe('sign-in server')
    expect(sourceLabel({ source: 'client', context: { surface: 'admin' } })).toBe('operator console')
    expect(sourceLabel({ source: 'client', context: { surface: 'app' } })).toBe('app')
    expect(sourceLabel({ source: 'client', context: {} })).toBe('client')
  })
})

describe('filters', () => {
  const rows = [
    { kind: 'sign_in', outcome: 'success' },
    { kind: 'sign_in', outcome: 'failure' },
    { kind: 'mfa_verify', outcome: 'failure' },
    { kind: 'sign_out', outcome: 'success' },
    { kind: 'idle_timeout', outcome: 'success' },
    { kind: 'session_cap', outcome: 'success' },
  ]
  const count = (f) => rows.filter(r => matchesFilter(r, f)).length

  it('partition as the select promises', () => {
    expect(count('')).toBe(6)
    expect(count('sign_in')).toBe(2)
    expect(count('failure')).toBe(2)
    expect(count('mfa_verify')).toBe(1)
    expect(count('ended')).toBe(3)
  })

  it('every option in the select is a filter that matches something here', () => {
    for (const [value] of KIND_FILTERS) expect(count(value)).toBeGreaterThan(0)
  })
})

describe('the column list', () => {
  it('names the columns 0070 defines and nothing else', () => {
    const cols = AUTH_EVENT_COLUMNS.split(',').map(s => s.trim())
    expect(cols).toEqual([
      'id', 'user_id', 'workspace_id', 'session_id', 'kind', 'outcome', 'source',
      'factor_type', 'ip_address', 'user_agent', 'context', 'created_at',
    ])
  })
})
