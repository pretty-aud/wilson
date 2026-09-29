// =============================================================================
// electron/ffmpeg.cjs — Session 40: the decoder for the codecs a browser cannot
// read. NETWORK_STORAGE_DESIGN.md §5e / §5e-pre.
//
// Audrey, 2026-08-05: "ok keep ffmpeg then, desktop generation is fine."
//
// WHAT THIS IS FOR, AND ONLY THIS. One still frame out of one video file, into
// one JPEG. Chromium plays H.264/AAC MP4, VP8/VP9 WebM and AV1; it cannot play
// ProRes, DNxHD/DNxHR or most professional MOV/MXF variants, which is a large
// share of what a studio holds. The same decoder answers preview and thumbnail,
// so a file that will not preview will not thumbnail either — and this module is
// what closes that gap on the desktop, where the media and the decoder are both
// already sitting next to each other.
//
// ── 🚨 LICENCE: THIS DOES NOT MAKE WILSON OPEN SOURCE ────────────────────────
// §5e-pre correction 2, and Audrey nearly dropped the dependency over it.
//
//   * The LGPL build is explicitly intended for proprietary, closed-source
//     software. Invoked as a SEPARATE EXECUTABLE — which is exactly what this
//     module does, and the only thing it does — it creates no obligation to
//     publish any of WILSON's code.
//   * The GPL build is the one with copyleft consequences, and you get it only
//     by deliberately including GPL components (libx264, libx265,
//     --enable-gpl). You have to opt in.
//   * Still-frame extraction from ProRes/DNxHD needs the LGPL build and nothing
//     more: both decoders are in it, JPEG encoding is in it, and JPEG's patents
//     expired long ago.
//
// So: ship an LGPL build, invoke it out-of-process (below), and never link it
// in. If a preview PROXY is ever transcoded, target VP9/WebM — libvpx is BSD and
// VP9 is royalty-free, which removes the GPL question and the H.264 patent pool
// in one decision. `resources/ffmpeg/README.md` carries the operational half.
//
// ── 🚨 THE BINARY IS NOT IN GIT, AND THAT IS DELIBERATE ──────────────────────
// `pretty-aud/wilson` is a PUBLIC repository and `git add -A` sweeps untracked
// files into it (standing trap, MASTER_PLAN). An 80 MB third-party binary does
// not belong there. `resources/ffmpeg/` is committed with its README and a
// .gitignore that excludes the executables; dropping ffmpeg.exe in makes
// electron-builder ship it, with no code change.
//
// 🚨 ITS ABSENCE IS A FIRST-CLASS STATE, NOT AN ERROR PATH. Everything here
// answers "no" rather than throwing when the binary is missing, because that is
// today's state on every machine and a thumbnail is a convenience — the same
// contract storage/thumbnails.js states for the browser path: a failed preview
// must cost a preview, never the file.
// =============================================================================

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// 🚨 THE ARGUMENT ARRAY IS THE WHOLE POINT (§5e rule 2). Filenames arriving from
// a NAS are outside WILSON's control and may contain shell metacharacters;
// execFile with an array never reaches a shell. This is the repo's standing
// "never build a shell command by interpolating content" rule, and ffmpeg is
// literally the case it was written for.
const NEVER_A_SHELL = { shell: false };

// A cold NAS read can be slow; a hung one must not pin a request forever.
// SIGKILL rather than SIGTERM: ffmpeg traps SIGTERM to finish its output file,
// which is the opposite of what a timeout wants.
const EXTRACT_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 20_000;

// 🚨 THE CEILING FOR THE WHOLE extractFrame CALL. The per-process timeouts
// above bound each spawn; this bounds the SUM, because probe + attempt + retry
// run serially and a request that holds an HTTP connection for two minutes is
// not a slow thumbnail — it is a frozen app. The renderer is served by the same
// Express instance on the same origin, and Chromium allows six concurrent
// connections per origin, so six unlucky tiles stall every other /api/rabbit
// fetch behind them.
const TOTAL_DEADLINE_MS = 45_000;

const BINARY_NAME = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

/**
 * Where the binary is, or null.
 *
 * 🚨 `process.resourcesPath` IS THE PACKAGED ANSWER AND IS WRONG IN DEV — under
 * `electron .` it points inside node_modules/electron/dist, where nothing has
 * been staged. So the repo copy is checked too, and an explicit env override
 * wins over both (it is how you test a specific build without repackaging).
 *
 * Not memoised: this is two existsSync calls, and caching a "missing" answer
 * would mean a binary dropped in while WILSON is running stays invisible until
 * a restart — which is exactly how someone concludes the packaging is broken.
 */
function resolveFfmpegPath() {
  const candidates = [];
  // The override is FIRST but not exempt: it goes through the same isFile
  // check as everything else. It used to short-circuit on existsSync alone,
  // which meant the one path a person types by hand was the one path that
  // would happily accept a directory.
  if (process.env.WILSON_FFMPEG_PATH) candidates.push(process.env.WILSON_FFMPEG_PATH);
  // Packaged: electron-builder's extraResources puts it at
  // <app>/resources/ffmpeg/. Guarded because resourcesPath is undefined in a
  // plain node process (the unit tests).
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'ffmpeg', BINARY_NAME));
  }
  // Dev: the repo copy that extraResources stages FROM.
  candidates.push(path.join(__dirname, '..', 'resources', 'ffmpeg', BINARY_NAME));

  for (const c of candidates) {
    // 🚨 A FILE, not merely "something exists here" (adversarial review). The
    // documented install is "drop the executable in beside this file", and the
    // obvious mistakes are dropping the extracted FOLDER there, or leaving a
    // half-downloaded `.part`. existsSync says yes to a directory, so
    // hasFfmpeg() would report a decoder that cannot be spawned — and the
    // module's whole contract is that a missing decoder is a NAMED state, not
    // a mystery ENOENT at the first upload of somebody's rushes.
    try {
      const st = fs.statSync(c);
      if (st.isFile() && st.size > 0) return c;
    } catch { /* unreadable path is absent */ }
  }
  return null;
}

/** Is professional-codec extraction available on this machine at all? */
function hasFfmpeg() {
  return resolveFfmpegPath() !== null;
}

function runFfmpeg(args, timeout) {
  const bin = resolveFfmpegPath();
  if (!bin) return Promise.resolve({ ok: false, reason: 'ffmpeg_missing', stderr: '' });
  return new Promise(resolve => {
    execFile(
      bin,
      args,
      { ...NEVER_A_SHELL, timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
      (err, _stdout, stderr) => {
        resolve({
          ok: !err,
          reason: err ? (err.killed ? 'timeout' : 'ffmpeg_failed') : null,
          stderr: String(stderr || ''),
        });
      },
    );
  });
}

// ffmpeg prints `Duration: HH:MM:SS.ss` on stderr and then exits NON-ZERO with
// "At least one output file must be specified" — so a non-zero exit here is the
// expected shape, not a failure, and the stderr is the payload.
const DURATION_RE = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;

/**
 * Duration in seconds, or null. Best-effort by contract: the caller has a
 * defensible timestamp without it, and shipping ffprobe alongside ffmpeg to
 * answer one number would double the installer cost.
 */
async function probeDurationSec(input, timeoutMs = PROBE_TIMEOUT_MS) {
  if (!(timeoutMs > 0)) return null;
  const { stderr } = await runFfmpeg(['-hide_banner', '-i', input], timeoutMs);
  const m = DURATION_RE.exec(stderr);
  if (!m) return null;
  const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(secs) && secs > 0 ? secs : null;
}

/**
 * Which frame. NOT frame 0 — video routinely opens on black, a fade-in or a
 * slate, and a wall of black thumbnails is worse than icons (§5d.1b).
 *
 * ~10% of duration, clamped to 1–10s. The clamp means the answer is ALWAYS in
 * [1, 10]: a clip of 10s or less takes 1s, anything from 100s up takes 10s.
 * With no duration the same rule cannot be applied, so 1s is the floor of the
 * range — past a slate, and inside anything longer than a second.
 *
 * ⚠️ Shared with the browser path by VALUE, not by import: the renderer module
 * is ESM and this is CJS in another process. videoThumbnails.js carries the same
 * three constants and thumbnails.test.js asserts the two agree.
 */
const SEEK_FRACTION = 0.1;
const SEEK_MIN_SEC = 1;
const SEEK_MAX_SEC = 10;

function seekTimestampFor(durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return SEEK_MIN_SEC;
  return Math.min(SEEK_MAX_SEC, Math.max(SEEK_MIN_SEC, durationSec * SEEK_FRACTION));
}

/**
 * Decode one frame of `input` into a JPEG at `output`.
 *
 * Resolves `{ ok, reason }` and never rejects — the caller is a thumbnail path.
 *
 * 🚨 `-ss` BEFORE `-i`, and this is the single most common way it is written
 * wrong (§5e rule 1). Input seeking jumps straight to the timestamp; output
 * seeking (`-ss` after `-i`) decodes every frame from zero. On a 5 GB ProRes
 * file over a NAS share that is the difference between a second and several
 * minutes.
 *
 * 🚨 AND IT RETRIES AT ZERO. A seek past the end of a very short clip produces
 * a clean exit with NO output file, which would read as "this codec is
 * unsupported" when the file is fine and merely brief. The retry is what makes
 * a sub-second clip yield its first frame rather than nothing — and it only
 * runs when the first attempt wrote nothing, so a normal file costs one process.
 */
async function extractFrame({
  input, output, maxEdge = 256, quality = 4, timestampSec = null,
  deadlineMs = TOTAL_DEADLINE_MS,
} = {}) {
  if (!hasFfmpeg()) return { ok: false, reason: 'ffmpeg_missing' };

  // 🚨 ONE DEADLINE FOR THE WHOLE CALL, not three independent ones
  // (adversarial review, HIGH). The per-process timeouts bound each spawn, but
  // probe + attempt + retry ran SERIALLY and could total 140 seconds inside a
  // single awaited Express handler — and the renderer is served by that same
  // Express app on the same origin, so Chromium's six-connections-per-origin
  // budget means six slow tiles freeze the entire R.A.B.B.I.T. UI, not just
  // their own thumbnails. A NAS that has gone unresponsive is exactly when a
  // grid full of video renders.
  const startedAt = Date.now();
  const remaining = () => deadlineMs - (Date.now() - startedAt);

  let duration = null;
  let ts = timestampSec;
  if (ts == null) {
    duration = await probeDurationSec(input, Math.min(PROBE_TIMEOUT_MS, remaining()));
    ts = seekTimestampFor(duration);
    // Parity with the browser path, which clamps into the clip's own duration.
    // Without it a 0.4s clip seeks past its end, produces nothing, and only
    // reaches a frame via the retry below — two processes for a file whose
    // answer was knowable from the duration we just read.
    if (Number.isFinite(duration) && duration > 0) {
      ts = Math.min(ts, Math.max(0, duration - 0.05));
    }
  }

  const attempt = async (seconds) => {
    const budget = remaining();
    if (budget <= 0) return { ok: false, reason: 'timeout' };
    // 🚨 WRITE TO A TEMP PATH AND RENAME. The GET route serves `output`
    // whenever it EXISTS, and that check runs before the in-flight dedupe — so
    // writing in place means a concurrent request can be handed a
    // half-written JPEG, which the <img> rejects and FileThumbnail then pins to
    // a generic icon for the life of the component (its erroredSrc memory
    // never clears for a stable desktop URL). rename within a directory is
    // atomic, so a reader sees either no file or a complete one.
    const tmp = `${output}.part`;
    const res = await runFfmpeg(
      buildArgs({ input, output: tmp, maxEdge, quality, seconds }),
      Math.min(EXTRACT_TIMEOUT_MS, budget),
    );
    // ffmpeg can exit 0 having written nothing (seek past EOF). The file on
    // disk is the only honest test of whether a frame was produced.
    if (res.ok && fileHasBytes(tmp)) {
      try {
        fs.renameSync(tmp, output);
        return { ok: true, reason: null };
      } catch (e) {
        cleanup(tmp);
        return { ok: false, reason: 'rename_failed', stderr: e?.message || '' };
      }
    }
    cleanup(tmp);
    return { ok: false, reason: res.reason || 'no_frame', stderr: res.stderr };
  };

  const first = await attempt(ts);
  if (first.ok) return first;
  // 🚨 RETRY ONLY ON 'no_frame'. The retry exists for ONE case — a clean exit
  // that wrote nothing because the seek landed past the end of a very short
  // clip. 'ffmpeg_failed' means the decoder rejected the file, and seeking to 0
  // will not change its mind; retrying there doubled the cost of every
  // permanently undecodable file, which on a folder of .r3d is the difference
  // between one wasted minute and two.
  if (first.reason !== 'no_frame') return first;
  if (ts === 0 || remaining() <= 0) return first;
  return attempt(0);
}

function cleanup(p) {
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* next run overwrites */ }
}

function buildArgs({ input, output, maxEdge, quality, seconds }) {
  return [
    '-nostdin',              // never wait on a tty that does not exist
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', String(seconds),  // 🚨 BEFORE -i. See above.
    '-i', input,
    '-frames:v', '1',
    '-an',                   // a still frame has no audio to decode
    // Fit inside maxEdge WITHOUT upscaling: the target box is itself capped by
    // the source dimensions, so a 120px source stays 120px. Mirrors
    // scaleToFit()'s "never upscales a small source" in the browser path.
    //
    // The single quotes are ffmpeg's OWN escaping, not the shell's — there is
    // no shell here. A filtergraph splits options on ':' and filters on ',',
    // so the comma inside min(256,iw) has to be quoted or the graph is
    // misparsed. This is the documented form.
    //
    // 🚨 THE crop IS NOT COSMETIC. force_original_aspect_ratio=decrease can
    // land on an ODD dimension (1920x1080 -> 256x144 is fine; 1000x333 is
    // not), and chroma subsampling needs even ones. trunc(iw/2)*2 costs at
    // most one pixel and works on every ffmpeg ever built — unlike scale's
    // force_divisible_by, which is 4.4+ and would make EVERY thumbnail fail
    // on an older binary rather than the occasional odd-sized one.
    '-vf',
    `scale='min(${maxEdge},iw)':'min(${maxEdge},ih)':force_original_aspect_ratio=decrease:flags=lanczos,` +
    'crop=trunc(iw/2)*2:trunc(ih/2)*2',
    '-q:v', String(quality),
    '-f', 'image2',
    '-y',
    output,
  ];
}

function fileHasBytes(p) {
  try { return fs.statSync(p).size > 0; } catch { return false; }
}

// ── Bins (demo 2026-09-11): the rest of what `ffmpeg -i` already says ────────
//
// probeDurationSec runs ffmpeg once and reads one number off stderr. The same
// stderr carries the video stream line ("Stream #0:0: Video: h264 (High) …,
// 1920x1080 [SAR 1:1 DAR 16:9], 24 fps, 24 tbr"), the audio stream line, the
// container and a `timecode` metadata tag — which is every technical column
// the bin system shows (docs/BINS_DESIGN.md §4.1). One process, not five.
//
// The parser is pure and exported so it is tested on captured stderr rather
// than on a claim. Shapes it must survive: a stream id like `[0x1]` and a
// fourcc like `(avc1 / 0x31637661)` both contain "0x1…" and must NOT read as a
// frame size (both sides need two or more digits); a still image reports a
// Video stream with no fps and no Duration; ProRes reports `prores (apch)`.
const STREAM_VIDEO_RE = /Stream #\d+:\d+.*?:\s*Video:\s*([A-Za-z0-9_-]+)([^\n]*)/;
const STREAM_AUDIO_RE = /Stream #\d+:\d+.*?:\s*Audio:\s*([A-Za-z0-9_-]+)([^\n]*)/;
const FRAME_SIZE_RE = /\b(\d{2,5})x(\d{2,5})\b/;
const FPS_RE = /(\d+(?:\.\d+)?)\s*fps\b/;
const TBR_RE = /(\d+(?:\.\d+)?)\s*tbr\b/;
const TIMECODE_RE = /^\s*timecode\s*:\s*(\d{2}:\d{2}:\d{2}[:;]\d{2})\s*$/m;
const CONTAINER_RE = /Input #0,\s*([^\n]+?),\s*from\b/;
const SAMPLE_RATE_RE = /(\d{4,6})\s*Hz/;
const CHANNELS_RE = /\d+\s*Hz,\s*([^,\n]+)/;

function parseFfmpegInfo(stderr) {
  const text = String(stderr || '');
  const out = {
    duration_sec: null, codec: null, width: null, height: null, fps: null,
    audio_codec: null, sample_rate: null, channels: null,
    timecode_start: null, container: null,
  };
  const d = DURATION_RE.exec(text);
  if (d) {
    const secs = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
    if (Number.isFinite(secs) && secs > 0) out.duration_sec = secs;
  }
  const v = STREAM_VIDEO_RE.exec(text);
  if (v) {
    out.codec = v[1].toLowerCase();
    const rest = v[2] || '';
    const size = FRAME_SIZE_RE.exec(rest);
    if (size) { out.width = Number(size[1]); out.height = Number(size[2]); }
    const fps = FPS_RE.exec(rest) || TBR_RE.exec(rest);
    if (fps) {
      const n = Number(fps[1]);
      if (Number.isFinite(n) && n > 0) out.fps = n;
    }
  }
  const a = STREAM_AUDIO_RE.exec(text);
  if (a) {
    out.audio_codec = a[1].toLowerCase();
    const rest = a[2] || '';
    const sr = SAMPLE_RATE_RE.exec(rest);
    if (sr) out.sample_rate = Number(sr[1]);
    const ch = CHANNELS_RE.exec(rest);
    if (ch) out.channels = ch[1].trim();
  }
  const tc = TIMECODE_RE.exec(text);
  if (tc) out.timecode_start = tc[1];
  const c = CONTAINER_RE.exec(text);
  if (c) out.container = c[1].trim();
  return out;
}

/**
 * Everything parseFfmpegInfo can read about `input`, or `{ ok:false, reason }`
 * when there is no binary or it timed out. Never rejects; the caller is a
 * probe route that must answer for every file.
 */
async function probeMediaInfo(input, timeoutMs = PROBE_TIMEOUT_MS) {
  if (!hasFfmpeg()) return { ok: false, reason: 'ffmpeg_missing', info: null };
  if (!(timeoutMs > 0)) return { ok: false, reason: 'timeout', info: null };
  const res = await runFfmpeg(['-hide_banner', '-i', input], timeoutMs);
  // Non-zero exit is the expected shape ("At least one output file must be
  // specified"); a timeout or a missing decoder is not.
  if (res.reason === 'timeout') return { ok: false, reason: 'timeout', info: null };
  const info = parseFfmpegInfo(res.stderr);
  const sawStream = /Stream #\d+:\d+/.test(res.stderr);
  if (!sawStream) return { ok: false, reason: 'unreadable', info };
  return { ok: true, reason: null, info };
}

module.exports = {
  resolveFfmpegPath,
  hasFfmpeg,
  probeDurationSec,
  parseFfmpegInfo,
  probeMediaInfo,
  seekTimestampFor,
  extractFrame,
  // Exported for the unit tests: the two rules that cost a session are asserted
  // on the ARGUMENT ARRAY rather than on a comment claiming they hold.
  buildArgs,
  SEEK_FRACTION,
  SEEK_MIN_SEC,
  SEEK_MAX_SEC,
  EXTRACT_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  TOTAL_DEADLINE_MS,
};
