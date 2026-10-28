// =============================================================================
// _shared/aiFilesKey.ts — P8 (night 5, 2026-10-28), TPN-AI-011: which key an
// AI file upload goes out under, decided fail-CLOSED.
//
// ai-files' resolver used to be a copy of ai-proxy's ("duplicated on
// purpose, keep the two in step"): any failure reading or opening the
// company's own key fell through to the platform key, silently, and the
// company's file — a client PDF, a picture — went to the platform key's
// store, which mixes every company and environment (TPN-AI-010), with only
// `key_source: 'platform'` in the upload's app_events row to say so. For a
// chat call (ai-proxy) that is a billing preference and TPN-AI-005's open
// class; for a FILE STORE a tenant key is also the company's choice of WHERE
// its content is held, and the delete path in the same function already
// refused to fall back (keyForSource). So this is ai-files' own rule now,
// and ai-proxy keeps its copy, untouched, by that file's own instruction.
//
// The outcomes mirror storage-presign's refusals (the same areas, the same
// shape: a code and a sentence, never a re-route of the content):
//   * a company row that will not open  → 500 secret_unusable
//   * the row could not be read          → 503 key_read_failed
//   * the crypto secret unset, row present → 503 crypto_unavailable
//   * no row, a platform key             → the platform key (unchanged)
//   * no row, no platform key            → 501 ai_not_configured (ai-proxy's
//     precedent: a permanent state, so no client retry loop treats it as
//     transient)
//
// Pure and runtime-agnostic (readUrls.ts's arrangement): the row read, the
// decrypt and the environment are handed in, so src/cloud/aiFilesKey.test.js
// drives every outcome with fakes. Nothing here logs a key or a hint.
// =============================================================================

export type AiKeyRow = { key_ciphertext?: string | null; key_version?: number | null } | null

export type ResolvedUploadKey =
  | { ok: true; key: string; source: 'workspace' | 'platform' }
  | { ok: false; error: 'secret_unusable' | 'key_read_failed' | 'crypto_unavailable' | 'ai_not_configured'; status: 500 | 503 | 501; detail: string }

export const NOT_SENT = 'the file was not sent anywhere'

export async function resolveUploadKey({ readRow, decrypt, cryptoConfigured, platformKey }: {
  /** The company's workspace_ai_keys row (service role), or null. */
  readRow: () => Promise<{ data: AiKeyRow; error: { message: string } | null }>
  /** aiKeyCrypto.decryptAiKey (the envelope, and the row's key_version). */
  decrypt: (ciphertext: string, keyVersion?: number | null) => Promise<string>
  /** aiKeyCrypto.aiKeyCryptoConfigured. */
  cryptoConfigured: () => boolean
  /** ANTHROPIC_API_KEY, or '' when unset. */
  platformKey: string
}): Promise<ResolvedUploadKey> {
  let row: AiKeyRow = null
  try {
    const { data, error } = await readRow()
    if (error) throw new Error(error.message)
    row = data
  } catch {
    return {
      ok: false, error: 'key_read_failed', status: 503,
      detail: `the company's own AI key could not be read just now; ${NOT_SENT} — try again in a moment`,
    }
  }
  const ciphertext = typeof row?.key_ciphertext === 'string' && row.key_ciphertext ? row.key_ciphertext : null
  if (ciphertext) {
    if (!cryptoConfigured()) {
      return {
        ok: false, error: 'crypto_unavailable', status: 503,
        detail: `WILSON_AI_KEY_SECRET is not configured on this environment, so the company's own AI key cannot be opened; ${NOT_SENT}`,
      }
    }
    let plain = ''
    try {
      plain = await decrypt(ciphertext, row?.key_version ?? null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        ok: false, error: 'secret_unusable', status: 500,
        detail: `the company's own AI key cannot be opened (${message}) — an operator re-enters it in the console; ${NOT_SENT}`,
      }
    }
    if (!plain) {
      return {
        ok: false, error: 'secret_unusable', status: 500,
        detail: `the company's own AI key opened to nothing — an operator re-enters it in the console; ${NOT_SENT}`,
      }
    }
    return { ok: true, key: plain, source: 'workspace' }
  }
  if (platformKey) return { ok: true, key: platformKey, source: 'platform' }
  return { ok: false, error: 'ai_not_configured', status: 501, detail: `no AI key is configured for this environment; ${NOT_SENT}` }
}
