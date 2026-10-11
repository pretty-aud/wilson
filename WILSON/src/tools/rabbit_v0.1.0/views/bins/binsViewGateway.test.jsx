/** @vitest-environment jsdom */
// =============================================================================
// binsViewGateway.test.jsx — the Bins tab in a BROWSER with the company's file
// gateway (GW3; GATEWAY_DESIGN.md §2, §5, §7; the brief's items 1–5),
// rendered, with the provider and the access hook mocked.
//
// The capability object is the gateway composite's (backend gateway_cloud):
// the catalogue until a door answers, then `stream` and `resolveFiles` on.
// What this pins:
//   * the notice is keyed on picking alone: with a gateway it reads the
//     gateway sentence; New bin stays; §2's four states say their sentences
//     (no gateway with the admin's line, not seen, unreachable with the
//     own-computer line, Chrome's prompt while probing);
//   * the dim and the counts return (nothingReachable false), the count a
//     count and no relink;
//   * the inspector: a playable clip asks for ONE ticket when selected
//     (D22: the picture and loading meanwhile) and plays through
//     GatewayVideo once the URL is there; a ProRes .mov keeps the picture
//     with NEEDS_DESKTOP_FORMAT; an offline clip says the gateway's word per
//     location; the mark appears when the door is outside;
//   * hover on a tile asks for its ticket (R12); a played selection asks for
//     its batch; the grid never asks on mount;
//   * Space opens the large PLAYER (autoplay) where the clip streams, the
//     picture where it does not; Esc closes it; the inspector leaves Space
//     to it;
//   * the view is read again every 60 s while the tab is on screen;
//   * item 5: an admin's viewings line opens the table filtered to the clip.
// =============================================================================

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act, within, waitFor } from '@testing-library/react'

const state = vi.hoisted(() => ({ ctx: null, access: null }))
vi.mock('../../state/RabbitProvider', () => ({ useRabbit: () => state.ctx }))
vi.mock('../../state/useProjectAccess', () => ({ useProjectAccess: () => state.access }))
const { default: BinsView } = await import('../BinsView')
const W = await import('../../bins/binLocations')
const { GATEWAY_REFRESH_MS } = await import('../../adapters/gatewayBins')

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })
beforeEach(() => {
  // jsdom's <video> answers "" to every type; Chrome answers "probably" to MP4.
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((t) => (/^video\/mp4/.test(t) && !/apcn/.test(t) ? 'probably' : ''))
})

const CATALOGUE = { backend: 'gateway_cloud', pickFiles: false, probe: false, stream: false, resolveFiles: false, relink: false, openInOs: false, posters: 'cloud', locations: true, remoteViewingSwitch: true }
const REACHED = { ...CATALOGUE, stream: true, resolveFiles: true }

const rowsFor = () => [
  { id: 'f0', bin_id: 'b1', location_id: 'L1', relative_path: 'A001/C000.mp4', display_name: 'Proxy 0', original_name: 'C000.mp4', extension: '.mp4', media_type: 'video', codec: 'H.264', online: true, review_flag: 'unflagged', circled: false, color: null, sort_order: 0, added_by: 'u1', slate: '12A', take_number: 1, poster_path: 'projects/p1/bin_files/f0/1-poster.jpg' },
  { id: 'f1', bin_id: 'b1', location_id: 'L1', relative_path: 'A001/C001.mov', display_name: 'Master 1', original_name: 'C001.mov', extension: '.mov', media_type: 'video', codec: 'ProRes 422 HQ', online: true, review_flag: 'unflagged', circled: false, color: null, sort_order: 1, added_by: 'u1', slate: '12A', take_number: 2 },
  { id: 'f2', bin_id: 'b1', location_id: 'L2', relative_path: 'ARCH/C002.mp4', display_name: 'Archive 2', original_name: 'C002.mp4', extension: '.mp4', media_type: 'video', codec: 'H.264', online: false, review_flag: 'unflagged', circled: false, color: null, sort_order: 2, added_by: 'u1', slate: '12B', take_number: 1 },
  { id: 'f3', bin_id: 'b1', location_id: 'L1', relative_path: 'A001/C003.mp4', display_name: 'Proxy 3', original_name: 'C003.mp4', extension: '.mp4', media_type: 'video', codec: 'H.264', online: true, review_flag: 'unflagged', circled: false, color: null, sort_order: 3, added_by: 'u1', slate: '12C', take_number: 1 },
]
const reviewer = () => ({ canWrite: false, writeReason: 'x', can: (a) => a === 'project.bins.write', reasonFor: () => null, gateCtx: { appRole: 'user' } })
const admin = () => ({ ...reviewer(), gateCtx: { appRole: 'admin' } })

const makeCtx = (caps, { gateway = { state: 'reached', name: 'Studio NAS', address: '192.168.1.10:8443', reached: [{ id: 'g1', door: 'inside' }] }, door = 'inside', tickets = {}, lapsed = {}, over = {} } = {}) => {
  const held = new Map(Object.entries(tickets))
  const ctx = {
    supportsBins: true, activeProjectId: 'p1', project: { fps: 24 }, authUserId: 'f1c70000-0002-4000-8000-000000000003',
    bins: [{ id: 'b1', name: 'Day 1', parent_bin_id: null, color: null, sort_order: 0 }],
    binFiles: rowsFor(),
    binRoots: [], binLocations: [{ id: 'L1', name: 'Footage NAS', unc_path: '\\\\nas\\footage' }, { id: 'L2', name: 'Archive', unc_path: '\\\\nas\\archive' }],
    scenes: [], shots: [{ id: 'sh1', name: 'Shot 1', shot_number: 1, scene_id: null }], shotTakes: [],
    binsInfo: {
      ffmpeg: false, capabilities: caps, gateway, ticketsRev: 0,
      locations: caps.stream ? [{ id: 'L1', status: 'gateway', reachable: true, gateway: 'reachable', gateway_name: 'Studio NAS', door }, { id: 'L2', status: 'gateway', reachable: false, gateway: 'not_mounted', gateway_name: 'Studio NAS', door: null }] : [],
    },
    refreshBins: vi.fn(async () => null), undo: vi.fn(), redo: vi.fn(),
    updateBinFile: vi.fn(async () => {}), bulkUpdateBinFiles: vi.fn(async () => {}), removeBinFiles: vi.fn(async () => {}),
    pickBinFiles: vi.fn(async () => ({ paths: [] })), pickBinFolder: vi.fn(async () => ({ path: null })), prepareBinFiles: vi.fn(async () => ({ items: [] })),
    addBin: vi.fn(async (b) => ({ id: 'b9', ...b })), openBinFile: vi.fn(async () => {}), probeBinFile: vi.fn(async () => {}),
    binFileThumbnailUrl: vi.fn(() => null),
    binFileStreamUrl: vi.fn((id) => (caps.stream && held.has(id) ? `https://192.168.1.10:8443/v1/clips/${id}?t=${held.get(id)}` : null)),
    ensureBinTickets: vi.fn(async () => {}),
    gatewayStreamInfo: vi.fn((id) => ({ door: caps.stream ? door : null, jti: held.has(id) || lapsed[id] ? 'j' : null, held: held.has(id), lapsedUrl: lapsed[id] ? `https://192.168.1.10:8443/v1/clips/${id}?t=${lapsed[id]}` : null, refused: null, missing: false, pending: false })),
    renewGatewayStream: vi.fn(async () => ({ ok: true })), freshGatewayStreamUrl: vi.fn(async () => null), diagnoseGatewayClip: vi.fn(async () => ({ verdict: 'ok' })),
    refreshGateways: vi.fn(async () => null),
    remoteViewsOfClip: vi.fn(async () => ({ count: 2, unverified: 0, last: { actor_label: 'Priya Raman', created_at: '2026-10-09T15:00:00Z' } })),
    listRemoteViewingsOfClip: vi.fn(async () => ({ ok: true, data: { rows: [{ id: 1, file_name: 'C000.mp4', project_title: 'Salt Hours', actor_label: 'Priya Raman', created_at: '2026-10-09T15:00:00Z', details: { bytes: 950, clip_bytes: 1000, fraction: 0.95, fraction_from: 'coverage', read_in_full: true, source_address: '203.0.113.7', via: 'cloudflare', gateway_name: 'Studio NAS' } }], total: 1 } })),
    ...over,
  }
  return ctx
}
const people = [{ user_id: 'f1c70000-0002-4000-8000-000000000003', display_name: 'Priya Nair' }]
const mount = async (caps, access = reviewer(), opts = {}) => {
  state.ctx = makeCtx(caps, opts); state.access = access
  render(<BinsView pageActive people={people} />)
  await act(async () => {})
}
const tiles = () => [...document.querySelectorAll('[role="gridcell"]')]
const pick = (name) => fireEvent.click(tiles().find(t => t.textContent.includes(name)))
const key = (init) => act(async () => { fireEvent.keyDown(document.body, init) })
const notice = () => document.querySelector('[data-testid="catalogue-notice"]')
const lines = () => [...document.querySelectorAll('[data-testid="gateway-line"]')].map(e => e.textContent)

describe('§2: the notice and its four states', () => {
  it('a gateway reached: the gateway sentence, no state line, New bin stays, no Add', async () => {
    await mount(REACHED)
    expect(notice().textContent).toContain(W.CATALOGUE_GATEWAY_SENTENCE)
    expect(notice().textContent).not.toContain(W.CATALOGUE_SENTENCE)
    expect(lines()).toEqual([])
    expect(screen.getAllByRole('button', { name: /New bin/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull()
  })
  it('no gateway: the plain catalogue sentence; the admin\'s extra line for an admin only', async () => {
    await mount(CATALOGUE, admin(), { gateway: { state: 'none', name: null, reached: [] } })
    expect(notice().textContent).toContain(W.CATALOGUE_SENTENCE)
    expect(lines()).toEqual([W.GATEWAY_ADMIN_LINE])
    cleanup()
    await mount(CATALOGUE, reviewer(), { gateway: { state: 'none', name: null, reached: [] } })
    expect(lines()).toEqual([])
  })
  it('not seen for over 30 s: the sentence with the name and the minutes; unreachable from this browser: the certificate sentence and the own-computer line', async () => {
    await mount(CATALOGUE, reviewer(), { gateway: { state: 'unseen', name: 'Studio NAS', unseenSeconds: 240, reached: [] } })
    expect(lines()).toEqual([W.gatewayUnseenSentence('Studio NAS', 240)])
    expect(lines()[0]).toContain('has not answered WILSON for 4 minutes')
    cleanup()
    await mount(CATALOGUE, reviewer(), { gateway: { state: 'unreachable', name: 'Studio NAS', address: '192.168.1.10:8443', reached: [] } })
    expect(lines()).toEqual([W.gatewayUnreachableSentence('Studio NAS', '192.168.1.10:8443'), W.GATEWAY_OWN_COMPUTER_LINE])
    expect(lines()[0]).toContain("the gateway's certificate must be installed on this computer")
  })
  it('while the first probe runs: Chrome\'s local-network sentence above it', async () => {
    await mount(CATALOGUE, reviewer(), { gateway: { state: 'probing', name: 'Studio NAS', reached: [] } })
    expect(lines()).toEqual([W.CHROME_LOCAL_NETWORK_SENTENCE])
  })
  it('the notice dismissed, a silent or unreachable gateway still says so in its own strip; a reached one says nothing', async () => {
    await mount(CATALOGUE, reviewer(), { gateway: { state: 'unseen', name: 'Studio NAS', unseenSeconds: 120, reached: [] } })
    fireEvent.click(within(notice()).getByTitle('Got it'))
    expect(notice()).toBeNull()
    expect(document.querySelector('[data-testid="gateway-notice"]').textContent).toContain('has not answered WILSON')
    cleanup()
    await mount(REACHED)
    fireEvent.click(within(notice()).getByTitle('Got it'))
    expect(document.querySelector('[data-testid="gateway-notice"]')).toBeNull()
  })
})

describe('the dim and the counts return; the count is a count', () => {
  it('a reached gateway: the offline row is dimmed, the toolbar counts it, and the count opens no relink', async () => {
    await mount(REACHED)
    const archive = tiles().find(t => t.textContent.includes('Archive 2'))
    expect(archive.getAttribute('data-offline')).toBe('true')
    const count = document.querySelector('[data-testid="gateway-offline-count"]')
    expect(count.textContent).toContain(`1 ${W.NOT_ON_THIS_COMPUTER}`)
    expect(count.tagName).toBe('SPAN')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('CONTROL: the catalogue (no door yet) dims nothing and counts nothing', async () => {
    await mount(CATALOGUE, reviewer(), { over: { binFiles: rowsFor().map(r => ({ ...r, online: false })) } })
    expect(tiles().every(t => t.getAttribute('data-offline') === null)).toBe(true)
    expect(document.querySelector('[data-testid="gateway-offline-count"]')).toBeNull()
  })
})

describe('the inspector through the gateway (§5, §7; D22)', () => {
  it('a playable clip asks for ONE ticket when selected and shows the picture and loading; with the URL it plays through GatewayVideo', async () => {
    await mount(REACHED)
    pick('Proxy 0')
    await waitFor(() => expect(state.ctx.ensureBinTickets).toHaveBeenCalledWith(['f0']))
    expect(state.ctx.ensureBinTickets).toHaveBeenCalledTimes(1)
    const preview = document.querySelector('[data-testid="gateway-preview"]')
    expect(preview).toBeTruthy()
    expect(preview.querySelector('[data-testid="gateway-loading"]').textContent).toBe(W.GATEWAY_LOADING)
    expect(preview.querySelector('video')).toBeNull()
    cleanup()
    await mount(REACHED, reviewer(), { tickets: { f0: 'v1.a.b' } })
    pick('Proxy 0')
    const v = document.querySelector('[data-testid="gateway-preview"] video')
    expect(v.getAttribute('src')).toBe('https://192.168.1.10:8443/v1/clips/f0?t=v1.a.b')
    expect(v.getAttribute('controlslist')).toContain('nodownload')
    expect(state.ctx.ensureBinTickets).not.toHaveBeenCalled()
  })
  it('round 1, finding 3: the provider updating (new callbacks, a ticket landing elsewhere) never asks again for the selected clip\'s ticket', async () => {
    state.ctx = makeCtx(REACHED); state.access = reviewer()
    const { rerender } = render(<BinsView pageActive people={people} />)
    await act(async () => {})
    pick('Proxy 0')
    await waitFor(() => expect(state.ctx.ensureBinTickets).toHaveBeenCalledTimes(1))
    const ask = state.ctx.ensureBinTickets
    for (let i = 1; i <= 3; i++) {
      // A provider update: every verb a new function, the tickets' revision moved.
      state.ctx = { ...state.ctx, ensureBinTickets: ask, renewGatewayStream: vi.fn(), freshGatewayStreamUrl: vi.fn(), diagnoseGatewayClip: vi.fn(), binsInfo: { ...state.ctx.binsInfo, ticketsRev: i } }
      rerender(<BinsView pageActive people={people} />)
      await act(async () => {})
    }
    expect(ask).toHaveBeenCalledTimes(1)
  })
  it('a ProRes .mov keeps its picture with NEEDS_DESKTOP_FORMAT and asks for no ticket (G7, D8)', async () => {
    await mount(REACHED)
    pick('Master 1')
    await act(async () => {})
    const panel = document.querySelector('[data-testid="needs-desktop-format"]')
    expect(panel.textContent).toContain(W.NEEDS_DESKTOP_FORMAT)
    expect(panel.textContent).toContain('ProRes 422 HQ')
    expect(state.ctx.ensureBinTickets).not.toHaveBeenCalled()
  })
  it('a clip on a location the gateway cannot reach says the gateway\'s word, naming the location (§2\'s fourth row)', async () => {
    await mount(REACHED)
    pick('Archive 2')
    const panel = document.querySelector('[data-testid="not-here"]')
    expect(panel.textContent).toContain(W.gatewayClipSentence('Archive', 'not_mounted'))
    expect(panel.textContent).toContain('not mounted on the gateway')
    expect(state.ctx.ensureBinTickets).not.toHaveBeenCalled()
  })
  it('no door yet: the sentence by the tab\'s state, with the Space hint', async () => {
    await mount(CATALOGUE, reviewer(), { gateway: { state: 'unreachable', name: 'Studio NAS', reached: [] }, over: { binFiles: rowsFor().map(r => ({ ...r, online: false })) } })
    pick('Proxy 0')
    const panel = document.querySelector('[data-testid="not-here"]')
    expect(panel.textContent).toContain(W.gatewayClipSentence('Footage NAS', 'gateway_unreachable'))
    expect(panel.textContent).toContain(W.POSTER_LARGE_HINT)
  })
  it('the mark is over the inspector\'s player when the door is outside, over the large player with it, and not inside (D9)', async () => {
    await mount(REACHED, reviewer(), { door: 'outside', tickets: { f0: 'v1.a.b' } })
    pick('Proxy 0')
    const m = document.querySelector('[data-testid="gateway-preview"] [data-testid="viewer-mark"]')
    expect(m.textContent).toMatch(/^Priya Nair · f1c700 · \d\d:\d\d$/)
    await key({ key: ' ', code: 'Space' })
    const large = document.querySelector('[data-testid="poster-large"][data-plays="true"]')
    expect(large.querySelector('[data-testid="viewer-mark"]').textContent).toMatch(/^Priya Nair · f1c700 · \d\d:\d\d$/)
    await key({ key: 'Escape' })
    cleanup()
    await mount(REACHED, reviewer(), { door: 'inside', tickets: { f0: 'v1.a.b' } })
    pick('Proxy 0')
    expect(document.querySelector('[data-testid="viewer-mark"]')).toBeNull()
  })
  it('a row the gateway answered 404 for says it is missing at its path', async () => {
    await mount(REACHED, reviewer(), { over: { binFiles: rowsFor().map(r => (r.id === 'f0' ? { ...r, online: false, gateway_missing: true } : r)) } })
    pick('Proxy 0')
    expect(document.querySelector('[data-testid="not-here"]').textContent).toContain(W.gatewayMissingSentence('Footage NAS'))
  })
})

describe('round 1\'s corrections, the tab', () => {
  it('finding 7: the player already showing a clip keeps the URL of its ticket that lapsed while it sat idle (no new mint until it plays again)', async () => {
    state.ctx = makeCtx(REACHED, { tickets: { f0: 'v1.cur.t' } }); state.access = reviewer()
    const { rerender } = render(<BinsView pageActive people={people} />)
    await act(async () => {})
    pick('Proxy 0')
    await act(async () => {})
    const url = 'https://192.168.1.10:8443/v1/clips/f0?t=v1.cur.t'
    expect(document.querySelector('[data-testid="gateway-preview"] video').getAttribute('src')).toBe(url)
    // The ticket lapses while the player sits idle: no longer held, offered as lapsed.
    const ask = state.ctx.ensureBinTickets
    state.ctx = {
      ...state.ctx,
      binFileStreamUrl: vi.fn(() => null),
      gatewayStreamInfo: vi.fn((id) => ({ door: 'inside', jti: 'j', held: false, lapsedUrl: id === 'f0' ? url : null, refused: null, missing: false, pending: false })),
      binsInfo: { ...state.ctx.binsInfo, ticketsRev: 1 },
    }
    rerender(<BinsView pageActive people={people} />)
    await act(async () => {})
    expect(document.querySelector('[data-testid="gateway-preview"] video').getAttribute('src')).toBe(url)
    expect(ask).not.toHaveBeenCalled()
  })
  it('finding 7, the other side: a player that was not showing the clip never starts on a lapsed URL (a clip selected minutes after its tile was hovered; Space\'s large player) — it asks for a fresh ticket', async () => {
    await mount(REACHED, reviewer(), { lapsed: { f0: 'v1.old.t' } })
    pick('Proxy 0')
    await waitFor(() => expect(state.ctx.ensureBinTickets).toHaveBeenCalledWith(['f0']))
    expect(document.querySelector('[data-testid="gateway-preview"] video')).toBeNull()
    await key({ key: ' ', code: 'Space' })
    expect(document.querySelector('[data-testid="poster-large"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="poster-large"] video')).toBeNull()
    expect(state.ctx.ensureBinTickets.mock.calls.every(([ids]) => ids.length === 1 && ids[0] === 'f0')).toBe(true)
  })
  it('note 11: a tile whose scrub element failed scrubs again on the next hover', async () => {
    await mount(REACHED, reviewer(), { tickets: { f3: 'v1.a.b' } })
    const t = tiles().find(x => x.textContent.includes('Proxy 3'))
    fireEvent.mouseEnter(t)
    await act(async () => {})
    fireEvent.error(t.querySelector('video'))
    await act(async () => {})
    expect(t.querySelector('video')).toBeNull()
    fireEvent.mouseLeave(t)
    fireEvent.mouseEnter(t)
    await act(async () => {})
    expect(t.querySelector('video')).toBeTruthy()
  })
})

describe('tickets on hover and for a played selection, never on mount (R12)', () => {
  it('the grid mounts without a ticket call; entering a playable tile asks for its ticket; an offline tile asks for none', async () => {
    await mount(REACHED)
    expect(state.ctx.ensureBinTickets).not.toHaveBeenCalled()
    fireEvent.mouseEnter(tiles().find(t => t.textContent.includes('Proxy 3')))
    await waitFor(() => expect(state.ctx.ensureBinTickets).toHaveBeenCalledWith(['f3']))
    fireEvent.mouseEnter(tiles().find(t => t.textContent.includes('Archive 2')))
    await act(async () => {})
    expect(state.ctx.ensureBinTickets).toHaveBeenCalledTimes(1)
  })
  it('a selection of several playable clips asks for its batch (the ProRes one left out)', async () => {
    await mount(REACHED)
    pick('Proxy 0')
    fireEvent.click(tiles().find(t => t.textContent.includes('Proxy 3')), { shiftKey: true })
    await waitFor(() => expect(state.ctx.ensureBinTickets).toHaveBeenCalledWith(['f0', 'f3']))
  })
  it('a scrub through the OUTSIDE door carries the mark over the tile; through the office door none; the tile\'s element has no picture-in-picture', async () => {
    await mount(REACHED, reviewer(), { door: 'outside', tickets: { f3: 'v1.a.b' } })
    const t = tiles().find(x => x.textContent.includes('Proxy 3'))
    fireEvent.mouseEnter(t)
    await act(async () => {})
    const v = t.querySelector('video')
    expect(v).toBeTruthy()
    expect(v.getAttribute('src')).toBe('https://192.168.1.10:8443/v1/clips/f3?t=v1.a.b')
    expect(v.hasAttribute('disablepictureinpicture')).toBe(true)
    expect(t.querySelector('[data-testid="viewer-mark"]').textContent).toMatch(/^Priya Nair · f1c700 · \d\d:\d\d$/)
    cleanup()
    await mount(REACHED, reviewer(), { door: 'inside', tickets: { f3: 'v1.a.b' } })
    const t2 = tiles().find(x => x.textContent.includes('Proxy 3'))
    fireEvent.mouseEnter(t2)
    await act(async () => {})
    expect(t2.querySelector('video')).toBeTruthy()
    expect(t2.querySelector('[data-testid="viewer-mark"]')).toBeNull()
  })
  it('CONTROL: the catalogue (no door) asks for nothing on hover', async () => {
    await mount(CATALOGUE)
    fireEvent.mouseEnter(tiles()[0])
    await act(async () => {})
    expect(state.ctx.ensureBinTickets).not.toHaveBeenCalled()
  })
})

describe('Space: the large PLAYER where the clip streams (§7)', () => {
  it('opens the large view as the player, autoplaying through the gateway; Esc closes it; the inspector\'s preview leaves Space alone', async () => {
    await mount(REACHED, reviewer(), { tickets: { f0: 'v1.a.b' } })
    pick('Proxy 0')
    const inspectorVideo = document.querySelector('[data-testid="gateway-preview"] video')
    const play = vi.spyOn(inspectorVideo, 'play').mockImplementation(async () => {})
    await key({ key: ' ', code: 'Space' })
    const large = document.querySelector('[data-testid="poster-large"]')
    expect(large.getAttribute('data-plays')).toBe('true')
    const v = large.querySelector('video')
    expect(v.getAttribute('src')).toBe('https://192.168.1.10:8443/v1/clips/f0?t=v1.a.b')
    expect(v.hasAttribute('autoplay')).toBe(true)
    expect(play).not.toHaveBeenCalled()
    await key({ key: 'Escape' })
    expect(document.querySelector('[data-testid="poster-large"]')).toBeNull()
  })
  it('a format that does not play opens the picture large with the sentence', async () => {
    await mount(REACHED)
    pick('Master 1')
    await key({ key: ' ', code: 'Space' })
    const large = document.querySelector('[data-testid="poster-large"]')
    expect(large.getAttribute('data-plays')).toBeNull()
    expect(large.querySelector('video')).toBeNull()
    expect(large.textContent).toContain(W.NEEDS_DESKTOP_FORMAT)
  })
})

describe('§2: the view read again every 60 s while the tab is on screen', () => {
  it('refreshGateways fires at 60 s and 120 s; not when the page is not on screen', async () => {
    vi.useFakeTimers()
    state.ctx = makeCtx(REACHED); state.access = reviewer()
    render(<BinsView pageActive people={people} />)
    await act(async () => {})
    act(() => { vi.advanceTimersByTime(GATEWAY_REFRESH_MS) })
    expect(state.ctx.refreshGateways).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(GATEWAY_REFRESH_MS) })
    expect(state.ctx.refreshGateways).toHaveBeenCalledTimes(2)
    cleanup()
    state.ctx = makeCtx(REACHED)
    render(<BinsView pageActive={false} people={people} />)
    await act(async () => {})
    act(() => { vi.advanceTimersByTime(GATEWAY_REFRESH_MS * 2) })
    expect(state.ctx.refreshGateways).not.toHaveBeenCalled()
  })
})

describe('item 5: the viewings table filtered to the clip, for an admin', () => {
  it('the inspector\'s line is a button for an admin; it opens the table with the clip\'s rows; a member gets the line, not the button', async () => {
    await mount(REACHED, admin(), { tickets: { f0: 'v1.a.b' } })
    pick('Proxy 0')
    const line = await screen.findByTestId('bin-remote-views')
    expect(line.tagName).toBe('BUTTON')
    expect(line.textContent).toBe('Viewed from outside twice, last by Priya on 9 Oct')
    fireEvent.click(line)
    const dialog = await screen.findByTestId('clip-remote-viewings')
    await waitFor(() => expect(dialog.querySelector('[data-testid="clip-viewings-table"]')).toBeTruthy())
    expect(screen.getByText('Viewed from outside the office: Proxy 0')).toBeTruthy()
    expect(state.ctx.listRemoteViewingsOfClip).toHaveBeenCalledWith('f0', { page: 0, pageSize: 25 })
    expect(dialog.textContent).toContain('Priya Raman')
    expect(dialog.textContent).toContain('950 B of 1000 B (95% covered) · read in full')
    expect(dialog.textContent).toContain('Cloudflare Tunnel')
    // The Settings table on this dark ground takes the dark ground's ink (settings.css, by this stamp).
    expect(dialog.querySelector('[data-testid="clip-viewings-table"]').getAttribute('data-surface')).toBe('dark')
    // One page of 25: no Newer / Older.
    expect(screen.queryByRole('button', { name: 'Older' })).toBeNull()
    cleanup()
    // More than a page: Older asks for page 1 of the same clip.
    await mount(REACHED, admin(), { tickets: { f0: 'v1.a.b' }, over: { listRemoteViewingsOfClip: vi.fn(async (id, { page }) => ({ ok: true, data: { rows: [{ id: 100 - page, file_name: 'C000.mp4', project_title: 'Salt Hours', actor_label: page ? 'Mara Okonkwo' : 'Priya Raman', created_at: '2026-10-09T15:00:00Z', details: {} }], total: 30 } })) } })
    pick('Proxy 0')
    fireEvent.click(await screen.findByTestId('bin-remote-views'))
    const dialog2 = await screen.findByTestId('clip-remote-viewings')
    await waitFor(() => expect(dialog2.textContent).toContain('Priya Raman'))
    expect(screen.getByText('1–25 of 30')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Older' }))
    await waitFor(() => expect(dialog2.textContent).toContain('Mara Okonkwo'))
    expect(state.ctx.listRemoteViewingsOfClip).toHaveBeenLastCalledWith('f0', { page: 1, pageSize: 25 })
    expect(screen.getByText('26–30 of 30')).toBeTruthy()
    cleanup()
    await mount(REACHED, reviewer(), { tickets: { f0: 'v1.a.b' } })
    pick('Proxy 0')
    await act(async () => {})
    expect(screen.queryByTestId('bin-remote-views')).toBeNull()
    expect(state.ctx.remoteViewsOfClip).not.toHaveBeenCalled()
  })
})
