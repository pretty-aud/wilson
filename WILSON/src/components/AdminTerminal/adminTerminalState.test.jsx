/** @vitest-environment jsdom */
// =============================================================================
// adminTerminalState.test.jsx — UI overhaul C3b, 2026-09-12.
//
// 🚨 WHY THIS FILE EXISTS. C3 extracted every inline hover / selected /
// active / disabled branch on this surface into `data-*` attributes plus
// `adminTerminal.css`, and guarded the extraction with `adminTerminalCss.test.js`
// — a SOURCE SCAN. That guard proves each attribute is written as
// `String(<expression>)` and that a rule exists for it. It cannot prove the
// expression is the RIGHT boolean: `data-on={String(!on)}` passes it, and
// every toggle on the surface would render inverted.
//
// Both of C3's adversarial review rounds left that hole open and its hand-off
// §7.0 names closing it as this session's first debt. These are the four
// tests. They MOUNT the real components and assert the attribute against the
// prop that is supposed to drive it, both ways round, so an inverted or
// swapped expression fails here even though the source scan still passes.
//
// Deliberately the *state* attributes, not the styling: this file must keep
// passing unchanged through the whole C3b conversion. If a later edit makes
// it fail, the conversion inverted a state — which is exactly the thing
// nobody would otherwise see until a customer was in it.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

// The Supabase client is constructed at module load and throws
// 'supabaseUrl is required' without a .env.local, which is every CI run
// (pages.test.js and DashboardTasksView.test.jsx carry the same mock).
vi.mock('../../cloud/auth/supabaseClient', () => ({
  supabase: {},
  hydrateSupabase: async () => {},
}))

// UsersSection subscribes to workspace events through the RABBIT provider.
// The subscription is optional-chained at its call site, so an empty context
// is a faithful stand-in and mounting the real provider is not needed.
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({
  useRabbit: () => ({}),
}))

// The detail panel lazy-loads a per-member security summary from an Edge
// Function on open. It drives the SECURITY group only — never the two rate
// card toggles this file asserts — so it resolves to a refusal, which is
// also what the surface really gets in tester mode.
vi.mock('../../cloud/adminApi', () => ({
  adminUserSecurity: async () => ({ ok: false, status: 403, data: {} }),
  adminResetPassword: async () => ({ ok: false, status: 403, data: {} }),
  adminSetActive: async () => ({ ok: false, status: 403, data: {} }),
}))

const { default: UsersSection } = await import('./UsersSection')
const { default: MultiInviteDialog } = await import('./MultiInviteDialog')

afterEach(() => cleanup())

// Two members that differ in every boolean this file asserts, so a single
// fixture covers both branches of all three attributes.
const ADA = {
  user_id: 'u-ada',
  username: 'ada',
  display_name: 'Ada Lovelace',
  role: 'admin',
  is_active: true,
  grant_rate_card_view: true,
  grant_rate_card_edit: true,
  joined_at: '2026-01-04T10:00:00.000Z',
}
const GRACE = {
  user_id: 'u-grace',
  username: 'grace',
  display_name: 'Grace Hopper',
  role: 'user',
  is_active: false,
  grant_rate_card_view: false,
  grant_rate_card_edit: false,
  joined_at: '2026-02-09T10:00:00.000Z',
}

function wmFixture(members) {
  return {
    members,
    userId: 'u-someone-else',
    ready: true,
    loading: false,
    error: null,
    clearError: vi.fn(),
    reload: vi.fn(),
    setRole: vi.fn(async () => {}),
    updateMember: vi.fn(async () => {}),
    injectMember: vi.fn(),
  }
}

/**
 * The roster <tr> for a member, found through the name its first cell renders.
 *
 * Scoped to the table body on purpose: the detail panel renders the SAME name
 * as its heading, so an unscoped lookup finds two nodes the moment a row is
 * clicked — which is every assertion that matters here.
 */
function rosterRow(name) {
  return within(document.querySelector('table tbody')).getByText(name).closest('tr')
}

describe('the roster row reflects the member it was rendered from', () => {
  // data-selected — C3 moved `backgroundColor: selected ? 'rgba(234,88,12,0.1)' : …`
  // out of the row's inline style. Nothing but a click sets it, so a
  // constant-true or inverted expression would paint every row selected.
  it('marks only the clicked row data-selected, and marks none before a click', () => {
    render(<UsersSection wm={wmFixture([ADA, GRACE])} />)

    expect(rosterRow('Ada Lovelace').getAttribute('data-selected')).toBe('false')
    expect(rosterRow('Grace Hopper').getAttribute('data-selected')).toBe('false')

    fireEvent.click(rosterRow('Ada Lovelace'))
    expect(rosterRow('Ada Lovelace').getAttribute('data-selected')).toBe('true')
    expect(rosterRow('Grace Hopper').getAttribute('data-selected')).toBe('false')

    // The selection MOVES rather than accumulating — the one thing a
    // single-selection table must not get wrong.
    fireEvent.click(rosterRow('Grace Hopper'))
    expect(rosterRow('Ada Lovelace').getAttribute('data-selected')).toBe('false')
    expect(rosterRow('Grace Hopper').getAttribute('data-selected')).toBe('true')
  })

  // data-inactive — the deactivated treatment. It is the NEGATION of
  // `is_active`, which is the single likeliest expression to ship inverted,
  // and inverted it would grey out every working account on the page.
  it('marks the deactivated member data-inactive and the active one not', () => {
    render(<UsersSection wm={wmFixture([ADA, GRACE])} />)

    expect(rosterRow('Ada Lovelace').getAttribute('data-inactive')).toBe('false')
    expect(rosterRow('Grace Hopper').getAttribute('data-inactive')).toBe('true')
  })
})

describe('the rate card toggles reflect the grants they were rendered from', () => {
  // aria-checked — ToggleRow is private to UsersSection, so it is reached the
  // way an admin reaches it: click a roster row, the detail panel opens, the
  // two grant toggles are in the ACCESS group.
  //
  // 🚨 THE ASSERTION IS `aria-checked`, NOT `data-on`, and deliberately so.
  // C3's extraction wrote `data-on`; C3b's conversion replaced the whole
  // hand-rolled track with the kit `Switch`, which has its own state
  // spelling. `aria-checked` is the one attribute BOTH spellings carried, so
  // this guard proved the boolean before the swap and proves it after —
  // which is the only reason a state test written against the old markup was
  // worth writing at all.
  function openPanelFor(name) {
    fireEvent.click(rosterRow(name))
    return screen.getByRole('switch', { name: 'Can view rate card' })
  }

  it('renders both toggles on for a member holding both grants', () => {
    render(<UsersSection wm={wmFixture([ADA, GRACE])} />)
    openPanelFor('Ada Lovelace')

    expect(screen.getByRole('switch', { name: 'Can view rate card' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Can edit rate card' }).getAttribute('aria-checked')).toBe('true')
  })

  it('renders both toggles off for a member holding neither grant', () => {
    render(<UsersSection wm={wmFixture([ADA, GRACE])} />)
    openPanelFor('Grace Hopper')

    expect(screen.getByRole('switch', { name: 'Can view rate card' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Can edit rate card' }).getAttribute('aria-checked')).toBe('false')
  })

  // View is on when EITHER grant is held, because edit includes view — a
  // real asymmetry in the expression, and the reason `data-on` is not simply
  // `String(!!member.grant_rate_card_view)`. `data-disabled` rides the same
  // branch and is asserted here so the pair cannot drift apart.
  it('shows view on and disabled when only edit is held, since edit includes view', () => {
    const editOnly = { ...GRACE, is_active: true, grant_rate_card_edit: true }
    render(<UsersSection wm={wmFixture([editOnly])} />)
    openPanelFor('Grace Hopper')

    const view = screen.getByRole('switch', { name: 'Can view rate card' })
    expect(view.getAttribute('aria-checked')).toBe('true')
    expect(view.disabled).toBe(true)
    expect(screen.getByRole('switch', { name: 'Can edit rate card' }).disabled).toBe(false)
  })
})

describe('the invite row reflects the username typed into it', () => {
  // data-invalid — the red edge on a username the Edge Function will reject.
  // It is a negation of a regex test, so inverted it would mark every
  // ACCEPTABLE username as broken and none of the broken ones.
  it('flags a username that fails the pattern and clears the flag when it passes', () => {
    render(<MultiInviteDialog open onClose={vi.fn()} onInvited={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(/paste emails/i), {
      target: { value: 'sam@example.com' },
    })

    const name = screen.getByLabelText('Username for sam@example.com')
    // Derived from the address, so it starts valid.
    expect(name.getAttribute('data-invalid')).toBe('false')

    // One character: the pattern's floor is two.
    fireEvent.change(name, { target: { value: 'a' } })
    expect(screen.getByLabelText('Username for sam@example.com').getAttribute('data-invalid')).toBe('true')

    fireEvent.change(screen.getByLabelText('Username for sam@example.com'), { target: { value: 'sammy' } })
    expect(screen.getByLabelText('Username for sam@example.com').getAttribute('data-invalid')).toBe('false')
  })

  // data-sent — the other half of the same row's state, and the one that
  // must never start true: a row marked sent is not re-sent by the retry.
  it('leaves a freshly parsed row not-sent', () => {
    render(<MultiInviteDialog open onClose={vi.fn()} onInvited={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(/paste emails/i), {
      target: { value: 'sam@example.com' },
    })

    const row = screen.getByLabelText('Username for sam@example.com').closest('.at-invite-row')
    expect(row.getAttribute('data-sent')).toBe('false')
    expect(within(row).getByLabelText('Username for sam@example.com')).toBeTruthy()
  })
})
