// @vitest-environment jsdom
// LazyPageBoundary.test.jsx — MO1 (whole-session review round 1): a lazy page that cannot load, or that throws
// while drawing, must not take the whole window with it. Suspense handles only the wait.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { lazy, Suspense } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import LazyPageBoundary from './LazyPageBoundary.jsx'

afterEach(cleanup)

describe('a page that will not open', () => {
  it('🚨 says so, and the rest of the window stays', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Page = lazy(() => Promise.reject(new Error('the chunk answered 404')))
    render(<div><p>the rest of the app</p><LazyPageBoundary title="M.O.T.H."><Suspense fallback={null}><Page /></Suspense></LazyPageBoundary></div>)
    expect(await screen.findByText('M.O.T.H. could not open.')).toBeTruthy()
    expect(screen.getByText('the rest of the app')).toBeTruthy()
    vi.restoreAllMocks()
  })
  it('🚨 a page that throws while drawing is held the same way', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Throws = () => { throw new Error('bad row') }
    render(<LazyPageBoundary title="M.O.T.H."><Throws /></LazyPageBoundary>)
    expect(await screen.findByText('M.O.T.H. could not open.')).toBeTruthy()
    vi.restoreAllMocks()
  })
  it('Try again asks the parent for a new load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onRetry = vi.fn()
    const Throws = () => { throw new Error('x') }
    render(<LazyPageBoundary title="M.O.T.H." onRetry={onRetry}><Throws /></LazyPageBoundary>)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1))
    vi.restoreAllMocks()
  })
  it('App.jsx holds Moth inside it', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf8')
    const surface = app.slice(app.indexOf('function MothSurface'), app.indexOf('function MothSurface') + 700)
    expect(surface).toContain('LazyPageBoundary')
    expect(surface).toContain('<Suspense')
  })
})
