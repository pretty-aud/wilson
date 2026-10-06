// =============================================================================
// _shared/storageSecretCrypto.ts — Session 37
//
// Envelope encryption for per-workspace bucket secrets
// (public.workspace_storage_secrets, migration 0051). Written by
// storage-secret, read by storage-presign and storage-gc; nothing else
// touches it.
//
// The storage-shaped twin of aiKeyCrypto.ts (0028 precedent), and the same
// WHY: locked decisions #11/#15 put a nightly `pg_dump` of prod and staging
// into Backblaze B2 with a 90-day window. A plaintext column would copy
// every tenant's bucket credential into that off-platform archive. The
// ciphertext travels into the dump; the key that opens it does not, because
// it lives in the WILSON_STORAGE_KEY_SECRET Edge-Function secret.
//
// 🚨 ITS OWN MASTER KEY, deliberately not WILSON_AI_KEY_SECRET. The two
// credential domains must rotate independently: rotating the AI master key
// already orphans every stored Anthropic key (OWED_AUDREY §C) — it must not
// ALSO cut every workspace off from its own media, and vice versa.
//
// Format (key_version = 1): base64( iv[12] ‖ ciphertext ‖ tag[16] ) — exactly
// aiKeyCrypto's envelope, so the adversarial review reads one format, not two.
// The random 12-byte IV is per-record; re-saving the same secret twice
// produces different ciphertext.
// =============================================================================

const SECRET_ENV = 'WILSON_STORAGE_KEY_SECRET'
const IV_BYTES = 12

export class StorageSecretCryptoUnavailable extends Error {
  constructor() {
    super(`${SECRET_ENV} is not configured`)
    this.name = 'StorageSecretCryptoUnavailable'
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
 * WILSON_STORAGE_KEY_SECRET must be 32 random bytes, base64-encoded —
 * generate with `openssl rand -base64 32`. A short or malformed value is
 * refused rather than stretched or padded (the aiKeyCrypto rule): silently
 * accepting a weak key would make the ciphertext look encrypted while being
 * trivially breakable.
 */
async function importKey(): Promise<CryptoKey> {
  const raw = Deno.env.get(SECRET_ENV) ?? ''
  if (!raw) throw new StorageSecretCryptoUnavailable()
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
export function storageSecretCryptoConfigured(): boolean {
  return !!(Deno.env.get(SECRET_ENV) ?? '')
}

export async function encryptStorageSecret(plaintext: string): Promise<string> {
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

export async function decryptStorageSecret(envelopeB64: string): Promise<string> {
  const key = await importKey()
  const envelope = b64decode(envelopeB64)
  if (envelope.length <= IV_BYTES) throw new Error('storage secret envelope is truncated')
  const iv = envelope.slice(0, IV_BYTES)
  const ct = envelope.slice(IV_BYTES)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(plain)
}

/**
 * The only part of a bucket secret any client ever sees (locked #8 applied
 * to tenant credentials, exactly as aiKeyCrypto.keyHint). Last four
 * characters, so the Storage section can show "…9f2c" beside the Test
 * button and an admin can tell two secrets apart without either being
 * readable.
 */
export function storageKeyHint(plaintext: string): string {
  const t = plaintext.trim()
  return t.length <= 4 ? '*'.repeat(t.length) : t.slice(-4)
}
