/** @vitest-environment jsdom */
// =============================================================================
// binsDialogs.test.jsx — every Bins dialog renders once on the promoted kit.
//
// UI overhaul F1 moved binUi's primitives into src/ui and left binUi.jsx as
// re-exports with the old names and props. This is the proof that the six
// dialogs the Bins tab opens still mount, still register on the modal stack
// (so the Bins keys stand down), and still answer Escape on the topmost one
// only — the behaviours the Bins reviews earned (plan Q17: they keep them
// while the rest of the app waits). The first React-mounting test of any
// tool surface in the repo.
// =============================================================================

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { overlayOpen, _resetOverlaysForTests } from '../../../../ui/overlay'
import { Btn, IconBtn, Modal, Menu, Toggle, Kbd, Chip, TextInput, Field, EmptyState, Spinner, C } from './binUi'
import AddFilesDialog from './AddFilesDialog'
import AssignToShotDialog from './AssignToShotDialog'
import DeleteBinDialog from './DeleteBinDialog'
import RelinkBinsDialog from './RelinkBinsDialog'
import TakePickerDialog from './TakePickerDialog'
import { ShotTakesDialog } from './ShotTakesPanel'

afterEach(cleanup)
beforeEach(() => _resetOverlaysForTests())

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
