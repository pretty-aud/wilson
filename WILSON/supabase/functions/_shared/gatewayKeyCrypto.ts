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
// =============================================================================

const SECRET_ENV = 'WILSON_GATEWAY_KEY_SECRET'
const IV_BYTES = 12

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

function b64encode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * 32 random bytes, base64 — `openssl rand -base64 32`. A short or malformed
 * value is refused, never stretched (aiKeyCrypto's rule).
 */
async function importMaster(masterB64?: string): Promise<CryptoKey> {
  const raw = (masterB64 ?? envSecret()).trim()
  if (!raw) throw new GatewayKeyCryptoUnavailable()
  let bytes: Uint8Array
  try {
    bytes = b64decode(raw)
  } catch {
    throw new Error(`${SECRET_ENV} is not valid base64`)
  }
  if (bytes.length !== 32) throw new Error(`${SECRET_ENV} must decode to exactly 32 bytes (got ${bytes.length})`)
  return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export function gatewayKeyCryptoConfigured(): boolean {
  return envSecret().trim() !== ''
}

function aad(workspaceId: string, kid: string): Uint8Array {
  return new TextEncoder().encode(`gateway-signing-key:${workspaceId}:${kid}`)
}

/** Seal a signing key's PKCS#8 (base64) for workspace + kid. */
export async function sealSigningKey(pkcs8B64: string, workspaceId: string, kid: string, masterB64?: string): Promise<string> {
  const key = await importMaster(masterB64)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(workspaceId, kid) },
    key,
    new TextEncoder().encode(pkcs8B64),
  ))
  const envelope = new Uint8Array(iv.length + ct.length)
  envelope.set(iv, 0)
  envelope.set(ct, iv.length)
  return b64encode(envelope)
}

/** Open a sealed signing key; throws on a wrong master key, workspace, kid or a tampered envelope. */
export async function openSigningKey(envelopeB64: string, workspaceId: string, kid: string, masterB64?: string): Promise<string> {
  const key = await importMaster(masterB64)
  const envelope = b64decode(envelopeB64)
  if (envelope.length <= IV_BYTES + 16) throw new Error('the sealed signing key is truncated')
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: envelope.slice(0, IV_BYTES), additionalData: aad(workspaceId, kid) },
    key,
    envelope.slice(IV_BYTES),
  )
  return new TextDecoder().decode(plain)
}
