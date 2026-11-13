/** @vitest-environment jsdom */
// =============================================================================
// minuteClock.test.jsx — words drawn from the time move while their page stays
// on screen (F4, 2026-11-13; review round 1, B-2 and OUTSTANDING F4-03).
//
// Since F4 no pet tick draws every page, so "5m ago" computed while drawing
// stood still on a page left open. useMinuteClock() draws its reader again
// once a minute. Here: a reader under a memo'd parent that is never drawn
// again, the minutes advanced; and the four surfaces that draw minutes-ago
// words, read as source, each call the clock.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { memo } from 'react'
import { render, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { useMinuteClock } from './minuteClock'

const here = dirname(fileURLToPath(import.meta.url))
const T0 = new Date('2026-11-13T10:00:00.000Z').getTime()
const ago = () => `${Math.floor((Date.now() - T0) / 60_000)}m ago`

function WithClock() { useMinuteClock(); return <i data-testid="with">{ago()}</i> }
function WithoutClock() { return <i data-testid="without">{ago()}</i> }
// A page under React.memo, as every page is since F4: nothing from above draws it again.
const Page = memo(function Page() { return <><WithClock /><WithoutClock /></> })

beforeEach(() => { vi.useFakeTimers({ now: T0 }) })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('useMinuteClock', () => {
  it('draws its reader again each minute; a reader without it stands still (the CONTROL)', async () => {
    const view = render(<Page />)
    expect(view.getByTestId('with').textContent).toBe('0m ago')
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60_000) })
    expect(view.getByTestId('with').textContent).toBe('3m ago')
    expect(view.getByTestId('without').textContent).toBe('0m ago')
  })

  it('runs one interval while somebody reads it, and none after the last reader goes', async () => {
    const view = render(<><WithClock /><WithClock /></>)
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the surfaces that draw minutes-ago words read the clock', () => {
  const read = (path) => readFileSync(resolve(here, '..', path), 'utf8')
  for (const [path, where] of [
    ['components/AdminTerminal/UsersSection.jsx', 'function UserDetailPanel('],
    ['components/AdminTerminal/LogsSection.jsx', 'export default function LogsSection('],
    ['components/AdminTerminal/AIFileStoreCard.jsx', 'export default function AIFileStoreCard('],
    ['tools/otter_v0.3.1/components/RequestsView.jsx', 'export default function RequestsView('],
  ]) {
    it(`${path}: the component that draws them calls useMinuteClock()`, () => {
      const src = read(path)
      const at = src.indexOf(where)
      expect(at, `${where} not found`).toBeGreaterThan(0)
      const body = src.slice(at, at + 1500)
      expect(body).toMatch(/\n\s+useMinuteClock\(\)/)
    })
  }
})
