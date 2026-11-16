// =============================================================================
// _shared/gatewayKeyCrypto.ts — GW1 (post-overhaul, 2026-10-10): the ticket-
// signing keys' private halves, sealed at rest.
//
// The bucket secrets' envelope (storageSecretCrypto.ts) and its reasons: a
// nightly pg_dump of every environment goes to Backblaze B2 with a 90-day
// window, so a plaintext column would copy every workspace's signing key
// off-platform. The ciphertext travels into the dump; the key that opens it
// lives in the Edge secret WILSON_GATEWAY_KEY_SECRET and nowhere else.
//
// 🚨 ITS OWN MASTER KEY, not WILSON_STORAGE_KEY_SECRET and not
// WILSON_AI_KEY_SECRET: the three credential domains rotate independently.
// Rotating this one orphans every workspace's signing key — which is
// survivable by design (gateway-ticket makes a new key when it cannot open
// the old one, and a gateway learns the new public half at its next sync,
// within ten seconds) — and must cost nothing else.
//
// Format: base64( iv[12] ‖ ciphertext ‖ tag[16] ), storageSecretCrypto's
// exactly, with ONE addition: the AES-GCM additional data is
// `gateway-signing-key:<workspace_id>:<kid>`, so a sealed key copied onto
// another workspace's row, or under another kid, does not open.
//
// Runtime-agnostic: the master key may be passed in (vitest) or read from
// the Deno environment (the functions).
//
// F8 (wave 2, 2026-11-13): the envelope itself (the AES-GCM seal and open,
// the master key's import and its per-isolate cache) is
// _shared/envelopeCrypto.ts, shared with aiKeyCrypto.ts and
// storageSecretCrypto.ts. This module keeps what is its own: its secret's
// name and how it is read (Deno's environment ONLY, never Node's; a master
// handed in wins even when it is '', and is never kept), its error class, its
// additional data, its sentence for a truncated key (28 bytes: the IV and the
// tag, where the other two say 12), and NO key versions. It gains one export,
// gatewayMasterKey(): the environment's master, imported once per value.
// =============================================================================

import { makeEnvelopeCrypto, type EnvelopeSecret } from './envelopeCrypto.ts'

const SECRET_ENV = 'WILSON_GATEWAY_KEY_SECRET'

export class GatewayKeyCryptoUnavailable extends Error {
  constructor() {
    super(`${SECRET_ENV} is not configured`)
    this.name = 'GatewayKeyCryptoUnavailable'
  }
}

function envSecret(): string {
  // deno-lint-ignore no-explicit-any
  const d = (globalThis as any).Deno
  return d?.env?.get?.(SECRET_ENV) ?? ''
}

// One instance, one cache: this domain's, never another's. No versions here,
// and none gained: one secret, bare envelopes.
const envelope = makeEnvelopeCrypto({
  unavailable: () => new GatewayKeyCryptoUnavailable(),
  truncated: 'the sealed signing key is truncated',
  truncatedAtBytes: 12 + 16, // the IV and the tag, with no byte of key between them
})

/**
 * 32 random bytes, base64 — `openssl rand -base64 32`. A short or malformed
 * value is refused, never stretched (aiKeyCrypto's rule). The master is the
 * argument when one is passed (`??`: an explicit '' does NOT fall back to the
 * environment), else Deno's environment; it is TRIMMED before it is asked
 * whether it is set (the other two modules ask first), so white space alone
 * is "not configured" here. A master handed in is never kept.
 */
function master(masterB64?: string): EnvelopeSecret {
  return { name: SECRET_ENV, raw: (masterB64 ?? envSecret()).trim(), keep: masterB64 == null }
}

export function gatewayKeyCryptoConfigured(): boolean {
  return envSecret().trim() !== ''
}

/**
 * The environment's master key, imported (memoized by the envelope, per
 * value). Throws what a seal or an open would: GatewayKeyCryptoUnavailable
 * when unset, a plain Error when malformed.
 */
export async function gatewayMasterKey(): Promise<CryptoKey> {
  return await envelope.keyFor(master())
}

function aad(workspaceId: string, kid: string): Uint8Array {
  return new TextEncoder().encode(`gateway-signing-key:${workspaceId}:${kid}`)
}

/** Seal a signing key's PKCS#8 (base64) for workspace + kid. */
export async function sealSigningKey(pkcs8B64: string, workspaceId: string, kid: string, masterB64?: string): Promise<string> {
  const key = await envelope.keyFor(master(masterB64))
  return await envelope.seal(key, pkcs8B64, aad(workspaceId, kid))
}

/** Open a sealed signing key; throws on a wrong master key, workspace, kid or a tampered envelope. */
export async function openSigningKey(envelopeB64: string, workspaceId: string, kid: string, masterB64?: string): Promise<string> {
  // The key first, then the envelope: a missing master is said before a bad envelope is.
  const key = await envelope.keyFor(master(masterB64))
  return await envelope.open(key, envelopeB64, aad(workspaceId, kid))
}
