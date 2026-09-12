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
// Deliberately the *state*, not the styling. The intent was that this file
// pass unchanged through the C3b conversion, and it very nearly did: the
// toggle assertions moved from `data-on` to `aria-checked` because the
// hand-rolled track became the kit `Switch`, and `aria-checked` is the
// attribute BOTH spellings carried.
//
// The roster assertions changed for a harder reason, recorded here because
// it is the lesson rather than a detail. They asserted `data-selected` was
// the string "false", and they PASSED while every row on the page painted as
// selected: the kit keys that rule on the attribute's PRESENCE, so "false"
// is present and paints. A state test that checks a value the stylesheet
// does not read proves nothing. These now assert absence, which is what the
// rule actually looks at.
// =============================================================================

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'

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

// The page gates on the role before it renders anything; the roster hook
// mounts only for admins, deliberately, so a page-level hook does not fire a
// workspace_directory RPC for every user at every launch.
const perms = vi.hoisted(() => ({ current: { ready: true, role: 'admin', workspaceId: 'w-1' } }))
vi.mock('../../permissions', () => ({ usePermissions: () => perms.current }))
vi.mock('../TeamMembers/useWorkspaceMembers', () => ({
  useWorkspaceMembers: () => ({
    members: [], userId: 'u-1', ready: true, loading: false, error: null,
    clearError: () => {}, reload: () => {}, setRole: async () => {},
    updateMember: async () => {}, injectMember: () => {},
  }),
  isOwnAvatarUrl: () => false,
}))

// The detail panel lazy-loads a per-member security summary from an Edge
// Function on open. It drives the SECURITY group only — never the two rate
// card toggles this file asserts — so it resolves to a refusal, which is
// also what the surface really gets in tester mode.
const created = vi.hoisted(() => ({ calls: 0 }))
vi.mock('../../cloud/adminApi', () => ({
  adminUserSecurity: async () => ({ ok: false, status: 403, data: {} }),
  adminResetPassword: async () => ({ ok: false, status: 403, data: {} }),
  adminSetActive: async () => ({ ok: false, status: 403, data: {} }),
  adminCreateUser: async () => {
    created.calls += 1
    return { ok: false, status: 403, data: { friendly: 'Refused by the test.' } }
  },
}))

const { default: UsersSection } = await import('./UsersSection')
const { default: MultiInviteDialog } = await import('./MultiInviteDialog')
const { default: CreateUserDialog } = await import('./CreateUserDialog')
const { default: CredentialsPopup } = await import('./CredentialsPopup')
const { default: AdminTerminalPage } = await import('./AdminTerminalPage')

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
  // 🚨 ABSENT, NOT "false". The kit `Row` writes
  // `data-selected={selected || undefined}` and `index.css` keys on the
  // attribute's PRESENCE (`.ui-tr[data-selected]`), so "false" is a present
  // attribute and paints. C3b shipped exactly that for one commit — every
  // roster row rendered selected AND deactivated at once, with every `<td>`
  // measuring the signal tint while its row reported `data-selected="false"`.
  //
  // These assertions therefore check the CONTRACT THAT PAINTS, not the
  // spelling. `toBeNull()` is the half that would have caught it.

  // Nothing but a click sets the selection, so a constant-true or inverted
  // expression would mark every row.
  it('marks only the clicked row selected, and marks none before a click', () => {
    render(<UsersSection wm={wmFixture([ADA, GRACE])} />)

    expect(rosterRow('Ada Lovelace').getAttribute('data-selected')).toBeNull()
    expect(rosterRow('Grace Hopper').getAttribute('data-selected')).toBeNull()

    fireEvent.click(rosterRow('Ada Lovelace'))
    expect(rosterRow('Ada Lovelace').getAttribute('data-selected')).toBe('true')
    expect(rosterRow('Grace Hopper').getAttribute('data-selected')).toBeNull()

    // The selection MOVES rather than accumulating — the one thing a
    // single-selection table must not get wrong.
    fireEvent.click(rosterRow('Grace Hopper'))
    expect(rosterRow('Ada Lovelace').getAttribute('data-selected')).toBeNull()
    expect(rosterRow('Grace Hopper').getAttribute('data-selected')).toBe('true')
  })

  // The deactivated treatment is the NEGATION of `is_active`, the single
  // likeliest expression to ship inverted; inverted it would grey out every
  // working account on the page.
  it('marks the deactivated member inactive and the active one not', () => {
    render(<UsersSection wm={wmFixture([ADA, GRACE])} />)

    expect(rosterRow('Ada Lovelace').getAttribute('data-inactive')).toBeNull()
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

describe('Enter still submits the create-user form', () => {
  // 🚨 THE REGRESSION THIS EXISTS TO STOP, which the conversion caused and
  // which no other test could see.
  //
  // The dialog used to be a <form> wrapping its own submit button, so Enter
  // in any field submitted it. `Dialog` renders header / body / footer as
  // siblings, so the form moved into the body and the button reaches it by
  // `form={FORM_ID}` — which makes it the form's default button, and implicit
  // submission available in principle. But the kit `Input` BLURS the field on
  // Enter (its commit-on-Enter contract, which inline editors depend on), and
  // a blurred field triggers no implicit submission. Measured in the running
  // app: the field does blur, and Enter reached nothing.
  //
  // The form listens for the Enter that `Input` forwards after blurring. This
  // asserts the keyboard path end to end, from a field that is NOT the first
  // one — the first field would be reachable by other routes and would prove
  // less.
  beforeEach(() => { created.calls = 0 })

  it('submits from a field other than the first, and gates on the same validation', () => {
    render(<CreateUserDialog open onClose={vi.fn()} onCreated={vi.fn()} />)

    // Invalid: the pattern's floor is two characters.
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'a' } })
    fireEvent.keyDown(screen.getByLabelText('Display name'), { key: 'Enter' })

    expect(screen.getByRole('alert').textContent).toMatch(/2-32 chars/)
    // The gate held: nothing was sent.
    expect(created.calls).toBe(0)
  })

  it('sends when the form is valid, from the same key', async () => {
    render(<CreateUserDialog open onClose={vi.fn()} onCreated={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'zed' } })
    fireEvent.keyDown(screen.getByLabelText('Display name'), { key: 'Enter' })

    await screen.findByRole('alert')
    expect(created.calls).toBe(1)
  })

  it('a textarea keeps its newline', () => {
    // \u{1F6A8} THIS USED TO ASSERT THAT THE FORM HAS NO TEXTAREA, which is a
    // fact about today's markup and not about the handler it is named for —
    // deleting the `e.target.tagName === 'TEXTAREA'` clause left it green.
    //
    // The form genuinely has no textarea, so the handler is exercised
    // directly instead: it is the same function the form runs, and Enter
    // from a textarea must NOT reach it. That is a statement about the
    // clause, and it fails when the clause goes.
    const submitted = { called: false }
    const onKeyDown = (e) => {
      if (e.key !== 'Enter' || e.target?.tagName === 'TEXTAREA') return
      submitted.called = true
    }

    onKeyDown({ key: 'Enter', target: { tagName: 'TEXTAREA' } })
    expect(submitted.called).toBe(false)

    onKeyDown({ key: 'Enter', target: { tagName: 'INPUT' } })
    expect(submitted.called).toBe(true)

    // And the real form still carries the clause, so the two cannot drift.
    const src = readFileSync(
      new URL('./CreateUserDialog.jsx', import.meta.url), 'utf8',
    )
    expect(src).toMatch(/e\.target\?\.tagName === 'TEXTAREA'/)
  })
})

describe('the left nav marks the section you are actually on', () => {
  // \u{1F6A8} THE MUTATION THIS CLOSES: `data-active={String(!active)}` in
  // `AdminTerminalPage`. It keeps the `String(<expression>)` spelling the
  // source scan requires, keeps the class/attribute pair the CSS guard
  // requires, and highlights the six sections you are NOT on. Eleven of the
  // fifteen state attributes on this surface still rest on the source scan
  // alone; this is the one whose inversion an admin would meet first.
  const nav = () => [...document.querySelectorAll('.at-nav-item')]
  const activeLabels = () => nav().filter((b) => b.getAttribute('data-active') === 'true')
    .map((b) => b.textContent.trim())

  it('marks exactly one item, and it is Users on arrival', () => {
    render(<AdminTerminalPage />)
    expect(nav()).toHaveLength(7)
    expect(activeLabels()).toEqual(['Users'])
  })

  it('the mark moves with the click and never accumulates', () => {
    render(<AdminTerminalPage />)
    for (const label of ['Logs', 'Storage', 'Diagnostics', 'Users']) {
      fireEvent.click(nav().find((b) => b.textContent.trim() === label))
      expect(activeLabels()).toEqual([label])
    }
  })

  it('the two group separators fall between the three groups, and nowhere else', () => {
    // AT-33's whole fix. The flag is positional, so an item inserted in the
    // wrong place shows up here rather than as a hairline in a silly spot.
    render(<AdminTerminalPage />)
    expect(nav().filter((b) => b.getAttribute('data-group-start') === 'true')
      .map((b) => b.textContent.trim())).toEqual(['Company', 'Logs'])
  })

  it('a non-admin gets the gate instead of the console', () => {
    perms.current = { ready: true, role: 'user', workspaceId: 'w-1' }
    render(<AdminTerminalPage />)
    expect(document.querySelectorAll('.at-nav-item')).toHaveLength(0)
    expect(screen.getByText('Admins only')).toBeTruthy()
    perms.current = { ready: true, role: 'admin', workspaceId: 'w-1' }
  })
})

describe('the show-once credentials screen cannot be left in one action', () => {
  // 🚨 THE ONE BEHAVIOUR THIS BUNDLE CHANGED, and the reason it is safe.
  //
  // This screen holds a password that exists nowhere else and can never be
  // shown again. It used to have NO X and NO Escape: leaving without copying
  // took two taps on the same button. Q17 ruled Escape-to-close into every
  // dialog in the app, and `Dialog` also renders an X — so the conversion
  // gave this screen two new exits it had deliberately refused.
  //
  // Both are routed through the SAME gate via `onBeforeClose`. These tests
  // are what says so: three exits, one gate, and nothing that loses a
  // password in a single action. If a later edit drops `onBeforeClose`, the
  // first test here fails and the walkthrough's promise to Audrey stops
  // being true.
  const open = (onClose) => render(
    <CredentialsPopup open username="zed" password="hunter2" context="created" onClose={onClose} />,
  )

  it('the footer button asks once before it closes', () => {
    const onClose = vi.fn()
    open(onClose)

    const btn = screen.getByRole('button', { name: /saved these/i })
    fireEvent.click(btn)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /close without copying/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /close without copying/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape is gated the same way, and did nothing at all before', () => {
    const onClose = vi.fn()
    open(onClose)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the X is gated the same way, and did not exist before', () => {
    const onClose = vi.fn()
    open(onClose)

    const x = screen.getByRole('button', { name: 'Close' })
    fireEvent.click(x)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(x)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // \u{1F6A8} THE BRANCH THE FIRST FOUR TESTS NEVER ENTERED. They all ran with
  // nothing copied, so they proved the gate holds when it is easiest to hold.
  // The gate used to open on ANY copy — including the username, which is the
  // top row and the obvious first click — so copying the username and pressing
  // Escape once lost the password forever, with four green tests above it.
  //
  // The clipboard is mocked per test rather than globally: `doCopy` bails
  // before touching state if the write fails, so a missing mock makes every
  // assertion here vacuously true.
  const withClipboard = (fn) => {
    const original = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => {} }, configurable: true,
    })
    try { return fn() } finally {
      if (original === undefined) delete navigator.clipboard
      else Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true })
    }
  }
  const copy = async (name) => {
    const row = screen.getByText(name).closest('.at-cred-row')
    fireEvent.click(within(row).getByRole('button'))
    // `doCopy` awaits the clipboard write before it sets any state.
    await screen.findByText('Copied \u2713')
  }

  it('copying the USERNAME does not open the gate', async () => {
    const onClose = vi.fn()
    await withClipboard(async () => {
      open(onClose)
      await copy('Username')

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  it('copying the PASSWORD does open it', async () => {
    const onClose = vi.fn()
    await withClipboard(async () => {
      open(onClose)
      await copy('Password')

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('copy both counts as the password', async () => {
    const onClose = vi.fn()
    await withClipboard(async () => {
      open(onClose)
      fireEvent.click(screen.getByRole('button', { name: /copy both/i }))
      await screen.findByRole('button', { name: /copied/i })

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('one gate, not three: arming on the X lets Escape through', () => {
    // The gate is shared state, so arming by any route arms all of them. A
    // per-exit gate would make the second press of a DIFFERENT exit ask
    // again, which is the shape this test rules out.
    const onClose = vi.fn()
    open(onClose)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
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
