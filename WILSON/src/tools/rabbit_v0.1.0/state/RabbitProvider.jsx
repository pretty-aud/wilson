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

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_ADAPTER_MODE = 'local_server';

const RabbitContext = createContext(null);

// ─── Settings persistence (otter-settings.json) ─────────────
async function loadRabbitSettings() {
  try {
    const res = await fetch('/api/otter-settings');
    const data = await res.json();
    return data.rabbit || {};
  } catch {
    return {};
  }
}
async function saveRabbitSettings(patch) {
  try {
    const res = await fetch('/api/otter-settings');
    const data = await res.json();
    const next = { ...data, rabbit: { ...(data.rabbit || {}), ...patch } };
    await fetch('/api/otter-settings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(next),
    });
  } catch {
    /* settings save is best-effort — never blocks a user mutation */
  }
}

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
  // mutationsRef holds the latest version of every public mutator
  // so history closures can call the current implementation rather
  // than a stale captured one.
  const mutationsRef = useRef({});

  function pushHistory(entry) {
    if (historyRef.current.suspended) return;
    if (historyRef.current.batch) {
      historyRef.current.batch.entries.push(entry);
      return;
    }
    historyRef.current.undo.push(entry);
    if (historyRef.current.undo.length > HISTORY_CAP) historyRef.current.undo.shift();
    historyRef.current.redo.length = 0;
    setHistoryVersion(v => v + 1);
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

  const clearHistory = useCallback(() => {
    historyRef.current = { undo: [], redo: [], suspended: false, batch: null };
    setHistoryVersion(v => v + 1);
  }, []);

  const canUndo = historyVersion >= 0 && historyRef.current.undo.length > 0;
  const canRedo = historyVersion >= 0 && historyRef.current.redo.length > 0;

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
      const mode = ADAPTER_MODES.includes(settings.adapterMode) ? settings.adapterMode : DEFAULT_ADAPTER_MODE;
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

  // ── adapter mode switch ─────────────────────────────────
  const switchAdapter = useCallback(async (nextMode) => {
    if (!ADAPTER_MODES.includes(nextMode)) return;
    setAdapterMode(nextMode);
    adapterRef.current = selectAdapter(nextMode);
    setProjectsIndex({});
    setBundle(EMPTY_BUNDLE);
    setActiveProjectIdState(null);
    // Clear undo history — old ops belong to the previous adapter.
    historyRef.current = { undo: [], redo: [], suspended: false, batch: null };
    setHistoryVersion(v => v + 1);
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
  }, []);

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
    historyRef.current = { undo: [], redo: [], suspended: false, batch: null };
    setHistoryVersion(v => v + 1);
    if (!projectId) {
      setBundle(EMPTY_BUNDLE);
      return;
    }
    setLoadingProject(true);
    try {
      const next = await adapterRef.current.loadProject(projectId);
      setBundle({ ...EMPTY_BUNDLE, ...next });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoadingProject(false);
    }
  }, []);

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
      setError(err.message || String(err));
      throw err;
    }
  }, []);

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
    const updated = await adapterRef.current.updateProject(id, patch);
    setProjectsIndex(idx => ({
      ...idx,
      [id]: { ...(idx[id] || {}), ...updated },
    }));
    if (id === activeProjectId) {
      setBundle(prev => ({ ...prev, project: { ...prev.project, ...updated } }));
    }
    return updated;
  }, [activeProjectId]);

  const deleteProject = useCallback(async (id) => {
    if (!adapterRef.current) throw new Error('no adapter');
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
  }, [activeProjectId]);

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
    setBundle(prev => ({ ...prev, phases: [...prev.phases, finalRow] }));
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
    const result = await optimistic(
      prev => ({ ...prev, phases: prev.phases.map(p => p.id === id ? { ...p, ...patch } : p) }),
      () => adapterRef.current.upsertPhase({ ...bundleRef.current.phases.find(p => p.id === id), ...patch, id }),
    );
    if (oldPhase) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updatePhase(id, oldValues)],
        redoOps: [() => mutationsRef.current.updatePhase(id, patch)],
      });
    }
    return result;
  }, [optimistic]);

  const deletePhase = useCallback(async (id) => {
    const oldPhase = bundleRef.current.phases.find(p => p.id === id);
    const result = await optimistic(
      prev => ({ ...prev, phases: prev.phases.filter(p => p.id !== id) }),
      () => adapterRef.current.deletePhase(id, activeProjectId),
    );
    if (oldPhase) {
      pushHistory({
        undoOps: [() => mutationsRef.current.addPhase(oldPhase)],
        redoOps: [() => mutationsRef.current.deletePhase(id)],
      });
    }
    return result;
  }, [optimistic, activeProjectId]);

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
        if (phase) await adapterRef.current.upsertPhase({ ...phase, sort_order: i });
      }
    },
  ), [optimistic, bundle.phases]);

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
    setBundle(prev => ({ ...prev, assets: [...prev.assets, finalRow] }));
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
    const result = await optimistic(
      prev => ({ ...prev, assets: prev.assets.map(a => a.id === id ? { ...a, ...patch } : a) }),
      () => adapterRef.current.upsertAsset({ ...bundleRef.current.assets.find(a => a.id === id), ...patch, id }),
    );
    if (oldAsset) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateAsset(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateAsset(id, patch)],
      });
    }
    return result;
  }, [optimistic]);

  const deleteAsset = useCallback(async (id) => {
    const oldAsset = bundleRef.current.assets.find(a => a.id === id);
    // deleteAsset cascades locally onto tasks (see mutator). Capture
    // those tasks too so undo restores them.
    const removedTasks = bundleRef.current.tasks.filter(t => t.asset_id === id);
    const result = await optimistic(
      prev => ({ ...prev, assets: prev.assets.filter(a => a.id !== id), tasks: prev.tasks.filter(t => t.asset_id !== id) }),
      () => adapterRef.current.deleteAsset(id, activeProjectId),
    );
    if (oldAsset) {
      pushHistory({
        undoOps: [
          () => mutationsRef.current.addAsset(oldAsset),
          ...removedTasks.map(t => () => mutationsRef.current.addTask(t)),
        ],
        redoOps: [() => mutationsRef.current.deleteAsset(id)],
      });
    }
    return result;
  }, [optimistic, activeProjectId]);

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
        if (asset) await adapterRef.current.upsertAsset({ ...asset, sort_order: i });
      }
    },
  ), [optimistic, bundle.assets]);

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
    const created = await adapterRef.current.upsertTask(row);
    const finalRow = created || row;
    setBundle(prev => ({ ...prev, tasks: [...prev.tasks, finalRow] }));
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
    const result = await optimistic(
      prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, ...patch } : t) }),
      () => adapterRef.current.upsertTask({ ...bundleRef.current.tasks.find(t => t.id === id), ...patch, id }),
    );
    if (oldTask) {
      pushHistory({
        undoOps: [() => mutationsRef.current.updateTask(id, oldValues)],
        redoOps: [() => mutationsRef.current.updateTask(id, patch)],
      });
    }
    return result;
  }, [optimistic]);

  const deleteTask = useCallback(async (id) => {
    const oldTask = bundleRef.current.tasks.find(t => t.id === id);
    // deleteTask also strips matching dependency rows. Capture them
    // for undo so the dependency graph restores too.
    const removedDeps = bundleRef.current.dependencies.filter(
      d => d.predecessor_id === id || d.successor_id === id,
    );
    const result = await optimistic(
      prev => ({
        ...prev,
        tasks: prev.tasks.filter(t => t.id !== id),
        dependencies: prev.dependencies.filter(d => d.predecessor_id !== id && d.successor_id !== id),
      }),
      () => adapterRef.current.deleteTask(id, activeProjectId),
    );
    if (oldTask) {
      pushHistory({
        undoOps: [
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
    }
    return result;
  }, [optimistic, activeProjectId]);

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
    setBundle(prev => ({ ...prev, files: [...prev.files, created] }));
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
  const startBackgroundIngestion = useCallback(async ({ files, personas, apiKey }) => {
    if (!apiKey) throw new Error('missing API key');
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
        apiKey,
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

  // ── Mutations ref refresh ───────────────────────────────
  // History closures call into mutationsRef.current so they always
  // hit the latest mutator implementation, not a captured stale one.
  mutationsRef.current.addPhase     = addPhase;
  mutationsRef.current.updatePhase  = updatePhase;
  mutationsRef.current.deletePhase  = deletePhase;
  mutationsRef.current.addAsset     = addAsset;
  mutationsRef.current.updateAsset  = updateAsset;
  mutationsRef.current.deleteAsset  = deleteAsset;
  mutationsRef.current.addTask      = addTask;
  mutationsRef.current.updateTask   = updateTask;
  mutationsRef.current.deleteTask   = deleteTask;
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

    // actions
    createProject,
    updateProject,
    deleteProject,
    setActiveProject,
    addPhase, updatePhase, deletePhase, reorderPhases,
    addAsset, updateAsset, deleteAsset, reorderAssets,
    addTask, updateTask, deleteTask,
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
    createProject, updateProject, deleteProject, setActiveProject,
    addPhase, updatePhase, deletePhase, reorderPhases,
    addAsset, updateAsset, deleteAsset, reorderAssets,
    addTask, updateTask, deleteTask,
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
