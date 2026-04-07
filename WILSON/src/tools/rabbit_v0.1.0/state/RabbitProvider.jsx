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
  phases:        [],
  assets:        [],
  tasks:         [],
  dependencies:  [],
  taskLinks:     [],
  files:         [],
  assetVersions: [],
  comments:      [],
  ingestionRuns: [],
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
  const optimistic = useCallback(async (mutator, adapterCall) => {
    const snapshot = bundle;
    try {
      setBundle(prev => mutator(prev));
      const result = await adapterCall();
      return result;
    } catch (err) {
      setBundle(snapshot);
      setError(err.message || String(err));
      throw err;
    }
  }, [bundle]);

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
      sort_order:   bundle.phases.length,
      ...phase,
    };
    const created = await adapterRef.current.upsertPhase(row);
    const finalRow = created || row;
    setBundle(prev => ({ ...prev, phases: [...prev.phases, finalRow] }));
    return finalRow;
  }, [activeProjectId, bundle.phases.length]);

  const updatePhase = useCallback((id, patch) => optimistic(
    prev => ({ ...prev, phases: prev.phases.map(p => p.id === id ? { ...p, ...patch } : p) }),
    () => adapterRef.current.upsertPhase({ ...bundle.phases.find(p => p.id === id), ...patch, id }),
  ), [optimistic, bundle.phases]);

  const deletePhase = useCallback((id) => optimistic(
    prev => ({ ...prev, phases: prev.phases.filter(p => p.id !== id) }),
    () => adapterRef.current.deletePhase(id, activeProjectId),
  ), [optimistic, activeProjectId]);

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
      sort_order:   bundle.assets.length,
      status:       'not_started',
      type:         'other',
      ...asset,
    };
    const created = await adapterRef.current.upsertAsset(row);
    const finalRow = created || row;
    setBundle(prev => ({ ...prev, assets: [...prev.assets, finalRow] }));
    return finalRow;
  }, [activeProjectId, bundle.assets.length]);

  const updateAsset = useCallback((id, patch) => optimistic(
    prev => ({ ...prev, assets: prev.assets.map(a => a.id === id ? { ...a, ...patch } : a) }),
    () => adapterRef.current.upsertAsset({ ...bundle.assets.find(a => a.id === id), ...patch, id }),
  ), [optimistic, bundle.assets]);

  const deleteAsset = useCallback((id) => optimistic(
    prev => ({ ...prev, assets: prev.assets.filter(a => a.id !== id), tasks: prev.tasks.filter(t => t.asset_id !== id) }),
    () => adapterRef.current.deleteAsset(id, activeProjectId),
  ), [optimistic, activeProjectId]);

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
    return finalRow;
  }, [activeProjectId]);

  const updateTask = useCallback((id, patch) => optimistic(
    prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, ...patch } : t) }),
    () => adapterRef.current.upsertTask({ ...bundle.tasks.find(t => t.id === id), ...patch, id }),
  ), [optimistic, bundle.tasks]);

  const deleteTask = useCallback((id) => optimistic(
    prev => ({
      ...prev,
      tasks: prev.tasks.filter(t => t.id !== id),
      dependencies: prev.dependencies.filter(d => d.predecessor_id !== id && d.successor_id !== id),
    }),
    () => adapterRef.current.deleteTask(id, activeProjectId),
  ), [optimistic, activeProjectId]);

  // ── Dependencies ────────────────────────────────────────
  // The `dependencies` array carries BOTH task→task and phase→phase
  // edges. We distinguish with an optional `kind` field ('task' |
  // 'phase'). Missing / undefined kind is treated as 'task' so
  // legacy rows keep working. The critical-path engine naturally
  // filters out phase-kind rows because their ids aren't in the
  // task lookup table.
  const linkTasks = useCallback((predecessorId, successorId, type = 'FS', lagDays = 0) => {
    const id = uuidv4();
    const row = {
      id,
      predecessor_id: predecessorId,
      successor_id:   successorId,
      kind:           'task',
      type,
      lag_days:       lagDays,
      project_id:     activeProjectId,
    };
    return optimistic(
      prev => ({ ...prev, dependencies: [...prev.dependencies, row] }),
      () => adapterRef.current.upsertDependency(row),
    );
  }, [optimistic, activeProjectId]);

  const linkPhases = useCallback((predecessorId, successorId, type = 'FS', lagDays = 0) => {
    const id = uuidv4();
    const row = {
      id,
      predecessor_id: predecessorId,
      successor_id:   successorId,
      kind:           'phase',
      type,
      lag_days:       lagDays,
      project_id:     activeProjectId,
    };
    return optimistic(
      prev => ({ ...prev, dependencies: [...prev.dependencies, row] }),
      () => adapterRef.current.upsertDependency(row),
    );
  }, [optimistic, activeProjectId]);

  const unlinkTasks = useCallback((dependencyId) => optimistic(
    prev => ({ ...prev, dependencies: prev.dependencies.filter(d => d.id !== dependencyId) }),
    () => adapterRef.current.deleteDependency(dependencyId, activeProjectId),
  ), [optimistic, activeProjectId]);

  // Alias — semantically covers both task + phase edges.
  const unlinkDependency = unlinkTasks;

  // ── Task links (free URLs) ──────────────────────────────
  const addTaskLink = useCallback((link) => optimistic(
    prev => ({ ...prev, taskLinks: [...prev.taskLinks, { id: uuidv4(), project_id: activeProjectId, ...link }] }),
    () => adapterRef.current.upsertTaskLink({ id: uuidv4(), project_id: activeProjectId, ...link }),
  ), [optimistic, activeProjectId]);

  const removeTaskLink = useCallback((linkId) => optimistic(
    prev => ({ ...prev, taskLinks: prev.taskLinks.filter(l => l.id !== linkId) }),
    () => adapterRef.current.deleteTaskLink(linkId, activeProjectId),
  ), [optimistic, activeProjectId]);

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
    uploadFile, markFileCoreDefiner,

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
    uploadFile, markFileCoreDefiner,
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
