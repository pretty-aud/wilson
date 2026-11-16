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
//
// F8 (wave 2, 2026-11-13): the envelope itself (the AES-GCM seal and open,
// the master key's import and its per-isolate cache, the version prefix) is
// _shared/envelopeCrypto.ts, shared with aiKeyCrypto.ts and
// gatewayKeyCrypto.ts. This module keeps what is its own: its secret's name,
// its error class, its sentence for a truncated envelope, and every name it
// exports, with the same signatures. Its cache is its own instance: a key
// imported here is never used by another credential domain.
// =============================================================================

import { lastFourHint, makeVersionedEnvelopeCrypto } from './envelopeCrypto.ts'

const SECRET_ENV = 'WILSON_STORAGE_KEY_SECRET'

export class StorageSecretCryptoUnavailable extends Error {
  constructor(name: string = SECRET_ENV) {
    super(`${name} is not configured`)
    this.name = 'StorageSecretCryptoUnavailable'
  }
}

// WILSON_STORAGE_KEY_SECRET (version 1) or WILSON_STORAGE_KEY_SECRET_V<n>
// must be 32 random bytes, base64-encoded — generate with
// `openssl rand -base64 32`. A short or malformed value is refused rather
// than stretched or padded (the aiKeyCrypto rule, now envelopeCrypto.ts's).
// Truncated means no room for anything after the IV: 12 bytes or fewer.
const envelope = makeVersionedEnvelopeCrypto(SECRET_ENV, {
  unavailable: (name) => new StorageSecretCryptoUnavailable(name),
  truncated: 'storage secret envelope is truncated',
  truncatedAtBytes: 12,
})

/** True when a secret of some version is present — used to fail with a clear message. */
export function storageSecretCryptoConfigured(): boolean {
  return envelope.configured()
}

/** P8 (TPN-ENC-015): the version a new row is sealed under (the highest present), or null. */
export function storageSecretCurrentVersion(): number | null {
  return envelope.currentVersion()
}

export async function encryptStorageSecret(plaintext: string): Promise<string> {
  return await envelope.encrypt(plaintext)
}

export async function decryptStorageSecret(envelopeText: string): Promise<string> {
  // P8 (TPN-ENC-015): the envelope names its version; a bare one is version 1.
  return await envelope.decrypt(envelopeText)
}

/**
 * The only part of a bucket secret any client ever sees (locked #8 applied
 * to tenant credentials, exactly as aiKeyCrypto.keyHint). Last four
 * characters, so the Storage section can show "…9f2c" beside the Test
 * button and an admin can tell two secrets apart without either being
 * readable.
 */
export function storageKeyHint(plaintext: string): string {
  return lastFourHint(plaintext)
}
