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
 * The keys THIS tab is uploading right now: reserved, not yet closed.
 * release_stale_upload_reservations() (0074) is told to keep them, so opening
 * Files in the tab that is uploading cannot release the upload's own row.
 * Module-level on purpose — one tab, one set. A second tab has its own set and
 * cannot see this one (stated limit, handbook §17).
 */
export const inFlightKeys = new Set()

/**
 * The server's refusal names the object KEY's leaf — `<Date.now()>-<safe name>`,
 * the unique key uploadFile mints per attempt — because that is all
 * reserve_upload_bytes can see. The person reading it dropped "My Clip (1).mov",
 * not "1725664000000-My_Clip_1_.mov", so the sentence they are shown names the
 * file they know. Only the quoted leaf is touched; every other word is the
 * server's, verbatim (review round 1, 2026-09-06).
 */
export function nameTheFile(message, key, displayName) {
  const text = String(message || '')
  const name = typeof displayName === 'string' ? displayName.trim() : ''
  const leaf = String(key || '').split('/').pop()
  if (!name || !leaf || name === leaf) return text
  return text.split(`"${leaf}"`).join(`"${name}"`)
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
 * @param {{displayName?: string}} [opts] the file's own name, for the refusal
 *   sentence only — it is never sent to the server
 */
export async function reserveUpload(client, key, bytes, opts) {
  const displayName = opts?.displayName
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
    throw new Error(
      `[supabase] upload refused: ${nameTheFile(res.error.message, key, displayName) || 'the reservation was refused'}`,
    )
  }
  // NULL = the path is quota-exempt; nothing was written and there is nothing
  // to release.
  if (res?.data === null || res?.data === undefined) return { reserved: false, reason: 'exempt' }
  inFlightKeys.add(key)
  return { reserved: true, id: res.data }
}

/**
 * Close the caller's own reservation for `key`. Best-effort and never throws:
 * the upload has already succeeded or failed by the time this runs, and the
 * meter does not depend on it (see the header). Resolves true when a row was
 * closed, false otherwise.
 */
export async function releaseUpload(client, key) {
  inFlightKeys.delete(key)
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

/** How much of a failure's message rides on the certificate; the server bounds it too. */
export const ABANDON_REASON_MAX = 500

/**
 * Track C / 0074, Audrey's ruling 1 (2026-09-07): an upload that FAILS with an
 * error the server answered is RECORDED, not silently released. Closes the
 * caller's own reservation for `key` as 'abandoned' and writes the
 * `upload_abandoned` certificate at once, carrying `reason` (bounded).
 *
 * Best-effort and never throws — the upload has already failed, and that
 * failure is what the caller reports. Resolves true when a row was closed.
 *
 * Degradation, stated: where the database has 0073 but not 0074 the RPC does
 * not exist (PGRST202) and this falls back to releaseUpload — exactly the
 * pre-0074 behaviour. A NETWORK drop never reaches the server at all: the row
 * stays open, expires at 24 h and the hourly sweep certifies it (0073).
 */
export async function abandonUpload(client, key, reason) {
  inFlightKeys.delete(key)
  const text = String(reason ?? '').slice(0, ABANDON_REASON_MAX) || null
  try {
    const res = await client.rpc('abandon_upload_reservation', { p_path: key, p_reason: text })
    if (res?.error) {
      if (isFunctionMissing(res.error)) {
        console.warn(
          '[supabase] abandon RPC unavailable (migration 0074 is not applied here) — releasing instead:',
          res.error.message,
        )
        return releaseUpload(client, key)
      }
      console.warn('[supabase] upload reservation not abandoned:', res.error.message)
      return false
    }
    return res?.data === true
  } catch (err) {
    console.warn('[supabase] upload reservation not abandoned:', err?.message || err)
    return false
  }
}

/**
 * Track C / 0074, Audrey's ruling 2: a person's own STALE reservations are
 * released when they next open Files — rows a closed tab or a crash left open,
 * which would otherwise hold their bytes for 24 h. The keys this tab is still
 * uploading are kept. Those rows close WITHOUT a certificate (her ruling; the
 * handbook §17 says so). Best-effort, never throws; resolves the number of rows
 * closed — 0 where 0074 is not applied, with no warning (nothing is wrong).
 */
export async function releaseStaleUploads(client) {
  try {
    const res = await client.rpc('release_stale_upload_reservations', { p_keep: [...inFlightKeys] })
    if (res?.error) {
      if (!isFunctionMissing(res.error)) {
        console.warn('[supabase] stale upload reservations not released:', res.error.message)
      }
      return 0
    }
    return Number(res?.data ?? 0)
  } catch (err) {
    console.warn('[supabase] stale upload reservations not released:', err?.message || err)
    return 0
  }
}
