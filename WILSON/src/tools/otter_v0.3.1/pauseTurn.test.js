// =============================================================================
// pauseTurn.test.js — Session 30, made executable by F6 (REV-03).
//
// A guard for the SECOND defect Audrey hit on the beta, an hour after the
// first, behind an almost identical error message.
//
// WHAT HAPPENED. The course outline generated fine and then "Generate subject
// content" failed with "Failed to parse subject JSON. Try again."
//
// `pause_turn` is what Anthropic returns when a SERVER-SIDE tool run — here
// web_search — hits its iteration limit mid-answer. The turn ends on a
// `server_tool_use` block, so the last text block is a preamble rather than
// the JSON, and the parse fails. The request itself succeeded.
//
// 🚨 THE ASYMMETRY THAT NAMES IT, and it came from Audrey's own observation:
// the course OUTLINE has no tools and works; `generateSubjectContent` passes
// `web_search_20250305` with max_uses 3 and fails. The only O.T.T.E.R. calls
// that can pause are the ones carrying that tool.
//
// 🚨 TWO WRAPPERS, TWO DIFFERENT HALVES OF THE RULE (F6, REV-03). Otter.jsx's
// wrapper resumed a pause and retried a 429/529 but lived inside the component;
// the Validator's own `callValidatorAPI` returned the FIRST text block
// (`content.find(...)`) before it ever looked at `pause_turn`, so a web search
// that said "Let me check…" before searching handed that sentence to the JSON
// parser, and it had no retry at all. F6 moved the one wrapper to `prompts.js`
// (what O.T.T.E.R. sends the model, and how) and the Validator calls it.
//
// Session 30's header said this file could not execute the continuation,
// because the wrapper was declared inside the Otter component. It no longer
// is, so the continuation, the bound and the retry below RUN against a faked
// `callAI` instead of being found as strings.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The real aiProxy (its AIProxyError and its retry rule), minus the network:
// only `callAI` is faked, and the Supabase client it imports is a stub so the
// module loads without a project URL.
vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../cloud/aiProxy', async (importOriginal) => ({
  ...(await importOriginal()),
  callAI: vi.fn(),
}))
// The Validator's other imports: its content reads, and the model registry
// (a recognisable stand-in, so the sent body shows WHICH key was asked for).
vi.mock('./adapters', () => ({ otterFetch: vi.fn() }))
vi.mock('../../lib/activeModel', () => ({ modelFor: (key) => `m:${key}` }))

import { callAI, AIProxyError } from '../../cloud/aiProxy'
import { callAnthropicAPI, MAX_CONTINUATIONS } from './prompts.js'
import { callValidatorAPI } from './Validator.jsx'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const OTTER = read('./Otter.jsx')
const VALIDATOR = read('./Validator.jsx')
const HOME = read('./prompts.js')

const WEB = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }
const ASK = [{ role: 'user', content: 'Validate the following lesson: …' }]

/** A turn that hit the server-side tool limit: a preamble, then the search. */
const paused = (n) => ({
  stop_reason: 'pause_turn',
  content: [
    { type: 'text', text: `Let me check the current manual (${n}).` },
    { type: 'server_tool_use', id: `s${n}`, name: 'web_search', input: { query: 'blender' } },
  ],
})
const answered = (json) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: json }] })

beforeEach(() => {
  callAI.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('one wrapper, in prompts.js, and every O.T.T.E.R. caller uses it', () => {
  it('finds the wrapper at all — the instrument works', () => {
    expect(HOME).toContain('export async function callAnthropicAPI(')
    // If web search ever leaves Otter.jsx, the whole class goes with it and
    // the assertions below would start passing vacuously.
    expect(OTTER).toContain('web_search_20250305')
    expect(VALIDATOR).toContain('web_search_20250305')
  })

  it('neither caller keeps a wrapper of its own', () => {
    const importsIt = /import\s*\{[^}]*\bcallAnthropicAPI\b[^}]*\}\s*from\s*'\.\/prompts\.js'/
    expect(OTTER).not.toContain('async function callAnthropicAPI(')
    expect(OTTER).toMatch(importsIt)
    expect(VALIDATOR).toMatch(importsIt)
    // The Validator reaches the AI only through the wrapper, and never picks a
    // text block by itself again.
    expect(VALIDATOR).not.toMatch(/\bcallAI\s*\(/)
    expect(VALIDATOR).not.toMatch(/\.content\s*\??\.\s*find\s*\(/)
  })

  it('the wrapper resumes a pause_turn, bounded, by appending the ASSISTANT turn', () => {
    // The documented shape. S19 MEASURED the alternative — a trailing user or
    // prefill turn — returning 400 "This model does not support assistant
    // message prefill", so getting this wrong swaps a parse error for an API
    // error. The executable cases below prove it; these pin the shape.
    expect(HOME).toContain("stop_reason === 'pause_turn'")
    expect(HOME).toContain('MAX_CONTINUATIONS')
    expect(HOME).toMatch(/depth\s*<\s*MAX_CONTINUATIONS/)
    expect(HOME).toMatch(/depth:\s*depth\s*\+\s*1/)
    expect(HOME).toMatch(/role:\s*'assistant',\s*content:\s*data\.content/)
  })

  it('the Validator keeps its own sentence for a turn still paused at the bound (S19, dab9046)', () => {
    expect(VALIDATOR).toContain("stop_reason === 'pause_turn'")
    expect(VALIDATOR).toContain('MAX_CONTINUATIONS')
  })
})

describe('callAnthropicAPI, executed', () => {
  it('a paused turn is resumed with the assistant turn appended and no trailing user turn', async () => {
    callAI.mockResolvedValueOnce(paused(1)).mockResolvedValueOnce(answered('{"ok":1}'))
    const out = await callAnthropicAPI({ model: 'm', maxTokens: 10, systemPrompt: 's', messages: ASK, tools: [WEB] })
    expect(out).toEqual(answered('{"ok":1}'))
    expect(callAI).toHaveBeenCalledTimes(2)
    const second = callAI.mock.calls[1][0]
    expect(second.messages).toEqual([...ASK, { role: 'assistant', content: paused(1).content }])
    expect(second.messages.at(-1).role).toBe('assistant')
    // The resume re-sends the same request otherwise.
    expect({ ...second, messages: null }).toEqual({ ...callAI.mock.calls[0][0], messages: null })
  })

  it('the continuation is BOUNDED: still paused after MAX_CONTINUATIONS resumes, the paused turn comes back', async () => {
    // An unbounded resume loop is worse than the bug: it spends tokens in a
    // circle. The Validator's first version recursed with no ceiling at all.
    callAI.mockResolvedValue(paused(9))
    const out = await callAnthropicAPI({ model: 'm', maxTokens: 10, systemPrompt: 's', messages: ASK, tools: [WEB] })
    expect(MAX_CONTINUATIONS).toBe(3)
    expect(callAI).toHaveBeenCalledTimes(MAX_CONTINUATIONS + 1)
    expect(out.stop_reason).toBe('pause_turn')
    expect(callAI.mock.calls[3][0].messages).toHaveLength(ASK.length + 3)
  })

  it('429 and 529 are retried after 3, 6 and 12 seconds', async () => {
    vi.useFakeTimers()
    callAI
      .mockRejectedValueOnce(new AIProxyError('Rate limited', 429))
      .mockRejectedValueOnce(new AIProxyError('Overloaded', 529))
      .mockRejectedValueOnce(new AIProxyError('Rate limited', 429))
      .mockResolvedValueOnce(answered('{"ok":2}'))
    const p = callAnthropicAPI({ model: 'm', maxTokens: 10, systemPrompt: 's', messages: ASK })
    await vi.advanceTimersByTimeAsync(2999)
    expect(callAI).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(callAI).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(6000)
    expect(callAI).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(12000)
    expect(callAI).toHaveBeenCalledTimes(4)
    await expect(p).resolves.toEqual(answered('{"ok":2}'))
  })

  it('a fourth 429 is the error; a 400 is never retried', async () => {
    vi.useFakeTimers()
    callAI.mockRejectedValue(new AIProxyError('Rate limited', 429))
    const p = callAnthropicAPI({ model: 'm', maxTokens: 10, systemPrompt: 's', messages: ASK })
    const settled = expect(p).rejects.toThrow('Rate limited')
    await vi.advanceTimersByTimeAsync(21000)
    await settled
    expect(callAI).toHaveBeenCalledTimes(4)

    callAI.mockReset()
    callAI.mockRejectedValue(new AIProxyError('Bad request', 400))
    await expect(callAnthropicAPI({ model: 'm', maxTokens: 10, systemPrompt: 's', messages: ASK })).rejects.toThrow('Bad request')
    expect(callAI).toHaveBeenCalledTimes(1)
  })

  it('builds the body it always built, the tool tag a parameter (default otter)', async () => {
    callAI.mockResolvedValue(answered('{}'))
    await callAnthropicAPI({ model: 'm', maxTokens: 12000, systemPrompt: 's', messages: ASK, tools: [WEB], betas: ['b1'] })
    expect(JSON.stringify(callAI.mock.calls[0][0])).toBe(JSON.stringify({
      model: 'm', max_tokens: 12000, system: 's', messages: ASK, tool: 'otter', tools: [WEB], betas: ['b1'],
    }))
    await callAnthropicAPI({ model: 'm', maxTokens: 10, systemPrompt: 's', messages: ASK, tools: [], tool: 'validator' })
    expect(JSON.stringify(callAI.mock.calls[1][0])).toBe(JSON.stringify({
      model: 'm', max_tokens: 10, system: 's', messages: ASK, tool: 'validator',
    }))
  })
})

describe('the Validator, executed on the same wrapper (REV-03)', () => {
  it('reads the LAST text block: a preamble before the search no longer reaches the parser', async () => {
    callAI.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: 'Let me check the current Blender manual.' },
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
        { type: 'text', text: '{"grade":"A"}' },
      ],
    })
    await expect(callValidatorAPI({ systemPrompt: 'v', messages: ASK, tools: [WEB] })).resolves.toBe('{"grade":"A"}')
  })

  it('a paused turn that opened with a preamble is resumed, not handed to the parser', async () => {
    callAI.mockResolvedValueOnce(paused(1)).mockResolvedValueOnce(answered('{"grade":"B"}'))
    await expect(callValidatorAPI({ systemPrompt: 'v', messages: ASK, tools: [WEB] })).resolves.toBe('{"grade":"B"}')
    expect(callAI).toHaveBeenCalledTimes(2)
    expect(callAI.mock.calls[1][0].messages.at(-1)).toEqual({ role: 'assistant', content: paused(1).content })
  })

  it('still paused at the bound: says so, after MAX_CONTINUATIONS resumes', async () => {
    callAI.mockResolvedValue(paused(2))
    await expect(callValidatorAPI({ systemPrompt: 'v', messages: ASK, tools: [WEB] }))
      .rejects.toThrow(`Validator stopped after ${MAX_CONTINUATIONS} continuations without a final answer.`)
    expect(callAI).toHaveBeenCalledTimes(MAX_CONTINUATIONS + 1)
  })

  it('a 529 is retried rather than failing the lesson', async () => {
    vi.useFakeTimers()
    callAI.mockRejectedValueOnce(new AIProxyError('Overloaded', 529)).mockResolvedValueOnce(answered('{"grade":"C"}'))
    const p = callValidatorAPI({ systemPrompt: 'v', messages: ASK })
    await vi.advanceTimersByTimeAsync(3000)
    await expect(p).resolves.toBe('{"grade":"C"}')
    expect(callAI).toHaveBeenCalledTimes(2)
  })

  it('no text at all: today\'s sentence', async () => {
    callAI.mockResolvedValueOnce({ stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '…' }] })
    await expect(callValidatorAPI({ systemPrompt: 'v', messages: ASK }))
      .rejects.toThrow('No text response from API (stop_reason: max_tokens).')
  })

  it('sends the body it sent before: its own model key, 8096 tokens, the validator tag', async () => {
    callAI.mockResolvedValue(answered('{}'))
    await callValidatorAPI({ systemPrompt: 'v', messages: ASK, tools: [WEB] })
    expect(JSON.stringify(callAI.mock.calls[0][0])).toBe(JSON.stringify({
      model: 'm:otter.validator', max_tokens: 8096, system: 'v', messages: ASK, tool: 'validator', tools: [WEB],
    }))
    await callValidatorAPI({ systemPrompt: 'f', messages: ASK })
    expect(JSON.stringify(callAI.mock.calls[1][0])).toBe(JSON.stringify({
      model: 'm:otter.validator', max_tokens: 8096, system: 'f', messages: ASK, tool: 'validator',
    }))
  })
})

describe('a parse failure says what came back', () => {
  it('describeResponse exists and reports the three things that distinguish causes', () => {
    expect(HOME).toContain('export function describeResponse(')
    expect(HOME).toContain('stop_reason')
    expect(HOME).toMatch(/blocks:/)
    expect(HOME).toMatch(/chars of text/)
  })

  it('every "Failed to parse" message carries it', () => {
    // Two different causes hid behind two identical "Try again" messages in one
    // evening. A bare retry prompt is the same sentence for a paused tool run,
    // an empty response and genuinely malformed JSON.
    for (const source of [OTTER, HOME]) {
      const bare = source.match(/Failed to parse [^`'"]*?(JSON|outline)[^`'"]*?\.\s*Try again\.'/g) ?? []
      expect(bare, 'these still use a plain string with no diagnostic').toEqual([])
    }
    expect((OTTER.match(/describeResponse\(data\)/g) ?? []).length).toBeGreaterThanOrEqual(5)
  })
})
