/** @vitest-environment jsdom */
// The Team tab's gallery (post-overhaul FX3). Audrey, 2026-10-11: "for the
// team tab in rabbit. allow the user to see the items/members as a gallery.
// using the profile pic as a image for the cards in the gallery. allow the
// user to change views from table/list to gallery."
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')

const rabbit = vi.hoisted(() => ({ current: null }))
const perms = vi.hoisted(() => ({ current: { role: 'user', ready: true } }))
const dir = vi.hoisted(() => ({ current: { members: [], loading: false, error: null } }))
const team = vi.hoisted(() => ({ current: { members: [], loading: false, reload: () => {} } }))
const sb = vi.hoisted(() => ({ calls: [], answer: null }))

vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => perms.current }))
vi.mock('../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => team.current }))
vi.mock('../../../components/TeamMembers/useWorkspaceMembers', async (importOriginal) => ({
  ...(await importOriginal()),
  useWorkspaceMembers: () => dir.current,
}))
vi.mock('../../../cloud/auth/supabaseClient', () => ({
  hydrateSupabase: async () => {},
  supabase: {
    storage: {
      from: (bucket) => ({
        createSignedUrls: async (paths, ttl) => {
          sb.calls.push({ bucket, paths, ttl })
          return { data: paths.map((p) => (sb.answer ? sb.answer(p) : { path: p, signedUrl: SIGNED(p), error: null })), error: null }
        },
      }),
    },
  },
}))

const { default: TeamView } = await import('./TeamView')
const { default: TeamGallery } = await import('./TeamGallery')
const { RabbitHelpContent } = await import('../rabbitHelpContent')
const { _resetOverlaysForTests } = await import('../../../ui/overlay')
const { _resetAvatarReadsForTests } = await import('../../../components/TeamMembers/avatarReads')

const BASE = 'https://proj.supabase.co'
const PUBLIC = (p) => `${BASE}/storage/v1/object/public/user-avatars/${p}`
function SIGNED(p) { return `${BASE}/storage/v1/object/sign/user-avatars/${p}?token=t-${p}` }

const DIR = () => [
  { workspace_id: 'ws1', user_id: 'u1', display_name: 'Mara Okonkwo', username: 'mara', title: 'Producer', avatar_url: PUBLIC('ws1/u1/mara.png') },
  { workspace_id: 'ws1', user_id: 'u2', display_name: 'Theo Lindqvist', username: 'theo', title: 'Director', avatar_url: 'https://tracker.example/pixel.png' },
  { workspace_id: 'ws1', user_id: 'u3', display_name: 'Jonah Beck', username: 'jonah', title: 'Production Designer', avatar_url: null },
  { workspace_id: 'ws1', user_id: 'u4', display_name: 'Dev Patel', username: 'dev', title: '', avatar_url: PUBLIC('ws1/u4/dev.png') },
]
const SEATS = () => [
  { user_id: 'u3', project_role: 'member' },
  { user_id: 'u1', project_role: 'manager' },
  { user_id: 'u4', project_role: 'reviewer' },
  { user_id: 'u2', project_role: 'manager' },
]

function cloud({ manager = true, seats = SEATS(), members = DIR() } = {}) {
  dir.current = { members, loading: false, error: null }
  const ctx = {
    project: { id: 'p1', title: 'Salt Hours' },
    adapterMode: 'supabase',
    projectMembers: seats,
    myProjectRole: manager ? 'manager' : 'reviewer',
    projectIsStaffed: true,
    addProjectMember: vi.fn(async () => {}),
    updateProjectMemberRole: vi.fn(async () => {}),
    removeProjectMember: vi.fn(async () => {}),
  }
  rabbit.current = ctx
  return { ctx, ...render(<TeamView />) }
}

const gallery = () => screen.getByRole('list', { name: 'Project roster' })
const cards = () => within(gallery()).getAllByRole('listitem')
const cardNames = () => cards().map((c) => c.querySelector('.rb-team-card-name').textContent)
const toGallery = () => fireEvent.click(screen.getByRole('tab', { name: 'Gallery' }))

beforeEach(() => { sb.calls = []; sb.answer = null; _resetAvatarReadsForTests(); localStorage.clear() })
afterEach(() => { cleanup(); _resetOverlaysForTests(); vi.restoreAllMocks() })

describe('FX3: the Team tab\'s Table / Gallery switch', () => {
  it('is the kit Tabs in the roster\'s own header (beside the seats, R1-08), "Table" first and chosen, switching the seats\' tabpanel; the list is the list it was', () => {
    cloud()
    const header = screen.getByText('Project Roster').parentElement
    const tabs = within(header).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Table', 'Gallery'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(within(header).getByText('4 seats')).toBeTruthy()
    const panel = screen.getByRole('tabpanel')
    for (const t of tabs) expect(t.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-label')).toBe('Table')
    // The panel is the seats: the add-member field is not in it.
    expect(within(panel).queryByPlaceholderText(/Add member/)).toBeNull()
    expect(document.querySelector('.ui-toolbar')).toBeNull()
    // The list: one row per seat with its seat select and its remove.
    expect(screen.queryByRole('list', { name: 'Project roster' })).toBeNull()
    expect(screen.getAllByTitle('Remove from roster')).toHaveLength(4)
  })
  it('Gallery is remembered for this browser, and comes back next time; Table forgets it', () => {
    cloud()
    toGallery()
    expect(localStorage.getItem('rabbit_team_view')).toBe('gallery')
    expect(screen.getByRole('tabpanel').getAttribute('aria-label')).toBe('Gallery')
    cleanup()
    cloud()
    expect(screen.getByRole('tab', { name: 'Gallery' }).getAttribute('aria-selected')).toBe('true')
    expect(cards()).toHaveLength(4)
    fireEvent.click(screen.getByRole('tab', { name: 'Table' }))
    expect(localStorage.getItem('rabbit_team_view')).toBe('table')
  })
  it('a browser that refuses storage still switches (this visit only), and a stray stored value reads as Table', () => {
    localStorage.setItem('rabbit_team_view', 'tiles')
    cloud()
    expect(screen.getByRole('tab', { name: 'Table' }).getAttribute('aria-selected')).toBe('true')
    cleanup()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    cloud()
    toGallery()
    expect(cards()).toHaveLength(4)
  })
})

describe('FX3: the gallery\'s cards', () => {
  it('one card per seat, in the list\'s order (managers, members, reviewers; by name), each with the name, the role and the seat', () => {
    cloud()
    toGallery()
    expect(cardNames()).toEqual(['Mara Okonkwo', 'Theo Lindqvist', 'Jonah Beck', 'Dev Patel'])
    const [mara, , , dev] = cards()
    // The row's second line, in the row's order and words (R1-09, R2-08), whole on the hover.
    expect(mara.querySelector('.rb-team-card-role').textContent).toBe('@mara — Producer')
    expect(mara.querySelector('.rb-team-card-role').title).toBe('@mara — Producer')
    expect(mara.querySelector('.rb-team-card-name').title).toBe('Mara Okonkwo')
    expect(dev.querySelector('.rb-team-card-role').textContent).toBe('@dev')
    expect(mara.getAttribute('aria-label')).toBe('Mara Okonkwo, @mara — Producer, Manager')
    expect(within(mara).getByRole('combobox', { name: 'Seat for Mara Okonkwo' }).value).toBe('manager')
    // The kit Card, on the Assets gallery's chrome.
    expect(mara.classList.contains('ui-card')).toBe(true)
  })
  it('the row\'s own controls: the seat select writes the seat, remove asks and removes', async () => {
    const { ctx } = cloud()
    toGallery()
    const jonah = cards()[2]
    fireEvent.change(within(jonah).getByRole('combobox', { name: 'Seat for Jonah Beck' }), { target: { value: 'reviewer' } })
    expect(ctx.updateProjectMemberRole).toHaveBeenCalledWith('u3', 'reviewer')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(within(jonah).getByRole('button', { name: 'Remove Jonah Beck from roster' }))
    expect(ctx.removeProjectMember).not.toHaveBeenCalled()
    fireEvent.click(within(jonah).getByRole('button', { name: 'Remove Jonah Beck from roster' }))
    await waitFor(() => expect(ctx.removeProjectMember).toHaveBeenCalledWith('u3'))
    expect(confirm).toHaveBeenCalledTimes(2)
  })
  it('a reviewer sees what the list shows them: the seat as a label, no select, no remove', () => {
    cloud({ manager: false })
    toGallery()
    for (const c of cards()) {
      expect(within(c).queryByRole('combobox')).toBeNull()
      expect(within(c).queryByRole('button')).toBeNull()
      expect(c.querySelector('span.rb-role')).not.toBeNull()
    }
  })
  it('no roster: the list\'s own explainer, not an empty gallery', () => {
    cloud({ seats: [] })
    toGallery()
    expect(screen.queryByRole('list', { name: 'Project roster' })).toBeNull()
    expect(screen.getByText(/No roster yet/)).toBeTruthy()
  })
})

describe('FX3: the profile picture — signed reads only', () => {
  it('our bucket\'s pictures in ONE signed call; the img draws the signed URL, never a bucket path; another host or none is the initials tile', async () => {
    cloud()
    toGallery()
    await waitFor(() => expect(cards()[0].querySelector('img')).not.toBeNull())
    expect(sb.calls).toEqual([{ bucket: 'user-avatars', paths: ['ws1/u1/mara.png', 'ws1/u4/dev.png'], ttl: 3600 }])
    const [mara, theo, jonah, dev] = cards()
    expect(mara.querySelector('img').getAttribute('src')).toBe(SIGNED('ws1/u1/mara.png'))
    expect(dev.querySelector('img').getAttribute('src')).toBe(SIGNED('ws1/u4/dev.png'))
    expect([theo.querySelector('img'), theo.querySelector('.rb-team-card-initials').textContent]).toEqual([null, 'TL'])
    expect([jonah.querySelector('img'), jonah.querySelector('.rb-team-card-initials').textContent]).toEqual([null, 'JB'])
    for (const img of gallery().querySelectorAll('img')) {
      expect(img.getAttribute('src')).not.toContain('/object/public/')
      expect(img.getAttribute('src')).not.toContain('tracker.example')
      expect([img.getAttribute('loading'), img.getAttribute('referrerpolicy'), img.getAttribute('alt')]).toEqual(['lazy', 'no-referrer', ''])
    }
    // The name is the card's words; the picture is not read out twice.
    expect(mara.querySelector('.rb-team-card-media').getAttribute('aria-hidden')).toBe('true')
  })
  it('the cache: back to Table and to Gallery again (or the tab again) signs nothing more', async () => {
    cloud()
    toGallery()
    await waitFor(() => expect(cards()[0].querySelector('img')).not.toBeNull())
    fireEvent.click(screen.getByRole('tab', { name: 'Table' }))
    toGallery()
    expect(cards()[0].querySelector('img').getAttribute('src')).toBe(SIGNED('ws1/u1/mara.png'))
    cleanup()
    cloud()
    await act(async () => {})
    expect(sb.calls).toHaveLength(1)
  })
  it('a picture the caller may not read, a sign that hands back a public path, and a picture that fails to load: each the initials', async () => {
    sb.answer = (p) => (p === 'ws1/u1/mara.png'
      ? { path: p, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' }
      : { path: p, signedUrl: PUBLIC(p), error: null })
    cloud()
    toGallery()
    await act(async () => {})
    expect(gallery().querySelectorAll('img')).toHaveLength(0)
    expect(cards()[0].querySelector('.rb-team-card-initials').textContent).toBe('MO')
    // …and one that loads, then fails (an expired token, R1-07): signed once
    // more and drawn again; failing again, the initials.
    cleanup(); _resetAvatarReadsForTests(); sb.calls = []
    let n = 0
    sb.answer = (p) => ({ path: p, signedUrl: `${SIGNED(p)}&n=${++n}`, error: null })
    cloud()
    await waitFor(() => expect(cards()[0].querySelector('img')).not.toBeNull())
    const first = cards()[0].querySelector('img').getAttribute('src')
    fireEvent.error(cards()[0].querySelector('img'))
    await waitFor(() => expect(sb.calls).toHaveLength(2))
    expect(sb.calls[1].paths).toEqual(['ws1/u1/mara.png'])
    await waitFor(() => expect(cards()[0].querySelector('img')?.getAttribute('src')).toBeTruthy())
    const second = cards()[0].querySelector('img').getAttribute('src')
    expect(second).not.toBe(first)
    fireEvent.error(cards()[0].querySelector('img'))
    expect([cards()[0].querySelector('img'), cards()[0].querySelector('.rb-team-card-initials').textContent]).toEqual([null, 'MO'])
    await act(async () => {})
    expect(sb.calls).toHaveLength(2)
  })
  it('review round 1, R1-05: a card draws only ITS member\'s object — a URL naming another member\'s is neither signed nor drawn', async () => {
    const members = DIR().map((m) => (m.user_id === 'u2' ? { ...m, avatar_url: PUBLIC('ws1/u1/mara.png') } : m))
    cloud({ members })
    toGallery()
    await waitFor(() => expect(cards()[0].querySelector('img')).not.toBeNull())
    const theo = cards()[1]
    expect([theo.querySelector('img'), theo.querySelector('.rb-team-card-initials').textContent]).toEqual([null, 'TL'])
    // Signed once, for Mara's card and Dev's, never on Theo's account.
    expect(sb.calls).toEqual([{ bucket: 'user-avatars', paths: ['ws1/u1/mara.png', 'ws1/u4/dev.png'], ttl: 3600 }])
  })
  it('the Table view signs nothing (its avatars are the initials chips, as before)', async () => {
    cloud()
    await act(async () => {})
    expect(sb.calls).toHaveLength(0)
  })
})

describe('FX3: the keyboard, as the Bins grid', () => {
  /** Every element the Tab key can stop at in the gallery, in order. */
  const tabStops = () => [...gallery().querySelectorAll('[tabindex], button, select')].filter((el) => el.tabIndex >= 0)
  it('ONE tab stop (R1-02): the current card, its controls out of the tab order until it is entered', () => {
    cloud()
    toGallery()
    expect(tabStops()).toEqual([cards()[0]])
    // Entered: that card's controls join, and no other card's.
    cards()[0].focus()
    fireEvent.keyDown(cards()[0], { key: 'Enter' })
    expect(tabStops()).toEqual([
      cards()[0],
      within(cards()[0]).getByRole('combobox', { name: 'Seat for Mara Okonkwo' }),
      within(cards()[0]).getByRole('button', { name: 'Remove Mara Okonkwo from roster' }),
    ])
    // Escape: back to the card, the controls out again.
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(document.activeElement).toBe(cards()[0])
    expect(tabStops()).toEqual([cards()[0]])
    // A click into a card's control enters that card; leaving it, out again.
    const theoSeat = within(cards()[1]).getByRole('combobox', { name: 'Seat for Theo Lindqvist' })
    act(() => { theoSeat.focus() })
    expect(tabStops()).toEqual([cards()[1], theoSeat, within(cards()[1]).getByRole('button', { name: 'Remove Theo Lindqvist from roster' })])
    act(() => { theoSeat.blur(); document.body.focus() })
    expect(tabStops()).toEqual([cards()[1]])
  })
  it('the arrows move by a card and by a row of the REAL grid (two columns here), Home and End; Enter goes in, Escape comes back out', () => {
    cloud()
    toGallery()
    // The computed tracks the browser would report — two, so a fixed count fails.
    gallery().style.gridTemplateColumns = '200px 200px'
    cards()[0].focus()
    fireEvent.keyDown(cards()[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cards()[1])
    expect(cards().map((c) => c.tabIndex)).toEqual([-1, 0, -1, -1])
    fireEvent.keyDown(cards()[1], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cards()[0])
    fireEvent.keyDown(cards()[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cards()[2])
    fireEvent.keyDown(cards()[2], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cards()[3]) // past the last row: the last card
    fireEvent.keyDown(cards()[3], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(cards()[1])
    fireEvent.keyDown(cards()[1], { key: 'End' })
    expect(document.activeElement).toBe(cards()[3])
    fireEvent.keyDown(cards()[3], { key: 'ArrowRight' }) // the last card stays the last
    expect(document.activeElement).toBe(cards()[3])
    fireEvent.keyDown(cards()[3], { key: 'Home' })
    expect(document.activeElement).toBe(cards()[0])
    fireEvent.keyDown(cards()[0], { key: 'Enter' })
    const select = within(cards()[0]).getByRole('combobox', { name: 'Seat for Mara Okonkwo' })
    expect(document.activeElement).toBe(select)
    fireEvent.keyDown(select, { key: 'Escape' })
    expect(document.activeElement).toBe(cards()[0])
  })
  it('R1-03: inside a card the arrows never change the seat by themselves; Alt+↓ (which opens it) is the select\'s own', () => {
    const { ctx } = cloud()
    toGallery()
    cards()[2].focus()
    fireEvent.keyDown(cards()[2], { key: 'Enter' })
    const select = within(cards()[2]).getByRole('combobox', { name: 'Seat for Jonah Beck' })
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageDown', 'PageUp']) {
      // fireEvent returns false when the default (the value change) was prevented.
      expect(fireEvent.keyDown(select, { key }), key).toBe(false)
    }
    // …nor a typed letter (R2-02: 'r' made a member a Reviewer, 'm' a Manager).
    for (const key of ['r', 'm', 'M', 'v', '1']) expect(fireEvent.keyDown(select, { key }), key).toBe(false)
    expect(fireEvent.keyDown(select, { key: 'c', ctrlKey: true })).toBe(true) // a shortcut is not typing
    expect(fireEvent.keyDown(select, { key: 'ArrowDown', altKey: true })).toBe(true)
    expect(fireEvent.keyDown(select, { key: ' ' })).toBe(true)
    expect(ctx.updateProjectMemberRole).not.toHaveBeenCalled()
    // CONTROL: the same keys on a card (not a select) are the gallery's moves.
    expect(fireEvent.keyDown(cards()[0], { key: 'ArrowDown' })).toBe(false)
  })
  it('Enter on a card with nothing to go into (a reviewer\'s) stays on the card', () => {
    cloud({ manager: false })
    toGallery()
    cards()[1].focus()
    fireEvent.keyDown(cards()[1], { key: 'Enter' })
    expect(document.activeElement).toBe(cards()[1])
  })
})

describe('FX3: the Local Server\'s Team table has the same switch and gallery', () => {
  function local() {
    team.current = {
      members: [
        { id: 'm1', name: 'Mara Okonkwo', title: 'Producer', employment_type: 'full_time', email: 'mara@salt.test' },
        { id: 'm2', name: 'Lena Fischer', title: 'Sound Designer', employment_type: 'freelancer', email: 'lena@salt.test', profile_picture_url: 'C:/Users/lena/face.png' },
      ],
      loading: false, reload: () => {},
    }
    const ctx = {
      project: { id: 'p1', title: 'Salt Hours' },
      adapterMode: 'local_server',
      teamAssignments: [{ id: 'a1', member_id: 'm1', role: 'manager' }, { id: 'a2', member_id: 'm2', role: 'member' }],
      tasks: [],
      updateTeamAssignment: vi.fn(async () => {}),
      removeTeamAssignment: vi.fn(async () => {}),
      addTeamAssignment: vi.fn(async () => {}),
    }
    rabbit.current = ctx
    return { ctx, ...render(<TeamView />) }
  }
  it('Table / Gallery after the grouping; the cards carry the row\'s role select and remove; a local picture path is never drawn', async () => {
    const { ctx } = local()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Table', 'Gallery'])
    toGallery()
    const list = screen.getByRole('list', { name: 'Project team' })
    const [mara, lena] = within(list).getAllByRole('listitem')
    expect([mara.getAttribute('aria-label'), lena.getAttribute('aria-label')]).toEqual(['Mara Okonkwo, Producer, Manager', 'Lena Fischer, Sound Designer, Member'])
    fireEvent.change(within(lena).getByRole('combobox', { name: 'Role for Lena Fischer' }), { target: { value: 'reviewer' } })
    expect(ctx.updateTeamAssignment).toHaveBeenCalledWith('a2', { role: 'reviewer' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(within(lena).getByRole('button', { name: 'Remove Lena Fischer from project' }))
    await waitFor(() => expect(ctx.removeTeamAssignment).toHaveBeenCalledWith('a2'))
    await act(async () => {})
    expect(list.querySelectorAll('img')).toHaveLength(0)
    expect(sb.calls).toHaveLength(0)
  })
  it('R1-10: grouped, the gallery shows a heading per group, as the table, and a group folds', () => {
    local()
    fireEvent.change(screen.getByDisplayValue('No grouping'), { target: { value: 'role' } })
    toGallery()
    const heads = screen.getAllByRole('button', { expanded: true })
    // The table's own group order (member, manager, reviewer) and labels.
    expect(heads.map((h) => h.textContent)).toEqual(['member1', 'manager1'])
    expect(within(screen.getByRole('list', { name: 'manager' })).getAllByRole('listitem').map((c) => c.getAttribute('aria-label'))).toEqual(['Mara Okonkwo, Producer, Manager'])
    expect(within(screen.getByRole('list', { name: 'member' })).getAllByRole('listitem').map((c) => c.getAttribute('aria-label'))).toEqual(['Lena Fischer, Sound Designer, Member'])
    fireEvent.click(heads[0])
    expect(heads[0].getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('list', { name: 'member' })).toBeNull()
    expect(screen.getByRole('list', { name: 'manager' })).toBeTruthy()
  })
  it('the row and the card ask the one question before a removal (one window.confirm in the code)', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'TeamView.jsx'), 'utf8')
    expect((src.match(/window\.confirm\(/g) || []).length).toBe(2) // the Local Server's, and the cloud roster's
  })
})

describe('FX3 review round 1: the smaller corrections', () => {
  it('R1-11: a card key that is a number (any adapter\'s id) moves like a string', () => {
    render(<TeamGallery label="Numbers" cards={[1, 2, 3].map((k) => ({ key: k, name: `Person ${k}`, role: '', seatLabel: 'Member', avatarUrl: null, avatarOwner: null, seat: null, actions: null }))} />)
    const all = () => within(screen.getByRole('list', { name: 'Numbers' })).getAllByRole('listitem')
    all()[0].focus()
    fireEvent.keyDown(all()[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(all()[1])
    fireEvent.keyDown(all()[1], { key: 'End' })
    expect(document.activeElement).toBe(all()[2])
  })
  it('R1-15: Help\'s Shortcuts page names the gallery\'s keys', () => {
    const text = render(<RabbitHelpContent helpPage="rabbit-shortcuts" theme="dark" />).container.textContent.replace(/\s+/g, ' ')
    expect(text).toContain('Team gallery: the keyboard')
    for (const words of ['Move from card to card', 'First and last card', 'Go into the card: its seat, then its remove', 'Back out to the card', 'Open the seat to choose one (arrows and letters alone never change it)', 'one stop per group']) {
      expect(text, words).toContain(words)
    }
  })
})

describe('FX3 review round 2', () => {
  it('R2-01: the gallery\'s keys stop at the gallery — a handler on the page (Home\'s, hidden under every page) never sees them', () => {
    cloud()
    toGallery()
    const seen = []
    const onPage = (e) => seen.push(e.key)
    document.addEventListener('keydown', onPage)
    try {
      cards()[0].focus()
      fireEvent.keyDown(cards()[0], { key: 'ArrowDown' })
      fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' })
      fireEvent.keyDown(document.activeElement, { key: 'Home' })
      fireEvent.keyDown(document.activeElement, { key: 'Enter' })
      const select = document.activeElement
      expect(select.tagName).toBe('SELECT')
      fireEvent.keyDown(select, { key: 'ArrowDown' })
      fireEvent.keyDown(select, { key: 'r' })
      fireEvent.keyDown(select, { key: 'Escape' })
      expect(seen).toEqual([])
      // CONTROL: a key the gallery does not handle reaches the page.
      fireEvent.keyDown(cards()[0], { key: 'x' })
      expect(seen).toEqual(['x'])
    } finally {
      document.removeEventListener('keydown', onPage)
    }
  })
  it('R2-04: a card removed with the focus on it hands the focus to the card in its place (or the last), not to the page', async () => {
    const { ctx, rerender } = cloud()
    toGallery()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    // Theo (the second card): his remove button has the focus when he goes.
    const theoRemove = within(cards()[1]).getByRole('button', { name: 'Remove Theo Lindqvist from roster' })
    act(() => { theoRemove.focus() })
    fireEvent.click(theoRemove)
    await waitFor(() => expect(ctx.removeProjectMember).toHaveBeenCalledWith('u2'))
    // The store answers without him; the button that had the focus is gone.
    act(() => { theoRemove.blur() })
    rabbit.current = { ...ctx, projectMembers: ctx.projectMembers.filter((pm) => pm.user_id !== 'u2') }
    rerender(<TeamView />)
    expect(cardNames()).toEqual(['Mara Okonkwo', 'Jonah Beck', 'Dev Patel'])
    expect(document.activeElement).toBe(cards()[1]) // Jonah, in Theo's place
    expect(cards().map((c) => c.tabIndex)).toEqual([-1, 0, -1])
    // The last card removed: the focus goes to the new last.
    const devRemove = within(cards()[2]).getByRole('button', { name: 'Remove Dev Patel from roster' })
    act(() => { devRemove.focus() })
    fireEvent.click(devRemove)
    await waitFor(() => expect(ctx.removeProjectMember).toHaveBeenCalledWith('u4'))
    act(() => { devRemove.blur() })
    rabbit.current = { ...rabbit.current, projectMembers: rabbit.current.projectMembers.filter((pm) => pm.user_id !== 'u4') }
    rerender(<TeamView />)
    expect(document.activeElement).toBe(cards()[1]) // Jonah, now the last
  })
})
