// =============================================================================
// storagePresignBoundary.test.js — Session 37.
//
// The storage-presign authorisation boundary's PURE parts, imported across
// the Deno/Node line (the storageGcReserved.test.js arrangement), plus the
// text pins that keep the Edge functions, the migrations and the client from
// drifting apart. Six features have shipped in this repo with no caller —
// the wiring section is what notices a seventh.
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { checkRowShapedPath } from '../../../../supabase/functions/_shared/presignPath.ts'
import { MONEY_SEGMENTS, isMoneySegment } from '../../../../supabase/functions/_shared/moneySegments.ts'
import { storageKeyHint } from '../../../../supabase/functions/_shared/storageSecretCrypto.ts'
import { RATES_SEGMENT } from '../../../../supabase/functions/_shared/reservedObjects.ts'
import {
  handleReadUrls, classifyOwned, folderOf, streams, READ_URLS_MAX_KEYS, READ_URLS_MAX_PROJECTS,
  READ_URLS_MAX_BODY_BYTES, READ_URLS_MAX_FOLDERS, READ_URLS_MIN_SEGMENTS, STREAMABLE_EXTENSIONS,
  THUMBNAIL_EXPIRES, READ_ONCE_EXPIRES, STREAM_EXPIRES,
} from '../../../../supabase/functions/_shared/readUrls.ts'
import { S3_READ_BATCH, S3_READ_FOLDERS } from './s3Provider'
import { VIDEO_EXTENSIONS } from './videoThumbnails.js'
import { AUDIO_EXTENSIONS, previewKindFor } from '../../../components/Resources/filePreview.js'
import { MONEY_SEGMENTS as CLIENT_MONEY_SEGMENTS, isMoneyKey } from './index.js'

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

  // 🚨 S44: THE THUMBNAIL KEY SHAPE, PROVEN RATHER THAN ASSERTED IN PROSE.
  // Since S44 an s3 workspace's preview is written beside its source at
  // `<body key>.jpg` — a final segment with TWO dots — through this very gate.
  // `storage/thumbnails.js` claims in a comment that SEGMENT_RE admits it; the
  // S44 brief said to verify that by test, not by reading the sentence, and its
  // own review found no such test existed. This is that test.
  it('🚨 accepts a thumbnail key: the body key plus .jpg, two dots in the last segment', () => {
    const body = `projects/${PID}/assets/a1/1754612345678-plate.png`
    const thumb = `${body}.jpg`
    expect(checkRowShapedPath(body)).toEqual({ ok: true, projectId: PID })
    expect(checkRowShapedPath(thumb)).toEqual({ ok: true, projectId: PID })
  })

  it('🚨 a thumbnail key keeps its source\'s THIRD segment — the money gate reads it', () => {
    // Appending '.jpg' must shift no segment: the money gate is
    // (storage.foldername(name))[3] / split_part(path,'/',3). A `thumbs/` level
    // or any rename would move the derived image out of the gate it inherits.
    const body = `projects/${PID}/INVOICES/l1/9-invoice.pdf`
    const thumb = `${body}.jpg`
    expect(thumb.split('/').length).toBe(body.split('/').length)
    expect(thumb.split('/')[2]).toBe(body.split('/')[2])
    // And so an INVOICES thumbnail is refused by this gate for the same reason
    // its source is: money never leaves Supabase, so there is no money presign
    // to authorise on either.
    expect(checkRowShapedPath(thumb).ok).toBe(false)
    expect(checkRowShapedPath(thumb).detail).toMatch(/money-gated files never leave Supabase/)
  })

  it.each([
    ['INVOICES', `projects/${PID}/INVOICES/x/1-invoice.pdf`],
    ['FINANCE', `projects/${PID}/FINANCE/RATES.json`],
    ['lowercase invoices (0039: the gate is case-folded)', `projects/${PID}/invoices/x/1-invoice.pdf`],
    ['mixed-case Finance', `projects/${PID}/Finance/RATES.json`],
    // 0088 (S4b): LEGAL is a locked folder, so a Legal body never leaves
    // Supabase either — refused here in any case, thumbnail included.
    ['LEGAL', `projects/${PID}/LEGAL/x/1-contract.pdf`],
    ['lowercase legal', `projects/${PID}/legal/x/1-contract.pdf`],
    ['a Legal thumbnail', `projects/${PID}/Legal/x/1-contract.pdf.jpg`],
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

describe('the money vocabulary has ONE definition (0042, widened by 0088), and the copies agree', () => {
  // The LATEST migration that (re)defines the function is the live body —
  // 0088 since S4b. Reading 0042 alone would keep passing after a later
  // migration changed the list, which is the drift this test exists to catch.
  function latestDefinition() {
    const files = readdirSync(join(REPO_ROOT, 'supabase', 'migrations'))
      .filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()
    let last = null
    for (const f of files) {
      const sql = read('supabase', 'migrations', f)
      if (sql.includes('CREATE OR REPLACE FUNCTION public.rabbit_money_segment(')) last = { f, sql }
    }
    return last
  }

  it('matches the segments in the latest migration that defines it, cross-copy', () => {
    const def = latestDefinition()
    expect(def?.f).toBe('0088_legal_files.sql')
    const body = def.sql.slice(def.sql.indexOf('CREATE OR REPLACE FUNCTION public.rabbit_money_segment('))
    const m = body.match(/upper\(seg\) IN \(([^)]*)\)/)
    expect(m, 'rabbit_money_segment vocabulary not found').toBeTruthy()
    const sqlSegments = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort()
    expect(sqlSegments).toEqual([...MONEY_SEGMENTS].sort())
  })

  it('matches the literal strings, so two identical wrong copies still fail', () => {
    expect([...MONEY_SEGMENTS].sort()).toEqual(['FINANCE', 'INVOICES', 'LEGAL'])
  })

  it('agrees with reservedObjects\' RATES_SEGMENT', () => {
    expect(MONEY_SEGMENTS).toContain(RATES_SEGMENT)
  })

  it('is case-folded, because rabbit_money_segment is upper()-folded', () => {
    expect(isMoneySegment('invoices')).toBe(true)
    expect(isMoneySegment('Finance')).toBe(true)
    expect(isMoneySegment('legal')).toBe(true)
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
    // The queue read must actually SELECT the columns the branches read.
    // S44 added `kind`: it picks the restorability column, and omitted it every
    // thumbnail reads as a body and the drain deletes restorable previews while
    // certifying them disposed.
    expect(fn).toContain("select('id, bucket_id, object_path, provider, kind')")
  })

  it('🚨 S44: the presign rate limit is sized for TWO calls per uploaded image', () => {
    // Since S44 an s3 image upload costs two presigns — the body via
    // s3Provider.put, then the derived preview via putThumbnailTo — so the
    // ceiling was raised 120 -> 240 to keep meaning "120 FILES per minute".
    // Reverted to 120, a 100-image drag is refused from about file 60, on the
    // SECOND call of each pair: the bodies have already landed, so the user
    // sees a half-illustrated grid and a message about presign requests with
    // nothing connecting it to thumbnails. Nothing else would fail.
    const fn = read('supabase', 'functions', 'storage-presign', 'index.ts')
    expect(fn).toContain("envInt('STORAGE_PRESIGN_RPM', 240)")
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
    // 🚨 UNDRAINED ROWS ONLY. Queue rows are stamped, never deleted, so an
    // unfiltered count reports every already-destroyed object as still resident
    // — and a 'skipped' row is double-counted with the live-files half. A
    // certificate that OVER-reports is the same category of false statement as
    // one that under-reports. (S44 review.)
    expect(fn).toContain("in('status', ['pending', 'failed'])")
    // S44 widened this to FOUR counts: an s3 row now leaves a body AND a
    // preview in the customer's bucket, so bodies and thumbnails are counted
    // separately (byo_thumbnails_left). Any one failing must still yield NULL
    // for both — a half-populated pair is the same lie in smaller print.
    expect(fn).toContain('!liveRes.error && !liveThumbRes.error && !queuedRes.error && !queuedThumbRes.error')
    expect(fn).toContain('let byoThumbsLeft: number | null = null')
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
    // Post-overhaul S4a (E1): the project-level Add files left the Summary's
    // Control Panel for the Files tab (ProjectFilesExplorer), and the rule
    // went with it — the Summary no longer uploads at all.
    const surfaces = [
      ['src', 'tools', 'rabbit_v0.1.0', 'views', 'BudgetView.jsx'],
      ['src', 'components', 'Resources', 'ProjectFilesExplorer.jsx'],
    ]
    for (const parts of surfaces) {
      const src = read(...parts)
      const name = parts[parts.length - 1]
      expect(src, name).toContain('setUploadError(err?.message')
      expect(src, name).toContain('{uploadError}')
    }
    // Any call spelling (post-overhaul S4a review round 1, R1-TST-16: the
    // first cut read only `uploadFile?.(`, and `ctx.uploadFile(` passed).
    const CALLS_UPLOAD = /\buploadFile\s*(?:\?\.\s*)?\(/
    const summary = read('src', 'tools', 'rabbit_v0.1.0', 'views', 'ProjectSummaryView.jsx')
    expect(summary).not.toMatch(CALLS_UPLOAD)
    for (const call of ['uploadFile?.(f)', 'ctx.uploadFile(f)', 'await uploadFile (f)', 'x.uploadFile ?. (f)']) expect(call, call).toMatch(CALLS_UPLOAD)
    expect('const { uploadFile } = ctx').not.toMatch(CALLS_UPLOAD)
    // …and no mention at all in its CODE (round 2, R2-TST-09: an alias,
    // `const up = ctx.uploadFile; up(f)`, or `ctx['uploadFile'](f)` passed
    // the call's shape). A comment may still name it.
    const codeOf = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(codeOf(summary)).not.toContain('uploadFile')
    for (const planted of ["const up = ctx.uploadFile\nup(f)", "ctx['uploadFile'](f)"]) expect(codeOf(planted), planted).toContain('uploadFile')
    expect(codeOf('// the Files tab calls uploadFile now\nconst x = 1')).not.toContain('uploadFile')
  })
})

// =============================================================================
// P1 (night 4, 2026-10-28): storage-read-urls, the GET-only batch signer for
// an s3 workspace's thumbnails and previews (NETWORK_STORAGE_DESIGN.md §9.2).
// Its whole decision is _shared/readUrls.ts, imported here across the Deno
// line and driven with fakes for what touches the world: every refusal the
// design names, each with its failing control run once (the hand-off quotes
// them). No S3 workspace exists on any environment, so this IS the proof
// until Audrey's test bucket on the beta.
// =============================================================================

const PID2 = 'bbbb2222-0000-0000-0000-000000000002'
const PID3 = 'cccc3333-0000-0000-0000-000000000003'
const bodyKey = (leaf, pid = PID) => `projects/${pid}/assets/a1/1754612345678-${leaf}`
const thumbOf = (k) => `${k}.jpg`

let bodyReads = 0
function reqOf(payload, { method = 'POST', length } = {}) {
  const text = payload === undefined ? '' : (typeof payload === 'string' ? payload : JSON.stringify(payload))
  const declared = length !== undefined ? length : String(text.length)
  return {
    method,
    headers: { get: (n) => (n.toLowerCase() === 'content-length' ? declared : null) },
    json: async () => { bodyReads++; return JSON.parse(text) },
  }
}
// A row as the caller's own select returns it: in the project its path names.
const row = (k, thumb = null, project = k.split('/')[1]) => ({ project_id: project, storage_path: k, thumbnail_url: thumb })

// The world, faked and counted. `readable` lists the projects the caller may
// read; `rows` are the live s3 rows the caller's own select would see.
function world({ readable = [PID, PID2], rows = [], signer = 'ok', guard = 'ok', limited = false, rowsFail = false, signThrows = null } = {}) {
  const calls = { guard: 0, rate: 0, can: [], rows: [], load: 0, sign: [] }
  const deps = {
    guard: async () => {
      calls.guard++
      return guard === 'ok' ? { ok: true, ctx: { callerId: 'u1' } } : { ok: false, res: 'THE_GUARD_ANSWER' }
    },
    rateLimited: async () => { calls.rate++; return limited },
    canReadProject: async (_ctx, p) => {
      calls.can.push(p)
      if (readable === 'throws') throw new Error('rpc failed')
      if (readable === 'null') return null
      return readable.includes(p)
    },
    // Like the real read, scoped to one folder; unlike it, it does NOT
    // filter by project, so classifyOwned's own project check is exercised.
    ownedRows: async (_ctx, projectId, folder) => {
      calls.rows.push({ projectId, folder })
      if (rowsFail) throw new Error('select failed')
      return rows.filter((r) => String(r.storage_path).startsWith(`${folder}/`))
    },
    loadSigner: async () => {
      calls.load++
      if (signer !== 'ok') {
        return { ok: false, status: 409, body: { error: 'refused', detail: 'this workspace has no S3-compatible storage configured — an admin sets it in Admin Terminal → Storage' } }
      }
      return {
        ok: true,
        sign: async (key, seconds) => {
          calls.sign.push([key, seconds])
          if (signThrows) throw new Error(signThrows(key))
          return `https://bucket.example/${key}?X-Amz-Expires=${seconds}`
        },
      }
    },
  }
  return { deps, calls }
}

describe('storage-read-urls — what it signs, and for how long (P1)', () => {
  it('signs a live row\'s body and its thumbnail, in the order sent: a thumbnail for the hour, a body read once for 300 s', async () => {
    const a = bodyKey('plate.png')
    const b = bodyKey('dailies.mov')
    const { deps } = world({ rows: [row(a, thumbOf(a)), row(b)] })
    const out = await handleReadUrls(reqOf({ keys: [thumbOf(a), b, a] }), deps)
    expect(out.status).toBe(200)
    expect(Object.keys(out.body.urls)).toEqual([thumbOf(a), b, a])
    expect(out.body.expires).toEqual({ [thumbOf(a)]: THUMBNAIL_EXPIRES, [b]: READ_ONCE_EXPIRES, [a]: READ_ONCE_EXPIRES })
    expect([THUMBNAIL_EXPIRES, READ_ONCE_EXPIRES, STREAM_EXPIRES]).toEqual([3600, 300, 3600])
    expect(out.body.refused).toEqual({})
  })

  it('answers {urls, refused} keyed by the input string, both in the order the keys were sent', async () => {
    const ok1 = bodyKey('one.png')
    const ok2 = bodyKey('two.png')
    const { deps } = world({ rows: [row(ok1), row(ok2)] })
    const keys = [`projects/${PID}/INVOICES/x/1-a.pdf`, ok2, 'nope', bodyKey('gone.png'), ok1]
    const out = await handleReadUrls(reqOf({ keys }), deps)
    expect(Object.keys(out.body.urls)).toEqual([ok2, ok1])
    expect(Object.entries(out.body.refused)).toEqual([[keys[0], 'money'], ['nope', 'shape'], [keys[3], 'row']])
  })

  it.each([
    ['INVOICES', `projects/${PID}/INVOICES/x/1-invoice.pdf`],
    ['FINANCE', `projects/${PID}/FINANCE/RATES.json`],
    ['LEGAL', `projects/${PID}/LEGAL/x/1-contract.pdf`],
    ['lowercase legal', `projects/${PID}/legal/x/1-contract.pdf`],
    ['a Legal thumbnail', `projects/${PID}/Legal/x/1-contract.pdf.jpg`],
  ])('refuses a money key (%s) before any project or row is asked, and signs nothing', async (_label, key) => {
    const { deps, calls } = world({ rows: [row(key)] })
    const out = await handleReadUrls(reqOf({ keys: [key] }), deps)
    expect(out.body.refused).toEqual({ [key]: 'money' })
    expect(out.body.urls).toEqual({})
    expect([calls.can.length, calls.rows.length, calls.load, calls.sign.length]).toEqual([0, 0, 0, 0])
  })

  it.each([
    ['not under projects/', `assets/${PID}/x.png`],
    ['no project id', 'projects/not-a-uuid/assets/a1/x.png'],
    ['a dot segment', `projects/${PID}/assets/../x.png`],
    ['an empty segment', `projects/${PID}//x.png`],
    ['a character the uploader never writes', `projects/${PID}/assets/a1/x y.png`],
  ])('refuses a key outside projects/<uuid>/… (%s) as shape', async (_label, key) => {
    const { deps, calls } = world()
    const out = await handleReadUrls(reqOf({ keys: [key] }), deps)
    expect(out.body.refused).toEqual({ [key]: 'shape' })
    expect(calls.sign).toEqual([])
  })

  it.each([
    ['false', [PID]],
    ['null', 'null'],
    ['a thrown error', 'throws'],
  ])('refuses every key of a project the caller cannot read (the predicate answers %s)', async (_label, readable) => {
    const k1 = bodyKey('a.png', PID2)
    const k2 = thumbOf(bodyKey('b.png', PID2))
    const { deps, calls } = world({ readable, rows: [row(k1)] })
    const out = await handleReadUrls(reqOf({ keys: [k1, k2] }), deps)
    expect(out.body.refused).toEqual({ [k1]: 'project', [k2]: 'project' })
    expect(calls.sign).toEqual([])
  })

  it('asks can_presign_project_read ONCE per distinct project, however many keys', async () => {
    const keys = [bodyKey('a.png'), bodyKey('b.png'), bodyKey('c.png'), bodyKey('d.png', PID2), bodyKey('e.png', PID2)]
    const { deps, calls } = world({ rows: keys.map((k) => row(k)) })
    const out = await handleReadUrls(reqOf({ keys }), deps)
    expect(Object.keys(out.body.urls)).toEqual(keys)
    expect([...calls.can].sort()).toEqual([PID, PID2])
  })

  it('🚨 refuses a key no live row of the caller owns — a trashed file, a purged row, an object WILSON never wrote — as row', async () => {
    const trashed = bodyKey('trashed.mov')
    const { deps, calls } = world({ rows: [] })
    const out = await handleReadUrls(reqOf({ keys: [trashed, thumbOf(trashed)] }), deps)
    expect(out.body.refused).toEqual({ [trashed]: 'row', [thumbOf(trashed)]: 'row' })
    expect(calls.load).toBe(0)
    expect(calls.sign).toEqual([])
    // ONE read for the folder both keys sit in, carrying only ids.
    expect(calls.rows).toEqual([{ projectId: PID, folder: folderOf(trashed) }])
  })

  it('🚨 a thumbnail is only the key derived from its row\'s OWN body: a thumbnail_url set to something else signs nothing (it is client-writable)', async () => {
    const mine = bodyKey('plate.png')
    const elsewhere = bodyKey('somebody-elses.mov')
    const { deps, calls } = world({ rows: [row(mine, elsewhere)] })
    const out = await handleReadUrls(reqOf({ keys: [elsewhere, thumbOf(mine)] }), deps)
    expect(out.body.refused).toEqual({ [elsewhere]: 'row', [thumbOf(mine)]: 'row' })
    expect(calls.sign).toEqual([])
  })

  it('an inactive member gets the guard\'s answer, and nothing else runs', async () => {
    const { deps, calls } = world({ guard: 'inactive' })
    const out = await handleReadUrls(reqOf({ keys: [bodyKey('a.png')] }), deps)
    expect(out).toEqual({ res: 'THE_GUARD_ANSWER' })
    expect([calls.rate, calls.can.length, calls.rows.length, calls.load]).toEqual([0, 0, 0, 0])
  })

  it('a workspace not on s3 is the 409 with its sentence, and nothing is signed', async () => {
    const k = bodyKey('a.png')
    const { deps, calls } = world({ signer: 'not-s3', rows: [row(k)] })
    const out = await handleReadUrls(reqOf({ keys: [k] }), deps)
    expect(out.status).toBe(409)
    expect(out.body.detail).toMatch(/no S3-compatible storage configured/)
    expect(calls.sign).toEqual([])
  })

  it('stream: one body for the hour; a stream of two keys is refused', async () => {
    const k = bodyKey('cut.mov')
    const { deps } = world({ rows: [row(k), row(bodyKey('b.mov'))] })
    const one = await handleReadUrls(reqOf({ keys: [k], stream: true }), deps)
    expect(one.body.expires).toEqual({ [k]: STREAM_EXPIRES })
    const two = await handleReadUrls(reqOf({ keys: [k, bodyKey('b.mov')], stream: true }), deps)
    expect(two.status).toBe(400)
  })

  it('the bounds: 100 keys, two projects, 128 KB read by its length before parsing, POST only, JSON only', async () => {
    const { deps } = world()
    const many = Array.from({ length: READ_URLS_MAX_KEYS + 1 }, (_, i) => bodyKey(`f${i}.png`))
    expect((await handleReadUrls(reqOf({ keys: many }), deps)).status).toBe(400)
    expect((await handleReadUrls(reqOf({ keys: [] }), deps)).status).toBe(400)
    expect((await handleReadUrls(reqOf({ keys: [bodyKey('a'), bodyKey('b', PID2), bodyKey('c', PID3)] }), deps)).status).toBe(400)
    expect((await handleReadUrls(reqOf({ keys: [bodyKey('a')] }, { length: String(READ_URLS_MAX_BODY_BYTES + 1) }), deps)).status).toBe(413)
    expect((await handleReadUrls(reqOf({ keys: [bodyKey('a')] }, { length: null }), deps)).status).toBe(411)
    expect((await handleReadUrls(reqOf('not json'), deps)).status).toBe(400)
    expect((await handleReadUrls(reqOf({ keys: [bodyKey('a')] }, { method: 'GET' }), deps)).status).toBe(405)
    expect(await handleReadUrls(reqOf(undefined, { method: 'OPTIONS' }), deps)).toEqual({ preflight: true })
    expect([READ_URLS_MAX_KEYS, READ_URLS_MAX_PROJECTS, READ_URLS_MAX_BODY_BYTES]).toEqual([100, 2, 128 * 1024])
  })

  it('a limited caller is refused before the body is read', async () => {
    const { deps, calls } = world({ limited: true })
    const out = await handleReadUrls(reqOf({ keys: [bodyKey('a')] }), deps)
    expect(out.status).toBe(429)
    expect([calls.can.length, calls.rows.length]).toEqual([0, 0])
  })

  it('a row read that fails fails the call CLOSED: nothing is signed', async () => {
    const { deps, calls } = world({ rowsFail: true })
    const out = await handleReadUrls(reqOf({ keys: [bodyKey('a.png')] }), deps)
    expect(out.status).toBe(500)
    expect(calls.load).toBe(0)
  })

  it('a signer error that names the key is not echoed (a key carries a filename)', async () => {
    const k = bodyKey('Secret_Title_v3.mov')
    const { deps } = world({ rows: [row(k)], signThrows: (key) => `refusing to presign a non-canonical key: ${key}` })
    const out = await handleReadUrls(reqOf({ keys: [k] }), deps)
    expect(out.status).toBe(500)
    expect(JSON.stringify(out.body)).not.toContain('Secret_Title')
  })

  it('duplicates are signed once; the rows are read ONCE PER FOLDER, never by key', async () => {
    const keys = Array.from({ length: 45 }, (_, i) => bodyKey(`f${i}.png`))
    const shot = `projects/${PID}/scenes/sc1/sh1/1754612345678-board.png`
    const { deps, calls } = world({ rows: [...keys, shot].map((k) => row(k)) })
    const out = await handleReadUrls(reqOf({ keys: [...keys, keys[0], shot] }), deps)
    expect(Object.keys(out.body.urls)).toHaveLength(46)
    expect(calls.sign).toHaveLength(46)
    expect(calls.rows).toEqual([
      { projectId: PID, folder: `projects/${PID}/assets/a1` },
      { projectId: PID, folder: `projects/${PID}/scenes/sc1/sh1` },
    ])
    // What travels to the database names no file.
    for (const r of calls.rows) expect(r.folder).not.toMatch(/\.png/)
  })

  it('classifyOwned: a key that is a body and a thumbnail is a body (the shorter-lived)', () => {
    const k = bodyKey('a.png')
    const owned = classifyOwned([k, thumbOf(k)], [row(k, thumbOf(k)), row(thumbOf(k))])
    expect([...owned]).toEqual([[k, 'body'], [thumbOf(k), 'body']])
  })
})

describe('storage-read-urls — review round 1\'s corrections (P1)', () => {
  beforeEach(() => { bodyReads = 0 })

  it('🚨 a row vouches only for a key in ITS OWN project: a row in another project naming this key signs nothing', async () => {
    const k = bodyKey('trashed.mov')
    // A writer of PID2 made a row there whose storage_path is a PID key.
    const { deps, calls } = world({ rows: [row(k, thumbOf(k), PID2)] })
    const out = await handleReadUrls(reqOf({ keys: [k, thumbOf(k)] }), deps)
    expect(out.body.refused).toEqual({ [k]: 'row', [thumbOf(k)]: 'row' })
    expect(calls.sign).toEqual([])
  })

  it('🚨 the streaming hour is for what streams: a PDF or a still asked to stream is read once', async () => {
    const pdf = bodyKey('script.pdf')
    const still = bodyKey('plate.PNG')
    const clip = bodyKey('cut.MOV')
    const voice = bodyKey('voice.mp3')
    const { deps } = world({ rows: [row(pdf), row(still), row(clip), row(voice)] })
    for (const [k, want] of [[pdf, READ_ONCE_EXPIRES], [still, READ_ONCE_EXPIRES], [clip, STREAM_EXPIRES], [voice, STREAM_EXPIRES]]) {
      const out = await handleReadUrls(reqOf({ keys: [k], stream: true }), deps)
      expect(out.body.expires, k).toEqual({ [k]: want })
    }
  })

  it('the streaming list is the client\'s own: every video and audio extension it plays, and nothing it does not', () => {
    for (const ext of VIDEO_EXTENSIONS) expect(STREAMABLE_EXTENSIONS.has(ext.replace(/^\./, '')), ext).toBe(true)
    for (const ext of AUDIO_EXTENSIONS) expect(STREAMABLE_EXTENSIONS.has(ext), ext).toBe(true)
    for (const ext of STREAMABLE_EXTENSIONS) expect(['video', 'audio'], ext).toContain(previewKindFor({ name: `x.${ext}` }).kind)
    expect(streams(bodyKey('noextension'))).toBe(false)
  })

  it('a key shallower than an entity\'s folder is refused as shape (it would scope a row read to a whole project)', async () => {
    const shallow = `projects/${PID}/assets/1-x.png`
    const { deps, calls } = world({ rows: [row(shallow)] })
    const out = await handleReadUrls(reqOf({ keys: [shallow] }), deps)
    expect(out.body.refused).toEqual({ [shallow]: 'shape' })
    expect(calls.rows).toEqual([])
    expect(READ_URLS_MIN_SEGMENTS).toBe(5)
  })

  it('at most ten folders a call', async () => {
    const keys = Array.from({ length: READ_URLS_MAX_FOLDERS + 1 }, (_, i) => `projects/${PID}/assets/a${i}/1-x.png`)
    const { deps, calls } = world({ rows: keys.map((k) => row(k)) })
    expect((await handleReadUrls(reqOf({ keys }), deps)).status).toBe(400)
    expect(calls.rows).toEqual([])
    expect(READ_URLS_MAX_FOLDERS).toBe(10)
  })

  it('the body is never read before the guard, the limiter and the length say yes', async () => {
    for (const [opts, want] of [[{ guard: 'inactive' }, undefined], [{ limited: true }, 429]]) {
      const { deps } = world(opts)
      const out = await handleReadUrls(reqOf({ keys: [bodyKey('a.png')] }), deps)
      if (want) expect(out.status).toBe(want)
    }
    const { deps } = world()
    expect((await handleReadUrls(reqOf({ keys: [bodyKey('a.png')] }, { length: String(READ_URLS_MAX_BODY_BYTES + 1) }), deps)).status).toBe(413)
    expect(bodyReads).toBe(0)
    await handleReadUrls(reqOf({ keys: [bodyKey('a.png')] }), deps)
    expect(bodyReads).toBe(1) // CONTROL: an admitted call reads it once
  })
})

describe('storage-read-urls — the wiring is real (P1)', () => {
  const fn = read('supabase', 'functions', 'storage-read-urls', 'index.ts')
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('the function supplies the guard, its own limiter bucket, the predicate and the row AS THE CALLER, and signs GET only', () => {
    expect(code).toContain('requireActiveMember(req)')
    expect(code).toContain("isRateLimited(ctx.admin, 'storage-read-urls', ctx.callerId")
    expect(code).toContain("envInt('STORAGE_READ_URLS_RPM', 120)")
    expect(code).toContain("asCaller().rpc('can_presign_project_read', { p_project: projectId })")
    expect(code).toMatch(/asCaller\(\)\s*\.from\('files'\)/)
    expect(code).toContain(".select('project_id, storage_path, thumbnail_url')")
    expect(code).toContain(".eq('project_id', projectId)")
    expect(code).toContain(".eq('storage_provider', 's3')")
    expect(code).toContain(".is('deleted_at', null)")
    // By folder, never by key: no filename in the query string (round 1, 4).
    expect(code).toContain(".like('storage_path', `${folder}/%`)")
    expect(code).not.toContain(".in('storage_path'")
    expect(code).toContain("method: 'GET'")
    for (const m of ["'PUT'", "'DELETE'", "'HEAD'"]) expect(code).not.toContain(m)
    expect(code).toContain('handleReadUrls<MemberContext>(req,')
    // The prefix applied here and only here.
    expect(code).toContain('cfg.prefix ? `${cfg.prefix}/${key}` : key')
  })

  it('config.toml opts it out of the gateway\'s JWT check, like every function here', () => {
    expect(read('supabase', 'config.toml')).toMatch(/\[functions\.storage-read-urls\]\r?\nverify_jwt = false/)
  })

  it('the client calls it by its deployed name, and splits at the server\'s bound', () => {
    const api = read('src', 'cloud', 'storageApi.js')
    expect(api).toContain("callStorageFn('storage-read-urls',")
    expect(S3_READ_BATCH).toBe(READ_URLS_MAX_KEYS)
    expect(S3_READ_FOLDERS).toBe(READ_URLS_MAX_FOLDERS)
  })

  it('the client\'s one copy of the money words agrees with the Deno copy, literally and case-folded', () => {
    expect([...CLIENT_MONEY_SEGMENTS]).toEqual([...MONEY_SEGMENTS])
    expect(isMoneyKey(`projects/${PID}/legal/x/1-a.pdf`)).toBe(true)
    expect(isMoneyKey(`projects/${PID}/Invoices/x/1-a.pdf.jpg`)).toBe(true)
    expect(isMoneyKey(`projects/${PID}/assets/legal/1-a.pdf`)).toBe(false)
    expect(isMoneyKey(null)).toBe(false)
  })

  it('checkRowShapedPath names its refusal: money for a locked folder, shape for the rest', () => {
    expect(checkRowShapedPath(`projects/${PID}/FINANCE/RATES.json`)).toMatchObject({ ok: false, code: 'money' })
    expect(checkRowShapedPath('projects/x')).toMatchObject({ ok: false, code: 'shape' })
  })
})
