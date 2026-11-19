// =============================================================================
// attachmentMigration.test.js — Track C, bundle C3 (MASTER_PLAN §6 #31).
//
// The runner that moves D.O.G.'s legacy attachment arrays into the project's
// file store, and the four things about it that would be silent if they broke.
//
// 🚨 THE HEADLINE IS THE POLARITY (§6 #31 trap (b)). D.O.G. reads a legacy
// entry as CORE unless it says otherwise (`isCore !== false`);
// files.is_core_definer is NOT NULL DEFAULT false. If the move let the column
// take its default, every attachment nobody had explicitly marked would land
// as REFERENCE — and CORE/REF is injected into the prompt as "primary sources
// of truth" versus "supporting reference material only", so every migrated
// project's deck would change. Nothing would fail; the outline would just be
// different. Three tests below hold that line, one per legacy state
// (undefined, true, false).
//
// These use a fake adapter rather than a mirrored copy of the runner's logic —
// the real runAttachmentMigration is imported and driven, so a change to it
// changes these results.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as runner from './runAttachmentMigration'
import { runAttachmentMigration, approxBytes } from './runAttachmentMigration'

/** base64 for the four bytes "hey!" — small, real, and decodable by atob. */
const B64 = 'aGV5IQ=='
const dataUrl = (mime = 'application/pdf') => `data:${mime};base64,${B64}`

function makeAdapter(projects) {
  const uploads = []
  const patches = []
  const bundles = new Map(projects.map(p => [p.id, { project: p }]))
  return {
    uploads,
    patches,
    listProjects: async () => projects.map(p => ({ id: p.id, title: p.title })),
    loadProject:  async (id) => bundles.get(id),
    uploadFile:   async (projectId, scope, file) => {
      uploads.push({ projectId, scope, name: file.name, type: file.type, size: file.size })
      return { id: `f${uploads.length}` }
    },
    updateProject: async (id, patch) => { patches.push({ id, patch }); return {} },
  }
}

const project = (over = {}) => ({
  id: 'p1', title: 'Project One', documents: [], visualAssets: [], ...over,
})

// ── The polarity ─────────────────────────────────────────────────────────────

describe('§6 #31 trap (b) — the CORE flag survives the move', () => {
  it('an UNMARKED legacy attachment lands as CORE, not REFERENCE', async () => {
    // 🚨 This is the whole trap. `isCore` absent means CORE to D.O.G.; the
    // column's default means REFERENCE. Letting the default win is the silent
    // change to generation output that §6 #31's disposition row names.
    const a = makeAdapter([project({
      documents: [{ id: 'd1', name: 'brief.pdf', type: 'application/pdf', content: dataUrl() }],
    })])
    await runAttachmentMigration({ adapter: a })
    expect(a.uploads).toHaveLength(1)
    expect(a.uploads[0].scope.isCoreDefiner).toBe(true)
  })

  it('an explicitly demoted attachment (isCore: false) stays REFERENCE', async () => {
    const a = makeAdapter([project({
      documents: [{ id: 'd1', name: 'refs.pdf', type: 'application/pdf',
                    content: dataUrl(), isCore: false }],
    })])
    await runAttachmentMigration({ adapter: a })
    expect(a.uploads[0].scope.isCoreDefiner).toBe(false)
  })

  it('an explicitly promoted attachment (isCore: true) stays CORE', async () => {
    const a = makeAdapter([project({
      documents: [{ id: 'd1', name: 'brief.pdf', type: 'application/pdf',
                    content: dataUrl(), isCore: true }],
    })])
    await runAttachmentMigration({ adapter: a })
    expect(a.uploads[0].scope.isCoreDefiner).toBe(true)
  })
})

// ── The document kind (0075) ─────────────────────────────────────────────────

describe('the document kind travels with the file', () => {
  it('a document gets its detected kind; a visual asset gets none', async () => {
    const a = makeAdapter([project({
      documents:    [{ id: 'd1', name: 'creative-brief.pdf',
                       type: 'application/pdf', content: dataUrl() }],
      visualAssets: [{ id: 'v1', name: 'ref.png', type: 'image/png',
                       content: dataUrl('image/png') }],
    })])
    await runAttachmentMigration({
      adapter: a,
      detectKind: (n) => (/brief/.test(n) ? 'brief' : null),
    })
    const byName = Object.fromEntries(a.uploads.map(u => [u.name, u.scope]))
    expect(byName['creative-brief.pdf'].documentKind).toBe('brief')
    // An image is not a document and must not claim a kind — 0075 makes the
    // column nullable exactly so this can be NULL rather than 'other'.
    expect(byName['ref.png'].documentKind).toBe(null)
  })
})

// ── The dry run writes nothing ───────────────────────────────────────────────

describe('the dry run', () => {
  it('counts and measures without uploading or patching anything', async () => {
    const a = makeAdapter([project({
      documents: [{ id: 'd1', name: 'a.pdf', type: 'application/pdf', content: dataUrl() }],
      visualAssets: [{ id: 'v1', name: 'b.png', type: 'image/png', content: dataUrl('image/png') }],
    })])
    const r = await runAttachmentMigration({ adapter: a, dryRun: true })
    expect(a.uploads).toHaveLength(0)
    expect(a.patches).toHaveLength(0)
    expect(r.dryRun).toBe(true)
    expect(r.attachments.found).toBe(2)
    expect(r.attachments.moved).toBe(2)   // "would move"
  })
})

// ── The ceiling, and what it does NOT do ─────────────────────────────────────

// Until 2026-11-19 an attachment over 32 MiB was reported and left where it
// was. The limit's written reasons had both stopped being true (F12 measured
// it: OUTSTANDING F12-01), and Audrey ruled in F12's chat, verbatim: "Remove
// the limit". Every attachment moves now, whatever its size.
describe('no per-file ceiling (her ruling of 2026-11-19: "Remove the limit")', () => {
  // The size the old ceiling refused by one byte. Reported through `size`, so
  // the test does not have to allocate 32 MiB: approxBytes prefers the
  // recorded size for exactly this reason.
  const OVER_THE_OLD_CEILING = 32 * 1024 * 1024 + 1
  const withABigOne = () => makeAdapter([project({
    documents: [
      { id: 'd1', name: 'huge.mov', type: 'video/quicktime',
        content: dataUrl('video/quicktime'), size: OVER_THE_OLD_CEILING },
      { id: 'd2', name: 'small.pdf', type: 'application/pdf', content: dataUrl() },
    ],
  })])

  it('an attachment over the old 32 MiB ceiling moves like any other, and is cleared only after its upload', async () => {
    const a = withABigOne()
    const r = await runAttachmentMigration({ adapter: a })
    // Both moved (the runner walks each array backwards, so the last entry goes first).
    expect(a.uploads.map(u => u.name)).toEqual(['small.pdf', 'huge.mov'])
    expect(r.attachments.found).toBe(2)
    expect(r.attachments.moved).toBe(2)
    expect(r.attachments.failed).toBe(0)
    expect(r.attachments.bytes).toBeGreaterThan(OVER_THE_OLD_CEILING)
    // Nothing is left on the project row: the big one is no longer held back.
    expect(a.patches[0].patch.documents).toEqual([])
    // And the report has no "too large" to say any more.
    expect(r.attachments).not.toHaveProperty('tooBig')
    expect(r).not.toHaveProperty('oversize')
  })

  it('the dry run counts it among what would move, with its bytes', async () => {
    const a = withABigOne()
    const r = await runAttachmentMigration({ adapter: a, dryRun: true })
    expect(a.uploads).toHaveLength(0)
    expect(a.patches).toHaveLength(0)
    expect(r.attachments.moved).toBe(2)   // "would move"
    expect(r.attachments.bytes).toBeGreaterThan(OVER_THE_OLD_CEILING)
  })

  it('CONTROL: a big one whose upload fails stays on the row, as any failed one does', async () => {
    // What the ceiling protected is still protected by the order of the work:
    // an entry is cleared only after its own upload has returned.
    const a = withABigOne()
    const upload = a.uploadFile
    a.uploadFile = async (projectId, scope, file) => {
      if (file.name === 'huge.mov') throw new Error('the disk is full')
      return upload.call(a, projectId, scope, file)
    }
    const r = await runAttachmentMigration({ adapter: a })
    expect(r.attachments.moved).toBe(1)
    expect(r.attachments.failed).toBe(1)
    expect(r.errors[0]).toMatchObject({ name: 'huge.mov', message: 'the disk is full' })
    expect(a.patches[0].patch.documents.map(d => d.name)).toEqual(['huge.mov'])
  })

  it('the runner exports no ceiling, and the panel neither names one nor reads a "too large" list', () => {
    expect(Object.keys(runner)).not.toContain('MAX_ATTACHMENT_BYTES')
    const panel = readFileSync(fileURLToPath(new URL('./AttachmentMigrationPanel.jsx', import.meta.url)), 'utf8')
    // The panel read `r.oversize.length` to draw its list: left in, it would throw on a report that has none.
    expect(panel).not.toMatch(/MAX_ATTACHMENT_BYTES|oversize|tooBig|too large/)
    expect(panel).toContain('Dry-run first; the move is one-way.')
  })
})

// ── Failure never loses a file ───────────────────────────────────────────────

describe('a failed upload', () => {
  it('leaves its entry in the array so a re-run moves it', async () => {
    const a = makeAdapter([project({
      documents: [
        { id: 'd1', name: 'ok.pdf',   type: 'application/pdf', content: dataUrl() },
        { id: 'd2', name: 'bad.pdf',  type: 'application/pdf', content: dataUrl() },
      ],
    })])
    const realUpload = a.uploadFile
    a.uploadFile = async (pid, scope, file) => {
      if (file.name === 'bad.pdf') throw new Error('storage said no')
      return realUpload(pid, scope, file)
    }
    const r = await runAttachmentMigration({ adapter: a })
    expect(r.attachments.moved).toBe(1)
    expect(r.attachments.failed).toBe(1)
    expect(a.patches[0].patch.documents.map(d => d.name)).toEqual(['bad.pdf'])
  })

  it('an entry with no body is left alone rather than counted as moved', async () => {
    const a = makeAdapter([project({
      documents: [{ id: 'd1', name: 'ghost.pdf', type: 'application/pdf' }],
    })])
    const r = await runAttachmentMigration({ adapter: a })
    expect(r.attachments.empty).toBe(1)
    expect(r.attachments.moved).toBe(0)
    expect(a.uploads).toHaveLength(0)
  })
})

// ── §6 #31 trap (f): the backend gate ────────────────────────────────────────

describe('a backend with no file store', () => {
  it('refuses loudly instead of running and moving nothing', async () => {
    // Google Drive's uploadFile is `readOnly('uploadFile')` — a function that
    // THROWS — so a `typeof adapter.uploadFile === "function"` gate reads as
    // "this backend can store files". The panel gates on adapterSupportsWrites;
    // the runner's own guard is the belt, and it must be a rejection rather
    // than a silent zero-file report.
    await expect(runAttachmentMigration({ adapter: { listProjects: async () => [] } }))
      .rejects.toThrow(/cannot store files/i)
  })
})

// ── The size estimate ────────────────────────────────────────────────────────

describe('approxBytes', () => {
  it('prefers a recorded size, and otherwise derives it from the base64', () => {
    expect(approxBytes({ size: 1234, content: dataUrl() })).toBe(1234)
    // "aGV5IQ==" is 8 characters -> 6 bytes by the 3/4 rule; the true payload
    // is 4. The estimate is deliberately an upper bound: it decides whether to
    // ATTEMPT a move, and over-estimating skips a borderline file rather than
    // allocating a blob to find out.
    expect(approxBytes({ content: dataUrl() })).toBe(6)
  })
})

// ── The runner does not hold every blob ──────────────────────────────────────

describe('streaming, not batching', () => {
  it('loads one project bundle at a time', async () => {
    // The brief's own trap: project.documents is base64, so holding every
    // project's blobs is the same defect the 8-MB-class JSON row already is.
    // Pinned by observing that loadProject is called once per project and
    // never all up front — the second call cannot happen before the first
    // project's uploads have finished.
    const order = []
    const a = makeAdapter([
      project({ id: 'p1', documents: [{ id: 'd1', name: 'a.pdf', type: 'application/pdf', content: dataUrl() }] }),
      project({ id: 'p2', documents: [{ id: 'd2', name: 'b.pdf', type: 'application/pdf', content: dataUrl() }] }),
    ])
    const load = a.loadProject
    a.loadProject = async (id) => { order.push(`load:${id}`); return load(id) }
    const up = a.uploadFile
    a.uploadFile = async (pid, s, f) => { order.push(`upload:${pid}`); return up(pid, s, f) }
    await runAttachmentMigration({ adapter: a })
    expect(order).toEqual(['load:p1', 'upload:p1', 'load:p2', 'upload:p2'])
  })
})
