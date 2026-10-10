// =============================================================================
// gatewayFixtures.test.js — GW1 (2026-10-10): the in-memory gateway cloud that
// lets Settings, Storage, File gateway render on port 5288 without a database.
//
// It must answer in the cloud's shapes and keep the cloud's rules where the
// card can meet them (0093): admins only; five pending tokens; the
// fingerprint confirmed by the enrolling admin with the gateway's own; the
// certificate only after; forget undoable for a minute; an address change
// clearing the check; the outside door following the switch. And the two
// acts it puts on (the enrolment, the knock) must be the ones walkthrough 60
// describes.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createGatewayFixtures, gatewayFixtureMode } from './gatewayFixtures'
import { createRabbitFixturesAdapter } from './rabbitFixturesAdapter'
import { createStore } from './store'
import { PERMISSIONS, WORKSPACE_ID, MEMBER_ID } from './data/workspace'
import { BIN_FILES } from './data/scenes'
import { GATEWAY_ID, FIXTURE_ROOT_FINGERPRINT, FIXTURE_NEW_ROOT_FINGERPRINT } from './data/gateways'

function make({ role = 'admin', mode = null, userId = PERMISSIONS.userId } = {}) {
  const store = createStore()
  let t = Date.parse('2026-10-10T12:00:00Z')
  const timers = []
  const identity = { userId, workspaceId: WORKSPACE_ID, appRole: role }
  const fx = createGatewayFixtures(store, identity, {
    mode,
    clock: () => t,
    schedule: (fn, ms) => { const h = { fn, at: t + ms, done: false }; timers.push(h); return h },
    cancel: (h) => { h.done = true },
    wait: async () => {},
  })
  const advance = (ms) => { t += ms; for (const h of timers) if (!h.done && h.at <= t) { h.done = true; h.fn() } }
  return { fx, store, identity, advance, now: () => t }
}

describe('the seeded company', () => {
  it('one confirmed NAS gateway, seen within ten seconds; five viewings in the last 30 days; a trail', async () => {
    const { fx, now } = make()
    const gws = (await fx.listGateways({ admin: true, now: now() })).data
    expect(gws).toHaveLength(1)
    expect(gws[0]).toMatchObject({ id: GATEWAY_ID, name: 'Salt Hours NAS', platform: 'container', root_fingerprint: FIXTURE_ROOT_FINGERPRINT })
    expect(gws[0].root_confirmed_at).toBeTruthy()
    expect(now() - Date.parse(gws[0].last_seen_at)).toBeLessThan(10000)
    expect(Object.keys(gws[0])).not.toContain('root_cert_pem')
    const v = (await fx.listRemoteViewings({ now: now() })).data
    expect(v.total).toBe(5)
    expect(v.rows.every(r => r.event === 'viewed_remote' && r.subject === 'bin_file' && r.external_id.startsWith(`${GATEWAY_ID}:`))).toBe(true)
    expect(v.rows.map(r => Date.parse(r.created_at))).toEqual([...v.rows.map(r => Date.parse(r.created_at))].sort((a, b) => b - a))
    expect(v.rows.some(r => r.details.unverified_mint)).toBe(true)
    expect(v.rows.some(r => r.details.shared_url)).toBe(true)
    expect(v.rows.some(r => r.details.incomplete)).toBe(true)
    const audit = (await fx.listGatewayAudit({ limit: 20 })).data
    expect(audit[0].action).toBe('remote_viewing.off')
    expect(audit.map(a => Date.parse(a.created_at))).toEqual([...audit.map(a => Date.parse(a.created_at))].sort((a, b) => b - a))
  })

  it('?gateways=empty starts before the first gateway', async () => {
    expect(gatewayFixtureMode('?gateways=empty')).toBe('empty')
    expect(gatewayFixtureMode('?fixtures=member')).toBeNull()
    const { fx } = make({ mode: 'empty' })
    expect((await fx.listGateways({ admin: true })).data).toEqual([])
    expect((await fx.listRemoteViewings()).data.total).toBe(0)
  })

  it('the outside door follows the switch and the address (§9)', async () => {
    const { fx, store } = make()
    const door = async () => (await fx.listGateways({ admin: true })).data[0].health.doors.outside
    expect(await door()).toBe('closed_switch_off')
    store.workspace.remote_viewing_enabled = true
    expect(await door()).toBe('closed_no_address')
    await fx.updateGateway(GATEWAY_ID, { outside_address: { host: 'gateway.yourcompany.com', port: 8444 } })
    expect(await door()).toBe('open:8444')
  })
})

describe('the verbs, with 0093\'s rules', () => {
  it('Add a gateway: a wgt_ token, never listed again; spent six seconds later by a gateway made by its admin, unconfirmed', async () => {
    const { fx, advance } = make({ mode: 'empty' })
    const tok = (await fx.makeEnrolmentToken()).data
    expect(tok.token).toMatch(/^wgt_[A-Z2-7]{32}$/)
    const listed = (await fx.listEnrolmentTokens()).data
    expect(listed).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain(tok.token)
    advance(5999)
    expect((await fx.listGateways({ admin: true })).data).toHaveLength(0)
    advance(1)
    const [g] = (await fx.listGateways({ admin: true })).data
    expect(g).toMatchObject({ platform: 'container', created_by: PERMISSIONS.userId, root_confirmed_at: null, root_fingerprint: FIXTURE_NEW_ROOT_FINGERPRINT })
    const [t] = (await fx.listEnrolmentTokens()).data
    expect(t.used_at).toBeTruthy()
    expect(t.gateway_id).toBe(g.id)
  })

  it('a cancelled token is never spent; five pending at most', async () => {
    const { fx, advance } = make()
    const a = (await fx.makeEnrolmentToken()).data
    expect((await fx.cancelEnrolmentToken(a.id)).ok).toBe(true)
    advance(10000)
    expect((await fx.listGateways({ admin: true })).data).toHaveLength(1)
    expect((await fx.cancelEnrolmentToken(a.id)).friendly).toMatch(/nothing to cancel/)
    for (let i = 0; i < 5; i += 1) expect((await fx.makeEnrolmentToken()).ok).toBe(true)
    expect(await fx.makeEnrolmentToken()).toMatchObject({ ok: false, code: '54000' })
  })

  it('the fingerprint: only the enrolling admin, only the gateway\'s own; the certificate only after', async () => {
    const { fx, advance } = make({ mode: 'empty' })
    await fx.makeEnrolmentToken()
    advance(6000)
    const [g] = (await fx.listGateways({ admin: true })).data
    expect(await fx.fetchRootCertificate(g.id)).toMatchObject({ ok: false, code: '55000' })
    expect(await fx.confirmGatewayFingerprint(g.id, 'B1:16')).toMatchObject({ ok: false, code: '22023' })
    expect(await fx.confirmGatewayFingerprint(g.id, FIXTURE_ROOT_FINGERPRINT)).toMatchObject({ ok: false, code: '22023' })
    const pairs = FIXTURE_NEW_ROOT_FINGERPRINT.toUpperCase().match(/../g).join(':')
    expect((await fx.confirmGatewayFingerprint(g.id, pairs)).ok).toBe(true)
    expect((await fx.fetchRootCertificate(g.id)).data).toMatch(/^-----BEGIN CERTIFICATE-----/)
  })

  it('another admin cannot confirm a gateway they did not enrol', async () => {
    const { fx, identity, advance } = make({ mode: 'empty' })
    await fx.makeEnrolmentToken()
    advance(6000)
    const [g] = (await fx.listGateways({ admin: true })).data
    // The same cloud, now asked by Theo as an admin.
    identity.userId = MEMBER_ID.theo
    expect(await fx.confirmGatewayFingerprint(g.id, FIXTURE_NEW_ROOT_FINGERPRINT)).toMatchObject({ ok: false, code: '42501' })
    // CONTROL: Mara, who made the token, may.
    identity.userId = PERMISSIONS.userId
    expect((await fx.confirmGatewayFingerprint(g.id, FIXTURE_NEW_ROOT_FINGERPRINT)).ok).toBe(true)
  })

  it('a change is refused as the CHECKs refuse it, and an address change clears the check', async () => {
    const { fx } = make()
    expect(await fx.updateGateway(GATEWAY_ID, { name: '  ' })).toMatchObject({ ok: false, code: '23514' })
    expect(await fx.updateGateway(GATEWAY_ID, { outside_address: { host: 'nas.local', port: 8444 } })).toMatchObject({ ok: false, code: '23514' })
    expect(await fx.updateGateway(GATEWAY_ID, { outside_address: { host: 'Gateway.YourCompany.com', port: 8444 } })).toMatchObject({ ok: false, code: '23514' })
    expect(await fx.updateGateway(GATEWAY_ID, { office_ranges: ['192.168.20.7/24'] })).toMatchObject({ ok: false, code: '23514' })
    expect(await fx.updateGateway(GATEWAY_ID, { office_ranges: ['8.8.8.0/24'] })).toMatchObject({ ok: false, code: '23514' })
    const saved = await fx.updateGateway(GATEWAY_ID, { outside_address: { host: 'gateway.yourcompany.com', port: 443 }, office_ranges: ['192.168.20.0/24'] })
    expect(saved.ok).toBe(true)
    expect(saved.data).toMatchObject({ reach_ok: null, reach_checked_at: null, reach_detail: 'address_changed', office_ranges: ['192.168.20.0/24'] })
    const actions = (await fx.listGatewayAudit({ limit: 3 })).data.map(a => a.action)
    expect(actions).toEqual(['gateway.office_ranges_changed', 'gateway.outside_address_changed', 'remote_viewing.off'])
  })

  it('forget is undoable for one minute, then not', async () => {
    const { fx, advance } = make()
    await fx.forgetGateway(GATEWAY_ID)
    expect((await fx.listGateways({ admin: true })).data[0].revoked_at).toBeTruthy()
    expect((await fx.listGateways({ admin: false })).data).toHaveLength(0)
    advance(30000)
    expect((await fx.unforgetGateway(GATEWAY_ID)).ok).toBe(true)
    await fx.forgetGateway(GATEWAY_ID)
    advance(61000)
    expect(await fx.unforgetGateway(GATEWAY_ID)).toMatchObject({ ok: false, code: '55000' })
    expect((await fx.listGateways({ admin: true })).data).toHaveLength(0)
  })

  it('Check reach: no address is refused; the switch decides between reached and switch-off; the named cases answer as §4', async () => {
    const { fx, store } = make()
    expect(await fx.checkGatewayReach(GATEWAY_ID)).toMatchObject({ ok: false, code: 'no_address', status: 409 })
    await fx.updateGateway(GATEWAY_ID, { outside_address: { host: 'gateway.yourcompany.com', port: 8444 } })
    expect((await fx.checkGatewayReach(GATEWAY_ID)).data.outside.detail).toBe('switch_off')
    store.workspace.remote_viewing_enabled = true
    const r = (await fx.checkGatewayReach(GATEWAY_ID)).data
    expect(r.outside).toMatchObject({ ok: true, detail: 'reached', is_this_gateway: true })
    expect((await fx.listGateways({ admin: true })).data[0].reach_ok).toBe(true)
    for (const [first, detail] of [['timeout', 'timed_out'], ['refused', 'refused'], ['other', 'not_this_gateway'], ['selfsigned', 'certificate']]) {
      await fx.updateGateway(GATEWAY_ID, { outside_address: { host: `${first}.yourcompany.com`, port: 8444 } })
      const res = (await fx.checkGatewayReach(GATEWAY_ID)).data
      expect(res.outside.detail).toBe(detail)
      expect((await fx.listGateways({ admin: true })).data[0].reach_ok).toBe(false)
    }
    await fx.updateGateway(GATEWAY_ID, { outside_address: { host: 'inside.yourcompany.com', port: 8444 } })
    expect((await fx.checkGatewayReach(GATEWAY_ID)).data.inside_answered).toBe(true)
    // Round 2, finding 4: a tunnel's edge on the inside port is something
    // else answering — reached, and never the red line.
    await fx.updateGateway(GATEWAY_ID, { outside_address: { host: 'tunnel.yourcompany.com', port: 443 } })
    const t = (await fx.checkGatewayReach(GATEWAY_ID)).data
    expect(t).toMatchObject({ inside_answered: false, inside_other: true })
    expect(t.outside.detail).toBe('reached')
  })

  it('Rotate the ticket keys: an admin\'s, written down (round 2, finding 6)', async () => {
    const { fx } = make()
    expect(await fx.rotateTicketKeys()).toMatchObject({ ok: true, data: { retired: 1 } })
    expect((await fx.listGatewayAudit()).data[0]).toMatchObject({ action: 'gateway.keys_rotated', actor_user_id: PERMISSIONS.userId })
  })

  it('the inspector\'s count comes from the same viewings, through the fixtures\' project adapter (admins only)', async () => {
    const { store } = make()
    const admin = createRabbitFixturesAdapter(store, { userId: PERMISSIONS.userId, workspaceId: WORKSPACE_ID, appRole: 'admin' })
    const res = await admin.remoteViewsOfClip(BIN_FILES[0].id)
    expect(res.count).toBe(2)
    expect(res.last.actor_label).toBe('Priya Raman')
    // The NEWEST of that clip's viewings, as the cloud orders them.
    const newest = store.gatewayViewings.filter(v => v.file_id === BIN_FILES[0].id).map(v => v.created_at).sort().at(-1)
    expect(res.last.created_at).toBe(newest)
    expect(await admin.remoteViewsOfClip('no-such-clip')).toEqual({ count: 0, unverified: 0, last: null })
    // R4; round 1, finding 2: the clip whose viewing no ticket matched says so.
    const flagged = store.gatewayViewings.find(v => v.details.unverified_mint)
    const f = await admin.remoteViewsOfClip(flagged.file_id)
    expect(f.unverified).toBeGreaterThan(0)
    expect(f.last.unverified_mint).toBe(true)
    // CONTROL: anyone but an admin counts none, as file_events_select answers.
    const manager = createRabbitFixturesAdapter(store, { userId: MEMBER_ID.theo, workspaceId: WORKSPACE_ID, appRole: 'manager' })
    expect(await manager.remoteViewsOfClip(BIN_FILES[0].id)).toEqual({ count: 0, unverified: 0, last: null })
  })
})

describe('everyone else', () => {
  it('a member reads the view\'s columns of confirmed gateways only, and every verb is refused', async () => {
    const { fx } = make({ role: 'user' })
    const [g] = (await fx.listGateways({ admin: false })).data
    expect(Object.keys(g).sort()).toEqual(['id', 'last_seen_at', 'name', 'platform', 'version'])
    expect((await fx.listGateways({ admin: true })).data).toEqual([])
    expect((await fx.listRemoteViewings()).data).toEqual({ rows: [], total: 0 })
    expect((await fx.listGatewayAudit()).data).toEqual([])
    expect((await fx.makeEnrolmentToken()).ok).toBe(false)
    expect((await fx.forgetGateway(GATEWAY_ID)).ok).toBe(false)
    expect((await fx.updateGateway(GATEWAY_ID, { name: 'Mine now' })).ok).toBe(false)
    expect((await fx.checkGatewayReach(GATEWAY_ID)).status).toBe(403)
    expect(await fx.rotateTicketKeys()).toMatchObject({ ok: false, code: '42501' })
  })
})
