/** @vitest-environment jsdom */
// =============================================================================
// D.O.G.'s Enter key on the rendered component — post-overhaul FX13, Audrey's
// answers of 2026-10-26 (verbatim in docs/sessions/briefs/po-fx13-dog-enter-key.md):
//
//   "Enter needs text in the box": with Full deck on and the deck context box
//   empty, Enter generates nothing and the box gets focus; the Generate button
//   still works. Single page and the regenerate box are untouched.
//   "Enter moves the switch": Enter on the focused Single page / Full deck
//   switch flips it and generates nothing; D.O.G.'s tick boxes keep "Enter
//   generates".
//
// No AI call is made: `callAI` is replaced at the module boundary and a
// generation is asserted by its call (and by the deck context in its body).
// The page has something to read through one uploaded text file, as a person
// would give it. jsdom does not click a button on Enter by itself, so where a
// real browser would, `pressEnter` clicks it when nobody cancelled the key
// (Chromium's own result is in the FX13 hand-off, scripts/fx13-enter-shots.mjs).
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, act, screen } from '@testing-library/react'

vi.mock('../../cloud/aiProxy', async (orig) => ({ ...(await orig()), callAI: vi.fn(() => new Promise(() => {})) }))
import { callAI } from '../../cloud/aiProxy'
import DeckOutlineGenerator from './DeckOutlineGenerator'
import { ToastProvider } from '../../ui'
import { ASK_FOR_CONTEXT } from './enterGenerates'
import { _resetOverlaysForTests } from '../../ui/overlay'

const CONTEXT = 'A pitch deck for a watch launch, five pages.'

// Every test starts with an AI call that never answers (a generation that
// starts stays running); a test that needs an answer sets its own.
beforeEach(() => { callAI.mockReset(); callAI.mockImplementation(() => new Promise(() => {})) })
afterEach(() => { cleanup(); _resetOverlaysForTests() })

async function openDog({ upload = true, provider = true } = {}) {
  const dog = <DeckOutlineGenerator currentPage="dog" />
  const view = render(provider ? <ToastProvider bar="0px">{dog}</ToastProvider> : dog)
  const q = (sel) => view.container.querySelector(sel)
  if (upload) {
    const input = q('input[type=file][accept*=".txt"]')
    await act(async () => { fireEvent.change(input, { target: { files: [new File(['The brief: a watch launch.'], 'fx13-brief.txt', { type: 'text/plain' })] } }) })
    await waitFor(() => expect(view.container.textContent).toContain('fx13-brief.txt'))
  }
  const sw = () => q('.dog-full-deck [role="switch"]')
  const box = () => q('textarea.dog-context-prompt')
  const check = (name) => q(`button.dog-check[aria-label="${name}"]`)
  const toasts = () => [...document.querySelectorAll('.ui-toast-stack .ui-toast')]
  return { view, q, sw, box, check, toasts }
}

/** Enter on `target` as a browser delivers it: the keydown, and then, when
    nobody cancelled it and the target is a button, the click Enter makes. */
async function pressEnter(target, init = {}) {
  let kept
  await act(async () => { kept = fireEvent.keyDown(target, { key: 'Enter', ...init }) })
  if (kept && target.tagName === 'BUTTON') await act(async () => { fireEvent.click(target) })
  return kept
}
async function type(el, value) {
  await act(async () => { fireEvent.change(el, { target: { value } }) })
}
const sent = () => JSON.stringify(callAI.mock.calls[0]?.[0] ?? null)

describe('FX13 on the rendered D.O.G.: Enter at the start with Full deck on', () => {
  it('opens on Full deck with the box empty (the starting point of every case below)', async () => {
    const d = await openDog()
    expect(d.sw().getAttribute('aria-checked')).toBe('true')
    expect(d.box().value).toBe('')
  })

  // Review round 1, finding 5: "once" is one note per blocked Enter, never
  // two on screen; a second blocked Enter replaces the first (said again).
  it('the box empty, Enter on the page: nothing generates, the box gets focus, and the page says why politely, one note at a time', async () => {
    const d = await openDog()
    expect(document.activeElement).toBe(document.body)
    const kept = await pressEnter(document.body)
    expect(kept).toBe(false)                         // D.O.G. took the key
    await waitFor(() => expect(document.activeElement).toBe(d.box()))
    expect(callAI).not.toHaveBeenCalled()
    const said = d.toasts()
    expect(said).toHaveLength(1)
    expect(said[0].getAttribute('role')).toBe('status')
    expect(said[0].closest('[aria-live]').getAttribute('aria-live')).toBe('polite')
    expect(said[0].textContent).toContain(ASK_FOR_CONTEXT.title)
    expect(said[0].textContent).toContain(ASK_FOR_CONTEXT.body)
    // One at a time: Enter again from the page replaces the note (a new one,
    // so a screen reader hears it again), never a second beside it.
    const first = said[0].getAttribute('data-toast-id')
    await act(async () => { document.activeElement.blur() })
    await pressEnter(document.body)
    await waitFor(() => expect(document.activeElement).toBe(d.box()))
    expect(d.toasts()).toHaveLength(1)
    expect(d.toasts()[0].getAttribute('data-toast-id')).not.toBe(first)
    expect(callAI).not.toHaveBeenCalled()
  })

  // Review round 1, finding 1: focus lands here, so the box must answer to
  // its visible label, not to its example text (the placeholder).
  it('the box focus lands in is named by its label, "Deck Context & Guidelines"', async () => {
    const d = await openDog()
    await pressEnter(document.body)
    await waitFor(() => expect(document.activeElement).toBe(d.box()))
    expect(screen.getByRole('textbox', { name: 'Deck Context & Guidelines' })).toBe(document.activeElement)
  })

  it('a box of spaces and new lines counts as empty', async () => {
    const d = await openDog()
    await type(d.box(), '   \n  ')
    await pressEnter(document.body)
    await waitFor(() => expect(document.activeElement).toBe(d.box()))
    expect(callAI).not.toHaveBeenCalled()
    expect(d.toasts()).toHaveLength(1)
  })

  it('CONTROL: with words in the box, Enter on the page starts the full deck (the call carries the words) and says nothing', async () => {
    const d = await openDog()
    await type(d.box(), CONTEXT)
    await pressEnter(document.body)
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(sent()).toContain(`DECK CONTEXT & GUIDELINES:\\n${CONTEXT}`)
    expect(d.toasts()).toHaveLength(0)
  })

  it('card 3 folded and the box empty: the card opens and the box gets focus', async () => {
    const d = await openDog()
    await act(async () => { fireEvent.click(d.q('.dog-s2 .dog-card-head')) })
    expect(d.box()).toBe(null)                        // folded: the box is not drawn
    await pressEnter(document.body)
    await waitFor(() => expect(d.box()).not.toBe(null))
    await waitFor(() => expect(document.activeElement).toBe(d.box()))
    expect(callAI).not.toHaveBeenCalled()
    expect(d.toasts()).toHaveLength(1)
  })

  it('nothing to read yet: Enter does what it did before, nothing (no focus move, no words)', async () => {
    const d = await openDog({ upload: false })
    const kept = await pressEnter(document.body)
    expect(kept).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(document.activeElement).toBe(document.body)
    expect(d.toasts()).toHaveLength(0)
    expect(callAI).not.toHaveBeenCalled()
  })

  it('a D.O.G. tick box keeps "Enter generates" (B-R1-01): with the box empty it asks instead, and the tick never flips', async () => {
    const d = await openDog()
    const theme = d.check('Theme generator')
    await act(async () => { theme.focus() })
    const kept = await pressEnter(theme)
    expect(kept).toBe(false)
    expect(theme.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(d.box()))
    expect(callAI).not.toHaveBeenCalled()
    expect(d.toasts()).toHaveLength(1)
  })

  it('CONTROL: a D.O.G. tick box with words in the box starts the full deck, the tick unchanged', async () => {
    const d = await openDog()
    await type(d.box(), CONTEXT)
    const visual = d.check('Use visual assets')
    await act(async () => { visual.focus() })
    await pressEnter(visual)
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(visual.getAttribute('aria-checked')).toBe('false')
    expect(d.toasts()).toHaveLength(0)
  })

  it('the Generate button is untouched: with the box empty it still starts the full deck', async () => {
    const d = await openDog()
    const generate = [...d.view.container.querySelectorAll('button.dog-generate')].find((b) => /Generate full deck outline/.test(b.textContent))
    expect(generate.disabled).toBe(false)
    await act(async () => { fireEvent.click(generate) })
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(sent()).not.toContain('DECK CONTEXT & GUIDELINES')
    expect(d.toasts()).toHaveLength(0)
  })
})

// Review round 1, finding 4: the places the ask must NOT appear, on the
// rendered page (each was proven only by the code's order or a pure test).
describe('FX13 on the rendered D.O.G.: where Enter made nothing before, it still makes nothing and says nothing', () => {
  const generateButton = (d) => [...d.view.container.querySelectorAll('button.dog-generate')][0]

  it('a deck running (started from the button with the box empty): Enter on the page asks nothing and moves no focus', async () => {
    const d = await openDog()
    await act(async () => { fireEvent.click(generateButton(d)) })
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(generateButton(d).textContent).toMatch(/Generating full deck/)
    await act(async () => { document.activeElement.blur() })
    expect(await pressEnter(document.body)).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(document.activeElement).toBe(document.body)
    expect(d.toasts()).toHaveLength(0)
    expect(callAI).toHaveBeenCalledTimes(1)
  })

  it('a page already made: Enter on the page with the box empty makes nothing and says nothing; words in the box still make a deck from the box itself, as before', async () => {
    callAI.mockImplementation(async () => ({
      content: [{ type: 'text', text: 'SLIDE #1 — Title Page\n═══════════════\n▸ TITLE:\nThe watch launch\n▸ SUBTITLE:\nA pitch\n' }],
      stop_reason: 'end_turn',
    }))
    const d = await openDog()
    await act(async () => { fireEvent.click([...d.view.container.querySelectorAll('.dog-mode-side')].find((s) => s.textContent === 'Single page')) })
    await act(async () => { fireEvent.change(d.q('.dog-layout-select select'), { target: { value: d.q('.dog-layout-select select').options[1].value } }) })
    await type(d.q('textarea.dog-page-request'), 'The characters, one line each')
    await act(async () => { fireEvent.click(generateButton(d)) })
    await waitFor(() => expect(d.view.container.textContent).not.toContain('No pages yet'))
    await act(async () => { fireEvent.click([...d.view.container.querySelectorAll('.dog-mode-side')].find((s) => s.textContent === 'Full deck')) })
    const calls = callAI.mock.calls.length
    await act(async () => { document.activeElement.blur() })
    expect(await pressEnter(document.body)).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(document.activeElement).toBe(document.body)
    expect(d.toasts()).toHaveLength(0)
    expect(callAI).toHaveBeenCalledTimes(calls)
    // CONTROL: the box's own Enter with words is still a full deck after pages exist.
    await type(d.box(), CONTEXT)
    await act(async () => { d.box().focus() })
    await pressEnter(d.box())
    // the deck's own call first (a made deck may call again, for its theme)
    await waitFor(() => expect(callAI.mock.calls.length).toBeGreaterThan(calls))
    expect(JSON.stringify(callAI.mock.calls[calls][0])).toContain(`DECK CONTEXT & GUIDELINES:\\n${CONTEXT}`)
  })

  it('the References window open over the page: Enter is the window\'s, not D.O.G.\'s (no ask, no deck)', async () => {
    const d = await openDog()
    const add = [...d.view.container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add references')
    await act(async () => { fireEvent.click(add) })
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBe(null))
    await pressEnter(document.body)
    await new Promise((r) => setTimeout(r, 20))
    expect(document.activeElement).not.toBe(d.box())
    expect(d.toasts()).toHaveLength(0)
    expect(callAI).not.toHaveBeenCalled()
  })

  it('Shift+Enter in the box with words is a new line, not a deck', async () => {
    const d = await openDog()
    await type(d.box(), CONTEXT)
    await act(async () => { d.box().focus() })
    expect(await pressEnter(d.box(), { shiftKey: true })).toBe(true)
    expect(callAI).not.toHaveBeenCalled()
  })

  it('D.O.G. mounted without a toast stack: the ask still moves focus, says nothing, and nothing breaks', async () => {
    const d = await openDog({ provider: false })
    expect(await pressEnter(document.body)).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(d.box()))
    expect(document.querySelector('.ui-toast-stack')).toBe(null)
    expect(callAI).not.toHaveBeenCalled()
  })
})

describe('FX13 on the rendered D.O.G.: the deck context box\'s own Enter', () => {
  it('Enter in the empty box does nothing: no generation, no new line, no words', async () => {
    const d = await openDog()
    await act(async () => { d.box().focus() })
    const kept = await pressEnter(d.box())
    expect(kept).toBe(false)                          // no new line either
    expect(callAI).not.toHaveBeenCalled()
    expect(d.toasts()).toHaveLength(0)
    expect(document.activeElement).toBe(d.box())
  })
  it('Enter in a box of spaces does nothing too', async () => {
    const d = await openDog()
    await type(d.box(), '  ')
    await act(async () => { d.box().focus() })
    expect(await pressEnter(d.box())).toBe(false)
    expect(callAI).not.toHaveBeenCalled()
  })
  it('Shift+Enter in the empty box is left to the box (a new line)', async () => {
    const d = await openDog()
    await act(async () => { d.box().focus() })
    expect(await pressEnter(d.box(), { shiftKey: true })).toBe(true)
    expect(callAI).not.toHaveBeenCalled()
  })
  it('CONTROL: Enter in the box with words starts the full deck, as before', async () => {
    const d = await openDog()
    await type(d.box(), CONTEXT)
    await act(async () => { d.box().focus() })
    expect(await pressEnter(d.box())).toBe(false)
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(sent()).toContain(`DECK CONTEXT & GUIDELINES:\\n${CONTEXT}`)
  })
})

describe('FX13 on the rendered D.O.G.: Enter on the switch moves the switch', () => {
  it('Full deck, the box empty: Enter flips to Single page and generates nothing, says nothing, and focus stays on the switch', async () => {
    const d = await openDog()
    const sw = d.sw()
    await act(async () => { sw.focus() })
    const kept = await pressEnter(sw)
    expect(kept).toBe(true)                           // left to the button
    expect(d.sw().getAttribute('aria-checked')).toBe('false')
    expect(d.q('textarea.dog-page-request')).not.toBe(null)   // Single page's fields
    expect(callAI).not.toHaveBeenCalled()
    expect(d.toasts()).toHaveLength(0)
    expect(document.activeElement).toBe(d.sw())
  })
  it('Full deck with words in the box: Enter still only flips the switch', async () => {
    const d = await openDog()
    await type(d.box(), CONTEXT)
    await act(async () => { d.sw().focus() })
    expect(await pressEnter(d.sw())).toBe(true)
    expect(d.sw().getAttribute('aria-checked')).toBe('false')
    expect(callAI).not.toHaveBeenCalled()
  })
  it('Single page with a layout and a page request: Enter flips back to Full deck and makes no page', async () => {
    const d = await openDog()
    await act(async () => { d.sw().focus() })
    await pressEnter(d.sw())                          // to Single page
    await act(async () => { fireEvent.change(d.q('.dog-layout-select select'), { target: { value: d.q('.dog-layout-select select').options[1].value } }) })
    await type(d.q('textarea.dog-page-request'), 'The characters, one line each')
    await act(async () => { d.sw().focus() })
    expect(await pressEnter(d.sw())).toBe(true)
    expect(d.sw().getAttribute('aria-checked')).toBe('true')
    expect(callAI).not.toHaveBeenCalled()
  })
})

describe('FX13 on the rendered D.O.G.: Single page is untouched', () => {
  async function singlePage(d, { ready }) {
    await act(async () => { fireEvent.click([...d.view.container.querySelectorAll('.dog-mode-side')].find((s) => s.textContent === 'Single page')) })
    if (ready) {
      await act(async () => { fireEvent.change(d.q('.dog-layout-select select'), { target: { value: d.q('.dog-layout-select select').options[1].value } }) })
      await type(d.q('textarea.dog-page-request'), 'The characters, one line each')
    }
  }
  it('a layout and a page request, the deck context box empty: Enter on the page makes the page, with no words said', async () => {
    const d = await openDog()
    await singlePage(d, { ready: true })
    await act(async () => { document.activeElement.blur() })
    await pressEnter(document.body)
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(sent()).toContain('The characters, one line each')
    expect(d.toasts()).toHaveLength(0)
  })
  it('without them: Enter does nothing and focus does not move, as before', async () => {
    const d = await openDog()
    await singlePage(d, { ready: false })
    await act(async () => { document.activeElement.blur() })
    await pressEnter(document.body)
    await new Promise((r) => setTimeout(r, 20))
    expect(callAI).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(document.body)
    expect(d.toasts()).toHaveLength(0)
  })
  it('Enter in the page box makes the page, as before', async () => {
    const d = await openDog()
    await singlePage(d, { ready: true })
    const pageBox = d.q('textarea.dog-page-request')
    await act(async () => { pageBox.focus() })
    expect(await pressEnter(pageBox)).toBe(false)
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
  })
})
