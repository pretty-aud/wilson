/** @vitest-environment jsdom */
// =============================================================================
// AgentProvider.rerender.test.jsx — typing to the agent is the pet's business
// and nobody else's (F4, 2026-11-13; the review's shared-client C1 and
// dog-otter C1).
//
// The provider's value is read by O.T.T.E.R. and R.A.B.B.I.T. (each has an
// effect with the whole value in its dependencies: O.T.T.E.R. registers its
// tool in one), by Settings, and by the pet. The reader below is those three
// in small: it reads the value, shows a field of it, and registers a tool in
// an effect keyed on the value, as Otter.jsx does.
//
// MEASURED BEFORE F4's change (2026-11-13, at the brief's tip a71cd144; the
// first test red): ten characters typed to the agent ran the reader 10 times
// and ran its effect 10 times, so the tool was unregistered and registered
// again on every character. GREEN since the value is one memoized object and
// the text being typed has a context of its own (useAgentInput).
// =============================================================================
import { renderSpy } from '../lib/renderSpy'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useEffect } from 'react'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const world = vi.hoisted(() => ({ ai: null, otterFetch: null }))
vi.mock('../cloud/aiProxy', () => ({ callAI: (...args) => world.ai(...args), isRetryableAIError: () => false }))
vi.mock('../lib/localData', () => ({ loadAgentSkills: async () => ({}) }))
vi.mock('../tools/otter_v0.3.1/adapters', () => ({
  otterFetch: (...args) => (world.otterFetch ? world.otterFetch(...args) : Promise.resolve({ ok: false, json: async () => ({}) })),
}))

const { AgentProvider, useAgent, useAgentInput } = await import('./index')
const { AGENT_SYSTEM_PROMPT } = await import('./agentPrompts')

let agent = null
const tool = { registered: 0, unregistered: 0 }
function Reader() {
  agent = useAgent()
  useEffect(() => {
    agent.registerTool('otter', { toolName: 'otter', currentContext: {}, getCorrections: async () => [] })
    tool.registered++
    return () => { agent.unregisterTool('otter'); tool.unregistered++ }
  }, [agent])
  return <output data-testid="mode">{agent.agentMode ? 'work' : 'chat'} {agent.agentMessages.length}</output>
}

/** Mounted and settled (the provider reads its saved prompt overrides once, which is a change of the value). */
async function mount() {
  let view = null
  await act(async () => { view = render(<AgentProvider><Reader /></AgentProvider>) })
  await act(async () => {})
  return { view, settled: { ...tool } }
}
const type = async (text) => {
  for (let i = 1; i <= text.length; i++) await act(async () => { agent.handleAgentInputChange(text.slice(0, i)) })
}

beforeEach(() => { agent = null; tool.registered = 0; tool.unregistered = 0; world.ai = vi.fn(() => new Promise(() => {})); world.otterFetch = null })
afterEach(() => { cleanup(); renderSpy.reset() })

describe('ten characters typed to the agent', () => {
  it('run no reader of the value, and its effect keyed on the value does not run: the tool stays registered', async () => {
    const { settled } = await mount()
    expect(settled.registered - settled.unregistered).toBe(1)          // registered, once
    const mark = renderSpy.mark()
    await type('lighthouse')
    expect({ readerRuns: renderSpy.renders('Reader', mark), ...tool }).toEqual({ readerRuns: 0, ...settled })
    // Nor does the provider's own toast, which is drawn by the provider and was never a field of the value.
    await act(async () => { agent.showToast('Updated lesson in loops') })
    expect(document.body.textContent).toContain('Updated lesson in loops')
    expect({ readerRuns: renderSpy.renders('Reader', mark), ...tool }).toEqual({ readerRuns: 0, ...settled })
  })

  it('and what was typed is what is sent, by a reader that did not run since: the words go to the model and the field is emptied', async () => {
    await mount()
    const held = agent                               // the value as the reader last saw it
    await type('fix the title')
    await act(async () => { held.sendAgentMessage() })
    expect(world.ai).toHaveBeenCalledTimes(1)
    const sent = world.ai.mock.calls[0][0]
    expect(sent.tool).toBe('agent')
    expect(sent.messages).toEqual([{ role: 'user', content: 'fix the title' }])
    // Nothing left to send: a second Send is refused as an empty one.
    await act(async () => { agent.sendAgentMessage() })
    expect(world.ai).toHaveBeenCalledTimes(1)
  })
})

describe('CONTROL: a change the readers show does reach them', () => {
  it('the mode switched, a message sent: the reader runs and draws it, and its effect runs again', async () => {
    const { view, settled } = await mount()
    expect(view.getByTestId('mode').textContent).toBe('chat 0')
    const mark = renderSpy.mark()
    await act(async () => { agent.setAgentMode(true) })
    expect(view.getByTestId('mode').textContent).toBe('work 0')
    expect(renderSpy.renders('Reader', mark)).toBe(1)
    expect(tool).toEqual({ registered: settled.registered + 1, unregistered: settled.unregistered + 1 })
    await type('hello')
    await act(async () => { agent.sendAgentMessage() })
    expect(view.getByTestId('mode').textContent).toBe('work 1')
  })
})

// =============================================================================
// A change of person (OUTSTANDING F4-08, fixed after the session's merge, at
// her word "Yes, fix it here"). App tells the provider who is signed in as it
// draws; before, nothing cleared the agent when another person signed in over
// the first, or when the first signed out, so the next person's pet in agent
// mode showed the last person's words and sent them as the next person's
// history, and the last person's open diff, proposal, bulk queue and undo list
// were the next person's to apply. Each test below but the control was red on
// the provider as it was merged (7d46458c).
// =============================================================================
describe('a change of person: the agent\'s conversation, and what is pending in it, leaves with the person', () => {
  const reply = (text) => ({ content: [{ type: 'text', text }] })
  const action = (a) => `<agent_action>${JSON.stringify(a)}</agent_action>`
  const edit = (n) => ({
    type: 'edit', message: `Edit ${n}`,
    target: { subject_slug: 'loops', lesson_id: `l${n}` },
    changes: [{ field: 'title', original: `Old title ${n}`, proposed: `New title ${n}` }],
  })
  const deferred = () => {
    let resolve, reject
    const promise = new Promise((r, j) => { resolve = r; reject = j })
    return { promise, resolve, reject }
  }
  const button = (words) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.includes(words))
  const otter = { applyChange: null, saveCorrection: null, corrections: null, subjectData: null }
  let seen = null                                    // what the reader last drew
  function PersonReader() {
    const a = useAgent()
    const typed = useAgentInput()
    agent = a
    seen = { messages: a.agentMessages, typed, loading: a.agentLoading, undo: a.undoStack.length, autoApprove: a.autoApprove }
    useEffect(() => {
      a.registerTool('otter', {
        toolName: 'otter', currentContext: { activeSoftwareSlug: 'course' },
        getCorrections: () => otter.corrections(),
        getSubjectData: (slug) => otter.subjectData(slug),
        applyChange: (...args) => otter.applyChange(...args),
        saveCorrection: (...args) => otter.saveCorrection(...args),
      })
      return () => a.unregisterTool('otter')
    }, [a])
    return null
  }
  const drawn = (person) => <AgentProvider person={person}><PersonReader /></AgentProvider>
  async function mountAs(person) {
    let view = null
    await act(async () => { view = render(drawn(person)) })
    await act(async () => {})
    return { view, as: async (next) => { await act(async () => { view.rerender(drawn(next)) }) } }
  }
  /** Sends `text` and lets its answer, and what the answer sets going, land. */
  const send = async (text, answer) => {
    world.ai = vi.fn(async () => reply(answer))
    await act(async () => { await agent.sendAgentMessage(text) })
    await act(async () => {})
  }
  const onScreen = (words) => document.body.textContent.includes(words)

  beforeEach(() => {
    seen = null
    otter.applyChange = vi.fn(async () => {})
    otter.saveCorrection = vi.fn(async () => {})
    otter.corrections = async () => []
    otter.subjectData = async () => ({ sections: [] })
  })

  it('another person signed in over the first: the words, the text typed, an open diff, the proposal, the undo list and "apply without asking" go', async () => {
    const { as } = await mountAs('u-A')
    await act(async () => { agent.setAutoApprove('all') })
    await send('rename the first lesson', `Done. ${action(edit(1))}`)         // applied at once: one undo entry
    await act(async () => { agent.setAutoApprove('always_ask') })
    await send('and the second', `Here. ${action(edit(2))}`)                  // a diff, open
    await send('a subject on my own topic', action({ type: 'generate_subject', subject: { topic: 'A private topic' } }))
    await act(async () => { agent.setAutoApprove('all') })
    await act(async () => { agent.handleAgentInputChange('half a question') })
    expect({ ...seen, messages: seen.messages.length }).toEqual({ messages: 6, typed: 'half a question', loading: false, undo: 1, autoApprove: 'all' })
    expect([onScreen('Apply Changes'), onScreen('A private topic')]).toEqual([true, true])

    await as('u-B')
    expect(seen).toEqual({ messages: [], typed: '', loading: false, undo: 0, autoApprove: 'always_ask' })
    expect([onScreen('Apply Changes'), onScreen('A private topic'), onScreen('Updated lesson in loops')]).toEqual([false, false, false])
    // The next person's first message is sent with no history of the first's.
    await send('hello', 'Hi.')
    expect(world.ai.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('CONTROL: the first person App names, and the same person confirmed again, clear nothing', async () => {
    const { as } = await mountAs(undefined)                                   // the permissions not resolved yet
    await send('before the permissions answer', 'An answer.')
    await act(async () => { agent.handleAgentInputChange('more') })
    await as('u-A')                                                           // the first person named
    await as('u-A')                                                           // the same, confirmed again
    expect({ messages: seen.messages.length, typed: seen.typed }).toEqual({ messages: 2, typed: 'more' })
  })

  it('an answer on its way when the person signs out is dropped: the next person is not shown it, it opens no diff, it is not their history, and their own spinner stays theirs', async () => {
    const { as } = await mountAs('u-A')
    const first = deferred()
    world.ai = vi.fn(() => first.promise)
    let asked = null
    await act(async () => { asked = agent.sendAgentMessage('my own question') })
    expect(seen.loading).toBe(true)
    await as(null)                                                            // the first person signs out
    expect({ messages: seen.messages, loading: seen.loading }).toEqual({ messages: [], loading: false })
    await as('u-B')
    const second = deferred()
    world.ai = vi.fn(() => second.promise)
    await act(async () => { agent.sendAgentMessage('hello') })
    expect(world.ai.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'hello' }])
    await act(async () => { first.resolve(reply(`The first person's answer. ${action(edit(9))}`)); await asked })
    expect({ messages: seen.messages, loading: seen.loading }).toEqual({ messages: [{ role: 'user', content: 'hello' }], loading: true })
    expect(onScreen('Apply Changes')).toBe(false)
  })

  it('a question whose context is still being read when its asker leaves is not sent', async () => {
    const { as } = await mountAs('u-A')
    const reading = deferred()
    otter.corrections = () => reading.promise
    world.ai = vi.fn(async () => reply('An answer.'))
    let asked = null
    await act(async () => { asked = agent.sendAgentMessage('a question of mine') })
    await as('u-B')
    await act(async () => { reading.resolve([]); await asked })
    expect(world.ai).not.toHaveBeenCalled()
    expect({ messages: seen.messages, loading: seen.loading }).toEqual({ messages: [], loading: false })
  })

  it('an edit still being applied when its person leaves writes nothing more, leaves no undo entry and says nothing', async () => {
    const { as } = await mountAs('u-A')
    await act(async () => { agent.setAutoApprove('all') })
    const reading = deferred()
    otter.subjectData = () => reading.promise
    await send('rename it', `Done. ${action(edit(1))}`)                       // the edit waits on the subject's read
    await as('u-B')
    await act(async () => { reading.resolve({ sections: [] }) })
    await act(async () => {})
    expect(otter.applyChange).not.toHaveBeenCalled()
    expect(seen.undo).toBe(0)
    expect(onScreen('Updated lesson in loops')).toBe(false)
  })

  it('"Apply All Remaining" stops when its person leaves: none of the rest of the queue is written for the next one', async () => {
    const { as } = await mountAs('u-A')
    await send('fix all three', action({ type: 'bulk_edit', edits: [edit(1), edit(2), edit(3)] }))
    expect(onScreen('Change 1 of 3')).toBe(true)
    const reading = deferred()
    let reads = 0
    otter.subjectData = () => (++reads === 1 ? reading.promise : Promise.resolve({ sections: [] }))
    const applyAll = [...document.body.querySelectorAll('button')].find((b) => b.textContent.includes('Apply All Remaining'))
    expect(applyAll).toBeTruthy()
    await act(async () => { fireEvent.click(applyAll) })
    await as('u-B')
    await act(async () => { reading.resolve({ sections: [] }) })
    await act(async () => {})
    expect(otter.applyChange).not.toHaveBeenCalled()
    expect(onScreen('Applied all remaining changes')).toBe(false)
  })

  it('an undo on its way when its person leaves says nothing to the next one', async () => {
    const { as } = await mountAs('u-A')
    await act(async () => { agent.setAutoApprove('all') })
    await send('rename it', `Done. ${action(edit(1))}`)
    expect(seen.undo).toBe(1)
    const writing = deferred()
    world.otterFetch = () => writing.promise
    let undoing = null
    await act(async () => { undoing = agent.undoLastEdit() })
    await as('u-B')
    await act(async () => { writing.resolve({ ok: true, json: async () => ({}) }); await undoing })
    expect(onScreen('Reverted last change')).toBe(false)
  })

  // The review of the fix (one reviewer, Opus 5.5) found nine of its pieces that no test above needed; these pin
  // each, and the two the review added (a moment of "not known yet", the system prompt).
  it('the text typed is gone from what Send sends, not only from the field: Enter on the emptied field sends nothing', async () => {
    const { as } = await mountAs('u-A')
    await act(async () => { agent.handleAgentInputChange('half a question of mine') })
    await as('u-B')
    world.ai = vi.fn(async () => reply('An answer.'))
    await act(async () => { await agent.sendAgentMessage() })
    expect(world.ai).not.toHaveBeenCalled()
  })

  it('the leaving person\'s bulk queue goes: the next person\'s own diff is theirs alone, and its Apply opens nothing of the queue', async () => {
    const { as } = await mountAs('u-A')
    await send('fix all three', action({ type: 'bulk_edit', edits: [edit(1), edit(2), edit(3)] }))
    expect(onScreen('Change 1 of 3')).toBe(true)
    await as('u-B')
    await send('and mine', `Here. ${action(edit(5))}`)
    expect([onScreen('Proposed Changes'), onScreen('Change 1 of 3')]).toEqual([true, false])
    await act(async () => { fireEvent.click(button('Apply Changes')) })
    await act(async () => {})
    expect(otter.applyChange.mock.calls.map(([target]) => target.lesson_id)).toEqual(['l5'])
    expect([onScreen('Change 2 of 3'), onScreen('Apply Changes')]).toEqual([false, false])
  })

  it('an edit whose write lands after its person left saves no correction and says nothing', async () => {
    const { as } = await mountAs('u-A')
    await act(async () => { agent.setAutoApprove('all') })
    const writing = deferred()
    otter.applyChange = vi.fn(() => writing.promise)
    await send('rename it', `Done. ${action(edit(1))}`)
    await as('u-B')
    await act(async () => { writing.resolve() })
    await act(async () => {})
    expect(otter.saveCorrection).not.toHaveBeenCalled()
    expect(onScreen('Updated lesson in loops')).toBe(false)
  })

  it('nor the rest of its corrections, when its person leaves during one', async () => {
    const { as } = await mountAs('u-A')
    await act(async () => { agent.setAutoApprove('all') })
    const saving = deferred()
    otter.saveCorrection = vi.fn(() => saving.promise)
    const twoChanges = { ...edit(1), changes: [...edit(1).changes, { field: 'body', original: 'Old body', proposed: 'New body' }] }
    await send('rename it', `Done. ${action(twoChanges)}`)
    await as('u-B')
    await act(async () => { saving.resolve() })
    await act(async () => {})
    expect(otter.saveCorrection).toHaveBeenCalledTimes(1)
    expect(onScreen('Updated lesson in loops')).toBe(false)
  })

  it('an edit that fails once its person has left says nothing to the next one', async () => {
    const { as } = await mountAs('u-A')
    await act(async () => { agent.setAutoApprove('all') })
    const writing = deferred()
    otter.applyChange = vi.fn(() => writing.promise)
    await send('rename it', `Done. ${action(edit(1))}`)
    await as('u-B')
    await act(async () => { writing.reject(new Error('the write timed out')) })
    await act(async () => {})
    expect(onScreen('Error applying changes')).toBe(false)
  })

  it('an error that answers a question after its asker left is not put in the next person\'s chat', async () => {
    const { as } = await mountAs('u-A')
    const first = deferred()
    world.ai = vi.fn(() => first.promise)
    let asked = null
    await act(async () => { asked = agent.sendAgentMessage('my own question') })
    await as('u-B')
    // A sign-in error is not tried again, so it reaches the send's own catch.
    await act(async () => { first.reject(new Error('Please sign in again')); await asked })
    expect(seen.messages).toEqual([])
  })

  it('an undo that fails once its person has left says nothing to the next one', async () => {
    const { as } = await mountAs('u-A')
    await act(async () => { agent.setAutoApprove('all') })
    await send('rename it', `Done. ${action(edit(1))}`)
    const writing = deferred()
    world.otterFetch = () => writing.promise
    let undoing = null
    await act(async () => { undoing = agent.undoLastEdit() })
    await as('u-B')
    await act(async () => { writing.reject(new Error('the write timed out')); await undoing })
    expect(onScreen('Undo failed')).toBe(false)
  })

  it('"Apply All Remaining" whose last edit lands after its person left says nothing to the next one', async () => {
    const { as } = await mountAs('u-A')
    await send('fix both', action({ type: 'bulk_edit', edits: [edit(1), edit(2)] }))
    const reading = deferred()
    let reads = 0
    otter.subjectData = () => (++reads === 2 ? reading.promise : Promise.resolve({ sections: [] }))
    expect(button('Apply All Remaining')).toBeTruthy()
    await act(async () => { fireEvent.click(button('Apply All Remaining')) })
    await act(async () => {})                                                 // the first is written; the second waits on its read
    await as('u-B')
    await act(async () => { reading.resolve({ sections: [] }) })
    await act(async () => {})
    expect(otter.applyChange.mock.calls.map(([target]) => target.lesson_id)).toEqual(['l1'])
    expect(onScreen('Applied all remaining changes')).toBe(false)
  })

  it('a moment of "not known yet" between the same person clears nothing; between two people the change does', async () => {
    const { as } = await mountAs('u-A')
    await send('my question', 'An answer.')
    await as(undefined)                                                       // the permissions not ready for a moment
    await as('u-A')
    expect(seen.messages).toHaveLength(2)
    await as(undefined)
    await as('u-B')
    expect(seen.messages).toEqual([])
  })

  it('the system prompt edited in Settings goes back to the default for the next person', async () => {
    const { as } = await mountAs('u-A')
    await act(async () => { agent.setAgentSystemPrompt('My own private instructions') })
    expect(agent.agentSystemPrompt).toBe('My own private instructions')
    await as('u-B')
    expect(agent.agentSystemPrompt).toBe(AGENT_SYSTEM_PROMPT)
  })

  it('App hands the provider the person as its pet\'s identity effect reads them', () => {
    const app = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'App.jsx'), 'utf8')
    expect(app).toContain('<AgentProvider person={perms.ready ? (perms.userId || null) : undefined}>')
  })
})
