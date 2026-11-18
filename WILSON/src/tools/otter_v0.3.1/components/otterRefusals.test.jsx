/** @vitest-environment jsdom */
// =============================================================================
// otterRefusals.test.jsx — F6 (B5): a refusal reaches the person in words.
//
// `otterFetch` resolves for every status, and these screens read the answer
// with `res.json()` BEFORE they looked at `res.ok`. An answer that is not JSON
// (the local server's HTML error page, a proxy's 502) made that read throw a
// SyntaxError, and the screen showed `Unexpected token '<', "<!DOCTYPE "...`
// where its own sentence ("Could not load change requests") belonged. Since
// F6 every O.T.T.E.R. read goes through adapters/otterRoutes.js's reader; the
// reader's table and the ban on `.json()` are in otterRoutes.test.js, and
// these mount two of the screens to show the words arriving.
//
// A file of its own because the screens' own suites (RequestsView.test.jsx and
// the sharing suites) are kept unedited by F6's brief.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const HTML = '<!DOCTYPE html><html><body>Cannot GET /api/otter/change-requests</body></html>'
const html = (status) => new Response(HTML, { status, headers: { 'Content-Type': 'text/html' } })
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

let answer = () => json(200, [])
vi.mock('../adapters', () => ({ otterFetch: async (url, init) => answer(url, init) }))

const { default: RequestsView } = await import('./RequestsView.jsx')
const { default: ChangeRequestDialog } = await import('./ChangeRequestDialog.jsx')

afterEach(() => { cleanup(); answer = () => json(200, []) })

const queue = () => render(
  <RequestsView role="admin" userId="u-me" softwareList={[]} refreshTick={0}
    shares={[]} onSharesChanged={vi.fn(async () => [])} onSharesAccepted={vi.fn()} />,
)
const dialog = () => render(
  <ChangeRequestDialog course={{ slug: 'c-mine', name: 'Blender (mine)', source_course_id: 'c-std' }}
    standardName="Blender" sourceIsStandard onClose={vi.fn()} />,
)

describe('a refusal that is not JSON reaches the person as the authored words (F6, B5)', () => {
  it('the requests queue: loading the change requests', async () => {
    answer = (url) => (url === '/api/otter/change-requests' ? html(404) : json(200, []))
    queue()
    expect(await screen.findByText('Could not load change requests')).toBeTruthy()
    expect(screen.queryByText(/Unexpected token/)).toBeNull()
  })

  it('the change-request dialog: sending a request', async () => {
    answer = (url, init) => (init?.method === 'POST' ? html(502) : json(200, []))
    dialog()
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Add a lesson on the Bevel modifier.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to admin' }))
    expect(await screen.findByText('Could not send your request')).toBeTruthy()
    expect(screen.queryByText(/Unexpected token/)).toBeNull()
  })

  it('a JSON refusal still shows its own sentence, as before', async () => {
    answer = (url, init) => (init?.method === 'POST'
      ? json(409, { error: 'You already have a request open for this course.' })
      : json(200, []))
    dialog()
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Another one.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to admin' }))
    expect(await screen.findByText('You already have a request open for this course.')).toBeTruthy()
  })
})
