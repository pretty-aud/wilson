// ============================================================
// RABBIT intake — outline chunker
// ============================================================
//
// Splits an outline document per top-level bullet group. A
// top-level bullet is one with zero leading whitespace and a
// `-`, `*`, or `1.` marker; everything indented under it (or
// not bulleted at all) belongs to the same group. If no
// top-level bullets are found we treat the entire document as
// one chunk.

const TOP_LEVEL_BULLET = /^[-*+]\s+|^\d+\.\s+/

export function split(rawText) {
  const text = String(rawText || '')
  if (!text.trim()) return []

  const lines = text.split(/\r?\n/)
  const groups = []
  let current = null

  for (const line of lines) {
    const isTopLevel = TOP_LEVEL_BULLET.test(line)
    if (isTopLevel) {
      if (current) groups.push(current)
      current = { head: line.trim(), body: [line] }
    } else if (current) {
      current.body.push(line)
    } else {
      // Lines before any bullet — preamble.
      current = { head: 'Preamble', body: [line] }
    }
  }
  if (current) groups.push(current)

  if (groups.length <= 1) {
    return [{ chunk_label: 'whole-outline', raw_text: text }]
  }

  return groups.map((g, i) => ({
    chunk_label: `Beat ${i + 1}: ${g.head.slice(0, 80)}`,
    raw_text: g.body.join('\n'),
  }))
}

export default { split, kind: 'outline' }
