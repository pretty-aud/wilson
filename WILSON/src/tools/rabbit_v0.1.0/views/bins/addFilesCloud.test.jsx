/** @vitest-environment jsdom */
// addFilesCloud.test.jsx — the add dialog on the desktop signed in (BC2
// item 3): a picked file lies in one of the company's footage locations, or
// it is refused with the sentence — never silently added.
//
// What this pins:
//   * a line outside every location is disabled and says why; one on a
//     share the company has not named asks "Which location is this? Name
//     it." (one question per share, the share's own name to start from);
//   * a line on no share at all is refused with the sentence and pointed at
//     Settings for a share this computer sees only as a drive letter;
//   * a duplicate (B8) arrives unticked, "already in …" — Skip, or tick it
//     to add it anyway;
//   * the confirm sends a clip as its location + its path inside it + what
//     this computer read of it, and never sends a refused line.
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import AddFilesDialog from './AddFilesDialog'
import { OUTSIDE_LOCATIONS_SENTENCE } from '../../adapters/desktopCloudBins'

afterEach(cleanup)

const bin = { id: 'b1', name: 'Day 1' }
const ok = (over = {}) => ({
  kind: 'file', status: 'ok', location_id: 'L1', relative_path: 'A001/T1.mov', source_path: '\\\\nas\\footage\\A001\\T1.mov',
  original_name: 'T1.mov', extension: '.mov', mime_type: 'video/quicktime', size_bytes: 2048, mtime: '2026-10-08T10:00:00.000Z',
  media_type: 'video', is_sequence: false, display_name: 'T1', suggestions: null, sub_bin: null, ...over,
})
const plan = {
  items: [
    ok(),
    ok({ kind: 'sequence', relative_path: 'VFX/plate_seq', source_path: '\\\\nas\\footage\\VFX\\plate_seq', original_name: 'plate_seq', extension: '.exr', media_type: 'sequence', is_sequence: true, sequence: { pattern: 'plate.####.exr', frame_count: 4 }, sequence_pattern: 'plate.####.exr', frame_count: 4, display_name: 'plate_seq', size_bytes: 32 }),
    ok({ relative_path: 'A001/T2.mov', source_path: '\\\\nas\\footage\\A001\\T2.mov', original_name: 'T2.mov', display_name: 'T2', duplicate: { reason: 'same_path', existing_id: 'f2', existing_bin_id: 'b9', existing_bin_name: 'Selects' } }),
    { kind: 'file', status: 'outside', source_path: '\\\\nas\\sound\\day1\\a.wav', original_name: 'a.wav', reason: 'no_location', share_root: '\\\\nas\\sound' },
    { kind: 'file', status: 'outside', source_path: '\\\\nas\\sound\\day1\\b.wav', original_name: 'b.wav', reason: 'no_location', share_root: '\\\\nas\\sound' },
    { kind: 'file', status: 'outside', source_path: 'C:\\Users\\me\\c.mov', original_name: 'c.mov', reason: 'not_a_share', share_root: null },
    { kind: 'file', status: 'unsafe_name', source_path: '\\\\nas\\footage\\odd.', original_name: 'odd.' },
  ],
}

const lineOf = (name) => [...document.querySelectorAll('.bn-add-row')].find(r => r.textContent.includes(name))

describe('refused lines say why', () => {
  it('outside every location, on no share, a name that cannot be stored: disabled, with words', () => {
    render(<AddFilesDialog bin={bin} plan={plan} scenes={[]} onConfirm={() => {}} onCancel={() => {}} busy={false} progress={null} onNameLocation={() => {}} />)
    expect(lineOf('a.wav').dataset.disabled).toBe('true')
    expect(lineOf('a.wav').textContent).toContain('not in any footage location yet')
    expect(lineOf('c.mov').textContent).toContain('not on a footage location')
    expect(lineOf('odd.').textContent).toContain('cannot be stored')
    expect(document.body.textContent).toContain('3 outside the footage locations')
    expect(document.body.textContent).toContain(OUTSIDE_LOCATIONS_SENTENCE)
    expect(document.body.textContent).toContain('Settings, Storage, Footage locations')
  })

  it('a duplicate arrives unticked, "already in …"; ticking it adds it anyway', () => {
    render(<AddFilesDialog bin={bin} plan={plan} scenes={[]} onConfirm={() => {}} onCancel={() => {}} busy={false} progress={null} />)
    const line = lineOf('T2.mov')
    expect(line.textContent).toContain('already in "Selects"')
    expect(line.querySelector('input[type="checkbox"]').checked).toBe(false)
    expect(lineOf('T1.mov').querySelector('input[type="checkbox"]').checked).toBe(true)
  })
})

describe('"Which location is this? Name it."', () => {
  it('one question per share, its own name to start from; naming it asks the caller to add the location', async () => {
    const onNameLocation = vi.fn(async () => {})
    render(<AddFilesDialog bin={bin} plan={plan} scenes={[]} onConfirm={() => {}} onCancel={() => {}} busy={false} progress={null} onNameLocation={onNameLocation} />)
    const banners = document.querySelectorAll('[data-testid="name-share"]')
    expect(banners).toHaveLength(1)
    expect(banners[0].textContent).toContain('2 files are on \\\\nas\\sound')
    expect(banners[0].textContent).toContain('Which location is this? Name it to add them.')
    const field = screen.getByLabelText('Name for \\\\nas\\sound')
    expect(field.value).toBe('Sound')
    fireEvent.change(field, { target: { value: 'Sound NAS' } })
    fireEvent.click(screen.getByText('Add as a footage location'))
    await waitFor(() => expect(onNameLocation).toHaveBeenCalledWith('\\\\nas\\sound', 'Sound NAS'))
  })

  it('where the caller cannot name locations, the banner points at Settings instead', () => {
    render(<AddFilesDialog bin={bin} plan={plan} scenes={[]} onConfirm={() => {}} onCancel={() => {}} busy={false} progress={null} />)
    expect(document.querySelector('[data-testid="name-share"]').textContent).toContain('Name it in Settings, Storage, Footage locations')
    expect(screen.queryByText('Add as a footage location')).toBeNull()
  })
})

describe('the confirm', () => {
  it('a clip goes as its location + path + what this computer read; a refused line never goes', () => {
    const onConfirm = vi.fn()
    render(<AddFilesDialog bin={bin} plan={plan} scenes={[]} onConfirm={onConfirm} onCancel={() => {}} busy={false} progress={null} />)
    fireEvent.click(screen.getByText(/^Add 2 items$/))
    const [items] = onConfirm.mock.calls[0]
    expect(items.map(i => i.relative_path)).toEqual(['A001/T1.mov', 'VFX/plate_seq'])
    expect(items[0]).toMatchObject({ location_id: 'L1', original_name: 'T1.mov', extension: '.mov', is_sequence: false, size_bytes: 2048, mtime: '2026-10-08T10:00:00.000Z' })
    expect(items[1]).toMatchObject({ location_id: 'L1', is_sequence: true, sequence_pattern: 'plate.####.exr', frame_count: 4 })
  })
})
