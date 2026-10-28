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
import { render, cleanup, fireEvent, waitFor, act, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// CI has no .env.local, so the real Supabase client (built at import, from
// VITE_SUPABASE_URL) would throw "supabaseUrl is required" before any test
// ran (CI run 40359715742). The tests never reach it: they stop at callAI.
vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
vi.mock('../../cloud/aiProxy', async (orig) => ({ ...(await orig()), callAI: vi.fn(() => new Promise(() => {})) }))
// DG2: the AI's file store at its module boundary, so the let-go on Remove
// (FX12) is seen without a request. Only a PDF or a picture reaches it; the
// FX13 cases upload text, which travels inline and never calls these.
vi.mock('../../cloud/aiFiles', async (orig) => ({ ...(await orig()), uploadAIFile: vi.fn(), deleteAIFiles: vi.fn() }))
// DG4: a project for the Core files and Place visual cases, through D.O.G.'s
// own seam (useRabbit). Every other case mounts D.O.G. outside any provider,
// as before: `rabbit.value` null hands the call to the real hook, which
// answers null there.
const rabbit = vi.hoisted(() => ({ value: null }))
vi.mock('../rabbit_v0.1.0/state/RabbitProvider', async (orig) => {
  const real = await orig()
  return { ...real, useRabbit: () => rabbit.value ?? real.useRabbit() }
})
import { callAI } from '../../cloud/aiProxy'
import { uploadAIFile, deleteAIFiles } from '../../cloud/aiFiles'
import DeckOutlineGenerator from './DeckOutlineGenerator'
import { ToastProvider } from '../../ui'
import { ASK_FOR_CONTEXT } from './enterGenerates'
import { _resetOverlaysForTests } from '../../ui/overlay'

const CONTEXT = 'A pitch deck for a watch launch, five pages.'

// Every test starts with an AI call that never answers (a generation that
// starts stays running); a test that needs an answer sets its own.
beforeEach(() => {
  callAI.mockReset(); callAI.mockImplementation(() => new Promise(() => {}))
  uploadAIFile.mockReset(); uploadAIFile.mockImplementation(async () => ({ id: 'file_dg2_1' }))
  deleteAIFiles.mockReset(); deleteAIFiles.mockImplementation(async () => {})
})
afterEach(() => { cleanup(); _resetOverlaysForTests(); rabbit.value = null })

async function openDog({ upload = true, provider = true } = {}) {
  const dog = <DeckOutlineGenerator currentPage="dog" />
  const view = render(provider ? <ToastProvider bar="0px">{dog}</ToastProvider> : dog)
  const q = (sel) => view.container.querySelector(sel)
  if (upload) {
    const input = q('input[type=file][accept*=".txt"]')
    await act(async () => { fireEvent.change(input, { target: { files: [new File(['The brief: a watch launch.'], 'fx13-brief.txt', { type: 'text/plain' })] } }) })
    await waitFor(() => expect(view.container.textContent).toContain('fx13-brief.txt'))
    // DG2: the upload is drawn before D.O.G.'s Enter listener knows of it (a
    // passive effect); flush the effects, or an Enter next meets the old
    // listener (the CONTROL in "the harness waits for D.O.G.'s effects").
    await act(async () => {})
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
    const visual = d.check('Place visual')                 // "Use visual assets" until DG4
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

  // Round 2, finding 8: Enter is fired on the page here, so this proves D.O.G.
  // stands down while a kit window is open (overlayOpen); Enter with focus
  // inside the window is enterGenerates.test.js' [role="dialog"] case.
  it('the References window open over the page: D.O.G. stands down for an Enter on the page (no ask, no deck)', async () => {
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

  it('Shift+Enter in the box with words is left to the box (the browser\'s new line), not a deck', async () => {
    const d = await openDog()
    await type(d.box(), CONTEXT)
    await act(async () => { d.box().focus() })
    expect(await pressEnter(d.box(), { shiftKey: true })).toBe(true)
    expect(callAI).not.toHaveBeenCalled()
  })

  it('D.O.G. mounted without a toast stack: the ask does not throw and still moves focus', async () => {
    const d = await openDog({ provider: false })
    expect(await pressEnter(document.body)).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(d.box()))
    expect(callAI).not.toHaveBeenCalled()
  })
})

// Round 2, finding 1: a timed note left from under a keyboard user who had
// tabbed to its ×, and only a pointer could hold it. The note now has no
// timer and goes when it stops being true.
describe('FX13 on the rendered D.O.G.: the note stays until it stops being true', () => {
  async function asked(d) {
    await act(async () => { document.activeElement.blur() })
    await pressEnter(document.body)
    await waitFor(() => expect(document.activeElement).toBe(d.box()))
    expect(d.toasts()).toHaveLength(1)
  }
  it('it has no timer: still up after the kit\'s default five seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const d = await openDog()
      await asked(d)
      await act(async () => { vi.advanceTimersByTime(6000) })
      expect(d.toasts()).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })
  it('words in the box take it down', async () => {
    const d = await openDog()
    await asked(d)
    await type(d.box(), 'A pitch')
    expect(d.toasts()).toHaveLength(0)
  })
  it('spaces in the box do not (the box is still empty)', async () => {
    const d = await openDog()
    await asked(d)
    await type(d.box(), '   ')
    expect(d.toasts()).toHaveLength(1)
  })
  it('Single page takes it down', async () => {
    const d = await openDog()
    await asked(d)
    await act(async () => { fireEvent.click([...d.view.container.querySelectorAll('.dog-mode-side')].find((s) => s.textContent === 'Single page')) })
    expect(d.toasts()).toHaveLength(0)
  })
  it('a deck started from the button takes it down', async () => {
    const d = await openDog()
    await asked(d)
    await act(async () => { fireEvent.click(d.view.container.querySelector('button.dog-generate')) })
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(d.toasts()).toHaveLength(0)
  })
  it('another page on screen takes it down (the stack is the whole app\'s)', async () => {
    const d = await openDog()
    await asked(d)
    d.view.rerender(<ToastProvider bar="0px"><DeckOutlineGenerator currentPage="rabbit" /></ToastProvider>)
    await waitFor(() => expect(d.toasts()).toHaveLength(0))
  })
  it('D.O.G. gone takes it down', async () => {
    const Host = ({ show }) => (show ? <DeckOutlineGenerator currentPage="dog" /> : null)
    const view = render(<ToastProvider bar="0px"><Host show /></ToastProvider>)
    const input = view.container.querySelector('input[type=file][accept*=".txt"]')
    await act(async () => { fireEvent.change(input, { target: { files: [new File(['The brief.'], 'fx13-brief.txt', { type: 'text/plain' })] } }) })
    await waitFor(() => expect(view.container.textContent).toContain('fx13-brief.txt'))
    await act(async () => {})                         // DG2: D.O.G.'s effects, as openDog
    await pressEnter(document.body)
    await waitFor(() => expect(document.querySelectorAll('.ui-toast-stack .ui-toast')).toHaveLength(1))
    view.rerender(<ToastProvider bar="0px"><Host show={false} /></ToastProvider>)
    await waitFor(() => expect(document.querySelectorAll('.ui-toast-stack .ui-toast')).toHaveLength(0))
  })
  it('CONTROL: with none of those, it is still up after another Enter in the empty box', async () => {
    const d = await openDog()
    await asked(d)
    await pressEnter(d.box())
    expect(d.toasts()).toHaveLength(1)
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

// =============================================================================
// FX14 (OUTSTANDING FX13-01): the three card title bars fold from the
// keyboard. Each header holds a real button named by the heading's words, the
// chevron its hidden glyph, `aria-expanded` and (while the body is drawn)
// `aria-controls`; it has no handler of its own, so a press reaches the bar's
// one handler, as a pointer's click does. Enter on it is the button's: D.O.G.'s
// "Enter generates" leaves a focused button to itself (enterGenerates.js).
// Chromium's own Tab walk and names are in the FX14 hand-off
// (scripts/fx14-keyboard-shots.mjs).
// =============================================================================
// DG2 (2026-10-26): card 1 is "1 Project" and holds no upload any more; the
// upload's file input is References' (its first group, below). DG4
// (2026-10-28, Audrey: "lets consolidates cards 1 (project) and 2
// (References) into one card"): card 1 is "1 Project and references", the
// project and the references in one body; the Generate outline card is 2
// (its ids keep "card3").
const CARDS = [
  { name: 'Project and references', body: '#dog-card1-body', inside: 'select.dog-project-select' },
  { name: 'Generate outline', body: '#dog-card3-body', inside: 'textarea.dog-context-prompt' },
]
/** Space on a button as a browser delivers it: down, up, and the click on the way up. */
async function pressSpace(target) {
  let kept
  await act(async () => { kept = fireEvent.keyDown(target, { key: ' ', code: 'Space' }) })
  const up = fireEvent.keyUp(target, { key: ' ', code: 'Space' })
  if (kept && up && target.tagName === 'BUTTON') await act(async () => { fireEvent.click(target) })
  return kept
}
const headButton = (name) => screen.getByRole('button', { name })
const head = (name) => headButton(name).closest('.dog-card-head')

describe('FX14 on the rendered D.O.G.: the card title bars fold from the keyboard', () => {
  it('each of the two headers holds a button named by the heading\'s words, the chevron its hidden glyph, open and controlling its body', async () => {
    await openDog()
    for (const c of CARDS) {
      const b = headButton(c.name)
      expect(b.tagName).toBe('BUTTON')
      expect(b.getAttribute('type')).toBe('button')
      expect(b.getAttribute('aria-expanded')).toBe('true')
      const body = document.getElementById(b.getAttribute('aria-controls'))
      expect(body).toBe(document.querySelector(c.body))
      expect(body.querySelector(c.inside)).not.toBe(null)
      expect([...b.querySelectorAll('svg')].every((g) => g.getAttribute('aria-hidden') === 'true')).toBe(true)
      // The heading stays a heading, with its words.
      expect(b.closest('.dog-card-head').querySelector('h2').textContent).toContain(c.name)
    }
  })

  it('a press folds its card and only its card: aria-expanded both ways, aria-controls only while the body is drawn', async () => {
    await openDog()
    for (const c of CARDS) {
      await act(async () => { fireEvent.click(headButton(c.name)) })
      expect(headButton(c.name).getAttribute('aria-expanded')).toBe('false')
      expect(headButton(c.name).hasAttribute('aria-controls')).toBe(false)
      expect(document.querySelector(c.body)).toBe(null)
      for (const o of CARDS.filter((x) => x !== c)) expect(headButton(o.name).getAttribute('aria-expanded')).toBe('true')
      await act(async () => { fireEvent.click(headButton(c.name)) })
      expect(headButton(c.name).getAttribute('aria-expanded')).toBe('true')
      expect(document.getElementById(headButton(c.name).getAttribute('aria-controls'))).toBe(document.querySelector(c.body))
    }
  })

  it('one press is one fold (the bar\'s one handler), and the bar itself still folds under the pointer', async () => {
    await openDog()
    // Counted by the fold itself. The Generate outline card folds by a value
    // read at render, so a second handler there would set the same value and
    // fold once anyway (harmless, and invisible here); card 1 folds by an
    // updater (the References card's way, kept by DG4's merge), where two
    // handlers fold twice and this goes red. (An earlier cut read React's
    // own props off the node: dropped, review round 1, finding 6.)
    for (const c of CARDS) {
      await act(async () => { fireEvent.click(headButton(c.name)) })
      expect(head(c.name).getAttribute('data-collapsed')).toBe('true')   // once, not folded and unfolded
      await act(async () => { fireEvent.click(head(c.name).querySelector('h2')) })
      expect(head(c.name).getAttribute('data-collapsed')).toBe('false')
    }
  })

  for (const words of [false, true]) {
    for (const [key, press] of [['Enter', pressEnter], ['Space', pressSpace]]) {
      it(`${key} on each button, the deck context box ${words ? 'with words' : 'empty'}, Full deck on: folds and unfolds, generates nothing, says nothing, focus stays`, async () => {
        const d = await openDog()
        expect(d.sw().getAttribute('aria-checked')).toBe('true')
        if (words) await type(d.box(), CONTEXT)
        for (const c of CARDS) {
          const b = headButton(c.name)
          await act(async () => { b.focus() })
          expect(await press(b)).toBe(true)                 // left to the button
          expect(headButton(c.name).getAttribute('aria-expanded')).toBe('false')
          expect(document.activeElement).toBe(headButton(c.name))
          await press(headButton(c.name))
          expect(headButton(c.name).getAttribute('aria-expanded')).toBe('true')
        }
        await new Promise((r) => setTimeout(r, 20))
        expect(callAI).not.toHaveBeenCalled()
        expect(d.toasts()).toHaveLength(0)
        if (words) expect(d.box().value).toBe(CONTEXT)
      })
    }
  }

  it('CONTROL: Enter on the page with words in the box still starts the full deck (the buttons changed nothing else)', async () => {
    const d = await openDog()
    await type(d.box(), CONTEXT)
    await act(async () => { headButton('Project and references').focus() })
    await act(async () => { document.activeElement.blur() })
    await pressEnter(document.body)
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
  })

  it('FX13\'s rule, unchanged: card 3 folded from its button, the box empty, Enter on the page opens it and focuses the box', async () => {
    const d = await openDog()
    const b = headButton('Generate outline')
    await act(async () => { b.focus() })
    await pressEnter(b)
    expect(d.box()).toBe(null)
    await act(async () => { document.activeElement.blur() })
    expect(await pressEnter(document.body)).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(d.box()))
    expect(headButton('Generate outline').getAttribute('aria-expanded')).toBe('true')
    expect(callAI).not.toHaveBeenCalled()
    expect(d.toasts()).toHaveLength(1)
  })

  it('the Tab order: each button is the first stop of its card, before the controls in its body', async () => {
    const d = await openDog({ upload: false })
    const stops = [...d.view.container.querySelectorAll('.dog-main button, .dog-main input, .dog-main select, .dog-main textarea, .dog-main [tabindex]')]
      .filter((el) => !el.disabled && el.tabIndex >= 0 && !el.closest('[hidden]') && !(el.tagName === 'INPUT' && el.type === 'file'))
    const at = (el) => stops.indexOf(el)
    const firstIn = (sel) => stops.find((el) => el.closest(sel))
    for (const c of CARDS) {
      expect(at(headButton(c.name))).toBeGreaterThan(-1)
      expect(at(headButton(c.name))).toBeLessThan(at(firstIn(c.body)))
    }
    expect(at(headButton('Project and references'))).toBeLessThan(at(headButton('Generate outline')))
  })
})

// =============================================================================
// DG2 (2026-10-26, Audrey's ask, verbatim in
// docs/sessions/briefs/po-dg2-uploads-in-references.md): "lets move the upload
// documents section in dog tool to the 2 References card". The uploads are the
// first group of References, rows like the other references; card 1 is
// "1 Project". The uploads' state and handlers stayed in D.O.G.
// (uploadedFiles, isFileLoading, handleFileUpload, removeFile), so what is
// read, sent, counted and let go of is unchanged: pinned here on the real
// component. ReferencesCard.test.jsx pins the card's own order and words.
// Every file name here is made up (a file name is content).
// =============================================================================
// A one-pixel PNG: a picture goes to the AI's file store (FX12's let-go).
const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const BRIEF = 'The brief: a watch launch.'
const DECK = 'SLIDE #1 — Title Page\n═══════════════\n▸ TITLE:\nThe watch launch\n▸ SUBTITLE:\nA pitch\n'
/** The meter with a text upload (BRIEF) and the picture, measured on the
    code before the move (`bfea9fd6`, the upload block in card 1). */
const METER_BEFORE = Object.freeze({
  hover: 'An estimate: about 4,008 of 200,000 tokens',
  words: 'About 2% of what D.O.G. can read for one deck',
  valuetext: 'About 2% of what D.O.G. can read for one deck',
  valuenow: '2',
  over: 'false',
})
// DG4: the references are card 1's lower part (`.dog-refs`), no card of their own.
const refsBody = () => document.querySelector('#dog-card1-body .dog-refs')
const uploadRows = () => [...document.querySelectorAll('#dog-card1-body .dog-refs-uploads .dog-refs-row')]
const chooseInput = () => document.querySelector('#dog-card1-body .dog-refs-uploads input[type=file]')
async function addUpload(d, file) {
  await act(async () => { fireEvent.change(d.q('input[type=file][accept*=".txt"]'), { target: { files: [file] } }) })
  await waitFor(() => expect(d.view.container.textContent).toContain(file.name))
  await act(async () => {})                           // D.O.G.'s effects, as openDog
}
const fullDeckButton = (d) => [...d.view.container.querySelectorAll('button.dog-generate')].find((b) => /full deck outline/.test(b.textContent))

describe('DG2 on the rendered D.O.G.: the uploads are References\' first group (card 1\'s lower part since DG4)', () => {
  it('card 1 holds the project first (the dropdown, its hint, New project), then the references, the uploads their first group', async () => {
    const d = await openDog({ upload: false })
    const card1 = document.querySelector('#dog-card1-body')
    expect(document.getElementById('dog-card1-title').textContent).toBe('Project and references')
    expect(headButton('Project and references').getAttribute('aria-controls')).toBe('dog-card1-body')
    expect(card1.querySelector('select.dog-project-select')).not.toBe(null)
    expect(card1.textContent).toContain('The deck’s project. Its title and description go with every deck; choose what else below.')
    expect(within(card1).getByRole('button', { name: 'New project' })).toBeTruthy()
    expect(refsBody().parentElement).toBe(card1)
    const projectPart = card1.querySelector('select.dog-project-select').closest('#dog-card1-body > *')
    expect(projectPart.querySelector('input[type=file]')).toBe(null)
    expect(projectPart.textContent).not.toMatch(/Upload Documents|Choose file|Source material/)
    expect(!!(projectPart.compareDocumentPosition(refsBody()) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    // The one upload control on the page is the references' first group's.
    const inputs = d.view.container.querySelectorAll('.dog-main input[type=file]')
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toBe(chooseInput())
    expect(inputs[0].closest('.dog-refs-group')).toBe(refsBody().querySelector('.dog-refs-group'))
  })

  it('an upload is a row in References with its size as the chip said it; its Remove takes it out, and the header\'s one number follows', async () => {
    const d = await openDog()
    const rows = uploadRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].querySelector('.dog-refs-name').textContent).toBe('fx13-brief.txt')
    expect(rows[0].querySelector('.dog-file-size').textContent).toBe(`(${(BRIEF.length / 1024).toFixed(1)} KB)`)
    expect(refsBody().querySelector('.dog-refs-uploads .dog-refs-group-label').textContent).toBe('Uploads (1)')
    expect(d.q('.dog-refs-count').textContent).toBe('1 chosen')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove fx13-brief.txt' })) })
    expect(uploadRows()).toHaveLength(0)
    expect(d.view.container.textContent).not.toContain('fx13-brief.txt')
    expect(d.q('.dog-refs-count').textContent).toBe('None chosen')
    // Nothing to read now: Enter does nothing, as before any upload.
    expect(await pressEnter(document.body)).toBe(true)
    expect(callAI).not.toHaveBeenCalled()
  })

  it('Remove lets go of what the AI\'s file store holds for that upload; a finished generation lets go of nothing (FX12)', async () => {
    callAI.mockImplementation(async () => ({ content: [{ type: 'text', text: DECK }], stop_reason: 'end_turn' }))
    const d = await openDog({ upload: false })
    await addUpload(d, new File([PNG_1PX], 'picture-01.png', { type: 'image/png' }))
    await type(d.box(), CONTEXT)
    await act(async () => { fireEvent.click(fullDeckButton(d)) })
    await waitFor(() => expect(uploadAIFile).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(d.view.container.textContent).not.toContain('No pages yet'))
    await waitFor(() => expect([...d.view.container.querySelectorAll('button.dog-generate')].some((b) => /Generating/.test(b.textContent))).toBe(false))
    await new Promise((r) => setTimeout(r, 20))
    expect(deleteAIFiles).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove picture-01.png' })) })
    await waitFor(() => expect(deleteAIFiles).toHaveBeenCalledTimes(1))
    expect(deleteAIFiles).toHaveBeenCalledWith(['file_dg2_1'])
  })

  it('the 20th upload hides Choose file; a Remove brings it back', async () => {
    const d = await openDog({ upload: false })
    for (let i = 1; i <= 20; i++) {
      expect(chooseInput()).not.toBe(null)
      await addUpload(d, new File([`Note ${i}.`], `note-${String(i).padStart(2, '0')}.txt`, { type: 'text/plain' }))
      // D.O.G. keys an upload by Date.now(): one millisecond apart, one key each.
      await new Promise((r) => setTimeout(r, 2))
    }
    expect(uploadRows()).toHaveLength(20)
    expect(chooseInput()).toBe(null)
    expect(d.view.container.querySelector('.dog-main input[type=file]')).toBe(null)
    expect(refsBody().querySelector('.dog-refs-uploads .dog-refs-group-label').textContent).toBe('Uploads (20)')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove note-07.txt' })) })
    expect(uploadRows()).toHaveLength(19)
    expect(chooseInput()).not.toBe(null)
  })

  it('the meter\'s figure with two uploads is byte for byte what it was before the move', async () => {
    const d = await openDog({ upload: false })
    await addUpload(d, new File([BRIEF], 'fx13-brief.txt', { type: 'text/plain' }))
    await addUpload(d, new File([PNG_1PX], 'picture-01.png', { type: 'image/png' }))
    const meter = refsBody().querySelector('.dog-refs-meter')
    const track = meter.querySelector('[role="meter"]')
    expect({
      hover: meter.getAttribute('title'),
      words: meter.querySelector('.dog-refs-meter-words').textContent,
      valuetext: track.getAttribute('aria-valuetext'),
      valuenow: track.getAttribute('aria-valuenow'),
      over: meter.getAttribute('data-over'),
    }).toEqual(METER_BEFORE)
  })

  it('FX13\'s rule with the upload in References: the box empty, Enter asks; with words, Enter starts a full deck that carries the upload', async () => {
    const d = await openDog()
    expect(uploadRows()).toHaveLength(1)                 // the upload went in through References
    await pressEnter(document.body)
    await waitFor(() => expect(document.activeElement).toBe(d.box()))
    expect(callAI).not.toHaveBeenCalled()
    expect(d.toasts()).toHaveLength(1)
    await type(d.box(), CONTEXT)
    await act(async () => { document.activeElement.blur() })
    await pressEnter(document.body)
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(sent()).toContain(`DECK CONTEXT & GUIDELINES:\\n${CONTEXT}`)
    expect(sent()).toContain(BRIEF)
  })

  // Review round 1, note 9: the video row was pinned only with a fake entry.
  it('a video upload, through D.O.G.\'s own handler, is a row with the video glyph and "placed only, not read"', async () => {
    const d = await openDog({ upload: false })
    await addUpload(d, new File([new Uint8Array(64)], 'clip-01.mp4', { type: 'video/mp4' }))
    const row = uploadRows()[0]
    expect(row.querySelector('svg.dog-file-icon').classList.contains('lucide-video')).toBe(true)
    expect(row.querySelector('.dog-refs-sub').textContent).toBe('placed only, not read')
    expect(row.querySelector('.dog-file-size').textContent).toBe('(0.1 KB)')
  })

  // Review round 1, finding 2: the handler's refusal went to the banner at the
  // top of D.O.G.'s column, out of sight once uploads pushed Choose file down.
  it('a kind the handler refuses is said under Choose file, not in the banner at the top; the next upload clears it', async () => {
    const d = await openDog({ upload: false })
    await act(async () => { fireEvent.change(chooseInput(), { target: { files: [new File(['x'], 'note-00.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })] } }) })
    const said = await waitFor(() => { const a = refsBody().querySelector('.dog-refs-uploads [role="alert"]'); expect(a).not.toBe(null); return a })
    expect(said.textContent).toBe('Please upload a PDF, Markdown, Text, Image, or Video file')
    expect([...d.view.container.querySelectorAll('.ui-banner')].some((b) => /Please upload/.test(b.textContent))).toBe(false)
    expect(uploadRows()).toHaveLength(0)
    await addUpload(d, new File([BRIEF], 'fx13-brief.txt', { type: 'text/plain' }))
    expect(refsBody().querySelector('.dog-refs-uploads [role="alert"]')).toBe(null)
  })

  const refuse = async () => {
    await act(async () => { fireEvent.change(chooseInput(), { target: { files: [new File(['x'], 'note-00.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })] } }) })
    return refsBody().querySelector('.dog-refs-uploads [role="alert"]')
  }

  // Review round 2, finding 2: the banner's words went when a generation
  // started; the refusal under Choose file outlived it.
  it('a generation starting clears the refusal, as it cleared the banner', async () => {
    const d = await openDog()
    expect((await refuse()).textContent).toBe('Please upload a PDF, Markdown, Text, Image, or Video file')
    await type(d.box(), CONTEXT)
    await act(async () => { fireEvent.click(fullDeckButton(d)) })
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(refsBody().querySelector('.dog-refs-uploads [role="alert"]')).toBe(null)
  })

  // Review round 2, finding 3: the clear at an upload's start and the refusal
  // fell in one batch, so the same words twice changed nothing and were not
  // announced again.
  it('the same refusal twice is a new alert the second time, so it is announced again', async () => {
    await openDog({ upload: false })
    const first = await refuse()
    expect(first).not.toBe(null)
    const second = await refuse()
    expect(second.textContent).toBe(first.textContent)
    expect(second).not.toBe(first)
    expect(first.isConnected).toBe(false)
  })
})

// =============================================================================
// DG2 review round 1, finding 1 (High): Enter on an upload's × took the row
// away with focus on it; focus fell to <body>, and the next Enter was D.O.G.'s
// "Enter generates", a full deck from what was left. Keyboard focus now moves
// to the next Remove (ReferencesCard's focusAfterRemove). jsdom never matches
// :focus-visible: here it follows Chromium's rule, as FX14's Toast.test.jsx
// stub does (visible unless the last input before focus arrived was the mouse).
// =============================================================================
describe('DG2 review round 1 on the rendered D.O.G.: Enter on an upload\'s × never leaves focus on the page', () => {
  let mouse = false
  let visibleFocus = null
  let spy
  const onKey = () => { mouse = false }
  const onMouse = () => { mouse = true }
  const onFocusIn = (e) => { visibleFocus = mouse ? null : e.target }
  beforeEach(() => {
    mouse = false
    visibleFocus = null
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onMouse, true)
    document.addEventListener('focusin', onFocusIn, true)
    const matches = Element.prototype.matches
    spy = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (sel) {
      if (sel === ':focus-visible') return this === this.ownerDocument.activeElement && this === visibleFocus
      return matches.call(this, sel)
    })
  })
  afterEach(() => {
    spy.mockRestore()
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('mousedown', onMouse, true)
    document.removeEventListener('focusin', onFocusIn, true)
  })
  async function twoNotes() {
    const d = await openDog({ upload: false })
    await addUpload(d, new File(['Note one.'], 'note-01.txt', { type: 'text/plain' }))
    await new Promise((r) => setTimeout(r, 2))
    await addUpload(d, new File(['Note two.'], 'note-02.txt', { type: 'text/plain' }))
    await type(d.box(), CONTEXT)
    return d
  }

  it('with words in the box: Enter on the first ×, then Enter again, removes both and starts no deck; focus ends on Add references', async () => {
    const d = await twoNotes()
    const first = screen.getByRole('button', { name: 'Remove note-01.txt' })
    await act(async () => { first.focus() })
    await pressEnter(first)
    expect(uploadRows()).toHaveLength(1)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove note-02.txt' }))
    await pressEnter(document.activeElement)
    expect(uploadRows()).toHaveLength(0)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add references' }))
    await new Promise((r) => setTimeout(r, 20))
    expect(callAI).not.toHaveBeenCalled()
    expect(d.toasts()).toHaveLength(0)
  })

  it('CONTROL, the pointer as before DG2: a × the mouse pressed leaves focus to fall, and Enter on the page then starts the deck with what is left', async () => {
    await twoNotes()
    const first = screen.getByRole('button', { name: 'Remove note-01.txt' })
    await act(async () => { fireEvent.mouseDown(first); first.focus() })
    await act(async () => { fireEvent.click(first) })
    expect(uploadRows()).toHaveLength(1)
    expect(document.activeElement).toBe(document.body)
    await pressEnter(document.body)
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(sent()).toContain('Note two.')
    expect(sent()).not.toContain('Note one.')
  })

  // DG3 (OUTSTANDING DG2-01): Choose file is a Tab stop now, and it goes at
  // the 20th upload. Pressed from the keyboard, it took focus to the page
  // with it, and the next Enter made a full deck (MEASURED in Chromium, the
  // DG3 hand-off). Focus goes to the upload it added. jsdom opens no picker:
  // the picked file is given to the input, as a picker gives it.
  async function nineteenAndWords() {
    const d = await openDog({ upload: false })
    for (let i = 1; i <= 19; i++) {
      await addUpload(d, new File([`Note ${i}.`], `note-${String(i).padStart(2, '0')}.txt`, { type: 'text/plain' }))
      await new Promise((r) => setTimeout(r, 2))       // D.O.G. keys an upload by Date.now()
    }
    await type(d.box(), CONTEXT)
    return d
  }
  const pick20 = (d) => addUpload(d, new File(['Note 20.'], 'note-20.txt', { type: 'text/plain' }))

  it('the 20th upload through Choose file by keyboard, words in the box: focus goes to that upload\'s Remove, and the next Enter removes it and starts no deck', async () => {
    const d = await nineteenAndWords()
    const choose = screen.getByRole('button', { name: 'Choose file' })
    await act(async () => { choose.focus() })
    expect(await pressEnter(choose)).toBe(true)           // the button's: it opens the picker
    await pick20(d)
    expect(screen.queryByRole('button', { name: 'Choose file' })).toBe(null)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove note-20.txt' }))
    await pressEnter(document.activeElement)
    expect(uploadRows()).toHaveLength(19)
    await new Promise((r) => setTimeout(r, 20))
    expect(callAI).not.toHaveBeenCalled()
    expect(d.toasts()).toHaveLength(0)
  })

  it('CONTROL, Choose file clicked with the mouse: the 20th upload leaves focus to fall, and Enter on the page then starts the deck', async () => {
    const d = await nineteenAndWords()
    const choose = screen.getByRole('button', { name: 'Choose file' })
    await act(async () => { fireEvent.mouseDown(choose); choose.focus() })
    await act(async () => { fireEvent.click(choose) })
    await pick20(d)
    expect(document.activeElement).toBe(document.body)
    await pressEnter(document.body)
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(sent()).toContain('Note 20.')
  })
})

// =============================================================================
// DG2 (2026-10-26): why openDog flushes D.O.G.'s effects after an upload.
// D.O.G.'s Enter listener is attached by a passive effect whose dependencies
// carry `hasFileContent`; it runs after the commit that draws the upload.
// Testing Library's waitFor can resolve in between (its MutationObserver fires
// in the commit's microtasks), and an Enter there meets the listener that
// still says "nothing to read". MEASURED: three one-off failures of the FX13
// cases in this file during DG2 (one at 36 ms, `kept` true: not a timeout).
// =============================================================================
describe('DG2: the harness waits for D.O.G.\'s effects after an upload', () => {
  it('CONTROL: an Enter in the gap between the upload\'s commit and its effects is not D.O.G.\'s yet; once the effects have run, it is', async () => {
    const view = render(<ToastProvider bar="0px"><DeckOutlineGenerator currentPage="dog" /></ToastProvider>)
    const input = view.container.querySelector('input[type=file][accept*=".txt"]')
    const kept = await new Promise((resolve) => {
      const mo = new MutationObserver(() => {
        if (!view.container.textContent.includes('gap-01.txt')) return
        mo.disconnect()
        resolve(fireEvent.keyDown(document.body, { key: 'Enter' }))
      })
      mo.observe(view.container, { childList: true, subtree: true, characterData: true })
      fireEvent.change(input, { target: { files: [new File(['Gap.'], 'gap-01.txt', { type: 'text/plain' })] } })
    })
    expect(kept).toBe(true)                            // the listener from before the upload
    await act(async () => {})                          // what openDog now does
    let after
    await act(async () => { after = fireEvent.keyDown(document.body, { key: 'Enter' }) })
    expect(after).toBe(false)                          // D.O.G.'s: it asks for the deck context
    expect(callAI).not.toHaveBeenCalled()
  })
})

// =============================================================================
// FX15 (OUTSTANDING FX14-02 and FX14-04): D.O.G.'s settings sections say
// whether they are open, and its two dropdowns answer to their labels. Before
// FX15 Chromium named both dropdowns "" (a bare combobox), and the drawer's 20
// folding headers (16 places in the source: 16 on System prompts, 4 on Output
// format) said nothing of their state (scripts/fx15-landmarks-names.mjs, the
// FX15 hand-off). jsdom computes a name in the words' own case; Chromium reads
// a label in the kit's capitals (text-transform), as FX13's box label.
// =============================================================================
const SECTIONS = {
  'System prompts': [
    'Single Page - API System Message', 'Single Page - Generation Rules', 'Full Deck - API System Message',
    'Full Deck - Generation Rules', 'Theme Color Generation', 'Shared Rules (All Models)', 'Midjourney Prompt',
    'Flux Prompt', 'Nano Banana Prompt', 'Chat GPT / DALL-E Prompt', 'Image Prompt - API System Message',
    'Relaxed', 'Formal', 'Extend', 'Shorten', 'Editor pass',
  ],
  'Output format': ['Single Page Export Schema', 'Full Deck Export Schema', 'Visual Deck Export Schema', 'Image Prompt Export Schema'],
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// A header's name is its label and then its line of description.
const section = (label) => screen.getByRole('button', { name: new RegExp(`^${escapeRe(label)} `) })
async function openSettings(tab) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'D.O.G. settings' })) })
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: tab })) })
}
// A tab's headers, each found once by role and name. A name lookup reads the
// whole drawer, so the loops below work on the elements found here: React
// keeps each header's element across its folds (each loop ends by checking
// that a name still finds the same one).
async function headersOf(tab) {
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: tab })) })
  return SECTIONS[tab].map((l) => [l, section(l)])
}

describe('FX15 on the rendered D.O.G.: the settings sections say whether they are open', () => {
  for (const [tab, labels] of Object.entries(SECTIONS)) {
    it(`${tab}: each of its ${labels.length} headers is a button named by its label, closed, controlling nothing drawn`, async () => {
      await openDog({ upload: false })
      await openSettings(tab)
      const heads = [...document.querySelectorAll('button.dog-acc-head')]
      expect(heads).toHaveLength(labels.length)
      expect(labels.map((l) => section(l))).toEqual(heads)          // every header, by role and name, in order
      for (const h of heads) {
        expect(h.getAttribute('aria-expanded')).toBe('false')
        expect(h.hasAttribute('aria-controls')).toBe(false)          // no body drawn, no reference (FX14's rule 3)
        expect(h.closest('.dog-acc').querySelector('.dog-acc-body')).toBe(null)
      }
    })
  }

  it('each opens and closes from its header: aria-expanded both ways, aria-controls naming the body only while it is drawn; the others unchanged', async () => {
    await openDog({ upload: false })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'D.O.G. settings' })) })
    for (const tab of Object.keys(SECTIONS)) {
      const heads = await headersOf(tab)
      for (const [l, h] of heads) {
        await act(async () => { fireEvent.click(h) })
        expect([l, h.getAttribute('aria-expanded')]).toEqual([l, 'true'])
        const body = document.getElementById(h.getAttribute('aria-controls'))
        expect([l, body]).toEqual([l, h.closest('.dog-acc').querySelector('.dog-acc-body')])
        expect(body.querySelector('textarea')).not.toBe(null)
        for (const [o, g] of heads) if (g !== h) expect([o, g.getAttribute('aria-expanded')]).toEqual([o, 'false'])
        await act(async () => { fireEvent.click(h) })
        expect([l, h.getAttribute('aria-expanded'), h.hasAttribute('aria-controls')]).toEqual([l, 'false', false])
        expect(h.closest('.dog-acc').querySelector('.dog-acc-body')).toBe(null)
      }
      for (const [l, h] of heads) expect([l, section(l) === h]).toEqual([l, true])
    }
  })

  it('every id a header names is its own: twenty sections open at once, twenty different bodies', async () => {
    await openDog({ upload: false })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'D.O.G. settings' })) })
    const ids = []
    for (const tab of Object.keys(SECTIONS)) {
      const heads = await headersOf(tab)
      for (const [, h] of heads) await act(async () => { fireEvent.click(h) })
      for (const [l, h] of heads) {
        expect([l, section(l) === h]).toEqual([l, true])
        ids.push(h.getAttribute('aria-controls'))
      }
    }
    expect(ids).toHaveLength(20)
    expect(new Set(ids).size).toBe(20)
    // CONTROL: the tab on screen draws only its own bodies.
    for (const id of ids.slice(16)) expect(document.getElementById(id)).not.toBe(null)
    for (const id of ids.slice(0, 16)) expect(document.getElementById(id)).toBe(null)
  })
})

// DG3 (Audrey, 2026-10-27: "Choose a project"): the label, and so the
// dropdown's name, reads "Choose a project"; card 1's title stays "Project".
describe('FX15 on the rendered D.O.G.: the dropdowns answer to their labels', () => {
  it('Full deck: the Project dropdown is named "Choose a project"; no combobox in D.O.G.\'s column is unnamed', async () => {
    const d = await openDog({ upload: false })
    expect(d.sw().getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('combobox', { name: 'Choose a project' })).toBe(d.q('select.dog-project-select'))
    const boxes = screen.getAllByRole('combobox').filter((c) => c.closest('.dog-main'))
    expect(boxes).toHaveLength(1)
  })
  it('Single page: the layout dropdown is named "Slide Layout Type", and the Project dropdown keeps its name', async () => {
    const d = await openDog({ upload: false })
    await act(async () => { fireEvent.click(d.sw()) })
    expect(d.sw().getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('combobox', { name: 'Slide Layout Type' })).toBe(d.q('.dog-layout-select select'))
    expect(screen.getByRole('combobox', { name: 'Choose a project' })).toBe(d.q('select.dog-project-select'))
    // CONTROL: the two are the column's only comboboxes, so none is left unnamed.
    expect(screen.getAllByRole('combobox').filter((c) => c.closest('.dog-main'))).toHaveLength(2)
  })
  it('each label is tied to its dropdown (the label\'s own control), as a click on it in a browser uses', async () => {
    const d = await openDog({ upload: false })
    expect(d.q('label[for="dog-project"]').control).toBe(d.q('select.dog-project-select'))
    await act(async () => { fireEvent.click(d.sw()) })
    expect(d.q('label[for="dog-slide-layout"]').control).toBe(d.q('.dog-layout-select select'))
  })
})

// =============================================================================
// DG3 (2026-10-27): D.O.G.'s closed list (docs/sessions/PLAN_TO_1_0.md §3),
// on the rendered component. Chromium's own figures, before and after, are
// in the DG3 hand-off.
//   DG3-01  Audrey: "Choose a project". Card 1's field label says what the
//           dropdown does and names it; the title stays "1 Project".
//   DG2-02  a press on a Generate button with its box focused lands.
//   DG2-01  Choose file is a Tab stop, and Enter on it never generates.
// =============================================================================
const here = dirname(fileURLToPath(import.meta.url))
const PAGE_REQUEST = 'A page listing the three watch faces.'

// DG4: the heading is "Project and references" now (the merged card); DG3-01
// stands inside it: the label reads "Choose a project" and names the dropdown.
describe('DG3 on the rendered D.O.G.: card 1\'s label reads "Choose a project" (DG3-01, inside DG4\'s merged card)', () => {
  it('the field label reads "Choose a project" and names the dropdown; the card table\'s name is the heading\'s button, and nothing else answers to it', async () => {
    const d = await openDog({ upload: false })
    const label = d.q('label[for="dog-project"]')
    expect(label.textContent.trim()).toBe('Choose a project')
    expect(label.control).toBe(d.q('select.dog-project-select'))
    expect(document.getElementById('dog-card1-title').textContent).toBe('Project and references')
    // The card table's name (FX14) is the heading's button, named by the
    // heading; nothing else answers to it, the dropdown least of all.
    expect(CARDS[0].name).toBe('Project and references')
    expect(screen.getAllByRole('button', { name: 'Project and references' })).toEqual([headButton('Project and references')])
    expect(headButton('Project and references').getAttribute('aria-labelledby')).toBe('dog-card1-title')
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBe(null)
    expect(screen.queryByRole('combobox', { name: 'Project and references' })).toBe(null)
    expect(screen.getAllByText('Choose a project', { exact: true })).toEqual([label])
  })
})

/** A pointer press as a browser delivers it: mousedown, then, unless the page
    cancels it, focus moves to the button and the focused box blurs; mouseup,
    and the click when the release lands on the button. dog.css draws each box
    taller while focused (`data-focused`), so a blur under the press moves the
    button up before the release, which then lands below it, and no click
    fires (OUTSTANDING DG2-02, MEASURED in Chromium by DG2 and DG3: the button
    80px up, `generateFullDeck` never run). jsdom has no layout: the move is
    read off the attribute the two height rules key on. */
async function pointerPress(button, box) {
  const grown = box.getAttribute('data-focused')
  let kept
  await act(async () => { kept = fireEvent.mouseDown(button) })
  if (kept) await act(async () => { button.focus() })
  const moved = box.getAttribute('data-focused') !== grown
  await act(async () => { fireEvent.mouseUp(moved ? box.closest('.dog-card-body') : button) })
  if (!moved) await act(async () => { fireEvent.click(button) })
  return { kept, moved }
}
const pageButton = (d) => [...d.view.container.querySelectorAll('button.dog-generate')].find((b) => /Generate page outline/.test(b.textContent))

describe('DG3 on the rendered D.O.G.: a press on Generate with its box focused lands (OUTSTANDING DG2-02)', () => {
  it('the premise, on the sheet: each box is taller while focused, keyed on data-focused (80 to 160px; the page request box 96 to 160px)', () => {
    const css = readFileSync(resolve(here, 'dog.css'), 'utf8')
    expect(css).toMatch(/\.ui-input\.dog-context-prompt \{ height: 80px;/)
    expect(css).toMatch(/\.ui-input\.dog-context-prompt\[data-focused='true'\] \{ height: 160px; \}/)
    expect(css).toMatch(/\.ui-input\.dog-page-request \{ height: 96px;/)
    expect(css).toMatch(/\.ui-input\.dog-page-request\[data-focused='true'\] \{ height: 160px; \}/)
  })

  it('Full deck: words in the box, the box focused, a press on Generate full deck outline keeps focus in the box, the box grown, and starts the deck with the words', async () => {
    const d = await openDog()
    await act(async () => { d.box().focus() })
    await type(d.box(), CONTEXT)
    expect(d.box().getAttribute('data-focused')).toBe('true')
    expect(await pointerPress(fullDeckButton(d), d.box())).toEqual({ kept: false, moved: false })
    expect(document.activeElement).toBe(d.box())
    expect(d.box().getAttribute('data-focused')).toBe('true')
    expect(d.box().value).toBe(CONTEXT)
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(sent()).toContain(`DECK CONTEXT & GUIDELINES:\\n${CONTEXT}`)
  })

  it('Single page: a layout and words in the page request box, the box focused, a press on Generate page outline starts the page', async () => {
    const d = await openDog()
    await act(async () => { fireEvent.click(d.sw()) })
    const layout = d.q('.dog-layout-select select')
    await act(async () => { fireEvent.change(layout, { target: { value: layout.options[1].value } }) })
    const pageBox = d.q('textarea.dog-page-request')
    await act(async () => { pageBox.focus() })
    await type(pageBox, PAGE_REQUEST)
    expect(pageBox.getAttribute('data-focused')).toBe('true')
    expect(await pointerPress(pageButton(d), pageBox)).toEqual({ kept: false, moved: false })
    expect(document.activeElement).toBe(pageBox)
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(sent()).toContain(PAGE_REQUEST)
  })

  for (const which of ['full deck', 'page']) {
    it(`CONTROL, D.O.G.'s mousedown kept from running (${which}): the box blurs under the press, the button moves, and nothing generates`, async () => {
      const d = await openDog()
      let box = d.box()
      let button = fullDeckButton(d)
      if (which === 'page') {
        await act(async () => { fireEvent.click(d.sw()) })
        const layout = d.q('.dog-layout-select select')
        await act(async () => { fireEvent.change(layout, { target: { value: layout.options[1].value } }) })
        box = d.q('textarea.dog-page-request')
        button = pageButton(d)
      }
      await act(async () => { box.focus() })
      await type(box, which === 'page' ? PAGE_REQUEST : CONTEXT)
      // React reads events at its root; a capture listener on the document
      // runs before it, and stopping the event there keeps D.O.G.'s handler out.
      const stop = (e) => e.stopPropagation()
      document.addEventListener('mousedown', stop, true)
      try {
        expect(await pointerPress(button, box)).toEqual({ kept: true, moved: true })
      } finally {
        document.removeEventListener('mousedown', stop, true)
      }
      expect(box.getAttribute('data-focused')).toBe('false')
      await new Promise((r) => setTimeout(r, 20))
      expect(callAI).not.toHaveBeenCalled()
    })
  }

  it('the keyboard as before: Enter on the focused Generate full deck outline is the button\'s, and starts the deck', async () => {
    const d = await openDog()
    await type(d.box(), CONTEXT)
    const b = fullDeckButton(d)
    await act(async () => { b.focus() })
    expect(await pressEnter(b)).toBe(true)
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
  })
})

describe('DG3 on the rendered D.O.G.: Choose file by keyboard (OUTSTANDING DG2-01)', () => {
  const chooseButton = () => screen.getByRole('button', { name: 'Choose file' })
  const tabStops = (d) => [...d.view.container.querySelectorAll('.dog-main button, .dog-main input, .dog-main select, .dog-main textarea, .dog-main [tabindex]')]
    .filter((el) => !el.disabled && el.tabIndex >= 0 && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && !el.classList.contains('hidden'))

  // DG4: the references follow the project in one card, so the stop before
  // Choose file is New project (it was the References header's button).
  it('Choose file is a Tab stop in the references, after New project and before Add references; with two uploads, after their Removes; the file input never is', async () => {
    const d = await openDog({ upload: false })
    let stops = tabStops(d)
    const at = (el) => stops.indexOf(el)
    const newProject = screen.getByRole('button', { name: 'New project' })
    expect(at(chooseButton())).toBeGreaterThan(at(newProject))
    expect(at(chooseButton())).toBe(at(newProject) + 1)
    expect(at(screen.getByRole('button', { name: 'Add references' }))).toBe(at(chooseButton()) + 1)
    expect(stops.some((el) => el.matches('input[type=file]'))).toBe(false)
    await addUpload(d, new File(['Note one.'], 'note-01.txt', { type: 'text/plain' }))
    await new Promise((r) => setTimeout(r, 2))
    await addUpload(d, new File(['Note two.'], 'note-02.txt', { type: 'text/plain' }))
    stops = tabStops(d)
    const names = stops.slice(at(newProject) + 1, at(screen.getByRole('button', { name: 'Add references' })) + 1)
      .map((el) => el.getAttribute('aria-label') || el.textContent.trim())
    expect(names).toEqual(['Remove note-01.txt', 'Remove note-02.txt', 'Choose file', 'Add references'])
  })

  for (const words of [false, true]) {
    for (const [key, press] of [['Enter', pressEnter], ['Space', pressSpace]]) {
      it(`${key} on Choose file, the deck context box ${words ? 'with words' : 'empty'}, Full deck on: the picker's click, no deck, no note, focus stays`, async () => {
        const d = await openDog()
        expect(d.sw().getAttribute('aria-checked')).toBe('true')
        if (words) await type(d.box(), CONTEXT)
        const click = vi.spyOn(chooseInput(), 'click')
        const b = chooseButton()
        await act(async () => { b.focus() })
        expect(await press(b)).toBe(true)                 // left to the button (enterGenerates.js)
        expect(click).toHaveBeenCalledTimes(1)
        expect(document.activeElement).toBe(b)
        await new Promise((r) => setTimeout(r, 20))
        expect(callAI).not.toHaveBeenCalled()
        expect(d.toasts()).toHaveLength(0)
        if (words) expect(d.box().value).toBe(CONTEXT)
      })
    }
  }

  it('CONTROL: the same Enter on the page, words in the box, starts the deck (Choose file is what kept it from the page)', async () => {
    const d = await openDog()
    await type(d.box(), CONTEXT)
    await act(async () => { chooseButton().focus() })
    await act(async () => { document.activeElement.blur() })
    await pressEnter(document.body)
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
  })
})

// =============================================================================
// DG4 (Audrey, 2026-10-28; her five notes verbatim in
// docs/sessions/briefs/po-dg4-dog-project-references-card.md), on the
// rendered component. Chromium's own figures, before and after, are in the
// DG4 hand-off and walkthrough 84's DG4 section.
//   1  the References meter a fixed width and thicker (dogCss.test.js)
//   2  "Use visual assets" reads "Place visual", its subtitle gone; "Use
//      project assets" gone: a listed reference is read because it is
//      listed, and Place visual places media from the uploads and the
//      references alike
//   3  "Theme generator" to its right: the card's only two checkboxes
//   4  Core files only, beside Add references
//   5  cards 1 and 2 are one, "1 Project and references"
// The project, its files and their bodies are made up (a file name is
// content); they reach D.O.G. through `rabbit.value` (the mock above).
// =============================================================================
const PROJECT = { id: 'p-dg4', title: 'Lantern test', description: 'A made-up project.', updated_at: '2026-10-28T00:00:00Z' }
const FILE_KEY = 'projects/11111111-2222-3333-4444-555555555555'
const fileRow = (over = {}) => ({
  project_id: PROJECT.id, name: 'brief.txt', mime_type: 'text/plain', size_bytes: 40,
  storage_path: `${FILE_KEY}/DOCUMENTS/${over.name || 'brief.txt'}`, is_core_definer: true, uploaded_at: '2026-10-28T09:00:00Z',
  ...over,
})
// Two Core files D.O.G. can read, one it cannot (a Photoshop file), one not Core.
const CORE = () => [
  fileRow({ id: 'c1', name: 'core-brief.txt', body: 'THE CORE BRIEF.' }),
  fileRow({ id: 'c2', name: 'core-board.png', mime_type: 'image/png', size_bytes: PNG_1PX.length, png: true }),
  fileRow({ id: 'c3', name: 'core-prop.psd', mime_type: 'image/vnd.adobe.photoshop', size_bytes: 9000 }),
  fileRow({ id: 'r1', name: 'ref-notes.txt', body: 'THE REFERENCE NOTES.', is_core_definer: false }),
]
/** The project and a cloud-like adapter, handed to D.O.G. through useRabbit. */
function withProject(files) {
  const adapter = {
    listAssets: async () => [], listTasks: async () => [], listScenes: async () => [], listShots: async () => [],
    listLevels: async () => [], listExperiences: async () => [], listPhases: async () => [], listMilestones: async () => [],
    listFolders: async () => [], listTaskItems: async () => [], listNotes: async () => [],
    listFiles: vi.fn(async (pid) => files.filter((f) => f.project_id === pid)),
    downloadFile: vi.fn(async (row) => new Blob([row.png ? PNG_1PX : (row.body || 'BODY')], { type: row.mime_type })),
  }
  rabbit.value = { projectsIndex: { [PROJECT.id]: PROJECT }, refreshProjectsIndex: () => {}, adapterMode: 'supabase', getAdapter: () => adapter }
  return adapter
}
const coreBox = () => screen.getByRole('checkbox', { name: 'Core files only' })
const coreSaid = () => document.querySelector('#dog-card1-body .dog-refs-core-said')
/** Choose the project and wait for its list (the checkbox's "Looking for…" gone). */
async function chooseProject(d) {
  await act(async () => { fireEvent.change(d.q('select.dog-project-select'), { target: { value: PROJECT.id } }) })
  await waitFor(() => expect(coreSaid()?.textContent || '').not.toMatch(/^Looking for/))
  await act(async () => {})
}
const refNames = () => [...refsBody().querySelectorAll('.dog-refs-group:not(.dog-refs-uploads) .dog-refs-name')].map((n) => n.textContent)

describe('DG4 on the rendered D.O.G.: one card, "1 Project and references" (note 5)', () => {
  it('the project first, then the references in her order under the contract line, Core files only beside Add references; the steps read 1 and 2', async () => {
    const d = await openDog({ upload: false })
    expect(d.q('#dog-refs-body')).toBe(null)
    expect(screen.queryByRole('button', { name: 'References' })).toBe(null)
    expect([...d.view.container.querySelectorAll('.dog-main .dog-step-title')].map((h) => h.textContent)).toEqual(['1Project and references', '2Generate outline'])
    const card1 = d.q('#dog-card1-body')
    const order = [
      d.q('label[for="dog-project"]'),
      d.q('select.dog-project-select'),
      within(card1).getByRole('button', { name: 'New project' }),
      card1.querySelector('.dog-refs-contract'),
      card1.querySelector('.dog-refs-uploads'),
      [...card1.querySelectorAll('.dog-details-note')].find((p) => /^Choose a project to reference/.test(p.textContent)),
      card1.querySelector('.dog-refs-meter'),
      within(card1).getByRole('button', { name: 'Add references' }),
      coreBox(),
      coreSaid(),
    ]
    expect(order.every(Boolean)).toBe(true)
    for (let i = 1; i < order.length; i++) {
      expect(!!(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING), `item ${i}`).toBe(true)
    }
    // The header's one number is card 1's.
    expect(d.q('.dog-refs-count').closest('.dog-card-head')).toBe(head('Project and references'))
    expect(d.q('.dog-refs-count').textContent).toBe('None chosen')
  })

  it('folded, card 1 hides the project and the references, and its header keeps the one number', async () => {
    const d = await openDog()
    expect(d.q('.dog-refs-count').textContent).toBe('1 chosen')
    await act(async () => { fireEvent.click(headButton('Project and references')) })
    expect(d.q('#dog-card1-body')).toBe(null)
    expect(d.q('select.dog-project-select')).toBe(null)
    expect(d.q('.dog-main input[type=file]')).toBe(null)
    expect(d.q('.dog-refs-count').textContent).toBe('1 chosen')
  })
})

describe('DG4 on the rendered D.O.G.: the Generate outline card keeps two checkboxes, side by side (notes 2 and 3)', () => {
  const card2 = (d) => d.q('#dog-card3-body')
  for (const side of ['Full deck', 'Single page']) {
    it(`${side}: exactly "Place visual" then "Theme generator", on one row; Place visual has no subtitle, its meaning on the hover`, async () => {
      const d = await openDog({ upload: false })
      if (side === 'Single page') await act(async () => { fireEvent.click(d.sw()) })
      expect(d.sw().getAttribute('aria-checked')).toBe(side === 'Full deck' ? 'true' : 'false')
      const boxes = [...card2(d).querySelectorAll('button.dog-check')]
      expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual(['Place visual', 'Theme generator'])
      const row = card2(d).querySelector('.dog-checks')
      expect(boxes.every((b) => b.closest('.dog-checks') === row)).toBe(true)
      expect(row.children).toHaveLength(2)
      const place = d.check('Place visual')
      expect(place.getAttribute('aria-checked')).toBe('false')
      expect(place.hasAttribute('aria-describedby')).toBe(false)
      expect(place.closest('.dog-check-row').textContent).toBe('Place visual')
      expect(place.getAttribute('title')).toBe('Places the pictures and videos from your uploads and references in the slides.')
      expect(d.view.container.querySelector('.dog-check-hint, #dog-visual-assets-hint')).toBe(null)
      expect(screen.queryByRole('checkbox', { name: /Use (visual|project) assets/ })).toBe(null)
    })
  }

  it('the deck context box\'s label stands alone, no checkbox beside it', async () => {
    const d = await openDog({ upload: false })
    expect(d.q('label[for="dog-deck-context"]').parentElement.querySelector('.dog-check')).toBe(null)
  })

  it('Single page names what Full deck still applies only when there is some: the context, never the theme generator (on screen now)', async () => {
    const d = await openDog({ upload: false })
    await act(async () => { fireEvent.click(d.sw()) })
    expect(d.q('.dog-applied-line')).toBe(null)
    await act(async () => { fireEvent.click(d.sw()) })
    await type(d.box(), CONTEXT)
    await act(async () => { fireEvent.click(d.sw()) })
    expect(d.q('.dog-applied-line').textContent).toBe(`Also applied here, from Full deck: your context (“${CONTEXT}”).`)
  })
})

describe('DG4 on the rendered D.O.G.: Place visual places an upload\'s media and a listed reference\'s alike; off, nothing (note 2)', () => {
  async function deckWith({ place }) {
    withProject(CORE())
    const d = await openDog({ upload: false })
    await addUpload(d, new File([PNG_1PX], 'picture-01.png', { type: 'image/png' }))
    await chooseProject(d)
    await act(async () => { fireEvent.click(coreBox()) })
    if (place) await act(async () => { fireEvent.click(d.check('Place visual')) })
    expect(d.check('Place visual').getAttribute('aria-checked')).toBe(String(place))
    await type(d.box(), CONTEXT)
    await act(async () => { fireEvent.click(fullDeckButton(d)) })
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    return d
  }

  it('off (as it opens): the listed reference\'s picture is still sent to be read, because it is listed, and nothing is placed', async () => {
    await deckWith({ place: false })
    expect(sent()).toContain('[Project · CORE] core-board.png (image)')
    expect(sent()).not.toContain('AVAILABLE VISUAL ASSETS FOR PLACEMENT')
  })

  it('on: the upload\'s picture and the reference\'s alike are offered for placement, with no second box', async () => {
    await deckWith({ place: true })
    expect(sent()).toMatch(/AVAILABLE VISUAL ASSETS FOR PLACEMENT:\\n1\. picture-01\.png \(image\)\\n2\. core-board\.png \(image\)\\n/)
  })

  // Review round 1, finding 4: a listed video is read only to be placed, so
  // only with Place visual; it is never sent to the AI either way.
  for (const place of [false, true]) {
    it(`a listed video with Place visual ${place ? 'on is read and offered for placement' : 'off is neither read nor named'}`, async () => {
      const adapter = withProject([
        fileRow({ id: 'v1', name: 'core-clip.mp4', mime_type: 'video/mp4', size_bytes: 64 }),
        fileRow({ id: 'c1', name: 'core-brief.txt', body: 'THE CORE BRIEF.' }),
      ])
      const d = await openDog({ upload: false })
      await chooseProject(d)
      await act(async () => { fireEvent.click(coreBox()) })
      await waitFor(() => expect(refNames()).toEqual(['core-brief.txt', 'core-clip.mp4']))
      if (place) await act(async () => { fireEvent.click(d.check('Place visual')) })
      await type(d.box(), CONTEXT)
      await act(async () => { fireEvent.click(fullDeckButton(d)) })
      await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
      const read = adapter.downloadFile.mock.calls.map(([row]) => row.id).sort()
      if (place) {
        expect(read).toEqual(['c1', 'v1'])
        expect(sent()).toMatch(/AVAILABLE VISUAL ASSETS FOR PLACEMENT:\\n1\. core-clip\.mp4 \(video\)\\n/)
      } else {
        expect(read).toEqual(['c1'])
        expect(sent()).not.toContain('core-clip.mp4')
      }
    })
  }
})

describe('DG4 on the rendered D.O.G.: Core files only (note 4)', () => {
  it('off, with its sentence, before a project is chosen; off while the project has no Core file D.O.G. can read', async () => {
    withProject([CORE()[2], CORE()[3]])
    const d = await openDog({ upload: false })
    expect(coreBox().disabled).toBe(true)
    expect(coreSaid().textContent).toBe('Core files come from a project: choose one above.')
    await chooseProject(d)
    expect(coreBox().disabled).toBe(true)
    expect(coreSaid().textContent).toBe('This project has no Core files D.O.G. can read.')
  })

  it('ticked: the card lists exactly the readable Core files, the meter counts them, Add references is off, and a deck sends exactly them', async () => {
    const adapter = withProject(CORE())
    const d = await openDog({ upload: false })
    await chooseProject(d)
    expect(coreBox().disabled).toBe(false)
    expect(coreSaid()).toBe(null)
    expect(refNames()).toEqual([])
    await act(async () => { fireEvent.click(coreBox()) })
    await waitFor(() => expect(refNames()).toEqual(['core-board.png', 'core-brief.txt']))
    expect(coreBox().getAttribute('aria-checked')).toBe('true')
    expect(d.view.container.textContent).not.toContain('core-prop.psd')
    expect(d.view.container.textContent).not.toContain('ref-notes.txt')
    expect(screen.getByRole('button', { name: 'Add references' }).disabled).toBe(true)
    expect(d.q('.dog-refs-count').textContent).toBe('2 chosen')
    // The meter counts what is listed: the text by its size, the picture at
    // its estimate, with the project's own words (Lantern test, its line).
    const expected = Math.ceil(40 / 4) + 4000 + Math.ceil(`${PROJECT.title} ${PROJECT.description}`.length / 4)
    expect(refsBody().querySelector('.dog-refs-meter').getAttribute('title')).toBe(`An estimate: about ${expected.toLocaleString()} of 200,000 tokens`)
    await type(d.box(), CONTEXT)
    await act(async () => { fireEvent.click(fullDeckButton(d)) })
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1))
    expect(sent()).toContain('[Project · CORE] core-board.png (image)')
    expect(sent()).toContain('[Project · CORE] core-brief.txt (text)')
    expect(sent()).toContain('THE CORE BRIEF.')
    expect(sent()).not.toContain('core-prop.psd')
    expect(sent()).not.toContain('ref-notes.txt')
    expect(adapter.downloadFile.mock.calls.map(([row]) => row.id).sort()).toEqual(['c1', 'c2'])
  })

  it('the window\'s choices step aside while it is ticked and come back as they were when it is cleared', async () => {
    withProject(CORE())
    const d = await openDog({ upload: false })
    await chooseProject(d)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add references' })) })
    const dialog = await screen.findByRole('dialog')
    const row = await waitFor(() => within(dialog).getByRole('checkbox', { name: 'ref-notes.txt' }))
    await act(async () => { fireEvent.click(row) })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Done' })) })
    expect(refNames()).toEqual(['ref-notes.txt'])
    await act(async () => { fireEvent.click(coreBox()) })
    await waitFor(() => expect(refNames()).toEqual(['core-board.png', 'core-brief.txt']))
    expect(coreSaid().textContent).toBe('Your 1 chosen reference is set aside while this is ticked; it comes back when you clear it.')
    await act(async () => { fireEvent.click(coreBox()) })
    expect(refNames()).toEqual(['ref-notes.txt'])
    expect(coreSaid()).toBe(null)
    expect(screen.getByRole('button', { name: 'Add references' }).disabled).toBe(false)
  })

  it('a Core file a deck sent stays in the AI\'s file store for the next Regenerate, and is let go of when the box is cleared', async () => {
    callAI.mockImplementation(async () => ({ content: [{ type: 'text', text: DECK }], stop_reason: 'end_turn' }))
    withProject(CORE())
    const d = await openDog({ upload: false })
    await chooseProject(d)
    await act(async () => { fireEvent.click(coreBox()) })
    await type(d.box(), CONTEXT)
    await act(async () => { fireEvent.click(fullDeckButton(d)) })
    await waitFor(() => expect(uploadAIFile).toHaveBeenCalledTimes(1))       // the Core picture
    await waitFor(() => expect([...d.view.container.querySelectorAll('button.dog-generate')].some((b) => /Generating/.test(b.textContent))).toBe(false))
    await new Promise((r) => setTimeout(r, 20))
    expect(deleteAIFiles).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(coreBox()) })
    await waitFor(() => expect(deleteAIFiles).toHaveBeenCalledTimes(1))
    expect(deleteAIFiles).toHaveBeenCalledWith(['file_dg2_1'])
  })

  // Review round 1, finding 5: a list on every return to D.O.G. was the
  // whole pool; it is made again only when what the box shows depends on it.
  const showPage = async (d, page) => {
    await act(async () => { d.view.rerender(<ToastProvider bar="0px"><DeckOutlineGenerator currentPage={page} /></ToastProvider>) })
  }
  it('back on D.O.G., a project whose box is off for want of Core files is listed again: a file marked Core meanwhile turns it on', async () => {
    const files = [CORE()[2], CORE()[3]]
    const adapter = withProject(files)
    const d = await openDog({ upload: false })
    await chooseProject(d)
    expect(coreBox().disabled).toBe(true)
    files.push(fileRow({ id: 'c9', name: 'core-new.txt', body: 'MARKED SINCE.' }))   // marked Core in R.A.B.B.I.T. meanwhile
    await showPage(d, 'rabbit')
    await showPage(d, 'dog')
    await waitFor(() => expect(coreBox().disabled).toBe(false))
    expect(adapter.listFiles).toHaveBeenCalledTimes(2)
  })

  it('back on D.O.G. with the box on and clear, nothing is listed again', async () => {
    const adapter = withProject(CORE())
    const d = await openDog({ upload: false })
    await chooseProject(d)
    expect(adapter.listFiles).toHaveBeenCalledTimes(1)
    await showPage(d, 'rabbit')
    await showPage(d, 'dog')
    await new Promise((r) => setTimeout(r, 20))
    expect(adapter.listFiles).toHaveBeenCalledTimes(1)
    // CONTROL: ticked, the return lists again (its rows follow the list).
    await act(async () => { fireEvent.click(coreBox()) })
    const ticked = adapter.listFiles.mock.calls.length
    await showPage(d, 'rabbit')
    await showPage(d, 'dog')
    await waitFor(() => expect(adapter.listFiles.mock.calls.length).toBe(ticked + 1))
  })

  it('Enter on it is D.O.G.\'s, as on its other tick boxes: the box empty, it asks, and the tick stays', async () => {
    withProject(CORE())
    const d = await openDog({ upload: false })
    await chooseProject(d)
    await act(async () => { fireEvent.click(coreBox()) })
    await act(async () => { coreBox().focus() })
    expect(await pressEnter(coreBox())).toBe(false)
    expect(coreBox().getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(d.box()))
    expect(callAI).not.toHaveBeenCalled()
    expect(d.toasts()).toHaveLength(1)
  })
})

// The brief: "The Tab order test moves with the new checkbox, deliberately,
// with the before and after orders quoted." D.O.G.'s column at the start
// (Full deck, nothing uploaded, no project), by this walk.
describe('DG4 on the rendered D.O.G.: the Tab order, before and after', () => {
  const nameOf = (el) => {
    const by = el.getAttribute('aria-labelledby')
    if (by) return document.getElementById(by).textContent.trim()
    return el.getAttribute('aria-label') || el.labels?.[0]?.textContent.trim() || el.textContent.trim()
  }
  const stopNames = (d) => [...d.view.container.querySelectorAll('.dog-main button, .dog-main input, .dog-main select, .dog-main textarea, .dog-main [tabindex]')]
    .filter((el) => !el.disabled && el.tabIndex >= 0 && !el.closest('[hidden]') && !(el.tagName === 'INPUT' && el.type === 'file'))
    .map(nameOf)
  // Before (d0a83cc1, the same walk): 'Project', 'Choose a project', 'New
  // project', 'References', 'Choose file', 'Add references', 'Generate
  // outline', 'Full deck', 'Use visual assets', 'Use project assets',
  // 'Theme generator', 'Deck Context & Guidelines': twelve stops.
  it('at the start: ten stops, one header and one checkbox fewer; Core files only is no stop until a project has Core files', async () => {
    const d = await openDog({ upload: false })
    expect(stopNames(d)).toEqual(['Project and references', 'Choose a project', 'New project', 'Choose file', 'Add references',
      'Generate outline', 'Full deck', 'Place visual', 'Theme generator', 'Deck Context & Guidelines'])
  })

  it('with a project that has Core files: Core files only is the stop after Add references', async () => {
    withProject(CORE())
    const d = await openDog({ upload: false })
    await chooseProject(d)
    const names = stopNames(d)
    expect(names.slice(names.indexOf('Add references'), names.indexOf('Generate outline') + 1)).toEqual(['Add references', 'Core files only', 'Generate outline'])
  })
})
