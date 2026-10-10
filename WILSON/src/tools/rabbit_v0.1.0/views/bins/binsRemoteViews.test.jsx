/** @vitest-environment jsdom */
// =============================================================================
// GW1 (2026-10-10) — the Bins inspector's one line about viewings from outside
// (GATEWAY_DESIGN.md §6; the brief's item 5: "one line behind can and the
// role"; GW3 owns the rest of the inspector).
//
// BinsView hands `remoteViewsFor` only to a workspace admin (binsView.test.jsx
// proves the gate); this file proves the inspector's half: asked once per
// selected company clip, never for a desktop row, a multi-selection or when
// not handed the reader; the line in the design's words; nothing for a clip
// never viewed from outside, and nothing when the read fails.
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act, waitFor } from '@testing-library/react'
import BinInspector from './BinInspector'

afterEach(() => { cleanup() })

const clip = (over = {}) => ({
  id: 'c1', bin_id: 'b1', display_name: 'A001_C001', original_name: 'A001_C001.mov', extension: '.mov', media_type: 'video',
  online: true, review_flag: 'unflagged', location_id: 'L1', relative_path: 'A001/A001_C001.mov', ...over,
})
const PRIYA = { count: 3, last: { actor_label: 'Priya Raman', created_at: '2026-10-09T15:00:00Z' } }

function inspector(rows, remoteViewsFor) {
  return render(
    <BinInspector rows={rows} scenes={[]} shots={[]} fps={24} canWrite ffmpeg={false} thumbUrlFor={() => null} streamUrlFor={() => null}
      onPatch={() => {}} locationOf={() => ({ name: 'Footage NAS', unc_path: '\\\\nas\\footage' })} addedByOf={() => 'Sofia Aldana'}
      remoteViewsFor={remoteViewsFor} canStream={false} catalogue />,
  )
}

describe('the inspector\'s one line (admins: BinsView hands the reader)', () => {
  it('one company clip: asked once, the line in the design\'s words, under who added it', async () => {
    const read = vi.fn(async () => PRIYA)
    inspector([clip()], read)
    const line = await screen.findByTestId('bin-remote-views')
    expect(line.textContent).toBe('Viewed from outside 3 times, last by Priya on 9 Oct')
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith('c1')
    // Beside the clip's details (TechRows), after "Added by".
    expect(line.previousElementSibling.textContent).toContain('Sofia Aldana')
  })

  it('not handed the reader (anyone but an admin): no line, nothing asked', async () => {
    inspector([clip()], null)
    await act(async () => {})
    expect(screen.queryByTestId('bin-remote-views')).toBeNull()
  })

  it('a desktop row (no footage location) and a multi-selection are never asked about', async () => {
    const read = vi.fn(async () => PRIYA)
    inspector([clip({ location_id: null, relative_path: null, source_path: 'D:\\A001.mov' })], read)
    await act(async () => {})
    cleanup()
    inspector([clip(), clip({ id: 'c2' })], read)
    await act(async () => {})
    expect(read).not.toHaveBeenCalled()
    expect(screen.queryByTestId('bin-remote-views')).toBeNull()
  })

  it('never viewed from outside: nothing (Selective attention); a failed read: nothing, no throw', async () => {
    const none = vi.fn(async () => ({ count: 0, last: null }))
    inspector([clip()], none)
    await waitFor(() => expect(none).toHaveBeenCalled())
    expect(screen.queryByTestId('bin-remote-views')).toBeNull()
    cleanup()
    const broken = vi.fn(async () => { throw new Error('[supabase] remoteViewsOfClip failed: boom') })
    inspector([clip()], broken)
    await waitFor(() => expect(broken).toHaveBeenCalled())
    expect(screen.queryByTestId('bin-remote-views')).toBeNull()
  })

  it('a new selection reads its own clip; the old answer does not linger', async () => {
    let finish
    const slow = vi.fn((id) => (id === 'c1' ? Promise.resolve(PRIYA) : new Promise((r) => { finish = r })))
    const { rerender } = inspector([clip()], slow)
    await screen.findByTestId('bin-remote-views')
    rerender(
      <BinInspector rows={[clip({ id: 'c2' })]} scenes={[]} shots={[]} fps={24} canWrite ffmpeg={false} thumbUrlFor={() => null} streamUrlFor={() => null}
        onPatch={() => {}} locationOf={() => null} addedByOf={() => null} remoteViewsFor={slow} canStream={false} catalogue />,
    )
    // c1's line is gone while c2's is read.
    expect(screen.queryByTestId('bin-remote-views')).toBeNull()
    await act(async () => finish({ count: 1, last: { actor_label: 'Theo Lindqvist', created_at: '2026-10-01T09:00:00Z' } }))
    expect((await screen.findByTestId('bin-remote-views')).textContent).toBe('Viewed from outside once, last by Theo on 1 Oct')
  })
})
