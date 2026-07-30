// =============================================================================
// anthropicStream — Session 12 (locked #21): reassemble an Anthropic
// Messages SSE stream into the classic NON-streaming response object.
//
// The ai-proxy Edge Function always requests stream:true upstream (the 150s
// response deadline vs long O.T.T.E.R. generations — see the function header)
// and pipes the SSE through. Nothing in WILSON streamed before S12, so every
// call site expects the shape `await res.json()` used to return:
//
//   { id, type:'message', role, model, content:[...], stop_reason,
//     stop_sequence, usage:{ input_tokens, output_tokens, ... } }
//
// The invariants call sites actually depend on, all covered by unit tests:
//   * stop_reason survives (Otter + D.O.G. branch on 'max_tokens';
//     Validator recurses on 'tool_use');
//   * web_search_tool_result blocks arrive whole in content_block_start and
//     must land in content untouched (Otter's extractTextAndCitations);
//   * citations_delta events append to text blocks' `citations` arrays;
//   * usage merges message_start (input_tokens) + message_delta
//     (output_tokens).
//
// Pure module — no supabase import, no env. aiProxy.js owns transport.
// =============================================================================

/**
 * Incremental SSE line parser. Feed it decoded text chunks (any split
 * points); it invokes onEvent with each parsed `data:` JSON payload.
 * Anthropic sends one JSON object per data line; `event:` lines are
 * redundant with the payload's `type` and are ignored.
 */
export function createSSEParser(onEvent) {
  let buf = ''

  const handleLine = (rawLine) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    let evt
    try { evt = JSON.parse(payload) } catch { return }
    onEvent(evt)
  }

  return {
    push(text) {
      buf += text
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
    },
    end() {
      if (buf) handleLine(buf)
      buf = ''
    },
  }
}

const ERROR_STATUS = {
  overloaded_error: 529,
  rate_limit_error: 429,
  api_error: 500,
  authentication_error: 401,
  permission_error: 403,
  invalid_request_error: 400,
}

/**
 * Event-by-event message assembler. push() every parsed SSE event, then
 * finish() returns the completed message object (or throws if the stream
 * carried an `error` event / never started).
 */
export function createMessageAssembler() {
  let message = null
  let streamError = null
  const jsonBufs = new Map() // content index → accumulated partial_json

  const push = (evt) => {
    if (!evt || typeof evt.type !== 'string') return
    switch (evt.type) {
      case 'message_start': {
        const m = evt.message ?? {}
        message = { ...m, content: Array.isArray(m.content) ? m.content.map((b) => ({ ...b })) : [] }
        break
      }
      case 'content_block_start': {
        if (!message) break
        // Deep-copy: web_search_tool_result blocks arrive complete here and
        // must not alias the event object.
        const block = JSON.parse(JSON.stringify(evt.content_block ?? {}))
        if (block.type === 'text' && block.text == null) block.text = ''
        message.content[evt.index] = block
        break
      }
      case 'content_block_delta': {
        const block = message?.content?.[evt.index]
        if (!block) break
        const d = evt.delta ?? {}
        if (d.type === 'text_delta') {
          block.text = (block.text ?? '') + (d.text ?? '')
        } else if (d.type === 'input_json_delta') {
          jsonBufs.set(evt.index, (jsonBufs.get(evt.index) ?? '') + (d.partial_json ?? ''))
        } else if (d.type === 'citations_delta' && d.citation) {
          if (!Array.isArray(block.citations)) block.citations = []
          block.citations.push(d.citation)
        } else if (d.type === 'thinking_delta') {
          block.thinking = (block.thinking ?? '') + (d.thinking ?? '')
        } else if (d.type === 'signature_delta') {
          block.signature = (block.signature ?? '') + (d.signature ?? '')
        }
        break
      }
      case 'content_block_stop': {
        const buf = jsonBufs.get(evt.index)
        if (buf != null) {
          const block = message?.content?.[evt.index]
          if (block) {
            try { block.input = JSON.parse(buf) } catch { /* keep the start-event input */ }
          }
          jsonBufs.delete(evt.index)
        }
        break
      }
      case 'message_delta': {
        if (!message) break
        if (evt.delta && typeof evt.delta === 'object') Object.assign(message, evt.delta)
        if (evt.usage && typeof evt.usage === 'object') {
          message.usage = { ...(message.usage ?? {}), ...evt.usage }
        }
        break
      }
      case 'error': {
        streamError = evt.error ?? { type: 'api_error', message: 'Stream error' }
        break
      }
      // message_stop / ping: nothing to accumulate
      default:
        break
    }
  }

  const finish = () => {
    if (streamError) {
      const err = new Error(streamError.message || 'Stream error')
      err.type = streamError.type ?? 'api_error'
      err.status = ERROR_STATUS[err.type] ?? 500
      throw err
    }
    if (!message) {
      const err = new Error('AI stream ended before any response arrived')
      err.status = 502
      throw err
    }
    return message
  }

  return { push, finish }
}

/**
 * Drain a fetch Response whose body is an Anthropic SSE stream and return
 * the reassembled message object. Aborting the caller's signal rejects the
 * read with an AbortError, exactly like aborting a non-streaming fetch did.
 */
export async function assembleStreamedMessage(response) {
  const assembler = createMessageAssembler()
  const parser = createSSEParser(assembler.push)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parser.push(decoder.decode(value, { stream: true }))
  }
  const tail = decoder.decode()
  if (tail) parser.push(tail)
  parser.end()
  return assembler.finish()
}
