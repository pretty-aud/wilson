// Unit tests for the Session 12 SSE reassembler — the one new component
// every AI feature depends on (locked #21). Pure functions — no Supabase,
// no DOM. The fixture is a recorded-shape Anthropic Messages stream
// covering the invariants call sites rely on: stop_reason branching
// (Otter/D.O.G. 'max_tokens', Validator 'tool_use'), web_search_tool_result
// blocks surviving whole, citations_delta accumulation, and usage merging.

import { describe, it, expect } from 'vitest'
import {
  createSSEParser,
  createMessageAssembler,
  assembleStreamedMessage,
} from './anthropicStream'

// ── Fixture: a web-search generation, as Anthropic streams it ────────────────
const evt = (type, obj) => `event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`

const WEB_SEARCH_FIXTURE =
  evt('message_start', {
    message: {
      id: 'msg_01',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1234, output_tokens: 2 },
    },
  }) +
  evt('content_block_start', {
    index: 0,
    content_block: { type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: {} },
  }) +
  evt('content_block_delta', {
    index: 0,
    delta: { type: 'input_json_delta', partial_json: '{"query"' },
  }) +
  evt('content_block_delta', {
    index: 0,
    delta: { type: 'input_json_delta', partial_json: ': "blender 4.2 nodes"}' },
  }) +
  evt('content_block_stop', { index: 0 }) +
  evt('content_block_start', {
    index: 1,
    content_block: {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_01',
      content: [
        { type: 'web_search_result', url: 'https://docs.blender.org/a', title: 'Nodes — Blender Manual' },
        { type: 'web_search_result', url: 'https://docs.blender.org/b', title: 'Geometry Nodes' },
      ],
    },
  }) +
  evt('content_block_stop', { index: 1 }) +
  evt('content_block_start', { index: 2, content_block: { type: 'text', text: '' } }) +
  evt('content_block_delta', { index: 2, delta: { type: 'text_delta', text: '{"subjects": ' } }) +
  evt('content_block_delta', { index: 2, delta: { type: 'text_delta', text: '["Nodes"]}' } }) +
  evt('content_block_delta', {
    index: 2,
    delta: {
      type: 'citations_delta',
      citation: { type: 'web_search_result_location', url: 'https://docs.blender.org/a', title: 'Nodes — Blender Manual', cited_text: 'nodes…' },
    },
  }) +
  evt('content_block_stop', { index: 2 }) +
  evt('message_delta', {
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 512 },
  }) +
  evt('message_stop', {})

function assembleFixture(text, chunkSize = Infinity) {
  const assembler = createMessageAssembler()
  const parser = createSSEParser(assembler.push)
  if (chunkSize === Infinity) {
    parser.push(text)
  } else {
    for (let i = 0; i < text.length; i += chunkSize) parser.push(text.slice(i, i + chunkSize))
  }
  parser.end()
  return assembler.finish()
}

describe('createMessageAssembler + createSSEParser', () => {
  it('reassembles the classic non-streaming message shape', () => {
    const msg = assembleFixture(WEB_SEARCH_FIXTURE)
    expect(msg.id).toBe('msg_01')
    expect(msg.role).toBe('assistant')
    expect(msg.model).toBe('claude-sonnet-4-20250514')
    expect(msg.content).toHaveLength(3)
    expect(msg.stop_reason).toBe('end_turn')
    expect(msg.stop_sequence).toBeNull()
  })

  it('merges usage from message_start (input) and message_delta (output)', () => {
    const msg = assembleFixture(WEB_SEARCH_FIXTURE)
    expect(msg.usage.input_tokens).toBe(1234)
    expect(msg.usage.output_tokens).toBe(512)
  })

  it('accumulates text deltas into a single text block', () => {
    const msg = assembleFixture(WEB_SEARCH_FIXTURE)
    expect(msg.content[2].type).toBe('text')
    expect(msg.content[2].text).toBe('{"subjects": ["Nodes"]}')
  })

  it('keeps web_search_tool_result blocks intact (extractTextAndCitations contract)', () => {
    const msg = assembleFixture(WEB_SEARCH_FIXTURE)
    const block = msg.content[1]
    expect(block.type).toBe('web_search_tool_result')
    expect(block.tool_use_id).toBe('srvtoolu_01')
    expect(block.content).toEqual([
      { type: 'web_search_result', url: 'https://docs.blender.org/a', title: 'Nodes — Blender Manual' },
      { type: 'web_search_result', url: 'https://docs.blender.org/b', title: 'Geometry Nodes' },
    ])
  })

  it('parses input_json_delta into server_tool_use input at block stop', () => {
    const msg = assembleFixture(WEB_SEARCH_FIXTURE)
    expect(msg.content[0].type).toBe('server_tool_use')
    expect(msg.content[0].input).toEqual({ query: 'blender 4.2 nodes' })
  })

  it('appends citations_delta events to the text block citations array', () => {
    const msg = assembleFixture(WEB_SEARCH_FIXTURE)
    expect(msg.content[2].citations).toHaveLength(1)
    expect(msg.content[2].citations[0].url).toBe('https://docs.blender.org/a')
  })

  it('is chunk-boundary independent (events split mid-line, mid-JSON)', () => {
    for (const size of [1, 3, 7, 16, 64, 251]) {
      const msg = assembleFixture(WEB_SEARCH_FIXTURE, size)
      expect(msg.stop_reason).toBe('end_turn')
      expect(msg.content[2].text).toBe('{"subjects": ["Nodes"]}')
      expect(msg.usage.output_tokens).toBe(512)
    }
  })

  it('handles CRLF line endings', () => {
    const msg = assembleFixture(WEB_SEARCH_FIXTURE.replace(/\n/g, '\r\n'))
    expect(msg.stop_reason).toBe('end_turn')
  })

  it('surfaces stop_reason max_tokens (Otter/D.O.G. branch on it)', () => {
    const fixture =
      evt('message_start', {
        message: { id: 'msg_02', type: 'message', role: 'assistant', model: 'm', content: [], usage: { input_tokens: 10 } },
      }) +
      evt('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
      evt('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'truncat' } }) +
      evt('message_delta', { delta: { stop_reason: 'max_tokens', stop_sequence: null }, usage: { output_tokens: 4096 } }) +
      evt('message_stop', {})
    const msg = assembleFixture(fixture)
    expect(msg.stop_reason).toBe('max_tokens')
    expect(msg.content[0].text).toBe('truncat')
  })

  it('surfaces stop_reason tool_use (Validator recurses on it)', () => {
    const fixture =
      evt('message_start', {
        message: { id: 'msg_03', type: 'message', role: 'assistant', model: 'm', content: [], usage: { input_tokens: 10 } },
      }) +
      evt('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_01', name: 'lookup', input: {} } }) +
      evt('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"q":1}' } }) +
      evt('content_block_stop', { index: 0 }) +
      evt('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } }) +
      evt('message_stop', {})
    const msg = assembleFixture(fixture)
    expect(msg.stop_reason).toBe('tool_use')
    expect(msg.content[0].input).toEqual({ q: 1 })
  })

  it('throws on error events with a mapped status (retry loops key on it)', () => {
    const fixture =
      evt('message_start', {
        message: { id: 'msg_04', type: 'message', role: 'assistant', model: 'm', content: [], usage: { input_tokens: 1 } },
      }) +
      evt('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })
    expect(() => assembleFixture(fixture)).toThrowError(/Overloaded/)
    try {
      assembleFixture(fixture)
    } catch (e) {
      expect(e.status).toBe(529)
      expect(e.type).toBe('overloaded_error')
    }
  })

  it('throws when the stream ends before message_start', () => {
    expect(() => assembleFixture('event: ping\ndata: {"type": "ping"}\n\n')).toThrowError(
      /ended before/,
    )
  })

  it('ignores ping events and unknown event types', () => {
    const fixture =
      evt('ping', {}) +
      WEB_SEARCH_FIXTURE +
      evt('some_future_event', { whatever: true })
    const msg = assembleFixture(fixture)
    expect(msg.content).toHaveLength(3)
  })
})

describe('assembleStreamedMessage', () => {
  it('drains a Response body and returns the assembled message', async () => {
    const bytes = new TextEncoder().encode(WEB_SEARCH_FIXTURE)
    // Odd-sized chunks to exercise the TextDecoder stream path.
    const chunks = []
    for (let i = 0; i < bytes.length; i += 97) chunks.push(bytes.slice(i, i + 97))
    const body = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c)
        controller.close()
      },
    })
    const msg = await assembleStreamedMessage({ body })
    expect(msg.stop_reason).toBe('end_turn')
    expect(msg.usage).toEqual({ input_tokens: 1234, output_tokens: 512 })
  })
})
