const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } = require('electron');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const sharp = require('sharp');
const { loadEnv } = require('./env.cjs');
const { initMainSentry } = require('./sentry.cjs');
const { resolveContainedFilePath, isPathInside, checkFolderRootShape } = require('./pathContainment.cjs');
// Session 40: the still-frame decoder for codecs a browser cannot read. Its
// binary is optional and its absence is a first-class state, never a crash —
// see electron/ffmpeg.cjs and resources/ffmpeg/README.md.
const ffmpeg = require('./ffmpeg.cjs');

// Handle Squirrel.Windows startup events (install, update, uninstall)
if (require('electron-squirrel-startup')) app.quit();

// Load env BEFORE anything reads process.env. In dev this reads
// .env.development from the repo root; packaged builds read
// userData/env.json so operators can swap envs without a rebuild.
const REPO_ROOT = path.resolve(__dirname, '..');
loadEnv(app, REPO_ROOT);

// Main-process Sentry — must come after loadEnv so the DSN is present.
const _mainSentry = initMainSentry();

// Expose a main-process test-exception path for the Session 1 verification.
// Call it from a DevTools console via: await window.electronAPI.sentryTest?.()
ipcMain.handle('wilson:sentry-test', () => {
  try {
    throw new Error('[wilson-main-test] ' + new Date().toISOString());
  } catch (err) {
    if (_mainSentry.enabled) _mainSentry.Sentry.captureException(err);
    return { sent: _mainSentry.enabled, error: err.message };
  }
});

// ═══════════════════════════════════════════════════════════════════
//  O.T.T.E.R. DATA DIRECTORY — stored in Electron userData
// ═══════════════════════════════════════════════════════════════════
function getDataDir() {
  const dir = path.join(app.getPath('userData'), 'otter-data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSoftwareDir() {
  const dir = path.join(getDataDir(), 'software');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ═══════════════════════════════════════════════════════════════════
//  RABBIT DATA DIRECTORY — separate root from otter-data
// ═══════════════════════════════════════════════════════════════════
function getRabbitDataDir() {
  const dir = path.join(app.getPath('userData'), 'rabbit-data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Folders the USER picked through the OS dialog this session (lowercased
// resolved paths). The relink routes only accept folders from here or from
// inside the project's own roots — a body-supplied path is never enough
// (Session 14; see isUserAuthorizedRelinkDir).
const userAuthorizedDirs = new Set();

// Session 34: the workspace storage root (workspace_storage.root_path when
// mode = 'byos'). Main has no Supabase client, so the signed-in renderer
// pushes it over rabbit:set-workspace-root after loading workspace storage
// and clears it on sign-out. MEMORY-ONLY on purpose: a persisted copy would
// outlive the session that justified it and would need tenancy checks main
// cannot perform. Before the first push (or signed out), every resolver
// falls through to the per-machine defaultRootDir exactly as before.
let workspaceRootDir = null;

function readJSON(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return fallback; }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Title-Case-Hyphenated slug for project/asset/file folder names.
// "Hero Film 2026" → "Hero-Film-2026"
function fileSlugify(str) {
  return str.trim()
    .replace(/[^a-zA-Z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('-');
}

// ── Managed-files config ────────────────────────────────────
// Stores { defaultRootDir: string|null } at rabbit-data/files-config.json.
// Individual projects can override with their own folder_root.
function getFilesConfigPath() { return path.join(getRabbitDataDir(), 'files-config.json'); }
function readFilesConfig() { return readJSON(getFilesConfigPath(), { defaultRootDir: null }); }
function writeFilesConfig(cfg) { writeJSON(getFilesConfigPath(), cfg); }

// Session 34: the ONE definition of "which configured root does this machine
// resolve under" — workspace root first, then the per-machine default
// (resolution order: project folder_root → workspace root_path → machine
// defaultRootDir → internal rabbit-data; the first hop lives at each call
// site because it is per-project). The workspace root deliberately does NOT
// fall back to the machine default when unreachable: a machine that silently
// retargets its own disk splits the company's storage worse than a visible
// failure does.
function resolveConfiguredRootDir() {
  return workspaceRootDir || readFilesConfig().defaultRootDir || null;
}

// Session 35 (TPN-NET-015): the ONE decision about whether a candidate
// projects.folder_root may be stored. folder_root arrives in the request body
// of an UNAUTHENTICATED local API that answers any local origin (cors()), and
// everything under it is then treated as project content — built by
// ensureProjectFolders, written by uploads, read and unlinked by relink. The
// S14 rule ("a body-picked baseDir would let a drive-by request point a
// project's files at the user's Documents") applies verbatim; this route
// never got the guard until now.
//
// The rule, per Audrey (2026-08-05, NETWORK_STORAGE_DESIGN.md §5a2):
//   * A workspace root is configured → the project folder must sit STRICTLY
//     INSIDE it. Not the machine default, not a dialog pick outside it —
//     "this stops anyone from breaking it" only holds if the admin's drive
//     is the boundary for everybody.
//   * No workspace root → the per-machine model stands: inside the machine
//     defaultRootDir, or inside a folder the user actually picked through
//     the OS dialog this session (userAuthorizedDirs — the S14 mechanism).
//     A body-only path is never enough.
// Returns { resolved } (canonical form) or { error } with a sentence.
// Cloud mode has the same rule in fn_project_folder_root_guard (0049) —
// each layer refuses on its own (S34: refusals are enforced in depth).
function folderRootRefusal(candidate) {
  const shape = checkFolderRootShape(candidate);
  if (!shape.ok) return { error: shape.error };
  const resolved = shape.resolved;
  if (workspaceRootDir) {
    const rootCanon = workspaceRootDir.toLowerCase();
    if (resolved.toLowerCase() === rootCanon) {
      return { error: 'the project folder cannot be the workspace storage drive itself — pick a folder inside it' };
    }
    if (!isPathInside(workspaceRootDir, resolved)) {
      return { error: `the project folder must be inside the workspace storage drive (${workspaceRootDir})` };
    }
    return { resolved };
  }
  const dflt = readFilesConfig().defaultRootDir;
  if (dflt && isPathInside(dflt, resolved)) return { resolved };
  for (const dir of userAuthorizedDirs) {
    if (isPathInside(dir, resolved)) return { resolved };
  }
  return { error: 'the project folder must be inside the configured storage folder, or picked through the app' };
}

// Next version number for a file within an asset: finds max existing version
// and returns max+1. Returns 1 if no prior versions exist.
function getNextVersion(managedFiles, fileName, assetId, shotId, sceneId) {
  const existing = (managedFiles || []).filter(f => {
    if (f.file_name !== fileName || f.deleted_at) return false;
    if (sceneId) return f.scene_id === sceneId;
    if (shotId) return f.shot_id === shotId;
    return f.asset_id === assetId;
  });
  if (existing.length === 0) return 1;
  return Math.max(...existing.map(f => f.version || 0)) + 1;
}

// Format version number as zero-padded 3-digit string: 1 → "v001"
function formatVersion(n) { return 'v' + String(n).padStart(3, '0'); }

// Thumbnail cache directory
function getThumbCacheDir() {
  const dir = path.join(getRabbitDataDir(), 'thumbnails');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Check if a file extension is an image we can thumbnail
const THUMB_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif', '.bmp', '.avif']);
function isThumbableExt(ext) { return THUMB_EXTENSIONS.has((ext || '').toLowerCase()); }

// ── Session 40: video ────────────────────────────────────────────────────────
//
// Deliberately WIDER than the set Chromium can decode. This list answers "is
// this row a video at all" — which is the question the stream route, the
// thumbnail route's ffmpeg arm and the renderer's fallback all ask. Whether the
// bytes are decodable is answered by the decoder that actually tries, never by
// an extension: a .mov holds ProRes *or* H.264 and nothing about the name says
// which (§5f, "how to detect each one honestly").
//
// The professional half — .mxf, .r3d, .ari, .braw, .dnx — is here because those
// are precisely the files ffmpeg exists to serve. They are also §5f's pre-upload
// heuristic list, and the renderer carries the same set; videoThumbnails.js is
// the ONE definition on that side and thumbnails.test.js asserts the two agree.
const VIDEO_EXTENSIONS = new Set([
  // ⚠️ '.ts' IS DELIBERATELY ABSENT — MPEG transport stream vs TypeScript
  // source, and this tool sees far more of the latter. See the renderer copy
  // in storage/videoThumbnails.js, which the test pins this against.
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.mpg',
  '.mpeg', '.m2v', '.mts', '.m2ts',
  '.mxf', '.r3d', '.ari', '.arri', '.braw', '.dnx', '.dnxhd', '.dnxhr',
]);
function isVideoExt(ext) { return VIDEO_EXTENSIONS.has((ext || '').toLowerCase()); }

// 🚨 Session 40: never echo a client-supplied Content-Type from a route this
// app's own renderer shares an origin with. `mime_type` is written verbatim
// from req.body, and text/html served from 127.0.0.1:<port> executes as script
// on WILSON's origin. Only obvious media passes; everything else becomes an
// opaque download, which a <video> ignores and a browser cannot run.
const SAFE_MEDIA_TYPE_RE = /^(video|audio|image)\/[a-z0-9][a-z0-9.+-]*$/;
function safeMediaContentType(mime) {
  const m = String(mime || '').trim().toLowerCase();
  // image/svg+xml is scriptable in its own right, so it is excluded even though
  // it matches the media shape.
  if (m === 'image/svg+xml') return 'application/octet-stream';
  return SAFE_MEDIA_TYPE_RE.test(m) ? m : 'application/octet-stream';
}

// 🚨 Session 40: the managed-file id is CLIENT-CHOSEN on create
// (`id: req.body.id || uuidv4()`), and the thumbnail cache is ONE flat
// directory shared with the asset/scene/shot/level/experience caches, which use
// the un-namespaced keys `asset-<id>.jpg`, `scene-<id>.jpg` and so on. So a
// caller could create a managed row with id `asset-<a real asset uuid>` and
// then POST arbitrary JPEG bytes to it, permanently replacing that asset's
// thumbnail — those routes serve the cached file before ever consulting the
// source. resolveContainedFilePath stops traversal but not COLLISION: both
// namespaces are the same folder. Requiring a bare UUID closes it without
// touching the existing cache layout. Found by the pre-push adversarial review.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The file extension becomes part of stored_name, which is joined under the
// project root — so `/../../..` in it walks out of the project folder. Every
// legitimate extension is a dot and a few alphanumerics.
function safeExtension(ext) {
  const e = String(ext || '').trim().toLowerCase();
  if (!e) return '';
  return /^\.[a-z0-9]{1,12}$/.test(e) ? e : '';
}

// ── Session 40: one ffmpeg run per thumbnail, and never a half-written one ───
//
// 🚨 THE PARTIAL FILE IS THE DEFECT THAT WOULD HAVE SHIPPED. Every caller of
// the GET route serves `thumbPath` straight back when it EXISTS — so a run that
// fails after creating the output leaves a zero-byte or truncated JPEG that is
// then served, cached and never regenerated. The unlink is what makes a failed
// decode retry next time instead of pinning a broken tile forever.
//
// 🚨 AND ONE RUN AT A TIME PER OUTPUT. A grid renders the same tile from more
// than one place, React re-renders, and a user can scroll back — all of which
// issue concurrent GETs for the same key. Two ffmpeg processes writing one path
// with `-y` means one truncates the file the other is serving. Decoding a frame
// out of a 5 GB ProRes file is also the most expensive thing this server does,
// so sharing the in-flight promise is worth it on cost alone.
// 🚨 AND A FAILURE IS REMEMBERED FOR A WHILE (adversarial review). Nothing
// recorded that a file is undecodable, so a folder of .r3d or .braw respawned
// probe + extract for EVERY visible tile on EVERY mount of the Files view —
// toggling table/gallery, scrolling back, reopening the popup. Each of those
// costs up to the full deadline. The TTL is short enough that installing
// ffmpeg, or fixing a NAS that was offline, is picked up without a restart.
const VIDEO_THUMB_FAIL_TTL_MS = 5 * 60_000;
const videoThumbFailedAt = new Map();

const videoThumbInFlight = new Map();
function generateVideoThumbOnce(srcPath, thumbPath) {
  const failedAt = videoThumbFailedAt.get(thumbPath);
  if (failedAt !== undefined && Date.now() - failedAt < VIDEO_THUMB_FAIL_TTL_MS) {
    return Promise.resolve({ ok: false, reason: 'no_frame_cached' });
  }
  const existing = videoThumbInFlight.get(thumbPath);
  if (existing) return existing;
  const run = (async () => {
    const out = await ffmpeg.extractFrame({ input: srcPath, output: thumbPath, maxEdge: 256 });
    if (!out.ok) {
      // extractFrame now writes to `<output>.part` and renames, so `thumbPath`
      // should never exist after a failure — this is the belt to that braces,
      // and cheap. `ffmpeg_missing` is NOT cached: it is a machine state the
      // user can change by dropping a binary in, not a property of this file.
      try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch { /* next run overwrites */ }
      if (out.reason !== 'ffmpeg_missing') {
        if (videoThumbFailedAt.size > 500) {
          const cutoff = Date.now() - VIDEO_THUMB_FAIL_TTL_MS;
          for (const [k, t] of videoThumbFailedAt) if (t < cutoff) videoThumbFailedAt.delete(k);
        }
        videoThumbFailedAt.set(thumbPath, Date.now());
      }
    } else {
      videoThumbFailedAt.delete(thumbPath);
    }
    return out;
  })().finally(() => videoThumbInFlight.delete(thumbPath));
  videoThumbInFlight.set(thumbPath, run);
  return run;
}

// ═══════════════════════════════════════════════════════════════════
//  DEFAULT PET DATA
// ═══════════════════════════════════════════════════════════════════
function defaultPet() {
  return {
    name: 'Ollie', gender: Math.random() < 0.5 ? 'male' : 'female',
    breed: null, form: 'egg',
    hunger: 0, happiness: 0,
    state: 'content', difficulty: 'medium', petMode: true,
    eggPetCount: 0, eggHatchThreshold: Math.floor(Math.random() * 3) + 2,
    bornAt: null, evolvedAt: null, diedAt: null,
    lastFedAt: null, lastPettedAt: null, lastSleptAt: null, sleepingSince: null,
    interactionCount: 0, lastUpdatedAt: new Date().toISOString(),
    feedback: [], totalThumbsUp: 0, totalThumbsDown: 0
  };
}

// ═══════════════════════════════════════════════════════════════════
//  EXPRESS SERVER WITH O.T.T.E.R. API ROUTES
// ═══════════════════════════════════════════════════════════════════
function startLocalServer(distPath) {
  return new Promise((resolve, reject) => {
    const expressApp = express();
    expressApp.use(cors());
    expressApp.use(express.json({ limit: '50mb' }));

    // ── Pet endpoints ──
    expressApp.get('/api/pet', (req, res) => {
      const petPath = path.join(getDataDir(), 'pet.json');
      let pet = readJSON(petPath);
      if (!pet) { pet = defaultPet(); writeJSON(petPath, pet); }
      res.json(pet);
    });

    expressApp.post('/api/pet', (req, res) => {
      writeJSON(path.join(getDataDir(), 'pet.json'), req.body);
      res.json({ ok: true });
    });

    // 🚨 `POST /api/pet/reset` AND `POST /api/pet/new-egg` ARE GONE — Phase 3,
    // 2026-08-12. Both were verified callerless across all of src/ and
    // electron/ before removal:
    //
    //   * /api/pet/reset had NEVER had one. It is on the repo's standing
    //     no-caller list (SYSTEMS_HANDBOOK §17, MASTER_PLAN). App.jsx's
    //     handlePetReset clears the counters on the pet object and persists it
    //     through savePet(), which is the only writer that routes by ACCOUNT.
    //
    //   * /api/pet/new-egg was reached only by localData.js's newPetEgg(),
    //     removed in the same change. It was the DESKTOP half of Audrey's bug:
    //     it answered "is this pet a ghost?" from the per-device pet.json,
    //     which since S31 is a cache and not the authority — and it demanded
    //     form === 'ghost' while SettingsPage offers the button for a corpse
    //     too. Eligibility now lives in src/lib/petLifecycle.js and is decided
    //     against the pet the app is actually rendering.
    //
    // 🚨 A per-device route MUST NOT arbitrate an account-scoped decision. That
    // is the same predicate trap as gating a STORE on `window.electronAPI`,
    // which is true for the desktop app in cloud mode.
    //
    // GET/POST /api/pet stay: they are the local cache, and savePetData/loadPet
    // still use them for the signed-out and local-only paths.

    // ── Software/Course endpoints ──
    expressApp.get('/api/software', (req, res) => {
      const swDir = getSoftwareDir();
      const folders = fs.readdirSync(swDir).filter(f => fs.statSync(path.join(swDir, f)).isDirectory());
      const list = folders.map(slug => {
        const meta = readJSON(path.join(swDir, slug, '_meta.json'), {});
        const subjDir = path.join(swDir, slug, 'subjects');
        let subjectCount = 0;
        if (fs.existsSync(subjDir)) {
          subjectCount = fs.readdirSync(subjDir).filter(f => f.endsWith('.json')).length;
        }
        return { slug, name: meta.name || slug, type: meta.type || 'software', skill_level: meta.skill_level || 'beginner', subject_count: subjectCount, created_at: meta.created_at };
      });
      list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      res.json(list);
    });

    expressApp.post('/api/software', (req, res) => {
      const { name, type, skill_level } = req.body;
      const slug = slugify(name);
      const swPath = path.join(getSoftwareDir(), slug);
      if (!fs.existsSync(swPath)) fs.mkdirSync(swPath, { recursive: true });
      if (!fs.existsSync(path.join(swPath, 'subjects'))) fs.mkdirSync(path.join(swPath, 'subjects'));
      const meta = { name, type: type || 'software', skill_level: skill_level || 'beginner', created_at: new Date().toISOString() };
      writeJSON(path.join(swPath, '_meta.json'), meta);
      if (!fs.existsSync(path.join(swPath, '_hotkeys.json'))) writeJSON(path.join(swPath, '_hotkeys.json'), { categories: [] });
      if (!fs.existsSync(path.join(swPath, '_functions.json'))) writeJSON(path.join(swPath, '_functions.json'), { categories: [] });
      if (!fs.existsSync(path.join(swPath, '_nodes.json'))) writeJSON(path.join(swPath, '_nodes.json'), { categories: [] });
      if (!fs.existsSync(path.join(swPath, '_progress.json'))) writeJSON(path.join(swPath, '_progress.json'), { completed_lessons: [], last_accessed: null });
      // No per-course _quiz-history.json any more (S30): quiz history is one
      // personal file at the otter-data root, because a quiz can span courses.
      // Existing per-course files are left alone — all empty, and deleting a
      // user's files to tidy up a rename is never worth it.
      if (!fs.existsSync(path.join(swPath, '_references.json'))) writeJSON(path.join(swPath, '_references.json'), { urls: [] });
      res.json({ slug, ...meta });
    });

    expressApp.get('/api/software/:slug', (req, res) => {
      const meta = readJSON(path.join(getSoftwareDir(), req.params.slug, '_meta.json'));
      if (!meta) return res.status(404).json({ error: 'Not found' });
      res.json({ slug: req.params.slug, ...meta });
    });

    expressApp.delete('/api/software/:slug', (req, res) => {
      const swPath = path.join(getSoftwareDir(), req.params.slug);
      if (fs.existsSync(swPath)) fs.rmSync(swPath, { recursive: true, force: true });
      res.json({ ok: true });
    });

    // ── Subject ordering utility ──
    // Content-aware curriculum sort: analyzes title + skill_level to determine
    // a pedagogically correct order. Returns a numeric score (lower = earlier).
    // Score = (difficultyTier * 100) + topicGroup
    // This ensures difficulty is the primary axis, topic grouping is secondary.
    function getCurriculumScore(title, skillLevel) {
      const t = (title || '').toLowerCase();

      // ── Difficulty tier (primary axis, 0-3) ──
      let tier;
      if (/\b(general basics|interface|layout|navigation|getting.?started|workspace|overview)\b/.test(t)) {
        tier = 0; // Absolute foundations — first thing a new user needs
      } else if (/\b(basics?|fundamenta|essentia|introduction|intro to)\b/.test(t) || /^basic\b/i.test(t)) {
        tier = 1; // Beginner-level subjects
      } else if (/\b(intermediate|principles?|techniques)\b/.test(t) || skillLevel === 'intermediate') {
        tier = 2; // Intermediate
      } else if (/\b(advanced|complex|optimization|reusab|dynamic)\b/.test(t) || skillLevel === 'advanced') {
        tier = 3; // Advanced
      } else {
        tier = skillLevel === 'beginner' ? 1 : skillLevel === 'advanced' ? 3 : 2;
      }

      // ── Topic group (secondary axis, 0-8) ──
      // Orders topics in a natural curriculum flow within each difficulty tier.
      // NOTE: No trailing \b — patterns use stems to match plurals/gerunds
      // (e.g., "model" matches "modeling", "light" matches "lighting")
      let group = 5; // default middle
      if (/\b(general|basics of|overview|interface|layout|workspace|navigation)/.test(t)) group = 0;
      else if (/\b(model|mesh|topolog|sculpt|edit.?mode|object.?mode|extrude)/.test(t)) group = 1;
      else if (/\b(curve|spline|nurbs|path\b)/.test(t)) group = 2;
      else if (/\b(material|shad|textur|uv |unwrap)/.test(t)) group = 3;
      else if (/\b(light|render|camera|composit)/.test(t)) group = 4;
      else if (/\b(animat|keyframe|rig\b|bone|armature|timeline|motion)/.test(t)) group = 5;
      else if (/\b(node|procedur|geometry.?node|shader.?node|attribut|data.?flow)/.test(t)) group = 6;
      else if (/\b(instanc|distribut|scatter|particle)/.test(t)) group = 7;
      else if (/\b(simulat|physic|dynamic|fluid|cloth|rigid)/.test(t)) group = 8;
      // Coding language topics
      else if (/\b(variable|data.?type|syntax|operator|\btype)/.test(t)) group = 1;
      else if (/\b(control.?flow|loop|condition|if |while|for )/.test(t)) group = 2;
      else if (/\b(function|method|class\b|object|module|scope)/.test(t)) group = 3;
      else if (/\b(array|list|dict|collect|string|data.?struct)/.test(t)) group = 4;
      else if (/\b(file|i\/o|input|output|stream)/.test(t)) group = 6;
      else if (/\b(error|exception|debug|test)/.test(t)) group = 7;
      else if (/\b(api|library|framework|package|import)/.test(t)) group = 8;

      return tier * 100 + group;
    }

    function renumberSubjects(softwareSlug) {
      const subjDir = path.join(getSoftwareDir(), softwareSlug, 'subjects');
      if (!fs.existsSync(subjDir)) return [];
      const files = fs.readdirSync(subjDir).filter(f => f.endsWith('.json'));
      const subjects = files.map(f => {
        const data = readJSON(path.join(subjDir, f), {});
        return { fileName: f, slug: f.replace('.json', ''), data };
      });
      // Always apply content-aware curriculum sort
      subjects.sort((a, b) => {
        const sa = getCurriculumScore(a.data.title, a.data.skill_level);
        const sb = getCurriculumScore(b.data.title, b.data.skill_level);
        if (sa !== sb) return sa - sb;
        return (a.data.title || '').localeCompare(b.data.title || '');
      });
      // Reassign sequential 1-indexed order
      subjects.forEach((s, i) => {
        s.data.subject_order = i + 1;
        writeJSON(path.join(subjDir, s.fileName), s.data);
      });
      return subjects.map(s => ({
        slug: s.slug, title: s.data.title || s.slug, description: s.data.description || '',
        skill_level: s.data.skill_level || 'beginner', is_stub: s.data.is_stub || false,
        subject_order: s.data.subject_order
      }));
    }

    // ── Subject endpoints ──
    expressApp.get('/api/software/:slug/subjects', (req, res) => {
      const subjDir = path.join(getSoftwareDir(), req.params.slug, 'subjects');
      if (!fs.existsSync(subjDir)) return res.json([]);
      // Always use curriculum-aware sort to ensure correct ordering
      const sorted = renumberSubjects(req.params.slug);
      res.json(sorted);
    });

    expressApp.post('/api/software/:slug/subjects', (req, res) => {
      const subjDir = path.join(getSoftwareDir(), req.params.slug, 'subjects');
      if (!fs.existsSync(subjDir)) fs.mkdirSync(subjDir, { recursive: true });
      const subSlug = req.body.slug || slugify(req.body.title);
      // Auto-assign subject_order if not provided
      if (req.body.subject_order == null) {
        const files = fs.readdirSync(subjDir).filter(f => f.endsWith('.json'));
        let maxOrder = 0;
        for (const f of files) {
          const d = readJSON(path.join(subjDir, f), {});
          if (d.subject_order != null && d.subject_order > maxOrder) maxOrder = d.subject_order;
        }
        req.body.subject_order = maxOrder + 1;
      }
      writeJSON(path.join(subjDir, `${subSlug}.json`), req.body);
      res.json({ slug: subSlug, ...req.body });
    });

    expressApp.get('/api/software/:slug/subjects/:sub', (req, res) => {
      const data = readJSON(path.join(getSoftwareDir(), req.params.slug, 'subjects', `${req.params.sub}.json`));
      if (!data) return res.status(404).json({ error: 'Not found' });
      res.json({ slug: req.params.sub, ...data });
    });

    // Session 30: the route the Validator's "Accept Fix" has always called and
    // that has never existed here. Validator.jsx:444 issues a PUT after
    // rewriting one lesson's content; against this server it 404ed, and because
    // the call site did not check res.ok the fix was reported APPLIED while
    // nothing was written. Cloud mode has mapped this PUT onto subject.save
    // since Session 10 (otterRoutes.js:166), so adding it here is parity, not
    // a new feature — Audrey's six local courses are on this backend.
    //
    // subject_order is preserved from the stored file when the body omits it:
    // the Validator PUTs back the object it GET'd, which carries the order, but
    // a caller that sends only content must not silently move the subject to
    // the end of the curriculum.
    expressApp.put('/api/software/:slug/subjects/:sub', (req, res) => {
      const subjDir = path.join(getSoftwareDir(), req.params.slug, 'subjects');
      if (!fs.existsSync(subjDir)) return res.status(404).json({ error: 'Not found' });
      const filePath = path.join(subjDir, `${req.params.sub}.json`);
      const existing = readJSON(filePath);
      if (!existing) return res.status(404).json({ error: 'Not found' });

      // 🚨 This route OVERWRITES the whole subject file, so an empty body is a
      // lesson-shredder: `{...undefined}` and Express's own no-body default
      // both give `{}`, and writing that destroys every section in the course.
      // A PUT that says nothing must say nothing, not erase.
      const body = { ...(req.body || {}) };
      if (!Array.isArray(body.sections)) {
        return res.status(400).json({
          error: 'a subject PUT must carry its sections array — refusing to overwrite with an empty document',
        });
      }

      delete body.slug; // the URL is authoritative; a stray slug must not fork the file
      if (body.subject_order == null) body.subject_order = existing.subject_order;
      writeJSON(filePath, body);
      res.json({ slug: req.params.sub, ...body });
    });

    expressApp.delete('/api/software/:slug/subjects/:sub', (req, res) => {
      const filePath = path.join(getSoftwareDir(), req.params.slug, 'subjects', `${req.params.sub}.json`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      // Renumber remaining subjects to close gaps
      const updated = renumberSubjects(req.params.slug);
      res.json({ ok: true, subjects: updated });
    });

    // Renumber all subjects (called after undo/redo/import)
    expressApp.post('/api/software/:slug/subjects/renumber', (req, res) => {
      const updated = renumberSubjects(req.params.slug);
      res.json(updated);
    });

    // Reorder subjects by explicit slug order (called when AI determines placement)
    expressApp.post('/api/software/:slug/subjects/reorder', (req, res) => {
      const { orderedSlugs } = req.body;
      if (!Array.isArray(orderedSlugs)) return res.status(400).json({ error: 'orderedSlugs array required' });
      const subjDir = path.join(getSoftwareDir(), req.params.slug, 'subjects');
      if (!fs.existsSync(subjDir)) return res.json([]);
      // Read all subjects
      const files = fs.readdirSync(subjDir).filter(f => f.endsWith('.json'));
      const subjectMap = {};
      for (const f of files) {
        const slug = f.replace('.json', '');
        subjectMap[slug] = readJSON(path.join(subjDir, f), {});
      }
      // Assign order based on orderedSlugs position
      let order = 1;
      for (const slug of orderedSlugs) {
        if (subjectMap[slug]) {
          subjectMap[slug].subject_order = order++;
          writeJSON(path.join(subjDir, `${slug}.json`), subjectMap[slug]);
        }
      }
      // Any subjects not in orderedSlugs get appended at the end
      for (const slug of Object.keys(subjectMap)) {
        if (!orderedSlugs.includes(slug)) {
          subjectMap[slug].subject_order = order++;
          writeJSON(path.join(subjDir, `${slug}.json`), subjectMap[slug]);
        }
      }
      // Return the sorted list
      const result = Object.entries(subjectMap).map(([slug, data]) => ({
        slug, title: data.title || slug, description: data.description || '',
        skill_level: data.skill_level || 'beginner', is_stub: data.is_stub || false,
        subject_order: data.subject_order
      }));
      result.sort((a, b) => a.subject_order - b.subject_order);
      res.json(result);
    });

    // ── Hotkeys endpoints ──
    expressApp.get('/api/software/:slug/hotkeys', (req, res) => {
      const data = readJSON(path.join(getSoftwareDir(), req.params.slug, '_hotkeys.json'), { categories: [] });
      res.json(data);
    });

    expressApp.post('/api/software/:slug/hotkeys/merge', (req, res) => {
      const filePath = path.join(getSoftwareDir(), req.params.slug, '_hotkeys.json');
      const existing = readJSON(filePath, { categories: [] });
      const incoming = req.body.categories || [];
      const normalizeCat = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      for (const inCat of incoming) {
        const catName = inCat.category || inCat.name || 'General';
        const inShortcuts = inCat.shortcuts || inCat.hotkeys || [];
        const catNorm = normalizeCat(catName);
        let existCat = existing.categories.find(c => normalizeCat(c.category) === catNorm);
        if (!existCat) { existCat = { category: catName, shortcuts: [] }; existing.categories.push(existCat); }
        for (const hk of inShortcuts) {
          const actionNorm = (hk.action || '').toLowerCase().trim();
          if (!existCat.shortcuts.some(h => (h.action || '').toLowerCase().trim() === actionNorm)) existCat.shortcuts.push(hk);
        }
      }
      writeJSON(filePath, existing);
      res.json(existing);
    });

    // ── Functions endpoints ──
    expressApp.get('/api/software/:slug/functions', (req, res) => {
      const data = readJSON(path.join(getSoftwareDir(), req.params.slug, '_functions.json'), { categories: [] });
      res.json(data);
    });

    expressApp.post('/api/software/:slug/functions/merge', (req, res) => {
      const filePath = path.join(getSoftwareDir(), req.params.slug, '_functions.json');
      const existing = readJSON(filePath, { categories: [] });
      const incoming = req.body.categories || [];
      for (const inCat of incoming) {
        let existCat = existing.categories.find(c => c.name === inCat.name);
        if (!existCat) { existCat = { name: inCat.name, functions: [] }; existing.categories.push(existCat); }
        for (const fn of (inCat.functions || [])) {
          if (!existCat.functions.some(f => f.name === fn.name)) existCat.functions.push(fn);
        }
      }
      writeJSON(filePath, existing);
      res.json(existing);
    });

    // ── Nodes endpoints ──
    // Auto-migrate old { categories: [] } format → new { systems: [] } format
    function migrateNodesData(data) {
      if (data.systems) return data; // already new format
      if (!data.categories || data.categories.length === 0) return { systems: [] };
      // Group old categories into systems by detecting system-like category names
      const systemMap = {};
      for (const cat of data.categories) {
        const catName = cat.category || 'General';
        // Infer system from category name patterns
        let system = 'General';
        const lower = catName.toLowerCase();
        if (lower.includes('shader') || lower.includes('texture') || lower.includes('material') || lower.includes('shading')) system = 'Shader Nodes';
        else if (lower.includes('geometry') || lower.includes('instanc') || lower.includes('distribut') || lower.includes('primitiv') || lower.includes('transform') || lower.includes('mesh') || lower.includes('curve') || lower.includes('point')) system = 'Geometry Nodes';
        else if (lower.includes('composit')) system = 'Compositing Nodes';
        if (!systemMap[system]) systemMap[system] = [];
        systemMap[system].push(cat);
      }
      return { systems: Object.entries(systemMap).map(([system, categories]) => ({ system, categories })) };
    }

    expressApp.get('/api/software/:slug/nodes', (req, res) => {
      const raw = readJSON(path.join(getSoftwareDir(), req.params.slug, '_nodes.json'), { systems: [] });
      const data = migrateNodesData(raw);
      res.json(data);
    });

    expressApp.post('/api/software/:slug/nodes/merge', (req, res) => {
      const filePath = path.join(getSoftwareDir(), req.params.slug, '_nodes.json');
      const raw = readJSON(filePath, { systems: [] });
      const existing = migrateNodesData(raw);
      const incoming = req.body.categories || [];
      const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

      for (const inCat of incoming) {
        const systemName = inCat.system || 'General';
        const catName = inCat.category || 'General';
        const inNodes = inCat.nodes || [];
        const sysNorm = norm(systemName);
        const catNorm = norm(catName);

        // Find or create system
        let sys = existing.systems.find(s => norm(s.system) === sysNorm);
        if (!sys) { sys = { system: systemName, categories: [] }; existing.systems.push(sys); }

        // Find or create category within system
        let existCat = sys.categories.find(c => norm(c.category) === catNorm);
        if (!existCat) { existCat = { category: catName, nodes: [] }; sys.categories.push(existCat); }

        // Merge nodes by name
        for (const node of inNodes) {
          const normName = (node.name || '').toLowerCase().trim();
          if (!existCat.nodes.some(n => (n.name || '').toLowerCase().trim() === normName)) {
            existCat.nodes.push(node);
          }
        }
      }
      writeJSON(filePath, existing);
      res.json(existing);
    });

    // ── Progress endpoints ──
    expressApp.get('/api/software/:slug/progress', (req, res) => {
      const data = readJSON(path.join(getSoftwareDir(), req.params.slug, '_progress.json'), { completed_lessons: [], last_accessed: null });
      res.json(data);
    });

    expressApp.post('/api/software/:slug/progress', (req, res) => {
      writeJSON(path.join(getSoftwareDir(), req.params.slug, '_progress.json'), req.body);
      res.json({ ok: true });
    });

    // ── Quiz history — ONE personal history, not one per course ──
    //
    // Session 30. The per-course routes that were here
    // (/api/software/:slug/quiz-history, backed by <course>/_quiz-history.json)
    // are gone, and they never lost anything: MEASURED 2026-08-05, all six of
    // Audrey's course folders held `attempts: []` and always had. 0022's own
    // comment said the same about the cloud column — "seeded and read but has
    // no writer". Nothing ever called the writer on either backend.
    //
    // The shape had to change before it could get one. A quiz is built from
    // whatever courses the user ticks (Otter.jsx quizSelections), so one
    // attempt can cover several courses and has no single course to be filed
    // under. Audrey, 2026-08-05: "lets have one personal quiz history but wipe
    // it every month."
    //
    // Lives at the otter-data ROOT, beside `software/`, because it belongs to
    // the person rather than to any course — and so deleting a course cannot
    // take somebody's marks with it.
    const quizHistoryPath = () => path.join(getDataDir(), '_quiz-history.json');
    const QUIZ_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

    expressApp.get('/api/otter/quiz-history', (req, res) => {
      const data = readJSON(quizHistoryPath(), { attempts: [] });
      const cutoff = Date.now() - QUIZ_RETENTION_MS;
      // Filtered on READ as well as pruned on write, matching the cloud policy:
      // a history nobody adds to must still age out, or "wiped every month"
      // would be true of active users only.
      const attempts = (data.attempts || []).filter(a => {
        const t = Date.parse(a?.taken_at ?? '');
        return Number.isFinite(t) && t >= cutoff;
      });
      res.json({ attempts });
    });

    expressApp.post('/api/otter/quiz-history', (req, res) => {
      const { score, total, courses, question_types } = req.body || {};
      // Mirrors the cloud CHECK constraints so the two backends refuse the
      // same payloads. renderQuizResults divides by total, so a zero here is
      // NaN on screen rather than a bad row.
      if (!Number.isInteger(total) || total <= 0) {
        return res.status(400).json({ error: 'total must be a positive whole number' });
      }
      if (!Number.isInteger(score) || score < 0 || score > total) {
        return res.status(400).json({ error: 'score must be between 0 and total' });
      }

      const cutoff = Date.now() - QUIZ_RETENTION_MS;
      const current = readJSON(quizHistoryPath(), { attempts: [] });
      const kept = (current.attempts || []).filter(a => {
        const t = Date.parse(a?.taken_at ?? '');
        return Number.isFinite(t) && t >= cutoff;
      });

      // Local require, matching the existing style at the folder-slug helper —
      // there is no top-level crypto import in this file.
      const { randomUUID } = require('node:crypto');
      const attempt = {
        id: randomUUID(),
        taken_at: new Date().toISOString(),
        score,
        total,
        courses: Array.isArray(courses) ? courses : [],
        question_types: Array.isArray(question_types) ? question_types : [],
      };
      kept.unshift(attempt);
      writeJSON(quizHistoryPath(), { attempts: kept });
      res.json({ ok: true, attempt });
    });

    // ── Reference URLs (per-software) ──
    expressApp.get('/api/software/:slug/references', (req, res) => {
      const data = readJSON(path.join(getSoftwareDir(), req.params.slug, '_references.json'), { urls: [] });
      res.json(data);
    });

    expressApp.post('/api/software/:slug/references', (req, res) => {
      writeJSON(path.join(getSoftwareDir(), req.params.slug, '_references.json'), req.body);
      res.json({ ok: true });
    });

    // ── Correction memory (per-software) ──
    expressApp.get('/api/software/:slug/corrections', (req, res) => {
      const data = readJSON(path.join(getSoftwareDir(), req.params.slug, '_corrections.json'), { corrections: [] });
      res.json(data);
    });

    expressApp.post('/api/software/:slug/corrections', (req, res) => {
      const filePath = path.join(getSoftwareDir(), req.params.slug, '_corrections.json');
      const existing = readJSON(filePath, { corrections: [] });
      const incoming = req.body.corrections || [];
      // Merge by id — add new, update existing
      for (const c of incoming) {
        const idx = existing.corrections.findIndex(e => e.id === c.id);
        if (idx >= 0) existing.corrections[idx] = c;
        else existing.corrections.push(c);
      }
      writeJSON(filePath, existing);
      res.json(existing);
    });

    // ── Export all ──
    expressApp.get('/api/export-all', (req, res) => {
      const swDir = getSoftwareDir();
      const folders = fs.readdirSync(swDir).filter(f => fs.statSync(path.join(swDir, f)).isDirectory());
      const software = folders.map(slug => {
        const meta = readJSON(path.join(swDir, slug, '_meta.json'), {});
        const hotkeys = readJSON(path.join(swDir, slug, '_hotkeys.json'), { categories: [] });
        const functions = readJSON(path.join(swDir, slug, '_functions.json'), { categories: [] });
        const nodesRaw = readJSON(path.join(swDir, slug, '_nodes.json'), { systems: [] });
        const nodes = migrateNodesData(nodesRaw);
        const progress = readJSON(path.join(swDir, slug, '_progress.json'), {});
        const subjDir = path.join(swDir, slug, 'subjects');
        let subjects = [];
        if (fs.existsSync(subjDir)) {
          subjects = fs.readdirSync(subjDir).filter(f => f.endsWith('.json')).map(f => readJSON(path.join(subjDir, f), {}));
        }
        return { meta: { slug, ...meta }, hotkeys, functions, nodes, progress, subjects };
      });
      // Session 30: quiz history moved from a per-course key to ONE top-level
      // key, because a quiz can be built from several courses at once.
      //
      // 🚨 The old per-course `quizHistory` was ALWAYS EMPTY — nothing had ever
      // written it — so every export this app has produced carried a complete-
      // looking quiz history containing nothing. An export is a claim about
      // completeness; it now reports what actually exists.
      const quizHistory = readJSON(quizHistoryPath(), { attempts: [] });
      res.json({
        version: '2.0',
        exported_at: new Date().toISOString(),
        quiz_history: quizHistory.attempts || [],
        software,
      });
    });

    // ── Migration check (v1 → v2) ──
    expressApp.get('/api/migration-needed', (req, res) => {
      const dataDir = getDataDir();
      const needed = fs.existsSync(path.join(dataDir, 'lesson-plans.bak')) || fs.existsSync(path.join(dataDir, 'progress.bak'));
      res.json({ needed });
    });

    expressApp.post('/api/migrate', (req, res) => {
      res.json({ ok: true, message: 'Migration handled client-side or not needed' });
    });

    // ── O.T.T.E.R. settings (prompts only — API key uses WILSON's localStorage) ──
    expressApp.get('/api/otter-settings', (req, res) => {
      const data = readJSON(path.join(getDataDir(), 'otter-settings.json'), {
        companionVisible: true, companionName: 'Ollie', prompts: {}
      });
      res.json(data);
    });

    expressApp.post('/api/otter-settings', (req, res) => {
      writeJSON(path.join(getDataDir(), 'otter-settings.json'), req.body);
      res.json({ ok: true });
    });

    // ── Agent skills (per-tool system prompt overrides) ──
    // The Settings → Agent Skills tab persists prompt overrides
    // here, separate from otter-settings so the existing Otter
    // settings file isn't reshaped. Shape:
    //   { [toolName]: { systemPromptOverride: string | null } }
    expressApp.get('/api/agent-skills', (req, res) => {
      const data = readJSON(path.join(getDataDir(), 'agent-skills.json'), {});
      res.json(data);
    });
    expressApp.post('/api/agent-skills', (req, res) => {
      writeJSON(path.join(getDataDir(), 'agent-skills.json'), req.body || {});
      res.json({ ok: true });
    });

    // ── Legacy local password: DELETED in Session 15 (MASTER_PLAN §6 #32) ──
    //
    // This block held /api/auth/session, /api/auth/verify and
    // /api/auth/change, backed by a plaintext uppercase password in
    // otter-data/wilson-auth.json, with a hardcoded master-override constant
    // and a hardcoded default. (The literal strings are deliberately not
    // repeated here: TPN_AUDIT/LEARNINGS.md's re-audit checklist greps for
    // them and expects zero hits outside that file.) Nothing had checked
    // that credential since the Supabase login landed in Session 2 — its
    // only client, src/components/PasswordScreen.jsx, was orphaned (no file
    // imported it) and has been deleted too.
    //
    // The routes and their consumer had to go TOGETHER. Deleting the routes
    // alone would have left PasswordScreen's fetch to 404 and fall through
    // to its hardcoded string comparison — a fail-OPEN gate, strictly worse
    // than the dead code it replaced.
    //
    // Closes the TPN baseline's TPN-AUTH-001 (hardcoded admin backdoor,
    // CRITICAL), TPN-SDLC-001 (credentials in source, CRITICAL), TPN-ENC-003
    // (password stored with no hash or salt, CRITICAL), TPN-AUTH-002
    // (1-char/12-char/case-folded password policy), TPN-AUTH-004 (the
    // one-timestamp "session"), and the /api/auth/verify half of
    // TPN-NET-003 (unlimited unrate-limited password attempts).
    //
    // Removing the code does not remove the file, so cleanupLegacyAuthFile()
    // below unlinks any credential an existing install still has on disk.

    // ── URL fetch (for user-provided reference links) ──
    expressApp.post('/api/fetch-url', async (req, res) => {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'URL required' });
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': `WILSON/${app.getVersion()} OTTERBot` }
        });
        clearTimeout(timeout);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 8000);
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : url;
        res.json({ title, text, url });
      } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to fetch URL' });
      }
    });

    // Raw passthrough fetcher used by the RABBIT Rate Card
    // Google Sheets importer. Returns the body verbatim along
    // with the response Content-Type so the renderer can decide
    // how to parse it (CSV vs HTML vs JSON). 15 second timeout,
    // 5 MB cap to keep things sane.
    expressApp.post('/api/fetch-raw', async (req, res) => {
      const { url, redirect = 'follow' } = req.body || {};
      if (!url) return res.status(400).json({ error: 'URL required' });
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(url, {
          signal: controller.signal,
          redirect,
          headers: { 'User-Agent': `WILSON/${app.getVersion()} RABBIT` },
        });
        clearTimeout(timeout);
        if (!response.ok) {
          return res.status(response.status).json({
            error: `Upstream ${response.status} ${response.statusText}`,
            status: response.status,
          });
        }
        const contentType = response.headers.get('content-type') || '';
        const buf = await response.arrayBuffer();
        if (buf.byteLength > 5 * 1024 * 1024) {
          return res.status(413).json({ error: 'Response exceeds 5 MB cap' });
        }
        const body = Buffer.from(buf).toString('utf8');
        res.json({ body, contentType, finalUrl: response.url, status: response.status });
      } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to fetch URL' });
      }
    });

    // ═══════════════════════════════════════════════════════════════
    //  RABBIT — local server adapter routes
    //  Backs `localServerAdapter.js`. Persists each project as one
    //  denormalized JSON bundle under
    //    {userData}/rabbit-data/projects/{project_id}/project.json
    //  Binary files live under .../files/, thumbs under .../thumbs/.
    // ═══════════════════════════════════════════════════════════════
    // Use Node's built-in crypto.randomUUID — uuid@13 is ESM-only and
    // can't be require()'d from this CommonJS main process file.
    const { randomUUID: uuidv4 } = require('node:crypto');

    function getRabbitProjectsDir() {
      const dir = path.join(getRabbitDataDir(), 'projects');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    function getRabbitProjectDir(projectId) {
      const dir = path.join(getRabbitProjectsDir(), projectId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    function getRabbitFilesDir(projectId) {
      const dir = path.join(getRabbitProjectDir(projectId), 'files');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    function rabbitBundlePath(projectId) {
      return path.join(getRabbitProjectDir(projectId), 'project.json');
    }
    function readRabbitBundle(projectId) {
      const bundle = readJSON(rabbitBundlePath(projectId), null);
      if (!bundle) return null;
      // ── Migrate old bundles ──
      let dirty = false;
      if (!bundle.projectTeam)     { bundle.projectTeam     = []; dirty = true; }
      if (!bundle.managedFiles)    { bundle.managedFiles    = []; dirty = true; }
      if (!bundle.budgetLines)     { bundle.budgetLines     = []; dirty = true; }
      if (!bundle.budgetActuals)   { bundle.budgetActuals   = []; dirty = true; }
      if (!bundle.budgetVersions)  { bundle.budgetVersions  = []; dirty = true; }
      if (!bundle.expenses)        { bundle.expenses        = []; dirty = true; }
      if (!bundle.scenes)          { bundle.scenes          = []; dirty = true; }
      if (!bundle.shots)           { bundle.shots           = []; dirty = true; }
      if (!bundle.levels)          { bundle.levels          = []; dirty = true; }
      if (!bundle.experiences)     { bundle.experiences     = []; dirty = true; }
      if (!bundle.fileEvents)      { bundle.fileEvents      = []; dirty = true; }
      if (!bundle.folders)         { bundle.folders         = []; dirty = true; }
      // Ensure sub-folder structure exists on first access
      try { ensureProjectFolders(bundle); } catch {}
      // Session 26: the tree, reconciled on read so a project that predates
      // 0041 gains its rows without anyone having to migrate anything. It
      // converges — once every planned folder has a row nothing changes, so
      // this does not rewrite the bundle on every request.
      //
      // The rows are recorded even when no directory can be made, then the
      // directories are made for whatever rows exist. Doing it in that order
      // is what lets a project pick a location later and get its whole tree.
      try {
        if (ensureProjectFolderRows(bundle, projectId)) {
          dirty = true;
          // Only when rows were actually ADDED. readRabbitBundle runs on every
          // API request, and materializeFolderDirs is one existsSync per
          // folder — on a project with a few hundred entities that is a few
          // hundred stat calls on every call, to discover nothing changed.
          // The paths are deterministic, so this converges after one pass.
          //
          // Configuring a folder location LATER is the case this would
          // otherwise miss: the rows already exist, so nothing is added and
          // no directory gets made. The project PATCH route covers it — that
          // is where folder_root is written.
          materializeFolderDirs(bundle);
        }
      } catch (e) { console.error('folder reconcile failed:', e.message); }
      if (dirty) {
        try { writeJSON(rabbitBundlePath(projectId), bundle); } catch {}
      }
      return bundle;
    }
    function writeRabbitBundle(projectId, bundle, { touch = true } = {}) {
      // touch:false is for persists that only append audit data (the S33
      // 'downloaded' event): a READ must not stamp project.updated_at —
      // the project list sorts by it, so every download would bump the
      // project to the top — and the ${slug}_DATABASES mirrors carry no
      // fileEvents, so rewriting all five per download is pure churn
      // (adversarial review, S33).
      if (touch) bundle.project.updated_at = new Date().toISOString();
      // Ensure projectTeam array exists (backward compat for old bundles)
      if (!bundle.projectTeam) bundle.projectTeam = [];
      writeJSON(rabbitBundlePath(projectId), bundle);
      // Mirror split databases to user-visible project folder
      if (touch) mirrorProjectDatabases(projectId, bundle);
    }
    function emptyBundle(project) {
      return {
        project,
        phases:          [],
        assets:          [],
        tasks:           [],
        dependencies:    [],
        taskLinks:       [],
        files:           [],
        assetVersions:   [],
        comments:        [],
        ingestionRuns:   [],
        teamAssignments: [],
        projectTeam:     [],
        managedFiles:    [],
        budgetVersions:  [],
        expenses:        [],
        budgetLines:     [],
        budgetActuals:   [],
        // Session 24: a rate edited inside a project is project-scoped and
        // must never write back to the workspace rate card.
        projectRateOverrides: [],
        scenes:          [],
        shots:           [],
        levels:          [],
        experiences:     [],
        // Session 26: the folder tree. Mirrors public.folders so the same
        // bundle key exists on both backends and loadProject returns the
        // same shape either way.
        folders:         [],
        fileEvents:      [],
      };
    }
    function rabbitTouch(row) {
      const now = new Date().toISOString();
      if (!row.id) row.id = uuidv4();
      if (!row.created_at) row.created_at = now;
      row.updated_at = now;
      return row;
    }
    function rabbitUpsertInto(arr, row) {
      const idx = arr.findIndex(x => x.id === row.id);
      if (idx >= 0) {
        arr[idx] = { ...arr[idx], ...row };
        return arr[idx];
      }
      arr.push(row);
      return row;
    }
    function rabbitRemoveFrom(arr, id) {
      const idx = arr.findIndex(x => x.id === id);
      if (idx < 0) return false;
      arr.splice(idx, 1);
      return true;
    }
    function rabbitNotFound(res, what = 'project') {
      return res.status(404).json({ error: `${what} not found` });
    }

    // ── Project folder structure helpers ─────────────────────
    // Every user-visible project folder gets three sub-folders:
    //   ASSETS/                       — asset folders + managed files
    //   {Slug}_DATABASES/             — read-only JSON mirrors of project data
    //   {Slug}_FILES/                 — uploaded files (receipts, docs, etc.)

    function resolveProjectFolder(bundle) {
      const root = bundle?.project?.folder_root;
      if (root && fs.existsSync(root)) return root;
      // Session 34: workspace root (byos) outranks the machine default.
      const rootBase = resolveConfiguredRootDir();
      if (!rootBase) return null;
      const slug = bundle?.project?.folder_slug || fileSlugify(bundle?.project?.title || 'Untitled-Project');
      const resolved = path.join(rootBase, slug);
      return fs.existsSync(resolved) ? resolved : null;
    }

    // ── Session 26: the folder categories ────────────────────
    //
    // 🚨 THIS LIST IS DUPLICATED, AND THE DUPLICATE IS UNAVOIDABLE.
    // The renderer's copy is FOLDER_CATEGORIES in
    // src/tools/rabbit_v0.1.0/folderPaths.js. The main process cannot import
    // from the renderer bundle — the same constraint that forces the second
    // copy of fileSlugify above it. A category slug that disagrees between
    // the two would file the same scene in two different folders.
    //
    // folderParity.test.js reads BOTH files and fails when they diverge, so
    // this is pinned rather than left to drift. That is the whole reason S25
    // removed the THIRD copy of fileSlugify (43be524) before this session
    // started building on these slugs.
    //
    // ASSETS/SCENES/SHOTS were designed in long ago — FileManager.jsx:84 has
    // computed `parentType = sceneId ? 'SCENES' : shotId ? 'SHOTS' :
    // 'ASSETS'` all along, and nothing ever created the first two. LEVELS and
    // EXPERIENCES were not even in that switch.
    //
    // INVOICES keeps its exact spelling: migration 0039 matches that segment
    // with upper() on the Supabase side and the case is load-bearing there.
    const FOLDER_CATEGORIES = [
      { slug: 'ASSETS',      entityType: 'asset',      enabledBy: null },
      { slug: 'SCENES',      entityType: 'scene',      enabledBy: 'scenes_enabled' },
      { slug: 'SHOTS',       entityType: 'shot',       enabledBy: 'scenes_enabled' },
      { slug: 'LEVELS',      entityType: 'level',      enabledBy: 'levels_enabled' },
      { slug: 'EXPERIENCES', entityType: 'experience', enabledBy: 'experiences_enabled' },
      { slug: 'INVOICES',    entityType: 'invoice',    enabledBy: null },
    ];

    const FOLDER_ENTITY_FK = {
      asset:      'asset_id',
      scene:      'scene_id',
      shot:       'shot_id',
      level:      'level_id',
      experience: 'experience_id',
    };

    const FOLDER_BUNDLE_KEY = {
      asset: 'assets', scene: 'scenes', shot: 'shots',
      level: 'levels', experience: 'experiences',
    };

    const FOLDER_FALLBACK_NAME = {
      asset:      'Untitled-Asset',
      scene:      'Untitled-Scene',
      shot:       'Untitled-Shot',
      level:      'Untitled-Level',
      experience: 'Untitled-Experience',
    };

    function ensureProjectFolders(bundle) {
      const root = resolveProjectFolder(bundle);
      if (!root) return;
      const slug = bundle.project.folder_slug || fileSlugify(bundle.project.title || 'Untitled-Project');
      const dirs = [
        path.join(root, 'ASSETS'),
        // 🚨 NOT ported to the folders TABLE, and it must not be. On `main`
        // this was never a files folder, it was the DATASTORE —
        // mirrorProjectDatabases writes project.json, team.json, tasks.json,
        // timeline.json and budget.json into it. Database information lives
        // in Supabase. It keeps being created here so existing local projects
        // are untouched, and it is deliberately absent from FOLDER_CATEGORIES
        // so it never becomes a second copy of every project in the cloud.
        path.join(root, `${slug}_DATABASES`),
        path.join(root, `${slug}_FILES`),
        // Session 24 (Audrey): one folder called INVOICES, created with the
        // project so it is there before the first invoice is attached.
        //
        // This REPLACES main's three — <slug>_RECEIPTS&INVOICES,
        // <slug>_CREWINVOICES and <slug>_TALENTINVOICES. They are no longer
        // created, because nothing writes to them: the only writer was the
        // invoice-folder route, which the adapter-backed attachment flow
        // replaced. Existing folders on disk are left exactly where they are
        // — this stops making new empty ones, it never deletes.
        path.join(root, 'INVOICES'),
      ];
      for (const d of dirs) {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      }
    }

    // ── Session 26: the folder tree, as rows AND as directories ─────────
    //
    // Two things happen here and they are deliberately independent:
    //
    //   1. ROWS are recorded in bundle.folders ALWAYS, even when the project
    //      has no folder on disk yet. The tree is the model; the directories
    //      are a projection of it. A project configured with a location
    //      later, or exported to cloud, keeps the structure it already had.
    //   2. DIRECTORIES are created only when a root resolves, because that
    //      is the only time there is anywhere to put them.
    //
    // 🚨 NOTHING HERE DELETES. Turning a category off removes it from the
    // R.A.B.B.I.T. view and leaves every folder exactly where it is —
    // Audrey, 2026-08-03. A category that is off is simply not PLANNED, so
    // an existing row for it survives untouched.

    // 🚨 THE FALLBACK FIRES ON AN EMPTY SLUG, NOT ON A MISSING NAME.
    // fileSlugify strips everything non-alphanumeric, so a name of '..' or
    // '###' is TRUTHY and slugifies to ''. `x || 'Untitled'` therefore lets
    // an empty final segment through, and the bundle has no CHECK constraint
    // to catch it the way public.folders does. The renderer's copy is
    // slugOrFallback in folderPaths.js; folderParity.test.js pins them.
    function slugOrFallback(name, fallback) {
      return fileSlugify(name || '') || fileSlugify(fallback);
    }

    function planProjectFolderList(project) {
      const out = [{
        kind: 'root',
        entityType: null,
        slug: project?.folder_slug || slugOrFallback(project?.title, 'Untitled-Project'),
        label: project?.title || null,
        path: '',
        parentPath: null,
      }];
      for (const c of FOLDER_CATEGORIES) {
        if (c.enabledBy && !project?.[c.enabledBy]) continue;
        out.push({
          kind: 'category', entityType: c.entityType, slug: c.slug,
          label: null, path: c.slug, parentPath: '',
        });
      }
      return out;
    }

    function planEntityFolderFor(entityType, entity) {
      const c = FOLDER_CATEGORIES.find(x => x.entityType === entityType);
      if (!c) return null;
      const slug = slugOrFallback(entity?.name, FOLDER_FALLBACK_NAME[entityType] || 'Untitled');
      return {
        category: {
          kind: 'category', entityType: c.entityType, slug: c.slug,
          label: null, path: c.slug, parentPath: '',
        },
        folder: {
          kind: 'entity', entityType, slug,
          label: entity?.name || null,
          path: `${c.slug}/${slug}`, parentPath: c.slug,
          fk: FOLDER_ENTITY_FK[entityType], entityId: entity?.id || null,
        },
      };
    }

    // Adds the row when its path is free. Returns true when it wrote one, so
    // callers can decide whether the bundle needs persisting.
    function addFolderRow(bundle, projectId, planned) {
      if (!bundle.folders) bundle.folders = [];
      if (bundle.folders.some(f => f.path === planned.path)) return false;
      const parent = planned.parentPath === null
        ? null
        : bundle.folders.find(f => f.path === planned.parentPath);
      const now = new Date().toISOString();
      const row = {
        id:            uuidv4(),
        project_id:    projectId,
        parent_id:     parent ? parent.id : null,
        kind:          planned.kind,
        entity_type:   planned.entityType || null,
        asset_id:      null,
        scene_id:      null,
        shot_id:       null,
        level_id:      null,
        experience_id: null,
        slug:          planned.slug,
        label:         planned.label || null,
        path:          planned.path,
        sort_order:    bundle.folders.length,
        created_at:    now,
        updated_at:    now,
      };
      if (planned.fk) row[planned.fk] = planned.entityId;
      bundle.folders.push(row);
      return true;
    }

    // Every row's directory. Contained against the project root for the
    // reason S17 (#45 family) had to retro-fit resolveContainedFilePath: a
    // slug reaches this from client-supplied entity names, and mkdirSync on
    // an uncontained path writes outside the project.
    function materializeFolderDirs(bundle) {
      const root = resolveProjectFolder(bundle);
      if (!root) return;
      for (const f of bundle.folders || []) {
        if (!f.path) continue;
        const dir = resolveContainedFilePath(root, f.path);
        if (dir && !fs.existsSync(dir)) {
          try { fs.mkdirSync(dir, { recursive: true }); }
          catch (e) { console.error('folder mkdir failed:', f.path, e.message); }
        }
      }
    }

    function ensureProjectFolderRows(bundle, projectId) {
      let changed = false;
      for (const planned of planProjectFolderList(bundle.project)) {
        if (addFolderRow(bundle, projectId, planned)) changed = true;
      }
      return changed;
    }

    // One entity's own folder. Audrey: five scenes means FIVE folders under
    // SCENES/, not one shared one.
    //
    // 🚨 The existing row is found by the entity FK, never by path. Renaming
    // the entity changes the path, so a path lookup would miss the row and
    // add a SECOND folder for one scene — the exact defect this session
    // exists to prevent. On the Supabase side the database refuses that
    // (folders_scene_uniq); the local bundle has no such backstop, so getting
    // the lookup right is the whole guard here.
    function ensureEntityFolderRow(bundle, projectId, entityType, entity) {
      const planned = planEntityFolderFor(entityType, entity);
      if (!planned) return { row: null, changed: false };
      if (!bundle.folders) bundle.folders = [];
      let changed = ensureProjectFolderRows(bundle, projectId);
      if (addFolderRow(bundle, projectId, planned.category)) changed = true;

      const fk = FOLDER_ENTITY_FK[entityType];
      const mine = bundle.folders.find(f => f[fk] && f[fk] === entity?.id);
      if (mine) {
        if (mine.path !== planned.folder.path) {
          mine.slug = planned.folder.slug;
          mine.path = planned.folder.path;
          mine.label = planned.folder.label;
          mine.updated_at = new Date().toISOString();
          changed = true;
        }
        return { row: mine, changed };
      }
      if (addFolderRow(bundle, projectId, planned.folder)) changed = true;
      return {
        row: bundle.folders.find(f => f.path === planned.folder.path) || null,
        changed,
      };
    }

    function mirrorProjectDatabases(projectId, bundle) {
      const root = resolveProjectFolder(bundle);
      if (!root) return;
      const slug = bundle.project.folder_slug || fileSlugify(bundle.project.title || 'Untitled-Project');
      const dbDir = path.join(root, `${slug}_DATABASES`);
      if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
      try {
        // project.json — project metadata
        writeJSON(path.join(dbDir, 'project.json'), bundle.project);
        // team.json — project-scoped team roster
        writeJSON(path.join(dbDir, 'team.json'), bundle.projectTeam || []);
        // tasks.json — tasks + dependencies + task links
        writeJSON(path.join(dbDir, 'tasks.json'), {
          tasks:        bundle.tasks        || [],
          dependencies: bundle.dependencies || [],
          taskLinks:    bundle.taskLinks    || [],
        });
        // timeline.json — phases + scheduling data
        writeJSON(path.join(dbDir, 'timeline.json'), {
          phases:       bundle.phases       || [],
          tasks:        (bundle.tasks || []).map(t => ({
            id: t.id, name: t.name, asset_id: t.asset_id,
            assigned_role_slug: t.assigned_role_slug,
            status: t.status, bid_days: t.bid_days,
            start_date: t.start_date, end_date: t.end_date,
            sort_order: t.sort_order,
          })),
          dependencies: bundle.dependencies || [],
        });
        // budget.json — budget lines, actuals, versions, expenses
        writeJSON(path.join(dbDir, 'budget.json'), {
          budgetLines:    bundle.budgetLines    || [],
          budgetActuals:  bundle.budgetActuals  || [],
          budgetVersions: bundle.budgetVersions || [],
          expenses:       bundle.expenses       || [],
        });
      } catch (e) {
        console.error('mirrorProjectDatabases failed:', e.message);
      }
    }

    // Resolve the _FILES dir inside the user-visible project folder.
    // Falls back to the internal rabbit-data files dir if no project folder exists.
    function resolveProjectFilesDir(bundle, projectId) {
      // Session 14: a storage relink can point the project's files at a new
      // home (project.files_dir). Honored only while it exists on disk — if
      // it moves again, resolution falls through and the scan reports the
      // rows as dangling rather than silently inventing a directory.
      const override = bundle.project?.files_dir;
      if (override && fs.existsSync(override)) return override;
      const root = resolveProjectFolder(bundle);
      if (root) {
        const slug = bundle.project.folder_slug || fileSlugify(bundle.project.title || 'Untitled-Project');
        const dir = path.join(root, `${slug}_FILES`);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return dir;
      }
      // Fallback to internal storage
      return getRabbitFilesDir(projectId);
    }

    // Session 24. Audrey: "invoices should go into the project folder. it
    // should be in a nested folder in the project called INVOICES."
    //
    // A SIBLING of <slug>_FILES, not a child: invoices are the project's
    // financial record, not general project files, and the relink flow below
    // deliberately leaves them alone.
    //
    // Note this supersedes main's three separate invoice folders
    // (<slug>_RECEIPTS&INVOICES, <slug>_CREWINVOICES, <slug>_TALENTINVOICES).
    // Audrey asked for one folder called INVOICES; the split is not carried
    // over. The name matches the reserved cloud path segment exactly, so the
    // two backends put invoices somewhere a person would recognise as the
    // same place.
    function resolveProjectInvoicesDir(bundle, projectId) {
      const root = resolveProjectFolder(bundle);
      if (root) {
        const dir = path.join(root, 'INVOICES');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return dir;
      }
      // No project folder configured — fall back to wherever ordinary files
      // go, so an invoice is never written somewhere unreachable.
      return resolveProjectFilesDir(bundle, projectId);
    }

    // Which base a given file row resolves against. storage_path stays a bare
    // filename either way, so the containment guard keeps working unchanged.
    //
    // The existence check is not belt-and-braces, it closes a real window: an
    // invoice uploaded while the project had NO folder configured lands in the
    // files dir (the fallback above), and if a folder is configured later this
    // would start resolving to <root>/INVOICES and report the body missing.
    // Ordinary files have the same characteristic and the relink flow is their
    // recovery — but invoices are deliberately excluded from relink, so
    // without this they would have no way back. Prefer the invoices dir, fall
    // back to wherever the body actually is.
    function resolveFileBaseDir(bundle, projectId, file) {
      const filesDir = resolveProjectFilesDir(bundle, projectId);
      if (!file?.is_financial) return filesDir;
      const invoicesDir = resolveProjectInvoicesDir(bundle, projectId);
      const here = resolveContainedFilePath(invoicesDir, file.storage_path);
      if (here && fs.existsSync(here)) return invoicesDir;
      const legacy = resolveContainedFilePath(filesDir, file.storage_path);
      if (legacy && fs.existsSync(legacy)) return filesDir;
      // Neither has it — return the canonical home so the 410 names the place
      // the file is supposed to be, not the place it once was.
      return invoicesDir;
    }

    // ── File lifecycle helpers (Session 14) ───────────────────
    // Containment guard: resolveContainedFilePath joins relPath under
    // baseDir and refuses anything that escapes it ('..', absolute paths).
    // storage_path and every relink mapping go through it before any fs
    // call — the PATCH route used to let a crafted storage_path unlink
    // arbitrary disk paths. Since S33 it lives in pathContainment.cjs
    // (required at the top of this file) so the semantics — including the
    // drive/share-root fix — are unit-tested; do not redefine it here.
    //
    // Relink folders must be USER-CHOSEN, not body-supplied (adversarial
    // review, S14): the Express server answers any local origin (cors()),
    // so a body-picked baseDir would let a drive-by request point a
    // project's files at, say, the user's Documents and read/unlink there.
    // rabbit:pick-directory records every folder the user actually picks
    // in userAuthorizedDirs; anything inside the project's own folders is
    // always fair game.
    function isUserAuthorizedRelinkDir(bundle, projectId, p) {
      if (!p) return false;
      const resolved = path.resolve(String(p)).toLowerCase();
      if (userAuthorizedDirs.has(resolved)) return true;
      const roots = [];
      try { const r = resolveProjectFolder(bundle); if (r) roots.push(r); } catch {}
      try { roots.push(getRabbitDataDir()); } catch {}
      try { const d = readFilesConfig()?.defaultRootDir; if (d) roots.push(d); } catch {}
      // Session 34: the workspace root is as user-authorized as the machine
      // default — an admin chose it for the whole company. Without this,
      // moving the root to the database makes relink refuse folders inside
      // the configured root (the exact regression the design warned about).
      if (workspaceRootDir) roots.push(workspaceRootDir);
      if (bundle.project?.files_dir) roots.push(bundle.project.files_dir);
      // isPathInside carries the same root-base rule as the containment
      // guard: a drive/share root must contain its own children (S33).
      return roots.some(root => isPathInside(root, resolved));
    }
    // Local twin of the cloud file_events stream (migration 0027): the
    // audit drawer reads the same event vocabulary from bundle.fileEvents.
    // NOTE: local files rows hard-delete (no local trash), so the local
    // stream emits uploaded/downloaded/moved/relinked/purged only.
    function rabbitLogFileEvent(bundle, evt) {
      if (!bundle.fileEvents) bundle.fileEvents = [];
      bundle.fileEvents.push({
        id: uuidv4(),
        created_at: new Date().toISOString(),
        ...evt,
      });
      // Cap so a busy project's bundle cannot grow unbounded — but never
      // trim a 'purged' certificate: the deletion record is the one entry
      // that must outlive churn (TPN-CONT-002).
      if (bundle.fileEvents.length > 2000) {
        let excess = bundle.fileEvents.length - 2000;
        bundle.fileEvents = bundle.fileEvents.filter(e => {
          if (excess > 0 && e.event !== 'purged') { excess--; return false; }
          return true;
        });
      }
    }

    // ── Session 40: the managed-file read throttle ───────────────────────────
    //
    // ONE 'downloaded' event per file per minute, for the streaming route only.
    // A <video> issues a fresh Range request on every seek and every buffer
    // refill, so an unthrottled log would write dozens of rows for a single
    // viewing — and because rabbitLogFileEvent evicts the oldest non-'purged'
    // entries at 2000, that churn would DELETE real history (uploads, relinks)
    // to make room for noise about one clip. The audit control asks whether a
    // read happened, not how many TCP requests it took.
    //
    // In-memory on purpose: it is a de-duplication window, not a record. A
    // restart re-arms it, which errs toward logging.
    const MANAGED_READ_LOG_WINDOW_MS = 60_000;
    const managedReadLoggedAt = new Map();
    function shouldLogManagedRead(fileId) {
      const now = Date.now();
      const prev = managedReadLoggedAt.get(fileId);
      if (prev !== undefined && now - prev < MANAGED_READ_LOG_WINDOW_MS) return false;
      // Bounded so a long session browsing many files cannot grow this without
      // limit. Anything outside the window is already going to log again.
      if (managedReadLoggedAt.size > 500) {
        for (const [k, t] of managedReadLoggedAt) {
          if (now - t >= MANAGED_READ_LOG_WINDOW_MS) managedReadLoggedAt.delete(k);
        }
      }
      managedReadLoggedAt.set(fileId, now);
      return true;
    }

    // ── Projects ────────────────────────────────────────────
    expressApp.get('/api/rabbit/projects', (req, res) => {
      const projectsDir = getRabbitProjectsDir();
      const ids = fs.readdirSync(projectsDir).filter(f =>
        fs.statSync(path.join(projectsDir, f)).isDirectory()
      );
      const list = [];
      for (const id of ids) {
        const bundle = readRabbitBundle(id);
        if (bundle?.project) {
          // Return the full project record so DOG-side fields
          // (documents, visualAssets, startDate, endDate, description)
          // travel through alongside the canonical RABBIT fields.
          list.push({ ...bundle.project });
        }
      }
      list.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
      res.json(list);
    });

    expressApp.get('/api/rabbit/projects/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.id);
      if (!bundle) return rabbitNotFound(res);
      res.json(bundle);
    });

    expressApp.post('/api/rabbit/projects', (req, res) => {
      const now = new Date().toISOString();
      // Session 35 (TPN-NET-015): a body-supplied folder_root is validated
      // BEFORE anything is built on disk. The auto-derived folder below
      // (rootDir + slug) is contained by construction and is not re-checked.
      let folderRootIn = null;
      if (req.body.folder_root) {
        const v = folderRootRefusal(req.body.folder_root);
        if (v.error) return res.status(400).json({ error: v.error });
        folderRootIn = v.resolved;
      }
      // 🚨 files_dir is the HIGHER-priority storage base — resolveProjectFilesDir
      // consults it BEFORE folder_root — so guarding folder_root alone left the
      // real bypass open (S35 adversarial review). A brand-new project has no
      // legitimate files_dir: it is the relink BASE, set only by the guarded
      // relink-apply route, never at create. Force it null.
      let filesDirIn = null;
      // Spread req.body first so DOG-side fields (documents, visualAssets,
      // startDate, endDate, etc.) ride through, then enforce the canonical
      // identity / timestamp fields so they can't be overridden.
      const project = {
        ...req.body,
        id:              req.body.id || uuidv4(),
        workspace_id:    req.body.workspace_id || '00000000-0000-0000-0000-000000000001',
        title:           req.body.title || 'Untitled Project',
        description:     req.body.description || '',
        status:          req.body.status || 'active',
        status_tag:      req.body.status_tag || null,
        start_date:      req.body.start_date || null,
        end_date:        req.body.end_date || null,
        budget_total:    req.body.budget_total ?? null,
        budget_currency: req.body.budget_currency || 'USD',
        client_name:     req.body.client_name || null,
        cover_image_url: req.body.cover_image_url || null,
        created_by:      req.body.created_by || null,
        documents:       Array.isArray(req.body.documents)    ? req.body.documents    : [],
        visualAssets:    Array.isArray(req.body.visualAssets) ? req.body.visualAssets : [],
        // 🚨 S40: SLUGIFIED, not taken verbatim. This value becomes a path
        // segment AND the containment base every managed-file read resolves
        // against (resolveProjectFolderRoot), so `../../../..` here reparents
        // the whole project. Idempotent for a legitimate slug — the renderer
        // produces the same form — so nothing that works today changes.
        folder_slug:     fileSlugify(String(req.body.folder_slug || req.body.title || 'Untitled-Project')),
        folder_root:     folderRootIn,
        files_dir:       filesDirIn,
        created_at:      now,
        updated_at:      now,
      };
      const bundle = emptyBundle(project);
      // Create the project folder on disk if a root is configured
      // (Session 34: workspace root outranks the machine default).
      const rootDir = project.folder_root || resolveConfiguredRootDir();
      if (rootDir && fs.existsSync(rootDir)) {
        const projFolder = path.join(rootDir, project.folder_slug);
        if (!fs.existsSync(projFolder)) fs.mkdirSync(projFolder, { recursive: true });
        if (!project.folder_root) project.folder_root = projFolder;
      }
      // Create ASSETS/, _DATABASES/, _FILES/ sub-folders
      ensureProjectFolders(bundle);
      writeRabbitBundle(project.id, bundle);
      res.json(project);
    });

    expressApp.patch('/api/rabbit/projects/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.id);
      if (!bundle) return rabbitNotFound(res);
      // Session 35 (TPN-NET-015): folder_root is the one field this spread
      // must not accept verbatim. Clearing (null/'') is a reset to the
      // configured chain and passes; an UNCHANGED value re-sent by a caller
      // that echoes whole rows passes untouched (refusing it would brick
      // every later patch of a project whose folder predates the rule); a
      // NEW value is validated like the create route's.
      if ('folder_root' in req.body) {
        const next = req.body.folder_root;
        const cur = bundle.project.folder_root || null;
        if (!next) {
          req.body.folder_root = null;
        } else if (String(next) !== String(cur)) {
          const v = folderRootRefusal(next);
          if (v.error) return res.status(400).json({ error: v.error });
          req.body.folder_root = v.resolved;
        }
      }
      // 🚨 files_dir is the relink BASE and outranks folder_root in
      // resolveProjectFilesDir — an unvalidated body value repoints every read
      // and write regardless of the folder_root guard (S35 review, HIGH). The
      // generic PATCH may only CLEAR it (the "Files folder" reset control); a
      // non-empty value is set exclusively by the guarded relink-apply route.
      // Unchanged echoes pass (adapters re-send whole rows); a changed
      // non-empty value is refused.
      if ('files_dir' in req.body) {
        const next = req.body.files_dir;
        const cur = bundle.project.files_dir || null;
        if (!next) {
          req.body.files_dir = null;
        } else if (String(next) !== String(cur)) {
          return res.status(400).json({ error: 'the files folder is set by the relink flow, not directly' });
        }
      }
      // 🚨 S40: folder_slug is a PATH SEGMENT and the containment base every
      // managed-file read resolves against, and it rode the bare spread below.
      // Guarded with the S35 idiom this route already uses for folder_root: an
      // UNCHANGED value passes untouched (adapters re-send whole rows, and
      // rewriting an existing slug would move the project's folder out from
      // under its own files), a CHANGED value is slugified.
      if ('folder_slug' in req.body) {
        const next = req.body.folder_slug;
        const cur = bundle.project.folder_slug || null;
        if (String(next ?? '') !== String(cur ?? '')) {
          req.body.folder_slug = fileSlugify(String(next || bundle.project.title || 'Untitled-Project'));
        }
      }
      const oldTitle = bundle.project.title;
      const oldSlug = bundle.project.folder_slug;
      bundle.project = { ...bundle.project, ...req.body, id: bundle.project.id };
      // If title changed, update folder_slug and rename folder
      if (req.body.title && req.body.title !== oldTitle) {
        const newSlug = fileSlugify(req.body.title);
        if (newSlug !== oldSlug && oldSlug) {
          const root = bundle.project.folder_root
            ? path.dirname(bundle.project.folder_root)
            : resolveConfiguredRootDir();
          if (root) {
            const oldPath = path.join(root, oldSlug);
            const newPath = path.join(root, newSlug);
            if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
              try {
                fs.renameSync(oldPath, newPath);
                bundle.project.folder_root = newPath;
                // Rename slug-prefixed sub-folders inside the project folder
                for (const suffix of ['_DATABASES', '_FILES']) {
                  const op = path.join(newPath, oldSlug + suffix);
                  const np = path.join(newPath, newSlug + suffix);
                  if (fs.existsSync(op) && !fs.existsSync(np)) {
                    try { fs.renameSync(op, np); } catch (e2) { console.error(`subfolder rename ${suffix}:`, e2.message); }
                  }
                }
              } catch (e) { console.error('project folder rename failed:', e.message); }
            }
          }
        }
        bundle.project.folder_slug = newSlug;
      }
      // Session 26. This route is where folder_root is written (the "Change"
      // button in the Files & Storage panel), so it is the one place a
      // project can acquire a location it did not have. Re-plan and
      // materialize here, or a project configured after its rows already
      // existed would have a tree in the bundle and nothing on disk.
      //
      // Also catches a toggle being switched ON: scenes_enabled arriving true
      // means SCENES/ and SHOTS/ are now planned. Switching one OFF removes
      // nothing — a disabled category is simply absent from the plan, and
      // nothing here deletes (Audrey, 2026-08-03).
      try {
        ensureProjectFolderRows(bundle, req.params.id);
        materializeFolderDirs(bundle);
      } catch (e) { console.error('folder reconcile failed:', e.message); }
      writeRabbitBundle(req.params.id, bundle);
      res.json(bundle.project);
    });

    expressApp.delete('/api/rabbit/projects/:id', (req, res) => {
      const dir = path.join(getRabbitProjectsDir(), req.params.id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      res.json({ ok: true });
    });

    // ── Generic sub-entity factory (phases, assets, tasks, …) ──
    // Each entity type lives as an array on the project bundle. The
    // factory generates POST/PATCH/DELETE routes that load → mutate
    // → save the whole bundle. Single-user, low write rate, fine.
    // Session 26: `folderEntityType` opts an entity into the folder tree.
    // Passing it gives every row of that type its own folder on create AND
    // moves the folder when the row is renamed. Entities without it (phases,
    // tasks, comments…) are unaffected — they are not things with folders.
    function rabbitSubentityRoutes(entityName, bundleKey, folderEntityType = null) {
      // POST insert / upsert
      expressApp.post(`/api/rabbit/projects/:projectId/${entityName}`, (req, res) => {
        const bundle = readRabbitBundle(req.params.projectId);
        if (!bundle) return rabbitNotFound(res);
        if (!bundle[bundleKey]) bundle[bundleKey] = [];
        const row = rabbitTouch({ ...req.body, project_id: req.params.projectId });
        const result = rabbitUpsertInto(bundle[bundleKey], row);
        if (folderEntityType) {
          ensureEntityFolderRow(bundle, req.params.projectId, folderEntityType, result);
          materializeFolderDirs(bundle);
        }
        writeRabbitBundle(req.params.projectId, bundle);
        res.json(result);
      });
      // PATCH
      expressApp.patch(`/api/rabbit/projects/:projectId/${entityName}/:id`, (req, res) => {
        const bundle = readRabbitBundle(req.params.projectId);
        if (!bundle) return rabbitNotFound(res);
        if (!bundle[bundleKey]) bundle[bundleKey] = [];
        const arr = bundle[bundleKey];
        const idx = arr.findIndex(x => x.id === req.params.id);
        if (idx < 0) return rabbitNotFound(res, entityName);
        arr[idx] = { ...arr[idx], ...req.body, id: req.params.id, updated_at: new Date().toISOString() };
        if (folderEntityType) {
          // A rename moves the folder ROW here and CREATES the new directory
          // below — the old directory is deliberately left in place with
          // whatever is inside it. Moving files is S27's job (it owns the
          // file paths); silently relocating a user's files as a side effect
          // of a rename is not something to do without owning that path.
          ensureEntityFolderRow(bundle, req.params.projectId, folderEntityType, arr[idx]);
          materializeFolderDirs(bundle);
        }
        writeRabbitBundle(req.params.projectId, bundle);
        res.json(arr[idx]);
      });
      // DELETE
      expressApp.delete(`/api/rabbit/projects/:projectId/${entityName}/:id`, (req, res) => {
        const bundle = readRabbitBundle(req.params.projectId);
        if (!bundle) return rabbitNotFound(res);
        if (!bundle[bundleKey]) bundle[bundleKey] = [];
        const removed = rabbitRemoveFrom(bundle[bundleKey], req.params.id);
        if (!removed) return rabbitNotFound(res, entityName);
        writeRabbitBundle(req.params.projectId, bundle);
        res.json({ ok: true });
      });
    }

    rabbitSubentityRoutes('phases',         'phases');

    // ── Assets: custom routes with folder lifecycle side-effects ──
    // Replaces rabbitSubentityRoutes('assets','assets') so we can
    // create/rename/soft-delete OS folders when assets change.
    function resolveProjectFolderRoot(bundle) {
      const projectRoot = bundle.project?.folder_root;
      if (projectRoot && fs.existsSync(projectRoot)) return projectRoot;
      // Session 34: workspace root (byos) outranks the machine default.
      const rootBase = resolveConfiguredRootDir();
      if (!rootBase) return null;
      const slug = fileSlugify(bundle.project?.title || 'Untitled-Project');
      // 🚨 SESSION 40 (adversarial review, HIGH — CONFIRMED BY MEASUREMENT).
      // THE CONTAINMENT BASE WAS ITSELF CLIENT-CONTROLLED, which makes every
      // resolveContainedFilePath below it faithfully contain against a
      // directory the caller chose. `folder_slug` reaches a bundle verbatim
      // from req.body (the project POST's `req.body.folder_slug || ...`, and
      // the PATCH's spread), so `folder_slug: '../../../..'` turns a root of
      // D:\WilsonRoot\Projects into D:\ — measured, exactly that.
      //
      // Slugifying HERE and not only at the writers is the load-bearing half:
      // a bundle already on disk may carry a poisoned slug, and fileSlugify
      // strips every character that is not alphanumeric or a space, so a
      // traversal cannot survive it. Idempotent for every legitimate slug
      // (the renderer produces the same form via entityNaming.fileSlugify),
      // so no existing project's folder moves.
      //
      // Pre-existing since the folder tree; S40 is where it stopped being
      // survivable, because the stream route returns ORIGINAL BYTES of ANY
      // type with Range support rather than a 256px JPEG of an image.
      const stored = bundle.project?.folder_slug;
      const safe = stored ? fileSlugify(String(stored)) : '';
      return path.join(rootBase, safe || slug);
    }
    // ── Session 40: the ONE place a managed file's body is located on disk ────
    //
    // Copied from the hard-DELETE's idiom (:2517), which has always used the
    // record's OWN folder_path. The thumbnail route did not — it recomputed
    // `ASSETS/{assetSlug}` — and that is a pre-existing defect, not a style
    // difference: managed files also live under SCENES/ and SHOTS/ (the POST
    // route derives all three), so a scene-attached or shot-attached image has
    // always 410'd at the thumbnail route while sitting perfectly well on disk.
    // The video arm below would have inherited exactly that bug.
    //
    // 🚨 THE LEGACY FALLBACK IS NOT TIDINESS. folder_path is written by the
    // POST route and rewritten by the asset-rename route (:1735-1762), so it is
    // authoritative for every record those wrote — but a record predating it,
    // or one whose rename ran while no root resolved, may not carry it. Falling
    // back to the old computation means this change can only ADD resolutions,
    // never move one: an existing thumbnail that resolves today still resolves.
    //
    // Containment is not optional here. folder_path and stored_name reach this
    // function from disk records a client could once have written (S14/S17,
    // #45 family), so the join is guarded rather than trusted — and an empty
    // stored_name resolves to the project root itself, which
    // resolveContainedFilePath treats as contained.
    function resolveManagedFileDiskPath(bundle, mf) {
      if (!mf?.stored_name) return null;
      const root = resolveProjectFolderRoot(bundle);
      if (!root) return null;
      const segs = String(mf.folder_path || '').split('/').filter(Boolean);
      if (segs.length) {
        return resolveContainedFilePath(root, path.join(...segs, mf.stored_name));
      }
      const asset = (bundle.assets || []).find(a => a.id === mf.asset_id);
      const assetSlug = asset?.folder_slug || fileSlugify(asset?.name || 'Untitled-Asset');
      return resolveContainedFilePath(root, path.join('ASSETS', assetSlug, mf.stored_name));
    }
    function ensureAssetFolder(bundle, assetName) {
      const root = resolveProjectFolderRoot(bundle);
      if (!root) return null;
      const assetsDir = path.join(root, 'ASSETS');
      if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
      const assetSlug = fileSlugify(assetName || 'Untitled-Asset');
      const folderPath = path.join(assetsDir, assetSlug);
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
      return { folderPath, assetSlug };
    }
    // POST — create/upsert asset + create folder
    expressApp.post('/api/rabbit/projects/:projectId/assets', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.assets) bundle.assets = [];
      const row = rabbitTouch({ ...req.body, project_id: req.params.projectId });
      if (!row.folder_slug && row.name) row.folder_slug = fileSlugify(row.name);
      const result = rabbitUpsertInto(bundle.assets, row);
      ensureAssetFolder(bundle, result.name);
      // Session 26: the directory was already being made; now it is also
      // RECORDED, so an asset folder is part of the same tree as a scene's
      // and survives a move to another backend.
      ensureEntityFolderRow(bundle, req.params.projectId, 'asset', result);
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(result);
    });
    // PATCH — update asset + rename folder if name changed
    expressApp.patch('/api/rabbit/projects/:projectId/assets/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.assets) bundle.assets = [];
      const idx = bundle.assets.findIndex(x => x.id === req.params.id);
      if (idx < 0) return rabbitNotFound(res, 'asset');
      const oldAsset = bundle.assets[idx];
      bundle.assets[idx] = { ...oldAsset, ...req.body, id: req.params.id, updated_at: new Date().toISOString() };
      const newAsset = bundle.assets[idx];
      // Rename folder if name changed
      if (req.body.name && req.body.name !== oldAsset.name) {
        const root = resolveProjectFolderRoot(bundle);
        if (root) {
          const oldSlug = oldAsset.folder_slug || fileSlugify(oldAsset.name || 'Untitled-Asset');
          const newSlug = fileSlugify(req.body.name);
          const assetsDir = path.join(root, 'ASSETS');
          if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
          // Session 17 (#45 family): newSlug is fileSlugify output and safe,
          // but oldSlug comes from the stored folder_slug, which the asset
          // POST/PATCH write straight from req.body — so an uncontained
          // oldPath makes this renameSync an arbitrary-directory MOVE.
          const oldPath = resolveContainedFilePath(assetsDir, oldSlug);
          const newPath = path.join(assetsDir, newSlug);
          if (oldPath && fs.existsSync(oldPath) && oldPath !== newPath) {
            try { fs.renameSync(oldPath, newPath); } catch (e) { console.error('folder rename failed:', e.message); }
          } else if (!fs.existsSync(newPath)) {
            fs.mkdirSync(newPath, { recursive: true });
          }
          newAsset.folder_slug = newSlug;
          // Update folder_path on managed files
          if (!bundle.managedFiles) bundle.managedFiles = [];
          const oldPrefix = 'ASSETS/' + oldSlug + '/';
          const newPrefix = 'ASSETS/' + newSlug + '/';
          for (const mf of bundle.managedFiles) {
            if (mf.asset_id === req.params.id && mf.folder_path) {
              mf.folder_path = mf.folder_path.replace(oldPrefix, newPrefix);
            }
          }
        }
      }
      // Session 26: keep the tree in step with the directory this route just
      // renamed. Assets are the one entity where the folder ALREADY moved on
      // rename, which is why folderPaths.js chose "rename moves the folder"
      // for all five — it is the behaviour that was already here, so no
      // existing local project changes.
      ensureEntityFolderRow(bundle, req.params.projectId, 'asset', newAsset);
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(newAsset);
    });
    // DELETE — soft-delete folder to .trash
    expressApp.delete('/api/rabbit/projects/:projectId/assets/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.assets) bundle.assets = [];
      const asset = bundle.assets.find(x => x.id === req.params.id);
      if (asset) {
        const root = resolveProjectFolderRoot(bundle);
        if (root) {
          const slug = asset.folder_slug || fileSlugify(asset.name || 'Untitled-Asset');
          // Contained for the same reason as the rename above: folder_slug
          // is client-writable, and this renameSync moves a directory.
          const folderPath = resolveContainedFilePath(path.join(root, 'ASSETS'), slug);
          if (folderPath && fs.existsSync(folderPath)) {
            const trashDir = path.join(root, '.trash');
            if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
            const ts = Date.now();
            try { fs.renameSync(folderPath, path.join(trashDir, `${slug}_${ts}`)); } catch (e) { console.error('trash move failed:', e.message); }
          }
        }
        // Soft-delete managed files for this asset
        if (!bundle.managedFiles) bundle.managedFiles = [];
        const now = new Date().toISOString();
        for (const mf of bundle.managedFiles) {
          if (mf.asset_id === req.params.id) mf.deleted_at = now;
        }
      }
      rabbitRemoveFrom(bundle.assets, req.params.id);
      writeRabbitBundle(req.params.projectId, bundle);
      res.json({ ok: true });
    });

    rabbitSubentityRoutes('tasks',          'tasks');
    rabbitSubentityRoutes('dependencies',   'dependencies');
    rabbitSubentityRoutes('task-links',     'taskLinks');
    rabbitSubentityRoutes('asset-versions', 'assetVersions');
    rabbitSubentityRoutes('comments',       'comments');
    rabbitSubentityRoutes('ingestion-runs', 'ingestionRuns');
    rabbitSubentityRoutes('team-assignments', 'teamAssignments');
    rabbitSubentityRoutes('budget-versions', 'budgetVersions');
    rabbitSubentityRoutes('expenses',        'expenses');
    rabbitSubentityRoutes('budget-lines',    'budgetLines');
    rabbitSubentityRoutes('budget-actuals',  'budgetActuals');
    rabbitSubentityRoutes('project-rate-overrides', 'projectRateOverrides');
    // Session 26: the four entity types that get their own folders. Assets
    // are the fifth and have their own routes below (they already had folder
    // side-effects before this session).
    rabbitSubentityRoutes('scenes',          'scenes',      'scene');
    rabbitSubentityRoutes('shots',           'shots',       'shot');
    rabbitSubentityRoutes('levels',          'levels',      'level');
    rabbitSubentityRoutes('experiences',     'experiences', 'experience');
    rabbitSubentityRoutes('milestones',      'milestones');

    // ── Folder tree routes (Session 26) ───────────────────────────
    //
    // The Local Server half of the adapter's folder interface. The Supabase
    // half writes rows to public.folders; this writes rows to the bundle AND
    // real directories to disk, which is the difference the whole
    // "backend-agnostic" requirement is about.
    //
    // Note there is no route to CREATE a folder from an arbitrary path. Every
    // folder here comes from a plan — the project's categories, or one
    // entity's own folder — so a client cannot name a directory directly.
    // That, plus resolveContainedFilePath in materializeFolderDirs, is what
    // keeps mkdirSync inside the project.
    expressApp.post('/api/rabbit/projects/:projectId/folders/ensure', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      // Only write when something actually changed. writeRabbitBundle also
      // re-mirrors _DATABASES, so a no-op ensure would rewrite six JSON files
      // to discover the tree was already correct.
      if (ensureProjectFolderRows(bundle, req.params.projectId)) {
        materializeFolderDirs(bundle);
        writeRabbitBundle(req.params.projectId, bundle);
      }
      res.json({ folders: bundle.folders || [] });
    });

    // The project is read from the BUNDLE, never from the request body: the
    // bundle is the copy the folder has to agree with, and a stale render
    // posting its own copy would file the folder under an old name.
    expressApp.post('/api/rabbit/projects/:projectId/folders/ensure-entity', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const { entityType, entityId } = req.body || {};
      const bundleKey = FOLDER_BUNDLE_KEY[entityType];
      if (!bundleKey) return res.status(400).json({ error: `unknown folder entity type: ${entityType}` });
      const entity = (bundle[bundleKey] || []).find(x => x.id === entityId);
      if (!entity) return rabbitNotFound(res, entityType);
      // The sub-entity POST/PATCH routes already call this for the four
      // entity types, and the provider calls it again through the adapter so
      // that the SUPABASE path gets its folder. On Local Server that makes
      // this the second, redundant visit — idempotent, but writeRabbitBundle
      // is not free (it re-mirrors _DATABASES). Only write on a real change.
      const { row, changed } = ensureEntityFolderRow(
        bundle, req.params.projectId, entityType, entity,
      );
      if (changed) {
        materializeFolderDirs(bundle);
        writeRabbitBundle(req.params.projectId, bundle);
      }
      res.json(row);
    });

    // 🚨 This is NOT what a category toggle calls. Toggling scenes_enabled
    // off hides the tab and deletes nothing (Audrey, 2026-08-03) — a
    // disabled category is simply not planned, so its rows survive. This is
    // for a folder a user removes deliberately, and even then only the ROW
    // and its descendants go: the directory on disk is left alone, because
    // nothing in this session deletes a byte of anyone's work.
    expressApp.delete('/api/rabbit/projects/:projectId/folders/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.folders) bundle.folders = [];
      const target = bundle.folders.find(f => f.id === req.params.id);
      if (!target) return rabbitNotFound(res, 'folder');
      // Mirror the parent_id ON DELETE CASCADE the Supabase side gets for
      // free, so the two backends leave the same tree behind.
      const doomed = new Set([target.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const f of bundle.folders) {
          if (!doomed.has(f.id) && f.parent_id && doomed.has(f.parent_id)) {
            doomed.add(f.id);
            grew = true;
          }
        }
      }
      bundle.folders = bundle.folders.filter(f => !doomed.has(f.id));
      writeRabbitBundle(req.params.projectId, bundle);
      res.json({ ok: true, removed: doomed.size });
    });

    // ── The project manifest (Session 26) ─────────────────────────
    //
    // Audrey, 2026-08-03: the project's own details should be "saved in the
    // project folder as a file the system can read".
    //
    // ✅ The DATABASE is authoritative and this file is a generated MIRROR
    // (Audrey, 2026-08-03) — written on change, read only for portability,
    // recovery and handoff, never an input to normal operation.
    //
    // 🚨 THIS IS NOT `_DATABASES/`. That folder holds project.json, team.json,
    // tasks.json, timeline.json and budget.json — a full second datastore,
    // and the reason the mirror rule exists at all. The manifest is ONE file
    // of SETTINGS at the project root, beside ASSETS/ and SCENES/, where a
    // person browsing the folder will actually find it.
    //
    // Per-member rate overrides are excluded here for the same reason as on
    // the Supabase side, even though a local folder is not multi-tenant: two
    // backends producing two different manifests would make the file
    // unportable, which is the one job it has. See projectManifest.js.
    const MANIFEST_FILENAME = 'PROJECT.json';

    function buildProjectManifestFor(bundle) {
      const p = bundle.project || {};
      const omit = new Set([
        'workspace_id', 'created_by', 'updated_by',
        'last_updated_at', 'last_updated_by', 'deleted_at', 'deleted_by',
        'documents', 'visualAssets',
      ]);
      const project = {};
      for (const [k, v] of Object.entries(p)) {
        if (!omit.has(k)) project[k] = v;
      }
      return {
        wilson_manifest_version: 1,
        generated_at: new Date().toISOString(),
        authority: 'database',
        note:
          'Generated MIRROR of the project settings held in WILSON. The database '
          + 'is authoritative: editing this file changes nothing. It exists for '
          + 'portability, recovery and handoff. Importing it is an explicit action '
          + 'in WILSON that shows a diff first.',
        omitted:
          'Per-member rate overrides are NOT included. They are manager-only in '
          + 'WILSON, and this file is readable by everyone who can open the project.',
        project,
        folders: (bundle.folders || []).map(f => ({
          kind: f.kind, path: f.path, slug: f.slug,
          label: f.label || null, entity_type: f.entity_type || null,
        })).sort((a, b) => a.path.localeCompare(b.path)),
        team: (bundle.teamAssignments || []).map(m => ({
          member_id:     m.member_id || m.user_id || null,
          project_role:  m.project_role || null,
          project_title: m.project_title || '',
        })),
        counts: {
          assets:      (bundle.assets      || []).length,
          scenes:      (bundle.scenes      || []).length,
          shots:       (bundle.shots       || []).length,
          levels:      (bundle.levels      || []).length,
          experiences: (bundle.experiences || []).length,
          phases:      (bundle.phases      || []).length,
          tasks:       (bundle.tasks       || []).length,
        },
      };
    }

    expressApp.post('/api/rabbit/projects/:projectId/manifest', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const root = resolveProjectFolder(bundle);
      // No project folder configured yet is not an error — there is simply
      // nowhere to put it. Reported rather than thrown so the caller can say
      // so instead of showing a failure the user cannot act on.
      if (!root) return res.json({ written: false, reason: 'no project folder configured' });
      const target = path.join(root, MANIFEST_FILENAME);
      try {
        writeJSON(target, buildProjectManifestFor(bundle));
        res.json({ written: true, path: target });
      } catch (e) {
        res.status(500).json({ error: `manifest write failed: ${e.message}` });
      }
    });

    // ── The project rates mirror (Session 27) ─────────────────────
    //
    // The third thing Audrey asked for on 2026-08-03 and the one S26 left
    // out. On Supabase it needs a money-gated storage path, because the
    // manifest's path is readable by every project member while the rates
    // themselves are manager-only. Audrey chose a gated file over leaving
    // them app-only (2026-08-04).
    //
    // 🚨 THE SEGMENT AND FILENAME ARE DUPLICATED FROM
    // src/tools/rabbit_v0.1.0/projectRates.js, AND THE DUPLICATE IS
    // UNAVOIDABLE — the main process cannot import from the renderer bundle,
    // exactly as with fileSlugify and FOLDER_CATEGORIES above.
    // folderParity.test.js reads THIS FILE AS TEXT and fails when the two
    // disagree, because a rates file written to a segment the Supabase policy
    // does not recognise is world-readable within the project and nothing
    // errors. On local disk the segment is just a folder name; keeping the two
    // identical is what makes a project folder portable between backends.
    const RATES_SEGMENT  = 'FINANCE';
    const RATES_FILENAME = 'RATES.json';

    function buildProjectRatesFor(bundle) {
      const p = bundle.project || {};
      const overrides = bundle.projectRateOverrides || [];
      return {
        wilson_rates_version: 1,
        generated_at: new Date().toISOString(),
        project_id: p.id || null,
        project_title: p.title || null,
        currency: p.budget_currency || null,
        authority: 'database',
        confidentiality:
          'MANAGER-ONLY. This file lives in a restricted folder because it states '
          + 'what individual people are paid. WILSON serves it only to project '
          + 'managers and workspace admins. Treat a copy taken out of that folder '
          + 'as confidential.',
        note:
          'Generated MIRROR of the project-scoped rate overrides held in WILSON. '
          + 'The database is authoritative: editing this file changes nothing. It '
          + 'exists for portability, recovery and handoff.',
        overrides: overrides.map(o => ({
          scope:      o.member_id ? 'member' : 'role',
          role_slug:  o.role_slug || null,
          member_id:  o.member_id || null,
          day_rate:   o.day_rate ?? null,
          week_rate:  o.week_rate ?? null,
          month_rate: o.month_rate ?? null,
          wage:       o.wage ?? null,
          currency:   o.currency || null,
          notes:      o.notes || '',
        })).sort((a, b) =>
          (a.scope + (a.role_slug || a.member_id || '')).localeCompare(
            b.scope + (b.role_slug || b.member_id || ''))),
        count: overrides.length,
      };
    }

    expressApp.post('/api/rabbit/projects/:projectId/rates-mirror', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const root = resolveProjectFolder(bundle);
      if (!root) return res.json({ written: false, reason: 'no project folder configured' });
      const dir = path.join(root, RATES_SEGMENT);
      try {
        fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, RATES_FILENAME);
        writeJSON(target, buildProjectRatesFor(bundle));
        res.json({ written: true, path: target });
      } catch (e) {
        res.status(500).json({ error: `rates mirror write failed: ${e.message}` });
      }
    });

    // ── Invoice folder resolution ─────────────────────────────────
    // Returns the absolute folder path for crew or talent invoice files.
    // Creates the folder if it doesn't exist yet.
    // Session 24: the POST /invoice-folder route was removed here. It handed
    // the renderer an absolute path on the local disk so the desktop bridge
    // could copy a file into it — which is exactly why invoice attachment
    // could not work on the web. Attachment now goes through the adapter
    // (uploadFile), so both backends and both surfaces share one path, and
    // invoices land in <project>/INVOICES.

    // ── Project Team: project-scoped copy of workspace team members ──
    // Bulk-sync: replaces projectTeam with the provided array of members
    expressApp.post('/api/rabbit/projects/:projectId/project-team/sync', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const members = Array.isArray(req.body.members) ? req.body.members : [];
      const now = new Date().toISOString();
      bundle.projectTeam = members.map(m => ({
        ...m,
        project_id: req.params.projectId,
        synced_at: now,
      }));
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(bundle.projectTeam);
    });
    // GET — list project team members
    expressApp.get('/api/rabbit/projects/:projectId/project-team', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      res.json(bundle.projectTeam || []);
    });
    // Individual CRUD via sub-entity factory
    rabbitSubentityRoutes('project-team',    'projectTeam');

    // ── Files: upload (base64 JSON payload) + download (binary stream) ──
    // Renderer reads File as ArrayBuffer, base64-encodes, POSTs JSON.
    // Server decodes and writes to {project_dir}/files/{file_id}-{name}.
    // Multipart was the original spec but base64 keeps us off a new dep
    // (multer/formidable) and works fine inside the existing 50mb json limit.
    expressApp.post('/api/rabbit/projects/:projectId/files', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const { name, mimeType, sizeBytes, base64, scope = {} } = req.body || {};
      if (!name || !base64) return res.status(400).json({ error: 'name and base64 required' });

      const fileId = uuidv4();
      const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const diskName = `${fileId}-${safeName}`;
      const isFinancial = !!scope.financial;
      const filesDir = isFinancial
        ? resolveProjectInvoicesDir(bundle, req.params.projectId)
        : resolveProjectFilesDir(bundle, req.params.projectId);
      fs.writeFileSync(path.join(filesDir, diskName), Buffer.from(base64, 'base64'));

      const row = rabbitTouch({
        id:               fileId,
        project_id:       req.params.projectId,
        phase_id:         scope.phaseId || null,
        asset_id:         scope.assetId || null,
        task_id:          scope.taskId  || null,
        name,
        mime_type:        mimeType || null,
        size_bytes:       sizeBytes ?? null,
        storage_provider: 'local_server',
        storage_path:     diskName,
        kind:             scope.kind || 'source',
        is_core_definer:  !!scope.isCoreDefiner,
        // Mirrors public.files.is_financial (0038). On Local Server it also
        // decides which directory the body resolves against.
        is_financial:     isFinancial,
        uploaded_at:      new Date().toISOString(),
      });
      bundle.files.push(row);
      rabbitLogFileEvent(bundle, {
        file_id:          row.id,
        project_id:       req.params.projectId,
        file_name:        row.name,
        storage_provider: row.storage_provider,
        event:            'uploaded',
        new_path:         row.storage_path,
        size_bytes:       row.size_bytes ?? null,
      });
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(row);
    });

    expressApp.get('/api/rabbit/projects/:projectId/files/:id/download', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const file = bundle.files.find(f => f.id === req.params.id);
      if (!file) return rabbitNotFound(res, 'file');
      const diskPath = resolveContainedFilePath(
        resolveFileBaseDir(bundle, req.params.projectId, file), file.storage_path);
      if (!diskPath) return res.status(400).json({ error: 'invalid storage path' });
      if (!fs.existsSync(diskPath)) return res.status(410).json({ error: 'file body missing on disk' });
      // S33 (TPN-CONT-008 / TPN-LOG-002, AS-2.9): a read leaves a record.
      // The cloud twin is log_file_downloaded (0047). old_path is the path
      // that was read, matching 'trashed'/'purged' ("the path at event
      // time"). No actor fields: Local Server has no signed-in identity —
      // the loopback bind is the access control. touch:false — a read must
      // not stamp updated_at or rewrite the folder mirrors. The try/catch
      // is the 0027 idiom's local twin: an audit hiccup (disk full, EPERM
      // on the bundle) must not take the read down with it — and never
      // silently: the warn is the instrument (adversarial review, S33).
      try {
        rabbitLogFileEvent(bundle, {
          file_id:          file.id,
          project_id:       req.params.projectId,
          file_name:        file.name,
          storage_provider: file.storage_provider,
          event:            'downloaded',
          old_path:         file.storage_path,
          size_bytes:       file.size_bytes ?? null,
        });
        writeRabbitBundle(req.params.projectId, bundle, { touch: false });
      } catch (e) {
        console.warn('download not logged:', e?.message || e);
      }
      // 🚨 S40: the same guard the new stream route carries, applied here
      // because it is the identical shape one route over — `mime_type` is
      // client-writable and this app's own renderer is served from
      // 127.0.0.1:<port>, so text/html returned here would execute on WILSON's
      // origin. Found while reviewing the stream route; leaving a known,
      // identical hole in the neighbour is the S35 lesson ("guarding a field
      // means guarding whatever outranks it") pointed the other way.
      res.setHeader('Content-Type', safeMediaContentType(file.mime_type));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(diskPath);
    });

    expressApp.patch('/api/rabbit/projects/:projectId/files/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const idx = bundle.files.findIndex(f => f.id === req.params.id);
      if (idx < 0) return rabbitNotFound(res, 'file');
      // Session 14: path fields are NOT patchable here — a crafted
      // storage_path turned download/delete into arbitrary-path fs calls.
      // Path changes go through relink-apply, which containment-checks.
      const { storage_path: _sp, storage_provider: _spr, id: _id, ...patch } = req.body || {};
      bundle.files[idx] = { ...bundle.files[idx], ...patch, id: req.params.id };
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(bundle.files[idx]);
    });

    expressApp.delete('/api/rabbit/projects/:projectId/files/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const file = bundle.files.find(f => f.id === req.params.id);
      if (file) {
        const diskPath = resolveContainedFilePath(
          resolveFileBaseDir(bundle, req.params.projectId, file), file.storage_path);
        // blob_removed keeps the certificate honest: a certificate must
        // not assert a disposal that never happened (uncontained legacy
        // path, or the body was already gone).
        let blobRemoved = false;
        if (diskPath && fs.existsSync(diskPath)) {
          fs.unlinkSync(diskPath);
          blobRemoved = true;
        }
        // Local delete is permanent (no local trash) — certificate it.
        rabbitLogFileEvent(bundle, {
          file_id:          file.id,
          project_id:       req.params.projectId,
          file_name:        file.name,
          storage_provider: file.storage_provider,
          event:            'purged',
          old_path:         file.storage_path,
          size_bytes:       file.size_bytes ?? null,
          blob_removed:     blobRemoved,
        });
      }
      rabbitRemoveFrom(bundle.files, req.params.id);
      writeRabbitBundle(req.params.projectId, bundle);
      res.json({ ok: true });
    });

    // ── Files: lifecycle events + storage relink (Session 14) ──
    // The read side of bundle.fileEvents — the audit drawer's local twin of
    // the cloud file_events table (0027). Newest first.
    expressApp.get('/api/rabbit/projects/:projectId/files/:id/events', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const events = (bundle.fileEvents || []).filter(e => e.file_id === req.params.id);
      events.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      res.json(events);
    });

    // Project-level stream: the per-file route above is unreachable once a
    // row is deleted, but its 'purged' certificate must stay readable
    // (adversarial review, S14). No UI reader yet — a future admin/audit
    // surface; the data is at least reachable.
    expressApp.get('/api/rabbit/projects/:projectId/file-events', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const events = [...(bundle.fileEvents || [])];
      events.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      res.json(events);
    });

    // Relink scan (Block A): which files rows are dangling, and — when the
    // caller supplies a folder — what actually exists there. The walk is
    // recursive with hard caps; matching itself is the client-side pure
    // module (relinkMatcher.js), so this route only reports facts.
    expressApp.post('/api/rabbit/projects/:projectId/files/relink-scan', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const filesDir = resolveProjectFilesDir(bundle, req.params.projectId);
      const missing = [];
      const resolved = [];
      for (const f of bundle.files) {
        // Session 24: invoices live in <project>/INVOICES and are not part of
        // the files home this flow relinks. Including them would report every
        // one as missing — and a relink would then offer to move the
        // project's financial record somewhere else.
        if (f.is_financial) continue;
        const p = resolveContainedFilePath(filesDir, f.storage_path);
        (p && fs.existsSync(p) ? resolved : missing).push({
          id: f.id, name: f.name, storage_path: f.storage_path,
          size_bytes: f.size_bytes ?? null, mime_type: f.mime_type || null,
        });
      }
      const { folderPath } = req.body || {};
      let candidates = null;
      let walkTruncated = false;
      if (folderPath) {
        if (!isUserAuthorizedRelinkDir(bundle, req.params.projectId, folderPath)) {
          return res.status(403).json({ error: 'folder must be chosen with the folder picker' });
        }
        if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
          return res.status(400).json({ error: 'folderPath is not a directory' });
        }
        candidates = [];
        const MAX_ENTRIES = 20000;
        const MAX_DEPTH = 12;
        // Symlinks/junctions are followed (a media folder of links is the
        // normal studio layout) with a realpath visited-set so a link
        // cycle terminates instead of recursing forever.
        const visited = new Set();
        try { visited.add(fs.realpathSync(folderPath).toLowerCase()); } catch {}
        const walk = (dir, rel, depth) => {
          if (depth > MAX_DEPTH || candidates.length >= MAX_ENTRIES) { walkTruncated = true; return; }
          let entries;
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            const abs = path.join(dir, entry.name);
            const rp = rel ? `${rel}/${entry.name}` : entry.name;
            let isDir = entry.isDirectory();
            let isFile = entry.isFile();
            if (entry.isSymbolicLink()) {
              try {
                const st = fs.statSync(abs); // follows the link
                isDir = st.isDirectory();
                isFile = st.isFile();
              } catch { continue; } // dangling link
            }
            if (isDir) {
              let real;
              try { real = fs.realpathSync(abs).toLowerCase(); } catch { continue; }
              if (visited.has(real)) continue;
              visited.add(real);
              walk(abs, rp, depth + 1);
            } else if (isFile) {
              if (candidates.length >= MAX_ENTRIES) { walkTruncated = true; return; }
              let size = null;
              try { size = fs.statSync(abs).size; } catch {}
              candidates.push({ relPath: rp, name: entry.name, size });
            }
          }
        };
        walk(folderPath, '', 0);
      }
      res.json({ filesDir, missing, resolved, candidates, walkTruncated });
    });

    // Relink apply (Block A): the bulk storage_path UPDATE. All-or-nothing —
    // every mapping is containment-checked and stat-verified BEFORE any row
    // changes. If baseDir differs from the current files dir it becomes the
    // project's files home (project.files_dir), refused with a 409 when that
    // would strand rows that still resolve in the current dir — a partial
    // move can never break the files that DIDN'T move.
    expressApp.post('/api/rabbit/projects/:projectId/files/relink-apply', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const { baseDir, mappings } = req.body || {};
      if (!baseDir || !Array.isArray(mappings) || mappings.length === 0) {
        return res.status(400).json({ error: 'baseDir and mappings[] required' });
      }
      if (!isUserAuthorizedRelinkDir(bundle, req.params.projectId, baseDir)) {
        return res.status(403).json({ error: 'folder must be chosen with the folder picker' });
      }
      if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
        return res.status(400).json({ error: 'baseDir is not a directory' });
      }
      // If the project's recorded files home is merely OFFLINE (unplugged
      // drive, dropped share), resolveProjectFilesDir silently falls back —
      // and a relink against the fallback would overwrite files_dir and
      // strand everything that still lives at the recorded home. Refuse
      // until it is reachable again (or reset via Files & Storage).
      const recordedHome = bundle.project?.files_dir;
      if (recordedHome && !fs.existsSync(recordedHome)
          && path.resolve(baseDir).toLowerCase() !== path.resolve(recordedHome).toLowerCase()) {
        return res.status(409).json({
          error: `this project's files live at ${recordedHome}, which is not reachable right now — reconnect it before relinking to a different folder, or reset the files folder in Files & Storage`,
        });
      }
      const currentDir = resolveProjectFilesDir(bundle, req.params.projectId);
      const changingBase = path.resolve(baseDir).toLowerCase() !== path.resolve(currentDir).toLowerCase();

      const byId = new Map(bundle.files.map(f => [f.id, f]));
      const checked = [];
      for (const m of mappings) {
        const file = byId.get(m?.fileId);
        if (!file) return res.status(400).json({ error: `unknown file id: ${m?.fileId}` });
        const abs = resolveContainedFilePath(baseDir, m.newPath);
        if (!abs) return res.status(400).json({ error: `path escapes the picked folder: ${m.newPath}` });
        if (!fs.existsSync(abs)) return res.status(409).json({ error: `not found on disk: ${m.newPath}` });
        checked.push({ file, newPath: String(m.newPath).replace(/\\/g, '/') });
      }

      if (changingBase) {
        const claimedIds = new Set(checked.map(c => c.file.id));
        const stranded = bundle.files.filter(f => {
          if (claimedIds.has(f.id)) return false;
          const cur = resolveContainedFilePath(currentDir, f.storage_path);
          if (!cur || !fs.existsSync(cur)) return false; // already dangling — no worse off
          const next = resolveContainedFilePath(baseDir, f.storage_path);
          return !(next && fs.existsSync(next));
        });
        if (stranded.length > 0) {
          return res.status(409).json({
            error: 'changing the files folder would strand files that still resolve in the current one',
            stranded: stranded.map(f => ({ id: f.id, name: f.name, storage_path: f.storage_path })),
          });
        }
        bundle.project.files_dir = path.resolve(baseDir);
        // Record the base change itself — the old home must stay
        // recoverable from the audit stream (adversarial review, S14).
        rabbitLogFileEvent(bundle, {
          file_id:    null,
          project_id: req.params.projectId,
          file_name:  '(project files folder)',
          event:      'relinked',
          old_path:   currentDir,
          new_path:   bundle.project.files_dir,
        });
      }

      const now = new Date().toISOString();
      for (const { file, newPath } of checked) {
        const oldPath = file.storage_path;
        file.storage_path = newPath;
        file.updated_at = now;
        rabbitLogFileEvent(bundle, {
          file_id:          file.id,
          project_id:       req.params.projectId,
          file_name:        file.name,
          storage_provider: file.storage_provider,
          event:            'relinked',
          old_path:         oldPath,
          new_path:         newPath,
          size_bytes:       file.size_bytes ?? null,
        });
      }
      writeRabbitBundle(req.params.projectId, bundle);
      res.json({
        ok: true,
        relinked: checked.length,
        filesDir: changingBase ? bundle.project.files_dir : currentDir,
      });
    });

    // ── Managed files (asset-folder-based, streaming, versioned) ──
    // These are the production file management routes. Files are copied
    // via IPC (not HTTP) to avoid body-size limits. The Express routes
    // only manage the JSON manifest records in the bundle.
    expressApp.get('/api/rabbit/projects/:projectId/managed-files', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const files = (bundle.managedFiles || []).filter(f => !f.deleted_at);
      res.json(files);
    });

    expressApp.post('/api/rabbit/projects/:projectId/managed-files', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.managedFiles) bundle.managedFiles = [];
      const now = new Date().toISOString();
      const projectSlug = bundle.project?.folder_slug || fileSlugify(bundle.project?.title || 'Untitled');
      const version = getNextVersion(bundle.managedFiles, req.body.file_name, req.body.asset_id, req.body.shot_id, req.body.scene_id);
      const vLabel = formatVersion(version);
      // 🚨 SANITISED. This lands in stored_name, which is joined under the
      // project root, so `/../../../Users/…/secret.docx` walks straight out of
      // the project folder — and since S40 the stream route returns the
      // ORIGINAL BYTES of whatever it resolves to, with Range support and a
      // wildcard CORS header. Measured working before this line existed. The
      // other half of the same traversal is folder_slug (resolveProjectFolderRoot).
      const ext = safeExtension(req.body.extension);
      const fileNameSlug = fileSlugify(req.body.file_name || 'File');
      const storedName = `${projectSlug}_${fileNameSlug}_${vLabel}${ext}`;

      // Build folder_path — scenes use SCENES/{slug}/, shots use SHOTS/{slug}/, assets use ASSETS/{slug}/
      let folderPath;
      if (req.body.scene_id && !req.body.asset_id && !req.body.shot_id) {
        const scene = (bundle.scenes || []).find(s => s.id === req.body.scene_id);
        const sceneSlug = fileSlugify(scene?.name || 'Untitled-Scene');
        folderPath = `SCENES/${sceneSlug}/`;
      } else if (req.body.shot_id && !req.body.asset_id) {
        const shot = (bundle.shots || []).find(s => s.id === req.body.shot_id);
        const shotSlug = fileSlugify(shot?.name || 'Untitled-Shot');
        folderPath = `SHOTS/${shotSlug}/`;
      } else {
        const asset = (bundle.assets || []).find(a => a.id === req.body.asset_id);
        const assetSlug = asset?.folder_slug || fileSlugify(asset?.name || 'Untitled-Asset');
        folderPath = `ASSETS/${assetSlug}/`;
      }

      const row = {
        id:               req.body.id || uuidv4(),
        project_id:       req.params.projectId,
        asset_id:         req.body.asset_id || null,
        shot_id:          req.body.shot_id || null,
        scene_id:         req.body.scene_id || null,
        task_id:          req.body.task_id || null,
        file_name:        req.body.file_name || 'Untitled',
        stored_name:      storedName,
        original_name:    req.body.original_name || '',
        extension:        ext,
        mime_type:        req.body.mime_type || null,
        size_bytes:       req.body.size_bytes || 0,
        version,
        version_label:    vLabel,
        folder_path:      folderPath,
        thumbnail_path:   null,
        uploaded_by:      req.body.uploaded_by || null,
        uploaded_at:      now,
        updated_at:       now,
        deleted_at:       null,
        notes:            req.body.notes || '',
        storage_provider: 'local_managed',
      };
      bundle.managedFiles.push(row);
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(row);
    });

    expressApp.patch('/api/rabbit/projects/:projectId/managed-files/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.managedFiles) bundle.managedFiles = [];
      const idx = bundle.managedFiles.findIndex(f => f.id === req.params.id);
      if (idx < 0) return rabbitNotFound(res, 'managed-file');
      // Session 17: path fields are NOT patchable here — the same class the
      // sibling files PATCH was hardened against in S14 (:1362). A crafted
      // folder_path/stored_name turned the hard-delete and thumbnail routes
      // into arbitrary-path fs calls. Path changes are server-derived on
      // POST, or come from the asset-rename route which rewrites them itself.
      const { folder_path: _fp, stored_name: _sn, storage_provider: _spr, id: _id, ...patch } = req.body || {};
      bundle.managedFiles[idx] = {
        ...bundle.managedFiles[idx],
        ...patch,
        id: req.params.id,
        updated_at: new Date().toISOString(),
      };
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(bundle.managedFiles[idx]);
    });

    expressApp.delete('/api/rabbit/projects/:projectId/managed-files/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.managedFiles) bundle.managedFiles = [];
      const hard = req.query.hard === 'true';
      if (hard) {
        const mf = bundle.managedFiles.find(f => f.id === req.params.id);
        if (mf) {
          // Delete physical file. Contained exactly like the files DELETE
          // (:1371-1382): folder_path and stored_name reach here from disk
          // records that a client could once have written, so the join is
          // guarded rather than trusted. The stored_name check matters —
          // an empty one resolves to the project root itself, which
          // resolveContainedFilePath treats as contained, and we would
          // then attempt to unlink the directory.
          const root = resolveProjectFolderRoot(bundle);
          if (root && mf.stored_name) {
            const diskPath = resolveContainedFilePath(root, path.join(
              ...(mf.folder_path || '').split('/').filter(Boolean),
              mf.stored_name));
            if (diskPath && fs.existsSync(diskPath)) try { fs.unlinkSync(diskPath); } catch {}
          }
          // Delete thumbnail. mf.id is client-chosen on create
          // (`req.body.id || uuidv4()`), so the cache path is attacker-
          // controlled too — contain it against the cache dir.
          const thumbPath = resolveContainedFilePath(getThumbCacheDir(), `${mf.id}.jpg`);
          if (thumbPath && fs.existsSync(thumbPath)) try { fs.unlinkSync(thumbPath); } catch {}
        }
        rabbitRemoveFrom(bundle.managedFiles, req.params.id);
      } else {
        // Soft delete
        const idx = bundle.managedFiles.findIndex(f => f.id === req.params.id);
        if (idx >= 0) bundle.managedFiles[idx].deleted_at = new Date().toISOString();
      }
      writeRabbitBundle(req.params.projectId, bundle);
      res.json({ ok: true });
    });

    // ── Session 40: stream a managed file's bytes, with Range support ────────
    //
    // NETWORK_STORAGE_DESIGN.md §5d.2. Until now there was NO serve route for
    // managed files at all — six routes manage the manifest and none of them
    // sends the body; they are opened through the OS (rabbit:open-in-explorer).
    // So this is the first time WILSON mediates a managed-file READ, which is
    // why the AS-2.9 audit obligation lands here and not before.
    //
    // 🚨 RANGE SUPPORT IS THE WHOLE REASON THIS IS res.sendFile. Without ranges
    // a <video> cannot seek and the browser pulls the entire file before
    // playing — on a 5 GB master that is not a slow preview, it is a hang.
    // express ^5.2.1 -> send 1.2.1, whose acceptRanges defaults true, so
    // `Accept-Ranges: bytes` and 206 responses are automatic. A hand-rolled
    // createReadStream does NOT do this unless Range is implemented explicitly,
    // and that is the single most likely thing to get wrong here. Content-Type
    // is set FIRST and survives: send only fills it in when unset.
    //
    // 🚨 THE COMPLETION CALLBACK IS NOT OPTIONAL ON THIS ROUTE, unlike the
    // files download beside it. A <video> aborts range requests constantly —
    // every seek cancels the one in flight — so ECONNABORTED is the NORMAL
    // case here, not a fault. Without the callback those surface as unhandled
    // stream errors.
    expressApp.get('/api/rabbit/projects/:projectId/managed-files/:id/stream', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      // 🚨 !deleted_at, MATCHING THE LIST ROUTE. FileManager's delete is the
      // SOFT path (deleted_at stamped, body left on disk), so without this a
      // file the user deleted — and which has vanished from every list —
      // carried on streaming in full to anything that could reach the loopback
      // port, and kept minting 'downloaded' audit events for a record that says
      // it is gone. Found by the pre-push adversarial review.
      const mf = (bundle.managedFiles || []).find(f => f.id === req.params.id && !f.deleted_at);
      if (!mf) return rabbitNotFound(res, 'managed-file');
      const diskPath = resolveManagedFileDiskPath(bundle, mf);
      if (!diskPath) return res.status(400).json({ error: 'invalid storage path' });
      if (!fs.existsSync(diskPath)) return res.status(410).json({ error: 'file body missing on disk' });

      // AS-2.9 (TPN-CONT-008 / TPN-LOG-002), carried over from the files
      // download route at :2149 — same event, same old_path semantics ("the
      // path at event time"), same touch:false because a READ must not stamp
      // updated_at or rewrite the folder mirrors, same try/catch because an
      // audit hiccup must not take the read down with it, and never silent.
      //
      // 🚨 THROTTLED, AND THE FILES ROUTE DELIBERATELY IS NOT. A download is
      // one request; a video playback is DOZENS — one per seek and per buffer
      // refill. Logging each would not just be noisy: rabbitLogFileEvent caps
      // fileEvents at 2000 and evicts the oldest NON-purged entries, so one
      // scrub through a long clip would silently push a project's real upload
      // and relink history out of the bundle. One event per file per minute
      // records the FACT of the read, which is what the control asks for.
      //
      // 🚨 AND A THUMBNAIL PROBE IS NOT A READ. ensureManagedVideoThumbnail's
      // renderer fallback points a hidden <video> at this route purely to
      // decode one frame, which is a MACHINE fetch, not a person opening a
      // file. Without `?probe=1` an import of thirty clips wrote thirty
      // 'downloaded' events timestamped at import — asserting in the audit
      // drawer that someone had watched footage nobody had opened, and (because
      // rabbitLogFileEvent evicts the oldest non-'purged' entries at 2000)
      // pushing out the project's real history to do it. That is the exact
      // churn the throttle above exists to prevent, reintroduced by a caller.
      // Found by the pre-push adversarial review.
      const isThumbnailProbe = req.query.probe === '1';
      if (!isThumbnailProbe && shouldLogManagedRead(mf.id)) {
        try {
          rabbitLogFileEvent(bundle, {
            file_id:          mf.id,
            project_id:       req.params.projectId,
            file_name:        mf.file_name || mf.stored_name,
            storage_provider: mf.storage_provider || 'local_managed',
            event:            'downloaded',
            old_path:         `${mf.folder_path || ''}${mf.stored_name}`,
            size_bytes:       mf.size_bytes ?? null,
          });
          writeRabbitBundle(req.params.projectId, bundle, { touch: false });
        } catch (e) {
          console.warn('managed read not logged:', e?.message || e);
        }
      }

      // 🚨 THE Content-Type IS ALLOWLISTED AND SNIFFING IS OFF, and this is a
      // same-origin execution defence rather than tidiness. `mime_type` reaches
      // the record verbatim from req.body (the managed-files POST writes it and
      // the PATCH does not strip it), and the renderer itself is served from
      // http://127.0.0.1:<port> by THIS Express app — so bytes returned as
      // text/html from this route would run as script on WILSON's own origin,
      // with access to that origin's localStorage (the Supabase session) and to
      // all 94 unauthenticated routes. Echoing a client-settable type was the
      // whole of it. Found by the pre-push adversarial review.
      //
      // An allowlist rather than a denylist: anything that is not obviously
      // media is served as an opaque download, which a <video> ignores and a
      // browser cannot execute.
      res.setHeader('Content-Type', safeMediaContentType(mf.mime_type));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(diskPath, (err) => {
        if (!err) return;
        // A cancelled range request is the normal shape of video playback.
        if (res.headersSent || res.writableEnded) return;
        res.status(500).json({ error: 'stream failed' });
      });
    });

    // Thumbnail endpoint — generates + caches a 256px-wide JPEG via sharp
    expressApp.get('/api/rabbit/projects/:projectId/managed-files/:id/thumbnail', async (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const mf = (bundle.managedFiles || []).find(f => f.id === req.params.id);
      if (!mf) return rabbitNotFound(res, 'managed-file');
      // Session 40: video joins raster here. The two arms are NOT the same
      // decoder — sharp cannot open a ProRes MOV — so the branch is explicit
      // rather than a widened extension set feeding one pipeline.
      const isImage = isThumbableExt(mf.extension);
      const isVideo = isVideoExt(mf.extension);
      if (!isImage && !isVideo) {
        return res.status(415).json({ error: 'not an image or video', code: 'unsupported_type' });
      }
      // Session 17 containment (#45). Three of the segments below are
      // client-writable: mf.id (chosen on create), mf.stored_name, and
      // asset.folder_slug (the asset POST/PATCH spread req.body). Each is
      // resolved under its own base and refused on escape, so this route
      // cannot be turned into an arbitrary-file read or .jpg overwrite.
      const thumbPath = resolveContainedFilePath(getThumbCacheDir(), `${mf.id}.jpg`);
      if (!thumbPath) return res.status(400).json({ error: 'invalid thumbnail path' });
      // Serve cached
      if (fs.existsSync(thumbPath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        return res.sendFile(thumbPath);
      }
      // Generate from source file
      const root = resolveProjectFolderRoot(bundle);
      if (!root) return res.status(404).json({ error: 'no file root configured' });
      // Session 40: one resolver, shared with the stream route and modelled on
      // the hard-DELETE's idiom. It reads the record's OWN folder_path, so a
      // managed file under SCENES/ or SHOTS/ finally resolves — this route used
      // to recompute `ASSETS/{assetSlug}` unconditionally and 410'd on both.
      const srcPath = resolveManagedFileDiskPath(bundle, mf);
      if (!srcPath) return res.status(400).json({ error: 'invalid source path' });
      if (!fs.existsSync(srcPath)) return res.status(410).json({ error: 'source file missing' });

      if (isVideo) {
        // 🚨 THE BINARY'S ABSENCE IS A NAMED STATE, NOT A 500. It is today's
        // state on every machine, and the renderer uses this code to decide
        // whether to fall back to decoding the format itself through the
        // stream route. A generic error would make "no decoder installed"
        // indistinguishable from "this file is corrupt".
        if (!ffmpeg.hasFfmpeg()) {
          return res.status(415).json({
            error: 'no video decoder installed on this machine',
            code:  'ffmpeg_missing',
          });
        }
        try {
          const out = await generateVideoThumbOnce(srcPath, thumbPath);
          if (!out.ok) {
            return res.status(422).json({ error: 'could not decode a frame', code: out.reason });
          }
          res.setHeader('Content-Type', 'image/jpeg');
          return res.sendFile(thumbPath);
        } catch (err) {
          console.error('video thumbnail failed:', err?.message || err);
          return res.status(500).json({ error: 'thumbnail generation failed' });
        }
      }

      try {
        await sharp(srcPath).resize(256).jpeg({ quality: 80 }).toFile(thumbPath);
        res.setHeader('Content-Type', 'image/jpeg');
        res.sendFile(thumbPath);
      } catch (err) {
        console.error('thumbnail generation failed:', err.message);
        res.status(500).json({ error: 'thumbnail generation failed' });
      }
    });

    // ── Session 40: accept a frame the RENDERER decoded ──────────────────────
    //
    // The fallback that makes browser-native video work with no ffmpeg
    // installed: the renderer points a hidden <video> at the stream route
    // above, grabs a frame to a canvas, and POSTs the JPEG here. Chromium
    // handles H.264/AAC MP4, VP8/VP9 WebM and AV1 — which is most of what is
    // not professional footage — so this is not a degraded path, it is the
    // same decoder the cloud upload path uses, pointed at a local file.
    //
    // ffmpeg still owns ProRes/DNxHD/MXF, and it is preferred when present
    // because input seeking on local disk beats streaming over HTTP.
    //
    // 🚨 THIS WRITES TO DISK FROM AN UNAUTHENTICATED LOOPBACK SERVER, so it is
    // narrowed in four ways rather than trusted: the row must exist and be a
    // video, the destination is contained under the cache dir by mf.id (which
    // is client-chosen on create — #45 family), the body is capped, and the
    // bytes must actually START WITH A JPEG MAGIC NUMBER. Without that last
    // check this is a "write arbitrary content to a path ending .jpg"
    // primitive, and the GET above would then serve it back with an image
    // Content-Type.
    expressApp.post('/api/rabbit/projects/:projectId/managed-files/:id/thumbnail', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const mf = (bundle.managedFiles || []).find(f => f.id === req.params.id);
      if (!mf) return rabbitNotFound(res, 'managed-file');
      if (!isVideoExt(mf.extension)) {
        return res.status(415).json({ error: 'not a video', code: 'unsupported_type' });
      }
      // 🚨 THE ID MUST BE A BARE UUID — see UUID_RE for why. The thumbnail
      // cache is one flat namespace shared with `asset-<id>.jpg` and
      // `<entity>-<id>.jpg`, and this route is the only one that writes
      // ARBITRARY bytes into it.
      if (!UUID_RE.test(String(mf.id))) {
        return res.status(400).json({ error: 'unsupported file id' });
      }
      const { base64 } = req.body || {};
      if (!base64) return res.status(400).json({ error: 'base64 required' });

      let buf;
      try { buf = Buffer.from(base64, 'base64'); } catch { buf = null; }
      if (!buf || buf.length === 0) return res.status(400).json({ error: 'unreadable body' });
      // Mirrors THUMBNAIL_MAX_BYTES / migration 0053's bucket cap, so the two
      // tiers agree about how big a preview may be.
      if (buf.length > 262144) return res.status(413).json({ error: 'thumbnail too large' });
      if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) {
        return res.status(415).json({ error: 'not a JPEG' });
      }

      const thumbPath = resolveContainedFilePath(getThumbCacheDir(), `${mf.id}.jpg`);
      if (!thumbPath) return res.status(400).json({ error: 'invalid thumbnail path' });
      try {
        fs.writeFileSync(thumbPath, buf);
      } catch (err) {
        console.error('thumbnail write failed:', err?.message || err);
        return res.status(500).json({ error: 'thumbnail write failed' });
      }
      res.json({ ok: true });
    });

    // Does this machine have the professional-codec decoder? The renderer asks
    // once, to decide whether a ProRes row is worth attempting at all and to
    // word the §5f notice honestly ("add it from the desktop app" is a lie if
    // the desktop app has no decoder either).
    expressApp.get('/api/rabbit/video-support', (req, res) => {
      res.json({ ffmpeg: ffmpeg.hasFfmpeg() });
    });

    // ── Asset thumbnail endpoint ──
    // Serves a cached 512px JPEG thumbnail for an asset's thumbnail_image.
    expressApp.get('/api/rabbit/projects/:projectId/assets/:id/thumbnail', async (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const asset = (bundle.assets || []).find(a => a.id === req.params.id);
      if (!asset) return rabbitNotFound(res, 'asset');
      if (!asset.thumbnail_image) return res.status(404).json({ error: 'no thumbnail set' });

      const thumbDir = getThumbCacheDir();
      const thumbPath = path.join(thumbDir, `asset-${asset.id}.jpg`);

      // Serve cached version if it exists and source hasn't changed
      if (fs.existsSync(thumbPath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.sendFile(thumbPath);
      }

      // Generate from source
      const srcPath = asset.thumbnail_image;
      if (!fs.existsSync(srcPath)) return res.status(410).json({ error: 'source image missing' });

      try {
        await sharp(srcPath).resize(512).jpeg({ quality: 85 }).toFile(thumbPath);
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.sendFile(thumbPath);
      } catch (err) {
        console.error('asset thumbnail generation failed:', err.message);
        res.status(500).json({ error: 'thumbnail generation failed' });
      }
    });

    // ── Generic entity thumbnail endpoints (scene, shot, level, experience) ──
    for (const etype of ['scenes', 'shots', 'levels', 'experiences']) {
      const singular = etype.replace(/s$/, ''); // 'scene', 'shot', 'level', 'experience'
      expressApp.get(`/api/rabbit/projects/:projectId/${etype}/:id/thumbnail`, async (req, res) => {
        const bundle = readRabbitBundle(req.params.projectId);
        if (!bundle) return rabbitNotFound(res);
        const list = bundle[etype] || [];
        const entity = list.find(e => e.id === req.params.id);
        if (!entity) return rabbitNotFound(res, singular);
        if (!entity.thumbnail_image) return res.status(404).json({ error: 'no thumbnail set' });

        const thumbDir = getThumbCacheDir();
        const thumbPath = path.join(thumbDir, `${singular}-${entity.id}.jpg`);

        if (fs.existsSync(thumbPath)) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=60');
          return res.sendFile(thumbPath);
        }

        const srcPath = entity.thumbnail_image;
        if (!fs.existsSync(srcPath)) return res.status(410).json({ error: 'source image missing' });

        try {
          await sharp(srcPath).resize(512).jpeg({ quality: 85 }).toFile(thumbPath);
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=60');
          res.sendFile(thumbPath);
        } catch (err) {
          console.error(`${singular} thumbnail generation failed:`, err.message);
          res.status(500).json({ error: 'thumbnail generation failed' });
        }
      });
    }

    // Import existing folder structure into managed files manifest
    expressApp.post('/api/rabbit/projects/:projectId/managed-files/import-folder', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.managedFiles) bundle.managedFiles = [];
      const { folderPath } = req.body;
      if (!folderPath || !fs.existsSync(folderPath)) {
        return res.status(400).json({ error: 'folderPath does not exist' });
      }
      // Session 17: same body-supplied-folder shape the relink routes gate
      // (:1444). Without this, anything that can reach the loopback port can
      // enumerate filenames under any directory the app can read. A folder
      // the user picked through the OS dialog IS the authorization.
      if (!isUserAuthorizedRelinkDir(bundle, req.params.projectId, folderPath)) {
        return res.status(403).json({ error: 'folder not authorized by the user' });
      }
      const now = new Date().toISOString();
      const projectSlug = bundle.project?.folder_slug || fileSlugify(bundle.project?.title || 'Untitled');
      const created = [];
      // Scan top-level subdirs as asset folders
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === '_manifest.json') continue;
        const assetSlug = entry.name;
        // Find or create matching asset
        let asset = (bundle.assets || []).find(a =>
          (a.folder_slug || fileSlugify(a.name || '')) === assetSlug
        );
        if (!asset) {
          asset = rabbitTouch({ name: assetSlug.replace(/-/g, ' '), type: 'other', status: 'not_started', folder_slug: assetSlug, project_id: req.params.projectId });
          if (!bundle.assets) bundle.assets = [];
          bundle.assets.push(asset);
        }
        // Scan files inside the asset folder
        const assetDir = path.join(folderPath, assetSlug);
        const files = fs.readdirSync(assetDir, { withFileTypes: true });
        for (const file of files) {
          if (!file.isFile() || file.name.startsWith('.')) continue;
          const ext = path.extname(file.name);
          const baseName = path.basename(file.name, ext);
          const stats = fs.statSync(path.join(assetDir, file.name));
          const row = {
            id:               uuidv4(),
            project_id:       req.params.projectId,
            asset_id:         asset.id,
            task_id:          null,
            file_name:        baseName,
            stored_name:      file.name,
            original_name:    file.name,
            extension:        ext,
            mime_type:        null,
            size_bytes:       stats.size,
            version:          1,
            version_label:    'v001',
            folder_path:      `ASSETS/${assetSlug}/`,
            thumbnail_path:   null,
            uploaded_by:      null,
            uploaded_at:      now,
            updated_at:       now,
            deleted_at:       null,
            notes:            '',
            storage_provider: 'local_managed',
          };
          bundle.managedFiles.push(row);
          created.push(row);
        }
      }
      writeRabbitBundle(req.params.projectId, bundle);
      res.json({ imported: created.length, files: created });
    });

    // ── Ingestion chunks (live in their own array on the bundle) ──
    expressApp.post('/api/rabbit/projects/:projectId/ingestion-chunks', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.ingestionChunks) bundle.ingestionChunks = [];
      const row = rabbitTouch({ ...req.body });
      rabbitUpsertInto(bundle.ingestionChunks, row);
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(row);
    });
    expressApp.patch('/api/rabbit/projects/:projectId/ingestion-chunks/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.ingestionChunks) bundle.ingestionChunks = [];
      const idx = bundle.ingestionChunks.findIndex(c => c.id === req.params.id);
      if (idx < 0) return rabbitNotFound(res, 'chunk');
      bundle.ingestionChunks[idx] = { ...bundle.ingestionChunks[idx], ...req.body, id: req.params.id };
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(bundle.ingestionChunks[idx]);
    });
    expressApp.get('/api/rabbit/projects/:projectId/ingestion-runs/:runId/chunks', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const chunks = (bundle.ingestionChunks || []).filter(c => c.run_id === req.params.runId);
      res.json(chunks);
    });

    // ── Rate cards (workspace-scoped, separate from project bundles) ──
    function getRateCardsDir() {
      const dir = path.join(getRabbitDataDir(), 'rate-cards');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    function rateCardPath(id) { return path.join(getRateCardsDir(), `${id}.json`); }

    expressApp.get('/api/rabbit/workspaces/:workspaceId/rate-cards', (req, res) => {
      const dir = getRateCardsDir();
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const list = files.map(f => readJSON(path.join(dir, f), null)).filter(Boolean)
        .filter(card => card.card?.workspace_id === req.params.workspaceId);
      res.json(list.map(c => c.card));
    });
    expressApp.post('/api/rabbit/workspaces/:workspaceId/rate-cards', (req, res) => {
      const card = rabbitTouch({ ...req.body, workspace_id: req.params.workspaceId });
      const existing = readJSON(rateCardPath(card.id), null);
      const stored = { card, entries: existing?.entries || [] };
      writeJSON(rateCardPath(card.id), stored);
      res.json(card);
    });
    expressApp.delete('/api/rabbit/rate-cards/:id', (req, res) => {
      const p = rateCardPath(req.params.id);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      res.json({ ok: true });
    });
    expressApp.get('/api/rabbit/rate-cards/:id/entries', (req, res) => {
      const stored = readJSON(rateCardPath(req.params.id), null);
      res.json(stored?.entries || []);
    });
    expressApp.post('/api/rabbit/rate-cards/:id/entries', (req, res) => {
      const stored = readJSON(rateCardPath(req.params.id), null);
      if (!stored) return rabbitNotFound(res, 'rate card');
      const entry = rabbitTouch({ ...req.body, rate_card_id: req.params.id });
      rabbitUpsertInto(stored.entries, entry);
      writeJSON(rateCardPath(req.params.id), stored);
      res.json(entry);
    });
    expressApp.delete('/api/rabbit/rate-cards/:id/entries/:entryId', (req, res) => {
      const stored = readJSON(rateCardPath(req.params.id), null);
      if (!stored) return rabbitNotFound(res, 'rate card');
      rabbitRemoveFrom(stored.entries, req.params.entryId);
      writeJSON(rateCardPath(req.params.id), stored);
      res.json({ ok: true });
    });

    // ── Department defaults (per rate card) ────────
    expressApp.get('/api/rabbit/rate-cards/:id/dept-defaults', (req, res) => {
      const stored = readJSON(rateCardPath(req.params.id), null);
      res.json(stored?.dept_defaults || []);
    });
    expressApp.post('/api/rabbit/rate-cards/:id/dept-defaults', (req, res) => {
      const stored = readJSON(rateCardPath(req.params.id), null);
      if (!stored) return rabbitNotFound(res, 'rate card');
      if (!stored.dept_defaults) stored.dept_defaults = [];
      const dept = req.body.department;
      const idx = stored.dept_defaults.findIndex(d => d.department === dept);
      if (idx >= 0) {
        stored.dept_defaults[idx] = { ...stored.dept_defaults[idx], ...req.body };
      } else {
        stored.dept_defaults.push(req.body);
      }
      writeJSON(rateCardPath(req.params.id), stored);
      res.json(stored.dept_defaults);
    });

    // ── Team members (workspace-scoped, like rate cards) ────────
    function getTeamMembersDir() {
      const dir = path.join(getRabbitDataDir(), 'team-members');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    function teamMemberPath(id) { return path.join(getTeamMembersDir(), `${id}.json`); }

    expressApp.get('/api/rabbit/workspaces/:workspaceId/team-members', (req, res) => {
      const dir = getTeamMembersDir();
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const list = files.map(f => readJSON(path.join(dir, f), null)).filter(Boolean)
        .filter(m => m.workspace_id === req.params.workspaceId);
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      res.json(list);
    });
    expressApp.post('/api/rabbit/workspaces/:workspaceId/team-members', (req, res) => {
      const member = rabbitTouch({ ...req.body, workspace_id: req.params.workspaceId });
      writeJSON(teamMemberPath(member.id), member);
      res.json(member);
    });
    expressApp.patch('/api/rabbit/team-members/:id', (req, res) => {
      const existing = readJSON(teamMemberPath(req.params.id), null);
      if (!existing) return rabbitNotFound(res, 'team member');
      const updated = { ...existing, ...req.body, id: req.params.id, updated_at: new Date().toISOString() };
      writeJSON(teamMemberPath(updated.id), updated);
      res.json(updated);
    });
    expressApp.delete('/api/rabbit/team-members/:id', (req, res) => {
      const p = teamMemberPath(req.params.id);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      res.json({ ok: true });
    });

    // ── Task templates (workspace-scoped, like rate cards) ────────
    function getTaskTemplatesDir() {
      const dir = path.join(getRabbitDataDir(), 'task-templates');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    function taskTemplatePath(id) { return path.join(getTaskTemplatesDir(), `${id}.json`); }

    // List global templates for a workspace
    expressApp.get('/api/rabbit/workspaces/:workspaceId/task-templates', (req, res) => {
      const dir = getTaskTemplatesDir();
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const list = files.map(f => readJSON(path.join(dir, f), null)).filter(Boolean)
        .filter(t => t.workspace_id === req.params.workspaceId);
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      res.json(list);
    });

    // List templates available to a project (global + project-specific)
    expressApp.get('/api/rabbit/projects/:projectId/task-templates', (req, res) => {
      const dir = getTaskTemplatesDir();
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const all = files.map(f => readJSON(path.join(dir, f), null)).filter(Boolean);
      // Return global (no project_id) + project-specific
      const list = all.filter(t => !t.project_id || t.project_id === req.params.projectId);
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      res.json(list);
    });

    expressApp.post('/api/rabbit/workspaces/:workspaceId/task-templates', (req, res) => {
      const template = rabbitTouch({ ...req.body, workspace_id: req.params.workspaceId });
      writeJSON(taskTemplatePath(template.id), template);
      res.json(template);
    });

    expressApp.patch('/api/rabbit/task-templates/:id', (req, res) => {
      const existing = readJSON(taskTemplatePath(req.params.id), null);
      if (!existing) return rabbitNotFound(res, 'task template');
      const updated = { ...existing, ...req.body, id: req.params.id, updated_at: new Date().toISOString() };
      writeJSON(taskTemplatePath(updated.id), updated);
      res.json(updated);
    });

    expressApp.delete('/api/rabbit/task-templates/:id', (req, res) => {
      const p = taskTemplatePath(req.params.id);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      res.json({ ok: true });
    });

    // ── PDF text extraction (used by RABBIT intake pipeline) ──
    // Accepts a JSON body with `{ name, dataUrl }` where `dataUrl` is a
    // base64 data URL of the PDF. Returns `{ text, numPages }`. We
    // lazy-load pdf-parse so server startup isn't penalized when no
    // intake is running.
    expressApp.post('/api/extract-pdf', async (req, res) => {
      try {
        const { dataUrl, name } = req.body || {};
        if (!dataUrl || typeof dataUrl !== 'string') {
          return res.status(400).json({ error: 'dataUrl is required' });
        }
        const comma = dataUrl.indexOf(',');
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        const buffer = Buffer.from(base64, 'base64');
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(buffer);
        res.json({
          name: name || null,
          text: data.text || '',
          numPages: data.numpages || 0,
        });
      } catch (err) {
        console.error('[RABBIT] /api/extract-pdf failed:', err);
        res.status(500).json({ error: err.message || 'extract-pdf failed' });
      }
    });

    // ── The bin system (demo 2026-09-11) — electron/rabbitBins.cjs ────────────
    // Mounted with its helpers INJECTED: they are closures over this server
    // (readRabbitBundle reconciles on read, generateVideoThumbOnce dedupes
    // ffmpeg runs), so passing them is the alternative to copying them.
    // 🚨 BEFORE the static/SPA fallback below: '/{*splat}' answers every
    // request that reaches it, so a route mounted after it never runs
    // (measured: every bins route 404'd with send's NotFoundError).
    require('./rabbitBins.cjs').mountRabbitBins(expressApp, {
      readRabbitBundle, writeRabbitBundle, rabbitTouch, rabbitUpsertInto, rabbitRemoveFrom, rabbitNotFound,
      getThumbCacheDir, generateVideoThumbOnce, safeMediaContentType,
      userAuthorizedDirs, dialog, shell, getMainWindow: () => mainWindow,
    });

    // ── Static file serving (SPA fallback) ──
    expressApp.use(express.static(distPath));
    expressApp.get('/{*splat}', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });

    const server = expressApp.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });

    server.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════════
//  ELECTRON WINDOW
// ═══════════════════════════════════════════════════════════════════
let mainWindow;
let localServer;

async function createWindow() {
  const distPath = path.join(__dirname, '..', 'dist');

  const { server, port } = await startLocalServer(distPath);
  localServer = server;

  const iconPath = path.join(__dirname, '..', 'public', 'logo.ico');
  const hasIcon = fs.existsSync(iconPath);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    autoHideMenuBar: true,
    icon: hasIcon ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      // Allow the startup chime (AuthShell) to play without requiring a user
      // gesture. Chrome's default blocks autoplay.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  // Block browser refresh — reset zoom instead
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isCtrl = input.control || input.meta;
    if ((isCtrl && input.key.toLowerCase() === 'r') || input.key === 'F5') {
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(0);
      mainWindow.webContents.send('zoom-reset-notify', 0);
    }
  });

  // Open external links in system browser instead of new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('close', (e) => {
    if (mainWindow._forceClose) return;
    e.preventDefault();
    mainWindow.webContents.send('close-requested');
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── RABBIT config IPC ──
// Supabase credentials used to live here as read/write/clear handlers
// against {userData}/rabbit-data/supabase.json. Session 2 removed that
// per-project fallback — the shared auth client is the only source of
// Supabase credentials now. See src/cloud/auth/supabaseClient.js.
// Best-effort cleanup for stale pre-Session-2 config files is handled
// on app startup (see cleanupLegacySupabaseConfig below).

// One-shot cleanup: delete any pre-Session-2 supabase.json left on disk
// so nothing stale can be loaded. Idempotent; safe on every launch.
// Must run after app.whenReady() because getRabbitDataDir → app.getPath.
function cleanupLegacySupabaseConfig() {
  try {
    const cfgPath = path.join(getRabbitDataDir(), 'supabase.json');
    if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
  } catch { /* best-effort; never block startup */ }
}

// Session 15 (MASTER_PLAN §6 #32): delete the legacy local credential file.
// The routes that read otter-data/wilson-auth.json are gone, but deleting
// code does not delete data — every existing install still has a plaintext
// uppercase password sitting at rest, which is a TPN finding on its own
// (TPN-ENC-003) regardless of whether anything reads it. Same best-effort
// shape as the Supabase-config cleanup above: a failure here must never
// stop the app from starting.
function cleanupLegacyAuthFile() {
  try {
    const authPath = path.join(getDataDir(), 'wilson-auth.json');
    if (fs.existsSync(authPath)) fs.unlinkSync(authPath);
  } catch { /* best-effort; never block startup */ }
}

// ── RABBIT Google Drive credentials IPC ──
// gdrive-config.json holds { clientId, clientSecret, redirectUri, rootFolderId }
// gdrive-tokens.json holds { accessToken, refreshToken, expiresAt }
// Both are written by the Settings/Connect flow and consumed by the
// googleDriveAdapter in the renderer.
ipcMain.handle('rabbit:read-gdrive-config', () => {
  return readJSON(path.join(getRabbitDataDir(), 'gdrive-config.json'), null);
});
ipcMain.handle('rabbit:write-gdrive-config', (_event, cfg) => {
  if (!cfg || typeof cfg !== 'object') throw new Error('rabbit:write-gdrive-config: payload must be an object');
  writeJSON(path.join(getRabbitDataDir(), 'gdrive-config.json'), cfg);
  return { ok: true };
});
ipcMain.handle('rabbit:read-gdrive-tokens', () => {
  return readJSON(path.join(getRabbitDataDir(), 'gdrive-tokens.json'), null);
});
ipcMain.handle('rabbit:write-gdrive-tokens', (_event, tokens) => {
  if (!tokens || typeof tokens !== 'object') throw new Error('rabbit:write-gdrive-tokens: payload must be an object');
  writeJSON(path.join(getRabbitDataDir(), 'gdrive-tokens.json'), tokens);
  return { ok: true };
});
ipcMain.handle('rabbit:clear-gdrive', () => {
  for (const f of ['gdrive-config.json', 'gdrive-tokens.json']) {
    const p = path.join(getRabbitDataDir(), f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  return { ok: true };
});

// ── RABBIT file management IPC ──────────────────────────────
// Config: read/write the default root directory for project files.
// ── Data migration: archive + clear local rabbit-data ──
// Fired by MigrationPanel after a successful cloud migration. Snapshots the
// entire rabbit-data tree (minus binary files; they're already in Storage)
// to a timestamped bundle under rabbit-data/archives/, then removes the
// live projects/ and thumbnails/ subtrees. Idempotent.
ipcMain.handle('rabbit:archive-local-data', () => {
  try {
    const rabbitDir = getRabbitDataDir();
    const projectsDir = path.join(rabbitDir, 'projects');
    const thumbsDir   = path.join(rabbitDir, 'thumbnails');
    const archivesDir = path.join(rabbitDir, 'archives');
    if (!fs.existsSync(archivesDir)) fs.mkdirSync(archivesDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshot = { archivedAt: ts, projects: [] };

    if (fs.existsSync(projectsDir)) {
      for (const projectId of fs.readdirSync(projectsDir)) {
        const pjson = path.join(projectsDir, projectId, 'project.json');
        if (!fs.existsSync(pjson)) continue;
        try {
          const bundle = JSON.parse(fs.readFileSync(pjson, 'utf-8'));
          snapshot.projects.push(bundle);
        } catch { /* corrupt bundle — skip */ }
      }
    }

    const archivePath = path.join(archivesDir, `rabbit-data-${ts}.json`);
    fs.writeFileSync(archivePath, JSON.stringify(snapshot, null, 2), 'utf-8');

    // Clear live stores. Binary files are already uploaded to Supabase Storage.
    fs.rmSync(projectsDir, { recursive: true, force: true });
    fs.rmSync(thumbsDir,   { recursive: true, force: true });

    return { ok: true, archivePath, projectCount: snapshot.projects.length };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// effectiveRootDir is COMPUTED, never stored: it is the root this machine
// currently resolves under (workspace root when pushed, else the machine
// default). FileManager's renderer-side path building must agree with the
// main-process resolvers or the two halves of one feature point at
// different folders (S34 review finding).
ipcMain.handle('rabbit:read-files-config', () => ({
  ...readFilesConfig(),
  effectiveRootDir: resolveConfiguredRootDir(),
}));
ipcMain.handle('rabbit:write-files-config', (_event, cfg) => {
  if (!cfg || typeof cfg !== 'object') throw new Error('payload must be an object');
  // Strip the computed key: a caller that spreads a read back into a write
  // (StorageConnections does) must not persist it into files-config.json.
  const { effectiveRootDir: _computed, ...rest } = cfg;
  writeFilesConfig({ ...readFilesConfig(), ...rest });
  return { ok: true };
});

// ── Session 34: the workspace storage root ──────────────────────────
// The renderer pushes workspace_storage.root_path (byos mode) here after
// sign-in / workspace switch, and null on sign-out. See the workspaceRootDir
// declaration for why this is memory-only. IPC, not Express, deliberately:
// the Express server answers any local origin (cors()), and a drive-by page
// must not be able to repoint the whole machine's resolution (the S14 rule
// that made relink folders user-chosen applies to roots doubly).
ipcMain.handle('rabbit:set-workspace-root', (_event, opts) => {
  const raw = opts && typeof opts.rootPath === 'string' ? opts.rootPath.trim() : null;
  const kind = opts && typeof opts.rootKind === 'string' ? opts.rootKind : null;
  if (!raw) {
    workspaceRootDir = null;
    return { ok: true, rootPath: null };
  }
  // Only an absolute drive path or a UNC path can be a root. A relative or
  // drive-relative value would be silently REBASED onto process.cwd() by
  // path.resolve below, storing a root nobody chose (S34 review).
  const isUnc = /^[\\/]{2}/.test(raw);
  const isDrive = /^[A-Za-z]:[\\/]/.test(raw);
  if (!isUnc && !isDrive) {
    workspaceRootDir = null;
    return { ok: false, error: 'the storage root must be an absolute \\\\server\\share or drive path' };
  }
  // Canonical form: resolved, no trailing separator. Bare roots are refused
  // in depth, not only at the UI: 'C:' (a stripped 'C:\') is drive-relative
  // and never valid, and a two-component \\server\share hands WILSON the
  // whole share — the same refusals the save pipeline makes (S34 review:
  // the first draft refused the drive root and let the share root through).
  const stripped = path.resolve(raw).replace(/[\\/]+$/, '');
  if (!stripped || /^[A-Za-z]:$/.test(stripped)) {
    workspaceRootDir = null;
    return { ok: false, error: 'a drive or share root cannot be the storage root' };
  }
  if (isUnc) {
    const comps = stripped.replace(/^[\\/]+/, '').split(/[\\/]+/).filter(Boolean);
    if (comps.length < 3) {
      workspaceRootDir = null;
      return { ok: false, error: 'a bare \\\\server\\share cannot be the storage root — use a subfolder' };
    }
  }
  // A 'local'-kind root is §3.1 in a database row: the same string names a
  // DIFFERENT folder on every machine. Apply it only where it actually
  // exists — the solo machine that configured it — and fall back to the
  // machine default everywhere else. existsSync is safe here: local kind
  // means no SMB hang.
  if (kind === 'local' && !fs.existsSync(stripped)) {
    workspaceRootDir = null;
    return { ok: true, rootPath: null, skipped: 'local-kind root is not present on this machine' };
  }
  workspaceRootDir = stripped;
  return { ok: true, rootPath: stripped };
});

// Reachability probe, run at CONFIGURATION time (Admin Terminal → Storage)
// so an unreachable share fails with a sentence a person can act on — not at
// the first download, six screens away. Async fs throughout: a dead SMB path
// can hang a synchronous stat for the OS timeout, and that would freeze the
// main process. The race bounds the WAIT, not the operation (withTimeout
// lesson) — fine here because this is one-shot and config-time.
ipcMain.handle('rabbit:probe-storage-root', async (_event, opts) => {
  const p = opts && typeof opts.path === 'string' ? opts.path.trim() : '';
  if (!p) return { ok: false, error: 'no path given' };
  const withDeadline = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ]);

  // A drive-letter path may be a NETWORK MAPPING (Z:), which names a
  // different folder on every machine and must be refused (§3.3). Exit code
  // of `net use X:` is the locale-independent signal: 0 = redirected drive.
  let driveKind = 'unknown';
  const letterMatch = /^([A-Za-z]):[\\/]/.exec(p);
  if (process.platform === 'win32') {
    if (/^[\\/]{2}/.test(p)) {
      driveKind = 'unc';
    } else if (letterMatch) {
      driveKind = await new Promise((resolve) => {
        execFile('net', ['use', `${letterMatch[1]}:`], { timeout: 4000 }, (err) => {
          if (!err) return resolve('network');
          // A numeric exit code means net.exe RAN and said "not a mapping".
          // ENOENT / a killed timeout means we could not ask — that must
          // classify as 'unknown', not 'local', or the mapped-drive refusal
          // silently vanishes exactly when detection breaks (S34 review:
          // the first draft failed open here).
          resolve(typeof err.code === 'number' ? 'local' : 'unknown');
        });
      });
    }
  }

  const started = Date.now();
  const result = { ok: false, exists: false, readable: false, writable: false, driveKind, roundTripMs: null };
  try {
    const st = await withDeadline(fs.promises.stat(p), 5000);
    result.exists = st.isDirectory();
    if (!result.exists) { result.error = 'the path exists but is not a folder'; return result; }
  } catch (err) {
    result.error = err.message === 'timed out'
      ? 'the path did not answer within 5 seconds'
      : 'the path does not exist or is not reachable from this computer';
    return result;
  }
  try {
    await withDeadline(fs.promises.readdir(p), 5000);
    result.readable = true;
  } catch { /* readable stays false */ }
  // The honest writability probe is a real write: access(W_OK) lies on
  // network shares, where the share-level ACL wins over the NTFS answer.
  const probeFile = path.join(p, `.wilson-probe-${Date.now()}-${process.pid}`);
  try {
    await withDeadline(fs.promises.writeFile(probeFile, 'wilson storage probe'), 5000);
    result.writable = true;
  } catch { /* writable stays false */ }
  // Clean up REGARDLESS of the race outcome: a write that lost its deadline
  // may still land after the timeout and would otherwise strand a probe file
  // on the share (S34 review). Detached on purpose — cleanup must not block
  // the probe's answer.
  fs.promises.unlink(probeFile).catch(() => {});
  result.roundTripMs = Date.now() - started;
  result.ok = result.exists && result.readable && result.writable;
  if (!result.ok && !result.error) {
    result.error = !result.readable
      ? 'the folder cannot be read from this computer'
      : 'the folder cannot be written from this computer';
  }
  return result;
});

// Directory picker: opens OS file explorer dialog to select a folder.
ipcMain.handle('rabbit:pick-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select folder location',
  });
  if (result.canceled || !result.filePaths.length) return null;
  // Session 14: a dialog pick IS the user's authorization — the relink
  // routes accept only folders recorded here (or the project's own roots).
  userAuthorizedDirs.add(path.resolve(result.filePaths[0]).toLowerCase());
  return result.filePaths[0];
});

// File picker: opens OS file explorer dialog to select files.
ipcMain.handle('rabbit:pick-files', async () => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Select files to add',
  });
  if (result.canceled) return [];
  return result.filePaths;
});

// Streaming file copy: copies a file from source to destination using
// streams for multi-GB support. Reports progress via IPC events.
ipcMain.handle('rabbit:copy-file', async (event, { sourcePath, destDir, destFileName }) => {
  if (!fs.existsSync(sourcePath)) throw new Error('source file does not exist');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const finalPath = path.join(destDir, destFileName);

  const stat = fs.statSync(sourcePath);
  const totalBytes = stat.size;

  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(sourcePath);
    const writeStream = fs.createWriteStream(finalPath);
    let bytesCopied = 0;
    let lastProgressPct = 0;

    readStream.on('data', (chunk) => {
      bytesCopied += chunk.length;
      const pct = Math.round((bytesCopied / totalBytes) * 100);
      // Only send progress at each 1% increment to avoid flooding IPC
      if (pct > lastProgressPct) {
        lastProgressPct = pct;
        try {
          event.sender.send('rabbit:copy-progress', {
            fileName: destFileName,
            bytesCopied,
            totalBytes,
            percent: pct,
          });
        } catch { /* window may be closed */ }
      }
    });

    readStream.on('error', (err) => {
      writeStream.destroy();
      reject(err);
    });

    writeStream.on('error', (err) => {
      readStream.destroy();
      reject(err);
    });

    writeStream.on('finish', () => {
      resolve({ ok: true, finalPath, bytesWritten: bytesCopied });
    });

    readStream.pipe(writeStream);
  });
});

// Get file stats without reading the file
ipcMain.handle('rabbit:get-file-stats', (_event, { filePath }) => {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return { size: stat.size, mtime: stat.mtime.toISOString(), isFile: stat.isFile() };
});

// Open file or folder in OS file explorer
ipcMain.handle('rabbit:open-in-explorer', (_event, { filePath }) => {
  if (fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  return { ok: true };
});

// Pick an image file for asset thumbnail
ipcMain.handle('rabbit:pick-image', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select thumbnail image',
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'avif'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// Set asset thumbnail: picks source path, generates cached thumbnail via sharp.
// Call AFTER updating the asset's thumbnail_image property in the bundle.
ipcMain.handle('rabbit:generate-asset-thumbnail', async (_event, { assetId, sourcePath }) => {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('source image does not exist');
  }
  const thumbDir = getThumbCacheDir();
  const thumbPath = path.join(thumbDir, `asset-${assetId}.jpg`);
  await sharp(sourcePath).resize(512).jpeg({ quality: 85 }).toFile(thumbPath);
  return { ok: true, thumbPath };
});

// Clear a cached asset thumbnail
ipcMain.handle('rabbit:clear-asset-thumbnail', (_event, { assetId }) => {
  const thumbPath = path.join(getThumbCacheDir(), `asset-${assetId}.jpg`);
  if (fs.existsSync(thumbPath)) try { fs.unlinkSync(thumbPath); } catch {}
  return { ok: true };
});

// Generic entity thumbnail — works for scene, shot, level, experience
ipcMain.handle('rabbit:generate-entity-thumbnail', async (_event, { entityType, entityId, sourcePath }) => {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('source image does not exist');
  }
  const thumbDir = getThumbCacheDir();
  const thumbPath = path.join(thumbDir, `${entityType}-${entityId}.jpg`);
  await sharp(sourcePath).resize(512).jpeg({ quality: 85 }).toFile(thumbPath);
  return { ok: true, thumbPath };
});

ipcMain.handle('rabbit:clear-entity-thumbnail', (_event, { entityType, entityId }) => {
  const thumbPath = path.join(getThumbCacheDir(), `${entityType}-${entityId}.jpg`);
  if (fs.existsSync(thumbPath)) try { fs.unlinkSync(thumbPath); } catch {}
  return { ok: true };
});

// Ensure a project folder exists on disk (called when creating projects or changing root)
ipcMain.handle('rabbit:ensure-project-folder', (_event, { rootDir, projectSlug }) => {
  // Session 35: the same refusal the project routes make, one layer up
  // (S34: refusals are enforced in depth, not only at the surface). This is
  // also the UI's preflight — ProjectSummaryView calls this BEFORE patching
  // folder_root, so a folder outside the boundary is refused here and the
  // stray directory is never created. Returns { ok: false, error } rather
  // than throwing: the renderer shows the sentence.
  const folderPath = path.join(String(rootDir || ''), String(projectSlug || ''));
  const v = folderRootRefusal(folderPath);
  if (v.error) return { ok: false, error: v.error };
  if (!fs.existsSync(v.resolved)) fs.mkdirSync(v.resolved, { recursive: true });
  return { ok: true, folderPath: v.resolved };
});

// ═══════════════════════════════════════════════════════════════════
//  SUPABASE SESSION PERSISTENCE (safeStorage-encrypted)
// ═══════════════════════════════════════════════════════════════════
// Stored at userData/session.enc. Encrypted with the OS keychain
// (DPAPI on Windows, Keychain on macOS, libsecret on Linux). If
// safeStorage is unavailable on this host (headless Linux without a
// keyring), we refuse to persist rather than silently fall back to
// plaintext — the renderer handles the null-session case cleanly.
function getSessionPath() {
  return path.join(app.getPath('userData'), 'session.enc');
}

ipcMain.handle('wilson:session-save', async (_e, session) => {
  if (!session) return { ok: false, reason: 'empty' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'no_keychain' };
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(session));
    fs.writeFileSync(getSessionPath(), encrypted);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'write_failed', message: String(err?.message || err) };
  }
});

ipcMain.handle('wilson:session-load', async () => {
  try {
    const file = getSessionPath();
    if (!fs.existsSync(file)) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    const buf = fs.readFileSync(file);
    return JSON.parse(safeStorage.decryptString(buf));
  } catch {
    return null;
  }
});

ipcMain.handle('wilson:session-clear', async () => {
  try {
    const file = getSessionPath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'unlink_failed', message: String(err?.message || err) };
  }
});

// Window control IPC handlers
ipcMain.handle('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window-maximize', () => {
  if (mainWindow) { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); }
});
ipcMain.handle('window-close', () => { if (mainWindow) mainWindow.close(); });
ipcMain.handle('window-force-close', () => {
  if (mainWindow) { mainWindow._forceClose = true; mainWindow.close(); }
});

// Zoom IPC handlers
ipcMain.handle('zoom-in', () => {
  if (mainWindow) { const wc = mainWindow.webContents; const c = wc.getZoomLevel(); if (c < 5) wc.setZoomLevel(c + 0.5); return wc.getZoomLevel(); }
});
ipcMain.handle('zoom-out', () => {
  if (mainWindow) { const wc = mainWindow.webContents; const c = wc.getZoomLevel(); if (c > -5) wc.setZoomLevel(c - 0.5); return wc.getZoomLevel(); }
});
ipcMain.handle('zoom-reset', () => { if (mainWindow) { mainWindow.webContents.setZoomLevel(0); return 0; } });
ipcMain.handle('zoom-get', () => { if (mainWindow) return mainWindow.webContents.getZoomLevel(); return 0; });

app.whenReady().then(() => {
  cleanupLegacySupabaseConfig();
  cleanupLegacyAuthFile();
  createWindow();
  // Session 9 auto-update (electron-updater; feed = WILSON_UPDATE_URL from
  // env.json in packaged builds). Init AFTER createWindow so status pushes
  // have somewhere to land; the renderer re-syncs via wilson:update-state.
  try {
    const { initUpdater } = require('./updater.cjs');
    initUpdater({
      app,
      getWebContents: () => mainWindow?.webContents ?? null,
      getMainWindow: () => mainWindow ?? null,
    });
  } catch (err) {
    console.warn('[wilson] updater init failed:', err?.message ?? err);
  }
});

app.on('window-all-closed', () => {
  if (localServer) localServer.close();
  app.quit();
});

app.on('activate', () => { if (mainWindow === null) createWindow(); });
