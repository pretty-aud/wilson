// =============================================================================
// storagePresignBoundary.test.js — Session 37.
//
// The storage-presign authorisation boundary's PURE parts, imported across
// the Deno/Node line (the storageGcReserved.test.js arrangement), plus the
// text pins that keep the Edge functions, the migrations and the client from
// drifting apart. Six features have shipped in this repo with no caller —
// the wiring section is what notices a seventh.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkRowShapedPath } from '../../../../supabase/functions/_shared/presignPath.ts'
import { MONEY_SEGMENTS, isMoneySegment } from '../../../../supabase/functions/_shared/moneySegments.ts'
import { storageKeyHint } from '../../../../supabase/functions/_shared/storageSecretCrypto.ts'
import { RATES_SEGMENT } from '../../../../supabase/functions/_shared/reservedObjects.ts'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const read = (...p) => readFileSync(join(REPO_ROOT, ...p), 'utf8')

const PID = 'aaaa1111-0000-0000-0000-000000000001'

describe('checkRowShapedPath — the presign path gate', () => {
  it('accepts exactly the shape uploadFile writes', () => {
    const r = checkRowShapedPath(`projects/${PID}/assets/a1/1754612345678-dailies.mov`)
    expect(r).toEqual({ ok: true, projectId: PID })
  })

  it('accepts the depth-3 manifest shape (a GET target)', () => {
    expect(checkRowShapedPath(`projects/${PID}/PROJECT.json`).ok).toBe(true)
  })

  it.each([
    ['INVOICES', `projects/${PID}/INVOICES/x/1-invoice.pdf`],
    ['FINANCE', `projects/${PID}/FINANCE/RATES.json`],
    ['lowercase invoices (0039: the gate is case-folded)', `projects/${PID}/invoices/x/1-invoice.pdf`],
    ['mixed-case Finance', `projects/${PID}/Finance/RATES.json`],
  ])('refuses a money-segment path: %s', (_label, path) => {
    const r = checkRowShapedPath(path)
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/money-gated files never leave Supabase/)
  })

  it.each([
    ['no path', ''],
    ['not under projects/', `assets/${PID}/x.mov`],
    ['a non-uuid project segment', 'projects/not-a-uuid/assets/a/f.mov'],
    ['too shallow', `projects/${PID}`],
    ['a dot segment', `projects/${PID}/assets/../FINANCE/RATES.json`],
    ['an empty segment (doubled slash)', `projects/${PID}//assets/f.mov`],
    ['a leading slash', `/projects/${PID}/assets/a/f.mov`],
    ['a trailing slash', `projects/${PID}/assets/a/f.mov/`],
    ['characters the sanitiser never writes', `projects/${PID}/assets/a/f mov?.mov`],
    ['a backslash', `projects/${PID}\\assets\\a\\f.mov`],
  ])('refuses %s', (_label, path) => {
    expect(checkRowShapedPath(path).ok).toBe(false)
  })

  it('refuses an over-long path', () => {
    expect(checkRowShapedPath(`projects/${PID}/assets/a/${'x'.repeat(1100)}`).ok).toBe(false)
  })

  // 🚨 THE TWO GATES MUST AGREE, and this is the pair that did not. The shape
  // gate accepts a doubled dot inside a segment (uploadFile's sanitiser
  // preserves dots, so `render..v2.mov` is a name the product itself writes);
  // the signer used to refuse the same key with a substring test, making that
  // file permanently untransferable on this provider alone. Both sides are
  // now segment-wise — pinned here AND in s3Presign.test.js, because a fix to
  // only one side leaves the same class of mismatch.
  it('accepts a doubled dot inside a segment, as the signer now does', () => {
    expect(checkRowShapedPath(`projects/${PID}/assets/a1/1754612345678-render..v2.mov`).ok).toBe(true)
  })
})

describe('the money vocabulary has ONE definition (0042), and the copies agree', () => {
  it('matches the segments in 0042\'s SQL text, cross-copy', () => {
    const sql = read('supabase', 'migrations', '0042_money_segments_and_manifest_rewrite.sql')
    const m = sql.match(/upper\(seg\) IN \(([^)]*)\)/)
    expect(m, 'rabbit_money_segment vocabulary not found in 0042').toBeTruthy()
    const sqlSegments = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort()
    expect(sqlSegments).toEqual([...MONEY_SEGMENTS].sort())
  })

  it('matches the literal strings, so two identical wrong copies still fail', () => {
    expect([...MONEY_SEGMENTS].sort()).toEqual(['FINANCE', 'INVOICES'])
  })

  it('agrees with reservedObjects\' RATES_SEGMENT', () => {
    expect(MONEY_SEGMENTS).toContain(RATES_SEGMENT)
  })

  it('is case-folded, because rabbit_money_segment is upper()-folded', () => {
    expect(isMoneySegment('invoices')).toBe(true)
    expect(isMoneySegment('Finance')).toBe(true)
    expect(isMoneySegment('assets')).toBe(false)
    expect(isMoneySegment('')).toBe(false)
    expect(isMoneySegment(null)).toBe(false)
  })
})

describe('storageSecretCrypto — the 0028 twin', () => {
  it('hints exactly like aiKeyCrypto: last four, starred when too short', () => {
    expect(storageKeyHint('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).toBe('EKEY')
    expect(storageKeyHint('abc')).toBe('***')
  })

  it('uses its OWN master key env, so the two credential domains rotate independently', () => {
    const src = read('supabase', 'functions', '_shared', 'storageSecretCrypto.ts')
    expect(src).toContain("const SECRET_ENV = 'WILSON_STORAGE_KEY_SECRET'")
    const ai = read('supabase', 'functions', '_shared', 'aiKeyCrypto.ts')
    expect(ai).toContain("const SECRET_ENV = 'WILSON_AI_KEY_SECRET'")
  })
})

describe('the wiring is real — every link in the presign chain has a caller', () => {
  it('storage-presign gates on checkRowShapedPath and the strict === true predicate', () => {
    const fn = read('supabase', 'functions', 'storage-presign', 'index.ts')
    expect(fn).toContain('checkRowShapedPath(body.path)')
    expect(fn).toContain("op === 'get' || op === 'head'")
    expect(fn).toContain("'can_presign_project_read'")
    expect(fn).toContain("'can_presign_project_write'")
    expect(fn).toContain('allowed !== true')
    // The prefix is applied server-side, from config — never accepted from
    // the client (0051: storage_path stays row-shaped).
    expect(fn).toContain("cfg.prefix ? `${cfg.prefix}/${body.path}`")
    // A PUT needs the ACTIVE choice; reads deliberately drop the mode check
    // (resolve-from-the-row — a switched workspace must not orphan bodies).
    expect(fn).toContain("op === 'put' && ws.mode !== 'byos'")
    // 🚨 The op allowlist must be an ARRAY, never `op in METHOD`: `in` walks
    // the prototype chain, so 'constructor' and '__proto__' satisfied a
    // four-value allowlist, ran the whole authorisation path, decrypted the
    // bucket secret, and failed at the signer as a 500 (S37 review).
    expect(fn).toContain('OPS as readonly string[]).includes(op)')
    // ⚠️ Asserted against the GUARD, not the bare phrase: the comment above
    // the fix explains the trap by naming it, so `not.toContain('op in
    // METHOD')` failed on this file's own prose. That is the 0038 shape
    // exactly — an assertion a COMMENT can satisfy — appearing here in a
    // test written to prevent it. Pin the executable form.
    expect(fn).not.toContain('if (!(op in METHOD))')
  })

  it('the predicates the function calls are the ones 0051 creates, with grants', () => {
    const sql = read('supabase', 'migrations', '0051_s3_storage_provider.sql')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.can_presign_project_write')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.can_presign_project_read')
    expect(sql).toContain('SECURITY INVOKER')
    expect(sql).toMatch(/GRANT {2}EXECUTE ON FUNCTION public\.can_presign_project_write\(UUID\) TO authenticated/)
    // COALESCE is load-bearing: NULL fails OPEN in an IF (S33).
    expect(sql.match(/COALESCE\(\(/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('storage-secret encrypts, hints, and never echoes the plaintext', () => {
    const fn = read('supabase', 'functions', 'storage-secret', 'index.ts')
    expect(fn).toContain('encryptStorageSecret(secret)')
    expect(fn).toContain('storageKeyHint(secret)')
    expect(fn).toContain("onConflict: 'workspace_id'")
    // The probe's two halves.
    expect(fn).toContain("probeKey(cfg.prefix, 'server')")
    expect(fn).toContain("probeKey(cfg.prefix, 'client')")
    expect(fn).toContain('clientProbe')
  })

  it('the client bindings call the deployed names, and both are in config.toml', () => {
    const api = read('src', 'cloud', 'storageApi.js')
    expect(api).toContain("callStorageFn('storage-presign'")
    expect(api).toContain("callStorageFn('storage-secret'")
    const toml = read('supabase', 'config.toml')
    expect(toml).toContain('[functions.storage-presign]')
    expect(toml).toContain('[functions.storage-secret]')
  })

  it('storage-gc drains s3 queue rows by signed DELETE, config resolved at drain time', () => {
    const fn = read('supabase', 'functions', 'storage-gc', 'index.ts')
    expect(fn).toContain(".provider === 's3'")
    expect(fn).toContain('presignS3Request')
    expect(fn).toContain('queue_s3_drained')
    // The queue read must actually SELECT the column the branch reads.
    expect(fn).toContain("select('id, bucket_id, object_path, provider')")
  })

  it('0051 widens the enqueue trigger by TEXT comparison (the same-transaction enum rule)', () => {
    const sql = read('supabase', 'migrations', '0051_s3_storage_provider.sql')
    expect(sql).toContain("WHEN (OLD.storage_provider::text IN ('supabase', 's3'))")
    expect(sql).toContain("OLD.storage_provider::text = 's3' THEN 'byo-s3'")
  })

  it('teardown states what it leaves: byo_bodies_left rides the certificate', () => {
    const fn = read('supabase', 'functions', 'operator-workspaces', 'index.ts')
    expect(fn).toContain('byo_bodies_left')
    // BOTH sources — a purged-but-undrained body has no files row and is
    // exactly what a failed drain left in the customer's bucket.
    expect(fn).toContain("eq('storage_provider', 's3')")
    expect(fn).toContain("eq('provider', 's3')")
    // And NULL on a failed count, never 0: after the CASCADE nothing can
    // re-derive it, so "nothing of yours remains" must not rest on a failed
    // query (S37 review).
    expect(fn).toContain('let byoLeft: number | null = null')
    expect(fn).toContain('!liveRes.error && !queuedRes.error')
  })

  it('the s3 GC drain treats 404 as a failure, never a certified disposal', () => {
    const fn = read('supabase', 'functions', 'storage-gc', 'index.ts')
    // A missing KEY is 204; a 404 is the BUCKET failing to resolve. Counting
    // it as 'deleted' would certify a disposal that never happened, for the
    // whole batch (S37 review).
    expect(fn).not.toContain('res.ok || res.status === 404')
    expect(fn).toContain('the bucket itself did not resolve (404)')
  })

  it('the endpoint host-only rule exists in all three layers', () => {
    // The signer, the database, and the field-side validator. A rule in one
    // layer only is how a "configured" row that resolves nowhere ships.
    expect(read('supabase', 'functions', '_shared', 's3Presign.ts')).toContain('host only')
    expect(read('supabase', 'migrations', '0052_s3_endpoint_host_only.sql'))
      .toContain("!~ '^https://[^/?#]+[/?#]'")
    expect(read('src', 'components', 'AdminTerminal', 'StorageSection.jsx'))
      .toContain('must be a host only')
  })

  it('0052 replaces the constraint by explicit DROP — a wrapped re-ADD no-ops', () => {
    const sql = read('supabase', 'migrations', '0052_s3_endpoint_host_only.sql')
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS workspace_storage_s3_config_chk')
    // ⚠️ Same lesson as the op-allowlist probe above: the header EXPLAINS why
    // a wrapped ADD would no-op, so a bare not.toContain matched the prose.
    // Strip comment lines first, then assert on the statements.
    const statements = sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')
    expect(statements).not.toContain('EXCEPTION WHEN duplicate_object')
  })

  it('the bucket secret can be REMOVED — storageSecretClear has a live caller', () => {
    // 🚨 The 8th no-caller feature, caught before it shipped: the export, the
    // Edge branch and WIL-3006 all existed with nothing calling any of them,
    // so a tenant credential could be stored and never removed except by a
    // service-role query.
    const section = read('src', 'components', 'AdminTerminal', 'StorageSection.jsx')
    expect(section).toContain('storageSecretClear')
    expect(section).toContain('async function clearSecret()')
    expect(section).toContain('Remove secret')
  })

  it('a failed secret-status read does not latch "not stored"', () => {
    const section = read('src', 'components', 'AdminTerminal', 'StorageSection.jsx')
    // The ref must be set only on success, or one tripped rate limit makes
    // the card assert "Not stored yet." over a stored secret all session.
    expect(section).toContain('if (!res.ok) { setSecretStatusError(true); return }')
    expect(section).toContain('Could not check whether a secret is stored')
  })

  it('the two upload surfaces RENDER a refusal instead of logging it', () => {
    // S37 gave uploadFile three new guaranteed-throw paths; both of these
    // catches used to end their journey in the devtools console.
    for (const view of ['BudgetView.jsx', 'ProjectSummaryView.jsx']) {
      const src = read('src', 'tools', 'rabbit_v0.1.0', 'views', view)
      expect(src, view).toContain('setUploadError(err?.message')
      expect(src, view).toContain('{uploadError}')
    }
  })
})
