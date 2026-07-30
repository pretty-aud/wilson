// =============================================================================
// _shared/aiKeyCrypto.ts — Session 15
//
// Envelope encryption for per-workspace Anthropic keys
// (public.workspace_ai_keys, migration 0028). Written by operator-ai-keys,
// read by ai-proxy; nothing else touches it.
//
// WHY the key is not stored in plaintext, given the table is already
// service-role-only: locked decisions #11/#15 put a nightly `pg_dump` of
// prod and staging into Backblaze B2. A plaintext column would therefore
// copy every tenant's Anthropic spending credential into an off-platform
// archive with a 90-day retention window. The ciphertext travels into that
// dump; the key that opens it does not, because it lives in the
// WILSON_AI_KEY_SECRET Edge-Function secret.
//
// WHY not Supabase Vault: vault + vault.decrypted_secrets do exist on all
// three hosted projects. But the CI pgTAP job runs `supabase start` against
// a local stack that cannot be run on the development machine (no Docker),
// so a vault dependency inside the migration chain could not be verified
// before it either passed or broke every job at once. AES-GCM at the
// application layer keeps migration 0028 plain SQL, keeps the stored value
// just as opaque in a dump, and puts the crypto somewhere the adversarial
// review can actually read it.
//
// Format (key_version = 1): base64( iv[12] ‖ ciphertext ‖ tag[16] ), which
// is exactly what WebCrypto's AES-GCM encrypt returns with the iv prefixed.
// The random 12-byte IV is per-record, so re-saving the same key twice
// produces different ciphertext.
// =============================================================================

const SECRET_ENV = 'WILSON_AI_KEY_SECRET'
const IV_BYTES = 12

export class AiKeyCryptoUnavailable extends Error {
  constructor() {
    super(`${SECRET_ENV} is not configured`)
    this.name = 'AiKeyCryptoUnavailable'
  }
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
 * Import the data-encryption key from the environment.
 *
 * WILSON_AI_KEY_SECRET must be 32 random bytes, base64-encoded — generate
 * with `openssl rand -base64 32`. A short or malformed value is refused
 * rather than stretched or padded: silently accepting a weak key would make
 * the ciphertext look encrypted while being trivially breakable.
 */
async function importKey(): Promise<CryptoKey> {
  const raw = Deno.env.get(SECRET_ENV) ?? ''
  if (!raw) throw new AiKeyCryptoUnavailable()
  let bytes: Uint8Array
  try {
    bytes = b64decode(raw.trim())
  } catch {
    throw new Error(`${SECRET_ENV} is not valid base64`)
  }
  if (bytes.length !== 32) {
    throw new Error(`${SECRET_ENV} must decode to exactly 32 bytes (got ${bytes.length})`)
  }
  return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** True when the secret is present and usable — used to fail with a clear message. */
export function aiKeyCryptoConfigured(): boolean {
  return !!(Deno.env.get(SECRET_ENV) ?? '')
}

export async function encryptAiKey(plaintext: string): Promise<string> {
  const key = await importKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  )
  const envelope = new Uint8Array(iv.length + ct.length)
  envelope.set(iv, 0)
  envelope.set(ct, iv.length)
  return b64encode(envelope)
}

export async function decryptAiKey(envelopeB64: string): Promise<string> {
  const key = await importKey()
  const envelope = b64decode(envelopeB64)
  if (envelope.length <= IV_BYTES) throw new Error('ai key envelope is truncated')
  const iv = envelope.slice(0, IV_BYTES)
  const ct = envelope.slice(IV_BYTES)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(plain)
}

/**
 * The only part of a tenant key any client ever sees (locked #8 applied to
 * tenant credentials). Last four characters, so the console can show
 * "…9f2c" and an operator can tell two keys apart without either of them
 * being readable.
 */
export function keyHint(plaintext: string): string {
  const t = plaintext.trim()
  return t.length <= 4 ? '*'.repeat(t.length) : t.slice(-4)
}
