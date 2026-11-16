// ============================================================
// RABBIT — Bins on the cloud, the desktop app SIGNED IN (BC2)
// ============================================================
//
// Audrey, 2026-10-06: "the footage would live in the server. so the user is
// going to just pull the path in the server not the actual files themselves
// and save them locally. but in a Locally accessed network."
//
// The desktop signed in to a company is a COMPOSITE: the bins' DATA is the
// cloud's (the four 0091 tables, through supabaseAdapter), and the FILES are
// read where they are, through this computer's own desktop process (the
// /api/rabbit/cloud-bins/* routes in electron/rabbitBins.cjs). A clip is a
// footage location (the company's share, by its network address) plus a path
// inside it; nothing is ever copied to the local drive, only a small poster
// is cached on this computer.
//
// The predicate that builds it is "the desktop's file process is reachable"
// (window.electronAPI.rabbit AND /cloud-bins/ping answering), decided by the
// provider. It is NOT the storage mode: `supportsManagedFiles` picks the
// FILES store (the managed-files subsystem, Local Server only) and is
// untouched — bins are not files, and this picks no store at all. It only
// adds what the cloud cannot do by itself when a computer can reach the share.
//
// What it is: Object.create(cloud) — every cloud method stays (lists, writes,
// takes, locations, the switch), reached through the prototype with `this`
// the composite — plus the methods below, which need the file:
//
//   listBins       the cloud's rows, with `online` filled from what THIS
//                  computer can reach (the company's locations registered
//                  with the desktop first; the registration answers each
//                  location's reachability, kept on `locationStatus`)
//   pickBinFiles / pickBinFolder / prepareBinFiles
//                  the OS dialogs and the folder walk, by location
//   addBinFiles    the adding computer fills the technical columns (prepare,
//                  then probe) and the cloud's RPC stores them
//   probeBinFile   reads a clip's columns here and writes them to the cloud
//   binFileThumbnailUrl / binFileStreamUrl / openBinFile
//                  the poster cache, the bytes, the OS — by location + path
//   postBinFileThumbnail
//                  a renderer-decoded poster into THIS computer's cache only;
//                  an upload to the cloud is uploadBinFilePoster, which the
//                  provider calls only while the company's switch is on
//
// What the signed-out desktop does is untouched (B12): none of this is built
// unless the backend is the cloud.

// The composite's capability object: the keys every backend answers
// (binsAdapterParity.test.js). `relink` is true and means "by location": a
// clip is found again by pointing its location at the right folder on this
// computer, never by rewriting its path for everyone.
export const DESKTOP_CLOUD_BINS_CAPABILITIES = Object.freeze({
  backend: 'desktop_cloud',
  pickFiles: true,
  probe: true,
  stream: true,
  resolveFiles: true,
  relink: true,
  openInOs: true,
  posters: 'cloud',
  locations: true,
  remoteViewingSwitch: true,
})

// The columns a computer that can read the file fills (0091's bin_files);
// the cloud's add RPC and a PATCH accept exactly these from a probe.
export const BIN_FILE_TECH_COLUMNS = Object.freeze([
  'size_bytes', 'mtime', 'frame_count', 'sequence_pattern',
  'duration_sec', 'width', 'height', 'fps', 'codec', 'timecode_start', 'probe_status',
])

// What add_bin_files reads from an item (0091 §10). Anything else the
// desktop's prepare carried — this computer's own path, the walk's sequence
// summary, the name parser's suggestions, the duplicate note — stays here.
const ADD_ITEM_KEYS = [
  'location_id', 'relative_path', 'original_name', 'extension', 'mime_type', 'is_sequence',
  'sequence_pattern', 'frame_count', 'size_bytes', 'mtime', 'media_type', 'display_name', 'tags',
  'scene_id', 'shot_id', 'slate', 'take_number', 'take_modifier', 'camera', 'roll', 'shoot_day',
  'description', 'notes', 'review_flag', 'circled', 'color',
  'duration_sec', 'width', 'height', 'fps', 'codec', 'timecode_start', 'probe_status', 'sub_bin',
]

// Probing before the add is what fills a teammate's view of a clip they
// cannot reach (B3: "with its details"). A folder of thousands would hold the
// dialog for minutes, so the first ones are read before the add and the rest
// are added pending and read straight after (the provider's probe pass).
export const PROBE_BEFORE_ADD = 200
const PROBE_CONCURRENCY = 3

function pick(obj, keys) {
  const out = {}
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k]
  return out
}

function notHere(what) {
  const err = new Error(`[supabase] ${what}`)
  err.code = 'not_supported_here'
  err.status = 501
  return err
}

// The sentence an add says for a picked file that lies in no known location.
export const OUTSIDE_LOCATIONS_SENTENCE = 'This file is not inside any of the company\'s footage locations. Add it from the share\'s network address, or name the share as a location first.'
// What a relink by path answers on the cloud: a clip keeps its path for
// everyone; THIS computer is told where the location is.
export const RELINK_BY_LOCATION_SENTENCE = 'On the cloud a clip keeps its path for everyone. To find it again on this computer, point its footage location at the right folder: Settings, Storage, Footage locations.'

/**
 * The composite. `cloud` is the cloud adapter (supabaseAdapter or the dev
 * fixtures in its slot); `files` is the Local Server adapter's cloud-bins
 * client. `rowOf(id)` reads a clip row from the provider's state (a URL
 * builder takes an id only); `projectFps()` is the project's frame rate,
 * which a frame sequence's duration is counted in. `ping` is the answer the
 * provider got from the desktop (its `ffmpeg` flag rides on listBins).
 */
export function composeDesktopCloudBins(cloud, files, { rowOf = () => null, projectFps = () => 24, ping = null } = {}) {
  if (!cloud || !files) throw new Error('composeDesktopCloudBins needs the cloud adapter and the desktop files client')
  const c = Object.create(cloud)
  const ffmpeg = ping ? ping.ffmpeg === true : null

  const fileOf = (row) => ({ location_id: row.location_id, relative_path: row.relative_path, is_sequence: !!row.is_sequence })
  const requireRow = (id) => {
    const row = rowOf(id)
    if (!row || !row.location_id || !row.relative_path) {
      const err = new Error('[supabase] this clip has no footage location')
      err.code = 'not_found'
      throw err
    }
    return row
  }

  c.binsCapabilities = () => DESKTOP_CLOUD_BINS_CAPABILITIES

  // Register the company's locations with this computer's desktop process.
  // The list REPLACES what it had (a location gone from the cloud is gone
  // here). Answers each location's status on THIS computer.
  c.registerBinLocations = async (locations) => {
    const list = (locations || []).filter(l => l && l.id && l.unc_path).map(l => ({ id: l.id, unc_path: l.unc_path }))
    const res = await files.registerCloudBinLocations(list)
    return Array.isArray(res?.locations) ? res.locations : []
  }

  // What this computer can reach, per clip: id → { online, reason? }.
  c.resolveBinFiles = async (rows) => {
    const list = (rows || []).filter(r => r && r.id && r.location_id && r.relative_path).map(r => ({ id: r.id, ...fileOf(r) }))
    const out = new Map()
    if (!list.length) return out
    const res = await files.resolveCloudBinFiles(list)
    for (const f of res?.files || []) if (f?.id) out.set(f.id, { online: f.online === true, ...(f.reason ? { reason: f.reason } : {}) })
    return out
  }

  // Marks rows with what this computer can reach; a row the desktop did not
  // answer for reads "not on this computer", never "online" by default.
  c.markOnline = async (rows) => {
    const list = rows || []
    if (!list.length) return list
    let resolved
    try { resolved = await c.resolveBinFiles(list) } catch { resolved = new Map() }
    return list.map(r => ({ ...r, online: resolved.get(r.id)?.online === true }))
  }

  c.listBins = async (projectId) => {
    const data = await cloud.listBins(projectId)
    let locationStatus = []
    let filesError = null
    try { locationStatus = await c.registerBinLocations(data.binLocations || []) }
    catch (e) { filesError = e?.message || String(e) }
    const binFiles = filesError
      ? (data.binFiles || []).map(f => ({ ...f, online: false }))
      : await c.markOnline(data.binFiles || [])
    return { ...data, binFiles, ffmpeg, capabilities: DESKTOP_CLOUD_BINS_CAPABILITIES, locationStatus, ...(filesError ? { filesError } : {}) }
  }

  // ── Picking and the walk: by location ──
  c.pickBinFiles = () => files.pickCloudBinFiles()
  c.pickBinFolder = (_projectId, title) => files.pickCloudBinFolder(title)
  c.prepareBinFiles = (_projectId, paths, opts = {}) => files.prepareCloudBinFiles(paths, opts)

  // ── Probe: read here, store in the cloud ──
  const probeFile = (row) => files.probeCloudBinFile({
    ...fileOf(row),
    media_type: row.media_type || null,
    extension: row.extension || null,
    fps: Number(projectFps()) > 0 ? Number(projectFps()) : 24,
  })

  c.probeBinFile = async (projectId, id) => {
    const row = requireRow(id)
    const patch = await probeFile(row)
    const cols = pick(patch, BIN_FILE_TECH_COLUMNS)
    // Through the composite (the cloud's PATCH, by the prototype).
    const updated = Object.keys(cols).length ? await c.updateBinFile(projectId, id, cols) : null
    return { ...(updated || row), online: true }
  }

  // items: the add dialog's rows (location_id + relative_path + what prepare
  // read). The first PROBE_BEFORE_ADD are probed HERE first, so the row lands
  // in the cloud with its length, size, frame and codec; a probe that fails
  // still adds the clip (probe_status 'failed', or 'pending' past the cap).
  // opts.onProgress({ done, total }) while reading.
  c.addBinFiles = async (projectId, binId, items, createSubBins = true, _roots = null, opts = {}) => {
    const list = (items || []).map(it => ({ ...it, is_sequence: it.is_sequence === true || it.kind === 'sequence' }))
    const toProbe = list.slice(0, PROBE_BEFORE_ADD)
    const total = toProbe.length
    let done = 0
    const queue = toProbe.map((it, i) => i)
    const worker = async () => {
      while (queue.length) {
        const i = queue.shift()
        const it = list[i]
        try {
          const patch = await probeFile(it)
          Object.assign(it, pick(patch, BIN_FILE_TECH_COLUMNS))
        } catch (err) {
          // Out of reach right now (410) is not a failure: the row stays
          // pending for the next pass, as the provider marks it (review
          // round 1).
          it.probe_status = err?.code === 'offline' || err?.status === 410 ? 'pending' : 'failed'
        }
        done++
        opts.onProgress?.({ done, total })
      }
    }
    if (total) await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, total) }, worker))
    const clean = list.map(it => ({ probe_status: 'pending', ...pick(it, ADD_ITEM_KEYS) }))
    const res = await cloud.addBinFiles(projectId, binId, clean, createSubBins)
    // Just read from this computer: reachable here.
    const created = (res?.created || []).map(r => ({ ...r, online: true }))
    return { ...res, created }
  }

  // Rows that come back from the cloud without `online` (a copy, an undo's
  // restore) are marked before they reach state.
  c.copyBinFiles = async (projectId, ids, binId) => {
    const res = await cloud.copyBinFiles(projectId, ids, binId)
    return { ...res, created: await c.markOnline(res?.created || []) }
  }
  c.restoreBinFiles = async (projectId, rows) => {
    const res = await cloud.restoreBinFiles(projectId, rows)
    return { ...res, restored: await c.markOnline(res?.restored || []) }
  }

  // ── The bytes, the poster, the OS ──
  c.binFileStreamUrl = (_projectId, id, { probe = false } = {}) => {
    const row = rowOf(id)
    if (!row || !row.location_id || !row.relative_path || row.online === false) return null
    return files.cloudBinFileStreamUrl(row.location_id, row.relative_path, { probe, isSequence: !!row.is_sequence })
  }
  // A poster from THIS computer's cache — drawn on first ask while the file
  // is reachable, still served from the cache (by the stored mtime) while it
  // is not. Null for a row without a location.
  c.binFileThumbnailUrl = (_projectId, id, rev = 0) => {
    const row = rowOf(id)
    if (!row || !row.location_id || !row.relative_path) return null
    return files.cloudBinFileThumbnailUrl(row.location_id, row.relative_path, rev, {
      isSequence: !!row.is_sequence, mediaType: row.media_type || null, mtime: row.mtime || null,
    })
  }
  c.openBinFile = async (_projectId, id, reveal = false) => {
    const row = requireRow(id)
    return files.openCloudBinFile({ ...fileOf(row), reveal: reveal === true })
  }
  // A renderer-decoded poster (no decoder on this computer) goes to this
  // computer's cache. It is NOT uploaded here: the provider uploads posters
  // only while the company's switch is on (B4), asking first.
  c.postBinFileThumbnail = async (_projectId, id, base64) => {
    const row = requireRow(id)
    await files.postCloudBinFileThumbnail({ ...fileOf(row), base64 })
    return { ok: true, local: true }
  }
  // The upload, for the provider's switch-gated pass: the cached poster's
  // bytes to rabbit-thumbnails through the cloud's own method (which asks
  // the switch again, and the database refuses regardless).
  // `given`: the row when the caller has it (a clip just added is not in
  // the provider's state until a render later).
  c.uploadBinFilePoster = async (projectId, id, given = null) => {
    const row = given && given.id === id && given.location_id && given.relative_path ? given : requireRow(id)
    const base64 = await files.cloudBinFileThumbnailBase64(row.location_id, row.relative_path, {
      isSequence: !!row.is_sequence, mediaType: row.media_type || null,
    })
    return cloud.postBinFileThumbnail.call(c, projectId, id, base64)
  }

  // ── Relink: by location, per computer ──
  // The tab's on-open scan of known roots has nothing to scan (a cloud clip
  // has a location, not a root). Relinking a path for everyone is refused:
  // on this computer the LOCATION is pointed at the right folder instead.
  c.binRelinkScan = async () => ({ offline: [], candidates: null, truncated: false })
  c.binRelinkApply = async () => { throw notHere(RELINK_BY_LOCATION_SENTENCE) }
  c.removeBinRoot = async () => { throw notHere(RELINK_BY_LOCATION_SENTENCE) }
  c.pickBinLocationLocalPath = (location) => files.pickCloudBinLocationLocalPath(location.id, { name: location.name || '', unc_path: location.unc_path || '' })
  c.forgetBinLocationLocalPath = (id) => files.forgetCloudBinLocationLocalPath(id)
  // Review round 1: "Connect this computer to \\server\share?" — asked by
  // the desktop itself; until then the address is never contacted here.
  c.connectBinLocation = (location) => files.connectCloudBinLocation(location.id)

  return c
}
