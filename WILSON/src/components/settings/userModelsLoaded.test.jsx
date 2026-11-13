/** @vitest-environment jsdom */
// =============================================================================
// userModelsLoaded.test.jsx — Settings' Models section follows the loaded flag
// (F4, 2026-11-13; review round 1, B-1).
//
// The section says "Loading your settings…" until the model tiers have been
// read once (activeModel.js's `loaded` flag). It read the flag plainly while it
// drew, so it was as fresh as its last render; Settings is under React.memo
// since F4, and a load that landed ELSEWHERE (App's, when an offline launch's
// connection comes back; the Admin terminal's; a model chosen in D.O.G.) set
// the flag with nothing drawing Settings again: "Loading your settings…" until
// Refresh. The section now subscribes to the flag.
//
// Here the section is drawn under a memo'd parent that is never drawn again,
// its own load answering without a read (the offline case), and the flag set
// from outside, as another surface's load sets it.
//
// Review round 2 (B-1): following the flag was half of it. The tiers and the
// operator's efforts were copies taken at mount (or at the section's own last
// load), so the load that set the flag ELSEWHERE drew "You have not overridden
// anything…" with every row on Inherit while the store held the person's own
// choice: a confident wrong answer where "Loading your settings…" had been. A
// load sets the tiers and the efforts, then the flag (loadModelSources); the
// section reads both again when the flag moves.
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import { memo } from 'react'
import { render, cleanup, act } from '@testing-library/react'
import { REGISTRY } from '../../lib/aiModels'

vi.mock('../../lib/modelSources', () => ({
  loadApprovedModels: async () => ({ models: [], error: null }),
  cachedApprovedModels: () => [],
  setUserModelOverride: async () => {},
  // The section's own load: refused, so it marks nothing (an offline launch).
  loadModelSources: async () => {},
}))

const { default: UserModelsSection } = await import('./UserModelsSection')
const {
  markModelSourcesLoaded, subscribeModelSourcesLoaded, setModelSources, setPlatformEffort,
} = await import('../../lib/activeModel')

afterEach(() => { cleanup(); markModelSourcesLoaded(false); setModelSources({}); setPlatformEffort({}) })

// Settings, in small: drawn once, never again.
const Settings = memo(function Settings() { return <UserModelsSection /> })

describe('the Models section and the loaded flag', () => {
  it('says "Loading your settings…" until a load anywhere sets the flag, and then what is set, with nothing else drawing it', async () => {
    markModelSourcesLoaded(false)
    const view = render(<Settings />)
    await act(async () => {})                          // its own load answers, and marks nothing
    expect(view.container.textContent).toContain('Loading your settings…')
    await act(async () => { markModelSourcesLoaded(true) })   // another surface's load lands
    expect(view.container.textContent).not.toContain('Loading your settings…')
    expect(view.container.textContent).toContain('You have not overridden anything')
  })

  it('shows what the load elsewhere brought, the person\'s own choice and the operator\'s effort, not the copies it was drawn with', async () => {
    markModelSourcesLoaded(false)
    const view = render(<Settings />)
    await act(async () => {})                          // its own load answers, and marks nothing
    expect(view.container.textContent).toContain('Loading your settings…')
    expect(view.getByLabelText('Model for Course generation').value).toBe('')   // Inherit
    // Another surface's load lands as loadModelSources lands one: the tiers and
    // the efforts first, then the flag.
    await act(async () => {
      setModelSources({ user: { 'otter.course': 'claude-opus-5' } })
      setPlatformEffort({ 'otter.quiz': 'low' })
      markModelSourcesLoaded(true)
    })
    const text = view.container.textContent
    expect(text).not.toContain('You have not overridden anything')
    expect(text).toContain(`You have overridden 1 of ${REGISTRY.length} functions.`)
    const mine = view.getByLabelText('Model for Course generation')
    expect(mine.value).toBe('claude-opus-5')
    expect(mine.closest('.s-model-row').textContent).toContain('your choice')
    expect(view.getByLabelText('Model for Quiz generation').closest('.s-model-row').textContent).toContain('effort low')
  })

  it('the flag tells its listeners when it moves, and only then', () => {
    markModelSourcesLoaded(false)
    let told = 0
    const stop = subscribeModelSourcesLoaded(() => { told += 1 })
    markModelSourcesLoaded(true)
    markModelSourcesLoaded(true)
    markModelSourcesLoaded(false)
    stop()
    markModelSourcesLoaded(true)
    expect(told).toBe(2)
  })
})
