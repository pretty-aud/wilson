// =============================================================================
// storage/uploadReservation.js — Track C, bundle C1 (migration 0073).
//
// Reserve Petal quota for a resumable upload BEFORE tus.Upload.start(), and
// release it when the upload finishes or fails. Audrey's decision 32
// (2026-09-04): "reserve space when an upload starts."
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// A TUS upload has no storage.objects row until it completes, so the
// RESTRICTIVE quota policy (0055/0057) could not see it: two 30 GiB uploads
// started together against a 50 GiB quota both passed their creation check.
// 0057 tried to meter storage.s3_multipart_uploads and the premise was false
// (WILSON's TUS path never writes that table — 0058's header is the record).
// 0073 gives the policy a WILSON-side reservation instead: a row this module
// writes before the first byte moves, which workspace_petal_bytes() adds to
// the total the policy weighs every other upload against.
//
// ── 🚨 THE ORDER, AND WHY RELEASE TIMING CANNOT DOUBLE-COUNT ────────────────
//
// reserve → tus.Upload.start() → (object lands) → release. Between "lands" and
// "release" the committed object and its own reservation would both be in the
// meter — except that 0073's reservation arm EXCLUDES any reservation whose
// object already exists in rabbit-files, so the reservation stops counting the
// instant the object lands, whatever this client does next. Release is
// therefore bookkeeping, not accounting: it is best-effort, and a client that
// crashes after completion leaves a row that expires at 24 h and is closed as
// 'completed' by the sweep, with no certificate.
//
// ── DEGRADATION, STATED ─────────────────────────────────────────────────────
//
// The beta auto-deploys on every push while migrations are applied by hand, so
// there is a real window where this client knows the RPC and the database does
// not (supabaseAdapter's unwrapOptionalTable idiom, for an RPC). In that window
// PostgREST answers PGRST202 and the upload proceeds UNRESERVED — exactly the
// behaviour it had before 0073, with the policy still gating at commit. Every
// other refusal (over quota, suspended plan, a project the caller cannot
// write) is FATAL and the upload never starts: an over-quota upload is refused
// at start, not after an hour of egress.
// =============================================================================

/** The server has no reservation RPC where this client points (0073 not applied). */
export const RESERVATION_UNAVAILABLE = 'unavailable'

/** PostgREST's "no such function" shape. */
export function isFunctionMissing(error) {
  return error?.code === 'PGRST202'
    || /could not find the function/i.test(String(error?.message || ''))
}

/**
 * Reserve `bytes` of Petal quota for a resumable upload to `key`.
 *
 * Resolves { reserved: true, id } when a reservation was written;
 * { reserved: false, reason } when nothing was reserved AND the upload may
 * proceed ('exempt' — a money path or the manifest, which the quota never
 * weighs; 'unavailable' — the RPC is not there yet; 'no-size' — nothing to
 * weigh). THROWS with the server's own sentence when the reservation is
 * refused, so the caller never starts the upload.
 *
 * @param {object} client an authed supabase-js client (rpc + auth)
 * @param {string} key    row-shaped storage_path inside rabbit-files
 * @param {number} bytes  the body's size
 */
export async function reserveUpload(client, key, bytes) {
  const size = Math.floor(Number(bytes))
  if (!Number.isFinite(size) || size <= 0) return { reserved: false, reason: 'no-size' }

  // 🚨 rpc() RESOLVES for every status (the trap supabaseAdapter documents at
  // every call site), so `.error` is the only signal and must be read.
  const res = await client.rpc('reserve_upload_bytes', { p_path: key, p_bytes: size })
  if (res?.error) {
    if (isFunctionMissing(res.error)) {
      console.warn(
        '[supabase] upload reservation unavailable (migration 0073 is not applied here) — uploading unreserved:',
        res.error.message,
      )
      return { reserved: false, reason: RESERVATION_UNAVAILABLE }
    }
    throw new Error(`[supabase] upload refused: ${res.error.message || 'the reservation was refused'}`)
  }
  // NULL = the path is quota-exempt; nothing was written and there is nothing
  // to release.
  if (res?.data === null || res?.data === undefined) return { reserved: false, reason: 'exempt' }
  return { reserved: true, id: res.data }
}

/**
 * Close the caller's own reservation for `key`. Best-effort and never throws:
 * the upload has already succeeded or failed by the time this runs, and the
 * meter does not depend on it (see the header). Resolves true when a row was
 * closed, false otherwise.
 */
export async function releaseUpload(client, key) {
  try {
    const res = await client.rpc('release_upload_reservation', { p_path: key })
    if (res?.error) {
      console.warn('[supabase] upload reservation not released:', res.error.message)
      return false
    }
    return res?.data === true
  } catch (err) {
    console.warn('[supabase] upload reservation not released:', err?.message || err)
    return false
  }
}
