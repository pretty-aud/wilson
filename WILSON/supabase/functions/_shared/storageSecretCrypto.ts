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
//
// P8 (TPN-ENC-015): the secret is VERSIONED and per environment
// (_shared/keyVersions.ts). Version 1 is WILSON_STORAGE_KEY_SECRET; version
// n (2 to 9) is WILSON_STORAGE_KEY_SECRET_V<n>; the highest present seals a
// new row, whose envelope then begins `v<n>.`; a row is opened under the
// version its envelope names (a bare envelope is version 1). The re-seal is
// operator-ai-keys's `reseal` with `secret: 'storage'`. The environment is
// read through readEnv (Deno's, or Node's for the vitest proof).
// =============================================================================

import { secretNameFor, readEnv, currentKeyVersion, envelopeVersion, wrapEnvelope } from './keyVersions.ts'

const SECRET_ENV = 'WILSON_STORAGE_KEY_SECRET'
const IV_BYTES = 12

export class StorageSecretCryptoUnavailable extends Error {
  constructor(name: string = SECRET_ENV) {
    super(`${name} is not configured`)
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
 * Import the data-encryption key of one version from the environment.
 *
 * WILSON_STORAGE_KEY_SECRET (version 1) or WILSON_STORAGE_KEY_SECRET_V<n>
 * must be 32 random bytes, base64-encoded — generate with
 * `openssl rand -base64 32`. A short or malformed value is refused rather
 * than stretched or padded (the aiKeyCrypto rule): silently accepting a weak
 * key would make the ciphertext look encrypted while being trivially
 * breakable.
 */
async function importKey(version: number): Promise<CryptoKey> {
  const name = secretNameFor(SECRET_ENV, version)
  const raw = readEnv(name)
  if (!raw) throw new StorageSecretCryptoUnavailable(name)
  let bytes: Uint8Array
  try {
    bytes = b64decode(raw.trim())
  } catch {
    throw new Error(`${name} is not valid base64`)
  }
  if (bytes.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes (got ${bytes.length})`)
  }
  return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** True when a secret of some version is present — used to fail with a clear message. */
export function storageSecretCryptoConfigured(): boolean {
  return currentKeyVersion(SECRET_ENV) !== null
}

/** P8 (TPN-ENC-015): the version a new row is sealed under (the highest present), or null. */
export function storageSecretCurrentVersion(): number | null {
  return currentKeyVersion(SECRET_ENV)
}

export async function encryptStorageSecret(plaintext: string): Promise<string> {
  const version = currentKeyVersion(SECRET_ENV)
  if (version === null) throw new StorageSecretCryptoUnavailable()
  const key = await importKey(version)
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
  return wrapEnvelope(b64encode(envelope), version)
}

export async function decryptStorageSecret(envelopeText: string): Promise<string> {
  // P8 (TPN-ENC-015): the envelope names its version; a bare one is version 1.
  const { version, body } = envelopeVersion(envelopeText)
  const key = await importKey(version)
  const envelope = b64decode(body)
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
