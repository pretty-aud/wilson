import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { Menu } from 'lucide-react'
import TitleBar from './components/TitleBar'
import DevFixturesBadge from './dev/DevFixturesBadge'
import { PageHeader, IconButton, ToastProvider, Button } from './ui'
// T3: the close-confirmation dialog below is the one surface in this file
// still written entirely as inline style objects. Its type now reads the
// scale from here rather than restating 16px / 13px / 12px by hand.
import {
  TYPE, LEADING, WEIGHT, PAPER, INK_2, SIGNAL, BACKDROP,
  RADIUS_FLOAT, SHADOW_FLOAT, DIALOG, DANGER,
} from './ui/tokens'
import LoginScreen from './cloud/auth/LoginScreen'
import ForgotPasswordWizard from './cloud/auth/ForgotPasswordWizard'
import ResetPasswordWizard from './cloud/auth/ResetPasswordWizard'
import { looksLikeRecoveryLink } from './cloud/auth/recoveryLink'
import NewUserWelcome from './cloud/onboarding/NewUserWelcome'
import { loadSession, clearSession } from './cloud/auth/sessionStorage'
import { hydrateSupabase, supabase } from './cloud/auth/supabaseClient'
import { fetchWorkspaceStorage, clearWorkspaceStorageCache } from './cloud/workspaceStorage'
import { callAI, isRetryableAIError } from './cloud/aiProxy'
import { textFromMessage } from './cloud/anthropicStream'
import { modelFor } from './lib/activeModel'
import { loadModelSources, migrateLegacyUserModelPrefs } from './lib/modelSources'
import { loadPet, savePetData, clearPetCache, loadOtterSettings, saveOtterSettings } from './lib/localData'
import { canCreateNewEgg, mintEggFrom,
         DECAY_RATES, EVOLVE_TIMES, SLEEP_DURATIONS, CORPSE_TO_GHOST_MS,
         derivePetState, applyOfflineDecay } from './lib/petLifecycle'
import { createCoalescingSave } from './lib/coalescingSave'
import { installCompanionShiftHotkey } from './lib/companionHotkey'
import { PAGES, PAGE_BARS, PAGE_TITLES, getPage, navPages } from './layout/pages'
import { resolveUserPet, saveCloudPet, mirrorPetToCache, fetchCloudPet, isStalePetWrite,
         resolveUserSettings, mirrorSettingsToCache, setUserStateOwner,
         getUserStateOwner } from './lib/userState'
import PetNotice from './components/PetNotice'
import Home from './components/Home'
import SettingsPage from './components/SettingsPage'
import Projects from './components/Projects'
import RateCardPage from './components/RateCard'
import TeamMembersPage from './components/TeamMembers/TeamMembersPage'
import ProjectFilesExplorer from './components/Resources/ProjectFilesExplorer'
import DashboardPage from './components/Dashboard/DashboardPage'
import AdminTerminalPage from './components/AdminTerminal/AdminTerminalPage'
import HelpPage from './components/HelpPage'
import UpdatePrompt from './components/UpdatePrompt'
import ModelWarningBanner from './components/ModelWarningBanner'
import { MfaEnrollGate } from './cloud/auth/MfaSection'
import { updatesSupported, checkForUpdates, onUpdateStatus, getSkippedVersion } from './cloud/updates'
import { usePermissions } from './permissions'
import DeckOutlineGenerator from './tools/deck-outline-generator_v0.514'
import Otter from './tools/otter_v0.3.1'
import Rabbit from './tools/rabbit_v0.1.0'
import PetCompanion from './components/PetCompanion'
import { PET_BREEDS, pickRandomBreed } from './components/sprites/index'
import {
  COMPANION_PROMPT
} from './tools/otter_v0.3.1/prompts.js'
import { AgentProvider, useAgent } from './agent'
import { otterFetch, subscribeOtterAdapterMode } from './tools/otter_v0.3.1/adapters'
import { retrieveOtterKnowledge, clearPetKnowledgeCache } from './tools/otter_v0.3.1/petKnowledge'
import { withTimeout } from './cloud/auth/withTimeout'
// The line above is pinned VERBATIM by src/tools/otter_v0.3.1/petKnowledgeWiring.test.js
// (a tree this sprint does not edit), so the boot ceiling's constant rides its own import.
import { AUTH_TIMEOUT_MS } from './cloud/auth/withTimeout'
// B2 part 2 (Track B): the session block's own pieces — the auth_events
// emitter, the idle/cap timeouts, their notice, the connection-lost banner
// and the WIL-1002 reporter.
import { recordAuthEvent, AUTH_EVENT_TIMEOUT_MS } from './cloud/auth/authEvents'
import { useSessionTimeouts, sessionIdOf, EXPIRE_REASONS } from './cloud/auth/sessionTimeouts'
import SessionWarning, { describeSessionExpiry } from './cloud/auth/SessionWarning'
import ConnectionLostBanner from './cloud/ConnectionLostBanner'
import { reportAppEvent } from './cloud/errorCodes'
import { RabbitProvider } from './tools/rabbit_v0.1.0/state/RabbitProvider'
// Post-overhaul S3c, step 7 (D12): an unsaved edit asks before every exit.
import { hasUnsavedWork, confirmLeave, unsavedForClose } from './tools/rabbit_v0.1.0/state/leaveGuard'
// S3c review round 1 (R1-11): the close question takes the keyboard as a dialog does.
import { pushModal, isTopModal, focusableWithin } from './ui/overlay'
import LeaveEditDialog from './tools/rabbit_v0.1.0/views/scenes/LeaveEditDialog'
import UndoToast from './tools/rabbit_v0.1.0/components/UndoToast'

// Wrapper that bridges AgentProvider context to SettingsPage
function SettingsPageWithAgent(props) {
  const agent = useAgent()
  if (!agent) return <SettingsPage {...props} />
  return (
    <SettingsPage
      {...props}
      agentEnabled={agent.agentEnabled}
      onAgentEnabledChange={agent.setAgentEnabled}
      autoApprove={agent.autoApprove}
      onAutoApproveChange={agent.setAutoApprove}
      lockedSubjects={agent.lockedSubjects}
      onLockedSubjectsChange={agent.setLockedSubjects}
      agentSystemPrompt={agent.agentSystemPrompt}
      onAgentSystemPromptChange={agent.setAgentSystemPrompt}
    />
  )
}

// Wrapper that bridges AgentProvider context to PetCompanion props
function PetCompanionWithAgent(props) {
  const agent = useAgent()
  if (!agent) return <PetCompanion {...props} />
  const onOtterPage = props.currentPage === 'otter'
  return (
    <PetCompanion
      {...props}
      agentEnabled={onOtterPage && agent.agentEnabled}
      agentMode={onOtterPage && agent.agentMode}
      onAgentModeToggle={agent.setAgentMode}
      agentMessages={agent.agentMessages}
      agentInput={agent.agentInput}
      onAgentInputChange={agent.handleAgentInputChange}
      onSendAgent={agent.sendAgentMessage}
      onClearAgent={() => agent.setAgentMessages([])}
      agentLoading={agent.agentLoading}
      canUndo={agent.undoStack?.length > 0}
      onUndo={agent.undoLastEdit}
    />
  )
}

// PAGE_TITLES, PAGE_BARS, the nav columns and the header's chrome all derive
// from ONE registry now — `src/layout/pages.js`. This table was the first of
// the three hand-maintained lists a new page had to be added to, and the one
// the Files page WAS added to while missing the bar table (review F32 / F-R04).

const COMPRESSED = { top: 'calc(50vh - 20px)', bottom: 'calc(50vh - 20px)' };

// One page wrapper for all twelve pages (F2). The scroll class and the focus
// / caret / selection scope both come from the registry's `surface`, so the
// scroll classes stop doing double duty as the surface scope (F1 hand-off §7)
// and a page cannot be dark in one and light in the other.
//
// 🚨 Module level, NOT inside App. A component declared inside a render is a
// new type on every render, so React unmounts and remounts its subtree — and
// the entire reason every page is rendered at once is to PRESERVE that state.
function PageSurface({ id, currentPage, overflow = 'auto', children }) {
  const page = getPage(id);
  return (
    <div
      className={page.surface === 'dark' ? 'wilson-dark-scroll' : 'wilson-light-scroll'}
      data-surface={page.surface}
      style={{ display: currentPage === id ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow }}
    >
      {children}
    </div>
  );
}

// Phase 6: the ceiling on reading the courses for one chat message. Generous
// enough that a cold index build over a real library finishes (it is bounded-
// concurrency, so a dozen courses is a few waves), short enough that a stalled
// auth-js lock costs the pet a beat rather than the whole reply.
const KNOWLEDGE_TIMEOUT_MS = 8000;

// ── URL ↔ page sync (Session 12, locked #18) ────────────────────────────────
// On the web the app lives under /wilson and every page gets a path
// (/wilson/dog, /wilson/otter, …) via the history API. This is history sync
// over the existing `currentPage` state — the all-pages-rendered shell stays;
// there is no router. Electron keeps base './' and loads the local Express
// root, so routing is off there (nothing to deep-link). `npm run dev` serves
// at base '/', so the same paths work without the /wilson prefix.
const URL_ROUTING_ENABLED =
  typeof window !== 'undefined' &&
  !window.electronAPI &&
  import.meta.env.BASE_URL.startsWith('/');

// '/wilson' on the web build, '' in vite dev.
const URL_BASE = URL_ROUTING_ENABLED
  ? import.meta.env.BASE_URL.replace(/\/+$/, '')
  : '';

function pageFromLocation() {
  if (!URL_ROUTING_ENABLED) return 'home';
  let path = window.location.pathname;
  if (URL_BASE && path.startsWith(URL_BASE)) path = path.slice(URL_BASE.length);
  const seg = path.replace(/^\/+|\/+$/g, '');
  return Object.prototype.hasOwnProperty.call(PAGE_TITLES, seg) ? seg : 'home';
}

function urlForPage(page) {
  return page === 'home' ? (URL_BASE || '/') : `${URL_BASE}/${page}`;
}

// Hydrate a persisted Supabase session (safeStorage in Electron, localStorage in
// `vite dev`). Returns the live session if hydration succeeded, null otherwise.
async function checkSessionValid() {
  try {
    const saved = await loadSession();
    if (!saved) return null;
    // Demo sprint (2026-09-10): BOUNDED. hydrateSupabase → setSession refreshes
    // an expired token over the network with no ceiling of its own, and NOTHING
    // renders until this returns (`showOverlay && sessionChecked` gates the
    // sign-in screen, `authed` the shell): Audrey's all-orange window on
    // 2026-09-10 was a 2026-09-07 session and a stalled refresh. The same
    // ceiling as every await in LoginScreen; a timeout is "no session", so the
    // sign-in screen appears within it. The request is left to settle
    // (withTimeout races, never aborts) — a late success is harmless.
    const session = await withTimeout(hydrateSupabase(saved), AUTH_TIMEOUT_MS, 'session restore');
    return session ?? null;
  } catch (err) {
    console.warn('[wilson] session restore skipped:', err?.message ?? err);
    return null;
  }
}

/**
 * The user id inside the STORED session, read without touching supabase-js.
 *
 * 🚨 A3. The pet cache is keyed by account, and the cache read has to happen
 * BEFORE usePermissions resolves — that early render is the whole reason the
 * mount effect exists. Nothing else knows the identity that early: `authed` is
 * a boolean, and asking supabase.auth would contend on auth-js's global
 * per-storageKey lock, which one hung call can pin for the whole app (see
 * docs/OUTSTANDING.md, "One hung getSession()").
 *
 * The access token is a JWT whose `sub` is the user id. Decoding the payload is
 * NOT verification and is not treated as any: nothing is authorised on the
 * strength of it. It picks a cache key, and a wrong one reads a cache that does
 * not exist. The same decode, for the same reason, is in WorkspaceSwitcher.
 *
 * Returns null on anything unexpected, which routes the read to the historical
 * unattributed store — the signed-out behaviour.
 */
async function storedSessionUserId() {
  try {
    const saved = await loadSession();
    const token = saved?.access_token;
    if (typeof token !== 'string') return null;
    const payload = token.split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claims?.sub === 'string' ? claims.sub : null;
  } catch { return null; }
}

const EASE = 'cubic-bezier(0.4,0,0.2,1)';

// The page-transition rhythm: fade out → compress → hold the title → expand →
// fade in. 2100ms end to end.
//
// ONE definition, because Session 43 added a second consumer: the post-sign-in
// WELCOME transition replays this exact chain (Audrey, 2026-08-10 — "have it
// work like the transition animation from page to page"). Two copies of these
// numbers is how "it works like the app" quietly stops being true.
const TRANSITION = {
  fadeOut:  250,
  compress: 600,
  hold:     400,
  expand:   600,
  fadeIn:   250,
};

// ═══════════════════════════════════════════════════════════════════
//  PET CONSTANTS AND THE COLD-START RULES — now in src/lib/petLifecycle.js
// ═══════════════════════════════════════════════════════════════════
//
// 🚨 A3 (2026-09-07): DECAY_RATES, EVOLVE_TIMES, SLEEP_DURATIONS,
// CORPSE_TO_GHOST_MS, derivePetState and applyOfflineDecay MOVED OUT, and the
// move is the point rather than tidiness.
//
// They were module-level functions in a 2000-line component file, so the only
// instrument that could reach them was a regex over this file's source — the
// kind of pin the A2 session found wrong three times in one sitting.
// A3 changes three of applyOfflineDecay's rules at once (the corpse that never
// became a ghost, Pet Mode while the app is closed, and sleep and evolution
// offline); changing them somewhere they could only be pinned by
// string-matching was not defensible. petLifecycle.test.js drives the real
// functions instead.
//
// The LIVE 30-second tick below is still a separate, impure algorithm and stays
// here. The two are kept in step by sharing the tables and CORPSE_TO_GHOST_MS,
// not by being one function.

/**
 * How much of a rated exchange is KEPT in the pet's feedback array.
 *
 * Not a display limit — nothing displays these strings. The one consumer
 * (sendChat's RECENT FEEDBACK block) slices both fields to 60 characters, so
 * this is eight times what is ever read, and it is what keeps a fifty-entry
 * array an order of magnitude below user_pets' 262,144-byte CHECK. See the note
 * at handleThumbRating for the measurement.
 */
const FEEDBACK_SNIPPET_CHARS = 500;

/**
 * The fields whose change MUST reach storage. Everything else is either
 * recomputable from the anchor (hunger, happiness, state) or already saved by
 * the handler that changed it (name, difficulty, petMode, feedback, counts).
 *
 * This is what replaced the 30-second whole-object auto-save: the four
 * transitions a timer used to be needed for — falling asleep, waking, evolving,
 * dying — persist when they happen and at no other time.
 *
 * ⚠️ Stays in this file: it is persistence wiring rather than a lifecycle rule,
 * and it is only ever used beside petPersistedSigRef three lines away.
 */
function petMaterialSignature(pet) {
  if (!pet) return null;
  return [pet.form, pet.sleepingSince || '', pet.evolvedAt || '', pet.diedAt || ''].join('|');
}

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  // B2 part 2: the session's identity (the JWT's session_id) keys the 4-hour
  // cap clock so a reload keeps it; the notice is the one line the login
  // screen shows after a timed-out session says why it ended.
  const [sessionId, setSessionId] = useState(null);
  const [signedOutNotice, setSignedOutNotice] = useState('');
  const [sessionChecked, setSessionChecked] = useState(false);
  // 'login' (default) | 'forgot-password' | 'recovery'
  //
  // Session 43: 'new-company' is gone. Company creation is a PLATFORM
  // OPERATOR action and is not shipped to this surface at all — Audrey,
  // 2026-08-10: "this is for the platform operator only. this is not to be
  // seen in the actual wilson app." The operator console (admin.html →
  // src/admin/CompaniesSection.jsx) owns it, and vite.config.js builds the
  // two surfaces from separate entries, so the code is ABSENT here rather
  // than hidden behind a role check.
  // 'recovery' is the landing mode when a user clicks the reset link in the
  // recovery email — the URL fragment carries access_token+refresh_token and
  // ResetPasswordWizard installs that session, prompts for a new password,
  // then signs the user out and returns them to 'login'.
  const [authMode, setAuthMode] = useState(() => {
    if (typeof window === 'undefined') return 'login'
    // Session 18: three link shapes now land here — the token_hash link the
    // templates send, and the two older implicit-grant fragments. The matcher
    // lives in recoveryLink.js with the parser, and is deliberately loose: a
    // spent or malformed link must still reach the wizard so the user gets an
    // explanation instead of a login screen that ignores what they clicked.
    if (looksLikeRecoveryLink(window.location.hash, window.location.search)) {
      return 'recovery'
    }
    return 'login'
  });
  // Set to a membership record when the signed-in user still has
  // onboarded_at = null; cleared once NewUserWelcome saves the profile.
  const [pendingOnboarding, setPendingOnboarding] = useState(null);
  // Session 9 gates layered after onboarding: admins must enroll MFA
  // (locked #9); a fresh release offers Update / Skip at sign-in.
  const [pendingMfaEnroll, setPendingMfaEnroll] = useState(false);
  const [updateOffer, setUpdateOffer] = useState(null);
  const perms = usePermissions();
  // Deep links initialize the page from the URL on the web; Electron always
  // boots on home (URL_ROUTING_ENABLED false → pageFromLocation() = 'home').
  const [currentPage, setCurrentPage] = useState(() => pageFromLocation());

  // Transition: 'idle' -> 'compressing'(600ms) -> 'title-hold'(400ms) -> [swap] -> 'expanding'(600ms) -> 'idle'
  const [transitionState, setTransitionState] = useState('idle');
  const [transitionTitle, setTransitionTitle] = useState('');
  const transitionRef = useRef(false);

  // Nav menu state (for DOG hamburger)
  const [showNavMenu, setShowNavMenu] = useState(false);
  // Nav strip resources sub-column state
  const [navResourcesOpen, setNavResourcesOpen] = useState(false);
  // Which nav item is hovered or focused, as "column:label". Both nav columns
  // read it through navOpacity() below — see the note there for why the hover
  // could not stay a Tailwind class.
  const [navHovered, setNavHovered] = useState(null);

  // Pet visibility state — hides sprite during page transitions
  const [petVisible, setPetVisible] = useState(true);

  // O.T.T.E.R. context — passed up from Otter component for agent awareness
  const [otterContext, setOtterContext] = useState(null);

  // Session 12 (locked #21): all AI calls ride the ai-proxy Edge Function —
  // no per-user Anthropic key exists anymore, on either host. Purge the
  // credential earlier versions left on disk (both slots, including the
  // pre-WILSON legacy one) so an upgrade doesn't leave a key behind.
  useEffect(() => {
    try {
      localStorage.removeItem('wilson-api-key');
      localStorage.removeItem('deck-outline-generator-api-key');
    } catch { /* storage disabled */ }
  }, []);

  // Check persisted Supabase session on mount. `session` carries the JWT that
  // RLS uses to gate every request; losing it means logged-out state.
  useEffect(() => {
    // Dev tester mode — Audrey, 2026-09-11 (UI overhaul F1): "no just bypass
    // password entry." 🚨 DEV BUILDS ONLY: `import.meta.env.DEV` is a
    // compile-time constant, so `vite build` (the installer, the beta,
    // Vercel) drops this branch; there is no runtime switch. With
    // VITE_DEV_AUTOLOGIN=tester in .env.local the sign-in screen is skipped
    // with NO credentials and NO session: usePermissions stays empty (no
    // role, no workspace) and every RLS-gated query returns nothing, so the
    // chrome, the fonts and the kit are reviewable while the tables are
    // empty. The credentialed variant (VITE_DEV_AUTOLOGIN=1 + a test
    // account) lives in LoginScreen.jsx and gives a real session.
    if (import.meta.env.DEV && import.meta.env.VITE_DEV_AUTOLOGIN === 'tester') {
      console.warn('[wilson] DEV tester mode: sign-in skipped, no session, no workspace (VITE_DEV_AUTOLOGIN=tester; dev builds only)');
      setAuthed(true);
      setShowOverlay(false);
      setSessionChecked(true);
      return;
    }
    checkSessionValid().then(session => {
      if (session) {
        setAuthed(true);
        // A resumed session is not a sign-in: no auth_events row here, but the
        // cap clock must find its original start under this same session id.
        setSessionId(sessionIdOf(session));
        // Session 17: a recovery / invite link must NOT be swallowed by an
        // existing session. The overlay is what mounts ResetPasswordWizard
        // (`showOverlay && sessionChecked && authMode === 'recovery'`), so
        // hiding it here meant that anyone already signed in — which is every
        // admin testing an invite in their own browser — had the link parsed,
        // the mode set to 'recovery', and then silently discarded. No wizard,
        // no error, no clue. The token belongs to a DIFFERENT person than the
        // one signed in, so the overlay has to win.
        //
        // authMode is read from the URL hash in its useState initializer, so
        // it is already correct on this first pass despite the [] deps.
        if (authMode !== 'recovery') setShowOverlay(false);
      }
      setSessionChecked(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Invoked by <LoginScreen/> on successful signInWithPassword. The session
  // has already been persisted by LoginScreen via sessionStorage.saveSession,
  // so we only need to flip the gate here.
  const handleAuth = useCallback((session) => {
    signingOutRef.current = null;   // a new session may be signed out again
    setSessionId(sessionIdOf(session));
    setSignedOutNotice('');
    setAuthed(true);
    // B2 part 2: the client's own sign_in row — the one WITH the address and
    // the company (the password hook's row carries neither). Fire-and-forget:
    // it never gates the sign-in and it reports its own failure to the console.
    recordAuthEvent('sign_in');
  }, []);

  // Whenever the user is authenticated, check their workspace_members row for
  // the active workspace. If onboarded_at is null, surface NewUserWelcome so
  // they can fill in display_name/pronouns/title/avatar before entering the app.
  useEffect(() => {
    if (!authed) { setPendingOnboarding(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const userId = session.user?.id;
        // JWT app_metadata.workspace_id is set by custom_access_token_hook.
        const workspaceId = session.user?.app_metadata?.workspace_id ?? null;
        if (!userId || !workspaceId) return;

        const { data, error } = await supabase
          .from('workspace_members')
          .select('workspace_id, user_id, display_name, onboarded_at')
          .eq('user_id',      userId)
          .eq('workspace_id', workspaceId)
          .maybeSingle();
        if (cancelled || error || !data) return;
        if (data.onboarded_at == null) {
          setPendingOnboarding({
            workspace_id: data.workspace_id,
            user_id:      data.user_id,
            display_name: data.display_name ?? '',
          });
        }
      } catch { /* non-fatal; user can still use the app without onboarding */ }
    })();
    return () => { cancelled = true; };
  }, [authed]);

  // Session 20: fill the three model override tiers from Supabase once there is
  // a session, and move any S19 localStorage preferences into the user tier.
  //
  // main.jsx has already applied the cached tiers synchronously, so this is a
  // refresh rather than the first fill — which matters because resolution is
  // synchronous and a generation fired before this resolves would otherwise
  // fall through to the built-in floor and say nothing about it.
  //
  // Deliberately non-fatal: if these reads fail the app keeps the cached tiers
  // and keeps generating. A catalogue outage must not become an AI outage.
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    (async () => {
      try {
        await migrateLegacyUserModelPrefs();
        if (cancelled) return;
        await loadModelSources();
      } catch { /* cached tiers stand; never block generation on this */ }
    })();
    return () => { cancelled = true; };
  }, [authed]);

  // Session 9 (locked #9): admin tiers without a verified TOTP factor get
  // the enrollment gate. Role comes from usePermissions (JWT-decoded) — the
  // getSession() user record only carries what was persisted to
  // raw_app_meta_data, and app_role never is (review finding). Enrolled
  // users are already challenged at sign-in by LoginScreen regardless.
  useEffect(() => {
    if (!authed || !perms.ready) { if (!authed) setPendingMfaEnroll(false); return; }
    const adminTier = perms.role === 'admin' || perms.isPlatformOperator;
    if (!adminTier) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (cancelled || error) return;
        const verified = (data?.totp ?? []).some(f => f.status === 'verified');
        if (!verified) setPendingMfaEnroll(true);
      } catch { /* gate is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [authed, perms.ready, perms.role, perms.isPlatformOperator]);

  // Session 9: version check at sign-in (locked #10). The updater pushes
  // 'available' after our check; skipped versions stay quiet until the next
  // release. Settings > General owns the manual path.
  useEffect(() => {
    if (!authed) { setUpdateOffer(null); return; }
    if (!updatesSupported()) return undefined;
    let cancelled = false;
    const unsub = onUpdateStatus((s) => {
      if (cancelled) return;
      if (s.state === 'available') {
        const v = s.info?.version ?? null;
        if (v && v !== getSkippedVersion()) setUpdateOffer({ version: v });
      }
    });
    checkForUpdates();
    return () => { cancelled = true; unsub(); };
  }, [authed]);

  // Sign out: clear the local session + reset auth state. Wired to the Settings
  // panel in S31; MfaEnrollGate's "Sign out instead" was the only caller before.
  //
  // 🚨 S31: `{ scope: 'local' }` IS NOT COSMETIC. This call had no scope
  // argument, which means a GLOBAL revoke of every refresh token the person
  // holds. The operator console deliberately passes scope:'local' for the
  // opposite reason (OperatorApp.jsx), and Audrey is both a platform operator
  // and a workspace admin who runs two accounts in two browsers at once — so
  // an unscoped sign-out here would silently drop her operator console at its
  // next token refresh, minutes later, with nothing on screen connecting the
  // two. Ending THIS surface's session is what the button promises.
  //
  // ResetPasswordWizard signs out GLOBALLY on purpose (B1, Audrey's answer
  // 12): a new password revokes every session, the console's included, and
  // its `scope: 'global'` is explicit. The two calls differ by decision.
  //
  // B2 part 2 (Track B): one exit for every way a session ends on this
  // surface. `event` names the auth_events row written BEFORE the token is
  // revoked (after it there is no JWT to write with): 'sign_out' for the
  // button (the default, so the existing callers are unchanged), 'idle_timeout'
  // or 'session_cap' from useSessionTimeouts, null for no row. An expiry also
  // emits WIL-1002 — declared in errorCodes.js since S9 and wired by nothing
  // until now (TPN-LOG-005) — and sets the one-line reason the login screen
  // shows. Both writes are bounded and best-effort and run side by side, so
  // leaving never waits more than one ceiling on a dead network.
  //
  // R2: ONE sign-out at a time, and the persisted session goes FIRST. The
  // timeouts and the Settings button can both fire in the window the log
  // writes take, which wrote two rows and clobbered the reason; `signingOut`
  // makes the second caller await the first. And `clearSession()` runs
  // before any network call, because `supabase.auth.signOut()` awaits
  // `getSession()` internally and can hang forever on the silent-network
  // failure this bundle's banner exists for — leaving the encrypted session
  // on disk. The in-memory JWT still serves the two log writes.
  const signingOutRef = useRef(null);
  const signOutLocal = useCallback(async ({ event = 'sign_out' } = {}) => {
    if (signingOutRef.current) return signingOutRef.current;
    const run = (async () => {
      // 🚨 A3: THE CACHED PET LEAVES WITH THE PERSON.
      //
      // `clearSession()` clears the auth blob and nothing else. The per-device
      // pet cache survived on purpose — SessionSection says so — on the grounds
      // that the React state leak was closed. But resolveUserPet READ that
      // uncleaned copy to decide whether to adopt it, so on a shared computer
      // person A's pet could be lifted into person B's account. A3 keys the
      // cache by account; this is the other half, and both are needed: the key
      // stops it being adopted by anyone else, this stops it lying around.
      //
      // Captured BEFORE the teardown below nulls the ref. Best effort by
      // construction — clearPetCache never throws — because a cache that will
      // not cooperate must not trap somebody in a session they asked to leave.
      const leavingUserId = petUserIdRef.current || bootOwnerRef.current;
      bootOwnerRef.current = null;
      const expiry = EXPIRE_REASONS.includes(event) ? event : null;
      setSignedOutNotice(expiry ? describeSessionExpiry(expiry) : '');
      await clearSession();
      // The cache goes right behind the session: a local write (or a loopback
      // DELETE on the desktop), never a cloud call, so it sits ahead of the
      // bounded log writes rather than behind a revoke that may hang.
      if (leavingUserId) await clearPetCache(leavingUserId);
      const writes = [];
      if (event) writes.push(recordAuthEvent(event));
      if (expiry) {
        writes.push(withTimeout(reportAppEvent({
          code: 'WIL-1002', eventType: 'auth', severity: 'info',
          context: { reason: expiry, surface: 'app' },
        }), 4000, 'WIL-1002').catch(() => { /* best-effort */ }));
      }
      if (writes.length) await Promise.all(writes);
      try {
        await withTimeout(supabase.auth.signOut({ scope: 'local' }), AUTH_EVENT_TIMEOUT_MS, 'sign-out');
      } catch { /* a hung revoke must not strand the person on a signed-in screen */ }
      setSessionId(null);
      // 🚨 Belt and braces with the perms.userId teardown effect: this runs
      // even if the permissions channel is slow to notice, so the next person
      // at this computer cannot see the previous person's pet for a beat.
      setPetData(null);
      petUserIdRef.current = null;
      petPersistedSigRef.current = null;
      // Phase 3: the two error channels were left set across sign-out, so the
      // next person at this computer inherited "Ollie isn't being saved" from
      // somebody else's session.
      setPetSaveError(null);
      setNewPetStatus(null);
      // R1 of A3: and the notice, which is a third channel with the same
      // defect the two lines above exist to fix. An error notice never
      // auto-dismisses, so person A's "could not be synced from your account"
      // sat on person B's screen until B clicked the X.
      setPetNotice(null);
      setPetNoticeSticky(null);
      setAuthed(false);
      setShowOverlay(true);
      // Arm the welcome again — signing back in during the same session is a
      // new arrival, and a once-per-page-load ref would silently skip it.
      welcomePlayedRef.current = false;
    })();
    signingOutRef.current = run;
    // Released on the next sign-in (handleAuth), not here: everything after
    // this point is signed out, and a second call in that state should be
    // the no-op the guard makes it.
    return run;
  }, []);
  useEffect(() => {
    window.wilsonSignOut = signOutLocal;
    return () => { delete window.wilsonSignOut; };
  }, [signOutLocal]);

  // B2 part 2: the idle warning at 25 minutes, sign-out at 30, and the
  // absolute 4-hour cap — sessionTimeouts.js carries the numbers and the
  // reasoning. Keyed on the session id so a reload keeps the cap clock; web
  // and Electron alike; its clocks live under this surface's own storage key
  // so the operator console's tab can neither keep this one alive nor end it.
  const sessionTimeouts = useSessionTimeouts({
    enabled: authed,
    sessionId,
    onExpire: (reason) => { signOutLocal({ event: reason }); },
  });

  const handleAnimationComplete = () => {
    setShowOverlay(false);
  };

  // Session 43: the welcome transition is QUEUED at sign-in and played once
  // the post-login gates have cleared. Playing it immediately would run it
  // underneath NewUserWelcome or MfaEnrollGate — both are full-screen
  // AuthShell overlays — so the one person who would never see it is the
  // brand-new user it is meant to greet.
  //
  // ⚠️ pendingOnboarding resolves from an async query keyed on `authed`, so on
  // a first login it can still be null at this point and flip a moment later.
  // The welcome may then start under the overlay that follows. Cosmetic, and
  // only on the very first sign-in of a new account; noted rather than fixed
  // with a spurious settle delay.
  const [welcomeQueued, setWelcomeQueued] = useState(false);
  const welcomePlayedRef = useRef(false);

  // Close confirmation dialog (Electron only)
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  // Post-overhaul S3c, step 7 (D12): an unsaved edit is folded INTO this one
  // question — never a second dialog before or after it. The guards that can
  // be answered from here (state/leaveGuard.js) are read when it opens: their
  // words, and Keep editing / Discard and close / Save edit and close.
  const [closeUnsaved, setCloseUnsaved] = useState([]);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState(null);

  useEffect(() => {
    if (!window.electronAPI?.onCloseRequested) return;
    const cleanup = window.electronAPI.onCloseRequested(() => {
      setCloseUnsaved(unsavedForClose());
      setCloseError(null);
      setShowCloseDialog(true);
    });
    return cleanup;
  }, []);
  const closeNow = () => { setShowCloseDialog(false); window.electronAPI?.forceClose(); };
  // S3c review round 1 (R1-11): C1 is lifted for the post-overhaul sessions,
  // and D12 says Escape = Keep editing. While the question is up it is on the
  // kit's overlay stack (a kit Dialog under it stops answering Escape and
  // Tab; the pet's Shift stands down), Escape is its first answer (Keep
  // editing, or Cancel), and Tab stays inside it — bound only while it is
  // shown, and only while it is the top layer.
  const closeDialogRef = useRef(null);
  const closeBusyRef = useRef(false);
  closeBusyRef.current = closeBusy;
  useEffect(() => {
    if (!showCloseDialog) return undefined;
    const id = {};
    const unregister = pushModal(id);
    const onKey = (e) => {
      if (!isTopModal(id)) return;
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (!closeBusyRef.current) setShowCloseDialog(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusableWithin(closeDialogRef.current);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey ? i <= 0 : (i === -1 || i === items.length - 1)) {
        e.preventDefault();
        (e.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); unregister(); };
  }, [showCloseDialog]);
  // How many unsaved edits the question is about ("it" or "them").
  const closeCount = closeUnsaved.reduce((n, g) => n + (typeof g.count === 'function' ? g.count() : 1), 0);
  const closeAfter = async (how) => {
    setCloseBusy(true);
    setCloseError(null);
    try {
      for (const g of closeUnsaved) await (how === 'save' ? g.save() : g.discard());
      setCloseBusy(false);
      closeNow();
    } catch (err) {
      setCloseBusy(false);
      setCloseError(err?.message || String(err));
    }
  };
  // In a browser (no desktop close question), an unsaved edit asks through
  // the browser's own leave prompt. Never in the desktop app: there the close
  // question above asks, and a second prompt would follow it.
  useEffect(() => {
    if (window.electronAPI) return;
    const onBeforeUnload = (e) => {
      if (!hasUnsavedWork('close')) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Zoom state — track current zoom level so visualizer can counter-scale
  const [zoomLevel, setZoomLevel] = useState(0);

  useEffect(() => {
    if (!window.electronAPI?.zoomIn) return;
    const handler = (e) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      // Ctrl+= or Ctrl+Shift+= (the "+" key on most keyboards)
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        window.electronAPI.zoomIn().then(level => { if (level != null) setZoomLevel(level); });
      }
      // Ctrl+- (zoom out)
      if (e.key === '-') {
        e.preventDefault();
        window.electronAPI.zoomOut().then(level => { if (level != null) setZoomLevel(level); });
      }
      // Ctrl+0 (reset zoom)
      if (e.key === '0') {
        e.preventDefault();
        window.electronAPI.zoomReset().then(level => { if (level != null) setZoomLevel(level); });
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Listen for zoom reset from main process (triggered by Ctrl+R / F5 refresh override)
  useEffect(() => {
    if (!window.electronAPI?.onZoomReset) return;
    const cleanup = window.electronAPI.onZoomReset((level) => {
      setZoomLevel(level ?? 0);
    });
    return cleanup;
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  //  PET STATE — lifted from O.T.T.E.R. to be app-wide
  // ═══════════════════════════════════════════════════════════════════
  const [petData, setPetData] = useState(null);
  // S30: refs, not state. `petSaving` was only ever the in-flight guard, and
  // having it in savePet's dependency list changed savePet's identity on every
  // save — which tore down and rebuilt the 30-second save interval each time.
  // (Phase 3: petSavingRef / petPendingRef are gone — the in-flight guard and
  // the newest-wins queue they implemented now live in lib/coalescingSave.js,
  // where they can be tested. The semantics S30 established are unchanged.)
  const [petSaveError, setPetSaveError] = useState(null);
  // ── A3: A SURFACE THAT DOES NOT DEPEND ON THE PET RENDERING ──────────────
  //
  // 🚨 The two conditions that most need saying are exactly the two the app
  // could not say:
  //
  //   * "Your pet changed on another device — refreshed", after migration
  //     0068 refuses this window's stale copy. The existing save banner lives
  //     inside PetCompanion's CHAT POPUP, which is closed on every page change
  //     and only renders once the pet has hatched.
  //   * A failed pet LOAD. `petSaveError` has been representable since S31 and
  //     INVISIBLE ever since, because when the load fails `petData` stays null
  //     and App renders no companion at all — so the only renderer of the error
  //     is unmounted by the error.
  //
  // <PetNotice> is mounted at the very bottom of the tree, inside the kit's
  // <ToastProvider> whose pinned row is <UndoToast>, outside every
  // `{petData && …}` gate.
  // null | { kind: 'info' | 'error', message }
  const [petNotice, setPetNotice] = useState(null);
  // 🚨 R1 OF A3: TWO LIFETIMES, NOT ONE STATE RENDERED TWICE.
  //
  // The first version passed `petNotice` to BOTH the toast and Settings' pet
  // card, and the comment on the Settings prop claimed "the toast goes away,
  // this does not". It was false: dismissing the toast — by its X or by its
  // ten-second timer — called setPetNotice(null) and removed the Settings copy
  // at the same instant, so the durable surface the brief asked for did not
  // exist. This one is cleared only by a sign-out or by a later successful
  // save, so somebody who was looking elsewhere can still find out what
  // happened.
  const [petNoticeSticky, setPetNoticeSticky] = useState(null);

  // Say it in both places at once. Stable identity: it goes into savePet's
  // closure and must not change performPetSave's identity.
  const announcePetNotice = useCallback((notice) => {
    setPetNotice(notice);
    setPetNoticeSticky(notice);
  }, []);

  // 🚨 R1 OF A3: STABLE, and the reason is measured. PetNotice's dismissal
  // timer lists onDismiss in its dependency array; App passing a fresh arrow
  // restarted that timer on EVERY App render, and with a live pet the
  // dream-cloud effect re-renders App every 3s then 8–15s — so the documented
  // ten-second dismissal only landed when a gap happened to exceed ten
  // seconds. The comment in PetNotice claiming it is "keyed on the message,
  // not the object" was true of the message and untrue of the handler.
  const dismissPetNotice = useCallback(() => setPetNotice(null), []);
  // S31: who the pet belongs to, in a ref so savePet's identity stays stable.
  // null when signed out, which is what routes a save to the per-device cache.
  const petUserIdRef = useRef(null);
  // 🚨 R2 OF A3: WHO THE STORED SESSION SAYS THIS IS, KNOWN BEFORE PERMISSIONS
  // RESOLVE.
  //
  // `setUserStateOwner` is only called inside the identity effect, behind
  // `if (!perms.ready) return`, and perms.ready waits on
  // supabase.auth.getSession() — the call this repo already records as able to
  // hang the whole app. Meanwhile `authed` is set independently by
  // checkSessionValid(), so the pet renders and can be clicked. In that window
  // both petUserIdRef and getUserStateOwner() are null, so a Feed or a Pet
  // Mode click took the signed-out branch, wrote the UNATTRIBUTED store and
  // reported success — the exact defect R1's finding 4 was meant to close,
  // surviving in the window it did not cover.
  //
  // The mount effect already computes this identity to pick a cache key; it is
  // kept so the save path can ask "do I KNOW I am signed out?" rather than
  // "is the owner installed yet?". Cleared wherever the session ends.
  const bootOwnerRef = useRef(null);
  // S31: the last material signature actually written. Primed by both load
  // paths so that LOADING a pet never counts as a change to persist.
  const petPersistedSigRef = useRef(null);
  const petTimerRef = useRef(null);
  // (S31: petSaveTimerRef is gone with the 30-second auto-save it armed.)

  // ── Phase 3: the Create Egg action, reported on the page that hosts it ─────
  //
  // 🚨 A SEPARATE CHANNEL FROM petSaveError, DELIBERATELY. `petSaveError`
  // multiplexes four unrelated conditions — load failure, sync failure, save
  // failure and egg failure — and is cleared by ANY later successful save. Had
  // Settings simply rendered it, toggling Pet Mode would have wiped the egg's
  // error, and a transient sync blip would have printed "Ollie isn't being
  // saved" on Settings for the next person to sign in at that computer.
  //
  // This one belongs to one button, says whether it WORKED as well as whether
  // it failed, and is cleared when that button is pressed again.
  // null | { ok: true, message } | { ok: false, message }
  const [newPetStatus, setNewPetStatus] = useState(null);
  const [newPetPending, setNewPetPending] = useState(false);
  // 🚨 THE GUARD IS THE REF, NOT THE STATE. `newPetPending` is only for
  // RENDERING. A second click dispatched before React re-renders reads the same
  // stale `false` from the closure, so guarding on the state value is guarding
  // on nothing — the same reason `disabled={newPetPending}` on the button was
  // dead code and was removed.
  const newPetPendingRef = useRef(false);
  // Bumped by handleNewPet. The sign-in effect's async pet read captures this
  // and refuses to install a result that was issued BEFORE the egg was made —
  // otherwise a slow resolveUserPet() landing after the click overwrites the
  // fresh egg with the dead pet it had already fetched.
  const petEpochRef = useRef(0);

  // Companion state
  const [companionOpen, setCompanionOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const chatInputRef = useRef('');
  const handleChatInputChange = useCallback((val) => {
    chatInputRef.current = val;
    setChatInput(val);
  }, []);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatThinking, setChatThinking] = useState(false);
  const [feedbackJustRated, setFeedbackJustRated] = useState(false);
  const [thumbFlash, setThumbFlash] = useState(null);
  const [flashFeed, setFlashFeed] = useState(false);
  const [flashPet, setFlashPet] = useState(false);
  const [attentionJump, setAttentionJump] = useState(false);
  const [eggWobble, setEggWobble] = useState(false);
  const [sleepZCycle, setSleepZCycle] = useState(0);
  const [cloudVisible, setCloudVisible] = useState(false);
  const [showHatchModal, setShowHatchModal] = useState(false);
  const [hatchNameInput, setHatchNameInput] = useState('');

  // Save pet — local Express in Electron, localStorage on the web (localData).
  //
  // 🚨 S30: this was `catch { /* silent */ }` sitting on top of a savePetData
  // that could not fail — it never checked res.ok on the Express POST, and
  // writeLocal swallowed every localStorage exception. Three layers of silence
  // over one lost pet, and the catch could not fire even in principle. All
  // three are fixed; this is the one that has to SHOW it.
  //
  // The pet is the worst case for a silent save: the old state stays on screen
  // and looks completely right, so nothing distinguishes "saved" from "lost
  // until you next reload".
  // Returns TRUE when the write landed, FALSE when it was reported as failed.
  //
  // Phase 3: the return value exists because handleNewPet has to tell Audrey
  // whether her new egg was actually stored. It cannot infer that from
  // `petSaveError`, which is set asynchronously and is shared with three other
  // conditions. Existing callers ignore the result.
  //
  // 🚨 A COALESCED SAVE RESOLVES WITH THE RESULT OF THE WRITE THAT REPLACES IT,
  // NOT WITH `true`. The first version of this returned `true` the moment a
  // save was queued behind an in-flight one, so "A new egg is on its way" was
  // printed for a write that had not happened — and if the flush then failed,
  // the only report was petSaveError, which no Settings surface renders.
  //
  // It is reachable from one screen: "Reset History" sits beside "New Pet" in
  // the same Danger Zone and calls savePet, so pressing one and then the other
  // inside a single cloud round trip takes exactly this path.
  // ⚠️ The one-at-a-time / newest-wins QUEUE now lives in lib/coalescingSave.js,
  // because two hand-rolled versions of it in this file both reported a success
  // for a write that had not happened, and neither was visible to a test that
  // reads source text. This half is only the WRITE.
  //
  // 🚨 A3: THIS NO LONGER STAMPS A FRESH ANCHOR ON EVERY SAVE.
  //
  // It used to write `{ ...data, lastUpdatedAt: new Date().toISOString() }`, so
  // every write claimed its hunger and happiness were true AT THAT INSTANT —
  // even a Pet Mode toggle from a window that had been sitting on a week-old
  // copy. That made migration 0068's stale-write guard INERT: the stale
  // window's anchor was always the fresher one, so it always won.
  //
  // The rule now, and it is also what 0046 says the column means: the anchor
  // moves when, and only when, hunger or happiness moved. applyOfflineDecay
  // moves it on load if it decayed anything; the live tick moves it every tick;
  // feeding, petting a HATCHED pet, waking, hatching and a thumbs-up that adds
  // happiness each move it at the point they change the numbers. Everything
  // else — Pet Mode, difficulty, Reset History, a rename, a thumbs-down,
  // petting an egg that does not hatch — re-sends the anchor it is holding,
  // unchanged, and 0068 accepts an equal anchor.
  //
  // ⚠️ R2: THE ONE AMENDMENT, and it is a SECOND save rather than an exception
  // to this rule. Resuming Pet Mode restarts the decay clock, so the anchor
  // has to move — but a window that stamps `now` on a stale pet defeats 0068
  // by construction. handlePetModeToggle therefore saves the held anchor
  // first and stamps a fresh one only if that save LANDED. Every save that
  // reaches this function still obeys the sentence above.
  //
  // ⚠️ The fallback exists for a pet object that somehow has no anchor at all
  // (a hand-edited cache). Sending null would be rejected by toPetRow and the
  // save would fail for a reason nobody could read.
  const performPetSave = useCallback(async (data) => {
    try {
      const next = data.lastUpdatedAt
        ? data
        : { ...data, lastUpdatedAt: new Date().toISOString() };
      // 🚨 S31: the destination is "is there a signed-in user", NOT "is this
      // Electron". `hasLocalServer()` (window.electronAPI) is true for the
      // DESKTOP APP IN CLOUD MODE too, so branching on it would pin every
      // signed-in desktop user to the per-device file forever — the standing
      // rule, and the same predicate that empties the O.T.T.E.R. library.
      //
      // Read from a ref rather than a dependency so savePet keeps a stable
      // identity: it sits in the decay/auto-save effects' dependency lists, and
      // S30 moved petSaving to a ref for exactly this reason.
      const owner = petUserIdRef.current;
      if (owner) {
        await saveCloudPet(next);
        // The cache is a mirror, never the authority. It must not be able to
        // report failure for a cloud write that succeeded. A3: it is written
        // under the OWNER's key, so the next person at this computer cannot be
        // handed this pet.
        await mirrorPetToCache(next, owner);
      } else if (getUserStateOwner() || bootOwnerRef.current) {
        // 🚨 R1 OF A3: SIGNED IN, BUT THE PET'S ROUTING IS NOT ESTABLISHED.
        //
        // This is the failed-cloud-read state: the effect below deliberately
        // leaves petUserIdRef null so a blip cannot re-point writes at an
        // account. The first version then fell through to the local branch and
        // called savePetData(next, null) — writing the UNATTRIBUTED store,
        // which the account arm of loadPet never reads again — and returned
        // TRUE. The change was discarded on the next launch and reported as
        // saved, on a shared computer it was left for the next signed-out
        // launcher to see, and clearPetCache refuses by design to remove it.
        // It also contradicted the copy shipped in the same commit: "There is
        // no offline copy."
        //
        // Failing loudly is the honest answer, and it is what that copy
        // promises.
        // ⚠️ R2: THE COPY NAMES THE RELAUNCH, because nothing retries. The
        // identity effect is keyed [perms.ready, perms.userId], both
        // primitives, and usePermissions re-setStates on TOKEN_REFRESHED
        // without changing userId — so the effect never re-runs and
        // petUserIdRef is never installed for the life of the process. A
        // sentence promising "it will save once the connection comes back"
        // would be a promise the code does not keep. Filed in OUTSTANDING.
        throw new Error(
          'Your pet could not be reached in your account, so this change was not saved. Reopen WILSON to try again.');
      } else {
        await savePetData(next, owner);
      }
      setPetSaveError(null);
      // A later success clears the STICKY notice outright — R2: the
      // kind === 'error' condition meant an 'info' one ("refreshed") was
      // rendered on Settings, with no dismiss control, for the rest of the
      // session, through any number of later successful saves. The comment
      // that used to sit here said it lived out its own ten seconds, which is
      // true of the toast and was false of this state.
      setPetNoticeSticky(null);
      // The TOAST keeps the condition: an info toast has its own ten-second
      // timer and a dismiss button, and cutting it short on an unrelated save
      // would take the explanation off screen mid-sentence.
      setPetNotice(n => (n && n.kind === 'error' ? null : n));
      return true;
    } catch (err) {
      // ── A3: 0068's refusal is not a save failure ──────────────────────────
      //
      // 🚨 AND IT IS EXPLICITLY NOT RETRIED. Retrying would re-send the same
      // stale copy against a row that has moved on, which is the clobber the
      // guard exists to stop — with the extra insult that the second attempt
      // would look like a bug rather than a decision. Audrey's ruling 4: the
      // stale window gets a refresh notice.
      if (isStalePetWrite(err)) {
        setPetSaveError(null);
        announcePetNotice({
          kind: 'info',
          message: 'Your pet changed on another device — refreshed.',
        });
        try {
          const fresh = await fetchCloudPet();
          if (fresh) {
            const brought = applyOfflineDecay(fresh);
            // Prime, do not save: this is a LOAD, and the account already holds
            // the copy it is loading.
            petPersistedSigRef.current = petMaterialSignature(brought);
            setPetData(brought);
            const owner = petUserIdRef.current;
            if (owner) await mirrorPetToCache(brought, owner);
          }
        } catch {
          // The re-read is best effort. The notice has already told the user
          // their copy is stale, which is the part that matters; the next
          // launch reads the account again anyway.
        }
        return false;
      }
      setPetSaveError(err?.message || 'Your pet could not be saved.');
      return false;
    }
  }, []);

  // The queue is created ONCE and must stay that way — recreating it would
  // drop whatever is queued and lose the in-flight guard. It reaches the write
  // through a ref so that this stays true even if performPetSave ever gains a
  // dependency, and so savePet below can keep the stable identity the decay
  // effects' dependency lists rely on.
  const performPetSaveRef = useRef(performPetSave);
  performPetSaveRef.current = performPetSave;
  const petSaveQueueRef = useRef(null);
  if (petSaveQueueRef.current === null) {
    petSaveQueueRef.current = createCoalescingSave((data) => performPetSaveRef.current(data));
  }

  const savePet = useCallback(async (data) => {
    if (!data) return false;
    return petSaveQueueRef.current(data);
  }, []);

  // Load the CACHED pet on mount so the companion renders instantly. The
  // authoritative read is the sign-in effect below; this one is the cache.
  //
  // 🚨 S31 — TWO THINGS THIS DELIBERATELY NO LONGER DOES:
  //
  //   * It does not SAVE. It used to call savePet() unconditionally on every
  //     launch, so merely opening WILSON was a full-object write. Against a
  //     shared per-user row that made "open the app on the second computer" a
  //     clobbering event even if the user touched nothing — the precise thing
  //     Audrey asked to have fixed.
  //   * It does not stamp `lastUpdatedAt = now`. That line destroyed the decay
  //     anchor on every launch, which is also why `lastUpdatedAt` could never
  //     be used to order two devices' pets. The anchor now survives until a
  //     real interaction moves it, and applyOfflineDecay reads the difference.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // 🚨 A3: ATTRIBUTED. The cache is keyed by account now, so this read
        // has to know whose it is — and it runs BEFORE usePermissions resolves,
        // which is the whole reason this effect exists. The stored session is
        // the only identity available this early; its access token is a JWT
        // whose `sub` is the user id. No session means a signed-out or
        // local-only launch, which reads the historical unattributed store.
        //
        // ⚠️ loadPet(userId) returns NULL rather than minting when this account
        // has never been cached here. A first sign-in on a new computer must
        // not flash a blank egg before the account's real pet arrives.
        const owner = await storedSessionUserId();
        // R2: the save path consults this during the window before permissions
        // resolve. See bootOwnerRef.
        bootOwnerRef.current = owner;
        const stored = await loadPet(owner);
        if (!mounted || !stored) return;
        const fresh = applyOfflineDecay(stored);
        // Prime, do not save. An offline death computed here is idempotent —
        // the next load recomputes the same ghost from the same anchor — so
        // persisting it would put the write back into app startup.
        petPersistedSigRef.current = petMaterialSignature(fresh);
        setPetData(fresh);
      } catch (err) {
        // 🚨 S31: loadPet is the one localData function S30 left with neither a
        // res.ok check nor a reported catch, and this was `catch { /* silent */ }`.
        // A failed load renders as "the pet is gone" — petData stays null and the
        // whole companion is unmounted — rather than as an error, which is the
        // same class of silence S30 spent a session removing from the savers.
        if (mounted) setPetSaveError(err?.message || 'Your pet could not be loaded.');
      }
    })();
    return () => { mounted = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── S31: the pet follows the PERSON ───────────────────────────────────────
  //
  // 🚨 KEYED ON perms.userId, NOT ON `authed`. Three measured reasons:
  //
  //   1. The mount effect above runs BEFORE authentication resolves — it is
  //      declared later but wins the race, because checkSessionValid awaits an
  //      IPC round trip and then setSession, while the cached read resolves on
  //      the first microtask. A cloud read on the first pass has no session
  //      installed and RLS returns nothing.
  //   2. `authed` is a BOOLEAN. It does not change when the identity underneath
  //      it does, so an account switch is invisible to it — which is why
  //      WorkspaceSwitcher resorts to window.location.reload().
  //   3. usePermissions already re-derives userId on SIGNED_IN, SIGNED_OUT and
  //      TOKEN_REFRESHED by decoding the token, so keying on it needs no new
  //      onAuthStateChange subscriber — and therefore cannot deadlock on the
  //      auth-js navigator lock the way a naive async callback does.
  useEffect(() => {
    if (!perms.ready) return;
    const userId = perms.userId || null;
    // 🚨 A3: THE PET'S ROUTING IS NOT SET HERE ANY MORE — only CLEARED here.
    //
    // This used to be `petUserIdRef.current = userId`, unconditionally, BEFORE
    // the async read below. If resolveUserPet() then threw, the catch
    // deliberately kept rendering the stale device pet while savePet had
    // already been re-pointed at the account — so any interaction, or the decay
    // tick reaching death, wrote that stale pet over the account row with no
    // adoption decision and no staleness check. A transient Supabase blip on
    // the second computer was enough to overwrite the first computer's pet.
    //
    // The S34 storage-root effect, two blocks below, refuses to act on a failed
    // read for exactly this reason. This copies it: an identity CHANGE is a
    // real state change and clears the routing immediately (writes fall back to
    // this machine's cache, which is harmless), and only a read that SUCCEEDS
    // installs the new owner.
    if (petUserIdRef.current !== userId) {
      // 🚨 R1 OF A3: AND THE PET GOES WITH IT, on a REAL switch.
      //
      // petData is only blanked when userId is falsy, so an identity change
      // A → B with no intervening signed-out state left A's pet on screen
      // while the routing moved to B — and any interaction, or a decay tick
      // reaching sleep, evolution or death, would then write A's pet into B's
      // row. The account-scoped cache closes the ADOPTION route into another
      // account; this closes the write route.
      //
      // ⚠️ Only when the ref already held somebody. On a cold start it is null
      // and the mount effect has just rendered this person's cached pet —
      // blanking there would replace an instant render with a blank screen
      // until the cloud answers, which is the thing that effect exists to
      // prevent.
      const previousOwner = petUserIdRef.current;
      petUserIdRef.current = null;
      if (previousOwner) setPetData(null);
    }
    // The settings writers live in other components and must know too. They are
    // a different store with a different failure mode — a settings write that
    // lands in the wrong account is recoverable, a pet write is not — so this
    // one is still set up front.
    setUserStateOwner(userId);

    // ── Signed out: TEAR DOWN. ───────────────────────────────────────────────
    // 🚨 Without this, S31's own Sign out button would be a REGRESSION.
    // clearSession() only clears the auth blob; nothing has ever cleared the
    // pet. The previous person's pet stayed in React state, kept decaying, kept
    // auto-saving, and reappeared for whoever signed in next — on the web AND
    // on the desktop, where pet.json survives on disk. That leak has been
    // nearly unreachable only because the sole sign-out control is buried in
    // the MFA enrolment gate. Adding a reachable one without this teardown
    // would turn a latent leak into a routine one.
    if (!userId) { setPetData(null); bootOwnerRef.current = null; return; }

    let cancelled = false;
    // Phase 3: the read is stamped with the epoch it was ISSUED in. Creating a
    // new egg bumps the epoch, so a resolveUserPet() that was already in flight
    // cannot land afterwards and reinstate the pet Audrey just replaced —
    // `cancelled` does not cover this, because the effect is not torn down.
    const epoch = petEpochRef.current;
    (async () => {
      try {
        const { pet, adopted } = await resolveUserPet(userId);
        // The read landed AND produced a pet: from here on, saves belong to
        // this account. R1: gated on `pet` as well, so a resolve that somehow
        // yields nothing cannot re-point writes at an account whose pet is not
        // on screen.
        if (!cancelled && pet) petUserIdRef.current = userId;
        // 🚨 Phase 3: this NO LONGER `return`s when the epoch has moved. It
        // only skips INSTALLING the pet, then falls through to the settings
        // half below. Returning here meant that creating an egg while the
        // first pet read was still in flight abandoned resolveUserSettings and
        // mirrorSettingsToCache for the whole session — the effect is keyed
        // [perms.ready, perms.userId], so there is no second chance, and Otter's
        // prompt editor, the companion prompt and AgentProvider would silently
        // read this device's stale settings instead of her account's.
        const stillCurrent = !cancelled && pet && epoch === petEpochRef.current;
        if (stillCurrent) {
          const fresh = applyOfflineDecay(pet);
          petPersistedSigRef.current = petMaterialSignature(fresh);
          setPetData(fresh);
          setPetSaveError(null);
          // ⚠️ STAYS GATED ON `adopted`. Phase 3 briefly made this
          // unconditional to keep the device cache fresh, and that was a real
          // defect: applyOfflineDecay moves hunger/happiness but never
          // lastUpdatedAt, so mirroring `fresh` writes decayed values against
          // the ORIGINAL anchor and the next launch decays the same interval
          // again — the pet drifts dead-ward on every sign-in. The invariant
          // this file states at petMaterialSignature is that hunger/happiness
          // and lastUpdatedAt are only ever written TOGETHER, by savePet.
          if (adopted) await mirrorPetToCache(fresh, userId);
        }

        // The settings half. Filling the per-device cache from the account is
        // what makes every EXISTING reader — Otter's prompt editor, the pet's
        // companion prompt, AgentProvider's overrides — return this person's
        // settings on this computer, without rewriting any of them.
        const { settings } = await resolveUserSettings();
        if (cancelled || !settings) return;
        await mirrorSettingsToCache(settings);
      } catch (err) {
        // A failed cloud read must NOT blank the pet — the cached one is still
        // true, and this is the cache-plus-cloud rule modelSources established.
        // It must still SAY so, because "your pet stopped syncing" and "your pet
        // is fine" look identical on screen.
        if (!cancelled) {
          // 🚨 R2: FALL BACK TO THIS ACCOUNT'S OWN CACHE.
          //
          // The mount effect has `[]` deps, so on an identity switch it has
          // already run under the PREVIOUS identity — and the switch now
          // blanks petData deliberately. Without this, a failed read on a
          // switch left the new person with a blank Companion card even
          // though their own cached pet was sitting on the machine. The cache
          // is per-account, so this can only ever read their own.
          try {
            const cached = await loadPet(userId);
            if (!cancelled && cached) {
              const fresh = applyOfflineDecay(cached);
              petPersistedSigRef.current = petMaterialSignature(fresh);
              setPetData(fresh);
            }
          } catch { /* the cache is a cache; the message below is the point */ }
          const message = err?.message || 'Your pet could not be synced from your account.';
          setPetSaveError(message);
          // 🚨 A3: and SAY it somewhere that exists when the pet does not. When
          // this is a cold start the catch leaves petData null, so the
          // companion — the only renderer of petSaveError — is never mounted.
          announcePetNotice({ kind: 'error', message });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [perms.ready, perms.userId]);

  // ── S37: the storage-choice cache dies with the session ───────────────────
  // getWorkspaceStorageCached (the upload path's provider decision) holds one
  // module-level row. A sign-out or workspace switch must forget it on EVERY
  // build — including web, where the bridge effect below early-returns before
  // its own fetch would have overwritten it. Cleared first (declaration
  // order), so the fetch below re-warms it for the NEW session.
  useEffect(() => {
    if (!perms.ready) return;
    clearWorkspaceStorageCache();
  }, [perms.ready, perms.workspaceId]);

  // ── Phase 6: the pet's course index dies with the identity ────────────────
  // petKnowledge holds ONE module-level index of every course the caller may
  // read. It is keyed on nothing — so a sign-out, an account switch or a
  // workspace switch must forget it, or the next person's pet answers from the
  // previous person's library. Keyed on userId as WELL as workspaceId because
  // the index is per-PERSON: an admin and a member in one workspace get
  // different rows out of otter_course_index, and Audrey runs two accounts in
  // two browsers at once.
  useEffect(() => {
    if (!perms.ready) return;
    clearPetKnowledgeCache();
  }, [perms.ready, perms.userId, perms.workspaceId]);

  // ── A4: the library switch moves the pet's index too ──────────────────────
  // O.T.T.E.R.'s Settings → Library control flips the adapter between the
  // company library and this computer's. The index above is keyed on the
  // IDENTITY, which does not change when the switch is flipped — so without
  // this the pet would keep answering out of the library the person just
  // switched away from, warm for INDEX_TTL_MS (five minutes) with nothing on
  // screen to say so. Phase 6's retrieval reads through the same `otterFetch`
  // seam, so the CONTENT follows the switch by itself; only the cache does not.
  //
  // Subscribed rather than keyed on a state value because the mode lives in a
  // module variable in the adapters, not in React state: an effect dependency
  // could not see it move.
  useEffect(() => subscribeOtterAdapterMode(() => clearPetKnowledgeCache()), []);

  // ── S34: the workspace storage root reaches the main process ──────────────
  // main.cjs has no Supabase client, so the byos root (workspace_storage,
  // migration 0048) is pushed over IPC here — the ONE call site that makes a
  // NAS root configured in the Admin Terminal actually resolve on this
  // desktop. Keyed on workspaceId (a workspace switch re-derives the claim,
  // same reasoning as the pet effect above). Signed out, the push is NULL —
  // that is a real state change and the machine default is then correct. A
  // FAILED read pushes nothing at all: a transient Supabase blip must not
  // retarget a machine that already holds the workspace root onto its local
  // default — the split-storage failure the design calls worse than a
  // visible one — and a fresh launch that lands in the catch simply keeps
  // its pre-sign-in behaviour (S34 review; last-known-good wins).
  // A changed root reaches other machines on their next launch / sign-in;
  // there is no live re-broadcast (stated limit, S34).
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI?.rabbit : null;
    if (!bridge?.setWorkspaceRoot) return;
    if (!perms.ready) return;
    let cancelled = false;
    if (!perms.workspaceId) {
      bridge.setWorkspaceRoot({ rootPath: null }).catch(() => {});
      return;
    }
    (async () => {
      try {
        const row = await fetchWorkspaceStorage();
        if (cancelled) return;
        const isByos = row?.mode === 'byos';
        await bridge.setWorkspaceRoot({
          rootPath: isByos ? (row.root_path || null) : null,
          rootKind: isByos ? (row.root_kind || null) : null,
        });
      } catch (err) {
        console.warn('workspace storage root not refreshed:', err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, [perms.ready, perms.workspaceId]);

  // Decay timer — runs every 30 seconds
  useEffect(() => {
    if (!petData) return;
    petTimerRef.current = setInterval(() => {
      setPetData(prev => {
        if (!prev) return prev;
        if (prev.form === 'egg' || prev.form === 'corpse' || prev.form === 'ghost') return prev;
        // R1 of A3: `=== false`, not falsy, so this genuinely mirrors
        // applyOfflineDecay. They disagreed for `petMode: undefined` — frozen
        // while the app was open, decaying while it was closed — and the
        // commit claimed they were the same. Unreachable today (fromPetRow
        // always yields a boolean and defaultPet sets true); made true anyway,
        // because the claim is what the next reader will rely on.
        if (prev.petMode === false) return prev;

        const next = { ...prev };
        const rates = DECAY_RATES[next.difficulty] || DECAY_RATES.medium;
        const babyMult = next.form === 'baby' ? 2 : 1;
        const perTick = 0.5; // 30s = 0.5 min

        // Sleep check: has sleep ended?
        if (next.sleepingSince) {
          const sleepDur = SLEEP_DURATIONS[next.difficulty] || SLEEP_DURATIONS.medium;
          if (Date.now() - new Date(next.sleepingSince).getTime() >= sleepDur) {
            next.sleepingSince = null;
            next.lastSleptAt = new Date().toISOString();
            next.interactionCount = 0;
          } else {
            next.state = derivePetState(next);
            next.lastUpdatedAt = new Date().toISOString();
            return next;
          }
        }

        // Should pet fall asleep?
        const timeSinceLastSleep = next.lastSleptAt ? (Date.now() - new Date(next.lastSleptAt).getTime()) / 60000 : 999;
        if ((next.interactionCount >= 15 || timeSinceLastSleep >= 30) && !next.sleepingSince && next.lastSleptAt !== null) {
          next.sleepingSince = new Date().toISOString();
          next.state = derivePetState(next);
          next.lastUpdatedAt = new Date().toISOString();
          return next;
        }

        // Apply decay
        next.hunger = Math.max(0, next.hunger - rates.hunger * babyMult * perTick);
        next.happiness = Math.max(0, next.happiness - rates.happiness * babyMult * perTick);

        // Death check
        if (next.hunger <= 0) {
          next.form = 'corpse';
          next.state = 'dead';
          next.diedAt = new Date().toISOString();
          next.hunger = 0;
          setTimeout(() => {
            setPetData(p => {
              if (!p || p.form !== 'corpse') return p;
              const ghost = { ...p, form: 'ghost' };
              ghost.state = derivePetState(ghost);
              savePet(ghost);
              return ghost;
            });
            // 🚨 A3: SAME CONSTANT AS THE LOAD PATH. This timeout is the ONLY
            // thing that used to promote a corpse, and closing the app inside
            // it stranded the pet as a corpse forever. petLifecycle's
            // applyOfflineDecay now finishes the transition on load, and both
            // read CORPSE_TO_GHOST_MS so the window cannot drift.
          }, CORPSE_TO_GHOST_MS);
        }

        // Baby evolution check
        if (next.form === 'baby' && next.bornAt) {
          const evolveTime = EVOLVE_TIMES[next.difficulty] || EVOLVE_TIMES.medium;
          if (Date.now() - new Date(next.bornAt).getTime() >= evolveTime) {
            next.form = 'adult';
            next.evolvedAt = new Date().toISOString();
          }
        }

        next.state = derivePetState(next);
        next.lastUpdatedAt = new Date().toISOString();
        return next;
      });
    }, 30000);

    return () => clearInterval(petTimerRef.current);
  }, [petData?.form, petData?.petMode, petData?.difficulty]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── S31: THE 30-SECOND AUTO-SAVE IS GONE, AND THAT IS THE FIX ─────────────
  //
  // It used to be:
  //     petSaveTimerRef.current = setInterval(() => {
  //       setPetData(p => { if (p) savePet(p); return p; });
  //     }, 30000);
  //   }, [petData, savePet]);
  //
  // 🚨 It is deleted rather than debounced, because on a shared per-user row it
  // is the clobber itself. localData.js's KNOWN GAP note called this out when
  // the app was still "a one-window product": two clients each running this
  // timer overwrite each other's whole pet object every half minute, and
  // Audrey's hunger would visibly jitter between two values — the exact symptom
  // she asked to have removed.
  //
  // ⚠️ And it was worst precisely where it looked safest. The decay reducer
  // returns the IDENTICAL object reference for an egg, a corpse, a ghost, or
  // petMode off, so `petData` never changes, so this effect was never torn down
  // and fired cleanly every 30s over the other machine's live state. Audrey's
  // own pet is a GHOST — one of those four. The egg race was the sharpest case:
  // hatch on the laptop, and the desktop still holding an egg writes it back
  // within 30 seconds, so the adult is gone and the next hatch rolls a
  // different breed.
  //
  // Nothing is lost by deleting it. Decay does not NEED persisting: hunger and
  // happiness are a value at `lastUpdatedAt`, and applyOfflineDecay recomputes
  // the difference on the next read. Every user-visible interaction already
  // saves synchronously (feed, pet, hatch, thumb, difficulty, petMode, reset),
  // and the material transitions the timer used to catch — falling asleep,
  // waking, evolving, dying — now persist at the point they happen, in the
  // decay tick above.
  //
  // The invariant that makes this safe: hunger/happiness and lastUpdatedAt are
  // only ever written TOGETHER, by savePet.
  //
  // What replaces it: persist only when a MATERIAL field changes. This effect
  // depends on petData, so it re-runs on every decay tick, but it WRITES only
  // when the signature moves — which is why deleting the timer does not lose
  // sleep, waking, evolution or death. The ref is primed by both load paths, so
  // loading a pet is never mistaken for changing one.
  useEffect(() => {
    if (!petData) return;
    const sig = petMaterialSignature(petData);
    if (petPersistedSigRef.current === null) { petPersistedSigRef.current = sig; return; }
    if (petPersistedSigRef.current === sig) return;
    petPersistedSigRef.current = sig;
    savePet(petData);
  }, [petData, savePet]);

  // Sleep Z cycle animation
  useEffect(() => {
    if (petData?.state !== 'sleeping') return;
    const id = setInterval(() => setSleepZCycle(c => c + 1), 2000);
    return () => clearInterval(id);
  }, [petData?.state]);

  // Dream cloud intermittent visibility — show 3s, hide 8-15s
  useEffect(() => {
    if (!petData || petData.form === 'egg' || petData.form === 'corpse' || petData.form === 'ghost') return;
    if (!petData.petMode) return;
    let timeout;
    function cycle() {
      setCloudVisible(true);
      timeout = setTimeout(() => {
        setCloudVisible(false);
        timeout = setTimeout(cycle, 8000 + Math.random() * 7000);
      }, 3000);
    }
    timeout = setTimeout(cycle, 2000 + Math.random() * 5000);
    return () => clearTimeout(timeout);
  }, [petData?.form, petData?.petMode]);

  // Random attention-seeking jump — every 20-60 seconds
  useEffect(() => {
    if (!petData || petData.form === 'egg' || petData.form === 'corpse' || petData.form === 'ghost') return;
    if (!petData.petMode || petData.sleepingSince) return;
    let timeout;
    function scheduleJump() {
      timeout = setTimeout(() => {
        setAttentionJump(true);
        setTimeout(() => {
          setAttentionJump(false);
          scheduleJump();
        }, 500);
      }, 20000 + Math.random() * 40000);
    }
    scheduleJump();
    return () => clearTimeout(timeout);
  }, [petData?.form, petData?.petMode, petData?.sleepingSince]);

  // ── Pet action handlers ──
  const handleFeed = useCallback(() => {
    if (!petData || (petData.form !== 'baby' && petData.form !== 'adult')) return;
    if (petData.sleepingSince) return;
    setPetData(prev => {
      if (!prev) return prev;
      if (prev.hunger >= 100) return prev;
      // A3: hunger moved, so the anchor moves with it. See performPetSave —
      // the save no longer stamps one, because a stamp on every write made
      // migration 0068's stale-write guard inert.
      const next = { ...prev, hunger: Math.min(100, prev.hunger + 25), lastFedAt: new Date().toISOString(), interactionCount: prev.interactionCount + 1, lastUpdatedAt: new Date().toISOString() };
      next.state = derivePetState(next);
      savePet(next);
      return next;
    });
    setFlashFeed(true);
    setTimeout(() => setFlashFeed(false), 600);
  }, [petData, savePet]);

  const handlePetAction = useCallback(() => {
    if (!petData) return;
    if (petData.form === 'egg') {
      setEggWobble(true);
      setTimeout(() => setEggWobble(false), 500);
      setPetData(prev => {
        if (!prev) return prev;
        const next = { ...prev, eggPetCount: prev.eggPetCount + 1 };
        if (next.eggPetCount >= next.eggHatchThreshold) {
          next.form = 'baby';
          next.breed = pickRandomBreed();
          next.bornAt = new Date().toISOString();
          next.hunger = 80;
          next.happiness = 80;
          // A3: hatching sets both numbers, so it sets the anchor too.
          next.lastUpdatedAt = new Date().toISOString();
          next.lastSleptAt = new Date().toISOString();
          next.state = derivePetState(next);
          savePet(next);
          setTimeout(() => {
            setHatchNameInput(next.name || 'Ollie');
            setShowHatchModal(true);
          }, 600);
        } else {
          savePet(next);
        }
        return next;
      });
      return;
    }
    if (petData.form === 'baby' || petData.form === 'adult') {
      if (petData.sleepingSince) {
        setPetData(prev => {
          if (!prev) return prev;
          // A3: decay resumes now, so the anchor is now. Without this the next
          // cold start would decay the whole sleep as if the pet had been awake
          // through it.
          const next = { ...prev, sleepingSince: null, lastSleptAt: new Date().toISOString(), interactionCount: 0, lastUpdatedAt: new Date().toISOString() };
          next.state = derivePetState(next);
          savePet(next);
          return next;
        });
        return;
      }
      setPetData(prev => {
        if (!prev) return prev;
        // A3: happiness moved, so the anchor moves with it.
        const next = { ...prev, happiness: Math.min(100, prev.happiness + 20), lastPettedAt: new Date().toISOString(), interactionCount: prev.interactionCount + 1, lastUpdatedAt: new Date().toISOString() };
        next.state = derivePetState(next);
        savePet(next);
        return next;
      });
      setFlashPet(true);
      setTimeout(() => setFlashPet(false), 600);
    }
  }, [petData, savePet]);

  const handleThumbRating = useCallback((rating) => {
    if (feedbackJustRated || chatMessages.length === 0) return;
    const lastAssistant = [...chatMessages].reverse().find(m => m.role === 'assistant');
    const lastUser = [...chatMessages].reverse().find(m => m.role === 'user');
    if (!lastAssistant) return;

    setFeedbackJustRated(true);
    setThumbFlash(rating);
    setTimeout(() => setThumbFlash(null), 1000);

    setPetData(prev => {
      if (!prev) return prev;
      // 🚨 A3: WHAT IS STORED IS BOUNDED, AND MEASURED.
      //
      // These two fields were stored UNTRUNCATED (the 2000-character trim above
      // applies only to what is SENT to the model), fifty entries are kept, and
      // Create Egg carries the whole array into the new pet. MEASURED on
      // wilson-dev 2026-09-07: fifty entries whose botResponse is 4096
      // characters — the ceiling a max_tokens 1024 reply reaches — come to
      // 219,807 bytes against user_pets' 262,144-byte CHECK. 84% of the cap,
      // and `userMsg` is whatever somebody pasted into the chat, which is not
      // bounded at all. A violation throws inside saveCloudPet, and the write
      // most likely to trip it is the one taken by a person whose pet has just
      // died.
      //
      // 🚨 THE ONLY CONSUMER SLICES BOTH TO 60 CHARACTERS (the RECENT FEEDBACK
      // block in sendChat, which shows the last ten). Nothing displays these
      // strings anywhere. So the bound below loses nothing that is read, and
      // takes a maximal array from ~220 KB to under 55 KB — an order of
      // magnitude clear of the cap instead of inside its noise.
      const entry = {
        timestamp: new Date().toISOString(),
        userMsg: (lastUser?.content || '').slice(0, FEEDBACK_SNIPPET_CHARS),
        botResponse: (lastAssistant.content || '').slice(0, FEEDBACK_SNIPPET_CHARS),
        rating
      };
      const feedback = [...(prev.feedback || []), entry].slice(-50);
      const next = {
        ...prev,
        feedback,
        totalThumbsUp: prev.totalThumbsUp + (rating === 'up' ? 1 : 0),
        totalThumbsDown: prev.totalThumbsDown + (rating === 'down' ? 1 : 0)
      };
      if (rating === 'up' && prev.petMode && (prev.form === 'baby' || prev.form === 'adult')) {
        next.happiness = Math.min(100, next.happiness + 5);
        // A3: and ONLY here. A thumbs-down changes the feedback array and no
        // number, so it re-sends the anchor it holds and 0068 accepts it as an
        // equal — which is what stops a rating from a stale window counting as
        // "this copy is newer".
        next.lastUpdatedAt = new Date().toISOString();
      }
      next.state = derivePetState(next);
      savePet(next);
      return next;
    });
  }, [feedbackJustRated, chatMessages, savePet]);

  const handleHatchConfirm = useCallback(() => {
    const name = hatchNameInput.trim() || 'Ollie';
    setPetData(prev => {
      if (!prev) return prev;
      const next = { ...prev, name };
      savePet(next);
      return next;
    });
    // Also save to O.T.T.E.R. settings
    loadOtterSettings().then(s => {
      saveOtterSettings({ ...s, companionName: name }).catch(() => {});
    }).catch(() => {});
    setShowHatchModal(false);
  }, [hatchNameInput, savePet]);

  // ── Companion chat ──
  const sendChat = useCallback(async () => {
    const currentInput = chatInputRef.current;
    // AI rides the authenticated ai-proxy now — signed out means no chat
    // (PetCompanion shows the reason via aiUnavailable).
    if (!currentInput.trim() || !authed) return;
    const userMsg = { role: 'user', content: currentInput };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput('');
    chatInputRef.current = '';
    setChatLoading(true);
    setChatThinking(true);
    setFeedbackJustRated(false);

    if (petData && petData.petMode && (petData.form === 'baby' || petData.form === 'adult')) {
      setPetData(prev => prev ? { ...prev, interactionCount: (prev.interactionCount || 0) + 1 } : prev);
    }

    // Build context
    let context = '\n\n--- CURRENT CONTEXT ---';
    context += `\n\nCURRENT WILSON PAGE: ${currentPage}`;
    // 🚨 A FOURTH hand-kept list of page names lived here. It was missing
    // four of the twelve pages and still said "System Settings" after Q7
    // renamed it. It is the registry now, like the other three — and
    // `adminOnly` is filtered out exactly as the nav filters it, so the
    // companion does not tell a non-admin that an Admin terminal exists.
    const pageList = PAGES
      .filter(p => !p.adminOnly)
      .map(p => (p.subtitle ? `${p.title} (${p.subtitle})` : p.title))
      .join(', ');
    context += '\nAVAILABLE PAGES: ' + pageList;

    // RABBIT knowledge snippet — appended when the user is on the
    // RABBIT page so the companion can field tool-specific questions
    // without polluting the base companion prompt for other tools.
    if (currentPage === 'rabbit') {
      context += `\n\nRABBIT KNOWLEDGE:`;
      context += `\nRABBIT is a production-planning tool with this hierarchy: Workspace → Projects → Phases → Assets → Tasks. Each task carries bid_days, logged_days, status, priority, and an assigned_role_slug. Task dependencies form a DAG; the critical path is the longest-weighted chain through that DAG by bid_days.`;
      context += `\nTabs (left submenu): Project Summary (overview cards), Project Assets (table or gallery, inline editing, type/phase filters), Timeline (Gantt with day/week/month/quarter/year zoom + critical path highlight), Budget (Summary / By Phase / By Role / By Asset / Custom), Intake Wizard (Prepare → Run → Review — turns source documents into a structured breakdown via the Anthropic API).`;
      context += `\nResources submenu (slide-out): Projects (list + create), Rate Card (workspace-level role/day_rate table), Settings (adapter mode, default currency, default rate card).`;
      context += `\nStorage adapters: Local Server (default, single-user, in-app Express), Supabase (multi-user Postgres), Google Drive (read-only sync; writes deferred to v0.2).`;
      context += `\nTask statuses (10): bidding, waiting_to_start, in_progress, blocked, on_hold, pending_review, revisions, approved, final, omitted. Done = approved/final/omitted.`;
      context += `\nAsset types include character, environment, prop, vehicle, vfx, animation, rig, model, texture, audio, vo, music, cinematic, ui, level, script, treatment, concept, storyboard, illustration, document, deliverable, other (24 total).`;
      context += `\nIntake supported formats: PDF, DOCX, PPTX, TXT, MD only. The wizard's AI features are included with the workspace sign-in — no API key setup needed.`;
      context += `\nCommon flows: import a script → Intake Wizard. Switch projects → project picker in the RABBIT header. Set day rates → Rate Card page. Mark a task done → inline-edit its status on the Project Assets tab. Change adapter or default currency → App settings → Storage tab.`;
      context += `\nRABBIT is currently v0.1.0 inside WILSON v0.6. Costs in the budget tabs come from the active rate card; tasks whose role isn't in the card compute at 0 (the Summary tab surfaces a warning).`;
    }

    // Pet status context
    if (petData) {
      context += `\n\nPET STATUS:`;
      context += `\nName: ${petData.name} | Gender: ${petData.gender} | Breed: ${petData.breed || 'otter'} | Form: ${petData.form} | State: ${petData.state}`;
      context += `\nHunger: ${Math.round(petData.hunger)}/100 | Happiness: ${Math.round(petData.happiness)}/100`;
      context += `\nDifficulty: ${petData.difficulty} | Pet Mode: ${petData.petMode}`;

      if (!petData.petMode) {
        context += `\n\nPet mode is OFF. You are in helper-only mode. Do not reference hunger, sleep, or pet state. Just be a helpful study buddy.`;
      }

      if (petData.feedback && petData.feedback.length > 0) {
        const recent = petData.feedback.slice(-10);
        context += `\n\nRECENT FEEDBACK (last ${recent.length}):`;
        for (const fb of recent) {
          const userSnippet = (fb.userMsg || '').slice(0, 60);
          const botSnippet = (fb.botResponse || '').slice(0, 60);
          context += `\n[${fb.rating}] User: "${userSnippet}" → You: "${botSnippet}"`;
        }
        context += `\nTotal: ${petData.totalThumbsUp} thumbs up / ${petData.totalThumbsDown} thumbs down`;
      }
    }

    try {
      // ── PHASE 6: the pet reads the lessons ────────────────────────────────
      // Audrey asked Tomithy how to scale something in Blender — written down
      // in her Blender course — and it told her to look it up herself. It was
      // not broken: the three blocks above are the WHOLE of what this function
      // has ever known, and none of them contains a line of course content.
      //
      // 🚨 INSIDE the try, so the `finally` below still clears the spinner.
      //    setChatLoading(true) fires at the top of this function and the only
      //    thing that lowers it is that finally — an await added between them
      //    hangs the pet's thinking dots forever on any rejection.
      // 🚨 OUTSIDE the retry loop below, or a retried overload re-runs every
      //    read for a request that already fetched its content.
      // 🚨 NOT gated on `currentPage === 'otter'`. The pet is on every page and
      //    Audrey's question does not become a Blender question only while she
      //    is already looking at the Blender course.
      //
      // 🚨 AND BOUNDED. Every otterFetch runs `cloudActive()`, which awaits a
      //    BARE `supabase.auth.getSession()` — no ceiling. callAI, the only
      //    network call this function used to make, deliberately wraps that
      //    same await in withTimeout(…, AUTH_TIMEOUT_MS) because an abandoned
      //    getSession() holds auth-js's global per-storageKey lock and every
      //    later call queues behind it. Adding an UNBOUNDED session read in
      //    front of the spinner would have re-opened, in the pet, exactly the
      //    hang that ceiling was built to close.
      //    ⚠️ withTimeout races but never aborts: the reads keep running and
      //    are discarded. That is fine — what matters is that the chat is free.
      //
      // retrieveOtterKnowledge is written to resolve, never throw — but this is
      // belt and braces, because a chat that dies on a retrieval failure is
      // strictly worse than the "look it up yourself" it replaces.
      let knowledgeBlock = '';
      try {
        const knowledge = await withTimeout(
          retrieveOtterKnowledge({ question: currentInput, fetchImpl: otterFetch }),
          KNOWLEDGE_TIMEOUT_MS, 'reading your courses',
        );
        knowledgeBlock = knowledge.block;
      } catch { /* answer without the library rather than not at all */ }
      context += knowledgeBlock;

      // Load O.T.T.E.R. settings for custom companion prompt
      let companionPrompt = COMPANION_PROMPT;
      try {
        const otterSettings = await loadOtterSettings();
        if (otterSettings.prompts?.companion) companionPrompt = otterSettings.prompts.companion;
      } catch { /* use default */ }

      // Truncate conversation history to stay within token limits
      // Keep last 40 messages (~20 exchanges), trim older ones but always keep first exchange for continuity
      const MAX_HISTORY = 40;
      const MAX_MSG_CHARS = 2000;
      let trimmedMessages = newMessages.map(m => ({
        role: m.role,
        content: m.content.length > MAX_MSG_CHARS ? m.content.slice(0, MAX_MSG_CHARS) + '…' : m.content,
      }));
      if (trimmedMessages.length > MAX_HISTORY) {
        const first2 = trimmedMessages.slice(0, 2);
        const recent = trimmedMessages.slice(-MAX_HISTORY + 2);
        trimmedMessages = [...first2, { role: 'user', content: '[Earlier conversation trimmed for brevity]' }, { role: 'assistant', content: 'Got it, I remember the gist!' }, ...recent];
      }

      // Retry logic for overloaded/rate-limit errors
      let data;
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
        try {
          data = await callAI({
            model: modelFor('pet.chat'),
            max_tokens: 1024,
            system: companionPrompt + context,
            messages: trimmedMessages,
            tool: 'companion',
          });
          break;
        } catch (fetchErr) {
          lastError = fetchErr.message || 'Network error';
          const authish = /invalid|auth|key|permission|sign in/i.test(lastError) && !isRetryableAIError(fetchErr);
          if (attempt < 2 && !authish) continue;
          throw fetchErr;
        }
      }
      // S30: a thinking block can occupy content[0]; find the text block.
      const reply = textFromMessage(data) || 'Sorry, I had trouble thinking of a response!';
      setChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e) {
      const msg = e.message || 'Unknown error';
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Oops! ${msg}` }]);
    } finally {
      setChatLoading(false);
      setChatThinking(false);
    }
  }, [chatMessages, authed, currentPage, petData]);

  // A bare Shift tap opens and closes the companion — never while typing in a
  // field, never over a dialog (post-overhaul S2a, Audrey's C12). It was
  // Enter, which took the key from every focused button (OUTSTANDING P1-01);
  // Enter now presses whatever has focus. The listener lives in
  // lib/companionHotkey.js so a test mounts the SAME handler the app installs.
  //
  // Installed ONCE, in a layout effect, reading the pet and the sign-in
  // overlay through a ref at the moment of a tap (review round 2, B-R2-02 and
  // B-R2-04): window listeners run in the order they were added, and the
  // session's activity listener — which closes "Still there?" on any key — is
  // added in a passive effect once signed in. Installed first and never again,
  // the hotkey sees that alert still open on the very keydown that closes it,
  // so the tap that wakes the screen does not also open the pet; and a pet
  // update every 30s no longer resets a half-made tap.
  const companionKeyState = useRef({ petData, showOverlay });
  useLayoutEffect(() => { companionKeyState.current = { petData, showOverlay }; });
  useLayoutEffect(() => installCompanionShiftHotkey({
    getState: () => companionKeyState.current,
    toggle: () => setCompanionOpen(prev => !prev),
  }), []);

  // Handle navigation links from companion chat
  const handleCompanionNavLink = useCallback((navStr) => {
    // navStr format: "nav:type:slug" or "nav:type:slug:subslug"
    const parts = navStr.replace(/^nav:/, '').split(':');
    const type = parts[0];
    if (type === 'quiz' || type === 'library' || type === 'hotkeys' || type === 'functions') {
      navigateTo('otter');
    } else if (type === 'software' || type === 'subject' || type === 'lesson') {
      navigateTo('otter');
    }
    setCompanionOpen(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pet settings callbacks (for SettingsPage) ──
  // 🚨 R2 OF A3: THE RESUME ANCHOR IS EARNED, NOT ASSERTED — AND R1'S FIX FOR
  // IT WAS A WORSE BUG THAN THE ONE IT FIXED.
  //
  // R1 was right that turning Pet Mode back ON is a decay-clock event: while
  // it is off nothing advances the anchor (the live tick returns `prev`,
  // applyOfflineDecay skips), so the row keeps the anchor from the moment it
  // was switched off, and the first launch after switching it on measures the
  // WHOLE paused period and applies it in one go — six hours off, flipped on,
  // reopened, hunger 0, form 'ghost'.
  //
  // 🚨 BUT STAMPING `now` INSIDE THE TOGGLE MADE MIGRATION 0068 INERT FOR THE
  // ONE CONTROL WALKTHROUGH 07 TELLS AUDREY TO PRESS. A stale window's write
  // is refused because its anchor is OLDER; a fresh stamp makes it newer, so
  // the whole six-hour-old pet — hunger, happiness, form, name, the feedback
  // array — was accepted over the other machine's, silently, with no notice.
  // One click. It was also the only save in the app that minted a fresh anchor
  // without moving hunger or happiness, which is exactly the shape 0068's
  // header says makes the guard inert.
  //
  // So the anchor is taken in TWO STEPS. The toggle is saved with the anchor
  // the window is HOLDING, which 0068 can still refuse; only a save that
  // LANDED — which means this window's copy is the account's copy — earns the
  // fresh one. A stale window gets the refusal, the re-read and the notice
  // instead, which is ruling 4 working as intended.
  //
  // ⚠️ Two round trips for one toggle, and a window of one of them in which
  // another machine could write between the two. That is bounded by a network
  // round trip instead of by however long Pet Mode was off, which is the trade
  // being made.
  const resumeAnchorAfterLandedSave = useCallback((landed) => {
    if (!landed) return;
    setPetData(cur => {
      if (!cur || cur.petMode !== true) return cur;
      // Only the forms that decay. An egg, a corpse or a ghost gains nothing
      // from a fresh anchor — applyOfflineDecay skips all three — so bumping
      // there would spend a round trip to weaken 0068 for no benefit, and
      // Audrey's own pet is a ghost.
      if (cur.form !== 'baby' && cur.form !== 'adult') return cur;
      const bumped = { ...cur, lastUpdatedAt: new Date().toISOString() };
      savePet(bumped);
      return bumped;
    });
  }, [savePet]);

  const handlePetModeToggle = useCallback((enabled) => {
    setPetData(prev => {
      if (!prev) return prev;
      const next = { ...prev, petMode: enabled };
      next.state = derivePetState(next);
      const resuming = enabled && prev.petMode === false;
      const saving = savePet(next);
      if (resuming) saving.then(resumeAnchorAfterLandedSave);
      return next;
    });
  }, [savePet, resumeAnchorAfterLandedSave]);

  const handleDifficultyChange = useCallback((difficulty) => {
    setPetData(prev => {
      if (!prev) return prev;
      const next = { ...prev, difficulty };
      savePet(next);
      return next;
    });
  }, [savePet]);

  const handlePetReset = useCallback(() => {
    setPetData(prev => {
      if (!prev) return prev;
      const next = { ...prev, feedback: [], totalThumbsUp: 0, totalThumbsDown: 0, interactionCount: 0 };
      savePet(next);
      return next;
    });
  }, [savePet]);

  // 🚨 S31: this was `catch { /* silent */ }` — structurally the same shape as
  // the Validator's "Accept Fix", a green tick over a write that may not have
  // happened. Hatching a new egg is the one action taken by somebody whose pet
  // has DIED, so failing at it silently is the worst possible moment to be
  // quiet.
  //
  // 🚨 PHASE 3 (2026-08-12) — THIS IS THE FIX FOR AUDREY'S REPORT. It used to
  // call `newPetEgg()`, which asked a PER-DEVICE store whether the pet was a
  // ghost. Three independent reasons that could only fail:
  //
  //   * the pet follows the PERSON since S31, so the device copy is a cache
  //     that a second computer may never have held;
  //   * `hasLocalServer()` picked the branch, and it is true for the desktop
  //     app IN CLOUD MODE;
  //   * an OFFLINE death is never written to ANY store — applyOfflineDecay
  //     computes the ghost in memory and both load paths deliberately prime
  //     the signature ref instead of saving. So the screen said "ghost" while
  //     the cache AND the account row both still said "adult", and re-pointing
  //     the old check at the account would have thrown just the same.
  //
  // The pet React is rendering is the only thing that knows the pet is dead, so
  // that is what decides, via the pure canCreateNewEgg(). savePet() then does
  // the write, and it is the one function that routes by ACCOUNT.
  //
  // ⚠️ petPersistedSigRef is primed BEFORE the await, exactly as it was: the
  // material-change effect must see the egg as already-persisted so it does not
  // fire a second, competing save for the same object.
  const handleNewPet = useCallback(async () => {
    setNewPetStatus(null);
    if (newPetPendingRef.current) return;

    const current = petData;
    if (!canCreateNewEgg(current)) {
      // ⚠️ One message, not a ternary on `current`. The "pet has not loaded yet"
      // arm had NO REACHABLE RENDERER — SettingsPage gates the whole pet panel,
      // this status block included, on `{petData && …}`, so a null pet means
      // there is no button to press and nowhere to show it. That is the repo's
      // signature no-caller shape and it does not get to ship again here.
      setNewPetStatus({ ok: false, message: 'A new egg can only be created once your pet has died.' });
      return;
    }

    newPetPendingRef.current = true;
    setNewPetPending(true);
    try {
      const pet = mintEggFrom(current);
      // Invalidate any pet read that was already in flight — see petEpochRef.
      petEpochRef.current += 1;
      setPetData(pet);
      setChatMessages([]);
      petPersistedSigRef.current = petMaterialSignature(pet);
      const saved = await savePet(pet);
      setNewPetStatus(saved
        ? { ok: true, message: 'A new egg is on its way. Pet it a few times to hatch it.' }
        : { ok: false, message: 'The new egg could not be saved, so it may not reach your other computers. Check your connection and try again.' });
    } catch (err) {
      setNewPetStatus({ ok: false, message: err?.message || 'A new egg could not be created.' });
    } finally {
      newPetPendingRef.current = false;
      setNewPetPending(false);
    }
  }, [savePet, petData]);

  // Transition: fade-out(250ms) → compress(600ms) → title-hold(400ms) → [swap] → expand(600ms) → fade-in(250ms) → idle
  // fromHistory: true when the browser back/forward button initiated the
  // navigation — the URL is already right, so don't push a new entry.
  const navigateTo = useCallback((targetPage, fromHistory = false, asked = false) => {
    if (transitionRef.current || targetPage === currentPage) return;
    // Post-overhaul S3c, step 7 (D12): leaving R.A.B.B.I.T. with an unsaved
    // edit asks first — BEFORE the transition, which is untouchable (C2).
    // Keep editing stays; after a back/forward press the address goes back
    // to this page, so the two never disagree.
    if (!asked && currentPage === 'rabbit' && hasUnsavedWork('page')) {
      confirmLeave('page').then((go) => {
        if (go) { navigateToRef.current(targetPage, fromHistory, true); return; }
        if (fromHistory && URL_ROUTING_ENABLED) {
          try { window.history.pushState({ page: currentPage }, '', urlForPage(currentPage)); } catch { /* keep the page */ }
        }
      });
      return;
    }
    transitionRef.current = true;
    // Phase 3: the Create Egg result describes one press, not a lasting state.
    // Without this it survived every later visit to Settings, so a success
    // banner outlived the egg it described — and after the egg hatched it was
    // describing a pet that no longer existed.
    setNewPetStatus(null);

    if (URL_ROUTING_ENABLED && !fromHistory) {
      try {
        window.history.pushState({ page: targetPage }, '', urlForPage(targetPage));
      } catch { /* history API unavailable — keep navigating anyway */ }
    }

    setTransitionTitle(PAGE_TITLES[targetPage] || targetPage);

    // Hide pet sprite immediately
    setPetVisible(false);
    // Close companion chat during transition
    setCompanionOpen(false);

    // Step 0: Fade out content first (before bars move)
    setTransitionState('fading-out');

    setTimeout(() => {
      // Step 1: Compress (bars squeeze toward center)
      setTransitionState('compressing');

      setTimeout(() => {
        // Step 2: Title hold
        setTransitionState('title-hold');

        setTimeout(() => {
          // Step 3: Swap page, expand
          setCurrentPage(targetPage);
          setTransitionState('expanding');

          setTimeout(() => {
            // Step 4: Fade in new content
            setTransitionState('fading-in');

            setTimeout(() => {
              // Step 5: Done
              setTransitionState('idle');
              setTransitionTitle('');
              setShowNavMenu(false);
              transitionRef.current = false;
              // Show pet sprite after transition completes
              setPetVisible(true);
            }, TRANSITION.fadeIn);
          }, TRANSITION.expand);
        }, TRANSITION.hold);
      }, TRANSITION.compress);
    }, TRANSITION.fadeOut);
  }, [currentPage]);

  // ── Post-sign-in welcome (Session 43) ─────────────────────────────────
  // Audrey, 2026-08-10: "when the login is done, after the auth code, lets add
  // a welcome animation. have it work like the transition animation from page
  // to page. but instead of naming the upcoming page say 'Welcome'."
  //
  // Same chain, same durations, same overlay as navigateTo. Two differences,
  // both deliberate:
  //
  //  - No page swap. The user is already arriving at Home; this transition
  //    announces an arrival rather than covering one.
  //  - It starts at 'compressing', not 'fading-out'. There is nothing to fade
  //    out — AuthShell has been covering the app and its reveal has only just
  //    handed over, so fading content the user has never seen would read as a
  //    flicker before the bars move. AuthShell's reveal settles the bars at
  //    PAGE_BARS.home (imported by both, see src/layout/pageBars.js — Phase 4
  //    made it viewport-responsive) and this picks them up from there, so
  //    the two animations read as one continuous movement: the bars close,
  //    say WELCOME, and open onto Home.
  const playWelcome = useCallback(() => {
    if (transitionRef.current) return;
    transitionRef.current = true;
    setTransitionTitle('Welcome');
    setPetVisible(false);
    setCompanionOpen(false);
    setTransitionState('compressing');
    setTimeout(() => {
      setTransitionState('title-hold');
      setTimeout(() => {
        setTransitionState('expanding');
        setTimeout(() => {
          setTransitionState('fading-in');
          setTimeout(() => {
            setTransitionState('idle');
            setTransitionTitle('');
            transitionRef.current = false;
            setPetVisible(true);
          }, TRANSITION.fadeIn);
        }, TRANSITION.expand);
      }, TRANSITION.hold);
    }, TRANSITION.compress);
  }, []);

  useEffect(() => {
    if (!welcomeQueued || !authed) return;
    if (showOverlay || pendingOnboarding || pendingMfaEnroll) return;
    if (welcomePlayedRef.current) return;
    welcomePlayedRef.current = true;
    setWelcomeQueued(false);
    playWelcome();
  }, [welcomeQueued, authed, showOverlay, pendingOnboarding, pendingMfaEnroll, playWelcome]);

  // Back/forward buttons re-enter through navigateTo (with the animation).
  // The ref keeps the listener stable across navigateTo's re-creation.
  const navigateToRef = useRef(navigateTo);
  useEffect(() => { navigateToRef.current = navigateTo; }, [navigateTo]);

  // Session 13: the Admin Terminal's "Open their course" (change-request
  // review) navigates the shell to O.T.T.E.R.; Otter.jsx listens for the same
  // event and selects the course. An event, not a prop, because
  // AdminTerminalPage deliberately takes none and this is the one cross-tool
  // jump in the app.
  useEffect(() => {
    const onOpenOtterCourse = () => { navigateToRef.current('otter'); };
    window.addEventListener('wilson:open-otter-course', onOpenOtterCourse);
    return () => window.removeEventListener('wilson:open-otter-course', onOpenOtterCourse);
  }, []);
  useEffect(() => {
    if (!URL_ROUTING_ENABLED) return;
    // Deep links land with no history state — stamp the entry so the first
    // back/forward hop has a page to return to.
    try {
      window.history.replaceState({ page: pageFromLocation() }, '', window.location.href);
    } catch { /* fine — popstate falls back to pathname parsing */ }
    const onPop = () => {
      if (transitionRef.current) {
        // A transition is mid-flight (fixed 2.1s chain) and navigateTo drops
        // re-entrant calls. Retry once the lock releases so the page catches
        // up with the URL instead of desyncing.
        const poll = setInterval(() => {
          if (!transitionRef.current) {
            clearInterval(poll);
            navigateToRef.current(pageFromLocation(), true);
          }
        }, 200);
        setTimeout(() => clearInterval(poll), 4000);
        return;
      }
      navigateToRef.current(pageFromLocation(), true);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Page flags. `isDarkPage` and the header's shape are the registry's answer
  // now, not a hand-kept list: Team Members is the first page on the Q1 dark
  // ground that is NOT a tool, and the two used to be the same condition.
  const page = getPage(currentPage) || getPage('home');
  const isHome = currentPage === 'home';
  const isToolPage = page.chrome === 'tool';
  const isDarkPage = page.surface === 'dark';
  const hasNavMenu = !isHome; // All non-home pages get a hamburger + nav strip

  // Bottom offset for pet sprite — positions it above the bottom bar.
  //
  // 🚨 DERIVED FROM PAGE_BARS, never re-typed. This was a private
  // `BOTTOM_BAR_PX` table — a second, silent copy of every bottom-bar height,
  // 150px of it duplicated six times. Phase 4 made the bars viewport-relative
  // and that copy would have gone on insisting Home's bar was 268px, standing
  // the pet ~76px above the bar it is drawn sitting on, on exactly the screen
  // this phase set out to fix. Nothing tests where the pet sits.
  const petBottomOffset =
    `calc(${(PAGE_BARS[currentPage] || PAGE_BARS.home).bottom} + 16px)`;

  // Close the resources sub-column when the nav menu closes or page changes
  useEffect(() => {
    if (!showNavMenu) { setNavResourcesOpen(false); setNavHovered(null); }
  }, [showNavMenu]);
  useEffect(() => {
    setNavResourcesOpen(false);
    setNavHovered(null);
  }, [currentPage]);

  // ── Nav strip opacity (Session 43 §A8) ────────────────────────────────
  // 🚨 `hover:opacity-70` was on BOTH columns and only worked on one. The
  // main strip also carries an inline `opacity`, and an inline style beats a
  // class selector — so the main strip was pinned at its inline value on
  // every render and the hover never applied. The resources sub-column has no
  // inline opacity, which is the entire reason its hover worked. That
  // asymmetry is what Audrey saw: not a missing animation, a specificity
  // collision.
  //
  // The fix cannot simply drop the inline value: `dimmed` is load-bearing —
  // it fades the main strip to 0.35 while the resources column is open, which
  // is what tells you which column is live. Hover and dimmed have to resolve
  // in ONE place, so they do, here, and `hover:opacity-70` is gone from both
  // columns so there is no second source of truth.
  //
  // 0.7 matches what the resources column was already doing, per Audrey: "it
  // should work the same" (Law of Similarity — same control, same response).
  //
  // ✅ This grey is NOT the banned grey. It is white at reduced opacity on
  // dark orange, as an interactive state on large bold type — not content
  // text on an orange surface. Do not remove it while enforcing the colour
  // rule.
  //
  // ── UI overhaul F2, the state extraction (plan §5) ──────────────────────
  // The resolution above is right and stays; what changed is WHERE it lands.
  // It used to be an inline `opacity` computed from `navHovered`, and an
  // inline value beats any class — which is the whole defect this comment
  // documents, one step removed. The state is now a single data attribute
  // and the two values live in `.wilson-nav-item[data-state]` in index.css,
  // so hover and dimmed STILL resolve in exactly one place (the property
  // that mattered) and a later restyle can reach them from a stylesheet.
  const navState = (key, dimmed) => (dimmed ? 'dimmed' : (navHovered === key ? 'hover' : 'rest'));
  // `hover:` is mouse-only and this nav is keyboard-reachable, so focus feeds
  // the same state rather than leaving a keyboard user with no feedback.
  const navStateProps = (key) => ({
    onMouseEnter: () => setNavHovered(key),
    onMouseLeave: () => setNavHovered((h) => (h === key ? null : h)),
    onFocus:      () => setNavHovered(key),
    onBlur:       () => setNavHovered((h) => (h === key ? null : h)),
  });

  const closeNavAndGo = (page) => { setShowNavMenu(false); setNavResourcesOpen(false); navigateTo(page); };

  // ── The nav strip, from the registry (F2) ────────────────────────────────
  // Both columns' PAGES come from `src/layout/pages.js` — one list, in its own
  // order, filtered for the page you are on and for the admin-only surface
  // (filtered from the ARRAY, not hidden per button, so keyboard and mouse
  // share one list — Session 9). The one item that is NOT a page is
  // assembled beside them here: the RESOURCES toggle.
  //
  // Q7, ruled: the tool's item and the app's both read "SETTINGS", side by
  // side in the same column; they became "Tool settings" and "App settings".
  // Post-overhaul S2a (Audrey's C6, 2026-09-29): the tool half left the
  // strip for all three tools. Each tool's gear is at the right end of its
  // OWN strip, Help beside it (C7) — the three counters that opened a
  // tool's settings from here, their props and the tools' effects are gone
  // with it. "App settings" stays: it is a page.
  //
  // The strip is GROUPED: destinations above the hairline, the resources
  // toggle and App settings below. A separator is not a control (C1); it is
  // Proximity doing the work eleven equal-weight peers were asking the reader
  // to do (Hick's law — the strip is the app's whole navigation).
  const getNavStripItems = () => {
    const primary = navPages('primary', { currentPage });
    const appSettings = primary.find(p => p.id === 'settings');
    const items = primary
      .filter(p => p.id !== 'settings')
      .map(p => ({ label: p.navLabel, action: () => closeNavAndGo(p.id) }));

    const tail = [];
    // RESOURCES trigger (toggles the sub-column; no direct navigation)
    tail.push({ label: 'Resources', isResourcesTrigger: true });
    if (appSettings) {
      tail.push({ label: appSettings.navLabel, action: () => closeNavAndGo(appSettings.id) });
    }

    return [...items, { separator: true }, ...tail];
  };

  // Sub-column items shown when RESOURCES is expanded
  const getResourcesNavItems = () => navPages('resources', {
    currentPage,
    isAdmin: perms.role === 'admin',
  }).map(p => ({ label: p.navLabel, action: () => closeNavAndGo(p.id) }));

  // 🚨 The 24 here was an ASSUMED line box for 16px type (review, nav finding)
  // and would have been wrong the moment the size changed — which is this
  // commit. It is now the H1 step's own box: 20px x 1.2 = 24px, named, beside
  // the value it is derived from. Each column is measured separately and the
  // taller one sets the strip, rather than one count standing for both.
  const NAV_ITEM_PX = 24;   // --text-h1 (20px) x --text-h1--line-height (1.2)
  const NAV_GAP_PX = 16;
  const NAV_PAD_PX = 24;    // the one page gutter, top and bottom
  const columnHeight = (rows) => {
    if (rows.length === 0) return 0;
    const content = rows.reduce((h, r) => h + (r.separator ? 1 : NAV_ITEM_PX), 0);
    return content + (rows.length - 1) * NAV_GAP_PX + 2 * NAV_PAD_PX;
  };
  const getNavStripHeight = () => Math.max(
    columnHeight(getNavStripItems()),
    columnHeight(getResourcesNavItems()),
  );

  // Determine bar heights based on transition state
  const isCompressed = transitionState === 'compressing' || transitionState === 'title-hold';
  const isAnimating = transitionState !== 'idle';
  const contentFaded = transitionState !== 'idle' && transitionState !== 'fading-in';
  const isNavMenuVisible = hasNavMenu && showNavMenu && !isCompressed && transitionState !== 'expanding';

  const pageBars = PAGE_BARS[currentPage] || PAGE_BARS.home;
  const topHeight = isCompressed ? COMPRESSED.top : pageBars.top;
  const bottomHeight = isCompressed ? COMPRESSED.bottom : pageBars.bottom;

  // Render ALL pages simultaneously — hide inactive ones to preserve state
  const renderAllPages = () => (
    <>
      <PageSurface id="home" currentPage={currentPage}>
        <Home onNavigate={navigateTo} currentPage={currentPage} />
      </PageSurface>
      <PageSurface id="dog" currentPage={currentPage} overflow="hidden">
        <DeckOutlineGenerator
          onNavigate={navigateTo}
          currentPage={currentPage}
          zoomLevel={zoomLevel}
        />
      </PageSurface>
      <PageSurface id="otter" currentPage={currentPage} overflow="hidden">
        <Otter
          onNavigate={navigateTo}
          currentPage={currentPage}
          onContextChange={setOtterContext}
        />
      </PageSurface>
      <PageSurface id="rabbit" currentPage={currentPage} overflow="hidden">
        <Rabbit
          onNavigate={navigateTo}
          isActive={currentPage === 'rabbit'}
          currentPage={currentPage}
        />
      </PageSurface>
      <PageSurface id="settings" currentPage={currentPage}>
        <SettingsPageWithAgent
          petData={petData}
          onPetModeToggle={handlePetModeToggle}
          onDifficultyChange={handleDifficultyChange}
          onPetReset={handlePetReset}
          onNewPet={handleNewPet}
          // Phase 3: pressing Create Egg used to set an error into state whose
          // ONLY renderer is the companion chat panel — which is closed on
          // every page change. The page that hosts the button now reports its
          // own outcome, success as well as failure.
          newPetStatus={newPetStatus}
          newPetPending={newPetPending}
          // A3: the pet's cross-device notice on the page that describes the
          // pet. R1: this is the STICKY copy, not the toast's — they were one
          // state, so dismissing the toast erased the durable surface at the
          // same instant and the claim below it was false.
          petNotice={petNoticeSticky}
        />
      </PageSurface>
      <PageSurface id="project-manager" currentPage={currentPage}>
        <Projects onNavigate={navigateTo} />
      </PageSurface>
      <PageSurface id="rate-card" currentPage={currentPage}>
        <RateCardPage />
      </PageSurface>
      <PageSurface id="team-members" currentPage={currentPage}>
        <TeamMembersPage />
      </PageSurface>
      <PageSurface id="project-files" currentPage={currentPage} overflow="hidden">
        {currentPage === 'project-files' && <ProjectFilesExplorer />}
      </PageSurface>
      <PageSurface id="dashboard" currentPage={currentPage}>
        <DashboardPage />
      </PageSurface>
      <PageSurface id="admin-terminal" currentPage={currentPage}>
        <AdminTerminalPage />
      </PageSurface>
      <PageSurface id="help" currentPage={currentPage}>
        <HelpPage />
      </PageSurface>
    </>
  );

  // ── The one page header (F2; plan §4, review F32) ────────────────────────
  // This was FOUR blocks: three byte-identical tool headers differing only in
  // two strings, and an eight-way OR chain listing the pages that get the
  // plain header — a list a new page had to be added to by hand, and the
  // third of the three lists 'project-files' had to appear in. Both are the
  // registry's `chrome` field now.
  const renderTopBarContent = () => {
    if (page.chrome === 'none') return null; // Home — no bar content

    return (
      <PageHeader
        title={page.title}
        subtitle={page.subtitle}
        measure={page.measure}
        leading={page.chrome === 'tool' ? (
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt=""
            className="h-[43.1px] w-auto brightness-0 invert"
          />
        ) : null}
        actions={(
          <IconButton
            icon={Menu}
            title="Navigation"
            surface="chrome"
            aria-expanded={showNavMenu}
            onClick={() => setShowNavMenu(prev => !prev)}
          />
        )}
      />
    );
  };

  return (
    <AgentProvider>
    <RabbitProvider>
    {/* ONE toast stack for the whole app (plan §4: one anchor, one stack
        manager, replacing five systems in five screen positions). It lives
        here so a page never mounts a second one; F2's worked example is its
        first caller and the four tool systems fold in with their lanes.

        `bar` is the current page’s bottom-bar height, so the stack sits 24px
        above the BAR rather than 24px off the window (F4, D1b §7: two toasts
        straddled the light pages’ 80px bar). Same `PAGE_BARS` read the pet’s
        `petBottomOffset` takes, and the RESTING value rather than the
        compressed one, for the same reason the pet uses it — a toast must not
        slide during the page transition.

        `pinned` is R.A.B.B.I.T.'s UndoToast, the stack's LAST row (merge
        review round 2, A-R2-02): as a second fixed surface at bottom-centre
        it shared the stack's anchor — on the tool pages (8px bar) the first
        toast spanned 32–73px over its 24–74px — and a sticky pet notice
        painted over the Undo button and took its clicks. In the stack it sits
        below whatever push() has put up, with the stack's own gap, on the
        stack's layer. It still reads useRabbit() and stays the one instance;
        the note at the old mount point (bottom of this tree) says why it is
        mounted at app level at all. */}
    <ToastProvider bar={pageBars.bottom} pinned={<UndoToast />}>
    <div className="wilson-dark-scroll" style={{ height: '100vh', backgroundColor: '#ea580c', overflow: 'hidden' }}>
      <TitleBar />
      {/* Dev fixtures (2026-09-11): the DEV · fixtures badge, dev builds only —
          `import.meta.env.DEV` is a build-time constant, so `vite build` drops
          the element and the import with it. */}
      {import.meta.env.DEV && <DevFixturesBadge />}
      {/* B2 part 2: "Connection lost — reload to continue", fed by
          connectionWatchdog through the Supabase client's fetch. Above every
          overlay (`.connection-banner`, index.css); under the title bar in
          Electron through the kit's `--titlebar-offset`, so the window
          controls stay reachable. Rendered signed in or out — a hung sign-in
          is the same hang. */}
      <ConnectionLostBanner />
      {authed && (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Decision D6: a substituted model degrades loudly. Sits above the
              chrome so it is impossible to miss and does not time out. */}
          <ModelWarningBanner />

          {/* ===== TOP ORANGE BAR ===== */}
          <div className="wilson-chrome" style={{
            backgroundColor: '#ea580c',
            height: topHeight,
            flexShrink: 0,
            position: 'relative',
            display: 'flex',
            alignItems: 'flex-end',
            transition: `height 600ms ${EASE}`,
            overflow: 'hidden',
            zIndex: 10,
          }}>
            <div style={{
              width: '100%',
              display: 'flex',
              alignItems: 'flex-end',
              opacity: contentFaded ? 0 : 1,
              transition: 'opacity 250ms ease',
              // Same 250ms hole as the content area below — the hamburger was
              // live during 'fading-in' while navigateTo would still drop it.
              pointerEvents: isAnimating ? 'none' : 'auto',
            }}>
              {renderTopBarContent()}
            </div>
          </div>

          {/* ===== NAV STRIP — same orange, bottom edge = header edge ===== */}
          <div className="wilson-chrome" style={{
            backgroundColor: '#ea580c',
            overflow: 'hidden',
            height: isNavMenuVisible ? `${getNavStripHeight()}px` : '0px',
            transition: `height ${isAnimating ? '600ms' : '400ms'} ${EASE}`,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '48px',
            // ONE page gutter (plan §3.3). The strip was right-aligned at 48px
            // while the hamburger that opens it sits at 24px, so every item
            // slid out 24px short of the control that summoned it — the two
            // never lined up on any page.
            paddingRight: 'var(--spacing-gutter)',
            zIndex: 9,
          }}>
            {/* Resources sub-column — slides in from the left of the main strip */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '16px',
              maxWidth: navResourcesOpen ? '320px' : '0',
              opacity: navResourcesOpen ? 1 : 0,
              transform: navResourcesOpen ? 'translateX(0)' : 'translateX(-24px)',
              transition: 'max-width 300ms ease, opacity 250ms ease, transform 300ms ease',
              pointerEvents: navResourcesOpen ? 'auto' : 'none',
              overflow: 'hidden',
            }}>
              {getResourcesNavItems().map((item) => (
                <button
                  key={item.label}
                  onClick={item.action}
                  className="wilson-nav-item"
                  data-state={navState(`res:${item.label}`, false)}
                  style={{ whiteSpace: 'nowrap' }}
                  {...navStateProps(`res:${item.label}`)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Main nav strip column */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '16px',
            }}>
              {getNavStripItems().map((item, i) => {
                // The group break: a hairline in the frame's own ink, not a
                // control and not a heading — see getNavStripItems.
                if (item.separator) {
                  return (
                    <div
                      key={`sep-${i}`}
                      aria-hidden="true"
                      style={{ height: '1px', width: '96px', backgroundColor: 'rgba(28,25,23,0.35)' }}
                    />
                  );
                }
                const isTrigger = item.isResourcesTrigger;
                const dimmed = navResourcesOpen && !isTrigger;
                return (
                  <button
                    key={item.label}
                    onClick={() => {
                      if (isTrigger) {
                        setNavResourcesOpen(prev => !prev);
                        return;
                      }
                      if (navResourcesOpen) {
                        // First click just dismisses the resources column
                        setNavResourcesOpen(false);
                        return;
                      }
                      item.action();
                    }}
                    className="wilson-nav-item"
                    data-state={navState(`main:${item.label}`, dimmed)}
                    style={{ whiteSpace: 'nowrap' }}
                    {...navStateProps(`main:${item.label}`)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ===== Tool page border — the band under the bars, tools only ===== */}
          {isToolPage && !isAnimating && (
            <div style={{ height: '4px', backgroundColor: '#44403c', flexShrink: 0 }} />
          )}

          {/* ===== CONTENT AREA — the interface zone between the bars ===== */}
          <div style={{
            flex: 1,
            backgroundColor: isDarkPage ? '#1c1917' : '#f4a261',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            transition: `background-color 0ms linear ${isCompressed ? '0ms' : '300ms'}`,
          }}>
            {/* Transition title overlay — visible when bars are compressed */}
            {isAnimating && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f4a261',
                zIndex: 5,
                opacity: isCompressed ? 1 : 0,
                transition: `opacity 200ms ease`,
                pointerEvents: 'none',
              }}>
                <span style={{
                  // Session 43: was '#fff'. This overlay's own background is
                  // #f4a261, so the title has been white-on-light-orange at
                  // 2.06:1 on EVERY page transition in the app — the same
                  // defect the auth surfaces had, hiding in the one component
                  // that flashes past too quickly to read. #1c1917 is 8.49:1.
                  color: '#1c1917',
                  fontWeight: 'bold',
                  fontSize: '16.8px',
                  letterSpacing: '0.3em',
                  textTransform: 'uppercase',
                  opacity: transitionState === 'title-hold' ? 1 : 0,
                  transition: 'opacity 200ms ease',
                }}>
                  {transitionTitle}
                </span>
              </div>
            )}

            {/* Page content — fades during transitions, all pages rendered to preserve state */}
            <div style={{
              flex: 1,
              overflow: 'hidden',
              opacity: contentFaded ? 0 : 1,
              transition: 'opacity 250ms ease',
              // 🚨 `isAnimating`, not `contentFaded`. They differ for the
              // 250ms 'fading-in' step, and in that gap the content was
              // clickable while navigateTo still early-returns on
              // transitionRef — so a click was ACCEPTED AND SILENTLY DROPPED.
              // Pre-existing for page transitions; Session 43's welcome made
              // it reachable immediately after sign-in, which is how CI found
              // it (Playwright clicks the instant a target is actionable, and
              // that instant is precisely this window).
              // A blocked click retries; a swallowed one is just lost.
              pointerEvents: isAnimating ? 'none' : 'auto',
              // Plan §3.3: nothing in `vh`. This was `3vh 0` — 27px at 900px
              // tall and 21px at 700 — so the app's one vertical rhythm
              // changed with the window. A tool owns its whole field (0), and
              // Help paints its own two-column shell; every other page takes
              // the one 24px gutter.
              padding: (isToolPage || currentPage === 'help') ? 0 : 'var(--spacing-gutter) 0',
              display: 'flex',
              flexDirection: 'column',
            }}>
              {renderAllPages()}
            </div>
          </div>

          {/* ===== BOTTOM ORANGE BAR — constant container element ===== */}
          <div className="wilson-chrome" style={{
            backgroundColor: '#ea580c',
            height: bottomHeight,
            flexShrink: 0,
            transition: `height 600ms ${EASE}`,
            zIndex: 10,
          }} />

          {/* Click-away overlay to close nav menu */}
          {isNavMenuVisible && (
            <div
              onClick={() => setShowNavMenu(false)}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 8,
                cursor: 'default',
              }}
            />
          )}

          {/* ===== PET COMPANION OVERLAY — visible on ALL pages ===== */}
          {petData && (
            <PetCompanionWithAgent
              currentPage={currentPage}
              petData={petData}
              petSaveError={petSaveError}
              // R1 of A3: the cloud-only sentence is only TRUE for a save made
              // by a signed-in person. petSaveError multiplexes load, sync,
              // save and egg failures, so on a failed SYNC it said "this
              // change is not stored" when there was no change, and signed out
              // the pet genuinely is local.
              petIsCloudBacked={!!perms.userId}
              companionOpen={companionOpen}
              onCompanionToggle={setCompanionOpen}
              chatMessages={chatMessages}
              chatInput={chatInput}
              onChatInputChange={handleChatInputChange}
              onSendChat={sendChat}
              onClearChat={() => setChatMessages([])}
              chatLoading={chatLoading}
              chatThinking={chatThinking}
              feedbackJustRated={feedbackJustRated}
              thumbFlash={thumbFlash}
              onThumbRating={handleThumbRating}
              onFeed={handleFeed}
              onPetAction={handlePetAction}
              flashFeed={flashFeed}
              flashPet={flashPet}
              eggWobble={eggWobble}
              sleepZCycle={sleepZCycle}
              cloudVisible={cloudVisible}
              attentionJump={attentionJump}
              showHatchModal={showHatchModal}
              hatchNameInput={hatchNameInput}
              onHatchNameChange={setHatchNameInput}
              onHatchConfirm={handleHatchConfirm}
              isDarkPage={isDarkPage}
              onNavigateLink={handleCompanionNavLink}
              bottomOffset={petBottomOffset}
              petVisible={petVisible}
              aiUnavailable={!authed}
            />
          )}
        </div>
      )}

      {/* Auth overlay — company → username → password. Wait for the initial
          session check so returning users don't briefly see the login form. */}
      {showOverlay && sessionChecked && authMode === 'login' && (
        <LoginScreen
          notice={signedOutNotice}
          onForgotPassword={() => setAuthMode('forgot-password')}
          onAuthenticated={(session) => {
            handleAuth(session);
            handleAnimationComplete();
            setWelcomeQueued(true);
          }}
        />
      )}
      {showOverlay && sessionChecked && authMode === 'forgot-password' && (
        <ForgotPasswordWizard
          onBackToLogin={() => setAuthMode('login')}
        />
      )}
      {showOverlay && sessionChecked && authMode === 'recovery' && (
        <ResetPasswordWizard
          onDone={() => {
            // Clear the whole recovery URL so a reload won't re-enter the
            // wizard, then return to the login form. Session 18: `search` is
            // dropped too, not just the fragment — a token_hash link can carry
            // its token in the real query string, and keeping it would bounce
            // a reloading user into the wizard holding a spent token.
            try {
              window.history.replaceState(null, '', window.location.pathname)
            } catch { /* non-critical */ }
            setAuthMode('login')
          }}
        />
      )}

      {/* First-login profile capture. Shown on top of the authenticated app
          so the user sees the chrome animate in once (from LoginScreen) and
          then slides straight into the welcome wizard without blanking the
          screen. */}
      {authed && pendingOnboarding && (
        <NewUserWelcome
          membership={pendingOnboarding}
          onComplete={() => setPendingOnboarding(null)}
        />
      )}

      {/* Session 9: admin MFA enrollment gate (after onboarding clears).
          Deferral is per sign-in — it re-fires every login until enrolled. */}
      {authed && !pendingOnboarding && pendingMfaEnroll && (
        <MfaEnrollGate
          onComplete={() => setPendingMfaEnroll(false)}
          onDefer={() => setPendingMfaEnroll(false)}
        />
      )}

      {/* Session 9: login-time update prompt (never stacked on the gates). */}
      {authed && !pendingOnboarding && !pendingMfaEnroll && updateOffer && (
        <UpdatePrompt
          version={updateOffer.version}
          onDismiss={() => setUpdateOffer(null)}
        />
      )}

      {/* B2 part 2: "Still there?" at 25 idle minutes, "Session ending" five
          minutes before the 4-hour cap. Above the gates (a person mid-wizard
          is still a person about to be signed out), below the banner. The
          idle dialog is the kit Dialog lifted to 210 — above the quit dialog
          at 200 — and the cap notice rides the toast stack the ToastProvider
          above anchors over `pageBars.bottom` (merge review round 1,
          B-R1-02 / B-R1-03). */}
      {authed && (
        <SessionWarning
          phase={sessionTimeouts.phase}
          deadline={sessionTimeouts.deadline}
          onStay={sessionTimeouts.stay}
        />
      )}

      {/* Close confirmation dialog */}
      {showCloseDialog && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: BACKDROP,
        }}>
          {/* ROUND ONE, FINDING 3: "take the whole object or take none of
              it". The first pass converted ONE hex here — the Close button's
              fill — and left seven, including a `color: '#ea580c'` three
              lines above a `SIGNAL_FILL`, in a commit whose thesis was C8.
              Every value on this surface is a token now. Where a hex had an
              exact token it kept its value; the two that moved are named
              where they moved.

              The surface stays hand-rolled rather than becoming the kit's
              `Dialog` (the light shell's own box). Its controls are the
              kit's `Button`, which is a pure swap and is what fixes the
              contrast and the hovers below. S3c review round 1 (R1-11): C1
              is lifted for these sessions, so it is now a dialog to a screen
              reader (named by its heading, described by its words) and to
              the keyboard (the effect above: the overlay stack, Escape, Tab
              kept inside). */}
          <div
            ref={closeDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wilson-close-title"
            aria-describedby="wilson-close-words"
            style={{
            backgroundColor: PAPER,
            // §3.3: one 1px hairline. The frame keeps the signal — §3.2 gives
            // `signal` "the frame" as one of its four jobs — and loses the
            // second pixel, which is the only thing §3.3 objects to.
            border: `1px solid ${SIGNAL}`,
            borderRadius: `${RADIUS_FLOAT}px`,
            boxShadow: SHADOW_FLOAT,
            padding: '32px 36px 28px',
            // S3c step 7: three answers do not fit the confirm width (they
            // overflowed its frame); folded, the question takes the form's.
            maxWidth: `${closeUnsaved.length ? DIALOG.form : DIALOG.confirm}px`,
            width: '90%',
            textAlign: 'center',
          }}>
            {/* The dialog title is the H2 step (§3.1): 16 / 1.3 / 600 /
                sentence / no tracking, in the app's sans. It was 16px BOLD
                UPPERCASE at +0.15em in `monospace` — four emphasis mechanisms
                on one four-word heading, and the only `monospace` left in
                this file. The SIZE is unchanged; the leading is not, because
                it was unset and inheriting Tailwind preflight's 1.5. */}
            <h2 id="wilson-close-title" style={{
              color: SIGNAL,
              fontSize: `${TYPE.h2}px`,
              lineHeight: LEADING.h2,
              fontWeight: WEIGHT.h2,
              marginBottom: '12px',
            }}>Close WILSON</h2>
            {/* `#a8a29e` was one of the four inks §3.2 retires across 1,277
                uses; `ink-2` is its replacement and reads 8.49:1 here. */}
            <p id="wilson-close-words" style={{
              color: INK_2,
              fontSize: `${TYPE.dense}px`,
              lineHeight: LEADING.dense,
              marginBottom: '24px',
            }}>
              {/* Post-overhaul S3c, step 7: an unsaved edit says so here, in
                  this one question (D12) — what it is, of which list; of
                  several, "them" (review round 1, R1-12). */}
              {closeUnsaved.length
                ? `${closeUnsaved.map((g) => g.describe()).join(' ')} ${closeCount > 1 ? 'Save them before closing, or discard them.' : 'Save it before closing, or discard it.'}`
                : 'Make sure you have exported your work before closing.'}
            </p>
            {closeError && (
              <p role="alert" style={{
                color: DANGER,
                fontSize: `${TYPE.dense}px`,
                lineHeight: LEADING.dense,
                marginBottom: '16px',
              }}>
                {closeError}
              </p>
            )}
            {/* 🚨 ROUND ONE, FINDING 1, AND IT IS THE ONE THAT MATTERED. The
                first pass fixed the Close button's 3.56:1 white-on-`#ea580c`
                and left CANCEL beside it at `#a8a29e` on `#44403c` — 4.07:1
                resting and **3.03:1 on hover**, both under the 4.5 §3.2 says
                "does not ship", and both WORSE than the defect that was
                fixed. It then reported the surface as clean. The hover half
                is precisely D2's kit request K8, which the kit had already
                fixed for light ghost buttons ("a light ghost button turned
                2.10:1 at the exact moment the pointer reached it").

                Both controls are the kit's `Button` now, which is why this is
                a deletion rather than a repair: the secondary variant is
                transparent with a hairline and the full ink (15.45:1, and
                its hover is `--color-hover`, an overlay that cannot drop the
                ink), the primary is `signal-fill` with white (5.18:1). The
                type, the 3px control radius and BOTH hover states come from
                `.ui-btn[data-variant]` in CSS.

                That also settles the protocol's state-extraction step, which
                round one correctly called a violation: the four
                `onMouseEnter`/`onMouseLeave` handlers that wrote
                `e.currentTarget.style.backgroundColor` are gone, and an
                inline style can no longer beat a hover rule because there is
                no inline style left to do it. */}
            {/* With an unsaved edit, D12's three answers, Keep editing first
                and focused — and Escape (R1-11). Without one, Cancel first and
                focused, as every question's staying answer is. */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <Button
                variant="secondary"
                autoFocus
                disabled={closeBusy}
                onClick={() => setShowCloseDialog(false)}
                style={{ flex: 1 }}
              >
                {closeUnsaved.length ? 'Keep editing' : 'Cancel'}
              </Button>
              {closeUnsaved.length > 0 && (
                <Button
                  variant="danger"
                  disabled={closeBusy}
                  onClick={() => closeAfter('discard')}
                  style={{ flex: 1 }}
                >
                  Discard and close
                </Button>
              )}
              <Button
                variant="primary"
                loading={closeBusy}
                onClick={() => (closeUnsaved.length ? closeAfter('save') : closeNow())}
                style={{ flex: 1 }}
              >
                {closeUnsaved.length ? 'Save edit and close' : 'Close'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
    {/* ── Undo toast (soft-delete forgiveness window) ──
        Mounted at app level, not inside the RABBIT shell, because
        deletes can fire from pages (e.g. ProjectsPage) where the
        Rabbit page div is display:none; reads useRabbit() — must stay
        the single instance. Since merge review round 2 (A-R2-02) it is
        the toast stack's PINNED row — the `pinned` prop of the ToastProvider
        at the top of this tree — rather than a second fixed surface here. */}
    {/* ── A3: the pet's notices, mounted OUTSIDE `{petData && …}` ──
        The stale-copy refresh from migration 0068, and a failed pet LOAD —
        which had nowhere to show itself at all, because the failure unmounts
        the only thing that rendered it. */}
    <PetNotice notice={petNotice} onDismiss={dismissPetNotice} />
    </ToastProvider>
    {/* Post-overhaul S3c, step 7 (D12): the one question every exit asks
        while an edit is unsaved — any page can ask it (navigateTo). */}
    <LeaveEditDialog />
    </RabbitProvider>
    </AgentProvider>
  );
}
