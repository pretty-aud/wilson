/** @vitest-environment jsdom */
// =============================================================================
// StorageCleanupCard.test.jsx — F11 item 3 (the review's shared-client A1;
// OUTSTANDING F8-06). The card's one call goes through callEdgeFunction now:
// it sends the request it sent before, words a refusal as before (its own map,
// else the function's detail, else the numbered sentence), the 413 has words,
// and an answer that is not JSON is never a finished run.
// Failing control, run before the commit against the card as it was: the 413
// and the not-JSON tests go red; the request and the old words stay green.
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.test')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
vi.mock('../../cloud/auth/supabaseClient', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-1' } } }) } },
}))

const { default: StorageCleanupCard } = await import('./StorageCleanupCard')
const { EDGE_WORDS } = await import('../../cloud/edgeFunctions')

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body instanceof Error) throw body; return body } })
function run(reply) {
  const fetchFn = vi.fn(async () => reply)
  vi.stubGlobal('fetch', fetchFn)
  render(<StorageCleanupCard />)
  fireEvent.click(screen.getByRole('button', { name: /run storage cleanup/i }))
  fireEvent.click(screen.getByRole('button', { name: /yes, clean up/i }))
  return fetchFn
}

describe('the storage cleanup card', () => {
  it('sends the request it sent before, and shows the counts', async () => {
    const f = run(answer(200, { counts: { queue_deleted: 1, orphans_deleted: 2, avatar_orphans_deleted: 0 } }))
    expect(await screen.findByText(/Removed 3 blob\(s\)/)).toBeTruthy()
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://proj.test/functions/v1/storage-gc')
    expect(init.method).toBe('POST')
    expect({ ...init.headers }).toEqual({ 'content-type': 'application/json', apikey: 'anon-key', authorization: 'Bearer tok-1' })
    expect(init.body).toBe('{}')
  })
  it('its own words for its codes, else the function\'s detail, else the numbered sentence', async () => {
    run(answer(403, { error: 'forbidden' }))
    expect(await screen.findByText('Only an active workspace admin can run this.')).toBeTruthy()
    cleanup()
    run(answer(409, { error: 'locked', detail: 'Another cleanup is running.' }))
    expect(await screen.findByText('Another cleanup is running.')).toBeTruthy()
    cleanup()
    run(answer(500, new SyntaxError('not json')))
    expect(await screen.findByText('Cleanup failed (500).')).toBeTruthy()
  })
  it('a 413 has words (F8-06)', async () => {
    run(answer(413, { error: 'too_large', detail: 'the request is too large' }))
    expect(await screen.findByText(EDGE_WORDS.too_large)).toBeTruthy()
  })
  it('an answer that is not JSON is not a finished run', async () => {
    run(answer(200, new SyntaxError('not json')))
    expect(await screen.findByText(EDGE_WORDS.bad_answer)).toBeTruthy()
    expect(screen.queryByText(/Removed/)).toBeNull()
  })
})
