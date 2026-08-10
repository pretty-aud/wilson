// =============================================================================
// storage/uploadNotices.js — Session 40: telling people the truth at the moment
// it matters. NETWORK_STORAGE_DESIGN.md §5f.
//
// Audrey, 2026-08-05: "please make sure their is a warning prompt letting the
// user know large files and prores will require the desktop app."
// And on the treatment: "I'd use an inline note on the file row plus one
// summary line per batch — not a popup. agreed here."
//
// ── 🚨 ONLY ONE OF THE THREE SITUATIONS IS A FAILURE ────────────────────────
//
//   1. Over the cap        → the upload genuinely FAILS. A dialog, because
//                            there is no result to show and the user must do
//                            something different.
//   2. Large, under the cap → uploads, slowly. An inline note. MUST NOT BLOCK.
//   3. Professional codec   → uploads fine, no preview. An inline note.
//                            MUST NOT BLOCK.
//
// A warning that prevents a working action is worse than the limitation it
// warns about, and thirty clips must not mean thirty dialogs — that trains
// people to dismiss the one that matters.
//
// ── 🚨 THE CAP IS PROVIDER-DEPENDENT, AND VIDEO IS WHAT MAKES IT BITE ───────
//
// 50 MB is `rabbit-files`'s own file_size_limit (migration 0027) and applies to
// PETAL workspaces only. An s3 workspace takes ~5 GB in a single presigned PUT;
// a network workspace has no ceiling at all because its bodies never go through
// a bucket. Almost every real clip exceeds 50 MB, so on Petal cloud essentially
// no video uploads succeed today — while the SAME FILE from the SAME BROWSER is
// fine on an s3 workspace.
//
// So a blanket "too large, use the desktop app" is a FALSE REFUSAL that tells a
// customer to install software for an upload their browser can complete. Key
// every message on the ACTIVE PROVIDER, never on "cloud".
// =============================================================================

import { WORKSPACE_PROVIDERS } from './index.js'
import { isProbablyProfessionalCodec, isVideoExtension } from './videoThumbnails.js'

// 🚨 MIRRORS the `rabbit-files` file_size_limit set by the LATEST migration that
// touches it — 0027 established 50 MiB, migration 0057 raised it to 50 GiB.
// Storage refuses anything larger, so this is not a policy choice made here; it
// is a fact reported early enough to be useful. If one changes, change both.
//
// ⚠️ THE BUCKET LIMIT IS NOT THE ONLY CEILING, AND THIS CONSTANT CANNOT SEE THE
// OTHER ONE. Supabase caps every bucket at a PROJECT-LEVEL global limit set in
// the dashboard, not in the database — "the global limit takes precedence". If
// that global figure is lower than this number, storage-api refuses uploads this
// file cheerfully waves through. There is no API the client can ask, so the
// honest position is that this mirrors the bucket and the real ceiling is
// proven by uploading a large file, not by reading a constant.
export const PETAL_MAX_UPLOAD_BYTES = 53_687_091_200 // 50 GiB (migration 0057)

// A single presigned PUT tops out around 5 GB (S3's documented single-object
// PUT limit). Multipart would lift it and WILSON does not implement S3
// multipart — S42 implements resumable uploads for the SUPABASE provider (TUS)
// only, so this stays where S37 put it.
//
// 🚨 SO PETAL'S CAP IS NOW TEN TIMES S3'S, WHICH INVERTS S37's ASSUMPTION. This
// file's header was written when 50 MB on Petal made a blanket cap a false
// refusal for s3 customers; the false refusal now runs the other way, and the
// per-provider keying is what keeps both correct. Do not collapse them.
export const S3_MAX_SINGLE_PUT_BYTES = 5 * 1024 * 1024 * 1024

// Above this, a browser upload is slow enough to be worth mentioning even when
// it will succeed. Capped against the provider's own ceiling below, so on Petal
// the "slow" band is 25–50 MB rather than a threshold nothing can reach.
export const LARGE_FILE_WARN_BYTES = 100 * 1024 * 1024

/**
 * The hard ceiling for a browser upload on this workspace, or null when there
 * is none to state.
 *
 * `network` returns null deliberately: a cloud-mode `network` workspace has no
 * browser upload path AT ALL — uploadFile refuses it with its own sentence
 * before any size is consulted — so inventing a cap here would produce a
 * size-shaped message for a problem that is not about size.
 */
export function uploadCapFor(workspaceProvider) {
  if (workspaceProvider === WORKSPACE_PROVIDERS.PETAL) return PETAL_MAX_UPLOAD_BYTES
  if (workspaceProvider === WORKSPACE_PROVIDERS.S3) return S3_MAX_SINGLE_PUT_BYTES
  return null
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

export function extensionOfName(name) {
  const s = String(name || '')
  const dot = s.lastIndexOf('.')
  return dot > 0 ? s.slice(dot).toLowerCase() : ''
}

/**
 * What to say about ONE file, BEFORE it is uploaded.
 *
 * @returns {{blocked: boolean, code: string|null, message: string|null,
 *            notes: Array<{code: string, message: string}>}}
 *
 * `blocked` is the ONLY field that may stop an upload, and only `too_large`
 * ever sets it.
 */
export function classifyUpload(file, {
  workspaceProvider = WORKSPACE_PROVIDERS.PETAL,
  desktopDecoder = null, // true | false | null (unknown — the web knows nothing)
  storagePlan = null,    // Session 41: {usedBytes, quotaBytes, status} | null (unknown)
} = {}) {
  const notes = []
  const size = Number(file?.size) || 0
  const ext = extensionOfName(file?.name)
  const cap = uploadCapFor(workspaceProvider)

  // ── Session 41: the Petal-cloud plan ──────────────────────────────────────
  // 🚨 THIS IS A COURTESY, NOT THE ENFORCEMENT. The gate is the RESTRICTIVE
  // policy petal_storage_quota_insert (migration 0055); a direct storage REST
  // call bypasses every line of this file. What this buys is a sentence instead
  // of a raw RLS error, and only on the one path that consults it.
  //
  // 🚨 IT TAKES AN ALREADY-LOADED FIGURE AND MUST NEVER FETCH ONE. S40 shipped
  // exactly that defect: inserting `await getWorkspaceStorageCached()` ahead of
  // `Array.from(fileList)` in handleAddCloudFiles moved the read into a
  // microtask, and the picker's onChange does `handler(e.target.files);
  // e.target.value = ''` — which empties that same FileList object IN PLACE.
  // Every cloud upload became a silent no-op with no rows, no error and no
  // console output. A quota read placed "first, because it decides the ceiling"
  // is the identical shape.
  //
  // 🚨 PETAL ONLY. An s3 or network workspace's bodies never touch Petal
  // storage, so "you are out of space" would be a false refusal there — the
  // same mistake one layer up from the blanket "too large, use the desktop app"
  // this file's header was written to prevent.
  if (workspaceProvider === WORKSPACE_PROVIDERS.PETAL && storagePlan) {
    if (storagePlan.status === 'suspended') {
      return {
        blocked: true,
        code: 'storage_suspended',
        message:
          'This company’s Petal cloud storage is not active, so new files cannot be added. ' +
          'Contact Petal to activate it.',
        notes,
      }
    }
    // ⚠️ MIRRORS THE SERVER PREDICATE EXACTLY — Session 42 changed BOTH to
    // `used + incoming <= quota`, in this commit, because a client that refuses
    // what the server allows is a false refusal and a client that allows what
    // the server refuses is a raw RLS error in a dialog.
    //
    // 🚨 S41 DELIBERATELY DID NOT WEIGH THE FILE, AND WAS RIGHT AT THE TIME. The
    // overshoot it accepted was bounded by a 50 MB per-object cap. At 50 GiB the
    // same shape lets a brand-new free-tier workspace land an object fifty times
    // its entire 5 GiB allowance on its first upload, so the argument that made
    // `used < quota` correct is the argument that now makes it wrong.
    const used = Number(storagePlan.usedBytes)
    const quota = Number(storagePlan.quotaBytes)
    const known = Number.isFinite(used) && Number.isFinite(quota) && quota > 0
    if (known && used + size > quota) {
      // 🚨 DO NOT TELL THEM TO DELETE FILES. The obvious sentence — "remove some
      // files, or contact Petal" — offers a remedy that CANNOT WORK, which is
      // worse than offering none. A cloud delete is SOFT (0014): the `files` row
      // is trashed and the object stays in the bucket, and storage-gc refuses to
      // drain a trashed row for 30 days. The meter reads storage.objects, so
      // deleting everything in the project changes the number by zero and the
      // uploads stay refused. Someone following that advice would delete real
      // work and still be stuck. Found by this session's own review.
      //
      // 🚨 TWO DIFFERENT FACTS, TWO DIFFERENT SENTENCES. "You are full" and
      // "this particular file will not fit" are not the same problem and do not
      // have the same remedy — the second is solved by adding a smaller file,
      // which the first sentence would talk someone out of trying.
      //
      // The full-workspace message names NO file, so FileManager's dedup
      // (`if (!refused.includes(message))`) collapses thirty identical copies
      // into one line. The doesn't-fit message NAMES its file, exactly as
      // `too_large` does, so each one is listed — which is what the user needs
      // in order to know which files to leave out.
      const remaining = Math.max(0, quota - used)
      return {
        blocked: true,
        code: 'over_quota',
        message: used >= quota
          ? `This company has used all ${formatBytes(quota)} of its Petal cloud storage. ` +
            'Contact Petal to raise the plan — deleting files does not free space ' +
            'straight away, because deleted files stay recoverable for 30 days.'
          : `"${file?.name || 'This file'}" is ${formatBytes(size)}, but only ` +
            `${formatBytes(remaining)} of this company's ${formatBytes(quota)} Petal ` +
            'cloud storage is left. Add a smaller file, or contact Petal to raise ' +
            'the plan — deleting files does not free space straight away, because ' +
            'deleted files stay recoverable for 30 days.',
        notes,
      }
    }
    // ⚠️ DELIBERATELY NO "you are nearly full" NOTE HERE. Quota is a WORKSPACE
    // fact, not a file fact, so a per-row note would repeat identically on all
    // thirty rows of a batch — the noise this file's header exists to prevent
    // ("thirty clips must not mean thirty dialogs"). The two branches above earn
    // their repetition by being the reason nothing uploaded. Approaching-full
    // belongs on the Admin Terminal's storage card, where it is said once.
  }
  // A null storagePlan says the figure could not be read, and that must not
  // block anything — the server is the authority and will refuse if it must.

  if (cap !== null && size > cap) {
    return {
      blocked: true,
      code: 'too_large',
      message:
        `"${file?.name || 'This file'}" is ${formatBytes(size)}, over the ` +
        `${formatBytes(cap)} limit for adding files from a browser. ` +
        'Add it from the WILSON desktop app.',
      notes,
    }
  }

  // Band it against the provider's own ceiling so the note appears where it is
  // actually informative rather than at a fixed number that one provider can
  // never reach and another reaches constantly.
  const slowAt = cap === null
    ? LARGE_FILE_WARN_BYTES
    : Math.min(cap / 2, LARGE_FILE_WARN_BYTES)
  if (size >= slowAt) {
    notes.push({
      code: 'slow',
      message: 'Large file — this may take a while in a browser. The desktop app is faster.',
    })
  }

  // §5f's PRE-upload heuristic: cheap, instant, and wrong only in the harmless
  // direction (an H.264 .mov gets a notice it did not need). The ACCURATE
  // answer is noticeAfterUpload() below.
  if (isVideoExtension(ext) && isProbablyProfessionalCodec(ext)) {
    notes.push({
      code: 'maybe_no_preview',
      message: desktopPreviewSentence(desktopDecoder),
    })
  }

  return { blocked: false, code: null, message: null, notes }
}

/**
 * What to say about ONE file AFTER the attempt — and this is the one that
 * matters.
 *
 * 🚨 ACCURATE BY CONSTRUCTION. The upload path already loaded the file into a
 * `<video>` and seeked it. If no thumbnail came back for something we know is a
 * video, the browser genuinely could not decode it — that is not a guess, it is
 * the same decoder answering the same question. The extension heuristic above
 * is a courtesy; this is the fact.
 *
 * @param row  the `files` row the upload returned.
 */
export function noticeAfterUpload(row, { desktopDecoder = null, attempted = false } = {}) {
  if (!row) return null
  const ext = extensionOfName(row.name)
  const isVideo = String(row.mime_type || '').toLowerCase().startsWith('video/')
    || isVideoExtension(ext)
  if (!isVideo) return null
  if (row.thumbnail_url) return null

  const professional = isProbablyProfessionalCodec(ext)

  // 🚨 `attempted` IS WHAT MAKES THE "ACCURATE BY CONSTRUCTION" CLAIM TRUE, and
  // without it this function made a confident false statement (found by the
  // pre-push adversarial review).
  //
  // The premise — "the upload path already loaded this into a <video> and
  // seeked it, so a missing preview means the browser genuinely cannot decode
  // it" — holds ONLY for a row this session's code just uploaded. Before S40,
  // canThumbnail() refused video outright, so EVERY video row uploaded in S39
  // and earlier has thumbnail_url = null. FileManager derives the row note at
  // RENDER, on every list paint, so a 30 MB H.264 .mp4 from last week was being
  // labelled "no preview for this format" — false about a format Chromium
  // decodes, and telling the user to install software that would change nothing.
  if (!attempted) {
    // Nothing was measured about this row. Only a container that is USUALLY a
    // professional codec is worth saying anything about, and even then it is
    // the heuristic talking rather than a decode.
    if (!professional) return null
    return { code: 'no_preview', message: desktopPreviewSentence(desktopDecoder) }
  }

  // A decode was watched and it failed. For a professional container the format
  // really is the likely reason. For an ordinary .mp4 it is NOT — the frame may
  // have exceeded THUMBNAIL_MAX_BYTES, or the preview upload may have been
  // refused and swallowed by uploadFile's console.warn. Blaming the format
  // there would be the same false statement one step later.
  return professional
    ? { code: 'no_preview', message: desktopPreviewSentence(desktopDecoder) }
    : { code: 'no_preview', message: 'No preview image could be generated for this file.' }
}

/**
 * ⚠️ THE DESKTOP POINTER IS DROPPED WHEN WE HAVE MEASURED THAT IT IS FALSE.
 * "Add it from the desktop app to get one" is a lie on a machine whose desktop
 * app has no decoder installed (resources/ffmpeg is empty), and sending someone
 * to install an app that will do exactly the same thing is worse than saying
 * nothing. `null` means unknown — the web cannot ask — and there the pointer
 * stands, because shipping that decoder is the plan.
 */
function desktopPreviewSentence(desktopDecoder) {
  return desktopDecoder === false
    ? 'Preview images aren\'t available for this format.'
    : 'Preview images aren\'t available for this format in a browser. ' +
      'Add it from the desktop app to get one.'
}

/**
 * ONE line for the whole batch, or null.
 *
 * §5f: "3 files won't have preview images — add them from the desktop app."
 * Counted rather than listed, because the per-row notes already say WHICH.
 */
export function summarizeBatch(notices) {
  const codes = (notices || []).filter(Boolean).map(n => n.code)
  const noPreview = codes.filter(c => c === 'no_preview' || c === 'maybe_no_preview').length
  const slow = codes.filter(c => c === 'slow').length
  const parts = []
  if (noPreview > 0) {
    parts.push(
      `${noPreview} file${noPreview === 1 ? '' : 's'} ` +
      `${noPreview === 1 ? 'won\'t' : 'won\'t'} have a preview image`,
    )
  }
  if (slow > 0) {
    parts.push(`${slow} large file${slow === 1 ? '' : 's'} may be slow in a browser`)
  }
  if (parts.length === 0) return null
  return `${parts.join('; ')}.`
}
