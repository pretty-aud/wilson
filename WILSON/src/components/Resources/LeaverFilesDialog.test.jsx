// @vitest-environment jsdom
// LeaverFilesDialog.test.jsx — MO1 (her integration answer 2, verbatim "Yes, once they've left"): an admin moves a
// former member's personal files into a project. Plan, copy, commit; a refused commit takes its copy back out.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import LeaverFilesDialog, { CANNOT_MOVE_FROM_HERE } from './LeaverFilesDialog.jsx'

afterEach(cleanup)

const row = (id) => ({ id, name: `${id}.mov`, storage_provider: 'supabase', storage_path: `projects/p/files/${id}/${id}.mov` })
const PROJECTS = [{ id: 'p1', title: 'Salt' }, { id: 'p2', title: 'Moon' }]

function adapterWith(extra = {}) {
  const calls = []
  const note = (name, value) => vi.fn(async (...args) => { calls.push(name); return typeof value === 'function' ? value(...args) : value })
  return {
    calls,
    planLeaverMove: note('plan', { items: [{ id: 'a', how: 'rehome', to_provider: 'supabase', to_path: 'new/a.mov' }] }),
    copyBodyForMove: note('copy', (f, i) => ({ file_id: f.id, path: i.to_path, thumbnail: null })),
    moveLeaverFiles: note('commit', { move_id: 'm', moved: 1 }),
    removeMoveCopy: note('uncopy'),
    ...extra,
  }
}
const open = (adapter, props = {}) => render(
  <LeaverFilesDialog adapter={adapter} files={[row('a'), row('b')]} projects={PROJECTS} onClose={() => {}} onMoved={() => {}} {...props} />,
)
const choose = (dialog) => {
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /a\.mov/ }))
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'p2' } })
}

describe('moving a former member\'s files', () => {
  it('nothing can go until a file and a project are chosen', () => {
    open(adapterWith())
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Move' }).disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /a\.mov/ }))
    expect(within(dialog).getByRole('button', { name: 'Move' }).disabled).toBe(true)
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'p2' } })
    expect(within(dialog).getByRole('button', { name: 'Move' }).disabled).toBe(false)
  })
  it('🚨 plan, copy, commit, in that order, and only what was ticked', async () => {
    const adapter = adapterWith()
    const onMoved = vi.fn()
    open(adapter, { onMoved })
    const dialog = screen.getByRole('dialog')
    choose(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1))
    expect(adapter.calls).toEqual(['plan', 'copy', 'commit'])
    expect(adapter.planLeaverMove).toHaveBeenCalledWith(['a'], 'p2')
    expect(adapter.moveLeaverFiles).toHaveBeenCalledWith(['a'], 'p2', [{ file_id: 'a', path: 'new/a.mov', thumbnail: null }])
  })
  it('🚨 a refused commit takes the copy back out, says why, and the dialog stays', async () => {
    const adapter = adapterWith({ moveLeaverFiles: vi.fn(async () => { throw Object.assign(new Error('That file or folder is not there.'), { code: 'not_found' }) }) })
    const onMoved = vi.fn()
    open(adapter, { onMoved })
    const dialog = screen.getByRole('dialog')
    choose(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    expect(await within(dialog).findByText('That file or folder is not there.')).toBeTruthy()
    expect(adapter.removeMoveCopy).toHaveBeenCalledTimes(1)
    expect(onMoved).not.toHaveBeenCalled()
  })
  it('🚨 a lost answer keeps the copy: the row may already name it', async () => {
    const adapter = adapterWith({ moveLeaverFiles: vi.fn(async () => { throw new TypeError('Failed to fetch') }) })
    const onMoved = vi.fn()
    open(adapter, { onMoved })
    const dialog = screen.getByRole('dialog')
    choose(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    expect(await within(dialog).findByText(/could not tell/)).toBeTruthy()
    expect(adapter.removeMoveCopy).not.toHaveBeenCalled()
    expect(onMoved).toHaveBeenCalledTimes(1)
  })
  it('a double click moves once', async () => {
    const adapter = adapterWith()
    open(adapter, { onMoved: () => {} })
    const dialog = screen.getByRole('dialog')
    choose(dialog)
    const go = within(dialog).getByRole('button', { name: 'Move' })
    fireEvent.click(go)
    fireEvent.click(go)
    await waitFor(() => expect(adapter.moveLeaverFiles).toHaveBeenCalledTimes(1))
    expect(adapter.planLeaverMove).toHaveBeenCalledTimes(1)
  })
})

describe('round 2: what this dialog cannot carry out', () => {
  it('🚨 a plan that needs anything but a copy here moves nothing, and is not recorded as moved', async () => {
    const adapter = {
      planLeaverMove: vi.fn(async () => ({ items: [{ id: 'a', how: 'copy_up', to_provider: 'network_share' }] })),
      moveLeaverFiles: vi.fn(async () => ({ move_id: 'm', moved: 1, ops: [] })),
      copyBodyForMove: vi.fn(),
    }
    const onMoved = vi.fn()
    render(<LeaverFilesDialog adapter={adapter} files={[{ id: 'a', name: 'a.mov' }]} projects={[{ id: 'p2', title: 'Project' }]} onClose={() => {}} onMoved={onMoved} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(await screen.findByText(CANNOT_MOVE_FROM_HERE)).toBeTruthy()
    expect(adapter.moveLeaverFiles).not.toHaveBeenCalled()
    expect(onMoved).not.toHaveBeenCalled()
  })
})
