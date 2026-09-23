/** @vitest-environment jsdom */
// =============================================================================
// binsDialogs.test.jsx — every Bins dialog renders once, on the kit.
//
// UI overhaul B6 (2026-09-23) re-pointed binUi at src/ui: its Modal is the
// kit's Dialog, its Menu the kit's Menu, and `overlayOpen` the kit's. This
// file renders the six dialogs the Bins tab opens: they mount, register on
// the kit's modal stack, and answer Escape on the topmost one only — the
// behaviours the Bins reviews earned (review part 5, risk 3). The last block
// proves the stack is ONE stack: binUi's `overlayOpen` is the kit's function,
// a Bins menu and a Bins dialog both hold it up and both let it down, and the
// inspector's Space — the Bins consumer of it — stands down behind a dialog.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { overlayOpen, Btn, IconBtn, Modal, Menu, Toggle, Kbd, Chip, TextInput, Field, EmptyState, Spinner, C } from './binUi'
import { overlayOpen as kitOverlayOpen, Dialog, Switch } from '../../../../ui'
import BinInspector from './BinInspector'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import AddFilesDialog from './AddFilesDialog'
import AssignToShotDialog from './AssignToShotDialog'
import DeleteBinDialog from './DeleteBinDialog'
import RelinkBinsDialog from './RelinkBinsDialog'
import TakePickerDialog from './TakePickerDialog'
import { ShotTakesDialog } from './ShotTakesPanel'

// The kit's modal stack empties as each dialog unmounts, which cleanup does.
afterEach(cleanup)

const bins = [
  { id: 'b1', name: 'Footage', parent_id: null, color: null },
  { id: 'b2', name: 'Day 1', parent_id: 'b1', color: 'red' },
]
const scene = { id: 'sc1', name: 'Scene 1', scene_number: 1 }
const shot = { id: 'sh1', name: 'Shot 1', shot_number: 1, scene_id: 'sc1', frame_count: 0 }

describe('the Bins dialogs on the kit', () => {
  it('binUi still exports every name the Bins files import', () => {
    for (const x of [Btn, IconBtn, Modal, Menu, Toggle, Kbd, Chip, TextInput, Field, EmptyState, Spinner]) {
      expect(x).toBeTruthy()
    }
    expect(C.accent).toBe('#ea580c')
  })

  it('DeleteBinDialog', () => {
    const onCancel = vi.fn()
    render(<DeleteBinDialog bin={bins[1]} bins={bins} files={[]} onConfirm={() => {}} onCancel={onCancel} busy={false} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(overlayOpen()).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('AddFilesDialog', () => {
    render(<AddFilesDialog bin={bins[0]} plan={{ items: [] }} scenes={[scene]} onConfirm={() => {}} onCancel={() => {}} busy={false} progress={null} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('AssignToShotDialog', () => {
    render(<AssignToShotDialog files={[]} binFiles={[]} scenes={[scene]} shots={[shot]} shotTakes={[]} thumbUrlFor={() => null} onConfirm={() => {}} onCancel={() => {}} busy={false} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('RelinkBinsDialog', () => {
    render(<RelinkBinsDialog offlineRows={[]} roots={[]} onPickFolder={() => {}} onScan={() => {}} onApply={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('TakePickerDialog', () => {
    render(<TakePickerDialog shot={shot} scene={scene} files={[]} bins={bins} assignedFileIds={[]} hasPrimary={false} thumbUrlFor={() => null} onConfirm={() => {}} onCancel={() => {}} busy={false} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('ShotTakesDialog, and only the topmost of two dialogs answers Escape', () => {
    const closeTakes = vi.fn()
    const closePicker = vi.fn()
    render(
      <>
        <ShotTakesDialog shot={shot} scene={scene} onClose={closeTakes} entries={[]} fps={24} canWrite thumbUrlFor={() => null} binPathFor={() => ''} />
        <TakePickerDialog shot={shot} scene={scene} files={[]} bins={bins} assignedFileIds={[]} hasPrimary={false} thumbUrlFor={() => null} onConfirm={() => {}} onCancel={closePicker} busy={false} />
      </>,
    )
    expect(screen.getAllByRole('dialog').length).toBe(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closePicker).toHaveBeenCalledTimes(1)
    expect(closeTakes).not.toHaveBeenCalled()
  })

  it('Escape inside a TextInput reverts the edit and does not reach the dialog', () => {
    const onCancel = vi.fn()
    const onChange = vi.fn()
    render(
      <Modal title="Edit" onClose={onCancel}>
        <TextInput value="was" onChange={onChange} aria-label="note" />
      </Modal>,
    )
    const i = screen.getByLabelText('note')
    fireEvent.focus(i, { target: { value: 'was' } })
    fireEvent.change(i, { target: { value: 'is' } })
    fireEvent.keyDown(i, { key: 'Escape' })
    expect(onChange).toHaveBeenLastCalledWith('was')
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('W9: no native confirm on the Bins tab — the kit Dialog asks', () => {
  const code = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('no Bins file calls window.confirm (comments may still name it)', () => {
    for (const f of ['../BinsView.jsx', './AddFilesDialog.jsx', './DeleteBinDialog.jsx', './RelinkBinsDialog.jsx', './AssignToShotDialog.jsx', './TakePickerDialog.jsx', './ShotTakesPanel.jsx', './BinInspector.jsx']) {
      expect(code(f), f).not.toMatch(/window\.confirm|\bconfirm\(/)
    }
  })

  it('the Bins keys stand down while "remove more than five?" is up', () => {
    const src = code('../BinsView.jsx')
    expect(src).toMatch(/if \(menu \|\| addDlg \|\| deleteDlg \|\| relinkOpen \|\| assignDlg \|\| removeAsk\) return/)
    expect(src).toMatch(/if \(ids\.length > 5\) \{ setRemoveAsk\(ids\); return \}/)
  })

  it('a worked-on batch asks before it is discarded; Escape closes the question, not the batch', () => {
    const onCancel = vi.fn()
    const plan = { items: [{ source_path: 'C:/a.mov', original_name: 'a.mov', display_name: 'a', media_type: 'video', status: 'ok', include: true, size_bytes: 1 }] }
    render(<AddFilesDialog bin={bins[0]} plan={plan} scenes={[scene]} onConfirm={() => {}} onCancel={onCancel} busy={false} progress={null} />)
    fireEvent.change(screen.getByLabelText('Camera (all)'), { target: { value: 'B' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Discard this batch?' })).toBeTruthy()
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Discard this batch?' })).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('an untouched batch closes straight away', () => {
    const onCancel = vi.fn()
    render(<AddFilesDialog bin={bins[0]} plan={{ items: [] }} scenes={[scene]} onConfirm={() => {}} onCancel={onCancel} busy={false} progress={null} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('🚨 one overlay stack, the kit\'s (review part 5, risk 3)', () => {
  it('binUi re-exports the kit\'s overlayOpen, and its Modal IS the kit Dialog', () => {
    expect(overlayOpen).toBe(kitOverlayOpen)
    expect(Toggle).toBe(Switch)
    render(<Modal title="Probe" onClose={() => {}}><p>body</p></Modal>)
    // The kit Dialog's own class, so a local copy cannot pass this.
    expect(document.querySelector('.ui-dialog')).toBeTruthy()
    expect(Dialog).toBeTruthy()
  })

  it("a click on the backdrop closes a Bins dialog, as it always did (the kit's default is off)", () => {
    const onClose = vi.fn()
    render(<Modal title="Backdrop" onClose={onClose}><p>body</p></Modal>)
    fireEvent.mouseDown(screen.getByText('body'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(document.querySelector('.ui-dialog-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a Bins menu holds the stack up while open and lets it down on unmount', () => {
    expect(overlayOpen()).toBe(false)
    const { unmount } = render(<Menu x={10} y={10} items={[{ label: 'One', onClick: () => {} }]} onClose={() => {}} />)
    expect(overlayOpen()).toBe(true)
    unmount()
    expect(overlayOpen()).toBe(false)
  })

  it('a Bins dialog does the same, and two stacked dialogs count as two', () => {
    const { unmount } = render(
      <>
        <Modal title="Lower" onClose={() => {}}><p>a</p></Modal>
        <Modal title="Upper" onClose={() => {}}><p>b</p></Modal>
      </>,
    )
    expect(overlayOpen()).toBe(true)
    unmount()
    expect(overlayOpen()).toBe(false)
  })

  it('the inspector\'s Space stands down while a Bins dialog is up, and plays once it closes', () => {
    const play = vi.fn(() => Promise.resolve())
    const proto = window.HTMLMediaElement.prototype
    const saved = { play: proto.play, paused: Object.getOwnPropertyDescriptor(proto, 'paused') }
    proto.play = play
    Object.defineProperty(proto, 'paused', { configurable: true, get: () => true })
    try {
      const row = { id: 'f1', bin_id: 'b1', display_name: 'Clip', original_name: 'clip.mp4', extension: '.mp4', media_type: 'video', online: true, review_flag: 'unflagged' }
      const inspector = render(
        <BinInspector rows={[row]} scenes={[]} shots={[]} fps={24} canWrite={false} ffmpeg
          thumbUrlFor={() => null} streamUrlFor={() => 'blob:clip'} onPatch={() => {}} />,
      )
      expect(inspector.container.querySelector('video')).toBeTruthy()
      const dialog = render(<Modal title="Over the preview" onClose={() => {}}><p>x</p></Modal>)
      fireEvent.keyDown(document.body, { code: 'Space', key: ' ' })
      expect(play).not.toHaveBeenCalled()
      dialog.unmount()
      fireEvent.keyDown(document.body, { code: 'Space', key: ' ' })
      expect(play).toHaveBeenCalledTimes(1)
    } finally {
      proto.play = saved.play
      if (saved.paused) Object.defineProperty(proto, 'paused', saved.paused)
    }
  })
})
