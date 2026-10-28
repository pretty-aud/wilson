// =============================================================================
// aiFilesKey.test.js — P8 (night 5, 2026-10-28), TPN-AI-011.
//
// ai-files' key resolver (supabase/functions/_shared/aiFilesKey.ts), imported
// across the Deno/Node line and driven with fakes for the row read, the
// decrypt and the environment. Before P8 the resolver fell through to the
// platform key on ANY failure, silently: the first test is the one that
// fails on that shape (a company's key that will not open uploaded the file
// under the platform key, with only key_source 'platform' to say so).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveUploadKey, NOT_SENT } from '../../supabase/functions/_shared/aiFilesKey.ts'

const REPO = join(__dirname, '..', '..')
const read = (...p) => readFileSync(join(REPO, ...p), 'utf8')

const row = (over = {}) => async () => ({ data: { key_ciphertext: 'c1ph3r', key_version: 1, ...over }, error: null })
const noRow = async () => ({ data: null, error: null })
const opens = async () => 'sk-ant-company'
const refuses = async () => { throw new Error('The operation failed for an operation-specific reason') }
const configured = () => true

describe('resolveUploadKey — fail closed when the company\'s own key will not open', () => {
  it('🚨 a company row that will not open is a 500 secret_unusable with a sentence, and the platform key is NOT used', async () => {
    const r = await resolveUploadKey({ readRow: row(), decrypt: refuses, cryptoConfigured: configured, platformKey: 'sk-ant-platform' })
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ error: 'secret_unusable', status: 500 })
    expect(r.detail).toMatch(/the company's own AI key cannot be opened \(The operation failed/)
    expect(r.detail).toContain(NOT_SENT)
    expect(JSON.stringify(r)).not.toContain('sk-ant')
  })
  it('a row that opens to nothing is the same refusal', async () => {
    const r = await resolveUploadKey({ readRow: row(), decrypt: async () => '', cryptoConfigured: configured, platformKey: 'sk-ant-platform' })
    expect(r).toMatchObject({ ok: false, error: 'secret_unusable', status: 500 })
  })
  it('🚨 a row that could not be read is a 503 key_read_failed — the file goes nowhere, the caller retries', async () => {
    const errs = async () => ({ data: null, error: { message: 'connection reset' } })
    expect(await resolveUploadKey({ readRow: errs, decrypt: opens, cryptoConfigured: configured, platformKey: 'sk-ant-platform' })).toMatchObject({ ok: false, error: 'key_read_failed', status: 503 })
    const throws = async () => { throw new Error('fetch failed') }
    expect(await resolveUploadKey({ readRow: throws, decrypt: opens, cryptoConfigured: configured, platformKey: 'sk-ant-platform' })).toMatchObject({ ok: false, error: 'key_read_failed', status: 503 })
  })
  it('🚨 a row present with the crypto secret unset is a 503 crypto_unavailable, never the platform key', async () => {
    const r = await resolveUploadKey({ readRow: row(), decrypt: opens, cryptoConfigured: () => false, platformKey: 'sk-ant-platform' })
    expect(r).toMatchObject({ ok: false, error: 'crypto_unavailable', status: 503 })
    expect(r.detail).toContain('WILSON_AI_KEY_SECRET')
  })
  it('CONTROL: a row that opens is the company\'s key, with the row\'s key_version handed to the decrypt', async () => {
    const seen = []
    const decrypt = async (c, v) => { seen.push([c, v]); return 'sk-ant-company' }
    expect(await resolveUploadKey({ readRow: row({ key_version: 2 }), decrypt, cryptoConfigured: configured, platformKey: 'sk-ant-platform' })).toEqual({ ok: true, key: 'sk-ant-company', source: 'workspace' })
    expect(seen).toEqual([['c1ph3r', 2]])
  })
  it('CONTROL: no company row is the platform key, as before; no key at all is 501 ai_not_configured (ai-proxy\'s precedent)', async () => {
    expect(await resolveUploadKey({ readRow: noRow, decrypt: opens, cryptoConfigured: configured, platformKey: 'sk-ant-platform' })).toEqual({ ok: true, key: 'sk-ant-platform', source: 'platform' })
    expect(await resolveUploadKey({ readRow: row({ key_ciphertext: null }), decrypt: opens, cryptoConfigured: configured, platformKey: 'sk-ant-platform' })).toEqual({ ok: true, key: 'sk-ant-platform', source: 'platform' })
    expect(await resolveUploadKey({ readRow: noRow, decrypt: opens, cryptoConfigured: () => false, platformKey: '' })).toMatchObject({ ok: false, error: 'ai_not_configured', status: 501 })
  })
})

describe('the wiring is real: ai-files resolves through it and refuses with its code, sentence and status', () => {
  const fn = read('supabase', 'functions', 'ai-files', 'index.ts')
  const proxy = read('supabase', 'functions', 'ai-proxy', 'index.ts')
  it('the upload refuses on `!resolved.ok`, logs the stage, and the fall-through is gone', () => {
    expect(fn).toContain("import { resolveUploadKey, type ResolvedUploadKey } from '../_shared/aiFilesKey.ts'")
    expect(fn).toContain('return reply({ error: resolved.error, detail: resolved.detail }, resolved.status)')
    expect(fn).toContain("await logUpload(admin, workspaceId, callerId, false, { stage: 'key', error: resolved.error })")
    expect(fn).not.toContain('/* fall through to platform key */')
    expect(fn).not.toContain('A tenant key is a billing preference')
    // The delete path's own refusal to fall back stands as it was.
    expect(fn).toContain('async function keyForSource(')
  })
  it('ai-proxy is untouched: its deliberate fail-soft stays its own (TPN-AI-005\'s class, not this finding\'s)', () => {
    expect(proxy).toContain('/* fall through to platform key */')
  })
})
