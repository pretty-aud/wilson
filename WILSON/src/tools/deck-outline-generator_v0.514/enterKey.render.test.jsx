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

// CI has no .env.local, so the real Supabase client (built at import, from
// VITE_SUPABASE_URL) would throw "supabaseUrl is required" before any test
// ran (CI run 40359715742). The tests never reach it: they stop at callAI.
vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
vi.mock('../../cloud/aiProxy', async (orig) => ({ ...(await orig()), callAI: vi.fn(() => new Promise(() => {})) }))
// DG2: the AI's file store at its module boundary, so the let-go on Remove
// (FX12) is seen without a request. Only a PDF or a picture reaches it; the
// FX13 cases upload text, which travels inline and never calls these.
vi.mock('../../cloud/aiFiles', async (orig) => ({ ...(await orig()), uploadAIFile: vi.fn(), deleteAIFiles: vi.fn() }))
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
// upload's file input is References' (its first group, below).
const CARDS = [
  { name: 'Project', body: '#dog-card1-body', inside: 'select.dog-project-select' },
  { name: 'References', body: '#dog-refs-body', inside: '.dog-refs-contract' },
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
  it('each of the three headers holds a button named by the heading\'s words, the chevron its hidden glyph, open and controlling its body', async () => {
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
    // Counted by the fold itself. Cards 1 and 3 fold by a value read at
    // render, so a second handler there would set the same value and fold
    // once anyway (harmless, and invisible here); the References card folds
    // by an updater, where two handlers fold twice and this goes red. (An
    // earlier cut read React's own props off the node: dropped, review
    // round 1, finding 6.)
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
    await act(async () => { headButton('Project').focus() })
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
    expect(at(headButton('Project'))).toBeLessThan(at(headButton('References')))
    expect(at(headButton('References'))).toBeLessThan(at(headButton('Generate outline')))
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
const refsBody = () => document.querySelector('#dog-refs-body')
const uploadRows = () => [...document.querySelectorAll('#dog-refs-body .dog-refs-uploads .dog-refs-row')]
const chooseInput = () => document.querySelector('#dog-refs-body .dog-refs-uploads input[type=file]')
async function addUpload(d, file) {
  await act(async () => { fireEvent.change(d.q('input[type=file][accept*=".txt"]'), { target: { files: [file] } }) })
  await waitFor(() => expect(d.view.container.textContent).toContain(file.name))
}
const fullDeckButton = (d) => [...d.view.container.querySelectorAll('button.dog-generate')].find((b) => /full deck outline/.test(b.textContent))

describe('DG2 on the rendered D.O.G.: the uploads are References\' first group; card 1 is "1 Project"', () => {
  it('card 1 is "1 Project": the dropdown, its hint and New project, and no upload left in it', async () => {
    const d = await openDog({ upload: false })
    const card1 = document.querySelector('#dog-card1-body')
    expect(document.getElementById('dog-card1-title').textContent).toBe('Project')
    expect(headButton('Project').getAttribute('aria-controls')).toBe('dog-card1-body')
    expect(card1.querySelector('select.dog-project-select')).not.toBe(null)
    expect(card1.textContent).toContain('The deck’s project. Its title and description go with every deck; choose what else in References.')
    expect(within(card1).getByRole('button', { name: 'New project' })).toBeTruthy()
    expect(card1.querySelector('input[type=file]')).toBe(null)
    expect(card1.textContent).not.toMatch(/Upload Documents|Choose file|Source material/)
    // The one upload control on the page is References' first group's.
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
})
