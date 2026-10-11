// =============================================================================
// gatewayBins.test.js — GW3: the gateway composite over the cloud adapter
// (adapters/gatewayBins.js; GATEWAY_DESIGN.md §2, §5, §7; D17, D22; R12).
//
// What this pins, with the cloud, the view, the tickets and the doors all
// faked and the clock injected:
//   * the capability object is the cloud's catalogue until a door answers,
//     then `stream` and `resolveFiles` turn on together, the keys unchanged;
//   * discovery: the view read, every gateway probed once per page session,
//     the first answer kept; a gateway gone from the view loses its door; a
//     gateway that did not answer is probed again on the next read;
//   * `online` per row from the reach a REACHED gateway reports for the
//     clip's location; with several gateways, one that reports the location
//     reachable (D17); the words per location (§2's fourth row) and the tab's
//     state (none / probing / unseen / unreachable / reached);
//   * the tickets: at most fifty ids a call, grouped by gateway, held while
//     their end is more than 30 s off, a `missing` id backed off, a `refused`
//     id refused, an in-flight id never asked twice; the stream URL is the
//     door's, with the ticket; null until a ticket is held;
//   * the renewal posts the stream's FIRST jti with a fresh ticket and the
//     URL stays; a fresh URL never reuses a ticket; the diagnosis maps the
//     HEAD's status to a verdict a <video> could not give.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import { composeGatewayBins, GATEWAY_BINS_CAPABILITIES, UNSEEN_AFTER_MS } from './gatewayBins'

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url')
let minted = 0
const ticketFor = (id, { exp, jti } = {}) => `v1.${b64url(JSON.stringify({ v: 1, clip: id, jti: jti || `jti${++minted}`, exp: exp ?? 1791633700 }))}.${b64url('sig')}`
const NOW = 1791633600 * 1000 // the vectors' now; a ticket's exp is 100 s off

const L1 = 'loc-1', L2 = 'loc-2'
const rows = () => [
  { id: 'c1', location_id: L1, relative_path: 'A001/c1.mp4', extension: '.mp4' },
  { id: 'c2', location_id: L2, relative_path: 'B/c2.mp4', extension: '.mp4' },
  { id: 'c3', location_id: L1, relative_path: 'A001/c3.mov', extension: '.mov' },
  { id: 'd1', source_path: 'D:\\x.mov' },
]
const gw = (over = {}) => ({ id: 'g1', name: 'Studio NAS', inside_addresses: [{ host: '192.168.1.10', port: 8443 }], outside_address: null, reach: { [L1]: 'reachable', [L2]: 'not_mounted' }, last_seen_at: new Date(NOW - 4000).toISOString(), ...over })

function world({ gateways = [gw()], probe = null, ticketsImpl = null, clock = { t: NOW }, rowsNow = rows() } = {}) {
  const calls = { list: 0, tickets: [], renew: [], head: [] }
  const cloud = {
    listBins: vi.fn(async () => ({ bins: [], binFiles: rowsNow, binLocations: [{ id: L1, name: 'Footage' }, { id: L2, name: 'Archive' }] })),
    copyBinFiles: vi.fn(async () => ({ created: [{ id: 'c9', location_id: L1 }] })),
    restoreBinFiles: vi.fn(async () => ({ restored: [{ id: 'c1', location_id: L1 }] })),
    binsCapabilities: () => ({ backend: 'supabase' }),
    remoteViewsOfClip: vi.fn(async () => ({ count: 1 })),
  }
  const doors = {
    probe: vi.fn(async (g) => (probe ? probe(g) : (g.inside_addresses?.length ? { door: 'inside', base: `https://${g.inside_addresses[0].host}:8443`, gatewayId: g.id } : null))),
    clipUrl: (base, id, t) => `${base}/v1/clips/${id}?t=${t}`,
    renew: vi.fn(async (base, id, body) => { calls.renew.push({ base, id, ...body }); return { ok: true, status: 204 } }),
    head: vi.fn(async (base, id, ticket) => { calls.head.push({ base, id, ticket }); return { status: 206, door: 'inside' } }),
  }
  const onChange = vi.fn()
  const c = composeGatewayBins(cloud, {
    listGateways: async () => { calls.list++; return { ok: true, data: typeof gateways === 'function' ? gateways() : gateways } },
    fetchTickets: async (gatewayId, ids) => {
      calls.tickets.push({ gatewayId, ids })
      if (ticketsImpl) return ticketsImpl(gatewayId, ids)
      // The cloud mints two minutes from ITS now (the injected clock here).
      const exp = Math.floor(clock.t / 1000) + 120
      return { ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, ticketFor(id, { exp })])), missing: [], refused: [], expires_at: new Date(exp * 1000).toISOString() } }
    },
    doors,
    rowOf: (id) => rowsNow.find((r) => r.id === id) || null,
    onChange,
    now: () => clock.t,
  })
  return { c, cloud, doors, calls, onChange, clock }
}

describe('the capability object', () => {
  it('is the cloud\'s catalogue until a door answers; then stream and resolveFiles turn on together, frozen, the keys unchanged', async () => {
    const { c } = world({ gateways: [] })
    expect(c.binsCapabilities()).toBe(GATEWAY_BINS_CAPABILITIES)
    expect(GATEWAY_BINS_CAPABILITIES).toMatchObject({ backend: 'gateway_cloud', pickFiles: false, probe: false, stream: false, resolveFiles: false, relink: false, openInOs: false, posters: 'cloud', locations: true, remoteViewingSwitch: true })
    const w = world()
    await w.c.discover()
    const caps = w.c.binsCapabilities()
    expect(caps).toMatchObject({ stream: true, resolveFiles: true, pickFiles: false, openInOs: false })
    expect(Object.keys(caps).sort()).toEqual(Object.keys(GATEWAY_BINS_CAPABILITIES).sort())
    expect(Object.isFrozen(caps)).toBe(true)
    expect(w.onChange).toHaveBeenCalled()
  })
  it('the composite keeps every cloud method (Object.create), and marks a copy\'s and a restore\'s rows', async () => {
    const w = world()
    await w.c.discover()
    expect(await w.c.remoteViewsOfClip('c1')).toEqual({ count: 1 })
    expect((await w.c.copyBinFiles('p', ['c1'], 'b')).created[0]).toMatchObject({ id: 'c9', online: true })
    expect((await w.c.restoreBinFiles('p', [])).restored[0]).toMatchObject({ id: 'c1', online: true })
  })
})

describe('discovery (§2)', () => {
  it('reads the view, probes each gateway once per page session, keeps the first answer; a later read does not probe a reached gateway again', async () => {
    const w = world()
    await w.c.discover()
    await w.c.refreshGateways()
    expect(w.calls.list).toBe(2)
    expect(w.doors.probe).toHaveBeenCalledTimes(1)
    expect(w.c.summary()).toMatchObject({ state: 'reached', reached: [{ id: 'g1', door: 'inside', base: 'https://192.168.1.10:8443' }] })
  })
  it('a gateway that did not answer is probed again on the next read; a gateway gone from the view loses its door', async () => {
    let answers = false
    const list = [gw()]
    const w = world({ gateways: () => list, probe: async (g) => (answers ? { door: 'inside', base: 'https://192.168.1.10:8443', gatewayId: g.id } : null) })
    await w.c.discover()
    expect(w.c.summary().state).toBe('unreachable')
    answers = true
    await w.c.refreshGateways()
    expect(w.c.summary().state).toBe('reached')
    expect(w.doors.probe).toHaveBeenCalledTimes(2)
    list.length = 0
    await w.c.refreshGateways()
    expect(w.c.summary()).toMatchObject({ state: 'none', reached: [] })
    expect(w.c.binsCapabilities().stream).toBe(false)
  })
  it('the first listBins of a page session answers the rows at once with the discovery behind them (the Chrome sentence above the first probe); later loads await it', async () => {
    const w = world()
    const first = await w.c.listBins('p')
    expect(first.gateway.state).toBe('probing')
    expect(first.binFiles.find((r) => r.id === 'c1').online).toBe(false)
    expect(first.capabilities.stream).toBe(false)
    await w.c.discover()
    const second = await w.c.listBins('p')
    expect(second.gateway.state).toBe('reached')
    expect(second.binFiles.map((r) => [r.id, r.online])).toEqual([['c1', true], ['c2', false], ['c3', true], ['d1', undefined]])
    expect(second.capabilities.stream).toBe(true)
    expect(second.locationStatus).toEqual([
      { id: L1, status: 'gateway', reachable: true, gateway: 'reachable', gateway_name: 'Studio NAS', door: 'inside' },
      { id: L2, status: 'gateway', reachable: false, gateway: 'not_mounted', gateway_name: 'Studio NAS', door: null },
    ])
  })
  it('the first listBins with NO gateway enrolled (or the view unreadable) ends the probing state: none, never the Chrome sentence for good', async () => {
    const w = world({ gateways: [] })
    const first = await w.c.listBins('p')
    expect(first.gateway.state).toBe('probing')
    await w.c.discover()
    expect(w.c.summary()).toMatchObject({ state: 'none', probing: false, probedOnce: true })
    const unreadable = composeGatewayBins({ listBins: async () => ({ binFiles: [] }) }, { listGateways: async () => ({ ok: false, friendly: 'no' }), fetchTickets: async () => ({ ok: false }), doors: { probe: async () => null, clipUrl: () => null, renew: async () => ({ ok: false }), head: async () => ({ status: 0 }) } })
    await unreadable.listBins('p')
    await unreadable.discover()
    expect(unreadable.summary()).toMatchObject({ state: 'none', probing: false, readError: 'no' })
  })
  it('the tab\'s state: none, unseen (every gateway silent for over 30 s), unreachable (seen, no door), with the name and the first address', async () => {
    expect((await (async () => { const w = world({ gateways: [] }); await w.c.discover(); return w.c.summary() })())).toMatchObject({ state: 'none', name: null })
    const silent = world({ gateways: [gw({ last_seen_at: new Date(NOW - UNSEEN_AFTER_MS - 1000).toISOString() })], probe: async () => null })
    await silent.c.discover()
    expect(silent.c.summary()).toMatchObject({ state: 'unseen', name: 'Studio NAS', unseenSeconds: 31, address: '192.168.1.10:8443' })
    const seen = world({ probe: async () => null })
    await seen.c.discover()
    expect(seen.c.summary()).toMatchObject({ state: 'unreachable', name: 'Studio NAS', address: '192.168.1.10:8443' })
    expect((await seen.c.resolveBinFiles(rows())).get('c1')).toEqual({ online: false, reason: 'gateway_unreachable' })
  })
  it('a view that cannot be read keeps the last doors and says so; a probe that throws is a gateway not reached, never a crash', async () => {
    const w = world({ probe: async () => { throw new Error('boom') } })
    await w.c.discover()
    expect(w.c.summary().state).toBe('unreachable')
    const c2 = composeGatewayBins({ listBins: async () => ({ binFiles: [] }) }, { listGateways: async () => ({ ok: false, friendly: 'no' }), fetchTickets: async () => ({ ok: false }), doors: { probe: async () => null, clipUrl: () => null, renew: async () => ({ ok: false }), head: async () => ({ status: 0 }) } })
    await c2.discover()
    expect(c2.summary()).toMatchObject({ state: 'none', readError: 'no' })
  })
})

describe('online per row and the words per location (§5\'s last paragraph; D17)', () => {
  it('a clip is online when a REACHED gateway reports its location reachable; a location missing from the report is "this gateway cannot use this address"', async () => {
    const w = world({ gateways: [gw({ reach: { [L1]: 'reachable' } })] })
    await w.c.discover()
    expect(w.c.markOnline(rows()).map((r) => r.online)).toEqual([true, false, true, undefined])
    const map = await w.c.resolveBinFiles(rows())
    expect(map.get('c2')).toEqual({ online: false, reason: 'unknown_address' })
    expect(w.c.locationStatus([{ id: L2 }])[0]).toMatchObject({ gateway: 'unknown_address', reachable: false })
  })
  it('with two gateways a clip plays through the one that reports its location reachable, even when the other answered first', async () => {
    const w = world({ gateways: [gw({ id: 'g1', reach: { [L1]: 'not_reachable', [L2]: 'reachable' } }), gw({ id: 'g2', name: 'Annex', inside_addresses: [{ host: '192.168.2.10', port: 8443 }], reach: { [L1]: 'reachable', [L2]: 'not_connected' } })] })
    await w.c.discover()
    await w.c.ensureTickets(['c1', 'c2'])
    expect(w.calls.tickets.map((t) => [t.gatewayId, t.ids])).toEqual([['g2', ['c1']], ['g1', ['c2']]])
    expect(w.c.binFileStreamUrl('p', 'c1')).toMatch(/^https:\/\/192\.168\.2\.10:8443\/v1\/clips\/c1\?t=v1\./)
    expect(w.c.binFileStreamUrl('p', 'c2')).toMatch(/^https:\/\/192\.168\.1\.10:8443\/v1\/clips\/c2\?t=v1\./)
    expect(w.c.streamInfo('c1')).toMatchObject({ gatewayId: 'g2', gatewayName: 'Annex', door: 'inside' })
    // A location both report as not reachable: the first reached gateway's word.
    expect(w.c.locationStatus([{ id: 'loc-9' }])[0].gateway).toBe('unknown_address')
    expect((await w.c.resolveBinFiles([{ id: 'x', location_id: L1 }])).get('x')).toEqual({ online: true })
  })
  it('a row with no location is left as it is (a desktop row); a row whose location nobody reaches is offline with the gateway\'s word', async () => {
    const w = world()
    await w.c.discover()
    const [, c2, , d1] = w.c.markOnline(rows())
    expect(c2.online).toBe(false)
    expect(d1.online).toBeUndefined()
    expect((await w.c.resolveBinFiles([c2])).get('c2')).toEqual({ online: false, reason: 'not_mounted' })
  })
})

describe('the tickets (§5 steps 1–4; R12)', () => {
  it('a held ticket is reused; none is asked for before the doors; an offline row and a desktop row are never asked for', async () => {
    const w = world()
    expect(w.c.binFileStreamUrl('p', 'c1')).toBeNull()
    await w.c.ensureTickets(['c1'])
    expect(w.calls.tickets).toEqual([])
    await w.c.discover()
    await w.c.ensureTickets(['c1', 'c2', 'd1', 'c1'])
    expect(w.calls.tickets).toEqual([{ gatewayId: 'g1', ids: ['c1'] }])
    const url = w.c.binFileStreamUrl('p', 'c1')
    expect(url).toMatch(/^https:\/\/192\.168\.1\.10:8443\/v1\/clips\/c1\?t=v1\./)
    await w.c.ensureTickets(['c1'])
    expect(w.calls.tickets).toHaveLength(1)
    expect(w.c.binFileStreamUrl('p', 'c1')).toBe(url)
    expect(w.c.streamInfo('c1')).toMatchObject({ held: true, door: 'inside', jti: expect.stringMatching(/^jti\d+$/), expiresAt: (1791633600 + 120) * 1000, refused: null, missing: false }) // two minutes from the clock the cloud was asked at
  })
  it('fifty ids a call at most, in order; sixty ids are two calls', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, location_id: L1, relative_path: `m/${i}.mp4` }))
    const w = world({ rowsNow: many })
    await w.c.discover()
    await w.c.ensureTickets(many.map((r) => r.id))
    expect(w.calls.tickets.map((t) => t.ids.length)).toEqual([50, 10])
    expect(w.c.binFileStreamUrl('p', 'm59')).toMatch(/clips\/m59\?t=/)
  })
  it('a ticket within 30 s of its end is not reused: a fresh one is asked for', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    w.clock.t = (1791633600 + 120) * 1000 - 20_000 // 20 s before the held ticket ends
    expect(w.c.binFileStreamUrl('p', 'c1')).toBeNull()
    await w.c.ensureTickets(['c1'])
    expect(w.calls.tickets).toHaveLength(2)
    expect(w.c.binFileStreamUrl('p', 'c1')).not.toBeNull()
  })
  it('a missing id is backed off for a minute, a refused id carries its reason, a failed call backs off 15 s; an in-flight id is never asked twice', async () => {
    let fail = false
    const w = world({ ticketsImpl: async (g, ids) => (fail ? { ok: false, friendly: 'down' } : { ok: true, data: { tickets: {}, missing: ids.filter((i) => i === 'c1'), refused: ids.filter((i) => i === 'c3').map((id) => ({ id, reason: 'not_playable' })), expires_at: null } }) })
    await w.c.discover()
    const a = w.c.ensureTickets(['c1', 'c3'])
    const b = w.c.ensureTickets(['c1', 'c3'])
    await Promise.all([a, b])
    expect(w.calls.tickets).toHaveLength(1)
    expect(w.c.streamInfo('c1')).toMatchObject({ missing: true, held: false })
    expect(w.c.streamInfo('c3')).toMatchObject({ refused: 'not_playable' })
    await w.c.ensureTickets(['c1', 'c3'])
    expect(w.calls.tickets).toHaveLength(1)
    w.clock.t += 61_000
    fail = true
    await w.c.ensureTickets(['c1'])
    expect(w.calls.tickets).toHaveLength(2)
    expect(w.c.streamInfo('c1').ticketError).toBe('down')
    await w.c.ensureTickets(['c1'])
    expect(w.calls.tickets).toHaveLength(2)
    w.clock.t += 16_000
    fail = false
    await w.c.ensureTickets(['c1'])
    expect(w.calls.tickets).toHaveLength(3)
  })
})

describe('the renewal, the fresh URL and the diagnosis (§5 steps 6 and 7)', () => {
  it('renewStream posts the stream\'s FIRST jti with a FRESH ticket; the URL stays; the held end moves to the fresh ticket\'s', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    const url = w.c.binFileStreamUrl('p', 'c1')
    const firstJti = w.c.streamInfo('c1').jti
    expect(await w.c.renewStream('c1')).toEqual({ ok: true, status: 204 })
    expect(w.calls.renew).toHaveLength(1)
    expect(w.calls.renew[0]).toMatchObject({ base: 'https://192.168.1.10:8443', id: 'c1', jti: firstJti })
    expect(w.calls.renew[0].ticket).not.toBe(url.split('t=')[1])
    expect(w.c.binFileStreamUrl('p', 'c1')).toBe(url)
    expect(w.c.streamInfo('c1').jti).toBe(firstJti)
    expect(await w.c.renewStream('c2')).toMatchObject({ ok: false, reason: 'no_stream' })
  })
  it('a refused renewal says so; a ticket the cloud will not mint is a ticket failure', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    w.doors.renew.mockImplementationOnce(async () => ({ ok: false, status: 401 }))
    expect(await w.c.renewStream('c1')).toEqual({ ok: false, status: 401, reason: 'refused' })
    const w2 = world({ ticketsImpl: async (g, ids) => ({ ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, ticketFor(id)])), missing: [], refused: [] } }) })
    await w2.c.discover()
    await w2.c.ensureTickets(['c1'])
    const impl = vi.fn(async () => ({ ok: false, status: 401, friendly: 'Sign in again' }))
    const w3 = world({ ticketsImpl: impl })
    await w3.c.discover()
    expect(await w3.c.renewStream('c1')).toMatchObject({ ok: false, reason: 'no_stream' })
  })
  it('a renewal the cloud refuses (the viewer removed): the clip carries its own error, and the tab is re-read when the held ticket reaches its margin — the URL is gone then, not at some later re-render', async () => {
    vi.useFakeTimers()
    try {
      let refuse = false
      const w = world({ ticketsImpl: async (g, ids) => (refuse
        ? { ok: false, status: 401, code: 'not_signed_in', friendly: 'Sign in again: WILSON could not confirm who is asking for this.' }
        : { ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, ticketFor(id, { exp: Math.floor(w.clock.t / 1000) + 120 })])), missing: [], refused: [], expires_at: null } }) })
      await w.c.discover()
      await w.c.ensureTickets(['c1', 'c3'])
      expect(w.c.binFileStreamUrl('p', 'c1')).not.toBeNull()
      refuse = true
      const before = w.onChange.mock.calls.length
      expect(await w.c.renewStream('c1')).toEqual({ ok: false, status: 401, reason: 'ticket' })
      // c1's own error; c3 (a hovered tile) carries none.
      expect(w.c.streamInfo('c1').ticketError).toBe('Sign in again: WILSON could not confirm who is asking for this.')
      expect(w.c.streamInfo('c3').ticketError).toBeNull()
      // A second failed renewal schedules nothing more.
      await w.c.renewStream('c1')
      // The margin: 120 s − 30 s from the mint. Nothing re-read before it…
      w.clock.t += 89_000
      await vi.advanceTimersByTimeAsync(89_000)
      expect(w.onChange.mock.calls.length).toBe(before)
      expect(w.c.binFileStreamUrl('p', 'c1')).not.toBeNull()
      // …and once at it: the URL is gone, the tab told.
      w.clock.t += 1_100
      await vi.advanceTimersByTimeAsync(1_100)
      expect(w.onChange.mock.calls.length).toBe(before + 1)
      expect(w.c.binFileStreamUrl('p', 'c1')).toBeNull()
      // A renewal the gateway refuses (its own 401) is re-read at the margin too.
      refuse = false
      const w2 = world()
      await w2.c.discover()
      await w2.c.ensureTickets(['c1'])
      w2.doors.renew.mockImplementationOnce(async () => ({ ok: false, status: 401 }))
      const before2 = w2.onChange.mock.calls.length
      await w2.c.renewStream('c1')
      w2.clock.t += 90_100
      await vi.advanceTimersByTimeAsync(90_100)
      expect(w2.onChange.mock.calls.length).toBe(before2 + 1)
      // A successful renewal schedules nothing and clears the clip's error.
      const w3 = world()
      await w3.c.discover()
      await w3.c.ensureTickets(['c1'])
      const before3 = w3.onChange.mock.calls.length
      expect((await w3.c.renewStream('c1')).ok).toBe(true)
      await vi.advanceTimersByTimeAsync(200_000)
      expect(w3.onChange.mock.calls.length).toBe(before3)
      expect(w3.c.streamInfo('c1').ticketError).toBeNull()
    } finally { vi.useRealTimers() }
  })
  it('freshStreamUrl never reuses the ticket: a new ticket, a new URL (a 401 is never retried with the same ticket)', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    const old = w.c.binFileStreamUrl('p', 'c1')
    const fresh = await w.c.freshStreamUrl('c1')
    expect(fresh).not.toBe(old)
    expect(fresh).toMatch(/clips\/c1\?t=v1\./)
    expect(w.calls.tickets).toHaveLength(2)
  })
  it('diagnoseClip: a HEAD on a fresh ticket → ok / missing (404) / ticket (401, the ticket dropped) / format (415) / busy (429) / unreachable (0); no door is no_stream', async () => {
    const w = world()
    await w.c.discover()
    for (const [status, verdict] of [[206, 'ok'], [404, 'missing'], [415, 'format'], [429, 'busy'], [0, 'unreachable'], [500, 'unreachable']]) {
      w.doors.head.mockImplementationOnce(async () => ({ status, door: 'inside' }))
      expect((await w.c.diagnoseClip('c1')).verdict, String(status)).toBe(verdict)
      expect(w.c.streamInfo('c1').held, String(status)).toBe(true) // the fresh ticket stays held: the door, not the ticket, answered
    }
    // Each diagnosis asked a FRESH ticket (never the one that failed).
    expect(w.calls.tickets).toHaveLength(6)
    // A 401 is the ticket's failure: it is dropped, so the next play asks for another.
    w.doors.head.mockImplementationOnce(async () => ({ status: 401, door: 'inside' }))
    expect((await w.c.diagnoseClip('c1')).verdict).toBe('ticket')
    expect(w.c.streamInfo('c1').held).toBe(false)
    expect(await w.c.diagnoseClip('c2')).toEqual({ verdict: 'no_stream', status: 0 })
  })
  it('diagnoseClip with no fresh ticket: the cloud refusing one (the viewer removed, signed out, the switch off) is the TICKET, said as such; a format the cloud refuses is the format', async () => {
    let answer = null
    const w = world({ ticketsImpl: async (g, ids) => answer ? answer(ids) : { ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, ticketFor(id, { exp: Math.floor(NOW / 1000) + 120 })])), missing: [], refused: [], expires_at: null } } })
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    answer = () => ({ ok: false, status: 401, code: 'not_signed_in', friendly: 'Sign in again.' })
    expect(await w.c.diagnoseClip('c1')).toEqual({ verdict: 'ticket', status: 0 })
    expect(w.doors.head).not.toHaveBeenCalled()
    expect(w.c.streamInfo('c1')).toMatchObject({ held: false, ticketError: 'Sign in again.' })
    // The cloud answering (no refusal) but naming no ticket: nothing plays, said plainly.
    answer = () => ({ ok: true, data: { tickets: {}, missing: ['c1'], refused: [], expires_at: null } })
    expect((await w.c.diagnoseClip('c1')).verdict).toBe('no_stream')
    // A format the cloud refuses is the format (and stays so: the refusal is remembered).
    answer = (ids) => ({ ok: true, data: { tickets: {}, missing: [], refused: ids.map((id) => ({ id, reason: 'not_playable' })), expires_at: null } })
    w.clock.t += 61_000 // past the missing minute of backoff
    expect((await w.c.diagnoseClip('c1')).verdict).toBe('format')
    expect(await w.c.diagnoseClip('d1')).toEqual({ verdict: 'no_stream', status: 0 })
  })
})
