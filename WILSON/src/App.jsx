import { useState, useCallback, useRef, useEffect } from 'react'
import { Menu } from 'lucide-react'
import TitleBar from './components/TitleBar'
import LoginScreen from './cloud/auth/LoginScreen'
import ForgotPasswordWizard from './cloud/auth/ForgotPasswordWizard'
import ResetPasswordWizard from './cloud/auth/ResetPasswordWizard'
import { looksLikeRecoveryLink } from './cloud/auth/recoveryLink'
import NewCompanyWizard from './cloud/onboarding/NewCompanyWizard'
import NewUserWelcome from './cloud/onboarding/NewUserWelcome'
import { loadSession, clearSession } from './cloud/auth/sessionStorage'
import { hydrateSupabase, supabase } from './cloud/auth/supabaseClient'
import { fetchWorkspaceStorage } from './cloud/workspaceStorage'
import { callAI, isRetryableAIError } from './cloud/aiProxy'
import { textFromMessage } from './cloud/anthropicStream'
import { modelFor } from './lib/activeModel'
import { loadModelSources, migrateLegacyUserModelPrefs } from './lib/modelSources'
import { loadPet, savePetData, newPetEgg, loadOtterSettings, saveOtterSettings } from './lib/localData'
import { resolveUserPet, saveCloudPet, mirrorPetToCache,
         resolveUserSettings, mirrorSettingsToCache, setUserStateOwner } from './lib/userState'
import Home from './components/Home'
import SettingsPage from './components/SettingsPage'
import Projects from './components/Projects'
import RateCardPage from './components/RateCard'
import TeamMembersPage from './components/TeamMembers/TeamMembersPage'
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
import { RabbitProvider } from './tools/rabbit_v0.1.0/state/RabbitProvider'
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

const PAGE_TITLES = {
  home: 'HOME',
  dog: 'D.O.G.',
  otter: 'O.T.T.E.R.',
  rabbit: 'R.A.B.B.I.T.',
  settings: 'SYSTEM SETTINGS',
  'project-manager': 'PROJECTS',
  'rate-card': 'RATE CARD',
  'team-members': 'TEAM MEMBERS',
  dashboard: 'DASHBOARD',
  'admin-terminal': 'ADMIN TERMINAL',
  help: 'HELP',
};

// Bar height configs per page (top, bottom in CSS values)
// Content area fills whatever space remains between the bars
const PAGE_BARS = {
  home:               { top: '268px', bottom: '268px' },
  dog:                { top: '95px', bottom: '8px' },
  otter:              { top: '95px', bottom: '8px' },
  rabbit:             { top: '95px', bottom: '8px' },
  settings:           { top: '200px', bottom: '150px' },
  'project-manager':  { top: '200px', bottom: '150px' },
  'rate-card':        { top: '200px', bottom: '150px' },
  'team-members':     { top: '200px', bottom: '150px' },
  dashboard:          { top: '200px', bottom: '150px' },
  'admin-terminal':   { top: '200px', bottom: '150px' },
  help:               { top: '140px', bottom: '100px' },
};

const COMPRESSED = { top: 'calc(50vh - 20px)', bottom: 'calc(50vh - 20px)' };

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
    const session = await hydrateSupabase(saved);
    return session ?? null;
  } catch { return null; }
}

const EASE = 'cubic-bezier(0.4,0,0.2,1)';

// ═══════════════════════════════════════════════════════════════════
//  PET CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const DECAY_RATES = {
  low:    { hunger: 0.4,  happiness: 0.25 },
  medium: { hunger: 0.67, happiness: 0.5  },
  high:   { hunger: 1.2,  happiness: 1.0  }
};
const EVOLVE_TIMES = { low: 30 * 60000, medium: 20 * 60000, high: 10 * 60000 };
const SLEEP_DURATIONS = { low: 3 * 60000, medium: 2 * 60000, high: 1 * 60000 };

function derivePetState(pet) {
  if (!pet) return 'content';
  if (pet.form === 'corpse' || pet.form === 'ghost') return 'dead';
  if (pet.sleepingSince) return 'sleeping';
  if (pet.hunger <= 15) return 'starving';
  if (pet.hunger <= 40) return 'hungry';
  if (pet.happiness <= 30) return 'lonely';
  return 'content';
}

/**
 * Bring a stored pet up to date from elapsed time. Pure — returns a new object.
 *
 * 🚨 THIS IS WHY DECAY IS NOT PERSISTED ON A TIMER (S31). hunger and happiness
 * are a value AT AN ANCHOR (`lastUpdatedAt`), not raw state, so a pet that has
 * not been touched for a week needs no writes at all — the anchor stays put and
 * this recomputes the difference on the next read. Removing the 30-second
 * whole-object auto-save is what stops two signed-in computers overwriting each
 * other; this function is the half that makes that safe.
 *
 * ⚠️ The decay anchor is `lastUpdatedAt`, NOT `lastFedAt`. The plan documents
 * said to anchor on last_fed_at; MEASURED 2026-08-05, `lastFedAt` is written by
 * handleFeed and read by NOTHING anywhere in src/ or electron/.
 *
 * It was previously inline in the mount effect, and the live 30s tick applies a
 * different, fuller algorithm (sleep-end, evolution, corpse→ghost). They still
 * differ; this is the cold-start one, extracted so the local and cloud load
 * paths cannot drift apart.
 */
/**
 * The fields whose change MUST reach storage. Everything else is either
 * recomputable from the anchor (hunger, happiness, state) or already saved by
 * the handler that changed it (name, difficulty, petMode, feedback, counts).
 *
 * This is what replaced the 30-second whole-object auto-save: the four
 * transitions a timer used to be needed for — falling asleep, waking, evolving,
 * dying — persist when they happen and at no other time.
 */
function petMaterialSignature(pet) {
  if (!pet) return null;
  return [pet.form, pet.sleepingSince || '', pet.evolvedAt || '', pet.diedAt || ''].join('|');
}

function applyOfflineDecay(input) {
  const pet = { ...input };
  if (pet.lastUpdatedAt && pet.form !== 'egg' && pet.form !== 'corpse' && pet.form !== 'ghost') {
    const elapsed = (Date.now() - new Date(pet.lastUpdatedAt).getTime()) / 60000;
    if (elapsed > 0 && !pet.sleepingSince) {
      const rates = DECAY_RATES[pet.difficulty] || DECAY_RATES.medium;
      const babyMult = pet.form === 'baby' ? 2 : 1;
      pet.hunger = Math.max(0, pet.hunger - elapsed * rates.hunger * babyMult);
      pet.happiness = Math.max(0, pet.happiness - elapsed * rates.happiness * babyMult);
    }
    if (pet.hunger <= 0) {
      pet.form = 'ghost';
      pet.diedAt = pet.diedAt || new Date().toISOString();
      pet.hunger = 0;
    }
  }
  if (pet.form !== 'egg' && !pet.breed) pet.breed = 'otter';
  pet.state = derivePetState(pet);
  return pet;
}

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [sessionChecked, setSessionChecked] = useState(false);
  // 'login' (default) | 'new-company' | 'forgot-password' | 'recovery'
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
  const [prefilledUsername, setPrefilledUsername] = useState('');
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

  // Triggers to open tool settings panels from nav strip
  const [openSettingsTrigger, setOpenSettingsTrigger] = useState(0);
  const [openOtterSettingsTrigger, setOpenOtterSettingsTrigger] = useState(0);
  const [openRabbitSettingsTrigger, setOpenRabbitSettingsTrigger] = useState(0);

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
    checkSessionValid().then(session => {
      if (session) {
        setAuthed(true);
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
  const handleAuth = useCallback(() => {
    setAuthed(true);
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
  // ⚠️ The same unscoped call still exists in ResetPasswordWizard; it is left
  // alone here because changing what a password reset revokes is a security
  // decision, not a tidy-up. Recorded in docs/OUTSTANDING.md.
  useEffect(() => {
    window.wilsonSignOut = async () => {
      try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* swallow */ }
      await clearSession();
      // 🚨 Belt and braces with the perms.userId teardown effect: this runs
      // even if the permissions channel is slow to notice, so the next person
      // at this computer cannot see the previous person's pet for a beat.
      setPetData(null);
      petUserIdRef.current = null;
      petPersistedSigRef.current = null;
      setAuthed(false);
      setShowOverlay(true);
    };
    return () => { delete window.wilsonSignOut; };
  }, []);

  const handleAnimationComplete = () => {
    setShowOverlay(false);
  };

  // Close confirmation dialog (Electron only)
  const [showCloseDialog, setShowCloseDialog] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.onCloseRequested) return;
    const cleanup = window.electronAPI.onCloseRequested(() => {
      setShowCloseDialog(true);
    });
    return cleanup;
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
  const petSavingRef = useRef(false);
  const petPendingRef = useRef(null);
  const [petSaveError, setPetSaveError] = useState(null);
  // S31: who the pet belongs to, in a ref so savePet's identity stays stable.
  // null when signed out, which is what routes a save to the per-device cache.
  const petUserIdRef = useRef(null);
  // S31: the last material signature actually written. Primed by both load
  // paths so that LOADING a pet never counts as a change to persist.
  const petPersistedSigRef = useRef(null);
  const petTimerRef = useRef(null);
  // (S31: petSaveTimerRef is gone with the 30-second auto-save it armed.)

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
  const savePet = useCallback(async (data) => {
    if (!data) return;
    // A save is already in flight: remember the NEWEST state and flush it when
    // that one lands. The old guard was `if (petSaving) return`, which DROPPED
    // the update — so a decay tick colliding with a slow write was discarded,
    // silently, and the pet aged backwards on the next load.
    if (petSavingRef.current) { petPendingRef.current = data; return; }
    petSavingRef.current = true;
    try {
      const next = { ...data, lastUpdatedAt: new Date().toISOString() };
      // 🚨 S31: the destination is "is there a signed-in user", NOT "is this
      // Electron". `hasLocalServer()` (window.electronAPI) is true for the
      // DESKTOP APP IN CLOUD MODE too, so branching on it would pin every
      // signed-in desktop user to the per-device file forever — the standing
      // rule, and the same predicate that empties the O.T.T.E.R. library.
      //
      // Read from a ref rather than a dependency so savePet keeps a stable
      // identity: it sits in the decay/auto-save effects' dependency lists, and
      // S30 moved petSaving to a ref for exactly this reason.
      if (petUserIdRef.current) {
        await saveCloudPet(next);
        // The cache is a mirror, never the authority. It must not be able to
        // report failure for a cloud write that succeeded.
        await mirrorPetToCache(next);
      } else {
        await savePetData(next);
      }
      setPetSaveError(null);
    } catch (err) {
      setPetSaveError(err?.message || 'Your pet could not be saved.');
    } finally {
      petSavingRef.current = false;
      const pending = petPendingRef.current;
      petPendingRef.current = null;
      if (pending) savePet(pending);
    }
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
        const stored = await loadPet();
        if (!mounted) return;
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
    petUserIdRef.current = userId;
    // The settings writers live in other components and must know too.
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
    if (!userId) { setPetData(null); return; }

    let cancelled = false;
    (async () => {
      try {
        const { pet, adopted } = await resolveUserPet();
        if (cancelled || !pet) return;
        const fresh = applyOfflineDecay(pet);
        petPersistedSigRef.current = petMaterialSignature(fresh);
        setPetData(fresh);
        setPetSaveError(null);
        if (adopted) await mirrorPetToCache(fresh);

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
          setPetSaveError(err?.message || 'Your pet could not be synced from your account.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [perms.ready, perms.userId]);

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
        if (!prev.petMode) return prev;

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
          }, 10000);
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
      const next = { ...prev, hunger: Math.min(100, prev.hunger + 25), lastFedAt: new Date().toISOString(), interactionCount: prev.interactionCount + 1 };
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
          const next = { ...prev, sleepingSince: null, lastSleptAt: new Date().toISOString(), interactionCount: 0 };
          next.state = derivePetState(next);
          savePet(next);
          return next;
        });
        return;
      }
      setPetData(prev => {
        if (!prev) return prev;
        const next = { ...prev, happiness: Math.min(100, prev.happiness + 20), lastPettedAt: new Date().toISOString(), interactionCount: prev.interactionCount + 1 };
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
      const entry = {
        timestamp: new Date().toISOString(),
        userMsg: lastUser?.content || '',
        botResponse: lastAssistant.content || '',
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
    context += `\nAVAILABLE PAGES: Home, D.O.G. (Deck Outline Generator), O.T.T.E.R. (Learning Platform), R.A.B.B.I.T. (Resource Allocation, Budgeting & Breakdown Intake Tool), System Settings, Projects, Rate Card, Help`;

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
      context += `\nCommon flows: import a script → Intake Wizard. Switch projects → project picker in the RABBIT header. Set day rates → Rate Card page. Mark a task done → inline-edit its status on the Project Assets tab. Change adapter or default currency → System Settings → RABBIT tab.`;
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

  // Enter key toggles companion (when not editing text)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      const editable = document.activeElement?.isContentEditable;
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable;
      if (e.key === 'Enter' && !e.defaultPrevented && !isEditing && petData && !showOverlay) {
        e.preventDefault();
        setCompanionOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [petData, showOverlay]);

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
  const handlePetModeToggle = useCallback((enabled) => {
    setPetData(prev => {
      if (!prev) return prev;
      const next = { ...prev, petMode: enabled };
      next.state = derivePetState(next);
      savePet(next);
      return next;
    });
  }, [savePet]);

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
  // quiet. newPetEgg writes to the per-device store; the new egg is then
  // promoted to the account by savePet, so the pet a person starts after a
  // death follows them like any other.
  const handleNewPet = useCallback(async () => {
    try {
      const pet = await newPetEgg();
      if (pet?.error) throw new Error(pet.error);
      setPetData(pet);
      setChatMessages([]);
      petPersistedSigRef.current = petMaterialSignature(pet);
      await savePet(pet);
    } catch (err) {
      setPetSaveError(err?.message || 'A new egg could not be created.');
    }
  }, [savePet]);

  // Transition: fade-out(250ms) → compress(600ms) → title-hold(400ms) → [swap] → expand(600ms) → fade-in(250ms) → idle
  // fromHistory: true when the browser back/forward button initiated the
  // navigation — the URL is already right, so don't push a new entry.
  const navigateTo = useCallback((targetPage, fromHistory = false) => {
    if (transitionRef.current || targetPage === currentPage) return;
    transitionRef.current = true;

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
            }, 250);
          }, 600);
        }, 400);
      }, 600);
    }, 250);
  }, [currentPage]);

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

  // Page flags
  const isDog = currentPage === 'dog';
  const isOtter = currentPage === 'otter';
  const isRabbit = currentPage === 'rabbit';
  const isHome = currentPage === 'home';
  const isDarkPage = isDog || isOtter || isRabbit;
  const hasNavMenu = !isHome; // All non-home pages get a hamburger + nav strip

  // Bottom offset for pet sprite — positions it above the bottom bar
  const BOTTOM_BAR_PX = { home: 268, dog: 8, otter: 8, rabbit: 8, settings: 150, 'project-manager': 150, 'rate-card': 150, 'team-members': 150, dashboard: 150, 'admin-terminal': 150, help: 100 };
  const petBottomOffset = (BOTTOM_BAR_PX[currentPage] || 8) + 16;

  // Close the resources sub-column when the nav menu closes or page changes
  useEffect(() => {
    if (!showNavMenu) setNavResourcesOpen(false);
  }, [showNavMenu]);
  useEffect(() => {
    setNavResourcesOpen(false);
  }, [currentPage]);

  const closeNavAndGo = (page) => { setShowNavMenu(false); setNavResourcesOpen(false); navigateTo(page); };
  const closeNavAndTrigger = (setter) => { setShowNavMenu(false); setNavResourcesOpen(false); setter(prev => prev + 1); };

  // Main nav strip: always includes HOME + tools + RESOURCES trigger + SYSTEM SETTINGS
  // (context-aware: omits whichever page the user is currently on)
  const getNavStripItems = () => {
    const items = [];
    items.push({ label: 'HOME', action: () => closeNavAndGo('home') });

    if (currentPage !== 'dog')    items.push({ label: 'D.O.G.',    action: () => closeNavAndGo('dog') });
    if (currentPage !== 'otter')  items.push({ label: 'O.T.T.E.R.',  action: () => closeNavAndGo('otter') });
    if (currentPage !== 'rabbit') items.push({ label: 'R.A.B.B.I.T.', action: () => closeNavAndGo('rabbit') });
    if (currentPage !== 'dashboard') items.push({ label: 'DASHBOARD', action: () => closeNavAndGo('dashboard') });

    // Page-specific SETTINGS for tool pages
    if (isDog)    items.push({ label: 'SETTINGS', action: () => closeNavAndTrigger(setOpenSettingsTrigger) });
    if (isOtter)  items.push({ label: 'SETTINGS', action: () => closeNavAndTrigger(setOpenOtterSettingsTrigger) });
    if (isRabbit) items.push({ label: 'SETTINGS', action: () => closeNavAndTrigger(setOpenRabbitSettingsTrigger) });

    // RESOURCES trigger (toggles sub-column; no direct navigation)
    items.push({ label: 'RESOURCES', isResourcesTrigger: true });

    // SYSTEM SETTINGS (hide when already on Settings)
    if (currentPage !== 'settings') {
      items.push({ label: 'SYSTEM SETTINGS', action: () => closeNavAndGo('settings') });
    }

    return items;
  };

  // Sub-column items shown when RESOURCES is expanded
  const getResourcesNavItems = () => {
    const all = [
      { id: 'project-manager', label: 'PROJECTS' },
      { id: 'rate-card',       label: 'RATE CARD' },
      { id: 'team-members',    label: 'TEAM MEMBERS' },
      // Session 9: admin-only surface — filtered from the ARRAY (not hidden
      // per-button) so keyboard/mouse share one list.
      ...(perms.role === 'admin' ? [{ id: 'admin-terminal', label: 'ADMIN TERMINAL' }] : []),
      { id: 'help',            label: 'HELP' },
    ];
    return all
      .filter(i => i.id !== currentPage)
      .map(i => ({ label: i.label, action: () => closeNavAndGo(i.id) }));
  };

  const getNavStripHeight = () => {
    const mainCount = getNavStripItems().length;
    const resCount = getResourcesNavItems().length;
    const count = Math.max(mainCount, resCount);
    return count * 24 + (count - 1) * 16 + 48;
  };

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
      <div className="wilson-light-scroll" style={{ display: currentPage === 'home' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'auto' }}>
        <Home onNavigate={navigateTo} currentPage={currentPage} />
      </div>
      <div style={{ display: currentPage === 'dog' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
        <DeckOutlineGenerator
          onNavigate={navigateTo}
          showNavMenu={showNavMenu}
          onToggleNavMenu={() => setShowNavMenu(prev => !prev)}
          openSettingsTrigger={openSettingsTrigger}
          zoomLevel={zoomLevel}
        />
      </div>
      <div style={{ display: currentPage === 'otter' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
        <Otter
          onNavigate={navigateTo}
          currentPage={currentPage}
          openSettingsTrigger={openOtterSettingsTrigger}
          onContextChange={setOtterContext}
        />
      </div>
      <div style={{ display: currentPage === 'rabbit' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
        <Rabbit
          onNavigate={navigateTo}
          isActive={currentPage === 'rabbit'}
          currentPage={currentPage}
          openSettingsTrigger={openRabbitSettingsTrigger}
        />
      </div>
      <div className="wilson-light-scroll" style={{ display: currentPage === 'settings' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'auto' }}>
        <SettingsPageWithAgent
          petData={petData}
          onPetModeToggle={handlePetModeToggle}
          onDifficultyChange={handleDifficultyChange}
          onPetReset={handlePetReset}
          onNewPet={handleNewPet}
        />
      </div>
      <div className="wilson-light-scroll" style={{ display: currentPage === 'project-manager' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'auto' }}>
        <Projects onNavigate={navigateTo} />
      </div>
      <div className="wilson-light-scroll" style={{ display: currentPage === 'rate-card' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'auto' }}>
        <RateCardPage />
      </div>
      <div className="wilson-light-scroll" style={{ display: currentPage === 'team-members' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'auto' }}>
        <TeamMembersPage />
      </div>
      <div className="wilson-light-scroll" style={{ display: currentPage === 'dashboard' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'auto' }}>
        <DashboardPage />
      </div>
      <div className="wilson-light-scroll" style={{ display: currentPage === 'admin-terminal' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'auto' }}>
        <AdminTerminalPage />
      </div>
      <div className="wilson-light-scroll" style={{ display: currentPage === 'help' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'auto' }}>
        <HelpPage />
      </div>
    </>
  );

  // What to show in the top bar
  const renderTopBarContent = () => {
    if (isDog) {
      return (
        <div className="flex items-center justify-between w-full h-full px-4 pb-3">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Logo" className="h-[43.1px] w-auto brightness-0 invert" />
            <div>
              <h1 className="text-[24px] font-bold tracking-tight uppercase leading-tight text-white">D.O.G.</h1>
              <p className="text-orange-200 text-xs tracking-wide">Deck Outline Generator</p>
            </div>
          </div>
          <button
            onClick={() => setShowNavMenu(prev => !prev)}
            className="p-2 hover:bg-orange-700 rounded-sm transition-colors text-white"
            title="Navigation"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>
      );
    }

    if (isOtter) {
      return (
        <div className="flex items-center justify-between w-full h-full px-4 pb-3">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Logo" className="h-[43.1px] w-auto brightness-0 invert" />
            <div>
              <h1 className="text-[24px] font-bold tracking-tight uppercase leading-tight text-white">O.T.T.E.R.</h1>
              <p className="text-orange-200 text-xs tracking-wide">On-demand Training & Technical Education Resource</p>
            </div>
          </div>
          <button
            onClick={() => setShowNavMenu(prev => !prev)}
            className="p-2 hover:bg-orange-700 rounded-sm transition-colors text-white"
            title="Navigation"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>
      );
    }

    if (isRabbit) {
      return (
        <div className="flex items-center justify-between w-full h-full px-4 pb-3">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Logo" className="h-[43.1px] w-auto brightness-0 invert" />
            <div>
              <h1 className="text-[24px] font-bold tracking-tight uppercase leading-tight text-white">R.A.B.B.I.T.</h1>
              <p className="text-orange-200 text-xs tracking-wide">Resource Allocation, Budgeting & Breakdown Intake Tool</p>
            </div>
          </div>
          <button
            onClick={() => setShowNavMenu(prev => !prev)}
            className="p-2 hover:bg-orange-700 rounded-sm transition-colors text-white"
            title="Navigation"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>
      );
    }

    if (currentPage === 'settings' || currentPage === 'project-manager' || currentPage === 'rate-card' || currentPage === 'team-members' || currentPage === 'dashboard' || currentPage === 'admin-terminal' || currentPage === 'help') {
      const pageLabel = PAGE_TITLES[currentPage] || currentPage;
      return (
        <div className="flex items-center justify-between w-full px-6" style={{ paddingBottom: '12px' }}>
          <h1 className="text-[20px] font-bold tracking-tight uppercase text-white">{pageLabel}</h1>
          <button
            onClick={() => setShowNavMenu(prev => !prev)}
            className="p-2 hover:bg-orange-700 rounded-sm transition-colors text-white"
            title="Navigation"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>
      );
    }

    return null; // Home page — no bar content
  };

  return (
    <AgentProvider>
    <RabbitProvider>
    <div style={{ height: '100vh', backgroundColor: '#ea580c', overflow: 'hidden' }}>
      <TitleBar />
      {authed && (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Decision D6: a substituted model degrades loudly. Sits above the
              chrome so it is impossible to miss and does not time out. */}
          <ModelWarningBanner />

          {/* ===== TOP ORANGE BAR ===== */}
          <div style={{
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
              pointerEvents: contentFaded ? 'none' : 'auto',
            }}>
              {renderTopBarContent()}
            </div>
          </div>

          {/* ===== NAV STRIP — same orange, bottom edge = header edge ===== */}
          <div style={{
            backgroundColor: '#ea580c',
            overflow: 'hidden',
            height: isNavMenuVisible ? `${getNavStripHeight()}px` : '0px',
            transition: `height ${isAnimating ? '600ms' : '400ms'} ${EASE}`,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '48px',
            paddingRight: '48px',
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
                  className="text-white font-bold uppercase tracking-[0.2em] transition-opacity hover:opacity-70"
                  style={{ fontSize: '16px', whiteSpace: 'nowrap' }}
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
              {getNavStripItems().map((item) => {
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
                    className="font-bold uppercase tracking-[0.2em] transition-opacity hover:opacity-70"
                    style={{
                      fontSize: '16px',
                      whiteSpace: 'nowrap',
                      color: '#fff',
                      opacity: dimmed ? 0.35 : 1,
                      transition: 'opacity 200ms ease',
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ===== Dark page border — when on DOG or OTTER page and idle ===== */}
          {isDarkPage && !isAnimating && (
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
                  color: '#fff',
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
              pointerEvents: contentFaded ? 'none' : 'auto',
              padding: (isDarkPage || currentPage === 'help') ? 0 : '3vh 0',
              display: 'flex',
              flexDirection: 'column',
            }}>
              {renderAllPages()}
            </div>
          </div>

          {/* ===== BOTTOM ORANGE BAR — constant container element ===== */}
          <div style={{
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

      {/* Auth overlay — Supabase username → password. Wait for the initial
          session check so returning users don't briefly see the login form.
          The "new company?" link on LoginScreen flips authMode to 'new-company'
          which mounts NewCompanyWizard in the same slot; on success the wizard
          hands back the username so LoginScreen reopens pre-filled. */}
      {showOverlay && sessionChecked && authMode === 'login' && (
        <LoginScreen
          prefilledUsername={prefilledUsername}
          onCreateCompany={() => setAuthMode('new-company')}
          onForgotPassword={() => setAuthMode('forgot-password')}
          onAuthenticated={() => {
            handleAuth();
            handleAnimationComplete();
          }}
        />
      )}
      {showOverlay && sessionChecked && authMode === 'new-company' && (
        <NewCompanyWizard
          onCancel={() => setAuthMode('login')}
          onProvisioned={(payload) => {
            setPrefilledUsername(payload?.username ?? '')
            setAuthMode('login')
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

      {/* Close confirmation dialog */}
      {showCloseDialog && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.6)',
        }}>
          <div style={{
            backgroundColor: '#1c1917',
            border: '2px solid #ea580c',
            borderRadius: '6px',
            padding: '32px 36px 28px',
            maxWidth: '400px',
            width: '90%',
            textAlign: 'center',
          }}>
            <h2 style={{
              color: '#ea580c',
              fontSize: '16px',
              fontWeight: 'bold',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              marginBottom: '12px',
              fontFamily: 'monospace',
            }}>Close WILSON</h2>
            <p style={{
              color: '#a8a29e',
              fontSize: '13px',
              lineHeight: '1.5',
              marginBottom: '24px',
            }}>
              Make sure you have exported your work before closing.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={() => setShowCloseDialog(false)}
                style={{
                  flex: 1,
                  padding: '10px 20px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  backgroundColor: '#44403c',
                  color: '#a8a29e',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#57534e'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#44403c'; }}
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowCloseDialog(false); window.electronAPI?.forceClose(); }}
                style={{
                  flex: 1,
                  padding: '10px 20px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  backgroundColor: '#ea580c',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#c2410c'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#ea580c'; }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    {/* ── Undo toast (soft-delete forgiveness window) ──
        Mounted at app level, not inside the RABBIT shell, because
        deletes can fire from pages (e.g. ProjectsPage) where the
        Rabbit page div is display:none. position:fixed, reads
        useRabbit() — must stay the single instance. */}
    <UndoToast />
    </RabbitProvider>
    </AgentProvider>
  );
}
