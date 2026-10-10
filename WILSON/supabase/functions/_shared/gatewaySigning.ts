// =============================================================================
// _shared/gatewaySigning.ts — GW1 (post-overhaul, 2026-10-10): a workspace's
// ticket-signing key, made when there is none, rotated after a year, opened
// for one mint at a time (GATEWAY_DESIGN.md §5 step 4, D1).
//
// The private half never leaves this process unsealed: it is generated
// here, sealed under WILSON_GATEWAY_KEY_SECRET (gatewayKeyCrypto.ts, bound to
// the workspace and kid) before it reaches the database, and opened only to
// sign. gateway_signing_key_put stores a new key under an advisory lock per
// workspace, so two first mints make ONE key and the loser signs with the
// winner's. A key that will not open (the master key was rotated, or the
// envelope is damaged) is replaced once, at once: gateways learn the new
// public half at their next sync (ten seconds), and an unknown kid makes a
// gateway sync once more before refusing (GW2), so the cost is a hiccup.
// =============================================================================

import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { generateSigningKey, importSigningPrivateKey, KEY_ROTATE_AFTER_SECONDS } from './gatewayTicket.ts'
import { GatewayKeyCryptoUnavailable, openSigningKey, sealSigningKey } from './gatewayKeyCrypto.ts'

type Client = ReturnType<typeof createClient>
export type KeyRow = { kid: string; public_key: string; private_key_ciphertext: string }

/** The workspace's current key, or a new one stored in its place when none is young enough. */
export async function ensureSigningKey(admin: Client, workspaceId: string, rotateAfterSeconds = KEY_ROTATE_AFTER_SECONDS): Promise<KeyRow> {
  const { data: current, error } = await admin.rpc('gateway_signing_key_current', {
    p_workspace: workspaceId, p_rotate_after_seconds: rotateAfterSeconds,
  })
  if (error) throw new Error(`the signing key could not be read: ${error.message}`)
  if (current) return current as KeyRow
  const fresh = await generateSigningKey()
  const sealed = await sealSigningKey(fresh.privatePkcs8, workspaceId, fresh.kid)
  const { data: stored, error: putErr } = await admin.rpc('gateway_signing_key_put', {
    p_workspace: workspaceId, p_kid: fresh.kid, p_public_key: fresh.publicKey,
    p_ciphertext: sealed, p_rotate_after_seconds: rotateAfterSeconds,
  })
  if (putErr || !stored) throw new Error(`the signing key could not be stored: ${putErr?.message ?? 'no row'}`)
  return stored as KeyRow
}

/** The key to sign with now: opened, imported, replaced once if it will not open. */
export async function signingKeyFor(admin: Client, workspaceId: string): Promise<{ kid: string; privateKey: CryptoKey }> {
  const row = await ensureSigningKey(admin, workspaceId)
  try {
    const pkcs8 = await openSigningKey(row.private_key_ciphertext, workspaceId, row.kid)
    return { kid: row.kid, privateKey: await importSigningPrivateKey(pkcs8) }
  } catch (e) {
    if (e instanceof GatewayKeyCryptoUnavailable) throw e
    console.error(`gateway signing key ${row.kid} will not open (${(e as Error).message}); replacing it`)
    // 60 s: a key made in the last minute is kept (another mint's fresh one).
    const again = await ensureSigningKey(admin, workspaceId, 60)
    const pkcs8 = await openSigningKey(again.private_key_ciphertext, workspaceId, again.kid)
    return { kid: again.kid, privateKey: await importSigningPrivateKey(pkcs8) }
  }
}
