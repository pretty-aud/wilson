// =============================================================================
// projectAttachments.test.js — Session 15.
//
// Pins the cloud-attachment refusal rules in supabaseAdapter. There was no
// coverage here at all, which is how the mixed-patch hole survived from S12
// to S15: a patch of { title, documents } saved the title and dropped the
// files with no error, because the guard lived inside the "row reduced to
// nothing" branch.
//
// The adapter's module scope needs a live Supabase client, so rather than
// stand one up these tests exercise the two pure predicates the refusal is
// built from, mirrored here EXACTLY as they appear in supabaseAdapter.js.
// That is a real duplication and worth naming: if the adapter's copies
// change, these tests keep passing while the adapter regresses. They are
// pinned to the behaviours a reviewer would check by hand, and the adapter
// carries a pointer back to this file.
// =============================================================================

import { describe, it, expect } from 'vitest'

// ── mirrors of supabaseAdapter.js ───────────────────────────────────────────

function hasRealAttachments(payload) {
  if (!payload || typeof payload !== 'object') return false
  return (Array.isArray(payload.documents) && payload.documents.length > 0)
      || (Array.isArray(payload.visualAssets) && payload.visualAssets.length > 0)
}

function mapDogProjectFields(row) {
  if (!row || typeof row !== 'object') return { row, droppedAttachments: false }
  const out = { ...row }
  if (out.startDate !== undefined) { out.start_date = out.startDate || null; delete out.startDate }
  if (out.endDate !== undefined) { out.end_date = out.endDate || null; delete out.endDate }
  if (out.start_date === '') out.start_date = null
  if (out.end_date === '') out.end_date = null
  const droppedAttachments = out.documents !== undefined || out.visualAssets !== undefined
  delete out.documents
  delete out.visualAssets
  return { row: out, droppedAttachments }
}

/** The adapter's decision, expressed once: does this payload get refused? */
const refuses = (payload) =>
  mapDogProjectFields(payload).droppedAttachments && hasRealAttachments(payload)

const FILE = { id: 'f1', name: 'brief.pdf', content: 'data:application/pdf;base64,AAAA' }

describe('cloud project attachment refusal', () => {
  it('refuses an attachments-only patch (the S12 behaviour, preserved)', () => {
    expect(refuses({ documents: [FILE] })).toBe(true)
  })

  it('refuses a MIXED patch — the S15 fix', () => {
    // Before S15 this returned false: the row was non-empty, so the guard
    // never ran, the title saved and the file vanished without an error.
    expect(refuses({ title: 'Renamed', documents: [FILE] })).toBe(true)
  })

  it('refuses visualAssets the same way as documents', () => {
    expect(refuses({ title: 'Renamed', visualAssets: [FILE] })).toBe(true)
  })

  it('allows a create carrying EMPTY attachment arrays', () => {
    // ProjectsPage sends these on every create; refusing them would break
    // ordinary project creation in cloud mode.
    expect(refuses({ title: 'New', description: '', status: 'active', documents: [], visualAssets: [] }))
      .toBe(false)
  })

  it('allows an ordinary patch with no attachment keys', () => {
    expect(refuses({ title: 'Renamed', status: 'archived' })).toBe(false)
  })

  it('treats a non-array attachments value as no attachment', () => {
    // Postel: a malformed value is not content to lose. It is dropped as an
    // unknown column would be, and the patch proceeds.
    expect(refuses({ title: 'x', documents: null })).toBe(false)
    expect(refuses({ title: 'x', documents: 'oops' })).toBe(false)
  })

  it('still drops the attachment keys from the row it sends', () => {
    const { row } = mapDogProjectFields({ title: 'x', documents: [FILE], visualAssets: [] })
    expect(row).toEqual({ title: 'x' })
  })

  it('maps D.O.G. camelCase dates onto the canonical columns', () => {
    const { row } = mapDogProjectFields({ startDate: '2026-01-01', endDate: '' })
    expect(row).toEqual({ start_date: '2026-01-01', end_date: null })
  })

  it('clears a snake_case empty date rather than sending 22007-bait', () => {
    const { row } = mapDogProjectFields({ start_date: '', end_date: '' })
    expect(row).toEqual({ start_date: null, end_date: null })
  })

  it('handles a null payload without throwing', () => {
    expect(refuses(null)).toBe(false)
    expect(mapDogProjectFields(null).droppedAttachments).toBe(false)
  })
})
