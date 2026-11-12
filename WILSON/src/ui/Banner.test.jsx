/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AlertTriangle } from 'lucide-react'
import { Banner, BANNER_TONES } from './Banner'

afterEach(cleanup)

describe('Banner', () => {
  it('renders each tone as a data attribute with the right live role', () => {
    for (const tone of BANNER_TONES) {
      const { unmount } = render(<Banner tone={tone}>{tone} text</Banner>)
      const b = screen.getByText(`${tone} text`).closest('.ui-banner')
      expect(b.dataset.tone).toBe(tone)
      expect(b.getAttribute('role')).toBe(tone === 'danger' || tone === 'warning' ? 'alert' : 'status')
      unmount()
    }
  })

  // VW1-KR-4 (VW1d): live={false} drops the live role in every tone, the
  // danger tone's `alert` too. CONTROL: the default keeps each tone's role.
  it('live={false} drops its own live role in every tone, and only then', () => {
    for (const tone of BANNER_TONES) {
      const { unmount } = render(<><Banner tone={tone} live={false}>{tone} quiet</Banner><Banner tone={tone}>{tone} loud</Banner></>)
      expect(screen.getByText(`${tone} quiet`).closest('.ui-banner').hasAttribute('role')).toBe(false)
      expect(screen.getByText(`${tone} loud`).closest('.ui-banner').getAttribute('role')).toBe(tone === 'danger' || tone === 'warning' ? 'alert' : 'status')
      unmount()
    }
  })

  it('takes an icon, an action and the light surface', () => {
    render(
      <Banner tone="warning" Icon={AlertTriangle} surface="light" action={<button>Fix</button>}>
        Model substituted
      </Banner>,
    )
    const b = screen.getByText('Model substituted').closest('.ui-banner')
    expect(b.querySelector('svg')).not.toBeNull()
    expect(b.dataset.surface).toBe('light')
    expect(screen.getByRole('button', { name: 'Fix' })).toBeTruthy()
  })
})
