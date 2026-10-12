/** @vitest-environment jsdom */
// The Team tab's gallery (post-overhaul FX3). Audrey, 2026-10-11: "for the
// team tab in rabbit. allow the user to see the items/members as a gallery.
// using the profile pic as a image for the cards in the gallery. allow the
// user to change views from table/list to gallery."
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act, waitFor } from '@testing-library/react'

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
const { _resetOverlaysForTests } = await import('../../../ui/overlay')
const { _resetAvatarReadsForTests } = await import('../../../components/TeamMembers/avatarReads')

const BASE = 'https://proj.supabase.co'
const PUBLIC = (p) => `${BASE}/storage/v1/object/public/user-avatars/${p}`
function SIGNED(p) { return `${BASE}/storage/v1/object/sign/user-avatars/${p}?token=t-${p}` }

const DIR = () => [
  { user_id: 'u1', display_name: 'Mara Okonkwo', username: 'mara', title: 'Producer', avatar_url: PUBLIC('ws1/u1/mara.png') },
  { user_id: 'u2', display_name: 'Theo Lindqvist', username: 'theo', title: 'Director', avatar_url: 'https://tracker.example/pixel.png' },
  { user_id: 'u3', display_name: 'Jonah Beck', username: 'jonah', title: 'Production Designer', avatar_url: null },
  { user_id: 'u4', display_name: 'Dev Patel', username: 'dev', title: '', avatar_url: PUBLIC('ws1/u4/dev.png') },
]
const SEATS = () => [
  { user_id: 'u3', project_role: 'member' },
  { user_id: 'u1', project_role: 'manager' },
  { user_id: 'u4', project_role: 'reviewer' },
  { user_id: 'u2', project_role: 'manager' },
]

function cloud({ manager = true, seats = SEATS() } = {}) {
  dir.current = { members: DIR(), loading: false, error: null }
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
  it('is the kit Tabs in a kit Toolbar, "Table" first and chosen, switching a named tabpanel; the list is the list it was', () => {
    const { container } = cloud()
    const toolbar = container.querySelector('.ui-toolbar')
    const tabs = within(toolbar).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Table', 'Gallery'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    const panel = screen.getByRole('tabpanel')
    for (const t of tabs) expect(t.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-label')).toBe('Table')
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
    expect(mara.querySelector('.rb-team-card-role').textContent).toBe('Producer')
    expect(dev.querySelector('.rb-team-card-role').textContent).toBe('—')
    expect(mara.getAttribute('aria-label')).toBe('Mara Okonkwo, Producer, Manager')
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
    // …and one that loads, then fails (an expired token): the initials.
    cleanup(); sb.answer = null; _resetAvatarReadsForTests()
    cloud()
    await waitFor(() => expect(cards()[0].querySelector('img')).not.toBeNull())
    fireEvent.error(cards()[0].querySelector('img'))
    expect([cards()[0].querySelector('img'), cards()[0].querySelector('.rb-team-card-initials').textContent]).toEqual([null, 'MO'])
  })
  it('the Table view signs nothing (its avatars are the initials chips, as before)', async () => {
    cloud()
    await act(async () => {})
    expect(sb.calls).toHaveLength(0)
  })
})

describe('FX3: the keyboard, as the Bins grid', () => {
  it('one tab stop; the arrows move by a card and by a row of the real grid; Home and End; Enter goes in, Escape comes back out', () => {
    cloud()
    toGallery()
    const list = gallery()
    list.style.gridTemplateColumns = '200px 200px 200px' // the computed tracks the browser would report
    const all = cards()
    expect(all.map((c) => c.tabIndex)).toEqual([0, -1, -1, -1])
    all[0].focus()
    fireEvent.keyDown(all[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cards()[1])
    expect(cards().map((c) => c.tabIndex)).toEqual([-1, 0, -1, -1])
    fireEvent.keyDown(cards()[1], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cards()[0])
    fireEvent.keyDown(cards()[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cards()[3])
    fireEvent.keyDown(cards()[3], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(cards()[0])
    fireEvent.keyDown(cards()[0], { key: 'End' })
    expect(document.activeElement).toBe(cards()[3])
    fireEvent.keyDown(cards()[3], { key: 'ArrowRight' }) // the last card stays the last
    expect(document.activeElement).toBe(cards()[3])
    fireEvent.keyDown(cards()[3], { key: 'Home' })
    expect(document.activeElement).toBe(cards()[0])
    fireEvent.keyDown(cards()[0], { key: 'Enter' })
    const select = within(cards()[0]).getByRole('combobox', { name: 'Seat for Mara Okonkwo' })
    expect(document.activeElement).toBe(select)
    // The arrows inside a control are the control's own.
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(select)
    fireEvent.keyDown(select, { key: 'Escape' })
    expect(document.activeElement).toBe(cards()[0])
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
})
