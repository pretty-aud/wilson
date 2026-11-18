/** @vitest-environment jsdom */
// =============================================================================
// DashboardPresence.test.jsx — the Dashboard's header right after FX11
// (post-overhaul, 2026-10-16). Audrey, on its Live badge beside the faces:
// "remove there too". The faces of who is online stay, their names in words.
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const rabbit = vi.hoisted(() => ({ value: null }))
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => rabbit.value }))
vi.mock('../TeamMembers/useWorkspaceMembers', () => ({
  useWorkspaceMembers: () => ({
    members: [
      { user_id: 'u1', display_name: 'Mara Okonkwo', avatar_url: null },
      { user_id: 'u2', display_name: 'Theo Lindqvist', avatar_url: null },
    ],
    reload: () => {},
  }),
  isOwnAvatarUrl: () => false,
}))
// The three tabs' bodies are not this test's subject.
vi.mock('../settings/ProfileSection', () => ({ default: () => null }))
vi.mock('./DashboardTasksView', () => ({ default: () => null }))
// F11: the editor's module counts its own loads, for the first-open test at the end.
const notes = vi.hoisted(() => ({ loads: 0 }))
vi.mock('./NotesView', () => { notes.loads += 1; return { default: () => 'the notes editor' } })

// eslint-disable-next-line import/first
import DashboardPage from './DashboardPage'

afterEach(cleanup)
const here = dirname(fileURLToPath(import.meta.url))

describe('the Dashboard header (FX11): the faces, no Live badge', () => {
  it('with the workspace channel live and two people online: the two faces, and no Live badge or status pill', () => {
    rabbit.value = { workspaceRealtimeStatus: 'live', workspacePresentUsers: [{ user_id: 'u1', label: 'm' }, { user_id: 'u2', label: 't' }], subscribeWorkspaceEvents: () => () => {} }
    const { container } = render(<DashboardPage />)
    const presence = container.querySelector('.dash-presence')
    expect(presence).not.toBeNull()
    expect(presence.querySelectorAll('.dash-avatar')).toHaveLength(2)
    expect(presence.querySelector('.ui-status, .ui-status-dot')).toBeNull()
    expect(presence.textContent).not.toMatch(/\bLive\b/i)
    expect(container.querySelector('.ui-toolbar').textContent).not.toMatch(/\bLive\b/i)
    // The names in words, for a screen reader (the faces carry them only in titles).
    expect(presence.querySelector('[role="group"]').getAttribute('aria-label')).toBe('Online now: Mara Okonkwo, Theo Lindqvist')
  })
  it('the faces only while the channel is live (review round 1, R1-11): after a channel error the last list is not people online', () => {
    for (const status of ['error', 'connecting', 'off', undefined]) {
      rabbit.value = { workspaceRealtimeStatus: status, workspacePresentUsers: [{ user_id: 'u1', label: 'm' }], subscribeWorkspaceEvents: () => () => {} }
      const { container, unmount } = render(<DashboardPage />)
      expect(container.querySelector('.dash-presence'), String(status)).toBeNull()
      unmount()
    }
  })
  it('live with nobody else online draws nothing on the right (it used to draw the badge alone)', () => {
    rabbit.value = { workspaceRealtimeStatus: 'live', workspacePresentUsers: [], subscribeWorkspaceEvents: () => () => {} }
    const { container } = render(<DashboardPage />)
    expect(container.querySelector('.dash-presence')).toBeNull()
  })
  it('the source keeps no Live badge and imports no StatusBadge', () => {
    const src = readFileSync(join(here, 'DashboardPage.jsx'), 'utf8')
    expect(src).not.toMatch(/label="Live"|StatusBadge/)
  })
})

// F11 (the review's shared-client C3). Failing control, run before the commit: drawing the Notes part without the
// `notesOpened` gate loads the editor at the first draw and turns this red.
describe('F11: the Notes editor loads the first time its tab is shown, and stays', () => {
  it('not at the page’s first draw; at the first click on Notes; kept mounted after', async () => {
    rabbit.value = { workspaceRealtimeStatus: 'off', workspacePresentUsers: [], subscribeWorkspaceEvents: () => () => {} }
    render(<DashboardPage />)
    // Give a stray load every chance to happen before judging.
    await new Promise((r) => setTimeout(r, 20))
    expect(notes.loads).toBe(0)
    expect(screen.queryByText('the notes editor')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    expect(await screen.findByText('the notes editor')).toBeTruthy()
    expect(notes.loads).toBe(1)
    fireEvent.click(screen.getByRole('tab', { name: 'My tasks' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    expect(screen.getByText('the notes editor')).toBeTruthy()
    expect(notes.loads).toBe(1)
  })
})
