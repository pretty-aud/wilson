// ============================================================
// RABBIT v0.1 — Google Drive adapter (READ-ONLY)
// ============================================================
//
// v0.1 implements only:
//   status, listProjects, loadProject, downloadFile, listFiles
//
// Every write method throws a single canonical error pointing at
// the v0.2 plan in Claude_Work/RABBIT_v0.6_post_build_notes.md.
//
// ── Layout on Drive ─────────────────────────────────────────
// Each project = one subfolder of the user-supplied root folder.
//   {RABBIT root}/
//     {project_id}/
//       project.json     ← full denormalized bundle (same shape as
//                          the local server adapter writes)
//       files/           ← binary file bodies
//       thumbs/          ← thumbnail cache
//
// project_id is the Drive folder ID — that doubles as the bundle
// primary key inside RABBIT, which is why we don't need a separate
// server-side index.
//
// ── OAuth ──────────────────────────────────────────────────
// WILSON does not yet ship a Google OAuth client. The user must
// supply their own at:
//   {userData}/rabbit-data/gdrive-config.json
//   { clientId, clientSecret, redirectUri, rootFolderId }
//
// Refresh tokens are stored separately at:
//   {userData}/rabbit-data/gdrive-tokens.json
//   { accessToken, refreshToken, expiresAt }
//
// The Settings → RABBIT panel (Session 3) will host the connect
// flow. For now this adapter just reads whatever the user has
// already written via the IPC bridge.
//
// Code.gs and Sidebar.html in public/extensions/ are owned by
// another system and ARE NOT touched here.

const DRIVE_API   = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLD  = 'https://www.googleapis.com/upload/drive/v3';
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';

const READ_ONLY_MSG =
  'Google Drive adapter is read-only in v0.1 — see RABBIT_v0.6_post_build_notes.md for the write plan';

const readOnly = (name) => async () => {
  throw new Error(`[gdrive] ${name}() — ${READ_ONLY_MSG}`);
};

let cachedConfig = null;
let cachedTokens = null;
let lastError    = null;
let lastSyncAt   = null;

async function loadConfig() {
  cachedConfig = (await window.electronAPI?.rabbit?.readGdriveConfig?.()) || null;
  return cachedConfig;
}
async function loadTokens() {
  cachedTokens = (await window.electronAPI?.rabbit?.readGdriveTokens?.()) || null;
  return cachedTokens;
}
async function saveTokens(tokens) {
  cachedTokens = tokens;
  await window.electronAPI?.rabbit?.writeGdriveTokens?.(tokens);
}

async function refreshAccessToken() {
  if (!cachedConfig) await loadConfig();
  if (!cachedTokens) await loadTokens();
  if (!cachedConfig || !cachedTokens?.refreshToken) {
    throw new Error('[gdrive] missing OAuth config or refresh token');
  }
  const body = new URLSearchParams({
    client_id:     cachedConfig.clientId,
    client_secret: cachedConfig.clientSecret,
    refresh_token: cachedTokens.refreshToken,
    grant_type:    'refresh_token',
  });
  const res = await fetch(OAUTH_TOKEN, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`[gdrive] token refresh failed: HTTP ${res.status}`);
  const json = await res.json();
  const expiresAt = Date.now() + (json.expires_in || 3600) * 1000 - 30_000;
  await saveTokens({
    accessToken:  json.access_token,
    refreshToken: cachedTokens.refreshToken,
    expiresAt,
  });
  return json.access_token;
}

async function ensureAccessToken() {
  if (!cachedConfig) await loadConfig();
  if (!cachedTokens) await loadTokens();
  if (!cachedConfig || !cachedTokens) {
    throw new Error('[gdrive] not configured — see Settings → RABBIT');
  }
  if (!cachedTokens.accessToken || Date.now() >= (cachedTokens.expiresAt || 0)) {
    return refreshAccessToken();
  }
  return cachedTokens.accessToken;
}

async function driveFetch(url, init = {}) {
  const token = await ensureAccessToken();
  const headers = { ...(init.headers || {}), Authorization: `Bearer ${token}` };
  let res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    const retryToken = await refreshAccessToken();
    headers.Authorization = `Bearer ${retryToken}`;
    res = await fetch(url, { ...init, headers });
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json())?.error?.message || msg; } catch { /* ignore */ }
    lastError = msg;
    throw new Error(`[gdrive] ${msg}`);
  }
  lastError  = null;
  lastSyncAt = new Date();
  return res;
}

async function listChildren(parentId, query = '') {
  const q = encodeURIComponent(`'${parentId}' in parents and trashed=false${query ? ' and ' + query : ''}`);
  const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime,size)');
  const res = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=${fields}&pageSize=200`);
  return (await res.json()).files || [];
}

async function readDriveJson(fileId) {
  const res = await driveFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
  return res.json();
}

export function googleDriveAdapter() {
  return {
    mode: 'google_drive',

    async status() {
      try {
        const cfg = await loadConfig();
        if (!cfg?.rootFolderId) {
          return { online: false, lastSyncAt: null, error: 'no rabbit root folder configured' };
        }
        await loadTokens();
        if (!cachedTokens?.refreshToken) {
          return { online: false, lastSyncAt: null, error: 'not signed in' };
        }
        // Cheap probe — fetch root folder metadata.
        await driveFetch(`${DRIVE_API}/files/${cfg.rootFolderId}?fields=id,name`);
        return { online: true, lastSyncAt, error: null };
      } catch (err) {
        return { online: false, lastSyncAt, error: err.message || String(err) };
      }
    },

    // ── Reads ─────────────────────────────────────────────────
    async listProjects() {
      const cfg = await loadConfig();
      if (!cfg?.rootFolderId) throw new Error('[gdrive] no rabbit root folder configured');
      const projectFolders = await listChildren(
        cfg.rootFolderId,
        "mimeType='application/vnd.google-apps.folder'",
      );
      const out = [];
      for (const folder of projectFolders) {
        try {
          // Find project.json inside the folder.
          const inner = await listChildren(folder.id, "name='project.json'");
          if (inner.length === 0) continue;
          const bundle = await readDriveJson(inner[0].id);
          out.push({
            id:               folder.id,
            title:            bundle?.project?.title || folder.name,
            status:           bundle?.project?.status || 'active',
            status_tag:       bundle?.project?.status_tag || null,
            updated_at:       folder.modifiedTime,
            budget_total:     bundle?.project?.budget_total ?? null,
            budget_currency:  bundle?.project?.budget_currency || 'USD',
            client_name:      bundle?.project?.client_name || null,
            cover_image_url:  bundle?.project?.cover_image_url || null,
          });
        } catch {
          // Skip folders we can't parse — listProjects must not throw on a single bad row.
        }
      }
      return out;
    },

    async loadProject(projectId) {
      // projectId IS the Drive folder ID.
      const inner = await listChildren(projectId, "name='project.json'");
      if (inner.length === 0) throw new Error(`[gdrive] project.json missing in folder ${projectId}`);
      const bundle = await readDriveJson(inner[0].id);
      return {
        project:       bundle.project,
        phases:        bundle.phases || [],
        assets:        bundle.assets || [],
        tasks:         bundle.tasks || [],
        dependencies:  bundle.dependencies || [],
        taskLinks:     bundle.taskLinks || [],
        files:         bundle.files || [],
        assetVersions: bundle.assetVersions || [],
        comments:      bundle.comments || [],
        ingestionRuns: bundle.ingestionRuns || [],
        scenes:        bundle.scenes || [],
        shots:         bundle.shots || [],
        levels:        bundle.levels || [],
        experiences:   bundle.experiences || [],
        // Session 26. Drive is read-only, so the tree is whatever the bundle
        // was exported with — it renders, it is not built here.
        folders:       bundle.folders || [],
        // Session 17 (§6 #47): same omission as localServerAdapter — see the
        // comment there. Milestones reverted to [] on every reload.
        milestones:    bundle.milestones || [],
        // Post-overhaul S3a (0084): the three shot-list keys every adapter's
        // bundle carries. A bundle exported before shot lists existed has
        // none, which reads as [] — "no active list", so every scene and shot
        // shows (D10). Nothing is backfilled here: Drive is read-only, and
        // the Local Server's backfill-on-read belongs to the writer.
        shotLists:     bundle.shotLists || [],
        shotListItems: bundle.shotListItems || [],
        edits:         bundle.edits || [],
      };
    },

    async listFiles(projectId) {
      const bundle = await this.loadProject(projectId);
      return bundle.files || [];
    },

    // Session 26. Reads the exported bundle, exactly as listFiles does — not
    // a `() => []` stub, which would make an exported tree invisible while
    // loadProject was returning it, i.e. two answers to the same question.
    async listFolders(projectId) {
      const bundle = await this.loadProject(projectId);
      return bundle.folders || [];
    },

    // Post-overhaul S3a (0084). The reads answer from the exported bundle,
    // for listFolders' reason: a bare `() => []` would give a second answer
    // to the question loadProject already answers. For every bundle that
    // predates shot lists — every bundle Drive holds today — that answer is
    // []. The nine writes are with the other readOnly() stubs below.
    async listShotLists(projectId) {
      return (await this.loadProject(projectId)).shotLists;
    },
    async listShotListItems(projectId) {
      return (await this.loadProject(projectId)).shotListItems;
    },
    async listEdits(projectId) {
      return (await this.loadProject(projectId)).edits;
    },

    async downloadFile(file) {
      // file.storage_path is the Drive file ID for gdrive-stored files.
      if (!file?.storage_path) throw new Error('[gdrive] file has no storage_path (Drive file id)');
      const res = await driveFetch(`${DRIVE_API}/files/${file.storage_path}?alt=media`);
      return res.blob();
    },

    // ── Writes (all throw) ────────────────────────────────────
    createProject:        readOnly('createProject'),
    updateProject:        readOnly('updateProject'),
    deleteProject:        readOnly('deleteProject'),
    restoreProject:       readOnly('restoreProject'),
    listPhases:           readOnly('listPhases'),
    upsertPhase:          readOnly('upsertPhase'),
    deletePhase:          readOnly('deletePhase'),
    restorePhase:         readOnly('restorePhase'),
    listAssets:           readOnly('listAssets'),
    upsertAsset:          readOnly('upsertAsset'),
    deleteAsset:          readOnly('deleteAsset'),
    restoreAsset:         readOnly('restoreAsset'),
    listTasks:            readOnly('listTasks'),
    upsertTask:           readOnly('upsertTask'),
    deleteTask:           readOnly('deleteTask'),
    restoreTask:          readOnly('restoreTask'),
    upsertDependency:     readOnly('upsertDependency'),
    deleteDependency:     readOnly('deleteDependency'),
    upsertTaskLink:       readOnly('upsertTaskLink'),
    deleteTaskLink:       readOnly('deleteTaskLink'),
    uploadFile:           readOnly('uploadFile'),
    updateFile:           readOnly('updateFile'),
    deleteFile:           readOnly('deleteFile'),
    restoreFile:          readOnly('restoreFile'),
    upsertAssetVersion:   readOnly('upsertAssetVersion'),
    listAssetVersions:    readOnly('listAssetVersions'),
    createComment:        readOnly('createComment'),
    listComments:         readOnly('listComments'),
    listEditHistory:      async () => [],  // no capture in drive mode
    listProjectMembers:   async () => [],  // no roster in drive mode
    upsertProjectMember:  readOnly('upsertProjectMember'),
    removeProjectMember:  readOnly('removeProjectMember'),
    deleteComment:        readOnly('deleteComment'),
    restoreComment:       readOnly('restoreComment'),
    createIngestionRun:   readOnly('createIngestionRun'),
    updateIngestionRun:   readOnly('updateIngestionRun'),
    listIngestionChunks:  readOnly('listIngestionChunks'),
    upsertIngestionChunk: readOnly('upsertIngestionChunk'),
    updateChunk:          readOnly('updateChunk'),
    // Session 17 (§6 #49): READS return empty rather than throwing. The
    // rate-card hook calls listRateCards unconditionally on mount, so a
    // throw stub put a permanent red banner on every RABBIT view that
    // mounts it. Writes stay readOnly() — silencing those would be worse.
    listRateCards:        async () => [],  // no rate cards in drive mode
    upsertRateCard:       readOnly('upsertRateCard'),
    deleteRateCard:       readOnly('deleteRateCard'),
    restoreRateCard:      readOnly('restoreRateCard'),
    listRateCardEntries:  async () => [],  // no rate cards in drive mode
    upsertRateCardEntry:  readOnly('upsertRateCardEntry'),
    deleteRateCardEntry:  readOnly('deleteRateCardEntry'),
    upsertScene:          readOnly('upsertScene'),
    deleteScene:          readOnly('deleteScene'),
    upsertShot:           readOnly('upsertShot'),
    deleteShot:           readOnly('deleteShot'),
    upsertLevel:          readOnly('upsertLevel'),
    deleteLevel:          readOnly('deleteLevel'),
    upsertExperience:     readOnly('upsertExperience'),
    deleteExperience:     readOnly('deleteExperience'),
    upsertMilestone:      readOnly('upsertMilestone'),
    deleteMilestone:      readOnly('deleteMilestone'),
    // Post-overhaul S3a (0084) — shot lists, membership, edits. Loud, like
    // every write here: a silent no-op would report a list as created, made
    // active or archived when nothing changed anywhere.
    upsertShotList:       readOnly('upsertShotList'),
    replaceShotListItems: readOnly('replaceShotListItems'),
    // S3a review round 1 (addendum A): the membership deltas the provider
    // writes instead of whole-list replaces; round 2 (R2-2): the reorder.
    upsertShotListItems:  readOnly('upsertShotListItems'),
    repositionShotListItems: readOnly('repositionShotListItems'),
    deleteShotListItems:  readOnly('deleteShotListItems'),
    upsertEdit:           readOnly('upsertEdit'),
    setActiveShotList:    readOnly('setActiveShotList'),
    archiveShotList:      readOnly('archiveShotList'),
    archiveEdit:          readOnly('archiveEdit'),
    // Session 26 — folders. The READ is implemented above, beside listFiles.
    // These three are writes and stay loud: a silent no-op would report a
    // folder as created when nothing exists anywhere.
    ensureProjectFolders: readOnly('ensureProjectFolders'),
    ensureEntityFolder:   readOnly('ensureEntityFolder'),
    deleteFolder:         readOnly('deleteFolder'),
    writeProjectManifest: readOnly('writeProjectManifest'),
    writeProjectRates:    readOnly('writeProjectRates'),

    // No realtime on Drive.
    subscribeProjectChanges: () => () => {},
  };
}
