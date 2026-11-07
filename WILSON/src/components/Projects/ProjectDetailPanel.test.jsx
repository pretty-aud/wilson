/** @vitest-environment jsdom */
// =============================================================================
// ProjectDetailPanel.test.jsx — MO1 (MOTH_DESIGN §2.6 R11, SEC-6): choosing a
// project's producer seats a manager, so the Producer select is open only to
// someone who manages the project's team (project.roster.manage; 0107's guard
// refuses the rest on the server). ProjectsPage computes canManageTeam.
// =============================================================================
import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'

vi.mock('../TeamMembers/useTeamMembers', () => ({
  useTeamMembers: () => ({ members: [{ id: 'm1', name: 'Member One' }, { id: 'm2', name: 'Member Two' }] }),
}))
vi.mock('../../tools/rabbit_v0.1.0/components/ProjectFilesTable', () => ({
  default: () => null,
  detectDocumentKind: () => null,
}))

const { default: ProjectDetailPanel } = await import('./ProjectDetailPanel')

const project = { id: 'p1', title: 'Project One', producer_id: null, director_id: null, status: 'active' }
const producerSelect = (container) =>
  [...container.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent === 'Select producer'))

afterEach(cleanup)

describe('the Producer select (SEC-6)', () => {
  it('is disabled, with the reason, without project.roster.manage', () => {
    const { container, getByText } = render(
      <ProjectDetailPanel project={project} onBack={() => {}} onUpdate={() => {}} allFiles={[]} canManageTeam={false} />)
    expect(producerSelect(container)).toBeTruthy()
    expect(producerSelect(container).disabled).toBe(true)
    expect(getByText("Only someone who manages this project's team can choose its producer.")).toBeTruthy()
  })
  it('is open to someone who manages the team (the default)', () => {
    const { container, queryByText } = render(
      <ProjectDetailPanel project={project} onBack={() => {}} onUpdate={() => {}} allFiles={[]} />)
    expect(producerSelect(container).disabled).toBe(false)
    expect(queryByText("Only someone who manages this project's team can choose its producer.")).toBeNull()
  })
})
