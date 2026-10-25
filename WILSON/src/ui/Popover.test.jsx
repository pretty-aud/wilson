/** @vitest-environment jsdom */
// =============================================================================
// Popover.test.jsx — the kit request VW1-KR-1 (post-overhaul VW1b,
// 2026-10-17; docs/design/CUSTOM_VIEWS_DESIGN.md §4.9 and §8), its portalled
// form: a non-modal card in <body> placed from its anchor's box; one stack in
// overlay.js where only the top Popover answers Escape and outside presses,
// and a layer opened after it (a Dialog, a Menu) takes them; closed by a
// scroll of what holds the anchor and by a resize; focus in on open and back
// to the anchor on close; the Tab order a portal would lose, kept.
// Each rule has a CONTROL that the rule's absence would fail.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { Popover } from './Popover'
import { Dialog } from './Dialog'
import { overlayOpen, menuOpened, _resetOverlaysForTests } from './overlay'

afterEach(cleanup)
beforeEach(() => _resetOverlaysForTests())

const BOX = { left: 100, top: 200, bottom: 228, right: 250, width: 150, height: 28 }

// A row of controls with the anchor in the middle, as a table row's cells.
function Harness({ onClose = () => {}, box = BOX, width = 280, withInitial = false, dialogAfter = false, dialogBefore = null }) {
  const [open, setOpen] = useState(true)
  const [anchor, setAnchor] = useState(null)
  const first = useRef(null)
  return (
    <div>
      <button type="button">before</button>
      <div className="scroller" data-testid="scroller">
        <button type="button" ref={(el) => { if (el && !anchor) { el.getBoundingClientRect = () => box; setAnchor(el) } }}
          onClick={() => setOpen((o) => !o)}>cell</button>
      </div>
      <button type="button">after</button>
      <div className="unrelated" data-testid="unrelated" />
      {dialogBefore}
      {open && anchor && (
        <Popover anchor={anchor} label="Assets of Rig test" width={width}
          initialFocus={withInitial ? first : null}
          onClose={(why) => { onClose(why); setOpen(false) }}>
          <input aria-label="Search" />
          <button type="button" ref={first}>one</button>
          <button type="button">two</button>
        </Popover>
      )}
      {dialogAfter && open && anchor && <Dialog title="Remove the last item" onClose={() => {}}><button type="button">Cancel</button></Dialog>}
    </div>
  )
}
const card = () => document.querySelector('.ui-popover')

describe('Popover — the portalled form', () => {
  it('a labelled, NON-modal dialog in <body>, outside the scroller that holds its anchor; registered as an open overlay', () => {
    render(<Harness />)
    const c = card()
    expect(c.getAttribute('role')).toBe('dialog')
    expect(c.getAttribute('aria-label')).toBe('Assets of Rig test')
    expect(c.getAttribute('aria-modal')).toBeNull()
    expect(c.parentElement).toBe(document.body)
    expect(screen.getByTestId('scroller').contains(c)).toBe(false)
    expect(overlayOpen()).toBe(true)
  })

  it('placed under the anchor\'s left edge, 4px below it, at its width, no taller than the room below less 12px', () => {
    render(<Harness />)
    const s = card().style
    expect(card().dataset.side).toBe('below')
    expect([s.left, s.top, s.width, s.maxHeight, s.bottom]).toEqual(['100px', '232px', '280px', `${innerHeight - 228 - 4 - 12}px`, ''])
  })

  it('opens ABOVE when under 240px is free below and more above; kept 12px inside the window\'s edges', () => {
    const low = { ...BOX, left: innerWidth - 50, top: innerHeight - 100, bottom: innerHeight - 72 }
    render(<Harness box={low} />)
    const s = card().style
    expect(card().dataset.side).toBe('above')
    expect(s.bottom).toBe(`${innerHeight - low.top + 4}px`)
    expect(s.top).toBe('')
    expect(s.left).toBe(`${innerWidth - 280 - 12}px`)
    expect(s.maxHeight).toBe(`${low.top - 4 - 12}px`)
  })

  it('CONTROL: with 240px or more below it stays below', () => {
    render(<Harness box={{ ...BOX, top: innerHeight - 280, bottom: innerHeight - 250 }} />)
    expect(card().dataset.side).toBe('below')
  })

  it('focus in on open: the first control, or the one named', () => {
    render(<Harness />)
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search' }))
    cleanup(); _resetOverlaysForTests()
    render(<Harness withInitial />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'one' }))
  })

  it('Escape closes it and focus goes back to the anchor', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(card()).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'cell' }))
    expect(overlayOpen()).toBe(false)
  })

  it('a Dialog opened AFTER it takes Escape: the Popover stays', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} dialogAfter />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(card()).not.toBeNull()
  })

  it('a Dialog UNDER it (opened first) stays when Escape closes the Popover: the key is marked handled', () => {
    const dialogClose = vi.fn()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} dialogBefore={<Dialog title="Task" onClose={dialogClose}><button type="button">x</button></Dialog>} />)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(dialogClose).not.toHaveBeenCalled()
  })

  it('a Menu opened after it takes Escape (the Menu closes first)', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const done = menuOpened()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    done()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith('escape')
  })

  it('only the TOP Popover answers Escape', () => {
    const lower = vi.fn()
    const upper = vi.fn()
    const a = document.createElement('button')
    document.body.appendChild(a)
    a.getBoundingClientRect = () => BOX
    render(
      <>
        <Popover anchor={a} label="lower" onClose={lower}><button type="button">l</button></Popover>
        <Popover anchor={a} label="upper" onClose={upper}><button type="button">u</button></Popover>
      </>,
    )
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(upper).toHaveBeenCalledWith('escape')
    expect(lower).not.toHaveBeenCalled()
    a.remove()
  })

  it('a press outside closes it; one inside it, on its anchor or inside a kit Menu does not', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'one' }))
    const menu = document.createElement('div')
    menu.className = 'ui-menu'
    document.body.appendChild(menu)
    fireEvent.mouseDown(menu)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'after' }))
    expect(onClose).toHaveBeenCalledWith('outside')
    menu.remove()
  })

  it('a press on the anchor is the anchor\'s own (its click toggles the card)', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'cell' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a press while a Dialog opened after it is up is the Dialog\'s', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} dialogAfter />)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'after' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a scroll of anything that holds the anchor closes it, heard from the frame after its open; a scroll inside the card or of something else does not', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    // CONTROL: in the frame it opened in, a scroll is its own opening's.
    fireEvent.scroll(screen.getByTestId('scroller'))
    expect(onClose).not.toHaveBeenCalled()
    await act(() => new Promise((r) => requestAnimationFrame(() => r())))
    fireEvent.scroll(card())
    fireEvent.scroll(screen.getByTestId('unrelated'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.scroll(screen.getByTestId('scroller'))
    expect(onClose).toHaveBeenCalledWith('scroll')
  })

  it('a resize closes it (its place was measured once)', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(onClose).toHaveBeenCalledWith('resize')
  })

  it('Tab from its last control closes it and moves on to the control AFTER the anchor', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    screen.getByRole('button', { name: 'two' }).focus()
    fireEvent.keyDown(document.activeElement, { key: 'Tab' })
    expect(onClose).toHaveBeenCalledWith('tab')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after' }))
  })

  it('Shift+Tab from its first control closes it and goes back to the anchor', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true })
    expect(onClose).toHaveBeenCalledWith('tab')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'cell' }))
  })

  it('CONTROL: Tab between its own controls stays inside and closes nothing', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    screen.getByRole('button', { name: 'one' }).focus()
    fireEvent.keyDown(document.activeElement, { key: 'Tab' })
    expect(onClose).not.toHaveBeenCalled()
    expect(card()).not.toBeNull()
  })

  it('focus goes back to the anchor the caller names NOW (its row re-rendered), else the first one', () => {
    const later = document.createElement('button')
    later.textContent = 'cell again'
    document.body.appendChild(later)
    const a = document.createElement('button')
    document.body.appendChild(a)
    a.getBoundingClientRect = () => BOX
    const { rerender } = render(<Popover anchor={a} label="p" returnFocus={() => later} onClose={() => {}}><button type="button">x</button></Popover>)
    rerender(<span />)
    expect(document.activeElement).toBe(later)
    later.remove(); a.remove()
  })

  it('a press elsewhere keeps its own focus: focus is only handed back when it was still in the card', () => {
    const a = document.createElement('button')
    const other = document.createElement('button')
    document.body.append(a, other)
    a.getBoundingClientRect = () => BOX
    const { rerender } = render(<Popover anchor={a} label="p" onClose={() => {}}><button type="button">x</button></Popover>)
    other.focus()
    rerender(<span />)
    expect(document.activeElement).toBe(other)
    a.remove(); other.remove()
  })
})

// VW1b code review round 1 (R1-6): a trigger can sit partly under something
// that covers it (the Tasks table's sticky Title): the caller names the least
// left edge, and the card does not open under the cover.
describe('Popover — minLeft (VW1b review round 1, R1-6)', () => {
  it('opens no further left than the caller allows; without it, under the anchor', () => {
    const a = document.createElement('button')
    document.body.appendChild(a)
    a.getBoundingClientRect = () => ({ left: 214, top: 200, bottom: 228, right: 352, width: 138, height: 28 })
    const { rerender } = render(<Popover anchor={a} label="p" minLeft={264} onClose={() => {}}><button type="button">x</button></Popover>)
    expect(document.querySelector('.ui-popover').style.left).toBe('264px')
    rerender(<span />)
    _resetOverlaysForTests()
    render(<Popover anchor={a} label="q" onClose={() => {}}><button type="button">y</button></Popover>)
    expect(document.querySelector('.ui-popover').style.left).toBe('214px')
    a.remove()
  })
})

// VW1d step 0 review, finding 2: the Tab rule is for a key INSIDE the card,
// with no newer layer open. A Menu portalled from inside the card (as a
// MenuButton portals its kit Menu) sends its keydown up the React tree.
function MenuInside({ onClose, menuOpen = true }) {
  const [anchor, setAnchor] = useState(null)
  return (
    <div>
      <button type="button" ref={(el) => { if (el && !anchor) { el.getBoundingClientRect = () => BOX; setAnchor(el) } }}>cell</button>
      <button type="button">after</button>
      {anchor && (
        <Popover anchor={anchor} label="Views" onClose={onClose}>
          <button type="button">one</button>
          <MenuLayer open={menuOpen} />
        </Popover>
      )}
    </div>
  )
}
function MenuLayer({ open }) {
  // A Menu with its own registration, as the kit Menu makes it.
  if (!open) return null
  return createPortal(<Registered><div className="ui-menu"><button type="button">Rename</button><button type="button">Delete</button></div></Registered>, document.body)
}
function Registered({ children }) {
  useLayoutEffect(() => menuOpened(), [])
  return children
}

describe('Popover — the Tab rule only inside the card (VW1d step 0, finding 2)', () => {
  it('a Tab in a portalled Menu opened from the card closes nothing and moves nothing', () => {
    const onClose = vi.fn()
    render(<MenuInside onClose={onClose} />)
    const rename = screen.getByRole('button', { name: 'Rename' })
    rename.focus()
    fireEvent.keyDown(rename, { key: 'Tab' })
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(rename)
  })
  it('CONTROL: Tab from the card\'s own last control still closes it (no menu open)', () => {
    const onClose = vi.fn()
    render(<MenuInside onClose={onClose} menuOpen={false} />)
    screen.getByRole('button', { name: 'one' }).focus()
    fireEvent.keyDown(document.activeElement, { key: 'Tab' })
    expect(onClose).toHaveBeenCalledWith('tab')
  })
  it('a Tab inside the card while a Dialog opened after it is up is the Dialog\'s', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} dialogAfter />)
    screen.getByRole('button', { name: 'two' }).focus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'two' }), { key: 'Tab' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

// VW1d (2026-10-25), the in-place form (VW1-KR-1; design §4.2, §8): its first
// caller is the Views dropdown.
function InPlace({ onClose = () => {}, refuse = false, width = 300, box = BOX }) {
  const [open, setOpen] = useState(true)
  const [anchor, setAnchor] = useState(null)
  return (
    <div>
      <button type="button">before</button>
      <div className="wrap" data-testid="wrap">
        <button type="button" ref={(el) => { if (el && !anchor) { el.getBoundingClientRect = () => box; setAnchor(el) } }}
          onClick={() => setOpen((o) => !o)}>Views</button>
        {open && anchor && (
          <Popover inPlace anchor={anchor} label="Views" width={width}
            onClose={(why) => { onClose(why); if (!(refuse && why === 'escape')) setOpen(false) }}>
            <button type="button">first</button>
            <button type="button">last</button>
          </Popover>
        )}
      </div>
      <button type="button">after</button>
    </div>
  )
}

describe('Popover — the in-place form (VW1d)', () => {
  it('rendered right after its trigger, not portalled; a labelled non-modal dialog; its width the prop\'s, its height the room below less 12px', () => {
    render(<InPlace />)
    const c = card()
    expect(c.parentElement).toBe(screen.getByTestId('wrap'))
    expect(c.previousElementSibling).toBe(screen.getByRole('button', { name: 'Views' }))
    expect(c.dataset.place).toBe('inline')
    expect(c.getAttribute('role')).toBe('dialog')
    expect(c.getAttribute('aria-modal')).toBeNull()
    expect(c.style.width).toBe('300px')
    expect(c.style.maxHeight).toBe(`${innerHeight - BOX.bottom - 4 - 12}px`)
    // CONTROL: its place is the sheet's, not inline (no left or top written).
    expect([c.style.left, c.style.top]).toEqual(['', ''])
  })

  it('takes a new width at a re-render (a card widens it), its left edge the sheet\'s', () => {
    const { rerender } = render(<InPlace width={300} />)
    rerender(<InPlace width={560} />)
    expect(card().style.width).toBe('560px')
  })

  it('Tab keeps the document\'s order: Tab from its last control is not taken by the card', () => {
    const onClose = vi.fn()
    render(<InPlace onClose={onClose} />)
    screen.getByRole('button', { name: 'last' }).focus()
    const e = fireEvent.keyDown(document.activeElement, { key: 'Tab' })
    expect(e).toBe(true) // not prevented: the browser moves focus on
    expect(onClose).not.toHaveBeenCalled()
  })

  it('focus leaving it closes it (Tab past its end, Shift+Tab onto the trigger); into another kit layer does not', () => {
    const onClose = vi.fn()
    render(<InPlace onClose={onClose} />)
    const last = screen.getByRole('button', { name: 'last' })
    const menu = document.createElement('div')
    menu.className = 'ui-menu'
    const item = document.createElement('button')
    menu.appendChild(item)
    document.body.appendChild(menu)
    fireEvent.blur(last, { relatedTarget: item })
    fireEvent.blur(last, { relatedTarget: screen.getByRole('button', { name: 'first' }) })
    fireEvent.blur(last, { relatedTarget: null })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.blur(last, { relatedTarget: screen.getByRole('button', { name: 'after' }) })
    expect(onClose).toHaveBeenCalledWith('tab')
    menu.remove()
  })

  it('a scroll or a resize does not close it (it moves with its trigger); CONTROL: the portalled form closes', async () => {
    const onClose = vi.fn()
    render(<InPlace onClose={onClose} />)
    await act(() => new Promise((r) => requestAnimationFrame(() => r())))
    fireEvent.scroll(document)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(onClose).not.toHaveBeenCalled()
    cleanup(); _resetOverlaysForTests()
    const other = vi.fn()
    render(<Harness onClose={other} />)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(other).toHaveBeenCalledWith('resize')
  })

  it('Escape asks its caller, who may keep it open (a card goes back); then Escape again closes it and focus goes back to the trigger', () => {
    const onClose = vi.fn()
    const { rerender } = render(<InPlace onClose={onClose} refuse />)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(card()).not.toBeNull()
    rerender(<InPlace onClose={onClose} />)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(card()).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Views' }))
  })

  it('a press outside closes it; on its trigger it is the trigger\'s', () => {
    const onClose = vi.fn()
    render(<InPlace onClose={onClose} />)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Views' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'before' }))
    expect(onClose).toHaveBeenCalledWith('outside')
  })
})
