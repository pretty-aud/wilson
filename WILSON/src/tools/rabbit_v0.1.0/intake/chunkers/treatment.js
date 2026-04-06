// ============================================================
// RABBIT intake — treatment chunker
// ============================================================
//
// Splits a treatment per act if act markers are present
// (`ACT ONE`, `Act 1`, `## Act One`, etc.); otherwise falls back
// to ~2k-token segments using a 4-char-per-token approximation.

const ACT_HEADER = /^\s*(?:#{1,3}\s*)?(?:act\s+(?:one|two|three|four|five|six|i{1,3}|iv|v|\d+))\b.*$/im
const APPROX_CHARS_PER_CHUNK = 8000 // ≈ 2000 tokens at 4 chars/token

function splitOnActs(text) {
  const lines = text.split(/\r?\n/)
  const acts = []
  let current = null
  for (const line of lines) {
    if (ACT_HEADER.test(line)) {
      if (current) acts.push(current)
      current = { header: line.trim(), body: [line] }
    } else if (current) {
      current.body.push(line)
    } else {
      // Lines before the first act header — preamble.
      if (acts.length === 0 && !current) {
        current = { header: 'Preamble', body: [line] }
      }
    }
  }
  if (current) acts.push(current)
  return acts
}

function splitByLength(text) {
  const out = []
  const paragraphs = text.split(/\n{2,}/)
  let buf = []
  let bufLen = 0
  let idx = 0
  for (const p of paragraphs) {
    if (bufLen + p.length > APPROX_CHARS_PER_CHUNK && buf.length > 0) {
      idx += 1
      out.push({ chunk_label: `Segment ${idx}`, raw_text: buf.join('\n\n') })
      buf = []
      bufLen = 0
    }
    buf.push(p)
    bufLen += p.length + 2
  }
  if (buf.length > 0) {
    idx += 1
    out.push({ chunk_label: `Segment ${idx}`, raw_text: buf.join('\n\n') })
  }
  return out
}

export function split(rawText) {
  const text = String(rawText || '')
  if (!text.trim()) return []
  if (ACT_HEADER.test(text)) {
    const acts = splitOnActs(text)
    return acts.map((act, i) => ({
      chunk_label: `Act ${i + 1}: ${act.header}`,
      raw_text: act.body.join('\n'),
    }))
  }
  return splitByLength(text)
}

export default { split, kind: 'treatment' }
