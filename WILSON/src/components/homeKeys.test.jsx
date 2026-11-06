/** @vitest-environment jsdom */
// Home's arrow keys and Enter act only while Home is the page on screen
// (post-overhaul FX3 review round 2, R2-01). Home stays mounted, hidden,
// under every other page and listens on `document`: before this, ↑ ↓ were
// taken from every page (their default prevented — a closed select could not
// be opened with Alt+↓ anywhere) and an Enter after one of them opened Home's
// first item, D.O.G., from wherever the person was — measured on
// R.A.B.B.I.T.'s Team gallery (↓ then Enter left R.A.B.B.I.T.).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'

vi.mock('../permissions', () => ({ usePermissions: () => ({ role: 'user', ready: true }) }))

const { default: Home } = await import('./Home')

afterEach(cleanup)

describe('Home\'s keys belong to Home', () => {
  it('on another page: ↑ ↓ keep their default (Alt+↓ opens a select) and Enter after them navigates nowhere', () => {
    const onNavigate = vi.fn()
    render(<Home onNavigate={onNavigate} currentPage="rabbit" />)
    expect(fireEvent.keyDown(document, { key: 'ArrowDown' })).toBe(true)
    expect(fireEvent.keyDown(document, { key: 'ArrowDown', altKey: true })).toBe(true)
    expect(fireEvent.keyDown(document, { key: 'ArrowUp' })).toBe(true)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onNavigate).not.toHaveBeenCalled()
  })
  it('CONTROL: on Home they are Home\'s — ↓ takes the default and Enter opens the item', () => {
    const onNavigate = vi.fn()
    render(<Home onNavigate={onNavigate} currentPage="home" />)
    expect(fireEvent.keyDown(document, { key: 'ArrowDown' })).toBe(false)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith('dog')
  })
  it('leaving Home with an item selected does not arm Enter on the next page', () => {
    const onNavigate = vi.fn()
    const { rerender } = render(<Home onNavigate={onNavigate} currentPage="home" />)
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    rerender(<Home onNavigate={onNavigate} currentPage="rabbit" />)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onNavigate).not.toHaveBeenCalled()
  })
})
