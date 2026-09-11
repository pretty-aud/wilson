/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PageHeader } from './PageHeader'

afterEach(cleanup)

describe('PageHeader', () => {
  it('renders the title as the page heading, at the H1 step', () => {
    render(<PageHeader title="Team members" />)
    const h = screen.getByRole('heading', { level: 1 })
    expect(h.textContent).toBe('Team members')
    expect(h.className).toBe('ui-page-header-title')
  })

  it("renders the title verbatim — the case is the registry's, never transformed here", () => {
    render(<PageHeader title="App settings" />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('App settings')
  })

  it('omits the subtitle element entirely when there is none', () => {
    const { container } = render(<PageHeader title="Files" />)
    expect(container.querySelector('.ui-page-header-subtitle')).toBeNull()
  })

  it('renders the Dense subtitle when given one (the three tool wordmarks)', () => {
    const { container } = render(<PageHeader title="D.O.G." subtitle="Deck Outline Generator" />)
    expect(container.querySelector('.ui-page-header-subtitle').textContent).toBe('Deck Outline Generator')
  })

  it('renders the leading and actions slots, actions last', () => {
    const { container } = render(
      <PageHeader title="O.T.T.E.R." leading={<img alt="" data-testid="logo" />} actions={<button type="button">Nav</button>} />,
    )
    expect(screen.getByTestId('logo')).toBeTruthy()
    expect(container.querySelector('.ui-page-header-actions').textContent).toBe('Nav')
    // The header is header > [leading, text, actions] in that order.
    const kids = [...container.querySelector('.ui-page-header').children]
    expect(kids.at(-1).className).toBe('ui-page-header-actions')
  })

  it('is one element with the kit class, so its geometry is a stylesheet decision', () => {
    const { container } = render(<PageHeader title="Help" />)
    const el = container.querySelector('header')
    expect(el.className).toBe('ui-page-header')
    expect(el.getAttribute('style')).toBeNull()
  })
})
