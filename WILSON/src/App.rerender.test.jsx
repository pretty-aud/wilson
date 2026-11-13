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

const world = vi.hoisted(() => ({ pet: null, saves: [], ai: null }))

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
vi.mock('./cloud/auth/sessionStorage', async (importOriginal) => ({ ...(await importOriginal()), loadSession: async () => null, clearSession: async () => {} }))
const TIMEOUTS = { phase: null, deadline: null, stay: () => {} }
vi.mock('./cloud/auth/sessionTimeouts', async (importOriginal) => ({ ...(await importOriginal()), useSessionTimeouts: () => TIMEOUTS }))
vi.mock('./cloud/workspaceStorage', () => ({ fetchWorkspaceStorage: async () => null, clearWorkspaceStorageCache: () => {} }))
vi.mock('./cloud/aiProxy', () => ({ callAI: (...args) => world.ai(...args), isRetryableAIError: () => false }))
vi.mock('./cloud/aiFiles', () => ({ releaseAllAIFiles: async () => {} }))
vi.mock('./lib/modelSources', () => ({ loadModelSources: async () => {}, migrateLegacyUserModelPrefs: async () => {} }))
vi.mock('./lib/localData', () => ({
  hasLocalServer: () => false,
  loadPet: async () => (world.pet ? { ...world.pet } : null),
  savePetData: async (pet) => { world.saves.push(pet) },
  clearPetCache: async () => {},
  loadOtterSettings: async () => ({}),
  saveOtterSettings: async () => ({}),
  loadAgentSkills: async () => ({}),
}))
vi.mock('./lib/userState', () => ({
  resolveUserPet: async () => ({ pet: world.pet ? { ...world.pet } : null, adopted: false }),
  saveCloudPet: async (pet) => { world.saves.push(pet) },
  mirrorPetToCache: async () => {},
  fetchCloudPet: async () => null,
  isStalePetWrite: () => false,
  resolveUserSettings: async () => ({ settings: null }),
  mirrorSettingsToCache: async () => {},
  setUserStateOwner: () => {},
  getUserStateOwner: () => 'u-1',
}))
const PERMS = { ready: true, userId: 'u-1', role: 'member', workspaceId: 'w-1', isPlatformOperator: false, offline: false }
vi.mock('./permissions', () => ({ usePermissions: () => PERMS }))
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
  world.ai = vi.fn(() => new Promise(() => {}))
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
