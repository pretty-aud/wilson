/** @vitest-environment jsdom */
// =============================================================================
// gatewaySettings.test.jsx — GW1 (2026-10-10): Settings, Storage, File gateway,
// mounted, against a mocked gatewayApi.
//
// What this pins (the brief's item 4, law by law):
//   Hick — the empty state has ONE button, Add a gateway.
//   Tesler — the token's panel shows the cloud address and, for every footage
//     location, the container's mount line; nobody types them.
//   §11 — the token shown once; it disappears when a gateway spends it.
//   D25 — the fingerprint box only for the admin who made the token; Download
//     certificate only after the fingerprint is confirmed; a malformed one
//     refused before any request.
//   Doherty — Checking… on the click, before the answer.
//   Peak-end — It works: play a clip from outside, the first time only.
//   Selective attention — the error form only for the inside-door forward.
//   Postel — the address and the ranges saved in the database's spelling;
//     a refusal said before any request.
//   Forget — a confirm, Escape runs nothing, Undo within the minute.
//   The viewings table and the trail; a member sees neither, and reads nothing
//     an admin reads.
// Every refusal is asserted with its control: the call that must not happen
// is asserted not to have happened.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../ui/overlay'

const holder = vi.hoisted(() => {
  const names = ['listGateways', 'listEnrolmentTokens', 'listGatewayAudit', 'listRemoteViewings', 'makeEnrolmentToken',
    'cancelEnrolmentToken', 'confirmGatewayFingerprint', 'fetchRootCertificate', 'renameGateway', 'setGatewayOutsideAddress',
    'setGatewayOfficeRanges', 'forgetGateway', 'unforgetGateway', 'requestGatewayUpdateCheck', 'checkGatewayReach', 'gatewayCloudBase',
    'rotateTicketKeys']
  return { ctx: null, perms: null, api: Object.fromEntries(names.map(n => [n, vi.fn()])) }
})
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => holder.ctx }))
vi.mock('../../permissions', () => ({ usePermissions: () => holder.perms }))
vi.mock('../../cloud/gatewayApi', () => holder.api)

const { GatewaySection } = await import('./GatewaySettings')
const W = await import('./gatewayWords')

const BS = String.fromCharCode(92)
const FP = '5ac1f4e2b0d94c3a8e7f61d2c0b9a8774e3d2c1b0a99887766554433221100ff'
const TOKEN = 'wgt_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const ago = (ms) => new Date(Date.now() - ms).toISOString()
const LOCATIONS = [{ id: 'L1', name: 'Footage NAS', unc_path: `${BS}${BS}salthours-nas${BS}footage` }]

function gateway(over = {}) {
  return {
    id: 'g1', name: 'Salt Hours NAS', platform: 'container', version: '1.0.0', hostname: 'salthours-nas',
    inside_addresses: [{ host: '192.168.10.20', port: 8443 }], outside_address: null, root_fingerprint: FP,
    root_confirmed_at: ago(86400e3), reach: { L1: 'reachable' },
    health: { doors: { inside: 'open', outside: 'closed_switch_off', refused_public: 0 }, update: 'up_to_date' },
    office_ranges: [], reach_ok: null, reach_checked_at: null, created_by: 'me', created_at: ago(86400e3),
    last_seen_at: ago(3000), revoked_at: null,
    ...over,
  }
}

const ok = (data) => ({ ok: true, data })
const answer = (fnName, impl) => holder.api[fnName].mockImplementation(impl)

beforeEach(() => {
  _resetOverlaysForTests()
  holder.ctx = { binLocations: LOCATIONS, refreshBinLocations: vi.fn(async () => LOCATIONS), binsInfo: { remoteViewing: false } }
  holder.perms = { ready: true, role: 'admin', userId: 'me', workspaceId: 'w1' }
  for (const f of Object.values(holder.api)) f.mockReset()
  answer('listGateways', async () => ok([]))
  answer('listEnrolmentTokens', async () => ok([]))
  answer('listGatewayAudit', async () => ok([]))
  answer('listRemoteViewings', async () => ok({ rows: [], total: 0 }))
  answer('gatewayCloudBase', () => 'https://abc.supabase.co')
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

const section = () => screen.getByRole('heading', { name: 'File gateway' }).closest('section')
const row = (id = 'g1') => document.querySelector(`[data-gateway-row="${id}"]`)
async function mountWith(gws) {
  answer('listGateways', async () => ok(gws))
  render(<GatewaySection />)
  await waitFor(() => expect(row(gws[0]?.id ?? 'none') || screen.queryByTestId('gateway-empty')).toBeTruthy())
}

describe('the empty state (Hick)', () => {
  it('one button, Add a gateway, and nothing else to press', async () => {
    render(<GatewaySection />)
    await screen.findByTestId('gateway-empty')
    const buttons = within(section()).getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Add a gateway'])
    expect(section().textContent).toContain(W.GATEWAY_EMPTY)
  })
})

describe('Add a gateway: the token, once (§2, §11)', () => {
  it('shows the token, the cloud address and both stories, with the mount lines computed (Tesler)', async () => {
    answer('makeEnrolmentToken', async () => ok({ id: 't1', token: TOKEN, expires_at: ago(-86400e3) }))
    render(<GatewaySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a gateway' }))
    const panel = await screen.findByTestId('gateway-token')
    expect(panel.textContent).toContain(TOKEN)
    expect(panel.textContent).toContain(W.TOKEN_SHOWN_ONCE)
    expect(section().textContent).toContain('https://abc.supabase.co/functions/v1')
    // The NAS story first, with this company's own mount line.
    expect(section().textContent).toContain(W.NAS_STORY.steps[0].text)
    const mounts = within(section()).getByRole('list', { name: 'Your footage locations, mounted' })
    expect(mounts.textContent).toContain('/locations/salthours-nas/footage')
    expect(mounts.textContent).toContain(`${BS}${BS}salthours-nas${BS}footage`)
    // §3's paragraph beside it.
    expect(section().textContent).toContain('Browsers do not trust the root until you tell them to')
    // The Windows tab.
    fireEvent.click(screen.getByRole('tab', { name: 'On a Windows PC' }))
    expect(section().textContent).toContain(W.WINDOWS_STORY.steps[2].text)
    expect(section().textContent).not.toContain(W.NAS_STORY.steps[0].text)
  })

  it('the token disappears once a gateway spends it, and the gateway says it appeared', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    answer('makeEnrolmentToken', async () => ok({ id: 't1', token: TOKEN, expires_at: ago(-86400e3) }))
    render(<GatewaySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a gateway' }))
    await screen.findByTestId('gateway-token')
    expect(section().textContent).toContain('Waiting for the gateway')
    answer('listEnrolmentTokens', async () => ok([{ id: 't1', created_by: 'me', created_at: ago(5000), expires_at: ago(-86400e3), used_at: ago(1000), gateway_id: 'g9' }]))
    answer('listGateways', async () => ok([gateway({ id: 'g9', name: 'salthours-nas', root_confirmed_at: null })]))
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    await waitFor(() => expect(screen.queryByTestId('gateway-token')).toBeNull())
    expect(document.body.textContent).not.toContain(TOKEN)
    expect(row('g9').textContent).toContain('“salthours-nas” appeared just now, and the token is spent.')
    // Made in this browser: no "nobody installed it?" notice.
    expect(row('g9').textContent).not.toContain('no admin in this browser made its token')
  })

  it('a refused token is a sentence, and no panel opens', async () => {
    answer('makeEnrolmentToken', async () => ({ ok: false, code: '54000', friendly: 'This company already has five unused gateway tokens. Cancel one before making another.' }))
    render(<GatewaySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a gateway' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/five unused gateway tokens/)
    expect(screen.queryByTestId('gateway-token')).toBeNull()
  })

  it('an unused token can be cancelled; the token itself is never shown again', async () => {
    answer('listEnrolmentTokens', async () => ok([{ id: 't5', created_by: 'me', created_at: ago(60000), expires_at: ago(-3600e3), used_at: null, gateway_id: null }]))
    answer('cancelEnrolmentToken', async () => ok({ id: 't5' }))
    render(<GatewaySection />)
    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    expect(section().textContent).toContain('The token itself is not shown again.')
    fireEvent.click(cancel)
    await waitFor(() => expect(holder.api.cancelEnrolmentToken).toHaveBeenCalledWith('t5'))
  })
})

describe('the fingerprint (D25)', () => {
  it('only the enrolling admin gets the box; Download certificate waits for it; a malformed one is refused first', async () => {
    answer('confirmGatewayFingerprint', async () => ok(ago(0)))
    await mountWith([gateway({ root_confirmed_at: null })])
    expect(within(row()).queryByRole('button', { name: 'Download certificate' })).toBeNull()
    const box = within(row()).getByLabelText('Certificate fingerprint')
    fireEvent.change(box, { target: { value: 'B1:16' } })
    fireEvent.click(within(row()).getByRole('button', { name: 'Confirm' }))
    expect(row().textContent).toContain(W.FINGERPRINT_SHAPE)
    expect(holder.api.confirmGatewayFingerprint).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: `sha256 Fingerprint=${FP.toUpperCase().match(/../g).join(':')}` } })
    fireEvent.click(within(row()).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(holder.api.confirmGatewayFingerprint).toHaveBeenCalledWith('g1', FP))
  })

  it('another admin\'s gateway: no box, the sentence why; and a gateway nobody here enrolled is flagged', async () => {
    await mountWith([gateway({ root_confirmed_at: null, created_by: 'someone-else' })])
    expect(within(row()).queryByLabelText('Certificate fingerprint')).toBeNull()
    expect(row().textContent).toContain(W.FINGERPRINT_OTHER_ADMIN)
    expect(row().textContent).toContain('and no admin in this browser made its token today')
    // CONTROL: a confirmed gateway carries no such notice.
    cleanup()
    await mountWith([gateway()])
    expect(row().textContent).not.toContain('no admin in this browser made its token')
  })

  it('Download certificate hands over the PEM as a .crt named after the gateway', async () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n'
    answer('fetchRootCertificate', async () => ok(pem))
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:cert'), revokeObjectURL: vi.fn() }))
    const clicked = []
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicked.push(this.download) })
    await mountWith([gateway()])
    fireEvent.click(within(row()).getByRole('button', { name: 'Download certificate' }))
    await waitFor(() => expect(clicked).toEqual(['Salt Hours NAS root certificate.crt']))
    expect(holder.api.fetchRootCertificate).toHaveBeenCalledWith('g1')
    expect(row().textContent).toContain(W.CERTIFICATE_DOWNLOADED)
    spy.mockRestore()
  })
})

describe('Check reach (§4)', () => {
  const withAddress = (over = {}) => gateway({ outside_address: { host: 'gateway.yourcompany.com', port: 8444 }, ...over })

  it('Checking… on the click (Doherty), then the sentence; It works the first time (Peak-end)', async () => {
    let finish
    answer('checkGatewayReach', () => new Promise((r) => { finish = r }))
    await mountWith([withAddress()])
    fireEvent.click(within(row()).getByRole('button', { name: 'Check reach' }))
    expect(row().textContent).toContain(W.CHECKING)
    expect(within(row()).getByRole('button', { name: 'Checking…' }).disabled).toBe(true)
    await act(async () => finish(ok({ outside: { ok: true, detail: 'reached', ms: 143 }, inside_answered: false })))
    await waitFor(() => expect(row().textContent).toContain('Reachable from the internet at gateway.yourcompany.com:8444 (checked just now, certificate OK, 143 ms).'))
    expect(row().textContent).toContain(W.IT_WORKS)
    expect(row().textContent).not.toContain(W.CHECKING)
  })

  it('no It works when the gateway was already reached before (CONTROL for the peak)', async () => {
    answer('checkGatewayReach', async () => ok({ outside: { ok: true, detail: 'reached', ms: 90 }, inside_answered: false }))
    await mountWith([withAddress({ reach_ok: true, reach_checked_at: ago(3600e3) })])
    fireEvent.click(within(row()).getByRole('button', { name: 'Check reach' }))
    await waitFor(() => expect(row().textContent).toContain('Reachable from the internet'))
    expect(row().textContent).not.toContain(W.IT_WORKS)
  })

  it('the inside door answering is the one error, said in its own block, first, and nothing is celebrated', async () => {
    answer('checkGatewayReach', async () => ok({ outside: { ok: true, detail: 'reached', ms: 90 }, inside_answered: true }))
    await mountWith([withAddress()])
    fireEvent.click(within(row()).getByRole('button', { name: 'Check reach' }))
    const alert = await within(row()).findByRole('alert')
    expect(alert.textContent).toBe('Your inside door (port 8443) answers from the internet. Remove that forward: only port 8444 should be open.')
    expect(alert.getAttribute('data-tone')).toBe('error')
    // Selective attention: the error leads; Peak-end: no "It works" beside it.
    expect(alert.nextElementSibling.textContent).toMatch(/^Reachable from the internet/)
    expect(row().textContent).not.toContain(W.IT_WORKS)
  })

  it('🚨 something else answering on the inside port (a tunnel\'s edge) is a plain line after the result, and the first success is still celebrated (round 2, finding 4)', async () => {
    answer('checkGatewayReach', async () => ok({ outside: { ok: true, detail: 'reached', ms: 90 }, inside_answered: false, inside_other: true }))
    await mountWith([withAddress()])
    fireEvent.click(within(row()).getByRole('button', { name: 'Check reach' }))
    await waitFor(() => expect(row().textContent).toContain('Reachable from the internet'))
    expect(within(row()).queryByRole('alert')).toBeNull()
    const line = [...row().querySelectorAll('.s-feedback')].find(p => p.textContent.startsWith('Something else answers on port 8443'))
    expect(line.getAttribute('data-tone')).toBeNull()
    expect(line.previousElementSibling.textContent).toMatch(/^Reachable from the internet/)
    expect(row().textContent).toContain(W.IT_WORKS)
  })

  it('without an outside address it says what to do and asks the cloud nothing', async () => {
    await mountWith([gateway()])
    fireEvent.click(within(row()).getByRole('button', { name: 'Check reach' }))
    expect(row().textContent).toContain('Give the gateway its outside address first')
    expect(holder.api.checkGatewayReach).not.toHaveBeenCalled()
  })

  it('a refusal from the function is its own sentence', async () => {
    answer('checkGatewayReach', async () => ({ ok: false, code: 'busy', friendly: 'A check is running for this gateway; its result appears here in a few seconds.' }))
    await mountWith([withAddress()])
    fireEvent.click(within(row()).getByRole('button', { name: 'Check reach' }))
    expect((await within(row()).findByRole('alert')).textContent).toMatch(/^A check is running/)
  })
})

describe('a name and a version the gateway chose (round 2, finding 2)', () => {
  const RLO = String.fromCharCode(0x202e)
  const ZWSP = String.fromCharCode(0x200b)
  it('🚨 the name shows as words; the new-gateway notice does not repeat it; Forget\'s question quotes it', async () => {
    await mountWith([gateway({ name: `Studio${RLO} NAS${ZWSP} (installed by IT)`, root_confirmed_at: null, created_by: 'someone-else' })])
    expect(row().querySelector('.s-card-title').textContent).toBe('Studio NAS (installed by IT)')
    expect(row().textContent).not.toContain(RLO)
    const notice = [...row().querySelectorAll('.s-feedback')].find(p => p.textContent.includes('no admin in this browser'))
    expect(notice.textContent).toMatch(/^This gateway enrolled /)
    expect(notice.textContent).not.toContain('Studio')
    fireEvent.click(within(row()).getByRole('button', { name: 'Forget' }))
    expect((await screen.findByRole('dialog')).textContent).toContain('Forget “Studio NAS (installed by IT)”? It stops at once')
  })
  it('a member\'s line leaves out a version that is not one', async () => {
    holder.perms = { ready: true, role: 'user', userId: 'u2', workspaceId: 'w1' }
    answer('listGateways', async () => ok([{ id: 'g1', name: 'Salt Hours NAS', platform: 'container', version: '1.0.0 call Petal on 0800', last_seen_at: ago(4000) }]))
    render(<GatewaySection />)
    await waitFor(() => expect(row()).toBeTruthy())
    expect(row().textContent).not.toContain('call Petal')
    expect(row().textContent).toContain('seen just now')
  })
})

describe('Rotate the ticket keys (§5, §10 row 21; round 2, finding 6)', () => {
  it('a quiet row once there is a gateway; a question first; Cancel runs nothing; Rotate rotates, says so, and the trail is read again', async () => {
    answer('rotateTicketKeys', async () => ok({ retired: 1, at: ago(0) }))
    await mountWith([gateway()])
    const button = within(section()).getByRole('button', { name: 'Rotate the ticket keys' })
    expect(section().textContent).toContain(W.TICKET_KEYS_DESCRIPTION)
    fireEvent.click(button)
    let dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain(W.ROTATE_CONFIRM)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(holder.api.rotateTicketKeys).not.toHaveBeenCalled()
    const reads = holder.api.listGatewayAudit.mock.calls.length
    fireEvent.click(button)
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rotate' }))
    await waitFor(() => expect(section().textContent).toContain(W.ROTATED_LINE))
    expect(holder.api.rotateTicketKeys).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(holder.api.listGatewayAudit.mock.calls.length).toBeGreaterThan(reads)
  })
  it('a refusal is its sentence, in the question, and nothing is said rotated', async () => {
    answer('rotateTicketKeys', async () => ({ ok: false, code: '42501', friendly: 'Only a workspace admin can manage the file gateway.' }))
    await mountWith([gateway()])
    fireEvent.click(within(section()).getByRole('button', { name: 'Rotate the ticket keys' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rotate' }))
    await waitFor(() => expect(dialog.textContent).toContain('Only a workspace admin can manage the file gateway.'))
    expect(section().textContent).not.toContain(W.ROTATED_LINE)
  })
  it('no row before the first gateway, nor for a company whose gateways are all forgotten (CONTROL)', async () => {
    await mountWith([gateway({ revoked_at: ago(10e3) })])
    expect(within(section()).queryByRole('button', { name: 'Rotate the ticket keys' })).toBeNull()
  })
})

describe('the health line (Selective attention)', () => {
  it('the error form appears only for the inside-door forward', async () => {
    await mountWith([gateway({ last_seen_at: ago(10 * 60e3), health: { doors: { inside: 'closed_bridge', outside: 'closed_no_cloud:70', refused_public: 0, relay_warning: { address: '192.168.10.77', viewers: 9 } }, update: 'failed:1.1.0:no disk' } })])
    expect(row().textContent).toContain('9 people reached the office door through one address today')
    expect(row().querySelectorAll('[data-tone="error"]')).toHaveLength(0)
    expect(row().querySelectorAll('.s-gw-phrase[data-tone="warning"]').length).toBeGreaterThan(2)
    cleanup()
    await mountWith([gateway({ health: { doors: { inside: 'open', outside: 'closed_switch_off', refused_public: 4 }, update: 'up_to_date' } })])
    const errors = row().querySelectorAll('[data-tone="error"]')
    expect(errors).toHaveLength(1)
    expect(errors[0].textContent).toMatch(/^Your office door is being reached from the internet \(4 refused/)
  })

  it('reads the line §8 writes, with this company\'s location by name', async () => {
    await mountWith([gateway()])
    expect(screen.getByTestId('gateway-health').textContent).toBe('1.0.0 · seen just now · office door open (192.168.10.20:8443) · outside door closed (the switch is off) · Footage NAS: reachable · up to date')
  })
})

describe('changing a gateway (Postel; every refusal before any request)', () => {
  it('Rename: an empty name is refused; a name is saved trimmed', async () => {
    answer('renameGateway', async () => ok(gateway({ name: 'Studio NAS' })))
    await mountWith([gateway()])
    fireEvent.click(within(row()).getByRole('button', { name: 'Rename' }))
    const field = within(row()).getByLabelText('Gateway name')
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.click(within(row()).getByRole('button', { name: 'Save' }))
    expect(row().textContent).toContain(W.NAME_REFUSAL)
    expect(holder.api.renameGateway).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '  Studio NAS  ' } })
    fireEvent.click(within(row()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(holder.api.renameGateway).toHaveBeenCalledWith('g1', 'Studio NAS'))
  })

  it('the outside address: pasted as a URL, saved as { host, port }; an office address refused', async () => {
    answer('setGatewayOutsideAddress', async () => ok(gateway()))
    await mountWith([gateway()])
    fireEvent.click(within(row()).getByRole('button', { name: 'Set' }))
    const field = within(row()).getByLabelText('Outside address')
    fireEvent.change(field, { target: { value: '192.168.1.5' } })
    fireEvent.click(within(row()).getByRole('button', { name: 'Save' }))
    expect(row().textContent).toContain('An outside address is a public name')
    expect(holder.api.setGatewayOutsideAddress).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: 'https://Gateway.YourCompany.com:443/' } })
    fireEvent.click(within(row()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(holder.api.setGatewayOutsideAddress).toHaveBeenCalledWith('g1', { host: 'gateway.yourcompany.com', port: 443 }))
  })

  it('the office ranges: host bits cleared; a public range refused', async () => {
    answer('setGatewayOfficeRanges', async () => ok(gateway()))
    await mountWith([gateway()])
    fireEvent.click(within(row()).getByRole('button', { name: 'Change' }))
    const field = within(row()).getByLabelText('Office ranges')
    fireEvent.change(field, { target: { value: '8.8.8.0/24' } })
    fireEvent.click(within(row()).getByRole('button', { name: 'Save' }))
    expect(row().textContent).toContain('Office ranges are private ranges only')
    expect(holder.api.setGatewayOfficeRanges).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '192.168.20.7/24, 10.8.0.0/16' } })
    fireEvent.click(within(row()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(holder.api.setGatewayOfficeRanges).toHaveBeenCalledWith('g1', ['192.168.20.0/24', '10.8.0.0/16']))
  })

  it('Check now (Windows only) asks the gateway to look for an update', async () => {
    answer('requestGatewayUpdateCheck', async () => ok(ago(0)))
    await mountWith([gateway({ platform: 'windows' })])
    fireEvent.click(within(row()).getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(holder.api.requestGatewayUpdateCheck).toHaveBeenCalledWith('g1'))
    cleanup()
    await mountWith([gateway({ platform: 'container' })])
    expect(within(row()).queryByRole('button', { name: 'Check now' })).toBeNull()
  })
})

describe('Forget (confirm; undoable for a minute)', () => {
  it('asks first; Escape runs nothing; Forget forgets', async () => {
    answer('forgetGateway', async () => ok(ago(0)))
    await mountWith([gateway()])
    fireEvent.click(within(row()).getByRole('button', { name: 'Forget' }))
    const dialog = screen.getByRole('dialog', { name: 'Forget this gateway' })
    expect(dialog.textContent).toContain(W.FORGET_CONFIRM('Salt Hours NAS'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(holder.api.forgetGateway).not.toHaveBeenCalled()
    fireEvent.click(within(row()).getByRole('button', { name: 'Forget' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Forget' }))
    await waitFor(() => expect(holder.api.forgetGateway).toHaveBeenCalledWith('g1'))
  })

  it('a gateway forgotten in the last minute offers Undo, with the seconds left', async () => {
    answer('unforgetGateway', async () => ok(true))
    await mountWith([gateway({ revoked_at: ago(10e3) })])
    expect(row().textContent).toContain(W.FORGOTTEN_LINE)
    const undo = within(row()).getByRole('button', { name: /^Undo \(\d+ s\)$/ })
    expect(Number(undo.textContent.match(/\d+/)[0])).toBeLessThanOrEqual(50)
    fireEvent.click(undo)
    await waitFor(() => expect(holder.api.unforgetGateway).toHaveBeenCalledWith('g1'))
  })
})

describe('what was viewed from outside, and what changed', () => {
  const viewing = (id, over = {}) => ({
    id, project_id: 'p1', project_title: 'Salt Hours', file_id: 'c1', file_name: 'A001_C001_0921AB.mov', actor_label: 'Priya Raman',
    created_at: '2026-10-08T14:02:00Z',
    details: { gateway_name: 'Salt Hours NAS', bytes: 920 * 1024 * 1024, clip_bytes: 1000 * 1024 * 1024, fraction: 0.92, read_in_full: true, source_address: '203.0.113.7', via: 'cloudflare', ...over },
  })

  it('the table: when, who, clip and project, how much, from where, which gateway; shared_url and unverified_mint said', async () => {
    answer('listRemoteViewings', async () => ok({ rows: [viewing(2), viewing(1, { unverified_mint: true, shared_url: true, source_addresses: ['203.0.113.7', '198.51.100.9'] })], total: 2 }))
    render(<GatewaySection />)
    const table = await screen.findByTestId('gateway-viewings')
    expect([...table.querySelectorAll('th')].map(th => th.textContent)).toEqual(['When', 'Who', 'Clip and project', 'How much', 'From where, through'])
    const [first, second] = table.querySelectorAll('tbody tr')
    expect(first.textContent).toContain('A001_C001_0921AB.mov')
    expect(first.textContent).toContain('Salt Hours')
    expect(first.textContent).toContain('920 MB of 1000 MB (92%) · read in full')
    expect(first.textContent).toContain('203.0.113.7 via Cloudflare Tunnel')
    expect(first.textContent).toContain('Salt Hours NAS')
    expect(second.textContent).toContain('no matching ticket on record')
    expect(second.textContent).toContain('one link played from 2 addresses')
    expect(holder.api.listRemoteViewings).toHaveBeenCalledWith({ page: 0, pageSize: 25 })
  })

  it('pages of twenty-five, newest first', async () => {
    answer('listRemoteViewings', async ({ page }) => ok({ rows: [viewing(page + 1)], total: 30 }))
    render(<GatewaySection />)
    await screen.findByTestId('gateway-viewings')
    expect(section().textContent).toContain('1–25 of 30')
    fireEvent.click(screen.getByRole('button', { name: 'Older' }))
    await waitFor(() => expect(holder.api.listRemoteViewings).toHaveBeenLastCalledWith({ page: 1, pageSize: 25 }))
  })

  it('none in 30 days says so, once there is a gateway; before the first one the card is the one button', async () => {
    await mountWith([gateway()])
    await waitFor(() => expect(section().textContent).toContain(W.VIEWED_EMPTY))
    expect(section().textContent).toContain(W.AUDIT_EMPTY)
    cleanup()
    answer('listGateways', async () => ok([]))
    render(<GatewaySection />)
    await screen.findByTestId('gateway-empty')
    expect(section().textContent).not.toContain(W.VIEWED_EMPTY)
    expect(section().textContent).not.toContain(W.AUDIT_EMPTY)
    // CONTROL: a company that forgot its gateways still reads its trail.
    cleanup()
    answer('listGatewayAudit', async () => ok([{ id: 1, action: 'gateway.forgotten', actor_label: 'Mara Okonkwo', details: { name: 'Old NAS' }, created_at: '2026-10-01T09:00:00Z' }]))
    render(<GatewaySection />)
    expect((await screen.findByTestId('gateway-audit')).textContent).toContain('Mara Okonkwo forgot “Old NAS”')
  })

  it('the last twenty changes, in words', async () => {
    answer('listGatewayAudit', async () => ok([
      { id: 2, action: 'remote_viewing.on', actor_user_id: 'me', actor_label: 'Mara Okonkwo', details: {}, created_at: '2026-10-09T09:00:00Z' },
      { id: 1, action: 'gateway.enrolled', actor_user_id: 'me', actor_label: 'Mara Okonkwo', gateway_id: 'g1', details: { name: 'salthours-nas', platform: 'container', version: '1.0.0' }, created_at: '2026-10-08T09:00:00Z' },
    ]))
    await mountWith([gateway()])
    const list = await screen.findByTestId('gateway-audit')
    expect(list.textContent).toContain('Mara Okonkwo turned viewing from outside the office on')
    expect(list.textContent).toContain('Mara Okonkwo enrolled “Salt Hours NAS” (a container, 1.0.0)')
    expect(holder.api.listGatewayAudit).toHaveBeenCalledWith({ limit: 20 })
  })
})

describe('everyone else (the switch\'s rule)', () => {
  it('a member sees the gateway and why they cannot change it, and reads nothing an admin reads', async () => {
    holder.perms = { ready: true, role: 'user', userId: 'u2', workspaceId: 'w1' }
    answer('listGateways', async ({ admin }) => ok(admin ? [gateway()] : [{ id: 'g1', name: 'Salt Hours NAS', platform: 'container', version: '1.0.0', last_seen_at: ago(4000) }]))
    render(<GatewaySection />)
    await waitFor(() => expect(row()).toBeTruthy())
    expect(holder.api.listGateways).toHaveBeenCalledWith(expect.objectContaining({ admin: false }))
    expect(section().textContent).toContain(W.GATEWAY_ADMIN_ONLY)
    expect(within(section()).queryAllByRole('button')).toHaveLength(0)
    for (const f of ['listEnrolmentTokens', 'listGatewayAudit', 'listRemoteViewings']) expect(holder.api[f], f).not.toHaveBeenCalled()
  })

  it('nothing is read before the role is known', async () => {
    holder.perms = { ready: false, role: null }
    const { container } = render(<GatewaySection />)
    await new Promise(r => setTimeout(r, 20))
    expect(container.textContent).toBe('')
    expect(holder.api.listGateways).not.toHaveBeenCalled()
  })
})
