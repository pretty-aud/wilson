// ============================================================
// RABBIT v0.1 — RabbitProvider (state layer + adapter glue)
// ============================================================
//
// Owns:
//   • adapterMode + adapterStatus (Supabase | Local Server | Drive)
//   • activeProjectId + the loaded bundle for that project
//   • optimistic CRUD with rollback on adapter error
//   • selectors (memoized wrappers around state/selectors.js)
//   • intake run lifecycle (start / accept / discard)
//
// Mounted once near the top of App.jsx and stays mounted across
// navigation (all-pages-rendered pattern). The provider does NOT
// render any UI — Session 3 builds the views that consume it.
//
// Persistence of adapter mode / active project lives in the
// existing /api/otter-settings file under a new top-level
// `rabbit` key. Adding a new endpoint would mean a separate
// settings file in a separate folder, which is exactly what
// the prompt asks us to avoid (the WILSON-wide settings home
// is otter-data/otter-settings.json).

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { selectAdapter, ADAPTER_MODES } from '../adapters';
import { resetSupabaseAdapter } from '../adapters/supabaseAdapter';
import { supabase as sharedAuthedClient } from '../../../cloud/auth/supabaseClient';
import { runIngestion } from '../intake/pipeline';
import {
  selectAssetsByPhase,
  selectTasksByAsset,
  selectProjectBudgetRollup,
  selectAssetDerivedStatus,
  selectAssetStatusWarning,
  selectCriticalPath,
  selectVarianceForAsset,
  selectVarianceForProject,
} from './selectors';
import { applyRealtimeEvent, isStaleIncoming } from './realtimeMerge';
import { buildRevertPlan } from '../components/editHistoryRevert';
import { hasLocalServer, loadOtterSettings, saveOtterSettings } from '../../../lib/localData';

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_ADAPTER_MODE = 'local_server';

const RabbitContext = createContext(null);

// ─── Settings persistence (otter-settings via localData: Express in
//     Electron, localStorage on the web — Session 12) ─────────────
async function loadRabbitSettings() {
  try {
    const data = await loadOtterSettings();
    return data.rabbit || {};
  } catch {
    return {};
  }
}
async function saveRabbitSettings(patch) {
  try {
    const data = await loadOtterSettings().catch(() => ({}));
    const next = { ...data, rabbit: { ...(data.rabbit || {}), ...patch } };
    await saveOtterSettings(next);
  } catch {
    /* settings save is best-effort — never blocks a user mutation */
  }
}

// Every collection key here is RESET by the `{ ...EMPTY_BUNDLE, ...next }`
// spread in setActiveProject/reloadActiveProject, so an adapter loadProject
// that omits one silently empties it rather than leaving it alone — that was
// §6 #47 (milestones). Adding a collection here means adding it to both
// adapters' loadProject returns AND to EXPECTED_KEYS in
// adapters/loadProjectBundle.test.js, which pins the three together.
const EMPTY_BUNDLE = {
  project: null,
  phases:         [],
  assets:         [],
  tasks:          [],
  dependencies:   [],
  taskLinks:      [],
  files:          [],
  assetVersions:  [],
  comments:       [],
  ingestionRuns:  [],
  teamAssignments: [],
  managedFiles:   [],
  budgetVersions: [],
  expenses:       [],
  projectTeam:    [],
  scenes:         [],
  shots:          [],
  levels:         [],
  experiences:    [],
  milestones:     [],
};

function indexById(rows) {
  const out = {};
  for (const r of rows || []) out[r.id] = r;
  return out;
}

export function RabbitProvider({ children }) {
  // ── adapter ──────────────────────────────────────────────
  const [adapterMode, setAdapterMode] = useState(DEFAULT_ADAPTER_MODE);
  const [adapterStatus, setAdapterStatus] = useState({ online: false, lastSyncAt: null, error: null });
  const adapterRef = useRef(null);

  // ── data ─────────────────────────────────────────────────
  const [projectsIndex, setProjectsIndex] = useState({});
  const [activeProjectId, setActiveProjectIdState] = useState(null);
  const [bundle, setBundle] = useState(EMPTY_BUNDLE);
  const [loadingProject, setLoadingProject] = useState(false);
  const [error, setError] = useState(null);

  // ── undo / redo history ─────────────────────────────────
  // Inverse-operation stack with a 10-deep cap in each direction.
  // Each entry is { undoOps:[], redoOps:[] } where every op is a
  // function that re-runs through the public mutators (so the
  // adapter and local bundle stay in sync). The `suspended` flag
  // is set during replay so the public mutators don't recursively
  // push history while undoing or redoing. The `batch` slot lets
  // composite operations (e.g. drag a phase + N children) commit
  // as ONE undo step instead of N+1.
  const HISTORY_CAP = 10;
  const historyRef = useRef({ undo: [], redo: [], suspended: false, batch: null });
  const [historyVersion, setHistoryVersion] = useState(0);
  const bundleRef = useRef(bundle);
  useEffect(() => { bundleRef.current = bundle; }, [bundle]);
  // Serializes full-bundle loads (setActiveProject + reloadActiveProject):
  // only the newest load may land, so a slow stale snapshot can't wipe
  // fresher state — e.g. realtime events or a post-join refetch that
  // completed while the original loadProject was still in flight.
  const bundleLoadSeqRef = useRef(0);
  // True while the realtime channel is SUBSCRIBED — lets optimistic()
  // schedule a reconvergence refetch after a rollback.
  const realtimeLiveRef = useRef(false);
  // mutationsRef holds the latest version of every public mutator
  // so history closures can call the current implementation rather
  // than a stale captured one.
  const mutationsRef = useRef({});
  // Monotonic token per pushed entry so the undo toast can target the
  // exact entry it belongs to (see undoHistoryEntry below).
  const historyTokenRef = useRef(0);

  function pushHistory(entry) {
    if (historyRef.current.suspended) return null;
    const token = ++historyTokenRef.current;
    entry.token = token;
    if (historyRef.current.batch) {
      // Batched sub-entries lose their identity when combined — the
      // returned token won't resolve in undoHistoryEntry (no-op), which
      // is the safe outcome for a toast fired mid-batch.
      historyRef.current.batch.entries.push(entry);
      return token;
    }
    historyRef.current.undo.push(entry);
    if (historyRef.current.undo.length > HISTORY_CAP) historyRef.current.undo.shift();
    historyRef.current.redo.length = 0;
    setHistoryVersion(v => v + 1);
    return token;
  }

  const runBatch = useCallback(async (fn) => {
    if (historyRef.current.batch) return fn();
    historyRef.current.batch = { entries: [] };
    try {
      return await fn();
    } finally {
      const b = historyRef.current.batch;
      historyRef.current.batch = null;
      if (b.entries.length > 0) {
        // Combined undoOps run in REVERSE order so the latest sub-op
        // gets undone first; redoOps run in original order.
        const combined = {
          token:   ++historyTokenRef.current,
          undoOps: b.entries.slice().reverse().flatMap(e => e.undoOps),
          redoOps: b.entries.flatMap(e => e.redoOps),
        };
        historyRef.current.undo.push(combined);
        if (historyRef.current.undo.length > HISTORY_CAP) historyRef.current.undo.shift();
        historyRef.current.redo.length = 0;
        setHistoryVersion(v => v + 1);
      }
    }
  }, []);

  const undo = useCallback(async () => {
    if (historyRef.current.undo.length === 0) return;
    const entry = historyRef.current.undo.pop();
    historyRef.current.suspended = true;
    try {
      for (const op of entry.undoOps) {
        try { await op(); } catch (e) { /* swallow — keep going */ }
      }
    } finally {
      historyRef.current.suspended = false;
    }
    historyRef.current.redo.push(entry);
    if (historyRef.current.redo.length > HISTORY_CAP) historyRef.current.redo.shift();
    setHistoryVersion(v => v + 1);
  }, []);

  const redo = useCallback(async () => {
    if (historyRef.current.redo.length === 0) return;
    const entry = historyRef.current.redo.pop();
    historyRef.current.suspended = true;
    try {
      for (const op of entry.redoOps) {
        try { await op(); } catch (e) { /* swallow — keep going */ }
      }
    } finally {
      historyRef.current.suspended = false;
    }
    historyRef.current.undo.push(entry);
    if (historyRef.current.undo.length > HISTORY_CAP) historyRef.current.undo.shift();
    setHistoryVersion(v => v + 1);
  }, []);

  // Targeted undo — used by the undo toast so a toast click and a
  // Ctrl+Z can't double-fire the same entry. If the entry is still in
  // the undo stack, remove it and run its undoOps; if it has already
  // been undone (or aged past HISTORY_CAP), no-op.
  const undoHistoryEntry = useCallback(async (token) => {
    if (token == null) return;
    const idx = historyRef.current.undo.findIndex(e => e.token === token);
    if (idx === -1) return;
    const [entry] = historyRef.current.undo.splice(idx, 1);
    historyRef.current.suspended = true;
    try {
      for (const op of entry.undoOps) await op();
    } catch (err) {
      // A failed undo must not read as success: put the entry back at
      // its original index so the toast / Ctrl+Z can retry, and rethrow
      // so the caller sees the failure.
      historyRef.current.undo.splice(idx, 0, entry);
      setHistoryVersion(v => v + 1);
      throw err;
    } finally {
      historyRef.current.suspended = false;
    }
    historyRef.current.redo.push(entry);
    if (historyRef.current.redo.length > HISTORY_CAP) historyRef.current.redo.shift();
    setHistoryVersion(v => v + 1);
  }, []);

  const clearHistory = useCallback(() => {
    // Preserve `suspended`: clearHistory can fire (remote project trash,
    // project switch) while an undo/redo replay is mid-await — resetting
    // the flag would let the replayed mutators push entries into the
    // fresh stack (adversarial-review finding).
    historyRef.current = {
      undo: [], redo: [],
      suspended: historyRef.current.suspended,
      batch: null,
    };
    setHistoryVersion(v => v + 1);
    // A stale toast must not outlive the history it points into.
    setUndoToast(null);
  }, []);

  const canUndo = historyVersion >= 0 && historyRef.current.undo.length > 0;
  const canRedo = historyVersion >= 0 && historyRef.current.redo.length > 0;

  // ── undo toast ──────────────────────────────────────────
  // One toast at a time — a new one replaces the previous (keyed so
  // the countdown restarts). Shape: { key, message, onUndo } | null.
  // Rendered by components/UndoToast.jsx at the Rabbit shell level;
  // every soft/undoable delete shows one instead of a confirm dialog.
  const [undoToast, setUndoToast] = useState(null);
  const undoToastKeyRef = useRef(0);

  const showUndoToast = useCallback((message, onUndo) => {
    setUndoToast({ key: ++undoToastKeyRef.current, message, onUndo });
  }, []);

  const dismissUndoToast = useCallback(() => setUndoToast(null), []);

  // ── intake state (minimal — pipeline lives in intake/) ──
  const [activeIngestion, setActiveIngestion] = useState(null);

  // ── background ingestion run state ──────────────────────
  // Lives at provider level so the bottom-left toast and the
  // wizard's progress step both observe the same source of truth.
  // The toast persists across view switches; the wizard step
  // jumps to review when ingestionRun.phase === 'done'.
  //
  // Shape:
  //   null                                              — idle
  //   { phase, chunksDone, chunksTotal, lastLabel,      — running
  //     fileCount, error, result, projectId,
  //     abortController }
  const [ingestionRun, setIngestionRun] = useState(null);
  const ingestionAbortRef = useRef(null);

  // ── boot: read settings, build adapter, list projects ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await loadRabbitSettings();
      // Session 12: in a browser there is no local Express server and no
      // Drive bridge — supabase is the only adapter that can work, whatever
      // a carried-over settings value says.
      const mode = !hasLocalServer()
        ? 'supabase'
        : (ADAPTER_MODES.includes(settings.adapterMode) ? settings.adapterMode : DEFAULT_ADAPTER_MODE);
      if (cancelled) return;
      setAdapterMode(mode);
      adapterRef.current = selectAdapter(mode);
      try {
        const status = await adapterRef.current.status();
        if (cancelled) return;
        setAdapterStatus(status);
        if (status.online) {
          const list = await adapterRef.current.listProjects();
          if (cancelled) return;
          setProjectsIndex(indexById(list));
          if (settings.activeProjectId && list.some(p => p.id === settings.activeProjectId)) {
            await setActiveProject(settings.activeProjectId, /*persist*/ false);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      }
    })();
    return () => { cancelled = true; };
    // Bootstrap intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-poll the adapter whenever the shared Supabase auth state changes.
  // The boot effect above runs once at mount (often before sign-in), so its
  // status check lands "offline" and listProjects never fires. Without this
  // listener the user would sign in successfully but RABBIT would stay empty
  // until they switched adapter modes or reloaded. onAuthStateChange fires
  // for SIGNED_IN, TOKEN_REFRESHED, and SIGNED_OUT; we re-sync for all three.
  useEffect(() => {
    // ⚠️ Session 17 — THIS CALLBACK MUST RETURN SYNCHRONOUSLY. Do not make it
    // `async`, and do not await a Supabase call inside it.
    //
    // auth-js invokes every onAuthStateChange subscriber from inside
    // `_acquireLock`, and it AWAITS each one (GoTrueClient `_notifyAllSubscribers`).
    // Any Supabase query awaited here calls `_getAccessToken()` -> `getSession()`
    // -> `_acquireLock()`, which waits for the lock this callback is already
    // running inside. That is a self-deadlock, and it takes the whole auth
    // operation down with it.
    //
    // It cost a release-testing session to find, because the symptom pointed
    // everywhere except here: `POST /factors/../verify` returned 200 in 113ms,
    // the challenge was verified server-side, NO further network request was
    // ever made, and the verify() promise simply never resolved — so MFA
    // sign-in was impossible while every server-side signal looked healthy.
    //
    // Deferring with setTimeout(…, 0) lets the callback return immediately;
    // the lock is released, and the queries run a tick later against a
    // settled session. Same work, same order, no re-entrancy.
    const { data: sub } = sharedAuthedClient.auth.onAuthStateChange((event) => {
      setTimeout(async () => {
        if (!adapterRef.current) return;
        if (adapterRef.current.mode !== 'supabase') return;
        // Drop the adapter's cached client reference so getClient() re-reads
        // the latest session on the next call.
        resetSupabaseAdapter();
        try {
          const status = await adapterRef.current.status();
          setAdapterStatus(status);
          if (status.online && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
            const list = await adapterRef.current.listProjects();
            setProjectsIndex(indexById(list));
          } else if (event === 'SIGNED_OUT') {
            setProjectsIndex({});
            setBundle(EMPTY_BUNDLE);
            setActiveProjectIdState(null);
          }
        } catch (err) {
          setAdapterStatus({ online: false, lastSyncAt: null, error: err.message || String(err) });
        }
      }, 0);
    });
    return () => { sub?.subscription?.unsubscribe?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── adapter mode switch ─────────────────────────────────
  const switchAdapter = useCallback(async (nextMode) => {
    if (!ADAPTER_MODES.includes(nextMode)) return;
    setAdapterMode(nextMode);
    adapterRef.current = selectAdapter(nextMode);
    setProjectsIndex({});
    setBundle(EMPTY_BUNDLE);
    setActiveProjectIdState(null);
    // Clear undo history — old ops belong to the previous adapter.
    // (suspended preserved — see clearHistory.)
    historyRef.current = {
      undo: [], redo: [],
      suspended: historyRef.current.suspended,
      batch: null,
    };
    setHistoryVersion(v => v + 1);
    // A stale toast must not outlive the history it points into.
    dismissUndoToast();
    await saveRabbitSettings({ adapterMode: nextMode, activeProjectId: null });
    try {
      const status = await adapterRef.current.status();
      setAdapterStatus(status);
      if (status.online) {
        const list = await adapterRef.current.listProjects();
        setProjectsIndex(indexById(list));
      }
    } catch (err) {
      setError(err.message || String(err));
    }
  }, [dismissUndoToast]);

  // ── refresh ─────────────────────────────────────────────
  const refreshProjectsIndex = useCallback(async () => {
    if (!adapterRef.current) return;
    try {
      const list = await adapterRef.current.listProjects();
      setProjectsIndex(indexById(list));
      setAdapterStatus(s => ({ ...s, online: true, lastSyncAt: new Date(), error: null }));
    } catch (err) {
      setAdapterStatus(s => ({ ...s, online: false, error: err.message || String(err) }));
    }
  }, []);

  const setActiveProject = useCallback(async (projectId, persist = true) => {
    if (!adapterRef.current) return;
    setActiveProjectIdState(projectId);
    if (persist) saveRabbitSettings({ activeProjectId: projectId });
    // Clear undo history — old ops belong to the previous project.
    // (suspended preserved — see clearHistory.)
    historyRef.current = {
      undo: [], redo: [],
      suspended: historyRef.current.suspended,
      batch: null,
    };
    setHistoryVersion(v => v + 1);
    // A stale toast must not outlive the history it points into.
    dismissUndoToast();
    if (!projectId) {
      setBundle(EMPTY_BUNDLE);
      return;
    }
    setLoadingProject(true);
    const loadSeq = ++bundleLoadSeqRef.current;
    try {
      const next = await adapterRef.current.loadProject(projectId);
      // A newer load (rapid project switch, post-join realtime refetch)
      // supersedes this snapshot — never land stale data over it.
      if (loadSeq === bundleLoadSeqRef.current) {
        setBundle({ ...EMPTY_BUNDLE, ...next });
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoadingProject(false);
    }
  }, [dismissUndoToast]);

  // ── project roster (Session 6, supabase mode only) ──────
  // project_members rows for the ACTIVE project. Empty everywhere
  // else: local/drive modes have no roster, and an empty roster IS
  // the "unstaffed → open to every active member" gating state, so
  // legacy flows are unaffected. Mutations are optimistic with
  // snapshot rollback, like the other mutators.
  const [projectMembers, setProjectMembers] = useState([]);
  const [authUserId, setAuthUserId] = useState(null);

  // StrictMode-safe mounted flag — same pattern as useWorkspaceMembers:
  // the effect BODY must reset the flag to true, because StrictMode runs
  // setup → cleanup → setup on the same instance.
  const rosterMountedRef = useRef(true);
  // Monotonic request sequence — a stale roster response from a rapid
  // project switch must never land over a newer one.
  const rosterReqSeqRef = useRef(0);
  useEffect(() => {
    rosterMountedRef.current = true;
    return () => { rosterMountedRef.current = false; };
  }, []);

  const refreshProjectMembers = useCallback(async () => {
    const seq = ++rosterReqSeqRef.current;
    if (adapterMode !== 'supabase' || !activeProjectId
        || typeof adapterRef.current?.listProjectMembers !== 'function') {
      setProjectMembers([]);
      return;
    }
    try {
      // The signed-in auth uid rides along so myProjectRole can be
      // derived — same shared-session read the other cloud code uses.
      const [{ data: sess }, rows] = await Promise.all([
        sharedAuthedClient.auth.getSession(),
        adapterRef.current.listProjectMembers(activeProjectId),
      ]);
      if (!rosterMountedRef.current || seq !== rosterReqSeqRef.current) return;
      setAuthUserId(sess?.session?.user?.id ?? null);
      setProjectMembers(Array.isArray(rows) ? rows : []);
    } catch {
      if (rosterMountedRef.current && seq === rosterReqSeqRef.current) setProjectMembers([]);
    }
  }, [adapterMode, activeProjectId]);

  useEffect(() => { refreshProjectMembers(); }, [refreshProjectMembers]);

  const addProjectMember = useCallback(async (userId, role = 'member') => {
    if (adapterMode !== 'supabase' || !activeProjectId) return null;
    if (typeof adapterRef.current?.upsertProjectMember !== 'function') return null;
    const draft = { project_id: activeProjectId, user_id: userId, project_role: role };
    const snapshot = projectMembers;
    setProjectMembers(prev => [...prev.filter(m => m.user_id !== userId), draft]);
    try {
      const saved = await adapterRef.current.upsertProjectMember(draft);
      if (rosterMountedRef.current && saved) {
        setProjectMembers(prev => prev.map(m => m.user_id === userId ? { ...m, ...saved } : m));
      }
      return saved || draft;
    } catch (err) {
      if (rosterMountedRef.current) setProjectMembers(snapshot);
      setError(err.message || String(err));
      throw err;
    }
  }, [adapterMode, activeProjectId, projectMembers]);

  const updateProjectMemberRole = useCallback(async (userId, role) => {
    if (adapterMode !== 'supabase' || !activeProjectId) return null;
    if (typeof adapterRef.current?.upsertProjectMember !== 'function') return null;
    const snapshot = projectMembers;
    setProjectMembers(prev => prev.map(m => m.user_id === userId ? { ...m, project_role: role } : m));
    try {
      const saved = await adapterRef.current.upsertProjectMember({
        project_id: activeProjectId, user_id: userId, project_role: role,
      });
      if (rosterMountedRef.current && saved) {
        setProjectMembers(prev => prev.map(m => m.user_id === userId ? { ...m, ...saved } : m));
      }
      return saved;
    } catch (err) {
      if (rosterMountedRef.current) setProjectMembers(snapshot);
      setError(err.message || String(err));
      throw err;
    }
  }, [adapterMode, activeProjectId, projectMembers]);

  // Session 24: the per-project JOB TITLE, e.g. "Lead Animator".
  //
  // 🚨 Distinct from updateProjectMemberRole above, which writes
  // `project_role` — the PERMISSION column (manager/member/reviewer) that
  // can_write_project() and every other RLS gate read. Audrey asked for "a
  // company/title role AND a separate project role"; conflating the two would
  // make controls silently vanish, which is the exact failure S23 chased.
  const updateProjectMemberTitle = useCallback(async (userId, projectTitle) => {
    if (adapterMode !== 'supabase' || !activeProjectId) return null;
    if (typeof adapterRef.current?.updateProjectMemberTitle !== 'function') return null;
    const snapshot = projectMembers;
    setProjectMembers(prev => prev.map(m =>
      m.user_id === userId ? { ...m, project_title: projectTitle } : m));
    try {
      const saved = await adapterRef.current.updateProjectMemberTitle(
        activeProjectId, userId, projectTitle,
      );
      if (rosterMountedRef.current && saved) {
        setProjectMembers(prev => prev.map(m =>
          m.user_id === userId ? { ...m, ...saved } : m));
      }
      return saved;
    } catch (err) {
      if (rosterMountedRef.current) setProjectMembers(snapshot);
      setError(err.message || String(err));
      throw err;
    }
  }, [adapterMode, activeProjectId, projectMembers]);

  const removeProjectMember = useCallback(async (userId) => {
    if (adapterMode !== 'supabase' || !activeProjectId) return;
    if (typeof adapterRef.current?.removeProjectMember !== 'function') return;
    const snapshot = projectMembers;
    setProjectMembers(prev => prev.filter(m => m.user_id !== userId));
    try {
      await adapterRef.current.removeProjectMember(activeProjectId, userId);
    } catch (err) {
      if (rosterMountedRef.current) setProjectMembers(snapshot);
      setError(err.message || String(err));
      throw err;
    }
  }, [adapterMode, activeProjectId, projectMembers]);

  // Derived: my seat on the active project (null when unstaffed or not
  // rostered) + whether the project is staffed at all. Mirrors the DB
  // helpers project_role_for() / project_is_staffed() (0013).
  const myProjectRole = useMemo(() => {
    if (!authUserId) return null;
    return projectMembers.find(m => m.user_id === authUserId)?.project_role ?? null;
  }, [projectMembers, authUserId]);
  const projectIsStaffed = projectMembers.length > 0;

  // ── LWW pending-field registry (Session 7) ──────────────
  // Fields with an in-flight local write, per row. The realtime merge
  // keeps the LOCAL value for exactly these fields when a broadcast
  // lands mid-write; every other field takes the incoming row (per-field
  // last-writer-wins, with the DB as the arbiter). Counted rather than
  // boolean: two rapid writes to the same field can overlap.
  const pendingWritesRef = useRef(new Map());

  const notePendingFields = useCallback((table, id, fields) => {
    const map = pendingWritesRef.current;
    const key = `${table}:${id}`;
    const entry = map.get(key) || new Map();
    for (const f of fields) entry.set(f, (entry.get(f) || 0) + 1);
    map.set(key, entry);
  }, []);

  const clearPendingFields = useCallback((table, id, fields) => {
    const map = pendingWritesRef.current;
    const key = `${table}:${id}`;
    const entry = map.get(key);
    if (!entry) return;
    for (const f of fields) {
      const n = (entry.get(f) || 0) - 1;
      if (n <= 0) entry.delete(f); else entry.set(f, n);
    }
    if (entry.size === 0) map.delete(key);
  }, []);

  const pendingFieldsFor = useCallback((table, id) => {
    const entry = pendingWritesRef.current.get(`${table}:${id}`);
    return entry && entry.size > 0 ? new Set(entry.keys()) : null;
  }, []);

  // ── realtime live sync (Session 7, migration 0016) ──────
  // One private broadcast channel per open project. Events flow through
  // the pure merge layer (state/realtimeMerge.js); side effects come back
  // as descriptors and are executed by the drain effect below. Status:
  // 'off' (not cloud / no project) → 'connecting' → 'live' | 'error'.
  const [realtimeStatus, setRealtimeStatus] = useState('off');
  const [presentUsers, setPresentUsers] = useState([]);
  const realtimeSeqRef = useRef(0);
  const refetchTimerRef = useRef(null);
  const pendingEffectsRef = useRef([]);
  const [effectTick, setEffectTick] = useState(0);

  // Full bundle refetch for the open project WITHOUT the history/toast
  // teardown setActiveProject does. Used for remote restores (hidden
  // children reappear server-side only) and post-reconnect convergence.
  // Reads the id from a ref so closures captured in undo/redo ops or a
  // pending debounce can never reload a project the user already left.
  const activeProjectIdRef = useRef(activeProjectId);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

  const reloadActiveProject = useCallback(async () => {
    const pid = activeProjectIdRef.current;
    if (!adapterRef.current || !pid) return null;
    const loadSeq = ++bundleLoadSeqRef.current;
    try {
      const next = await adapterRef.current.loadProject(pid);
      // The user may have switched projects (or a newer load started)
      // while the fetch was in flight — landing stale data would show
      // the wrong project or wipe fresher state.
      if (activeProjectIdRef.current !== pid || loadSeq !== bundleLoadSeqRef.current) {
        return null;
      }
      setBundle({ ...EMPTY_BUNDLE, ...next });
      // Callers (revert's restore path) inspect the fresh bundle
      // directly — bundleRef only catches up after the next commit.
      return next;
    } catch (err) {
      setError(err.message || String(err));
      return null;
    }
  }, []);

  const scheduleRealtimeRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      reloadActiveProject();
    }, 400);
  }, [reloadActiveProject]);

  // Events apply inside the functional updater so two broadcasts landing
  // in one tick can't stomp each other. Effects are captured by ref —
  // they are all idempotent (refetch is debounced, roster refresh and
  // teardown re-run safely), so a StrictMode double-invoke is harmless.
  const handleRealtimeEvent = useCallback((evt) => {
    setBundle(prev => {
      const { bundle: next, effects } = applyRealtimeEvent(prev, evt, {
        pendingFields: pendingFieldsFor,
      });
      if (effects.length > 0) pendingEffectsRef.current.push(...effects);
      return next;
    });
    setEffectTick(t => t + 1);
  }, [pendingFieldsFor]);

  useEffect(() => {
    const effects = pendingEffectsRef.current;
    if (effects.length === 0) return;
    pendingEffectsRef.current = [];
    let roster = false;
    let refetch = false;
    for (const eff of effects) {
      if (eff.type === 'roster') {
        roster = true;
      } else if (eff.type === 'refetch') {
        refetch = true;
      } else if (eff.type === 'project-patch' && eff.record?.id) {
        setProjectsIndex(idx => {
          // Same stale guard as the workspace path (Session 8): the same
          // projects event arrives on BOTH channels, and cross-channel
          // ordering isn't guaranteed — a stale row processed last must
          // not clobber the fresher merge.
          const cur = idx[eff.record.id];
          if (cur && isStaleIncoming(cur, eff.record)) return idx;
          return { ...idx, [eff.record.id]: { ...(cur || {}), ...eff.record } };
        });
      } else if (eff.type === 'project-trashed' && eff.id) {
        setProjectsIndex(idx => {
          const next = { ...idx };
          delete next[eff.id];
          return next;
        });
        if (eff.id === activeProjectId) {
          // Mirror the local deleteProject teardown: close the project.
          // Undo entries and toasts point at rows that just left this
          // client's world — clearHistory also drops the stale toast.
          setActiveProjectIdState(null);
          setBundle(EMPTY_BUNDLE);
          clearHistory();
        }
      }
    }
    if (roster) refreshProjectMembers();
    if (refetch) scheduleRealtimeRefetch();
  }, [effectTick, activeProjectId, clearHistory, refreshProjectMembers, scheduleRealtimeRefetch]);

  useEffect(() => {
    if (adapterMode !== 'supabase' || !activeProjectId
        || typeof adapterRef.current?.subscribeProjectChanges !== 'function') {
      setRealtimeStatus('off');
      setPresentUsers([]);
      return undefined;
    }
    const seq = ++realtimeSeqRef.current;
    setRealtimeStatus('connecting');
    const unsubscribe = adapterRef.current.subscribeProjectChanges(
      activeProjectId,
      (evt) => {
        if (seq !== realtimeSeqRef.current) return; // late event from a torn-down channel
        handleRealtimeEvent(evt);
      },
      {
        onStatus: (status) => {
          if (seq !== realtimeSeqRef.current) return;
          if (status === 'SUBSCRIBED') {
            // Refetch on EVERY join, first included: writes committed
            // between the loadProject snapshot and the join complete
            // are otherwise silently missing (adversarial-review
            // finding — the missed-events window exists on first join
            // exactly as on rejoin).
            scheduleRealtimeRefetch();
            realtimeLiveRef.current = true;
            setRealtimeStatus('live');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setRealtimeStatus('error');
          } else if (status === 'CLOSED') {
            setRealtimeStatus(s => (s === 'live' ? 'connecting' : s));
          }
        },
        onPresence: (users) => {
          if (seq === realtimeSeqRef.current) setPresentUsers(users);
        },
      },
    );
    return () => {
      realtimeSeqRef.current++;
      realtimeLiveRef.current = false;
      unsubscribe();
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
      setPresentUsers([]);
    };
  }, [adapterMode, activeProjectId, handleRealtimeEvent, scheduleRealtimeRefetch]);

  // ── workspace realtime (Session 8, migration 0018) ──────
  // One private channel per signed-in workspace, independent of the open
  // project. Carries projects (index liveness), workspace_members
  // (roster/avatar liveness) and assigned-task events (Dashboard).
  // projects events merge straight into projectsIndex here; every event is
  // also fanned out to registered listeners (Dashboard's useMyTasks,
  // roster hooks) — the provider does not know their state shapes.
  const [workspaceRealtimeStatus, setWorkspaceRealtimeStatus] = useState('off');
  const [workspacePresentUsers, setWorkspacePresentUsers] = useState([]);
  const wsRealtimeSeqRef = useRef(0);
  const wsListenersRef = useRef(new Set());
  const wsIndexRefetchTimerRef = useRef(null);

  const subscribeWorkspaceEvents = useCallback((cb) => {
    wsListenersRef.current.add(cb);
    return () => { wsListenersRef.current.delete(cb); };
  }, []);

  const scheduleProjectsIndexRefetch = useCallback(() => {
    if (wsIndexRefetchTimerRef.current) clearTimeout(wsIndexRefetchTimerRef.current);
    wsIndexRefetchTimerRef.current = setTimeout(() => {
      wsIndexRefetchTimerRef.current = null;
      refreshProjectsIndex();
    }, 400);
  }, [refreshProjectsIndex]);

  const handleWorkspaceEvent = useCallback((evt) => {
    // Index liveness: projects events land whether or not the project is
    // open. Trash arrives as an UPDATE with deleted_at set (broadcast rows
    // are full rows — remove, never merge). The open project's own channel
    // delivers the same event; isStaleIncoming + spread-merge make the
    // double delivery idempotent, and active-project teardown stays with
    // the per-project channel (single owner).
    if (evt.table === 'projects') {
      const rec = evt.record;
      if (evt.op === 'DELETE' || (rec && rec.deleted_at)) {
        const gone = rec?.id ?? evt.oldRecord?.id;
        if (gone) {
          setProjectsIndex(idx => {
            if (!(gone in idx)) return idx;
            const next = { ...idx };
            delete next[gone];
            return next;
          });
        }
      } else if (rec?.id) {
        setProjectsIndex(idx => {
          const cur = idx[rec.id];
          if (cur && isStaleIncoming(cur, rec)) return idx;
          return { ...idx, [rec.id]: { ...(cur || {}), ...rec } };
        });
      }
    }
    for (const cb of wsListenersRef.current) {
      try { cb(evt); } catch { /* listener errors stay theirs */ }
    }
  }, []);

  // The channel key is the workspace id from the JWT claims (frozen shape).
  // Kept in state via the auth listener so sign-in AFTER mount still
  // subscribes, while token refreshes (same workspace) don't tear the
  // channel down — the id doesn't change, so the effect doesn't re-run.
  const [wsAuthKey, setWsAuthKey] = useState(null);
  useEffect(() => {
    let disposed = false;
    sharedAuthedClient.auth.getSession()
      .then(({ data }) => {
        if (!disposed) setWsAuthKey(data?.session?.user?.app_metadata?.workspace_id ?? null);
      })
      .catch(() => { /* signed out — stays null */ });
    const { data: sub } = sharedAuthedClient.auth.onAuthStateChange((_evt, session) => {
      setWsAuthKey(session?.user?.app_metadata?.workspace_id ?? null);
    });
    return () => {
      disposed = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (adapterMode !== 'supabase' || !wsAuthKey
        || typeof adapterRef.current?.subscribeWorkspaceChanges !== 'function') {
      setWorkspaceRealtimeStatus('off');
      setWorkspacePresentUsers([]);
      return undefined;
    }
    const seq = ++wsRealtimeSeqRef.current;
    setWorkspaceRealtimeStatus('connecting');
    const unsubscribe = adapterRef.current.subscribeWorkspaceChanges(
      wsAuthKey,
      (evt) => {
        if (seq !== wsRealtimeSeqRef.current) return; // late event from a torn-down channel
        handleWorkspaceEvent(evt);
      },
      {
        onStatus: (status) => {
          if (seq !== wsRealtimeSeqRef.current) return;
          if (status === 'SUBSCRIBED') {
            // Refetch on EVERY join, first included — the missed-events
            // window exists here exactly as on the project channel.
            // Listeners get a synthetic 'resync' hint so the Dashboard can
            // refetch its own data too.
            scheduleProjectsIndexRefetch();
            for (const cb of wsListenersRef.current) {
              try { cb({ table: null, op: 'RESYNC', record: null, oldRecord: null }); } catch { /* theirs */ }
            }
            setWorkspaceRealtimeStatus('live');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setWorkspaceRealtimeStatus('error');
          } else if (status === 'CLOSED') {
            setWorkspaceRealtimeStatus(s => (s === 'live' ? 'connecting' : s));
          }
        },
        onPresence: (users) => {
          if (seq === wsRealtimeSeqRef.current) setWorkspacePresentUsers(users);
        },
      },
    );
    return () => {
      wsRealtimeSeqRef.current++;
      unsubscribe();
      if (wsIndexRefetchTimerRef.current) {
        clearTimeout(wsIndexRefetchTimerRef.current);
        wsIndexRefetchTimerRef.current = null;
      }
      setWorkspacePresentUsers([]);
    };
  }, [adapterMode, wsAuthKey, handleWorkspaceEvent, scheduleProjectsIndexRefetch]);

  // ── optimistic CRUD helper ──────────────────────────────
  // Applies a local mutation, calls the adapter, rolls back on error.
  // Reads the snapshot from bundleRef so the closure stays stable
  // across renders — important for history-replay paths that hold
  // captured references to mutators.
  const optimistic = useCallback(async (mutator, adapterCall) => {
    const snapshot = bundleRef.current;
    try {
      setBundle(prev => mutator(prev));
      const result = await adapterCall();
      return result;
    } catch (err) {
      setBundle(snapshot);
      // The snapshot predates any realtime events merged during the
      // in-flight write — with live sync up, a failed local write must
      // not erase collaborators' changes; refetch to reconverge.
      if (realtimeLiveRef.current) scheduleRealtimeRefetch();
      setError(err.message || String(err));
      throw err;
    }
  }, [scheduleRealtimeRefetch]);

  // ── Projects (mutators on the index, not the bundle) ────
  const createProject = useCallback(async (payload) => {
    if (!adapterRef.current) throw new Error('no adapter');
    const draft = {
      id:              uuidv4(),
      workspace_id:    DEFAULT_WORKSPACE_ID,
      title:           'Untitled Project',
      description:     '',
      status:          'active',
      budget_currency: 'USD',
      ...payload,
    };
    const created = await adapterRef.current.createProject(draft);
    // Spread the whole created record so DOG-side fields
    // (documents, visualAssets, startDate, endDate, …) survive
    // alongside the canonical RABBIT fields. The unified store
    // means callers can put anything they need on a project.
    setProjectsIndex(idx => ({ ...idx, [created.id]: { ...created } }));
    return created;
  }, []);

  const updateProject = useCallback(async (id, patch) => {
    if (!adapterRef.current) throw new Error('no adapter');
    // adapter.updateProject is already patch-shaped (only the given
    // columns go over the wire) — pending tracking is all LWW needs here.
    const fields = Object.keys(patch);
    notePendingFields('projects', id, fields);
    let updated;
    try {
      updated = await adapterRef.current.updateProject(id, patch);
    } finally {
      clearPendingFields('projects', id, fields);
    }
    setProjectsIndex(idx => ({
      ...idx,
      [id]: { ...(idx[id] || {}), ...updated },
    }));
    if (id === activeProjectId) {
      setBundle(prev => ({ ...prev, project: { ...prev.project, ...updated } }));
    }
    return updated;
  }, [activeProjectId, notePendingFields, clearPendingFields]);

  const deleteProject = useCallback(async (id) => {
    if (!adapterRef.current) throw new Error('no adapter');
    // Supabase soft-deletes (0014) and can restore; local mode keeps
    // today's hard delete with no history entry.
    const canSoftDelete = typeof adapterRef.current.restoreProject === 'function';
    const removedEntry = projectsIndex[id] || null;
    await adapterRef.current.deleteProject(id);
    setProjectsIndex(idx => {
      const next = { ...idx };
      delete next[id];
      return next;
    });
    if (id === activeProjectId) {
      setActiveProjectIdState(null);
      setBundle(EMPTY_BUNDLE);
    }
    if (canSoftDelete) {
      const token = pushHistory({
        undoOps: [async () => {
          // Restore clears deleted_at server-side; reinstate the index
          // entry locally. The bundle reloads on demand when the user
          // re-opens the project.
          await adapterRef.current.restoreProject(id);
          if (removedEntry) setProjectsIndex(idx => ({ ...idx, [id]: removedEntry }));
        }],
        redoOps: [() => mutationsRef.current.deleteProject(id)],
      });
      if (token != null) {
        showUndoToast(
          `Deleted project "${removedEntry?.title || 'Untitled'}"`,
          () => undoHistoryEntry(token),
        );
      }
    }
  }, [activeProjectId, projectsIndex, showUndoToast, undoHistoryEntry]);

  // ── Phases ──────────────────────────────────────────────
  // Adapter-first: call the adapter, then merge the returned row
  // into the bundle. Prevents the duplicate-uuid bug that bit when
  // mutator + adapterCall each generated their own id, and avoids
  // silent rollback on adapter errors that left the user staring
  // at an empty list with no feedback.
  const addPhase = useCallback(async (phase) => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId)    throw new Error('no project');
    const row = {
      id:           phase.id || uuidv4(),
      project_id:   activeProjectId,
      sort_order:   bundleRef.current.phases.length,
      ...phase,
    };
    const created = await adapterRef.current.upsertPhase(row);
    const finalRow = created || row;
    // Upsert, not append: with live sync up, our own INSERT's broadcast
    // echo can land BEFORE the adapter call resolves — a plain append
    // would leave a permanent duplicate id (adversarial-review finding).
    setBundle(prev => ({
      ...prev,
      phases: prev.phases.some(p => p.id === finalRow.id)
        ? prev.phases.map(p => (p.id === finalRow.id ? { ...p, ...finalRow } : p))
        : [...prev.phases, finalRow],
    }));
    pushHistory({
      undoOps: [() => mutationsRef.current.deletePhase(finalRow.id)],
      redoOps: [() => mutationsRef.current.addPhase(finalRow)],
    });
    return finalRow;
  }, [activeProjectId]);

  const updatePhase = useCallback(async (id, patch) => {
    const oldPhase = bundleRef.current.phases.find(p => p.id === id);
    const oldValues = {};
    if (oldPhase) {
      for (const k of Object.keys(patch)) oldValues[k] = oldPhase[k];
    }
    // LWW per field (Session 7): prefer the patch method — a whole-row
    // upsert would overwrite every field a collaborator changed since
    // this client's last read of the row.
    const fields = Object.keys(patch);
    notePendingFields('phases', id, fields);
    let result;
    try {
      result = await optimistic(
        prev => ({ ...prev, phases: prev.phases.map(p => p.id === id ? { ...p, ...patch } : p) }),
        () => typeof adapterRef.current.patchPhase === 'function'
          ? adapterRef.current.patchPhase(id, patch)
          : adapterRef.current.upsertPhase({ ...bundleRef.current.phases.find(p => p.id === id), ...patch, id }),
      );
    } finally {
      clearPendingFields('phases', id, fields);
    }
    if (oldPhase) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updatePhase(id, oldValues)],
        redoOps: [() => mutationsRef.current.updatePhase(id, patch)],
      });
    }
    return result;
  }, [optimistic, notePendingFields, clearPendingFields]);

  const deletePhase = useCallback(async (id) => {
    const oldPhase = bundleRef.current.phases.find(p => p.id === id);
    // Soft-aware: supabase soft-deletes (0014) so undo restores the DB
    // row and reinstates the captured row locally; local mode keeps the
    // re-insert undo path.
    const canSoftDelete = typeof adapterRef.current?.restorePhase === 'function';
    const result = await optimistic(
      prev => ({ ...prev, phases: prev.phases.filter(p => p.id !== id) }),
      () => adapterRef.current.deletePhase(id, activeProjectId),
    );
    if (oldPhase) {
      const token = pushHistory({
        undoOps: canSoftDelete
          ? [async () => {
              await adapterRef.current.restorePhase(id);
              setBundle(prev => ({ ...prev, phases: [...prev.phases, oldPhase] }));
            }]
          : [() => mutationsRef.current.addPhase(oldPhase)],
        redoOps: [() => mutationsRef.current.deletePhase(id)],
      });
      if (token != null) {
        showUndoToast(`Deleted phase "${oldPhase.name || 'Untitled'}"`, () => undoHistoryEntry(token));
      }
    }
    return result;
  }, [optimistic, activeProjectId, showUndoToast, undoHistoryEntry]);

  const reorderPhases = useCallback((orderedIds) => optimistic(
    prev => ({
      ...prev,
      phases: prev.phases
        .slice()
        .sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id))
        .map((p, i) => ({ ...p, sort_order: i })),
    }),
    async () => {
      for (let i = 0; i < orderedIds.length; i++) {
        const phase = bundle.phases.find(p => p.id === orderedIds[i]);
        if (!phase) continue;
        // Patch only sort_order where possible (LWW per field) — a
        // whole-row upsert here would clobber concurrent field edits.
        // Pending registration keeps in-flight order safe from
        // concurrent broadcasts (same contract as updatePhase).
        notePendingFields('phases', phase.id, ['sort_order']);
        try {
          if (typeof adapterRef.current.patchPhase === 'function') {
            await adapterRef.current.patchPhase(phase.id, { sort_order: i });
          } else {
            await adapterRef.current.upsertPhase({ ...phase, sort_order: i });
          }
        } finally {
          clearPendingFields('phases', phase.id, ['sort_order']);
        }
      }
    },
  ), [optimistic, bundle.phases, notePendingFields, clearPendingFields]);

  // ── Assets ──────────────────────────────────────────────
  // See addPhase — same adapter-first pattern.
  const addAsset = useCallback(async (asset) => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId)    throw new Error('no project');
    const row = {
      id:           asset.id || uuidv4(),
      project_id:   activeProjectId,
      sort_order:   bundleRef.current.assets.length,
      status:       'not_started',
      type:         'other',
      ...asset,
    };
    const created = await adapterRef.current.upsertAsset(row);
    const finalRow = created || row;
    // Upsert, not append — see addPhase (broadcast echo race).
    setBundle(prev => ({
      ...prev,
      assets: prev.assets.some(a => a.id === finalRow.id)
        ? prev.assets.map(a => (a.id === finalRow.id ? { ...a, ...finalRow } : a))
        : [...prev.assets, finalRow],
    }));
    pushHistory({
      undoOps: [() => mutationsRef.current.deleteAsset(finalRow.id)],
      redoOps: [() => mutationsRef.current.addAsset(finalRow)],
    });
    return finalRow;
  }, [activeProjectId]);

  const updateAsset = useCallback(async (id, patch) => {
    const oldAsset = bundleRef.current.assets.find(a => a.id === id);
    const oldValues = {};
    if (oldAsset) {
      for (const k of Object.keys(patch)) oldValues[k] = oldAsset[k];
    }
    // LWW per field — see updatePhase.
    const fields = Object.keys(patch);
    notePendingFields('assets', id, fields);
    let result;
    try {
      result = await optimistic(
        prev => ({ ...prev, assets: prev.assets.map(a => a.id === id ? { ...a, ...patch } : a) }),
        () => typeof adapterRef.current.patchAsset === 'function'
          ? adapterRef.current.patchAsset(id, patch)
          : adapterRef.current.upsertAsset({ ...bundleRef.current.assets.find(a => a.id === id), ...patch, id }),
      );
    } finally {
      clearPendingFields('assets', id, fields);
    }
    if (oldAsset) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateAsset(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateAsset(id, patch)],
      });
    }
    return result;
  }, [optimistic, notePendingFields, clearPendingFields]);

  const deleteAsset = useCallback(async (id) => {
    const oldAsset = bundleRef.current.assets.find(a => a.id === id);
    // deleteAsset cascades locally onto tasks (see mutator). Capture
    // those tasks too so undo restores them.
    const removedTasks = bundleRef.current.tasks.filter(t => t.asset_id === id);
    // Soft-aware: a supabase soft delete touches only the asset row —
    // the children were never deleted in the DB, so undo restores the
    // asset and reinstates the captured rows straight into local state
    // (no re-insert mutations). Local mode keeps the re-insert path.
    const canSoftDelete = typeof adapterRef.current?.restoreAsset === 'function';
    const result = await optimistic(
      prev => ({ ...prev, assets: prev.assets.filter(a => a.id !== id), tasks: prev.tasks.filter(t => t.asset_id !== id) }),
      () => adapterRef.current.deleteAsset(id, activeProjectId),
    );
    if (oldAsset) {
      const token = pushHistory({
        undoOps: canSoftDelete
          ? [async () => {
              await adapterRef.current.restoreAsset(id);
              setBundle(prev => ({
                ...prev,
                assets: [...prev.assets, oldAsset],
                tasks:  [...prev.tasks, ...removedTasks],
              }));
            }]
          : [
              () => mutationsRef.current.addAsset(oldAsset),
              ...removedTasks.map(t => () => mutationsRef.current.addTask(t)),
            ],
        redoOps: [() => mutationsRef.current.deleteAsset(id)],
      });
      if (token != null) {
        showUndoToast(`Deleted asset "${oldAsset.name || 'Untitled'}"`, () => undoHistoryEntry(token));
      }
    }
    return result;
  }, [optimistic, activeProjectId, showUndoToast, undoHistoryEntry]);

  // Bulk delete — one adapter loop, ONE combined history entry, ONE
  // toast, instead of the N-toasts/N-entries a view-side loop over
  // deleteAsset would produce.
  const deleteAssets = useCallback(async (ids = []) => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const canSoftDelete = typeof adapterRef.current?.restoreAsset === 'function';
    const removed = ids
      .map(id => ({
        asset: bundleRef.current.assets.find(a => a.id === id),
        tasks: bundleRef.current.tasks.filter(t => t.asset_id === id),
      }))
      .filter(r => r.asset);
    if (removed.length === 0) return;
    const idSet = new Set(removed.map(r => r.asset.id));
    const result = await optimistic(
      prev => ({
        ...prev,
        assets: prev.assets.filter(a => !idSet.has(a.id)),
        tasks:  prev.tasks.filter(t => !idSet.has(t.asset_id)),
      }),
      async () => {
        // Bulk delete is all-or-nothing: on a mid-loop failure, restore the
        // rows already soft-deleted server-side, then rethrow for rollback.
        const done = [];
        try {
          for (const r of removed) {
            await adapterRef.current.deleteAsset(r.asset.id, activeProjectId);
            done.push(r.asset.id);
          }
        } catch (err) {
          if (canSoftDelete) {
            await Promise.allSettled(done.map(id => adapterRef.current.restoreAsset(id)));
          }
          throw err;
        }
      },
    );
    const token = pushHistory({
      undoOps: canSoftDelete
        ? [async () => {
            for (const r of removed) await adapterRef.current.restoreAsset(r.asset.id);
            setBundle(prev => ({
              ...prev,
              assets: [...prev.assets, ...removed.map(r => r.asset)],
              tasks:  [...prev.tasks, ...removed.flatMap(r => r.tasks)],
            }));
          }]
        : removed.slice().reverse().flatMap(r => [
            () => mutationsRef.current.addAsset(r.asset),
            ...r.tasks.map(t => () => mutationsRef.current.addTask(t)),
          ]),
      redoOps: [() => mutationsRef.current.deleteAssets([...idSet])],
    });
    if (token != null) {
      showUndoToast(
        removed.length === 1
          ? `Deleted asset "${removed[0].asset.name || 'Untitled'}"`
          : `Deleted ${removed.length} assets`,
        () => undoHistoryEntry(token),
      );
    }
    return result;
  }, [optimistic, activeProjectId, showUndoToast, undoHistoryEntry]);

  // ── Scenes ─────────────────────────────────────────────
  const addScene = useCallback(async (scene) => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId)    throw new Error('no project');
    const row = {
      id:           scene.id || uuidv4(),
      project_id:   activeProjectId,
      sort_order:   bundleRef.current.scenes.length,
      ...scene,
    };
    const created = await adapterRef.current.upsertScene(row);
    const finalRow = created || row;
    setBundle(prev => ({ ...prev, scenes: [...prev.scenes, finalRow] }));
    pushHistory({
      undoOps: [() => mutationsRef.current.deleteScene(finalRow.id)],
      redoOps: [() => mutationsRef.current.addScene(finalRow)],
    });
    return finalRow;
  }, [activeProjectId]);

  const updateScene = useCallback(async (id, patch) => {
    const oldScene = bundleRef.current.scenes.find(s => s.id === id);
    const oldValues = {};
    if (oldScene) {
      for (const k of Object.keys(patch)) oldValues[k] = oldScene[k];
    }
    const result = await optimistic(
      prev => ({ ...prev, scenes: prev.scenes.map(s => s.id === id ? { ...s, ...patch } : s) }),
      () => adapterRef.current.upsertScene({ ...bundleRef.current.scenes.find(s => s.id === id), ...patch, id }),
    );
    if (oldScene) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateScene(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateScene(id, patch)],
      });
    }
    return result;
  }, [optimistic]);

  const deleteScene = useCallback(async (id) => {
    const oldScene = bundleRef.current.scenes.find(s => s.id === id);
    const result = await optimistic(
      prev => ({ ...prev, scenes: prev.scenes.filter(s => s.id !== id) }),
      () => adapterRef.current.deleteScene(id, activeProjectId),
    );
    if (oldScene) {
      pushHistory({
        undoOps: [() => mutationsRef.current.addScene(oldScene)],
        redoOps: [() => mutationsRef.current.deleteScene(id)],
      });
    }
    return result;
  }, [optimistic, activeProjectId]);

  // ── Shots ──────────────────────────────────────────────
  const addShot = useCallback(async (shot) => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId)    throw new Error('no project');
    const row = {
      id:           shot.id || uuidv4(),
      project_id:   activeProjectId,
      sort_order:   bundleRef.current.shots.length,
      ...shot,
    };
    const created = await adapterRef.current.upsertShot(row);
    const finalRow = created || row;
    setBundle(prev => ({ ...prev, shots: [...prev.shots, finalRow] }));
    pushHistory({
      undoOps: [() => mutationsRef.current.deleteShot(finalRow.id)],
      redoOps: [() => mutationsRef.current.addShot(finalRow)],
    });
    return finalRow;
  }, [activeProjectId]);

  const updateShot = useCallback(async (id, patch) => {
    const oldShot = bundleRef.current.shots.find(s => s.id === id);
    const oldValues = {};
    if (oldShot) {
      for (const k of Object.keys(patch)) oldValues[k] = oldShot[k];
    }
    const result = await optimistic(
      prev => ({ ...prev, shots: prev.shots.map(s => s.id === id ? { ...s, ...patch } : s) }),
      () => adapterRef.current.upsertShot({ ...bundleRef.current.shots.find(s => s.id === id), ...patch, id }),
    );
    if (oldShot) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateShot(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateShot(id, patch)],
      });
    }
    return result;
  }, [optimistic]);

  const deleteShot = useCallback(async (id) => {
    const oldShot = bundleRef.current.shots.find(s => s.id === id);
    const result = await optimistic(
      prev => ({ ...prev, shots: prev.shots.filter(s => s.id !== id) }),
      () => adapterRef.current.deleteShot(id, activeProjectId),
    );
    if (oldShot) {
      pushHistory({
        undoOps: [() => mutationsRef.current.addShot(oldShot)],
        redoOps: [() => mutationsRef.current.deleteShot(id)],
      });
    }
    return result;
  }, [optimistic, activeProjectId]);

  // ── Levels ─────────────────────────────────────────────
  const addLevel = useCallback(async (level) => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId)    throw new Error('no project');
    const row = {
      id:           level.id || uuidv4(),
      project_id:   activeProjectId,
      sort_order:   bundleRef.current.levels.length,
      ...level,
    };
    const created = await adapterRef.current.upsertLevel(row);
    const finalRow = created || row;
    setBundle(prev => ({ ...prev, levels: [...prev.levels, finalRow] }));
    pushHistory({
      undoOps: [() => mutationsRef.current.deleteLevel(finalRow.id)],
      redoOps: [() => mutationsRef.current.addLevel(finalRow)],
    });
    return finalRow;
  }, [activeProjectId]);

  const updateLevel = useCallback(async (id, patch) => {
    const oldLevel = bundleRef.current.levels.find(l => l.id === id);
    const oldValues = {};
    if (oldLevel) {
      for (const k of Object.keys(patch)) oldValues[k] = oldLevel[k];
    }
    const result = await optimistic(
      prev => ({ ...prev, levels: prev.levels.map(l => l.id === id ? { ...l, ...patch } : l) }),
      () => adapterRef.current.upsertLevel({ ...bundleRef.current.levels.find(l => l.id === id), ...patch, id }),
    );
    if (oldLevel) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateLevel(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateLevel(id, patch)],
      });
    }
    return result;
  }, [optimistic]);

  const deleteLevel = useCallback(async (id) => {
    const oldLevel = bundleRef.current.levels.find(l => l.id === id);
    const result = await optimistic(
      prev => ({ ...prev, levels: prev.levels.filter(l => l.id !== id) }),
      () => adapterRef.current.deleteLevel(id, activeProjectId),
    );
    if (oldLevel) {
      pushHistory({
        undoOps: [() => mutationsRef.current.addLevel(oldLevel)],
        redoOps: [() => mutationsRef.current.deleteLevel(id)],
      });
    }
    return result;
  }, [optimistic, activeProjectId]);

  // ── Experiences ────────────────────────────────────────
  const addExperience = useCallback(async (experience) => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId)    throw new Error('no project');
    const row = {
      id:           experience.id || uuidv4(),
      project_id:   activeProjectId,
      sort_order:   bundleRef.current.experiences.length,
      ...experience,
    };
    const created = await adapterRef.current.upsertExperience(row);
    const finalRow = created || row;
    setBundle(prev => ({ ...prev, experiences: [...prev.experiences, finalRow] }));
    pushHistory({
      undoOps: [() => mutationsRef.current.deleteExperience(finalRow.id)],
      redoOps: [() => mutationsRef.current.addExperience(finalRow)],
    });
    return finalRow;
  }, [activeProjectId]);

  const updateExperience = useCallback(async (id, patch) => {
    const oldExperience = bundleRef.current.experiences.find(e => e.id === id);
    const oldValues = {};
    if (oldExperience) {
      for (const k of Object.keys(patch)) oldValues[k] = oldExperience[k];
    }
    const result = await optimistic(
      prev => ({ ...prev, experiences: prev.experiences.map(e => e.id === id ? { ...e, ...patch } : e) }),
      () => adapterRef.current.upsertExperience({ ...bundleRef.current.experiences.find(e => e.id === id), ...patch, id }),
    );
    if (oldExperience) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateExperience(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateExperience(id, patch)],
      });
    }
    return result;
  }, [optimistic]);

  const deleteExperience = useCallback(async (id) => {
    const oldExperience = bundleRef.current.experiences.find(e => e.id === id);
    const result = await optimistic(
      prev => ({ ...prev, experiences: prev.experiences.filter(e => e.id !== id) }),
      () => adapterRef.current.deleteExperience(id, activeProjectId),
    );
    if (oldExperience) {
      pushHistory({
        undoOps: [() => mutationsRef.current.addExperience(oldExperience)],
        redoOps: [() => mutationsRef.current.deleteExperience(id)],
      });
    }
    return result;
  }, [optimistic, activeProjectId]);

  // ── Milestones ──────────────────────────────────────────
  const addMilestone = useCallback(async (milestone) => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId)    throw new Error('no project');
    const row = {
      id:           milestone.id || uuidv4(),
      project_id:   activeProjectId,
      ...milestone,
    };
    const created = await adapterRef.current.upsertMilestone(row);
    const finalRow = created || row;
    setBundle(prev => ({ ...prev, milestones: [...prev.milestones, finalRow] }));
    pushHistory({
      undoOps: [() => mutationsRef.current.deleteMilestone(finalRow.id)],
      redoOps: [() => mutationsRef.current.addMilestone(finalRow)],
    });
    return finalRow;
  }, [activeProjectId]);

  const updateMilestone = useCallback(async (id, patch) => {
    const oldMilestone = bundleRef.current.milestones.find(m => m.id === id);
    const oldValues = {};
    if (oldMilestone) {
      for (const k of Object.keys(patch)) oldValues[k] = oldMilestone[k];
    }
    const result = await optimistic(
      prev => ({ ...prev, milestones: prev.milestones.map(m => m.id === id ? { ...m, ...patch } : m) }),
      () => adapterRef.current.upsertMilestone({ ...bundleRef.current.milestones.find(m => m.id === id), ...patch, id }),
    );
    if (oldMilestone) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateMilestone(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateMilestone(id, patch)],
      });
    }
    return result;
  }, [optimistic]);

  const deleteMilestone = useCallback(async (id) => {
    const oldMilestone = bundleRef.current.milestones.find(m => m.id === id);
    const result = await optimistic(
      prev => ({ ...prev, milestones: prev.milestones.filter(m => m.id !== id) }),
      () => adapterRef.current.deleteMilestone(id, activeProjectId),
    );
    if (oldMilestone) {
      pushHistory({
        undoOps: [() => mutationsRef.current.addMilestone(oldMilestone)],
        redoOps: [() => mutationsRef.current.deleteMilestone(id)],
      });
    }
    return result;
  }, [optimistic, activeProjectId]);

  const reorderAssets = useCallback((orderedIds) => optimistic(
    prev => ({
      ...prev,
      assets: prev.assets
        .slice()
        .sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id))
        .map((a, i) => ({ ...a, sort_order: i })),
    }),
    async () => {
      for (let i = 0; i < orderedIds.length; i++) {
        const asset = bundle.assets.find(a => a.id === orderedIds[i]);
        if (!asset) continue;
        // Patch only sort_order where possible — see reorderPhases.
        notePendingFields('assets', asset.id, ['sort_order']);
        try {
          if (typeof adapterRef.current.patchAsset === 'function') {
            await adapterRef.current.patchAsset(asset.id, { sort_order: i });
          } else {
            await adapterRef.current.upsertAsset({ ...asset, sort_order: i });
          }
        } finally {
          clearPendingFields('assets', asset.id, ['sort_order']);
        }
      }
    },
  ), [optimistic, bundle.assets, notePendingFields, clearPendingFields]);

  // ── Tasks ───────────────────────────────────────────────
  // See addPhase — same adapter-first pattern.
  const addTask = useCallback(async (task) => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId)    throw new Error('no project');
    const row = {
      id:           task.id || uuidv4(),
      project_id:   activeProjectId,
      status:       'waiting_to_start',
      priority:     'medium',
      ...task,
    };
    // Session 23: report a failed create instead of dropping it. Every add
    // affordance — the toolbar button, the table add-rows, the per-group
    // rows, the row menu and both kanban adds — routes through here and NONE
    // of them has a catch, so a rejection was invisible in all six places at
    // once. That is why "the New task button does nothing" was literally
    // true: the throw happened before the setBundle below, so the table
    // rendered identically before and after the click.
    //
    // setError AND rethrow: the provider banner reports it, and callers that
    // do have their own catch (TimelineView.jsx:3791) still get to show it
    // in their dialog. Swallowing here would silence those.
    let created;
    try {
      created = await adapterRef.current.upsertTask(row);
    } catch (err) {
      setError(err?.message || String(err));
      throw err;
    }
    const finalRow = created || row;
    // Upsert, not append — see addPhase (broadcast echo race).
    setBundle(prev => ({
      ...prev,
      tasks: prev.tasks.some(t => t.id === finalRow.id)
        ? prev.tasks.map(t => (t.id === finalRow.id ? { ...t, ...finalRow } : t))
        : [...prev.tasks, finalRow],
    }));
    pushHistory({
      undoOps: [() => mutationsRef.current.deleteTask(finalRow.id)],
      redoOps: [() => mutationsRef.current.addTask(finalRow)],
    });
    return finalRow;
  }, [activeProjectId]);

  const updateTask = useCallback(async (id, patch) => {
    const oldTask = bundleRef.current.tasks.find(t => t.id === id);
    const oldValues = {};
    if (oldTask) {
      for (const k of Object.keys(patch)) oldValues[k] = oldTask[k];
    }
    // LWW per field — see updatePhase.
    const fields = Object.keys(patch);
    notePendingFields('tasks', id, fields);
    let result;
    try {
      result = await optimistic(
        prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, ...patch } : t) }),
        () => typeof adapterRef.current.patchTask === 'function'
          ? adapterRef.current.patchTask(id, patch)
          : adapterRef.current.upsertTask({ ...bundleRef.current.tasks.find(t => t.id === id), ...patch, id }),
      );
    } finally {
      clearPendingFields('tasks', id, fields);
    }
    if (oldTask) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateTask(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateTask(id, patch)],
      });
    }
    return result;
  }, [optimistic, notePendingFields, clearPendingFields]);

  const deleteTask = useCallback(async (id) => {
    const oldTask = bundleRef.current.tasks.find(t => t.id === id);
    // deleteTask also strips matching dependency rows. Capture them
    // for undo so the dependency graph restores too.
    const removedDeps = bundleRef.current.dependencies.filter(
      d => d.predecessor_id === id || d.successor_id === id,
    );
    // Soft-aware: supabase soft-deletes only the task row — dependency
    // rows survive in the DB (they're only hidden transitively), so
    // undo restores the task and reinstates the captured rows straight
    // into local state. Local mode keeps the re-insert undo path.
    const canSoftDelete = typeof adapterRef.current?.restoreTask === 'function';
    const result = await optimistic(
      prev => ({
        ...prev,
        tasks: prev.tasks.filter(t => t.id !== id),
        dependencies: prev.dependencies.filter(d => d.predecessor_id !== id && d.successor_id !== id),
      }),
      () => adapterRef.current.deleteTask(id, activeProjectId),
    );
    if (oldTask) {
      const token = pushHistory({
        undoOps: canSoftDelete
          ? [async () => {
              await adapterRef.current.restoreTask(id);
              setBundle(prev => ({
                ...prev,
                tasks:        [...prev.tasks, oldTask],
                dependencies: [...prev.dependencies, ...removedDeps],
              }));
            }]
          : [
              () => mutationsRef.current.addTask(oldTask),
              ...removedDeps.map(d => async () => {
                // Re-insert the dependency row directly (preserves id +
                // kind), bypassing the link* helpers' fresh-uuid path.
                await optimistic(
                  prev => ({ ...prev, dependencies: [...prev.dependencies, d] }),
                  () => adapterRef.current.upsertDependency(d),
                );
              }),
            ],
        redoOps: [() => mutationsRef.current.deleteTask(id)],
      });
      if (token != null) {
        showUndoToast(`Deleted task "${oldTask.title || 'Untitled'}"`, () => undoHistoryEntry(token));
      }
    }
    return result;
  }, [optimistic, activeProjectId, showUndoToast, undoHistoryEntry]);

  // Bulk delete — see deleteAssets. One combined entry, one toast.
  const deleteTasks = useCallback(async (ids = []) => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const canSoftDelete = typeof adapterRef.current?.restoreTask === 'function';
    const idSet = new Set(ids);
    const removedTasks = bundleRef.current.tasks.filter(t => idSet.has(t.id));
    const removedDeps = bundleRef.current.dependencies.filter(
      d => idSet.has(d.predecessor_id) || idSet.has(d.successor_id),
    );
    if (removedTasks.length === 0) return;
    const result = await optimistic(
      prev => ({
        ...prev,
        tasks: prev.tasks.filter(t => !idSet.has(t.id)),
        dependencies: prev.dependencies.filter(
          d => !idSet.has(d.predecessor_id) && !idSet.has(d.successor_id),
        ),
      }),
      async () => {
        // Bulk delete is all-or-nothing: on a mid-loop failure, restore the
        // rows already soft-deleted server-side, then rethrow for rollback.
        const done = [];
        try {
          for (const t of removedTasks) {
            await adapterRef.current.deleteTask(t.id, activeProjectId);
            done.push(t.id);
          }
        } catch (err) {
          if (canSoftDelete) {
            await Promise.allSettled(done.map(id => adapterRef.current.restoreTask(id)));
          }
          throw err;
        }
      },
    );
    const token = pushHistory({
      undoOps: canSoftDelete
        ? [async () => {
            for (const t of removedTasks) await adapterRef.current.restoreTask(t.id);
            setBundle(prev => ({
              ...prev,
              tasks:        [...prev.tasks, ...removedTasks],
              dependencies: [...prev.dependencies, ...removedDeps],
            }));
          }]
        : [
            ...removedTasks.slice().reverse().map(t => () => mutationsRef.current.addTask(t)),
            ...removedDeps.map(d => async () => {
              await optimistic(
                prev => ({ ...prev, dependencies: [...prev.dependencies, d] }),
                () => adapterRef.current.upsertDependency(d),
              );
            }),
          ],
      redoOps: [() => mutationsRef.current.deleteTasks(removedTasks.map(t => t.id))],
    });
    if (token != null) {
      showUndoToast(
        removedTasks.length === 1
          ? `Deleted task "${removedTasks[0].title || 'Untitled'}"`
          : `Deleted ${removedTasks.length} tasks`,
        () => undoHistoryEntry(token),
      );
    }
    return result;
  }, [optimistic, activeProjectId, showUndoToast, undoHistoryEntry]);

  // ── Dependencies ────────────────────────────────────────
  // The `dependencies` array carries BOTH task→task and phase→phase
  // edges. We distinguish with an optional `kind` field ('task' |
  // 'phase'). Missing / undefined kind is treated as 'task' so
  // legacy rows keep working. The critical-path engine naturally
  // filters out phase-kind rows because their ids aren't in the
  // task lookup table.
  const linkTasks = useCallback(async (predecessorId, successorId, type = 'FS', lagDays = 0, existingId = null) => {
    const id = existingId || uuidv4();
    const row = {
      id,
      predecessor_id: predecessorId,
      successor_id:   successorId,
      kind:           'task',
      type,
      lag_days:       lagDays,
      project_id:     activeProjectId,
    };
    const result = await optimistic(
      prev => ({ ...prev, dependencies: [...prev.dependencies, row] }),
      () => adapterRef.current.upsertDependency(row),
    );
    pushHistory({
      undoOps: [() => mutationsRef.current.unlinkTasks(id)],
      redoOps: [() => mutationsRef.current.linkTasks(predecessorId, successorId, type, lagDays, id)],
    });
    return result;
  }, [optimistic, activeProjectId]);

  const linkPhases = useCallback(async (predecessorId, successorId, type = 'FS', lagDays = 0, existingId = null) => {
    const id = existingId || uuidv4();
    const row = {
      id,
      predecessor_id: predecessorId,
      successor_id:   successorId,
      kind:           'phase',
      type,
      lag_days:       lagDays,
      project_id:     activeProjectId,
    };
    const result = await optimistic(
      prev => ({ ...prev, dependencies: [...prev.dependencies, row] }),
      () => adapterRef.current.upsertDependency(row),
    );
    pushHistory({
      undoOps: [() => mutationsRef.current.unlinkTasks(id)],
      redoOps: [() => mutationsRef.current.linkPhases(predecessorId, successorId, type, lagDays, id)],
    });
    return result;
  }, [optimistic, activeProjectId]);

  const unlinkTasks = useCallback(async (dependencyId) => {
    const oldRow = bundleRef.current.dependencies.find(d => d.id === dependencyId);
    const result = await optimistic(
      prev => ({ ...prev, dependencies: prev.dependencies.filter(d => d.id !== dependencyId) }),
      () => adapterRef.current.deleteDependency(dependencyId, activeProjectId),
    );
    if (oldRow) {
      pushHistory({
        undoOps: [async () => {
          // Re-insert the original row directly so id + kind survive.
          await optimistic(
            prev => ({ ...prev, dependencies: [...prev.dependencies, oldRow] }),
            () => adapterRef.current.upsertDependency(oldRow),
          );
        }],
        redoOps: [() => mutationsRef.current.unlinkTasks(dependencyId)],
      });
    }
    return result;
  }, [optimistic, activeProjectId]);

  // Alias — semantically covers both task + phase edges.
  const unlinkDependency = unlinkTasks;

  // ── Task links (free URLs) ──────────────────────────────
  const addTaskLink = useCallback(async (link) => {
    // Pre-allocate the id so the local state and the adapter call
    // share it (the previous version generated two distinct uuids).
    const row = { id: uuidv4(), project_id: activeProjectId, ...link };
    const result = await optimistic(
      prev => ({ ...prev, taskLinks: [...prev.taskLinks, row] }),
      () => adapterRef.current.upsertTaskLink(row),
    );
    pushHistory({
      undoOps: [() => mutationsRef.current.removeTaskLink(row.id)],
      redoOps: [async () => {
        await optimistic(
          prev => ({ ...prev, taskLinks: [...prev.taskLinks, row] }),
          () => adapterRef.current.upsertTaskLink(row),
        );
      }],
    });
    return result;
  }, [optimistic, activeProjectId]);

  const removeTaskLink = useCallback(async (linkId) => {
    const oldRow = bundleRef.current.taskLinks.find(l => l.id === linkId);
    const result = await optimistic(
      prev => ({ ...prev, taskLinks: prev.taskLinks.filter(l => l.id !== linkId) }),
      () => adapterRef.current.deleteTaskLink(linkId, activeProjectId),
    );
    if (oldRow) {
      pushHistory({
        undoOps: [async () => {
          await optimistic(
            prev => ({ ...prev, taskLinks: [...prev.taskLinks, oldRow] }),
            () => adapterRef.current.upsertTaskLink(oldRow),
          );
        }],
        redoOps: [() => mutationsRef.current.removeTaskLink(linkId)],
      });
    }
    return result;
  }, [optimistic, activeProjectId]);

  // ── Team assignments (project-scoped) ────────────────────
  // Each assignment: { id, project_id, member_id, role: 'member' | 'manager' | 'reviewer' }
  const addTeamAssignment = useCallback(async (assignment) => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId)    throw new Error('no project');
    const row = {
      id:           assignment.id || uuidv4(),
      project_id:   activeProjectId,
      role:         'member',
      ...assignment,
    };
    const created = await adapterRef.current.upsertTeamAssignment(row);
    const finalRow = created || row;
    setBundle(prev => ({ ...prev, teamAssignments: [...prev.teamAssignments, finalRow] }));
    return finalRow;
  }, [activeProjectId]);

  const updateTeamAssignment = useCallback(async (id, patch) => {
    const result = await optimistic(
      prev => ({ ...prev, teamAssignments: prev.teamAssignments.map(a => a.id === id ? { ...a, ...patch } : a) }),
      () => adapterRef.current.upsertTeamAssignment({ ...bundleRef.current.teamAssignments.find(a => a.id === id), ...patch, id }),
    );
    return result;
  }, [optimistic]);

  const removeTeamAssignment = useCallback(async (id) => {
    const result = await optimistic(
      prev => ({ ...prev, teamAssignments: prev.teamAssignments.filter(a => a.id !== id) }),
      () => adapterRef.current.deleteTeamAssignment(id, activeProjectId),
    );
    return result;
  }, [optimistic, activeProjectId]);

  // ── Project team (project-scoped copy of workspace members) ──
  const syncProjectTeam = useCallback(async (members) => {
    if (!adapterRef.current?.syncProjectTeam || !activeProjectId) return;
    const synced = await adapterRef.current.syncProjectTeam(activeProjectId, members);
    setBundle(prev => ({ ...prev, projectTeam: synced || members }));
    return synced;
  }, [activeProjectId]);

  // ── Files ───────────────────────────────────────────────
  const uploadFile = useCallback(async (file, scope = {}) => {
    if (!adapterRef.current || !activeProjectId) throw new Error('no project');
    const created = await adapterRef.current.uploadFile(activeProjectId, scope, file);
    // Upsert, not append — see addPhase (broadcast echo race).
    setBundle(prev => ({
      ...prev,
      files: prev.files.some(f => f.id === created.id)
        ? prev.files.map(f => (f.id === created.id ? { ...f, ...created } : f))
        : [...prev.files, created],
    }));
    return created;
  }, [activeProjectId]);

  const markFileCoreDefiner = useCallback((fileId, isCore) => optimistic(
    prev => ({
      ...prev,
      files: prev.files.map(f => f.id === fileId ? { ...f, is_core_definer: isCore } : f),
    }),
    () => adapterRef.current.updateFile(fileId, { is_core_definer: isCore, project_id: activeProjectId }),
  ), [optimistic, activeProjectId]);

  const patchFile = useCallback((fileId, patch) => optimistic(
    prev => ({
      ...prev,
      files: prev.files.map(f => f.id === fileId ? { ...f, ...patch } : f),
    }),
    () => adapterRef.current.updateFile(fileId, { ...patch, project_id: activeProjectId }),
  ), [optimistic, activeProjectId]);

  // ── Managed files (asset-folder-based, versioned) ──────
  const addManagedFile = useCallback(async (record) => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId) throw new Error('no project');
    // Session 17 (§6 #48): managed files are a local_server-only subsystem —
    // neither the supabase nor the Drive adapter defines createManagedFile.
    // FileManager guards on "are we in Electron", which is true regardless of
    // the selected backend, so this used to throw an opaque TypeError.
    if (typeof adapterRef.current.createManagedFile !== 'function') {
      throw new Error('Managed files require the Local Server backend');
    }
    const created = await adapterRef.current.createManagedFile({
      ...record,
      project_id: activeProjectId,
    });
    setBundle(prev => ({
      ...prev,
      managedFiles: [...(prev.managedFiles || []), created],
    }));
    return created;
  }, [activeProjectId]);

  const updateManagedFile = useCallback(async (id, patch) => {
    return optimistic(
      prev => ({
        ...prev,
        managedFiles: (prev.managedFiles || []).map(f =>
          f.id === id ? { ...f, ...patch } : f
        ),
      }),
      () => adapterRef.current.updateManagedFile(id, { ...patch, project_id: activeProjectId }),
    );
  }, [optimistic, activeProjectId]);

  const deleteManagedFile = useCallback(async (id, hard = false) => {
    if (hard) {
      return optimistic(
        prev => ({
          ...prev,
          managedFiles: (prev.managedFiles || []).filter(f => f.id !== id),
        }),
        () => adapterRef.current.deleteManagedFile(id, activeProjectId, true),
      );
    }
    // Soft delete
    return optimistic(
      prev => ({
        ...prev,
        managedFiles: (prev.managedFiles || []).map(f =>
          f.id === id ? { ...f, deleted_at: new Date().toISOString() } : f
        ),
      }),
      () => adapterRef.current.deleteManagedFile(id, activeProjectId, false),
    );
  }, [optimistic, activeProjectId]);

  const refreshManagedFiles = useCallback(async () => {
    if (!adapterRef.current || !activeProjectId) return;
    // Same local_server-only subsystem as addManagedFile (§6 #48). This one
    // is reached from six onFileAdded/onFileDeleted/onFileUpdated callbacks,
    // so an unguarded call threw a TypeError on every one of them in cloud
    // and Drive mode. Returning is correct here: there is nothing to refresh.
    if (typeof adapterRef.current.listManagedFiles !== 'function') return;
    const files = await adapterRef.current.listManagedFiles(activeProjectId);
    setBundle(prev => ({ ...prev, managedFiles: files }));
  }, [activeProjectId]);

  // ── Ingestion runs ──────────────────────────────────────
  // The actual chunked pipeline lives in intake/pipeline.js (Commit 10).
  // The provider only owns the *lifecycle*: start (create run row),
  // accept (write breakdown into bundle + adapter), discard (drop).
  const startIngestion = useCallback(async (documentKind = 'other') => {
    if (!adapterRef.current || !activeProjectId) throw new Error('no project');
    const run = await adapterRef.current.createIngestionRun({
      project_id:    activeProjectId,
      status:        'queued',
      document_kind: documentKind,
      chunks_total:  0,
      chunks_done:   0,
    });
    setBundle(prev => ({ ...prev, ingestionRuns: [...prev.ingestionRuns, run] }));
    setActiveIngestion({ runId: run.id, status: 'queued', breakdown: null });
    return run;
  }, [activeProjectId]);

  const acceptIngestion = useCallback(async (runId, breakdown) => {
    if (!adapterRef.current || !activeProjectId) throw new Error('no project');
    // Write each phase / asset / task into the bundle in order.
    // Phases first → assets reference phases → tasks reference assets.
    const phaseIdByName = {};
    for (const ph of breakdown.phases || []) {
      const created = await addPhase({ name: ph.name, description: ph.rationale || '' });
      if (created?.id) phaseIdByName[ph.name] = created.id;
    }
    const assetIdByName = {};
    for (const a of breakdown.assets || []) {
      const created = await addAsset({
        name:        a.name,
        type:        a.type || 'other',
        phase_id:    phaseIdByName[a.phase_hint] || null,
        description: a.rationale || '',
      });
      if (created?.id) assetIdByName[a.name] = created.id;
    }
    for (const t of breakdown.tasks || []) {
      const assetId = assetIdByName[t.asset_hint];
      if (!assetId) continue;
      await addTask({
        asset_id:           assetId,
        title:              t.title,
        bid_days:           t.bid_days,
        priority:           t.priority || 'medium',
        assigned_position:  t.role,
        assigned_role_slug: t.role ? t.role.toLowerCase().replace(/[^a-z0-9]+/g, '_') : null,
      });
    }
    // Skip the run update if no runId was supplied. The intake
    // wizard accepts an ad-hoc breakdown without ever creating a
    // run row when the user uploads files in "preview only" mode,
    // and updateIngestionRun(null, …) would throw on every adapter.
    if (runId) {
      await adapterRef.current.updateIngestionRun(runId, {
        status: 'complete',
        project_id: activeProjectId,
        finished_at: new Date().toISOString(),
      });
    }
    setActiveIngestion(null);
  }, [activeProjectId, addPhase, addAsset, addTask]);

  const discardIngestion = useCallback(async (runId) => {
    if (!adapterRef.current || !activeProjectId) return;
    if (runId) {
      await adapterRef.current.updateIngestionRun(runId, {
        status: 'failed',
        project_id: activeProjectId,
        finished_at: new Date().toISOString(),
      });
    }
    setActiveIngestion(null);
  }, [activeProjectId]);

  // ── Background ingestion runner ─────────────────────────
  // Kicks off runIngestion() and stores live progress on the
  // provider so the toast + wizard view both observe it. Resolves
  // to the result so callers can await it; also stores the result
  // on `ingestionRun.result` for components mounted after the
  // run finishes.
  const startBackgroundIngestion = useCallback(async ({ files, personas }) => {
    if (!activeProjectId) throw new Error('no project');

    // Cancel any prior in-flight run.
    try { ingestionAbortRef.current?.abort() } catch { /* noop */ }
    const controller = new AbortController();
    ingestionAbortRef.current = controller;

    const projectIdAtStart = activeProjectId;
    const coreFiles = (files || []).filter(f => f && f.is_core_definer);

    setIngestionRun({
      phase:        'running',
      chunksDone:   0,
      chunksTotal:  0,
      lastLabel:    '',
      fileCount:    coreFiles.length,
      error:        null,
      result:       null,
      projectId:    projectIdAtStart,
      startedAt:    Date.now(),
    });

    try {
      const result = await runIngestion({
        projectId: projectIdAtStart,
        files,
        personas,
        signal: controller.signal,
        onProgress: (p) => {
          setIngestionRun(prev => prev ? { ...prev, ...p } : prev);
        },
      });
      setIngestionRun(prev => prev ? {
        ...prev,
        phase:  'done',
        result,
      } : prev);
      return result;
    } catch (err) {
      const msg = err?.message || String(err);
      setIngestionRun(prev => prev ? {
        ...prev,
        phase: 'error',
        error: msg,
      } : prev);
      throw err;
    }
  }, [activeProjectId]);

  const cancelBackgroundIngestion = useCallback(() => {
    try { ingestionAbortRef.current?.abort() } catch { /* noop */ }
    setIngestionRun(prev => prev ? { ...prev, phase: 'error', error: 'Cancelled.' } : prev);
  }, []);

  const dismissBackgroundIngestion = useCallback(() => {
    setIngestionRun(null);
  }, []);

  // ── revert-to-state (Session 7) ─────────────────────────
  // Executes buildRevertPlan(entry) through the ordinary mutators, so a
  // revert is optimistic, adapter-synced, captured in edit history AND
  // undoable — deliberately no bespoke DB machinery. Under LWW-per-field
  // this applies the inverse of ONE entry as the newest write; it does
  // not rewind later edits to other fields.
  const revertHistoryEntry = useCallback(async (entry) => {
    const plan = buildRevertPlan(entry);
    if (plan.kind === 'noop') return plan;
    if (plan.kind === 'unsupported') {
      throw new Error(plan.reason || 'This change cannot be reverted.');
    }
    const { table, id } = plan;
    const findLocal = () => {
      switch (table) {
        case 'projects': return projectsIndex[id]
          || (bundleRef.current.project?.id === id ? bundleRef.current.project : null);
        case 'phases': return bundleRef.current.phases.find(r => r.id === id);
        case 'assets': return bundleRef.current.assets.find(r => r.id === id);
        case 'tasks':  return bundleRef.current.tasks.find(r => r.id === id);
        default:       return null;
      }
    };
    const m = mutationsRef.current;

    if (plan.kind === 'inverse-patch') {
      if (!findLocal()) {
        throw new Error('That entity is deleted or unavailable — restore it before reverting field changes.');
      }
      if (table === 'projects') {
        await m.updateProject(id, plan.patch);
        // updateProject deliberately pushes no history (it serves DOG and
        // the Projects pages too) — push the revert's own entry here so
        // the drawer's "Ctrl+Z undoes them" contract holds for projects.
        pushHistory({
          undoOps: [() => mutationsRef.current.updateProject(id, plan.forwardPatch)],
          redoOps: [() => mutationsRef.current.updateProject(id, plan.patch)],
        });
      }
      else if (table === 'phases') await m.updatePhase(id, plan.patch);
      else if (table === 'assets') await m.updateAsset(id, plan.patch);
      else if (table === 'tasks')  await m.updateTask(id, plan.patch);
      return plan;
    }

    if (plan.kind === 'soft-delete') {
      if (!findLocal()) {
        throw new Error('That entity is already deleted or unavailable.');
      }
      if (table === 'projects')    await m.deleteProject(id);
      else if (table === 'phases') await m.deletePhase(id);
      else if (table === 'assets') await m.deleteAsset(id);
      else if (table === 'tasks')  await m.deleteTask(id);
      return plan;
    }

    if (plan.kind === 'restore') {
      const restoreFns = {
        projects: adapterRef.current?.restoreProject,
        phases:   adapterRef.current?.restorePhase,
        assets:   adapterRef.current?.restoreAsset,
        tasks:    adapterRef.current?.restoreTask,
      };
      const restore = restoreFns[table];
      if (typeof restore !== 'function') {
        throw new Error('This adapter cannot restore from the trash.');
      }
      const doRestore = async () => {
        const restored = await restore.call(adapterRef.current, id);
        // The RPC returns false when the row was ALREADY live (someone
        // restored it first). Treating that as success would push an
        // undo entry whose Ctrl+Z soft-deletes a live entity the user
        // never touched (adversarial-review finding).
        if (restored === false) {
          throw new Error('Nothing to restore — that entity is already live (someone may have restored it first).');
        }
        // The row and its transitively hidden children reappear
        // server-side only — refetch to pick them up.
        if (table === 'projects') await refreshProjectsIndex();
        return reloadActiveProject();
      };
      const fresh = await doRestore();
      // A restore can succeed in the DB yet stay invisible when a PARENT
      // is still in the trash (0014 hides subtrees via live-parent SELECT
      // policies, and the trash RPC does not check parent liveness).
      // Surface that instead of reporting a revert that changed nothing.
      const collection = { phases: 'phases', assets: 'assets', tasks: 'tasks' }[table];
      if (fresh && collection
          && !(fresh[collection] || []).some(r => r.id === id)) {
        throw new Error('Restored in the database, but still hidden — a parent entity is in the trash. Restore the parent to make it visible.');
      }
      // Symmetric undo: trash it again. The delete mutators run with
      // history suspended during replay, so no double-push / stray toast.
      pushHistory({
        undoOps: [async () => {
          if (table === 'projects')    await mutationsRef.current.deleteProject(id);
          else if (table === 'phases') await mutationsRef.current.deletePhase(id);
          else if (table === 'assets') await mutationsRef.current.deleteAsset(id);
          else if (table === 'tasks')  await mutationsRef.current.deleteTask(id);
        }],
        redoOps: [doRestore],
      });
      return plan;
    }

    if (plan.kind === 'recreate') {
      if (findLocal()) {
        throw new Error('That entity already exists — nothing to recreate.');
      }
      if (table === 'phases')      await m.addPhase(plan.row);
      else if (table === 'assets') await m.addAsset(plan.row);
      else if (table === 'tasks')  await m.addTask(plan.row);
      return plan;
    }

    throw new Error(`Unknown revert plan: ${plan.kind}`);
  }, [projectsIndex, refreshProjectsIndex, reloadActiveProject]);

  // ── Mutations ref refresh ───────────────────────────────
  // History closures call into mutationsRef.current so they always
  // hit the latest mutator implementation, not a captured stale one.
  mutationsRef.current.updateProject = updateProject;
  mutationsRef.current.deleteProject = deleteProject;
  mutationsRef.current.addPhase     = addPhase;
  mutationsRef.current.updatePhase  = updatePhase;
  mutationsRef.current.deletePhase  = deletePhase;
  mutationsRef.current.addAsset     = addAsset;
  mutationsRef.current.updateAsset  = updateAsset;
  mutationsRef.current.deleteAsset  = deleteAsset;
  mutationsRef.current.deleteAssets = deleteAssets;
  mutationsRef.current.addTask      = addTask;
  mutationsRef.current.updateTask   = updateTask;
  mutationsRef.current.deleteTask   = deleteTask;
  mutationsRef.current.deleteTasks  = deleteTasks;
  mutationsRef.current.linkTasks    = linkTasks;
  mutationsRef.current.linkPhases   = linkPhases;
  mutationsRef.current.unlinkTasks  = unlinkTasks;
  mutationsRef.current.addTaskLink  = addTaskLink;
  mutationsRef.current.removeTaskLink = removeTaskLink;
  mutationsRef.current.addScene       = addScene;
  mutationsRef.current.updateScene    = updateScene;
  mutationsRef.current.deleteScene    = deleteScene;
  mutationsRef.current.addShot        = addShot;
  mutationsRef.current.updateShot     = updateShot;
  mutationsRef.current.deleteShot     = deleteShot;
  mutationsRef.current.addLevel       = addLevel;
  mutationsRef.current.updateLevel    = updateLevel;
  mutationsRef.current.deleteLevel    = deleteLevel;
  mutationsRef.current.addExperience  = addExperience;
  mutationsRef.current.updateExperience = updateExperience;
  mutationsRef.current.deleteExperience = deleteExperience;
  mutationsRef.current.addMilestone     = addMilestone;
  mutationsRef.current.updateMilestone  = updateMilestone;
  mutationsRef.current.deleteMilestone  = deleteMilestone;

  // ── Memoized selectors ──────────────────────────────────
  const memoSelectors = useMemo(() => ({
    selectAssetsByPhase:        (phaseId) => selectAssetsByPhase(bundle.assets, phaseId),
    selectTasksByAsset:         (assetId) => selectTasksByAsset(bundle.tasks, assetId),
    selectAssetDerivedStatus:   (assetId) => selectAssetDerivedStatus(bundle.tasks, assetId),
    selectAssetStatusWarning:   (asset)   => selectAssetStatusWarning(asset, bundle.tasks),
    selectCriticalPath:         ()        => selectCriticalPath(bundle.tasks, bundle.dependencies),
    selectVarianceForAsset:     (assetId) => selectVarianceForAsset(bundle.tasks, assetId),
    selectVarianceForProject:   ()        => selectVarianceForProject(bundle.tasks),
    selectProjectBudgetRollup:  (opts = {}) => selectProjectBudgetRollup({
      tasks:    bundle.tasks,
      currency: bundle.project?.budget_currency || 'USD',
      ...opts,
    }),
  }), [bundle]);

  // ── Adapter accessor ─────────────────────────────────────
  // Returns the live adapter instance. Used by callers that need
  // to invoke adapter methods not wrapped by the provider (e.g.
  // workspace-level rate card CRUD lives outside the project bundle).
  const getAdapter = useCallback(() => adapterRef.current, []);

  // ── Context value ───────────────────────────────────────
  const value = useMemo(() => ({
    // identity
    adapterMode,
    adapterStatus,
    switchAdapter,
    refreshProjectsIndex,
    getAdapter,
    DEFAULT_WORKSPACE_ID,

    // data
    activeProjectId,
    projectsIndex,
    project:       bundle.project,
    phases:        bundle.phases,
    assets:        bundle.assets,
    tasks:         bundle.tasks,
    dependencies:  bundle.dependencies,
    taskLinks:     bundle.taskLinks,
    files:         bundle.files,
    assetVersions: bundle.assetVersions,
    comments:      bundle.comments,
    ingestionRuns: bundle.ingestionRuns,
    teamAssignments: bundle.teamAssignments,
    managedFiles:    bundle.managedFiles || [],
    budgetVersions:  bundle.budgetVersions || [],
    expenses:        bundle.expenses || [],
    budgetLines:     bundle.budgetLines || [],
    budgetActuals:   bundle.budgetActuals || [],
    projectTeam:     bundle.projectTeam || [],
    scenes:          bundle.scenes || [],
    shots:           bundle.shots || [],
    levels:          bundle.levels || [],
    experiences:     bundle.experiences || [],
    milestones:      bundle.milestones || [],
    loadingProject,
    error,

    // intake
    activeIngestion,
    startIngestion,
    acceptIngestion,
    discardIngestion,

    // background ingestion
    ingestionRun,
    startBackgroundIngestion,
    cancelBackgroundIngestion,
    dismissBackgroundIngestion,

    // project roster (supabase mode; [] / null elsewhere)
    projectMembers,
    refreshProjectMembers,
    addProjectMember,
    updateProjectMemberRole,
    updateProjectMemberTitle,
    removeProjectMember,
    myProjectRole,
    projectIsStaffed,

    // realtime (Session 7; 'off' outside cloud mode)
    realtimeStatus,
    presentUsers,
    reloadActiveProject,

    // workspace realtime (Session 8; 'off' outside cloud mode)
    workspaceRealtimeStatus,
    workspacePresentUsers,
    subscribeWorkspaceEvents,

    // revert-to-state (Session 7)
    revertHistoryEntry,

    // undo toast
    undoToast,
    dismissUndoToast,

    // actions
    createProject,
    updateProject,
    deleteProject,
    setActiveProject,
    addPhase, updatePhase, deletePhase, reorderPhases,
    addAsset, updateAsset, deleteAsset, deleteAssets, reorderAssets,
    addTask, updateTask, deleteTask, deleteTasks,
    linkTasks, linkPhases, unlinkTasks, unlinkDependency,
    addTaskLink, removeTaskLink,
    addTeamAssignment, updateTeamAssignment, removeTeamAssignment,
    syncProjectTeam,
    uploadFile, markFileCoreDefiner, patchFile,
    addManagedFile, updateManagedFile, deleteManagedFile, refreshManagedFiles,
    addScene, updateScene, deleteScene,
    addShot, updateShot, deleteShot,
    addLevel, updateLevel, deleteLevel,
    addExperience, updateExperience, deleteExperience,
    addMilestone, updateMilestone, deleteMilestone,

    // history
    undo, redo, runBatch, clearHistory, canUndo, canRedo,

    // selectors
    ...memoSelectors,
  }), [
    adapterMode, adapterStatus, switchAdapter, refreshProjectsIndex, getAdapter,
    activeProjectId, projectsIndex, bundle, loadingProject, error, activeIngestion,
    startIngestion, acceptIngestion, discardIngestion,
    ingestionRun, startBackgroundIngestion, cancelBackgroundIngestion, dismissBackgroundIngestion,
    projectMembers, refreshProjectMembers, addProjectMember, updateProjectMemberRole,
    updateProjectMemberTitle,
    removeProjectMember, myProjectRole, projectIsStaffed,
    realtimeStatus, presentUsers, reloadActiveProject, revertHistoryEntry,
    workspaceRealtimeStatus, workspacePresentUsers, subscribeWorkspaceEvents,
    undoToast, dismissUndoToast,
    createProject, updateProject, deleteProject, setActiveProject,
    addPhase, updatePhase, deletePhase, reorderPhases,
    addAsset, updateAsset, deleteAsset, deleteAssets, reorderAssets,
    addTask, updateTask, deleteTask, deleteTasks,
    linkTasks, linkPhases, unlinkTasks, unlinkDependency,
    addTaskLink, removeTaskLink,
    addTeamAssignment, updateTeamAssignment, removeTeamAssignment,
    syncProjectTeam,
    uploadFile, markFileCoreDefiner, patchFile,
    addManagedFile, updateManagedFile, deleteManagedFile, refreshManagedFiles,
    addScene, updateScene, deleteScene,
    addShot, updateShot, deleteShot,
    addLevel, updateLevel, deleteLevel,
    addExperience, updateExperience, deleteExperience,
    addMilestone, updateMilestone, deleteMilestone,
    undo, redo, runBatch, clearHistory, canUndo, canRedo,
    memoSelectors,
  ]);

  return <RabbitContext.Provider value={value}>{children}</RabbitContext.Provider>;
}

export function useRabbit() {
  return useContext(RabbitContext);
}

// Re-exports for direct selector use (testing, agent tools).
export {
  selectAssetsByPhase,
  selectTasksByAsset,
  selectProjectBudgetRollup,
  selectAssetDerivedStatus,
  selectAssetStatusWarning,
  selectCriticalPath,
  selectVarianceForAsset,
  selectVarianceForProject,
} from './selectors';
