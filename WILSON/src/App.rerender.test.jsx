/** @vitest-environment jsdom */
// =============================================================================
// App.rerender.test.jsx — what the pet's own life costs the rest of the app
// (F4, 2026-11-13; the review's shared-client C1 and dog-otter C1).
//
// The measurement and the pin are one test (the brief's list items 1a and
// 1b). The REAL App is mounted, signed in the way the dev tester is, with the
// real pet (PetCompanion, its timers, its chat, its Shift key) and the real
// AgentProvider. The thirteen pages are stand-ins of the same names, mounted
// through the app's own page table, so the render spy answers one question:
// did the app hand this page to React again. Time is the test's: fake timers,
// and Math.random fixed at 0.5 so the dream cloud and the attention jump come
// when the arithmetic says. Every page is entered first (thirteen transitions
// of 2.2 s), so the measured minute runs from 28.6 s to 88.6 s of the pet's
// own clocks, which start when it loads:
//
//   awake:   the decay tick at 30 and 60 s (2); the dream cloud on at 33.5,
//            48, 62.5 and 77 s and off 3 s after each (8); the attention jump
//            at 40 and 80.5 s and its end half a second later (4): 14 changes
//            of the pet's state, no two in the same instant.
//   asleep:  the sleep "Z" every 2 s (30), the decay tick (2), the dream
//            cloud (8): 40 changes. Four of them fall in the same instant as
//            a "Z" (30, 48, 60 and 80 s) and timers due in one instant are
//            one render here, so 36 renders.
//
// MEASURED BEFORE F4's change (2026-11-13, at the brief's tip a71cd144; the
// render pins below red). Awake, the minute ran App 14 times, and each time
// all thirteen page surfaces (182 renders) and the twelve pages mounted under
// them (168: the Files page is mounted only while it is the page on screen).
// Asleep: App 36 times, the surfaces 468, the pages 432. Ten characters typed
// to the pet: App 10 times, the surfaces 130, the pages 120. A decay tick
// with Settings on screen ran every page, where only Settings shows the pet.
// GREEN since the pet's host (<PetHost> in App.jsx): a change in the pet
// draws the pet, and Settings' card while Settings is the page on screen.
//
// The second half of the file is the pet itself, green before and after: its
// dream cloud, its jump, its "Z", its chat, its Shift key, its Feed, what
// Settings shows of it and turns off in it, and what a change of page does to
// it. F4 moves all of that into a host of its own; these are what must not move.
// =============================================================================
import { renderSpy } from './lib/renderSpy'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react'

// perms: who is signed in, as a store the stand-in for usePermissions reads, so a test can sign another person in.
// rows: each cloud save with the session it went out under. petOf: the account pet of a person other than the first.
// Review round 2: gate holds cloud writes in flight; local and mirrors are the device store and the cache, each with
// the owner it was written under; failFor, the people whose account read fails; cacheOf, a person's pet cached on
// this computer; refuse, 0068's refusal of the next cloud write; reread, what the stale-copy re-read returns.
// session and sessionMovesTo: the client's session, when it is not App's person (see saveCloudPet below). stored:
// the stored session, read at launch for the cache key; cacheGate holds that cached read; cleared, whose caches a
// sign-out cleared.
const world = vi.hoisted(() => ({
  pet: null, saves: [], ai: null, perms: null, permsListeners: new Set(), rows: [], petOf: {}, owner: undefined,
  gate: null, local: [], mirrors: [], failFor: new Set(), cacheOf: {}, refuse: null, reread: null,
  session: undefined, sessionMovesTo: undefined, stored: null, cacheGate: null, cleared: [],
}))

// ── The thirteen pages: stand-ins of the same names, drawn by the app's own table ──
vi.mock('./components/Home', () => ({ default: function Home() { return <p>home page</p> } }))
vi.mock('./tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx', () => ({ default: function DeckOutlineGenerator() { return <p>dog page</p> } }))
vi.mock('./tools/otter_v0.3.1/Otter.jsx', () => ({ default: function Otter() { return <p>otter page</p> } }))
vi.mock('./tools/rabbit_v0.1.0/Rabbit.jsx', () => ({ default: function Rabbit() { return <p>rabbit page</p> } }))
vi.mock('./tools/moth_v0.1.0/MothPage.jsx', () => ({ default: function MothPage() { return <p>moth page</p> } }))
// Settings shows the pet: the stand-in draws what it is handed, so the card's numbers can be followed.
vi.mock('./components/SettingsPage', () => ({
  default: function SettingsPage({ petData, onPetModeToggle, newPetStatus, petNotice }) {
    return (
      <section aria-label="settings page">
        <output data-testid="settings-pet">{petData ? `${petData.name} ${petData.state} ${Math.round(petData.hunger)}/100 mode ${petData.petMode ? 'on' : 'off'}` : 'no pet'}</output>
        <button onClick={() => onPetModeToggle(!petData?.petMode)}>toggle pet mode</button>
        <output data-testid="settings-status">{newPetStatus?.message || ''}{petNotice?.message || ''}</output>
      </section>
    )
  },
}))
vi.mock('./components/Projects', () => ({ default: function Projects() { return <p>projects page</p> } }))
vi.mock('./components/RateCard', () => ({ default: function RateCardPage() { return <p>rate card page</p> } }))
vi.mock('./components/TeamMembers/TeamMembersPage', () => ({ default: function TeamMembersPage() { return <p>team page</p> } }))
vi.mock('./components/Resources/ProjectFilesExplorer', () => ({ default: function ProjectFilesExplorer() { return <p>files page</p> } }))
vi.mock('./components/Dashboard/DashboardPage', () => ({ default: function DashboardPage() { return <p>dashboard page</p> } }))
vi.mock('./components/AdminTerminal/AdminTerminalPage', () => ({ default: function AdminTerminalPage() { return <p>admin page</p> } }))
vi.mock('./components/HelpPage', () => ({ default: function HelpPage() { return <p>help page</p> } }))

// ── The shell's furniture that is not under test ──
vi.mock('./components/TitleBar', () => ({ default: () => null }))
vi.mock('./dev/DevFixturesBadge', () => ({ default: () => null }))
vi.mock('./cloud/ConnectionLostBanner', () => ({ default: () => null }))
vi.mock('./components/ModelWarningBanner', () => ({ default: () => null }))
vi.mock('./components/UpdatePrompt', () => ({ default: () => null }))
vi.mock('./cloud/auth/LoginScreen', () => ({ default: () => null }))
vi.mock('./cloud/auth/ForgotPasswordWizard', () => ({ default: () => null }))
vi.mock('./cloud/auth/ResetPasswordWizard', () => ({ default: () => null }))
vi.mock('./cloud/onboarding/NewUserWelcome', () => ({ default: () => null }))
vi.mock('./cloud/auth/MfaSection', () => ({ MfaEnrollGate: () => null }))
vi.mock('./cloud/auth/SessionWarning', async (importOriginal) => ({ ...(await importOriginal()), default: () => null }))
vi.mock('./tools/rabbit_v0.1.0/views/scenes/LeaveEditDialog', () => ({ default: () => null }))
vi.mock('./tools/rabbit_v0.1.0/components/UndoToast', () => ({ default: () => null }))
vi.mock('./tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ RabbitProvider: ({ children }) => children, useRabbit: () => null }))

// ── The cloud and the disk, at their module boundaries ──
vi.mock('./cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      mfa: { listFactors: async () => ({ data: { totp: [] }, error: null }) },
      signOut: async () => ({ error: null }),
    },
  },
  hydrateSupabase: async () => null,
  endSessionLocally: () => false,
  onHeldSessionRefused: () => () => {},
}))
vi.mock('./cloud/auth/sessionStorage', async (importOriginal) => ({ ...(await importOriginal()), loadSession: async () => world.stored, clearSession: async () => {} }))
const TIMEOUTS = { phase: null, deadline: null, stay: () => {} }
vi.mock('./cloud/auth/sessionTimeouts', async (importOriginal) => ({ ...(await importOriginal()), useSessionTimeouts: () => TIMEOUTS }))
vi.mock('./cloud/workspaceStorage', () => ({ fetchWorkspaceStorage: async () => null, clearWorkspaceStorageCache: () => {} }))
vi.mock('./cloud/aiProxy', () => ({ callAI: (...args) => world.ai(...args), isRetryableAIError: () => false }))
vi.mock('./cloud/aiFiles', () => ({ releaseAllAIFiles: async () => {} }))
vi.mock('./lib/modelSources', () => ({ loadModelSources: async () => {}, migrateLegacyUserModelPrefs: async () => {} }))
vi.mock('./lib/localData', () => ({
  hasLocalServer: () => false,
  loadPet: async (owner) => {
    if (world.cacheGate) await world.cacheGate.promise
    const pet = owner && owner in world.cacheOf ? world.cacheOf[owner] : world.pet
    return pet ? { ...pet } : null
  },
  savePetData: async (pet, owner) => { world.saves.push(pet); world.local.push({ owner: owner ?? null, name: pet.name, hunger: pet.hunger }) },
  clearPetCache: async (owner) => { world.cleared.push(owner) },
  loadOtterSettings: async () => ({}),
  saveOtterSettings: async () => ({}),
  loadAgentSkills: async () => ({}),
}))
vi.mock('./lib/userState', () => {
  // The session the client holds as a request goes out: world.perms' person, unless another tab's sign-in has moved
  // it first (sessionMovesTo: the client hears of it before App draws it).
  const sessionNow = () => {
    if (world.sessionMovesTo !== undefined) { world.session = world.sessionMovesTo; world.sessionMovesTo = undefined }
    return world.session !== undefined ? world.session : (world.perms?.userId ?? null)
  }
  return {
    resolveUserPet: async (userId) => {
      // A failed read fails after a round trip, as a network's does (an instant one outran the blank that precedes it).
      if (world.failFor.has(userId)) { await new Promise((resolve) => setTimeout(resolve, 10)); throw new Error('The account read failed.') }
      const pet = world.petOf[userId] || world.pet
      return { pet: pet ? { ...pet } : null, adopted: false }
    },
    // A write goes to the session's row. One that names its owner is refused under anybody else's session, as 0046's
    // policies refuse it (42501); one that names nobody takes the session's (the column default). With a gate, the
    // round trip then waits on it.
    saveCloudPet: async (pet, userId) => {
      if (world.refuse) { const refusal = world.refuse; world.refuse = null; throw refusal }
      const session = sessionNow()
      if (userId && userId !== session) {
        throw Object.assign(new Error('new row violates row-level security policy for table "user_pets"'), { code: '42501' })
      }
      world.saves.push(pet)
      world.rows.push({ session, name: pet.name, sleepingSince: pet.sleepingSince ?? null })
      if (world.gate) await world.gate.promise
    },
    mirrorPetToCache: async (pet, owner) => { world.mirrors.push({ owner, name: pet.name }) },
    // A read answers for the session's own person, as RLS does: named for somebody else, nothing (their row is
    // filtered out, the session's is not theirs); named for nobody, the session's row (reread, given the session).
    fetchCloudPet: async (userId) => {
      const session = sessionNow()
      if (userId && userId !== session) return null
      return world.reread ? world.reread(session) : null
    },
    isStalePetWrite: (err) => err?.stale === true,
    resolveUserSettings: async () => ({ settings: null }),
    mirrorSettingsToCache: async () => {},
    setUserStateOwner: (userId) => { world.owner = userId },
    getUserStateOwner: () => (world.owner === undefined ? 'u-1' : world.owner),
  }
})
const PERMS = { ready: true, userId: 'u-1', role: 'member', workspaceId: 'w-1', isPlatformOperator: false, offline: false }
vi.mock('./permissions', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (listener) => { world.permsListeners.add(listener); return () => world.permsListeners.delete(listener) }
  return { usePermissions: () => useSyncExternalStore(subscribe, () => world.perms) }
})
/** Another person signed in over the one there, with no sign-out between (a second tab's sign-in reaches this one so). */
const signInAs = (userId) => {
  world.perms = { ...world.perms, userId }
  for (const listener of world.permsListeners) listener()
}
/** The permissions resolve, as `userId`, at a launch drawn before they had (world.perms not ready). */
const permissionsResolveAs = (userId) => {
  world.perms = { ...PERMS, userId }
  for (const listener of world.permsListeners) listener()
}
/** A stored session as the store holds it: an access token whose payload names its person (`sub`). */
const storedSessionOf = (sub) => ({ access_token: ['e30', btoa(JSON.stringify({ sub })), 'signature'].join('.') })
vi.mock('./tools/otter_v0.3.1/adapters', () => ({ otterFetch: async () => ({ ok: false, json: async () => ({}) }), subscribeOtterAdapterMode: () => () => {} }))
vi.mock('./tools/otter_v0.3.1/petKnowledge', () => ({ retrieveOtterKnowledge: async () => ({ block: '' }), clearPetKnowledgeCache: () => {} }))
vi.mock('./tools/rabbit_v0.1.0/storage/s3Provider', () => ({ clearS3ReadUrlCache: () => {} }))

const { default: App } = await import('./App.jsx')
const { _resetOverlaysForTests } = await import('./ui/overlay')

const NOW = new Date('2026-11-13T10:00:00.000Z')
const adultPet = (over = {}) => ({
  name: 'Biscuit', gender: 'female', breed: 'otter', form: 'adult', state: 'content',
  hunger: 80, happiness: 80, difficulty: 'medium', petMode: true,
  eggPetCount: 5, eggHatchThreshold: 5,
  bornAt: '2026-10-01T10:00:00.000Z', evolvedAt: '2026-10-02T10:00:00.000Z',
  sleepingSince: null, lastSleptAt: NOW.toISOString(), lastFedAt: null, lastPettedAt: null,
  lastUpdatedAt: NOW.toISOString(), interactionCount: 0, diedAt: null,
  feedback: [], totalThumbsUp: 0, totalThumbsDown: 0,
  ...over,
})
const asleep = (over = {}) => adultPet({ state: 'sleeping', sleepingSince: NOW.toISOString(), lastSleptAt: '2026-11-13T09:00:00.000Z', ...over })

// The pages the app keeps mounted, by the name each draws under; with App and the surfaces, the shell.
const PAGES = ['Home', 'DeckOutlineGenerator', 'Otter', 'Rabbit', 'MothPage', 'SettingsPage', 'Projects', 'RateCardPage', 'TeamMembersPage', 'DashboardPage', 'AdminTerminalPage', 'HelpPage']
const SHELL = ['App', 'PageSurface', ...PAGES]
const EVERY_PAGE = ['dog', 'otter', 'rabbit', 'moth', 'dashboard', 'settings', 'project-manager', 'rate-card', 'team-members', 'project-files', 'admin-terminal', 'help', 'home']

const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

/**
 * Let `ms` pass one instant at a time, each in its own act. Inside one act
 * React folds every change into one render, so a minute advanced in one step
 * is one render whatever happened in it; a browser renders after each timer.
 * Timers due in the same instant are still one act here (so one render). The
 * sentinel is the last timer due at the end.
 */
async function runFor(ms) {
  let done = false
  setTimeout(() => { done = true }, ms)
  while (!done) await act(async () => { await vi.advanceTimersToNextTimerAsync() })
}

/** Go to a page as the Back button does: the address first, then the app's own 2.1 s transition. */
async function startTo(page) {
  await act(async () => {
    window.history.pushState({ page }, '', page === 'home' ? '/' : `/${page}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}
async function goTo(page) { await startTo(page); await tick(2200) }

async function openApp({ pet = adultPet(), enterEveryPage = false } = {}) {
  world.pet = pet
  const view = render(<App />)
  await tick(50)                                   // the cached pet, then the account's
  // Every page entered once (M.O.T.H. mounts on its first visit and stays), ending on home.
  if (enterEveryPage) for (const page of EVERY_PAGE) await goTo(page)
  return view
}

const sprite = (view) => view.container.querySelector('.pet-slide-in, .pet-slide-out')
const chatInput = () => document.querySelector('input[placeholder^="Ask Biscuit"]')
const cloud = (view) => view.container.querySelector('.cloud-bob')
const settingsPet = () => screen.getByTestId('settings-pet').textContent
async function openChat(view) { await act(async () => { fireEvent.click(sprite(view)) }); return chatInput() }

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  vi.stubEnv('VITE_DEV_AUTOLOGIN', 'tester')
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // The otter's sprite draws one pixel twice under one key (OUTSTANDING F4-01): React says so on every render of it.
  const realError = console.error
  vi.spyOn(console, 'error').mockImplementation((...args) => { if (!String(args[0]).includes('two children with the same key')) realError(...args) })
  window.history.replaceState(null, '', '/')
  Element.prototype.scrollIntoView = () => {}      // jsdom has none; the chat scrolls to its newest message
  world.saves.length = 0
  world.rows.length = 0
  world.petOf = {}
  world.owner = undefined
  world.perms = PERMS
  world.ai = vi.fn(() => new Promise(() => {}))
  world.gate = null
  world.local.length = 0
  world.mirrors.length = 0
  world.failFor.clear()
  world.cacheOf = {}
  world.refuse = null
  world.reread = null
  world.session = undefined
  world.sessionMovesTo = undefined
  world.stored = null
  world.cacheGate = null
  world.cleared.length = 0
})
afterEach(() => {
  cleanup(); _resetOverlaysForTests()
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks()
  renderSpy.reset()
})

describe('the app as measured: signed in, every page mounted, the pet on screen', () => {
  it('mounts the twelve standing pages and the pet, and Settings is handed the pet', async () => {
    const view = await openApp({ enterEveryPage: true })
    for (const words of ['home page', 'dog page', 'otter page', 'rabbit page', 'moth page', 'projects page', 'rate card page', 'team page', 'dashboard page', 'admin page', 'help page']) {
      expect(view.container.textContent, words).toContain(words)
    }
    expect(view.container.textContent).not.toContain('files page')      // mounted only while it is the page on screen
    expect(settingsPet()).toBe('Biscuit content 80/100 mode on')
    expect(sprite(view)).not.toBeNull()
  })
})

describe('one minute of the pet idle, every page entered', () => {
  it('awake: the minute is the pet\'s fourteen changes, and no page and no surface is handed to React again', async () => {
    await openApp({ enterEveryPage: true })
    const mark = renderSpy.mark()
    await runFor(60_000)
    expect(renderSpy.renders('PetCompanion', mark)).toBe(14)
    expect(renderSpy.which(SHELL, mark)).toEqual([])
  })

  it('asleep: thirty-six renders of the pet in the minute, and no page and no surface is handed to React again', async () => {
    await openApp({ pet: asleep(), enterEveryPage: true })
    const mark = renderSpy.mark()
    await runFor(60_000)
    expect(renderSpy.renders('PetCompanion', mark)).toBe(36)
    expect(renderSpy.which(SHELL, mark)).toEqual([])
  })
})

describe('ten characters typed to the pet', () => {
  it('each character draws the pet, and no page and no surface; the field keeps its focus and its words', async () => {
    const view = await openApp({ enterEveryPage: true })
    const input = await openChat(view)
    expect(input).not.toBeNull()
    input.focus()
    const mark = renderSpy.mark()
    for (let i = 1; i <= 10; i++) {
      await act(async () => { fireEvent.change(input, { target: { value: 'lighthouse'.slice(0, i) } }) })
    }
    expect(renderSpy.renders('PetCompanion', mark)).toBe(10)
    expect(renderSpy.which(SHELL, mark)).toEqual([])
    expect(chatInput()).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('lighthouse')
  })

  // Red until AgentProvider's value was memoized and its input text taken out of it: each character was a new
  // value, and Settings' wrapper reads the value, so Settings ran ten times (O.T.T.E.R. and R.A.B.B.I.T. read it
  // too; AgentProvider.rerender.test.jsx holds a reader like theirs).
  it('ten characters typed to the agent (the pet at work, on O.T.T.E.R.) draw the pet and no page; the field keeps its focus', async () => {
    const view = await openApp({ enterEveryPage: true })
    await goTo('otter')
    await openChat(view)
    await act(async () => { fireEvent.click(document.querySelector('button[title="Switch to Agent"]')) })
    const input = document.querySelector('input[placeholder^="Tell Biscuit"]')
    expect(input).not.toBeNull()
    input.focus()
    const mark = renderSpy.mark()
    for (let i = 1; i <= 10; i++) {
      await act(async () => { fireEvent.change(input, { target: { value: 'lighthouse'.slice(0, i) } }) })
    }
    expect(renderSpy.renders('PetCompanion', mark)).toBe(10)
    expect(renderSpy.which(SHELL, mark)).toEqual([])
    expect(document.querySelector('input[placeholder^="Tell Biscuit"]')).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('lighthouse')
  })

  it('the field being typed in keeps its focus and its words across a minute of the pet\'s own ticks', async () => {
    const view = await openApp()
    const input = await openChat(view)
    input.focus()
    await act(async () => { fireEvent.change(input, { target: { value: 'half a tho' } }) })
    await runFor(60_000)
    expect(chatInput()).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('half a tho')
  })
})

// ── React.memo on the pages and the tools' roots ──
// MEASURED BEFORE the memo (2026-11-13, at the commit before it: the pet's host and the agent's value were in,
// so the pet no longer rendered App, and App's own renders still ran every page). Opening the nav strip and
// moving over three of its rows was 4 renders of App, and each ran all twelve standing pages (48 page renders).
// One change of page (D.O.G. to O.T.T.E.R.) was 6 renders of App, and each ran all twelve (72).
describe('App renders for its own reasons, and the pages are not handed to React again', () => {
  const runs = (mark) => Object.fromEntries(PAGES.map((name) => [name, renderSpy.renders(name, mark)]))

  it('the nav strip opened and three of its rows pointed at: App runs four times, and no page under React.memo runs', async () => {
    const view = await openApp({ enterEveryPage: true })
    await goTo('dog')
    const mark = renderSpy.mark()
    await act(async () => { fireEvent.click(view.container.querySelector('button[aria-label="Navigation"], button[title="Navigation"]')) })
    const rows = [...view.container.querySelectorAll('.wilson-nav-item')].slice(0, 3)
    expect(rows).toHaveLength(3)
    for (const row of rows) await act(async () => { fireEvent.mouseEnter(row) })
    expect(renderSpy.renders('App', mark)).toBe(4)
    // The Admin terminal is the one page left out of the memo on purpose (it computes "5m ago" while it draws).
    expect(runs(mark)).toEqual({ ...Object.fromEntries(PAGES.map((name) => [name, 0])), AdminTerminalPage: 4 })
  })

  it('a change of page: each page that is handed the page\'s name runs once, and a page that is handed nothing does not run', async () => {
    await openApp({ enterEveryPage: true })
    await goTo('dog')
    const mark = renderSpy.mark()
    await startTo('otter')
    await runFor(2200)                                // the transition's steps one at a time, as a browser runs them
    expect(renderSpy.renders('App', mark)).toBe(6)
    expect(runs(mark)).toEqual({
      Home: 1, DeckOutlineGenerator: 1, Otter: 1, Rabbit: 1, Projects: 1,       // handed the page's name, or onNavigate
      MothPage: 0, SettingsPage: 0, RateCardPage: 0, TeamMembersPage: 0, DashboardPage: 0, HelpPage: 0,
      AdminTerminalPage: 6,                                                  // not under the memo: with every step
    })
  })
})

describe('Settings shows the pet, and only Settings does', () => {
  it('on the Settings page a decay tick reaches the card (80 becomes 79) and no other page', async () => {
    await openApp({ pet: adultPet({ hunger: 79.6 }) })
    await goTo('settings')
    expect(settingsPet()).toBe('Biscuit content 80/100 mode on')
    const mark = renderSpy.mark()
    await runFor(28_000)                              // past the tick at 30 s
    expect(settingsPet()).toBe('Biscuit content 79/100 mode on')
    expect(renderSpy.which(PAGES.filter((name) => name !== 'SettingsPage'), mark)).toEqual([])
  })

  it('Pet Mode turned off in Settings turns the pet\'s mode off, and the pet is saved so', async () => {
    await openApp()
    await goTo('settings')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'toggle pet mode' })) })
    await tick(10)
    expect(settingsPet()).toBe('Biscuit content 80/100 mode off')
    expect(world.saves.at(-1)).toMatchObject({ name: 'Biscuit', petMode: false })
  })
})

describe('the pet itself (green before F4 and after)', () => {
  it('the dream cloud comes at 4.5 s for 3 s; the attention jump at 40 s for half a second', async () => {
    const view = await openApp()
    expect(cloud(view)).toBeNull()
    await tick(4500)
    expect(cloud(view)).not.toBeNull()
    await tick(3000)
    expect(cloud(view)).toBeNull()
    await tick(32_400)                                // 39.95 s
    expect(sprite(view).className).not.toContain('attention-jump')
    await tick(100)                                   // 40.05 s
    expect(sprite(view).className).toContain('attention-jump')
    await tick(500)
    expect(sprite(view).className).not.toContain('attention-jump')
  })

  it('asleep, the cloud stays and its "Z" grows every 2 s: Z, Zz, Zzz, Z', async () => {
    const view = await openApp({ pet: asleep() })
    const said = () => cloud(view)?.textContent
    expect(said()).toBe('Z')
    await tick(2000); expect(said()).toBe('Zz')
    await tick(2000); expect(said()).toBe('Zzz')
    await tick(2000); expect(said()).toBe('Z')
  })

  it('a message sent is answered: the page and the pet go to the model, the reply is drawn, the field is emptied', async () => {
    world.ai = vi.fn(async () => ({ content: [{ type: 'text', text: 'Hello from the lighthouse.' }] }))
    const view = await openApp()
    const input = await openChat(view)
    await act(async () => { fireEvent.change(input, { target: { value: 'hello there' } }) })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    await tick(50)
    expect(world.ai).toHaveBeenCalledTimes(1)
    const sent = world.ai.mock.calls[0][0]
    expect(sent.tool).toBe('companion')
    expect(sent.messages).toEqual([{ role: 'user', content: 'hello there' }])
    expect(sent.system).toContain('CURRENT WILSON PAGE: home')
    expect(sent.system).toContain('Name: Biscuit')
    expect(view.container.textContent).toContain('hello there')
    expect(view.container.textContent).toContain('Hello from the lighthouse.')
    expect(chatInput().value).toBe('')
  })

  it('at work on O.T.T.E.R., what is typed to the agent is sent to it, and the field is emptied', async () => {
    const view = await openApp()
    await goTo('otter')
    await openChat(view)
    await act(async () => { fireEvent.click(document.querySelector('button[title="Switch to Agent"]')) })
    const input = document.querySelector('input[placeholder^="Tell Biscuit"]')
    await act(async () => { fireEvent.change(input, { target: { value: 'fix the title' } }) })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    await tick(50)
    expect(world.ai).toHaveBeenCalledTimes(1)
    expect(world.ai.mock.calls[0][0].tool).toBe('agent')
    expect(world.ai.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'fix the title' }])
    expect(document.querySelector('input[placeholder^="Tell Biscuit"]').value).toBe('')
    expect(view.container.textContent).toContain('fix the title')
  })

  it('a tap of Shift opens the chat and a second closes it', async () => {
    const view = await openApp()
    expect(chatInput()).toBeNull()
    const tap = async () => {
      await act(async () => { fireEvent.keyDown(window, { key: 'Shift', shiftKey: true }) })
      await act(async () => { fireEvent.keyUp(window, { key: 'Shift', shiftKey: false }) })
    }
    await tap()
    expect(chatInput()).not.toBeNull()
    await tap()
    expect(chatInput()).toBeNull()
    expect(sprite(view)).not.toBeNull()
  })

  it('Feed raises the hunger by 25, on the pet\'s own bar and in what is saved, and Settings shows it when it is opened', async () => {
    const view = await openApp({ pet: adultPet({ hunger: 50 }) })
    await openChat(view)
    const bar = () => view.container.querySelector('.slide-up .transition-all').style.width
    expect(bar()).toBe('50%')
    await act(async () => { fireEvent.click(view.container.querySelector('button[title="Feed"]')) })
    await tick(10)
    expect(bar()).toBe('75%')
    expect(world.saves.at(-1)).toMatchObject({ hunger: 75 })
    await goTo('settings')
    expect(settingsPet()).toBe('Biscuit content 75/100 mode on')
  })

  // The one test under this heading that was red before F4 (every tick drew Settings): its first half is a pin.
  it('Settings off screen is handed no tick of the pet, and is handed the pet as it is when it comes back', async () => {
    await openApp({ pet: adultPet({ hunger: 79.6 }) })
    await goTo('settings')
    expect(settingsPet()).toBe('Biscuit content 80/100 mode on')
    await goTo('home')
    const mark = renderSpy.mark()
    await runFor(31_000)                              // a decay tick, with Settings off screen
    expect(renderSpy.renders('SettingsPage', mark)).toBe(0)
    await goTo('settings')
    expect(settingsPet()).toBe('Biscuit content 79/100 mode on')
  })

  it('a change of page closes the chat and slides the pet out, and brings the pet back when it is done', async () => {
    const view = await openApp()
    await openChat(view)
    expect(chatInput()).not.toBeNull()
    await startTo('dog')
    expect(chatInput()).toBeNull()
    expect(sprite(view).className).toContain('pet-slide-out')
    await tick(2200)
    expect(sprite(view).className).toContain('pet-slide-in')
    expect(chatInput()).toBeNull()
  })
})

// ── A change of person: another signed in over this one, or this one signed out ──
// Review round 1 (A-1, A-3). Since F4 the pet's material-change save is a
// PetHost effect, and a child's effects run before App's in a commit they
// share: in the commit that signs B in over A, a decay tick's change of A's
// pet was saved before App's identity effect cleared A's routing, and went out
// with B's session (saveCloudPet names no user). And the chat was never
// cleared: B was shown A's conversation, and it went to the model as B's.
// Review round 2 (A-R2-1 to A-R2-6, and reviewer D's two cases): that check
// was made when a write starts, so a save queued behind one in flight went to
// B's row, or at a sign-out to the device's unattributed store, and a refused
// one told B "could not be reached" about A's change; an answer on its way
// landed after the clear; the clear needed A's routing to have been installed
// (and a thumb then rated A's words into B's pet); the hatch dialog and the
// stale-copy refresh outlived the person; and the one-commit check said only
// who drew (PetHost draws in every commit of App's). Found with them: a failed
// write of A's was said to B, and A's Pet Mode resume, told of a landing (its
// own, or B's that overtook it), stamped B's pet and saved it.
describe('a change of person: another signed in over this one, or this one signed out (review rounds 1 and 2)', () => {
  // Asleep 100 s of its 120 (medium): the decay tick at 30 s wakes it, a material change, saved at once.
  const wakesAtTheTick = () => asleep({
    sleepingSince: new Date(NOW.getTime() - 100_000).toISOString(),
    lastSleptAt: new Date(NOW.getTime() - 100_000).toISOString(),
  })
  const nextField = () => document.querySelector('input[placeholder^="Ask Bramble"]')
  const feed = (view) => view.container.querySelector('button[title="Feed"]')
  const thumbsUp = () => document.querySelector('.lucide-thumbs-up')?.closest('button') ?? null
  const confirm = () => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Confirm') ?? null
  const egg = () => adultPet({ form: 'egg', eggPetCount: 0, eggHatchThreshold: 2, bornAt: null, evolvedAt: null })
  /** Every cloud write from here on is held in flight, until the function returned is called: with an error, they fail. */
  const holdCloudWrites = () => {
    let settle
    world.gate = { promise: new Promise((resolve, reject) => { settle = (error) => (error ? reject(error) : resolve()) }) }
    return (error) => { world.gate = null; settle(error) }
  }
  /** The first person asks their pet something, from its chat. */
  async function askAsFirstPerson(view) {
    const input = await openChat(view)
    await act(async () => { fireEvent.change(input, { target: { value: 'my own question' } }) })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    await tick(50)
  }
  /** The next person's chat field, on their own pet (Bramble), which must be the one on screen. */
  async function nextPersonsField(view) {
    if (!nextField()) await act(async () => { fireEvent.click(sprite(view)) })
    expect(nextField()).not.toBeNull()
    return nextField()
  }
  /** The conversation the next person's first message takes to the model. */
  async function nextPersonSends(field) {
    world.ai = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await act(async () => { fireEvent.change(field, { target: { value: 'hello' } }) })
    await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }) })
    await tick(50)
    return world.ai.mock.calls[0][0].messages
  }
  /**
   * What PetHost held at each commit `run` drew, read off the committed tree as React hands it to the commit hook:
   * the person App handed it as signed in, and its pet (its first state). renderSpy says who drew; this, with what.
   */
  async function petHostAtEachCommit(run) {
    const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__
    const record = hook.onCommitFiberRoot
    const seen = []
    const find = (fiber) => {
      for (let node = fiber; node; node = node.sibling) {
        if (node.type?.name === 'PetHost') return node
        const inner = find(node.child)
        if (inner) return inner
      }
      return null
    }
    hook.onCommitFiberRoot = (...args) => {
      record.apply(hook, args)
      const host = find(args[1].current)
      const pet = host?.memoizedState?.memoizedState ?? null
      seen.push({ signedIn: host?.memoizedProps.perms?.userId ?? null, pet: pet && { name: pet.name, sleepingSince: pet.sleepingSince } })
    }
    try { await run() } finally { hook.onCommitFiberRoot = record }
    return seen
  }

  it('CONTROL: with nobody else signing in, the tick wakes the pet and the waking is saved, to the person signed in', async () => {
    await openApp({ pet: wakesAtTheTick() })
    world.rows.length = 0
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    await tick(50)
    expect(world.rows).toEqual([{ session: 'u-1', name: 'Biscuit', sleepingSince: null }])
  })

  it('the tick\'s change of the leaving person\'s pet, in the same commit as the next person\'s sign-in, is written to no account', async () => {
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    const view = await openApp({ pet: wakesAtTheTick() })
    world.rows.length = 0
    // A synchronous act and timers: React draws the sign-in and the tick in ONE commit (an async act would draw the
    // sign-in first, in a commit of its own, and the identity effect would then run before the tick's save).
    const commits = await petHostAtEachCommit(() => act(() => { signInAs('u-B'); vi.advanceTimersByTime(30_000) }))
    // A-R2-6: said of what the commit holds, not of who drew in it (PetHost draws in every commit of App's): the first
    // commit hands PetHost the next person AND holds the pet the tick woke. A sign-in drawn alone, which the old check
    // (App and PetHost among the first commit's names) passed, gives the same person with the pet still asleep.
    expect(commits[0]).toEqual({ signedIn: 'u-B', pet: { name: 'Biscuit', sleepingSince: null } })
    await tick(50)
    expect(world.rows.filter((row) => row.name === 'Biscuit')).toEqual([])
    // And the next person's pet is the one there.
    if (!nextField()) await act(async () => { fireEvent.click(sprite(view)) })
    expect(nextField()).not.toBeNull()
  })

  it('the leaving person\'s chat, and what they were typing, leave with them: the next person is shown none and sends none', async () => {
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    world.ai = vi.fn(async () => ({ content: [{ type: 'text', text: 'A reply for the first person.' }] }))
    const view = await openApp()
    const input = await openChat(view)
    await act(async () => { fireEvent.change(input, { target: { value: 'my own question' } }) })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    await tick(50)
    expect(view.container.textContent).toContain('A reply for the first person.')
    await act(async () => { fireEvent.change(chatInput(), { target: { value: 'half a tho' } }) })
    await act(async () => { signInAs('u-B') })
    await tick(50)
    if (!nextField()) await act(async () => { fireEvent.click(sprite(view)) })
    const field = nextField()
    expect(field).not.toBeNull()
    expect(view.container.textContent).not.toContain('my own question')
    expect(view.container.textContent).not.toContain('A reply for the first person.')
    expect(field.value).toBe('')
    world.ai.mockClear()
    await act(async () => { fireEvent.change(field, { target: { value: 'hello' } }) })
    await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }) })
    await tick(50)
    expect(world.ai.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  // ── Review round 2 ──
  it('A-R2-1: a save queued behind one in flight is written for nobody once another person is signed in, their own pet landed first', async () => {
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    const view = await openApp({ pet: adultPet({ hunger: 50 }) })
    await openChat(view)
    world.rows.length = 0
    const release = holdCloudWrites()
    await act(async () => { fireEvent.click(feed(view)) })     // 50 to 75: out, and held
    await act(async () => { fireEvent.click(feed(view)) })     // 75 to 100: queued behind it
    expect(world.rows).toEqual([{ session: 'u-1', name: 'Biscuit', sleepingSince: null }])
    await act(async () => { signInAs('u-B') })
    await tick(50)                                              // B's read lands: B's pet, B's routing
    await nextPersonsField(view)
    await act(async () => { release() })
    await tick(50)
    // Before: the queued 100 went out under B's session, and into B's cache ({ u-B, Biscuit } in both).
    expect(world.rows).toEqual([{ session: 'u-1', name: 'Biscuit', sleepingSince: null }])
    expect(world.mirrors.filter((mirror) => mirror.owner === 'u-B')).toEqual([])
  })

  it('A-R2-1: a save queued behind one in flight, when the person signs out before it runs, is written to no store', async () => {
    const view = await openApp({ pet: adultPet({ hunger: 50 }) })
    await openChat(view)
    world.rows.length = 0
    world.mirrors.length = 0
    const release = holdCloudWrites()
    await act(async () => { fireEvent.click(feed(view)) })
    await act(async () => { fireEvent.click(feed(view)) })
    await act(async () => { signInAs(null) })                  // the sign-out reaches the permissions
    await tick(50)
    await act(async () => { release() })
    await tick(50)
    // Before: the queued 100 went to the device's unattributed store ({ owner: null, Biscuit, 100 }).
    expect({ rows: world.rows, local: world.local, mirrors: world.mirrors }).toEqual({
      rows: [{ session: 'u-1', name: 'Biscuit', sleepingSince: null }], local: [], mirrors: [],
    })
  })

  it('the leaving person\'s refused save says nothing to the next person', async () => {
    world.failFor.add('u-B')                                    // B's read fails: B's own cached pet comes up, with B's error
    world.cacheOf['u-B'] = adultPet({ name: 'Bramble' })
    const view = await openApp({ pet: adultPet({ hunger: 50 }) })
    await openChat(view)
    const release = holdCloudWrites()
    await act(async () => { fireEvent.click(feed(view)) })
    await act(async () => { fireEvent.click(feed(view)) })     // queued: the first person's
    await act(async () => { signInAs('u-B') })
    await tick(50)
    await nextPersonsField(view)
    expect(view.container.textContent).toContain('The account read failed.')     // B's own error, said to B
    await act(async () => { release() })
    await tick(50)
    // Before: "Bramble isn't being saved. Your pet could not be reached in your account ... Reopen WILSON", about A's Feed.
    expect(view.container.textContent).not.toContain('could not be reached')
  })

  it('a write whose session moves to another person after the check is refused by the database, and the next person is told nothing of it', async () => {
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    const view = await openApp({ pet: adultPet({ hunger: 50 }) })
    await openChat(view)
    world.rows.length = 0
    // Another tab signs in as u-B: the client's session moves as the Feed's write goes out, before App has drawn it.
    world.sessionMovesTo = 'u-B'
    await act(async () => { fireEvent.click(feed(view)) })
    await tick(10)
    // Before: the row named no owner, so the column default filed the first person's pet in u-B's row.
    expect(world.rows).toEqual([])
    await act(async () => { signInAs('u-B') })                 // App hears of it
    await tick(50)
    await nextPersonsField(view)
    expect(view.container.textContent).not.toContain('row-level security')
  })

  it('nor does a write of theirs that fails once they have gone', async () => {
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    const view = await openApp({ pet: adultPet({ hunger: 50 }) })
    await openChat(view)
    const release = holdCloudWrites()
    await act(async () => { fireEvent.click(feed(view)) })     // out, and held
    await act(async () => { signInAs('u-B') })
    await tick(50)
    await nextPersonsField(view)
    await act(async () => { release(new Error('The write timed out.')) })
    await tick(50)
    expect(view.container.textContent).not.toContain('The write timed out.')
  })

  it('and one that lands once they have gone is not a landing: Pet Mode\'s resume does not stamp the next person\'s pet', async () => {
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    await openApp({ pet: adultPet({ petMode: false }) })
    await goTo('settings')
    const release = holdCloudWrites()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'toggle pet mode' })) })   // on: the held anchor first
    await act(async () => { signInAs('u-B') })
    await tick(50)
    expect(settingsPet()).toContain('Bramble')
    world.rows.length = 0
    await act(async () => { release() })
    await tick(50)
    // A landing earns a fresh anchor (resumeAnchorAfterLandedSave): one of A's must not be stamped on B's pet and saved.
    expect(world.rows).toEqual([])
  })

  it('nor is a save of theirs that the next person\'s overtook in the queue (it settles with that one\'s result)', async () => {
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    const view = await openApp()
    await goTo('settings')
    const toggle = () => screen.getByRole('button', { name: 'toggle pet mode' })
    const release = holdCloudWrites()
    await act(async () => { fireEvent.click(toggle()) })        // off: out, and held
    await act(async () => { fireEvent.click(toggle()) })        // on again, a resume: queued behind it
    await act(async () => { signInAs('u-B') })
    await tick(50)
    await nextPersonsField(view)
    world.rows.length = 0
    await act(async () => { fireEvent.click(feed(view)) })     // B's Feed, queued: it takes the resume's place
    await act(async () => { release() })
    await tick(50)
    // B's Feed is written, and only it: told that landing was its own, A's resume stamped B's pet and saved it again.
    expect(world.rows).toEqual([{ session: 'u-B', name: 'Bramble', sleepingSince: null }])
  })

  it('A-R2-2: an answer still on its way when another person signs in is dropped: they are not shown it and do not send it', async () => {
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    let answer
    world.ai = vi.fn(() => new Promise((resolve) => { answer = resolve }))
    const view = await openApp()
    await askAsFirstPerson(view)
    expect(world.ai).toHaveBeenCalledTimes(1)
    await act(async () => { signInAs('u-B') })
    await tick(50)
    await act(async () => { answer({ content: [{ type: 'text', text: 'A reply for the first person.' }] }) })
    await tick(50)
    const field = await nextPersonsField(view)
    expect(view.container.textContent).not.toContain('A reply for the first person.')
    expect(await nextPersonSends(field)).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('A-R2-2: and one on its way when the person signs out: the next person to sign in is not shown it and does not send it', async () => {
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    let answer
    world.ai = vi.fn(() => new Promise((resolve) => { answer = resolve }))
    const view = await openApp()
    await askAsFirstPerson(view)
    await act(async () => { signInAs(null) })
    await tick(50)
    await act(async () => { answer({ content: [{ type: 'text', text: 'A reply for the first person.' }] }) })
    await tick(50)
    await act(async () => { signInAs('u-B') })
    await tick(50)
    const field = await nextPersonsField(view)
    expect(view.container.textContent).not.toContain('A reply for the first person.')
    expect(await nextPersonSends(field)).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('A-R2-3: with no routing installed (the first person\'s read failed), their chat leaves all the same, and none of it is rated into the next pet', async () => {
    world.failFor.add('u-1')                                    // A's read fails: A's cached pet stays, with no routing
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    world.ai = vi.fn(async () => ({ content: [{ type: 'text', text: 'A reply for the first person.' }] }))
    const view = await openApp()
    await askAsFirstPerson(view)
    expect(view.container.textContent).toContain('A reply for the first person.')
    await act(async () => { fireEvent.change(chatInput(), { target: { value: 'half a tho' } }) })
    await act(async () => { signInAs('u-B') })
    await tick(50)
    const field = await nextPersonsField(view)
    // A thumb on what the chat holds writes it into the pet's feedback, and the pet is saved: B's pet, to B's row.
    world.saves.length = 0
    if (thumbsUp()) await act(async () => { fireEvent.click(thumbsUp()) })
    await tick(10)
    expect(JSON.stringify(world.saves)).not.toContain('my own question')
    expect(view.container.textContent).not.toContain('my own question')
    expect(view.container.textContent).not.toContain('A reply for the first person.')
    expect(field.value).toBe('')
    expect(await nextPersonSends(field)).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('A-R2-3: and when the next person\'s read fails too, the first person\'s cached pet is not left on their screen', async () => {
    world.failFor.add('u-1')
    world.failFor.add('u-B')
    world.cacheOf['u-B'] = null                                 // and B has no pet cached on this computer
    const view = await openApp()
    expect(sprite(view)).not.toBeNull()                          // A's cached pet
    await act(async () => { signInAs('u-B') })
    await tick(50)
    // Before: A's pet stayed on B's screen, and its feedback, quoting A's chat, went into B's system prompt.
    expect(sprite(view)).toBeNull()
  })

  it('A-R2-4: the hatch dialog and the name typed into it leave with the person', async () => {
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    const view = await openApp({ pet: egg() })
    await act(async () => { fireEvent.click(sprite(view)) })
    await act(async () => { fireEvent.click(sprite(view)) })    // the second pat hatches it
    await tick(600)                                              // and the dialog comes up
    const name = screen.getByText('Your egg hatched!').parentElement.querySelector('input')
    await act(async () => { fireEvent.change(name, { target: { value: 'A private name' } }) })
    await act(async () => { signInAs('u-B') })
    await tick(50)
    world.rows.length = 0
    if (confirm()) await act(async () => { fireEvent.click(confirm()) })
    await tick(10)
    // Before: B's pet came up under "Your egg hatched!" with A's words, and Confirm wrote { session: 'u-B', name: 'A private name' }.
    expect(world.rows).toEqual([])
    expect(view.container.textContent).not.toContain('Your egg hatched!')
    expect([...document.querySelectorAll('input')].map((input) => input.value)).not.toContain('A private name')
  })

  it('A-R2-4: a hatch dialog still due when the person changes does not come up for the next person', async () => {
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    const view = await openApp({ pet: egg() })
    await act(async () => { fireEvent.click(sprite(view)) })
    await act(async () => { fireEvent.click(sprite(view)) })    // hatched: the dialog is due in 600 ms
    await act(async () => { signInAs('u-B') })
    await tick(700)
    expect(view.container.textContent).not.toContain('Your egg hatched!')
  })

  it('A-R2-5: the stale-copy refresh is put on screen and in the cache only for the person it was read for', async () => {
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    const view = await openApp({ pet: adultPet({ hunger: 50 }) })
    await openChat(view)
    world.mirrors.length = 0
    // 0068 refuses the first person's Feed; the re-read of their account is held until the next person's pet has landed.
    world.refuse = Object.assign(new Error('pet_stale_write'), { stale: true })
    let reread = null
    world.reread = () => new Promise((resolve) => { reread = () => resolve(adultPet({ hunger: 60 })) })
    await act(async () => { fireEvent.click(feed(view)) })
    await tick(10)
    expect(reread).not.toBeNull()                               // the re-read is out
    await act(async () => { signInAs('u-B') })
    await tick(50)
    await act(async () => { reread() })
    await tick(50)
    // Before: A's Biscuit came up on B's screen, mirrored into B's cache ({ u-B, Biscuit }), and B's next Feed wrote it to B's row.
    await nextPersonsField(view)
    expect(chatInput()).toBeNull()
    expect(world.mirrors.filter((mirror) => mirror.name === 'Biscuit')).toEqual([])
    world.rows.length = 0
    await act(async () => { fireEvent.click(feed(view)) })
    await tick(10)
    expect(world.rows).toEqual([{ session: 'u-B', name: 'Bramble', sleepingSince: null }])
  })

  it('the stale-copy re-read, gone out after the session moved to another person, brings nothing of theirs: not on screen, not in the cache', async () => {
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    const view = await openApp({ pet: adultPet({ hunger: 50 }) })
    await openChat(view)
    world.mirrors.length = 0
    world.refuse = Object.assign(new Error('pet_stale_write'), { stale: true })   // 0068 refuses the Feed,
    world.reread = (session) => (world.petOf[session] ? { ...world.petOf[session] } : null)
    world.sessionMovesTo = 'u-B'                                  // and the re-read goes out after another tab signed in as u-B
    await act(async () => { fireEvent.click(feed(view)) })
    await tick(10)
    // Before: named for nobody, the re-read answered with u-B's Bramble as the first person's pet, put it on screen
    // and mirrored it into u-1's cache.
    expect(nextField()).toBeNull()
    expect(chatInput()).not.toBeNull()
    expect(world.mirrors).toEqual([])
  })

  // ── The launch race: the stored session is the first person's, and the permissions resolve as somebody else ──
  // (another tab's sign-in while this one launched). The cold start's instant render is kept for the stored
  // session's own person only.
  it('the stored session\'s cached pet leaves when the permissions resolve as somebody else, and stays gone when their read fails', async () => {
    world.stored = storedSessionOf('u-1')
    world.perms = { ...PERMS, ready: false, userId: null }    // the permissions have not resolved
    world.failFor.add('u-B')                                  // u-B's read fails,
    world.cacheOf['u-B'] = null                               // and nothing of theirs is cached here
    const view = await openApp()
    expect(sprite(view)).not.toBeNull()                       // u-1's cached pet, at once
    await act(async () => { permissionsResolveAs('u-B') })
    // Before: the first identity a launch saw was never blanked for, so u-1's pet stayed for u-B, read or no read.
    expect(sprite(view)).toBeNull()
    await tick(50)
    expect(sprite(view)).toBeNull()
  })

  it('when the permissions resolve as somebody else before the cached read lands, the stored session\'s pet is never shown', async () => {
    world.stored = storedSessionOf('u-1')
    world.perms = { ...PERMS, ready: false, userId: null }
    world.petOf['u-B'] = adultPet({ name: 'Bramble' })
    let releaseCache
    world.cacheGate = { promise: new Promise((resolve) => { releaseCache = resolve }) }
    let view
    const drawn = await petHostAtEachCommit(async () => {
      view = await openApp()                                  // u-1's cached read is out, and held
      await act(async () => { permissionsResolveAs('u-B') })  // u-B's read lands: Bramble
      await tick(50)
      world.cacheGate = null
      await act(async () => { releaseCache() })               // then u-1's cached read lands
      await tick(50)
    })
    // Before: u-1's Biscuit replaced u-B's Bramble on screen, with u-B's routing installed.
    expect(drawn.map((commit) => commit.pet?.name).filter(Boolean)).not.toContain('Biscuit')
    await nextPersonsField(view)
  })

  it('and when they have named somebody else before the stored session is read, it does not take the cache key: a sign-out clears their cache', async () => {
    world.stored = storedSessionOf('u-A')                     // another person's stored session; the permissions say u-1
    world.failFor.add('u-1')                                  // and u-1's read fails, so no routing names them
    await openApp()
    await act(async () => { await window.wilsonSignOut({ event: null }) })
    // Before: the cached read set the key to u-A over u-1's, and the sign-out cleared u-A's cache, leaving u-1's.
    expect(world.cleared).toEqual(['u-1'])
  })
})
