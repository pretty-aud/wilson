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
//
// F8 (wave 2, 2026-11-13): the client is typed adminGuard.ServiceClient (a
// type only).
//
// F8 (f), the review's C5: the OPENED key is kept per isolate, per workspace
// (openedKeyFor below), so a warm mint no longer decrypts the sealed key and
// imports the Ed25519 key again. The database is still asked for the current
// key on EVERY call (ensureSigningKey): the kept key answers only when the
// row just read names the same kid AND the same ciphertext, and the master key
// is the same one (the identity of gatewayMasterKey()'s memoized import, so a
// changed master secret is a miss and an unset one is refused, warm or cold).
// At most 256 workspaces are kept, the least recently used leaving first, and
// nothing is kept unless the open and the import both succeeded.
// =============================================================================

import type { ServiceClient } from './adminGuard.ts'
import { generateSigningKey, importSigningPrivateKey, KEY_ROTATE_AFTER_SECONDS } from './gatewayTicket.ts'
import { GatewayKeyCryptoUnavailable, gatewayMasterKey, openSigningKey, sealSigningKey } from './gatewayKeyCrypto.ts'

type Client = ServiceClient
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

// ── The opened key, kept (F8 f, C5) ──────────────────────────────────────────
type Opened = { kid: string; ciphertext: string; master: CryptoKey; privateKey: CryptoKey }
/** Workspaces one isolate keeps an opened key for; the least recently used leaves first. */
export const OPENED_KEYS_MAX = 256
// Keyed by the workspace id gateway-ticket hands in from the guard's context;
// the AAD also binds each sealed key to its workspace and kid. A Map keeps
// insertion order, so re-inserting on use makes its first key the LRU one.
const openedKeys = new Map<string, Opened>()

async function openedKeyFor(workspaceId: string, row: KeyRow): Promise<CryptoKey> {
  // First, what openSigningKey asked first: the master key. Unset throws
  // GatewayKeyCryptoUnavailable, malformed a plain Error, exactly as before,
  // warm or cold. Do not move this below the lookup: a kept key must never
  // outlive the master secret that opened it.
  const master = await gatewayMasterKey()
  const hit = openedKeys.get(workspaceId)
  if (hit && hit.kid === row.kid && hit.ciphertext === row.private_key_ciphertext && hit.master === master) {
    openedKeys.delete(workspaceId)
    openedKeys.set(workspaceId, hit)
    return hit.privateKey
  }
  const pkcs8 = await openSigningKey(row.private_key_ciphertext, workspaceId, row.kid)
  const privateKey = await importSigningPrivateKey(pkcs8)
  // Only now, both having succeeded, is anything kept.
  openedKeys.delete(workspaceId)
  openedKeys.set(workspaceId, { kid: row.kid, ciphertext: row.private_key_ciphertext, master, privateKey })
  while (openedKeys.size > OPENED_KEYS_MAX) openedKeys.delete(openedKeys.keys().next().value as string)
  return privateKey
}

/** The key to sign with now: opened (or kept), imported, replaced once if it will not open. */
export async function signingKeyFor(admin: Client, workspaceId: string): Promise<{ kid: string; privateKey: CryptoKey }> {
  // The database read on EVERY call, warm or cold: it names the kid that signs.
  const row = await ensureSigningKey(admin, workspaceId)
  try {
    return { kid: row.kid, privateKey: await openedKeyFor(workspaceId, row) }
  } catch (e) {
    if (e instanceof GatewayKeyCryptoUnavailable) throw e
    console.error(`gateway signing key ${row.kid} will not open (${(e as Error).message}); replacing it`)
    // 60 s: a key made in the last minute is kept (another mint's fresh one).
    const again = await ensureSigningKey(admin, workspaceId, 60)
    return { kid: again.kid, privateKey: await openedKeyFor(workspaceId, again) }
  }
}
