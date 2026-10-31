// =============================================================================
// offlineLaunchWiring.test.js — S2 (night 3, 2026-10-27; docs/design/
// RECONNECT_DESIGN.md §11). The offline launch's wiring, read from source,
// where a render would need the whole app: App.jsx (the restore option, the
// refusal's sign-out, the reads that run again on the confirmation — the MFA
// enrolment gate first — and the pet's retry), the operator console (which
// must NOT hold), and the screens with no render harness of their own
// (O.T.T.E.R., R.A.B.B.I.T.'s summary, menu and Intake gate, D.O.G.'s card 1,
// Settings' Supabase card, the connection dot). The screens that have a
// render test carry their case there (ProjectListPanel, the Dashboard's
// tasks and notes); the mechanisms have their own (connectionWatchdog,
// supabaseClient, usePermissions, sessionTimeouts, petLifecycle).
// Each slice is located by an identifier and asserted found, never by line.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = (p) => readFileSync(resolve(here, '..', p), 'utf8').replace(/\r\n/g, '\n')
const app = src('App.jsx')
const operator = src('admin/OperatorApp.jsx')
const otter = src('tools/otter_v0.3.1/Otter.jsx')
const summary = src('tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx')
const menu = src('tools/rabbit_v0.1.0/components/ProjectContextBar.jsx')
const intake = src('tools/rabbit_v0.1.0/views/IntakeWizardView.jsx')
const dog = src('tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx')
const storage = src('components/settings/StorageConnections.jsx')
const dot = src('tools/rabbit_v0.1.0/components/ConnectionDot.jsx')

/** The text from `start` to the first `end` after it; throws when either is missing. */
function between(text, start, end, max = 20000) {
  const from = text.indexOf(start)
  const to = from < 0 ? -1 : text.indexOf(end, from + start.length)
  if (from < 0 || to < 0) throw new Error(`offlineLaunchWiring: could not locate ${JSON.stringify(start)} … ${JSON.stringify(end)}`)
  const slice = text.slice(from, to + end.length)
  if (slice.length > max) throw new Error(`offlineLaunchWiring: the slice from ${JSON.stringify(start)} is ${slice.length} chars`)
  return slice
}

describe('the restore: the app surface holds, the operator console never does (round 1, F1)', () => {
  it('App\'s start-up check passes holdOffline, inside the unchanged 15 s bound', () => {
    const fn = between(app, 'async function checkSessionValid()', 'const EASE =')
    expect(fn).toContain("withTimeout(hydrateSupabase(saved, { holdOffline: true }), AUTH_TIMEOUT_MS, 'session restore')")
  })
  it('the operator console restores as before: no holdOffline anywhere in it', () => {
    expect(operator).toContain('await hydrateSupabase(stored)')
    expect(operator).not.toContain('holdOffline')
  })
})

describe('a refusal on the way back ends the session with its one line, and no auth_events row', () => {
  it('App listens and signs out with event null and the notice', () => {
    const effect = between(app, 'useEffect(() => onHeldSessionRefused(', '}), [signOutLocal]);')
    // build review round 1, F6: the store is the client module's to clear (compare-and-clear), never the sign-out's
    expect(effect).toContain('signOutLocal({ event: null, notice: HELD_REFUSED_NOTICE, keepStore: true });')
    expect(app).toContain('if (!keepStore) await clearSession();')
    expect(app).toContain("setSignedOutNotice(notice ?? (expiry ? describeSessionExpiry(expiry) : ''));")
  })
})

describe('a sign-out of a HELD session: no rows, no AI-files release, no SDK sign-out (build review round 2, F1, F4)', () => {
  const fn = between(app, 'const signOutLocal = useCallback(async', 'setSessionId(null);')
  it('the client module says whether the session it ended was held', () => {
    expect(fn).toContain('const endedHeld = endSessionLocally();')
  })
  it('no auth_events row and no WIL-1002 report: the SDK holds no session, so there is no token to write with', () => {
    expect(fn).toContain('if (event && !endedHeld) writes.push(recordAuthEvent(event));')
    expect(fn).toContain('if (expiry && !endedHeld) {')
  })
  it('no AI-files release, and no SDK sign-out queued behind its lock (it would run on whatever session the SDK holds by then)', () => {
    expect(fn).toContain("if (!endedHeld) writes.push(withTimeout(releaseAllAIFiles({ keepalive: true }), 4000, 'AI files')")
    expect(fn).toMatch(/if \(!endedHeld\) \{\s*try \{\s*await withTimeout\(supabase\.auth\.signOut\(\{ scope: 'local' \}\), AUTH_EVENT_TIMEOUT_MS, 'sign-out'\);/)
    expect(fn.split('supabase.auth.signOut(').length - 1).toBe(1)   // the one SDK sign-out is the gated one
  })
})

describe('the reads that run once per sign-in run again on the confirmation (§11.9)', () => {
  it('🚨 the MFA enrolment gate (security): keyed on perms.offline as well', () => {
    const effect = between(app, 'const { data, error } = await supabase.auth.mfa.listFactors();', ']);')
    expect(effect).toContain('}, [authed, perms.ready, perms.role, perms.isPlatformOperator, perms.offline]);')
  })
  it('the new-user welcome and the model tiers', () => {
    expect(between(app, '/* non-fatal; user can still use the app without onboarding */', ']);')).toContain('}, [authed, perms.offline]);')
    expect(between(app, '/* cached tiers stand; never block generation on this */', ']);')).toContain('}, [authed, perms.offline]);')
  })
  it('build review round 2, note iii: the model tiers are not read while held — the legacy migration would mark itself done with nothing moved', () => {
    const effect = between(app, '// Session 20: fill the three model override tiers', '/* cached tiers stand; never block generation on this */')
    expect(effect).toContain('if (!authed || perms.offline) return;')
  })
  it('the desktop\'s workspace storage root, with the storage-choice cache cleared ahead of it, and the pet\'s course index', () => {
    expect(between(app, 'clearWorkspaceStorageCache();', ']);')).toContain('}, [perms.ready, perms.workspaceId, perms.offline]);')
    expect(between(app, "console.warn('workspace storage root not refreshed:'", ']);')).toContain('}, [perms.ready, perms.workspaceId, perms.offline]);')
    expect(between(app, 'clearPetKnowledgeCache();', ']);')).toContain('}, [perms.ready, perms.userId, perms.workspaceId, perms.offline]);')
  })
})

describe('the pet at an offline launch, and its retry (§11.10)', () => {
  const effect = between(app, 'const { pet, adopted } = await resolveUserPet(userId);', '}, [perms.ready, perms.userId, petSyncRetry]);')
  it('a failure arms the bounded retry, nothing while held', () => {
    expect(effect).toContain('const heldOffline = permsOfflineRef.current;')
    expect(effect).toContain('petSyncRetryRef.current.failed({ held: heldOffline });')
  })
  it('no error line and no toast while held; once confirmed, the toast once', () => {
    const catchBlock = effect.slice(effect.indexOf('} catch (err) {'))
    expect(catchBlock).toMatch(/if \(!heldOffline\) \{\s*const message = err\?\.message/)
    expect(catchBlock).toContain('if (!petSyncToastRef.current) {')
  })
  it('a success stops the retry and takes the toast down', () => {
    expect(effect).toContain('petSyncRetryRef.current.succeeded();')
    expect(effect).toContain("setPetNotice(n => (n && n.kind === 'error' ? null : n));")
  })
  it('the triggers: the window coming online, a family recovering, the confirmation', () => {
    expect(app).toContain("window.addEventListener('online', onOnline);")
    expect(app).toContain('connectionWatchdog.onRecovered(() => retry.trigger());')
    expect(app).toContain('if (wasOfflineRef.current && !perms.offline) petSyncRetryRef.current.trigger();')
  })
})

describe('O.T.T.E.R. (§11.8, §11.9)', () => {
  it('on the desktop, this computer\'s library with its source notice saying why', () => {
    // build review round 1, F7: a "This computer" pin keeps its own notice and is never reset by the confirmation
    expect(otter).toContain("if (perms.offline && libraryMode !== 'local' && !cloudMode && !!perms.workspaceId) {")
    expect(otter).toContain("const libraryKey = perms.offline && libraryMode !== 'local' ? `${libraryMode}:held` : libraryMode;")
    expect(otter).toContain('This is the library on this computer: your company library could not be reached, and appears when the connection returns.')
  })
  it('the empty list holds the one sentence, with nothing to create from; the sidebar too', () => {
    expect(otter).toContain(") : sorted.length === 0 && perms.offline ? (")
    expect(otter).toContain("<EmptyState icon={CloudOff} title={offlineSentence('courses')} />")
    expect(otter).toContain("? <EmptyState icon={CloudOff} title={offlineSentence('courses')} compact />")
  })
  it('no New course and no sidebar New while held; Import only where this computer\'s library takes it', () => {
    expect(otter).toContain('{(!perms.offline || hasLocalLibrary) && (')
    expect(otter.split('{!perms.offline && (').length - 1).toBeGreaterThanOrEqual(2)
  })
})

describe('R.A.B.B.I.T. and D.O.G.: the sentence on the cloud adapter only (the desktop\'s Local Server works offline)', () => {
  it('the summary with no project open: the sentence, no count, no New project', () => {
    const branch = between(summary, "if (!project && perms.offline && ctx?.adapterMode === 'supabase') {", '\n  }\n')
    expect(branch).toContain("<Empty>{offlineSentence('projects')}</Empty>")
    expect(branch).not.toContain('New project')
    expect(branch).not.toContain('allProjects.length')
  })
  it('the project menu and the Intake gate', () => {
    expect(menu).toContain("const heldOffline = useHeldOffline() && ctx?.adapterMode === 'supabase'")
    expect(menu).toContain("{heldOffline ? offlineSentence('projects') : 'No projects yet.'}")
    expect(intake).toContain('if (heldOffline) return <NoProjectGate offline />')
    expect(intake).toContain('{!offline && <Button variant="primary" Icon={Plus} onClick={onNewProject}>New project</Button>}')
  })
  it('D.O.G.\'s card 1: no New project, the sentence under the select', () => {
    expect(dog).toContain("const projectsHeldOffline = useHeldOffline() && rabbitCtx?.adapterMode === 'supabase';")
    const card = between(dog, 'id="dog-project"', "{offlineSentence('projects')}")
    expect(card).toContain('{!projectsHeldOffline && (')
  })
})

describe('Settings and the dot say what is true while held', () => {
  it('the Supabase card: no green dot, "not reachable right now"', () => {
    expect(storage).toContain('connected={!!perms.workspaceId && !perms.offline}')
    expect(storage).toContain("{perms.offline ? ' · not reachable right now' : null}")
  })
  it('the dot probes with the held token, so it never says "not signed in" while a session is held', () => {
    expect(dot).toContain('token: () => tokenRef.current.token ?? heldSession()?.access_token ?? null,')
  })
})

// D1 (night 4, 2026-10-28; docs/design/RECONNECT_DESIGN.md §12.2): the cap at
// a restore. The token's own sign-in time is passed on the restore paths only
// (App's start-up check, the console's boot), never at a fresh sign-in, where
// it would add nothing but the clock's skew (design review, F4). No harness
// renders either surface; the hook itself is pinned in sessionDialogs.test.js.
describe('D1: the token\'s sign-in time reaches the cap at a restore, never at a fresh sign-in', () => {
  it('App: the start-up check sets it, handleAuth clears it, the sign-out clears it, the hook is given it', () => {
    const restore = between(app, 'checkSessionValid().then(session => {', 'setSessionChecked(true);')
    expect(restore).toContain('setSessionId(sessionIdOf(session));\n        setSessionSignedInAt(tokenSignedInAt(session));')
    const fresh = between(app, 'const handleAuth = useCallback((session) => {', "recordAuthEvent('sign_in');")
    expect(fresh).toContain('setSessionId(sessionIdOf(session));\n    setSessionSignedInAt(null);')
    expect(between(app, 'setSessionId(null);', 'setSessionSignedInAt(null);', 60)).toBeTruthy()
    expect(between(app, 'const sessionTimeouts = useSessionTimeouts({', '});')).toContain('signedInAt: sessionSignedInAt,')
  })
  it('the operator console: its boot sets it from the restored session, its sign-in and sign-out clear it, the hook is given it', () => {
    const boot = between(operator, 'const live = stored ? await hydrateSupabase(stored) : null', 'setBooted(true)')
    expect(boot).toContain('setSessionSignedInAt(tokenSignedInAt(live))\n          setSession(live)')
    expect(between(operator, 'const handleSignedIn = useCallback(async (next) => {', 'setSession(next)')).toContain('setSessionSignedInAt(null)')
    expect(between(operator, 'setSession(null)', 'setSessionSignedInAt(null)', 60)).toBeTruthy()
    expect(between(operator, 'const sessionTimeouts = useSessionTimeouts({', '})')).toContain('signedInAt: sessionSignedInAt,')
  })
  it('the token\'s time is read once on each surface, at its restore, so no fresh sign-in path borrows it', () => {
    expect(app.split('tokenSignedInAt(').length - 1).toBe(1)
    expect(operator.split('tokenSignedInAt(').length - 1).toBe(1)
  })
})
