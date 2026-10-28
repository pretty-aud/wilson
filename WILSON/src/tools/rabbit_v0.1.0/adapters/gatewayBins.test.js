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
import { composeGatewayBins, GATEWAY_BINS_CAPABILITIES, UNSEEN_AFTER_MS, NO_TICKET, DOOR_REFUSED_FRESH } from './gatewayBins'

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url')
let minted = 0
const ticketFor = (id, { exp, jti, iat, sub } = {}) => `v1.${b64url(JSON.stringify({ v: 1, ...(sub ? { sub } : {}), clip: id, ...(iat != null ? { iat } : {}), jti: jti || `jti${++minted}`, exp: exp ?? 1791633700 }))}.${b64url('sig')}`
const NOW = 1791633600 * 1000 // the vectors' now; a ticket's exp is 100 s off

const L1 = 'loc-1', L2 = 'loc-2'
// P8 (0104, TPN-AUTH-012): a company's row plays through the gateway only
// with the checked mark (vetted_at); the rows here carry it, and one test
// below takes it away.
const VETTED = '2026-10-28T00:00:00.000Z'
const rows = () => [
  { id: 'c1', location_id: L1, relative_path: 'A001/c1.mp4', extension: '.mp4', vetted_at: VETTED },
  { id: 'c2', location_id: L2, relative_path: 'B/c2.mp4', extension: '.mp4', vetted_at: VETTED },
  { id: 'c3', location_id: L1, relative_path: 'A001/c3.mov', extension: '.mov', vetted_at: VETTED },
  { id: 'd1', source_path: 'D:\\x.mov' },
]
const gw = (over = {}) => ({ id: 'g1', name: 'Studio NAS', inside_addresses: [{ host: '192.168.1.10', port: 8443 }], outside_address: null, reach: { [L1]: 'reachable', [L2]: 'not_mounted' }, last_seen_at: new Date(NOW - 4000).toISOString(), ...over })

function world({ gateways = [gw()], probe = null, ticketsImpl = null, clock = { t: NOW }, rowsNow = rows(), userId = null } = {}) {
  const calls = { list: 0, tickets: [], renew: [], head: [] }
  const cloud = {
    listBins: vi.fn(async () => ({ bins: [], binFiles: rowsNow, binLocations: [{ id: L1, name: 'Footage' }, { id: L2, name: 'Archive' }] })),
    copyBinFiles: vi.fn(async () => ({ created: [{ id: 'c9', location_id: L1, vetted_at: VETTED }] })),
    restoreBinFiles: vi.fn(async () => ({ restored: [{ id: 'c1', location_id: L1, vetted_at: VETTED }] })),
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
    userId,
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
  it('the OUTSIDE door, when that is what answered: the summary, the location and the stream say outside (the mark\'s cue), and the URL is the outside address\'s; any other word is the inside door', async () => {
    const w = world({ gateways: [gw({ inside_addresses: [], outside_address: { host: 'gateway.example.com', port: 8444 } })], probe: async (g) => ({ door: 'outside', base: 'https://gateway.example.com:8444', gatewayId: g.id }) })
    await w.c.discover()
    expect(w.c.summary().reached).toEqual([{ id: 'g1', name: 'Studio NAS', door: 'outside', base: 'https://gateway.example.com:8444' }])
    expect(w.c.locationStatus([{ id: L1 }])[0]).toMatchObject({ reachable: true, door: 'outside' })
    await w.c.ensureTickets(['c1'])
    expect(w.c.streamInfo('c1')).toMatchObject({ door: 'outside', base: 'https://gateway.example.com:8444' })
    expect(w.c.binFileStreamUrl('p', 'c1')).toMatch(/^https:\/\/gateway\.example\.com:8444\/v1\/clips\/c1\?t=/)
    // A probe answer naming no known door is the inside one (never the outside by default: no mark where none is due).
    const odd = world({ probe: async (g) => ({ door: 'sideways', base: 'https://192.168.1.10:8443', gatewayId: g.id }) })
    await odd.c.discover()
    expect(odd.c.summary().reached[0].door).toBe('inside')
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
    expect((await w.c.resolveBinFiles([{ id: 'x', location_id: L1, vetted_at: VETTED }])).get('x')).toEqual({ online: true })
  })
  it('P8 (0104, TPN-AUTH-012): a row without the checked mark is offline with its own reason, flagged not_checked, and never asked for a ticket', async () => {
    const unchecked = () => rows().map((r) => (r.id === 'c1' ? { ...r, vetted_at: null } : r))
    const w = world({ rowsNow: unchecked() })
    await w.c.discover()
    const marked = w.c.markOnline(unchecked())
    expect(marked[0]).toMatchObject({ id: 'c1', online: false, not_checked: true })
    expect(marked[2]).toMatchObject({ id: 'c3', online: true })
    expect(marked[2].not_checked).toBeUndefined()
    expect((await w.c.resolveBinFiles([{ id: 'c1', location_id: L1, vetted_at: null }])).get('c1')).toEqual({ online: false, reason: 'not_checked' })
    // The reach word is the location's, not the row's: c3 at the same location plays.
    expect((await w.c.resolveBinFiles([{ id: 'c3', location_id: L1, vetted_at: VETTED }])).get('c3')).toEqual({ online: true })
    await w.c.ensureTickets(['c1', 'c3'])
    expect(w.calls.tickets.map((t) => t.ids)).toEqual([['c3']])
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
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, location_id: L1, relative_path: `m/${i}.mp4`, vetted_at: VETTED }))
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
  it('a refused renewal says so; a ticket the cloud will not mint is a ticket failure (round 1, note 14: the second half now holds a ticket first)', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    w.doors.renew.mockImplementationOnce(async () => ({ ok: false, status: 401 }))
    expect(await w.c.renewStream('c1')).toEqual({ ok: false, status: 401, reason: 'refused' })
    let refuse = false
    const w3 = world({ ticketsImpl: async (g, ids) => (refuse ? { ok: false, status: 401, friendly: 'Sign in again' } : { ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, ticketFor(id, { exp: Math.floor(w3.clock.t / 1000) + 120 })])), missing: [], refused: [] } }) })
    await w3.c.discover()
    await w3.c.ensureTickets(['c1'])
    refuse = true
    expect(await w3.c.renewStream('c1')).toEqual({ ok: false, status: 401, reason: 'ticket' })
    expect(w3.doors.renew).not.toHaveBeenCalled()
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
  it('a failed renewal backs the clip off: a retry within 15 s asks the cloud nothing; the good one after clears the clip\'s error', async () => {
    let refuse = false
    const w = world({ ticketsImpl: async (g, ids) => (refuse
      ? { ok: false, status: 503, friendly: 'The cloud is busy.' }
      : { ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, ticketFor(id, { exp: Math.floor(w.clock.t / 1000) + 120 })])), missing: [], refused: [], expires_at: null } }) })
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    refuse = true
    expect((await w.c.renewStream('c1')).ok).toBe(false)
    expect(w.c.streamInfo('c1').ticketError).toBe('The cloud is busy.')
    const calls = w.calls.tickets.length
    refuse = false
    expect(await w.c.renewStream('c1')).toEqual({ ok: false, status: 0, reason: 'backoff' })
    expect(w.calls.tickets).toHaveLength(calls)
    w.clock.t += 15_001
    expect((await w.c.renewStream('c1')).ok).toBe(true)
    expect(w.c.streamInfo('c1')).toMatchObject({ ticketError: null, renewFailed: false })
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
  it('diagnoseClip asks the door with the ELEMENT\'s own ticket first (round 1, finding 6): 2xx is the decode (ok), 404 missing (backed off a minute), 415 the format, 429 busy — no mint for any of them', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    const own = w.c.binFileStreamUrl('p', 'c1').split('t=')[1]
    for (const [status, verdict] of [[206, 'ok'], [415, 'format'], [429, 'busy'], [404, 'missing']]) {
      w.doors.head.mockImplementationOnce(async () => ({ status, door: 'inside' }))
      expect((await w.c.diagnoseClip('c1')).verdict, String(status)).toBe(verdict)
      expect(w.doors.head.mock.calls.at(-1)[2], String(status)).toBe(own)
    }
    expect(w.calls.tickets).toHaveLength(1) // the first mint only
    expect(w.c.streamInfo('c1').missing).toBe(true) // the 404's minute
    expect(await w.c.diagnoseClip('c2')).toEqual({ verdict: 'no_stream', status: 0 })
  })
  it('the element\'s own ticket refused (401) once it AGED is the TICKET: it is dropped, so the player\'s one fresh src follows; a later diagnosis with no ticket of its own mints and HEADs the fresh one', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    w.clock.t += 95_000 // past its first hold: the lapsed ticket of an idle player
    w.doors.head.mockImplementationOnce(async () => ({ status: 401, door: 'inside' }))
    expect((await w.c.diagnoseClip('c1')).verdict).toBe('ticket')
    expect(w.c.streamInfo('c1')).toMatchObject({ held: false, jti: null })
    expect((await w.c.diagnoseClip('c1')).verdict).toBe('ok')
    expect(w.calls.tickets).toHaveLength(2)
    expect(w.doors.head.mock.calls.at(-1)[2]).toBe(w.c.binFileStreamUrl('p', 'c1').split('t=')[1])
  })
  it('nothing answering the HEAD (status 0) drops the door, the tab says it, and the gateway is probed again (round 1, finding 8)', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    expect(w.doors.probe).toHaveBeenCalledTimes(1)
    w.doors.head.mockImplementationOnce(async () => ({ status: 0, door: null }))
    const changes = w.onChange.mock.calls.length
    expect((await w.c.diagnoseClip('c1')).verdict).toBe('unreachable')
    expect(w.onChange.mock.calls.length).toBeGreaterThan(changes)
    await new Promise((r) => setTimeout(r, 0))
    await w.c.discover()
    expect(w.doors.probe.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(w.c.summary().state).toBe('reached') // the probe answered again
    // CONTROL: a door that stays silent leaves the tab unreachable, the catalogue back.
    const w2 = world()
    await w2.c.discover()
    w2.doors.probe.mockImplementation(async () => null)
    await w2.c.ensureTickets(['c1'])
    w2.doors.head.mockImplementationOnce(async () => ({ status: 0, door: null }))
    await w2.c.diagnoseClip('c1')
    await w2.c.discover()
    expect(w2.c.summary().state).toBe('unreachable')
    expect(w2.c.binsCapabilities().stream).toBe(false)
    expect(w2.c.binFileStreamUrl('p', 'c1')).toBeNull()
  })
  it('diagnoseClip with no ticket of its own: the cloud refusing the person is the TICKET; a clip it does not know is nothing to play; its refusals by reason (not_playable the format, too_long said as such)', async () => {
    let answer = null
    const w = world({ ticketsImpl: async (g, ids) => answer ? answer(ids) : { ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, ticketFor(id, { exp: Math.floor(NOW / 1000) + 120 })])), missing: [], refused: [], expires_at: null } } })
    await w.c.discover()
    answer = () => ({ ok: false, status: 401, code: 'not_signed_in', friendly: 'Sign in again.' })
    expect(await w.c.diagnoseClip('c1')).toEqual({ verdict: 'ticket', status: 0 })
    expect(w.doors.head).not.toHaveBeenCalled()
    expect(w.c.streamInfo('c1')).toMatchObject({ held: false, ticketError: 'Sign in again.' })
    answer = () => ({ ok: true, data: { tickets: {}, missing: ['c1'], refused: [], expires_at: null } })
    expect((await w.c.diagnoseClip('c1')).verdict).toBe('no_stream')
    answer = (ids) => ({ ok: true, data: { tickets: {}, missing: [], refused: ids.map((id) => ({ id, reason: 'not_playable' })), expires_at: null } })
    w.clock.t += 61_000 // past the missing minute of backoff
    expect((await w.c.diagnoseClip('c1')).verdict).toBe('format')
    answer = (ids) => ({ ok: true, data: { tickets: {}, missing: [], refused: ids.map((id) => ({ id, reason: 'too_long' })), expires_at: null } })
    w.clock.t += 61_000
    expect(await w.c.diagnoseClip('c1')).toEqual({ verdict: 'refused', status: 0, reason: 'too_long' })
    expect(await w.c.diagnoseClip('d1')).toEqual({ verdict: 'no_stream', status: 0 })
  })
})

describe('round 1\'s corrections (GW3 review round 1)', () => {
  const realTicket = (id, { iat, life = 120, sub = 'u-a', jti } = {}) => ticketFor(id, { iat, exp: iat + life, sub, jti })
  it('finding 2: the hold is anchored to the ticket\'s receipt, never the cloud\'s clock — a browser 95 s ahead still holds it; one 95 s behind drops it 90 s after receipt', async () => {
    const cloudNow = Math.floor(NOW / 1000)
    const ahead = world({ clock: { t: NOW + 95_000 }, ticketsImpl: async (g, ids) => ({ ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, realTicket(id, { iat: cloudNow })])), missing: [], refused: [] } }) })
    await ahead.c.discover()
    await ahead.c.ensureTickets(['c1'])
    expect(ahead.c.binFileStreamUrl('p', 'c1')).not.toBeNull()
    expect(ahead.c.streamInfo('c1').expiresAt).toBe(NOW + 95_000 + 120_000)
    await ahead.c.ensureTickets(['c1'])
    expect(ahead.calls.tickets).toHaveLength(1) // held: no mint at network speed
    const behind = world({ clock: { t: NOW - 95_000 }, ticketsImpl: async (g, ids) => ({ ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, realTicket(id, { iat: cloudNow })])), missing: [], refused: [] } }) })
    await behind.c.discover()
    await behind.c.ensureTickets(['c1'])
    behind.clock.t += 89_000
    expect(behind.c.binFileStreamUrl('p', 'c1')).not.toBeNull()
    behind.clock.t += 2_000
    expect(behind.c.binFileStreamUrl('p', 'c1')).toBeNull()
    // A ticket claiming more than two minutes is held for two at most.
    const long = world({ ticketsImpl: async (g, ids) => ({ ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, realTicket(id, { iat: cloudNow, life: 3600 })])), missing: [], refused: [] } }) })
    await long.c.discover()
    await long.c.ensureTickets(['c1'])
    expect(long.c.streamInfo('c1').expiresAt).toBe(NOW + 120_000)
  })
  it('finding 3: an id the cloud\'s answer names nowhere is backed off with its own sentence — asked again, nothing is sent', async () => {
    const w = world({ ticketsImpl: async () => ({ ok: true, data: { tickets: {}, missing: [], refused: [] } }) })
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    await w.c.ensureTickets(['c1'])
    await w.c.ensureTickets(['c1'])
    expect(w.calls.tickets).toHaveLength(1)
    expect(w.c.streamInfo('c1')).toMatchObject({ missing: true, ticketError: NO_TICKET })
    w.clock.t += 15_001
    await w.c.ensureTickets(['c1'])
    expect(w.calls.tickets).toHaveLength(2)
  })
  it('finding 5: a row the gateway answered 404 for stays off, whatever the reach says, and no ticket is minted for it', async () => {
    const w = world({ rowsNow: [{ id: 'c1', location_id: L1, relative_path: 'A001/c1.mp4', extension: '.mp4', gateway_missing: true, online: false }] })
    await w.c.discover()
    expect(w.c.markOnline([{ id: 'c1', location_id: L1, gateway_missing: true }])[0].online).toBe(false)
    expect(w.c.markOnline([{ id: 'c1', location_id: L1, vetted_at: VETTED }])[0].online).toBe(true)
    await w.c.ensureTickets(['c1'])
    expect(w.calls.tickets).toHaveLength(0)
  })
  it('finding 1: a ticket minted for another person is never used — no URL, no jti — and the signed-in person gets their own; dispose lets go of everything', async () => {
    let me = 'u-a'
    vi.useFakeTimers()
    try {
      const w = world({ userId: () => me, ticketsImpl: async (g, ids) => ({ ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, realTicket(id, { iat: Math.floor(w.clock.t / 1000), sub: me, jti: `j-${me}` })])), missing: [], refused: [] } }) })
      await w.c.discover()
      await w.c.ensureTickets(['c1'])
      expect(w.c.streamInfo('c1').jti).toBe('j-u-a')
      me = 'u-b'
      expect(w.c.binFileStreamUrl('p', 'c1')).toBeNull()
      expect(w.c.streamInfo('c1')).toMatchObject({ jti: null, held: false, lapsedUrl: null })
      expect(await w.c.renewStream('c1')).toMatchObject({ ok: false, reason: 'no_stream' })
      await w.c.ensureTickets(['c1'])
      expect(w.calls.tickets).toHaveLength(2)
      expect(w.c.streamInfo('c1').jti).toBe('j-u-b')
      // dispose: the tickets, the doors and the margin timers go.
      refuseRenewal(w)
      await w.c.renewStream('c1')
      w.c.dispose()
      const changes = w.onChange.mock.calls.length
      await vi.advanceTimersByTimeAsync(200_000)
      expect(w.onChange.mock.calls.length).toBe(changes)
      expect(w.c.binFileStreamUrl('p', 'c1')).toBeNull()
      expect(w.c.streamInfo('c1')).toMatchObject({ jti: null, door: null })
      expect(w.c.binsCapabilities().stream).toBe(false)
    } finally { vi.useRealTimers() }
  })
  it('finding 1: after dispose the next person\'s discovery probes every door again — a door the last person reached is not believed', async () => {
    const w = world()
    await w.c.discover()
    expect(w.doors.probe).toHaveBeenCalledTimes(1)
    expect(w.c.summary().state).toBe('reached')
    w.c.dispose()
    expect(w.c.summary().reached).toEqual([])
    await w.c.discover()
    expect(w.doors.probe).toHaveBeenCalledTimes(2)
    // CONTROL: without dispose a discovery keeps the door it reached.
    await w.c.discover()
    expect(w.doors.probe).toHaveBeenCalledTimes(2)
  })
  it('finding 7: a ticket that lapsed while its player sat idle keeps its URL for that player (lapsedUrl), never for a new use; a stream whose renewal failed loses it at the margin', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    const url = w.c.binFileStreamUrl('p', 'c1')
    w.clock.t += 95_000
    expect(w.c.binFileStreamUrl('p', 'c1')).toBeNull() // a new use asks for a fresh one
    expect(w.c.streamInfo('c1').lapsedUrl).toBe(url) // the idle player keeps its own
    w.doors.renew.mockImplementationOnce(async () => ({ ok: false, status: 401 }))
    await w.c.renewStream('c1')
    expect(w.c.streamInfo('c1')).toMatchObject({ lapsedUrl: null, renewFailed: true })
  })
  it('finding 8: a reached door whose address left the view is dropped and probed again', async () => {
    const list = [gw()]
    const w = world({ gateways: () => list })
    await w.c.discover()
    expect(w.c.summary().reached[0].base).toBe('https://192.168.1.10:8443')
    list[0] = gw({ inside_addresses: [{ host: '192.168.1.44', port: 8443 }] })
    w.doors.probe.mockImplementationOnce(async (g) => ({ door: 'inside', base: 'https://192.168.1.44:8443', gatewayId: g.id }))
    await w.c.refreshGateways()
    expect(w.doors.probe).toHaveBeenCalledTimes(2)
    expect(w.c.summary().reached[0].base).toBe('https://192.168.1.44:8443')
  })
  it('P8 (TPN-ENC-013): a door reached at one of the gateway\'s NAMES is believed and kept, and the summary names it before any address', async () => {
    const list = [gw({ inside_names: [{ host: 'studio-nas.local', port: 8443 }] })]
    const w = world({ gateways: () => list })
    w.doors.probe.mockImplementationOnce(async (g) => ({ door: 'inside', base: 'https://studio-nas.local:8443', gatewayId: g.id }))
    await w.c.discover()
    expect(w.c.summary().reached[0].base).toBe('https://studio-nas.local:8443')
    expect(w.c.summary().address).toBe('studio-nas.local:8443')
    await w.c.refreshGateways()
    expect(w.doors.probe).toHaveBeenCalledTimes(1)
    expect(w.c.summary().reached[0].base).toBe('https://studio-nas.local:8443')
  })
})

function refuseRenewal(w) { w.doors.renew.mockImplementationOnce(async () => ({ ok: false, status: 401 })) }

describe('round 2\'s corrections (GW3 review round 2)', () => {
  const ticketWith = (id, { iat, life = 120, sub, jti } = {}) => ticketFor(id, { iat, exp: iat + life, sub, jti })
  it('finding 1: a ticket the door refuses while still young (just minted) is the DOOR\'s refusal — backed off a minute, said, and no fresh src or mint meanwhile; an aged one is the ticket', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    w.doors.head.mockImplementation(async () => ({ status: 401, door: 'outside' }))
    expect((await w.c.diagnoseClip('c1')).verdict).toBe('door_refused')
    expect(w.c.streamInfo('c1')).toMatchObject({ held: false, missing: true, ticketError: DOOR_REFUSED_FRESH })
    expect(await w.c.freshStreamUrl('c1')).toBeNull()
    await w.c.ensureTickets(['c1'])
    expect(w.calls.tickets).toHaveLength(1) // nothing minted while the door refuses
    // With no ticket of its own the diagnosis mints once — and that young ticket refused is the door's too.
    w.clock.t += 60_001
    expect((await w.c.diagnoseClip('c1')).verdict).toBe('door_refused')
    expect(w.calls.tickets).toHaveLength(2)
    expect(await w.c.freshStreamUrl('c1')).toBeNull()
    expect(w.calls.tickets).toHaveLength(2)
    // A minute on, a fresh src is allowed again and a ticket that lands clears the refusal.
    w.clock.t += 60_001
    w.doors.head.mockImplementation(async () => ({ status: 206, door: 'outside' }))
    expect(await w.c.freshStreamUrl('c1')).not.toBeNull()
    expect(w.c.streamInfo('c1').ticketError).toBeNull()
  })
  it('finding 1, the other edge: a stream renewed for minutes whose door then refuses its URL (a gateway started again, its streams gone) is the TICKET — the URL\'s own ticket aged — and earns the one fresh src', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    w.clock.t += 75_000
    expect(await w.c.renewStream('c1')).toMatchObject({ ok: true })
    w.clock.t += 30_000 // 105 s after the URL's ticket arrived: past its own first hold, inside the renewal's
    w.doors.head.mockImplementationOnce(async () => ({ status: 401, door: 'inside' }))
    expect((await w.c.diagnoseClip('c1')).verdict).toBe('ticket')
  })
  it('note 13 and dispose: a renewal remembered before dispose never covers the next person\'s stream', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    await w.c.renewStream('c1')
    expect(w.calls.renew).toHaveLength(1)
    w.c.dispose()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    await w.c.renewStream('c1')
    expect(w.calls.renew).toHaveLength(2)
  })
  it('note 9: a "just now" refusal (bad_ticket) lapses with its minute and the clip is asked for again; a permanent one (not_playable, too_long) stays', async () => {
    let answer = 'bad_ticket'
    const w = world({ ticketsImpl: async (g, ids) => ({ ok: true, data: { tickets: {}, missing: [], refused: ids.map((id) => ({ id, reason: answer })) } }) })
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    expect(w.c.streamInfo('c1')).toMatchObject({ refused: 'bad_ticket', missing: false })
    w.clock.t += 61_000
    expect(w.c.streamInfo('c1').refused).toBeNull()
    answer = 'not_playable'
    await w.c.ensureTickets(['c1'])
    expect(w.calls.tickets).toHaveLength(2)
    w.clock.t += 61_000
    expect(w.c.streamInfo('c1').refused).toBe('not_playable')
    expect((await w.c.diagnoseClip('c1')).verdict).toBe('format')
  })
  it('note 10: a renewal the DOOR refuses backs the clip off too — the player\'s 10 s retry asks the cloud nothing', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    w.doors.renew.mockImplementationOnce(async () => ({ ok: false, status: 401 }))
    expect(await w.c.renewStream('c1')).toMatchObject({ ok: false, reason: 'refused' })
    w.clock.t += 10_000
    expect(await w.c.renewStream('c1')).toMatchObject({ ok: false, reason: 'backoff' })
    expect(w.calls.tickets).toHaveLength(2) // the first mint and the renewal's; the retry minted nothing
  })
  it('note 13: two players on one stream renew it once — the renewal in flight is shared, and one in the last 30 s covers the other\'s turn', async () => {
    const w = world()
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    const [a, b] = await Promise.all([w.c.renewStream('c1'), w.c.renewStream('c1')])
    expect(a).toMatchObject({ ok: true })
    expect(b).toMatchObject({ ok: true })
    expect(w.calls.renew).toHaveLength(1)
    w.clock.t += 6_000 // the second player's own turn, a few seconds later
    expect(await w.c.renewStream('c1')).toMatchObject({ ok: true, shared: true })
    expect(w.calls.renew).toHaveLength(1)
    expect(w.calls.tickets).toHaveLength(2)
    w.clock.t += 75_000 // the next turn renews for real
    await w.c.renewStream('c1')
    expect(w.calls.renew).toHaveLength(2)
  })
  it('note 18a: a ticket whose life is shorter than twice the margin is held for half its life, not for nothing', async () => {
    const cloudNow = Math.floor(NOW / 1000)
    const w = world({ ticketsImpl: async (g, ids) => ({ ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, ticketWith(id, { iat: cloudNow, life: 40 })])), missing: [], refused: [] } }) })
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    expect(w.c.binFileStreamUrl('p', 'c1')).not.toBeNull()
    for (let i = 0; i < 5; i++) await w.c.ensureTickets(['c1'])
    expect(w.calls.tickets).toHaveLength(1)
    w.clock.t += 19_000
    expect(w.c.binFileStreamUrl('p', 'c1')).not.toBeNull()
    w.clock.t += 2_000
    expect(w.c.binFileStreamUrl('p', 'c1')).toBeNull()
  })
  it('note 18b: a ticket without iat is held from receipt for the design\'s two minutes — a browser 95 s ahead of the cloud still holds it', async () => {
    const w = world({ clock: { t: NOW + 95_000 }, ticketsImpl: async (g, ids) => ({ ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, ticketFor(id, { exp: Math.floor(NOW / 1000) + 120 })])), missing: [], refused: [] } }) })
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    expect(w.c.binFileStreamUrl('p', 'c1')).not.toBeNull()
    expect(w.c.streamInfo('c1').expiresAt).toBe(NOW + 95_000 + 120_000)
    await w.c.ensureTickets(['c1'])
    expect(w.calls.tickets).toHaveLength(1)
  })
  it('note 18c: while the signed-in person is not known yet a ticket that names a person is held back, and used once the person is known and is the one it names', async () => {
    let me = null
    const cloudNow = Math.floor(NOW / 1000)
    const w = world({ userId: () => me, ticketsImpl: async (g, ids) => ({ ok: true, data: { tickets: Object.fromEntries(ids.map((id) => [id, ticketWith(id, { iat: cloudNow, sub: 'u-a' })])), missing: [], refused: [] } }) })
    await w.c.discover()
    await w.c.ensureTickets(['c1'])
    expect(w.c.binFileStreamUrl('p', 'c1')).toBeNull()
    expect(w.c.streamInfo('c1').jti).toBeNull()
    me = 'u-a'
    expect(w.c.binFileStreamUrl('p', 'c1')).not.toBeNull()
    me = 'u-b'
    expect(w.c.binFileStreamUrl('p', 'c1')).toBeNull()
  })
})
