// =============================================================================
// deckAttachmentSource.test.js — Track C, bundle C3 (MASTER_PLAN §6 #31).
//
// D.O.G.'s side of the re-homing: WHICH stored file rows are deck attachments,
// what kind of source block each becomes, and — the part that would be silent
// — the two polarities that must NOT be unified.
//
// The contract's exported helpers are driven directly. The polarity itself
// lives inside the component's readers, so it is held here by a SOURCE PIN,
// which is the only instrument available for logic inside a 5700-line
// component's hooks. 🚨 The pin normalises CRLF before matching: the working tree is CRLF
// under core.autocrlf and CI's checkout is LF, so a multi-line regex that
// passes on this machine fails in CI (Track C hit exactly this in C2).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  isDeckAttachmentRow, isDeckDocumentRow, dogTypeForRow, documentKindFor,
  attachmentRowIsVisible, orderAttachmentCandidates, NEW_ATTACHMENT_IS_CORE,
} from '../rabbit_v0.1.0/deckAttachments'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(HERE, p), 'utf8').replace(/\r\n/g, '\n')
const SRC = read('DeckOutlineGenerator.jsx')
const CONTRACT = read('../rabbit_v0.1.0/deckAttachments.js')

// ── Which rows are deck attachments ─────────────────────────────────────────

describe('isDeckAttachmentRow', () => {
  const row = (over = {}) => ({ id: 'f1', name: 'x', mime_type: '', ...over })

  it('takes a classified document — that is what document_kind (0075) is for', () => {
    expect(isDeckAttachmentRow(row({ document_kind: 'brief', mime_type: 'application/pdf' })))
      .toBe(true)
  })

  it('takes PROJECT-LEVEL images and video — what visualAssets[] used to hold', () => {
    expect(isDeckAttachmentRow(row({ mime_type: 'image/png' }))).toBe(true)
    expect(isDeckAttachmentRow(row({ mime_type: 'video/mp4' }))).toBe(true)
  })

  it('🚨 LEAVES media filed against a production entity alone', () => {
    // Review round 1: without this the media arm read "every image or video
    // this project has ever held" — every plate, render and frame grab from
    // RABBIT's Files view. On a project a month into production the twenty
    // NEWEST files are renders, so the brief was pushed out of D.O.G.'s budget
    // entirely and 32 MiB of production media went into the prompt instead.
    // The first version of THIS test asserted the exclusion using only
    // `application/octet-stream` and `application/zip`, which is why it passed
    // while the claim was false — the missing case was the only one that
    // mattered.
    for (const key of ['scene_id', 'shot_id', 'asset_id', 'task_id',
                       'phase_id', 'level_id', 'experience_id']) {
      expect(isDeckAttachmentRow(row({ mime_type: 'image/png', [key]: 'e1' })),
        `an image filed under ${key} is not a deck attachment`).toBe(false)
      expect(isDeckAttachmentRow(row({ mime_type: 'video/mp4', [key]: 'e1' })),
        `a video filed under ${key} is not a deck attachment`).toBe(false)
    }
  })

  it('still takes a DOCUMENT filed against an entity — the kind is the marker', () => {
    // A document only ever gets a kind from one of the three attachment
    // writers, so it stays a deck attachment wherever it was filed. The entity
    // check exists for media, which has no marker of its own.
    expect(isDeckAttachmentRow(row({ document_kind: 'brief', asset_id: 'a1' }))).toBe(true)
  })

  it('LEAVES an unclassified production file alone', () => {
    // 🚨 THE BOUND THAT MATTERS MOST. `public.files` holds everything RABBIT
    // has ever stored for the project — plates, renders, versions. Without
    // this, selecting a project in D.O.G. would start downloading a
    // production tree. RABBIT's own uploads leave document_kind NULL, which
    // is exactly the signal.
    expect(isDeckAttachmentRow(row({ mime_type: 'application/octet-stream' }))).toBe(false)
    expect(isDeckAttachmentRow(row({ mime_type: 'application/zip' }))).toBe(false)
  })

  it('🚨 NEVER takes an invoice, whatever else it is', () => {
    // An invoice is a PDF with a document kind and it is still not deck source
    // material. RLS hides it from anyone without money access, and the
    // Resources list filters it one layer up for the same reason — this is the
    // third gate, in the place a file's BODY would be downloaded.
    expect(isDeckAttachmentRow(row({
      document_kind: 'other', mime_type: 'application/pdf', is_financial: true,
    }))).toBe(false)
    expect(isDeckAttachmentRow(row({ mime_type: 'image/png', is_financial: true })))
      .toBe(false)
  })

  it('never takes a trashed row', () => {
    // Cloud deletes are soft (0014): the row survives with deleted_at set and
    // the blob is still there, so nothing but this check stops a deleted brief
    // still shaping the deck.
    expect(isDeckAttachmentRow(row({
      document_kind: 'brief', deleted_at: '2026-09-01T00:00:00Z',
    }))).toBe(false)
  })

  it('tolerates a missing row', () => {
    expect(isDeckAttachmentRow(null)).toBe(false)
    expect(isDeckAttachmentRow(undefined)).toBe(false)
  })
})

// ── 🚨 THE INVARIANT THAT WAS ACTUALLY BROKEN ───────────────────────────────

describe('documentKindFor — every attachment written stays visible', () => {
  // This is the defect the round-trip diff caught before this bundle shipped,
  // and the reason the reader and the writers are one module. The first
  // version of all three writers used `detectDocumentKind(name) || null`.
  // detectDocumentKind is a NAME heuristic: it returns null for a PDF called
  // "legacy.pdf" or "Nightjar_v3.pdf". A null kind on a non-media file makes
  // isDeckAttachmentRow say no — so the brief uploaded, appeared in the grid,
  // and vanished from generation. §6 #31 trap (c), in the exact shape it was
  // filed in.
  const detect = (n) => (/brief/.test(n) ? 'brief' : null)

  it('gives an UNRECOGNISED document a kind rather than NULL', () => {
    expect(documentKindFor('application/pdf', 'legacy.pdf', detect)).toBe('other')
    expect(documentKindFor('application/pdf', 'Nightjar_v3.pdf', detect)).toBe('other')
    expect(documentKindFor('', 'no-extension', detect)).toBe('other')
  })

  it('keeps a recognised kind', () => {
    expect(documentKindFor('application/pdf', 'creative-brief.pdf', detect)).toBe('brief')
  })

  it('gives media NO kind — an image is not a document', () => {
    expect(documentKindFor('image/png', 'board.png', detect)).toBe(null)
    expect(documentKindFor('video/mp4', 'plate.mp4', detect)).toBe(null)
  })

  it('🚨 is TOTAL: nothing written through it is invisible to the reader', () => {
    // The property, asserted rather than described. If a future writer or a
    // future reader drifts, this fails on the case that drifted.
    const cases = [
      ['application/pdf', 'legacy.pdf'], ['application/pdf', 'creative-brief.pdf'],
      ['text/plain', 'notes.txt'],       ['', 'mystery'],
      ['image/png', 'board.png'],        ['video/quicktime', 'plate.mov'],
      ['image/webp', 'ref.webp'],        ['application/msword', 'treatment.doc'],
      ['application/octet-stream', 'x.bin'],
    ]
    for (const [mime, name] of cases) {
      expect(attachmentRowIsVisible(mime, name, detect),
        `a file written as ${name} (${mime || 'no mime'}) is not a deck attachment`)
        .toBe(true)
    }
  })
})

// ── What each row becomes ───────────────────────────────────────────────────

describe('dogTypeForRow', () => {
  it('maps the four source types the generator knows', () => {
    expect(dogTypeForRow({ mime_type: 'image/jpeg', name: 'a.jpg' })).toBe('image')
    expect(dogTypeForRow({ mime_type: 'application/pdf', name: 'a.pdf' })).toBe('pdf')
    expect(dogTypeForRow({ mime_type: 'video/mp4', name: 'a.mp4' })).toBe('video')
    expect(dogTypeForRow({ mime_type: 'text/markdown', name: 'a.md' })).toBe('text')
  })

  it('falls back to the NAME when the mime type is empty', () => {
    // 🚨 S40's lesson, applied here: File.type is the EMPTY STRING for
    // .mov/.mkv/.avi on any machine whose OS MIME registry lacks them, and a
    // type-only gate sent an H.264 .mov down a path that could not read it.
    // The same is true of a row whose mime_type was never captured.
    expect(dogTypeForRow({ mime_type: '', name: 'plate.mov' })).toBe('video')
    expect(dogTypeForRow({ mime_type: '', name: 'brief.pdf' })).toBe('pdf')
    // Anything else reads as text, which is what the legacy reader did too —
    // it is the only type that degrades safely (worst case, some mojibake in
    // the prompt rather than a block the API rejects).
    expect(dogTypeForRow({ mime_type: '', name: 'notes.txt' })).toBe('text')
  })
})

// ── §6 #31 trap (b): TWO polarities, deliberately not unified ───────────────

describe('the CORE polarity, pinned in source', () => {
  it('the LEGACY reader still defaults to CORE (isCore !== false)', () => {
    // Changing this to `=== true` would demote every previously-unmarked
    // attachment on every existing local project and change generation output
    // — the exact consequence §6 #31's disposition row names.
    expect(SRC).toMatch(/const isCore = doc\.isCore !== false;/)
    expect(SRC).toMatch(/const isCore = asset\.isCore !== false;/)
  })

  it('the STORED reader reads the column strictly (is_core_definer === true)', () => {
    // `!== false` here would mark every stored file CORE, because
    // files.is_core_definer is NOT NULL — there is no third state to default
    // from. The two readers look similar and mean opposite things, which is
    // why both are pinned rather than described.
    expect(SRC).toMatch(/const isCore = row\.is_core_definer === true;/)
  })

  it('and neither reader is the other one', () => {
    expect(SRC).not.toMatch(/row\.is_core_definer !== false/)
    expect(SRC).not.toMatch(/doc\.isCore === true/)
  })
})

// ── The download bound ──────────────────────────────────────────────────────

describe('the attachment bound', () => {
  it('is stated as a count and a total size, both used', () => {
    // A bound that is declared and never applied is the same as no bound. Both
    // constants must appear in the loop as well as in their declarations.
    expect(CONTRACT).toMatch(/export const DOG_ATTACHMENT_MAX_FILES = 20;/)
    expect(CONTRACT).toMatch(/export const DOG_ATTACHMENT_MAX_BYTES = 32 \* 1024 \* 1024;/)
    expect(SRC).toMatch(/out\.length >= DOG_ATTACHMENT_MAX_FILES/)
    expect(SRC).toMatch(/bytes \+ size > DOG_ATTACHMENT_MAX_BYTES/)
  })

  it('skips an oversized file rather than truncating it', () => {
    // Half a brief is worse than no brief: nothing downstream can tell it is
    // half. `continue`, never a slice.
    expect(SRC).toMatch(/if \(bytes \+ size > DOG_ATTACHMENT_MAX_BYTES\) \{ skippedTooBig\+\+; continue; \}/)
  })

  it('says how many files it left out', () => {
    expect(SRC).toMatch(/setStoredFilesNote\(/)
    expect(SRC).toMatch(/not included/)
  })
})

// ── Documents cannot be crowded out ─────────────────────────────────────────

describe('orderAttachmentCandidates', () => {
  it('puts every document ahead of every media file, each newest-first', () => {
    // 🚨 The bound spends itself in this order, so what it costs is visual
    // reference material and never the brief the deck is about. A single date
    // sort put the newest renders first and reported the brief as "1 more file
    // is not included".
    const rows = [
      { name: 'render-new.png', mime_type: 'image/png',       uploaded_at: '2026-09-06' },
      { name: 'brief-old.pdf',  document_kind: 'brief',        uploaded_at: '2026-01-01' },
      { name: 'render-old.png', mime_type: 'image/png',       uploaded_at: '2026-02-01' },
      { name: 'notes-new.txt',  document_kind: 'notes',        uploaded_at: '2026-09-05' },
    ]
    expect(orderAttachmentCandidates(rows).map(r => r.name))
      .toEqual(['notes-new.txt', 'brief-old.pdf', 'render-new.png', 'render-old.png'])
  })

  it('does not mutate its input', () => {
    const rows = [{ name: 'a', mime_type: 'image/png' }, { name: 'b', document_kind: 'brief' }]
    orderAttachmentCandidates(rows)
    expect(rows.map(r => r.name)).toEqual(['a', 'b'])
  })

  it('isDeckDocumentRow is the split it sorts on', () => {
    expect(isDeckDocumentRow({ document_kind: 'brief' })).toBe(true)
    expect(isDeckDocumentRow({ mime_type: 'image/png' })).toBe(false)
    expect(isDeckDocumentRow(null)).toBe(false)
  })
})

// ── §6 #31 trap (b), the WRITE half ─────────────────────────────────────────

describe('a newly written attachment is CORE', () => {
  it('NEW_ATTACHMENT_IS_CORE is true, matching the legacy default', () => {
    // 🚨 Review round 1 found this bundle had it backwards. D.O.G.'s legacy
    // reader treats a missing `isCore` as CORE, and the Resources page's legacy
    // writer never set one — so rerouting that writer with
    // `isCoreDefiner: false` turned "a primary source of truth for what this
    // project IS" into "supporting reference material only" for every file
    // dropped after the change, silently. runAttachmentMigration carries
    // `isCore !== false` across, so this constant is what keeps a brief
    // dropped today meaning what one dropped last month means.
    expect(NEW_ATTACHMENT_IS_CORE).toBe(true)
  })

  it('and both writers use the constant rather than a literal', () => {
    const PROJECTS = read('../../components/Projects/ProjectsPage.jsx')
    expect(PROJECTS).toMatch(/isCoreDefiner: NEW_ATTACHMENT_IS_CORE/)
    expect(SRC).toMatch(/isCoreDefiner: NEW_ATTACHMENT_IS_CORE/)
    expect(PROJECTS).not.toMatch(/isCoreDefiner: false/)
    expect(SRC).not.toMatch(/isCoreDefiner: false/)
  })

  it('🚨 and neither writer can file an attachment as money', () => {
    // The brief's fourth requirement, read off the REAL call sites rather than
    // off a literal built inside the test (review round 1 called the first
    // version tautological, and it was: it asserted a property of an object
    // declared two lines above it).
    //
    // The scope each writer passes is sliced out by BRACE MATCHING from the
    // `adapter.uploadFile(` token rather than by a regex, so a reformat cannot
    // make the check silently match nothing. Neither writer may pass
    // `financial` — which files the body under the INVOICES segment, readable
    // only by managers, so the person who uploaded their own brief could not
    // read it back — nor an entity id, which files it under a scene, shot or
    // asset and takes it out of D.O.G.'s reach entirely.
    // uploadScope.test.js pins the container function these feed.
    const scopeArgOf = (src, from) => {
      const open = src.indexOf('{', src.indexOf('(', from))
      let depth = 0
      for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
      }
      return null
    }
    const PROJECTS = read('../../components/Projects/ProjectsPage.jsx')
    for (const [label, src] of [['ProjectsPage', PROJECTS], ['DeckOutlineGenerator', SRC]]) {
      const scopes = []
      for (let i = src.indexOf('adapter.uploadFile('); i >= 0;
           i = src.indexOf('adapter.uploadFile(', i + 1)) {
        const scope = scopeArgOf(src, i)
        if (scope) scopes.push(scope)
      }
      expect(scopes.length, label + ' has no adapter.uploadFile scope to check')
        .toBeGreaterThan(0)
      for (const scope of scopes) {
        expect(scope, label + ' passes financial to uploadFile')
          .not.toMatch(/financial\s*:/)
        expect(scope, label + ' passes an entity id to uploadFile')
          .not.toMatch(/\b(assetId|taskId|phaseId|sceneId|shotId|levelId|experienceId)\s*:/)
      }
    }
  })
})

// ── The effect's dependencies ───────────────────────────────────────────────

describe('the fetch effect', () => {
  it('depends on the STABLE getAdapter, never on the whole context', () => {
    // 🚨 RabbitProvider's context value is a useMemo over a long dependency
    // list, so it takes a new identity many times a session. An effect that
    // downloads file bodies must not depend on it — that re-downloads every
    // attachment on every provider render.
    expect(SRC).toMatch(
      /\}, \[selectedProjectId, getAdapter, adapterMode, storedFilesReloadKey\]\);/)
    expect(SRC).not.toMatch(/\}, \[selectedProjectId, rabbitCtx/)
  })

  it('guards every setState after an await with the liveness token', () => {
    // Selecting project A then B while A's downloads are in flight must not
    // let A's bodies land in B's panel.
    expect(SRC).toMatch(/if \(!live\) return;/)
  })
})
