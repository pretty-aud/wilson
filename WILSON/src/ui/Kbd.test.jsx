/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Kbd } from './Kbd'

afterEach(cleanup)

describe('Kbd', () => {
  it('renders a real <kbd> with the kit class and passes a title through', () => {
    render(<Kbd title="Play or pause">Space</Kbd>)
    const k = screen.getByText('Space')
    expect(k.tagName).toBe('KBD')
    expect(k.className).toContain('ui-kbd')
    expect(k.getAttribute('title')).toBe('Play or pause')
    expect(k.getAttribute('style')).toBeNull()
  })
})
