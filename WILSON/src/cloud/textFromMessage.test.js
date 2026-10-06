// =============================================================================
// textFromMessage.test.js — Session 30.
//
// 🚨 THE BUG AUDREY HIT ON HER FIRST BETA COURSE, and the guard that stops it
// coming back.
//
// "Failed to parse course outline JSON. Try again." — every time, on every
// course. The generation had actually SUCCEEDED (`stop_reason: 'end_turn'`);
// the app just read the wrong content block. These models think even when
// nothing asks them to (S19 measured `thinking` omitted -> thinking=1), so
// `content[0]` is a thinking block and `content[0].text` is undefined.
//
// Eight call sites across three tools read `data.content[0].text`. Six of them
// were one model-tier change away from the same failure, and O.T.T.E.R.'s
// course generation was already living it.
//
// The source scan below is the half that matters long-term: a unit test of the
// helper cannot stop somebody typing `content[0].text` again tomorrow.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { textFromMessage } from './anthropicStream'

const SRC = fileURLToPath(new URL('../', import.meta.url))

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      walk(full, out)
    } else if (/\.(js|jsx)$/.test(entry) && !/\.test\.jsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('textFromMessage', () => {
  it('skips a leading thinking block — the exact failure', () => {
    const msg = {
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'Let me plan the course...', signature: 'sig' },
        { type: 'text', text: '{"software_name":"Blender 5.0"}' },
      ],
    }
    expect(msg.content[0].text).toBeUndefined()      // what the old code read
    expect(textFromMessage(msg)).toBe('{"software_name":"Blender 5.0"}')
  })

  it('skips server_tool_use and web_search_tool_result blocks', () => {
    expect(textFromMessage({
      content: [
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
        { type: 'text', text: 'the answer' },
      ],
    })).toBe('the answer')
  })

  it('returns the LAST non-empty text block when a tool ran mid-turn', () => {
    // Anthropic emits text before and after a server-side tool call; the final
    // block is the answer, and the earlier one is usually "let me look that up".
    expect(textFromMessage({
      content: [
        { type: 'text', text: 'Let me search for that.' },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
        { type: 'text', text: 'FINAL' },
      ],
    })).toBe('FINAL')
  })

  it('ignores a trailing whitespace-only text block', () => {
    expect(textFromMessage({
      content: [{ type: 'text', text: 'real' }, { type: 'text', text: '  \n ' }],
    })).toBe('real')
  })

  it('returns "" rather than throwing on junk', () => {
    for (const junk of [null, undefined, {}, { content: null }, { content: [] },
      { content: [{ type: 'thinking', thinking: 'only thought' }] }]) {
      expect(textFromMessage(junk)).toBe('')
    }
  })
})

describe('no call site indexes content[0] for text', () => {
  // Deliberately narrow: `content[0]` / `content?.[0]` followed by `.text`.
  // A blanket ban on `content[0]` would be wrong — reading a tool block by
  // index is legitimate — and S29's lesson is that a blunt negative gets
  // deleted later along with the real assertion.
  const PATTERN = /content\s*\??\.?\s*\[\s*0\s*\]\s*\??\.\s*text/

  const offenders = []
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const [i, line] of text.split('\n').entries()) {
      // The helper's own doc comment names the pattern it replaces.
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue
      if (PATTERN.test(line)) {
        offenders.push(`${relative(SRC, file).replace(/\\/g, '/')}:${i + 1}`)
      }
    }
  }

  it('finds source files at all — the instrument works', () => {
    expect(walk(SRC).length).toBeGreaterThan(50)
  })

  it('nothing reads data.content[0].text', () => {
    expect(offenders, 'use textFromMessage(data) — content[0] is a thinking '
      + 'block whenever the model reasons, which these models do by default')
      .toEqual([])
  })
})
