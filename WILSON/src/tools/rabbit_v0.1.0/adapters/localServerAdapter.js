// ============================================================
// RABBIT v0.1 — Local Server adapter (stub — filled in Commit 3)
// ============================================================
//
// The full implementation talks to Express routes under
// /api/rabbit/* in electron/main.cjs and persists JSON files
// under {userData}/rabbit-data/.
//
// This stub exists so adapters/index.js can import it during
// the staged Commit 2 build. The next commit replaces it.

export function localServerAdapter() {
  const notReady = (name) => async () => {
    throw new Error(`[localServerAdapter] ${name}() — not yet implemented (Commit 3)`);
  };
  return {
    mode: 'local_server',
    status: async () => ({ online: false, lastSyncAt: null, error: 'not yet implemented' }),
    listProjects:           notReady('listProjects'),
    loadProject:            notReady('loadProject'),
    createProject:          notReady('createProject'),
    updateProject:          notReady('updateProject'),
    deleteProject:          notReady('deleteProject'),
    listPhases:             notReady('listPhases'),
    upsertPhase:            notReady('upsertPhase'),
    deletePhase:            notReady('deletePhase'),
    listAssets:             notReady('listAssets'),
    upsertAsset:            notReady('upsertAsset'),
    deleteAsset:            notReady('deleteAsset'),
    listTasks:              notReady('listTasks'),
    upsertTask:             notReady('upsertTask'),
    deleteTask:             notReady('deleteTask'),
    upsertDependency:       notReady('upsertDependency'),
    deleteDependency:       notReady('deleteDependency'),
    upsertTaskLink:         notReady('upsertTaskLink'),
    deleteTaskLink:         notReady('deleteTaskLink'),
    uploadFile:             notReady('uploadFile'),
    listFiles:              notReady('listFiles'),
    downloadFile:           notReady('downloadFile'),
    updateFile:             notReady('updateFile'),
    deleteFile:             notReady('deleteFile'),
    upsertAssetVersion:     notReady('upsertAssetVersion'),
    listAssetVersions:      notReady('listAssetVersions'),
    createComment:          notReady('createComment'),
    listComments:           notReady('listComments'),
    deleteComment:          notReady('deleteComment'),
    createIngestionRun:     notReady('createIngestionRun'),
    updateIngestionRun:     notReady('updateIngestionRun'),
    listIngestionChunks:    notReady('listIngestionChunks'),
    upsertIngestionChunk:   notReady('upsertIngestionChunk'),
    updateChunk:            notReady('updateChunk'),
    listRateCards:          notReady('listRateCards'),
    upsertRateCard:         notReady('upsertRateCard'),
    deleteRateCard:         notReady('deleteRateCard'),
    listRateCardEntries:    notReady('listRateCardEntries'),
    upsertRateCardEntry:    notReady('upsertRateCardEntry'),
    deleteRateCardEntry:    notReady('deleteRateCardEntry'),
    subscribeProjectChanges: () => () => {},
  };
}
