// =============================================================================
// keyVersions.test.js — P8 (TPN-ENC-015, night 5, 2026-10-28).
//
// The versioned master secrets, proved across the Deno/Node line: the names
// (the unsuffixed one is version 1, _V2 to _V9 the rest), the current version
// (the highest present), the envelope prefix (`v<n>.` for n ≥ 2, bare for 1),
// and the two crypto modules sealing under the current version and opening
// under the version the envelope names — the re-seal's round trip included.
//
// Every secret here is a throwaway made in the test (32 random bytes), set in
// this process's environment for the test's own duration, never printed.
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  secretNameFor, keyVersionsPresent, currentKeyVersion, envelopeVersion, wrapEnvelope, readEnv, MAX_KEY_VERSION,
} from '../../supabase/functions/_shared/keyVersions.ts'
import {
  encryptAiKey, decryptAiKey, aiKeyCryptoConfigured, aiKeyCurrentVersion, AiKeyCryptoUnavailable,
} from '../../supabase/functions/_shared/aiKeyCrypto.ts'
import {
  encryptStorageSecret, decryptStorageSecret, storageSecretCryptoConfigured, storageSecretCurrentVersion,
} from '../../supabase/functions/_shared/storageSecretCrypto.ts'

const AI = 'WILSON_AI_KEY_SECRET'
const ST = 'WILSON_STORAGE_KEY_SECRET'
const NAMES = [AI, `${AI}_V2`, `${AI}_V3`, ST, `${ST}_V2`]
const fresh = () => randomBytes(32).toString('base64')

afterEach(() => { for (const n of NAMES) delete process.env[n] })

describe('the names and the versions', () => {
  it('version 1 is the bare name; 2 to 9 carry _V<n>; anything else is refused', () => {
    expect(secretNameFor(AI, 1)).toBe(AI)
    expect(secretNameFor(AI, 2)).toBe(`${AI}_V2`)
    expect(secretNameFor(ST, 9)).toBe(`${ST}_V9`)
    expect(MAX_KEY_VERSION).toBe(9)
    for (const bad of [0, 10, 1.5, -1, NaN]) expect(() => secretNameFor(AI, bad)).toThrow(/out of range/)
  })
  it('the versions present are those with a value, ascending; the current one is the highest; none is null', () => {
    const env = { [AI]: 'a', [`${AI}_V3`]: 'c', [`${AI}_V2`]: '   ' }
    const get = (n) => env[n] ?? ''
    expect(keyVersionsPresent(AI, get)).toEqual([1, 3])
    expect(currentKeyVersion(AI, get)).toBe(3)
    expect(keyVersionsPresent(ST, get)).toEqual([])
    expect(currentKeyVersion(ST, get)).toBeNull()
    expect(currentKeyVersion(AI, (n) => (n === `${AI}_V2` ? 'only' : ''))).toBe(2)
  })
  it('readEnv reads this process\'s environment off Deno, and an unset name as empty', () => {
    process.env[`${AI}_V2`] = 'x'
    expect(readEnv(`${AI}_V2`)).toBe('x')
    expect(readEnv('WILSON_NO_SUCH_NAME_P8')).toBe('')
  })
  it('an envelope names its version: v<n>. for 2 to 9, else 1; v1. and v10. are no prefix', () => {
    expect(envelopeVersion('AAAA')).toEqual({ version: 1, body: 'AAAA' })
    expect(envelopeVersion('v2.AAAA')).toEqual({ version: 2, body: 'AAAA' })
    expect(envelopeVersion('v9.x')).toEqual({ version: 9, body: 'x' })
    expect(envelopeVersion('v1.AAAA')).toEqual({ version: 1, body: 'v1.AAAA' })
    expect(envelopeVersion('v10.AAAA')).toEqual({ version: 1, body: 'v10.AAAA' })
    expect(wrapEnvelope('AAAA', 1)).toBe('AAAA')
    expect(wrapEnvelope('AAAA', 2)).toBe('v2.AAAA')
    expect(() => wrapEnvelope('AAAA', 10)).toThrow(/out of range/)
  })
})

describe('aiKeyCrypto under versions', () => {
  it('no secret: not configured, no current version, a seal refused by name; a bare envelope needs version 1', async () => {
    expect(aiKeyCryptoConfigured()).toBe(false)
    expect(aiKeyCurrentVersion()).toBeNull()
    await expect(encryptAiKey('sk-ant-test')).rejects.toBeInstanceOf(AiKeyCryptoUnavailable)
    await expect(encryptAiKey('sk-ant-test')).rejects.toThrow('WILSON_AI_KEY_SECRET is not configured')
    await expect(decryptAiKey('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).rejects.toThrow('WILSON_AI_KEY_SECRET is not configured')
  })
  it('version 1 alone seals a bare envelope (today\'s format) and opens it', async () => {
    process.env[AI] = fresh()
    expect(aiKeyCryptoConfigured()).toBe(true)
    expect(aiKeyCurrentVersion()).toBe(1)
    const sealed = await encryptAiKey('sk-ant-throwaway-1')
    expect(sealed).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(envelopeVersion(sealed).version).toBe(1)
    expect(await decryptAiKey(sealed)).toBe('sk-ant-throwaway-1')
    expect(await encryptAiKey('sk-ant-throwaway-1')).not.toBe(sealed) // a fresh IV each time
  })
  it('a second version seals new rows under v2. and still opens version-1 rows; the re-seal round trip; then version 1 unset', async () => {
    process.env[AI] = fresh()
    const v1 = await encryptAiKey('sk-ant-throwaway-2')
    process.env[`${AI}_V2`] = fresh()
    expect(aiKeyCurrentVersion()).toBe(2)
    const v2 = await encryptAiKey('sk-ant-throwaway-3')
    expect(v2.startsWith('v2.')).toBe(true)
    expect(await decryptAiKey(v2)).toBe('sk-ant-throwaway-3')
    expect(await decryptAiKey(v1)).toBe('sk-ant-throwaway-2')
    // The re-seal as operator-ai-keys does it: open under the envelope's version, seal under the current one.
    const resealed = await encryptAiKey(await decryptAiKey(v1))
    expect(envelopeVersion(resealed).version).toBe(2)
    expect(await decryptAiKey(resealed)).toBe('sk-ant-throwaway-2')
    // Version 1 unset: its rows no longer open, by name; version 2's still do; the module stays configured.
    delete process.env[AI]
    expect(aiKeyCryptoConfigured()).toBe(true)
    expect(aiKeyCurrentVersion()).toBe(2)
    await expect(decryptAiKey(v1)).rejects.toThrow('WILSON_AI_KEY_SECRET is not configured')
    expect(await decryptAiKey(resealed)).toBe('sk-ant-throwaway-2')
  })
  it('a malformed version is refused by its own name; a wrong key, a tampered envelope and a truncated one are refused', async () => {
    process.env[AI] = fresh()
    process.env[`${AI}_V3`] = 'tooshort'
    await expect(encryptAiKey('x')).rejects.toThrow('WILSON_AI_KEY_SECRET_V3 must decode to exactly 32 bytes')
    delete process.env[`${AI}_V3`]
    process.env[`${AI}_V2`] = fresh()
    const sealed = await encryptAiKey('sk-ant-throwaway-4')
    process.env[`${AI}_V2`] = fresh() // another value under the same name: the row does not open
    await expect(decryptAiKey(sealed)).rejects.toThrow()
    process.env[`${AI}_V2`] = fresh()
    const again = await encryptAiKey('sk-ant-throwaway-5')
    const body = envelopeVersion(again).body
    const bytes = Buffer.from(body, 'base64')
    bytes[bytes.length - 2] ^= 1
    await expect(decryptAiKey(`v2.${bytes.toString('base64')}`)).rejects.toThrow()
    await expect(decryptAiKey('v2.AAAA')).rejects.toThrow(/truncated/)
  })
})

describe('storageSecretCrypto under versions (the twin)', () => {
  it('its own names, its own versions, the same envelopes', async () => {
    expect(storageSecretCryptoConfigured()).toBe(false)
    expect(storageSecretCurrentVersion()).toBeNull()
    await expect(encryptStorageSecret('bucket-throwaway')).rejects.toThrow('WILSON_STORAGE_KEY_SECRET is not configured')
    process.env[ST] = fresh()
    const v1 = await encryptStorageSecret('bucket-throwaway-1')
    expect(envelopeVersion(v1).version).toBe(1)
    process.env[`${ST}_V2`] = fresh()
    expect(storageSecretCurrentVersion()).toBe(2)
    const v2 = await encryptStorageSecret('bucket-throwaway-2')
    expect(v2.startsWith('v2.')).toBe(true)
    expect(await decryptStorageSecret(v1)).toBe('bucket-throwaway-1')
    expect(await decryptStorageSecret(v2)).toBe('bucket-throwaway-2')
    // The AI key's versions are not the bucket secret's: setting one says nothing about the other.
    process.env[`${AI}_V2`] = fresh()
    expect(aiKeyCurrentVersion()).toBe(2)
    delete process.env[`${AI}_V2`]
    expect(storageSecretCurrentVersion()).toBe(2)
  })
})
