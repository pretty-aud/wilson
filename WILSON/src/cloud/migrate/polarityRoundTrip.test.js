// =============================================================================
// polarityRoundTrip.test.js — MASTER_PLAN §6 #31 trap (b), made measurable and
// kept measurable (Track C, bundle C3).
//
// §6 #31's disposition row names one consequence above all the others: "the
// isCore polarity flip alone would change generation output". The brief's
// answer is to "snapshot a deck generated from a legacy-array project BEFORE
// the change, regenerate after with the same inputs, diff the outline".
//
// 🚨 A GENERATED OUTLINE IS A SAMPLE. Two runs of the same prompt differ from
// each other, so diffing two decks measures the model, not the change. What IS
// deterministic — and what the polarity actually controls — is everything the
// model is ASKED: the CORE/REF split injected as `projectContext`, and which
// files are labelled `[Project · CORE]` versus `[Project · REF]`. This file
// diffs that, which is a stronger claim than one matching sample.
//
// It runs the REAL reader (lifted from the component source, so it cannot be a
// paraphrase that drifts) and the REAL runAttachmentMigration over one legacy
// fixture, then compares:
//
//   BEFORE — the legacy arrays, read by the legacy reader (default TRUE)
//   AFTER  — the same files as `files` rows, read by the stored reader
//            (is_core_definer === true, from data)
//
// 🚨 THIS FILE ALREADY EARNED ITS PLACE. Its first run failed: `legacy.pdf`
// vanished entirely, because detectDocumentKind returns null for a PDF whose
// name matches none of its heuristics, and a null document_kind on a non-media
// row is not a deck attachment. The file uploaded, listed in the grid, and
// disappeared from generation — §6 #31 trap (c) in the exact shape it was
// filed in. documentKindFor is the fix; this is what caught it.
//
// The source pin normalises CRLF: the working tree is CRLF under
// core.autocrlf and CI's checkout is LF (Track C hit that in C2).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runAttachmentMigration } from './runAttachmentMigration'
import { isDeckAttachmentRow } from '../../tools/rabbit_v0.1.0/deckAttachments'

const HERE = dirname(fileURLToPath(import.meta.url))
const COMPONENT = readFileSync(
  join(HERE, '../../tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx'),
  'utf8').replace(/\r\n/g, '\n')

/**
 * Lift the legacy-array reader's BODY out of the component and make it
 * callable. Not a copy: if the reader changes, this changes with it, which is
 * the only way a "before" that lives in the same file as the "after" means
 * anything.
 */
function legacyReader(src) {
  const start = src.search(/const legacyProjectFiles = useMemo\(\(\) => \{/)
  expect(start, 'legacyProjectFiles reader not found in the component').toBeGreaterThan(-1)
  const open = src.indexOf('{', src.indexOf('=> {', start))
  let depth = 0, i = open
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) break }
  }
  // eslint-disable-next-line no-new-func
  return new Function('selectedProject', src.slice(open + 1, i))
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')

/**
 * A legacy project of the kind that predates C3. Every branch of the reader
 * and every state of the flag: unmarked (the trap), explicitly true,
 * explicitly false — and `legacy.pdf`, the name that broke this test.
 */
const fixture = () => ({
  id: 'p-legacy', title: 'Nightjar', description: 'A short film about insomnia.',
  documents: [
    { id: 'd1', name: 'brief.pdf',  type: 'application/pdf', size: 2048,
      content: `data:application/pdf;base64,${b64('BRIEF BODY')}` },
    { id: 'd2', name: 'notes.txt',  type: 'text/plain', size: 64,
      content: `data:text/plain;base64,${b64('some notes')}`, isCore: false },
    { id: 'd3', name: 'board.png',  type: 'image/png', size: 900,
      content: `data:image/png;base64,${b64('PNGDATA')}`, isCore: true },
    { id: 'd4', name: 'legacy.pdf', type: 'application/pdf', size: 10,
      content: b64('NO PREFIX') },
  ],
  visualAssets: [
    { id: 'v1', name: 'ref-a.jpg', type: 'image/jpeg', size: 1200,
      content: `data:image/jpeg;base64,${b64('JPEGA')}` },
    { id: 'v2', name: 'plate.mov', type: '', size: 5000,
      content: `data:video/quicktime;base64,${b64('MOVDATA')}`, isCore: false },
  ],
})

/** detectDocumentKind's real shape: a NAME heuristic that often says nothing. */
const detectKind = (n) => (/brief/.test(n) ? 'brief' : /notes/.test(n) ? 'notes' : null)

/** An adapter that records the rows supabaseAdapter.uploadFile would write. */
function recordingAdapter(project) {
  const rows = []
  return {
    rows,
    listProjects:  async () => [{ id: project.id, title: project.title }],
    loadProject:   async () => ({ project }),
    updateProject: async (_id, patch) => { Object.assign(project, patch); return {} },
    // These two lines are supabaseAdapter.uploadFile's own, for the fields
    // D.O.G. reads back: `is_core_definer: !!scope.isCoreDefiner` and
    // `document_kind: scope.documentKind || null`.
    uploadFile: async (projectId, scope, file) => {
      const row = {
        id: `f${rows.length + 1}`, project_id: projectId, name: file.name,
        mime_type: file.type || null, size_bytes: file.size,
        is_core_definer: !!scope.isCoreDefiner,
        document_kind: scope.documentKind || null,
        is_financial: false, deleted_at: null,
      }
      rows.push(row)
      return row
    },
  }
}

const namesBy = (entries, core) => entries
  .filter(e => !!e.isCore === core)
  .map(e => (e.file ? e.file.name : e.name).replace(/^\[Project · (CORE|REF)\]\s*/, ''))
  .sort()

describe('§6 #31 trap (b): migrating a legacy project changes nothing D.O.G. asks', () => {
  it('moves not one file between CORE and REFERENCE', async () => {
    const before = legacyReader(COMPONENT)(fixture())

    const project = fixture()
    const adapter = recordingAdapter(project)
    const report = await runAttachmentMigration({ adapter, detectKind })
    expect(report.attachments.failed, 'the fixture must migrate cleanly').toBe(0)

    // D.O.G.'s stored-row reader, in the two lines that matter:
    //   const isCore = row.is_core_definer === true;
    const after = adapter.rows
      .filter(isDeckAttachmentRow)
      .map(row => ({ name: row.name, isCore: row.is_core_definer === true }))

    expect(namesBy(after, true)).toEqual(namesBy(before, true))
    expect(namesBy(after, false)).toEqual(namesBy(before, false))
  })

  it('🚨 loses no file at all — every legacy entry is still a deck attachment', async () => {
    // The half that failed first. A migrated row that no longer satisfies
    // isDeckAttachmentRow is invisible to generation while looking perfectly
    // healthy everywhere else, so the count is asserted as well as the split.
    const before = legacyReader(COMPONENT)(fixture())
    const project = fixture()
    const adapter = recordingAdapter(project)
    await runAttachmentMigration({ adapter, detectKind })

    const visible = adapter.rows.filter(isDeckAttachmentRow)
    expect(visible).toHaveLength(before.length)
    expect(visible.map(r => r.name).sort())
      .toEqual(before.map(f => f.file.name.replace(/^\[Project · (CORE|REF)\]\s*/, '')).sort())
    // Named, so a regression says WHICH file went missing.
    expect(visible.map(r => r.name)).toContain('legacy.pdf')
  })

  it('empties the legacy arrays only for what actually moved', async () => {
    const project = fixture()
    const adapter = recordingAdapter(project)
    await runAttachmentMigration({ adapter, detectKind })
    expect(project.documents).toEqual([])
    expect(project.visualAssets).toEqual([])
  })
})
