// =============================================================================
// edgeEnvelope.test.js — F8 (wave 2, 2026-11-13): the three sealed-secret
// modules, held to what they did before they shared one envelope.
//
// aiKeyCrypto.ts, storageSecretCrypto.ts and gatewayKeyCrypto.ts each seal a
// credential at rest: a company's AI key, its bucket secret, its ticket-signing
// key. F8 made the three thin callers of one factory (_shared/envelopeCrypto.ts)
// and keeps each imported master key for the life of the isolate. Nothing a
// stored row or a caller can see may have moved, so this file holds:
//
//   1. VECTORS sealed by the modules as they stood at a71cd144 (the code
//      before F8), which must still open; and the wire format written out a
//      second time with node:crypto, so a value the new code seals opens in
//      the old format and the other way round. While F7 and F8 both ran,
//      wilson-dev's functions bundled old and new copies side by side.
//   2. every failure by its class, its words and its ORDER;
//   3. the cache: one import per secret, version and value; a rotation takes
//      effect while it is warm; a failure is never kept.
//
// Every key here is made in this file (a counted pattern, or random bytes),
// set in this process's environment for one test, and is nobody's secret.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import {
  encryptAiKey, decryptAiKey, aiKeyCryptoConfigured, aiKeyCurrentVersion, AiKeyCryptoUnavailable, keyHint,
} from '../../supabase/functions/_shared/aiKeyCrypto.ts'
import {
  encryptStorageSecret, decryptStorageSecret, storageSecretCryptoConfigured, storageSecretCurrentVersion,
  StorageSecretCryptoUnavailable, storageKeyHint,
} from '../../supabase/functions/_shared/storageSecretCrypto.ts'
import {
  sealSigningKey, openSigningKey, gatewayKeyCryptoConfigured, GatewayKeyCryptoUnavailable, gatewayMasterKey,
} from '../../supabase/functions/_shared/gatewayKeyCrypto.ts'

const AI = 'WILSON_AI_KEY_SECRET'
const ST = 'WILSON_STORAGE_KEY_SECRET'
const GW = 'WILSON_GATEWAY_KEY_SECRET'
const NAMES = [AI, `${AI}_V2`, `${AI}_V3`, ST, `${ST}_V2`, `${ST}_V3`, GW]

/** A test key anyone can recompute: 32 bytes counted from a seed. Not a secret. */
const countedKey = (seed) => Buffer.from(Array.from({ length: 32 }, (_, i) => (i * seed + 13) & 0xff)).toString('base64')
const fresh = () => randomBytes(32).toString('base64')
/** The gateway module reads Deno's environment and nothing else. */
const denoEnv = (values) => vi.stubGlobal('Deno', { env: { get: (n) => values[n] } })
const gwAad = (ws, kid) => `gateway-signing-key:${ws}:${kid}`

// The wire format, written out a second time and independently (node:crypto,
// not WebCrypto): base64( iv[12] ‖ ciphertext ‖ tag[16] ), AES-256-GCM, the
// additional data only where the module has one.
function formatOpen(bodyB64, keyB64, aad = null) {
  const buf = Buffer.from(bodyB64, 'base64')
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), buf.subarray(0, 12))
  if (aad !== null) d.setAAD(Buffer.from(aad, 'utf8'))
  d.setAuthTag(buf.subarray(buf.length - 16))
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8')
}
function formatSeal(plain, keyB64, aad = null) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv)
  if (aad !== null) c.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64')
}

afterEach(() => {
  for (const n of NAMES) delete process.env[n]
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Sealed on 2026-11-13 by the three modules as they stood at a71cd144, under
// countedKey(seed). If one of these stops opening, a stored row would too.
const OLD = {
  ai_v1: { seed: 7, plain: 'sk-ant-f8-vector-one', sealed: '2ZQJ32NeNhSLx4DjDB3+qJ+h1cnlmFW0jYJEJTkRygyK/ecl88MndmfhenUrfoDm' },
  ai_v2: { seed: 11, plain: 'sk-ant-f8-vector-two', sealed: 'v2.P+jxxSDvPqVyp8anW02FyK30lv55UYkbOvh6H6/TGk9HQoaxn+C7qw9wFH44WPub' },
  storage_v1: { seed: 5, plain: 'bucket-secret-f8-vector-one', sealed: 'WAhPOVW+UNU917OHMDNRnHWU7jqrijgh0ghZsew2mS+jCW4nyHo4k7YT/BGaSzm13nlO5vnehg==' },
  storage_v3: { seed: 3, plain: 'bucket-secret-f8-vector-three', sealed: 'v3.o3ZGhJcumUOIBPVy2EG7a0LoNc9Z+vNCVYgFEHz9KIA8sKd4yCeDy8UYTRAstxMMP1lELhFD3996' },
  gateway_given: {
    seed: 9, plain: 'cGtjczgtZjgtdmVjdG9y', ws: '11111111-1111-4111-8111-111111111111', kid: 'kf8vector1',
    sealed: 'tGxd5a+q2oI96JoT8IshLNEw1vLBWr+HmyMLQGuuDK5XD3F1Jk5SnebjS0OyMp/i',
  },
  gateway_env: {
    seed: 9, plain: 'cGtjczgtZjgtdmVjdG9yLTI=', ws: '22222222-2222-4222-8222-222222222222', kid: 'kf8vector2',
    sealed: 'W1GZs+mmm91xy6fp7ersytPuw1Id51XgNizajTNVE1Q+zyTiJDJ1mJENP7tBtfn79JcuXQ==',
  },
}

describe('what the modules sealed before F8 still opens', () => {
  it('a company AI key: a bare version-1 row and a v2. row, each under its own version', async () => {
    process.env[AI] = countedKey(OLD.ai_v1.seed)
    process.env[`${AI}_V2`] = countedKey(OLD.ai_v2.seed)
    expect(await decryptAiKey(OLD.ai_v1.sealed)).toBe(OLD.ai_v1.plain)
    expect(await decryptAiKey(OLD.ai_v2.sealed)).toBe(OLD.ai_v2.plain)
  })
  it('a bucket secret: a bare version-1 row and a v3. row', async () => {
    process.env[ST] = countedKey(OLD.storage_v1.seed)
    process.env[`${ST}_V3`] = countedKey(OLD.storage_v3.seed)
    expect(await decryptStorageSecret(OLD.storage_v1.sealed)).toBe(OLD.storage_v1.plain)
    expect(await decryptStorageSecret(OLD.storage_v3.sealed)).toBe(OLD.storage_v3.plain)
  })
  it('a ticket-signing key: the master handed in, and the master read from Deno\'s environment', async () => {
    const g = OLD.gateway_given
    expect(await openSigningKey(g.sealed, g.ws, g.kid, countedKey(g.seed))).toBe(g.plain)
    const e = OLD.gateway_env
    denoEnv({ [GW]: countedKey(e.seed) })
    expect(await openSigningKey(e.sealed, e.ws, e.kid)).toBe(e.plain)
  })
  it('a ticket-signing key opens only for its own company and key id (the additional data)', async () => {
    const g = OLD.gateway_given
    const master = countedKey(g.seed)
    await expect(openSigningKey(g.sealed, OLD.gateway_env.ws, g.kid, master)).rejects.toThrow()
    await expect(openSigningKey(g.sealed, g.ws, 'kf8vector2', master)).rejects.toThrow()
    await expect(openSigningKey(g.sealed, g.ws, g.kid, countedKey(8))).rejects.toThrow()
    // Without the additional data it is not the same envelope at all.
    expect(() => formatOpen(g.sealed, master)).toThrow()
    expect(formatOpen(g.sealed, master, gwAad(g.ws, g.kid))).toBe(g.plain)
  })
})

describe('the wire format did not move: old opens new, new opens old', () => {
  it('aiKeyCrypto: version 1 is bare, version 2 carries v2., no additional data', async () => {
    const k1 = fresh(); const k2 = fresh()
    process.env[AI] = k1
    const bare = await encryptAiKey('sk-ant-throwaway-a')
    expect(bare).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(formatOpen(bare, k1)).toBe('sk-ant-throwaway-a')
    expect(await decryptAiKey(formatSeal('sk-ant-throwaway-b', k1))).toBe('sk-ant-throwaway-b')
    process.env[`${AI}_V2`] = k2
    const v2 = await encryptAiKey('sk-ant-throwaway-c')
    expect(v2.startsWith('v2.')).toBe(true)
    expect(formatOpen(v2.slice(3), k2)).toBe('sk-ant-throwaway-c')
    expect(await decryptAiKey(`v2.${formatSeal('sk-ant-throwaway-d', k2)}`)).toBe('sk-ant-throwaway-d')
    // 12 bytes of IV, the text, 16 bytes of tag: nothing else rides in the envelope.
    expect(Buffer.from(bare, 'base64').length).toBe(12 + 'sk-ant-throwaway-a'.length + 16)
  })
  it('storageSecretCrypto: the same envelope under its own names', async () => {
    const k1 = fresh(); const k3 = fresh()
    process.env[ST] = k1
    const bare = await encryptStorageSecret('bucket-throwaway-a')
    expect(formatOpen(bare, k1)).toBe('bucket-throwaway-a')
    expect(await decryptStorageSecret(formatSeal('bucket-throwaway-b', k1))).toBe('bucket-throwaway-b')
    process.env[`${ST}_V3`] = k3
    const v3 = await encryptStorageSecret('bucket-throwaway-c')
    expect(v3.startsWith('v3.')).toBe(true)
    expect(formatOpen(v3.slice(3), k3)).toBe('bucket-throwaway-c')
    expect(await decryptStorageSecret(`v3.${formatSeal('bucket-throwaway-d', k3)}`)).toBe('bucket-throwaway-d')
  })
  it('gatewayKeyCrypto: no version prefix, and the additional data names the company and the key id', async () => {
    const master = fresh()
    const ws = '33333333-3333-4333-8333-333333333333'
    const sealed = await sealSigningKey('cGtjczg=', ws, 'k1', master)
    expect(sealed).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(formatOpen(sealed, master, gwAad(ws, 'k1'))).toBe('cGtjczg=')
    expect(await openSigningKey(formatSeal('cGtjczgtMg==', master, gwAad(ws, 'k9')), ws, 'k9', master)).toBe('cGtjczgtMg==')
    // An envelope sealed with NO additional data (the other two modules' kind) is not a signing key.
    await expect(openSigningKey(formatSeal('cGtjczg=', master), ws, 'k1', master)).rejects.toThrow()
    // A v2. prefix is not this module's: it has no versions.
    await expect(openSigningKey(`v2.${sealed}`, ws, 'k1', master)).rejects.toThrow()
  })
  it('the three secrets are three: one module\'s name says nothing to another', async () => {
    process.env[AI] = fresh()
    expect(aiKeyCryptoConfigured()).toBe(true)
    expect(storageSecretCryptoConfigured()).toBe(false)
    expect(gatewayKeyCryptoConfigured()).toBe(false)
    const sealed = await encryptAiKey('sk-ant-throwaway-e')
    await expect(decryptStorageSecret(sealed)).rejects.toBeInstanceOf(StorageSecretCryptoUnavailable)
  })
})

describe('each failure: its class, its words, its order', () => {
  it('aiKeyCrypto', async () => {
    expect(aiKeyCurrentVersion()).toBeNull()
    const none = await encryptAiKey('x').catch((e) => e)
    expect(none).toBeInstanceOf(AiKeyCryptoUnavailable)
    expect(none.name).toBe('AiKeyCryptoUnavailable')
    expect(none.message).toBe('WILSON_AI_KEY_SECRET is not configured')
    // The key is asked for before the envelope is looked at: garbage with no secret is "not configured".
    expect((await decryptAiKey('!!! not base64 !!!').catch((e) => e)).message).toBe('WILSON_AI_KEY_SECRET is not configured')
    // An envelope names its version, and a version that is not set is refused by its own name.
    const v3 = await decryptAiKey('v3.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').catch((e) => e)
    expect(v3).toBeInstanceOf(AiKeyCryptoUnavailable)
    expect(v3.message).toBe('WILSON_AI_KEY_SECRET_V3 is not configured')
    process.env[AI] = '*** not base64 ***'
    await expect(encryptAiKey('x')).rejects.toThrow('WILSON_AI_KEY_SECRET is not valid base64')
    process.env[AI] = Buffer.alloc(8).toString('base64')
    const short = await encryptAiKey('x').catch((e) => e)
    expect(short).not.toBeInstanceOf(AiKeyCryptoUnavailable)
    expect(short.message).toBe('WILSON_AI_KEY_SECRET must decode to exactly 32 bytes (got 8)')
    process.env[AI] = `  ${fresh()}\n` // white space around a value is forgiven, as before
    const sealed = await encryptAiKey('sk-ant-throwaway-f')
    expect(await decryptAiKey(sealed)).toBe('sk-ant-throwaway-f')
    // Truncated means "no room for anything after the IV": 12 bytes or fewer.
    await expect(decryptAiKey(Buffer.alloc(12).toString('base64'))).rejects.toThrow('ai key envelope is truncated')
    const thirteen = await decryptAiKey(Buffer.alloc(13).toString('base64')).catch((e) => e)
    expect(thirteen.message).not.toMatch(/truncated/)
    // A body that is not base64 is atob's own refusal, passed on as it is.
    const garbage = await decryptAiKey('!!! not base64 !!!').catch((e) => e)
    expect(garbage.name).toBe('InvalidCharacterError')
    expect(keyHint('  sk-ant-abcd1234  ')).toBe('1234')
    expect(keyHint('abc')).toBe('***')
  })
  it('storageSecretCrypto', async () => {
    expect(storageSecretCurrentVersion()).toBeNull()
    const none = await encryptStorageSecret('x').catch((e) => e)
    expect(none).toBeInstanceOf(StorageSecretCryptoUnavailable)
    expect(none.name).toBe('StorageSecretCryptoUnavailable')
    expect(none.message).toBe('WILSON_STORAGE_KEY_SECRET is not configured')
    expect((await decryptStorageSecret('!!! not base64 !!!').catch((e) => e)).message).toBe('WILSON_STORAGE_KEY_SECRET is not configured')
    const v2 = await decryptStorageSecret('v2.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').catch((e) => e)
    expect(v2).toBeInstanceOf(StorageSecretCryptoUnavailable)
    expect(v2.message).toBe('WILSON_STORAGE_KEY_SECRET_V2 is not configured')
    process.env[ST] = '*** not base64 ***'
    await expect(encryptStorageSecret('x')).rejects.toThrow('WILSON_STORAGE_KEY_SECRET is not valid base64')
    process.env[ST] = Buffer.alloc(31).toString('base64')
    await expect(encryptStorageSecret('x')).rejects.toThrow('WILSON_STORAGE_KEY_SECRET must decode to exactly 32 bytes (got 31)')
    process.env[ST] = fresh()
    await expect(decryptStorageSecret(Buffer.alloc(12).toString('base64'))).rejects.toThrow('storage secret envelope is truncated')
    expect((await decryptStorageSecret(Buffer.alloc(13).toString('base64')).catch((e) => e)).message).not.toMatch(/truncated/)
    expect((await decryptStorageSecret('!!! not base64 !!!').catch((e) => e)).name).toBe('InvalidCharacterError')
    expect(storageKeyHint('  secret-wxyz  ')).toBe('wxyz')
    expect(storageKeyHint('ab')).toBe('**')
  })
  it('gatewayKeyCrypto', async () => {
    const ws = '44444444-4444-4444-8444-444444444444'
    // No master handed in and no Deno: not configured. Node's own environment is NOT where it looks.
    process.env[GW] = fresh()
    expect(gatewayKeyCryptoConfigured()).toBe(false)
    const none = await sealSigningKey('x', ws, 'k1').catch((e) => e)
    expect(none).toBeInstanceOf(GatewayKeyCryptoUnavailable)
    expect(none.name).toBe('GatewayKeyCryptoUnavailable')
    expect(none.message).toBe('WILSON_GATEWAY_KEY_SECRET is not configured')
    await expect(openSigningKey('!!! not base64 !!!', ws, 'k1')).rejects.toBeInstanceOf(GatewayKeyCryptoUnavailable)
    await expect(sealSigningKey('x', ws, 'k1', '')).rejects.toBeInstanceOf(GatewayKeyCryptoUnavailable)
    await expect(sealSigningKey('x', ws, 'k1', '   ')).rejects.toBeInstanceOf(GatewayKeyCryptoUnavailable)
    await expect(sealSigningKey('x', ws, 'k1', '*** not base64 ***')).rejects.toThrow('WILSON_GATEWAY_KEY_SECRET is not valid base64')
    await expect(sealSigningKey('x', ws, 'k1', Buffer.alloc(16).toString('base64')))
      .rejects.toThrow('WILSON_GATEWAY_KEY_SECRET must decode to exactly 32 bytes (got 16)')
    denoEnv({ [GW]: `  ${fresh()}  ` })
    expect(gatewayKeyCryptoConfigured()).toBe(true)
    const sealed = await sealSigningKey('cGtjczg=', ws, 'k1')
    expect(await openSigningKey(sealed, ws, 'k1')).toBe('cGtjczg=')
    // Truncated here means "no room for a byte between the IV and the tag": 28 bytes or fewer.
    await expect(openSigningKey(Buffer.alloc(28).toString('base64'), ws, 'k1')).rejects.toThrow('the sealed signing key is truncated')
    expect((await openSigningKey(Buffer.alloc(29).toString('base64'), ws, 'k1').catch((e) => e)).message).not.toMatch(/truncated/)
    expect((await openSigningKey('!!! not base64 !!!', ws, 'k1').catch((e) => e)).name).toBe('InvalidCharacterError')
    denoEnv({ [GW]: '   ' })
    expect(gatewayKeyCryptoConfigured()).toBe(false)
  })
})

// The places the design (F8 DESIGN.md §13, items 1 to 4) names as the likeliest
// to move by accident when three modules become one factory.
describe('the differences between the three that the factory must keep', () => {
  it('white space alone: "present" to the two versioned modules (judged untrimmed), "not configured" to the ticket module (trimmed first)', async () => {
    process.env[AI] = '   '
    // Sealing asks keyVersions which version is current, and it trims: none is.
    await expect(encryptAiKey('x')).rejects.toBeInstanceOf(AiKeyCryptoUnavailable)
    // Opening names version 1 and asks for its value as given: present, and 0 bytes long.
    const opened = decryptAiKey(Buffer.alloc(40).toString('base64'))
    await expect(opened).rejects.not.toBeInstanceOf(AiKeyCryptoUnavailable)
    await expect(decryptAiKey(Buffer.alloc(40).toString('base64'))).rejects.toThrow('WILSON_AI_KEY_SECRET must decode to exactly 32 bytes (got 0)')
    process.env[ST] = ' \n '
    await expect(decryptStorageSecret(Buffer.alloc(40).toString('base64'))).rejects.toThrow('WILSON_STORAGE_KEY_SECRET must decode to exactly 32 bytes (got 0)')
    denoEnv({ [GW]: '   ' })
    await expect(openSigningKey(Buffer.alloc(40).toString('base64'), 'ws', 'k1')).rejects.toBeInstanceOf(GatewayKeyCryptoUnavailable)
    await expect(gatewayMasterKey()).rejects.toBeInstanceOf(GatewayKeyCryptoUnavailable)
  })
  it('a 20-byte envelope: AES-GCM\'s own refusal in the two key modules, "truncated" in the ticket module (12 against 28)', async () => {
    const twenty = Buffer.alloc(20).toString('base64')
    process.env[AI] = fresh()
    process.env[ST] = fresh()
    const ai = await decryptAiKey(twenty).catch((e) => e)
    expect(ai.name).toBe('OperationError')
    const st = await decryptStorageSecret(twenty).catch((e) => e)
    expect(st.name).toBe('OperationError')
    await expect(openSigningKey(twenty, 'ws', 'k1', fresh())).rejects.toThrow('the sealed signing key is truncated')
  })
  it('the key before the envelope, in all three: no secret and a garbage envelope is "not configured", never atob\'s error', async () => {
    await expect(decryptAiKey('!!!')).rejects.toBeInstanceOf(AiKeyCryptoUnavailable)
    await expect(decryptStorageSecret('!!!')).rejects.toBeInstanceOf(StorageSecretCryptoUnavailable)
    await expect(openSigningKey('!!!', 'ws', 'k1')).rejects.toBeInstanceOf(GatewayKeyCryptoUnavailable)
    // A bad secret is said before a bad envelope, too.
    process.env[AI] = Buffer.alloc(8).toString('base64')
    await expect(decryptAiKey('!!!')).rejects.toThrow('WILSON_AI_KEY_SECRET must decode to exactly 32 bytes (got 8)')
  })
  it('a master handed in wins even when it is \'\' (no fall back to the environment), and Node\'s environment never configures the ticket module', async () => {
    denoEnv({ [GW]: fresh() })
    await expect(sealSigningKey('x', 'ws', 'k1', '')).rejects.toBeInstanceOf(GatewayKeyCryptoUnavailable)
    await expect(openSigningKey(Buffer.alloc(40).toString('base64'), 'ws', 'k1', '')).rejects.toBeInstanceOf(GatewayKeyCryptoUnavailable)
    vi.unstubAllGlobals()
    process.env[GW] = fresh()
    expect(gatewayKeyCryptoConfigured()).toBe(false)
    await expect(gatewayMasterKey()).rejects.toBeInstanceOf(GatewayKeyCryptoUnavailable)
  })
  it('every module exports what it exported before F8; the ticket module gains gatewayMasterKey and nothing else', async () => {
    const names = async (file) => Object.keys(await import(`../../supabase/functions/_shared/${file}`)).sort()
    expect(await names('aiKeyCrypto.ts')).toEqual([
      'AiKeyCryptoUnavailable', 'aiKeyCryptoConfigured', 'aiKeyCurrentVersion', 'decryptAiKey', 'encryptAiKey', 'keyHint',
    ].sort())
    expect(await names('storageSecretCrypto.ts')).toEqual([
      'StorageSecretCryptoUnavailable', 'decryptStorageSecret', 'encryptStorageSecret', 'storageKeyHint',
      'storageSecretCryptoConfigured', 'storageSecretCurrentVersion',
    ].sort())
    expect(await names('gatewayKeyCrypto.ts')).toEqual([
      'GatewayKeyCryptoUnavailable', 'gatewayKeyCryptoConfigured', 'gatewayMasterKey', 'openSigningKey', 'sealSigningKey',
    ].sort())
  })
})

describe('gatewayMasterKey: the environment\'s master, imported once per value', () => {
  it('the same key object while the value stands; another value is another key; it is the key the seal uses', async () => {
    const first = fresh()
    denoEnv({ [GW]: first })
    const spy = vi.spyOn(globalThis.crypto.subtle, 'importKey')
    const a = await gatewayMasterKey()
    expect(await gatewayMasterKey()).toBe(a)
    const sealed = await sealSigningKey('pkcs8', 'ws', 'k1')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(formatOpen(sealed, first, gwAad('ws', 'k1'))).toBe('pkcs8')
    denoEnv({ [GW]: fresh() })
    const b = await gatewayMasterKey()
    expect(b).not.toBe(a)
    expect(spy).toHaveBeenCalledTimes(2)
  })
  it('unset: GatewayKeyCryptoUnavailable though it was warm; malformed: a plain Error with the module\'s words', async () => {
    denoEnv({ [GW]: fresh() })
    await expect(gatewayMasterKey()).resolves.toBeTruthy()
    denoEnv({})
    await expect(gatewayMasterKey()).rejects.toBeInstanceOf(GatewayKeyCryptoUnavailable)
    denoEnv({ [GW]: 'tooshort' })
    const bad = await gatewayMasterKey().catch((e) => e)
    expect(bad).not.toBeInstanceOf(GatewayKeyCryptoUnavailable)
    expect(bad.message).toBe('WILSON_GATEWAY_KEY_SECRET must decode to exactly 32 bytes (got 6)')
  })
})

describe('the master key is imported once per secret, version and value (C5)', () => {
  const imports = () => vi.spyOn(globalThis.crypto.subtle, 'importKey')

  it('aiKeyCrypto: ten seals and ten opens import the key once', async () => {
    process.env[AI] = fresh()
    const spy = imports()
    const sealed = []
    for (let i = 0; i < 10; i++) sealed.push(await encryptAiKey(`sk-ant-throwaway-${i}`))
    for (let i = 0; i < 10; i++) expect(await decryptAiKey(sealed[i])).toBe(`sk-ant-throwaway-${i}`)
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('storageSecretCrypto: ten seals and ten opens import the key once', async () => {
    process.env[ST] = fresh()
    const spy = imports()
    const sealed = []
    for (let i = 0; i < 10; i++) sealed.push(await encryptStorageSecret(`bucket-throwaway-${i}`))
    for (let i = 0; i < 10; i++) expect(await decryptStorageSecret(sealed[i])).toBe(`bucket-throwaway-${i}`)
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('gatewayKeyCrypto: ten seals and ten opens under the environment\'s master import it once', async () => {
    denoEnv({ [GW]: fresh() })
    const ws = '55555555-5555-4555-8555-555555555555'
    const spy = imports()
    const sealed = []
    for (let i = 0; i < 10; i++) sealed.push(await sealSigningKey(`pkcs8-${i}`, ws, `k${i}`))
    for (let i = 0; i < 10; i++) expect(await openSigningKey(sealed[i], ws, `k${i}`)).toBe(`pkcs8-${i}`)
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('gatewayKeyCrypto: a master handed in by the caller is never kept', async () => {
    const master = fresh()
    const ws = '55555555-5555-4555-8555-555555555555'
    const spy = imports()
    const sealed = await sealSigningKey('pkcs8', ws, 'k1', master)
    expect(await openSigningKey(sealed, ws, 'k1', master)).toBe('pkcs8')
    expect(spy).toHaveBeenCalledTimes(2)
    // Review round 1, T2: counting the handed-in calls alone would pass even if the
    // key were STORED (a handed-in call skips the lookup too). So the environment
    // now holds the very same value: a seal and an open WITHOUT a master must
    // import it once, never find it already there.
    denoEnv({ [GW]: master })
    spy.mockClear()
    const again = await sealSigningKey('pkcs8-env', ws, 'k2')
    expect(await openSigningKey(again, ws, 'k2')).toBe('pkcs8-env')
    expect(await openSigningKey(sealed, ws, 'k1')).toBe('pkcs8')
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('each version is its own key: two versions in use are two imports, however many calls', async () => {
    process.env[AI] = fresh()
    const spy = imports()
    const v1 = await encryptAiKey('sk-ant-throwaway-v1')
    process.env[`${AI}_V2`] = fresh()
    const v2 = await encryptAiKey('sk-ant-throwaway-v2')
    for (let i = 0; i < 5; i++) {
      expect(await decryptAiKey(v1)).toBe('sk-ant-throwaway-v1')
      expect(await decryptAiKey(v2)).toBe('sk-ant-throwaway-v2')
    }
    expect(spy).toHaveBeenCalledTimes(2)
  })
  it('the two modules share nothing: the same value under both names is imported for each', async () => {
    const same = fresh()
    process.env[AI] = same
    process.env[ST] = same
    const spy = imports()
    await encryptAiKey('sk-ant-throwaway')
    await encryptStorageSecret('bucket-throwaway')
    await encryptAiKey('sk-ant-throwaway')
    await encryptStorageSecret('bucket-throwaway')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('a rotation takes effect while the cache is warm', () => {
  it('a new version seals the next row under ITS key, not the cached one (red when the cache is keyed on the secret\'s name alone)', async () => {
    const k1 = fresh(); const k2 = fresh()
    process.env[AI] = k1
    const before = await encryptAiKey('sk-ant-before-rotation') // version 1's key is now cached
    process.env[`${AI}_V2`] = k2
    const after = await encryptAiKey('sk-ant-after-rotation')
    expect(after.startsWith('v2.')).toBe(true)
    // The proof is the format's own reading under version 2's key: a row labelled v2. but
    // sealed with the cached version-1 key would open here in the module and nowhere else.
    expect(formatOpen(after.slice(3), k2)).toBe('sk-ant-after-rotation')
    expect(() => formatOpen(after.slice(3), k1)).toThrow()
    expect(await decryptAiKey(after)).toBe('sk-ant-after-rotation')
    expect(await decryptAiKey(before)).toBe('sk-ant-before-rotation')
  })
  it('the same for the bucket secret', async () => {
    const k1 = fresh(); const k2 = fresh()
    process.env[ST] = k1
    await encryptStorageSecret('bucket-before-rotation')
    process.env[`${ST}_V2`] = k2
    const after = await encryptStorageSecret('bucket-after-rotation')
    expect(formatOpen(after.slice(3), k2)).toBe('bucket-after-rotation')
    expect(() => formatOpen(after.slice(3), k1)).toThrow()
  })
  it('another value under the SAME name is another key at once: the old row stops opening, the new one opens', async () => {
    const first = fresh(); const second = fresh()
    process.env[AI] = first
    const sealed = await encryptAiKey('sk-ant-first-value')
    expect(await decryptAiKey(sealed)).toBe('sk-ant-first-value') // cached
    process.env[AI] = second
    await expect(decryptAiKey(sealed)).rejects.toThrow()
    const again = await encryptAiKey('sk-ant-second-value')
    expect(formatOpen(again, second)).toBe('sk-ant-second-value')
    // And back: the first value's row opens again, because the value is what is compared.
    process.env[AI] = first
    expect(await decryptAiKey(sealed)).toBe('sk-ant-first-value')
  })
  it('the ticket master too: another value in the environment is another key', async () => {
    const first = fresh(); const second = fresh()
    const ws = '66666666-6666-4666-8666-666666666666'
    denoEnv({ [GW]: first })
    const sealed = await sealSigningKey('pkcs8-first', ws, 'k1')
    expect(await openSigningKey(sealed, ws, 'k1')).toBe('pkcs8-first')
    denoEnv({ [GW]: second })
    await expect(openSigningKey(sealed, ws, 'k1')).rejects.toThrow()
    expect(formatOpen(await sealSigningKey('pkcs8-second', ws, 'k1'), second, gwAad(ws, 'k1'))).toBe('pkcs8-second')
  })
  it('a secret taken away is gone though its key was cached', async () => {
    process.env[AI] = fresh()
    const sealed = await encryptAiKey('sk-ant-throwaway')
    delete process.env[AI]
    expect(aiKeyCryptoConfigured()).toBe(false)
    await expect(encryptAiKey('x')).rejects.toBeInstanceOf(AiKeyCryptoUnavailable)
    await expect(decryptAiKey(sealed)).rejects.toBeInstanceOf(AiKeyCryptoUnavailable)
  })
})

describe('a failure is never cached', () => {
  it('a malformed secret fails every time, and the corrected one works at once', async () => {
    process.env[AI] = Buffer.alloc(8).toString('base64')
    await expect(encryptAiKey('x')).rejects.toThrow(/exactly 32 bytes/)
    await expect(encryptAiKey('x')).rejects.toThrow(/exactly 32 bytes/)
    const good = fresh()
    process.env[AI] = good
    expect(formatOpen(await encryptAiKey('sk-ant-throwaway'), good)).toBe('sk-ant-throwaway')
  })
  it('an import that throws once is tried again on the next call', async () => {
    process.env[ST] = fresh()
    const real = globalThis.crypto.subtle.importKey.bind(globalThis.crypto.subtle)
    const spy = vi.spyOn(globalThis.crypto.subtle, 'importKey')
      .mockRejectedValueOnce(new Error('the import failed this once'))
      .mockImplementation((...args) => real(...args))
    await expect(encryptStorageSecret('x')).rejects.toThrow('the import failed this once')
    const sealed = await encryptStorageSecret('bucket-throwaway')
    expect(await decryptStorageSecret(sealed)).toBe('bucket-throwaway')
    expect(spy).toHaveBeenCalledTimes(2) // the failed one, then the one that is kept
  })
})
