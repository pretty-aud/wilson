/** @vitest-environment jsdom */
// =============================================================================
// RequestsView.test.jsx — B2 (2026-10-27), design §5.3: the two sections the
// view gains at the top.
//
//   * "Shared with you": a pending offer (Accept, Decline), an onward offer
//     naming who passed whose subject on, a `gone` offer (No longer available,
//     Dismiss), a link whose host course I deleted (Remove), and a batch as
//     ONE card — Accept all SKIPS `gone` rows, Decline all TAKES them, a
//     `gone` row carries Dismiss, and either loop stops at the first other
//     refusal with its sentence, the rows it did not reach left pending.
//   * "Shared by you": every row of my subject, the chain line's *via*
//     resolved from the same list, the batch line with Withdraw all, the
//     Withdraw confirm with the chain's sentence, decided rows folded.
// =============================================================================

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'

const calls = []
let refuse = {}
vi.mock('../adapters', () => ({
  otterFetch: async (url, init) => {
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    if (method === 'GET') return reply(200, [])
    const r = refuse[url]
    if (r) return reply(r.status, { error: r.error })
    if (url.endsWith('/accept')) return reply(200, { host_course_id: 'host-1' })
    return reply(200, { ok: true })
  },
}))
const { default: RequestsView } = await import('./RequestsView.jsx')

beforeEach(() => { calls.length = 0; refuse = {} })
afterEach(cleanup)

const ME = 'u-me'
const row = (over = {}) => ({
  id: 'sh-1', subject_id: 's-1', subject_title: 'Modifiers', subject_is_stub: false,
  course_id: null, course_name: 'Blender 5.0', skill_level: null,
  shared_by: 'u-audrey', sharer_label: 'Audrey', shared_with: ME, receiver_label: 'Me',
  subject_owner_id: 'u-audrey', owner_label: 'Audrey', batch_id: null, via_share_id: null, chain_depth: 1,
  status: 'pending', state: 'pending', message: null, host_course_id: null, host_live: null,
  created_at: new Date(Date.now() - 2 * 86400000).toISOString(), responded_at: null, ended_by: null,
  is_mine: false, is_owner: false,
  ...over,
})
const shareCalls = () => calls.filter(c => c.includes('/subject-shares/'))

function mount(shares, extra = {}) {
  const onSharesChanged = vi.fn(async () => shares)
  const onSharesAccepted = vi.fn()
  render(<RequestsView role="member" userId={ME} softwareList={[]} refreshTick={0}
    shares={shares} onSharesChanged={onSharesChanged} onSharesAccepted={onSharesAccepted} {...extra} />)
  return { onSharesChanged, onSharesAccepted }
}
const section = (name) => screen.getByRole('heading', { name: new RegExp(`^${name}`) }).closest('section')

describe('"Shared with you" (design §5.3)', () => {
  it('draws only when it has rows; the description line says the view holds shares too', () => {
    mount([])
    expect(screen.queryByRole('heading', { name: /Shared with you/ })).toBeNull()
    expect(screen.getByText('Courses you have put forward, changes you have suggested, the feedback that came back, and subjects shared with you.')).toBeTruthy()
  })

  it('each state in its words, with its one control', () => {
    const shares = [
      row({ id: 'p', message: 'For Monday' }),
      row({ id: 'onward', via_share_id: 'up', shared_by: 'u-ben', sharer_label: 'Ben', subject_title: 'Rigging' }),
      row({ id: 'g', subject_title: 'Armatures', state: 'gone' }),
      row({ id: 'dead', subject_title: 'Weights', status: 'accepted', state: 'accepted', host_course_id: 'h', host_live: false }),
    ]
    const { onSharesChanged } = mount(shares)
    expect(onSharesChanged).toHaveBeenCalled()   // the index is re-read on mount
    const s = section('Shared with you')
    expect(within(s).getByRole('heading').textContent).toMatch(/· 4$/)
    const item = (title) => within(s).getByText(title).closest('li')
    expect(within(item('Modifiers')).getByText('from Audrey · Blender 5.0 · 2 days ago')).toBeTruthy()
    expect(within(item('Modifiers')).getByText('“For Monday”')).toBeTruthy()
    expect(within(item('Modifiers')).getByRole('button', { name: 'Accept' })).toBeTruthy()
    expect(within(item('Modifiers')).getByRole('button', { name: 'Decline' })).toBeTruthy()
    expect(within(item('Rigging')).getByText("Ben passes you Audrey's «Rigging» · Blender 5.0 · 2 days ago")).toBeTruthy()
    expect(within(item('Armatures')).getByText('No longer available')).toBeTruthy()
    expect(within(item('Armatures')).getByRole('button', { name: 'Dismiss' })).toBeTruthy()
    expect(within(item('Armatures')).queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(within(item('Weights')).getByText('Its course in your library was deleted: restore it from Recently deleted, or remove this link.')).toBeTruthy()
    expect(within(item('Weights')).getByRole('button', { name: 'Remove' })).toBeTruthy()
  })

  it('Accept hands the host back to Otter.jsx; Decline and Dismiss decline', async () => {
    const p = row({ id: 'p' })
    const { onSharesAccepted } = mount([p, row({ id: 'g', subject_title: 'Armatures', state: 'gone' })])
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(onSharesAccepted).toHaveBeenCalledWith({ hostCourseId: 'host-1', rows: [p] }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(shareCalls()).toEqual(['POST /api/otter/subject-shares/p/accept', 'POST /api/otter/subject-shares/g/decline']))
  })

  it('Remove (a dead host) confirms, counting what I passed on below, then revokes', async () => {
    const dead = row({ id: 'dead', subject_title: 'Weights', status: 'accepted', state: 'accepted', host_course_id: 'h', host_live: false })
    const below = row({ id: 'k', shared_by: ME, is_mine: true, shared_with: 'u-kim', via_share_id: 'dead', chain_depth: 2, subject_title: 'Weights' })
    mount([dead, below])
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByText('It leaves your course. Your ticks are kept, and come back if it is shared with you again. Removing it ends it for the 1 person you passed it on to, and for anyone they passed it on to.')).toBeTruthy()
    fireEvent.click(within(screen.getByText(/It leaves your course/).closest('.otter-req-confirm')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(shareCalls()).toEqual(['POST /api/otter/subject-shares/dead/revoke']))
  })
})

describe('a batch is ONE card (design §1.5, §5.3)', () => {
  const batch = [
    row({ id: 'a', batch_id: 'B', subject_title: 'Alpha' }),
    row({ id: 'b', batch_id: 'B', subject_title: 'Beta', state: 'gone' }),
    row({ id: 'c', batch_id: 'B', subject_title: 'Gamma', subject_is_stub: true }),
    row({ id: 'd', batch_id: 'B', subject_title: 'Delta' }),
  ]
  const card = () => screen.getByText('Audrey shared their course «Blender 5.0» with you: 4 subjects').closest('li')

  it('its head, the gone count, the rows in title order, the one per-row control on a gone row', () => {
    mount(batch)
    expect(within(card()).getByText(/1 of 4 is no longer available/)).toBeTruthy()
    const titles = [...card().querySelectorAll('.otter-req-settled > li .otter-req-title')].map(n => n.firstChild.textContent)
    expect(titles).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma'])
    expect(within(card()).getAllByRole('button', { name: 'Dismiss' }).length).toBe(1)
    expect(within(card()).queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(within(card()).getByText(/outline only/)).toBeTruthy()
  })

  it('Accept all SKIPS the gone row, then lands every accepted row in the one host', async () => {
    const { onSharesAccepted } = mount(batch)
    fireEvent.click(within(card()).getByRole('button', { name: 'Accept all' }))
    await waitFor(() => expect(onSharesAccepted).toHaveBeenCalled())
    expect(shareCalls()).toEqual([
      'POST /api/otter/subject-shares/a/accept', 'POST /api/otter/subject-shares/d/accept', 'POST /api/otter/subject-shares/c/accept',
    ])
    expect(onSharesAccepted.mock.calls[0][0].rows.map(r => r.id)).toEqual(['a', 'd', 'c'])
  })

  it('Accept all stops at the first OTHER refusal, says it, and leaves the rest pending (the card stays)', async () => {
    refuse = { '/api/otter/subject-shares/d/accept': { status: 409, error: 'that subject has changed hands since it was shared' } }
    const { onSharesAccepted, onSharesChanged } = mount(batch)
    const before = onSharesChanged.mock.calls.length
    fireEvent.click(within(card()).getByRole('button', { name: 'Accept all' }))
    expect(await screen.findByText('that subject has changed hands since it was shared')).toBeTruthy()
    expect(shareCalls()).toEqual(['POST /api/otter/subject-shares/a/accept', 'POST /api/otter/subject-shares/d/accept'])
    expect(onSharesAccepted).not.toHaveBeenCalled()
    expect(onSharesChanged.mock.calls.length).toBeGreaterThan(before)   // the card is re-read, holding what is left
  })

  it('Decline all TAKES the gone row too, and stops at the first refusal', async () => {
    refuse = { '/api/otter/subject-shares/c/decline': { status: 409, error: 'this share is accepted — only a pending share can be declined' } }
    mount(batch)
    fireEvent.click(within(card()).getByRole('button', { name: 'Decline all' }))
    expect(await screen.findByText('this share is accepted — only a pending share can be declined')).toBeTruthy()
    expect(shareCalls()).toEqual([
      'POST /api/otter/subject-shares/a/decline', 'POST /api/otter/subject-shares/b/decline',
      'POST /api/otter/subject-shares/d/decline', 'POST /api/otter/subject-shares/c/decline',
    ])
  })

  it('a 500 stops the loop too, and is not shown as a refusal', async () => {
    refuse = { '/api/otter/subject-shares/a/accept': { status: 500, error: 'JWT expired' } }
    mount(batch)
    fireEvent.click(within(card()).getByRole('button', { name: 'Accept all' }))
    expect(await screen.findByText(/did not reach the workspace \(HTTP 500\)/)).toBeTruthy()
    expect(screen.queryByText('JWT expired')).toBeNull()
    expect(shareCalls()).toEqual(['POST /api/otter/subject-shares/a/accept'])
  })
})

describe('"Shared by you" (design §5.3, §1.4)', () => {
  const mine = (over) => row({ shared_by: ME, sharer_label: 'Me', subject_owner_id: ME, owner_label: 'Me', is_mine: true, is_owner: true, ...over })
  const shares = [
    mine({ id: 'm', shared_with: 'u-mara', receiver_label: 'Mara', status: 'accepted', state: 'accepted' }),
    row({ id: 'b', shared_by: 'u-mara', sharer_label: 'Mara', shared_with: 'u-ben', receiver_label: 'Ben', subject_owner_id: ME,
      owner_label: 'Me', via_share_id: 'm', chain_depth: 2, status: 'accepted', state: 'accepted', is_owner: true }),
    mine({ id: 'l1', shared_with: 'u-lee', receiver_label: 'Lee', batch_id: 'BL', subject_title: 'Rigging', status: 'accepted', state: 'accepted' }),
    mine({ id: 'l2', shared_with: 'u-lee', receiver_label: 'Lee', batch_id: 'BL', subject_title: 'Armatures' }),
    mine({ id: 'x', shared_with: 'u-zed', receiver_label: 'Zed', status: 'revoked', state: 'revoked', ended_by: 'u-zed' }),
  ]

  it('the chain line reads "Ben via Mara", the parent resolved from the same list', () => {
    mount(shares)
    const s = section('Shared by you')
    expect(within(s).getByText('Mara · accepted')).toBeTruthy()
    expect(within(s).getByText('Ben via Mara · accepted')).toBeTruthy()
  })

  it('a batch is one line with Withdraw all, folding open to its rows', () => {
    mount(shares)
    const line = screen.getByText('shared whole with Lee · 2 subjects · 1 accepted, 1 waiting').closest('li')
    expect(within(line).getByRole('button', { name: 'Withdraw all' })).toBeTruthy()
    expect(within(line).queryByText('Rigging')).toBeNull()
    fireEvent.click(within(line).getByRole('button', { name: /Subjects/ }))
    expect(within(line).getByText('Rigging')).toBeTruthy()
    expect(within(line).getByText('Armatures')).toBeTruthy()
  })

  it('Withdraw confirms with the chain\'s sentence, then revokes the one row', async () => {
    mount(shares)
    const mara = screen.getByText('Mara · accepted').closest('li')
    fireEvent.click(within(mara).getByRole('button', { name: 'Withdraw' }))
    expect(within(mara).getByText('Mara will lose the link. Their own progress stays theirs. Removing it ends it for the 1 person it was passed on to, and for anyone they passed it on to.')).toBeTruthy()
    fireEvent.click(within(mara.querySelector('.otter-req-confirm')).getByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(shareCalls()).toEqual(['POST /api/otter/subject-shares/m/revoke']))
  })

  it('Withdraw all revokes the batch\'s live rows, in order, after its confirm', async () => {
    mount(shares)
    const line = screen.getByText(/shared whole with Lee/).closest('li')
    fireEvent.click(within(line).getByRole('button', { name: 'Withdraw all' }))
    fireEvent.click(within(line.querySelector('.otter-req-confirm')).getByRole('button', { name: 'Withdraw all' }))
    await waitFor(() => expect(shareCalls()).toEqual(['POST /api/otter/subject-shares/l2/revoke', 'POST /api/otter/subject-shares/l1/revoke']))
  })

  it('decided rows fold under Show decided, in the receiver-removed words', () => {
    mount(shares)
    expect(screen.queryByText('Zed · they removed it')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Show decided · 1/ }))
    expect(screen.getByText('Zed · they removed it')).toBeTruthy()
  })
})
