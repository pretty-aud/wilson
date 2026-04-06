// ============================================================
// RABBIT intake — game design document chunker
// ============================================================
//
// Splits a GDD per H1/H2 markdown heading. GDDs are
// long-context tolerant — we'd rather have a single 8k chunk
// covering "Combat" than break it across model calls. Falls back
// to a single chunk if no headings are found.

const HEADING = /^(#{1,2})\s+(.+?)\s*$/

export function split(rawText) {
  const text = String(rawText || '')
  if (!text.trim()) return []

  const lines = text.split(/\r?\n/)
  const sections = []
  let current = null

  for (const line of lines) {
    const m = line.match(HEADING)
    if (m) {
      if (current) sections.push(current)
      current = {
        level: m[1].length,
        title: m[2].trim(),
        body: [line],
      }
    } else if (current) {
      current.body.push(line)
    } else {
      // Preamble before any heading.
      current = { level: 0, title: 'Preamble', body: [line] }
    }
  }
  if (current) sections.push(current)

  if (sections.length === 0) {
    return [{ chunk_label: 'whole-gdd', raw_text: text }]
  }

  return sections.map(sec => ({
    chunk_label: `${'#'.repeat(Math.max(sec.level, 1))} ${sec.title}`,
    raw_text: sec.body.join('\n'),
  }))
}

export default { split, kind: 'gdd' }
