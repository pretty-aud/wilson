/** @vitest-environment jsdom */
// =============================================================================
// App.focus.test.jsx — a field being typed in keeps its focus and its words,
// and the two tools are left alone, across everything F4 touched (F4,
// 2026-11-13).
//
// "A lost focus once turned Enter into 'make a deck'" (PLAN_TO_1_0.md §5,
// rule 7). F4 moves the pet into its own host, puts React.memo on the tools'
// roots and takes R.A.B.B.I.T.'s volatile state out of the value D.O.G. reads,
// and each of those could remount a component a field lives in. So the REAL
// App is mounted here with the REAL D.O.G., the REAL O.T.T.E.R. and the REAL
// R.A.B.B.I.T. provider (on the dev fixtures, its project open), and three
// fields are typed in while the pet ticks, the pet is typed to, and a
// presence heartbeat arrives: the pet's own field, D.O.G.'s deck context box
// and O.T.T.E.R.'s functions search (which sits inside one of the reference
// views F4 turns into a component of its own).
//
// The same mount is the second half of the brief's pin "a character typed in
// the pet renders no page and no tool root": App.rerender.test.jsx counts the
// pages as stand-ins; here the two tool roots are the real ones.
//
// MEASURED BEFORE F4's change (2026-11-13, at the brief's tip a71cd144; the
// render pins red, the three focus tests green): a minute of the pet (13
// changes of its state here: its clocks from 3 s to 63 s) ran D.O.G. 13
// times and O.T.T.E.R. 13 times; ten characters typed to the pet ran each 10
// times; one presence heartbeat ran D.O.G. once (60 component renders with
// what it draws) and O.T.T.E.R. not at all.
// =============================================================================
import { renderSpy } from './lib/renderSpy'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react'

const world = vi.hoisted(() => ({ pet: null, saves: [], ai: null, adapter: null, projectId: null, live: { project: null } }))

// ── The pages that are not under test: stand-ins of the same names ──
vi.mock('./components/Home', () => ({ default: function Home() { return <p>home page</p> } }))
vi.mock('./tools/rabbit_v0.1.0/Rabbit.jsx', () => ({ default: function Rabbit() { return <p>rabbit page</p> } }))
vi.mock('./tools/moth_v0.1.0/MothPage.jsx', () => ({ default: function MothPage() { return <p>moth page</p> } }))
vi.mock('./components/SettingsPage', () => ({ default: function SettingsPage() { return <p>settings page</p> } }))
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
vi.mock('./cloud/workspaceStorage', () => ({ fetchWorkspaceStorage: async () => null, clearWorkspaceStorageCache: () => {}, peekWorkspaceStorageCached: () => null, getWorkspaceStorageCached: async () => null }))
vi.mock('./cloud/aiProxy', async (importOriginal) => ({ ...(await importOriginal()), callAI: (...args) => world.ai(...args), isRetryableAIError: () => false }))
vi.mock('./cloud/aiFiles', async (importOriginal) => ({ ...(await importOriginal()), releaseAllAIFiles: async () => {}, uploadAIFile: vi.fn(), deleteAIFiles: vi.fn() }))
vi.mock('./lib/modelSources', async (importOriginal) => ({ ...(await importOriginal()), loadModelSources: async () => {}, migrateLegacyUserModelPrefs: async () => {} }))
vi.mock('./lib/localData', () => ({
  hasLocalServer: () => false,
  loadPet: async () => (world.pet ? { ...world.pet } : null),
  savePetData: async (pet) => { world.saves.push(pet) },
  clearPetCache: async () => {},
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'supabase', activeProjectId: world.projectId } }),
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
  pushSettingsToCloud: async () => {},
}))
const PERMS = { ready: true, userId: 'u-1', role: 'admin', workspaceId: 'w-1', isPlatformOperator: false, offline: false, can: () => true }
vi.mock('./permissions/usePermissions', () => ({ usePermissions: () => PERMS }))
vi.mock('./tools/rabbit_v0.1.0/storage/s3Provider', async (importOriginal) => ({ ...(await importOriginal()), clearS3ReadUrlCache: () => {} }))

// ── R.A.B.B.I.T.'s provider, real, on the dev fixtures; its channel is the test's ──
vi.mock('./tools/rabbit_v0.1.0/adapters', () => ({
  selectAdapter: () => world.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => true,
}))
vi.mock('./tools/rabbit_v0.1.0/adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('./dev/devFixtures', async (importOriginal) => ({ ...(await importOriginal()), devFixtures: () => null }))
vi.mock('./tools/rabbit_v0.1.0/intake/pipeline', () => ({ runIngestion: vi.fn() }))

// ── O.T.T.E.R., real, over a small library held here: one coding course with a lesson and three functions ──
const COURSE = { slug: 'csharp', name: 'C#', type: 'coding_language', skill_level: 'beginner', visibility: 'personal', is_own: true, can_write: true, can_read_content: true, owner_id: 'u-1' }
const SUBJECT = {
  id: 'sub-1', slug: 'loops', title: 'Loops', is_stub: false, subject_order: 1, skill_level: 'beginner',
  sections: [{ id: 's1', title: 'Going round', lessons: [{ id: 'lesson_1_1', title: 'The for loop', content: 'A loop repeats.\n\n```csharp\nfor (var i = 0; i < 3; i++) { Console.WriteLine(i); }\n```\n\nThat is all.', key_takeaways: ['A loop repeats'], practice_prompt: 'Write one.' }] }],
}
const FUNCTIONS = { categories: [{ category: 'Console', functions: [
  { name: 'Console.WriteLine', description: 'Writes a line.', syntax: 'Console.WriteLine(value)', example: 'Console.WriteLine("hi");' },
  { name: 'Console.ReadLine', description: 'Reads a line.', syntax: 'Console.ReadLine()', example: 'var s = Console.ReadLine();' },
  { name: 'Math.Max', description: 'The larger of two.', syntax: 'Math.Max(a, b)', example: 'Math.Max(1, 2);' },
] }] }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
async function otterBackend(url, init) {
  if ((init?.method ?? 'GET') !== 'GET') return json({ ok: true })
  const routes = {
    '/api/software': [COURSE],
    '/api/software/csharp': COURSE,
    '/api/software/csharp/subjects': [{ id: SUBJECT.id, slug: SUBJECT.slug, title: SUBJECT.title, description: '', skill_level: 'beginner', is_stub: false, subject_order: 1 }],
    '/api/software/csharp/subjects/loops': SUBJECT,
    '/api/software/csharp/progress': { subjects: {} },
    '/api/software/csharp/hotkeys': { categories: [] },
    '/api/software/csharp/functions': FUNCTIONS,
    '/api/software/csharp/nodes': { systems: [] },
    '/api/software/csharp/references': { urls: [] },
    '/api/otter/subject-shares': [],
    '/api/otter/change-requests': [],
    '/api/otter/nominations': [],
  }
  return url in routes ? json(routes[url]) : json({ error: 'Not found' }, 404)
}
vi.mock('./tools/otter_v0.3.1/adapters', () => ({
  otterFetch: (...args) => otterBackend(...args),
  otterCloudActive: () => Promise.resolve(false),
  getOtterAdapterMode: () => 'auto',
  setOtterAdapterMode: () => 'auto',
  subscribeOtterAdapterMode: () => () => {},
}))
vi.mock('./tools/otter_v0.3.1/Validator', () => ({ default: () => null }))
vi.mock('./tools/otter_v0.3.1/petKnowledge', () => ({ retrieveOtterKnowledge: async () => ({ block: '' }), clearPetKnowledgeCache: () => {} }))
vi.mock('@monaco-editor/react', () => ({ default: () => null }))
const MEMBERS = { members: [], loading: false, error: null }
vi.mock('./components/TeamMembers/useWorkspaceMembers', async (importOriginal) => ({ ...(await importOriginal()), useWorkspaceMembers: () => MEMBERS }))

const { buildDevFixtures } = await import('./dev/fixtures/install')
const { PROJECT_ID } = await import('./dev/fixtures/data/project')
world.projectId = PROJECT_ID
const { default: App } = await import('./App.jsx')
const { _resetOverlaysForTests } = await import('./ui/overlay')

const NOW = new Date('2026-11-13T10:00:00.000Z')
const PET = {
  name: 'Biscuit', gender: 'female', breed: 'otter', form: 'adult', state: 'content',
  hunger: 80, happiness: 80, difficulty: 'medium', petMode: true, eggPetCount: 5, eggHatchThreshold: 5,
  bornAt: '2026-10-01T10:00:00.000Z', evolvedAt: '2026-10-02T10:00:00.000Z',
  sleepingSince: null, lastSleptAt: NOW.toISOString(), lastFedAt: null, lastPettedAt: null,
  lastUpdatedAt: NOW.toISOString(), interactionCount: 0, diedAt: null, feedback: [], totalThumbsUp: 0, totalThumbsDown: 0,
}
const PEOPLE = [{ user_id: 'u-2', label: 'Mara Lind' }, { user_id: 'u-3', label: 'Ines Okoro' }]
const TOOLS = ['DeckOutlineGenerator', 'Otter']

const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
async function runFor(ms) {
  let done = false
  setTimeout(() => { done = true }, ms)
  while (!done) await act(async () => { await vi.advanceTimersToNextTimerAsync() })
}
async function goTo(page) {
  await act(async () => {
    window.history.pushState({ page }, '', page === 'home' ? '/' : `/${page}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await tick(2200)
}
const type = async (el, text) => {
  for (let i = 1; i <= text.length; i++) await act(async () => { fireEvent.change(el, { target: { value: text.slice(0, i) } }) })
}

/** The app up, the project open and two people on it, O.T.T.E.R. on its Functions reference with a lesson read. */
async function openApp() {
  world.pet = { ...PET }
  const fx = buildDevFixtures()
  const adapter = fx.rabbitAdapter()
  adapter.subscribeProjectChanges = (_id, _onEvent, opts = {}) => { world.live.project = opts; return () => {} }
  adapter.subscribeWorkspaceChanges = () => () => {}
  world.adapter = adapter
  const view = render(<App />)
  await tick(100)
  await act(async () => { world.live.project?.onStatus('SUBSCRIBED'); world.live.project?.onPresence(PEOPLE) })
  await tick(500)
  await goTo('otter')
  await act(async () => { fireEvent.click(document.querySelector('.otter-course-open')) })
  await tick(100)
  await act(async () => { fireEvent.click(document.querySelector('.otter-subject-open')) })
  await tick(100)
  return view
}

const sprite = (view) => view.container.querySelector('.pet-slide-in, .pet-slide-out')
const petField = () => document.querySelector('input[placeholder^="Ask Biscuit"]')
const dogField = () => document.querySelector('textarea.dog-context-prompt')
const otterField = () => document.querySelector('input[placeholder="Search functions..."]')
const heartbeat = () => act(async () => { world.live.project.onPresence(PEOPLE.map((p) => ({ ...p }))) })

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  vi.stubEnv('VITE_DEV_AUTOLOGIN', 'tester')
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const realError = console.error
  vi.spyOn(console, 'error').mockImplementation((...args) => { if (!String(args[0]).includes('two children with the same key')) realError(...args) })
  window.history.replaceState(null, '', '/')
  Element.prototype.scrollIntoView = () => {}
  localStorage.clear()
  world.saves.length = 0
  world.live.project = null
  world.ai = vi.fn(() => new Promise(() => {}))
})
afterEach(() => {
  cleanup(); _resetOverlaysForTests()
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks()
  renderSpy.reset()
})

describe('the app as mounted here', () => {
  it('holds the real D.O.G. and the real O.T.T.E.R. with a lesson read, the project open, and the pet', async () => {
    const view = await openApp()
    expect(dogField()).not.toBeNull()
    expect(view.container.querySelector('.otter-lesson-title')?.textContent).toBe('The for loop')
    expect(view.container.querySelector('.lesson-content')?.textContent).toContain('A loop repeats.')
    expect(sprite(view)).not.toBeNull()
    expect(world.live.project).not.toBeNull()
  })
})

describe('the two tool roots are left alone', () => {
  it('by a minute of the pet', async () => {
    await openApp()
    const mark = renderSpy.mark()
    await runFor(60_000)
    expect(renderSpy.renders('PetCompanion', mark)).toBe(13)       // the pet did live its minute (3 s to 63 s of its clocks)
    expect(renderSpy.which(TOOLS, mark)).toEqual([])
  })

  it('by ten characters typed to the pet', async () => {
    const view = await openApp()
    await act(async () => { fireEvent.click(sprite(view)) })
    const mark = renderSpy.mark()
    await type(petField(), 'lighthouse')
    expect(renderSpy.renders('PetCompanion', mark)).toBe(10)
    expect(renderSpy.which(TOOLS, mark)).toEqual([])
  })

})

describe('a field being typed in keeps its focus and its words', () => {
  it('D.O.G.\'s deck context box: across the pet\'s ticks, the pet typed to, and a heartbeat', async () => {
    const view = await openApp()
    await goTo('dog')
    const box = dogField()
    box.focus()
    await type(box, 'A watch la')
    await runFor(35_000)                              // a decay tick, a dream, on the way
    await heartbeat()
    await act(async () => { fireEvent.click(sprite(view)) })
    await type(petField(), 'hello')                   // typed to with a change event: focus is not asked for
    await act(async () => { fireEvent.click(sprite(view)) })
    expect(dogField()).toBe(box)
    expect(document.activeElement).toBe(box)
    expect(box.value).toBe('A watch la')
    await type(box, 'A watch launch')
    expect(document.activeElement).toBe(box)
    expect(dogField().value).toBe('A watch launch')
  })

  it('O.T.T.E.R.\'s functions search: across its own keystrokes, the pet\'s ticks and a heartbeat', async () => {
    const view = await openApp()
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Functions/ })) })
    await tick(100)
    const field = otterField()
    expect(field).not.toBeNull()
    expect(view.container.textContent).toContain('Console.ReadLine')
    field.focus()
    for (const typed of ['M', 'Ma', 'Mat', 'Math']) {
      await act(async () => { fireEvent.change(otterField(), { target: { value: typed } }) })
      expect(otterField(), typed).toBe(field)         // the same element after each letter
      expect(document.activeElement, typed).toBe(field)
    }
    expect(view.container.textContent).toContain('Math.Max')
    expect(view.container.textContent).not.toContain('Console.ReadLine')
    await runFor(35_000)
    await heartbeat()
    expect(otterField()).toBe(field)
    expect(document.activeElement).toBe(field)
    expect(field.value).toBe('Math')
  })

  it('the pet\'s own field: across its ticks and a heartbeat', async () => {
    const view = await openApp()
    await act(async () => { fireEvent.click(sprite(view)) })
    const field = petField()
    field.focus()
    await type(field, 'half a tho')
    await runFor(35_000)
    await heartbeat()
    expect(petField()).toBe(field)
    expect(document.activeElement).toBe(field)
    expect(field.value).toBe('half a tho')
  })
})
