// ============================================================
// RABBIT intake — notes chunker
// ============================================================
//
// 1500-token naive paragraph chunker. Notes documents are noisy
// and don't have reliable structure (meeting notes, scratchpads,
// loose voice memos), so we batch paragraphs until we hit the
// budget and emit a chunk.

const APPROX_CHARS_PER_CHUNK = 6000 // ≈ 1500 tokens at 4 chars/token

export function split(rawText) {
  const text = String(rawText || '')
  if (!text.trim()) return []

  const paragraphs = text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) {
    return [{ chunk_label: 'notes', raw_text: text }]
  }

  const chunks = []
  let buf = []
  let bufLen = 0
  for (const p of paragraphs) {
    if (bufLen + p.length > APPROX_CHARS_PER_CHUNK && buf.length > 0) {
      chunks.push({
        chunk_label: `Notes ${chunks.length + 1}`,
        raw_text: buf.join('\n\n'),
      })
      buf = []
      bufLen = 0
    }
    buf.push(p)
    bufLen += p.length + 2
  }
  if (buf.length > 0) {
    chunks.push({
      chunk_label: `Notes ${chunks.length + 1}`,
      raw_text: buf.join('\n\n'),
    })
  }
  return chunks
}

export default { split, kind: 'notes' }
