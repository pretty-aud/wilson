/** @vitest-environment jsdom */
// =============================================================================
// signInScreens.test.jsx — F11 item 4 (REV-05; the review's shared-client A2),
// drawn. The reset wizard asks for the company the way the login does (her
// answer in F11's chat, 2026-11-18: "Show it, with 'Change company'"), so a
// username in two companies gets its reset at the right company's address,
// and the "sent" screen is the same for a hit and a miss. And the login's
// second-factor check, bounded now, stops on a stall with the timeout
// sentence instead of hanging (or, swallowed, signing in at aal1).
//
// resolve-login is faked by its own rule (index.ts:323-361): a bare username
// that exists in two companies is a miss; with `workspace_slug` it is that
// company's person. The shell is a pass-through here (its motion is
// AuthShell.reveal.test.jsx's); the styles and fields are the real ones.
// Failing controls, run before the commit: the wizard as it was (the username
// alone) turns the REV-05 tests red; an error shown when the reset email
// fails turns the uniform test red; the login's TimeoutError swallowed in its
// second-factor catch turns the last test red.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.test')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')

const sb = vi.hoisted(() => ({ auth: {} }))
vi.mock('./supabaseClient', () => ({ supabase: { auth: new Proxy({}, { get: (_, k) => sb.auth[k] }) } }))
vi.mock('./AuthShell', async (importOriginal) => ({
  ...(await importOriginal()),
  default: ({ children }) => <div data-shell>{children}</div>,
}))
vi.mock('./sessionStorage', () => ({ saveSession: async () => {} }))

const { default: ForgotPasswordWizard, COMPANY_NOT_FOUND, RATE_LIMITED_ERROR, TIMEOUT_ERROR } = await import('./ForgotPasswordWizard.jsx')
const { default: LoginScreen } = await import('./LoginScreen.jsx')

// The companies and the one username in two of them.
const COMPANIES = { 'petal studios': 'petal', petal: 'petal', smoke: 'smoke' }
const PEOPLE = { 'sam@petal': 'sam@petal.test', 'sam@smoke': 'sam@smoke.test', 'ann@petal': 'ann@petal.test' }
function resolveLoginFake({ status } = {}) {
  const sent = []
  globalThis.fetch = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    sent.push(body)
    const json = (s, b) => ({ ok: s < 300, status: s, json: async () => b })
    if (status) return json(status, { exists: false, email: null })
    if ('company' in body) {
      const slug = COMPANIES[body.company.toLowerCase()]
      return json(200, { exists: !!slug, slug: slug ?? null, v: 2 })
    }
    const rows = Object.entries(PEOPLE).filter(([k]) => k.startsWith(`${body.username}@`) && (!body.workspace_slug || k.endsWith(`@${body.workspace_slug}`)))
    // index.ts:358: no row, or two rows without a slug, is the miss.
    if (rows.length !== 1) return json(200, { exists: false, email: null })
    return json(200, { exists: true, email: rows[0][1] })
  })
  return sent
}

const realFetch = globalThis.fetch
let resets
beforeEach(() => {
  localStorage.clear()
  resets = []
  sb.auth = { resetPasswordForEmail: vi.fn(async (email) => { resets.push(email); return { data: {}, error: null } }) }
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch; vi.useRealTimers() })

async function sendReset(username) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /send reset link/i })) })
}
const SENT = /If an account matches that username, a reset link is on its way/

describe('Forgot password asks for the company (REV-05)', () => {
  it('with a company remembered on this device: it is shown above the username, with Change company', () => {
    localStorage.setItem('wilson.lastCompany', 'Smoke')
    render(<ForgotPasswordWizard />)
    expect(screen.getByText('Smoke')).toBeTruthy()
    expect(screen.getByLabelText('Username')).toBeTruthy()
    expect(screen.queryByLabelText('Company')).toBeNull()
    expect(screen.getByRole('button', { name: 'Change company' })).toBeTruthy()
  })
  it('🚨 a username in two companies: the reset goes to the address in the company that was given', async () => {
    localStorage.setItem('wilson.lastCompany', 'Smoke')
    const sent = resolveLoginFake()
    render(<ForgotPasswordWizard />)
    await sendReset('Sam')
    expect(await screen.findByText(SENT)).toBeTruthy()
    expect(sent).toEqual([{ company: 'Smoke' }, { username: 'sam', workspace_slug: 'smoke' }])
    expect(resets).toEqual(['sam@smoke.test'])
    expect(sb.auth.resetPasswordForEmail.mock.calls[0][1]).toEqual({ redirectTo: `${window.location.origin}/#/recovery` })
  })
  it('with no company remembered it opens on the company field; Continue verifies it; Change company goes back', async () => {
    const sent = resolveLoginFake()
    render(<ForgotPasswordWizard />)
    expect(screen.queryByLabelText('Username')).toBeNull()
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Petal Studios' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })) })
    expect(screen.getByText('Petal Studios')).toBeTruthy()
    await sendReset('sam')
    expect(await screen.findByText(SENT)).toBeTruthy()
    expect(sent).toEqual([{ company: 'Petal Studios' }, { username: 'sam', workspace_slug: 'petal' }])
    expect(resets).toEqual(['sam@petal.test'])
    expect(localStorage.getItem('wilson.lastCompany')).toBe('Petal Studios')
  })
  it('Change company returns to the field with the company still in it', async () => {
    localStorage.setItem('wilson.lastCompany', 'Smoke')
    render(<ForgotPasswordWizard />)
    fireEvent.click(screen.getByRole('button', { name: 'Change company' }))
    expect(screen.getByLabelText('Company').value).toBe('Smoke')
  })
  it('a company that is not one says so, as the login does, and asks for it', async () => {
    localStorage.setItem('wilson.lastCompany', 'Nowhere Ltd')
    resolveLoginFake()
    render(<ForgotPasswordWizard />)
    await sendReset('sam')
    expect(screen.getByText(COMPANY_NOT_FOUND)).toBeTruthy()
    expect(screen.getByLabelText('Company')).toBeTruthy()
    expect(resets).toEqual([])
  })
})

describe('the "sent" screen tells nobody whether the username exists', () => {
  async function sentMarkupFor(username) {
    localStorage.setItem('wilson.lastCompany', 'Petal')
    resolveLoginFake()
    const { container, unmount } = render(<ForgotPasswordWizard />)
    await sendReset(username)
    await screen.findByText(SENT)
    const html = container.innerHTML
    unmount()
    return html
  }
  it('a hit and a miss end on the identical screen', async () => {
    const hit = await sentMarkupFor('ann')
    const miss = await sentMarkupFor('nobody')
    expect(resets).toEqual(['ann@petal.test'])
    expect(miss).toBe(hit)
  })
  it('a reset email that fails still ends on "sent"', async () => {
    localStorage.setItem('wilson.lastCompany', 'Petal')
    resolveLoginFake()
    sb.auth.resetPasswordForEmail = vi.fn(async () => { throw new Error('smtp down') })
    render(<ForgotPasswordWizard />)
    await sendReset('ann')
    expect(await screen.findByText(SENT)).toBeTruthy()
  })
  it('a 429 and no answer have their sentences, whichever username was typed', async () => {
    for (const username of ['ann', 'nobody']) {
      localStorage.setItem('wilson.lastCompany', 'Petal')
      resolveLoginFake({ status: 429 })
      const a = render(<ForgotPasswordWizard />)
      await sendReset(username)
      expect(screen.getByText(RATE_LIMITED_ERROR)).toBeTruthy()
      a.unmount()
      globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
      const b = render(<ForgotPasswordWizard />)
      // The company step degrades to a derived slug (as the login's); the lookup then has no answer.
      await sendReset(username)
      expect(screen.getByText(TIMEOUT_ERROR)).toBeTruthy()
      b.unmount()
    }
    expect(resets).toEqual([])
  })
  it('its three sentences are the login\'s, word for word', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const login = readFileSync(join(here, 'LoginScreen.jsx'), 'utf8')
    const said = (name) => new RegExp(`const ${name} = '([^']*)'`).exec(login)?.[1]
    expect(said('COMPANY_NOT_FOUND')).toBe(COMPANY_NOT_FOUND)
    expect(said('RATE_LIMITED_ERROR')).toBe(RATE_LIMITED_ERROR)
    expect(said('TIMEOUT_ERROR')).toBe(TIMEOUT_ERROR)
  })
})

describe('the login\'s second factor, bounded', () => {
  it('🚨 a stalled check stops on the timeout sentence; it never signs in without the code', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.setItem('wilson.lastCompany', 'Petal')
    resolveLoginFake()
    const onAuthenticated = vi.fn()
    sb.auth = {
      ...sb.auth,
      signInWithPassword: async () => ({ data: { session: { access_token: 'aal1' } }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: () => new Promise(() => {}) },
    }
    render(<LoginScreen onAuthenticated={onAuthenticated} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })) })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ann' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(15_500) })
    expect(screen.getByText(TIMEOUT_ERROR)).toBeTruthy()
    expect(onAuthenticated).not.toHaveBeenCalled()
  })
})
