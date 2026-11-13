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
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import { memo } from 'react'
import { render, cleanup, act } from '@testing-library/react'

vi.mock('../../lib/modelSources', () => ({
  loadApprovedModels: async () => ({ models: [], error: null }),
  cachedApprovedModels: () => [],
  setUserModelOverride: async () => {},
  // The section's own load: refused, so it marks nothing (an offline launch).
  loadModelSources: async () => {},
}))

const { default: UserModelsSection } = await import('./UserModelsSection')
const { markModelSourcesLoaded, subscribeModelSourcesLoaded } = await import('../../lib/activeModel')

afterEach(() => { cleanup(); markModelSourcesLoaded(false) })

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
