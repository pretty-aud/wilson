// =============================================================================
// pauseTurn.test.js — Session 30.
//
// A source-level guard for the SECOND defect Audrey hit on the beta, an hour
// after the first, behind an almost identical error message.
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
// 🚨 AND THE FIX ALREADY EXISTED IN THE FOLDER. Validator.jsx has handled
// pause_turn since S19 (`dab9046`), added when web search made it necessary,
// with a written explanation of why `tool_use` is the wrong signal and
// `pause_turn` is the right one. Otter.jsx's own wrapper never received it —
// the third time in one session that a defect turned out to be a rule this
// codebase already knew and had not applied at the call site.
//
// ⚠️ STATED LIMIT. This is a SOURCE scan. `callAnthropicAPI` is declared inside
// the Otter component and is not exported, so nothing here executes the
// continuation; it pins that the handling is present and bounded, not that it
// behaves correctly against a live paused turn. Only the beta can show that.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const OTTER = read('./Otter.jsx')
const VALIDATOR = read('./Validator.jsx')

describe('every O.T.T.E.R. caller that can pause, resumes', () => {
  it('finds the wrapper at all — the instrument works', () => {
    expect(OTTER).toContain('async function callAnthropicAPI(')
    // If web search ever leaves this file, the whole class goes with it and
    // these assertions would start passing vacuously.
    expect(OTTER).toContain('web_search_20250305')
  })

  it("Otter's callAnthropicAPI resumes a pause_turn", () => {
    expect(OTTER, 'a paused server-tool run ends on server_tool_use, so the last '
      + 'text block is a preamble and every JSON parse downstream fails')
      .toContain("stop_reason === 'pause_turn'")
  })

  it('the continuation is BOUNDED', () => {
    // An unbounded resume loop is worse than the bug: it spends tokens in a
    // circle. The Validator's own header records that its first version
    // recursed with no ceiling at all.
    expect(OTTER).toContain('MAX_CONTINUATIONS')
    expect(OTTER).toMatch(/depth\s*<\s*MAX_CONTINUATIONS/)
    expect(OTTER).toMatch(/depth:\s*depth\s*\+\s*1/)
  })

  it('it resumes by appending the ASSISTANT turn, with no trailing user turn', () => {
    // The documented shape. S19 MEASURED the alternative — a trailing user or
    // prefill turn — returning 400 "This model does not support assistant
    // message prefill", so getting this wrong swaps a parse error for an API
    // error.
    expect(OTTER).toMatch(/role:\s*'assistant',\s*content:\s*data\.content/)
  })

  it('the Validator keeps its own pause_turn handling (S19, dab9046)', () => {
    // Pinned because this is where the pattern came from; deleting it there
    // would quietly reintroduce the same defect in the Validator.
    expect(VALIDATOR).toContain("stop_reason === 'pause_turn'")
    expect(VALIDATOR).toContain('MAX_CONTINUATIONS')
  })
})

describe('a parse failure says what came back', () => {
  it('describeResponse exists and reports the three things that distinguish causes', () => {
    expect(OTTER).toContain('function describeResponse(')
    expect(OTTER).toContain('stop_reason')
    expect(OTTER).toMatch(/blocks:/)
    expect(OTTER).toMatch(/chars of text/)
  })

  it('every "Failed to parse" message carries it', () => {
    // Two different causes hid behind two identical "Try again" messages in one
    // evening. A bare retry prompt is the same sentence for a paused tool run,
    // an empty response and genuinely malformed JSON.
    const bare = OTTER.match(/Failed to parse [^`'"]*?(JSON|outline)[^`'"]*?\.\s*Try again\.'/g) ?? []
    expect(bare, 'these still use a plain string with no diagnostic').toEqual([])
    expect((OTTER.match(/describeResponse\(data\)/g) ?? []).length).toBeGreaterThanOrEqual(5)
  })
})
