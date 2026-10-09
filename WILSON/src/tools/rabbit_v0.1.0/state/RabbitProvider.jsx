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
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
// The context object lives in its own module (BC2): a leaf that only reads
// it — BinPoster — need not import this file, which builds the cloud client.
import { RabbitContext } from './rabbitContext';
// Session 26: the project folder's self-description. Built here from the
// loaded bundle and handed to the adapter, so both backends mirror the
// same shape — that is the one job a portable manifest has.
import { buildProjectManifest } from '../projectManifest';
import { isLegalFile, LEGAL_NOT_CORE_REASON } from '../fileTags';
import { selectAdapter, ADAPTER_MODES, adapterSupportsWrites } from '../adapters';
import { resetSupabaseAdapter } from '../adapters/supabaseAdapter';
// Bins on the cloud, the desktop signed in (BC2): the cloud's data, this
// computer's files — the composite and the client of the desktop's routes.
import { localServerAdapter } from '../adapters/localServerAdapter';
import { composeDesktopCloudBins } from '../adapters/desktopCloudBins';
import { needsCloudPoster, BIN_POSTERS_OFF_SENTENCE } from '../bins/cloudPosters';
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
import { byMilestoneDate } from './milestoneOrder';
import { buildRevertPlan } from '../components/editHistoryRevert';
import { hasLocalServer, loadOtterSettings, saveOtterSettings } from '../../../lib/localData';
import { devFixtures } from '../../../dev/devFixtures';
import { probeInBrowser } from '../bins/binProbeFallback';
import { previewKindFor, needsBrowserProbe, rowsToReprobeAfterRelink } from '../bins/binMedia';
// Shot lists and edits (post-overhaul S3a, migration 0084). The pure half —
// selectors, the D11 backfill order, the item-set plans every membership
// mutator writes — lives in shotListModel.js so it is testable without React.
import {
  activeShotListOf,
  activeScenesOf,
  activeShotsOf,
  scenesOfList,
  shotsOfList,
  listsContainingOf,
  editsOfList,
  editChainTip as editChainTipOf,
  unlistedScenesOf,
  unlistedShotsOf,
  editItemsFromList as editItemsFromListOf,
  itemsOf,
  nextShotListVersion as nextShotListVersionOf,
  nextEditVersion as nextEditVersionOf,
  formatShotListLabel,
  validateVersionedTitle,
  assertUniqueShotList,
  assertUniqueEdit,
  planAddToList,
  planRemoveFromList,
  planReorderList,
  planCopyList,
  planAllScenesAndShots,
  buildShotListSnapshot,
  normalizeEditItems,
  buildEditSnapshot,
  shotListWithdrawRefusal,
  editWithdrawRefusal,
  withdrawnRestoreRefusal,
  isWithdrawn,
} from './shotListModel';
import {
  draftKey, storedDraftKey, startDraft, changeDraft, undoDraft, redoDraft,
  storedCopy, draftFromCopy, readStoredDrafts, writeStoredDraft,
} from './editDrafts';
import { addLeaveGuard, confirmLeave, leaveGuardsChanged } from './leaveGuard';
// Post-overhaul S5: bid versions as living documents — the one pure answer
// for the snapshot, the open plan and "which version is selected".
import {
  snapshotFromLive, planOpen, readVersion, selectedVersionOf, sortVersionsNewest, previousVersionOf,
  versionDiff,
} from './budgetVersionModel';
// Post-overhaul S5b (0090): rows the open version does not hold are SET
// ASIDE — kept whole, hidden everywhere, brought back by a version that holds
// them (Audrey's ruling (a)). The one pure answer for that state.
import {
  splitSetAside, joinSetAside, holdersOf, workOn, removalOf, rowsInNoVersion, countRows,
} from './setAside';
import { removalToastWords, rowsWords } from './versionWords';
import { revertOwnChange } from './revertOwnChange';

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_ADAPTER_MODE = 'local_server';

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
  // Session 26 (migration 0041): the project folder tree. Adding a key here
  // means every adapter's loadProject must return it — see the pointer above
  // and adapters/loadProjectBundle.test.js, which fails when one does not.
  folders:        [],
  // The bin system (demo 2026-09-11, docs/BINS_DESIGN.md §4.4). Same rule:
  // every adapter's loadProject returns these or the spread resets them.
  bins:           [],
  binFiles:       [],
  binRoots:       [],
  shotTakes:      [],
  // Bins on the cloud (BC1, migration 0091): the company's footage locations
  // (a cloud clip is one of these plus a relative path). Same rule, in the
  // same three test lists below.
  binLocations:   [],
  // Shot lists and edits (post-overhaul S3a, migration 0084). Same rule, on
  // EVERY adapter: supabase, localServer, the dev fixtures — and the key
  // lists in loadProjectBundle.test.js (EXPECTED_KEYS),
  // supabaseLoadProject.test.js (CLOUD_BUNDLE_KEYS) and
  // rabbitFixturesAdapter.contract.test.js (BUNDLE_KEYS).
  shotLists:      [],
  shotListItems:  [],
  edits:          [],
  // Post-overhaul S5b (0090): the tasks, phases and key dates the open bid
  // version does not hold, and the edges on them — split out of the live
  // arrays by every adapter's loadProject (state/setAside.js), so no reader
  // of ctx.tasks / phases / milestones / dependencies sees them. Kept here so
  // an open can bring them back, the same rows, instead of re-making them.
  // Same rule as every key above, in the same three test lists.
  setAsideTasks:        [],
  setAsidePhases:       [],
  setAsideMilestones:   [],
  setAsideDependencies: [],
};

function indexById(rows) {
  const out = {};
  for (const r of rows || []) out[r.id] = r;
  return out;
}

// Bins on the cloud (BC1): what an adapter WITHOUT binsCapabilities() is
// read as — the signed-out desktop's answers, which is what every bins
// backend was before 0091 (and what the older test doubles still are).
// The real adapters each export their own object (CLOUD_BINS_CAPABILITIES,
// LOCAL_SERVER_BINS_CAPABILITIES); binsAdapterParity.test.js pins the keys.
const LEGACY_BINS_CAPABILITIES = Object.freeze({
  backend: 'legacy',
  pickFiles: true, probe: true, stream: true, resolveFiles: true, relink: true, openInOs: true,
  posters: 'local', locations: false, remoteViewingSwitch: false,
});

// The capability object of a bins backend. An adapter without
// binsCapabilities (an older test double) is read as the signed-out
// desktop: everything the loopback server does, nothing of a company's.
function binsCapabilitiesOf(a) {
  return (typeof a?.binsCapabilities === 'function' ? a.binsCapabilities() : null) || LEGACY_BINS_CAPABILITIES;
}

/**
 * BC2: a project load (or a realtime refetch) brings clip rows without
 * `online` — it is never stored; it is a fact about the reading computer.
 * What they read as depends on the backend:
 *   - one that cannot say what this computer can reach (the cloud in a
 *     browser, `resolveFiles: false`): every row is "not on this computer";
 *   - the desktop signed in (`backend: 'desktop_cloud'`): a row keeps what
 *     this computer last resolved for it, and a row it has not resolved yet
 *     reads "not on this computer" until the resolve lands — never "here"
 *     before anything has looked;
 *   - the signed-out desktop and the fixtures: untouched (B12).
 * Pure; `prevFiles` is the state the load replaces.
 */
export function markLoadedBinFiles(nextFiles, prevFiles, caps) {
  if (!Array.isArray(nextFiles) || !caps) return nextFiles;
  if (caps.resolveFiles === false) return nextFiles.map(f => ({ ...f, online: false }));
  if (caps.backend !== 'desktop_cloud') return nextFiles;
  const known = new Map((prevFiles || []).filter(f => typeof f?.online === 'boolean').map(f => [f.id, f.online]));
  return nextFiles.map(f => ({ ...f, online: known.has(f.id) ? known.get(f.id) : false }));
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
  const HISTORY_STEP_WAIT_MS = 20000;
  const historyRef = useRef({ undo: [], redo: [], suspended: false, batch: null });
  const [historyVersion, setHistoryVersion] = useState(0);
  const bundleRef = useRef(bundle);
  useEffect(() => { bundleRef.current = bundle; }, [bundle]);

  // ── Bins on the cloud, the desktop signed in (BC2) ──
  // The composite (adapters/desktopCloudBins.js): the cloud's DATA, this
  // computer's FILES. Built only when the backend is the cloud AND the
  // desktop's file process answers — window.electronAPI.rabbit and the
  // cloud-bins ping (the effect in the bins block). The predicate is never
  // the storage mode, and it picks no store: `supportsManagedFiles` decides
  // the FILES store and stays exactly as it was; bins are not files.
  // `desktopBinFiles` is { files, ping } (the Local Server adapter's
  // cloud-bins client and its answer) or null. binsBackend() is what every
  // bins call goes through: the composite when there is one, else the
  // adapter itself (the signed-out desktop, the browser, the fixtures).
  const [desktopBinFiles, setDesktopBinFiles] = useState(null);
  const desktopBinFilesRef = useRef(null);
  const desktopCompositeRef = useRef({ cloud: null, files: null, composite: null });
  // "The backend is the cloud": the provider's own mode, which the dev
  // fixtures share with the cloud adapter (they are the cloud in a dev
  // build), not the adapter object's name.
  const adapterModeRef = useRef(adapterMode);
  adapterModeRef.current = adapterMode;
  const binsBackend = useCallback(() => {
    const a = adapterRef.current;
    const d = desktopBinFilesRef.current;
    if (!a || !d || adapterModeRef.current !== 'supabase') return a;
    const memo = desktopCompositeRef.current;
    if (memo.cloud === a && memo.files === d && memo.composite) return memo.composite;
    const composite = composeDesktopCloudBins(a, d.files, {
      rowOf: (id) => (bundleRef.current.binFiles || []).find(f => f.id === id) || null,
      projectFps: () => Number(bundleRef.current.project?.fps) || 24,
      ping: d.ping,
    });
    desktopCompositeRef.current = { cloud: a, files: d, composite };
    return composite;
  }, []);
  // Asks the desktop again what this computer can reach (debounced; the
  // bins block defines it). Called after every load and for a teammate's
  // clip arriving live — a no-op where there is no composite.
  const scheduleBinResolveRef = useRef(null);
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
  // Post-overhaul S3c, step 4 (D13): true while the open project holds an
  // unsaved edit (a draft — see "Edit drafts" below). Ctrl+Z and Ctrl+Y stand
  // down then: the Scenes tab takes back the DRAFT's last change instead, and
  // an undo of a list change beneath a draft would move rows the draft was
  // made from. The undo toast's own Undo still runs (it names one step: a
  // shot's delete taken back is a "Missing shot" found again, D17).
  const editDraftHeldRef = useRef(false);

  // `visit` (S5b review round 1, R1-05): the project visit the step BEGAN
  // on (projectVisitRef, read before its first await). A step that finishes
  // after a project switch belongs to the project it began on, whose stack
  // is gone; pushed here it would sit on the NEW project's stack and its
  // Ctrl+Z would write into the old project. Dropped instead.
  function pushHistory(entry, visit) {
    if (historyRef.current.suspended) return null;
    if (visit !== undefined && visit !== projectVisitRef.current) return null;
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
    // Post-overhaul S5 review round 1 (R1-03): the batch and the stack it
    // lands on are THIS run's. A project switch (setActiveProject,
    // clearHistory, switchAdapter) replaces historyRef.current mid-run; the
    // steps gathered before it belong to the old project and are dropped,
    // never pushed onto the new one's stack (and a cleared slot no longer
    // throws "reading 'entries'" here).
    const mine = { entries: [] };
    const stack = historyRef.current;
    stack.batch = mine;
    try {
      return await fn();
    } finally {
      if (stack.batch === mine) stack.batch = null;
      const b = historyRef.current === stack ? mine : { entries: [] };
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

  // Undo, redo and the toast's targeted undo run ONE AT A TIME (review R1 of
  // 0086). Two quick Ctrl+Z presses used to run their ops concurrently: the
  // second (taking back "New list") checked the list while the first (taking
  // back "New edit" on it) was still in flight, was refused for a reason that
  // was about to stop being true, and its entry still moved to the redo
  // stack — the list could never be taken back by Ctrl+Z again. It is also
  // the "two un-awaited Ctrl+Z presses push a spurious entry" limit S3a
  // recorded. A press while one is running now waits its turn.
  // A step that never settles (a dropped request) must not wedge every later
  // press for the rest of the session (review R2): the queue waits for one
  // step at most HISTORY_STEP_WAIT_MS, counted from when THAT step starts
  // (review R3: counted from the press, the steps queued behind a slow one
  // got a shrunken wait and ran beside each other), then lets the next run.
  // Tests shorten the wait through the global named below.
  const historyQueueRef = useRef(Promise.resolve());
  function inHistoryQueue(fn) {
    const prev = historyQueueRef.current; // never rejects
    const run = prev.then(fn);
    historyQueueRef.current = prev.then(() => new Promise(resolve => {
      const timer = setTimeout(resolve, globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS ?? HISTORY_STEP_WAIT_MS);
      const done = () => { clearTimeout(timer); resolve(); };
      run.then(done, done);
    }));
    return run;
  }

  // Post-overhaul S5 review round 1 (R1-02): never while a composite holds
  // the batch. The queue waits for a step at most HISTORY_STEP_WAIT_MS, so a
  // long Save as new or Edit this version (or one stalled request) let an
  // undo run BESIDE it: it took back the step before the composite, and its
  // `suspended` replay dropped every step the composite still had to record.
  // A press then does nothing; the composite's own step lands when it ends.
  const undo = useCallback(() => inHistoryQueue(async () => {
    if (editDraftHeldRef.current) return;
    if (historyRef.current.batch) return;
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
  }), []);

  const redo = useCallback(() => inHistoryQueue(async () => {
    if (editDraftHeldRef.current) return;
    if (historyRef.current.batch) return;
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
  }), []);

  // Targeted undo — used by the undo toast so a toast click and a
  // Ctrl+Z can't double-fire the same entry. If the entry is still in
  // the undo stack, remove it and run its undoOps; if it has already
  // been undone (or aged past HISTORY_CAP), no-op.
  const undoHistoryEntry = useCallback((token) => inHistoryQueue(async () => {
    if (token == null) return;
    if (historyRef.current.batch) return; // R1-02, as undo

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
  }), []);

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

  const canUndo = historyVersion >= 0 && !editDraftHeldRef.current && historyRef.current.undo.length > 0;
  const canRedo = historyVersion >= 0 && !editDraftHeldRef.current && historyRef.current.redo.length > 0;

  // ── undo toast ──────────────────────────────────────────
  // One toast at a time — a new one replaces the previous (keyed so
  // the countdown restarts). Shape: { key, message, onUndo } | null.
  // Rendered by components/UndoToast.jsx at the Rabbit shell level;
  // every soft/undoable delete shows one instead of a confirm dialog.
  const [undoToast, setUndoToast] = useState(null);
  const undoToastKeyRef = useRef(0);
  // Post-overhaul S5b: while a composite runs its own inner deletes (the open's
  // Discard, a version's delete, Remove from this version beside a Delete),
  // each inner delete's toast would name one row and offer an Undo that cannot
  // work (a batched entry's token resolves nothing). The composite shows ONE
  // toast for its whole step instead.
  const quietToastsRef = useRef(0);

  // `{ hold: true }`: no deadline — the way back from a step that stopped part
  // way, which its question goes on promising (S5c review round 2, R2-09).
  const showUndoToast = useCallback((message, onUndo, opts) => {
    if (quietToastsRef.current > 0) return;
    setUndoToast({ key: ++undoToastKeyRef.current, message, onUndo, hold: !!opts?.hold });
  }, []);

  const dismissUndoToast = useCallback(() => setUndoToast(null), []);

  // Post-overhaul S5d review round 2 (R2-04): the toast's Undo WAITS while a
  // view says so — the Timeline holds it while a bid version is viewed (its
  // Undo is the live schedule's, which is not on screen). Held, not
  // dismissed: a toast raised by a step still in flight when the look began,
  // or a held "Stopped part way" toast, keeps its Undo for Current.
  // `undoHeld` is the reason in words, or null.
  const [undoHeld, setUndoHeld] = useState(null);
  const holdUndo = useCallback((reason) => setUndoHeld(reason || null), []);

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
      // (Dev fixtures need no branch here: they only exist under `vite dev`, where
      // there is no local server and this already picks 'supabase' — the slot the
      // fixtures adapter serves from adapters/index.js. `vite build --mode
      // development`, which electron:dev runs, is a production build to Vite.)
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
    const { data: sub } = sharedAuthedClient.auth.onAuthStateChange((event, session) => {
      setTimeout(async () => {
        // Who is signed in, on every backend (review R2 of 0086): the
        // withdraw maker test must never run as the previous account.
        if (event === 'SIGNED_OUT') {
          // Dev fixtures (dev builds only): no session; the user is the dataset's.
          setAuthUserId(import.meta.env.DEV ? (devFixtures()?.permissions?.userId ?? null) : null);
        }
        else if (event === 'SIGNED_IN' && session?.user?.id) setAuthUserId(session.user.id);
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
        // BC2: clip rows read as what this computer can reach (never stored).
        // BC3: the capability object is known the moment the project is
        // (review round 1: the Bins tab read a null object as the signed-out
        // desktop until the first list, and for good when that list failed).
        const caps = binsCapabilitiesOf(binsBackend());
        const binFiles = markLoadedBinFiles(next?.binFiles, null, caps);
        setBundle({ ...EMPTY_BUNDLE, ...next, ...(binFiles ? { binFiles } : {}) });
        binsCapsRef.current = caps;
        setBinsInfo(i => (i.capabilities === caps ? i : { ...i, capabilities: caps }));
        scheduleBinResolveRef.current?.();
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
      // allSettled (review R1 of 0086): a failed roster read must not leave
      // the user unknown — the withdraw maker test reads authUserId too.
      const [sessRes, rowsRes] = await Promise.allSettled([
        sharedAuthedClient.auth.getSession(),
        adapterRef.current.listProjectMembers(activeProjectId),
      ]);
      if (!rosterMountedRef.current || seq !== rosterReqSeqRef.current) return;
      if (sessRes.status === 'fulfilled') {
        const sess = sessRes.value?.data;
        // Dev fixtures (dev builds only): there is no session; the reviewer's id is the dataset's.
        setAuthUserId(sess?.session?.user?.id ?? (import.meta.env.DEV ? (devFixtures()?.permissions?.userId ?? null) : null));
      }
      const rows = rowsRes.status === 'fulfilled' ? rowsRes.value : null;
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
  // Bins on the cloud (BC1): the backend's capability object for bins, as
  // the last refreshBins read it (see the bins block). Read here by the
  // realtime handler: a bin_files row arriving from a backend that cannot
  // say whether this computer can reach the file is marked "not on this
  // computer", as the rows of a load are.
  const binsCapsRef = useRef(null);

  const reloadActiveProject = useCallback(async () => {
    const pid = activeProjectIdRef.current;
    if (!adapterRef.current || !pid) return null;
    const loadSeq = ++bundleLoadSeqRef.current;
    // A shot-list or edit write that lands while this load is in flight makes
    // the load's three collections stale: keep the ones on screen (review R3
    // of 0086 — a reload begun before a withdraw showed the list live again
    // and ended the "Recently removed" mark).
    const listWriteSeq = shotListWriteSeqRef.current;
    try {
      const next = await adapterRef.current.loadProject(pid);
      // The user may have switched projects (or a newer load started)
      // while the fetch was in flight — landing stale data would show
      // the wrong project or wipe fresher state.
      if (activeProjectIdRef.current !== pid || loadSeq !== bundleLoadSeqRef.current) {
        return null;
      }
      const listsStale = listWriteSeq !== shotListWriteSeqRef.current;
      // BC2: a refetch's clip rows keep what this computer resolved for them
      // (a teammate's edit must not make every clip read "here" or "not here").
      const binCaps = binsCapabilitiesOf(binsBackend());
      setBundle(prev => {
        const binFiles = markLoadedBinFiles(next?.binFiles, prev.binFiles, binCaps);
        const merged = { ...EMPTY_BUNDLE, ...next, ...(binFiles ? { binFiles } : {}) };
        return listsStale
          ? { ...merged, shotLists: prev.shotLists, shotListItems: prev.shotListItems, edits: prev.edits }
          : merged;
      });
      scheduleBinResolveRef.current?.();
      if (!listsStale) unmarkIfServerShowsLive(next.shotLists, next.edits);
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
    // BC1: a teammate's clip arrives without `online` (never stored); on a
    // backend that cannot resolve files it is marked as the load marks it.
    if (evt?.table === 'bin_files' && evt.record && binsCapsRef.current && binsCapsRef.current.resolveFiles === false) {
      evt = { ...evt, record: { ...evt.record, online: false } };
    }
    // BC2, the desktop signed in: a teammate's clip arrives without `online`
    // too. It keeps what this computer last resolved for that row, else
    // reads "not on this computer" until the desktop has been asked — which
    // is scheduled here, for this row.
    else if (evt?.table === 'bin_files' && evt.record?.id && binsCapsRef.current?.backend === 'desktop_cloud' && typeof evt.record.online !== 'boolean') {
      const was = (bundleRef.current.binFiles || []).find(f => f.id === evt.record.id);
      evt = { ...evt, record: { ...evt.record, online: typeof was?.online === 'boolean' ? was.online : false } };
      scheduleBinResolveRef.current?.([evt.record.id]);
    }
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
    let versionsRefetch = false;
    for (const eff of effects) {
      if (eff.type === 'roster') {
        roster = true;
      } else if (eff.type === 'refetch') {
        refetch = true;
      } else if (eff.type === 'versions-refetch') {
        // S5b: another window opened or closed a bid version (realtimeMerge).
        versionsRefetch = true;
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
    // Through mutationsRef: refreshBudgetVersions is defined further down.
    if (versionsRefetch && !refetch) mutationsRef.current.refreshBudgetVersions?.();
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
      // Post-overhaul S5d review round 2 (R2-02): the write takes back ITS OWN
      // change (state/revertOwnChange.js), read off its mutator run on the
      // snapshot — not the whole snapshot, which erased every write and version
      // step that landed while it was in flight (a second drag that succeeded;
      // the rows an open set aside), and the next Save wrote that stale
      // schedule into the open version.
      const applied = mutator(snapshot);
      setBundle(prev => revertOwnChange(prev, snapshot, applied));
      // Post-overhaul S5d review round 1 (R1-01): the ref rolls back WITH the
      // state. bundleRef catches up in an effect, after a render; over a real
      // network a render has run between the optimistic drop and this failure,
      // so the ref still held the dropped bundle, and a compensation reading it
      // at once (deleteTasks' R2-01 catch, then deleteBroughtBack's set-aside)
      // found none of the rows it had to set aside again: another bid's rows
      // stayed live under the open version. (A microtask-paced test never
      // rendered between the two, and passed.)
      bundleRef.current = revertOwnChange(bundleRef.current, snapshot, applied);
      // The snapshot predates any realtime events merged during the
      // in-flight write — with live sync up, a failed local write must
      // not erase collaborators' changes; refetch to reconverge.
      if (realtimeLiveRef.current) scheduleRealtimeRefetch();
      setError(err.message || String(err));
      throw err;
    }
  }, [scheduleRealtimeRefetch]);

  // ── Projects (mutators on the index, not the bundle) ────
  // 🚨 DECLARED BEFORE THE FOLDER CALLBACKS, AND THAT ORDER IS LOAD-BEARING.
  // ensureProjectFoldersFor lists writeManifestSoon in its useCallback
  // dependency array, and a dependency array is evaluated DURING RENDER —
  // not lazily when the callback runs. Declaring this below it put
  // writeManifestSoon in the temporal dead zone on the very first render, so
  // RabbitProvider threw ReferenceError and the whole app rendered blank.
  //
  // Neither 658 unit tests nor two production builds caught it: nothing in
  // the vitest suite MOUNTS the provider, and a TDZ error is perfectly valid
  // JavaScript to bundle. Playwright caught it, which is the only reason
  // that job exists.
  // The project manifest — a generated MIRROR written into the project
  // folder whenever settings change (Audrey, 2026-08-03; the database stays
  // authoritative). projectManifest.js records what it leaves out and why.
  //
  // DEBOUNCED, because updateProject fires per FIELD: the control panel's
  // inputs each write on change, so a settings pass would otherwise upload
  // one object per keystroke-ish edit. 1.5s after the last write is soon
  // enough for a file nothing reads during normal operation.
  const manifestTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(manifestTimerRef.current), []);

  const writeManifestSoon = useCallback((projectId) => {
    const adapter = adapterRef.current;
    // Feature-detect: Drive is read-only, and an older client has no method.
    if (!adapter || !projectId || typeof adapter.writeProjectManifest !== 'function') return;
    clearTimeout(manifestTimerRef.current);
    manifestTimerRef.current = setTimeout(async () => {
      // The project may have been switched during the wait. Writing then
      // would describe project A into project B's folder.
      if (activeProjectIdRef.current !== projectId) return;
      try {
        const b = bundleRef.current;
        await adapter.writeProjectManifest(
          projectId,
          buildProjectManifest(b?.project, b, new Date().toISOString()),
        );
      } catch (err) {
        console.warn(
          `[rabbit] could not write the project manifest for ${projectId}: ` +
          `${err.message || err}. The settings themselves are saved — the ` +
          `manifest is a mirror and is rewritten on the next change.`
        );
      }
    }, 1500);
  }, []);


  // ── Folder tree (Session 26, migration 0041) ─────────────
  //
  // Audrey: R.A.B.B.I.T. is also a project file manager, and the tree must
  // reflect in whichever storage backend the company selected. The adapters
  // do the work; these two decide WHEN, and what a failure means.
  //
  // 🚨 FOLDER FAILURES DO NOT FAIL THE THING THAT NEEDED THE FOLDER.
  // Creating a scene is the user's goal; the folder is a consequence. If the
  // folder write fails — a client running ahead of 0041, Drive's read-only
  // stubs, a dropped connection — the scene must still be created, and the
  // next create or reload reconciles the tree. The opposite policy would turn
  // "no folders yet" into "nothing can be created", which is the S23 failure
  // shape with a new cause.
  //
  // It is warned about rather than swallowed. `sanitize`'s dropped-key
  // warning is the house precedent: the message names what to do about it.
  const mergeFolder = useCallback((row) => {
    if (!row) return;
    setBundle(prev => {
      const rest = (prev.folders || []).filter(f => f.id !== row.id);
      return { ...prev, folders: [...rest, row].sort((a, b) => a.path.localeCompare(b.path)) };
    });
  }, []);

  const ensureProjectFoldersFor = useCallback(async (projectId, project) => {
    const adapter = adapterRef.current;
    // Feature-detect: Drive is read-only and a client older than this session
    // has no such method. Both are "no tree here", not an error.
    if (!adapter || !projectId || typeof adapter.ensureProjectFolders !== 'function') return null;
    try {
      const res = await adapter.ensureProjectFolders(projectId, project);
      const rows = res?.folders || res || [];
      if (projectId === activeProjectIdRef.current && Array.isArray(rows)) {
        setBundle(prev => ({ ...prev, folders: rows }));
      }
      // The manifest carries the tree, so a rebuilt tree makes it stale.
      writeManifestSoon(projectId);
      return rows;
    } catch (err) {
      console.warn(
        `[rabbit] could not create the folder tree for project ${projectId}: ` +
        `${err.message || err}. The project is unaffected; the tree is rebuilt ` +
        `the next time an asset, scene, shot, level or experience is created.`
      );
      return null;
    }
  }, [writeManifestSoon]);

  const ensureEntityFolderFor = useCallback(async (entityType, entity) => {
    const adapter = adapterRef.current;
    const projectId = activeProjectIdRef.current;
    if (!adapter || !projectId || typeof adapter.ensureEntityFolder !== 'function') return null;
    try {
      const fk = `${entityType}_id`;
      const had = (bundleRef.current?.folders || []).find(f => f && f[fk] && String(f[fk]) === String(entity?.id));
      const row = await adapter.ensureEntityFolder(
        projectId, bundleRef.current?.project, entityType, entity,
      );
      // A RENAME re-paths the rows under the folder too (a scene's shot
      // folders since S4c), and the adapter answers only the folder's own
      // row: read the tree again so the shots' Folder lines and the Files
      // tab say the new path at once (round 2, item 6). A new row, or a
      // name unchanged, merges as before.
      if (row && had && had.path !== row.path && typeof adapter.listFolders === 'function') {
        let folders = null;
        try { folders = await adapter.listFolders(projectId); } catch { folders = null; }
        if (Array.isArray(folders) && activeProjectIdRef.current === projectId) {
          setBundle(prev => ({ ...prev, folders }));
          return row;
        }
      }
      mergeFolder(row);
      return row;
    } catch (err) {
      console.warn(
        `[rabbit] could not create the folder for ${entityType} ` +
        `"${entity?.name || entity?.id}": ${err.message || err}. The ` +
        `${entityType} itself was saved.`
      );
      return null;
    }
  }, [mergeFolder]);

  // ── Post-overhaul S4c: the one-time re-filing of the open project's shot
  // folders into their scenes' folders (shotRefiling.js; the adapter does the
  // moving). Not an undoable edit — it moves real objects and directories —
  // so it keeps no history entry. Afterwards the three lists the explorer
  // reads are read again from the adapter, so what is on screen is what the
  // backend now holds (the cloud adapter's rows may have moved under rows the
  // bundle still has by their old keys).
  const refileShotFolders = useCallback(async (opts = {}) => {
    const adapter = adapterRef.current;
    const projectId = activeProjectIdRef.current;
    if (!adapter || !projectId) throw new Error('no project');
    if (typeof adapter.refileShotFolders !== 'function') throw new Error('This backend cannot move folders.');
    const result = await adapter.refileShotFolders(projectId, bundleRef.current?.project, opts);
    const safe = async (fn) => { try { return typeof fn === 'function' ? await fn(projectId) : null; } catch { return null; } };
    const [folders, files, managedFiles] = await Promise.all([
      safe(adapter.listFolders?.bind(adapter)),
      safe(adapter.listFiles?.bind(adapter)),
      safe(adapter.listManagedFiles?.bind(adapter)),
    ]);
    if (activeProjectIdRef.current === projectId) {
      setBundle(prev => ({
        ...prev,
        ...(Array.isArray(folders) ? { folders } : {}),
        ...(Array.isArray(files) ? { files } : {}),
        ...(Array.isArray(managedFiles) ? { managedFiles } : {}),
      }));
      // The manifest mirrors the folder tree (projectManifest.js): rewritten
      // for the tree the move just changed (review round 1, item 13).
      writeManifestSoon(projectId);
    }
    return result;
  }, [writeManifestSoon]);

  // ── Backfill the tree for a project that predates 0041 (Session 27) ────
  //
  // 🚨 MEASURED 2026-08-04: public.folders had ZERO rows on dev, staging AND
  // prod, while dev held 3 live projects and staging 1. The tree S26 built had
  // never materialised anywhere.
  //
  // The cause was not a bug — it was that ensureProjectFoldersFor had exactly
  // ONE caller, createProject. Every project in existence predates 0041, so
  // the only way any of them could get a tree was for someone to happen to
  // create an asset/scene/shot/level/experience, which is what triggers
  // ensureEntityFolderFor and its root backfill. Nobody had.
  //
  // That was survivable while nothing displayed the tree. S27 puts it on
  // screen, and a folder view that is empty for every project that already
  // exists reads as broken software rather than as an unreconciled project.
  //
  // Idempotent and cheap: it fires only when a loaded bundle has NO folders at
  // all, and ensureProjectFolders reads before it inserts. Read-only backends
  // are skipped rather than allowed to throw once per project open — Drive
  // implements the method as a thrower, so the feature-detect inside
  // ensureProjectFoldersFor does not catch this case.
  //
  // Declared HERE, below both folder callbacks, and that is load-bearing for
  // the same reason recorded above createProject: a dependency array is
  // evaluated DURING RENDER, so naming ensureProjectFoldersFor from an effect
  // declared above it puts the callback in the temporal dead zone and the
  // whole provider throws on first render. That shipped once already (S26,
  // fixed in ca27d47) and three of four CI jobs went green on it.
  const loadedProjectId = bundle.project?.id || null;
  const loadedFolderCount = (bundle.folders || []).length;
  useEffect(() => {
    if (!loadedProjectId || loadedProjectId !== activeProjectId) return;
    if (loadedFolderCount > 0) return;
    if (!adapterSupportsWrites(adapterMode)) return;
    ensureProjectFoldersFor(loadedProjectId, bundleRef.current?.project);
  }, [loadedProjectId, activeProjectId, loadedFolderCount, adapterMode, ensureProjectFoldersFor]);

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
    // Session 26: a new project gets its folder tree immediately, so the
    // structure exists before the first asset does. Non-blocking for the
    // reason ensureFoldersFor explains — a project is not a failure because
    // a folder row is.
    ensureProjectFoldersFor(created.id, created);
    return created;
  }, [ensureProjectFoldersFor]);

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
    // Session 26: the folder's copy of the settings follows the database's.
    // Debounced — see writeManifestSoon; this fires per FIELD.
    writeManifestSoon(id);
    return updated;
  }, [activeProjectId, notePendingFields, clearPendingFields, writeManifestSoon]);

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
    // S5c review round 1 (R1-04, the second look at S5b's R1-05): a create
    // that answers after a project switch belongs to the project it began on
    // — merged here it showed in the other project, and its undo step (a
    // delete by id) trashed it from there. Its row is in its own project.
    const visit = projectVisitRef.current;
    const row = {
      id:           phase.id || uuidv4(),
      project_id:   activeProjectId,
      sort_order:   bundleRef.current.phases.length,
      ...phase,
    };
    const created = await adapterRef.current.upsertPhase(row);
    const finalRow = created || row;
    if (projectVisitRef.current !== visit) return finalRow;
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
    }, visit);
    return finalRow;
  }, [activeProjectId]);

  const updatePhase = useCallback(async (id, patch) => {
    const visit = projectVisitRef.current;
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
      }, visit);
    }
    return result;
  }, [optimistic, notePendingFields, clearPendingFields]);

  const deletePhase = useCallback(async (id) => {
    const visit = projectVisitRef.current;
    const oldPhase = bundleRef.current.phases.find(p => p.id === id);
    // Migration 0061 gave phase→phase edges a real table, so deletePhase now
    // has to do what deleteTask has always done: strip the matching edges and
    // capture them for undo. Before 0061 phase edges could not exist in cloud
    // at all, so nothing pruned them.
    //
    // This prunes the CLIENT bundle. The backends differ:
    // Cloud: 0061's ON DELETE CASCADE covers a hard delete, and a soft-deleted
    // phase deliberately KEEPS its edges so they come back on restore. Desktop:
    // since Track A A2 (2026-09-06) the generic rabbitSubentityRoutes DELETE for
    // phases and tasks sweeps the edges in the same write (sweepDependencyEdges
    // in electron/main.cjs, replay-tested by desktopDeleteSweep.test.js), so
    // the orphans that used to return from project.json on the next load no
    // longer exist. The client prune stays: it is what the screen shows
    // between the click and the reload, and what undo restores from.
    //
    // Matching on id alone (not on kind) mirrors deleteTask exactly. The ids
    // are uuids, so a task edge cannot collide with a phase id.
    const removedDeps = bundleRef.current.dependencies.filter(
      d => d.predecessor_id === id || d.successor_id === id,
    );
    // Soft-aware: supabase soft-deletes (0014) so undo restores the DB
    // row and reinstates the captured row locally; local mode keeps the
    // re-insert undo path.
    //
    // Note the DB does NOT cascade here: 0061's ON DELETE CASCADE fires only on
    // a HARD delete, and a soft-deleted phase leaves its edges in place. That is
    // deliberate — the edges come back with the phase on restore. The loader
    // hides them meanwhile, because its `!inner` embed drops any edge whose
    // parent phase is no longer visible.
    const canSoftDelete = typeof adapterRef.current?.restorePhase === 'function';
    const result = await optimistic(
      prev => ({
        ...prev,
        phases:       prev.phases.filter(p => p.id !== id),
        dependencies: prev.dependencies.filter(
          d => d.predecessor_id !== id && d.successor_id !== id,
        ),
      }),
      () => adapterRef.current.deletePhase(id, activeProjectId),
    );
    if (oldPhase) {
      const token = pushHistory({
        undoOps: canSoftDelete
          ? [async () => {
              await adapterRef.current.restorePhase(id);
              setBundle(prev => ({
                ...prev,
                phases:       [...prev.phases, oldPhase],
                dependencies: [...prev.dependencies, ...removedDeps],
              }));
            }]
          : [
              () => mutationsRef.current.addPhase(oldPhase),
              ...removedDeps.map(d => async () => {
                // Re-insert the row directly so id + kind survive, bypassing
                // the link* helpers' fresh-uuid path.
                await optimistic(
                  prev => ({ ...prev, dependencies: [...prev.dependencies, d] }),
                  () => adapterRef.current.upsertDependency(d),
                );
              }),
            ],
        redoOps: [() => mutationsRef.current.deletePhase(id)],
      }, visit);
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
    // S5c review round 2 (R2-07): R1-04's fault in a create it missed — one
    // answering after a project switch merged into the other project, and its
    // undo (a delete by id) landed on that project's stack: Ctrl+Z there
    // trashed this project's asset. Its row stays in its own project; its
    // folder comes with that project's next load (ensureEntityFolderFor
    // writes into the OPEN project, so it is not called here).
    const visit = projectVisitRef.current;
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
    if (projectVisitRef.current !== visit) return finalRow;
    // Upsert, not append — see addPhase (broadcast echo race).
    setBundle(prev => ({
      ...prev,
      assets: prev.assets.some(a => a.id === finalRow.id)
        ? prev.assets.map(a => (a.id === finalRow.id ? { ...a, ...finalRow } : a))
        : [...prev.assets, finalRow],
    }));
    // Session 26: assets are the fifth entity with a folder of their own. The
    // Local Server has created the DIRECTORY since long before this session
    // (electron/main.cjs ensureAssetFolder); this records the ROW, on both
    // backends, so an asset folder is part of the same tree as a scene's.
    ensureEntityFolderFor('asset', finalRow);
    pushHistory({
      undoOps: [() => mutationsRef.current.deleteAsset(finalRow.id)],
      redoOps: [() => mutationsRef.current.addAsset(finalRow)],
    }, visit);
    return finalRow;
  }, [activeProjectId, ensureEntityFolderFor]);

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
    // Session 26: renaming an asset already moved its directory on Local
    // Server; the folder row follows so the two do not drift apart.
    if (patch?.name !== undefined) {
      ensureEntityFolderFor('asset', { ...oldAsset, ...patch, id });
    }
    if (oldAsset) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateAsset(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateAsset(id, patch)],
      });
    }
    return result;
  }, [optimistic, notePendingFields, clearPendingFields, ensureEntityFolderFor]);

  // S5b review round 1 (R1-01): an asset is never set aside, but its tasks
  // can be. On the cloud a task is seen THROUGH its asset (0034's
  // tasks_select hops to it) and tasks.asset_id cascades: deleting the asset
  // would hide its set-aside tasks for good — no version could bring them
  // back — and the purge would destroy them, logged days and links with them,
  // a month later. In the open version such an asset can look empty. So the
  // delete is refused, by name, until those tasks are dealt with in a
  // version that holds them.
  function refuseAssetDeleteOverSetAside(ids) {
    const want = new Set(ids.map(String));
    const held = (bundleRef.current.setAsideTasks || []).filter(t => t.asset_id != null && want.has(String(t.asset_id)));
    if (!held.length) return;
    const names = held.slice(0, 4).map(t => `“${t.title || 'Untitled'}”`);
    const more = held.length > 4 ? ` and ${held.length - 4} more` : '';
    const n = held.length;
    const msg = `${n === 1 ? 'A task on this asset is' : `${n} tasks on ${ids.length === 1 ? 'this asset' : 'these assets'} are`} set aside — not part of the open bid version, kept for the versions that hold ${n === 1 ? 'it' : 'them'}: ${names.join(', ')}${more}. Deleting the asset would take ${n === 1 ? 'it' : 'them'} with it for good. Edit a bid version that holds ${n === 1 ? 'it' : 'them'} and delete ${n === 1 ? 'it' : 'them'}, or move ${n === 1 ? 'it' : 'them'} to another asset, first.`;
    setError(msg);
    throw new Error(msg);
  }

  const deleteAsset = useCallback(async (id) => {
    refuseAssetDeleteOverSetAside([id]);
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
    refuseAssetDeleteOverSetAside(ids);
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

  // ── Shot lists and edits (post-overhaul S3a, migration 0084) ───────────
  //
  // Audrey's rulings (docs/design/POST_OVERHAUL_PLAN.md §0.1):
  //   D1 + D3  a list is MEMBERSHIP (shotListItems), not copies. A scene's or
  //            shot's name, notes, status and thumbnail are shared by every
  //            list that contains it; only membership and order are per list.
  //   D10      ctx.scenes / ctx.shots are the ACTIVE list's rows (every row
  //            when there is no active list); scenesOf(listId) /
  //            shotsOf(listId) serve the list the Scenes tab is VIEWING;
  //            unlistedScenes / unlistedShots hold rows in no LIVE list (the
  //            picker's "Not in any list (N)" entry, Audrey 2026-09-30).
  //   D4/D18   lists and edits are archived, never deleted; the active list
  //            cannot be archived; the UI verbs refuse an archived list (its
  //            membership is not frozen in the database — a delete's undo
  //            must be able to put a row back; review round 2).
  //   D6       an edit is one step of ONE linear chain per list.
  //   D8       set active and archive are a project manager's or a workspace
  //            admin's (the database refuses anyone else; the Local Server has
  //            no roles, so there it is a label). 0086: a row's MAKER may also
  //            WITHDRAW it (archive it) while it is untouched — withdrawShotList
  //            / withdrawEdit below.
  //
  // 🚨 MEMBERSHIP IS WRITTEN AS DELTAS (review round 1, HIGH). Items are not
  // broadcast, so this client's view of a list goes stale while a collaborator
  // edits it; the first design wrote a whole list from that view and deleted
  // their newer items. Every change now writes ONLY the rows it names
  // (adapter.upsertShotListItems) or deletes ONLY the ids it names
  // (adapter.deleteShotListItems), a reorder MOVES only rows that exist
  // (adapter.repositionShotListItems — positions only, never an insert, so a
  // stale view cannot resurrect a row a collaborator removed; round 2), and
  // each undo does the inverse on the same rows. Adds and removals are
  // SERVER-FIRST, not optimistic(): optimistic() rolls back to a bundleRef
  // snapshot that lags a render behind, and rolling back a failed membership
  // write erased the scene addScene had just saved. A reorder IS applied
  // locally first (drag-and-drop must not wait a round trip) and, on failure,
  // only the moved rows' positions are put back.
  //
  // Creating a list or an edit cannot be undone by deleting it (nothing is
  // ever deleted): its undo WITHDRAWS it (0086, Audrey 2026-09-30) — the
  // maker sets the new row aside while it is untouched, which the database
  // allows the maker while they may still write shot lists there (any seat
  // that writes lists, reviewers included), so a member's Ctrl+Z works too
  // and nobody needs { undoable: false } for it any more. Right after, the row is
  // ctx.recentlyWithdrawn ("Recently removed": openable, restorable) until
  // the Scenes tab calls clearRecentlyWithdrawn(). See "Withdraw" below.
  //
  // The helpers are FUNCTION DECLARATIONS on purpose: hoisted, so addScene /
  // deleteScene below can call them without a temporal-dead-zone hazard (the
  // ordering trap the comment above writeManifestSoon records). They read
  // refs and the stable setBundle only — no captured render state.

  function shotListAdapter() {
    const a = adapterRef.current;
    if (!a || typeof a.upsertShotListItems !== 'function') {
      throw new Error('Shot lists are not available on this backend.');
    }
    return a;
  }

  function findShotList(id) {
    return (bundleRef.current.shotLists || []).find(l => l.id === id) || null;
  }

  function findEdit(id) {
    return (bundleRef.current.edits || []).find(e => e.id === id) || null;
  }

  // A list that exists and is not archived — refused BEFORE any write, in the
  // backend's own words.
  function requireEditableShotList(id) {
    const list = findShotList(id);
    if (!list) throw new Error('shot list not found');
    if (list.archived_at) throw new Error('this shot list is archived — restore it before changing it');
    return list;
  }

  // Merge a server row into one collection — only while the project the
  // write started in is still the open one.
  function putRow(key, row, pid) {
    if (!row || !row.id) return;
    if (pid && activeProjectIdRef.current !== pid) return;
    const merge = (b) => {
      const arr = b[key] || [];
      const i = arr.findIndex(r => r.id === row.id);
      return { ...b, [key]: i < 0 ? [...arr, row] : arr.map(r => (r.id === row.id ? row : r)) };
    };
    setBundle(prev => merge(prev));
    // bundleRef trails setBundle by a render; the next step of the same flow
    // (Ctrl+Z taking back "New list" right after "New edit") must see this
    // row now (review R1 of 0086), as refreshShotListsNow already does.
    bundleRef.current = merge(bundleRef.current);
    if (key === 'shotLists') unmarkIfServerShowsLive([row], null);
    else if (key === 'edits') unmarkIfServerShowsLive(null, [row]);
  }

  // Re-read the three collections from the backend (after a refused or
  // conflicting membership write, and when the project names an active list
  // this client has not loaded). Exposed as ctx.refreshShotLists.
  // Every membership write bumps this; a refresh that started before a write
  // finished must not land over it (review round 2: the convergence refresh
  // replaced all three collections and could erase a later successful write).
  // Since 0086's review R2 every ROW write (a list or edit created, changed,
  // archived, withdrawn or restored) bumps it too. Only writes bump it.
  //
  // Review R3: a read that a write overtook used to return null, and its
  // callers took that as final (the unknown-active effect never retried, a
  // new scene landed in no list). Now a read a write overtook is read AGAIN
  // (three tries in all); the newest read started wins, and an older one
  // hands back the newer one's result instead of landing.
  const shotListWriteSeqRef = useRef(0);
  const shotListReadSeqRef = useRef(0);
  const shotListReadRef = useRef(null);

  function refreshShotListsNow() {
    const pid = activeProjectIdRef.current;
    const a = adapterRef.current;
    if (!pid || !a || typeof a.listShotLists !== 'function') return Promise.resolve(null);
    const readSeq = ++shotListReadSeqRef.current;
    const run = (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const writeSeq = shotListWriteSeqRef.current;
        const [lists, items, edits] = await Promise.all([
          a.listShotLists(pid),
          a.listShotListItems(pid),
          typeof a.listEdits === 'function' ? a.listEdits(pid) : Promise.resolve(bundleRef.current.edits || []),
        ]);
        if (activeProjectIdRef.current !== pid) return null;
        if (readSeq !== shotListReadSeqRef.current) return shotListReadRef.current;
        if (writeSeq !== shotListWriteSeqRef.current) continue;
        const next = { shotLists: lists || [], shotListItems: items || [], edits: edits || [] };
        setBundle(prev => ({ ...prev, ...next }));
        // bundleRef trails setBundle by a render; the caller that awaited this
        // (addScene placing a row in a list it just learned of) reads it NOW.
        bundleRef.current = { ...bundleRef.current, ...next };
        unmarkIfServerShowsLive(next.shotLists, next.edits);
        return { lists, items, edits };
      }
      return null;
    })();
    shotListReadRef.current = run;
    return run;
  }

  function reportShotListError(err) {
    setError(err?.message || String(err));
    // Converge: whatever the server kept is what this client should show.
    refreshShotListsNow().catch(() => {});
  }

  // "Save" writes a snapshot that carries saved_at. Two snapshots are the
  // same Save when both are empty or both carry the same saved_at.
  function sameSave(a, b) {
    const empty = (v) => v == null || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
    if (empty(a) || empty(b)) return empty(a) && empty(b);
    return !!a.saved_at && a.saved_at === b.saved_at;
  }

  // The undo (and the redo) of a Save writes `values` back only while the
  // stored snapshot is still `expected` — what that Save, or its undo, left.
  // A teammate's Save in between is not erased (review R2 of 0086: the erase
  // also made the row read untouched, so a further Ctrl+Z could withdraw
  // what a teammate had Saved). Lists and edits are not broadcast, so it
  // re-reads them first; if it cannot, it changes nothing. The check and the
  // write are two requests: a Save that lands between them is still
  // overwritten (review R3; closing that needs a conditional write in each
  // backend — recorded in the hand-off's known limits).
  async function rewriteSaveIfStill(kind, id, expected, values) {
    const isEdit = kind === 'edit';
    const fresh = await refreshShotListsNow();
    if (!fresh) {
      throw new Error(isEdit
        ? 'the edit could not be re-read to check its Save, so nothing was changed'
        : 'the shot list could not be re-read to check its Save, so nothing was changed');
    }
    const row = isEdit ? findEdit(id) : findShotList(id);
    if (!row) throw new Error(isEdit ? 'edit not found' : 'shot list not found');
    if (!sameSave(row.snapshot, expected)) {
      throw new Error(isEdit
        ? 'this edit has been Saved again since — going back would erase that Save'
        : 'this shot list has been Saved again since — going back would erase that Save');
    }
    return isEdit
      ? mutationsRef.current.updateEdit(id, values)
      : mutationsRef.current.updateShotList(id, values);
  }

  // Write ONLY these rows of one list (insert new ids, update this list's).
  // A row whose scene or shot the list already holds under ANOTHER item id is
  // dropped first — re-adding it would only collide (round 2: an undo of a
  // removal after someone re-added the same shot failed whole).
  async function putListRows(listId, rowsIn) {
    const current = itemsOf(bundleRef.current.shotListItems, listId);
    const rows = (rowsIn || []).filter(r => !current.some(c => c.id !== r.id
      && ((r.scene_id && c.scene_id === r.scene_id) || (r.shot_id && c.shot_id === r.shot_id))));
    if (!rows.length) return [];
    const pid = activeProjectIdRef.current;
    const a = shotListAdapter();
    ++shotListWriteSeqRef.current;
    const wire = rows.map(r => ({
      id: r.id, scene_id: r.scene_id || null, shot_id: r.shot_id || null, position: r.position ?? 0,
    }));
    let res;
    try {
      res = await a.upsertShotListItems(pid, listId, wire);
    } catch (err) {
      reportShotListError(err);
      throw err;
    }
    if (activeProjectIdRef.current !== pid) return res;
    const written = Array.isArray(res) ? res : [];
    setBundle(prev => {
      const byId = new Map(written.map(r => [r.id, r]));
      const kept = (prev.shotListItems || []).filter(i => !byId.has(i.id));
      return { ...prev, shotListItems: [...kept, ...written] };
    });
    return written;
  }

  // Delete ONLY these item ids of one list. Every named id leaves state: it
  // was deleted now or was already gone server-side (round 2: an item already
  // gone stayed on screen and every retry was a silent no-op). When the
  // backend deleted fewer than named, re-read the lists to converge.
  async function dropListRows(listId, ids) {
    if (!ids || !ids.length) return { deleted: [] };
    const pid = activeProjectIdRef.current;
    const a = shotListAdapter();
    ++shotListWriteSeqRef.current;
    let res;
    try {
      res = await a.deleteShotListItems(pid, listId, ids);
    } catch (err) {
      reportShotListError(err);
      throw err;
    }
    if (activeProjectIdRef.current !== pid) return res;
    const gone = new Set(ids);
    setBundle(prev => ({ ...prev, shotListItems: (prev.shotListItems || []).filter(i => !gone.has(i.id)) }));
    if (Array.isArray(res?.deleted) && res.deleted.length < ids.length) {
      refreshShotListsNow().catch(() => {});
    }
    return res;
  }

  // MOVE rows that exist (positions only). Applied locally first; on failure
  // only these rows' positions go back (never a whole-bundle rollback).
  async function repositionListRows(listId, rows) {
    if (!rows || !rows.length) return [];
    const pid = activeProjectIdRef.current;
    const a = shotListAdapter();
    const want = new Map(rows.map(r => [r.id, r.position ?? 0]));
    const before = new Map(itemsOf(bundleRef.current.shotListItems, listId)
      .filter(i => want.has(i.id)).map(i => [i.id, i.position]));
    const apply = (posById) => setBundle(prev => ({
      ...prev,
      shotListItems: (prev.shotListItems || []).map(i => (posById.has(i.id) ? { ...i, position: posById.get(i.id) } : i)),
    }));
    ++shotListWriteSeqRef.current;
    apply(want);
    let res;
    try {
      res = await a.repositionShotListItems(pid, listId, rows.map(r => ({ id: r.id, position: r.position ?? 0 })));
    } catch (err) {
      if (activeProjectIdRef.current === pid) apply(before);
      reportShotListError(err);
      throw err;
    }
    if (activeProjectIdRef.current !== pid) return res;
    const updated = Array.isArray(res) ? res : [];
    if (updated.length) {
      const byId = new Map(updated.map(r => [r.id, r]));
      setBundle(prev => ({ ...prev, shotListItems: (prev.shotListItems || []).map(i => byId.get(i.id) || i) }));
    }
    // A row named but not updated no longer exists server-side: converge.
    if (updated.length < rows.length) refreshShotListsNow().catch(() => {});
    return updated;
  }

  function snapshotListItems(listId) {
    return itemsOf(bundleRef.current.shotListItems, listId).map(i => ({ ...i }));
  }

  // Where a NEW scene or shot goes: the list the caller names (S3b passes the
  // list the Scenes tab is viewing), else the active list, else nowhere — a
  // row in no list is shown everywhere (D10 as built). `null` = no list.
  function targetListFor(opts) {
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'listId')) return opts.listId || null;
    return bundleRef.current.project?.active_shot_list_id || null;
  }

  // Put a just-created scene or shot into its list. Returns the list id used.
  async function addNewEntityToList(kind, row, opts) {
    const listId = targetListFor(opts);
    if (!listId) return null;
    let list = findShotList(listId);
    if (!list) {
      // The project names a list this client has not loaded (another window
      // made it active). Read the lists before placing the row, or it would
      // land in no list and vanish from every other tab once they load
      // (round 2).
      await refreshShotListsNow().catch(() => null);
      list = findShotList(listId);
    }
    if (!list || list.archived_at) return null;
    const shots = kind === 'shot'
      ? [...(bundleRef.current.shots || []).filter(s => s.id !== row.id), row]
      : (bundleRef.current.shots || []);
    const { added } = planAddToList({
      items: bundleRef.current.shotListItems,
      listId,
      projectId: activeProjectIdRef.current,
      shots,
      sceneIds: kind === 'scene' ? [row.id] : [],
      shotIds:  kind === 'shot'  ? [row.id] : [],
      newId: uuidv4,
    });
    await putListRows(listId, added);
    return listId;
  }

  // Undo of a scene/shot delete: put back the memberships the delete removed
  // (the database cascaded them away; the Local Server swept them), leaving
  // every other item as it now is — in ARCHIVED lists too (round 2: skipping
  // them made delete + Ctrl+Z shrink every archived list for good).
  async function restoreMemberships(removedItems) {
    const byList = new Map();
    for (const it of removedItems || []) {
      if (!byList.has(it.shot_list_id)) byList.set(it.shot_list_id, []);
      byList.get(it.shot_list_id).push(it);
    }
    for (const [listId, back] of byList) {
      if (!findShotList(listId)) continue;
      const current = snapshotListItems(listId);
      const has = (it) => current.some(c => (it.scene_id && c.scene_id === it.scene_id) || (it.shot_id && c.shot_id === it.shot_id));
      await putListRows(listId, back.filter(it => !has(it)).map(it => ({ ...it })));
    }
  }

  // Undo of a scene/shot delete: re-point the tasks the delete un-linked (the
  // database's ON DELETE SET NULL; the Local Server's sweep), unless the task
  // has been linked to something else since.
  async function restoreTaskLinks(field, entityId, taskIds) {
    for (const taskId of taskIds || []) {
      const t = (bundleRef.current.tasks || []).find(x => x.id === taskId);
      if (!t || t[field]) continue;
      try { await mutationsRef.current.updateTask(taskId, { [field]: entityId }); } catch { /* ctx.error has it */ }
    }
  }

  // The undo primitives: write / delete exactly these rows. No history.
  const putShotListItems = useCallback(async (listId, rows) => putListRows(listId, rows || []), []);
  const dropShotListItems = useCallback(async (listId, ids) => dropListRows(listId, ids || []), []);
  const repositionShotListItems = useCallback(async (listId, rows) => repositionListRows(listId, rows || []), []);

  const refreshShotLists = useCallback(async () => refreshShotListsNow(), []);

  // A project row can name an active list this client has not loaded (another
  // window made and activated it; lists are not broadcast, projects are).
  // Meanwhile activeScenesOf shows every row; this re-reads the lists once
  // per unknown id so the right list takes over.
  const unknownActiveRef = useRef(null);
  useEffect(() => {
    const id = bundle.project?.active_shot_list_id || null;
    if (!id || (bundle.shotLists || []).some(l => l.id === id)) { unknownActiveRef.current = null; return; }
    if (unknownActiveRef.current === id) return;
    unknownActiveRef.current = id;
    // A read that came back with nothing must not end the search for good
    // (review R3): the next change to the lists or the pointer tries again.
    const forget = () => { if (unknownActiveRef.current === id) unknownActiveRef.current = null; };
    refreshShotListsNow().then(r => { if (!r) forget(); }, forget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.project?.active_shot_list_id, bundle.shotLists]);

  // ── Withdraw (0086, Audrey 2026-09-30) ────────────────────────────────
  //
  // "allow users to view their most recently deleted list. only right after
  // they deleted." Her rulings, from the options put to her:
  //   * WITHDRAW, briefly viewable — the person who made a new list or edit
  //     sets it aside (archived, never deleted, D18). Right after, it is
  //     ctx.recentlyWithdrawn: S3b shows it as "Recently removed", openable
  //     (an archived list reads like any other) and restorable
  //     (restoreWithdrawn()). Only the MOST RECENT one.
  //   * ONLY UNTOUCHED new ones — never Saved, no live edit on (or
  //     continuing) it, not the active list. shotListModel's
  //     shotListWithdrawRefusal / editWithdrawRefusal refuse in the
  //     database's words before any write, on every backend; the cloud
  //     refuses the same things behind them (0086's maker path).
  //   * UNTIL THEY LEAVE THE SCENES TAB — S3b calls clearRecentlyWithdrawn()
  //     when the person leaves the tab (it unmounts, or R.A.B.B.I.T. stops
  //     being the page shown — App passes Rabbit an isActive prop that
  //     Rabbit.jsx does not read yet) and when the tab mounts; switching
  //     project clears it here; closing the app ends it (it is never stored).
  // The maker test needs the signed-in user on a backend with users
  // (adapterMode 'supabase', which the dev fixtures report too; null until
  // the session is read). Elsewhere there are no users and it is skipped, as
  // D8's roles are. While the user is not known, the selectors say no (never
  // offer what may be refused) but the mutators let the database decide.
  const withdrawUserId = adapterMode === 'supabase' ? (authUserId || null) : undefined;
  const withdrawUserRef = useRef(withdrawUserId);
  useEffect(() => { withdrawUserRef.current = withdrawUserId; }, [withdrawUserId]);
  function makerTestUserId() {
    const u = withdrawUserRef.current;
    return u === null ? undefined : u;
  }
  const [recentlyWithdrawnMark, setRecentlyWithdrawnMark] = useState(null);
  const recentlyWithdrawnRef = useRef(null);
  function markRecentlyWithdrawn(mark) {
    recentlyWithdrawnRef.current = mark;
    setRecentlyWithdrawnMark(mark);
  }
  // A restore of the marked row by ANY path ends the mark — otherwise a later
  // archive of the same row (a manager's) would read as "Recently removed".
  function unmarkIfRestored(id) {
    if (recentlyWithdrawnRef.current && recentlyWithdrawnRef.current.id === id) markRecentlyWithdrawn(null);
  }
  // …and so does SERVER data showing the marked row live: a write's returned
  // row, a list re-read, a project reload. Never an optimistic flip, a
  // rollback or an early return on what is on screen — a failed Restore's
  // flip used to end the mark, leaving nothing to try again from (reviews R2,
  // R3). A re-read or reload that a write to these rows overtook is not
  // landed (shotListWriteSeqRef), so a stale one cannot.
  function unmarkIfServerShowsLive(lists, edits) {
    const m = recentlyWithdrawnRef.current;
    if (!m) return;
    const pool = m.kind === 'edit' ? edits : lists;
    if (!pool) return;
    const row = pool.find(r => r && r.id === m.id);
    if (row && !row.archived_at) markRecentlyWithdrawn(null);
  }
  // A write that started before a project switch must not mark (or record
  // history) after it — even when the person has switched BACK (p1 → p2 →
  // p1, review R1): a generation, not the project id, says "same visit".
  const projectVisitRef = useRef(0);
  useEffect(() => {
    projectVisitRef.current += 1;
    markRecentlyWithdrawn(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // undo / redo swallow an op's throw and keep going; a refused withdraw (a
  // collaborator Saved the list meanwhile) must still say why, so these ops
  // put the sentence in the error banner before rethrowing.
  function surfaced(op) {
    return async () => {
      try { return await op(); } catch (err) { setError(err?.message || String(err)); throw err; }
    };
  }

  /**
   * New list. { title, version?, summary?, from?, fromAll?, id?, undoable? }
   *   from      — a list id: link the SAME scene and shot rows in the same
   *               order ("New list from the current one", D1 + D3)
   *   fromAll   — every scene and shot of the project, in number order (the
   *               D11 set; for a project that has no list yet)
   *   undoable  — false keeps the creation off the undo stack. Its undo
   *               WITHDRAWS the list (0086), which its maker may do while it
   *               is untouched, so a member needs no special case.
   * version defaults to the next free version of the title (D14). Not made
   * active — that is setActiveShotList, a manager's decision (D8).
   */
  const addShotList = useCallback(async (opts = {}) => {
    const pid = activeProjectIdRef.current;
    if (!pid) throw new Error('no project');
    const lists = bundleRef.current.shotLists || [];
    const title = String(opts.title || '').trim();
    const version = opts.version ?? nextShotListVersionOf(lists, title);
    validateVersionedTitle({ title, version });
    assertUniqueShotList(lists, { title, version });
    if (opts.from && !findShotList(opts.from)) throw new Error('shot list not found');
    const a = shotListAdapter();
    const row = {
      id: opts.id || uuidv4(),
      project_id: pid,
      title,
      version,
      summary: opts.summary ?? null,
      snapshot: {},
      archived_at: null,
      archived_by: null,
    };
    return runBatch(async () => {
      const created = await optimistic(
        prev => ({ ...prev, shotLists: [...(prev.shotLists || []), row] }),
        () => (++shotListWriteSeqRef.current, a.upsertShotList(row)),
      );
      const listRow = created || row;
      if (activeProjectIdRef.current !== pid) return listRow;
      putRow('shotLists', listRow, pid);
      // Pushed BEFORE the items are copied: if the copy fails, the list still
      // exists and its undo (withdraw) must still be on the stack. Copied
      // membership is not a touch (0086), so that undo still works.
      if (opts.undoable !== false) {
        pushHistory({
          undoOps: [surfaced(() => mutationsRef.current.withdrawShotList(listRow.id))],
          redoOps: [surfaced(() => mutationsRef.current.restoreWithdrawn({ kind: 'shot_list', id: listRow.id }))],
        });
      }
      let items = [];
      if (opts.from) {
        items = planCopyList({ items: bundleRef.current.shotListItems, fromListId: opts.from, toListId: listRow.id, projectId: pid, newId: uuidv4 });
      } else if (opts.fromAll) {
        items = planAllScenesAndShots({ scenes: bundleRef.current.scenes, shots: bundleRef.current.shots, listId: listRow.id, projectId: pid, newId: uuidv4 });
      }
      await putListRows(listRow.id, items);
      return listRow;
    });
  }, [optimistic, runBatch]);

  /**
   * Title / version / summary (and, for undo, snapshot). Refused on an
   * archived list. A change that writes the snapshot (a Save, or its undo)
   * is undone and redone through rewriteSaveIfStill.
   */
  const updateShotList = useCallback(async (id, patch = {}) => {
    const list = requireEditableShotList(id);
    const pid = activeProjectIdRef.current;
    const allowed = {};
    for (const k of ['title', 'version', 'summary', 'snapshot']) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) allowed[k] = patch[k];
    }
    if (allowed.title !== undefined) allowed.title = String(allowed.title).trim();
    const nextRow = { ...list, ...allowed };
    validateVersionedTitle({ title: nextRow.title, version: nextRow.version });
    assertUniqueShotList(bundleRef.current.shotLists, nextRow);
    const oldValues = {};
    for (const k of Object.keys(allowed)) oldValues[k] = list[k];
    const a = shotListAdapter();
    // The snapshot is sent only when THIS change writes it (Save, or its
    // undo). Lists are not broadcast, so the cached copy can be a session
    // old, and re-sending it with a rename erased a collaborator's newer Save
    // (review R1 of 0086) — and, since 0086, made the list look untouched.
    // Unsent, every backend keeps the stored value.
    // Post-overhaul S3b — the patch path S3a's known limits asked for before
    // a rename reached the UI (Edit details): ONLY the columns this change
    // names go out (adapter.patchShotList, an UPDATE in the cloud), never the
    // cached title, version or summary beside them, so a collaborator's newer
    // summary survives a rename from here. An adapter without the path gets
    // the whole row as before, less the snapshot this change does not write.
    const wire = { ...nextRow };
    if (!Object.prototype.hasOwnProperty.call(allowed, 'snapshot')) delete wire.snapshot;
    const write = typeof a.patchShotList === 'function'
      ? () => a.patchShotList(pid, id, allowed)
      : () => a.upsertShotList(wire);
    const res = await optimistic(
      prev => ({ ...prev, shotLists: (prev.shotLists || []).map(l => (l.id === id ? nextRow : l)) }),
      () => (++shotListWriteSeqRef.current, write()),
    );
    if (activeProjectIdRef.current !== pid) return res || nextRow;
    if (res) putRow('shotLists', res, pid);
    const guardSave = Object.prototype.hasOwnProperty.call(allowed, 'snapshot');
    pushHistory({
      undoOps: [guardSave
        ? surfaced(() => rewriteSaveIfStill('shot_list', id, allowed.snapshot, oldValues))
        : () => mutationsRef.current.updateShotList(id, oldValues)],
      redoOps: [guardSave
        ? surfaced(() => rewriteSaveIfStill('shot_list', id, oldValues.snapshot, allowed))
        : () => mutationsRef.current.updateShotList(id, allowed)],
    });
    return res || nextRow;
  }, [optimistic]);

  /**
   * "Save" (D5): record a version point — the list's scenes, shots and
   * membership as they are now go into shot_lists.snapshot. Field edits are
   * already live-saved; this is the history mark. { summary? } rides along.
   */
  const saveShotListSnapshot = useCallback(async (id, opts = {}) => {
    const list = requireEditableShotList(id);
    const snapshot = buildShotListSnapshot({
      list,
      scenes: bundleRef.current.scenes,
      shots: bundleRef.current.shots,
      items: bundleRef.current.shotListItems,
      savedAt: new Date().toISOString(),
    });
    const patch = { snapshot };
    if (Object.prototype.hasOwnProperty.call(opts, 'summary')) patch.summary = opts.summary;
    return mutationsRef.current.updateShotList(id, patch);
  }, []);

  /** Make a list the project's active list (null clears it). Manager/admin (D8). */
  const setActiveShotList = useCallback(async (listId) => {
    const pid = activeProjectIdRef.current;
    if (!pid) throw new Error('no project');
    const target = listId || null;
    const prevId = bundleRef.current.project?.active_shot_list_id || null;
    if (target === prevId) return prevId;
    if (target) {
      const list = findShotList(target);
      if (!list) throw new Error('shot list not found in this project');
      if (list.archived_at) throw new Error('an archived shot list cannot be made active — restore it first');
    }
    const a = shotListAdapter();
    notePendingFields('projects', pid, ['active_shot_list_id']);
    try {
      await optimistic(
        prev => ({ ...prev, project: prev.project ? { ...prev.project, active_shot_list_id: target } : prev.project }),
        () => a.setActiveShotList(pid, target),
      );
    } finally {
      clearPendingFields('projects', pid, ['active_shot_list_id']);
    }
    setProjectsIndex(idx => (idx[pid] ? { ...idx, [pid]: { ...idx[pid], active_shot_list_id: target } } : idx));
    if (activeProjectIdRef.current !== pid) return target;
    pushHistory({
      undoOps: [() => mutationsRef.current.setActiveShotList(prevId)],
      redoOps: [() => mutationsRef.current.setActiveShotList(target)],
    });
    return target;
  }, [optimistic, notePendingFields, clearPendingFields]);

  /**
   * Archive (default) or restore a list: the manager's verb (D8). The ACTIVE
   * list cannot be archived (D4). { history: false } is for withdraw and
   * restoreWithdrawn, which record their own undo step.
   */
  const archiveShotList = useCallback(async (listId, archived = true, opts = {}) => {
    const list = findShotList(listId);
    if (!list) throw new Error('shot list not found');
    const want = archived !== false;
    if (want && bundleRef.current.project?.active_shot_list_id === listId) {
      throw new Error('the active shot list cannot be archived — make another list active first');
    }
    // Already as asked, on screen — which may be optimistic: no write, and the
    // mark is left alone (only server data ends it, review R3).
    if (!!list.archived_at === want) return list;
    const a = shotListAdapter();
    const pid = activeProjectIdRef.current;
    const res = await optimistic(
      prev => ({
        ...prev,
        shotLists: (prev.shotLists || []).map(l => (l.id === listId
          ? { ...l, archived_at: want ? (l.archived_at || new Date().toISOString()) : null, archived_by: want ? l.archived_by : null }
          : l)),
      }),
      () => (++shotListWriteSeqRef.current, a.archiveShotList(pid, listId, want)),
    );
    if (activeProjectIdRef.current !== pid) return res || list;
    if (res) putRow('shotLists', res, pid);
    if (!want) unmarkIfRestored(listId);
    if (opts.history !== false) {
      pushHistory({
        undoOps: [() => mutationsRef.current.archiveShotList(listId, !want)],
        redoOps: [() => mutationsRef.current.archiveShotList(listId, want)],
      });
    }
    return res || list;
  }, [optimistic]);

  /**
   * Add scenes and/or shots to a list: { sceneId, shotId, sceneIds, shotIds }.
   * A shot whose scene the list lacks brings its scene along. Returns the
   * items added ([] when everything was already there).
   */
  const addToShotList = useCallback(async (listId, what = {}) => {
    requireEditableShotList(listId);
    const sceneIds = [...(what.sceneIds || []), ...(what.sceneId ? [what.sceneId] : [])];
    const shotIds  = [...(what.shotIds  || []), ...(what.shotId  ? [what.shotId]  : [])];
    const { added } = planAddToList({
      items: bundleRef.current.shotListItems, listId, projectId: activeProjectIdRef.current,
      shots: bundleRef.current.shots, sceneIds, shotIds, newId: uuidv4,
    });
    if (!added.length) return [];
    const pid = activeProjectIdRef.current;
    const written = await putListRows(listId, added);
    if (activeProjectIdRef.current !== pid) return written;
    const ids = (written.length ? written : added).map(r => r.id);
    pushHistory({
      undoOps: [() => mutationsRef.current.dropShotListItems(listId, ids)],
      redoOps: [() => mutationsRef.current.putShotListItems(listId, added)],
    });
    return written.length ? written : added;
  }, []);

  /** Remove scenes and/or shots from a list (a scene takes its shots' items with it). */
  const removeFromShotList = useCallback(async (listId, what = {}) => {
    requireEditableShotList(listId);
    const sceneIds = [...(what.sceneIds || []), ...(what.sceneId ? [what.sceneId] : [])];
    const shotIds  = [...(what.shotIds  || []), ...(what.shotId  ? [what.shotId]  : [])];
    const { removed } = planRemoveFromList({
      items: bundleRef.current.shotListItems, listId, shots: bundleRef.current.shots, sceneIds, shotIds,
    });
    if (!removed.length) return [];
    const ids = removed.map(r => r.id);
    const pid = activeProjectIdRef.current;
    await dropListRows(listId, ids);
    if (activeProjectIdRef.current !== pid) return removed;
    pushHistory({
      undoOps: [() => mutationsRef.current.putShotListItems(listId, removed)],
      redoOps: [() => mutationsRef.current.dropShotListItems(listId, ids)],
    });
    return removed;
  }, []);

  /**
   * Reorder one group of a list — its scenes, or the shots of one scene.
   * orderedIds are scene ids, shot ids or item ids (see planReorderList).
   * Only the rows whose position moved are written.
   */
  const reorderShotListItems = useCallback(async (listId, orderedIds) => {
    requireEditableShotList(listId);
    const before = snapshotListItems(listId);
    const { next, changed } = planReorderList({ items: bundleRef.current.shotListItems, listId, shots: bundleRef.current.shots, orderedIds });
    if (!changed.length) return next;
    const pid = activeProjectIdRef.current;
    const undoRows = changed.map(c => ({ id: c.id, position: before.find(b => b.id === c.id)?.position ?? 0 }));
    const doRows = changed.map(c => ({ id: c.id, position: c.position }));
    await repositionListRows(listId, doRows);
    if (activeProjectIdRef.current !== pid) return next;
    pushHistory({
      undoOps: [() => mutationsRef.current.repositionShotListItems(listId, undoRows)],
      redoOps: [() => mutationsRef.current.repositionShotListItems(listId, doRows)],
    });
    return next;
  }, []);

  /**
   * New edit on a list (D6: any list, active or not; ONE linear chain).
   * { listId, parentEditId?, title, version?, summary?, items?, id?, undoable? }
   * parentEditId defaults to the chain's tip (editChainTip) when the list has
   * edits; the first edit of a list has none. items default to the parent's
   * (same item ids, so S3c can compare versions item by item) or [].
   * undoable: false keeps it off the undo stack; its undo WITHDRAWS the new
   * edit (0086), which its maker may do while it is untouched.
   */
  const createEditFrom = useCallback(async (opts = {}) => {
    const pid = activeProjectIdRef.current;
    if (!pid) throw new Error('no project');
    const listId = opts.listId;
    requireEditableShotList(listId);
    const edits = bundleRef.current.edits || [];
    const tip = editChainTipOf(edits, listId);
    const parentId = opts.parentEditId === undefined ? (tip ? tip.id : null) : opts.parentEditId;
    const parent = parentId ? findEdit(parentId) : null;
    if (parentId && (!parent || parent.shot_list_id !== listId)) {
      throw new Error('an edit\'s parent must be another edit of the same shot list');
    }
    if (!parentId && tip) {
      throw new Error('this shot list\'s edits form one chain — a new edit continues from the latest one');
    }
    if (parent && edits.some(e => e.parent_edit_id === parent.id)) {
      throw new Error('an edit\'s parent must be the latest edit of its shot list');
    }
    const title = String(opts.title || '').trim();
    const version = opts.version ?? nextEditVersionOf(edits, listId, title);
    validateVersionedTitle({ title, version }, 'edit');
    assertUniqueEdit(edits, { shot_list_id: listId, title, version });
    const items = opts.items !== undefined
      ? normalizeEditItems(opts.items, uuidv4)
      : (parent ? normalizeEditItems(parent.items || [], uuidv4) : []);
    const row = {
      id: opts.id || uuidv4(),
      project_id: pid,
      shot_list_id: listId,
      title,
      version,
      summary: opts.summary ?? null,
      parent_edit_id: parent ? parent.id : null,
      items,
      snapshot: null,
      archived_at: null,
      archived_by: null,
    };
    const a = shotListAdapter();
    let created;
    try {
      created = await optimistic(
        prev => ({ ...prev, edits: [...(prev.edits || []), row] }),
        () => (++shotListWriteSeqRef.current, a.upsertEdit(row)),
      );
    } catch (err) {
      // Most likely another window extended the chain (its tip moved): re-read
      // so the NEXT try picks the real tip instead of failing forever (R2).
      refreshShotListsNow().catch(() => {});
      throw err;
    }
    if (activeProjectIdRef.current !== pid) return created || row;
    if (created) putRow('edits', created, pid);
    const finalRow = created || row;
    if (opts.undoable !== false) {
      pushHistory({
        undoOps: [surfaced(() => mutationsRef.current.withdrawEdit(finalRow.id))],
        redoOps: [surfaced(() => mutationsRef.current.restoreWithdrawn({ kind: 'edit', id: finalRow.id }))],
      });
    }
    return finalRow;
  }, [optimistic]);

  /**
   * Title / version / summary / items / snapshot of an edit. Refused when
   * archived. A change that writes the snapshot is guarded as in
   * updateShotList. A third argument `{ history: false }` is internal (S3c's
   * saveEditDraft records the new edit and its Save as one step).
   */
  const updateEdit = useCallback(async (id, patch = {}, opts = {}) => {
    const edit = findEdit(id);
    if (!edit) throw new Error('edit not found');
    if (edit.archived_at) throw new Error('this edit is archived — restore it before changing it');
    const pid = activeProjectIdRef.current;
    const allowed = {};
    for (const k of ['title', 'version', 'summary', 'items', 'snapshot']) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) allowed[k] = patch[k];
    }
    if (allowed.title !== undefined) allowed.title = String(allowed.title).trim();
    if (allowed.items !== undefined) allowed.items = normalizeEditItems(allowed.items, uuidv4);
    const nextRow = { ...edit, ...allowed };
    validateVersionedTitle({ title: nextRow.title, version: nextRow.version }, 'edit');
    assertUniqueEdit(bundleRef.current.edits, nextRow);
    const oldValues = {};
    for (const k of Object.keys(allowed)) oldValues[k] = edit[k];
    const a = shotListAdapter();
    // items and snapshot go only when THIS change writes them (as in
    // updateShotList: a rename from a stale view must not overwrite a newer
    // Save or a collaborator's items).
    const wire = { ...nextRow };
    for (const k of ['items', 'snapshot']) {
      if (!Object.prototype.hasOwnProperty.call(allowed, k)) delete wire[k];
    }
    const res = await optimistic(
      prev => ({ ...prev, edits: (prev.edits || []).map(e => (e.id === id ? nextRow : e)) }),
      () => (++shotListWriteSeqRef.current, a.upsertEdit(wire)),
    );
    if (activeProjectIdRef.current !== pid) return res || nextRow;
    if (res) putRow('edits', res, pid);
    if (opts.history === false) return res || nextRow;
    const guardSave = Object.prototype.hasOwnProperty.call(allowed, 'snapshot');
    pushHistory({
      undoOps: [guardSave
        ? surfaced(() => rewriteSaveIfStill('edit', id, allowed.snapshot, oldValues))
        : () => mutationsRef.current.updateEdit(id, oldValues)],
      redoOps: [guardSave
        ? surfaced(() => rewriteSaveIfStill('edit', id, oldValues.snapshot, allowed))
        : () => mutationsRef.current.updateEdit(id, allowed)],
    });
    return res || nextRow;
  }, [optimistic]);

  /**
   * "Save" an edit (D5, S3c's draft → the database): the whole item array in
   * one write, plus a snapshot of the names of the shots and scenes it
   * references so a later-deleted shot still reads "Missing shot: <name>"
   * (D17). summary rides along when given. `{ history: false }` as updateEdit's.
   */
  const saveEdit = useCallback(async (editId, items, summary, opts = {}) => {
    const normalized = normalizeEditItems(items, uuidv4);
    const patch = {
      items: normalized,
      snapshot: buildEditSnapshot({
        items: normalized,
        shots: bundleRef.current.shots,
        scenes: bundleRef.current.scenes,
        savedAt: new Date().toISOString(),
      }),
    };
    if (summary !== undefined) patch.summary = summary;
    return mutationsRef.current.updateEdit(editId, patch, opts);
  }, []);

  /**
   * Archive (default) or restore an edit: the manager's verb (D8).
   * { history: false } is for withdraw and restoreWithdrawn.
   */
  const archiveEdit = useCallback(async (editId, archived = true, opts = {}) => {
    const edit = findEdit(editId);
    if (!edit) throw new Error('edit not found');
    const want = archived !== false;
    if (!!edit.archived_at === want) return edit;
    const a = shotListAdapter();
    const pid = activeProjectIdRef.current;
    const res = await optimistic(
      prev => ({
        ...prev,
        edits: (prev.edits || []).map(e => (e.id === editId
          ? { ...e, archived_at: want ? (e.archived_at || new Date().toISOString()) : null, archived_by: want ? e.archived_by : null }
          : e)),
      }),
      () => (++shotListWriteSeqRef.current, a.archiveEdit(pid, editId, want)),
    );
    if (activeProjectIdRef.current !== pid) return res || edit;
    if (res) putRow('edits', res, pid);
    if (!want) unmarkIfRestored(editId);
    if (opts.history !== false) {
      pushHistory({
        undoOps: [() => mutationsRef.current.archiveEdit(editId, !want)],
        redoOps: [() => mutationsRef.current.archiveEdit(editId, want)],
      });
    }
    return res || edit;
  }, [optimistic]);

  /**
   * WITHDRAW a list (0086): its maker sets an UNTOUCHED new list aside —
   * archived, never deleted — and it becomes ctx.recentlyWithdrawn. Refused
   * before any write, with the database's sentence for each condition:
   * someone else's list (on a backend with users), a Saved list, one with a
   * live edit on it, the active list. Not checked here: the seat (S3b also
   * asks can('project.shotlist.write')). Withdrawing an archived list is a
   * no-op. Also the undo of New list. A refusal before any write is thrown
   * (show it where the action was); a backend refusal also lands in
   * ctx.error, like every other mutator's.
   */
  const withdrawShotList = useCallback(async (listId) => {
    const list = findShotList(listId);
    if (!list) throw new Error('shot list not found');
    if (list.archived_at) return list;
    const refusal = shotListWithdrawRefusal({
      list,
      edits: bundleRef.current.edits,
      activeListId: bundleRef.current.project?.active_shot_list_id || null,
      userId: makerTestUserId(),
    });
    if (refusal) throw new Error(refusal);
    const pid = activeProjectIdRef.current;
    const visit = projectVisitRef.current;
    const res = await mutationsRef.current.archiveShotList(listId, true, { history: false });
    if (activeProjectIdRef.current !== pid || projectVisitRef.current !== visit) return res;
    markRecentlyWithdrawn({ kind: 'shot_list', id: listId, projectId: pid });
    pushHistory({
      undoOps: [surfaced(() => mutationsRef.current.restoreWithdrawn({ kind: 'shot_list', id: listId }))],
      redoOps: [surfaced(() => mutationsRef.current.withdrawShotList(listId))],
    });
    return res;
  }, []);

  /**
   * WITHDRAW an edit (0086): the same for an untouched edit — not Saved
   * now, no live edit continues it. Also the undo of New edit. A withdrawn
   * edit keeps its place in its list's chain (D6): the next new edit
   * continues from it, taking its items as any next edit does.
   */
  const withdrawEdit = useCallback(async (editId) => {
    const edit = findEdit(editId);
    if (!edit) throw new Error('edit not found');
    if (edit.archived_at) return edit;
    const refusal = editWithdrawRefusal({ edit, edits: bundleRef.current.edits, userId: makerTestUserId() });
    if (refusal) throw new Error(refusal);
    const pid = activeProjectIdRef.current;
    const visit = projectVisitRef.current;
    const res = await mutationsRef.current.archiveEdit(editId, true, { history: false });
    if (activeProjectIdRef.current !== pid || projectVisitRef.current !== visit) return res;
    markRecentlyWithdrawn({ kind: 'edit', id: editId, projectId: pid });
    pushHistory({
      undoOps: [surfaced(() => mutationsRef.current.restoreWithdrawn({ kind: 'edit', id: editId }))],
      redoOps: [surfaced(() => mutationsRef.current.withdrawEdit(editId))],
    });
    return res;
  }, []);

  /**
   * Put a withdrawn list or edit back: `target` ({ kind: 'shot_list' | 'edit',
   * id } or the row itself), or ctx.recentlyWithdrawn when omitted (anything
   * without a string id — a click event wired straight to onClick — means
   * the marked row). The maker restores what THEY set aside while it is not Saved —
   * what every withdraw left — whatever landed on it since (a restore only
   * un-hides). On a backend with users, once the signed-in user is known,
   * anything else is refused before any write: someone else's row with
   * 0084's seat sentence, a Saved one with 0086's (a manager restores with
   * archiveShotList(id, false)). Restoring the marked row ends the mark; the
   * restore's own undo withdraws the row again.
   */
  const restoreWithdrawn = useCallback(async (target) => {
    // { kind, id } — or a list / edit ROW, its kind inferred (an edit has
    // shot_list_id) — names the row; anything without a string id (nothing,
    // or a click event) means the marked row. Review R2: a row passed
    // without `kind` used to fall through to the mark and restore THAT.
    let t = null;
    if (target && typeof target === 'object' && typeof target.id === 'string') {
      const k = target.kind === 'edit' || target.kind === 'shot_list'
        ? target.kind
        : (Object.prototype.hasOwnProperty.call(target, 'shot_list_id') ? 'edit' : 'shot_list');
      t = { kind: k, id: target.id };
    } else {
      t = recentlyWithdrawnRef.current;
    }
    if (!t || !t.id) return null;
    const kind = t.kind === 'edit' ? 'edit' : 'shot_list';
    const row = kind === 'edit' ? findEdit(t.id) : findShotList(t.id);
    const refusal = withdrawnRestoreRefusal({ row, kind, userId: makerTestUserId() });
    if (refusal) throw new Error(refusal);
    if (!row.archived_at) return row;
    const pid = activeProjectIdRef.current;
    const visit = projectVisitRef.current;
    const res = kind === 'edit'
      ? await mutationsRef.current.archiveEdit(t.id, false, { history: false })
      : await mutationsRef.current.archiveShotList(t.id, false, { history: false });
    if (activeProjectIdRef.current !== pid || projectVisitRef.current !== visit) return res;
    unmarkIfRestored(t.id);
    pushHistory({
      undoOps: [surfaced(() => (kind === 'edit'
        ? mutationsRef.current.withdrawEdit(t.id)
        : mutationsRef.current.withdrawShotList(t.id)))],
      redoOps: [surfaced(() => mutationsRef.current.restoreWithdrawn({ kind, id: t.id }))],
    });
    return res;
  }, []);

  /**
   * End the "Recently removed" mark; the row stays set aside. S3b calls it
   * when the person leaves the Scenes tab (it unmounts, or R.A.B.B.I.T. stops
   * being the page shown) and when the tab mounts.
   */
  const clearRecentlyWithdrawn = useCallback(() => { markRecentlyWithdrawn(null); }, []);

  // ── Edit drafts (post-overhaul S3c, step 4; D13) ─────────────────────────
  //
  // The unsaved edit: state/editDrafts.js holds its shape and rules. One per
  // project and list, here (the views mount one at a time; a draft in a
  // view's state would die on a tab switch), copied to localStorage on every
  // change so a crash offers "Recover unsaved edit?" on the next visit.
  // Nothing here touches a backend until saveEditDraft. A project switch
  // leaves the open project's drafts where they are (D12: an automatic switch
  // cannot ask, so the draft survives it); they are the open project's again
  // when it is.
  const [editDrafts, setEditDrafts] = useState({});
  const editDraftsRef = useRef(editDrafts);
  // The copies a PREVIOUS run left (never answered): what "Recover unsaved
  // edit?" offers. Read once; a live draft of the same list supersedes one.
  const [storedEditDrafts, setStoredEditDrafts] = useState(() => readStoredDrafts());
  const draftPersonKey = authUserId || 'local';
  const draftPersonRef = useRef(draftPersonKey);
  useEffect(() => { draftPersonRef.current = draftPersonKey; }, [draftPersonKey]);

  // Review round 1 (R1-01): a draft counts — holds the undo keys, asks at
  // every exit, is saved or discarded by the leave question — only while its
  // list is LIVE. Its list archived or withdrawn (here, or by someone else)
  // leaves it dormant, not lost: off screen, asking nothing, its stored copy
  // kept; the list restored, it is the list's draft again.
  function draftLive(d) {
    const list = findShotList(d.listId);
    return !!list && !list.archived_at;
  }
  function syncDraftHeld() {
    const pid = activeProjectIdRef.current;
    editDraftHeldRef.current = !!pid && Object.values(editDraftsRef.current).some(d => d.projectId === pid && d.dirty && draftLive(d));
    // Review round 2 (R2-01): a question about the unsaved work follows it
    // (App's close question, which captured the guards when it opened).
    leaveGuardsChanged();
  }
  useEffect(() => { syncDraftHeld(); setHistoryVersion(v => v + 1); }, [activeProjectId, bundle.shotLists]);

  // Review round 1 (R1-02): the drafts in memory are the signed-in person's.
  // Another person (or none: a sign-out, the idle timeout) never meets them:
  // they go from memory here, their stored copies staying under their own
  // key (offered to that person only), and the copies are read again for
  // whoever is here now.
  const draftsOfRef = useRef(draftPersonKey);
  useEffect(() => {
    if (draftsOfRef.current === draftPersonKey) return;
    draftsOfRef.current = draftPersonKey;
    editDraftsRef.current = {};
    setEditDrafts({});
    setStoredEditDrafts(readStoredDrafts());
    syncDraftHeld();
    setHistoryVersion(v => v + 1);
  }, [draftPersonKey]);

  // Put (or, with null, end) a draft — and its stored copy with it, under
  // the draft's OWN person (review round 2, R2-03: a save that finished after
  // a sign-out removed the copy under whoever was signed in by then, and the
  // saved edit was offered back as unsaved).
  function setDraft(projectId, listId, draft, person = null) {
    const key = draftKey(projectId, listId);
    const owner = person || draftPersonRef.current;
    const next = { ...editDraftsRef.current };
    if (draft) next[key] = draft.personKey ? draft : { ...draft, personKey: owner };
    // Ending another person's draft of the same list (theirs began after a
    // sign-out landed in the middle of this one's save) is not this call's.
    else if ((next[key]?.personKey || owner) === owner) delete next[key];
    editDraftsRef.current = next;
    setEditDrafts(next);
    const stored = storedDraftKey(owner, projectId, listId);
    writeStoredDraft(stored, draft ? storedCopy(draft, owner) : null);
    setStoredEditDrafts(prev => {
      if (!prev[stored]) return prev;
      const rest = { ...prev };
      delete rest[stored];
      return rest;
    });
    syncDraftHeld();
    setHistoryVersion(v => v + 1);
  }

  function requireDraft(listId) {
    const pid = activeProjectIdRef.current;
    const draft = pid ? editDraftsRef.current[draftKey(pid, listId)] : null;
    if (!draft) throw new Error('there is no unsaved edit of this shot list');
    return { pid, draft };
  }

  /**
   * D13's Yes: a draft of this list — `base` what was on screen (the list's
   * order, or `basedOnEditId`'s items), `items` the first change applied.
   * `title` / `version` are what the question said Yes would make. Refused
   * on an archived list (in the backend's words) and when the list already
   * has a draft (one per list).
   */
  const startEditDraft = useCallback((opts = {}) => {
    const pid = activeProjectIdRef.current;
    if (!pid) throw new Error('no project');
    const list = requireEditableShotList(opts.listId);
    if (editDraftsRef.current[draftKey(pid, list.id)]) throw new Error('this shot list already has an unsaved edit');
    const draft = startDraft({
      projectId: pid,
      listId: list.id,
      basedOnEditId: opts.basedOnEditId || null,
      title: String(opts.title || list.title || '').trim(),
      version: opts.version ?? 1,
      base: opts.base || [],
      items: opts.items || [],
      now: new Date().toISOString(),
      // The shots its first change wrote to the list (New shot; R1-04).
      made: opts.made || [],
    });
    setDraft(pid, list.id, draft);
    return draft;
  }, []);

  /** A change to the draft (each one a step its own undo takes back); opts.made: shots it wrote. */
  const changeEditDraft = useCallback((listId, items, opts = {}) => {
    const { pid, draft } = requireDraft(listId);
    const next = changeDraft(draft, items, new Date().toISOString(), opts.made || []);
    setDraft(pid, listId, next);
    return next;
  }, []);

  /** The draft's own undo / redo: true when something changed. */
  const undoEditDraft = useCallback((listId) => {
    const pid = activeProjectIdRef.current;
    const draft = pid ? editDraftsRef.current[draftKey(pid, listId)] : null;
    const next = draft ? undoDraft(draft, new Date().toISOString()) : null;
    if (!next) return false;
    setDraft(pid, listId, next);
    return true;
  }, []);
  const redoEditDraft = useCallback((listId) => {
    const pid = activeProjectIdRef.current;
    const draft = pid ? editDraftsRef.current[draftKey(pid, listId)] : null;
    const next = draft ? redoDraft(draft, new Date().toISOString()) : null;
    if (!next) return false;
    setDraft(pid, listId, next);
    return true;
  }, []);

  /** Discard changes: the draft goes; nothing was written, so nothing is undone. */
  const discardEditDraft = useCallback((listId) => {
    const pid = activeProjectIdRef.current;
    if (!pid || !editDraftsRef.current[draftKey(pid, listId)]) return false;
    setDraft(pid, listId, null);
    return true;
  }, []);

  /**
   * Save edit (D13, D14): the draft becomes the next edit of its list's ONE
   * chain — createEditFrom continues from the chain's tip whichever edit the
   * draft began from (D6) — and is Saved with saveEdit, whose snapshot keeps
   * the names D17's "Missing shot: <name>" shows. Each item's label is the
   * shot's name now. { title, version, summary }.
   *
   * ONE undo step, recorded here and not through runBatch: the batch is one
   * global slot, and held open across two round trips it takes in whatever
   * else lands meanwhile (S3b-10). Its undo takes the Save back and then
   * withdraws the edit — the maker's own, untouched again, so it shows as
   * "Recently removed" and can be restored; its redo restores and re-Saves.
   *
   * A refusal before the edit is written is thrown in the backend's words and
   * the draft stays. Once the edit is written the draft goes (it IS the
   * edit); if only the Save is then refused, the edit stays as written (its
   * undo the plain withdraw) and the refusal is thrown with that said.
   */
  const saveEditDraft = useCallback(async (listId, opts = {}) => {
    const { pid, draft } = requireDraft(listId);
    // Whose draft this is, held across the round trip: a sign-out can land
    // in the middle of it (review round 2, R2-03).
    const person = draft.personKey || draftPersonRef.current;
    const shots = bundleRef.current.shots || [];
    const items = draft.items.map(it => {
      const sh = it.shot_id ? shots.find(s => s.id === it.shot_id) : null;
      return sh ? { ...it, label: sh.name || it.label || '' } : it;
    });
    const row = await mutationsRef.current.createEditFrom({
      listId,
      title: opts.title ?? draft.title,
      version: opts.version,
      summary: String(opts.summary || '').trim() || null,
      items,
      undoable: false,
    });
    setDraft(pid, listId, null, person);
    if (activeProjectIdRef.current !== pid) return row;
    // Its undo step is its person's: one who signed in meanwhile does not
    // get it (the save itself still finishes).
    const stillTheirs = () => activeProjectIdRef.current === pid && draftPersonRef.current === person;
    let saved;
    try {
      saved = await mutationsRef.current.saveEdit(row.id, row.items, undefined, { history: false });
    } catch (err) {
      if (stillTheirs()) {
        pushHistory({
          undoOps: [surfaced(() => mutationsRef.current.withdrawEdit(row.id))],
          redoOps: [surfaced(() => mutationsRef.current.restoreWithdrawn({ kind: 'edit', id: row.id }))],
        });
      }
      const e = new Error(`The edit was saved as “${formatShotListLabel(row)}”, but the names it holds were not: ${err?.message || err}`);
      e.savedRow = row;
      throw e;
    }
    if (!stillTheirs()) return saved || row;
    const snapshot = saved?.snapshot ?? null;
    pushHistory({
      undoOps: [
        surfaced(() => rewriteSaveIfStill('edit', row.id, snapshot, { snapshot: null })),
        surfaced(() => mutationsRef.current.withdrawEdit(row.id)),
      ],
      redoOps: [
        surfaced(() => mutationsRef.current.restoreWithdrawn({ kind: 'edit', id: row.id })),
        surfaced(() => rewriteSaveIfStill('edit', row.id, null, { snapshot })),
      ],
    });
    return saved || row;
  }, []);

  /** "Recover unsaved edit?" → Recover: a previous run's copy, a draft again. */
  const recoverEditDraft = useCallback((listId) => {
    const pid = activeProjectIdRef.current;
    if (!pid) throw new Error('no project');
    const stored = storedDraftKey(draftPersonRef.current, pid, listId);
    const copy = storedEditDrafts[stored];
    if (!copy) throw new Error('there is no unsaved edit of this shot list to recover');
    requireEditableShotList(listId);
    if (editDraftsRef.current[draftKey(pid, listId)]) throw new Error('this shot list already has an unsaved edit');
    const draft = draftFromCopy(copy);
    setDraft(pid, listId, draft);
    return draft;
  }, [storedEditDrafts]);

  /** …→ Discard: the copy goes. */
  const dismissStoredEditDraft = useCallback((listId) => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    const stored = storedDraftKey(draftPersonRef.current, pid, listId);
    writeStoredDraft(stored, null);
    setStoredEditDrafts(prev => {
      if (!prev[stored]) return prev;
      const rest = { ...prev };
      delete rest[stored];
      return rest;
    });
  }, []);

  // The open project's drafts — those whose list is live (R1-01: a dormant
  // one is not on screen, nor anyone's question) — and the copies a previous
  // run left for it (this person's, newest first, none that a draft in
  // memory supersedes).
  // The live lists as THIS render has them (bundleRef catches up in an
  // effect, after the render that reads these).
  const liveListIds = useMemo(
    () => new Set((bundle.shotLists || []).filter(l => !l.archived_at).map(l => l.id)),
    [bundle.shotLists],
  );
  const openProjectDrafts = useMemo(
    () => Object.values(editDrafts).filter(d => d.projectId === activeProjectId && liveListIds.has(d.listId)),
    [editDrafts, activeProjectId, liveListIds],
  );
  const editDraftOf = useCallback(
    (listId) => {
      const d = activeProjectId && listId ? editDrafts[draftKey(activeProjectId, listId)] || null : null;
      return d && liveListIds.has(d.listId) ? d : null;
    },
    [editDrafts, activeProjectId, liveListIds],
  );
  const recoverableEditDrafts = useMemo(() => Object.values(storedEditDrafts)
    .filter(c => c.personKey === draftPersonKey && c.projectId === activeProjectId && !editDrafts[draftKey(c.projectId, c.listId)])
    .sort((a, b) => String(b.changedAt || '').localeCompare(String(a.changedAt || ''))),
  [storedEditDrafts, draftPersonKey, activeProjectId, editDrafts]);
  const hasUnsavedEdit = openProjectDrafts.some(d => d.dirty);

  // ── The unsaved edit, for the leave guard (S3c, step 7; D12) ─────────────
  // The open project's drafts are what every exit asks about
  // (state/leaveGuard.js). The question is the kit Dialog LeaveEditDialog
  // draws from `leaveAsk`, with D12's three answers: Save edit saves every
  // draft of the open project as its next edit (the name the first-change
  // question gave it, at that title's next version), Discard changes drops
  // them, Keep editing stays. The window's close folds the same three into
  // App's own question (describe / save / discard), so it is one question.
  // A draft of ANOTHER project (left there by an automatic switch) is not
  // this project's exit's business: its copy survives for its own visit.
  const [leaveAsk, setLeaveAsk] = useState(null);
  const leaveAskRef = useRef(null);
  function openDraftsNow() {
    const pid = activeProjectIdRef.current;
    return pid ? Object.values(editDraftsRef.current).filter(d => d.projectId === pid && d.dirty && draftLive(d)) : [];
  }
  function unsavedEditWords() {
    const drafts = openDraftsNow();
    // Review round 2 (R2-01): none left (their list archived elsewhere, the
    // person changed, the last one written) — nothing to say; the question
    // about them settles (below) and App's close question falls back.
    if (!drafts.length) return '';
    const name = (d) => `“${formatShotListLabel(d)}”`;
    const of = (d) => { const l = findShotList(d.listId); return l ? `“${formatShotListLabel(l)}”` : 'its list'; };
    if (drafts.length === 1) return `${name(drafts[0])}, an edit of ${of(drafts[0])}, is not saved.`;
    const each = drafts.map(d => `${name(d)} (of ${of(d)})`);
    return `${drafts.length} edits are not saved: ${each.slice(0, -1).join(', ')} and ${each[each.length - 1]}.`;
  }
  /** How many unsaved edits the leave and close questions are about (their words say "it" or "them"). */
  const unsavedEditCount = useCallback(() => openDraftsNow().length, []);
  // Review round 1 (R1-01): every draft is tried, one after another (each
  // its own undo step), and a refusal does not stop the rest; what was not
  // saved stays unsaved and is said — one edit's refusal in the backend's
  // own words, as before; several, each named with its reason.
  // Review round 2 (R2-01): an edit WRITTEN whose names alone were refused
  // (`savedRow`) is saved, not left: its draft is gone, so a question kept
  // open for it asked about nothing. Its words still say what was refused —
  // in the question when something else keeps it open, else as the
  // provider's own error (ctx.error, the Scenes bar's Banner).
  const saveOpenDrafts = useCallback(async () => {
    const drafts = openDraftsNow();
    const refused = [];
    const notices = [];
    for (const d of drafts) {
      try {
        await saveEditDraft(d.listId, { title: d.title });
      } catch (err) {
        if (err?.savedRow) notices.push(err.message);
        else refused.push({ d, err });
      }
    }
    if (!refused.length) {
      if (notices.length) setError(notices.join(' '));
      return;
    }
    if (drafts.length === 1) throw refused[0].err;
    throw new Error([...notices, ...refused.map(({ d, err }) => `“${formatShotListLabel(d)}” was not saved: ${err?.message || err}`)].join(' '));
  }, [saveEditDraft]);
  const discardOpenDrafts = useCallback(() => {
    for (const d of openDraftsNow()) setDraft(d.projectId, d.listId, null);
  }, []);
  const answerLeave = useCallback((go) => {
    const ask = leaveAskRef.current;
    leaveAskRef.current = null;
    setLeaveAsk(null);
    ask?.resolve(!!go);
  }, []);
  const describeUnsavedEdits = useCallback(() => unsavedEditWords(), []);
  // Review round 2 (R2-01): a question whose drafts have all gone while it
  // was up — their list archived by someone else (R1-01: dormant), the
  // person changed (R1-02), the last one written by its own Save edit — has
  // nothing left to ask. It settles as "go": nothing is lost (a dormant
  // draft and every stored copy stay), and its Save edit can no longer say
  // it saved what it did not.
  useEffect(() => {
    if (leaveAskRef.current && !openDraftsNow().length) answerLeave(true);
  }, [leaveAsk, editDrafts, bundle.shotLists, activeProjectId, answerLeave]);
  useEffect(() => addLeaveGuard({
    order: 2,
    applies: (reason) => reason !== 'popup',
    dirty: () => editDraftHeldRef.current,
    ask: (reason) => new Promise((resolve) => {
      const ask = { reason, resolve };
      leaveAskRef.current = ask;
      setLeaveAsk(ask);
    }),
    describe: () => unsavedEditWords(),
    count: () => openDraftsNow().length,
    save: () => saveOpenDrafts(),
    discard: () => discardOpenDrafts(),
  }), [saveOpenDrafts, discardOpenDrafts]);

  // ── Scenes ─────────────────────────────────────────────
  //
  // S3a: a new scene joins a list — opts.listId (the list the Scenes tab is
  // viewing, S3b), else the ACTIVE list. opts.restoreItems /
  // opts.restoreTaskLinks are the undo path of deleteScene: the memberships
  // and task links the delete removed.
  const addScene = useCallback(async (scene, opts = {}) => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId)    throw new Error('no project');
    // R2-07, as addAsset: answering after a project switch, the scene stays in
    // its own project. It is not placed in a list then (the lists read now are
    // the other project's): there it shows under "Not in any list", whose
    // Add to list… places it.
    const visit = projectVisitRef.current;
    // Refuse an archived or unknown target list BEFORE the scene is written,
    // or the scene would land outside the list the caller is showing. A list
    // this client has not loaded yet is read first (another window made it).
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'listId') && opts.listId) {
      if (!findShotList(opts.listId)) await refreshShotListsNow().catch(() => null);
      requireEditableShotList(opts.listId);
    }
    const row = {
      id:           scene.id || uuidv4(),
      project_id:   activeProjectId,
      sort_order:   bundleRef.current.scenes.length,
      ...scene,
    };
    const created = await adapterRef.current.upsertScene(row);
    const finalRow = created || row;
    if (projectVisitRef.current !== visit) return finalRow;
    // De-duplicated by id: an undo can re-add a row that a parallel undo
    // (ScenesView's un-awaited bulk delete) already brought back (round 2).
    setBundle(prev => ({ ...prev, scenes: [...prev.scenes.filter(x => x.id !== finalRow.id), finalRow] }));
    // Session 26: the entity's own folder. Audrey — five scenes means
    // FIVE folders under SCENES/, not one shared one. Deliberately NOT
    // awaited: the scene is already saved and in state, and a folder that
    // cannot be written must not undo that. ensureEntityFolderFor warns
    // and the next create or reload reconciles.
    ensureEntityFolderFor('scene', finalRow);
    let listId = null;
    if (opts?.restoreItems) {
      // The undo of a delete: memberships and task links are restored
      // independently, so a failed membership never costs the task links.
      try { await restoreMemberships(opts.restoreItems); } catch (err) {
        console.warn('[rabbit] scene restored but a shot-list membership was not:', err?.message || err);
      }
      await restoreTaskLinks('scene_id', finalRow.id, opts.restoreTaskLinks);
    } else {
      try {
        listId = await addNewEntityToList('scene', finalRow, opts);
      } catch (err) {
        // D10 as ruled: a scene in no list shows on no other tab. Rather than
        // leave one there by accident, take it back out and say why (round
        // 2) — the person sees the error and nothing half-made.
        try { await adapterRef.current.deleteScene(finalRow.id, activeProjectId); } catch { /* reported below */ }
        setBundle(prev => ({ ...prev, scenes: prev.scenes.filter(x => x.id !== finalRow.id) }));
        throw err;
      }
    }
    pushHistory({
      undoOps: [() => mutationsRef.current.deleteScene(finalRow.id)],
      redoOps: [() => mutationsRef.current.addScene(finalRow, { listId })],
    }, visit);
    return finalRow;
  }, [activeProjectId, ensureEntityFolderFor]);

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
    // Session 26: a rename MOVES the folder — folderPaths.js records why
    // that was chosen over keeping the slug and changing only the label.
    // Only fires when the name actually rides in the patch; every other
    // edit leaves the tree alone.
    if (patch?.name !== undefined) {
      ensureEntityFolderFor('scene', { ...oldScene, ...patch, id });
    }
    if (oldScene) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateScene(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateScene(id, patch)],
      });
    }
    return result;
  }, [optimistic, ensureEntityFolderFor]);

  // S3a: deleting a scene deletes its SHOTS on every backend (0040's CASCADE
  // in the cloud; the Local Server and the fixtures match it since review
  // round 1), takes the scene and those shots out of EVERY list (0084's
  // CASCADE; the Local Server's sweep) and un-links their tasks (SET NULL).
  // State mirrors all of it, and the undo puts every piece back — the scene,
  // each shot, every membership and every task link. Without the membership
  // half an undone delete would come back outside the active list.
  const deleteScene = useCallback(async (id) => {
    const oldScene = bundleRef.current.scenes.find(s => s.id === id);
    const childShots = (bundleRef.current.shots || []).filter(s => s.scene_id === id).map(s => ({ ...s }));
    const childIds = new Set(childShots.map(s => s.id));
    const items = bundleRef.current.shotListItems || [];
    const tasks = bundleRef.current.tasks || [];
    const sceneItems = items.filter(i => i.scene_id === id).map(i => ({ ...i }));
    const sceneTaskIds = tasks.filter(t => t.scene_id === id).map(t => t.id);
    const shotRestore = childShots.map(sh => ({
      shot: sh,
      items: items.filter(i => i.shot_id === sh.id).map(i => ({ ...i })),
      taskIds: tasks.filter(t => t.shot_id === sh.id).map(t => t.id),
    }));
    const result = await optimistic(
      prev => ({
        ...prev,
        scenes: prev.scenes.filter(s => s.id !== id),
        shots: prev.shots.filter(s => !childIds.has(s.id)),
        shotListItems: (prev.shotListItems || []).filter(i => i.scene_id !== id && !childIds.has(i.shot_id)),
        tasks: prev.tasks.map(t => {
          if (t.scene_id !== id && !childIds.has(t.shot_id)) return t;
          return {
            ...t,
            ...(t.scene_id === id ? { scene_id: null } : {}),
            ...(childIds.has(t.shot_id) ? { shot_id: null } : {}),
          };
        }),
      }),
      () => adapterRef.current.deleteScene(id, activeProjectId),
    );
    if (oldScene) {
      pushHistory({
        undoOps: [
          () => mutationsRef.current.addScene(oldScene, { restoreItems: sceneItems, restoreTaskLinks: sceneTaskIds }),
          ...shotRestore.map(r => () => mutationsRef.current.addShot(r.shot, { restoreItems: r.items, restoreTaskLinks: r.taskIds })),
        ],
        redoOps: [() => mutationsRef.current.deleteScene(id)],
      });
    }
    return result;
  }, [optimistic, activeProjectId]);

  // ── Shots ──────────────────────────────────────────────
  // S3a: the same list rules as addScene — see its comment.
  const addShot = useCallback(async (shot, opts = {}) => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId)    throw new Error('no project');
    // R2-07, as addScene.
    const visit = projectVisitRef.current;
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'listId') && opts.listId) {
      if (!findShotList(opts.listId)) await refreshShotListsNow().catch(() => null);
      requireEditableShotList(opts.listId);
    }
    const row = {
      id:           shot.id || uuidv4(),
      project_id:   activeProjectId,
      sort_order:   bundleRef.current.shots.length,
      ...shot,
    };
    const created = await adapterRef.current.upsertShot(row);
    const finalRow = created || row;
    if (projectVisitRef.current !== visit) return finalRow;
    // De-duplicated by id: an undo can re-add a row that a parallel undo
    // (ScenesView's un-awaited bulk delete) already brought back (round 2).
    setBundle(prev => ({ ...prev, shots: [...prev.shots.filter(x => x.id !== finalRow.id), finalRow] }));
    // Session 26: the entity's own folder. Audrey — five scenes means
    // FIVE folders under SCENES/, not one shared one. Deliberately NOT
    // awaited: the shot is already saved and in state, and a folder that
    // cannot be written must not undo that. ensureEntityFolderFor warns
    // and the next create or reload reconciles.
    ensureEntityFolderFor('shot', finalRow);
    let listId = null;
    if (opts?.restoreItems) {
      try { await restoreMemberships(opts.restoreItems); } catch (err) {
        console.warn('[rabbit] shot restored but a shot-list membership was not:', err?.message || err);
      }
      await restoreTaskLinks('shot_id', finalRow.id, opts.restoreTaskLinks);
    } else {
      try {
        listId = await addNewEntityToList('shot', finalRow, opts);
      } catch (err) {
        // See addScene: no shot is left in no list by accident.
        try { await adapterRef.current.deleteShot(finalRow.id, activeProjectId); } catch { /* reported below */ }
        setBundle(prev => ({ ...prev, shots: prev.shots.filter(x => x.id !== finalRow.id) }));
        throw err;
      }
    }
    pushHistory({
      undoOps: [() => mutationsRef.current.deleteShot(finalRow.id)],
      redoOps: [() => mutationsRef.current.addShot(finalRow, { listId })],
    }, visit);
    return finalRow;
  }, [activeProjectId, ensureEntityFolderFor]);

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
    // Session 26: a rename MOVES the folder — folderPaths.js records why
    // that was chosen over keeping the slug and changing only the label.
    // Only fires when the name actually rides in the patch; every other
    // edit leaves the tree alone.
    if (patch?.name !== undefined) {
      ensureEntityFolderFor('shot', { ...oldShot, ...patch, id });
    }
    if (oldShot) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateShot(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateShot(id, patch)],
      });
    }
    return result;
  }, [optimistic, ensureEntityFolderFor]);

  // S3a: the deleteScene rule, for a shot — out of every list, tasks un-linked,
  // both restored by the undo.
  const deleteShot = useCallback(async (id) => {
    const oldShot = bundleRef.current.shots.find(s => s.id === id);
    const removedItems = (bundleRef.current.shotListItems || []).filter(i => i.shot_id === id).map(i => ({ ...i }));
    const linkedTaskIds = (bundleRef.current.tasks || []).filter(t => t.shot_id === id).map(t => t.id);
    // BC2 (BC1's Deferred): the shot's TAKES, before the delete. On the
    // cloud they go with the shot (0091's shot_takes_shot_fk CASCADE); the
    // Local Server keeps them as orphans. The undo puts them back through
    // replaceShotTakes after the shot — exact on every backend, as
    // removeBinFiles' undo does for a clip's takes.
    const takesBefore = (bundleRef.current.shotTakes || []).filter(t => t.shot_id === id).map(t => ({ ...t }));
    const result = await optimistic(
      prev => ({
        ...prev,
        shots: prev.shots.filter(s => s.id !== id),
        shotListItems: (prev.shotListItems || []).filter(i => i.shot_id !== id),
        tasks: prev.tasks.map(t => (t.shot_id === id ? { ...t, shot_id: null } : t)),
      }),
      () => adapterRef.current.deleteShot(id, activeProjectId),
    );
    if (oldShot) {
      pushHistory({
        undoOps: [async () => {
          await mutationsRef.current.addShot(oldShot, { restoreItems: removedItems, restoreTaskLinks: linkedTaskIds });
          if (takesBefore.length) await mutationsRef.current.replaceShotTakes([id], takesBefore);
        }],
        redoOps: [() => mutationsRef.current.deleteShot(id)],
      });
    }
    return result;
  }, [optimistic, activeProjectId]);

  // ── Levels ─────────────────────────────────────────────
  const addLevel = useCallback(async (level) => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId)    throw new Error('no project');
    const visit = projectVisitRef.current; // R2-07, as addAsset
    const row = {
      id:           level.id || uuidv4(),
      project_id:   activeProjectId,
      sort_order:   bundleRef.current.levels.length,
      ...level,
    };
    const created = await adapterRef.current.upsertLevel(row);
    const finalRow = created || row;
    if (projectVisitRef.current !== visit) return finalRow;
    setBundle(prev => ({ ...prev, levels: [...prev.levels, finalRow] }));
    // Session 26: the entity's own folder. Audrey — five scenes means
    // FIVE folders under SCENES/, not one shared one. Deliberately NOT
    // awaited: the level is already saved and in state, and a folder that
    // cannot be written must not undo that. ensureEntityFolderFor warns
    // and the next create or reload reconciles.
    ensureEntityFolderFor('level', finalRow);
    pushHistory({
      undoOps: [() => mutationsRef.current.deleteLevel(finalRow.id)],
      redoOps: [() => mutationsRef.current.addLevel(finalRow)],
    }, visit);
    return finalRow;
  }, [activeProjectId, ensureEntityFolderFor]);

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
    // Session 26: a rename MOVES the folder — folderPaths.js records why
    // that was chosen over keeping the slug and changing only the label.
    // Only fires when the name actually rides in the patch; every other
    // edit leaves the tree alone.
    if (patch?.name !== undefined) {
      ensureEntityFolderFor('level', { ...oldLevel, ...patch, id });
    }
    if (oldLevel) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateLevel(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateLevel(id, patch)],
      });
    }
    return result;
  }, [optimistic, ensureEntityFolderFor]);

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
    const visit = projectVisitRef.current; // R2-07, as addAsset
    const row = {
      id:           experience.id || uuidv4(),
      project_id:   activeProjectId,
      sort_order:   bundleRef.current.experiences.length,
      ...experience,
    };
    const created = await adapterRef.current.upsertExperience(row);
    const finalRow = created || row;
    if (projectVisitRef.current !== visit) return finalRow;
    setBundle(prev => ({ ...prev, experiences: [...prev.experiences, finalRow] }));
    // Session 26: the entity's own folder. Audrey — five scenes means
    // FIVE folders under SCENES/, not one shared one. Deliberately NOT
    // awaited: the experience is already saved and in state, and a folder that
    // cannot be written must not undo that. ensureEntityFolderFor warns
    // and the next create or reload reconciles.
    ensureEntityFolderFor('experience', finalRow);
    pushHistory({
      undoOps: [() => mutationsRef.current.deleteExperience(finalRow.id)],
      redoOps: [() => mutationsRef.current.addExperience(finalRow)],
    }, visit);
    return finalRow;
  }, [activeProjectId, ensureEntityFolderFor]);

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
    // Session 26: a rename MOVES the folder — folderPaths.js records why
    // that was chosen over keeping the slug and changing only the label.
    // Only fires when the name actually rides in the patch; every other
    // edit leaves the tree alone.
    if (patch?.name !== undefined) {
      ensureEntityFolderFor('experience', { ...oldExperience, ...patch, id });
    }
    if (oldExperience) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateExperience(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateExperience(id, patch)],
      });
    }
    return result;
  }, [optimistic, ensureEntityFolderFor]);

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
    // S5c review round 1 (R1-04): see addPhase. Here the stakes are higher —
    // this step's undo DESTROYS (a hard delete), so landed on the other
    // project's stack it would erase a key date of this project for good.
    const visit = projectVisitRef.current;
    const row = {
      id:           milestone.id || uuidv4(),
      project_id:   activeProjectId,
      ...milestone,
    };
    const created = await adapterRef.current.upsertMilestone(row);
    const finalRow = created || row;
    if (projectVisitRef.current !== visit) return finalRow;
    // Dedupe rather than append blind: a refetch can land between an undo and
    // the redo that replays this, and two rows with one id break every
    // keyed render downstream.
    // Sorted, not appended. Both adapters load key dates ORDER BY date, id and
    // the merge layer splices incoming ones into that order — but THIS is the
    // path that runs on Local Server, where there is no broadcast at all, so
    // without it a new key date sat at the bottom of the Tasks tab's key-date
    // block until the next reload. In cloud it merely looked right, because
    // the author's own broadcast echo re-sorted it a moment later — an
    // accidental dependency on live sync, not a design. R1.
    setBundle(prev => ({
      ...prev,
      milestones: [...prev.milestones.filter(m => m.id !== finalRow.id), finalRow]
        .sort(byMilestoneDate),
    }));
    // 🚨 UNDOING A CREATE DESTROYS; DELETING AN EXISTING ROW TRASHES. R1 of
    // this session caught the difference being lost.
    //
    // deleteMilestone is now a SOFT delete on both backends (0067 in cloud,
    // the softDelete opt on the desktop). Reusing it here broke undo/redo in
    // two ways at once. (1) Redo: `addMilestone(finalRow)` upserted an id that
    // still existed with deleted_at set — `deleted_at` is deliberately not in
    // MILESTONE_COLUMNS, so the stamp survived the upsert, the RETURNING read
    // was then filtered out by milestones_select, `.single()` answered
    // PGRST116, and `redo` SWALLOWS errors, so pressing Redo did nothing at
    // all, silently. On the desktop the row came back on screen carrying its
    // stamp and vanished on the next reload. (2) The trash: undoing a create
    // filed the row under "Recently deleted" as something the user had chosen
    // to delete, and on Local Server nothing purges, so every undone create
    // accumulated there forever with no way to remove it.
    //
    // So the undo of a create uses `destroyMilestone` — a hard delete — which
    // makes the redo's plain insert correct again and leaves no trash entry.
    // An adapter without it (a future one) falls back to the soft delete,
    // which is worse but not broken.
    const canDestroy = typeof adapterRef.current?.destroyMilestone === 'function';
    pushHistory({
      undoOps: [() => optimistic(
        prev => ({ ...prev, milestones: prev.milestones.filter(m => m.id !== finalRow.id) }),
        () => (canDestroy
          ? adapterRef.current.destroyMilestone(finalRow.id, activeProjectId)
          : adapterRef.current.deleteMilestone(finalRow.id, activeProjectId)),
      )],
      redoOps: [() => mutationsRef.current.addMilestone(finalRow)],
    }, visit);
    return finalRow;
  }, [activeProjectId, optimistic]);

  const updateMilestone = useCallback(async (id, patch) => {
    const visit = projectVisitRef.current;
    const oldMilestone = bundleRef.current.milestones.find(m => m.id === id);
    const oldValues = {};
    if (oldMilestone) {
      for (const k of Object.keys(patch)) oldValues[k] = oldMilestone[k];
    }
    // LWW per field — see updatePhase. 🚨 ADDED WITH 0077 AND REQUIRED BY IT.
    // Before key dates were broadcast, milestones were the one table where
    // this was dead weight: no remote event for them could ever arrive. Now
    // one can, and without this the window between the optimistic apply and
    // the server's answer is a window in which a collaborator's broadcast
    // overwrites what this person just changed. It also means realtimeMerge's
    // pending-field probe tests something production actually reaches — R1
    // found it testing a mechanism that never engaged.
    const fields = Object.keys(patch);
    notePendingFields('milestones', id, fields);
    let result;
    try {
      result = await optimistic(
        // Re-sorted, because a date is not a name: moving a key date's date
        // moves its row, and on Local Server nothing else would ever do it.
        prev => ({
          ...prev,
          milestones: prev.milestones
            .map(m => m.id === id ? { ...m, ...patch } : m)
            .sort(byMilestoneDate),
        }),
        // patchMilestone when the adapter has one (cloud), so two people
        // editing different fields of the same key date do not overwrite each
        // other — the same preference updateTask expresses for patchTask.
        () => (typeof adapterRef.current.patchMilestone === 'function'
          ? adapterRef.current.patchMilestone(id, patch)
          : adapterRef.current.upsertMilestone({ ...bundleRef.current.milestones.find(m => m.id === id), ...patch, id })),
      );
    } finally {
      // try/finally, copied from updateTask: a throwing adapter must not leave
      // the field pinned, or that row stops accepting remote updates for the
      // rest of the session.
      clearPendingFields('milestones', id, fields);
    }
    if (oldMilestone) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateMilestone(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateMilestone(id, patch)],
      }, visit);
    }
    return result;
  }, [optimistic, notePendingFields, clearPendingFields]);

  const deleteMilestone = useCallback(async (id) => {
    const visit = projectVisitRef.current;
    const oldMilestone = bundleRef.current.milestones.find(m => m.id === id);
    // A2 session 2, rulings 26 and 38. Both backends now TRASH a milestone
    // rather than destroying it — cloud through 0014's soft_delete_row (0067
    // put milestones on its allowlist), desktop through main.cjs's softDelete
    // opt — so undo RESTORES the row it deleted instead of inserting a new
    // one. Re-inserting would work on neither backend now: the id still
    // exists, trashed, and an upsert would resurrect it with deleted_at
    // intact on the desktop and be refused by milestones_update in cloud.
    //
    // The capability check mirrors deletePhase's: an adapter without a
    // restore method (a future one, or a stub) keeps the old re-insert path
    // rather than losing undo altogether.
    const canRestore = typeof adapterRef.current?.restoreMilestone === 'function';
    const result = await optimistic(
      prev => ({ ...prev, milestones: prev.milestones.filter(m => m.id !== id) }),
      () => adapterRef.current.deleteMilestone(id, activeProjectId),
    );
    if (oldMilestone) {
      const token = pushHistory({
        undoOps: canRestore
          ? [async () => {
              await adapterRef.current.restoreMilestone(id, activeProjectId);
              // Dedupe, and reinstate rather than append. The adapter answers
              // false when the row was already live — someone else restored it
              // first, or a refetch landed between the delete and this click —
              // and a blind append would then put TWO rows with one id in the
              // bundle until the next load.
              setBundle(prev => ({
                ...prev,
                milestones: [...prev.milestones.filter(m => m.id !== id), oldMilestone]
                  .sort(byMilestoneDate),
              }));
            }]
          : [() => mutationsRef.current.addMilestone(oldMilestone)],
        redoOps: [() => mutationsRef.current.deleteMilestone(id)],
      }, visit);
      // Ruling 38's undo toast. Assets have had one since S6 (OWED_AUDREY §3)
      // and phases since A2 session 1; a milestone delete used to be final
      // with nothing but a confirm dialog in front of it (MASTER_PLAN §6 #10).
      if (token != null) {
        showUndoToast(
          `Deleted key date "${oldMilestone.title || 'Untitled'}"`,
          () => undoHistoryEntry(token),
        );
      }
    }
    return result;
  }, [optimistic, activeProjectId, showUndoToast, undoHistoryEntry]);

  // "Recently deleted" for the timeline's trash panel. Reads the adapter
  // directly rather than the bundle: in cloud the trashed rows are invisible
  // to every table read by design (milestones_select filters deleted_at), so
  // they can only come from 0067's SECURITY DEFINER index.
  // 🚨 null means "this storage backend does not keep deleted key dates", and
  // [] means "the trash is empty". Returning [] for both is the mistake
  // unwrapOptionalTable's own comment condemns and that useRosterMembers makes,
  // where a broken read and an empty result are indistinguishable at every call
  // site — R1 of this session found the same shape here. googleDriveAdapter is
  // read-only and implements none of the milestone methods, so on Drive the
  // panel would otherwise have claimed an empty trash it never looked in. The
  // EditHistoryDrawer / FileAuditDrawer precedent is to name the adapter.
  const listTrashedMilestones = useCallback(async () => {
    // No project open is not the same claim as "this backend keeps no trash",
    // and answering null for both would put a false sentence about the adapter
    // on screen. An empty list is the honest answer when there is nothing to
    // ask about. (Not reachable from the timeline toolbar today — no project
    // means no TimelineView — but it is the same two-answers-one-value
    // conflation the third state exists to remove.)
    if (!adapterRef.current || !activeProjectId) return [];
    if (typeof adapterRef.current.listTrashedMilestones !== 'function') return null;
    return (await adapterRef.current.listTrashedMilestones(activeProjectId)) || [];
  }, [activeProjectId]);

  // Restore from that panel. Unlike undo this is not a history operation —
  // the row may have been trashed in another session entirely — so it
  // refetches rather than replaying a captured row, and answers the adapter's
  // boolean: false means someone else restored it first.
  const restoreMilestone = useCallback(async (id) => {
    if (!adapterRef.current || !activeProjectId) return false;
    if (typeof adapterRef.current.restoreMilestone !== 'function') return false;
    const restored = await adapterRef.current.restoreMilestone(id, activeProjectId);
    const rows = typeof adapterRef.current.listMilestones === 'function'
      ? await adapterRef.current.listMilestones(activeProjectId)
      : null;
    // S5b review round 1 (R1-02): listMilestones answers every live key date,
    // the set-aside ones too (no backend splits a list read); they are split
    // out again here, or restoring one key date put every other bid's key
    // dates on the Timeline — and the next Save of the open version hid them
    // for good.
    if (rows) {
      const apply = (prev) => splitSetAside({ ...prev, milestones: rows, setAsideMilestones: [] });
      setBundle(apply);
      bundleRef.current = apply(bundleRef.current);
    }
    return restored;
  }, [activeProjectId]);

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
    // S5c review round 1 (R1-04): see addPhase.
    const visit = projectVisitRef.current;
    let created;
    try {
      created = await adapterRef.current.upsertTask(row);
    } catch (err) {
      setError(err?.message || String(err));
      throw err;
    }
    const finalRow = created || row;
    if (projectVisitRef.current !== visit) return finalRow;
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
    }, visit);
    return finalRow;
  }, [activeProjectId]);

  const updateTask = useCallback(async (id, patch) => {
    const visit = projectVisitRef.current;
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
      }, visit);
    }
    return result;
  }, [optimistic, notePendingFields, clearPendingFields]);

  const deleteTask = useCallback(async (id) => {
    const visit = projectVisitRef.current;
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
      }, visit);
      if (token != null) {
        showUndoToast(`Deleted task "${oldTask.title || 'Untitled'}"`, () => undoHistoryEntry(token));
      }
    }
    return result;
  }, [optimistic, activeProjectId, showUndoToast, undoHistoryEntry]);

  // Bulk delete — see deleteAssets. One combined entry, one toast.
  const deleteTasks = useCallback(async (ids = []) => {
    const visit = projectVisitRef.current;
    if (!Array.isArray(ids) || ids.length === 0) return;
    const canSoftDelete = typeof adapterRef.current?.restoreTask === 'function';
    const idSet = new Set(ids);
    const removedTasks = bundleRef.current.tasks.filter(t => idSet.has(t.id));
    const removedDeps = bundleRef.current.dependencies.filter(
      d => idSet.has(d.predecessor_id) || idSet.has(d.successor_id),
    );
    if (removedTasks.length === 0) return;
    const dropping = (gone) => (prev) => ({
      ...prev,
      tasks: prev.tasks.filter(t => !gone.has(t.id)),
      dependencies: prev.dependencies.filter(
        d => !gone.has(d.predecessor_id) && !gone.has(d.successor_id),
      ),
    });
    // The step for `rows` deleted: all of them — or, stopped part way where
    // the backend cannot restore, the ones that went.
    const stepFor = (rows) => {
      const gone = new Set(rows.map(t => t.id));
      const deps = removedDeps.filter(d => gone.has(d.predecessor_id) || gone.has(d.successor_id));
      return {
        undoOps: canSoftDelete
          ? [async () => {
              for (const t of rows) await adapterRef.current.restoreTask(t.id);
              setBundle(prev => ({
                ...prev,
                tasks:        [...prev.tasks, ...rows],
                dependencies: [...prev.dependencies, ...deps],
              }));
            }]
          : [
              ...rows.slice().reverse().map(t => () => mutationsRef.current.addTask(t)),
              ...deps.map(d => async () => {
                await optimistic(
                  prev => ({ ...prev, dependencies: [...prev.dependencies, d] }),
                  () => adapterRef.current.upsertDependency(d),
                );
              }),
            ],
        redoOps: [() => mutationsRef.current.deleteTasks(rows.map(t => t.id))],
      };
    };
    let result;
    try {
      result = await optimistic(
        dropping(idSet),
        async () => {
          // Bulk delete is all-or-nothing where the backend can restore: on a
          // mid-loop failure, restore the rows already soft-deleted
          // server-side, then rethrow for rollback.
          const done = [];
          try {
            for (const t of removedTasks) {
              await adapterRef.current.deleteTask(t.id, activeProjectId);
              done.push(t.id);
            }
          } catch (err) {
            if (canSoftDelete) {
              await Promise.allSettled(done.map(id => adapterRef.current.restoreTask(id)));
            } else if (err && typeof err === 'object') {
              err.deletedIds = done;
            }
            throw err;
          }
        },
      );
    } catch (err) {
      // S5c review round 2 (R2-01): where the backend cannot restore (the
      // Local Server: its DELETE removes the row), the tasks deleted before
      // the failure are GONE. The rollback showed them live again and no step
      // was recorded, so nothing could put them back, though a composite's
      // words said "Undo takes back what changed". They leave the screen
      // and their step is recorded (its undo writes them back, as this
      // backend's undo always does); `deletedIds` says which went.
      const went = removedTasks.filter(t => (err?.deletedIds || []).includes(t.id));
      if (went.length && projectVisitRef.current === visit) {
        const apply = dropping(new Set(went.map(t => t.id)));
        setBundle(apply);
        bundleRef.current = apply(bundleRef.current);
        const token = pushHistory(stepFor(went), visit);
        if (token != null) {
          showUndoToast(`Stopped after deleting ${went.length} of ${removedTasks.length} tasks`, () => undoHistoryEntry(token), { hold: true });
        }
      }
      throw err;
    }
    const token = pushHistory(stepFor(removedTasks), visit);
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
      // Third argument is the edge's kind — 0061 split the two edge kinds
      // across two tables and the supabase adapter needs to know which one to
      // delete from. It goes third because argument two is projectId, which
      // localServerAdapter interpolates into its URL. An undefined kind is
      // handled (the adapter tries both tables); passing the wrong one would
      // be a silent no-op, so it is read from the row, never assumed.
      () => adapterRef.current.deleteDependency(dependencyId, activeProjectId, oldRow?.kind),
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
  // Session 42: `opts` carries transport concerns — today just onProgress, for
  // the resumable path. Deliberately separate from `scope`, which describes the
  // ROW and whose keys reach the files INSERT through the column allowlist.
  const uploadFile = useCallback(async (file, scope = {}, opts = {}) => {
    if (!adapterRef.current || !activeProjectId) throw new Error('no project');
    const created = await adapterRef.current.uploadFile(activeProjectId, scope, file, opts);
    // Upsert, not append — see addPhase (broadcast echo race).
    setBundle(prev => ({
      ...prev,
      files: prev.files.some(f => f.id === created.id)
        ? prev.files.map(f => (f.id === created.id ? { ...f, ...created } : f))
        : [...prev.files, created],
    }));
    return created;
  }, [activeProjectId]);

  // Post-overhaul S4a: the file verbs take the project a file belongs to.
  // RESOURCES → FILES edits any project's files without opening it, and
  // only the OPEN project's rows live in the bundle — so a write for another
  // project goes straight to the adapter WITH ITS OWN id (the Local Server
  // builds the URL from it, and in the cloud project_id is a column: sending
  // the open project's id would move the row into it). Omitted, it is the
  // open project, exactly as before.
  //
  // Review round 2 (R2-UI-01, measured): the optimistic write kept the row's
  // OLD updated_at, and an explorer whose own copy carried the server's newer
  // one (from its last save or read) kept that copy over the provider's — so
  // the other host showed the note from before this write, and a line added
  // there wrote the older note back. When the write lands, the server's row
  // replaces the optimistic one: only for the latest write sent for that row
  // (an earlier write's answer would undo a later optimistic edit), and only
  // while the project it was written in is still the one open.
  const fileWriteSeqRef = useRef({ next: 0, latest: new Map() });
  const writeFileRow = useCallback(async (key, id, projectId, mutator, write) => {
    const seqs = fileWriteSeqRef.current;
    const seqKey = `${key}:${id}`;
    const seq = ++seqs.next;
    seqs.latest.set(seqKey, seq);
    let saved;
    try {
      saved = await optimistic(mutator, write);
    } catch (err) {
      if (seqs.latest.get(seqKey) === seq) seqs.latest.delete(seqKey);
      throw err;
    }
    if (seqs.latest.get(seqKey) !== seq) return saved;
    seqs.latest.delete(seqKey);
    if (saved && typeof saved === 'object' && saved.id === id) {
      setBundle(prev => (prev?.project?.id !== projectId || !Array.isArray(prev?.[key]) ? prev : {
        ...prev,
        [key]: prev[key].map(f => (f.id === id ? { ...f, ...saved } : f)),
      }));
    }
    return saved;
  }, [optimistic]);

  const markFileCoreDefiner = useCallback((fileId, isCore, projectId = activeProjectId) => {
    // S4b (0088): a Legal file is never core — its text would reach Intake
    // and D.O.G., which the whole project reads. Refused here, before
    // anything is sent, when the row is in hand; the database's
    // files_legal_not_core_chk refuses it whatever reaches it.
    if (isCore) {
      const known = (bundleRef.current?.files || []).find(f => f.id === fileId);
      if (known && isLegalFile(known)) return Promise.reject(new Error(LEGAL_NOT_CORE_REASON));
    }
    if (projectId && projectId !== activeProjectId) {
      return adapterRef.current.updateFile(fileId, { is_core_definer: isCore, project_id: projectId });
    }
    return writeFileRow('files', fileId, activeProjectId,
      prev => ({
        ...prev,
        files: prev.files.map(f => f.id === fileId ? { ...f, is_core_definer: isCore } : f),
      }),
      () => adapterRef.current.updateFile(fileId, { is_core_definer: isCore, project_id: activeProjectId }),
    );
  }, [writeFileRow, activeProjectId]);

  const patchFile = useCallback((fileId, patch, projectId = activeProjectId) => {
    if (projectId && projectId !== activeProjectId) {
      return adapterRef.current.updateFile(fileId, { ...patch, project_id: projectId });
    }
    return writeFileRow('files', fileId, activeProjectId,
      prev => ({
        ...prev,
        files: prev.files.map(f => f.id === fileId ? { ...f, ...patch } : f),
      }),
      () => adapterRef.current.updateFile(fileId, { ...patch, project_id: activeProjectId }),
    );
  }, [writeFileRow, activeProjectId]);

  // Session 27. `files` had upload and patch on the context but no delete and
  // no download, because the only consumer was a read-mostly table. FileManager
  // now serves this store too and needs the whole verb set.
  const deleteFile = useCallback((fileId) => optimistic(
    prev => ({ ...prev, files: prev.files.filter(f => f.id !== fileId) }),
    () => adapterRef.current.deleteFile(fileId, activeProjectId),
  ), [optimistic, activeProjectId]);

  // Returns a Blob. Not optimistic and not state — a read straight through to
  // the backend, which is the only one that can turn a storage_path into bytes.
  const downloadFile = useCallback(async (file) => {
    if (!adapterRef.current?.downloadFile) throw new Error('this backend cannot download files');
    return adapterRef.current.downloadFile(file);
  }, []);

  // Session 40: a URL a <video> can STREAM from — which is not the same thing
  // as downloadFile above, and cannot be built out of it.
  //
  // 🚨 downloadFile RETURNS A WHOLE BLOB. That is right for a download and
  // useless for playback: a <video> needs a URL to issue Range requests
  // against, and a multi-GB master cannot be held in memory as a Blob at all.
  //
  // Returns null when this backend or this provider cannot mint one — an s3 row
  // today (deferred: its presigned GET expires in 300s and no S3 workspace
  // exists anywhere to verify a longer-lived signer against), or Local Server,
  // whose managed files are streamed by the Express route instead. The caller
  // shows "preview unavailable" rather than an error, because that is a stated
  // capability gap and not a fault. A signing FAILURE still throws.
  const fileUrl = useCallback(async (file) => {
    if (!adapterRef.current?.fileUrl) return null;
    return adapterRef.current.fileUrl(file);
  }, []);

  // Session 42: a URL that DOWNLOADS rather than plays. Distinct from fileUrl
  // above, which is deliberately inline so a <video> can stream from it —
  // Content-Disposition: attachment would make the player save the file
  // instead. Distinct from downloadFile, which buffers the whole body into a
  // Blob and therefore cannot carry the multi-GB objects 0057 now permits.
  //
  // Returns null on a backend or provider that cannot sign, and the caller
  // falls back to the Blob path.
  const downloadUrl = useCallback(async (file, filename) => {
    if (!adapterRef.current?.downloadUrl) return null;
    return adapterRef.current.downloadUrl(file, filename);
  }, []);

  // Session 39: signed display URLs for cloud thumbnails, keyed by object path.
  //
  // Returns an EMPTY MAP rather than throwing on a backend that has no such
  // concept — Local Server serves its previews from the Express route and has
  // no bucket to sign against. A missing preview must never take a file list
  // down with it, so this is the one file method that cannot fail loudly.
  const thumbnailUrls = useCallback(async (paths) => {
    if (!adapterRef.current?.thumbnailUrls) return new Map();
    try {
      return await adapterRef.current.thumbnailUrls(paths);
    } catch (err) {
      console.warn('[rabbit] thumbnail URLs unavailable:', err?.message || err);
      return new Map();
    }
  }, []);

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

  // S4a (E11): managed files get notes and tags through this PATCH; the
  // project id rule and the landing of the saved row are patchFile's (above).
  const updateManagedFile = useCallback(async (id, patch, projectId = activeProjectId) => {
    if (projectId && projectId !== activeProjectId) {
      return adapterRef.current.updateManagedFile(id, { ...patch, project_id: projectId });
    }
    return writeFileRow('managedFiles', id, activeProjectId,
      prev => ({
        ...prev,
        managedFiles: (prev.managedFiles || []).map(f =>
          f.id === id ? { ...f, ...patch } : f
        ),
      }),
      () => adapterRef.current.updateManagedFile(id, { ...patch, project_id: activeProjectId }),
    );
  }, [writeFileRow, activeProjectId]);

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

  // ── Bins (demo 2026-09-11, docs/BINS_DESIGN.md; on the cloud since BC1) ──
  //
  // Every backend that can hold bins — the Local Server, the cloud (0091),
  // the dev fixtures — exposes the same method names; Google Drive has none,
  // so every callback feature-detects and throws a sentence rather than a
  // TypeError. What a backend CANNOT do (the cloud cannot pick files with an
  // OS dialog, read a file's columns, stream its bytes or relink a drive) it
  // says through ONE capability object, `binsCapabilities()`, kept on
  // binsInfo.capabilities; the adapter answers `not_supported_here` for
  // those, and the mutators here stand down where a capability is absent
  // (no probe pass on the cloud). State lives in the bundle (bins, binFiles,
  // binRoots, binLocations, shotTakes) so project switches and realtime
  // refetches reset it the same way as everything else. History entries
  // call through mutationsRef so undo always reaches the latest mutator;
  // pushHistory is suspended while an undo runs, so the mutators may push
  // unconditionally.
  // BC2: through binsBackend() — the desktop-signed-in composite when this
  // computer's file process answers on the cloud, else the adapter itself.
  const binsAdapter = useCallback(() => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (!activeProjectId) throw new Error('no project');
    if (typeof adapterRef.current.listBins !== 'function') {
      throw new Error('Bins are not available on this backend');
    }
    return binsBackend();
  }, [activeProjectId, binsBackend]);
  // The company's footage locations and the switch need no open project:
  // Settings, Storage manages them with or without one (BC2, item 2).
  const locationsAdapter = useCallback(() => {
    if (!adapterRef.current) throw new Error('no adapter');
    if (typeof adapterRef.current.listBins !== 'function') {
      throw new Error('Bins are not available on this backend');
    }
    return binsBackend();
  }, [binsBackend]);

  // `posterRev` counts posters the renderer's own probe posted, so every
  // <img> built from binFileThumbnailUrl(id, rev) re-requests a poster that
  // arrived after it first failed (BinPoster remembers WHICH src failed).
  // `capabilities` is the backend's object (above); `remoteViewing` is the
  // company's switch (B5a) where the backend has one, else null.
  // BC2: `locations` is what THIS computer's desktop process answered when
  // the company's locations were registered — [{ id, reachable, root,
  // local_path, local_path_source?, local_path_reason?, status }] — empty
  // where there is no desktop composite.
  const [binsInfo, setBinsInfo] = useState({ ffmpeg: null, loadedFor: null, probing: 0, posterRev: 0, capabilities: null, remoteViewing: null, locations: [] });

  // ── BC2: is the desktop's file process reachable? ──
  // On the cloud inside the desktop app, the cloud-bins ping decides. Off
  // the cloud (or on leaving it), this computer is told to forget the
  // company's addresses: an empty registration replaces the list.
  useEffect(() => {
    let cancelled = false;
    const inDesktop = !!globalThis.window?.electronAPI?.rabbit;
    if (adapterMode !== 'supabase' || !inDesktop) {
      const had = desktopBinFilesRef.current;
      desktopBinFilesRef.current = null;
      setDesktopBinFiles(null);
      if (had) had.files.registerCloudBinLocations([]).catch(() => {});
      return undefined;
    }
    const files = localServerAdapter();
    Promise.resolve().then(() => files.cloudBinsPing()).then((ping) => {
      if (cancelled || !ping?.ok) return;
      const d = { files, ping };
      desktopBinFilesRef.current = d;
      setDesktopBinFiles(d);
    }).catch(() => { /* no desktop process: the cloud's own answers stand */ });
    return () => { cancelled = true; };
  }, [adapterMode]);

  // What this computer can reach, asked again for the given rows (or all of
  // them), debounced. A row the desktop does not answer for reads "not on
  // this computer". Dropped when the project changed meanwhile.
  const binResolveTimerRef = useRef(null);
  const binResolvePendingRef = useRef(null); // null = nothing pending; 'all' or a Set of ids
  // Review round 1, finding 7: answers can land out of order (a resolve
  // waiting on a slow root, then a quick one after "Where is it on this
  // computer?"). Each row keeps the number of the latest question asked for
  // it; an older answer for it is dropped.
  // (One entry per clip resolved this session — bounded by the clips seen;
  // review round 2 noted it, a known limit.)
  const binResolveSeqRef = useRef({ n: 0, byId: new Map() });
  // Finding 4: a clip on a location this computer was never told of (a
  // teammate named it since; locations are not broadcast) — the company's
  // list is read again, at most every ten seconds, and its key change
  // registers it and resolves its clips. Reached through a ref: the reader
  // is defined in the bins block below.
  const refreshBinLocationsRef = useRef(null);
  const binLocationsRereadAtRef = useRef(0);
  // Location ids already read again once and still unknown: not read again
  // (a location gone from the company's list would otherwise poll forever).
  const binLocationsRereadForRef = useRef(new Set());
  const resolveBinOnline = useCallback(async (ids = null) => {
    const a = binsBackend();
    if (typeof a?.resolveBinFiles !== 'function') return;
    const pid = activeProjectIdRef.current;
    const want = ids ? new Set(ids) : null;
    const rows = (bundleRef.current.binFiles || []).filter(f => f.location_id && (!want || want.has(f.id)));
    if (!rows.length) return;
    const seq = binResolveSeqRef.current;
    const n = ++seq.n;
    for (const r of rows) seq.byId.set(r.id, n);
    let map;
    try { map = await a.resolveBinFiles(rows); } catch { return; }
    if (activeProjectIdRef.current !== pid) return;
    const asked = new Set(rows.filter(r => seq.byId.get(r.id) === n).map(r => r.id));
    if (asked.size) {
      setBundle(prev => ({
        ...prev,
        binFiles: (prev.binFiles || []).map(f => (asked.has(f.id) ? { ...f, online: map.get(f.id)?.online === true } : f)),
      }));
    }
    // Finding 8: what resolve learned about a LOCATION reaches the notices
    // and the relink dialog, not only the rows — a server that went down
    // after registration reads "not reachable", never "the file is not at
    // its path" (which would counsel removing the clip).
    const byLoc = new Map();
    for (const r of rows) {
      const ans = asked.has(r.id) ? map.get(r.id) : null;
      if (!ans) continue;
      const cur = byLoc.get(r.location_id) || {};
      if (ans.online) cur.online = true;
      if (ans.reason === 'location_unreachable') cur.unreachable = true;
      if (ans.reason === 'not_connected') cur.notConnected = true;
      byLoc.set(r.location_id, cur);
    }
    if (byLoc.size) {
      setBinsInfo(i => ({
        ...i,
        locations: (i.locations || []).map(st => {
          const b = st && byLoc.get(st.id);
          if (!b || st.status === 'refused') return st;
          if (b.online) return st.reachable === true && st.connected !== false ? st : { ...st, reachable: true, connected: true };
          if (b.notConnected) return st.connected === false ? st : { ...st, connected: false, reachable: false };
          if (b.unreachable) return st.reachable === false ? st : { ...st, reachable: false };
          return st;
        }),
      }));
    }
    const known = new Set((bundleRef.current.binLocations || []).map(l => l.id));
    const rereadFor = binLocationsRereadForRef.current;
    const unknownIds = [...new Set(rows.filter(r => map.get(r.id)?.reason === 'unknown_location' || !known.has(r.location_id)).map(r => r.location_id))]
      .filter(id => id && !rereadFor.has(id));
    if (unknownIds.length && Date.now() - binLocationsRereadAtRef.current > 10000) {
      binLocationsRereadAtRef.current = Date.now();
      for (const id of unknownIds) rereadFor.add(id);
      Promise.resolve(refreshBinLocationsRef.current?.()).catch(() => {});
    }
  }, [binsBackend]);
  scheduleBinResolveRef.current = (ids = null) => {
    if (!desktopBinFilesRef.current) return;
    const cur = binResolvePendingRef.current;
    if (!ids || cur === 'all') binResolvePendingRef.current = 'all';
    else binResolvePendingRef.current = new Set([...(cur || []), ...ids]);
    clearTimeout(binResolveTimerRef.current);
    binResolveTimerRef.current = setTimeout(() => {
      const p = binResolvePendingRef.current;
      binResolvePendingRef.current = null;
      resolveBinOnline(p === 'all' ? null : [...(p || [])]).catch(() => {});
    }, 250);
  };
  useEffect(() => () => clearTimeout(binResolveTimerRef.current), []);

  // ── BC2: register the company's locations with this computer ──
  // On sign-in (the composite appears) and on every change of the company's
  // locations (an add, a re-address, a removal), the list is registered with
  // the desktop process — only what the cloud returned, never a typed path —
  // and every clip is resolved again. refreshBins registers through the
  // composite's listBins itself; the key it registered is remembered so the
  // same list is not sent twice for one load.
  const binLocationsKey = (bundle.binLocations || []).map(l => `${l.id}|${l.unc_path}`).sort().join('\n');
  const registeredKeyRef = useRef(null);
  // `explicit`: the list as a mutator just made it (state lands a render
  // later than the mutator's next line).
  const registerBinLocationsNow = useCallback(async (explicit = null) => {
    const a = binsBackend();
    if (typeof a?.registerBinLocations !== 'function') return [];
    const list = explicit || bundleRef.current.binLocations || [];
    const status = await a.registerBinLocations(list);
    registeredKeyRef.current = list.map(l => `${l.id}|${l.unc_path}`).sort().join('\n');
    setBinsInfo(i => ({ ...i, locations: status }));
    return status;
  }, [binsBackend]);
  useEffect(() => {
    if (!desktopBinFiles) { registeredKeyRef.current = null; return; }
    // The composite appeared after a list was read with the cloud's own
    // answers: the capability object the tab reads is the composite's now.
    const caps = binsCapabilitiesOf(binsBackend());
    if (binsCapsRef.current && binsCapsRef.current.backend !== caps.backend) {
      binsCapsRef.current = caps;
      setBinsInfo(i => ({ ...i, capabilities: caps, ffmpeg: desktopBinFiles.ping?.ffmpeg === true }));
    }
    if (registeredKeyRef.current === binLocationsKey) return;
    let cancelled = false;
    (async () => {
      try {
        await registerBinLocationsNow();
        if (!cancelled) await resolveBinOnline(null);
      } catch (e) {
        if (!cancelled) setBinsInfo(i => ({ ...i, notice: { text: `This computer could not be told where the company's footage is: ${e?.message || e}`, kind: 'warn', at: Date.now() } }));
      }
    })();
    return () => { cancelled = true; };
  }, [desktopBinFiles, binLocationsKey, registerBinLocationsNow, resolveBinOnline, binsBackend]);
  // The renderer's own probe and the once-per-project pass are defined below
  // (they need the URL and PATCH helpers); refreshBins and probeBinFile reach
  // them through refs — the mutationsRef pattern.
  const browserProbeRef = useRef(null);
  const browserProbeSweepRef = useRef(null);
  const browserProbeSweptRef = useRef(null);
  // BC2: the switch-gated poster upload (defined below, beside the poster
  // helpers); addBinFiles and the renderer's probe reach it through here.
  const uploadPostersRef = useRef(null);

  const mergeRows = (rows, incoming) => {
    const byId = new Map((rows || []).map(r => [r.id, r]));
    for (const r of incoming || []) byId.set(r.id, { ...(byId.get(r.id) || {}), ...r });
    return [...byId.values()];
  };
  // BC3: a clip row a mutation hands back (a copy, a restore, a patch) carries
  // no `online` where the backend cannot say what this computer reaches (a
  // browser): it is "not on this computer" like every other (B3), never
  // read as reachable for want of the mark (review round 1).
  const mergeFileRows = (rows, incoming) => mergeRows(rows, binsCapsRef.current?.resolveFiles === false
    ? (incoming || []).map(r => ({ ...r, online: false }))
    : incoming);

  const refreshBins = useCallback(async () => {
    if (!adapterRef.current || !activeProjectId) return null;
    if (typeof adapterRef.current.listBins !== 'function') return null;
    const projectId = activeProjectId;
    const a = binsBackend();
    const caps = binsCapabilitiesOf(a);
    binsCapsRef.current = caps;
    const data = await a.listBins(projectId);
    // BC2: the composite registered the company's locations as it listed.
    if (Array.isArray(data.locationStatus)) {
      registeredKeyRef.current = (data.binLocations || []).map(l => `${l.id}|${l.unc_path}`).sort().join('\n');
    }
    // The company's switch (B5a), where the backend has one. Read beside the
    // list, never instead of it: a refused read leaves the value unknown.
    let remoteViewing = null;
    if (caps.remoteViewingSwitch && typeof a.getRemoteViewingEnabled === 'function') {
      try { remoteViewing = await a.getRemoteViewingEnabled(projectId); } catch { remoteViewing = null; }
    }
    // The project may have been switched during the await: nothing is
    // applied and nothing is handed back for a caller to apply either.
    if (activeProjectIdRef.current !== projectId) return null;
    // A backend that cannot say what this computer can reach (the cloud, in
    // a browser) answers rows without `online`; they are marked "not on this
    // computer" here (B3: the clip still shows, with its details, and can be
    // logged, flagged and assigned — it cannot be played here).
    const binFiles = caps.resolveFiles === false
      ? (data.binFiles || []).map(f => ({ ...f, online: false }))
      : (data.binFiles || []);
    // Live rows AND the orphans (their shot or file is gone): the selectors
    // ignore the orphans; the undo that brings a shot or file back needs them.
    setBundle(prev => ({ ...prev, bins: data.bins || [], binFiles, binRoots: data.binRoots || [], binLocations: data.binLocations || prev.binLocations || [], shotTakes: [...(data.shotTakes || []), ...(data.orphanTakes || [])] }));
    setBinsInfo(i => ({
      ...i, ffmpeg: !!data.ffmpeg, loadedFor: projectId, capabilities: caps, remoteViewing,
      ...(Array.isArray(data.locationStatus) ? { locations: data.locationStatus } : {}),
      // The desktop process did not answer: the rows read "not on this
      // computer" and the tab says why, once.
      ...(data.filesError ? { notice: { text: `This computer's desktop process did not answer, so no clip can be played here right now: ${data.filesError}`, kind: 'warn', at: Date.now() } } : {}),
    }));
    // Once per project per session, from HERE and not from a tab: rows left
    // pending (the app closed mid-add) are probed again and rows the server
    // has no decoder for get the renderer's probe, so a take assigned on the
    // Scenes tab has its poster and length without Bins ever being opened.
    // Not on a backend that cannot read a file's columns: nothing to probe.
    if (caps.probe && browserProbeSweptRef.current !== projectId) {
      browserProbeSweptRef.current = projectId;
      Promise.resolve(browserProbeSweepRef.current?.(binFiles, projectId)).catch(() => {});
    }
    return { ...data, binFiles };
  }, [activeProjectId, binsBackend]);

  // 🚨 Every mutator below captures the project it was called for and drops
  // its response when the project changed during the await — the refreshBins
  // rule (review round 2: the five take mutators had it, the bins mutators
  // did not, and a probe landing after a switch merged project A's row into
  // project B's state).
  const addBin = useCallback(async (bin) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const created = await a.createBin(pid, { id: bin.id || uuidv4(), ...bin });
    if (activeProjectIdRef.current !== pid) return created;
    setBundle(prev => ({ ...prev, bins: mergeRows(prev.bins, [created]) }));
    pushHistory({
      undoOps: [() => mutationsRef.current.deleteBin(created.id, { mode: 'remove' })],
      redoOps: [() => mutationsRef.current.addBin(created)],
    });
    return created;
  }, [binsAdapter, activeProjectId]);

  const updateBin = useCallback(async (id, patch) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const old = bundleRef.current.bins.find(b => b.id === id);
    const oldValues = {};
    if (old) for (const k of Object.keys(patch)) oldValues[k] = old[k];
    const result = await optimistic(
      prev => ({ ...prev, bins: prev.bins.map(b => b.id === id ? { ...b, ...patch } : b) }),
      () => a.updateBin(pid, id, patch),
    );
    if (activeProjectIdRef.current !== pid) return result;
    if (old) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateBin(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateBin(id, patch)],
      });
    }
    return result;
  }, [binsAdapter, optimistic, activeProjectId]);

  const restoreBinFiles = useCallback(async (rows) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const res = await a.restoreBinFiles(pid, rows);
    if (activeProjectIdRef.current !== pid) return res.restored;
    setBundle(prev => ({ ...prev, binFiles: mergeFileRows(prev.binFiles, res.restored) }));
    // The takes of the shots these files serve, as the server presents them
    // now that the files are back.
    applyTakeResponse(res);
    // A row the server could not put back is said, not swallowed (review
    // round 2: an undo that restored nothing reported success). The history
    // loop swallows throws, so this goes through binsInfo.notice, which the
    // Bins tab shows in its notice bar.
    if (res.skipped?.length) {
      const reasons = { bin_gone: 'its bin was deleted', unauthorized: 'its folder is no longer a known root', invalid: 'the row was not restorable' };
      const why = [...new Set(res.skipped.map(s => reasons[s.reason] || s.reason))].join('; ');
      const n = res.skipped.length;
      setBinsInfo(i => ({ ...i, notice: { text: `${n} file${n === 1 ? '' : 's'} could not be put back: ${why}.`, kind: 'warn', at: Date.now() } }));
    }
    return res.restored;
  }, [binsAdapter, activeProjectId]);

  // mode 'move' (with target) re-homes the files of the bin and its children;
  // 'remove' drops the references. Undo re-creates the bins (parents first,
  // same ids) and puts every file back where it was.
  const deleteBin = useCallback(async (id, { mode = 'remove', target = null } = {}) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    // The takes of the clips this bin (and its children) hold, before the
    // call: on the cloud a removed clip's takes go with it (CASCADE), and the
    // undo puts them back through replaceShotTakes after the rows.
    const doomedBins = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const b of bundleRef.current.bins || []) {
        if (b.parent_bin_id && doomedBins.has(b.parent_bin_id) && !doomedBins.has(b.id)) { doomedBins.add(b.id); grew = true; }
      }
    }
    const doomedFiles = new Set((bundleRef.current.binFiles || []).filter(f => doomedBins.has(f.bin_id)).map(f => f.id));
    const takeShotIds = mode === 'move' ? [] : [...new Set((bundleRef.current.shotTakes || []).filter(t => doomedFiles.has(t.bin_file_id)).map(t => t.shot_id))];
    const takesBefore = takeShotIds.length ? snapshotTakes(takeShotIds) : [];
    const res = await a.deleteBin(pid, id, { mode, target });
    if (activeProjectIdRef.current !== pid) return res;
    const removedIds = new Set((res.removedBins || []).map(b => b.id));
    const moved = new Map((res.movedFiles || []).map(m => [m.id, m]));
    setBundle(prev => ({
      ...prev,
      bins: prev.bins.filter(b => !removedIds.has(b.id)),
      binFiles: mode === 'move'
        ? prev.binFiles.map(f => moved.has(f.id) ? { ...f, bin_id: target, sort_order: moved.get(f.id).new_sort_order ?? f.sort_order } : f)
        : prev.binFiles.filter(f => !removedIds.has(f.bin_id)),
    }));
    const removedBins = res.removedBins || [];
    const token = pushHistory({
      undoOps: [async () => {
        // Parents before children so every parent_bin_id resolves.
        const order = [];
        const pending = [...removedBins];
        const have = new Set(bundleRef.current.bins.map(b => b.id));
        while (pending.length) {
          let idx = pending.findIndex(b => !b.parent_bin_id || have.has(b.parent_bin_id));
          // A parent that is gone for good (deleted since): restore at the top
          // level rather than let POST /bins refuse it and lose the bin.
          if (idx < 0) { idx = 0; pending[0] = { ...pending[0], parent_bin_id: null }; }
          const next = pending.splice(idx, 1)[0];
          order.push(next); have.add(next.id);
        }
        for (const b of order) await mutationsRef.current.addBin(b);
        if (mode === 'move') {
          // Back to the bin each came from, at the position it had.
          const byFrom = new Map();
          for (const m of res.movedFiles || []) {
            if (!byFrom.has(m.from)) byFrom.set(m.from, { ids: [], orders: {} });
            const g = byFrom.get(m.from); g.ids.push(m.id); g.orders[m.id] = m.sort_order;
          }
          for (const [from, g] of byFrom) await mutationsRef.current.moveBinFiles(g.ids, from, g.orders);
        } else if ((res.removedFiles || []).length) {
          await mutationsRef.current.restoreBinFiles(res.removedFiles);
          if (takeShotIds.length) await mutationsRef.current.replaceShotTakes(takeShotIds, takesBefore);
        }
      }],
      redoOps: [() => mutationsRef.current.deleteBin(id, { mode, target })],
    });
    const bin = removedBins.find(b => b.id === id);
    if (token != null && bin) {
      const n = mode === 'move' ? (res.movedFiles || []).length : (res.removedFiles || []).length;
      const what = n ? (mode === 'move' ? `, ${n} file${n === 1 ? '' : 's'} moved` : `, ${n} file${n === 1 ? '' : 's'} removed`) : '';
      showUndoToast(`Deleted bin "${bin.name}"${what}`, () => undoHistoryEntry(token));
    }
    return res;
  }, [binsAdapter, activeProjectId, showUndoToast, undoHistoryEntry]);

  const reorderBins = useCallback(async (order) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const before = bundleRef.current.bins.map(b => ({ id: b.id, parent_bin_id: b.parent_bin_id || null, sort_order: b.sort_order }));
    const byId = new Map(order.map(o => [o.id, o]));
    const result = await optimistic(
      prev => ({ ...prev, bins: prev.bins.map(b => byId.has(b.id) ? { ...b, parent_bin_id: byId.get(b.id).parent_bin_id || null, sort_order: byId.get(b.id).sort_order } : b) }),
      () => a.reorderBins(pid, order),
    );
    if (activeProjectIdRef.current !== pid) return result;
    pushHistory({
      undoOps: [() => mutationsRef.current.reorderBins(before.filter(b => byId.has(b.id)))],
      redoOps: [() => mutationsRef.current.reorderBins(order)],
    });
    return result;
  }, [binsAdapter, optimistic, activeProjectId]);

  const pickBinFiles = useCallback(() => binsAdapter().pickBinFiles(activeProjectId), [binsAdapter, activeProjectId]);
  const pickBinFolder = useCallback((title) => binsAdapter().pickBinFolder(activeProjectId, title), [binsAdapter, activeProjectId]);
  const prepareBinFiles = useCallback((paths, opts) => binsAdapter().prepareBinFiles(activeProjectId, paths, opts), [binsAdapter, activeProjectId]);

  const probeBinFile = useCallback(async (id) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const row = await a.probeBinFile(pid, id);
    // The project may have been switched during the await (the refreshBins
    // rule): project B must not receive project A's row.
    if (activeProjectIdRef.current !== pid) return row;
    setBundle(prev => ({ ...prev, binFiles: mergeFileRows(prev.binFiles, [row]) }));
    // No decoder on this machine: the renderer's own probe, right where the
    // verdict lands (after an add, a re-probe, "Read columns again").
    if (needsBrowserProbe(row)) {
      const done = await browserProbeRef.current?.(row);
      if (done) return done;
    }
    return row;
  }, [binsAdapter, activeProjectId]);

  // Probes run two at a time in the background; an offline or failing row is
  // marked and skipped, never retried in a loop. `binsInfo.probing` is what
  // the view shows while it runs.
  const probeBinFiles = useCallback(async (ids) => {
    const queue = [...(ids || [])];
    if (!queue.length) return;
    // A backend that cannot read a file's columns (the cloud): nothing to
    // probe, and a row must not be marked failed for it.
    if (!binsCapabilitiesOf(binsBackend()).probe) return;
    setBinsInfo(i => ({ ...i, probing: i.probing + queue.length }));
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        try { await probeBinFile(id); }
        catch (err) {
          // Offline (410 / code offline) is not a failure: the row stays
          // pending for the next pass, once the drive is back. Branch on the
          // error's code and status (review round 2: the sentence the
          // adapter threw never contained "offline" or "410").
          const offline = err?.code === 'offline' || err?.status === 410;
          setBundle(prev => ({ ...prev, binFiles: prev.binFiles.map(f => f.id === id ? { ...f, probe_status: offline ? 'pending' : 'failed' } : f) }));
        }
        finally { setBinsInfo(i => ({ ...i, probing: Math.max(0, i.probing - 1) })); }
      }
    };
    await Promise.all([worker(), worker()]);
  }, [probeBinFile]);

  // 🚨 NEVER a file delete on any backend (B10, pinned by binsProvider.test):
  // this removes ROWS. On the cloud the takes of a removed clip go with it
  // (0091's CASCADE), so the takes of the shots those clips serve are
  // snapshotted FIRST and put back by the undo through replaceShotTakes —
  // exact whatever the backend did (the Local Server keeps them as orphans
  // and the replace is then a no-op).
  const removeBinFiles = useCallback(async (ids, { quiet = false } = {}) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const set = new Set(ids);
    const takeShotIds = [...new Set((bundleRef.current.shotTakes || []).filter(t => set.has(t.bin_file_id)).map(t => t.shot_id))];
    const takesBefore = takeShotIds.length ? snapshotTakes(takeShotIds) : [];
    const res = await optimistic(
      prev => ({ ...prev, binFiles: prev.binFiles.filter(f => !set.has(f.id)) }),
      () => a.removeBinFiles(pid, ids),
    );
    if (activeProjectIdRef.current !== pid) return res.removed || [];
    const removed = res.removed || [];
    if (removed.length) {
      const token = pushHistory({
        undoOps: [async () => {
          await mutationsRef.current.restoreBinFiles(removed);
          if (takeShotIds.length) await mutationsRef.current.replaceShotTakes(takeShotIds, takesBefore);
        }],
        redoOps: [() => mutationsRef.current.removeBinFiles(removed.map(r => r.id), { quiet: true })],
      });
      if (token != null && !quiet) {
        showUndoToast(removed.length === 1
          ? `Removed "${removed[0].display_name || removed[0].original_name}" from the bin`
          : `Removed ${removed.length} files from the bin`, () => undoHistoryEntry(token));
      }
    }
    return removed;
  }, [binsAdapter, optimistic, activeProjectId, showUndoToast, undoHistoryEntry]);

  // roots (optional): the folders the batch was picked or dropped from, as
  // prepare reported them; the server records those as the known roots.
  // BC2: `opts.onProgress({ done, total })` while the desktop signed in reads
  // each clip's columns before the add (the composite); other backends
  // ignore it.
  const addBinFiles = useCallback(async (binId, items, createSubBins = true, roots = null, opts = {}) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const res = await a.addBinFiles(pid, binId, items, createSubBins, roots, opts);
    if (activeProjectIdRef.current !== pid) return res;
    const created = res.created || [];
    const bins = res.bins || [];
    setBundle(prev => ({ ...prev, bins: mergeRows(prev.bins, bins), binFiles: mergeFileRows(prev.binFiles, created) }));
    if (created.length) {
      pushHistory({
        undoOps: [async () => {
          await mutationsRef.current.removeBinFiles(created.map(r => r.id), { quiet: true });
          for (const b of [...bins].reverse()) await mutationsRef.current.deleteBin(b.id, { mode: 'remove' });
        }],
        redoOps: [async () => {
          for (const b of bins) await mutationsRef.current.addBin(b);
          await mutationsRef.current.restoreBinFiles(created);
        }],
      });
      // Not awaited: the rows are saved; the columns fill in as they arrive
      // (probeBinFiles stands down on a backend that cannot read a file).
      // Review round 1, finding 5: on the desktop signed in the composite
      // already read each clip BEFORE the add (its columns are in the row);
      // only a clip still pending is read again — not a second network probe
      // and a second write fanned out to every teammate per clip, whose late
      // answer could also overwrite the poster the upload just stored.
      const desktopCloudAdd = binsCapabilitiesOf(a).backend === 'desktop_cloud';
      probeBinFiles(created.filter(r => r.online !== false && (!desktopCloudAdd || r.probe_status === 'pending')).map(r => r.id)).catch(() => {});
      // BC2: on the desktop signed in, the new clips' pictures go to the
      // cloud only if the company allows it — asked first, quietly when not.
      if (binsCapabilitiesOf(a).backend === 'desktop_cloud') {
        Promise.resolve(uploadPostersRef.current?.(null, { quiet: true, rows: created })).catch(() => {});
      }
    }
    return res;
  }, [binsAdapter, activeProjectId, probeBinFiles]);

  // B8: "a clip already in the project (same location, same file)". Answers,
  // for each item a computer is about to add ({ location_id, relative_path }),
  // the row this project already holds for that file — compared as Windows
  // shares compare, case-insensitively — or null. The Add dialog then offers
  // Skip or Add anyway (an instance). Pure over the loaded rows; the Local
  // Server answers the same question from paths inside `prepare`.
  const findDuplicateBinFiles = useCallback((items) => {
    const rows = bundleRef.current.binFiles || [];
    const bins = bundleRef.current.bins || [];
    const key = (loc, rel) => `${loc || ''}|${String(rel || '').replace(/\\/g, '/').toLowerCase()}`;
    const byKey = new Map();
    for (const r of rows) {
      if (!r.location_id || !r.relative_path) continue;
      const k = key(r.location_id, r.relative_path);
      if (!byKey.has(k)) byKey.set(k, r);
    }
    return (items || []).map((it) => {
      const hit = it ? byKey.get(key(it.location_id, it.relative_path)) : null;
      if (!hit) return null;
      return {
        reason: 'same_path',
        existing_id: hit.id,
        existing_bin_id: hit.bin_id,
        existing_bin_name: bins.find(b => b.id === hit.bin_id)?.name || null,
      };
    });
  }, []);

  const updateBinFile = useCallback(async (id, patch) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const old = bundleRef.current.binFiles.find(f => f.id === id);
    const oldValues = {};
    if (old) for (const k of Object.keys(patch)) oldValues[k] = old[k];
    const result = await optimistic(
      prev => ({ ...prev, binFiles: prev.binFiles.map(f => f.id === id ? { ...f, ...patch } : f) }),
      () => a.updateBinFile(pid, id, patch),
    );
    if (activeProjectIdRef.current !== pid) return result;
    if (result) setBundle(prev => ({ ...prev, binFiles: mergeFileRows(prev.binFiles, [result]) }));
    if (old) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateBinFile(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateBinFile(id, patch)],
      });
    }
    return result;
  }, [binsAdapter, optimistic, activeProjectId]);

  const bulkUpdateBinFiles = useCallback(async (ids, patch) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const set = new Set(ids);
    const olds = bundleRef.current.binFiles.filter(f => set.has(f.id)).map(f => {
      const o = { id: f.id }; for (const k of Object.keys(patch)) o[k] = f[k]; return o;
    });
    const res = await optimistic(
      prev => ({ ...prev, binFiles: prev.binFiles.map(f => set.has(f.id) ? { ...f, ...patch } : f) }),
      () => a.bulkUpdateBinFiles(pid, ids, patch),
    );
    if (activeProjectIdRef.current !== pid) return res;
    if (res?.updated) setBundle(prev => ({ ...prev, binFiles: mergeFileRows(prev.binFiles, res.updated) }));
    if (olds.length) {
      pushHistory({
        undoOps: [async () => {
          // Grouped by identical old values: undoing a colour on 500 files
          // is a handful of bulk requests, not 500 sequential PATCHes.
          const groups = new Map();
          for (const o of olds) {
            const { id, ...values } = o;
            const k = JSON.stringify(values);
            if (!groups.has(k)) groups.set(k, { ids: [], values });
            groups.get(k).ids.push(id);
          }
          for (const g of groups.values()) await mutationsRef.current.bulkUpdateBinFiles(g.ids, g.values);
        }],
        redoOps: [() => mutationsRef.current.bulkUpdateBinFiles(ids, patch)],
      });
    }
    return res;
  }, [binsAdapter, optimistic, activeProjectId]);

  // sortOrders ({ id: n }, optional) is what an undo passes so rows land back
  // at the positions they had; a plain move appends to the target bin.
  const moveBinFiles = useCallback(async (ids, binId, sortOrders = null) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const set = new Set(ids);
    const before = bundleRef.current.binFiles.filter(f => set.has(f.id)).map(f => ({ id: f.id, from: f.bin_id, sort_order: f.sort_order }));
    const res = await optimistic(
      prev => ({ ...prev, binFiles: prev.binFiles.map(f => set.has(f.id) ? { ...f, bin_id: binId, ...(sortOrders && Number.isFinite(Number(sortOrders[f.id])) ? { sort_order: Number(sortOrders[f.id]) } : {}) } : f) }),
      () => a.moveBinFiles(pid, ids, binId, sortOrders),
    );
    if (activeProjectIdRef.current !== pid) return res;
    if (res?.binFiles) setBundle(prev => ({ ...prev, binFiles: mergeFileRows(prev.binFiles, res.binFiles) }));
    if (before.length) {
      pushHistory({
        undoOps: [async () => {
          const byFrom = new Map();
          for (const m of before) {
            if (!byFrom.has(m.from)) byFrom.set(m.from, { ids: [], orders: {} });
            const g = byFrom.get(m.from); g.ids.push(m.id); g.orders[m.id] = m.sort_order;
          }
          for (const [from, g] of byFrom) await mutationsRef.current.moveBinFiles(g.ids, from, g.orders);
        }],
        redoOps: [() => mutationsRef.current.moveBinFiles(ids, binId, sortOrders)],
      });
    }
    return res;
  }, [binsAdapter, optimistic, activeProjectId]);

  const copyBinFiles = useCallback(async (ids, binId) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const res = await a.copyBinFiles(pid, ids, binId);
    if (activeProjectIdRef.current !== pid) return res.created || [];
    const created = res.created || [];
    setBundle(prev => ({ ...prev, binFiles: mergeFileRows(prev.binFiles, created) }));
    if (created.length) {
      pushHistory({
        undoOps: [() => mutationsRef.current.removeBinFiles(created.map(r => r.id), { quiet: true })],
        redoOps: [() => mutationsRef.current.restoreBinFiles(created)],
      });
    }
    return created;
  }, [binsAdapter, activeProjectId]);

  // (There is no reorderBinFiles: the sort menu's "Added order" is the order
  // rows were added in, and nothing offered a hand order — review round 2
  // removed the route, the method and the mutator nothing called.)

  const binRelinkScan = useCallback((folderPath = null) => binsAdapter().binRelinkScan(activeProjectId, folderPath), [binsAdapter, activeProjectId]);

  // A repair, not an edit: no history entry. The rows come back online and
  // their posters are re-requested by the view through the rev counter — and
  // read again in the background (rowsToReprobeAfterRelink): the poster cache
  // is keyed by path + mtime, so under the new path there is none until a
  // probe draws it, which without a decoder on the server only the renderer's
  // probe does. Both relink paths (the dialog's Apply and the auto-relink on
  // open) land here. Never awaited: the header says "reading N" meanwhile.
  const binRelinkApply = useCallback(async (mappings) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const res = await a.binRelinkApply(pid, mappings);
    if (activeProjectIdRef.current !== pid) return res;
    if (res?.updated?.length) setBundle(prev => ({ ...prev, binFiles: mergeFileRows(prev.binFiles, res.updated) }));
    const reprobe = rowsToReprobeAfterRelink(res?.updated);
    if (reprobe.length) probeBinFiles(reprobe).catch(() => {});
    return res;
  }, [binsAdapter, activeProjectId, probeBinFiles]);

  // Roots are recorded by the pick and add routes; this forgets one (the
  // relink dialog's "forget this folder").
  const removeBinRoot = useCallback(async (id) => {
    const pid = activeProjectId;
    const res = await binsAdapter().removeBinRoot(pid, id);
    if (activeProjectIdRef.current !== pid) return res;
    setBundle(prev => ({ ...prev, binRoots: res.binRoots || prev.binRoots }));
    return res;
  }, [binsAdapter, activeProjectId]);

  // ── Footage locations (BC1, 0091; Audrey's B2) ──
  // A company's named shares, by network address. They are the WORKSPACE's,
  // not the project's, so they are kept beside the bundle (reset with it,
  // re-read with the bins) and every project of the company sees the same
  // list. A location in use cannot be removed (the database refuses with its
  // sentence; the undo of a removal is an add with the same row).
  const refreshBinLocations = useCallback(async () => {
    const a = binsBackend();
    if (!a || typeof a.listBinLocations !== 'function') return [];
    const rows = await a.listBinLocations();
    setBundle(prev => ({ ...prev, binLocations: rows || [] }));
    return rows || [];
  }, [binsBackend]);
  refreshBinLocationsRef.current = refreshBinLocations;

  // BC2: the four location verbs and the switch run with or without an open
  // project (locationsAdapter): Settings, Storage manages the company's list.
  const addBinLocation = useCallback(async (location) => {
    const a = locationsAdapter();
    if (typeof a.createBinLocation !== 'function') throw new Error('Footage locations are not available on this backend');
    const created = await a.createBinLocation(location);
    setBundle(prev => ({ ...prev, binLocations: mergeRows(prev.binLocations, [created]) }));
    // BC2: this computer learns the new address at once — the add flow's
    // "Which location is this? Name it." reads the batch again right after.
    if (desktopBinFilesRef.current) {
      await registerBinLocationsNow([...(bundleRef.current.binLocations || []).filter(l => l.id !== created.id), created]).catch(() => {});
    }
    pushHistory({
      undoOps: [() => mutationsRef.current.removeBinLocation(created.id)],
      redoOps: [() => mutationsRef.current.addBinLocation(created)],
    });
    return created;
  }, [locationsAdapter, registerBinLocationsNow]);

  const updateBinLocation = useCallback(async (id, patch) => {
    const a = locationsAdapter();
    if (typeof a.updateBinLocation !== 'function') throw new Error('Footage locations are not available on this backend');
    const old = (bundleRef.current.binLocations || []).find(l => l.id === id);
    const oldValues = {};
    if (old) for (const k of Object.keys(patch || {})) oldValues[k] = old[k];
    const result = await optimistic(
      prev => ({ ...prev, binLocations: (prev.binLocations || []).map(l => l.id === id ? { ...l, ...patch } : l) }),
      () => a.updateBinLocation(id, patch),
    );
    if (result) setBundle(prev => ({ ...prev, binLocations: mergeRows(prev.binLocations, [result]) }));
    // BC2: a re-address reaches this computer at once (and every clip of the
    // location is resolved at the new share).
    if (desktopBinFilesRef.current && result) {
      await registerBinLocationsNow((bundleRef.current.binLocations || []).map(l => (l.id === id ? { ...l, ...result } : l))).catch(() => {});
      scheduleBinResolveRef.current?.();
    }
    if (old) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateBinLocation(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateBinLocation(id, patch)],
      });
    }
    return result;
  }, [locationsAdapter, optimistic, registerBinLocationsNow]);

  const removeBinLocation = useCallback(async (id) => {
    const a = locationsAdapter();
    if (typeof a.removeBinLocation !== 'function') throw new Error('Footage locations are not available on this backend');
    const old = (bundleRef.current.binLocations || []).find(l => l.id === id);
    // Server-first, no optimistic removal: a location in use is REFUSED by
    // the database (RESTRICT), and a row that vanished then came back would
    // read as "removed, then not".
    const removed = await a.removeBinLocation(id);
    setBundle(prev => ({ ...prev, binLocations: (prev.binLocations || []).filter(l => l.id !== id) }));
    const row = removed || old;
    if (row) {
      const token = pushHistory({
        undoOps: [() => mutationsRef.current.addBinLocation(row)],
        redoOps: [() => mutationsRef.current.removeBinLocation(row.id)],
      });
      // BC2: Settings has no Ctrl+Z of its own; the app's undo toast does it.
      if (token != null) showUndoToast(`Removed the footage location "${row.name || row.unc_path}"`, () => undoHistoryEntry(token));
    }
    return row;
  }, [locationsAdapter, showUndoToast, undoHistoryEntry]);

  // The company's switch (B5a): "Allow files to be viewed from outside the
  // office network." A workspace admin's verb; anyone else reads the
  // database's sentence. Undoable, like every other change a person makes.
  // BC2: `workspaceId` for a caller with no open project (Settings); the
  // undo and redo carry the same company, whatever project is open later.
  const setRemoteViewingEnabled = useCallback(async (enabled, { workspaceId: ws = null } = {}) => {
    const a = locationsAdapter();
    if (typeof a.setRemoteViewingEnabled !== 'function') throw new Error('The remote-viewing switch is not available on this backend');
    const workspaceId = ws || bundleRef.current.project?.workspace_id || null;
    const before = binsInfo.remoteViewing;
    const now = await a.setRemoteViewingEnabled(workspaceId, enabled === true);
    setBinsInfo(i => ({ ...i, remoteViewing: now }));
    if (before !== null && before !== now) {
      const token = pushHistory({
        undoOps: [() => mutationsRef.current.setRemoteViewingEnabled(before, { workspaceId })],
        redoOps: [() => mutationsRef.current.setRemoteViewingEnabled(now, { workspaceId })],
      });
      if (token != null) {
        // Short enough for the undo toast's one line (480 px, truncated).
        showUndoToast(now
          ? 'Viewing from outside the office turned on'
          : 'Viewing from outside the office turned off', () => undoHistoryEntry(token));
      }
    }
    return now;
  }, [locationsAdapter, binsInfo.remoteViewing, showUndoToast, undoHistoryEntry]);

  // BC2: the switch read where no project is open (Settings), for the
  // company the person is signed in to. Where a project is open it is the
  // project's own read (refreshBins), which says the same thing.
  const refreshRemoteViewing = useCallback(async ({ workspaceId = null } = {}) => {
    const a = binsBackend();
    if (!a) return null;
    let v = null;
    try {
      if (activeProjectId && typeof a.getRemoteViewingEnabled === 'function') v = await a.getRemoteViewingEnabled(activeProjectId);
      else if (workspaceId && typeof a.getWorkspaceRemoteViewing === 'function') v = await a.getWorkspaceRemoteViewing(workspaceId);
    } catch { v = null; }
    if (v !== null) setBinsInfo(i => ({ ...i, remoteViewing: v === true }));
    return v;
  }, [binsBackend, activeProjectId]);

  // BC2, B2's fallback: "Where is this location on this computer?" — the
  // desktop's own folder dialog for that location; the answer stays in this
  // computer's settings. Then the list is registered again and every clip
  // resolved. Not an edit of the company's data, so no history entry: the
  // way back is forgetBinLocationLocalPath.
  const pickBinLocationLocalPath = useCallback(async (id) => {
    const a = locationsAdapter();
    if (typeof a.pickBinLocationLocalPath !== 'function') throw new Error('Choosing where a location is on this computer needs the desktop app.');
    const loc = (bundleRef.current.binLocations || []).find(l => l.id === id);
    if (!loc) throw new Error('That footage location is not in the company\'s list.');
    // The desktop only answers for a REGISTERED location: register first.
    await registerBinLocationsNow();
    const res = await a.pickBinLocationLocalPath(loc);
    if (res?.canceled) return res;
    await registerBinLocationsNow();
    await resolveBinOnline(null);
    return res;
  }, [locationsAdapter, registerBinLocationsNow, resolveBinOnline]);

  // BC2 review round 1: consent before contact. A company location's
  // address is contacted from this computer only once its person agrees —
  // the desktop's own native confirmation names the address (Cancel is the
  // default). Then the list is registered again and every clip resolved.
  // Like the folder above, this computer's answer, not company data: no
  // history entry.
  const connectBinLocation = useCallback(async (id) => {
    const a = locationsAdapter();
    if (typeof a.connectBinLocation !== 'function') throw new Error('Connecting to a footage location needs the desktop app.');
    const loc = (bundleRef.current.binLocations || []).find(l => l.id === id);
    if (!loc) throw new Error('That footage location is not in the company\'s list.');
    await registerBinLocationsNow();
    const res = await a.connectBinLocation(loc);
    if (res?.canceled) return res;
    await registerBinLocationsNow();
    await resolveBinOnline(null);
    return res;
  }, [locationsAdapter, registerBinLocationsNow, resolveBinOnline]);

  const forgetBinLocationLocalPath = useCallback(async (id) => {
    const a = locationsAdapter();
    if (typeof a.forgetBinLocationLocalPath !== 'function') throw new Error('This computer keeps no folder for footage locations outside the desktop app.');
    const res = await a.forgetBinLocationLocalPath(id);
    await registerBinLocationsNow();
    await resolveBinOnline(null);
    return res;
  }, [locationsAdapter, registerBinLocationsNow, resolveBinOnline]);

  // A clip's picture where the backend signs it per read (the cloud:
  // rabbit-thumbnails is private). null where the backend has a sync route
  // instead (binFileThumbnailUrl), or the row has no picture.
  const binFilePosterUrl = useCallback(async (row, opts) => {
    const a = binsBackend();
    if (!a || typeof a.binFilePosterUrl !== 'function' || !activeProjectId) return null;
    return a.binFilePosterUrl(activeProjectId, row, opts);
  }, [activeProjectId, binsBackend]);

  const postBinFileThumbnail = useCallback((id, base64) => binsAdapter().postBinFileThumbnail(activeProjectId, id, base64), [binsAdapter, activeProjectId]);

  // ── BC2: a clip's picture to the cloud — ONLY while the company allows it ──
  // Audrey (B4): "if the user allows external access pictures are fine.
  // never take images when external access is denied." On the desktop
  // signed in a poster is made and kept on THIS computer for every clip it
  // can reach; this uploads the ones the cloud has no picture for yet. The
  // switch is asked FIRST, once per call: off, and not a byte moves (the
  // database refuses regardless — 0091's RESTRICTIVE policy). A refusal
  // that slips past the pre-check (the admin turned it off meanwhile) stops
  // the batch and is said ONCE, not per clip. `ids` null: every clip this
  // computer reaches without a picture (the catch-up). `quiet`: the
  // automatic pass after an add says nothing when the switch is off.
  // Already-uploaded pictures are never touched here: turning the switch off
  // deletes nothing (BINS_CLOUD_PLAN §1).
  const uploadBinFilePosters = useCallback(async (ids = null, { quiet = false, rows: given = null } = {}) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const none = { uploaded: 0, failed: 0, refused: false };
    if (typeof a.uploadBinFilePoster !== 'function') return none;
    let on = false;
    try { on = (await a.getRemoteViewingEnabled(pid)) === true; } catch { on = false; }
    if (activeProjectIdRef.current !== pid) return none;
    setBinsInfo(i => ({ ...i, remoteViewing: on }));
    if (!on) {
      if (!quiet) setBinsInfo(i => ({ ...i, notice: { text: BIN_POSTERS_OFF_SENTENCE, kind: 'warn', at: Date.now() } }));
      return { ...none, refused: true };
    }
    const want = ids ? new Set(ids) : null;
    // `given`: rows a mutator just created (state lands a render later).
    const rows = (given || bundleRef.current.binFiles || []).filter(f => (!want || want.has(f.id)) && needsCloudPoster(f));
    // `failedIds` (review round 1): the clips whose picture could not be
    // made on this computer, so the catch-up stops counting them.
    let uploaded = 0; let failed = 0; const failedIds = [];
    for (const r of rows) {
      if (activeProjectIdRef.current !== pid) break;
      try {
        const res = await a.uploadBinFilePoster(pid, r.id, r);
        uploaded++;
        if (res?.poster_path) setBundle(prev => ({ ...prev, binFiles: (prev.binFiles || []).map(f => (f.id === r.id ? { ...f, poster_path: res.poster_path } : f)) }));
      } catch (e) {
        if (e?.code === 'remote_viewing_off') {
          setBinsInfo(i => ({ ...i, remoteViewing: false, notice: { text: BIN_POSTERS_OFF_SENTENCE, kind: 'warn', at: Date.now() } }));
          return { uploaded, failed, failedIds, refused: true };
        }
        failed++;
        failedIds.push(r.id);
      }
    }
    return { uploaded, failed, failedIds, refused: false };
  }, [binsAdapter, activeProjectId]);
  uploadPostersRef.current = uploadBinFilePosters;
  const openBinFile = useCallback((id, reveal = false) => binsAdapter().openBinFile(activeProjectId, id, reveal), [binsAdapter, activeProjectId]);
  // What the renderer's own probe read (bins/binProbeFallback.js) — a machine
  // write, so no history entry, unlike updateBinFile.
  const applyBinFileProbe = useCallback(async (id, patch) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const row = await a.updateBinFile(pid, id, { ...patch, probe_status: patch.probe_status || 'done' });
    if (activeProjectIdRef.current !== pid) return row;
    setBundle(prev => ({ ...prev, binFiles: mergeFileRows(prev.binFiles, [row]) }));
    return row;
  }, [binsAdapter, activeProjectId]);
  // BC2: through binsBackend() — on the desktop signed in, the poster cache
  // and the bytes of a clip by its location + path.
  const binFileThumbnailUrl = useCallback((id, rev = 0) => {
    const a = binsBackend();
    return (a && typeof a.binFileThumbnailUrl === 'function' && activeProjectId) ? a.binFileThumbnailUrl(activeProjectId, id, rev) : null;
  }, [activeProjectId, binsBackend]);
  const binFileStreamUrl = useCallback((id, opts) => {
    const a = binsBackend();
    return (a && typeof a.binFileStreamUrl === 'function' && activeProjectId) ? a.binFileStreamUrl(activeProjectId, id, opts) : null;
  }, [activeProjectId, binsBackend]);

  // ── The renderer's own probe (no ffmpeg on this machine) ──
  // Chromium decodes H.264 MP4 / WebM, the common audio formats and images: a
  // row the server marked `unavailable` gets its columns from a hidden
  // <video> / <audio> / <img> and, for video, the frame it drew as its poster
  // (bins/binProbeFallback.js; needsBrowserProbe in bins/binMedia.js decides).
  // 🚨 It runs HERE, where the server's verdict lands — after an add, after a
  // re-probe of a pending row, and once per project after the list loads —
  // not from a tab's mount. Review round 2, MEASURED: the Bins tab ran it only
  // from its post-load step over the rows AS LOADED, so rows still pending at
  // load kept their icons for the whole session, an MP4 added on the tab got
  // its poster only on the next visit, and a take assigned from Scenes had no
  // poster until Bins had been opened. A machine write, so no history entry.
  const browserProbe = useCallback(async (row) => {
    if (!needsBrowserProbe(row)) return null;
    // No bytes to decode on a backend that cannot stream them (the cloud).
    if (!binsCapabilitiesOf(binsBackend()).stream) return null;
    const pid = activeProjectId;
    const src = binFileStreamUrl(row.id, { probe: true });
    if (!src) return null;
    try {
      const r = await probeInBrowser(previewKindFor(row), src);
      if (activeProjectIdRef.current !== pid) return null;
      const patch = {};
      if (r.duration_sec) patch.duration_sec = r.duration_sec;
      if (r.width) patch.width = r.width;
      if (r.height) patch.height = r.height;
      const done = await applyBinFileProbe(row.id, patch);
      if (r.jpegBase64) {
        await postBinFileThumbnail(row.id, r.jpegBase64);
        setBinsInfo(i => ({ ...i, posterRev: i.posterRev + 1 }));
        // BC2: on the desktop signed in that poster went to THIS computer's
        // cache; it goes to the cloud only if the company allows it.
        if (binsCapabilitiesOf(binsBackend()).backend === 'desktop_cloud') {
          Promise.resolve(uploadPostersRef.current?.([row.id], { quiet: true, rows: [{ ...row, ...done, online: true }] })).catch(() => {});
        }
      }
      return done;
    } catch {
      if (activeProjectIdRef.current !== pid) return null;
      return applyBinFileProbe(row.id, { probe_status: 'failed' }).catch(() => null);
    }
  }, [activeProjectId, binFileStreamUrl, applyBinFileProbe, postBinFileThumbnail]);
  browserProbeRef.current = browserProbe;

  // The once-per-project pass refreshBins starts: pending rows go to the
  // server (an `unavailable` answer comes back through probeBinFile, which
  // runs browserProbe itself), then the rows already marked unavailable,
  // sequentially and bounded, each counted in `probing` so the Bins header
  // says "reading N" while it runs. Stops when the project changes.
  const browserProbeSweep = useCallback(async (rows, projectId) => {
    const pending = (rows || []).filter(f => f.probe_status === 'pending' && f.online !== false).map(f => f.id);
    if (pending.length) probeBinFiles(pending).catch(() => {});
    const queue = (rows || []).filter(needsBrowserProbe).slice(0, 40);
    if (!queue.length) return;
    let left = queue.length;
    setBinsInfo(i => ({ ...i, probing: i.probing + left }));
    try {
      for (const row of queue) {
        if (activeProjectIdRef.current !== projectId) break;
        try { await browserProbe(row); }
        finally { left--; setBinsInfo(i => ({ ...i, probing: Math.max(0, i.probing - 1) })); }
      }
    } finally {
      if (left > 0) setBinsInfo(i => ({ ...i, probing: Math.max(0, i.probing - left) }));
    }
  }, [probeBinFiles, browserProbe]);
  browserProbeSweepRef.current = browserProbeSweep;

  // ── Shot takes (milestone 2, docs/BINS_DESIGN.md §4.4 and §6 Q6) ──
  //
  // Bin files assigned to shots, many-to-many, ordered, with a role. Every
  // server mutation answers the FULL row set of the shots it touched
  // (siblings get re-roled and renumbered), and the provider replaces those
  // shots' rows with it. Undo is a SNAPSHOT: the rows of the affected shots
  // before the call, handed back verbatim through replaceShotTakes — exact
  // whatever the mutation did, and one primitive instead of four inverses.
  // Orphans (a take whose shot or file is gone) stay in state on purpose:
  // undoing the delete brings the take back; the selectors skip them.
  const replaceTakeRows = (rows, shotIds, incoming) => {
    const set = new Set(shotIds || []);
    return [...(rows || []).filter(t => !set.has(t.shot_id)), ...(incoming || [])];
  };
  const snapshotTakes = (shotIds) => {
    const set = new Set(shotIds || []);
    return (bundleRef.current.shotTakes || []).filter(t => set.has(t.shot_id)).map(t => ({ ...t }));
  };
  // The affected shots' rows become what the server sent: the live rows,
  // presented, AND the orphans of those shots verbatim (review round 2,
  // HIGH: replacing them with live rows only threw away the orphan the undo
  // of a file removal needed).
  const applyTakeResponse = (res) => {
    if (!res?.affectedShotIds?.length) return;
    setBundle(prev => ({ ...prev, shotTakes: replaceTakeRows(prev.shotTakes, res.affectedShotIds, [...(res.shotTakes || []), ...(res.orphanTakes || [])]) }));
  };
  // The fields an undo entry exists for: the same rows with the same role,
  // position and notes is a no-op, and a no-op must not burn a Ctrl+Z
  // (review round 2: demoting a shot's only take burned one).
  const sameTakeRows = (before, after) => {
    const key = (rows) => JSON.stringify((rows || []).map(t => [t.id, t.role, t.position, t.notes || '']).sort((x, y) => String(x[0]).localeCompare(String(y[0]))));
    return key(before) === key(after);
  };

  // Every mutator below captures the project it was called for and drops its
  // response if the project changed during the await (the refreshBins rule):
  // project B must not gain project A's rows.
  const replaceShotTakes = useCallback(async (shotIds, rows) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const res = await a.replaceShotTakes(pid, shotIds, rows);
    if (activeProjectIdRef.current !== pid) return res;
    applyTakeResponse(res);
    return res;
  }, [binsAdapter, activeProjectId]);

  const pushTakeHistory = (shotIds, before, after) => pushHistory({
    undoOps: [() => mutationsRef.current.replaceShotTakes(shotIds, before)],
    redoOps: [() => mutationsRef.current.replaceShotTakes(shotIds, after)],
  });

  // assignments: [{ shot_id, bin_file_id, role?, notes? }]
  const assignShotTakes = useCallback(async (assignments) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const list = (assignments || []).filter(x => x && x.shot_id && x.bin_file_id);
    if (!list.length) return { created: [], skipped: [], affectedShotIds: [], shotTakes: [] };
    const shotIds = [...new Set(list.map(x => x.shot_id))];
    const before = snapshotTakes(shotIds);
    const res = await a.assignShotTakes(pid, list);
    if (activeProjectIdRef.current !== pid) return res;
    applyTakeResponse(res);
    if (res?.created?.length) pushTakeHistory(shotIds, before, res.shotTakes || []);
    return res;
  }, [binsAdapter, activeProjectId]);

  // patch: { role?, notes?, position? }
  const updateShotTake = useCallback(async (id, patch) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const row = (bundleRef.current.shotTakes || []).find(t => t.id === id);
    const before = row ? snapshotTakes([row.shot_id]) : null;
    const res = await a.updateShotTake(pid, id, patch);
    if (activeProjectIdRef.current !== pid) return res;
    applyTakeResponse(res);
    // No row in state means no honest snapshot; an entry whose `before` is
    // empty would undo an edit by wiping the shot (adversarial review). Apply
    // the response and push nothing. Nothing either when the server changed
    // nothing (a sole take asked to be an alt stays primary).
    const after = [...(res?.shotTakes || []), ...(res?.orphanTakes || [])];
    if (row && res?.affectedShotIds?.length && !sameTakeRows(before, after)) pushTakeHistory(res.affectedShotIds, before, after);
    return res;
  }, [binsAdapter, activeProjectId]);

  const removeShotTakes = useCallback(async (ids) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const set = new Set(ids || []);
    const rows = (bundleRef.current.shotTakes || []).filter(t => set.has(t.id));
    if (!rows.length) return { removed: [], affectedShotIds: [], shotTakes: [] };
    const shotIds = [...new Set(rows.map(t => t.shot_id))];
    const before = snapshotTakes(shotIds);
    const res = await optimistic(
      prev => ({ ...prev, shotTakes: (prev.shotTakes || []).filter(t => !set.has(t.id)) }),
      () => a.removeShotTakes(pid, [...set]),
    );
    if (activeProjectIdRef.current !== pid) return res;
    applyTakeResponse(res);
    const removed = res?.removed || [];
    if (removed.length) {
      const token = pushTakeHistory(res.affectedShotIds || shotIds, before, res.shotTakes || []);
      if (token != null) {
        const shot = bundleRef.current.shots.find(s => s.id === shotIds[0]);
        const where = shotIds.length === 1 && shot ? ` from "${shot.name || 'Untitled shot'}"` : '';
        showUndoToast(removed.length === 1 ? `Unassigned 1 take${where}` : `Unassigned ${removed.length} takes${where}`, () => undoHistoryEntry(token));
      }
    }
    return res;
  }, [binsAdapter, optimistic, activeProjectId, showUndoToast, undoHistoryEntry]);

  const reorderShotTakes = useCallback(async (shotId, ids) => {
    const a = binsAdapter();
    const pid = activeProjectId;
    const before = snapshotTakes([shotId]);
    const pos = new Map((ids || []).map((id, i) => [id, i]));
    const res = await optimistic(
      prev => ({ ...prev, shotTakes: (prev.shotTakes || []).map(t => pos.has(t.id) ? { ...t, position: pos.get(t.id) } : t) }),
      () => a.reorderShotTakes(pid, shotId, ids),
    );
    if (activeProjectIdRef.current !== pid) return res;
    applyTakeResponse(res);
    pushTakeHistory([shotId], before, res?.shotTakes || []);
    return res;
  }, [binsAdapter, optimistic, activeProjectId]);

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
    // Post-overhaul S5b (0090): a row the open bid version does not hold is
    // SET ASIDE — whole, out of sight, not lost. It is missing from the live
    // arrays, so every plan below would read it as gone: "recreate" would
    // re-add it over the set-aside row, out of step with the database.
    const asideKey = { tasks: 'setAsideTasks', phases: 'setAsidePhases' }[table];
    if (asideKey && (bundleRef.current[asideKey] || []).some(r => r.id === id)) {
      throw new Error(`That ${table === 'tasks' ? 'task' : 'phase'} is set aside: the open bid version does not hold it. Edit a bid version that holds it to change it.`);
    }
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

  // ── Bid versions (post-overhaul S5, step 2) ─────────────────────────────
  // Audrey's F2 (2026-10-05): a bid version is a LIVING DOCUMENT. One per
  // project may be OPEN (projects.open_budget_version_id — its data is in the
  // live rows; Save writes back into it), one SELECTED (budget_versions.
  // is_active, the variance baseline — a misnamed column we never rename) and
  // one LOCKED (budget_active_version_id + locked_at / locked_by, "Budget
  // active — in production"). Every version write lives here, registered in
  // mutationsRef with its undo, and NONE reloads the project (F12.4: the old
  // BudgetView reloaded after every write, which wiped Undo) — the bundle's
  // budgetVersions is changed in place.
  //
  // The rates live outside the bundle (useProjectRateOverrides over the rate
  // card), so the callers pass `roleRates` — the live day rate per role, as the
  // Budget computes it — to every mutator that builds a snapshot or opens one.
  //
  // A composite (Save as new, Edit this version, Set budget active, Reset to
  // bidding) is ONE undo step through runBatch, run INSIDE the undo queue
  // (inHistoryQueue): an undo pressed meanwhile waits for it instead of
  // undoing the step before it, and one already replaying finishes first (S3b
  // trap 12 — the batch is one global slot). The callers run these behind a
  // busy kit Dialog, so nothing else on the page can join the batch.
  const [rateOverridesEpoch, setRateOverridesEpoch] = useState(0);

  function versionAdapterFor(method) {
    const a = adapterRef.current;
    if (!a) throw new Error('no adapter');
    if (typeof a[method] !== 'function') throw new Error('this storage cannot change bid versions');
    return a;
  }
  function requireBudgetVersion(id) {
    const v = (bundleRef.current.budgetVersions || []).find(r => r.id === id);
    if (!v) throw new Error('bid version not found');
    return v;
  }
  /** The LOCKED version's id while a budget is active, else null. */
  function lockedBudgetVersionId() {
    const p = bundleRef.current.project;
    return p?.budget_active ? (p.budget_active_version_id || null) : null;
  }
  /**
   * A budget is active ("in production") — with or without a version id on
   * record (review round 1: a project row with budget_active and no id read
   * as unlocked to every guard). While it is, NO version is open: the live
   * Timeline is production's (F9: "i still edit the live Timeline during
   * production as normal"), so opening a bid over it is refused, and Save as
   * new version records the schedule without opening anything.
   */
  function budgetIsLocked() {
    return bundleRef.current.project?.budget_active === true;
  }
  function versionWho() { return withdrawUserRef.current || null; }

  /**
   * A composite's guard (review round 1, R1-03): the project it began on, and
   * the visit (a switch away and back is a new one). Checked before every
   * write it makes, so a switch part way stops it instead of writing the
   * rest — the margin of one project into another — and the steps it made
   * before stay one undo step on the old project's stack (runBatch drops
   * them rather than pushing them onto the new one).
   */
  function compositeGuard() {
    const pid = activeProjectIdRef.current;
    const visit = projectVisitRef.current;
    if (!pid) throw new Error('no project');
    return () => {
      if (activeProjectIdRef.current !== pid || projectVisitRef.current !== visit) {
        throw new Error('another project was opened while this ran, so it stopped there');
      }
    };
  }

  // A row the version holds that the project lost, back under its SAVED id
  // (review round 1, R1-01 and R1-06). Out of the trash first where the
  // backend has one — the cloud keeps a trashed row behind its SELECT policy
  // and refuses an upsert onto it (restore_soft_deleted answers false, never
  // an error, when there is nothing to restore) — then written with the
  // version's values; a row never trashed, or purged, is inserted under that
  // id. Never a new id: one left the trashed original for every later open
  // to make again. Its own undo step: trashed again by the public delete
  // (deletePhase takes only the phase and its edges, never its tasks); its
  // redo restores and writes again, so it survives the trash its undo made.
  // logged_days is never in the row (planOpen's fields).
  const REVIVE = {
    task:      { key: 'tasks',      restore: 'restoreTask',      upsert: 'upsertTask',      del: 'deleteTask' },
    phase:     { key: 'phases',     restore: 'restorePhase',     upsert: 'upsertPhase',     del: 'deletePhase' },
    milestone: { key: 'milestones', restore: 'restoreMilestone', upsert: 'upsertMilestone', del: 'deleteMilestone' },
  };
  async function reviveBudgetRow(kind, row) {
    const visit = projectVisitRef.current;
    const k = REVIVE[kind];
    const a = adapterRef.current;
    const pid = activeProjectIdRef.current;
    if (typeof a[k.restore] === 'function') {
      try { await a[k.restore](row.id, pid); } catch { /* not in the trash: the write below inserts it */ }
    }
    const wire = { project_id: pid, ...row };
    let saved;
    try {
      saved = await a[k.upsert](wire);
    } catch (err) {
      setError(err?.message || String(err));
      throw err;
    }
    const finalRow = saved ? { ...wire, ...saved } : wire;
    // S5c review round 1 (R1-04): the composite's guard runs before each
    // write, not after its answer — a switch while this one was in flight
    // left the row merged into the other project's memory. Its row is in its
    // own project; this visit is over.
    if (projectVisitRef.current !== visit || activeProjectIdRef.current !== pid) return finalRow;
    const merge = (b) => {
      const rest = (b[k.key] || []).filter(r => r.id !== finalRow.id);
      const next = [...rest, finalRow];
      return { ...b, [k.key]: kind === 'milestone' ? next.sort(byMilestoneDate) : next };
    };
    setBundle(merge);
    bundleRef.current = merge(bundleRef.current);
    pushHistory({
      undoOps: [() => mutationsRef.current[k.del](finalRow.id)],
      redoOps: [() => reviveBudgetRow(kind, row)],
    }, visit);
    return finalRow;
  }
  // The bundle's copy, changed in place — and bundleRef at once, since the
  // next write in the same composite reads it (S3c trap 14).
  function mergeVersionRow(row) {
    const merge = (b) => ({ ...b, budgetVersions: [...(b.budgetVersions || []).filter(v => v.id !== row.id), row] });
    setBundle(merge);
    bundleRef.current = merge(bundleRef.current);
  }
  function mergeProjectFields(pid, patch) {
    const merge = (b) => (b.project && b.project.id === pid ? { ...b, project: { ...b.project, ...patch } } : b);
    setBundle(merge);
    bundleRef.current = merge(bundleRef.current);
    setProjectsIndex(idx => (idx[pid] ? { ...idx, [pid]: { ...idx[pid], ...patch } } : idx));
  }

  // A version row put back as it was (an undone delete): its own id and
  // created_at, so it keeps its place newest-first.
  const restoreBudgetVersionRow = useCallback(async (row) => {
    const pid = activeProjectIdRef.current;
    if (!pid || row.project_id !== pid) throw new Error('that bid version is not in the open project');
    const a = versionAdapterFor('upsertBudgetVersion');
    const back = await a.upsertBudgetVersion({ ...row });
    if (activeProjectIdRef.current !== pid) return back || row;
    mergeVersionRow(back ? { ...row, ...back } : row);
    return back || row;
  }, []);

  // Only the named columns, as an UPDATE (patchBudgetVersion on every
  // adapter): a whole cached row re-sent erased a newer note or list.
  const patchBudgetVersionRow = useCallback(async (id, patch) => {
    const pid = activeProjectIdRef.current;
    if (!pid) throw new Error('no project');
    const v = requireBudgetVersion(id);
    const a = versionAdapterFor('patchBudgetVersion');
    const next = { ...v, ...patch };
    const res = await optimistic(
      (b) => ({ ...b, budgetVersions: (b.budgetVersions || []).map(r => (r.id === id ? next : r)) }),
      () => a.patchBudgetVersion(pid, id, patch),
    );
    if (activeProjectIdRef.current !== pid) return res || next;
    mergeVersionRow(res ? { ...next, ...res } : next);
    return res || next;
  }, [optimistic]);

  /** The project's budget fields (the lock, margin, contingency, agency) with an undo step: updateProject records none. */
  const setProjectBudgetFields = useCallback(async (patch) => {
    const pid = activeProjectIdRef.current;
    if (!pid) throw new Error('no project');
    const p = bundleRef.current.project || {};
    const before = {};
    for (const k of Object.keys(patch)) before[k] = p[k] ?? null;
    await mutationsRef.current.updateProject(pid, patch);
    if (activeProjectIdRef.current !== pid) return;
    mergeProjectFields(pid, patch);
    pushHistory({
      undoOps: [() => mutationsRef.current.setProjectBudgetFields(before)],
      redoOps: [() => mutationsRef.current.setProjectBudgetFields(patch)],
    });
  }, []);

  /** The OPEN version (null closes it). Past the money gate only (0089's guard). */
  const setOpenBudgetVersion = useCallback(async (versionId) => {
    const pid = activeProjectIdRef.current;
    if (!pid) throw new Error('no project');
    const target = versionId || null;
    const prev = bundleRef.current.project?.open_budget_version_id || null;
    if (target === prev) return target;
    if (target) requireBudgetVersion(target);
    await mutationsRef.current.updateProject(pid, { open_budget_version_id: target });
    if (activeProjectIdRef.current !== pid) return target;
    mergeProjectFields(pid, { open_budget_version_id: target });
    pushHistory({
      undoOps: [() => mutationsRef.current.setOpenBudgetVersion(prev)],
      redoOps: [() => mutationsRef.current.setOpenBudgetVersion(target)],
    });
    return target;
  }, []);

  /**
   * The SELECTED bid (F13: choosing writes at once; null = "Choose a bid
   * version", nothing promoted). One write on every adapter (0089's RPC).
   * While a budget is active the selected bid is the locked one (F9).
   */
  const selectBudgetVersion = useCallback(async (versionId) => {
    const pid = activeProjectIdRef.current;
    if (!pid) throw new Error('no project');
    const target = versionId || null;
    if (target) requireBudgetVersion(target);
    if (budgetIsLocked() && target !== lockedBudgetVersionId()) {
      throw new Error('while the budget is active the selected bid is the locked one — Reset to bidding to choose another');
    }
    const flagged = (bundleRef.current.budgetVersions || []).filter(v => v.is_active).map(v => v.id);
    const prev = selectedVersionOf(bundleRef.current.budgetVersions)?.id || null;
    if (target === prev && flagged.length === (target ? 1 : 0)) return target;
    const a = versionAdapterFor('selectBudgetVersion');
    const apply = (b) => ({ ...b, budgetVersions: (b.budgetVersions || []).map(v => ({ ...v, is_active: v.id === target })) });
    await optimistic(apply, () => a.selectBudgetVersion(pid, target));
    if (activeProjectIdRef.current !== pid) return target;
    bundleRef.current = apply(bundleRef.current);
    pushHistory({
      undoOps: [() => mutationsRef.current.selectBudgetVersion(prev)],
      redoOps: [() => mutationsRef.current.selectBudgetVersion(target)],
    });
    return target;
  }, [optimistic]);

  /** Rename (the picker's row). */
  const renameBudgetVersion = useCallback(async (id, name) => {
    const v = requireBudgetVersion(id);
    const next = String(name ?? '').trim();
    if (!next) throw new Error('a bid version needs a name');
    if (next === v.name) return v;
    const row = await patchBudgetVersionRow(id, { name: next });
    pushHistory({
      undoOps: [() => mutationsRef.current.renameBudgetVersion(id, v.name)],
      redoOps: [() => mutationsRef.current.renameBudgetVersion(id, next)],
    });
    return row;
  }, [patchBudgetVersionRow]);

  /** The typed note (F8: `summary`, editable later). '' clears it. */
  const updateBudgetVersionSummary = useCallback(async (id, summary) => {
    const v = requireBudgetVersion(id);
    const next = String(summary ?? '').trim() || null;
    if (next === (v.summary ?? null)) return v;
    const row = await patchBudgetVersionRow(id, { summary: next });
    pushHistory({
      undoOps: [() => mutationsRef.current.updateBudgetVersionSummary(id, v.summary ?? '')],
      redoOps: [() => mutationsRef.current.updateBudgetVersionSummary(id, next ?? '')],
    });
    return row;
  }, [patchBudgetVersionRow]);

  /**
   * Delete a version (the person's verb). The LOCKED one cannot go (reset to
   * bidding first); deleting the SELECTED one leaves none selected (F13);
   * deleting the OPEN one closes it (0089's SET NULL). Undo puts it back.
   *
   * S5b, constraint 10 (decided here, for Audrey): the rows ONLY this
   * version held that are SET ASIDE now would be stranded — no version could
   * ever bring them back. They go with it, deleted the ordinary way, in the
   * same undo step (the question names them first: previewDeleteBudgetVersion).
   * A row it held that is LIVE (it was the open one) simply stays.
   */
  const deleteBudgetVersion = useCallback(async (id) => {
    const still = compositeGuard();
    requireBudgetVersion(id);
    if (lockedBudgetVersionId() === id) throw new Error('the locked bid cannot be deleted — Reset to bidding first');
    // S5c review round 1 (R1-02): BOTH paths wait their turn in the undo
    // queue. The quick one did not: run while an undo replayed (history
    // `suspended`), it recorded no step, and a version's delete is a hard
    // delete — gone for good, though its question had promised Undo.
    return inHistoryQueue(async () => {
      still();
      refuseWhileReplaying();
      const v = requireBudgetVersion(id);
      if (lockedBudgetVersionId() === id) throw new Error('the locked bid cannot be deleted — Reset to bidding first');
      const only = onlyHeldSetAside(id);
      if (!countRows(only)) return mutationsRef.current.deleteBudgetVersionRow(id);
      return runBatch(async () => {
        still();
        const m = mutationsRef.current;
        const ids = idsOf(only);
        // Brought back first, so the ordinary delete takes each one the way it
        // always does (its edges, its undo); the trash would clear the stamp
        // anyway (0090), and the undo of this step sets them aside again.
        await m.setAsideRows(false, ids);
        still();
        await deleteBroughtBack(ids, still);
        still();
        await m.deleteBudgetVersionRow(v.id);
      });
    });
  }, [runBatch]);

  /** The version row itself, without the rows only it held (deleteBudgetVersion's last step; its redo). */
  const deleteBudgetVersionRow = useCallback(async (id) => {
    const pid = activeProjectIdRef.current;
    if (!pid) throw new Error('no project');
    const v = requireBudgetVersion(id);
    if (lockedBudgetVersionId() === id) throw new Error('the locked bid cannot be deleted — Reset to bidding first');
    const a = versionAdapterFor('deleteBudgetVersion');
    const wasOpen = (bundleRef.current.project?.open_budget_version_id || null) === id;
    const apply = (b) => ({
      ...b,
      budgetVersions: (b.budgetVersions || []).filter(r => r.id !== id),
      project: wasOpen && b.project ? { ...b.project, open_budget_version_id: null } : b.project,
    });
    await optimistic(apply, () => a.deleteBudgetVersion(id, pid));
    if (activeProjectIdRef.current !== pid) return;
    bundleRef.current = apply(bundleRef.current);
    if (wasOpen) setProjectsIndex(idx => (idx[pid] ? { ...idx, [pid]: { ...idx[pid], open_budget_version_id: null } } : idx));
    pushHistory({
      undoOps: [async () => {
        // S5c review round 2 (R2-06): the toast's Undo is targeted, not
        // last-first — another version may have been selected since. The row
        // comes back selected only if none is now; as it was, two were
        // flagged and the variance went back, unsaid, to the bid the person
        // had replaced.
        const selectedNow = (bundleRef.current.budgetVersions || []).some(r => r.is_active && r.id !== id);
        await restoreBudgetVersionRow(v.is_active && selectedNow ? { ...v, is_active: false } : v);
        if (wasOpen) await mutationsRef.current.setOpenBudgetVersion(id);
      }],
      redoOps: [() => mutationsRef.current.deleteBudgetVersionRow(id)],
    });
  }, [optimistic, restoreBudgetVersionRow]);

  /** The live rows as a version's snapshot, F8's line against `previous`. */
  function liveBudgetSnapshot({ roleRates, shotList, previous }) {
    const b = bundleRef.current;
    return snapshotFromLive({
      tasks: b.tasks, phases: b.phases, milestones: b.milestones, project: b.project,
      roleRates: roleRates || {}, shotList,
      savedAt: new Date().toISOString(), savedBy: versionWho(),
      previous: previous?.snapshot || null, previousName: previous?.name || null,
    });
  }
  function shotListById(id) {
    return id ? ((bundleRef.current.shotLists || []).find(l => l.id === id) || null) : null;
  }

  // The undo (and redo) of a Save writes `values` back only while the stored
  // snapshot is still the one that Save (or its undo) left — another window's
  // Save in between is not erased. Versions are not broadcast, so it re-reads
  // them first (S3a's rewriteSaveIfStill, for bid versions).
  async function rewriteBudgetVersionIfStill(id, expectedSavedAt, values) {
    const pid = activeProjectIdRef.current;
    const a = versionAdapterFor('listBudgetVersions');
    const fresh = await a.listBudgetVersions(pid);
    const row = (fresh || []).find(r => r.id === id);
    if (!row) throw new Error('bid version not found');
    if ((row.snapshot?.saved_at ?? null) !== (expectedSavedAt ?? null)) {
      throw new Error('this bid version has been saved again since — going back would erase that save');
    }
    return patchBudgetVersionRow(id, values);
  }

  /**
   * Save: the live rows written back INTO the open version (F2: "v2 'mid ROM'
   * stays v2"), its name and note kept. { roleRates, basedOnListId } —
   * basedOnListId undefined keeps the version's list. Only the OPEN version
   * is saved into (review round 1), and never while a budget is active: no
   * version is open then, and the locked one is never changed in place (F9).
   * In the undo queue, so it never captures rows an undo is half way through.
   */
  const saveBudgetVersion = useCallback((id, opts = {}) => inHistoryQueue(async () => {
    refuseWhileReplaying();
    const v = requireBudgetVersion(id);
    if (budgetIsLocked() || lockedBudgetVersionId() === id) {
      throw new Error('the locked bid cannot be changed in place — Save as new version keeps these changes');
    }
    if ((bundleRef.current.project?.open_budget_version_id || null) !== id) {
      throw new Error('only the open bid version is saved into — open it first (Edit this version), or Save as new version');
    }
    const visit = projectVisitRef.current;
    const write = async () => {
      const keepList = opts.basedOnListId === undefined;
      const listId = keepList ? (v.shot_list_id || v.snapshot?.shot_list?.id || null) : (opts.basedOnListId || null);
      const live = shotListById(listId);
      const shotList = live || (keepList ? (v.snapshot?.shot_list || null) : null);
      const previous = previousVersionOf(bundleRef.current.budgetVersions, v);
      const snapshot = liveBudgetSnapshot({ roleRates: opts.roleRates, shotList, previous });
      const patch = { snapshot };
      if (!keepList) patch.shot_list_id = live ? live.id : null;
      const before = { snapshot: v.snapshot ?? {} };
      if (!keepList) before.shot_list_id = v.shot_list_id ?? null;
      const row = await patchBudgetVersionRow(id, patch);
      pushHistory({
        undoOps: [surfaced(() => rewriteBudgetVersionIfStill(id, snapshot.saved_at, before))],
        redoOps: [surfaced(() => rewriteBudgetVersionIfStill(id, v.snapshot?.saved_at ?? null, patch))],
      }, visit);
      return row;
    };
    // S5b review round 1 (R1-03): a Save drops from this version every row
    // that is set aside. A set-aside row only THIS version still held (it was
    // removed from it while another version held it, and that version has
    // gone since — another window's delete, say) would then be held by none:
    // out of sight for ever. Such rows, and any no version holds at all, are
    // deleted the ordinary way in the same undo step, and the toast names
    // them (Undo brings them back, set aside again).
    const stranded = strandedBySave(id);
    if (!countRows(stranded)) return write();
    const top0 = historyRef.current.undo[historyRef.current.undo.length - 1];
    let row;
    quietToastsRef.current += 1;
    try {
      row = await runBatch(async () => {
        const still = compositeGuard();
        const r = await write();
        still();
        const ids = idsOf(stranded);
        await mutationsRef.current.setAsideRows(false, ids);
        still();
        await deleteBroughtBack(ids, still);
        return r;
      });
    } finally {
      quietToastsRef.current -= 1;
    }
    const top = historyRef.current.undo[historyRef.current.undo.length - 1];
    const all = [...stranded.tasks, ...stranded.phases, ...stranded.milestones];
    if (top && top !== top0) {
      showUndoToast(`Saved “${v.name}”. ${all.length === 1 ? `“${all[0].title || all[0].name || 'Untitled'}”, which no bid version holds any more, was` : `${rowsWords(stranded)} no bid version holds any more were`} deleted`, () => undoHistoryEntry(top.token));
    }
    return { ...(row || {}), strandedDeleted: stranded };
  }), [patchBudgetVersionRow, runBatch]);

  /** Set-aside rows held by no version once `versionId` is saved (R1-03): only it holds them, or none does. */
  function strandedBySave(versionId) {
    const b = splitSetAside(bundleRef.current);
    const versions = b.budgetVersions || [];
    const out = { tasks: [], phases: [], milestones: [] };
    for (const k of SCHEDULE_KINDS) {
      for (const r of b[ASIDE_KEY[k]] || []) {
        if (!holdersOf(versions, k, r.id, { except: versionId }).length) out[k].push(r);
      }
    }
    return out;
  }

  /**
   * Save as new version… (the only way a version appears, F2): the live rows
   * under a new name and note, then OPENED and SELECTED. While a budget is
   * active it only RECORDS (F9: "so i have a record of production changes"):
   * the new version is neither opened nor selected and stays unlocked; the
   * selected bid stays the locked one and the variance keeps measuring
   * against it. ONE undo step. Built inside the undo queue (review round 1),
   * so the snapshot is never of rows an undo is half way through.
   */
  const createBudgetVersion = useCallback(async (opts = {}) => {
    const still = compositeGuard();
    const pid = activeProjectIdRef.current;
    const name = String(opts.name ?? '').trim();
    if (!name) throw new Error('a bid version needs a name');
    const a = versionAdapterFor('upsertBudgetVersion');
    return inHistoryQueue(() => runBatch(async () => {
      still();
      refuseWhileReplaying();
      const shotList = shotListById(opts.basedOnListId);
      const previous = sortVersionsNewest(bundleRef.current.budgetVersions)[0] || null;
      const snapshot = liveBudgetSnapshot({ roleRates: opts.roleRates, shotList, previous });
      // No created_at on the wire: the server's clock orders versions.
      const row = {
        id: uuidv4(), project_id: pid, name, type: 'bid', is_active: false,
        shot_list_id: shotList ? shotList.id : null,
        summary: String(opts.summary ?? '').trim() || null,
        snapshot,
      };
      const created = await a.upsertBudgetVersion(row);
      const finalRow = { created_at: snapshot.saved_at, ...row, ...(created || {}) };
      still();
      mergeVersionRow(finalRow);
      pushHistory({
        undoOps: [async () => {
          await adapterRef.current.deleteBudgetVersion(finalRow.id, pid);
          const drop = (b) => ({ ...b, budgetVersions: (b.budgetVersions || []).filter(r => r.id !== finalRow.id) });
          setBundle(drop);
          bundleRef.current = drop(bundleRef.current);
        }],
        redoOps: [() => restoreBudgetVersionRow(finalRow)],
      });
      if (budgetIsLocked()) return finalRow;
      try {
        still();
        await mutationsRef.current.setOpenBudgetVersion(finalRow.id);
        still();
        await mutationsRef.current.selectBudgetVersion(finalRow.id);
      } catch (err) {
        if (/another project was opened/.test(err?.message || '')) throw err;
        // S5c review round 2 (R2-05): the version WAS made, and recorded — said,
        // so a second press does not make a second one (`versionMade`: the
        // form then offers only Close); Undo takes it back.
        const said = new Error(`“${name}” was saved as a new version, then the step stopped part way: ${err?.message || err}. Undo takes back what changed.`);
        said.versionMade = finalRow;
        throw said;
      }
      return finalRow;
    }));
  }, [runBatch, restoreBudgetVersionRow]);

  /** A role's project rate (an override over the rate card) with its undo. */
  async function setProjectRoleRate({ roleSlug, rate }, overrides) {
    const visit = projectVisitRef.current;
    const pid = activeProjectIdRef.current;
    const a = versionAdapterFor('upsertProjectRateOverride');
    const existing = (overrides || []).find(o => o.role_slug === roleSlug && !o.member_id) || null;
    const row = existing
      ? { ...existing, day_rate: rate }
      : { id: uuidv4(), project_id: pid, role_slug: roleSlug, member_id: null, day_rate: rate, currency: bundleRef.current.project?.budget_currency || 'USD' };
    await a.upsertProjectRateOverride(row);
    setRateOverridesEpoch(n => n + 1);
    pushHistory({
      undoOps: [surfaced(async () => {
        if (existing) await adapterRef.current.upsertProjectRateOverride(existing);
        else await adapterRef.current.deleteProjectRateOverride(row.id, pid);
        setRateOverridesEpoch(n => n + 1);
      })],
      redoOps: [surfaced(async () => {
        await adapterRef.current.upsertProjectRateOverride(row);
        setRateOverridesEpoch(n => n + 1);
      })],
    }, visit);
  }

  /**
   * Edit this version (F2): its snapshot written into the live rows — phases
   * (sub-phases too), each task's dates, bid days, role, position, status and
   * links, the key dates, margin / contingency / agency and the role rates —
   * then it is OPEN and SELECTED. ONE undo step.
   *
   * S5b, Audrey's ruling (a): the version shows EXACTLY its own schedule.
   * Live rows it does not hold are SET ASIDE (kept whole — their comments,
   * files, links, edges, logged days — out of sight, never in a trash); rows
   * it holds that are set aside come BACK, the same rows; a row it holds that
   * the project lost comes back under its saved id (reviveBudgetRow);
   * logged_days is never written.
   * { roleRates } — the live rates the plan compares against.
   * { keep: { tasks, phases } } — rows with work on them the person chose to
   *   keep (constraint 4): they stay live, as the open version's unsaved
   *   changes; a kept task keeps its phase.
   * { discard: true } — the answer Discard (constraint 8): the live rows NO
   *   saved version holds are deleted the ordinary way first, so none is ever
   *   set aside for good.
   *
   * Refused while a budget is active (review round 1, R1-10): the live
   * Timeline is production's then, its margin, contingency and agency are
   * locked, and opening a bid over it would overwrite the schedule being
   * worked; only the LOCKED bid's refusal was the brief's, and the rest
   * follows from it (F9's disabled Timeline control says the same).
   *
   * The version open now is CLOSED first and this one opened LAST (R1-07):
   * a refusal part way leaves no version open over a mix of two, so no Save
   * can write that mix into either; the steps that landed stay one undo step
   * and the refusal says so.
   */
  const openBudgetVersion = useCallback(async (id, opts = {}) => {
    const still = compositeGuard();
    const v = requireBudgetVersion(id);
    if (budgetIsLocked()) {
      throw new Error(lockedBudgetVersionId() === id
        ? 'the locked bid cannot be opened for editing — Reset to bidding first, or Save as new version'
        : 'while the budget is active no bid version is opened: the live Timeline is production\'s — Reset to bidding to open one');
    }
    if (!readVersion(v).hasTimeline) {
      throw new Error('this bid version was saved before versions kept their schedule (no timeline captured), so it cannot be opened');
    }
    return inHistoryQueue(() => runBatch(async () => {
      still();
      refuseWhileReplaying();
      const landed = landedSince();
      try {
        const plan = await loadVersionIntoLive(v, opts, still);
        still();
        await mutationsRef.current.selectBudgetVersion(id);
        still();
        await mutationsRef.current.setOpenBudgetVersion(id);
        return { id, plan };
      } catch (err) {
        // R1-05: after a project switch the steps that landed belong to the
        // project this began on, whose undo stack is gone — Undo cannot reach
        // them from here, so the sentence must not promise it.
        if (/another project was opened/.test(err?.message || '')) {
          throw new Error(`Opening “${v.name}” stopped part way because another project was opened while it ran. What it had changed in its project stays as it was left; open that project again to see it.`);
        }
        // S5c review round 2 (R2-08): stopped at its first write (closing the
        // version open now), nothing changed and nothing was recorded — the
        // version open before is still open, and no Undo is offered.
        if (!landed()) throw new Error(`Could not open “${v.name}”: ${err?.message || err}. Nothing changed.`);
        // S5c review round 1 (R1-01): "Undo", not "Undo (Ctrl+Z)" — on the
        // Budget the way back is the toast runWithUndoToast offers for a step
        // that stopped part way (the Timeline's Ctrl+Z reaches it too). The
        // version open before was closed first, and this one opens last.
        throw new Error(`Opening “${v.name}” stopped part way: ${err?.message || err}. No version is open now; Undo takes back what changed.`);
      }
    }));
  }, [runBatch]);

  /**
   * Inside a composite's batch: a function telling whether any step has been
   * recorded into that batch since this call — the words of a step that
   * stopped say "Undo takes back what changed" only when something did
   * (S5c review round 2, R2-08). Counted in the batch, not by the history's
   * token count, so a push from elsewhere is never taken for this step's.
   */
  function landedSince() {
    const batch = historyRef.current.batch;
    const mark = batch ? batch.entries.length : 0;
    return () => !!batch && batch.entries.length > mark;
  }

  /**
   * S5c review round 2 (R2-03): the undo queue waits for a step at most
   * HISTORY_STEP_WAIT_MS, then lets the next one run — beside an undo or redo
   * still replaying (a stalled request; a large Local Server project, where
   * every write rewrites project.json). Run then, a version step records
   * nothing (`suspended` drops its steps): a version's delete was gone for
   * good though its question had promised Undo, and an open or a lock wove
   * its writes into the replay's. Every queued version step refuses instead,
   * first thing, and says why.
   */
  function refuseWhileReplaying() {
    if (historyRef.current.suspended) throw new Error('an Undo is still running — try again once it has finished');
  }

  /**
   * The writes that make the live schedule a version AS SAVED — Edit this
   * version's, and Set budget active's (S5b: the lock freezes the version as
   * saved, so the schedule under it is that version's). Inside the caller's
   * batch, `still` checked before every write, in this order: the version
   * open now closed (R1-07: a refusal part way leaves none open over a mix);
   * Discard's deletes; then the plan — brought back, revived or re-made,
   * patched, set aside — then settings and rates. Selecting and opening are
   * the caller's.
   */
  async function loadVersionIntoLive(v, opts, still) {
    const m = mutationsRef.current;
    const pid = activeProjectIdRef.current;
    let b = splitSetAside(bundleRef.current);
    if (b.project?.open_budget_version_id) { await m.setOpenBudgetVersion(null); still(); }
    if (opts.discard) {
      // Constraint 8: what NO saved version holds would be set aside for
      // ever; Discard deletes it the ordinary way instead (Undo brings it back).
      const none = rowsInNoVersion({ tasks: b.tasks, phases: b.phases, milestones: b.milestones }, b.budgetVersions);
      const gone = idsOf(none);
      await deleteRowsQuietly(gone, still);
      // The ordinary deletes land through optimistic's QUEUED setBundle:
      // bundleRef still holds those rows until the next render. Read now, the
      // plan would set them aside (or the check below refuse them); they are
      // dropped from what the plan reads, by id.
      const cur = splitSetAside(bundleRef.current);
      const drop = Object.fromEntries(SCHEDULE_KINDS.map(k => [k, new Set(gone[k].map(String))]));
      b = { ...cur };
      for (const k of SCHEDULE_KINDS) b[k] = (cur[k] || []).filter(r => !drop[k].has(String(r.id)));
    }
    // S5b review round 1 (R1-04): constraint 8 holds HERE, not only in the
    // question before it — a caller that skips the question (a future
    // shortcut) must not hide for ever a row no saved version holds. Unless
    // the person kept it, it is refused until Save or Discard answers for it.
    const keptIds = new Set([...(opts.keep?.tasks || []), ...(opts.keep?.phases || [])].map(String));
    const stranded = rowsInNoVersion({ tasks: b.tasks, phases: b.phases, milestones: b.milestones }, b.budgetVersions);
    const wouldStrand = [...stranded.tasks, ...stranded.phases, ...stranded.milestones]
      .filter(r => !keptIds.has(String(r.id)));
    if (wouldStrand.length) {
      const names = wouldStrand.slice(0, 4).map(r => `“${r.title || r.name || 'Untitled'}”`).join(', ');
      throw new Error(`${wouldStrand.length === 1 ? 'A row on the Timeline is' : `${wouldStrand.length} rows on the Timeline are`} in no saved bid version (${names}${wouldStrand.length > 4 ? ' …' : ''}): save ${wouldStrand.length === 1 ? 'it' : 'them'} into a version, or discard ${wouldStrand.length === 1 ? 'it' : 'them'}, first`);
    }
    const plan = planOpen(v.snapshot, {
      tasks: b.tasks, phases: b.phases, milestones: b.milestones,
      setAside: { tasks: b.setAsideTasks, phases: b.setAsidePhases, milestones: b.setAsideMilestones },
      keep: opts.keep || null,
      project: b.project, roleRates: opts.roleRates || {},
      known: {
        scenes: new Set((b.scenes || []).map(r => String(r.id))),
        shots: new Set((b.shots || []).map(r => String(r.id))),
        assets: new Set((b.assets || []).map(r => String(r.id))),
      },
    });
    // Brought back BEFORE their patches: a patch reads the live row.
    if (countRows(plan.bringBack)) { await m.setAsideRows(false, plan.bringBack); still(); }
    for (const row of plan.phases.create) { await reviveBudgetRow('phase', row); still(); }
    for (const u of plan.phases.update) { await m.updatePhase(u.id, u.patch); still(); }
    for (const row of plan.tasks.create) { await reviveBudgetRow('task', row); still(); }
    for (const u of plan.tasks.update) { await m.updateTask(u.id, u.patch); still(); }
    for (const row of plan.milestones.create) { await reviveBudgetRow('milestone', row); still(); }
    for (const u of plan.milestones.update) { await m.updateMilestone(u.id, u.patch); still(); }
    if (countRows(plan.setAside)) { await m.setAsideRows(true, plan.setAside); still(); }
    if (plan.settings) { await m.setProjectBudgetFields(plan.settings.patch); still(); }
    if (plan.rates.length) {
      const overrides = await adapterRef.current.listProjectRateOverrides?.(pid);
      for (const r of plan.rates) { still(); await setProjectRoleRate(r, overrides); }
    }
    return plan;
  }

  /**
   * Set budget active (the LOCK): the version SELECTED — always written
   * (review round 1, R1-04) — stamped locked_at / locked_by in its real
   * columns (F12.2), and the project's budget_active / budget_active_version_id
   * / budget_finalized. Nothing is open while a budget is active (F9).
   *
   * S5b: the lock freezes the version AS SAVED, and the schedule under it is
   * that version's rows plus what production makes (constraint 6) — so the
   * live schedule BECOMES the version first, as Edit this version makes it
   * (loadVersionIntoLive: set aside, brought back, values restored), with the
   * same { roleRates, keep, discard } answers its questions gave. A version
   * saved before S5 holds no schedule: it locks with the Timeline as it is.
   * ONE undo step.
   */
  const activateBudget = useCallback(async (id, opts = {}) => {
    const still = compositeGuard();
    const v = requireBudgetVersion(id);
    if (budgetIsLocked()) throw new Error('the budget is already active');
    return inHistoryQueue(() => runBatch(async () => {
      still();
      refuseWhileReplaying();
      const m = mutationsRef.current;
      const landed = landedSince();
      try {
        if (readVersion(v).hasTimeline) {
          await loadVersionIntoLive(v, opts, still);
          still();
        } else if (bundleRef.current.project?.open_budget_version_id) {
          await m.setOpenBudgetVersion(null);
          still();
        }
        await m.selectBudgetVersion(id);
        still();
        await m.stampBudgetVersionLock(id, true);
        still();
        await m.setProjectBudgetFields({ budget_active: true, budget_active_version_id: id, budget_finalized: true });
      } catch (err) {
        // S5c review round 1 (R1-01): worded as what it is, as an open's is.
        // The lock is the last write, so a stop before it leaves none.
        if (/another project was opened/.test(err?.message || '')) {
          throw new Error(`Setting “${v.name}” active stopped part way because another project was opened while it ran. What it had changed in its project stays as it was left; open that project again to see it.`);
        }
        // Round 2 (R2-08): nothing recorded, nothing changed — no Undo to name.
        if (!landed()) throw new Error(`Could not set “${v.name}” active: ${err?.message || err}. Nothing changed.`);
        throw new Error(`Setting “${v.name}” active stopped part way: ${err?.message || err}. The budget is not locked; Undo takes back what changed.`);
      }
    }));
  }, [runBatch]);

  // ── Set aside (post-overhaul S5b, step 0; migration 0090) ───────────────
  // Audrey's ruling (a) of 2026-10-05: each bid version shows EXACTLY its own
  // schedule. The rows the open version does not hold are SET ASIDE — kept
  // whole (comments, files, links, edges, assignments, logged days, scene and
  // shot links), never in a trash, never purged, hidden from every reader
  // (the loaders split them into the setAside* keys) — and come back, the
  // same rows, when a version holding them is opened. The design:
  // docs/sessions/handoffs/po-s5b-2026-10-05.md, "Step 0".
  const SCHEDULE_KINDS = ['tasks', 'phases', 'milestones'];
  const ASIDE_KEY = { tasks: 'setAsideTasks', phases: 'setAsidePhases', milestones: 'setAsideMilestones' };
  const bySortOrder = (a, c) => (a.sort_order ?? 0) - (c.sort_order ?? 0);

  /**
   * Set rows aside (on) or bring them back (off): ONE write, ONE undo step
   * (what it set aside comes back; what it brought back goes aside again).
   * Only the rows memory holds in the other state move — the step's undo
   * takes back exactly those, never a row that was already there.
   * ids: { tasks, phases, milestones }.
   */
  const setAsideRows = useCallback(async (on, ids = {}) => {
    const pid = activeProjectIdRef.current;
    if (!pid) throw new Error('no project');
    // R1-02's second layer: a stamped row a list read put back among the
    // live ones counts as set aside here, whatever memory's arrays say.
    const b = splitSetAside(bundleRef.current);
    const want = {};
    // Replaying a step (undo / redo), the ids ARE the step's own — exactly
    // what it moved — and memory may not show them yet: the op before this
    // one (a restore taking a row out of the trash) lands through a queued
    // setBundle, which bundleRef sees only after the next render. The backend
    // touches nothing already in the asked state, and the functional
    // setBundle below marks the rows once they are there.
    const replaying = historyRef.current.suspended;
    for (const k of SCHEDULE_KINDS) {
      const asked = new Set((ids[k] || []).map(String));
      if (replaying) { want[k] = [...(ids[k] || [])]; continue; }
      const from = on ? (b[k] || []) : (b[ASIDE_KEY[k]] || []);
      want[k] = from.filter(r => asked.has(String(r.id))).map(r => r.id);
    }
    if (!countRows(want)) return null;
    const a = versionAdapterFor('setAsideRows');
    const res = await a.setAsideRows(pid, { on, ...want });
    if (activeProjectIdRef.current !== pid) return res;
    // S5b review round 1 (R1-01): the backend says how many rows it moved.
    // Fewer than asked means memory was wrong about them (another window,
    // a row the database no longer shows): marking them moved here would
    // show a schedule the database does not hold. Read the project again and
    // stop, saying so — never a silent half.
    const moved = (Number(res?.tasks) || 0) + (Number(res?.phases) || 0) + (Number(res?.milestones) || 0);
    if (res && !replaying && moved !== countRows(want)) {
      mutationsRef.current.reloadActiveProject?.();
      throw new Error(`${on ? 'Setting aside' : 'Bringing back'} ${countRows(want)} row${countRows(want) === 1 ? '' : 's'} moved ${moved}: some were not as this window showed them. The project has been read again — check the Timeline before going on.`);
    }
    const stamp = on ? (res?.set_aside_at || new Date().toISOString()) : null;
    const apply = (bundle) => {
      const j = joinSetAside(bundle);
      const next = { ...j };
      for (const k of SCHEDULE_KINDS) {
        const set = new Set(want[k].map(String));
        if (set.size) next[k] = j[k].map(r => (set.has(String(r.id)) ? { ...r, set_aside_at: stamp } : r));
      }
      const split = splitSetAside(next);
      // A row that came back takes its place as a reload would put it.
      if (!on && want.phases.length) split.phases = split.phases.slice().sort(bySortOrder);
      if (!on && want.milestones.length) split.milestones = split.milestones.slice().sort(byMilestoneDate);
      return split;
    };
    setBundle(apply);
    bundleRef.current = apply(bundleRef.current);
    pushHistory({
      undoOps: [() => mutationsRef.current.setAsideRows(!on, want)],
      redoOps: [() => mutationsRef.current.setAsideRows(on, want)],
    });
    return res;
  }, []);

  function idsOf(set) {
    const out = {};
    for (const k of SCHEDULE_KINDS) out[k] = ((set && set[k]) || []).map(r => (r && typeof r === 'object' ? r.id : r));
    return out;
  }
  const rowName = (kind, row) => (kind === 'phases' ? row?.name : row?.title) || 'Untitled';

  /**
   * The ordinary deletes of a composite (Discard, a version's delete), without
   * a toast each: the composite shows one. Stopped part way, the error carries
   * `notDeleted` — the rows it did not delete. deleteTasks is all-or-nothing
   * where the backend can restore (it restores what it had trashed); where it
   * cannot (the Local Server), the tasks that went are recorded and named in
   * `deletedIds` (S5c review round 2, R2-01). Phases and key dates go one by
   * one, each recorded as it lands.
   */
  async function deleteRowsQuietly(ids, still) {
    const m = mutationsRef.current;
    const left = { tasks: [...(ids.tasks || [])], phases: [...(ids.phases || [])], milestones: [...(ids.milestones || [])] };
    quietToastsRef.current += 1;
    try {
      if (left.tasks.length) {
        try {
          await m.deleteTasks(left.tasks);
        } catch (err) {
          const went = new Set(err?.deletedIds || []);
          left.tasks = left.tasks.filter(id => !went.has(id));
          throw err;
        }
        left.tasks = [];
        still();
      }
      while (left.phases.length) { await m.deletePhase(left.phases[0]); left.phases.shift(); still(); }
      while (left.milestones.length) { await m.deleteMilestone(left.milestones[0]); left.milestones.shift(); still(); }
    } catch (err) {
      if (err && typeof err === 'object') err.notDeleted = left;
      throw err;
    } finally {
      quietToastsRef.current -= 1;
    }
  }

  /**
   * Set-aside rows brought back only to be deleted (a version's delete; a
   * Save's rows no version holds any more). S5c review round 1 (R1-01):
   * stopped part way, the ones not deleted were left LIVE under the open
   * version, and its next Save folded another bid's rows into it — the very
   * fault ruling (a) removed. They go aside again before the error is said.
   * (After a project switch nothing more is written: that is not this
   * project any more.)
   */
  async function deleteBroughtBack(ids, still) {
    try {
      await deleteRowsQuietly(ids, still);
    } catch (err) {
      if (err?.notDeleted && !/another project was opened/.test(err?.message || '')) {
        try { await mutationsRef.current.setAsideRows(true, err.notDeleted); } catch { /* the first error is the one to say */ }
      }
      throw err;
    }
  }

  /** The SET-ASIDE rows only `versionId` holds (constraint 10): deleting it would strand them. */
  function onlyHeldSetAside(versionId) {
    const b = splitSetAside(bundleRef.current);
    const versions = b.budgetVersions || [];
    // S5b review round 1 (R1-03): a set-aside row the OPEN version's saved
    // snapshot still names was removed from it since (Remove from this
    // version) — its next Save drops it. That snapshot is no home: counting
    // it let a version's delete leave the row to be stranded by that Save.
    const openId = b.project?.open_budget_version_id || null;
    const out = { tasks: [], phases: [], milestones: [] };
    for (const k of SCHEDULE_KINDS) {
      for (const r of b[ASIDE_KEY[k]] || []) {
        const holders = holdersOf(versions, k, r.id, { except: openId === versionId ? null : openId });
        if (holders.length === 1 && holders[0].id === versionId) out[k].push(r);
      }
    }
    return out;
  }

  function workOfRows(set) {
    const b = bundleRef.current;
    const out = [];
    for (const k of ['tasks', 'phases']) {
      for (const r of (set && set[k]) || []) {
        const w = workOn(k, r, { comments: b.comments, files: b.files, managedFiles: b.managedFiles });
        if (w) out.push({ kind: k, id: r.id, name: rowName(k, r), work: w });
      }
    }
    return out;
  }

  /**
   * Remove from this version, or Delete (constraint 9), for the person's
   * delete of these live rows: while a version is open and no budget is
   * active, a row ANOTHER saved version holds is set aside (it stays there);
   * any other is deleted the ordinary way. A member reads no versions, so
   * every delete of theirs is the ordinary one.
   * → { remove, del: { tasks, phases, milestones } ids, rows: [{ kind, id,
   *   name, verb, holders: [{ id, name }], work }], openVersion }
   */
  function removalPlanFor(ids = {}) {
    const b = bundleRef.current;
    const versions = b.budgetVersions || [];
    const openVersionId = b.project?.open_budget_version_id || null;
    const locked = budgetIsLocked();
    const out = { remove: { tasks: [], phases: [], milestones: [] }, del: { tasks: [], phases: [], milestones: [] }, rows: [], openVersion: versions.find(v => v.id === openVersionId) || null };
    for (const kind of SCHEDULE_KINDS) {
      const live = new Map((b[kind] || []).map(r => [String(r.id), r]));
      for (const r of removalOf({ kind, ids: ids[kind] || [], versions, openVersionId, locked })) {
        const row = live.get(String(r.id));
        if (!row) continue;
        (r.verb === 'remove' ? out.remove : out.del)[kind].push(row.id);
        out.rows.push({
          kind, id: row.id, name: rowName(kind, row), verb: r.verb,
          holders: r.holders.map(v => ({ id: v.id, name: v.name })),
          work: workOn(kind, row, { comments: b.comments, files: b.files, managedFiles: b.managedFiles }),
        });
      }
    }
    return out;
  }

  // The person's delete (ctx.deleteTask / deleteTasks / deletePhase /
  // deleteMilestone). All-ordinary deletes run the raw verb unchanged, its
  // own toast and undo. Anything another version holds goes aside instead,
  // in ONE undo step with the rest, and ONE toast says which.
  async function removeOrDelete(ids, rawAll) {
    const plan = removalPlanFor(ids);
    if (!countRows(plan.remove)) return rawAll();
    const before = historyRef.current.undo[historyRef.current.undo.length - 1];
    quietToastsRef.current += 1;
    try {
      await inHistoryQueue(() => runBatch(async () => {
        const still = compositeGuard();
        await mutationsRef.current.setAsideRows(true, plan.remove);
        still();
        if (countRows(plan.del)) await deleteRowsQuietly(plan.del, still);
      }));
    } finally {
      quietToastsRef.current -= 1;
    }
    const top = historyRef.current.undo[historyRef.current.undo.length - 1];
    if (top && top !== before) showUndoToast(removalToastWords(plan), () => undoHistoryEntry(top.token));
    return plan;
  }
  const deleteTaskVerb = useCallback((id) => removeOrDelete({ tasks: [id] }, () => mutationsRef.current.deleteTask(id)), []);
  const deleteTasksVerb = useCallback((ids = []) => removeOrDelete({ tasks: ids }, () => mutationsRef.current.deleteTasks(ids)), []);
  const deletePhaseVerb = useCallback((id) => removeOrDelete({ phases: [id] }, () => mutationsRef.current.deletePhase(id)), []);
  const deleteMilestoneVerb = useCallback((id) => removeOrDelete({ milestones: [id] }, () => mutationsRef.current.deleteMilestone(id)), []);

  /**
   * What Edit this version (or Set budget active) would do — nothing
   * written — for the questions (step 4): whether the Save / Discard / Cancel
   * question comes first and what Discard deletes (constraint 8), what
   * leaves and what returns, and the rows with work on them (constraint 4).
   * { roleRates, keep, discard, liveShotListId } as the open would take them.
   */
  function previewOpenBudgetVersion(id, { roleRates = {}, keep = null, discard = false, liveShotListId } = {}) {
    const b = splitSetAside(bundleRef.current);
    const versions = b.budgetVersions || [];
    const v = versions.find(r => r.id === id) || null;
    if (!v) return null;
    const read = readVersion(v);
    const refusal = budgetIsLocked()
      ? 'while the budget is active no bid version is opened'
      : (!read.hasTimeline ? 'no timeline captured' : null);
    const openV = versions.find(r => r.id === (b.project?.open_budget_version_id || null)) || null;
    const liveRows = { tasks: b.tasks || [], phases: b.phases || [], milestones: b.milestones || [] };
    const liveSnap = snapshotFromLive({ ...liveRows, project: b.project, roleRates });
    const listed = (ver) => (liveShotListId === undefined ? {} : { shotListId: ver.shot_list_id ?? null, liveShotListId });
    const openDirty = openV ? versionDiff(openV.snapshot, liveSnap, listed(openV)).isDirty : false;
    const matchesSome = versions.some(r => readVersion(r).hasTimeline && !versionDiff(r.snapshot, liveSnap).isDirty);
    const inNoVersion = rowsInNoVersion(liveRows, versions);
    const unsaved = openV
      ? (openDirty ? { kind: 'open', version: openV, inNoVersion, work: workOfRows(inNoVersion) } : null)
      : (!matchesSome && countRows(liveRows) > 0 ? { kind: 'none', version: null, inNoVersion, work: workOfRows(inNoVersion) } : null);
    let leaving = { tasks: [], phases: [], milestones: [] };
    let returning = { tasks: [], phases: [], milestones: [] };
    let plan = null;
    if (read.hasTimeline) {
      const gone = discard ? Object.fromEntries(SCHEDULE_KINDS.map(k => [k, new Set(inNoVersion[k].map(r => String(r.id)))])) : null;
      const live = Object.fromEntries(SCHEDULE_KINDS.map(k => [k, gone ? liveRows[k].filter(r => !gone[k].has(String(r.id))) : liveRows[k]]));
      plan = planOpen(v.snapshot, {
        ...live, setAside: { tasks: b.setAsideTasks, phases: b.setAsidePhases, milestones: b.setAsideMilestones },
        keep, project: b.project, roleRates,
      });
      for (const k of SCHEDULE_KINDS) {
        const away = new Set(plan.setAside[k].map(String));
        const back = new Set(plan.bringBack[k].map(String));
        leaving[k] = live[k].filter(r => away.has(String(r.id)));
        returning[k] = (b[ASIDE_KEY[k]] || []).filter(r => back.has(String(r.id)));
      }
    }
    return { version: v, refusal, open: openV, unsaved, leaving, returning, work: workOfRows(leaving), plan };
  }

  /** What deleting a version takes with it (constraint 10): the set-aside rows only it holds, rows with work first. */
  function previewDeleteBudgetVersion(id) {
    const b = bundleRef.current;
    const v = (b.budgetVersions || []).find(r => r.id === id) || null;
    if (!v) return null;
    const only = onlyHeldSetAside(id);
    return { version: v, only, work: workOfRows(only), count: countRows(only) };
  }

  // S5c review round 1 (R1-02): the PERSON's select, rename and note wait
  // their turn in the undo queue, as the composites do — run while an undo
  // replayed (history `suspended`) they recorded no step. The raw verbs stay
  // in mutationsRef for the composites (already inside the queue: queued
  // there, they would wait on themselves) and for history's replays.
  // Round 2 (R2-03): and refuse while a replay still runs beside the queue.
  const selectBudgetVersionQueued = useCallback((id) => inHistoryQueue(() => { refuseWhileReplaying(); return selectBudgetVersion(id); }), [selectBudgetVersion]);
  const renameBudgetVersionQueued = useCallback((id, name) => inHistoryQueue(() => { refuseWhileReplaying(); return renameBudgetVersion(id, name); }), [renameBudgetVersion]);
  const updateBudgetVersionSummaryQueued = useCallback((id, summary) => inHistoryQueue(() => { refuseWhileReplaying(); return updateBudgetVersionSummary(id, summary); }), [updateBudgetVersionSummary]);

  // Stable for the context (each reads refs only, never a render's state).
  const removalPlanForCb = useCallback((ids) => removalPlanFor(ids), []);
  const previewOpenCb = useCallback((id, opts) => previewOpenBudgetVersion(id, opts), []);
  const previewDeleteCb = useCallback((id) => previewDeleteBudgetVersion(id), []);

  /**
   * Post-overhaul S5c: a version step taken where no Ctrl+Z reaches it — the
   * Budget's Summary binds no undo keys (the Expenses tab's are its own
   * history, and the Timeline is not mounted beside it) — says what it did in
   * the undo toast, whose Undo takes back exactly that step. `run` is the
   * step (a mutator call); `words` a sentence, or a function of the step's
   * answer that returns one. Nothing is shown when the step recorded nothing
   * (it was refused, or changed nothing), nor when another project was opened
   * while it ran (that toast would undo a step of the other project's).
   *
   * `run` must queue its step in the undo queue before its first await, as
   * every version mutator does: the step waits its turn there, and an undo,
   * a redo or another step (a select still answering) may run first, so the
   * top of the stack at the asking is no measure of what THIS step recorded
   * (found during S5c's review round 2: a delete that failed before writing
   * anything offered to undo the select that ran before it). A marker queued
   * just before the step reads the history's token count as the step begins;
   * an entry above it is the step's own.
   */
  const runWithUndoToast = useCallback(async (run, words) => {
    const stack = historyRef.current;
    let from = Infinity;
    inHistoryQueue(async () => { from = historyTokenRef.current; });
    const offer = (said, opts) => {
      const top = historyRef.current.undo[historyRef.current.undo.length - 1];
      if (said && historyRef.current === stack && top && top.token > from) {
        showUndoToast(said, () => undoHistoryEntry(top.token), opts);
      }
    };
    let out;
    try {
      out = await run();
    } catch (err) {
      // S5c review round 1 (R1-01): a step that stops part way has still
      // recorded what landed (runBatch's finally pushes it), and on the Budget
      // nothing else reaches it — the toast is its way back, held while its
      // question says so (round 2, R2-09: it outlived its 8 s before). The
      // refusal itself is the caller's to say.
      offer('Stopped part way: Undo takes back what changed', { hold: true });
      throw err;
    }
    offer(typeof words === 'function' ? words(out) : words);
    return out;
  }, [showUndoToast, undoHistoryEntry]);

  /** The bid versions, read again (another window opened or closed one: they are not broadcast, S5-02). */
  const refreshBudgetVersions = useCallback(async () => {
    const pid = activeProjectIdRef.current;
    const a = adapterRef.current;
    if (!pid || typeof a?.listBudgetVersions !== 'function') return;
    let rows;
    try { rows = await a.listBudgetVersions(pid); } catch { return; }
    if (activeProjectIdRef.current !== pid) return;
    const apply = (bundle) => ({ ...bundle, budgetVersions: rows || [] });
    setBundle(apply);
    bundleRef.current = apply(bundleRef.current);
  }, []);

  /** Reset to bidding: the lock lifted, its stamp cleared. ONE undo step. */
  const resetToBidding = useCallback(async () => {
    const still = compositeGuard();
    return inHistoryQueue(() => runBatch(async () => {
      still();
      refuseWhileReplaying();
      const m = mutationsRef.current;
      const lockedId = bundleRef.current.project?.budget_active_version_id || null;
      await m.setProjectBudgetFields({ budget_active: false, budget_active_version_id: null, budget_finalized: false });
      if (lockedId && (bundleRef.current.budgetVersions || []).some(r => r.id === lockedId)) {
        still();
        await m.stampBudgetVersionLock(lockedId, false);
      }
    }));
  }, [runBatch]);

  // Post-overhaul S5d review round 2 (R2-01, R2-05): a bid version step
  // running — Save, Save as new, Edit this version, a version's delete, the
  // lock and Reset to bidding, from the Summary, the Timeline's bar or a
  // question — as STATE, from the person's press until the step ends, so the
  // Timeline stands still while one runs however it was (re)mounted: its own
  // flag (R1-02) went when the tab was left and came back mid-Save, and a
  // drag then joined the Save's step. 'stalled' once the history queue's wait
  // has passed (it lets other steps run beside a stalled one too): a step
  // that never answers must not hold the Timeline for ever. One flag for the
  // window: steps queue one behind another, and a project switch mid-step
  // (rare) only keeps the next project's Timeline still until it ends.
  const versionStepsRef = useRef(0);
  const versionStepTimerRef = useRef(null);
  const [versionStep, setVersionStep] = useState(null); // null | 'running' | 'stalled'
  useEffect(() => () => clearTimeout(versionStepTimerRef.current), []);
  const trackVersionStep = useCallback((step) => async (...args) => {
    if (versionStepsRef.current++ === 0) {
      setVersionStep('running');
      versionStepTimerRef.current = setTimeout(
        () => setVersionStep(s => (s === 'running' ? 'stalled' : s)),
        globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS ?? HISTORY_STEP_WAIT_MS,
      );
    }
    try {
      return await step(...args);
    } finally {
      if (--versionStepsRef.current === 0) {
        clearTimeout(versionStepTimerRef.current);
        setVersionStep(null);
      }
    }
  }, []);
  const deleteBudgetVersionStep = useMemo(() => trackVersionStep(deleteBudgetVersion), [trackVersionStep, deleteBudgetVersion]);
  const saveBudgetVersionStep = useMemo(() => trackVersionStep(saveBudgetVersion), [trackVersionStep, saveBudgetVersion]);
  const createBudgetVersionStep = useMemo(() => trackVersionStep(createBudgetVersion), [trackVersionStep, createBudgetVersion]);
  const openBudgetVersionStep = useMemo(() => trackVersionStep(openBudgetVersion), [trackVersionStep, openBudgetVersion]);
  const activateBudgetStep = useMemo(() => trackVersionStep(activateBudget), [trackVersionStep, activateBudget]);
  const resetToBiddingStep = useMemo(() => trackVersionStep(resetToBidding), [trackVersionStep, resetToBidding]);

  /** locked_at / locked_by on the version itself (F12.2), with its undo. */
  const stampBudgetVersionLock = useCallback(async (id, on) => {
    const visit = projectVisitRef.current;
    const v = requireBudgetVersion(id);
    const patch = on
      ? { locked_at: new Date().toISOString(), locked_by: versionWho() }
      : { locked_at: null, locked_by: null };
    const before = { locked_at: v.locked_at ?? null, locked_by: v.locked_by ?? null };
    await patchBudgetVersionRow(id, patch);
    pushHistory({
      undoOps: [() => patchBudgetVersionRow(id, before)],
      redoOps: [() => patchBudgetVersionRow(id, patch)],
    }, visit);
  }, [patchBudgetVersionRow]);

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
  // Bins (demo 2026-09-11): every mutator a history entry can call.
  mutationsRef.current.addBin           = addBin;
  mutationsRef.current.updateBin        = updateBin;
  mutationsRef.current.deleteBin        = deleteBin;
  mutationsRef.current.reorderBins      = reorderBins;
  mutationsRef.current.addBinFiles      = addBinFiles;
  mutationsRef.current.updateBinFile    = updateBinFile;
  mutationsRef.current.bulkUpdateBinFiles = bulkUpdateBinFiles;
  mutationsRef.current.moveBinFiles     = moveBinFiles;
  mutationsRef.current.copyBinFiles     = copyBinFiles;
  mutationsRef.current.removeBinFiles   = removeBinFiles;
  mutationsRef.current.restoreBinFiles  = restoreBinFiles;
  // Bins on the cloud (BC1): the company's locations and its switch — each
  // an undo step calls, so each is here (the same silent-undo hazard).
  mutationsRef.current.addBinLocation   = addBinLocation;
  mutationsRef.current.updateBinLocation = updateBinLocation;
  mutationsRef.current.removeBinLocation = removeBinLocation;
  mutationsRef.current.setRemoteViewingEnabled = setRemoteViewingEnabled;
  // BC2: every new mutator in the registry, history op or not.
  mutationsRef.current.pickBinLocationLocalPath = pickBinLocationLocalPath;
  mutationsRef.current.forgetBinLocationLocalPath = forgetBinLocationLocalPath;
  mutationsRef.current.connectBinLocation = connectBinLocation;
  mutationsRef.current.uploadBinFilePosters = uploadBinFilePosters;
  // Shot takes (milestone 2). 🚨 A history op calls mutationsRef.current.X,
  // and undo SWALLOWS a throw — a mutator missing from this list fails
  // silently (measured: Ctrl+Z after an assignment did nothing until
  // replaceShotTakes was registered here).
  mutationsRef.current.replaceShotTakes = replaceShotTakes;
  mutationsRef.current.assignShotTakes  = assignShotTakes;
  mutationsRef.current.updateShotTake   = updateShotTake;
  mutationsRef.current.removeShotTakes  = removeShotTakes;
  mutationsRef.current.reorderShotTakes = reorderShotTakes;
  // Shot lists and edits (S3a). Every name a history op calls — the same
  // silent-undo hazard as above; mutationsRegistry.test.js pins it.
  mutationsRef.current.putShotListItems     = putShotListItems;
  mutationsRef.current.dropShotListItems    = dropShotListItems;
  mutationsRef.current.repositionShotListItems = repositionShotListItems;
  mutationsRef.current.addShotList          = addShotList;
  mutationsRef.current.updateShotList       = updateShotList;
  mutationsRef.current.saveShotListSnapshot = saveShotListSnapshot;
  mutationsRef.current.setActiveShotList    = setActiveShotList;
  mutationsRef.current.archiveShotList      = archiveShotList;
  mutationsRef.current.addToShotList        = addToShotList;
  mutationsRef.current.removeFromShotList   = removeFromShotList;
  mutationsRef.current.reorderShotListItems = reorderShotListItems;
  mutationsRef.current.createEditFrom       = createEditFrom;
  mutationsRef.current.updateEdit           = updateEdit;
  mutationsRef.current.saveEdit             = saveEdit;
  mutationsRef.current.archiveEdit          = archiveEdit;
  mutationsRef.current.withdrawShotList     = withdrawShotList;
  mutationsRef.current.withdrawEdit         = withdrawEdit;
  mutationsRef.current.restoreWithdrawn     = restoreWithdrawn;
  // Bid versions (post-overhaul S5): every version write, so each undo step
  // reaches the latest implementation.
  mutationsRef.current.selectBudgetVersion        = selectBudgetVersion;
  mutationsRef.current.setOpenBudgetVersion       = setOpenBudgetVersion;
  mutationsRef.current.renameBudgetVersion        = renameBudgetVersion;
  mutationsRef.current.updateBudgetVersionSummary = updateBudgetVersionSummary;
  mutationsRef.current.deleteBudgetVersion        = deleteBudgetVersion;
  mutationsRef.current.saveBudgetVersion          = saveBudgetVersion;
  mutationsRef.current.createBudgetVersion        = createBudgetVersion;
  mutationsRef.current.openBudgetVersion          = openBudgetVersion;
  mutationsRef.current.activateBudget             = activateBudget;
  mutationsRef.current.resetToBidding             = resetToBidding;
  mutationsRef.current.setProjectBudgetFields     = setProjectBudgetFields;
  mutationsRef.current.stampBudgetVersionLock     = stampBudgetVersionLock;
  // S5b (0090): set aside / bring back, a version's row on its own (the
  // last step of its delete, and that step's redo), the versions re-read.
  mutationsRef.current.setAsideRows               = setAsideRows;
  mutationsRef.current.deleteBudgetVersionRow     = deleteBudgetVersionRow;
  mutationsRef.current.refreshBudgetVersions      = refreshBudgetVersions;
  mutationsRef.current.reloadActiveProject        = reloadActiveProject;

  // ── Shot-list selectors (S3a) ───────────────────────────
  // D10: `scenes` / `shots` below are the ACTIVE list's rows (every row when
  // the project has no active list — the pre-0084 state, so nothing on
  // screen changes for a project without lists). After the D11 backfill the
  // active list holds every row, so every existing consumer sees exactly
  // what it saw before. `allScenes` / `allShots` are the unfiltered rows.
  const activeShotListId = bundle.project?.active_shot_list_id || null;
  // Same rows, same array: an edit Save or a membership write elsewhere must
  // not hand every ctx.scenes / ctx.shots consumer a new identity (round 2).
  const stableActiveScenesRef = useRef([]);
  const stableActiveShotsRef = useRef([]);
  const sameRows = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const shotListView = useMemo(() => {
    // Only the pointer matters here, not every project field — a title edit
    // must not hand ctx.scenes / ctx.shots a new identity (review round 1).
    const project = { active_shot_list_id: activeShotListId };
    const lists = bundle.shotLists || [];
    const items = bundle.shotListItems || [];
    const edits = bundle.edits || [];
    const scenes = bundle.scenes || [];
    const shots = bundle.shots || [];
    return {
      activeShotList: activeShotListOf(project, lists),
      activeScenes: (() => {
        const next = activeScenesOf({ project, shotLists: lists, shotListItems: items, scenes, shots });
        if (sameRows(next, stableActiveScenesRef.current)) return stableActiveScenesRef.current;
        stableActiveScenesRef.current = next;
        return next;
      })(),
      activeShots: (() => {
        const next = activeShotsOf({ project, shotLists: lists, shotListItems: items, shots });
        if (sameRows(next, stableActiveShotsRef.current)) return stableActiveShotsRef.current;
        stableActiveShotsRef.current = next;
        return next;
      })(),
      scenesOf: (listId) => scenesOfList(scenes, items, listId, shots),
      shotsOf: (listId) => shotsOfList(shots, items, listId, scenes),
      listsContaining: (id) => listsContainingOf({ shotLists: lists, shotListItems: items, shots }, id),
      editsOf: (listId) => editsOfList(edits, listId),
      nextShotListVersion: (title) => nextShotListVersionOf(lists, title),
      nextEditVersion: (listId, title) => nextEditVersionOf(edits, listId, title),
      editChainTip: (listId) => editChainTipOf(edits, listId),
      editItemsFromList: (listId) => editItemsFromListOf({ scenes, shots, items, listId, newId: uuidv4 }),
      // "Not in any list" counts LIVE lists only (0086: a withdrawn list is
      // gone to the person who withdrew it; its scenes must not vanish).
      unlistedScenes: unlistedScenesOf({ shotLists: lists, shotListItems: items, scenes, shots }),
      unlistedShots: unlistedShotsOf({ shotLists: lists, shotListItems: items, shots }),
      // Links resolve by id over EVERY row (review round 1): a task or take
      // linked to a scene another list holds must still find its scene.
      sceneById: (id) => (id ? scenes.find(s => s.id === id) || null : null),
      shotById: (id) => (id ? shots.find(s => s.id === id) || null : null),
    };
  }, [activeShotListId, bundle.shotLists, bundle.shotListItems, bundle.edits, bundle.scenes, bundle.shots]);

  // Withdraw (0086), resolved against the rows on screen. recentlyWithdrawn
  // is { kind: 'shot_list' | 'edit', id, row } while the marked row is still
  // set aside in the open project, else null. canWithdrawShotList(id) /
  // canWithdrawEdit(id) say whether THIS person may withdraw that live row
  // now; S3b and S3c offer the verb only then.
  // On a backend with users the mark shows only while the row is still set
  // aside BY THIS PERSON (a manager may have restored and archived it since,
  // review R1). It ends when server data shows the row live
  // (unmarkIfServerShowsLive); while a write is in flight it is only hidden.
  const recentlyWithdrawn = useMemo(() => {
    const m = recentlyWithdrawnMark;
    if (!m || m.projectId !== activeProjectId) return null;
    const pool = m.kind === 'edit' ? bundle.edits : bundle.shotLists;
    const row = (pool || []).find(r => r.id === m.id) || null;
    if (!row || !row.archived_at) return null;
    if (typeof withdrawUserId === 'string' && row.archived_by !== withdrawUserId) return null;
    return { kind: m.kind, id: m.id, row };
  }, [recentlyWithdrawnMark, activeProjectId, bundle.edits, bundle.shotLists, withdrawUserId]);
  // A read-only backend (Drive) can withdraw nothing.
  const withdrawWritable = adapterSupportsWrites(adapterMode);
  const canWithdrawShotList = useCallback((listId) => {
    if (!withdrawWritable) return false;
    const list = (bundle.shotLists || []).find(l => l.id === listId);
    return !!list && !list.archived_at && shotListWithdrawRefusal({
      list, edits: bundle.edits, activeListId: activeShotListId, userId: withdrawUserId,
    }) === null;
  }, [withdrawWritable, bundle.shotLists, bundle.edits, activeShotListId, withdrawUserId]);
  const canWithdrawEdit = useCallback((editId) => {
    if (!withdrawWritable) return false;
    const edit = (bundle.edits || []).find(e => e.id === editId);
    return !!edit && !edit.archived_at && editWithdrawRefusal({
      edit, edits: bundle.edits, userId: withdrawUserId,
    }) === null;
  }, [withdrawWritable, bundle.edits, withdrawUserId]);

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
    // D10 (S3a): the ACTIVE shot list's scenes and shots, in load order —
    // every row when the project has no active list. See shotListView and
    // shotListModel.activeScenesOf.
    scenes:          shotListView.activeScenes,
    shots:           shotListView.activeShots,
    allScenes:       bundle.scenes || [],
    allShots:        bundle.shots || [],
    // Shot lists and edits (S3a, migration 0084) — the API S3b and S3c use.
    shotLists:       bundle.shotLists || [],
    shotListItems:   bundle.shotListItems || [],
    edits:           bundle.edits || [],
    activeShotList:  shotListView.activeShotList,
    scenesOf:        shotListView.scenesOf,
    shotsOf:         shotListView.shotsOf,
    listsContaining: shotListView.listsContaining,
    editsOf:         shotListView.editsOf,
    nextShotListVersion: shotListView.nextShotListVersion,
    nextEditVersion: shotListView.nextEditVersion,
    editChainTip:    shotListView.editChainTip,
    editItemsFromList: shotListView.editItemsFromList,
    unlistedScenes:  shotListView.unlistedScenes,
    unlistedShots:   shotListView.unlistedShots,
    sceneById:       shotListView.sceneById,
    shotById:        shotListView.shotById,
    formatShotListLabel,
    // Withdraw (0086): the maker's take-back of an untouched new list or edit.
    recentlyWithdrawn,
    canWithdrawShotList,
    canWithdrawEdit,
    isWithdrawn,
    // The unsaved edit (S3c, step 4; D13): the open project's drafts, one per
    // list, and the copies a previous run left ("Recover unsaved edit?").
    editDrafts:      openProjectDrafts,
    editDraftOf,
    hasUnsavedEdit,
    recoverableEditDrafts,
    // The leave guard (S3c, step 7; D12): every exit's one question.
    confirmLeave,
    leaveAsk,
    answerLeave,
    describeUnsavedEdits,
    unsavedEditCount,
    saveOpenDrafts,
    discardOpenDrafts,
    // The bin system (demo 2026-09-11).
    bins:            bundle.bins || [],
    binFiles:        bundle.binFiles || [],
    binRoots:        bundle.binRoots || [],
    shotTakes:       bundle.shotTakes || [],
    levels:          bundle.levels || [],
    experiences:     bundle.experiences || [],
    milestones:      bundle.milestones || [],
    // Session 26: the project folder tree (migration 0041). S27 renders it.
    folders:         bundle.folders || [],
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

    // undo toast — its Undo held while a view says so (S5d R2-04)
    undoToast,
    dismissUndoToast,
    undoHeld, holdUndo,

    // actions
    createProject,
    updateProject,
    deleteProject,
    setActiveProject,
    // S5b, constraint 9: the person's delete verbs decide Remove from this
    // version or Delete; history replays the RAW verbs through mutationsRef.
    addPhase, updatePhase, deletePhase: deletePhaseVerb, reorderPhases,
    addAsset, updateAsset, deleteAsset, deleteAssets, reorderAssets,
    addTask, updateTask, deleteTask: deleteTaskVerb, deleteTasks: deleteTasksVerb,
    linkTasks, linkPhases, unlinkTasks, unlinkDependency,
    addTaskLink, removeTaskLink,
    addTeamAssignment, updateTeamAssignment, removeTeamAssignment,
    syncProjectTeam,
    uploadFile, markFileCoreDefiner, patchFile, deleteFile, downloadFile, thumbnailUrls, fileUrl,
    downloadUrl,
    addManagedFile, updateManagedFile, deleteManagedFile, refreshManagedFiles,

    // Session 27. WHICH file store this backend actually has.
    //
    // managedFiles is a local_server-ONLY subsystem: createManagedFile exists
    // on that adapter and nowhere else, and its whole add/download/open-folder
    // flow runs through window.electronAPI.rabbit — a native picker, a
    // streaming copy, an OS explorer window. BOTH conditions are required, and
    // that is the whole point: Local Server only runs inside the desktop app,
    // but the SELECTED backend can be Supabase while running there. FileManager
    // guarded on "are we in Electron", which is true regardless of the selected
    // backend, so in cloud mode its Add files button reached a subsystem that
    // does not exist and did nothing at all.
    supportsManagedFiles:
      adapterMode === 'local_server' && !!globalThis.window?.electronAPI?.rabbit,

    // The bin system (demo 2026-09-11; on the cloud since BC1, 0091).
    // "This backend can hold bins": the signed-out desktop (the loopback
    // server, with the OS pickers), the cloud (the four 0091 tables — what
    // the cloud cannot do is on binsInfo.capabilities), and the dev fixtures.
    // Google Drive cannot. Before BC1 this meant "Local Server + desktop";
    // the Bins tab's desktop-only notice was the whole cloud experience.
    supportsBins:
      (adapterMode === 'local_server' && !!globalThis.window?.electronAPI?.rabbit)
      || adapterMode === 'supabase'
      // Dev fixtures (dev builds only): the Bins tab opens on the dataset's bins.
      || (import.meta.env.DEV && !!devFixtures()?.bins),
    binsInfo,
    binLocations:  bundle.binLocations,
    // BC2: this computer's desktop process answers on the cloud — the
    // composite reads clips where they are (bins only; never the FILES store).
    binsDesktopFiles: !!desktopBinFiles,
    refreshBins, addBin, updateBin, deleteBin, reorderBins,
    pickBinFiles, pickBinFolder, prepareBinFiles, addBinFiles, findDuplicateBinFiles,
    updateBinFile, bulkUpdateBinFiles, moveBinFiles, copyBinFiles, removeBinFiles, restoreBinFiles,
    probeBinFile, probeBinFiles, applyBinFileProbe, postBinFileThumbnail, openBinFile, binFileThumbnailUrl, binFileStreamUrl, binFilePosterUrl,
    binRelinkScan, binRelinkApply, removeBinRoot,
    // Footage locations and the company's switch (BC1).
    refreshBinLocations, addBinLocation, updateBinLocation, removeBinLocation, setRemoteViewingEnabled,
    // BC2: the switch read without a project; where a location is on THIS computer;
    // pictures to the cloud only while the company allows it.
    refreshRemoteViewing, pickBinLocationLocalPath, forgetBinLocationLocalPath, uploadBinFilePosters, connectBinLocation,
    // Shot takes (milestone 2).
    assignShotTakes, updateShotTake, removeShotTakes, reorderShotTakes, replaceShotTakes,

    addScene, updateScene, deleteScene,
    addShot, updateShot, deleteShot,
    // Shot lists and edits (S3a).
    addShotList, updateShotList, saveShotListSnapshot, setActiveShotList, archiveShotList,
    addToShotList, removeFromShotList, reorderShotListItems, refreshShotLists,
    createEditFrom, updateEdit, saveEdit, archiveEdit,
    withdrawShotList, withdrawEdit, restoreWithdrawn, clearRecentlyWithdrawn,
    startEditDraft, changeEditDraft, undoEditDraft, redoEditDraft, discardEditDraft, saveEditDraft,
    recoverEditDraft, dismissStoredEditDraft,
    addLevel, updateLevel, deleteLevel,
    addExperience, updateExperience, deleteExperience,
    addMilestone, updateMilestone, deleteMilestone: deleteMilestoneVerb,
    listTrashedMilestones, restoreMilestone,
    // Bid versions (post-overhaul S5): open / selected / locked, the two save
    // verbs, and the epoch useProjectRateOverrides reloads on after an open
    // writes the version's rates. Select, rename and note in the undo queue
    // (S5c, R1-02).
    selectBudgetVersion: selectBudgetVersionQueued,
    renameBudgetVersion: renameBudgetVersionQueued,
    updateBudgetVersionSummary: updateBudgetVersionSummaryQueued,
    // The steps that write the schedule or lock it, each tracked while it
    // runs (versionStep, S5d R2-01): the Timeline stands still meanwhile.
    deleteBudgetVersion: deleteBudgetVersionStep,
    saveBudgetVersion: saveBudgetVersionStep,
    createBudgetVersion: createBudgetVersionStep,
    openBudgetVersion: openBudgetVersionStep,
    activateBudget: activateBudgetStep,
    resetToBidding: resetToBiddingStep,
    versionStep,
    rateOverridesEpoch,
    // S5b (0090): the rows the open version does not hold (set aside: out of
    // every reader, kept whole), and the answers the questions are built from.
    setAsideTasks:       bundle.setAsideTasks || [],
    setAsidePhases:      bundle.setAsidePhases || [],
    setAsideMilestones:  bundle.setAsideMilestones || [],
    // S5d: the edges touching a set-aside row — the Timeline draws a VIEWED
    // version's arrows between its rows as they carry them now, set aside or
    // not (views/timelineVersionView.js). Read-only; no reader counts them.
    setAsideDependencies: bundle.setAsideDependencies || [],
    removalPlanFor:      removalPlanForCb,
    previewOpenBudgetVersion:   previewOpenCb,
    previewDeleteBudgetVersion: previewDeleteCb,
    // S5c: a version step's undo toast, where no Ctrl+Z reaches (the Budget).
    runWithUndoToast,

    // folders (Session 26). Exposed so S27's Files view can rebuild the
    // tree for a project that predates 0041 without inventing its own
    // path rules — folderPaths.js stays the only place paths are decided.
    ensureProjectFolders: ensureProjectFoldersFor,
    ensureEntityFolder:   ensureEntityFolderFor,
    // S4c: the one-time move of shot folders into their scenes (Files tab).
    refileShotFolders,

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
    undoToast, dismissUndoToast, undoHeld, holdUndo,
    createProject, updateProject, deleteProject, setActiveProject,
    addPhase, updatePhase, deletePhase, reorderPhases,
    addAsset, updateAsset, deleteAsset, deleteAssets, reorderAssets,
    addTask, updateTask, deleteTask, deleteTasks,
    linkTasks, linkPhases, unlinkTasks, unlinkDependency,
    addTaskLink, removeTaskLink,
    addTeamAssignment, updateTeamAssignment, removeTeamAssignment,
    syncProjectTeam,
    uploadFile, markFileCoreDefiner, patchFile, deleteFile, downloadFile, thumbnailUrls, fileUrl,
    downloadUrl,
    addManagedFile, updateManagedFile, deleteManagedFile, refreshManagedFiles,
    binsInfo, refreshBins, addBin, updateBin, deleteBin, reorderBins,
    pickBinFiles, pickBinFolder, prepareBinFiles, addBinFiles, findDuplicateBinFiles,
    updateBinFile, bulkUpdateBinFiles, moveBinFiles, copyBinFiles, removeBinFiles, restoreBinFiles,
    probeBinFile, probeBinFiles, applyBinFileProbe, postBinFileThumbnail, openBinFile, binFileThumbnailUrl, binFileStreamUrl, binFilePosterUrl,
    binRelinkScan, binRelinkApply, removeBinRoot,
    refreshBinLocations, addBinLocation, updateBinLocation, removeBinLocation, setRemoteViewingEnabled,
    refreshRemoteViewing, pickBinLocationLocalPath, forgetBinLocationLocalPath, uploadBinFilePosters, connectBinLocation, desktopBinFiles,
    assignShotTakes, updateShotTake, removeShotTakes, reorderShotTakes, replaceShotTakes,
    addScene, updateScene, deleteScene,
    addShot, updateShot, deleteShot,
    addShotList, updateShotList, saveShotListSnapshot, setActiveShotList, archiveShotList,
    addToShotList, removeFromShotList, reorderShotListItems, refreshShotLists,
    createEditFrom, updateEdit, saveEdit, archiveEdit, shotListView,
    withdrawShotList, withdrawEdit, restoreWithdrawn, clearRecentlyWithdrawn,
    recentlyWithdrawn, canWithdrawShotList, canWithdrawEdit,
    openProjectDrafts, editDraftOf, hasUnsavedEdit, recoverableEditDrafts,
    startEditDraft, changeEditDraft, undoEditDraft, redoEditDraft, discardEditDraft, saveEditDraft,
    recoverEditDraft, dismissStoredEditDraft,
    leaveAsk, answerLeave, describeUnsavedEdits, unsavedEditCount, saveOpenDrafts, discardOpenDrafts,
    addLevel, updateLevel, deleteLevel,
    addExperience, updateExperience, deleteExperience,
    addMilestone, updateMilestone, deleteMilestone,
    listTrashedMilestones, restoreMilestone,
    selectBudgetVersionQueued, renameBudgetVersionQueued, updateBudgetVersionSummaryQueued, deleteBudgetVersionStep,
    saveBudgetVersionStep, createBudgetVersionStep, openBudgetVersionStep, activateBudgetStep, resetToBiddingStep,
    versionStep, rateOverridesEpoch,
    deleteTaskVerb, deleteTasksVerb, deletePhaseVerb, deleteMilestoneVerb,
    removalPlanForCb, previewOpenCb, previewDeleteCb, runWithUndoToast,
    ensureProjectFoldersFor, ensureEntityFolderFor,
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
