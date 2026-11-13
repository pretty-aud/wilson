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
import { render, cleanup, act } from '@testing-library/react'

const world = vi.hoisted(() => ({ ai: null }))
vi.mock('../cloud/aiProxy', () => ({ callAI: (...args) => world.ai(...args), isRetryableAIError: () => false }))
vi.mock('../lib/localData', () => ({ loadAgentSkills: async () => ({}) }))
vi.mock('../tools/otter_v0.3.1/adapters', () => ({ otterFetch: async () => ({ ok: false, json: async () => ({}) }) }))

const { AgentProvider, useAgent } = await import('./index')

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

beforeEach(() => { agent = null; tool.registered = 0; tool.unregistered = 0; world.ai = vi.fn(() => new Promise(() => {})) })
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
