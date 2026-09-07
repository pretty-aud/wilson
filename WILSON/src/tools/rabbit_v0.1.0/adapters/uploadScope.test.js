// =============================================================================
// uploadScope.test.js — Session 27.
//
// Which folder an uploaded file goes in, and — the part that matters — which
// third path segment it gets.
//
// The storage key is `projects/<projectId>/<segment>/<entityId>/<ts>-<name>`,
// and that THIRD segment is the money gate: public.rabbit_money_segment()
// (migration 0042) classifies INVOICES and FINANCE as manager-only, the three
// base storage policies negate it and the four money policies assert it.
//
// So a container segment that collided with a reserved word would file an
// ordinary attachment inside the manager-only namespace. The uploader would
// get no error — the money INSERT policy would accept it if they happened to
// be a manager, and refuse it confusingly if they were not — and the file
// would then be unreadable to the very team it was shared with. This file
// exists so that collision fails a test instead.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({ supabase: null }))

const { uploadContainerFor } = await import('./supabaseAdapter')
const { RATES_SEGMENT } = await import('../projectRates')

describe('the container decides the folder', () => {
  it('prefers the most specific entity, scene before shot', () => {
    // Matches FileManager.jsx:84's own parentType chain. The component and the
    // adapter disagreeing about this would put a file in one folder and show
    // it in another.
    expect(uploadContainerFor({ sceneId: 's1', shotId: 'h1' }).seg).toBe('scenes')
    expect(uploadContainerFor({ shotId: 'h1' }).seg).toBe('shots')
    expect(uploadContainerFor({ levelId: 'l1' }).seg).toBe('levels')
    expect(uploadContainerFor({ experienceId: 'e1' }).seg).toBe('experiences')
    expect(uploadContainerFor({ assetId: 'a1' }).seg).toBe('assets')
  })

  it('falls back to the project itself', () => {
    expect(uploadContainerFor({}, 'p1')).toEqual({ seg: 'project', key: null, id: 'p1' })
  })

  it('does NOT let a task or phase move the file', () => {
    // 🚨 The two axes. TaskDetailPopup mounts FileManager with assetId AND
    // taskId: the file lives in the asset's folder and is the task's
    // attachment. If task won here, every task attachment would leave the
    // asset folder a user is looking at.
    expect(uploadContainerFor({ assetId: 'a1', taskId: 't1' }).seg).toBe('assets')
    expect(uploadContainerFor({ assetId: 'a1', taskId: 't1' }).id).toBe('a1')
    // With no container of its own, a task still needs somewhere to go.
    expect(uploadContainerFor({ taskId: 't1' }).seg).toBe('tasks')
    expect(uploadContainerFor({ phaseId: 'ph1' }).seg).toBe('phases')
  })

  it('names the folder FK only for entities that have folders', () => {
    // The FK is what lets uploadFile resolve folder_id. Tasks and phases have
    // no folder of their own in the 0041 tree, so they must not claim one.
    expect(uploadContainerFor({ sceneId: 's1' }).key).toBe('scene_id')
    expect(uploadContainerFor({ experienceId: 'e1' }).key).toBe('experience_id')
    expect(uploadContainerFor({ taskId: 't1' }).key).toBeNull()
    expect(uploadContainerFor({ assetId: 'a1' }).key).toBeNull()
  })
})

describe('no container segment can reach the money-gated namespace', () => {
  const EVERY_SCOPE = [
    { sceneId: 'x' }, { shotId: 'x' }, { levelId: 'x' }, { experienceId: 'x' },
    { assetId: 'x' }, { taskId: 'x' }, { phaseId: 'x' }, {},
  ]

  it('never emits a reserved segment, in any case', () => {
    // Case-insensitive, because rabbit_money_segment() compares on upper().
    const reserved = ['INVOICES', RATES_SEGMENT.toUpperCase()]
    for (const scope of EVERY_SCOPE) {
      const seg = uploadContainerFor(scope, 'p1').seg
      expect(reserved).not.toContain(seg.toUpperCase())
    }
  })

  it('emits a segment that is a single safe path component', () => {
    // A segment containing a slash would shift every later segment along and
    // move the gate onto a different word entirely.
    for (const scope of EVERY_SCOPE) {
      const seg = uploadContainerFor(scope, 'p1').seg
      expect(seg).toMatch(/^[a-z]+$/)
    }
  })

  // ── Track C, bundle C3 (MASTER_PLAN §6 #31) ─────────────────────────────
  it('a D.O.G. deck attachment cannot be money-gated', () => {
    // The brief's own requirement: "attachments count toward the Petal meter
    // and are never money-gated unless someone puts them under a reserved
    // segment — assert they cannot be."
    //
    // This is the EXACT scope ProjectsPage.handleFileUpload and D.O.G.'s
    // new-project modal pass. Neither sets `financial`, and neither sets any
    // container id, so the container is the project itself and the third path
    // segment is the literal 'project' — which rabbit_money_segment() does not
    // match in any case. The check above covers every scope shape; this one
    // covers the caller, because a future edit is far more likely to change
    // what the drop zone PASSES than to change uploadContainerFor.
    const attachmentScope = { documentKind: 'brief', isCoreDefiner: false }
    const c = uploadContainerFor(attachmentScope, 'p1')
    expect(c.seg).toBe('project')
    expect(c.id).toBe('p1')
    expect(['INVOICES', RATES_SEGMENT.toUpperCase()]).not.toContain(c.seg.toUpperCase())
    // And nothing in that scope is truthy under the name uploadFile reads for
    // the money branch — `scope.financial`. An attachment reaching the
    // INVOICES segment would be readable only by managers, so the person who
    // uploaded it could not read their own brief back.
    expect(attachmentScope.financial).toBeUndefined()
  })
})
