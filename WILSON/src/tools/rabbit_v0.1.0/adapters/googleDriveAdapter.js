// ============================================================
// RABBIT v0.1 — Google Drive adapter (stub — filled in Commit 4)
// ============================================================
//
// Read-only in v0.1. Implements only status / listProjects /
// loadProject / downloadFile. Write methods throw a documented
// error pointing at the v0.2 plan in the post-build notes.
//
// This stub exists so adapters/index.js resolves during the
// staged Commit 2 build. The next commit replaces it.

const READ_ONLY = () => async () => {
  throw new Error(
    'Google Drive adapter is read-only in v0.1 — see RABBIT_v0.6_post_build_notes.md for the write plan'
  );
};

export function googleDriveAdapter() {
  return {
    mode: 'google_drive',
    status: async () => ({ online: false, lastSyncAt: null, error: 'not yet implemented' }),
    listProjects:           READ_ONLY(),
    loadProject:            READ_ONLY(),
    createProject:          READ_ONLY(),
    updateProject:          READ_ONLY(),
    deleteProject:          READ_ONLY(),
    listPhases:             READ_ONLY(),
    upsertPhase:            READ_ONLY(),
    deletePhase:            READ_ONLY(),
    listAssets:             READ_ONLY(),
    upsertAsset:            READ_ONLY(),
    deleteAsset:            READ_ONLY(),
    listTasks:              READ_ONLY(),
    upsertTask:             READ_ONLY(),
    deleteTask:             READ_ONLY(),
    upsertDependency:       READ_ONLY(),
    deleteDependency:       READ_ONLY(),
    upsertTaskLink:         READ_ONLY(),
    deleteTaskLink:         READ_ONLY(),
    uploadFile:             READ_ONLY(),
    listFiles:              READ_ONLY(),
    downloadFile:           READ_ONLY(),
    updateFile:             READ_ONLY(),
    deleteFile:             READ_ONLY(),
    upsertAssetVersion:     READ_ONLY(),
    listAssetVersions:      READ_ONLY(),
    createComment:          READ_ONLY(),
    listComments:           READ_ONLY(),
    deleteComment:          READ_ONLY(),
    createIngestionRun:     READ_ONLY(),
    updateIngestionRun:     READ_ONLY(),
    listIngestionChunks:    READ_ONLY(),
    upsertIngestionChunk:   READ_ONLY(),
    updateChunk:            READ_ONLY(),
    listRateCards:          READ_ONLY(),
    upsertRateCard:         READ_ONLY(),
    deleteRateCard:         READ_ONLY(),
    listRateCardEntries:    READ_ONLY(),
    upsertRateCardEntry:    READ_ONLY(),
    deleteRateCardEntry:    READ_ONLY(),
    subscribeProjectChanges: () => () => {},
  };
}
