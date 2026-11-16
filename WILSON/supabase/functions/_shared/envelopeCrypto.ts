// =============================================================================
// _shared/envelopeCrypto.ts — F8 (wave 2, 2026-11-13): the one envelope the
// three sealed credentials share.
//
// A company's AI key (aiKeyCrypto.ts), its bucket secret
// (storageSecretCrypto.ts) and its ticket-signing key (gatewayKeyCrypto.ts) are
// each sealed at rest with AES-256-GCM under a master secret that lives only in
// the Edge Functions' environment. The three modules were the same code three
// times. This file is that code once. Each module stays the thing a function
// imports, keeps every name it exports, and tells the factory only what ever
// differed between them:
//
//   * its master secret's NAME, and how it reads its environment (the two
//     versioned modules through keyVersions.readEnv, untrimmed; the ticket
//     module from Deno's environment alone, trimmed first);
//   * the error it throws when that secret is not set (each has its own class);
//   * the fewest bytes its envelope may have, and the sentence for one shorter
//     (12 in two of them, 28 in the third: kept apart on purpose);
//   * per call: the additional data (the ticket module only).
//
// 🚨 THREE MASTER SECRETS, STILL THREE. A factory call makes one module's
// crypto, and the cache below lives inside that call, so the three never share
// an entry, even if two environments were given the same value by mistake.
//
// The wire format is unchanged and is the old three's exactly:
//   base64( iv[12] ‖ ciphertext ‖ tag[16] )
// which is what WebCrypto's AES-GCM encrypt returns with the IV put in front.
// The version prefix (`v<n>.`, keyVersions.ts) is added and removed around
// the bare envelope by makeVersionedEnvelopeCrypto, never by the ticket module.
//
// WHY A NEW FILE. keyVersions.ts is pinned pure (no Deno, no WebCrypto);
// gatewayWire.ts is the gateway's wire contract; and putting this in any one
// of the three crypto modules would make the other two credential domains
// import a third domain's file, the opposite of "its own master key".
//
// THE CACHE (the review's C5). The imported CryptoKey is kept for the life of
// the isolate, one entry per secret NAME (so per version: version 2 is another
// name), and an entry is used only while the value read for that name is the
// value it was imported from:
//
//   * the environment is read on every call, BEFORE the cache: a secret taken
//     away reads empty and is refused by name, warm or cold;
//   * a rotation takes effect at once: a new version is a new name, so a new
//     entry; another value under the same name is a miss, imported again, and
//     it replaces the entry;
//   * a failure is never kept: an entry is written only after importKey
//     resolved, so a malformed secret fails every call until it is corrected;
//   * a master a CALLER hands in (vitest's way) is imported for that call and
//     never kept (`keep: false`).
//
// The order of failures is the old modules' and must stay so (a caller and the
// tests read it): not set, then not base64, then not 32 bytes, then WebCrypto;
// and on an open the KEY is asked for before the envelope is looked at, so with
// no secret set a garbage envelope answers "is not configured".
//
// Runtime-agnostic (WebCrypto, TextEncoder, btoa/atob through gatewayWire.ts),
// so vitest runs these exact bytes: src/cloud/edgeEnvelope.test.js holds the
// vectors the old modules sealed, the format written a second time with
// node:crypto, every failure by class, words and order, and the cache's rules.
// =============================================================================

import { fromBase64, toBase64 } from './gatewayWire.ts'
import { currentKeyVersion, envelopeVersion, readEnv, secretNameFor, wrapEnvelope } from './keyVersions.ts'

const IV_BYTES = 12
const KEY_BYTES = 32

/**
 * One master secret as its module read it: the name the errors say, and the
 * value ('' when unset). The module decides what `raw` is, which is how both
 * "is it set" rules survive (the versioned modules hand it over untrimmed, the
 * ticket module trimmed). `keep: false` for a master handed in by a caller.
 */
export type EnvelopeSecret = { name: string; raw: string; keep?: boolean }

export type EnvelopeSpec = {
  /** The module's own "not configured" error, naming the secret that is missing. */
  unavailable: (secretName: string) => Error
  /** The words of the truncated-envelope error, the module's own. */
  truncated: string
  /** An envelope of this many bytes or fewer is truncated (12: the IV; 28: the IV and the tag). */
  truncatedAtBytes: number
}

export type EnvelopeBox = {
  /** The imported master key (memoized, see the header). */
  keyFor(secret: EnvelopeSecret): Promise<CryptoKey>
  /** The bare base64 envelope of the UTF-8 bytes of `plaintext`. */
  seal(key: CryptoKey, plaintext: string, aad?: Uint8Array): Promise<string>
  /** The text a `seal` under the same key (and additional data) was given. */
  open(key: CryptoKey, body: string, aad?: Uint8Array): Promise<string>
}

/**
 * One module's envelope crypto. 32 random bytes, base64 (`openssl rand -base64
 * 32`), is the only master key accepted: a short or malformed value is refused
 * rather than stretched or padded, because silently accepting a weak key would
 * make the ciphertext look encrypted while being trivially breakable.
 */
export function makeEnvelopeCrypto(spec: EnvelopeSpec): EnvelopeBox {
  // name → the value it was imported from, and the key. At most one entry a name.
  const imported = new Map<string, { raw: string; key: CryptoKey }>()

  async function keyFor({ name, raw, keep = true }: EnvelopeSecret): Promise<CryptoKey> {
    // Asked before the cache: an unset secret is refused however warm the entry.
    if (!raw) throw spec.unavailable(name)
    if (keep) {
      const hit = imported.get(name)
      if (hit && hit.raw === raw) return hit.key
    }
    let bytes: Uint8Array
    try {
      bytes = fromBase64(raw.trim())
    } catch {
      throw new Error(`${name} is not valid base64`)
    }
    if (bytes.length !== KEY_BYTES) {
      throw new Error(`${name} must decode to exactly 32 bytes (got ${bytes.length})`)
    }
    const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    // Only now: a failure above stored nothing, and left a good entry as it was.
    if (keep) imported.set(name, { raw, key })
    return key
  }

  async function seal(key: CryptoKey, plaintext: string, aad?: Uint8Array): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const params = aad ? { name: 'AES-GCM', iv, additionalData: aad } : { name: 'AES-GCM', iv }
    const ct = new Uint8Array(await crypto.subtle.encrypt(params, key, new TextEncoder().encode(plaintext)))
    const envelope = new Uint8Array(iv.length + ct.length)
    envelope.set(iv, 0)
    envelope.set(ct, iv.length)
    return toBase64(envelope)
  }

  async function open(key: CryptoKey, body: string, aad?: Uint8Array): Promise<string> {
    const envelope = fromBase64(body) // atob's own error, passed on as it always was
    // Each module's own line (12 or 28): do not "simplify" the two into one.
    if (envelope.length <= spec.truncatedAtBytes) throw new Error(spec.truncated)
    const iv = envelope.slice(0, IV_BYTES)
    const params = aad ? { name: 'AES-GCM', iv, additionalData: aad } : { name: 'AES-GCM', iv }
    const plain = await crypto.subtle.decrypt(params, key, envelope.slice(IV_BYTES))
    return new TextDecoder().decode(plain)
  }

  return { keyFor, seal, open }
}

export type VersionedEnvelope = {
  configured(): boolean
  currentVersion(): number | null
  encrypt(plaintext: string): Promise<string>
  decrypt(envelopeText: string): Promise<string>
}

/**
 * The envelope under keyVersions.ts's rules (P8, TPN-ENC-015): version 1 is the
 * unsuffixed name, 2 to 9 are `<NAME>_V<n>`; a new row is sealed under the
 * highest present and its envelope begins `v<n>.` for n ≥ 2; a row is opened
 * under the version its envelope names. The environment is read through
 * readEnv (Deno's, or Node's for the vitest proof), untrimmed: "is it set" is
 * asked of the value as given, so a value of white space alone is "present"
 * when a row names it, and fails as "must decode to exactly 32 bytes (got 0)".
 */
export function makeVersionedEnvelopeCrypto(secretBaseName: string, spec: EnvelopeSpec): VersionedEnvelope {
  const box = makeEnvelopeCrypto(spec)
  const secretOf = (version: number): EnvelopeSecret => {
    const name = secretNameFor(secretBaseName, version)
    return { name, raw: readEnv(name) }
  }
  return {
    configured: () => currentKeyVersion(secretBaseName) !== null,
    currentVersion: () => currentKeyVersion(secretBaseName),
    async encrypt(plaintext: string): Promise<string> {
      // Which version is current is read from the environment on every seal, never cached.
      const version = currentKeyVersion(secretBaseName)
      if (version === null) throw spec.unavailable(secretBaseName)
      const key = await box.keyFor(secretOf(version))
      return wrapEnvelope(await box.seal(key, plaintext), version)
    },
    async decrypt(envelopeText: string): Promise<string> {
      // The envelope names its version (a bare one is version 1); the key is
      // asked for first, so a missing secret is said before a bad envelope is.
      const { version, body } = envelopeVersion(envelopeText)
      const key = await box.keyFor(secretOf(version))
      return await box.open(key, body)
    },
  }
}

/** The only part of a tenant credential a client ever sees: its last four characters, starred when shorter. */
export function lastFourHint(plaintext: string): string {
  const t = plaintext.trim()
  return t.length <= 4 ? '*'.repeat(t.length) : t.slice(-4)
}
