// =============================================================================
// gatewayDoors.test.js — GW3 (2026-10-11): the file gateway's doors in the
// page, for port 5289. The stub must answer in the real doors' shapes (the
// composite reads nothing else), put on each of GATEWAY_DESIGN.md §2's
// states by its URL mode, serve ONLY the bundled noise clips (never real
// footage), and in `real` mode hand the real doors module the work so the
// Playwright run against GW2's executable goes through the production code.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import { gatewayPlaybackMode, createGatewayDoorsStub, stubTicket, STUB_BASE } from './gatewayDoors'
import { createGatewayFixtures } from './gatewayFixtures'
import { createStore } from './store'
import { PERMISSIONS, WORKSPACE_ID, MEMBER_ID } from './data/workspace'
import { BIN_FILES } from './data/scenes'
import { GATEWAY_ID } from './data/gateways'
import { ticketClaims, ticketExpiresAt } from '../../tools/rabbit_v0.1.0/bins/gatewayDoors'

const identity = { userId: PERMISSIONS.userId, workspaceId: WORKSPACE_ID, appRole: 'admin' }
// The seeded rows: eleven .mov masters, two .mp4 proxies (GW3), two .bwf
// audio rows, two .png stills and one .exr sequence.
const videoRow = BIN_FILES.find((f) => f.extension === '.mp4')
const audioRow = BIN_FILES.find((f) => f.extension === '.bwf')
const stillRow = BIN_FILES.find((f) => f.extension === '.png' && !f.is_sequence)
const seqRow = BIN_FILES.find((f) => f.is_sequence)
const gatewayRow = { id: GATEWAY_ID, inside_addresses: [{ host: '192.168.1.10', port: 8443 }], outside_address: null }

describe('the mode on the URL', () => {
  it('reads the six modes, the missing ids and the real run\'s parameters; defaults to the office door', () => {
    expect(gatewayPlaybackMode('')).toMatchObject({ mode: 'inside', real: null })
    expect(gatewayPlaybackMode('?gateway=outside').mode).toBe('outside')
    for (const m of ['none', 'unseen', 'unreachable']) expect(gatewayPlaybackMode(`?gateway=${m}`).mode).toBe(m)
    expect(gatewayPlaybackMode('?gateway=nonsense').mode).toBe('inside')
    expect(gatewayPlaybackMode('?gateways=empty').mode).toBe('none')
    expect([...gatewayPlaybackMode('?missing=a,b').missing]).toEqual(['a', 'b'])
    const real = gatewayPlaybackMode('?gateway=real&gw=g9&host=127.0.0.1&port=18444&renew_s=20&sub=u1').real
    expect(real).toEqual({ gatewayId: 'g9', host: '127.0.0.1', port: 18444, renewAfterMs: 20_000, ticketsPath: '/__fake-cloud/gateway-ticket', sub: 'u1' })
    expect(gatewayPlaybackMode('?gateway=real').real).toMatchObject({ gatewayId: null, host: '127.0.0.1', port: 8444, renewAfterMs: null })
  })
})

describe('the stub\'s tickets are the wire\'s shape', () => {
  it('v1.<payload>.<sig> with a jti and a two-minute exp the player reads; rv marks the outside door', () => {
    const now = Date.parse('2026-10-11T12:00:00Z')
    const t = stubTicket({ gatewayId: GATEWAY_ID, workspaceId: WORKSPACE_ID, sub: 'u1', clip: 'c1', loc: 'L1', path: 'A/x.mp4', rv: true, now })
    expect(t).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    const claims = ticketClaims(t)
    expect(claims).toMatchObject({ v: 1, gw: GATEWAY_ID, sub: 'u1', clip: 'c1', loc: 'L1', path: 'A/x.mp4', rv: true, iat: now / 1000, exp: now / 1000 + 120 })
    expect(claims.jti).toMatch(/^[0-9a-f]{32}$/)
    expect(ticketExpiresAt(t)).toBe(now + 120_000)
    expect(ticketClaims(stubTicket({ gatewayId: 'g', clip: 'c', now })).jti).not.toBe(claims.jti)
  })
})

describe('the doors by mode (§2)', () => {
  const stub = (search, extra = {}) => createGatewayDoorsStub(createStore(), identity, { playback: gatewayPlaybackMode(search), ...extra })
  it('inside (the default): the probe answers the OFFICE door after a beat, only for the seeded gateway', async () => {
    const d = stub('')
    expect(await d.probe(gatewayRow)).toEqual({ door: 'inside', base: STUB_BASE, gatewayId: GATEWAY_ID })
    expect(await d.probe({ ...gatewayRow, id: 'someone-else' })).toBeNull()
    expect(await d.probe(null)).toBeNull()
  })
  it('outside: the OUTSIDE door, the tickets marked rv', async () => {
    const d = stub('?gateway=outside')
    expect((await d.probe(gatewayRow)).door).toBe('outside')
    const r = await d.tickets(GATEWAY_ID, [videoRow.id])
    expect(ticketClaims(r.data.tickets[videoRow.id]).rv).toBe(true)
    expect((await d.head(STUB_BASE, videoRow.id)).door).toBe('outside')
  })
  it('none, unseen, unreachable: no door answers the probe', async () => {
    for (const m of ['none', 'unseen', 'unreachable']) expect(await stub(`?gateway=${m}`).probe(gatewayRow), m).toBeNull()
  })
  it('the bytes are the bundled noise clips, by kind, with the ticket in the query; never a share path', () => {
    const d = stub('')
    const video = d.clipUrl(STUB_BASE, videoRow.id, 'v1.a.b')
    expect(video).toMatch(/clip-noise.*\.mp4.*\?t=v1\.a\.b$/)
    expect(d.clipUrl(STUB_BASE, audioRow.id, 'v1.a.b')).toMatch(/clip-noise.*\.wav.*\?t=v1\.a\.b$/)
    expect(video).not.toContain(videoRow.relative_path)
    expect(d.clipUrl(STUB_BASE, 'c1', 'a+b')).toContain('t=a%2Bb')
  })
  it('a still is its own picture from the store (the seeded SVG), the noise clip when it has none', () => {
    const store = createStore()
    expect(stillRow).toBeTruthy()
    const d = createGatewayDoorsStub(store, identity, { playback: gatewayPlaybackMode('') })
    expect(d.clipUrl(STUB_BASE, stillRow.id, 't')).toMatch(/^data:image\/svg\+xml/)
    store.posters.delete(stillRow.id)
    expect(d.clipUrl(STUB_BASE, stillRow.id, 't')).toMatch(/clip-noise/)
  })
  it('the tickets: one per playable row; a sequence (an .exr, off the list too) is refused as not_playable; an unknown id is missing', async () => {
    const d = stub('')
    expect(seqRow).toBeTruthy()
    const r = await d.tickets(GATEWAY_ID, [videoRow.id, audioRow.id, 'not-a-row', seqRow.id])
    expect(r.ok).toBe(true)
    expect(Object.keys(r.data.tickets).sort()).toEqual([videoRow.id, audioRow.id].sort())
    expect(r.data.missing).toEqual(['not-a-row'])
    expect(r.data.refused).toEqual([{ id: seqRow.id, reason: 'not_playable' }])
    expect(ticketClaims(r.data.tickets[videoRow.id])).toMatchObject({ gw: GATEWAY_ID, ws: WORKSPACE_ID, sub: identity.userId, clip: videoRow.id, loc: videoRow.location_id, path: videoRow.relative_path, rv: false })
    expect(typeof r.data.expires_at).toBe('string')
  })
  it('missing=<id>: the HEAD answers 404 and the renewal 401 for that clip; 200 and 204 for the rest', async () => {
    const d = stub(`?missing=${videoRow.id}`)
    expect(d.clipUrl(STUB_BASE, videoRow.id, 'v1.a.b')).toBe(`/__fixture-missing__/${videoRow.id}.mp4?t=v1.a.b`) // bytes a <video> cannot play
    expect(d.clipUrl(STUB_BASE, audioRow.id, 'v1.a.b')).toMatch(/clip-noise/)
    expect(await d.head(STUB_BASE, videoRow.id)).toEqual({ status: 404, door: 'inside' })
    expect(await d.head(STUB_BASE, audioRow.id)).toEqual({ status: 200, door: 'inside' })
    expect(await d.renew(STUB_BASE, videoRow.id, { jti: 'j' })).toEqual({ ok: false, status: 401 })
    expect(await d.renew(STUB_BASE, audioRow.id, { jti: 'j' })).toEqual({ ok: true, status: 204 })
    expect(await d.renew(STUB_BASE, audioRow.id, { jti: null })).toEqual({ ok: false, status: 401 })
  })
  it('the stub is frozen and names its mode; no real gateway row', () => {
    const d = stub('?gateway=outside')
    expect(Object.isFrozen(d)).toBe(true)
    expect(d.mode).toBe('outside')
    expect(d.real).toBeNull()
    expect(d.gatewayRows).toBeNull()
  })
})

describe('real: the production doors against a real gateway on this computer', () => {
  it('the one gateway row names the outside door the URL gave; tickets go to the same-origin path the test fulfils', async () => {
    const d = createGatewayDoorsStub(createStore(), identity, { playback: gatewayPlaybackMode('?gateway=real&gw=g9&host=127.0.0.1&port=18444&sub=u1'), now: () => Date.parse('2026-10-11T12:00:00Z') })
    expect(d.mode).toBe('real')
    const rows = d.gatewayRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'g9', workspace_id: WORKSPACE_ID, inside_addresses: [], outside_address: { host: '127.0.0.1', port: 18444 }, last_seen_at: '2026-10-11T12:00:00.000Z' })
    expect(Object.values(rows[0].reach)).toEqual(['reachable'])
    // The clip URL is the production module's (the gateway's route), not the noise clip.
    expect(d.clipUrl('https://127.0.0.1:18444', 'c1', 'v1.a.b')).toBe('https://127.0.0.1:18444/v1/clips/c1?t=v1.a.b')
    // The ticket request posts to the page's own origin; the production function reads res.ok first.
    const f = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ tickets: { c1: 'v1.a.b' }, missing: [], refused: [] }) }))
    vi.stubGlobal('fetch', f)
    try {
      const r = await d.tickets('g9', ['c1'])
      expect(r).toMatchObject({ ok: true, data: { tickets: { c1: 'v1.a.b' } } })
      expect(f.mock.calls[0][0]).toBe('/__fake-cloud/gateway-ticket')
      expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ gateway_id: 'g9', bin_file_ids: ['c1'], sub: 'u1' })
    } finally { vi.unstubAllGlobals() }
  })
  it('without a gateway id there is no row to probe', () => {
    const d = createGatewayDoorsStub(createStore(), identity, { playback: gatewayPlaybackMode('?gateway=real') })
    expect(d.gatewayRows()).toEqual([])
  })
})

describe('the gateway fixtures read the doors', () => {
  const make = (search, role = 'admin') => {
    const store = createStore()
    const id = { ...identity, appRole: role, userId: role === 'admin' ? PERMISSIONS.userId : MEMBER_ID }
    const doors = createGatewayDoorsStub(store, id, { playback: gatewayPlaybackMode(search) })
    const fx = createGatewayFixtures(store, id, { mode: null, doors, wait: async () => {} })
    return { fx, doors }
  }
  it('listGatewaysForPlayback: the view\'s shape; unseen is four minutes ago; outside publishes an address; none is empty', async () => {
    const r = (await make('').fx.listGatewaysForPlayback()).data
    expect(r).toHaveLength(1)
    expect(Object.keys(r[0]).sort()).toEqual(['id', 'inside_addresses', 'last_seen_at', 'name', 'outside_address', 'platform', 'reach', 'root_fingerprint', 'version', 'workspace_id'])
    expect(r[0].outside_address).toBeNull()
    expect(Date.now() - Date.parse(r[0].last_seen_at)).toBeLessThan(60_000)
    const unseen = (await make('?gateway=unseen').fx.listGatewaysForPlayback()).data[0]
    expect(Date.now() - Date.parse(unseen.last_seen_at)).toBeGreaterThan(200_000)
    expect((await make('?gateway=outside').fx.listGatewaysForPlayback()).data[0].outside_address).toEqual({ host: 'footage.lanternash.example', port: 443 })
    expect((await make('?gateway=none').fx.listGatewaysForPlayback()).data).toEqual([])
    // A member reads the view too (it is not the admin's table).
    expect((await make('', 'member').fx.listGatewaysForPlayback()).data).toHaveLength(1)
  })
  it('fetchGatewayTickets is the doors\' answer; listRemoteViewingsOfClip filters the seeded viewings to one clip, admins only', async () => {
    const { fx } = make('')
    const t = await fx.fetchGatewayTickets(GATEWAY_ID, [videoRow.id])
    expect(ticketClaims(t.data.tickets[videoRow.id]).clip).toBe(videoRow.id)
    const all = (await fx.listRemoteViewings({ page: 0, pageSize: 25 })).data.rows
    const clipId = all[0].file_id
    const mine = (await fx.listRemoteViewingsOfClip(clipId, { page: 0, pageSize: 25 })).data
    expect(mine.total).toBe(all.filter((v) => v.file_id === clipId).length)
    expect(mine.rows).toHaveLength(mine.total) // a page of 25 holds them all
    expect(mine.total).toBeGreaterThan(1)
    // Asked with no page: the first page of 25, as the dialog asks.
    expect((await fx.listRemoteViewingsOfClip(clipId)).data.rows).toHaveLength(mine.total)
    expect(mine.rows.every((v) => v.file_id === clipId && v.project_title)).toBe(true)
    expect((await make('', 'member').fx.listRemoteViewingsOfClip(clipId)).data).toEqual({ rows: [], total: 0 })
  })
})
