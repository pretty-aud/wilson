/** @vitest-environment jsdom */
// footageSettings.test.jsx — Settings, Storage: the company's footage
// locations (BC2 item 2).
//
// What this pins:
//   * the list: each location's own name (in its own case), its network
//     address in the data mono, who added it (B11) and — on the desktop
//     only — what this computer can reach;
//   * adding: a pasted smb:// or // address is stored as \\server\share; a
//     drive letter, a blank name and an address already in the list are
//     refused with the database's sentence BEFORE any request; a refusal
//     the backend words is shown without its bracketed prefix;
//   * the per-computer question appears only on the desktop, only where
//     this computer cannot reach the share; a saved folder offers Forget;
//   * edit (rename / re-address) and remove go through the provider's verbs;
//     a location still in use is refused with its sentence, inline.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const holder = vi.hoisted(() => ({ ctx: null, perms: { ready: true, role: 'admin', workspaceId: 'w1' } }))
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => holder.ctx }))
vi.mock('../../permissions', () => ({ usePermissions: () => holder.perms }))
vi.mock('../TeamMembers/useWorkspaceMembers', () => ({ useWorkspaceMembers: () => ({ members: [{ user_id: 'u1', display_name: 'Sofia Aldana' }] }) }))
vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: null }))

const { FootageLocationsSection, RemoteViewingSection } = await import('./FootageSettings')
const { REMOTE_VIEWING_LABEL, REMOTE_VIEWING_TPN_SENTENCE } = await import('../../tools/rabbit_v0.1.0/bins/cloudPosters')
const { BINS_REFUSALS } = await import('../../tools/rabbit_v0.1.0/adapters/supabaseAdapter')

function makeCtx(over = {}) {
  return {
    binLocations: [
      { id: 'L1', name: 'Footage NAS', unc_path: '\\\\salthours-nas\\footage', added_by: 'u1' },
      { id: 'L2', name: 'vfx plates', unc_path: '\\\\salthours-nas\\vfx', added_by: 'gone' },
    ],
    binsInfo: { locations: [] },
    binsDesktopFiles: false,
    refreshBinLocations: vi.fn(async () => []),
    addBinLocation: vi.fn(async (l) => ({ id: 'L9', ...l })),
    updateBinLocation: vi.fn(async (id, p) => ({ id, ...p })),
    removeBinLocation: vi.fn(async (id) => ({ id })),
    pickBinLocationLocalPath: vi.fn(async () => ({ local_path: 'Z:\\' })),
    forgetBinLocationLocalPath: vi.fn(async () => ({ local_path: null })),
    ...over,
  }
}

beforeEach(() => { holder.ctx = makeCtx(); holder.perms = { ready: true, role: 'admin', workspaceId: 'w1' } })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const row = (id) => document.querySelector(`[data-location-row="${id}"]`)
const nameField = () => screen.getByLabelText('New location name')
const addrField = () => screen.getByLabelText('New location network address')

describe('the company\'s list', () => {
  it('reads the list on arrival; each row: its own name in its own case, the address, who added it', async () => {
    render(<FootageLocationsSection />)
    expect(holder.ctx.refreshBinLocations).toHaveBeenCalled()
    const l1 = row('L1')
    expect(within(l1).getByText('Footage NAS').className).toContain('s-card-title')
    expect(within(l1).getByText('\\\\salthours-nas\\footage').className).toContain('s-data')
    expect(l1.textContent).toContain('Added by Sofia Aldana')
    expect(row('L2').textContent).toContain('vfx plates')
    expect(row('L2').textContent).toContain('Added by someone who has left')
    // In a browser there is no desktop: nothing is said about reaching it.
    expect(l1.textContent).not.toMatch(/reachable|this computer/i)
    expect(screen.queryByText('Where is it on this computer?')).toBeNull()
  })

  it('an empty list says what to add, by network address', () => {
    holder.ctx = makeCtx({ binLocations: [] })
    render(<FootageLocationsSection />)
    expect(document.body.textContent).toContain('\\\\server\\footage')
  })
})

describe('adding a location', () => {
  it('a pasted smb:// address is stored as \\\\server\\share', async () => {
    render(<FootageLocationsSection />)
    fireEvent.change(nameField(), { target: { value: 'Sound' } })
    fireEvent.change(addrField(), { target: { value: 'smb://salthours-nas/sound/' } })
    fireEvent.click(screen.getByText('Add location'))
    await waitFor(() => expect(holder.ctx.addBinLocation).toHaveBeenCalledWith({ name: 'Sound', unc_path: '\\\\salthours-nas\\sound' }))
  })

  it('a drive letter is refused with the database\'s sentence before any request', async () => {
    render(<FootageLocationsSection />)
    fireEvent.change(nameField(), { target: { value: 'Local' } })
    fireEvent.change(addrField(), { target: { value: 'C:\\Footage' } })
    fireEvent.click(screen.getByText('Add location'))
    expect((await screen.findByRole('alert')).textContent).toContain(BINS_REFUSALS.locationShape)
    expect(holder.ctx.addBinLocation).not.toHaveBeenCalled()
  })

  it('an address already in the list is refused with its sentence, compared as Windows compares', async () => {
    render(<FootageLocationsSection />)
    fireEvent.change(nameField(), { target: { value: 'Again' } })
    fireEvent.change(addrField(), { target: { value: '\\\\SALTHOURS-NAS\\Footage' } })
    fireEvent.click(screen.getByText('Add location'))
    expect((await screen.findByRole('alert')).textContent).toContain(BINS_REFUSALS.locationExists)
    expect(holder.ctx.addBinLocation).not.toHaveBeenCalled()
  })

  it('a refusal the backend words is shown without its bracketed prefix', async () => {
    holder.ctx = makeCtx({ addBinLocation: vi.fn(async () => { throw Object.assign(new Error('[supabase] you cannot change this company\'s footage locations'), { code: '42501' }) }) })
    render(<FootageLocationsSection />)
    fireEvent.change(nameField(), { target: { value: 'Sound' } })
    fireEvent.change(addrField(), { target: { value: '\\\\nas\\sound' } })
    fireEvent.click(screen.getByText('Add location'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('you cannot change this company\'s footage locations')
  })
})

describe('the per-computer question (B2\'s fallback), on the desktop only', () => {
  it('asked only where this computer cannot reach the share; a saved folder offers Forget', async () => {
    holder.ctx = makeCtx({
      binsDesktopFiles: true,
      binsInfo: { locations: [
        { id: 'L1', status: 'registered', reachable: false, local_path: null },
        { id: 'L2', status: 'registered', reachable: true, local_path: 'Z:\\vfx', local_path_source: 'saved' },
      ] },
    })
    render(<FootageLocationsSection />)
    expect(row('L1').textContent).toContain('Not reachable from this computer')
    expect(row('L2').textContent).toContain('On this computer at Z:\\vfx')
    fireEvent.click(within(row('L1')).getByText('Where is it on this computer?'))
    await waitFor(() => expect(holder.ctx.pickBinLocationLocalPath).toHaveBeenCalledWith('L1'))
    expect(within(row('L2')).queryByText('Where is it on this computer?')).toBeNull()
    fireEvent.click(within(row('L2')).getByText('Forget this computer\'s folder'))
    await waitFor(() => expect(holder.ctx.forgetBinLocationLocalPath).toHaveBeenCalledWith('L2'))
  })

  it('a reachable share asks nothing', () => {
    holder.ctx = makeCtx({ binsDesktopFiles: true, binsInfo: { locations: [{ id: 'L1', status: 'registered', reachable: true, local_path: null }] } })
    render(<FootageLocationsSection />)
    expect(row('L1').textContent).toContain('Reachable from this computer')
    expect(screen.queryByText('Where is it on this computer?')).toBeNull()
  })
})

// Review round 1: consent before contact. Any member can name a company
// location; this computer connects to its address only once its own person
// agrees (the desktop's native confirmation, naming the address).
describe('Connect: consent before this computer contacts an address', () => {
  it('a location not connected here says so and offers Connect, which asks the desktop', async () => {
    holder.ctx = makeCtx({ binsDesktopFiles: true, connectBinLocation: vi.fn(async () => ({ connected: true, reachable: true })), binsInfo: { locations: [{ id: 'L1', status: 'registered', connected: false, reachable: false }] } })
    render(<FootageLocationsSection />)
    expect(row('L1').textContent).toContain('Not connected on this computer')
    const connect = within(row('L1')).getByText('Connect…')
    expect(connect.getAttribute('title')).toContain('Windows asks you to confirm the address first')
    fireEvent.click(connect)
    await waitFor(() => expect(holder.ctx.connectBinLocation).toHaveBeenCalledWith('L1'))
    // A connected location offers no Connect.
    expect(within(row('L2')).queryByText('Connect…')).toBeNull()
  })

  it('the person who just added an address on the desktop is asked at once; in a browser, never', async () => {
    holder.ctx = makeCtx({ binsDesktopFiles: true, connectBinLocation: vi.fn(async () => ({ canceled: true })) })
    render(<FootageLocationsSection />)
    fireEvent.change(nameField(), { target: { value: 'Office share' } })
    fireEvent.change(addrField(), { target: { value: '\\\\office\\footage' } })
    fireEvent.click(screen.getByText('Add location'))
    await waitFor(() => expect(holder.ctx.connectBinLocation).toHaveBeenCalledWith('L9'))
    cleanup()
    holder.ctx = makeCtx({ connectBinLocation: vi.fn() })
    render(<FootageLocationsSection />)
    fireEvent.change(nameField(), { target: { value: 'Office share' } })
    fireEvent.change(addrField(), { target: { value: '\\\\office\\footage' } })
    fireEvent.click(screen.getByText('Add location'))
    await waitFor(() => expect(holder.ctx.addBinLocation).toHaveBeenCalled())
    expect(holder.ctx.connectBinLocation).not.toHaveBeenCalled()
  })
})

describe('edit and remove', () => {
  it('rename and re-address send only what changed; the re-address is normalised', async () => {
    render(<FootageLocationsSection />)
    fireEvent.click(within(row('L1')).getByText('Edit'))
    fireEvent.change(screen.getByLabelText('Network address'), { target: { value: '//new-nas/footage' } })
    expect(document.body.textContent).toContain('points every clip of this location at the new share')
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(holder.ctx.updateBinLocation).toHaveBeenCalledWith('L1', { unc_path: '\\\\new-nas\\footage' }))
  })

  it('a location still in use is refused with its sentence, on its own row', async () => {
    holder.ctx = makeCtx({ removeBinLocation: vi.fn(async () => { throw Object.assign(new Error(`[supabase] ${BINS_REFUSALS.locationInUse}`), { code: '23503' }) }) })
    render(<FootageLocationsSection />)
    fireEvent.click(within(row('L1')).getByText('Remove'))
    await waitFor(() => expect(within(row('L1')).getByRole('alert').textContent).toContain(BINS_REFUSALS.locationInUse))
  })
})

// ── Item 7: the company's switch (B5a) ───────────────────────────────────────
describe('the switch: admins only, off by default, the §4b sentence at the switch', () => {
  const switchCtx = (over = {}) => makeCtx({
    binsInfo: { locations: [], remoteViewing: false },
    refreshRemoteViewing: vi.fn(async () => false),
    setRemoteViewingEnabled: vi.fn(async (on) => on),
    ...over,
  })
  const theRow = () => document.querySelector('[data-testid="remote-viewing-row"]')

  it('an admin: the switch, its label, and the TPN sentence directly under the label', () => {
    holder.ctx = switchCtx()
    render(<RemoteViewingSection />)
    expect(holder.ctx.refreshRemoteViewing).toHaveBeenCalledWith({ workspaceId: 'w1' })
    const sw = screen.getByRole('switch')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(sw.getAttribute('aria-label')).toBe(REMOTE_VIEWING_LABEL)
    const label = theRow().querySelector('label.s-card-title')
    expect(label.textContent).toBe('Allow files to be viewed from outside the office network')
    expect(label.getAttribute('for')).toBe(sw.id)
    // Proximity: the first thing under the label is the sentence.
    expect(label.nextElementSibling.textContent).toBe(REMOTE_VIEWING_TPN_SENTENCE)
    expect(REMOTE_VIEWING_TPN_SENTENCE).toContain('Turning on external access is the moment this workspace leaves TPN Gold Shield eligibility')
    expect(document.body.textContent).toContain('Turning it off deletes nothing: pictures already uploaded stay')
  })

  it('flipping it is the provider\'s undoable verb, for this company', async () => {
    holder.ctx = switchCtx()
    render(<RemoteViewingSection />)
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(holder.ctx.setRemoteViewingEnabled).toHaveBeenCalledWith(true, { workspaceId: 'w1' }))
  })

  it('a refusal is shown without its bracketed prefix', async () => {
    holder.ctx = switchCtx({ setRemoteViewingEnabled: vi.fn(async () => { throw new Error(`[supabase] ${BINS_REFUSALS.switchAdminOnly}`) }) })
    render(<RemoteViewingSection />)
    fireEvent.click(screen.getByRole('switch'))
    expect((await screen.findByRole('alert')).textContent).toBe(BINS_REFUSALS.switchAdminOnly)
  })

  it('not yet read: the switch waits (never flipped from an unknown state)', () => {
    holder.ctx = switchCtx({ binsInfo: { locations: [], remoteViewing: null } })
    render(<RemoteViewingSection />)
    expect(screen.getByRole('switch').disabled).toBe(true)
  })

  // GW1 (2026-10-10): GATEWAY_DESIGN.md §9 point 7 — the card's description
  // says what the switch now does to the gateway's outside door, word for
  // word, in place of "comes with the WILSON file gateway, later"; the label
  // and the TPN sentence are unchanged and first.
  it('the description is §9 point 7\'s, verbatim; the label and the TPN sentence stay first', () => {
    holder.ctx = switchCtx()
    render(<RemoteViewingSection />)
    const design = readFileSync(resolve(process.cwd(), 'docs/design/GATEWAY_DESIGN.md'), 'utf8')
    const point7 = design.match(/^7\. \*\*The control\*\*.*? to \*(While it is on, the gateway[^*]+)\*/m)[1]
    const desc = document.querySelector('.s-section-desc').textContent
    expect(desc).toContain(point7)
    expect(desc).not.toContain('comes with the WILSON file gateway, later')
    // The VPN clause is there (review round 2, R9): a VPN user's viewing is not written down.
    expect(point7).toContain('people on the office network or the company\'s VPN use the office door, which writes nothing down')
    const label = theRow().querySelector('label.s-card-title')
    expect(label.textContent).toBe(REMOTE_VIEWING_LABEL)
    expect(label.nextElementSibling.textContent).toBe(REMOTE_VIEWING_TPN_SENTENCE)
  })

  it('everyone else: its state, the TPN sentence, and why they cannot change it — no switch', () => {
    holder.perms = { ready: true, role: 'member', workspaceId: 'w1' }
    holder.ctx = switchCtx({ binsInfo: { locations: [], remoteViewing: true } })
    render(<RemoteViewingSection />)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(theRow().querySelector('.s-badge').textContent).toBe('On')
    expect(theRow().textContent).toContain(REMOTE_VIEWING_TPN_SENTENCE)
    expect(theRow().textContent).toContain(BINS_REFUSALS.switchAdminOnly)
  })
})
